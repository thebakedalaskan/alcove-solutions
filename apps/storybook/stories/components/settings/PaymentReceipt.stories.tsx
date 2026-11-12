/*
 * PaymentReceipt: one payment as paper, to read and print: Alcove's name, what it was for and how much, then its facts in a
 * column and a last line. Light in both themes, as paper is; printed, it's the only thing on the page. Settings › Plan
 * opens it from a payment's Receipt, over the page, with Print.
 */
import { PaymentReceipt } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Settings/PaymentReceipt', component: PaymentReceipt,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 440 }}><Story /></div>],
  args: {
    title: 'Pro, 12 months', amount: '$192.00', note: 'Priced in US dollars. 1 USDC is 1 dollar.',
    lines: [
      { label: 'Date', value: 'Tuesday 3 November 2026, 18:40' },
      { label: 'Paid from', value: 'Your Alcove balance' },
      { label: 'For', value: 'Art Vandelay, art@vandelay.industries' },
      { label: 'Reference', value: <code>sb-entry-year</code> }
    ]
  },
  argTypes: { title: { control: 'text' }, amount: { control: 'text' }, note: { control: 'text' }, lines: { control: false }, className: { control: false } }
} satisfies Meta<typeof PaymentReceipt>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Pro bought from the balance. */
export const Bought: Story = {};
/** Money added to the balance. */
export const Added: Story = {
  args: {
    title: 'Added, 192 USDC', amount: '$192.00',
    lines: [
      { label: 'Date', value: 'Tuesday 3 November 2026, 18:40' },
      { label: 'Added to', value: 'Your Alcove balance' },
      { label: 'For', value: 'Art Vandelay, art@vandelay.industries' },
      { label: 'Reference', value: <code>sb-entry-paid</code> }
    ]
  }
};
/** On a night page it's still paper. */
export const BoughtNight: Story = { ...Bought, name: 'Bought, night', globals: { theme: 'dark' } };
