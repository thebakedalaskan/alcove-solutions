/*
 * BoardPop: a small menu on the sheet, opened from the bar and hanging under what opened it. Lines to read (the seal's),
 * things to do (the name's, More's), or a choice of up to three with one button (the vote's). The name's and the seal's sit
 * under them on the left; the vote's and More's under them on the right. Every word here is the design canvas's. Pick how
 * many votes and it's the one picked.
 */
import { BoardBar, BoardPop, type BoardPopProps } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { BAR, KitSheet, RetroPiece } from './parts';

/** Three choices with the one picked on, each saying it was pressed. */
const choices = (labels: readonly string[], on: string): NonNullable<BoardPopProps['options']> =>
  labels.map((label) => ({ id: label, label, on: label === on, onPick: did(label) }));

const meta = {
  title: 'Components/Board/BoardPop',
  component: BoardPop,
  args: {
    left: 12, top: 62, title: 'Sealed',
    rows: [
      { icon: 'lock', text: 'Everyone in this call can add to it. Saved in Product.' },
      { icon: 'notes', text: 'The notes can use this board.' },
      { icon: 'sealed', text: 'Encrypted in storage.' }
    ]
  },
  argTypes: { title: { control: 'text' }, sub: { control: 'text' }, rows: { control: false }, options: { control: false }, items: { control: false }, action: { control: false } },
  parameters: { board: 'Launch retro', seal: 'Sealed' },
  render: function Render(args, { parameters }) {
    const [, update] = useArgs<typeof args>();
    const board: unknown = parameters['board'], seal: unknown = parameters['seal'];
    // Picking one of the choices makes it the one that's on.
    const options = args.options?.map((o) => ({ ...o, onPick: () => { o.onPick(); update({ options: args.options?.map((p) => ({ ...p, on: p.id === o.id })) }); } }));
    return (
      <KitSheet width={1000} height={440} cam={{ x: 40, y: 96, z: 0.8 }}
        over={<><BoardBar name={typeof board === 'string' ? board : ''} seal={typeof seal === 'string' ? seal : undefined} zoom={0.8} {...BAR} /><BoardPop {...args} options={options} /></>}>
        <RetroPiece />
      </KitSheet>
    );
  }
} satisfies Meta<typeof BoardPop>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The seal's: who can add to the board, where it's saved, and that the notes can use it. */
export const Sealed: Story = {};
/** A room's board: only the room sees it, and it comes back to everyone when rooms close. */
export const SealedToThisRoom: Story = {
  name: 'Sealed to this room',
  args: {
    title: 'Sealed to this room',
    rows: [
      { icon: 'lock', text: 'Only the people in Comms can see this board.' },
      { icon: 'door', text: 'When rooms close it comes back to the main room, and everyone in the call sees it.' },
      { icon: 'sealed', text: 'Encrypted in storage.' }
    ]
  },
  parameters: { board: 'Comms board', seal: 'Sealed to this room' }
};
/** The board's name: rename it, where it's saved, who can add to it, and closing it for everyone. */
export const TheName: Story = {
  name: 'The name',
  args: {
    title: undefined, rows: undefined, label: 'Launch retro',
    items: [
      { id: 'rename', icon: 'pen', label: 'Rename', onPick: did('Rename') },
      { id: 'saved', icon: 'folderOpen', label: 'Saved in Product', onPick: did('Saved in Product') },
      { id: 'share', icon: 'people', label: 'Who can add to it', onPick: did('Who can add to it') },
      { id: 'close', icon: 'x', label: 'Close for everyone', onPick: did('Close for everyone') }
    ]
  }
};
/** A vote on a frame: how many votes each, and that nobody sees the count until it ends. */
export const Vote: Story = {
  args: {
    left: undefined, right: 14, top: 60, title: 'Vote on Could improve', rows: undefined,
    sub: 'Everyone gets 3 votes. Nobody sees the count until you end it.',
    options: choices(['3 votes', '5 votes', '10 votes'], '3 votes'),
    action: { label: 'Start the vote', onPick: did('Start the vote') }
  }
};
/** More: a link, the board as an image or a PDF, and Night board, a setting with a tick while it's on. */
export const More: Story = {
  args: {
    left: undefined, right: 14, top: 60, title: undefined, rows: undefined, label: 'More',
    items: [
      { id: 'link', icon: 'link', label: 'Copy link', onPick: did('Copy link') },
      { id: 'image', icon: 'download', label: 'Download as an image', onPick: did('Download as an image') },
      { id: 'pdf', icon: 'fileText', label: 'Download as a PDF', onPick: did('Download as a PDF') },
      { id: 'night', icon: 'moon', label: 'Night board', on: false, onPick: did('Night board') }
    ]
  }
};
/** More on a night board: Night board is ticked, as the frame's name menu in a call ticks it. */
export const MoreOnANightBoard: Story = {
  name: 'More, on a night board',
  args: {
    ...More.args,
    items: (More.args?.items ?? []).map((i) => (i.id === 'night' ? { ...i, on: true } : i))
  }
};
