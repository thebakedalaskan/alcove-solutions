/*
 * Leaving and the end of the call (user-flows 6 and 7): the leave sheet for whoever hosts and for everyone else, the
 * call ending with its notes being written until they're ready, leaving it to someone else to host, and the host ending
 * the call or removing you.
 */
import type { Meta } from '@storybook/react-vite';
import { at } from '../../src/api/script';
import { inCall, phone, press } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { AIKO, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, KOFI, MAYA, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/Leaving', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEW_LATE = { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], since: 23 * 60, earlier: REVIEW_TALK.slice(0, 12), talk: { lines: REVIEW_TALK.slice(12) }, summary: REVIEW_SUMMARY };
const CHECK_IN_HERE = [{ who: KOFI }, { who: AIKO }, { who: MAYA }];

/** You organized it: end it for everyone, or leave it with Priya hosting until you're back. */
export const LeaveSheet = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, { play: press('Leave') });
export const LeaveSheetPhone = phone(LeaveSheet);

/** End call for everyone: the sheet becomes Call ended, says who gets the notes, and follows them until they're ready. */
export const CallEnded = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, { play: press('Leave', { then: ['End call for everyone'] }) });
export const CallEndedPhone = phone(CallEnded);

/** Leave and keep it going: Priya hosts, and the lobby says so, with Join and host to take it back. */
export const LeaveItToPriya = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, { play: press('Leave', { then: ['Leave and keep it going'] }) });

/** Invited to Priya's check-in: leaving doesn't end it, and you can join again with the link. */
export const LeavingAsInvited = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: CHECK_IN_HERE, talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY }
}, { play: press('Leave') });

/** Priya ends the call six seconds in: you're told, and the call's page says it has ended. */
export const EndedByTheHost = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-end' },
  script: { here: CHECK_IN_HERE, talk: { lines: CHECK_IN_TALK.slice(-1) }, cues: at(6, { do: 'end' }) }
});
export const EndedByTheHostPhone = phone(EndedByTheHost);

/** Priya removes you five seconds in. */
export const RemovedByTheHost = inCall({ scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-rmv' }, script: { here: CHECK_IN_HERE, cues: at(5, { do: 'remove-you' }) } });
