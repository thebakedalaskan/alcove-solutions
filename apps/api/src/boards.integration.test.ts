/**
 * Whiteboards: people working on one board together, through browsers talking to the real API over HTTP via @alcove/api-http,
 * on real Postgres and object storage, with @alcove/board making every change the way the board's surface makes it. A board
 * is a document of kind `board`, so this is the documents' log, access, versions and Trash with a board's Y.Doc in them. What's
 * checked is what people get: one board for everyone whatever they do at once, nothing an honest browser sends turned away,
 * and nothing of what's on it anywhere but with the people who can open it.
 */
import { AlcoveApiError, DOC_UPDATE_TYPE, DocLiveEventSchema, type DocLiveEvent, type DocSession, type DocSessionOptions, type ItemKind, type WorkspaceRole } from '@alcove/api';
import {
  addObject, addThread, duplicateObjects, hasBox, makeHistory, moveObjects, newId, objectText, readBoard, removeObjects, route, setObjects, tableCell, type Box, type NewObject, type StickyColour
} from '@alcove/board';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { z } from 'zod';
import { blindIndex } from './crypto';
import { AppError } from './errors';
import { workspaceFor } from './modules/workspaceAccess';
import { keepVersion, readDocument, writeDocument, type Held } from './modules/workspaceDocuments';
import { masterKey } from './owners';
import { startHarness, type Browser, type Harness } from './testing/harness';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
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
/** What a refusal says, from the API to a browser or from server code: `allowed` if nothing refused it. */
const code = (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => (e instanceof AlcoveApiError || e instanceof AppError ? e.code : `not a refusal: ${String(e)}`));
/** Everything a browser is told when it's refused, but the request's ID. */
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AlcoveApiError ? { code: e.code, message: e.message, status: e.status } : { code: `not an API error: ${String(e)}`, message: '', status: 0 }));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const make = async (who: Account, id: string, name: string, kind: ItemKind = 'board') => (await who.api.workspaces.items.create(id, { kind, name, parent: null })).id;
/** A workspace as someone with this address has it, for what server code calls. */
const heldBy = (who: Account, workspaceId: string) => workspaceFor(h.deps, { email: who.email, principals: [blindIndex(masterKey(h.deps), 'email', who.email)] }, workspaceId);

/* ---------- a browser at a board ---------- */

/** A tab with a board open: its session, and the origin its writes go under, as the surface's own. */
interface Tab { s: DocSession; doc: Y.Doc; me: object }
async function open(who: Browser, id: string, board: string, opts: DocSessionOptions = {}): Promise<Tab> {
  const s = await who.api.workspaces.document(id, board, opts);
  await s.ready;
  return { s, doc: s.doc, me: {} };
}
const saved = (t: Tab, what = 'everything to reach Alcove') => until(() => t.s.getSnapshot().status === 'saved', what);
const view = (t: { doc: Y.Doc }) => readBoard(t.doc);
/** Everything on a board as it reads, in drawing order, which is the same in every browser: what two people must agree on. */
const shown = (t: { doc: Y.Doc }) => JSON.stringify(readBoard(t.doc).objects);
/** Comment threads, by id, as they're stored. */
function threads(t: { doc: Y.Doc }): string {
  const out: string[] = [];
  t.doc.getMap('comments').forEach((thread, id) => {
    if (thread instanceof Y.Map) out.push(JSON.stringify([id, thread.get('on'), thread.get('replies') instanceof Y.Array ? thread.get('replies').toJSON() : null]));
  });
  return out.sort().join('\n');
}
async function agree(tabs: Tab[], what: string): Promise<void> {
  const [first, ...others] = tabs;
  if (!first) return;
  await until(() => others.every((t) => shown(t) === shown(first) && threads(t) === threads(first)), what);
}
/** Adds something as the surface does, and says what it's called. */
function add(t: Tab, input: NewObject): string {
  const id = addObject(t.doc, input, t.me);
  if (!id) throw new Error(`a ${input.k} wasn’t added`);
  return id;
}
const sticky = (t: Tab, words: string, x = 0, y = 0, c: StickyColour = 'butter') => add(t, { k: 'note', x, y, w: 150, h: 150, c, size: 'm', t: words });
const frame = (t: Tab, title: string, box: Box) => add(t, { k: 'frame', ...box, c: '', role: '', hint: '', sub: '', title });
/** Types into an object's text in one go, as the surface's field does: one transaction under this browser's origin. */
function type(t: Tab, id: string, words: string, field = 't'): void {
  const text = objectText(t.doc, id, field);
  if (!text) throw new Error(`there's no text to type in on ${id}`);
  t.doc.transact(() => text.insert(text.length, words), t.me);
}
const words = (t: { doc: Y.Doc }, id: string, field = 't') => objectText(t.doc, id, field)?.toString() ?? '';
function boxOf(t: { doc: Y.Doc }, id: string): Box {
  const o = view(t).byId.get(id);
  if (!o || !hasBox(o)) throw new Error(`${id} has no box`);
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
/** A table of `rows` by `cols`, each cell typed into as the surface types into one. */
function table(t: Tab, cells: string[][], at: { x: number; y: number }): string {
  const rows = cells.map(() => ({ id: newId(), size: 40 }));
  const cols = (cells[0] ?? []).map(() => ({ id: newId(), size: 120 }));
  const id = add(t, { k: 'table', ...at, w: 120 * cols.length, h: 40 * rows.length, rows, cols, cells: {} });
  cells.forEach((line, r) => line.forEach((text, c) => {
    const row = rows[r], col = cols[c];
    if (!row || !col) return;
    const cell = tableCell(t.doc, id, row.id, col.id, t.me);
    if (!cell) throw new Error('no cell');
    t.doc.transact(() => cell.insert(0, text), t.me);
  }));
  return id;
}

/** A version of a board as it stands: one kept now, or, if nothing changed since the newest, that one, as `keepVersion` says. */
async function versionNow(who: Account, id: string, board: string): Promise<string> {
  const kept = (await keepVersion(await heldBy(who, id), board, { reason: 'call', callId: null })) ?? (await who.api.workspaces.versions(id, board))[0]?.id;
  if (!kept) throw new Error('no version of the board');
  return kept;
}
/** A board as the server reads it. */
async function onServer(w: Held, board: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, await readDocument(w, board, 'state', {}));
  return doc;
}
/** What the firewall turned away from this board. It logs why, and never anything of what was in it. */
const refusals = (board: string) => h.logs.filter((l) => l.includes('update refused') && l.includes(board));

/** A connection that can drop: every stream and request fails until it's back. */
function network(b: Browser) {
  let down = false;
  const live = new Set<AbortController>();
  const net: typeof fetch = async (input, init) => {
    if (down) throw new TypeError('The network is down.');
    const stop = new AbortController();
    live.add(stop);
    const signal = init?.signal ? AbortSignal.any([init.signal, stop.signal]) : stop.signal;
    return b.fetch(input, { ...init, signal });
  };
  return { browser: h.browser({ fetch: net }), drop: () => { down = true; for (const s of live) s.abort(); live.clear(); }, back: () => { down = false; } };
}
const offline = (t: Tab) => until(() => t.s.getSnapshot().status === 'offline', 'the board to say it’s offline');

const docPath = (id: string, doc: string) => `/workspaces/${id}/documents/${doc}`;
const send = (who: { fetch: typeof fetch }, id: string, doc: string, update: Uint8Array) =>
  who.fetch(`${h.baseUrl}/v1${docPath(id, doc)}/updates`, { method: 'POST', headers: { 'content-type': DOC_UPDATE_TYPE }, body: new Uint8Array(update) });
