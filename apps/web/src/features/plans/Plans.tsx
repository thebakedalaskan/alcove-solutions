/*
 * Plans (docs/design/pages.md › Plans): the last of the sunset, with the
 * plans on the water under it. On the sky, Monthly or Yearly when a year or more costs less, with the last sliver of the sun
 * on the horizon under it; on the water, Free, Pro and Team side by side, their rows lined up; then what every plan has and
 * how paying works. Every number is the server's: the offers, the plan you're on, and the team you're on. Get Pro and
 * Extend open checkout over the page, on a year when Yearly is chosen; Start a team and Buy licenses open it on Team, whose
 * licenses are a period at a time whichever way the prices are shown. While a team license is yours, Pro waits: the server
 * doesn't sell it then. Reached from the side panel's foot, Settings › Plan, checkout's Compare plans, and the welcome page's
 * Get Pro and Start a team, which open checkout as the page opens. Opened by itself once, in Home's place, it's the plan choice
 * (PlanChoice.tsx): a head of its own, and the plan you're on leads straight on. Here or there, once the plans have been on
 * screen while the server says they haven't been shown, it's told (choice.ts).
 */
import { errorCode, errorMessage, type CheckoutParam, type MyTeam, type Person, type Plan, type PlanBrings, type PlanOffers } from '@alcove/api';
import { Button, EmptyState, Evening, EveryPlan, Faces, PayingLine, PlanCard, PlanCards, PlanCycle, PlanHere, PlanSunset, cn, type IconName, type PlanCycleChoice, type PlanFact } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { useNow, useOnline } from '~/lib/live';
import { callName } from '~/lib/people';
import { q } from '~/lib/queries';
import { hoursAndMinutes } from '~/lib/time';
import { plural, roomLabel, usd } from '~/lib/words';
import { useCheckout } from './checkout';
import { usePlansSeen } from './choice';
import { PLAN_NAMES, endsIn, proEnding } from './plan-state';
import { yearlyOff } from './purchase';
import { hoursOfNotes, perPeriod, periodHours } from './words';

/** The last of the sun, on the sky behind whatever passes through: one element, so the scene isn't drawn again with the page. */
const SUNSET = <PlanSunset />;

/** What every plan has: plans only change how much you get. */
const EVERY: readonly { icon: IconName; text: string }[] = [
  { icon: 'video', text: 'Calls up to 10 hours, 100 people' },
  { icon: 'presentation', text: 'A workspace and board per call' },
  { icon: 'ask', text: 'Ask across your notes' },
  { icon: 'sealed', text: 'Confidential compute' },
  { icon: 'people', text: 'Invitees get the notes free' }
];

/** Who each plan is for, said before its prices are here too. */
const FREE = { name: 'Free', sub: 'For a few calls a month' } as const;
const PRO = { name: 'Pro', sub: 'For one person' } as const;
const TEAM = { name: 'Team', sub: 'For a company' } as const;

/* ---------- the words, from the offers ---------- */

/** "About 5 hours": what a period brings is an estimate, so it's said to the hour. */
const aboutHours = (minutes: number): string => `About ${periodHours(minutes)}`;

/** What a plan brings, one line each: notes (and, on Free, when they come back), storage, and the largest file. */
function factsOf(a: PlanBrings, periodDays: number, back: boolean): PlanFact[] {
  return [
    { icon: 'notes', text: `${aboutHours(a.notesMinutes)} of notes ${perPeriod(periodDays)}`, sub: back ? `Back to ${hoursOfNotes(a.notesMinutes)} on the 1st of each period` : undefined },
    { icon: 'hardDrive', text: `${roomLabel(a.storageBytes)} of storage` },
    { icon: 'file', text: `Files up to ${roomLabel(a.fileBytes)}` }
  ];
}

/**
 * What a license brings its person, one line each: their notes, their share of the team's storage, the largest file, and
 * what the team shares.
 */
