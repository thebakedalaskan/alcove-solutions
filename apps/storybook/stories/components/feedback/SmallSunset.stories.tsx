/*
 * SmallSunset: Home's small sunset, the sun half down on the horizon with its glitter on the water. For you shows it once
 * everything's answered and ticked off: You're all caught up. Drawn from the tokens, so it suits either theme.
 */
import { SmallSunset } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/SmallSunset',
  component: SmallSunset,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof SmallSunset>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
