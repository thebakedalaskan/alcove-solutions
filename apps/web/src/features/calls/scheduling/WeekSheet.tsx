/*
 * The week while scheduling, beside the editor on one sheet: seven days from today, a page at a time (never before today's).
 * Your own calls and meetings neutral, other people's busy time hatched and labelled with whose it is (never what), the
 * hours outside the working day greyed, the past veiled, and the call being made solid with its grip, or the times offered
 * to a guest, numbered. Pointing at a free time says who's free then; pressing it, dragging the call or dragging across free
 * time moves the call there, and holding the call at the edge of the days carries it into the next week. Moving a call,
 * where it is now is dashed. The week follows the call: moved to a time on another week, the week turns to it; out of the
 * hours in view, they scroll to it.
 */
import type { Meeting } from '@alcove/api';
import { CallsWeek, CallsWeekHead, type CallsWeekBlock, type CallsWeekBusy, type CallsWeekCall, type CallsWeekDay, type CallsWeekFree, type CallsWeekSpan } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useNow } from '~/lib/live';
import { sameEmail } from '~/lib/people';
import { callQueries } from '~/features/calls/list/queries';
import { noteQueries } from '~/features/notes/queries';
import { calendarQueries } from './queries';
import { daysSpan, hm, longDay, shortDay, weekday } from '~/lib/time';
import { joined } from '~/lib/words';
import { busyFor, pageOf, pageRange, useBusy } from './availability';
import { LONGEST_CALL, WORK_FROM, WORK_TO } from './times';

const DAY_MINUTES = 1440;

const dayAfter = (d: Date, days = 1) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
/** Where a moment is on its day, as a clock on the wall says it, in minutes. */
const wallMinute = (at: Date) => at.getHours() * 60 + at.getMinutes();

/** A stretch of time cut into the days it falls on, each part in minutes from its day's midnight. */
function onDays(dates: readonly Date[], from: Date, to: Date): CallsWeekSpan[] {
  return dates.flatMap((d, day) => {
    const a = d.getTime();
    const b = dayAfter(d).getTime();
    const s = Math.max(from.getTime(), a);
    const e = Math.min(to.getTime(), b);
    return e > s ? [{ day, start: wallMinute(new Date(s)), end: e >= b ? DAY_MINUTES : wallMinute(new Date(e)) }] : [];
  });
}

/** A call on the week while scheduling: the one being made, or one of the times offered to a guest. */
export interface WeekCall {
  /** When it starts. */
  at: Date;
  /** How long it is on its day: the scheduler has already stopped it at midnight. */
  minutes: number;
  /** Letting a guest pick: its number, 1 to 3. Absent for the one call. */
  n?: number | undefined;
  /** The one the week moves: always the one call. */
  active: boolean;
  /** Letting a guest pick: left out. */
  off?: boolean | undefined;
  /** It clashes with you, or with someone whose calendar can be read. */
  clash?: boolean | undefined;
}

export interface WeekSheetProps {
  /** Everyone invited besides you, by address, with their first names. */
  guests: readonly { email: string; name: string }[];
  calls: readonly WeekCall[];
  /** The call's name, on its block. */
  title: string;
  /** Moving a call: where it is now. */
  was?: { at: Date; minutes: number } | undefined;
  /** The call being moved, which isn't shown as one of your calls. */
  except?: Meeting | undefined;
  /** The active call pressed or dropped somewhere: it starts there, and the scheduler keeps its length. */
  onMove: (at: Date) => void;
  /** Free time dragged across: the active call takes it. */
  onRange: (at: Date, minutes: number) => void;
  /**
   * The grip dragged, or Shift and ↑ or ↓: the active call's new length, in minutes. Without it the call has no grip: asking
   * to move someone else's call asks for a start.
   */
  onLength?: ((minutes: number) => void) | undefined;
  /** Letting a guest pick: an offered time that isn't the active one, pressed. */
  onSelect: (index: number) => void;
}

