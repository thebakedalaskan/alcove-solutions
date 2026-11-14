/**
 * What More puts on a board, through browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres, the
 * object store and the local LiveKit server, with @alcove/board making every change the way the board's surface makes it: a
 * table's cells, there from the start, which two people can type in at once, a picture kept in the board's own files and read through it, a
 * template beside what's there, Night board, which is the board's own setting, a comment written in a call, which names its
 * writer as the board's workspace knows them, and what a download of a board says, which is only what its reader can see.
 */
import { AlcoveApiError, type CallSession, type CallState, type DocSession, type DocSessionOptions, type ItemKind, type WorkspaceRole, type WorkspaceTree } from '@alcove/api';
import {
  CANT_OPEN, addObject, addReply, addTableLine, addTemplate, addThread, bindCell, boardNight, boardScene, cellKey, hasBox, makeHistory, newId, objectText, readBoard, readThreads, sceneWords, setNight,
  type Box, type NewObject
} from '@alcove/board';
import { resolveObjectURL } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { startHarness, type Browser, type Harness } from '../../../testing/harness';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => {
  // Pictures outlive a run in the bucket, and whatever reads all of it next pays for each one left.
  if (h) for await (const o of h.objects.list()) await h.objects.delete(o.id);
  await h?.close();
});
afterEach(() => h.closeCalls());

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string };
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name };
}
const madeUp = () => randomBytes(16).toString('base64url');
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AlcoveApiError ? { code: e.code, message: e.message, status: e.status } : { code: 'not-an-api-error', message: String(e), status: 0 }));
const code = async (p: Promise<unknown>) => (await refusal(p))?.code ?? 'allowed';
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await rest(15);
  }
}
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const make = async (who: Account, id: string, name: string, kind: ItemKind = 'board') => (await who.api.workspaces.items.create(id, { kind, name, parent: null })).id;

/* ---------- a browser at a board ---------- */

/** A tab with a board open: its session, and the origin its writes go under, as the surface's own. */
interface Tab { s: DocSession; doc: Y.Doc; me: object }
async function open(who: Browser, id: string, board: string, opts: DocSessionOptions = {}): Promise<Tab> {
  const s = await who.api.workspaces.document(id, board, opts);
  await s.ready;
  return { s, doc: s.doc, me: {} };
}
const saved = (t: Tab) => until(() => t.s.getSnapshot().status === 'saved', 'everything to reach Alcove');
/** Everything on a board as it reads, in drawing order: what two people must agree on. */
const shown = (t: { doc: Y.Doc }) => JSON.stringify(readBoard(t.doc).objects);
const agree = async (tabs: Tab[], what: string) => {
  const [one, ...others] = tabs;
  if (one) await until(() => others.every((t) => shown(t) === shown(one)), what);
};
function add(t: Tab, input: NewObject): string {
  const id = addObject(t.doc, input, t.me);
  if (!id) throw new Error(`a ${input.k} wasn’t added`);
  return id;
}
const sticky = (t: Tab, words: string, x = 0, y = 0) => add(t, { k: 'note', x, y, w: 150, h: 150, c: 'butter', size: 'm', t: words });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/* ---------- a cell, as the surface types in one ---------- */

/**
 * Someone typing in a table's cell, as the board's field does it: on the cell's text, which the table has from the start, and
 * if another browser's text for the same cell wins, as it can where a cell was missing, what they type goes into that one from then on.
 */
