/*
 * Team on Plans (docs/product/user-flows.md › 16. Plans and paying, 16.15). A team is free to start, named in a popover from
 * Team's card: nothing is bought, and its page opens, where people are invited and it's upgraded (16.16, in 16f-your-team).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { away, LAPTOP, LATER, SOON } from '../play';

const meta = { title: 'Journeys/16 Plans and paying/Team', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** A plan's card on Plans, by its name. */
const plan = (name: string) => screen.findByRole('article', { name }, SOON);
/** Start a team's name, in the popover over Team's card. */
const starting = () => screen.findByRole('form', { name: 'Start a team' }, SOON);

export const StartATeam: PageStory = {
  name: '16.15 Start a team',
  ...page('/plans', 'on-their-own'),
  play: async ({ userEvent, step }) => {
    await step('On Plans, priced for a year, Team is licenses: $32 a person a month, $384 a person for 12 months. With no team, its card has Start a team, and under it: Free to start. Licenses only when you upgrade.', async () => {
      await within(await plan('Team')).findByText('$32', {}, SOON);
      await within(await plan('Team')).findByText('Free to start. Licenses only when you upgrade.', {}, SOON);
      await userEvent.click(await within(await plan('Team')).findByRole('button', { name: 'Start a team' }, SOON));
    });
    await step('Its name opens in a popover over the card, so the cards stay as they were: at a personal address, “Art’s team” to start with, with Art its admin', async () => {
      await within(await starting()).findByDisplayValue('Art’s team', {}, SOON);
    });
    await step('Start the team. Nothing is bought: licenses are for a team that exists. It’s made, free, and its page opens', async () => {
      await userEvent.click(within(await starting()).getByRole('button', { name: 'Start the team' }));
      await screen.findByRole('heading', { name: 'Art’s team', level: 2 }, LATER);
    });
    await step('In its sky, Invite people asks people onto it, the page’s one filled button. Alone on it, there’s no Upgrade yet: it comes with someone else, beside what Free means (16.16)', async () => {
      const sky = await screen.findByRole('region', { name: 'Art’s team' }, SOON);
      await within(sky).findByRole('button', { name: 'Invite people' }, SOON);
      await away('button', 'Upgrade');
    });
  }
};