const post = (who: { fetch: typeof fetch }, path: string, sent: unknown) => who.fetch(`${h.baseUrl}/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sent) });
/** A board update from nobody's session: a sticky, written as a browser of its own would write it. */
function aSticky(words: string): Uint8Array {
  const doc = new Y.Doc();
  addObject(doc, { k: 'note', x: 0, y: 0, w: 150, h: 150, c: 'butter', size: 'm', t: words }, null);
  return Y.encodeStateAsUpdate(doc);
}
/** Stickies sent one update each, as a browser sends them when nothing batches them: one client, carrying on its clocks. */
async function oneByOne(who: Browser, id: string, board: string, n: number, label: string): Promise<void> {
  const pen = new Y.Doc();
  const me = {};
  for (let i = 0; i < n; i++) {
    const before = Y.encodeStateVector(pen);
    addObject(pen, { k: 'note', x: (i % 20) * 160, y: 3000 + Math.floor(i / 20) * 160, w: 150, h: 150, c: 'mist', size: 's', t: `${label} ${i}` }, me);
    expect((await send(who, id, board, Y.encodeStateAsUpdate(pen, before))).status).toBe(200);
  }
  pen.destroy();
}
const compacted = async (board: string) => (await count('SELECT coalesce(max(through_seq), 0)::int AS n FROM document_snapshots WHERE document_id = $1', [board])) > 0;
/** Reads a board's stream as a browser does, keeping each line. */
function stream(f: typeof fetch, id: string, doc: string) {
  const lines: DocLiveEvent[] = [];
  const out = { lines, ended: false };
  void (async () => {
    const res = await f(`${h.baseUrl}/v1${docPath(id, doc)}/live?after=0`);
    if (!res.body || !res.ok) { out.ended = true; return; }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        lines.push(DocLiveEventSchema.parse(JSON.parse(buf.slice(0, i))));
        buf = buf.slice(i + 1);
      }
    }
    out.ended = true;
  })().catch(() => { out.ended = true; });
  return out;
}

/* ---------- together ---------- */

describe('people at a board at once', () => {
  it.each([2, 3])('%i people adding, moving and typing in stickies at once end up with one board, and a reload shows it', async (n) => {
    const people = await Promise.all(Array.from({ length: n }, () => account()));
    const [owner] = people;
    if (!owner) throw new Error('nobody');
    const id = await workspace(owner, 'Ours', people.slice(1).map((p): [Account, WorkspaceRole] => [p, 'edit']));
    const board = await make(owner, id, 'Planning');
    const tabs = await Promise.all(people.map((p) => open(p, id, board)));
    const [first] = tabs;
    if (!first) throw new Error('no tab');
    const shared = sticky(first, 'Shared:');
    await saved(first);
    await until(() => tabs.every((t) => view(t).byId.has(shared)), 'everyone to see the shared sticky');

    // Everyone at once, with nobody waiting for anyone: stickies of their own, moving their own and other people's, and typing in the shared one.
    const theirs = tabs.map((): string[] => []);
    for (let round = 0; round < 8; round++) {
      tabs.forEach((t, i) => {
        theirs[i]?.push(sticky(t, `Person ${i}, round ${round}`, i * 600 + round * 20, round * 170));
        type(t, shared, ` p${i}r${round}`);
        const notes = view(t).objects.filter((o) => o.k === 'note' && o.id !== shared);
        const pick = notes[(round * 7 + i * 3) % notes.length];
        if (pick && hasBox(pick)) moveObjects(t.doc, [{ id: pick.id, x: pick.x + 13 * (i + 1), y: pick.y + 7 * (round + 1) }], t.me);
      });
      if (round % 3 === 0) await rest(40);
    }
    for (const t of tabs) await saved(t);
    await agree(tabs, 'everyone to end up with the same board');

    // Every sticky is there once, and every word everyone typed, each person's in the order they typed them.
    const end = view(first);
    expect(end.objects.filter((o) => o.k === 'note')).toHaveLength(1 + n * 8);
    for (const ids of theirs) for (const sid of ids) expect(end.byId.get(sid)?.k).toBe('note');
    const typed = words(first, shared);
    for (let i = 0; i < n; i++) {
      const at = Array.from({ length: 8 }, (_, r) => typed.indexOf(`p${i}r${r}`));
      expect(at.every((x) => x >= 0)).toBe(true);
      expect([...at].sort((x, y) => x - y)).toEqual(at);
    }
    const merged = shown(first);
    for (const t of tabs) t.s.close();
    // A reload reads it back from the log: the same board.
    expect(shown(await open(owner, id, board))).toBe(merged);
    expect(refusals(board)).toEqual([]);
  });

  it('keeps a connector attached while both its ends move, by two people at once, and while a frame carries one end', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Flow');
    const [a, t] = await Promise.all([open(ann, id, board), open(theo, id, board)]);
    const from = sticky(a, 'From', 0, 0);
    const to = sticky(a, 'To', 400, 0);
    const line = add(a, { k: 'line', style: 'elbow', from: { on: from, side: 'r' }, to: { on: to, side: 'l' } });
    await saved(a);
    await agree([a, t], 'Theo to see the line');
    const drawn = route(boxOf(a, from), boxOf(a, to), 'elbow').d;

    // One end each, at the same moment.
    moveObjects(a.doc, [{ id: from, x: 40, y: 320 }], a.me);
    moveObjects(t.doc, [{ id: to, x: 620, y: -260 }], t.me);
    await saved(a);
    await saved(t);
    await agree([a, t], 'both moves to reach both');
    for (const tab of [a, t]) {
      expect(view(tab).byId.get(line)).toMatchObject({ k: 'line', from: { on: from, side: 'r' }, to: { on: to, side: 'l' } });
      expect(boxOf(tab, from)).toMatchObject({ x: 40, y: 320 });
      expect(boxOf(tab, to)).toMatchObject({ x: 620, y: -260 });
    }
    // It's drawn between where they are now, the same for both of them.
    const now = route(boxOf(a, from), boxOf(a, to), 'elbow').d;
    expect(now).not.toBe(drawn);
    expect(route(boxOf(t, from), boxOf(t, to), 'elbow').d).toBe(now);

    // A frame takes one end in, and is carried off with it while the other end moves too.
    const holder = frame(t, 'Holds one end', { x: 500, y: -400, w: 500, h: 500 });
    moveObjects(t.doc, [{ id: to, x: 600, y: -300 }], t.me);
    await saved(t);
    await agree([a, t], 'the frame to reach Ann');
    expect(view(a).byId.get(to)?.f).toBe(holder);
    moveObjects(a.doc, [{ id: holder, x: 1500, y: 600 }], a.me);
    moveObjects(t.doc, [{ id: from, x: -300, y: -300 }], t.me);
    await saved(a);
    await saved(t);
    await agree([a, t], 'the frame and the other end to move for both');
    expect(boxOf(a, to)).toMatchObject({ x: 1600, y: 700 });
    expect(boxOf(a, from)).toMatchObject({ x: -300, y: -300 });
    expect(view(a).byId.get(line)).toMatchObject({ from: { on: from }, to: { on: to } });
    const settled = shown(a);
    a.s.close();
    t.s.close();
    expect(shown(await open(theo, id, board))).toBe(settled);
  });
});

describe('undo', () => {
  it('takes back only your own change: someone else’s stickies, words and moves stay', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Board');
    const [a, t] = await Promise.all([open(ann, id, board), open(theo, id, board)]);
    const ah = makeHistory(a.doc, a.me);
    const th = makeHistory(t.doc, t.me);
    const annNote = sticky(a, 'Ann’s', 0, 0);
    await saved(a);
    const theoNote = sticky(t, 'Theo’s', 300, 0);
    await saved(t);
    await agree([a, t], 'both stickies to reach both');

    // Ann's undo takes her sticky, and only hers, for everyone.
    expect(ah.undo()).toEqual({ ok: true, changed: true });
    await saved(a);
    await agree([a, t], 'the undo to reach Theo');
    expect(view(t).byId.has(annNote)).toBe(false);
    expect(view(t).byId.get(theoNote)).toMatchObject({ t: 'Theo’s' });
    // Redo brings it back as it was, under the same id.
    expect(ah.redo()).toEqual({ ok: true, changed: true });
    await saved(a);
    await agree([a, t], 'the redo to reach Theo');
    expect(view(t).byId.get(annNote)).toMatchObject({ t: 'Ann’s', x: 0, y: 0 });

    // Once Theo has typed in Ann's sticky, it's not only hers: her undo leaves it, with his words.
    type(t, annNote, ' and Theo’s words');
    await saved(t);
    await agree([a, t], 'Theo’s words to reach Ann');
    expect(ah.undo()).toEqual({ ok: true, changed: false });
    await rest(200);
    expect(words(a, annNote)).toBe('Ann’s and Theo’s words');

    // Ann moves Theo's sticky, then Theo moves it on: Ann's undo can't take his move back.
    moveObjects(a.doc, [{ id: theoNote, x: 600, y: 200 }], a.me);
    await saved(a);
    await agree([a, t], 'Ann’s move to reach Theo');
    moveObjects(t.doc, [{ id: theoNote, x: 900, y: 400 }], t.me);
    await saved(t);
    await agree([a, t], 'Theo’s move to reach Ann');
    expect(ah.undo()).toEqual({ ok: true, changed: false });
    await rest(200);
    expect(boxOf(t, theoNote)).toMatchObject({ x: 900, y: 400 });
    // Theo's own undo takes his move back, to where Ann had left it.
    expect(th.undo()).toEqual({ ok: true, changed: true });
    await saved(t);
    await agree([a, t], 'Theo’s undo to reach Ann');
    expect(boxOf(a, theoNote)).toMatchObject({ x: 600, y: 200 });
    expect(view(a).byId.get(annNote)).toMatchObject({ t: 'Ann’s and Theo’s words' });
  });

  it('loses nothing to a same-moment move and recolour, whichever wins, whoever undoes and redoes', async () => {
    for (const annWins of [true, false]) {
      const ann = await account();
      const theo = await account();
      const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
      const board = await make(ann, id, 'Board');
      const annNet = network(ann);
      const theoNet = network(theo);
      const a = await open(annNet.browser, id, board);
      const t = await open(theoNet.browser, id, board);
      // Yjs gives a same-moment write to the higher client: these make each of them the winner once.
      a.doc.clientID = annWins ? 3_000_003 : 1_000_001;
      t.doc.clientID = annWins ? 1_000_001 : 3_000_003;
      const ah = makeHistory(a.doc, a.me);
      const th = makeHistory(t.doc, t.me);
      const note = sticky(a, 'Moved by both', 0, 0);
      await saved(a);
      await agree([a, t], 'Theo to see the sticky');

      annNet.drop();
      theoNet.drop();
      await offline(a);
      await offline(t);
      moveObjects(a.doc, [{ id: note, x: 300, y: 40 }], a.me);
      setObjects(a.doc, [note], { c: 'rose' }, a.me);
      moveObjects(t.doc, [{ id: note, x: -260, y: 90 }], t.me);
      setObjects(t.doc, [note], { c: 'sky' }, t.me);
      annNet.back();
      theoNet.back();
      await saved(a);
      await saved(t);
      await agree([a, t], 'the two to converge');
      expect(view(a).byId.get(note)).toMatchObject(annWins ? { x: 300, y: 40, c: 'rose' } : { x: -260, y: 90, c: 'sky' });

      // Every press, by either of them, leaves the sticky on the board for both, whole: every field there, its words as typed.
      const whole = (tab: Tab) => {
        const o = view(tab).byId.get(note);
        return o?.k === 'note' && o.t === 'Moved by both' && o.w === 150 && o.h === 150 && o.size === 'm';
      };
      for (const press of [() => ah.undo(), () => th.undo(), () => ah.redo(), () => th.redo(), () => th.undo(), () => ah.undo(), () => ah.undo(), () => th.undo()]) {
        expect(press().ok).toBe(true);
        await saved(a);
        await saved(t);
        await agree([a, t], 'the press to reach both');
        expect(whole(a)).toBe(true);
        expect(whole(t)).toBe(true);
      }
      expect(refusals(board)).toEqual([]);
      a.s.close();
      t.s.close();
    }
  });

  it('brings a deleted object back whole: its words, its cells, the line to it and the comment on it', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Board');
    const [a, t] = await Promise.all([open(ann, id, board), open(theo, id, board)]);
    const ah = makeHistory(a.doc, a.me);
    const note = sticky(t, 'Theo wrote this', 0, 0, 'peach');
    await saved(t);
    await until(() => view(a).byId.has(note), 'Ann to see Theo’s sticky');
    type(a, note, ', and Ann added this');
    const other = sticky(t, 'The other end', 400, 0);
    const line = add(t, { k: 'line', style: 'straight', from: { on: note, side: 'r' }, to: { on: other, side: 'l' } });
    const thread = addThread(t.doc, note, 'A comment on it', t.me);
    const grid = table(t, [['Owner', 'Due'], ['Priya', 'Friday']], { x: 0, y: 400 });
    await saved(a);
    await saved(t);
    await agree([a, t], 'everything to reach both');
    const before = { note: view(a).byId.get(note), line: view(a).byId.get(line), grid: view(a).byId.get(grid), threads: threads(a) };
    expect(before.grid).toMatchObject({ k: 'table' });
    expect(threads(a)).toContain('A comment on it');

    // Ann deletes the sticky and the table: the line and the comment go with the sticky.
    removeObjects(a.doc, [note, grid], a.me);
    await saved(a);
    await agree([a, t], 'the delete to reach Theo');
    expect(view(t).byId.has(note)).toBe(false);
    expect(view(t).byId.has(line)).toBe(false);
    expect(view(t).byId.has(grid)).toBe(false);
    expect(threads(t)).not.toContain(thread);

    // One undo brings back all of it, exactly as it was, for both of them.
    expect(ah.undo()).toEqual({ ok: true, changed: true });
    await saved(a);
    await agree([a, t], 'the undo to reach Theo');
    expect(view(t).byId.get(note)).toEqual(before.note);
    expect(view(t).byId.get(line)).toEqual(before.line);
    expect(view(t).byId.get(grid)).toEqual(before.grid);
    expect(threads(t)).toBe(before.threads);
    // Its words are in a text again, which anyone can type in.
    type(t, note, '!');
    await saved(t);
    await agree([a, t], 'the typing to reach Ann');
    expect(words(a, note)).toBe('Theo wrote this, and Ann added this!');
    const settled = { shown: shown(a), threads: threads(a) };
    a.s.close();
    t.s.close();
    const again = await open(ann, id, board);
    expect({ shown: shown(again), threads: threads(again) }).toEqual(settled);
  });
});

describe('arriving and coming back', () => {
  it('gives a late joiner and a reconnect the board as it stands, with nothing twice, across a compaction', async () => {
    const ann = await account();
    const theo = await account();
    const cleo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [cleo, 'edit']]);
    const board = await make(ann, id, 'Board');
    const a = await open(ann, id, board);
    const theoNet = network(theo);
    const t = await open(theoNet.browser, id, board);
    const kept = sticky(a, 'Moved while Theo is away', 0, 0);
    await saved(a);
    await agree([a, t], 'Theo to see it');

    // Theo goes offline and works on; meanwhile Ann does enough that the log compacts.
    theoNet.drop();
    await offline(t);
    const offlineNotes = [sticky(t, 'Offline one', 0, 600), sticky(t, 'Offline two', 200, 600)];
    type(t, kept, ' (Theo typed this offline)');
    moveObjects(a.doc, [{ id: kept, x: 500, y: 500 }], a.me);
    await saved(a);
    await oneByOne(ann, id, board, 210, 'Filler');
    await until(() => compacted(board), 'the log to compact');

    // A late joiner gets all of it.
    const c = await open(cleo, id, board);
    await agree([a, c], 'Cleo to have what Ann has');
    expect(view(c).objects.filter((o) => o.k === 'note')).toHaveLength(1 + 210);

    // Theo comes back: everyone has everything, each sticky once.
    theoNet.back();
    await saved(t);
    await agree([a, t, c], 'all three to converge');
    const notes = view(a).objects.flatMap((o) => (o.k === 'note' ? [o] : []));
    expect(notes).toHaveLength(1 + 210 + 2);
    expect(new Set(notes.map((o) => o.t)).size).toBe(notes.length);
    for (const nid of offlineNotes) expect(view(c).byId.has(nid)).toBe(true);
    expect(view(c).byId.get(kept)).toMatchObject({ x: 500, y: 500, t: 'Moved while Theo is away (Theo typed this offline)' });
    // And it's the log that has it: a reload is the same, nothing doubled.
    expect(shown(await open(cleo, id, board))).toBe(shown(a));
    expect(refusals(board)).toEqual([]);
  });

  it('keeps every edit through a reload and an API restart: what it acknowledged is there, and what it didn’t is sent again', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Board');
    let server = await h.secondServer();
    let base = server.baseUrl;
    const via = (who: Account): typeof fetch => (input, init) => who.fetch(String(input).replace(h.baseUrl, base), init);
    const a = await open(h.browser({ fetch: via(ann) }), id, board);
    const t = await open(h.browser({ fetch: via(theo) }), id, board);
    const acknowledged = sticky(a, 'Acknowledged', 0, 0);
    await saved(a);
    await agree([a, t], 'Theo to see it');

    // It stops, as a deploy stops it, while both of them work on.
    await server.close();
    const whileDown = sticky(a, 'Added while it was down', 300, 0);
    moveObjects(t.doc, [{ id: acknowledged, x: 40, y: 260 }], t.me);
    type(t, acknowledged, ', and moved');
    await until(() => a.s.getSnapshot().status === 'offline' && t.s.getSnapshot().status === 'offline', 'both to say so');

    // A new process, with nothing in memory.
    server = await h.secondServer();
    base = server.baseUrl;
    await saved(a);
    await saved(t);
    await agree([a, t], 'the two to converge');
    expect(view(a).byId.get(acknowledged)).toMatchObject({ x: 40, y: 260, t: 'Acknowledged, and moved' });
    expect(view(t).byId.get(whileDown)).toMatchObject({ t: 'Added while it was down' });
    const settled = shown(a);
    a.s.close();
    t.s.close();
    await server.close();
    // Sealed records open on a process that never saw them, and a reload shows the same board.
    const next = await h.secondServer();
    base = next.baseUrl;
    expect(shown(await open(h.browser({ fetch: via(theo) }), id, board))).toBe(settled);
    await next.close();
  });
});

describe('who can do what', () => {
  it('refuses a read-only reader’s change, and the board stays as it was for everyone', async () => {
    const ann = await account();
    const rita = await account();
    const id = await workspace(ann, 'Ours', [[rita, 'read']]);
    const board = await make(ann, id, 'Board');
    const a = await open(ann, id, board);
    const note = sticky(a, 'As Ann left it', 0, 0);
    await saved(a);
    const r = await open(rita, id, board);
    expect(r.s.getSnapshot()).toMatchObject({ status: 'saved', role: 'read', trashed: false });
    expect(shown(r)).toBe(shown(a));
    const before = shown(a);
    // What a board writes, sent straight in: refused before anything of it is read.
    expect((await send(rita, id, board, aSticky('Rita’s sticky'))).status).toBe(403);

    // The surface won't let them change anything; should their board change anyway, it's refused and says why.
    sticky(r, 'Rita’s sticky', 400, 0);
    moveObjects(r.doc, [{ id: note, x: 999, y: 999 }], r.me);
    await until(() => r.s.getSnapshot().status === 'failed', 'the save to fail');
    expect(r.s.getSnapshot()).toMatchObject({ refused: 'read-only', closed: null });
    await rest(300);
    expect(shown(a)).toBe(before);
    expect(shown({ doc: await onServer(await heldBy(ann, id), board) })).toBe(before);
    // Opened again, it's the board as everyone else has it.
    expect(shown(await open(rita, id, board))).toBe(before);
    // Refused for who they are, not for what they sent.
    expect(refusals(board)).toEqual([]);
  });

  it('ends the stream when access is taken away, and nothing put on the board after reaches it', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Board');
    const a = await open(ann, id, board);
    const t = await open(theo, id, board);
    const raw = stream(theo.fetch, id, board);
    await until(() => raw.lines.length > 0, 'the raw stream');
    sticky(t, 'Theo was here', 0, 0);
    await saved(t);
    await agree([a, t], 'Theo’s sticky to reach Ann');

    await ann.api.workspaces.share.restrict(id, board, true);
    sticky(a, 'CANARY-BOARD-AFTER-REVOKED', 300, 0);
    await saved(a);
    await until(() => t.s.getSnapshot().closed === 'access', 'Theo’s board to close');
    await until(() => raw.ended, 'the raw stream to end');
    expect(raw.lines.at(-1)).toEqual({ type: 'closed', why: 'access' });
    expect(JSON.stringify(raw.lines)).not.toContain(Buffer.from('CANARY-BOARD-AFTER-REVOKED').toString('base64url').slice(0, 12));
    expect(JSON.stringify(view(t).objects)).not.toContain('CANARY-BOARD-AFTER-REVOKED');
    // What Theo's browser still tries is refused exactly as for a board that was never there.
    const asked = await send(theo, id, board, aSticky('Too late'));
    const never = await send(theo, id, madeUp(), aSticky('Too late'));
    expect([asked.status, never.status]).toEqual([404, 404]);

    // Taken out of the workspace ends it the same way.
    await ann.api.workspaces.share.restrict(id, board, false);
    const again = await open(theo, id, board);
    const theoId = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email)?.id ?? '';
    await ann.api.workspaces.removePerson(id, theoId);
    await until(() => again.s.getSnapshot().closed === 'access', 'Theo’s board to close again');
    expect(a.s.getSnapshot().closed).toBeNull();
  });

  it('keeps a board in Trash readable, read-only, to whoever had it open, and Delete forever leaves nothing of it anywhere', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Board');
    const a = await open(ann, id, board);
    const t = await open(theo, id, board);
    sticky(a, 'Before the version', 0, 0);
    await saved(a);
    await versionNow(ann, id, board);
    sticky(t, 'After it', 300, 0);
    await saved(t);
    await agree([a, t], 'both to have both');
    const before = shown(a);
    const objectsBefore = await objectCount();

    await ann.api.workspaces.items.trash(id, board);
    await until(() => a.s.getSnapshot().trashed && t.s.getSnapshot().trashed, 'Trash to show');
    expect(t.s.getSnapshot()).toMatchObject({ role: 'edit', closed: null });
    expect(shown(t)).toBe(before);
    // Nothing changes it while it's there: not a browser, and not the server.
    sticky(t, 'Added in Trash', 600, 0);
    await until(() => t.s.getSnapshot().status === 'failed', 'the save to fail');
    expect(t.s.getSnapshot().refused).toBe('trashed');
    expect((await send(ann, id, board, aSticky('No'))).status).toBe(409);
    expect(await code(writeDocument(await heldBy(ann, id), board, 'boardTemplate', { template: 'retro', seed: board }))).toBe('conflict');
    // Opening it now still reads it, as it was.
    const late = await open(theo, id, board);
    expect(late.s.getSnapshot()).toMatchObject({ trashed: true, role: 'edit' });
    expect(shown(late)).toBe(before);

    await ann.api.workspaces.items.deleteForever(id, board);
    await until(() => [a, t, late].every((x) => x.s.getSnapshot().closed === 'deleted'), 'every session to end');
    const tables = ['documents', 'document_updates', 'document_snapshots', 'document_versions', 'document_version_parts', 'document_clients', 'document_access'];
    for (const table of tables) expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE document_id = $1`, [board]), table).toBe(0);
    // A board's content is all in rows: nothing was put in the object store for it, and nothing's waiting to be deleted there.
    expect(await objectCount()).toBe(objectsBefore);
    expect(await count('SELECT count(*)::int AS n FROM object_gc')).toBe(0);
    expect(await code(open(ann, id, board))).toBe('not-found');
  });

  it('refuses anyone who can’t open a board as if it weren’t there, at every route, and never reaches across workspaces', async () => {
    const ann = await account();
    const sam = await account();
    const id = await workspace(ann, 'Mine');
    const other = await workspace(ann, 'Other');
    const board = await make(ann, id, 'CANARY-BOARD-NAME');
    const boardThere = await make(ann, other, 'There');
    const a = await open(ann, id, board);
    const there = await open(ann, other, boardThere);
    sticky(a, 'CANARY-BOARD-WORDS', 0, 0);
    sticky(there, 'There', 0, 0);
    await saved(a);
    await saved(there);
    const version = await versionNow(ann, id, board);
    const versionThere = await versionNow(ann, other, boardThere);
    const here = shown(a);
    const thereShown = shown(there);

    // Someone with no access: Ann's real IDs say exactly what made-up ones do, at every route.
    const w = sam.api.workspaces;
    const attempts: [string, (x: string, y: string) => Promise<unknown>][] = [
      ['item', (x, y) => w.items.get(x, y)], ['rename', (x, y) => w.items.rename(x, y, 'Mine now')], ['duplicate', (x, y) => w.items.duplicate(x, y)],
      ['trash', (x, y) => w.items.trash(x, y)], ['restore', (x, y) => w.items.restore(x, y)], ['delete', (x, y) => w.items.deleteForever(x, y)],
      ['move', (x, y) => w.items.move(x, y, { parent: null })], ['share list', (x, y) => w.share.list(x, y)], ['share', (x, y) => w.share.set(x, y, [{ email: sam.email }], 'edit')],
      ['restrict', (x, y) => w.share.restrict(x, y, false)], ['versions', (x, y) => w.versions(x, y)], ['version', (x, y) => w.version(x, y, version)],
      ['restore a version', (x, y) => w.restoreVersion(x, y, version)], ['open', async (x, y) => { const s = await w.document(x, y); await s.ready; }]
    ];
    for (const [what, attempt] of attempts) {
      const real = await refusal(attempt(id, board));
      expect(real?.code, what).toBe('not-found');
      expect(await refusal(attempt(id, madeUp())), what).toEqual(real);
      expect(await refusal(attempt(madeUp(), board)), what).toMatchObject({ code: 'not-found' });
    }
    const said = async (r: Response) => { const { requestId: _, ...answer } = z.record(z.string(), z.unknown()).parse(await r.json()); return { status: r.status, answer }; };
    for (const ask of [(x: string, y: string) => send(sam, x, y, aSticky('x')), (x: string, y: string) => post(sam, `${docPath(x, y)}/awareness`, { update: 'AA' }), (x: string, y: string) => sam.fetch(`${h.baseUrl}/v1${docPath(x, y)}/live`)]) {
      const real = await said(await ask(id, board));
      expect(real.status).toBe(404);
      expect(await said(await ask(id, madeUp()))).toEqual(real);
    }
    expect((await sam.fetch(`${h.baseUrl}/v1/workspaces/${id}/search`)).status).toBe(404);
    // Server code holding Sam's own workspace can't reach Ann's board through it.
    const samsOwn = await workspace(sam, 'Sam’s');
    const samHeld = await heldBy(sam, samsOwn);
    expect(await code(writeDocument(samHeld, board, 'boardTemplate', { template: 'retro', seed: board }))).toBe('not-found');
    expect(await code(readDocument(samHeld, board, 'text', { kind: 'board' }))).toBe('not-found');
    expect(await code((async () => keepVersion(samHeld, board, { reason: 'call', callId: null }))())).toBe('not-found');

    // Ann's own IDs across her two workspaces mean nothing: a board, its version, at every route.
    const mine = ann.api.workspaces;
    const across: [string, () => Promise<unknown>][] = [
      ['item', () => mine.items.get(id, boardThere)], ['duplicate', () => mine.items.duplicate(id, boardThere)], ['trash', () => mine.items.trash(id, boardThere)],
      ['versions', () => mine.versions(id, boardThere)], ['version', () => mine.version(id, boardThere, versionThere)], ['restore', () => mine.restoreVersion(id, boardThere, versionThere)],
      ['another board’s version', () => mine.version(id, board, versionThere)], ['restoring another board’s version', () => mine.restoreVersion(id, board, versionThere)],
      ['open', async () => { const s = await mine.document(id, boardThere); await s.ready; }]
    ];
    for (const [what, attempt] of across) expect(await code(attempt()), what).toBe('not-found');
    expect((await send(ann, id, boardThere, aSticky('x'))).status).toBe(404);
    expect((await post(ann, `${docPath(id, boardThere)}/awareness`, { update: 'AA' })).status).toBe(404);
    expect((await ann.fetch(`${h.baseUrl}/v1${docPath(id, boardThere)}/live`)).status).toBe(404);
    const held = await heldBy(ann, id);
    expect(await code(writeDocument(held, boardThere, 'boardTemplate', { template: 'retro', seed: boardThere }))).toBe('not-found');
    expect(await code(readDocument(held, boardThere, 'state', {}))).toBe('not-found');

    // Nothing changed on either board, and nothing of either reached a log.
    await rest(100);
    expect(shown(a)).toBe(here);
    expect(shown(there)).toBe(thereShown);
    expect(h.logs.join('').includes('CANARY-BOARD-WORDS')).toBe(false);
  });
});

