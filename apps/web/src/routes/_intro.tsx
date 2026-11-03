import { Logo } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Stage, type Arrival } from '~/features/welcome/Stage';
import { q } from '~/lib/queries';
import { daysFromToday } from '~/lib/time';

/*
 * First run: welcome and signed-in share one stage, so the note carries through sign-in while the
 * words on the left change.
 */
export const Route = createFileRoute('/_intro')({ component: Intro });

function Intro() {
  const ready = useRouterState({ select: (s) => s.location.pathname.startsWith('/ready') });
  const session = useQuery({ ...q.session(), enabled: ready }).data;
  const upcoming = useQuery({ ...q.upcoming(), enabled: ready && !!session }).data;
  const team = useQuery({ ...q.team(), enabled: ready && !!session }).data ?? null;
  const calendar = useQuery({ ...q.calendar(), enabled: ready && !!session }).data;
  const arrival = useMemo<Arrival | undefined>(() => {
    if (!ready || !session || !upcoming) return undefined;
    const now = Date.now();
    const fromGoogle = calendar?.source === 'google' && !calendar.needsAccess;
    // Today's calls and calendar events, soonest first.
    const today = [
      ...upcoming.map((m) => ({ id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, people: m.guests })),
      ...(fromGoogle ? calendar.events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, people: e.isOrganizer ? e.guests : [e.organizer, ...e.guests] })) : [])
    ].filter((x) => daysFromToday(new Date(x.startsAt)) === 0 && new Date(x.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return { person: session.user, provider: session.provider, calendar: session.sample || fromGoogle, today, team };
  }, [ready, session, upcoming, team, calendar]);
  return (
    <div className="in world-in">
      <section className="in-left">
        <Logo />
        <div className="in-copy"><Outlet /></div>
      </section>
      <section className="in-right"><Stage step={ready ? 'ready' : 'welcome'} arrival={arrival} /></section>
    </div>
  );
}
