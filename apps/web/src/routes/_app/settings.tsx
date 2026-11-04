/*
 * Settings: who you are and how Alcove behaves for you, one card per part, with a nav to the parts beside them on a
 * wide screen. Every control saves as it changes. Sign out and the tour of Home are here too. The you-row in the
 * side panel, the phone's avatar and its Settings tab open it; the minutes in the side panel open its minutes.
 */
import { errorMessage } from '@alcove/api';
import { Button, NavItemContent, Notice, useToast, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { arrival } from '~/features/onboarding/store';
import { AppearanceCard, CalendarCard, NotesCard, NotificationsCard, PROVIDER, PlanCard, ProfileCard, RecordingCard } from '~/features/settings/cards';
import { DevicesCard } from '~/features/settings/Devices';
import { PrivacyCard } from '~/features/settings/Privacy';
import { SavedProvider } from '~/features/settings/save';
import { q, useSignOut } from '~/lib/queries';

export const Route = createFileRoute('/_app/settings')({
  // A part that doesn't load leaves the rest of the page (and Sign out) usable.
  loader: async ({ context: { queryClient: qc } }) => { await Promise.allSettled([qc.ensureQueryData(q.prefs()), qc.ensureQueryData(q.balance())]); },
  component: Settings
});

interface Part { id: string; label: string; icon: IconName; needs?: 'prefs' | 'credits' | undefined }
const PARTS: readonly Part[] = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'notes', label: 'Notes', icon: 'notes', needs: 'prefs' },
  { id: 'recording', label: 'Recording', icon: 'recordDot', needs: 'prefs' },
  { id: 'calendar', label: 'Calendar', icon: 'cal', needs: 'prefs' },
  { id: 'devices', label: 'Devices', icon: 'mic' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', needs: 'prefs' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'plan', label: 'Plan and credits', icon: 'coins', needs: 'credits' },
  { id: 'privacy', label: 'Privacy', icon: 'sealed' }
];

/**
 * The part in view, for the nav: the last whose top has passed a quarter of the way down the window, or the last one
 * once the page is scrolled to the end. A part picked in the nav (or named in the address) stays picked until the
 * page is scrolled by hand.
 */
function usePartInView(ids: readonly string[]): [string | undefined, (id: string) => void] {
  const [current, setCurrent] = useState(ids[0]);
  const held = useRef(false);
  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    if (!ids.includes(hash)) return;
    held.current = true;
    setCurrent(hash);
    // Parts above it may still be loading (the company, the calendar): it stays in place as they arrive, for a
    // moment, unless the page is scrolled by hand meanwhile.
    const el = document.getElementById(hash);
    const column = el?.parentElement;
    if (!el || !column) return;
    const keep = new ResizeObserver(() => { if (held.current) el.scrollIntoView({ block: 'start' }); });
    keep.observe(column);
    const t = setTimeout(() => keep.disconnect(), 2000);
    return () => { clearTimeout(t); keep.disconnect(); };
  }, [hash, ids]);
  useEffect(() => {
    let frame = 0;
    const look = () => {
      frame = 0;
      if (held.current) return;
      const line = innerHeight / 4;
      let at = ids[0];
      for (const id of ids) if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= line) at = id;
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) at = ids.at(-1) ?? at;
      setCurrent(at);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(look); };
    const byHand = () => { held.current = false; };
    look();
    addEventListener('scroll', onScroll, { passive: true });
    for (const e of ['wheel', 'touchstart', 'keydown']) addEventListener(e, byHand, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll);
      for (const e of ['wheel', 'touchstart', 'keydown']) removeEventListener(e, byHand);
    };
  }, [ids]);
  const pick = (id: string) => { held.current = true; setCurrent(id); };
  return [current, pick];
}

function Settings() {
  const session = useQuery(q.session()).data;
  const prefs = useQuery(q.prefs());
  const credits = useQuery(q.balance()).data;
  const signOut = useSignOut();
  const navigate = useNavigate();
  const toast = useToast();
  const has = (p: Part) => (p.needs === 'prefs' ? Boolean(prefs.data) : p.needs === 'credits' ? Boolean(credits) : true);
  const shown = PARTS.filter(has);
  const key = shown.map((p) => p.id).join(' ');
  const ids = useMemo(() => key.split(' '), [key]);
  const [current, pick] = usePartInView(ids);
  if (!session) return null;
  const out = () => signOut.mutate(undefined, { onSuccess: () => void navigate({ to: '/welcome', replace: true }), onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  return (
    <SavedProvider>
      <div className="head set-head" style={{ '--d': 0 }}>
        <div>
          <h1>Settings</h1>
          <p className="set-lede">Signed in as {session.user.email} with {PROVIDER[session.provider]}.</p>
        </div>
        <div className="set-acts">
          <Button variant="quiet" icon="compass" onClick={() => arrival.askTour()}>Take the tour</Button>
          <Button variant="secondary" icon="signOut" loading={signOut.isPending} onClick={out}>Sign out</Button>
        </div>
      </div>
      <div className="set-layout" style={{ '--d': 1 }}>
        <nav className="ac-nav set-nav" aria-label="Settings">
          {shown.map((p) => (
            <a key={p.id} href={`#${p.id}`} className="ac-nav-item" aria-current={current === p.id ? 'true' : undefined} onClick={() => pick(p.id)}>
              <NavItemContent icon={p.icon} label={p.label} />
            </a>
          ))}
        </nav>
        <div className="set-main">
          <ProfileCard session={session} />
          {prefs.data ? (
            <>
              <NotesCard prefs={prefs.data} />
              <RecordingCard prefs={prefs.data} />
              <CalendarCard prefs={prefs.data} email={session.user.email} />
            </>
          ) : prefs.isError && (
            <Notice tone="caution" icon="alert" className="set-unloaded">
              <b>Your notes, recording, calendar and notification settings didn’t load.</b> {errorMessage(prefs.error)}{' '}
              <Button variant="secondary" size="sm" loading={prefs.isFetching} onClick={() => void prefs.refetch()}>Try again</Button>
            </Notice>
          )}
          <DevicesCard />
          {prefs.data && <NotificationsCard prefs={prefs.data} />}
          <AppearanceCard />
          {credits && <PlanCard credits={credits} />}
          <PrivacyCard />
        </div>
      </div>
    </SavedProvider>
  );
}
