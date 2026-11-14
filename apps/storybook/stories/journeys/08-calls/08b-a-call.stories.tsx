/*
 * Journeys on a call's page (docs/product/user-flows.md › 8. Calls; docs/design/pages.md › A call's page): a call that
 * happened, played on its night stage with its line under it, what was shared and made in it, and its Notes, Transcript
 * and Your notes beside it; then a call ahead, with its agenda, your answer and Join. Calls' own list is in
 * 08-the-calls-page.stories.tsx. Where a journey needs a call the busy afternoon doesn't have (a decision someone disputes, a call
 * where nothing was said, breakout rooms, a series), it puts it in the world before the page opens.
 */
import type { Note, NoteRoom, Person } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { standIn } from '../../../src/api/standin';
import { changer, writeNote, type NoteSpec } from '../../../src/world/build';
import { iso } from '../../../src/world/clock';
import { ART, ELENA, INES, KOFI, LENA, MAYA, NADIA, OMAR, PRIYA, SAM, THEO } from '../../../src/world/people';
import { current } from '../../../src/api/state';
import type { World } from '../../../src/world/world';
import { FOLLOW_UP_NEW, FOLLOW_UP_NOTE, FOLLOW_UP_TASK, withFollowUpProposals } from '../../../src/world/follow-ups';
import { DESIGN_CRIT, HIRING_SYNC, withDesignCrit, withHiringSync } from '../../../src/world/scheduling';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { linkToReadout } from '../../pages/changes';
import { away, before, first, holding, LAPTOP, LATER, nth, pressable, SOON } from '../play';

const meta = { title: 'Journeys/8 Calls/A call', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type UserEvent = Parameters<Play>[0]['userEvent'];

/* ---------- what the journeys find ---------- */

/** Calls' places, and its sheet, where a call's row opens it. */
const rail = () => screen.findByRole('navigation', { name: 'Your calls' }, SOON);
const calls = () => screen.findByRole('region', { name: 'Your calls' }, SOON);
const theCall = (title: string) => screen.findByRole('heading', { name: title, level: 1 }, LATER);
/** The stage: the call at the moment it's at. */
const stage = () => screen.findByRole('group', { name: /^The call at this moment/ }, LATER);
const yours = () => screen.findByRole('region', { name: 'Your notes' }, SOON);
const shared = () => screen.findByRole('region', { name: 'Shared notes' }, LATER);
const article = (text: string | RegExp) => holding('article', text);

/** Opens one of the tabs beside the stage. */
async function open(userEvent: UserEvent, tab: 'Notes' | 'Transcript' | 'Your notes'): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name: tab }, LATER));
}

/** Waits for the sun to reach `at` seconds on the line under the stage, or to pass it while the call plays. */
const sunAt = (at: number) => waitFor(() => {
  const now = Number(screen.getByRole('slider', { name: 'Position in the call' }).getAttribute('aria-valuenow'));
  if (now < at) throw new Error(`The sun is at ${now}s, not ${at}s yet.`);
}, SOON);

/** Back to Calls from a call's page, then a call that happened, by its title. */
async function fromCalls(userEvent: UserEvent, title: string): Promise<void> {
  await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Calls' }));
  await userEvent.click(within(await rail()).getByRole('link', { name: 'Past calls' }));
  await userEvent.click(await within(await calls()).findByRole('link', { name: title }, SOON));
  await theCall(title);
}

/** Opens More at the top of a call's page, then presses `item`. */
async function inMore(userEvent: UserEvent, item: RegExp): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'More' }, LATER));
  await userEvent.click(await screen.findByRole('button', { name: item }, SOON));
}

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

/* ---------- the example ---------- */

export const ReadTheExample: PageStory = {
  name: '8.11 Read the example',
  ...page('/home', 'first-day'),
  play: async ({ userEvent, step }) => {
    await step('On Home’s first day, open the example note’s card in Recent notes', async () => {
      await userEvent.click(within(await screen.findByRole('region', { name: 'Recent notes' }, SOON)).getByRole('link', { name: 'Weekly product call' }));
    });
    await step('It opens like any call’s page, its stage and its notes, with nothing to share or delete', async () => {
      await screen.findByRole('heading', { level: 1 }, LATER);
      await stage();
    });
  }
};

/* ---------- a call that happened ---------- */

