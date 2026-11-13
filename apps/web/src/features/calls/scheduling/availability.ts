/*
 * What's known of when people are free, for picking a time: your own calendar and calls, and the calendars that can be
 * read. Nothing is kept. Whatever can't be read leaves the times on your own calendar, or on working hours alone.
 */
import type { Interval, Meeting } from '@alcove/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { q } from '~/lib/queries';
import { AHEAD_DAYS } from './times';

const DAY = 86_400_000;

const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate());

/** Something of yours at a time, by its name: a call, or a meeting on your calendar. */
export interface Yours extends Interval { title: string }
/** Someone invited whose calendar can be read, and when they're busy. */
export interface Readable { email: string; busy: Interval[] }

/** The calls and meetings you have, which count as busy even when no calendar says so. `except` is the call being moved. */
function useOwnBusy(except?: Meeting | undefined): Yours[] {
  const calls = useQuery(q.upcoming()).data;
  const events = useQuery(q.calendar()).data?.events;
  return useMemo(() => {
    const mine = (calls ?? []).filter((m) => m.status !== 'ended' && !m.offer && m.rsvp !== 'no' && m.id !== except?.id).map((m) => ({ from: m.startsAt, to: m.endsAt, title: m.title }));
    const others = (events ?? []).filter((e) => !(except && e.alcoveCode === except.code)).map((e) => ({ from: e.startsAt, to: e.endsAt, title: e.title }));
    return [...mine, ...others];
  }, [calls, events, except]);
}

/**
 * When you and the people invited (`emails`) are busy, from today for as far as times are looked for: `you` is everything
 * of yours (your calendar and your calls), `own` the part of it that has names, `readable` everyone whose calendar can be
 * read, and `unreadable` the addresses whose can't (all of them until it's read, and when it can't be).
 */
export function useTimes(emails: readonly string[], except?: Meeting | undefined) {
  const [now] = useState(() => new Date());
  const range = useMemo(() => {
    const from = startOfDay(now);
    return { from: from.toISOString(), to: new Date(from.getTime() + AHEAD_DAYS * DAY).toISOString() };
  }, [now]);
  const read = useQuery(q.busy(emails, range));
  const own = useOwnBusy(except);
  const data = read.isError ? undefined : read.data;
  const you = useMemo<Interval[]>(() => {
    const moving = (i: Interval) => !!except && i.from === except.startsAt && i.to === except.endsAt;
    return [...own, ...(data?.you ?? []).filter((i) => !moving(i))];
  }, [own, data, except]);
  const readable = useMemo<Readable[]>(() => (data?.people ?? []).flatMap((p) => (p.busy ? [{ email: p.email, busy: p.busy }] : [])), [data]);
  const unreadable = useMemo(() => emails.filter((e) => !readable.some((p) => p.email.toLowerCase() === e.toLowerCase())), [emails, readable]);
  return { now, loading: read.isPending, failed: read.isError, source: data?.source ?? 'none', you, own, readable, unreadable };
}
