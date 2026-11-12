/*
 * Plans (docs/superpowers/specs/2026-11-12-plans-frontend-design.md › The Plans page): the last of the sunset, with the
 * plans on the water under it. On the sky, Monthly or Yearly when a year or more costs less, with the last sliver of the sun
 * on the horizon under it; on the water, Free and Pro side by side, their rows lined up (a third card grows when Team is
 * offered); then what every plan has and how paying works. Every number is the server's: the offers, and the plan you're
 * on. Get Pro and Extend open checkout over the page, on a year when Yearly is chosen. Reached from the side panel's foot,
 * Settings › Plan, checkout's Compare plans, and the welcome page's Get Pro, which opens checkout as the page opens.
 */
import { errorCode, errorMessage, type CheckoutParam, type Plan, type PlanAllowance, type PlanOffers } from '@alcove/api';
import { Button, EmptyState, Evening, EveryPlan, PayingLine, PlanCard, PlanCards, PlanCycle, PlanHere, PlanSunset, type IconName, type PlanCycleChoice, type PlanFact } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCheckout } from '~/features/plans/checkout';
import { endsIn, proEnding } from '~/features/plans/plan-state';
import { yearlyOff } from '~/features/plans/purchase';
import { hoursOfNotes } from '~/features/plans/words';
import { useNow, useOnline } from '~/lib/live';
import { q } from '~/lib/queries';
import { hoursAndMinutes } from '~/lib/time';
import { plural, roomLabel, usd } from '~/lib/words';

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

/* ---------- the words, from the offers ---------- */

/** "About 5 hours": what a period brings is an estimate, so it's said to the hour. */
const aboutHours = (minutes: number): string => (minutes < 60 ? `About ${minutes} min` : `About ${plural(Math.round(minutes / 60), 'hour')}`);
/** How often a plan's notes come back, as the notes it brings are said: "a month" for a period of about a month. */
const perPeriod = (days: number): string => (days >= 28 && days <= 31 ? 'a month' : days === 7 ? 'a week' : `every ${days} days`);

