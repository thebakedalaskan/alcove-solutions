/**
 * Workspaces: who's in one, its tree, who can open what, and its live stream, through browsers talking to the real API
 * over HTTP via @alcove/api-http, on real Postgres and, for guests, a real call. What a document or board holds isn't
 * here: to the tree it's only an item of its kind.
 */
import { AlcoveApiError, OPERATION_HEADER, WorkspaceLiveEventSchema, type AlcoveApi, type CallSession, type CallState, type ItemKind, type WorkspaceItem, type WorkspaceLive, type WorkspaceLiveEvent, type WorkspaceRole } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { randomBytes } from 'node:crypto';
import { connect, createServer, type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { maintain } from '../../maintenance';
import { openState, sealState, type WorkspaceState } from './access';
import { findOwner } from '../../owners';
import { ORIGIN, startHarness, type Browser, type Harness } from '../../testing/harness';

// Guests need real calls; every wait below is bounded and says what it was waiting for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => h.closeCalls());

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
/** A fresh account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
/** Signs in with (the stand-in) Google, as an address and a sign-in of the test's choosing. */
async function withGoogle(email: string, sub: string): Promise<Account> {
  const b = h.browser();
  h.google.next({ sub, email, name: 'Google Person' });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
const madeUp = () => randomBytes(16).toString('base64url');
/** How a request was refused, as a browser sees it, or null when it wasn't. */
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AlcoveApiError ? { code: e.code, message: e.message, status: e.status } : { code: 'not-an-api-error', message: String(e), status: 0 }));
const code = async (p: Promise<unknown>) => (await refusal(p))?.code ?? 'allowed';
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
const ownerOf = async (workspaceId: string) => (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]?.owner_id ?? '';
/** What a workspace's tree says, as this browser sees it: live and in Trash. */
const itemsOf = async (api: AlcoveApi, id: string) => (await api.workspaces.get(id)).items;
const inTree = async (api: AlcoveApi, id: string) => (await itemsOf(api, id)).filter((i) => i.trashedAt === null);
const named = (items: WorkspaceItem[]) => items.map((i) => i.name);
const item = (items: WorkspaceItem[], id: string) => items.find((i) => i.id === id);
/** A workspace `who` made, with people in it at these roles. */
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const make = async (who: Account, id: string, kind: ItemKind, name: string, parent: string | null = null) => (await who.api.workspaces.items.create(id, { kind, name, parent })).id;
/** Writes a workspace's sealed state as it's stored, for a shape or a size no run of requests gets to. */
async function rewrite(workspaceId: string, change: (s: WorkspaceState) => WorkspaceState) {
  const ownerId = await ownerOf(workspaceId);
  const owner = await findOwner(h.deps, ownerId, undefined);
  const row = (await h.pool.query<{ state_ciphertext: Buffer }>('SELECT state_ciphertext FROM workspaces WHERE owner_id = $1', [ownerId])).rows[0];
  if (!owner || !row) throw new Error('no such workspace');
  await h.pool.query('UPDATE workspaces SET state_ciphertext = $2 WHERE owner_id = $1', [ownerId, sealState(owner, workspaceId, change(openState(owner, workspaceId, row.state_ciphertext)))]);
}
/** Leaves an item with nobody as its creator, as whatever makes an item for a whole call does: a stored shape no browser asks for. */
const withNoCreator = (workspaceId: string, itemId: string) => rewrite(workspaceId, (s) => {
  const found = s.items[itemId];
  if (!found) throw new Error('no such item');
  return { ...s, items: { ...s.items, [itemId]: { ...found, by: null } } };
});

/** Reads a workspace's stream as a browser does, keeping each line: `slowMs` between reads, for a browser slower than what's coming. */
function stream(base: string, f: typeof fetch, id: string, pass?: string, slowMs = 0) {
  const lines: WorkspaceLiveEvent[] = [];
  const stop = new AbortController();
  const out = { lines, status: 0, ended: false, stop: () => stop.abort() };
  void (async () => {
    const res = await f(`${base}/v1/workspaces/${id}/live`, { signal: stop.signal, ...(pass ? { headers: { 'x-alcove-call': pass } } : {}) });
    out.status = res.status;
    if (!res.body || !res.ok) { out.ended = true; return; }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
      buf += value;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        lines.push(WorkspaceLiveEventSchema.parse(JSON.parse(buf.slice(0, i))));
        buf = buf.slice(i + 1);
      }
    }
    out.ended = true;
  })().catch(() => { out.ended = true; });
  return out;
}
/** Fills a workspace straight into its sealed state, for a tree as big as it gets without thousands of requests. */
const fill = (workspaceId: string, who: Account, n: number) => rewrite(workspaceId, (s) => {
  const at = new Date().toISOString();
  const items = { ...s.items };
  for (let i = 0; i < n; i++) items[madeUp()] = { kind: 'document', name: `Doc ${i}`, parent: null, pos: `V${i.toString(36).padStart(3, '0')}1`, by: { name: who.name, email: who.email }, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, restrictedBy: null, call: null, room: null };
  return { ...s, items };
});
const treeOf = (l: WorkspaceLive) => l.getSnapshot().tree;
const liveNames = (l: WorkspaceLive) => (treeOf(l)?.items ?? []).filter((i) => i.trashedAt === null).map((i) => i.name);

