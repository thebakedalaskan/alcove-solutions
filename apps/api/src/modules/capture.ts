/*
 * What a call captures (docs: Calls and recordings › What's captured): how its sealed state keeps it, the one gate
 * every capturing path goes through, the stretches with nothing captured, and the capture state as each person
 * sees it. Only the organizer changes it (calls.ts): notes on and off, pause and resume.
 */
import type { AudioSegment, CaptureGap, CapturePart, CaptureState, NotesRequest } from '@alcove/api';
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

/** The paths that capture something, or send what was captured to the AI. */
export type CapturePath = 'audio' | 'speech' | 'captions' | 'catch-up' | 'ask';
/** What the gate needs to know about a call. */
export interface Capturing { live: boolean; status: CaptureStatus; noteId: string | null; recordingId: string | null }

/**
 * The capture gate: whether `path` may capture into this call, or send its transcript to the AI, right now. Every
 * such path asks here first (calls.ts: audio pieces, speech clips, captions, catch-up and questions). Audio and
 * speech need notes on. Captions, catch-up and questions need notes to have been on. While notes are paused nothing
 * goes anywhere. Whatever arrives once capture is paused or off is refused (409), whoever sends it; what got through
 * here before stays. Returns the note and recording to capture into.
 */
export function mayCapture(call: Capturing, path: CapturePath, context: Record<string, string | number | null>): { noteId: string; recordingId: string } {
  const ctx = { ...context, path, notes: call.status };
  if (!call.live) throw new ConflictError(path === 'catch-up' || path === 'ask' ? 'This call has ended. Its notes have everything.' : 'This call has ended.', { context: ctx });
  if (call.status === 'paused') throw new ConflictError('Notes are paused. Nothing is recorded, transcribed or sent to the AI until the organizer resumes.', { context: ctx });
  const captures = path === 'audio' || path === 'speech';
  if (captures && call.status !== 'on') throw new ConflictError('Notes aren’t on right now.', { context: ctx });
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

/**
 * The capture state for one person. `organizer` names whoever changed it, for people in the call; people asking to
 * join get no name, no gaps and no asks. Recording, the transcript and the notes model move together; screens are
 * always off, since nothing reads them.
 */
export function stateFor(c: {
  status: CaptureStatus; history: CaptureChange[]; startedAt: Date; organizer: string | null;
  gaps: CaptureGap[]; requests: NotesRequest[]; asked: CaptureState['asked'];
}): CaptureState {
  const last = c.history.at(-1);
  const since = last ? new Date(c.startedAt.getTime() + last.at * 1000).toISOString() : null;
  const by: CapturePart['by'] = !last ? null : last.by === 'schedule' ? { kind: 'schedule' } : { kind: 'organizer', ...(c.organizer ? { name: c.organizer } : {}) };
  const part: CapturePart = { mode: c.status, since, by };
  return { mode: c.status, recording: part, transcript: part, ai: part, screen: { mode: 'off', since: null, by: null }, gaps: c.gaps, requests: c.requests, asked: c.asked };
}
