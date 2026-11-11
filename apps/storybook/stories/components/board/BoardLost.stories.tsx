/*
 * BoardLost: what the sheet offers while nothing on the board is in view, though there's something on it, as after a scroll or
 * a drag off into empty space: a quiet way back to all of it, in the middle of the sheet, which does what Show everything does.
 * It isn't filled, as the view's one filled button is someone else's. It goes once something is in view again.
 */
import { BoardBar, BoardLost } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { BAR, KitSheet, RetroPiece } from './parts';

/** Far off to the right of the retro, with nothing of it in view. */
const AWAY = { x: -2600, y: -900, z: 0.8 };

const meta = {
  title: 'Components/Board/BoardLost',
  component: BoardLost,
  args: { onBack: did('onBack') },
  render: (args) => (
    <KitSheet width={1000} height={520} cam={AWAY} over={<><BoardBar name="Launch retro" zoom={0.8} {...BAR} /><BoardLost {...args} /></>}>
      <RetroPiece />
    </KitSheet>
  )
} satisfies Meta<typeof BoardLost>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a call, scrolled off into empty space: Back to the board, under the bar, over nothing. */
export const InACall: Story = { name: 'In a call' };
/** On a phone, dragged off the board: the same way back, and Show everything stays on the bar. */
export const OnAPhone: Story = {
  name: 'On a phone',
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: (args) => (
    <KitSheet phone width={390} height={560} cam={{ ...AWAY, z: 0.6 }} over={<><BoardBar name="Launch retro" zoom={0.6} {...BAR} /><BoardLost {...args} /></>}>
      <RetroPiece />
    </KitSheet>
  )
};
