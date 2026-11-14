/*
 * BoardMap: where you are on a board too big for the sheet, from the bar's Map: its frames in miniature, and a box for what
 * the sheet shows. Looking somewhere off the board, the map grows to take in where you are.
 */
import { BoardBar, BoardMap, type BoardBox, type BoardCamera } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BAR, KitSheet, RetroPiece } from '../parts';

const W = 1000, H = 440;
/** What the sheet shows at `cam`, in board units, as the surface works it out. */
const viewAt = ({ x, y, z }: BoardCamera): BoardBox => ({ x: -x / z, y: -y / z, w: W / z, h: H / z });
/** The retro piece's frames, and all of it. */
const FRAMES: BoardBox[] = [{ x: 0, y: 0, w: 360, h: 530 }, { x: 400, y: 0, w: 360, h: 530 }];
const BOUNDS: BoardBox = { x: 0, y: 0, w: 760, h: 530 };
const CLOSE: BoardCamera = { x: 20, y: 100, z: 1.4 }, AWAY: BoardCamera = { x: -900, y: 20, z: 0.9 };

const meta = {
  title: 'Components/Board/Tools/BoardMap',
  component: BoardMap,
  args: { blocks: FRAMES, bounds: BOUNDS, view: viewAt(CLOSE) },
  argTypes: { blocks: { control: false }, bounds: { control: false }, view: { control: false } },
  render: (args, { parameters }) => {
    const at = parameters['looking'] === 'away' ? AWAY : CLOSE;
    return (
      <KitSheet width={W} height={H} cam={at} over={<><BoardBar name="Launch retro" zoom={at.z} mapOn {...BAR} /><BoardMap {...args} /></>}>
        <RetroPiece />
      </KitSheet>
    );
  }
} satisfies Meta<typeof BoardMap>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Zoomed in on Could improve: the box sits over its frame. */
export const ZoomedIn: Story = { name: 'Zoomed in' };
/** Looking at empty board to the right of everything: the map takes in both, so you can see the way back. */
export const OffTheBoard: Story = { name: 'Off the board', args: { view: viewAt(AWAY) }, parameters: { looking: 'away' } };