export const JumpToAMoment: PageStory = {
  name: '8.12 Jump to a moment from the line',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Point at a mark on the line under the stage. It says what happened there', async () => {
      await userEvent.hover(await screen.findByRole('button', { name: /^Decision at 3:15/ }, LATER));
    });
    await step('Click it. The sun moves there, and the stage shows who was speaking', async () => {
      await userEvent.click(screen.getByRole('button', { name: /^Decision at 3:15/ }));
      await sunAt(195);
    });
    await step('Press play. The call plays on the stage, and the sun moves along the line', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Play' }, SOON));
      await screen.findByRole('button', { name: 'Pause' }, LATER);
    });
    await step('A ▶ chip in the notes plays its moment from anywhere on the page, and Notes stays open', async () => {
      await userEvent.click(within(await article('Write the help article for support')).getByRole('button', { name: 'Play the call from 6:20' }));
      await sunAt(380);
    });
    await step('How it went has each chapter with its ▶, so the next jump is one click: Launch checklist', async () => {
      await userEvent.click(within(await screen.findByRole('region', { name: 'How it went' }, SOON)).getByRole('button', { name: 'Play the call from 8:40' }));
      await sunAt(520);
    });
    await step('Open the Transcript. The line being said is lit as the call plays', async () => {
      await open(userEvent, 'Transcript');
    });
    await step('Press what was said on a line, or its time. It plays from that line, lit where it is', async () => {
      await userEvent.click(await first(screen.findAllByText('Thanks. One is the empty state on the team page, the other is the flag name in the rollout plan.', {}, SOON)));
      await screen.findByRole('button', { name: 'Pause' }, LATER);
    });
    await step('Space pauses, and plays again, as in any player: anywhere on the page but in a field or on a button', async () => {
      await userEvent.keyboard(' ');
      await screen.findByRole('button', { name: 'Play' }, SOON);
      await userEvent.keyboard(' ');
      await screen.findByRole('button', { name: 'Pause' }, LATER);
    });
  }
};

export const ConfirmRewordAndUndo: PageStory = {
  name: '8.13 Confirm, reword and undo a decision',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    const confirmed = () => article(/ships behind a flag[\s\S]*Confirmed by you/);
    await step('For you has the decision to confirm. Click Confirm', async () => {
      await userEvent.click(within(await article('The new onboarding ships behind a flag')).getByRole('button', { name: 'Confirm' }));
    });
    await step('It says so, with Undo, and it’s under Decided, confirmed by you. Its mark on the line fills in', async () => {
      await screen.findByText('Confirmed for everyone with the notes.', {}, SOON);
      await confirmed();
    });
    await step('Its menu rewords it, says it no longer holds, or undoes it', async () => {
      await userEvent.click(within(await confirmed()).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'Reword' }));
    });
    await step('It rewords in place', async () => {
      const words = await screen.findByRole('textbox', { name: 'Reword this decision' }, SOON);
      await userEvent.clear(words);
      await userEvent.type(words, 'The new onboarding ships behind a flag on 12 November, for one per cent first.');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    await step('Reworded, it needs confirming again: it’s back in For you, in the new words, and its mark is hollow again', async () => {
      await within(await article('for one per cent first')).findByRole('button', { name: 'Confirm' }, SOON);
    });
  }
};

export const WhenItWasntDecided: PageStory = {
  name: '8.14 When it wasn’t decided, or stopped holding',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    const question = () => article('Who tells existing customers');
    await step('For you asks whether it was decided. Click It wasn’t decided', async () => {
      await userEvent.click(within(await article('The new onboarding ships behind a flag')).getByRole('button', { name: 'It wasn’t decided' }));
    });
    await step('It’s crossed out for everyone, with Undo, and says who said so, with Reopen. Its mark leaves the line', async () => {
      await within(await article(/ships behind a flag[\s\S]*You said this wasn’t decided/)).findByRole('button', { name: 'Reopen' }, SOON);
    });
    await step('A confirmed decision can stop holding when a later one replaces it, from its menu', async () => {
      await userEvent.click(within(await article('Support gets the help article')).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'It no longer holds' }));
      await within(await article('Support gets the help article')).findByText(/no longer holds/i, {}, SOON);
    });
    await step('An open question works the same way, from its menu: It was answered, then Reopen', async () => {
      await userEvent.click(within(await question()).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'It was answered' }));
      await within(await question()).findByText('You said this was answered', {}, SOON);
      await userEvent.click(within(await question()).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'Reopen' }));
      await within(await question()).findByText('Reopened by you', {}, SOON);
    });
  }
};

