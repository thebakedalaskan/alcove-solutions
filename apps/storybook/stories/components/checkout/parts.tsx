/*
 * What the checkout's component stories share: what Art is buying in the demo world, a year of Pro at $16 a month (20% off
 * $20), or ten hours of notes at $15, as the app's checkout says it (apps/web/src/features/plans/CheckoutHost.tsx), and a
 * frame of the window's own surface for the parts that only show inside it. Every address here is a made-up preview that
 * no wallet takes.
 */
import type { CheckoutSummaryData, MonthsOption, NetworkOption } from '@alcove/ui';
import type { ReactNode } from 'react';
import { PREVIEW_BASE_ADDRESS } from '../../../src/world/payments';

export { PREVIEW_BASE_ADDRESS };

/** A year of Pro on Free with nothing in the balance: 192 USDC to send. */
export const PRO_YEAR_SUMMARY: CheckoutSummaryData = {
  art: 'pro', name: 'Pro', sub: 'For Art Vandelay', brief: '12 months · 20% off',
  lines: [{ label: '12 months at $20', value: '$240' }, { label: 'A year or more: 20% off', value: '−$48', off: true }],
  total: { value: '192.00', unit: 'USDC' },
  until: { lead: 'Pro until', day: 'Saturday 30 October 2027' },
  foot: 'Priced in US dollars. 1 USDC is 1 dollar, so you send exactly the total.'
};
/** Extending Pro, which ends in 3 days, with $5 in the balance. */
export const EXTEND_SUMMARY: CheckoutSummaryData = {
  ...PRO_YEAR_SUMMARY, sub: 'Added to the 3 days you have left',
  lines: [...PRO_YEAR_SUMMARY.lines, { label: 'Your balance', value: '−$5' }],
  total: { value: '187.00', unit: 'USDC' }, until: { lead: 'Pro until', day: 'Tuesday 2 November 2027' }
};
/** Three months bought from a balance of $60. */
export const FROM_BALANCE_SUMMARY: CheckoutSummaryData = {
  art: 'pro', name: 'Pro', sub: 'For Art Vandelay', brief: '3 months',
  lines: [{ label: '3 months at $20', value: '$60' }], total: { value: '$60' },
  until: { lead: 'Pro until', day: 'Wednesday 3 February 2027' }, foot: 'Paid from your balance: $60 now, $0 after.'
};
/** Ten hours of notes for this period, sent on Ethereum, which takes at least 20 USDC. */
export const HOURS_SUMMARY: CheckoutSummaryData = {
  art: 'hours', name: '10 hours of notes', sub: 'For this period', brief: 'For this period',
  lines: [{ label: '10 hours at $1.50 an hour', value: '$15' }], total: { value: '20.00', unit: 'USDC' },
  extra: 'Ethereum takes at least 20 USDC, so 5.00 of it stays in your balance.',
  until: { lead: 'Until', day: 'Saturday 21 November 2026' }, foot: 'Priced in US dollars. 1 USDC is 1 dollar, so you send exactly the total.'
};

/** Pro's lengths up to 12 months, a year at 20% off. */
export const LENGTHS: MonthsOption[] = [
  { months: 1, total: '$20', each: '$20 a month', off: false },
  { months: 3, total: '$60', each: '$20 a month', off: false },
  { months: 6, total: '$120', each: '$20 a month', off: false },
  { months: 12, total: '$192', each: '$16 a month', off: true }
];

/** The networks USDC is sent on, in the canvas's order. */
export const NETWORKS: NetworkOption[] = [
  { id: 'base', chain: 'base', name: 'Base' }, { id: 'sol', chain: 'sol', name: 'Solana' },
  { id: 'eth', chain: 'eth', name: 'Ethereum', note: 'From 20' }, { id: 'arb', chain: 'arb', name: 'Arbitrum' },
  { id: 'pol', chain: 'pol', name: 'Polygon' }, { id: 'near', chain: 'near', name: 'NEAR' },
  { id: 'op', chain: 'op', name: 'Optimism' }, { id: 'avax', chain: 'avax', name: 'Avalanche' },
  { id: 'bsc', chain: 'bsc', name: 'BNB Chain' }
];

/**
 * The window's left column, for a part that only shows in it: its surface, as wide as the step, in a frame as wide as the
 * window, which is what the parts lay out by (on a phone, the screen).
 */
export function Step({ children, width = 548 }: { children: ReactNode; width?: number | undefined }) {
  return (
    <div className="ck-host" style={{ width: 'min(944px, calc(100vw - 32px))', height: 'auto' }}>
      <div className="ac-modal ck sbc-modal" style={{ width: `min(${width + 56}px, 100%)`, height: 'auto', margin: '24px 0', padding: '22px 28px' }}>{children}</div>
    </div>
  );
}
/** The window's right column, for what you're buying. */
export function Side({ children }: { children: ReactNode }) {
  return <div className="ac-modal ck sbc-modal" style={{ width: 'min(340px, calc(100vw - 32px))', height: 620 }}>{children}</div>;
}
