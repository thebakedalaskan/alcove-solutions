/* A note: the call as its horizon, then what it decided, what's still open, what's next, and what was said (user-flows 8). */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { RETRO_NOTE, afterTheRetro } from '../../src/api/scenarios';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import type { World } from '../../src/world';
import { call } from '../../src/world/build';
import { iso } from '../../src/world/clock';
import { INES } from '../../src/world/people';
import { withDriveExports, withSharedCallExports } from '../../src/world/drive-exports';
import { FOLLOW_UP_NOTE, withFollowUpProposals } from '../../src/world/follow-ups';
import { STATES, inEveryState } from '../../src/world/states';
import { fromALink, longSide, longSuggestions, troubled, writtenUnencrypted } from './changes';

const meta = { title: 'Pages/A note', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The busy afternoon, with a note in every state a note can be in (src/world/states.ts). */
const everyState = { beforeEach: changing(inEveryState) };

/** The team standup, written out in full: decisions, a question, follow-ups, a shared screen (its replay above the player, and its frames beside the lines they belong to) and your own notes. */
export const Standup = page('/notes/n2', 'busy');
export const StandupPhone = phone(Standup);
/**
 * On a phone, where one line at a time shows its tools: Priya's line, pressed, plays from there with its tools. The sun
 * then moves on to the next line, as playing on does (here, ten seconds at a time from the keyboard), and the tools stay
 * on her line, beside the line now being said. (A touch screen always shows them; here the keyboard goes to them.)
 */
export const PressALineOnAPhone = phone(page('/notes/n2', 'busy', {
  play: async ({ userEvent, step }) => {
    const horizon = async () => within(await screen.findByRole('region', { name: 'The call' }, { timeout: 30000 }));
    const priya = async () => screen.findByText(/^The new onboarding is done\./, {}, { timeout: 30000 });
    await step('Press what Priya said. It plays from there', async () => {
      await userEvent.click(await priya());
      await (await horizon()).findByRole('button', { name: 'Pause' }, { timeout: 8000 });
    });
    await step('The sun moves on past her line, to the next one', async () => {
      (await horizon()).getByRole('slider', { name: 'Position in the recording' }).focus({ preventScroll: true });
      await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    });
    await step('Her line keeps its tools: Bookmark this line is still there to press', async () => {
      const line = (await priya()).closest('.nd-l');
      if (line instanceof HTMLElement) within(line).getByRole('button', { name: /^Bookmark this line/ }).focus({ preventScroll: true });
    });
  }
}));
/** The standup's full summary sits under the short one behind a Full summary button, closed until it's pressed. */
export const FullSummary = page('/notes/n2', 'busy');
/** Full summary pressed: several paragraphs open under the short one, in the same type. */
export const FullSummaryOpen = page('/notes/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Full summary', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Full summary' }));
    });
  }
});
/** The full summary opened on a phone. */
export const FullSummaryOpenPhone = phone(FullSummaryOpen);
/** One of the older notes has no full summary: the short one stands alone, with no button under it. */
export const NoFullSummary = page('/notes/n8', 'busy');
/** Long suggested questions on a phone wrap to three rows above the ask bar; the end of the transcript scrolls clear of all of them. */
export const LongSuggestions = phone(page('/notes/n2', 'busy', {
  beforeEach: changing(longSuggestions),
  play: async ({ canvas, userEvent, step }) => {
    await step('Press in the ask bar. The suggested questions show above it', async () => {
      await userEvent.click(await canvas.findByRole('textbox', { name: /Ask about this call/ }));
    });
  }
}));
/** Points at the ask bar. */
const pointAtAsk: PageStory['play'] = async ({ canvas, userEvent, step }) => {
  await step('Point at the ask bar. The suggested questions show above it', async () => {
    await userEvent.hover(await canvas.findByRole('textbox', { name: /Ask about this call/ }));
  });
};
/** Pointing at the ask bar while the note is read: its suggested questions show above it, and go again once the pointer leaves. */
export const PointingAtAsk = page('/notes/n2', 'busy', { play: pointAtAsk });
export const PointingAtAskNight = page('/notes/n2', 'busy', { play: pointAtAsk, globals: { theme: 'dark' } });
/**
 * Opened while Kofi's screen is up (9:20): his share plays on the sky over the line, which runs along its foot as its seek
 * bar, and the lines said then carry their frames.
 */
