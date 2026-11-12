/*
 * Journeys through checkout (docs/product/user-flows.md › 16. Plans and checkout, from 16.2; the canvas's StepsPlans board,
 * docs/design/canvas/plans/data-plans.js). Each opens checkout over the page as its door does (Get Pro on Plans, Extend in
 * Settings, Add 10 hours in a call), through src/checkout.tsx, and plays the rest as a person would. The payment's other
 * side is the stand-in's: a payment opened to buy something is seen, added and bought a few seconds apart (or less arrives,
 * as the scenario says), and the window, which reads it every few seconds, follows it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { payTheRest } from '../../src/api/payments';
import { current } from '../../src/api/state';
import { checkout, checkouts, type CheckoutArgs, type CheckoutStory } from '../../src/checkout';
import { addToBalance, withPayments } from '../../src/world/payments';
import { before, LAPTOP, LATER, pressable, SOON } from './play';

const meta = { title: 'Journeys/16 Checkout', ...checkouts, globals: LAPTOP } satisfies Meta<CheckoutArgs>;
export default meta;

/** The checkout window, once it's open. */
const win = async () => within(await screen.findByRole('dialog', {}, SOON));
/** A choice in one of the window's groups (How long, Pay with USDC on), by the start of its name. */
const choice = async (group: string, name: string) =>
  within(await screen.findByRole('radiogroup', { name: group }, LATER)).getByRole('radio', { name: new RegExp(`^${name}`) });
/** Waits for the window to say `text`. */
const says = async (text: string | RegExp) => (await win()).findByText(text, {}, LATER);

export const GetProWithUsdc: CheckoutStory = {
  name: '16.2 Get Pro, paying with USDC',
  ...checkout('/home', 'payments', { plan: 'pro', from: 'side' }),
  play: async ({ userEvent, step }) => {
    await step('Get Pro opens checkout over the page, on a year: 20% off, said once over the lengths that get it', async () => {
      await choice('How long', '12 months');
    });
    await step('Choose the network to send USDC on. The summary says exactly what to send', async () => {
      await userEvent.click(await choice('Pay with USDC on', 'Base'));
    });
    await step('Get the address: the exact amount, a QR code and an address made for this one payment, open for a day', async () => {
      await userEvent.click(await pressable('button', 'Get the address', SOON, await win()));
      await says('Waiting for your payment');
    });
    await step('The payment is sent from a wallet. Alcove sees it arrive, the amount counts up and the sun lifts: nothing to press', async () => {
      await says('Payment seen');
    });
    await step('Pro is on: the sun clears the horizon and the tick draws in. Receipt opens a receipt to print', async () => {
      await says('You’re on Pro');
      await userEvent.click(await pressable('button', 'Receipt', SOON, await win()));
      await says('Receipt');
    });
    await step('Back, then Done', async () => {
      await userEvent.click(await pressable('button', 'Back', SOON, await win()));
      await userEvent.click(await pressable('button', 'Done', LATER, await win()));
    });
  }
};

export const GetProWithYourBalance: CheckoutStory = {
  name: '16.3 Get Pro with your balance',
  ...checkout('/home', 'plan-balance', { plan: 'pro', from: 'plans' }),
  play: async ({ userEvent, step }) => {
    await step('With $60 in the balance, a year is $132 short: the balance comes off what to send', async () => {
      await choice('Pay with USDC on', 'Base');
    });
    await step('Choose 3 months. The balance covers them: there’s nothing to send, and no network to choose', async () => {
      await userEvent.click(await choice('How long', '3 months'));
      await says('Paid from your balance: $60 now, $0 after.');
    });
    await step('Buy with your balance takes it at once: no Pay step', async () => {
      await userEvent.click(await pressable('button', 'Buy with your balance', SOON, await win()));
      await says('You’re on Pro');
    });
    await step('Done', async () => {
      await userEvent.click(await pressable('button', 'Done', SOON, await win()));
    });
  }
};

export const ExtendPro: CheckoutStory = {
  name: '16.4 Extend Pro',
  ...checkout('/settings#plan', 'plan-pro-ending', { plan: 'pro', from: 'settings' }),
  play: async ({ userEvent, step }) => {
    await step('Pro ends in 3 days. Extend opens checkout counted from its end: the days left aren’t lost', async () => {
      await says('Added to the 3 days you have left');
    });
    await step('How much longer: a year. The $5 in the balance comes off. Choose Solana', async () => {
      await userEvent.click(await choice('Pay with USDC on', 'Solana'));
    });
    await step('Get the address, and send it', async () => {
      await userEvent.click(await pressable('button', 'Get the address', SOON, await win()));
      await says('Waiting for your payment');
    });
    await step('Seen, then Pro runs a year further', async () => {
      await says(/^Pro runs to /);
    });
    await step('Done', async () => {
      await userEvent.click(await pressable('button', 'Done', SOON, await win()));
    });
  }
};

export const MoreNotesForThisPeriod: CheckoutStory = {
  name: '16.5 More notes for this period',
  ...checkout('/home', 'plan-stopped', { plan: 'hours', from: 'call' }),
  beforeEach: before((w) => withPayments(w)),
  play: async ({ userEvent, step }) => {
    await step('Notes stopped at this period’s 5 hours. Add 10 hours opens checkout on more notes, over the call', async () => {
      await choice('How many hours', '10 hours');
    });
    await step('Choose 20 hours, and Base', async () => {
      await userEvent.click(await choice('How many hours', '20 hours'));
      await userEvent.click(await choice('Pay with USDC on', 'Base'));
    });
    await step('Get the address, and send it', async () => {
      await userEvent.click(await pressable('button', 'Get the address', SOON, await win()));
      await says('Waiting for your payment');
    });
    await step('Seen, then the hours are added and notes start again', async () => {
      await says('20 more hours of notes');
    });
    await step('Back to the call', async () => {
      await userEvent.click(await pressable('button', 'Back to the call', SOON, await win()));
    });
  }
};

export const WhenAPaymentIsntRight: CheckoutStory = {
  name: '16.6 When a payment isn’t right',
  ...checkout('/home', 'payment-short', { plan: 'pro', months: 1, from: 'plans' }),
  beforeEach: before((w) => addToBalance(w, 5_000_000, '5')),
  play: async ({ userEvent, step }) => {
    await step('A month, with $5 in the balance, is 15 USDC short. Ethereum takes at least 20: what’s asked rises to it, and the rest stays in the balance', async () => {
      await userEvent.click(await choice('Pay with USDC on', 'Ethereum'));
      await says(/so 5\.00 of it stays in your balance/);
    });
    await step('Get the address', async () => {
      await userEvent.click(await pressable('button', 'Get the address', SOON, await win()));
      await says('Waiting for your payment');
    });
    await step('Cancel payment asks first, in the foot, and says a payment sent anyway still counts. Keep waiting', async () => {
      await userEvent.click(await pressable('button', 'Cancel payment', SOON, await win()));
      await userEvent.click(await pressable('button', 'Keep waiting', SOON, await win()));
    });
    await step('Less than asked arrives: send the rest to the same address, or what arrived stays in the balance', async () => {
      await says('Less than asked arrived');
    });
    await step('The rest arrives: seen, then Pro is on', async () => {
      const t = current().payments.topUps[0];
      if (t) payTheRest(current(), t.id);
      await says('You’re on Pro');
    });
  }
};