interface Typing { text: Y.Text | null; rebound: number; stop: () => void }
function focus(t: Tab, table: string, row: string, col: string): Typing {
  const typing: Typing = { text: null, rebound: 0, stop: () => undefined };
  typing.stop = bindCell(t.doc, table, row, col, t.me, (text) => {
    if (typing.text && text !== typing.text) typing.rebound += 1;
    typing.text = text;
  });
  return typing;
}
/** Types a few letters at a time into whichever text the field is on now, one transaction each, as keystrokes are. */
function keys(t: Tab, typing: Typing, words: string): void {
  for (const letter of words) {
    const text = typing.text;
    if (!text) throw new Error('nothing to type in');
    t.doc.transact(() => text.insert(text.length, letter), t.me);
  }
}
/** A table's stored cells, by key, as a browser has them. */
const cellsIn = (t: Tab, table: string): Y.Map<unknown> | null => {
  const m = t.doc.getMap('objects').get(table);
  const cells = m instanceof Y.Map ? m.get('cells') : null;
  return cells instanceof Y.Map ? cells : null;
};
/** The cell's words as a browser has them, and its text, which is the same everywhere once they've synced. */
const cellOf = (t: Tab, table: string, row: string, col: string) => {
  const text = cellsIn(t, table)?.get(cellKey(row, col));
  return text instanceof Y.Text ? text : null;
};
const tableAt = (t: Tab, cols: number, rows: number) => {
  const r = Array.from({ length: rows }, () => ({ id: newId(), size: 48 }));
  const c = Array.from({ length: cols }, () => ({ id: newId(), size: 160 }));
  const id = add(t, { k: 'table', x: 0, y: 0, w: cols * 160, h: rows * 48, rows: r, cols: c, cells: {} });
  return { id, rows: r.map((x) => x.id), cols: c.map((x) => x.id) };
};
/** Whether a browser has a text for every cell of these rows and columns. */
const everyCell = (t: Tab, table: string, rows: readonly string[], cols: readonly string[]) => rows.every((r) => cols.every((c) => cellOf(t, table, r, c) !== null));

