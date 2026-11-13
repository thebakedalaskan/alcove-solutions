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
      propose: (id, startsAt) => req(MeetingSchema, 'POST', `/meetings/${encodeURIComponent(id)}/propose`, { startsAt }),
      // Whose request it is goes in the body, so their address never appears in a URL.
      answerProposal: (id, email, answer) => req(MeetingSchema, 'POST', `/meetings/${encodeURIComponent(id)}/proposals/answer`, { email, answer }),
      scheduleNext: (id, startsAt) => req(MeetingSchema, 'POST', `/meetings/${encodeURIComponent(id)}/next`, { startsAt })
    },
    calendar: {
      get: (range) => req(CalendarSchema, 'GET', range ? `/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : '/calendar'),
      // Addresses go in the body so they never appear in URLs or access logs.
      busy: (emails, range) => req(BusySchema, 'POST', '/calendar/busy', { emails, ...range, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      connectUrl: (opts) => {
        const search = new URLSearchParams({ consent: '1' });
        if (opts?.back) search.set('back', opts.back);
        return `${base}/auth/google?${search}`;
      },
      disconnect: () => req(CalendarSchema, 'DELETE', '/calendar'),
      adopt: (eventId, notes) => req(MeetingSchema, 'POST', `/calendar/events/${encodeURIComponent(eventId)}/adopt`, notes ? { notes } : {})
    }
  };
}
