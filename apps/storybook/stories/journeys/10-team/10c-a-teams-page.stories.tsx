/*
 * A team's page (docs/product/user-flows.md › 10. Team, A team's page): the Team page while you're on a team, the same free or
 * on Team. Its name in the sky with Rename for its admin, and Invite people; what Free means at the top of a free team's
 * water, with the page's one Upgrade for the admin (once someone else is on it, and saying who asked for it when someone
 * has) and Ask to upgrade for everyone else; who's invited, with Resend and Cancel; Remove. What licenses add is flow 16
 * (16.15–16.21). Checkout's payment is the stand-in's: the balance pays at once.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { away, holding, LAPTOP, LATER, pressable, SOON } from '../play';

const meta = { title: 'Journeys/10 Team/A team’s page', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** What Free means, once, at the top of a free team's water. */
const free = () => screen.findByRole('region', { name: 'Vandelay Industries is on Free.' }, LATER);
/** Who's invited and hasn't joined yet. */
const invited = () => screen.findByRole('region', { name: 'Invited' }, LATER);
/** Checkout, opened on upgrading the team. */
const upgrading = () => screen.findByRole('dialog', { name: 'Upgrade to Team' }, SOON);

export const ResendAndCancel: PageStory = {
  name: '10.27 Resend and cancel an invitation',
  ...page('/team', 'team-free-admin'),
  play: async ({ userEvent, step }) => {
    await step('Invited, under the team’s people, lists everyone asked who hasn’t joined, newest first: who asked them and when, and in an invitation’s last week when it runs out', async () => {
      await within(await invited()).findByText(/Runs out in 4 days$/, {}, SOON);
    });
    await step('Resend, on Sam’s, sends it again, and its 30 days start again', async () => {
      await userEvent.click(within(await invited()).getByRole('button', { name: 'Resend Sam Ortiz’s invitation' }));
      await screen.findByText('Sent Sam’s invitation again.', {}, SOON);
    });
    await step('Once a day at most, and three times in 30 days: until tomorrow it says Sent today, as Diego’s does, and Theo’s, sent three times, says so. Sam’s row stays where it was', async () => {
      await within(await holding('listitem', 'Sam Ortiz', SOON, within(await invited()))).findByRole('button', { name: /^Sent today/ }, SOON);
      await within(await holding('listitem', 'Theo Martin', SOON, within(await invited()))).findByRole('button', { name: /^Sent 3 times/ }, SOON);
    });
    await step('Cancel, on Lena’s, asks in place under her row: her link stops working', async () => {
      await userEvent.click(within(await invited()).getByRole('button', { name: 'Cancel Lena Fischer’s invitation' }));
      await screen.findByRole('group', { name: 'Cancel Lena’s invitation?' }, SOON);
    });
    await step('Cancel invitation. It’s gone from Invited, and her link leads nowhere', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Cancel Lena’s invitation?' })).getByRole('button', { name: 'Cancel invitation' }));
      await screen.findByText('Lena’s invitation is cancelled.', {}, SOON);
      await away('button', 'Cancel Lena Fischer’s invitation');
    });
  }
};

export const UpgradeFromFree: PageStory = {
  name: '10.28 Upgrade from Free',
  ...page('/team', 'team-free-admin'),
  play: async ({ userEvent, step }) => {
    await step('Art runs Vandelay Industries’ free team: Free · 3 people. With someone else on it, Upgrade, beside what Free means at the top of the water, is the page’s filled button', async () => {
      await userEvent.click(await pressable('button', 'Upgrade', LATER, within(await free())));
    });
    await step('Checkout opens on Team for the team, with nothing to name: a license for each of the three on it', async () => {
      await within(await upgrading()).findByRole('radio', { name: /^3 licenses/, checked: true }, LATER);
    });
    await step('Buy a license for each person who joins starts as the team has it, off: tick it, and it’s set with the purchase', async () => {
      await userEvent.click(await within(await upgrading()).findByRole('checkbox', { name: 'Buy a license for each person who joins', checked: false }, SOON));
    });
    await step('Three licenses for 30 days are $120, and Art’s balance has $180: Buy with your balance takes it from there, at once', async () => {
      await userEvent.click(await pressable('button', 'Buy with your balance', LATER, within(await upgrading())));
    });
    await step('Vandelay Industries is on Team, and Done says what happened: everyone has a license', async () => {
      await within(await upgrading()).findByText(/Everyone has a license/, {}, LATER);
    });
    await step('Done. The page is the team’s on Team: everyone under their license, and beside them its licenses, buying one for each person who joins', async () => {
      await userEvent.click(await pressable('button', 'Done', SOON, within(await upgrading())));
      await away('dialog', 'Upgrade to Team');
      await screen.findByRole('switch', { name: 'Buy a license for each person who joins', checked: true }, LATER);
    });
  }
};

