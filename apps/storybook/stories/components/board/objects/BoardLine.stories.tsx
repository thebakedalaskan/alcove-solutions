/*
 * BoardLine: a line between two things, with its arrowhead, in the one drawing (BoardLines) every line and stroke shares.
 * Lines attach to what they join and find a clean route again when either end moves: an elbow with rounded corners, straight,
 * or a curve with no head. While one is drawn it's dots, and it settles as it's let go. Each route here is the board package's.
 */
import { freeRoute, route } from '@alcove/board';
import { BoardLine, BoardLines, BoardSticky } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KitSheet } from '../parts';

const STALE = { x: 0, y: 120, w: 150, h: 150 }, REFRESH = { x: 320, y: 30, w: 150, h: 150 };
const ELBOW = route(STALE, REFRESH, 'elbow');

const meta = {
  title: 'Components/Board/Objects/BoardLine',
  component: BoardLine,
  subcomponents: { BoardLines },
  args: { id: 'l1', d: ELBOW.d, head: ELBOW.head, selected: false, draft: false, settle: false },
  argTypes: { d: { control: false }, head: { control: false } },
  render: (args) => (
    <KitSheet width={600} height={360} cam={{ x: 60, y: 30, z: 1 }}>
      <BoardLines><BoardLine {...args} /></BoardLines>
      <BoardSticky id="stale" {...STALE} colour="rose" text="Staging data was two days stale" />
      <BoardSticky id="refresh" {...REFRESH} colour="sky" text="Refresh staging every night" />
    </KitSheet>
  )
} satisfies Meta<typeof BoardLine>;
export default meta;
type Story = StoryObj<typeof meta>;

const STRAIGHT = route(STALE, REFRESH, 'straight'), CURVE = route(STALE, REFRESH, 'curve');
const DRAFT = freeRoute(STALE, [292, 92], 'elbow');

/** An elbow, the usual line: it leaves one edge and arrives at another, with rounded corners. */
export const Elbow: Story = {};
/** Straight, with its head turned along it. */
export const Straight: Story = { args: { d: STRAIGHT.d, head: STRAIGHT.head } };
/** A curve, which leaves and arrives square to its edges, and has no head. */
export const Curve: Story = { args: { d: CURVE.d, head: undefined } };
/** Picked: in the focus colour, with the selection bar's line styles to change it. */
export const Picked: Story = { args: { selected: true } };
/** Being drawn from a sticky's dot: dots that follow the pointer, until it's let go on what it joins. */
export const BeingDrawn: Story = { name: 'Being drawn', args: { id: undefined, d: DRAFT.d, head: DRAFT.head, draft: true } };
