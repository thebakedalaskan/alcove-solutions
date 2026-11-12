/*
 * Home: the page is a sunset with starting a call in the middle of it, because that's what people come here to do.
 * Under the horizon, three widgets: For you (what's yours to answer, and your follow-ups), Upcoming (a calendar, by day)
 * and Recent notes (a row of cards). The day's calls don't lead: people join from their calendar, so a call only comes near
 * the top in its last few minutes. Google sends you back here after connecting the calendar from Upcoming (`?calendar=`,
 * which Home reads once and drops). Signed in from the welcome page, Home opens by sailing out of its cove
 * (features/home/SailOut.tsx).
 */
import { CalendarConnectResultSchema, type CalendarConnectResult } from '@alcove/api';
import { Evening, SealedBadge } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { aheadShown, joinable } from '~/features/home/day';
import { ForYou } from '~/features/home/ForYou';
import { Recent } from '~/features/home/Recent';
import { SailOutHere } from '~/features/home/SailOut';
import { Start } from '~/features/home/Start';
import { Upcoming, useCalendarReturn } from '~/features/home/Upcoming';
import { overlayOpen, typing } from '~/lib/keys';
import { useNow } from '~/lib/live';
import { q, verifiedAt } from '~/lib/queries';
import { hm, longDay } from '~/lib/time';

export const Route = createFileRoute('/_app/home')({
  validateSearch: (search: Record<string, unknown>): { calendar?: CalendarConnectResult | undefined } => {
    const calendar = CalendarConnectResultSchema.safeParse(search['calendar']);
    return { calendar: calendar.success ? calendar.data : undefined };
  },
  loader: async ({ context: { queryClient: qc } }) => {
    const calendar = qc.ensureQueryData(q.calendar()).catch(() => undefined);
    await Promise.all([
      qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.notes()), qc.ensureQueryData(q.prefs()),
      // What's waiting on you can fail on its own: For you says so, and the rest of Home still works.
      qc.ensureQueryData(q.inbox()).catch(() => undefined),
      // Google can be slow: the calendar gets a moment, so the list doesn't change under the reader, and no longer.
      Promise.race([calendar, new Promise((r) => setTimeout(r, 1200))])
    ]);
  },
  component: Home
});

function Home() {
  const { calendar: inAddress } = Route.useSearch();
  const session = useQuery(q.session()).data;
  const notes = useQuery(q.notes()).data ?? [];
  const calls = useQuery(q.upcoming()).data ?? [];
  const calendar = useQuery(q.calendar()).data;
  const prefs = useQuery(q.prefs()).data;
  const navigate = useNavigate();
  const now = useNow();
  const result = useCalendarReturn(inAddress);
  const me = session?.user.email;
  const evening = useRef<HTMLDivElement>(null);

  const items = aheadShown(calls, calendar?.events, prefs?.showOtherMeetings, now);
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
        <header className="dusk-top" style={{ '--d': 0 }}><h1 className="dusk-title">{longDay(new Date(now))}</h1></header>
        <Start first={firstDay} soon={soon} me={me} now={now} />
        <div className="hm-water" style={{ '--d': 2 }}>
          <ForYou notes={notes} now={now} />
          <Upcoming ahead={items} me={me} now={now} result={result} />
          <Recent notes={notes} me={me} now={now} />
        </div>
        {/* The side panel shows the same check on wide screens; this one is for phones and a hidden panel. */}
        <div className="hm-seal" style={{ '--d': 3 }}><Compute /></div>
      </Evening>
      <SailOutHere page={evening} />
    </>
  );
}

/** Where notes are written, and whether this browser has checked the hardware it runs on. */
function Compute() {
  const checked = useQuery(q.trust());
  const verified = verifiedAt(checked.data);
  const detail = verified !== null ? `Hardware verified ${hm(new Date(verified))}` : checked.isPending ? 'Checking the hardware…' : 'Audio, transcripts and notes are sealed';
  return <SealedBadge title="Confidential compute" detail={detail} className="head-seal" />;
}
