/*
 * Team: your company standing on the horizon, with the invitations to you at the top of its water, then your groups and the
 * people not on Alcove yet (user-flows 10); at a personal address, the invitations to you on the team's evening, or with none
 * waiting, Start your team. On no team, every Invite opens Invite people with its people ticked, which says before anything
 * is sent that inviting starts the team; while an invitation to you waits, it says to join that first.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { setOnline } from '../../../src/browser';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { invitedToday } from '../../../src/world/plans/team-invitations';
import { holding, pressable, SOON } from '../../journeys/play';
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

export const FirstDayNight: PageStory = { ...FirstDay, globals: { theme: 'dark' } };
export const FirstDayPhone = phone(FirstDay);
/** Your invite link hasn't come yet: Copy invite link waits for it. */
export const InviteLinkOnItsWay = page('/team', 'first-day', { beforeEach: changing(troubled({ 'people.inviteLink': 'hold' })) });
/** Your invite link didn't load: Copy invite link waits, and the sky says why under the buttons, with Try again. */
export const InviteLinkDidntLoad = page('/team', 'first-day', { beforeEach: changing(troubled({ 'people.inviteLink': 'failed' })) });
export const InviteLinkDidntLoadNight: PageStory = { ...InviteLinkDidntLoad, globals: { theme: 'dark' } };
export const InviteLinkDidntLoadPhone = phone(InviteLinkDidntLoad);
/** The connection went before your invite link came: copying it needs one, and waits for it. */
export const CopyingNeedsAConnection = page('/team', 'first-day', {
  beforeEach: changing(troubled({ 'people.inviteLink': 'hold' })),
  play: async ({ canvas, step }) => {
    await step('The page is here, then the connection goes, with your invite link still on its way', async () => {
      await canvas.findByRole('button', { name: 'Invite people' }, SOON);
      setOnline(false);
    });
  }
});
/** Make a new link?, asked in place in Invite people: the link you've sent stops working. */
export const MakeANewLink = page('/team', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Invite people, then New link, beside Copy link', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Invite people' }, SOON));
      await userEvent.click(await pressable('button', 'New link', SOON, within(await screen.findByRole('dialog', { name: /^Invite people/ }, SOON))));
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
/**
 * Someone on their own (a personal address: no company page, no team, no invitations): Start your team, what it costs in one
 * line, Invite people (filled) and Name your team, with Art on the horizon beside empty arches, the sun in one of them.
 */
export const OnTheirOwn = page('/team', 'on-their-own');
export const OnTheirOwnNight: PageStory = { ...OnTheirOwn, globals: { theme: 'dark' } };
export const OnTheirOwnPhone = phone(OnTheirOwn);
/**
 * Invite people, on your own: named for the team it starts, "Invite people to Art’s team", and saying so once under the
 * field. Nobody to tick, so the field takes whole addresses; and no link to copy until there's a team.
 */
