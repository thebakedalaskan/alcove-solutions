/*
 * Today, on a line: the notes from earlier today (each opens its note), now, then the calls and meetings
 * still to come, with the next one lit. Underneath, the next seven days, folded away until opened.
 */
import { errorMessage, type CalendarEvent, type Meeting, type NoteSummary } from '@alcove/api';
import { Card, Chip, EmptyState, Icon, IconButton, Popover, Timeline, TimelineItem, TimelineNow, buttonClass, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { NotesFlag, useCopyLink } from '~/features/call/links';
import { cancelNote, cancelledLine } from '~/features/shell/callLine';
import { freshCalls, useOpenComposer } from '~/features/shell/context';
import { sameEmail } from '~/lib/people';
import { q, useCancelCall } from '~/lib/queries';
import { dayChoice, daysFromToday, hm, hoursAndMinutes, minutesUntil, untilLabel, weekday } from '~/lib/time';
import { capital } from '~/lib/words';
import { everyWeek, peopleOn, seriesIdOf, started, whoOn, type Ahead } from './day';
import { useMoveToAlcove } from './parts';

export function Today({ past, going, coming, soon, me, calendar, composing, now }: {
  /** Today's notes; what's going now; what's still to come today; the next seven days. */
  past: NoteSummary[]; going: Ahead[]; coming: Ahead[]; soon: Ahead[];
  me: string | undefined;
  /** Google Calendar's meetings are on the line. */
  calendar: boolean;
  /** The line to start a call is already at the top of Home, so an empty day offers recording in the room instead. */
  composing: boolean;
  now: number;
}) {
  const open = useOpenComposer();
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
      ) : (
        <EmptyState title="Your day is clear" className="hm-empty"
          action={composing
            ? <Link to="/record" className={buttonClass({ size: 'sm' })}><Icon name="recordDot" size={16} />Record in the room</Link>
            : <button type="button" className={buttonClass({ size: 'sm' })} aria-haspopup="dialog" onClick={() => open()}><Icon name="plus" size={16} />New call</button>}>
          {calendar ? 'Meetings from Google Calendar show up here, and so do the calls you schedule.' : 'The calls you schedule show up here.'}
        </EmptyState>
      )}
      {soon.length > 0 && <Soon soon={soon} me={me} now={now} onGone={gone} />}
    </Card>
  );
}

/**
 * The next seven days, folded away under a line that says how many calls and when the first is. Opened,
 * they're on lines by day, each with its menu, so a call days away can still be changed or cancelled.
 */
