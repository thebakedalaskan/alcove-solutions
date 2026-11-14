import { PayTrack } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Step } from '../parts';

/** Where the payment is, on one line: sent, seen on its network, then what it buys; a ring on where it is and a glint running on. */
const meta = {
  title: 'Components/Checkout/Pay/PayTrack', component: PayTrack, parameters: { layout: 'centered' },
  args: { steps: ['Sent', 'Seen on Base', 'Pro starts'], at: 1 },
  argTypes: { at: { control: 'inline-radio', options: [0, 1, 2] } },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof PayTrack>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Seen: Story = {};
export const SeenNight: Story = { globals: { theme: 'dark' } };
export const Extending: Story = { args: { steps: ['Sent', 'Seen on Solana', 'Pro extended'] } };
export const MoreNotes: Story = { args: { steps: ['Sent', 'Seen on Base', 'Hours added'] } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
