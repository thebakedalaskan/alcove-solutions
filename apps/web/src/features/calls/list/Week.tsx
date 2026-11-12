/*
 * The week on Calls, hour by hour, Monday to Sunday: the calls that happened (with what waits on you marked), your calls and
 * the ones you're invited to ahead, the meetings on your calendar, and the times held for a guest to pick from. Now is the
 * sun on a line. A call that happened opens; a free time pressed, or dragged across, starts scheduling there. Last week,
 * Today and Next week move it.
 */
import type { CalendarEvent, Inbox, Meeting, NoteSummary } from '@alcove/api';
import { Button, CallsWeek, IconButton, SheetHead, type CallsWeekBlock, type CallsWeekDay, type CallsWeekKeyItem } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { useOpenScheduling } from '~/features/calls/scheduling/search';
import { pickerName } from '~/features/calls/scheduling/words';
import { peopleOn } from '~/features/home/day';
import { freshCalls } from '~/features/shell/context';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { longDay, weekday } from '~/lib/time';
import { waitingIn } from './past';

const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const wlog = log.child({ component: 'calls' });

/** The Monday a week starts on, `offset` weeks from this one, at midnight here. */
function mondayOf(now: Date, offset: number): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

/** "Monday 2 to Sunday 8 November", or across two months, "Monday 30 November to Sunday 6 December". */
function spanLine(days: readonly Date[]): string {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return '';
  const month = (d: Date) => MONTHS[d.getMonth()] ?? '';
  return first.getMonth() === last.getMonth()
    ? `${weekday(first)} ${first.getDate()} to ${weekday(last)} ${last.getDate()} ${month(last)}`
    : `${weekday(first)} ${first.getDate()} ${month(first)} to ${weekday(last)} ${last.getDate()} ${month(last)}`;
}

/** What the week's head calls it: This week, Last week, Next week, or the week of its Monday. */
const weekName = (offset: number, monday: Date) => (offset === 0 ? 'This week' : offset === -1 ? 'Last week' : offset === 1 ? 'Next week' : `Week of ${monday.getDate()} ${(MONTHS[monday.getMonth()] ?? '').slice(0, 3)}`);

/** Hours from a day's midnight, as the week places things: 9.5 is 09:30. */
const hoursIn = (at: Date, day: Date) => (at.getTime() - day.getTime()) / 3_600_000;

/** Everything the week shows, as blocks, by kind, on the days it falls on. */
function blocksOf(days: readonly Date[], notes: readonly NoteSummary[], calls: readonly Meeting[], events: readonly CalendarEvent[], inbox: Inbox | undefined, me: string | undefined): CallsWeekBlock[] {
  const out: CallsWeekBlock[] = [];
  const place = (id: string, title: string, from: Date, to: Date, kind: CallsWeekBlock['kind'], wait?: CallsWeekBlock['wait']) => {
    const day = days.findIndex((d) => from.getTime() >= d.getTime() && from.getTime() < d.getTime() + DAY);
    const on = days[day];
    if (!on) return;
    const start = hoursIn(from, on);
    out.push({ id, title, day, start, end: Math.max(start + 0.25, Math.min(24, hoursIn(to, on))), kind, ...(wait ? { wait } : {}) });
  };
  for (const n of notes) {
    const from = new Date(n.startedAt);
    const waits = waitingIn(inbox, n.id);
    place(`note:${n.id}`, n.title, from, new Date(from.getTime() + n.duration * 1000), 'past', waits.decide ? 'dec' : waits.follow ? 'fu' : undefined);
  }
  for (const m of calls) {
    if (m.status === 'ended') continue;
    if (m.offer) {
      if (m.isOrganizer) m.offer.times.forEach((t, i) => place(`hold:${m.id}:${i}`, `Held for ${pickerName(m)}`, new Date(t), new Date(Date.parse(t) + (Date.parse(m.endsAt) - Date.parse(m.startsAt))), 'hold'));
      continue;
    }
    const kind = freshCalls.has(m.id) ? 'fresh' : !m.isOrganizer && m.rsvp === null ? 'invite' : 'soon';
    place(`call:${m.id}`, m.title, new Date(m.startsAt), new Date(m.endsAt), kind);
  }
  const codes = new Set(calls.flatMap((m) => [m.code, ...(m.seriesCode ? [m.seriesCode] : [])]));
  for (const e of events) {
    // A copy of an Alcove call in your own calendar is the call; time blocked out with nobody else on it isn't a call.
    if (e.alcoveCode && codes.has(e.alcoveCode)) continue;
    if (!peopleOn({ kind: 'event', id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, event: e }, me).length) continue;
    place(`event:${e.id}`, e.title, new Date(e.startsAt), new Date(e.endsAt), 'cal');
  }
  return out;
}

