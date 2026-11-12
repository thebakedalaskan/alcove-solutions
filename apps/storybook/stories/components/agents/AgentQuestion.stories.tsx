/*
 * AgentQuestion: something to ask an agent, with which of your agents can do it (with a tick) or what it needs, and Copy.
 */
import { AgentQuestion } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { onTheWater } from './frames';

const meta = {
  title: 'Components/Agents/AgentQuestion',
  component: AgentQuestion,
  decorators: [onTheWater],
  args: { question: 'What did we decide about the launch?', sub: 'Claude and Cursor can do this', can: true, onCopy: did('onCopy') },
  render: (args) => <ul className="ag-qs" style={{ maxWidth: 360 }}><AgentQuestion {...args} /></ul>
} satisfies Meta<typeof AgentQuestion>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Claude and Cursor can do this. */
export const SomeoneCan: Story = { name: 'Someone can' };
/** None of your agents can book calls yet. */
export const ItNeedsMore: Story = { name: 'It needs more', args: { question: 'Book 45 minutes with Priya and Kofi next week.', sub: 'Needs book calls', can: false } };
