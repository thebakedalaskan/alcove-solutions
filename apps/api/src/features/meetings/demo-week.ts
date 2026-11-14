/*
 * A demo account's week (features/account/demo.ts signs demo accounts in): a made-up week of busy times around its calls,
 * worked out when they're asked for and stored nowhere.
 */
import { createHash } from 'node:crypto';
import { dayIn, zoned } from '../../platform/zones';

const MIN = 60_000;

/** A stretch of someone's day, in half hours after nine. */
interface Block { from: number; to: number }
const HALF_HOUR = 30 * MIN;
const NINE = 9 * 60;
/** Nine to five, in half hours. */
const WORKING_DAY = 16;

/**
 * One person's working day, the same every time for the same address and day: lunch some time from noon to two, and two
 * to four calls of half an hour to an hour and a half, none on top of another. Nobody else's day looks like it.
 */
function workday(email: string, day: string): Block[] {
  const seed = createHash('sha256').update(`alcove/demo-busy/v1\n${email}\n${day}`).digest();
  const roll = (i: number, sides: number) => (seed[i] ?? 0) % sides;
  const lunch = 6 + roll(0, 3);
  const taken: Block[] = [{ from: lunch, to: lunch + 1 + roll(1, 2) }];
  for (let i = 0, calls = 2 + roll(2, 3); i < calls; i++) {
    const length = 1 + roll(3 + 2 * i, 3);
    const from = roll(4 + 2 * i, WORKING_DAY - length + 1);
    if (!taken.some((b) => from < b.to && b.from < from + length)) taken.push({ from, to: from + length });
  }
  return taken.sort((a, b) => a.from - b.from);
}

/**
 * Reads sample people's busy times between two moments, in ms, each working day where the person asking is: Monday to
 * Friday, nine to five. Each person's week comes from their address alone, so it's the same on every read, whoever asks.
 */
export function sampleWeek(range: { from: Date; to: Date }, timeZone: string): (email: string) => { from: number; to: number }[] {
  const days: { day: string; nine: number }[] = [];
  const last = dayIn(range.to, timeZone);
  for (let day = dayIn(range.from, timeZone); day <= last; day = new Date(Date.parse(day) + 24 * 60 * MIN).toISOString().slice(0, 10)) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push({ day, nine: zoned(day, NINE, timeZone).getTime() });
  }
  return (email) => days.flatMap(({ day, nine }) => workday(email.trim().toLowerCase(), day).map((b) => ({ from: nine + b.from * HALF_HOUR, to: nine + b.to * HALF_HOUR })));
}
