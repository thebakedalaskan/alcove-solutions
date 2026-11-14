/*
 * A team's page (user-flows 10 and 16.17; the canvas's TeamPlan board): the Team page while you're on a team. Its name in the
 * sky, with Rename for its admin, over its tier and how many are on it, then Invite people; its people on the horizon (under
 * their licenses on Team), then whoever's invited in dashed arches, and the colleagues not on it further back; on the water
 * what Free means (with the page's one Upgrade, for its admin, once someone else is on it), an invitation to another team,
 * its people, who's invited, the colleagues not on it yet, the notes visible to it, and your groups; beside them, for the
 * admin of a team on Team (or one buying a license for each person who joins), its licenses. Free and on Team, as its admin
 * and as a member, with a license and waiting for one, and what's asked in place.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { iso } from '../../../src/world/clock';
import type { World } from '../../../src/world/world';
import { MANY } from '../../../src/world/people';
import { priyaInvitesArt } from '../../../src/world/plans/team-invitations';
import type { TeamMemberWorld } from '../../../src/world/plans/teams';
import { SOON } from '../../journeys/play';
import { troubled } from '../changes';

const meta = { title: 'Pages/Team/Team on a plan', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The same story at night. */
const night = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, theme: 'dark' } });
/** The same story on a tablet's width, or a wide screen's. */
const tablet = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, viewport: { value: 'tablet', isRotated: false } } });
const wide = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, viewport: { value: 'wide', isRotated: false } } });
/** Presses a button on the page (or a switch), as a person would. */
const pressing = (name: string | RegExp, said: string, role: 'button' | 'switch' = 'button'): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await canvas.findByRole(role, { name }, { timeout: 8000 }));
  });
};

/** Nobody but Art left on the team: Delete team can be pressed. */
const alone = (w: World): void => { if (w.myTeam) w.myTeam.members = w.myTeam.members.filter((m) => m.role === 'admin'); };
/** Nobody on the team has made a note visible to it yet. */
const nothingVisible = (w: World): void => {
  if (w.myTeam) w.myTeam.notes = [];
  w.notes = w.notes.map((n) => ({ ...n, teamVisible: false }));
};
/** Eighteen people on the team: ten stand on the horizon, and an empty arch says how many more. */
const bigTeam = (w: World): void => {
  const t = w.myTeam;
  if (!t) return;
  const more = MANY.filter((c) => !t.members.some((m) => m.person.email === c.person.email)).slice(0, 12);
  t.members = [...t.members, ...more.map((c, i): TeamMemberWorld => ({
    id: `tm-more-${i}`, person: c.person, role: 'member', license: { from: iso(-3 - i, 9, 0), until: iso(27 - i, 9, 0) }, wanted: null, joinedAt: iso(-20, 10, 0)
  }))];
};

/* ------------------------------------------------------------------ as its admin */

/**
 * Art runs Vandelay's team: its six people on the horizon under their licenses (Maya's ended last week), the people as rows
 * with Remove, who's invited (Sam and Lena), the notes visible to the team, and beside them three licenses left. The water is at
 * most 1120px, centred under the team, as the board has it (Wide). Where the cards would squeeze the people (Tablet, 1024
 * with the side panel), they fold under them, side by side; on a phone they stand one under another, and the line wraps
 * onto a second row, its first on the horizon.
 */
export const AsAdmin = page('/team', 'team-admin');
export const AsAdminNight = night(AsAdmin);
export const AsAdminPhone = phone(AsAdmin);
export const AsAdminPhoneNight = night(AsAdminPhone);
export const AsAdminTablet = tablet(AsAdmin);
export const AsAdminTabletNight = night(AsAdminTablet);
export const AsAdminWide = wide(AsAdmin);
export const AsAdminWideNight = night(AsAdminWide);
/** Two licenses left: the head and the licenses say so. */
export const LicensesLow = page('/team', 'team-admin-low');
/** None left, and Maya waiting for one: Maya waits on the horizon and in their row, and Buy licenses is filled. */
export const SomeoneWaiting = page('/team', 'team-admin-none');
export const SomeoneWaitingNight = night(SomeoneWaiting);
export const SomeoneWaitingPhone = phone(SomeoneWaiting);
export const SomeoneWaitingTablet = tablet(SomeoneWaiting);
/** Buy licenses opens checkout on Team, over the page. */
export const BuyLicenses = page('/team', 'team-admin-none', { play: pressing('Buy licenses', 'Press Buy licenses: checkout opens over the page') });
/** Buying a license for each person who joins, turned on. */
export const BuyWhenNeeded = page('/team', 'team-admin', { play: pressing('Buy a license for each person who joins', 'Turn on Buy a license for each person who joins', 'switch') });
/** Invite people on a team on Team: the colleagues not on it to tick, Copy link (the team's) and, for its admin, Make a new link. */
export const InvitePeopleOnTeam = page('/team', 'team-admin', { play: pressing('Invite people', 'Press Invite people') });
export const InvitePeopleOnTeamNight = night(InvitePeopleOnTeam);
/**
 * Remove asks in place, under Maya's row: she leaves the team, and its invite link changes, so the new one goes to anyone
 * still to join; her license isn't refunded. On a phone the answers stand one over the other, Keep Maya first, clear of the
 * tab bar.
 */
