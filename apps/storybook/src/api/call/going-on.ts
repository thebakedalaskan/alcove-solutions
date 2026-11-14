/* The calls you've left that go on, kept with the world until you join one again (`joinCall`, scripted-call.ts). */
import type { CallState, Person, TranscriptLine } from '@alcove/api';
import type { World } from '../../world/world';
import { current } from '../state';
import type { Line, Present } from './script';

/**
 * A call you left that goes on without you, as the server keeps it: the same call and note, how long it's been going, who's still
 * in it, what was said while you were there, how it's captured, whoever you left hosting, and the pass you left with.
 */
export interface GoingOn {
  callId: string;
  noteId: string;
  startedAt: string;
  /** When you first came in: the script's times count from then. */
  began: number;
  here: Present[];
  heard: { line: Line; id: string; at: number }[];
  transcript: TranscriptLine[];
  capture: CallState['capture'];
  notes: CallState['notes'];
  standIn: Person | null;
  pass: string;
}
/** The calls you've left that go on, by their link, and the timer for the end their script still has: kept with the world. */
const goingOn = new WeakMap<World, Map<string, { call: GoingOn; ends: ReturnType<typeof setTimeout> | null }>>();
export function goingOnIn(w: World): Map<string, { call: GoingOn; ends: ReturnType<typeof setTimeout> | null }> {
  const known = goingOn.get(w);
  if (known) return known;
  const fresh = new Map<string, { call: GoingOn; ends: ReturnType<typeof setTimeout> | null }>();
  goingOn.set(w, fresh);
  return fresh;
}
/** Whatever the last story left going stops: no call it left ends in the next story's world. */
export function forgetGoingOn(): void {
  const here = goingOnIn(current());
  for (const { ends } of here.values()) if (ends) clearTimeout(ends);
  here.clear();
}
