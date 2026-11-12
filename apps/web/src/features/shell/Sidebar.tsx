/*
 * The side panel, beside every page and dark in both themes, in two groups. At the top, your work: Start a call, then
 * Home, Calls, Drive and Record, and what you've pinned under them. At the foot, who works with you (Team and Agents),
 * then a call that's about to start, with Join, the confidential-compute check and the minutes of notes left. A count
 * means something waits on you. Someone on their own has no Team page. It can be hidden. At 860px and narrower the
 * phone's top bar and tab bar (TabBar.tsx) take its place.
 */
import { ArchThumb, Icon, IconButton, Kbd, Logo, Meter, NavItemContent, SidebarNav, buttonClass, cn, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { aheadOf, joinable, whenLine } from '~/features/home/day';
import { recordOfflineHere } from '~/lib/device';
import { log } from '~/lib/log';
import { useNow, useOnline } from '~/lib/live';
import { q, trustLine, verifiedAt } from '~/lib/queries';
import { hm, hoursAndMinutes } from '~/lib/time';
import { NAV, NAV_FOOT, inWorkspace, places, useCounts, type NavPlace } from './places';

const KEY = 'alcove-side-panel';
const slog = log.child({ component: 'shell' });
const hiddenBefore = () => {
  try { return localStorage.getItem(KEY) === 'hidden'; } catch (e) { slog.warn('side panel choice not read: no storage here', { err: e }); return false; }
};

/**
 * Whether the side panel is hidden, remembered in this browser. Hiding or showing it moves focus to the
 * button that brings it back, since the one that was pressed is gone.
 */
export function useSidePanel() {
  const [hidden, setHidden] = useState(hiddenBefore);
  const showRef = useRef<HTMLButtonElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (hidden ? showRef : hideRef).current?.focus();
  }, [hidden]);
  const set = (h: boolean) => {
    moved.current = true;
    setHidden(h);
    // Without storage it's remembered until the tab closes.
    try { localStorage.setItem(KEY, h ? 'hidden' : 'shown'); } catch (e) { slog.warn('side panel choice not kept: no storage here', { err: e }); }
  };
  return { hidden, hide: () => set(true), show: () => set(false), showRef, hideRef };
}

/**
 * Says the connection is gone, and what still works: in the side panel, at the top of the page while the
 * panel is hidden (`show`), and under the phone's top bar. The status region stays in place and fills
 * when the connection drops, so screen readers announce it.
 */
