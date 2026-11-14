/*
 * A call's page (user-flows 8): one that happened, played on its night stage with its line under it, what was shared and
 * made in it, and Notes, Transcript and Your notes beside it; and a call ahead, with who's invited and how they answered,
 * the link, the agenda and the notes.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { RETRO_NOTE, afterTheRetro } from '../../../src/api/scenarios';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { withAnAgenda } from '../../../src/world/call-page';
import { iso } from '../../../src/world/clock';
import { withDriveExports, withSharedCallExports } from '../../../src/world/drive-exports';
import { FOLLOW_UP_NOTE, withFollowUpProposals } from '../../../src/world/follow-ups';
import { FOR_JONAS } from '../../../src/world/invitations';
import { DESIGN_CRIT, HIRING_SYNC, withDesignCrit, withHiringSync } from '../../../src/world/scheduling';
import { STATES, inEveryState } from '../../../src/world/states';
import { aQuestionAdded, fromALink, invited, longSide, longSuggestions, troubled, writtenUnencrypted } from '../changes';

const meta = { title: 'Pages/Calls/A call', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The busy afternoon, with a note in every state a note can be in, and the series their calls are in (src/world/states.ts). */
const everyState = { beforeEach: changing(inEveryState) };
const night = { theme: 'dark' } as const;
const laptop = { viewport: { value: 'laptop', isRotated: false } } as const;
const wide = { viewport: { value: 'wide', isRotated: false } } as const;

/* ---------- a call that happened ---------- */

/**
 * The team standup: its title and one line (when, who has the notes, its series, Written in confidential compute), the
 * stage with everyone in arches and the first words as captions, the line under it, Kofi's screen and the document they
 * worked on, and beside it the notes: the gist, For you, Decided, Follow-ups, Still open and How it went.
 */
export const APastCall = page('/calls/n2', 'busy', everyState);
export const APastCallNight = page('/calls/n2', 'busy', { ...everyState, globals: night });
/** 1024 wide: one column, the stage, its line, then the tabs, with Shared among them. */
export const APastCallLaptop = page('/calls/n2', 'busy', { ...everyState, globals: laptop });
export const APastCallWide = page('/calls/n2', 'busy', { ...everyState, globals: wide });
export const APastCallPhone = phone(APastCall);
export const APastCallPhoneNight = phone(page('/calls/n2', 'busy', { ...everyState, globals: night }));

/**
 * A note Priya made visible to the team, as Art reads it while licensed on it: "From Priya, visible to your team", to read,
 * play and ask about. The rest is Priya's: no Share, no Your notes, nothing to settle, add or correct, and nothing to remove.
 */
export const ATeamNote = page('/calls/tn-roadmap', 'team-member');
export const ATeamNoteNight = page('/calls/tn-roadmap', 'team-member', { globals: night });
export const ATeamNotePhone = phone(ATeamNote);

/** ▶ 3:15 on the decision to confirm plays the call there, on the stage: who's speaking lit, their words as captions. Notes stays open. */
export const PlayingAMoment = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press ▶ 3:15 on the decision. It plays on the stage, and the notes stay where they are', async () => {
      const [chip] = await canvas.findAllByRole('button', { name: 'Play the call from 3:15' }, { timeout: 30000 });
      if (chip) await userEvent.click(chip);
    });
  }
});
/** Speed, on the line: the speeds open under it, 0.75× to 2×, the one it plays at ticked, and one press picks another. */
const choosingASpeed: NonNullable<PageStory['play']> = async ({ canvas, userEvent, step }) => {
  await step('Press the speed, 1×, at the end of the line. The speeds open, and one press picks one', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Speed: 1×' }, { timeout: 30000 }));
  });
};
export const ChoosingASpeed = page('/calls/n2', 'busy', { ...everyState, play: choosingASpeed });
export const ChoosingASpeedNight = page('/calls/n2', 'busy', { ...everyState, globals: night, play: choosingASpeed });
/** Opened at a moment, from an answer or a search: the Transcript, at the line said then, lit; the stage shows who said it. */
export const AtAMoment = page('/calls/n2?at=372', 'busy');
/** While Kofi's screen was shared (9:20): it plays on the stage, with whose it is and Kofi small in the corner. */
export const AScreenOnTheStage = page('/calls/n2?at=560&tab=notes', 'busy');
export const AScreenOnTheStageNight = page('/calls/n2?at=560&tab=notes', 'busy', { globals: night });
export const AScreenOnTheStagePhone = phone(AScreenOnTheStage);
export const AScreenOnTheStageWide = page('/calls/n2?at=560&tab=notes', 'busy', { globals: wide });
/** Kofi's screen couldn't be played (its video won't load here): the stage says so, with Try again. */
export const AScreenThatWontPlay = page('/calls/n2?at=560&tab=notes', 'busy', { beforeEach: changing(troubled({ 'notes.screenVideoUrl': 'failed' })) });

