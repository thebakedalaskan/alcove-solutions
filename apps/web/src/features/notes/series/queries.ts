/*
 * Series: what carries over from one call to the next, from the notes you have, and into a call by its link; and scheduling
 * the next call after one, which starts a series when it isn't in one.
 */
import { errorCode, type Series } from '@alcove/api';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callsChanged } from '~/features/calls/list/queries';
import { api } from '~/lib/api';
import { weekOn } from '~/lib/time';
import { noteKeys } from '../queryKeys';

export const seriesQueries = {
  /** What carries over in a series, from the notes you have; put together fresh each time it's asked for. */
  series: (id: string) => queryOptions({ queryKey: noteKeys.series(id), queryFn: () => api.series.get(id), retry: false }),
  /**
   * What carries over into a call, for someone signed in, by its link: null when nothing can. Read again every minute
   * while it's on screen, and whenever the page comes back into view: a note someone stops having goes from here too,
   * however long the call has been open. A session that ended elsewhere is just another way of having nothing here:
   * thrown, it would send them out of their call to sign in, and a call doesn't need one.
   */
  callSeries: (code: string) => queryOptions({
    queryKey: noteKeys.callSeries(code),
    queryFn: () => api.calls.series(code).catch((e: unknown) => { if (errorCode(e) === 'unauthenticated') return null; throw e; }),
    retry: false, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true
  })
};

/**
 * What carries over into a call, while `on`. A read that fails keeps the last answer, as queries do, which would keep
 * showing what someone may not read any more: once the server says so, there's nothing. A dropped connection changes nothing.
 */
export function useCallSeries(code: string, on: boolean): Series | null {
  const r = useQuery({ ...seriesQueries.callSeries(code), enabled: on });
  const refused = r.error !== null && ['forbidden', 'not-found'].includes(errorCode(r.error));
  return refused ? null : r.data ?? null;
}

/** Schedules the next call after a call (starting its series if it isn't in one): the same clock time here, a week on. */
export function useScheduleNext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { meetingId: string }) => api.meetings.scheduleNext(v.meetingId, weekOn((await api.meetings.get(v.meetingId)).startsAt)),
    // The call's notes say which series they're in now.
    onSuccess: () => { callsChanged(qc); void qc.invalidateQueries({ queryKey: noteKeys.notes }); }
  });
}
