/*
 * Journeys in Notes (docs/product/user-flows.md › 8. Notes): the list, as the canvas's Notes board draws them
 * (docs/design/canvas/StepsNotes.dc.html), then a note, as its note board does (docs/design/canvas/data-note.js,
 * AH.JOURNEYS_NOTE). Where a journey needs a note the busy afternoon doesn't have (a decision someone disputes, a call
 * where nothing was said, breakout rooms, a series), it puts it in the world before the page opens.
 */
import { AlcoveApiError, type Note, type NoteRoom, type Person } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { standIn } from '../../src/api/standin';
import { call, changer, writeNote, type NoteSpec } from '../../src/world/build';
import { iso } from '../../src/world/clock';
import { ART, ELENA, INES, KOFI, MAYA, NADIA, OMAR, PRIYA, THEO } from '../../src/world/people';
import type { World } from '../../src/world';
import { FOLLOW_UP_NEW, FOLLOW_UP_NOTE, FOLLOW_UP_TASK, withFollowUpProposals } from '../../src/world/follow-ups';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { away, before, first, holding, LAPTOP, LATER, nth, outage, pause, pressable, reachable, SOON, swap, unreachable } from './play';

const meta = { title: 'Journeys/8 Notes', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/* ---------- what the journeys find ---------- */

const line = () => screen.findByRole('textbox', { name: 'Search everything said, or ask' }, SOON);
const preview = (title: string) => screen.findByRole('complementary', { name: title }, SOON);
const theNote = (title: string) => screen.findByRole('heading', { name: title, level: 1 }, LATER);
const yours = () => screen.findByRole('region', { name: 'Your notes' }, SOON);
const article = (text: string) => holding('article', text);

/* ---------- what the world needs for some of them ---------- */

const noteOf = (w: World, id: string): Note => {
  const n = w.notes.find((x) => x.id === id);
  if (!n) throw new Error(`The world has no note ${id}.`);
  return n;
};
/** People who had the notes shared with them afterwards, by `by`. */
function sharedWith(n: Note, people: readonly Person[], by: Person): void {
  const at = iso(0, 10, 30);
  n.people.push(...people);
  n.recipients.push(...people.map((person) => ({ person, role: 'shared' as const, by, at })));
}
/** Kofi says the design review's first decision, which Art confirmed, wasn't decided. */
const disputed = before((w) => {
  const d = noteOf(w, 'n4').decisions.find((x) => x.id === 'n4-d1');
  if (!d) return;
  const at = iso(-1, 13, 5);
  d.disputes.push({ by: changer(KOFI, 'invited'), at });
  d.changes.push({ by: changer(KOFI, 'invited'), at, what: 'disputed' });
});

/** Priya's research readout, given to Art afterwards, proposes a decision nobody has confirmed. */
const proposedInReadout = before((w) => {
  const n = noteOf(w, 'n9');
  const line = n.transcript?.[0];
  n.decisions.push({
    id: 'n9-d1', text: 'Pricing is per minute of notes, not per seat.', at: line?.at ?? 0, state: 'proposed', lines: line ? [line.id] : [], against: [], disputes: [], changes: [],
    evidence: { moments: [], flags: line ? [] : ['missing'] }
  });
});

/* ---------- the list ---------- */

export const FindWhatWasSaid: PageStory = {
  name: '8.1 Find what was said',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click the line, or press ⌘K', async () => {
      await userEvent.click(await line());
    });
    await step('Type. The list narrows, and each row shows the words, who said them and when', async () => {
      await userEvent.type(await line(), 'flag');
      await within(await screen.findByRole('group', { name: 'Notes' })).findAllByRole('link', { name: /^Open Team standup at / }, SOON);
    });
    await step('The picked note lists every moment. Click one', async () => {
      const said = within(await preview('Team standup')).getByRole('region', { name: 'What was said' });
      await userEvent.click(within(said).getByRole('link', { name: 'Open Team standup at 3:15' }));
    });
    await step('The note opens at that moment, not playing', async () => {
      await theNote('Team standup');
    });
  }
};

export const NothingMatches: PageStory = {
  name: '8.2 Nothing matches',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Search for something nobody said. It says what it looked through', async () => {
      await userEvent.type(await line(), 'submarine');
      await screen.findByRole('button', { name: 'Clear search' }, SOON);
    });
    await step('Click Clear search. Every note is back', async () => {
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Clear search' }, SOON)));
      await within(await screen.findByRole('group', { name: 'Notes' }, SOON)).findByRole('link', { name: 'All hands' }, SOON);
    });
  }
};

const searchDown = outage(() => {
  const was = standIn.notes.list;
  return swap(standIn.notes, 'list', (query) => (query?.text ? Promise.reject(unreachable()) : was(query)));
});
export const WhenTheSearchCantAnswer: PageStory = {
  name: '8.3 When the search can’t answer',
  ...page('/notes', 'busy'),
  beforeEach: searchDown.begin,
  play: async ({ userEvent, step }) => {
    await step('Search while Alcove isn’t answering. It says what went wrong', async () => {
      await userEvent.type(await line(), 'warehouse');
      await screen.findByRole('button', { name: 'Try again' }, LATER);
    });
    await step('Try again searches once more', async () => {
      searchDown.end();
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await within(await screen.findByRole('group', { name: 'Notes' }, SOON)).findByRole('link', { name: 'Art’s call' }, SOON);
    });
  }
};

export const NarrowToSomeone: PageStory = {
  name: '8.4 Narrow to someone',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click someone', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Notes with Priya Raman' }, SOON));
    });
    await step('Only the notes you both have, under their chip', async () => {
      await screen.findByRole('group', { name: 'Notes with Priya Raman' }, SOON);
    });
    await step('Click the × on the chip. Everyone’s notes are back', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Show notes with anyone' }));
      await screen.findByRole('group', { name: 'Notes' }, SOON);
    });
  }
};

export const NarrowToAnyoneElse: PageStory = {
  name: '8.5 Narrow to anyone else',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click +', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Notes with someone else' }, SOON));
    });
    await step('A popover opens under it. Type a name, or pick one', async () => {
      const pick = await screen.findByRole('dialog', { name: 'Show notes with someone' }, SOON);
      await userEvent.type(within(pick).getByRole('textbox', { name: 'Find someone in your notes' }), 'Lena');
      await userEvent.click(await within(pick).findByRole('button', { name: /^Lena Fischer/ }, SOON));
    });
    await step('Their chip takes the row. + still changes who', async () => {
      await screen.findByRole('group', { name: 'Notes with Lena Fischer' }, SOON);
      await screen.findByRole('button', { name: 'Notes with someone else' });
    });
  }
};

