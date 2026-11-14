/*
 * BoardNode: an idea in a mind map from More. The first one, which the map starts from, is the larger; each branch comes off
 * the idea it grew from, its line drawn from that idea's right edge. The one being typed in holds the board's own field.
 */
import { NODE } from '@alcove/board';
import { BoardEdit, BoardLines, BoardNode } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KitSheet } from '../parts';

const LAUNCH = { x: 20, y: 92, ...NODE.first };
const BRANCHES = [{ id: 'n2', text: 'Pricing', y: 40 }, { id: 'n3', text: 'Press', y: 116 }, { id: 'n4', text: 'Support', y: 192 }].map((b) => ({ ...b, x: LAUNCH.x + LAUNCH.w + 72, ...NODE.branch }));
/** A branch's line, as the board draws it: from the right of the idea it grew from to the left of the branch. */
const branch = (to: { x: number; y: number; h: number }): string => {
  const x0 = LAUNCH.x + LAUNCH.w, y0 = LAUNCH.y + LAUNCH.h / 2, y1 = to.y + to.h / 2, bend = Math.max(24, (to.x - x0) / 2);
  return `M${x0} ${y0} C${x0 + bend} ${y0} ${to.x - bend} ${y1} ${to.x} ${y1}`;
};

const meta = {
  title: 'Components/Board/Objects/BoardNode',
  component: BoardNode,
  args: { id: 'n1', ...LAUNCH, text: 'Launch', first: true },
  argTypes: { text: { control: 'text' }, editor: { control: false } },
  render: (args) => (
    <KitSheet width={640} height={320} cam={{ x: 40, y: 30, z: 1 }}>
      <BoardLines>{BRANCHES.map((b) => <path key={b.id} className="branch" d={branch(b)} />)}</BoardLines>
      <BoardNode {...args} />
      {BRANCHES.map((b) => <BoardNode key={b.id} id={b.id} x={b.x} y={b.y} w={b.w} h={b.h} text={b.text} />)}
    </KitSheet>
  )
} satisfies Meta<typeof BoardNode>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Launch, with three branches: Tab branches from an idea, and Enter adds another branch beside the one you're in. */
export const AMindMap: Story = { name: 'A mind map' };
/** Just added from More: the first idea, open to type in. */
export const Typing: Story = { args: { text: '', editor: <BoardEdit label="Idea" defaultValue="Launch" /> } };
/** Picked. */
export const Picked: Story = { args: { selected: true } };
