/*
 * What the call captures: notes on, paused or off as the organizer says (and as their plan has room for), what the host's
 * browser can't hear, asks for notes, the model that writes them, and shares kept for the notes.
 */
import { AlcoveApiError, type CaptureDevicePart, type CaptureGap, type ScreenPiece } from '@alcove/api';
import { current, nextId } from '../state';
import { CallWithAttention } from './attention';
import { linkState, modelIsPrivate, part } from './script';

export abstract class CallWithCapture extends CallWithAttention {
  /** The host's browser can't hear the call: it records on (`records`), so only the transcript stops, or it can do neither. */
  protected cantHear(records: boolean): void {
    const at = new Date().toISOString();
    const s = this.getSnapshot();
    const by = s.capture.transcript.by;
    this.push({ ...s, capture: { ...s.capture, mode: records ? s.capture.mode : 'unavailable', transcript: part('unavailable', at, by), recording: records ? s.capture.recording : part('unavailable', at, by) } });
  }
  /** `limit`: notes went off because the organizer's notes or storage ran out, not because they turned them off. */
  protected capture(mode: 'on' | 'off' | 'paused', limit?: 'notes' | 'storage'): void {
    const at = new Date().toISOString();
    const s = this.getSnapshot();
    const by = { kind: 'organizer' as const, name: s.host.organizer.name };
    const was = s.capture.mode;
    const open = (g: CaptureGap) => (g.to === null ? { ...g, to: at } : g);
    const gaps: CaptureGap[] = mode === 'on' ? s.capture.gaps.map(open) : [...s.capture.gaps.map(open), { kind: mode === 'paused' ? 'paused' : 'off', from: at, to: null, at: s.elapsed }];
    const text = mode === 'on' ? (was === 'paused' ? 'The organizer resumed notes. Everyone here can see that.' : 'The organizer turned on notes. Everyone here can see that.')
      : mode === 'paused' ? 'The organizer paused notes. Nothing is recorded, transcribed or sent to the AI until they resume.' : 'The organizer turned off notes. What was written so far is kept.';
    const asked = s.capture.asked?.state === 'asking' && mode === 'on' ? { state: 'accepted' as const, at } : s.capture.asked;
    this.push({
      ...s,
      capture: {
        // Notes on again end a stop for the plan, as the server's limit is reset when they come on.
        ...s.capture, ...(limit ? { stopped: { reason: limit, at }, runningOut: null } : mode === 'on' ? { stopped: null, runningOut: null } : {}), mode, recording: part(mode, at, by), transcript: part(mode, at, by), ai: part(mode === 'off' && !s.notes.everOn ? 'off' : mode === 'off' ? 'on' : mode, at, by),
        screen: mode === 'off' ? part('off', at, by) : s.capture.screen, gaps, requests: mode === 'on' ? [] : s.capture.requests, asked
      },
      notes: { ...s.notes, segmentStartedAt: mode === 'on' && was !== 'on' ? at : s.notes.segmentStartedAt, everOn: s.notes.everOn || mode === 'on', noteId: s.notes.noteId ?? (mode === 'on' ? this.noteId : null), recording: mode === 'on' && was !== 'on' ? { ...s.notes.recording, segment: s.notes.recording.segment + (s.notes.everOn ? 1 : 0) } : s.notes.recording },
      // The banner over the call says why notes stopped, so no notice does.
      notices: limit ? s.notices : [...s.notices, { id: nextId('notice'), text, kind: 'notes' }]
    });
    linkState(this.meeting.code, (l) => ({ hostHere: true, standIn: null, locked: false, ended: false, ...l, capture: this.getSnapshot().capture }));
  }
  /**
   * As the server does (calls/notes/recording.ts › changeCapture): notes come on again only while the organizer's plan has notes and
   * room for them, and once they do, the stop is over. The organizer is you in the stand-in, so it's the world's plan.
   */
  setNotes(on: boolean): Promise<void> {
    const plan = current().plan;
    if (on && (plan.notes.stopped || plan.notes.minutesLeft <= 0)) return Promise.reject(new AlcoveApiError('plan-limit', 'Your notes for this period have run out. They start again when your plan renews.'));
    if (on && plan.over.storage) return Promise.reject(new AlcoveApiError('plan-limit', 'Your storage is full, so notes can’t be kept. Delete something, or move to a plan with more room.'));
    this.capture(on ? 'on' : 'off');
    return Promise.resolve();
  }
  pause(): Promise<void> { this.capture('paused'); return Promise.resolve(); }
  resume(): Promise<void> { this.capture('on'); return Promise.resolve(); }
  requestNotes(up: boolean): Promise<void> {
    const at = new Date().toISOString();
    this.change((s) => ({
      ...s,
      capture: {
        ...s.capture, asked: up ? { state: 'asking', at } : null,
        requests: up ? [...s.capture.requests.filter((r) => r.participantId !== this.me.id), { id: nextId('ask'), participantId: this.me.id, at }] : s.capture.requests.filter((r) => r.participantId !== this.me.id)
      }
    }));
    return Promise.resolve();
  }
  declineNotes(requestId: string): Promise<void> {
    this.change((s) => ({ ...s, capture: { ...s.capture, requests: s.capture.requests.filter((r) => r.id !== requestId) } }));
    return Promise.resolve();
  }
  setUnavailable(_parts: CaptureDevicePart[]): Promise<void> { return Promise.resolve(); }
  setModel(model: string | null): Promise<void> {
    this.change((s) => ({ ...s, capture: { ...s.capture, model, modelPrivate: modelIsPrivate(model) } }));
    return Promise.resolve();
  }
  /** A share starts: it's kept for the notes when you asked for that, and notes aren't off. */
  startShare(o: { notes: boolean }): Promise<{ share: string; keep: boolean }> {
    const share = nextId('share');
    const keep = o.notes && this.getSnapshot().capture.mode !== 'off';
    this.change((s) => ({ ...s, shares: [...s.shares, { id: share, participant: this.me.id, keep }] }));
    return Promise.resolve({ share, keep });
  }
  /** Pieces of a kept share's video go nowhere: the stand-in keeps no recordings. */
  appendScreen(_piece: ScreenPiece): Promise<void> { return Promise.resolve(); }
  shareEnded(share: string): Promise<void> {
    this.change((s) => ({ ...s, shares: s.shares.filter((x) => x.id !== share) }));
    return Promise.resolve();
  }
}
