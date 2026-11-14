/*
 * More on a board in the call (user-flows 6, A board in the call › More). Beside the tools: a picture from this computer, kept
 * in the board's own files; something from the board's workspace, named as you know it; a table, typed a cell at a time; a
 * mind map; a comment on what's picked; and a template beside what's there. In the bar: Copy link, Download as an image, Download as a PDF and Night
 * board. You're Art in the launch review, held in Product; Priya opens the launch retro a second in, saved in Product beside
 * the launch plan, you open it from Board's In this call, and the review fills it as it talks.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { drawnPicture } from '../../../src/api/media';
import { at, opensBoard, type Present } from '../../../src/api/call/script';
import { inCall, phone, plays } from '../../../src/call';
import { pages, type PageArgs, type PageStory } from '../../../src/page';
import { retroWith } from './retro';
import { openCallBoard } from '../plays';
import { AIKO, KOFI, LAUNCH_REVIEW, PRIYA, REVIEW_TALK } from '../talk';

const meta = { title: 'Calls/Boards/More on a board', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Context = Parameters<Play>[0];
const SOON = { timeout: 10000 };
const LATER = { timeout: 40000 };
const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/** Board, then the board in this call: on your stage, only on your screen. */
const onTheBoard: Play = async (c) => {
  await c.step('Press Board, then the retro in this call: it opens on your screen', async () => { await openCallBoard(c, 'Launch review'); });
};
/** The launch review with the launch retro open and four stickies on it, and what the story does with More. */
const withBoard = (play: Play, more: Omit<PageStory, 'args' | 'play'> = {}): PageStory => inCall({
  scenario: 'busy', call: LAUNCH_REVIEW, script: { here: REVIEWERS, notes: 'off', talk: { lines: REVIEW_TALK, every: 6 }, board: retroWith(4), cues: at(1, opensBoard(PRIYA, 'retro')) }
}, { ...more, play: plays(onTheBoard, play) });
/** The board's name on its frame: the call's, as a new board is named. */
const named = () => screen.findByRole('button', { name: 'Launch review' }, LATER);
const pause = (ms: number) => new Promise((done) => { setTimeout(done, ms); });

/** More beside the tools, once the board's open. */
async function openMore({ userEvent }: Context): Promise<HTMLElement> {
  await named();
  await userEvent.click(await screen.findByRole('button', { name: /^More: images/ }, SOON));
  const image = await screen.findByRole('button', { name: 'Image' }, SOON);
  const flyout = image.closest('.bfly');
  if (!(flyout instanceof HTMLElement)) throw new Error('More’s items aren’t open.');
  return flyout;
}
/** One of More's items, beside the tools. */
async function pick(c: Context, name: string): Promise<void> {
  const flyout = await openMore(c);
  await c.userEvent.click(within(flyout).getByRole('button', { name }));
}
/** One of the bar's More, a moment after it opens, as its rows settle. */
async function fromTheBar({ userEvent }: Context, name: string | RegExp): Promise<void> {
  await named();
  await userEvent.click(await screen.findByRole('button', { name: 'More' }, SOON));
  await pause(500);
  await userEvent.click(await screen.findByRole('button', { name }, SOON));
}

/** More beside the tools: a picture, something from the workspace, a table, a mind map, a comment and a template. */
export const More = withBoard(async (c) => {
  await c.step('Press More, at the foot of the tools', async () => { await openMore(c); });
});

/** A picture from this computer: kept in the board's own files, sealed as the board is, and in the middle of your view on nothing else. */
export const AnImage = withBoard(async (c) => {
  await c.step('Press More, then Image, and choose a picture', async () => {
    await pick(c, 'Image');
    const field = await screen.findByLabelText('A picture to put on the board', {}, SOON);
    const picture = new File([await drawnPicture('Offsite whiteboard', 205, 1600, 1000)], 'Offsite whiteboard.png', { type: 'image/png' });
    await c.userEvent.upload(field, picture);
  });
  await c.step('It lands where you’re looking, for everyone', async () => {
    await waitFor(() => { if (!document.querySelector('.bo.k-img img')) throw new Error('The picture isn’t on the board yet.'); }, LATER);
  });
});

/** From your workspace: what you can open in the board's workspace, the board aside. Each person sees it by their own name for it, or that they can't open it. */
export const FromYourWorkspace = withBoard(async (c) => {
  await c.step('Press More, then From your workspace', async () => { await pick(c, 'From your workspace'); });
  await c.step('Press Launch plan: it’s on the board, and opens from there for whoever can open it', async () => {
    await c.userEvent.click(await screen.findByRole('menuitem', { name: 'Launch plan' }, LATER));
    await screen.findByRole('button', { name: 'Open Launch plan' }, SOON);
  });
});

