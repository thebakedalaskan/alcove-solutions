/*
 * Calls other people asked Art to, calls offering times to pick from, and a call on its way to this device, for the
 * stories of a scheduled call's card, a guest picking a time and moving a call here. All made up.
 */
import type { Meeting } from '@alcove/api';
import type { MoveSpec } from './world';
import { call } from './build';
import { iso } from './clock';
import { ANA, ART, JONAS, KOFI, LENA, MAYA, PRIYA } from './people';

const offering = (m: Meeting, times: string[]): Meeting => {
  const { calendarUrl: _onNoCalendar, ...rest } = m;
  return { ...rest, rsvp: null, offer: { times } };
};

/** Priya's roadmap review tomorrow morning: Art is invited and hasn't answered yet. */
export const ROADMAP: Meeting = { ...call({ id: 'm-roadmap-review', title: 'Roadmap review', startsAt: iso(1, 10, 0), minutes: 45, code: 'rdm-revw-prr', organizer: PRIYA, guests: [ART, KOFI, MAYA], rsvps: { yes: 1 } }), rsvp: null };

/** Maya's pricing sync on Friday, every week: Art said yes. */
export const PRICING_NEXT: Meeting = call({
  id: 'm-pricing-next', title: 'Pricing sync', startsAt: iso(2, 15, 0), minutes: 30, code: 'prc-sync-mya', organizer: MAYA, guests: [ART, LENA], rsvps: { yes: 2 },
  seriesId: 's-pricing', repeat: { rule: { every: 'week', weeks: 1, days: [5] }, until: '2027-03-26', timeZone: 'Europe/London' }
});

/** Art offered Jonas three times for a portfolio follow-up: it has no time until Jonas picks one from its link. */
export const FOR_JONAS: Meeting = offering(call({ id: 'm-portfolio', title: 'Portfolio follow-up', startsAt: iso(1, 14, 0), minutes: 30, code: 'prt-folo-jns', guests: [JONAS] }), [iso(1, 14, 0), iso(2, 10, 30), iso(5, 16, 0)]);

/** Ana offered Art three times to walk through the contract: Art picks one from its link. */
export const FROM_ANA: Meeting = offering(call({ id: 'm-contract', title: 'Contract walkthrough', startsAt: iso(1, 9, 30), minutes: 45, code: 'cnt-walk-ana', organizer: ANA, guests: [ART] }), [iso(1, 9, 30), iso(2, 13, 0), iso(5, 11, 0)]);

/** Times Ana offered last week, all gone by now. */
export const PASSED: Meeting = offering(call({ id: 'm-contract-old', title: 'Contract walkthrough', startsAt: iso(-3, 9, 30), minutes: 45, code: 'cnt-past-ana', organizer: ANA, guests: [ART] }), [iso(-3, 9, 30), iso(-2, 13, 0)]);

/** What the calls Art is invited to add to the busy afternoon. */
export const INVITATIONS: readonly Meeting[] = [ROADMAP, PRICING_NEXT, FOR_JONAS, FROM_ANA, PASSED];

/** The design sync, on its way here from Art's laptop with the microphone on and the camera off. */
export const MOVING: MoveSpec = {
  claim: 'sbDesignSyncMoveClaim1', title: 'Design sync', organizerName: ART.name, you: { name: ART.name, role: 'host' }, media: { mic: true, cam: false }
};
