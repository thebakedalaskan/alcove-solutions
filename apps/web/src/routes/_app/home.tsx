import { errorMessage, firstName, type CalendarEvent, type Meeting, type NoteSummary, type OpenAction, type Team } from '@alcove/api';
import { ArchThumb, Button, CalendarRow, Card, Check, EmptyState, Faces, Icon, IconButton, Kbd, buttonClass, coverFor, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { NotesFlag, useCopyLink } from '~/features/call/links';
import { NoteCard } from '~/features/notes/NoteCard';
import { noteMeta } from '~/features/notes/meta';
import { PrepCard } from '~/features/series/cards';
import { freshCalls, useOpenComposer } from '~/features/shell/context';
import { useNow } from '~/lib/live';
import { listNames } from '~/lib/people';
import { calendarConnectUrl, q, useAdoptEvent, useInviteTeam, useUpdateAction } from '~/lib/queries';
import { daysFromToday, greeting, hm, longDay, minutesUntil, noteDay, shortDay, untilLabel } from '~/lib/time';

export const Route = createFileRoute('/_app/home')({
  loader: ({ context: { queryClient: qc } }) => Promise.all([qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.notes()), qc.ensureQueryData(q.openActions()), qc.ensureQueryData(q.team())]),
  component: Home
});

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea');

/** Alcove's calls and someone's other calendar events, as one agenda. */
type Item = { kind: 'call'; id: string; startsAt: string; endsAt: string; m: Meeting } | { kind: 'event'; id: string; startsAt: string; endsAt: string; e: CalendarEvent };
/** The series a call or event continues, when it does. */
const seriesOf = (i: Item) => (i.kind === 'call' ? i.m.seriesId : i.e.seriesId);