/** What a plan brings, one line each: notes (and, on Free, when they come back), storage, and the largest file. */
function factsOf(a: PlanAllowance, periodDays: number, back: boolean): PlanFact[] {
  return [
    { icon: 'notes', text: `${aboutHours(a.notesMinutes)} of notes ${perPeriod(periodDays)}`, sub: back ? `Back to ${hoursOfNotes(a.notesMinutes)} on the 1st of each period` : undefined },
    { icon: 'hardDrive', text: `${roomLabel(a.storageBytes)} of storage` },
    { icon: 'file', text: `Files up to ${roomLabel(a.fileBytes)}` }
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

/** A lower price for a year or more, when there's one a single purchase can reach. */
function yearlyOf(o: PlanOffers): NonNullable<PlanOffers['pro']['yearly']> | null {
  const y = o.pro.yearly;
  return y && y.fromMonths <= o.pro.maxMonths && y.microUsdPerMonth < o.pro.microUsdPerMonth ? y : null;
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
 * Opens checkout once as the page opens, on what the address asked for (`?checkout=pro`, the welcome page's Get Pro after
 * signing in), then takes it out of the address (`done`). It owns nothing that needs undoing: checkout is the provider's.
 */
function useCheckoutFromAddress(what: CheckoutParam | undefined, done: () => void): void {
  const { open } = useCheckout();
  const opened = useRef(false);
  useEffect(() => {
    if (!what || opened.current) return;
    opened.current = true;
    open(what === 'pro' ? { plan: 'pro' } : { plan: 'hours' }, 'welcome');
    done();
  }, [what, open, done]);
}

/** `opening`: what to open checkout on as the page opens, once; `onOpened` takes it out of the address. */
export function Plans({ opening, onOpened }: { opening?: CheckoutParam | undefined; onOpened: () => void }) {
  /* The route's loader has tried them; offers that didn't load wait for Try again. */
  const offers = useQuery({ ...q.offers(), retryOnMount: false });
  const plan = useQuery(q.plan());
  const online = useOnline();
  const now = useNow(60_000);
  const { open } = useCheckout();
  const [cycle, setCycle] = useState<PlanCycleChoice>('year');
  const water = useRef<HTMLDivElement>(null);
  useCheckoutFromAddress(opening, onOpened);

  const o = offers.data;
  const p = plan.data;
  const yearly = o ? yearlyOf(o) : null;
  const error = offers.error ?? plan.error;
  const trouble = o && p ? null : !online || errorCode(error) === 'network' ? 'offline' : offers.isError || plan.isError ? 'failed' : null;
  /* Whatever comes back stands where Try again was, so focus goes to the water rather than falling back to the page. */
  const retry = () => void Promise.allSettled([offers.refetch(), plan.refetch()]).then(() => requestAnimationFrame(() => water.current?.focus({ preventScroll: true })));

  return (
    <Evening moment="plans" className="pl" sky={SUNSET}>
      <header className="dusk-top" style={{ '--d': 0 }}><h1 className="dusk-title">Plans</h1></header>
      <div className="pl-sky" style={{ '--d': 1 }}>
        {o && yearly && (
          <PlanCycle value={cycle} onChange={setCycle} off={offWords(o)}
            year={yearly.fromMonths === 12 ? 'Yearly' : `${yearly.fromMonths} months`} />
        )}
      </div>
      <div ref={water} tabIndex={-1} className="pl-water" style={{ '--d': 2 }}>
        {o && p
          ? <Offered offers={o} plan={p} yearly={cycle === 'year' ? yearly : null} now={now}
              onBuy={(months) => open({ plan: 'pro', months }, 'plans')} />
          : trouble === 'offline'
            ? <EmptyState className="pl-none" title="You’re offline">The plans show here when you’re back online.</EmptyState>
            : trouble === 'failed'
              ? (
                <EmptyState className="pl-none" title="The plans didn’t load"
                  action={<Button variant="primary" icon="retry" loading={offers.isFetching || plan.isFetching} onClick={retry}>Try again</Button>}>
                  {errorMessage(error)}
                </EmptyState>
              )
              : (
                <PlanCards>
                  <PlanCard waiting kind="free" {...FREE} />
                  <PlanCard waiting kind="pro" {...PRO} lifted />
                </PlanCards>
              )}
      </div>
    </Evening>
  );
}

/**
 * The plans as they're offered, and what's under them. `yearly`: the lower price for a year or more, when it's the one
 * shown. Free's button area says it's your plan; on another plan, that Free is where you're back to. Pro's button is the
 * page's one filled button on Free, and on Pro only while it's ending.
 */
function Offered({ offers: o, plan: p, yearly, now, onBuy }: {
  offers: PlanOffers; plan: Plan; yearly: NonNullable<PlanOffers['pro']['yearly']> | null; now: number; onBuy: (months: number) => void;
}) {
  const onFree = p.kind === 'free';
  const onPro = p.kind === 'pro';
  const ending = proEnding(p, o, now);
  const offered = yearlyOf(o);
  const perMonth = yearly ? yearly.microUsdPerMonth : o.pro.microUsdPerMonth;
  const save = yearly
    ? `You save ${usd((o.pro.microUsdPerMonth - yearly.microUsdPerMonth) * yearly.fromMonths)}.`
    : offered ? `Or ${usd(offered.microUsdPerMonth)} for ${fromWords(offered.fromMonths)}.` : undefined;
  return (
    <>
      <PlanCards>
        <PlanCard kind="free" {...FREE} price={usd(0)} bill="Nothing to pay."
          action={onFree ? <PlanHere /> : <PlanHere quiet>Where you’re back to if a plan ends</PlanHere>}
          facts={factsOf(o.free, o.periodDays, true)} more={moreNotes(o.hours)} />
        <PlanCard kind="pro" {...PRO} lifted
          chip={onPro ? (ending ? endsIn(ending.days) : 'Your plan') : undefined}
          price={usd(perMonth)} per="a month"
          bill={yearly ? `${usd(perMonth * yearly.fromMonths)} for ${yearly.fromMonths} months.` : 'For as many months as you choose.'} save={save}
          action={(
            <Button variant={onFree || ending !== null ? 'primary' : 'secondary'} onClick={() => onBuy(yearly ? yearly.fromMonths : 1)}>
              {onPro ? 'Extend' : 'Get Pro'}
            </Button>
          )}
          facts={factsOf(o.pro, o.periodDays, false)} />
      </PlanCards>
      <EveryPlan items={EVERY} />
      <PayingLine>
        <b>Pay in USDC</b> from any wallet or exchange, {atATime(o.pro.maxMonths)}. Nothing renews by itself, and when a plan ends
        you’re back on Free with nothing lost.
      </PayingLine>
    </>
  );
}