export const WhenSomeoneSaysItWasntDecided: PageStory = {
  name: '8.15 When someone says it wasn’t decided',
  ...page('/calls/n3', 'busy'),
  beforeEach: disputed,
  play: async ({ userEvent, step }) => {
    await step('Someone who can’t reject it says so, in their name, for the organizer to settle', async () => {
      await userEvent.click(within(await article('The team plan gets a monthly option')).getByRole('button', { name: 'Change this' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).getByRole('button', { name: 'It wasn’t decided' }));
      await within(await article('The team plan gets a monthly option')).findByText('You said this wasn’t decided', {}, SOON);
    });
    await step('On your own design review, Kofi has said so: it’s in For you, yours to settle. Its menu shows what was said behind it, and every change', async () => {
      await fromCalls(userEvent, 'Design review');
      await userEvent.click(within(await article('One filled button per view')).getByRole('button', { name: 'Change this' }));
      await within(await screen.findByRole('dialog', { name: 'Change this' }, SOON)).findAllByText(/Kofi/, {}, SOON);
    });
    await step('Keep it confirmed settles it', async () => {
      await userEvent.keyboard('{Escape}');
      await userEvent.click(within(await article('One filled button per view')).getByRole('button', { name: 'Keep it confirmed' }));
      await screen.findByText('Confirmed for everyone with the notes.', {}, SOON);
    });
  }
};

export const AddWhatTheNotesMissed: PageStory = {
  name: '8.16 Add what the notes missed',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Under each list: Propose a decision, or Add a follow-up', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Propose a decision' }, LATER));
    });
    await step('It opens in place, in your words. Everyone with the notes sees it', async () => {
      await userEvent.type(await screen.findByRole('textbox', { name: 'Propose a decision' }, SOON), 'Support answers onboarding questions in the help article’s comments.');
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    await step('It’s proposed, for everyone with the notes, until it’s confirmed: as the organizer’s, it waits in For you', async () => {
      await within(await article('in the help article’s comments')).findByText('Decision to confirm', {}, SOON);
    });
    await step('In the Transcript, the plus on a line starts one from what was said there, back in Notes', async () => {
      await open(userEvent, 'Transcript');
      await userEvent.click(await nth(screen.findAllByRole('button', { name: 'Add to the notes from this line' }, SOON), 2));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Add to the notes from this line' }, SOON)).getByRole('button', { name: 'Add a follow-up' }));
      await screen.findByRole('textbox', { name: 'What needs doing' }, SOON);
    });
  }
};

export const TakeOnAndReassign: PageStory = {
  name: '8.17 Take on and reassign a follow-up',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    const taken = () => article(/Review the launch checklist[\s\S]*Yours/);
    await step('For you: the notes suggest you, with a dot. Click I’ll do it', async () => {
      await userEvent.click(within(await article('Review the launch checklist')).getByRole('button', { name: 'I’ll do it' }));
    });
    await step('It’s yours, with Undo: under Follow-ups with a box to tick, and solid on the line', async () => {
      await taken();
    });
    await step('Its menu gives it to anyone with the notes, dates it, rewords it and lists every change', async () => {
      await userEvent.click(within(await taken()).getByRole('button', { name: 'Change this' }));
      await screen.findByRole('dialog', { name: 'Change this' }, SOON);
    });
    await step('Give it to Kofi. It stays a dot until Kofi takes it on', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change this' })).getByRole('button', { name: /^Kofi Asante/ }));
      await within(await article('Review the launch checklist')).findAllByText(/Kofi/, {}, SOON);
    });
  }
};

export const CorrectALine: PageStory = {
  name: '8.18 Correct a transcript line',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('In the Transcript, point at a line and click the pencil. Dots mark what it wasn’t sure of', async () => {
      await open(userEvent, 'Transcript');
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
    await step('It says Corrected, and in Notes the organizer can write the notes again', async () => {
      await screen.findByText('Corrected', {}, SOON);
      await open(userEvent, 'Notes');
      await userEvent.click(await screen.findByRole('button', { name: /Write the notes again/ }, SOON));
    });
    await step('Everyone keeps reading, and the seal says it’s being written again', async () => {
      await screen.findAllByText(/being written again/i, {}, SOON);
    });
    await step('Done, and what people settled stayed. Corrected says who, when and what was heard', async () => {
      await screen.findByRole('button', { name: /^Written in confidential compute/ }, LATER);
    });
    await step('More › Write the notes again asks in a small window, with the AI model to write them', async () => {
      await inMore(userEvent, /^Write the notes again/);
      await screen.findByRole('dialog', { name: 'Write the notes again' }, SOON);
    });
    await step('Cancel leaves the notes as they are', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Write the notes again' })).getByRole('button', { name: 'Cancel' }));
    });
    await step('Write them again, and the organizer can stop it', async () => {
      await inMore(userEvent, /^Write the notes again/);
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Write the notes again' })).getByRole('button', { name: 'Write the notes again' }));
      await screen.findAllByText(/being written again/i, {}, SOON);
      await away('dialog', 'Write the notes again');
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }, SOON));
    });
    await step('Stopped. The notes are as they were', async () => {
      await screen.findByText('Stopped. The notes are as they were.', {}, SOON);
    });
  }
};

