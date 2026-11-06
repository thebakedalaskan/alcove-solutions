/*
 * Coming up: the calls ahead, one line each, so every call always has a home, the one on offer at the top of Home
 * included. An Alcove call opens its card, and a calendar meeting has a menu. Nothing leads the list: this is where
 * you check, not where you start. Time blocked out on a calendar with nobody else on it isn't a call, so it isn't listed.
 */
import type { CalendarEvent } from '@alcove/api';
import { EmptyState, Icon, IconButton, Popover, ShowMore, cn } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { waitingLine } from '~/features/calls/scheduling/words';
import { freshCalls, useCallFlow } from '~/features/shell/context';
import { daysFromToday, hm, shortDay, weekday } from '~/lib/time';
import { isOffered, peopleOn, seriesIdOf, started, whoOn, type Ahead } from './day';
import { useMoveToAlcove } from './parts';

const FIRST = 5;

/** When, on one line: "Now", "17:55" today, "Thu 17:55" this week, otherwise the date. */
function whenOf(a: Ahead, now: number): string {
  if (isOffered(a)) return 'Soon';
  if (started(a, now)) return 'Now';
  const at = new Date(a.startsAt);
  const away = daysFromToday(at, new Date(now));
  if (away <= 0) return hm(at);
  return away < 7 ? `${weekday(at).slice(0, 3)} ${hm(at)}` : shortDay(at);
}

/** Under the title, only when something needs saying: a call waiting for a time, or one you haven't answered. */
function noteOn(a: Ahead, me: string | undefined): string | undefined {
  if (a.kind !== 'call') return undefined;
  if (a.call.offer) return waitingLine(a.call);
  return !a.call.isOrganizer && a.call.rsvp === null ? `${whoOn(a, me, 1)} · answer` : undefined;
}

export function Coming({ ahead, me, now }: { ahead: readonly Ahead[]; me: string | undefined; now: number }) {
  const h = useId();
  const [all, setAll] = useState(false);
  /* When a row goes (cancelled, moved to Alcove), focus waits at the heading rather than the page. */
  const heading = useRef<HTMLHeadingElement>(null);
  const gone = () => heading.current?.focus();
  const rows = ahead.filter((a) => a.kind === 'call' || peopleOn(a, me).length > 0);
  // A call scheduled moments ago opens the list, so its row can rise.
  if (!all && rows.length > FIRST + 1 && rows.slice(FIRST).some((a) => freshCalls.has(a.id))) setAll(true);
  // One more than fits is shown rather than hidden behind "Show 1 more".
  const shown = all || rows.length <= FIRST + 1 ? rows : rows.slice(0, FIRST);
  return (
    <section className="hm-panel" aria-labelledby={h}>
      <div className="hm-panel-h"><h2 id={h} ref={heading} tabIndex={-1}>Coming up</h2></div>
      {rows.length ? (
        <>
          <ul className="hm-rows">{shown.map((a) => <Row key={a.id} a={a} me={me} now={now} onGone={gone} />)}</ul>
          {rows.length > FIRST + 1 && <ShowMore all={all} more={rows.length - FIRST} onToggle={() => setAll((x) => !x)} />}
        </>
      ) : <EmptyState title="Nothing coming up" art={null} className="hm-none">The calls you schedule show up here.</EmptyState>}
    </section>
  );
}

function Row({ a, me, now, onGone }: { a: Ahead; me: string | undefined; now: number; onGone: () => void }) {
  // A call scheduled moments ago rises in, once.
  const [fresh] = useState(() => freshCalls.delete(a.id));
  const flow = useCallFlow();
  const line = noteOn(a, me);
  const body = (
    <>
      <span className="hm-row-w">{whenOf(a, now)}</span>
      <span className="hm-row-t"><b className="ac-clamp-1" title={a.title}>{a.title}</b>{line && <small className="ac-clamp-1">{line}</small>}</span>
    </>
  );
  return (
    <li>
      {a.kind === 'call'
        ? <button type="button" className={cn('hm-row', fresh && 'is-new')} aria-haspopup="dialog" onClick={() => flow.open(a.call, { onGone })}>{body}</button>
        : <div className="hm-row">{body}{(a.event.isOrganizer || a.event.calendarUrl !== '' || seriesIdOf(a) !== undefined) && <RowMenu a={a} onGone={onGone} />}</div>}
    </li>
  );
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
  /* Moving to Alcove waits for its own answer, then sends focus to the heading: the row is gone. */
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
