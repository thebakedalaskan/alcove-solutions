/*
 * The Calls page's address: which place is open, and while the scheduler is, what it starts from (read by
 * features/calls/scheduling/search.ts, which every way into scheduling goes through). Nothing readable goes in it: the
 * words in the search line stay in the page (See all in the palette hands them over in history state), and someone the
 * list is narrowed to arrives after `#with=`, which never leaves the browser.
 */
import { IDSchema } from '@alcove/api';
import { scheduleSearchOf, type ScheduleSearch } from '../scheduling/search';

/** The places on the rail: every call, the calls ahead, the calls that happened and two kinds of them, the week, and the series. */
export const VIEWS = ['all', 'soon', 'past', 'week', 'room', 'shared', 'series'] as const;
export type CallsView = (typeof VIEWS)[number];

/** The page's search params, as the route has them: the place that's open, and the scheduler's while it's open. */
export interface CallsSearch extends ScheduleSearch {
  view?: CallsView | undefined;
  /** A series of calls, by its ID: it's open on the sheet. */
  series?: string | undefined;
}

const SeriesParam = IDSchema.min(1).max(64);

/** The address's params, each read on its own: one that doesn't parse is as if it weren't there. */
export function readCallsSearch(s: Record<string, unknown>): CallsSearch {
  const series = SeriesParam.safeParse(s['series']);
  return { view: VIEWS.find((v) => v === s['view']), series: series.success ? series.data : undefined, ...scheduleSearchOf(s) };
}
