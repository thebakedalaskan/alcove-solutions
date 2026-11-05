/*
 * Spinner: something is on its way. It sits where an icon would, in a button that's busy or before a line that says
 * what's being waited for, and takes the colour of the text around it.
 */
import { Spinner } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/Spinner',
  component: Spinner,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof Spinner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Before the line that says what's being waited for, in that line's colour. */
export const BeforeALine: Story = {
  name: 'Before a line',
  render: () => <p className="flex items-center gap-2.5 text-ink-2"><Spinner />Asked to join. Waiting for Art to let you in.</p>
};
