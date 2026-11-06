/*
 * NoteRoomBoard: a breakout room's board on a note, under the summary with the call's, side by side with the other rooms' and
 * folding to a stack on a phone. Its picture, the room's name and what came of it with who was there; one click opens it.
 */
import { NoteRoomBoard, NoteRoomBoards } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { boardPicture } from './boardPicture';

const meta = {
  title: 'Components/Notes/NoteRoomBoard',
  component: NoteRoomBoard,
  args: {
    name: 'Comms', line: 'One owner for launch comms. Priya and Theo were here.', picture: boardPicture(232, 9 / 4), onOpen: did('onOpen')
  },
  argTypes: { picture: { control: false }, pictureRef: { control: false } },
  render: (args) => <div className="nd" style={{ width: 'min(100%, 252px)' }}><NoteRoomBoard {...args} /></div>
} satisfies Meta<typeof NoteRoomBoard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One room's board: the room, what came of it, and who was there. */
export const ARoom: Story = { name: 'A room' };
/** Not everyone invited can open this one, so the summary left it out, and the card says so. */
export const NotEveryoneCanOpenIt: Story = { name: 'Not everyone can open it', args: { name: 'Support', line: 'Support joins the launch review. Lena and Sam were here.', reach: 'Not everyone invited can open it, so the summary leaves it out.' } };
/** Three rooms side by side, under how many and for how long, as the note has them. On a phone they stack. */
export const ThreeRooms: Story = {
  name: 'Three rooms',
  render: () => (
    <div className="nd" style={{ width: 'min(100%, 760px)' }}>
      <NoteRoomBoards label="3 breakout rooms · 10 min">
        <NoteRoomBoard name="Comms" line="One owner for launch comms. Priya and Theo were here." picture={boardPicture(226, 9 / 4)} onOpen={did('Comms')} />
        <NoteRoomBoard name="Staging" line="Refresh staging every night. Kofi and Maya were here." picture={boardPicture(226, 9 / 4)} onOpen={did('Staging')} />
        <NoteRoomBoard name="Support" line="Support joins the launch review. Lena and Sam were here." picture={boardPicture(226, 9 / 4)} onOpen={did('Support')} />
      </NoteRoomBoards>
    </div>
  )
};
/** One room had no board, or one this reader can't open: the cards are the rooms' boards they can, out of how many rooms. */
export const TwoOfThreeRooms: Story = {
  name: 'Two of three rooms',
  render: () => (
    <div className="nd" style={{ width: 'min(100%, 760px)' }}>
      <NoteRoomBoards label="2 of 3 breakout rooms · 10 min">
        <NoteRoomBoard name="Comms" line="One owner for launch comms. Priya and Theo were here." picture={boardPicture(226, 9 / 4)} onOpen={did('Comms')} />
        <NoteRoomBoard name="Staging" line="Refresh staging every night. Kofi and Maya were here." picture={boardPicture(226, 9 / 4)} onOpen={did('Staging')} />
      </NoteRoomBoards>
    </div>
  )
};
