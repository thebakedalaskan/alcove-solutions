/*
 * ProviderMark: a sign-in provider's own mark, drawn as the provider publishes it, in its own colours in both themes.
 * 17px square; ProviderButton pins it at 20 on the left of the button.
 */
import { ProviderMark } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Icons and marks/ProviderMark',
  component: ProviderMark,
  parameters: { layout: 'centered' },
  args: { provider: 'google' },
  argTypes: { provider: { control: 'inline-radio', options: ['google', 'microsoft'] } }
} satisfies Meta<typeof ProviderMark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Google: Story = {};
export const Microsoft: Story = { args: { provider: 'microsoft' } };
