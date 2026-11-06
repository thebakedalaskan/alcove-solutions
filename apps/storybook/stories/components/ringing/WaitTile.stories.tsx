/*
 * WaitTile: someone the organizer rang who isn't in the call yet, waiting on the stage in a tile of their own: their arch,
 * what's happening, and their answer as a RingReply. The arch ripples while it rings. Once they've said no, or the ring
 * has run out, RingAgain is the one quiet thing to do. It fills the tile it's given; a short tile (a strip of tiles)
 * keeps the arch, what's happening and the answer.
 */
import { RingAgain, RingReply, WaitTile } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { Box, did, onStage } from '../../../src/component';
import { PRIYA } from '../../../src/world/people';

/** A tile on the stage, which the waiting tile fills: its size is what the tile's layout follows. */
const Tile = ({ width = 'min(560px, 100%)', height = 340, children }: { width?: number | string; height?: number; children: ReactNode }) => (
  <Box width={width} height={height}><div style={{ position: 'relative', containerType: 'size' }}>{children}</div></Box>
);
const rang = did('ring again');

const meta = {
  title: 'Components/Ringing and waiting/WaitTile',
  component: WaitTile,
  subcomponents: { RingReply, RingAgain },
  ...onStage,
  args: { person: PRIYA, title: 'Ringing Priya', ringing: true },
  argTypes: { person: { control: false }, title: { control: 'text' }, detail: { control: 'text' }, reply: { control: false }, action: { control: false } },
  render: (args) => <Tile><WaitTile {...args} /></Tile>
} satisfies Meta<typeof WaitTile>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Ringing, and for how long. */
export const Ringing: Story = { args: { detail: 'For 12 seconds' } };
/** Priya pressed Join: she's on her way in. */
export const OnTheWay: Story = { name: 'On the way', args: { title: 'Priya is on the way', ringing: false } };
/** Priya can't join yet: she answered In 5 minutes, and Alcove rings her again then. */
export const CantJoinYet: Story = {
  name: 'Can’t join yet',
  args: { title: 'Priya can’t join yet', ringing: false },
  render: (args) => <Tile><WaitTile {...args} reply={<RingReply icon="clock">In 5 minutes</RingReply>} /></Tile>
};
/** Priya answered Not this time. Press Ring again: the arch ripples again. */
export const CantJoin: Story = {
  name: 'Can’t join',
  args: { title: 'Priya can’t join', ringing: false },
  render: function Render(args) {
    const [again, setAgain] = useState(false);
    if (again) return <Tile><WaitTile person={args.person} title="Ringing Priya" detail="For 0 seconds" ringing /></Tile>;
    return <Tile><WaitTile {...args} reply={<RingReply icon="x">Not this time</RingReply>} action={<RingAgain onClick={() => { rang(); setAgain(true); }} />} /></Tile>;
  }
};
/** The ring ran out without an answer. Never "offline": Alcove can't know. */
export const NoAnswer: Story = {
  name: 'No answer',
  args: { title: 'Priya hasn’t answered', ringing: false },
  render: (args) => <Tile><WaitTile {...args} action={<RingAgain onClick={rang} />} /></Tile>
};
/** In a strip of small tiles: the arch, what's happening and the answer, smaller, and Ring again waits in People. */
export const InAStrip: Story = {
  name: 'In a strip',
  args: { title: 'Priya can’t join', ringing: false },
  render: (args) => <Tile width={220} height={150}><WaitTile {...args} reply={<RingReply icon="x">Not this time</RingReply>} action={<RingAgain onClick={rang} />} /></Tile>
};
