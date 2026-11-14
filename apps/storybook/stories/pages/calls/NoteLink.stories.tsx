/*
 * Opening a link to someone's notes (/link, user-flows 8): the link reads nothing by itself, and opens nothing until you
 * say so. Signed in, it asks first, naming your account, because everyone with the notes will see that you opened them,
 * and says until when the link works, and that the notes stay yours after that; Open the notes puts them in yours, from
 * whoever made the link, and opens them. Signed out, it asks you to sign in first, and then asks the same. Storybook can't
 * put a secret in the page's address, so the link waits in the tab, as it does while signing in from it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { linkToReadout } from '../changes';

const meta = { title: 'Pages/Calls/Open a link to notes', ...pages } satisfies Meta<PageArgs>;
export default meta;

const aLink = { beforeEach: changing(linkToReadout()) };
/** Says to open them, as the account the card names. */
const openThem: PageStory['play'] = async ({ userEvent, step }) => {
  await step('Press Open the notes', async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Open the notes' }, { timeout: 8000 }));
  });
};

/**
 * Signed in: nothing opens yet. It names Art's address, says everyone with the notes will see that he opened them, and that
 * the link works until a week from now, the notes staying his after that; and waits.
 */
export const AsksFirst = page('/link', 'busy', aLink);
export const AsksFirstNight = page('/link', 'busy', { ...aLink, globals: { theme: 'dark' } });
export const AsksFirstPhone = phone(AsksFirst);
/** On its last day it says the time it stops, today: a link runs out at the minute it was made, a week on. */
export const AsksFirstOnItsLastDay = page('/link', 'busy', { beforeEach: changing(linkToReadout(false, 2 * 3_600_000)) });
/** Open the notes: Priya's research readout joins Art's notes, from her link, to keep, and opens. */
export const OpensTheNotes = page('/link', 'busy', { ...aLink, play: openThem });
/** Signed out: one card says someone shared a call's notes, and to sign in to open them, to keep. Signing in asks first, too. */
export const SignInFirst = page('/link', 'signed-out', aLink);
export const SignInFirstNight = page('/link', 'signed-out', { ...aLink, globals: { theme: 'dark' } });
export const SignInFirstPhone = phone(SignInFirst);
/**
 * The link ran out (or was revoked): it says so before asking anything, to ask whoever sent it for a new one, and that
 * anyone who opened it before has the notes already.
 */
export const RanOut = page('/link', 'busy', { beforeEach: changing(linkToReadout(true)) });
/** Opened without the part after #, which is what opens the notes. */
export const NoLink = page('/link', 'busy');
