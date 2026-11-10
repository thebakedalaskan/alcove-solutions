/*
 * ReactionBurst: emoji floating up over the call when someone reacts from the dock. Each rises out of the bottom edge, drifts a little
 * and fades at its peak within 2 seconds, so the call drops it after 2. It never takes a press. With reduced motion they take a short,
 * gentle rise. Shown on the night stage; the stories make new ones on a timer so it keeps playing.
 */
import { CALL_REACTIONS } from '@alcove/api';
import { ReactionBurst, type BurstItem } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { onStage } from '../../../src/component';

/** A pseudo-random number from a counter, so the same press floats the same way. */
function spread(n: number, salt: number): number {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** `count` emoji from the `round`th press, spread along the strip. */
function make(round: number, count: number): BurstItem[] {
  return Array.from({ length: count }, (_, i) => {
    const n = round * 100 + i;
    return {
      id: `${round}-${i}`,
      name: CALL_REACTIONS[Math.floor(spread(n, 1) * CALL_REACTIONS.length)] ?? 'heart',
      x: spread(n, 2),
      lift: 0.24 + spread(n, 3) * 0.18,
      drift: (spread(n, 4) - 0.5) * 90,
      size: 28 + Math.round(spread(n, 5) * 16),
      turn: (spread(n, 6) - 0.5) * 50
    };
  });
}

/** New emoji every 2.2 seconds, replacing the last, as the call drops them after 2. */
function Replay({ count }: { count: number }) {
  const [round, setRound] = useState(0);
  const [items, setItems] = useState(() => make(0, count));
  useEffect(() => {
    const timer = setInterval(() => setRound((r) => r + 1), 2200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setItems(make(round, count)); }, [round, count]);
  return (
    <div style={{ position: 'relative', width: 'min(100%, 520px)', height: 420, borderRadius: 16, background: 'var(--stage-tile)', overflow: 'hidden' }}>
      <ReactionBurst items={items} />
    </div>
  );
}

const meta = {
  title: 'Components/In a call/ReactionBurst',
  component: ReactionBurst,
  ...onStage,
  args: { items: [] },
  argTypes: { items: { control: false }, className: { control: false } }
} satisfies Meta<typeof ReactionBurst>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One reaction, sent again every couple of seconds. */
export const One: Story = {
  render: () => <Replay count={1} />
};
/** Thirty at once, as when a room cheers. */
export const Many: Story = {
  render: () => <Replay count={30} />
};
