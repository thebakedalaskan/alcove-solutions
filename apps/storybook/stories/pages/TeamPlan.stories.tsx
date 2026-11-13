/*
 * Team, on a plan (user-flows 16.17; the canvas's TeamPlan board): the Team page while you're on a team. Its name in the sky
 * and its people on the horizon, each under their license; on the water its people, the notes visible to it, and your
 * groups; beside them, for the team's admin, the licenses and invite links. As its admin and as a member, with a license
 * and waiting for one, and what's asked in place. Not on a team, the company page (Team.stories.tsx) has a quiet row that
 * starts one.
 */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { iso } from '../../src/world/clock';
import type { World } from '../../src/world';
import { MANY } from '../../src/world/people';
import type { TeamMemberWorld } from '../../src/world/teams';
import { troubled } from './changes';

const meta = { title: 'Pages/Team on a plan', ...pages } satisfies Meta<PageArgs>;
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
 * with Remove, the notes visible to the team, and beside them three licenses left and Make an invite link.
 */
export const AsAdmin = page('/team', 'team-admin');
export const AsAdminNight = night(AsAdmin);
export const AsAdminPhone = phone(AsAdmin);
export const AsAdminPhoneNight = night(AsAdminPhone);
export const AsAdminTablet = tablet(AsAdmin);
export const AsAdminWide = wide(AsAdmin);
/** Two licenses left: the head and the licenses say so. */
export const LicensesLow = page('/team', 'team-admin-low');
/** None left, and Maya waiting for one: Maya waits on the horizon and in their row, and Buy licenses is filled. */
export const SomeoneWaiting = page('/team', 'team-admin-none');
export const SomeoneWaitingNight = night(SomeoneWaiting);
export const SomeoneWaitingPhone = phone(SomeoneWaiting);
/** Buy licenses opens checkout on Team, over the page. */
export const BuyLicenses = page('/team', 'team-admin-none', { play: pressing('Buy licenses', 'Press Buy licenses: checkout opens over the page') });
/** Buying one when it's needed, turned on. */
export const BuyWhenNeeded = page('/team', 'team-admin', { play: pressing('Buy one when it’s needed', 'Turn on Buy one when it’s needed', 'switch') });
/** Make an invite link: a link for one person, with Copy, until tomorrow at this time, and Make another. */
export const InviteLinkMade = page('/team', 'team-admin', { play: pressing('Make an invite link', 'Press Make an invite link') });
export const InviteLinkMadeNight = night(InviteLinkMade);
export const InviteLinkMadePhone = phone(InviteLinkMade);
/** Remove asks in place, under Maya's row: their license isn't refunded, they go back to Free, and their team notes stay. */
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

/* ------------------------------------------------------------------ not on a team */

/** The company page, as ever, with a quiet row under the water for starting a team. */
export const NotOnATeam = page('/team', 'no-team');
export const NotOnATeamPhone = phone(NotOnATeam);
/** Start a team opens checkout on Team: its name, then its first licenses. */
export const StartATeam = page('/team', 'no-team', { play: pressing('Start a team', 'Press Start a team: checkout opens over the page') });
