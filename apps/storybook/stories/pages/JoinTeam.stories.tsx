/*
 * Joining a team by its link (/team/join, user-flows 16.16; the canvas's Join board): one card on the team's evening. The
 * link joins nothing by itself. Signed in, the card says whose team it is and what joining gives you, with Not now and Join;
 * Join takes one of its licenses if one is left. Signed out, Continue with Google first, and the card asks once you're back.
 * Storybook can't put a secret in the page's address, so the invite waits in the tab, as it does while signing in from it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { TEAM_INVITE_SECRET, withTeamInvite } from '../../src/api/scenarios';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import type { World } from '../../src/world';
import { ART } from '../../src/world/people';
import { troubled } from './changes';

const meta = { title: 'Pages/Join a team', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The same story at night. */
const night = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, theme: 'dark' } });
/** Priya's invite, waiting in the tab. */
const anInvite = changing(withTeamInvite());
/** Presses Join on the card. */
const joining: PageStory['play'] = async ({ userEvent, step }) => {
  await step('Press Join Vandelay Industries', async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Join Vandelay Industries' }, { timeout: 8000 }));
  });
};
/** The team the invite is for has no license left. */
const noneLeft = (w: World): void => { const invite = w.teamInvites?.[0]; if (invite) invite.team.unconsumed = []; };
/** The invite is for another team than the one Art is on. */
const anotherTeam = (w: World): void => { const invite = w.teamInvites?.[0]; if (invite) invite.team.name = 'Harbourline'; };
/** Art made this invite for their own team, and opened it. */
const hisOwn = (w: World): void => {
  const team = w.myTeam;
  if (team) w.teamInvites = [{ secret: TEAM_INVITE_SECRET, expiresAt: new Date(Date.now() + 20 * 3_600_000).toISOString(), team, admin: ART }];
};

/** Signed in: "Join Vandelay Industries?", what joining gives you, Not now and Join. */
export const AsksFirst = page('/team/join', 'team-join', { beforeEach: anInvite });
export const AsksFirstNight = night(AsksFirst);
export const AsksFirstPhone = phone(AsksFirst);
/** Joined, with one of its licenses: until when, and Open Alcove. */
export const Joined = page('/team/join', 'team-join', { beforeEach: anInvite, play: joining });
export const JoinedNight = night(Joined);
export const JoinedPhone = phone(Joined);
/** Joined with none of its licenses left: on your own plan for now, and Priya has been told. */
export const JoinedWithoutALicense = page('/team/join', 'team-join', { beforeEach: changing(withTeamInvite(), noneLeft), play: joining });
export const JoinedWithoutALicenseNight = night(JoinedWithoutALicense);
/** Signed out: Continue with Google first. The invite waits in this tab while you sign in. */
export const SignInFirst = page('/team/join', 'signed-out', { beforeEach: anInvite });
export const SignInFirstNight = night(SignInFirst);
export const SignInFirstPhone = phone(SignInFirst);
/** The invite was used, or a day has passed: ask for a new one. */
export const UsedOrExpired = page('/team/join', 'team-join', { beforeEach: changing(withTeamInvite(true)) });
export const UsedOrExpiredNight = night(UsedOrExpired);
/** On another team already: leave it first, from Team, then open the invite again. */
export const OnAnotherTeam = page('/team/join', 'team-member', { beforeEach: changing(withTeamInvite(), anotherTeam) });
export const OnAnotherTeamNight = night(OnAnotherTeam);
/** On the team the invite is for already. */
export const OnThisTeam = page('/team/join', 'team-member', { beforeEach: anInvite });
/** Art opened an invite they made for their own team: it's theirs to send, and opening it doesn't use it. */
export const YourOwnInvite = page('/team/join', 'team-admin', { beforeEach: changing(withTeamInvite(), hisOwn) });
/** Opened without the part after #, which is what lets you join. */
export const NoInvite = page('/team/join', 'team-join');
/** While Alcove is asked whose team it is. */
export const Opening = page('/team/join', 'team-join', { beforeEach: changing(withTeamInvite(), troubled({ 'teams.peek': 'hold' })) });
/** Opened without a connection: Try again once there is one. */
export const Offline = page('/team/join', 'team-join', { beforeEach: anInvite, parameters: { opening: { browser: { online: false } } } });
export const OfflineNight = night(Offline);
/** Alcove couldn't answer: what it said, and Try again. */
export const DidntOpen = page('/team/join', 'team-join', { beforeEach: changing(withTeamInvite(), troubled({ 'teams.peek': 'failed' })) });
