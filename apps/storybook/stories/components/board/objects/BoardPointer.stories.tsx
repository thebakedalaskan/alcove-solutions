/*
 * BoardPointer: someone else's pointer, with their face in the arch and their name, never told apart by colour alone. Whoever
 * is talking glows with the same ring as their tile, and dots show who's typing. It stays one size whatever the zoom.
 */
import { BoardPointer, BoardSticky } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FOLK } from '../../../../src/world/boards';
import { KitSheet, RetroPiece } from '../parts';

const { theo, priya, maya, kofi, lena } = FOLK;

const meta = {
  title: 'Components/Board/Objects/BoardPointer',
  component: BoardPointer,
  args: { x: 150, y: 90, person: theo.person, name: theo.name, colour: theo.colour, talking: false, typing: false },
  argTypes: { person: { control: false }, name: { control: 'text' }, colour: { control: 'color' } },
  render: (args) => <KitSheet width={360} height={220} pointers={<BoardPointer {...args} />} />
} satisfies Meta<typeof BoardPointer>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Theo, quiet. */
export const Quiet: Story = {};
/** Priya is talking, so Priya's pointer glows with the same ring as their tile. */
export const Talking: Story = { args: { person: priya.person, name: priya.name, colour: priya.colour, talking: true } };
/** Maya is typing in the sticky under her pointer: her colour goes round it, and dots show on her pointer. */
export const Typing: Story = {
  args: { x: 196, y: 128, person: maya.person, name: maya.name, colour: maya.colour, typing: true },
  render: (args) => (
    <KitSheet width={360} height={240} pointers={<BoardPointer {...args} />}>
      <BoardSticky id="h3" x={102} y={40} w={118} h={118} size="s" colour="sky" text="Name a status page" other={maya.colour} />
    </KitSheet>
  )
};
/** Everyone on the launch retro, zoomed out: each pointer stays the size it is at 100%. */
export const ZoomedOut: Story = {
  name: 'Zoomed out',
  render: () => (
    <KitSheet width={560} height={380} cam={{ x: 40, y: 30, z: 0.6 }}
      pointers={(
        <>
          <BoardPointer x={190} y={214} person={priya.person} name={priya.name} colour={priya.colour} talking />
          <BoardPointer x={190} y={416} person={kofi.person} name={kofi.name} colour={kofi.colour} />
          <BoardPointer x={560} y={90} person={maya.person} name={maya.name} colour={maya.colour} />
          <BoardPointer x={600} y={440} person={lena.person} name={lena.name} colour={lena.colour} />
        </>
      )}>
      <RetroPiece />
    </KitSheet>
  )
};
