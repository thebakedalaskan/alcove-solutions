/*
 * Invitations to you, and the invite page (docs/product/user-flows.md › 10. Team: Invitations to you, The invite page). An
 * invitation reaches someone already on Alcove in the app as well as in its email: a toast once, Team's count, and a card on
 * Team. Someone new comes in by the email's link, or a team's, onto the invite page, and signing in from it joins. Storybook
 * can't put a secret in the page's address or open an email, so the link waits in the tab, as it does while signing in from
 * it (`withInviteLink`, `withInvitationLink`), and Microsoft's demo sign-in stands in for Google's.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { withInvitationLink, withInvitationToYourTeam, withInviteLink } from '../../../src/api/scenarios';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { away, holding, LAPTOP, LATER, pressable, SOON } from '../play';

const meta = { title: 'Journeys/10 Team/Invitations', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** Priya's invitation to Art, as its card's heading says it. */
const PRIYAS = 'Priya invited you to join Vandelay Industries';
/** An invitation's card on the Team page, by its heading. */
const card = (title: string) => screen.findByRole('region', { name: title }, LATER);
/** The side panel. */
const side = () => screen.findByRole('complementary', { name: 'Side panel' }, LATER);
/** On a team, an invitation to another is said at the top of the team's water. */
const note = () => screen.findByRole('region', { name: 'An invitation' }, LATER);

export const OpenATeamsInviteLink: PageStory = {
  name: '10.22 Open a team’s invite link and sign in',
  ...page('/invite', 'signed-out'),
  beforeEach: changing(withInviteLink()),
  play: async ({ userEvent, step }) => {
    await step('Priya’s team has one invite link, which anyone on it may have shared. It opens one card on the team’s evening: its faces, who’s on it, what Alcove is for, and the ways in', async () => {
      await screen.findByRole('heading', { name: 'Join Vandelay Industries on Alcove', level: 1 }, LATER);
    });
    await step('Continue with Microsoft, the demo’s stand-in for Google. Art’s account was there already, so the card comes back signed in, with Not now and Join', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Continue with Microsoft' }, SOON));
      await pressable('button', 'Join Vandelay Industries', LATER);
    });
    await step('Join Vandelay Industries: Art is on the team at once, and its page opens, saying so', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Join Vandelay Industries' }));
      await screen.findByText('You’re on Vandelay Industries.', {}, LATER);
      await screen.findByRole('list', { name: 'People on Vandelay Industries' }, LATER);
    });
  }
};

export const InvitedAlreadyOnAlcove: PageStory = {
  name: '10.24 Invited, already on Alcove',
  ...page('/home', 'invited'),
  play: async ({ userEvent, step }) => {
    await step('Priya invited Art to her team. Art is on Alcove, so it’s in the app as well as in its email: a toast, once in this browser, and Team in the side panel counts it', async () => {
      await screen.findByText(PRIYAS, {}, LATER);
      await within(await side()).findByRole('link', { name: /^Team\s*1$/ }, SOON);
    });
    await step('View opens Team, as Team in the side panel does. Priya’s card is at the top of the company’s water: the team’s faces, who’s on it, Not now and Join', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'View' }, SOON));
      await within(await card(PRIYAS)).findByText('Kofi, Aiko and 2 others are on it.', {}, SOON);
    });
    await step('Join Vandelay Industries: Art is on the team at once, and the page is the team’s', async () => {
      await userEvent.click(within(await card(PRIYAS)).getByRole('button', { name: 'Join Vandelay Industries' }));
      await screen.findByText('You’re on Vandelay Industries.', {}, SOON);
      await screen.findByRole('list', { name: 'People on Vandelay Industries' }, LATER);
    });
  }
};

export const NewFromTheEmail: PageStory = {
  name: '10.25 New to Alcove, from the invitation’s email',
  ...page('/invite', 'first-sign-in'),
  beforeEach: changing(withInvitationLink()),
  play: async ({ userEvent, step }) => {
    await step('Alcove emailed Priya’s invitation to an address with no account yet. Its link opens one card: who invited you, who’s on the team, what Alcove is for, and the ways in', async () => {
      await screen.findByRole('heading', { name: PRIYAS, level: 1 }, LATER);
    });
    await step('Continue with Microsoft. The account is new, and signing in from the card said yes: it joins Vandelay Industries at once', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Continue with Microsoft' }, SOON));
    });
    await step('Its first sign-in goes on as from the welcome page: the account is made on screen', async () => {
      await screen.findByRole('dialog', { name: 'Creating your account' }, LATER);
    });
    await step('“You’re in”, and the arch opens onto Home, not the plans: someone joining a team doesn’t choose one. Home says which team Art is on', async () => {
      await screen.findByRole('dialog', { name: /^You’re in/ }, LATER);
      await screen.findByText('You’re on Vandelay Industries.', {}, LATER);
    });
  }
};