export const WhileAScreenIsShared = page('/notes/n2?at=560', 'busy');
export const WhileAScreenIsSharedPhone = phone(WhileAScreenIsShared);
export const WhileAScreenIsSharedWide = page('/notes/n2?at=560', 'busy', { globals: { viewport: { value: 'wide', isRotated: false } } });
export const WhileAScreenIsSharedNight = page('/notes/n2?at=560', 'busy', { globals: { theme: 'dark' } });
/** Reading on: the shared screen scrolls away above the line, which sticks to the top, clear of the picture. */
export const ReadingOnPastTheScreen = page('/notes/n2?at=560', 'busy', {
  play: async ({ canvas, step }) => {
    await step('Read on to what was decided. The line sticks to the top, and the shared screen has gone above it', async () => {
      (await canvas.findByRole('heading', { name: /^Decided/ })).scrollIntoView({ block: 'start' });
    });
  }
});
/** Opened at 12:00, after Kofi's share: no shared screen in the notes covers it, and the stage offers his, 8:52–10:40, in one press. */
export const NoSharedScreenHere = page('/notes/n2?at=720', 'busy');
/** Kofi's screen couldn't be played (its video won't load here): the stage says so, with Try again. */
export const AScreenThatWontPlay = page('/notes/n2?at=560', 'busy', { beforeEach: changing(troubled({ 'notes.screenVideoUrl': 'failed' })) });
/** The standup was written by a model that isn't in a secure enclave: the note says so in caution, with Unencrypted, where it would say Written in confidential compute. */
export const WrittenUnencrypted = page('/notes/n2', 'busy', { beforeEach: changing(writtenUnencrypted) });
/** Art's call this morning: everything in it still waits on Art. */
export const WaitingOnYou = page('/notes/n1', 'busy');
/** Someone else's call you were invited to. */
export const Invited = page('/notes/n3', 'busy');
/** Ines's board prep, shared with Art after the call: it says who shared it. */
export const SharedWithYou = page('/notes/n8', 'busy');
/* On a team (user-flows 8.51) */
/** Opens Share, where Visible to team sits for a note you organized while you're licensed on a team. */
const openShare: NonNullable<PageStory['play']> = async ({ canvas, userEvent, step }) => {
  await step('Press Share. Visible to team is under the people to share with', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Share' }, { timeout: 30000 }));
    await screen.findByRole('switch', { name: 'Visible to team' }, { timeout: 8000 });
  });
};
/** The standup, which Art made visible to Priya's team: the head says so, and Share has the switch on. */
export const VisibleToTeam = page('/notes/n2', 'team-member', { play: openShare });
export const VisibleToTeamNight = page('/notes/n2', 'team-member', { play: openShare, globals: { theme: 'dark' } });
export const VisibleToTeamPhone = phone(VisibleToTeam);
/** Art's design review isn't visible to his team yet: the switch is off. */
export const VisibleToTeamOff = page('/notes/n4', 'team-admin', { play: openShare });
/** Turning it on: everyone licensed on the team can read the notes and ask about them. */
export const MakeVisibleToTeam = page('/notes/n4', 'team-admin', {
  play: async (ctx) => {
    await openShare(ctx);
    await ctx.step('Turn on Visible to team', async () => {
      await ctx.userEvent.click(await screen.findByRole('switch', { name: 'Visible to team' }));
    });
  }
});
/**
 * Priya's roadmap review, visible to her team, as Art reads it on his license: from Priya, visible to Vandelay Industries,
 * with nothing to change, share, add or follow up, and Ask about this call.
 */
