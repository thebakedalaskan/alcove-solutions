/*
 * Leaving, and the call's own page after it (user-flows 7): Leave's question for whoever hosts, over Leave; Leave ending a call
 * you're alone in at once, while any other way out (answering a ring, say) asks first; and every state of the page a call leaves
 * you on, each reached for real: you ended it, it ended without you (named by nobody), you left it, with notes on, paused or
 * off, you left it with someone hosting, it ended while you were on its page, the notes being written, written, or slow, and
 * Rejoin, with the button as you were or with J, muted with the camera off. Being removed and joining another call stay as
 * they were.
 */
import { AlcoveApiError } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { pause } from '../../src/api/live';
import { at, joins, ringFrom, run } from '../../src/api/call/script';
import { ringYou } from '../../src/api/calls/rings';
import { current } from '../../src/api/state';
import { inCall, light, phone, plays } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { troubled } from '../pages/changes';
import { AIKO, BOARD_PREP, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, INES, KOFI, MAYA, PREP, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK, SAM, STARTED } from './talk';

const meta = { title: 'Calls/Leaving', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
const SOON = { timeout: 10000 };
const LATER = { timeout: 40000 };

/** Art's design review, twenty-three minutes in, with Priya, Kofi and Aiko, notes on. */
const REVIEW_LATE = { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], since: 23 * 60, earlier: REVIEW_TALK.slice(0, 12), talk: { lines: REVIEW_TALK.slice(12) }, summary: REVIEW_SUMMARY };
/** Priya's check-in, with Kofi, Aiko and Maya. */
const CHECK_IN_HERE = [{ who: KOFI }, { who: AIKO }, { who: MAYA }];
const CHECKING_IN = { here: CHECK_IN_HERE, since: 19 * 60, earlier: CHECK_IN_TALK.slice(0, 5), talk: { lines: CHECK_IN_TALK.slice(5) }, summary: CHECK_IN_SUMMARY };

/* ---------- what a person does ---------- */
const leave = (why: string): Play => async ({ canvas, userEvent, step }) => {
  await step(why, async () => { await userEvent.click(await canvas.findByRole('button', { name: 'Leave' }, SOON)); });
};
const choose = (name: RegExp, why: string): Play => async ({ userEvent, step }) => {
  await step(why, async () => { await userEvent.click(await screen.findByRole('button', { name }, SOON)); });
};
const waitFor = (text: string | RegExp, why: string, wait = LATER): Play => async ({ step }) => {
  await step(why, async () => { await screen.findByText(text, {}, wait); });
};
/** What the call says happened, said wherever it's said (a toast, and the call's own record of it). */
const told = (text: RegExp, why: string): Play => async ({ step }) => {
  await step(why, async () => { await screen.findAllByText(text, {}, SOON); });
};
const END = /^End for everyone/;
const ended = (title: string): Play => waitFor(`${title} has ended`, 'The call’s own page: it has ended, who was in it, and what comes next');

/* ---------- Leave's question, for whoever hosts ---------- */

/** You host: Leave asks first, over Leave. End for everyone, or leave it going with Priya hosting, chosen already. */
export const LeaveAsks = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, { play: leave('Press Leave. You host, so it asks first, over Leave') });
/** On a phone the question is a sheet. */
export const LeaveAsksPhone = phone(LeaveAsks);
export const LeaveAsksLight = light(LeaveAsks);
/** Change lists who else could host, in the same question. */
export const WhoElseCouldHost = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, {
  play: plays(leave('Press Leave'), choose(/^Change/, 'Change: who else could host, in the same question'))
});
/** Only guests are here with you: nobody can host, so End for everyone is the only choice. */
export const NobodyCanHost = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: [{ who: SAM, guest: true }], notes: 'off' } }, {
  play: leave('Press Leave. Guests can’t host, so leaving ends it for everyone')
});
/** Hosting while Priya's away (her connection dropped, and Kofi came after you): leaving it going comes first. */
export const StandingIn = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: { here: [], notes: 'off', cues: [...at(0.5, { do: 'host-drops' }), ...at(1, joins(KOFI))] }
}, {
  play: plays(
    waitFor(/you’re hosting until Priya is back/, 'Priya’s connection drops, and ten seconds later you host in her place'),
    leave('Press Leave: leaving it going with Kofi hosting comes first')
  )
});
export const StandingInPhone = phone(StandingIn);
/** Ending it: the question says so until it has, and nothing else can be pressed. */
export const Ending = inCall({
  scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE,
  then: (session) => { session.leave = () => new Promise(() => {}); }
}, { play: plays(leave('Press Leave'), choose(END, 'End for everyone: Ending the call…')) });
/** Ending it didn't work: the question says why, in caution, and the call goes on. */
export const EndRefused = inCall({
  scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE,
  then: (session) => { session.leave = () => pause(600).then(() => { throw new AlcoveApiError('unavailable', 'Alcove couldn’t end the call. Try again.'); }); }
}, { play: plays(leave('Press Leave'), choose(END, 'End for everyone. It doesn’t work, and the question says why')) });