export const SomeoneYouHaveNoNotesWith: PageStory = {
  name: '8.6 Someone you have no notes with',
  ...page('/notes#with=sam%40vandelay.industries', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('The Team page links here. It says why, and Show notes with anyone goes back', async () => {
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Show notes with anyone' }, SOON)));
    });
    await step('Every note is back', async () => {
      await within(await screen.findByRole('group', { name: 'Notes' }, SOON)).findByRole('link', { name: 'All hands' }, SOON);
    });
  }
};

export const CallsInTheRoomSharedWithYou: PageStory = {
  name: '8.7 Calls, in the room, shared with you',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click In the room', async () => {
      await userEvent.click(await screen.findByRole('tab', { name: 'In the room' }, SOON));
    });
    await step('Only what was recorded in the room', async () => {
      await within(await screen.findByRole('group', { name: 'Notes' })).findByRole('link', { name: 'Site visit, Harbourline' }, SOON);
    });
    await step('Click Shared with you', async () => {
      await userEvent.click(screen.getByRole('tab', { name: 'Shared with you' }));
    });
    await step('Each note says who shared it, and with which group', async () => {
      await screen.findByText(/Shared by Priya with Product/, {}, SOON);
    });
  }
};

export const NothingSharedYet: PageStory = {
  name: '8.8 Nothing shared yet',
  ...page('/notes', 'on-their-own'),
  play: async ({ userEvent, step }) => {
    await step('Click Shared with you', async () => {
      await userEvent.click(await screen.findByRole('tab', { name: 'Shared with you' }, SOON));
    });
    await step('It says so, and what will land here', async () => {
      await screen.findByText(/shared with you/i, { selector: 'h2, h3, p, b, strong' }, SOON);
    });
  }
};

export const PickANoteAndOpenIt: PageStory = {
  name: '8.9 Pick a note and open it',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click a note. ↑, ↓, Home and End move through the list too', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'Pricing sync' }));
    });
    await step('It shows beside the list', async () => {
      await preview('Pricing sync');
    });
    await step('Click Open notes, double-click the row, or press Enter', async () => {
      await userEvent.click(within(await preview('Pricing sync')).getByRole('link', { name: 'Open notes' }));
    });
    await step('The note opens on its own page', async () => {
      await theNote('Pricing sync');
    });
  }
};

export const SettleThingsInThePreview: PageStory = {
  name: '8.10 Settle things in the preview',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Confirm. No page to open', async () => {
      const decided = await within(await preview('Art’s call')).findByRole('region', { name: 'Decisions' }, SOON);
      await userEvent.click(within(decided).getByRole('button', { name: 'Confirm' }));
    });
    await step('It says who confirmed it, with Undo. The rose chip leaves the row', async () => {
      await within(await preview('Art’s call')).findByRole('button', { name: 'Undo' }, SOON);
    });
    await step('Tick a follow-up. It crosses out in place, and the row’s count drops', async () => {
      await userEvent.click(within(await preview('Art’s call')).getByRole('checkbox', { name: 'Mark done: Book the movers for the 14th' }));
      await within(await preview('Art’s call')).findByRole('checkbox', { name: /Book the movers for the 14th/, checked: true }, SOON);
    });
  }
};

export const SomeoneSaysItWasntDecided: PageStory = {
  name: '8.11 Someone says it wasn’t decided',
  ...page('/notes', 'busy'),
  beforeEach: [disputed, proposedInReadout],
  play: async ({ userEvent, step }) => {
    await step('Given the notes afterwards, you can only say so: in Priya’s research readout, It wasn’t decided flags it for her', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'Customer research readout' }));
      const decided = await within(await preview('Customer research readout')).findByRole('region', { name: 'Decisions' }, SOON);
      await userEvent.click(await within(decided).findByRole('button', { name: 'It wasn’t decided' }, SOON));
    });
    await step('Take that back unsays it', async () => {
      await userEvent.click(await within(await preview('Customer research readout')).findByRole('button', { name: 'Take that back' }, SOON));
    });
    await step('The organizer settles it: on your design review, Kofi says one wasn’t decided. Keep it confirmed', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' })).getByRole('link', { name: 'Design review' }));
      await userEvent.click(await within(await preview('Design review')).findByRole('button', { name: 'Keep it confirmed' }, SOON));
    });
  }
};

export const PinANote: PageStory = {
  name: '8.12 Pin a note',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click the pin', async () => {
      // The pin answers once your pins have loaded, as the side panel's Pinned shows.
      await within(await screen.findByRole('complementary', { name: 'Side panel' })).findByRole('link', { name: 'Design review' }, SOON);
      await userEvent.click(within(await preview('Art’s call')).getByRole('button', { name: 'Pin these notes' }));
    });
    await step('The pin shows on the row, and the note joins Pinned in the side panel', async () => {
      await within(await screen.findByRole('complementary', { name: 'Side panel' })).findByRole('link', { name: 'Art’s call' }, SOON);
    });
  }
};

export const ShareANote: PageStory = {
  name: '8.13 Share a note',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Share', async () => {
      await userEvent.click(await reachable(await pressable('button', 'Share', SOON, within(await preview('Art’s call')))));
    });
    await step('A popover opens under it, over the page. Your groups come first', async () => {
      await screen.findByRole('dialog', { name: 'Share these notes' }, SOON);
    });
    await step('Pick a group or people, or type an email. Then Share', async () => {
      const sheet = await screen.findByRole('dialog', { name: 'Share these notes' });
      await userEvent.click(await reachable(within(sheet).getByRole('option', { name: /^Leads/ })));
      await userEvent.click(await pressable('button', 'Share', SOON, within(sheet)));
    });
    await step('Done. Whoever already had them is skipped', async () => {
      await screen.findByText(/Shared with/, {}, SOON);
    });
  }
};

