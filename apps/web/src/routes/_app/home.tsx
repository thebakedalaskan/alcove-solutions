import { firstName, type Meeting, type NoteSummary, type OpenAction, type Team } from '@alcove/api';
import { ArchThumb, Button, Check, EmptyState, Faces, Icon, IconButton, Kbd, coverFor, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { NotesFlag, useCopyLink } from '~/features/call/links';
import { CARD_DONE, NoteCard } from '~/features/notes/NoteCard';
import { noteMeta } from '~/features/notes/meta';
import { freshCalls, useOpenComposer } from '~/features/shell/context';
import { useNow } from '~/lib/live';
import { listNames } from '~/lib/people';
import { q, useActionDone, useInviteTeam } from '~/lib/queries';
import { daysFromToday, greeting, hm, longDay, minutesUntil, noteDay, shortDay, untilLabel } from '~/lib/time';

export const Route = createFileRoute('/_app/home')({
  loader: ({ context: { queryClient: qc } }) => Promise.all([qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.notes()), qc.ensureQueryData(q.openActions()), qc.ensureQueryData(q.team())]),
  component: Home
});

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea');

function Home() {
  const session = useQuery(q.session()).data;
  const upcoming = useQuery(q.upcoming()).data ?? [];
  const notes = useQuery(q.notes()).data ?? [];
  const actions = useQuery(q.openActions()).data ?? [];
  const team = useQuery(q.team()).data ?? null;
  const navigate = useNavigate();
  const now = useNow();
  const calls = upcoming.filter((m) => new Date(m.endsAt).getTime() > now);
  const next = calls[0];
  const rest = calls.slice(1);
  const day = (m: Meeting) => daysFromToday(new Date(m.startsAt));
  const firstDay = notes.length === 0;
  const pending = team ? team.members.some((m) => !m.onAlcove && !m.invited) : false;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'j' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !next || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      void navigate({ to: '/join/$code', params: { code: next.code } });
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [navigate, next]);

  const first = session ? firstName(session.user.name) : '';
  return (
    <>
      <div className="head" style={{ '--d': 0 }}>
        <div><div className="date">{longDay(new Date(now))}</div><h1>{firstDay ? 'Welcome' : greeting(new Date(now))}, {first}</h1></div>
        {!firstDay && <button type="button" className="search-btn" onClick={() => void navigate({ to: '/notes', search: { find: true } })}><Icon name="search" size={16} />Search notes<Kbd>⌘K</Kbd></button>}
      </div>
      <div className="home" style={{ '--d': 1 }}>
        <div className="hcol">
          {next ? <NextCall m={next} now={now} /> : <NothingScheduled />}
          {next && (
            <section className="card" aria-labelledby="laterH">
              <div className="card-head"><h3 id="laterH">Later today</h3>{firstDay && <span className="src"><Icon name="cal" size={14} />From your calendar</span>}</div>
              <div className="list">
                {rest.filter((m) => day(m) <= 0).map((m) => <CallRow key={m.id} m={m} />)}
                {!rest.some((m) => day(m) <= 0) && <p className="px-3.5 py-3 text-[14px] text-ink-3">Nothing else today.</p>}
                {rest.some((m) => day(m) === 1) && <><div className="grp">Tomorrow</div>{rest.filter((m) => day(m) === 1).map((m) => <CallRow key={m.id} m={m} />)}</>}
                {rest.some((m) => day(m) > 1) && <><div className="grp">Later</div>{rest.filter((m) => day(m) > 1).map((m) => <CallRow key={m.id} m={m} day />)}</>}
              </div>
            </section>
          )}
        </div>
        <div className="hcol">
          {firstDay ? (
            <section className="ex-wrap" aria-labelledby="exH">
              <div className="card-head px-1.5 pb-0.5 pt-0"><h3 id="exH">Notes</h3></div>
              <Link to="/notes/$noteId" params={{ noteId: 'example' }} id="exampleNote" className="block rounded-[24px]" aria-label="Open the example note">
                <NoteCard progress={CARD_DONE} you={session?.user} example className="ex-note" />
              </Link>
              <p className="ex-cap"><Icon name="notes" size={15} />Notes from your calls will look like this.</p>
            </section>
          ) : (
            <>
              <section className="card" aria-labelledby="notesH">
                <div className="card-head"><h3 id="notesH">Recent notes</h3><Link to="/notes" className="link">All notes <Icon name="right" size={14} /></Link></div>
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
  const cover = coverFor(m.id);
  const mins = minutesUntil(m.startsAt, now);
  const started = mins <= 0;
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 350); return () => clearTimeout(t); }, []);
  // The ring fills over the last quarter of an hour before the call.
  const C = 226.2;
  const offset = started ? 0 : C * Math.min(1, mins / 15);
  const [n, unit] = started ? ['Now', 'live'] : mins < 60 ? [String(mins), 'min'] : mins < 1440 ? [String(Math.floor(mins / 60)), Math.floor(mins / 60) === 1 ? 'hour' : 'hours'] : [String(Math.floor(mins / 1440)), Math.floor(mins / 1440) === 1 ? 'day' : 'days'];
  return (
    <section className={`next cover-${cover}`} aria-label="Up next">
      <ArchThumb cover={cover} width={98} />
      <div className="min-w-0">
        <div className="eyebrow">{started ? <b>Happening now</b> : <>Up next ·<b>{untilLabel(mins)}</b></>}</div>
        <h2>{m.title}</h2>
        <div className="meta">
          <span className="mono">{daysFromToday(new Date(m.startsAt)) === 0 ? '' : `${shortDay(new Date(m.startsAt))} · `}{hm(m.startsAt)} – {hm(m.endsAt)}</span>
          {m.guests.length > 0 && <span className="who"><Faces people={m.guests} size={26} />{m.guests.length > 2 ? listNames(m.guests) : m.guests.map((g) => g.name).join(', ')}</span>}
          <NotesFlag notes={m.notes} />
        </div>
        <div className="acts">
          <Link to="/join/$code" params={{ code: m.code }} className="btn btn-primary btn-lg"><Icon name="video" />Join<span className="kb">J</span></Link>
          <Button variant="secondary" size="lg" icon="link" onClick={() => copy(m.code)}>Copy link</Button>
        </div>
      </div>
      <div className="count-ring" role="img" aria-label={started ? 'Happening now' : `Starts ${untilLabel(mins)}`}>
        <svg viewBox="0 0 84 84"><circle className="bg" cx="42" cy="42" r="36" /><circle className="fg" cx="42" cy="42" r="36" strokeDasharray={C} strokeDashoffset={armed ? offset : C} /></svg>
        <b>{n}<small>{unit}</small></b>
      </div>
    </section>
  );
}

