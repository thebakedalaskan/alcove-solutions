/*
 * Stopping invitation emails (/stop-email, user-flows 10; docs/design/pages.md › Team, stopping invitation emails): the page
 * every invitation email's foot links to. One card on the team's evening, no sign-in: Stop invitation emails?, one button,
 * then that Alcove won't email you invitations again. The token is in the fragment, which the page takes out of the address
 * bar at once: here each story puts one there first, as the email's link would. Offline and failing say so, with Try again.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { setOnline } from '../../../src/browser';
import { troubled } from '../changes';

const meta = { title: 'Pages/Team/Stop invitation emails', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** A made-up token, 43 characters as the server's are: it stops nothing outside Storybook. */
const TOKEN = 'StopVandelayInvitationEmailsStorybook000001';
/** The token in the frame's fragment, where the email's link puts it, before the page opens. */
const withToken = (): void => { history.replaceState(history.state, '', `${location.pathname}${location.search}#${TOKEN}`); };
/** The same story at night. */
const night = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, theme: 'dark' } });
/** Presses the card's one button. */
const pressing = (name: string): NonNullable<PageStory['play']> => async ({ userEvent, step }) => {
  await step(`Press ${name}`, async () => {
    await userEvent.click(await screen.findByRole('button', { name }, { timeout: 8000 }));
  });
};

/** Opened from an email's foot, signed out: Stop invitation emails? and the one button. */
export const Ask = page('/stop-email', 'signed-out', { beforeEach: withToken });
export const AskNight = night(Ask);
export const AskPhone = phone(Ask);
/** Stopped: Alcove won't email you invitations again; any still show in Alcove. */
export const Stopped = page('/stop-email', 'signed-out', { beforeEach: withToken, play: pressing('Stop invitation emails') });
export const StoppedNight = night(Stopped);
export const StoppedPhone = phone(Stopped);
/** Signed in makes no difference: the same card, the same answer. */
export const SignedIn = page('/stop-email', 'busy', { beforeEach: withToken });
/** The connection went before pressing it: it says so, and Try again. */
export const Offline = page('/stop-email', 'signed-out', {
  beforeEach: withToken,
  play: async (context) => {
    await screen.findByRole('button', { name: 'Stop invitation emails' }, { timeout: 8000 });
    setOnline(false);
    await pressing('Stop invitation emails')(context);
  }
});
/** Alcove couldn't answer: what it said, and Try again. */
export const Failed = page('/stop-email', 'signed-out', {
  beforeEach: changing(withToken, troubled({ 'people.stopEmails': 'failed' })),
  play: pressing('Stop invitation emails')
});
/** Opened without the part after #: nothing to stop. */
export const NoToken = page('/stop-email', 'signed-out');
