/*
 * The side panel, beside every page and dark in both themes: Start a call, the app's places, the next call with
 * Join, pinned notes, groups, the confidential-compute check and your plan. Someone on their own has no Team page and
 * no groups. It can be hidden. At 860px and narrower the phone's top bar and tab bar (TabBar.tsx) take its place, and
 * the plan is said in Settings.
 */
import { NEW_GROUP, type CalendarEvent, type Meeting, type Person, type Plan } from '@alcove/api';
import { ArchThumb, Dots, Faces, Icon, IconButton, Kbd, Logo, Meter, NavItemContent, SidebarNav, SunMark, buttonClass, cn, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { aheadOf, joinable } from '~/features/home/day';
import { useCheckout } from '~/features/plans/checkout';
import { PLAN_NAMES, endsIn, noticesNow, notesLeft, notesLow, notesOut, notesShare, proEnding } from '~/features/plans/plan-state';
import { checkoutFor, payable, purchaseName, restToSend, settlingPurchase, tokensShort, waitingPurchase } from '~/features/plans/purchase';
import { recordOfflineHere } from '~/lib/device';
import { log } from '~/lib/log';
import { useNow, useOnline } from '~/lib/live';
import { sameEmail } from '~/lib/people';
import { q, trustLine, verifiedAt } from '~/lib/queries';
import { dayMonth, daysFromToday, hm, minutesUntil, shortDate, untilLabel } from '~/lib/time';
import { NAV, inWorkspace, places, useCounts } from './places';

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
  return (
    <aside className="sb dark" aria-label="Side panel" inert={hidden}>
      <div className="sb-in">
        <div className="sb-top">
          <Link to="/home" className="sb-home" aria-label="Alcove, Home"><Logo /></Link>
          <IconButton ref={hideRef} icon="panel" label="Hide the side panel" onClick={onHide} />
        </div>
        <Offline className="sb-offline" />
        {/* In the workspace, N makes a document. */}
        <button type="button" className={cn(buttonClass(), 'sb-new')} onClick={onNew} aria-label="Start a call" aria-haspopup="dialog" aria-keyshortcuts={inWorkspace(path) ? undefined : 'N'} data-tour="new-call">
          <span className="sb-new-ic"><Icon name="video" size={16} /></span><span>Start a call</span>{!inWorkspace(path) && <Kbd>N</Kbd>}
        </button>
        <SidebarNav>
          {places(NAV, team).map((p) => <Link key={p.to} to={p.to} className="ac-nav-item" data-tour={p.tour}><NavItemContent icon={p.icon} label={p.label} count={p.count && counts[p.count]} /></Link>)}
        </SidebarNav>
        <div className="sb-mid">
          {online && <UpNext home={path === '/home'} />}
          <Pinned onPin={onPin} />
          {team !== null && <Groups />}
        </div>
        <Foot online={online} />
      </div>
    </aside>
  );
}

/** The next call you can join today: an Alcove call, or a calendar meeting with a video link. */
interface Next { id: string; title: string; startsAt: string; endsAt: string; people: Person[]; join: { kind: 'call'; code: string } | { kind: 'link'; url: string; label: string } }

function nextToday(calls: Meeting[], events: CalendarEvent[], me: string | undefined, now: number): Next | undefined {
  const others = (people: Person[]) => people.filter((p) => !me || !sameEmail(p, { email: me }));
  const all: Next[] = [
    ...calls.filter((m) => m.status !== 'ended' && !m.offer).map((m): Next => ({
      id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, people: others(m.isOrganizer ? m.guests : [m.organizer, ...m.guests]), join: { kind: 'call', code: m.code }
    })),
    ...events.flatMap((e): Next[] => (e.join ? [{
      id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, people: others(e.isOrganizer ? e.guests : [e.organizer, ...e.guests]), join: { kind: 'link', ...e.join }
    }] : []))
  ];
  return all
    .filter((i) => new Date(i.endsAt).getTime() > now && (daysFromToday(new Date(i.startsAt)) === 0 || new Date(i.startsAt).getTime() <= now))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
}

/**
 * Up next, with Join, on every page. On Home (`home`) it makes way while Home's own line offers a call, from a call's last
 * few minutes and while one is going, by Home's own rule (`joinable`), so there's one Join at a time. Offline there's
 * nothing to join. With nothing left today it says where the next call will show, except on the first day, before any
 * notes, when it keeps quiet.
 */
function UpNext({ home }: { home: boolean }) {
  const now = useNow();
  const me = useQuery(q.session()).data?.user.email;
  const calls = useQuery(q.upcoming()).data;
  const calendar = useQuery(q.calendar()).data;
  const prefs = useQuery(q.prefs()).data;
  const notes = useQuery(q.notes()).data;
  const events = prefs?.showOtherMeetings === false ? [] : calendar?.events ?? [];
  const next = nextToday(calls ?? [], events, me, now);
  if (home && joinable(aheadOf(calls ?? [], events, now), me, now)) return null;
  if (!next && (!calls || !notes?.length)) return null;
  return (
    <div className="sb-sec">
      <div className="sb-sec-h"><h2 className="ac-eyebrow">Up next</h2></div>
      {next ? (
        <div className="sb-next">
          <div className="sb-next-top">
            <ArchThumb cover={coverFor(next.id)} width={28} />
            <div className="min-w-0"><b>{next.title}</b><small>{hm(next.startsAt)} · {untilLabel(minutesUntil(next.startsAt, now))}</small></div>
          </div>
          <div className="sb-next-foot">
            {next.people.length > 0 && <Faces people={next.people} size={22} max={4} />}
            {next.join.kind === 'call'
              ? <Link to="/join/$code" params={{ code: next.join.code }} className={buttonClass({ size: 'sm' })} aria-label={`Join ${next.title}`}><Icon name="video" size={16} />Join</Link>
              : <a href={next.join.url} target="_blank" rel="noreferrer" className={buttonClass({ size: 'sm' })} aria-label={`Join ${next.title} on ${next.join.label}`}><Icon name="video" size={16} />Join</a>}
          </div>
        </div>
      ) : <p className="sb-hint">Nothing else today. Your next call shows here, with Join.</p>}
    </div>
  );
}