export const ATeamNote = page('/notes/tn-roadmap', 'team-member');
export const ATeamNoteNight = page('/notes/tn-roadmap', 'team-member', { globals: { theme: 'dark' } });
export const ATeamNotePhone = phone(ATeamNote);
/** A recording made in the room: nobody's name on the lines. */
export const RoomRecording = page('/notes/n6', 'busy');
/** Opened at a moment, from an answer or a search: the sun stands there, not playing, and the line said then is marked. */
export const AtAMoment = page('/notes/n2?at=372', 'busy');
/** The pricing follow-up just ended: its notes are written while you watch. */
export const BeingWritten = page('/notes/n0', 'writing');
/** A walkthrough is recording in the room on another device: the line ends where it has got to, in the recording's colour. */
export const StillRecording = page('/notes/r0', 'writing');
/** Priya's launch check-in is still going: its notes are written once it ends, and they can't be removed until then. */
export const CallStillGoing = page(`/notes/${STATES.going}`, 'busy', everyState);
/** Lena corrected a line after the notes were written: Art, who organized the call, can have them written again. */
export const LineCorrected = page(`/notes/${STATES.corrected}`, 'busy', everyState);
/** Being written again from the transcript as it is now: everyone still reads them as they were, and what people settled stays. */
export const WrittenAgain = page(`/notes/${STATES.again}`, 'busy', everyState);
/** The summary couldn't be written: the transcript and the audio are kept, and the organizer can try again. */
export const Unwritten = page(`/notes/${STATES.unwritten}`, 'busy', everyState);
/** Nothing was said while notes were on: the water is still, and Play stays on the line for the audio. */
export const NothingSaid = page(`/notes/${STATES.quiet}`, 'busy', everyState);
/** The call was set to keep neither its transcript nor its recording: one line says so where each would have been, and its menu offers no rewrite without a transcript. */
export const NoTranscriptOrRecording = page(`/notes/${STATES.unkept}`, 'busy', everyState);
/** Breakout rooms: each room's own section under the call's notes, closed until it's opened. */
export const Rooms = page(`/notes/${STATES.rooms}`, 'busy', everyState);
/** Opened at a moment in the pricing room, from a link: its section opens there. */
export const ARoomOpen = page(`/notes/${STATES.rooms}?room=room-pricing&at=1050`, 'busy', everyState);
/** Priya confirmed the launch date and Kofi says it wasn't decided: Art, who organized the call, keeps it or crosses it out. */
export const Disputed = page(`/notes/${STATES.disputed}`, 'busy', everyState);
/**
 * After the launch retro: right under the summary, the board open in the call as a picture of all of it, then each breakout
 * room's board side by side (Support's isn't open to everyone invited, so the summary left it out, and its card says so), then
 * the follow-ups the notes took from the board's Actions frame, under their own heading.
 */
export const WithABoard = page(`/notes/${RETRO_NOTE}`, 'busy', { beforeEach: changing(afterTheRetro) });
export const WithABoardPhone = phone(WithABoard);
export const WithABoardNight = page(`/notes/${RETRO_NOTE}`, 'busy', { beforeEach: changing(afterTheRetro), globals: { theme: 'dark' } });
/** On a wide screen what was said moves beside what was decided, so the boards have half the note's column: the call's picture goes above its words, and the rooms' go two across. */
export const WithABoardWide = page(`/notes/${RETRO_NOTE}`, 'busy', { beforeEach: changing(afterTheRetro), globals: { viewport: { value: 'wide', isRotated: false } } });
/** Comms's section, open from a link: its notes, and the follow-ups the notes took from its board. Its board is with the call's, above. */
export const ARoomsBoard = page(`/notes/${RETRO_NOTE}?room=room-comms&at=800`, 'busy', { beforeEach: changing(afterTheRetro) });
/** A call in a series: beside the note, the series' other calls and what's still open across them, and the next call. */
export const InASeries = page('/notes/n2', 'busy', everyState);
/** The example note a first day opens. */
export const Example = page('/notes/example', 'first-day');

/** Asking about the call: a suggested question, answered with the moments it comes from, for Art alone. */
export const Asking = page('/notes/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Ask what was decided. The answer is read in confidential compute and cites the moments it comes from', async () => {
      await userEvent.type(await canvas.findByRole('textbox', { name: /Ask about this call/ }), 'What did we decide?{Enter}');
    });
  }
});

