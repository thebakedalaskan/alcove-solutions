/*
 * The checkout window (docs/design/pages.md › Checkout; the canvas's Checkout and PayMotion boards): what checkout.tsx has open, drawn with the kit's CheckoutWindow and its parts, at the
 * app's root (routes/__root.tsx), so the call, Settings, Plans and any door open the same window.
 *
 * Choose how long (or how many hours, or how many of Team's licenses: a team you start is named first, and made only as
 * you pay, with you its admin). When the balance covers it, Buy with your balance takes it from there at once.
 * Otherwise choose a network, and Get the address opens a top-up for what the balance is short of (raised to the
 * network's least, the rest staying in the balance) that buys it the moment it's added. From then on the window follows
 * that top-up, which q.topUp reads every 5 seconds: waiting, less arrived, seen, bought, and every way it can go wrong, with
 * the parts Add money follows a payment with too (paying.tsx).
 * Closing leaves the payment running, and checkout opened on the same thing again opens that payment, not another.
 * Every price and limit is the server's; a price that changed in between is refused, read again and said. Licenses
 * bought are a visit too, which takes the buyer's own when they have none (docs: Plans and usage › Team).
 */
import { errorCode, errorMessage, errorRequestId, type BalanceEntry, type MyTeam, type Plan, type PlanOffers, type Purchase, type TopUp, type TopUpRoute } from '@alcove/api';
import {
  Avatar, Button, CheckoutAsk, CheckoutDone, CheckoutNote, CheckoutWindow, Dots, HoursPicker, LicensesLeft, LicensesPicker, MonthsPicker,
  NetworkPicker, PaymentReceipt, RequestRef,
  TeamInvite, TeamName, useTheme, useToast,
  type AvatarPerson, type CheckoutStage, type CheckoutSummaryData, type HoursOption, type LicensesOption, type MonthsOption,
  type ReceiptLine, type SummaryLine
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNow, useOnline } from '~/lib/live';
import { callName, someNames } from '~/lib/people';
import { q, topUpOpen, useBuy, useCancelTopUp, useCreateTeam, useLicensesBought, useStartTopUp } from '~/lib/queries';
import { fullDate, hm, longDay, shortDate } from '~/lib/time';
import { plural, usd, usdCents } from '~/lib/words';
import { useInvite } from '../team/invite';
import type { CheckoutOpen } from './checkout';
import { PayAdded, PayNow, PayOver, PaySeen, isOver, payingOf, useSeenWhileOpen, type Paying } from './paying';
import { renews, teamLicenses } from './plan-state';
import {
  LENGTHS, LICENSES, costOf, kindOf, lapsed, microOf, proPrice, purchaseName, repriced, roundTokens, sameTerms, tokens,
  waitingPurchase, yearlyOff
} from './purchase';
import { hoursOfNotes, moreHoursOfNotes } from './words';

const DAY = 86_400_000;
/** The networks in the canvas's order; any other the server offers comes after them, in its order. */
const ORDER = ['base', 'sol', 'eth', 'arb', 'pol', 'near', 'op', 'avax', 'bsc'];
const rank = (r: TopUpRoute) => { const i = ORDER.indexOf(r.chain); return i < 0 ? ORDER.length : i; };
const PRICED = 'Priced in US dollars. 1 USDC is 1 dollar, so you send exactly the total.';

/** A reference as a row shows it: the start of it. The receipt has it whole. */
const shortRef = (id: string) => (id.length > 10 ? id.slice(0, 8) : id);
/** The balance entry a purchase of `cost` made in the last day, newest first: its reference is the receipt's. */
const entryFor = (history: BalanceEntry[] | undefined, cost: number, now: number) =>
  history?.find((e) => e.microUsd === -cost && Date.parse(e.at) > now - DAY) ?? null;
/** The numbers of packs offered as cards: one, two and the most one purchase buys (10, 20 and 50 hours today). */
const packChoices = (max: number) => [...new Set([1, 2, max])].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
/** How tall the three people standing on Team's horizon are, as the canvas draws them. */
const FOLK = [18, 20, 17] as const;

/* ---------- Team ---------- */

/**
 * Whether the team you're on is still being started: there's none yet, or it's yours with nothing bought for it and nobody
 * ever licensed (made as a payment for its first licenses was opened). Starting one names it; Done says it's on Team.
 */
const starts = (t: MyTeam | null): boolean =>
  t === null || (t.role === 'admin' && (t.licenses?.unconsumed ?? 0) === 0 && t.members.every((m) => m.license.state === 'none'));
const isAre = (n: number) => (n === 1 ? 'is' : 'are');

