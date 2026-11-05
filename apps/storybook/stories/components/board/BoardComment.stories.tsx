/*
 * BoardComment: a comment pinned to a sticky, with their face on the pin. Comments don't clutter the board: pressing the pin
 * shows what they said beside it, and pressing it again puts it away. The surface doesn't draw a board's comments yet: this is
 * the part it will draw them with.
 */
import { BoardComment, BoardSticky } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { FOLK } from '../../../src/world/boards';
import { KitSheet } from './parts';

const meta = {
  title: 'Components/Board/BoardComment',
  component: BoardComment,
  args: { id: 'c1', x: 134, y: 46, person: FOLK.maya.person, name: 'Maya', text: 'Kofi did last time. Worth writing down?', open: true, onOpen: did('onOpen') },
  argTypes: { person: { control: false }, name: { control: 'text' }, text: { control: 'text' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <KitSheet width={380} height={240}>
        <BoardSticky id="w6" x={26} y={62} w={118} h={118} size="s" colour="peach" text="Who writes the changelog?" />
        <BoardComment {...args} onOpen={(id) => { args.onOpen?.(id); update({ open: !args.open }); }} />
      </KitSheet>
    );
  }
} satisfies Meta<typeof BoardComment>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Open: Maya asks who writes the changelog. */
export const Open: Story = {};
/** Put away: just her face on the pin. */
export const Closed: Story = { args: { open: false } };
