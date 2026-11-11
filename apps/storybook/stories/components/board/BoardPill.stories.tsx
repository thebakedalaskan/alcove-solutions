/*
 * BoardPill: anything the whole board shares, in one place under the bar, one thing at a time: a vote and its results, who
 * you're following, a room's time and the connection. Who's presenting is the frame's bar's to say, not the pill's. At night on
 * any sheet, with its one action at the end, for whoever can use it: End the vote for whoever started it or the organizer, Done
 * for them too. `soon` turns it amber as a room's time runs out. Every word here is the design canvas's.
 */
import { BoardBar, BoardPill, ICON_NAMES } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { BAR, KitSheet, RetroPiece, SupportRoom } from './parts';

const meta = {
  title: 'Components/Board/BoardPill',
  component: BoardPill,
  args: { icon: 'vote', title: 'Voting', text: '2 of 3 votes left', soon: false, action: 'End the vote', onAction: did('onAction') },
  argTypes: { icon: { control: 'select', options: ICON_NAMES }, title: { control: 'text' }, text: { control: 'text' }, time: { control: 'text' }, action: { control: 'text' } },
  render: (args) => (
    <KitSheet width={1000} height={300} cam={{ x: 40, y: 140, z: 0.8 }} over={<><BoardBar name="Launch retro" zoom={0.8} {...BAR} /><BoardPill {...args} /></>}>
      <RetroPiece />
    </KitSheet>
  )
} satisfies Meta<typeof BoardPill>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A vote: how many of your votes are left, and ending it. Nobody sees the count until it ends. */
export const Voting: Story = { args: { icon: 'vote', title: 'Voting', text: '2 of 3 votes left', time: undefined, action: 'End the vote' } };
/** The same vote for everyone else who can add to the board: their own votes left. */
export const VotingForEveryoneElse: Story = { name: 'Voting, for everyone else', args: { icon: 'vote', title: 'Voting', text: '3 of 3 votes left', time: undefined, action: undefined } };
/** For someone who can only look at the board: there's a vote, and nothing to vote with. */
export const VotingYouCanOnlyLook: Story = { name: 'Voting, for someone who can only look', args: { icon: 'vote', title: 'Voting', text: undefined, time: undefined, action: undefined } };
/** The vote's results, on the stickies, until Done. */
export const Results: Story = { args: { icon: 'vote', title: 'Results', text: '7 people voted', time: undefined, action: 'Done' } };
/** The same results for everyone else, until whoever started it is done. */
export const ResultsForEveryoneElse: Story = { name: 'Results, for everyone else', args: { icon: 'vote', title: 'Results', text: '7 people voted', time: undefined, action: undefined } };
/** Following someone: the sheet shows what they see, and Stop takes you back to your own view. */
export const Following: Story = { args: { icon: 'eye', title: 'Following Priya', text: undefined, time: undefined, action: 'Stop' } };
/** In a breakout room: its name and the time it has left. */
export const InARoom: Story = { name: 'In a room', args: { icon: 'door', title: 'Comms', text: undefined, time: '9:12', action: undefined, said: '' } };
/** A minute left: amber, and it says the board comes back to the main room with you. */
export const ComingBack: Story = { name: 'Coming back', args: { icon: 'door', title: 'Comms', text: 'This board comes back with you', time: '1:00', soon: true, action: undefined, said: '' } };
/**
 * The last ten seconds: rooms are closing, and everyone comes back to the main room. A room's time counts down on screen only:
 * a screen reader is told at ten seconds, and again as they close, never each second.
 */
export const RoomsClose: Story = { name: 'Rooms close', args: { icon: 'door', title: 'Comms', text: 'Rooms close in 10 seconds', time: '0:10', soon: true, action: undefined, said: 'Rooms close in 10 seconds.' } };
/** In a room on the one board every room shares: it isn't private, and the pill says so all along. */
export const OnTheSharedBoard: Story = { name: 'On the shared board', args: { icon: 'door', title: 'Comms', text: 'Everyone can see this board', time: '9:12', action: undefined, said: '' } };
/** Rooms on one shared board: how many, and their time. */
export const RoomsOnOneBoard: Story = { name: 'Rooms on one board', args: { icon: 'door', title: '3 rooms on this board', text: undefined, time: '9:12', action: undefined, said: '' } };
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
