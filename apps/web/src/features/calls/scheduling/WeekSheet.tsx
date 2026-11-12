/*
 * The week while scheduling, on the sheet beside the scheduler: your own calls and meetings dimmed, other people's busy
 * time hatched (never what it is), the hours outside the working day greyed, the suggested times glowing, and the call
 * being made solid, with a grip to drag where it ends. Pointing at a free time says who's free then; pressing it, or
 * dragging across it, moves the call there. Moving a call, where it is now is dashed.
 */
import type { Interval, Meeting } from '@alcove/api';
import { CallsWeek, IconButton, type CallsWeekBlock, type CallsWeekBusy, type CallsWeekDay, type CallsWeekKeyItem, type CallsWeekSuggestion } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { listNames } from '~/lib/people';
import { q } from '~/lib/queries';
import { dayMonth, longDay, weekday } from '~/lib/time';
import { WORK_FROM, WORK_TO, weekDays, weeksTo } from './times';

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The hours the week shows unless the call being made is outside them. */
const FROM = 8;
const TO = 19;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Hours from the start of `day` to `at`. */
const hoursInto = (day: Date, at: Date) => (at.getTime() - startOfDay(day).getTime()) / HOUR;

/** A stretch of time cut into the days of the week it falls in: what runs past midnight goes on into the next day. */
function onDays(days: readonly Date[], from: Date, to: Date): { day: number; start: number; end: number }[] {
  return days.flatMap((d, day) => {
    const start = startOfDay(d).getTime();
    const a = Math.max(from.getTime(), start);
    const b = Math.min(to.getTime(), start + DAY);
    return b > a ? [{ day, start: (a - start) / HOUR, end: (b - start) / HOUR }] : [];
  });
}

