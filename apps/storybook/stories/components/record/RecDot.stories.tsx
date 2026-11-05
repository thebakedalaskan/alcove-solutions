/*
 * RecDot: the pulsing dot that only ever means notes or recording. It's the notes sign's own dot, and it stands on its
 * own before a line that says what's being recorded, such as a note that's still recording.
 */
import { RecDot } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Record/RecDot',
  component: RecDot,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof RecDot>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Before a line, as a note's page says it's still recording. */
export const BeforeALine: Story = { name: 'Before a line', render: () => <span className="nd-rec"><RecDot />Still recording</span> };
