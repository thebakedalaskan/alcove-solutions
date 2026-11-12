import { CheckoutDone } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { Step } from './parts';

/** Done: the tick pops and draws, what you have now, the receipt's row, and that nothing renews by itself. */
const meta = {
  title: 'Components/Checkout/CheckoutDone', component: CheckoutDone, parameters: { layout: 'centered' },
  args: {
    title: 'You’re on Pro', lines: ['Until Saturday 30 October 2027.'],
    receipt: { title: '192.00 USDC on Base', sub: '4 Nov 2026 · Pro, 12 months', reference: 'k3Fq9xZ2', onOpen: did('onOpen') },
    reminder: 'Nothing renews by itself. Alcove reminds you before it ends.'
  },
  decorators: [(Story) => <Step><Story /></Step>],
  render: (args) => <CheckoutDone key={JSON.stringify(args)} {...args} />
} satisfies Meta<typeof CheckoutDone>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OnPro: Story = {};
export const OnProNight: Story = { globals: { theme: 'dark' } };
export const Extended: Story = { args: { title: 'Pro runs to 2 Nov 2027', lines: ['Until Tuesday 2 November 2027.'] } };
/** More arrived than asked: the rest is in the balance. */
export const MoreArrived: Story = {
  args: {
    lines: ['Until Saturday 30 October 2027.', 'You sent 198.00 USDC, 6.00 more than asked: it’s in your balance.'],
    receipt: { title: '198.00 USDC on Base', sub: '4 Nov 2026 · Pro, 12 months', reference: 'k3Fq9xZ2', onOpen: did('onOpen') }
  }
};
/** Bought from the balance, with renewing on. */
export const FromTheBalance: Story = {
  args: {
    title: 'You’re on Pro', lines: ['Until Wednesday 3 February 2027.'], reminder: 'Renews from your balance.',
    receipt: { title: '$60 from your balance', sub: '4 Nov 2026 · Pro, 3 months', reference: 'Q8vT2mLx', onOpen: did('onOpen') }
  }
};
export const MoreNotes: Story = {
  args: {
    title: '10 more hours of notes', lines: ['They’re yours until this period ends on Saturday 21 November, and notes start again now.'], reminder: null,
    receipt: { title: '15.00 USDC on Base', sub: '4 Nov 2026 · 10 hours of notes', reference: 'p0Wd7Ksa', onOpen: did('onOpen') }
  },
  globals: { theme: 'dark' }
};
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