describe('a table', () => {
  it('has a text for every cell from the start, so whoever types in one types in the one everyone has, and focusing makes nothing', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit']]);
    const board = await make(art, id, 'Planning');
    const [a, k] = await Promise.all([open(art, id, board), open(kofi, id, board)]);
    const { id: table, rows, cols } = tableAt(a, 3, 2);
    const [row, col] = [rows[1] ?? '', cols[2] ?? ''];
    await agree([a, k], 'the table to reach Kofi');
    // Every cell is there for Kofi before anyone has been near it, empty: they came with the table.
    expect(everyCell(k, table, rows, cols)).toBe(true);
    expect(cellOf(k, table, row, col)?.toString()).toBe('');
    // An empty cell reads as nothing, as ever.
    expect(readBoard(k.doc).byId.get(table)).toMatchObject({ k: 'table', cells: {} });

    // Focusing it writes nothing: Art's field is on the cell everyone has.
    const before = Y.encodeStateVector(a.doc);
    const hers = focus(a, table, row, col);
    expect(Y.encodeStateVector(a.doc)).toEqual(before);
    expect(hers.text?.toString()).toBe('');

    // Kofi comes to it, and they type at once: into the same text, so nothing either types is lost.
    const his = focus(k, table, row, col);
    expect(his.text).toBe(cellOf(k, table, row, col));
    keys(a, hers, 'Freeze ');
    keys(k, his, 'Monday');
    await agree([a, k], 'the cell to settle');
    const words = cellOf(a, table, row, col)?.toString() ?? '';
    expect(words).toHaveLength('Freeze Monday'.length);
    expect(words).toContain('Freeze');
    expect(words).toContain('Monday');
    expect(hers.rebound + his.rebound).toBe(0);
    expect(readBoard(k.doc).objects.find((o) => o.id === table)).toMatchObject({ k: 'table', cells: { [cellKey(row, col)]: words } });
    hers.stop();
    his.stop();
  });

  it('keeps everything two people type into one empty cell they start in at the same moment', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit']]);
    const board = await make(art, id, 'Planning');
    const [a, k] = await Promise.all([open(art, id, board), open(kofi, id, board)]);
    const { id: table, rows, cols } = tableAt(a, 2, 2);
    const [row, col] = [rows[0] ?? '', cols[0] ?? ''];
    await agree([a, k], 'the table to reach Kofi');

    // Both start typing in the empty cell before either browser has heard of the other: both are in the one text.
    const hers = focus(a, table, row, col);
    const his = focus(k, table, row, col);
    keys(a, hers, 'Monday');
    keys(k, his, 'Friday');
    await agree([a, k], 'the cell to settle');
    const settled = cellOf(a, table, row, col)?.toString() ?? '';
    expect(settled).toHaveLength('MondayFriday'.length);
    expect(settled).toContain('Monday');
    expect(settled).toContain('Friday');
    expect(hers.rebound + his.rebound).toBe(0);

    // And so is everything they type after.
    keys(a, hers, ' freeze');
    keys(k, his, ' launch');
    await agree([a, k], 'the cell to settle again');
    const words = cellOf(k, table, row, col)?.toString() ?? '';
    expect(words).toContain(' freeze');
    expect(words).toContain(' launch');
    expect(words).toHaveLength(settled.length + ' freeze'.length + ' launch'.length);

    // It's the board's: a browser opening it afterwards reads the same, from what reached Alcove.
    await Promise.all([saved(a), saved(k)]);
    const later = await open(art, id, board);
    expect(readBoard(later.doc).objects.find((o) => o.id === table)).toMatchObject({ cells: { [cellKey(row, col)]: words } });
    hers.stop();
    his.stop();
  });

  it('brings a new row’s cells and a new column’s with them, and makes the one where two added at once cross as someone starts in it', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit']]);
    const board = await make(art, id, 'Planning');
    const [a, k] = await Promise.all([open(art, id, board), open(kofi, id, board)]);
    const { id: table, rows, cols } = tableAt(a, 2, 2);
    await agree([a, k], 'the table to reach Kofi');
    // Art adds a row and Kofi a column at the same moment, neither knowing of the other's.
    const row = addTableLine(a.doc, table, 'rows', 2, 48, a.me);
    const col = addTableLine(k.doc, table, 'cols', 2, 160, k.me);
    if (!row || !col) throw new Error('a line wasn’t added');
    expect(everyCell(a, table, [...rows, row], cols)).toBe(true);
    expect(everyCell(k, table, rows, [...cols, col])).toBe(true);
    await agree([a, k], 'the lines to settle');
    await until(() => [a, k].every((t) => everyCell(t, table, [...rows, row], cols) && everyCell(t, table, rows, [...cols, col])), 'each line’s cells to reach the other');
    // Where they cross, neither made a cell: the first to start in it makes it, and whoever comes next is in that one.
    expect(cellOf(a, table, row, col)).toBeNull();
    const his = focus(k, table, row, col);
    keys(k, his, 'Owner');
    await agree([a, k], 'the crossing cell to reach Art');
    const hers = focus(a, table, row, col);
    expect(hers.text).toBe(cellOf(a, table, row, col));
    keys(a, hers, 's');
    await agree([a, k], 'the cell to settle');
    expect(readBoard(a.doc).byId.get(table)).toMatchObject({ k: 'table', cells: { [cellKey(row, col)]: 'Owners' } });
    hers.stop();
    his.stop();
  });

  it('can be typed in when it’s a table from before cells came with their rows and columns: its cells are made as someone first starts in one', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit']]);
    const board = await make(art, id, 'Planning');
    const [a, k] = await Promise.all([open(art, id, board), open(kofi, id, board)]);
    const { id: table, rows, cols } = tableAt(a, 3, 2);
    // A table as the previous release wrote one: its rows and columns, and no cells until someone wrote in one.
    a.doc.transact(() => {
      const cells = cellsIn(a, table);
      for (const key of [...(cells?.keys() ?? [])]) cells?.delete(key);
    }, null);
    await agree([a, k], 'the table to reach Kofi');
    // Empty cells read as nothing, so it's the stored cells that say what Kofi has heard.
    await until(() => cellsIn(k, table)?.size === 0, 'the table without its cells to reach Kofi');
    const [row, col] = [rows[1] ?? '', cols[0] ?? ''];
    // Art starts in one: every cell it's missing is made then, the same for everyone once it's heard.
    const hers = focus(a, table, row, col);
    expect(everyCell(a, table, rows, cols)).toBe(true);
    await until(() => everyCell(k, table, rows, cols), 'its cells to reach Kofi');
    const his = focus(k, table, row, col);
    expect(his.text).toBe(cellOf(k, table, row, col));
    keys(a, hers, 'Due ');
    keys(k, his, 'Friday');
    await agree([a, k], 'the cell to settle');
    const words = cellOf(a, table, row, col)?.toString() ?? '';
    expect(words).toContain('Due');
    expect(words).toContain('Friday');
    expect(words).toHaveLength('Due Friday'.length);
    hers.stop();
    his.stop();
  });
});

