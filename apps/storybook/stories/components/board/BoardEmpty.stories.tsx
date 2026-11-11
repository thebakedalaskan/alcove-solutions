/*
 * BoardEmpty: what a blank board says until the first thing lands, in the middle of the sheet: that a double-click writes, text
 * on the board and a sticky in a frame, and that everyone here can add to it when they can. It fades as the first thing lands,
 * and goes on being drawn until it has gone. Someone who can only look is told that what people add shows up here.
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
/** Someone here can only look, so it doesn't say everyone can add. */
export const NotEveryoneCanAdd: Story = { name: 'Not everyone can add', args: { everyone: false } };
/** On a board's own page, where everyone who can open it can add to it. */
export const OnItsPage: Story = { name: 'On its page', args: { page: true } };
/** For someone who can only look. */
export const ToSomeoneWhoCanOnlyLook: Story = { name: 'To someone who can only look', args: { reader: true } };
