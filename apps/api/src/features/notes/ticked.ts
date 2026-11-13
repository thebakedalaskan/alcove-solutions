/*
 * What was ticked in a call's live notes (features/calls/notes/live-notes.ts), kept in its note until the notes are written,
 * and the follow-ups those notes are written with, what was ticked done.
 */
import { ACCEPTED_FOLLOW_UP, ChangerSchema, type ActionItem, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import { id128 } from '../../keys/crypto';

/**
 * A follow-up someone ticked during the call, kept in the note until its notes are written: its ID, which is how the
 * notes model's answer finds it, its words, the lines behind it, the breakout room it was in (null for the main room),
 * and who ticked it and when.
 */
export const Ticked = z.object({ by: ChangerSchema, at: z.string(), id: z.string(), text: z.string(), owner: z.string().optional(), due: z.string().optional(), lines: z.array(z.string()), room: z.string().nullable() });
export type Ticked = z.infer<typeof Ticked>;

/**
 * Follow-ups as written for a part of a note, with what was ticked in that part of the call done. `said` is which tick
 * the notes model says each written follow-up is, by their IDs. A tick nothing was said to be is added as it was said,
 * done, at the lines behind it: someone ticked it, and a wrong follow-up marked done would be worse.
 */
export function doneInNotes(actions: ActionItem[], ticks: Ticked[], said: ReadonlyMap<string, string>, lines: TranscriptLine[]): ActionItem[] {
  if (!ticks.length) return actions;
  const change = (t: Ticked): ActionItem['changes'][number] => ({ by: t.by, at: t.at, what: 'done' });
  const found = new Set<string>();
  const written = actions.map((a): ActionItem => {
    const t = ticks.find((x) => x.id === said.get(a.id));
    if (!t) return a;
    found.add(t.id);
    return a.done ? a : { ...a, review: 'accepted', done: true, changes: [...a.changes, change(t)] };
  });
  const added = ticks.filter((t) => !found.has(t.id)).map((t): ActionItem => {
    const behind = lines.filter((l) => t.lines.includes(l.id));
    const at = behind[0]?.at;
    return { ...ACCEPTED_FOLLOW_UP, id: id128(), text: t.text, ...(t.owner ? { owner: { name: t.owner } } : {}), takenOn: false, ...(t.due ? { due: t.due } : {}), ...(at === undefined ? {} : { at }), lines: behind.map((l) => l.id), against: [], done: true, changes: [change(t)], from: null };
  });
  return added.length ? [...written, ...added].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY)) : written;
}
