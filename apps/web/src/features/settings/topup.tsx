/*
 * Adding credits with USDC: choose how many credits, then the network to send it on, and get an address for one
 * payment of exactly their price, sent from any wallet or exchange. The sheet follows the payment on its own until
 * it's added (or isn't), and opens again on any top-up from Plan and credits, so closing it loses nothing.
 */
import { errorMessage, MAX_TOP_UP_CREDITS, type CreditTier, type TopUp } from '@alcove/api';
import { Button, Chip, CopyField, CryptoMark, Dots, Icon, IconButton, Notice, QrCode, RequestRef, Select, Sheet, Spinner, type SelectOption } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { q, useCancelTopUp, useStartTopUp } from '~/lib/queries';
import { daysFromToday, hm, hoursAndMinutes, minutesUntil, shortDay } from '~/lib/time';

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const tokens = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6, useGrouping: false });

/** "USDC on Base" */
export const routeName = (r: { token: string; chainName: string }) => `${r.token} on ${r.chainName}`;

/** "14:30", "tomorrow 14:30", "Thu 12 Nov 14:30": when something will have happened by. */
function byWhen(iso: string, now: number): string {
  const days = daysFromToday(new Date(iso), new Date(now));
  if (days <= 0) return hm(iso);
  return `${days === 1 ? 'tomorrow' : shortDay(new Date(iso))} ${hm(iso)}`;
}

