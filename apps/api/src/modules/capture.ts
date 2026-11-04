/*
 * What a call captures (docs: Calls and recordings › What's captured): how its sealed state keeps it, the one gate
 * every capturing path goes through, the stretches with nothing captured, and the capture state as each person
 * sees it. Only the organizer changes it (calls.ts): notes on and off, pause and resume, and shared screens read
 * for the notes.
 */
import { CaptureDevicePartSchema, type AudioSegment, type CaptureActor, type CaptureDevicePart, type CaptureGap, type CaptureMode, type CapturePart, type CaptureState, type NotesRequest } from '@alcove/api';
import { z } from 'zod';
import { ConflictError } from '../errors';

/** off: notes off. on: capturing. paused: notes on, and the organizer holding every kind of capture until they resume. */
export const CaptureStatus = z.enum(['off', 'on', 'paused']);
export type CaptureStatus = z.infer<typeof CaptureStatus>;
/**
 * One change to what the call captures: when (seconds since the call started), what it became, who did it (the
 * call's schedule, at the start, or the organizer) and the recording's segment then (the one starting, or the one
 * that just ended), so a gap can be placed where it falls in the recording.
 */
export const CaptureChange = z.object({ at: z.number(), status: CaptureStatus, by: z.enum(['schedule', 'organizer']), segment: z.number() });
export type CaptureChange = z.infer<typeof CaptureChange>;
/**
 * Someone's ask for notes: the latest one of each person (the same across their reconnections), when they asked
 * (ms), and whether it's still open or the organizer said yes (notes came on) or no.
 */
export const NotesAsk = z.object({ id: z.string(), person: z.string(), at: z.number(), state: z.enum(['asking', 'accepted', 'declined']) });
export type NotesAsk = z.infer<typeof NotesAsk>;

/** What the organizer's browser can say it can't capture now, kept in the call's sealed state. */
export const CapturePartName = CaptureDevicePartSchema;

/**
 * The organizer having shared screens read for the notes, or stopping it, `at` seconds into the call. Turning notes off
 * stops it too, at the same moment.
 */
export const ScreenChange = z.object({ at: z.number(), on: z.boolean() });
export type ScreenChange = z.infer<typeof ScreenChange>;

/** The paths that capture something, or send what was captured to the AI. */
export type CapturePath = 'audio' | 'speech' | 'screen' | 'captions' | 'catch-up' | 'ask';
/**
 * What the gate needs to know about a call: whether it's live, notes, the note and recording, whether shared screens
 * are read (`screens`), and for a frame, whether whoever shares it is in a breakout room (`inRoom`), which stays out.
 */
export interface Capturing { live: boolean; status: CaptureStatus; noteId: string | null; recordingId: string | null; screens: boolean; inRoom?: boolean | undefined }

/**
 * The capture gate: whether `path` may capture into this call, or send its transcript to the AI, right now. Every
 * such path asks here first (calls.ts: audio pieces, speech clips, shared-screen frames, captions, catch-up and
 * questions). Audio, speech and frames need notes on; frames also need shared screens read, and never come from a
 * breakout room. Captions, catch-up and questions need notes to have been on. While notes are paused nothing goes
 * anywhere. Whatever arrives once capture is paused or off is refused (409), whoever sends it; what got through here
 * before stays. Returns the note and recording to capture into.
 */
export function mayCapture(call: Capturing, path: CapturePath, context: Record<string, string | number | null>): { noteId: string; recordingId: string } {
  const ctx = { ...context, path, notes: call.status, screens: call.screens ? 'on' : 'off' };
  if (!call.live) throw new ConflictError(path === 'catch-up' || path === 'ask' ? 'This call has ended. Its notes have everything.' : 'This call has ended.', { context: ctx });
  if (call.status === 'paused') throw new ConflictError('Notes are paused. Nothing is recorded, transcribed or sent to the AI until the organizer resumes.', { context: ctx });
  const captures = path === 'audio' || path === 'speech' || path === 'screen';
  if (captures && call.status !== 'on') throw new ConflictError('Notes aren’t on right now.', { context: ctx });
  if (path === 'screen' && !call.screens) throw new ConflictError('Shared screens aren’t read for the notes right now.', { context: ctx });
  if (path === 'screen' && call.inRoom) throw new ConflictError('What’s shared in a breakout room stays in the room. It isn’t read for the notes.', { context: ctx });
  if (!call.noteId || !call.recordingId) throw new ConflictError('Notes haven’t been on in this call, so nothing has been transcribed.', { context: ctx });
  return { noteId: call.noteId, recordingId: call.recordingId };
}

/** A stretch of the call with nothing captured, in seconds since it started, and the segment it follows (null before anything was recorded). */
interface Stretch { kind: 'off' | 'paused'; from: number; to: number | null; after: number | null }
/** The stretches with nothing captured, oldest first: from the start until notes first came on, and every time they were off or paused. */
function stretches(history: CaptureChange[]): Stretch[] {
  const out: Stretch[] = [];
  let open: Omit<Stretch, 'to'> | null = { kind: 'off', from: 0, after: null };
  let wasOn = false;
  for (const h of history) {
    const kind = h.status === 'on' ? null : h.status;
    if (open && kind !== open.kind) {
      if (h.at > open.from) out.push({ ...open, to: h.at });
      open = null;
    }
    if (kind && !open) open = { kind, from: h.at, after: wasOn ? h.segment : null };
    if (h.status === 'on') wasOn = true;
  }
  if (open) out.push({ ...open, to: null });
  return out;
}

/**
 * The gaps as people see them: when each started and ended, and where it falls in the recording, at the end of the
 * segment it follows (the segments' recorded seconds, as transcript lines are placed). `end`, seconds since the call
 * started, closes one still going: the call ended then.
 */