/** A decision's menu: who it's for, rewording, It wasn't decided, then What was said behind it and every change to it. */
export const ADecisionsMenu = page('/notes/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Open the menu of the first decision', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Change this' });
      if (first) await userEvent.click(first);
    });
  }
});
/** Your notes at rest: what Art wrote marked with lines of text, his bookmark with its mark, and no actions on any row. */
export const YourNotes = page('/notes/n2', 'busy');
export const YourNotesNight = page('/notes/n2', 'busy', { globals: { theme: 'dark' } });
/** Pointing at one of Art's own notes: Add to the shared notes, Edit and Delete show together, and nothing else does. */
export const YourNotesPointedAt = page('/notes/n2', 'busy', {
  play: async ({ userEvent, step }) => {
    await step('Point at the first thing Art wrote', async () => {
      const row = (await screen.findByText('Ask Priya whether the article covers the team plan.', {}, { timeout: 30000 })).closest('li');
      if (row) await userEvent.hover(row);
    });
  }
});
/** The shared notes beside Your notes: what Priya added, and their own box, which says who reads it before anything is typed. */
export const SharedNotesBox = page('/notes/n2', 'busy', {
  play: async ({ userEvent, step }) => {
    await step('Write in the shared notes', async () => {
      await userEvent.type(await screen.findByRole('textbox', { name: 'Write in the shared notes' }, { timeout: 30000 }), 'Support needs the article by Monday.');
    });
  }
});
export const SharedNotesBoxNight = page('/notes/n2', 'busy', { globals: { theme: 'dark' } });
export const SharedNotesBoxPhone = phone(page('/notes/n2', 'busy'));
/**
 * A long column beside the note (ten more of Art's notes, more in the shared notes, a dozen people and Google Drive),
 * with the whole transcript open and the page at its end: the column keeps its place under the line and scrolls by itself.
 */
const toTheEnd: PageStory['play'] = async ({ userEvent, step }) => {
  await step('Open the whole transcript and go to the end of the page', async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Show all \d+ minutes/ }, { timeout: 30000 }));
    window.scrollTo({ top: document.documentElement.scrollHeight });
  });
};
export const LongColumnLaptop = page('/notes/n2', 'busy', { beforeEach: changing(longSide), globals: { viewport: { value: 'laptop', isRotated: false } }, play: toTheEnd });
export const LongColumnLaptopNight = page('/notes/n2', 'busy', { beforeEach: changing(longSide), globals: { viewport: { value: 'laptop', isRotated: false }, theme: 'dark' }, play: toTheEnd });
export const LongColumnWide = page('/notes/n2', 'busy', { beforeEach: changing(longSide), globals: { viewport: { value: 'wide', isRotated: false } }, play: toTheEnd });
/** At 1180 px and narrower, one column: Your notes and the shared notes come before the transcript, two across, and the rest after it. */
export const LongColumnTablet = page('/notes/n2', 'busy', { beforeEach: changing(longSide), globals: { viewport: { value: 'tablet', isRotated: false } } });
export const LongColumnPhone = phone(page('/notes/n2', 'busy', { beforeEach: changing(longSide) }));
/** Something from Art's own notes, on its way to the shared notes: exactly what goes, the moment, and everyone who gets it. */
export const AddingToTheSharedNotes = page('/notes/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Add Art’s own note to the shared notes. It shows exactly what goes, and who gets it', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Add to the shared notes' });
      if (first) await userEvent.click(first);
    });
  }
});
/** Notes that came by a link: beside the title, From Priya’s link; in who has them, By your link for Theo, who opened Art’s. */
export const FromALink = page('/notes/n9', 'busy', { beforeEach: changing(fromALink) });
/** Share, then Make a link: the link to copy, shown once, and the links that still work, Art's to revoke. */
export const SharingByLink = page('/notes/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Share, then Make a link', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Share' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Make a link' }, { timeout: 8000 }));
      await screen.findByRole('group', { name: 'The link to these notes' }, { timeout: 8000 });
    });
  }
});
export const SharingByLinkNight = page('/notes/n2', 'busy', { ...SharingByLink, globals: { theme: 'dark' } });
/** Share: to people by email, or to one of Art's groups, offered first. */
export const Sharing = page('/notes/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Share', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Share' }));
    });
  }
});

