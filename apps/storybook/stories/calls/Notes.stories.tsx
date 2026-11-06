/*
 * Notes in the call (user-flows 6): the notes sign everyone sees, the Notes panel filling in as people talk (what's
 * decided, the follow-ups, a summary), the transcript, captions, and asking for notes from either side. While notes are
 * on, what's said arrives in the transcript a moment later; the live notes are written again a few seconds after.
 */
import type { Meta } from '@storybook/react-vite';
import { at, asksForNotes, type Present } from '../../src/api/script';
import { inCall, phone, press } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { AIKO, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, KOFI, MAYA, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/Notes', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/** The phone's dock is shorter: Notes, Chat, captions and the rest are under More. */
const MORE = 'More: chat, notes, settings';
const CHECKING_IN: Present[] = [{ who: KOFI }, { who: AIKO }, { who: MAYA }];
/** Notes on from the start: the panel opens beside the stage, and fills in as the design review goes. */
export const NotesOn = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } });
export const NotesOnPhone = { ...phone(NotesOn), play: press(MORE, { then: ['Notes'] }) };

/** Seven minutes in: two things decided, the follow-ups handed out, and more coming. Anyone who gets the notes can tick one. */
const LATE = { here: REVIEWERS, since: 7 * 60, earlier: REVIEW_TALK.slice(0, 9), talk: { lines: REVIEW_TALK.slice(9) }, summary: REVIEW_SUMMARY };
export const DecidedAndFollowUps = inCall({ scenario: 'call-soon', call: REVIEW, script: LATE });
export const DecidedAndFollowUpsPhone = { ...phone(DecidedAndFollowUps), play: press(MORE, { then: ['Notes'] }) };

/** The live transcript, each line a moment after it's said. */
export const Transcript = inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }, { play: press('Notes', { tab: 'Transcript' }) });
export const TranscriptPhone = { ...phone(Transcript), play: press(MORE, { then: ['Notes'], tab: 'Transcript' }) };

/** Captions: the newest line, under the stage. */
export const Captions = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } }, { play: press('Turn on captions') });
/** On a phone, captions are turned on from More. */
export const CaptionsPhone = { ...phone(Captions), play: press(MORE, { then: ['Turn on captions'] }) };

/** Notes off: nothing is written down until the organizer, you, turns them on. */
export const NotesOff = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off', talk: { lines: REVIEW_TALK } } }, { play: press('Notes') });

/** Notes paused: nothing is recorded, transcribed or sent to the AI until you resume. */
export const NotesPaused = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, notes: 'paused' } }, { play: press('Notes') });

/** Notes off, and Priya asks for them, then Kofi: you hear it, the sign says Notes requested, and Turn on is a press away. */
export const NotesRequested = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, notes: 'off', cues: [...at(3, asksForNotes(PRIYA)), ...at(7, asksForNotes(KOFI))] }
});
export const NotesRequestedPhone = phone(NotesRequested);

/** At Priya's check-in, notes are off: you ask for them, and ten seconds in Priya turns them on. */
export const AskingForNotes = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: { here: CHECKING_IN, notes: 'off', talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY, cues: at(10, { do: 'notes', mode: 'on' }) }
}, {
  play: press('Notes', { then: ['Ask for notes'] })
});

/** You ask, and Priya says not now. */
export const NotNow = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-nno' },
  script: { here: CHECKING_IN, notes: 'off', talk: { lines: CHECK_IN_TALK }, cues: at(8, { do: 'not-now' }) }
}, {
  play: press('Notes', { then: ['Ask for notes'] })
});

/** Priya pauses notes six seconds in, and resumes them at twenty: everyone is told, each time. */
export const PausedByTheOrganizer = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-pse' },
  script: { here: CHECKING_IN, talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY, cues: [...at(6, { do: 'notes', mode: 'paused' }), ...at(20, { do: 'notes', mode: 'on' })] }
});
