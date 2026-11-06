/*
 * Adding credits with a stablecoin: choose how many credits, then a token and its chain, and get an address for one
 * payment of exactly their price, sent from any wallet or exchange. The sheet follows the payment on its own until
 * it's added (or isn't), and opens again on any top-up from Plan and credits, so closing it loses nothing.
 */
import { errorMessage, MAX_TOP_UP_CREDITS, type CreditTier, type TopUp, type TopUpRoute } from '@alcove/api';
import { Button, Chip, CopyField, CryptoMark, Dots, Icon, IconButton, Notice, QrCode, RequestRef, Select, Sheet, Spinner, type SelectOption } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { q, useStartTopUp } from '~/lib/queries';
import { daysFromToday, hm, hoursAndMinutes, minutesUntil, shortDay, startsLabel } from '~/lib/time';

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

/** How a top-up stands, in a line. The waiting, arriving and short lines are also what Plan and credits lists. */
export function topUpLine(t: TopUp, now = Date.now()): string {
  const token = t.route.token;
  switch (t.state) {
    case 'waiting': return 'Waiting for your payment';
    case 'arriving': return 'Payment seen, adding your credits';
    case 'short': return `${t.received?.amount ?? 'Less than asked'} of ${t.asked.amount} ${token} arrived. Send the other ${rest(t)} ${token} to the same address by ${byWhen(t.expiresAt, now)} for your ${number.format(t.asked.credits)} credits. If you don’t, what arrived is added as credits then.`;
    case 'credited': return `Added ${number.format(t.received?.credits ?? 0)} credits`;
    case 'held': return `Too small to add: under 1 ${token}`;
    case 'failed': return 'Something went wrong with this payment. Contact support with this reference:';
    case 'expired': return 'This address expired. Nothing arrived.';
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

/** Choosing how many credits, then a token and its chain, then getting an address for their price. */
function Pick({ onStarted }: { onStarted: (id: string) => void }) {
  const routes = useQuery(q.topUpRoutes());
  const start = useStartTopUp();
  const group = useId();
  const ownId = useId();
  const [token, setToken] = useState<TopUpRoute['token'] | undefined>(undefined);
  const [chain, setChain] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState<number | 'own' | null>(null);
  const [own, setOwn] = useState('');
  const data = routes.data;
  const list = data?.routes ?? [];
  // Nothing is chosen for them: the token first, then a network it's offered on.
  const tokenOptions: SelectOption<TopUpRoute['token']>[] = [...new Set(list.map((r) => r.token))]
    .map((t) => ({ value: t, label: t, mark: <CryptoMark name={t} /> }));
  const chainOptions: SelectOption<string>[] = list.filter((r) => r.token === token)
    .map((r) => ({ value: r.chain, label: r.chainName, mark: <CryptoMark name={r.chain} /> }));
  const route = list.find((r) => r.token === token && r.chain === chain);
  const pickToken = (t: TopUpRoute['token']) => {
    setToken(t);
    if (!list.some((r) => r.token === t && r.chain === chain)) setChain(undefined);
  };
  const presets = data?.presets ?? [];
  const picked = amount ?? presets[0] ?? 'own';
  const credits = picked === 'own' ? typedCredits(own) : picked;
  const below = route !== undefined && credits !== null && credits < route.minimumCredits;
  /** "~6 h 40 min" and "10 USDC" for `n` credits, priced in the chosen token (USD until one is chosen). */
  const what = (n: number) => {
    const price = data ? priceOf(n, data.tiers) : null;
    return { hours: data ? `~${hoursAndMinutes(n / data.perMinute)}` : '', price: price === null ? '' : `${tokens.format(price)} ${token ?? 'USD'}` };
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
                <legend>Pay with</legend>
                <Select<TopUpRoute['token']> label="Token" placeholder="Token" value={token} options={tokenOptions} onChange={pickToken} />
                <Select<string> label="Network" placeholder="Network" value={chain} options={chainOptions} onChange={setChain} disabled={!token} />
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
  const hours = (credits: number) => (perMinute ? ` (~${hoursAndMinutes(credits / perMinute)})` : '');
  const left = minutesUntil(t.expiresAt, now);
  // The server shows the address only while it can take money; past its expiry it can't, whatever the state says yet.
  const address = left > 0 ? t.address : null;
  /** Past its expiry while the server still has it open: nothing more can be sent to it. */
  const lapsed = t.address !== null && address === null;
  let state: ReactNode;
  if (lapsed && t.state === 'waiting') state = <p className="set-topup-state is-expired"><Icon name="clock" size={18} />This address expired. To add credits, start a new top-up.</p>;
  else if (t.state === 'short') state = <Notice tone="caution">{topUpLine(t, now)}</Notice>;
  else if (t.state === 'failed') state = <Notice tone="caution">{topUpLine(t, now)} <RequestRef id={t.id} /></Notice>;
  else {
    const mark = t.state === 'waiting' || t.state === 'arriving' ? <Dots /> : <Icon name={t.state === 'credited' ? 'check' : 'clock'} size={18} />;
    state = <p className={`set-topup-state is-${t.state}`}>{mark}{topUpLine(t, now)}</p>;
  }
  const r = t.received;
  return (
    <>
      <div className="set-topup-body">
        {address !== null && (
          <div className="set-topup-ask">
            <h3>{t.state === 'short' ? `Send ${rest(t)} ${t.route.token} more on ${t.route.chainName}` : `Send ${t.asked.amount} ${t.route.token} on ${t.route.chainName}`}</h3>
            <p>→ {number.format(t.asked.credits)} credits{t.state === 'short' ? ' in total' : ''}{perMinute ? ` · ~${hoursAndMinutes(t.asked.credits / perMinute)}` : ''}</p>
          </div>
        )}
        <div role="status">{state}</div>
        {address !== null ? (
          <div className="set-topup-addr">
            <QrCode value={address} size={164} label={`Address to send ${routeName(t.route)} to`} />
            <div className="how">
              <p className="only">Only send {t.route.token} on {t.route.chainName}. Anything else may be lost.</p>
              <CopyField value={address} label="Address" />
              {t.memo !== null && <CopyField value={t.memo} label="Memo" />}
              <p>Send exactly this amount. If your exchange takes a withdrawal fee, add it on top.</p>
              <p>{t.state === 'short' ? 'Send the rest to this same address. It’s added to what already arrived.' : 'This address is for one payment. To add more later, start a new top-up.'}</p>
              <ul className="facts">
                <li><Icon name="clock" size={15} />Address expires {startsLabel(t.expiresAt, now)}</li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="set-topup-route">
            {t.state === 'short' || !r
              ? `${t.asked.amount} ${t.route.token} on ${t.route.chainName} for ${number.format(t.asked.credits)} credits`
              : r.credits !== null && r.credits > 0
                ? `${r.amount} ${t.route.token} arrived · ${number.format(r.credits)} credits added${hours(r.credits)}`
                : `${r.amount} ${t.route.token} arrived`}
          </p>
        )}
      </div>
      <div className="set-topup-f">
        <Button variant="quiet" onClick={onNew}>Start a new top-up</Button>
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