export const AskAboutThisCall: PageStory = {
  name: '8.19 Ask about this call',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Point at the bar at the foot of the notes. Its suggested questions show above it', async () => {
      await userEvent.hover(await screen.findByRole('textbox', { name: 'Ask about this call, for you alone' }, LATER));
    });
    await step('Click it, and they stay while you ask. Pick one, or type your own', async () => {
      await userEvent.click(screen.getByRole('textbox', { name: 'Ask about this call, for you alone' }));
      await userEvent.click(await screen.findByRole('button', { name: 'What did we decide?' }, SOON));
    });
    await step('It reads the call in confidential compute', async () => {
      await screen.findAllByRole('button', { name: 'Play the call from 3:15' }, SOON);
    });
    await step('The answer cites the moments it came from. Click one', async () => {
      await userEvent.click(await nth(screen.findAllByRole('button', { name: 'Play the call from 6:02' }, SOON), -1));
    });
    await step('It plays on the stage from there. Keep the answer if you want it', async () => {
      await sunAt(362);
      await userEvent.click(await screen.findByRole('button', { name: /Keep in your notes/ }, SOON));
    });
    await step('It’s in Your notes. Other participants can’t open it', async () => {
      await open(userEvent, 'Your notes');
      await within(await yours()).findByText(/What did we decide\?/, {}, SOON);
    });
  }
};

export const YourNotesThenTheSharedNotes: PageStory = {
  name: '8.20 Your notes, then the shared notes',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Open Your notes and write. Nobody else reads them, the organizer included', async () => {
      await open(userEvent, 'Your notes');
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
    await step('It’s in the shared notes, in Notes, for everyone. Your own stays yours', async () => {
      await open(userEvent, 'Notes');
      await within(await shared()).findByText('Link the help article to the rollout plan.', {}, SOON);
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
  name: '8.21 Take back what you added',
  ...page('/calls/n2', 'busy'),
  beforeEach: artAdded,
  play: async ({ userEvent, step }) => {
    await step('In the shared notes, click Take back on what you added', async () => {
      await userEvent.click(within(await shared()).getByRole('button', { name: 'Take back' }));
    });
    await step('It asks in the row. Nothing is gone yet', async () => {
      const ask = await screen.findByRole('group', { name: /^Take this out of the shared notes/ }, SOON);
      await userEvent.click(within(ask).getByRole('button', { name: 'Take back' }));
    });
    await step('It’s out for everyone, and it stays in Your notes', async () => {
      await screen.findByText('It’s out of the shared notes, for everyone.', {}, SOON);
      await open(userEvent, 'Your notes');
      await within(await yours()).findByText('Ask Priya whether the article covers the team plan.', {}, SOON);
    });
    await step('The organizer can Remove anyone’s the same way', async () => {
      await open(userEvent, 'Notes');
      await userEvent.click(within(await shared()).getByRole('button', { name: 'Remove' }));
      const ask = await screen.findByRole('group', { name: /shared notes, for everyone\?$/ }, SOON);
      await userEvent.click(within(ask).getByRole('button', { name: /^Remove/ }));
      await away('button', 'Remove');
    });
  }
};

export const BookmarkALineOrAScreen: PageStory = {
  name: '8.22 Bookmark a line or a shared screen',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('In the Transcript, point at a line and click the bookmark', async () => {
      await open(userEvent, 'Transcript');
      await userEvent.click(await nth(screen.findAllByRole('button', { name: 'Bookmark this line in your own notes, which only you see' }, LATER), 3));
    });
    await step('It’s in Your notes, and only you see it', async () => {
      await open(userEvent, 'Your notes');
      await within(await yours()).findByText(/Put it behind a flag/, {}, SOON);
    });
    await step('In the Transcript its bookmark stays, ticked. Click it again to take it back', async () => {
      await open(userEvent, 'Transcript');
      await userEvent.click(await first(screen.findAllByRole('button', { name: 'Remove your bookmark' }, SOON)));
    });
    await step('It’s out of Your notes, and the line can be bookmarked again', async () => {
      await open(userEvent, 'Your notes');
      const mine = await yours();
      await waitFor(() => { if (within(mine).queryByText(/Put it behind a flag/)) throw new Error('It’s still in Your notes.'); }, SOON);
    });
    await step('Among the lines, the Transcript shows what was on a shared screen. Click it', async () => {
      await open(userEvent, 'Transcript');
      await userEvent.click(await screen.findByRole('button', { name: 'Open the screen: Launch checklist' }, SOON));
    });
    await step('It opens over the call, with its own bookmark', async () => {
      const screenOf = await screen.findByRole('dialog', { name: 'Shared screen: Launch checklist' }, SOON);
      await userEvent.click(within(screenOf).getByRole('button', { name: 'Bookmark this screen in your own notes, which only you see' }));
    });
    await step('Bookmarked, it’s in Your notes too', async () => {
      await userEvent.keyboard('{Escape}');
      await open(userEvent, 'Your notes');
      await within(await yours()).findAllByText(/Launch checklist/, {}, SOON);
    });
  }
};

const longList = before((w) => { sharedWith(noteOf(w, 'n2'), [THEO, NADIA, OMAR, ELENA, LENA, SAM], PRIYA); });
export const ShareANoteFromItsPage: PageStory = {
  name: '8.23 Share',
  ...page('/calls/n2', 'busy'),
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
    await step('Who has the notes is under the title: click the faces. A long list shows its first eight, with how each got them, until Show all', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Maya and you$/i }, SOON));
      await userEvent.click(await within(await screen.findByRole('dialog', { name: 'Who has these notes' }, SOON)).findByRole('button', { name: /^Show all/ }, SOON));
      await screen.findByText(/Ines Moreau/, {}, SOON);
    });
  }
};