/** Everyone at the all-hands, and four more it was shared with: a list longer than eight. */
const manyPeople = before((w) => { sharedWith(noteOf(w, 'n11'), [THEO, NADIA, OMAR, ELENA], INES); });
export const WhoHasTheseNotes: PageStory = {
  name: '8.14 Who has these notes',
  ...page('/notes', 'busy'),
  beforeEach: manyPeople,
  play: async ({ userEvent, step }) => {
    await step('Pick the all-hands, and click the faces', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'All hands' }));
      const pv = await preview('All hands');
      await userEvent.click(await reachable(await within(pv).findByRole('button', { name: /You, Ines, Priya and \d+ more/ }, SOON)));
    });
    await step('Each person, and how they got the notes. A long list stops at eight', async () => {
      await screen.findByRole('dialog', { name: 'Who has these notes' }, SOON);
    });
    await step('Show all opens the rest', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Who has these notes' })).getByRole('button', { name: /^Show all/ }));
      await within(screen.getByRole('dialog', { name: 'Who has these notes' })).findByText(/Elena Petrova/, {}, SOON);
    });
  }
};

export const DeleteOrRemoveNotes: PageStory = {
  name: '8.15 Delete notes, or remove them',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click More. Your own notes can be deleted for everyone', async () => {
      await userEvent.click(within(await preview('Art’s call')).getByRole('button', { name: 'More' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'More' }, SOON)).getByRole('button', { name: /^Delete notes/ }));
    });
    await step('It asks once, in place, and says what goes', async () => {
      await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Delete these notes' }, SOON)).getByRole('button', { name: 'Delete' }));
    });
    await step('The row leaves the list', async () => {
      await preview('Team standup');
    });
    await step('Someone else’s notes can only leave yours', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' })).getByRole('link', { name: 'Pricing sync' }));
      await userEvent.click(within(await preview('Pricing sync')).getByRole('button', { name: 'More' }));
      await within(await screen.findByRole('dialog', { name: 'More' }, SOON)).findByRole('button', { name: /^Remove from your notes/ }, SOON);
    });
  }
};

export const AskAcrossYourNotes: PageStory = {
  name: '8.16 Ask across your notes',
  ...page('/notes', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Type a question and press Enter, or click Ask', async () => {
      await userEvent.type(await line(), 'What did we decide about pricing?{Enter}');
    });
    await step('It reads your notes in confidential compute. The horizon pulses while it does', async () => {
      await screen.findByRole('region', { name: 'Answer from your notes' }, SOON);
    });
    await step('The answer lands on the water. The list and the preview follow what it cites', async () => {
      await within(await screen.findByRole('region', { name: 'Answer from your notes' })).findByRole('link', { name: 'Open Pricing sync at 24:30' }, LATER);
    });
    await step('Every note and moment it used is a chip. Click a moment', async () => {
      await userEvent.click(within(screen.getByRole('region', { name: 'Answer from your notes' })).getByRole('link', { name: 'Open Pricing sync at 24:30' }));
    });
    await step('The note opens at that moment, not playing', async () => {
      await theNote('Pricing sync');
    });
  }
};

const noteWent = outage(() => swap(standIn.notes, 'askAll', () => (async function* () {
  await pause(400);
  yield* [];
  throw new AlcoveApiError('conflict', 'A note this read was deleted while it was written.');
})()));
export const WhenTheresNoAnswer: PageStory = {
  name: '8.17 When there’s no answer',
  ...page('/notes', 'busy'),
  beforeEach: noteWent.begin,
  play: async ({ userEvent, step }) => {
    await step('A note it read went while it wrote. The answer isn’t shown', async () => {
      await userEvent.type(await line(), 'Who books the movers?{Enter}');
      await screen.findByText('A note this read was deleted while it was written.', {}, LATER);
    });
    await step('Ask again', async () => {
      noteWent.end();
      await userEvent.click(screen.getByRole('button', { name: 'Ask again' }));
      await within(await screen.findByRole('region', { name: 'Answer from your notes' })).findByRole('link', { name: /^Open Art’s call at / }, LATER);
    });
    await step('Nothing in your notes says: it tells you, and doesn’t guess', async () => {
      await userEvent.clear(await line());
      await userEvent.type(await line(), 'Who restocks the vending machines?{Enter}');
      await screen.findByText('None of your notes say anything about that.', {}, LATER);
    });
  }
};

/** The standup, being written again after a correction. */
const writingAgain = before((w) => { noteOf(w, 'n2').writingAgain = true; });
export const NotesOnTheirWay: PageStory = {
  name: '8.18 Notes on their way',
  ...page('/notes', 'writing'),
  beforeEach: writingAgain,
  play: async ({ userEvent, step }) => {
    await step('After a call: the row and the preview say the notes are being written', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'Pricing follow-up' }));
      await within(await preview('Pricing follow-up')).findAllByText(/being written/i, {}, SOON);
    });
    await step('In the room: still recording, and Share waits until it stops', async () => {
      await userEvent.click(within(screen.getByRole('group', { name: 'Notes' })).getByRole('link', { name: 'Harbourline walkthrough' }));
      await within(await preview('Harbourline walkthrough')).findAllByText(/recording/i, {}, SOON);
    });
    await step('Written again after corrections: the notes stay readable meanwhile', async () => {
      await userEvent.click(within(screen.getByRole('group', { name: 'Notes' })).getByRole('link', { name: 'Team standup' }));
      await within(await preview('Team standup')).findAllByText(/written again/i, {}, SOON);
    });
  }
};

const QUIET: NoteSpec = { id: 'n-quiet', title: 'Quick check-in', startedAt: iso(0, 14, 30), minutes: 3, organizer: ART, invited: [MAYA], excerpt: '', said: [] };
const quietCall = before((w) => { w.notes.splice(1, 0, writeNote(QUIET)); });
export const WhenTheresNoSummary: PageStory = {
  name: '8.19 When there’s no summary',
  ...page('/notes', 'busy'),
  beforeEach: quietCall,
  play: async ({ userEvent, step }) => {
    await step('Nothing was said, so there’s nothing to write', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'Quick check-in' }));
      await within(await preview('Quick check-in')).findByText(/Nothing was said/i, {}, SOON);
    });
    await step('Ines deletes her board prep meanwhile. Picked, it says so, and its row leaves the list', async () => {
      await screen.findByRole('link', { name: 'Board prep' });
      await standIn.notes.delete('n8');
      await userEvent.click(within(screen.getByRole('group', { name: 'Notes' })).getByRole('link', { name: 'Board prep' }));
      await away('link', 'Board prep', LATER);
    });
  }
};

