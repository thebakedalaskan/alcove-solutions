/*
 * Notes in the call (user-flows 6): the notes sign everyone sees, and Notes in your side: its state in one pill beside its name
 * (which opens what's captured, as the sign does), the notes filling in as people talk (a short summary, what's decided, the
 * follow-ups with what the call suggests under them), the transcript, Ask and Yours as its tabs, Note to self and the bookmark at
 * its foot, a bar under the tabs when capture isn't simply live, captions from More, and asking for notes from either side.
 * While notes are on, what's said arrives in the transcript a moment later; the live notes are written again a few seconds after.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, asksForNotes, notesRunningOut, notesStop, run, says, UNENCRYPTED_MODEL, type Present } from '../../src/api/script';
import { current } from '../../src/api/state';
import { MORE, clearSide, inCall, light, phone, plays, press, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { monthsFrom, notesStopped, overLimits, proPlan, withProMonths } from '../../src/world/plans';
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
/** The bookmark at the foot of Notes (or B) marks this moment in Yours, for you alone; the toast's Open goes there. */
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
/** Yours, Notes' fourth tab, before anything's in it: only you see what's here, and it says what can go in. */
export const YoursFirst = inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }, { play: reach('Notes', { tab: 'Yours' }) });
export const YoursFirstPhone = phone(YoursFirst);
/** The notes couldn't be written again just now: they stay as they were, and the summary's time says since when, in caution. */
export const NotUpdated = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, notesStale: true } }, { play: reach('Notes') });

/** Captions, turned on from More: the newest line, under the stage, with its language on the caption itself. */
export const Captions = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } }, { play: press(MORE, { then: ['Turn on captions'] }) });
export const CaptionsPhone = phone(Captions);

/** Live, beside Notes: the state in a word, which opens what's captured, the same card as the sign at the top of the call, here with the organizer's Pause notes and Turn off. */
export const WhatsCapturedFromNotes = inCall({ scenario: 'call-soon', call: REVIEW, script: LATE }, { play: plays(reach('Notes'), press('Live. What’s captured')) });
export const WhatsCapturedFromNotesPhone = phone(WhatsCapturedFromNotes);
export const WhatsCapturedFromNotesLight = light(WhatsCapturedFromNotes);

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
}, { play: reach('Notes') });
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

/** Priya's browser, which takes the notes, still records but can't listen: nothing new is transcribed, and Notes says so in caution, on every tab. */
export const CantListen = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-cnt' },
  script: { here: CHECKING_IN, talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY, cues: at(4, { do: 'host-cant-hear', records: true }) }
}, { play: reach('Notes') });
/** Priya's browser can neither record nor listen: notes are unavailable, the pill says so in caution, and a bar says why. */
export const CantCapture = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-cap' },
  script: { here: CHECKING_IN, talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY, cues: at(4, { do: 'host-cant-hear', records: false }) }
}, { play: reach('Notes') });
export const CantCapturePhone = phone(CantCapture);

/** Priya pauses notes six seconds in, and resumes them at twenty: everyone is told, each time. */
export const PausedByTheOrganizer = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-pse' },
  script: { here: CHECKING_IN, talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY, cues: [...at(6, { do: 'notes', mode: 'paused' }), ...at(20, { do: 'notes', mode: 'on' })] }
});

/*
 * What the plan says in a call (docs: Plans and usage; docs/product/user-flows.md 16.9; the canvas's CallOut): a banner from the top,
 * once for the call, that stays until its × is pressed. Notes stopping is said to everyone; notes about to run out, to the
 * organizer alone. While they're stopped, a caution bar between Notes' head and its tabs says why, the pill says Stopped and
 * the sign at the top Notes stopped; the banner waits while Notes is open. Only the organizer has the ways to more (Get Pro,
 * Add 10 hours · $15, Make room), which open checkout over the call. Once their plan has more, notes come on again by
 * themselves, and the notes mark where they stopped and came on again. The world's plan stops with the call, as the server's
 * does: the organizer is Art, so it's his.
 */
/** Art's notes for the period run out: the world's plan says so too. */
const planOut = run(() => { current().plan = notesStopped(); });
/** Art's storage is full, past its grace. */
const storageOut = run(() => { current().plan = overLimits(); });
/** A payment for a month of Pro lands, from checkout or a phone: Pro starts now, with its whole allowance. */
const proBought = run(() => { const w = current(); w.plan = withProMonths(w.plan, monthsFrom(Date.now() - 60_000, 1)); });
/** 10 more hours of notes for this period, bought from the balance: they add to the period's notes, which aren't stopped now. */
const hoursBought = run(() => { const w = current(); w.plan = { ...w.plan, notes: { minutesLeft: 600, minutesPerPeriod: w.plan.notes.minutesPerPeriod + 600, stopped: false } }; });

