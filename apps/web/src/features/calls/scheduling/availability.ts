/*
 * Who's busy when, for picking a time: your calls and your calendar, and the calendars of the people invited that can be
 * read, over the stretches asked about. Nothing is kept. The call being moved isn't busy for itself: its own time is cut
 * out of everyone's, since Alcove put it on their calendars. The editor and the week both ask here, so they never
 * disagree; where a time goes is times.ts's.
 */
import type { Interval, Meeting } from '@alcove/api';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { q } from '~/lib/queries';
import { daysFromToday } from '~/lib/time';
import { AHEAD_DAYS, type Span } from './times';

/** A stretch to read, as the API takes it. */
export interface Range { from: string; to: string }
/** Something of yours, by its name: a call, or a meeting on your calendar. */
export interface Named extends Span { title: string }
/** Someone invited whose calendar can be read, and when they're busy. */
export interface Readable { email: string; busy: Span[] }
/** Who's busy when, as far as it's been read: everything of yours, the part of it with names, and everyone you can see. */
export interface Taken { you: readonly Span[]; own: readonly Named[]; readable: readonly Readable[] }

const midnightOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const rangeOf = (first: Date, days: number): Range => ({ from: first.toISOString(), to: new Date(first.getFullYear(), first.getMonth(), first.getDate() + days).toISOString() });
const spanOf = (i: Interval): Span => ({ from: Date.parse(i.from), to: Date.parse(i.to) });

/** From today, for as far as the soonest time is looked for. */
export const aheadOf = (today: Date): Range => rangeOf(midnightOf(today), AHEAD_DAYS);
/** Which seven days scheduling shows `at` on: a page is seven days on from today's, never one before it. */
export const pageOf = (at: Date, today: Date): number => Math.max(0, Math.floor(daysFromToday(at, today) / 7));
/** A page's seven days, as a stretch to read: the week reads the same, so one read serves both. */
export const pageRange = (page: number, today: Date): Range => {
  const first = midnightOf(today);
  return rangeOf(new Date(first.getFullYear(), first.getMonth(), first.getDate() + page * 7), 7);
};

/** How far on from `at` what's been read goes without a gap: looking for a free time stops there. */
export function readUntil(ranges: readonly Range[], at: number): number {
  let end = at;
  for (let grew = true; grew;) {
    grew = false;
    for (const r of ranges) {
      const to = Date.parse(r.to);
      if (Date.parse(r.from) <= end && to > end) { end = to; grew = true; }
    }
  }
  return end;
}

/** `list` with `cut` taken out of it: the call being moved isn't busy at its own time, whoever's calendar holds it. */
function without(list: readonly Span[], cut: Span | null): Span[] {
  if (!cut) return [...list];
  return list.flatMap((i) => (i.to <= cut.from || i.from >= cut.to ? [i] : [
    ...(i.from < cut.from ? [{ from: i.from, to: cut.from }] : []),
    ...(i.to > cut.to ? [{ from: cut.to, to: i.to }] : [])
  ]));
}

/** The same list as last time while everything in it is the same: what a list of reads gives a memo to depend on. */
function useSame<T>(list: readonly T[]): readonly T[] {
  const kept = useRef(list);
  if (kept.current.length !== list.length || kept.current.some((x, i) => x !== list[i])) kept.current = list;
  return kept.current;
}

/**
 * When you and the people invited (`emails`) are busy over `ranges`: `you` is everything of yours (your calendar and your
 * calls), `own` the part of it that has names, `readable` everyone whose calendar can be read, and `unreadable` the
 * addresses whose can't (all of them until it's read, and when it can't be). `loading` and `failed` are the first
 * stretch's; any others are pages further on, read as the call goes there. `except` is the call being moved.
 */
export function useBusy(emails: readonly string[], except: Meeting | undefined, ranges: readonly Range[]) {
  const reads = useQueries({ queries: ranges.map((r) => q.busy(emails, r)) });
  const calendars = useQueries({ queries: ranges.map((r) => q.calendarRange(r)) });
  const calls = useQuery(q.upcoming()).data;
  const busy = useSame(reads.map((r) => (r.isError ? undefined : r.data)));
  const events = useSame(calendars.map((r) => r.data?.events));
  const [first] = reads;
  const from = except ? Date.parse(except.startsAt) : null;
  const to = except ? Date.parse(except.endsAt) : null;
  const cut = useMemo(() => (from !== null && to !== null ? { from, to } : null), [from, to]);
  const moving = except?.id;
  const own = useMemo<Named[]>(() => [
    ...(calls ?? []).filter((m) => m.status !== 'ended' && !m.offer && m.rsvp !== 'no' && m.id !== moving).map((m) => ({ ...spanOf({ from: m.startsAt, to: m.endsAt }), title: m.title })),
    /* A calendar's copy of an Alcove call (a series' carries the series' link) is that call: among your calls, or the one being moved. */
    ...events.flatMap((list) => list ?? []).filter((e) => !e.alcoveCode).map((e) => ({ ...spanOf({ from: e.startsAt, to: e.endsAt }), title: e.title }))
  ], [calls, events, moving]);
  const you = useMemo<Span[]>(() => [...own, ...without(busy.flatMap((b) => (b?.you ?? []).map(spanOf)), cut)], [own, busy, cut]);
  const readable = useMemo<Readable[]>(() => {
    const by = new Map<string, Readable>();
    for (const b of busy) {
      for (const p of b?.people ?? []) {
        if (!p.busy) continue;
        const key = p.email.toLowerCase();
        const known = by.get(key) ?? { email: p.email, busy: [] };
        known.busy.push(...without(p.busy.map(spanOf), cut));
        by.set(key, known);
      }
    }
    return [...by.values()];
  }, [busy, cut]);
  const unreadable = useMemo(() => emails.filter((e) => !readable.some((p) => p.email.toLowerCase() === e.toLowerCase())), [emails, readable]);
  return { loading: first?.isPending ?? false, failed: first?.isError ?? false, you, own, readable, unreadable };
}

/**
 * Who's busy for a call from `from` to `to` (milliseconds): something of yours, by name when it has one; whether you're
 * busy at all; and the addresses of everyone else whose calendar says so.
 */
export function busyFor(t: Taken, from: number, to: number): { yours: string | undefined; busy: boolean; people: string[] } {
  const hit = (i: Span) => i.from < to && i.to > from;
  return { yours: t.own.find(hit)?.title, busy: t.you.some(hit), people: t.readable.flatMap((p) => (p.busy.some(hit) ? [p.email] : [])) };
}
