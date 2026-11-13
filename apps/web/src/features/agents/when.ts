/*
 * When, for an agent: when it was last used, and when its access ends. Short under its window ("4 min ago", "Ends
 * tomorrow"), a little longer in its popover ("Used 4 min ago", "Its access ends tomorrow").
 */
import type { AgentConnection } from '@alcove/api';
import { capital } from '~/lib/words';
import { agoLabel, dayMonth, daysFromToday, weekday } from '~/lib/time';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Access that ends within this long says so, in caution. */
const ENDING = 3 * DAY;
/** Never used, and connected this recently: it's just connected, not unused. */
const JUST = 10 * MINUTE;

/** Whether its access ends within three days. */
export const ending = (c: AgentConnection, now: number): boolean => Date.parse(c.expiresAt) - now < ENDING;
/** "today", "tomorrow" or the day it ends, short ("Fri") or long ("on Friday"). */
function endsOn(c: AgentConnection, now: number, long: boolean): string {
  const at = new Date(c.expiresAt);
  const days = daysFromToday(at, new Date(now));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return long ? `on ${weekday(at)}` : weekday(at).slice(0, 3);
}

/** The quiet line under its window. */
export function lineUnder(c: AgentConnection, now: number): string {
  if (ending(c, now)) return `Ends ${endsOn(c, now, false)}`;
  if (c.lastUsedAt) return capital(agoLabel(c.lastUsedAt, now, true));
  if (now - Date.parse(c.createdAt) < JUST) return c.kind === 'token' ? 'Just made' : 'Just connected';
  return 'Not used yet';
}

/** The line under its name in its popover. */
export function popLine(c: AgentConnection, now: number): string {
  if (ending(c, now)) return `Its access ends ${endsOn(c, now, true)}`;
  const used = c.lastUsedAt ? `used ${agoLabel(c.lastUsedAt, now, true)}` : 'not used yet';
  return c.kind === 'token' ? `Token · ${used}` : capital(used);
}

/** "Until 20 Nov" */
export const until = (c: AgentConnection): string => `Until ${dayMonth(new Date(c.expiresAt))}`;