export const YourFirstDay: PageStory = {
  name: '8.20 Your first day',
  ...page('/notes', 'first-day'),
  play: async ({ userEvent, step }) => {
    await step('Before any notes, the job is to get some. The example shows what you’ll get', async () => {
      await within(await screen.findByRole('main')).findByRole('button', { name: 'Start a call' }, SOON);
    });
    await step('Click Start a call', async () => {
      await userEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Start a call' }));
    });
    await step('The same flow as everywhere', async () => {
      await screen.findByRole('dialog', { name: 'Start a call' }, SOON);
    });
  }
};

export const ReadTheExample: PageStory = {
  name: '8.21 Read the example',
  ...page('/notes', 'first-day'),
  play: async ({ userEvent, step }) => {
    await step('Click Open the example', async () => {
      await userEvent.click(await first(screen.findAllByRole('link', { name: /Open the example/ }, SOON)));
    });
    await step('It opens like any note, with nothing to share or delete', async () => {
      await screen.findByRole('heading', { level: 1 }, LATER);
      await screen.findByRole('region', { name: 'The call' }, SOON);
    });
  }
};

/* ---------- a note ---------- */

export const JumpToAMoment: PageStory = {
  name: '8.22 Jump to a moment from the horizon',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    const horizon = async () => within(await screen.findByRole('region', { name: 'The call' }, LATER));
    await step('Point at a mark. It says what happened there', async () => {
      await userEvent.hover((await horizon()).getByRole('button', { name: /^Decision at 3:15/ }));
    });
    await step('Click it. The sun moves there and the transcript goes to that line', async () => {
      await userEvent.click((await horizon()).getByRole('button', { name: /^Decision at 3:15/ }));
      await screen.findByText('Then let’s say it. The new onboarding ships behind a flag on 12 November.', {}, SOON);
    });
    await step('A moment chip does the same, from anywhere on the page', async () => {
      await userEvent.click(within(await article('Write the help article for support')).getByRole('button', { name: 'Go to the moment at 6:20' }));
    });
    await step('The horizon stays at the top, so the next jump is one click: a chapter', async () => {
      await userEvent.click((await horizon()).getByRole('button', { name: 'Chapter: Launch checklist, 8:40' }));
    });
    await step('Press play. The sun moves along the line, and the line being said is marked in the transcript', async () => {
      await userEvent.click((await horizon()).getByRole('button', { name: 'Play' }));
      await (await horizon()).findByRole('button', { name: 'Pause' }, LATER);
    });
  }
};

export const ConfirmRewordAndUndo: PageStory = {
  name: '8.23 Confirm, reword and undo a decision',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    const decision = () => article('The new onboarding ships behind a flag');
    await step('Click Confirm', async () => {
      await userEvent.click(within(await decision()).getByRole('button', { name: 'Confirm' }));
    });
    await step('It says who did, with Undo. Its mark on the horizon fills in', async () => {
      await within(await decision()).findByText('Confirmed by you', {}, SOON);
    });
    await step('The menu rewords it, or says it no longer holds', async () => {
      await userEvent.click(within(await decision()).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'Reword' }));
    });
    await step('It rewords in place', async () => {
      const words = await screen.findByRole('textbox', { name: 'Reword this decision' }, SOON);
      await userEvent.clear(words);
      await userEvent.type(words, 'The new onboarding ships behind a flag on 12 November, for one per cent first.');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    await step('Reworded, it needs confirming again: proposed, with the new words, and the mark is hollow again', async () => {
      await within(await article('for one per cent first')).findByRole('button', { name: /Confirm|Undo/ }, SOON);
    });
  }
};

export const WhenItWasntDecided: PageStory = {
  name: '8.24 When it wasn’t decided, or stopped holding',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('The menu says it wasn’t decided', async () => {
      await userEvent.click(within(await article('The new onboarding ships behind a flag')).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'It wasn’t decided' }));
    });
    await step('It says who said so, with Reopen. Its mark leaves the horizon', async () => {
      await within(await article('The new onboarding ships behind a flag')).findByRole('button', { name: 'Reopen' }, SOON);
    });
    await step('A confirmed decision can stop holding when a later one replaces it', async () => {
      await userEvent.click(within(await article('Support gets the help article')).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'It no longer holds' }));
      await within(await article('Support gets the help article')).findByText(/no longer holds/i, {}, SOON);
    });
    await step('An open question works the same way: It was answered, then Reopen', async () => {
      await userEvent.click(within(await article('Who tells existing customers')).getByRole('button', { name: 'It was answered' }));
      await userEvent.click(await within(await article('Who tells existing customers')).findByRole('button', { name: 'Reopen' }, SOON));
      await within(await article('Who tells existing customers')).findByRole('button', { name: 'It was answered' }, SOON);
    });
  }
};

export const WhenSomeoneSaysItWasntDecided: PageStory = {
  name: '8.25 When someone says it wasn’t decided',
  ...page('/notes/n3', 'busy'),
  beforeEach: disputed,
  play: async ({ userEvent, step }) => {
    await step('Someone who can’t reject it says so, in their name, for the organizer to settle', async () => {
      await userEvent.click(within(await article('The team plan gets a monthly option')).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'It wasn’t decided' }));
      await within(await article('The team plan gets a monthly option')).findByText('You said this wasn’t decided', {}, SOON);
    });
    await step('On your own design review, Kofi has said so. The menu shows what was said behind it, and every change', async () => {
      await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Notes' }));
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'Design review' }));
      await userEvent.click(within(await preview('Design review')).getByRole('link', { name: 'Open notes' }));
      await theNote('Design review');
      await userEvent.click(within(await article('One filled button per view')).getByRole('button', { name: 'Change this' }));
      await within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).findAllByText(/Kofi/, {}, SOON);
    });
    await step('Keep it confirmed settles it', async () => {
      await userEvent.keyboard('{Escape}');
      await userEvent.click(within(await article('One filled button per view')).getByRole('button', { name: 'Keep it confirmed' }));
    });
  }
};

