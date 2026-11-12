/*
 * The checkout window (docs/superpowers/specs/2026-11-12-plans-frontend-design.md › The checkout window; the canvas's
 * Checkout and PayMotion boards): what checkout.tsx has open, drawn with the kit's CheckoutWindow and its parts, at the
 * app's root (routes/__root.tsx), so the call, Settings, Plans and any door open the same window.
 *
 * Choose how long (or how many hours). When the balance covers it, Buy with your balance takes it from there at once.
 * Otherwise choose a network, and Get the address opens a top-up for what the balance is short of (raised to the
 * network's least, the rest staying in the balance) that buys it the moment it's added. From then on the window follows
 * that top-up, which q.topUp reads every 5 seconds: waiting, less arrived, seen, bought, and every way it can go wrong.
 * Closing leaves the payment running, and checkout opened on the same thing again opens that payment, not another.
 * Every price and limit is the server's; a price that changed in between is refused, read again and said.
 */
import { errorCode, errorMessage, errorRequestId, type BalanceEntry, type Plan, type PlanOffers, type Purchase, type TopUp, type TopUpRoute } from '@alcove/api';
import {
  Button, CheckoutAsk, CheckoutBig, CheckoutDone, CheckoutLine, CheckoutNote, CheckoutWindow, Dots, HoursPicker, MonthsPicker,
  NetworkPicker, PayAddress, PayAmount, PayArrived, PayStatus, PayTrack, PaymentReceipt, RequestRef, useTheme, useToast,
  type CheckoutStage, type CheckoutSummaryData, type HoursOption, type MonthsOption, type ReceiptLine, type SummaryLine
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useOnline } from '~/lib/live';
import { q, useBuyHours, useBuyPro, useCancelTopUp, useStartTopUp } from '~/lib/queries';
import { dayMonth, daysFromToday, hm, longDay, shortDay } from '~/lib/time';
import { plural, usd, usdCents } from '~/lib/words';
import type { CheckoutOpen } from './checkout';
import {
  LENGTHS, costOf, hoursIn, lapsed, microOf, monthsWord, plainTokens, proPrice, purchaseName, repriced, roundTokens, sameTerms, tokens,
  waitingPurchase, yearlyOff
} from './purchase';
import { walletLink } from './wallet';

const DAY = 86_400_000;
/** The networks in the canvas's order; any other the server offers comes after them, in its order. */
const ORDER = ['base', 'sol', 'eth', 'arb', 'pol', 'near', 'op', 'avax', 'bsc'];
const rank = (r: TopUpRoute) => { const i = ORDER.indexOf(r.chain); return i < 0 ? ORDER.length : i; };
const PRICED = 'Priced in US dollars. 1 USDC is 1 dollar, so you send exactly the total.';

/** "Thursday 4 November 2027" */
const longDate = (d: Date) => `${longDay(d)} ${d.getFullYear()}`;
/** "4 Nov 2027" */
const shortDate = (d: Date) => `${dayMonth(d)} ${d.getFullYear()}`;
/** "16:12", "tomorrow 16:12", "Thu 12 Nov 16:12": until when an address is open. */
function byWhen(iso: string, now: number): string {
  const d = new Date(iso);
  const days = daysFromToday(d, new Date(now));
  return days <= 0 ? hm(d) : `${days === 1 ? 'tomorrow' : shortDay(d)} ${hm(d)}`;
}
/** A reference as a row shows it: the start of it. The receipt has it whole. */
const shortRef = (id: string) => (id.length > 10 ? id.slice(0, 8) : id);
/** The balance entry a purchase of `cost` made in the last day, newest first: its reference is the receipt's. */
const entryFor = (history: BalanceEntry[] | undefined, cost: number, now: number) =>
  history?.find((e) => e.microUsd === -cost && Date.parse(e.at) > now - DAY) ?? null;
/** The numbers of packs offered as cards: one, two and the most one purchase buys (10, 20 and 50 hours today). */
const packChoices = (max: number) => [...new Set([1, 2, max])].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);

/** The time now, a little stale: enough for an address to close while the window stays open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  return now;
}

/** What the window shows: choosing; a top-up opened to buy it, followed to the end; or bought from the balance. */
type View = { step: 'choose' } | { step: 'pay'; id: string } | { step: 'bought'; plan: Plan; buys: Purchase; at: number };

