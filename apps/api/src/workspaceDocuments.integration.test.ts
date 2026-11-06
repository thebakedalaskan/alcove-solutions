/**
 * Live documents: people working on one document together, through browsers talking to the real API over HTTP via
 * @alcove/api-http, on real Postgres and, for guests, a real call. What's checked is what people get: their words, after
 * dropped connections, restarts and compactions, and nothing for anyone who can't open it.
 */
import {
  AlcoveApiError, DOC_SEED, DOC_UPDATE_TYPE, DocLiveEventSchema, MAX_DOC_BYTES, MAX_DOC_ITEMS, MAX_DOC_UPDATE_BYTES, OPERATION_HEADER, toBase64Url, type CallState, type DocLiveEvent, type DocSession, type DocSessionOptions, type DocStatus, type ItemKind,
  type KeptUpdate, type KeptUpdates, type WorkspaceHere, type WorkspaceLive, type WorkspaceRole
} from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { isGone, newBlockId, retire as retireBlock } from '@alcove/api/retire';
import { randomBytes } from 'node:crypto';
import * as encoding from 'lib0/encoding';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeAwarenessUpdate, Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { blindIndex, mac, stateKey } from './crypto';
import { maintain } from './maintenance';
import { openState, sealState, workspaceFor, type WorkspaceState } from './modules/workspaceAccess';
import { documentText, documentTodos } from './modules/documentText';
import { sealUpdate } from './modules/documentWork';
import { keepVersion, readDocument, writeDocument, type Held } from './modules/workspaceDocuments';
import { personOf } from './modules/portraits';
import { findOwner, masterKey } from './owners';
import { ORIGIN, startHarness, type Browser, type Harness } from './testing/harness';

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
/** What's on the page: all of it but what's retired and holds nothing. */
const shown = (s: { doc: Y.Doc }) => s.doc.getXmlFragment('content').toArray().filter((el) => !(el instanceof Y.XmlElement && isGone(el))).map((el) => el.toString()).join('');

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

/** A document as the server reads it, to look at here. */
async function serverDoc(w: Held, doc: string): Promise<Y.Doc> {
  const read = new Y.Doc();
  Y.applyUpdate(read, await readDocument(w, doc, 'state', {}));
  return read;
}

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
  const s = await who.api.workspaces.document(id, doc, opts);
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
    add: async (update, at) => { const key = next++; kept.push({ key, update, at }); return key; },
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
/** Bytes as a request body takes them. */
const bytesOf = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);
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
    expect((await serverDoc(await heldBy(ann, id), doc)).getXmlFragment('content').length).toBe(2);
    const board = await make(ann, id, 'board', 'Board');
    expect((await serverDoc(await heldBy(ann, id), board)).getXmlFragment('content').length).toBe(0);
  });

  it('starts from the same seed in every browser, so two people opening a new one get one title', async () => {
    // The editor's seed, made as the editor makes it: the bytes are fixed for good.
    const made = new Y.Doc();
    made.clientID = 1;
    const heading = new Y.XmlElement('title');
    heading.insert(0, [new Y.XmlText()]);
    const first = new Y.XmlElement('line');
    first.setAttribute('id', 'first');
    first.insert(0, [new Y.XmlText()]);
    made.getXmlFragment('content').insert(0, [heading, first]);
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
    // In the one text that was there, so nothing has to merge two.
    const top = a.doc.getXmlFragment('content').get(0);
    expect(top instanceof Y.XmlElement ? top.length : 0).toBe(1);
    const again = await open(ann, id, doc);
    expect(body(again)).toBe(body(a));
    // A server-made write lands in the same first line, not a second title.
    await writeDocument(await heldBy(ann, id), doc, 'retitle', { name: 'From the server' });
    await says(a, 'From the server');
    expect(a.doc.getXmlFragment('content').length).toBe(2);
  });

  it('lets two people edit at once, and each hears the other, in the order it happened and whole after a reload', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const [a, t] = await Promise.all([open(ann, id, doc), open(theo, id, doc)]);
    expect(a.getSnapshot()).toEqual({ status: 'saved', refused: null, role: 'edit', trashed: false, closed: null, unsent: false });

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
    const up = (update: Uint8Array) => sendUpdate(ann, id, doc, update);
    expect((await up(new Uint8Array(0))).status).toBe(400);
    expect((await up(new TextEncoder().encode('{"not":"an update"}'))).status).toBe(400);
    expect((await up(randomBytes(64))).status).toBe(400);
    expect((await post(ann, `${docPath(id, doc)}/updates`, {})).status).toBe(400);
    // More than a document can hold is too much, which is what a browser hears, not that it's never to be.
    expect((await up(new Uint8Array(MAX_DOC_UPDATE_BYTES + 1))).status).toBe(413);
    expect(await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc])).toBe(1);
    expect((await up(anUpdate('A real one'))).status).toBe(200);

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
    const update = bytesOf(anUpdate('Once'));
    const send = () => ann.fetch(`${h.baseUrl}/v1${docPath(id, doc)}/updates`, { method: 'POST', headers: { 'content-type': DOC_UPDATE_TYPE, [OPERATION_HEADER]: madeUp() }, body: update });
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
    for (let i = 0; i < 220; i++) await sendUpdate(ann, id, doc, filler());
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
    const twice = filler();
    await sendUpdate(ann, id, doc, twice);
    await sendUpdate(ann, id, doc, twice);
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
    const s = await there.workspaces.document(id, doc);
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
    const s = await quiet.workspaces.document(id, doc);
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
        await sendUpdate(ann, id, doc, Y.encodeStateAsUpdate(scratch, before));
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
    for (let i = 0; i < 3; i++) await sendUpdate(ann, id, doc, anUpdate(`${i}`.repeat(512 * 1024)));
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

    for (let i = 0; i < 210; i++) { line(s).insert(0, 'x'); await sendUpdate(ann, id, doc, filler()); }
    await until(() => compacted(doc), 'a snapshot');
    const read = await serverDoc(await heldBy(ann, id), doc);
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
    const t = await createHttpApi({ baseUrl: second.baseUrl, fetch: theo.fetch }).workspaces.document(id, doc);
    await t.ready;
    try {
      // Every update its own request, from both instances at the same time, each client's in order, as a browser sends them.
      const one = async (who: Account, base: string, tag: string) => {
        const writer = new Y.Doc();
        Y.applyUpdate(writer, DOC_SEED);
        for (let i = 0; i < 220; i++) {
          const before = Y.encodeStateVector(writer);
          line({ doc: writer }).insert(0, `${tag}${i};`);
          expect((await sendUpdate(who, id, doc, Y.encodeStateAsUpdate(writer, before), base)).status).toBe(200);
        }
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
    await sendUpdate(ann, id, doc, anUpdate('Once'));
    await until(() => sessions.every((s) => words(s) === 'Once'), 'every session to hear');
    expect(h.logs.slice(from).filter((l) => l.includes('SELECT seq, update_ciphertext FROM document_updates'))).toHaveLength(1);
  });

  it('seals each record to its place: copied to another seq, document or workspace, it doesn’t open', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const other = await make(ann, id, 'document', 'Other');
    await sendUpdate(ann, id, doc, anUpdate('Sealed'));
    const owner = await ownerOf(id);
    // Into another document's log.
    await h.pool.query(`INSERT INTO document_updates (owner_id, document_id, seq, update_ciphertext, bytes, items, nesting) SELECT owner_id, $2, 1, update_ciphertext, bytes, items, nesting FROM document_updates WHERE owner_id = $1 AND document_id = $3`, [owner, other, doc]);
    await h.pool.query('UPDATE documents SET next_seq = 2 WHERE owner_id = $1 AND document_id = $2', [owner, other]);
    expect(body(await open(ann, id, other))).not.toContain('Sealed');
    // Or further on in its own.
    await h.pool.query('UPDATE document_updates SET seq = 7 WHERE owner_id = $1 AND document_id = $2', [owner, doc]);
    await h.pool.query('UPDATE documents SET next_seq = 8 WHERE owner_id = $1 AND document_id = $2', [owner, doc]);
    expect(body(await open(ann, id, doc))).not.toContain('Sealed');
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
    const typing = (async () => { for (let i = 0; busy; i++) await sendUpdate(ann, id, doc, anUpdate(`${i}`)); })();
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
        await sendUpdate(ann, id, doc, Y.encodeStateAsUpdate(writer, before));
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
    const streams = Array.from({ length: 8 }, () => stream(second.baseUrl, ann.fetch, id, doc));
    try {
      await until(() => streams.every((s) => s.lines.length > 0), 'eight streams');
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
      expect((await sendUpdate(ann, id, doc, anUpdate('Still works'), second.baseUrl)).status).toBe(200);
      expect((await ann.fetch(`${second.baseUrl}/v1/workspaces/${id}`)).status).toBe(200);
      // A browser refused keeps trying, and gets in when a place frees up.
      const waiting = await createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.document(id, doc);
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
    for (let i = 0; i < 3; i++) await sendUpdate(ann, id, bad, anUpdate('x'));
    await h.pool.query("UPDATE document_updates SET update_ciphertext = 'not a record' WHERE owner_id = $1 AND document_id = $2", [owner, bad]);

    // Search reads what it can of it, and says what it couldn't.
    const found: string[] = [];
    for await (const d of ann.api.workspaces.searchText(id)) found.push(d.id);
    expect(found.sort()).toEqual([bad, good].sort());
    expect(h.logs.some((l) => l.includes('document row skipped') && l.includes(bad))).toBe(true);
    // Writing to it still works: what can't fold is logged, with its IDs, and the update is safe in the log.
    await h.pool.query('UPDATE documents SET updates_since_snapshot = 500 WHERE owner_id = $1 AND document_id = $2', [owner, bad]);
    expect((await sendUpdate(ann, id, bad, anUpdate('y'))).status).toBe(200);
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
    expect((await sendUpdate(rita, id, doc, anUpdate('Refused'))).status).toBe(403);

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
    expect((await sendUpdate(rita, id, doc, anUpdate('Again'))).status).toBe(403);
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
    expect((await sendUpdate(ann, id, doc, anUpdate('No'))).status).toBe(409);
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
    theoLive.present({ document: doc, block: 'first', typing: false, page: null });
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
    const asked = await sendUpdate(theo, id, doc, anUpdate('x'));
    const never = await sendUpdate(theo, id, madeUp(), anUpdate('x'));
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
    // Whatever they send, and whether or not anyone's in the document at the moment.
    const inRoom = await open(ann, id, doc);
    const junk = toBase64Url(randomBytes(40));
    for (const send of [(x: string, y: string) => sendUpdate(sam, x, y, anUpdate('x')), (x: string, y: string) => post(sam, `${docPath(x, y)}/awareness`, { update: 'AA' }), (x: string, y: string) => post(sam, `${docPath(x, y)}/awareness`, { update: junk })]) {
      const real = await send(id, doc);
      const fake = await send(id, madeUp());
      expect([real.status, fake.status]).toEqual([404, 404]);
    }
    inRoom.close();
    const nowhere = await post(sam, `/workspaces/${id}/presence`, { connection: madeUp(), document: null, block: null, typing: false, page: null });
    expect(nowhere.status).toBe(404);
    const live = await sam.api.workspaces.document(id, doc);
    await expect(live.ready).rejects.toMatchObject({ code: 'not-found' });
    expect(live.getSnapshot().closed).toBe('access');
    // Nobody signed in gets nothing, and is told only that.
    const nobody = h.browser();
    expect(await code(nobody.api.workspaces.versions(id, doc))).toBe('unauthenticated');
    expect((await sendUpdate(nobody, id, doc, anUpdate('x'))).status).toBe(401);
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
      expect((await sendUpdate(ann, where, doc, anUpdate('x'))).status).toBe(404);
      expect((await post(ann, `${docPath(where, doc)}/awareness`, { update: 'AA' })).status).toBe(404);
      expect((await ann.fetch(`${h.baseUrl}/v1${docPath(where, doc)}/live`)).status).toBe(404);
    }
    expect((await post(ann, `/workspaces/${mine}/presence`, { connection: madeUp(), document: docThere, block: null, typing: false, page: null })).status).toBe(404);
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
    const refused = await b.api.workspaces.document(id, doc, { pass });
    await expect(refused.ready).rejects.toMatchObject({ code: 'not-found' });
    await org.api.workspaces.share.set(id, doc, [{ seat }], 'read', { pass: host.ticket.pass });

    const g = await open(b, id, doc, { pass });
    expect(g.getSnapshot().role).toBe('read');
    expect(words(g)).toBe('For the call');
    expect((await b.fetch(`${h.baseUrl}/v1${docPath(id, doc)}/updates`, { method: 'POST', headers: { 'content-type': DOC_UPDATE_TYPE, 'x-alcove-call': pass }, body: bytesOf(anUpdate('x')) })).status).toBe(403);
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
    const t = await there.workspaces.document(id, doc);
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

    t.present({ document: open1, block: 'first', typing: true, page: null });
    await until(() => of(a, theo)?.document === open1, 'Ann to see Theo in the document');
    expect(of(a, theo)).toMatchObject({ block: 'first', typing: true, elsewhere: false });
    await until(() => of(p, theo)?.document === open1, 'Priya to see the same');

    a.present({ document: secret, block: 'b1', typing: true, page: null });
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
    const real = await post(theo, `/workspaces/${id}/presence`, { connection: madeUp(), document: secret, block: null, typing: false, page: null });
    const fake = await post(theo, `/workspaces/${id}/presence`, { connection: madeUp(), document: madeUp(), block: null, typing: false, page: null });
    expect([real.status, fake.status]).toEqual([404, 404]);
    expect((await post(theo, `/workspaces/${id}/presence`, { connection: 'short', document: null, block: null, typing: false, page: null })).status).toBe(400);
    expect((await post(theo, `/workspaces/${id}/presence`, { connection: madeUp(), document: null, block: '<b>', typing: false, page: null })).status).toBe(400);

    // Someone in the browser asks to be somewhere they lost: it quietly falls back to being in the workspace.
    const t = theo.api.workspaces.live(id);
    const a = ann.api.workspaces.live(id);
    t.present({ document: secret, block: null, typing: false, page: null });
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
    a.present({ document: doc, block: null, typing: false, page: null });
    t.present({ document: other, block: null, typing: false, page: null });
    s.present({ document: doc, block: null, typing: false, page: null });
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
    o.present({ document: doc, block: null, typing: false, page: null });
    g.present({ document: doc, block: null, typing: false, page: null });
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
    o.present({ document: secret, block: null, typing: false, page: null });
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
    a.present({ document: doc, block: null, typing: false, page: null });
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
    const then = shown(a);

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
    const today = shown(a);
    expect(today).not.toBe(then);

    expect(await code(rita.api.workspaces.restoreVersion(id, doc, kept))).toBe('forbidden');
    expect(await code(ann.api.workspaces.restoreVersion(id, doc, madeUp()))).toBe('not-found');
    await ann.api.workspaces.restoreVersion(id, doc, kept);

    // It arrives like anything else anyone typed, for everyone, and the tree's name follows the title.
    await until(() => shown(a) === then && shown(t) === then, 'both to show the version');
    expect(a.doc.getMap('comments').get('marker')).toBe(false);
    expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc])).toBeGreaterThan(0);
    await until(async () => (await ann.api.workspaces.items.get(id, doc)).name === 'The old title', 'the tree’s name to follow');

    // Today's is a version too.
    const list = await ann.api.workspaces.versions(id, doc);
    expect(list[0]).toMatchObject({ reason: 'restore' });
    const saving = await ann.api.workspaces.version(id, doc, list[0]?.id ?? '');
    const past = new Y.Doc();
    Y.applyUpdate(past, saving.update);
    expect(shown({ doc: past })).toBe(today);
    await ann.api.workspaces.restoreVersion(id, doc, list[0]?.id ?? '');
    await until(() => shown(a) === today, 'today’s to come back');
    expect(shown(await open(theo, id, doc))).toBe(today);

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
    for (let i = 0; i < 210; i++) { line(a).insert(0, 'z'); await sendUpdate(ann, id, doc, filler()); }
    await saved(a);
    await until(() => compacted(doc), 'the log to compact');
    const fresh = await open(ann, id, doc);
    expect(body(fresh)).not.toContain('The words');

    const version = await ann.api.workspaces.version(id, doc, kept);
    const past = new Y.Doc();
    Y.applyUpdate(past, version.update);
    expect(past.getXmlFragment('content').toString()).toBe(then);
    await ann.api.workspaces.restoreVersion(id, doc, kept);
    await until(() => body(fresh) === then && body(a) === then, 'the deleted words to come back');
  });

  it('keeps versions up to a budget of bytes, however many there are, dropping the oldest past it', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const s = await open(ann, id, doc);
    const held = await heldBy(ann, id);
    line(s).insert(0, 'v');
    await saved(s);
    const first = await keepVersion(held, doc, { reason: 'call', callId: null });
    // As if it had been edited for days.
    const copies = async (n: number) => h.pool.query(`INSERT INTO document_versions (owner_id, document_id, version_id, info_ciphertext, bytes, parts, created_at)
      SELECT owner_id, document_id, $2 || lpad(g::text, 10, '0'), info_ciphertext, bytes, parts, created_at + (g || ' seconds')::interval
      FROM (SELECT * FROM document_versions WHERE document_id = $1 LIMIT 1) v, generate_series(1, $3::int) g`, [doc, madeUp().slice(0, 12), n]);
    await copies(205);
    line(s).insert(0, 'w');
    await saved(s);
    const newest = await keepVersion(held, doc, { reason: 'call', callId: null });
    // None goes for being one of many: the oldest may be the last to hold words deleted since.
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [doc])).toBe(207);
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1 AND version_id = $2', [doc, first])).toBe(1);
    // Past the budget the oldest go, and however many bytes they come to, the newest stays.
    await h.pool.query("UPDATE document_versions SET bytes = 40 * 1024 * 1024 WHERE document_id = $1 AND version_id <> $2 AND version_id IN (SELECT version_id FROM document_versions WHERE document_id = $1 AND version_id <> $2 ORDER BY created_at DESC LIMIT 3)", [doc, newest]);
    line(s).insert(0, 'x');
    await saved(s);
    await keepVersion(held, doc, { reason: 'call', callId: null });
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [doc])).toBeLessThanOrEqual(3);
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1 AND version_id = $2', [doc, first])).toBe(0);
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
    const read = await serverDoc(held, doc);
    const text = documentText(read, 'document');
    expect(text.title).toBe('Plan title');
    expect(text.blocks).toEqual(expect.arrayContaining([
      { id: 'first', type: 'paragraph', text: 'A first line' }, { id: 'h1', type: 'heading', text: 'A heading' },
      { id: 'todo1', type: 'todo', text: 'Send the brief to Priya Rao by 2026-11-06' }, { id: 'tg', type: 'toggle', text: 'Toggle summary\nToggle body' },
      { id: 'tb', type: 'table', text: 'Cell one\tCell two' }, { id: 'lv', type: 'live', text: 'Decided: ship it' }, { id: 'mo', type: 'moment', text: 'What was said' },
      { id: 'fi', type: 'file', text: 'brief.pdf' }, { id: 'ga', type: 'gallery', text: 'A caption Another' }, { id: 'lk', type: 'paragraph', text: 'See ' }
    ]));
    expect(documentTodos(read, 'document')).toEqual([
      // A follow-up's words read as a sentence: a tag inside one is part of it, and a date is a day.
      { block: 'todo1', text: 'Send the brief to Priya Rao by 6 Nov', done: false, mentions: [{ id: 'p1', name: 'Priya Rao' }], dates: ['2026-11-06'] },
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

  it('reads what’s on the page, as the editor does: nothing retired, unless it’s still holding something', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const { doc, s } = await full(ann, id, 'Plan');
    const element = (name: string) => {
      const el = s.doc.getXmlFragment('content').toArray().find((e) => e instanceof Y.XmlElement && e.getAttribute('id') === name);
      if (!(el instanceof Y.XmlElement)) throw new Error(`no block ${name}`);
      return el;
    };
    // A toggle and a table keep their parts when they're retired, which read as a line break and a tab if read at all.
    s.doc.transact(() => { for (const name of ['tg', 'tb', 'h1']) retireBlock(element(name), newBlockId(), ''); });
    await saved(s);
    const read = await readDocument(await heldBy(ann, id), doc, 'text', { kind: 'document' });
    expect(read.blocks.map((b) => b.id)).not.toEqual(expect.arrayContaining(['tg']));
    expect(read.blocks.some((b) => b.type === 'toggle' || b.type === 'table')).toBe(false);
    // A todo that's retired just as someone tags someone in it is on the page, with the tag.
    const todo = element('todo1');
    s.doc.transact(() => {
      retireBlock(todo, 'held', '');
      todo.insert(0, [blockOf('mention', { id: 'p', name: 'Priya Rao' })]);
    });
    await saved(s);
    const todos = async () => (await readDocument(await heldBy(ann, id), doc, 'todos', { kind: 'document' })).map((t) => t.block);
    expect(await todos()).toEqual(['held', 'todo2']);
    // And once that goes too, so is it.
    s.doc.transact(() => { todo.delete(0, todo.length); });
    await saved(s);
    expect(await todos()).toEqual(['todo2']);
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
    // A change from the server, by name, because it's made in a worker.
    await writeDocument(held, doc, 'retitle', { name: 'Named by the server' });
    await until(() => documentText(t.doc, 'document').title === 'Named by the server', 'Theo to hear it');
    expect(documentText(s.doc, 'document').title).toBe('Named by the server');
    expect(await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc])).toBe(before + 1);
    expect((await readDocument(held, doc, 'text', { kind: 'document' })).title).toBe('Named by the server');
    expect((await readDocument(held, doc, 'todos', { kind: 'document' }))[0]?.text).toContain('Send the brief');
    // A change that changes nothing writes nothing.
    await writeDocument(held, doc, 'retitle', { name: 'Named by the server' });
    expect(await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc])).toBe(before + 1);
    // A document nobody ever opened starts from the same seed, with one title.
    const blank = await make(ann, id, 'document', 'Blank');
    await writeDocument(await heldBy(ann, id), blank, 'retitle', { name: 'Server wrote this first' });
    const b = await open(ann, id, blank);
    expect(body(b)).toBe('<title>Server wrote this first</title><line id="first"></line>');
    // It can't reach what isn't a document here.
    await expect(writeDocument(held, madeUp(), 'retitle', { name: 'x' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('won’t write to a document in Trash, and gets refused like anyone else', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    await ann.api.workspaces.items.trash(id, doc);
    await expect(writeDocument(await heldBy(ann, id), doc, 'retitle', { name: 'x' })).rejects.toMatchObject({ code: 'conflict' });
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
      live.present({ document: doc, block: 'canary-doc-block', typing: true, page: null });
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
      for (let i = 0; i < 210; i++) await sendUpdate(ann, id, doc, filler());
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

  it('can’t say who wrote what: a client’s row links to nobody, and to no other row', async () => {
    const { ann, id, doc } = await together();
    const other = await make(ann, id, 'document', 'Other');
    const client = 4100;
    for (const [where, c] of [[doc, client], [doc, client + 1], [other, client]] as const) expect((await sendUpdate(ann, id, where, block(c, 0, [item({ root: 'scratch' })]))).status).toBe(200);
    const row = async (where: string, c: number) => (await h.pool.query<{ people: Buffer }>('SELECT people FROM document_clients WHERE document_id = $1 AND client_id = $2', [where, c])).rows[0]?.people.toString('hex') ?? '';
    const tags = [await row(doc, client), await row(doc, client + 1), await row(other, client)];
    // The same person, as two clients, and as one client in two documents: nothing in common, so no row says anything about another.
    expect(tags.every((t) => t.length > 0)).toBe(true);
    expect(new Set(tags).size).toBe(3);
    expect(tags.some((t) => t.includes(Buffer.from(blindIndex(masterKey(h.deps), 'email', ann.email)).toString('hex')))).toBe(false);
    // What the server wrote belongs to nobody, so nobody can write as it.
    expect(await row(doc, 1)).toBe('');
  });

  it('goes for good: deleting a document, a workspace or the last person in it leaves no row', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const owner = await ownerOf(id);
    const tables = ['document_updates', 'document_snapshots', 'document_versions', 'document_version_parts', 'document_clients'];
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
    expect(await left('document_id', one)).toMatchObject({ document_updates: 1, document_snapshots: 1, document_versions: 1, document_version_parts: 1 });
    expect((await left('document_id', one))['document_clients']).toBeGreaterThan(0);
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
    const s0 = await open(ann, id, doc);
    for (let i = 0; i < 6; i++) addBlock(s0, 'line', `b${i}`).insert(0, [new Y.XmlText(`Words of ${i}`)]);
    await saved(s0);
    s0.close();
    await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    const page = await count('SELECT (snapshot_items - snapshot_retired_items)::int AS n FROM documents WHERE document_id = $1', [doc]);
    const second = await h.secondServer({ DOC_ITEMS_MAX: page + 2 });
    try {
      const api = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
      const s = await api.workspaces.document(id, doc);
      await s.ready;
      for (let i = 0; i < 2; i++) addBlock(s, 'line', `more${i}`).insert(0, [new Y.XmlText('One more block')]);
      await until(() => s.getSnapshot().status === 'failed', 'the save to fail');
      expect(s.getSnapshot()).toMatchObject({ refused: 'too-large', unsent: true });
      // Only taking words out: that's fine.
      const fresh = await api.workspaces.document(id, doc);
      await fresh.ready;
      line(fresh, 'b0').delete(0, 5);
      await until(() => fresh.getSnapshot().status === 'saved', 'the delete to go', 5_000);
      fresh.close();
      s.close();
    } finally {
      await second.close();
    }
  });

  it('counts updates and carets per person: past the limit it says to wait, and a browser just tries again', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer();
    try {
      const update = anUpdate('x');
      const burst = async (send: () => Promise<Response>, n: number) => {
        const statuses: number[] = [];
        for (let i = 0; i < n; i += 50) statuses.push(...(await Promise.all(Array.from({ length: 50 }, () => send().then((r) => r.status)))));
        return statuses;
      };
      const updates = await burst(() => sendUpdate(ann, id, doc, update, second.baseUrl), 1250);
      expect(updates.filter((s) => s === 200).length).toBe(1200);
      expect(updates.filter((s) => s === 503).length).toBe(50);
      const scratch = new Y.Doc();
      const caret = new Awareness(scratch);
      const here = stream(second.baseUrl, ann.fetch, id, doc);
      await until(() => here.lines.length > 0, 'a stream');
      const sent = { update: toBase64Url(encodeAwarenessUpdate(caret, [scratch.clientID])) };
      const carets = await burst(() => post(ann, `${docPath(id, doc)}/awareness`, sent, second.baseUrl), 1850);
      caret.destroy();
      here.stop();
      expect(carets.filter((s) => s === 200).length).toBe(1800);
      expect(carets.filter((s) => s === 503).length).toBe(50);
    } finally {
      await second.close();
    }
  });
});

