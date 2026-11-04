/* What a call captures, in words: the stretches nothing was captured in, and who changed it last. */
import { firstName, type CaptureGap, type CaptureState } from '@alcove/api';
import { hm } from './time';

/**
 * What's captured where you are: the call's capture, or in a breakout room, the room's (it captures at most what the
 * call does, and nothing while the organizer has paused it). Asks for notes stay the call's.
 */
export const captureHere = (c: CaptureState): CaptureState =>
  (c.room ? { ...c, mode: c.room.mode, recording: c.room.recording, transcript: c.room.transcript, ai: c.room.ai, screen: c.room.screen, gaps: c.room.gaps } : c);

/**
 * "Paused 10:02–10:05", "Notes off 10:10–10:12", "Organizer offline 10:20–10:21" (their browser was out of the call),
 * "Paused at 10:02" for a short one, or "Paused since 10:02" while it lasts.
 */
export function gapLabel(g: CaptureGap): string {
  const what = g.kind === 'paused' ? 'Paused' : g.kind === 'offline' ? 'Organizer offline' : 'Notes off';
  if (!g.to) return `${what} since ${hm(g.from)}`;
  const from = hm(g.from);
  const to = hm(g.to);
  return from === to ? `${what} at ${from}` : `${what} ${from}–${to}`;
}

/**
 * Where something placed in the recording (a stretch with nothing captured, a shared screen changing) falls among
 * transcript lines: before the first line said at or after it.
 */
export function gapsBefore<G extends { at: number }, L extends { at: number }>(gaps: G[], lines: L[], index: number): G[] {
  const line = lines[index];
  const prev = lines[index - 1];
  if (!line) return [];
  return gaps.filter((g) => g.at <= line.at && (prev === undefined || g.at > prev.at));
}
/** What comes after the last line, such as notes paused right now. */
export const gapsAfter = <G extends { at: number }, L extends { at: number }>(gaps: G[], lines: L[]): G[] => {
  const last = lines.at(-1);
  return last ? gaps.filter((g) => g.at > last.at) : gaps;
};

/**
 * Who changed what the call captures and when: "Paused by Art · 10:02", "Resumed by Art · 10:05", or "On since
 * 10:00, as scheduled". People asking to join aren't told names, so it says "the organizer". In a breakout room,
 * which is never recorded, it's the transcript that changed.
 */
export function changedLine(c: CaptureState, organizer: string): string | null {
  const p = c.room ? c.transcript : c.recording;
  if (!p.since || !p.by) return null;
  const at = hm(p.since);
  if (p.by.kind === 'schedule') return `On since ${at}, as scheduled`;
  const who = p.by.name ? firstName(p.by.name) : organizer;
  // Back on where a pause ended: it was resumed.
  const resumed = c.gaps.some((g) => g.kind === 'paused' && g.to === p.since);
  const did = c.mode === 'paused' ? 'Paused' : c.mode === 'off' ? 'Turned off' : resumed ? 'Resumed' : 'Turned on';
  return `${did} by ${who} · ${at}`;
}