function Home() {
  const session = useQuery(q.session()).data;
  const upcoming = useQuery(q.upcoming()).data ?? [];
  const calendar = useQuery(q.calendar()).data;
  const notes = useQuery(q.notes()).data ?? [];
  const actions = useQuery(q.openActions()).data ?? [];
  const team = useQuery(q.team()).data ?? null;
  const navigate = useNavigate();
  const now = useNow();
  const items: Item[] = [
    ...upcoming.map((m): Item => ({ kind: 'call', id: m.id, startsAt: m.startsAt, endsAt: m.endsAt, m })),
    ...(calendar?.events ?? []).map((e): Item => ({ kind: 'event', id: e.id, startsAt: e.startsAt, endsAt: e.endsAt, e }))
  ].filter((i) => new Date(i.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const next = items[0];
  const nextSeries = next ? seriesOf(next) : undefined;
  const rest = items.slice(1);
  const day = (i: Item) => daysFromToday(new Date(i.startsAt));
  const fromCalendar = calendar?.source === 'google' && !calendar.needsAccess;
  const row = (i: Item, withDay = false) => i.kind === 'call' ? <CallRow key={i.id} m={i.m} day={withDay} /> : <EventRow key={i.id} e={i.e} day={withDay} />;
  const firstDay = notes.length === 0;
  const pending = team ? team.members.some((m) => !m.onAlcove && !m.invited) : false;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'j' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !next || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (next.kind === 'call') void navigate({ to: '/join/$code', params: { code: next.m.code } });
      else if (next.e.join) window.open(next.e.join.url, '_blank', 'noopener');
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [navigate, next]);

  const first = session ? firstName(session.user.name) : '';
  return (
    <>
      <div className="head" style={{ '--d': 0 }}>
        <div><div className="date ac-eyebrow">{longDay(new Date(now))}</div><h1>{firstDay ? 'Welcome' : greeting(new Date(now))}, {first}</h1></div>
        {!firstDay && <button type="button" className="search-btn" onClick={() => void navigate({ to: '/notes', search: { find: true } })}><Icon name="search" size={16} />Search notes<Kbd>⌘K</Kbd></button>}
      </div>
      <div className="home" style={{ '--d': 1 }}>
        <div className="hcol">
          {calendar?.needsAccess && <ConnectCalendar />}
          {next ? (next.kind === 'call' ? <NextCall m={next.m} now={now} /> : <NextEvent e={next.e} now={now} />) : <NothingScheduled />}
          {nextSeries && <PrepCard seriesId={nextSeries} me={session?.user.email} />}
          {next && (
            <section className="ac-card" aria-labelledby="laterH">
              <div className="ac-card-head"><h3 id="laterH">Later today</h3>{(firstDay || fromCalendar) && <span className="src"><Icon name="cal" size={14} />{fromCalendar ? 'With Google Calendar' : 'From your calendar'}</span>}</div>
              <div className="list">
                {rest.filter((i) => day(i) <= 0).map((i) => row(i))}
                {!rest.some((i) => day(i) <= 0) && <p className="none">Nothing else today.</p>}
                {rest.some((i) => day(i) === 1) && <><div className="grp">Tomorrow</div>{rest.filter((i) => day(i) === 1).map((i) => row(i))}</>}
                {rest.some((i) => day(i) > 1) && <><div className="grp">Later</div>{rest.filter((i) => day(i) > 1).map((i) => row(i, true))}</>}
              </div>
            </section>
          )}
        </div>
        <div className="hcol">
          {firstDay ? (
            <section className="ex-wrap" aria-labelledby="exH">
              <div className="ac-card-head"><h3 id="exH">Notes</h3></div>
              <Link to="/notes/$noteId" params={{ noteId: 'example' }} id="exampleNote" className="block rounded-[24px]" aria-label="Open the example note">
                <NoteCard you={session?.user} example className="ex-note" />
              </Link>
              <p className="ex-cap"><Icon name="notes" size={15} />Notes from your calls will look like this.</p>
            </section>
          ) : (
            <>
              <section className="ac-card" aria-labelledby="notesH">
                <div className="ac-card-head"><h3 id="notesH">Recent notes</h3><Link to="/notes">All notes <Icon name="right" size={14} /></Link></div>
                <div className="list">{notes.slice(0, 4).map((n) => <NoteRow key={n.id} n={n} />)}</div>
              </section>
              {actions.length > 0 && <FollowUps actions={actions} />}
            </>
          )}
          {team && (firstDay || pending) && <TeamCard team={team} />}
        </div>
      </div>
    </>
  );
}

function NextCall({ m, now }: { m: Meeting; now: number }) {
  const copy = useCopyLink();
  const open = useOpenComposer();
  const cover = coverFor(m.id);
  const mins = minutesUntil(m.startsAt, now);
  const started = mins <= 0;
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 350); return () => clearTimeout(t); }, []);
  // The ring fills over the last quarter of an hour before the call.
  const C = 226.2;
  const offset = started ? 0 : C * Math.min(1, mins / 15);
  const [n, unit] = ringLabel(mins);
  return (
    <section className="ac-card next" aria-label="Up next">
      <ArchThumb cover={cover} width={98} />
      <div className="min-w-0">
        <div className="ac-eyebrow">{started ? <b>Happening now</b> : <>Up next ·<b>{untilLabel(mins)}</b></>}</div>
        <h2>{m.title}</h2>
        <div className="meta">
          <span className="ac-mono">{daysFromToday(new Date(m.startsAt)) === 0 ? '' : `${shortDay(new Date(m.startsAt))} · `}{hm(m.startsAt)} – {hm(m.endsAt)}</span>
          {m.guests.length > 0 && <span className="who"><Faces people={m.guests} size={26} />{m.guests.length > 2 ? listNames(m.guests) : m.guests.map((g) => g.name).join(', ')}</span>}
          <NotesFlag notes={m.notes} />
        </div>
        <div className="acts">
          <Link to="/join/$code" params={{ code: m.code }} className={buttonClass({ variant: 'primary', size: 'lg' })}><Icon name="video" />Join<span className="kb">J</span></Link>
          <Button variant="secondary" size="lg" icon="link" onClick={() => copy(m.code)}>Copy link</Button>
          {m.status === 'scheduled' && <IconButton icon="pen" label="Change this call" onClick={() => open(m)} />}
        </div>
      </div>
      <div className="count-ring" role="img" aria-label={started ? 'Happening now' : `Starts ${untilLabel(mins)}`}>
        <svg viewBox="0 0 84 84"><circle className="bg" cx="42" cy="42" r="36" /><circle className="fg" cx="42" cy="42" r="36" strokeDasharray={C} strokeDashoffset={armed ? offset : C} /></svg>
        <b>{n}<small>{unit}</small></b>
      </div>
    </section>
  );
}

/** Countdown label for the ring: minutes, hours or days until something starts. */
function ringLabel(mins: number): [string, string] {
  if (mins <= 0) return ['Now', 'live'];
  if (mins < 60) return [String(mins), 'min'];
  if (mins < 1440) { const h = Math.floor(mins / 60); return [String(h), h === 1 ? 'hour' : 'hours']; }
  const d = Math.floor(mins / 1440);
  return [String(d), d === 1 ? 'day' : 'days'];
}

/** Making one of your own calendar events an Alcove call. */
function useAdopt() {
  const adopt = useAdoptEvent();
  const toast = useToast();
  return {
    pending: (id: string) => adopt.isPending && adopt.variables?.eventId === id,
    run: (e: CalendarEvent) => adopt.mutate({ eventId: e.id }, {
      onSuccess: (m) => toast(`${m.title} is an Alcove call now.${m.guests.length ? ` ${listNames(m.guests)} ${m.guests.length > 1 ? 'get' : 'gets'} the new link.` : ''}`, { icon: 'video' }),
      onError: (err) => toast(errorMessage(err), { icon: 'x' })
    })
  };
}

