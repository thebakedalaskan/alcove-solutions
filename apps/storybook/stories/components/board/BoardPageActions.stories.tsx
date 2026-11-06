/*
 * BoardPageActions: what a board's own page has that a call doesn't, at the top right beside the bar: who else is on the board
 * now, and Start a call here, which brings everyone on it into a call with the board open.
 */
import { BoardBar, BoardPageActions } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { FOLK } from '../../../src/world/boards';
import { BAR, KitSheet, RetroPiece } from './parts';

const meta = {
  title: 'Components/Board/BoardPageActions',
  component: BoardPageActions,
  args: { people: [FOLK.priya.person, FOLK.kofi.person], onCall: did('onCall') },
  argTypes: { people: { control: false } },
  render: (args) => (
    <KitSheet page width={1100} height={520} cam={{ x: 50, y: 80, z: 0.75 }} over={<BoardBar name="Launch retro" zoom={0.75} acts={false} {...BAR} />} after={<BoardPageActions {...args} />}>
      <RetroPiece />
    </KitSheet>
  )
} satisfies Meta<typeof BoardPageActions>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Priya and Kofi are on the board. */
export const PeopleHere: Story = { name: 'People here' };
/** Four people: two faces, and how many more. */
export const SeveralHere: Story = { name: 'Several here', args: { people: [FOLK.priya.person, FOLK.kofi.person, FOLK.maya.person, FOLK.lena.person] } };
/** Nobody else: just Start a call here. */
export const NobodyElse: Story = { name: 'Nobody else', args: { people: [] } };
