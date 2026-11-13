/*
 * Settings › Plan (docs/design/pages.md › Settings; docs/product/user-flows.md 16.7, 16.8 and 16.14). The first panel is
 * what you have: the plan and what it brings, about how much of the period's notes is left (with the sun on the row's own
 * hairline), storage against its limit, and on Free more notes for this period. Get Pro, Extend and Add 10 hours open
 * checkout (features/plans/checkout.tsx); See plans opens Plans. Pro about to end is said by the plan itself, with Extend
 * the page's one filled button, as Get Pro is once notes have run out; Pro renewed or ended is said at the top until it's
 * dismissed. The second panel is what you pay with: the balance with Add money (topup.tsx), renewing from it and refunding
 * the months that haven't started (on Pro), then the payments: what's on its way, each opening where it's being paid, and
 * what the balance took in and paid for, each with its receipt. Team's parts (its plan row, waiting for a license, its
 * notices, and for its admin the licenses, buying one when it's needed and refunding them) are PlanTeam.tsx's.
 */
import { errorMessage, type BalanceEntry, type MyTeam, type Plan, type PlanNotice, type PlanOffers, type TopUp } from '@alcove/api';
import {
  Button, CryptoMark, Icon, IconButton, PaymentReceipt, PaymentRow, SettingFact, SettingFoot, SettingNote, SettingPayments, SettingRow,
  ReceiptWindow, SettingStep, SettingsGroup, SettingsPanel, ShowMore, SunLine, Switch, buttonClass, cn, useToast, type ReceiptLine
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useCheckout } from '~/features/plans/checkout';
import { PLAN_NAMES, endsIn, nextPeriodMinutes, noticesLike, noticesNow, notesLeft, notesLow, notesOut, notesShare, proEnding, renews, teamLicenses } from '~/features/plans/plan-state';
import { checkoutFor, purchaseName, restToSend, tokensExact } from '~/features/plans/purchase';
import { hoursOfNotes } from '~/features/plans/words';
import { useNow } from '~/lib/live';
import { q, topUpOpen, useCancelTopUp, useDismissPlanNotice, useRefundPro, useSetRenew } from '~/lib/queries';
import { byDay, byWhen, dayFullMonth, fullDate, hm, longDay, shortDate, shortDay } from '~/lib/time';
import { plural, roomLabel, usd, usdCents } from '~/lib/words';
import { AutoBuy, Licenses, RefundLicenses, TeamPlanRow, TeamStorageNote, WaitingNote, balanceBuys, teamNoticeSays, teamNotesHelp, teamStorageHelp } from './PlanTeam';
import { useSaveState, useSaving } from './save';
import { AddMoneySheet } from './topup';

export function PlanGroup({ plan }: { plan: Plan }) {
  const offers = useQuery(q.offers()).data;
  // Whether this server takes payments: one that doesn't answers unavailable, and there's no way to add money.
  const canAdd = useQuery(q.topUpRoutes()).data !== undefined;
  // The team you're on, as you see it: its admin, and for the admin its licenses. Someone waiting for one makes Buy
  // licenses the one thing to do here.
  const team = useQuery({ ...q.myTeam(), enabled: plan.team !== null }).data;
  const licenses = team ? teamLicenses(team) : null;
  const [sheet, setSheet] = useState<{ open: boolean; topUpId: string | null }>({ open: false, topUpId: null });
  return (
    <SettingsGroup id="plan" title="Plan">
      <SettingsPanel>
        <Notices plan={plan} team={team} />
        <WaitingNote plan={plan} team={team} />
        {plan.kind === 'team' ? <TeamPlanRow plan={plan} team={team} /> : <PlanRow plan={plan} offers={offers} quiet={Boolean(licenses?.waiting.length)} />}
        <NotesRow plan={plan} offers={offers} />
        <SettingRow label="Storage" help={plan.kind === 'team' ? teamStorageHelp(plan, offers) : `Uploads and call recordings. Files up to ${roomLabel(plan.storage.fileBytes)}.`}
          control={<SettingFact icon="hardDrive" tone={plan.grace?.storage || plan.over.storage ? 'no' : undefined}>{roomLabel(plan.storage.usedBytes)} of {roomLabel(plan.storage.limitBytes)}</SettingFact>} />
        {plan.kind === 'team' ? <TeamStorageNote plan={plan} team={team} /> : <Limits plan={plan} />}
        <MoreNotes plan={plan} offers={offers} />
        {licenses && <Licenses licenses={licenses} offers={offers} />}
      </SettingsPanel>
      <Paying plan={plan} offers={offers} canAdd={canAdd} team={team} onAddMoney={(topUpId) => setSheet({ open: true, topUpId })} />
      <AddMoneySheet open={sheet.open} topUpId={sheet.topUpId} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} />
    </SettingsGroup>
  );
}