export function WeekView({ offset, onOffset, notes, calls, inbox, me, now, calendarOn, toggle }: {
  /** Weeks from this one. */
  offset: number; onOffset: (offset: number) => void;
  notes: readonly NoteSummary[]; calls: readonly Meeting[]; inbox: Inbox | undefined; me: string | undefined; now: number;
  /** Google Calendar is connected: its meetings are in the week. */
  calendarOn: boolean;
  /** List or week. */
  toggle: ReactNode;
}) {
  const navigate = useNavigate();
  const schedule = useOpenScheduling();
  const today = new Date(now);
  const monday = mondayOf(today, offset);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)), [monday.getTime()]);
  const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  const range = { from: monday.toISOString(), to: end.toISOString() };
  const read = useQuery({ ...q.calendarRange(range), enabled: calendarOn });
  const events = calendarOn ? read.data?.events ?? [] : [];
  const blocks = useMemo(() => blocksOf(days, notes, calls, events, inbox, me), [days, notes, calls, events, inbox, me]);
  const todayAt = days.findIndex((d) => d.toDateString() === today.toDateString());
  const weekDays: CallsWeekDay[] = days.map((d, i) => ({ weekday: weekday(d).slice(0, 3), date: d.getDate(), label: longDay(d), today: i === todayAt, weekend: i > 4 }));
  const legend: CallsWeekKeyItem[] = [
    { kind: 'past', label: 'Past, with notes' }, { kind: 'soon', label: 'Alcove call' }, ...(calendarOn ? [{ kind: 'cal' as const, label: 'From your calendar' }] : []),
    { kind: 'invite', label: 'Waiting for your answer' }, { kind: 'hold', label: 'Held until a guest picks' }
  ];
  const open = (id: string) => {
    const [kind, ref] = id.split(':');
    if (!ref) return;
    if (kind === 'note') void navigate({ to: '/calls/$noteId', params: { noteId: ref } });
    else if (kind === 'call' || kind === 'hold') void navigate({ to: '/calls/upcoming/$meetingId', params: { meetingId: ref } });
    else if (kind === 'event') {
      const e = events.find((x) => x.id === ref);
      if (e) window.open(e.calendarUrl, '_blank', 'noopener');
      else wlog.info('a calendar meeting pressed on the week has gone', { kind });
    }
  };
  /** A free time pressed, or dragged across (as long as the drag), and the scheduler opens there. */
  const start = (day: number, hour: number, until?: number) => {
    const on = days[day];
    if (!on) return;
    const minutes = until === undefined ? undefined : Math.min(600, Math.max(5, Math.round((until - hour) * 60)));
    schedule({ schedule: 'new', slot: new Date(on.getTime() + hour * 3_600_000).toISOString(), minutes });
  };
  return (
    <>
      <SheetHead title={weekName(offset, monday)} sub={spanLine(days)} actions={(
        <>
          <span className="cs-wnav">
            <IconButton icon="left" size={17} label="Last week" onClick={() => onOffset(offset - 1)} />
            <Button variant="quiet" size="xs" disabled={offset === 0} onClick={() => onOffset(0)}>Today</Button>
            <IconButton icon="right" size={17} label="Next week" onClick={() => onOffset(offset + 1)} />
          </span>
          {toggle}
        </>
      )} />
      <CallsWeek days={weekDays} blocks={blocks} now={todayAt >= 0 ? { day: todayAt, at: hoursIn(today, days[todayAt] ?? today) } : null} label={weekName(offset, monday)}
        isPast={(day, hour) => (days[day]?.getTime() ?? 0) + hour * 3_600_000 < now}
        legend={legend} onBlock={open} onPick={(day, at) => start(day, at)} onDrag={start} className="cs-week" />
    </>
  );
}
