/*
 * The week the welcome page's team finds a time in: 9 to 13 November 2026, 9:00 to 18:00 in London. Who stands on the
 * horizon, when each of them is busy (only that they are, never with what), and when everyone picked is free. The agent
 * books its call in the same week, at a time that's free here for the three of them.
 */
import type { CastId } from '~/features/examples/cast';

const MEMBERS = ['art', 'lena', 'maya', 'priya', 'kofi', 'aiko', 'sam'] as const satisfies readonly CastId[];
/** Someone the team can meet: everyone on the line who has joined. */
export type Member = (typeof MEMBERS)[number];
/** From and to, in hours from midnight. */
export type Span = readonly [number, number];

/** Along the horizon, left to right, with you in the middle. Invited people are empty arches; `far` ones step off on a phone. */
type OnLine = { kind: 'member'; id: Member; far: boolean } | { kind: 'invited'; name: string };
export const LINE: readonly OnLine[] = [
  { kind: 'invited', name: 'Tom' },
  { kind: 'member', id: 'lena', far: true },
  { kind: 'member', id: 'maya', far: false },
  { kind: 'member', id: 'priya', far: false },
  { kind: 'member', id: 'art', far: false },
  { kind: 'member', id: 'kofi', far: false },
  { kind: 'member', id: 'aiko', far: false },
  { kind: 'member', id: 'sam', far: true },
  { kind: 'invited', name: 'Zara' }
];

export const DAYS = [
  { day: 'Mon', date: '9 Nov' },
  { day: 'Tue', date: '10 Nov' },
  { day: 'Wed', date: '11 Nov' },
  { day: 'Thu', date: '12 Nov' },
  { day: 'Fri', date: '13 Nov' }
] as const;
export const OPENS = 9;
export const CLOSES = 18;

/** Each person's busy times, Monday to Friday. */
const BUSY: Record<Member, readonly (readonly Span[])[]> = {
  art: [[[9.5, 10.5], [13, 14]], [[9.5, 10.5], [15, 16]], [[9, 10], [14, 15.5]], [[11, 12], [13.5, 14.5]], [[9.5, 10], [12, 13]]],
  priya: [[[9, 10], [11, 12.5], [15, 16]], [[9, 10], [13, 15]], [[10, 12], [16, 17]], [[9, 11], [14, 15], [16.5, 17.5]], [[10, 11.5], [14, 16]]],
  kofi: [[[10, 11], [14, 15.5]], [[12.5, 13.5], [16, 17.5]], [[9.5, 11], [13, 14]], [[10, 11], [12, 13], [16, 17]], [[9, 10], [13, 14.5]]],
  aiko: [[[9, 9.5], [12, 13], [16, 18]], [[9.5, 10.5], [14, 15]], [[11, 12], [15, 16.5]], [[9, 10], [12.5, 13.5]], [[11, 12], [15, 17]]],
  maya: [[[10, 12]], [[9, 11], [15, 16]], [[13, 14.5]], [[10, 11.5], [15.75, 16.5]], [[9, 12]]],
  lena: [[[13, 15]], [[10, 12]], [[9, 10.5], [16, 17]], [[14, 14.75], [17, 18]], [[10, 11], [13, 14]]],
  sam: [[[9, 10], [15, 17]], [[12, 13]], [[10, 11], [14, 16]], [[9.5, 10.5], [16.5, 17.5]], [[9, 9.5], [11, 12]]]
};

export const busyOn = (who: Member, day: number): readonly Span[] => BUSY[who][day] ?? [];

/** The stretches of `day` when all of `people` are free, each at least `minutes` long, on the quarter hour. */
export function freeOn(people: readonly Member[], day: number, minutes: number): Span[] {
  const step = 0.25;
  const out: Span[] = [];
  let start: number | null = null;
  for (let t = OPENS; t <= CLOSES; t += step) {
    const busy = t >= CLOSES || people.some((who) => busyOn(who, day).some(([a, b]) => t < b && t + step > a));
    if (!busy && start === null) start = t;
    if (busy && start !== null) {
      if (t - start >= minutes / 60) out.push([start, t]);
      start = null;
    }
  }
  return out;
}

/** 9.5 → "9:30". */
export const clock = (h: number): string => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