export function gapsOf(history: CaptureChange[], startedAt: Date, segments: AudioSegment[], end?: number | undefined): CaptureGap[] {
  const when = (s: number) => new Date(startedAt.getTime() + s * 1000).toISOString();
  const through = (segment: number) => segments.filter((g) => g.index <= segment).reduce((n, g) => n + g.seconds, 0);
  return stretches(history).flatMap((g) => {
    const to = g.to ?? end ?? null;
    if (to !== null && to <= g.from) return [];
    return [{ kind: g.kind, from: when(g.from), to: to === null ? null : when(to), at: g.after === null ? 0 : through(g.after) }];
  });
}

/** A moment of the call (seconds since it started) as seconds into its recording, which runs only while notes are on. */
export function recorded(history: CaptureChange[], at: number, end: number): number {
  let total = 0;
  let onSince: number | null = null;
  for (const h of [...history, { at: end, status: 'off' as const }]) {
    if (h.status === 'on' && onSince === null) onSince = h.at;
    else if (h.status !== 'on' && onSince !== null) { total += Math.max(0, Math.min(at, h.at) - onSince); onSince = null; }
  }
  return total;
}

/** Asks for notes said yes to: notes came on, or were resumed. */
export const answered = (asks: NotesAsk[]): NotesAsk[] => asks.map((a) => (a.state === 'asking' ? { ...a, state: 'accepted' as const } : a));

type Part = 'recording' | 'transcript' | 'ai';
const PARTS: readonly Part[] = ['recording', 'transcript', 'ai'];
/**
 * What each kind of capture does under a status. Recording and the transcript follow notes; the notes model reads
 * what was transcribed for as long as there is some, so it stays on while notes are off once they've been on (catch-up,
 * questions, captions and the notes at the end still read it). Only a pause stops everything.
 */
function modes(status: CaptureStatus, everOn: boolean): Record<Part, CaptureMode> {
  return { recording: status, transcript: status, ai: status === 'off' && everOn ? 'on' : status };
}

/**
 * The capture state for one person. Each part says when it last changed and who changed it: `organizer` names them,
 * for people in the call; people asking to join get no name, no gaps and no asks. A part the organizer's browser says
 * it can't do is unavailable while notes are on, and so is everything when it can do neither. Shared screens are read
 * only once the organizer says so (`screens`), and then follow notes: on, paused with them, or off.
 */
export function stateFor(c: {
  status: CaptureStatus; history: CaptureChange[]; startedAt: Date; organizer: string | null; unavailable: CaptureDevicePart[];
  screens: { on: boolean; history: ScreenChange[] };
  gaps: CaptureGap[]; requests: NotesRequest[]; asked: CaptureState['asked'];
}): CaptureState {
  const when = (at: number) => new Date(c.startedAt.getTime() + at * 1000).toISOString();
  const actor = (by: CaptureChange['by']): CaptureActor => (by === 'schedule' ? { kind: 'schedule' } : { kind: 'organizer', ...(c.organizer ? { name: c.organizer } : {}) });
  const changed = new Map<Part, CaptureChange>();
  let before = modes('off', false);
  let everOn = false;
  for (const h of c.history) {
    if (h.status === 'on') everOn = true;
    const now = modes(h.status, everOn);
    for (const k of PARTS) if (now[k] !== before[k]) changed.set(k, h);
    before = now;
  }
  const current = modes(c.status, everOn);
  const cant = new Set(c.status === 'on' ? c.unavailable : []);
  const part = (k: Part): CapturePart => {
    const h = changed.get(k);
    return { mode: k !== 'ai' && cant.has(k) ? 'unavailable' : current[k], since: h ? when(h.at) : null, by: h ? actor(h.by) : null };
  };
  return {
    mode: cant.has('recording') && cant.has('transcript') ? 'unavailable' : c.status,
    recording: part('recording'), transcript: part('transcript'), ai: part('ai'), screen: screenPart(c, when, actor),
    gaps: c.gaps, requests: c.requests, asked: c.asked
  };
}

/**
 * Shared screens as people see them: off until the organizer turns them on (and off again when they, or notes, are
 * turned off); while on, they're on or paused with notes. The presenters' own browsers send frames, so the organizer's
 * browser not being able to record or listen doesn't change it. When and who is whichever change last made a
 * difference: the organizer's choice about screens, or notes being paused, resumed or turned off.
 */
function screenPart(c: { status: CaptureStatus; history: CaptureChange[]; screens: { on: boolean; history: ScreenChange[] } }, when: (at: number) => string, actor: (by: CaptureChange['by']) => CaptureActor): CapturePart {
  const events = [
    ...c.history.map((h) => ({ at: h.at, by: h.by, status: h.status, on: undefined })),
    ...c.screens.history.map((s) => ({ at: s.at, by: 'organizer' as const, status: undefined, on: s.on }))
  ].sort((a, b) => a.at - b.at);
  let status: CaptureStatus = 'off';
  let on = false;
  let mode: CaptureMode = 'off';
  let last: (typeof events)[number] | undefined;
  for (const e of events) {
    status = e.status ?? status;
    on = e.on ?? on;
    const now: CaptureMode = on ? status : 'off';
    if (now !== mode) { mode = now; last = e; }
  }
  // A choice the organizer made that changed nothing yet still says who made it (screens off while notes were off).
  const latest = c.screens.history.at(-1);
  if (!last && latest) return { mode: 'off', since: when(latest.at), by: actor('organizer') };
  return { mode: c.screens.on ? c.status : 'off', since: last ? when(last.at) : null, by: last ? actor(last.by) : null };
}
