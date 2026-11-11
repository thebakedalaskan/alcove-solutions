/*
 * NoteBoard: the call's board on a note, right under its summary. A live picture of all of it, drawn small from the board at
 * its full size, then its name, what's on it, where it's saved and who can open it, and Open the board. The whole card opens
 * it. It's sized by the column it's in, not the window: from 600px wide the picture takes a share of the width beside the
 * words, and narrower (beside Your notes and the transcript on a wide screen, or on a phone) it goes above them. Each
 * breakout room's board is in Components/Notes/NoteRoomBoard.
 */
import { NoteBoard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { boardPicture } from './boardPicture';

/** The note's column, `width` wide, with the list the cards sit in. */
const Column = ({ width, children }: { width: string; children: ReactNode }) => <div className="nd" style={{ width }}><div className="nd-boards">{children}</div></div>;

const meta = {
  title: 'Components/Notes/NoteBoard',
  component: NoteBoard,
  args: { name: 'Launch retro', about: '3 frames, 13 stickies, saved in Product.', reach: 'Everyone invited can open it.', picture: boardPicture(), onOpen: did('onOpen') },
  argTypes: { picture: { control: false }, pictureRef: { control: false } },
  render: (args) => <Column width="min(100%, 760px)"><NoteBoard {...args} /></Column>
} satisfies Meta<typeof NoteBoard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Under the summary, in a laptop's column: the picture takes a share of the width beside the words. */
export const OnTheNote: Story = { name: 'On the note' };
/** In a narrow column, as beside Your notes and the transcript on a wide screen: the picture goes above the words, full width. */
export const InANarrowColumn: Story = {
  name: 'In a narrow column',
  render: (args) => <Column width="min(100%, 460px)"><NoteBoard {...args} /></Column>
};
/** Someone invited can't open it, so the one summary everyone gets leaves it out, and the card says so. */
export const NotEveryoneCanOpenIt: Story = {
  name: 'Not everyone can open it',
  args: { reach: 'Not everyone invited can open it, so the summary leaves it out.' }
};
/** While the board opens: where it's saved, and the picture's place kept. */
export const Opening: Story = { args: { about: 'Saved in Product.', picture: undefined } };
