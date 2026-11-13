/*
 * Following a USDC payment (docs/design/pages.md › Checkout and › Settings): the one way checkout's Pay step and Settings'
 * Add money say where a payment is, with the kit's parts and one set of words. While it can take money: how it stands and
 * until when, exactly what to send, the address made for it with its QR code and its first and last characters in bold,
 * and what not to send. Seen: what arrived, counting up while you watch, and the track to what it does. Added. Or over
 * without going on: what happened in the chip, and in the headline what that means for the money, with the reference to
 * give support when a person has to look. Each window has its own foot and its own way on: checkout a new address or
 * choosing again, Add money another payment.
 */
import type { TopUp } from '@alcove/api';
import { CheckoutBig, CheckoutDone, CheckoutLine, CheckoutNote, PayAddress, PayAmount, PayArrived, PayStatus, PayTrack, RequestRef } from '@alcove/ui';
import { useState } from 'react';
import { byWhen } from '~/lib/time';
import { usd } from '~/lib/words';
import { lapsed, microOf, plainTokens, roundTokens, tokens } from './purchase';
import { walletLink } from './wallet';

/** Where a payment is, as checkout and Add money say it. */
export type Paying = 'send' | 'short' | 'closed-short' | 'seen' | 'bought' | 'refused' | 'added' | 'expired' | 'cancelled' | 'failed' | 'held';
/** A payment over without going on. */
export type PayingOver = Extract<Paying, 'closed-short' | 'expired' | 'cancelled' | 'failed' | 'held'>;

/** Where `t` is at `now`: an address past its expiry can't take money, whatever its state says yet. */
export function payingOf(t: TopUp, now: number): Paying {
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

/** Whether `p` is a payment over without going on. */
export const isOver = (p: Paying): p is PayingOver => p === 'closed-short' || p === 'expired' || p === 'cancelled' || p === 'failed' || p === 'held';

/**
 * Whether what arrived counts up: only when the payment is seen while it's on screen, from waiting for it (or for the rest).
 * Opened later on a payment already seen, the amount is simply there.
 */
export function useSeenWhileOpen(paying: Paying | null): boolean {
  const [last, setLast] = useState<{ at: Paying | null; count: boolean }>({ at: paying, count: false });
  if (last.at !== paying) setLast({ at: paying, count: paying === 'seen' && (last.at === 'send' || last.at === 'short') });
  return last.at === paying ? last.count : false;
}

/** What was asked and what has arrived so far, in micro-units of the token. */
const amounts = (t: TopUp) => ({ asked: microOf(t.asked.amount) ?? 0, got: microOf(t.received?.amount ?? '') ?? 0 });

/**
 * A payment that can still take money, or the rest of it: how it stands and until when, exactly what to send, the address
 * made for it (the same one for the rest), and what not to send. `quiet` while the window asks something else in its foot,
 * whose answer is then the filled button, not Open in wallet.
 */
export function PayNow({ t, now, quiet = false }: { t: TopUp; now: number; quiet?: boolean | undefined }) {
  const short = t.state === 'short';
  const { asked, got } = amounts(t);
  const rest = short ? Math.max(0, asked - got) : asked;
  const { chain, chainName, token } = t.route;
  const expires = `Open until ${byWhen(t.expiresAt, now)}`;
  return (
    <>
      {short
        ? <PayStatus tone="caution" icon="alert" label="Less than asked arrived" expires={expires} />
        : <PayStatus dots label="Waiting for your payment" expires={expires} />}
      <PayAmount label={short ? 'Send the rest' : 'Send exactly'} amount={tokens(rest)} copy={plainTokens(rest)} token={token} chain={chain} chainName={chainName}
        arrived={short ? `${tokens(got)} of ${tokens(asked)} ${token} arrived.` : null} />
      {t.address && (
        <PayAddress address={t.address} memo={t.memo} chainName={chainName} token={token} tag={short ? 'same' : 'new'} listening quiet={quiet}
          walletHref={walletLink(t.route, t.address, plainTokens(rest))} />
      )}
      {short && <CheckoutNote tone="info">If you don’t, the {roundTokens(got)} {token} that arrived stays in your balance.</CheckoutNote>}
      <CheckoutNote>Only send {token} on {chainName}. Anything else may be lost. Sending from an exchange? Add its withdrawal fee on top.</CheckoutNote>
    </>
  );
}

/**
 * A payment seen and being added: what arrived (counting up while you watch, `count`), what's being done with it (`doing`,
 * "Starting Pro. This takes a minute or two."), and the track from sending it to that (`last`, "Pro starts").
 */
export function PaySeen({ t, count, doing, last }: { t: TopUp; count: boolean; doing: string; last: string }) {
  const { asked, got } = amounts(t);
  const { chainName, token } = t.route;
  return (
    <>
      <PayStatus dots label="Payment seen" />
      <PayArrived amount={tokens(got || asked)} value={(got || asked) / 1_000_000} token={token} chainName={chainName} count={count} />
      <CheckoutLine>{doing}</CheckoutLine>
      <PayTrack steps={['Sent', `Seen on ${chainName}`, last]} />
    </>
  );
}

/** Money added to the balance, with nothing bought with it: its tick, and how much is in the balance now. */
export function PayAdded({ t }: { t: TopUp }) {
  return <CheckoutDone title="Added to your balance" lines={[`${usd(t.received?.microUsd ?? 0)} is in your balance now.`]} receipt={null} reminder={null} />;
}

/**
 * A payment over without going on (`over`): what happened, in the chip, and in the headline what that means for the money,
 * so neither says the other's words; then a line on it, and the reference to give support when a person has to look (failed,
 * held). `then` is the window's way on, said last: a new address, choosing again.
 */
export function PayOver({ t, over, then }: { t: TopUp; over: PayingOver; then?: string | null | undefined }) {
  const { asked, got } = amounts(t);
  const { token } = t.route;
  const said: Record<PayingOver, { chip: { label: string; icon: 'clock' | 'x' | 'alert'; caution: boolean }; big: string; line: string | null }> = {
    'closed-short': {
      chip: { label: 'Address closed', icon: 'clock', caution: false }, big: `${tokens(got)} of ${tokens(asked)} ${token} arrived`,
      line: 'Nothing more can be sent to it, and what arrived goes into your balance once the payment settles.'
    },
    expired: { chip: { label: 'Address closed', icon: 'clock', caution: false }, big: 'Nothing arrived in 24 hours', line: 'So nothing was charged.' },
    cancelled: { chip: { label: 'Payment cancelled', icon: 'x', caution: false }, big: 'A payment already sent still counts', line: null },
    failed: { chip: { label: 'Something went wrong', icon: 'alert', caution: true }, big: 'It needs a person to look at it', line: 'Give support this reference, and they’ll sort it out.' },
    held: { chip: { label: 'Too little arrived', icon: 'alert', caution: true }, big: 'Nothing was added to your balance', line: 'If you think that’s wrong, give support this reference.' }
  };
  const { chip, big, line } = said[over];
  return (
    <>
      <PayStatus tone={chip.caution ? 'caution' : 'quiet'} icon={chip.icon} label={chip.label} />
      <CheckoutBig>{big}</CheckoutBig>
      {line && <CheckoutLine>{line}</CheckoutLine>}
      {then && <CheckoutLine>{then}</CheckoutLine>}
      {(over === 'failed' || over === 'held') && <RequestRef id={t.id} className="ck-ref" />}
    </>
  );
}