/** `a` minus `b`, two token amounts as decimal strings ("5" − "1.5" = "3.5"), never below 0. */
export function amountLeft(a: string, b: string): string {
  const places = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const units = (x: string) => { const [w = '0', f = ''] = x.split('.'); return BigInt(w + f.padEnd(places, '0')); };
  const left = units(a) - units(b);
  if (left <= 0n) return '0';
  const digits = left.toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = digits.slice(digits.length - places).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
/** What's still to send on a short top-up: the asked amount less what arrived. */
const rest = (t: TopUp) => amountLeft(t.asked.amount, t.received?.amount ?? '0');

/** "14:30" today, "tomorrow", "Mon 9 Nov": the day something happens by, for a line that has no room for more. */
function byDay(iso: string, now: number): string {
  const days = daysFromToday(new Date(iso), new Date(now));
  return days <= 0 ? hm(iso) : days === 1 ? 'tomorrow' : shortDay(new Date(iso));
}
/** How a top-up stands, in a line. The waiting, arriving and short lines are also what Plan and credits lists. */
export function topUpLine(t: TopUp, now = Date.now()): string {
  const token = t.route.token;
  switch (t.state) {
    case 'waiting': return Date.parse(t.expiresAt) > now ? 'Waiting for your payment' : 'Address expired';
    case 'arriving': return 'Payment seen, adding your credits';
    case 'short': return Date.parse(t.expiresAt) > now
      ? `${t.received?.amount ?? 'Part'} of ${t.asked.amount} ${token} arrived · send ${rest(t)} more by ${byDay(t.expiresAt, now)}`
      : `${t.received?.amount ?? 'Part'} ${token} arrived · address expired, settlement pending`;
    case 'credited': return `Added ${number.format(t.received?.credits ?? 0)} credits`;
    case 'held': return 'Too little arrived to add any credits';
    case 'failed': return 'Something went wrong with this payment. Contact support with this reference:';
    case 'expired': return 'This address expired. Nothing arrived.';
    case 'cancelled': return 'Cancelled';
  }
}

/** The tier `credits` falls in: the one with the highest start it reaches. */
const tierOf = (credits: number, tiers: CreditTier[]) => tiers.reduce<CreditTier | undefined>((best, t) => (credits >= t.fromCredits ? t : best), undefined);
/**
 * What `credits` cost in USD, worked out as the server does (rounded up to a millionth) so the price is right before
 * an address exists; the quote the server makes is what counts. The small allowance absorbs floating-point error.
 */
function priceOf(credits: number, tiers: CreditTier[]): number | null {
  const t = tierOf(credits, tiers);
  return t ? Math.ceil((credits * 1e6) / t.creditsPerUsd - 1e-6) / 1e6 : null;
}
/** How much less than the base rate `credits` cost, in whole percent: 10 for 50,000, 20 for 100,000. */
function percentOff(credits: number, tiers: CreditTier[]): number {
  const base = tiers.find((t) => t.fromCredits === 0)?.creditsPerUsd;
  const rate = tierOf(credits, tiers)?.creditsPerUsd;
  return base && rate ? Math.round((1 - base / rate) * 100) : 0;
}
/** The least a custom amount suggests: the smallest any network takes. */
const MIN_CUSTOM = 5_000;
/**
 * What the custom amount field shows for what was typed: digits only (commas are put back as thousands separators),
 * no leading zeros, and never more than the most one top-up can buy.
 */
function creditsInput(text: string): string {
  const digits = text.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  return number.format(Math.min(Number(digits.slice(0, 9)), MAX_TOP_UP_CREDITS));
}
/** The credits in the custom amount field, or null when it's empty. */
function typedCredits(text: string): number | null {
  const n = Number(text.replace(/\D/g, ''));
  return n > 0 ? n : null;
}

/** The time now, a little stale: enough for "expires in 12 min" to keep up while the sheet stays open. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  return now;
}

/** `topUpId` opens the sheet on that top-up; null opens it on choosing what to buy. */
export function AddCreditsSheet({ open, onOpenChange, topUpId }: { open: boolean; onOpenChange: (open: boolean) => void; topUpId: string | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label="Add credits" className="set-topup">
      <Body key={topUpId ?? 'new'} topUpId={topUpId} onClose={() => onOpenChange(false)} />
    </Sheet>
  );
}

function Body({ topUpId, onClose }: { topUpId: string | null; onClose: () => void }) {
  const [id, setId] = useState(topUpId);
  return (
    <>
      <div className="set-topup-h">
        <h2>Add credits</h2>
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
      {id === null ? <Pick onStarted={setId} /> : <Paying id={id} onNew={() => setId(null)} onClose={onClose} />}
    </>
  );
}

/** Choosing how many credits, then the network to send USDC on, then getting an address for their price. */
function Pick({ onStarted }: { onStarted: (id: string) => void }) {
  const routes = useQuery(q.topUpRoutes());
  const start = useStartTopUp();
  const group = useId();
  const ownId = useId();
  const [routeId, setRouteId] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState<number | 'own' | null>(null);
  const [own, setOwn] = useState('');
  const data = routes.data;
  const list = data?.routes ?? [];
  /*
   * Nothing is chosen for them: they pick the network. Every route offered is USDC, one per network, so the list shows
   * only networks and the legend and prices say USDC. If the server offers another token again (its allowlist in
   * apps/api/src/features/billing/oneclick.ts), bring back a token choice here first.
   */
  const chainOptions: SelectOption<string>[] = list.map((r) => ({ value: r.id, label: r.chainName, mark: <CryptoMark name={r.chain} /> }));
  const route = list.find((r) => r.id === routeId);
  const presets = data?.presets ?? [];
  const picked = amount ?? presets[0] ?? 'own';
  const credits = picked === 'own' ? typedCredits(own) : picked;
  const below = route !== undefined && credits !== null && credits < route.minimumCredits;
  /** "~6 h 40 min" and "10 USDC" for `n` credits. */
  const what = (n: number) => {
    const price = data ? priceOf(n, data.tiers) : null;
    return { hours: data ? `~${hoursAndMinutes(n / data.perMinute)}` : '', price: price === null ? '' : `${tokens.format(price)} USDC` };
  };
  const ownWhat = credits !== null && picked === 'own' ? what(credits) : null;
  const go = () => { if (route && credits !== null) start.mutate({ routeId: route.id, credits }, { onSuccess: (t) => onStarted(t.id) }); };
  const price = (n: number) => {
    const off = data ? percentOff(n, data.tiers) : 0;
    return <span className="p">{off > 0 && <Chip tone="horizon">{off}% off</Chip>}<b>{what(n).price}</b></span>;
  };
  return (
    <>
      <div className="set-topup-body">
        <p className="set-topup-lead">Pay from any wallet or exchange. Your credits are added once the payment arrives.</p>
        {routes.isPending ? <p className="set-topup-wait" role="status"><Dots />Looking up how you can pay</p>
          : data && list.length > 0 ? (
            <>
              <fieldset className="set-topup-amounts">
                <legend>How many credits</legend>
                {presets.map((n) => (
                  <label key={n} className="set-topup-amt">
                    <input type="radio" name={group} checked={picked === n} onChange={() => setAmount(n)} />
                    <span className="n">{number.format(n)} credits<small>{what(n).hours}</small></span>
                    {price(n)}
                  </label>
                ))}
                <div className="set-topup-amt is-own" onClick={() => setAmount('own')}>
                  <input type="radio" name={group} aria-label="Custom amount" checked={picked === 'own'} onChange={() => setAmount('own')} />
                  {picked === 'own' ? (
                    <span className="n">
                      <input id={ownId} className="ac-input" inputMode="numeric" autoComplete="off" autoFocus aria-label="Credits"
                        placeholder={number.format(MIN_CUSTOM)} value={own} onChange={(e) => setOwn(creditsInput(e.target.value))} />
                      <small>{ownWhat ? ownWhat.hours : 'Credits'}</small>
                    </span>
                  ) : <span className="n">Custom amount</span>}
                  {ownWhat && price(credits ?? 0)}
                </div>
              </fieldset>
              <fieldset className="set-topup-pick">
                <legend>Pay with <CryptoMark name="USDC" />USDC</legend>
                <Select<string> label="Network" placeholder="Network" value={routeId} options={chainOptions} onChange={setRouteId} />
              </fieldset>
              {route && below && (
                <Notice tone="caution">
                  {routeName(route)} takes at least {number.format(route.minimumCredits)} credits ({route.minimum} {route.token}). Choose more credits or another network.
                </Notice>
              )}
            </>
          ) : <Notice tone="caution">{routes.isError ? errorMessage(routes.error) : 'There’s no way to pay right now. Try again later.'}</Notice>}
        <div role="status">{start.isError && <Notice tone="caution">{errorMessage(start.error)}</Notice>}</div>
      </div>
      <div className="set-topup-f">
        <Button variant="primary" disabled={!route || credits === null || below || start.isPending} onClick={go}>
          {start.isPending && <Spinner />}{start.isPending ? 'Getting an address' : 'Get an address'}
        </Button>
      </div>
    </>
  );
}

/** One top-up: what to send and where while a payment is awaited, and how it stands, read again until it's done. */
function Paying({ id, onNew, onClose }: { id: string; onNew: () => void; onClose: () => void }) {
  const topUp = useQuery(q.topUp(id));
  const cancel = useCancelTopUp();
  const perMinute = useQuery(q.balance()).data?.perMinute;
  const now = useMinute();
  const t = topUp.data;
  if (!t) {
    return (
      <div className="set-topup-body">
        {topUp.isError
          ? <Notice tone="caution">{errorMessage(topUp.error)}</Notice>
          : <p className="set-topup-wait" role="status"><Dots />Opening the top-up</p>}
      </div>
    );
  }
  const { token, chainName } = t.route;
  const hours = (credits: number) => (perMinute && credits > 0 ? `~${hoursAndMinutes(credits / perMinute)}` : null);
  const left = minutesUntil(t.expiresAt, now);
  // The server shows the address only while it can take money; past its expiry it can't, whatever the state says yet.
  const address = left > 0 ? t.address : null;
  /** Past its expiry while the server still has it open: nothing more can be sent to it. */
  const lapsed = t.address !== null && address === null;
  const r = t.received;
  const done = t.state === 'credited' || t.state === 'held';
  const short = t.state === 'short';

  // What's sent and what it buys: what's still to send while it can be, what arrived once it's settled.
  const send = done && r ? { label: 'You sent', amount: r.amount, more: null }
    : t.state === 'arriving' ? { label: 'You sent', amount: r?.amount ?? t.asked.amount, more: null }
    : short && lapsed ? { label: 'You sent', amount: r?.amount ?? '0', more: null }
    : short ? { label: 'Send another', amount: rest(t), more: `${r?.amount ?? 'Part'} of ${t.asked.amount} ${token} arrived` }
    : { label: 'You send', amount: t.asked.amount, more: null };
  const credits = done && r ? r.credits ?? 0 : t.asked.credits;

  // How it stands: a chip, and a line on what happens next.
  let chip: ReactNode;
  let next: ReactNode;
  /** Where support is needed: the reference to give them, on its own line. */
  let ref = false;
  if (lapsed && t.state === 'waiting') {
    chip = <Chip icon="clock">Address expired</Chip>;
    next = 'Nothing arrived. To add credits, start a new top-up.';
  } else if (t.state === 'waiting') {
    chip = <Chip tone="horizon"><Dots />Waiting for payment</Chip>;
    next = <>Scan with a {chainName} wallet, or copy the address below. Send exactly {t.asked.amount} {token}; if your exchange takes a withdrawal fee, add it on top.</>;
  } else if (short && lapsed) {
    chip = <Chip icon="clock">Address expired</Chip>;
    next = 'Don’t send more to this address. Credits will be added after the payment or refund settles.';
  } else if (short) {
    chip = <Chip tone="caution" icon="alert">Less than asked arrived</Chip>;
    next = <>Send the other {rest(t)} {token} to the same address for your {number.format(t.asked.credits)} credits. If you don’t, the {r?.amount ?? ''} {token} that arrived is added as credits after the payment or refund settles.</>;
  } else if (t.state === 'arriving') {
    chip = <Chip tone="horizon"><Dots />Payment seen</Chip>;
    next = 'Adding your credits. This usually takes a minute or two.';
  } else if (t.state === 'credited') {
    chip = <Chip tone="sun" icon="check">Credits added</Chip>;
    next = 'They’re in your balance now.';
  } else if (t.state === 'held') {
    chip = <Chip tone="caution" icon="alert">Too small to add</Chip>;
    next = 'What arrived is too little to add any credits. If you think that’s wrong, contact support with this reference.';
    ref = true;
  } else if (t.state === 'failed') {
    chip = <Chip tone="caution" icon="alert">Something went wrong</Chip>;
    next = 'This payment needs a person to look at it. Contact support with this reference.';
    ref = true;
  } else if (t.state === 'cancelled') {
    chip = <Chip icon="x">Cancelled</Chip>;
    next = 'This top-up is cancelled. If you already sent a payment to its address, it’s still added when it arrives.';
  } else {
    chip = <Chip icon="clock">Address expired</Chip>;
    next = 'Nothing arrived. To add credits, start a new top-up.';
  }
  /** Nothing has reached it and its address can still be paid: it can be cancelled. */
  const cancellable = t.state === 'waiting' && !lapsed;
  const expires = address !== null && <p className="exp"><Icon name="clock" size={15} />Expires {byWhen(t.expiresAt, now)}</p>;

  return (
    <>
      <div className="set-topup-body">
        <div className={`set-topup-sum${t.state === 'expired' || t.state === 'cancelled' || (lapsed && t.state === 'waiting') ? ' is-void' : ''}`}>
          <div>
            <span className="ac-eyebrow">{send.label}</span>
            <p className="amt"><b>{send.amount}</b> {token}</p>
            <p className="on"><CryptoMark name={t.route.chain} />on {chainName}</p>
            {send.more && <p className="so-far">({send.more})</p>}
          </div>
          <div className="get">
            <span className="ac-eyebrow">{done ? 'You got' : short && lapsed ? 'Your credits' : 'You get'}</span>
            {short && lapsed ? <p className="credits">Settlement pending</p> : <>
              <p className="credits"><b>{number.format(credits)}</b> credits{short && ' in total'}</p>
              {hours(credits) && <p className="hrs">{hours(credits)}</p>}
            </>}
          </div>
        </div>
        {address !== null ? (
          <>
            <div className="set-topup-scan">
              <QrCode value={address} size={152} label={`Address to send ${routeName(t.route)} to`} />
              <div className="how" role="status">{chip}<p>{next}</p>{expires}</div>
            </div>
            <div className="set-topup-dest">
              <div className="h">
                <span>Deposit address · {chainName}</span>
                {short ? <Chip tone="outline">Same address</Chip> : <Chip tone="horizon" icon="clock">One-time use</Chip>}
              </div>
              <CopyField value={address} label="Deposit address" />
              {t.memo !== null && <CopyField value={t.memo} label="Memo" />}
            </div>
            <Notice tone="caution" icon="alert">Only send <b>{routeName(t.route)}</b>. Anything else may be lost.</Notice>
          </>
        ) : (
          <div className="set-topup-how" role="status">{chip}<p>{next}</p>{ref && <RequestRef id={t.id} />}</div>
        )}
        <div role="status">{cancel.isError && <Notice tone="caution">{errorMessage(cancel.error)}</Notice>}</div>
      </div>
      <div className="set-topup-f">
        {cancellable
          ? <Button variant="quiet" loading={cancel.isPending} onClick={() => cancel.mutate(t.id)}>{cancel.isPending ? 'Cancelling' : 'Cancel top-up'}</Button>
          : <Button variant="quiet" onClick={onNew}>Start a new top-up</Button>}
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
