/*
 * EmptyState: what a list or page shows before there's anything in it, so none is ever blank: the empty arch, a title
 * that says what will appear, one line, and the way forward in `action`. `art` takes other art, or `null` where a
 * panel is too small for the arch.
 */
import { Button, Card, EmptyState } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../src/component';

const meta = {
  title: 'Components/Feedback/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  args: { title: 'Nothing needs you', children: 'Decisions to confirm and follow-ups show up here after your calls.' },
  argTypes: { title: { control: 'text' }, children: { control: 'text' }, action: { control: false }, art: { control: false } }
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Home, when nothing is waiting on you. */
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
/** No arch in a small panel: Home's Coming up, with nothing scheduled. */
export const InASmallPanel: Story = {
  name: 'In a small panel',
  args: { title: 'Nothing coming up', children: 'The calls you schedule show up here.', art: null },
  render: (args) => <Card title="Coming up" style={{ width: 320 }}><EmptyState {...args} /></Card>
};
/** A long title wraps under the arch, centred. */
export const LongTitle: Story = {
  name: 'Long title',
  args: { title: 'Nothing matches “who tells existing customers about the new onboarding”', children: 'That covers titles, summaries and everything said.' },
  render: (args) => <Box width="min(420px, calc(100vw - 32px))" height="auto"><EmptyState {...args} /></Box>
};
