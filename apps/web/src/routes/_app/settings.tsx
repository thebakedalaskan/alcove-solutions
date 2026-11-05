/*
 * Settings: change one thing and leave. You stand on the horizon, in the last of the light, with the tour and Sign out
 * beside you. Under the water the page is one long sheet with an index beside it, which on a narrow screen is a strip
 * that stays at the top. Every control saves as it changes. Search and you at the top right, the phone's avatar and its
 * Settings tab open it; the minutes in the side panel open its minutes.
 */
import { Avatar, Button, Evening } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { arrival } from '~/features/onboarding/store';
import { DevicesPart } from '~/features/settings/Devices';
import { AppearancePart, CalendarPart, NotesPart, NotificationsPart, PlanPart, ProfilePart, RecordingPart, Unloaded } from '~/features/settings/parts';
import { PrivacyPart } from '~/features/settings/Privacy';
import { SavedProvider } from '~/features/settings/save';
import { useSignOutStep } from '~/features/settings/SignOut';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/_app/settings')({
  // A part that doesn't load leaves the rest of the page (and Sign out) usable. Google can be slow: the calendar gets a
  // moment, so the page doesn't move under the reader, and no longer.
  loader: async ({ context: { queryClient: qc } }) => {
    const calendar = qc.ensureQueryData(q.calendar()).catch(() => undefined);
    await Promise.allSettled([qc.ensureQueryData(q.prefs()), qc.ensureQueryData(q.balance()), qc.ensureQueryData(q.team()), Promise.race([calendar, new Promise((r) => setTimeout(r, 1200))])]);
  },
  component: Settings
});

interface Part { id: string; label: string; needs?: 'prefs' | 'credits' | undefined }
const PARTS: readonly Part[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'notes', label: 'Notes', needs: 'prefs' },
  { id: 'recording', label: 'Recording', needs: 'prefs' },
  { id: 'calendar', label: 'Calendar', needs: 'prefs' },
  { id: 'devices', label: 'Devices' },
  { id: 'notifications', label: 'Notifications', needs: 'prefs' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'plan', label: 'Plan and credits', needs: 'credits' },
  { id: 'privacy', label: 'Privacy' }
];

/**
 * The part in view, for the index: the last whose top has passed a quarter of the way down the window, or the last one
 * once the page is scrolled to the end. A part picked in the index (or named in the address) stays picked until the
 * page is scrolled by hand.
 */
function usePartInView(ids: readonly string[]): [string | undefined, (id: string) => void] {
  const [current, setCurrent] = useState(ids[0]);
  const held = useRef(false);
  /** The part just picked in the index, which is on its way there by itself. */
  const going = useRef<string | null>(null);
  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    if (!ids.includes(hash) || going.current === hash) return;
    held.current = true;
    setCurrent(hash);
    // Parts above it may still be loading (the calendar): it stays in place as they arrive, for a moment, unless the
    // page is scrolled by hand meanwhile.
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
    const byHand = () => { held.current = false; going.current = null; };
    look();
    addEventListener('scroll', onScroll, { passive: true });
    for (const e of ['wheel', 'touchstart', 'keydown']) addEventListener(e, byHand, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll);
      for (const e of ['wheel', 'touchstart', 'keydown']) removeEventListener(e, byHand);
    };
  }, [ids]);
  const pick = (id: string) => { held.current = true; going.current = id; setCurrent(id); };
  return [current, pick];
}

/** Moves to a part in the index or the strip, and the address follows. A press that opens it elsewhere is left alone. */
function useJump(pick: (id: string) => void) {
  const navigate = useNavigate();
  return (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    pick(id);
    const part = document.getElementById(id);
    part?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // As a link would: the next Tab carries on from there.
    part?.focus({ preventScroll: true });
    void navigate({ to: '/settings', hash: id, replace: true, resetScroll: false, hashScrollIntoView: false });
  };
}

/** The parts, beside the page: a line with a small sun that goes with the part in view. */
function Index({ parts, current, onJump }: { parts: readonly Part[]; current: string | undefined; onJump: (e: MouseEvent<HTMLAnchorElement>, id: string) => void }) {
  return (
    <nav className="set-idx" aria-label="Settings">
      <ol>{parts.map((p) => <li key={p.id}><a href={`#${p.id}`} className="set-ix" aria-current={current === p.id ? 'true' : undefined} onClick={(e) => onJump(e, p.id)}>{p.label}</a></li>)}</ol>
      <i className="set-mark" style={{ '--i': Math.max(0, parts.findIndex((p) => p.id === current)) }} aria-hidden="true" />
    </nav>
  );
}

/** The parts on a narrow screen: a strip that stays at the top, keeping the part in view in sight. */
function Strip({ parts, current, onJump }: { parts: readonly Part[]; current: string | undefined; onJump: (e: MouseEvent<HTMLAnchorElement>, id: string) => void }) {
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = strip.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (on) strip.current?.scrollTo({ left: on.offsetLeft - 40 });
  }, [current]);
  return (
    <nav ref={strip} className="set-strip" aria-label="Settings">
      {parts.map((p) => <a key={p.id} href={`#${p.id}`} className="set-sx" aria-current={current === p.id ? 'true' : undefined} onClick={(e) => onJump(e, p.id)}>{p.label}</a>)}
    </nav>
  );
}

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

/** Reads a part again. Whatever comes back stands where Try again was, so focus goes to it rather than falling back to the page. */
const readAgain = (read: () => Promise<unknown>, id: string) => void read().then(() => requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true })));

function Settings() {
  const session = useQuery(q.session()).data;
  const prefs = useQuery(q.prefs());
  const credits = useQuery(q.balance());
  const signOut = useSignOutStep();
  const has = (p: Part) => (p.needs === 'prefs' ? Boolean(prefs.data) : p.needs === 'credits' ? Boolean(credits.data) || credits.isError : true);
  const shown = PARTS.filter(has);
  const key = shown.map((p) => p.id).join(' ');
  const ids = useMemo(() => key.split(' '), [key]);
  const [current, pick] = usePartInView(ids);
  const jump = useJump(pick);
  const bar = useTopBar();
  if (!session) return null;
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
          <Index parts={shown} current={current} onJump={jump} />
          <div className="set-parts">
            <Strip parts={shown} current={current} onJump={jump} />
            <ProfilePart session={session} />
            {prefs.data ? (
              <>
                <NotesPart prefs={prefs.data} />
                <RecordingPart prefs={prefs.data} />
                <CalendarPart prefs={prefs.data} />
              </>
            ) : prefs.isError && <Unloaded id="notes" title="Notes, recording, calendar and notifications" busy={prefs.isFetching} onRetry={() => readAgain(prefs.refetch, 'notes')} />}
            <DevicesPart />
            {prefs.data && <NotificationsPart prefs={prefs.data} />}
            <AppearancePart />
            {credits.data ? <PlanPart credits={credits.data} /> : credits.isError && <Unloaded id="plan" title="Plan and credits" busy={credits.isFetching} onRetry={() => readAgain(credits.refetch, 'plan')} />}
            <PrivacyPart session={session} />
          </div>
        </div>
      </Evening>
    </SavedProvider>
  );
}