/** Where a top-up is, as the window says it. */
type Paying = 'send' | 'short' | 'closed-short' | 'seen' | 'bought' | 'refused' | 'added' | 'expired' | 'cancelled' | 'failed' | 'held';
function payingOf(t: TopUp, now: number): Paying {
  switch (t.state) {
    case 'waiting': return lapsed(t, now) ? 'expired' : 'send';
    case 'short': return lapsed(t, now) ? 'closed-short' : 'short';
    case 'arriving': return 'seen';
    case 'credited': return !t.purchase ? 'added' : t.purchase.outcome === 'bought' ? 'bought' : t.purchase.outcome === 'refused' ? 'refused' : 'seen';
    case 'held': return 'held';
    case 'failed': return 'failed';
    case 'expired': return 'expired';
    case 'cancelled': return 'cancelled';
  }
}
const STAGE: Record<Paying, CheckoutStage> = {
  send: 'send', short: 'short', 'closed-short': 'closed', seen: 'seen', bought: 'done', refused: 'choose', added: 'done',
  expired: 'closed', cancelled: 'closed', failed: 'closed', held: 'closed'
};

/** "A year or more", "6 months or more": the lengths the lower price is for. */
const yearlyWords = (offers: PlanOffers) => {
  const from = offers.pro.yearly?.fromMonths ?? 12;
  return from === 12 ? 'A year or more' : `${monthsWord(from)} or more`;
};

/** A purchase's lines in the summary, its name, and what the phone's one line says of it. */
function described(buys: Purchase, offers: PlanOffers): { name: string; brief: string; lines: SummaryLine[] } {
  if (buys.kind === 'pro') {
    const monthly = offers.pro.microUsdPerMonth;
    const lower = buys.microUsdPerMonth < monthly && buys.months >= (offers.pro.yearly?.fromMonths ?? Infinity);
    const pct = lower ? yearlyOff(offers) : null;
    const lines: SummaryLine[] = lower
      ? [{ label: `${monthsWord(buys.months)} at ${usd(monthly)}`, value: usd(buys.months * monthly) },
        { label: `${yearlyWords(offers)}${pct ? `: ${pct}% off` : ''}`, value: `−${usd(buys.months * (monthly - buys.microUsdPerMonth))}`, off: true }]
      : [{ label: `${monthsWord(buys.months)} at ${usd(buys.microUsdPerMonth)}`, value: usd(costOf(buys)) }];
    return { name: 'Pro', brief: `${monthsWord(buys.months)}${pct ? ` · ${pct}% off` : ''}`, lines };
  }
  const hours = hoursIn(offers, buys.packs);
  const minutes = offers.hours?.minutes ?? 0;
  const perHour = minutes > 0 ? Math.round((buys.microUsdPerPack * 60) / minutes) : 0;
  const label = perHour > 0 ? `${hours} hours at ${usd(perHour)} an hour` : `${hours} hours of notes`;
  return { name: `${hours} hours of notes`, brief: 'For this period', lines: [{ label, value: usd(costOf(buys)) }] };
}

/** What Done says of a purchase, and its receipt. */
interface Done {
  title: string; lines: string[]; reminder: string | null;
  row: { title: string; sub: string; reference: string | null };
  receipt: { title: string; lines: ReceiptLine[]; total: string };
}