/* ---------- the call's page: you ended it ---------- */

/** Alone in the call, Leave ends it at once: nobody to hand it to, nothing to choose. Without notes, Go to Home is the filled button. */
export const Alone = inCall({ scenario: 'busy', call: STARTED, script: { here: [], notes: 'off' } }, {
  play: plays(leave('Press Leave. Nobody else is here, so it ends at once'), ended('Art’s call'))
});
export const AlonePhone = phone(Alone);
/**
 * Alone, any other way out than Leave asks first. Ines rings, and Join would take you to her call: Leave's question opens over
 * Leave instead, End for everyone its only choice, saying leaving ends the call. Closing it keeps you in the call.
 */
export const AloneAndRung = inCall({
  scenario: 'busy', call: STARTED, also: [BOARD_PREP],
  script: { here: [], notes: 'off', cues: at(1, run(() => ringYou(ringFrom(INES, BOARD_PREP.code, BOARD_PREP.title)))) }
}, {
  play: plays(
    async ({ userEvent, step }) => {
      await step('Ines rings while you’re alone in your call. Press Join', async () => {
        await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Ines is ringing you' }, LATER)).getByRole('button', { name: 'Join' }));
      });
    },
    waitFor(/You’re the only one here, so leaving ends the call/, 'Leaving would end your call, so it asks first: End for everyone, or stay', SOON)
  )
});
/** You ended it: who was in it, and the notes being written (held here, so they stay being written), with who gets them. */
export const EndedWriting = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, {
  play: plays(
    async () => { troubled({ 'notes.progress': 'hold' })(current()); },
    leave('Press Leave'), choose(END, 'End for everyone'), ended('Design review')
  )
});
export const EndedWritingPhone = phone(EndedWriting);
export const EndedWritingLight = light(EndedWriting);
/** Once they're written: their first lines, what was decided and the follow-ups, and Read the notes. */
export const EndedReady = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, {
  play: plays(leave('Press Leave'), choose(END, 'End for everyone'), ended('Design review'),
    waitFor(/^Read the notes/, 'Stay a moment: they’re written, and the page says what they say'))
});
export const EndedReadyPhone = phone(EndedReady);
/** Their progress can't be followed: they'll be in Calls when they're ready, and nobody needs to wait. */
export const EndedSlow = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, {
  play: plays(
    async () => { troubled({ 'notes.progress': 'failed' })(current()); },
    leave('Press Leave'), choose(END, 'End for everyone'), ended('Design review')
  )
});
/** Notes were never on: no notes were taken, and Go to Home is the filled button. */
export const EndedWithoutNotes = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...REVIEW_LATE, notes: 'off', earlier: [] } }, {
  play: plays(leave('Press Leave'), choose(END, 'End for everyone. The question doesn’t mention notes'), ended('Design review'))
});

/* ---------- the call's page: whoever hosts ended it ---------- */

/**
 * Priya ends her check-in eight seconds in: it ended for everyone, and the notes are being written for everyone invited, you
 * included. The page says how long it ran and who was in it, as it does when you end it: a call can end without whoever hosts
 * ending it (Alcove ends one nobody can host), and this tab can't tell which, so it names nobody.
 */