/** The Transcript: find, its own download, what was said by chapter, and what isn't sure dotted. */
export const Transcript = page('/calls/n2?tab=transcript', 'busy');
export const TranscriptNight = page('/calls/n2?tab=transcript', 'busy', { globals: night });
export const TranscriptPhone = phone(Transcript);
/** Finding "flag" in the transcript: only the lines that say it, and how many. */
export const FindingInTheTranscript = page('/calls/n2?tab=transcript', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Type “flag” in Find in the transcript', async () => {
      await userEvent.type(await canvas.findByRole('textbox', { name: 'Find in the transcript' }, { timeout: 30000 }), 'flag');
    });
  }
});

/** Your notes: what Art wrote, his bookmark, and the box to write in, which only he reads. */
export const YourNotes = page('/calls/n2?tab=yours', 'busy');
export const YourNotesNight = page('/calls/n2?tab=yours', 'busy', { globals: night });
/** Pointing at one of Art's own notes: Add to the shared notes, Edit and Delete show together, and nothing else does. */
export const YourNotesPointedAt = page('/calls/n2?tab=yours', 'busy', {
  play: async ({ userEvent, step }) => {
    await step('Point at the first thing Art wrote', async () => {
      const row = (await screen.findByText('Ask Priya whether the article covers the team plan.', {}, { timeout: 30000 })).closest('li');
      if (row) await userEvent.hover(row);
    });
  }
});
/** Writing in Your notes: the box is as tall as what's written, two lines here, with the button level with the last. */
export const WritingInYourNotes = page('/calls/n2?tab=yours', 'busy', {
  play: async ({ userEvent, step }) => {
    await step('Write a note only Art reads', async () => {
      const box = await screen.findByRole('textbox', { name: 'Write in your own notes' }, { timeout: 30000 });
      await userEvent.type(box, 'Ask Kofi about the pricing page draft by Friday, and read the onboarding emails before Maya sends them.');
    });
  }
});
/** Ten more of Art's own notes, more in the shared notes and a dozen people: the tab scrolls by itself, and the stage stays. */
export const YourNotesLong = page('/calls/n2?tab=yours', 'busy', { beforeEach: changing(longSide) });
export const NotesLong = page('/calls/n2', 'busy', { beforeEach: changing(longSide) });
export const NotesLongPhone = phone(NotesLong);
/** Something from Art's own notes, on its way to the shared notes: exactly what goes, the moment, and everyone who gets it. */
export const AddingToTheSharedNotes = page('/calls/n2?tab=yours', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Add Art’s own note to the shared notes. It shows exactly what goes, and who gets it', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Add to the shared notes' }, { timeout: 30000 });
      if (first) await userEvent.click(first);
    });
  }
});
/** On a phone, what was shared and made is the Shared tab: Kofi's screen and the document, two across. */
export const SharedOnAPhone = phone(page('/calls/n2?tab=shared', 'busy'));
/**
 * Art's standup, which he made visible to Vandelay's team: the shared notes' box says everyone on the team reads what's written
 * there, as well as the people who have the notes.
 */
