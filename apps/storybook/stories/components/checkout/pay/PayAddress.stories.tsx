import { PayAddress } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PREVIEW_BASE_ADDRESS, Step } from '../parts';

/**
 * Where to send it: a QR code of the address with the token's mark in its middle, listening while a payment is awaited, and
 * the address with its first six and last four characters bold, since those are the ones people check. On a phone there's
 * no code: Open in wallet opens the payment in a wallet app, or copies the address where the network has no such link. The
 * address is a made-up preview no wallet takes, and Open in wallet here goes nowhere.
 */
const meta = {
  title: 'Components/Checkout/Pay/PayAddress', component: PayAddress, parameters: { layout: 'centered' },
  args: { address: PREVIEW_BASE_ADDRESS, chainName: 'Base', tag: 'new', walletHref: null, listening: true },
  argTypes: { tag: { control: 'inline-radio', options: ['new', 'same'] }, walletHref: { control: 'text' } },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof PayAddress>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Made for this payment, its code listening. */
export const MadeForThisPayment: Story = {};
export const MadeForThisPaymentNight: Story = { globals: { theme: 'dark' } };
/** The rest of a payment goes to the same address. */
export const TheSameAddress: Story = { args: { tag: 'same' } };
/** On a phone, where the route names its token: Open in wallet, the one filled button. */
export const OpenInWallet: Story = { args: { walletHref: '#open-in-wallet' }, globals: { viewport: { value: 'phone' } } };
/** On a phone, where it doesn't: the filled button copies the address. */
export const CopyOnAPhone: Story = { globals: { viewport: { value: 'phone' }, theme: 'dark' } };
/** A network that needs a memo beside the address. */
export const WithAMemo: Story = { args: { memo: 'preview-memo-1284' } };
