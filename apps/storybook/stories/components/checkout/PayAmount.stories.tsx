import { PayAmount } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Step } from './parts';

/** What to send, exactly, with a button that copies it as a wallet takes it; what has arrived when part has; the token on its network. */
const meta = {
  title: 'Components/Checkout/PayAmount', component: PayAmount, parameters: { layout: 'centered' },
  args: { amount: '192.00', copy: '192.00', chain: 'base', chainName: 'Base' },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof PayAmount>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SendExactly: Story = {};
export const SendExactlyNight: Story = { globals: { theme: 'dark' } };
export const SendTheRest: Story = { args: { label: 'Send the rest', amount: '64.00', copy: '64.00', arrived: '128.00 of 192.00 USDC arrived.' } };
export const OnSolana: Story = { args: { chain: 'sol', chainName: 'Solana' } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
