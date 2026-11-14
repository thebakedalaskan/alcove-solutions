/*
 * The call's timer: one countdown for everyone. Whoever hosts starts it from Timer in the top bar, then pauses it, adds a
 * minute or stops it from the countdown; everyone else follows the same seconds. Calls / Timer has each of its states.
 */
import type { Meta } from '@storybook/react-vite';
import { inCall, phone } from '../../../src/call';
import { pages, type PageArgs, type PageStory } from '../../../src/page';
import { AIKO, CHECK_IN, KOFI, LAUNCH_REVIEW, PRIYA } from '../../calls/talk';
import { pressable } from '../play';

const meta = { title: 'Journeys/6 In the call/Timer', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const StartATimer: PageStory = {
  ...inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: AIKO }] } }),
  name: '6.26 Start a timer for everyone',
  play: async ({ userEvent, step }) => {
    await step('Open Timer in the top bar', async () => { await userEvent.click(await pressable('button', 'Timer for everyone')); });
    await step('Pick three minutes, then a minute more', async () => {
      await userEvent.click(await pressable('button', '3 min'));
      await userEvent.click(await pressable('button', 'A minute more'));
    });
    await step('Start it: the top bar counts down for everyone', async () => {
      await userEvent.click(await pressable('button', 'Start'));
      await pressable('button', 'Pause');
    });
  }
};
export const StartATimerPhone = phone(StartATimer);

export const ChangeIt: PageStory = {
  ...inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: AIKO }], timer: { id: 'review-timer', revision: 0, durationSeconds: 300, status: 'running', elapsedMs: 200_000, startedAt: 0 } } }),
  name: '6.27 Pause it, add a minute and stop it',
  play: async ({ userEvent, step }) => {
    await step('Open the countdown in the top bar', async () => { await userEvent.click(await pressable('button', /^Timer: /)); });
    await step('Pause, add a minute and resume', async () => {
      await userEvent.click(await pressable('button', 'Pause'));
      await userEvent.click(await pressable('button', '+1 min'));
      await userEvent.click(await pressable('button', 'Resume'));
    });
    await step('Stop it: Timer is back, ready for another', async () => {
      await userEvent.click(await pressable('button', 'Stop'));
      await pressable('button', 'Start');
    });
  }
};
export const ChangeItPhone = phone(ChangeIt);

/** Priya hosts: Art follows the same countdown, and its popover only reads it. */
export const FollowTheTimer: PageStory = {
  ...inCall({ scenario: 'busy', call: CHECK_IN, script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }], timer: { id: 'check-in-timer', revision: 0, durationSeconds: 600, status: 'running', elapsedMs: 105_000, startedAt: 0 } } }),
  name: '6.28 Follow the timer',
  play: async ({ userEvent, step }) => {
    await step('Open the countdown in the top bar', async () => { await userEvent.click(await pressable('button', /^Timer: /)); });
  }
};
export const FollowTheTimerPhone = phone(FollowTheTimer);