/* ---------- pictures ---------- */

const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 300 && !pred(call.getSnapshot()); i++) { await call.refresh(); await rest(30); }
  return call.getSnapshot();
}
/** A call `org` hosts in `home`, with `invited` joining by their accounts and `guests` by its link, each let in. */
async function callIn(org: Account, home: string, invited: Account[], guests: string[]) {
  const { code: c } = await org.api.meetings.create({
    title: 'Launch review', startsAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, guests: invited.map((p) => p.email), notes: 'off', workspaceId: home
  });
  const host = await org.api.calls.join(c, { mic: false, cam: false });
  await inGroup(host);
  const calls: CallSession[] = [];
  for (const who of invited) {
    const call = await who.api.calls.join(c, { mic: false, cam: false });
    await inGroup(call);
    await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
    calls.push(call);
  }
  const visitors: (Browser & { call: CallSession; pass: string })[] = [];
  for (const name of guests) {
    const b = h.browser();
    const call = await b.api.calls.join(c, { mic: false, cam: false, name });
    await settle(host, (s) => s.waiting.some((w) => w.id === call.ticket.identity));
    await host.admit(call.ticket.identity);
    await inGroup(call);
    await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
    visitors.push({ ...b, call, pass: call.ticket.pass });
  }
  return { host, calls, guests: visitors };
}
/** A picture's bytes and type, from the object URL a board's `<img>` is given. */
async function pictured(url: string) {
  const blob = resolveObjectURL(url);
  if (!blob) throw new Error('no such object URL');
  URL.revokeObjectURL(url);
  return { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
}
const photo = (n: number) => new Uint8Array(randomBytes(n));
const fileOf = (bytes: Uint8Array<ArrayBuffer>, name = 'Offsite whiteboard.png') => new File([bytes], name, { type: 'image/png' });
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;

describe('a picture put on a board from More', () => {
  it('is kept in the board’s own files with the call’s pass, and everyone who can open the board sees it', async () => {
    const art = await account();
    const kofi = await account();
    const lena = await account();
    const home = await workspace(art, 'Product', [[lena, 'read']]);
    const { host, calls: [k], guests: [jamie] } = await callIn(art, home, [kofi], ['Jamie Guest']);
    if (!k || !jamie) throw new Error('nobody joined');
    await k.openBoard({ template: 'blank' });
    const open1 = await settle(host, (s) => s.board.open !== null);
    const board = open1.board.open?.documentId ?? '';
    expect(open1.board.open).toMatchObject({ workspaceId: home, everyone: true });

    // Jamie has no account: a seat in the call lets them add to the board, and a picture they add goes into its files with their pass.
    const bytes = photo(70_000);
    const kept = await jamie.api.workspaces.media.upload(home, board, fileOf(bytes), { pass: jamie.pass, width: 1600, height: 1000 });
    expect(kept).toMatchObject({ name: 'Offsite whiteboard.png', type: 'image/png', width: 1600, height: 1000, documents: [board] });
    const theirs = await open(jamie, home, board, { pass: jamie.pass });
    const picture = add(theirs, { k: 'image', x: 0, y: 0, w: 480, h: 300, media: kept.id });
    await saved(theirs);

    // Everyone the board opens for sees it through the board: in the call with its pass, and in the workspace with their own access.
    const kofisTab = await open(kofi, home, board, { pass: k.ticket.pass });
    await until(() => readBoard(kofisTab.doc).byId.get(picture)?.k === 'image', 'the picture to reach Kofi');
    const readers: [Browser, { pass?: string }][] = [[art, {}], [kofi, { pass: k.ticket.pass }], [jamie, { pass: jamie.pass }], [lena, {}]];
    for (const [who, opts] of readers) {
      const seen = await pictured(await who.api.workspaces.media.picture(home, board, kept.id, opts));
      expect(seen.type).toBe('image/png');
      expect(same(seen.bytes, bytes)).toBe(true);
    }
    // It's one of the board's files, which is all the workspace says about it.
    expect((await art.api.workspaces.media.list(home)).find((m) => m.id === kept.id)?.documents).toEqual([board]);
    await host.leave();
  });

  it('reaches nobody who can’t open the board, and someone who can only look at it can’t put one there', async () => {
    const art = await account();
    const lena = await account();
    const omar = await account();
    const home = await workspace(art, 'Product', [[lena, 'read']]);
    const plans = await make(art, home, 'Plans');
    const { host, guests: [jamie] } = await callIn(art, home, [], ['Jamie Guest']);
    if (!jamie) throw new Error('nobody joined');
    // A saved board brought without letting the call in: Jamie is in the call, and it isn't open to them.
    await host.openBoard({ workspaceId: home, documentId: plans, letIn: false });
    expect((await settle(jamie.call, (s) => s.board.open !== null)).board.open).toMatchObject({ role: null });

    const bytes = photo(4_000);
    const kept = await art.api.workspaces.media.upload(home, plans, fileOf(bytes, 'Salaries chart.png'), { pass: host.ticket.pass, width: 800, height: 600 });
    const hers = await open(art, home, plans);
    add(hers, { k: 'image', x: 0, y: 0, w: 480, h: 360, media: kept.id });
    await saved(hers);

    // Jamie in the call, Omar outside the workspace and someone with neither are each told what a picture that isn't there says.
    const strangers: [string, Browser, { pass?: string }, string][] = [
      ['Jamie', jamie, { pass: jamie.pass }, 'not-found'], ['Omar', omar, {}, 'not-found'], ['nobody', h.browser(), {}, 'unauthenticated']
    ];
    for (const [who, b, opts, told] of strangers) {
      const nothing = await refusal(b.api.workspaces.media.picture(home, plans, madeUp(), opts));
      expect(nothing?.code, who).toBe(told);
      expect(await refusal(b.api.workspaces.media.picture(home, plans, kept.id, opts)), who).toEqual(nothing);
      expect(await refusal(b.api.workspaces.media.url(home, plans, kept.id, opts)), who).toEqual(await refusal(b.api.workspaces.media.url(home, plans, madeUp(), opts)));
    }
    // Lena can look at the board and its pictures, but she can't add one: a picture's a change to the board.
    expect(same((await pictured(await lena.api.workspaces.media.picture(home, plans, kept.id))).bytes, bytes)).toBe(true);
    expect(await code(lena.api.workspaces.media.upload(home, plans, fileOf(photo(64))))).toBe('forbidden');
    // And nobody adds one with a pass the board isn't open to.
    expect(await code(jamie.api.workspaces.media.upload(home, plans, fileOf(photo(64)), { pass: jamie.pass }))).toBe('not-found');
    expect((await art.api.workspaces.media.list(home)).map((m) => m.id)).toEqual([kept.id]);
    await host.leave();
  });
});

/* ---------- templates ---------- */

describe('a template from More', () => {
  it('goes beside what’s there with ids of its own, the same for everyone, and undo takes it back while nobody’s touched it', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit']]);
    const board = await make(art, id, 'Planning');
    const [a, k] = await Promise.all([open(art, id, board), open(kofi, id, board)]);
    sticky(a, 'Ship the sidebar', 40, 40);
    sticky(a, 'Fix onboarding', 240, 40);
    await agree([a, k], 'the stickies to reach Kofi');
    const before = readBoard(a.doc).objects.filter(hasBox);
    const history = makeHistory(k.doc, k.me);

    const retro = addTemplate(k.doc, 'retro', k.me);
    await agree([a, k], 'the retro to reach Art');
    const view = readBoard(a.doc);
    const made = retro.flatMap((x) => { const o = view.byId.get(x); return o && hasBox(o) ? [o] : []; });
    expect(made.filter((o) => o.k === 'frame').map((o) => o.k === 'frame' && o.title)).toEqual(['Went well', 'Could improve', 'Actions']);
    // Nothing of it lands on what was there, and its ids are its own.
    for (const o of made) for (const b of before) expect(overlaps(o, b)).toBe(false);
    expect(new Set(retro).size).toBe(retro.length);
    for (const b of before) expect(retro).not.toContain(b.id);
    // A second goes beside the first.
    const ideas = addTemplate(k.doc, 'ideas', k.me);
    await agree([a, k], 'the ideas to reach Art');
    const after = readBoard(a.doc);
    for (const x of ideas) for (const y of retro) {
      const one = after.byId.get(x), two = after.byId.get(y);
      if (one && two && hasBox(one) && hasBox(two) && one.k === 'frame' && two.k === 'frame') expect(overlaps(one, two)).toBe(false);
    }

    // Undo takes the last one back, everywhere, and the first stays.
    history.undo();
    await agree([a, k], 'the undo to reach Art');
    const undone = readBoard(a.doc);
    expect(ideas.some((x) => undone.byId.has(x))).toBe(false);
    expect(retro.every((x) => undone.byId.has(x))).toBe(true);
    history.destroy();
  });
});

