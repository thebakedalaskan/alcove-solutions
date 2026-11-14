/* Team: your company standing on the horizon, your groups and the people not on Alcove yet on the water (user-flows 10). */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { setOnline } from '../../../src/browser';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { iso } from '../../../src/world/clock';
import { artsLink } from '../../../src/world/invite-links';
import { JONAS } from '../../../src/world/people';
import type { World } from '../../../src/world/world';
import { keepMail, pressable, SOON } from '../../journeys/play';
import { troubled } from '../changes';

const meta = { title: 'Pages/Team/Team', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Presses someone's arch on the line: their popover opens under it, or a sheet on a phone. */
const opening = (who: RegExp, said: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await canvas.findByRole('button', { name: who }));
  });
};

export const Busy = page('/team', 'busy');
export const BusyPhone = phone(Busy);
export const FirstDay = page('/team', 'first-day');

/** Only Aiko has joined from Art's invite link. */
const oneJoined = (w: World): void => { if (w.inviteLink) w.inviteLink.joined = w.inviteLink.joined.slice(0, 1); };
/** Jonas, who works elsewhere, made his account from Art's link this morning, though nobody at Vandelay is on Alcove yet. */
const jonasJoined = (w: World): void => { w.inviteLink = artsLink([{ person: JONAS, at: iso(0, 9, 30) }]); };
/** Aiko and Maya made their accounts from Art's invite link: their faces, and "Aiko and Maya joined from your link", under the buttons. */
export const JoinedFromYourLink = page('/team', 'busy');
export const JoinedFromYourLinkNight: PageStory = { ...JoinedFromYourLink, globals: { theme: 'dark' } };
export const JoinedFromYourLinkPhone = phone(JoinedFromYourLink);
/** One person: "Aiko joined from your link". */
export const OneJoinedFromYourLink = page('/team', 'busy', { beforeEach: changing(oneJoined) });
/** The first day, with Copy invite link beside Invite people, and someone from elsewhere joined from it already. */
export const FirstDaySomeoneJoined = page('/team', 'first-day', { beforeEach: changing(jonasJoined) });
export const FirstDaySomeoneJoinedPhone = phone(FirstDaySomeoneJoined);
/** Your invite link hasn't come yet: Copy invite link and every Invite wait for it, rather than send anything without it. */
export const InviteLinkOnItsWay = page('/team', 'first-day', { beforeEach: changing(troubled({ 'people.inviteLink': 'hold' })) });
/** Your invite link didn't load: the invites wait, and the sky says why under the buttons, with Try again. */
export const InviteLinkDidntLoad = page('/team', 'first-day', { beforeEach: changing(troubled({ 'people.inviteLink': 'failed' })) });
export const InviteLinkDidntLoadNight: PageStory = { ...InviteLinkDidntLoad, globals: { theme: 'dark' } };
export const InviteLinkDidntLoadPhone = phone(InviteLinkDidntLoad);
/** The connection went before your invite link came: the invites need one, and wait for it. */
export const InvitesNeedAConnection = page('/team', 'busy', {
  beforeEach: changing(troubled({ 'people.inviteLink': 'hold' })),
  play: async ({ canvas, step }) => {
    await step('The team is here, then the connection goes, with your invite link still on its way', async () => {
      await canvas.findByRole('button', { name: 'Invite people' }, SOON);
      setOnline(false);
    });
  }
});
/** Make a new link?, asked in place in Invite people: the link you've sent stops working, and who joined from it stays listed. */
export const MakeANewLink = page('/team', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Invite people, then the arrow beside Copy link: Make a new link', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Invite people' }, SOON));
      await userEvent.click(await pressable('button', 'Make a new link', SOON, within(await screen.findByRole('dialog', { name: 'Invite people' }, SOON))));
    });
  }
});
export const MakeANewLinkNight: PageStory = { ...MakeANewLink, globals: { theme: 'dark' } };
export const MakeANewLinkPhone = phone(MakeANewLink);
export const Lots = page('/team', 'lots');
/** A group open, from its tile under the water. */
export const AGroup = page('/team?group=g-product', 'busy');
/** Deleting a group asks once, in a popover, and can be undone for a few seconds after. */
export const DeleteAGroup = page('/team?group=g-product', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Delete Product. It asks once', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Delete Product' }, { timeout: 8000 }));
    });
  }
});
/** A new group being made: name it, then fill it. */
export const NewGroup = page('/team?group=new', 'busy');
/** Someone on their own has no team: the address goes Home. */
export const OnTheirOwn = page('/team', 'on-their-own');

/** Priya's popover: when you're next in a call together, Ring, Schedule, and the notes you both have. */
export const APerson = page('/team', 'busy', { play: opening(/^Priya Raman$/, 'Press Priya’s arch') });
export const APersonPhone = phone(APerson);
/** Someone not on Alcove yet: Invite in place of Ring. */
export const NotOnAlcoveYet = page('/team', 'busy', { play: opening(/^Lena Fischer, not on Alcove yet$/, 'Press Lena’s dashed arch: she isn’t on Alcove yet') });
/** Your own arch: your address, the groups you're in, and Settings. */
export const You = page('/team', 'busy', { play: opening(/^You, /, 'Press your own arch, in the middle of the line') });
/** Invite people: tick the colleagues not on Alcove yet, or type anyone's address. */
export const InvitePeople = page('/team', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Invite people', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Invite people' }));
    });
  }
});
/**
 * On no team, the invite that makes three of you (Art, Priya and Diego): it goes as ever, and Team is offered once beside it,
 * with See Team, which opens checkout on Team (user-flows 16.21; the canvas's Doors board, door 8).
 */
export const TheThirdInvite = page('/team', 'first-day', {
  beforeEach: keepMail,
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Invite people, and tick Priya and Diego: with you, that makes three', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Invite people' }, SOON));
      const invite = await screen.findByRole('dialog', { name: 'Invite people' }, SOON);
      await userEvent.click(await within(invite).findByRole('option', { name: /^Priya Raman/ }, SOON));
      await userEvent.click(await within(invite).findByRole('option', { name: /^Diego Ruiz/ }, SOON));
    });
    await step('Invite 2 opens your email to both, and Team is offered beside it, once', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Invite people' })).getByRole('button', { name: 'Invite 2' }));
      await screen.findByText(/^That makes 3 of you\./, {}, SOON);
    });
  }
});
/** Past thirteen people the far ones recede: All 33 people finds anyone. */
export const AllPeople = page('/team', 'lots', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press All people, to find anyone at Vandelay', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: /^All \d+ people$/ }));
    });
  }
});

/** The team is on its way: empty arches wait on the line beside you. */
export const Loading = page('/team', 'busy', { beforeEach: changing(troubled({ 'people.team': 'hold' })) });
/** The connection went before the team arrived: it shows when you're back. */
export const OfflineBeforeItLoaded = page('/team', 'busy', {
  beforeEach: changing(troubled({ 'people.team': 'hold' })),
  play: async ({ canvas, step }) => {
    await step('The connection drops while the team is on its way', async () => {
      await canvas.findByRole('heading', { name: 'Your team' }, { timeout: 8000 });
      setOnline(false);
    });
  }
});
/** The team didn't load: why, and Try again. Your groups didn't either, and their section says so. */
export const DidntLoad = page('/team', 'busy', { beforeEach: changing(troubled({ 'people.team': 'failed', 'account.preferences': 'failed' })) });
/** Opened without a connection: Team needs one, and Record still works. */
export const Offline = page('/team', 'offline');
