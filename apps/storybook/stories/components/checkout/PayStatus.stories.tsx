import { PayStatus } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Step } from './parts';

/** How a payment stands, in a chip, with until when its address is open: awaited, something to look at, or over. */
const meta = {
  title: 'Components/Checkout/PayStatus', component: PayStatus, parameters: { layout: 'centered' },
  args: { label: 'Waiting for your payment', dots: true, expires: 'Open until tomorrow 16:12' },
  argTypes: { tone: { control: 'inline-radio', options: ['waiting', 'caution', 'quiet'] } },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof PayStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {};
export const WaitingNight: Story = { globals: { theme: 'dark' } };
export const LessArrived: Story = { args: { tone: 'caution', icon: 'alert', dots: false, label: 'Less than asked arrived' } };
export const Seen: Story = { args: { label: 'Payment seen', expires: null } };
export const AddressClosed: Story = { args: { tone: 'quiet', icon: 'clock', dots: false, label: 'Address closed', expires: null } };
export const Failed: Story = { args: { tone: 'caution', icon: 'alert', dots: false, label: 'Something went wrong', expires: null }, globals: { theme: 'dark' } };