export const AddWhatTheNotesMissed: PageStory = {
  name: '8.26 Add what the notes missed',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Under each list: Propose a decision, or Add a follow-up', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Propose a decision' }, LATER));
    });
    await step('It opens in place, in your words. Everyone with the notes sees it', async () => {
      await userEvent.type(await screen.findByRole('textbox', { name: 'Propose a decision' }, SOON), 'Support answers onboarding questions in the help article’s comments.');
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    await step('It’s proposed by you, until someone else confirms it', async () => {
      await within(await article('in the help article’s comments')).findByText(/Proposed by you/, {}, SOON);
    });
    await step('The plus on a transcript line starts one from what was said there', async () => {
      await userEvent.click(await nth(screen.findAllByRole('button', { name: 'Add to the notes from this line' }, SOON), 2));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Add to the notes from this line' }, SOON)).getByRole('button', { name: 'Add a follow-up' }));
      await screen.findByRole('textbox', { name: 'What needs doing' }, SOON);
    });
  }
};

export const TakeOnAndReassign: PageStory = {
  name: '8.27 Take on and reassign a follow-up',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    const followUp = () => article('Review the launch checklist');
    await step('The notes suggest you, dashed. Click I’ll do it', async () => {
      await userEvent.click(within(await followUp()).getByRole('button', { name: 'I’ll do it' }));
    });
    await step('It’s yours, and solid on the horizon', async () => {
      await within(await followUp()).findByText('You', { exact: false }, SOON);
    });
    await step('Its menu gives it to anyone with the notes, dates it, rewords it and lists every change', async () => {
      await userEvent.click(within(await followUp()).getByRole('button', { name: 'Change this' }));
      await screen.findByRole('dialog', { name: 'Change this' }, SOON);
    });
    await step('Give it to Kofi. It stays dashed until Kofi takes it on', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' })).getByRole('button', { name: /^Kofi Asante/ }));
      await within(await followUp()).findAllByText(/Kofi/, {}, SOON);
    });
  }
};

export const CorrectALine: PageStory = {
  name: '8.28 Correct a transcript line',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Point at a line and click the pencil. Dots mark what it wasn’t sure of', async () => {
      await userEvent.click(await nth(screen.findAllByRole('button', { name: 'Correct this line' }, LATER), 1));
    });
    await step('The line becomes its own editor', async () => {
      await screen.findByRole('textbox', { name: 'What was said' }, SOON);
    });
    await step('Fix the words. The organizer can change who said it too', async () => {
      const words = screen.getByRole('textbox', { name: 'What was said' });
      await userEvent.clear(words);
      await userEvent.type(words, 'The new onboarding is done. Design signed off last night and the last copy changes went in first thing.');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    await step('It says Corrected, and the organizer can write the notes again', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Write the notes again/ }, SOON));
    });
    await step('Everyone keeps reading, and the seal says it’s being written again', async () => {
      await screen.findAllByText(/being written again/i, {}, SOON);
    });
    await step('Done, and what people settled stayed. Corrected says who, when and what was heard', async () => {
      await screen.findByRole('button', { name: /^Written in confidential compute/ }, LATER);
    });
    await step('More › Write the notes again asks in a small window, with the AI model to write them', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'More' }));
      await userEvent.click(await screen.findByRole('button', { name: /^Write the notes again/ }, SOON));
      await screen.findByRole('dialog', { name: 'Write the notes again' }, SOON);
    });
    await step('Cancel leaves the notes as they are', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Write the notes again' })).getByRole('button', { name: 'Cancel' }));
    });
    await step('Write them again, and the organizer can stop it', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'More' }));
      await userEvent.click(await screen.findByRole('button', { name: /^Write the notes again/ }, SOON));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Write the notes again' })).getByRole('button', { name: 'Write the notes again' }));
      await screen.findAllByText(/being written again/i, {}, SOON);
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }, SOON));
    });
    await step('Stopped. The notes are as they were', async () => {
      await screen.findByText('Stopped. The notes are as they were.', {}, SOON);
    });
  }
};

export const AskAboutThisCall: PageStory = {
  name: '8.29 Ask about this call',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click the bar. It stays at the bottom as you read', async () => {
      await userEvent.click(await screen.findByRole('textbox', { name: 'Ask about this call, for you alone' }, LATER));
    });
    await step('Suggested questions show above it. Pick one, or type your own', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'What did we decide?' }, SOON));
    });
    await step('It reads the call in confidential compute', async () => {
      await screen.findAllByRole('button', { name: /^Go to the moment at 3:15/ }, SOON);
    });
    await step('The answer cites the moments it came from. Click one', async () => {
      await userEvent.click(await nth(screen.findAllByRole('button', { name: /^Go to the moment at 6:02/ }, SOON), -1));
    });
    await step('The horizon and the transcript go there. Keep the answer if you want it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Keep in your notes/ }, SOON));
    });
    await step('It’s in Your notes. Other participants can’t open it', async () => {
      await within(await yours()).findByText(/What did we decide\?/, {}, SOON);
    });
  }
};

export const YourNotesThenTheSharedNotes: PageStory = {
  name: '8.30 Your notes, then the shared notes',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Write in Your notes. Nobody else reads them, the organizer included', async () => {
      await userEvent.type(await within(await yours()).findByRole('textbox', { name: 'Write in your own notes' }, SOON), 'The help article should link to the rollout plan.');
      await userEvent.click(within(await yours()).getByRole('button', { name: 'Keep it in your notes' }));
    });
    await step('It’s kept. Point at it: Add to the shared notes shows, with Edit and Delete', async () => {
      const kept = await holding('listitem', 'The help article should link to the rollout plan.');
      await userEvent.hover(kept);
      await userEvent.click(within(kept).getByRole('button', { name: 'Add to the shared notes' }));
    });
    await step('In place of the box you write in: what goes, where, and who reads it', async () => {
      await screen.findByRole('group', { name: 'Add this to the shared notes' }, SOON);
    });
    await step('Cut the words down. Nothing goes until Add for 4 people', async () => {
      const box = await within(await screen.findByRole('group', { name: 'Add this to the shared notes' })).findByRole('textbox', {}, SOON);
      await userEvent.clear(box);
      await userEvent.type(box, 'Link the help article to the rollout plan.');
      await userEvent.click(within(screen.getByRole('group', { name: 'Add this to the shared notes' })).getByRole('button', { name: /^Add for \d+ people/ }));
    });
    await step('It’s in Added by people, for everyone. Your own stays yours', async () => {
      await screen.findByText('Link the help article to the rollout plan.', {}, SOON);
    });
  }
};

