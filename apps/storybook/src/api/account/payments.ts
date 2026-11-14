/*
 * The payments a story opens to buy something, played out by themselves as 1Click and the server would (the play is the
 * scenario's switch, world/plans/payments.ts › PaymentPlay), a step every few seconds from when each was opened: seen, then
 * added and bought; more than asked; less, the address waiting for the rest; refused because the price went up in between;
 * expired; failed. As the server does, a purchase is decided once, in the step that adds the payment: bought from the
 * balance (what was there and what arrived), or refused with why, the money staying in the balance. Licenses bought go to
 * the team Art runs, for anyone on it without one to take.
 *
 * Nothing runs on a timer: whenever the stand-in is asked about the plan or a payment, the payments catch up with the
 * clock first. So nothing from one story runs on into the next.
 */
import type { Purchase, TopUp } from '@alcove/api';
import type { World } from '../../world/world';
import { addToBalance, boughtFromBalance, freshEntryId, raisePrices, type PaymentPlay } from '../../world/plans/payments';
import { costOf as priceOf, forPeriods, hoursOf, proPriceOf } from '../../world/plans/plans';
import { meOn } from '../../world/plans/teams';
import { me } from '../state';

/** How long each step of a payment takes: long enough to see each state, short enough to play one through. */
export const PAYMENT_STEP_MS = 5_000;

const months = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;
const micro = (amount: string) => Math.round(Number(amount) * 1_000_000);

/** An amount as the server's refusals say it: "$192", "$12.50". */
const dollars = (microUsd: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: microUsd % 1_000_000 === 0 ? 0 : 2 }).format(microUsd / 1_000_000);
/** "12 months of Pro", "20 hours of notes", "2 team licenses", "6 team licenses for a year": what a purchase buys, as refusals say it. */
const amountOf = (buys: Purchase) => (buys.kind === 'pro' ? `${months(buys.months)} of Pro` : buys.kind === 'licenses' ? `${teamLicenses(buys.count)}${forPeriods(buys.periods)}` : `${(buys.packs * buys.minutesPerPack) / 60} hours of notes`);
const teamLicenses = (n: number) => `${n} team ${n === 1 ? 'license' : 'licenses'}`;
/** What it buys and what that costs, as refusals say it: "1 month of Pro costs", "2 team licenses cost". */
const costOf = (buys: Purchase) => {
  const one = buys.kind === 'pro' ? buys.months === 1 : buys.kind === 'licenses' ? buys.count === 1 : buys.packs * buys.minutesPerPack === 60;
  return `${amountOf(buys)} ${one ? 'costs' : 'cost'}`;
};

/**
 * Why a purchase can't be had on today's terms, as the server's terms say it, or null when it can: when it's asked for
 * (`asked`, with its code), and once a payment for it has arrived (`arrived`). Past the most one purchase buys, or at a
 * price (or, for more notes, a size) other than today's for that much.
 */
export function refusalOf(w: World, buys: Purchase): { code: 'invalid' | 'conflict'; asked: string; arrived: string } | null {
  const o = w.payments.offers;
  if (buys.kind === 'pro') {
    if (!Number.isInteger(buys.months) || buys.months < 1 || buys.months > o.pro.maxMonths) {
      return { code: 'invalid', asked: `Buy 1 to ${o.pro.maxMonths} months at a time.`, arrived: `Since your payment was made, one purchase buys at most ${months(o.pro.maxMonths)} of Pro. It’s in your balance.` };
    }
    if (buys.microUsdPerMonth !== proPriceOf(o, buys.months)) {
      return { code: 'conflict', asked: 'The price of Pro has changed. Look at it again before buying.', arrived: 'The price of Pro changed before your payment arrived. It’s in your balance.' };
    }
    return null;
  }
  if (buys.kind === 'licenses') {
    // Licenses are for the team their buyer runs: one they're the admin of, then and when the payment arrives.
    const mine = w.myTeam ? meOn(w.myTeam, me().email) : undefined;
    if (mine?.role !== 'admin') {
      return { code: 'conflict', asked: 'Only a team’s admin buys its licenses.', arrived: 'You weren’t a team’s admin when your payment arrived, so no licenses were bought. It’s in your balance.' };
    }
    const max = o.team.maxLicenses;
    if (!Number.isInteger(buys.count) || buys.count < 1 || buys.count > max) {
      return { code: 'invalid', asked: `Buy 1 to ${max} licenses at a time.`, arrived: `Since your payment was made, one purchase buys at most ${teamLicenses(max)}. It’s in your balance.` };
    }
    // A period at a license's price, or a year's periods at the yearly price while one is offered: any other length is a
    // changed price, as the server has it.
    const yearly = o.team.yearly;
    const term = forPeriods(buys.periods);
    if (buys.periods > 1 && !yearly) {
      return { code: 'conflict', asked: `Team licenses${term} can’t be bought right now.`, arrived: `Team licenses${term} stopped being offered before your payment arrived. It’s in your balance.` };
    }
    const price = buys.periods === 1 ? o.team.microUsdPerLicense : buys.periods === yearly?.periods ? yearly.microUsdPerLicense : null;
    if (buys.microUsdPerLicense !== price) {
      return { code: 'conflict', asked: `The price of a team license${term} has changed. Look at it again before buying.`, arrived: `The price of a team license${term} changed before your payment arrived. It’s in your balance.` };
    }
    return null;
  }
  if (!o.hours) return { code: 'conflict', asked: 'More notes can’t be bought right now.', arrived: 'More notes stopped being offered before your payment arrived. It’s in your balance.' };
  if (!Number.isInteger(buys.packs) || buys.packs < 1 || buys.packs > o.hours.maxPacks) {
    return { code: 'invalid', asked: `Buy up to ${hoursOf(o, o.hours.maxPacks)} hours of notes at a time.`, arrived: `Since your payment was made, one purchase buys at most ${hoursOf(o, o.hours.maxPacks)} hours of notes. It’s in your balance.` };
  }
  if (buys.microUsdPerPack !== o.hours.microUsd) {
    return { code: 'conflict', asked: 'The price of more notes has changed. Look at it again before buying.', arrived: 'The price of more notes changed before your payment arrived. It’s in your balance.' };
  }
  if (buys.minutesPerPack !== o.hours.minutes) {
    return { code: 'conflict', asked: 'The hours more notes bring have changed. Look at them again before buying.', arrived: 'The hours more notes bring changed before your payment arrived. It’s in your balance.' };
  }
  return null;
}

