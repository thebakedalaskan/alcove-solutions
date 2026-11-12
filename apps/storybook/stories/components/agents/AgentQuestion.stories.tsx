/*
 * AgentQuestion: something to ask an agent, with the mark of the row it will make in what your agents did, and Copy. Once
 * an agent is connected, a line says which of your agents can do it (with a tick), or what they can't.
 */
import { AgentQuestion } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { onTheWater } from './frames';

const meta = {
  title: 'Components/Agents/AgentQuestion',
  component: AgentQuestion,
  decorators: [onTheWater],
  args: { icon: 'ask', tone: 'quiet', question: 'What did we decide about the launch?', sub: 'Claude and Cursor can do this', can: true, onCopy: did('onCopy') },
  argTypes: { tone: { control: 'inline-radio', options: ['quiet', 'time', 'follow', 'decision'] } },
  render: (args) => <ul className="ag-qs" style={{ maxWidth: 440 }}><AgentQuestion {...args} /></ul>
} satisfies Meta<typeof AgentQuestion>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Claude and Cursor can do this. */
export const SomeoneCan: Story = { name: 'Someone can' };
/** Claude isn't allowed to book calls: the question says so. Booking takes the colour of time, as the booked call will. */
export const TheyCant: Story = { name: 'They can’t', args: { icon: 'calCheck', tone: 'time', question: 'Book 45 minutes with Priya and Kofi next week.', sub: 'Claude can’t book calls', can: false } };
/** Nothing connected yet: nobody to say can or can't, so just the question and its mark. */
export const NothingConnected: Story = { name: 'Nothing connected', args: { icon: 'circleCheck', tone: 'follow', question: 'Add a follow-up for Kofi from my last call.', sub: undefined, can: false } };