/* ---------- what the server does with a board ---------- */

describe('a template', () => {
  it('fills a board once, however many times it’s asked, as a server-made update nobody’s undo takes away', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Retro');
    const [a, t] = await Promise.all([open(ann, id, board), open(theo, id, board)]);
    const ah = makeHistory(a.doc, a.me);
    const held = await heldBy(ann, id);
    const rows = async () => count('SELECT next_seq::int - 1 AS n FROM documents WHERE document_id = $1', [board]);

    // Five at once, then twice more, and once for another template: one template, in one update.
    const asks = await Promise.all(Array.from({ length: 5 }, () => writeDocument(held, board, 'boardTemplate', { template: 'retro', seed: board })));
    expect(asks.filter((x) => x.result)).toHaveLength(1);
    expect(await rows()).toBe(1);
    for (const template of ['retro', 'retro', 'flow'] as const) expect((await writeDocument(await heldBy(ann, id), board, 'boardTemplate', { template, seed: board })).result).toBe(false);
    expect(await rows()).toBe(1);
    // It reaches everyone who has the board open, as anyone's edit does.
    await agree([a, t], 'the template to reach both');
    expect(view(a).objects).toHaveLength(3);
    expect(view(a).frames.map((f) => [f.title, f.role])).toEqual([['Went well', ''], ['Could improve', ''], ['Actions', 'actions']]);

    // Nobody's undo takes it away, and it doesn't count as anyone's step.
    expect(ah.canUndo()).toBe(false);
    expect(ah.undo()).toEqual({ ok: true, changed: false });
    // Someone working on it doesn't make it fill again.
    const note = sticky(t, 'Kept doing standups', 20, 60);
    await saved(t);
    await agree([a, t], 'the sticky to reach Ann');
    expect(view(a).byId.get(note)?.f).toBe(view(a).frames[0]?.id);
    expect((await writeDocument(await heldBy(ann, id), board, 'boardTemplate', { template: 'ideas', seed: board })).result).toBe(false);
    await rest(150);
    expect(view(a).frames).toHaveLength(3);
    const settled = shown(a);
    // The server and a reload agree.
    expect(shown({ doc: await onServer(await heldBy(ann, id), board) })).toBe(settled);
    a.s.close();
    t.s.close();
    expect(shown(await open(theo, id, board))).toBe(settled);
    expect(refusals(board)).toEqual([]);
  });

  it('lands beside what someone put there first, carries over to a copy, and leaves a blank board blank', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const board = await make(ann, id, 'Quick');
    const a = await open(ann, id, board);
    // Someone quick puts something on it before the template lands: it fills all the same, clear of it.
    const quick = sticky(a, 'Here first', 0, 0);
    await saved(a);
    expect((await writeDocument(await heldBy(ann, id), board, 'boardTemplate', { template: 'what-why-next', seed: board })).result).toBe(true);
    await until(() => view(a).frames.length === 3, 'the template to arrive');
    const first = boxOf(a, quick);
    for (const f of view(a).frames) expect(f.x).toBeGreaterThanOrEqual(first.x + first.w);
    expect(view(a).frames.map((f) => f.title)).toEqual(['What happened', 'Why', 'What next']);

    // A copy is filled already: asking it again changes nothing.
    const copy = (await ann.api.workspaces.items.duplicate(id, board)).id;
    expect((await writeDocument(await heldBy(ann, id), copy, 'boardTemplate', { template: 'retro', seed: copy })).result).toBe(false);
    const c = await open(ann, id, copy);
    expect(shown(c)).toBe(shown(a));

    // Blank puts nothing on a board and writes nothing.
    const blank = await make(ann, id, 'Blank');
    expect((await writeDocument(await heldBy(ann, id), blank, 'boardTemplate', { template: 'blank', seed: blank })).result).toBe(false);
    expect(await count('SELECT next_seq::int - 1 AS n FROM documents WHERE document_id = $1', [blank])).toBe(0);
    expect(view(await open(ann, id, blank)).objects).toEqual([]);

    // A document isn't a board: a template gives it nothing.
    const doc = await make(ann, id, 'A document', 'document');
    expect((await writeDocument(await heldBy(ann, id), doc, 'boardTemplate', { template: 'retro', seed: doc })).result).toBe(false);
    expect(await count('SELECT next_seq::int - 1 AS n FROM documents WHERE document_id = $1', [doc])).toBe(0);
  });
});

