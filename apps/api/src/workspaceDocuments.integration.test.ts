/**
 * Live documents: people working on one document together, through browsers talking to the real API over HTTP via
 * @alcove/api-http, on real Postgres and, for guests, a real call. What's checked is what people get: their words, after
 * dropped connections, restarts and compactions, and nothing for anyone who can't open it.
 */
import {
  AlcoveApiError, DOC_SEED, DocLiveEventSchema, MAX_DOC_UPDATE_BYTES, OPERATION_HEADER, toBase64Url, type CallState, type DocLiveEvent, type DocSession, type DocSessionOptions, type ItemKind,
  type KeptUpdate, type KeptUpdates, type WorkspaceHere, type WorkspaceLive, type WorkspaceRole
} from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeAwarenessUpdate, Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { blindIndex } from './crypto';
import { maintain } from './maintenance';
import { openState, sealState, workspaceFor, type WorkspaceState } from './modules/workspaceAccess';
import { documentText, documentTodos } from './modules/documentText';
import { keepVersion, readDocument, writeDocument } from './modules/workspaceDocuments';
import { findOwner, masterKey } from './owners';
import { startHarness, type Browser, type Harness } from './testing/harness';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => h.closeCalls());

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
const madeUp = () => randomBytes(16).toString('base64url');
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AlcoveApiError ? { code: e.code, message: e.message, status: e.status } : { code: 'not-an-api-error', message: String(e), status: 0 }));
const code = async (p: Promise<unknown>) => (await refusal(p))?.code ?? 'allowed';
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
const ownerOf = async (workspaceId: string) => (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]?.owner_id ?? '';
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const make = async (who: Account, id: string, kind: ItemKind, name: string, parent: string | null = null) => (await who.api.workspaces.items.create(id, { kind, name, parent })).id;
const body = (s: { doc: Y.Doc }) => s.doc.getXmlFragment('content').toString();

/** Writes a workspace's sealed state as it's stored, for a time no test waits for. */
async function rewrite(workspaceId: string, change: (s: WorkspaceState) => WorkspaceState) {
  const ownerId = await ownerOf(workspaceId);
  const owner = await findOwner(h.deps, ownerId, undefined);
  const row = (await h.pool.query<{ state_ciphertext: Buffer }>('SELECT state_ciphertext FROM workspaces WHERE owner_id = $1', [ownerId])).rows[0];
  if (!owner || !row) throw new Error('no such workspace');
  await h.pool.query('UPDATE workspaces SET state_ciphertext = $2 WHERE owner_id = $1', [ownerId, sealState(owner, workspaceId, change(openState(owner, workspaceId, row.state_ciphertext)))]);
}
/** A workspace as a person with this address has it, for the helpers other modules call. */
const heldBy = (who: Account, workspaceId: string) => workspaceFor(h.deps, { email: who.email, principals: [blindIndex(masterKey(h.deps), 'email', who.email)] }, workspaceId);

/* ---------- a Yjs document, as an editor would change one ---------- */