/** Art added a line from his own notes to the standup's shared notes this morning. */
const artAdded = before((w) => {
  const at = iso(0, 9, 40);
  noteOf(w, 'n2').additions.push({ id: 'n2-x2', text: 'Ask Priya whether the article covers the team plan.', by: ART, at, moments: [], removable: true });
  w.personal['n2'] = (w.personal['n2'] ?? []).map((e) => (e.id === 'n2-o1' ? { ...e, shared: { additionId: 'n2-x2', at } } : e));
});
export const TakeBackWhatYouAdded: PageStory = {
  name: '8.31 Take back what you added',
  ...page('/notes/n2', 'busy'),
  beforeEach: artAdded,
  play: async ({ userEvent, step }) => {
    await step('Click Take back on what you added', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Take back' }, LATER));
    });
    await step('It asks in the row. Nothing is gone yet', async () => {
      const ask = await screen.findByRole('group', { name: /^Take this out of the shared notes/ }, SOON);
      await userEvent.click(within(ask).getByRole('button', { name: 'Take back' }));
    });
    await step('It’s out for everyone, and it stays in Your notes', async () => {
      await within(await yours()).findByText('Ask Priya whether the article covers the team plan.', {}, SOON);
    });
    await step('The organizer can Remove anyone’s the same way', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Remove' }, SOON));
      const ask = await screen.findByRole('group', { name: /shared notes, for everyone\?$/ }, SOON);
      await userEvent.click(within(ask).getByRole('button', { name: /^Remove/ }));
      await away('button', 'Remove');
    });
  }
};

export const BookmarkALineOrAScreen: PageStory = {
  name: '8.32 Bookmark a line or a shared screen',
  ...page('/notes/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Point at a line and click the bookmark', async () => {
      await userEvent.click(await nth(screen.findAllByRole('button', { name: 'Bookmark this line, for you alone' }, LATER), 3));
    });
    await step('It’s in Your notes, and only you see it', async () => {
      await within(await yours()).findByText(/Put it behind a flag/, {}, SOON);
    });
    await step('The transcript says when a screen was shared. Click it', async () => {
      await userEvent.click(screen.getByRole('button', { name: '1 shared screen' }));
    });
    await step('It opens over the note, with its own bookmark', async () => {
      const shared = await screen.findByRole('dialog', { name: 'Shared screen: Launch checklist' }, SOON);
      await userEvent.click(within(shared).getByRole('button', { name: 'Bookmark this screen, for you alone' }));
    });
    await step('Bookmarked, it’s in Your notes too', async () => {
      await userEvent.keyboard('{Escape}');
      await within(await yours()).findAllByText(/Launch checklist/, {}, SOON);
    });
  }
};

const longList = before((w) => { sharedWith(noteOf(w, 'n2'), [THEO, NADIA, OMAR, ELENA], PRIYA); });
export const ShareANoteFromItsPage: PageStory = {
  name: '8.33 Share',
  ...page('/notes/n2', 'busy'),
  beforeEach: longList,
  play: async ({ userEvent, step }) => {
    await step('Click Share', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Share' }, LATER));
    });
    await step('A popover opens under it, with your groups first', async () => {
      await screen.findByRole('dialog', { name: 'Share these notes' }, SOON);
    });
    await step('Pick people or a group, then Share', async () => {
      const sheet = await screen.findByRole('dialog', { name: 'Share these notes' });
      await userEvent.click(within(sheet).getByRole('option', { name: /^Leads/ }));
      await userEvent.click(await pressable('button', 'Share', SOON, within(sheet)));
    });
    await step('They’re in Who has these notes, with how they got them. A long list shows its first eight, until Show all', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Show all/ }, SOON));
      await screen.findByText(/Ines Moreau/, {}, SOON);
    });
  }
};

const sevenPinned = before((w) => { w.prefs.pinned = ['n1', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']; });
export const PinAndWhatWasChecked: PageStory = {
  name: '8.34 Pin, and what was checked',
  ...page('/notes/n2', 'busy'),
  beforeEach: sevenPinned,
  play: async ({ userEvent, step }) => {
    await step('Click the pin', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Pin these notes' }, LATER));
    });
    await step('It’s in the side panel', async () => {
      await within(screen.getByRole('complementary', { name: 'Side panel' })).findByRole('link', { name: 'Team standup' }, SOON);
    });
    await step('Eight is the most. Pinning a ninth says to unpin one first', async () => {
      await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Notes' }));
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'Customer research readout' }));
      await userEvent.click(within(await preview('Customer research readout')).getByRole('button', { name: 'Pin these notes' }));
      await screen.findByText(/unpin one/i, {}, SOON);
    });
    await step('Click the seal. It opens what was checked about the models', async () => {
      await userEvent.click(within(await preview('Customer research readout')).getByRole('link', { name: 'Open notes' }));
      await userEvent.click(await screen.findByRole('button', { name: /^Written in confidential compute/ }, LATER));
      await screen.findByRole('dialog', {}, SOON);
    });
  }
};

export const DeleteANote: PageStory = {
  name: '8.35 Delete',
  ...page('/notes/n1', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('More, then Delete notes', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'More' }, LATER));
      await userEvent.click(await screen.findByRole('button', { name: /^Delete notes/ }, SOON));
    });
    await step('It asks, and says what goes', async () => {
      await userEvent.click(within(await screen.findByRole('alertdialog', {}, SOON)).getByRole('button', { name: 'Delete' }));
    });
    await step('It lists what went', async () => {
      await screen.findByRole('link', { name: /Back to notes/ }, LATER);
    });
  }
};

export const NotesFromSomeoneElse: PageStory = {
  name: '8.36 Notes from someone else',
  ...page('/notes/n3', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('It says how you got them, beside when it was', async () => {
      await screen.findByText(/From Maya’s call/, {}, LATER);
    });
    await step('Shared afterwards, it says by whom, and with which group', async () => {
      await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Notes' }));
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'Board prep' }));
      await userEvent.click(within(await preview('Board prep')).getByRole('link', { name: 'Open notes' }));
      await screen.findByText(/Shared by Ines/, {}, LATER);
    });
    await step('More says Remove from your notes', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'More' }));
      await userEvent.click(await screen.findByRole('button', { name: /^Remove from your notes/ }, SOON));
    });
    await step('Everyone else keeps them', async () => {
      await userEvent.click(within(await screen.findByRole('alertdialog', {}, SOON)).getByRole('button', { name: /^Remove/ }));
    });
    await step('They’re out of your notes', async () => {
      await screen.findByRole('link', { name: /Back to notes/ }, LATER);
    });
  }
};

