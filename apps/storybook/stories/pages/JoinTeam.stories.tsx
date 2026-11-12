/*
 * Joining a team by its link (/team/join, user-flows 10.23): the link joins nothing by itself. Signed in, it says whose team
 * it is and asks; Join takes a license if one is left and opens the Team page. Signed out, it asks you to sign in first, and
 * then asks the same. Storybook can't put a secret in the page's address, so the link waits in the tab, as it does while
 * signing in from it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { withTeamInvite } from '../../src/api/scenarios';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';

const meta = { title: 'Pages/Join a team', ...pages } satisfies Meta<PageArgs>;
export default meta;

const aLink = { beforeEach: changing(withTeamInvite()) };
const joining: PageStory['play'] = async ({ userEvent, step }) => {
  await step('Press Join', async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Join' }, { timeout: 8000 }));
  });
};

/** Signed in: "Join Vandelay Industries, Priya’s team?", with Join and Not now. */
export const AsksFirst = page('/team/join', 'team-join', aLink);
export const AsksFirstNight = page('/team/join', 'team-join', { ...aLink, globals: { theme: 'dark' } });
export const AsksFirstPhone = phone(AsksFirst);
/** Join: Art is on the team with one of its licenses, and the Team page opens. */
export const Joins = page('/team/join', 'team-join', { ...aLink, play: joining });
export const JoinsPhone = phone(Joins);
/** Signed out: sign in first, here. Signing in asks the same. */
export const SignInFirst = page('/team/join', 'signed-out', aLink);
export const SignInFirstNight = page('/team/join', 'signed-out', { ...aLink, globals: { theme: 'dark' } });
/** The link was used, or ran out: it says so in Alcove's words. */
export const RanOut = page('/team/join', 'team-join', { beforeEach: changing(withTeamInvite(true)) });
/** Art is on a team already: Join is refused, in Alcove's words. */
export const AlreadyOnATeam = page('/team/join', 'team-member', { ...aLink, play: joining });
/** Opened without the part after #, which is what joins the team. */
export const NoLink = page('/team/join', 'team-join');