/* ---------- Night board ---------- */

describe('Night board', () => {
  it('is the board’s own: whoever can change it makes it night for everyone who opens it, kept with it, and nobody who can only look can', async () => {
    const art = await account();
    const kofi = await account();
    const lena = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit'], [lena, 'read']]);
    const board = await make(art, id, 'Planning');
    const [a, k, l] = await Promise.all([open(art, id, board), open(kofi, id, board), open(lena, id, board)]);
    sticky(a, 'Freeze on Monday');
    await agree([a, k, l], 'the sticky to reach everyone');
    expect([a, k, l].map((t) => boardNight(t.doc))).toEqual([false, false, false]);

    // Kofi makes it a night board: it's night for everyone who has it open, and it isn't something on the board.
    const before = shown(a);
    setNight(k.doc, true, k.me);
    await until(() => boardNight(a.doc) && boardNight(l.doc), 'night to reach everyone');
    expect(shown(a)).toBe(before);
    await saved(k);
    // It's kept with the board: whoever opens it next opens a night board.
    expect(boardNight((await open(lena, id, board)).doc)).toBe(true);

    // Lena can only look: her browser's change is refused and says why, and the board stays night for everyone.
    setNight(l.doc, false, l.me);
    await until(() => l.s.getSnapshot().status === 'failed', 'Lena’s change to be refused');
    expect(l.s.getSnapshot()).toMatchObject({ refused: 'read-only' });
    await rest(300);
    expect(boardNight(a.doc)).toBe(true);
    expect(boardNight((await open(art, id, board)).doc)).toBe(true);

    // Art lets it follow each person's theme again, for everyone.
    setNight(a.doc, false, a.me);
    await until(() => !boardNight(k.doc), 'day to reach Kofi');
    await saved(a);
    expect(boardNight((await open(lena, id, board)).doc)).toBe(false);
  });
});

