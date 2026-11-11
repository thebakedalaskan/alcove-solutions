/*
 * NoteRoomBoard: a breakout room's board on a note, under the summary with the call's, beside the other rooms': two or three
 * across as their column has room, and a stack in a narrow one, as on a phone. Its picture, in the call card's shape, the
 * room's name and what came of it with who was there; one click opens it.
 */
import { NoteRoomBoard, NoteRoomBoards } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { boardPicture } from './boardPicture';

/** The note's column, `width` wide. */
const Column = ({ width, children }: { width: string; children: ReactNode }) => <div className="nd" style={{ width }}>{children}</div>;

/** Three rooms' boards, under how many and for how long, as the note has them. */
const ThreeBoards = () => (
  <NoteRoomBoards label="3 breakout rooms · 10 min">
    <NoteRoomBoard name="Comms" line="One owner for launch comms. Priya and Theo were here." picture={boardPicture()} onOpen={did('Comms')} />
    <NoteRoomBoard name="Staging" line="Refresh staging every night. Kofi and Maya were here." picture={boardPicture()} onOpen={did('Staging')} />
    <NoteRoomBoard name="Support" line="Support joins the launch review. Lena and Sam were here." picture={boardPicture()} onOpen={did('Support')} />
  </NoteRoomBoards>
);

const meta = {
  title: 'Components/Notes/NoteRoomBoard',
  component: NoteRoomBoard,
  args: {
    name: 'Comms', line: 'One owner for launch comms. Priya and Theo were here.', picture: boardPicture(), onOpen: did('onOpen')
  },
  argTypes: { picture: { control: false }, pictureRef: { control: false } },
  render: (args) => <Column width="min(100%, 280px)"><NoteRoomBoard {...args} /></Column>
} satisfies Meta<typeof NoteRoomBoard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One room's board: the room, what came of it, and who was there. */
export const ARoom: Story = { name: 'A room' };
/** Not everyone invited can open this one, so the summary left it out, and the card says so. */
export const NotEveryoneCanOpenIt: Story = { name: 'Not everyone can open it', args: { name: 'Support', line: 'Support joins the launch review. Lena and Sam were here.', reach: 'Not everyone invited can open it, so the summary leaves it out.' } };
/** Three rooms side by side in a laptop's column, under how many and for how long. */
export const ThreeRooms: Story = {
  name: 'Three rooms',
  render: () => <Column width="min(100%, 760px)"><ThreeBoards /></Column>
};
/** The same three in a narrow column, as beside Your notes and the transcript on a wide screen: two across. */
export const ThreeRoomsInANarrowColumn: Story = {
  name: 'Three rooms in a narrow column',
  render: () => <Column width="min(100%, 460px)"><ThreeBoards /></Column>
};
/** One room had no board, or one this reader can't open: the cards are the rooms' boards they can, out of how many rooms. */
export const TwoOfThreeRooms: Story = {
  name: 'Two of three rooms',
  render: () => (
    <Column width="min(100%, 760px)">
      <NoteRoomBoards label="2 of 3 breakout rooms · 10 min">
        <NoteRoomBoard name="Comms" line="One owner for launch comms. Priya and Theo were here." picture={boardPicture()} onOpen={did('Comms')} />
        <NoteRoomBoard name="Staging" line="Refresh staging every night. Kofi and Maya were here." picture={boardPicture()} onOpen={did('Staging')} />
      </NoteRoomBoards>
    </Column>
  )
};
