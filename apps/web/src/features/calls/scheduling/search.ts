/*
 * Where scheduling opens: on the Calls page, `/calls?schedule=new|move|again` (ScheduleParamsSchema), with the time it
 * starts from, the call it moves or follows, and what it brings. Who it's with goes in the history entry, never the
 * address: an address reaches the web server's logs. Every way into scheduling comes through `useOpenScheduling`.
 */
import { EmailParamSchema, MAX_GUESTS, ScheduleParamsSchema, type ScheduleMode, type ScheduleParams } from '@alcove/api';
import { defaultStringifySearch, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

/** The scheduling part of the Calls page's search: what its route's `validateSearch` takes in, nothing when there's none. */
export interface ScheduleSearch {
  schedule?: ScheduleMode | undefined;
  slot?: string | undefined;
  minutes?: number | undefined;
  meeting?: string | undefined;
  note?: string | undefined;
  bring?: string[] | undefined;
}

/** Reads the scheduling part of a search, for the Calls route's `validateSearch` to spread in: anything that doesn't read is left out. */
export function scheduleSearchOf(s: Record<string, unknown>): ScheduleSearch {
  const parsed = ScheduleParamsSchema.safeParse(s);
  if (!parsed.success) return {};
  const { schedule, slot, minutes, meeting, note, bring } = parsed.data;
  return { schedule, slot, minutes, meeting, note, bring };
}

/** The address scheduling opens at, every part that's set and nothing else. */
export function scheduleHref(p: ScheduleParams): string {
  const parts = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
  return `/calls${defaultStringifySearch(parts)}`;
}

const WithSchema = EmailParamSchema.array().max(MAX_GUESTS);
/** Who scheduling starts with, from the history entry: addresses, or nobody when what's there doesn't read. */
export function useScheduleWith(): string[] {
  const held = useRouterState({ select: (s) => s.location.state.scheduleWith });
  return useMemo(() => { const read = WithSchema.safeParse(held); return read.success ? read.data : []; }, [held]);
}

/**
 * Opens scheduling on the Calls page: a new call (with people, a time, or what it brings), moving a call (`meeting`), or
 * meeting again after one (`note`). From anywhere in the app.
 */
export function useOpenScheduling(): (p: ScheduleParams, people?: readonly string[]) => void {
  const navigate = useNavigate();
  return useCallback((p, people = []) => {
    void navigate({ href: scheduleHref(p), state: (s) => ({ ...s, scheduleWith: people.map((e) => e.toLowerCase()) }) });
  }, [navigate]);
}