/* ---------- comments ---------- */

/** Comments are nobody's change to the board, as the surface writes them. */
const SAID = { comments: true };

describe('a comment from More, on a board in a call', () => {
  it('names whoever writes it as the board’s workspace knows them, the ID its page finds a member’s face by, and never their address', async () => {
    const art = await account();
    const priya = await account();
    const kofi = await account();
    const home = await workspace(art, 'Product', [[priya, 'edit']]);
    const { host, calls: [p, k], guests: [jamie] } = await callIn(art, home, [priya, kofi], ['Jamie Guest']);
    if (!p || !k || !jamie) throw new Error('nobody joined');
    await host.openBoard({ template: 'blank' });
    const board = (await settle(host, (s) => s.board.open !== null)).board.open?.documentId ?? '';

    // Each of them asks the board's workspace, with the call's pass, for the IDs of everyone in the call, as the call's board does.
    const emails = [art.email, priya.email, kofi.email];
    const [priyaAsked, kofiAsked] = await Promise.all([priya.api.workspaces.ids(home, emails, { pass: p.ticket.pass }), kofi.api.workspaces.ids(home, emails, { pass: k.ticket.pass })]);
    const members = await art.api.workspaces.people(home);
    const priyas = members.find((m) => m.person.email === priya.email)?.person.id ?? '';
    expect(priyas).not.toBe('');
    // A member's is the ID the workspace already has for her; Kofi isn't a member, and his is keyed, not his address.
    expect([priyaAsked[priya.email], kofiAsked[priya.email]]).toEqual([priyas, priyas]);
    const kofis = kofiAsked[kofi.email] ?? '';
    expect(kofis).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(priyaAsked[kofi.email]).toBe(kofis);

    // Kofi comments on a sticky; Priya and Jamie, who has no address, reply. Each writes through the board with the call's pass.
    const [kt, pt, jt] = await Promise.all([open(kofi, home, board, { pass: k.ticket.pass }), open(priya, home, board, { pass: p.ticket.pass }), open(jamie, home, board, { pass: jamie.pass })]);
    const note = sticky(kt, 'Nobody owned the status page');
    const thread = addThread(kt.doc, note, 'CANARY-CALLCOMMENT who owns it after launch?', { by: kofis, name: kofi.name }, SAID);
    await saved(kt);
    await until(() => readThreads(pt.doc, readBoard(pt.doc)).length === 1, 'Priya to see the comment');
    addReply(pt.doc, thread, 'Maya does, from Monday.', { by: priyas, name: priya.name }, SAID);
    await saved(pt);
    await until(() => (readThreads(jt.doc, readBoard(jt.doc))[0]?.replies.length ?? 0) === 2, 'Jamie to see the reply');
    addReply(jt.doc, thread, 'I can cover the first week.', { by: '', name: 'Jamie Guest' }, SAID);
    await saved(jt);
    await host.leave();

    // After the call, on the board's page, Art reads who said what: Priya by the ID her face is found by among the workspace's
    // people, Kofi by the ID the workspace keys his address under, the same one it gives Art, and Jamie by name alone.
    const page = await open(art, home, board);
    await until(() => (readThreads(page.doc, readBoard(page.doc))[0]?.replies.length ?? 0) === 3, 'Art to read the thread');
    expect((await art.api.workspaces.ids(home, [kofi.email]))[kofi.email]).toBe(kofis);
    expect(readThreads(page.doc, readBoard(page.doc)).map((t) => ({ on: t.on, said: t.replies.map((r) => [r.by, r.name, r.text]) }))).toEqual([{
      on: note, said: [[kofis, kofi.name, 'CANARY-CALLCOMMENT who owns it after launch?'], [priyas, priya.name, 'Maya does, from Monday.'], ['', 'Jamie Guest', 'I can cover the first week.']]
    }]);
    // Nobody's address is anywhere in what the board keeps.
    const kept = JSON.stringify(page.doc.getMap('comments').toJSON());
    for (const email of emails) expect(kept).not.toContain(email);
  });
});

