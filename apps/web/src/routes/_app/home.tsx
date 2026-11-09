/*
 * Home: the page is a sunset with starting a call in the middle of it, because that's what people come here to do.
 * Under the water: what's yours to answer and tick off, what's coming up, and your recent notes. The day's calls don't
 * lead: people join from their calendar, so a call only comes near the top in its last few minutes. Signed in from the
 * welcome page, Home opens by sailing out of its cove (features/home/SailOut.tsx).
 */
import type { Inbox } from '@alcove/api';
import { Evening, SealedBadge } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { ConnectCalendar, useNotNow } from '~/features/home/Calendar';
import { Coming } from '~/features/home/Coming';
import { aheadOf, joinable } from '~/features/home/day';
import { GetSetUp } from '~/features/home/FirstDay';
import { ForYou } from '~/features/home/ForYou';
import { Recent } from '~/features/home/Recent';
import { SailOutHere } from '~/features/home/SailOut';
import { Start } from '~/features/home/Start';
import { overlayOpen, typing } from '~/lib/keys';
import { useNow } from '~/lib/live';
import { q, trustLine } from '~/lib/queries';
import { longDay } from '~/lib/time';

export const Route = createFileRoute('/_app/home')({
  loader: async ({ context: { queryClient: qc } }) => {
    const calendar = qc.ensureQueryData(q.calendar()).catch(() => undefined);
    await Promise.all([
      qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.notes()), qc.ensureQueryData(q.inbox()), qc.ensureQueryData(q.prefs()),
      // Google can be slow: the calendar gets a moment, so the list doesn't change under the reader, and no longer.
      Promise.race([calendar, new Promise((r) => setTimeout(r, 1200))])
    ]);
    // Home never waits for the team, which only adds people to ring (prefetching doesn't throw).
    void qc.prefetchQuery(q.team());
  },
  component: Home
});

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
  const evening = useRef<HTMLDivElement>(null);

  const others = prefs?.showOtherMeetings !== false;
  const items = aheadOf(calls, others ? calendar?.events ?? [] : [], now);
  const firstDay = notes.length === 0;
  const soon = joinable(items, me, now);

  /* J joins the call on offer at the top. */
  const joining = useRef(soon);
  useEffect(() => { joining.current = soon; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const n = joining.current;
      if (e.key !== 'j' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !n || overlayOpen()) return;
      if (n.kind === 'call') { e.preventDefault(); void navigate({ to: '/join/$code', params: { code: n.call.code } }); }
      else if (n.event.join) { e.preventDefault(); window.open(n.event.join.url, '_blank', 'noopener'); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [navigate]);

  return (
    <>
      <Evening ref={evening} moment="home" className="hm" data-soon={soon ? true : undefined}>
        <header className="hm-top" style={{ '--d': 0 }}><h1 className="hm-date">{longDay(new Date(now))}</h1></header>
        <Start first={firstDay} soon={soon} me={me} now={now} />
        <div className="hm-grid" style={{ '--d': 2 }}>
          {firstDay ? <GetSetUp /> : <ForYou inbox={inbox} notes={notes} now={now} />}
          <div className="hm-side">
            {/* On the first day, Get set up offers this already. */}
            {!firstDay && calendar?.needsAccess && !later.away && <ConnectCalendar onNotNow={later.notNow} />}
            <Coming ahead={items} me={me} now={now} />
            <Recent notes={notes} me={me} />
          </div>
        </div>
        {/* The side panel shows the same check on wide screens; this one is for phones and a hidden panel. */}
        <div className="hm-seal" style={{ '--d': 3 }}><Compute /></div>
      </Evening>
      <SailOutHere page={evening} />
    </>
  );
}

/** Hosting hardware status for phones and when the side panel is hidden. */
function Compute() {
  const trust = useQuery(q.trust());
  return <SealedBadge title={trustLine(trust)} className="head-seal" data-tour="sealed" />;
}
