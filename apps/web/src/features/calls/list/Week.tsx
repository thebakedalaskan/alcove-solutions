/*
 * The week on Calls, hour by hour, Monday to Sunday: the calls that happened (with what waits on you marked), your calls and
 * the ones you're invited to ahead, the meetings on your calendar, and the times held for a guest to pick from. Now is the
 * sun on a line. A call that happened opens; a free time pressed, or dragged across, starts scheduling there. Its head is
 * the days it shows, with ‹ and ›, Today while it's another week, and List and Week.
 */
import type { CalendarEvent, Inbox, Meeting, NoteSummary } from '@alcove/api';
import { CallsWeek, CallsWeekHead, type CallsWeekBlock, type CallsWeekDay, type CallsWeekKeyItem } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { useOpenScheduling } from '~/features/calls/scheduling/search';
import { daysSpan } from '~/features/calls/scheduling/WeekSheet';
import { pickerName } from '~/features/calls/scheduling/words';
import { isSolo } from '~/features/home/day';
import { freshCalls } from '~/features/shell/context';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { daysFromToday, longDay, weekday } from '~/lib/time';
import { waitingIn } from './past';

const DAY_MINUTES = 1440;
const wlog = log.child({ component: 'calls' });

/** The Monday a week starts on, `offset` weeks from this one, at midnight here. */
function mondayOf(now: Date, offset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
}

/** Where a moment is on a day, in minutes from its midnight as the clock on the wall says: past the day's end, 24:00. */
const minuteOn = (at: Date, day: Date) => (daysFromToday(at, day) > 0 ? DAY_MINUTES : at.getHours() * 60 + at.getMinutes());

/** Everything the week shows, as blocks, by kind, on the days they start on. */
function blocksOf(days: readonly Date[], notes: readonly NoteSummary[], calls: readonly Meeting[], events: readonly CalendarEvent[], inbox: Inbox | undefined, me: string | undefined): CallsWeekBlock[] {
  const out: CallsWeekBlock[] = [];
  const place = (id: string, title: string, from: Date, to: Date, kind: CallsWeekBlock['kind'], wait?: CallsWeekBlock['wait']) => {
    const day = days.findIndex((d) => d.toDateString() === from.toDateString());
    const on = days[day];
    if (!on) return;
    const start = minuteOn(from, on);
    out.push({ id, title, day, start, end: Math.min(DAY_MINUTES, Math.max(start + 15, minuteOn(to, on))), kind, ...(wait ? { wait } : {}) });
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
    if (isSolo({ kind: 'event', id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, event: e }, me)) continue;
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
  const sunday = days.at(-1) ?? monday;
  const span = daysSpan(monday, sunday);
  const range = { from: monday.toISOString(), to: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7).toISOString() };
  const read = useQuery({ ...q.calendarRange(range), enabled: calendarOn });
  const events = calendarOn ? read.data?.events ?? [] : [];
  const blocks = useMemo(() => blocksOf(days, notes, calls, events, inbox, me), [days, notes, calls, events, inbox, me]);
  const weekDays = useMemo<CallsWeekDay[]>(() => days.map((d) => ({
    weekday: weekday(d).slice(0, 3), date: d.getDate(), label: longDay(d), today: d.toDateString() === new Date(now).toDateString(), weekend: d.getDay() === 0 || d.getDay() === 6
  })), [days, now]);
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
  const start = (day: number, minute: number, until?: number) => {
    const on = days[day];
    if (!on) return;
    const minutes = until === undefined ? undefined : Math.min(600, Math.max(5, until - minute));
    schedule({ schedule: 'new', slot: new Date(on.getFullYear(), on.getMonth(), on.getDate(), 0, minute).toISOString(), minutes });
  };
  return (
    <>
      <CallsWeekHead title={span} onBefore={() => onOffset(offset - 1)} onAfter={() => onOffset(offset + 1)} onToday={offset === 0 ? undefined : () => onOffset(0)} end={toggle} />
      <CallsWeek days={weekDays} blocks={blocks} now={{ day: daysFromToday(today, monday), minute: today.getHours() * 60 + today.getMinutes() }} label={span}
        legend={legend} onBlock={open} onPick={(day, minute) => start(day, minute)} onRange={start} />
    </>
  );
}
