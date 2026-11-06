/*
 * BoardTray: the ideas the call heard, each with who said it and when, written in confidential compute. Each can be added on
 * its own, or all at once, and says Added once it's on the board. Press Add.
 */
import { BoardTray, type BoardIdea } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { FOLK } from '../../../src/world/boards';
import { KitSheet, RetroPiece } from './parts';

/** What the call heard in the launch retro, in the design canvas's words. */
const HEARD: BoardIdea[] = [
  { id: 'h1', person: FOLK.priya.person, text: 'The changelog should go out before the post, not after.', sub: 'Priya, 2 min ago' },
  { id: 'h2', person: FOLK.kofi.person, text: 'Let’s check staging the day before every launch.', sub: 'Kofi, 1 min ago' },
  { id: 'h3', person: FOLK.maya.person, text: 'Someone has to own the status page on the day.', sub: 'Maya, just now' }
];

const meta = {
  title: 'Components/Board/BoardTray',
  component: BoardTray,
  args: { ideas: HEARD, onClose: did('onClose'), onAdd: did('onAdd'), onAddAll: did('onAddAll') },
  argTypes: { ideas: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const tray = (
      <BoardTray {...args}
        onAdd={(id) => { args.onAdd(id); update({ ideas: args.ideas.map((i) => (i.id === id ? { ...i, added: true } : i)) }); }}
        onAddAll={() => { args.onAddAll(); update({ ideas: args.ideas.map((i) => ({ ...i, added: true })) }); }} />
    );
    return (
      <KitSheet width={1000} height={480} cam={{ x: 40, y: 30, z: 0.8 }} over={tray}>
        <RetroPiece />
      </KitSheet>
    );
  }
} satisfies Meta<typeof BoardTray>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Three ideas, and Add all three. */
export const ThreeIdeas: Story = { name: 'Three ideas' };
/** Priya's is on the board already. */
export const OneAdded: Story = { name: 'One added', args: { ideas: HEARD.map((i) => (i.id === 'h1' ? { ...i, added: true } : i)) } };
/** Two ideas, and Add both. */
export const TwoIdeas: Story = { name: 'Two ideas', args: { ideas: HEARD.slice(1) } };
/** One idea has no Add all. */
export const OneIdea: Story = { name: 'One idea', args: { ideas: HEARD.slice(2) } };
