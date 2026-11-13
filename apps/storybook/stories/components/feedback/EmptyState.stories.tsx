/*
 * EmptyState: what a list or page shows before there's anything in it, so none is ever blank: the empty arch, a title
 * that says what will appear, one line, and the way forward in `action`. `art` takes other art, or `null` where a
 * panel is too small for the arch. `role="status"` when it says something went wrong, so it's read out as it appears.
 */
import { Button, Card, EmptyState } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../src/component';

const meta = {
  title: 'Components/Feedback/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  args: { title: 'No documents to bring yet', children: 'Documents from your workspace show here, ready to bring to a call.' },
  argTypes: { title: { control: 'text' }, children: { control: 'text' }, role: { control: false }, action: { control: false }, art: { control: false } }
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A call's documents, before the workspace has any to bring. */
export const Default: Story = {};
/** The way forward: the notes list before any call has had notes. */
export const WithAnAction: Story = {
  name: 'With an action',
  args: {
    title: 'No notes yet',
    children: 'Calls with notes on land here as soon as they end.',
    action: <Button variant="primary" icon="video" onClick={did('onClick')}>Start a call</Button>
  }
};
/** No arch in a small panel: a call's questions, before anyone has asked one. */
export const InASmallPanel: Story = {
  name: 'In a small panel',
  args: { title: 'No questions yet', children: 'Ask everyone in this room. The questions with the most votes come first.', art: null },
  render: (args) => <Card title="Questions" style={{ width: 320 }}><EmptyState {...args} /></Card>
};
/** Something didn't load: said as it happens (`role="status"`), with the way to try again. */
export const SomethingWentWrong: Story = {
  name: 'Something went wrong',
  args: {
    title: 'Documents can’t be read just now',
    children: 'The call works without them. Try again in a moment.',
    role: 'status',
    action: <Button icon="retry" onClick={did('onRetry')}>Try again</Button>
  }
};
/** A long title wraps under the arch, centred. */
export const LongTitle: Story = {
  name: 'Long title',
  args: { title: 'Nothing matches “who tells existing customers about the new onboarding”', children: 'That covers titles, summaries and everything said.' },
  render: (args) => <Box width="min(420px, calc(100vw - 32px))" height="auto"><EmptyState {...args} /></Box>
};