/** More, then Delete notes: it asks in the same popover, and says exactly what goes, for everyone. */
export const DeleteAsks = page('/notes/n1', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Open More', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'More' }));
    });
    await step('Press Delete notes. It asks first, saying what goes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Delete notes/ }));
    });
  }
});
/** Deleted: what went, for everyone who had them, and the way back to Notes. */
export const Deleted = page('/notes/n1', 'busy', {
  play: async (ctx) => {
    await DeleteAsks.play?.(ctx);
    await ctx.step('Delete them', async () => {
      await ctx.userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    });
  }
});
/** Maya's notes, taken out of Art's: she and everyone else keep them. */
export const Removed = page('/notes/n3', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Open More', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'More' }));
    });
    await step('Press Remove from your notes. It asks first', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Remove from your notes/ }));
    });
    await step('Remove them', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    });
  }
});
/** Eight notes are pinned already, the most there can be: pinning another says to unpin one first. */
export const PinsFull = page('/notes/lot-20', 'lots', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Pin these notes. Eight are pinned already', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Pin these notes' }));
    });
  }
});

/** A note that isn't there any more. */
export const Gone = page('/notes/n-gone', 'busy');

/** Scrolls to what was worked on in the call. */
const toWorkedOn: PageStory['play'] = async ({ canvas }) => { (await canvas.findByText('Worked on in this call')).scrollIntoView({ block: 'center' }); };
/** The design review's note, at what was worked on in it: each document someone changed during the call, and who, opening in the Drive. */
export const WorkedOn = page('/notes/n4', 'busy', { play: toWorkedOn });
export const WorkedOnNight = page('/notes/n4', 'busy', { play: toWorkedOn, globals: { theme: 'dark' } });
/** Alcove couldn't answer: the page says so. */
export const CouldntOpen = page('/notes/n3', 'busy', { beforeEach: changing(troubled({ 'notes.get': (id) => (id === 'n3' ? 'failed' : null) })) });
/** Opened without a connection: a note needs one, and Record still works. */
export const Offline = page('/notes/n2', 'offline');

/** Actual tasks stay on the checklist. AI proposals wait behind a quiet count after the call too. */
export const FollowUpProposals = page(`/notes/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals) });
export const FollowUpProposalsPhone = phone(FollowUpProposals);
export const FollowUpProposalsNight = page(`/notes/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals), globals: { theme: 'dark' } });
export const ReviewingFollowUpProposals = page(`/notes/${FOLLOW_UP_NOTE}`, 'busy', {
  beforeEach: changing(withFollowUpProposals),
  play: async ({ userEvent, step }) => {
    await step('Open the optional fixed batch under the actual follow-ups', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }));
    });
  }
});

/** The call's own export destination and files, next to who has the source notes. */
export const GoogleDriveExports = page('/notes/n2', 'drive-connected');
export const GoogleDriveExportsPhone = phone(GoogleDriveExports);
export const GoogleDriveExportsNight = page('/notes/n2', 'drive-connected', { globals: { theme: 'dark' } });
export const GoogleDriveCustomSettings = page('/notes/n2', 'busy', { beforeEach: changing((w) => {
  withDriveExports(w);
  const destination = w.drive.folders[1];
  if (destination) w.drive.overrides['n2'] = { enabled: true, destination, formats: ['notes-markdown'] };
}) });

/** Launch planning ended the week before automatic exports went on: the panel says it isn't exported, with Export to Google Drive. */
export const GoogleDriveNotCovered = page('/notes/n7', 'drive-connected');
export const GoogleDriveNotCoveredNight = page('/notes/n7', 'drive-connected', { globals: { theme: 'dark' } });
export const GoogleDriveNotCoveredPhone = phone(GoogleDriveNotCovered);
/**
 * Launch planning went to Drive as it ended, while automatic exports covered it. They were turned off and on again on
 * Monday, which covers only calls that end after, so they don't cover it now: the panel says its files already in Drive
 * stay there and changes to the notes aren't sent, over the files that went, with Export to Google Drive.
 */