export const InvitePeopleOnTheirOwn = page('/team', 'on-their-own', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Invite people, then type a friend’s address', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Invite people' }, SOON));
      const invite = await screen.findByRole('dialog', { name: 'Invite people to Art’s team' }, SOON);
      await userEvent.type(within(invite).getByRole('combobox', { name: 'Name or email' }), 'priya.raman@gmail.com');
    });
  }
});
export const InvitePeopleOnTheirOwnNight: PageStory = { ...InvitePeopleOnTheirOwn, globals: { theme: 'dark' } };
export const InvitePeopleOnTheirOwnPhone = phone(InvitePeopleOnTheirOwn);
/** Invite 1: the team starts, the page is Art’s team’s, Priya under Invited, and the toast says so: "Started Art’s team and invited Priya." */
export const StartedOnTheirOwn = page('/team', 'on-their-own', {
  play: async (context) => {
    await InvitePeopleOnTheirOwn.play?.(context);
    await context.step('Press Invite 1', async () => {
      await context.userEvent.click(await pressable('button', 'Invite 1', SOON, within(await screen.findByRole('dialog', { name: 'Invite people to Art’s team' }, SOON))));
    });
  }
});
export const StartedOnTheirOwnNight: PageStory = { ...StartedOnTheirOwn, globals: { theme: 'dark' } };
export const StartedOnTheirOwnPhone = phone(StartedOnTheirOwn);
/** Name your team: its name in a popover over the button, "Art’s team" to start with, and Start the team. */
export const NameYourTeam = page('/team', 'on-their-own', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Name your team', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Name your team' }, SOON));
    });
  }
});
export const NameYourTeamNight: PageStory = { ...NameYourTeam, globals: { theme: 'dark' } };
export const NameYourTeamPhone = phone(NameYourTeam);
/** Start the team, named: it's made, free, with Art its admin, and the page is the team's, its name taking the focus. */
export const NamedOnTheirOwn = page('/team', 'on-their-own', {
  play: async (context) => {
    await NameYourTeam.play?.(context);
    await context.step('Name it Book club, then Start the team', async () => {
      const naming = await screen.findByRole('dialog', { name: 'Name your team' }, SOON);
      const field = within(naming).getByRole('textbox', { name: 'Its name' });
      await context.userEvent.clear(field);
      await context.userEvent.type(field, 'Book club');
      await context.userEvent.click(within(naming).getByRole('button', { name: 'Start the team' }));
    });
  }
});

/** Priya's popover: when you're next in a call together, Ring, Schedule, and the notes you both have. */
export const APerson = page('/team', 'busy', { play: opening(/^Priya Raman$/, 'Press Priya’s arch') });
export const APersonPhone = phone(APerson);
/** Someone not on Alcove yet: Invite in place of Ring. */
export const NotOnAlcoveYet = page('/team', 'busy', { play: opening(/^Lena Fischer, not on Alcove yet$/, 'Press Lena’s dashed arch: she isn’t on Alcove yet') });
/** Your own arch: your address, the groups you're in, and Settings. */
export const You = page('/team', 'busy', { play: opening(/^You, /, 'Press your own arch, in the middle of the line') });
/**
 * Invite people, on a company page with no team: everyone at Vandelay not on a team to tick, or anyone's address to type, and
 * once, under the field, that inviting starts Vandelay Industries, a free team, with you as its admin.
 */
export const InvitePeople = page('/team', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Invite people', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Invite people' }));
    });
  }
});
export const InvitePeopleNight: PageStory = { ...InvitePeople, globals: { theme: 'dark' } };
export const InvitePeoplePhone = phone(InvitePeople);
/**
 * Invite, on Lena's row, with no team: Invite people opens beside it with Lena ticked, and says once, before anything is
 * sent, that inviting starts Vandelay Industries, a free team, with Art its admin.
 */
export const InviteFromTheirRow = page('/team', 'busy', {
  play: async ({ userEvent, step }) => {
    await step('Press Invite on Lena’s row, under Not on Alcove yet', async () => {
      const yet = await screen.findByRole('region', { name: 'Not on Alcove yet' }, SOON);
      await userEvent.click(within(await holding('listitem', 'Lena Fischer', SOON, within(yet))).getByRole('button', { name: 'Invite' }));
    });
  }
});
export const InviteFromTheirRowNight: PageStory = { ...InviteFromTheirRow, globals: { theme: 'dark' } };
export const InviteFromTheirRowPhone = phone(InviteFromTheirRow);
/** Invite, in Lena's popover, with no team: the sky's Invite people opens with her ticked, saying so first. */
export const InviteFromTheirArch = page('/team', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Lena’s dashed arch, then Invite in her popover', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: /^Lena Fischer, not on Alcove yet$/ }, SOON));
      await userEvent.click(await pressable('button', 'Invite', SOON, within(await screen.findByRole('dialog', { name: 'Lena Fischer' }, SOON))));
    });
  }
});
/** Invite 1, from there: the team is started, the page is its own, and the toast says so: "Started Vandelay Industries and invited Lena." */
export const StartedByInviting = page('/team', 'busy', {
  play: async (context) => {
    await InviteFromTheirRow.play?.(context);
    await context.step('Press Invite 1', async () => {
      await context.userEvent.click(await pressable('button', 'Invite 1', SOON, within(await screen.findByRole('dialog', { name: /^Invite people/ }, SOON))));
    });
  }
});
/**
 * Art has invited eighteen people today: of the three ticked now only two fit in today's twenty, so they're invited, and the
 * toast says the other one can be tomorrow. Inviting started the team, which it says first.
 */
