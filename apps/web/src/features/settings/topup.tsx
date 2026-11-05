/*
 * Adding credits with a stablecoin: pick a token and its chain, get an address for one payment, send to it from any
 * wallet or exchange. The sheet follows the payment on its own until it's added (or isn't), and opens again on any
 * top-up from Plan and credits, so closing it loses nothing.
 */
import { errorMessage, type TopUp, type TopUpRoutes } from '@alcove/api';
import { Button, CopyField, Dots, Icon, IconButton, Notice, QrCode, RequestRef, Select, Sheet, Spinner, type SelectOption } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { q, useStartTopUp } from '~/lib/queries';
import { minutesUntil, startsLabel } from '~/lib/time';

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** "USDC on Base" */
export const routeName = (r: { token: string; chainName: string }) => `${r.token} on ${r.chainName}`;

/** How a top-up stands, in a line. The waiting, arriving and short lines are also what Plan and credits lists. */
export function topUpLine(t: TopUp): string {
  switch (t.state) {
    case 'waiting': return 'Waiting for your payment';
    case 'arriving': return 'Payment seen, adding your credits';
    case 'short': return 'We got less than the minimum. Send the rest before the address expires, or we’ll add what arrived after it does.';
    case 'credited': return `Added ${number.format(t.received?.credits ?? 0)} credits`;
    case 'held': return `Too small to add: under 1 ${t.route.token}`;
    case 'failed': return 'Something went wrong with this payment. Contact support with this reference:';
    case 'expired': return 'This address expired. Nothing arrived.';
  }
}

/** "Get 1,111 credits per USD from 45 USD, 1,250 from 80 USD": the better rates for larger payments. */
function tiersLine(tiers: TopUpRoutes['tiers']): string | null {
  const better = tiers.filter((t) => Number(t.from) > 0);
  if (!better.length) return null;
  return `Get ${better.map((t, i) => `${number.format(Math.floor(t.creditsPerUsd))}${i === 0 ? ' credits per USD' : ''} from ${t.from} USD`).join(', ')}`;
}

/** The time now, a little stale: enough for "expires in 12 min" to keep up while the sheet stays open. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  return now;
}

/** `topUpId` opens the sheet on that top-up; null opens it on picking how to pay. */
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

/** Picking a token and its chain, then getting an address on it. */
function Pick({ onStarted }: { onStarted: (id: string) => void }) {
  const routes = useQuery(q.topUpRoutes());
  const start = useStartTopUp();
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const list = routes.data?.routes ?? [];
  const route = list.find((r) => r.id === chosen) ?? list[0];
  const options: SelectOption<string>[] = list.map((r) => ({ value: r.id, label: routeName(r) }));
  const tiers = routes.data ? tiersLine(routes.data.tiers) : null;
  const go = () => { if (route) start.mutate(route.id, { onSuccess: (t) => onStarted(t.id) }); };
  return (
    <>
      <div className="set-topup-body">
        <p className="set-topup-lead">Pay from any wallet or exchange. Your credits are added once the payment arrives.</p>
        {routes.isPending ? <p className="set-topup-wait" role="status"><Dots />Looking up how you can pay</p>
          : route ? (
            <div className="set-topup-pick">
              <Select<string> label="Token and network" value={route.id} options={options} onChange={setChosen} />
              <small>At least {route.minimum} {route.token}</small>
            </div>
          ) : <Notice tone="caution">{routes.isError ? errorMessage(routes.error) : 'There’s no way to pay right now. Try again later.'}</Notice>}
        {tiers && <p className="set-topup-tiers">{tiers}</p>}
        <div role="status">{start.isError && <Notice tone="caution">{errorMessage(start.error)}</Notice>}</div>
      </div>
      <div className="set-topup-f">
        <Button variant="primary" disabled={!route || start.isPending} onClick={go}>
          {start.isPending && <Spinner />}{start.isPending ? 'Getting an address' : 'Get an address'}
        </Button>
      </div>
    </>
  );
}

/** One top-up: where to send while money can still be sent, and how it stands, read again until it's done. */
function Paying({ id, onNew, onClose }: { id: string; onNew: () => void; onClose: () => void }) {
  const topUp = useQuery(q.topUp(id));
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
  const left = minutesUntil(t.expiresAt, now);
  // The server shows the address only while it can take money; past its expiry it can't, whatever the state says yet.
  const address = left > 0 ? t.address : null;
  /** Past its expiry while the server still has it open: nothing more can be sent to it. */
  const lapsed = t.address !== null && address === null;
  let state: ReactNode;
  if (lapsed && t.state === 'waiting') state = <p className="set-topup-state is-expired"><Icon name="clock" size={18} />This address expired. To add credits, start a new top-up.</p>;
  else if (t.state === 'short') state = <Notice tone="caution">{topUpLine(t)}</Notice>;
  else if (t.state === 'failed') state = <Notice tone="caution">{topUpLine(t)} <RequestRef id={t.id} /></Notice>;
  else {
    const mark = t.state === 'waiting' || t.state === 'arriving' ? <Dots /> : <Icon name={t.state === 'credited' ? 'check' : 'clock'} size={18} />;
    state = <p className={`set-topup-state is-${t.state}`}>{mark}{topUpLine(t)}</p>;
  }
  return (
    <>
      <div className="set-topup-body">
        <div role="status">{state}</div>
        {address !== null ? (
          <div className="set-topup-addr">
            <QrCode value={address} size={164} label={`Address to send ${routeName(t.route)} to`} />
            <div className="how">
              <p className="only">Only send {t.route.token} on {t.route.chainName}. Anything else may be lost.</p>
              <CopyField value={address} label="Address" />
              {t.memo !== null && <CopyField value={t.memo} label="Memo" />}
              <p>This address is for one payment. To add more later, start a new top-up.</p>
              <ul className="facts">
                <li><Icon name="coins" size={15} />At least {t.route.minimum} {t.route.token}</li>
                <li><Icon name="clock" size={15} />Address expires {startsLabel(t.expiresAt, now)}</li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="set-topup-route">
            {routeName(t.route)}
            {t.received && ` · ${t.received.amount} ${t.route.token} arrived`}
            {lapsed && t.state !== 'waiting' && ' · This address expired. To add credits, start a new top-up.'}
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