/** Why the balance can't pay for it, or null when it can: as it's asked for, never saying the balance itself. */
export function shortOf(w: World, buys: Purchase): string | null {
  const cost = priceOf(buys);
  if (w.plan.balance.microUsd >= cost) return null;
  return `Your balance is short of what ${costOf(buys)} (${dollars(cost)}). Add money first.`;
}

/** Why a purchase can't be bought once its payment is added, in the server's words, or null when it can. */
function whyNot(w: World, buys: Purchase, lessArrived: boolean): string | null {
  const r = refusalOf(w, buys);
  if (r) return r.arrived;
  if (!shortOf(w, buys)) return null;
  return lessArrived ? `Less arrived than ${costOf(buys)}. It’s in your balance.`
    : `Your balance was short of what ${costOf(buys)} when your payment arrived. It’s in your balance.`;
}

/** One step of a payment: what the top-up becomes, and what that does to the world. */
type Step = (w: World, t: TopUp) => TopUp;

/** The payment is seen: `extra` more than asked, or exactly it. Its address isn't shown any more. */
const arrive = (extra: number): Step => (_w, t) => ({ ...t, state: 'arriving', address: null, memo: null, received: { amount: String(Number(t.asked.amount) + extra), microUsd: null } });
/** Two thirds of it arrive, and the same address waits for the rest. */
const shortfall: Step = (_w, t) => ({ ...t, state: 'short', received: { amount: String(Math.floor((Number(t.asked.amount) * 2) / 3)), microUsd: null } });
/** Nothing arrived before the address closed. */
const expire: Step = (_w, t) => ({ ...t, state: 'expired', address: null, memo: null, expiresAt: new Date().toISOString() });
/** 1Click failed it: someone has to look. */
const fail: Step = (_w, t) => ({ ...t, state: 'failed', address: null, memo: null });
/** It settles: what arrived is added to the balance, and what it was for is bought from there, or refused with why. */
const credit: Step = (w, t) => {
  const amount = t.received?.amount ?? t.asked.amount;
  const added = micro(amount);
  addToBalance(w, added, amount);
  const settled: TopUp = { ...t, state: 'credited', address: null, memo: null, received: { amount, microUsd: added } };
  if (!t.purchase) return settled;
  const why = whyNot(w, t.purchase.buys, added < micro(t.asked.amount));
  if (why) return { ...settled, purchase: { ...t.purchase, outcome: 'refused', why } };
  boughtFromBalance(w, t.purchase.buys, freshEntryId(w));
  return { ...settled, purchase: { ...t.purchase, outcome: 'bought', why: null } };
};

const STEPS: Record<PaymentPlay, Step[]> = {
  pays: [arrive(0), credit],
  over: [arrive(6), credit],
  short: [shortfall],
  // The price goes up while the payment is on its way, so what it was for isn't bought at the old one.
  refused: [arrive(0), (w, t) => { raisePrices(w); return credit(w, t); }],
  expires: [expire],
  fails: [arrive(0), fail],
  waits: []
};

/** A payment opened to buy something starts playing out, as the world's switch says. One that only adds money waits. */
export function playPayment(w: World, t: TopUp): void {
  if (t.purchase) w.payments.playing[t.id] = { from: Date.now(), play: w.payments.play, done: 0 };
}

/**
 * For a story that opens on a payment already on its way: it plays out as `play` says, its first step `seconds` from now
 * and the next a step after (seen at once, then bought, for `pays` and `0`).
 */
export const playsOut = (id: string, play: PaymentPlay, seconds = 0) => (w: World): void => {
  w.payments.playing[id] = { from: Date.now() - PAYMENT_STEP_MS + seconds * 1000, play, done: 0 };
};

/** The rest of a payment that fell short is sent: it's seen, then added and bought, a step at a time from now. */
export function payTheRest(w: World, id: string): void {
  w.payments.playing[id] = { from: Date.now(), play: 'pays', done: 0 };
}

/** Every payment playing out catches up with the clock: the steps due by now happen, in order. A cancelled one stops. */
export function settlePayments(w: World, now = Date.now()): void {
  for (const [id, playing] of Object.entries(w.payments.playing)) {
    const steps = STEPS[playing.play];
    const due = Math.min(steps.length, Math.floor((now - playing.from) / PAYMENT_STEP_MS));
    while (playing.done < due) {
      const step = steps[playing.done];
      playing.done += 1;
      const t = w.payments.topUps.find((x) => x.id === id);
      if (!step || !t || t.state === 'cancelled') continue;
      const next = step(w, t);
      w.payments.topUps = w.payments.topUps.map((x) => (x.id === id ? next : x));
    }
  }
}
