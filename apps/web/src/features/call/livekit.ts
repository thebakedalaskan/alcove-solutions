/*
 * The LiveKit room around a call. The call itself (notes, transcript, chat, who's in it) stays in the
 * server-backed CallSession; this carries the media: it publishes LocalMedia's microphone, camera and screen,
 * plays everyone else's audio, says who has their mic on, their camera or screen up and who's speaking, and
 * refetches the call when the server nudges the room or people come and go.
 *
 * A device switch replaces the track inside its publication (no unpublish, no gap, mute kept), everyone else's audio
 * plays on the chosen speaker through LiveKit's own output switching, and each person plays as loud as this listener
 * set them (volume.ts): on the elements only, so their tracks stay as they arrived.
 *
 * Several people can share at once. A change of what's shared swaps the track inside the same publication too, so it
 * changes in place for everyone; a screen LiveKit won't publish is said (`screenFailed`), so the call screen stops that
 * capture instead of showing it as shared to nobody; and each listener can mute the sound of someone else's share for
 * themselves (`muteShare`).
 *
 * Every frame is end-to-end encrypted before it leaves this browser (docs: Calls and recordings › End-to-end
 * encryption): with this browser's own media key, which comes from the call's MLS group in the CallSession and
 * changes with every join and leave. LiveKit only ever forwards ciphertext. A browser that can't encrypt frames
 * can't join, and only media that's encrypted, from someone in the call's group, is played or shown. While
 * breakout rooms are open, the call screen narrows that to the people in your own room (`playOnly`).
 *
 * Load it with `await import('~/features/call/livekit')` from the call routes only: livekit-client is large and
 * stays out of the first page load.
 */
import { CALL_KEYRING, CALL_TOPIC, CallNudgeSchema, type CallMediaKeys, type CallSession, type LiveStore } from '@alcove/api';
import {
  BaseKeyProvider, ConnectionState, CryptorError, CryptorErrorReason, DisconnectReason, LoggerNames, RemoteAudioTrack, Room, RoomEvent, Track, createKeyMaterialFromBuffer, getLogger,
  isE2EESupported, type Participant, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant, type TrackPublication
} from 'livekit-client';
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import { log } from '~/lib/log';
import type { LocalMedia } from './media';
import { volumesFor, type CallVolumes } from './volume';

const rlog = log.child({ component: 'call-room' });

/*
 * LiveKit's own warnings and errors (its worker's too) go to the app's logger at debug instead of the console,
 * without their context. What matters to the call (joining, publishing, the keys, decrypting, leaving and why) is
 * logged here in Alcove's words, at the level it deserves.
 */
const lklog = log.child({ component: 'livekit' });
for (const name of Object.values(LoggerNames)) {
  const l = getLogger(name);
  l.methodFactory = (method) => (msg: unknown) => lklog.debug(typeof msg === 'string' ? msg : 'livekit log', { level: method });
  l.setLevel('warn', false);
}
/** Why a frame couldn't be decrypted. LiveKit's worker sends its errors on as "<reason>: <message>". */
const MISSING_KEY = CryptorErrorReason[CryptorErrorReason.MissingKey] ?? 'MissingKey';
const reasonOf = (e: Error): string => (e instanceof CryptorError ? CryptorErrorReason[e.reason] ?? e.name : e.message.split(':')[0] ?? e.name);

export interface RoomPerson {
  mic: boolean;
  /** The microphone's track sid, for the organizer's mute. */
  micSid: string | null;
  /** Track sids to attach, once there's media for them that this browser plays. */
  camSid: string | null;
  screenSid: string | null;
  /** The sound their share carries (a tab's or the computer's), if any: playing here, or muted here by this listener. */
  screenSound: 'on' | 'muted' | null;
  speaking: boolean;
}
export interface RoomView {
  connection: 'connecting' | 'connected' | 'reconnecting' | 'ended';
  endReason: 'left' | 'ended-by-host' | 'removed' | 'error' | null;
  /** By LiveKit identity (the call's participant IDs). */
  people: Record<string, RoomPerson>;
  /** How many times the organizer has muted this browser's microphone, so the screen can say so. */
  hostMuted: number;
  /** The browser is holding back everyone's sound until the page is clicked (startAudio). */
  audioBlocked: boolean;
  /**
   * The last screen LiveKit wouldn't publish, by its picture's track id: it reaches nobody, so the call screen stops that
   * capture (if it's still the one shared) and says so.
   */
  screenFailed: string | null;
}
export interface CallRoom extends LiveStore<RoomView> {
  /** Lets everyone's sound play where the browser held it back: call it from a click or key press. */
  startAudio(): Promise<void>;
  /** Plays a camera or screen track in an element; returns the function that stops it. */
  attach(trackSid: string, el: HTMLMediaElement): () => void;
  /**
   * Whose media this browser plays and shows, of the people in the call's group: while breakout rooms are open,
   * the people in your own room, or in the main room. Null plays everyone's again. Nobody else's media is played
   * or attached.
   */
  playOnly(who: ((identity: string) => boolean) | null): void;
  /**
   * Everyone else's microphone this browser plays now (the people in your part of the call, not muted), as the raw
   * decrypted tracks: the live transcript hears each person on their own, whatever their volume here or the speaker
   * chosen.
   */
  heard(): { identity: string; track: MediaStreamTrack }[];
  /**
   * Mutes the sound of someone else's share (by its picture's track sid), for this listener only, or plays it again.
   * Their share goes on for everyone else.
   */
  muteShare(screenSid: string, muted: boolean): void;
  leave(): Promise<void>;
}

