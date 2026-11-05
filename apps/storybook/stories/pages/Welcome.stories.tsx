/*
 * Welcome and sign-in: signed out, the welcome page shows what Alcove does, each with a scene that plays while it's on
 * screen, and the ways in at the top and the bottom. A sign-in that didn't happen says why (user-flows 1).
 */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../src/call';
import { page, pages, type PageArgs } from '../../src/page';

const meta = { title: 'Pages/Welcome', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Welcome = page('/welcome', 'signed-out');
export const WelcomePhone = phone(Welcome);
/** Alcove's front door, signed out: the welcome page. */
export const FrontDoor = page('/', 'signed-out');
/** Use single sign-on asks for a work email in place. */
export const SingleSignOn = page('/welcome', 'signed-out', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Use single sign-on. It asks for a work email in place', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Use single sign-on' });
      if (first) await userEvent.click(first);
    });
  }
});
/** Back from Google without signing in: cancelled. */
export const GoogleCancelled = page('/welcome?signin=cancelled', 'signed-out');
/** Back from Google: the sign-in took too long, or started in another tab. */
export const GoogleTookTooLong = page('/welcome?signin=expired', 'signed-out');
/** Google hasn't verified the account's address. */
export const GoogleUnverified = page('/welcome?signin=unverified', 'signed-out');
/** Google sign-in isn't set up on this server. */
export const GoogleNotSetUp = page('/welcome?signin=unavailable', 'signed-out');
/** Too many attempts: wait a minute. */
export const TooManyAttempts = page('/welcome?signin=busy', 'signed-out');
/** Opened without a connection, by someone not signed in here: the welcome page, to sign in once back. */
export const Offline = page('/welcome', 'signed-out', { parameters: { opening: { browser: { online: false } } } });
