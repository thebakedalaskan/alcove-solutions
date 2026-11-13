/*
 * Search or ask (user-flows 2): one solid window over the page, from Search or ask at the top right of every page (⌘K on a
 * Mac, Ctrl+K elsewhere) or the magnifier in a phone's top bar. Before anything is typed it offers the people you have most
 * calls with and your newest notes. Typing finds what was said, call by call, with Ask first and the people whose names
 * have the words; a question lights Ask, and Enter asks every note you have. On a wide screen the lit row shows beside the
 * list. The pin beside the side panel's Pinned opens the same window, narrow, to pick notes to pin.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { searched } from '../../../src/api/trouble';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { quietGuest, troubled } from '../changes';

const meta = { title: 'Pages/Home/Search or ask', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Context = Parameters<Play>[0];
const SOON = { timeout: 8000 };
const QUESTION = 'When does onboarding ship?';

const line = () => screen.findByRole('combobox', { name: /Search or ask your notes/ }, SOON);
/** The option named `name` once it's there, as a row of what was found. */
const found = (name: RegExp) => screen.findByRole('option', { name }, SOON);
/** Waits until the lit row (the line's active option) is the one named `name`. */
const lit = (name: RegExp) => waitFor(async () => {
  const id = (await line()).getAttribute('aria-activedescendant');
  const row = id ? document.getElementById(id) : null;
  if (!row || !name.test(row.textContent ?? '')) throw new Error(`The lit row isn’t ${String(name)} yet.`);
}, SOON);

/** Search or ask at the top right (the magnifier in a phone's top bar) opens the window over the page. */
const open = async ({ userEvent, step }: Context): Promise<void> => {
  await step('Click Search or ask at the top right, or press ⌘K (Ctrl+K off a Mac)', async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Search or ask' }, SOON));
    await line();
  });
};
/** Opens the window, types `text` and waits for `then`. */
const typing = (text: string, said: string, then?: (c: Context) => Promise<unknown>): Play => async (c) => {
  await open(c);
  await c.step(said, async () => {
    await c.userEvent.type(await line(), text);
    await then?.(c);
  });
};
/** Types a name, and makes them the token with Enter: everything they said. */
const theirs = (then?: (c: Context) => Promise<unknown>): Play => async (c) => {
  await typing('maya', 'Type “maya”. Maya comes first, lit, under Ask', () => lit(/Maya Chen/))(c);
  await c.step('Press Enter: Maya goes in the line, and the list is what she said', async () => {
    await c.userEvent.keyboard('{Enter}');
    await screen.findByRole('listbox', { name: 'What Maya said' }, SOON);
    await then?.(c);
  });
};

/** Before anything's typed: the five people you have most calls with, then your newest notes, the newest lit beside them. */
export const BeforeTyping = page('/home', 'busy', { play: open });
/** A name: Ask first, then Maya, lit, then every moment she spoke, call by call. Beside the list, what she said last. */
export const AName = page('/home', 'busy', { play: typing('maya', 'Type “maya”', () => lit(/Maya Chen/)) });
/** Enter on Maya: she's in the line, and the list is everything she said, newest call first, three moments to a call. */
export const SomeonesWords = page('/home', 'busy', { play: theirs() });
/** Narrowed with a word: what Maya said about the flag, the moment lit in its transcript beside the list. */
export const NarrowedWithAWord = page('/home', 'busy', {
  play: theirs(async (c) => {
    await c.userEvent.type(await line(), 'flag');
    await found(/Keep the monthly option behind a flag/);
  })
});
/** Someone who said nothing you can read: Theo sat in on the design review. In the line, the list says so, and Calls with Theo opens Notes. */
export const SomeoneWhoSaidNothing = page('/home', 'busy', {
  beforeEach: changing(quietGuest),
  play: typing('theo', 'Type “theo”, and press Enter on Theo, who sat in on the design review and said nothing', async (c) => {
    await lit(/Theo Martin/);
    await c.userEvent.keyboard('{Enter}');
    await screen.findByText('Nothing Theo said is in your notes', {}, SOON);
  })
});
/** A word: every moment it was said, call by call, who said it and when, Decision or Follow-up where one rests on it. */
export const AWord = page('/home', 'busy', { play: typing('flag', 'Type “flag”', () => found(/Agreed\. Put it behind a flag/)) });
/** ↓ to a line a decision rests on: the decision shows beside it, still waiting, with Confirm and It wasn't decided. */
export const ADecisionLit = page('/home', 'busy', {
  play: typing('flag', 'Type “flag”, and press ↓ twice to the moment the onboarding date was set', async (c) => {
    await found(/new onboarding ships behind a flag/);
    await c.userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await lit(/new onboarding ships behind a flag/);
  })
});
/**
 * Play from 3:15, beside that moment: the note opens there and plays, once. Back and forward again open it there, still.
 * A wide screen's, since Play from is in the preview beside the list.
 */
