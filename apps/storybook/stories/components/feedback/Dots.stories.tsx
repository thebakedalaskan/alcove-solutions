/*
 * Dots: three dots that rise and fade in turn, for "listening" and other waits. They take the text's colour, so they sit
 * in a line of words that says what's being waited for.
 */
import { Dots } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/Dots',
  component: Dots,
  parameters: { layout: 'centered' },
  argTypes: { className: { control: false } }
} satisfies Meta<typeof Dots>;
export default meta;
type Story = StoryObj<typeof meta>;

/** On their own, where a list is on its way. */
export const Waiting: Story = { render: (args) => <span className="text-ink-3"><Dots {...args} /></span> };
/** In a line that says what's being waited for, as the leave sheet does while notes are written. */
export const InAStatusLine: Story = {
  name: 'In a status line',
  render: (args) => <p className="flex items-center gap-2.5 text-[13.5px] text-ink-3" role="status"><Dots {...args} />Writing in confidential compute</p>
};
