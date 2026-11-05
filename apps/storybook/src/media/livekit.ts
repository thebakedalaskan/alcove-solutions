/*
 * Stands in for apps/web/src/features/call/livekit.ts in Storybook (.storybook/main.ts points every import of it here).
 * LiveKit can't run here, so the room is scripted from the call itself: everyone in the call is in the room with their
 * microphone on and their camera off (so they show in their arches), and whoever said the latest line of the transcript
 * is speaking for a few seconds. Nothing is ever sent or played. The call stories build on this: someone unmuting, a
 * screen being shared, someone's connection dropping.
 */
import type { CallSession } from '@alcove/api';
import type * as Real from '~/features/call/livekit';
import type { LocalMedia } from '~/features/call/media';

type CallRoom = Real.CallRoom;
type RoomView = Real.RoomView;

/** How long someone counts as speaking after their line arrives. */
const SPEAKING_MS = 3200;

class ScriptedRoom implements CallRoom {
  private view: RoomView = { connection: 'connected', endReason: null, people: {}, hostMuted: 0, audioBlocked: false, screenFailed: null };
  private listeners = new Set<() => void>();
  private speaking: { id: string; until: number } | null = null;
  private quiet: ReturnType<typeof setTimeout> | null = null;
  private stop: () => void;

  constructor(private readonly session: CallSession) {
    this.follow();
    this.stop = session.subscribe(() => this.follow());
  }

  /** The room as the call says it is now. */
  private follow(): void {
    const s = this.session.getSnapshot();
    if (s.phase === 'ended') { this.set({ connection: 'ended', endReason: 'ended-by-host' }); return; }
    const last = s.transcript.at(-1);
    const who = last ? s.participants.find((p) => p.person.email === last.speaker?.person?.email) : undefined;
    if (who && this.speaking?.id !== `${who.id}:${last?.id ?? ''}`) {
      this.speaking = { id: `${who.id}:${last?.id ?? ''}`, until: Date.now() + SPEAKING_MS };
      if (this.quiet) clearTimeout(this.quiet);
      this.quiet = setTimeout(() => this.follow(), SPEAKING_MS + 50);
    }
    const now = Date.now();
    const people: RoomView['people'] = {};
    for (const p of s.participants) {
      people[p.id] = {
        mic: true, micSid: `TR_mic_${p.seat}`, camSid: null, screenSid: null, screenSound: null,
        speaking: !!this.speaking && this.speaking.id.startsWith(`${p.id}:`) && this.speaking.until > now
      };
    }
    this.set({ people });
  }

  private set(patch: Partial<RoomView>): void {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }

  getSnapshot = (): RoomView => this.view;
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  startAudio(): Promise<void> { this.set({ audioBlocked: false }); return Promise.resolve(); }
  /** No camera or screen is ever sent, so there's nothing to show in an element. */
  attach(): () => void { return () => undefined; }
  playOnly(): void { /* Everyone in the script is in the same part of the call. */ }
  heard(): { identity: string; track: MediaStreamTrack }[] { return []; }
  muteShare(): void { /* No share in the script has sound. */ }
  send(): void { /* Nobody else's browser is in the room to hear it. */ }
  receive(): () => void { return () => undefined; }
  leave(): Promise<void> {
    this.stop();
    if (this.quiet) clearTimeout(this.quiet);
    this.set({ connection: 'ended', endReason: 'left' });
    return Promise.resolve();
  }
}

export const openRoom: typeof Real.openRoom = (session: CallSession, _media: LocalMedia) => Promise.resolve(new ScriptedRoom(session));
