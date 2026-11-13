/*
 * Notice: a calm sentence with a way forward. Info, in the horizon's tint, for information, with a lock unless it says
 * otherwise; caution for a problem (there is no alarm red), with a clock unless it says otherwise, and screen readers
 * hear it as it appears. It fills the width it's given, and long text wraps beside the icon.
 */
import { ICON_NAMES, Notice } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../../src/component';

const meta = {
  title: 'Components/Feedback/Notice',
  component: Notice,
  args: { tone: 'info', children: 'Messages sent here before you came aren’t shown. Only people who were here then can read them.' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['info', 'caution'] },
    icon: { control: 'select', options: ICON_NAMES },
    children: { control: 'text' }
  },
  render: (args) => <Box width={460} height="auto"><Notice {...args} /></Box>
} satisfies Meta<typeof Notice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};
export const Caution: Story = { args: { tone: 'caution', children: 'Documents can’t be read just now. The call works without them, and you can try again in a moment.' } };
/** Its own icon in place of the tone's: notes are paused. */
export const CustomIcon: Story = { name: 'Custom icon', args: { icon: 'pause', children: 'Notes are paused. Nothing new is transcribed until they resume.' } };
/** A long one, led by what matters most in bold. */
export const Long: Story = {
  args: {
    children: <><b>Only you see this.</b> Answers come from what’s been said in this call, nothing else. Nothing is kept unless you keep it, and nobody else in the call sees what you asked.</>
  },
  argTypes: { children: { control: false } }
};
/** Said until it's dismissed: an × at its end, as a plan's notices are on Settings › Plan. */
export const Dismissible: Story = {
  args: { icon: 'coins', children: 'Pro renewed from your balance. It now runs to Sat 5 Dec.', onDismiss: () => undefined, dismissLabel: 'Dismiss: Pro renewed' },
  argTypes: { onDismiss: { control: false } }
};