describe('copies and versions', () => {
  /** A board with one of everything, worked on by two people. */
  async function busy(ann: Account, theo: Account) {
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Plan');
    const [a, t] = await Promise.all([open(ann, id, board), open(theo, id, board)]);
    const holder = frame(a, 'Next steps', { x: 0, y: 0, w: 600, h: 500 });
    const inside = sticky(a, 'Inside the frame', 40, 80, 'sky');
    add(a, { k: 'shape', x: 0, y: 700, w: 170, h: 76, s: 'pill', c: 'butter', t: 'Start' });
    add(a, { k: 'text', x: 300, y: 700, w: 300, h: 40, size: 'heading', t: 'A heading' });
    add(a, { k: 'link', x: 700, y: 900, w: 240, h: 64, item: madeUp() });
    addThread(a.doc, inside, 'Is this the right order?', a.me);
    await saved(a);
    await agree([a, t], 'Ann’s half to reach Theo');
    const outside = sticky(t, 'Outside it', 800, 0, 'rose');
    const line = add(t, { k: 'line', style: 'curve', from: { on: inside, side: 'r' }, to: { on: outside, side: 'l' } });
    const grid = table(t, [['Owner', 'Due'], ['Priya', 'Friday']], { x: 800, y: 300 });
    add(t, { k: 'ink', x: 0, y: 900, w: 200, h: 100, tool: 'pen', c: 'horizon', pts: [0, 0, 50, 50, 100, 20, 200, 100] });
    add(t, { k: 'shot', x: 300, y: 900, w: 320, h: 200, media: 'media0001', caption: 'The login screen' });
    type(t, inside, ', with Theo’s words');
    await saved(t);
    await agree([a, t], 'the board to reach both');
    return { id, board, a, t, holder, inside, outside, line, grid };
  }

  it('copies a board whole: every object where it was, its words, cells, lines and comments, and the copy goes its own way', async () => {
    const ann = await account();
    const theo = await account();
    const { id, board, a, inside } = await busy(ann, theo);
    const copy = (await ann.api.workspaces.items.duplicate(id, board)).id;
    expect((await ann.api.workspaces.items.get(id, copy)).name).toBe('Plan copy');
    const c = await open(ann, id, copy);
    expect(shown(c)).toBe(shown(a));
    expect(threads(c)).toBe(threads(a));
    expect(view(c).objects.length).toBeGreaterThanOrEqual(10);

    // Each goes its own way from here.
    type(c, inside, ' (in the copy)');
    moveObjects(a.doc, [{ id: inside, x: 100, y: 100 }], a.me);
    await saved(c);
    await saved(a);
    await rest(200);
    expect(words(a, inside)).not.toContain('(in the copy)');
    expect(boxOf(c, inside)).toMatchObject({ x: 40, y: 80 });
    expect(words((await open(ann, id, copy)), inside)).toContain('(in the copy)');
  });

  it('restores a version as the same board: what moved goes back, what was added goes, what was deleted comes back with its words', async () => {
    const ann = await account();
    const theo = await account();
    const { id, board, a, t, holder, inside, outside, line, grid } = await busy(ann, theo);
    const version = await versionNow(ann, id, board);
    const then = { shown: shown(a), threads: threads(a) };

    // Then a lot changes: the frame is carried off with what's in it, a sticky with words goes, things are added, typed and recoloured.
    moveObjects(a.doc, [{ id: holder, x: 2000, y: 2000 }], a.me);
    removeObjects(t.doc, [outside], t.me);
    sticky(t, 'Added since', 0, -400);
    type(a, inside, ' and more since');
    setObjects(a.doc, [inside], { c: 'lilac' }, a.me);
    const typedCell = objectText(a.doc, grid, Object.keys(cellsOf(a, grid))[0] ?? '');
    if (!typedCell) throw new Error('no cell to type in');
    a.doc.transact(() => typedCell.insert(typedCell.length, ' (changed)'), a.me);
    addThread(t.doc, inside, 'A comment since', t.me);
    await saved(a);
    await saved(t);
    await agree([a, t], 'the changes to reach both');
    expect(view(a).byId.has(line)).toBe(false);
    const changed = shown(a);
    expect(changed).not.toBe(then.shown);

    await ann.api.workspaces.restoreVersion(id, board, version);
    await until(() => shown(a) === then.shown && threads(a) === then.threads, 'the restore to reach Ann');
    await agree([a, t], 'the restore to reach Theo');
    expect(view(a).byId.get(line)).toMatchObject({ from: { on: inside }, to: { on: outside } });
    expect(words(a, outside)).toBe('Outside it');
    // The tree's name stays: a board's name is the tree's, not something on it.
    expect((await ann.api.workspaces.items.get(id, board)).name).toBe('Plan');
    // What it said before the restore was kept as a version, and restoring that brings it all back.
    const before = (await ann.api.workspaces.versions(id, board)).find((v) => v.reason === 'restore');
    if (!before) throw new Error('nothing was kept before the restore');
    await ann.api.workspaces.restoreVersion(id, board, before.id);
    await until(() => shown(a) === changed, 'everything since to come back');
    await agree([a, t], 'that to reach Theo');
    expect(view(t).byId.has(outside)).toBe(false);
    // And it's still a board anyone can work on.
    type(t, inside, '?');
    await saved(t);
    await until(() => words(a, inside).endsWith('?'), 'Theo’s typing to reach Ann');
    expect(refusals(board)).toEqual([]);
  });
});

