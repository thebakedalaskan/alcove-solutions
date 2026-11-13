/*
 * Scheduling on the Calls page, in the demo world: the calls the canvas moves and answers (Hiring sync, with Aiko asking to
 * move it to Friday at 11:00, and Kofi's Design crit, which waits for Art's answer), what the calendars of the people Art
 * meets most say, and the worlds a scheduling story opens on. A story changes the busy afternoon with these
 * (`changing(withHiringSync)`), as page.tsx's `changing` does.
 */
import type { Interval, Meeting } from '@alcove/api';
import type { World } from '.';
import { call } from './build';
import { iso } from './clock';
import { AIKO, ART, INES, KOFI, MAYA, PRIYA } from './people';

/** The days a scheduling story presses, as days after the demo day (Wednesday 4 November, 16:12 when a story opens). */
export const TODAY = 0;
export const THURSDAY = 1;
export const FRIDAY = 2;
export const MONDAY = 5;
export const TUESDAY = 6;
/** The Wednesday after: the team standup's next call. */
export const NEXT_WEDNESDAY = 7;
/** Thursday 12 November, in the week after the one scheduling opens on. */
export const NEXT_THURSDAY = 8;

/** Tomorrow at 10:00, Art's: Ines is going, Aiko hasn't answered, and has asked to move it to Friday at 11:00. */
export const HIRING_SYNC: Meeting = {
  ...call({ id: 'm-hiring-sync', title: 'Hiring sync', startsAt: iso(THURSDAY, 10, 0), minutes: 45, code: 'hrg-sync-ina', guests: [INES, AIKO], rsvps: { yes: 1 } }),
  answers: [{ email: INES.email, answer: 'yes' }, { email: AIKO.email, answer: null }],
  proposals: [{ email: AIKO.email, startsAt: iso(FRIDAY, 11, 0) }]
};

/** Tomorrow at 14:00, Kofi's: Art is invited, and hasn't answered. */
export const DESIGN_CRIT: Meeting = { ...call({ id: 'm-design-crit', title: 'Design crit', startsAt: iso(THURSDAY, 14, 0), minutes: 60, code: 'dsn-crit-kfo', organizer: KOFI, guests: [ART, PRIYA] }), rsvp: null, proposals: [] };

/** The busy afternoon with Hiring sync on it, waiting on Art: a request to move. */
export const withHiringSync = (w: World): void => { w.meetings = [...w.meetings.filter((m) => m.id !== HIRING_SYNC.id), structuredClone(HIRING_SYNC)]; };
/** The busy afternoon with Kofi's invitation on it. */
export const withDesignCrit = (w: World): void => { w.meetings = [...w.meetings.filter((m) => m.id !== DESIGN_CRIT.id), structuredClone(DESIGN_CRIT)]; };

/** Busy on `day` (days after the demo day) from one clock time to another, as `HH:MM`. */
function busy(day: number, from: string, to: string): Interval {
  const at = (time: string) => {
    const [h = 0, m = 0] = time.split(':').map(Number);
    return iso(day, h, m);
  };
  return { from: at(from), to: at(to) };
}

/**
 * What the calendars of the people Art meets most say, as busy time only (the stand-in never says what's in them), on the
 * days scheduling's stories press: tomorrow to the Tuesday after, and the next standup's Wednesday. On any other day they,
 * and everyone else at Vandelay, have the stand-in's own made-up working day (src/api/standin.ts).
 *
 * Tomorrow is drawn so the call follows who's added. Art is free from 09:00 (his Harbourline proposal is at 11:00 and his 1:1
 * with Maya at 15:30); with Priya, from 10:00; with Kofi, at 09:00; and the three of them together not until 14:00. At 12:00
 * only Priya is busy: the clash that Next free answers, with 14:00. Friday at 11:00, which Aiko asked for, suits Ines and
 * Aiko, and Kofi and Priya too. Nobody's calendar holds the calls a story moves, so none of them clashes where it is.
 */
export function calendars(): Record<string, Interval[]> {
  return {
    [PRIYA.email]: [
      busy(THURSDAY, '09:00', '10:00'), busy(THURSDAY, '12:00', '13:00'), busy(FRIDAY, '09:30', '10:30'), busy(FRIDAY, '14:00', '15:00'),
      busy(MONDAY, '10:00', '11:30'), busy(MONDAY, '13:00', '14:00'), busy(TUESDAY, '09:00', '10:00'), busy(TUESDAY, '15:00', '16:00'), busy(NEXT_WEDNESDAY, '11:00', '12:00')
    ],
    [KOFI.email]: [
      busy(THURSDAY, '10:00', '11:00'), busy(THURSDAY, '13:00', '14:00'), busy(FRIDAY, '09:00', '10:00'), busy(FRIDAY, '12:00', '13:00'), busy(FRIDAY, '16:00', '17:00'),
      busy(MONDAY, '09:00', '10:00'), busy(MONDAY, '11:00', '11:30'), busy(TUESDAY, '13:00', '14:30'), busy(NEXT_WEDNESDAY, '14:00', '15:00')
    ],
    [MAYA.email]: [
      busy(THURSDAY, '12:00', '13:30'), busy(FRIDAY, '10:00', '12:00'), busy(MONDAY, '14:00', '15:00'), busy(TUESDAY, '11:00', '12:00'), busy(NEXT_WEDNESDAY, '10:00', '11:00')
    ],
    [AIKO.email]: [
      busy(THURSDAY, '13:30', '15:00'), busy(FRIDAY, '09:00', '10:30'), busy(FRIDAY, '13:00', '14:00'), busy(MONDAY, '15:00', '16:00'), busy(TUESDAY, '10:00', '11:00')
    ],
    [INES.email]: [
      busy(THURSDAY, '12:00', '14:00'), busy(FRIDAY, '10:00', '10:30'), busy(FRIDAY, '15:00', '16:00'), busy(MONDAY, '09:00', '11:00'), busy(TUESDAY, '14:00', '15:00')
    ]
  };
}