export const ANoteBeingWritten: PageStory = {
  name: '8.37 A note being written',
  ...page('/notes/n0', 'writing'),
  play: async ({ step }) => {
    await step('The call ended. Each step ticks off, with the one in progress marked', async () => {
      await theNote('Pricing follow-up');
      await screen.findByText(/Call ended/, {}, SOON);
    });
    await step('The audio is saved, so it can be played, and the transcript is ready to read before the notes are', async () => {
      await screen.findByText(/Transcript of \d+ lines/, {}, LATER);
    });
    await step('Written. The marks arrive on the horizon', async () => {
      await screen.findByRole('button', { name: /^Decision at 1:10/ }, LATER);
    });
  }
};

export const NothingSaid: PageStory = {
  name: '8.38 Nothing said',
  ...page('/notes/n-quiet', 'busy'),
  beforeEach: quietCall,
  play: async ({ userEvent, step }) => {
    await step('Still water. It says so, and Play stays on the line', async () => {
      await theNote('Quick check-in');
      await screen.findAllByText(/Nothing was said/i, {}, SOON);
    });
    await step('Play moves the sun along the line', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Play' }));
      await screen.findByRole('button', { name: 'Pause' }, LATER);
    });
  }
};

const KEPT_LESS: readonly NoteSpec[] = [
  { id: 'n-notr', title: 'Hiring panel', startedAt: iso(0, 13, 0), minutes: 25, organizer: ART, invited: [INES], excerpt: 'Two offers go out this week.', said: [{ at: '02:10', who: INES, text: 'Two offers go out this week.' }], kept: { transcript: false, recording: true } },
  { id: 'n-norec', title: 'Budget check', startedAt: iso(0, 12, 30), minutes: 20, organizer: ART, invited: [MAYA], excerpt: 'The budget holds for the quarter.', said: [{ at: '01:05', who: MAYA, text: 'The budget holds for the quarter.' }], kept: { transcript: true, recording: false } },
  { id: 'n-nokeep', title: 'Legal review', startedAt: iso(0, 12, 0), minutes: 30, organizer: ART, invited: [NADIA], excerpt: 'The contract goes to the board first.', said: [{ at: '04:00', who: NADIA, text: 'The contract goes to the board first.' }], kept: { transcript: false, recording: false } }
];
const keptLess = before((w) => {
  w.notes.splice(1, 0, ...KEPT_LESS.map((s) => writeNote(s)));
  noteOf(w, 'n4').gaps.push({ kind: 'paused', from: iso(-1, 11, 20), to: iso(-1, 11, 24), at: 20 * 60 });
});
export const ACallThatDidntKeepEverything: PageStory = {
  name: '8.39 A call that didn’t keep everything',
  ...page('/notes/n-notr', 'busy'),
  beforeEach: keptLess,
  play: async ({ userEvent, step }) => {
    const open = async (title: string) => {
      await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Notes' }));
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: title }));
      await userEvent.click(within(await preview(title)).getByRole('link', { name: 'Open notes' }));
      await theNote(title);
    };
    await step('No transcript: one line where it would have been, and no light on the water', async () => {
      await theNote('Hiring panel');
      await screen.findByText(/transcript/i, { selector: 'p' }, SOON);
    });
    await step('No recording: one line under the horizon, and no player', async () => {
      await open('Budget check');
      await screen.findByText(/recording/i, { selector: 'p' }, SOON);
    });
    await step('Neither. You can still ask about what the notes say', async () => {
      await open('Legal review');
      await screen.findByRole('textbox', { name: 'Ask about this call, for you alone' }, SOON);
    });
    await step('Where nothing was captured is a point on the line, and says when', async () => {
      await open('Design review');
      await screen.findByRole('note', { name: /^Paused / }, SOON);
    });
  }
};

export const ANoteThatsGone: PageStory = {
  name: '8.40 A note that’s gone',
  ...page('/notes/n-gone', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Deleted, or never shared with you. It says so', async () => {
      await userEvent.click(await screen.findByRole('link', { name: /Back to notes/ }, LATER));
    });
    await step('Back to notes', async () => {
      await screen.findByRole('heading', { name: 'Notes', level: 1 }, SOON);
    });
  }
};

const speaker = (p: Person) => ({ name: p.name, person: p });
const ROOMS: NoteRoom[] = [
  {
    id: 'room-support', name: 'Support handover', people: [speaker(PRIYA), speaker(MAYA)], from: 12 * 60 + 2, to: 16 * 60 + 24,
    summary: 'Support is happy as long as the help article comes first, and Priya sends it on Friday.',
    decisions: [], questions: [], actions: [], suggestions: [], chapters: [], gaps: [],
    transcript: [
      { id: 'rs-l1', at: 12 * 60 + 30, speaker: speaker(MAYA), room: { id: 'room-support', name: 'Support handover' }, text: 'Support only asked for one thing: the article before the flag.' },
      { id: 'rs-l2', at: 13 * 60 + 10, speaker: speaker(PRIYA), room: { id: 'room-support', name: 'Support handover' }, text: 'Then it goes to them on Friday, a week before.' }
    ]
  },
  { id: 'room-rollout', name: 'Rollout', people: [speaker(ART), speaker(KOFI)], from: 12 * 60 + 2, to: 16 * 60 + 24, summary: '', decisions: [], questions: [], actions: [], suggestions: [], chapters: [], gaps: [], transcript: [] }
];
const breakout = before((w) => { noteOf(w, 'n2').rooms = structuredClone(ROOMS); });
export const BreakoutRooms: PageStory = {
  name: '8.41 Breakout rooms',
  ...page('/notes/n2', 'busy'),
  beforeEach: breakout,
  play: async ({ userEvent, step }) => {
    await step('Each room is folded under the note. Click one', async () => {
      await screen.findByRole('heading', { name: /^Breakout rooms/ }, LATER);
      await userEvent.click(await screen.findByText('Support handover', {}, SOON));
    });
    await step('Its own summary, decisions, open questions and follow-ups', async () => {
      await screen.findByText('Support is happy as long as the help article comes first, and Priya sends it on Friday.', {}, SOON);
    });
    await step('And what was said there, folded again', async () => {
      await userEvent.click(await screen.findByText(/^What was said in Support handover/, {}, SOON));
      await screen.findByText('Then it goes to them on Friday, a week before.', {}, SOON);
    });
    await step('A room where nothing was said says so', async () => {
      await userEvent.click(screen.getByText('Rollout'));
      await screen.findAllByText(/Nothing was said/i, {}, SOON);
    });
  }
};