/** What Done says of the licenses a team was started with: whose they are, and when each is taken. */
function startedWith(count: number, yoursTaken: boolean): string {
  if (count === 1) return yoursTaken ? '1 license, and it’s yours, taken now. Buy more for the people you invite.' : '1 license: it’s taken when you or someone you invite next opens Alcove.';
  return yoursTaken
    ? `${count} licenses, for you and the people you invite. Yours is taken now, and each of theirs when they next open Alcove.`
    : `${count} licenses, for you and the people you invite. Each is taken when its person next opens Alcove.`;
}
/** What Done says once more licenses are bought: how many are left now, and whether the people waiting each get one. */
function leftNow(t: MyTeam | null): string | null {
  const counts = teamLicenses(t);
  if (!counts) return null;
  const { left, waiting } = counts;
  const n = waiting.length;
  const who = someNames(waiting.map((m) => m.person));
  if (left === 0) return n ? `None left now. ${who} ${isAre(n)} still waiting for one.` : 'None left now.';
  const said = `${plural(left, 'license')} left now.`;
  if (!n) return `${said} Each is taken when someone without one next opens Alcove.`;
  if (left >= n) return `${said} ${who} ${n === 1 ? 'gets' : 'get'} one the next time they open Alcove.`;
  return `${said} ${who} are waiting for one: the first ${left} to open Alcove get one.`;
}


/** What the window shows: choosing; a top-up opened to buy it, followed to the end; or bought from the balance. */
type View = { step: 'choose' } | { step: 'pay'; id: string } | { step: 'bought'; plan: Plan; buys: Purchase; at: number };

/** Where the window is, by where its payment is (paying.tsx). */
const STAGE: Record<Paying, CheckoutStage> = {
  send: 'send', short: 'short', 'closed-short': 'closed', seen: 'seen', bought: 'done', refused: 'choose', added: 'done',
  expired: 'closed', cancelled: 'closed', failed: 'closed', held: 'closed'
};

/** "A year or more", "6 months or more": the lengths the lower price is for. */
const yearlyWords = (offers: PlanOffers) => {
  const from = offers.pro.yearly?.fromMonths ?? 12;
  return from === 12 ? 'A year or more' : `${plural(from, 'month')} or more`;
};

/** A purchase's lines in the summary, its name, and what the phone's one line says of it. */
function described(buys: Purchase, offers: PlanOffers): { name: string; brief: string; lines: SummaryLine[] } {
  if (buys.kind === 'pro') {
    const monthly = offers.pro.microUsdPerMonth;
    const lower = buys.microUsdPerMonth < monthly && buys.months >= (offers.pro.yearly?.fromMonths ?? Infinity);
    const pct = lower ? yearlyOff(offers) : null;
    const lines: SummaryLine[] = lower
      ? [{ label: `${plural(buys.months, 'month')} at ${usd(monthly)}`, value: usd(buys.months * monthly) },
        { label: `${yearlyWords(offers)}${pct ? `: ${pct}% off` : ''}`, value: `−${usd(buys.months * (monthly - buys.microUsdPerMonth))}`, off: true }]
      : [{ label: `${plural(buys.months, 'month')} at ${usd(buys.microUsdPerMonth)}`, value: usd(costOf(buys)) }];
    return { name: 'Pro', brief: `${plural(buys.months, 'month')}${pct ? ` · ${pct}% off` : ''}`, lines };
  }
  if (buys.kind === 'licenses') return { name: 'Team', brief: plural(buys.count, 'license'), lines: [{ label: `${plural(buys.count, 'license')} at ${usd(buys.microUsdPerLicense)}`, value: usd(costOf(buys)) }] };
  const hours = hoursOfNotes(buys.packs * buys.minutesPerPack);
  const perHour = Math.round((buys.microUsdPerPack * 60) / buys.minutesPerPack);
  return { name: `${hours} of notes`, brief: 'For this period', lines: [{ label: `${hours} at ${usd(perHour)} an hour`, value: usd(costOf(buys)) }] };
}

/** What Done says of a purchase, its receipt, and what's said on the page under it once the window closes (`toast`). */
interface Done {
  title: string; lines: string[]; reminder: string | null; toast: string;
  /** A team was just started: Done invites its people. */
  invite: boolean;
  row: { title: string; sub: string; reference: string | null };
  receipt: { title: string; lines: ReceiptLine[]; total: string };
}

