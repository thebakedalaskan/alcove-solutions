/*
 * BoardFrame: holds what's inside it, with its title in the board's own type and, beside it, how many stickies it has or who
 * was in its room. Frames are the slides when someone presents, and a room's space on a shared board. While it's empty it says
 * what goes in it; after sorting it's drawn round a theme; it steps back while another frame has the room; and it lands when a
 * room comes back. Someone else typing its title rings the title in their colour.
 */
import { BoardEdit, BoardFrame, BoardSelectionBox, BoardSticky } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef, useState } from 'react';
import { FOLK } from '../../../../src/world/boards';
import { KitSheet, RetroPiece, SupportRoom, pickedAt } from '../parts';

const CAM = { x: 30, y: 40, z: 0.7 };

const meta = {
  title: 'Components/Board/Objects/BoardFrame',
  component: BoardFrame,
  args: { id: 'well', x: 0, y: 0, w: 360, h: 530, title: 'Went well', hint: 'What should we keep doing?', land: false, dim: false, theme: false },
  argTypes: { title: { control: 'text' }, sub: { control: 'text' }, hint: { control: 'text' }, editor: { control: false } },
  render: (args) => (
    <KitSheet width={560} height={440} cam={CAM}>
      <BoardFrame {...args} />
    </KitSheet>
  )
} satisfies Meta<typeof BoardFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A new retro's frame, empty: it says what goes in it, until the first sticky lands. */
export const Empty: Story = {};

/** Could improve with its five stickies, counted beside its title. */
export const WithStickies: Story = {
  name: 'With stickies',
  args: { id: 'fix', title: 'Could improve', sub: '5', hint: undefined },
  render: () => (
    <KitSheet width={560} height={440} cam={CAM}>
      <RetroPiece />
    </KitSheet>
  )
};

/** A room's board, back on the main one when rooms close: named for the room, with who was in it. It lands, one room after another. */
export const FromARoom: Story = {
  name: 'From a room',
  render: () => (
    <KitSheet width={560} height={440} cam={CAM}>
      <SupportRoom land />
    </KitSheet>
  )
};

/** A theme, after Sort into themes: drawn round what was sorted into it, and named. */
const COMMS = ['Write the changelog first', 'One launch calendar', 'Tell support a week ahead'] as const;
export const ATheme: Story = {
  name: 'A theme',
  args: { id: 'comms', w: 530, h: 190, title: 'Comms', hint: undefined, theme: true },
  render: (args) => (
    <KitSheet width={560} height={440} cam={{ x: 30, y: 60, z: 0.9 }}>
      <BoardFrame {...args} />
      {COMMS.map((text, i) => <BoardSticky key={text} id={text} x={20 + i * 170} y={20} w={150} h={150} colour="butter" text={text} />)}
    </KitSheet>
  )
};

/** Stepped back: Went well, while a vote runs on Could improve beside it. */
export const SteppedBack: Story = {
  name: 'Stepped back',
  args: { x: -400, dim: true },
  render: (args) => (
    <KitSheet width={780} height={440} cam={{ x: 300, y: 40, z: 0.6 }}>
      <BoardFrame {...args} />
      <RetroPiece />
    </KitSheet>
  )
};

/** Maya is typing its title: her colour rings it, as it rings a sticky she's typing in. */
export const SomeoneTypingItsTitle: Story = { name: 'Someone typing its title', args: { other: FOLK.maya.colour } };

/** Typing its title yourself: the field takes the title's place, in its type, on one line, and the frame stays picked. */
const PICKED = pickedAt({ x: 0, y: 0, w: 360, h: 530 }, CAM);
export const TypingItsTitle: Story = {
  name: 'Typing its title',
  render: function Render(args) {
    const [title, setTitle] = useState('Went well');
    const field = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => field.current?.focus({ preventScroll: true }), []);
    return (
      <KitSheet width={560} height={440} cam={CAM} over={<BoardSelectionBox {...PICKED.ring} handles={false} />}>
        <BoardFrame {...args} title={title} editor={<BoardEdit ref={field} label="Edit this title" rows={1} value={title} onChange={(e) => setTitle(e.target.value)} />} />
      </KitSheet>
    );
  }
};
