/*
 * Team in the side panel and in Settings › Plan (docs/product/user-flows.md › 16. Plans and paying), from the canvas's
 * journeys "Licenses running low" and "On a team without a license" (docs/design/canvas/plans/data-plans.js), and a free
 * team's admin asked to upgrade it (16.21). Buying licenses happens in checkout, which other journeys of the section play.
 * The team's side (its admin buying more, a license taken on your next visit, a member asking) is played by the stand-in,
 * and the page picks it up as it does from Alcove: the plan is read again every minute.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { current } from '../../../src/api/state';
import { visit } from '../../../src/api/account/teams';
import { page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { LICENSE_PRICE } from '../../../src/world/plans/plans';
import { addLicenses } from '../../../src/world/plans/teams';
import { away, first, LAPTOP, LATER, SOON } from '../play';

const meta = { title: 'Journeys/16 Plans and paying/Team in Settings', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** Settings › Plan. */
const plan = () => screen.findByRole('region', { name: 'Plan' }, LATER);
/** A row of a panel, by its label. */
const row = (name: string | RegExp) => screen.findByRole('group', { name }, LATER);
/** The side panel. */
const side = () => screen.findByRole('complementary', { name: 'Side panel' }, LATER);
/** Long enough for Alcove to read the plan again (every minute). */
const POLL = { timeout: 70_000 };

/** From any page, your face at the top right opens your menu, and its Settings opens Settings; the index goes to Plan. */
const toPlan = async (click: (el: Element) => Promise<void>) => {
  await click(await screen.findByRole('button', { name: /^Art Vandelay, your menu/ }, LATER));
  await click(await within(await screen.findByRole('dialog', { name: 'Your menu' }, SOON)).findByRole('link', { name: 'Settings' }, SOON));
  await click(within(await screen.findByRole('navigation', { name: 'Settings' }, LATER)).getByRole('link', { name: 'Plan' }));
  await plan();
};

export const LicensesRunningLow: PageStory = {
  name: '16.18 Licenses running low',
  ...page('/home', 'team-admin-low'),
  play: async ({ userEvent, step }) => {
    await step('Under five left, the side panel’s Team row says how many, in warm, with Buy. Only the team’s admin sees it', async () => {
      await within(await side()).findByRole('button', { name: /2 licenses left · Buy/ }, LATER);
    });
    await step('Click it. Checkout opens on Team, to buy more, over the page you’re on', async () => {
      await userEvent.click(within(await side()).getByRole('button', { name: /2 licenses left · Buy/ }));
      await screen.findByRole('dialog', {}, SOON);
    });
    await step('Close it, and open Settings at your plan. The licenses running low are said at the top, and Licenses says how many are left of how many, with Buy licenses', async () => {
      await userEvent.keyboard('{Escape}');
      await toPlan((el) => userEvent.click(el));
      await within(await plan()).findByText('2 licenses left on Vandelay Industries. Buy more so nobody is left without one.', {}, SOON);
      await within(await row('Licenses')).findByText(/^2 of 7 left\./, {}, SOON);
    });
    await step('Press Refund beside the licenses nobody has taken. It asks in place: what goes back to your balance, and what happens when someone needs one then', async () => {
      await userEvent.click(within(await row('Refund 2 licenses nobody has taken')).getByRole('button', { name: 'Refund' }));
      await screen.findByText('Refund 2 licenses nobody has taken?', {}, SOON);
    });
    await step('Keep them', async () => {
      await userEvent.click(within(await plan()).getByRole('button', { name: 'Keep them' }));
    });
    await step('Turn on Buy a license for each person who joins: from now on, whoever needs a license when none is left gets one from your balance, so there’s nothing to buy ahead, and the notice goes. It’s kept, and Saved shows beside it', async () => {
      await userEvent.click(within(await row('Buy a license for each person who joins')).getByRole('switch', { name: 'Buy a license for each person who joins' }));
      await within(await row('Buy a license for each person who joins')).findByText('Saved', {}, SOON);
    });
    await step('The side panel’s Team row says the team’s name again', async () => {
      await within(await side()).findByRole('link', { name: /^Team\s*Vandelay Industries/ }, SOON);
    });
  }
};

export const OnATeamWithoutALicense: PageStory = {
  name: '16.19 On a team without a license',
  ...page('/home', 'team-member-unlicensed'),
  play: async ({ userEvent, step }) => {
    await step('None was left when you opened Alcove. The side panel says so in caution over your own plan, with who has been told: Priya. Free’s row under your notes left says Team, which opens it', async () => {
      await within(await side()).findByText('No team license yet', {}, LATER);
      await within(await side()).findByText('Priya has been told', {}, SOON);
      await within(await side()).findByRole('link', { name: /^Free plan\s*Team$/ }, SOON);
    });
    await step('Open Settings at your plan. It says it once, at the top, over Free', async () => {
      await toPlan((el) => userEvent.click(el));
      await within(await plan()).findByText(/^You’re on Vandelay Industries, but none of its licenses was left for you/, {}, SOON);
    });
    await step('Priya buys more, and the next time you open Alcove one is yours. When Alcove next reads your plan, it’s Team: your license runs a period, and Priya buys them', async () => {
      const w = current();
      if (w.myTeam) addLicenses(w.myTeam, 2, LICENSE_PRICE);
      visit(w);
      await within(await plan()).findByText(/Your license runs to .+; Priya buys them\.$/, {}, POLL);
    });
    await step('The side panel’s foot is Team’s own row now, its small sun up, over the team’s name', async () => {
      await within(await side()).findByRole('link', { name: /^Team\s*Vandelay Industries/ }, SOON);
    });
    await step('Click Open Team: the team’s people, and the notes they made visible to it', async () => {
      await userEvent.click(within(await plan()).getByRole('link', { name: 'Open Team' }));
    });
  }
};

export const AskedToUpgrade: PageStory = {
  name: '16.21 Asked to upgrade',
  ...page('/home', 'team-free-asked'),
  play: async ({ userEvent, step }) => {
    await step('Kofi, on the free team Art runs, asked Art to upgrade it. Only Art, its admin, is told: in one short line over the plan in the side panel', async () => {
      await within(await side()).findByRole('link', { name: /^Kofi asked you to upgrade/ }, LATER);
    });
    await step('It opens Settings at Plan, which says it at the top until it’s dismissed. Upgrade is in Licenses, beside what upgrading gives: the page’s one Upgrade', async () => {
      await userEvent.click(within(await side()).getByRole('link', { name: /^Kofi asked you to upgrade/ }));
      await within(await plan()).findByText('Kofi asked you to upgrade Vandelay Industries.', {}, SOON);
    });
    await step('Upgrade opens checkout on Team for the team: a license for each of the three on it, as 16.16 buys them', async () => {
      await userEvent.click(await first(within(await plan()).findAllByRole('button', { name: 'Upgrade' }, SOON)));
      await within(await screen.findByRole('dialog', { name: 'Upgrade to Team' }, SOON)).findByRole('radiogroup', { name: 'How many licenses' }, LATER);
    });
    await step('Close it for now, and dismiss the notice. It goes from the side panel too', async () => {
      await userEvent.keyboard('{Escape}');
      await away('dialog', 'Upgrade to Team');
      await userEvent.click(within(await plan()).getByRole('button', { name: 'Dismiss this notice' }));
      await away('link', /^Kofi asked you to upgrade/);
    });
  }
};