function teamFactsOf(a: PlanBrings): PlanFact[] {
  return [
    { icon: 'notes', text: `${aboutHours(a.notesMinutes)} of notes each` },
    { icon: 'hardDrive', text: `${roomLabel(a.storageBytes)} each, shared by the team` },
    { icon: 'file', text: `Files up to ${roomLabel(a.fileBytes)}` },
    { icon: 'people', text: 'Notes and workspaces the team shares' }
  ];
}

/** Free's last line, while more notes are offered: "Out of notes before the period ends? 10 more hours are $15." */
function moreNotes(hours: PlanOffers['hours']): string | undefined {
  if (!hours) return undefined;
  const price = usd(hours.microUsd);
  const n = hours.minutes / 60;
  const more = hours.minutes % 60 !== 0 ? `${hoursAndMinutes(hours.minutes)} more is ${price}` : n === 1 ? `1 more hour is ${price}` : `${n} more hours are ${price}`;
  return `Out of notes before the period ends? ${more}.`;
}

/** "a year or more", "6 months or more": where the lower price starts. */
const fromWords = (months: number): string => (months === 12 ? 'a year or more' : `${months} months or more`);
/** "20% off", worked out from the two prices: nothing when it rounds to nothing. */
function offWords(o: PlanOffers): string | undefined {
  const off = yearlyOff(o);
  return off !== null && off >= 1 ? `${off}% off` : undefined;
}

/** "for 1 to 12 months at a time": as many as one purchase buys. */
const atATime = (maxMonths: number): string => (maxMonths > 1 ? `for 1 to ${maxMonths} months at a time` : 'for a month at a time');

/* ---------- the page ---------- */

/**
 * Opens checkout once as the page opens, on what the address asked for (`?checkout=pro`, `?checkout=team`: the welcome page's
 * Get Pro and Start a team after signing in), then takes it out of the address (`done`). It owns nothing that needs undoing:
 * checkout is the provider's.
 */
function useCheckoutFromAddress(what: CheckoutParam | undefined, done: (() => void) | undefined): void {
  const { open } = useCheckout();
  const opened = useRef(false);
  useEffect(() => {
    if (!what || opened.current) return;
    opened.current = true;
    open({ plan: what }, 'welcome');
    done?.();
  }, [what, open, done]);
}

/** The plan choice's own (PlanChoice.tsx): its head, in place of the page's title, and the way on from the plan you're on. */
export interface FirstTime {
  /** A short title in the page's own type: "Choose a plan". */
  title: string;
  /** One plain line under it. */
  line: string;
  /** On with the plan you're on, past the plans. */
  onContinue: () => void;
}

/**
 * `opening`: what to open checkout on as the page opens, once; `onOpened` takes it out of the address. `first`: Plans opened
 * by itself once, as the plan choice. `evening`: the page's evening, for what arrives onto it (the plan choice's sail).
 */