export const EndedByTheHost = inCall({ scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-end' }, script: { ...CHECKING_IN, cues: at(8, { do: 'end' }) } }, {
  play: plays(
    waitFor('Launch check-in has ended', 'Priya ends it for everyone: the call eases back, and its page says so'),
    waitFor(/min with Priya, Kofi, Aiko and Maya$/, 'How long it ran and who was in it, naming nobody as the one who ended it', SOON)
  )
});
export const EndedByTheHostPhone = phone(EndedByTheHost);
/** A guest when Kofi ends it: he can share the notes with them, and there's nothing to press. */
export const EndedForAGuest = inCall({
  scenario: 'signed-out', call: PREP,
  script: { here: [{ who: KOFI, organizer: true }, { who: MAYA }], cues: [...at(0.5, { do: 'let-in' }), ...at(8, { do: 'end' })] }
}, { play: waitFor('Harbourline prep has ended', 'Kofi ends it: a guest is told who can share the notes, and nothing else') });

/* ---------- the call's page: you left it ---------- */

/** You left Priya's check-in, and it goes on: who's still in it, how long it's run, ticking, and Rejoin. */
export const Left = inCall({ scenario: 'busy', call: CHECK_IN, script: CHECKING_IN }, {
  play: plays(leave('Press Leave. You don’t host, so nothing is asked'), waitFor('You left Launch check-in', 'Its page: who’s still in it, and Rejoin', SOON))
});
export const LeftPhone = phone(Left);
export const LeftLight = light(Left);
/** Priya paused the notes before you left: the page says they're paused, and that you get what was written when it ends. */
export const LeftWhileNotesPaused = inCall({ scenario: 'busy', call: CHECK_IN, script: { ...CHECKING_IN, cues: at(1, { do: 'notes', mode: 'paused' }) } }, {
  play: plays(
    told(/The organizer paused notes/, 'Priya pauses the notes'),
    leave('Press Leave'),
    waitFor(/Notes are paused\. You get what was written when it ends\./, 'Its page says the notes are paused, as they were when you left', SOON)
  )
});
/** Priya turned the notes off before you left: they were on earlier, so you still get what was written when it ends. */
export const LeftWithNotesOff = inCall({ scenario: 'busy', call: CHECK_IN, script: { ...CHECKING_IN, cues: at(1, { do: 'notes', mode: 'off' }) } }, {
  play: plays(
    told(/The organizer turned off notes/, 'Priya turns the notes off'),
    leave('Press Leave'),
    waitFor(/Notes are off\. You get what was written when it ends\./, 'Its page says the notes are off, and what was written still comes to you', SOON)
  )
});
/** A guest who left: Rejoin, and nothing else, since there's no Home to go to. */
export const LeftAsAGuest = inCall({
  scenario: 'signed-out', call: PREP,
  script: { here: [{ who: KOFI, organizer: true }, { who: MAYA }], cues: at(0.5, { do: 'let-in' }) }
}, { play: plays(leave('Press Leave, once you’re in'), waitFor('You left Harbourline prep', 'Its page: who’s still in it, and Rejoin only', SOON)) });
/** You hosted, and left it going: Priya hosts until you're back, and Rejoin takes it back. */
export const LeftWithPriya = inCall({ scenario: 'call-soon', call: REVIEW, script: REVIEW_LATE }, {
  play: plays(leave('Press Leave'), choose(/^Leave, Priya hosts/, 'Leave, Priya hosts'), waitFor('You left Design review', 'Priya is hosting until you’re back', SOON))
});
/** Standing in for Priya, you left it with Kofi: he hosts until she's back, and Rejoin doesn't make you the host again. */
export const LeftStandingIn = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: { here: [], notes: 'off', cues: [...at(0.5, { do: 'host-drops' }), ...at(1, joins(KOFI))] }
}, {
  play: plays(
    waitFor(/you’re hosting until Priya is back/, 'Priya’s connection drops, and ten seconds later you host in her place'),
    leave('Press Leave'), choose(/^Leave, Kofi hosts/, 'Leave, Kofi hosts'),
    waitFor(/Kofi is hosting until Priya is back/, 'Its page says who hosts, and until when', SOON)
  )
});
/** You left, and Priya ends it while you're on its page: the page reads the call's card every 10 to 17 seconds, and turns, and the notes are written. */
export const EndedAfterYouLeft = inCall({ scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-aft' }, script: { ...CHECKING_IN, cues: at(10, { do: 'end' }) } }, {
  play: plays(
    leave('Press Leave'),
    waitFor(/It ended after you left/, 'Stay on its page: Priya ends it, and the page turns'),
    waitFor(/^Read the notes/, 'The notes are written: their first lines, and Read the notes')
  )
});
/** Rejoin: straight back in, the microphone and camera as they were, with no join page. */
export const Rejoined = inCall({ scenario: 'busy', call: CHECK_IN, script: CHECKING_IN }, {
  play: plays(
    leave('Press Leave'),
    choose(/^Rejoin/, 'Rejoin, from the call’s page'),
    async ({ canvas, step }) => { await step('Back in the call', async () => { await canvas.findByRole('toolbar', { name: 'Call controls' }, SOON); }); }
  )
});
/** J rejoins too, but with your microphone and camera off: a stray key never puts your voice and picture back in a call you left. */
export const RejoinedWithJ = inCall({ scenario: 'busy', call: CHECK_IN, script: CHECKING_IN }, {
  play: plays(
    leave('Press Leave'),
    waitFor('You left Launch check-in', 'Its page', SOON),
    async ({ userEvent, step }) => { await step('Press J', async () => { await userEvent.keyboard('j'); }); },
    async ({ canvas, step }) => {
      await step('Back in the call, muted, with the camera off', async () => {
        await within(await canvas.findByRole('toolbar', { name: 'Call controls' }, SOON)).findByRole('button', { name: 'Turn camera on' }, SOON);
      });
    }
  )
});
/** Rejoin refused: it says why, and the page stays as it was. */
export const RejoinRefused = inCall({ scenario: 'busy', call: CHECK_IN, script: CHECKING_IN }, {
  play: plays(
    leave('Press Leave'),
    waitFor('You left Launch check-in', 'Its page', SOON),
    async () => { troubled({ 'calls.join': 'failed' })(current()); },
    choose(/^Rejoin/, 'Rejoin. Alcove doesn’t answer, and the page says so')
  )
});

