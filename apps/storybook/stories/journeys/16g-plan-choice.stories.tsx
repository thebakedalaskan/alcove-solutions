/*
 * The plan choice (docs/product/user-flows.md › 16. Plans and paying, 16.20): Plans, opened by itself once in Home's place,
 * for a new account and, once, for an account from before plans. A new account's arrival opens on it, and the tour of Home
 * waits for Home; Get Pro opens checkout over it, and once Pro is bought, Done goes on to Home. Signing in from the welcome page
 * sails out of its cove onto them, as it would onto Home. The payment's other side is the stand-in's: a payment opened to buy
 * something is seen, added and bought a few seconds apart, and the window, which reads it every few seconds, follows it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { carriedOver } from '../../src/world/plans';
import { away, before, first, LAPTOP, LATER, pause, pressable, SOON } from './play';

/** Signing in from the welcome page sails out of its cove: about three and a half seconds. */
const SAILING_OUT = 3600;

const meta = { title: 'Journeys/16 The plan choice', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** The switch on the plans' sky. */
const cycle = () => screen.findByRole('group', { name: 'Prices for' }, SOON);
/** A plan's card, by its name. */
const plan = (name: string) => screen.findByRole('article', { name }, SOON);
/** The checkout window, once it's open. */
const win = async () => within(await screen.findByRole('dialog', {}, SOON));
/** Waits for the window to say `text`. */
const says = async (text: string | RegExp) => (await win()).findByText(text, {}, LATER);

export const ChooseAPlan: PageStory = {
  name: '16.20 Choose a plan',
  ...page('/ready', 'plan-choice'),
  play: async ({ userEvent, step }) => {
    await step('A new account is made on screen. “You’re in”, and the arch opens on the plans, in Home’s place: Choose a plan', async () => {
      await screen.findByRole('dialog', { name: /^You’re in/ }, LATER);
      await screen.findByRole('heading', { name: 'Choose a plan', level: 1 }, LATER);
      await away('dialog', /^You’re in/, LATER);
    });
    await step('Free, Pro and Team side by side, priced for a year. Monthly shows Pro a month at a time', async () => {
      await userEvent.click(within(await cycle()).getByRole('button', { name: 'Monthly' }));
      await within(await plan('Pro')).findByText('$20', {}, SOON);
    });
    await step('Continue on Free, on Free’s card. Home opens on the first day, and the plans aren’t shown again', async () => {
      await userEvent.click(await pressable('button', 'Continue on Free', SOON, within(await plan('Free'))));
      await screen.findByRole('region', { name: 'Start your first call' }, LATER);
    });
    await step('Now Home is there, its tour starts, a slide at a time', async () => {
      await screen.findByRole('dialog', { name: 'Start or schedule a call' }, LATER);
    });
  }
};

export const ChooseProFromThePlans: PageStory = {
  name: '16.20 Choose a plan: Get Pro',
  ...page('/home', 'plan-choice'),
  play: async ({ userEvent, step }) => {
    await step('Home opens on the plans: Choose a plan. Press Get Pro, the one filled button', async () => {
      await screen.findByRole('heading', { name: 'Choose a plan', level: 1 }, LATER);
      await userEvent.click(await within(await plan('Pro')).findByRole('button', { name: 'Get Pro' }, SOON));
    });
    await step('Checkout opens over the plans, on 12 months at the yearly price. Choose Base, and get the address', async () => {
      await userEvent.click(within(await screen.findByRole('radiogroup', { name: 'Pay with USDC on' }, LATER)).getByRole('radio', { name: /^Base/ }));
      await userEvent.click(await pressable('button', 'Get the address', SOON, await win()));
      await says('Waiting for your payment');
    });
    await step('The payment is sent from a wallet. Alcove sees it arrive and starts Pro: nothing to press', async () => {
      await says('Starting Pro. This takes a minute or two.');
    });
    await step('You’re on Pro. Done goes on to Home, with nothing more to choose', async () => {
      await says('You’re on Pro');
      await userEvent.click(await pressable('button', 'Done', SOON, await win()));
      await screen.findByRole('region', { name: 'Start your first call' }, LATER);
    });
  }
};

export const ChooseAfterSigningIn: PageStory = {
  name: '16.20 Choose a plan: signing in from the welcome page',
  ...page('/', 'signed-out'),
  beforeEach: before((w) => { w.plan = carriedOver(); }),
  play: async ({ userEvent, step }) => {
    await step('Art has used Alcove for weeks, and plans came while he was away. On the welcome page, use single sign-on', async () => {
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Use single sign-on' }, SOON)));
      await userEvent.type(await screen.findByRole('textbox', { name: 'Work email' }, SOON), 'art@vandelay.industries');
    });
    await step('Continue. Out of the cove to sea, onto the plans in Home’s place, its sun sinking to their last sliver: Alcove has plans now', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByRole('heading', { name: 'Alcove has plans now', level: 1 }, LATER);
      await pause(SAILING_OUT);
    });
    await step('Continue on Free, on Free’s card. Home opens as it is, with nothing more to sail', async () => {
      await userEvent.click(await pressable('button', 'Continue on Free', SOON, within(await plan('Free'))));
      await screen.findByRole('region', { name: 'For you' }, LATER);
    });
  }
};