describe('a workspace', () => {
  it('is made, listed and renamed by its people, and deleted for good, with everything in it', async () => {
    const ann = await account();
    const { id } = await ann.api.workspaces.create('  Launch \n plan ');
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await ann.api.workspaces.list()).toEqual([{ id, name: 'Launch plan', role: 'admin', people: 1, createdAt: expect.any(String), call: null }]);
    expect(await ann.api.workspaces.get(id)).toEqual({ id, name: 'Launch plan', role: 'admin', inCall: false, people: 1, items: [] });
    await ann.api.workspaces.rename(id, 'Launch');
    expect((await ann.api.workspaces.get(id)).name).toBe('Launch');
    expect(await code(ann.api.workspaces.rename(id, '   '))).toBe('invalid');
    expect(await code(ann.api.workspaces.create(''))).toBe('invalid');
    expect(await code(ann.api.workspaces.create('x'.repeat(121)))).toBe('invalid');
    const second = await ann.api.workspaces.create('Another');
    expect((await ann.api.workspaces.list()).map((w) => w.name)).toEqual(['Another', 'Launch']);

    const owner = await ownerOf(id);
    const doc = await make(ann, id, 'document', 'Plan');
    await ann.api.workspaces.share.set(id, doc, [{ email: unique() }], 'read');
    await ann.api.workspaces.remove(id);
    expect(await code(ann.api.workspaces.get(id))).toBe('not-found');
    expect((await ann.api.workspaces.list()).map((w) => w.id)).toEqual([second.id]);
    for (const t of ['owners', 'workspaces', 'workspace_members', 'workspace_mentions', 'documents', 'document_access']) expect(await count(`SELECT count(*)::int AS n FROM ${t} WHERE owner_id = $1`, [owner]), t).toBe(0);
    expect(await code(ann.api.workspaces.remove(id))).toBe('not-found');
  });

  it('is an owner with its own keys and no way to sign in, and nothing that lists accounts mistakes it for one', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    expect(owner).not.toBe(ann.ownerId);
    expect(owner).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Its own root key, under its own envelope.
    const keys = (await h.pool.query<{ root_envelope: Buffer }>('SELECT root_envelope FROM owners WHERE owner_id = ANY($1)', [[owner, ann.ownerId]])).rows.map((r) => r.root_envelope.toString('hex'));
    expect(new Set(keys).size).toBe(2);
    // No sign-in, session, profile, credits or receipts: an account's tables know nothing of it.
    for (const t of ['identities', 'sessions', 'items', 'billing_accounts', 'operations']) expect(await count(`SELECT count(*)::int AS n FROM ${t} WHERE owner_id = $1`, [owner]), t).toBe(0);
    // Upkeep goes past it, however often it runs, and it's still there and still opens.
    await maintain(h.deps);
    await maintain(h.deps);
    expect((await ann.api.workspaces.get(id)).name).toBe('Ours');
    expect(await count('SELECT count(*)::int AS n FROM owners WHERE owner_id = $1', [owner])).toBe(1);
  });

  it('needs someone: nobody signed in or in a call gets anything, real ID or not', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const nobody = h.browser();
    const w = nobody.api.workspaces;
    for (const attempt of [() => w.list(), () => w.get(id), () => w.get(madeUp()), () => w.create('Mine'), () => w.rename(id, 'Mine')]) expect(await code(attempt())).toBe('unauthenticated');
    const live = nobody.api.workspaces.live(id);
    await until(() => live.getSnapshot().status === 'closed', 'a stream with nobody behind it to end');
    expect(live.getSnapshot().tree).toBeNull();
  });

  it('keeps a receipt where a retry mustn’t act twice, and no receipt ever holds a name', async () => {
    const ann = await account();
    const op = randomBytes(16).toString('base64url');
    const post = (path: string, body: unknown, operation = op) => ann.fetch(`${h.baseUrl}/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', [OPERATION_HEADER]: operation }, body: JSON.stringify(body) });
    const first = await (await post('/workspaces', { name: 'CANARY-RECEIPT' })).json();
    expect(Object.keys(first)).toEqual(['id']);
    expect(await (await post('/workspaces', { name: 'CANARY-RECEIPT' })).json()).toEqual(first);
    expect((await post('/workspaces', { name: 'Something else' })).status).toBe(409);
    expect(await ann.api.workspaces.list()).toHaveLength(1);

    const { id } = (await ann.api.workspaces.list())[0] ?? { id: '' };
    const op2 = randomBytes(16).toString('base64url');
    const made = await (await post(`/workspaces/${id}/items`, { kind: 'document', name: 'Once' }, op2)).json();
    expect(await (await post(`/workspaces/${id}/items`, { kind: 'document', name: 'Once' }, op2)).json()).toEqual(made);
    const op3 = randomBytes(16).toString('base64url');
    expect(Object.keys(await (await post(`/workspaces/${id}/items/${made.id}/duplicate`, {}, op3)).json())).toEqual(['id']);
    await post(`/workspaces/${id}/items/${made.id}/duplicate`, {}, op3);
    expect(named(await itemsOf(ann.api, id))).toEqual(['Once', 'Once copy']);
    // A title changes as it's typed, and carries on for as long as someone types: nothing is kept for a retry.
    await ann.api.workspaces.items.rename(id, made.id, 'Twice');
    expect(await count("SELECT count(*)::int AS n FROM operations WHERE owner_id = $1 AND method LIKE 'PATCH %items%'", [ann.ownerId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM operations WHERE owner_id = $1 AND method LIKE 'POST %workspaces%'", [ann.ownerId])).toBe(3);
  });
});

describe('people in a workspace', () => {
  it('have roles an admin sets, by address, whether or not they use Alcove yet', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours');
    const later = unique('later');
    const t = await ann.api.workspaces.addPerson(id, theo.email.toUpperCase(), 'edit');
    await ann.api.workspaces.addPerson(id, later, 'read');
    const people = await ann.api.workspaces.people(id);
    expect(people.map((p) => [p.person.email, p.role, p.isMe])).toEqual([[ann.email, 'admin', true], [theo.email, 'edit', false], [later, 'read', false]]);
    expect(people[0]?.person.name).toBe(ann.name);
    expect(await ann.api.workspaces.list()).toEqual([expect.objectContaining({ id, people: 3 })]);
    expect(await theo.api.workspaces.list()).toEqual([{ id, name: 'Ours', role: 'edit', people: 3, createdAt: expect.any(String), call: null }]);
    expect((await theo.api.workspaces.people(id)).find((p) => p.isMe)?.person.email).toBe(theo.email);

    // Adding someone who's in it sets their role: the same person, not a second one.
    expect((await ann.api.workspaces.addPerson(id, theo.email, 'read')).id).toBe(t.id);
    expect((await theo.api.workspaces.get(id)).role).toBe('read');
    await ann.api.workspaces.setRole(id, t.id, 'admin');
    expect((await theo.api.workspaces.get(id)).role).toBe('admin');

    // Whoever signs in with that address later finds it there.
    const arrived = await account(later);
    expect((await arrived.api.workspaces.get(id)).role).toBe('read');

    // An ID from another workspace names nobody here.
    const elsewhere = await workspace(ann, 'Elsewhere');
    const stranger = (await ann.api.workspaces.people(elsewhere))[0]?.id ?? '';
    expect(await refusal(ann.api.workspaces.setRole(id, stranger, 'read'))).toEqual(await refusal(ann.api.workspaces.setRole(id, madeUp(), 'read')));
    expect(await code(ann.api.workspaces.removePerson(id, stranger))).toBe('not-found');
    expect(await code(ann.api.workspaces.addPerson(id, 'not an address', 'read'))).toBe('invalid');
  });

  it('come and go: an admin can take anyone out, anyone can leave, and a workspace always keeps an admin', async () => {
    const ann = await account();
    const theo = await account();
    const kofi = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [kofi, 'read']]);
    const idOf = async (who: Account) => (await ann.api.workspaces.people(id)).find((p) => p.person.email === who.email)?.id ?? '';

    await kofi.api.workspaces.removePerson(id, await idOf(kofi));
    expect(await code(kofi.api.workspaces.get(id))).toBe('not-found');
    expect(await kofi.api.workspaces.list()).toEqual([]);
    await ann.api.workspaces.removePerson(id, await idOf(theo));
    expect(await code(theo.api.workspaces.get(id))).toBe('not-found');

    const me = await idOf(ann);
    expect(await code(ann.api.workspaces.setRole(id, me, 'edit'))).toBe('conflict');
    expect(await code(ann.api.workspaces.removePerson(id, me))).toBe('conflict');
    await ann.api.workspaces.addPerson(id, theo.email, 'admin');
    await ann.api.workspaces.setRole(id, me, 'read');
    expect((await ann.api.workspaces.get(id)).role).toBe('read');
    expect(await code(ann.api.workspaces.rename(id, 'Mine'))).toBe('forbidden');
  });
});

describe('the tree', () => {
  it('holds documents, boards and folders, in the order people put them', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const items = ann.api.workspaces.items;
    const pricing = await make(ann, id, 'folder', 'Pricing');
    const plan = await make(ann, id, 'document', 'Plan', pricing);
    const board = await make(ann, id, 'board', 'Map', pricing);
    const top = await make(ann, id, 'document', 'Top');
    const tree = await itemsOf(ann.api, id);
    // Parents before what's in them, each in its place.
    expect(tree.map((i) => [i.name, i.kind, i.parent])).toEqual([['Pricing', 'folder', null], ['Plan', 'document', pricing], ['Map', 'board', pricing], ['Top', 'document', null]]);
    expect(item(tree, plan)).toMatchObject({ role: 'edit', restricted: false, trashedAt: null, trashedBy: null, by: { name: ann.name } });
    expect(item(tree, plan)?.by?.portrait).toBeTruthy();
    expect(JSON.stringify(tree)).not.toContain(ann.email);

    // A new document has no name yet; its row exists in `documents`, and a folder has none.
    const blank = await items.create(id, { kind: 'document' });
    expect((await items.get(id, blank.id)).name).toBe('');
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE owner_id = $1', [await ownerOf(id)])).toBe(4);
    await items.trash(id, blank.id);
    await items.deleteForever(id, blank.id);

    // Renaming, and landing where it's put: first, after a sibling, last, another folder and back.
    await items.rename(id, plan, ' Launch   plan ');
    expect((await items.get(id, plan)).name).toBe('Launch plan');
    await items.move(id, board, { parent: pricing, after: null });
    expect(named(await inTree(ann.api, id))).toEqual(['Pricing', 'Map', 'Launch plan', 'Top']);
    await items.move(id, plan, { parent: null, after: pricing });
    expect((await inTree(ann.api, id)).map((i) => [i.name, i.parent])).toEqual([['Pricing', null], ['Map', pricing], ['Launch plan', null], ['Top', null]]);
    await items.move(id, top, { parent: pricing });
    expect((await inTree(ann.api, id)).map((i) => [i.name, i.parent])).toEqual([['Pricing', null], ['Map', pricing], ['Top', pricing], ['Launch plan', null]]);
    await items.create(id, { kind: 'document', name: 'First', parent: null, after: null });
    await items.create(id, { kind: 'folder', name: 'Middle', parent: null, after: pricing });
    expect(named((await inTree(ann.api, id)).filter((i) => i.parent === null))).toEqual(['First', 'Pricing', 'Middle', 'Launch plan']);
  });

  it('keeps any order however many times things land between each other', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const items = ann.api.workspaces.items;
    const want: string[] = [];
    const place = async (at: number) => {
      const name = `row ${want.length}`;
      const after = at === 0 ? null : (want[at - 1] ?? null);
      const { id: made } = await items.create(id, { kind: 'document', name, parent: null, after });
      want.splice(at, 0, made);
    };
    // At the front, at the back and always just after the same one, so positions are pressed as close as they get.
    for (let i = 0; i < 12; i++) await place(0);
    for (let i = 0; i < 12; i++) await place(want.length);
    for (let i = 0; i < 12; i++) await place(6);
    // And one row moved back and forth over the end of the list, between the same two neighbours.
    const third = want[2] ?? '';
    for (let i = 0; i < 6; i++) {
      const rest = want.filter((x) => x !== third);
      const at = rest.length - (i % 2);
      await items.move(id, third, { parent: null, after: rest[at - 1] ?? null });
      want.splice(0, want.length, ...rest.slice(0, at), third, ...rest.slice(at));
    }
    expect((await inTree(ann.api, id)).map((i) => i.id)).toEqual(want);
  });

  it('takes changes one at a time, so people working at once lose nothing', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const items = (who: Account) => who.api.workspaces.items;
    const made = await Promise.all(Array.from({ length: 16 }, (_, i) => items(i % 2 ? ann : theo).create(id, { kind: 'document', name: `Doc ${i}` })));
    expect(new Set(made.map((m) => m.id)).size).toBe(16);
    expect((await inTree(ann.api, id)).map((i) => i.name).sort()).toEqual(Array.from({ length: 16 }, (_, i) => `Doc ${i}`).sort());
    // Every one landed somewhere of its own: moving one after another keeps them apart.
    const folder = await make(ann, id, 'folder', 'Folder');
    await Promise.all(made.map((m, i) => (i % 2 ? items(ann).move(id, m.id, { parent: folder }) : items(theo).rename(id, m.id, `Renamed ${i}`))));
    const tree = await inTree(ann.api, id);
    expect(tree.filter((i) => i.parent === folder)).toHaveLength(8);
    expect(tree.filter((i) => i.name.startsWith('Renamed'))).toHaveLength(8);
    // One step for each change: adding Theo, the sixteen documents, the folder and the sixteen moves and renames.
    expect(await count('SELECT version::int AS n FROM workspaces WHERE workspace_id = $1', [id])).toBe(1 + 16 + 1 + 16);
  });

  it('holds so many things and no more, because every change rewrites it and every reader is sent it whole', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const folder = await make(ann, id, 'folder', 'Folder');
    await rewrite(id, (s) => {
      const at = new Date().toISOString();
      const items = { ...s.items };
      for (let i = 0; i < 4998; i++) {
        items[madeUp()] = { kind: 'document', name: `Doc ${i}`, parent: folder, pos: `V${i.toString(36).padStart(3, '0')}1`, by: { name: ann.name, email: ann.email }, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, restrictedBy: null, call: null, room: null };
      }
      return { ...s, items };
    });
    const tree = await itemsOf(ann.api, id);
    expect(tree).toHaveLength(4999);
    expect(tree.slice(1, 4).map((i) => i.name)).toEqual(['Doc 0', 'Doc 1', 'Doc 2']);
    await ann.api.workspaces.items.create(id, { kind: 'document', name: 'The last one' });
    const full = await refusal(ann.api.workspaces.items.create(id, { kind: 'document', name: 'One too many' }));
    expect(full).toMatchObject({ code: 'conflict', message: 'This workspace is full. Delete something from it first.' });
    expect(await code(ann.api.workspaces.items.duplicate(id, folder))).toBe('conflict');
    // A whole folder of it goes to Trash, comes back and streams like anything else.
    await ann.api.workspaces.items.trash(id, folder);
    expect(await inTree(ann.api, id)).toHaveLength(1);
    await ann.api.workspaces.items.restore(id, folder);
    const live = ann.api.workspaces.live(id);
    await until(() => treeOf(live)?.items.length === 5000, 'all of it on the stream');
  });

  it('goes 32 folders deep and no further, however it’s tried', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const items = ann.api.workspaces.items;
    const deep = 'Folders can only go 32 deep.';
    const chain: string[] = [];
    for (let i = 0; i < 32; i++) chain.push(await make(ann, id, 'folder', `Level ${i + 1}`, chain.at(-1) ?? null));
    const bottom = chain.at(-1) ?? '';
    expect(await refusal(items.create(id, { kind: 'folder', name: 'Too deep', parent: bottom }))).toMatchObject({ code: 'invalid', message: deep });
    // A document holds no folders, so it can sit at the bottom.
    await make(ann, id, 'document', 'At the bottom', bottom);
    // Moving a folder counts the folders it brings with it.
    const pair = await make(ann, id, 'folder', 'Pair');
    await make(ann, id, 'folder', 'Inside the pair', pair);
    expect(await refusal(items.move(id, pair, { parent: chain[30] ?? '' }))).toMatchObject({ code: 'invalid', message: deep });
    await items.move(id, pair, { parent: chain[29] ?? '' });
    // A copy lands beside the original, as deep as it is. It goes up to the limit, and not past it.
    expect((await items.get(id, (await items.duplicate(id, chain[0] ?? '')).id)).name).toBe('Level 1 copy');
    await rewrite(id, (s) => {
      const top = madeUp();
      const first = s.items[chain[0] ?? ''];
      if (!first) throw new Error('no first folder');
      return { ...s, items: { ...s.items, [top]: { ...first, name: 'One more above', pos: 'V' }, [chain[0] ?? '']: { ...first, parent: top } } };
    });
    expect(await refusal(items.duplicate(id, chain[0] ?? ''))).toMatchObject({ code: 'invalid', message: deep });
  });

  it('reads and clears a tree of any depth that’s stored, without running out of stack', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const top = await make(ann, id, 'folder', 'Top');
    const at = new Date().toISOString();
    const ids = Array.from({ length: 4900 }, () => madeUp());
    await rewrite(id, (s) => {
      const items = { ...s.items };
      ids.forEach((x, i) => { items[x] = { kind: 'folder', name: `Level ${i}`, parent: ids[i - 1] ?? top, pos: 'V', by: { name: ann.name, email: ann.email }, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, restrictedBy: null, call: null, room: null }; });
      return { ...s, items };
    });
    expect(await itemsOf(theo.api, id)).toHaveLength(4901);
    const live = theo.api.workspaces.live(id);
    await until(() => treeOf(live)?.items.length === 4901, 'all of it on the stream');
    expect((await ann.api.workspaces.items.get(id, ids.at(-1) ?? '')).trashedAt).toBeNull();
    // It can't go any deeper, and all of it can still be sent away and deleted.
    expect(await code(ann.api.workspaces.items.create(id, { kind: 'folder', name: 'x', parent: ids.at(-1) ?? '' }))).toBe('invalid');
    await ann.api.workspaces.items.trash(id, top);
    expect(await inTree(ann.api, id)).toEqual([]);
    await ann.api.workspaces.items.deleteForever(id, top);
    expect(await itemsOf(ann.api, id)).toEqual([]);
  });

  it('refuses a move that would make a cycle, or land anywhere that isn’t a folder in the tree', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const items = ann.api.workspaces.items;
    const a = await make(ann, id, 'folder', 'A');
    const b = await make(ann, id, 'folder', 'B', a);
    const c = await make(ann, id, 'folder', 'C', b);
    const doc = await make(ann, id, 'document', 'Doc', c);
    expect(await code(items.move(id, a, { parent: a }))).toBe('invalid');
    expect(await code(items.move(id, a, { parent: c }))).toBe('invalid');
    expect(await code(items.move(id, b, { parent: c }))).toBe('invalid');
    expect(await code(items.move(id, a, { parent: doc }))).toBe('invalid');
    expect(await code(items.create(id, { kind: 'folder', name: 'Inside', parent: doc }))).toBe('invalid');
    expect(item(await itemsOf(ann.api, id), a)?.parent).toBeNull();
    // A place among siblings is among the siblings of where it lands.
    expect(await code(items.move(id, doc, { parent: null, after: b }))).toBe('invalid');
    expect(await code(items.move(id, doc, { parent: null, after: doc }))).toBe('invalid');
    expect(await code(items.move(id, doc, { parent: madeUp() }))).toBe('not-found');
    expect(await code(items.move(id, doc, { parent: null, after: madeUp() }))).toBe('not-found');
    // Down a folder and back up is fine.
    await items.move(id, c, { parent: a });
    await items.move(id, b, { parent: c });
    expect((await itemsOf(ann.api, id)).map((i) => i.name)).toEqual(['A', 'C', 'Doc', 'B']);
  });

  it('copies something just after itself, and a folder with what’s in it', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const items = ann.api.workspaces.items;
    const folder = await make(ann, id, 'folder', 'Pricing');
    const plan = await make(ann, id, 'document', 'Plan', folder);
    await make(ann, id, 'board', 'Map', folder);
    const after = await make(ann, id, 'document', 'After');
    await ann.api.workspaces.share.set(id, plan, [{ email: unique() }], 'read');

    const copy = await items.duplicate(id, plan);
    expect(named(await inTree(ann.api, id))).toEqual(['Pricing', 'Plan', 'Plan copy', 'Map', 'After']);
    // Nobody the original is shared with gets the copy.
    expect((await ann.api.workspaces.share.list(id, plan)).entries).toHaveLength(1);
    expect((await ann.api.workspaces.share.list(id, copy.id)).entries).toEqual([]);

    const folderCopy = await items.duplicate(id, folder);
    const tree = await inTree(ann.api, id);
    expect(tree.map((i) => [i.name, i.parent === folderCopy.id])).toEqual([
      ['Pricing', false], ['Plan', false], ['Plan copy', false], ['Map', false],
      ['Pricing copy', false], ['Plan', true], ['Plan copy', true], ['Map', true], ['After', false]
    ]);
    expect(new Set(tree.map((i) => i.id)).size).toBe(tree.length);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE owner_id = $1', [await ownerOf(id)])).toBe(7);
    // A long name stays within what a name can be.
    await items.rename(id, after, 'x'.repeat(200));
    expect((await items.get(id, (await items.duplicate(id, after)).id)).name).toHaveLength(200);
  });

  it('keeps Trash for what’s sent there, a folder with what’s in it, and brings things back', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const items = ann.api.workspaces.items;
    const folder = await make(ann, id, 'folder', 'Pricing');
    const inside = await make(ann, id, 'document', 'Inside', folder);
    const earlier = await make(ann, id, 'document', 'Earlier', folder);
    const plan = await make(ann, id, 'document', 'Plan');
    await items.trash(id, earlier);

    await theo.api.workspaces.items.trash(id, folder);
    await theo.api.workspaces.items.trash(id, folder);
    expect(named(await inTree(ann.api, id))).toEqual(['Plan']);
    const tree = await itemsOf(ann.api, id);
    expect(item(tree, folder)).toMatchObject({ trashedBy: theo.name });
    expect(item(tree, inside)?.trashedAt).toBe(item(tree, folder)?.trashedAt);
    // It stays readable, and nothing can change it until it's back.
    expect((await items.get(id, inside)).name).toBe('Inside');
    expect(await code(items.rename(id, inside, 'New'))).toBe('conflict');
    expect(await code(items.move(id, inside, { parent: null }))).toBe('conflict');
    expect(await code(items.duplicate(id, inside))).toBe('conflict');
    expect(await code(items.create(id, { kind: 'document', name: 'Into Trash', parent: folder }))).toBe('conflict');
    expect(await code(items.move(id, plan, { parent: folder }))).toBe('conflict');

    // The folder comes back with what went with it; what was in Trash before stays there.
    await items.restore(id, folder);
    expect(named(await inTree(ann.api, id))).toEqual(['Pricing', 'Inside', 'Plan']);
    expect(item(await itemsOf(ann.api, id), earlier)?.trashedAt).not.toBeNull();
    // Whose folder isn't in the tree any more comes back to the top.
    await items.trash(id, folder);
    await items.restore(id, earlier);
    expect((await inTree(ann.api, id)).map((i) => [i.name, i.parent])).toEqual([['Plan', null], ['Earlier', null]]);
    await items.restore(id, inside);
    expect((await inTree(ann.api, id)).map((i) => [i.name, i.parent])).toEqual([['Plan', null], ['Earlier', null], ['Inside', null]]);

    // For good only from Trash, and then for everyone: with its row and who it was shared with.
    expect(await code(items.deleteForever(id, plan))).toBe('conflict');
    await ann.api.workspaces.share.set(id, plan, [{ email: unique() }], 'read');
    await items.trash(id, plan);
    await items.deleteForever(id, plan);
    expect(await code(theo.api.workspaces.items.get(id, plan))).toBe('not-found');
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [plan])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM document_access WHERE document_id = $1', [plan])).toBe(0);
    await items.deleteForever(id, folder);
    expect(await code(items.get(id, folder))).toBe('not-found');
    expect(named(await itemsOf(ann.api, id))).toEqual(['Earlier', 'Inside']);
  });

  it('deletes what’s been in Trash for 30 days, and only that', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const items = ann.api.workspaces.items;
    const folder = await make(ann, id, 'folder', 'Old');
    const old = await make(ann, id, 'document', 'Old doc', folder);
    const fresh = await make(ann, id, 'document', 'Fresh');
    const kept = await make(ann, id, 'document', 'Kept');
    await items.trash(id, folder);
    const owner = await ownerOf(id);
    const since = async () => (await h.pool.query<{ t: Date | null }>('SELECT trash_since AS t FROM workspaces WHERE owner_id = $1', [owner])).rows[0]?.t ?? null;
    expect(await since()).toBeInstanceOf(Date);

    // Nothing is due yet, however often upkeep runs.
    await maintain(h.deps);
    expect(named(await itemsOf(ann.api, id))).toEqual(['Old', 'Old doc', 'Fresh', 'Kept']);
    await new Promise((r) => setTimeout(r, 50));
    const cutoff = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    await items.trash(id, fresh);
    // As if the folder went a month ago and `fresh` only now.
    const r = await maintain(h.deps, { trashAgeMs: Date.now() - cutoff });
    expect(r.trash).toBe(2);
    expect(named(await itemsOf(ann.api, id))).toEqual(['Fresh', 'Kept']);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [old])).toBe(0);
    expect(await since()).toBeInstanceOf(Date);
    await items.restore(id, fresh);
    expect(await since()).toBeNull();
    expect(item(await itemsOf(ann.api, id), kept)?.trashedAt).toBeNull();
  });

  it('sweeps every other workspace when one can’t be read, and ends seats all the same', async () => {
    const ann = await account();
    const broken = await workspace(ann, 'Broken');
    const fine = await workspace(ann, 'Fine');
    const gone = await make(ann, broken, 'document', 'In the broken one');
    const old = await make(ann, fine, 'document', 'Old');
    await ann.api.workspaces.items.trash(broken, gone);
    await ann.api.workspaces.items.trash(fine, old);
    // Its state no longer opens, and it's first in line.
    await h.pool.query("UPDATE workspaces SET state_ciphertext = '\\x7b7d', trash_since = now() - interval '1 year' WHERE workspace_id = $1", [broken]);
    const owner = await ownerOf(fine);
    const keep = await make(ann, fine, 'document', 'Keep');
    await h.pool.query(`INSERT INTO document_access (owner_id, document_id, access_id, principal_index, kind, role, call_id, person_ciphertext) VALUES ($1,$2,$3,$4,'seat','read',$5,$6)`,
      [owner, keep, madeUp(), randomBytes(32), madeUp(), Buffer.from('{}')]);
    const from = h.logs.length;

    const r = await maintain(h.deps, { trashAgeMs: 0 });

    expect(r.trash).toBeGreaterThanOrEqual(1);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [old])).toBe(0);
    expect(r.seats).toBe(1);
    expect(h.logs.slice(from).some((l) => l.includes('Trash not swept') && l.includes(broken) && l.includes('"level":40'))).toBe(true);
    await h.pool.query('DELETE FROM owners WHERE owner_id = (SELECT owner_id FROM workspaces WHERE workspace_id = $1)', [broken]);
  });

  it('never reaches across workspaces, whatever ID comes in', async () => {
    const ann = await account();
    const mine = await workspace(ann, 'Mine');
    const other = await workspace(ann, 'Other');
    const folderThere = await make(ann, other, 'folder', 'There');
    const docThere = await make(ann, other, 'document', 'There');
    const docHere = await make(ann, mine, 'document', 'Here');
    const items = ann.api.workspaces.items;
    const attempts = [
      () => items.get(mine, docThere), () => items.rename(mine, docThere, 'x'), () => items.move(mine, docThere, { parent: null }), () => items.duplicate(mine, docThere), () => items.trash(mine, docThere),
      () => items.restore(mine, docThere), () => items.deleteForever(mine, docThere), () => items.move(mine, docHere, { parent: folderThere }), () => items.move(mine, docHere, { parent: null, after: docThere }),
      () => items.create(mine, { kind: 'document', name: 'x', parent: folderThere }), () => ann.api.workspaces.share.list(mine, docThere), () => ann.api.workspaces.share.set(mine, docThere, [{ email: unique() }], 'read'),
      () => ann.api.workspaces.share.restrict(mine, docThere, true)
    ];
    for (const attempt of attempts) expect(await code(attempt())).toBe('not-found');
    await ann.api.workspaces.share.set(other, docThere, [{ email: unique() }], 'read');
    const entry = (await ann.api.workspaces.share.list(other, docThere)).entries[0]?.id ?? '';
    await ann.api.workspaces.share.set(mine, docHere, [{ email: unique() }], 'read');
    expect(await code(ann.api.workspaces.share.remove(mine, docHere, entry))).toBe('not-found');
    expect((await ann.api.workspaces.share.list(other, docThere)).entries).toHaveLength(1);
  });
});

describe('who can open what', () => {
  it('keeps a restricted document from everyone but its creator and the people it’s shared with, admins too', async () => {
    const ann = await account();
    const theo = await account();
    const priya = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [priya, 'edit']]);
    const secret = await make(theo, id, 'document', 'CANARY-SECRET-NAME');
    const board = await make(theo, id, 'board', 'CANARY-SECRET-BOARD');
    const open = await make(theo, id, 'document', 'Open');
    await theo.api.workspaces.share.restrict(id, secret, true);
    await theo.api.workspaces.share.restrict(id, board, true);

    expect(named(await itemsOf(theo.api, id))).toEqual(['CANARY-SECRET-NAME', 'CANARY-SECRET-BOARD', 'Open']);
    expect(item(await itemsOf(theo.api, id), secret)).toMatchObject({ restricted: true, role: 'edit' });
    for (const who of [ann, priya]) {
      const tree = await who.api.workspaces.get(id);
      expect(named(tree.items)).toEqual(['Open']);
      expect(JSON.stringify(tree)).not.toContain('CANARY-SECRET');
      // A real ID and a made-up one get exactly the same answer, however it's asked.
      const w = who.api.workspaces;
      const asks: ((doc: string) => Promise<unknown>)[] = [
        (d) => w.items.get(id, d), (d) => w.items.rename(id, d, 'x'), (d) => w.items.move(id, d, { parent: null }), (d) => w.items.duplicate(id, d), (d) => w.items.trash(id, d),
        (d) => w.items.restore(id, d), (d) => w.items.deleteForever(id, d), (d) => w.share.list(id, d), (d) => w.share.set(id, d, [{ email: who.email }], 'edit'), (d) => w.share.restrict(id, d, false),
        (d) => w.items.move(id, open, { parent: null, after: d }), (d) => w.items.move(id, open, { parent: d }), (d) => w.items.create(id, { kind: 'document', name: 'x', parent: d })
      ];
      for (const ask of asks) {
        const real = await refusal(ask(secret));
        expect(real?.code).toBe('not-found');
        expect(real).toEqual(await refusal(ask(madeUp())));
      }
    }

    // Shared with someone: it opens for them, at the role they were given, and for nobody else.
    await theo.api.workspaces.share.set(id, secret, [{ email: priya.email }], 'read');
    expect(item(await itemsOf(priya.api, id), secret)).toMatchObject({ name: 'CANARY-SECRET-NAME', role: 'read' });
    expect(await code(priya.api.workspaces.items.rename(id, secret, 'x'))).toBe('forbidden');
    expect(named(await itemsOf(ann.api, id))).toEqual(['Open']);
    await theo.api.workspaces.share.set(id, secret, [{ email: priya.email }], 'edit');
    await priya.api.workspaces.items.rename(id, secret, 'Theirs');
    expect((await theo.api.workspaces.share.list(id, secret)).entries.map((e) => [e.person.email, e.role, e.kind])).toEqual([[priya.email, 'edit', 'email']]);

    // Open to the workspace again, it's everyone's, and being shared with stays as it was.
    await theo.api.workspaces.share.restrict(id, secret, false);
    expect(named(await itemsOf(ann.api, id))).toEqual(['Theirs', 'Open']);
    expect((await theo.api.workspaces.share.list(id, secret)).entries).toHaveLength(1);
    // Whoever restricts something they didn't make keeps it; the creator always has it; nobody else does.
    await priya.api.workspaces.share.restrict(id, open, true);
    expect(named(await itemsOf(priya.api, id))).toContain('Open');
    expect(named(await itemsOf(theo.api, id))).toContain('Open');
    expect(named(await itemsOf(ann.api, id))).not.toContain('Open');
    expect(await code(ann.api.workspaces.share.list(id, open))).toBe('not-found');
    // That's hers by restricting it, not an entry anyone gave her.
    expect((await priya.api.workspaces.share.list(id, open)).entries).toEqual([]);
  });

  it('leaves what someone can’t see out of what they do to a folder', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const folder = await make(ann, id, 'folder', 'Shared folder');
    const sub = await make(ann, id, 'folder', 'Sub', folder);
    const secret = await make(theo, id, 'document', 'Theirs alone', sub);
    const seen = await make(ann, id, 'document', 'Seen', sub);
    await theo.api.workspaces.share.restrict(id, secret, true);

    // Ann copies the folder: what she can't open isn't in her copy.
    const copy = await ann.api.workspaces.items.duplicate(id, folder);
    expect((await itemsOf(theo.api, id)).filter((i) => i.name === 'Theirs alone')).toHaveLength(1);
    await ann.api.workspaces.items.trash(id, copy.id);
    await ann.api.workspaces.items.deleteForever(id, copy.id);

    // Ann sends the folder to Trash and deletes it for good: she can't decide that for something she can't see.
    await ann.api.workspaces.items.trash(id, folder);
    expect((await inTree(theo.api, id)).map((i) => [i.name, i.parent])).toEqual([['Theirs alone', null]]);
    expect(item(await itemsOf(ann.api, id), seen)?.trashedAt).not.toBeNull();
    await ann.api.workspaces.items.deleteForever(id, folder);
    expect(named(await itemsOf(theo.api, id))).toEqual(['Theirs alone']);
    expect(named(await itemsOf(ann.api, id))).toEqual([]);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [secret])).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [seen])).toBe(0);

    // A copy of something restricted is restricted, to whoever made it, and shared with nobody.
    const again = await theo.api.workspaces.items.duplicate(id, secret);
    expect(item(await itemsOf(theo.api, id), again.id)).toMatchObject({ restricted: true, name: 'Theirs alone copy' });
    expect(await code(ann.api.workspaces.items.get(id, again.id))).toBe('not-found');
  });

  it('lets nobody destroy, through a folder, what they could only read', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const folder = await make(ann, id, 'folder', 'Folder');
    const readOnly = await make(theo, id, 'document', 'Hers to read', folder);
    const theirs = await make(ann, id, 'document', 'Ann’s', folder);
    await theo.api.workspaces.share.restrict(id, readOnly, true);
    await theo.api.workspaces.share.set(id, readOnly, [{ email: ann.email }], 'read');
    // Ann can read it, and that's not enough to send it to Trash on its own.
    expect(await code(ann.api.workspaces.items.trash(id, readOnly))).toBe('forbidden');

    await ann.api.workspaces.items.trash(id, folder);
    const after = await itemsOf(ann.api, id);
    expect(item(after, readOnly)).toMatchObject({ parent: null, trashedAt: null, role: 'read' });
    expect(item(after, theirs)?.trashedAt).not.toBeNull();
    await ann.api.workspaces.items.deleteForever(id, folder);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [readOnly])).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [theirs])).toBe(0);

    // And nor by deleting a folder it came to be in, after that folder went to Trash.
    const second = await make(theo, id, 'folder', 'Second');
    await theo.api.workspaces.items.move(id, readOnly, { parent: second });
    await theo.api.workspaces.items.trash(id, second);
    await ann.api.workspaces.items.deleteForever(id, second);
    expect(item(await itemsOf(theo.api, id), readOnly)).toMatchObject({ parent: null, trashedAt: null, role: 'edit' });
  });

  it('moves thousands of things out of a folder in one quick step, under the lock', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const folder = await make(ann, id, 'folder', 'Folder');
    const secret = await make(theo, id, 'document', 'Template', folder);
    const at = new Date().toISOString();
    await rewrite(id, (s) => {
      const source = s.items[secret];
      if (!source) throw new Error('no document');
      const items = { ...s.items, [secret]: { ...source, restricted: true } };
      for (let i = 0; i < 4990; i++) items[madeUp()] = { ...source, name: `Hidden ${i}`, pos: `V${i.toString(36).padStart(3, '0')}1`, restricted: true, createdAt: at, editedAt: at };
      return { ...s, items };
    });
    const t0 = Date.now();
    await ann.api.workspaces.items.trash(id, folder);
    expect(Date.now() - t0).toBeLessThan(4000);
    const tree = await inTree(theo.api, id);
    expect(tree).toHaveLength(4991);
    expect(tree.every((i) => i.parent === null)).toBe(true);
    expect(new Set(tree.map((i) => i.id)).size).toBe(4991);
    await ann.api.workspaces.items.restore(id, folder);
    await ann.api.workspaces.items.trash(id, folder);
    const t1 = Date.now();
    await ann.api.workspaces.items.deleteForever(id, folder);
    expect(Date.now() - t1).toBeLessThan(4000);
    expect(await inTree(theo.api, id)).toHaveLength(4991);
  });

  it('shows someone outside the workspace the document they were given, alone', async () => {
    const ann = await account();
    const sam = await account();
    const id = await workspace(ann, 'CANARY-SPACE-NAME');
    const folder = await make(ann, id, 'folder', 'CANARY-FOLDER-NAME');
    const given = await make(ann, id, 'document', 'Given', folder);
    const board = await make(ann, id, 'board', 'Also given');
    const other = await make(ann, id, 'document', 'CANARY-OTHER-NAME');
    const w = sam.api.workspaces;
    expect(await w.list()).toEqual([]);
    await ann.api.workspaces.share.set(id, given, [{ email: sam.email }], 'read');

    expect(await w.list()).toEqual([{ id, name: null, role: null, people: null, createdAt: null, call: null }]);
    const tree = await w.get(id);
    expect(tree).toMatchObject({ id, name: null, role: null, people: null });
    expect(tree.items.map((i) => [i.id, i.parent, i.role])).toEqual([[given, null, 'read']]);
    expect(JSON.stringify(tree)).not.toMatch(/CANARY|@/);
    // Nothing else in it exists, for them.
    for (const elsewhere of [other, folder, board]) expect(await refusal(w.items.get(id, elsewhere))).toEqual(await refusal(w.items.get(id, madeUp())));
    // What's for people in the workspace doesn't exist for them either, and what's given is what's given.
    const refused = [
      () => w.people(id), () => w.items.create(id, { kind: 'document', name: 'x' }), () => w.items.move(id, given, { parent: null }), () => w.items.duplicate(id, given), () => w.items.trash(id, given),
      () => w.share.list(id, given), () => w.share.set(id, given, [{ email: unique() }], 'edit')
    ];
    for (const attempt of refused) expect(await code(attempt())).toBe('not-found');
    expect(await code(w.items.rename(id, given, 'x'))).toBe('forbidden');
    expect(await code(w.rename(id, 'x'))).toBe('not-found');
    expect(await code(w.remove(id))).toBe('not-found');

    // Given more: another document, and the right to edit, which is what a title changing as it's typed needs.
    await ann.api.workspaces.share.set(id, given, [{ email: sam.email }], 'edit');
    await ann.api.workspaces.share.set(id, board, [{ email: sam.email }], 'read');
    await w.items.rename(id, given, 'Renamed by Sam');
    expect((await w.get(id)).items.map((i) => [i.name, i.kind, i.parent, i.role])).toEqual([['Renamed by Sam', 'document', null, 'edit'], ['Also given', 'board', null, 'read']]);

    // In Trash, it stays readable, and anyone who can edit it can bring it back.
    await ann.api.workspaces.items.trash(id, given);
    expect((await w.items.get(id, given)).trashedBy).toBe(ann.name);
    expect(await code(w.items.rename(id, given, 'x'))).toBe('conflict');
    await w.items.restore(id, given);
    expect((await ann.api.workspaces.items.get(id, given)).trashedAt).toBeNull();
    expect(item(await itemsOf(ann.api, id), given)?.parent).toBe(folder);

    // Taken back, it's as if it never was.
    const share = await ann.api.workspaces.share.list(id, given);
    expect(share).toMatchObject({ workspace: { name: 'CANARY-SPACE-NAME', people: 1 }, restricted: false });
    await ann.api.workspaces.share.remove(id, given, share.entries[0]?.id ?? '');
    await ann.api.workspaces.share.remove(id, board, (await ann.api.workspaces.share.list(id, board)).entries[0]?.id ?? '');
    expect(await w.list()).toEqual([]);
    expect(await refusal(w.get(id))).toEqual(await refusal(w.get(madeUp())));
    expect(await code(ann.api.workspaces.share.remove(id, given, madeUp()))).toBe('not-found');
  });

  it('lets someone with `read` change nothing, except what they were given', async () => {
    const ann = await account();
    const rita = await account();
    const id = await workspace(ann, 'Ours', [[rita, 'read']]);
    const folder = await make(ann, id, 'folder', 'Folder');
    const doc = await make(ann, id, 'document', 'Doc', folder);
    const board = await make(ann, id, 'board', 'Board');
    const gone = await make(ann, id, 'document', 'Gone');
    await ann.api.workspaces.items.trash(id, gone);
    await ann.api.workspaces.share.set(id, doc, [{ email: unique() }], 'read');
    const entry = (await ann.api.workspaces.share.list(id, doc)).entries[0]?.id ?? '';
    const annId = (await ann.api.workspaces.people(id)).find((p) => p.isMe)?.id ?? '';
    const before = await itemsOf(ann.api, id);
    const w = rita.api.workspaces;
    expect(item(await itemsOf(rita.api, id), doc)?.role).toBe('read');

    const attempts: [string, () => Promise<unknown>][] = [
      ['rename', () => w.rename(id, 'x')], ['remove', () => w.remove(id)], ['addPerson', () => w.addPerson(id, unique(), 'read')], ['setRole', () => w.setRole(id, annId, 'read')], ['removePerson', () => w.removePerson(id, annId)],
      ['create', () => w.items.create(id, { kind: 'document', name: 'x' })], ['item rename', () => w.items.rename(id, doc, 'x')], ['folder rename', () => w.items.rename(id, folder, 'x')], ['board rename', () => w.items.rename(id, board, 'x')],
      ['move', () => w.items.move(id, doc, { parent: null })], ['duplicate', () => w.items.duplicate(id, doc)], ['trash', () => w.items.trash(id, doc)], ['restore', () => w.items.restore(id, gone)], ['deleteForever', () => w.items.deleteForever(id, gone)],
      ['share list', () => w.share.list(id, doc)], ['share', () => w.share.set(id, doc, [{ email: unique() }], 'read')], ['unshare', () => w.share.remove(id, doc, entry)], ['restrict', () => w.share.restrict(id, doc, true)]
    ];
    for (const [what, attempt] of attempts) expect(await code(attempt()), what).toBe('forbidden');
    expect(await itemsOf(ann.api, id)).toEqual(before);
    expect((await ann.api.workspaces.people(id)).map((p) => p.role)).toEqual(['admin', 'read']);

    // Given one document to edit, they can edit that one, and it's still not theirs to move.
    await ann.api.workspaces.share.set(id, board, [{ email: rita.email }], 'edit');
    await w.items.rename(id, board, 'Hers to rename');
    expect(item(await itemsOf(rita.api, id), board)?.role).toBe('edit');
    expect(await code(w.items.rename(id, doc, 'x'))).toBe('forbidden');
    expect(await code(w.items.move(id, board, { parent: folder }))).toBe('forbidden');
  });

  it('gives nobody the creator’s rule when something has no creator: restricted, it opens only for the people it’s shared with', async () => {
    const ann = await account();
    const theo = await account();
    const priya = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [priya, 'edit']]);
    const nobodys = await make(ann, id, 'board', 'Nobody’s');
    await ann.api.workspaces.share.set(id, nobodys, [{ email: theo.email }], 'read');
    await ann.api.workspaces.share.restrict(id, nobodys, true);
    await withNoCreator(id, nobodys);

    // Not even whoever it was made by, or an admin: only `document_access`.
    expect(await refusal(ann.api.workspaces.items.get(id, nobodys))).toEqual(await refusal(ann.api.workspaces.items.get(id, madeUp())));
    expect(named(await itemsOf(ann.api, id))).toEqual([]);
    expect(await code(priya.api.workspaces.items.get(id, nobodys))).toBe('not-found');
    expect(await theo.api.workspaces.items.get(id, nobodys)).toMatchObject({ name: 'Nobody’s', role: 'read', by: null, restricted: true });
    expect(await code(theo.api.workspaces.items.rename(id, nobodys, 'x'))).toBe('forbidden');

    // Not restricted, it's everyone's like anything else, with no creator to show.
    const open = await make(ann, id, 'document', 'Open');
    await withNoCreator(id, open);
    expect(item(await itemsOf(priya.api, id), open)).toMatchObject({ role: 'edit', by: null });
    // Whoever restricts it keeps it, with no creator to share that with.
    await priya.api.workspaces.share.restrict(id, open, true);
    expect(item(await itemsOf(priya.api, id), open)?.restricted).toBe(true);
    expect(await code(ann.api.workspaces.items.get(id, open))).toBe('not-found');
    // And a copy has a creator: whoever made it.
    const copy = await priya.api.workspaces.items.duplicate(id, open);
    expect((await priya.api.workspaces.items.get(id, copy.id)).by?.name).toBe(priya.name);
  });

  it('gives whoever restricts something nothing that outlives the restriction or their place in the workspace', async () => {
    const ann = await account();
    const priya = await account();
    const kofi = await account();
    const id = await workspace(ann, 'Ours', [[priya, 'edit'], [kofi, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const idOf = async (who: Account) => (await ann.api.workspaces.people(id)).find((p) => p.person.email === who.email)?.id ?? '';

    // Unrestricting takes back what restricting gave her: restricted again by its creator, it isn't hers.
    await priya.api.workspaces.share.restrict(id, doc, true);
    expect((await priya.api.workspaces.items.get(id, doc)).role).toBe('edit');
    await priya.api.workspaces.share.restrict(id, doc, false);
    await ann.api.workspaces.share.restrict(id, doc, true);
    expect(await code(priya.api.workspaces.items.get(id, doc))).toBe('not-found');
    await ann.api.workspaces.share.restrict(id, doc, false);

    // Taken out, she loses what restricting gave her, and coming back doesn't return it.
    await priya.api.workspaces.share.restrict(id, doc, true);
    await ann.api.workspaces.removePerson(id, await idOf(priya));
    expect(await code(priya.api.workspaces.get(id))).toBe('not-found');
    await ann.api.workspaces.addPerson(id, priya.email, 'edit');
    expect(await code(priya.api.workspaces.items.get(id, doc))).toBe('not-found');
    await ann.api.workspaces.share.restrict(id, doc, false);

    // A share made on purpose is another thing: it outlasts all of that, whoever restricted the document.
    await ann.api.workspaces.share.set(id, doc, [{ email: kofi.email }], 'read');
    await kofi.api.workspaces.share.restrict(id, doc, true);
    await kofi.api.workspaces.share.restrict(id, doc, false);
    expect((await ann.api.workspaces.share.list(id, doc)).entries.map((e) => [e.person.email, e.role])).toEqual([[kofi.email, 'read']]);
    await kofi.api.workspaces.share.restrict(id, doc, true);
    await ann.api.workspaces.removePerson(id, await idOf(kofi));
    expect((await kofi.api.workspaces.get(id)).items.map((i) => [i.id, i.role])).toEqual([[doc, 'read']]);
  });

  it('sends what only someone who left could open to Trash, for them to find if they come back; taken out, the admins get it', async () => {
    const ann = await account();
    const theo = await account();
    const kofi = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [kofi, 'edit']]);
    const alone = await make(theo, id, 'document', 'Only Theo’s');
    const shared = await make(theo, id, 'document', 'Shared with Kofi');
    const open = await make(theo, id, 'document', 'Everyone’s');
    await theo.api.workspaces.share.restrict(id, alone, true);
    await theo.api.workspaces.share.restrict(id, shared, true);
    await theo.api.workspaces.share.set(id, shared, [{ email: kofi.email }], 'edit');
    const leave = async (who: Account) => who.api.workspaces.removePerson(id, (await who.api.workspaces.people(id)).find((p) => p.isMe)?.id ?? '');

    await leave(theo);
    // Nobody here can see it, it's not deleted, and it isn't given to anyone: an admin can't open it any more than before.
    expect(named(await itemsOf(ann.api, id))).toEqual(['Everyone’s']);
    expect(await refusal(ann.api.workspaces.items.get(id, alone))).toEqual(await refusal(ann.api.workspaces.items.get(id, madeUp())));
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [alone])).toBe(1);
    // What someone can still open stays as it was.
    expect(item(await itemsOf(kofi.api, id), shared)).toMatchObject({ trashedAt: null, role: 'edit' });
    expect(item(await itemsOf(ann.api, id), open)?.trashedAt).toBeNull();

    // Back within 30 days, it's Theo's, in Trash, to restore.
    await ann.api.workspaces.addPerson(id, theo.email, 'edit');
    expect(await theo.api.workspaces.items.get(id, alone)).toMatchObject({ restricted: true, role: 'edit', trashedBy: null });
    expect((await theo.api.workspaces.items.get(id, alone)).trashedAt).not.toBeNull();
    await theo.api.workspaces.items.restore(id, alone);
    expect((await theo.api.workspaces.items.get(id, alone)).trashedAt).toBeNull();

    // Not back, it goes as anything in Trash does.
    await leave(theo);
    await maintain(h.deps, { trashAgeMs: 0 });
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [alone])).toBe(0);

    // Taking away the last entry of something with no creator left does the same.
    const last = (await kofi.api.workspaces.share.list(id, shared)).entries[0]?.id ?? '';
    await kofi.api.workspaces.share.remove(id, shared, last);
    expect(await code(kofi.api.workspaces.items.get(id, shared))).toBe('not-found');
    await maintain(h.deps, { trashAgeMs: 0 });
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [shared])).toBe(0);

    // Taken out by an admin, someone's words go to the admins, still restricted, and not to Trash: nobody changed that document.
    const kofis = await make(kofi, id, 'document', 'Only Kofi’s');
    await kofi.api.workspaces.share.restrict(id, kofis, true);
    await ann.api.workspaces.removePerson(id, (await ann.api.workspaces.people(id)).find((p) => p.person.email === kofi.email)?.id ?? '');
    expect(await ann.api.workspaces.items.get(id, kofis)).toMatchObject({ restricted: true, trashedAt: null, role: 'edit' });
    expect((await ann.api.workspaces.share.list(id, kofis)).entries.map((e) => [e.person.email, e.role])).toEqual([[ann.email, 'edit']]);
    expect(await code(kofi.api.workspaces.items.get(id, kofis))).toBe('not-found');
  });

  it('treats a board as a document: restricted, shared, duplicated and in Trash the same way', async () => {
    const ann = await account();
    const theo = await account();
    const sam = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const board = await make(ann, id, 'board', 'Sketch');
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [board])).toBe(1);
    await ann.api.workspaces.share.restrict(id, board, true);
    expect(await code(theo.api.workspaces.items.get(id, board))).toBe('not-found');
    await ann.api.workspaces.share.set(id, board, [{ email: sam.email }], 'read');
    expect((await sam.api.workspaces.get(id)).items.map((i) => [i.kind, i.name, i.restricted])).toEqual([['board', 'Sketch', true]]);
    const copy = await ann.api.workspaces.items.duplicate(id, board);
    expect(item(await itemsOf(ann.api, id), copy.id)).toMatchObject({ kind: 'board', name: 'Sketch copy', restricted: true });
    await ann.api.workspaces.items.trash(id, board);
    await ann.api.workspaces.items.deleteForever(id, board);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [board])).toBe(0);
    expect(await code(sam.api.workspaces.get(id))).toBe('not-found');
    // A folder is the one kind that can't be shared or restricted: it holds no content of its own.
    const folder = await make(ann, id, 'folder', 'Folder');
    expect(await code(ann.api.workspaces.share.restrict(id, folder, true))).toBe('not-found');
    expect(await code(ann.api.workspaces.share.set(id, folder, [{ email: sam.email }], 'read'))).toBe('not-found');
  });
});

describe('deleting an account', () => {
  it('leaves no member rows, deletes a workspace left empty, and hands the rest on', async () => {
    const leaver = await account();
    const stayer = await account();
    const later = await account();
    const alone = await workspace(leaver, 'Alone');
    const aloneOwner = await ownerOf(alone);
    await make(leaver, alone, 'document', 'Doc');
    const shared = await workspace(leaver, 'Shared', [[stayer, 'read'], [later, 'edit']]);
    const given = await workspace(stayer, 'Given');
    const doc = await make(stayer, given, 'document', 'Doc');
    await stayer.api.workspaces.share.set(given, doc, [{ email: leaver.email }], 'edit');
    const index = (await h.pool.query<{ email_index: Buffer }>('SELECT email_index FROM identities WHERE owner_id = $1', [leaver.ownerId])).rows[0]?.email_index;
    const live = stayer.api.workspaces.live(shared);
    await until(() => liveNames(live).length === 0 && live.getSnapshot().status === 'live', 'the stream');

    await leaver.api.account.delete();

    expect(await count('SELECT count(*)::int AS n FROM workspace_members WHERE email_index = $1', [index])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM document_access WHERE principal_index = $1', [index])).toBe(0);
    // Nobody left in it: nothing of it is left.
    for (const t of ['owners', 'workspaces', 'workspace_members', 'documents']) expect(await count(`SELECT count(*)::int AS n FROM ${t} WHERE owner_id = $1`, [aloneOwner]), t).toBe(0);
    // Its longest-standing person is its admin now, and streams hear of it.
    expect((await stayer.api.workspaces.people(shared)).map((p) => [p.person.email, p.role])).toEqual([[stayer.email, 'admin'], [later.email, 'edit']]);
    await until(() => treeOf(live)?.role === 'admin', 'the stream to say so');
    expect(treeOf(live)?.people).toBe(2);
  });

  it('takes a restricted document nobody else can reach with it, and leaves one it shared', async () => {
    const leaver = await account();
    const stayer = await account();
    const id = await workspace(stayer, 'Ours', [[leaver, 'edit']]);
    const lost = await make(leaver, id, 'document', 'Only theirs');
    const kept = await make(leaver, id, 'document', 'Shared on');
    const open = await make(leaver, id, 'document', 'Open');
    const trashed = await make(leaver, id, 'document', 'In Trash');
    for (const doc of [lost, kept, trashed]) await leaver.api.workspaces.share.restrict(id, doc, true);
    await leaver.api.workspaces.items.trash(id, trashed);
    await leaver.api.workspaces.share.set(id, kept, [{ email: stayer.email }], 'edit');
    const email = leaver.email;

    await leaver.api.account.delete();

    expect(named(await itemsOf(stayer.api, id))).toEqual(['Shared on', 'Open']);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = ANY($1)', [[lost, trashed]])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = ANY($1)', [[kept, open]])).toBe(2);
    // Signing in again starts a new account: nothing of the old one comes back with the address.
    const again = await account(email);
    expect(await again.api.workspaces.list()).toEqual([]);
    await stayer.api.workspaces.addPerson(id, email, 'edit');
    expect(await code(again.api.workspaces.items.get(id, kept))).toBe('not-found');
  });

  it('reaches every workspace the address still appears in, including ones the account already left', async () => {
    const bob = await account();
    const stays = await account();
    const id = await workspace(stays, 'Ours', [[bob, 'edit']]);
    const secret = await make(bob, id, 'document', 'Bob’s alone');
    const keep = await make(bob, id, 'document', 'Everyone’s');
    await bob.api.workspaces.share.restrict(id, secret, true);
    const restricted = await make(stays, id, 'document', 'Restricted by Bob');
    await bob.api.workspaces.share.restrict(id, restricted, true);
    const email = bob.email;
    const owner = await ownerOf(id);
    const stored = async () => {
      const o = await findOwner(h.deps, owner, undefined);
      const row = (await h.pool.query<{ state_ciphertext: Buffer }>('SELECT state_ciphertext FROM workspaces WHERE owner_id = $1', [owner])).rows[0];
      if (!o || !row) throw new Error('no such workspace');
      return JSON.stringify(openState(o, id, row.state_ciphertext));
    };
    expect(await stored()).toContain(email);

    // Bob leaves, and only later deletes his account: he's not a member of anything by then.
    await bob.api.workspaces.removePerson(id, (await bob.api.workspaces.people(id)).find((p) => p.isMe)?.id ?? '');
    await bob.api.account.delete();

    expect(await stored()).not.toContain(email);
    expect(await count('SELECT count(*)::int AS n FROM documents WHERE document_id = $1', [secret])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM workspace_authors WHERE owner_id = $1', [owner])).toBe(1);
    expect((await stays.api.workspaces.items.get(id, keep)).by?.name).toBe(bob.name);

    // Someone new at the address, added to the workspace, gets nothing of his back.
    const again = await account(email);
    await stays.api.workspaces.addPerson(id, email, 'edit');
    expect(named(await itemsOf(again.api, id))).toEqual(['Everyone’s']);
    expect(await code(again.api.workspaces.items.get(id, secret))).toBe('not-found');
    expect(await code(again.api.workspaces.items.get(id, restricted))).toBe('not-found');
  });

  it('takes every row of a deleted account’s calls under the workspace’s lock, so it can’t deadlock with a change', async () => {
    const org = await account();
    const member = await account();
    const id = await workspace(member, 'Ours');
    const doc = await make(member, id, 'document', 'Doc');
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    const owner = await ownerOf(id);
    await h.pool.query(`INSERT INTO document_access (owner_id, document_id, access_id, principal_index, kind, role, call_id, person_ciphertext) VALUES ($1,$2,$3,$4,'seat','read',$5,$6)`,
      [owner, doc, madeUp(), randomBytes(32), host.ticket.callId, Buffer.from('{}')]);
    // A change in progress: it holds the workspace's row, and is about to touch the seat's.
    const change = await h.pool.connect();
    try {
      await change.query('BEGIN');
      await change.query('SELECT 1 FROM workspaces WHERE owner_id = $1 FOR NO KEY UPDATE', [owner]);
      const pid = (await change.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
      const deleting = org.api.account.delete();
      await until(async () => (await count('SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])) > 0, 'the deletion to wait for the workspace');
      // Had the deletion taken the seat's row first, this would wait for it, and Postgres would abort one of them.
      expect((await change.query("UPDATE document_access SET role = 'edit' WHERE owner_id = $1 AND kind = 'seat'", [owner])).rowCount).toBe(1);
      await change.query('COMMIT');
      await deleting;
    } finally {
      change.release();
    }
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE owner_id = $1 AND kind = 'seat'", [owner])).toBe(0);
  });

  it('lets two people leave together, whichever workspace they’re both in', async () => {
    const one = await account();
    const two = await account();
    const stays = await account();
    const first = await workspace(one, 'First', [[two, 'edit'], [stays, 'edit']]);
    const second = await workspace(two, 'Second', [[one, 'edit'], [stays, 'edit']]);
    const onlyThem = await workspace(one, 'Only them', [[two, 'admin']]);
    const owner = await ownerOf(onlyThem);
    await Promise.all([one.api.account.delete(), two.api.account.delete()]);
    // The Drive lists the newest first.
    expect((await stays.api.workspaces.list()).map((w) => [w.name, w.role, w.people])).toEqual([['Second', 'admin', 1], ['First', 'admin', 1]]);
    expect([first, second].every(Boolean)).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM owners WHERE owner_id = $1', [owner])).toBe(0);
  });

  it('leaves a workspace alone while another account still signs in with the address', async () => {
    const email = unique('twice');
    const first = await withGoogle(email, `sub-a-${seq++}`);
    const second = await withGoogle(email, `sub-b-${seq++}`);
    expect(first.ownerId).not.toBe(second.ownerId);
    const id = await workspace(first, 'Ours');
    await first.api.account.delete();
    expect((await second.api.workspaces.get(id)).role).toBe('admin');
  });
});

describe('limits', () => {
  /** As if an account had made this many workspaces: making a hundred the real way is more than a minute's allowance. */
  async function madeAlready(who: Account, n: number) {
    const index = (await h.pool.query<{ email_index: Buffer }>('SELECT email_index FROM identities WHERE owner_id = $1', [who.ownerId])).rows[0]?.email_index;
    const owners = Array.from({ length: n }, () => randomBytes(32).toString('base64url'));
    for (const owner of owners) {
      await h.pool.query("INSERT INTO owners (owner_id, root_envelope, root_check) VALUES ($1, '\\x00', '\\x00')", [owner]);
      await h.pool.query("INSERT INTO workspaces (owner_id, workspace_id, state_ciphertext) VALUES ($1, $2, '\\x00')", [owner, madeUp()]);
      await h.pool.query('INSERT INTO workspace_authors (owner_id, email_index, made_workspace) VALUES ($1, $2, true)', [owner, index]);
    }
    return () => h.pool.query('DELETE FROM owners WHERE owner_id = ANY($1)', [owners]);
  }

  it('lets an account make a hundred workspaces, and tells it plainly when that’s all', async () => {
    const ann = await account();
    const clear = await madeAlready(ann, 99);
    const last = await ann.api.workspaces.create('The hundredth');
    expect(await refusal(ann.api.workspaces.create('One more'))).toMatchObject({ code: 'conflict', message: 'You’ve made as many workspaces as you can. Delete one first.' });
    // Leaving one doesn't make room, because it was still made; deleting one does.
    const theo = await account();
    await ann.api.workspaces.addPerson(last.id, theo.email, 'admin');
    await ann.api.workspaces.removePerson(last.id, (await ann.api.workspaces.people(last.id)).find((p) => p.isMe)?.id ?? '');
    expect(await code(ann.api.workspaces.create('Still no'))).toBe('conflict');
    await theo.api.workspaces.remove(last.id);
    expect((await ann.api.workspaces.create('Room again')).id).toBeTruthy();
    await clear();
  });

  it('makes at most 20 workspaces a minute for an account, and reads its list at most 120 times', async () => {
    const ann = await account();
    for (let i = 0; i < 20; i++) await ann.api.workspaces.create(`Workspace ${i}`);
    expect(await refusal(ann.api.workspaces.create('Too quick'))).toMatchObject({ code: 'unavailable', message: 'Too many attempts. Wait a minute and try again.' });
    const theo = await account();
    await theo.api.workspaces.create('Theo’s own');
    for (let i = 0; i < 120; i++) await theo.api.workspaces.list();
    expect(await code(theo.api.workspaces.list())).toBe('unavailable');
    expect(await ann.api.workspaces.list()).toHaveLength(20);
  });

  it('shares a document with 500 people and no more, counting only who’s new', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const doc = await make(ann, id, 'document', 'Doc');
    const emails: string[] = [];
    for (let batch = 0; batch < 5; batch++) {
      const to = Array.from({ length: 100 }, (_, i) => `person.${batch}.${i}.${seq}@tests.example`);
      emails.push(...to);
      await ann.api.workspaces.share.set(id, doc, to.map((email) => ({ email })), 'read');
    }
    expect((await ann.api.workspaces.share.list(id, doc)).entries).toHaveLength(500);
    expect(await refusal(ann.api.workspaces.share.set(id, doc, [{ email: unique() }], 'read'))).toMatchObject({ code: 'conflict', message: 'This is shared with as many people as it can be. Take someone off first.' });
    // All of them or none, and someone who has it isn't someone new.
    expect(await code(ann.api.workspaces.share.set(id, doc, [{ email: emails[0] ?? '' }, { email: unique() }], 'edit'))).toBe('conflict');
    expect((await ann.api.workspaces.share.list(id, doc)).entries.filter((e) => e.role === 'edit')).toEqual([]);
    await ann.api.workspaces.share.set(id, doc, [{ email: emails[0] ?? '' }], 'edit');
    expect((await ann.api.workspaces.share.list(id, doc)).entries.filter((e) => e.role === 'edit')).toHaveLength(1);
  });

  it('takes 1,000 people in a workspace and no more, and still changes those who are in it', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const owner = await ownerOf(id);
    await ann.api.workspaces.addPerson(id, 'kept@tests.example', 'read');
    const ids = Array.from({ length: 998 }, () => madeUp());
    await h.pool.query(`INSERT INTO workspace_members (owner_id, member_id, email_index, role, person_ciphertext) SELECT $1, m, digest_of, 'read', '\\x00'
      FROM unnest($2::text[], $3::bytea[]) AS t(m, digest_of)`, [owner, ids, ids.map(() => randomBytes(32))]);
    expect(await refusal(ann.api.workspaces.addPerson(id, unique(), 'read'))).toMatchObject({ code: 'conflict', message: 'This workspace has as many people as it can. Take someone out first.' });
    expect(await code(ann.api.workspaces.addPerson(id, 'kept@tests.example', 'edit'))).toBe('allowed');
  });
});

describe('a new address from the provider', () => {
  it('takes everything the account had with it: its place, what it was given, what it made and what it restricted', async () => {
    const old = unique('old');
    const fresh = unique('fresh');
    const sub = `sub-${seq++}`;
    const moved = await withGoogle(old, sub);
    const ann = await account();
    const id = await workspace(ann, 'Ours', [[moved, 'edit']]);
    const made = await make(moved, id, 'document', 'Restricted by its maker');
    await moved.api.workspaces.share.restrict(id, made, true);
    const annsDoc = await make(ann, id, 'document', 'Restricted by them');
    await moved.api.workspaces.share.restrict(id, annsDoc, true);
    const elsewhere = await workspace(ann, 'Elsewhere');
    const given = await make(ann, elsewhere, 'document', 'Given');
    await ann.api.workspaces.share.set(elsewhere, given, [{ email: old }], 'edit');
    const live = moved.api.workspaces.live(id);
    await until(() => liveNames(live).length === 2, 'the stream');
    const tagged = await make(ann, id, 'document', 'Tagged in');
    await ann.api.workspaces.mention(id, tagged, { to: { email: old }, block: null });

    const after = await withGoogle(fresh, sub);
    expect(after.ownerId).toBe(moved.ownerId);
    // What was waiting for them still is.
    expect((await after.api.workspaces.mentions()).map((m) => m.document)).toEqual([tagged]);

    expect((await after.api.workspaces.get(id)).role).toBe('edit');
    expect((await after.api.workspaces.items.get(id, made)).role).toBe('edit');
    expect((await after.api.workspaces.items.get(id, annsDoc)).role).toBe('edit');
    expect((await after.api.workspaces.items.get(elsewhere, given)).role).toBe('edit');
    expect((await ann.api.workspaces.people(id)).map((p) => p.person.email)).toEqual([ann.email, fresh]);
    expect((await ann.api.workspaces.share.list(elsewhere, given)).entries.map((e) => e.person.email)).toEqual([fresh]);
    // Their stream carries on: losing an old address isn't losing the workspace.
    await ann.api.workspaces.rename(id, 'Still here');
    await until(() => treeOf(live)?.name === 'Still here', 'the stream to carry on under the new address');
    expect(live.getSnapshot().status).toBe('live');
    // Deleting the account finds all of it under the new address.
    const again = await account(old);
    expect(await again.api.workspaces.list()).toEqual([]);
    expect(await count('SELECT count(*)::int AS n FROM workspace_members m JOIN identities i ON i.email_index = m.email_index WHERE i.owner_id = $1', [again.ownerId])).toBe(0);
  });

  it('keeps the stronger role when the new address is already in the workspace, and the stronger of two shares', async () => {
    const old = unique('old');
    const fresh = unique('fresh');
    const sub = `sub-${seq++}`;
    const moved = await withGoogle(old, sub);
    const ann = await account();
    const up = await workspace(ann, 'Goes up');
    await ann.api.workspaces.addPerson(up, old, 'read');
    await ann.api.workspaces.addPerson(up, fresh, 'admin');
    const stays = await workspace(ann, 'Stays');
    await ann.api.workspaces.addPerson(stays, old, 'admin');
    await ann.api.workspaces.addPerson(stays, fresh, 'read');
    const doc = await make(ann, up, 'document', 'Doc');
    await ann.api.workspaces.share.restrict(up, doc, true);
    await ann.api.workspaces.share.set(up, doc, [{ email: old }], 'edit');
    await ann.api.workspaces.share.set(up, doc, [{ email: fresh }], 'read');

    const after = await withGoogle(fresh, sub);
    expect(after.ownerId).toBe(moved.ownerId);
    expect(await after.api.workspaces.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: up, role: 'admin', people: 2 }), expect.objectContaining({ id: stays, role: 'admin', people: 2 })]));
    expect((await ann.api.workspaces.people(up)).filter((p) => p.person.email === fresh)).toHaveLength(1);
    expect((await ann.api.workspaces.share.list(up, doc)).entries.map((e) => [e.person.email, e.role])).toEqual([[fresh, 'edit']]);
  });

  it('leaves what the old address has while another account still signs in with it', async () => {
    const shared = unique('shared');
    const fresh = unique('fresh');
    const sub = `sub-${seq++}`;
    const leaving = await withGoogle(shared, sub);
    const staying = await withGoogle(shared, `sub-${seq++}`);
    expect(leaving.ownerId).not.toBe(staying.ownerId);
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    await ann.api.workspaces.addPerson(id, shared, 'edit');
    const after = await withGoogle(fresh, sub);
    expect(await after.api.workspaces.list()).toEqual([]);
    expect((await staying.api.workspaces.get(id)).role).toBe('edit');
  });
});

describe('the live stream', () => {
  it('shows each reader their own tree, whole, as it changes, and ends when they lose it', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'document', 'Doc');
    const live = theo.api.workspaces.live(id);
    expect(live.getSnapshot()).toEqual({ status: 'connecting', tree: null, here: [], mentions: [] });
    await until(() => live.getSnapshot().status === 'live', 'the first line');
    expect(liveNames(live)).toEqual(['Doc']);
    let heard = 0;
    const off = live.subscribe(() => { heard++; });

    await ann.api.workspaces.items.rename(id, doc, 'Renamed');
    await until(() => liveNames(live)[0] === 'Renamed', 'the rename');
    const folder = await make(ann, id, 'folder', 'Folder');
    await until(() => liveNames(live).includes('Folder'), 'the new folder');
    await ann.api.workspaces.items.move(id, doc, { parent: folder });
    await until(() => treeOf(live)?.items.find((i) => i.id === doc)?.parent === folder, 'the move');
    await ann.api.workspaces.rename(id, 'New name');
    await until(() => treeOf(live)?.name === 'New name', 'the workspace’s new name');
    expect(heard).toBeGreaterThanOrEqual(4);
    off();

    // Restricted, it goes from their stream at once; the stream itself carries on.
    await ann.api.workspaces.share.restrict(id, doc, true);
    await until(() => liveNames(live).join() === 'Folder', 'the restricted document to leave the stream');
    expect(live.getSnapshot().status).toBe('live');

    const me = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email)?.id ?? '';
    await ann.api.workspaces.removePerson(id, me);
    await until(() => live.getSnapshot().status === 'closed', 'being taken out to end the stream');
    expect(live.getSnapshot()).toEqual({ status: 'closed', tree: null, here: [], mentions: [] });
    live.close();
  });

  it('says a role changed before the tree that shows it, and ends with a closed line and no more', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const s = stream(h.baseUrl, theo.fetch, id);
    await until(() => s.lines.length === 2, 'the first tree and unread snapshot');
    expect(s.status).toBe(200);
    expect(s.lines.map((line) => line.type)).toEqual(['tree', 'mentions']);
    expect(s.lines[1]).toEqual({ type: 'mentions', mentions: [] });
    const [first] = s.lines;
    if (first?.type !== 'tree') throw new Error('the first line isn’t the tree');
    expect(first.tree).toEqual({ id, name: 'Ours', role: 'read', inCall: false, people: 2, items: [] });

    const me = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email)?.id ?? '';
    await ann.api.workspaces.setRole(id, me, 'edit');
    await until(() => s.lines.length >= 4, 'the role’s lines');
    expect(s.lines.slice(2).map((l) => l.type)).toEqual(['access', 'tree']);
    expect(s.lines[2]).toEqual({ type: 'access', role: 'edit' });

    // Changes that make no difference to this reader send nothing.
    const before = s.lines.length;
    const hidden = await make(ann, id, 'document', 'Hidden');
    await until(() => s.lines.length === before + 1, 'the new document');
    await ann.api.workspaces.share.restrict(id, hidden, true);
    await until(() => s.lines.length === before + 2, 'the document leaving');
    await ann.api.workspaces.items.rename(id, hidden, 'CANARY-NOT-FOR-THEO');
    await ann.api.workspaces.rename(id, 'Marker');
    await until(() => s.lines.at(-1)?.type === 'tree' && JSON.stringify(s.lines.at(-1)).includes('Marker'), 'a later change');
    expect(s.lines.length).toBe(before + 3);
    expect(JSON.stringify(s.lines)).not.toContain('CANARY-NOT-FOR-THEO');

    await ann.api.workspaces.removePerson(id, me);
    await until(() => s.ended, 'the stream to end');
    expect(s.lines.at(-1)).toEqual({ type: 'closed' });
    expect(s.lines.filter((l) => l.type === 'closed')).toHaveLength(1);
  });

  it('refuses a stream exactly as it refuses anything else: not-found for a real ID and a made-up one', async () => {
    const ann = await account();
    const sam = await account();
    const id = await workspace(ann, 'Ours');
    const real = await sam.fetch(`${h.baseUrl}/v1/workspaces/${id}/live`);
    const fake = await sam.fetch(`${h.baseUrl}/v1/workspaces/${madeUp()}/live`);
    expect([real.status, fake.status]).toEqual([404, 404]);
    const body = async (r: Response) => { const { requestId: _, ...rest } = await r.json(); return rest; };
    expect(await body(real)).toEqual(await body(fake));
    const live = sam.api.workspaces.live(id);
    await until(() => live.getSnapshot().status === 'closed', 'the stream to give up');
  });

  it('ends for someone given one document when it’s taken back, restricted away or goes for good', async () => {
    const ann = await account();
    const sam = await account();
    const rita = await account();
    const id = await workspace(ann, 'Ours');
    const first = await make(ann, id, 'document', 'First');
    const second = await make(ann, id, 'document', 'Second');
    await ann.api.workspaces.share.set(id, first, [{ email: sam.email }, { email: rita.email }], 'read');
    await ann.api.workspaces.share.set(id, second, [{ email: sam.email }], 'read');
    const samLive = sam.api.workspaces.live(id);
    const ritaLive = rita.api.workspaces.live(id);
    await until(() => liveNames(samLive).length === 2 && liveNames(ritaLive).length === 1, 'both streams');

    // One of two taken back leaves the other; going to Trash takes nothing away.
    const share = await ann.api.workspaces.share.list(id, second);
    await ann.api.workspaces.share.remove(id, second, share.entries[0]?.id ?? '');
    await until(() => liveNames(samLive).join() === 'First', 'the document to go');
    expect(samLive.getSnapshot().status).toBe('live');
    await ann.api.workspaces.items.trash(id, first);
    await until(() => treeOf(ritaLive)?.items[0]?.trashedAt !== null, 'Trash to show');
    expect(ritaLive.getSnapshot().status).toBe('live');

    // Gone for good, it's gone from every stream it was all of.
    await ann.api.workspaces.items.deleteForever(id, first);
    await until(() => samLive.getSnapshot().status === 'closed' && ritaLive.getSnapshot().status === 'closed', 'both streams to end');
    expect(samLive.getSnapshot().tree).toBeNull();
  });

  it('ends for everyone when the workspace is deleted', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const lives = [ann.api.workspaces.live(id), theo.api.workspaces.live(id)];
    await until(() => lives.every((l) => l.getSnapshot().status === 'live'), 'both streams');
    await ann.api.workspaces.remove(id);
    await until(() => lives.every((l) => l.getSnapshot().status === 'closed'), 'both streams to end');
  });

  it('reads one change once for every stream on an instance, however many are open', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const lives = [ann.api.workspaces.live(id), ann.api.workspaces.live(id), theo.api.workspaces.live(id), theo.api.workspaces.live(id)];
    await until(() => lives.every((l) => l.getSnapshot().status === 'live'), 'the streams');
    // Each stream looks once as it opens: let those finish, so what's counted is the change.
    await new Promise((r) => setTimeout(r, 200));
    const from = h.logs.length;
    await ann.api.workspaces.rename(id, 'Once');
    await until(() => lives.every((l) => treeOf(l)?.name === 'Once'), 'every stream to hear');
    const reads = h.logs.slice(from).filter((l) => l.includes('SELECT state_ciphertext, owner_id, version FROM workspaces'));
    expect(reads).toHaveLength(1);
  });

  it('costs next to nothing while idle: a ping reads no workspace, however many streams are open', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer({ LIVE_PING_MS: 60 });
    const streams = Array.from({ length: 6 }, () => stream(second.baseUrl, ann.fetch, id));
    const pings = () => Math.min(...streams.map((s) => s.lines.filter((l) => l.type === 'ping').length));
    try {
      await until(() => pings() >= 2, 'every stream to ping');
      const from = h.logs.length;
      const before = pings();
      await until(() => pings() >= before + 4, 'more pings');
      const lines = h.logs.slice(from);
      // Each ping asks only whether the session is there. No key is opened, and nothing of the workspace is read, sealed or not.
      expect(lines.filter((l) => l.includes('FROM sessions')).length).toBeGreaterThanOrEqual(6 * 4);
      for (const read of ['FROM workspaces', 'root_envelope', 'FROM workspace_members', 'FROM document_access', 'FROM items']) expect(lines.filter((l) => l.includes(read)), read).toEqual([]);
      // A change still reaches all of them, from one read.
      const at = h.logs.length;
      await ann.api.workspaces.rename(id, 'Changed');
      await until(() => streams.every((s) => s.lines.some((l) => l.type === 'tree' && l.tree.name === 'Changed')), 'every stream to hear');
      expect(h.logs.slice(at).filter((l) => l.includes('SELECT state_ciphertext, owner_id, version FROM workspaces'))).toHaveLength(1);
      // Someone else opening it finds nobody behind, so that's one small query, and nothing for anyone else to render.
      const opened = h.logs.length;
      const before2 = streams.map((s) => s.lines.filter((l) => l.type === 'tree').length);
      const late = stream(second.baseUrl, ann.fetch, id);
      await until(() => late.lines.length > 0, 'the new stream');
      await new Promise((r) => setTimeout(r, 150));
      expect(h.logs.slice(opened).filter((l) => l.includes('SELECT state_ciphertext, owner_id, version FROM workspaces'))).toEqual([]);
      expect(streams.map((s) => s.lines.filter((l) => l.type === 'tree').length)).toEqual(before2);
      late.stop();
    } finally {
      for (const s of streams) s.stop();
      await second.close();
    }
  });

  it('holds eight streams for a person on an instance, refuses the next plainly, and lets it in when one goes', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const eight = Array.from({ length: 8 }, () => stream(h.baseUrl, ann.fetch, id));
    await until(() => eight.every((s) => s.lines.length > 0), 'eight streams');
    const refused = await ann.fetch(`${h.baseUrl}/v1/workspaces/${id}/live`);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: 'unavailable', message: 'You have this open in too many windows. Close one and it will carry on here.' });
    // It says nothing about what exists: the same for a workspace that isn't there.
    expect((await ann.fetch(`${h.baseUrl}/v1/workspaces/${madeUp()}/live`)).status).toBe(503);
    // Nobody's working stream was touched, and nobody else is held up.
    await ann.api.workspaces.rename(id, 'Still going');
    await until(() => eight.every((s) => s.lines.some((l) => l.type === 'tree' && l.tree.name === 'Still going')), 'all eight to carry on');
    const other = stream(h.baseUrl, theo.fetch, id);
    await until(() => other.lines.length > 0, 'someone else’s stream');
    other.stop();
    // Each instance counts its own.
    const second = await h.secondServer();
    const there = stream(second.baseUrl, ann.fetch, id);
    await until(() => there.lines.length > 0, 'a stream on the other instance');
    there.stop();
    await second.close();
    // A browser refused goes on trying, and gets in when a window closes.
    const ninth = ann.api.workspaces.live(id);
    await until(() => ninth.getSnapshot().status === 'reconnecting', 'the ninth to wait');
    eight[0]?.stop();
    await until(() => ninth.getSnapshot().status === 'live', 'the ninth to get in');
    expect(ninth.getSnapshot().tree?.name).toBe('Still going');
    for (const s of eight) s.stop();
    // A refused or failed open takes no place: all eight come back.
    await until(async () => {
      const r = await ann.fetch(`${h.baseUrl}/v1/workspaces/${madeUp()}/live`);
      return r.status === 404;
    }, 'places to come back');
  });

  it('keeps its clock on a busy workspace: an ended session ends it, and so does its time, whatever else is going on', async () => {
    const ann = await account();
    const theo = await account();
    const sam = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read'], [sam, 'read']]);
    await fill(id, ann, 4000);
    // A browser slower than what's changing, on a tree big enough to feel it: there's always another change waiting when the stream looks.
    const second = await h.secondServer({ LIVE_PING_MS: 2000 });
    const letGo = await h.secondServer({ LIVE_PING_MS: 2000, LIVE_STREAM_MS: 2500 });
    const session = stream(second.baseUrl, theo.fetch, id, undefined, 25);
    const timed = stream(letGo.baseUrl, sam.fetch, id, undefined, 25);
    let busy = true;
    const writers = [0, 1].map(async (w) => { for (let i = 0; busy; i++) await ann.api.workspaces.rename(id, `Busy ${w} ${i}`); });
    try {
      await until(() => session.lines.length > 1, 'the stream to be busy');
      await theo.api.auth.signOut();
      await until(() => session.ended, 'the session ending to end the stream', 8000);
      await until(() => timed.ended, 'its time to end the other', 8000);
      expect(timed.lines.some((l) => l.type === 'closed')).toBe(false);
    } finally {
      busy = false;
      await Promise.all(writers);
      session.stop();
      timed.stop();
      await second.close();
      await letGo.close();
    }
  });

  it('crosses from one API instance to another, both ways', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const second = await h.secondServer();
    const there = createHttpApi({ baseUrl: second.baseUrl, fetch: theo.fetch });
    const thereAnn = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
    const onSecond = there.workspaces.live(id);
    const onFirst = ann.api.workspaces.live(id);
    try {
      await until(() => onSecond.getSnapshot().status === 'live' && onFirst.getSnapshot().status === 'live', 'a stream on each instance');
      await ann.api.workspaces.items.create(id, { kind: 'document', name: 'From the first' });
      await until(() => liveNames(onSecond).includes('From the first'), 'the second instance to hear the first');
      await thereAnn.workspaces.items.create(id, { kind: 'folder', name: 'From the second' });
      await until(() => liveNames(onFirst).includes('From the second'), 'the first instance to hear the second');
      // Losing access on one ends a stream on the other.
      const me = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email)?.id ?? '';
      await ann.api.workspaces.removePerson(id, me);
      await until(() => onSecond.getSnapshot().status === 'closed', 'the stream on the other instance to end');
    } finally {
      onSecond.close();
      onFirst.close();
      await second.close();
    }
  });

  it('catches up when its connection to the database drops, and misses nothing said meanwhile', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const live = ann.api.workspaces.live(id);
    await until(() => live.getSnapshot().status === 'live', 'the stream');
    const listeners = () => count("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'alcove-hub'");
    await until(async () => (await listeners()) === 1, 'one listening connection');
    await h.pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'alcove-hub'");
    // Said while nobody may be listening.
    await ann.api.workspaces.items.create(id, { kind: 'document', name: 'Meanwhile' });
    await until(() => liveNames(live).includes('Meanwhile'), 'the stream to catch up');
    await until(async () => (await listeners()) === 1, 'the hub to listen again');
    await ann.api.workspaces.items.create(id, { kind: 'document', name: 'After' });
    await until(() => liveNames(live).includes('After'), 'the stream to carry on');
    expect(live.getSnapshot().status).toBe('live');
  });

  it('notices a connection to the database that goes quiet without closing, and misses nothing said meanwhile', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const db = new URL(process.env['TEST_DATABASE_URL'] ?? '');
    // A way to Postgres that can stop passing anything on while staying open, as a dropped route does: not even a goodbye gets through.
    const links: { quiet: boolean; end: () => void }[] = [];
    const proxy = createServer({ allowHalfOpen: true }, (near) => {
      const far = connect({ port: Number(db.port), host: db.hostname, allowHalfOpen: true });
      const end = () => { near.destroy(); far.destroy(); };
      const link = { quiet: false, end };
      links.push(link);
      near.on('data', (bytes) => { if (!link.quiet) far.write(bytes); });
      far.on('data', (bytes) => { if (!link.quiet) near.write(bytes); });
      near.on('end', () => { if (!link.quiet) far.end(); });
      far.on('end', () => { if (!link.quiet) near.end(); });
      for (const side of [near, far]) { side.on('close', end); side.on('error', end); }
    });
    await new Promise<void>((r) => { proxy.listen(0, '127.0.0.1', () => r()); });
    const address = proxy.address();
    const port = address && typeof address === 'object' ? (address satisfies AddressInfo).port : 0;
    const hubUrl = `postgres://${db.username}:${db.password}@127.0.0.1:${port}${db.pathname}`;
    const second = await h.secondServer({ HUB_CHECK_MS: 50, HUB_TIMEOUT_MS: 100 }, undefined, undefined, hubUrl);
    const there = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
    const live = there.workspaces.live(id);
    try {
      await until(() => live.getSnapshot().status === 'live' && links.length === 1, 'a stream through the proxy');
      await ann.api.workspaces.items.create(id, { kind: 'document', name: 'Before' });
      await until(() => liveNames(live).includes('Before'), 'a change to arrive');

      const [first] = links;
      if (first) first.quiet = true;
      await ann.api.workspaces.items.create(id, { kind: 'document', name: 'Said into the silence' });
      await until(() => liveNames(live).includes('Said into the silence'), 'the hub to notice and catch up');
      expect(links.length).toBeGreaterThanOrEqual(2);
      expect(live.getSnapshot().status).toBe('live');
      await ann.api.workspaces.items.create(id, { kind: 'document', name: 'After' });
      await until(() => liveNames(live).includes('After'), 'the stream to carry on');

      // And shutting down doesn't wait on a connection that won't answer.
      for (const link of links) link.quiet = true;
      live.close();
      const t0 = Date.now();
      await second.close();
      expect(Date.now() - t0).toBeLessThan(3000);
    } finally {
      live.close();
      for (const link of links) link.end();
      proxy.close();
    }
  });

  it('checks who’s reading each time it pings, so an ended session ends the stream', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'read']]);
    const second = await h.secondServer({ LIVE_PING_MS: 100 });
    const s = stream(second.baseUrl, theo.fetch, id);
    try {
      await until(() => s.lines.filter((l) => l.type === 'ping').length >= 2, 'pings');
      await theo.api.auth.signOut();
      await until(() => s.ended, 'the stream to end');
      expect(s.lines.at(-1)).toEqual({ type: 'closed' });
    } finally {
      s.stop();
      await second.close();
    }
  });

  it('lets go of a stream when its browser goes, even in the moment it was opening', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    const second = await h.secondServer({ LIVE_PING_MS: 200 });
    const lines = (msg: string) => h.logs.filter((l) => l.includes(msg) && l.includes(id)).length;
    try {
      // A browser that's gone by the time the stream can answer is never read from.
      for (let wait = 0; wait < 12; wait++) {
        const stop = new AbortController();
        const opening = ann.fetch(`${second.baseUrl}/v1/workspaces/${id}/live`, { signal: stop.signal }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, wait));
        stop.abort();
        await opening;
      }
      await until(() => lines('stream opened') > 0 && lines('stream opened') === lines('stream ended'), 'every stream to end');
    } finally {
      await second.close();
    }
  });

  it('picks up again by itself when a stream is cut, whoever cut it, without saying it’s gone', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    // Cloud Run ends every request after a while: the API lets go first, and the browser opens it again.
    const second = await h.secondServer({ LIVE_STREAM_MS: 150 });
    const there = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
    const live = there.workspaces.live(id);
    const seen = new Set<string>();
    live.subscribe(() => seen.add(live.getSnapshot().status));
    try {
      await until(() => live.getSnapshot().status === 'live', 'the stream');
      await new Promise((r) => setTimeout(r, 500));
      await ann.api.workspaces.items.create(id, { kind: 'document', name: 'Through it' });
      await until(() => liveNames(live).includes('Through it'), 'the stream to carry on');
      expect([...seen]).toEqual(['live']);
    } finally {
      live.close();
      await second.close();
    }
  });

  it('notices a connection that went quiet without closing, and opens it again', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    let held = 0;
    // The first stream connects and then nothing arrives: no lines and no end, as a network that silently dropped it.
    const stalls: typeof fetch = (input, init) => {
      if (String(input).endsWith('/live') && held++ === 0) {
        const silent = new ReadableStream<Uint8Array>({ start(c) { init?.signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError'))); } });
        return Promise.resolve(new Response(silent, { status: 200 }));
      }
      return ann.fetch(input, init);
    };
    const quiet = createHttpApi({ baseUrl: h.baseUrl, fetch: stalls, liveQuietMs: 100 });
    const live = quiet.workspaces.live(id);
    try {
      await until(() => live.getSnapshot().status === 'live', 'the second connection');
      expect(held).toBeGreaterThanOrEqual(2);
    } finally {
      live.close();
    }
  });

  it('closes with its server: nothing hangs, and browsers wait for it to come back with what they had', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Ours');
    await make(ann, id, 'document', 'Doc');
    const second = await h.secondServer();
    const there = createHttpApi({ baseUrl: second.baseUrl, fetch: ann.fetch });
    const live = there.workspaces.live(id);
    const raw = stream(second.baseUrl, ann.fetch, id);
    await until(() => live.getSnapshot().status === 'live' && raw.lines.length > 0, 'the streams');
    const t0 = Date.now();
    await second.close();
    expect(Date.now() - t0).toBeLessThan(3000);
    await until(() => raw.ended, 'the stream to end');
    // It ended, and nobody lost anything: no closed line, so the browser tries again.
    expect(raw.lines.some((l) => l.type === 'closed')).toBe(false);
    await until(() => live.getSnapshot().status === 'reconnecting', 'the browser to wait');
    expect(liveNames(live)).toEqual(['Doc']);
    live.close();
    expect(live.getSnapshot().status).toBe('closed');
  });
});