export const RemoveAsked = page('/team', 'team-admin', { play: pressing('Remove Maya Chen', 'Press Remove on Maya’s row') });
export const RemoveAskedNight = night(RemoveAsked);
export const RemoveAskedPhone = phone(RemoveAsked);
/** Only Art is left on it: Delete team, asked in place, says the licenses nobody took go back to Art's balance. */
export const DeleteTeamAsked = page('/team', 'team-admin', { beforeEach: changing(alone), play: pressing('Delete team', 'Press Delete team') });
/** Someone on the horizon opens their popover, as on a company's line: Ring, Schedule and the notes you both have. */
export const APerson = page('/team', 'team-admin', { play: pressing(/^Priya Raman$/, 'Press Priya’s arch') });
/** Eighteen on the team: ten stand on the horizon, and the rest are an empty arch at its end. Every one is a row. */
export const ABigTeam = page('/team', 'team-admin', { beforeEach: changing(bigTeam) });
export const ABigTeamPhone = phone(ABigTeam);

/* ------------------------------------------------------------------ as a member */

/** Art on Priya's team with a live license: the people, Leave team at their foot, and the notes visible to the team. */
export const AsMember = page('/team', 'team-member');
export const AsMemberNight = night(AsMember);
export const AsMemberPhone = phone(AsMember);
/** Leave team asks in place of the foot. */
export const LeaveAsked = page('/team', 'team-member', { play: pressing('Leave team', 'Press Leave team') });
export const LeaveAskedNight = night(LeaveAsked);
/** Waiting for a license: why the team's notes and workspaces aren't open, said once at the top of the water. */
export const WithoutALicense = page('/team', 'team-member-unlicensed');
export const WithoutALicenseNight = night(WithoutALicense);
export const WithoutALicensePhone = phone(WithoutALicense);
/** Nobody has made a note visible to the team yet: how to. */
export const NothingVisibleYet = page('/team', 'team-member', { beforeEach: changing(nothingVisible) });
/** The notes visible to the team didn't load: why, and Try again. The rest of the page works. */
export const NotesDidntLoad = page('/team', 'team-member', { beforeEach: changing(troubled({ 'teams.notes': 'failed' })) });

/* ------------------------------------------------------------------ a free team */

/**
 * Art runs Vandelay Industries' free team: Free · 3 people in the sky and Invite people; on the horizon Art (who started it),
 * Priya and Kofi (joined today), then Sam, Lena, Diego and Theo invited, in dashed arches, and the colleagues not on it
 * further back. At the top of the water what Free means, with the page's one Upgrade (filled, someone else being on it); its
 * people; who's invited (Lena's runs out in 4 days, Diego's was sent again today, Theo's three times); the colleagues at
 * Vandelay not on it yet; and the notes visible to the team, which open on Team.
 */