function endReason(r: DisconnectReason | undefined): RoomView['endReason'] {
  switch (r) {
    case DisconnectReason.CLIENT_INITIATED: return 'left';
    case DisconnectReason.ROOM_DELETED: return 'ended-by-host';
    case DisconnectReason.PARTICIPANT_REMOVED: return 'removed';
    default: return 'error';
  }
}

const material = (key: Uint8Array) => { const copy = new Uint8Array(key.length); copy.set(key); return createKeyMaterialFromBuffer(copy.buffer); };
/**
 * LiveKit's frame encryption with the call's MLS media keys: one per sender per epoch, kept in a ring by index.
 * Everyone else's keys for each new epoch go in as soon as there are any (each frame says which it needs);
 * this browser's own goes in last, and is what it sends with.
 */
class CallKeys extends BaseKeyProvider {
  private installed = new WeakSet<object>();
  private sending: CallMediaKeys['send'] | null = null;
  constructor(private readonly self: string) { super({ sharedKey: false, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: CALL_KEYRING }); }
  async use(media: CallMediaKeys): Promise<void> {
    for (const epoch of media.epochs) {
      if (this.installed.has(epoch)) continue;
      this.installed.add(epoch);
      for (const [identity, key] of Object.entries(epoch.keys)) if (identity !== this.self) this.onSetEncryptionKey(await material(key), identity, epoch.index);
    }
    if (media.send !== this.sending) {
      this.sending = media.send;
      this.onSetEncryptionKey(await material(media.send.key), this.self, media.send.index);
    }
  }
}

type Kind = 'mic' | 'cam' | 'screen' | 'screenAudio';
const SOURCE: Record<Kind, Track.Source> = { mic: Track.Source.Microphone, cam: Track.Source.Camera, screen: Track.Source.ScreenShare, screenAudio: Track.Source.ScreenShareAudio };

class LiveKitRoom implements CallRoom {
  private keys: CallKeys;
  private room: Room;
  /** The media keys in use, as the session handed them over (a new object whenever they change). */
  private keyNow: CallMediaKeys | null = null;
  /** Remote tracks not played or shown: not encrypted, from someone not (yet) in the call's group, or outside your room. */
  private held = new Map<string, { track: RemoteTrack; pub: RemoteTrackPublication; who: RemoteParticipant }>();
  /** While breakout rooms are open: whose media plays here (see CallRoom.playOnly). */
  private only: ((identity: string) => boolean) | null = null;
  private stopKeys: () => void = () => undefined;
  private listeners = new Set<() => void>();
  private view: RoomView = { connection: 'connecting', endReason: null, people: {}, hostMuted: 0, audioBlocked: false, screenFailed: null };
  private audio = new Map<string, HTMLMediaElement>();
  /** Publishing follows LocalMedia one change at a time. */
  private syncing: Promise<void> = Promise.resolve();
  private stopFollowing: () => void = () => undefined;
  /** How loud each person plays here, for this listener only (see volume.ts). */
  private volumes: CallVolumes;
  private stopVolumes: () => void = () => undefined;
  /** The speaker everyone else's audio plays on now, and one the browser just refused (said once). */
  private speaker: string | null = null;
  private speakerRefused: string | null = null;
  /**
   * Shares whose sound this listener muted, by the share's picture's track sid: the same while that share goes on (a
   * change of what's shared swaps tracks inside it) and across this browser's reconnects.
   */
  private quiet = new Set<string>();

