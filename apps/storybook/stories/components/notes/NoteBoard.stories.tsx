/*
 * NoteBoard: the call's board on a note, right under its summary. A live picture of all of it, drawn small from the board at
 * its full size, then its name, what's on it, where it's saved and who can open it, and Open the board. The whole card opens
 * it, and on a phone the picture goes above the words. Each breakout room's board is in Components/Notes/NoteRoomBoard.
 */
import { NoteBoard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { boardPicture } from './boardPicture';

const meta = {
  title: 'Components/Notes/NoteBoard',
  component: NoteBoard,
  args: { name: 'Launch retro', about: '3 frames, 13 stickies, saved in Product.', reach: 'Everyone invited can open it.', picture: boardPicture(300), onOpen: did('onOpen') },
  argTypes: { picture: { control: false }, pictureRef: { control: false } },
  render: (args) => <div className="nd" style={{ width: 'min(100%, 760px)' }}><NoteBoard {...args} /></div>
} satisfies Meta<typeof NoteBoard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Under the summary: everyone invited can open it, so the notes read it. */
export const OnTheNote: Story = { name: 'On the note' };
/** Someone invited can't open it, so the one summary everyone gets leaves it out, and the card says so. */
export const NotEveryoneCanOpenIt: Story = {
  name: 'Not everyone can open it',
  args: { reach: 'Not everyone invited can open it, so the summary leaves it out.' }
};
/** While the board opens: where it's saved, and the picture's place kept. */
export const Opening: Story = { args: { about: 'Saved in Product.', picture: undefined } };
