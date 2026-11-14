/*
 * Moving a call here (/move): the new device's side. It shows the call, who you'll be and whether your microphone and
 * camera were on, with Move here; the organizer and invited people sign in first, with the same account. The device being
 * left isn't in Storybook, so a move waits for it once this one is ready (user-flows 6).
 */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs } from '../../../src/page';
import { moving, troubled } from '../changes';

const meta = { title: 'Pages/Calls/Move a call here', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The design sync, on its way here from Art's laptop: microphone on, camera off, and Move here. */
export const MoveHere = page('/move', 'busy', { beforeEach: changing(moving()), globals: { theme: 'dark' } });
export const MoveHerePhone = phone(MoveHere);
/** This device isn't signed in: sign in as Art first, and the move carries on. */
export const SignInFirst = page('/move', 'signed-out', { beforeEach: changing(moving()), globals: { theme: 'dark' } });
/** Move here pressed: waiting for the other device to let go of its microphone and camera. */
export const WaitingForTheOtherDevice = page('/move', 'busy', {
  beforeEach: changing(moving()),
  globals: { theme: 'dark' },
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Move here', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Move here' }, { timeout: 8000 }));
    });
  }
});
/** Not now: the other device keeps the call, and nothing changed there. */
export const NotNow = page('/move', 'busy', {
  beforeEach: changing(moving()),
  globals: { theme: 'dark' },
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Not now', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Not now' }, { timeout: 8000 }));
    });
  }
});
/** Nothing was done in time: the move ran out. */
export const RanOut = page('/move', 'busy', { beforeEach: changing(moving(0)), globals: { theme: 'dark' } });
/** Opening the move: Alcove hasn't answered yet. */
export const Opening = page('/move', 'busy', { beforeEach: changing(moving(), troubled({ 'calls.resumeMove': 'hold' })), globals: { theme: 'dark' } });
/** Alcove can't be reached: the code still works for a couple of minutes, and Try again. */
export const CantReachAlcove = page('/move', 'busy', { beforeEach: changing(moving(), troubled({ 'calls.resumeMove': 'network' })), globals: { theme: 'dark' } });
/** Opened with no move to pick up: how to make one on the other device. */
export const NoMoveHere = page('/move', 'busy', { globals: { theme: 'dark' } });
