/*
 * Journeys on a team (docs/product/user-flows.md › 16. Plans and paying, 16.16 and 16.17; the canvas's StepsPlans board,
 * docs/design/canvas/plans/data-plans.js: Joining by an invite, Licenses running low). Joining plays from the invite's page
 * signed out, as someone who was sent the link; Storybook can't put a secret in the page's address, so the invite waits in
 * the tab, as it does while signing in from it, and Microsoft's demo sign-in stands in for Google's. The team's page plays as
 * its admin, with Maya waiting for a license.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { withTeamInvite } from '../../../src/api/scenarios';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { away, LAPTOP, LATER, pressable, SOON } from '../play';

const meta = { title: 'Journeys/16 Plans and paying/Your team', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** The card the invite's page is: its heading says what it is. */
const card = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name }, LATER);

export const JoinByItsLink: PageStory = {
  name: '16.16 Join a team by its link',
  ...page('/team/join', 'signed-out'),
  beforeEach: changing(withTeamInvite()),
  play: async ({ userEvent, step }) => {
    await step('An invite opens a page of its own, on the team’s evening. Signed out, it asks you to sign in first: the invite waits in this tab', async () => {
      await card('Join a team?');
    });
    await step('Sign in. Google’s way back comes here too; in Storybook, Microsoft’s demo sign-in stands in for it', async () => {
      await userEvent.click(await pressable('button', /Continue with Microsoft/, LATER));
    });
    await step('Whose team it is, and what joining gives you: notes of your own, what the team shares, its storage. Nothing happens until Join', async () => {
      await card('Join Vandelay Industries?');
    });
    await step('Join: one of its licenses is yours now, for 30 days', async () => {
      await userEvent.click(await pressable('button', 'Join Vandelay Industries', SOON));
      await card('You’re on Vandelay Industries');
    });
    await step('Open Alcove: the team’s page, with you on it under your license', async () => {
      await userEvent.click(await screen.findByRole('link', { name: 'Open Alcove' }, SOON));
      await screen.findByRole('region', { name: 'People on Vandelay Industries' }, LATER);
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
    await step('Or buy one whenever it’s needed, from your balance', async () => {
      await userEvent.click(await screen.findByRole('switch', { name: 'Buy one when it’s needed' }, SOON));
    });
    await step('Make an invite link: it lets one person join, for a day. Copy it and send it to them; each press of Make another makes a new one', async () => {
      await userEvent.click(await pressable('button', 'Make an invite link', SOON));
      const link = await screen.findByRole('group', { name: 'Link to join the team' }, SOON);
      await userEvent.click(within(link).getByRole('button', { name: 'Copy' }));
    });
    await step('Remove asks in place, under their row: their license isn’t refunded, and notes they made visible stay', async () => {
      await userEvent.click(await pressable('button', 'Remove Maya Chen', SOON));
      await screen.findByRole('group', { name: 'Take Maya off Vandelay Industries?' }, SOON);
    });
    await step('Take off the team: Maya leaves the horizon and the list', async () => {
      await userEvent.click(await pressable('button', 'Take off the team', SOON));
      await away('button', 'Remove Maya Chen');
    });
  }
};