/* ---------- updates written by hand, by someone who isn't a browser ---------- */

type Struct = (e: encoding.Encoder) => void;
const noDeletes: Struct = (e) => { encoding.writeVarUint(e, 0); };
/** Deletes of `[client, clock, len]`, as a browser's update ends. */
const deleting = (...ranges: [number, number, number][]): Struct => (e) => {
  encoding.writeVarUint(e, ranges.length);
  for (const [client, clock, len] of ranges) { encoding.writeVarUint(e, client); encoding.writeVarUint(e, 1); encoding.writeVarUint(e, clock); encoding.writeVarUint(e, len); }
};
/** One client's structs and a delete set: Yjs's update format, byte by byte. */
function structsOf(blocks: { client: number; clock: number; structs: Struct[] }[], deletes: Struct = noDeletes): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, blocks.length);
  for (const b of blocks) {
    encoding.writeVarUint(e, b.structs.length);
    encoding.writeVarUint(e, b.client);
    encoding.writeVarUint(e, b.clock);
    for (const s of b.structs) s(e);
  }
  deletes(e);
  return encoding.toUint8Array(e);
}
const block = (client: number, clock: number, structs: Struct[], deletes?: Struct) => structsOf([{ client, clock, structs }], deletes);
const onlyDeletes = (...ranges: [number, number, number][]) => structsOf([], deleting(...ranges));
const gc = (len: number): Struct => (e) => { encoding.writeUint8(e, 0); encoding.writeVarUint(e, len); };
const skip = (len: number): Struct => (e) => { encoding.writeUint8(e, 10); encoding.writeVarUint(e, len); };
type Id = [number, number];
/** A string, placed by what's on either side of it, or at the top of a root, or under a parent. */
const item = (o: { origin?: Id; right?: Id; root?: string; parent?: Id; text?: string }): Struct => (e) => {
  encoding.writeUint8(e, 4 | (o.origin ? 0x80 : 0) | (o.right ? 0x40 : 0));
  if (o.origin) { encoding.writeVarUint(e, o.origin[0]); encoding.writeVarUint(e, o.origin[1]); }
  if (o.right) { encoding.writeVarUint(e, o.right[0]); encoding.writeVarUint(e, o.right[1]); }
  if (!o.origin && !o.right) {
    if (o.parent) { encoding.writeVarUint(e, 0); encoding.writeVarUint(e, o.parent[0]); encoding.writeVarUint(e, o.parent[1]); }
    else { encoding.writeVarUint(e, 1); encoding.writeVarString(e, o.root ?? 'content'); }
  }
  encoding.writeVarString(e, o.text ?? 'x');
};
/** Sends an update as a browser would. */
const sendUpdate = (who: { fetch: typeof fetch }, id: string, doc: string, update: Uint8Array, base = h.baseUrl) => who.fetch(`${base}/v1${docPath(id, doc)}/updates`, { method: 'POST', headers: { 'content-type': DOC_UPDATE_TYPE }, body: bytesOf(update) });
/** An update that says nothing to anyone's content: a client of its own, in a root of its own. */
const filler = () => block(1_000_000 + randomBytes(3).readUIntBE(0, 3), 0, [item({ root: 'elsewhere' })]);
/** Several people in one workspace, and a document, with a word in it. */
async function together() {
  const [ann, bob, mal] = await Promise.all([account(), account(), account()]);
  const id = await workspace(ann, 'Ours', [[bob, 'edit'], [mal, 'edit']]);
  const doc = await make(ann, id, 'document', 'Plan');
  return { ann, bob, mal, id, doc };
}
const typing = async (who: { fetch: typeof fetch }, id: string, doc: string, n: number, word = 'w', base = h.baseUrl) => {
  for (let i = 0; i < n; i++) expect((await sendUpdate(who, id, doc, anUpdate(`${word}${i} `), base)).status).toBe(200);
};
/** A nest of elements, each inside the last, in a root of its own, sent in steps of `step`. */
function nesting(client: number) {
  const src = new Y.Doc();
  src.clientID = client;
  let at: Y.XmlElement | Y.XmlFragment = src.getXmlFragment('nest');
  return {
    deeper(by: number): Uint8Array {
      const before = Y.encodeStateVector(src);
      src.transact(() => { for (let i = 0; i < by; i++) { const el = new Y.XmlElement('b'); at.insert(0, [el]); at = el; } });
      return Y.encodeStateAsUpdate(src, before);
    }
  };
}
/**
 * A: one item. R: a run after it. T: `n` more, each after A, each naming something further along R as what's to its right. R and
 * T are browsers' clients, past the server's own, and small enough to take a byte each.
 */