export const FreeAsAdmin = page('/team', 'team-free-admin');
export const FreeAsAdminNight = night(FreeAsAdmin);
export const FreeAsAdminPhone = phone(FreeAsAdmin);
export const FreeAsAdminPhoneNight = night(FreeAsAdminPhone);
export const FreeAsAdminWide = wide(FreeAsAdmin);
export const FreeAsAdminTablet = tablet(FreeAsAdmin);
/** A member of Priya's free team: Invite people, and Ask Priya to upgrade; Resend and Cancel only on Sam's, whom Art invited. */
export const FreeAsMember = page('/team', 'team-free-member');
export const FreeAsMemberNight = night(FreeAsMember);
export const FreeAsMemberPhone = phone(FreeAsMember);
/** Ask Priya to upgrade, pressed: Priya's told once, and for a week it says so in the button's place. */
export const AskedToUpgrade = page('/team', 'team-free-member', { play: pressing('Ask Priya to upgrade', 'Press Ask Priya to upgrade') });
/** The pen beside the name: Rename team, in a popover with the name in its box. */
export const Rename = page('/team', 'team-free-admin', { play: pressing('Rename team', 'Press the pen beside the team’s name') });
export const RenameNight = night(Rename);
export const RenamePhone = phone(Rename);
/** Invite people on a free team: who isn't on it yet, Sam, Lena and Diego ticked off as Invited (pressing one sends it again). */
export const InvitePeopleOnFree = page('/team', 'team-free-admin', { play: pressing('Invite people', 'Press Invite people') });
export const InvitePeopleOnFreePhone = phone(InvitePeopleOnFree);
/** Resend, on Sam's row: sent again, and it says Sent today until tomorrow. */
export const Resent = page('/team', 'team-free-admin', { play: pressing('Resend Sam Ortiz’s invitation', 'Press Resend on Sam’s row') });
/** Cancel, on Lena's row: asked in place under it, Keep it filled. */
export const CancelAsked = page('/team', 'team-free-admin', { play: pressing('Cancel Lena Fischer’s invitation', 'Press Cancel on Lena’s row') });
export const CancelAskedNight = night(CancelAsked);
export const CancelAskedPhone = phone(CancelAsked);
/** Upgrade, beside what Free means, opens checkout on Team for it: a license for each of the three on it. */
export const Upgrade = page('/team', 'team-free-admin', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Upgrade, in what Free means at the top of the water', async () => {
      const free = await canvas.findByRole('region', { name: 'Vandelay Industries is on Free.' }, { timeout: 8000 });
      await userEvent.click(within(free).getByRole('button', { name: 'Upgrade' }));
    });
  }
});
/** Kofi asked Art to upgrade it: what Free means says who asked, beside Upgrade (and Settings and the side panel say so too). */
export const UpgradeAsked = page('/team', 'team-free-asked');
export const UpgradeAskedNight = night(UpgradeAsked);
/**
 * Art alone on the free team, the people invited not on it yet: Free isn't explained, and there's no Upgrade on the page,
 * since inviting is the thing to do: Invite people is the filled one.
 */
export const AloneOnFree = page('/team', 'team-free-admin', { beforeEach: changing(alone) });
export const AloneOnFreePhone = phone(AloneOnFree);
/**
 * A team whose licenses ended, back on Free, with a license still bought for each person who joins: it spends from Art's
 * balance, so its switch stays in view beside the people, without Buy licenses.
 */
export const LicensesEnded = page('/team', 'team-licenses-ended');
export const LicensesEndedNight = night(LicensesEnded);
/** Just upgraded: on Team, Art's license taken, Priya's and Kofi's taken the next time they open Alcove. */
export const Upgraded = page('/team', 'team-upgraded');
export const UpgradedNight = night(Upgraded);
/** Nobody but Art on the free team: Delete team can be pressed, and its invitations stop working. */
export const FreeDeleteAsked = page('/team', 'team-free-admin', { beforeEach: changing(alone), play: pressing('Delete team', 'Press Delete team') });

/* ------------------------------------------------------------------ invited to another team, while on one */

/** On Priya's team, invited to Weber Design: said at the top of the water, with Join and Not now. */
export const InvitedOnATeam = page('/team', 'team-member-invited');
export const InvitedOnATeamNight = night(InvitedOnATeam);
export const InvitedOnATeamPhone = phone(InvitedOnATeam);
/** Join, pressed: leaving Vandelay Industries is asked first, in place. */
export const LeaveToJoin = page('/team', 'team-member-invited', { play: pressing('Join Weber Design', 'Press Join Weber Design') });
export const LeaveToJoinNight = night(LeaveToJoin);
/** Alone on a free team of Art's own: joining deletes it, asked first. */
export const DeleteToJoin = page('/team', 'team-solo-admin-invited', { play: pressing('Join Weber Design', 'Press Join Weber Design') });
/**
 * Two teams of one name: Art alone on Vandelay Industries, and Priya's invitation to hers. Join asks first, naming hers by
 * Priya, and Art's "yours".
 */
export const DeleteYoursToJoin = page('/team', 'team-free-admin', {
  beforeEach: changing(alone, (w) => { priyaInvitesArt(w); }),
  play: pressing('Join Vandelay Industries', 'Press Join Vandelay Industries, on Priya’s invitation')
});
/** The admin of a team others are on: no Join yet, and in its place why: once Art's the only one left. */
export const CantJoinYet = page('/team', 'team-admin-invited');
/**
 * Not now: the note folds away, and the invitation waits quietly under Put aside at the water's foot, its Join taking the
 * focus; the toast says until when, with Undo.
 */
export const PutAside = page('/team', 'team-member-invited', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Not now on the invitation', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Not now' }, { timeout: 8000 }));
    });
    await step('It waits under Put aside, and the toast says until when, with Undo', async () => {
      await within(await screen.findByRole('region', { name: 'Put aside' }, SOON)).findByRole('button', { name: 'Join Weber Design' }, SOON);
      await screen.findByText(/^Put aside\. You can join it from Team until /, {}, SOON);
    });
  }
});
export const PutAsidePhone = phone(PutAside);
