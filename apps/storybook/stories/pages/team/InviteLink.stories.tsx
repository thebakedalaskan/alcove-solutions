/*
 * The invite page (/invite, user-flows 10.22 and 10.25; docs/design/pages.md › Team, the invite page): one card on the
 * team's evening, for either kind of secret after the #. An invitation's own link, from its email ("Priya invited you to join
 * Vandelay Industries"), a team's link ("Join Vandelay Industries on Alcove"), or the link of someone on no team yet ("Jonas
 * asked you to join them on Alcove"). Signed out, the ways in; an account made from the card joins at once and arrives,
 * with no plan to choose. Signed in, Join and Not now (which puts an invitation to you aside, with Undo), asking first while
 * you're on a team. Your own link, or your team's, says so, with Copy link; an invitation to the team you're on says you're on
 * it already. Storybook can't put a secret in the page's address, so the link waits in the tab, as it does while signing in.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { withInvitationLink, withInvitationToYourTeam, withInviteLink } from '../../../src/api/scenarios';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { ART_INVITE_SECRET, ENDED_INVITATION_SECRET, JONAS_INVITE_SECRET, NOWHERE_INVITE_SECRET } from '../../../src/world/invite-links';
import { troubled } from '../changes';

const meta = { title: 'Pages/Team/Invite page', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The same story at night. */
const night = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, theme: 'dark' } });
/** Priya's invitation's own link, from its email, waiting in the tab. */
const invitation = changing(withInvitationLink());
/** Priya's team's link, waiting in the tab. */
const teamsLink = changing(withInviteLink());
/** Signs in from the card with Microsoft, as Art. */
const signingIn: NonNullable<PageStory['play']> = async ({ userEvent, step }) => {
  await step('Press Continue with Microsoft', async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Microsoft' }, { timeout: 8000 }));
  });
};
/** Presses Join on the card, signed in. */
const joining = (name: string): NonNullable<PageStory['play']> => async ({ userEvent, step }) => {
  await step(`Press ${name}`, async () => {
    await userEvent.click(await screen.findByRole('button', { name }, { timeout: 8000 }));
  });
};

/* ---------- signed out ---------- */

/** An invitation's own link: the team's faces, who invited you, who's on it, what Alcove is for, and the ways in. */
export const InvitationSignedOut = page('/invite', 'signed-out', { beforeEach: invitation });
export const InvitationSignedOutNight = night(InvitationSignedOut);
export const InvitationSignedOutPhone = phone(InvitationSignedOut);
/** A team's link: anyone on it may have shared it, so it names the team. */
export const TeamsLinkSignedOut = page('/invite', 'signed-out', { beforeEach: teamsLink });
export const TeamsLinkSignedOutNight = night(TeamsLinkSignedOut);
export const TeamsLinkSignedOutPhone = phone(TeamsLinkSignedOut);
/** The link of someone on no team yet: joining from it starts theirs. */
export const SomeonesLinkSignedOut = page('/invite', 'signed-out', { beforeEach: changing(withInviteLink(JONAS_INVITE_SECRET)) });
/**
 * An account made from the card: it joins Vandelay Industries at once, and arrives as from the welcome page, onto Home, which
 * says "You’re on Vandelay Industries."
 */
export const NewAccountJoins = page('/invite', 'first-sign-in', { beforeEach: invitation, play: signingIn });
export const NewAccountJoinsNight = night(NewAccountJoins);
/** Google's way back, which lands on /ready for an account it made and comes here again: it joins at once, as above. */
export const NewAccountBackFromGoogle = page('/invite', 'first-day', { beforeEach: changing(withInvitationLink(undefined, true)) });
/** An account from before signs in from the card: it's asked, with Join and Not now. */
export const AnAccountFromBefore = page('/invite', 'signed-out', { beforeEach: invitation, play: signingIn });

/* ---------- signed in ---------- */

/** Signed in, on no team: Join and Not now (to Home). */
export const SignedIn = page('/invite', 'busy', { beforeEach: invitation });
export const SignedInNight = night(SignedIn);
export const SignedInPhone = phone(SignedIn);
/** A team's link, signed in. */
export const TeamsLinkSignedIn = page('/invite', 'busy', { beforeEach: teamsLink });
/** Join: on Vandelay Industries at once, its page opens, and a toast says so. */
export const Joined = page('/invite', 'busy', { beforeEach: invitation, play: joining('Join Vandelay Industries') });
/** On Priya's team, Weber Design's link (Jonas's): Join asks in place first, leaving Vandelay Industries to join. */
export const OnATeamLeaveFirst = page('/invite', 'team-member-invited', { beforeEach: changing(withInviteLink(JONAS_INVITE_SECRET)), play: joining('Join Weber Design') });
export const OnATeamLeaveFirstNight = night(OnATeamLeaveFirst);
/** Not now, on Priya's invitation to Art: it's put aside, as on Team, and Home opens, its toast saying until when, with Undo. */
export const NotNowPutsItAside = page('/invite', 'busy', { beforeEach: invitation, play: joining('Not now') });
/**
 * Vandelay Industries' admin, with five others on it: there's no Join until Art's the only one left on it, which the card says
 * in its place, and Not now.
 */
export const AdminCantJoinYet = page('/invite', 'team-admin-invited', { beforeEach: changing(withInviteLink(JONAS_INVITE_SECRET)) });
/** Your team's own link: it says so, with Copy link, filled, and Go to Team. */
export const YourTeamsLink = page('/invite', 'team-admin', { beforeEach: changing(withInviteLink(ART_INVITE_SECRET)) });
export const YourTeamsLinkNight = night(YourTeamsLink);
export const YourTeamsLinkPhone = phone(YourTeamsLink);
/** Your own link, on no team: it says so, with Copy link; joining from it starts your team. */
export const YourOwnLink = page('/invite', 'busy', { beforeEach: changing(withInviteLink(ART_INVITE_SECRET)) });
/** An invitation's own link to the team Art is on already (Sam passed Art his): nothing to join or leave, and Go to Team. */
export const OnYourTeamAlready = page('/invite', 'team-member', { beforeEach: changing(withInvitationToYourTeam) });
export const OnYourTeamAlreadyNight = night(OnYourTeamAlready);

/* ---------- what goes wrong ---------- */

/** An invitation used, cancelled or run out, or a link made again since: ended, and whom to ask. */
export const Ended = page('/invite', 'signed-out', { beforeEach: changing(withInvitationLink(ENDED_INVITATION_SECRET)) });
export const EndedNight = night(Ended);
export const EndedPhone = phone(Ended);
/** A made-up link, or one copied only in part: the same, as nothing tells them apart. */
export const Nowhere = page('/invite', 'signed-out', { beforeEach: changing(withInviteLink(NOWHERE_INVITE_SECRET)) });
/** Opened without the part after #, which says who it's from. */
export const NoLink = page('/invite', 'signed-out');
/** While Alcove is asked what the link is. */
export const Opening = page('/invite', 'signed-out', { beforeEach: changing(withInvitationLink(), troubled({ 'people.peekInvite': 'hold' })) });
/** Opened without a connection: Try again once there is one. */
export const Offline = page('/invite', 'signed-out', { beforeEach: invitation, parameters: { opening: { browser: { online: false } } } });
export const OfflineNight = night(Offline);
/** Alcove couldn't answer: what it said, and Try again. */
export const DidntOpen = page('/invite', 'signed-out', { beforeEach: changing(withInvitationLink(), troubled({ 'people.peekInvite': 'failed' })) });
