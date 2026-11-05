/*
 * What's known of when people are free, for picking a time: your own calendar and calls, and the calendars that can be
 * read. Nothing is kept. Whatever can't be read leaves the times on your own calendar, or on working hours alone.
 */
import type { Interval, Meeting } from '@alcove/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { q } from '~/lib/queries';
import { slotAt, suggestTimes, type Slot } from './times';

const DAY = 86_400_000;
/** How far ahead suggestions read: past ten working days, and inside what one read can ask for. */
const AHEAD_DAYS = 15;

const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate());

/** The calls and meetings you have, which count as busy even when no calendar says so. `except` is the call being moved. */
function useOwnBusy(except?: Meeting | undefined) {
  const calls = useQuery(q.upcoming()).data;
  const events = useQuery(q.calendar()).data?.events;
  return useMemo(() => {
    const mine = (calls ?? []).filter((m) => m.status !== 'ended' && !m.offer && m.rsvp !== 'no' && m.id !== except?.id).map((m) => ({ from: m.startsAt, to: m.endsAt, title: m.title }));
    const others = (events ?? []).map((e) => ({ from: e.startsAt, to: e.endsAt, title: e.title }));
    return [...mine, ...others];
  }, [calls, events, except?.id]);
}

/** Reads who's busy over a range, with your own calls in it however that goes. */
function useBusy(emails: readonly string[], range: { from: string; to: string }, except?: Meeting | undefined) {
  const read = useQuery(q.busy(emails, range));
  const own = useOwnBusy(except);
  const data = read.isError ? undefined : read.data;
  const moving = except ? (i: Interval) => i.from === except.startsAt && i.to === except.endsAt : () => false;
  const you = useMemo<Interval[]>(() => [...own, ...(data?.you ?? []).filter((i) => !moving(i))], [own, data]);
  const readable = useMemo(() => (data?.people ?? []).flatMap((p) => (p.busy ? [p.busy] : [])), [data]);
  return { loading: read.isPending, failed: read.isError, source: data?.source ?? 'none', you, own, readable };
}

/** Three good times, and what can be said about any other, for `emails` and `minutes`. */
export function useTimes(emails: readonly string[], minutes: number, except?: Meeting | undefined) {
  const [now] = useState(() => new Date());
  const range = useMemo(() => {
    const from = startOfDay(now);
    return { from: from.toISOString(), to: new Date(from.getTime() + AHEAD_DAYS * DAY).toISOString() };
  }, [now]);
  const busy = useBusy(emails, range, except);
  const slots = useMemo(() => suggestTimes({ now, minutes, you: busy.you, people: busy.readable }), [now, minutes, busy.you, busy.readable]);
  /* Guests the read said nothing about, or that it said can't be read. */
  const unknown = emails.length - busy.readable.length;
  return { now, ...busy, slots, unknown, slot: (at: Date): Slot => slotAt(at, minutes, busy.you, busy.readable) };
}

/** What's in the days of a week, for the grid: your own things by name, and when anyone else is busy. */
export function useWeek(emails: readonly string[], days: readonly Date[], except?: Meeting | undefined) {
  const first = days[0] ?? new Date();
  const last = days.at(-1) ?? first;
  const range = useMemo(() => ({ from: startOfDay(first).toISOString(), to: new Date(startOfDay(last).getTime() + DAY).toISOString() }), [first, last]);
  return useBusy(emails, range, except);
}
