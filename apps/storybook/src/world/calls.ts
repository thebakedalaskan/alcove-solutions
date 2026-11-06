/*
 * Art's calls and calendar on the demo day, as the canvas's Home and Team boards tell them: the afternoon of a busy
 * Wednesday (a design sync at 17:30 with Priya and Kofi), and the same morning a few minutes before the design review.
 * All made up.
 */
import type { CalendarEvent, Meeting } from '@alcove/api';
import { iso } from './clock';
import { calendarEvent, call } from './build';
import { AIKO, ART, DIEGO, INES, KOFI, LENA, MAYA, PRIYA } from './people';

const weekly = { rule: { every: 'week' as const, weeks: 1 as const, days: [3] }, until: '2027-06-30', timeZone: 'Europe/London' };

/** Wednesday afternoon: what's still to come this week. */
export function busyCalls(): Meeting[] {
  return [
    call({ id: 'm-sync', title: 'Design sync', startsAt: iso(0, 17, 30), minutes: 30, code: 'dsn-sync-kpr', guests: [PRIYA, KOFI], rsvps: { yes: 2 } }),
    call({ id: 'm-proposal', title: 'Harbourline proposal', startsAt: iso(1, 11, 0), minutes: 45, code: 'hbr-prop-dgo', guests: [PRIYA, DIEGO], rsvps: { yes: 1 } }),
    call({ id: 'm-one', title: '1:1 with Maya', startsAt: iso(1, 15, 30), minutes: 30, code: 'one-maya-art', guests: [MAYA], notes: 'off', rsvps: { yes: 1 } }),
    call({ id: 'm-standup', title: 'Team standup', startsAt: iso(7, 9, 0), minutes: 20, code: 'std-upwk-art', guests: [PRIYA, KOFI, MAYA], rsvps: { yes: 2, maybe: 1 }, seriesId: 's-standup', repeat: weekly })
  ];
}
/** The rest of the calendar: a meeting someone else runs on Google Meet, and Art's own focus blocks, which Home leaves out. */
export function busyEvents(): CalendarEvent[] {
  return [
    calendarEvent({ id: 'e-focus-thu', title: 'Focus time', startsAt: iso(1, 18, 15), minutes: 240 }),
    calendarEvent({ id: 'e-product', title: 'Product sync', startsAt: iso(2, 10, 0), minutes: 30, organizer: INES, guests: [ART], meet: true }),
    calendarEvent({ id: 'e-focus-mon', title: 'Focus time', startsAt: iso(5, 18, 15), minutes: 240 })
  ];
}

/** Wednesday morning at 10:26, the design review four minutes away and the day still ahead. */
export function soonCalls(): Meeting[] {
  return [
    call({ id: 'm-review', title: 'Design review', startsAt: iso(0, 10, 30), minutes: 45, code: 'dsn-revw-pka', guests: [PRIYA, KOFI, AIKO], rsvps: { yes: 3 } }),
    call({ id: 'm-pricing', title: 'Pricing follow-up', startsAt: iso(0, 11, 30), minutes: 30, code: 'prc-foll-mlx', guests: [MAYA, LENA], rsvps: { yes: 1 } }),
    call({ id: 'm-intro', title: 'Intro with Harbourline', startsAt: iso(0, 14, 0), minutes: 30, code: 'hbr-intr-dgx', guests: [DIEGO], rsvps: { yes: 1 } }),
    call({ id: 'm-priya', title: '1:1 with Priya', startsAt: iso(0, 16, 30), minutes: 30, code: 'one-prya-art', guests: [PRIYA], rsvps: { yes: 1 }, seriesId: 's-priya', repeat: weekly })
  ];
}