export function WeekSheet({ guests: given, calls, title, was, except, onMove, onRange, onLength, onSelect }: WeekSheetProps) {
  const now = useNow();
  /* The same people keep the same list, so who's free isn't worked out again for every half hour on every keystroke. */
  const guestKey = given.map((g) => `${g.email} ${g.name}`).join('\n');
  const guests = useMemo(() => given, [guestKey]);
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  /* Which seven days: a page is a week on from today's, and the week turns to the call when it moves to another. */
  const active = calls.find((c) => c.active);
  const [page, setPage] = useState(() => pageOf(active?.at ?? was?.at ?? today, today));
  const startsAt = active ? active.at.getTime() : null;
  const [followed, setFollowed] = useState(startsAt);
  if (startsAt !== followed) {
    setFollowed(startsAt);
    if (active && pageOf(active.at, today) !== page) setPage(pageOf(active.at, today));
  }
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => dayAfter(new Date(midnight), page * 7 + i)), [midnight, page]);
  const first = dates[0] ?? new Date(midnight);
  const last = dates.at(-1) ?? first;
  const span = daysSpan(first, last);
  /* The same stretch the editor reads for a call on this page, so one read serves both. */
  const range = useMemo(() => pageRange(page, new Date(midnight)), [page, midnight]);
  const ranges = useMemo(() => [range], [range]);
  const dayOf = (at: Date) => dates.findIndex((d) => d.toDateString() === at.toDateString());
  const at = (day: number, minute: number) => { const d = dates[day] ?? first; return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minute); };

  const emails = useMemo(() => guests.map((g) => g.email), [guests]);
  const taken = useBusy(emails, except, ranges);
  const events = useQuery(calendarQueries.calendarRange(range)).data?.events;
  const upcoming = useQuery(callQueries.upcoming()).data;
  const notes = useQuery(noteQueries.notes()).data;

  const days = useMemo<CallsWeekDay[]>(() => dates.map((d, i) => ({
    weekday: weekday(d).slice(0, 3), date: d.getDate(), label: longDay(d), short: page === 0 && i < 2 ? (i === 0 ? 'Today' : 'Tomorrow') : shortDay(d),
    today: page === 0 && i === 0, weekend: d.getDay() === 0 || d.getDay() === 6
  })), [dates, page]);

  /* Yours: the calls that happened, your Alcove calls and the times held for a guest, and your calendar's meetings. */
  const blocks = useMemo<CallsWeekBlock[]>(() => {
    const out: CallsWeekBlock[] = [];
    const put = (id: string, from: Date, to: Date, name: string, kind: CallsWeekBlock['kind']) => {
      for (const s of onDays(dates, from, to)) out.push({ id: `${id}-${s.day}`, title: name, kind, ...s });
    };
    for (const n of notes ?? []) if (n.status !== 'recording') put(`n-${n.id}`, new Date(n.startedAt), new Date(Date.parse(n.startedAt) + Math.max(15 * 60, n.duration) * 1000), n.title, 'past');
    for (const m of upcoming ?? []) {
      if (m.id === except?.id || m.status === 'ended') continue;
      if (m.offer) for (const t of m.offer.times) put(`h-${m.id}-${t}`, new Date(t), new Date(Date.parse(t) + Date.parse(m.endsAt) - Date.parse(m.startsAt)), `Held: ${m.title}`, 'hold');
      else put(`m-${m.id}`, new Date(m.startsAt), new Date(m.endsAt), m.title, m.isOrganizer || m.rsvp ? 'soon' : 'invite');
    }
    for (const e of events ?? []) if (!e.alcoveCode) put(`e-${e.id}`, new Date(e.startsAt), new Date(e.endsAt), e.title, 'cal');
    return out;
  }, [dates, notes, upcoming, events, except?.id]);

  /* Who's busy when, as availability says it: a calendar that can't be read says nothing. Everyone you can see, by first name. */
  const seen = useMemo(() => guests.flatMap((g) => {
    const p = taken.readable.find((r) => sameEmail(r, g));
    return p ? [{ email: g.email, name: g.name, busy: p.busy }] : [];
  }), [guests, taken.readable]);

  /* Everyone else's busy time from now on, merged into bands, each saying whose it is. */
  const bands = useMemo<CallsWeekBusy[]>(() => {
    const nowAt = page === 0 ? wallMinute(new Date(now)) : 0;
    const parts = seen.flatMap((g, who) => g.busy.flatMap((i) => onDays(dates, new Date(i.from), new Date(i.to))
      .flatMap((s) => (s.day === 0 && s.end <= nowAt ? [] : [{ ...s, start: s.day === 0 ? Math.max(s.start, nowAt) : s.start, who }]))));
    const out: (CallsWeekSpan & { who: Set<number> })[] = [];
    for (const s of parts.sort((a, b) => a.day - b.day || a.start - b.start)) {
      const prev = out.at(-1);
      if (prev && prev.day === s.day && s.start <= prev.end) { prev.end = Math.max(prev.end, s.end); prev.who.add(s.who); }
      else out.push({ day: s.day, start: s.start, end: s.end, who: new Set([s.who]) });
    }
    return out.map((b) => ({ day: b.day, start: b.start, end: b.end, who: seen.filter((_, i) => b.who.has(i)).map((g) => g.name).join(', ') }));
  }, [seen, dates, page, Math.floor(now / 60_000)]);

  /** Who's free at a time on the week, as the outline under the pointer and each half hour say it. */
  const { you, own, readable } = taken;
  const nameOf = useMemo(() => new Map(seen.map((g) => [g.email.toLowerCase(), g.name])), [seen]);
  const free = useCallback((day: number, start: number, end: number): CallsWeekFree => {
    const d = dates[day] ?? first;
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, start).getTime();
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, end).getTime();
    const b = busyFor({ you, own, readable }, from, to);
    if (b.yours) return { text: b.yours, busy: true };
    if (b.busy) return { text: 'You’re busy', busy: true };
    const them = b.people.flatMap((e) => { const name = nameOf.get(e.toLowerCase()); return name === undefined ? [] : [name]; });
    if (them.length) return { text: `${joined(them)} busy`, busy: true };
    if (!seen.length) return { text: guests.length ? 'Free on your calendar' : 'Free', busy: false };
    if (seen.length < guests.length) return { text: 'Free for everyone you can see', busy: false };
    return { text: seen.length === 1 ? 'Both free' : `All ${seen.length + 1} free`, busy: false };
  }, [dates, first, you, own, readable, seen.length, nameOf, guests.length]);

  const weekCalls = useMemo<CallsWeekCall[]>(() => calls.map((c) => {
    const day = dayOf(c.at);
    const start = wallMinute(c.at);
    return { day, start, end: Math.min(DAY_MINUTES, start + c.minutes), active: c.active, n: c.n, off: c.off, clash: c.clash, title: c.n === undefined ? title : undefined };
  }), [calls, dates, title]);
  const activeCall = weekCalls.find((c) => c.active);
  const wasDay = was ? dayOf(was.at) : -1;
  const wasSpan = was && wasDay >= 0 ? { day: wasDay, start: wallMinute(was.at), end: Math.min(DAY_MINUTES, wallMinute(was.at) + was.minutes), label: `Now ${hm(was.at)}` } : null;

  return (
    <section className="cw-sheet" aria-label={span}>
      <CallsWeekHead title={span} canGoBack={page > 0} onBefore={() => setPage((p) => Math.max(0, p - 1))} onAfter={() => setPage((p) => p + 1)}
        onToday={page > 0 ? () => setPage(0) : undefined} />
      <CallsWeek mode="schedule" label="Pick a time" days={days} blocks={blocks} now={{ day: -7 * page, minute: wallMinute(today) }}
        work={{ from: WORK_FROM * 60, to: WORK_TO * 60 }} busy={bands} calls={weekCalls} was={wasSpan} free={free} canGoBack={page > 0} longest={LONGEST_CALL}
        onPick={(day, start) => onMove(at(day, start))}
        onRange={(day, start, end) => onRange(at(day, start), end - start)}
        onResize={onLength && ((end) => { if (activeCall) onLength(end - activeCall.start); })}
        onSelect={onSelect}
        onTurn={(step) => setPage((p) => Math.max(0, p + step))} />
    </section>
  );
}