export function CheckoutHost({ open, onClose, onCompare }: { open: CheckoutOpen; onClose: () => void; onCompare?: (() => void) | undefined }) {
  const forTeam = open.what.plan === 'team';
  /* Done invites a just-started team's people: the same links as Team's Invite people. */
  const invite = useInvite();
  const plan = useQuery(q.plan());
  const offers = useQuery(q.offers());
  const routes = useQuery(q.topUpRoutes());
  const list = useQuery(q.topUps());
  const me = useQuery(q.session()).data?.user ?? null;
  const signedIn = me?.name ?? null;
  /* Team: the team you're on (if any), and the company the directory knows, for its name and its people. */
  const team = useQuery({ ...q.myTeam(), enabled: forTeam });
  const directory = useQuery({ ...q.team(), enabled: forTeam });
  const theme = useTheme().resolved;
  const online = useOnline();
  const now = useNow();
  const toast = useToast();
  const buying = useBuy();
  const start = useStartTopUp();
  const cancel = useCancelTopUp();
  const createTeam = useCreateTeam();
  const settle = useLicensesBought();
  const settleLicenses = settle.mutate;
  const p = plan.data;
  const o = offers.data;

  /* What checkout opened on, kept as it was: buying Pro makes the plan Pro, and the window still says Get Pro. */
  const [opened, setOpened] = useState<{ extend: boolean; until: string | null; stopped: boolean } | null>(null);
  if (opened === null && p) setOpened({ extend: p.kind === 'pro' && p.pro.until !== null, until: p.pro.until, stopped: p.notes.stopped });
  /* Who it's for, once known: going offline doesn't make it someone else. */
  const [name, setName] = useState<string | null>(signedIn);
  if (name === null && signedIn !== null) setName(signedIn);
  /*
   * Team, as it opened: starting one (Start a team, and Done says it's on Team), or its admin buying more (Buy licenses).
   * Kept as it was, as `opened` is: the team made as you pay doesn't turn the window into another. Its name starts as the
   * company's, where the directory knows it.
   */
  const [starting, setStarting] = useState<boolean | null>(null);
  if (forTeam && starting === null && team.isSuccess) setStarting(starts(team.data));
  const [teamName, setTeamName] = useState<string | null>(null);
  if (forTeam && teamName === null && team.isSuccess && !directory.isPending) setTeamName(team.data?.name ?? directory.data?.name ?? '');
  const teamReady = !forTeam || (starting !== null && teamName !== null);

  /* Where the window starts: on the payment it was opened on, on one already on its way for the same thing, or choosing. */
  const [view, setView] = useState<View | null>(open.topUpId ? { step: 'pay', id: open.topUpId } : null);
  if (view === null && !list.isPending) {
    const going = waitingPurchase(list.data, kindOf(open.what.plan), now);
    setView(going ? { step: 'pay', id: going.id } : { step: 'choose' });
  }
  const payId = view?.step === 'pay' ? view.id : null;
  // Every 5 s while money can arrive; once a waiting address has closed (it stays waiting until it's given up on), every minute.
  const topUp = useQuery({
    ...q.topUp(payId ?? ''),
    enabled: payId !== null,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d || !topUpOpen(d)) return false;
      return d.state === 'waiting' && lapsed(d) ? 60_000 : 5000;
    }
  });
  const t = payId !== null ? topUp.data : undefined;
  const paying = t ? payingOf(t, now) : null;
  /*
   * Licenses a payment bought: the visit buying them makes (which takes yours when you have none), and the plan and team
   * read again, once for each payment, before Done says what's true.
   */
  const boughtLicenses = t && paying === 'bought' && t.purchase?.buys.kind === 'licenses' ? t.id : null;
  const [settledFor, setSettledFor] = useState<string | null>(null);
  useEffect(() => {
    if (boughtLicenses === null || settledFor === boughtLicenses) return;
    setSettledFor(boughtLicenses);
    settleLicenses();
  }, [boughtLicenses, settledFor, settleLicenses]);
  const settling = boughtLicenses !== null && (settledFor !== boughtLicenses || settle.isPending);

  /*
   * What's chosen. The length, the number of hours and the number of licenses start where the door says (licenses, else
   * enough for the people the app knows of); the network is never chosen for them.
   */
  const [months, setMonths] = useState<number | null>(open.what.plan === 'pro' ? open.what.months ?? null : null);
  const [packs, setPacks] = useState<number>(open.what.plan === 'hours' ? open.what.packs ?? 1 : 1);
  const [licenses, setLicenses] = useState<number | null>(open.what.plan === 'team' ? open.what.licenses ?? null : null);
  const [other, setOther] = useState(false);
  const [routeId, setRouteId] = useState<string | null>(null);
  /**
   * What to say about the last try: a refusal, a price that changed, a payment that bought nothing (`paid`: its money is in the
   * balance).
   */
  const [said, setSaid] = useState<{ text: string; ref: string | null; paid: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const [receipt, setReceipt] = useState(false);

  /** Back to choosing what a payment was for, as it was: the same length, hours or licenses, on the same network. */
  const chooseAgain = (old: TopUp) => {
    const b = old.purchase?.buys;
    if (b?.kind === 'pro') { setMonths(b.months); setOther(!LENGTHS.some((m) => m === b.months)); }
    else if (b?.kind === 'hours') setPacks(b.packs);
    else if (b?.kind === 'licenses') { setLicenses(b.count); setOther(!LICENSES.some((n) => n === b.count)); }
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
    setSaid({ text: t.purchase.why ?? `It wasn’t bought. The ${roundTokens(t.received?.microUsd ?? 0)} USDC that arrived is in your balance.`, ref: null, paid: true });
  }

  /* The amount that arrived counts up only when it's seen while the window is open. */
  const counting = useSeenWhileOpen(paying);

  /* ---------- what it costs ---------- */
  const kind: Purchase['kind'] = t?.purchase?.buys.kind ?? (view?.step === 'bought' ? view.buys.kind : kindOf(open.what.plan));
  const extend = kind === 'pro' && opened?.extend === true;
  const balance = p?.balance.microUsd ?? 0;
  const maxMonths = o?.pro.maxMonths ?? 12;
  const yearly = o?.pro.yearly ?? null;
  const pct = o ? yearlyOff(o) : null;
  const chosenMonths = Math.min(maxMonths, Math.max(1, months ?? (yearly ? yearly.fromMonths : 1)));
  const lengths = LENGTHS.filter((m) => m <= maxMonths);
  const otherOpen = other || !lengths.some((m) => m === chosenMonths);
  const hoursOffer = o?.hours ?? null;
  const chosenPacks = Math.min(hoursOffer?.maxPacks ?? 1, Math.max(1, packs));

  /*
   * Team: the team you're on now, who's waiting for a license on it, and how many it has left. Starting one, the cards say
   * what each number is for beside the people the app knows of (you, and those at your company on Alcove); buying more,
   * beside who's waiting. Either starts on enough for them.
   */
  const teamNow = team.data ?? null;
  /* How many are left of how many, and who's waiting: the same count Settings › Plan and the Team page say (plan-state). */
  const counts = teamLicenses(teamNow);
  const wanting = counts?.waiting ?? [];
  const left = counts?.left ?? 0;
  const known = 1 + (directory.data?.members.filter((m) => m.onAlcove).length ?? 0);
  const maxLicenses = o?.team.maxLicenses ?? 1;
  const licenseCards = LICENSES.filter((n) => n <= maxLicenses);
  const enough = starting === false ? wanting.length - left : known;
  const firstCount = enough <= (licenseCards[0] ?? 1) ? licenseCards[0] ?? 1 : licenseCards.find((n) => n >= enough) ?? Math.min(enough, maxLicenses);
  if (forTeam && licenses === null && teamReady && o) setLicenses(firstCount);
  const chosenLicenses = Math.min(maxLicenses, Math.max(1, licenses ?? firstCount));
  const licensesOther = other || !licenseCards.some((n) => n === chosenLicenses);
  /** The name the team has, or is to have: what's typed until it's made. */
  const named = (teamNow?.name ?? teamName ?? '').trim();
  /** On someone else's team: only its admin buys its licenses (and you can't start another while you're on it). */
  const notAdmin = kind === 'licenses' && teamNow !== null && teamNow.role !== 'admin';
  /** Starting a team needs its name before anything is paid. */
  const unnamed = kind === 'licenses' && teamNow === null && named === '';

  const buys: Purchase | null = !o ? null
    : kind === 'pro' ? { kind: 'pro', months: chosenMonths, microUsdPerMonth: proPrice(o, chosenMonths) }
    : kind === 'licenses' ? { kind: 'licenses', count: chosenLicenses, microUsdPerLicense: o.team.microUsdPerLicense }
    : hoursOffer ? { kind: 'hours', packs: chosenPacks, microUsdPerPack: hoursOffer.microUsd, minutesPerPack: hoursOffer.minutes } : null;
  const cost = buys ? costOf(buys) : 0;
  const fromBalance = Math.min(balance, cost);
  const need = cost - fromBalance;
  const usdc = (routes.data?.routes ?? []).filter((r) => r.token === 'USDC').sort((a, b) => rank(a) - rank(b));
  const paymentsOff = routes.isError || (routes.isSuccess && usdc.length === 0);
  const route = usdc.find((r) => r.id === routeId) ?? null;
  const send = need > 0 ? Math.max(need, route ? microOf(route.minimum) ?? 0 : 0) : 0;
  const busy = buying.isPending || start.isPending || createTeam.isPending;

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
  const teamFor = starting !== false ? `For ${named || 'your team'}, with you its admin` : `For ${named || 'your team'}, ${left ? left : 'none'} left now`;
  const forWhom = kind === 'hours' ? 'For this period' : kind === 'licenses' ? teamFor
    : extend ? `Added to the ${plural(daysLeft, 'day')} you have left` : name ? `For ${name}` : 'For you';
  const periodEnd = p ? new Date(p.period.to) : null;

  /* ---------- doing it ---------- */
  const title = kind === 'hours' ? 'More notes' : kind === 'licenses' ? (starting !== false ? 'Start a team' : 'Buy licenses') : extend ? 'Extend Pro' : 'Get Pro';
  /** What paying for it says while the payment is awaited, as it's seen, and once it's done. */
  const wording = kind === 'hours'
    ? { close: 'You can close this. The hours are added as soon as your payment arrives.', seen: 'Adding your hours. This takes a minute or two.', last: 'Hours added', what: 'more notes' }
    : kind === 'licenses'
      ? { close: 'You can close this. The licenses are added as soon as your payment arrives.', seen: 'Adding the licenses. This takes a minute or two.', last: 'Licenses added', what: 'the licenses' }
      : extend
        ? { close: 'You can close this. Pro is extended as soon as your payment arrives.', seen: 'Extending Pro. This takes a minute or two.', last: 'Pro extended', what: 'Pro' }
        : { close: 'You can close this. Pro starts as soon as your payment arrives.', seen: 'Starting Pro. This takes a minute or two.', last: 'Pro starts', what: 'Pro' };
  /**
   * Says why a purchase or a payment was refused, in the server's words ("The price of Pro has changed. Look at it again
   * before buying.", "Your balance is short of what …"); the mutation reads the plan and the offers again, so what's shown next is
   * today's. A failure that isn't a refusal carries its reference for support.
   */
  const refused = (e: unknown) => {
    const code = errorCode(e);
    setSaid({ text: errorMessage(e), ref: code === 'conflict' || code === 'invalid' || code === 'forbidden' ? null : errorRequestId(e) ?? null, paid: false });
  };
  /**
   * The team licenses are for, made as you pay when you're starting one, with you its admin. False when it couldn't be
   * made, and why is said ("You’re on a team already…"). Made once: pressing again after a refused payment buys for it.
   */
  const teamMade = async (b: Purchase): Promise<boolean> => {
    if (b.kind !== 'licenses' || teamNow) return true;
    try {
      await createTeam.mutateAsync(named);
      return true;
    } catch (e) {
      refused(e);
      return false;
    }
  };
  const buy = (b: Purchase) => {
    setSaid(null);
    // Bought, but the plan couldn't be read again: what's here says it until it's read.
    const done = (fresh: Plan | null) => { const after = fresh ?? p; if (after) setView({ step: 'bought', plan: after, buys: b, at: Date.now() }); };
    void teamMade(b).then((made) => { if (made) buying.mutate(b, { onSuccess: done, onError: refused }); });
  };
  const getAddress = (r: TopUpRoute, microUsd: number, b: Purchase) => {
    setSaid(null);
    void teamMade(b).then((made) => {
      if (made) start.mutate({ routeId: r.id, microUsd, buys: b }, { onSuccess: (fresh) => setView({ step: 'pay', id: fresh.id }), onError: refused });
    });
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
  const doneOf = (b: Purchase, paid: TopUp | null, fresh: Plan | undefined): Done => {
    const bought = purchaseName(b);
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
    let told: string;
    if (b.kind === 'pro') {
      until = boughtUntil(b.months, fresh);
      heading = extend ? `Pro runs to ${shortDate(until)}` : 'You’re on Pro';
      told = extend ? `${heading}.` : `You’re on Pro until ${shortDate(until)}.`;
      lines.push(`Until ${fullDate(until)}.`);
    } else if (b.kind === 'licenses') {
      // Said from the team and the plan as they are after the visit buying them made: whether yours was taken, what's left.
      until = null;
      heading = starting !== false ? `${named || 'Your team'} is on Team` : `${b.count} more ${b.count === 1 ? 'license' : 'licenses'}`;
      told = starting !== false ? `${heading}.` : `${plural(b.count, 'license')} added to ${named || 'your team'}.`;
      const line = starting !== false ? startedWith(b.count, fresh?.team?.licensed === true || teamNow?.licensed === true) : leftNow(teamNow);
      if (line) lines.push(line);
    } else {
      until = periodEnd;
      heading = moreHoursOfNotes(b.packs * b.minutesPerPack);
      told = `${hoursOfNotes(b.packs * b.minutesPerPack)} of notes added.`;
      lines.push(`They’re yours until this period ends${until ? ` on ${longDay(until)}` : ''}${opened?.stopped ? ', and notes start again now' : ''}.`);
    }
    if (paid && sent > asked) lines.push(`You sent ${tokens(sent)} USDC, ${tokens(sent - asked)} more than asked: it’s in your balance.`);
    if (open.from === 'call' && b.kind === 'pro' && opened?.stopped) lines.push('Notes are on again in the call.');
    const reference = entry?.id ?? paid?.id ?? null;
    // Licenses are for a team, whose name the receipt says; anything else is for whoever bought it.
    const forOn = b.kind === 'licenses' ? named || null : name;
    return {
      title: heading, lines, toast: told,
      invite: b.kind === 'licenses' && starting !== false,
      // Licenses run a period from when each is taken, and aren't renewed: there's nothing to remind. Pro renews only when
      // renewing will buy the next month (on, a month's price in the balance, no rise in price), as the server says.
      reminder: b.kind !== 'pro' ? null : fresh && renews(fresh) ? 'Renews from your balance.' : 'Nothing renews by itself. Alcove reminds you before it ends.',
      row: {
        title: paid ? `${tokens(added)} USDC on ${paid.route.chainName}` : `${usd(c)} from your balance`,
        sub: `${shortDate(at)} · ${bought}`, reference: reference ? shortRef(reference) : null
      },
      receipt: {
        title: bought, total: usdCents(c),
        lines: [
          { label: 'Date', value: `${fullDate(at)}, ${hm(at)}` },
          ...(forOn ? [{ label: 'For', value: forOn }] : []),
          { label: 'Bought', value: bought },
          ...(until ? [{ label: b.kind === 'pro' ? 'Pro until' : 'For this period, to', value: fullDate(until) }] : []),
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
  const art = kind === 'pro' ? 'pro' : kind === 'licenses' ? 'team' : 'hours';
  /* Who stands on Team's horizon: the team's people, else (a team just started) your company's on Alcove, else you. */
  const onIt: AvatarPerson[] = teamNow?.members.filter((m) => !m.you).map((m) => m.person) ?? [];
  const atWork: AvatarPerson[] = directory.data?.members.filter((m) => m.onAlcove).map((m) => m.person) ?? [];
  const folk = onIt.length ? onIt : atWork.length ? atWork : me ? [me] : [];
  const people = kind === 'licenses' ? <>{folk.slice(0, 3).map((x, i) => <Avatar key={x.email ?? x.name} person={x} size={FOLK[i] ?? 18} />)}</> : undefined;
  let summary: CheckoutSummaryData = { art, people, name: kind === 'pro' ? 'Pro' : kind === 'licenses' ? 'Team' : 'More notes', sub: forWhom, brief: '', lines: [], total: null, foot: PRICED };
  if (notAdmin && teamNow && view?.step === 'choose') {
    // Someone else buys this team's licenses: nothing is priced here.
    summary = { ...summary, sub: `For ${teamNow.name}`, foot: o ? `Each license is one person for ${plural(o.periodDays, 'day')}.` : PRICED };
  } else if (o && shown) {
    const d = described(shown, o);
    const c = costOf(shown);
    const isDone = view?.step === 'bought' || paying === 'bought';
    const until = shown.kind === 'pro'
      ? { lead: 'Pro until', day: fullDate(isDone ? boughtUntil(shown.months, view?.step === 'bought' ? view.plan : p) : proUntil(shown.months)) }
      : shown.kind === 'licenses' ? { lead: shown.count === 1 ? 'It runs' : 'Each runs', day: `${plural(o.periodDays, 'day')} from when it’s taken` }
      : periodEnd ? { lead: 'Until', day: fullDate(periodEnd) } : null;
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
  const finish = <Button variant="primary" onClick={() => closeFromDone()}>{open.from === 'call' ? 'Back to the call' : 'Done'}</Button>;
  // Why the button waits, said on a phone too (its own class, which the phone's foot doesn't hide as it does a hint).
  const offline = !online && <p className="ck-offline" role="status">You’re offline. Everything catches up when you’re back.</p>;
  const note = said && <CheckoutNote>{said.text}{said.ref && <><br /><RequestRef id={said.ref} /></>}</CheckoutNote>;
  const waiting = (words: string) => <p className="ck-wait" role="status"><Dots />{words}</p>;
  let step: 1 | 2 | 3 | null = 1;
  let stage: CheckoutStage = 'choose';
  let body: ReactNode;
  let foot: ReactNode = close;
  let footKey = '';
  let done: Done | null = null;

  if (view === null || (!o && !offers.isError) || (!p && !plan.isError) || (!teamReady && !team.isError)) {
    body = waiting(view?.step === 'pay' ? 'Opening your payment' : 'Looking up the price');
    // Its own foot, so what replaces it once it's read is new, and focus goes where the step puts it.
    footKey = 'wait';
  } else if (!o || !p || !teamReady) {
    body = <CheckoutNote>{errorMessage(offers.error ?? plan.error ?? team.error)}</CheckoutNote>;
    foot = (
      <>
        <Button variant="quiet" className="ck-push" onClick={onClose}>Close</Button>
        <Button variant="secondary" onClick={() => { void offers.refetch(); void plan.refetch(); if (forTeam) void team.refetch(); }}>Try again</Button>
      </>
    );
  } else if (view.step === 'bought') {
    step = 3;
    stage = 'done';
    done = doneOf(view.buys, null, view.plan);
    foot = finish;
  } else if (view.step === 'pay') {
    step = 2;
    if (!t || !paying) {
      body = topUp.isError ? <CheckoutNote>{errorMessage(topUp.error)}</CheckoutNote> : waiting('Opening your payment');
    } else {
      // Licenses a payment bought say so once the visit after them is made: until then, they're still being added.
      stage = settling ? 'seen' : STAGE[paying];
      if (paying === 'send' || paying === 'short') {
        body = (
          <>
            <PayNow t={t} now={now} quiet={asking} />
            {cancel.isError && <CheckoutNote>{errorMessage(cancel.error)}</CheckoutNote>}
          </>
        );
        footKey = asking ? 'ask' : '';
        foot = asking ? (
          <CheckoutAsk title="Cancel this payment?" text="Its address stops showing here. A payment already sent to it still counts when it arrives."
            confirm="Cancel payment" keep="Keep waiting" busy={cancel.isPending} onConfirm={() => cancelPayment(t.id)} onKeep={() => setAsking(false)} />
        ) : (
          <>
            <p className="hint">{wording.close}</p>
            {paying === 'send' && <Button variant="quiet" disabled={!online} onClick={() => setAsking(true)}>Cancel payment</Button>}
            {close}
          </>
        );
      } else if (paying === 'seen' || settling) {
        body = <PaySeen t={t} count={counting} doing={wording.seen} last={wording.last} />;
        foot = <><p className="hint">You can close this. It finishes by itself.</p>{close}</>;
      } else if (paying === 'bought' && t.purchase) {
        step = 3;
        done = doneOf(t.purchase.buys, t, p);
        foot = finish;
      } else if (paying === 'added' || paying === 'bought') {
        step = 3;
        body = <PayAdded t={t} />;
        foot = finish;
      } else if (isOver(paying)) {
        // What it was for is had another way, as fits: a new address, or choosing again. One a person has to look at has none.
        const looked = paying === 'failed' || paying === 'held';
        const next = looked ? null : wayOn(t);
        const fresh = next?.label === 'Get a new address';
        const what = wording.what;
        const then = !next ? null
          : paying === 'closed-short'
            ? fresh ? `To get ${what} now, get a new address. What arrived here isn’t in your balance until it settles, so it doesn’t count toward it.` : `To get ${what} now, choose again.`
            : fresh ? `If you still want ${what}, get a new address${paying === 'expired' ? ': it’s made for the next 24 hours' : ''}.` : `If you still want ${what}, choose again.`;
        body = <><PayOver t={t} over={paying} then={then} />{!looked && note}</>;
        if (next) {
          foot = (
            <>
              <Button variant="quiet" className="ck-push" onClick={onClose}>Close</Button>
              {offline}
              <Button variant="primary" loading={start.isPending} disabled={!online || busy} onClick={next.go}>{next.label}</Button>
            </>
          );
        }
      }
    }
  } else if (notAdmin && teamNow) {
    // On someone else's team: its admin buys its licenses, and you can't start another while you're on it. Nothing can be
    // bought here, so there are no steps, and it's said once, in one note: who buys them. A payment that couldn't buy them
    // says first that its money is in the balance; a refused Buy says no more than who buys them, so it isn't said too.
    step = null;
    const admin = teamNow.members.find((m) => m.role === 'admin');
    const who = admin ? `${callName(admin.person)}, its admin, buys the licenses for ${teamNow.name}.` : `Only the admin of ${teamNow.name} buys its licenses.`;
    body = said?.paid ? <CheckoutNote>{said.text} {who}</CheckoutNote> : <CheckoutNote tone="info">{who}</CheckoutNote>;
  } else {
    // Choosing.
    const offLabel = pct !== null ? `${pct}% off` : null;
    const each = o.team.microUsdPerLicense;
    /** What a number of licenses is for, as its card says: beside the people the app knows of, or beside who's waiting. */
    const licensesFor = (n: number): string => {
      if (starting !== false) return n === known ? `For the ${known} of you` : n > known ? `Room for ${n - known} more` : 'To start with';
      const spare = left + n - wanting.length;
      // Someone waiting is named on a card when their name fits on it beside the number.
      const one = wanting.length === 1 ? wanting[0] : undefined;
      const named1 = one && callName(one.person).length <= 5 ? callName(one.person) : null;
      if (!wanting.length) return `Room for ${spare} more`;
      if (spare < 0) return `${-spare} still waiting`;
      if (named1) return spare ? `${spare} spare after ${named1}’s` : `For ${named1}`;
      return spare ? `${wanting.length} waiting, ${spare} spare` : `For the ${wanting.length} waiting`;
    };
    const runs = `Each runs ${plural(o.periodDays, 'day')} from when it’s taken.`;
    const yours = starting !== false ? (
      <TeamName value={teamNow?.name ?? teamName ?? ''} onChange={setTeamName} disabled={teamNow !== null} placeholder="Your company or team"
        autoFocus={teamNow === null && !teamName} />
    ) : teamNow && (
      <LicensesLeft people={teamNow.members.map((m) => m.person)}
        title={!counts || counts.of === 0 ? 'No licenses yet' : counts.left > 0 ? `${counts.left} of ${plural(counts.of, 'license')} left` : counts.live === 1 ? 'Its one license is taken' : `All ${counts.live} licenses taken`}
        sub={wanting.length ? `${someNames(wanting.map((m) => m.person))} ${isAre(wanting.length)} waiting for one. ${runs}` : runs} />
    );
    body = (
      <>
        {note}
        {kind === 'licenses' ? (
          <>
            {yours}
            <LicensesPicker autoFocus={teamNow !== null || !!teamName} hint={`${usd(each)} each, one person for ${plural(o.periodDays, 'day')}`} value={chosenLicenses}
              options={licenseCards.map((n): LicensesOption => ({ count: n, total: usd(n * each), sub: licensesFor(n) }))}
              onChange={(n) => { setLicenses(n); setOther(false); }}
              other={{
                open: licensesOther, max: maxLicenses, price: usd(chosenLicenses * each),
                onOpen: () => { setOther(true); setLicenses(Math.min(maxLicenses, chosenLicenses + 1)); },
                onStep: (n) => { setOther(true); setLicenses(n); }
              }} />
          </>
        ) : kind === 'pro' ? (
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
              const minutes = n * hoursOffer.minutes;
              return { packs: n, hours: hoursOfNotes(minutes), price: usd(n * hoursOffer.microUsd), sub: plural(Math.max(1, Math.round(minutes / 60)), 'hour-long call') };
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
    const compare = (kind === 'pro' || kind === 'licenses') && onCompare && open.from !== 'plans' && open.from !== 'welcome' && open.from !== 'call'
      && <Button variant="quiet" className="ck-push" onClick={onCompare}>Compare plans</Button>;
    // A team being started is made as you pay: the button waits for that too.
    const getting = start.isPending || (need > 0 && createTeam.isPending);
    const takingIt = buying.isPending || (need <= 0 && createTeam.isPending);
    foot = (
      <>
        {compare}
        {offline}
        {!buys ? close : need > 0 ? (
          <Button variant="primary" loading={getting} disabled={!route || paymentsOff || !online || busy || unnamed}
            onClick={() => { if (route) getAddress(route, send, buys); }}>{getting ? 'Getting the address' : 'Get the address'}</Button>
        ) : (
          <Button variant="primary" loading={takingIt} disabled={!online || busy || unnamed} onClick={() => buy(buys)}>
            {takingIt ? 'Buying' : 'Buy with your balance'}
          </Button>
        )}
      </>
    );
  }
  if (done) {
    const d = done;
    body = <CheckoutDone title={d.title} lines={d.lines} reminder={d.reminder} receipt={{ ...d.row, onOpen: () => setReceipt(true) }}
      invite={d.invite ? <TeamInvite {...invite} bare /> : undefined} />;
  }
  /**
   * Closing the window from Done, however it's closed, says once on the page under it what was bought, in the server's dates
   * (the canvas's toast: "You’re on Pro until 4 Nov 2027."). Not over a call, where notes coming on again say it.
   */
  const toastDone = done && open.from !== 'call' ? done.toast : null;
  function closeFromDone() {
    if (toastDone) toast(toastDone);
    onClose();
  }

  return (
    <CheckoutWindow title={title} step={step} stage={stage} summary={summary} foot={foot} footKey={footKey} onClose={closeFromDone}
      theme={open.from === 'call' ? theme : null}
      receipt={receipt && done ? <PaymentReceipt {...done.receipt} onPrint={() => window.print()} onBack={() => setReceipt(false)} /> : undefined}>
      {body}
    </CheckoutWindow>
  );
}