export const AskTheAdmin: PageStory = {
  name: '10.30 Ask the admin to upgrade',
  ...page('/team', 'team-free-member'),
  play: async ({ userEvent, step }) => {
    await step('Art is on Priya’s free team. At the top of its water, once, what Free means: upgrading gives everyone on it a license', async () => {
      await free();
    });
    await step('Only Priya, its admin, can upgrade it. Ask Priya to upgrade tells her once, and nobody else', async () => {
      await userEvent.click(within(await free()).getByRole('button', { name: 'Ask Priya to upgrade' }));
    });
    await step('For a week it says Priya’s been asked in the button’s place. Priya is told at the top of Settings › Plan, with Upgrade', async () => {
      await within(await free()).findByText('Priya’s been asked', {}, SOON);
    });
  }
};

export const RenameTheTeam: PageStory = {
  name: '10.31 Rename the team',
  ...page('/team', 'team-free-admin'),
  play: async ({ userEvent, step }) => {
    await step('The pen beside the team’s name is its admin’s: Rename team', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Rename team' }, LATER));
    });
    await step('A popover opens with the name in its box. Type the new one', async () => {
      const name = within(await screen.findByRole('dialog', { name: 'Rename team' }, SOON)).getByRole('textbox', { name: 'Its name' });
      await userEvent.clear(name);
      await userEvent.type(name, 'Vandelay Studio');
    });
    await step('Rename. It’s the team’s name for everyone on it, in the sky and wherever the team is named', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Rename team' })).getByRole('button', { name: 'Rename' }));
      await screen.findByText('Renamed to Vandelay Studio.', {}, SOON);
      await screen.findByRole('heading', { name: 'Vandelay Studio', level: 2 }, SOON);
    });
  }
};

export const AskedToUpgrade: PageStory = {
  name: '10.35 Asked to upgrade, as its admin',
  ...page('/team', 'team-free-asked'),
  play: async ({ userEvent, step }) => {
    await step('Kofi asked Art to upgrade the team. What Free means says so at the top of the water, beside the page’s one Upgrade', async () => {
      await screen.findByRole('region', { name: 'Kofi asked you to upgrade.' }, LATER);
    });
    await step('Upgrade opens checkout on Team for the team', async () => {
      await userEvent.click(await pressable('button', 'Upgrade', SOON, within(await screen.findByRole('region', { name: 'Kofi asked you to upgrade.' }))));
      await upgrading();
    });
  }
};

export const RemoveSomeone: PageStory = {
  name: '10.36 Remove someone',
  ...page('/team', 'team-free-admin'),
  play: async ({ userEvent, step }) => {
    await step('Remove, on Kofi’s row, asks in place under it: Kofi leaves the team, and its invite link changes, so the new one goes to anyone still to join', async () => {
      await userEvent.click(await pressable('button', 'Remove Kofi Asante', LATER));
      await screen.findByRole('group', { name: 'Remove Kofi?' }, SOON);
    });
    await step('Remove Kofi: he leaves the horizon and the rows', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Remove Kofi?' })).getByRole('button', { name: 'Remove Kofi' }));
      await screen.findByText('Kofi is off the team.', {}, SOON);
      await away('button', 'Remove Kofi Asante');
    });
  }
};