/* ------------------------------------------------------------------ what you have */

/**
 * What the plan's owner was told, at the top until dismissed (plan-state's noticesNow): Pro renewed or ended, and a team's
 * (PlanTeam.tsx). Dismissing one dismisses those of its kind it stood for too, and leaves focus on the next, or on the plan.
 */
function Notices({ plan, team }: { plan: Plan; team: MyTeam | null | undefined }) {
  const dismiss = useDismissPlanNotice();
  const toast = useToast();
  const shown = noticesNow(plan, team);
  const close = (n: PlanNotice) => {
    const all = async () => { for (const id of noticesLike(plan, n)) await dismiss.mutateAsync(id); };
    void all().then(() => requestAnimationFrame(() => {
      const next = document.querySelector<HTMLButtonElement>('#plan .set-note-x');
      if (next) next.focus();
      else document.getElementById('plan')?.focus({ preventScroll: true });
    }), (e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  return shown.map((n) => {
    const teams = teamNoticeSays(n, plan, team);
    return (
      <SettingNote key={n.id} icon={teams?.icon ?? (n.kind === 'pro-renewed' ? 'repeat' : 'info')} onDismiss={() => close(n)} dismissLabel="Dismiss this notice">
        {teams ? teams.text : n.kind === 'pro-renewed'
          ? 'Pro renewed from your balance, for another month.'
          : n.until === null ? 'Pro ended. Nothing was deleted: you’re back on Free.' : `Pro ended on ${longDay(new Date(n.until))}. Nothing was deleted: you’re back on Free.`}
      </SettingNote>
    );
  });
}

/**
 * The plan, what it brings or until when, and its two ways on: See plans, and Get Pro or Extend (on Team, PlanTeam.tsx's).
 * `quiet` keeps its button unfilled while something else needs doing more: someone waiting for a team license.
 */
function PlanRow({ plan, offers, quiet }: { plan: Plan; offers: PlanOffers | undefined; quiet: boolean }) {
  const checkout = useCheckout();
  const now = useNow();
  const ending = proEnding(plan, now);
  const until = plan.pro.until;
  let help: string | undefined;
  if (plan.kind === 'free') {
    help = `Every feature, with about ${hoursOfNotes(offers?.free.notesMinutes ?? plan.notes.minutesPerPeriod)} of notes and ${roomLabel(offers?.free.storageBytes ?? plan.storage.limitBytes)} of storage.`;
  } else if (ending) {
    help = `${endsIn(ending.days)}, on ${longDay(new Date(ending.until))}. Then you’re back on Free, and nothing is deleted.`;
  } else if (until !== null) {
    help = `Until ${fullDate(new Date(until))}. ${renews(plan) ? 'It renews from your balance before it ends.' : 'Nothing renews by itself: Alcove reminds you before it ends.'}`;
  }
  // Pressing is filled only when something needs doing: notes have run out, or Pro is about to end.
  const again = noticesNow(plan).some((n) => n.kind === 'pro-ended');
  const buy = plan.kind === 'free'
    ? <Button variant={notesOut(plan) && !quiet ? 'primary' : 'secondary'} size="sm" onClick={() => checkout.open({ plan: 'pro' }, 'settings')}>{again ? 'Get Pro again' : 'Get Pro'}</Button>
    : plan.kind === 'pro' ? <Button variant={ending && !quiet ? 'primary' : 'secondary'} size="sm" onClick={() => checkout.open({ plan: 'pro' }, 'settings')}>Extend</Button>
    : null;
  return (
    <SettingRow label={PLAN_NAMES[plan.kind]} help={help} warm={ending !== null} under
      control={<><Link to="/plans" className={buttonClass({ variant: 'quiet', size: 'sm' })}>See plans</Link>{buy}</>} />
  );
}

/**
 * About how much of the period's notes is left, the sun on the row's hairline: warm under an hour, set once they've stopped.
 * On Team they're your own, back when your license is next taken.
 */
function NotesRow({ plan, offers }: { plan: Plan; offers: PlanOffers | undefined }) {
  const out = notesOut(plan);
  const low = notesLow(plan);
  const on = dayFullMonth(new Date(plan.period.to));
  const next = hoursOfNotes(nextPeriodMinutes(plan, offers));
  const help = plan.kind === 'team' ? teamNotesHelp({ out, low, next })
    : out ? `Calls go on without notes until ${on}.`
    : low ? `Under an hour left. Back to ${next} on ${on}.`
    : `Back to ${next} on ${on}. Calls without notes are free.`;
  return (
    <SettingRow className="is-left" label="Notes left this period" help={help} problem={out} warm={low}
      control={<span className={cn('set-left', out ? 'is-out' : low && 'is-warm')}>{out ? 'None' : <><small>About</small>{notesLeft(plan)}</>}</span>}>
      <SunLine share={out ? 0 : notesShare(plan)} />
    </SettingRow>
  );
}

/** Being over the plan's storage, said once: until when everything works as before, or what has stopped since. */
function Limits({ plan }: { plan: Plan }) {
  const { grace, over } = plan;
  const name = PLAN_NAMES[plan.kind];
  const free = plan.kind === 'free';
  if (grace?.storage) {
    return (
      <SettingNote tone="caution">
        You’re over {name}’s {roomLabel(plan.storage.limitBytes)} of storage. Everything works as before until {longDay(new Date(grace.until))}; then
        uploads and notes stop until you {free ? 'get Pro or make room' : 'make room'}.
      </SettingNote>
    );
  }
  if (over.storage) {
    return <SettingNote tone="caution">Uploads and notes have stopped: you’re over {name}’s {roomLabel(plan.storage.limitBytes)} of storage. {free ? 'Get Pro, or make room.' : 'Make room to start them again.'}</SettingNote>;
  }
  return null;
}

/** More notes for this period, on Free, and on any plan once notes are low or out: they open checkout. */
function MoreNotes({ plan, offers }: { plan: Plan; offers: PlanOffers | undefined }) {
  const checkout = useCheckout();
  const pack = offers?.hours;
  if (!pack || !(plan.kind === 'free' || notesLow(plan) || notesOut(plan))) return null;
  const hours = hoursOfNotes(pack.minutes);
  return (
    <SettingRow label="More notes" help={`${hours} for ${usd(pack.microUsd)}, for this period.`}
      control={<Button size="sm" onClick={() => checkout.open({ plan: 'hours' }, 'settings')}>Add {hours}</Button>} />
  );
}

/* ------------------------------------------------------------------ what you pay with */

/**
 * A payment Settings lists: still on its way; one that needs a person (failed, held); or one added without buying what it
 * was for, while that money is still in the balance to buy it with.
 */
const listed = (plan: Plan) => (t: TopUp): boolean =>
  topUpOpen(t) || t.state === 'failed' || t.state === 'held'
  || (t.state === 'credited' && t.purchase !== null
    && (t.purchase.outcome === 'waiting' || (t.purchase.outcome === 'refused' && plan.balance.microUsd >= (t.received?.microUsd ?? 0))));

/**
 * The balance, renewing from it and refunding to it on Pro, buying a team's licenses from it and refunding them for its
 * admin (PlanTeam.tsx), then the payments. Nothing to show, and it isn't there.
 */
function Paying({ plan, offers, canAdd, team, onAddMoney }: {
  plan: Plan; offers: PlanOffers | undefined; canAdd: boolean; team: MyTeam | null | undefined; onAddMoney: (topUpId: string | null) => void;
}) {
  // Payments on their way show whether or not 1Click answers right now; a server without payments has none to show.
  const topUps = (useQuery(q.topUps()).data ?? []).filter(listed(plan));
  const add = useRef<HTMLButtonElement>(null);
  const onPro = plan.kind === 'pro';
  const licenses = team?.licenses ?? null;
  const history = plan.balance.history;
  if (!onPro && !licenses && !canAdd && plan.balance.microUsd === 0 && !topUps.length && !history.length) return null;
  return (
    <SettingsPanel>
      <SettingRow label="Balance" help={`What ${balanceBuys(plan, team)} bought with.${canAdd ? ' Add money from any wallet or exchange.' : ''}`} under={canAdd}
        control={<><SettingFact>{usd(plan.balance.microUsd)}</SettingFact>{canAdd && <Button ref={add} size="sm" icon="plus" onClick={() => onAddMoney(null)}>Add money</Button>}</>} />
      {onPro && <Renew plan={plan} offers={offers} canAdd={canAdd} />}
      {onPro && <Refund plan={plan} />}
      {licenses && <AutoBuy plan={plan} offers={offers} canAdd={canAdd} on={licenses.autoPurchase} />}
      {licenses && <RefundLicenses left={licenses.unconsumed} back={licenses.refundableMicroUsd} auto={licenses.autoPurchase} />}
      {(topUps.length > 0 || history.length > 0) && <Payments topUps={topUps} history={history} add={add} onAddMoney={onAddMoney} />}
    </SettingsPanel>
  );
}

const RENEW = 'Renew from balance';

/** Buying a month from the balance as Pro is about to end: off by default, kept as it's switched. */
function Renew({ plan, offers, canAdd }: { plan: Plan; offers: PlanOffers | undefined; canAdd: boolean }) {
  const renew = useSetRenew();
  const saving = useSaving();
  const state = useSaveState();
  const toast = useToast();
  const set = (on: boolean) => {
    void saving(RENEW, () => renew.mutateAsync(on)).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const price = offers?.pro.microUsdPerMonth;
  // Why it won't renew, as the server says (`pro.renewal`): the balance is short, or a month costs more than the last did.
  const why = plan.pro.renewal === 'short' ? `Your balance is short of a month${price === undefined ? '' : ` (${usdCents(price)})`}, so Pro won’t renew.${canAdd ? ' Add money to keep it.' : ''}`
    : plan.pro.renewal === 'price' ? `A month of Pro costs ${price === undefined ? 'more now' : `${usdCents(price)} now, more`} than your last did, so it won’t renew by itself. Extend to keep it at that price.`
    : null;
  return (
    <SettingRow label={RENEW} saveState={state(RENEW)} problem={why !== null} onLabel={() => set(!plan.pro.renew)}
      help={why ?? 'Buys a month from your balance 3 days before Pro ends.'}
      control={<Switch label={RENEW} checked={plan.pro.renew} onChange={set} />} />
  );
}


/** Refunding the months that haven't started, asked in place: what goes back to the balance, and when Pro ends then. */
function Refund({ plan }: { plan: Plan }) {
  const refund = useRefundPro();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const ask = useRef<HTMLButtonElement>(null);
  const back = plan.pro.refundableMicroUsd;
  if (back <= 0) return null;
  const now = Date.now();
  const later = plan.pro.months.filter((m) => Date.parse(m.from) > now);
  const running = plan.pro.months.find((m) => Date.parse(m.from) <= now && Date.parse(m.to) > now);
  const go = () => {
    setRefused(null);
    refund.mutate(undefined, {
      onSuccess: () => { setAsking(false); toast(`Refunded ${usdCents(back)} to your balance.`, { icon: 'check' }); },
      onError: (e) => setRefused(errorMessage(e))
    });
  };
  if (!asking) {
    return (
      <SettingRow label={`Refund ${plural(later.length, 'month')} that ${later.length === 1 ? 'hasn’t' : 'haven’t'} started`}
        help={`${usdCents(back)} goes back to your balance. A month that has started isn’t refunded.`}
        control={<Button ref={ask} variant="quiet" size="sm" onClick={() => { setRefused(null); setAsking(true); }}>Refund ({usdCents(back)})</Button>} />
    );
  }
  return (
    <>
      <SettingStep title={`Refund ${plural(later.length, 'month')} of Pro?`}
        help={`${usdCents(back)} goes back to your balance.${running ? ` Pro ends on ${shortDay(new Date(running.to))}, when the month running now does.` : ''}`}>
        {refused !== null && <p className="set-err" role="alert">{refused}</p>}
      </SettingStep>
      <SettingFoot actions={
        <>
          <Button variant="quiet" size="sm" disabled={refund.isPending} onClick={() => { setAsking(false); requestAnimationFrame(() => ask.current?.focus()); }}>{later.length === 1 ? 'Keep it' : 'Keep them'}</Button>
          <Button variant="secondary" size="sm" loading={refund.isPending} onClick={go}>Refund {usdCents(back)}</Button>
        </>
      } />
    </>
  );
}

/** How many of the balance's latest changes show before Show more. */
const FIRST = 5;

/**
 * The payments: what's on its way first, each opening where it's being paid (checkout for a plan or notes, the add-money
 * sheet for money alone), with a cancel while nothing has reached it; then the balance's latest changes, newest first, each
 * with its receipt.
 */
function Payments({ topUps, history, add, onAddMoney }: {
  topUps: TopUp[]; history: BalanceEntry[]; add: { current: HTMLButtonElement | null }; onAddMoney: (topUpId: string | null) => void;
}) {
  const checkout = useCheckout();
  const cancel = useCancelTopUp();
  const toast = useToast();
  const now = useNow();
  const [all, setAll] = useState(false);
  const [receipt, setReceipt] = useState<BalanceEntry | null>(null);
  const open = (t: TopUp) => { if (t.purchase) checkout.reopen(t.id, checkoutFor(t.purchase.buys), 'settings'); else onAddMoney(t.id); };
  /** Cancels a payment; its cancel goes, and focus moves to the row after it (or before it), else to Add money. */
  const cancelRow = (t: TopUp) => {
    const i = topUps.findIndex((x) => x.id === t.id);
    const near = topUps[i + 1] ?? topUps[i - 1];
    cancel.mutate(t.id, {
      onSuccess: () => requestAnimationFrame(() => {
        // Unless they've moved on: focus still on the cancelled row, or nowhere, is moved.
        const at = document.activeElement;
        if (at && at !== document.body && at.isConnected && !at.closest(`[data-top-up="${t.id}"]`)) return;
        const row = near ? document.querySelector<HTMLButtonElement>(`[data-top-up="${near.id}"] .set-pay-a button`) : null;
        (row ?? add.current)?.focus();
      }),
      onError: (e) => toast(errorMessage(e), { icon: 'x' })
    });
  };
  const more = history.length - FIRST;
  const shown = all || more <= 1 ? history : history.slice(0, FIRST);
  return (
    <SettingPayments title="Payments">
      {topUps.map((t) => {
        const what = t.purchase ? purchaseName(t.purchase.buys) : 'Money for your balance';
        const said = paymentLine(t, now);
        const cancellable = t.state === 'waiting' && Date.parse(t.expiresAt) > now;
        return (
          <PaymentRow key={t.id} data-top-up={t.id} mark={<CryptoMark name={t.route.chain} />} label={what} detail={said.text} tone={said.tone}
            actions={
              <>
                <Button size="sm" onClick={() => open(t)}>Open</Button>
                {cancellable && <IconButton icon="x" label={`Cancel the payment for ${what}`} disabled={cancel.isPending && cancel.variables === t.id} onClick={() => cancelRow(t)} />}
              </>
            } />
        );
      })}
      {shown.map((e) => {
        const day = shortDate(new Date(e.at));
        // Money added in USDC shows its mark; anything else, USDT added before only USDC was taken included, the coins.
        const usdc = /\bUSDC\b/.test(e.label);
        return (
          <PaymentRow key={`${e.id} ${e.at}`} mark={usdc ? <CryptoMark name="usdc" /> : <Icon name="coins" size={18} />} label={e.label}
            detail={`${e.microUsd >= 0 ? '+' : '−'}${usdCents(Math.abs(e.microUsd))} · ${day}`}
            actions={<Button variant="quiet" size="sm" icon="download" aria-label={`Receipt for ${e.label}, ${day}`} onClick={() => setReceipt(e)}>Receipt</Button>} />
        );
      })}
      {more > 1 && <ShowMore all={all} more={more} onToggle={() => setAll((a) => !a)} />}
      <Receipt entry={receipt} onClose={() => setReceipt(null)} />
    </SettingPayments>
  );
}

/** How a payment stands, in a line: on its way in horizon, a problem in caution. */
function paymentLine(t: TopUp, now: number): { text: string; tone: 'wait' | 'problem' | undefined } {
  const on = `${t.route.token} on ${t.route.chainName}`;
  const live = Date.parse(t.expiresAt) > now;
  const got = t.received?.amount ?? '0';
  const buying = t.purchase === null ? 'adding it to your balance' : t.purchase.buys.kind === 'pro' ? 'starting Pro' : t.purchase.buys.kind === 'licenses' ? 'adding the licenses' : 'adding the notes';
  switch (t.state) {
    case 'waiting': return live
      ? { text: `Waiting for ${tokensExact(t.asked.amount)} ${on} · open until ${byWhen(t.expiresAt, now)}`, tone: 'wait' }
      : { text: 'Nothing arrived, and its address has closed', tone: undefined };
    case 'arriving': return { text: `${tokensExact(t.received?.amount ?? t.asked.amount)} ${on} seen · ${buying}`, tone: 'wait' };
    case 'short': return live
      ? { text: `${got} of ${t.asked.amount} ${on} arrived · send ${restToSend(t)} more by ${byDay(t.expiresAt, now)}`, tone: 'problem' }
      : { text: `${got} ${t.route.token} arrived · its address has closed, and it’s added once it settles`, tone: undefined };
    case 'credited': return t.purchase?.outcome === 'refused'
      ? { text: `Added to your balance, but not bought. ${t.purchase.why ?? ''}`.trim(), tone: 'problem' }
      : { text: `${tokensExact(got)} ${on} added · ${buying}`, tone: 'wait' };
    case 'held': return { text: 'Too little arrived to add. Open it for the reference to give support.', tone: 'problem' };
    case 'failed': return { text: 'Something went wrong with this payment. Open it for the reference to give support.', tone: 'problem' };
    case 'expired': return { text: 'Nothing arrived', tone: undefined };
    case 'cancelled': return { text: 'Cancelled', tone: undefined };
  }
}

/** One change to the balance as a receipt, over the page, to print. */
function Receipt({ entry, onClose }: { entry: BalanceEntry | null; onClose: () => void }) {
  const me = useQuery(q.session()).data?.user;
  const lines: ReceiptLine[] = entry ? [
    { label: 'Date', value: `${fullDate(new Date(entry.at))}, ${hm(entry.at)}` },
    { label: entry.microUsd >= 0 ? 'Added to' : 'Paid from', value: 'Your Alcove balance' },
    ...(me ? [{ label: 'For', value: `${me.name}, ${me.email}` }] : []),
    { label: 'Reference', value: entry.id, mono: true }
  ] : [];
  return (
    <ReceiptWindow open={entry !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      {entry && (
        <PaymentReceipt title={entry.label} lines={lines} total={usdCents(Math.abs(entry.microUsd))} note="Priced in US dollars. 1 USDC is 1 dollar."
          onPrint={() => window.print()} onBack={onClose} backLabel="Close" />
      )}
    </ReceiptWindow>
  );
}
