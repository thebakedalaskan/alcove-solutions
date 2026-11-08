/*
 * The real call ready to open its native floating window. Storybook's call and media remain scripted; Document PiP
 * stays the browser's own API. Open the preview as its own tab and press Open floating call yourself: a synthetic
 * userEvent in the Storybook iframe cannot supply the top-level trusted gesture that the browser requires.
 */
import { AlcoveApiError } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { at, chats, knocks, raisesHand, shares, stopsSharing } from '../../src/api/script';
import { inCall, light, phone, press } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { AIKO, CHECKLIST, DIEGO, KOFI, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = {
  title: 'Calls/Floating call',
  ...pages,
  parameters: {
    ...pages.parameters,
    docs: { description: { component: 'Open the preview as its own browser tab, then press Open floating call with a real click. Storybook does not replace Document Picture-in-Picture or claim to verify native window or automatic-opening behavior.' } }
  }
} satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const ready = { play: press('Your view') };

/** View exposes manual opening, the opt-in preference and the browser's actual support state. */
export const ReadyToOpen = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY }
}, ready);
export const ReadyToOpenLight = light(ReadyToOpen);
/** On a phone, normal call controls remain available whether the browser supports floating calls or not. */
export const OnAPhone = phone(inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }));

/** The selected share changes and ends in the same real call; the compact view follows the allowed picture. */
export const ShareChanges = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: {
    here: [{ who: PRIYA, sharing: CHECKLIST }, { who: KOFI }, { who: AIKO }],
    cues: [...at(20, shares(KOFI, CHECKLIST)), ...at(35, stopsSharing(PRIYA)), ...at(50, stopsSharing(KOFI))]
  }
}, ready);
/** Open the floating call manually; it retains its window through the scripted reconnect. */
export const Reconnects = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, cues: at(20, { do: 'reconnect', seconds: 15 }) }
}, ready);
/** The compact view receives counts; opening Chat, hands or the waiting room returns to the full call. */
export const AttentionArrives = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: {
    here: REVIEWERS,
    cues: [...at(20, raisesHand(KOFI)), ...at(25, chats(AIKO, 'The launch plan is ready for review.')), ...at(30, knocks(DIEGO))]
  }
}, ready);
/** End of the underlying call closes the native presentation; closing its window alone never leaves. */
export const CallEnds = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, cues: at(35, { do: 'end' }) }
}, ready);

/** The stand-in refuses either departure action. The real call retains its session and lets the person stay or retry. */
export const LeaveRefused = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off' },
  then: (session) => {
    session.leave = () => Promise.reject(new AlcoveApiError('unavailable', 'Alcove couldn’t leave the call. Try again.'));
    session.handOff = () => Promise.reject(new AlcoveApiError('unavailable', 'Alcove couldn’t hand over the call. Try again.'));
  }
}, ready);

/** The same shared hand action can fail from either view; no second session is introduced for the compact window. */
export const HandRefused = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS },
  then: (session) => {
    session.setHand = () => Promise.reject(new AlcoveApiError('unavailable', 'Alcove couldn’t change your raised hand. Try again.'));
  }
}, ready);

/** The story browser denies devices. Join with them off, then try either shared control from the real call. */
export const DevicesBlocked = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, you: { mic: false, cam: false }
}, { ...ready, parameters: { opening: { browser: { devices: 'denied' } } } });