export function Plans({ opening, onOpened, first, evening }: {
  opening?: CheckoutParam | undefined; onOpened?: (() => void) | undefined; first?: FirstTime | undefined; evening?: Ref<HTMLDivElement> | undefined;
}) {
  /* The route's loader has tried them; offers that didn't load wait for Try again. */
  const offers = useQuery({ ...q.offers(), retryOnMount: false });
  const plan = useQuery(q.plan());
  /* Team's people: the others on the team you're on (which says who buys its licenses too), else the company's on Alcove. */
  const team = useQuery({ ...q.myTeam(), enabled: !!plan.data?.team });
  const company = useQuery(q.team()).data ?? null;
  const onTeam = plan.data?.team ? (team.data?.members ?? []).filter((m) => !m.you).map((m) => m.person) : [];
  const atWork = company?.members.filter((m) => m.onAlcove).map((m) => m.person) ?? [];
  const online = useOnline();
  const now = useNow(60_000);
  const { open } = useCheckout();
  const [cycle, setCycle] = useState<PlanCycleChoice>('year');
  const water = useRef<HTMLDivElement>(null);
  useCheckoutFromAddress(opening, onOpened);

  const o = offers.data;
  const p = plan.data;
  const yearly = o?.pro.yearly ?? null;
  const error = offers.error ?? plan.error;
  const trouble = o && p ? null : !online || errorCode(error) === 'network' ? 'offline' : offers.isError || plan.isError ? 'failed' : null;
  /* Whatever comes back stands where Try again was, so focus goes to the water rather than falling back to the page. */
  const retry = () => void Promise.allSettled([offers.refetch(), plan.refetch()]).then(() => requestAnimationFrame(() => water.current?.focus({ preventScroll: true })));
  /* The plans themselves, prices and all, on screen while the server says they haven't been shown: it's told once they've been seen. */
  usePlansSeen(water, Boolean(o && p?.choose));
  /* The plan choice: the plan you're on (Free until it's known) leads straight on, whatever has or hasn't come. */
  const own = p?.kind ?? 'free';
  const go = first && <Button variant="quiet" iconRight="right" onClick={first.onContinue}>Continue on {PLAN_NAMES[own]}</Button>;
  const goFrom = (kind: Plan['kind']): ReactNode => (kind === own ? go : undefined);

  const sky = (
    <div className="pl-sky" style={first ? undefined : { '--d': 1 }}>
      {o && yearly && (
        <PlanCycle value={cycle} onChange={setCycle} off={offWords(o)}
          year={yearly.fromMonths === 12 ? 'Yearly' : `${yearly.fromMonths} months`} />
      )}
    </div>
  );
  return (
    <Evening ref={evening} moment="plans" className={cn('pl', first && 'is-first')} sky={SUNSET}>
      {first ? (
        /* The plan choice's head and the sky are one block down to the horizon, so the switch stays over the sun however long the line. */
        <div className="pl-lead" style={{ '--d': 0 }}>
          <header className="dusk-top pl-head"><h1 className="dusk-title">{first.title}</h1><p className="pl-lede">{first.line}</p></header>
          {sky}
        </div>
      ) : (
        <>
          <header className="dusk-top" style={{ '--d': 0 }}><h1 className="dusk-title">Plans</h1></header>
          {sky}
        </>
      )}
      <div ref={water} tabIndex={-1} className="pl-water" style={{ '--d': 2 }}>
        {o && p
          ? <Offered offers={o} plan={p} yearly={cycle === 'year' ? yearly : null} now={now}
              team={p.team ? team.data ?? null : null} people={onTeam.length ? onTeam : atWork} go={go}
              onBuy={(months) => open({ plan: 'pro', months }, 'plans')} onTeam={() => open({ plan: 'team' }, 'plans')} />
          : trouble === 'offline'
            ? <EmptyState className="pl-none" title="You’re offline" action={go}>The plans show here when you’re back online.</EmptyState>
            : trouble === 'failed'
              ? (
                <EmptyState className="pl-none" title="The plans didn’t load"
                  action={<><Button variant="primary" icon="retry" loading={offers.isFetching || plan.isFetching} onClick={retry}>Try again</Button>{go}</>}>
                  {errorMessage(error)}
                </EmptyState>
              )
              : (
                <PlanCards>
                  <PlanCard waiting kind="free" {...FREE} action={goFrom('free')} />
                  <PlanCard waiting kind="pro" {...PRO} lifted action={goFrom('pro')} />
                  <PlanCard waiting kind="team" {...TEAM} facts={4} action={goFrom('team')} />
                </PlanCards>
              )}
      </div>
    </Evening>
  );
}

/**
 * The plans as they're offered, and what's under them. `yearly`: the lower price for a year or more, when it's the one
 * shown. Free's button area says it's your plan; on another plan, that Free is where you're back to. Pro's button is the
 * page's one filled button on Free, and on Pro only while it's ending; on a team license it isn't sold, and says so. Team is
 * licenses, a period at a time whichever way the prices are shown, its people at the end of its name's row (`people`): off a
 * team, Start a team; its admin buys them; a member is told who does, and it's their plan while they're licensed. `go`: the
 * plan choice's way on, on the plan you're on, in place of what it would have.
 */
