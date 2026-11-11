/*
 * Opening a link to someone's notes (/link, user-flows 8): the link reads nothing by itself. Signed in, the notes join
 * yours, from whoever made the link, and open; signed out, it asks you to sign in first. Storybook can't put a secret in
 * the page's address, so the link waits in the tab, as it does while signing in from it.
 */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs } from '../../src/page';
import { linkToReadout } from './changes';

const meta = { title: 'Pages/Open a link to notes', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Signed in: Priya's link opens, the readout joins Art's notes from her link, and it opens. */
export const OpensTheNotes = page('/link', 'busy', { beforeEach: changing(linkToReadout()) });
/** Signed out: one card says someone shared a call's notes, and to sign in to open them. Signing in opens them. */
export const SignInFirst = page('/link', 'signed-out', { beforeEach: changing(linkToReadout()) });
export const SignInFirstNight = page('/link', 'signed-out', { beforeEach: changing(linkToReadout()), globals: { theme: 'dark' } });
export const SignInFirstPhone = phone(SignInFirst);
/** The link ran out (or was revoked): it opens nothing, and says to ask whoever sent it for a new one. */
export const RanOut = page('/link', 'busy', { beforeEach: changing(linkToReadout(true)) });
/** Opened without the part after #, which is what opens the notes. */
export const NoLink = page('/link', 'busy');
