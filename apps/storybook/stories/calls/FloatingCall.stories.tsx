/*
 * The real call ready to open its native floating window. Storybook's call and media remain scripted; Document PiP
 * stays the browser's own API except in explicit unsupported/refused failure scenarios. Open the preview as its own
 * tab and press Open floating call yourself: a synthetic userEvent cannot establish native opening behavior.
 */
import { AlcoveApiError } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { at, chats, knocks, raisesHand, shares, stopsSharing } from '../../src/api/script';
import { MORE, inCall, light, phone, press } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { AIKO, CHECK_IN, CHECKLIST, DIEGO, KOFI, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = {
  title: 'Calls/Floating call',
  ...pages,
  parameters: {
    ...pages.parameters,
    docs: { description: { component: 'The call floats automatically when the browser permits it, without a separate Alcove preference. More holds Open floating call for manual opening: open the preview as its own browser tab and press it with a real click. The scripted media cannot establish native capture eligibility; automatic opening needs verification in the HTTPS app with browser permission and an already-allowed live device, which can stay muted. Storybook does not replace Document Picture-in-Picture or claim native automatic-opening coverage.' } }
  }
} satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const ready = { play: press(MORE) };

/** More holds manual opening; automatic opening follows the browser's native permission without another control. */
export const ReadyToOpen = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY }
}, ready);
export const ReadyToOpenLight = light(ReadyToOpen);
/** The unavailable action explains why, without changing the active call or requesting devices. */
export const Unsupported = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off' }, you: { mic: false, cam: false }
}, { ...ready, parameters: { opening: { browser: { floatingWindow: 'unsupported' } } } });
export const UnsupportedLight = light(Unsupported);
export const UnsupportedPhone = phone(Unsupported);
export const UnsupportedPhoneLight = light(UnsupportedPhone);

/** A refusal keeps More open with its explanation and the same manual action available to retry. */
export const OpeningBlocked = inCall({
  scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off' }, you: { mic: false, cam: false }
}, { play: press(MORE, { then: ['Open floating call'] }), parameters: { opening: { browser: { floatingWindow: 'blocked' } } } });
export const OpeningBlockedLight = light(OpeningBlocked);
export const OpeningBlockedPhone = phone(OpeningBlocked);
export const OpeningBlockedPhoneLight = light(OpeningBlockedPhone);
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
/** The compact view receives counts; opening Chat, hands, Q&A or the waiting room returns to the full call. */
export const AttentionArrives = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: {
    here: REVIEWERS,
    cues: [...at(20, raisesHand(KOFI)), ...at(22, { do: 'question', who: PRIYA, text: 'Which team reviews the launch checklist?' }), ...at(25, chats(AIKO, 'The launch plan is ready for review.')), ...at(30, knocks(DIEGO))]
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

/** A participant uses the same immediate Leave action in the real floating window. Open it with a real browser click. */
export const ParticipantReadyToOpen = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: [{ who: KOFI }, { who: AIKO }], notes: 'off' }
}, ready);
export const ParticipantReadyToOpenLight = light(ParticipantReadyToOpen);

/** The participant stays in the floating call after a refused departure, with Leave available to retry. */
export const ParticipantLeaveRefused = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: [{ who: KOFI }, { who: AIKO }], notes: 'off' },
  then: (session) => {
    session.leave = () => Promise.reject(new AlcoveApiError('unavailable', 'Alcove couldn’t leave the call. Try again.'));
  }
}, ready);
