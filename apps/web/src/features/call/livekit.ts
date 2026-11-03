/*
 * The LiveKit room around a call. The call itself (notes, transcript, chat, who's in it) stays in the
 * server-backed CallSession; this carries the media: it publishes LocalMedia's microphone, camera and screen,
 * plays everyone else's audio, says who has their mic on, their camera or screen up and who's speaking, and
 * refetches the call when the server nudges the room or people come and go.
 *
 * Load it with `await import('~/features/call/livekit')` from the call routes only: livekit-client is large and
 * stays out of the first page load.
 */
import { CALL_TOPIC, type CallSession, type LiveStore } from '@alcove/api';
import { DisconnectReason, Room, RoomEvent, Track, type LocalTrackPublication, type Participant, type RemoteTrack } from 'livekit-client';
import { log } from '~/lib/log';
import type { LocalMedia } from './media';

const rlog = log.child({ component: 'call-room' });

export interface RoomPerson {
  mic: boolean;
  /** The microphone's track sid, for the organizer's mute. */
  micSid: string | null;
  /** Track sids to attach, once there's media for them. */
  camSid: string | null;
  screenSid: string | null;
  speaking: boolean;
}
export interface RoomView {
  connection: 'connecting' | 'connected' | 'reconnecting' | 'ended';
  endReason: 'left' | 'ended-by-host' | 'removed' | 'error' | null;
  /** By LiveKit identity (the call's participant IDs). */
  people: Record<string, RoomPerson>;
}
export interface CallRoom extends LiveStore<RoomView> {
  /** Plays a camera or screen track in an element; returns the function that stops it. */
  attach(trackSid: string, el: HTMLMediaElement): () => void;
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

type Kind = 'mic' | 'cam' | 'screen';
const SOURCE: Record<Kind, Track.Source> = { mic: Track.Source.Microphone, cam: Track.Source.Camera, screen: Track.Source.ScreenShare };

class LiveKitRoom implements CallRoom {
  private room = new Room({ adaptiveStream: true, dynacast: true });
  private listeners = new Set<() => void>();
  private view: RoomView = { connection: 'connecting', endReason: null, people: {} };
  private published: Partial<Record<Kind, LocalTrackPublication>> = {};
  private audio = new Map<string, HTMLMediaElement>();
  /** Publishing follows LocalMedia one change at a time. */
  private syncing: Promise<void> = Promise.resolve();
  private stopFollowing: () => void = () => undefined;

  constructor(private readonly session: CallSession, private readonly media: LocalMedia) {
    const r = this.room;
    const changed = () => this.emit();
    const refetch = () => { this.emit(); void session.refresh().catch((e: unknown) => rlog.warn('call refresh failed', { err: e })); };
    for (const e of [RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged] as const) r.on(e, changed);
    r.on(RoomEvent.ParticipantConnected, refetch);
    r.on(RoomEvent.ParticipantDisconnected, refetch);
    r.on(RoomEvent.TrackSubscribed, (track) => { this.play(track); this.emit(); });
    r.on(RoomEvent.TrackUnsubscribed, (track) => { this.silence(track); this.emit(); });
    r.on(RoomEvent.DataReceived, (_payload, _p, _kind, topic) => { if (topic === CALL_TOPIC) refetch(); });
    r.on(RoomEvent.Reconnecting, () => this.set({ connection: 'reconnecting' }));
    r.on(RoomEvent.Reconnected, () => { this.set({ connection: 'connected' }); refetch(); });
    r.on(RoomEvent.Disconnected, (why) => {
      this.stopFollowing();
      this.set({ connection: 'ended', endReason: this.view.endReason ?? endReason(why) });
      rlog.info('left the room', { reason: this.view.endReason });
    });
  }

  async connect(): Promise<void> {
    const t = this.session.ticket;
    await this.room.connect(t.serverUrl, t.token);
    this.stopFollowing = this.media.subscribe(() => this.follow());
    this.follow();
    await this.syncing;
    this.set({ connection: 'connected' });
    rlog.info('joined the room', { role: t.role, others: this.room.remoteParticipants.size });
  }

  getSnapshot = (): RoomView => this.view;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<RoomView>) { this.view = { ...this.view, ...p, people: this.people() }; this.listeners.forEach((l) => l()); }
  private emit() { this.set({}); }

  private people(): Record<string, RoomPerson> {
    const out: Record<string, RoomPerson> = {};
    const all: Participant[] = [this.room.localParticipant, ...this.room.remoteParticipants.values()];
    for (const p of all) {
      const pub = (s: Track.Source) => p.getTrackPublication(s);
      const mic = pub(Track.Source.Microphone);
      const cam = pub(Track.Source.Camera);
      const screen = pub(Track.Source.ScreenShare);
      out[p.identity] = {
        mic: Boolean(mic && !mic.isMuted),
        micSid: mic?.trackSid ?? null,
        camSid: cam && !cam.isMuted && cam.track ? cam.trackSid : null,
        screenSid: screen && screen.track ? screen.trackSid : null,
        speaking: p.isSpeaking
      };
    }
    return out;
  }

  /** Publishes what LocalMedia has now: its mic (muted or not), camera and screen, replacing tracks a device switch changed. */
  private follow() {
    this.syncing = this.syncing.then(() => this.sync()).catch((e: unknown) => rlog.warn('publishing to the room failed', { err: e }));
  }
  private async sync() {
    const m = this.media.getSnapshot();
    const want: Record<Kind, MediaStreamTrack | null> = {
      mic: this.media.micTrack(),
      cam: m.cam ? m.camera?.getVideoTracks()[0] ?? null : null,
      screen: m.screen?.getVideoTracks()[0] ?? null
    };
    const me = this.room.localParticipant;
    for (const kind of ['mic', 'cam', 'screen'] as const) {
      const have = this.published[kind];
      const track = want[kind];
      if (have?.track?.mediaStreamTrack === track && have) continue;
      // LocalMedia owns these tracks: unpublishing must never stop them.
      if (have?.track) await me.unpublishTrack(have.track, false);
      delete this.published[kind];
      if (track) this.published[kind] = await me.publishTrack(track, { source: SOURCE[kind] });
    }
    const mic = this.published.mic;
    if (mic && mic.isMuted === m.mic) await (m.mic ? mic.unmute() : mic.mute());
    for (const el of this.audio.values()) this.toSpeaker(el, m.speakerId);
    this.emit();
  }

  /** Everyone else's audio plays through hidden elements, on the chosen speaker. */
  private play(track: RemoteTrack) {
    if (track.kind !== Track.Kind.Audio || !track.sid) return;
    const el = track.attach();
    el.hidden = true;
    document.body.append(el);
    this.toSpeaker(el, this.media.getSnapshot().speakerId);
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
  private toSpeaker(el: HTMLMediaElement, speakerId: string | null) {
    if (speakerId && 'setSinkId' in el) void el.setSinkId(speakerId).catch((e: unknown) => rlog.warn('could not play through the chosen speaker', { err: e }));
  }

  attach(trackSid: string, el: HTMLMediaElement): () => void {
    const all: Participant[] = [this.room.localParticipant, ...this.room.remoteParticipants.values()];
    const track = all.map((p) => p.trackPublications.get(trackSid)?.track).find((t) => t !== undefined);
    if (!track) return () => undefined;
    track.attach(el);
    return () => { track.detach(el); };
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