function conflicting(n: number): Uint8Array {
  const R = 100;
  const T = 99;
  const run: Struct[] = [item({ root: 'attack', text: 'a' })];
  for (let i = 1; i <= n; i++) run.push(item({ origin: [R, i - 1], text: 'r' }));
  const after: Struct[] = [];
  for (let i = 0; i < n; i++) after.push(item({ origin: [R, 0], right: [R, n - i], text: 't' }));
  return structsOf([{ client: R, clock: 0, structs: run }, { client: T, clock: 0, structs: after }]);
}
/** A seeded random, so a failure can be run again. */
function seeded(seed: number) {
  let s = seed;
  return (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
}
/** Under what one update may do, and still slow to open: each update's items sit after one neighbour, with something further along a run to their right. */
function conflictingAfter(client: number, n: number, run: number | null): Uint8Array {
  const R = run ?? client;
  const long = n * 12;
  const made: { client: number; clock: number; structs: Struct[] }[] = [];
  if (run === null) made.push({ client, clock: 0, structs: [item({ root: 'attack', text: 'a' }), ...Array.from({ length: long }, (_, i) => item({ origin: [client, i], text: 'r' }))] });
  const T = client + 1;
  made.push({ client: T, clock: 0, structs: Array.from({ length: n }, (_, i) => item({ origin: [R, 0], right: [R, long - (client - R) * 40 - i], text: 't' })) });
  return structsOf(made);
}
/** Puts a row in a document's log as if it had got past everything, for what reads the log to cope with. */
async function slipIn(id: string, doc: string, seq: number, update: Uint8Array): Promise<void> {
  const ownerId = await ownerOf(id);
  const owner = await findOwner(h.deps, ownerId, undefined);
  if (!owner) throw new Error('no such workspace');
  const sealed = sealUpdate({ ownerId, workspaceId: id, documentId: doc }, stateKey(owner.root, ownerId, `document:${doc}`), seq, null, update);
  await h.pool.query('INSERT INTO document_updates (owner_id, document_id, seq, update_ciphertext, bytes, items, nesting) VALUES ($1,$2,$3,$4,$5,1,0)', [ownerId, doc, seq, sealed, update.length]);
}
const bystander = (who: Account, base = h.baseUrl) => who.fetch(`${base}/v1/session`).then((r) => { void r.body?.cancel(); return r.status; });

describe('what a browser sends', () => {
  it('refuses the 8 bytes that left a document unopenable after its next compaction', async () => {
    const { ann, mal, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Everything the team wrote before. ');
    await saved(a);
    await backdate(doc);
    line(a).insert(0, 'Then a little more. ');
    await saved(a);
    await until(async () => (await ann.api.workspaces.versions(id, doc)).length === 1, 'a version');
    const before = await rowsOf(doc);

    const eight = block(4242, 0, [gc(0)]);
    expect(eight.length).toBe(8);
    expect((await sendUpdate(mal, id, doc, eight)).status).toBe(400);
    expect(await rowsOf(doc)).toEqual(before);

    // Ann carries on, past a compaction, and everything that broke before still works.
    await typing(ann, id, doc, 210);
    await until(async () => (await rowsOf(doc)).through > before.through, 'a compaction');
    const fresh = await open(ann, id, doc);
    expect(body(fresh)).toContain('Everything the team wrote before.');
    const found: string[] = [];
    for await (const d of ann.api.workspaces.searchText(id)) found.push(d.id);
    expect(found).toEqual([doc]);
    const copy = await ann.api.workspaces.items.duplicate(id, doc);
    expect(body(await open(ann, id, copy.id))).toContain('Everything the team wrote before.');
    const [version] = await ann.api.workspaces.versions(id, doc);
    await ann.api.workspaces.restoreVersion(id, doc, version?.id ?? '');
    await says(fresh, 'Everything the team wrote before.');
  });

  it('refuses the 14 bytes that sent everyone offline, naming a clock its client never reached', async () => {
    const { ann, mal, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Still here');
    await saved(a);
    const C = 777777;
    const fourteen = block(C, 0, [item({ origin: [C, 5] })]);
    expect(fourteen.length).toBeLessThanOrEqual(14);
    expect((await sendUpdate(mal, id, doc, fourteen)).status).toBe(400);
    await rest(100);
    expect(a.getSnapshot()).toMatchObject({ status: 'saved', closed: null });
    const fresh = await open(mal, id, doc);
    expect(body(fresh)).toContain('Still here');
    await typing(mal, id, doc, 205);
    await until(() => compacted(doc), 'a compaction');
    expect((await rowsOf(doc)).updates).toBeLessThan(200);
  });

  it('refuses a 45 KB nest, whole or built up an update at a time, so the top being deleted harms nothing', async () => {
    const { ann, mal, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Still here');
    await saved(a);
    const whole = nesting(4040).deeper(5000);
    expect(whole.length).toBeLessThan(50_000);
    // Too much, which is what taking it out would change.
    expect((await sendUpdate(mal, id, doc, whole)).status).toBe(413);
    // Nothing was kept of it, so a 7-byte delete of it means nothing.
    expect((await sendUpdate(mal, id, doc, onlyDeletes([4040, 0, 1]))).status).toBe(400);

    const steps = nesting(5050);
    let deep = 0;
    for (; deep < 5000; deep += 100) if ((await sendUpdate(mal, id, doc, steps.deeper(100))).status !== 200) break;
    expect(deep).toBeLessThan(5000);
    expect((await sendUpdate(mal, id, doc, onlyDeletes([5050, 0, 1]))).status).toBe(200);
    // Nobody else is held up by it for longer than it takes a compaction to see it's gone, and what they typed waits and goes.
    line(a).insert(0, 'Typed after it. ');
    const added = addBlock(a, 'line', 'after');
    added.insert(0, [new Y.XmlText('A block after it')]);
    await saved(a);
    await until(() => compacted(doc), 'a compaction');
    const fresh = await open(ann, id, doc);
    expect(body(fresh)).toContain('Still here');
    expect(body(fresh)).toContain('A block after it');
    expect(a.getSnapshot()).toMatchObject({ status: 'saved', closed: null });
  });

  it('refuses to delete what was never written, so deletes can’t fill a document or be carried for ever', async () => {
    const { ann, mal, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Words');
    await saved(a);
    expect((await sendUpdate(mal, id, doc, onlyDeletes([12345, 0, 1_000_000]))).status).toBe(400);
    expect((await sendUpdate(mal, id, doc, onlyDeletes([a.doc.clientID, 0, 1_000_000]))).status).toBe(400);
    expect((await sendUpdate(mal, id, doc, onlyDeletes([1, 0, 6]))).status).toBe(400);
    const row = await h.pool.query<{ next_seq: string }>('SELECT next_seq FROM documents WHERE document_id = $1', [doc]);
    expect(Number(row.rows[0]?.next_seq)).toBe(2);
    // What's there can be deleted, and adding more still works.
    line(a).delete(0, 2);
    await saved(a);
    line(a).insert(0, 'More ');
    await saved(a);
    expect(a.getSnapshot().refused).toBeNull();
  });

  it('keeps what someone typed in the title while the server was renaming it', async () => {
    const { ann, bob, id, doc } = await together();
    const a = await open(ann, id, doc);
    title(a).insert(0, 'Plan');
    await saved(a);
    const link = network(bob);
    const b = await open(link.browser, id, doc);
    await says(b, 'Plan');
    link.drop();
    title(b).insert(4, ' for Tuesday');
    await writeDocument(await heldBy(ann, id), doc, 'retitle', { name: 'Named by the server' });
    await says(a, 'Named by the server');
    expect(body(a)).not.toContain('Plan');
    link.back();
    await saved(b);
    await says(a, ' for Tuesday');
    expect(body(a)).toContain('Named by the server');
    expect(body(b)).toBe(body(a));
  });

  it('keeps a client to whoever first wrote with it, so nobody can claim someone’s words away', async () => {
    const { ann, bob, mal, id, doc } = await together();
    const a = await open(ann, id, doc);
    const link = network(bob);
    const b = await open(link.browser, id, doc);
    line(b).insert(0, 'Bob online. ');
    await saved(b);
    await says(a, 'Bob online.');
    link.drop();
    line(b).insert(0, 'Bob wrote this on the train. ');
    const client = b.doc.clientID;
    const reached = Y.decodeStateVector(Y.encodeStateVector(a.doc)).get(client) ?? 0;
    expect(reached).toBeGreaterThan(0);

    // Every editor can read the state vector, and nobody may write past it for him.
    expect((await sendUpdate(mal, id, doc, block(client, reached, [gc(2 ** 40)]))).status).toBe(400);
    expect((await sendUpdate(mal, id, doc, block(client, reached, [item({ root: 'content', text: 'Not Bob' })]))).status).toBe(400);
    // Nor as the seed, nor under what the server wrote.
    expect((await sendUpdate(mal, id, doc, block(1, 5, [item({ root: 'content' })]))).status).toBe(400);

    link.back();
    await saved(b);
    await says(a, 'Bob wrote this on the train.');
    expect(body(await open(ann, id, doc))).toContain('Bob wrote this on the train.');
    expect(() => b.close()).not.toThrow();

    // Whoever got there first keeps it, and the same person in another tab is still the same person.
    expect((await sendUpdate(mal, id, doc, block(4242, 0, [item({ root: 'scratch' })]))).status).toBe(200);
    expect((await sendUpdate(ann, id, doc, block(4242, 1, [item({ root: 'scratch' })]))).status).toBe(400);
    expect((await sendUpdate(mal, id, doc, block(4242, 1, [item({ root: 'scratch' })]))).status).toBe(200);
  });

  it('refuses every shape an honest client can’t make, and stores none of it', async () => {
    const { ann, id, doc } = await together();
    const C = 1234;
    const shapes: [string, Uint8Array][] = [
      ['a zero-length GC', block(C, 0, [gc(0)])],
      ['a zero-length GC among others', block(C, 0, [gc(3), gc(0), gc(2)])],
      ['an empty string', block(C, 0, [item({ root: 'content', text: '' })])],
      ['a skip', block(C, 0, [item({ root: 'content' }), skip(4), item({ root: 'content' })])],
      ['a gap before anything', block(C, 5, [item({ root: 'content' })])],
      ['a clock past 2^53', block(C, 0, [gc(2 ** 52), gc(2 ** 52), gc(2 ** 52)])],
      ['an origin past its own client', block(C, 0, [item({ root: 'content' }), item({ origin: [C, 9] })])],
      ['a right origin past its own client', block(C, 0, [item({ right: [C, 5] })])],
      ['a parent past its own client', block(C, 0, [item({ parent: [C, 5] })])],
      ['an origin on itself', block(C, 0, [item({ origin: [C, 0] })])],
      ['an origin on someone who never wrote', block(C, 0, [item({ origin: [99, 0] })])],
      ['a right origin past what the seed holds', block(C, 0, [item({ right: [1, 5] })])],
      ['a parent nobody wrote', block(C, 0, [item({ parent: [99, 0] })])],
      ['two clients waiting on each other', structsOf([{ client: 7001, clock: 0, structs: [item({ origin: [7002, 0] })] }, { client: 7002, clock: 0, structs: [item({ origin: [7001, 0] })] }])],
      ['one client twice', structsOf([{ client: C, clock: 0, structs: [item({ root: 'content' })] }, { client: C, clock: 1, structs: [item({ root: 'content' })] }])],
      ['a client with no structs', structsOf([{ client: C, clock: 0, structs: [] }])],
      ['bytes after the end', new Uint8Array([...block(C, 0, [item({ root: 'content' })]), 9, 9, 9, 9])],
      ['a sub-document', block(C, 0, [(e) => { encoding.writeUint8(e, 9); encoding.writeVarUint(e, 1); encoding.writeVarString(e, 'content'); encoding.writeVarString(e, 'guid'); encoding.writeUint8(e, 126); }])],
      ['a delete of length zero', structsOf([], deleting([1, 0, 0]))],
      ['JSON that isn’t', block(C, 0, [(e) => { encoding.writeUint8(e, 5); encoding.writeVarUint(e, 1); encoding.writeVarString(e, 'content'); encoding.writeVarString(e, '{not json'); }])],
      ['a type that doesn’t exist', block(C, 0, [(e) => { encoding.writeUint8(e, 7); encoding.writeVarUint(e, 1); encoding.writeVarString(e, 'content'); encoding.writeVarUint(e, 99); }])],
      ['content that doesn’t exist', block(C, 0, [(e) => { encoding.writeUint8(e, 20); encoding.writeVarUint(e, 1); encoding.writeVarString(e, 'content'); }])],
      ['an array nested past reason', block(C, 0, [(e) => { encoding.writeUint8(e, 8); encoding.writeVarUint(e, 1); encoding.writeVarString(e, 'content'); encoding.writeVarUint(e, 1); for (let i = 0; i < 100_000; i++) { encoding.writeUint8(e, 117); encoding.writeVarUint(e, 1); } encoding.writeUint8(e, 126); }])]
    ];
    for (const [what, update] of shapes) expect([what, (await sendUpdate(ann, id, doc, update)).status]).toEqual([what, 400]);
    expect(await count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [doc])).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc])).toBe(0);
    expect(body(await open(ann, id, doc))).toBe('<title></title><line id="first"></line>');
  });

  it('refuses 224 KB of items all after one neighbour, and doesn’t stop for it', async () => {
    const { ann, mal, id, doc } = await together();
    const shape = conflicting(16_000);
    expect(shape.length).toBeLessThan(300_000);
    const t0 = performance.now();
    expect((await sendUpdate(mal, id, doc, shape)).status).toBe(413);
    expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc])).toBe(0);
    expect(await bystander(ann)).toBe(200);
    expect(performance.now() - t0).toBeLessThan(5000);
    // Fewer of them is something people can do, and it opens.
    expect((await sendUpdate(mal, id, doc, conflicting(400))).status).toBe(200);
    expect(body(await open(ann, id, doc))).toContain('first');
  });

  it('looks at nothing for someone who can’t write there', async () => {
    const { ann, id, doc } = await together();
    const stranger = await account();
    const reader = await account();
    await ann.api.workspaces.addPerson(id, reader.email, 'read');
    const junk = randomBytes(64);
    expect((await sendUpdate(stranger, madeUp(), madeUp(), junk)).status).toBe(404);
    expect((await sendUpdate(stranger, id, doc, junk)).status).toBe(404);
    expect((await sendUpdate(reader, id, doc, junk)).status).toBe(403);
    expect((await sendUpdate(ann, id, doc, junk)).status).toBe(400);
  });

  it('takes everything honest browsers do: any kind of content, undo, deletes in one go, a drop, a reload, and two people at once', async () => {
    const { ann, bob, id, doc } = await together();
    const link = network(ann);
    const store = keepStore();
    let a = await open(link.browser, id, doc, { keep: store.keep });
    const b = await open(bob, id, doc);
    const random = seeded(20261104);
    let undo = new Y.UndoManager(a.doc.getXmlFragment('content'), { captureTimeout: 0 });
    let blocks = 0;
    const steps: ((s: DocSession) => void)[] = [
      (s) => { line(s).insert(0, `word${random(1000)} `); },
      (s) => { const t = line(s); t.insert(random(t.length + 1), 'mid'); },
      (s) => { const t = line(s); if (t.length > 4) t.delete(random(t.length - 3), 3); },
      (s) => { const t = line(s); if (t.length > 4) t.format(0, 3, { bold: true }); },
      (s) => { const el = addBlock(s, 'line', `b${blocks++}`, { kind: 'todo', done: false, level: 2, lines: [{ text: 'x' }] }); const t = new Y.XmlText(); el.insert(0, [t]); t.insert(0, 'In a block'); },
      (s) => { const f = s.doc.getXmlFragment('content'); if (f.length > 3) f.delete(f.length - 1, 1); },
      (s) => { s.doc.transact(() => { const el = addBlock(s, 'line', `gone${blocks++}`); const t = new Y.XmlText(); el.insert(0, [t]); t.insert(0, 'Made and deleted at once'); const f = s.doc.getXmlFragment('content'); f.delete(f.length - 1, 1); }); },
      (s) => { const m = s.doc.getMap('comments'); const thread = new Y.Map(); thread.set('text', 'A thought'); thread.set('replies', new Y.Array()); m.set(`t${random(20)}`, thread); },
      (s) => { const m = s.doc.getMap('comments'); const k = [...m.keys()][0]; if (k) m.delete(k); },
      (s) => { const board = s.doc.getMap('board'); const shape = new Y.Map(); shape.set('x', random(100)); shape.set('points', [1, 2, { a: [1, null, 'x'] }]); board.set(`s${random(30)}`, shape); },
      (s) => { s.doc.getArray('order').insert(0, [random(9), 'x', new Uint8Array([1, 2])]); },
      (s) => { s.doc.getText('plain').insert(0, 'A' + '😀'.repeat(3)); },
      (s) => { if (s === a) undo.undo(); },
      (s) => { if (s === a) undo.redo(); }
    ];
    for (let i = 0; i < 400; i++) {
      const step = steps[random(steps.length)];
      step?.(random(2) ? a : b);
      if (i % 40 === 13) link.drop();
      if (i % 40 === 27) link.back();
      if (i === 200) {
        // A reload, with what's waiting: a new client, the old one's edits still to go.
        link.drop();
        a.close();
        undo.destroy();
        link.back();
        a = await open(link.browser, id, doc, { keep: store.keep });
        undo = new Y.UndoManager(a.doc.getXmlFragment('content'), { captureTimeout: 0 });
      }
      if (i % 10 === 0) await rest(5);
    }
    link.back();
    await saved(a);
    await saved(b);
    undo.destroy();
    await until(() => body(a) === body(b), 'both to agree');
    expect(a.getSnapshot()).toMatchObject({ status: 'saved', refused: null, closed: null });
    expect(b.getSnapshot()).toMatchObject({ status: 'saved', refused: null, closed: null });
    const fresh = await open(bob, id, doc);
    expect(body(fresh)).toBe(body(a));
    expect(fresh.doc.getMap('comments').toJSON()).toEqual(a.doc.getMap('comments').toJSON());
    expect(fresh.doc.getText('plain').toString()).toBe(a.doc.getText('plain').toString());
    expect(store.kept).toEqual([]);
    expect(h.logs.filter((l) => l.includes('update refused') && l.includes(doc))).toEqual([]);
  });

  it('takes an update again without harm, whole or in part, and keeps it once', async () => {
    const { ann, id, doc } = await together();
    const src = new Y.Doc();
    Y.applyUpdate(src, DOC_SEED);
    const before = Y.encodeStateVector(src);
    line({ doc: src }).insert(0, 'Hello');
    const first = Y.encodeStateAsUpdate(src, before);
    line({ doc: src }).insert(5, ' there');
    const both = Y.encodeStateAsUpdate(src, before);
    expect((await sendUpdate(ann, id, doc, first)).status).toBe(200);
    expect((await sendUpdate(ann, id, doc, first)).status).toBe(200);
    expect((await sendUpdate(ann, id, doc, both)).status).toBe(200);
    expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc])).toBe(2);
    expect(body(await open(ann, id, doc))).toContain('Hello there');
  });
});

