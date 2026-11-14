import { CheckoutDone } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { PREVIEW_TOP_UP } from '../../../src/world/plans/payments';
import { Step } from './parts';

/** A purchase's line in the balance, made up but as long as the server's: the reference of one bought from the balance. */
const FROM_BALANCE = 'Q8vT2mLxR5nW3kPz7JdHsA';

/**
 * Done: the tick pops and draws, what you have now, the receipt's row with its reference whole on a line of its own (the
 * payment's, or the balance's line for it; pressing it copies it, to give support), and that nothing renews by itself.
 */
const meta = {
  title: 'Components/Checkout/CheckoutDone', component: CheckoutDone, parameters: { layout: 'centered' },
  args: {
    title: 'You’re on Pro', lines: ['Until Saturday 30 October 2027.'],
    receipt: { title: '192.00 USDC on Base', sub: '4 Nov 2026 · Pro, 12 months', reference: PREVIEW_TOP_UP, onOpen: did('onOpen') },
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
    receipt: { title: '198.00 USDC on Base', sub: '4 Nov 2026 · Pro, 12 months', reference: PREVIEW_TOP_UP, onOpen: did('onOpen') }
  }
};
/** Bought from the balance, with renewing on. */
export const FromTheBalance: Story = {
  args: {
    title: 'You’re on Pro', lines: ['Until Wednesday 3 February 2027.'], reminder: 'Renews from your balance.',
    receipt: { title: '$60 from your balance', sub: '4 Nov 2026 · Pro, 3 months', reference: FROM_BALANCE, onOpen: did('onOpen') }
  }
};
export const MoreNotes: Story = {
  args: {
    title: '10 more hours of notes', lines: ['They’re yours until this period ends on Saturday 21 November, and notes start again now.'], reminder: null,
    receipt: { title: '15.00 USDC on Base', sub: '4 Nov 2026 · 10 hours of notes', reference: 'p0Wd7KsaN4xB9rTm2QvLzE', onOpen: did('onOpen') }
  },
  globals: { theme: 'dark' }
};
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
/**
 * A free team upgraded, a license bought for each of the three on it: everyone has one, each taken as they next open Alcove.
 * Licenses aren't renewed, so there's no reminder.
 */
export const TeamUpgraded: Story = {
  args: {
    title: 'Vandelay Industries is on Team', reminder: null, lines: ['Everyone has a license.'],
    receipt: { title: '120.00 USDC on Base', sub: '4 Nov 2026 · Team, 3 licenses', reference: PREVIEW_TOP_UP, onOpen: did('onOpen') }
  }
};
export const TeamUpgradedNight: Story = { ...TeamUpgraded, globals: { theme: 'dark' } };
/** Upgraded with fewer licenses than people, and none bought as they join: how many of everyone have one. */
export const TeamUpgradedShort: Story = {
  name: 'Team upgraded, short',
  args: {
    title: 'Vandelay Industries is on Team', reminder: null, lines: ['2 of 3 have one; buy more on Team.'],
    receipt: { title: '$80 from your balance', sub: '4 Nov 2026 · Team, 2 licenses', reference: FROM_BALANCE, onOpen: did('onOpen') }
  }
};
/** More licenses for the team, from the balance: how many are left now, and who gets one. */
export const MoreLicenses: Story = {
  args: {
    title: '3 more licenses', reminder: null, lines: ['3 licenses left now. Maya gets one the next time they open Alcove.'],
    receipt: { title: '$120 from your balance', sub: '4 Nov 2026 · Team, 3 licenses', reference: FROM_BALANCE, onOpen: did('onOpen') }
  }
};