export const NotNow: PageStory = {
  name: '10.26 Not now',
  ...page('/team', 'invited'),
  play: async ({ userEvent, step }) => {
    await step('Priya’s invitation is a card at the top of the company’s water, and Team in the side panel counts it', async () => {
      await card(PRIYAS);
      await within(await side()).findByRole('link', { name: /^Team\s*1$/ }, SOON);
    });
    await step('Not now folds the card away and puts it aside. Nobody is told: the team still lists Art as invited, whatever Art does with it', async () => {
      await userEvent.click(within(await card(PRIYAS)).getByRole('button', { name: 'Not now' }));
      await screen.findByText('Put aside. You can join it from Team until 4 Dec.', {}, SOON);
    });
    await step('It waits quietly under Put aside, beside Jonas’s from three days ago, its Join taking the focus, until it runs out. It’s left the side panel’s count', async () => {
      await within(await screen.findByRole('region', { name: 'Put aside' }, SOON)).findByRole('button', { name: 'Join Vandelay Industries' }, SOON);
      await within(await side()).findByRole('link', { name: 'Team' }, SOON);
    });
    await step('Undo, in the toast, while it stands: the card is back, its Join focused, and the count with it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Undo' }, SOON));
      await card(PRIYAS);
      await within(await side()).findByRole('link', { name: /^Team\s*1$/ }, SOON);
    });
  }
};

export const JoinWhileOnATeam: PageStory = {
  name: '10.29 Join while on a team',
  ...page('/team', 'team-member-invited'),
  play: async ({ userEvent, step }) => {
    await step('Art is on Priya’s team, and Jonas invited Art to Weber Design: it’s said at the top of the team’s water, with Not now and Join', async () => {
      await within(await note()).findByText('Jonas invited you to join Weber Design.', {}, SOON);
    });
    await step('Join Weber Design. Art is on one team at a time, so it asks in place first: joining takes Art off Vandelay Industries', async () => {
      await userEvent.click(within(await note()).getByRole('button', { name: 'Join Weber Design' }));
      await screen.findByRole('group', { name: 'Joining Weber Design takes you off Vandelay Industries.' }, SOON);
    });
    await step('Stay, or Escape, closes the question, and Join has the focus again', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Joining Weber Design takes you off Vandelay Industries.' })).getByRole('button', { name: 'Stay' }));
      await away('group', 'Joining Weber Design takes you off Vandelay Industries.');
    });
    await step('Join again, then Leave Vandelay Industries and join. Leaving and joining are one step, so Art is never between teams: the page is Weber Design’s, its name taking the focus', async () => {
      await userEvent.click(within(await note()).getByRole('button', { name: 'Join Weber Design' }));
      await userEvent.click(within(await screen.findByRole('group', { name: 'Joining Weber Design takes you off Vandelay Industries.' }, SOON)).getByRole('button', { name: 'Leave Vandelay Industries and join' }));
      await screen.findByText('You’re on Weber Design.', {}, SOON);
      await screen.findByRole('list', { name: 'People on Weber Design' }, LATER);
    });
  }
};

export const InvitedAtYourCompany: PageStory = {
  name: '10.32 Invited, at your company',
  ...page('/team', 'invited'),
  play: async ({ userEvent, step }) => {
    await step('Priya invited Art to her Vandelay Industries team, and Art is on none. Invite on a row doesn’t start another team: it goes to Priya’s card, its Join focused', async () => {
      const yet = await screen.findByRole('region', { name: 'Not on Alcove yet' }, LATER);
      await userEvent.click(within(await holding('listitem', 'Lena Fischer', SOON, within(yet))).getByRole('button', { name: 'Invite' }));
      await card(PRIYAS);
    });
    await step('Invite people says the same: join it first, then invite people from its page. Its Join is there too', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Invite people' }, SOON));
      const invite = await screen.findByRole('dialog', { name: 'Invite people to Vandelay Industries' }, SOON);
      await within(invite).findByText('Priya invited you to Vandelay Industries.', {}, SOON);
      await userEvent.click(within(invite).getByRole('button', { name: 'Join Vandelay Industries' }));
    });
    await step('Art is on Priya’s team, and the page is its own, with its people, its name taking the focus', async () => {
      await screen.findByText('You’re on Vandelay Industries.', {}, SOON);
      await screen.findByRole('list', { name: 'People on Vandelay Industries' }, LATER);
    });
  }
};

export const AnInvitationToYourTeam: PageStory = {
  name: '10.33 An invitation to the team you’re on',
  ...page('/invite', 'team-member'),
  beforeEach: changing(withInvitationToYourTeam),
  play: async ({ userEvent, step }) => {
    await step('Sam passed Art the link of his invitation to Vandelay Industries, the team Art is on. It says so: there’s nothing to join, and nothing to leave', async () => {
      await screen.findByRole('heading', { name: 'You’re on Vandelay Industries already', level: 1 }, LATER);
    });
    await step('Go to Team', async () => {
      await userEvent.click(await screen.findByRole('link', { name: 'Go to Team' }, SOON));
      await screen.findByRole('list', { name: 'People on Vandelay Industries' }, LATER);
    });
  }
};

export const NotNowFromItsLink: PageStory = {
  name: '10.34 Not now, from its link',
  ...page('/invite', 'busy'),
  beforeEach: changing(withInvitationLink()),
  play: async ({ userEvent, step }) => {
    await step('Priya’s invitation’s own link, opened signed in: Join, and Not now', async () => {
      await pressable('button', 'Join Vandelay Industries', LATER);
    });
    await step('Not now puts it aside, as on Team, and Home opens, the toast saying until when, with Undo. Team’s count doesn’t count it', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
      await screen.findByText('Put aside. You can join it from Team until 4 Dec.', {}, LATER);
      await within(await side()).findByRole('link', { name: 'Team' }, SOON);
    });
  }
};
