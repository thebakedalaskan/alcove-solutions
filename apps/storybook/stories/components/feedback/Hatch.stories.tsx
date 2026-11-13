/*
 * Hatch: a small square of hatching, your own time, as scheduling's week hatches the time you're busy. It marks a calendar
 * event with only you on it: before its title in Home's Upcoming, and on Upcoming's count of them at its foot.
 */
import { Hatch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/Hatch',
  component: Hatch,
  argTypes: { className: { control: false } },
  parameters: { layout: 'centered' }
} satisfies Meta<typeof Hatch>;
export default meta;
type Story = StoryObj<typeof meta>;

/** On its own. */
export const Default: Story = {};
/** Before an event's title, as Upcoming lists an event with only you on it. */
export const BeforeATitle: Story = {
  name: 'Before a title',
  render: () => <span className="hm-ev-own" style={{ display: 'inline-flex' }}><Hatch /><span>Focus time</span></span>
};
