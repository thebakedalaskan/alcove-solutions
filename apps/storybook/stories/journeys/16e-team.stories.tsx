/*
 * Journeys through Team on Plans and in checkout (docs/product/user-flows.md › 16. Plans and paying, 16.15; the canvas's
 * "Start a team" journey, docs/design/canvas/plans/data-plans.js). Each starts on Plans, where Team's card opens checkout over
 * the page, on licenses for a year while Yearly is chosen, and plays the rest as a person would. The payment's other side is the stand-in's: a payment opened to buy
 * something is seen, added and bought a few seconds apart, and the window, which reads it every few seconds, follows it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { LAPTOP, LATER, pressable, SOON } from './play';

const meta = { title: 'Journeys/16 Team', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** A plan's card on Plans, by its name. */
const plan = (name: string) => screen.findByRole('article', { name }, SOON);
/** The checkout window, once it's open. */
const win = async () => within(await screen.findByRole('dialog', {}, SOON));
/** A choice in one of the window's groups (How many licenses, Pay with USDC on), by the start of its name. */
const choice = async (group: string, name: string) =>
  within(await screen.findByRole('radiogroup', { name: group }, LATER)).getByRole('radio', { name: new RegExp(`^${name}`) });
/** Waits for the window to say `text`. */
const says = async (text: string | RegExp) => (await win()).findByText(text, {}, LATER);

export const StartATeam: PageStory = {
  name: '16.15 Start a team',
  ...page('/plans', 'payments'),
  play: async ({ userEvent, step }) => {
    await step('On Plans, priced for a year, Team is licenses: $32 a person a month, $384 a person for 12 months. Press Start a team on its card', async () => {
      await within(await plan('Team')).findByText('$32', {}, SOON);
      await userEvent.click(await within(await plan('Team')).findByRole('button', { name: 'Start a team' }, SOON));
    });
    await step('Checkout opens on starting one: its name is the company’s, and you’re its admin. Six licenses, one for each of the six of you', async () => {
      await (await win()).findByRole('textbox', { name: 'Its name' }, LATER);
      await choice('How many licenses', '6 licenses');
    });
    await step('For a year, as Plans was: $384 each, one person for a year. Monthly is beside it, at $40 each for 30 days', async () => {
      await within(await screen.findByRole('group', { name: 'How long' }, LATER)).findByRole('button', { name: /^Yearly/, pressed: true }, SOON);
    });
    await step('Choose Base. The summary says exactly what to send for the six: 6 licenses for a year at $32 a month', async () => {
      await userEvent.click(await choice('Pay with USDC on', 'Base'));
    });
    await step('Get the address: the team is made now, with you its admin, and the payment for its licenses opens', async () => {
      await userEvent.click(await pressable('button', 'Get the address', SOON, await win()));
      await says('Waiting for your payment');
    });
    await step('The payment is sent from a wallet. Alcove sees it arrive and adds the licenses: nothing to press', async () => {
      await says('Adding the licenses. This takes a minute or two.');
    });
    await step('Vandelay Industries is on Team: your license is taken now, and each of the others when the person it’s for next opens Alcove. Each runs a year from then', async () => {
      await says('Vandelay Industries is on Team');
    });
    await step('Done. Team is your plan on Plans now, and Buy licenses is on its card', async () => {
      await userEvent.click(await pressable('button', 'Done', SOON, await win()));
      await within(await plan('Team')).findByRole('button', { name: 'Buy licenses' }, LATER);
    });
  }
};