/** The words of a block, by its ID: the seed's first line is `first`. Made on first use, as typing into an empty line does. */
function line(s: { doc: Y.Doc }, block = 'first'): Y.XmlText {
  for (const el of s.doc.getXmlFragment('content').toArray()) {
    if (!(el instanceof Y.XmlElement) || el.getAttribute('id') !== block) continue;
    const words = el.get(0);
    if (words instanceof Y.XmlText) return words;
    const made = new Y.XmlText();
    el.insert(0, [made]);
    return made;
  }
  throw new Error(`no block ${block}`);
}
/** What a block says now, without touching it. */
const words = (s: { doc: Y.Doc }, block = 'first') => s.doc.getXmlFragment('content').toArray().flatMap((el) => (el instanceof Y.XmlElement && el.getAttribute('id') === block ? el.toArray() : [])).map((x) => (x instanceof Y.XmlText ? x.toString() : '')).join('');
function title(s: { doc: Y.Doc }): Y.XmlText {
  const el = s.doc.getXmlFragment('content').get(0);
  if (!(el instanceof Y.XmlElement)) throw new Error('no title');
  const text = el.get(0);
  if (text instanceof Y.XmlText) return text;
  const made = new Y.XmlText();
  el.insert(0, [made]);
  return made;
}
/** Attributes as y-prosemirror writes them: of any type, though Yjs's types say strings. */
const setAttr = (el: Y.XmlElement, name: string, value: unknown) => { Reflect.apply(el.setAttribute, el, [name, value]); };
const blockOf = (type: string, attrs: Record<string, unknown> = {}): Y.XmlElement => {
  const el = new Y.XmlElement(type);
  for (const [k, v] of Object.entries(attrs)) setAttr(el, k, v);
  return el;
};
function addBlock(s: { doc: Y.Doc }, type: string, id: string, attrs: Record<string, unknown> = {}): Y.XmlElement {
  const el = blockOf(type, { id, ...attrs });
  const fragment = s.doc.getXmlFragment('content');
  fragment.insert(fragment.length, [el]);
  return el;
}
/** An inline node between words, as y-prosemirror writes one. */
const inline = (type: string, attrs: Record<string, string>) => {
  const el = new Y.XmlElement(type);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/* ---------- a browser and its network ---------- */

/** Opens a document and waits for its first sync. */
async function open(who: Browser, id: string, doc: string, opts: DocSessionOptions = {}): Promise<DocSession> {
  const s = who.api.workspaces.document(id, doc, opts);
  await s.ready;
  return s;
}
const saved = (s: DocSession, what = 'everything to reach Alcove') => until(() => s.getSnapshot().status === 'saved', what);
const says = (s: { doc: Y.Doc }, text: string, what = text) => until(() => body(s).includes(text), `the document to say ${what}`);
/** A connection that can drop: every stream and request fails until it's back. */
function network(b: Browser) {
  let down = false;
  const open = new Set<AbortController>();
  const net: typeof fetch = async (input, init) => {
    if (down) throw new TypeError('The network is down.');
    const stop = new AbortController();
    open.add(stop);
    const signal = init?.signal ? AbortSignal.any([init.signal, stop.signal]) : stop.signal;
    return b.fetch(input, { ...init, signal });
  };
  return { browser: h.browser({ fetch: net }), drop: () => { down = true; for (const s of open) s.abort(); open.clear(); }, back: () => { down = false; } };
}
/** A browser's store of what's waiting to send, kept here across "reloads". */
function keepStore() {
  let next = 1;
  const kept: KeptUpdate[] = [];
  const keep: KeptUpdates = {
    load: async () => [...kept],
    add: async (update) => { const key = next++; kept.push({ key, update }); return key; },
    remove: async (keys) => { for (const key of keys) { const at = kept.findIndex((k) => k.key === key); if (at >= 0) kept.splice(at, 1); } }
  };
  return { keep, kept };
}
/** Reads a document's stream as a browser does, keeping each line. */
function stream(base: string, f: typeof fetch, id: string, doc: string, after = 0, pass?: string) {
  const lines: DocLiveEvent[] = [];
  const stop = new AbortController();
  const out = { lines, status: 0, ended: false, stop: () => stop.abort() };
  void (async () => {
    const res = await f(`${base}/v1/workspaces/${id}/documents/${doc}/live?after=${after}`, { signal: stop.signal, ...(pass ? { headers: { 'x-alcove-call': pass } } : {}) });
    out.status = res.status;
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
const post = (who: { fetch: typeof fetch }, path: string, sent: unknown, base = h.baseUrl) => who.fetch(`${base}/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sent) });
const docPath = (id: string, doc: string) => `/workspaces/${id}/documents/${doc}`;
/** A real update: `text` in a document that starts from the seed. */
function anUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, DOC_SEED);
  const before = Y.encodeStateVector(doc);
  line({ doc }).insert(0, text);
  return Y.encodeStateAsUpdate(doc, before);
}
/** Where a document's log stands: the rows left in it, and how far its snapshot reaches. Every document starts from one through 0. */
const rowsOf = async (doc: string) => ({
  updates: await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc]),
  through: await count('SELECT coalesce(max(through_seq), 0)::int AS n FROM document_snapshots WHERE document_id = $1', [doc])
});
const compacted = async (doc: string) => (await rowsOf(doc)).through > 0;
/** As if the last edit, or the last version, was an hour ago. */
const backdate = async (doc: string) => { await h.pool.query("UPDATE documents SET created_at = now() - interval '1 hour', version_at = CASE WHEN version_at IS NULL THEN NULL ELSE now() - interval '1 hour' END WHERE document_id = $1", [doc]); };

describe('a document', () => {
  it('has its title and first line from the moment it’s made, so someone who can only read never writes', async () => {
    const ann = await account();
    const rita = await account();
    const id = await workspace(ann, 'Ours', [[rita, 'read']]);
    const doc = await make(ann, id, 'document', 'Blank');
    expect(await rowsOf(doc)).toEqual({ updates: 0, through: 0 });
    const r = await open(rita, id, doc);
    expect(body(r)).toBe('<title></title><line id="first"></line>');
    await rest(250);
    expect(r.getSnapshot()).toMatchObject({ status: 'saved', role: 'read' });
    expect(await rowsOf(doc)).toEqual({ updates: 0, through: 0 });
    expect(await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc])).toBe(1);
    // The server reads it the same way, and a board starts with nothing, because a board isn't a document.
    expect((await readDocument(await heldBy(ann, id), doc)).getXmlFragment('content').length).toBe(2);
    const board = await make(ann, id, 'board', 'Board');
    expect((await readDocument(await heldBy(ann, id), board)).getXmlFragment('content').length).toBe(0);
  });

  it('starts from the same seed in every browser, so two people opening a new one get one title', async () => {
    // The editor's seed, made as the editor makes it: the bytes are fixed for good.
    const made = new Y.Doc();
    made.clientID = 1;
    const first = new Y.XmlElement('line');
    first.setAttribute('id', 'first');
    made.getXmlFragment('content').insert(0, [new Y.XmlElement('title'), first]);
    expect(toBase64Url(Y.encodeStateAsUpdate(made))).toBe(toBase64Url(DOC_SEED));

    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', '');
    const [a, t] = await Promise.all([open(ann, id, doc), open(theo, id, doc)]);
    // Each of them is told the same start, and typing a title at once makes one title.
    expect(body(a)).toBe('<title></title><line id="first"></line>');
    expect(body(t)).toBe(body(a));
    title(a).insert(0, 'Ann');
    title(t).insert(0, 'Theo');
    await saved(a);
    await saved(t);
    await until(() => body(a) === body(t) && body(a).includes('Ann') && body(a).includes('Theo'), 'both to hear each other');
    expect(a.doc.getXmlFragment('content').length).toBe(2);
    const again = await open(ann, id, doc);
    expect(body(again)).toBe(body(a));
    // A server-made write lands in the same first line, not a second title.
    await writeDocument(await heldBy(ann, id), doc, (d) => { line({ doc: d }).insert(0, 'From the server'); });
    await says(a, 'From the server');
    expect(a.doc.getXmlFragment('content').length).toBe(2);
  });

  it('lets two people edit at once, and each hears the other, in the order it happened and whole after a reload', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const [a, t] = await Promise.all([open(ann, id, doc), open(theo, id, doc)]);
    expect(a.getSnapshot()).toEqual({ status: 'saved', refused: null, role: 'edit', trashed: false, closed: null });

    line(a).insert(0, 'Hello');
    expect(a.getSnapshot().status).toBe('saving');
    await saved(a);
    await says(t, 'Hello');
    // Interleaved, from both ends, with neither waiting for the other.
    for (let i = 0; i < 40; i++) {
      line(a).insert(0, 'a');
      line(t).insert(line(t).length, 'b');
      if (i % 7 === 0) await rest(20);
    }
    await saved(a);
    await saved(t);
    await until(() => body(a) === body(t) && line(a).length === 85, 'the two to converge');
    const text = words(a);
    expect(text.match(/a/g)).toHaveLength(40);
    expect(text.match(/b/g)).toHaveLength(40);
    expect(text).toContain('Hello');
    a.close();
    t.close();
    // A reload reads it back from the log: the same words.
    const reloaded = await open(ann, id, doc);
    expect(words(reloaded)).toBe(text);
  });

  it('holds any kind of content: comments, marks and whatever a board keeps, because it never looks inside to store it', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const board = await make(ann, id, 'board', 'Board');
    const b = await open(ann, id, board);
    // A board doesn't start from a document's seed.
    expect(b.doc.getXmlFragment('content').length).toBe(0);
    b.doc.getMap('shapes').set('one', { x: 1 });
    b.doc.getArray('order').push(['one']);
    await saved(b);
    const again = await open(ann, id, board);
    expect(again.doc.getMap('shapes').get('one')).toEqual({ x: 1 });
    expect(again.doc.getXmlFragment('content').length).toBe(0);

    const doc = await make(ann, id, 'document', 'Doc');
    const d = await open(ann, id, doc);
    const threads = d.doc.getMap<Y.Map<unknown>>('comments');
    d.doc.transact(() => {
      const thread = new Y.Map<unknown>();
      const replies = new Y.Array<unknown>();
      replies.push([{ id: 'm1', text: 'A comment' }]);
      thread.set('replies', replies);
      threads.set('t1', thread);
      line(d).insert(0, 'marked', { comment: { id: 't1' } });
    });
    await saved(d);
    const read = await open(ann, id, doc);
    expect(read.doc.getMap<Y.Map<Y.Array<unknown>>>('comments').get('t1')?.get('replies')?.toArray()).toEqual([{ id: 'm1', text: 'A comment' }]);
    expect(line(read).toDelta()).toEqual([{ insert: 'marked', attributes: { comment: { id: 't1' } } }]);
  });

  it('refuses what isn’t an update, and what’s too big, and says so in the status', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const updates = `${docPath(id, doc)}/updates`;
    const up = (update: string) => post(ann, updates, { update });
    expect((await up('')).status).toBe(400);
    expect((await up('not base64url!')).status).toBe(400);
    expect((await up(toBase64Url(new TextEncoder().encode('{"not":"an update"}')))).status).toBe(400);
    expect((await up(toBase64Url(randomBytes(64)))).status).toBe(400);
    expect((await post(ann, updates, {})).status).toBe(400);
    const tooBig = new Uint8Array(MAX_DOC_UPDATE_BYTES + 1);
    expect((await up(toBase64Url(tooBig))).status).toBe(400);
    expect(await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc])).toBe(1);
    expect((await up(toBase64Url(anUpdate('A real one')))).status).toBe(200);

    // More in one go than the API takes: the browser says so, and keeps it.
    const s = await open(ann, id, doc);
    line(s).insert(0, 'x'.repeat(MAX_DOC_UPDATE_BYTES + 10));
    await until(() => s.getSnapshot().status === 'failed', 'the save to fail');
    expect(s.getSnapshot().refused).toBe('too-large');
    expect(line(s).length).toBeGreaterThan(MAX_DOC_UPDATE_BYTES);
    // A paste of several parts of a doc's limit goes, as long as each part fits.
    const fine = await open(ann, id, doc);
    for (let i = 0; i < 3; i++) { line(fine).insert(0, 'y'.repeat(400 * 1024)); await rest(170); }
    await saved(fine);
    expect(line(await open(ann, id, doc)).length).toBeGreaterThanOrEqual(1200 * 1024);
  });

  it('keeps no receipt of an update, because it would hold content, and a retry changes nothing', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const update = toBase64Url(anUpdate('Once'));
    const send = () => ann.fetch(`${h.baseUrl}/v1${docPath(id, doc)}/updates`, { method: 'POST', headers: { 'content-type': 'application/json', [OPERATION_HEADER]: madeUp() }, body: JSON.stringify({ update }) });
    await send();
    await send();
    expect(await count("SELECT count(*)::int AS n FROM operations WHERE owner_id = $1 AND method LIKE '%document%'", [ann.ownerId])).toBe(0);
    expect(words(await open(ann, id, doc))).toBe('Once');
  });

  it('follows the tree: a copy holds what the original holds, as it stands, and goes its own way', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const folder = await make(ann, id, 'folder', 'Folder');
    const doc = await make(ann, id, 'document', 'Plan', folder);
    const s = await open(ann, id, doc);
    title(s).insert(0, 'Plan');
    line(s).insert(0, 'What it says');
    await saved(s);
    const copy = await ann.api.workspaces.items.duplicate(id, doc);
    const c = await open(ann, id, copy.id);
    expect(words(c)).toBe('What it says');
    // Its title says what the tree says.
    expect(title(c).toString()).toBe('Plan copy');
    line(c).insert(0, 'Only the copy: ');
    line(s).insert(0, 'Only the original: ');
    await saved(c);
    await saved(s);
    await rest(100);
    expect(words(c)).toBe('Only the copy: What it says');
    expect(words(s)).toBe('Only the original: What it says');
    // A folder's copy holds copies too.
    const folderCopy = await ann.api.workspaces.items.duplicate(id, folder);
    const inside = (await ann.api.workspaces.get(id)).items.filter((i) => i.parent === folderCopy.id);
    expect(inside.length).toBeGreaterThan(0);
    for (const item of inside) expect(body(await open(ann, id, item.id))).toContain('What it says');
  });

  it('moves the tree’s edited time on as people write, without rewriting the tree for every key', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const old = new Date(Date.now() - 3_600_000).toISOString();
    await rewrite(id, (s) => { const it = s.items[doc]; return it ? { ...s, items: { ...s.items, [doc]: { ...it, editedAt: old } } } : s; });
    const s = await open(ann, id, doc);
    line(s).insert(0, 'Edited');
    await saved(s);
    const edited = async () => (await ann.api.workspaces.items.get(id, doc)).editedAt;
    await until(async () => (await edited()) !== old, 'the tree to say it was edited');
    const version = await count('SELECT version::int AS n FROM workspaces WHERE workspace_id = $1', [id]);
    for (let i = 0; i < 4; i++) { line(s).insert(0, 'x'); await saved(s); }
    expect(await count('SELECT version::int AS n FROM workspaces WHERE workspace_id = $1', [id])).toBe(version);
  });
});

describe('through a dropped connection', () => {
  it('keeps both people’s words when they type in one line, one of them cut off, and a reload shows the merged text', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const annNet = network(ann);
    const theoNet = network(theo);
    const a = await open(annNet.browser, id, doc);
    const t = await open(theoNet.browser, id, doc);
    line(a).insert(0, 'The launch is in May');
    await saved(a);
    await says(t, 'The launch is in May');

    annNet.drop();
    await until(() => a.getSnapshot().status === 'offline', 'the document to say it’s offline');
    // In the same line, at the same moment, in the same place.
    line(a).insert(16, 'early ');
    line(a).insert(line(a).length, ', and Ann says so');
    line(t).insert(16, 'late ');
    line(t).insert(0, 'Theo: ');
    await saved(t);
    await rest(300);
    expect(words(a)).not.toContain('late');
    expect(a.getSnapshot().status).toBe('offline');

    // Dropped for Theo as well, typing all the while, then back in the other order.
    theoNet.drop();
    line(t).insert(line(t).length, ' (Theo offline)');
    annNet.back();
    await saved(a);
    theoNet.back();
    await saved(t);
    await until(() => body(a) === body(t), 'the two to converge');
    for (const part of ['early ', 'late ', 'Theo: ', ', and Ann says so', ' (Theo offline)', 'The launch is in']) expect(words(a)).toContain(part);
    // And it's the log that has it, not only the browsers.
    const reloaded = await open(ann, id, doc);
    expect(words(reloaded)).toBe(words(a));
  });

  it('merges a client that was offline across a compaction, whatever happened to what it was editing', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const a = await open(ann, id, doc);
    addBlock(a, 'line', 'kept');
    addBlock(a, 'line', 'gone');
    line(a, 'kept').insert(0, 'This line stays');
    line(a, 'gone').insert(0, 'This line is deleted');
    line(a).insert(0, 'delete me then');
    await saved(a);
    const net = network(theo);
    const t = await open(net.browser, id, doc);
    await says(t, 'This line is deleted');
    net.drop();
    await until(() => t.getSnapshot().status === 'offline', 'Theo to be offline');
    line(t, 'kept').insert(4, ' Theo’s');
    line(t).insert(0, 'Theo: ');
    line(t, 'gone').insert(0, 'Typed into a line someone deletes: ');

    // Meanwhile the words Theo typed next to are deleted, the line Theo typed in goes, and everything compacts.
    line(a).delete(0, 'delete me'.length);
    const fragment = a.doc.getXmlFragment('content');
    const at = fragment.toArray().findIndex((e) => e instanceof Y.XmlElement && e.getAttribute('id') === 'gone');
    fragment.delete(at, 1);
    await saved(a);
    for (let i = 0; i < 220; i++) await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(a.doc)) });
    await until(() => compacted(doc), 'the log to compact');
    const before = await rowsOf(doc);
    expect(before.updates).toBeLessThan(100);

    net.back();
    await saved(t);
    await until(() => body(a) === body(t), 'Theo to merge with everyone else');
    expect(words(a, 'kept')).toBe('This Theo’s line stays');
    expect(words(a)).toContain('Theo: ');
    expect(words(a)).toContain(' then');
    expect(body(a)).not.toContain('Typed into a line');
    expect(body(await open(ann, id, doc))).toBe(body(a));
  });

  it('keeps what’s typed offline through a reload, and sends it on return', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const t = await open(theo, id, doc);
    const { keep, kept } = keepStore();
    const net = network(ann);
    const first = await open(net.browser, id, doc, { keep });
    line(first).insert(0, 'Before.');
    await saved(first);
    expect(kept).toEqual([]);

    net.drop();
    await until(() => first.getSnapshot().status === 'offline', 'the document to be offline');
    line(first).insert(line(first).length, ' Typed offline.');
    await until(() => kept.length > 0, 'the edit to be kept here');
    line(first).insert(line(first).length, ' And more.');
    await until(() => kept.length > 1, 'the next edit to be kept here');
    // The tab goes, with nothing sent.
    first.close();
    await rest(50);
    expect(kept.length).toBeGreaterThan(1);
    expect(body(t)).not.toContain('Typed offline');

    // Back in a new tab, and it reaches everyone with nobody touching it.
    net.back();
    const second = await open(net.browser, id, doc, { keep });
    await saved(second);
    expect(words(second)).toBe('Before. Typed offline. And more.');
    await says(t, 'Typed offline. And more.');
    await until(() => kept.length === 0, 'what was kept to go once Alcove has it');
  });

  it('resumes where it left off: only what it missed, nothing lost, nothing applied twice', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const a = await open(ann, id, doc);
    line(a).insert(0, 'One');
    await saved(a);
    const net = network(theo);
    const t = await open(net.browser, id, doc);
    await says(t, 'One');
    const from = await count('SELECT next_seq::int - 1 AS n FROM documents WHERE document_id = $1', [doc]);

    // Exactly what a stream resumed at `after` sends: everything since, and its first line says how far that reaches.
    line(a).insert(3, ' two');
    await saved(a);
    const resumed = stream(h.baseUrl, theo.fetch, id, doc, from);
    await until(() => resumed.lines.length > 0, 'the resumed stream');
    const [sync] = resumed.lines;
    if (sync?.type !== 'sync') throw new Error('the first line isn’t a sync');
    expect(sync.seq).toBe(from + 1);
    const head = new Y.Doc();
    Y.applyUpdate(head, Y.encodeStateAsUpdate(t.doc));
    Y.applyUpdate(head, Buffer.from(sync.update, 'base64url'));
    expect(words({ doc: head })).toContain('One two');
    // Whole state is much more than what was missed.
    const whole = stream(h.baseUrl, theo.fetch, id, doc);
    await until(() => whole.lines.length > 0, 'a stream from the start');
    const [all] = whole.lines;
    if (all?.type !== 'sync') throw new Error('the first line isn’t a sync');
    expect(sync.update.length).toBeLessThan(all.update.length);
    // Nothing new since `after`: nothing to send.
    const current = stream(h.baseUrl, theo.fetch, id, doc, sync.seq);
    await until(() => current.lines.length > 0, 'a stream already up to date');
    const [nothing] = current.lines;
    expect(nothing).toMatchObject({ type: 'sync', seq: sync.seq });
    if (nothing?.type === 'sync') expect(nothing.update.length).toBeLessThan(8);
    for (const s of [resumed, whole, current]) s.stop();

    // A browser that drops and comes back gets the same, and its document says it once.
    net.drop();
    await until(() => t.getSnapshot().status === 'offline', 'Theo to be offline');
    line(a).insert(line(a).length, ' three');
    line(t).insert(0, 'Zero ');
    await saved(a);
    net.back();
    await saved(t);
    await until(() => words(t) === words(a) && words(a) === 'Zero One two three', 'the two to converge');
    // Asking again changes nothing, however many times the same update comes.
    await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(a.doc)) });
    await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(a.doc)) });
    await rest(100);
    expect(words(t)).toBe('Zero One two three');
    expect(words(await open(ann, id, doc))).toBe('Zero One two three');
  });

  it('survives the API restarting mid-edit: what it acknowledged is there, and what it didn’t is sent again', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    let server = await h.secondServer();
    let base = server.baseUrl;
    const via = (who: Account): typeof fetch => (input, init) => who.fetch(String(input).replace(h.baseUrl, base), init);
    const a = await open(h.browser({ fetch: via(ann) }), id, doc);
    const t = await open(h.browser({ fetch: via(theo) }), id, doc);
    line(a).insert(0, 'Acknowledged.');
    await saved(a);
    await says(t, 'Acknowledged.');

    // It stops, as a deploy stops it, while people type on.
    await server.close();
    line(a).insert(line(a).length, ' Typed while it was down.');
    line(t).insert(0, 'Theo too. ');
    await until(() => a.getSnapshot().status === 'offline' && t.getSnapshot().status === 'offline', 'both to say so');

    // A new process, with nothing in memory.
    server = await h.secondServer();
    base = server.baseUrl;
    await until(() => a.getSnapshot().status === 'saved' && t.getSnapshot().status === 'saved', 'both to save again');
    await until(() => body(a) === body(t), 'the two to converge');
    expect(words(a)).toBe('Theo too. Acknowledged. Typed while it was down.');
    // Sealed records open on a process that never saw them.
    a.close();
    t.close();
    await server.close();
    const next = await h.secondServer();
    base = next.baseUrl;
    const read = await open(h.browser({ fetch: via(ann) }), id, doc);
    expect(words(read)).toBe('Theo too. Acknowledged. Typed while it was down.');
    read.close();
    await next.close();
  });

  it('catches up when an instance’s connection to the database drops, and misses nothing said meanwhile', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const a = await open(ann, id, doc);
    const t = await open(theo, id, doc);
    line(a).insert(0, 'Before. ');
    await says(t, 'Before.');
    await h.pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'alcove-hub'");
    // Said while nobody may be listening.
    line(a).insert(line(a).length, 'Meanwhile. ');
    await saved(a);
    await says(t, 'Meanwhile.');
    await until(async () => (await count("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'alcove-hub'")) === 1, 'the hub to listen again');
    line(a).insert(line(a).length, 'After.');
    await says(t, 'After.');
  });

  it('picks up quietly when the API lets go of a stream, as it does every few minutes', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer({ LIVE_STREAM_MS: 150 });
    const there = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
    const s = there.workspaces.document(id, doc);
    const seen = new Set<string>();
    s.subscribe(() => seen.add(s.getSnapshot().status));
    try {
      await s.ready;
      await rest(500);
      line(s).insert(0, 'Through it');
      await saved(s);
      const other = await open(ann, id, doc);
      line(other).insert(0, 'And back: ');
      await saved(other);
      await until(() => words(s).startsWith('And back: '), 'the stream to carry on');
      expect([...seen].sort()).toEqual(['saved', 'saving']);
    } finally {
      s.close();
      await second.close();
    }
  });

  it('notices a stream gone quiet without closing, and opens it again', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    let held = 0;
    const stalls: typeof fetch = (input, init) => {
      if (String(input).includes('/live') && held++ === 1) {
        const silent = new ReadableStream<Uint8Array>({ start(c) { init?.signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError'))); } });
        return Promise.resolve(new Response(silent, { status: 200 }));
      }
      return ann.fetch(input, init);
    };
    const quiet = createHttpApi({ baseUrl: h.baseUrl, fetch: stalls, liveQuietMs: 100 });
    const s = quiet.workspaces.document(id, doc);
    try {
      await s.ready;
      await until(() => held >= 3, 'the stream to be opened again');
    } finally {
      s.close();
    }
  });
});

describe('the log', () => {
  it('compacts past 200 updates into a snapshot, keeping every word, and removes the rows it covers', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, DOC_SEED);
    const push = async (n: number, what: string) => {
      for (let i = 0; i < n; i++) {
        const before = Y.encodeStateVector(scratch);
        line({ doc: scratch }).insert(line({ doc: scratch }).length, `${what}${i} `);
        await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(scratch, before)) });
      }
    };
    await push(199, 'a');
    expect(await rowsOf(doc)).toEqual({ updates: 199, through: 0 });
    await push(1, 'a');
    await until(() => compacted(doc), 'a snapshot');
    // All but the newest, which streams are reading at that moment.
    expect(await rowsOf(doc)).toEqual({ updates: 1, through: 199 });
    await push(5, 'b');
    expect(await rowsOf(doc)).toEqual({ updates: 6, through: 199 });
    expect(await count('SELECT updates_since_snapshot AS n FROM documents WHERE document_id = $1', [doc])).toBe(6);
    expect(await count('SELECT bytes_since_snapshot::int AS n FROM documents WHERE document_id = $1', [doc])).toBeGreaterThan(0);
    const text = words({ doc: scratch });
    expect(words(await open(ann, id, doc))).toBe(text);
    expect(text.startsWith('a0 a1 ')).toBe(true);
    expect(text).toContain(' b4');
  });

  it('compacts past 1 MiB, however few updates that is', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    for (let i = 0; i < 3; i++) await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate(`${i}`.repeat(512 * 1024))) });
    await until(() => compacted(doc), 'a snapshot');
    expect((await rowsOf(doc)).updates).toBeLessThan(3);
  });

  it('drops deleted words at compaction, so nobody who opens it later is sent them, and it never grows without end', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const s = await open(ann, id, doc);
    line(s).insert(0, 'CANARY-DELETED-WORDS');
    line(s).delete(0, line(s).length);
    line(s).insert(0, 'What stayed');
    await saved(s);
    // Whoever opens it now is sent a state, not the history: deleted words aren't in it, compacted or not.
    const raw = stream(h.baseUrl, ann.fetch, id, doc);
    await until(() => raw.lines.length > 0, 'the first line');
    const [sync] = raw.lines;
    if (sync?.type !== 'sync') throw new Error('the first line isn’t a sync');
    expect(Buffer.from(sync.update, 'base64url').includes('CANARY-DELETED')).toBe(false);
    expect(Buffer.from(sync.update, 'base64url').includes('What stayed')).toBe(true);
    raw.stop();

    for (let i = 0; i < 210; i++) { line(s).insert(0, 'x'); await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(s.doc)) }); }
    await until(() => compacted(doc), 'a snapshot');
    const read = await readDocument(await heldBy(ann, id), doc);
    expect(Buffer.from(Y.encodeStateAsUpdate(read)).includes('CANARY-DELETED')).toBe(false);
    expect(words({ doc: read })).toContain('What stayed');
  });

  it('is safe against two instances writing and compacting at once', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer();
    const a = await open(ann, id, doc);
    const t = createHttpApi({ baseUrl: second.baseUrl, fetch: theo.fetch }).workspaces.document(id, doc);
    await t.ready;
    try {
      // Every update its own request, from both instances at the same time.
      const one = async (who: Account, base: string, tag: string) => {
        const writer = new Y.Doc();
        Y.applyUpdate(writer, DOC_SEED);
        const sends: Promise<Response>[] = [];
        for (let i = 0; i < 220; i++) {
          const before = Y.encodeStateVector(writer);
          line({ doc: writer }).insert(0, `${tag}${i};`);
          sends.push(post(who, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(writer, before)) }, base));
          if (i % 8 === 7) await Promise.all(sends.splice(0));
        }
        return Promise.all(sends);
      };
      await Promise.all([one(ann, h.baseUrl, 'a'), one(theo, second.baseUrl, 't')]);
      await until(() => compacted(doc), 'a snapshot');
      // Every seq used once and in order, nothing covered twice, and both browsers end up with everything.
      expect(await count('SELECT next_seq::int - 1 AS n FROM documents WHERE document_id = $1', [doc])).toBe(440);
      const through = await count('SELECT through_seq::int AS n FROM document_snapshots WHERE document_id = $1', [doc]);
      const left = await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc]);
      expect(through + left).toBe(440);
      await until(() => body(a) === body(t) && (body(a).match(/;/g) ?? []).length === 440, 'both browsers to have every update');
    } finally {
      t.close();
      await second.close();
    }
  });

  it('reads one notice once on an instance, however many are listening', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const sessions = await Promise.all([open(ann, id, doc), open(ann, id, doc), open(theo, id, doc), open(theo, id, doc)]);
    await rest(200);
    const from = h.logs.length;
    await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate('Once')) });
    await until(() => sessions.every((s) => words(s) === 'Once'), 'every session to hear');
    expect(h.logs.slice(from).filter((l) => l.includes('SELECT seq, update_ciphertext FROM document_updates'))).toHaveLength(1);
  });

  it('seals each record to its place: copied to another seq, document or workspace, it doesn’t open', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const other = await make(ann, id, 'document', 'Other');
    await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate('Sealed')) });
    const owner = await ownerOf(id);
    // Into another document's log.
    await h.pool.query(`INSERT INTO document_updates (owner_id, document_id, seq, update_ciphertext) SELECT owner_id, $2, 1, update_ciphertext FROM document_updates WHERE owner_id = $1 AND document_id = $3`, [owner, other, doc]);
    await h.pool.query('UPDATE documents SET next_seq = 2 WHERE owner_id = $1 AND document_id = $2', [owner, other]);
    expect(await code(open(ann, id, other))).toBe('key-unavailable');
    // Or further on in its own.
    await h.pool.query('UPDATE document_updates SET seq = 7 WHERE owner_id = $1 AND document_id = $2', [owner, doc]);
    await h.pool.query('UPDATE documents SET next_seq = 8 WHERE owner_id = $1 AND document_id = $2', [owner, doc]);
    expect(await code(open(ann, id, doc))).toBe('key-unavailable');
  });
});

describe('streams', () => {
  it('cost nothing while nothing happens: a ping reads nothing of the document or the tree', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer({ LIVE_PING_MS: 40 });
    const s = stream(second.baseUrl, ann.fetch, id, doc);
    try {
      await until(() => s.lines.filter((l) => l.type === 'ping').length >= 1, 'a ping');
      const from = h.logs.length;
      const pings = s.lines.length;
      await until(() => s.lines.length >= pings + 4, 'more pings');
      const reads = h.logs.slice(from).filter((l) => /FROM document_updates|FROM document_snapshots|state_ciphertext/.test(l));
      expect(reads).toEqual([]);
    } finally {
      s.stop();
      await second.close();
    }
  });

  it('end on the clock, however busy the document is, so signing out ends one that never goes quiet', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer({ LIVE_PING_MS: 100 });
    const s = stream(second.baseUrl, theo.fetch, id, doc);
    let busy = true;
    const typing = (async () => { for (let i = 0; busy; i++) await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate(`${i}`)) }); })();
    try {
      await until(() => s.lines.filter((l) => l.type === 'update').length >= 5, 'the stream to be busy');
      await theo.api.auth.signOut();
      const out = Date.now();
      await until(() => s.ended, 'the stream to end');
      expect(Date.now() - out).toBeLessThan(2000);
      expect(s.lines.at(-1)).toEqual({ type: 'closed', why: 'session' });
    } finally {
      busy = false;
      await typing;
      s.stop();
      await second.close();
    }
  });

  it('let go of a browser that can’t keep up, which picks up from its last seq with nothing lost', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer();
    const res = await ann.fetch(`${second.baseUrl}/v1/workspaces/${id}/documents/${doc}/live`);
    const reader = res.body?.pipeThrough(new TextDecoderStream()).getReader();
    if (!reader) throw new Error('no stream');
    await reader.read();
    try {
      // It stops reading, and much more comes than a stream is ever held to.
      const big = 'x'.repeat(256 * 1024);
      const writer = new Y.Doc();
      Y.applyUpdate(writer, DOC_SEED);
      for (let i = 0; i < 40; i++) {
        const before = Y.encodeStateVector(writer);
        line({ doc: writer }).insert(0, big);
        await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(writer, before)) });
      }
      // Everything it hadn't got to goes, ending without a word: a browser takes that as a reason to open it again.
      let heard = 0;
      let closed = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const m of value.matchAll(/"type":"update","seq":(\d+)/g)) heard = Math.max(heard, Number(m[1]));
        closed ||= value.includes('"closed"');
      }
      expect(closed).toBe(false);
      expect(heard).toBeLessThan(40);
      const resumed = await open(ann, id, doc);
      expect(line(resumed).length).toBe(40 * 256 * 1024);
    } finally {
      await reader.cancel().catch(() => undefined);
      await second.close();
    }
  });

  it('are capped per person on an instance, and the next opens once one closes', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer();
    const streams = Array.from({ length: 16 }, () => stream(second.baseUrl, ann.fetch, id, doc));
    try {
      await until(() => streams.every((s) => s.lines.length > 0), 'sixteen streams');
      const over = await ann.fetch(`${second.baseUrl}/v1${docPath(id, doc)}/live`);
      expect(over.status).toBe(503);
      streams[0]?.stop();
      await until(async () => (await ann.fetch(`${second.baseUrl}/v1${docPath(id, doc)}/live`, { signal: AbortSignal.timeout(1000) }).then((r) => { void r.body?.cancel(); return r.status; })) === 200, 'a place to free up');
    } finally {
      for (const s of streams) s.stop();
      await second.close();
    }
  });

  it('are capped across everyone on an instance, so open documents leave room for calls', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer({ LIVE_STREAMS_MAX: 3 });
    const up = (who: Account, path: string) => who.fetch(`${second.baseUrl}/v1${path}`, { signal: AbortSignal.timeout(2000) }).then((r) => { void r.body?.cancel(); return r.status; });
    const first = stream(second.baseUrl, ann.fetch, id, doc);
    const others = [stream(second.baseUrl, theo.fetch, id, doc), stream(second.baseUrl, theo.fetch, id, doc)];
    try {
      await until(() => [first, ...others].every((s) => s.lines.length > 0), 'three streams');
      // Whoever it is, and whichever kind of stream, they all count, and it's the same answer a browser tries again after.
      expect(await up(ann, docPath(id, doc) + '/live')).toBe(503);
      expect(await up(theo, `/workspaces/${id}/live`)).toBe(503);
      const refused = await ann.fetch(`${second.baseUrl}/v1/workspaces/${id}/live`);
      expect(await refused.json()).toMatchObject({ code: 'unavailable' });
      // Everything else carries on.
      expect((await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate('Still works')) }, second.baseUrl)).status).toBe(200);
      expect((await ann.fetch(`${second.baseUrl}/v1/workspaces/${id}`)).status).toBe(200);
      // A browser refused keeps trying, and gets in when a place frees up.
      const waiting = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.document(id, doc);
      await rest(100);
      expect(waiting.getSnapshot().role).toBeNull();
      first.stop();
      await waiting.ready;
      expect(waiting.getSnapshot().role).toBe('edit');
      waiting.close();
    } finally {
      for (const s of [first, ...others]) s.stop();
      await second.close();
    }
  });

  it('don’t let one document that won’t open stop anything else', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const bad = await make(ann, id, 'document', 'Bad');
    const good = await make(ann, id, 'document', 'Good');
    const g = await open(ann, id, good);
    line(g).insert(0, 'Fine');
    await saved(g);
    const owner = await ownerOf(id);
    for (let i = 0; i < 3; i++) await post(ann, `${docPath(id, bad)}/updates`, { update: toBase64Url(anUpdate('x')) });
    await h.pool.query("UPDATE document_updates SET update_ciphertext = 'not a record' WHERE owner_id = $1 AND document_id = $2", [owner, bad]);

    // Search goes past it, and says so.
    const found: string[] = [];
    for await (const d of ann.api.workspaces.searchText(id)) found.push(d.id);
    expect(found).toEqual([good]);
    expect(h.logs.some((l) => l.includes('document not read for search') && l.includes(bad))).toBe(true);
    // Writing to it still works: what can't fold is logged, with its IDs, and the update is safe in the log.
    await h.pool.query('UPDATE documents SET updates_since_snapshot = 500 WHERE owner_id = $1 AND document_id = $2', [owner, bad]);
    expect((await post(ann, `${docPath(id, bad)}/updates`, { update: toBase64Url(anUpdate('y')) })).status).toBe(200);
    expect(h.logs.some((l) => l.includes('document not folded') && l.includes(bad))).toBe(true);
    // Copying a folder of them copies what opens.
    const folder = await make(ann, id, 'folder', 'Folder');
    await ann.api.workspaces.items.move(id, bad, { parent: folder });
    await ann.api.workspaces.items.move(id, good, { parent: folder });
    const copy = await ann.api.workspaces.items.duplicate(id, folder);
    const inside = (await ann.api.workspaces.get(id)).items.filter((i) => i.parent === copy.id);
    expect(inside).toHaveLength(2);
    const copies = await Promise.all(inside.map((i) => open(ann, id, i.id)));
    expect(copies.map((c) => body(c).includes('Fine')).sort()).toEqual([false, true]);
    // And upkeep runs as ever.
    await expect(maintain(h.deps)).resolves.toBeTruthy();
  });
});

describe('who can do what', () => {
  it('refuses someone who can only read, with the reason in their status, and leaves the document as it was', async () => {
    const ann = await account();
    const rita = await account();
    const id = await workspace(ann, 'Ours', [[rita, 'read']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const a = await open(ann, id, doc);
    line(a).insert(0, 'As written');
    await saved(a);
    const r = await open(rita, id, doc);
    expect(r.getSnapshot()).toMatchObject({ status: 'saved', role: 'read', trashed: false });
    expect(words(r)).toBe('As written');
    expect((await post(rita, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate('Refused')) })).status).toBe(403);

    // The editor won't let them type; should anything change the document anyway, it's refused and says why.
    line(r).insert(0, 'Refused ');
    await until(() => r.getSnapshot().status === 'failed', 'the save to fail');
    expect(r.getSnapshot()).toMatchObject({ refused: 'read-only', closed: null });
    await rest(100);
    expect(words(a)).toBe('As written');

    // Their role goes up mid-session: it says so, and what was waiting goes.
    const ritaId = (await ann.api.workspaces.people(id)).find((p) => p.person.email === rita.email)?.id ?? '';
    await ann.api.workspaces.setRole(id, ritaId, 'edit');
    await until(() => r.getSnapshot().role === 'edit', 'the new role');
    await saved(r);
    await says(a, 'Refused As written');
    // And down again.
    await ann.api.workspaces.setRole(id, ritaId, 'read');
    await until(() => r.getSnapshot().role === 'read', 'the role to go down');
    expect((await post(rita, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate('Again')) })).status).toBe(403);
  });

  it('keeps a document in Trash readable and unchanged until it’s back, with the reason in the status', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const folder = await make(ann, id, 'folder', 'Folder');
    const doc = await make(ann, id, 'document', 'Doc', folder);
    const a = await open(ann, id, doc);
    const t = await open(theo, id, doc);
    line(a).insert(0, 'Hello');
    await saved(a);
    await says(t, 'Hello');

    // Its folder goes to Trash: people stay in it, read-only.
    await theo.api.workspaces.items.trash(id, folder);
    await until(() => a.getSnapshot().trashed && t.getSnapshot().trashed, 'Trash to show');
    expect(a.getSnapshot().role).toBe('edit');
    expect((await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate('No')) })).status).toBe(409);
    line(a).insert(0, 'While in Trash: ');
    await until(() => a.getSnapshot().status === 'failed', 'the save to fail');
    expect(a.getSnapshot().refused).toBe('trashed');
    // Opening it now reads it too.
    const late = await open(theo, id, doc);
    expect(late.getSnapshot()).toMatchObject({ trashed: true });
    expect(words(late)).toBe('Hello');

    // Back, and what was typed sends after all.
    await ann.api.workspaces.items.restore(id, folder);
    await until(() => !a.getSnapshot().trashed, 'it to come back');
    await saved(a);
    await says(t, 'While in Trash: Hello');
  });

  it('ends a stream when access is taken away: `closed`, nothing after it, edits refused, and presence stops naming the document', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'CANARY-SECRET');
    const a = await open(ann, id, doc);
    const t = await open(theo, id, doc);
    const raw = stream(h.baseUrl, theo.fetch, id, doc);
    const annLive = ann.api.workspaces.live(id);
    const theoLive = theo.api.workspaces.live(id);
    theoLive.present({ document: doc, block: 'first', typing: false });
    await until(() => annLive.getSnapshot().here.some((x) => x.document === doc), 'Ann to see where Theo is');
    await until(() => raw.lines.length > 0, 'the raw stream');
    line(t).insert(0, 'Theo was here. ');
    await saved(t);
    await says(a, 'Theo was here.');

    await ann.api.workspaces.share.restrict(id, doc, true);
    // The moment the change is made, Theo's stream is over, and nothing more reaches it.
    line(a).insert(0, 'CANARY-AFTER-REVOKED ');
    await saved(a);
    await until(() => t.getSnapshot().closed === 'access', 'Theo’s session to end');
    await until(() => raw.ended, 'the raw stream to end');
    expect(raw.lines.at(-1)).toEqual({ type: 'closed', why: 'access' });
    expect(JSON.stringify(raw.lines)).not.toContain(Buffer.from('CANARY-AFTER-REVOKED').toString('base64url').slice(0, 12));
    expect(body(t)).not.toContain('CANARY-AFTER-REVOKED');

    // What Theo's browser still tries is refused, exactly as for a document that was never there.
    const asked = await post(theo, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate('x')) });
    const never = await post(theo, `${docPath(id, madeUp())}/updates`, { update: toBase64Url(anUpdate('x')) });
    expect([asked.status, never.status]).toEqual([404, 404]);
    const say = async (r: Response) => { const { requestId: _, ...answer } = await r.json(); return answer; };
    expect(await say(asked)).toEqual(await say(never));
    // And the session, which stopped by itself, stops sending.
    const from = h.logs.length;
    line(t).insert(0, 'Too late. ');
    await rest(400);
    expect(h.logs.slice(from).filter((l) => l.includes('/updates') && l.includes(doc))).toEqual([]);
    expect(t.getSnapshot().closed).toBe('access');

    // Ann no longer sees Theo in the document, and Theo no longer sees where anyone is in it.
    await until(() => annLive.getSnapshot().here.every((x) => x.document !== doc || x.person.name === ann.name), 'Theo to leave the document for Ann');
    await until(() => !JSON.stringify(theoLive.getSnapshot()).includes(doc), 'Theo’s own view to stop naming it');
  });

  it('ends a stream for someone taken out of the workspace, and when it’s deleted for good, for everyone', async () => {
    const ann = await account();
    const theo = await account();
    const sam = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    await ann.api.workspaces.share.set(id, doc, [{ email: sam.email }], 'read');
    const a = await open(ann, id, doc);
    const t = await open(theo, id, doc);
    const s = await open(sam, id, doc);
    expect(s.getSnapshot().role).toBe('read');
    const theoId = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email)?.id ?? '';
    await ann.api.workspaces.removePerson(id, theoId);
    await until(() => t.getSnapshot().closed === 'access', 'Theo’s session to end');
    expect(a.getSnapshot().closed).toBeNull();

    await ann.api.workspaces.items.trash(id, doc);
    await until(() => s.getSnapshot().trashed, 'Trash to show for someone it was shared with');
    await ann.api.workspaces.items.deleteForever(id, doc);
    await until(() => a.getSnapshot().closed === 'deleted' && s.getSnapshot().closed === 'deleted', 'everyone’s sessions to end');
    // A deleted workspace ends it too.
    const another = await make(ann, id, 'document', 'Another');
    const a2 = await open(ann, id, another);
    await ann.api.workspaces.remove(id);
    await until(() => a2.getSnapshot().closed === 'deleted', 'the session to end with the workspace');
  });

  it('checks who’s reading at every ping, so an ended session ends the stream', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer({ LIVE_PING_MS: 100 });
    const s = stream(second.baseUrl, theo.fetch, id, doc);
    try {
      await until(() => s.lines.filter((l) => l.type === 'ping').length >= 2, 'pings');
      await theo.api.auth.signOut();
      await until(() => s.ended, 'the stream to end');
      expect(s.lines.at(-1)).toEqual({ type: 'closed', why: 'session' });
    } finally {
      s.stop();
      await second.close();
    }
  });

  it('refuses anyone with no access as if nothing were there, at every new route', async () => {
    const ann = await account();
    const sam = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'CANARY-NAME');
    const s = await open(ann, id, doc);
    line(s).insert(0, 'CANARY-WORDS');
    await saved(s);
    const version = await keepVersion(await heldBy(ann, id), doc, { reason: 'call', callId: null });
    if (!version) throw new Error('no version kept');
    const w = sam.api.workspaces;
    const pathOf = (x: string, y: string, v: string) => [
      ['GET', `${docPath(x, y)}/live`], ['GET', `${docPath(x, y)}/versions`], ['GET', `${docPath(x, y)}/versions/${v}`]
    ];
    for (const [method, path] of [...pathOf(id, doc, version), ['GET', `/workspaces/${id}/search`]]) {
      const res = await sam.fetch(`${h.baseUrl}/v1${path ?? ''}`, { method: method ?? 'GET' });
      expect(res.status, path).toBe(404);
    }
    const attempts: [string, (x: string, y: string) => Promise<unknown>][] = [
      ['versions', (x, y) => w.versions(x, y)], ['version', (x, y) => w.version(x, y, version)], ['restore', (x, y) => w.restoreVersion(x, y, version)]
    ];
    for (const [what, attempt] of attempts) {
      const real = await refusal(attempt(id, doc));
      expect(real?.code, what).toBe('not-found');
      expect(real, what).toEqual(await refusal(attempt(id, madeUp())));
      expect(await refusal(attempt(madeUp(), doc)), what).toMatchObject({ code: 'not-found' });
    }
    for (const send of [(x: string, y: string) => post(sam, `${docPath(x, y)}/updates`, { update: toBase64Url(anUpdate('x')) }), (x: string, y: string) => post(sam, `${docPath(x, y)}/awareness`, { update: 'AA' })]) {
      const real = await send(id, doc);
      const fake = await send(id, madeUp());
      expect([real.status, fake.status]).toEqual([404, 404]);
    }
    const nowhere = await post(sam, `/workspaces/${id}/presence`, { connection: madeUp(), document: null, block: null, typing: false });
    expect(nowhere.status).toBe(404);
    const live = sam.api.workspaces.document(id, doc);
    await expect(live.ready).rejects.toMatchObject({ code: 'not-found' });
    expect(live.getSnapshot().closed).toBe('access');
    // Nobody signed in gets nothing, and is told only that.
    const nobody = h.browser();
    expect(await code(nobody.api.workspaces.versions(id, doc))).toBe('unauthenticated');
    expect((await post(nobody, `${docPath(id, doc)}/updates`, { update: toBase64Url(anUpdate('x')) })).status).toBe(401);
    expect(h.logs.join('').includes('CANARY-WORDS')).toBe(false);
  });

  it('never reaches across workspaces: an ID from one means nothing in another, at every route', async () => {
    const ann = await account();
    const mine = await workspace(ann, 'Mine');
    const other = await workspace(ann, 'Other');
    const docHere = await make(ann, mine, 'document', 'Here');
    const docThere = await make(ann, other, 'document', 'There');
    const folderThere = await make(ann, other, 'folder', 'A folder');
    const here = await open(ann, mine, docHere);
    const there = await open(ann, other, docThere);
    line(here).insert(0, 'Here');
    line(there).insert(0, 'There');
    await saved(here);
    await saved(there);
    const keptHere = await keepVersion(await heldBy(ann, mine), docHere, { reason: 'call', callId: null });
    const keptThere = await keepVersion(await heldBy(ann, other), docThere, { reason: 'call', callId: null });
    if (!keptHere || !keptThere) throw new Error('no versions kept');
    const w = ann.api.workspaces;
    const attempts: [string, () => Promise<unknown>][] = [
      ['versions', () => w.versions(mine, docThere)], ['version', () => w.version(mine, docThere, keptThere)], ['restore', () => w.restoreVersion(mine, docThere, keptThere)],
      ['a version of another document', () => w.version(mine, docHere, keptThere)], ['restoring another document’s version', () => w.restoreVersion(mine, docHere, keptThere)], ['a folder’s versions', () => w.versions(other, folderThere)]
    ];
    for (const [what, attempt] of attempts) expect(await code(attempt()), what).toBe('not-found');
    for (const [where, doc] of [[mine, docThere], [other, folderThere]] as const) {
      expect((await post(ann, `${docPath(where, doc)}/updates`, { update: toBase64Url(anUpdate('x')) })).status).toBe(404);
      expect((await post(ann, `${docPath(where, doc)}/awareness`, { update: 'AA' })).status).toBe(404);
      expect((await ann.fetch(`${h.baseUrl}/v1${docPath(where, doc)}/live`)).status).toBe(404);
    }
    expect((await post(ann, `/workspaces/${mine}/presence`, { connection: madeUp(), document: docThere, block: null, typing: false })).status).toBe(404);
    expect(words(here)).toBe('Here');
    expect(words(there)).toBe('There');
  });

  it('opens for a guest through their seat, read-only or to edit, and only until the seat ends', async () => {
    const org = await account();
    const id = await workspace(org, 'CANARY-SPACE');
    const doc = await make(org, id, 'document', 'Agenda');
    const other = await make(org, id, 'document', 'CANARY-OTHER');
    const a = await open(org, id, doc);
    line(a).insert(0, 'For the call');
    await saved(a);

    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    await until(() => host.crypto.getSnapshot().status === 'in', 'the host in the call’s group');
    const b = h.browser();
    const call = await b.api.calls.join(c, { mic: false, cam: false, name: 'Sam Guest' });
    const settle = async (pred: (s: CallState) => boolean) => { for (let i = 0; i < 200 && !pred(host.getSnapshot()); i++) { await host.refresh(); await rest(30); } return host.getSnapshot(); };
    await settle((s) => s.waiting.some((x) => x.id === call.ticket.identity));
    await host.admit(call.ticket.identity);
    const seat = (await settle((s) => s.participants.some((p) => p.id === call.ticket.identity))).participants.find((p) => p.id === call.ticket.identity)?.seat ?? '';
    const pass = call.ticket.pass;

    // Being in the call gives nothing.
    const refused = b.api.workspaces.document(id, doc, { pass });
    await expect(refused.ready).rejects.toMatchObject({ code: 'not-found' });
    await org.api.workspaces.share.set(id, doc, [{ seat }], 'read', { pass: host.ticket.pass });

    const g = await open(b, id, doc, { pass });
    expect(g.getSnapshot().role).toBe('read');
    expect(words(g)).toBe('For the call');
    expect((await b.fetch(`${h.baseUrl}/v1${docPath(id, doc)}/updates`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': pass }, body: JSON.stringify({ update: toBase64Url(anUpdate('x')) }) })).status).toBe(403);
    expect(await code(b.api.workspaces.versions(id, doc))).toBe('unauthenticated');
    expect(await b.api.workspaces.versions(id, doc, { pass })).toEqual([]);
    expect(await code(b.api.workspaces.versions(id, other, { pass }))).toBe('not-found');
    // What they can search is what they can open.
    const found: string[] = [];
    for await (const d of b.api.workspaces.searchText(id, { pass })) found.push(d.id);
    expect(found).toEqual([doc]);

    // Given more, they can write, and everyone hears them under their own name.
    await org.api.workspaces.share.set(id, doc, [{ seat }], 'edit', { pass: host.ticket.pass });
    await until(() => g.getSnapshot().role === 'edit', 'the new role');
    line(g).insert(line(g).length, ', from Sam');
    await saved(g);
    await says(a, 'For the call, from Sam');
    g.awareness.setLocalStateField('cursor', { anchor: 1, head: 1 });
    a.awareness.setLocalStateField('cursor', { anchor: 2, head: 2 });
    await until(() => [...a.awareness.getStates().values()].some((s) => s['user']?.name === 'Sam Guest'), 'the guest’s caret');
    const caret = [...a.awareness.getStates().values()].find((s) => s['user']?.name === 'Sam Guest');
    expect(caret?.['user']?.callIdentity).toBe(call.ticket.identity);
    expect(JSON.stringify(caret)).not.toContain('@');

    // The call ending takes it away, stream and all.
    await host.leave();
    await until(() => g.getSnapshot().closed !== null, 'the guest’s session to end');
    expect(await code(b.api.workspaces.versions(id, doc, { pass }))).toBe('unauthenticated');
    expect(words(await open(org, id, doc))).toBe('For the call, from Sam');
  });
});

describe('awareness', () => {
  const carets = (s: DocSession) => [...s.awareness.getStates().entries()].filter(([client]) => client !== s.awareness.clientID).map(([, state]) => state);

  it('carries who someone is from the server, never what their browser says', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const a = await open(ann, id, doc);
    const t = await open(theo, id, doc);
    t.awareness.setLocalState({ cursor: { anchor: 3, head: 3 }, user: { id: 'someone-else', name: ann.name, callIdentity: 'forged' } });
    await until(() => carets(a).some((c) => c['cursor']?.anchor === 3), 'Theo’s caret');
    const [caret] = carets(a);
    expect(caret?.['cursor']).toEqual({ anchor: 3, head: 3 });
    expect(caret?.['user']?.name).toBe(theo.name);
    expect(caret?.['user']?.id).not.toBe('someone-else');
    expect(caret?.['user']?.callIdentity).toBeNull();
    expect(JSON.stringify(caret)).not.toContain(theo.email);
    // The same person as presence says, however they're connected.
    const annLive = ann.api.workspaces.live(id);
    const theoLive = theo.api.workspaces.live(id);
    await until(() => annLive.getSnapshot().here.some((x) => x.person.name === theo.name), 'Theo to be here');
    expect(annLive.getSnapshot().here.find((x) => x.person.name === theo.name)?.person.id).toBe(caret?.['user']?.id);
    theoLive.close();

    // A browser that writes the lines itself gets no further: it's the update, not the session, that's rewritten.
    const scratch = new Y.Doc();
    const forged = new Awareness(scratch);
    forged.setLocalState({ cursor: { anchor: 9, head: 9 }, user: { id: 'x', name: 'Forged Name' } });
    const update = toBase64Url(encodeAwarenessUpdate(forged, [scratch.clientID]));
    forged.destroy();
    expect((await post(theo, `${docPath(id, doc)}/awareness`, { update })).status).toBe(200);
    await until(() => carets(a).some((c) => c['cursor']?.anchor === 9), 'the forged update');
    expect(carets(a).find((c) => c['cursor']?.anchor === 9)?.['user']?.name).toBe(theo.name);
    expect(JSON.stringify(carets(a))).not.toContain('Forged Name');

    // Nothing else in it is taken for an update.
    expect((await post(theo, `${docPath(id, doc)}/awareness`, { update: toBase64Url(randomBytes(40)) })).status).toBe(400);
    expect((await post(theo, `${docPath(id, doc)}/awareness`, { update: toBase64Url(new Uint8Array(5000)) })).status).toBe(400);
  });

  it('won’t let someone write over another person’s caret by using their client', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const a = await open(ann, id, doc);
    const t = await open(theo, id, doc);
    t.awareness.setLocalStateField('cursor', { anchor: 1, head: 1 });
    await until(() => carets(a).some((c) => c['cursor']?.anchor === 1), 'Theo’s caret');
    const scratch = new Y.Doc();
    scratch.clientID = t.doc.clientID;
    const stolen = new Awareness(scratch);
    for (let i = 0; i < 5; i++) stolen.setLocalState({ cursor: { anchor: 77, head: 77 } });
    const update = toBase64Url(encodeAwarenessUpdate(stolen, [scratch.clientID]));
    stolen.destroy();
    expect((await post(ann, `${docPath(id, doc)}/awareness`, { update })).status).toBe(403);
    await rest(100);
    expect(JSON.stringify(carets(a))).not.toContain('77');
  });

  it('tells someone who arrives where everyone already is, and takes a caret away when its browser goes', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const a = await open(ann, id, doc);
    a.awareness.setLocalStateField('cursor', { anchor: 5, head: 5 });
    await rest(250);
    const t = await open(theo, id, doc);
    await until(() => carets(t).some((c) => c['cursor']?.anchor === 5), 'Theo to hear where Ann already is');
    await until(() => carets(a).length === 1, 'Ann to hear Theo arrive');
    t.close();
    await until(() => carets(a).length === 0, 'Theo’s caret to go');
  });

  it('is never stored, and crosses from one instance to another, updates too', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer();
    const there = createHttpApi({ baseUrl: second.baseUrl, fetch: theo.fetch });
    const a = await open(ann, id, doc);
    const t = there.workspaces.document(id, doc);
    await t.ready;
    try {
      t.awareness.setLocalStateField('cursor', { anchor: 42, head: 42 });
      await until(() => carets(a).some((c) => c['cursor']?.anchor === 42), 'Ann to see Theo’s caret across instances');
      a.awareness.setLocalStateField('cursor', { anchor: 43, head: 43 });
      await until(() => carets(t).some((c) => c['cursor']?.anchor === 43), 'Theo to see Ann’s caret across instances');
      line(a).insert(0, 'From the first. ');
      await says(t, 'From the first.');
      line(t).insert(0, 'From the second. ');
      await says(a, 'From the second.');
      const all = await h.pool.query("SELECT string_agg(t, ' ') AS all FROM (SELECT row_to_json(x)::text AS t FROM documents x UNION ALL SELECT row_to_json(x)::text FROM document_updates x) q");
      expect(String(all.rows[0]?.all)).not.toContain('"anchor"');
      // Losing access on one instance ends a session on the other.
      const theoId = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email)?.id ?? '';
      await ann.api.workspaces.removePerson(id, theoId);
      await until(() => t.getSnapshot().closed === 'access', 'Theo’s session on the other instance to end');
    } finally {
      t.close();
      await second.close();
    }
  });
});

describe('presence', () => {
  const here = (l: WorkspaceLive) => l.getSnapshot().here;
  const of = (l: WorkspaceLive, who: Account): WorkspaceHere | undefined => here(l).find((x) => x.person.name === who.name);

  it('shows who’s where to whoever can open it, and to anyone else only that they’re elsewhere', async () => {
    const ann = await account();
    const theo = await account();
    const priya = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [priya, 'read']]);
    const open1 = await make(ann, id, 'document', 'Open');
    const secret = await make(ann, id, 'document', 'CANARY-SECRET');
    await ann.api.workspaces.share.restrict(id, secret, true);

    const a = ann.api.workspaces.live(id);
    const t = theo.api.workspaces.live(id);
    const p = priya.api.workspaces.live(id);
    // Being here takes nothing but having it open.
    await until(() => here(a).length === 3 && here(t).length === 3 && here(p).length === 3, 'everyone to see everyone');
    expect(of(a, theo)).toMatchObject({ document: null, block: null, typing: false, elsewhere: false, callIdentity: null, isMe: false });
    expect(of(a, ann)?.isMe).toBe(true);
    expect(of(a, theo)?.person.email).toBe(theo.email);

    t.present({ document: open1, block: 'first', typing: true });
    await until(() => of(a, theo)?.document === open1, 'Ann to see Theo in the document');
    expect(of(a, theo)).toMatchObject({ block: 'first', typing: true, elsewhere: false });
    await until(() => of(p, theo)?.document === open1, 'Priya to see the same');

    a.present({ document: secret, block: 'b1', typing: true });
    await until(() => of(a, ann)?.document === secret, 'Ann’s own connection to show');
    await until(() => of(t, ann)?.elsewhere === true, 'Theo to see Ann elsewhere');
    expect(of(t, ann)).toMatchObject({ document: null, block: null, typing: false, elsewhere: true });
    // Nothing on the wire names it for them.
    expect(JSON.stringify(t.getSnapshot())).not.toContain(secret);
    expect(JSON.stringify(p.getSnapshot())).not.toContain(secret);

    // Sharing it makes it visible at once, without anyone moving.
    await ann.api.workspaces.share.set(id, secret, [{ email: theo.email }], 'read');
    await until(() => of(t, ann)?.document === secret, 'Theo to see Ann in it now');
    expect(of(t, ann)).toMatchObject({ block: 'b1', elsewhere: false });
    expect(of(p, ann)?.elsewhere).toBe(true);
    // And taking it back hides it again.
    const entry = (await ann.api.workspaces.share.list(id, secret)).entries[0]?.id ?? '';
    await ann.api.workspaces.share.remove(id, secret, entry);
    await until(() => of(t, ann)?.elsewhere === true, 'Theo to lose sight of it');

    // Leaving is at once.
    p.close();
    await until(() => !of(a, priya) && !of(t, priya), 'Priya to leave');
  });

  it('refuses to place someone in a document they can’t open, and tells nobody it tried', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const secret = await make(ann, id, 'document', 'Secret');
    await ann.api.workspaces.share.restrict(id, secret, true);
    const real = await post(theo, `/workspaces/${id}/presence`, { connection: madeUp(), document: secret, block: null, typing: false });
    const fake = await post(theo, `/workspaces/${id}/presence`, { connection: madeUp(), document: madeUp(), block: null, typing: false });
    expect([real.status, fake.status]).toEqual([404, 404]);
    expect((await post(theo, `/workspaces/${id}/presence`, { connection: 'short', document: null, block: null, typing: false })).status).toBe(400);
    expect((await post(theo, `/workspaces/${id}/presence`, { connection: madeUp(), document: null, block: '<b>', typing: false })).status).toBe(400);

    // Someone in the browser asks to be somewhere they lost: it quietly falls back to being in the workspace.
    const t = theo.api.workspaces.live(id);
    const a = ann.api.workspaces.live(id);
    t.present({ document: secret, block: null, typing: false });
    await until(() => of(a, theo) !== undefined && of(a, theo)?.document === null, 'Theo to be here, in nothing');
  });

  it('keeps people outside the workspace to what they share: no list of who’s in it, and no addresses', async () => {
    const ann = await account();
    const theo = await account();
    const sam = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Shared');
    const other = await make(ann, id, 'document', 'Other');
    await ann.api.workspaces.share.set(id, doc, [{ email: sam.email }], 'read');
    const a = ann.api.workspaces.live(id);
    const t = theo.api.workspaces.live(id);
    const s = sam.api.workspaces.live(id);
    a.present({ document: doc, block: null, typing: false });
    t.present({ document: other, block: null, typing: false });
    s.present({ document: doc, block: null, typing: false });
    await until(() => of(s, ann)?.document === doc, 'Sam to see Ann in the document they share');
    await until(() => of(a, sam)?.document === doc, 'Ann to see Sam');
    // Theo is in the workspace, doing something Sam has no part in: for Sam, Theo isn't there at all.
    await until(() => of(a, theo)?.document === other, 'Theo to be placed');
    await rest(100);
    expect(of(s, theo)).toBeUndefined();
    expect(of(s, ann)?.person.email).toBe('');
    expect(JSON.stringify(here(s).filter((x) => !x.isMe))).not.toContain('@');
    // And someone outside it shows their name to people in it, and no address.
    expect(of(a, sam)?.person.email).toBe('');
  });

  it('carries a connection’s call identity, for people in that call', async () => {
    const org = await account();
    const member = await account();
    const id = await workspace(org, 'Ours', [[member, 'edit']]);
    const doc = await make(org, id, 'document', 'Doc');
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    await until(() => host.crypto.getSnapshot().status === 'in', 'the host in the call’s group');
    const b = h.browser();
    const guest = await b.api.calls.join(c, { mic: false, cam: false, name: 'Sam Guest' });
    const settle = async (pred: (s: CallState) => boolean) => { for (let i = 0; i < 200 && !pred(host.getSnapshot()); i++) { await host.refresh(); await rest(30); } return host.getSnapshot(); };
    await settle((s) => s.waiting.some((x) => x.id === guest.ticket.identity));
    await host.admit(guest.ticket.identity);
    const seat = (await settle((s) => s.participants.some((p) => p.id === guest.ticket.identity))).participants.find((p) => p.id === guest.ticket.identity)?.seat ?? '';
    await org.api.workspaces.share.set(id, doc, [{ seat }], 'read', { pass: host.ticket.pass });

    const o = org.api.workspaces.live(id, { pass: host.ticket.pass });
    const g = b.api.workspaces.live(id, { pass: guest.ticket.pass });
    const m = member.api.workspaces.live(id);
    o.present({ document: doc, block: null, typing: false });
    g.present({ document: doc, block: null, typing: false });
    await until(() => here(g).find((x) => x.person.name === org.name)?.document === doc, 'the guest to see the organizer');
    // In the same call, each is told the other's connection to it, so a tile can show where they are.
    expect(here(g).find((x) => x.person.name === org.name)?.callIdentity).toBe(host.ticket.identity);
    await until(() => here(o).find((x) => x.person.name === 'Sam Guest') !== undefined, 'the organizer to see the guest');
    expect(here(o).find((x) => x.person.name === 'Sam Guest')?.callIdentity).toBe(guest.ticket.identity);
    expect(here(o).find((x) => x.person.name === 'Sam Guest')?.person.email).toBe('');
    // Someone in the workspace who isn't in the call isn't told who's who in it.
    await until(() => of(m, org)?.document === doc, 'the member to see the organizer');
    expect(of(m, org)?.callIdentity).toBeNull();

    // Someone in a call who can't open what another is in sees them elsewhere: they've met.
    const secret = await make(org, id, 'document', 'CANARY-SECRET');
    o.present({ document: secret, block: null, typing: false });
    await until(() => here(g).find((x) => x.person.name === org.name)?.elsewhere === true, 'the guest to see the organizer elsewhere');
    expect(JSON.stringify(here(g))).not.toContain(secret);
  });

  it('forgets a connection that stops saying it’s there', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const second = await h.secondServer({ LIVE_PRESENCE_MS: 300 });
    const net = network(theo);
    const there = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch, livePresenceMs: 100 });
    const a = there.workspaces.live(id);
    const t = createHttpApi({ baseUrl: second.baseUrl, fetch: (input, init) => net.browser.fetch(input, init), livePresenceMs: 100 }).workspaces.live(id);
    try {
      await until(() => of(a, theo) !== undefined, 'Theo to be here');
      // Saying so keeps it there, past the time it would have gone.
      await rest(600);
      expect(of(a, theo)).toBeDefined();
      // A laptop closes: no goodbye.
      net.drop();
      await until(() => of(a, theo) === undefined, 'Theo to go');
      expect(of(a, ann)).toBeDefined();
    } finally {
      net.back();
      a.close();
      t.close();
      await second.close();
    }
  });

  it('crosses instances, and someone arriving on a quiet instance soon sees everyone', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const a = ann.api.workspaces.live(id);
    a.present({ document: doc, block: null, typing: false });
    await until(() => of(a, ann)?.document === doc, 'Ann to be placed');
    const second = await h.secondServer();
    const t = createHttpApi({ baseUrl: second.baseUrl, fetch: theo.fetch, livePresenceMs: 200 }).workspaces.live(id);
    try {
      await until(() => of(t, ann)?.document === doc, 'Theo to see Ann, who said so before that instance had heard of the workspace');
      await until(() => of(a, theo) !== undefined, 'Ann to see Theo');
    } finally {
      t.close();
      await second.close();
    }
  });
});

describe('versions', () => {
  it('keeps one after ten minutes of editing, as it stood before the new edits, sealed, with who made them', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const a = await open(ann, id, doc);
    const t = await open(theo, id, doc);
    line(a).insert(0, 'Monday. ');
    line(t).insert(0, 'Theo’s Monday. ');
    await saved(a);
    await saved(t);
    expect(await ann.api.workspaces.versions(id, doc)).toEqual([]);

    // Ten minutes go by, and the next edit keeps what was there before it.
    await backdate(doc);
    await until(() => words(a) === words(t), 'the two to agree');
    const monday = words(a);
    line(a).insert(0, 'Tuesday. ');
    await saved(a);
    const list = await ann.api.workspaces.versions(id, doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: 'edits', callId: null });
    expect(list[0]?.by.map((b) => b.name).sort()).toEqual([ann.name, theo.name].sort());
    expect(JSON.stringify(list)).not.toContain('@');
    const kept = await ann.api.workspaces.version(id, doc, list[0]?.id ?? '');
    const past = new Y.Doc();
    Y.applyUpdate(past, kept.update);
    expect(words({ doc: past })).toBe(monday);
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [doc])).toBe(1);

    // Editing on within the ten minutes keeps no more.
    for (let i = 0; i < 3; i++) { line(a).insert(0, 'x'); await saved(a); }
    expect(await ann.api.workspaces.versions(id, doc)).toHaveLength(1);
    // And the next one names only who's been editing since.
    await backdate(doc);
    line(a).insert(0, 'y');
    await saved(a);
    const two = await ann.api.workspaces.versions(id, doc);
    expect(two).toHaveLength(2);
    expect(two[0]?.by.map((b) => b.name)).toEqual([ann.name]);
    // Newest first, for anyone who can open it.
    expect(two[1]?.id).toBe(list[0]?.id);
    expect((await theo.api.workspaces.versions(id, doc)).map((v) => v.id)).toEqual(two.map((v) => v.id));
  });

  it('labels a version with the call it was kept in, and keeps one when a call ends only if something changed', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const held = await heldBy(ann, id);
    const callId = madeUp();
    // Nothing written yet: nothing to keep.
    expect(await keepVersion(held, doc, { reason: 'call', callId })).toBeNull();
    const s = await open(ann, id, doc);
    line(s).insert(0, 'Said in the call');
    await saved(s);
    const version = await keepVersion(held, doc, { reason: 'call', callId });
    expect(version).toBeTruthy();
    expect(await ann.api.workspaces.versions(id, doc)).toMatchObject([{ id: version, reason: 'call', callId, by: [{ name: ann.name }] }]);
    expect(await keepVersion(held, doc, { reason: 'call', callId })).toBeNull();
    expect(await ann.api.workspaces.versions(id, doc)).toHaveLength(1);
  });

  it('restores for everyone as an ordinary edit, keeps today’s as a version, and restoring that brings it all back', async () => {
    const ann = await account();
    const theo = await account();
    const rita = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [rita, 'read']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const a = await open(ann, id, doc);
    const t = await open(theo, id, doc);
    title(a).insert(0, 'The old title');
    addBlock(a, 'line', 'td', { kind: 'todo' });
    line(a, 'td').insert(0, 'Book it');
    line(a).insert(0, 'Keep this line, formatted');
    line(a).format(0, 4, { bold: {} });
    a.doc.getMap<boolean>('comments').set('marker', false);
    await saved(a);
    const held = await heldBy(ann, id);
    const kept = await keepVersion(held, doc, { reason: 'call', callId: madeUp() });
    if (!kept) throw new Error('no version kept');
    const then = body(a);

    // Everything that can change, does: words, marks, a block goes, another comes, an attribute, a comment.
    title(a).insert(0, 'Today: ');
    line(a).delete(0, 5);
    line(a).insert(0, 'CHANGED ');
    addBlock(a, 'line', 'new');
    line(a, 'new').insert(0, 'A line added since');
    const todo = a.doc.getXmlFragment('content').get(2);
    if (!(todo instanceof Y.XmlElement)) throw new Error('no todo');
    setAttr(todo, 'done', true);
    a.doc.getMap<boolean>('comments').set('marker', true);
    a.doc.getXmlFragment('content').delete(1, 1);
    await saved(a);
    await until(() => body(t) === body(a), 'Theo to hear it all');
    const today = body(a);
    expect(today).not.toBe(then);

    expect(await code(rita.api.workspaces.restoreVersion(id, doc, kept))).toBe('forbidden');
    expect(await code(ann.api.workspaces.restoreVersion(id, doc, madeUp()))).toBe('not-found');
    await ann.api.workspaces.restoreVersion(id, doc, kept);

    // It arrives like anything else anyone typed, for everyone, and the tree's name follows the title.
    await until(() => body(a) === then && body(t) === then, 'both to show the version');
    expect(a.doc.getMap('comments').get('marker')).toBe(false);
    expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc])).toBeGreaterThan(0);
    expect((await ann.api.workspaces.items.get(id, doc)).name).toBe('The old title');

    // Today's is a version too.
    const list = await ann.api.workspaces.versions(id, doc);
    expect(list[0]).toMatchObject({ reason: 'restore' });
    const saving = await ann.api.workspaces.version(id, doc, list[0]?.id ?? '');
    const past = new Y.Doc();
    Y.applyUpdate(past, saving.update);
    expect(past.getXmlFragment('content').toString()).toBe(today);
    await ann.api.workspaces.restoreVersion(id, doc, list[0]?.id ?? '');
    await until(() => body(a) === today, 'today’s to come back');
    expect(body(await open(theo, id, doc))).toBe(today);

    // People keep typing through it, and nobody's words are lost.
    line(t, 'new').insert(0, 'Theo says: ');
    await ann.api.workspaces.restoreVersion(id, doc, list[0]?.id ?? '');
    await saved(t);
    await until(() => body(a) === body(t), 'the two to converge');
  });

  it('isn’t broken by garbage collection: a version opens and restores after what it holds was deleted and compacted', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const a = await open(ann, id, doc);
    addBlock(a, 'line', 'second');
    line(a).insert(0, 'The words that get deleted');
    line(a, 'second').insert(0, 'The line that goes');
    await saved(a);
    const kept = await keepVersion(await heldBy(ann, id), doc, { reason: 'call', callId: null });
    if (!kept) throw new Error('no version kept');
    const then = body(a);

    line(a).delete(0, line(a).length);
    const fragment = a.doc.getXmlFragment('content');
    fragment.delete(2, 1);
    await saved(a);
    for (let i = 0; i < 210; i++) { line(a).insert(0, 'z'); await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(a.doc)) }); }
    await until(() => compacted(doc), 'the log to compact');
    const fresh = await open(ann, id, doc);
    expect(body(fresh)).not.toContain('The words');

    const version = await ann.api.workspaces.version(id, doc, kept);
    const past = new Y.Doc();
    Y.applyUpdate(past, version.update);
    expect(past.getXmlFragment('content').toString()).toBe(then);
    await ann.api.workspaces.restoreVersion(id, doc, kept);
    await until(() => body(fresh) === then, 'the deleted words to come back');
    expect(body(a)).toBe(then);
  });

  it('keeps a bounded number of versions, dropping the oldest', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const s = await open(ann, id, doc);
    const held = await heldBy(ann, id);
    line(s).insert(0, 'v');
    await saved(s);
    const first = await keepVersion(held, doc, { reason: 'call', callId: null });
    // As if it had been edited for days.
    const copies = async (n: number) => h.pool.query(`INSERT INTO document_versions (owner_id, document_id, version_id, info_ciphertext, state_ciphertext, created_at)
      SELECT owner_id, document_id, $2 || lpad(g::text, 10, '0'), info_ciphertext, state_ciphertext, created_at + (g || ' seconds')::interval
      FROM (SELECT * FROM document_versions WHERE document_id = $1 LIMIT 1) v, generate_series(1, $3::int) g`, [doc, madeUp().slice(0, 12), n]);
    await copies(205);
    line(s).insert(0, 'w');
    await saved(s);
    const newest = await keepVersion(held, doc, { reason: 'call', callId: null });
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [doc])).toBe(200);
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1 AND version_id = $2', [doc, first])).toBe(0);
    // However many bytes they come to, the newest stays.
    await h.pool.query("UPDATE document_versions SET state_ciphertext = decode(repeat('00', 40 * 1024 * 1024), 'hex') WHERE document_id = $1 AND version_id <> $2 AND version_id IN (SELECT version_id FROM document_versions WHERE document_id = $1 AND version_id <> $2 ORDER BY created_at DESC LIMIT 3)", [doc, newest]);
    line(s).insert(0, 'x');
    await saved(s);
    await keepVersion(held, doc, { reason: 'call', callId: null });
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [doc])).toBeLessThanOrEqual(3);
  });
});

describe('reading a document on the server', () => {
  /** A document with one of everything that holds words, as y-prosemirror stores it. */
  async function full(who: Account, id: string, name: string) {
    const doc = await make(who, id, 'document', name);
    const s = await open(who, id, doc);
    title(s).insert(0, `${name} title`);
    line(s).insert(0, 'A first line');
    addBlock(s, 'line', 'h1', { kind: 'heading', level: 2 });
    line(s, 'h1').insert(0, 'A heading');
    const todo = addBlock(s, 'line', 'todo1', { kind: 'todo' });
    const before = new Y.XmlText();
    before.insert(0, 'Send the brief to ');
    const after = new Y.XmlText();
    after.insert(0, ' by ');
    todo.insert(0, [before, inline('mention', { id: 'p1', name: 'Priya Rao' }), after, inline('dateChip', { date: '2026-11-06' })]);
    const plain = addBlock(s, 'line', 'todo2', { kind: 'todo' });
    const nobodys = new Y.XmlText();
    nobodys.insert(0, 'Nobody’s yet');
    plain.insert(0, [nobodys]);
    setAttr(plain, 'done', true);
    const toggle = addBlock(s, 'toggle', 'tg');
    const summary = new Y.XmlElement('toggleSummary');
    const summaryText = new Y.XmlText();
    summaryText.insert(0, 'Toggle summary');
    summary.insert(0, [summaryText]);
    const inside = new Y.XmlElement('toggleBody');
    const insideText = new Y.XmlText();
    insideText.insert(0, 'Toggle body');
    inside.insert(0, [insideText]);
    toggle.insert(0, [summary, inside]);
    const table = addBlock(s, 'table', 'tb');
    const row = new Y.XmlElement('table_row');
    ['Cell one', 'Cell two'].forEach((cell, i) => {
      const el = new Y.XmlElement('table_cell');
      const text = new Y.XmlText();
      text.insert(0, cell);
      el.insert(0, [text]);
      row.insert(i, [el]);
    });
    table.insert(0, [row]);
    const live = blockOf('live', { id: 'lv', lines: [{ text: 'Decided: ship it' }] });
    const moment = blockOf('moment', { id: 'mo', text: 'What was said' });
    const file = blockOf('file', { id: 'fi', name: 'brief.pdf' });
    const gallery = blockOf('gallery', { id: 'ga', 'cap:media1': 'A caption', 'cap:media2': 'Another' });
    const link = blockOf('line', { id: 'lk' });
    const beforeRef = new Y.XmlText();
    beforeRef.insert(0, 'See ');
    link.insert(0, [beforeRef, inline('docref', { doc: 'someOtherDocument' })]);
    s.doc.getXmlFragment('content').insert(s.doc.getXmlFragment('content').length, [live, moment, file, gallery, link]);
    await saved(s);
    return { doc, s };
  }

  it('reads words out of a document and a todo’s who and when, without an editor', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const { doc } = await full(ann, id, 'Plan');
    const held = await heldBy(ann, id);
    const read = await readDocument(held, doc);
    const text = documentText(read, 'document');
    expect(text.title).toBe('Plan title');
    expect(text.blocks).toEqual(expect.arrayContaining([
      { id: 'first', type: 'paragraph', text: 'A first line' }, { id: 'h1', type: 'heading', text: 'A heading' },
      { id: 'todo1', type: 'todo', text: 'Send the brief to Priya Rao by 2026-11-06' }, { id: 'tg', type: 'toggle', text: 'Toggle summary\nToggle body' },
      { id: 'tb', type: 'table', text: 'Cell one\tCell two' }, { id: 'lv', type: 'live', text: 'Decided: ship it' }, { id: 'mo', type: 'moment', text: 'What was said' },
      { id: 'fi', type: 'file', text: 'brief.pdf' }, { id: 'ga', type: 'gallery', text: 'A caption Another' }, { id: 'lk', type: 'paragraph', text: 'See ' }
    ]));
    expect(documentTodos(read, 'document')).toEqual([
      { block: 'todo1', text: 'Send the brief to Priya Rao by 2026-11-06', done: false, mentions: [{ id: 'p1', name: 'Priya Rao' }], dates: ['2026-11-06'] },
      { block: 'todo2', text: 'Nobody’s yet', done: true, mentions: [], dates: [] }
    ]);
    // A retired block isn't on the page, and a todo in one isn't anyone's, unless an edit landed in it after: then it's a block.
    const after = await open(ann, id, doc);
    const old = addBlock(after, 'line', 'old', { kind: 'todo', gone: 'first' });
    const landed = addBlock(after, 'line', 'landed', { kind: 'todo', gone: '' });
    const typed = new Y.XmlText();
    typed.insert(0, 'Typed as it went');
    landed.insert(0, [typed]);
    expect(old.getAttribute('gone')).toBe('first');
    expect(documentText(after.doc, 'document').blocks.map((b) => b.id)).not.toContain('old');
    expect(documentText(after.doc, 'document').blocks.find((b) => b.id === 'landed')?.type).toBe('todo');
    expect(documentTodos(after.doc, 'document').map((t) => t.block)).toEqual(['todo1', 'todo2', 'landed']);
    // A board has neither, until a board says what it has.
    expect(documentText(read, 'board')).toEqual({ title: '', blocks: [] });
    expect(documentTodos(read, 'board')).toEqual([]);
  });

  it('writes like anyone else: a server-made change reaches everyone, as an update, and survives', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const { doc, s } = await full(ann, id, 'Plan');
    const t = await open(theo, id, doc);
    await says(t, 'Send the brief');
    const held = await heldBy(ann, id);
    const before = await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc]);
    // Ticking a follow-up from the call.
    await writeDocument(held, doc, (d) => {
      const el = d.getXmlFragment('content').toArray().find((e) => e instanceof Y.XmlElement && e.getAttribute('id') === 'todo1');
      if (el instanceof Y.XmlElement) setAttr(el, 'done', true);
    });
    await until(() => documentTodos(t.doc, 'document')[0]?.done === true, 'Theo to hear the tick');
    expect(documentTodos(s.doc, 'document')[0]?.done).toBe(true);
    expect(await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc])).toBe(before + 1);
    expect(documentTodos(await readDocument(held, doc), 'document')[0]?.done).toBe(true);
    // A change that changes nothing writes nothing.
    await writeDocument(held, doc, () => undefined);
    expect(await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc])).toBe(before + 1);
    // A document nobody ever opened starts from the same seed, with one title.
    const blank = await make(ann, id, 'document', 'Blank');
    await writeDocument(await heldBy(ann, id), blank, (d) => { line({ doc: d }).insert(0, 'Server wrote this first'); });
    const b = await open(ann, id, blank);
    expect(body(b)).toBe('<title></title><line id="first">Server wrote this first</line>');
    // It can't reach what isn't a document here.
    await expect(writeDocument(held, madeUp(), () => undefined)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('won’t write to a document in Trash, and gets refused like anyone else', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    await ann.api.workspaces.items.trash(id, doc);
    await expect(writeDocument(await heldBy(ann, id), doc, () => undefined)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('gives a reader the words of what they can open, block by block, and nothing else', async () => {
    const ann = await account();
    const sam = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const { doc } = await full(ann, id, 'Plan');
    const secret = await make(ann, id, 'document', 'CANARY-SECRET');
    const s = await open(ann, id, secret);
    line(s).insert(0, 'CANARY-SECRET-WORDS');
    await saved(s);
    await ann.api.workspaces.share.restrict(id, secret, true);
    const gone = await make(ann, id, 'document', 'In Trash');
    await ann.api.workspaces.items.trash(id, gone);
    const board = await make(ann, id, 'board', 'A board');
    await make(ann, id, 'folder', 'A folder');
    await ann.api.workspaces.share.set(id, doc, [{ email: sam.email }], 'read');

    const collect = async (who: Account) => { const out = []; for await (const d of who.api.workspaces.searchText(id)) out.push(d); return out; };
    const mine = await collect(ann);
    expect(mine.map((d) => d.id).sort()).toEqual([doc, secret, board].sort());
    expect(mine.find((d) => d.id === doc)).toMatchObject({ kind: 'document', name: 'Plan', title: 'Plan title' });
    expect(mine.find((d) => d.id === doc)?.blocks.find((b) => b.id === 'h1')?.text).toBe('A heading');
    expect(mine.find((d) => d.id === board)).toMatchObject({ kind: 'board', blocks: [] });
    const theirs = await collect(theo);
    expect(theirs.map((d) => d.id).sort()).toEqual([doc, board].sort());
    expect(JSON.stringify(theirs)).not.toContain('CANARY-SECRET');
    const outside = await collect(sam);
    expect(outside.map((d) => d.id)).toEqual([doc]);
    // A reader refused is refused before a line is written.
    const stranger = await account();
    expect((await stranger.fetch(`${h.baseUrl}/v1/workspaces/${id}/search`)).status).toBe(404);
  });
});

describe('what’s kept', () => {
  it('holds nothing readable: not a word, title, mention or comment, in any table, object, notice or log', async () => {
    const notices: string[] = [];
    const url = process.env['TEST_DATABASE_URL'] ?? '';
    const listener = new pg.Client({ connectionString: url });
    await listener.connect();
    listener.on('notification', (m) => { if (m.payload) notices.push(m.payload); });
    await listener.query('LISTEN alcove_workspace');
    try {
      const ann = await account(unique('canary-doc-owner'));
      const theo = await account(unique('canary-doc-editor'));
      const id = await workspace(ann, 'CANARY-DOC-SPACE', [[theo, 'edit']]);
      const doc = await make(ann, id, 'document', 'CANARY-DOC-ITEM');
      const a = await open(ann, id, doc);
      const t = await open(theo, id, doc);
      const live = ann.api.workspaces.live(id);
      live.present({ document: doc, block: 'canary-doc-block', typing: true });
      title(a).insert(0, 'CANARY-DOC-TITLE');
      line(a).insert(0, 'CANARY-DOC-TEXT the merger closes');
      a.doc.transact(() => {
        const thread = new Y.Map<unknown>();
        const replies = new Y.Array<unknown>();
        replies.push([{ id: 'm1', by: 'p', name: 'CANARY-DOC-COMMENTER', text: 'CANARY-DOC-COMMENT', at: 'now' }]);
        thread.set('quote', 'CANARY-DOC-QUOTE');
        thread.set('replies', replies);
        a.doc.getMap('comments').set('t1', thread);
      });
      const mention = addBlock(a, 'line', 'mentions');
      mention.insert(0, [inline('mention', { id: 'canary-doc-mention-id', name: 'CANARY-DOC-MENTION' })]);
      t.awareness.setLocalStateField('cursor', { anchor: 'CANARY-DOC-CURSOR', head: 'CANARY-DOC-CURSOR' });
      await saved(a);
      await says(t, 'CANARY-DOC-TEXT');
      await until(() => [...a.awareness.getStates().values()].some((s) => s['cursor']?.anchor === 'CANARY-DOC-CURSOR'), 'the caret');
      // What's kept of it, every way it's kept: an update, a compaction, a version, and a restore.
      const version = await keepVersion(await heldBy(ann, id), doc, { reason: 'call', callId: null });
      line(a).insert(0, 'CANARY-DOC-LATER ');
      await saved(a);
      for (let i = 0; i < 210; i++) await post(ann, `${docPath(id, doc)}/updates`, { update: toBase64Url(Y.encodeStateAsUpdate(a.doc)) });
      await until(() => compacted(doc), 'the log to compact');
      await ann.api.workspaces.restoreVersion(id, doc, version ?? '');
      await until(() => !body(a).includes('CANARY-DOC-LATER'), 'the restore');
      await ann.api.workspaces.items.duplicate(id, doc);
      for await (const d of ann.api.workspaces.searchText(id)) expect(d.id).toBeTruthy();
      await rest(100);

      const everyTable = (await h.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name);
      expect(everyTable).toEqual(expect.arrayContaining(['document_updates', 'document_snapshots', 'document_versions']));
      const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (${everyTable.map((x) => `SELECT row_to_json(x)::text AS t FROM ${x} x`).join(' UNION ALL ')}) q`);
      const rows = String(dump.rows[0]?.all ?? '');
      expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [doc])).toBeGreaterThan(0);
      expect(notices.some((n) => n.includes(doc))).toBe(true);
      const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
      const canaries = ['CANARY-DOC', 'canary-doc', 'merger closes', ann.name, theo.name];
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
      // A notice carries IDs or something sealed: nothing at all a person typed, and no room for an address.
      expect(notices.join(' ')).not.toContain(ann.email);
    } finally {
      await listener.end();
    }
  });

  it('goes for good: deleting a document, a workspace or the last person in it leaves no row', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const owner = await ownerOf(id);
    const tables = ['document_updates', 'document_snapshots', 'document_versions'];
    const left = async (where: string, value: string) => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(`SELECT count(*)::int AS n FROM ${t} WHERE ${where} = $1`, [value])])));
    const written = async (name: string) => {
      const doc = await make(ann, id, 'document', name);
      const s = await open(ann, id, doc);
      line(s).insert(0, 'Words');
      await saved(s);
      await keepVersion(await heldBy(ann, id), doc, { reason: 'call', callId: null });
      line(s).insert(0, 'More');
      await saved(s);
      s.close();
      return doc;
    };
    const none = Object.fromEntries(tables.map((t) => [t, 0]));

    // For good from Trash.
    const one = await written('One');
    expect(await left('document_id', one)).toEqual({ document_updates: 1, document_snapshots: 1, document_versions: 1 });
    await ann.api.workspaces.items.trash(id, one);
    await ann.api.workspaces.items.deleteForever(id, one);
    expect(await left('document_id', one)).toEqual(none);

    // After 30 days in Trash, by upkeep.
    const two = await written('Two');
    await ann.api.workspaces.items.trash(id, two);
    await rest(10);
    await maintain(h.deps, { trashAgeMs: 1 });
    expect(await left('document_id', two)).toEqual(none);

    // With its workspace.
    await written('Three');
    await ann.api.workspaces.remove(id);
    expect(await left('owner_id', owner)).toEqual(none);

    // With the last person who could open it.
    const leaver = await account();
    const alone = await workspace(leaver, 'Alone');
    const aloneOwner = await ownerOf(alone);
    const doc = await make(leaver, alone, 'document', 'Doc');
    const s = await open(leaver, alone, doc);
    line(s).insert(0, 'Words');
    await saved(s);
    s.close();
    await leaver.api.account.delete();
    expect(await left('owner_id', aloneOwner)).toEqual(none);
  });
});