function NothingScheduled() {
  const open = useOpenComposer();
  return (
    <section className="card">
      <EmptyState title="Nothing on your calendar" action={<Button variant="primary" icon="plus" onClick={open}>New call</Button>}>
        Start a call now, or describe one to schedule it.
      </EmptyState>
    </section>
  );
}

function CallRow({ m, day = false }: { m: Meeting; day?: boolean }) {
  const navigate = useNavigate();
  const copy = useCopyLink();
  const [fresh] = useState(() => freshCalls.delete(m.id));
  const join = () => void navigate({ to: '/join/$code', params: { code: m.code } });
  return (
    <div className={cn('row cursor-pointer', fresh && 'new')} onClick={join}>
      <div className="tm">{hm(m.startsAt)}<small>{day ? shortDay(new Date(m.startsAt)).replace(/ \d+ \w+$/, '') : hm(m.endsAt)}</small></div>
      <div className="min-w-0">
        <Link to="/join/$code" params={{ code: m.code }} className="t block" onClick={(e) => e.stopPropagation()}>{m.title}</Link>
        <div className="s">{m.guests.length ? listNames(m.guests) : 'Just you'}</div>
      </div>
      <div className="r">
        <IconButton icon="link" size={17} label={`Copy link for ${m.title}`} className="hov" onClick={(e) => { e.stopPropagation(); copy(m.code); }} />
        {m.guests.length > 0 && <Faces people={m.guests} size={26} max={3} />}
        <NotesFlag notes={m.notes} />
      </div>
    </div>
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
  const done = useActionDone();
  const toast = useToast();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const open = actions.filter((a) => !ticked.has(a.id)).length;
  const toggle = (a: OpenAction, on: boolean) => {
    setTicked((s) => { const n = new Set(s); if (on) n.add(a.id); else n.delete(a.id); return n; });
    done.mutate({ noteId: a.noteId, actionId: a.id, done: on });
    if (on) toast('Marked done', { ms: 2200 });
  };
  return (
    <section className="card" aria-labelledby="fuH">
      <div className="card-head"><h3 id="fuH">Your follow-ups</h3><span className="eyebrow">{open ? `${open} open` : 'All done'}</span></div>
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
    <section className="card team" aria-labelledby="teamH">
      <div className="card-head"><h3 id="teamH">{team.name} on Alcove</h3><span className="src">{team.domain}</span></div>
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
