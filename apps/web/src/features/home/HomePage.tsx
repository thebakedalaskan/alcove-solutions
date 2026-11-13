/*
 * Home: the page is a sunset with starting a call in the middle of it, because that's what people come here to do.
 * Under the horizon, three widgets: For you (what's yours to answer, and your follow-ups), Upcoming (a calendar, by day)
 * and Recent notes (a row of cards). The day's calls don't lead: people join from their calendar, so a call only comes near
 * the top in its last few minutes. Google sends you back here after connecting the calendar from Upcoming (`calendar`,
 * which Home reads once and drops). Signed in from the welcome page, Home opens by sailing out of its cove
 * (features/onboarding/SailOutHere.tsx). Once, while the plans haven't been shown to the account, Home opens on them instead
 * (features/plans/choice.ts decides; PlanChoice.tsx is the page).
 */
import type { CalendarConnectResult } from '@alcove/api';
import { Evening, SealedBadge } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { usePlanChoice } from '~/features/plans/choice';
import { PlanChoice } from '~/features/plans/PlanChoice';
import { overlayOpen, typing } from '~/lib/keys';
import { useNow } from '~/lib/live';
import { accountQueries } from '~/features/account/queries';
import { callQueries } from '~/features/calls/list/queries';
import { calendarQueries } from '~/features/calls/scheduling/queries';
import { noteQueries } from '~/features/notes/queries';
import { trustQuery, verifiedAt } from '~/lib/trust';
import { hm, longDay } from '~/lib/time';
import { aheadShown, joinable } from '~/features/calls/list/ahead';
import { ForYou } from './ForYou';
import { Recent } from './Recent';
import { SailOutHere } from '~/features/onboarding/SailOutHere';
import { Start } from './Start';
import { Upcoming, useCalendarReturn } from './Upcoming';

/** Home, or once the plans in its place, until they're left (features/plans/choice.ts). */
export function HomePage({ calendar }: { calendar: CalendarConnectResult | undefined }) {
  const choice = usePlanChoice();
  return choice.up ? <PlanChoice onLeave={choice.leave} /> : <Home calendar={calendar} />;
}

function Home({ calendar: inAddress }: { calendar: CalendarConnectResult | undefined }) {
  const session = useQuery(accountQueries.session()).data;
  const notes = useQuery(noteQueries.notes()).data ?? [];
  const calls = useQuery(callQueries.upcoming()).data ?? [];
  const calendar = useQuery(calendarQueries.calendar()).data;
  const prefs = useQuery(accountQueries.prefs()).data;
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
  const checked = useQuery(trustQuery());
  const verified = verifiedAt(checked.data);
  const detail = verified !== null ? `Hardware verified ${hm(new Date(verified))}` : checked.isPending ? 'Checking the hardware…' : 'Audio, transcripts and notes are sealed';
  return <SealedBadge title="Confidential compute" detail={detail} className="head-seal" />;
}
