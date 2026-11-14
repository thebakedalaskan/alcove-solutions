/*
 * RequestRef: a reference to quote when reporting a problem. A failed request's finds that request's lines in the server's
 * log; a payment's, its top-up's ID, finds the top-up. Neither says anything about anyone. Pressing it copies it, and its
 * icon becomes a tick. It sits under what went wrong: in a notice, or on the page that didn't load, a link couldn't open or
 * a call that's gone. A payment's sits under it from the moment it's opened, and on Done's receipt. A long one wraps.
 */
import { Notice, RequestRef } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../../src/component';
import { PREVIEW_TOP_UP } from '../../../src/world/plans/payments';

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
/** A payment's reference: its top-up's ID, all 22 characters, to give support while it waits and after. */
export const APayment: Story = { name: 'A payment', args: { id: PREVIEW_TOP_UP } };
/** A long reference in a narrow space: it wraps, so all of it can be read, and pressing it copies all of it. */
export const Long: Story = {
  args: { id: 'web-7f3a9c2b-41d0-4e8a-9b6c-2d5e8f1a3c47' },
  render: (args) => <Box width={200} height="auto"><RequestRef {...args} /></Box>
};
