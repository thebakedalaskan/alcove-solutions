import { PaymentReceipt } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../../src/component';

/**
 * A payment's receipt, to keep or print: paper in both themes, as checkout's Done shows it in its window and Settings ›
 * Plan in a `ReceiptWindow` from a payment's Receipt; printed, it's alone on the page, with Alcove's name at its head.
 */
const meta = {
  title: 'Components/Checkout/Pay/PaymentReceipt', component: PaymentReceipt, parameters: { layout: 'centered' },
  args: {
    title: 'Pro, 12 months', total: '$192.00', onPrint: did('onPrint'), onBack: did('onBack'),
    lines: [
      { label: 'Date', value: 'Wednesday 4 November 2026, 16:12' }, { label: 'For', value: 'Art Vandelay' },
      { label: 'Bought', value: 'Pro, 12 months' }, { label: 'Pro until', value: 'Saturday 30 October 2027' },
      { label: 'Price', value: '$192.00' }, { label: 'Paid', value: '192.00 USDC on Base' },
      { label: 'Reference', value: 'k3Fq9xZ2mWnT4pLvD8sHbE', mono: true }, { label: 'Payment', value: 'storybook-top-up', mono: true }
    ]
  },
  decorators: [(Story) => <div className="ac-modal ck is-receipt light sbc-modal"><Story /></div>]
} satisfies Meta<typeof PaymentReceipt>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AYearOfPro: Story = {};
export const AYearOfProNight: Story = { globals: { theme: 'dark' } };
export const FromTheBalance: Story = {
  args: {
    title: 'Pro, 3 months', total: '$60.00',
    lines: [
      { label: 'Date', value: 'Wednesday 4 November 2026, 16:12' }, { label: 'For', value: 'Art Vandelay' },
      { label: 'Bought', value: 'Pro, 3 months' }, { label: 'Pro until', value: 'Wednesday 3 February 2027' },
      { label: 'Price', value: '$60.00' }, { label: 'Paid', value: '$60.00 from your balance' },
      { label: 'Reference', value: 'Q8vT2mLxR5nW1kZp7yHcJd', mono: true }
    ]
  }
};
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
/** Money added to the balance, from Settings › Plan's payments: Close goes back to Settings. */
export const AddedToTheBalance: Story = {
  args: {
    title: 'Added, 192 USDC', total: '$192.00', backLabel: 'Close', note: 'Priced in US dollars. 1 USDC is 1 dollar.',
    lines: [
      { label: 'Date', value: 'Tuesday 3 November 2026, 18:40' }, { label: 'Added to', value: 'Your Alcove balance' },
      { label: 'For', value: 'Art Vandelay, art@vandelay.industries' }, { label: 'Reference', value: 'sb-entry-paid', mono: true }
    ]
  }
};
