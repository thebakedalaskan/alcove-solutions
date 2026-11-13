/*
 * The calendar around your calls: your other events on Google Calendar, who's busy when, connecting it and letting it go,
 * and making one of your own events an Alcove call. Its keys are the calls' (features/calls/list/queryKeys.ts).
 */
import type { Calendar, CalendarRange, ISODate, NotesSetting } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callsChanged } from '~/features/calls/list/queries';
import { callKeys } from '~/features/calls/list/queryKeys';
import { api } from '~/lib/api';

export const calendarQueries = {
  /** Someone's other calendar events; refreshed every few minutes, since they change outside Alcove. */
  calendar: () => queryOptions({ queryKey: callKeys.calendar, queryFn: () => api.calendar.get(), staleTime: 60_000, refetchInterval: 3 * 60_000, retry: false }),
  /** When you and these people are busy. Nothing is kept: it's read when it's asked for, and a failed read is said plainly, not retried. */
  busy: (emails: readonly string[], range: { from: ISODate; to: ISODate }) => queryOptions({
    queryKey: callKeys.busy(emails, range.from, range.to), queryFn: () => api.calendar.busy([...emails], range), staleTime: 60_000, retry: false
  }),
  /** Your other calendar events between two times, at most 31 days apart: any week the Calls page or scheduling shows. */
  calendarRange: (range: CalendarRange) => queryOptions({
    queryKey: callKeys.calendarRange(range.from, range.to), queryFn: () => api.calendar.get(range), staleTime: 60_000, retry: false, placeholderData: (prev) => prev
  })
};

/**
 * Which of these people are busy right now, by lowercase address, as far as their calendars can be read: nobody is
 * "busy" whose calendar can't be. Read when it's asked for; a failed read just says nobody is.
 */
export const busyNow = (emails: string[]) => queryOptions({
  queryKey: ['calendar', 'busy-now', emails],
  queryFn: async (): Promise<ReadonlySet<string>> => {
    const now = new Date();
    const b = await api.calendar.busy(emails, { from: now.toISOString(), to: new Date(now.getTime() + 60_000).toISOString() });
    return new Set(b.people.filter((p) => p.busy?.some((i) => new Date(i.from) <= now && now < new Date(i.to))).map((p) => p.email.toLowerCase()));
  },
  staleTime: 60_000, retry: false, enabled: emails.length > 0
});

/**
 * Makes one of your own calendar events an Alcove call; an occurrence of a recurring event joins its series. The meeting
 * leaves the calendar's list at once, so it isn't listed beside its new call; the calendar is read again with the calls
 * (its key is under theirs), with the meeting's Alcove link.
 */
export function useAdoptEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { eventId: string; notes?: NotesSetting | undefined }) => api.calendar.adopt(v.eventId, v.notes),
    onSuccess: (_m, v) => {
      qc.setQueryData<Calendar>(callKeys.calendar, (c) => (c ? { ...c, events: c.events.filter((e) => e.id !== v.eventId) } : c));
      callsChanged(qc);
    }
  });
}
/** Where the browser goes to give Alcove access to Google Calendar; Google sends it back to Settings, or to Home. */
export const calendarConnectUrl = (opts?: { back?: '/home' | undefined }) => api.calendar.connectUrl(opts);
/** Forgets the Google connection; the calendar then asks for access again. */
export function useDisconnectCalendar() {
  const qc = useQueryClient();
  return useMutation({ networkMode: 'always', mutationFn: () => api.calendar.disconnect(), onSuccess: (cal) => { qc.setQueryData(callKeys.calendar, cal); } });
}