  constructor(private readonly session: CallSession, private readonly media: LocalMedia) {
    this.keys = new CallKeys(session.ticket.identity);
    this.volumes = volumesFor(session);
    this.room = new Room({ adaptiveStream: true, dynacast: true, encryption: { keyProvider: this.keys, worker: new E2EEWorker() } });
    const r = this.room;
    const changed = () => this.emit();
    const refetch = (what?: { call: boolean; log: boolean }) => { this.emit(); void session.refresh(what).catch((e: unknown) => rlog.warn('call refresh failed', { err: e })); };
    for (const e of [RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged] as const) r.on(e, changed);
    // The organizer muted this microphone (LiveKit does it): the dock says it's off, and it stays off until unmuted here.
    // LiveKit also mutes a microphone whose device was unplugged (its track's ended event fired); that one isn't the
    // organizer, and LocalMedia moves to another microphone, muted or not as it was.
    r.on(RoomEvent.TrackMuted, (pub, who) => {
      const unplugged = pub.track ? this.media.unplugged(pub.track.mediaStreamTrack) : false;
      if (who === r.localParticipant && pub.source === Track.Source.Microphone && this.media.getSnapshot().mic && !unplugged) {
        void this.media.setMic(false);
        this.view = { ...this.view, hostMuted: this.view.hostMuted + 1 };
        rlog.info('microphone muted by the organizer');
      }
      this.emit();
    });
    // Sound the browser won't play until the page is clicked (Safari, when nothing is being captured): the screen asks.
    r.on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
      if (this.view.audioBlocked === !playing) return;
      this.set({ audioBlocked: !playing });
      rlog.info(playing ? 'call sound playing' : 'call sound held back by the browser');
    });
    // Each person's volume for this listener: on the elements that play them, whenever it changes.
    this.stopVolumes = this.volumes.subscribe(() => this.applyVolumes());
    // Frames that can't be decrypted yet are expected for a moment around each key change (someone just let in
    // can't read what was sent before they were); anything else is worth knowing about.
    r.on(RoomEvent.EncryptionError, (e, who) => {
      const reason = reasonOf(e);
      rlog.at(reason === MISSING_KEY ? 'debug' : 'warn', 'media couldn’t be decrypted', { reason, local: who === r.localParticipant });
    });
    r.on(RoomEvent.ParticipantConnected, () => refetch());
    // The server nudges when someone leaves too. Waiting a moment lets a room that's closing (the call ended) close
    // first, instead of asking about a call that's over.
    r.on(RoomEvent.ParticipantDisconnected, () => { setTimeout(() => { if (r.state === ConnectionState.Connected) refetch(); }, 400); });
    r.on(RoomEvent.TrackSubscribed, (track, pub, who) => { this.consider(track, pub, who); this.emit(); });
    r.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.sid) this.held.delete(track.sid); this.silence(track); this.emit(); });
    // The server's nudge says what changed. LiveKit could send one too: all it can do is make this browser look again.
    r.on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
      if (topic !== CALL_TOPIC) return;
      let n: unknown = null;
      try { n = JSON.parse(new TextDecoder().decode(payload)); } catch { /* not a nudge */ }
      const nudge = CallNudgeSchema.safeParse(n);
      if (nudge.success) refetch({ call: nudge.data.call, log: nudge.data.log });
    });
    // A short drop usually starts with the signalling connection, which LiveKit tries to resume before it reconnects
    // everything: either way the call isn't keeping up until it's back, and the screen says so.
    r.on(RoomEvent.SignalReconnecting, () => this.set({ connection: 'reconnecting' }));
    r.on(RoomEvent.Reconnecting, () => this.set({ connection: 'reconnecting' }));
    // Publishing waits while LiveKit reconnects (it republishes everything itself), then catches up with LocalMedia.
    r.on(RoomEvent.Reconnected, () => { this.set({ connection: 'connected' }); refetch(); this.follow(); });
    r.on(RoomEvent.Disconnected, (why) => {
      this.stopFollowing();
      this.stopKeys();
      this.stopVolumes();
      this.set({ connection: 'ended', endReason: this.view.endReason ?? endReason(why) });
      rlog.info('left the room', { reason: this.view.endReason });
    });
  }

  async connect(): Promise<void> {
    if (!isE2EESupported()) throw new Error('This browser can’t encrypt call media end to end. Try a current Chrome, Edge, Safari or Firefox.');
    // Keys first: nothing is sent or shown before the call's media key is in place.
    await this.followKeys();
    await this.room.setE2EEEnabled(true);
    const t = await this.session.room();
    await this.room.connect(t.serverUrl, t.token);
    // LiveKit follows plugged-in devices itself, comparing with the list it saw last. Giving it that list now keeps its
    // first comparison from switching the speaker on its own (or, in Safari, failing to): LocalMedia decides devices.
    await Room.getLocalDevices(undefined, false).catch((e: unknown) => rlog.debug('could not list devices for LiveKit', { err: e }));
    this.stopFollowing = this.media.subscribe(() => this.follow());
    this.follow();
    await this.syncing;
    this.set({ connection: 'connected' });
    rlog.info('joined the room', { role: this.session.ticket.role, others: this.room.remoteParticipants.size, keyIndex: this.keyNow?.send.index ?? null });
    // What the call said while this browser was still connecting (people back with fresh keys after the organizer's
    // reload, say) went to a room it wasn't in yet, so it looks again now instead of at its next check.
    void this.session.refresh().catch((e: unknown) => rlog.warn('call refresh failed', { err: e }));
  }

  /**
   * Puts each new media key from the call's MLS group into LiveKit's frame encryption as the group moves on, and
   * plays whatever was held back from someone who's now in the group (and stops anyone who's no longer in it).
   */
  private async followKeys(): Promise<void> {
    const apply = async () => {
      const media = this.session.crypto.getSnapshot().media;
      if (media && media !== this.keyNow) {
        this.keyNow = media;
        await this.keys.use(media);
      }
      this.recheck();
    };
    await apply();
    this.stopKeys = this.session.crypto.subscribe(() => { void apply().catch((e: unknown) => rlog.error('could not use the call’s new media key', { err: e })); });
  }
  /**
   * Media from someone else plays only if it's encrypted end to end, they're in the call's group (MLS says so,
   * not the server or LiveKit), and, while breakout rooms are open, they're in your part of the call.
   */
  private allowed(pub: TrackPublication | undefined, who: Participant): boolean {
    if (who === this.room.localParticipant) return true;
    return Boolean(pub?.isEncrypted) && this.session.crypto.getSnapshot().members.includes(who.identity) && (this.only?.(who.identity) ?? true);
  }
  private consider(track: RemoteTrack, pub: RemoteTrackPublication, who: RemoteParticipant) {
    if (!track.sid) return;
    if (this.allowed(pub, who)) { this.play(track); return; }
    if (!this.held.has(track.sid)) rlog.info('media held back', { encrypted: pub.isEncrypted, member: this.session.crypto.getSnapshot().members.includes(who.identity), here: this.only?.(who.identity) ?? true, kind: track.kind });
    this.held.set(track.sid, { track, pub, who });
  }
  /** Plays what may play now, and holds back what may not: the group's members changed, or rooms opened or closed. */
  private recheck() {
    let played = 0;
    let stopped = 0;
    for (const who of this.room.remoteParticipants.values()) {
      for (const pub of who.trackPublications.values()) {
        const track = pub.track;
        if (!track?.sid) continue;
        const ok = this.allowed(pub, who);
        if (this.held.has(track.sid)) {
          if (!ok) continue;
          this.held.delete(track.sid);
          this.play(track);
          played++;
        } else if (!ok) {
          // Off every element at once, whatever the screen still shows.
          if (track.kind === Track.Kind.Audio) this.silence(track);
          else track.detach();
          this.held.set(track.sid, { track, pub, who });
          stopped++;
        }
      }
    }
    if (!played && !stopped) return;
    rlog.debug('media rechecked', { played, stopped, rooms: this.only !== null });
    this.emit();
  }

  getSnapshot = (): RoomView => this.view;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<RoomView>) { this.view = { ...this.view, ...p, people: this.people() }; this.listeners.forEach((l) => l()); }
  private emit() { this.set({}); }

  playOnly(who: ((identity: string) => boolean) | null): void {
    this.only = who;
    this.recheck();
  }

  heard(): { identity: string; track: MediaStreamTrack }[] {
    const out: { identity: string; track: MediaStreamTrack }[] = [];
    for (const who of this.room.remoteParticipants.values()) {
      const pub = who.getTrackPublication(Track.Source.Microphone);
      const track = pub?.track;
      if (track?.sid && !pub?.isMuted && this.audio.has(track.sid) && this.allowed(pub, who)) out.push({ identity: who.identity, track: track.mediaStreamTrack });
    }
    return out;
  }

  private people(): Record<string, RoomPerson> {
    const out: Record<string, RoomPerson> = {};
    const members = this.session.crypto.getSnapshot().members;
    const all: Participant[] = [this.room.localParticipant, ...[...this.room.remoteParticipants.values()].filter((p) => members.includes(p.identity))];
    for (const p of all) {
      const pub = (s: Track.Source) => p.getTrackPublication(s);
      const shown = (s: Track.Source) => { const t = pub(s); return t?.track && this.allowed(t, p) ? t : undefined; };
      const mic = pub(Track.Source.Microphone);
      const cam = shown(Track.Source.Camera);
      const screen = shown(Track.Source.ScreenShare);
      const sound = screen ? shown(Track.Source.ScreenShareAudio) : undefined;
      out[p.identity] = {
        mic: Boolean(mic && !mic.isMuted),
        micSid: mic?.trackSid ?? null,
        camSid: cam && !cam.isMuted ? cam.trackSid : null,
        screenSid: screen ? screen.trackSid : null,
        screenSound: screen && sound ? (this.quiet.has(screen.trackSid) ? 'muted' : 'on') : null,
        speaking: p.isSpeaking
      };
    }
    return out;
  }

  /**
   * Publishes what LocalMedia has now: its mic (muted or not), camera and screen (with its sound), swapping a new device
   * or a new share into the publication already there. Each kind on its own: one that fails (a camera that won't publish)
   * is logged and never keeps the others from trying, and only a screen's own failure is said (`screenFailed`). Not while
   * LiveKit is reconnecting: it republishes every track under a new publication, and publishing alongside it would send
   * a second copy. Reconnected follows again.
   */
  private follow() {
    if (this.reconnecting()) return;
    this.syncing = this.syncing.then(() => this.sync()).catch((e: unknown) => rlog.warn('publishing to the room failed', { err: e }));
  }
  private reconnecting(): boolean { return this.room.state === ConnectionState.Reconnecting || this.room.state === ConnectionState.SignalReconnecting; }
  private async sync() {
    const m = this.media.getSnapshot();
    const want: Record<Kind, MediaStreamTrack | null> = {
      mic: this.media.micTrack(),
      cam: m.cam ? m.camera?.getVideoTracks()[0] ?? null : null,
      screen: m.screen?.getVideoTracks()[0] ?? null,
      screenAudio: m.screen?.getAudioTracks()[0] ?? null
    };
    if (this.reconnecting()) return;
    const me = this.room.localParticipant;
    for (const kind of ['mic', 'cam', 'screen', 'screenAudio'] as const) {
      const track = want[kind];
      try {
        await this.publish(kind, track);
      } catch (e) {
        rlog.warn('publishing to the room failed', { err: e, kind });
        if (kind === 'screen' && track) this.set({ screenFailed: track.id });
      }
    }
    // Mute as LocalMedia has it now, after the awaits above (the organizer may have muted it meanwhile).
    const now = this.media.getSnapshot();
    const mic = me.getTrackPublication(Track.Source.Microphone);
    if (mic && mic.isMuted === now.mic) await (now.mic ? mic.unmute() : mic.mute());
    // LiveKit mutes a camera whose device was unplugged; once LocalMedia has another one on, it's shown again.
    const cam = me.getTrackPublication(Track.Source.Camera);
    if (cam?.isMuted && now.cam) await cam.unmute();
    await this.useSpeaker(now.speakerId);
    this.emit();
  }

  /** Makes LiveKit's publication of one kind carry `track`, or none: the one it has published now, never a copy kept here. */
  private async publish(kind: Kind, track: MediaStreamTrack | null) {
    const me = this.room.localParticipant;
    // After a full reconnect this is the publication LiveKit republished, not the one this browser made.
    const have = me.getTrackPublication(SOURCE[kind]);
    if (have?.track?.mediaStreamTrack === track && have) return;
    // Another microphone or camera, or something else shared: the same publication carries it, so nobody sees it stop
    // and start, a microphone stays muted or not and the organizer's mute still finds it, and everyone keeps their
    // choices about a share.
    if (have?.track && track) { await have.track.replaceTrack(track, true); return; }
    // LocalMedia owns these tracks: unpublishing must never stop them.
    if (have?.track) await me.unpublishTrack(have.track, false);
    if (track) await me.publishTrack(track, { source: SOURCE[kind] });
  }

  /** Everyone else's audio plays through hidden elements, on the chosen speaker, each person as loud as set here. */
  private play(track: RemoteTrack) {
    if (track.kind !== Track.Kind.Audio || !track.sid || this.audio.has(track.sid)) return;
    if (this.hushed(track)) return;
    const el = track.attach();
    el.hidden = true;
    document.body.append(el);
    if (track instanceof RemoteAudioTrack) track.setVolume(this.levelOf(track));
    this.audio.set(track.sid, el);
  }
  private silence(track: RemoteTrack) {
    if (!track.sid) return;
    const el = this.audio.get(track.sid);
    if (!el) return;
    track.detach(el);
    el.remove();
    this.audio.delete(track.sid);
  }
  /**
   * The speaker for everyone else's audio. LiveKit sets it on every element, now and as people arrive, and its own
   * device handling then knows it too. Null where the browser can't choose one.
   */
  private async useSpeaker(id: string | null) {
    if (id === null || id === this.speaker) return;
    try {
      await this.room.switchActiveDevice('audiooutput', id);
      this.speaker = id;
      this.speakerRefused = null;
    } catch (e) {
      // Tried again at the next change; said once (as a warning) for each speaker the browser refuses.
      rlog.at(this.speakerRefused === id ? 'debug' : 'warn', 'could not play through the chosen speaker', { err: e });
      this.speakerRefused = id;
    }
  }
  /**
   * How loud someone's voice plays for this listener: the element's volume, never their track, which stays as it
   * arrived for anything else that uses it. A tab they share plays at its own volume.
   */
  private levelOf(track: RemoteTrack): number {
    for (const who of this.room.remoteParticipants.values()) if (who.getTrackPublication(Track.Source.Microphone)?.track === track) return this.volumes.level(who.identity);
    return 1;
  }
  private applyVolumes() {
    for (const who of this.room.remoteParticipants.values()) {
      const track = who.getTrackPublication(Track.Source.Microphone)?.track;
      if (track instanceof RemoteAudioTrack) track.setVolume(this.volumes.level(who.identity));
    }
  }
  async startAudio(): Promise<void> {
    await this.room.startAudio().catch((e: unknown) => rlog.info('call sound still held back', { err: e }));
  }

  attach(trackSid: string, el: HTMLMediaElement): () => void {
    const local = this.room.localParticipant.trackPublications.get(trackSid)?.track;
    const remote = [...this.room.remoteParticipants.values()].flatMap((p) => { const pub = p.trackPublications.get(trackSid); return pub?.track && this.allowed(pub, p) ? [pub.track] : []; })[0];
    const track = local ?? remote;
    if (!track) return () => undefined;
    track.attach(el);
    return () => { track.detach(el); };
  }

  muteShare(screenSid: string, muted: boolean): void {
    if (muted === this.quiet.has(screenSid)) return;
    if (muted) this.quiet.add(screenSid); else this.quiet.delete(screenSid);
    for (const who of this.room.remoteParticipants.values()) {
      if (who.getTrackPublication(Track.Source.ScreenShare)?.trackSid !== screenSid) continue;
      const pub = who.getTrackPublication(Track.Source.ScreenShareAudio);
      const track = pub?.track;
      if (track && this.allowed(pub, who)) { if (muted) this.silence(track); else this.play(track); }
    }
    rlog.info(muted ? 'a share’s sound muted here' : 'a share’s sound playing here again');
    this.emit();
  }
  /** The sound of a share this listener muted: it isn't played. */
  private hushed(track: RemoteTrack): boolean {
    if (track.source !== Track.Source.ScreenShareAudio) return false;
    for (const who of this.room.remoteParticipants.values()) {
      if (who.getTrackPublication(Track.Source.ScreenShareAudio)?.track !== track) continue;
      const screen = who.getTrackPublication(Track.Source.ScreenShare)?.trackSid;
      return screen !== undefined && this.quiet.has(screen);
    }
    return false;
  }

  async leave(): Promise<void> {
    this.view = { ...this.view, endReason: this.view.endReason ?? 'left' };
    // LocalMedia's tracks stay with LocalMedia (the call screen stops them).
    await this.room.disconnect(false);
  }
}

/** Connects to the call's room. Rejects if LiveKit refuses or can't be reached; nothing is left connected then. */
export async function openRoom(session: CallSession, media: LocalMedia): Promise<CallRoom> {
  const room = new LiveKitRoom(session, media);
  try {
    await room.connect();
  } catch (e) {
    await room.leave().catch(() => undefined);
    throw e;
  }
  return room;
}