/* ---------- downloads ---------- */

/** What a download says for someone: their view of the board, each linked item by their own name for it, from their own tree. */
function download(t: Tab, tree: WorkspaceTree): string[] {
  const named = new Map(tree.items.flatMap((i) => (i.kind !== 'folder' && i.trashedAt === null ? [[i.id, i.name] as const] : [])));
  return sceneWords(boardScene(readBoard(t.doc), (item) => named.get(item) ?? null));
}

describe('a download of a board', () => {
  it('says only what its reader can open, by their own names, and nothing of what they can’t', async () => {
    const art = await account();
    const lena = await account();
    const id = await workspace(art, 'Product', [[lena, 'edit']]);
    const board = await make(art, id, 'Launch board');
    const roadmap = await make(art, id, 'Roadmap', 'document');
    const salaries = await make(art, id, 'Salaries CANARY-DOWNLOAD', 'document');
    await art.api.workspaces.share.restrict(id, salaries, true);
    const hers = await open(art, id, board);
    sticky(hers, 'Freeze on Monday');
    const toRoadmap = add(hers, { k: 'link', x: 200, y: 0, w: 300, h: 76, item: roadmap });
    const toSalaries = add(hers, { k: 'link', x: 200, y: 120, w: 300, h: 76, item: salaries });
    // A comment isn't on the board, and isn't in a download.
    addThread(hers.doc, toSalaries, 'CANARY-COMMENT the numbers are final', { by: '', name: art.name }, hers.me);
    await saved(hers);

    // A link keeps the item's id and nothing else: no name of it is on the board for anyone to read.
    const link = readBoard(hers.doc).byId.get(toSalaries);
    expect(link).toMatchObject({ k: 'link', item: salaries });
    expect(JSON.stringify(readBoard(hers.doc).objects)).not.toContain('Salaries');

    const lenas = await open(lena, id, board);
    await agree([hers, lenas], 'the board to reach Lena');
    // Art can open everything on it, and sees it all by name.
    expect(download(hers, await art.api.workspaces.get(id))).toEqual(['Freeze on Monday', 'Roadmap', 'Salaries CANARY-DOWNLOAD']);
    // Lena can't open the salaries, so her download says only that there's something she can't open there.
    const hersToo = download(lenas, await lena.api.workspaces.get(id));
    expect(hersToo).toEqual(['Freeze on Monday', 'Roadmap', CANT_OPEN]);
    expect(hersToo.join('\n')).not.toMatch(/CANARY|Salaries/);

    // Names are each reader's, as they are now: renamed, it's the new name; in Trash, it can't be opened.
    await art.api.workspaces.items.rename(id, roadmap, 'Roadmap 2027');
    expect(download(lenas, await lena.api.workspaces.get(id))).toEqual(['Freeze on Monday', 'Roadmap 2027', CANT_OPEN]);
    await art.api.workspaces.items.trash(id, roadmap);
    expect(download(lenas, await lena.api.workspaces.get(id))).toEqual(['Freeze on Monday', CANT_OPEN, CANT_OPEN]);
    expect(readBoard(lenas.doc).byId.get(toRoadmap)).toMatchObject({ k: 'link', item: roadmap });

    // Someone who loses the board has nothing to download: it doesn't open for them.
    await art.api.workspaces.share.restrict(id, board, true);
    expect(await code(lena.api.workspaces.document(id, board).then((s) => s.ready))).toBe('not-found');
  });
});

