/*
 * BoardHeard: the call has heard something worth keeping on the board, and says so at the bottom of the sheet, then waits.
 * Pressing it opens what it heard (BoardTray); nothing goes on the board until someone adds it.
 */
import { BoardHeard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { KitSheet, RetroPiece } from './parts';

const meta = {
  title: 'Components/Board/BoardHeard',
  component: BoardHeard,
  args: { count: 3, onOpen: did('onOpen') },
  argTypes: { count: { control: { type: 'number', min: 1 } } },
  render: (args) => (
    <KitSheet width={1000} height={420} cam={{ x: 40, y: 30, z: 0.8 }} over={<BoardHeard {...args} />}>
      <RetroPiece />
    </KitSheet>
  )
} satisfies Meta<typeof BoardHeard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Three ideas, from Priya, Kofi and Maya. */
export const ThreeIdeas: Story = { name: 'Three ideas' };
/** One idea. */
export const OneIdea: Story = { name: 'One idea', args: { count: 1 } };