export const OverTodaysInvitations = page('/team', 'busy', {
  beforeEach: changing((w) => { invitedToday(w, 18); }),
  play: async ({ userEvent, step }) => {
    await step('Press Invite all 3, then Invite 3', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Invite all 3' }, SOON));
      await userEvent.click(await pressable('button', 'Invite 3', SOON, within(await screen.findByRole('dialog', { name: /^Invite people/ }, SOON))));
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

/* ---------- invitations to you, on no team ---------- */

/**
 * Priya invited Art to her team, Vandelay Industries: its card stands at the top of the company page's water, its Join the
 * page's filled button, and Jonas's invitation, put aside three days ago, waits under Put aside at the water's foot.
 */
export const Invited = page('/team', 'invited');
export const InvitedNight: PageStory = { ...Invited, globals: { theme: 'dark' } };
export const InvitedPhone = phone(Invited);
/** Join: Art is on Vandelay Industries at once, the page is the team's, and a toast says so. */
export const JoinedFromTheCard = page('/team', 'invited', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Join Vandelay Industries on Priya’s card', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Join Vandelay Industries' }, { timeout: 8000 }));
    });
  }
});
/**
 * Not now: the card folds away, and the invitation waits quietly under Put aside with Join still there (its Join takes the
 * focus), out of the side panel's count; the toast says until when, with Undo.
 */
export const NotNow = page('/team', 'invited', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Not now on Priya’s card', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Not now' }, { timeout: 8000 }));
    });
  }
});
export const NotNowPhone = phone(NotNow);
/** While Priya's invitation waits, Invite people says to join it first, with its Join: nothing here starts another team. */
export const InvitePeopleWhileInvited = page('/team', 'invited', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Invite people', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Invite people' }, { timeout: 8000 }));
    });
  }
});
export const InvitePeopleWhileInvitedNight: PageStory = { ...InvitePeopleWhileInvited, globals: { theme: 'dark' } };
/** Invite on a row while it waits: the page goes to Priya's card, its Join focused. */
export const InviteFromARowWhileInvited = page('/team', 'invited', {
  play: async ({ userEvent, step }) => {
    await step('Press Invite on Lena’s row, under Not on Alcove yet', async () => {
      const yet = await screen.findByRole('region', { name: 'Not on Alcove yet' }, SOON);
      await userEvent.click(within(await holding('listitem', 'Lena Fischer', SOON, within(yet))).getByRole('button', { name: 'Invite' }));
    });
  }
});
/**
 * At a personal address, with no team: the Team page is the invitations to Art, on the team's evening: Jonas's to Weber
 * Design, and Ana's to Souza Law, put aside yesterday.
 */
export const InvitedOnTheirOwn = page('/team', 'invited-personal');
export const InvitedOnTheirOwnNight: PageStory = { ...InvitedOnTheirOwn, globals: { theme: 'dark' } };
export const InvitedOnTheirOwnPhone = phone(InvitedOnTheirOwn);
/** The invitations on their way, at a personal address: it waits for them. */
export const InvitationsOnTheirWay = page('/team', 'invited-personal', { beforeEach: changing(troubled({ 'teams.invitations': 'hold' })) });
/** They didn't come: why, and Try again. */
export const InvitationsDidntLoad = page('/team', 'invited-personal', { beforeEach: changing(troubled({ 'teams.invitations': 'failed' })) });

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
