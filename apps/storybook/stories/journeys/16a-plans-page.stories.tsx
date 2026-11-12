/*
 * Journeys on the Plans page (docs/product/user-flows.md › 16. Plans and checkout), from the canvas's Plans journeys
 * (docs/design/canvas/plans/data-plans.js, "Choose Pro, from anywhere on Free"). Checkout itself, what Get Pro opens over the
 * page, has the journeys after these.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { LAPTOP, SOON } from './play';

const meta = { title: 'Journeys/16 Plans', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** The switch on the plans' sky. */
const cycle = () => screen.findByRole('group', { name: 'Prices for' }, SOON);
/** A plan's card, by its name. */
const plan = (name: string) => screen.findByRole('article', { name }, SOON);

export const SeeThePlans: PageStory = {
  name: '16.1 See the plans',
  ...page('/home', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('On Free, the side panel says how much of the period’s notes is left. Click See plans under it', async () => {
      const side = await screen.findByRole('complementary', { name: 'Side panel' }, SOON);
      await userEvent.click(await within(side).findByRole('link', { name: /See plans/ }, SOON));
    });
    await step('Plans opens: Free and Pro on the water, priced for a year. Get Pro is the one filled button', async () => {
      await screen.findByRole('heading', { name: 'Plans', level: 1 }, SOON);
      await within(await plan('Pro')).findByRole('button', { name: 'Get Pro' }, SOON);
    });
    await step('Click Monthly: Pro is $20 a month, for as many months as you choose, or $16 for a year or more', async () => {
      await userEvent.click(within(await cycle()).getByRole('button', { name: 'Monthly' }));
      await within(await plan('Pro')).findByText('$20', {}, SOON);
    });
    await step('Click Yearly · 20% off: $16 a month again, $192 for 12 months, and what that saves', async () => {
      await userEvent.click(within(await cycle()).getByRole('button', { name: /^Yearly/ }));
      await within(await plan('Pro')).findByText('$16', {}, SOON);
    });
    await step('Click Get Pro. Checkout opens over Plans, on 12 months', async () => {
      await userEvent.click(within(await plan('Pro')).getByRole('button', { name: 'Get Pro' }));
    });
  }
};
