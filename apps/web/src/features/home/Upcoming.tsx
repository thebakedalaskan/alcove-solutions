/*
 * Upcoming: a calendar widget, by day. Every Alcove call ahead and, with Google Calendar connected, the meetings with
 * someone else on them, each under a block for its day: today, the next six days by weekday, later ones by date, and a call
 * still waiting for a time to be picked last, under Soon. A row says only what needs saying at its end: In 4 min or Now, Answer
 * for an invitation, Use Alcove on a meeting you organized. An Alcove call opens its card, and a calendar meeting its menu.
 * Events with only you on them aren't calls: Upcoming counts them at its foot, and lists them, one slim hatched line each, when
 * you ask (the `showSoloEvents` preference). With nothing to list, it says why: nothing with other people (and how many events
 * it isn't showing), a calendar with nothing on it, or no calls. Until the calendar is connected, Upcoming is the way to
 * connect it: straight to Google, and back to Home.
 */
import { errorMessage, type CalendarConnectResult, type CalendarEvent, type Meeting } from '@alcove/api';
import { Button, EmptyState, EmptyWeek, Faces, Hatch, Icon, Popover, Widget, buttonClass, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { pickerName } from '~/features/calls/scheduling/words';
import { freshCalls } from '~/features/shell/context';
import { calendarConnectUrl, q, usePreferences } from '~/lib/queries';
import { dayMonth, daysFromToday, hm, longDay, minutesUntil, shortMonth, weekday } from '~/lib/time';
import { capital } from '~/lib/words';
import { isOffered, isSolo, peopleOn, seriesIdOf, started, startsSoon, type Ahead } from './day';
import { useMoveToAlcove, useShowMore } from './parts';

/**
 * Google's way back to Home (`?calendar=`, `inAddress`): its result, kept for this visit once it's gone from the address,
 * which it leaves at once. Connected says so in a toast, once Google really is; anything else is Upcoming's to say.
 */
export function useCalendarReturn(inAddress: CalendarConnectResult | undefined): CalendarConnectResult | undefined {
  const navigate = useNavigate();
  const toast = useToast();
  const calendar = useQuery(q.calendar()).data;
  const [result] = useState(inAddress);
  const told = useRef(false);
  const connected = calendar !== undefined && calendar.source !== 'none' && !calendar.needsAccess;
  useEffect(() => {
    if (inAddress) void navigate({ to: '/home', search: {}, replace: true, resetScroll: false });
  }, [inAddress, navigate]);
  useEffect(() => {
    if (result !== 'connected' || !connected || told.current) return;
    told.current = true;
    toast('Google Calendar is connected.', { icon: 'check' });
  }, [result, connected, toast]);
  return result;
}

/** What Google's way back says, when it didn't connect the calendar. */
const NOT_CONNECTED: Record<Exclude<CalendarConnectResult, 'connected'>, string> = {
  denied: 'Google didn’t allow the calendar',
  account: 'Choose the Google account you signed in with',
  failed: 'Google Calendar couldn’t be connected'
};

/**
 * A day's block: the day in a word (Today, Thu, or the month further on) over its date, and the day as its rows' names start
 * with it (`said`: "Today", "Thu", "16 Nov"), since the block isn't part of a row. A call waiting for a time is Soon.
 */
interface Day { key: string; word: string; num: string; label: string; said: string; today: boolean; rows: Ahead[] }

function dayOf(a: Ahead, now: number): Omit<Day, 'rows'> {
  if (isOffered(a)) return { key: 'soon', word: 'Soon', num: '', label: 'Soon, once a time is picked', said: 'Soon', today: false };
  const today = new Date(now);
  const at = new Date(a.startsAt);
  const away = daysFromToday(at, today);
  // A call that's been going since before midnight is today's.
  const day = away < 0 ? today : at;
  const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  const num = String(day.getDate());
  if (away <= 0) return { key, word: 'Today', num, label: 'Today', said: 'Today', today: true };
  const short = weekday(at).slice(0, 3);
  return away < 7
    ? { key, word: short, num, label: longDay(at), said: short, today: false }
    : { key, word: shortMonth(at), num, label: longDay(at), said: dayMonth(at), today: false };
}

/** How many rows Upcoming shows before Show N more while your own events are listed: they're slimmer. */
const ROOMY = 8;

/** Under a call that offers times: whose pick it is. */
const picking = (m: Meeting) => (m.isOrganizer ? `${capital(pickerName(m))} is picking a time` : 'A time is being picked');

export function Upcoming({ ahead, me, now, result }: { ahead: readonly Ahead[]; me: string | undefined; now: number; result: CalendarConnectResult | undefined }) {
  const calendar = useQuery(q.calendar());
  const prefs = useQuery(q.prefs()).data;
  const others = prefs?.showOtherMeetings !== false;
  const showSolo = prefs?.showSoloEvents === true;
  const save = usePreferences();
  const toast = useToast();
  const heading = useRef<HTMLHeadingElement>(null);
  const cal = calendar.data;
  /*
   * Time blocked out with nobody else on it isn't a call: it's counted, and listed only when asked for. A call waiting for a
   * time goes last.
   */
  const solo = ahead.filter((a) => isSolo(a, me));
  const listed = showSolo ? ahead : ahead.filter((a) => !isSolo(a, me));
  const rows = [...listed.filter((a) => !isOffered(a)), ...listed.filter(isOffered)];
  // Your own events are slim rows, so a few more show before Show N more while they're listed.
  const show = useShowMore<HTMLDivElement>(rows.length, showSolo && solo.length > 0 ? ROOMY : undefined);
  // A call scheduled moments ago opens the list, so its row can rise.
  if (rows.slice(show.shown).some((a) => freshCalls.has(a.id))) show.open();
  const days: Day[] = [];
  for (const a of rows.slice(0, show.shown)) {
    const d = dayOf(a, now);
    const last = days.at(-1);
    if (last?.key === d.key) last.rows.push(a);
    else days.push({ ...d, rows: [a] });
  }
  /* When a row goes (cancelled, moved to Alcove), focus waits at the heading rather than the page. */
  const gone = () => heading.current?.focus();
  /* Meetings just connected rise in, one after another. */
  const fresh = result === 'connected';
  const turn = new Map(rows.slice(0, show.shown).filter((a) => a.kind === 'event' && !isSolo(a, me)).map((a, i) => [a.id, i]));
  /* Shows or hides the events with only you on them: a preference, so it's the same wherever you're signed in, shown at once. */
  const toggleSolo = () => save.mutate({ showSoloEvents: !showSolo }, { onError: (e) => toast(`Couldn’t save that. ${errorMessage(e)}`, { icon: 'x' }) });
  /* While anything else is listed, the foot's end says how many events have only you on them; pressed while they show. */
  const soloToggle = solo.length > 0 && rows.length > 0 ? (
    <button type="button" className="hm-solo" aria-pressed={showSolo} onClick={toggleSolo}
      title={showSolo ? 'Hide the events with only you on them' : 'Show the events with only you on them'}>
      <Hatch />{solo.length} with only you
    </button>
  ) : undefined;

  /* With your other meetings off, what's on the calendar isn't shown here, so Upcoming doesn't wait for it or miss it. */
  const loading = others && cal === undefined && calendar.isPending;
  const needs = cal?.needsAccess === true;
  const errored = cal === undefined && calendar.isError;
  const failed = others && errored;
  // Back from Google without the calendar: Upcoming says so where the way to connect was.
  const problem = result !== undefined && result !== 'connected' && (needs || errored) ? result : undefined;
  /* What connecting brings: your other meetings, unless they're off. A line in the body, a label at the foot. */
  const brings = others ? 'Your meetings with other people show here' : 'The calls you schedule go on your calendar';
  const connect = calendarConnectUrl({ back: '/home' });
  const warn = <span className="hm-warn"><Icon name="alert" size={20} /></span>;
  const retry = () => void calendar.refetch();
  /* The calendar was read for this list: what's on it would show here. Otherwise only calls do. */
  const read = others && cal !== undefined && !cal.needsAccess && cal.source !== 'none';

  let body: ReactNode;
  let foot: ReactNode = null;
  if (loading && !rows.length) body = <div className="hm-sk" role="status" aria-label="Loading"><i /><i /><i /></div>;
  else if (!rows.length) {
    body = problem ? (
      <EmptyState className="hm-empty" role="status" art={warn} title={NOT_CONNECTED[problem]} action={<a href={connect} className={buttonClass({ variant: 'secondary' })}>Try again</a>}>
        Calls still work without it.
      </EmptyState>
    ) : needs ? (
      <EmptyState className="hm-empty" art={<EmptyWeek />} title="See what’s coming up"
        action={<><a href={connect} className={buttonClass({ variant: 'secondary' })}><Icon name="cal" size={18} />Connect Google Calendar</a><small>Alcove reads your events and adds the calls you schedule.</small></>}>
        {brings}.
      </EmptyState>
    ) : failed ? (
      <EmptyState className="hm-empty" role="status" art={warn} title="Your calendar didn’t load" action={<Button loading={calendar.isFetching} onClick={retry}>Try again</Button>}>
        Calls still work without it.
      </EmptyState>
    ) : solo.length ? (
      <EmptyState className="hm-empty" art={<EmptyWeek blocks="own" />} title="No meetings with other people in the next 7 days"
        action={<Button variant="secondary" size="sm" onClick={toggleSolo}>Show them</Button>}>
        {solo.length === 1 ? 'One event with only you on it isn’t shown.' : `${solo.length} events with only you on them aren’t shown.`}
      </EmptyState>
    ) : read ? (
      <EmptyState className="hm-empty" art={<EmptyWeek blocks="none" />} title="Nothing on your calendar in the next 7 days">
        Calls you schedule show up here.
      </EmptyState>
    ) : <EmptyState className="hm-empty" art={<EmptyWeek blocks="none" />} title="No calls in the next 7 days" />;
  } else {
    body = (
      <div ref={show.list}>
        {days.map((d) => (
          <div key={d.key} role="group" aria-label={d.label} className={cn('hm-day', d.today && 'is-today')}>
            <div className="hm-date" aria-hidden="true"><small>{d.word}</small>{d.num && <b>{d.num}</b>}</div>
            <ul className="hm-evs">
              {d.rows.map((a) => {
                if (a.kind === 'event' && isSolo(a, me)) return <SoloRow key={a.id} a={a} said={d.said} />;
                const i = turn.get(a.id) ?? 0;
                return <Row key={a.id} a={a} said={d.said} me={me} now={now} fresh={fresh && a.kind === 'event'} delay={i > 0 ? { animationDelay: `${i * 45}ms` } : undefined} onGone={gone} />;
              })}
            </ul>
          </div>
        ))}
      </div>
    );
    foot = problem ? <Missing warn text={NOT_CONNECTED[problem]} action={<a href={connect} className={buttonClass({ variant: 'secondary', size: 'sm' })}>Try again</a>} />
      : needs ? <Missing text={others ? 'See your other meetings here' : brings} action={<a href={connect} className={buttonClass({ variant: 'secondary', size: 'sm' })} aria-label="Connect Google Calendar">Connect</a>} />
        : failed ? <Missing warn text="Your calendar didn’t load" action={<Button size="sm" loading={calendar.isFetching} onClick={retry}>Try again</Button>} />
          : loading ? <Missing quiet text="Your calendar is on its way" />
            : null;
  }
  return (
    <Widget icon="cal" title="Upcoming" className="hm-up" headingRef={heading} foot={foot} more={loading ? undefined : show.more} footEnd={soloToggle}
      end={<Link to="/settings" hash="calendar" className="hm-up-set" aria-label="Calendar settings" title="Calendar settings"><Icon name="settings" size={17} /></Link>}>
      {body}
    </Widget>
  );
}

/** With calls ahead, the calendar's part is a row at the widget's foot: what's missing and the way to it, or that it's on its way. */
function Missing({ text, action, warn = false, quiet = false }: { text: string; action?: ReactNode; warn?: boolean | undefined; quiet?: boolean | undefined }) {
  return (
    <div className={cn('hm-miss', quiet && 'is-quiet')} role={warn ? 'status' : undefined}>
      <span className={cn('hm-miss-i', warn && 'is-warn')} aria-hidden="true"><Icon name={warn ? 'alert' : 'cal'} size={14} /></span>
      <p>{text}</p>
      {action}
    </div>
  );
}

/**
 * One call or meeting: its time (its name starts with its day, `said`), its title, and under it, a calendar mark for a
 * meeting from your calendar, or whose pick a time is, then up to three faces. At its end only what needs saying. A call just
 * scheduled, or a meeting just connected, rises in once.
 */
function Row({ a, said, me, now, fresh, delay, onGone }: {
  a: Ahead; said: string; me: string | undefined; now: number; fresh: boolean; delay: CSSProperties | undefined; onGone: () => void;
}) {
  const [isNew] = useState(() => (a.kind === 'call' ? freshCalls.delete(a.id) : fresh));
  // Now from when it starts by the clock, or someone's in it, until it ends.
  const on = started(a, now);
  const soon = !on && startsSoon(a, now) ? minutesUntil(a.startsAt, now) : undefined;
  const answer = a.kind === 'call' && !on && soon === undefined && !a.call.isOrganizer && a.call.rsvp === null && !a.call.offer;
  const people = peopleOn(a, me).slice(0, 3);
  const offered = a.kind === 'call' && a.call.offer ? a.call : undefined;
  const status = on ? 'Now' : soon !== undefined ? `In ${soon} min` : undefined;
  const inner = (
    <>
      <span className="hm-ev-tm"><span className="sr-only">{said} </span>{offered ? <span aria-hidden="true">—</span> : hm(a.startsAt)}</span>
      <span className="hm-ev-t">
        <b className="ac-clamp-1" title={a.title}>{a.title}</b>
        {(a.kind === 'event' || offered || people.length > 0) && (
          <span className="hm-ev-w">
            {a.kind === 'event' && <><Icon name="cal" size={13} /><span className="sr-only">On your calendar</span></>}
            {offered && <><Icon name="clock" size={13} /><span>{picking(offered)}</span></>}
            {people.length > 0 && <Faces people={people} size={16} max={3} />}
          </span>
        )}
      </span>
      {status && <span className="hm-ev-now">{status}</span>}
      {answer && <span className="hm-ev-ask">Answer</span>}
    </>
  );
  const cls = cn('hm-ev', status && 'is-soon', isNew && 'is-new');
  if (a.kind === 'event') return <MeetingRow a={a} going={on} cls={cls} style={isNew ? delay : undefined} onGone={onGone}>{inner}</MeetingRow>;
  return (
    <li data-row className={cls}>
      <Link to="/calls/upcoming/$meetingId" params={{ meetingId: a.call.id }} className="hm-ev-b">{inner}</Link>
    </li>
  );
}

/**
 * An event with only you on it, while they're shown: one slim, quiet line, the time, then the title after the hatch your own
 * time has when you schedule, and no faces. It opens in Google Calendar, in a new tab: there's nobody to move it to Alcove for.
 */
function SoloRow({ a, said }: { a: Extract<Ahead, { kind: 'event' }>; said: string }) {
  return (
    <li data-row className="hm-ev is-solo">
      <a href={a.event.calendarUrl} target="_blank" rel="noopener noreferrer" className="hm-ev-b" title="Open in Google Calendar, in a new tab">
        <span className="hm-ev-tm"><span className="sr-only">{said} </span>{hm(a.startsAt)}</span>
        <span className="hm-ev-own"><Hatch /><span className="ac-clamp-1">{a.title}</span><span className="sr-only">, only you</span></span>
      </a>
    </li>
  );
}

/**
 * A meeting on your calendar: pressing it opens its menu (make one of yours an Alcove call, open it in Google Calendar, or see
 * what carries over into it in a series), and one you organized has Use Alcove at its end.
 */
function MeetingRow({ a, going: on, cls, style, onGone, children }: {
  a: Extract<Ahead, { kind: 'event' }>; going: boolean; cls: string; style: CSSProperties | undefined; onGone: () => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const alcove = useMoveToAlcove();
  /* Close first and put focus back on the row, so whatever opens next returns there. */
  const then = (act: () => void) => { setOpen(false); button.current?.focus(); act(); };
  /* Moving to Alcove waits for its own answer, then sends focus to the heading: the row is gone. */
  const move = async (e: CalendarEvent) => {
    if (moving) return;
    setMoving(true);
    if (await alcove.move(e)) onGone();
    else setMoving(false);
  };
  const series = seriesIdOf(a);
  const mine = a.event.isOrganizer;
  return (
    <li data-row className={cls} style={style}>
      <Popover open={open} onOpenChange={setOpen} label={a.title} align="start" className="hm-ev-menu"
        anchor={<button ref={button} type="button" className="hm-ev-b">{children}</button>}>
        {mine && (
          <button type="button" className="ac-pop-item" disabled={moving} onClick={() => then(() => void move(a.event))}>
            <Icon name="video" size={18} /><span><b>Use Alcove instead</b><small>The meeting gets an Alcove link, and Google tells everyone on it.</small></span>
          </button>
        )}
        <a href={a.event.calendarUrl} target="_blank" rel="noopener noreferrer" className="ac-pop-item" onClick={() => setOpen(false)}>
          <Icon name="cal" size={18} /><span><b>Open in Google Calendar</b><small>In a new tab.</small></span>
        </a>
        {series && (
          <Link to="/calls" search={{ series }} className="ac-pop-item" onClick={() => setOpen(false)}>
            <Icon name="repeat" size={18} /><span><b>What carries over</b><small>What earlier calls in the series decided and left open.</small></span>
          </Link>
        )}
      </Popover>
      {mine && !on && (
        <span className="hm-ev-x">
          <Button size="xs" icon="video" loading={moving} title="The meeting gets an Alcove link, and Google tells everyone on it" onClick={() => void move(a.event)}>Use Alcove</Button>
        </span>
      )}
    </li>
  );
}
