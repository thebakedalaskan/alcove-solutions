/*
 * RequestRef: a failed request's reference, to quote when reporting the problem. It finds that request's lines in the
 * server's log and says nothing about anyone. Pressing it copies it, and its icon becomes a tick. It sits under what went
 * wrong, in a notice or on the page a link couldn't open.
 */
import { Notice, RequestRef } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../../src/component';

const meta = {
  title: 'Components/Feedback/RequestRef',
  component: RequestRef,
  parameters: { layout: 'centered' },
  args: { id: 'q3Xv9LwT0aZk2PbN' }
} satisfies Meta<typeof RequestRef>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press it to copy the reference. */
export const Default: Story = {};
/** Under what went wrong, in a notice. */
export const InANotice: Story = {
  name: 'In a notice',
  render: (args) => (
    <Box width="min(420px, calc(100vw - 32px))" height="auto">
      <Notice tone="caution" icon="x">
        <span className="grid justify-items-start gap-1">
          <span>The call couldn’t be scheduled. Try again in a moment.</span>
          <RequestRef {...args} className="-ml-1.75" />
        </span>
      </Notice>
    </Box>
  )
};
/** A long reference in a narrow space: it ends in an ellipsis, and pressing it copies all of it. */
export const Long: Story = {
  args: { id: 'web-7f3a9c2b-41d0-4e8a-9b6c-2d5e8f1a3c47' },
  render: (args) => <Box width={200} height="auto"><RequestRef {...args} /></Box>
};