describe('a document that’s too much', () => {
  it('stops at a number of items, not only bytes, says so, and lets someone delete their way back', async () => {
    const { ann, id, doc } = await together();
    const second = await h.secondServer({ DOC_ITEMS_MAX: 2000 });
    try {
      // Each in front of the last, so nothing merges: 7 bytes of update, and an item in memory.
      const unmerged = (client: number, n: number) => block(client, 0, [item({ root: 'many' }), ...Array.from({ length: n - 1 }, (_, i) => item({ right: [client, i] }))]);
      // A list holding as many: Yjs only lets go of them all once what holds them goes. Deleted one by one, they'd stay as tombstones.
      const src = new Y.Doc();
      const list = new Y.Array<number>();
      src.getMap('many').set('list', list);
      src.transact(() => { for (let i = 0; i < 1500; i++) list.insert(0, [i]); });
      expect((await sendUpdate(ann, id, doc, Y.encodeStateAsUpdate(src), second.baseUrl)).status).toBe(200);
      const refused = await sendUpdate(ann, id, doc, unmerged(2222, 1000), second.baseUrl);
      expect(refused.status).toBe(413);
      expect(await refused.json()).toMatchObject({ code: 'too-large', message: 'This document is too long to add to. Delete something from it first.' });
      // A browser says so.
      const fast = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
      const s = await fast.workspaces.document(id, doc);
      await s.ready;
      expect((await sendUpdate(ann, id, doc, unmerged(3333, 600), second.baseUrl)).status).toBe(413);
      // Taking it out goes through, compacts, and there's room again.
      s.doc.getMap('many').delete('list');
      await until(() => s.getSnapshot().status === 'saved', 'the delete to land');
      await until(async () => (await sendUpdate(ann, id, doc, unmerged(4444, 1500), second.baseUrl)).status === 200, 'room again');
      s.close();
    } finally {
      await second.close();
    }
  });

  it('counts what’s there, not what was typed: a long honest document doesn’t reach it key by key', async () => {
    const { ann, id, doc } = await together();
    const second = await h.secondServer({ DOC_ITEMS_MAX: 300 });
    try {
      const s = await (await createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.document(id, doc));
      await s.ready;
      // Far more keys than the limit, one update each: they merge into a few items at each compaction.
      for (let i = 0; i < 700; i++) { line(s).insert(line(s).length, 'k'); if (i % 3 === 0) await rest(155); if (i % 100 === 99) await until(() => s.getSnapshot().status === 'saved', 'it to save'); }
      await until(() => s.getSnapshot().status === 'saved', 'it to save');
      expect(s.getSnapshot().refused).toBeNull();
      s.close();
    } finally {
      await second.close();
    }
  });

  it('fails one document, never the API, when it takes more memory to open than a worker has, even after a restart', async () => {
    const { ann, id, doc } = await together();
    const other = await make(ann, id, 'document', 'Other');
    const o = await open(ann, id, other);
    line(o).insert(0, 'Unaffected');
    await saved(o);
    const unmerged = (client: number, n: number) => block(client, 0, [item({ root: 'many' }), ...Array.from({ length: n - 1 }, (_, i) => item({ right: [client, i] }))]);
    // As much as a page can hold, in pieces that never merge.
    for (let i = 0; i < 3; i++) expect((await sendUpdate(ann, id, doc, unmerged(5000 + i, 49_000))).status).toBe(200);
    const small = { DOC_HEAP_MB: 32 };
    const second = await h.secondServer(small);
    try {
      const api = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
      const s = await api.workspaces.document(id, doc);
      await expect(s.ready).rejects.toBeTruthy();
      await until(() => s.getSnapshot().closed === 'unavailable', 'the document to say it’s unavailable');
      expect(h.logs.some((l) => l.includes('document unavailable') && l.includes(doc))).toBe(true);
      expect(await bystander(ann, second.baseUrl)).toBe(200);
      const fine = await api.workspaces.document(id, other);
      await fine.ready;
      expect(body(fine)).toContain('Unaffected');
      fine.close();
    } finally {
      await second.close();
    }
    // After a restart it's still marked, so one open can't take the next instance's time either.
    const again = await h.secondServer(small);
    try {
      const refused = await ann.fetch(`${again.baseUrl}/v1${docPath(id, doc)}/live?after=0`);
      expect(await refused.text()).toContain('"why":"unavailable"');
      expect(await bystander(ann, again.baseUrl)).toBe(200);
    } finally {
      await again.close();
    }
    // Versions and the rest of the workspace don't depend on it.
    expect(await ann.api.workspaces.versions(id, doc)).toEqual([]);
    await h.pool.query('UPDATE documents SET closed_until = NULL WHERE document_id = $1', [doc]);
    await ann.api.workspaces.items.trash(id, doc);
  });

  it('fails one document when it takes too long to open, and everyone else carries on meanwhile', async () => {
    const { ann, mal, id, doc } = await together();
    const other = await make(ann, id, 'document', 'Other');
    for (let i = 0; i < 12; i++) expect((await sendUpdate(mal, id, doc, conflictingAfter(9000 + i * 2, 900, i > 0 ? 9000 : null))).status).toBe(200);
    const second = await h.secondServer({ DOC_WORK_MS: 250 });
    try {
      const api = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
      const s = await api.workspaces.document(id, doc);
      const heard: number[] = [];
      const watch = (async () => { while (s.getSnapshot().closed === null) { const t0 = performance.now(); await bystander(ann, second.baseUrl); heard.push(performance.now() - t0); await rest(10); } })();
      await until(() => s.getSnapshot().closed === 'unavailable', 'the document to say it’s unavailable');
      await watch;
      expect(heard.length).toBeGreaterThan(3);
      const fine = await api.workspaces.document(id, other);
      await fine.ready;
      fine.close();
    } finally {
      await second.close();
    }
    await h.pool.query('UPDATE documents SET closed_until = NULL WHERE document_id = $1', [doc]);
  });

  it('skips one row that won’t apply, logs it, and carries on serving', async () => {
    const { ann, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Before it. ');
    await saved(a);
    await slipIn(id, doc, 2, block(777, 0, [gc(0)]));
    await slipIn(id, doc, 3, block(778, 0, [item({ origin: [778, 5] })]));
    await h.pool.query('UPDATE documents SET next_seq = 4, updates_since_snapshot = updates_since_snapshot + 2 WHERE document_id = $1', [doc]);
    const fresh = await open(ann, id, doc);
    expect(body(fresh)).toContain('Before it.');
    expect(h.logs.some((l) => l.includes('document row skipped') && l.includes(doc))).toBe(true);
    line(fresh).insert(0, 'After it. ');
    await saved(fresh);
    await typing(ann, id, doc, 205);
    await until(() => compacted(doc), 'a compaction');
    expect(body(await open(ann, id, doc))).toContain('After it.');
  });

  it('won’t fold a row it can’t read, so a bad key can’t empty a document', async () => {
    const { ann, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Keep me. ');
    await saved(a);
    await typing(ann, id, doc, 3);
    await h.pool.query("UPDATE document_updates SET update_ciphertext = 'not a record' WHERE document_id = $1 AND seq = 2", [doc]);
    await typing(ann, id, doc, 205);
    await until(() => h.logs.some((l) => l.includes('document not folded') && l.includes(doc)), 'the compaction to give up');
    expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1 AND seq = 2', [doc])).toBe(1);
    expect(body(await open(ann, id, doc))).toContain('Keep me.');
  });

  it('can still go back to a version when what it says now won’t open', async () => {
    const { ann, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Worth keeping. ');
    await saved(a);
    await backdate(doc);
    line(a).insert(0, 'And this. ');
    await saved(a);
    await until(async () => (await ann.api.workspaces.versions(id, doc)).length === 1, 'a version');
    const [version] = await ann.api.workspaces.versions(id, doc);
    a.close();
    await h.pool.query("UPDATE document_snapshots SET snapshot_ciphertext = 'not a record' WHERE document_id = $1", [doc]);
    await h.pool.query('DELETE FROM document_updates WHERE document_id = $1', [doc]);
    const held = await ann.api.workspaces.document(id, doc);
    const s = await held;
    await expect(s.ready).rejects.toBeTruthy();
    await until(() => s.getSnapshot().closed !== null, 'it to say so');
    // History still reads, and restoring brings it back for everyone.
    expect((await ann.api.workspaces.version(id, doc, version?.id ?? '')).id).toBe(version?.id);
    await ann.api.workspaces.restoreVersion(id, doc, version?.id ?? '');
    const fresh = await open(ann, id, doc);
    expect(body(fresh)).toContain('Worth keeping.');
    line(fresh).insert(0, 'Carrying on. ');
    await saved(fresh);
    expect(body(await open(ann, id, doc))).toContain('Carrying on.');
  });
});

describe('a full document', () => {
  /** A map entry, written by hand: `key` on the type at `parent`, or over what's at `origin`. */
  const attribute = (o: { parent?: Id; origin?: Id; key: string; value: string }): Struct => (e) => {
    encoding.writeUint8(e, 8 | 0x20 | (o.origin ? 0x80 : 0));
    if (o.origin) { encoding.writeVarUint(e, o.origin[0]); encoding.writeVarUint(e, o.origin[1]); }
    else { encoding.writeVarUint(e, 0); encoding.writeVarUint(e, o.parent?.[0] ?? 0); encoding.writeVarUint(e, o.parent?.[1] ?? 0); encoding.writeVarString(e, o.key); }
    encoding.writeVarUint(e, 1);
    encoding.writeAny(e, o.value);
  };
  /** A document with words in two blocks, on an instance where that's as much as a document can hold. */
  async function filled(max = 8, more = 0) {
    const { ann, bob, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Words in a line');
    addBlock(a, 'line', 'second', { kind: 'todo' }).insert(0, [new Y.XmlText('Second block')]);
    for (let i = 0; i < more; i++) addBlock(a, 'line', `more${i}`).insert(0, [new Y.XmlText(`More ${i}`)]);
    await saved(a);
    a.close();
    const second = await h.secondServer({ DOC_ITEMS_MAX: max });
    const api = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
    const s = await api.workspaces.document(id, doc);
    await s.ready;
    return { ann, bob, id, doc, s, second };
  }
  /** How a block leaves a page: what's in it goes, and it says so in its attributes. */
  function retire(s: DocSession, id: string) {
    s.doc.transact(() => {
      const el = s.doc.getXmlFragment('content').toArray().find((e) => e instanceof Y.XmlElement && e.getAttribute('id') === id);
      if (!(el instanceof Y.XmlElement)) throw new Error(`no block ${id}`);
      const words = el.get(0);
      if (words instanceof Y.XmlText) words.delete(0, words.length);
      el.setAttribute('id', `${id}-gone`);
      el.setAttribute('gone', '');
    });
  }

  it('refuses new words and new blocks, and says so', async () => {
    const { ann, id, doc, s, second } = await filled();
    try {
      expect((await sendUpdate(ann, id, doc, anUpdate('More words'), second.baseUrl)).status).toBe(413);
      line(s).insert(0, 'And more');
      await until(() => s.getSnapshot().refused === 'too-large', 'it to say so');
      expect(s.getSnapshot().status).toBe('failed');
    } finally {
      s.close();
      await second.close();
    }
  });

  it('always lets a block leave the page, which writes attributes as well as deleting', async () => {
    const { ann, bob, id, doc, s, second } = await filled();
    const b = await open(bob, id, doc);
    try {
      retire(s, 'second');
      await until(() => s.getSnapshot().status === 'saved', 'the block to go');
      expect(s.getSnapshot().refused).toBeNull();
      await until(() => !body(b).includes('Second block') && body(b).includes('second-gone'), 'Bob to hear it');
      expect(body(await open(ann, id, doc))).not.toContain('Second block');
    } finally {
      s.close();
      await second.close();
    }
  });

  it('lets two lines join: what lands somewhere else is no more than what left', async () => {
    const { bob, id, doc, s, second } = await filled();
    const b = await open(bob, id, doc);
    try {
      s.doc.transact(() => {
        retire(s, 'second');
        line(s).insert(line(s).length, 'Second block');
      });
      // A move adds an element, so it has to wait for room like anything else that does.
      await until(() => s.getSnapshot().status === 'saved', 'the join to land');
      expect(s.getSnapshot().refused).toBeNull();
      await says(b, 'Words in a lineSecond block');
    } finally {
      s.close();
      await second.close();
    }
  });

  it('doesn’t hold up what comes after a refusal, and what was refused goes once there’s room', async () => {
    const { bob, id, doc, s, second } = await filled(36, 10);
    const b = await open(bob, id, doc);
    try {
      // Too much for this document: it stays here, and says so.
      s.doc.getText('notes').insert(0, 'Refused for now');
      await until(() => s.getSnapshot().refused === 'too-large', 'it to say so');
      // What comes next is someone else as far as the API goes, so it's not behind it.
      retire(s, 'second');
      await until(() => !body(b).includes('Second block'), 'Bob to hear the block go');
      expect(s.getSnapshot().refused).toBe('too-large');
      expect(b.doc.getText('notes').toString()).toBe('');
      // Taking the rest out makes room, and what was waiting goes by itself.
      const fragment = s.doc.getXmlFragment('content');
      fragment.delete(3, fragment.length - 3);
      await until(() => s.getSnapshot().status === 'saved', 'it to go', 40_000);
      await until(() => b.doc.getText('notes').toString() === 'Refused for now', 'Bob to hear it');
    } finally {
      s.close();
      await second.close();
    }
  });

  it('takes only what doesn’t add to a full page: a new attribute waits, one written over goes, and deleting always does', async () => {
    const { ann, id, doc, s, second } = await filled();
    try {
      // Something more on the page, however small.
      expect((await sendUpdate(ann, id, doc, block(8080, 0, [attribute({ parent: [1, 2], key: 'k0', value: 'x' })]), second.baseUrl)).status).toBe(413);
      // The same key written over replaces what's there, which adds nothing.
      const el = s.doc.getXmlFragment('content').toArray().find((e) => e instanceof Y.XmlElement && e.getAttribute('id') === 'second');
      if (!(el instanceof Y.XmlElement)) throw new Error('no block');
      el.setAttribute('kind', 'quote');
      await until(() => s.getSnapshot().status === 'saved', 'it to go');
      line(s).delete(0, 5);
      await until(() => s.getSnapshot().status === 'saved', 'the delete to go');
      expect(s.getSnapshot().refused).toBeNull();
    } finally {
      s.close();
      await second.close();
    }
  });
});

describe('restoring', () => {
  /** A document with one block in it, and a version of that. */
  async function kept() {
    const { ann, bob, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Base words.');
    addBlock(a, 'line', 'second').insert(0, [wordsIn('Second block.')]);
    await saved(a);
    const version = await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    return { ann, bob, id, doc, a, version: version ?? '', was: body(a) };
  }
  const wordsIn = (text: string) => { const t = new Y.XmlText(); t.insert(0, text); return t; };
  /** What's on the page, as the server reads it. */
  const page = (s: { doc: Y.Doc }) => documentText(s.doc, 'document').blocks.map((b) => b.text);

  it('takes away a block added since', async () => {
    const { ann, id, doc, a, version } = await kept();
    addBlock(a, 'line', 'later').insert(0, [wordsIn('Added later, should go on restore.')]);
    await saved(a);
    await ann.api.workspaces.restoreVersion(id, doc, version);
    await until(() => page(a).length === 2, 'the block to go');
    expect(page(await open(ann, id, doc))).toEqual(['Base words.', 'Second block.']);
  });

  it('retires a block added since, never deletes it: words typed in it offline bring it back', async () => {
    const { ann, bob, id, doc, a, version } = await kept();
    addBlock(a, 'line', 'later').insert(0, [wordsIn('Made since the version.')]);
    await saved(a);
    const link = network(bob);
    const b = await open(link.browser, id, doc);
    await says(b, 'Made since the version.');
    link.drop();
    const later = b.doc.getXmlFragment('content').toArray().find((e) => e instanceof Y.XmlElement && e.getAttribute('id') === 'later');
    const words = later instanceof Y.XmlElement ? later.get(0) : null;
    if (!(words instanceof Y.XmlText)) throw new Error('no text in that block');
    words.insert(0, 'Typed on the train. ');
    await ann.api.workspaces.restoreVersion(id, doc, version);
    await until(() => page(a).length === 2, 'the block to go');
    // It's still there, with nothing in it, under a name of its own.
    const element = a.doc.getXmlFragment('content').toArray().at(-1);
    expect(element instanceof Y.XmlElement && element.getAttribute('gone')).toBe('');
    expect(element instanceof Y.XmlElement && element.getAttribute('id')).not.toBe('later');
    link.back();
    await saved(b);
    await until(() => page(a).some((t) => t.includes('Typed on the train.')), 'Bob’s words to come back');
    expect(page(await open(ann, id, doc))).toEqual(['Base words.', 'Second block.', 'Typed on the train. ']);
  });

  it('brings back a whole block deleted since', async () => {
    const { ann, id, doc, a, version, was } = await kept();
    a.doc.getXmlFragment('content').delete(2, 1);
    await saved(a);
    expect(body(a)).not.toContain('Second block.');
    await ann.api.workspaces.restoreVersion(id, doc, version);
    await until(() => body(a) === was, 'the block to come back');
    expect(body(await open(ann, id, doc))).toBe(was);
  });

  it('takes away a comment added since, and brings back one deleted since', async () => {
    const { ann, id, doc, a } = await kept();
    a.doc.getMap('comments').set('kept', 'Was here');
    await saved(a);
    const version = await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    a.doc.getMap('comments').set('added', 'Goes');
    a.doc.getMap('comments').delete('kept');
    await saved(a);
    await ann.api.workspaces.restoreVersion(id, doc, version ?? '');
    await until(() => a.doc.getMap('comments').get('kept') === 'Was here' && !a.doc.getMap('comments').has('added'), 'the comments to go back');
    expect((await open(ann, id, doc)).doc.getMap('comments').toJSON()).toEqual({ kept: 'Was here' });
  });

  it('never erases what was saved while it ran: each word is in the document or in a version', async () => {
    const { ann, bob, id, doc, version } = await kept();
    for (let round = 0; round < 8; round++) {
      const acknowledged: string[] = [];
      let going = true;
      // As fast as Alcove says it has each word, so one is always landing around the restore.
      const typingOn = (async () => {
        for (let i = 0; going; i++) {
          const word = `w${round}x${i}z`;
          const r = await sendUpdate(bob, id, doc, anUpdate(`${word} `));
          if (r.status === 200) acknowledged.push(word);
          else expect(r.status).toBe(503);
        }
      })();
      await rest(20);
      await ann.api.workspaces.restoreVersion(id, doc, version);
      await rest(20);
      going = false;
      await typingOn;
      const fresh = await open(ann, id, doc);
      const seen = [body(fresh)];
      for (const v of await ann.api.workspaces.versions(id, doc)) {
        const past = new Y.Doc();
        Y.applyUpdate(past, (await ann.api.workspaces.version(id, doc, v.id)).update);
        seen.push(past.getXmlFragment('content').toString());
      }
      expect(acknowledged.filter((w) => !seen.some((s) => s.includes(w)))).toEqual([]);
      fresh.close();
    }
  });

  it('leaves someone typing through one saving, not offline, and their words land on what was restored', async () => {
    const { bob, id, doc } = await kept();
    const b = await open(bob, id, doc);
    const said: DocStatus['status'][] = [];
    b.subscribe(() => { said.push(b.getSnapshot().status); });
    const hold = (until: string) => h.pool.query(`UPDATE documents SET held_until = ${until} WHERE document_id = $1`, [doc]);
    await hold(`now() + interval '1 minute'`);
    line(b).insert(0, 'Typed through it. ');
    // Long enough to be turned away more than once.
    await until(() => said.includes('saving'), 'the words to be on their way');
    await rest(1800);
    expect(b.getSnapshot().status).toBe('saving');
    await hold('NULL');
    await saved(b);
    expect(said).not.toContain('offline');
    expect(words(await open(bob, id, doc))).toContain('Typed through it. ');
  });

  it('won’t make a document bigger than it can be, so typing is never refused for it', async () => {
    const { ann, id, doc, a, version } = await kept();
    const second = await h.secondServer({ DOC_ITEMS_MAX: 400 });
    try {
      for (let i = 0; i < 30; i++) addBlock(a, 'line', `n${i}`);
      await saved(a);
      a.doc.getXmlFragment('content').delete(0, a.doc.getXmlFragment('content').length);
      await saved(a);
      const r = await post(ann, `${docPath(id, doc)}/versions/${version}/restore`, {}, second.baseUrl);
      expect(r.status).toBe(200);
      const big = await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
      expect(big).not.toBeNull();
      const tight = await h.secondServer({ DOC_ITEMS_MAX: 3 });
      try {
        const refused = await post(ann, `${docPath(id, doc)}/versions/${version}/restore`, {}, tight.baseUrl);
        expect(refused.status).toBe(413);
      } finally {
        await tight.close();
      }
    } finally {
      await second.close();
    }
  });
});

describe('a big paste', () => {
  it('goes through, however much a real paste is', async () => {
    const { ann, bob, id, doc } = await together();
    const [a, b] = await Promise.all([open(ann, id, doc), open(bob, id, doc)]);
    line(a).insert(0, 'x'.repeat(1_200_000));
    await saved(a);
    await until(() => words(b).length >= 1_200_000, 'Bob to hear it');
    expect(a.getSnapshot().refused).toBeNull();
  });

  it('stops what’s too big and not what comes after it: undo it and everything goes, even after a reload', async () => {
    const { ann, bob, id, doc } = await together();
    const store = keepStore();
    const [a, b] = await Promise.all([open(ann, id, doc, { keep: store.keep }), open(bob, id, doc)]);
    line(a).insert(0, 'Before the paste. ');
    await saved(a);
    const undo = new Y.UndoManager(a.doc.getXmlFragment('content'), { captureTimeout: 0 });
    line(a).insert(0, 'x'.repeat(MAX_DOC_UPDATE_BYTES + 100_000));
    await until(() => a.getSnapshot().status === 'failed', 'the save to fail');
    expect(a.getSnapshot().refused).toBe('too-large');
    undo.undo();
    line(a).insert(0, 'After the paste. ');
    await saved(a);
    await says(b, 'After the paste.');
    expect(a.getSnapshot().refused).toBeNull();
    undo.destroy();
    expect(store.kept).toEqual([]);
  });

  it('holds on through a reload, and lets go once what’s too big is taken out', async () => {
    const { ann, bob, id, doc } = await together();
    const store = keepStore();
    const a = await open(ann, id, doc, { keep: store.keep });
    const b = await open(bob, id, doc);
    line(a).insert(0, 'Before the paste. ');
    await saved(a);
    line(a).insert(0, 'x'.repeat(MAX_DOC_UPDATE_BYTES + 100_000));
    await until(() => a.getSnapshot().status === 'failed', 'the save to fail');
    line(a).insert(0, 'Typed after it. ');
    await rest(200);
    a.close();
    await until(() => store.kept.length >= 2, 'both to be kept');
    const back = await open(ann, id, doc, { keep: store.keep });
    await until(() => back.getSnapshot().status === 'failed', 'it to say so again');
    expect(back.getSnapshot().refused).toBe('too-large');
    expect(body(back)).toContain('Typed after it.');
    const big = line(back);
    const at = big.toString().indexOf('xxx');
    big.delete(at, MAX_DOC_UPDATE_BYTES + 100_000);
    await saved(back);
    await says(b, 'Typed after it.');
    expect(store.kept).toEqual([]);
  });
});

describe('a version on its way out', () => {
  /** Three megabytes of words, more than sits in a socket's buffers. */
  const bigWords = async (s: DocSession) => { for (let i = 0; i < 4; i++) { line(s).insert(0, 'y'.repeat(750_000)); await saved(s); } };
  it('comes in parts, so a slow reader holds a little, and nobody can hold many', async () => {
    const { ann, bob, id, doc } = await together();
    const a = await open(ann, id, doc);
    await bigWords(a);
    const version = await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    const path = `${h.baseUrl}/v1${docPath(id, doc)}/versions/${version ?? ''}`;
    const whole = await ann.api.workspaces.version(id, doc, version ?? '');
    const past = new Y.Doc();
    Y.applyUpdate(past, whole.update);
    expect(line({ doc: past }).length).toBe(3_000_000);
    const second = await h.secondServer({ DOC_VERSION_READS: 2 });
    try {
      const at = path.replace(h.baseUrl, second.baseUrl);
      const stops = [new AbortController(), new AbortController()];
      // Nobody's reading these, and they hold their places.
      const unread = await Promise.all(stops.map((s, i) => (i ? bob : ann).fetch(at, { signal: s.signal })));
      expect(unread.map((r) => r.status)).toEqual([200, 200]);
      const third = await ann.fetch(at);
      expect(third.status).toBe(503);
      for (const s of stops) s.abort();
      await until(async () => { const r = await ann.fetch(at); const ok = r.status === 200; await r.body?.cancel(); return ok; }, 'a place to come free');
    } finally {
      await second.close();
    }
    // Each person is limited too.
    const limit = await h.secondServer();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 80; i++) { const r = await ann.fetch(path.replace(h.baseUrl, limit.baseUrl)); statuses.push(r.status); await r.body?.cancel(); }
      expect(statuses.filter((s) => s === 503).length).toBeGreaterThan(0);
    } finally {
      await limit.close();
    }
  });

  it('lets go of someone who stopped reading', async () => {
    const { ann, id, doc } = await together();
    const a = await open(ann, id, doc);
    await bigWords(a);
    const version = await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    const second = await h.secondServer({ DOC_VERSION_READS: 1, LIVE_PING_MS: 150 });
    try {
      const at = `${second.baseUrl}/v1${docPath(id, doc)}/versions/${version ?? ''}`;
      const stuck = await ann.fetch(at);
      expect(stuck.status).toBe(200);
      await until(async () => { const r = await ann.fetch(at); const ok = r.status === 200; await r.body?.cancel(); return ok; }, 'the place to come free');
    } finally {
      await second.close();
    }
  });

  it('answers 404 for a version ID that means nothing', async () => {
    const { ann, id, doc } = await together();
    expect((await ann.fetch(`${h.baseUrl}/v1${docPath(id, doc)}/versions/%00`)).status).toBe(404);
    expect((await post(ann, `${docPath(id, doc)}/versions/%00/restore`, {})).status).toBe(404);
  });
});

describe('streams, read closely', () => {
  it('stop at 8 of a document for one person, and at a limit for one address, however many accounts it has', async () => {
    const { ann, id, doc } = await together();
    const second = await h.secondServer();
    const open8 = Array.from({ length: 8 }, () => stream(second.baseUrl, ann.fetch, id, doc));
    try {
      await until(() => open8.every((s) => s.lines.length > 0), 'eight streams');
      expect((await ann.fetch(`${second.baseUrl}/v1${docPath(id, doc)}/live?after=0`)).status).toBe(503);
    } finally {
      for (const s of open8) s.stop();
      await second.close();
    }
    const third = await h.secondServer({ LIVE_STREAMS_PER_ADDRESS: 16 });
    const held: ReturnType<typeof stream>[] = [];
    try {
      const shared: typeof fetch[] = [];
      for (let i = 0; i < 3; i++) {
        const who = await account();
        await ann.api.workspaces.addPerson(id, who.email, 'edit');
        shared.push((input, init) => who.fetch(input, { ...init, headers: { ...init?.headers, 'x-forwarded-for': '10.9.9.9' } }));
      }
      for (const f of shared) for (let i = 0; i < 8 && held.length < 16; i++) held.push(stream(third.baseUrl, f, id, doc));
      await until(() => held.every((s) => s.lines.length > 0), 'sixteen streams');
      const last = shared.at(-1);
      expect(last && (await last(`${third.baseUrl}/v1${docPath(id, doc)}/live?after=0`)).status).toBe(503);
      // Someone elsewhere isn't held up by it.
      const elsewhere = stream(third.baseUrl, ann.fetch, id, doc);
      await until(() => elsewhere.lines.length > 0, 'Ann’s stream');
      elsewhere.stop();
    } finally {
      for (const s of held) s.stop();
      await third.close();
    }
  });

  it('can’t freeze showing saved: a compaction landing mid-read leaves nothing unread', async () => {
    const { ann, bob, id, doc } = await together();
    const own = new pg.Pool({ connectionString: process.env['TEST_DATABASE_URL'] });
    const original = own.query.bind(own);
    let gate: Promise<void> | null = null;
    let openGate: () => void = () => undefined;
    // The room's read of how far the snapshot reaches waits, as behind other requests for a connection.
    Object.defineProperty(own, 'query', { value: async (...args: unknown[]) => { const sql = args[0]; if (gate && typeof sql === 'string' && sql.startsWith('SELECT through_seq FROM document_snapshots')) await gate; return Reflect.apply(original, own, args); } });
    const second = await h.secondServer({}, undefined, own);
    try {
      const b = await createHttpApi({ baseUrl: second.baseUrl, fetch: bob.fetch }).workspaces.document(id, doc);
      await b.ready;
      gate = new Promise<void>((go) => { openGate = () => { gate = null; go(); }; });
      await typing(ann, id, doc, 205, 'm');
      await until(() => compacted(doc), 'a compaction');
      await typing(ann, id, doc, 1, 'LAST');
      openGate();
      await says(b, 'LAST0');
      expect(body(b)).toContain('m100');
      b.close();
    } finally {
      await second.close();
      await own.end();
    }
  });

  it('don’t open the tree for carets, for saying where someone is, or for updates while it hasn’t moved', async () => {
    const { ann, id, doc } = await together();
    const a = await open(ann, id, doc);
    const here = { connection: madeUp(), document: doc, block: null, typing: true, page: null };
    line(a).insert(0, 'First');
    await saved(a);
    expect((await post(ann, `/workspaces/${id}/presence`, here)).status).toBe(200);
    await rest(100);
    const from = h.logs.length;
    for (let i = 0; i < 5; i++) {
      a.awareness.setLocalStateField('cursor', { at: i });
      line(a).insert(0, 'k');
      expect((await post(ann, `/workspaces/${id}/presence`, here)).status).toBe(200);
      await saved(a);
      await rest(120);
    }
    const reads = h.logs.slice(from).filter((l) => l.includes('state_ciphertext'));
    expect(reads).toEqual([]);
    // And it notices when it has: taking Ann's edit away takes effect at once.
    const rita = await account();
    await ann.api.workspaces.addPerson(id, rita.email, 'edit');
    expect((await sendUpdate(rita, id, doc, anUpdate('Mine'))).status).toBe(200);
    const person = (await ann.api.workspaces.people(id)).find((p) => p.person.email === rita.email)?.id ?? '';
    await ann.api.workspaces.setRole(id, person, 'read');
    expect((await sendUpdate(rita, id, doc, anUpdate('Mine again'))).status).toBe(403);
  });

  it('refuse a caret from anyone who hasn’t the document open here', async () => {
    const { ann, id, doc } = await together();
    const scratch = new Y.Doc();
    const caret = new Awareness(scratch);
    const r = await post(ann, `${docPath(id, doc)}/awareness`, { update: toBase64Url(encodeAwarenessUpdate(caret, [scratch.clientID])) });
    caret.destroy();
    expect(r.status).toBe(404);
  });

  it('search stops as soon as access ends', async () => {
    const { ann, bob, id } = await together();
    for (let i = 0; i < 40; i++) { const d = await make(ann, id, 'document', `Doc ${i}`); await sendUpdate(ann, id, d, anUpdate(`Words ${i}`)); }
    const person = (await ann.api.workspaces.people(id)).find((p) => p.person.email === bob.email)?.id ?? '';
    const lines: string[] = [];
    for await (const d of bob.api.workspaces.searchText(id)) {
      lines.push(d.id);
      if (lines.length === 1) await ann.api.workspaces.removePerson(id, person);
    }
    expect(lines.length).toBeLessThan(10);
  });

  it('never gives away an address through a face', async () => {
    const ann = await account();
    const guest = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    await ann.api.workspaces.share.set(id, doc, [{ email: guest.email }], 'read');
    const mine = ann.api.workspaces.live(id);
    mine.present({ document: doc, block: null, typing: false, page: null });
    const theirs = guest.api.workspaces.live(id);
    theirs.present({ document: doc, block: null, typing: false, page: null });
    await until(() => theirs.getSnapshot().here.some((e) => !e.isMe), 'the guest to see Ann');
    const seen = theirs.getSnapshot().here.find((e) => !e.isMe);
    expect(seen?.person.email).toBe('');
    expect(seen?.person.portrait).not.toEqual(personOf(ann.email, ann.name).portrait);
  });

  it('gives a document from before they had a start one when it’s first opened', async () => {
    const { ann, bob, id, doc } = await together();
    await h.pool.query('DELETE FROM document_snapshots WHERE document_id = $1', [doc]);
    await h.pool.query('DELETE FROM document_clients WHERE document_id = $1', [doc]);
    await h.pool.query('UPDATE documents SET snapshot_bytes = 0, snapshot_items = 0 WHERE document_id = $1', [doc]);
    const b = await open(bob, id, doc);
    expect(body(b)).toBe('<title></title><line id="first"></line>');
    line(b).insert(0, 'Typing straight in');
    await saved(b);
    expect(body(await open(ann, id, doc))).toContain('Typing straight in');
  });
});

/* ---------- what a refusal must never do ---------- */

/** Signs in through the stand-in Google, which is how an account comes to have a new address. */
async function withGoogle(email: string, sub: string): Promise<Account> {
  const b = h.browser();
  h.google.next({ sub, email, name: 'Google Person' });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in');
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
const refusals = (doc: string) => h.logs.filter((l) => l.includes('update refused') && l.includes(doc));

/** A document's first state made of plain paragraphs, as the app makes one of the words someone rescued. */
function stateFromText(text: string): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, DOC_SEED);
  const page = doc.getXmlFragment('content');
  doc.transact(() => {
    for (const paragraph of text.split('\n')) {
      const el = new Y.XmlElement('line');
      el.setAttribute('id', newBlockId());
      page.insert(page.length, [el]);
      el.insert(0, [new Y.XmlText(paragraph)]);
    }
  });
  return Y.encodeStateAsUpdate(doc);
}

describe('a refusal', () => {
  /** Words in the first line, as a browser with this client would write them, on top of `on`. */
  function written(client: number, text: string, on: Uint8Array[] = []): Uint8Array {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, DOC_SEED);
    for (const u of on) Y.applyUpdate(doc, u);
    // Last, as Yjs moves a document off a client it hears someone else using.
    doc.clientID = client;
    const before = Y.encodeStateVector(doc);
    const t = line({ doc });
    t.insert(t.length, text);
    return Y.encodeStateAsUpdate(doc, before);
  }
  /** A store holding something Alcove will never take: words carrying on from a client that's someone else's. */
  async function strandedWords() {
    const { ann, bob, mal, id, doc } = await together();
    const mals = block(4242, 0, [item({ root: 'scratch', text: 'Mal’s' })]);
    expect((await sendUpdate(mal, id, doc, mals)).status).toBe(200);
    const store = keepStore();
    const first = written(4242, 'Words only Ann has', [mals]);
    await store.keep.add(first, Date.now());
    return { ann, bob, id, doc, store, first };
  }

  it('never forgets what’s kept, says so, and keeps saying so after a reload', async () => {
    const { ann, id, doc, store } = await strandedWords();
    const a = await ann.api.workspaces.document(id, doc, { keep: store.keep });
    await a.ready;
    await until(() => a.getSnapshot().refused === 'rejected', 'it to say so');
    expect(a.getSnapshot()).toMatchObject({ status: 'failed', refused: 'rejected', unsent: true });
    await rest(1500);
    expect(store.kept).toHaveLength(1);
    a.close();
    await rest(100);
    const again = await ann.api.workspaces.document(id, doc, { keep: store.keep });
    await again.ready;
    await until(() => again.getSnapshot().refused === 'rejected', 'it to say so again');
    expect(store.kept).toHaveLength(1);
    expect(again.getSnapshot().status).toBe('failed');
  });

  it('lets what doesn’t depend on it through, and never reports saved while anything’s held back', async () => {
    const { ann, bob, id, doc, store } = await strandedWords();
    const a = await ann.api.workspaces.document(id, doc, { keep: store.keep });
    await a.ready;
    const b = await open(bob, id, doc);
    await until(() => a.getSnapshot().refused === 'rejected', 'it to say so');
    addBlock(a, 'line', 'later').insert(0, [new Y.XmlText('Typed afterwards. ')]);
    await says(b, 'Typed afterwards.');
    await rest(300);
    expect(a.getSnapshot()).toMatchObject({ status: 'failed', refused: 'rejected', unsent: true });
    expect(store.kept.length).toBeGreaterThanOrEqual(1);
  });

  it('doesn’t drop what’s built on what was refused, in the tab or after a reload', async () => {
    const { ann, id, doc, store, first } = await strandedWords();
    await store.keep.add(written(5151, ' and more', [block(4242, 0, [item({ root: 'scratch', text: 'Mal’s' })]), first]), Date.now());
    const a = await ann.api.workspaces.document(id, doc, { keep: store.keep });
    await a.ready;
    await until(() => a.getSnapshot().refused === 'rejected', 'it to say so');
    expect(store.kept).toHaveLength(2);
    a.close();
    await rest(100);
    const again = await ann.api.workspaces.document(id, doc, { keep: store.keep });
    await again.ready;
    await until(() => again.getSnapshot().status === 'failed', 'it to say so again');
    expect(store.kept).toHaveLength(2);
    expect(again.unsentCopy().text).toContain('Words only Ann has and more');
  });

  it('gets out even what has nowhere to go: words built on something that’s gone from this browser', async () => {
    const { ann, id, doc } = await together();
    const store = keepStore();
    // What they were built on was let go of, as a store from before this could have done.
    await store.keep.add(written(5151, 'Words on nothing', [written(4242, 'Something gone')]), Date.now());
    const a = await open(ann, id, doc, { keep: store.keep });
    await until(() => a.getSnapshot().refused === 'rejected', 'it to say so');
    await rest(1200);
    expect(store.kept).toHaveLength(1);
    expect(a.getSnapshot()).toMatchObject({ status: 'failed', unsent: true });
    const copy = a.unsentCopy();
    expect(copy.text).toContain('Words on nothing');
    const made = await ann.api.workspaces.saveCopy(id, { kind: 'document', name: 'Rescued', parent: null, state: stateFromText(copy.text) });
    expect(body(await open(ann, id, made.id))).toContain('Words on nothing');
  });

  it('leaves a way to get the words out: their text, a copy to make a new document from, and a choice to let go', async () => {
    const { ann, id, doc, store } = await strandedWords();
    const a = await ann.api.workspaces.document(id, doc, { keep: store.keep });
    await a.ready;
    await until(() => a.getSnapshot().refused === 'rejected', 'it to say so');
    const copy = a.unsentCopy();
    expect(copy.text).toContain('Words only Ann has');
    const made = await ann.api.workspaces.saveCopy(id, { kind: 'document', name: 'What I had', parent: null, state: stateFromText(copy.text) });
    const fresh = await open(ann, id, made.id);
    expect(body(fresh)).toContain('Words only Ann has');
    expect((await ann.api.workspaces.get(id)).items.some((i) => i.id === made.id && i.name === 'What I had')).toBe(true);
    line(fresh).insert(0, 'Carrying on. ');
    await saved(fresh);
    expect(fresh.getSnapshot().refused).toBeNull();
    // Only someone choosing to lets go of anything, and only of what a copy holds.
    expect(store.kept).toHaveLength(1);
    await a.discardUnsaved(copy.token);
    expect(store.kept).toEqual([]);
  });

  it('gives back a line written offline in a document deleted before it came back, in the tab and after a reload', async () => {
    const { ann, bob, id, doc } = await together();
    const store = keepStore();
    const link = network(bob);
    const b = await open(link.browser, id, doc, { keep: store.keep });
    line(b).insert(0, 'Online first.');
    await saved(b);
    link.drop();
    line(b).insert(line(b).length, ' Written offline.');
    await until(() => store.kept.length > 0, 'it to be kept');
    await ann.api.workspaces.items.trash(id, doc);
    await ann.api.workspaces.items.deleteForever(id, doc);
    // In the tab, it's all on the page, with nowhere to go.
    link.back();
    await until(() => b.getSnapshot().closed !== null, 'it to end');
    // Only what didn't go: what went is in the document already.
    expect(b.unsentCopy().text).toBe('Written offline.');
    b.close();
    // After a reload nothing it was written on comes from Alcove, so Yjs has nowhere to put it at all.
    const again = await bob.api.workspaces.document(id, doc, { keep: store.keep });
    await until(() => again.getSnapshot().closed !== null, 'it to end again');
    expect(again.getSnapshot().unsent).toBe(true);
    expect(store.kept.length).toBeGreaterThan(0);
    const copy = again.unsentCopy();
    expect(copy.text).toContain('Written offline.');
    const made = await bob.api.workspaces.saveCopy(id, { kind: 'document', name: 'From the train', parent: null, state: stateFromText(copy.text) });
    const fresh = await open(bob, id, made.id);
    expect(body(fresh)).toContain('Written offline.');
    expect(title(fresh).toString()).toBe('From the train');
    again.close();
  });

  it('rescues only someone’s own words that didn’t go: nobody else’s, nothing that went, and nothing they deleted', async () => {
    const { ann, bob, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Ann’s own words. ');
    await saved(a);
    const link = network(bob);
    const b = await open(link.browser, id, doc);
    await says(b, 'Ann’s own words.');
    line(b).insert(line(b).length, 'Bob went. ');
    await saved(b);
    link.drop();
    // Yjs makes one item of these and what went before them: the copy reads it by the clock.
    line(b).insert(line(b).length, 'Bob on the train, ');
    line(b).insert(line(b).length, 'then thought better of it');
    const t = line(b);
    t.delete(t.toString().indexOf('then thought'), 'then thought better of it'.length);
    addBlock(b, 'line', 'second').insert(0, [new Y.XmlText('A second line.')]);
    expect(b.unsentCopy().text).toBe('Bob on the train,\nA second line.');
  });

  it('lets someone who can only read now let go of what they wrote, so nothing says it couldn’t save', async () => {
    const { ann, bob, id, doc } = await together();
    const store = keepStore();
    const link = network(bob);
    const b = await open(link.browser, id, doc, { keep: store.keep });
    link.drop();
    line(b).insert(0, 'Written before Bob could only read. ');
    await until(() => store.kept.length > 0, 'it to be kept');
    const person = (await ann.api.workspaces.people(id)).find((p) => p.person.email === bob.email)?.id ?? '';
    await ann.api.workspaces.setRole(id, person, 'read');
    link.back();
    await until(() => b.getSnapshot().refused === 'read-only', 'it to say so', 20_000);
    expect(b.getSnapshot()).toMatchObject({ status: 'failed', unsent: true });
    const copy = b.unsentCopy();
    expect(copy.text).toBe('Written before Bob could only read.');
    await b.discardUnsaved(copy.token);
    expect(store.kept).toEqual([]);
    const again = await open(bob, id, doc, { keep: store.keep });
    expect(again.getSnapshot()).toMatchObject({ status: 'saved', refused: null, unsent: false, role: 'read' });
    again.close();
  });

  it('won’t take a copy over a document someone has written to', async () => {
    const { ann, id, doc } = await together();
    await sendUpdate(ann, id, doc, anUpdate('Already here'));
    expect((await ann.fetch(`${h.baseUrl}/v1${docPath(id, doc)}/adopt`, { method: 'POST', headers: { 'content-type': DOC_UPDATE_TYPE }, body: bytesOf(DOC_SEED) })).status).toBe(409);
    expect(body(await open(ann, id, doc))).toContain('Already here');
  });

  it('keeps what’s here if the document is deleted out from under it, until someone says otherwise', async () => {
    const { ann, bob, id, doc } = await together();
    const store = keepStore();
    const link = network(bob);
    const b = await open(link.browser, id, doc, { keep: store.keep });
    link.drop();
    line(b).insert(0, 'Written on the train. ');
    await until(() => store.kept.length > 0, 'it to be kept');
    await ann.api.workspaces.items.trash(id, doc);
    await ann.api.workspaces.items.deleteForever(id, doc);
    link.back();
    await until(() => b.getSnapshot().closed !== null, 'it to end');
    expect(store.kept.length).toBeGreaterThan(0);
    expect(b.getSnapshot().unsent).toBe(true);
    expect(b.unsentCopy().text).toContain('Written on the train.');
  });

  it('tells too much from never: caps are too-large, and only what can’t ever be is invalid', async () => {
    const { ann, id, doc } = await together();
    const second = await h.secondServer({ DOC_ITEMS_MAX: 100 });
    try {
      const many = block(6100, 0, [item({ root: 'many' }), ...Array.from({ length: 400 }, (_, i) => item({ right: [6100, i] }))]);
      const refused = await sendUpdate(ann, id, doc, many, second.baseUrl);
      expect(refused.status).toBe(413);
      expect(await refused.json()).toMatchObject({ code: 'too-large' });
      const shared = structsOf([{ client: 6200, clock: 0, structs: [item({ root: 'a' }), ...Array.from({ length: 1100 }, () => item({ origin: [6200, 0] }))] }]);
      expect((await sendUpdate(ann, id, doc, shared)).status).toBe(413);
      expect((await sendUpdate(ann, id, doc, block(6300, 0, [gc(0)]))).status).toBe(400);
    } finally {
      await second.close();
    }
  });
});

describe('a new address', () => {
  /** Someone signed in with Google, in a workspace with Ann, and a document with a store of what's kept. */
  async function movable() {
    const old = unique('old');
    const fresh = unique('fresh');
    const sub = `sub-${seq++}`;
    const moved = await withGoogle(old, sub);
    const ann = await account();
    const id = await workspace(ann, 'Ours', [[moved, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    return { moved, ann, id, doc, fresh, sub, store: keepStore() };
  }

  it('leaves an open tab as it was', async () => {
    const { moved, ann, id, doc, fresh, sub, store } = await movable();
    const m = await open(moved, id, doc, { keep: store.keep });
    const a = await open(ann, id, doc);
    line(m).insert(0, 'Before the new address. ');
    await saved(m);
    await says(a, 'Before the new address.');
    await withGoogle(fresh, sub);
    line(m).insert(line(m).length, 'Typed in the laptop tab after the move. ');
    await saved(m);
    await says(a, 'Typed in the laptop tab');
    expect(refusals(doc)).toEqual([]);
    expect(store.kept).toEqual([]);
  });

  it('takes what was written offline before it, once back', async () => {
    const { moved, ann, id, doc, fresh, sub, store } = await movable();
    const link = network(moved);
    const m = await open(link.browser, id, doc, { keep: store.keep });
    line(m).insert(0, 'Online first. ');
    await saved(m);
    link.drop();
    line(m).insert(line(m).length, 'Written on the train. ');
    await rest(300);
    await withGoogle(fresh, sub);
    link.back();
    await saved(m);
    expect(body(await open(ann, id, doc))).toContain('Written on the train');
    expect(refusals(doc)).toEqual([]);
  });

  it('takes what was kept through a reload after it', async () => {
    const { moved, ann, id, doc, fresh, sub, store } = await movable();
    const link = network(moved);
    const m = await open(link.browser, id, doc, { keep: store.keep });
    line(m).insert(0, 'Online first. ');
    await saved(m);
    link.drop();
    line(m).insert(line(m).length, 'Written on the train. ');
    await rest(300);
    m.close();
    const after = await withGoogle(fresh, sub);
    const back = await after.api.workspaces.document(id, doc, { keep: store.keep });
    await back.ready;
    await saved(back);
    expect(body(await open(ann, id, doc))).toContain('Written on the train');
    expect(store.kept).toEqual([]);
    expect(refusals(doc)).toEqual([]);
  });

  it('still knows a client that was written before clients went by account, and carries it forward', async () => {
    const { moved, id, doc, fresh, sub } = await movable();
    const client = 7700;
    expect((await sendUpdate(moved, id, doc, block(client, 0, [item({ root: 'scratch' })]))).status).toBe(200);
    // As a row from the release before this has it: a keyed hash of the address, and nothing else.
    const ownerId = await ownerOf(id);
    const owner = await findOwner(h.deps, ownerId, undefined);
    if (!owner) throw new Error('no such workspace');
    const asAddress = mac(stateKey(owner.root, ownerId, `document-clients:${doc}`), Buffer.concat([Buffer.from(`${client}:`), blindIndex(masterKey(h.deps), 'email', moved.email)]));
    await h.pool.query('UPDATE document_clients SET people = $3 WHERE document_id = $1 AND client_id = $2', [doc, client, Buffer.from(asAddress)]);
    expect((await sendUpdate(moved, id, doc, block(client, 1, [item({ root: 'scratch' })]))).status).toBe(200);
    await withGoogle(fresh, sub);
    expect((await sendUpdate(moved, id, doc, block(client, 2, [item({ root: 'scratch' })]))).status).toBe(200);
  });
});

describe('what fits in a document', () => {
  it('takes a paste of any size that fits, in one update', async () => {
    const { ann, bob, id, doc } = await together();
    const [a, b] = await Promise.all([open(ann, id, doc), open(bob, id, doc)]);
    line(a).insert(0, 'x'.repeat(5_000_000));
    await saved(a);
    await until(() => words(b).length >= 5_000_000, 'Bob to hear it');
    expect(a.getSnapshot().refused).toBeNull();
  });

  it('brings a big delete back with undo, whatever it comes to', async () => {
    const { ann, bob, id, doc } = await together();
    const a = await open(ann, id, doc);
    const b = await open(bob, id, doc);
    for (let i = 0; i < 2; i++) {
      const el = addBlock(a, 'line', `long${i}`);
      const t = new Y.XmlText();
      a.doc.transact(() => { el.insert(0, [t]); t.insert(0, `Paragraph ${i} `.repeat(200_000)); });
      await saved(a);
    }
    await until(() => words(b, 'long1').length > 2_000_000, 'Bob to hear it');
    const undo = new Y.UndoManager(a.doc.getXmlFragment('content'), { captureTimeout: 0 });
    a.doc.transact(() => { for (const blockId of ['long0', 'long1']) { const t = line(a, blockId); t.delete(0, t.length); } });
    await saved(a);
    await until(() => words(b, 'long1').length === 0, 'Bob to see it go');
    undo.undo();
    await saved(a);
    await until(() => words(b, 'long1').length > 2_000_000, 'Bob to see it come back');
    undo.destroy();
    expect(a.getSnapshot().refused).toBeNull();
  });

  it('counts what’s on the page, so a full document that’s emptied can be filled again', async () => {
    const { ann, id, doc } = await together();
    const a = await open(ann, id, doc);
    for (let i = 0; i < 12; i++) addBlock(a, 'line', `b${i}`).insert(0, [new Y.XmlText(`Words of ${i}`)]);
    await saved(a);
    // Everything leaves the page, as blocks do: the elements stay, and so does what they cost.
    const elements = a.doc.getXmlFragment('content').toArray().flatMap((e) => (e instanceof Y.XmlElement && e.nodeName === 'line' && e.getAttribute('id') !== 'first' ? [e] : []));
    a.doc.transact(() => { for (const el of elements) retireBlock(el, newBlockId(), ''); });
    await saved(a);
    a.close();
    await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    const held = await count('SELECT snapshot_items::int AS n FROM documents WHERE document_id = $1', [doc]);
    const second = await h.secondServer({ DOC_ITEMS_MAX: Math.ceil(held * 0.75) });
    try {
      const s = await createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.document(id, doc);
      await s.ready;
      expect(shown(s)).not.toContain('Words of');
      line(s).insert(0, 'A page with almost nothing on it has room. '.repeat(20));
      await until(() => s.getSnapshot().status !== 'saving', 'it to be heard');
      await until(() => s.getSnapshot().status === 'saved', 'it to go', 5_000);
      s.close();
    } finally {
      await second.close();
    }
  });

  it('won’t let a rebuilt update’s deletes pass off new content as a move', async () => {
    const { ann, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'x'.repeat(6000));
    await saved(a);
    line(a).delete(0, 6000);
    await saved(a);
    a.close();
    await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    const held = await count('SELECT snapshot_items::int AS n FROM documents WHERE document_id = $1', [doc]);
    const second = await h.secondServer({ DOC_ITEMS_MAX: held + 3000 });
    try {
      // As a browser rebuilds what's stuck: the state from where Alcove has got to, which says all that's ever been deleted.
      const src = new Y.Doc();
      Y.applyUpdate(src, await readDocument(await heldBy(ann, id), doc, 'state', {}));
      const known = Y.encodeStateVector(src);
      const list = src.getArray<number>('more');
      src.transact(() => { for (let i = 0; i < 5000; i++) list.insert(0, [i]); });
      const res = await sendUpdate(ann, id, doc, Y.encodeStateAsUpdate(src, known), second.baseUrl);
      expect(res.status).toBe(413);
    } finally {
      await second.close();
    }
  });

  it('lets a board that’s only been moved around carry on in a duplicate, with everything it says', async () => {
    const { ann, id } = await together();
    const board = await make(ann, id, 'board', 'Wall');
    const a = await open(ann, id, board);
    const objects = a.doc.getMap<Y.Map<unknown>>('objects');
    a.doc.transact(() => {
      for (let i = 0; i < 4; i++) {
        const object = new Y.Map<unknown>();
        object.set('x', 0);
        const words = new Y.Text();
        words.insert(0, `Sticky ${i}`);
        object.set('text', words);
        objects.set(`o${i}`, object);
      }
    });
    await saved(a);
    const second = await h.secondServer({ DOC_ITEMS_MAX: 30 });
    try {
      const s = await createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.document(id, board);
      await s.ready;
      const moved = s.doc.getMap<Y.Map<unknown>>('objects');
      // Each write stays for good, and nothing on the page grows: this ends at what it can hold, not at what's on it.
      for (let round = 1; round <= 60 && s.getSnapshot().refused === null; round++) {
        s.doc.transact(() => { for (const object of moved.values()) object.set('x', round); });
        await until(() => s.getSnapshot().status !== 'saving', 'it to be heard');
      }
      expect(s.getSnapshot()).toMatchObject({ status: 'failed', refused: 'too-large', unsent: true });
      // It opens, and a duplicate of it starts clean, with every object and what it says.
      const { id: twin } = await createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.items.duplicate(id, board);
      const fresh = await createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.document(id, twin);
      await fresh.ready;
      const object = fresh.doc.getMap<Y.Map<unknown>>('objects').get('o0');
      expect(String(object?.get('text'))).toBe('Sticky 0');
      expect(await count('SELECT items FROM document_updates WHERE document_id = $1', [twin])).toBeLessThan(30);
      object?.set('x', 1000);
      await until(() => fresh.getSnapshot().status === 'saved', 'it to go on from there', 5_000);
      fresh.close();
      s.close();
    } finally {
      await second.close();
    }
  });

  it('keeps a copy to what it says, however often its keys were written', async () => {
    const { ann, id } = await together();
    const board = await make(ann, id, 'board', 'Wall');
    const a = await open(ann, id, board);
    const object = new Y.Map<unknown>();
    a.doc.getMap<Y.Map<unknown>>('objects').set('o', object);
    object.set('gone', true);
    object.delete('gone');
    for (let i = 0; i <= 200; i++) { object.set('x', i); object.set('y', i * 2); }
    await saved(a);
    const { id: twin } = await ann.api.workspaces.items.duplicate(id, board);
    const b = await open(ann, id, twin);
    expect(b.doc.getMap<Y.Map<unknown>>('objects').get('o')?.toJSON()).toEqual({ x: 200, y: 400 });
    expect(await count('SELECT sum(items)::int AS n FROM document_updates WHERE document_id = $1', [twin])).toBeLessThan(20);
    // And it's like any other: someone writing to it is heard, however it started.
    b.doc.getMap<Y.Map<unknown>>('objects').get('o')?.set('x', 7);
    await saved(b);
    const c = await open(ann, id, twin);
    expect(c.doc.getMap<Y.Map<unknown>>('objects').get('o')?.toJSON()).toEqual({ x: 7, y: 400 });
  });

  it('says what fits, for an editor to check a paste against', async () => {
    expect(MAX_DOC_UPDATE_BYTES).toBe(MAX_DOC_BYTES);
    expect(MAX_DOC_ITEMS).toBeGreaterThan(0);
    const { ann, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Some words');
    expect(a.size()).toMatchObject({ items: expect.any(Number), bytes: expect.any(Number) });
    expect(a.size().items).toBeGreaterThan(3);
  });
});

describe('after a refusal', () => {
  it('doesn’t become someone new with every batch: typing in a full document, then making room, saves it all', async () => {
    const { ann, bob, id, doc } = await together();
    const a0 = await open(ann, id, doc);
    line(a0).insert(0, 'Words in a line');
    for (let i = 0; i < 10; i++) addBlock(a0, 'line', `more${i}`).insert(0, [new Y.XmlText(`More ${i}`)]);
    await saved(a0);
    a0.close();
    const second = await h.secondServer({ DOC_ITEMS_MAX: 36 });
    try {
      const store = keepStore();
      const s = await createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.document(id, doc, { keep: store.keep });
      await s.ready;
      const clients = new Set<number>();
      for (let i = 0; i < 40; i++) {
        line(s).insert(line(s).length, `w${i} `);
        clients.add(s.doc.clientID);
        await rest(170);
      }
      expect(s.getSnapshot()).toMatchObject({ status: 'failed', refused: 'too-large' });
      expect(clients.size).toBeLessThanOrEqual(5);
      // Making room needs no typing to stop.
      const fragment = s.doc.getXmlFragment('content');
      fragment.delete(3, fragment.length - 3);
      await until(() => s.getSnapshot().status === 'saved', 'it all to go', 40_000);
      expect(store.kept).toEqual([]);
      expect(words(await open(bob, id, doc))).toContain('w39 ');
      s.close();
    } finally {
      await second.close();
    }
  });

  it('tries again when access comes back', async () => {
    const { ann, bob, id, doc } = await together();
    const a0 = await open(ann, id, doc);
    for (let i = 0; i < 10; i++) addBlock(a0, 'line', `more${i}`).insert(0, [new Y.XmlText(`More ${i}`)]);
    await saved(a0);
    const second = await h.secondServer({ DOC_ITEMS_MAX: 36 });
    try {
      const s = await createHttpApi({ baseUrl: second.baseUrl, fetch: bob.fetch }).workspaces.document(id, doc);
      await s.ready;
      s.doc.getText('notes').insert(0, 'Waiting for room');
      await until(() => s.getSnapshot().refused === 'too-large', 'it to say so');
      const person = (await ann.api.workspaces.people(id)).find((p) => p.person.email === bob.email)?.id ?? '';
      await ann.api.workspaces.setRole(id, person, 'read');
      await until(() => s.getSnapshot().role === 'read', 'Bob to only read');
      // Something typed in the moment it took to hear, on nothing that's stuck: its try comes and goes while he can't write.
      s.doc.getText('elsewhere').insert(0, 'One more. ');
      await rest(1400);
      // Room is made meanwhile, and he gets it back, with nothing more typed.
      const fragment = a0.doc.getXmlFragment('content');
      fragment.delete(2, fragment.length - 2);
      await saved(a0);
      await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
      await ann.api.workspaces.setRole(id, person, 'edit');
      await until(() => s.getSnapshot().status === 'saved', 'it to go', 6_000);
      await until(() => a0.doc.getText('notes').toString().includes('Waiting for room'), 'Ann to hear it');
      s.close();
    } finally {
      await second.close();
    }
  });

  it('takes what overlaps what the log has, with something built on a later part of it', async () => {
    const { ann, id, doc } = await together();
    const x = new Y.Doc();
    Y.applyUpdate(x, DOC_SEED);
    const updates: Uint8Array[] = [];
    x.on('update', (u: Uint8Array) => updates.push(u));
    line({ doc: x }).insert(0, 'abc ');
    line({ doc: x }).insert(4, 'def ');
    for (const u of updates) expect((await sendUpdate(ann, id, doc, u)).status).toBe(200);
    const first = updates[1];
    if (!first) throw new Error('no update');
    const y = new Y.Doc();
    Y.applyUpdate(y, Y.encodeStateAsUpdate(x));
    const known = Y.encodeStateVector(y);
    line({ doc: y }).insert(8, 'jkl ');
    expect((await sendUpdate(ann, id, doc, Y.mergeUpdates([first, Y.encodeStateAsUpdate(y, known)]))).status).toBe(200);
    expect(refusals(doc)).toEqual([]);
    // What's past the block and not in the log is still refused.
    expect((await sendUpdate(ann, id, doc, block(9100, 0, [item({ root: 'a' }), item({ origin: [9100, 40] })]))).status).toBe(400);
  });

  it('takes what one tab kept and another built on, from one store', async () => {
    const { ann, bob, id, doc } = await together();
    const store = keepStore();
    const link = network(ann);
    let blocking = false;
    const blocked: typeof fetch = async (input, init) => {
      if (blocking && String(input).endsWith('/updates')) return new Response(JSON.stringify({ code: 'unavailable', message: 'busy' }), { status: 503, headers: { 'content-type': 'application/json' } });
      return ann.fetch(input, init);
    };
    const t1 = await open(link.browser, id, doc, { keep: store.keep });
    const b = await open(bob, id, doc);
    line(t1).insert(0, 'One. ');
    await saved(t1);
    link.drop();
    line(t1).insert(line(t1).length, 'Kept in the first tab. ');
    await rest(300);
    blocking = true;
    const t2 = await open(h.browser({ fetch: blocked }), id, doc, { keep: store.keep });
    await rest(200);
    link.back();
    await saved(t1);
    line(t1).insert(line(t1).length, 'More from the first tab. ');
    await saved(t1);
    await until(() => words(t2).includes('More from the first tab.'), 'the second tab to hear it');
    const t = line(t2);
    t.insert(t.length, 'Typed in the second tab, on top. ');
    await rest(300);
    blocking = false;
    await until(() => t2.getSnapshot().status === 'saved', 'the second tab to save', 20_000);
    await says(b, 'Typed in the second tab');
    expect(refusals(doc)).toEqual([]);
  });
});

describe('workers, shared fairly', () => {
  const hostile = (updates: number, n = 900) => Array.from({ length: updates }, (_, i) => conflictingAfter(9000 + i * 2, n, i > 0 ? 9000 : null));
  const timedOpen = async (who: Account, base: string, id: string, doc: string) => {
    const t0 = performance.now();
    const s = await createHttpApi({ baseUrl: base, fetch: who.fetch }).workspaces.document(id, doc);
    await s.ready;
    const ms = performance.now() - t0;
    s.close();
    return ms;
  };

  it('don’t let one person’s searches hold up someone else opening a document', async () => {
    const mal = await account();
    const ann = await account();
    const spaceM = await workspace(mal, 'Mine');
    for (let k = 0; k < 2; k++) {
      const d = await make(mal, spaceM, 'document', `Slow ${k}`);
      for (const u of hostile(3, 300)) expect((await sendUpdate(mal, spaceM, d, u)).status).toBe(200);
    }
    const spaceA = await workspace(ann, 'Ours');
    const docA = await make(ann, spaceA, 'document', 'Plan');
    const second = await h.secondServer({ DOC_WORKERS: 1 });
    try {
      await timedOpen(ann, second.baseUrl, spaceA, docA);
      const t0 = performance.now();
      const searches = Promise.all(Array.from({ length: 12 }, () => mal.fetch(`${second.baseUrl}/v1/workspaces/${spaceM}/search`).then((r) => r.text())));
      await rest(150);
      const waited = await timedOpen(ann, second.baseUrl, spaceA, docA);
      await searches;
      const all = performance.now() - t0;
      // First in line behind one job of the 24, not behind one of each search's.
      expect(waited).toBeLessThan(all / 5);
    } finally {
      await second.close();
    }
  });

  it('limit how much of one person’s work can wait', async () => {
    const mal = await account();
    const space = await workspace(mal, 'Mine');
    const doc = await make(mal, space, 'document', 'Slow');
    for (const u of hostile(5)) expect((await sendUpdate(mal, space, doc, u)).status).toBe(200);
    const second = await h.secondServer({ DOC_WORKERS: 1, DOC_WAITING_PER_PERSON: 2 });
    try {
      const statuses = await Promise.all(Array.from({ length: 8 }, () => mal.fetch(`${second.baseUrl}/v1${docPath(space, doc)}/live?after=0`).then((r) => { void r.body?.cancel(); return r.status; })));
      expect(statuses).toContain(503);
      expect(statuses).toContain(200);
    } finally {
      await second.close();
    }
  });

  it('wait for a copy, and don’t leave one blank because they were busy', async () => {
    const ann = await account();
    const space = await workspace(ann, 'Ours');
    const slow = await make(ann, space, 'document', 'Slow');
    for (const u of hostile(5)) expect((await sendUpdate(ann, space, slow, u)).status).toBe(200);
    const doc = await make(ann, space, 'document', 'Plan');
    const a = await open(ann, space, doc);
    line(a).insert(0, 'What the copy has to say');
    await saved(a);
    const second = await h.secondServer({ DOC_WORKERS: 1, DOC_WAITING_PER_PERSON: 1 });
    try {
      const busy = Array.from({ length: 3 }, () => ann.fetch(`${second.baseUrl}/v1${docPath(space, slow)}/live?after=0`).then((r) => { void r.body?.cancel(); }));
      await rest(100);
      const { id: twin } = await createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch }).workspaces.items.duplicate(space, doc);
      await Promise.all(busy);
      expect(body(await open(ann, space, twin))).toContain('What the copy has to say');
    } finally {
      await second.close();
    }
  });

  it('close a document that’s too slow to read for search, as for opening it, and skip it after', async () => {
    const mal = await account();
    const space = await workspace(mal, 'Mine');
    const doc = await make(mal, space, 'document', 'Slow');
    for (const u of hostile(12)) expect((await sendUpdate(mal, space, doc, u)).status).toBe(200);
    const second = await h.secondServer({ DOC_WORK_MS: 200 });
    try {
      const search = async () => { const r = await mal.fetch(`${second.baseUrl}/v1/workspaces/${space}/search`); return r.text(); };
      await search();
      expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1 AND closed_until > now()', [doc])).toBe(1);
      const t0 = performance.now();
      await search();
      expect(performance.now() - t0).toBeLessThan(190);
    } finally {
      await h.pool.query('UPDATE documents SET closed_until = NULL WHERE document_id = $1', [doc]);
      await second.close();
    }
  });
});

describe('streams nobody reads', () => {
  it('count until what they hold has really gone, so they can’t take what the instance has', async () => {
    const { ann, bob, id, doc } = await together();
    const a = await open(ann, id, doc);
    for (let i = 0; i < 3; i++) { line(a).insert(0, 'y'.repeat(3_000_000)); await saved(a); }
    const others = await Promise.all(Array.from({ length: 5 }, () => account()));
    for (const o of others) await ann.api.workspaces.addPerson(id, o.email, 'read');
    const second = await h.secondServer({ DOC_SENDING_MB: 30 });
    const stops: AbortController[] = [];
    // Held on to: a response that's let go of cancels its stream, and that reader has gone.
    const unread: Response[] = [];
    const openUnread = async (who: Account) => {
      const stop = new AbortController();
      stops.push(stop);
      const r = await who.fetch(`${second.baseUrl}/v1${docPath(id, doc)}/live?after=0`, { signal: stop.signal });
      unread.push(r);
      return r.status;
    };
    try {
      // About 12 MB each on its way, of 30, and more than a socket takes: past that nobody else is taken on, whoever they are.
      const statuses: number[] = [];
      for (const o of others) statuses.push(await openUnread(o));
      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(3);
      expect(statuses).toContain(503);
      // One person can't have it all to themselves.
      const stopping = stops.splice(0);
      for (const s of stopping) s.abort();
      await rest(500);
      const mine: number[] = [];
      for (let i = 0; i < 3; i++) mine.push(await openUnread(bob));
      expect(mine.filter((s) => s === 200).length).toBeLessThanOrEqual(2);
      for (const s of stops.splice(0)) s.abort();
      expect(unread.length).toBe(8);
      // And it all comes free again.
      await until(async () => (await timedStatus(ann, `${second.baseUrl}/v1${docPath(id, doc)}/live?after=0`)) === 200, 'room again');
    } finally {
      for (const s of stops) s.abort();
      await second.close();
    }
  });
  const timedStatus = async (who: Account, url: string) => { const stop = new AbortController(); const r = await who.fetch(url, { signal: stop.signal }); const { status } = r; stop.abort(); return status; };
});

/* ---------- at the limit: one rule, and nothing refused ever lets go of anything ---------- */

/** A block's element and its copy, as the editor's moveBlock writes a move: the copy goes in, the original is retired. */
function moveAsEditor(s: { doc: Y.Doc }, blockId: string, toIndex: number) {
  const fragment = s.doc.getXmlFragment('content');
  const el = fragment.toArray().find((x) => x instanceof Y.XmlElement && x.getAttribute('id') === blockId);
  if (!(el instanceof Y.XmlElement)) throw new Error('no block');
  const copy = new Y.XmlElement(el.nodeName);
  for (const [k, v] of Object.entries<unknown>(el.getAttributes())) if (k !== 'gone') setAttr(copy, k, v);
  const text = new Y.XmlText();
  text.applyDelta(el.toArray().flatMap((c) => (c instanceof Y.XmlText ? c.toDelta() : [])));
  copy.insert(0, [text]);
  s.doc.transact(() => {
    fragment.insert(toIndex, [copy]);
    retireBlock(el, newBlockId(), blockId);
  });
}
/** What a store keeps, as words. */
const keptWords = (kept: KeptUpdate[]) => kept.flatMap((k) => Y.decodeUpdate(k.update).structs.map((x) => (x instanceof Y.Item && x.content instanceof Y.ContentString ? x.content.str : ''))).join('');

describe('at the limit', () => {
  /** A document with a dozen lines in it, and a second server whose limit leaves `room` items to spare on its page. */
  async function full(room: number) {
    const { ann, bob, id, doc } = await together();
    const a0 = await open(ann, id, doc);
    line(a0).insert(0, 'Words in a line');
    for (let i = 0; i < 12; i++) addBlock(a0, 'line', `more${i}`).insert(0, [new Y.XmlText(`Line number ${i} with words in it`)]);
    await saved(a0);
    const second = await h.secondServer({ DOC_ITEMS_MAX: a0.size().items + room });
    const there = async (who: Account, opts: DocSessionOptions = {}) => {
      const s = await createHttpApi({ baseUrl: second.baseUrl, fetch: who.fetch }).workspaces.document(id, doc, opts);
      await s.ready;
      return s;
    };
    return { ann, bob, id, doc, a0, second, there };
  }
  /**
   * Writing that fills a page: a new line each time, of `chars` characters, until well past what a refused session moves on
   * from. Typing on at the end of one line doesn't: Yjs merges it into what's there, so it adds bytes and no items.
   */
  const typeStuck = async (s: DocSession, times = 30, chars = 100) => {
    for (let i = 0; i < times; i++) { addBlock(s, 'line', `typed${i}`).insert(0, [new Y.XmlText(`${'abcdefghij'.repeat(chars / 10)}${String(i).padStart(3, '0')}`)]); await rest(170); }
  };

  it('takes a move whole however full the page is, as it adds nothing to it', async () => {
    const { ann, bob, id, doc, second, there } = await full(1);
    try {
      const b = await there(bob);
      moveAsEditor(b, 'more3', 1);
      await until(() => b.getSnapshot().status === 'saved', 'the move to go', 10_000);
      const fresh = await open(ann, id, doc);
      expect(shown(fresh).indexOf('Line number 3')).toBeLessThan(shown(fresh).indexOf('Words in a line'));
      expect(shown(fresh).match(/Line number 3 with/g)).toHaveLength(1);
      b.close();
    } finally {
      await second.close();
    }
  });

  it('never sends what a stuck change deletes apart from what it adds: moving someone’s paragraph while stuck empties it for nobody', async () => {
    const { ann, bob, id, doc, a0, second, there } = await full(2);
    try {
      line(a0, 'more3').insert(0, 'ANN WROTE THIS JUST NOW. ');
      await saved(a0);
      const store = keepStore();
      const b = await there(bob, { keep: store.keep });
      await typeStuck(b);
      await until(() => b.getSnapshot().refused === 'too-large', 'it to be full');
      moveAsEditor(b, 'more3', 1);
      await rest(6000);
      expect(words(await open(ann, id, doc), 'more3')).toContain('ANN WROTE THIS JUST NOW.');
      await b.discardUnsaved(b.unsentCopy().token);
      expect(words(await open(ann, id, doc), 'more3')).toContain('ANN WROTE THIS JUST NOW.');
    } finally {
      await second.close();
    }
  });

  it('credits what an update retires: a new line and three taken off the page, in one change, go into a full one', async () => {
    const { bob, id, doc, second, there } = await full(0);
    try {
      const s = await there(bob);
      const fragment = s.doc.getXmlFragment('content');
      s.doc.transact(() => {
        for (const el of fragment.toArray()) if (el instanceof Y.XmlElement && /^more[0-2]$/.test(String(el.getAttribute('id') ?? ''))) retireBlock(el, newBlockId(), '');
        addBlock(s, 'line', 'joined').insert(0, [new Y.XmlText(`${'Three lines made into one. '.repeat(8)}`)]);
      });
      await until(() => s.getSnapshot().status === 'saved', 'it to go', 10_000);
      expect(words(await open(bob, id, doc), 'joined')).toContain('Three lines made into one.');
      s.close();
    } finally {
      await second.close();
    }
  });

  it('lets go of only what a copy holds: what’s typed after it stays kept, and comes back to be saved', async () => {
    const { ann, id, doc, second, there } = await full(1);
    try {
      const store = keepStore();
      const s = await there(ann, { keep: store.keep });
      for (let i = 0; i < 8; i++) { addBlock(s, 'line', `stuck${i}`).insert(0, [new Y.XmlText(`stuck${i}`)]); await rest(170); }
      await until(() => s.getSnapshot().refused === 'too-large', 'it to be refused');
      const copy = s.unsentCopy();
      addBlock(s, 'line', 'after').insert(0, [new Y.XmlText('Typed while the copy was saving.')]);
      const made = await ann.api.workspaces.saveCopy(id, { kind: 'document', name: 'Plan copy', parent: null, state: stateFromText(copy.text) });
      expect(body(await open(ann, id, made.id))).toContain('stuck7');
      await s.discardUnsaved(copy.token);
      expect(keptWords(store.kept)).toContain('Typed while the copy was saving.');
      expect(keptWords(store.kept)).not.toContain('stuck7');
      // It was written on what was let go of, so it can't go to this document; opened again, it's here to save all the same.
      const back = await ann.api.workspaces.document(id, doc, { keep: store.keep });
      await back.ready;
      await until(() => back.unsentCopy().text.includes('Typed while the copy was saving.'), 'it to be here to save');
      back.close();
    } finally {
      await second.close();
    }
  });

  it('takes a retry of what it already has as nothing, so a lost reply near the limit leaves nothing stuck', async () => {
    const { ann, id, doc, second } = await full(7);
    try {
      let loseNext = false;
      const lossy: typeof fetch = async (input, init) => {
        const res = await ann.fetch(input, init);
        if (loseNext && String(input).endsWith('/updates')) { loseNext = false; await res.text(); throw new TypeError('The connection dropped before the reply.'); }
        return res;
      };
      const store = keepStore();
      const s = await createHttpApi({ baseUrl: second.baseUrl, fetch: lossy }).workspaces.document(id, doc, { keep: store.keep });
      await s.ready;
      const rows = await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc]);
      loseNext = true;
      s.doc.transact(() => {
        for (let i = 0; i < 4; i++) line(s, `more${i}`).insert(0, `Edit ${i} `);
        line(s, 'more5').delete(0, 5);
      });
      await until(() => s.getSnapshot().status === 'saved', 'the retry to be taken', 15_000);
      expect(store.kept).toEqual([]);
      expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc])).toBe(rows + 1);
      s.close();
    } finally {
      await second.close();
    }
  });
});

