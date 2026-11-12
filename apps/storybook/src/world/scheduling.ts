/*
 * Scheduling on the Calls page, in the demo world: the calls the canvas moves and answers (Hiring sync, with Aiko asking to
 * move it to 11:00, and Kofi's Design crit, which waits for Art's answer), and the worlds a scheduling story opens on.
 * A story changes the busy afternoon with these (`changing(withHiringSync)`), as page.tsx's `changing` does.
 */
import type { Meeting } from '@alcove/api';
import type { World } from '.';
import { call } from './build';
import { iso } from './clock';
import { AIKO, ART, INES, KOFI, PRIYA } from './people';

/** Tomorrow at 10:00, Art's: Ines is going, Aiko hasn't answered, and has asked to move it to 11:00. */
export const HIRING_SYNC: Meeting = {
  ...call({ id: 'm-hiring-sync', title: 'Hiring sync', startsAt: iso(1, 10, 0), minutes: 45, code: 'hrg-sync-ina', guests: [INES, AIKO], rsvps: { yes: 1 } }),
  answers: [{ email: INES.email, answer: 'yes' }, { email: AIKO.email, answer: null }],
  proposals: [{ email: AIKO.email, startsAt: iso(1, 11, 0) }]
};

/** Tomorrow at 14:00, Kofi's: Art is invited, and hasn't answered. */
export const DESIGN_CRIT: Meeting = { ...call({ id: 'm-design-crit', title: 'Design crit', startsAt: iso(1, 14, 0), minutes: 60, code: 'dsn-crit-kfo', organizer: KOFI, guests: [ART, PRIYA] }), rsvp: null, proposals: [] };

/** The busy afternoon with Hiring sync on it, waiting on Art: a request to move. */
export const withHiringSync = (w: World): void => { w.meetings = [...w.meetings.filter((m) => m.id !== HIRING_SYNC.id), structuredClone(HIRING_SYNC)]; };
/** The busy afternoon with Kofi's invitation on it. */
export const withDesignCrit = (w: World): void => { w.meetings = [...w.meetings.filter((m) => m.id !== DESIGN_CRIT.id), structuredClone(DESIGN_CRIT)]; };
