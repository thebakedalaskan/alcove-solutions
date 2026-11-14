import { Button, CheckoutDone, Chip, CheckoutLine, CheckoutNote, CheckoutPanel, PayAddress, PayAmount, PayArrived, PayStatus, PayTrack, type CheckoutStage } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type ReactNode } from 'react';
import { did } from '../../../../src/component';
import { PREVIEW_BASE_ADDRESS, PRO_YEAR_SUMMARY } from '../parts';

/**
 * Paying, in motion (the canvas's PayMotion board): waiting, then the payment lands, then Pro is on, on a loop. One move per
 * change, about half a second, transform and opacity only. Waiting, the sun sits on its horizon with its glow breathing and
 * the QR code listens; seen, the sun lifts, the amount counts up and the track's glint runs; done, the sun clears the
 * horizon, the sky warms, the glints widen, and the tick pops and draws. Slow motion plays it all at a quarter of the speed
 * (`--pm`); each loop starts still, so the sun doesn't set backwards. With reduced motion every state shows at once.
 */
const meta = {
  title: 'Components/Checkout/Pay/Paying, in motion', component: CheckoutPanel, parameters: { layout: 'padded' },
  args: { title: 'Get Pro', step: 2, stage: 'send', summary: PRO_YEAR_SUMMARY, onClose: did('onClose'), foot: null, children: null, pm: 1 },
  argTypes: { pm: { control: { type: 'range', min: 1, max: 8, step: 1 }, description: 'Slows every move by this much (--pm)' } }
} satisfies Meta<typeof CheckoutPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

const SEQUENCE: { stage: CheckoutStage; ms: number; name: string; says: string }[] = [
  { stage: 'send', ms: 2800, name: 'Waiting', says: 'Waiting for the payment. The address is open, the QR code listens, and the sun sits on the horizon.' },
  { stage: 'seen', ms: 2800, name: 'Payment seen', says: 'The payment lands. Its amount counts up, the sun lifts, and the line shows what’s left.' },
  { stage: 'done', ms: 3800, name: 'Pro is on', says: 'Pro is on. The sun clears the horizon, the sky warms and the check draws in.' }
];

function stepOf(stage: CheckoutStage, count: boolean, pm: number): { step: 1 | 2 | 3; body: ReactNode; foot: ReactNode } {
  if (stage === 'done') {
    return {
      step: 3, foot: <Button variant="primary">Done</Button>,
      body: <CheckoutDone title="You’re on Pro" lines={['Until Saturday 30 October 2027.']} reminder="Nothing renews by itself. Alcove reminds you before it ends."
        receipt={{ title: '192.00 USDC on Base', sub: '4 Nov 2026 · Pro, 12 months', reference: 'k3Fq9xZ2', onOpen: did('onReceipt') }} pm={pm} />
    };
  }
  if (stage === 'seen') {
    return {
      step: 2, foot: <><p className="hint">You can close this. It finishes by itself.</p><Button variant="secondary">Close</Button></>,
      body: (
        <>
          <PayStatus dots label="Payment seen" />
          <PayArrived amount="192.00" value={192} chainName="Base" count={count} pm={pm} />
          <CheckoutLine>Starting Pro. This takes a minute or two.</CheckoutLine>
          <PayTrack steps={['Sent', 'Seen on Base', 'Pro starts']} />
        </>
      )
    };
  }
  return {
    step: 2, foot: <><p className="hint">You can close this. Pro starts as soon as your payment arrives.</p><Button variant="quiet">Cancel payment</Button><Button variant="secondary">Close</Button></>,
    body: (
      <>
        <PayStatus dots label="Waiting for your payment" expires="Open until tomorrow 16:12" />
        <PayAmount amount="192.00" chain="base" chainName="Base" />
        <PayAddress address={PREVIEW_BASE_ADDRESS} chainName="Base" tag="new" walletHref={null} listening />
        <CheckoutNote>Only send USDC on Base. Anything else may be lost. Sending from an exchange? Add its withdrawal fee on top.</CheckoutNote>
      </>
    )
  };
}

/** The player: where it is, Slow motion and Play again over the window, which plays the payment on a loop. */
function Player({ pm: given = 1 }: { pm?: number | undefined }) {
  const [slow, setSlow] = useState(given > 1);
  const [run, setRun] = useState(0);
  const [at, setAt] = useState(0);
  const [still, setStill] = useState(true);
  const pm = slow ? Math.max(4, given) : 1;
  useEffect(() => {
    // Each loop starts still, then moves on a step at a time; every timer goes with the effect.
    const timers: number[] = [];
    let i = 0;
    const next = () => {
      const n = i % SEQUENCE.length;
      setAt(n);
      if (n === 0) { setStill(true); timers.push(window.setTimeout(() => setStill(false), 80)); }
      i += 1;
      timers.push(window.setTimeout(next, (SEQUENCE[n]?.ms ?? 2800) * pm));
    };
    next();
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [pm, run]);
  const now = SEQUENCE[at] ?? SEQUENCE[0];
  const stage = now?.stage ?? 'send';
  const { step, body, foot } = stepOf(stage, at === 1, pm);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <p className="ac-body" style={{ flex: '1 1 320px', margin: 0, color: 'var(--ink-2)' }}>{now?.says}</p>
        <ol aria-label="Where the payment is" style={{ display: 'flex', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
          {SEQUENCE.map((s, i) => <li key={s.name}><Chip tone={i === at ? 'horizon' : 'outline'}>{s.name}</Chip></li>)}
        </ol>
        <Button size="sm" variant={slow ? 'primary' : 'secondary'} aria-pressed={slow} onClick={() => setSlow((v) => !v)}>Slow motion</Button>
        <Button size="sm" variant="secondary" onClick={() => setRun((r) => r + 1)}>Play again</Button>
      </div>
      <div className={still ? 'ac-modal ck sbc-modal sbc-still' : 'ac-modal ck sbc-modal'} style={{ width: 'min(944px, 100%)', height: 672, margin: 0 }}>
        <CheckoutPanel title="Get Pro" step={step} stage={stage} summary={PRO_YEAR_SUMMARY} foot={foot} onClose={did('onClose')} pm={pm}>{body}</CheckoutPanel>
      </div>
    </div>
  );
}

export const PayingInMotion: Story = { name: 'Paying, in motion', render: ({ pm }) => <Player pm={pm} /> };
export const PayingInMotionNight: Story = { name: 'Paying, in motion, at night', render: ({ pm }) => <Player pm={pm} />, globals: { theme: 'dark' } };
export const SlowMotion: Story = { name: 'Slow motion', args: { pm: 4 }, render: ({ pm }) => <Player pm={pm} />, globals: { theme: 'dark' } };
