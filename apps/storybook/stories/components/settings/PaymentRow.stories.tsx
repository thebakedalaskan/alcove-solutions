/*
 * PaymentRow and SettingPayments: the payments at the foot of Settings › Plan's second panel. Each is its mark (the
 * network's, or the coins of the balance where there's no network), what it was for, how much and when (or how it stands,
 * in horizon while it's on its way and caution when something isn't right), and what can be done with it at the panel's
 * edge: Receipt, Open, a cancel.
 */
import { Button, CryptoMark, Icon, IconButton, PaymentRow, SettingFact, SettingPayments, SettingRow, SettingsPanel } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

/** The balance's panel, as the page lays it out: the balance, then the payments. */
const inPanel: Decorator = (Story) => (
  <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}>
    <SettingsPanel>
      <SettingRow label="Balance" help="What Pro and more notes are bought with. Add money from any wallet or exchange."
        control={<><SettingFact>$5</SettingFact><Button size="sm" icon="plus" onClick={did('onAddMoney')}>Add money</Button></>} />
      <SettingPayments title="Payments"><Story /></SettingPayments>
    </SettingsPanel>
  </div>
);

const receipt = (what: string) => <Button variant="quiet" size="sm" icon="download" aria-label={`Receipt for ${what}`} onClick={did('onReceipt')}>Receipt</Button>;

const meta = {
  title: 'Components/Settings/PaymentRow', component: PaymentRow, decorators: [inPanel],
  args: { mark: <CryptoMark name="USDC" />, label: 'Added, 192 USDC', detail: '+$192.00 · 3 Nov 2026', actions: receipt('Added, 192 USDC') },
  argTypes: { tone: { control: 'inline-radio', options: [undefined, 'wait', 'problem'] }, label: { control: 'text' }, detail: { control: 'text' }, mark: { control: false }, actions: { control: false } }
} satisfies Meta<typeof PaymentRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Money added: the stablecoin's mark, and its receipt. */
export const Added: Story = {};
/** Bought from the balance: the balance's coins where there's no network. */
export const Bought: Story = { args: { mark: <Icon name="coins" size={18} />, label: 'Pro, 12 months', detail: '−$192.00 · 3 Nov 2026', actions: receipt('Pro, 12 months') } };
/** A payment for a year of Pro on its way: in horizon, with Open and a cancel. */
export const OnItsWay: Story = {
  args: {
    mark: <CryptoMark name="base" />, label: 'Pro, 12 months', tone: 'wait', detail: 'Waiting for 192.00 USDC on Base · open until tomorrow 16:12',
    actions: <><Button size="sm" onClick={did('onOpen')}>Open</Button><IconButton icon="x" label="Cancel the payment for Pro, 12 months" onClick={did('onCancel')} /></>
  }
};
/** Less arrived than asked: in caution, with what's still to send. */
export const Short: Story = {
  args: { mark: <CryptoMark name="sol" />, label: 'Pro, 3 months', tone: 'problem', detail: '50 of 60 USDC on Solana arrived · send 10 more by tomorrow', actions: <Button size="sm" onClick={did('onOpen')}>Open</Button> }
};
/** Several, as the page lists them: what's on its way first, then the balance's latest changes. */
export const AList: Story = {
  render: () => (
    <>
      <PaymentRow mark={<CryptoMark name="base" />} label="10 hours of notes" tone="wait" detail="Waiting for 15.00 USDC on Base · open until 18:40"
        actions={<><Button size="sm" onClick={did('onOpen')}>Open</Button><IconButton icon="x" label="Cancel the payment for 10 hours of notes" onClick={did('onCancel')} /></>} />
      <PaymentRow mark={<Icon name="coins" size={18} />} label="Pro, 12 months" detail="−$192.00 · 3 Nov 2026" actions={receipt('Pro, 12 months')} />
      <PaymentRow mark={<CryptoMark name="USDC" />} label="Added, 192 USDC" detail="+$192.00 · 3 Nov 2026" actions={receipt('Added, 192 USDC')} />
      <PaymentRow mark={<Icon name="coins" size={18} />} label="Pro, 1 month" detail="−$20.00 · 25 Oct 2026" actions={receipt('Pro, 1 month')} />
    </>
  )
};
export const AListNight: Story = { ...AList, name: 'A list, night', globals: { theme: 'dark' } };
export const AListPhone: Story = { ...AList, name: 'A list, phone', globals: { viewport: { value: 'phone' } } };
