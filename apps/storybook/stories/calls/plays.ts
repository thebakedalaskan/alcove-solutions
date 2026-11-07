/*
 * What the call stories' plays share, pressed as a person presses it in the call: Board's picker and what it opens, what's on
 * your stage in its frame (its bar's Present, Follow, Close and name menu, and Close's question), what's presented as a tile
 * with the people, Share's steps, and a toast that says something and then goes. Popovers, sheets and toasts open outside the
 * story's root, so everything is found through `screen`, by its role and its name.
 */
import { screen, waitFor, within } from 'storybook/test';
import { MORE } from '../../src/call';
import type { PageStory } from '../../src/page';

export type Play = NonNullable<PageStory['play']>;
export type Context = Parameters<Play>[0];
/** For what the last press opens. */
export const SOON = { timeout: 10000 };
/** Long enough for the script to get there: someone presenting, a board opening and filling. */
export const LATER = { timeout: 40000 };

const pause = (ms: number) => new Promise<void>((done) => { setTimeout(done, ms); });
/** A menu takes no press until its rows have been still for a moment, so what's under the pointer is what someone aimed at. */
export const settle = () => pause(500);
/** Words in a pattern, as they're written. */
const exactly = (words: string) => words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A button whose name starts with these words: a row says more under its name. */
export const startingWith = (words: string) => new RegExp(`^${exactly(words)}`);

/**
 * Your side put away, as the canvas has it. A call opens Notes beside the stage by itself on a wide screen while notes are on, a
 * moment after the call shows, so this waits a moment for it.
 */
export const sideAway: Play = async ({ canvas, userEvent, step }) => {
  await step('Put your side away', async () => {
    await canvas.findByRole('toolbar', { name: 'Call controls' }, SOON);
    if (window.innerWidth < 1100) return;
    const side = await canvas.findByRole('button', { name: /^Close (Notes|Chat|People)$/ }, { timeout: 3000 }).catch(() => null);
    if (side) await userEvent.click(side);
  });
};

/* ---------- Board, at the top right ---------- */

/** Board, at the top right, or at the top of More on a phone: the board picker, under it. */
export async function boardPicker({ canvas, userEvent }: Context): Promise<HTMLElement> {
  // In the call, with its top bar: the faces are at its right on any screen.
  await canvas.findByRole('button', { name: /^People in this call/ }, LATER);
  const [top] = canvas.queryAllByRole('button', { name: 'Board' });
  if (top) await userEvent.click(top);
  else {
    await userEvent.click(await canvas.findByRole('button', { name: MORE }, SOON));
    await userEvent.click(await screen.findByRole('button', { name: 'Board' }, SOON));
  }
  return screen.findByRole('dialog', { name: 'Open a board' }, SOON);
}
/** A row of the board picker, once it's there and the rows are still: the board in this call, or one of your team's. */
export async function pickBoard(c: Context, name: string): Promise<void> {
  const picker = await boardPicker(c);
  const row = await within(picker).findByRole('button', { name: startingWith(name) }, LATER);
  // Your team's boards come in a moment after it opens (a guest and a breakout room have none): the rows move as they do.
  await within(picker).findByText('Your team’s boards', {}, { timeout: 3000 }).catch(() => null);
  await settle();
  await c.userEvent.click(row);
}
/** The board in this call, from Board's picker: on your stage, just for you. */
export async function openCallBoard(c: Context, name: string): Promise<void> {
  await pickBoard(c, name);
  await frameOf(name);
}

/* ---------- what's on your stage ---------- */

/** What's on your stage, in its frame: its name, then whether only you see it or everyone does. */
export const frameOf = (name: string) => screen.findByRole('region', { name: new RegExp(`^${exactly(name)}, (only you|everyone) see`) }, LATER);
/** A button on a frame's bar. */
export async function onTheBar(c: Context, frame: string, button: string | RegExp): Promise<void> {
  const it = await frameOf(frame);
  await c.userEvent.click(await within(it).findByRole('button', { name: button }, LATER));
}
/** Present, on the bar of a board or the workspace open just for you. */
export const present = (c: Context, frame: string) => onTheBar(c, frame, 'Present');
/** Close, on a frame's bar: it closes, or while you present it, it asks for you or for everyone. */
export const close = (c: Context, frame: string) => onTheBar(c, frame, `Close ${frame}`);
/** Close's question, while you present: "For you" or "For everyone". */
export async function closeFor(c: Context, frame: string, who: 'For you' | 'For everyone'): Promise<void> {
  const ask = await screen.findByRole('dialog', { name: `Close ${frame}` }, SOON);
  await c.userEvent.click(within(ask).getByRole('button', { name: startingWith(who) }));
}
/** The frame's name, which opens its menu: the first thing so named in it, as the workspace's list can be named the same. */
export async function frameMenu(c: Context, frame: string): Promise<HTMLElement> {
  const it = await frameOf(frame);
  const [name] = await within(it).findAllByRole('button', { name: frame }, SOON);
  if (name) await c.userEvent.click(name);
  return screen.findByRole('dialog', { name: frame }, SOON);
}
/** What someone presents while it isn't on your stage: its tile with the people, which takes you there. */
export const tileOf = (name: string) => screen.findByRole('button', { name: new RegExp(`^(Join|Go back to) ${exactly(name)}$`) }, LATER);

/* ---------- Share, in the dock ---------- */

/** Share, in the dock: "Share with everyone", over it. */
export async function shareMenu({ canvas, userEvent }: Context): Promise<HTMLElement> {
  await userEvent.click(await canvas.findByRole('button', { name: /^(Share|Presenting)$/ }, SOON));
  return screen.findByRole('dialog', { name: 'Share with everyone' }, SOON);
}
/** One of Share's rows: Your screen, A board or The workspace. */
export async function shareKind(c: Context, kind: 'Your screen' | 'A board' | 'The workspace'): Promise<HTMLElement> {
  const menu = await shareMenu(c);
  await c.userEvent.click(within(menu).getByRole('button', { name: startingWith(kind) }));
  return menu;
}
/** Share › Your screen › A tab › Share: the browser's made-up screen goes out, a tab of it. */
export async function shareATab(c: Context): Promise<void> {
  const menu = await shareKind(c, 'Your screen');
  await c.userEvent.click(await within(menu).findByRole('button', { name: 'A tab' }, SOON));
  await c.userEvent.click(within(menu).getByRole('button', { name: 'Share' }));
}

/* ---------- toasts ---------- */

/** A toast that says this, once it's said. */
export const toldThat = (words: string | RegExp, o = LATER) => screen.findByText(words, {}, o);
/** It's said, and then it goes by itself after its time: gone, and still gone a moment later, as the corner it's in can move. */
export async function toldThenGone(words: string): Promise<void> {
  await toldThat(words);
  const gone = () => waitFor(() => { if (screen.queryByText(words)) throw new Error(`“${words}” is still up.`); }, { timeout: 15000 });
  await gone();
  await pause(1000);
  await gone();
}
