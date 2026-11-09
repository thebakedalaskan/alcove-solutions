import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { atTheDoor, inCall, phone } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, CHECK_IN, LAUNCH_REVIEW, PRIYA, REVIEW } from '../calls/talk';

const meta = { title: 'Journeys/6 In the call/Presenter timers', ...pages } satisfies Meta<PageArgs>;
export default meta;
const segments = [{ id: 'intro', label: 'Opening', durationSeconds: 120, presenter: 'Art Vandelay' }, { id: 'proposal', label: 'Proposal', durationSeconds: 300, presenter: 'Priya Raman' }];
export const PrepareReusableTimers = atTheDoor({ scenario: 'call-soon', call: REVIEW }, {
  name: '6.26 Prepare reusable timers',
  play: async ({ userEvent, step }) => {
    await step('Open the timer library before joining', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Prepare timer presets' }, { timeout: 8000 })); });
    await step('Name a reusable agenda and its first turn', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'New preset' }));
      await userEvent.type(await screen.findByRole('textbox', { name: 'Preset name' }), 'Weekly launch review');
      const name = await screen.findByRole('textbox', { name: 'Segment 1 name' });
      await userEvent.clear(name); await userEvent.type(name, 'Opening and context');
      await userEvent.type(await screen.findByRole('textbox', { name: 'Segment 1 presenter' }), 'Art Vandelay');
      await userEvent.click(await screen.findByRole('button', { name: 'Add segment' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Save preset' }));
    });
  }
});
export const PrepareReusableTimersPhone = phone(PrepareReusableTimers);
export const RunPresenterSequence = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: AIKO }], timerSequence: { revision: 0, segments, activeIndex: 0, status: 'ready', elapsedMs: 0, startedAt: null, addedSeconds: 0 } } }, {
  name: '6.27 Run a presenter sequence',
  play: async ({ userEvent, step }) => {
    await step('Open the shared plan and start the first turn', async () => { await userEvent.click(await screen.findByRole('button', { name: /^Timer:/ }, { timeout: 8000 })); await userEvent.click(await screen.findByRole('button', { name: 'Start timer' })); });
    await step('Pause, add a minute, and resume', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Pause' })); await userEvent.click(await screen.findByRole('button', { name: 'Add 1 min' })); await userEvent.click(await screen.findByRole('button', { name: 'Resume' })); });
    await step('Move to the next presenter explicitly', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Next segment' })); });
    await step('Keep the countdown in view after closing the details', async () => { await userEvent.click(await screen.findByRole('button', { name: 'Close Timer' })); });
  }
});
export const RunPresenterSequencePhone = phone(RunPresenterSequence);
/** Guest and reconnect snapshots are recorded in Calls/Presenter timers. */
export const FollowAsGuest: PageStory = { ...inCall({ scenario: 'busy', call: { ...CHECK_IN, organizer: PRIYA }, script: { here: [{ who: PRIYA, organizer: true }], timerSequence: { revision: 0, segments, activeIndex: 0, status: 'running', elapsedMs: 105_000, startedAt: 0, addedSeconds: 0 } } }), name: '6.28 Follow the shared timer', play: async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: /^Timer:/ }, { timeout: 8000 })); await userEvent.click(await screen.findByRole('switch', { name: 'Sound when time is up' })); } };
