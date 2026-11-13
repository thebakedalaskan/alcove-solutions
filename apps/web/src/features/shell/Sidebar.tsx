/*
 * The side panel, beside every page and dark in both themes, in two groups. At the top, your work: Start a call, then
 * Home, Calls, Drive and Record, and what you've pinned under them. At the foot, who works with you (Team and Agents),
 * then a call that's about to start, with Join, the confidential-compute check and your plan: one row, with a short line
 * above it only while there's something to say. A count means something waits on you. Someone on their own, with no
 * company and no team, has no Team page. It can be hidden. At 860px and narrower the phone's top bar and tab bar (TabBar.tsx) take its place, and the plan
 * is said in Settings.
 */
import type { MyTeam, Plan, PlanNotice, WorkspaceSummary } from '@alcove/api';
import { ArchThumb, Dots, Icon, IconButton, Kbd, Logo, Meter, NavItemContent, SidebarNav, SunMark, buttonClass, cn, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { aheadShown, joinable, whenLine } from '~/features/home/day';
import { useCheckout } from '~/features/plans/checkout';
import {
  PLAN_NAMES, endsIn, licensesLeft, licensesShort, noticesNow, notesLeft, notesLow, notesOut, notesShare, paidFor, payingNow, proEnding, teamAdmin,
  waitingForLicense
} from '~/features/plans/plan-state';
import { checkoutFor, payable, purchaseName, restToSend, settlingPurchase, tokensShort, waitingPurchase } from '~/features/plans/purchase';
import { recordOfflineHere } from '~/lib/device';
import { log } from '~/lib/log';
import { useNow, useOnline } from '~/lib/live';
import { callName } from '~/lib/people';
import { q, trustLine, unverifiedBecause, verifiedAt } from '~/lib/queries';
import { dayMonth, hm, shortDate } from '~/lib/time';
import { plural } from '~/lib/words';
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
  const mine = useQuery(q.myTeam()).data;
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
        <SidebarNav label="Team and agents" className="sb-low">{places(NAV_FOOT, team, mine).map(link)}</SidebarNav>
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
  const ahead = aheadShown(calls, calendar?.events, prefs?.showOtherMeetings, now);
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

/** The check (pointing at it says when it passed, or why it didn't), then your plan (Settings' Plan). */
function Foot({ online }: { online: boolean }) {
  const plan = useQuery(q.plan()).data;
  const trust = useQuery(q.trust()).data;
  const verified = verifiedAt(trust);
  const failed = unverifiedBecause(trust);
  return (
    <div className="sb-foot">
      {/* A check that didn't pass says why beside a shield without its tick, never a ticked one. */}
      {online && <p className="sb-seal" title={verified === null ? failed ?? undefined : `Hardware checked at ${hm(new Date(verified))}`}><Icon name={failed === null ? 'sealed' : 'shieldOff'} size={15} />{trustLine(trust)}</p>}
      {plan && <PlanFoot plan={plan} />}
    </div>
  );
}

/**
 * Your plan, as one row where the minutes of notes left were. On Free, about how much of the period's notes is left over a
 * meter, warm under an hour, and until when once they've stopped. On Pro or Team, the plan with its own small sun in the
 * icon column, and under its name what matters most: that it's ending (its sun half set, opening checkout to extend), that
 * notes have stopped, that a team's licenses run short (for its admin: how many are left and Buy, opening checkout on Team),
 * that notes are low, or until when Pro runs, or the team's name. On a team without a license you're on your own plan, and
 * told so over it in caution, with who has been told (NoLicense); Free's row then goes to Team. A payment for a plan on its
 * way takes the row's place, saying what it's waiting for, and opens it again. Anything else said (Pro renewed or ended,
 * Team replacing Pro, a team's licenses) is one short line above it, until it's dismissed in Settings. On Plans, a paid
 * plan's row, or a payment's, is the place you're on, shaded, as is Free's row under its notes.
 */
function PlanFoot({ plan }: { plan: Plan }) {
  // On a team: who its admin is, and for the admin how many licenses are left.
  const team = useQuery({ ...q.myTeam(), enabled: plan.team !== null }).data;
  // The workspaces you're in, read only while a notice says you pay for one now: it's named from there.
  const spaces = useQuery({ ...q.workspaces(), enabled: plan.notices.some(payingNow) }).data;
  // Read again only while the foot shows a payment: every 30 s while one is on its way, every 5 minutes while one settles.
  const topUps = useQuery({
    ...q.topUps(),
    refetchInterval: (query) => (waitingPurchase(query.state.data) ? 30_000 : settlingPurchase(query.state.data) ? 300_000 : false)
  }).data;
  const checkout = useCheckout();
  const now = useNow();
  const on = useRouterState({ select: (s) => s.location.pathname }) === '/plans';
  // A payment on its way first; else one whose address closed with less than asked arrived, which is being settled.
  const buying = waitingPurchase(topUps, undefined, now) ?? settlingPurchase(topUps, now);
  if (buying) {
    const { route, state, asked, purchase } = buying;
    const settling = state === 'short' && !payable(buying, now);
    const short = state === 'short' && !settling;
    return (
      <>
        <p className={cn('sb-wait', short && 'is-out', settling && 'is-settling')}>
          {!short && !settling && <Dots />}
          {settling ? `Address closed, settling ${tokensShort(buying.received?.amount ?? '0')} ${route.token}`
            : short ? `Send ${tokensShort(restToSend(buying))} ${route.token} more`
            : state === 'waiting' ? `Waiting for ${tokensShort(asked.amount)} ${route.token}`
            : purchase.buys.kind === 'pro' ? 'Payment seen, starting Pro' : purchase.buys.kind === 'licenses' ? 'Payment seen, adding licenses' : 'Payment seen, adding notes'}
        </p>
        <button type="button" className={cn('sb-plan', on && 'is-on')} onClick={() => checkout.reopen(buying.id, checkoutFor(purchase.buys), 'side')}>
          <span className="ac-clamp-1">{purchaseName(purchase.buys)}</span><span className="go">Open<Icon name="chevron" size={15} /></span>
        </button>
      </>
    );
  }
  const out = notesOut(plan);
  const low = notesLow(plan);
  const waiting = waitingForLicense(plan);
  const notices = noticesNow(plan, team, spaces, now);
  // A team's licenses running short are said by its row, unless notes have stopped, which come first there: then above it.
  const short = plan.kind === 'team' && !out ? notices.find(licensesShort) : undefined;
  const said = notices.find((n) => n !== short);
  const notice = said && <Link to="/settings" hash="plan" className="sb-said"><Said notice={said} plan={plan} team={team} spaces={spaces} /></Link>;
  const noLicense = waiting && <NoLicense plan={plan} team={team} />;
  if (plan.kind === 'free') return <>{notice}{noLicense}<NotesLeft plan={plan} /><FreeRow plan={plan} waiting={waiting} on={on} /></>;
  const ending = proEnding(plan, now);
  const until = plan.pro.until;
  return (
    <>
      {notice}
      {noLicense}
      {short ? (
        <button type="button" className={cn('sb-pro', on && 'is-on')} onClick={() => checkout.open({ plan: 'team' }, 'side')}>
          <SunMark />
          <span className="min-w-0"><b>{PLAN_NAMES.team}</b><small className="is-warm">{licensesLeftWords(licensesLeft(short, team))} · Buy</small></span>
          <Icon name="chevron" size={15} />
        </button>
      ) : ending ? (
        <button type="button" className={cn('sb-pro', on && 'is-on')} onClick={() => checkout.open({ plan: 'pro' }, 'side')}>
          <SunMark state="setting" />
          <span className="min-w-0"><b>{PLAN_NAMES[plan.kind]}</b><small className="is-warm">{endsIn(ending.days)} · Extend</small></span>
          <Icon name="chevron" size={15} />
        </button>
      ) : (
        <Link to="/settings" hash="plan" className={cn('sb-pro', on && 'is-on')}>
          <SunMark />
          <span className="min-w-0">
            <b>{PLAN_NAMES[plan.kind]}</b>
            {out ? <small className="is-out">No notes left until {dayMonth(new Date(plan.period.to))}</small>
              : low ? <small className="is-warm">About {notesLeft(plan)} of notes left</small>
                : plan.kind === 'team' ? plan.team && <small>{plan.team.name}</small>
                  : until !== null && <small>Until {shortDate(new Date(until))}</small>}
          </span>
          <Icon name="chevron" size={15} />
        </Link>
      )}
    </>
  );
}

/**
 * Free's plan, under its notes left (docs/design/canvas/plans Side): Free plan · See plans, which opens Plans; once notes are
 * low or out, Get Pro, which opens checkout; on a team without a license, Team, which says who has been told.
 */
function FreeRow({ plan, waiting, on }: { plan: Plan; waiting: boolean; on: boolean }) {
  const checkout = useCheckout();
  const label = (go: string) => <><span>Free plan</span><span className="go">{go}<Icon name="chevron" size={15} /></span></>;
  if (waiting) return <Link to="/team" className="sb-plan">{label('Team')}</Link>;
  if (notesOut(plan) || notesLow(plan)) {
    return <button type="button" className={cn('sb-plan', on && 'is-on')} onClick={() => checkout.open({ plan: 'pro' }, 'side')}>{label('Get Pro')}</button>;
  }
  return <Link to="/plans" className={cn('sb-plan', on && 'is-on')}>{label('See plans')}</Link>;
}

/** How many licenses a team has left to take, as its row and its notice say it. */
const licensesLeftWords = (left: number): string => (left === 0 ? 'No licenses left' : `${plural(left, 'license')} left`);

/**
 * A notice in one short line, its news in bold: Pro renewed or ended, a team license replacing Pro, a team's licenses, and
 * a workspace you pay for now, by its name, held to two lines however long that is.
 */
function Said({ notice, plan, team, spaces }: { notice: PlanNotice; plan: Plan; team: MyTeam | null | undefined; spaces: WorkspaceSummary[] | undefined }) {
  const on = plan.team ? ` on ${plan.team.name}` : '';
  switch (notice.kind) {
    case 'pro-renewed': return <><b>Pro renewed</b> from your balance</>;
    case 'license-replaced-pro': return notice.count ? <><b>Team replaced Pro.</b> {plural(notice.count, 'month')} refunded</> : <><b>Team replaced Pro</b></>;
    case 'licenses-low': case 'licenses-none': return <><b>{licensesLeftWords(licensesLeft(notice, team))}</b>{on}</>;
    case 'pro-ended': return <><b>Pro ended.</b> Nothing was deleted.</>;
    case 'workspace-payer': {
      const paying = paidFor(notice, spaces);
      if (!paying) return null;
      return <span className="ac-clamp-2"><b>You pay for {paying.name} now.</b> {notice.until === null ? 'Its files count against your storage' : `Its files count from ${dayMonth(new Date(notice.until))}`}</span>;
    }
    // Said elsewhere: Pro ending by its own row, and waiting for a license by the line over your own plan (NoLicense).
    case 'pro-ending': case 'license-needed': return null;
  }
}

/**
 * On a team without a license, in caution over your own plan (the canvas's Side board, teamWait): who has been told, or for
 * its admin, that buying licenses gives them one.
 */
function NoLicense({ plan, team }: { plan: Plan; team: MyTeam | null | undefined }) {
  const admin = teamAdmin(team);
  return (
    <p className="sb-nolic">
      No team license yet
      <small>{plan.team?.role === 'admin' ? 'Buy licenses, and one is yours' : `${admin ? callName(admin) : 'Its admin'} has been told`}</small>
    </p>
  );
}

/** About how much of the period's notes is left, over a meter: warm under an hour, and once they've stopped, until when. */
function NotesLeft({ plan }: { plan: Plan }) {
  const out = notesOut(plan);
  return (
    <Link to="/settings" hash="plan" activeOptions={{ includeHash: true }} className={cn('sb-left', out ? 'is-out' : notesLow(plan) && 'is-warm')}>
      {out ? <span>No notes left until {dayMonth(new Date(plan.period.to))}</span> : <span><b>About {notesLeft(plan)}</b> of notes left</span>}
      <Meter value={out ? 0 : notesShare(plan)} className="sb-meter" />
    </Link>
  );
}
