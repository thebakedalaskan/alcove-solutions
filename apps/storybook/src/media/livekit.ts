/*
 * Stands in for apps/web/src/features/call/media/livekit.ts in Storybook (.storybook/main.ts points every import of it here).
 * LiveKit can't run here, so the room is scripted: the call screen drives it exactly as it drives LiveKit's room, and it
 * answers as LiveKit would from the call's script (src/api/script.ts).
 *
 *   - Your own microphone, camera and screen are published as LocalMedia has them, from the browser's made-up devices
 *     (src/browser.ts): mute, switch a device or share, and the room follows, a share after a moment to publish.
 *   - Everyone else's microphone, who's speaking and what they share come from the scripted call's `livekit` side, for the
 *     people in this browser's encrypted group, with media only from the part of the call it's in (`playOnly` narrows it
 *     further, as the real room does). A share is drawn (src/media/screens.ts). Nobody else's camera is ever on, so
 *     people show in their arches.
 *   - Your connection reconnecting, dropping, or ending when the host ends the call or removes you, and the host muting
 *     your microphone, come from the script too.
 *
 * Nothing is ever sent or played: nobody else's browser is here to hear it.
 */
import type { CallSession, LiveStore } from '@alcove/api';
import type * as Real from '~/features/call/media/livekit';
import type { LocalMedia } from '~/features/call/media/media';
import { ScriptedCall, type RoomSide } from '../api/call';
import { pause } from '../api/live';
import { drawnScreen, type Screen } from './screens';

type RoomView = Real.RoomView;

/** How long LiveKit takes to connect, and to say a new share is published. */
const CONNECT_MS = 400;
const PUBLISH_MS = 700;
/** A track's sid, as LiveKit names them: `TR_` and a kind. */
const sidOf = (kind: 'AM' | 'CV' | 'SS', seed: string) => `TR_${kind}${seed.replace(/[^A-Za-z0-9]/g, '').slice(-14)}`;
/** A room nobody scripted: just you. */
const ALONE: RoomSide = { people: {}, connection: 'connected', endReason: null, mutedYou: 0 };

class ScriptedRoom implements Real.CallRoom {
  private view: RoomView = { connection: 'connecting', endReason: null, people: {}, hostMuted: 0, audioBlocked: false, screenFailed: null };
  private listeners = new Set<() => void>();
  private readonly side: LiveStore<RoomSide> | null;
  private ready = false;
  private left = false;
  private stops: (() => void)[] = [];
  /** While breakout rooms are open: whose media plays here (see CallRoom.playOnly). */
  private only: ((identity: string) => boolean) | null = null;
  /** Shares whose sound this listener muted, by the share's sid. */
  private quiet = new Set<string>();
  /** How many of the host's mutes this room has carried out. */
  private mutes: number;
  /** Your share as published (a change of what's shared keeps its sid), and one on its way. */
  private shared: { stream: MediaStream; sid: string } | null = null;
  private publishing: { stream: MediaStream; timer: ReturnType<typeof setTimeout> } | null = null;
  /** Everyone else's shares: each its own sid, and its picture while anything shows it. */
  private sids = new WeakMap<Screen, string>();
  private pictures = new Map<string, { stream: MediaStream; stop: () => void; users: number }>();

  constructor(private readonly session: CallSession, private readonly media: LocalMedia) {
    this.side = session instanceof ScriptedCall ? session.livekit : null;
    this.mutes = this.sideNow().mutedYou;
    const follow = () => this.follow();
    this.stops.push(session.crypto.subscribe(follow), media.subscribe(() => { this.publish(); this.follow(); }));
    if (this.side) this.stops.push(this.side.subscribe(follow));
    this.publish();
  }

  /** Connected, as LiveKit says once the room has let this browser in. */
  connected(): void {
    this.ready = true;
    this.follow();
  }

  private sideNow(): RoomSide { return this.side?.getSnapshot() ?? ALONE; }

  /** The room as the script and LocalMedia have it now. */
  private follow(): void {
    if (this.left) return;
    const side = this.sideNow();
    // Whoever hosts muted your microphone: LiveKit mutes it, the dock says it's off, and it stays off until you unmute.
    if (side.mutedYou > this.mutes) {
      this.mutes = side.mutedYou;
      if (this.media.getSnapshot().mic) {
        void this.media.setMic(false);
        this.view = { ...this.view, hostMuted: this.view.hostMuted + 1 };
      }
    }
    const connection: RoomView['connection'] = side.connection === 'ended' ? 'ended' : !this.ready ? 'connecting' : side.connection;
    this.set({ connection, endReason: side.connection === 'ended' ? side.endReason : null, people: this.people(side) });
  }

