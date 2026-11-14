/*
 * Your team (docs/product/user-flows.md › 16. Plans and paying, 16.16 and 16.17; the canvas's StepsPlans board,
 * docs/design/canvas/plans/data-plans.js). Upgrading a free team is buying its licenses: from Plans' Team card for its admin,
 * with checkout over the page on licenses for a year while Yearly is chosen, paid with USDC. The payment's other side is the
 * stand-in's: a payment opened to buy something is seen, added and bought a few seconds apart, and the window, which reads it
 * every few seconds, follows it. Then the team's page on Team, as its admin, with none of its licenses left and Maya waiting
 * for one: who has a license, the licenses beside them, taking someone off, and inviting, the same on either tier (flow 10).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { away, LAPTOP, LATER, pressable, SOON } from '../play';

const meta = { title: 'Journeys/16 Plans and paying/Your team', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
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
/** Who's invited and hasn't joined yet. */
const invited = () => screen.findByRole('region', { name: 'Invited' }, LATER);

export const UpgradeATeam: PageStory = {
  name: '16.16 Upgrade a team',
  ...page('/plans', 'team-free-admin'),
  play: async ({ userEvent, step }) => {
    await step('Art runs Vandelay Industries’ free team. On Plans, priced for a year, Team’s card has Upgrade', async () => {
      await userEvent.click(await within(await plan('Team')).findByRole('button', { name: 'Upgrade' }, SOON));
    });
    await step('Checkout opens on Team for the team Art has, with nothing to name: a license for each of the three on it, for a year as Plans was', async () => {
      await choice('How many licenses', '3 licenses');
      await within(await screen.findByRole('group', { name: 'How long' }, LATER)).findByRole('button', { name: /^Yearly/, pressed: true }, SOON);
    });
    await step('Three licenses for a year at $32 a month are $1,152, and the $180 in Art’s balance goes toward it. Choose Base: the summary says exactly what to send', async () => {
      await userEvent.click(await choice('Pay with USDC on', 'Base'));
    });
    await step('Get the address: the payment for the licenses opens, and the side panel waits for it too', async () => {
      await userEvent.click(await pressable('button', 'Get the address', SOON, await win()));
      await says('Waiting for your payment');
    });
    await step('The payment is sent from a wallet. Alcove sees it arrive and adds the licenses: nothing to press', async () => {
      await says('Adding the licenses. This takes a minute or two.');
    });
    await step('Vandelay Industries is on Team, and Done says what happened: everyone has a license. Art’s is taken now, and everyone else’s the next time they open Alcove. Each runs a year from then', async () => {
      await says(/Everyone has a license/);
    });
    await step('Done. Team is Art’s plan on Plans now, and Buy licenses is on its card', async () => {
      await userEvent.click(await pressable('button', 'Done', SOON, await win()));
      await within(await plan('Team')).findByRole('button', { name: 'Buy licenses' }, LATER);
    });
  }
};

export const PeopleLicensesAndInvites: PageStory = {
  name: '16.17 Your team: people, licenses and invites',
  ...page('/team', 'team-admin-none'),
  play: async ({ userEvent, step }) => {
    await step('Team shows everyone on it under their license, the licenses left, and who’s waiting for one: Maya', async () => {
      await screen.findByRole('list', { name: 'People on Vandelay Industries' }, LATER);
    });
    await step('Buy licenses is filled while someone waits. It opens checkout on Team, over the page; close it for now', async () => {
      await userEvent.click(await pressable('button', 'Buy licenses', SOON));
      await screen.findByRole('dialog', {}, SOON);
      await userEvent.keyboard('{Escape}');
      await away('dialog', /./);
    });
    await step('Or buy a license for each person who joins, from your balance, whenever one’s needed', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Buy a license for each person who joins' }, SOON));
    });
    await step('Remove asks in place, under their row: Maya leaves the team, its invite link changes, and her license isn’t refunded', async () => {
      await userEvent.click(await pressable('button', 'Remove Maya Chen', SOON));
      await screen.findByRole('group', { name: 'Remove Maya?' }, SOON);
    });
    await step('Remove Maya: she leaves the horizon and the list', async () => {
      await userEvent.click(await pressable('button', 'Remove Maya', SOON));
      await away('button', 'Remove Maya Chen');
    });
    await step('Under the people, Invited, as on a free team: Lena’s invitation, from Priya, runs out in 4 days. Resend sends it again, and its 30 days start again', async () => {
      await userEvent.click(within(await invited()).getByRole('button', { name: 'Resend Lena Fischer’s invitation' }));
      await screen.findByText('Sent Lena’s invitation again.', {}, SOON);
    });
    await step('Invite people is the same on either tier: tick colleagues, or type anyone’s address, and Alcove emails each. Copy link copies the team’s one link', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Invite people' }, SOON));
      await userEvent.click(await pressable('button', 'Copy link', SOON, within(await screen.findByRole('dialog', { name: 'Invite people to Vandelay Industries' }, SOON))));
      // A browser that won't copy for the page shows the link to copy instead.
      await screen.findByText(/^(Invite link copied\. Whoever opens it can join Vandelay Industries\.|Copy this link:)/, {}, SOON);
    });
  }
};
