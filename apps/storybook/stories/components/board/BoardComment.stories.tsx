/*
 * BoardComment: a comment pinned to something on the board, with the face of whoever started the thread on the pin, its point on
 * the top right corner of what it's on, and how many have replied since. Comments don't clutter the board: the pin is all that
 * shows until it's pressed. On the board the pin opens the thread in the workspace's comment sheet; the canvas's tools sheet draws
 * the first message beside it instead, which is `open`. It sits with the pointers, so it stays one size whatever the zoom.
 */
import { BoardComment, BoardSticky } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { FOLK } from '../../../src/world/boards';
import { KitSheet, RetroPiece } from './parts';

/** The canvas's sticky, and the corner a pin's point goes on. */
const STICKY = { x: 26, y: 62, w: 118, h: 118 };
const CORNER = { x: STICKY.x + STICKY.w, y: STICKY.y };

const meta = {
  title: 'Components/Board/BoardComment',
  component: BoardComment,
  args: { id: 'c1', ...CORNER, person: FOLK.maya.person, name: 'Maya', text: 'Kofi did last time. Worth writing down?', count: 0, open: false, onOpen: did('onOpen') },
  argTypes: { person: { control: false }, name: { control: 'text' }, text: { control: 'text' }, count: { control: { type: 'number', min: 0 } } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <KitSheet width={380} height={240} pointers={<BoardComment {...args} onOpen={(id) => { args.onOpen?.(id); update({ open: !args.open }); }} />}>
        <BoardSticky id="w6" {...STICKY} size="s" colour="peach" text="Who writes the changelog?" />
      </KitSheet>
    );
  }
} satisfies Meta<typeof BoardComment>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Maya's comment on the sticky: her face on the pin, and nothing else until it's pressed. */
export const APin: Story = { name: 'A pin' };
/** With replies since: how many, on the pin, which a screen reader hears with her name. */
export const WithReplies: Story = { name: 'With replies', args: { count: 2 } };
/** Open, as the canvas's tools sheet draws it: what she said, beside the pin. */
export const Open: Story = { args: { open: true } };

/** Zoomed out on the launch retro, the pins stay the size they are at 100%, like the pointers, so they can still be pressed. */
export const ZoomedOut: Story = {
  name: 'Zoomed out',
  render: () => (
    <KitSheet width={560} height={380} cam={{ x: 40, y: 30, z: 0.6 }}
      pointers={(
        <>
          <BoardComment id="c1" x={340} y={20} person={FOLK.maya.person} name="Maya" text="Kofi did last time. Worth writing down?" count={1} />
          <BoardComment id="c2" x={570} y={190} person={FOLK.kofi.person} name="Kofi" text="The nightly job is already there, just switched off." />
        </>
      )}>
      <RetroPiece />
    </KitSheet>
  )
};
