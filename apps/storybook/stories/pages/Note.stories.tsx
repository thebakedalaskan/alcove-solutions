/* A note: the call as its horizon, then what it decided, what's still open, what's next, and what was said (user-flows 8). */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { RETRO_NOTE, afterTheRetro } from '../../src/api/scenarios';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { STATES, inEveryState } from '../../src/world/states';
import { longSuggestions, troubled, writtenUnencrypted } from './changes';

const meta = { title: 'Pages/A note', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The busy afternoon, with a note in every state a note can be in (src/world/states.ts). */
const everyState = { beforeEach: changing(inEveryState) };

/** The team standup, written out in full: decisions, a question, follow-ups, a shared screen (its replay above the player, and its frames beside the lines they belong to) and your own notes. */
export const Standup = page('/notes/n2', 'busy');
export const StandupPhone = phone(Standup);
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
/** Opened while Kofi's screen is up (9:20): the replay shows his share, and the lines said then carry their frames. */
export const WhileAScreenIsShared = page('/notes/n2?at=560', 'busy');
/** The standup was written by a model that isn't in a secure enclave: the note says so in caution, with Unencrypted, where it would say Written in confidential compute. */
export const WrittenUnencrypted = page('/notes/n2', 'busy', { beforeEach: changing(writtenUnencrypted) });
/** Art's call this morning: everything in it still waits on Art. */
export const WaitingOnYou = page('/notes/n1', 'busy');
/** Someone else's call you were invited to. */
export const Invited = page('/notes/n3', 'busy');
/** Ines's board prep, shared with Art after the call: it says who shared it. */
export const SharedWithYou = page('/notes/n8', 'busy');
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
/** The call was set to keep neither its transcript nor its recording: one line says so where each would have been. */
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
/** Something from Art's own notes, on its way to the shared notes: exactly what goes, the moment, and everyone who gets it. */
export const AddingToTheSharedNotes = page('/notes/n2', 'busy', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Add Art’s own note to the shared notes. It shows exactly what goes, and who gets it', async () => {
      const [first] = await canvas.findAllByRole('button', { name: 'Add to the shared notes' });
      if (first) await userEvent.click(first);
    });
  }
});
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