/* ---------- departures that stay as they were ---------- */

/** Leave stays disabled while the departure saves its final pieces. */
export const ParticipantLeaving = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: CHECK_IN_HERE, notes: 'off' },
  then: (session) => { session.leave = () => new Promise(() => {}); }
}, { play: leave('Press Leave') });
export const ParticipantLeavingPhone = phone(ParticipantLeaving);
/** A failed departure keeps the call open; pressing Leave again retries the same action. */
export const ParticipantLeaveRefused = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: CHECK_IN_HERE, notes: 'off' },
  then: (session) => {
    session.leave = () => pause(500).then(() => { throw new AlcoveApiError('unavailable', 'Alcove couldn’t leave the call. Try again.'); });
  }
}, { play: leave('Press Leave') });
export const ParticipantLeaveRefusedPhone = phone(ParticipantLeaveRefused);
/** Priya removes you five seconds in: you're told, and go back to the call's link. */
export const RemovedByTheHost = inCall({ scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-rmv' }, script: { here: CHECK_IN_HERE, cues: at(5, { do: 'remove-you' }) } });
/** Accepting another call leaves this one without a question, and carries on to the new call's lobby. */
export const ParticipantRungDuringACall = inCall({
  scenario: 'busy', call: CHECK_IN, also: [BOARD_PREP],
  script: {
    here: CHECK_IN_HERE, notes: 'off',
    cues: at(1, run(() => ringYou(ringFrom(INES, BOARD_PREP.code, BOARD_PREP.title))))
  }
});
export const ParticipantRungDuringACallPhone = phone(ParticipantRungDuringACall);