const sevenPinned = before((w) => { w.prefs.pinned = ['n1', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']; });
export const PinAndWhatWasChecked: PageStory = {
  name: '8.24 Pin, and what was checked',
  ...page('/calls/n2', 'busy'),
  beforeEach: sevenPinned,
  play: async ({ userEvent, step }) => {
    await step('More, then Pin to the side panel', async () => {
      await inMore(userEvent, /^Pin to the side panel/);
    });
    await step('It’s in the side panel', async () => {
      await within(screen.getByRole('complementary', { name: 'Side panel' })).findByRole('link', { name: 'Team standup' }, SOON);
    });
    await step('Eight is the most. Pinning a ninth says to unpin one first', async () => {
      await fromCalls(userEvent, 'Customer research readout');
      await inMore(userEvent, /^Pin to the side panel/);
      await screen.findByText(/unpin one/i, {}, SOON);
    });
    await step('Click the seal under the title. It opens what was checked about the models', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Written in confidential compute/ }, LATER));
      await screen.findByRole('dialog', { name: 'Which models worked on these notes' }, SOON);
    });
  }
};

export const DeleteANote: PageStory = {
  name: '8.25 Delete',
  ...page('/calls/n1', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('More, then Delete notes', async () => {
      await inMore(userEvent, /^Delete notes/);
    });
    await step('It asks in the same popover, and says what goes', async () => {
      await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Delete these notes' }, SOON)).getByRole('button', { name: 'Delete' }));
    });
    await step('It lists what went, with the way back to Calls', async () => {
      await screen.findByRole('link', { name: /Back to Calls/ }, LATER);
    });
  }
};

export const NotesFromSomeoneElse: PageStory = {
  name: '8.26 Notes from someone else',
  ...page('/calls/n3', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('It says how you got them, beside when it was', async () => {
      await screen.findByText(/From Maya’s call/, {}, LATER);
    });
    await step('Shared afterwards, it says by whom, and with which group', async () => {
      await fromCalls(userEvent, 'Board prep');
      await screen.findByText(/Shared by Ines/, {}, LATER);
    });
    await step('More says Remove from your notes', async () => {
      await inMore(userEvent, /^Remove from your notes/);
    });
    await step('Everyone else keeps them', async () => {
      await userEvent.click(within(await screen.findByRole('alertdialog', { name: 'Remove these notes' }, SOON)).getByRole('button', { name: /^Remove/ }));
    });
    await step('They’re out of your notes', async () => {
      await screen.findByRole('link', { name: /Back to Calls/ }, LATER);
    });
  }
};