function Offered({ offers: o, plan: p, yearly, now, team, people, go, onBuy, onTeam }: {
  offers: PlanOffers; plan: Plan; yearly: NonNullable<PlanOffers['pro']['yearly']> | null; now: number;
  /** The team you're on, as you see it, once it's read (null off a team, or until then). */
  team: MyTeam | null; people: Person[];
  go: ReactNode;
  onBuy: (months: number) => void; onTeam: () => void;
}) {
  const onFree = p.kind === 'free';
  const onPro = p.kind === 'pro';
  const onTeamPlan = p.kind === 'team';
  const ending = proEnding(p, now);
  const offered = o.pro.yearly;
  const perMonth = yearly ? yearly.microUsdPerMonth : o.pro.microUsdPerMonth;
  const save = yearly
    ? `You save ${usd((o.pro.microUsdPerMonth - yearly.microUsdPerMonth) * yearly.fromMonths)}.`
    : offered ? `Or ${usd(offered.microUsdPerMonth)} for ${fromWords(offered.fromMonths)}.` : undefined;
  const admin = team?.members.find((m) => m.role === 'admin');
  const proAction = onTeamPlan
    ? <PlanHere quiet>Not while you’re on your team’s plan</PlanHere>
    : (
      <Button variant={onFree || ending !== null ? 'primary' : 'secondary'} onClick={() => onBuy(yearly ? yearly.fromMonths : 1)}>
        {onPro ? 'Extend' : 'Get Pro'}
      </Button>
    );
  const teamAction = p.team && p.team.role !== 'admin'
    ? <PlanHere quiet>{admin ? `${callName(admin.person)} buys its licenses` : 'Its admin buys its licenses'}</PlanHere>
    : <Button variant="secondary" onClick={onTeam}>{p.team ? 'Buy licenses' : 'Start a team'}</Button>;
  return (
    <>
      <PlanCards>
        <PlanCard kind="free" {...FREE} price={usd(0)} bill="Nothing to pay."
          action={onFree ? go ?? <PlanHere /> : <PlanHere quiet>Where you’re back to if a plan ends</PlanHere>}
          facts={factsOf(o.free, o.periodDays, true)} more={moreNotes(o.hours)} />
        <PlanCard kind="pro" {...PRO} lifted
          chip={onPro ? (ending ? endsIn(ending.days) : 'Your plan') : undefined}
          price={usd(perMonth)} per="a month"
          bill={yearly ? `${usd(perMonth * yearly.fromMonths)} for ${yearly.fromMonths} months.` : 'For as many months as you choose.'} save={save}
          action={onPro ? go ?? proAction : proAction}
          facts={factsOf(o.pro, o.periodDays, false)} />
        <PlanCard kind="team" {...TEAM} people={people.length ? <Faces people={people.slice(0, 4)} size={22} max={4} /> : undefined}
          chip={onTeamPlan ? 'Your plan' : undefined}
          price={usd(o.team.microUsdPerLicense)} per={`a person ${perPeriod(o.periodDays)}`}
          bill={`Each license is one person for ${plural(o.periodDays, 'day')}.`}
          action={onTeamPlan ? go ?? teamAction : teamAction}
          facts={teamFactsOf(o.team)} more="A license is taken when someone next opens Alcove. Ones nobody takes can be refunded." />
      </PlanCards>
      <EveryPlan items={EVERY} />
      <PayingLine>
        <b>Pay in USDC</b> from any wallet or exchange, {atATime(o.pro.maxMonths)}. Nothing renews by itself, and when a plan ends
        you’re back on Free with nothing lost.
      </PayingLine>
    </>
  );
}
