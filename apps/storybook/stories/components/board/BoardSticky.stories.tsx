/*
 * BoardSticky: six colours from the sunrise, each a small dawn of its own, in three sizes. It says nothing about who wrote
 * it. While a vote runs it shows your own votes as dots; when it ends, everyone's count, with the most voted ringed and what
 * didn't make it stepping back. Someone else typing in it rings it in their colour, and it lifts while it's dragged. Words
 * too long for it are clipped, never spilling off it.
 */
import { BOARD_COLOURS, BoardPointer, BoardSticky, type BoardColour } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FOLK } from '../../../src/world/boards';
import { KitSheet } from './parts';

const meta = {
  title: 'Components/Board/BoardSticky',
  component: BoardSticky,
  args: { id: 'f1', x: 0, y: 0, w: 150, h: 150, colour: 'rose', text: 'Changelog went out after the launch post', size: 'm', votes: 0, dots: 0, top: false, muted: false, selected: false, lift: false },
  argTypes: {
    colour: { control: 'select', options: BOARD_COLOURS }, size: { control: 'inline-radio', options: ['s', 'm', 'l'] }, text: { control: 'text' },
    votes: { control: { type: 'number', min: 0 } }, dots: { control: { type: 'number', min: 0, max: 10 } }, editor: { control: false }, other: { control: 'color' }
  },
  render: (args) => (
    <KitSheet width={260} height={230} cam={{ x: 55, y: 40, z: 1 }}>
      <BoardSticky {...args} />
    </KitSheet>
  )
} satisfies Meta<typeof BoardSticky>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Priya's sticky in Could improve. */
export const ASticky: Story = { name: 'A sticky' };

/** The six, on ideas for launching better. */
const SIX: readonly (readonly [BoardColour, string])[] = [
  ['butter', 'Write the changelog first'], ['peach', 'One launch calendar'], ['rose', 'Tell support a week ahead'],
  ['lilac', 'Test billing with real cards'], ['sky', 'Refresh staging every night'], ['mist', 'Keep the runbook in the workspace']
];
export const EveryColour: Story = {
  name: 'Every colour',
  render: () => (
    <KitSheet width={600} height={400} cam={{ x: 40, y: 30, z: 0.9 }}>
      {SIX.map(([colour, text], i) => <BoardSticky key={colour} id={colour} x={(i % 3) * 180} y={Math.floor(i / 3) * 180} w={150} h={150} colour={colour} text={text} />)}
    </KitSheet>
  )
};

/** Small, as the Tools sheet draws them; the usual size; and large, as a phone adds one. Text size on the selection bar steps through them. */
export const Sizes: Story = {
  render: () => (
    <KitSheet width={600} height={240} cam={{ x: 30, y: 40, z: 1 }}>
      <BoardSticky id="s" x={0} y={0} w={150} h={150} size="s" colour="sky" text="One owner for launch comms" />
      <BoardSticky id="m" x={180} y={0} w={150} h={150} colour="sky" text="One owner for launch comms" />
      <BoardSticky id="l" x={360} y={0} w={150} h={150} size="l" colour="sky" text="One owner for launch comms" />
    </KitSheet>
  )
};

/** A vote running: the dots are your own votes on it, and nobody sees anyone else's. */
export const YourVotes: Story = { name: 'Your votes', args: { dots: 2 } };

/** The vote's results on Could improve: everyone's count on each, the most voted ringed, and what didn't make it stepping back. */
export const Results: Story = {
  render: () => (
    <KitSheet width={600} height={240} cam={{ x: 30, y: 40, z: 1 }}>
      <BoardSticky id="f1" x={0} y={0} w={150} h={150} colour="rose" text="Changelog went out after the launch post" votes={6} top />
      <BoardSticky id="f2" x={180} y={0} w={150} h={150} colour="rose" text="Staging data was two days stale" votes={5} top />
      <BoardSticky id="f3" x={360} y={0} w={150} h={150} colour="rose" text="Nobody owned the status page" votes={2} muted />
    </KitSheet>
  )
};

/** Maya is typing in it: her colour goes round it and dots show on her pointer. If two people type in the same sticky, both edits merge. */
export const SomeoneTyping: Story = {
  name: 'Someone typing',
  args: { id: 'h3', colour: 'sky', text: 'Name a status page', other: FOLK.maya.colour },
  render: (args) => (
    <KitSheet width={300} height={260} cam={{ x: 55, y: 40, z: 1 }} pointers={<BoardPointer x={110} y={110} person={FOLK.maya.person} name="Maya" colour={FOLK.maya.colour} typing />}>
      <BoardSticky {...args} />
    </KitSheet>
  )
};

/** Picked up while it's dragged: tilted, and casting a longer shadow. */
export const Lifted: Story = { args: { lift: true, selected: true } };

/** More than fits: it's clipped at the sticky's edge, and the whole of it is there to edit. */
export const TooLong: Story = {
  name: 'Too long',
  args: { colour: 'peach', text: 'Support, design and engineering all had a different launch date in their calendars until the Friday before, and nobody noticed until the changelog went out' }
};