function Soon({ soon, me, now, onGone }: { soon: Ahead[]; me: string | undefined; now: number; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const first = soon[0];
  if (!first) return null;
  const when = `${daysFromToday(new Date(first.startsAt), new Date(now)) === 1 ? 'tomorrow' : `on ${weekday(new Date(first.startsAt))}`} at ${hm(first.startsAt)}`;
  const days = new Map<string, Ahead[]>();
  for (const a of soon) {
    const label = dayChoice(new Date(a.startsAt), new Date(now));
    days.set(label, [...(days.get(label) ?? []), a]);
  }
  return (
    <div className="hm-soon">
      <button type="button" className="hm-soon-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>Next 7 days: {soon.length === 1 ? `1 call, ${when}` : `${soon.length} calls, the first ${when}`}</span>
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

/**
 * A call or meeting still to come. The next one says how soon; the rest say who (or, in a weekly series, which
 * day it meets), and whether there are notes or a video link.
 */
function Coming({ a, next, me, now, onGone }: { a: Ahead; next: boolean; me: string | undefined; now: number; onGone: () => void }) {
  // A call scheduled moments ago rises in, once.
  const [fresh] = useState(() => freshCalls.delete(a.id));
  const people = peopleOn(a, me);
  const mins = minutesUntil(a.startsAt, now);
  const series = seriesIdOf(a);
  const extra = a.kind === 'call' ? <NotesFlag notes={a.call.notes} /> : a.event.join ? <Chip tone="outline" icon="video">{a.event.join.label}</Chip> : null;
  // An Alcove call can always have its link copied, a calendar meeting opens in Google Calendar, and a series has what carries over.
  const menu = a.kind === 'call' || a.event.isOrganizer || a.event.calendarUrl !== '' || series !== undefined;
  return (
    <TimelineItem state={next ? 'next' : undefined} className={fresh ? 'is-new' : undefined} when={hm(a.startsAt)} whenNote={hm(a.endsAt)} title={a.title} people={people}
      actions={menu ? <RowMenu a={a} onGone={onGone} /> : undefined}
      meta={next
        ? <span>{started(a, now) ? 'Now' : capital(untilLabel(mins))}</span>
        : <><span className="who ac-clamp-1">{series ? <Weekly seriesId={series} or={whoOn(a, me, 1)} /> : whoOn(a, me, 1)}</span>{extra}</>} />
  );
}

/** "Every Tuesday" for a series that meets weekly, from its calls' notes; otherwise `or` (who's on it). */
function Weekly({ seriesId, or }: { seriesId: string; or: string }) {
  const calls = useQuery(q.series(seriesId)).data?.notes;
  return <>{(calls && everyWeek(calls)) ?? or}</>;
}

/**
 * What you can do with a call or meeting still to come, from its row: change, copy the link to, or cancel
 * one of your Alcove calls (cancelling asks first), make one of your calendar meetings an Alcove call, open
 * a calendar meeting in Google Calendar, or see what carries over into one in a series.
 */
function RowMenu({ a, onGone }: { a: Ahead; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'menu' | 'cancel'>('menu');
  const button = useRef<HTMLButtonElement>(null);
  const openComposer = useOpenComposer();
  const copy = useCopyLink();
  const cancel = useCancelCall();
  const alcove = useMoveToAlcove();
  const toast = useToast();
  const show = (o: boolean) => { setOpen(o); if (!o) setStep('menu'); };
  /* Close first and put focus back on the button (its tooltip stays quiet), so whatever opens next returns there. */
  const then = (act: () => void) => { show(false); button.current?.focus(); act(); };
  /* Cancelling and moving to Alcove wait for their own answers, then send focus to the card: the row is gone. */
  const cancelCall = async (m: Meeting) => {
    try {
      await cancel.mutateAsync(m.id);
      toast(cancelledLine(m), { icon: 'trash' });
      onGone();
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
    }
  };
  const moveToAlcove = async (e: CalendarEvent) => { if (await alcove.move(e)) onGone(); };
  const yours = a.kind === 'call' && a.call.isOrganizer && a.call.status === 'scheduled';
  const series = seriesIdOf(a);
  const carried = series && (
    <Link to="/notes/series/$seriesId" params={{ seriesId: series }} className="ac-pop-item" onClick={() => show(false)}>
      <Icon name="repeat" size={18} /><span><b>What carries over</b><small>What earlier calls in the series decided and left open.</small></span>
    </Link>
  );
  return (
    <Popover open={open} onOpenChange={show} label={a.title} align="end" tip="More" className="hm-row-menu"
      anchor={<IconButton ref={button} icon="more" size={17} label={`More for ${a.title}`} title={undefined} />}>
      {a.kind === 'event' ? (
        <>
          {a.event.isOrganizer && (
            <button type="button" className="ac-pop-item" onClick={() => then(() => void moveToAlcove(a.event))}>
              <Icon name="video" size={18} /><span><b>Use Alcove instead</b><small>The meeting gets an Alcove link, and Google tells everyone on it.</small></span>
            </button>
          )}
          {a.event.calendarUrl && (
            <a href={a.event.calendarUrl} target="_blank" rel="noopener noreferrer" className="ac-pop-item" onClick={() => show(false)}>
              <Icon name="cal" size={18} /><span><b>Open in Google Calendar</b><small>In a new tab.</small></span>
            </a>
          )}
          {carried}
        </>
      ) : step === 'cancel' ? (
        // autoFocus: the button that led here is gone, and the confirm takes its place for the keyboard. The key makes
        // it a new button (otherwise React reuses the menu's first one, and nothing is focused).
        <button key="confirm" type="button" className="ac-pop-item is-caution" autoFocus onClick={() => then(() => void cancelCall(a.call))}>
          <Icon name="trash" size={18} /><span><b>Cancel this call</b><small>{cancelNote(a.call)}</small></span>
        </button>
      ) : (
        <>
          {yours && <button type="button" className="ac-pop-item" onClick={() => then(() => openComposer({ meeting: a.call }))}><Icon name="pen" size={18} /><span><b>Change this call</b></span></button>}
          <button type="button" className="ac-pop-item" onClick={() => then(() => copy(a.call.code))}><Icon name="link" size={18} /><span><b>Copy link</b></span></button>
          {carried}
          {yours && <><div className="ac-pop-sep" /><button type="button" className="ac-pop-item is-caution" onClick={() => setStep('cancel')}><Icon name="trash" size={18} /><span><b>Cancel call</b></span></button></>}
        </>
      )}
    </Popover>
  );
}
