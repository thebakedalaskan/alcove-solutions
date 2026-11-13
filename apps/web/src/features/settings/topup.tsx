/*
 * Adding money to the balance with USDC, from Settings › Plan: choose how much, then the network to send it on, and get an
 * address made for one payment of exactly that, sent from any wallet or exchange. A USDC is added as a dollar. The sheet
 * follows the payment on its own until it's added (or isn't), and opens again on it from Plan's payments, so closing it
 * loses nothing. Buying Pro or more notes is checkout's (features/plans/checkout.tsx), which asks for what it needs.
 */
import { errorMessage, MAX_TOP_UP_MICRO_USD } from '@alcove/api';
import { Button, Chip, CopyField, CryptoMark, Dots, Icon, IconButton, Notice, QrCode, RequestRef, Select, Sheet, Spinner, type SelectOption } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { restToSend as rest } from '~/features/plans/purchase';
import { q, useCancelTopUp, useStartTopUp } from '~/lib/queries';
import { byWhen, minutesUntil } from '~/lib/time';
import { usd } from '~/lib/words';

const tokens = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6, useGrouping: false });

/** "USDC on Base" */
const routeName = (r: { token: string; chainName: string }) => `${r.token} on ${r.chainName}`;

/** The least a custom amount suggests: the smallest any network takes. */
const MIN_CUSTOM = '5';
/**
 * What the custom amount field shows for what was typed: dollars and up to two places of cents, no leading zeros, and
 * never more than one top-up can add.
 */
