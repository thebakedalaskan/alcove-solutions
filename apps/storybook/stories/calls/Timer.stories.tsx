/*
 * The call's timer: one countdown for everyone, in the top bar. Whoever hosts starts it from Timer; once it runs, the button is
 * the countdown for everyone, and opens Timer for everyone, where the host pauses, adds a minute or stops it, and everyone
 * else reads it.
 */
import type { CallTimer } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { at } from '../../src/api/call/script';
import { inCall, light, phone, plays, press } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { ART, CHECK_IN, KOFI, LAUNCH_REVIEW, PRIYA, AIKO } from './talk';

const meta = { title: 'Calls/Timer', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Five minutes, `gone` seconds of it already gone, as the call's timer is when you come in. */
const fiveMinutes = (gone: number, status: CallTimer['status'] = 'running'): CallTimer => ({ id: 'launch-review-timer', revision: 0, durationSeconds: 300, status, elapsedMs: gone * 1000, startedAt: status === 'running' ? 0 : null });
const openTimer = press(/^Timer/);
/** Art hosts the launch review, with Priya, Kofi and Aiko in it. */
const hosting = (timer: CallTimer | undefined, more: Omit<PageStory, 'args'> = {}) => inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], timer } }, more);

/** No timer yet: the host's Timer opens the lengths, five minutes picked, and Start. */
export const Ready = hosting(undefined, { play: openTimer });
export const ReadyPhone = phone(Ready);
/** Running: the button is the countdown for everyone, and the host can pause it, add a minute or stop it. */
export const Running = hosting(fiveMinutes(78), { play: openTimer });
export const RunningPhone = phone(Running);
/** The call stays night in a light theme, and so does its timer. */
export const RunningLight = light(Running);
/** The countdown in the top bar, as everyone sees it while the popover is closed. */
export const InTheTopBar = hosting(fiveMinutes(78));
/** In focus, the countdown stands over the stage at the top left, and opens the same popover there. */
export const InFocus = hosting(fiveMinutes(78), { play: plays(press(/^Workspace/), press('Fill your window with it'), openTimer) });
export const Paused = hosting(fiveMinutes(135, 'paused'), { play: openTimer });
/** The last 30 seconds: the countdown takes the caution colour and a warning sign. */
export const NearTheEnd = hosting(fiveMinutes(282), { play: openTimer });
/** At zero it carries on over time, counting up, until the host adds a minute (from now) or stops it. */
export const OverTime = hosting(fiveMinutes(345), { play: openTimer });
export const OverTimePhone = phone(OverTime);
/** The connection drops: the countdown carries on, and the host's controls wait until it's back. */
export const Reconnecting = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }], timer: fiveMinutes(60), cues: at(1, { do: 'reconnect', seconds: 12 }) } }, { play: openTimer });

/** Priya hosts: Art sees the same countdown, and its popover only reads it. */
export const Participant = inCall({ scenario: 'busy', call: CHECK_IN, script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }], timer: fiveMinutes(35) } }, { play: openTimer });
export const ParticipantPhone = phone(Participant);
/** No timer, and not hosting: there's no Timer to press. */
export const ParticipantNoTimer = inCall({ scenario: 'busy', call: CHECK_IN, script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }] } });
/** A guest let in late sees the countdown already running, and reads it the same way. */
export const Guest = inCall({ scenario: 'signed-out', call: { ...CHECK_IN, guests: [ART] }, script: { here: [{ who: PRIYA, organizer: true }], timer: fiveMinutes(80), cues: at(.1, { do: 'let-in' }) } }, { play: openTimer });
export const GuestPhone = phone(Guest);
