/*
 * BoardTile: the board as a live tile in the call's grid, so faces can stay big. It's a picture drawn small from the board at
 * its full size, keeping up as people work, with whose board it is; pressing it opens the board. Beside a big
 * share it sits above the faces, as wide as their column.
 */
import { BoardTile } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did, onStage } from '../../../src/component';
import { FOLK } from '../../../src/world/boards';
import { KitSheet, RetroPiece } from './parts';

/** The board at the size the call draws it, as a picture that can't be pressed. */
const PICTURE = (
  <KitSheet width={1120} height={700} cam={{ x: 123, y: 64, z: 1.15 }} sheet={{ mini: true, clean: true }}>
    <RetroPiece />
  </KitSheet>
);

const meta = {
  title: 'Components/Board/BoardTile',
  component: BoardTile,
  ...onStage,
  args: { person: FOLK.art.person, name: 'Art’s board', label: 'Open the board', w: 1120, h: 700, scale: 0.5, compact: false, onOpen: did('onOpen'), children: PICTURE },
  argTypes: { person: { control: false }, children: { control: false }, style: { control: false }, name: { control: 'text' }, label: { control: 'text' } },
  render: (args) => <div className="sbb-tile"><BoardTile {...args} /></div>
} satisfies Meta<typeof BoardTile>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Art opened the launch retro, and Priya dropped it to a tile to keep faces big. */
export const ALiveTile: Story = { name: 'A live tile' };
/** Above the faces beside a big share, as wide as their column. */
export const BesideAShare: Story = {
  name: 'Beside a share',
  args: { compact: true, scale: 380 / 1120, style: { height: 214 } },
  render: (args) => <div className="sbb-column"><BoardTile {...args} /></div>
};