  /** Everyone in a group this browser keeps: you as published, everyone else as the script has them. */
  private people(side: RoomSide): RoomView['people'] {
    const c = this.session.crypto.getSnapshot();
    const m = this.media.getSnapshot();
    const mic = this.media.micTrack();
    const cam = m.cam ? m.camera?.getVideoTracks()[0] : undefined;
    const out: RoomView['people'] = {
      [this.session.ticket.identity]: {
        mic: m.mic && mic !== null, micSid: mic ? sidOf('AM', mic.id) : null, camSid: cam ? sidOf('CV', cam.id) : null,
        screenSid: this.shared?.sid ?? null, screenSound: null, speaking: false
      }
    };
    for (const [id, them] of Object.entries(side.people)) {
      if (!c.everyone.includes(id)) continue;
      // Media only from the people in this browser's part of the call, and while rooms are open, the ones the call says.
      const plays = c.status === 'in' && c.members.includes(id) && (this.only?.(id) ?? true);
      const screenSid = them.screen && plays ? this.shareSid(id, them.screen) : null;
      out[id] = {
        mic: them.mic, micSid: sidOf('AM', id), camSid: null, screenSid,
        screenSound: screenSid && them.sound ? (this.quiet.has(screenSid) ? 'muted' : 'on') : null,
        speaking: them.mic && them.speaking
      };
    }
    return out;
  }
  private shareSid(id: string, screen: Screen): string {
    const known = this.sids.get(screen);
    if (known) return known;
    const made = sidOf('SS', `${id}${screen.title}`);
    this.sids.set(screen, made);
    return made;
  }

  /**
   * Your screen, as LocalMedia shares it: published after a moment, as LiveKit does; something else shared in its place
   * goes into the same publication at once; stopping takes it off.
   */
  private publish(): void {
    const screen = this.media.getSnapshot().screen;
    if (screen === (this.publishing?.stream ?? this.shared?.stream ?? null)) return;
    if (this.publishing) clearTimeout(this.publishing.timer);
    this.publishing = null;
    if (!screen) { this.shared = null; return; }
    const was = this.shared;
    if (was) { this.shared = { stream: screen, sid: was.sid }; return; }
    const track = screen.getVideoTracks()[0];
    this.publishing = {
      stream: screen,
      timer: setTimeout(() => {
        this.publishing = null;
        if (this.left || this.media.getSnapshot().screen !== screen) return;
        this.shared = { stream: screen, sid: sidOf('SS', track?.id ?? 'screen') };
        this.follow();
      }, PUBLISH_MS)
    };
  }

  getSnapshot = (): RoomView => this.view;
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<RoomView>): void {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }

  startAudio(): Promise<void> { this.set({ audioBlocked: false }); return Promise.resolve(); }

  /** Your own camera or screen, or someone else's share, drawn; nobody else has a camera on. */
  attach(trackSid: string, el: HTMLMediaElement): () => void {
    const cam = this.media.getSnapshot().camera?.getVideoTracks()[0];
    const local = cam && sidOf('CV', cam.id) === trackSid ? cam : this.shared?.sid === trackSid ? this.shared.stream.getVideoTracks()[0] : undefined;
    if (local) {
      const stream = new MediaStream([local]);
      el.srcObject = stream;
      return () => { if (el.srcObject === stream) el.srcObject = null; };
    }
    const owner = Object.keys(this.view.people).find((id) => this.view.people[id]?.screenSid === trackSid);
    const screen = owner ? this.sideNow().people[owner]?.screen : null;
    if (!screen) return () => undefined;
    const picture = this.pictures.get(trackSid) ?? { ...drawnScreen(screen), users: 0 };
    picture.users += 1;
    this.pictures.set(trackSid, picture);
    el.srcObject = picture.stream;
    return () => {
      if (el.srcObject === picture.stream) el.srcObject = null;
      picture.users -= 1;
      if (picture.users > 0) return;
      picture.stop();
      this.pictures.delete(trackSid);
    };
  }

  playOnly(who: ((identity: string) => boolean) | null): void {
    this.only = who;
    this.follow();
  }
  /** The live transcript hears everyone else through these: here, nobody's voice is real, so there's nothing to hear. */
  heard(): { identity: string; track: MediaStreamTrack }[] { return []; }
  muteShare(screenSid: string, muted: boolean): void {
    if (muted) this.quiet.add(screenSid); else this.quiet.delete(screenSid);
    this.follow();
  }
  /** Pointers and marks go to nobody: nobody else's browser is in the room. */
  send(): void { /* Nobody else's browser is here to take it. */ }
  receive(): () => void { return () => undefined; }

  leave(): Promise<void> {
    if (this.left) return Promise.resolve();
    this.left = true;
    for (const stop of this.stops) stop();
    if (this.publishing) clearTimeout(this.publishing.timer);
    for (const p of this.pictures.values()) p.stop();
    this.pictures.clear();
    this.set({ connection: 'ended', endReason: this.view.endReason ?? 'left' });
    return Promise.resolve();
  }
}

/** Connects to the call's room: a moment's connecting, then in. */
export const openRoom: typeof Real.openRoom = async (session: CallSession, media: LocalMedia) => {
  const room = new ScriptedRoom(session, media);
  await pause(CONNECT_MS);
  room.connected();
  return room;
};
