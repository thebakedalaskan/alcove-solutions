/*
 * A board's own page, in the workspace beside the list (user-flows 13): the launch retro with Priya and Kofi on it, as the
 * whiteboards canvas's page has it, and a board nobody has added to yet; then every way its seal can stand, from the canvas's
 * States board (Reconnecting, Couldn't save, View only, and a board you can't open any more), what's under its name and in
 * its seal, who can add to it, a comment, in Trash, at night and on a phone.
 */
import type { WorkspaceItem } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { itemId } from '../../src/api/scenarios';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import type { BoardSpec, World } from '../../src/world';
import { iso } from '../../src/world/clock';
import { ART, PRIYA } from '../../src/world/people';
import { SOON } from '../journeys/play';

const meta = { title: 'Pages/Board', ...pages } satisfies Meta<PageArgs>;
export default meta;

const RETRO_ID = itemId('Launch retro');
const RETRO = `/workspace/ws-product/${RETRO_ID}`;
const FLOW = `/workspace/ws-design/${itemId('Onboarding flow')}`;
const PHONE = { viewport: { value: 'phone' } };

/** The launch retro in Product, as the world has it, changed. */
function retro(w: World, item: Partial<WorkspaceItem>, board: Partial<BoardSpec> = {}): void {
  const product = w.workspaces.find((s) => s.id === 'ws-product');
  if (product) product.items = product.items.map((i) => (i.id === RETRO_ID ? { ...i, ...item } : i));
  w.boards[RETRO_ID] = { ...w.boards[RETRO_ID], ...board };
}
const standing = (s: NonNullable<BoardSpec['standing']>) => (w: World): void => retro(w, {}, { standing: s });
/** Art can only look at it: it was shared with him to read. */
const reading = (w: World): void => retro(w, { role: 'read' });
/** Priya moved it to Trash this afternoon. */
const trashed = (w: World): void => retro(w, { trashedAt: iso(0, 15, 40), trashedBy: PRIYA.name });

/** A board Art made a moment ago in Product: nobody has added anything to it. */
const BLANK_ID = itemId('Untitled board');
const blank = (w: World): void => {
  const product = w.workspaces.find((s) => s.id === 'ws-product');
  const at = iso(0, 16, 11);
  if (product) product.items = [...product.items, { id: BLANK_ID, kind: 'board', name: 'Untitled board', parent: null, by: ART.portrait ? { name: ART.name, portrait: ART.portrait } : null, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, role: 'edit' }];
  w.boards[BLANK_ID] = {};
};

/** Presses the board's name, in its bar: everything about the board itself is under it. */
const underTheName: PageStory['play'] = async ({ userEvent }) => {
  const board = await screen.findByRole('application', { name: 'Launch retro' }, SOON);
  await userEvent.click(await within(board).findByRole('button', { name: /^Launch retro/ }, SOON));
};

/** The launch retro, with Priya and Kofi on it: the board is the page, with its name and its seal at the top of it. */
export const ABoard = page(RETRO, 'busy');
/** A board nobody has added to yet: one line says how to start. */
export const Blank = page(`/workspace/ws-product/${BLANK_ID}`, 'busy', { beforeEach: changing(blank) });
/** The connection's gone: you keep working, and what you add goes when it's back. */
export const Reconnecting = page(RETRO, 'busy', { beforeEach: changing(standing('offline')) });
/** Alcove wouldn't take what was added here: it's only on this screen, and Try again sends it again. */
export const CouldntSave = page(RETRO, 'busy', { beforeEach: changing(standing('failed')) });
/** Shared with Art to read: the tools go, and he can still look round and follow people. */
export const ViewOnly = page(RETRO, 'busy', { beforeEach: changing(reading) });
/** Taken from Art while it was open: the page says he can't open it, the same as for a board that never was. */
export const NoAccess = page(RETRO, 'busy', { beforeEach: changing(standing('gone')) });
/** In Trash: it still opens, to look at, and Restore it brings it back. */
export const InTrash = page(RETRO, 'busy', { beforeEach: changing(trashed) });
/** Under its name: Rename, where it's saved, who can add to it, and Copy link. */
export const UnderItsName = page(RETRO, 'busy', { play: underTheName });
/** Who can add to it: the workspace's own share sheet. */
export const WhoCanAddToIt = page(RETRO, 'busy', {
  play: async (ctx) => {
    await underTheName(ctx);
    await ctx.userEvent.click(await screen.findByRole('button', { name: 'Who can add to it' }, SOON));
  }
});
/** Its seal says what's true of it. */
export const TheSeal = page(RETRO, 'busy', {
  play: async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: 'Sealed' }, SOON)); }
});
/** A comment on a sticky: Maya's face on its corner, and the thread beside it. */
export const AComment = page(RETRO, 'busy', {
  play: async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: 'Comment from Maya Chen' }, SOON)); }
});
/** The onboarding flow in Design, where Art edits. */
export const AFlow = page(FLOW, 'busy');
export const Night = page(RETRO, 'busy', { globals: { theme: 'dark' } });
export const NightReconnecting = page(RETRO, 'busy', { beforeEach: changing(standing('offline')), globals: { theme: 'dark' } });
export const Phone = page(RETRO, 'busy', { globals: PHONE });
export const PhoneUnderItsName = page(RETRO, 'busy', { globals: { ...PHONE, theme: 'dark' }, play: underTheName });
