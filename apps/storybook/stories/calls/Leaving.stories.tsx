/*
 * Leaving and the end of the call (user-flows 6 and 7): the leave sheet for whoever hosts and one-press departure for everyone else, the
 * call ending with its notes being written until they're ready, leaving it to someone else to host, and the host ending
 * the call or removing you.
 */
import { AlcoveApiError } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { pause } from '../../src/api/live';
import { at, ringFrom, run } from '../../src/api/script';
import { ringYou } from '../../src/api/standin';
import { current } from '../../src/api/state';
import { inCall, light, phone, press } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { troubled } from '../pages/changes';
import { AIKO, BOARD_PREP, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, INES, KOFI, MAYA, PREP, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/Leaving', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEW_LATE = { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], since: 23 * 60, earlier: REVIEW_TALK.slice(0, 12), talk: { lines: REVIEW_TALK.slice(12) }, summary: REVIEW_SUMMARY };
const CHECK_IN_HERE = [{ who: KOFI }, { who: AIKO }, { who: MAYA }];

/** You organized it: end it for everyone, or leave it with Priya hosting until you're back. */
export const LeaveSheet = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, { play: press('Leave') });
export const LeaveSheetPhone = phone(LeaveSheet);
export const LeaveSheetLight = light(LeaveSheet);

/**
 * End call for everyone: the sheet becomes Call ended, says who gets the notes, and follows them until they're ready, when
 * it says only that they are.
 */
export const CallEnded = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, { play: press('Leave', { then: ['End call for everyone'] }) });
export const CallEndedPhone = phone(CallEnded);
/** The same while the notes are still being written: they'll be ready in a minute, and the line says how they're coming along. */
export const CallEndedWriting = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, {
  play: async (c) => {
    troubled({ 'notes.progress': 'hold' })(current());
    await press('Leave', { then: ['End call for everyone'] })(c);
  }
});
export const CallEndedWritingPhone = phone(CallEndedWriting);
/** Once they're ready, the card says only that, and Read the notes opens them. */
export const CallEndedReady = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, {
  play: async (c) => {
    await press('Leave', { then: ['End call for everyone'] })(c);
    await c.step('Wait while they’re written. Ready, the card says so, and nothing about a minute', async () => {
      await screen.findByText(/^Notes are ready/, {}, { timeout: 60000 });
    });
  }
});
export const CallEndedReadyPhone = phone(CallEndedReady);

/**
 * The design review had no workspace: Call ended asks Art, its organizer, where its notes go, one of his workspaces or a new
 * one, under who gets them. Leaving them in Notes is doing nothing: Read the notes is still the one thing to press.
 */
export const CallEndedUnfiled = inCall({ scenario: 'no-workspace', call: REVIEW, script: REVIEW_LATE }, { play: press('Leave', { then: ['End call for everyone'] }) });
export const CallEndedUnfiledPhone = phone(CallEndedUnfiled);
export const CallEndedUnfiledLight = light(CallEndedUnfiled);
/** File them in Product: the call's folder goes there, and the sheet says where they went. */
export const CallEndedFiled = inCall({ scenario: 'no-workspace', call: REVIEW, script: REVIEW_LATE }, {
  play: async (c) => {
    await press('Leave', { then: ['End call for everyone'] })(c);
    await c.step('Choose Product in Where these notes go', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: /Where these notes go/ }, { timeout: 10000 }));
      await c.userEvent.click(await screen.findByRole('option', { name: /^Product/ }, { timeout: 8000 }));
    });
    await c.step('File them. The sheet says where they went', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'File them' }));
      await screen.findByText(/^Filed in/, {}, { timeout: 8000 });
    });
  }
});
export const CallEndedFiledPhone = phone(CallEndedFiled);

/** Leave and keep it going: Priya hosts, and the lobby says so, with Join and host to take it back. */
export const LeaveItToPriya = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, { play: press('Leave', { then: ['Leave and keep it going'] }) });

/** Invited to Priya's check-in: one press leaves without a question, and the call goes on. */
export const LeavingAsInvited = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: CHECK_IN_HERE, talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY }
}, { play: press('Leave') });
export const LeavingAsInvitedPhone = phone(LeavingAsInvited);
export const LeavingAsInvitedLight = light(LeavingAsInvited);

/** Admitted from the link, without hosting: the same one-press departure. */
export const LeavingAsGuest = inCall({
  scenario: 'signed-out', call: PREP,
  script: { here: [{ who: KOFI, organizer: true }, { who: MAYA }], cues: at(0.5, { do: 'let-in' }) }
}, { play: press('Leave') });
export const LeavingAsGuestPhone = phone(LeavingAsGuest);

/** Leave stays disabled while the existing departure saves its final pieces. */
export const ParticipantLeaving = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: CHECK_IN_HERE, notes: 'off' },
  then: (session) => { session.leave = () => new Promise(() => {}); }
}, { play: press('Leave') });
export const ParticipantLeavingPhone = phone(ParticipantLeaving);

/** A failed departure keeps the call open; pressing Leave again retries the same action. */
export const ParticipantLeaveRefused = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: CHECK_IN_HERE, notes: 'off' },
  then: (session) => {
    session.leave = () => pause(500).then(() => { throw new AlcoveApiError('unavailable', 'Alcove couldn’t leave the call. Try again.'); });
  }
}, { play: press('Leave') });
export const ParticipantLeaveRefusedPhone = phone(ParticipantLeaveRefused);

/** You take over when Priya drops: hosting, rather than who organized it, determines the question. */
export const StandingIn = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: { here: [], notes: 'off', cues: at(0.5, { do: 'host-drops' }) }
}, {
  play: async (c) => {
    await c.step('Priya’s connection drops and you take over hosting', async () => {
      await screen.findByText(/you’re hosting until Priya is back/, {}, { timeout: 15000 });
    });
    await press('Leave')(c);
  }
});
export const StandingInPhone = phone(StandingIn);

/** Priya ends the call six seconds in: you're told, and the call's page says it has ended. */
export const EndedByTheHost = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-end' },
  script: { here: CHECK_IN_HERE, talk: { lines: CHECK_IN_TALK.slice(-1) }, cues: at(6, { do: 'end' }) }
});
export const EndedByTheHostPhone = phone(EndedByTheHost);

/** Priya removes you five seconds in. */
export const RemovedByTheHost = inCall({ scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-rmv' }, script: { here: CHECK_IN_HERE, cues: at(5, { do: 'remove-you' }) } });

/** Accepting another call leaves this one without a confirmation and continues to the new call's lobby. */
export const ParticipantRungDuringACall = inCall({
  scenario: 'busy', call: CHECK_IN, also: [BOARD_PREP],
  script: {
    here: CHECK_IN_HERE, notes: 'off',
    cues: at(1, run(() => ringYou(ringFrom(INES, BOARD_PREP.code, BOARD_PREP.title))))
  }
});
export const ParticipantRungDuringACallPhone = phone(ParticipantRungDuringACall);