function dollarsInput(text: string): string {
  const [whole = '', ...rest] = text.replace(/[^\d.]/g, '').split('.');
  const digits = whole.replace(/^0+(?=\d)/, '').slice(0, 4);
  const cents = rest.length ? `.${rest.join('').slice(0, 2)}` : '';
  const max = MAX_TOP_UP_MICRO_USD / 1_000_000;
  return digits && Number(digits) > max ? String(max) : `${digits}${cents}`;
}
/** The micro-USD in the custom amount field, or null when it's empty or nothing. */
function typedMicroUsd(text: string): number | null {
  const n = Math.round(Number(text) * 1_000_000);
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** "1 month of Pro", "3 months of Pro": what a preset is, a number of Pro's periods. */
const periodsOf = (microUsd: number, presets: number[]): string => {
  const one = presets[0];
  const n = one ? Math.round(microUsd / one) : 0;
  return n > 0 ? `${n} ${n === 1 ? 'month' : 'months'} of Pro` : '';
};

/** The time now, a little stale: enough for "expires in 12 min" to keep up while the sheet stays open. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  return now;
}

/** `topUpId` opens the sheet on that top-up; null opens it on choosing how much to add. */
export function AddMoneySheet({ open, onOpenChange, topUpId }: { open: boolean; onOpenChange: (open: boolean) => void; topUpId: string | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label="Add money" className="set-topup">
      <Body key={topUpId ?? 'new'} topUpId={topUpId} onClose={() => onOpenChange(false)} />
    </Sheet>
  );
}

function Body({ topUpId, onClose }: { topUpId: string | null; onClose: () => void }) {
  const [id, setId] = useState(topUpId);
  return (
    <>
      <div className="set-topup-h">
        <h2>Add money</h2>
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
      {id === null ? <Pick onStarted={setId} /> : <Paying id={id} onNew={() => setId(null)} onClose={onClose} />}
    </>
  );
}

/** Choosing how much, then the network to send USDC on, then getting an address for one payment of it. */
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
  const microUsd = picked === 'own' ? typedMicroUsd(own) : picked;
  const least = route ? Math.round(Number(route.minimum) * 1_000_000) : 0;
  const below = route !== undefined && microUsd !== null && microUsd < least;
  /** What `n` comes to in USDC, a USDC a dollar ("20 USDC"): exactly what's sent. */
  const price = (n: number) => <span className="p"><b>{tokens.format(n / 1_000_000)} USDC</b></span>;
  const go = () => { if (route && microUsd !== null) start.mutate({ routeId: route.id, microUsd }, { onSuccess: (t) => onStarted(t.id) }); };
  return (
    <>
      <div className="set-topup-body">
        <p className="set-topup-lead">Pay from any wallet or exchange. It’s added to your balance once the payment arrives.</p>
        {routes.isPending ? <p className="set-topup-wait" role="status"><Dots />Looking up how you can pay</p>
          : data && list.length > 0 ? (
            <>
              <fieldset className="set-topup-amounts">
                <legend>How much</legend>
                {presets.map((n) => (
                  <label key={n} className="set-topup-amt">
                    <input type="radio" name={group} checked={picked === n} onChange={() => setAmount(n)} />
                    <span className="n">{usd(n)}<small>{periodsOf(n, presets)}</small></span>
                    {price(n)}
                  </label>
                ))}
                <div className="set-topup-amt is-own" onClick={() => setAmount('own')}>
                  <input type="radio" name={group} aria-label="Your own amount" checked={picked === 'own'} onChange={() => setAmount('own')} />
                  {picked === 'own' ? (
                    <span className="n">
                      <input id={ownId} className="ac-input" inputMode="decimal" autoComplete="off" autoFocus aria-label="Dollars"
                        placeholder={MIN_CUSTOM} value={own} onChange={(e) => setOwn(dollarsInput(e.target.value))} />
                      <small>Dollars</small>
                    </span>
                  ) : <span className="n">Your own amount</span>}
                  {picked === 'own' && microUsd !== null && price(microUsd)}
                </div>
              </fieldset>
              <fieldset className="set-topup-pick">
                <legend>Pay with <CryptoMark name="USDC" />USDC</legend>
                <Select<string> label="Network" placeholder="Network" value={routeId} options={chainOptions} onChange={setRouteId} />
              </fieldset>
              {route && below && (
                <Notice tone="caution">
                  {routeName(route)} takes at least {route.minimum} {route.token}. Choose more, or another network.
                </Notice>
              )}
            </>
          ) : <Notice tone="caution">{routes.isError ? errorMessage(routes.error) : 'There’s no way to pay right now. Try again later.'}</Notice>}
        <div role="status">{start.isError && <Notice tone="caution">{errorMessage(start.error)}</Notice>}</div>
      </div>
      <div className="set-topup-f">
        <Button variant="primary" disabled={!route || microUsd === null || below || start.isPending} onClick={go}>
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
    : { label: 'Send exactly', amount: t.asked.amount, more: null };
  // A token is added as a dollar: what was asked, until it's settled, then what was added.
  const added = done && r ? r.microUsd ?? 0 : Math.round(Number(t.asked.amount) * 1_000_000);

  // How it stands: a chip, and a line on what happens next.
  let chip: ReactNode;
  let next: ReactNode;
  /** Where support is needed: the reference to give them, on its own line. */
  let ref = false;
  if (lapsed && t.state === 'waiting') {
    chip = <Chip icon="clock">Address expired</Chip>;
    next = 'Nothing arrived. To add money, start a new top-up.';
  } else if (t.state === 'waiting') {
    chip = <Chip tone="horizon"><Dots />Waiting for your payment</Chip>;
    next = <>Scan it with a {chainName} wallet, or copy the address below. After you paste it, check the first and last characters.</>;
  } else if (short && lapsed) {
    chip = <Chip icon="clock">Address expired</Chip>;
    next = 'Don’t send more to this address. What arrived is added after the payment or refund settles.';
  } else if (short) {
    chip = <Chip tone="caution" icon="alert">Less than asked arrived</Chip>;
    next = <>Send the other {rest(t)} {token} to the same address. If you don’t, the {r?.amount ?? ''} {token} that arrived is added after the payment or refund settles.</>;
  } else if (t.state === 'arriving') {
    chip = <Chip tone="horizon"><Dots />Payment seen</Chip>;
    next = 'Adding it to your balance. This usually takes a minute or two.';
  } else if (t.state === 'credited') {
    chip = <Chip tone="sun" icon="check">Added</Chip>;
    next = 'It’s in your balance now.';
  } else if (t.state === 'held') {
    chip = <Chip tone="caution" icon="alert">Too small to add</Chip>;
    next = 'What arrived is too little to add. If you think that’s wrong, contact support with this reference.';
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
    next = 'Nothing arrived. To add money, start a new top-up.';
  }
  /** Nothing has reached it and its address can still be paid: it can be cancelled. */
  const cancellable = t.state === 'waiting' && !lapsed;
  const expires = address !== null && <p className="exp"><Icon name="clock" size={15} />Open until {byWhen(t.expiresAt, now)}</p>;

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
            <span className="ac-eyebrow">{done ? 'Added' : short && lapsed ? 'Your balance' : 'You add'}</span>
            {short && lapsed ? <p className="added">Settlement pending</p>
              : <p className="added"><b>{usd(added)}</b>{short && ' in total'}</p>}
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
                {short ? <Chip tone="outline">Same address</Chip> : <Chip tone="horizon">Made for this payment</Chip>}
              </div>
              <CopyField value={address} label="Deposit address" />
              {t.memo !== null && <CopyField value={t.memo} label="Memo" />}
            </div>
            <Notice tone="caution" icon="alert">Only send <b>{routeName(t.route)}</b>. Anything else may be lost. Sending from an exchange? Add its withdrawal fee on top.</Notice>
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
