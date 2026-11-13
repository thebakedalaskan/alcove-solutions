/*
 * Adding money to the balance with USDC, from Settings › Plan: choose how much, then the network to send it on, and get an
 * address made for one payment of exactly that, sent from any wallet or exchange. A USDC is added as a dollar. The sheet
 * follows the payment on its own until it's added (or isn't), as checkout follows one, with the same parts and words
 * (features/plans/paying.tsx), and opens again on it from Plan's payments, so closing it loses nothing. Buying Pro or more
 * notes is checkout's (features/plans/checkout.tsx), which asks for what it needs.
 */
import { errorMessage, MAX_TOP_UP_MICRO_USD } from '@alcove/api';
import { Button, CryptoMark, Dots, IconButton, Notice, Select, Sheet, Spinner, type SelectOption } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { PayAdded, PayNow, PayOver, PaySeen, isOver, payingOf, useSeenWhileOpen } from '~/features/plans/paying';
import { useNow } from '~/lib/live';
import { q, useCancelTopUp, useStartTopUp } from '~/lib/queries';
import { usd } from '~/lib/words';

const tokens = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6, useGrouping: false });

/** "USDC on Base" */
const routeName = (r: { token: string; chainName: string }) => `${r.token} on ${r.chainName}`;

/** The least a custom amount suggests: the smallest any network takes. */
const MIN_CUSTOM = '5';
/**
 * What the custom amount field shows for what was typed: dollars and up to two places of cents, no leading zeros, and
 * never more than one top-up can add. The whole amount, cents and all, is held to that most ($8,000), however many digits
 * were typed.
 */
function dollarsInput(text: string): string {
  const [whole = '', ...rest] = text.replace(/[^\d.]/g, '').split('.');
  const typed = `${whole.replace(/^0+(?=\d)/, '')}${rest.length ? `.${rest.join('').slice(0, 2)}` : ''}`;
  const micro = typedMicroUsd(typed);
  return micro !== null && micro > MAX_TOP_UP_MICRO_USD ? String(MAX_TOP_UP_MICRO_USD / 1_000_000) : typed;
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

/**
 * One payment into the balance, followed as checkout follows one, with the same parts and words (features/plans/paying.tsx):
 * how it stands and until when, what to send and where, then seen, added, or over and why, read again until it's done.
 */
function Paying({ id, onNew, onClose }: { id: string; onNew: () => void; onClose: () => void }) {
  const topUp = useQuery(q.topUp(id));
  const cancel = useCancelTopUp();
  const now = useNow();
  const t = topUp.data;
  const paying = t ? payingOf(t, now) : null;
  const counting = useSeenWhileOpen(paying);
  if (!t || !paying) {
    return (
      <div className="set-topup-body">
        {topUp.isError
          ? <Notice tone="caution">{errorMessage(topUp.error)}</Notice>
          : <p className="set-topup-wait" role="status"><Dots />Opening your payment</p>}
      </div>
    );
  }
  // Money for the balance buys nothing, so once it's added it's added.
  const body = paying === 'send' || paying === 'short' ? <PayNow t={t} now={now} />
    : paying === 'seen' ? <PaySeen t={t} count={counting} doing="Adding it to your balance. This takes a minute or two." last="Added to your balance" />
    : isOver(paying) ? <PayOver t={t} over={paying} />
    : <PayAdded t={t} />;
  return (
    <>
      <div className="set-topup-body">
        <div className="set-topup-pay">{body}</div>
        <div role="status">{cancel.isError && <Notice tone="caution">{errorMessage(cancel.error)}</Notice>}</div>
      </div>
      <div className="set-topup-f">
        {/* Nothing has reached it and its address can still be paid: it can be cancelled. */}
        {paying === 'send'
          ? <Button variant="quiet" loading={cancel.isPending} onClick={() => cancel.mutate(t.id)}>{cancel.isPending ? 'Cancelling' : 'Cancel payment'}</Button>
          : <Button variant="quiet" onClick={onNew}>Start a new payment</Button>}
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
