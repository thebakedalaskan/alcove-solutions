import { CheckoutAsk } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { Step } from './parts';

/** A question before something that can't be undone, in the foot in place of its buttons: the answer that loses nothing is the filled one. */
const meta = {
  title: 'Components/Checkout/CheckoutAsk', component: CheckoutAsk, parameters: { layout: 'centered' },
  args: {
    title: 'Cancel this payment?', text: 'Its address stops showing here. A payment already sent to it still counts when it arrives.',
    confirm: 'Cancel payment', keep: 'Keep waiting', onConfirm: did('onConfirm'), onKeep: did('onKeep'), busy: false
  },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof CheckoutAsk>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CancelPayment: Story = {};
export const CancelPaymentNight: Story = { globals: { theme: 'dark' } };
export const Cancelling: Story = { args: { busy: true } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
