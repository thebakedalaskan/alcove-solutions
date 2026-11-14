/*
 * The Team page on your own (docs/product/user-flows.md › 10. Team): at a personal address there's no company page, but Team
 * is in the side panel all the same, and with no team and no invitation waiting it starts one. Inviting a friend by email
 * starts it, named for you, free, with you its admin, and the page is the team's. No mail app opens: Alcove emails the
 * invitation, which the stand-in takes as the server would.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { away, LAPTOP, LATER, pressable, SOON } from '../play';

const meta = { title: 'Journeys/10 Team/On your own', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** Invite people's popover, named for the team inviting starts: yours, at a personal address. */
const inviting = () => screen.findByRole('dialog', { name: 'Invite people to Art’s team' }, SOON);

export const InviteAFriend: PageStory = {
  name: '10.37 On your own, invite a friend by email',
  ...page('/home', 'on-their-own'),
  play: async ({ userEvent, step }) => {
    await step('Art signs in with a personal address: no company, no team. Team is in the side panel all the same. Click it', async () => {
      const panel = await screen.findByRole('complementary', { name: 'Side panel' }, LATER);
      await userEvent.click(within(panel).getByRole('link', { name: 'Team' }));
    });
    await step('Start your team: invite people by email, or name it first. It’s free, and Art stands on the horizon beside empty arches', async () => {
      await screen.findByRole('heading', { name: 'Start your team', level: 2 }, LATER);
      await screen.findByText('Invite people by email, or name your team first. It’s free: licenses only when you want to share notes and workspaces.', {}, SOON);
    });
    await step('Invite people, the one filled button. Its popover is named for the team it starts, and says so once, before anything is sent', async () => {
      await userEvent.click(await pressable('button', 'Invite people', SOON));
      const invite = await inviting();
      await within(invite).findByText('Alcove emails them. This starts Art’s team, a free team, with you as its admin.', {}, SOON);
    });
    await step('Nobody to pick here: type a friend’s whole address. There’s no link to copy until there’s a team', async () => {
      const invite = await inviting();
      await userEvent.type(within(invite).getByRole('combobox', { name: 'Name or email' }), 'priya.raman@gmail.com');
      await away('button', 'Copy link');
    });
    await step('Invite 1. Alcove emails Priya, and that starts Art’s team: the toast says so', async () => {
      await userEvent.click(await pressable('button', 'Invite 1', SOON, within(await inviting())));
      await screen.findByText('Started Art’s team and invited Priya.', {}, SOON);
    });
    await step('The page is the team’s now, its name taking the focus, with Priya under Invited and Resend and Cancel beside her', async () => {
      await screen.findByRole('heading', { name: 'Art’s team', level: 2 }, LATER);
      const invited = await screen.findByRole('region', { name: 'Invited' }, LATER);
      await within(invited).findByText('priya.raman@gmail.com', {}, SOON);
    });
  }
};