const EARLIER_STANDUPS: readonly NoteSpec[] = [
  { id: 'n-su-1', title: 'Team standup', startedAt: iso(-7, 9, 0), minutes: 18, organizer: ART, invited: [PRIYA, KOFI, MAYA], seriesId: 's-standup', excerpt: 'The onboarding flag gets its name, and design signs off on Tuesday.', said: [{ at: '02:00', who: KOFI, text: 'The flag is called new-onboarding.' }], decisions: [{ id: 'su1-d1', text: 'The flag is called new-onboarding.', at: '02:00', state: 'confirmed', by: KOFI }] },
  { id: 'n-su-2', title: 'Team standup', startedAt: iso(-14, 9, 0), minutes: 21, organizer: ART, invited: [PRIYA, KOFI, MAYA], seriesId: 's-standup', excerpt: 'Onboarding goes behind a flag. Support wants a week’s notice.', said: [{ at: '05:30', who: MAYA, text: 'Support wants a week’s notice before anything ships.' }], questions: [{ id: 'su2-q1', text: 'Does support need training before the launch?', at: '05:30' }] }
];
const series = before((w) => {
  noteOf(w, 'n2').seriesId = 's-standup';
  w.notes.push(...EARLIER_STANDUPS.map((s) => writeNote(s)));
  w.meetings.push({ ...call({ id: 'm-arts-call', title: 'Art’s call', startsAt: iso(0, 11, 58), minutes: 14, code: 'art-call-ins', guests: [INES], status: 'ended', noteId: 'n1' }) });
  noteOf(w, 'n1').meetingId = 'm-arts-call';
});
export const ASeriesAndMeetingAgain: PageStory = {
  name: '8.42 A series, and meeting again',
  ...page('/notes/n2', 'busy'),
  beforeEach: series,
  play: async ({ userEvent, step }) => {
    await step('In a series, the other calls sit beside the note', async () => {
      await screen.findByText(/Every Wednesday|In a series/, {}, LATER);
    });
    await step('All opens the series: what carries over from every call in it', async () => {
      await userEvent.click(await screen.findByRole('link', { name: /^All/ }, SOON));
      await screen.findByRole('heading', { level: 1 }, SOON);
    });
    await step('Not in one, the organizer can schedule next week’s call', async () => {
      await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Notes' }));
      await userEvent.click(within(await screen.findByRole('group', { name: 'Notes' }, SOON)).getByRole('link', { name: 'Art’s call' }));
      await userEvent.click(within(await preview('Art’s call')).getByRole('link', { name: 'Open notes' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Schedule next week’s call' }, LATER));
    });
    await step('That starts the series. Change opens the call, to move it or cancel it', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Change' }, LATER));
      await screen.findByRole('dialog', { name: /Art’s call/ }, SOON);
    });
  }
};

export const FirstDay: PageStory = {
  name: '8.43 First day',
  ...page('/notes/example', 'first-day'),
  play: async ({ step }) => {
    await step('Home’s example note, written out, with nothing to share or delete', async () => {
      await screen.findByRole('region', { name: 'The call' }, LATER);
    });
    await step('What it decided, what’s still open and the follow-ups, as your notes will have them', async () => {
      await screen.findByRole('heading', { name: /^Follow-ups/ }, SOON);
    });
  }
};


/* ---------- AI proposals stay separate from actual follow-ups ---------- */

const reviewBatch = () => screen.findByRole('region', { name: 'Suggestions from the call' }, SOON);

export const ReviewAfterTheCall: PageStory = {
  name: '8.44 Review suggestions after the call',
  ...page(`/notes/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals) }),
  play: async ({ userEvent, step }) => {
    await step('Open optional suggestions below the actual checklist, whenever ready', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }, SOON));
    });
    await step('Add the handover as an actual task. Adding it does not say Art will do it', async () => {
      await userEvent.click(within(await article(FOLLOW_UP_NEW.text)).getByRole('button', { name: 'Add' }));
      await within(await reviewBatch()).findByText('Added', {}, SOON);
    });
    await step('Close review, then choose I’ll do it separately to accept responsibility', async () => {
      await userEvent.click(within(await reviewBatch()).getByRole('button', { name: 'Close suggestions' }));
      await userEvent.click(within(await article(FOLLOW_UP_NEW.text)).getByRole('button', { name: 'I’ll do it' }));
    });
  }
};

export const ApplyAProposedChange: PageStory = {
  name: '8.45 Apply a proposed change',
  ...page(`/notes/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals) }),
  play: async ({ userEvent, step }) => {
    await step('Open review. The proposed change shows the current and suggested words, owner and due date', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }, SOON));
    });
    await step('Apply change updates the same checklist task. Kofi must agree to the changed commitment', async () => {
      await userEvent.click(within(await article('Send the reviewed launch checklist')).getByRole('button', { name: 'Apply change' }));
      await within(await reviewBatch()).findByText('Change applied', {}, SOON);
    });
    await step('Dismiss the new handover proposal and keep both resolved rows in place', async () => {
      await userEvent.click(within(await article(FOLLOW_UP_NEW.text)).getByRole('button', { name: 'Dismiss' }));
      await within(await reviewBatch()).findByText('Dismissed', {}, SOON);
    });
  }
};

export const ReviewAStaleSuggestion: PageStory = {
  name: '8.46 Review a stale suggestion',
  ...page(`/notes/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals) }),
  play: async ({ userEvent, step }) => {
    await step('Open a fixed review batch', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }, SOON));
    });
    await step('The actual checklist changes while these earlier proposal words remain on screen', async () => {
      await standIn.notes.updateAction(FOLLOW_UP_NOTE, FOLLOW_UP_TASK.id, { due: 'Thursday' });
    });
    await step('The stale proposal cannot overwrite the newer task', async () => {
      await userEvent.click(within(await article('Send the reviewed launch checklist')).getByRole('button', { name: 'Apply change' }));
      await within(await reviewBatch()).findByText('That follow-up changed. Close review and open it again.', {}, SOON);
    });
  }
};