export const ANoteBeingWritten: PageStory = {
  name: '8.27 A note being written',
  ...page('/calls/n0', 'writing'),
  play: async ({ step }) => {
    await step('The call ended. Each step ticks off, with the one in progress marked', async () => {
      await theCall('Pricing follow-up');
      await screen.findByText(/Call ended/, {}, SOON);
    });
    await step('The audio is saved, so it can be played, and the transcript is ready to read before the notes are', async () => {
      await screen.findByText(/Transcript of \d+ lines/, {}, LATER);
    });
    await step('Written. The marks arrive on the line under the stage', async () => {
      await screen.findByRole('button', { name: /^Decision at 1:10/ }, LATER);
    });
  }
};

const QUIET: NoteSpec = { id: 'n-quiet', title: 'Quick check-in', startedAt: iso(0, 14, 30), minutes: 3, organizer: ART, invited: [MAYA], excerpt: '', said: [] };
const quietCall = before((w) => { w.notes.splice(1, 0, writeNote(QUIET)); });
export const NothingSaid: PageStory = {
  name: '8.28 Nothing said',
  ...page('/calls/n-quiet', 'busy'),
  beforeEach: quietCall,
  play: async ({ userEvent, step }) => {
    await step('The notes say nothing was said, and the stage still has who was there, with Play on its line', async () => {
      await theCall('Quick check-in');
      await screen.findAllByText(/Nothing was said/i, {}, SOON);
    });
    await step('Play moves the sun along the line', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Play' }, SOON));
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
  name: '8.29 A call that didn’t keep everything',
  ...page('/calls/n-notr', 'busy'),
  beforeEach: keptLess,
  play: async ({ userEvent, step }) => {
    await step('No transcript: its tab says it was deleted once the notes were written, as the call was set to', async () => {
      await theCall('Hiring panel');
      await open(userEvent, 'Transcript');
      await screen.findByText('No transcript', {}, SOON);
    });
    await step('No recording: one line under the stage’s line, and no player', async () => {
      await fromCalls(userEvent, 'Budget check');
      await screen.findByText('The recording was deleted when the call ended.', {}, SOON);
    });
    await step('Neither: nothing to play back, so no stage or line, and it says why. You can still ask about what the notes say', async () => {
      await fromCalls(userEvent, 'Legal review');
      await screen.findByRole('heading', { name: 'Nothing to play back' }, SOON);
      await screen.findByRole('textbox', { name: 'Ask about this call, for you alone' }, SOON);
    });
    await step('Where nothing was captured is a point on the line, and the Transcript says when', async () => {
      await fromCalls(userEvent, 'Design review');
      await open(userEvent, 'Transcript');
      await holding('note', /^Paused /);
    });
  }
};

export const ANoteThatsGone: PageStory = {
  name: '8.30 A note that’s gone',
  ...page('/calls/n-gone', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Deleted, or never shared with you. It says so', async () => {
      await userEvent.click(await screen.findByRole('link', { name: /Back to Calls/ }, LATER));
    });
    await step('Back to Calls', async () => {
      await screen.findByRole('heading', { name: 'Calls', level: 1 }, SOON);
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
  name: '8.31 Breakout rooms',
  ...page('/calls/n2', 'busy'),
  beforeEach: breakout,
  play: async ({ userEvent, step }) => {
    await step('In How it went, each room is folded under the chapter it was open in. Click one', async () => {
      await screen.findByRole('region', { name: 'How it went' }, LATER);
      await userEvent.click(await screen.findByText('Support handover', {}, SOON));
    });
    await step('Its own summary, decisions, open questions and follow-ups', async () => {
      await screen.findByRole('heading', { name: 'Decided', level: 3 }, SOON);
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
});
export const ASeriesAndMeetingAgain: PageStory = {
  name: '8.32 A series, and meeting again',
  ...page('/calls/n2', 'busy'),
  beforeEach: series,
  play: async ({ userEvent, step }) => {
    await step('In a series, the line under the title says so', async () => {
      await screen.findByRole('link', { name: /Every Wednesday|In a series/ }, LATER);
    });
    await step('Click it. Calls opens on the series: what carries over from every call in it', async () => {
      await userEvent.click(screen.getByRole('link', { name: /Every Wednesday|In a series/ }));
      await screen.findByRole('region', { name: 'What carries over' }, SOON);
    });
    await step('Not in one, More has Meet again', async () => {
      await userEvent.click(within(await rail()).getByRole('link', { name: 'Past calls' }));
      await userEvent.click(await within(await calls()).findByRole('link', { name: 'Art’s call' }, SOON));
      await theCall('Art’s call');
      await inMore(userEvent, /^Meet again/);
    });
    await step('Scheduling opens on Calls, with the same people', async () => {
      await screen.findByRole('complementary', { name: 'Schedule a call' }, LATER);
    });
  }
};

export const FirstDay: PageStory = {
  name: '8.33 First day',
  ...page('/calls/example', 'first-day'),
  play: async ({ step }) => {
    await step('Home’s example note, written out on its stage, with nothing to share or delete', async () => {
      await stage();
    });
    await step('What it decided, what’s still open and the follow-ups, as your notes will have them', async () => {
      await screen.findByRole('heading', { name: /^Follow-ups/ }, SOON);
    });
  }
};


/* ---------- AI proposals stay separate from actual follow-ups ---------- */

const reviewBatch = () => screen.findByRole('region', { name: 'Suggestions from the call' }, SOON);

export const ReviewAfterTheCall: PageStory = {
  name: '8.34 Review suggestions after the call',
  ...page(`/calls/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals) }),
  play: async ({ userEvent, step }) => {
    await step('Open optional suggestions below the actual checklist, whenever ready', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }, LATER));
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
  name: '8.35 Apply a proposed change',
  ...page(`/calls/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals) }),
  play: async ({ userEvent, step }) => {
    await step('Open review. The proposed change shows the current and suggested words, owner and due date', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }, LATER));
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
  name: '8.36 Review a stale suggestion',
  ...page(`/calls/${FOLLOW_UP_NOTE}`, 'busy', { beforeEach: changing(withFollowUpProposals) }),
  play: async ({ userEvent, step }) => {
    await step('Open a fixed review batch', async () => {
      await userEvent.click(await screen.findByRole('button', { name: '2 suggestions from the call' }, LATER));
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

export const WriteInTheSharedNotes: PageStory = {
  name: '8.37 Write in the shared notes',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('In Notes, the shared notes have their own box, which says who reads what goes there before anything is typed', async () => {
      await within(await shared()).findByText(/, and anyone they share the notes with$/, {}, LATER);
    });
    await step('Write for everyone and press Enter. It goes in one step', async () => {
      await userEvent.type(await within(await shared()).findByRole('textbox', { name: 'Write in the shared notes' }, SOON), 'Support needs the article by Monday.{Enter}');
    });
    await step('It’s in the shared notes for everyone, with who wrote it and when. Take back takes it out again', async () => {
      await within(await shared()).findByText('Support needs the article by Monday.', {}, SOON);
      await within(await shared()).findAllByRole('button', { name: 'Take back' }, SOON);
    });
  }
};

export const SomeoneGetsTheNotesWhileYouWrite: PageStory = {
  name: '8.38 Someone gets the notes while you write',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    const box = async () => within(await shared()).findByRole('textbox', { name: 'Write in the shared notes' }, LATER);
    await step('Start writing in the shared notes. The box says who reads it', async () => {
      await userEvent.type(await box(), 'Support needs the article by Monday.');
    });
    await step('Meanwhile Kofi shares the notes with Lena', async () => {
      const n = current().notes.find((x) => x.id === 'n2');
      if (n && !n.people.some((p) => p.email === LENA.email)) sharedWith(n, [LENA], KOFI);
    });
    await step('Press Enter. It isn’t posted: Lena has the notes now, and the box says she reads it too', async () => {
      await userEvent.type(await box(), '{Enter}');
      await within(await shared()).findByText('Lena got the notes since you started, so they read it too.', {}, SOON);
    });
    await step('Press Enter again: it goes, for everyone with the notes, Lena included', async () => {
      await userEvent.type(await box(), '{Enter}');
      await within(await shared()).findByText('Support needs the article by Monday.', {}, SOON);
    });
  }
};

export const ShareByLink: PageStory = {
  name: '8.39 Share by link',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Press Share. Under the people, Share a link says whoever opens it signed in gets the notes, for 7 days', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Share' }, LATER));
      await screen.findByText('Whoever opens it signed in gets these notes, for 7 days.', {}, SOON);
    });
    await step('Make a link. It shows once, to copy, and it’s listed as yours until it runs out', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Make a link' }));
      await screen.findByRole('group', { name: 'The link to these notes' }, SOON);
      await screen.findByText('Your link', { exact: false }, SOON);
    });
    await step('Revoke it: from now on it opens nothing, and whoever it gave the notes to keeps them', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
      await away('button', 'Revoke');
    });
  }
};