/** Overlapping stretches of one day as one, so a busy morning is one band however many calendars say so. */
function merged(spans: CallsWeekBusy[]): CallsWeekBusy[] {
  const out: CallsWeekBusy[] = [];
  for (const s of [...spans].sort((a, b) => a.day - b.day || a.start - b.start)) {
    const last = out.at(-1);
    if (last && last.day === s.day && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export interface WeekSheetProps {
  /** Everyone invited besides you, by address, with what to call them. */
  guests: readonly { email: string; name: string }[];
  /** The call being made, when it has a time; its length either way. */
  chosen: Date | null;
  minutes: number;
  title: string;
  /** The suggested times, glowing; letting a guest pick, which of them are ticked. */
  suggested: readonly Date[];
  offered: readonly Date[] | null;
  /** Letting a guest pick: what to call them. */
  picker?: string | undefined;
  /** Moving a call: where it is now. */
  was?: { at: Date; minutes: number } | undefined;
  /** The call being moved, which isn't shown as one of your calls. */
  except?: Meeting | undefined;
  /** No calendar is connected: only your Alcove calls are known. */
  noCalendar: boolean;
  onPick: (at: Date) => void;
  onRange: (at: Date, minutes: number) => void;
  onMinutes: (minutes: number) => void;
}

export function WeekSheet({ guests, chosen, minutes, title, suggested, offered, picker, was, except, noCalendar, onPick, onRange, onMinutes }: WeekSheetProps) {
  const [now] = useState(() => new Date());
  const weekOf = (at: Date | null | undefined) => (at ? Math.max(0, weeksTo(now, at)) : 0);
  const [page, setPage] = useState(() => weekOf(chosen ?? was?.at));
  /* The week turns to the call whenever it moves somewhere else, from a card or a time typed. */
  const [followed, setFollowed] = useState(chosen?.getTime() ?? null);
  if ((chosen?.getTime() ?? null) !== followed) {
    setFollowed(chosen?.getTime() ?? null);
    if (chosen) setPage(weekOf(chosen));
  }
  const dates = useMemo(() => weekDays(now, page), [now, page]);
  const first = dates[0] ?? now;
  const range = useMemo(() => ({ from: startOfDay(first).toISOString(), to: new Date(startOfDay(first).getTime() + 7 * DAY).toISOString() }), [first]);
  const emails = useMemo(() => guests.map((g) => g.email), [guests]);
  const busy = useQuery(q.busy(emails, range));
  const events = useQuery(q.calendarRange(range)).data?.events;
  const calls = useQuery(q.upcoming()).data;
  const notes = useQuery(q.notes()).data;

  const days: CallsWeekDay[] = dates.map((d) => ({
    weekday: weekday(d).slice(0, 3), date: d.getDate(), label: longDay(d), today: d.toDateString() === now.toDateString(), weekend: d.getDay() === 0 || d.getDay() === 6
  }));
  const dayOf = (at: Date) => dates.findIndex((d) => d.toDateString() === at.toDateString());
  const at = (day: number, hour: number) => { const d = dates[day] ?? now; return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hour), Math.round((hour % 1) * 60)); };

  const blocks = useMemo<CallsWeekBlock[]>(() => {
    const out: CallsWeekBlock[] = [];
    const put = (id: string, from: Date, to: Date, title: string, kind: CallsWeekBlock['kind']) => {
      for (const s of onDays(dates, from, to)) out.push({ id: `${id}-${s.day}`, title, kind, ...s });
    };
    for (const n of notes ?? []) if (n.status !== 'recording') put(`n-${n.id}`, new Date(n.startedAt), new Date(Date.parse(n.startedAt) + Math.max(15 * 60, n.duration) * 1000), n.title, 'past');
    for (const m of calls ?? []) {
      if (m.id === except?.id || m.status === 'ended') continue;
      if (m.offer) for (const t of m.offer.times) put(`h-${m.id}-${t}`, new Date(t), new Date(Date.parse(t) + Date.parse(m.endsAt) - Date.parse(m.startsAt)), `Held: ${m.title}`, 'hold');
      else put(`m-${m.id}`, new Date(m.startsAt), new Date(m.endsAt), m.title, m.isOrganizer || m.rsvp ? 'soon' : 'invite');
    }
    for (const e of events ?? []) if (!e.alcoveCode) put(`e-${e.id}`, new Date(e.startsAt), new Date(e.endsAt), e.title, 'cal');
    return out;
  }, [dates, notes, calls, events, except?.id]);

  /* Who's busy when, by address; you, from your calendar and calls. A calendar that can't be read says nothing. */
  const read = busy.isError ? undefined : busy.data;
  const theirs = useMemo(() => new Map((read?.people ?? []).flatMap((p) => (p.busy ? [[p.email.toLowerCase(), p.busy] as const] : []))), [read]);
  const yours = useMemo<Interval[]>(() => [...(read?.you ?? []).filter((i) => !(except && i.from === except.startsAt && i.to === except.endsAt)), ...(calls ?? []).filter((m) => !m.offer && m.id !== except?.id && m.status !== 'ended' && m.rsvp !== 'no').map((m) => ({ from: m.startsAt, to: m.endsAt }))], [read, calls, except]);
  const bands = useMemo(() => merged([...theirs.values()].flatMap((list) => list.flatMap((i) => onDays(dates, new Date(i.from), new Date(i.to))))), [theirs, dates]);
  const readable = guests.filter((g) => theirs.has(g.email.toLowerCase()));
  const clash = (list: readonly Interval[], from: number, to: number) => list.some((i) => Date.parse(i.from) < to && Date.parse(i.to) > from);

  /** Who's free at a time on the week, as the ghost under the pointer says it. */
  const ghostNote = (day: number, start: number, end: number) => {
    const [from, to] = [at(day, start).getTime(), at(day, end).getTime()];
    const busyNow = readable.filter((g) => clash(theirs.get(g.email.toLowerCase()) ?? [], from, to)).map((g) => g.name);
    const you = clash(yours, from, to);
    if (you || busyNow.length) return `${listNames([...(you ? [{ name: 'You', email: '' }] : []), ...busyNow.map((name) => ({ name, email: '' }))])} busy`;
    if (!guests.length || !readable.length) return guests.length ? 'Free on your calendar' : 'Free';
    if (readable.length < guests.length) return 'Free for everyone you can see';
    return guests.length === 1 ? 'Both free' : `All ${guests.length + 1} free`;
  };

  const length = minutes / 60;
  const pickDay = chosen && !offered ? dayOf(chosen) : -1;
  const pick = chosen && pickDay >= 0 ? { day: pickDay, start: hoursInto(dates[pickDay] ?? chosen, chosen), end: hoursInto(dates[pickDay] ?? chosen, chosen) + length, title } : null;
  const ticked = (t: Date) => offered?.some((o) => o.getTime() === t.getTime()) ?? false;
  const suggestions: CallsWeekSuggestion[] = suggested.flatMap((t) => {
    const day = dayOf(t);
    const d = dates[day];
    return d && (!offered || ticked(t)) ? [{ day, start: hoursInto(d, t), end: hoursInto(d, t) + length, ...(offered ? { ticked: true } : {}) }] : [];
  });
  const wasDay = was ? dayOf(was.at) : -1;
  const wasDate = dates[wasDay];
  const wasSpan = was && wasDate ? { day: wasDay, start: hoursInto(wasDate, was.at), end: hoursInto(wasDate, was.at) + was.minutes / 60, label: `Now ${was.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` } : null;
  /* The hours shown reach the call being made, wherever it's been put. */
  const from = Math.min(FROM, Math.floor(pick?.start ?? FROM), Math.floor(wasSpan?.start ?? FROM));
  const to = Math.max(TO, Math.ceil(pick?.end ?? TO), Math.ceil(wasSpan?.end ?? TO));

  const named = listNames(readable.map((g) => ({ name: g.name, email: g.email })));
  const or = named.replace(/ and ([^,]+)$/, ' or $1');
  const legend: CallsWeekKeyItem[] = [
    ...(readable.length ? [{ kind: 'busy' as const, label: `${named} busy` }] : []),
    ...(wasSpan ? [{ kind: 'was' as const, label: 'Where it is now' }] : []),
    ...(offered ? [{ kind: 'suggestion' as const, label: `Times ${picker ?? 'your guest'} can pick from` }]
      : suggestions.length ? [{ kind: 'suggestion' as const, label: noCalendar ? 'Open on your calendar' : !guests.length ? 'Free on your calendar' : guests.length === 1 ? 'Free for both of you' : 'Free for all of you' }] : []),
    ...(pick ? [{ kind: 'pick' as const, label: wasSpan ? 'Where it’s going' : 'This call' }] : [])
  ];
  const line = wasSpan || was ? (readable.length ? `Shaded when ${or} is busy. Dashed is where it is now.` : 'Dashed is where it is now.')
    : offered ? `${picker ?? 'Your guest'}’s calendar can’t be read, so only yours shows.`
      : noCalendar ? 'Only your Alcove calls show without a calendar.'
        : readable.length ? `Shaded when ${or} is busy. You see when, never what.`
          : guests.length ? 'Their calendars can’t be read, so only yours shows.' : 'Press a time, or drag across the week.';
  const heading = page === 0 ? 'This week' : page === 1 ? 'Next week' : `${dayMonth(first)} – ${dayMonth(dates.at(-1) ?? first)}`;
  const nowAt = days.findIndex((d) => d.today);

  return (
    <section className="sc-sheet" aria-label={heading}>
      <div className="sc-sheet-h">
        <div className="min-w-0">
          <h2>{heading}</h2>
          <p>{line}</p>
        </div>
        <span className="sc-wnav">
          <IconButton icon="left" size={17} label="The week before" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} />
          <button type="button" className="sc-today" disabled={page === 0} onClick={() => setPage(0)}>Today</button>
          <IconButton icon="right" size={17} label="The week after" onClick={() => setPage((p) => p + 1)} />
        </span>
      </div>
      <CallsWeek mode="schedule" label="Pick a time" days={days} from={from} to={to} blocks={blocks} work={{ from: WORK_FROM, to: WORK_TO }} busy={bands} suggestions={suggestions}
        pick={pick} was={wasSpan} length={length} legend={legend} ghostNote={ghostNote}
        now={nowAt >= 0 ? { day: nowAt, at: hoursInto(now, new Date()) } : null}
        isPast={(day, hour) => at(day, hour).getTime() <= Date.now()}
        onPick={(day, hour) => onPick(at(day, hour))}
        onDrag={(day, start, end) => onRange(at(day, start), Math.round((end - start) * 60))}
        onEnd={(end) => { if (pick) onMinutes(Math.round((end - pick.start) * 60)); }} />
    </section>
  );
}