describe('what it has already', () => {
  it('keeps no row and no version for deletes it has had, however often they come', async () => {
    const { ann, bob, id, doc } = await together();
    const a = await open(ann, id, doc);
    line(a).insert(0, 'Words only in the first version. ');
    await saved(a);
    await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    line(a).delete(0, line(a).length);
    await saved(a);
    await keepVersion(await heldBy(ann, id), doc, { reason: 'edits', callId: null });
    const versions = await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [doc]);
    const rows = await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc]);
    // What a tab rebuilt to say everything ever deleted, sent again and again, as an hour goes by each time.
    const everything = Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(a.doc));
    for (let i = 0; i < 5; i++) {
      await h.pool.query("UPDATE documents SET version_at = now() - interval '1 hour' WHERE document_id = $1", [doc]);
      expect((await sendUpdate(bob, id, doc, everything)).status).toBe(200);
    }
    expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc])).toBeLessThanOrEqual(rows + 1);
    expect(await count('SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1', [doc])).toBe(versions);
  });

  it('writes nothing while a kept update has nowhere to go, and says so', async () => {
    const { ann, id, doc } = await together();
    const store = keepStore();
    const link = network(ann);
    const a = await open(link.browser, id, doc, { keep: store.keep });
    line(a).insert(0, 'Before. ');
    await saved(a);
    link.drop();
    for (const words of ['First offline. ', 'Second offline. ', 'Third offline. ']) { line(a).insert(line(a).length, words); await rest(250); }
    a.close();
    // The store lost one, so the one after it has nothing to go on.
    store.kept.splice(1, 1);
    const back = await open(ann, id, doc, { keep: store.keep });
    await until(() => back.getSnapshot().refused === 'rejected', 'it to say so');
    const rows = await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc]);
    await rest(16_000);
    expect(await count('SELECT count(*)::int AS n FROM document_updates WHERE document_id = $1', [doc])).toBe(rows);
    expect(back.unsentCopy().text).toContain('Third offline.');
    expect(store.kept.length).toBeGreaterThan(0);
    back.close();
  });

  it('carries a client the previous release knew only by address through a new address', async () => {
    const sub = `sub-${seq++}`;
    const moved = await withGoogle(unique('old'), sub);
    const ann = await account();
    const id = await workspace(ann, 'Ours', [[moved, 'edit']]);
    const doc = await make(ann, id, 'document', 'Plan');
    const m = await open(moved, id, doc);
    line(m).insert(0, 'Written before the deploy. ');
    await saved(m);
    // As the previous release wrote it: the address's tag, and no account's.
    await h.pool.query('UPDATE document_clients SET people = substring(people from 1 for 32) WHERE document_id = $1 AND client_id = $2', [doc, m.doc.clientID]);
    await withGoogle(unique('fresh'), sub);
    line(m).insert(line(m).length, 'Written after the new address. ');
    await saved(m);
    expect(words(await open(ann, id, doc))).toContain('Written after the new address.');
    expect(refusals(doc)).toEqual([]);
  });

  it('answers a copy bigger than a document can be with too-large', async () => {
    const { ann, id } = await together();
    const made = await make(ann, id, 'document', 'Too big');
    const res = await ann.fetch(`${h.baseUrl}/v1${docPath(id, made)}/adopt`, { method: 'POST', headers: { 'content-type': DOC_UPDATE_TYPE }, body: new Uint8Array(MAX_DOC_BYTES + 1) });
    expect(res.status).toBe(413);
  });
});

describe('lines nobody reads', () => {
  it('count against what can be on its way, and a stream there’s no room for is let go of, to open again from where it got to', async () => {
    const mal = await account();
    const id = await workspace(mal, 'Mine');
    const docs = [await make(mal, id, 'document', 'One'), await make(mal, id, 'document', 'Two')];
    const stops: AbortController[] = [];
    try {
      // Two streams that are never read, held on to: a response that's let go of cancels its stream.
      const unread = await Promise.all(docs.map((d) => { const stop = new AbortController(); stops.push(stop); return mal.fetch(`${h.baseUrl}/v1${docPath(id, d)}/live?after=0`, { signal: stop.signal }); }));
      // Twelve megabytes to each, more than a connection holds: the first is theirs to have, the second is past their share, and its stream goes.
      for (const d of docs) expect((await sendUpdate(mal, id, d, anUpdate('w'.repeat(12 * 1024 * 1024)))).status).toBe(200);
      await until(() => h.logs.some((l) => l.includes('stream let go: too much on its way')), 'a stream to be let go of');
      expect(unread.map((r) => r.status)).toEqual([200, 200]);
    } finally {
      for (const s of stops) s.abort();
    }
  });
});
