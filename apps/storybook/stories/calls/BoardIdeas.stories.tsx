/*
 * Ideas from the call, on a board in the call (user-flows 6, A board in the call › 9, and on a phone, 14). While notes are on,
 * the call picks out what people said that's worth a sticky, and a pill at the foot of the board says how many. Its tray
 * offers each with who said it and when, written in confidential compute: Add puts one on the board, in the frame it fits and
 * that frame's colour, and Add all puts the rest, with a toast whose Undo takes back what it added, whatever you've done
 * since. On a phone the tray adds just as + does, Undo and all. You're Art in the design review: Priya opens the launch retro
 * a second in, you open it from Board's In this call, the review fills it, and then the call hears three ideas
 * (stories/calls/boards.ts).
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at, opensBoard, type Present } from '../../src/api/script';
import { inCall, phone, plays } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { HEARD, RETRO, filledAfter } from './boards';
import { openCallBoard } from './plays';
import { AIKO, KOFI, PRIYA, REVIEW, REVIEW_TALK } from './talk';

const meta = { title: 'Calls/Ideas from the call', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Context = Parameters<Play>[0];
const SOON = { timeout: 10000 };
/** Long enough for the script to get there: the board opening and filling, and the call hearing what's worth a sticky. */
const LATER = { timeout: 40000 };
const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/** Board, then the board in this call: on your stage, only on your screen. */
const onTheBoard: Play = async (c) => {
  await c.step('Press Board, then the retro in this call: it opens on your screen', async () => { await openCallBoard(c, 'Design review'); });
};
/** The design review with notes on: Priya opens the launch retro, you open it, the review fills it, and the call hears three ideas. */
const heard = (play?: Play): PageStory => inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, notes: 'on', talk: { lines: REVIEW_TALK, every: 6 }, board: RETRO, cues: [...at(1, opensBoard(PRIYA, 'retro')), ...at(1 + filledAfter() + 1, HEARD)] }
}, { play: play ? plays(onTheBoard, play) : onTheBoard });

/** Press the pill at the foot of the board: the tray rises over it. */
async function openTray({ userEvent }: Context): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: '3 ideas from the call' }, LATER));
  await screen.findByRole('region', { name: 'Ideas from the call' }, SOON);
}
/** Add on the tray's first idea, Priya's: it says Added once it's on the board. */
async function addFirst({ userEvent }: Context): Promise<void> {
  const [first] = await screen.findAllByRole('button', { name: 'Add' }, SOON);
  if (first) await userEvent.click(first);
  await screen.findByRole('button', { name: 'Added' }, SOON);
}
/** The toast Add all says, and its Undo. */
async function undoAdded({ userEvent }: Context, said: string): Promise<void> {
  const toast = (await screen.findByText(said, {}, SOON)).closest('.ac-toast');
  if (toast instanceof HTMLElement) await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
}

/** The call has heard three ideas worth a sticky, and the pill says so quietly, at the foot of the board. */
export const ThePill = heard();
export const ThePillPhone = phone(ThePill);

/** The tray: each idea with who said it and when, and Add. Working on the board leaves it open. */
export const TheTray = heard(async (c) => {
  await c.step('Press 3 ideas from the call', async () => { await openTray(c); });
});

/** Add one: Priya's goes into Could improve, the frame it fits, in its colour, and says Added. Add both adds the other two. */
export const AddOne = heard(async (c) => {
  await c.step('Press 3 ideas from the call', async () => { await openTray(c); });
  await c.step('Press Add on Priya’s: it’s on the board, in Could improve', async () => { await addFirst(c); });
});
/** On a phone the tray adds just as + does: Add, and it's on the board, in Could improve. */
export const AddOnePhone = phone(AddOne);

/**
 * Add all three, then the toast's Undo: the three go again, and nothing else does, whatever you've done meanwhile. They went
 * from everyone's tray as they were added, so the pill doesn't come back for them.
 */
export const AddAllThenUndo = heard(async (c) => {
  await c.step('Press 3 ideas from the call', async () => { await openTray(c); });
  await c.step('Press Add all three: they land in the frames they belong in, one after another', async () => {
    await c.userEvent.click(await screen.findByRole('button', { name: 'Add all three' }, SOON));
  });
  await c.step('Press Undo on the toast: the three go, and nothing else does', async () => { await undoAdded(c, 'Added 3 stickies from the call.'); });
});
/** On a phone too: Add on one, Add both for the rest, and the toast's Undo takes those two back. */
export const AddAllThenUndoPhone: PageStory = {
  ...phone(AddAllThenUndo),
  play: plays(onTheBoard, async (c) => {
    await c.step('Tap 3 ideas from the call', async () => { await openTray(c); });
    await c.step('Tap Add on Priya’s, then Add both', async () => {
      await addFirst(c);
      await c.userEvent.click(await screen.findByRole('button', { name: 'Add both' }, SOON));
    });
    await c.step('Tap Undo on the toast: those two go, and Priya’s stays', async () => { await undoAdded(c, 'Added 2 stickies from the call.'); });
  })
};