describe('limits', () => {
  it('holds to a document’s size, and still lets someone delete their way back under it', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const s = await open(ann, id, doc);
    line(s).insert(0, 'Small enough');
    await saved(s);
    await h.pool.query('UPDATE documents SET snapshot_bytes = $2 WHERE document_id = $1', [doc, 16 * 1024 * 1024]);
    line(s).insert(0, 'One more word');
    await until(() => s.getSnapshot().status === 'failed', 'the save to fail');
    expect(s.getSnapshot().refused).toBe('too-large');
    // Only taking words out: that's fine.
    const fresh = await open(ann, id, doc);
    line(fresh).delete(0, 5);
    await saved(fresh);
  });

  it('counts updates and carets per person: past the limit it says to wait, and a browser just tries again', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer();
    try {
      const update = toBase64Url(anUpdate('x'));
      const burst = async (path: string, sent: unknown, n: number) => {
        const statuses: number[] = [];
        for (let i = 0; i < n; i += 50) statuses.push(...(await Promise.all(Array.from({ length: 50 }, () => post(ann, path, sent, second.baseUrl).then((r) => r.status)))));
        return statuses;
      };
      const updates = await burst(`${docPath(id, doc)}/updates`, { update }, 1250);
      expect(updates.filter((s) => s === 200).length).toBe(1200);
      expect(updates.filter((s) => s === 503).length).toBe(50);
      const scratch = new Y.Doc();
      const caret = new Awareness(scratch);
      const carets = await burst(`${docPath(id, doc)}/awareness`, { update: toBase64Url(encodeAwarenessUpdate(caret, [scratch.clientID])) }, 1850);
      caret.destroy();
      expect(carets.filter((s) => s === 200).length).toBe(1800);
      expect(carets.filter((s) => s === 503).length).toBe(50);
    } finally {
      await second.close();
    }
  });
});

