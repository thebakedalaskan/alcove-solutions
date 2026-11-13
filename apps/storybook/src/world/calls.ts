/*
 * Art's calls and calendar on the demo day, as the canvas's Home and Team boards tell them: the afternoon of a busy
 * Wednesday (a design sync at 17:30 with Priya and Kofi), the same morning a few minutes before the design review, his
 * calendar on his first day, once it's connected, and a week with nobody but him on anything. All made up.
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
/**
 * The rest of the calendar: a meeting someone else runs on Google Meet, and Art's own focus blocks, with nobody else on them,
 * which Home's Upcoming counts at its foot and lists only when asked.
 */
export function busyEvents(): CalendarEvent[] {
  return [
    calendarEvent({ id: 'e-focus-thu', title: 'Focus time', startsAt: iso(1, 18, 15), minutes: 240 }),
    calendarEvent({ id: 'e-product', title: 'Product sync', startsAt: iso(2, 10, 0), minutes: 30, organizer: INES, guests: [ART], meet: true }),
    calendarEvent({ id: 'e-focus-mon', title: 'Focus time', startsAt: iso(5, 18, 15), minutes: 240 })
  ];
}

/**
 * A week with nobody else on anything: Art's own time, from tonight to next Tuesday. Home's Upcoming counts these rather than
 * listing them, and lists them, quieter, when he asks.
 */
export function ownWeekEvents(): CalendarEvent[] {
  return [
    calendarEvent({ id: 'e-own-gym-wed', title: 'Gym', startsAt: iso(0, 19, 0), minutes: 60 }),
    calendarEvent({ id: 'e-own-plan-thu', title: 'Write the Q4 plan', startsAt: iso(1, 9, 0), minutes: 120 }),
    calendarEvent({ id: 'e-own-lunch', title: 'Lunch', startsAt: iso(1, 12, 30), minutes: 60 }),
    calendarEvent({ id: 'e-own-gym-thu', title: 'Gym', startsAt: iso(1, 19, 0), minutes: 60 }),
    calendarEvent({ id: 'e-own-dentist', title: 'Dentist', startsAt: iso(2, 16, 30), minutes: 45 }),
    calendarEvent({ id: 'e-own-market', title: 'Farmers market', startsAt: iso(3, 10, 0), minutes: 90 }),
    calendarEvent({ id: 'e-own-run', title: 'Long run', startsAt: iso(4, 8, 0), minutes: 90 }),
    calendarEvent({ id: 'e-own-board', title: 'Prep for the board', startsAt: iso(5, 9, 0), minutes: 120 }),
    calendarEvent({ id: 'e-own-gym-mon', title: 'Gym', startsAt: iso(5, 19, 0), minutes: 60 }),
    calendarEvent({ id: 'e-own-plan-tue', title: 'Write the Q4 plan', startsAt: iso(6, 9, 0), minutes: 120 }),
    calendarEvent({ id: 'e-own-chairs', title: 'Pick up the new chairs', startsAt: iso(6, 15, 0), minutes: 45 }),
    calendarEvent({ id: 'e-own-gym-tue', title: 'Gym', startsAt: iso(6, 19, 0), minutes: 60 })
  ];
}

/**
 * Art's own calendar on his first day, once it's connected: meetings set up elsewhere, with other people on them. He set up
 * the intro with Harbourline himself, on Google Meet, so it can move to Alcove.
 */
export function firstDayEvents(): CalendarEvent[] {
  return [
    calendarEvent({ id: 'e-first-sync', title: 'Design sync', startsAt: iso(0, 17, 30), minutes: 30, organizer: PRIYA, guests: [ART, KOFI], meet: true }),
    calendarEvent({ id: 'e-first-intro', title: 'Intro with Harbourline', startsAt: iso(1, 11, 0), minutes: 30, guests: [DIEGO, LENA], meet: true }),
    calendarEvent({ id: 'e-first-maya', title: '1:1 with Maya', startsAt: iso(1, 15, 30), minutes: 30, organizer: MAYA, guests: [ART] }),
    calendarEvent({ id: 'e-first-product', title: 'Product sync', startsAt: iso(2, 10, 0), minutes: 30, organizer: KOFI, guests: [ART], meet: true }),
    calendarEvent({ id: 'e-first-standup', title: 'Team standup', startsAt: iso(5, 9, 0), minutes: 20, organizer: PRIYA, guests: [ART, KOFI, MAYA], meet: true })
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
