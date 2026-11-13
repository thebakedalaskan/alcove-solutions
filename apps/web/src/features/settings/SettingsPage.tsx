/*
 * Settings: change one thing and leave. You stand on the horizon, in the last of the light, with the tour and Sign out
 * beside you. Under the water the page is seven groups of panels with an index beside them, which on a narrow screen is a
 * strip that stays at the top. Every control saves as it changes. Your menu opens it, from your face at the top right of
 * every page (and in the phone's top bar), which makes way here since you're in the sky; your plan in the side panel opens
 * Plan, and other pages link to the places in a group they need (Nav.tsx). Google's way back says what it connected
 * (`calendar`, `drive`), and the page lands on it.
 */
import type { CalendarConnectResult, DriveConnectResult } from '@alcove/api';
import { Avatar, Button, Evening, SettingRow, SettingsGroup, SettingsPanel } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { arrival } from '~/features/onboarding/store';
import { accountQueries } from '~/features/account/queries';
import { planQueries } from '~/features/plans/queries';
import { AudioGroup } from './Audio';
import { CallsGroup } from './Calls';
import { ConnectionsGroup } from './Connections';
import { GROUPS, Index, Strip, useGroupInView, useJump, type Group } from './Nav';
import { NotificationsGroup } from './Notifications';
import { PlanGroup } from './Plan';
import { PrivacyGroup } from './Privacy';
import { SavedProvider } from './save';
import { useSignOutStep } from './SignOut';
import { YouGroup } from './You';

/** How tall the phone's top bar is, which the sky runs up under: the offline notice makes it taller. */
function useTopBar(): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>('.ph-head');
    if (!bar) return undefined;
    const say = () => setHeight(bar.offsetHeight);
    say();
    const watch = new ResizeObserver(say);
    watch.observe(bar);
    return () => watch.disconnect();
  }, []);
  return height;
}

/** Reads a group again. Whatever comes back stands where Try again was, so focus goes to the group rather than falling back to the page. */
const readAgain = (read: () => Promise<unknown>, id: string) => void read().then(() => requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true })));

/** What stands in for a group that didn't load: the rest of the page, and Sign out, still work. */
function Unloaded({ group, busy, onRetry }: { group: Group; busy: boolean; onRetry: () => void }) {
  return (
    <SettingsGroup id={group.id} title={group.label}>
      <SettingsPanel>
        <SettingRow label="These didn’t load" help="The rest of the page still works." control={<Button variant="secondary" size="sm" icon="retry" loading={busy} onClick={onRetry}>Try again</Button>} />
      </SettingsPanel>
    </SettingsGroup>
  );
}

export function SettingsPage({ calendar, drive }: { calendar: CalendarConnectResult | undefined; drive: DriveConnectResult | undefined }) {
  const hash = useRouterState({ select: (s) => s.location.hash });
  const session = useQuery(accountQueries.session()).data;
  const prefs = useQuery(accountQueries.prefs());
  const plan = useQuery(planQueries.plan());
  const signOut = useSignOutStep();
  // A group waiting on what it shows comes in once that's here, or once it's failed and says so.
  const hasPrefs = Boolean(prefs.data) || prefs.isError;
  const hasPlan = Boolean(plan.data) || plan.isError;
  const shown = useMemo(() => GROUPS.filter((g) => (g.id === 'calls' || g.id === 'notifications' ? hasPrefs : g.id === 'plan' ? hasPlan : true)), [hasPrefs, hasPlan]);
  const ids = useMemo(() => shown.map((g) => g.id), [shown]);
  const column = useRef<HTMLDivElement>(null);
  // Google's way back lands on what it connected: Drive, or the calendar.
  const [current, pick] = useGroupInView(ids, hash || (drive ? 'google-drive' : calendar ? 'calendar' : undefined), column);
  const jump = useJump(pick);
  const bar = useTopBar();
  if (!session) return null;
  /** Each group the index lists, in its order: a group that needs what didn't load says so in its place. */
  const render = (g: Group) => {
    switch (g.id) {
      case 'you': return <YouGroup session={session} />;
      case 'calls': return prefs.data ? <CallsGroup prefs={prefs.data} /> : <Unloaded group={g} busy={prefs.isFetching} onRetry={() => readAgain(prefs.refetch, g.id)} />;
      case 'audio': return <AudioGroup />;
      case 'notifications': return prefs.data ? <NotificationsGroup /> : <Unloaded group={g} busy={prefs.isFetching} onRetry={() => readAgain(prefs.refetch, g.id)} />;
      case 'connections': return <ConnectionsGroup calendar={calendar} drive={drive} />;
      case 'plan': return plan.data ? <PlanGroup plan={plan.data} /> : <Unloaded group={g} busy={plan.isFetching} onRetry={() => readAgain(plan.refetch, g.id)} />;
      case 'privacy': return <PrivacyGroup session={session} />;
    }
  };
  return (
    <SavedProvider>
      <Evening moment="settings" className="set" data-out={signOut.asking ? true : undefined} style={{ '--ask': `${signOut.height}px`, '--bar': `${bar}px` }}>
        <header className="set-band" style={{ '--d': 0 }}>
          <div className="set-me">
            <Avatar person={session.user} size={64} />
            <div className="set-who">
              <h1 className="set-name ac-clamp-1">{session.user.name}</h1>
              <p className="set-mail ac-clamp-1">{session.user.email}</p>
            </div>
            <span className="set-glow" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <div className="set-acts">
            <Button variant="quiet" size="sm" icon="compass" onClick={() => arrival.askTour()}>Take the tour</Button>
            {signOut.button}
          </div>
          {signOut.step}
        </header>
        <div className="set-body" style={{ '--d': 1 }}>
          <Index groups={shown} current={current} onJump={jump} />
          <div ref={column} className="set-groups">
            <Strip groups={shown} current={current} onJump={jump} />
            {shown.map((g) => <Fragment key={g.id}>{render(g)}</Fragment>)}
          </div>
        </div>
      </Evening>
    </SavedProvider>
  );
}
