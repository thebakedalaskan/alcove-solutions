/*
 * BoardShape: a rectangle, an ellipse, a diamond or a pill, drawn from its outline at its size (`shapePath` in the board
 * package), plain or in a sticky's colour, with words typed straight onto it. Drag to size, or click once for a standard
 * one. Here, the onboarding flow's steps.
 */
import { route, shapePath, type ShapeKind } from '@alcove/board';
import { BOARD_COLOURS, BoardLine, BoardLines, BoardShape, BoardSticky, BoardText } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KitSheet } from '../parts';

const meta = {
  title: 'Components/Board/Objects/BoardShape',
  component: BoardShape,
  args: { id: 's2', x: 0, y: 0, w: 170, h: 76, path: shapePath('rect', 170, 76), text: 'Verify email' },
  argTypes: { colour: { control: 'select', options: BOARD_COLOURS }, text: { control: 'text' }, path: { control: false }, editor: { control: false } },
  render: (args) => (
    <KitSheet width={320} height={240} cam={{ x: 60, y: 50, z: 1 }}>
      <BoardShape {...args} />
    </KitSheet>
  )
} satisfies Meta<typeof BoardShape>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A step. */
export const Rectangle: Story = {};
/** A choice, in butter. */
export const Diamond: Story = { args: { w: 180, h: 160, path: shapePath('diamond', 180, 160), colour: 'butter', text: 'Invited by a team?' } };
/** A start or an end, in sky. */
export const Pill: Story = { args: { path: shapePath('pill', 170, 76), colour: 'sky', text: 'Sign up' } };
/** An ellipse, in lilac. */
export const Ellipse: Story = { args: { w: 150, h: 110, path: shapePath('ellipse', 150, 110), colour: 'lilac', text: 'Welcome' } };

/** The onboarding flow, brought in from the workspace: a start, steps, a choice and a done, linked, with Aiko's question on the step people stop at. */
const FLOW: readonly { id: string; s: ShapeKind; text: string; x: number; y: number; w: number; h: number; colour?: 'sky' | 'butter' }[] = [
  { id: 's1', s: 'pill', text: 'Sign up', x: 0, y: 130, w: 170, h: 76, colour: 'sky' },
  { id: 's2', s: 'rect', text: 'Verify email', x: 240, y: 130, w: 170, h: 76 },
  { id: 's3', s: 'diamond', text: 'Invited by a team?', x: 480, y: 88, w: 180, h: 160, colour: 'butter' },
  { id: 's4', s: 'rect', text: 'Join their workspace', x: 740, y: 20, w: 190, h: 76 },
  { id: 's5', s: 'rect', text: 'Create a workspace', x: 740, y: 240, w: 190, h: 76 },
  { id: 's6', s: 'pill', text: 'Invite people', x: 1000, y: 240, w: 170, h: 76, colour: 'sky' }
];
const box = (id: string) => FLOW.find((f) => f.id === id) ?? { x: 0, y: 0, w: 0, h: 0 };
const LINKS = [['s1', 's2'], ['s2', 's3'], ['s3', 's4'], ['s3', 's5'], ['s5', 's6']].map(([a = '', b = '']) => ({ id: `${a}-${b}`, ...route(box(a), box(b), 'elbow') }));
export const AFlow: Story = {
  name: 'A flow',
  render: () => (
    <KitSheet width={760} height={360} cam={{ x: 24, y: 40, z: 0.62 }}>
      <BoardLines>{LINKS.map((l) => <BoardLine key={l.id} id={l.id} d={l.d} head={l.head} />)}</BoardLines>
      {FLOW.map((f) => <BoardShape key={f.id} id={f.id} x={f.x} y={f.y} w={f.w} h={f.h} path={shapePath(f.s, f.w, f.h)} colour={f.colour} text={f.text} />)}
      <BoardText id="yes" x={672} y={96} w={40} h={24} size="heading" text="Yes" />
      <BoardText id="no" x={672} y={226} w={40} h={24} size="heading" text="No" />
      <BoardSticky id="n1" x={250} y={260} w={150} h={150} colour="rose" text="Most people stop here. Can we skip it for invited people?" />
    </KitSheet>
  )
};
