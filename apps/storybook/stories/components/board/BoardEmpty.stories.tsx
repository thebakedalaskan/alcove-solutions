/*
 * BoardEmpty: what a blank board says until the first sticky, in the middle of the sheet: how to add one, and that everyone
 * here can add to it. It fades as that sticky lands, and goes on being drawn until it has gone. A phone, which only adds
 * stickies with +, doesn't show it.
 */
import { BoardBar, BoardEmpty } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BAR, KitSheet } from './parts';

const meta = {
  title: 'Components/Board/BoardEmpty',
  component: BoardEmpty,
  args: { fading: false },
  render: (args) => <KitSheet width={1000} height={520} over={<><BoardBar name="Launch retro" zoom={1} {...BAR} /><BoardEmpty {...args} /></>} />
} satisfies Meta<typeof BoardEmpty>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A new board from Blank, in a call. */
export const ABlankBoard: Story = { name: 'A blank board' };
