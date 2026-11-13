/*
 * BoardStroke: a stroke of the pen, for circling, underlining and quick sketches. Strokes smooth out as they're drawn. The
 * pen draws in the focus colour; the highlighter is wide and see-through, in sun; a stroke can also be rose. Picked, it takes
 * the focus colour.
 */
import { BoardLines, BoardSticky, BoardStroke } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KitSheet } from '../parts';

/** The design canvas's pen stroke, and a ring drawn round a sticky. */
const SQUIGGLE = 'M40 150C70 100 100 190 134 134S190 96 214 140S276 172 300 112';
const RING = 'M40 52C90 6 230 0 262 70C292 136 238 214 140 222C46 230 0 170 16 112C26 76 52 56 92 44';
const UNDER = 'M46 182C110 172 190 186 300 172';

const meta = {
  title: 'Components/Board/Objects/BoardStroke',
  component: BoardStroke,
  args: { id: 'p1', d: SQUIGGLE, colour: 'horizon', marker: false, selected: false },
  argTypes: { d: { control: false }, colour: { control: 'inline-radio', options: ['horizon', 'sun', 'rose'] } },
  render: (args) => (
    <KitSheet width={400} height={260} cam={{ x: 30, y: 10, z: 1 }}>
      <BoardLines><BoardStroke {...args} /></BoardLines>
    </KitSheet>
  )
} satisfies Meta<typeof BoardStroke>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The pen. */
export const Pen: Story = {};
/** The highlighter: wide, and see-through. */
export const Highlighter: Story = { args: { d: UNDER, colour: 'sun', marker: true } };
/** Rose. */
export const Rose: Story = { args: { colour: 'rose' } };
/** Picked. */
export const Picked: Story = { args: { selected: true } };
/** Circling one of Could improve's stickies, and highlighting under the one beside it. */
export const OnTheBoard: Story = {
  name: 'On the board',
  render: () => (
    <KitSheet width={560} height={320} cam={{ x: 40, y: 40, z: 1 }}>
      <BoardSticky id="f2" x={60} y={40} w={150} h={150} colour="rose" text="Staging data was two days stale" />
      <BoardSticky id="f5" x={300} y={40} w={150} h={150} colour="rose" text="QA found the billing bug on launch day" />
      <BoardLines>
        <BoardStroke id="ring" d={RING} />
        <BoardStroke id="under" d="M300 214C350 206 400 218 450 210" colour="sun" marker />
      </BoardLines>
    </KitSheet>
  )
};
