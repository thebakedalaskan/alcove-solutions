/*
 * AgentNone: what your agents did while there's nothing in it, as one row where the first will be. Its mark is an empty
 * window waiting for an agent, or caution when it didn't load, with Try again at its end.
 */
import { AgentNone, Button } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { onTheWater } from './frames';

const meta = {
  title: 'Components/Agents/AgentNone',
  component: AgentNone,
  decorators: [onTheWater],
  args: { title: 'Nothing yet', children: 'What Claude reads and changes in Alcove shows here, newest first.' },
  argTypes: { children: { control: 'text' }, action: { control: false } }
} satisfies Meta<typeof AgentNone>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Claude just connected: nothing yet. */
export const NothingYet: Story = { name: 'Nothing yet' };
/** Several agents connected, none used yet. */
export const NothingYetFromAny: Story = { name: 'Nothing yet, several agents', args: { children: 'What your agents read and change in Alcove shows here, newest first.' } };
/** What they did didn't load: why, and Try again at the row's end. */
export const DidntLoad: Story = {
  name: 'Didn’t load',
  args: { problem: true, title: 'Didn’t load', children: 'Alcove couldn’t reach the server.', action: <Button variant="quiet" size="sm" icon="retry" onClick={did('onRetry')}>Try again</Button> }
};