/* ---------- every object More adds, read back ---------- */

describe('what More adds', () => {
  it('reads back the same in every browser, words and all, and a table’s new line never moves what someone’s typing in', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit']]);
    const board = await make(art, id, 'Planning');
    const [a, k] = await Promise.all([open(art, id, board), open(kofi, id, board)]);
    const { id: table, rows, cols } = tableAt(a, 2, 2);
    const first = add(a, { k: 'node', x: 600, y: 0, w: 220, h: 72, parent: '', t: '' });
    const branch = add(a, { k: 'node', x: 892, y: 8, w: 190, h: 56, parent: first, t: '' });
    await agree([a, k], 'More’s objects to reach Kofi');
    const [row, col] = [rows[1] ?? '', cols[1] ?? ''];
    const typing = focus(k, table, row, col);
    keys(k, typing, 'Owner');
    // Art adds a row above and a column before the cell Kofi is typing in, at once.
    expect(addTableLine(a.doc, table, 'rows', 0, 48, a.me)).not.toBeNull();
    expect(addTableLine(a.doc, table, 'cols', 0, 160, a.me)).not.toBeNull();
    keys(k, typing, 's');
    await agree([a, k], 'the table to settle');
    expect(cellOf(a, table, row, col)?.toString()).toBe('Owners');
    expect(readBoard(a.doc).byId.get(table)).toMatchObject({ k: 'table', cells: { [cellKey(row, col)]: 'Owners' } });
    // Ideas keep the one they branch from, and their words.
    const said = objectText(k.doc, branch, 't');
    if (!said) throw new Error('no text on the branch');
    k.doc.transact(() => said.insert(0, 'Pricing'), k.me);
    await agree([a, k], 'the idea to reach Art');
    expect(readBoard(a.doc).byId.get(branch)).toMatchObject({ k: 'node', parent: first, t: 'Pricing' });
    typing.stop();
  });
});
