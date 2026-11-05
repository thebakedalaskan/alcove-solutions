/*
 * Today, on a line: the notes from earlier today (each opens its note), now, then the calls and meetings
 * still to come, with the next one lit. Under it, calls waiting for a guest to pick a time, then everything after
 * today, folded away until opened. An Alcove call's row opens its card; a calendar meeting has a menu.
 */
import type { CalendarEvent, NoteSummary } from '@alcove/api';
import { Card, Chip, EmptyState, Icon, IconButton, Popover, Timeline, TimelineItem, TimelineNow, buttonClass } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { NotesFlag } from '~/features/call/links';
import { repeatLineHere, waitingLine } from '~/features/calls/words';
import { freshCalls, useCallFlow } from '~/features/shell/context';
import { sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';
import { dayChoice, daysFromToday, hm, hoursAndMinutes, minutesUntil, shortDay, untilLabel, weekday } from '~/lib/time';
import { capital } from '~/lib/words';
import { everyWeek, peopleOn, seriesIdOf, started, whoOn, type Ahead } from './day';
import { useMoveToAlcove } from './parts';

export function Today({ past, going, coming, soon, waiting, me, calendar, starting, now }: {
  /** Today's notes; what's going now; what's still to come today; everything after today; calls waiting for a guest to pick. */
  past: NoteSummary[]; going: Ahead[]; coming: Ahead[]; soon: Ahead[]; waiting: Ahead[];
  me: string | undefined;
  /** Google Calendar's meetings are on the line. */
  calendar: boolean;
  /** Starting a call is already at the top of Home, so an empty day doesn't offer it again. */
  starting: boolean;
  now: number;
}) {
  const flow = useCallFlow();
  /* When a row goes (cancelled, moved to Alcove), focus waits at the card's heading rather than the page. */
  const heading = useRef<HTMLSpanElement>(null);
  const gone = () => heading.current?.focus();
  return (
    <Card title={<span ref={heading} tabIndex={-1} className="hm-anchor">Today</span>} className="hm-today"
      aside={calendar ? <span><Icon name="cal" size={14} />With Google Calendar</span> : undefined}>
      {past.length || going.length || coming.length ? (
        <Timeline label="Today">
          {/* What's done and what's going, in the order they started; then now; then what's still to come. */}
          {[
            ...past.map((n) => ({ at: n.startedAt, row: <Done key={`n:${n.id}`} n={n} me={me} /> })),
            ...going.map((a, i) => ({ at: a.startsAt, row: <Coming key={a.id} a={a} next={i === 0} me={me} now={now} onGone={gone} /> }))
          ].sort((x, y) => x.at.localeCompare(y.at)).map((x) => x.row)}
          <TimelineNow time={hm(new Date(now))} />
          {coming.map((a, i) => <Coming key={a.id} a={a} next={!going.length && i === 0} me={me} now={now} onGone={gone} />)}
        </Timeline>
      ) : !waiting.length && (
        <EmptyState title="Your day is clear" className="hm-empty"
          action={starting ? undefined : <button type="button" className={buttonClass({ size: 'sm' })} aria-haspopup="dialog" onClick={() => flow.start()}><Icon name="video" size={16} />Start a call</button>}>
          {calendar ? 'Meetings from Google Calendar show up here, and so do the calls you schedule.' : 'The calls you schedule show up here.'}
        </EmptyState>
      )}
      {waiting.length > 0 && <Timeline label="Waiting for a time">{waiting.map((a) => <Coming key={a.id} a={a} next={false} me={me} now={now} onGone={gone} />)}</Timeline>}
      {soon.length > 0 && <Soon soon={soon} me={me} now={now} onGone={gone} />}
    </Card>
  );
}

/**
 * Everything after today, folded away under a line that says how many calls and when the first is. Opened, they're on
 * lines by day. A call scheduled moments ago opens the fold, so its row can rise.
 */
function Soon({ soon, me, now, onGone }: { soon: Ahead[]; me: string | undefined; now: number; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!open && soon.some((a) => freshCalls.has(a.id))) setOpen(true);
  const first = soon[0];
  if (!first) return null;
  const away = daysFromToday(new Date(first.startsAt), new Date(now));
  const when = `${away === 1 ? 'tomorrow' : away < 7 ? `on ${weekday(new Date(first.startsAt))}` : `on ${shortDay(new Date(first.startsAt))}`} at ${hm(first.startsAt)}`;
  const days = new Map<string, Ahead[]>();
  for (const a of soon) {
    const label = dayChoice(new Date(a.startsAt), new Date(now));
    days.set(label, [...(days.get(label) ?? []), a]);
  }
  return (
    <div className="hm-soon">
      <button type="button" className="hm-soon-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>Coming up: {soon.length === 1 ? `1 call, ${when}` : `${soon.length} calls, the first ${when}`}</span>
        <Icon name={open ? 'up' : 'down'} size={15} />
      </button>
      <div id={id} hidden={!open}>
        {open && [...days].map(([label, items]) => (
          <section key={label} className="hm-soon-day" aria-label={label}>
            <h4 className="hm-grp">{label}</h4>
            <Timeline label={label}>
              {items.map((a) => <Coming key={a.id} a={a} next={false} me={me} now={now} onGone={onGone} />)}
            </Timeline>
          </section>
        ))}
      </div>
    </div>
  );
}

/** A note from earlier today: how long it ran and whether its notes are ready. It opens the note. */
function Done({ n, me }: { n: NoteSummary; me: string | undefined }) {
  const others = n.people.filter((p) => !me || !sameEmail(p, { email: me }));
  const state = n.status === 'ready' ? <Chip tone="sun" icon="check">Notes ready</Chip> : n.status === 'pending' ? <Chip>Being written</Chip> : <Chip>Recording</Chip>;
  return (
    <TimelineItem state="past" when={hm(n.startedAt)} whenNote={hoursAndMinutes(Math.max(1, Math.round(n.duration / 60)))} title={n.title}
      people={others} meta={<>{n.kind === 'room' && <span>In the room</span>}{state}</>}
      link={<Link to="/notes/$noteId" params={{ noteId: n.id }} />} />
  );
}

/** Who's on it, and how often it meets: "7 invited · every Thursday". */
function callSub(a: Extract<Ahead, { kind: 'call' }>, me: string | undefined): string {
  const m = a.call;
  if (m.offer) return waitingLine(m);
  if (!m.isOrganizer) return `${whoOn(a, me, 1)}${m.rsvp === null ? ' · answer' : ''}`;
  if (!m.repeat) return whoOn(a, me, 1);
  const every = repeatLineHere(m.repeat, new Date(m.startsAt));
  return `${m.guestCount ? `${m.guestCount} invited` : 'Just you'} · ${every.charAt(0).toLowerCase()}${every.slice(1)}`;
}

/**
 * A call or meeting still to come. The next one says how soon; the rest say who (or, in a weekly series, which
 * day it meets), and whether there are notes or a video link. A call opens its card; a meeting has a menu.
 */
function Coming({ a, next, me, now, onGone }: { a: Ahead; next: boolean; me: string | undefined; now: number; onGone: () => void }) {
  // A call scheduled moments ago rises in, once.
  const [fresh] = useState(() => freshCalls.delete(a.id));
  const flow = useCallFlow();
  const people = peopleOn(a, me);
  const mins = minutesUntil(a.startsAt, now);
  const series = seriesIdOf(a);
  const offered = a.kind === 'call' ? a.call.offer?.times.length : undefined;
  const extra = a.kind === 'call' ? <NotesFlag notes={a.call.notes} /> : a.event.join ? <Chip tone="outline" icon="video">{a.event.join.label}</Chip> : null;
  const line = a.kind === 'call' ? callSub(a, me) : whoOn(a, me, 1);
  return (
    <TimelineItem state={next ? 'next' : undefined} className={fresh ? 'is-new' : undefined} title={a.title} people={people}
      when={offered ? 'Soon' : hm(a.startsAt)} whenNote={offered ? `${offered} times` : hm(a.endsAt)}
      link={a.kind === 'call' ? <button type="button" aria-haspopup="dialog" onClick={() => flow.open(a.call, { onGone })} /> : undefined}
      actions={a.kind === 'event' && (a.event.isOrganizer || a.event.calendarUrl !== '' || series !== undefined) ? <RowMenu a={a} onGone={onGone} /> : undefined}
      meta={next
        ? <span>{started(a, now) ? 'Now' : capital(untilLabel(mins))}</span>
        : <><span className="who ac-clamp-1">{a.kind === 'event' && series ? <Weekly seriesId={series} or={line} /> : line}</span>{offered ? null : extra}</>} />
  );
}

/** "Every Tuesday" for a series that meets weekly, from its calls' notes; otherwise `or` (who's on it). */
function Weekly({ seriesId, or }: { seriesId: string; or: string }) {
  const calls = useQuery(q.series(seriesId)).data?.notes;
  return <>{(calls && everyWeek(calls)) ?? or}</>;
}

/**
 * What you can do with a meeting on your calendar, from its row: make one of yours an Alcove call, open it in
 * Google Calendar, or see what carries over into it in a series.
 */
function RowMenu({ a, onGone }: { a: Extract<Ahead, { kind: 'event' }>; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const alcove = useMoveToAlcove();
  /* Close first and put focus back on the button (its tooltip stays quiet), so whatever opens next returns there. */
  const then = (act: () => void) => { setOpen(false); button.current?.focus(); act(); };
  /* Moving to Alcove waits for its own answer, then sends focus to the card: the row is gone. */
  const moveToAlcove = async (e: CalendarEvent) => { if (await alcove.move(e)) onGone(); };
  const series = seriesIdOf(a);
  return (
    <Popover open={open} onOpenChange={setOpen} label={a.title} align="end" tip="More" className="hm-row-menu"
      anchor={<IconButton ref={button} icon="more" size={17} label={`More for ${a.title}`} title={undefined} />}>
      {a.event.isOrganizer && (
        <button type="button" className="ac-pop-item" onClick={() => then(() => void moveToAlcove(a.event))}>
          <Icon name="video" size={18} /><span><b>Use Alcove instead</b><small>The meeting gets an Alcove link, and Google tells everyone on it.</small></span>
        </button>
      )}
      {a.event.calendarUrl && (
        <a href={a.event.calendarUrl} target="_blank" rel="noopener noreferrer" className="ac-pop-item" onClick={() => setOpen(false)}>
          <Icon name="cal" size={18} /><span><b>Open in Google Calendar</b><small>In a new tab.</small></span>
        </a>
      )}
      {series && (
        <Link to="/notes/series/$seriesId" params={{ seriesId: series }} className="ac-pop-item" onClick={() => setOpen(false)}>
          <Icon name="repeat" size={18} /><span><b>What carries over</b><small>What earlier calls in the series decided and left open.</small></span>
        </Link>
      )}
    </Popover>
  );
}
