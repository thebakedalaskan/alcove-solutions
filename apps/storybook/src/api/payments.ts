/*
 * The payments a story opens to buy something, played out by themselves as 1Click and the server would (the play is the
 * scenario's switch, world/payments.ts › PaymentPlay), a step every few seconds from when each was opened: seen, then
 * added and bought; more than asked; less, the address waiting for the rest; refused because the price went up in between;
 * expired; failed. As the server does, a purchase is decided once, in the step that adds the payment: bought from the
 * balance (what was there and what arrived), or refused with why, the money staying in the balance.
 *
 * Nothing runs on a timer: whenever the stand-in is asked about the plan or a payment, the payments catch up with the
 * clock first. So nothing from one story runs on into the next.
 */
import type { Purchase, TopUp } from '@alcove/api';
import type { World } from '../world';
import { addToBalance, raisePrices, type PaymentPlay } from '../world/payments';
import { buyFromBalance, hoursOf, proPriceOf } from '../world/plans';
import { nextId } from './state';

/** How long each step of a payment takes: long enough to see each state, short enough to play one through. */
export const PAYMENT_STEP_MS = 5_000;

const months = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;
const micro = (amount: string) => Math.round(Number(amount) * 1_000_000);

/**
 * Why a purchase can't be bought from the balance once its payment is added, in the server's words, or null when it can:
 * a price or a limit that changed since the payment was opened, or a balance short of it.
 */
function whyNot(w: World, buys: Purchase, lessArrived: boolean): string | null {
  const o = w.payments.offers;
  const balance = w.plan.balance.microUsd;
  if (buys.kind === 'pro') {
    if (buys.months > o.pro.maxMonths) return `Since your payment was made, one purchase buys at most ${months(o.pro.maxMonths)} of Pro. It’s in your balance.`;
    if (buys.microUsdPerMonth !== proPriceOf(o, buys.months)) return 'The price of Pro changed before your payment arrived. It’s in your balance.';
    if (balance >= buys.months * buys.microUsdPerMonth) return null;
    return lessArrived ? `Less arrived than ${months(buys.months)} of Pro cost. It’s in your balance.`
      : `Your balance was short of what ${months(buys.months)} of Pro costs when your payment arrived. It’s in your balance.`;
  }
  if (!o.hours) return 'More notes stopped being offered before your payment arrived. It’s in your balance.';
  if (buys.microUsdPerPack !== o.hours.microUsd) return 'The price of more notes changed before your payment arrived. It’s in your balance.';
  if (balance >= buys.packs * buys.microUsdPerPack) return null;
  return lessArrived ? `Less arrived than ${hoursOf(o, buys.packs)} hours of notes cost. It’s in your balance.`
    : `Your balance was short of what ${hoursOf(o, buys.packs)} hours of notes cost when your payment arrived. It’s in your balance.`;
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
  w.plan = buyFromBalance(w.plan, t.purchase.buys, w.payments.offers, nextId('sb-entry'));
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