/** A table: three by three where you're looking, its first cell open. Tab goes along a row and on to the next. */
export const ATable = withBoard(async (c) => {
  await c.step('Press More, then Table, and type its heads with Tab between them', async () => {
    await pick(c, 'Table');
    await c.userEvent.keyboard('Owner{Tab}Due{Tab}Status{Tab}Priya{Tab}Friday{Tab}Started');
  });
  await c.step('Esc when you’re done. A row and a column are a press away while it’s picked', async () => {
    await c.userEvent.keyboard('{Escape}');
  });
});

/** A mind map: an idea where you're looking. Tab branches from it, Enter adds another beside it. */
export const AMindMap = withBoard(async (c) => {
  await c.step('Press More, then Mind map, and type the idea it starts from', async () => {
    await pick(c, 'Mind map');
    await c.userEvent.keyboard('Launch');
  });
  await c.step('Tab branches from it; Enter adds another branch beside that', async () => {
    await c.userEvent.keyboard('{Tab}Pricing{Enter}Press{Enter}Support');
  });
  await c.step('Esc when you’re done', async () => { await c.userEvent.keyboard('{Escape}'); });
});

/**
 * Comment (also K): on the sticky picked, or with nothing picked, on the next thing pressed. Your face pins to its corner, and
 * everyone in the call sees it, named as the board's workspace knows you.
 */
export const AComment = withBoard(async (c) => {
  await c.step('Pick a sticky, then press More, then Comment', async () => {
    await named();
    await c.userEvent.click(await screen.findByText('Nobody owned the status page', {}, LATER));
    await pick(c, 'Comment');
  });
  await c.step('Say something, and Enter: your face pins to its corner', async () => {
    await c.userEvent.click(await screen.findByRole('textbox', { name: 'Comment' }, SOON));
    await c.userEvent.keyboard('Worth a line in the runbook{Enter}');
    await screen.findByRole('button', { name: /^Comment from Art/ }, SOON);
  });
});

/** Templates: Retro, Ideas, Flow, and What, why, next, put beside what's on the board with frames of their own. */
export const Templates = withBoard(async (c) => {
  await c.step('Press More, then Templates', async () => { await pick(c, 'Templates'); });
  await c.step('Press Ideas: it goes beside the retro, for everyone', async () => {
    await c.userEvent.click(await screen.findByRole('menuitem', { name: 'Ideas' }, SOON));
  });
});

/** The bar's More: Copy link, Download as an image and Download as a PDF, which whoever can only look has too, and Night board. */
export const TheBarsMore = withBoard(async (c) => {
  await c.step('Press More, at the end of the board’s bar', async () => {
    await named();
    await c.userEvent.click(await screen.findByRole('button', { name: 'More' }, SOON));
  });
});

/** On a phone the bar keeps its More, for all four. */
export const TheBarsMorePhone = phone(TheBarsMore);

/** Copy link: the board's address, which opens it for whoever can open it. */
export const CopyLink = withBoard(async (c) => {
  await c.step('Press More, then Copy link', async () => { await fromTheBar(c, 'Copy link'); });
});

/** Download as an image: your board as you see it, every document named as you know it, saved here. A PDF is the same picture on a page. */
export const DownloadAsAnImage = withBoard(async (c) => {
  await c.step('Press More, then Download as an image', async () => { await fromTheBar(c, 'Download as an image'); });
});

/** Night board on: a toast says what changed and for whom, and More shows it ticked, as the frame's name menu does. */
const nightOn: Play = async (c) => {
  await c.step('Press More, then Night board: the board goes dark for everyone, whatever their theme, and a toast says so', async () => {
    await fromTheBar(c, 'Night board');
    await screen.findByText('Night board is on. The board is dark for everyone, whatever their theme.', {}, SOON);
  });
  await c.step('More again: Night board has its tick while it’s on', async () => {
    await c.userEvent.click(await screen.findByRole('button', { name: 'More' }, SOON));
    await screen.findByRole('button', { name: 'Night board', pressed: true }, SOON);
  });
};
/**
 * Night board: the board's own setting. It's a dark board in any theme, a dark board by day, for everyone and everywhere it
 * shows, ticked in More until it's pressed again. In a light theme the sheet goes dark.
 */
export const NightBoard = withBoard(nightOn, { globals: { theme: 'light' } });
export const NightBoardPhone = phone(NightBoard);
/**
 * In a dark theme your own board is already dark, so nothing on your screen moves: the toast is what says it changed the board
 * for everyone else, whatever their theme.
 */
export const NightBoardDark = withBoard(nightOn, { name: 'Night board, in a dark theme', globals: { theme: 'dark' } });
/** Pressed again: it's off, and the toast says the board follows each person's theme again. */
export const NightBoardOffAgain = withBoard(plays(nightOn, async (c) => {
  await c.step('Press Night board again: off, for everyone, and the toast says so', async () => {
    await pause(500);
    await c.userEvent.click(await screen.findByRole('button', { name: 'Night board', pressed: true }, SOON));
    await screen.findByText('Night board is off. The board follows each person’s theme.', {}, SOON);
  });
}), { name: 'Night board, off again', globals: { theme: 'dark' } });