describe('search', () => {
  it('finds a board by its words: stickies, frame titles, cells and captions, for whoever can open it and nobody else', async () => {
    const ann = await account();
    const theo = await account();
    const sam = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const board = await make(ann, id, 'Plan board');
    const a = await open(ann, id, board);
    const holder = add(a, { k: 'frame', x: 0, y: 0, w: 600, h: 500, c: '', role: 'actions', hint: 'A hint isn’t on the board', sub: 'Priya, Theo', title: 'Next steps' });
    sticky(a, 'Ship the beta', 40, 80);
    add(a, { k: 'shape', x: 800, y: 0, w: 170, h: 76, s: 'diamond', c: '', t: 'Decide' });
    add(a, { k: 'shot', x: 800, y: 200, w: 320, h: 200, media: 'media0002', caption: 'The login screen' });
    add(a, { k: 'node', x: 0, y: 700, w: 160, h: 60, parent: '', t: 'Root idea' });
    table(a, [['Owner', 'Priya']], { x: 400, y: 700 });
    addThread(a.doc, holder, 'A comment isn’t on the board', a.me);
    await saved(a);
    const secret = await make(ann, id, 'Secret board');
    const s = await open(ann, id, secret);
    sticky(s, 'CANARY-SECRET-STICKY', 0, 0);
    await saved(s);
    await ann.api.workspaces.share.restrict(id, secret, true);
    const binned = await make(ann, id, 'Binned');
    const b = await open(ann, id, binned);
    sticky(b, 'In Trash', 0, 0);
    await saved(b);
    await ann.api.workspaces.items.trash(id, binned);
    const doc = await make(ann, id, 'Just a document', 'document');
    await ann.api.workspaces.share.set(id, doc, [{ email: sam.email }], 'read');

    const collect = async (who: Account) => { const out = []; for await (const d of who.api.workspaces.searchText(id)) out.push(d); return out; };
    const mine = await collect(ann);
    expect(mine.map((d) => d.id).sort()).toEqual([board, secret, doc].sort());
    const found = mine.find((d) => d.id === board);
    expect(found).toMatchObject({ kind: 'board', name: 'Plan board', title: '' });
    const text = found?.blocks.map((x) => x.text).join('\n') ?? '';
    for (const said of ['Next steps', 'Priya, Theo', 'Ship the beta', 'Decide', 'The login screen', 'Root idea', 'Owner', 'Priya']) expect(text).toContain(said);
    // What isn't on the board isn't found: a frame's hint, a comment.
    expect(text).not.toContain('A hint');
    expect(text).not.toContain('A comment');
    expect(found?.blocks).toEqual([{ id: 'board', type: 'board', text }]);
    // Someone who can read the workspace finds what they can open; someone it only shares a document with finds that.
    const theirs = await collect(theo);
    expect(theirs.map((d) => d.id).sort()).toEqual([board, doc].sort());
    expect(JSON.stringify(theirs)).not.toContain('CANARY-SECRET');
    expect((await collect(sam)).map((d) => d.id)).toEqual([doc]);
    // The server reads the same words, for code that asks.
    const read = await readDocument(await heldBy(ann, id), board, 'text', { kind: 'board' });
    expect(read).toEqual({ title: '', blocks: found?.blocks });
    expect(await readDocument(await heldBy(ann, id), board, 'todos', { kind: 'board' })).toEqual([]);
  });
});

