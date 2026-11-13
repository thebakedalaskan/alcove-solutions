/*
 * BoardLink: something from the board's workspace, put on it from More as a card. It keeps only the item's id, so each person
 * sees it by their own name for it, with Open for whoever can open it; someone who can't is told so, and nothing of its name.
 */
import { BoardFrame, BoardLink } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../../src/component';
import { KitSheet } from '../parts';

const meta = {
  title: 'Components/Board/Objects/BoardLink',
  component: BoardLink,
  args: { id: 'link1', x: 30, y: 60, w: 300, h: 76, name: 'Launch plan', kind: 'document', onOpen: did('onOpen') },
  argTypes: { name: { control: 'text' }, kind: { control: 'inline-radio', options: ['document', 'board'] } },
  render: (args) => (
    <KitSheet width={480} height={260} cam={{ x: 50, y: 40, z: 1 }}>
      <BoardFrame id="act" x={0} y={0} w={360} h={170} title="Actions" sub="1" />
      <BoardLink {...args} />
    </KitSheet>
  )
} satisfies Meta<typeof BoardLink>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A document from the workspace, in Actions, by your name for it. */
export const ADocument: Story = { name: 'A document' };
/** Another board. */
export const ABoard: Story = { name: 'A board', args: { kind: 'board', name: 'Onboarding flow' } };
/** For someone who can't open it: it says so, with a lock, and nothing of its name. */
export const YouCantOpenIt: Story = { name: 'You can’t open it', args: { name: null } };
/** Picked. */
export const Picked: Story = { args: { selected: true } };
