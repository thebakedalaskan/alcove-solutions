import { CheckoutDone, CheckoutLine, CheckoutNote, CheckoutWindow, Button, MonthsPicker, NetworkPicker, PayAddress, PayAmount, PayArrived, PayStatus, PayTrack, type CheckoutStage } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { LENGTHS, NETWORKS, PREVIEW_BASE_ADDRESS, PRO_YEAR_SUMMARY, TEAM_FOLK } from './parts';

/**
 * The checkout window on the kit's Modal: the step on the left, what you're buying on the right, Close at the top right; on
 * a phone the whole screen, with what you're buying as one line at the top. Each stage's content rises in, and the summary's
 * sun rises as the payment lands. The app's own window, on real data, is Pages/Account/Checkout.
 */
const meta = {
  title: 'Components/Checkout/CheckoutWindow', component: CheckoutWindow, parameters: { layout: 'fullscreen' },
  args: { title: 'Get Pro', step: 1, stage: 'choose', summary: PRO_YEAR_SUMMARY, onClose: did('onClose'), foot: null, children: null },
  argTypes: { stage: { control: 'select', options: ['choose', 'send', 'short', 'seen', 'done', 'closed'] }, step: { control: 'inline-radio', options: [1, 2, 3, null] } }
} satisfies Meta<typeof CheckoutWindow>;
export default meta;
type Story = StoryObj<typeof meta>;

const choose: ReactNode = (
  <>
    <MonthsPicker options={LENGTHS} value={12} offLabel="20% off" onChange={did('onChange')} other={{ open: false, max: 12, price: '$192, 20% off', onOpen: did('onOpen'), onStep: did('onStep') }} />
    <NetworkPicker options={NETWORKS} value="base" onChange={did('onChange')} />
  </>
);
const send: ReactNode = (
  <>
    <PayStatus dots label="Waiting for your payment" expires="Open until tomorrow 16:12" />
    <PayAmount amount="192.00" chain="base" chainName="Base" />
    <PayAddress address={PREVIEW_BASE_ADDRESS} chainName="Base" tag="new" walletHref={null} listening />
    <CheckoutNote>Only send USDC on Base. Anything else may be lost. Sending from an exchange? Add its withdrawal fee on top.</CheckoutNote>
  </>
);
const seen: ReactNode = (
  <>
    <PayStatus dots label="Payment seen" />
    <PayArrived amount="192.00" value={192} chainName="Base" />
    <CheckoutLine>Starting Pro. This takes a minute or two.</CheckoutLine>
    <PayTrack steps={['Sent', 'Seen on Base', 'Pro starts']} />
  </>
);
const done: ReactNode = (
  <CheckoutDone title="You’re on Pro" lines={['Until Saturday 30 October 2027.']} reminder="Nothing renews by itself. Alcove reminds you before it ends."
    receipt={{ title: '192.00 USDC on Base', sub: '4 Nov 2026 · Pro, 12 months', reference: 'k3Fq9xZ2', onOpen: did('onReceipt') }} />
);
const close = <Button variant="secondary" onClick={did('onClose')}>Close</Button>;
const at = (stage: CheckoutStage, step: 1 | 2 | 3, children: ReactNode, foot: ReactNode): Story => ({ args: { stage, step, children, foot } });

export const Choose = at('choose', 1, choose, <><Button variant="quiet" className="ck-push" onClick={did('onCompare')}>Compare plans</Button><Button variant="primary" onClick={did('onGo')}>Get the address</Button></>);
export const ChooseNight: Story = { ...Choose, globals: { theme: 'dark' } };
export const ChoosePhone: Story = { ...Choose, globals: { viewport: { value: 'phone' } } };
export const Pay = at('send', 2, send, <><p className="hint">You can close this. Pro starts as soon as your payment arrives.</p><Button variant="quiet" onClick={did('onCancel')}>Cancel payment</Button>{close}</>);
export const PayNight: Story = { ...Pay, globals: { theme: 'dark' } };
export const PayPhone: Story = { ...Pay, globals: { viewport: { value: 'phone' }, theme: 'dark' } };
export const Seen = at('seen', 2, seen, <><p className="hint">You can close this. It finishes by itself.</p>{close}</>);
export const Done = at('done', 3, done, <Button variant="primary" onClick={did('onDone')}>Done</Button>);
export const DoneNight: Story = { ...Done, globals: { theme: 'dark' } };
/** Over a call, in your own theme whatever the call's night: here light. */
export const OverACallInYourTheme: Story = { ...Done, args: { ...Done.args, theme: 'light', foot: <Button variant="primary" onClick={did('onDone')}>Back to the call</Button> }, globals: { theme: 'dark' } };
/**
 * Nothing to buy here: on Priya's team, Priya buys its licenses. No steps, since none can be taken, and it's said once, in one
 * note, with Close.
 */
export const NothingToBuy: Story = {
  args: {
    title: 'Buy licenses', step: null, stage: 'choose',
    summary: { art: 'team', people: TEAM_FOLK, name: 'Team', sub: 'For Vandelay Industries', brief: '', lines: [], total: null, foot: 'Each license is one person for 30 days.' },
    children: <CheckoutNote tone="info">Priya, its admin, buys the licenses for Vandelay Industries.</CheckoutNote>, foot: close
  }
};
export const NothingToBuyNight: Story = { ...NothingToBuy, globals: { theme: 'dark' } };
export const NothingToBuyPhone: Story = { ...NothingToBuy, globals: { viewport: { value: 'phone' } } };