export const SharedNotesTheTeamReads = page('/calls/n2', 'team-admin');
export const SharedNotesTheTeamReadsNight = page('/calls/n2', 'team-admin', { globals: night });
/** The same note: adding from Art's own notes says the team reads it too, and counts its licensed people in. */
export const AddingWhileTheTeamReads = page('/calls/n2?tab=yours', 'team-admin', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Add Art’s own note to the shared notes. Who reads it names everyone on the team too', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Add to the shared notes' }, { timeout: 30000 });
      if (first) await userEvent.click(first);
    });
  }
});
export const AddingWhileTheTeamReadsPhone = phone(AddingWhileTheTeamReads);

/** Confirm, then I'll do it: each says what happened with Undo, and For you says nothing is waiting on Art any more. */
export const ForYouDone = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Confirm the decision', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Confirm' }, { timeout: 30000 }));
    });
    await step('Take on the follow-up. Nothing from this call is waiting on Art', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'I’ll do it' }, { timeout: 8000 }));
      await canvas.findByText(/^Nothing from this call is waiting on you/, {}, { timeout: 8000 });
    });
  }
});
/** Download: the transcript, the notes, the recording and Kofi's screen, each opened on this device. */
export const DownloadOpen = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Download', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Download' }, { timeout: 30000 }));
    });
  }
});
/** More: pin, copy as text, meet again, Google Drive and writing the notes again, then deleting them. */
export const MoreOpen = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press More', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'More' }, { timeout: 30000 }));
    });
  }
});
/** The standup's full summary, opened under the gist. */
export const FullSummaryOpen = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Full summary', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Full summary' }, { timeout: 30000 }));
    });
  }
});
/** Pointing at Ask about this call: its suggestions show above it, over the end of the notes. */
export const PointingAtAsk = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Point at the ask bar. The suggested questions show above it', async () => {
      await userEvent.hover(await canvas.findByRole('textbox', { name: /Ask about this call/ }, { timeout: 30000 }));
    });
  }
});
/** Long suggested questions on a phone wrap above the ask bar; the end of the notes scrolls clear of them. */
export const LongSuggestions = phone(page('/calls/n2', 'busy', {
  beforeEach: changing(longSuggestions),
  play: async ({ canvas, userEvent, step }) => {
    await step('Press in the ask bar. The suggested questions show above it', async () => {
      await userEvent.click(await canvas.findByRole('textbox', { name: /Ask about this call/ }, { timeout: 30000 }));
    });
  }
}));
/** Asking about the call: a suggested question, answered with the moments it comes from, for Art alone. */
export const Asking = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Ask what was decided. The answer is read in confidential compute and cites the moments it comes from', async () => {
      await userEvent.type(await canvas.findByRole('textbox', { name: /Ask about this call/ }, { timeout: 30000 }), 'What did we decide?{Enter}');
    });
  }
});
/** A decision's menu: who it's for, rewording, then What was said behind it and every change to it. */
export const ADecisionsMenu = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Open the menu of the first decision', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Change this' }, { timeout: 30000 });
      if (first) await userEvent.click(first);
    });
  }
});