describe('guests in a call', () => {
  async function waitFor(pred: () => boolean, what: string) { await until(pred, what); }
  const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
  async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
    for (let i = 0; i < 200 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
    return call.getSnapshot();
  }
  /** A call `org` is in, and `guests` joining by its link and let in. */
  async function callWith(org: Account, guests: string[]) {
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    await inGroup(host);
    const joined: { api: AlcoveApi; call: CallSession; pass: string; seat: string }[] = [];
    for (const name of guests) {
      const b = h.browser();
      const call = await b.api.calls.join(c, { mic: false, cam: false, name });
      await settle(host, (s) => s.waiting.some((w) => w.id === call.ticket.identity));
      await host.admit(call.ticket.identity);
      await inGroup(call);
      const seat = (await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity))).participants.find((p) => p.id === call.ticket.identity)?.seat ?? '';
      joined.push({ api: b.api, call, pass: call.ticket.pass, seat });
    }
    return { code: c, host, guests: joined };
  }

  it('get nothing from joining a call, and what they’re given with their call pass, alone, until it ends', async () => {
    const org = await account();
    const id = await workspace(org, 'CANARY-SPACE-NAME');
    const folder = await make(org, id, 'folder', 'CANARY-FOLDER-NAME');
    const doc = await make(org, id, 'document', 'Agenda', folder);
    const other = await make(org, id, 'document', 'CANARY-OTHER-NAME');
    const { host, guests } = await callWith(org, ['Sam Guest', 'Jo Guest']);
    const [sam, jo] = guests;
    if (!sam || !jo) throw new Error('nobody joined');
    const w = sam.api.workspaces;
    const opts = { pass: sam.pass };

    // Joining a call gives nothing: the same as for a workspace that doesn't exist, and nothing at all without the pass.
    expect(await refusal(w.get(id, opts))).toEqual(await refusal(w.get(madeUp(), opts)));
    expect((await refusal(w.get(id, opts)))?.code).toBe('not-found');
    expect(await code(w.get(id))).toBe('unauthenticated');
    // Sharing with a seat takes being in that call, and someone who's in it.
    expect(await code(org.api.workspaces.share.set(id, doc, [{ seat: sam.seat }], 'read'))).toBe('invalid');
    expect(await code(org.api.workspaces.share.set(id, doc, [{ seat: 'nobody-in-this-call' }], 'read', { pass: host.ticket.pass }))).toBe('not-found');
    expect((await org.api.workspaces.share.list(id, doc)).entries).toEqual([]);

    // Many people at once, all of them or none.
    const friend = await account();
    expect(await code(org.api.workspaces.share.set(id, doc, [{ seat: sam.seat }, { email: friend.email }, { seat: 'nobody-in-this-call' }], 'read', { pass: host.ticket.pass }))).toBe('not-found');
    expect((await org.api.workspaces.share.list(id, doc)).entries).toEqual([]);
    await org.api.workspaces.share.set(id, doc, [{ seat: sam.seat }, { seat: jo.seat }, { email: friend.email }], 'read', { pass: host.ticket.pass });
    const entries = (await org.api.workspaces.share.list(id, doc)).entries;
    expect(entries.map((e) => [e.kind, e.person.name, e.person.email, e.role]).sort()).toEqual([
      ['email', friend.email, friend.email, 'read'], ['seat', 'Jo Guest', '', 'read'], ['seat', 'Sam Guest', '', 'read']
    ].sort());

    // A guest's name is sealed beside their seat's keyed hash, and neither their name nor who's in which seat is in a log.
    const stored = (await h.pool.query<{ t: string }>('SELECT row_to_json(x)::text AS t FROM document_access x WHERE document_id = $1', [doc])).rows.map((r) => r.t).join(' ');
    for (const enc of ['Sam Guest', Buffer.from('Sam Guest').toString('hex'), Buffer.from('Sam Guest').toString('base64').slice(0, 10), sam.seat]) expect(stored.includes(enc), enc).toBe(false);
    expect(h.logs.join('').includes('Sam Guest')).toBe(false);

    const tree = await w.get(id, opts);
    expect(tree).toMatchObject({ name: null, role: null, people: null });
    expect(tree.items.map((i) => [i.id, i.parent, i.role])).toEqual([[doc, null, 'read']]);
    expect(JSON.stringify(tree)).not.toMatch(/CANARY|@/);
    expect((await w.items.get(id, doc, opts)).name).toBe('Agenda');
    expect(await refusal(w.items.get(id, other, opts))).toEqual(await refusal(w.items.get(id, madeUp(), opts)));
    expect(await code(w.items.rename(id, doc, 'x', opts))).toBe('forbidden');
    await org.api.workspaces.share.set(id, doc, [{ seat: sam.seat }], 'edit', { pass: host.ticket.pass });
    await w.items.rename(id, doc, 'Agenda, renamed', opts);
    expect((await org.api.workspaces.items.get(id, doc)).name).toBe('Agenda, renamed');

    const stream1 = w.live(id, opts);
    const stream2 = jo.api.workspaces.live(id, { pass: jo.pass });
    await until(() => stream1.getSnapshot().status === 'live' && stream2.getSnapshot().status === 'live', 'the guests’ streams');
    expect(liveNames(stream1)).toEqual(['Agenda, renamed']);

    // Someone taken out of the call is out of what the call gave them, at once.
    await host.remove(jo.call.ticket.identity);
    await until(() => stream2.getSnapshot().status === 'closed', 'a removed guest’s stream to end');
    expect(await code(jo.api.workspaces.get(id, { pass: jo.pass }))).toBe('unauthenticated');

    // The call ending ends every seat: their rows go, streams end, and the pass opens nothing.
    await host.leave();
    await until(() => stream1.getSnapshot().status === 'closed', 'the call ending to end the stream');
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE kind = 'seat' AND document_id = $1", [doc])).toBe(0);
    expect(await code(w.get(id, opts))).toBe('unauthenticated');
    // An address stays: only seats end with the call.
    expect((await org.api.workspaces.share.list(id, doc)).entries.map((e) => e.kind)).toEqual(['email']);
  });

  it('aren’t let in by waiting, and being the organizer or in the call gives anyone nothing', async () => {
    const owner = await account();
    const id = await workspace(owner, 'Ours');
    const doc = await make(owner, id, 'document', 'Doc');
    const org = await account();
    const { code: c, host } = await callWith(org, []);
    // The organizer of a call isn't in the workspace, with their pass or without it.
    expect(await code(org.api.workspaces.get(id))).toBe('not-found');
    expect(await code(org.api.workspaces.get(id, { pass: host.ticket.pass }))).toBe('not-found');
    // Someone still asking to join has a pass and no seat.
    const b = h.browser();
    const waiting = await b.api.calls.join(c, { mic: false, cam: false, name: 'Waiting' });
    expect(await code(b.api.workspaces.get(id, { pass: waiting.ticket.pass }))).toBe('unauthenticated');
    // A pass that isn't real is no pass.
    expect(await code(b.api.workspaces.get(id, { pass: 'not.real' }))).toBe('unauthenticated');
    // Signed in, a bad pass changes nothing: they still have what their account has.
    expect((await owner.api.workspaces.get(id, { pass: 'not.real' })).items.map((i) => i.id)).toEqual([doc]);
    await host.leave();
  });

  it('see what their seat and their account each give them, together, when they’re both', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const fromSeat = await make(org, id, 'document', 'From the seat');
    const fromAddress = await make(org, id, 'document', 'From the address');
    await make(org, id, 'document', 'Neither');
    const { code: c, host } = await callWith(org, []);
    const member = await account();
    const call = await member.api.calls.join(c, { mic: false, cam: false });
    await settle(host, (s) => s.waiting.some((w) => w.id === call.ticket.identity));
    await host.admit(call.ticket.identity);
    await inGroup(call);
    const seat = (await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity))).participants.find((p) => p.id === call.ticket.identity)?.seat ?? '';
    await org.api.workspaces.share.set(id, fromSeat, [{ seat }], 'read', { pass: host.ticket.pass });
    await org.api.workspaces.share.set(id, fromAddress, [{ email: member.email }], 'read');
    expect(named((await member.api.workspaces.get(id)).items)).toEqual(['From the address']);
    expect(named((await member.api.workspaces.get(id, { pass: call.ticket.pass })).items)).toEqual(['From the seat', 'From the address']);
    await host.leave();
  });

  it('lose what only their seat gave them the moment it goes, and keep what their account gives them', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const both = await make(org, id, 'document', 'Both');
    const seatOnly = await make(org, id, 'board', 'Seat only');
    const { code: c, host } = await callWith(org, []);
    const member = await account();
    const call = await member.api.calls.join(c, { mic: false, cam: false });
    await settle(host, (s) => s.waiting.some((w) => w.id === call.ticket.identity));
    await host.admit(call.ticket.identity);
    await inGroup(call);
    const seat = (await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity))).participants.find((p) => p.id === call.ticket.identity)?.seat ?? '';
    const pass = { pass: host.ticket.pass };
    await org.api.workspaces.share.set(id, both, [{ seat }], 'edit', pass);
    await org.api.workspaces.share.set(id, seatOnly, [{ seat }], 'read', pass);
    await org.api.workspaces.share.set(id, both, [{ email: member.email }], 'read');
    const w = member.api.workspaces;
    const opts = { pass: call.ticket.pass };

    // With both identities, either opens it, and the stronger counts: the account reads, the seat edits.
    expect((await w.get(id, opts)).items.map((i) => [i.name, i.role])).toEqual([['Both', 'edit'], ['Seat only', 'read']]);
    await w.items.rename(id, both, 'Renamed from the seat', opts);
    // Without the pass the seat isn't there: the same person, with what their account has.
    expect((await w.get(id)).items.map((i) => [i.id, i.role])).toEqual([[both, 'read']]);
    expect(await code(w.items.rename(id, both, 'x'))).toBe('forbidden');

    const live = w.live(id, opts);
    await until(() => live.getSnapshot().status === 'live', 'the stream');
    const entryOf = async (doc: string) => (await org.api.workspaces.share.list(id, doc)).entries.find((e) => e.kind === 'seat')?.id ?? '';
    await org.api.workspaces.share.remove(id, both, await entryOf(both));
    await org.api.workspaces.share.remove(id, seatOnly, await entryOf(seatOnly));

    // At once, on the very next request and on the stream, and what the account gives stands.
    expect(await code(w.items.rename(id, both, 'x', opts))).toBe('forbidden');
    expect(await refusal(w.items.get(id, seatOnly, opts))).toEqual(await refusal(w.items.get(id, madeUp(), opts)));
    expect((await w.get(id, opts)).items.map((i) => [i.id, i.role])).toEqual([[both, 'read']]);
    await until(() => (treeOf(live)?.items ?? []).map((i) => `${i.id}:${i.role}`).join() === `${both}:read`, 'the stream to take back what the seat gave');
    expect(live.getSnapshot().status).toBe('live');

    // The call ending takes the seat itself, and the account still has what it has.
    await org.api.workspaces.share.set(id, seatOnly, [{ seat }], 'read', pass);
    await until(() => liveNames(live).length === 2, 'the seat’s document to come back');
    await host.leave();
    await until(() => liveNames(live).join() === 'Renamed from the seat', 'the seat’s document to go with the call');
    expect((await w.get(id)).items.map((i) => i.id)).toEqual([both]);
    expect(live.getSnapshot().status).toBe('live');
  });

  it('lose a seat when upkeep finds its call over, should nothing else have ended it', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const doc = await make(org, id, 'document', 'Doc');
    const owner = await ownerOf(id);
    await h.pool.query(`INSERT INTO document_access (owner_id, document_id, access_id, principal_index, kind, role, call_id, person_ciphertext) VALUES ($1,$2,$3,$4,'seat','read',$5,$6)`,
      [owner, doc, madeUp(), randomBytes(32), madeUp(), Buffer.from('{}')]);
    const r = await maintain(h.deps);
    expect(r.seats).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM document_access WHERE owner_id = $1', [owner])).toBe(0);
  });
});