/** The next thing on someone's calendar when it isn't an Alcove call. */
function NextEvent({ e, now }: { e: CalendarEvent; now: number }) {
  const adopt = useAdopt();
  const cover = coverFor(e.id);
  const mins = minutesUntil(e.startsAt, now);
  const [n, unit] = ringLabel(mins);
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 350); return () => clearTimeout(t); }, []);
  const C = 226.2;
  const offset = mins <= 0 ? 0 : C * Math.min(1, mins / 15);
  return (
    <section className="ac-card next" aria-label="Up next">
      <ArchThumb cover={cover} width={98} />
      <div className="min-w-0">
        <div className="ac-eyebrow">{mins <= 0 ? <b>Happening now</b> : <>Up next ·<b>{untilLabel(mins)}</b></>}</div>
        <h2>{e.title}</h2>
        <div className="meta">
          <span className="ac-mono">{daysFromToday(new Date(e.startsAt)) === 0 ? '' : `${shortDay(new Date(e.startsAt))} · `}{hm(e.startsAt)} – {hm(e.endsAt)}</span>
          <span className="who"><Faces people={e.isOrganizer ? e.guests : [e.organizer, ...e.guests]} size={26} />{e.isOrganizer ? (e.guests.length ? listNames(e.guests) : 'Just you') : `${firstName(e.organizer.name)}’s call`}</span>
        </div>
        <div className="acts">
          {e.join && <a href={e.join.url} target="_blank" rel="noreferrer" className={buttonClass({ variant: 'primary', size: 'lg' })}><Icon name="video" />Join on {e.join.label}<span className="kb">J</span></a>}
          {e.isOrganizer && <Button variant={e.join ? 'secondary' : 'primary'} size="lg" icon="video" loading={adopt.pending(e.id)} onClick={() => adopt.run(e)}>Use Alcove instead</Button>}
          <a href={e.calendarUrl} target="_blank" rel="noreferrer" className="ac-icon-btn" aria-label="Open in Google Calendar" title="Open in Google Calendar"><Icon name="cal" /></a>
        </div>
      </div>
      <div className="count-ring" role="img" aria-label={mins <= 0 ? 'Happening now' : `Starts ${untilLabel(mins)}`}>
        <svg viewBox="0 0 84 84"><circle className="bg" cx="42" cy="42" r="36" /><circle className="fg" cx="42" cy="42" r="36" strokeDasharray={C} strokeDashoffset={armed ? offset : C} /></svg>
        <b>{n}<small>{unit}</small></b>
      </div>
    </section>
  );
}

/** One of someone's other calendar events in the day's list. */
function EventRow({ e, day = false }: { e: CalendarEvent; day?: boolean }) {
  const adopt = useAdopt();
  const who = e.isOrganizer ? (e.guests.length ? listNames(e.guests) : 'Just you') : `${firstName(e.organizer.name)}’s call${e.guests.length ? ` · ${listNames(e.guests)}` : ''}`;
  return (
    <CalendarRow when={hm(e.startsAt)} whenNote={day ? shortDay(new Date(e.startsAt)).replace(/ \d+ \w+$/, '') : hm(e.endsAt)}
      title={<a href={e.calendarUrl} target="_blank" rel="noreferrer">{e.title}</a>} people={e.isOrganizer ? e.guests : [e.organizer, ...e.guests]} who={who}
      end={<>
        {e.seriesId && <SeriesLink seriesId={e.seriesId} title={e.title} />}
        {e.isOrganizer && <Button variant="quiet" size="sm" className="hov" loading={adopt.pending(e.id)} onClick={() => adopt.run(e)}>Use Alcove</Button>}
        {e.join
          ? <a href={e.join.url} target="_blank" rel="noreferrer" className="nflag"><Icon name="video" size={14} />{e.join.label}</a>
          : <span className="nflag off">Calendar</span>}
      </>} />
  );
}

/** Signed in with Google but the calendar wasn't shared: one place to ask for it. */
function ConnectCalendar() {
  return (
    <Card label="Connect Google Calendar">
      <div className="connect">
        <span className="ic"><Icon name="cal" size={20} /></span>
        <div className="min-w-0 flex-1">
          <b>Connect Google Calendar</b>
          <p>See your meetings here, and put the calls you schedule on your calendar, with invitations.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => location.assign(calendarConnectUrl())}>Connect</Button>
      </div>
    </Card>
  );
}

function NothingScheduled() {
  const open = useOpenComposer();
  return (
    <section className="ac-card">
      <EmptyState title="Nothing on your calendar" action={<Button variant="primary" icon="plus" onClick={() => open()}>New call</Button>}>
        Start a call now, or describe one to schedule it.
      </EmptyState>
    </section>
  );
}