/** The standup was written by a model that isn't in a secure enclave: the line says so in caution. */
export const WrittenUnencrypted = page('/calls/n2', 'busy', { beforeEach: changing(writtenUnencrypted) });
/** Art's call this morning: everything in it still waits on Art. */
export const WaitingOnYou = page('/calls/n1', 'busy');
/** Someone else's call Art was invited to: From Maya’s call, on the line under the title. */
export const Invited = page('/calls/n3', 'busy');
/** Ines's board prep, shared with Art after the call: it says who shared it, and nothing was shared or made in it. */
export const SharedWithYou = page('/calls/n8', 'busy');
/** A recording made in the room: a microphone's arch on the stage, and nobody's name on the lines. */
export const RoomRecording = page('/calls/n6', 'busy');
export const RoomRecordingPhone = phone(RoomRecording);
/** The pricing follow-up just ended: its notes are written while you watch. */
export const BeingWritten = page('/calls/n0', 'writing');
/** A walkthrough is recording in the room on another device: the line ends where it has got to, in the recording's colour. */
export const StillRecording = page('/calls/r0', 'writing');
/** Priya's launch check-in is still going: its notes are written once it ends, and they can't be removed until then. */
export const CallStillGoing = page(`/calls/${STATES.going}`, 'busy', everyState);
/** Lena corrected a line after the notes were written: Art, who organized the call, can have them written again. */
export const LineCorrected = page(`/calls/${STATES.corrected}`, 'busy', everyState);
/** Being written again from the transcript as it is now: everyone still reads them as they were. */
export const WrittenAgain = page(`/calls/${STATES.again}`, 'busy', everyState);
/** The summary couldn't be written: the transcript and the audio are kept, and the organizer can try again. */
export const Unwritten = page(`/calls/${STATES.unwritten}`, 'busy', everyState);
/** Nothing was said while notes were on. */
export const NothingSaid = page(`/calls/${STATES.quiet}`, 'busy', everyState);
/**
 * The call was set to keep neither its transcript nor its recording, so there's nothing to play back: no stage or line,
 * and Nothing to play back says why in their place. What was decided and handed out stands on its own.
 */
export const NoTranscriptOrRecording = page(`/calls/${STATES.unkept}`, 'busy', everyState);
export const NoTranscriptOrRecordingNight = page(`/calls/${STATES.unkept}`, 'busy', { ...everyState, globals: night });
/** In one column: Nothing to play back over the tabs, with what was shared and made in its own tab. */
export const NoTranscriptOrRecordingPhone = phone(NoTranscriptOrRecording);
/** Breakout rooms: How it went has each room under its chapter, and the Transcript says which room you were in. */
export const Rooms = page(`/calls/${STATES.rooms}`, 'busy', everyState);
export const RoomsTranscript = page(`/calls/${STATES.rooms}?tab=transcript`, 'busy', everyState);
/** Opened at a moment in the pricing room, from a link: its section opens there. */
export const ARoomOpen = page(`/calls/${STATES.rooms}?room=room-pricing&at=1050`, 'busy', everyState);
/** Priya confirmed the launch date and Kofi says it wasn't decided: Art, who organized the call, keeps it or crosses it out. */
export const Disputed = page(`/calls/${STATES.disputed}`, 'busy', everyState);
/** After the launch retro: the board open in the call, drawn as it is, among what was shared and made, with the rooms' boards. */
export const WithABoard = page(`/calls/${RETRO_NOTE}`, 'busy', { beforeEach: changing(afterTheRetro) });
export const WithABoardNight = page(`/calls/${RETRO_NOTE}`, 'busy', { beforeEach: changing(afterTheRetro), globals: night });
export const WithABoardPhone = phone(page(`/calls/${RETRO_NOTE}?tab=shared`, 'busy', { beforeEach: changing(afterTheRetro) }));
/** The example a first day opens: its notes to read and tick, its transcript, and nothing to play, share or delete. */
export const Example = page('/calls/example', 'first-day');
/** Notes that came by a link: From Priya’s link, beside the title. */
export const FromALink = page('/calls/n9', 'busy', { beforeEach: changing(fromALink) });
/** An open question Art added afterwards, through his agent: Still open says You asked, with nothing said behind it. */
export const AQuestionAdded = page('/calls/n2', 'busy', { beforeEach: changing(aQuestionAdded) });