/** Art organizes this review on Free. Three seconds in, Art's notes are about to run out at this call's pace: only Art is told. */
export const NotesRunningOut = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, cues: at(3, notesRunningOut()) } });
export const NotesRunningOutPhone = phone(NotesRunningOut);
/**
 * Three seconds in, the period's notes run out: they go off for everyone. Notes, open beside the stage, says it over its tabs:
 * "Notes stopped at this period's 5 hours", the call carries on, with Get Pro and Add 10 hours · $15 for Art, on Free.
 */
export const NotesStoppedByTheirPlan = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, cues: at(3, planOut, notesStop('notes')) } });
/** On a phone Notes is put away, so the banner over the call says it, with the same two ways to more. */
export const NotesStoppedByTheirPlanPhone = phone(NotesStoppedByTheirPlan);
/** Your side takes your theme: the bar and its buttons are light, the stage night. */
export const NotesStoppedByTheirPlanLight = light(NotesStoppedByTheirPlan);
/** With Notes put away, the banner drops over the stage and says the same, until its × is pressed. */
export const NotesStoppedBanner = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, cues: at(3, planOut, notesStop('notes')) } }, { play: clearSide });
/** On Pro, getting Pro again doesn't help: more hours for this period are the one way to more, filled. */
export const NotesStoppedOnPro = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { ...LATE, cues: at(3, run(() => { const p = proPlan(); current().plan = { ...p, notes: { ...p.notes, minutesLeft: 0, stopped: true } }; }), notesStop('notes')) }
});
/** Storage ran out instead: it says storage, with Get Pro and Make room, which opens the Drive beside the call. */
export const NotesStoppedStorageFull = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, cues: at(3, storageOut, notesStop('storage')) } });
export const NotesStoppedStorageFullPhone = phone(NotesStoppedStorageFull);
/** At Priya's check-in Priya's notes run out: everyone is told whose notes they were, with nothing to buy. */
export const NotesStoppedForTheOrganizer = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: { here: CHECKING_IN, talk: { lines: CHECK_IN_TALK }, summary: CHECK_IN_SUMMARY, cues: at(5, notesStop('notes')) }
});
export const NotesStoppedForTheOrganizerPhone = phone(NotesStoppedForTheOrganizer);
export const NotesStoppedForTheOrganizerLight = light(NotesStoppedForTheOrganizer);
/**
 * Notes stop three seconds in, and two seconds later Art's payment for Pro lands. Within ten seconds his browser hears it, notes
 * come on again by themselves, a toast says "You're on Pro. Notes are on again." and the notes mark "Notes stopped" and "Notes
 * on again", in rec.
 */
export const NotesOnAgainWithPro = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, cues: [...at(3, planOut, notesStop('notes')), ...at(5, proBought)] } });
export const NotesOnAgainWithProPhone = phone(NotesOnAgainWithPro);
export const NotesOnAgainWithProLight = light(NotesOnAgainWithPro);
/** The same with 10 more hours for this period: "Notes are on again." */
export const NotesOnAgainWithHours = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...LATE, cues: [...at(3, planOut, notesStop('notes')), ...at(5, hoursBought)] } });

/** One actual task, and under it what the call suggests, dashed, with Add and ×. The checklist does not grow until someone adds one. */
export const FollowUpsAndSuggestions = inCall({ scenario: 'call-soon', call: REVIEW, script: FOLLOW_UP_SCRIPT }, { play: reach('Notes') });
export const FollowUpsAndSuggestionsPhone = phone(FollowUpsAndSuggestions);
export const FollowUpsAndSuggestionsLight = light(FollowUpsAndSuggestions);
/** The same review in the workspace's Follow-ups page. */
export const ReviewInWorkspace = inCall({ scenario: 'call-soon', call: REVIEW, script: FOLLOW_UP_SCRIPT }, {
  play: plays(reach('Workspace'), press('Follow-ups'), press('2 suggestions from the call'))
});
export const ReviewInWorkspacePhone = phone(ReviewInWorkspace);
export const ReviewInWorkspaceLight = light(ReviewInWorkspace);
/** Points at what the call suggests, as a person would before pressing Add. */
const pointAtSuggestions: NonNullable<PageStory['play']> = async ({ userEvent, step }) => {
  await step('Point at what the call suggests', async () => {
    await userEvent.hover(await screen.findByRole('group', { name: 'Suggested from the call' }, { timeout: 10000 }));
  });
};
/** Another suggestion arrives while your pointer is on them: the rows stay as they were, and it waits behind "1 more suggested". */
export const SuggestionsArriveWhileYouPoint = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { ...FOLLOW_UP_SCRIPT, cues: at(12, says(PRIYA, 'We should check the launch email on Thursday.', { hands: { text: 'Check the launch email', due: 'Thursday' } })) }
}, { play: plays(reach('Notes'), pointAtSuggestions) });
