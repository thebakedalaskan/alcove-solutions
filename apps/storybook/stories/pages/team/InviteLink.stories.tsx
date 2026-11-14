/*
 * Someone's invite link (/invite, user-flows 10.22; docs/design/pages.md › Team, an invite link): one card on the team's
 * evening, saying who it's from. Signed out, Priya in her arch and the ways in; an account made from the card tells Priya it
 * joined, and its first sign-in goes on as from the welcome page. Signed in already, or with an account from before, you're on
 * Alcove already; your own link says it's yours. Storybook can't put a secret in the page's address, so the link waits in the
 * tab, as it does while signing in from it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { withInviteLink } from '../../../src/api/scenarios';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { ART_INVITE_SECRET, NOWHERE_INVITE_SECRET } from '../../../src/world/invite-links';
import { troubled } from '../changes';

const meta = { title: 'Pages/Team/Invite link', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The same story at night. */
const night = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, theme: 'dark' } });
/** Priya's link, waiting in the tab. */
const priyas = changing(withInviteLink());
/** Signs in from the card with Microsoft, as Art. */
const signingIn: PageStory['play'] = async ({ userEvent, step }) => {
  await step('Press Continue with Microsoft', async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Microsoft' }, { timeout: 8000 }));
  });
};

/** Signed out: Priya in her arch, "Priya asked you to join them on Alcove", what Alcove is for, and the ways in. */
export const SignedOut = page('/invite', 'signed-out', { beforeEach: priyas });
export const SignedOutNight = night(SignedOut);
export const SignedOutPhone = phone(SignedOut);
/** An account made from the card: Priya is told it joined, and the account arrives on screen, as from the welcome page. */
export const JoinedJustNow = page('/invite', 'first-sign-in', { beforeEach: priyas, play: signingIn });
export const JoinedJustNowNight = night(JoinedJustNow);
/**
 * An account just made from a link that has stopped leading anywhere since (made again, or its sender gone): nobody can be
 * told, and the account's arrival goes on all the same.
 */
export const JoinedJustNowLinkGone = page('/invite', 'first-day', { beforeEach: changing(withInviteLink(NOWHERE_INVITE_SECRET, true)) });
/** An account from before signs in from the card: nobody is told, and it's on Alcove already. */
export const AnAccountFromBefore = page('/invite', 'signed-out', { beforeEach: priyas, play: signingIn });
/** Signed in when the link opens: you're on Alcove already, with Go to Home. */
export const AlreadyOnAlcove = page('/invite', 'busy', { beforeEach: priyas });
export const AlreadyOnAlcoveNight = night(AlreadyOnAlcove);
export const AlreadyOnAlcovePhone = phone(AlreadyOnAlcove);
/** Art opened his own link: it's his to send, with Go to Team. */
export const YourOwnLink = page('/invite', 'busy', { beforeEach: changing(withInviteLink(ART_INVITE_SECRET)) });
export const YourOwnLinkNight = night(YourOwnLink);
/** A link that leads nowhere: made up, copied only in part, or its sender has deleted their account. */
export const Nowhere = page('/invite', 'signed-out', { beforeEach: changing(withInviteLink(NOWHERE_INVITE_SECRET)) });
export const NowhereNight = night(Nowhere);
/** Opened without the part after #, which says who it's from. */
export const NoLink = page('/invite', 'signed-out');
/** While Alcove is asked who it's from. */
export const Opening = page('/invite', 'signed-out', { beforeEach: changing(withInviteLink(), troubled({ 'people.peekInvite': 'hold' })) });
/** Opened without a connection: Try again once there is one. */
export const Offline = page('/invite', 'signed-out', { beforeEach: priyas, parameters: { opening: { browser: { online: false } } } });
export const OfflineNight = night(Offline);
/** Alcove couldn't answer: what it said, and Try again. */
export const DidntOpen = page('/invite', 'signed-out', { beforeEach: changing(withInviteLink(), troubled({ 'people.peekInvite': 'failed' })) });
