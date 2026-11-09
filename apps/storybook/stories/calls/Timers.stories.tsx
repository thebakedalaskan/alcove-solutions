import type { CallTimerSequence } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at } from '../../src/api/script';
import { current } from '../../src/api/state';
import { atTheDoor, inCall, light, phone, press } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, ART, CHECK_IN, KOFI, LAUNCH_REVIEW, PRIYA, REVIEW } from './talk';

const meta = { title: 'Calls/Presenter timers', ...pages } satisfies Meta<PageArgs>;
export default meta;
const TIMER_SEGMENTS = [
  { id: 'opening', label: 'Opening and context', durationSeconds: 120, presenter: 'Art Vandelay' },
  { id: 'proposal', label: 'Walk through the proposal', durationSeconds: 300, presenter: 'Priya Raman' },
  { id: 'questions', label: 'Questions and next steps', durationSeconds: 180, presenter: null }
];
const sequence = (status: CallTimerSequence['status'], elapsedMs = 0): CallTimerSequence => ({ revision: 0, segments: TIMER_SEGMENTS, activeIndex: 0, status, elapsedMs, startedAt: status === 'running' ? 0 : null, addedSeconds: 0 });
const timer = press(/^Timer:/);
const seedPresets = () => {
  const at = new Date().toISOString();
  current().timerPresets = [{ id: 'launch-review-timing', name: 'Launch review', segments: structuredClone(TIMER_SEGMENTS), revision: 0, createdAt: at, updatedAt: at }];
};
const review = (status: CallTimerSequence['status'], elapsedMs = 0, more: Omit<PageStory, 'args'> = {}) => inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], timerSequence: sequence(status, elapsedMs) }, then: seedPresets }, more);
export const Ready = review('ready', 0, { play: timer });
export const ReadyLight = light(Ready);
export const ReadyPhone = phone(Ready);
export const Running = review('running', 15_000, { play: timer });
export const RunningLight = light(Running);
export const RunningPhone = phone(Running);
export const Paused = review('paused', 45_000, { play: timer });
export const NearTheEnd = review('running', 102_000, { play: timer });
export const OverTime = review('running', 145_000, { play: timer });
export const OverTimePhone = phone(OverTime);
export const Finished = review('finished', 185_000, { play: timer });
export const CompactWhilePresenting = review('running', 20_000);
export const Preparing = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }] }, then: seedPresets }, { play: async (context) => { await timer(context); await context.userEvent.click(await screen.findByRole('button', { name: 'Build sequence' })); } });
export const PreparingPhone = phone(Preparing);
export const Presets = review('ready', 0, { play: async (context) => { await timer(context); await context.userEvent.click(await screen.findByRole('tab', { name: 'Your presets' })); } });
export const PresetsLight = light(Presets);
export const PresetsPhone = phone(Presets);
export const BeforeJoining = atTheDoor({ scenario: 'call-soon', call: REVIEW }, { play: press('Prepare timer presets') });
export const BeforeJoiningPhone = phone(BeforeJoining);
export const Participant = inCall({ scenario: 'busy', call: CHECK_IN, script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }], timerSequence: sequence('running', 35_000) } }, { play: timer });
export const Reconnecting = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { timerSequence: sequence('running', 60_000), cues: at(3, { do: 'reconnect', seconds: 8 }) } }, { play: timer });
/** A late guest sees the already running clock and has no host controls. */
export const Guest = inCall({ scenario: 'signed-out', call: { ...CHECK_IN, guests: [ART] }, script: { here: [{ who: PRIYA, organizer: true }], timerSequence: sequence('running', 80_000), cues: at(.1, { do: 'let-in' }) } }, { play: timer });
export const GuestPhone = phone(Guest);
