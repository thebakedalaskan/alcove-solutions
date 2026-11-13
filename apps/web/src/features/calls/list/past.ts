/*
 * The calls that happened, as Calls lists them: by day, newest first (Earlier today, Yesterday, Earlier this week, Last week,
 * then the month), with what waits on you from each and how long each took.
 */
import { isAcceptedFollowUp, type Inbox, type NoteSummary } from '@alcove/api';
import { daysFromToday, hm, noteGroup, shortDay, weekday } from '~/lib/time';

/** A day's group of calls that happened: today's are "Earlier today", this week's "Earlier this week". */
export function pastGroup(iso: string, now: Date): string {
  const g = noteGroup(iso, now);
  return g === 'Today' ? 'Earlier today' : g === 'This week' ? 'Earlier this week' : g;
}

/** Calls that happened, by their day's group, in the order they come. */
export function pastGroups<T extends { startedAt: string }>(list: readonly T[], now: Date): { label: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const n of list) {
    const g = pastGroup(n.startedAt, now);
    groups.set(g, [...(groups.get(g) ?? []), n]);
  }
  return [...groups].map(([label, rows]) => ({ label, rows }));
}

/** When a call was, in its row: the time today and yesterday, the weekday earlier this week, then the date. */
export function pastWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  const ago = -daysFromToday(at, now);
  if (ago <= 1) return hm(at);
  return noteGroup(iso, now) === 'This week' ? weekday(at).slice(0, 3) : shortDay(at);
}

/** How long it took: "20 min", "1 h 12 min". */

/** What waits on you from a call, as Home counts it: decisions to confirm, and follow-ups for you. */
export function waitingIn(inbox: Inbox | undefined, noteId: string): { decide: number; follow: number } {
  return {
    decide: inbox?.decisions.filter((d) => d.noteId === noteId).length ?? 0,
    follow: inbox?.followUps.filter((a) => a.noteId === noteId && isAcceptedFollowUp(a)).length ?? 0
  };
}

/** Recorded in the room, or shared with you afterwards: the rail's two kinds of calls that happened. */
export const inTheRoom = (n: NoteSummary): boolean => n.kind === 'room';
export const sharedWithYou = (n: NoteSummary): boolean => n.received?.role === 'shared';