export const OpenALinkToNotes: PageStory = {
  name: '8.40 Open a link to notes',
  ...page('/link', 'signed-out', { beforeEach: changing(linkToReadout()) }),
  play: async ({ userEvent, step }) => {
    await step('Priya sent Art a link to her research readout. Signed out, it opens nothing: it asks him to sign in first. Continue with Microsoft', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Continue with Microsoft' }, SOON));
    });
    await step('Signed in, it still opens nothing. It asks whether to open them as his address, which everyone with the notes will see', async () => {
      await screen.findByText(ART.email, {}, SOON);
      await screen.findByRole('button', { name: 'Open the notes' }, SOON);
    });
    await step('Open the notes. The readout joins his notes, from Priya’s link, and opens', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Open the notes' }));
      await theCall('Customer research readout');
      await screen.findByText('From Priya’s link', {}, SOON);
    });
  }
};

/* ---------- a call ahead ---------- */

export const AddAnAgenda: PageStory = {
  name: '8.41 Add an agenda before the call',
  ...page(`/calls/upcoming/${HIRING_SYNC.id}`, 'busy', { beforeEach: changing(withHiringSync) }),
  play: async ({ userEvent, step }) => {
    await step('Art’s hiring sync, tomorrow: nothing for the call yet. Click Add an agenda', async () => {
      await userEvent.click(within(await screen.findByRole('region', { name: 'Agenda' }, LATER)).getByRole('button', { name: 'Add an agenda' }));
    });
    await step('It’s made in the call’s workspace, for everyone invited, and opens there, ready to write', async () => {
      await within(await screen.findByRole('navigation', { name: 'This workspace' }, LATER)).findByRole('button', { name: /^Agenda/ }, LATER);
    });
  }
};

