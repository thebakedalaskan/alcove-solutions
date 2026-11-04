/*
 * Home: each card does one thing. Up next (with last time's notes, and what carries over when it's in a
 * series), what's waiting on you, your follow-ups, today on a line, asking your notes, and your recent
 * notes. Before your first notes: the line to start your first call, the example note, and your team.
 */
import { firstName, type Inbox } from '@alcove/api';
import { SealedBadge } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Ask, questionsFrom } from '~/features/home/Ask';
import { ConnectCalendar, useNotNow } from '~/features/home/Calendar';
import { aheadOf, ledeOf, seriesIdOf, todayOf } from '~/features/home/day';
import { Example, TeamCard } from '~/features/home/FirstDay';
import { FollowUps } from '~/features/home/FollowUps';
import { Recent } from '~/features/home/Recent';
import { Today } from '~/features/home/Today';
import { StartCall, UpNext } from '~/features/home/UpNext';
import { Waiting, waitingOf } from '~/features/home/Waiting';
import { PrepCard } from '~/features/series/cards';
import { useNow } from '~/lib/live';
import { q } from '~/lib/queries';
import { greeting, hm, longDay } from '~/lib/time';

export const Route = createFileRoute('/_app/home')({
  loader: async ({ context: { queryClient: qc } }) => {
    const calendar = qc.ensureQueryData(q.calendar()).catch(() => undefined);
    const [, notes] = await Promise.all([
      qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.notes()), qc.ensureQueryData(q.inbox()), qc.ensureQueryData(q.prefs()),
      // Google can be slow: the calendar gets a moment, so Up next doesn't change under the reader, and no longer.
      Promise.race([calendar, new Promise((r) => setTimeout(r, 1200))])
    ]);
    // Only the first day shows the team, and Home never waits for it (prefetching doesn't throw).
    if (!notes.length) void qc.prefetchQuery(q.team());
  },
  component: Home
});

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, [contenteditable="true"]');
const NOTHING: Inbox = { followUps: [], decisions: [] };

function Home() {
  const session = useQuery(q.session()).data;
  const notes = useQuery(q.notes()).data ?? [];
  const calls = useQuery(q.upcoming()).data ?? [];
  const calendar = useQuery(q.calendar()).data;
  const prefs = useQuery(q.prefs()).data;
  const inbox = useQuery(q.inbox()).data ?? NOTHING;
  const navigate = useNavigate();
  const now = useNow();
  const later = useNotNow();
  const me = session?.user.email;

  const others = prefs?.showOtherMeetings !== false;
  const items = aheadOf(calls, others ? calendar?.events ?? [] : [], now);
  const firstDay = notes.length === 0;
  // Before your first notes the top of Home starts your first call, until one is scheduled.
  const next = firstDay ? items.find((a) => a.kind === 'call') : items[0];
  const series = next && seriesIdOf(next);
  const day = todayOf(notes, items, now);
  const suggested = inbox.followUps.filter((a) => !a.takenOn);

  /* J joins the call that's up next. */
  const upNext = useRef(next);
  useEffect(() => { upNext.current = next; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const n = upNext.current;
      if (e.key !== 'j' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !n || document.querySelector('[role="dialog"], [role="listbox"]')) return;
      if (n.kind === 'call') { e.preventDefault(); void navigate({ to: '/join/$code', params: { code: n.call.code } }); }
      else if (n.event.join) { e.preventDefault(); window.open(n.event.join.url, '_blank', 'noopener'); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [navigate]);

  return (
    <>
      <div className="head" style={{ '--d': 0 }}>
        <div>
          <div className="date ac-eyebrow">{longDay(new Date(now))}</div>
          <h1>{firstDay ? 'Welcome' : greeting(new Date(now))}, {session ? firstName(session.user.name) : ''}</h1>
          <p className="lede">
            {firstDay
              ? 'Your calls, notes and follow-ups gather here. Start with a call, or record a conversation in the room.'
              : ledeOf({ left: day.going.length + day.coming.length, happened: day.past.length, decisions: inbox.decisions.length, suggested: suggested.length })}
          </p>
        </div>
        {/* The side panel shows the same check on wide screens; this one is for phones and a hidden panel. */}
        <div className="head-end hm-seal"><Compute /></div>
      </div>
      <div className="hm" style={{ '--d': 1 }}>
        <div className="hm-cols">
          <div className="hm-stack">
            {next ? <UpNext next={next} now={now} /> : <StartCall first={firstDay} />}
            {series && <PrepCard seriesId={series} me={me} />}
            <div className="hm-pair">
              {firstDay ? <Example /> : <Waiting items={waitingOf(inbox, notes, now)} now={now} />}
              <FollowUps open={inbox.followUps.filter((a) => a.takenOn)} now={now} />
            </div>
          </div>
          <div className="hm-stack">
            {calendar?.needsAccess && !later.away && <ConnectCalendar onNotNow={later.notNow} />}
            <Today {...day} me={me} calendar={calendar?.source === 'google' && !calendar.needsAccess && others} composing={!next} now={now} />
            {firstDay ? <TeamCard /> : <Ask questions={questionsFrom(notes, me, now)} />}
          </div>
        </div>
      </div>
      {!firstDay && <Recent notes={notes} inbox={inbox} />}
    </>
  );
}

/** Where notes are written, and whether this browser has checked the hardware it runs on. */
function Compute() {
  const checked = useQuery(q.trust());
  const trust = checked.data;
  const verified = trust?.tee === 'dstack' && trust.bound;
  const detail = verified && trust ? `Hardware verified ${hm(new Date(trust.at))}` : checked.isPending ? 'Checking the hardware…' : 'Audio, transcripts and notes are sealed';
  return <SealedBadge title="Confidential compute" detail={detail} className="head-seal" data-tour="sealed" />;
}