/** The shared notes, in Notes, for everyone with them: what Priya added, and their own box, which says who reads it. */
export const SharedNotesBox = page('/calls/n2', 'busy', {
  play: async ({ userEvent, step }) => {
    await step('Write in the shared notes', async () => {
      const box = await screen.findByRole('textbox', { name: 'Write in the shared notes' }, { timeout: 30000 });
      box.scrollIntoView({ block: 'center' });
      await userEvent.type(box, 'Support needs the article by Monday.');
    });
  }
});
/** Share: to people by email, or to one of Art's groups, offered first. */
export const Sharing = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Share', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Share' }, { timeout: 30000 }));
    });
  }
});
/** Share, then Make a link: the link to copy, shown once, and the links that still work. */
export const SharingByLink = page('/calls/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Share, then Make a link', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Share' }, { timeout: 30000 }));
      await userEvent.click(await screen.findByRole('button', { name: 'Make a link' }, { timeout: 8000 }));
      await screen.findByRole('group', { name: 'The link to these notes' }, { timeout: 8000 });
    });
  }
});

/** Opens More, then presses what's named. */
const inMore = (item: RegExp, then?: string): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step('Open More', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: 'More' }, { timeout: 30000 }));
  });
  await step(`Press ${item.source}`, async () => {
    await userEvent.click(await screen.findByRole('button', { name: item }, { timeout: 8000 }));
  });
  if (then) await step(then, async () => { await userEvent.click(await screen.findByRole('button', { name: then }, { timeout: 8000 })); });
};
/** More, then Delete notes: it asks in the same popover, and says exactly what goes, for everyone. */
export const DeleteAsks = page('/calls/n1', 'busy', { play: inMore(/Delete notes/) });
/** Deleted: what went, for everyone who had them, and the way back to Calls. */
export const Deleted = page('/calls/n1', 'busy', { play: inMore(/Delete notes/, 'Delete') });
/** Maya's notes, taken out of Art's: she and everyone else keep them. */
export const Removed = page('/calls/n3', 'busy', { play: inMore(/Remove from your notes/, 'Remove') });
/** Eight notes are pinned already, the most there can be: pinning another says to unpin one first. */
export const PinsFull = page('/calls/lot-20', 'lots', { play: inMore(/Pin to the side panel/) });
/** A call that isn't there any more. */
export const Gone = page('/calls/n-gone', 'busy');
/** Alcove couldn't answer: the page says so. */
export const CouldntOpen = page('/calls/n3', 'busy', { beforeEach: changing(troubled({ 'notes.get': (id) => (id === 'n3' ? 'failed' : null) })) });
/** Opened without a connection: a call's page needs one, and Record still works. */
export const Offline = page('/calls/n2', 'offline');