describe('what an honest browser sends', () => {
  it('takes a realistic session with no refusals: a 200-sticky drag on the beat, a frame carried with what it holds, a big paste, undo and redo', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'Workshop');
    const [a, t] = await Promise.all([open(ann, id, board), open(theo, id, board)]);
    const ah = makeHistory(a.doc, a.me);
    const th = makeHistory(t.doc, t.me);
    const failed: string[] = [];
    for (const tab of [a, t]) tab.s.subscribe(() => { const v = tab.s.getSnapshot(); if (v.status === 'failed') failed.push(String(v.refused)); });

    // A board people have been at for a while: a frame holding 40 stickies, and 200 more.
    const holder = frame(a, 'Sprint', { x: 0, y: 4000, w: 1800, h: 800 });
    const held = Array.from({ length: 40 }, (_, i) => sticky(a, `In the sprint ${i}`, 20 + (i % 10) * 170, 4060 + Math.floor(i / 10) * 170, 'sky'));
    const cards = Array.from({ length: 200 }, (_, i) => sticky(a, `Card ${i}`, (i % 20) * 170, Math.floor(i / 20) * 170));
    await saved(a);
    await agree([a, t], 'the board to reach Theo');
    expect(held.every((x) => view(t).byId.get(x)?.f === holder)).toBe(true);

    // All 200 dragged at once: written once a beat, 150 ms, with Theo typing and moving in the middle of it.
    const start = new Map(cards.map((x) => [x, boxOf(a, x)]));
    const moves = (step: number) => cards.map((x) => ({ id: x, x: (start.get(x)?.x ?? 0) + step * 15, y: (start.get(x)?.y ?? 0) + step * 9 }));
    ah.begin();
    for (let step = 1; step <= 14; step++) {
      moveObjects(a.doc, moves(step), a.me);
      if (step === 5) type(t, cards[0] ?? '', ', Theo typed here mid-drag');
      if (step === 9) moveObjects(t.doc, [{ id: held[0] ?? '', x: 30, y: 4070 }], t.me);
      await rest(150);
    }
    ah.end();
    // A frame carried off with everything in it, on the same beat.
    ah.begin();
    for (let step = 1; step <= 6; step++) {
      moveObjects(a.doc, [{ id: holder, x: step * 40, y: 4000 + step * 25 }], a.me);
      await rest(150);
    }
    ah.end();
    await saved(a);
    await saved(t);
    await agree([a, t], 'the drags to reach both');
    expect(boxOf(t, cards[1] ?? '')).toMatchObject({ x: (start.get(cards[1] ?? '')?.x ?? 0) + 14 * 15 });
    expect(boxOf(t, holder)).toMatchObject({ x: 240, y: 4150 });

    // A big paste: 200 copied at once, and 3,900 characters pasted into one sticky.
    const copies = duplicateObjects(a.doc, cards, { x: 24, y: 24 }, a.me);
    expect(copies).toHaveLength(200);
    type(a, cards[2] ?? '', ` ${'pasted words '.repeat(300)}`);
    await saved(a);
    await agree([a, t], 'the paste to reach Theo');
    expect(view(t).objects.filter((o) => o.k === 'note')).toHaveLength(440);

    // Undo and redo, back and forth, with Theo at it too.
    for (const press of [() => ah.undo(), () => ah.undo(), () => th.undo(), () => ah.redo(), () => ah.undo(), () => ah.undo(), () => th.redo(), () => ah.redo(), () => ah.redo()]) {
      expect(press().ok).toBe(true);
      await rest(60);
    }
    await saved(a);
    await saved(t);
    await agree([a, t], 'the presses to reach both');
    expect(refusals(board)).toEqual([]);
    expect(failed).toEqual([]);
    const settled = shown(a);

    // And a refusal would have shown: the same sticky written as Theo's client, sent by Ann, which no honest browser does.
    const forged = new Y.Doc();
    forged.clientID = t.doc.clientID;
    addObject(forged, { k: 'note', x: 0, y: 0, w: 150, h: 150, c: 'butter', size: 'm', t: 'Not Ann’s to write' }, null);
    expect((await send(ann, id, board, Y.encodeStateAsUpdate(forged))).status).toBe(400);
    expect(refusals(board)).toHaveLength(1);
    expect(refusals(board)[0]).toContain('not-theirs');
    a.s.close();
    t.s.close();
    expect(shown(await open(theo, id, board))).toBe(settled);
  });
});

