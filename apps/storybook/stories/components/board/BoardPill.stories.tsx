/*
 * BoardPill: anything the whole board shares, in one place under the bar: a timer, a vote and its results, who you're
 * following, who's presenting, a room's time and the connection. At night on any sheet, with its one action at the end.
 * `soon` turns it amber as a room's time runs out. Every word here is the design canvas's.
 */
import { BoardBar, BoardPill, ICON_NAMES } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { BAR, KitSheet, RetroPiece, SupportRoom } from './parts';

const meta = {
  title: 'Components/Board/BoardPill',
  component: BoardPill,
  args: { icon: 'timer', text: 'Add your stickies', time: '4:59', soon: false, action: 'Stop', onAction: did('onAction') },
  argTypes: { icon: { control: 'select', options: ICON_NAMES }, title: { control: 'text' }, text: { control: 'text' }, time: { control: 'text' }, action: { control: 'text' } },
  render: (args) => (
    <KitSheet width={1000} height={300} cam={{ x: 40, y: 140, z: 0.8 }} over={<><BoardBar name="Launch retro" zoom={0.8} {...BAR} /><BoardPill {...args} /></>}>
      <RetroPiece />
    </KitSheet>
  )
} satisfies Meta<typeof BoardPill>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A timer everyone sees count down, with what it's for. It chimes softly at the end. */
export const Timer: Story = {};
/** A vote: how many of your votes are left, and ending it. Nobody sees the count until it ends. */
export const Voting: Story = { args: { icon: 'vote', title: 'Voting', text: '2 of 3 votes left', time: undefined, action: 'End the vote' } };
/** The vote's results, on the stickies, until Done. */
export const Results: Story = { args: { icon: 'vote', title: 'Results', text: '7 people voted', time: undefined, action: 'Done' } };
/** Following someone: the sheet shows what they see, and Stop takes you back to your own view. */
export const Following: Story = { args: { icon: 'eye', title: 'Following Priya', text: undefined, time: undefined, action: 'Stop' } };
/** Someone is presenting: you see their frame, and can look round on your own. */
export const Presenting: Story = { args: { icon: 'play', title: 'Art is presenting', text: undefined, time: undefined, action: 'Look around' } };
/** Looking round while Art presents: one press takes you back to Art's frame. */
export const LookingAround: Story = { name: 'Looking around', args: { icon: 'play', title: 'Art is presenting', text: undefined, time: undefined, action: 'Back to Art' } };
/** In a breakout room: its name and the time it has left. */
export const InARoom: Story = { name: 'In a room', args: { icon: 'door', title: 'Comms', text: undefined, time: '9:12', action: undefined } };
/** A minute left: amber, and it says the board comes back to the main room with you. */
export const ComingBack: Story = { name: 'Coming back', args: { icon: 'door', title: 'Comms', text: 'This board comes back with you', time: '1:00', soon: true, action: undefined } };
/** Rooms on one shared board: how many, and their time. */
export const RoomsOnOneBoard: Story = { name: 'Rooms on one board', args: { icon: 'door', title: '3 rooms on this board', text: undefined, time: '9:12', action: undefined } };
/** The connection dropped. You keep working, and what you add goes up when it's back. */
export const Reconnecting: Story = { args: { icon: 'wifiOff', title: 'Reconnecting', text: 'Keep going. Your changes are safe here.', time: undefined, action: undefined } };
/** Changes that couldn't be saved: how many are only on this screen, and Try again. */
export const CouldNotSave: Story = { name: 'Couldn’t save', args: { icon: 'cloudOff', title: 'Couldn’t save', text: 'Your last 3 changes are only here.', time: undefined, action: 'Try again' } };
/** On a phone, in a room: the board has no bar there, so the pill sits at the top, and long words give way before the time does. */
export const OnAPhone: Story = {
  name: 'On a phone',
  args: { ...ComingBack.args },
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: (args) => (
    <KitSheet phone width={390} height={360} cam={{ x: 27, y: 80, z: 0.8 }} over={<BoardPill {...args} />}>
      <SupportRoom />
    </KitSheet>
  )
};