/** What the notes suggest stays apart from the follow-ups until someone adds it. */
export const FollowUpProposals = page(`/calls/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals) });
export const FollowUpProposalsPhone = phone(FollowUpProposals);
export const ReviewingFollowUpProposals = page(`/calls/${FOLLOW_UP_NOTE}`, 'busy', {
  beforeEach: changing(withFollowUpProposals),
  play: async ({ userEvent, step }) => {
    await step('Open the suggestions under the follow-ups', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }, { timeout: 30000 }));
    });
  }
});

/** More, then Google Drive: the call's own exports, in a window over the page. */
export const GoogleDrive = page('/calls/n2', 'drive-connected', { play: inMore(/Google Drive/) });
export const GoogleDriveNight = page('/calls/n2', 'drive-connected', { play: inMore(/Google Drive/), globals: night });
export const GoogleDrivePhone = phone(GoogleDrive);
/** The call's own folder and formats, set apart from the account's. */
export const GoogleDriveCustom = page('/calls/n2', 'busy', {
  beforeEach: changing((w) => {
    withDriveExports(w);
    const destination = w.drive.folders[1];
    if (destination) w.drive.overrides['n2'] = { enabled: true, destination, formats: ['notes-markdown'] };
  }),
  play: inMore(/Google Drive/)
});
/** Launch planning ended before automatic exports went on: it isn't exported, with Export to Google Drive. */
export const GoogleDriveNotCovered = page('/calls/n7', 'drive-connected', { play: inMore(/Google Drive/) });
/** Its files went to Drive while exports covered it; they don't now. */
export const GoogleDriveNoLongerCovered = page('/calls/n7', 'drive-connected', {
  beforeEach: changing((w) => {
    w.drive.jobs.push(
      { id: 'drive-launch-notes', noteId: 'n7', format: 'notes-markdown', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/preview_launch_notes/view', updatedAt: iso(-8, 16, 40), nextAt: null },
      { id: 'drive-launch-transcript', noteId: 'n7', format: 'transcript-text', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/preview_launch_transcript/view', updatedAt: iso(-8, 16, 40), nextAt: null }
    );
  }),
  play: inMore(/Google Drive/)
});
/** Someone it was shared with chooses their own exports; the original audio stays the organizer's. */
export const GoogleDriveSharedReader = page('/calls/n3', 'busy', { beforeEach: changing(withSharedCallExports), play: inMore(/Google Drive/) });

/* ---------- a call ahead ---------- */

/**
 * Art's hiring sync, tomorrow: Ines has accepted and Aiko hasn't answered (dimmed), Join shows five minutes before, the
 * link to copy, and nothing for the call yet, with Add an agenda, New board and Upload; the notes are on.
 */
export const BeforeACall = page(`/calls/upcoming/${HIRING_SYNC.id}`, 'busy', { beforeEach: changing(withHiringSync) });
export const BeforeACallNight = page(`/calls/upcoming/${HIRING_SYNC.id}`, 'busy', { beforeEach: changing(withHiringSync), globals: night });
export const BeforeACallLaptop = page(`/calls/upcoming/${HIRING_SYNC.id}`, 'busy', { beforeEach: changing(withHiringSync), globals: laptop });
export const BeforeACallPhone = phone(BeforeACall);
/** An agenda added: its first lines on its card, opening it in the call's workspace, and more to add under it. */
export const BeforeACallWithAnAgenda = page(`/calls/upcoming/${HIRING_SYNC.id}`, 'busy', { beforeEach: changing(withAnAgenda) });
/** Kofi's design crit, which Art is invited to: Are you coming?, his own answer on his arch, and More to propose another time. */
export const BeforeACallInvited = page(`/calls/upcoming/${DESIGN_CRIT.id}`, 'busy', { beforeEach: changing(withDesignCrit) });
export const BeforeACallInvitedPhone = phone(BeforeACallInvited);
/** Four minutes before the design review: Join is on the stage. */
export const TimeToJoin = page('/calls/upcoming/m-review', 'call-soon');
export const TimeToJoinNight = page('/calls/upcoming/m-review', 'call-soon', { globals: night });
/** A call offering times to Jonas: waiting for him to pick, with the link to copy for him. */
export const TimesOffered = page(`/calls/upcoming/${FOR_JONAS.id}`, 'busy', { beforeEach: changing(invited) });
/** A series' next call: how it repeats, beside who's invited. */
export const BeforeACallInASeries = page('/calls/upcoming/m-standup', 'busy');
/** The notes, changed here before the call: on or off, and what they keep. */
export const ChangingTheNotes = page(`/calls/upcoming/${HIRING_SYNC.id}`, 'busy', {
  beforeEach: changing(withHiringSync),
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Change under Notes', async () => {
      const notes = await canvas.findByRole('region', { name: 'Notes' }, { timeout: 30000 });
      await userEvent.click(within(notes).getByRole('button', { name: 'Change' }));
    });
  }
});
/** More on a call ahead: change its time, copy its link, cancel it. */
export const BeforeACallMore = page(`/calls/upcoming/${HIRING_SYNC.id}`, 'busy', {
  beforeEach: changing(withHiringSync),
  play: async ({ canvas, userEvent, step }) => {
    await step('Press More', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: `More for ${HIRING_SYNC.title}` }, { timeout: 30000 }));
    });
  }
});
/** A call ahead that isn't there: cancelled, or never one you were invited to. */
export const ACallAheadThatsGone = page('/calls/upcoming/m-gone', 'busy');
