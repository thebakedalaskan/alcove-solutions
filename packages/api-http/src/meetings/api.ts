import { type HttpTransport } from '../transport/http';
import { type AlcoveApi, BusySchema, CalendarSchema, type ChangeScope, MeetingSchema } from '@alcove/api';
import { z } from 'zod';

export function createMeetingsApi(t: HttpTransport): Pick<AlcoveApi, 'meetings' | 'calendar'> {
  const { base, req } = t;

  /** A change to a call in a series says how far it reaches in the query. */
  const inScope = (opts: { scope?: ChangeScope | undefined } | undefined) => (opts?.scope ? `?scope=${opts.scope}` : '');
  return {
    meetings: {
      upcoming: () => req(z.array(MeetingSchema), 'GET', '/meetings?range=upcoming'),
      past: () => req(z.array(MeetingSchema), 'GET', '/meetings?range=past'),
      get: (id) => req(MeetingSchema, 'GET', `/meetings/${encodeURIComponent(id)}`),
      byCode: (code) => req(MeetingSchema.nullable(), 'GET', `/calls/${encodeURIComponent(code)}/meeting`),
      create: (input) => req(MeetingSchema, 'POST', '/meetings', input),
      update: (id, input, opts) => req(MeetingSchema, 'PATCH', `/meetings/${encodeURIComponent(id)}${inScope(opts)}`, input),
      cancel: async (id, opts) => { await req(z.unknown(), 'DELETE', `/meetings/${encodeURIComponent(id)}${inScope(opts)}`); },
      answer: (id, answer) => req(MeetingSchema, 'POST', `/meetings/${encodeURIComponent(id)}/answer`, { answer }),
      scheduleNext: (id, startsAt) => req(MeetingSchema, 'POST', `/meetings/${encodeURIComponent(id)}/next`, { startsAt })
    },
    calendar: {
      get: () => req(CalendarSchema, 'GET', '/calendar'),
      // Addresses go in the body so they never appear in URLs or access logs.
      busy: (emails, range) => req(BusySchema, 'POST', '/calendar/busy', { emails, ...range, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      connectUrl: () => `${base}/auth/google?consent=1`,
      disconnect: () => req(CalendarSchema, 'DELETE', '/calendar'),
      adopt: (eventId, notes) => req(MeetingSchema, 'POST', `/calendar/events/${encodeURIComponent(eventId)}/adopt`, notes ? { notes } : {})
    }
  };
}