export const GoogleDriveNoLongerCovered = page('/notes/n7', 'drive-connected', { beforeEach: changing((w) => {
  w.drive.jobs.push(
    { id: 'drive-launch-notes', noteId: 'n7', format: 'notes-markdown', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/preview_launch_notes/view', updatedAt: iso(-8, 16, 40), nextAt: null },
    { id: 'drive-launch-transcript', noteId: 'n7', format: 'transcript-text', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/preview_launch_transcript/view', updatedAt: iso(-8, 16, 40), nextAt: null }
  );
}) });
export const GoogleDriveNoLongerCoveredPhone = phone(GoogleDriveNoLongerCovered);
/** Export to Google Drive pressed: the call has its own choice now, and its files go at once, Uploading, then each with its time. */
export const GoogleDriveExported = page('/notes/n7', 'drive-connected', {
  play: async ({ userEvent, step }) => {
    await step('Press Export to Google Drive. The files start uploading straight away', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Export to Google Drive' }, { timeout: 30000 }));
      await screen.findByText('Goes to this folder. The copies follow the notes when they change.', {}, { timeout: 8000 });
    });
  }
});
/** A shared reader can choose their own Drive exports, while original audio stays organizer-only. */
export const GoogleDriveSharedReader = page('/notes/n3', 'busy', { beforeEach: changing(withSharedCallExports) });
export const GoogleDriveSharedReaderNight = page('/notes/n3', 'busy', { beforeEach: changing(withSharedCallExports), globals: { theme: 'dark' } });
export const GoogleDriveSharedReaderPhone = phone(GoogleDriveSharedReader);
export const GoogleDriveSharedReaderChoices = page('/notes/n3', 'busy', { beforeEach: changing((w) => {
  withSharedCallExports(w);
  w.drive.overrides['n3'] = { enabled: true, destination: w.drive.settings.destination, formats: ['notes-markdown', 'transcript-text'] };
}) });
export const GoogleDriveAudioNotRetained = page(`/notes/${STATES.unkept}`, 'busy', { beforeEach: changing((w) => {
  inEveryState(w);
  withDriveExports(w);
  w.drive.overrides[STATES.unkept] = { enabled: true, destination: w.drive.settings.destination, formats: ['notes-markdown'] };
}) });

/* ---------- notes from a call with no workspace ---------- */

/** Art's call this morning, started there and then with no workspace: it's over, and its notes aren't filed anywhere yet. */
function unfiled(w: World): void {
  const meeting = { ...call({ id: 'm-arts-call', title: 'Art’s call', startsAt: iso(0, 11, 58), minutes: 14, code: 'art-call-mrn', guests: [INES], status: 'ended', noteId: 'n1' }), instant: true };
  w.meetings = [...w.meetings, meeting];
  w.notes = w.notes.map((n) => (n.id === 'n1' ? { ...n, meetingId: meeting.id } : n));
}
/** Down to where the note says its notes aren't in a workspace yet. */
const toTheNotice: PageStory['play'] = async ({ canvas, step }) => {
  await step('Scroll to where it says these notes aren’t in a workspace yet', async () => {
    (await canvas.findByText('These notes aren’t in a workspace yet.', {}, { timeout: 30000 })).scrollIntoView({ block: 'center' });
  });
};
/** Its organizer's note says so, near what was worked on: file them in one of your workspaces, or a new one, or leave them in Notes. */
export const Unfiled = page('/notes/n1', 'busy', { beforeEach: changing(unfiled), play: toTheNotice });
export const UnfiledNight = page('/notes/n1', 'busy', { beforeEach: changing(unfiled), play: toTheNotice, globals: { theme: 'dark' } });
export const UnfiledPhone = phone(Unfiled);
/** File them in Product: the call's folder goes there, and the note says where they went. */
export const UnfiledFiled = page('/notes/n1', 'busy', {
  beforeEach: changing(unfiled),
  play: async ({ canvas, userEvent, step }) => {
    await step('Choose Product in Where these notes go', async () => {
      const choice = await canvas.findByRole('button', { name: /Where these notes go/ }, { timeout: 30000 });
      choice.scrollIntoView({ block: 'center' });
      await userEvent.click(choice);
      await userEvent.click(await screen.findByRole('option', { name: /^Product/ }, { timeout: 8000 }));
    });
    await step('File them. It says where they went', async () => {
      await userEvent.click(canvas.getByRole('button', { name: 'File them' }));
      await canvas.findByText(/^Filed in/, {}, { timeout: 8000 });
    });
  }
});
