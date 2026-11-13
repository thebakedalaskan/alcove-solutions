/*
 * The calls' query keys: every call ahead, one call by its ID or its link, a link's card, and the calendar around them.
 * The calendar's keys are under `meetings`, so reading the calls again reads it too.
 */
import type { ISODate } from '@alcove/api';

export const callKeys = {
  meetings: ['meetings'] as const,
  upcoming: ['meetings', 'upcoming'] as const,
  byCode: (code: string) => ['meetings', 'code', code] as const,
  card: (code: string) => ['calls', 'card', code] as const,
  calendar: ['meetings', 'calendar'] as const,
  meeting: (id: string) => ['meetings', 'one', id] as const,
  busy: (emails: readonly string[], from: ISODate, to: ISODate) => ['meetings', 'busy', from, to, ...emails] as const,
  calendarRange: (from: ISODate, to: ISODate) => ['meetings', 'calendar', from, to] as const
};
