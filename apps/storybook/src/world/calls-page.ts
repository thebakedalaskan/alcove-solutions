/*
 * What the Calls page has beyond the busy afternoon: the calls other people asked Art to (Priya's roadmap review, which he
 * hasn't answered; Maya's pricing sync, which he has), the portfolio follow-up waiting for Jonas to pick a time, Diego asking
 * to move the Harbourline proposal, who has answered Art's own calls, and two more meetings on his Google Calendar, one he
 * runs. All made up.
 */
import type { CalendarEvent, Meeting, Rsvp } from '@alcove/api';
import type { World } from './world';
import { calendarEvent } from './build';
import { iso } from './clock';
import { INVITATIONS } from './invitations';
import { ART, DIEGO, KOFI, LENA } from './people';

/** Who answered what on Art's own calls, as their organizer sees it: everyone said yes but Diego, who asks to move the proposal. */
function answered(m: Meeting): Meeting {
  if (!m.isOrganizer) return m;
  const { yes, maybe, no } = m.rsvps;
  const said = (i: number): Rsvp | null => (i < yes ? 'yes' : i < yes + maybe ? 'maybe' : i < yes + maybe + no ? 'no' : null);
  const answers = m.guests.map((g, i) => ({ email: g.email, answer: said(i) }));
  if (m.id !== 'm-proposal') return { ...m, answers };
  return { ...m, answers, proposals: [{ email: DIEGO.email, startsAt: iso(1, 14, 0) }] };
}

/** On the calendar: Harbourline's weekly sync this evening, which Diego runs on Google Meet; and Art's own supplier check-in on Monday. */
export const CALENDAR_MEETINGS: readonly CalendarEvent[] = [
  calendarEvent({ id: 'e-harbourline', title: 'Harbourline weekly', startsAt: iso(0, 18, 0), minutes: 30, organizer: DIEGO, guests: [ART], meet: true }),
  calendarEvent({ id: 'e-supplier', title: 'Supplier check-in', startsAt: iso(5, 11, 0), minutes: 30, guests: [LENA, KOFI], meet: true })
];

/** The busy afternoon as Calls shows it: invitations, a call waiting for a time, a request to move, and more of the calendar. */
export function callsDay(w: World): void {
  w.meetings = [...w.meetings.map(answered), ...INVITATIONS.filter((m) => !w.meetings.some((x) => x.id === m.id))];
  w.calendar = { ...w.calendar, events: [...w.calendar.events, ...CALENDAR_MEETINGS].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
}
