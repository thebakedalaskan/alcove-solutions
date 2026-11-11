/*
 * Notes in the call (user-flows 6): the notes sign everyone sees, Notes in your side filling in as people talk (what's
 * decided, the follow-ups, a summary, and Yours at the foot, for you alone), the transcript and Ask as its tabs, captions from
 * More, and asking for notes from either side. While notes are on, what's said arrives in the transcript a moment later; the
 * live notes are written again a few seconds after.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, asksForNotes, says, UNENCRYPTED_MODEL, type Present } from '../../src/api/script';
import { MORE, inCall, light, phone, plays, press, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { FOLLOW_UP_SCRIPT } from './followUps';
import { AIKO, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, KOFI, MAYA, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/Notes', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
const CHECKING_IN: Present[] = [{ who: KOFI }, { who: AIKO }, { who: MAYA }];
/** Notes on from the start: Notes opens in your side, beside the stage, and fills in as the design review goes. On a phone, it's a sheet from More. */
export const NotesOn = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } }, { play: reach('Notes') });
export const NotesOnPhone = phone(NotesOn);
/** In a light theme your side is light, and the stage, the dock and what's shared stay night. */
export const NotesOnLight = light(NotesOn);

/** Seven minutes in: two things decided, with follow-up suggestions waiting for review. Adding one makes it an actual task. */
const LATE = { here: REVIEWERS, since: 7 * 60, earlier: REVIEW_TALK.slice(0, 9), talk: { lines: REVIEW_TALK.slice(9) }, summary: REVIEW_SUMMARY };
export const DecidedAndFollowUps = inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }, { play: reach('Notes') });
export const DecidedAndFollowUpsPhone = phone(DecidedAndFollowUps);
/** Yours, at the foot of the notes: the bookmark in Notes' head (or B) marks this moment, for you alone. */
export const MarkAMoment = {
  ...DecidedAndFollowUps, name: 'Mark a moment',
  play: plays(reach('Notes'), press('Mark this moment, only you', { then: ['Open'] }))
};

/** The live transcript, Notes' second tab, each line a moment after it's said. */
export const Transcript = inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }, { play: reach('Notes', { tab: 'Transcript' }) });
export const TranscriptPhone = phone(Transcript);
/** Bookmarks the transcript's second line, as a person would: pointing at it, then its bookmark. */
const bookmarkALine: NonNullable<PageStory['play']> = async ({ userEvent, step }) => {
  await step('Bookmark a line in your own notes', async () => {
    const marks = await screen.findAllByRole('button', { name: 'Bookmark this line in your own notes, which only you see' }, { timeout: 10000 });
    const mark = marks[1] ?? marks[0];
    if (mark) await userEvent.click(mark);
  });
};
/** A line bookmarked in your own notes: its bookmark stays in sight, ticked, and says Remove your bookmark. It's in Yours, under Notes. */
export const BookmarkALine = { ...Transcript, name: 'Bookmark a line', play: plays(reach('Notes', { tab: 'Transcript' }), bookmarkALine) };
export const BookmarkALinePhone = phone(BookmarkALine);
/** Your side takes your theme: the ticked bookmark stays warm in light too. */
export const BookmarkALineLight = light(BookmarkALine);
/** Pressed again, the bookmark comes back off, out of Yours, and the toast says so. */
export const TakeABookmarkBack = { ...Transcript, name: 'Take a bookmark back', play: plays(reach('Notes', { tab: 'Transcript' }), bookmarkALine, press('Remove your bookmark')) };
/** Ask, Notes' third tab: catching up and asking about the call, for you alone. */
export const Ask = inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }, { play: reach('Notes', { tab: 'Ask' }) });
export const AskPhone = phone(Ask);

/** Captions, turned on from More: the newest line, under the stage, with its language on the caption itself. */
export const Captions = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } }, { play: press(MORE, { then: ['Turn on captions'] }) });
export const CaptionsPhone = phone(Captions);

/** The call's AI model isn't in a secure enclave: what's captured says so in caution, with Unencrypted, instead of claiming confidential compute. */
export const UnencryptedModel = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, model: UNENCRYPTED_MODEL, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } }, { play: press('Notes on. What’s captured') });

/** Notes off: nothing is written down until the organizer, you, turns them on. */
export const NotesOff = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off', talk: { lines: REVIEW_TALK } } }, { play: reach('Notes') });

/** Notes paused: nothing is recorded, transcribed or sent to the AI until you resume. */
export const NotesPaused = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, notes: 'paused' } }, { play: reach('Notes') });

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
  play: reach('Notes', { then: ['Ask for notes'] })
});

/** You ask, and Priya says not now. */
export const NotNow = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-nno' },
  script: { here: CHECKING_IN, notes: 'off', talk: { lines: CHECK_IN_TALK }, cues: at(8, { do: 'not-now' }) }
}, {
  play: reach('Notes', { then: ['Ask for notes'] })
});

/** Priya pauses notes six seconds in, and resumes them at twenty: everyone is told, each time. */
export const PausedByTheOrganizer = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-pse' },
  script: { here: CHECKING_IN, talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY, cues: [...at(6, { do: 'notes', mode: 'paused' }), ...at(20, { do: 'notes', mode: 'on' })] }
});

/** One actual task, two optional proposals. The checklist does not grow until someone adds one. */
export const FollowUpsAndSuggestions = inCall({ scenario: 'call-soon', call: REVIEW, script: FOLLOW_UP_SCRIPT }, { play: reach('Notes') });
export const FollowUpsAndSuggestionsPhone = phone(FollowUpsAndSuggestions);
export const FollowUpsAndSuggestionsLight = light(FollowUpsAndSuggestions);
/** The same review in the workspace's Follow-ups page. */
export const ReviewInWorkspace = inCall({ scenario: 'call-soon', call: REVIEW, script: FOLLOW_UP_SCRIPT }, {
  play: plays(reach('Workspace'), press('Follow-ups'), press('2 suggestions from the call'))
});
export const ReviewInWorkspacePhone = phone(ReviewInWorkspace);
export const ReviewInWorkspaceLight = light(ReviewInWorkspace);
/** Another proposal arrives while this fixed batch is open, waiting behind its own count. */
export const SuggestionsArriveDuringReview = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { ...FOLLOW_UP_SCRIPT, cues: at(12, says(PRIYA, 'We should check the launch email on Thursday.', { hands: { text: 'Check the launch email', due: 'Thursday' } })) }
}, { play: plays(reach('Notes'), press('2 suggestions from the call')) });