export function Offline({ show = true, className }: { show?: boolean | undefined; className?: string | undefined }) {
  const online = useOnline();
  return (
    <div role="status" className={className}>
      {!online && show && (
        <div className="sb-status">
          <Icon name="wifiOff" size={16} />
          <span><b>You’re offline</b>{recordOfflineHere()
            ? 'Recording still works. Everything else catches up when you’re back.'
            : 'Everything catches up when you’re back. Recording without a connection is off in Settings.'}</span>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ hidden, hideRef, onHide, onNew, onPin }: {
  hidden: boolean; hideRef: RefObject<HTMLButtonElement | null>; onHide: () => void;
  onNew: () => void; onPin: () => void;
}) {
  const online = useOnline();
  const counts = useCounts();
  const team = useQuery(q.team()).data;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const link = (p: NavPlace) => <Link key={p.to} to={p.to} className="ac-nav-item" data-tour={p.tour}><NavItemContent icon={p.icon} label={p.label} count={p.count && counts[p.count]} /></Link>;
  return (
    <aside className="sb dark" aria-label="Side panel" inert={hidden}>
      <div className="sb-in">
        <div className="sb-top">
          <Link to="/home" className="sb-home" aria-label="Alcove, Home"><Logo /></Link>
          <IconButton ref={hideRef} icon="panel" label="Hide the side panel" onClick={onHide} />
        </div>
        <Offline className="sb-offline" />
        {/* In the workspace, N makes a document. */}
        <button type="button" className={cn(buttonClass(), 'sb-new')} onClick={onNew} aria-label="Start a call" aria-haspopup="dialog" aria-keyshortcuts={inWorkspace(path) ? undefined : 'N'}>
          <span className="sb-new-ic"><Icon name="video" size={16} /></span><span>Start a call</span>{!inWorkspace(path) && <Kbd>N</Kbd>}
        </button>
        <SidebarNav>{NAV.map(link)}</SidebarNav>
        <div className="sb-mid">
          <Pinned onPin={onPin} />
        </div>
        <SidebarNav label="Team and agents" className="sb-low">{places(NAV_FOOT, team).map(link)}</SidebarNav>
        {online && <AboutToStart home={path === '/home'} />}
        <Foot online={online} />
      </div>
    </aside>
  );
}

/** From this long before a call, the side panel offers it with Join. */
const NEAR_MS = 10 * 60_000;

/**
 * A call that's about to start, at the foot of the panel with Join, on every page: one that's going, or one with someone
 * else on it from ten minutes before until it ends, by Home's own rule (`joinable`) looking further ahead. The rest of the
 * day is Home's Upcoming. On Home it makes way while Home's own line offers the call, from its last few minutes and while
 * it's going, so there's one Join at a time. Offline there's nothing to join.
 */
function AboutToStart({ home }: { home: boolean }) {
  const now = useNow();
  const me = useQuery(q.session()).data?.user.email;
  const calls = useQuery(q.upcoming()).data;
  const calendar = useQuery(q.calendar()).data;
  const prefs = useQuery(q.prefs()).data;
  const events = prefs?.showOtherMeetings === false ? [] : calendar?.events ?? [];
  const ahead = aheadOf(calls ?? [], events, now);
  const next = joinable(ahead, me, now, NEAR_MS);
  if (!next || (home && joinable(ahead, me, now))) return null;
  const when = whenLine(next, now);
  return (
    <div className="sb-now" role="group" aria-label={`${next.title}, ${when.toLowerCase()}`}>
      <ArchThumb cover={coverFor(next.id)} width={24} />
      <div className="min-w-0"><b>{next.title}</b><small>{when}</small></div>
      {next.kind === 'call'
        ? <Link to="/join/$code" params={{ code: next.call.code }} className={buttonClass({ size: 'sm' })} aria-label={`Join ${next.title}`}><Icon name="video" size={15} />Join</Link>
        : next.event.join && <a href={next.event.join.url} target="_blank" rel="noreferrer" className={buttonClass({ size: 'sm' })} aria-label={`Join ${next.title} on ${next.event.join.label}`}><Icon name="video" size={15} />Join</a>}
    </div>
  );
}

/**
 * Notes you keep coming back to, in the order you pinned them. Until you pin one there's no Pinned at all: a call's page has
 * a pin, and once Pinned shows, the pin at the end of its heading opens Pin a note. A pin whose note is gone isn't shown.
 */
function Pinned({ onPin }: { onPin: () => void }) {
  const ids = useQuery(q.prefs()).data?.pinned;
  const notes = useQuery(q.notes()).data;
  const pinned = (ids ?? []).flatMap((id) => notes?.filter((n) => n.id === id) ?? []);
  if (!pinned.length) return null;
  return (
    <div className="sb-sec sb-pins">
      <div className="sb-sec-h"><h2 className="ac-eyebrow">Pinned</h2><IconButton icon="pin" size={15} label="Pin a note" aria-haspopup="dialog" onClick={onPin} /></div>
      <ul className="sb-list">
        {pinned.map((n) => (
          <li key={n.id}>
            <Link to="/calls/$noteId" params={{ noteId: n.id }} className="sb-link"><ArchThumb cover={coverFor(n.id)} room={n.kind === 'room'} width={15} /><span>{n.title}</span></Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The check, and the minutes of notes left (Settings' minutes). */
function Foot({ online }: { online: boolean }) {
  const credits = useQuery(q.balance()).data;
  const trust = useQuery(q.trust()).data;
  const verified = verifiedAt(trust);
  return (
    <div className="sb-foot">
      {online && <p className="sb-seal" title={verified === null ? undefined : `Hardware checked at ${hm(new Date(verified))}`}><Icon name="sealed" size={15} />{trustLine(trust)}</p>}
      {credits && (
        <Link to="/settings" hash="plan" activeOptions={{ includeHash: true }} className="sb-credits">
          <span><b>{hoursAndMinutes(credits.balance / credits.perMinute)}</b> of notes left</span>
          <Meter value={credits.balance / Math.max(1, credits.granted)} />
        </Link>
      )}
    </div>
  );
}