/** Notes you keep coming back to, in the order you pinned them. A pin whose note is gone isn't shown. */
function Pinned({ onPin }: { onPin: () => void }) {
  const ids = useQuery(q.prefs()).data?.pinned;
  const notes = useQuery(q.notes()).data;
  const pinned = (ids ?? []).flatMap((id) => notes?.filter((n) => n.id === id) ?? []);
  return (
    <div className="sb-sec">
      <div className="sb-sec-h"><h2 className="ac-eyebrow">Pinned</h2><IconButton icon="pin" size={15} label="Pin a note" aria-haspopup="dialog" onClick={onPin} /></div>
      {pinned.length ? (
        <ul className="sb-list">
          {pinned.map((n) => (
            <li key={n.id}>
              <Link to="/notes/$noteId" params={{ noteId: n.id }} className="sb-link"><ArchThumb cover={coverFor(n.id)} room={n.kind === 'room'} width={15} /><span>{n.title}</span></Link>
            </li>
          ))}
        </ul>
      ) : ids && notes ? <p className="sb-hint">Pin notes you keep coming back to, like a weekly call, and they stay here.</p> : null}
    </div>
  );
}

/** Your groups: a name and how many people are in it. Each opens on the Team page, where + makes a new one. */
function Groups() {
  const groups = useQuery(q.prefs()).data?.groups ?? [];
  if (!groups.length) return null;
  return (
    <div className="sb-sec">
      <div className="sb-sec-h">
        <h2 className="ac-eyebrow">Groups</h2>
        <Link to="/team" search={{ group: NEW_GROUP }} className="ac-icon-btn" aria-label="New group" title="New group"><Icon name="plus" size={15} /></Link>
      </div>
      <ul className="sb-list">
        {groups.map((g) => (
          <li key={g.id}>
            <Link to="/team" search={{ group: g.id }} className="sb-link">
              <Icon name="hash" size={15} /><span>{g.name}</span>
              <b className="n">{g.emails.length}<span className="sr-only"> {g.emails.length === 1 ? 'person' : 'people'}</span></b>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The check, then your plan (Settings' Plan). On Free, about how much of the period's notes is left over a meter, then Free
 * plan with the way to Plans; on Pro, one row like the places with its own small sun and until when. A plan about to end
 * sets its sun half and opens checkout to extend; a payment for a plan on its way says what it's waiting for, and its row
 * opens it again. Pro renewed or ended is one short line above, until it's dismissed in Settings. On Plans the row is
 * the place you're on.
 */
function Foot({ online }: { online: boolean }) {
  const plan = useQuery(q.plan()).data;
  const trust = useQuery(q.trust()).data;
  const verified = verifiedAt(trust);
  return (
    <div className="sb-foot">
      {online && <p className="sb-seal" data-tour="sealed" title={verified === null ? undefined : `Hardware checked at ${hm(new Date(verified))}`}><Icon name="sealed" size={15} />{trustLine(trust)}</p>}
      {plan && <PlanFoot plan={plan} />}
    </div>
  );
}

function PlanFoot({ plan }: { plan: Plan }) {
  const offers = useQuery(q.offers()).data;
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
            : purchase.buys.kind === 'pro' ? 'Payment seen, starting Pro' : 'Payment seen, adding notes'}
        </p>
        <button type="button" className={cn('sb-plan', on && 'is-on')} onClick={() => checkout.reopen(buying.id, checkoutFor(purchase.buys), 'side')}>
          <span className="ac-clamp-1">{purchaseName(purchase.buys, offers)}</span><span className="go">Open<Icon name="chevron" size={15} /></span>
        </button>
      </>
    );
  }
  const said = noticesNow(plan)[0];
  const ending = proEnding(plan, offers, now);
  const until = plan.pro.until;
  return (
    <>
      {said && (
        <Link to="/settings" hash="plan" className="sb-said">
          {said.kind === 'pro-renewed' ? <><b>Pro renewed</b> from your balance</> : <><b>Pro ended.</b> Nothing was deleted.</>}
        </Link>
      )}
      {(plan.kind === 'free' || notesLow(plan) || notesOut(plan)) && <NotesLeft plan={plan} />}
      {plan.kind === 'free' ? (
        <Link to="/plans" className={cn('sb-plan', on && 'is-on')}>
          <span>Free plan</span><span className="go">See plans<Icon name="chevron" size={15} /></span>
        </Link>
      ) : ending ? (
        <button type="button" className={cn('sb-pro', on && 'is-on')} onClick={() => checkout.open({ plan: 'pro' }, 'side')}>
          <SunMark state="setting" />
          <span className="min-w-0"><b>{PLAN_NAMES[plan.kind]}</b><small className="is-warm">{endsIn(ending.days)} · Extend</small></span>
          <Icon name="chevron" size={15} />
        </button>
      ) : (
        <Link to="/settings" hash="plan" className={cn('sb-pro', on && 'is-on')}>
          <SunMark />
          <span className="min-w-0"><b>{PLAN_NAMES[plan.kind]}</b>{until !== null && <small>Until {shortDate(new Date(until))}</small>}</span>
          <Icon name="chevron" size={15} />
        </Link>
      )}
    </>
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