export const AnswerOnTheCallsPage: PageStory = {
  name: '8.42 Answer on the call’s page',
  ...page(`/calls/upcoming/${DESIGN_CRIT.id}`, 'busy', { beforeEach: changing(withDesignCrit) }),
  play: async ({ userEvent, step }) => {
    await step('Kofi’s design crit, tomorrow: Are you coming? Click Yes', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: `Are you going to ${DESIGN_CRIT.title}?` }, LATER)).getByRole('button', { name: 'Yes' }));
    });
    await step('Kofi sees it, and your arch says so. Your answer stays, with Change to answer again', async () => {
      await screen.findByText('You’re going', {}, SOON);
      await screen.findByRole('button', { name: `Change your answer to ${DESIGN_CRIT.title}` }, SOON);
    });
  }
};

export const JoinWhenItsTime: PageStory = {
  name: '8.43 Join when it’s time',
  ...page('/calls/upcoming/m-review', 'call-soon'),
  play: async ({ userEvent, step }) => {
    await step('Four minutes before the design review, Join is on the stage. Click it', async () => {
      await userEvent.click(within(await screen.findByRole('group', { name: 'Who’s invited' }, LATER)).getByRole('button', { name: 'Join' }));
    });
    await step('The lobby: your camera and microphone, the only place a camera shows before the call, and Join', async () => {
      await screen.findByRole('button', { name: /^Microphone:/ }, LATER);
    });
  }
};

/* ---------- playing it back ---------- */

export const PlayAMoment: PageStory = {
  name: '8.44 Play a moment from the notes',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('On the decision waiting for you, click ▶ 3:15', async () => {
      await userEvent.click(within(await article('The new onboarding ships behind a flag')).getByRole('button', { name: 'Play the call from 3:15' }));
    });
    await step('It plays on the stage from there: who’s speaking lit, their words as the caption', async () => {
      await within(await stage()).findByText(/Then let’s say it/, {}, LATER);
      await screen.findByRole('button', { name: 'Pause' }, SOON);
    });
    await step('Notes stays open where you were, with the decision still to confirm', async () => {
      await screen.findByRole('tab', { name: 'Notes', selected: true }, SOON);
      await within(await article('The new onboarding ships behind a flag')).findByRole('button', { name: 'Confirm' }, SOON);
    });
  }
};

export const DownloadFromACall: PageStory = {
  name: '8.45 Download from a call',
  ...page('/calls/n2', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Download, beside Share', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Download' }, LATER));
    });
    await step('What the call kept, each saved on this device: the transcript, the notes, the recording and Kofi’s screen', async () => {
      const menu = await screen.findByRole('dialog', { name: 'Download from this call' }, SOON);
      await within(menu).findByRole('button', { name: /^The transcript/ }, SOON);
      await within(menu).findByText('Opened on this device. Alcove can’t read it.', {}, SOON);
    });
  }
};