export function CheckoutHost({ open, onClose, onCompare }: { open: CheckoutOpen; onClose: () => void; onCompare?: (() => void) | undefined }) {
  const plan = useQuery(q.plan());
  const offers = useQuery(q.offers());
  const routes = useQuery(q.topUpRoutes());
  const list = useQuery(q.topUps());
  const signedIn = useQuery(q.session()).data?.user.name ?? null;
  const theme = useTheme().resolved;
  const online = useOnline();
  const now = useNow();
  const toast = useToast();
  const buyPro = useBuyPro();
  const buyHours = useBuyHours();
  const start = useStartTopUp();
  const cancel = useCancelTopUp();
  const p = plan.data;
  const o = offers.data;

  /* What checkout opened on, kept as it was: buying Pro makes the plan Pro, and the window still says Get Pro. */
  const [opened, setOpened] = useState<{ extend: boolean; until: string | null; stopped: boolean } | null>(null);
  if (opened === null && p) setOpened({ extend: p.kind === 'pro' && p.pro.until !== null, until: p.pro.until, stopped: p.notes.stopped });
  /* Who it's for, once known: going offline doesn't make it someone else. */
  const [name, setName] = useState<string | null>(signedIn);
  if (name === null && signedIn !== null) setName(signedIn);

  /* Where the window starts: on the payment it was opened on, on one already on its way for the same thing, or choosing. */
  const [view, setView] = useState<View | null>(open.topUpId ? { step: 'pay', id: open.topUpId } : null);
  if (view === null && !list.isPending) {
    const going = waitingPurchase(list.data, open.what.plan, now);
    setView(going ? { step: 'pay', id: going.id } : { step: 'choose' });
  }
  const payId = view?.step === 'pay' ? view.id : null;
  const topUp = useQuery({ ...q.topUp(payId ?? ''), enabled: payId !== null });
  const t = payId !== null ? topUp.data : undefined;
  const paying = t ? payingOf(t, now) : null;

  /* What's chosen. The length and the number of hours start where the door says; the network is never chosen for them. */
  const [months, setMonths] = useState<number | null>(open.what.plan === 'pro' ? open.what.months ?? null : null);
  const [packs, setPacks] = useState<number>(open.what.plan === 'hours' ? open.what.packs ?? 1 : 1);
  const [other, setOther] = useState(false);
  const [routeId, setRouteId] = useState<string | null>(null);
  /** What to say about the last try: a refusal, a price that changed, a payment that bought nothing. */
  const [said, setSaid] = useState<{ text: string; ref: string | null } | null>(null);
  const [asking, setAsking] = useState(false);
  const [receipt, setReceipt] = useState(false);

  /** Back to choosing what a payment was for, as it was: the same length or hours, on the same network. */
  const chooseAgain = (old: TopUp) => {
    const b = old.purchase?.buys;
    if (b?.kind === 'pro') { setMonths(b.months); setOther(!LENGTHS.some((m) => m === b.months)); } else if (b) setPacks(b.packs);
    setRouteId(old.route.id);
    setAsking(false);
    setView({ step: 'choose' });
  };
  /*
   * A purchase refused once its payment was added: the money is in the balance, and choosing starts again from there, at
   * today's price, with why in the server's words ("The price of Pro changed before your payment arrived. It’s in your
   * balance.").
   */
  if (t && paying === 'refused' && t.purchase) {
    chooseAgain(t);
    setSaid({ text: t.purchase.why ?? `It wasn’t bought. The ${roundTokens(t.received?.microUsd ?? 0)} USDC that arrived is in your balance.`, ref: null });
  }

  /* The amount that arrived counts up only when it's seen while the window is open. */
  const stageNow = paying ?? view?.step ?? 'choose';
  const [lastStage, setLastStage] = useState<{ at: string; count: boolean }>({ at: stageNow, count: false });
  if (lastStage.at !== stageNow) setLastStage({ at: stageNow, count: stageNow === 'seen' && (lastStage.at === 'send' || lastStage.at === 'short') });

  /* ---------- what it costs ---------- */
  const kind = t?.purchase?.buys.kind ?? (view?.step === 'bought' ? view.buys.kind : open.what.plan);
  const extend = kind === 'pro' && opened?.extend === true;
  const balance = p?.balance.microUsd ?? 0;
  const maxMonths = o?.pro.maxMonths ?? 12;
  const yearly = o?.pro.yearly ?? null;
  const pct = o ? yearlyOff(o) : null;
  const chosenMonths = Math.min(maxMonths, Math.max(1, months ?? (yearly && yearly.fromMonths <= maxMonths ? yearly.fromMonths : 1)));
  const lengths = LENGTHS.filter((m) => m <= maxMonths);
  const otherOpen = other || !lengths.some((m) => m === chosenMonths);
  const hoursOffer = o?.hours ?? null;
  const chosenPacks = Math.min(hoursOffer?.maxPacks ?? 1, Math.max(1, packs));
  const buys: Purchase | null = !o ? null
    : kind === 'pro' ? { kind: 'pro', months: chosenMonths, microUsdPerMonth: proPrice(o, chosenMonths) }
    : hoursOffer ? { kind: 'hours', packs: chosenPacks, microUsdPerPack: hoursOffer.microUsd, minutesPerPack: hoursOffer.minutes } : null;
  const cost = buys ? costOf(buys) : 0;
  const fromBalance = Math.min(balance, cost);
  const need = cost - fromBalance;
  const usdc = (routes.data?.routes ?? []).filter((r) => r.token === 'USDC').sort((a, b) => rank(a) - rank(b));
  const paymentsOff = routes.isError || (routes.isSuccess && usdc.length === 0);
  const route = usdc.find((r) => r.id === routeId) ?? null;
  const send = need > 0 ? Math.max(need, route ? microOf(route.minimum) ?? 0 : 0) : 0;
  const busy = buyPro.isPending || buyHours.isPending || start.isPending;

  /** When Pro would run to with `n` more months bought now: after the months already bought, or from now. */
  const proUntil = (n: number) => {
    const from = opened?.until && Date.parse(opened.until) > now ? Date.parse(opened.until) : now;
    return new Date(from + n * (o?.periodDays ?? 30) * DAY);
  };
  /** When Pro runs to once it's bought: the plan's, once it has the months bought, else what buying them made it. */
  const boughtUntil = (n: number, fresh: Plan | undefined) => {
    const after = fresh?.pro.until ? Date.parse(fresh.pro.until) : 0;
    return after > (opened?.until ? Date.parse(opened.until) : 0) ? new Date(after) : proUntil(n);
  };
  const daysLeft = opened?.until ? Math.max(1, Math.ceil((Date.parse(opened.until) - now) / DAY)) : 0;
  const forWhom = kind === 'hours' ? 'For this period' : extend ? `Added to the ${plural(daysLeft, 'day')} you have left` : name ? `For ${name}` : 'For you';
  const periodEnd = p ? new Date(p.period.to) : null;

  /* ---------- doing it ---------- */
  const title = kind === 'hours' ? 'More notes' : extend ? 'Extend Pro' : 'Get Pro';
  /**
   * Says why a purchase or a payment was refused, in the server's words ("The price of Pro has changed. Look at it again
   * before buying.", "Your balance is short of what …"); the mutation reads the plan and the offers again, so what's shown next is
   * today's. A failure that isn't a refusal carries its reference for support.
   */
  const refused = (e: unknown) => {
    const code = errorCode(e);
    setSaid({ text: errorMessage(e), ref: code === 'conflict' || code === 'invalid' ? null : errorRequestId(e) ?? null });
  };
  const buy = (b: Purchase) => {
    setSaid(null);
    const done = (fresh: Plan) => setView({ step: 'bought', plan: fresh, buys: b, at: Date.now() });
    if (b.kind === 'pro') buyPro.mutate({ months: b.months, microUsdPerMonth: b.microUsdPerMonth }, { onSuccess: done, onError: refused });
    else buyHours.mutate({ packs: b.packs, microUsdPerPack: b.microUsdPerPack, minutesPerPack: b.minutesPerPack }, { onSuccess: done, onError: refused });
  };
  const getAddress = (r: TopUpRoute, microUsd: number, b: Purchase) => {
    setSaid(null);
    start.mutate({ routeId: r.id, microUsd, buys: b }, { onSuccess: (fresh) => setView({ step: 'pay', id: fresh.id }), onError: refused });
  };
  /**
   * The way on from a payment for something whose address has closed, as fits: a new address on the same network for what
   * the balance is short of, while what it was for is on today's terms; otherwise back to choosing, where the balance buys
   * it once it covers it, and a changed price or a network gone is chosen afresh.
   */
  const wayOn = (old: TopUp): { label: string; go: () => void } | null => {
    if (!old.purchase) return null;
    const was = old.purchase.buys;
    const b = o ? repriced(o, was) : null;
    const r = usdc.find((x) => x.id === old.route.id);
    const short = b ? costOf(b) - Math.min(balance, costOf(b)) : 0;
    if (b && r && short > 0 && sameTerms(b, was)) return { label: 'Get a new address', go: () => getAddress(r, Math.max(short, microOf(r.minimum) ?? 0), b) };
    return { label: 'Choose again', go: () => chooseAgain(old) };
  };
  const cancelPayment = (id: string) => cancel.mutate(id, { onSuccess: () => { toast('Payment cancelled'); onClose(); }, onError: () => setAsking(false) });

  /** What Done says of `b`, bought from the balance or by `paid`, and its receipt. */
  const doneOf = (b: Purchase, paid: TopUp | null, fresh: Plan | undefined, offerNow: PlanOffers): Done => {
    const bought = purchaseName(b, offerNow);
    const c = costOf(b);
    const asked = paid ? microOf(paid.asked.amount) ?? 0 : 0;
    // What was sent, in tokens, and what it added to the balance (what was asked, when a little less arrived within the band).
    const sent = paid ? microOf(paid.received?.amount ?? paid.asked.amount) ?? asked : 0;
    const added = paid ? paid.received?.microUsd ?? sent : 0;
    const entry = entryFor(fresh?.balance.history, c, now);
    const at = new Date(entry ? Date.parse(entry.at) : now);
    const lines: string[] = [];
    let heading: string;
    let until: Date | null;
    if (b.kind === 'pro') {
      until = boughtUntil(b.months, fresh);
      heading = extend ? `Pro runs to ${shortDate(until)}` : 'You’re on Pro';
      lines.push(`Until ${longDate(until)}.`);
    } else {
      until = periodEnd;
      heading = `${hoursIn(offerNow, b.packs)} more hours of notes`;
      lines.push(`They’re yours until this period ends${until ? ` on ${longDay(until)}` : ''}${opened?.stopped ? ', and notes start again now' : ''}.`);
    }
    if (paid && sent > asked) lines.push(`You sent ${tokens(sent)} USDC, ${tokens(sent - asked)} more than asked: it’s in your balance.`);
    if (open.from === 'call' && b.kind === 'pro' && opened?.stopped) lines.push('Notes are on again in the call.');
    const reference = entry?.id ?? paid?.id ?? null;
    return {
      title: heading, lines,
      reminder: b.kind === 'hours' ? null : fresh?.pro.renew ? 'Renews from your balance.' : 'Nothing renews by itself. Alcove reminds you before it ends.',
      row: {
        title: paid ? `${tokens(added)} USDC on ${paid.route.chainName}` : `${usd(c)} from your balance`,
        sub: `${shortDate(at)} · ${bought}`, reference: reference ? shortRef(reference) : null
      },
      receipt: {
        title: bought, total: usdCents(c),
        lines: [
          { label: 'Date', value: `${longDate(at)}, ${hm(at)}` },
          ...(name ? [{ label: 'For', value: name }] : []),
          { label: 'Bought', value: bought },
          ...(until ? [{ label: b.kind === 'pro' ? 'Pro until' : 'For this period, to', value: longDate(until) }] : []),
          { label: 'Price', value: usdCents(c) },
          paid
            ? { label: 'Paid', value: `${tokens(added)} USDC on ${paid.route.chainName}${c > added ? `, and ${usdCents(c - added)} from your balance` : ''}` }
            : { label: 'Paid', value: `${usdCents(c)} from your balance` },
          ...(entry ? [{ label: 'Reference', value: entry.id, mono: true }] : []),
          ...(paid ? [{ label: 'Payment', value: paid.id, mono: true }] : [])
        ]
      }
    };
  };

  /* ---------- what you're buying ---------- */
  const shown: Purchase | null = view?.step === 'bought' ? view.buys : t?.purchase?.buys ?? buys;
  const art = kind === 'pro' ? 'pro' : 'hours';
  let summary: CheckoutSummaryData = { art, name: kind === 'pro' ? 'Pro' : 'More notes', sub: forWhom, brief: '', lines: [], total: null, foot: PRICED };
  if (o && shown) {
    const d = described(shown, o);
    const c = costOf(shown);
    const isDone = view?.step === 'bought' || paying === 'bought';
    const until = shown.kind === 'pro'
      ? { lead: 'Pro until', day: longDate(isDone ? boughtUntil(shown.months, view?.step === 'bought' ? view.plan : p) : proUntil(shown.months)) }
      : periodEnd ? { lead: 'Until', day: longDate(periodEnd) } : null;
    summary = { ...summary, name: d.name, brief: d.brief, lines: d.lines, until };
    if (t) {
      // A payment: what was asked of it, and what the balance gave beside it.
      const asked = microOf(t.asked.amount) ?? 0;
      summary.lines = [...d.lines, ...(c > asked ? [{ label: 'Your balance', value: `−${usd(c - asked)}` }] : [])];
      summary.extra = asked > c ? `${t.route.chainName} takes at least ${t.route.minimum} USDC, so ${tokens(asked - c)} of it stays in your balance.` : null;
      summary.total = { value: tokens(asked), unit: 'USDC' };
    } else if (view?.step === 'bought') {
      summary.total = { value: usd(c) };
      summary.foot = 'Paid from your balance.';
    } else if (need > 0) {
      summary.lines = [...d.lines, ...(fromBalance > 0 ? [{ label: 'Your balance', value: `−${usd(fromBalance)}` }] : [])];
      summary.extra = route && send > need ? `${route.chainName} takes at least ${route.minimum} USDC, so ${tokens(send - need)} of it stays in your balance.` : null;
      summary.total = { value: tokens(send), unit: 'USDC' };
    } else {
      summary.total = { value: usd(cost) };
      summary.foot = `Paid from your balance: ${usd(balance)} now, ${usd(balance - cost)} after.`;
    }
  }

  /* ---------- the step ---------- */
  const close = <Button variant="secondary" onClick={onClose}>Close</Button>;
  const finish = <Button variant="primary" onClick={onClose}>{open.from === 'call' ? 'Back to the call' : 'Done'}</Button>;
  const offline = !online && <p className="hint">You’re offline. Everything catches up when you’re back.</p>;
  const note = said && <CheckoutNote>{said.text}{said.ref && <><br /><RequestRef id={said.ref} /></>}</CheckoutNote>;
  const waiting = (words: string) => <p className="ck-wait" role="status"><Dots />{words}</p>;
  let step: 1 | 2 | 3 = 1;
  let stage: CheckoutStage = 'choose';
  let body: ReactNode;
  let foot: ReactNode = close;
  let footKey = '';
  let done: Done | null = null;

  if (view === null || (!o && !offers.isError) || (!p && !plan.isError)) {
    body = waiting(view?.step === 'pay' ? 'Opening your payment' : 'Looking up the price');
    // Its own foot, so what replaces it once it's read is new, and focus goes where the step puts it.
    footKey = 'wait';
  } else if (!o || !p) {
    body = <CheckoutNote>{errorMessage(offers.error ?? plan.error)}</CheckoutNote>;
    foot = <><Button variant="quiet" className="ck-push" onClick={onClose}>Close</Button><Button variant="secondary" onClick={() => { void offers.refetch(); void plan.refetch(); }}>Try again</Button></>;
  } else if (view.step === 'bought') {
    step = 3;
    stage = 'done';
    done = doneOf(view.buys, null, view.plan, o);
    foot = finish;
  } else if (view.step === 'pay') {
    step = 2;
    if (!t || !paying) {
      body = topUp.isError ? <CheckoutNote>{errorMessage(topUp.error)}</CheckoutNote> : waiting('Opening your payment');
    } else {
      stage = STAGE[paying];
      const asked = microOf(t.asked.amount) ?? 0;
      const got = microOf(t.received?.amount ?? '') ?? 0;
      const { chain, chainName } = t.route;
      const expires = `Open until ${byWhen(t.expiresAt, now)}`;
      const onlyThis = <CheckoutNote>Only send USDC on {chainName}. Anything else may be lost. Sending from an exchange? Add its withdrawal fee on top.</CheckoutNote>;
      if (paying === 'send' || paying === 'short') {
        const short = paying === 'short';
        const rest = short ? Math.max(0, asked - got) : asked;
        body = (
          <>
            {short
              ? <PayStatus tone="caution" icon="alert" label="Less than asked arrived" expires={expires} />
              : <PayStatus dots label="Waiting for your payment" expires={expires} />}
            <PayAmount label={short ? 'Send the rest' : 'Send exactly'} amount={tokens(rest)} copy={plainTokens(rest)} chain={chain} chainName={chainName}
              arrived={short ? `${tokens(got)} of ${tokens(asked)} USDC arrived.` : null} />
            {t.address && (
              <PayAddress address={t.address} memo={t.memo} chainName={chainName} tag={short ? 'same' : 'new'} listening quiet={asking}
                walletHref={walletLink(t.route, t.address, plainTokens(rest))} />
            )}
            {short && <CheckoutNote tone="info">If you don’t, the {roundTokens(got)} USDC that arrived stays in your balance.</CheckoutNote>}
            {onlyThis}
            {cancel.isError && <CheckoutNote>{errorMessage(cancel.error)}</CheckoutNote>}
          </>
        );
        footKey = asking ? 'ask' : '';
        foot = asking ? (
          <CheckoutAsk title="Cancel this payment?" text="Its address stops showing here. A payment already sent to it still counts when it arrives."
            confirm="Cancel payment" keep="Keep waiting" busy={cancel.isPending} onConfirm={() => cancelPayment(t.id)} onKeep={() => setAsking(false)} />
        ) : (
          <>
            <p className="hint">{kind === 'hours' ? 'You can close this. The hours are added as soon as your payment arrives.' : `You can close this. ${extend ? 'Pro is extended' : 'Pro starts'} as soon as your payment arrives.`}</p>
            {!short && <Button variant="quiet" disabled={!online} onClick={() => setAsking(true)}>Cancel payment</Button>}
            {close}
          </>
        );
      } else if (paying === 'seen') {
        body = (
          <>
            <PayStatus dots label="Payment seen" />
            <PayArrived amount={tokens(got || asked)} value={(got || asked) / 1_000_000} chainName={chainName} count={lastStage.count} />
            <CheckoutLine>{kind === 'hours' ? 'Adding your hours. This takes a minute or two.' : extend ? 'Extending Pro. This takes a minute or two.' : 'Starting Pro. This takes a minute or two.'}</CheckoutLine>
            <PayTrack steps={['Sent', `Seen on ${chainName}`, kind === 'hours' ? 'Hours added' : extend ? 'Pro extended' : 'Pro starts']} />
          </>
        );
        foot = <><p className="hint">You can close this. It finishes by itself.</p>{close}</>;
      } else if (paying === 'bought' && t.purchase) {
        step = 3;
        done = doneOf(t.purchase.buys, t, p, o);
        foot = finish;
      } else if (paying === 'added' || paying === 'bought') {
        step = 3;
        body = <CheckoutDone title="Added to your balance" lines={[`${usd(t.received?.microUsd ?? 0)} is in your balance now.`]} receipt={null} reminder={null} />;
        foot = finish;
      } else if (paying === 'closed-short') {
        // Less than asked arrived and the address closed: what arrived settles into the balance, and what it was for is had another way.
        const next = wayOn(t);
        const what = kind === 'hours' ? 'more notes' : 'Pro';
        body = (
          <>
            <PayStatus tone="quiet" icon="clock" label="Address closed" />
            <CheckoutBig>{tokens(got)} of {tokens(asked)} USDC arrived</CheckoutBig>
            <CheckoutLine>The address has closed, so nothing more can be sent to it. What arrived goes into your balance once the payment settles.</CheckoutLine>
            {next && (
              <CheckoutLine>
                {next.label === 'Get a new address'
                  ? `To get ${what} now, get a new address. What arrived here isn’t in your balance until it settles, so it doesn’t count toward it.`
                  : `To get ${what} now, choose again.`}
              </CheckoutLine>
            )}
            {note}
          </>
        );
        foot = (
          <>
            <Button variant="quiet" className="ck-push" onClick={onClose}>Close</Button>
            {offline}
            {next && <Button variant="primary" loading={start.isPending} disabled={!online || busy} onClick={next.go}>{next.label}</Button>}
          </>
        );
      } else if (paying === 'expired' || paying === 'cancelled') {
        const expired = paying === 'expired';
        const next = wayOn(t);
        const what = kind === 'hours' ? 'more notes' : 'Pro';
        body = (
          <>
            <PayStatus tone="quiet" icon={expired ? 'clock' : 'x'} label={expired ? 'Address closed' : 'Payment cancelled'} />
            <CheckoutBig>{expired ? 'Nothing arrived in 24 hours' : 'This payment was cancelled'}</CheckoutBig>
            <CheckoutLine>
              {expired ? 'So nothing was charged.' : 'A payment already sent to its address still counts when it arrives.'}
              {next && (next.label === 'Get a new address'
                ? ` If you still want ${what}, get a new address${expired ? ': it’s made for the next 24 hours' : ''}.`
                : ` If you still want ${what}, choose again.`)}
            </CheckoutLine>
            {note}
          </>
        );
        foot = (
          <>
            <Button variant="quiet" className="ck-push" onClick={onClose}>Close</Button>
            {offline}
            {next && <Button variant="primary" loading={start.isPending} disabled={!online || busy} onClick={next.go}>{next.label}</Button>}
          </>
        );
      } else if (paying === 'failed' || paying === 'held') {
        const failed = paying === 'failed';
        body = (
          <>
            <PayStatus tone="caution" icon="alert" label={failed ? 'Something went wrong' : 'Too little arrived'} />
            <CheckoutBig>{failed ? 'Something went wrong with this payment' : 'Too little arrived to add'}</CheckoutBig>
            <CheckoutLine>
              {failed
                ? 'It needs a person to look at it. Give support this reference and they’ll sort it out.'
                : 'What arrived is too little to add. If you think that’s wrong, give support this reference.'}
            </CheckoutLine>
            <RequestRef id={t.id} className="ck-ref" />
          </>
        );
      }
    }
  } else {
    // Choosing.
    const offLabel = pct !== null ? `${pct}% off` : null;
    body = (
      <>
        {note}
        {kind === 'pro' ? (
          <MonthsPicker autoFocus label={extend ? 'How much longer' : 'How long'} value={chosenMonths} offLabel={offLabel}
            options={lengths.map((m): MonthsOption => {
              const price = proPrice(o, m);
              return { months: m, total: usd(m * price), each: `${usd(price)} a month`, off: price < o.pro.microUsdPerMonth };
            })}
            onChange={(m) => { setMonths(m); setOther(false); }}
            other={{
              open: otherOpen, max: maxMonths,
              price: `${usd(chosenMonths * proPrice(o, chosenMonths))}${offLabel && proPrice(o, chosenMonths) < o.pro.microUsdPerMonth ? `, ${offLabel}` : ''}`,
              onOpen: () => { setOther(true); setMonths(chosenMonths < maxMonths ? chosenMonths + 1 : chosenMonths); },
              onStep: (m) => { setOther(true); setMonths(m); }
            }} />
        ) : hoursOffer ? (
          <HoursPicker autoFocus value={chosenPacks} hint={`${usd(Math.round((hoursOffer.microUsd * 60) / hoursOffer.minutes))} an hour`} onChange={setPacks}
            options={packChoices(hoursOffer.maxPacks).map((n): HoursOption => {
              const h = hoursIn(o, n);
              return { packs: n, hours: `${h} hours`, price: usd(n * hoursOffer.microUsd), sub: `${h} hour-long calls` };
            })} />
        ) : <CheckoutNote>More notes aren’t offered right now.</CheckoutNote>}
        {buys && need > 0 && (paymentsOff
          ? <CheckoutNote>Paying with USDC isn’t available right now. Try again later.</CheckoutNote>
          : routes.isPending
            ? <div className="ck-sec">{waiting('Looking up the networks')}</div>
            : <NetworkPicker value={route?.id ?? null} onChange={setRouteId}
                options={usdc.map((r) => ({ id: r.id, chain: r.chain, name: r.chainName, note: Number(r.minimum) > 5 ? `From ${r.minimum}` : null }))} />)}
      </>
    );
    // Away from Plans (and not over a call, which going to Plans would leave): from the welcome page, Plans is behind it.
    const compare = kind === 'pro' && onCompare && open.from !== 'plans' && open.from !== 'welcome' && open.from !== 'call'
      && <Button variant="quiet" className="ck-push" onClick={onCompare}>Compare plans</Button>;
    foot = (
      <>
        {compare}
        {offline}
        {!buys ? close : need > 0 ? (
          <Button variant="primary" loading={start.isPending} disabled={!route || paymentsOff || !online || busy}
            onClick={() => { if (route) getAddress(route, send, buys); }}>{start.isPending ? 'Getting the address' : 'Get the address'}</Button>
        ) : (
          <Button variant="primary" loading={buyPro.isPending || buyHours.isPending} disabled={!online || busy} onClick={() => buy(buys)}>
            {buyPro.isPending || buyHours.isPending ? 'Buying' : 'Buy with your balance'}
          </Button>
        )}
      </>
    );
  }
  if (done) {
    const d = done;
    body = <CheckoutDone title={d.title} lines={d.lines} reminder={d.reminder} receipt={{ ...d.row, onOpen: () => setReceipt(true) }} />;
  }

  return (
    <CheckoutWindow title={title} step={step} stage={stage} summary={summary} foot={foot} footKey={footKey} onClose={onClose}
      theme={open.from === 'call' ? theme : null}
      receipt={receipt && done ? <PaymentReceipt {...done.receipt} onPrint={() => window.print()} onBack={() => setReceipt(false)} /> : undefined}>
      {body}
    </CheckoutWindow>
  );
}
