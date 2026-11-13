/*
 * Journeys into Alcove (docs/product/user-flows.md › 1. Sign in), which the canvas never drew. Microsoft and single sign-on
 * sign in on the spot, as the stand-in does; Google's own pages can't open in Storybook, so its journey plays up to the
 * hand-off, and the way back from Google that didn't sign anyone in is the welcome page's address. A way in on the welcome
 * page keeps where its cove stood, as the real buttons do, so signing in again sails out of it to Home; a new account has
 * its arrival instead, and the plans to choose from before Home (16.20).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { away, first, LAPTOP, LATER, pause, pressable, SOON } from '../play';

/** Signing in from the welcome page sails out of its cove to Home: about three and a half seconds. */
const SAILING_OUT = 3600;

const meta = { title: 'Journeys/1 Sign in', ...pages } satisfies Meta<PageArgs>;
export default meta;

const tourCard = (title: string) => screen.findByRole('dialog', { name: title }, LATER);

export const FirstTime: PageStory = {
  name: '1.1 Sign in for the first time',
  ...page('/', 'first-sign-in'),
  // The tour's stops are a laptop's: on a phone Agents isn't one.
  globals: LAPTOP,
  play: async ({ userEvent, step }) => {
    await step('Open Alcove. Signed out, the welcome page shows what Alcove does. Continue with Microsoft', async () => {
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Continue with Microsoft' }, SOON)));
    });
    await step('The account is made on screen: an arch draws itself, and what came with the account arrives a row at a time', async () => {
      await screen.findByRole('dialog', { name: 'Creating your account' }, LATER);
    });
    await step('“You’re in”, and the arch opens on the plans to choose from, once (16.20)', async () => {
      await screen.findByRole('dialog', { name: /^You’re in/ }, LATER);
      await screen.findByRole('heading', { name: 'Choose a plan', level: 1 }, LATER);
      await away('dialog', /^You’re in/, LATER);
    });
    await step('Continue on Free, on Free’s card. Home opens on Art’s first day', async () => {
      await userEvent.click(await pressable('button', 'Continue on Free', LATER));
      await screen.findByRole('region', { name: 'Start your first call' }, LATER);
    });
    await step('The tour starts at Start now and Schedule, then moves to the example note, the page dimmed around what each stop is about', async () => {
      await userEvent.click(within(await tourCard('Start or schedule a call')).getByRole('button', { name: 'Show me notes' }));
      await tourCard('Notes for your calls');
    });
    await step('→ and Enter move through it: Search or ask, the Drive, Record and Agents', async () => {
      await userEvent.keyboard('{ArrowRight}');
      await tourCard('Search or ask');
      await userEvent.keyboard('{ArrowRight}');
      await tourCard('Documents and boards');
      await userEvent.keyboard('{ArrowRight}');
      await tourCard('Record in the room');
      await userEvent.keyboard('{ArrowRight}');
      await tourCard('Bring your agent');
      await userEvent.click(within(await tourCard('Bring your agent')).getByRole('button', { name: 'Back to the start' }));
    });
    await step('You’re ready: Start using Alcove. It isn’t shown again on this browser', async () => {
      await userEvent.click(within(await tourCard('You’re ready')).getByRole('button', { name: 'Start using Alcove' }));
      await screen.findByText('You can take the tour again from your menu.', {}, SOON);
    });
  }
};

export const SkipAhead: PageStory = {
  name: '1.2 Skip the arrival and the tour',
  ...page('/', 'first-sign-in'),
  play: async ({ userEvent, step }) => {
    await step('Use single sign-on. It asks for a work email in place', async () => {
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Use single sign-on' }, SOON)));
      await userEvent.type(await screen.findByRole('textbox', { name: 'Work email' }, SOON), 'art@vandelay.industries');
    });
    await step('Continue. The account is made on screen', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByRole('dialog', { name: 'Creating your account' }, LATER);
    });
    await step('Skip opens the plans to choose from straight away. Continue on Free, and Home opens', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Skip' }, LATER));
      await away('dialog', /^You’re in|^Creating your account/, LATER);
      await userEvent.click(await pressable('button', 'Continue on Free', LATER));
      await screen.findByRole('region', { name: 'Start your first call' }, LATER);
    });
    await step('Skip tour closes the tour, and says your menu plays it again', async () => {
      await userEvent.click(within(await tourCard('Start or schedule a call')).getByRole('button', { name: 'Skip tour' }));
      await screen.findByText('Tour closed. You can take it again from your menu.', {}, SOON);
    });
  }
};

export const SignInAgain: PageStory = {
  name: '1.3 Sign in again',
  ...page('/', 'signed-out'),
  play: async ({ userEvent, step }) => {
    await step('Use single sign-on, with a work email', async () => {
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Use single sign-on' }, SOON)));
      await userEvent.type(await screen.findByRole('textbox', { name: 'Work email' }, SOON), 'art@vandelay.industries');
    });
    await step('Continue. After the first time, signing in goes straight to Home', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByRole('region', { name: 'For you' }, LATER);
    });
    await step('Out of the welcome page’s cove to sea: the headlands go by, the horizon comes up to Home’s, the frame forms round it and Home rises in', async () => {
      await pause(SAILING_OUT);
    });
  }
};

export const WithGoogle: PageStory = {
  name: '1.4 Continue with Google',
  ...page('/', 'signed-out'),
  play: async ({ userEvent, step }) => {
    await step('Continue with Google. Google asks which account to use', async () => {
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Continue with Google' }, SOON)));
      await first(screen.findAllByRole('button', { name: 'Waiting for Google…' }, SOON));
    });
  }
};

export const GoogleDidntSignIn: PageStory = {
  name: '1.5 When Google doesn’t sign you in',
  ...page('/welcome?signin=cancelled', 'signed-out'),
  play: async ({ userEvent, step }) => {
    await step('Back from Google without signing in, the welcome page says why', async () => {
      await screen.findByText('Google sign-in was cancelled.', {}, SOON);
    });
    await step('Another way in still works: Continue with Microsoft', async () => {
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Continue with Microsoft' }, SOON)));
      await screen.findByRole('heading', { name: 'Wednesday 4 November', level: 1 }, LATER);
    });
    await step('Home opens out of the welcome page’s cove', async () => {
      await pause(SAILING_OUT);
    });
  }
};

export const ReadPrivacyPolicy: PageStory = {
  name: '1.6 Read the privacy policy before signing in',
  ...page('/welcome', 'signed-out'),
  play: async ({ canvas, userEvent, step }) => {
    await step('Open Privacy policy from the welcome footer', async () => {
      await userEvent.click(await canvas.findByRole('link', { name: 'Privacy policy' }, SOON));
    });
  }
};

export const GoogleInviteOnly: PageStory = {
  name: '1.7 Sign in while Google sign-up is invite-only',
  ...page('/welcome?signin=invite-only', 'signed-out'),
  play: async ({ step }) => {
    await step('Back from Google, Alcove asks for an account with access', async () => {
      await screen.findByText('Google sign-up is invite-only. Use a Google account with access to Alcove.', {}, SOON);
    });
  }
};

export const GoogleEmailRequired: PageStory = {
  name: '1.8 Try another Google account',
  ...page('/welcome?signin=google-email-required', 'signed-out'),
  play: async ({ step }) => {
    await step('Alcove explains which Google account can be used and leaves sign-in available', async () => {
      await screen.findByText('Use a Gmail or Google Workspace account to sign in to Alcove.', {}, SOON);
      await first(screen.findAllByRole('button', { name: 'Continue with Google' }, SOON));
    });
  }
};