export const PlayFrom = page('/home', 'busy', {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: typing('flag', 'Type “flag”, press ↓ twice to the moment the onboarding date was set, and press Play from 3:15', async (c) => {
    await found(/new onboarding ships behind a flag/);
    await c.userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await lit(/new onboarding ships behind a flag/);
    await c.userEvent.click(await screen.findByRole('link', { name: /Play from 3:15/ }, SOON));
    await screen.findByRole('heading', { name: 'Team standup', level: 1 }, SOON);
  })
});
/** A question lights Ask: Enter asks every note you have, and Tab asks whatever's typed. */
export const AQuestion = page('/home', 'busy', { play: typing(QUESTION, 'Type a question', () => lit(/^Ask/)) });
/** Asking: reading your notes, in confidential compute, with the question beside it. */
export const Asking = page('/home', 'busy', {
  beforeEach: changing(troubled({ 'notes.askAll': 'hold' })),
  play: typing(`${QUESTION}{Enter}`, 'Type a question, and press Enter', () => screen.findByText('Reading your notes', {}, SOON))
});
/** Answered: the answer, and the moments it comes from under their calls, the first lit beside it. */
export const Answered = page('/home', 'busy', {
  play: typing(`${QUESTION}{Enter}`, 'Type a question, and press Enter', () => screen.findByRole('listbox', { name: 'From your notes' }, SOON))
});
/**
 * Asked with none of this period's notes left: the server refuses the question, and the answer's place says until when there
 * are none, with Get Pro (user-flows 16.10). Typing again puts it away.
 */
export const AskWithNoNotesLeft = page('/home', 'plan-stopped', {
  play: typing(`${QUESTION}{Enter}`, 'Type a question, and press Enter, with no notes left this period', () => screen.findByText(/^No notes left until/, {}, SOON))
});
/** Nothing has the word: it says what it looked through, with Ask lit above it. */
export const NothingMatches = page('/home', 'busy', { play: typing('cake', 'Type “cake”', () => screen.findByText('Nothing matches “cake”', {}, SOON)) });
/** The search didn't go through: Try again, or ask instead. */
export const Failed = page('/home', 'busy', {
  beforeEach: changing(troubled({ 'notes.list': (query) => (searched(query) ? 'failed' : null) })),
  play: typing('flag', 'Type “flag”', () => screen.findByText('The search didn’t go through', {}, SOON))
});
/** Offline: search needs a connection, and works again as soon as it's back. */
export const Offline = page('/home', 'offline', {
  play: typing('flag', 'Type “flag”', async () => within(await screen.findByRole('dialog', { name: 'Search or ask' }, SOON)).findByText('You’re offline', {}, SOON))
});
/** The first day: nothing to search yet. */
export const FirstDay = page('/home', 'first-day', { play: async (c) => { await open(c); await screen.findByText('Nothing to search yet', {}, SOON); } });

/** On a phone the window takes the screen, with Cancel, and nothing beside the list. */
export const BeforeTypingPhone = phone(BeforeTyping, 'Before typing, on a phone');
export const AWordPhone = phone(AWord, 'A word, on a phone');
export const AnsweredPhone = phone(Answered, 'Answered, on a phone');
export const AskWithNoNotesLeftPhone = phone(AskWithNoNotesLeft, 'Ask with no notes left, on a phone');

/** The pin beside Pinned, in the side panel: a wide screen's, since a phone has no side panel. */
const pinning = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: (async ({ canvas, userEvent, step }) => {
    await step('Press the pin beside Pinned, in the side panel', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Pin a note' }, SOON));
      await screen.findByRole('combobox', { name: 'Find a note to pin' }, SOON);
    });
  }) satisfies Play
};
/** Pick notes to pin, up to eight. */
export const Pinning = page('/home', 'busy', pinning);
/** Eight are pinned already: it says to unpin one first. */
export const PinningWithEightPinned = page('/home', 'lots', pinning);