describe('what’s kept', () => {
  it('holds nothing readable from a board in any table, object, notice or log: words, titles, cells, captions or comments', async () => {
    const notices: string[] = [];
    const listener = new pg.Client({ connectionString: process.env['TEST_DATABASE_URL'] ?? '' });
    await listener.connect();
    listener.on('notification', (m) => { if (m.payload) notices.push(m.payload); });
    await listener.query('LISTEN alcove_workspace');
    try {
      const ann = await account(unique('canary-board-owner'));
      const theo = await account(unique('canary-board-editor'));
      const id = await workspace(ann, 'CANARY-BOARD-SPACE', [[theo, 'edit']]);
      const board = await make(ann, id, 'CANARY-BOARD-NAME');
      await writeDocument(await heldBy(ann, id), board, 'boardTemplate', { template: 'retro', seed: board });
      const [a, t] = await Promise.all([open(ann, id, board), open(theo, id, board)]);
      add(a, { k: 'frame', x: 0, y: 1000, w: 600, h: 500, c: '', role: '', hint: 'CANARY-BOARD-HINT', sub: 'CANARY-BOARD-WHO', title: 'CANARY-BOARD-FRAME' });
      const note = sticky(a, 'CANARY-BOARD-STICKY the launch slips', 40, 1080);
      await saved(a);
      await until(() => view(t).byId.has(note), 'Theo to see the sticky');
      type(t, note, ' CANARY-BOARD-TYPED');
      table(t, [['CANARY-BOARD-CELL', 'owner']], { x: 800, y: 1000 });
      add(t, { k: 'shot', x: 800, y: 1200, w: 320, h: 200, media: 'media0003', caption: 'CANARY-BOARD-CAPTION' });
      add(a, { k: 'shape', x: 0, y: 1600, w: 170, h: 76, s: 'rect', c: '', t: 'CANARY-BOARD-SHAPE' });
      add(a, { k: 'node', x: 300, y: 1600, w: 160, h: 60, parent: '', t: 'CANARY-BOARD-NODE' });
      addThread(t.doc, note, 'CANARY-BOARD-COMMENT', t.me);
      a.s.awareness.setLocalStateField('edit', note);
      await saved(a);
      await saved(t);
      await agree([a, t], 'the board to reach both');

      // Every way a board is kept: updates, a version, a compaction, a restore, a copy, and its words read for a search.
      const version = await versionNow(ann, id, board);
      sticky(a, 'CANARY-BOARD-LATER', 600, 1600);
      await saved(a);
      await oneByOne(ann, id, board, 210, 'Filler');
      await until(() => compacted(board), 'the log to compact');
      await ann.api.workspaces.restoreVersion(id, board, version);
      await until(() => !JSON.stringify(view(a).objects).includes('CANARY-BOARD-LATER'), 'the restore');
      await ann.api.workspaces.items.duplicate(id, board);
      let searched = '';
      for await (const d of ann.api.workspaces.searchText(id)) searched += JSON.stringify(d);
      expect(searched).toContain('CANARY-BOARD-STICKY');
      await rest(100);

      const everyTable = (await h.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name);
      const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (${everyTable.map((x) => `SELECT row_to_json(x)::text AS t FROM ${x} x`).join(' UNION ALL ')}) q`);
      const rows = String(dump.rows[0]?.all ?? '');
      expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [board])).toBeGreaterThan(0);
      expect(notices.some((n) => n.includes(board))).toBe(true);
      const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
      const canaries = ['CANARY-BOARD', 'canary-board', 'launch slips', ann.name, theo.name];
      for (const canary of canaries) {
        for (const enc of encodings(canary)) {
          expect(rows.includes(enc), `${canary} as ${enc} in a table`).toBe(false);
          expect(notices.join(' ').includes(enc), `${canary} as ${enc} in a notice`).toBe(false);
          expect(h.logs.join('').includes(enc), `${canary} as ${enc} in a log`).toBe(false);
        }
      }
      for await (const obj of h.objects.list()) {
        const bytes = Buffer.from(await h.objects.get(obj.id));
        for (const canary of canaries) for (const enc of encodings(canary)) expect(bytes.includes(Buffer.from(enc)), `${canary} in ${obj.id}`).toBe(false);
      }
    } finally {
      await listener.end();
    }
  });
});

/** A table's cells as they read, by key. */
function cellsOf(t: { doc: Y.Doc }, id: string): Record<string, string> {
  const o = view(t).byId.get(id);
  return o?.k === 'table' ? o.cells : {};
}
/** How many objects the bucket holds. */
async function objectCount(): Promise<number> {
  let n = 0;
  for await (const obj of h.objects.list()) if (obj.id) n++;
  return n;
}