function CallRow({ m, day = false }: { m: Meeting; day?: boolean }) {
  const navigate = useNavigate();
  const copy = useCopyLink();
  const open = useOpenComposer();
  const [fresh] = useState(() => freshCalls.delete(m.id));
  const join = () => void navigate({ to: '/join/$code', params: { code: m.code } });
  return (
    <CalendarRow className={cn('clickable', fresh && 'new')} onClick={join}
      when={hm(m.startsAt)} whenNote={day ? shortDay(new Date(m.startsAt)).replace(/ \d+ \w+$/, '') : hm(m.endsAt)}
      title={<Link to="/join/$code" params={{ code: m.code }} onClick={(e) => e.stopPropagation()}>{m.title}</Link>}
      people={m.guests} who={m.guests.length ? listNames(m.guests) : 'Just you'}
      end={<>
        {m.seriesId && <SeriesLink seriesId={m.seriesId} title={m.title} />}
        <IconButton icon="pen" size={17} label={`Change ${m.title}`} className="hov" onClick={(e) => { e.stopPropagation(); open(m); }} />
        <IconButton icon="link" size={17} label={`Copy link for ${m.title}`} className="hov" onClick={(e) => { e.stopPropagation(); copy(m.code); }} />
        <NotesFlag notes={m.notes} />
      </>} />
  );
}

/** A call in a series, later on: what carries over into it is a click away. */
function SeriesLink({ seriesId, title }: { seriesId: string; title: string }) {
  return (
    <Link to="/notes/series/$seriesId" params={{ seriesId }} className="ac-icon-btn hov" aria-label={`What carries over into ${title}`} title="What carries over" onClick={(e) => e.stopPropagation()}>
      <Icon name="repeat" size={17} />
    </Link>
  );
}

function NoteRow({ n }: { n: NoteSummary }) {
  return (
    <Link to="/notes/$noteId" params={{ noteId: n.id }} className="nrow">
      <ArchThumb cover={coverFor(n.id)} room={n.kind === 'room'} />
      <span className="min-w-0"><b>{n.title}</b><small>{noteDay(n.startedAt)} · {noteMeta(n)}</small></span>
      <Icon name="chevron" size={16} className="go" />
    </Link>
  );
}

function FollowUps({ actions }: { actions: OpenAction[] }) {
  const done = useUpdateAction();
  const toast = useToast();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const open = actions.filter((a) => !ticked.has(a.id)).length;
  const toggle = (a: OpenAction, on: boolean) => {
    setTicked((s) => { const n = new Set(s); if (on) n.add(a.id); else n.delete(a.id); return n; });
    done.mutate({ noteId: a.noteId, actionId: a.id, patch: { done: on } });
    if (on) toast('Marked done', { ms: 2200 });
  };
  return (
    <section className="ac-card" aria-labelledby="fuH">
      <div className="ac-card-head"><h3 id="fuH">Your follow-ups</h3><span className="ac-eyebrow">{open ? `${open} open` : 'All done'}</span></div>
      <div className="list">
        {actions.map((a) => (
          <div key={a.id} className={cn('todo', ticked.has(a.id) && 'done')}>
            <Check checked={ticked.has(a.id)} onChange={(on) => toggle(a, on)} label={`Mark done: ${a.text}`} />
            <div><div className="txt">{a.text}</div><div className="from">{a.noteTitle}{a.due ? ` · due ${a.due}` : ''}</div></div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* Your company, from signing in with a work account: who's already here, and one button for the rest. */
function TeamCard({ team }: { team: Team }) {
  const invite = useInviteTeam();
  const toast = useToast();
  const on = team.members.filter((m) => m.onAlcove);
  const yet = team.members.filter((m) => !m.onAlcove);
  const asked = yet.filter((m) => !m.invited);
  const send = () => invite.mutate(asked.map((m) => m.person.email), { onSuccess: () => toast(`${listNames(asked.map((m) => m.person))} ${asked.length > 1 ? 'are' : 'is'} invited`, { icon: 'mail' }) });
  return (
    <section className="ac-card team" aria-labelledby="teamH">
      <div className="ac-card-head"><h3 id="teamH">{team.name} on Alcove</h3><span className="src">{team.domain}</span></div>
      {on.length > 0 && <div className="tm-row"><Faces people={on.map((m) => m.person)} size={30} /><span><b>{listNames(on.map((m) => m.person))}</b> already use it</span></div>}
      {yet.length > 0 && (
        <div className="tm-row">
          <Faces people={yet.map((m) => m.person)} size={30} /><span><b>{listNames(yet.map((m) => m.person))}</b> don’t yet</span>
          <Button variant="secondary" size="sm" icon={asked.length ? 'mail' : 'check'} disabled={!asked.length} loading={invite.isPending} onClick={send}>{asked.length ? 'Invite' : 'Invited'}</Button>
        </div>
      )}
    </section>
  );
}
