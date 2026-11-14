/*
 * BoardSelectionBox: the ring round what's picked, in screen pixels so it never scales with the board, with a handle at each
 * corner when one thing that can be sized is picked. BoardDots are the four a line starts from, just off each edge so they're
 * easy to grab: hovering anything shows them. BoardMarquee is the box dragged out to pick several, and BoardGuide the line a
 * move has lined up with. Each sits where the surface would put it.
 */
import { BoardDots, BoardGuide, BoardMarquee, BoardSelectionBox, BoardSticky } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { F1, KitSheet, RetroPiece, pickedAt, slot } from '../parts';

const CAM = { x: 40, y: 50, z: 0.8 };
const W = 760, H = 480;
const ONE = pickedAt(F1, CAM);

const meta = {
  title: 'Components/Board/Tools/BoardSelectionBox',
  component: BoardSelectionBox,
  subcomponents: { BoardDots, BoardMarquee, BoardGuide },
  args: { ...ONE.ring, handles: true },
  render: (args) => (
    <KitSheet width={W} height={H} cam={CAM} over={<><BoardSelectionBox {...args} /><BoardDots points={ONE.dots} /></>}>
      <RetroPiece picked="f1" />
    </KitSheet>
  )
} satisfies Meta<typeof BoardSelectionBox>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One sticky picked: handles to size it, and the dots to draw a line from it. */
export const OnePicked: Story = { name: 'One picked' };

/** Hovering a sticky: four dots, just off its edges, show where a line can start. Nothing is picked. */
const HOVERED = pickedAt(slot(0, 0, 0), CAM);
export const Hovering: Story = {
  render: () => (
    <KitSheet width={W} height={H} cam={CAM} over={<BoardDots points={HOVERED.dots} />}>
      <RetroPiece />
    </KitSheet>
  )
};

/** Two picked: one ring round both, and no handles, since sizing is for one thing at a time. */
const BOTH = pickedAt({ x: F1.x - 170, y: F1.y, w: 320, h: 150 }, CAM);
export const TwoPicked: Story = {
  name: 'Two picked',
  args: { ...BOTH.ring, handles: false },
  render: (args) => (
    <KitSheet width={W} height={H} cam={CAM} over={<BoardSelectionBox {...args} />}>
      <RetroPiece />
    </KitSheet>
  )
};

/** Dragging out a box over three stickies: what it touches is picked as it goes. */
const DRAGGED = { x: CAM.x + 6 * CAM.z, y: CAM.y + 6 * CAM.z, w: 300 * CAM.z, h: 300 * CAM.z };
const TOUCHED = pickedAt({ x: 20, y: 20, w: 320, h: 320 }, CAM);
export const DraggingABox: Story = {
  name: 'Dragging a box',
  args: { ...TOUCHED.ring, handles: false },
  render: (args) => (
    <KitSheet width={W} height={H} cam={CAM} over={<><BoardSelectionBox {...args} /><BoardMarquee {...DRAGGED} /></>}>
      <RetroPiece />
    </KitSheet>
  )
};

/** Moving Kofi's sticky into Actions: it's picked up, and lines up with the top and bottom of the one beside it. */
const MOVED = { x: 590, y: 190, w: 150, h: 150 };
const MOVING = pickedAt(MOVED, CAM);
export const LiningUp: Story = {
  name: 'Lining up',
  args: MOVING.ring,
  render: (args) => (
    <KitSheet width={W} height={H} cam={CAM}
      over={<><BoardSelectionBox {...args} /><BoardGuide axis="y" at={CAM.y + MOVED.y * CAM.z} /><BoardGuide axis="y" at={CAM.y + (MOVED.y + MOVED.h) * CAM.z} /></>}>
      <RetroPiece hide={['f2']} />
      <BoardSticky id="f2" {...MOVED} colour="rose" text="Staging data was two days stale" selected lift />
    </KitSheet>
  )
};
