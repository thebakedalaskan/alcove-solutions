/**
 * A board in a call, through browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres, the object
 * store and the local LiveKit server: who can open one and who sees it, closing it, bringing a saved board and who's let in,
 * the workspace it's saved in, and what someone left out is told, which is nothing that names it.
 */
import { AlcoveApiError, DOC_UPDATE_TYPE, SERVER_CLIENT, type AudioPiece, type BreakoutBoard, type CallSession, type CallState, type DocSession, type DocSessionOptions, type TranscriptClip, type WorkspaceRole, type WorkspaceTree } from '@alcove/api';
import { addObject, boardText, readBoard, roomFrameId, type NewObject } from '@alcove/board';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from '../../crypto';
import { workspaceKey } from '../workspaces/access';
import type { DocPool } from '../../live/docPool';
import { withWorkspace } from '../../testing/call-workspace';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Browser, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';
import { reconcile } from './lifecycle';
import { MeetingManifest } from '../meetings/service';
import { openOwner } from '../../owners';
import { getItem, saveRevision } from '../../vault';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const inRoom: TestParticipant[] = [];
afterEach(async () => { await Promise.all(inRoom.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

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
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await rest(20);
  }
}
const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** Reads the call again until `pred` holds, or the wait is up. */
async function settle(call: CallSession, pred: (s: CallState) => boolean, ms = 15_000): Promise<CallState> {
  const by = Date.now() + ms;
  while (!pred(call.getSnapshot()) && Date.now() < by) { await call.refresh(); await rest(30); }
  return call.getSnapshot();
}
/** The call as this browser reads it now. */
const read = async (call: CallSession) => { await call.refresh({ call: true, log: false }); return call.getSnapshot(); };
const opened = async (call: CallSession) => (await read(call)).board.open;
/** What someone in the call is told is being presented where they are. */
const presented = async (call: CallSession) => (await read(call)).workspace.present;
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
  await settle(host, (s) => s.participants.some((p) => p.id === who.ticket.identity));
}
/** Someone with the link and no account, let in. */
async function guest(host: CallSession, callCode: string, name = 'Jamie Guest') {
  const b = h.browser();
  const call = await b.api.calls.join(callCode, { mic: false, cam: false, name });
  await letIn(host, call);
  return { ...b, call };
}
/** Someone signed in and invited, in the call. */
async function invited(host: CallSession, callCode: string, who: Account, previous?: string) {
  const call = await who.api.calls.join(callCode, { mic: false, cam: false, ...(previous ? { previous } : {}) });
  await inGroup(call);
  await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
  return call;
}
/**
 * A call `org` hosts, with `guests` invited. Its workspace, which nothing makes by itself: the one it's scheduled with, as the
 * organizer chooses one; by default (`'new'`) one the organizer makes in the call with New workspace; or none (`null`).
 * With notes on, the host's browser is recording from the start.
 */
async function callBy(org: Account, o: { guests?: string[]; title?: string; workspace?: string | null; notes?: 'on' | 'off' } = {}) {
  const notes = o.notes ?? 'off';
  const chosen = o.workspace === undefined ? 'new' : o.workspace;
  const { code: c } = chosen !== null && chosen !== 'new'
    ? await org.api.meetings.create({ title: o.title ?? 'Untitled call', startsAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, guests: o.guests ?? [], notes, workspaceId: chosen })
    : await org.api.calls.startNow({ notes, guests: o.guests ?? [], ...(o.title ? { title: o.title } : {}) });
  const host = await org.api.calls.join(c, { mic: notes === 'on', cam: false });
  await inGroup(host);
  if (chosen === 'new') await withWorkspace(host);
  if (notes === 'on') for (const at of [0, 1, 2, 3]) await host.appendAudio(piece(audioBytes('boards-in-calls'), 0, at));
  return { host, code: c };
}
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, s: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: ms });
/** What's in a workspace besides each call's own folder, which the call's workspace has at its top. */
const inTree = (t: WorkspaceTree) => t.items.filter((x) => x.call === null);
const callFolderIn = (t: WorkspaceTree) => t.items.find((x) => x.call !== null)?.id ?? null;
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const saved = (who: Account, id: string, name: string) => who.api.workspaces.items.create(id, { kind: 'board', name }).then((x) => x.id);
const first = (who: { name: string }) => who.name.split(' ')[0] ?? '';
async function open(who: Browser, id: string, document: string, opts: DocSessionOptions = {}): Promise<DocSession> {
  const s = await who.api.workspaces.document(id, document, opts);
  await s.ready;
  return s;
}
const stored = (s: DocSession) => until(() => s.getSnapshot().status === 'saved', 'everything to reach Alcove');
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
const seats = (board: string) => count("SELECT count(*)::int AS n FROM document_access WHERE document_id = $1 AND kind = 'seat'", [board]);
const entries = (board: string) => count('SELECT count(*)::int AS n FROM document_access WHERE document_id = $1', [board]);
/** How many connections to the database are waiting for a lock now. */
const waitingOnLocks = () => count("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
/** `p`, or a failure once `ms` have gone by. */
const soon = <T,>(p: Promise<T>, what: string, ms = 5_000): Promise<T> => Promise.race([p, rest(ms).then((): never => { throw new Error(`${what} took more than ${ms} ms`); })]);
/** Everything the call told this person, as text: what a name would be found in. */
const said = (s: CallState) => JSON.stringify(s);
/** An action as a browser sends it, whatever the client would make of it. */
const action = (who: Browser, call: CallSession, a: unknown) => who.fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(typeof a === 'object' && a !== null && 'type' in a && a.type === 'hand' ? { ...a, place: call.getSnapshot().attention.place } : a) });
/** The API's log lines since `from`, parsed. */
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const linesSince = (from: number) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
/** The call's own record of itself, opened as the server opens it. */
async function storedCall(ownerId: string, callId: string) {
  const o = await openOwner(h.deps, ownerId, undefined);
  const key = stateKey(o.root, ownerId, `call:${callId}`);
  const header = { v: 1, kind: 'call-state', ownerId, callId } as const;
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [ownerId, callId])).rows[0]);
  return { key, header, state: openJson(key, header, row.state_ciphertext, z.record(z.string(), z.unknown())) };
}

describe('a new board', () => {
  it('opens for everyone in the call, is saved in its workspace under its name, and stays with the people invited', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const lena = await account();
    const id = await workspace(art, 'Product', [[lena, 'read']]);
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], title: 'Launch  review', workspace: id });
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c);
    const pass = { pass: jamie.call.ticket.pass };
    expect(host.getSnapshot().board).toEqual({ open: null, timer: null, vote: null, ideas: [] });
    const stream = art.api.workspaces.live(id);
    await until(() => stream.getSnapshot().status === 'live', 'the stream');

    // Kofi isn't in the workspace, and being invited is enough.
    await k.openBoard({ template: 'retro' });
    const made = k.getSnapshot().board.open;
    const board = made?.documentId ?? '';
    expect(made).toEqual({ workspaceId: id, documentId: board, name: 'Launch review', openedBy: k.ticket.identity, canClose: true, everyone: true, role: 'edit', seal: 'Sealed', frame: null });
    expect(await opened(host)).toEqual({ ...made, canClose: true });
    expect(await opened(p)).toEqual({ ...made, canClose: false });
    expect(await opened(jamie.call)).toEqual({ ...made, canClose: false });

    // It's an item like any other, by whoever started it, and every stream of the workspace hears of it.
    await until(() => stream.getSnapshot().tree?.items.some((x) => x.id === board) === true, 'the stream to hear of it');
    const tree = await art.api.workspaces.get(id);
    expect(inTree(tree)).toEqual([expect.objectContaining({ id: board, kind: 'board', name: 'Launch review', parent: callFolderIn(tree), restricted: false, role: 'edit', by: expect.objectContaining({ name: kofi.name }) })]);
    // The workspace's people have it by their role, and those invited by email. A guest has a seat, and only that.
    expect(inTree(await lena.api.workspaces.get(id)).map((x) => [x.id, x.role])).toEqual([[board, 'read']]);
    const shared = (await art.api.workspaces.share.list(id, board)).entries;
    expect(shared.filter((e) => e.kind === 'email').map((e) => [e.person.email, e.role]).sort()).toEqual([[kofi.email, 'edit'], [priya.email, 'edit']].sort());
    expect(shared.filter((e) => e.kind === 'seat').map((e) => [e.person.name, e.role])).toEqual([['Jamie Guest', 'edit']]);
    expect((await kofi.api.workspaces.get(id, { pass: k.ticket.pass })).items.map((x) => x.id)).toEqual([board]);

    // Everyone in it can work on it.
    const page = await open(jamie, id, board, pass);
    expect(page.getSnapshot().role).toBe('edit');
    page.doc.getMap('objects').set('a', 'a guest’s sticky');
    await stored(page);
    expect(page.getSnapshot().refused).toBeNull();

    await host.leave();
    // After the call it stays with the people invited, and goes from whoever only had a seat.
    await until(async () => (await seats(board)) === 0, 'the seat to end with the call');
    for (const who of [kofi, priya]) expect((await who.api.workspaces.get(id)).items.map((x) => [x.id, x.kind, x.name, x.role])).toEqual([[board, 'board', 'Launch review', 'edit']]);
    expect(await code(jamie.api.workspaces.get(id, pass))).toBe('unauthenticated');
    expect(inTree(await art.api.workspaces.get(id)).map((x) => x.id)).toEqual([board]);
  });

  it('fills a new board from its template before the call says it’s open, once, as the server’s, for everyone in it', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    const logged = (board: string) => count('SELECT next_seq::int - 1 AS n FROM documents WHERE document_id = $1', [board]);
    const asTemplate = (board: string) => count('SELECT count(*)::int AS n FROM document_clients WHERE document_id = $1 AND client_id = $2 AND octet_length(people) = 0', [board, SERVER_CLIENT.template]);

    await k.openBoard({ template: 'retro' });
    const board = k.getSnapshot().board.open?.documentId ?? '';
    // It's saved in the call's workspace.
    const home = k.getSnapshot().board.open?.workspaceId ?? '';
    expect(home).toBe(id);
    // By the time it's open it's in the board's log: one update, written as the template's client, which is nobody's.
    expect(await logged(board)).toBe(1);
    expect(await asTemplate(board)).toBe(1);
    const [hers, his] = await Promise.all([open(art, home, board), open(kofi, home, board, { pass: k.ticket.pass })]);
    for (const page of [hers, his]) expect(readBoard(page.doc).frames.map((f) => [f.title, f.role])).toEqual([['Went well', ''], ['Could improve', ''], ['Actions', 'actions']]);
    // Opened again for everyone, it isn't filled again.
    await host.openBoard({ workspaceId: home, documentId: board, letIn: false });
    expect(await logged(board)).toBe(1);
    // Blank writes nothing.
    await host.openBoard({ template: 'blank' });
    const blank = host.getSnapshot().board.open?.documentId ?? '';
    expect(blank).not.toBe(board);
    expect(await logged(blank)).toBe(0);
    expect(await asTemplate(blank)).toBe(0);
  });

  it('says it’s open only once its template is on, however long the workers take: whoever reads the call then finds it filled', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    const logged = (board: string) => count('SELECT next_seq::int - 1 AS n FROM documents WHERE document_id = $1', [board]);
    // The instance's workers are busy, as on a loaded instance: each change waits its turn.
    const docs: DocPool = h.deps.docs;
    const real = docs.run.bind(docs);
    const busy: DocPool['run'] = async (task, input, o) => { if (task === 'edit') await rest(1500); return real(task, input, o); };
    docs.run = busy;
    try {
      const opening = k.openBoard({ template: 'retro' });
      // Art's call reads the call as any browser's does, over and over, while Kofi's opens it.
      let board = '';
      await until(async () => { board = (await opened(host))?.documentId ?? ''; return board !== ''; }, 'Art’s call to have the board');
      const atFirstSight = await logged(board);
      const s = await open(art, id, board);
      const onOpening = readBoard(s.doc).frames.map((f) => f.title);
      await opening;
      expect({ atFirstSight, onOpening }).toEqual({ atFirstSight: 1, onOpening: ['Went well', 'Could improve', 'Actions'] });
      s.close();
    } finally {
      docs.run = real;
    }
  });

  it('opens a new board whose template wouldn’t go on, as the board it is, and says so once in the log, at warn', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const { host } = await callBy(art, { workspace: id });
    const docs: DocPool = h.deps.docs;
    const real = docs.run.bind(docs);
    const failing: DocPool['run'] = async (task, input, o) => { if (task === 'edit') throw new Error('the workers are gone'); return real(task, input, o); };
    docs.run = failing;
    const from = h.logs.length;
    try {
      await host.openBoard({ template: 'retro' });
    } finally {
      docs.run = real;
    }
    const board = host.getSnapshot().board.open?.documentId ?? '';
    expect(board).not.toBe('');
    expect(await count('SELECT next_seq::int - 1 AS n FROM documents WHERE document_id = $1', [board])).toBe(0);
    const warned = linesSince(from).filter((l) => l.msg === 'board not filled from its template');
    expect(warned.map((l) => l.level)).toEqual([40]);
    // It's a board all the same, for everyone in the call to start on.
    expect(readBoard((await open(art, id, board)).doc).objects).toEqual([]);
  });

  it('lets nobody take a new board’s template from it with a rescue: by the time anyone can know of the board, the template’s there', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    const docs: DocPool = h.deps.docs;
    const real = docs.run.bind(docs);
    const busy: DocPool['run'] = async (task, input, o) => { if (task === 'edit') await rest(1500); return real(task, input, o); };
    docs.run = busy;
    let adopted = 0;
    try {
      const opening = host.openBoard({ template: 'retro' });
      let board = '';
      await until(async () => { board = (await opened(k))?.documentId ?? ''; return board !== ''; }, 'Kofi’s call to have the board');
      // Kofi, invited by address, can edit it: he posts his own "template", written as the template's client, as a rescue.
      const forged = new Y.Doc();
      forged.clientID = SERVER_CLIENT.template;
      addObject(forged, { k: 'frame', x: 0, y: 0, w: 1160, h: 530, c: 'rose', role: '', hint: '', sub: '', sorted: false, title: 'Kofi’s instead' }, null);
      adopted = (await kofi.fetch(`${h.baseUrl}/v1/workspaces/${id}/documents/${board}/adopt`, { method: 'POST', headers: { 'content-type': DOC_UPDATE_TYPE }, body: new Uint8Array(Y.encodeStateAsUpdate(forged)) })).status;
      await opening;
    } finally {
      docs.run = real;
    }
    expect(adopted).toBe(409);
    const board = host.getSnapshot().board.open?.documentId ?? '';
    expect(readBoard((await open(art, id, board)).doc).frames.map((f) => f.title)).toEqual(['Went well', 'Could improve', 'Actions']);
  });

  it('takes every template, and nothing else', async () => {
    const art = await account();
    const { host } = await callBy(art);
    for (const template of ['blank', 'retro', 'ideas', 'flow', 'what-why-next'] as const) await host.openBoard({ template });
    expect(host.getSnapshot().board.open).toMatchObject({ role: 'edit' });
    expect((await action(art, host, { type: 'board-open', template: 'not-a-template' })).status).toBe(400);
    expect((await action(art, host, { type: 'board-open' })).status).toBe(400);
    expect((await action(art, host, { type: 'board-open', workspaceId: madeUp(), documentId: 'nope', letIn: false })).status).toBe(400);
    expect((await action(art, host, { type: 'board-open', workspaceId: madeUp(), documentId: madeUp() })).status).toBe(400);
    // A saved board names the workspace it's in.
    expect((await action(art, host, { type: 'board-open', documentId: madeUp(), letIn: false })).status).toBe(400);
    expect((await action(art, host, { type: 'board-open', workspaceId: 'nope', documentId: madeUp(), letIn: false })).status).toBe(400);
  });

  it('isn’t a guest’s to start: they’re told so at info, and it settles nothing', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const board = await saved(art, id, 'Theirs');
    const { host, code: c } = await callBy(art, { workspace: null });
    const jamie = await guest(host, c);
    const from = h.logs.length;
    const told = { code: 'forbidden', status: 403, message: 'Guests can add to a board, but can’t start one.' };
    expect(await refusal(jamie.call.openBoard({ template: 'blank' }))).toEqual(told);
    expect(await refusal(jamie.call.openBoard({ workspaceId: id, documentId: board, letIn: false }))).toEqual(told);
    expect(await refusal(jamie.call.boardCheck(id, board))).toEqual(told);
    // The same whatever's asked for, so it says nothing about what exists.
    expect(await refusal(jamie.call.openBoard({ workspaceId: madeUp(), documentId: madeUp(), letIn: true }))).toEqual(told);
    const lines = linesSince(from).filter((l) => l.msg === told.message);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l.level).toBe(30);
    // Nothing was settled on their account: the organizer hasn't chosen.
    await art.api.workspaces.remove(id);
    expect((await read(host)).workspace.id).toBeNull();
    expect(await art.api.workspaces.list()).toEqual([]);
    expect(await opened(host)).toBeNull();

    // Someone asking to be let in isn't in the call at all.
    const b = h.browser();
    const waiting = await b.api.calls.join(c, { mic: false, cam: false, name: 'Waiting Guest' });
    await settle(host, (s) => s.waiting.some((w) => w.id === waiting.ticket.identity));
    expect(await code(waiting.openBoard({ template: 'blank' }))).toBe('forbidden');
    expect(await code(waiting.closeBoard())).toBe('forbidden');
    expect(await code(waiting.boardCheck(madeUp(), madeUp()))).toBe('forbidden');
    await withWorkspace(host);
    await host.openBoard({ template: 'blank' });
    expect(waiting.getSnapshot().board).toEqual({ open: null, timer: null, vote: null, ideas: [] });
    await waiting.refresh({ call: true, log: false });
    expect(waiting.getSnapshot().board).toEqual({ open: null, timer: null, vote: null, ideas: [] });
  });

  it('reaches whoever comes late or comes back, as a guest’s seat or the board they opened', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    await guest(host, c, 'Early Guest');
    await host.openBoard({ template: 'ideas' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    expect(await seats(board)).toBe(1);

    // Someone invited who comes late has it by email.
    const k = await invited(host, c, kofi);
    expect(await opened(k)).toMatchObject({ documentId: board, role: 'edit', canClose: false, openedBy: host.ticket.identity });
    // A guest who comes late is given a seat as they're let in.
    const jamie = await guest(host, c);
    await until(async () => (await opened(jamie.call))?.role === 'edit', 'a seat for the guest who came late');
    expect(await opened(jamie.call)).toMatchObject({ workspaceId: id, documentId: board, name: expect.any(String), canClose: false });
    expect(await seats(board)).toBe(2);
    const page = await open(jamie, id, board, { pass: jamie.call.ticket.pass });
    expect(page.getSnapshot().role).toBe('edit');

    // A reload brings them back to it, on the same seat.
    jamie.call.closing();
    const back = await jamie.api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest', previous: jamie.call.ticket.pass });
    await letIn(host, back);
    expect(await opened(back)).toMatchObject({ documentId: board, role: 'edit' });
    expect(await seats(board)).toBe(2);

    // Whoever opened it is the same person on a new connection: they can still close it, and everyone's told who they are now.
    const again = await art.api.calls.join(c, { mic: false, cam: false });
    await inGroup(again);
    expect(await opened(again)).toMatchObject({ documentId: board, openedBy: again.ticket.identity, canClose: true });
    await inGroup(k);
    expect(await opened(k)).toMatchObject({ openedBy: again.ticket.identity, canClose: false });
  });

  it('replaces what’s open for everyone there, and the old one just closes', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], title: 'Planning', workspace: id });
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'blank' });
    const before = host.getSnapshot().board.open?.documentId ?? '';
    await k.openBoard({ template: 'flow' });
    const after = k.getSnapshot().board.open?.documentId ?? '';
    expect(after).not.toBe(before);
    // Who opened it now is whoever opened this one: the one it replaced was theirs and nobody's now.
    expect(await opened(host)).toMatchObject({ documentId: after, openedBy: k.ticket.identity, canClose: true });
    expect(k.getSnapshot().board.open).toMatchObject({ documentId: after, openedBy: k.ticket.identity, canClose: true });
    expect(inTree(await art.api.workspaces.get(id)).map((x) => x.id).sort()).toEqual([before, after].sort());
    // Two at once: one is open, and both are kept.
    await Promise.all([host.openBoard({ template: 'blank' }), k.openBoard({ template: 'blank' })]);
    const items = inTree(await art.api.workspaces.get(id)).map((x) => x.id);
    expect(items).toHaveLength(4);
    expect(items).toContain((await opened(host))?.documentId);
    expect((await opened(k))?.documentId).toBe((await opened(host))?.documentId);
  });

  it('keeps a call from making boards without end', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const { host } = await callBy(art, { workspace: id });
    for (let i = 0; i < 50; i++) await host.openBoard({ template: 'blank' });
    const last = (await opened(host))?.documentId;
    expect(await refusal(host.openBoard({ template: 'blank' }))).toMatchObject({ code: 'conflict', message: 'This call has as many boards as it can take. Open one it already has.' });
    expect(inTree(await art.api.workspaces.get(id))).toHaveLength(50);
    // The ones it made still open, and what was open stays.
    expect(await opened(host)).toMatchObject({ documentId: last });
    const made = inTree(await art.api.workspaces.get(id))[0]?.id ?? '';
    await host.openBoard({ workspaceId: id, documentId: made, letIn: false });
    expect((await opened(host))?.documentId).toBe(made);
    await host.openBoard({ workspaceId: id, documentId: made, letIn: true });
    // A saved board that's new to the call can open, and it's letting everyone into another that it hasn't room for.
    const other = await saved(art, id, 'Another');
    expect(await code(host.openBoard({ workspaceId: id, documentId: other, letIn: true }))).toBe('conflict');
    await host.openBoard({ workspaceId: id, documentId: other, letIn: false });
    expect((await opened(host))?.documentId).toBe(other);
  });

  it('is refused in a call’s workspace the organizer can’t edit in any more, and the call goes on until they make or pick another', async () => {
    const art = await account();
    const lena = await account();
    const kofi = await account();
    const id = await workspace(lena, 'Lena’s', [[art, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    // The call's folder is put there while Art can edit there.
    await host.openWorkspace();
    const people = await lena.api.workspaces.people(id);
    const them = people.find((p) => p.person.email === art.email)?.id ?? '';
    await lena.api.workspaces.setRole(id, them, 'read');
    const told = { code: 'conflict', status: 409, message: 'This call’s workspace can’t take a new board any more. You can still open one that’s saved.' };
    const toldThem = { code: 'conflict', status: 409, message: 'You can’t add to this call’s workspace any more. You can still open a board that’s saved.' };
    expect(await refusal(k.openBoard({ template: 'blank' }))).toEqual(told);
    expect(await refusal(host.openBoard({ template: 'blank' }))).toEqual(toldThem);
    await lena.api.workspaces.removePerson(id, them);
    expect(await refusal(k.openBoard({ template: 'blank' }))).toEqual(told);
    expect(await refusal(host.openBoard({ template: 'blank' }))).toEqual(toldThem);
    expect(inTree(await lena.api.workspaces.get(id))).toEqual([]);
    expect(await opened(k)).toBeNull();
    // A workspace the organizer makes is the call's: a new board goes there, and Lena's is left as it was.
    const made = await withWorkspace(host, 'Art’s');
    await k.openBoard({ template: 'blank' });
    expect(await opened(k)).toMatchObject({ workspaceId: made, role: 'edit' });
    expect(inTree(await lena.api.workspaces.get(id))).toEqual([]);
  });

  it('is read again while it’s open, so what happens to it outside the call shows with no nudge', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    await k.openBoard({ template: 'blank' });
    const board = k.getSnapshot().board.open?.documentId ?? '';
    // Nothing tells the call: a browser finds out by reading it, as it checks its keys.
    await art.api.workspaces.items.rename(id, board, 'Renamed');
    await until(() => k.getSnapshot().board.open?.name === 'Renamed', 'the new name to show');
    await art.api.workspaces.items.trash(id, board);
    await until(() => k.getSnapshot().board.open === null, 'the board to go');
  });

  it('takes a new name from someone in the call at once: the room is told to look again', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    const listening = await connect(await host.room(), { sending: host.crypto });
    inRoom.push(listening);
    await k.openBoard({ template: 'retro' });
    const board = k.getSnapshot().board.open?.documentId ?? '';
    const pushed = listening.nextChange();
    // As the board's name menu does it: through the workspace, with the call's pass.
    await kofi.api.workspaces.items.rename(id, board, 'Launch retro, November', { pass: k.ticket.pass });
    await soon(pushed, 'the change push');
    expect(await opened(host)).toMatchObject({ documentId: board, name: 'Launch retro, November' });
    expect(await opened(k)).toMatchObject({ documentId: board, name: 'Launch retro, November' });
  });

  it('turns read-only for someone the moment Share says so in the call: the room is told at once, not at the next read', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    const p = await invited(host, c, priya);
    const listening = await connect(await host.room(), { sending: host.crypto });
    inRoom.push(listening);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    expect(await opened(p)).toMatchObject({ documentId: board, role: 'edit' });
    // From the board's Share in the call, with its pass: kept to the people added, then Priya at read.
    const fromCall = { pass: host.ticket.pass };
    let pushed = listening.nextChange();
    await art.api.workspaces.share.restrict(id, board, true, fromCall);
    await soon(pushed, 'the room hearing it’s restricted', 1_000);
    pushed = listening.nextChange();
    const asked = Date.now();
    await art.api.workspaces.share.set(id, board, [{ email: priya.email }], 'read', fromCall);
    await soon(pushed, 'the room hearing Priya is at read', 1_000);
    // Her browser reads the call as the room is told: her board is read-only within a second of Art's change.
    expect(await opened(p)).toMatchObject({ documentId: board, role: 'read' });
    expect(Date.now() - asked).toBeLessThan(1_000);
    // Taken off, she's told the same way, and the board is one she can't open.
    const entry = (await art.api.workspaces.share.list(id, board)).entries.find((e) => e.person.email === priya.email)?.id ?? '';
    pushed = listening.nextChange();
    await art.api.workspaces.share.remove(id, board, entry, fromCall);
    await soon(pushed, 'the room hearing Priya is taken off', 1_000);
    expect(await opened(p)).toMatchObject({ role: null, name: null });
  });

  it('tells a call a board is open to by a seat of a change made outside it, at once', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    const p = await invited(host, c, priya);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    // A guest is let in, and has a seat on the board: that's how a change elsewhere finds this call.
    const jamie = await guest(host, c);
    expect(await opened(jamie.call)).toMatchObject({ documentId: board, role: 'edit' });
    expect(await seats(board)).toBe(1);
    const listening = await connect(await host.room(), { sending: host.crypto });
    inRoom.push(listening);
    // Art, from the Drive and not the call, keeps it to the people added and sets Priya to read. Each is told to the call.
    let pushed = listening.nextChange();
    await art.api.workspaces.share.restrict(id, board, true);
    await soon(pushed, 'the room hearing it’s restricted elsewhere', 1_000);
    pushed = listening.nextChange();
    const asked = Date.now();
    await art.api.workspaces.share.set(id, board, [{ email: priya.email }], 'read');
    await soon(pushed, 'the room hearing of a change made elsewhere', 1_000);
    expect(await opened(p)).toMatchObject({ documentId: board, role: 'read' });
    expect(Date.now() - asked).toBeLessThan(1_000);
    // The guest's seat is an entry restricting leaves, so the guest goes on working on it.
    expect(await opened(jamie.call)).toMatchObject({ documentId: board, role: 'edit' });
  });

  it('goes from the call when it’s in Trash or deleted, and comes back with it', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    await k.openBoard({ template: 'blank' });
    const board = k.getSnapshot().board.open?.documentId ?? '';
    await art.api.workspaces.items.trash(id, board);
    expect(await opened(k)).toBeNull();
    expect(await opened(host)).toBeNull();
    await art.api.workspaces.items.restore(id, board);
    expect(await opened(k)).toMatchObject({ documentId: board, role: 'edit' });
    await art.api.workspaces.items.trash(id, board);
    await art.api.workspaces.items.deleteForever(id, board);
    expect(await opened(k)).toBeNull();
    expect(await opened(host)).toBeNull();
    // A new one opens over it.
    await k.openBoard({ template: 'blank' });
    expect((await opened(host))?.documentId).not.toBe(board);
  });
});

describe('closing a board', () => {
  it('is for whoever opened it or the organizer, deletes nothing, and leaves its seats until the call ends', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], workspace: id });
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c);
    expect(await refusal(k.closeBoard())).toMatchObject({ code: 'conflict', message: 'No board is open here.' });

    await k.openBoard({ template: 'blank' });
    const board = k.getSnapshot().board.open?.documentId ?? '';
    // Nobody else who's in it, and a guest with a seat least of all.
    const notYours = { code: 'forbidden', status: 403, message: 'Only whoever opened this board, or the organizer, can close it.' };
    expect(await refusal(p.closeBoard())).toEqual(notYours);
    expect(await refusal(jamie.call.closeBoard())).toEqual(notYours);
    expect(await opened(p)).toMatchObject({ documentId: board });

    // Whoever opened it.
    await k.closeBoard();
    expect(k.getSnapshot().board).toEqual({ open: null, timer: null, vote: null, ideas: [] });
    expect((await read(jamie.call)).board).toEqual({ open: null, timer: null, vote: null, ideas: [] });
    expect(inTree(await art.api.workspaces.get(id)).map((x) => x.id)).toEqual([board]);
    expect(await seats(board)).toBe(1);
    expect((await jamie.api.workspaces.get(id, { pass: jamie.call.ticket.pass })).items.map((x) => x.id)).toEqual([board]);

    // People may open it again: it's the same board, and the guest is still in it.
    await p.openBoard({ workspaceId: id, documentId: board, letIn: false });
    expect(await opened(jamie.call)).toMatchObject({ documentId: board, role: 'edit', openedBy: p.ticket.identity });
    expect(await refusal(k.closeBoard())).toEqual(notYours);

    // The organizer, whoever opened it.
    await host.closeBoard();
    expect(await opened(p)).toBeNull();
    expect(inTree(await art.api.workspaces.get(id)).map((x) => x.id)).toEqual([board]);
  });

  it('takes a board nobody presents out of the call, which nothing else does: there’s no presentation to end', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id, title: 'Launch review' });
    const k = await invited(host, c, kofi);
    // Kofi makes a board (Board › New › Blank opens it just for him), and it's the board in the call, for him or the organizer
    // to close.
    await k.openBoard({ template: 'blank' });
    const board = (await opened(host))?.documentId ?? '';
    expect(board).not.toBe('');
    expect(await opened(k)).toMatchObject({ documentId: board, canClose: true });
    expect(await opened(host)).toMatchObject({ documentId: board, canClose: true });
    // Nobody presents it, so ending a presentation for everyone has nothing to end, for Kofi or the organizer.
    expect(await code(k.stopPresenting(true))).toBe('conflict');
    expect(await code(host.stopPresenting(true))).toBe('conflict');
    expect(await opened(host)).toMatchObject({ documentId: board });
    // Closing it takes it out of the call for everyone, and nothing was presented, so nothing's said to have ended.
    expect(await code(host.closeBoard())).toBe('allowed');
    for (const call of [host, k]) {
      const s = await read(call);
      expect(s.board.open).toBeNull();
      expect(s.workspace.ended).toBeNull();
    }
    expect(inTree(await art.api.workspaces.get(id)).map((x) => x.id)).toContain(board);
  });

  it('isn’t for whoever opened it while someone else presents it, as no board opens over theirs; the organizer’s ends it for everyone', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit'], [priya, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], workspace: id });
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const by = (who: Account) => ({ seat: expect.any(String), name: who.name });
    await k.openBoard({ template: 'blank' });
    const board = (await opened(k))?.documentId ?? '';
    // Priya presents Kofi's board: he can't take it off everyone's stage from under her.
    await p.startPresenting({ kind: 'board', id: board });
    const hers = (await presented(k))?.key;
    expect(await refusal(k.closeBoard())).toEqual({ code: 'conflict', status: 409, message: 'Someone else is presenting this board. You can close it once they stop.' });
    expect(await opened(host)).toMatchObject({ documentId: board });
    expect(await presented(host)).toMatchObject({ key: hers });
    // While she reloads, hers is in nobody's way: closing it ends hers for her alone, as nobody who may close hers for everyone did.
    p.closing();
    await settle(host, (s) => !s.participants.some((x) => x.id === p.ticket.identity));
    await k.closeBoard();
    expect((await read(host)).workspace).toMatchObject({ present: null, ended: { key: hers, close: false, by: by(priya) } });
    const back = await invited(host, c, priya, p.ticket.pass);
    expect(await presented(back)).toBeNull();
    // His own, presented, he closes: his presentation of it closes for everyone with it.
    await k.openBoard({ workspaceId: id, documentId: board, letIn: true });
    await k.startPresenting({ kind: 'board', id: board });
    const his = (await presented(back))?.key;
    await k.closeBoard();
    expect((await read(back)).workspace).toMatchObject({ present: null, ended: { key: his, close: true, by: by(kofi) } });
    // The organizer closes it whoever presents it, and that closes it for everyone.
    await k.openBoard({ workspaceId: id, documentId: board, letIn: true });
    await back.startPresenting({ kind: 'board', id: board });
    const again = (await presented(k))?.key;
    await host.closeBoard();
    for (const call of [k, back, host]) {
      const s = await read(call);
      expect(s.board.open).toBeNull();
      expect(s.workspace).toMatchObject({ present: null, ended: { key: again, close: true, by: by(priya) } });
    }
  });

  it('stays the organizer’s when whoever opened it has gone, and doesn’t go with hosting', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], workspace: id });
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    await k.openBoard({ template: 'blank' });
    await k.leave();
    await settle(host, (s) => !s.participants.some((x) => x.id === k.ticket.identity));
    expect(await opened(host)).toMatchObject({ openedBy: null, canClose: true });
    expect(await opened(p)).toMatchObject({ openedBy: null, canClose: false });
    expect(await code(p.closeBoard())).toBe('forbidden');
    await host.closeBoard();
    expect(await opened(p)).toBeNull();
  });
});

describe('a saved board', () => {
  async function room() {
    const art = await account();
    const priya = await account();
    const rita = await account();
    const theo = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit'], [rita, 'read']]);
    const board = await saved(art, id, 'Onboarding flow');
    const { host, code: c } = await callBy(art, { guests: [priya.email, rita.email, theo.email], title: 'Weekly', workspace: id });
    return { art, priya, rita, theo, id, board, host, code: c };
  }

  it('needs edit on it, and says who can’t open it before anything opens', async () => {
    const { art, priya, rita, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const r = await invited(host, c, rita);
    const t = await invited(host, c, theo);
    const jamie = await guest(host, c, 'Jamie Guest');
    const plan = (await art.api.workspaces.items.create(id, { kind: 'document', name: 'Plan' })).id;
    const folder = (await art.api.workspaces.items.create(id, { kind: 'folder', name: 'Folder' })).id;

    // Someone who can only read it can't bring it, and it isn't there for someone who can't open it.
    expect(await code(r.openBoard({ workspaceId: id, documentId: board, letIn: false }))).toBe('forbidden');
    expect(await code(r.boardCheck(id, board))).toBe('forbidden');
    expect(await code(t.openBoard({ workspaceId: id, documentId: board, letIn: false }))).toBe('not-found');
    expect(await code(t.boardCheck(id, board))).toBe('not-found');
    // Only a board is a board, and one in Trash is in Trash.
    for (const other of [plan, folder, madeUp()]) {
      expect(await code(p.openBoard({ workspaceId: id, documentId: other, letIn: false }))).toBe('not-found');
      expect(await code(p.boardCheck(id, other))).toBe('not-found');
    }
    expect(await refusal(p.openBoard({ workspaceId: id, documentId: plan, letIn: false }))).toEqual(await refusal(p.openBoard({ workspaceId: id, documentId: madeUp(), letIn: false })));
    const old = await saved(art, id, 'Old');
    await art.api.workspaces.items.trash(id, old);
    expect(await code(p.openBoard({ workspaceId: id, documentId: old, letIn: false }))).toBe('conflict');
    expect(await code(p.boardCheck(id, old))).toBe('conflict');
    expect(await opened(host)).toBeNull();

    // Who can't open it, by first name, in the order they came. Rita can read it, so she isn't one of them.
    const shown = await p.boardCheck(id, board);
    expect(shown).toEqual({ cannot: [first(theo), 'Jamie'], mayLetIn: true });
    expect(await host.boardCheck(id, board)).toEqual(shown);
    // Asking changes nothing.
    expect(await entries(board)).toBe(0);
    expect(await opened(t)).toBeNull();
    // Nobody who's gone is named.
    await jamie.call.leave();
    await settle(host, (s) => !s.participants.some((x) => x.id === jamie.call.ticket.identity));
    expect(await p.boardCheck(id, board)).toEqual({ cannot: [first(theo)], mayLetIn: true });
  });

  it('asks for the right to share it before letting anyone in, whatever else they can do', async () => {
    const { art, theo, id, board, host, code: c } = await room();
    const t = await invited(host, c, theo);
    await guest(host, c);
    // Theo can edit it and isn't in the workspace: that's the workspace's rule, and a call doesn't get round it.
    await art.api.workspaces.share.set(id, board, [{ email: theo.email }], 'edit');
    expect(await t.boardCheck(id, board)).toEqual({ cannot: ['Jamie'], mayLetIn: false });
    expect(await code(t.openBoard({ workspaceId: id, documentId: board, letIn: true }))).toBe('not-found');
    expect(await opened(t)).toBeNull();
    expect(await seats(board)).toBe(0);
    // Without letting anyone in, they can bring it.
    await t.openBoard({ workspaceId: id, documentId: board, letIn: false });
    expect(await opened(host)).toMatchObject({ documentId: board, openedBy: t.ticket.identity, role: 'edit' });
    expect(await seats(board)).toBe(0);
  });

  it('lets people in for the call: everyone who can’t open it, anyone admitted later, and it all ends with the call', async () => {
    const { art, priya, rita, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const r = await invited(host, c, rita);
    const t = await invited(host, c, theo);
    const jamie = await guest(host, c);
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(p.getSnapshot().board.open).toEqual({ workspaceId: id, documentId: board, name: 'Onboarding flow', openedBy: p.ticket.identity, canClose: true, everyone: false, role: 'edit', seal: 'Sealed', frame: null });
    // Only the people who couldn't open it: Rita keeps what the workspace gives her.
    expect(await seats(board)).toBe(2);
    for (const who of [t, jamie.call]) expect(await opened(who)).toMatchObject({ documentId: board, name: 'Onboarding flow', role: 'edit', canClose: false });
    expect(await opened(r)).toMatchObject({ documentId: board, role: 'read' });
    expect((await art.api.workspaces.share.list(id, board)).entries.map((e) => [e.kind, e.role]).sort()).toEqual([['seat', 'edit'], ['seat', 'edit']]);
    // They see that one board and nothing else in the workspace, by their seat.
    expect((await theo.api.workspaces.get(id, { pass: t.ticket.pass })).items.map((x) => x.id)).toEqual([board]);
    expect(await p.boardCheck(id, board)).toEqual({ cannot: [], mayLetIn: true });

    // Someone admitted later gets a seat too: it's a policy on the call, not a list.
    const sam = await guest(host, c, 'Sam Guest');
    await until(async () => (await opened(sam.call))?.role === 'edit', 'a seat for someone admitted later');
    expect(await seats(board)).toBe(3);
    // Closing leaves the policy where it was, and someone admitted now finds it when it's opened again.
    await p.closeBoard();
    const lee = await guest(host, c, 'Lee Guest');
    await until(async () => (await seats(board)) === 4, 'a seat for someone admitted while it’s closed');
    await p.openBoard({ workspaceId: id, documentId: board, letIn: false });
    expect(await opened(lee.call)).toMatchObject({ documentId: board, role: 'edit' });

    // It all ends with the call.
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'every seat to end with the call');
    expect(await code(theo.api.workspaces.get(id))).toBe('not-found');
    expect(inTree(await art.api.workspaces.get(id)).map((x) => x.id)).toEqual([board]);
    expect(await entries(board)).toBe(0);
  });

  it('opens without them: they see a board they can’t open, and so does anyone admitted later', async () => {
    const { priya, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    await p.openBoard({ workspaceId: id, documentId: board, letIn: false });
    const left = { workspaceId: null, documentId: null, name: null, openedBy: p.ticket.identity, canClose: false, everyone: false, role: null, seal: 'Sealed', frame: null };
    expect(await opened(t)).toEqual(left);
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toEqual(left);
    expect(await seats(board)).toBe(0);
    expect(await code(jamie.api.workspaces.get(id, { pass: jamie.call.ticket.pass }))).toBe('not-found');
    expect(await code(theo.api.workspaces.get(id, { pass: t.ticket.pass }))).toBe('not-found');
    // Anyone who can open it has it, and the organizer can still close what they can't.
    expect(await opened(host)).toMatchObject({ documentId: board, role: 'edit', canClose: true });
    // Letting them in afterwards is another choice, and takes in everyone here.
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await opened(t)).toMatchObject({ documentId: board, role: 'edit' });
    expect(await opened(jamie.call)).toMatchObject({ documentId: board, role: 'edit' });
  });

  it('keeps a seat taken back in Share taken back, and everything that’s been decided decided', async () => {
    const { art, priya, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c, 'Jamie Guest');
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await opened(jamie.call)).toMatchObject({ role: 'edit' });
    const entry = (await art.api.workspaces.share.list(id, board)).entries.find((e) => e.person.name === 'Jamie Guest');
    await art.api.workspaces.share.remove(id, board, entry?.id ?? '');
    expect(await opened(jamie.call)).toMatchObject({ role: null, documentId: null, name: null });
    // Someone else being let in doesn't give it back, and nor does Jamie reloading.
    const sam = await guest(host, c, 'Sam Guest');
    await until(async () => (await opened(sam.call))?.role === 'edit', 'a seat for Sam');
    expect(await opened(jamie.call)).toMatchObject({ role: null });
    jamie.call.closing();
    const back = await jamie.api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest', previous: jamie.call.ticket.pass });
    await letIn(host, back);
    await rest(150);
    expect(await opened(back)).toMatchObject({ role: null });
    expect(await seats(board)).toBe(1);
    // Someone who may share it choosing to let them in again is a new decision, about everyone here.
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await opened(back)).toMatchObject({ role: 'edit' });
    expect(await seats(board)).toBe(2);
  });

  it('keeps a seat taken back from someone signed in taken back on a saved board too, until someone lets them in again', async () => {
    const { art, priya, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await opened(t)).toMatchObject({ role: 'edit' });
    const taken = (await art.api.workspaces.share.list(id, board)).entries.find((e) => e.person.name === theo.name);
    await art.api.workspaces.share.remove(id, board, taken?.id ?? '');
    const again = await invited(host, c, theo);
    const jamie = await guest(host, c);
    await until(async () => (await opened(jamie.call))?.role === 'edit', 'a seat for Jamie');
    expect(await opened(again)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(1);
    // Someone who may share it letting everyone in again is a new decision, about everyone here, both his tabs included.
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await opened(again)).toMatchObject({ role: 'edit' });
    expect(await opened(t)).toMatchObject({ role: 'edit' });
    expect(await seats(board)).toBe(3);
  });

  it('stops letting people in once whoever did it can’t share it any more', async () => {
    const { art, priya, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    const people = await art.api.workspaces.people(id);
    await art.api.workspaces.removePerson(id, people.find((x) => x.person.email === priya.email)?.id ?? '');
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(0);
  });

  it('goes at once from anyone it’s restricted away from while it’s open, naming nothing, even whoever opened it', async () => {
    const { art, priya, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    const page = await open(priya, id, board, { pass: p.ticket.pass });
    await art.api.workspaces.share.restrict(id, board, true);
    // Priya had it through the workspace. She can still close it, as whoever opened it, and that's all she's told.
    const seen = await read(p);
    expect(seen.board.open).toEqual({ workspaceId: null, documentId: null, name: null, openedBy: p.ticket.identity, canClose: true, everyone: false, role: null, seal: 'Sealed', frame: null });
    expect(said(seen)).not.toContain('Onboarding flow');
    await until(() => page.getSnapshot().closed === 'access', 'her page to close');
    expect(await code(p.openBoard({ workspaceId: id, documentId: board, letIn: false }))).toBe('not-found');
    expect(await code(p.boardCheck(id, board))).toBe('not-found');
    // Its creator keeps it, and a seat is an entry, which restricting leaves: Share is where those are taken back.
    expect(await opened(host)).toMatchObject({ documentId: board, role: 'edit' });
    expect(await opened(t)).toMatchObject({ documentId: board, role: 'edit' });
    // Whoever let people in can't share it now, so nobody new gets a seat in her name.
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(1);
    await p.closeBoard();
    expect(await opened(host)).toBeNull();
  });

  it('gives the organizer a seat too when they come back to what they can’t open: being organizer gives nothing', async () => {
    const lena = await account();
    const art = await account();
    const priya = await account();
    const id = await workspace(lena, 'Lena’s', [[art, 'edit'], [priya, 'edit']]);
    const board = await saved(lena, id, 'Priya’s only');
    await lena.api.workspaces.share.restrict(id, board, true);
    await lena.api.workspaces.share.set(id, board, [{ email: priya.email }], 'edit');
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    const p = await invited(host, c, priya);
    inRoom.push(await connect(await p.room(), { sending: p.crypto }));
    await host.handOff(p.ticket.identity);
    await settle(p, (s) => s.isHost);
    await inGroup(p);
    await p.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await seats(board)).toBe(0);
    const back = await art.api.calls.join(c, { mic: false, cam: false });
    await inGroup(back);
    // Joining doesn't wait for the workspace: the seat lands a moment later.
    await until(async () => (await opened(back))?.role === 'edit', 'a seat for the organizer');
    expect(await opened(back)).toMatchObject({ documentId: board, role: 'edit', canClose: true });
    expect(await seats(board)).toBe(1);
  });

  it('opens from the workspace it’s in, whichever one the call views, and is nothing to someone who can’t open that', async () => {
    const { art, priya, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    const other = await workspace(art, 'Other', [[priya, 'edit'], [theo, 'edit']]);
    await host.setWorkspace(other);
    expect(await p.boardCheck(id, board)).toEqual({ cannot: [first(theo)], mayLetIn: true });
    // Someone who can't open the workspace it's in is told what anyone's told about nothing, wherever the call is.
    const nothing = madeUp();
    expect(await refusal(t.boardCheck(id, board))).toEqual(await refusal(t.boardCheck(id, nothing)));
    expect(await refusal(t.boardCheck(id, board))).toEqual(await refusal(t.boardCheck(madeUp(), nothing)));
    expect(await refusal(t.openBoard({ workspaceId: id, documentId: board, letIn: false }))).toEqual(await refusal(t.openBoard({ workspaceId: id, documentId: nothing, letIn: false })));
    await p.openBoard({ workspaceId: id, documentId: board, letIn: false });
    expect(await opened(host)).toMatchObject({ workspaceId: id, documentId: board, name: 'Onboarding flow' });
    // Picking another workspace interrupts nothing that's open, and a new board goes to the call's workspace as it is then, in
    // the call's folder there.
    await host.setWorkspace(id);
    expect(await opened(p)).toMatchObject({ workspaceId: id, documentId: board });
    await host.setWorkspace(other);
    expect(await opened(p)).toMatchObject({ workspaceId: id, documentId: board });
    await p.openBoard({ template: 'blank' });
    const fresh = await opened(host);
    expect(fresh).toMatchObject({ workspaceId: other });
    const there = (await art.api.workspaces.get(other)).items;
    expect(there.find((x) => x.id === fresh?.documentId)).toMatchObject({ kind: 'board', parent: there.find((x) => x.call !== null)?.id });
  });

  it('comes from anywhere its opener can edit it, never brought to the call and in neither of its workspaces', async () => {
    const art = await account();
    const priya = await account();
    const theo = await account();
    const home = await workspace(art, 'Weekly', [[priya, 'edit'], [theo, 'edit']]);
    const team = await workspace(priya, 'Design', [[art, 'read']]);
    const flow = await saved(priya, team, 'Onboarding flow');
    const { host, code: c } = await callBy(art, { guests: [priya.email, theo.email], title: 'Weekly', workspace: home });
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    // Art can read it and Theo can't open it: Priya is asked about Theo alone, and she may let him in.
    expect(await p.boardCheck(team, flow)).toEqual({ cannot: [first(theo)], mayLetIn: true });
    // Art can only read it, so he can't bring it, as anywhere.
    expect(await code(host.openBoard({ workspaceId: team, documentId: flow, letIn: false }))).toBe('forbidden');
    await p.openBoard({ workspaceId: team, documentId: flow, letIn: false });
    expect(await opened(p)).toMatchObject({ workspaceId: team, documentId: flow, name: 'Onboarding flow', role: 'edit', canClose: true, everyone: false });
    expect(await opened(host)).toMatchObject({ workspaceId: team, documentId: flow, role: 'read', canClose: true });
    expect(await opened(t)).toEqual({ workspaceId: null, documentId: null, name: null, openedBy: p.ticket.identity, canClose: false, everyone: false, role: null, seal: 'Sealed', frame: null });
    // Nothing moved: it's still where it was, and the call's workspace has nothing new.
    expect((await priya.api.workspaces.get(team)).items.map((x) => x.id)).toEqual([flow]);
    expect(inTree(await art.api.workspaces.get(home))).toEqual([]);
    // Letting him in is Priya's to do, from there, and he gets a seat for the call.
    await p.openBoard({ workspaceId: team, documentId: flow, letIn: true });
    await until(async () => (await opened(t))?.role === 'edit', 'a seat for Theo');
    expect(await opened(t)).toMatchObject({ workspaceId: team, documentId: flow, name: 'Onboarding flow' });
  });

  it('tells someone left out nothing about it: not in the call, an error or a log', async () => {
    const art = await account();
    const theo = await account();
    const id = await workspace(art, 'CANARY-SPACE Product');
    const board = await saved(art, id, 'CANARY-BOARD Onboarding flow');
    const { host, code: c } = await callBy(art, { guests: [theo.email], title: 'Weekly', workspace: id });
    const t = await invited(host, c, theo);
    const jamie = await guest(host, c);
    const from = h.logs.length;
    await host.openBoard({ workspaceId: id, documentId: board, letIn: false });
    expect(host.getSnapshot().board.open?.name).toBe('CANARY-BOARD Onboarding flow');
    for (const call of [t, jamie.call]) {
      const seen = await read(call);
      expect(seen.board.open).toEqual({ workspaceId: null, documentId: null, name: null, openedBy: host.ticket.identity, canClose: false, everyone: false, role: null, seal: 'Sealed', frame: null });
      for (const name of ['CANARY', id, board]) expect(said(seen), name).not.toContain(name);
    }
    // What they try reads the same as for what doesn't exist, in the same words.
    const nothing = madeUp();
    expect(await refusal(t.boardCheck(id, board))).toEqual(await refusal(t.boardCheck(id, nothing)));
    expect(await refusal(t.openBoard({ workspaceId: id, documentId: board, letIn: false }))).toEqual(await refusal(t.openBoard({ workspaceId: id, documentId: nothing, letIn: false })));
    expect(await refusal(t.openBoard({ workspaceId: id, documentId: board, letIn: true }))).toEqual(await refusal(t.openBoard({ workspaceId: id, documentId: nothing, letIn: true })));
    const closing = await refusal(t.closeBoard());
    expect(closing?.code).toBe('forbidden');
    expect(JSON.stringify(closing)).not.toContain('CANARY');
    expect(await code(theo.api.workspaces.get(id, { pass: t.ticket.pass }))).toBe('not-found');
    // And the same once the name has changed.
    await art.api.workspaces.items.rename(id, board, 'CANARY-RENAMED');
    expect(host.getSnapshot().board.open?.name).toBe('CANARY-BOARD Onboarding flow');
    expect(await opened(host)).toMatchObject({ name: 'CANARY-RENAMED' });
    expect(said(await read(t))).not.toContain('CANARY');
    // The log says what happened by ID, and nothing that names it.
    expect(h.logs.slice(from).join('')).not.toContain('CANARY');
    expect(linesSince(from).some((l) => l.msg === 'board opened' && l['documentId'] === board)).toBe(true);
  });
});

describe('someone who joins the invite during a call', () => {
  it('has a seat while they’re in it, and keeps a board the call made afterwards, unless they’re taken out', async () => {
    const art = await account();
    const nora = await account();
    const omar = await account();
    const pia = await account();
    const rosa = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id });
    // Signed in, not invited, and let in from the link: on the invite from now on, whether that's before the board or after it.
    const before = await pia.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, before);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const n = await nora.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, n);
    const o = await omar.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, o);
    const r = await rosa.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, r);
    expect((await read(n)).role).toBe('invited');
    await until(async () => (await Promise.all([n, o, r, before].map(opened))).every((x) => x?.role === 'edit'), 'a seat for each of them');
    // Whoever brings it back later, it's still the call's to give: someone here letting people in again doesn't make it theirs.
    await host.closeBoard();
    await host.openBoard({ workspaceId: id, documentId: board, letIn: true });
    // Taken out of the call, they lose it at once, and with the invite goes any claim on it.
    await host.remove(o.ticket.identity);
    await host.remove(before.ticket.identity);
    await until(async () => (await seats(board)) === 2, 'the seats to go with them');
    // A seat taken back in Share isn't given back as an address, though she stays on the invite.
    const taken = (await art.api.workspaces.share.list(id, board)).entries.find((e) => e.person.name === rosa.name);
    await art.api.workspaces.share.remove(id, board, taken?.id ?? '');
    expect(await opened(r)).toMatchObject({ role: null });
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seats to end with the call');
    expect((await nora.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'edit']]);
    for (const who of [omar, pia, rosa]) expect(await code(who.api.workspaces.get(id))).toBe('not-found');
  });
});

describe('a board the call made', () => {
  it('lets a teammate who can only read add to it, as it lets a guest: everyone here works on it', async () => {
    const art = await account();
    const rita = await account();
    const sara = await account();
    const id = await workspace(art, 'Product', [[rita, 'read'], [sara, 'read']]);
    const { host, code: c } = await callBy(art, { workspace: id });
    // In the call from the link, so not on the invite when it's made: the workspace lets her read it.
    const r = await rita.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, r);
    await host.openBoard({ template: 'retro' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    expect(await opened(r)).toMatchObject({ documentId: board, role: 'edit' });
    const page = await open(rita, id, board, { pass: r.ticket.pass });
    expect(page.getSnapshot().role).toBe('edit');
    page.doc.getMap('objects').set('a', 'a teammate’s sticky');
    await stored(page);
    expect(page.getSnapshot().refused).toBeNull();
    // And anyone like her who comes after it's open.
    const s = await sara.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, s);
    await until(async () => (await opened(s))?.role === 'edit', 'Sara to be able to add to it');
    // Her seat ends with the call, and being on the invite by then, she keeps it as anyone invited does.
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seats to end with the call');
    for (const who of [rita, sara]) expect(inTree(await who.api.workspaces.get(id)).map((x) => [x.id, x.role])).toEqual([[board, 'edit']]);
  });

  it('stops being given to anyone new once someone restricts it: that’s someone deciding who has it', async () => {
    const art = await account();
    const nora = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const n = await nora.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, n);
    await until(async () => (await opened(n))?.role === 'edit', 'a seat for Nora');
    expect(await opened(n)).toMatchObject({ everyone: true });
    await art.api.workspaces.share.restrict(id, board, true);
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(1);
    // Nobody is told everyone here can add to it any more: not Art, not Nora, who keeps her seat, and not Jamie.
    expect(await opened(host)).toMatchObject({ role: 'edit', everyone: false });
    expect(await opened(n)).toMatchObject({ role: 'edit', everyone: false });
    expect(await opened(jamie.call)).toMatchObject({ everyone: false });
    // A seat she had stays until the call ends, and nothing turns it into an address.
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seats to end with the call');
    expect(await entries(board)).toBe(0);
    expect(await code(nora.api.workspaces.get(id))).toBe('not-found');
  });

  it('stops being given to anyone new once the organizer can’t edit in its workspace', async () => {
    const lena = await account();
    const art = await account();
    const nora = await account();
    const id = await workspace(lena, 'Lena’s', [[art, 'edit']]);
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const n = await nora.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, n);
    await until(async () => (await opened(n))?.role === 'edit', 'a seat for Nora');
    expect(await opened(host)).toMatchObject({ everyone: true });
    const people = await lena.api.workspaces.people(id);
    await lena.api.workspaces.setRole(id, people.find((p) => p.person.email === art.email)?.id ?? '', 'read');
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(1);
    // It isn't the call's to give, so nobody is told everyone here can add to it.
    expect(await opened(host)).toMatchObject({ everyone: false });
    expect(await opened(n)).toMatchObject({ role: 'edit', everyone: false });
    expect(await opened(jamie.call)).toMatchObject({ everyone: false });
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seats to end with the call');
    expect(await entries(board)).toBe(0);
    expect(await code(nora.api.workspaces.get(id))).toBe('not-found');
  });

  it('can still be opened to people by someone who may share it, on their word and not the call’s', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    await art.api.workspaces.share.restrict(id, board, true);
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toMatchObject({ role: null });
    // Art made it, so Art can share it. Everyone here is let in, and so is anyone after.
    await host.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await opened(jamie.call)).toMatchObject({ role: 'edit' });
    const sam = await guest(host, c, 'Sam Guest');
    await until(async () => (await opened(sam.call))?.role === 'edit', 'a seat for Sam');
  });

  it('gives someone taken out of the call nothing opened after they went, and leaves them what they had, as the note does', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], workspace: id });
    const k = await invited(host, c, kofi);
    await invited(host, c, priya);
    await host.openBoard({ template: 'blank' });
    const before = host.getSnapshot().board.open?.documentId ?? '';
    await host.remove(k.ticket.identity);
    await host.openBoard({ template: 'blank' });
    const after = host.getSnapshot().board.open?.documentId ?? '';
    expect((await art.api.workspaces.share.list(id, after)).entries.map((e) => e.person.email)).toEqual([priya.email]);
    await host.leave();
    await until(async () => (await count("SELECT count(*)::int AS n FROM document_access WHERE kind = 'seat' AND call_id = $1", [host.ticket.callId])) === 0, 'the seats to end with the call');
    expect((await kofi.api.workspaces.get(id)).items.map((x) => x.id)).toEqual([before]);
    expect((await priya.api.workspaces.get(id)).items.map((x) => x.id).sort()).toEqual([before, after].sort());
  });

  it('stays with someone taken out who was back by the time it was made, as it does with anyone invited who’s here', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    await host.remove(k.ticket.identity);
    await invited(host, c, kofi);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    expect((await art.api.workspaces.share.list(id, board)).entries.map((e) => [e.kind, e.person.email, e.role])).toEqual([['email', kofi.email, 'edit']]);
    await host.leave();
    expect((await kofi.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'edit']]);
  });

  it('is for the call only for someone taken out who came back after it was made', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    await host.remove(k.ticket.identity);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    // They press Join with the pass they had. That brings nobody back as themselves, and they're invited, so nobody's asked.
    const back = await invited(host, c, kofi, k.ticket.pass);
    await until(async () => (await opened(back))?.role === 'edit', 'a seat for Kofi');
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seat to end with the call');
    expect(await entries(board)).toBe(0);
    expect(await code(kofi.api.workspaces.get(id))).toBe('not-found');
  });
});

describe('what someone decided about a board the call made', () => {
  it('keeps an address taken back in Share taken back, through a new tab and after the call', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    const p = await invited(host, c, priya);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    expect(await opened(p)).toMatchObject({ role: 'edit' });
    const entry = (await art.api.workspaces.share.list(id, board)).entries.find((e) => e.person.email === priya.email);
    await art.api.workspaces.share.remove(id, board, entry?.id ?? '');
    expect(await opened(p)).toMatchObject({ role: null });
    // A new tab has no earlier pass, so it's a new person, and she's invited, so nobody's asked. It's still her.
    const again = await invited(host, c, priya);
    await rest(150);
    expect(await opened(again)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(0);
    await host.leave();
    expect(await entries(board)).toBe(0);
    expect(await code(priya.api.workspaces.get(id))).toBe('not-found');
  });

  it('keeps an address taken back before they arrive taken back', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const entry = (await art.api.workspaces.share.list(id, board)).entries[0];
    await art.api.workspaces.share.remove(id, board, entry?.id ?? '');
    const p = await invited(host, c, priya);
    await rest(150);
    expect(await opened(p)).toMatchObject({ role: null });
    await host.leave();
    expect(await code(priya.api.workspaces.get(id))).toBe('not-found');
  });

  it('leaves someone set to read at read, in the call and after it, whoever lets people in', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    await art.api.workspaces.share.set(id, board, [{ email: priya.email }], 'read');
    const p = await invited(host, c, priya);
    await rest(150);
    expect(await opened(p)).toMatchObject({ documentId: board, role: 'read' });
    expect(await seats(board)).toBe(0);
    // Letting everyone in is about who can't open it, and she can.
    await host.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await opened(p)).toMatchObject({ role: 'read' });
    expect(await seats(board)).toBe(0);
    await host.leave();
    expect((await priya.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'read']]);
  });

  it('doesn’t let a seat become anything lasting: someone who can only read can’t hand the board on', async () => {
    const art = await account();
    const rita = await account();
    const out = await account();
    const id = await workspace(art, 'Product', [[rita, 'read']]);
    const { host, code: c } = await callBy(art, { workspace: id });
    const r = await rita.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, r);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    expect(await opened(r)).toMatchObject({ role: 'edit' });
    const pass = { pass: r.ticket.pass };
    const told = { code: 'forbidden', status: 403, message: 'You can work on this in the call, but you can’t share it.' };
    expect(await refusal(rita.api.workspaces.share.set(id, board, [{ email: out.email }], 'edit', pass))).toEqual(told);
    expect(await r.boardCheck(id, board)).toEqual({ cannot: [], mayLetIn: false });
    expect(await code(r.openBoard({ workspaceId: id, documentId: board, letIn: true }))).toBe('forbidden');
    await host.leave();
    expect(await code(out.api.workspaces.get(id))).toBe('not-found');
  });

  it('keeps a seat set to read at read when it becomes an address', async () => {
    const art = await account();
    const rosa = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const r = await rosa.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, r);
    await until(async () => (await opened(r))?.role === 'edit', 'a seat for Rosa');
    const seat = (await read(host)).participants.find((p) => p.id === r.ticket.identity)?.seat ?? '';
    await art.api.workspaces.share.set(id, board, [{ seat }], 'read', { pass: host.ticket.pass });
    expect(await opened(r)).toMatchObject({ role: 'read' });
    // A new tab is a new seat, seated as her other seat stands: at read. And the one that was set to read still counts.
    const again = await rosa.api.calls.join(c, { mic: false, cam: false });
    await inGroup(again);
    await until(async () => (await seats(board)) === 2, 'a seat for the new tab');
    expect(await opened(again)).toMatchObject({ documentId: board, role: 'read' });
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seats to end with the call');
    expect((await rosa.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'read']]);
  });

  it('keeps a seat taken back from someone signed in taken back, from a new tab too, and after the call', async () => {
    const art = await account();
    const rosa = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const r = await rosa.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, r);
    await until(async () => (await opened(r))?.role === 'edit', 'a seat for Rosa');
    const taken = (await art.api.workspaces.share.list(id, board)).entries.find((e) => e.person.name === rosa.name);
    await art.api.workspaces.share.remove(id, board, taken?.id ?? '');
    expect(await opened(r)).toMatchObject({ role: null });
    // A new tab has no earlier pass, so it's a new person on a new seat. The call knows her by her address, so it's seated as
    // her other seat stands: not at all.
    const again = await rosa.api.calls.join(c, { mic: false, cam: false });
    await inGroup(again);
    // Someone let in after her is seated as anyone is, and by then her new tab has been worked out too.
    const jamie = await guest(host, c);
    await until(async () => (await opened(jamie.call))?.role === 'edit', 'a seat for Jamie');
    expect(await opened(again)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(1);
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seats to end with the call');
    expect(await entries(board)).toBe(0);
    expect(await code(rosa.api.workspaces.get(id))).toBe('not-found');
  });

  it('starts afresh for someone taken out and let in again: letting them back is the organizer’s new decision', async () => {
    const art = await account();
    const omar = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const o = await omar.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, o);
    await until(async () => (await opened(o))?.role === 'edit', 'a seat for Omar');
    await host.remove(o.ticket.identity);
    await until(async () => (await seats(board)) === 0, 'his seat to go with him');
    // He asks again and the organizer lets him in: someone new to the call, back on the invite.
    const back = await omar.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, back);
    await until(async () => (await opened(back))?.role === 'edit', 'a seat for Omar, let in again');
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seat to end with the call');
    expect((await omar.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'edit']]);
  });

  it('leaves an entry someone gave an address as it is, when a seat would have become one', async () => {
    const art = await account();
    const nora = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const n = await nora.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, n);
    await until(async () => (await opened(n))?.role === 'edit', 'a seat for Nora');
    await art.api.workspaces.share.set(id, board, [{ email: nora.email }], 'read');
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seat to end with the call');
    expect((await nora.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'read']]);
  });
});

describe('keeping seats in step', () => {
  it('puts right at the next upkeep a seat that a crash kept from someone let in', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const jamie = await guest(host, c);
    await until(async () => (await opened(jamie.call))?.role === 'edit', 'a seat for Jamie');
    // As it stands if the process stopped after they were let in and before anything was done about their seat.
    await h.pool.query("DELETE FROM document_access WHERE document_id = $1 AND kind = 'seat'", [board]);
    const was = await storedCall(art.ownerId, host.ticket.callId);
    const kept = z.object({ open: z.record(z.string(), z.unknown()), letIn: z.array(z.object({ seen: z.array(z.string()) }).passthrough()) }).parse(was.state['board']);
    const forgotten = { ...kept, letIn: kept.letIn.map((e) => ({ ...e, seen: e.seen.slice(0, 1) })) };
    await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [art.ownerId, host.ticket.callId, sealJson(was.key, was.header, toJson({ ...was.state, board: forgotten }))]);
    expect(await opened(jamie.call)).toMatchObject({ role: null });
    await reconcile(h.deps);
    expect(await opened(jamie.call)).toMatchObject({ documentId: board, role: 'edit' });
    expect(await seats(board)).toBe(1);
  });

  it('doesn’t let one board that can’t take anyone more stop the rest, in its workspace or another', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const other = await workspace(art, 'Other');
    const { host, code: c } = await callBy(art, { workspace: id });
    await host.openBoard({ template: 'blank' });
    const full = host.getSnapshot().board.open?.documentId ?? '';
    await host.openBoard({ template: 'blank' });
    const beside = host.getSnapshot().board.open?.documentId ?? '';
    await host.setWorkspace(other);
    // One in another workspace: a board saved there, brought to the call.
    const elsewhere = await saved(art, other, 'Elsewhere');
    await host.openBoard({ workspaceId: other, documentId: elsewhere, letIn: true });
    for (let i = 0; i < 5; i++) await art.api.workspaces.share.set(id, full, Array.from({ length: 100 }, () => ({ email: unique('full') })), 'read');
    expect(await entries(full)).toBe(500);
    const from = h.logs.length;
    const jamie = await guest(host, c);
    await until(async () => (await seats(beside)) === 1 && (await seats(elsewhere)) === 1, 'the seats that can be given');
    expect(await opened(jamie.call)).toMatchObject({ documentId: elsewhere, role: 'edit' });
    expect(await seats(full)).toBe(0);
    expect(linesSince(from).find((l) => l.msg === 'seats on a board not kept up')).toMatchObject({ level: 40, documentId: full });
  });
});

describe('the workspace a board is saved in', () => {
  it('is the meeting’s, when it has one', async () => {
    const art = await account();
    const kofi = await account();
    const product = await workspace(art, 'Product');
    await workspace(art, 'Used since');
    const m = await art.api.meetings.create({ title: 'Weekly', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [kofi.email], notes: 'off', workspaceId: product });
    const host = await art.api.calls.join(m.code, { mic: false, cam: false });
    await inGroup(host);
    const k = await invited(host, m.code, kofi);
    await k.openBoard({ template: 'blank' });
    expect(await opened(host)).toMatchObject({ workspaceId: product, name: 'Weekly' });
  });

  it('is nowhere in a call with none: nothing makes one for a board, and the organizer’s New workspace is where they go', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: null });
    const k = await invited(host, c, kofi);
    const told = { code: 'conflict', status: 409, message: 'This call has no workspace yet, so there’s nowhere to keep a new board. The organizer chooses one.' };
    expect(await Promise.all([k.openBoard({ template: 'blank' }), host.openBoard({ template: 'retro' })].map(refusal))).toEqual([told, told]);
    expect(await art.api.workspaces.list()).toEqual([]);
    expect(await opened(host)).toBeNull();
    expect((await art.api.meetings.get(host.getSnapshot().meetingId)).workspaceId).toBeNull();

    // The organizer makes one: it's the call's, the board goes there, and Kofi's in it because he's invited.
    const made = await withWorkspace(host);
    await Promise.all([k.openBoard({ template: 'blank' }), host.openBoard({ template: 'blank' })]);
    const mine = await art.api.workspaces.list();
    expect(mine).toEqual([expect.objectContaining({ id: made, role: 'admin', people: 2, name: `${first(art)}’s call` })]);
    expect(await opened(host)).toMatchObject({ workspaceId: made });
    expect(inTree(await art.api.workspaces.get(made))).toHaveLength(2);
    expect((await kofi.api.workspaces.list()).filter((x) => x.role !== null)).toEqual([expect.objectContaining({ id: made, role: 'edit' })]);
    expect((await read(k)).workspace).toMatchObject({ id: made, chosen: true, name: `${first(art)}’s call`, role: 'edit', canOpen: true });
  });

  it('is the one the organizer picks from then on, and a board made before stays where it was', async () => {
    const art = await account();
    const kofi = await account();
    const firstOne = await workspace(art, 'First');
    const second = await workspace(art, 'Second');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: null });
    const k = await invited(host, c, kofi);
    await host.setWorkspace(firstOne);
    await k.openBoard({ template: 'blank' });
    const before = (await opened(host))?.documentId ?? '';
    expect(await opened(host)).toMatchObject({ workspaceId: firstOne });
    // Picking another moves where a new board goes; what's open stays open, where it's saved.
    await host.setWorkspace(second);
    expect(await opened(k)).toMatchObject({ workspaceId: firstOne, documentId: before });
    await k.openBoard({ template: 'blank' });
    expect(await opened(host)).toMatchObject({ workspaceId: second });
    expect(inTree(await art.api.workspaces.get(firstOne)).map((x) => x.id)).toEqual([before]);
    expect(inTree(await art.api.workspaces.get(second))).toHaveLength(1);
    expect((await art.api.meetings.get(host.getSnapshot().meetingId)).workspaceId).toBe(second);
  });

  it('carries on to the next call in a series', async () => {
    const art = await account();
    const at = Date.now() + 3_600_000;
    const week = (n: number) => new Date(at + n * 7 * 86_400_000).toISOString();
    const series = await art.api.meetings.create({
      title: 'Weekly', startsAt: week(0), durationMinutes: 30, guests: [], notes: 'off',
      repeat: { rule: { every: 'week', weeks: 1, days: [new Date(week(0)).getUTCDay()] }, until: week(1).slice(0, 10), timeZone: 'UTC', occurrences: [week(0), week(1)] }
    });
    const calls = (await art.api.meetings.upcoming()).filter((x) => x.seriesId === series.seriesId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const host = await art.api.calls.join(calls[0]?.code ?? '', { mic: false, cam: false });
    await inGroup(host);
    const settled = await withWorkspace(host);
    await host.openBoard({ template: 'blank' });
    expect(host.getSnapshot().board.open?.workspaceId).toBe(settled);
    await until(async () => (await art.api.meetings.get(calls[1]?.id ?? '')).workspaceId === settled, 'the next call to follow');
    await host.leave();
    const next = await art.api.calls.join(calls[1]?.code ?? '', { mic: false, cam: false });
    await inGroup(next);
    await next.openBoard({ template: 'blank' });
    expect(next.getSnapshot().board.open?.workspaceId).toBe(settled);
    expect(inTree(await art.api.workspaces.get(settled))).toHaveLength(2);
    // The next call scheduled by hand takes it along too.
    const later = await art.api.meetings.scheduleNext(calls[1]?.id ?? '', new Date(at + 21 * 86_400_000).toISOString());
    expect(later.workspaceId).toBe(settled);
  });

  it('is heard for the workspace a request names and no more: someone else’s board reads as one that isn’t there', async () => {
    const art = await account();
    const lena = await account();
    const kofi = await account();
    const product = await workspace(art, 'Product');
    const hers = await workspace(lena, 'CANARY-HERS');
    const hidden = await saved(lena, hers, 'CANARY-HIDDEN');
    const mine = await saved(art, product, 'Product board');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: product });
    const k = await invited(host, c, kofi);
    const nothing = madeUp();
    for (const call of [host, k]) {
      // Her workspace, or her board said to be in his: the same as a workspace and a board that don't exist.
      for (const [workspaceId, documentId] of [[hers, hidden], [product, hidden], [hers, mine]] as const) {
        expect(await refusal(call.openBoard({ workspaceId, documentId, letIn: false }))).toEqual(await refusal(call.openBoard({ workspaceId: madeUp(), documentId: nothing, letIn: false })));
        expect(await refusal(call.openBoard({ workspaceId, documentId, letIn: true }))).toEqual(await refusal(call.openBoard({ workspaceId: madeUp(), documentId: nothing, letIn: true })));
        expect(await refusal(call.boardCheck(workspaceId, documentId))).toEqual(await refusal(call.boardCheck(madeUp(), nothing)));
        expect(await code(call.boardCheck(workspaceId, documentId))).toBe('not-found');
      }
    }
    const sent = await action(art, host, { type: 'board-open', workspaceId: hers, documentId: hidden, letIn: false });
    expect(sent.status).toBe(404);
    expect(await sent.text()).not.toContain('CANARY');
    // A new board isn't something a request can put anywhere: it goes to the call's workspace.
    const into = await action(art, host, { type: 'board-open', template: 'blank', workspaceId: hers, parent: hidden });
    expect(into.status).toBe(200);
    expect((await lena.api.workspaces.get(hers)).items.map((x) => x.id)).toEqual([hidden]);
    expect(inTree(await art.api.workspaces.get(product)).map((x) => x.kind)).toEqual(['board', 'board']);
    expect(await opened(host)).toMatchObject({ workspaceId: product });
    // Nor does a meeting take one its organizer can't reach, so nothing brings it into the call that way.
    expect(await code(art.api.meetings.update(host.getSnapshot().meetingId, { workspaceId: hers }))).toBe('not-found');
    // Nor can a browser reach what isn't theirs with a pass from this call.
    expect(await code(kofi.api.workspaces.get(hers, { pass: k.ticket.pass }))).toBe('not-found');
    // A board in this call's workspace from another call's point of view is nobody's business either.
    const elsewhere = await callBy(lena, { workspace: null });
    await elsewhere.host.setWorkspace(hers);
    const theirs = elsewhere.host;
    expect(await refusal(theirs.openBoard({ workspaceId: product, documentId: (await opened(host))?.documentId ?? '', letIn: false }))).toEqual(await refusal(theirs.openBoard({ workspaceId: product, documentId: nothing, letIn: false })));
  });
});

describe('breakout rooms', () => {
  it('are their own part of the call: a main board doesn’t show there, and a saved one can’t be brought there', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id });
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    host.openRooms({ rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [] }], minutes: 5, board: NO_ROOM_BOARD });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await until(() => k.crypto.getSnapshot().place === rooms[0]?.id, 'Kofi to be in their room');
    expect(await opened(k)).toBeNull();
    expect(await opened(host)).toMatchObject({ documentId: board });
    const told = { code: 'conflict', status: 409, message: 'Open a board from the main room.' };
    expect(await refusal(k.openBoard({ workspaceId: id, documentId: board, letIn: false }))).toEqual(told);
    expect(await refusal(k.boardCheck(id, board))).toEqual(told);
    expect(await refusal(k.closeBoard())).toMatchObject({ code: 'conflict', message: 'No board is open here.' });
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    await until(async () => (await opened(k))?.documentId === board, 'Kofi to find it back in the main room');
  });

  it('counts whoever’s in one among the people a main board leaves out, and seats them too', async () => {
    const art = await account();
    const theo = await account();
    const id = await workspace(art, 'Product');
    const board = await saved(art, id, 'Onboarding flow');
    const { host, code: c } = await callBy(art, { guests: [theo.email], workspace: id });
    const t = await invited(host, c, theo);
    host.openRooms({ rooms: [{ name: 'One', emails: [theo.email] }, { name: 'Two', emails: [] }], minutes: 5, board: NO_ROOM_BOARD });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await until(() => t.crypto.getSnapshot().place === rooms[0]?.id, 'Theo to be in their room');
    expect(await host.boardCheck(id, board)).toEqual({ cannot: [first(theo)], mayLetIn: true });
    await host.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await seats(board)).toBe(1);
    expect(await opened(t)).toBeNull();
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    await until(async () => (await opened(t))?.role === 'edit', 'Theo to find it back in the main room');
  });
});

/** Nothing for rooms to work on. */
const NO_ROOM_BOARD: BreakoutBoard = { mode: 'none', template: 'blank' };
/**
 * A call Art hosts in Product, with Kofi and Priya invited and in it, and rooms open as the organizer opens them, waited for:
 * Kofi in One, Priya in Two. Maya is in Product too, and isn't invited. Kofi and Priya are in Product, so a room's board is
 * something its workspace's own people don't have.
 */
async function inRooms(board: BreakoutBoard, o: { main?: 'retro' | undefined; notes?: 'on' | 'off'; said?: string } = {}) {
  const art = await account();
  const kofi = await account();
  const priya = await account();
  const maya = await account();
  const id = await workspace(art, 'Product', [[kofi, 'edit'], [priya, 'edit'], [maya, 'edit']]);
  const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], workspace: id, title: 'Launch retro', notes: o.notes ?? 'off' });
  const k = await invited(host, c, kofi);
  const p = await invited(host, c, priya);
  if (o.main) await host.openBoard({ template: o.main });
  // Something the organizer says in the main room before rooms open, as everyone there heard it.
  if (o.said) await host.transcribe(speech(o.said, 0), host.ticket.identity);
  const res = await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [priya.email] }], minutes: 10, board });
  expect(res.status).toBe(200);
  const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
  const one = rooms[0]?.id ?? '';
  const two = rooms[1]?.id ?? '';
  await until(() => k.crypto.getSnapshot().place === one, 'Kofi to be in One');
  await until(() => p.crypto.getSnapshot().place === two, 'Priya to be in Two');
  // In their rooms' groups, so nothing about letting them in is still on its way when a test goes on.
  await inGroup(k);
  await inGroup(p);
  await rest(300);
  return { art, kofi, priya, maya, id, host, code: c, k, p, one, two };
}
/** Someone's own page on a board, opened as a browser opens one: with their call's pass, or not. */
const pageOf = (who: Account, id: string, board: string, call?: CallSession) => open(who, id, board, call ? { pass: call.ticket.pass } : {});
/** Whether someone can open a board now: what opening it comes to. */
const opens = async (who: Account, id: string, board: string, call?: CallSession) => code(pageOf(who, id, board, call).then((s) => s.close()));
/** A sticky with these words. */
const sticky = (t: string, x: number, y: number): NewObject => ({ k: 'note', x, y, w: 150, h: 150, c: 'butter', size: 'm', t });
/** Brings everyone back, as the organizer's browser does when time is up, and waits for the call to say so. */
async function closeAll(r: { art: Account; host: CallSession }) {
  expect((await action(r.art, r.host, { type: 'rooms-close' })).status).toBe(200);
  await settle(r.host, (s) => s.breakouts.open === null);
}
/** The main board as whoever hosts sees it now, read whole. */
async function mainBoard(r: { art: Account; id: string; host: CallSession }) {
  const shown = await opened(r.host);
  if (!shown?.documentId) return null;
  const page = await pageOf(r.art, r.id, shown.documentId, r.host);
  const board = readBoard(page.doc);
  page.close();
  return { id: shown.documentId, board };
}
/** Time's up for the rooms, and nobody has said so: the next thing to save the call finds them closed. */
async function timeIsUp(r: { art: Account; host: CallSession }) {
  const was = await storedCall(r.art.ownerId, r.host.ticket.callId);
  const Open = z.object({ breakouts: z.object({ open: z.record(z.string(), z.unknown()) }).passthrough() }).passthrough();
  const open = Open.parse(was.state);
  const ended = { ...open, breakouts: { ...open.breakouts, open: { ...open.breakouts.open, until: 0 } } };
  await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [r.art.ownerId, r.host.ticket.callId, sealJson(was.key, was.header, toJson(ended))]);
}
/** What the call keeps of its rooms and boards, as it's stored now. */
const Kept = z.object({
  breakouts: z.object({ open: z.unknown().nullable() }).passthrough(),
  board: z.object({ open: z.record(z.string(), z.unknown()), landing: z.unknown().nullable(), rooms: z.array(z.object({ documentId: z.string(), room: z.string(), kept: z.boolean() })) }).passthrough()
}).passthrough();
const keptOf = async (r: { art: Account; host: CallSession }) => Kept.parse((await storedCall(r.art.ownerId, r.host.ticket.callId)).state);
/** How many entries a part of the call has in its MLS log. */
const keysOf = (callId: string, place: string) => count('SELECT count(*)::int AS n FROM call_mls WHERE call_id = $1 AND grp = $2', [callId, place]);

describe('boards in breakout rooms', () => {
  it('in each room: made as rooms open, filled, sealed to the room, and nothing to anyone outside it, the workspace’s own people and the organizer included', async () => {
    const r = await inRooms({ mode: 'each', template: 'retro' });
    const one = await opened(r.k);
    const two = await opened(r.p);
    expect(one).toEqual({ workspaceId: r.id, documentId: expect.any(String), name: 'One board', openedBy: r.host.ticket.identity, canClose: false, everyone: true, role: 'edit', seal: 'Sealed to this room', frame: null });
    expect(two).toMatchObject({ workspaceId: r.id, name: 'Two board', role: 'edit', seal: 'Sealed to this room' });
    const oneId = one?.documentId ?? '';
    const twoId = two?.documentId ?? '';
    // Everyone arrives to its frames: the template was there before the rooms opened.
    const page = await pageOf(r.kofi, r.id, oneId, r.k);
    expect(readBoard(page.doc).frames.map((f) => f.title)).toEqual(['Went well', 'Could improve', 'Actions']);
    page.close();
    // Priya is in the workspace, and in another room; Maya is in the workspace and not in the call; the organizer is in the
    // main room, and the workspace's admin. None of them opens it, with a pass or without.
    expect(await opens(r.priya, r.id, oneId, r.p)).toBe('not-found');
    expect(await opens(r.priya, r.id, oneId)).toBe('not-found');
    expect(await opens(r.maya, r.id, oneId)).toBe('not-found');
    expect(await opens(r.art, r.id, oneId, r.host)).toBe('not-found');
    expect(await opens(r.art, r.id, oneId)).toBe('not-found');
    // Nor does the workspace show it to them: it's restricted, and nobody's.
    for (const who of [r.maya, r.art]) expect((await who.api.workspaces.get(r.id)).items.map((x) => x.id)).not.toEqual(expect.arrayContaining([oneId]));
    const theirs = (await r.kofi.api.workspaces.get(r.id, { pass: r.k.ticket.pass })).items.find((x) => x.id === oneId);
    expect(theirs).toMatchObject({ kind: 'board', name: 'One board', restricted: true, by: null, role: 'edit' });
    expect((await r.kofi.api.workspaces.get(r.id, { pass: r.k.ticket.pass })).items.map((x) => x.id)).not.toContain(twoId);
    // The organizer is told each room is on its board, and nothing that names it.
    const seen = await read(r.host);
    expect(seen.board.open).toBeNull();
    expect(seen.breakouts.open).toMatchObject({ board: 'each', rooms: [{ id: r.one, board: true }, { id: r.two, board: true }] });
    expect(said(seen)).not.toContain('One board');
    expect(await seats(oneId)).toBe(1);
    expect(await entries(oneId)).toBe(1);
  });

  it('started in a room: the same menu, for the room alone, and whoever started it has it only while they’re in it', async () => {
    const r = await inRooms(NO_ROOM_BOARD);
    expect(await opened(r.k)).toBeNull();
    expect((await read(r.host)).breakouts.open).toMatchObject({ board: 'none', rooms: [{ board: false }, { board: false }] });
    await r.k.openBoard({ template: 'ideas' });
    const made = await opened(r.k);
    expect(made).toEqual({ workspaceId: r.id, documentId: expect.any(String), name: 'One board', openedBy: r.k.ticket.identity, canClose: true, everyone: true, role: 'edit', seal: 'Sealed to this room', frame: null });
    const board = made?.documentId ?? '';
    // It's the room's, not the main room's, and not Priya's room's.
    expect(await opened(r.host)).toBeNull();
    expect(await opened(r.p)).toBeNull();
    expect((await read(r.host)).breakouts.open?.rooms.map((x) => x.board)).toEqual([true, false]);
    // A saved board is still the main room's to bring.
    const told = { code: 'conflict', status: 409, message: 'Open a board from the main room.' };
    expect(await refusal(r.k.openBoard({ workspaceId: r.id, documentId: board, letIn: false }))).toEqual(told);
    expect(await refusal(r.k.boardCheck(r.id, board))).toEqual(told);
    // Kofi started it, and nothing of that is kept: moved to Two, he can't open it, and Priya, moved to One, can.
    expect((await action(r.art, r.host, { type: 'rooms-move', email: r.kofi.email, roomId: r.two })).status).toBe(200);
    expect(await opens(r.kofi, r.id, board, r.k)).toBe('not-found');
    expect(await opens(r.kofi, r.id, board)).toBe('not-found');
    expect((await action(r.art, r.host, { type: 'rooms-move', email: r.priya.email, roomId: r.one })).status).toBe(200);
    expect(await opens(r.priya, r.id, board, r.p)).toBe('allowed');
    expect(await opened(r.p)).toMatchObject({ documentId: board, canClose: false, role: 'edit' });
    expect(await opened(r.k)).toBeNull();
  });

  it('goes with whoever moves, at once: moved out loses it, moved in has it, and the organizer has it only while visiting', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' });
    const one = (await opened(r.k))?.documentId ?? '';
    const two = (await opened(r.p))?.documentId ?? '';
    const kofisPage = await pageOf(r.kofi, r.id, one, r.k);
    // Being organizer gives nothing: visiting One gives its board, as soon as they're there, and leaving takes it.
    expect(await opens(r.art, r.id, one, r.host)).toBe('not-found');
    expect((await action(r.art, r.host, { type: 'rooms-visit', roomId: r.one })).status).toBe(200);
    const visiting = await pageOf(r.art, r.id, one, r.host);
    expect(visiting.getSnapshot().role).toBe('edit');
    expect(await opened(r.host)).toMatchObject({ documentId: one, seal: 'Sealed to this room', canClose: true });
    expect((await action(r.art, r.host, { type: 'rooms-visit', roomId: null })).status).toBe(200);
    expect(await opens(r.art, r.id, one, r.host)).toBe('not-found');
    await until(() => visiting.getSnapshot().closed === 'access', 'the organizer’s page to close as they leave the room');
    expect(await opened(r.host)).toBeNull();
    // Kofi, moved to Two: One's board goes and Two's comes, before he's told.
    expect((await action(r.art, r.host, { type: 'rooms-move', email: r.kofi.email, roomId: r.two })).status).toBe(200);
    expect(await opens(r.kofi, r.id, one, r.k)).toBe('not-found');
    expect(await opens(r.kofi, r.id, two, r.k)).toBe('allowed');
    await until(() => kofisPage.getSnapshot().closed === 'access', 'his page on One’s board to close');
    // Back in the main room, neither.
    expect((await action(r.art, r.host, { type: 'rooms-move', email: r.kofi.email, roomId: null })).status).toBe(200);
    expect(await opens(r.kofi, r.id, two, r.k)).toBe('not-found');
    expect(await seats(one)).toBe(0);
    expect(await seats(two)).toBe(1);
  });

  it('seats whoever’s in each room on its board as rooms open, before anyone’s told', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], workspace: id });
    await invited(host, c, kofi);
    await invited(host, c, priya);
    const res = await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [priya.email] }], minutes: 10, board: { mode: 'each', template: 'blank' } });
    expect(res.status).toBe(200);
    // By the time the organizer hears the rooms are open, each room's board is its people's: nothing waits for keys to move.
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE call_id = $1 AND kind = 'seat'", [host.ticket.callId])).toBe(2);
  });

  it('reaches whoever joins while rooms are open, in their room, at once', async () => {
    const art = await account();
    const kofi = await account();
    const lena = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email, lena.email], workspace: id });
    const k = await invited(host, c, kofi);
    expect((await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [kofi.email, lena.email] }, { name: 'Two', emails: [] }], minutes: 10, board: { mode: 'each', template: 'blank' } })).status).toBe(200);
    const one = (await settle(k, (s) => s.board.open?.role === 'edit')).board.open?.documentId ?? '';
    expect(await seats(one)).toBe(1);
    // Lena comes late: being let in is all it takes for the room's board to be hers too, with no upkeep.
    const l = await invited(host, c, lena);
    await until(async () => (await opened(l))?.documentId === one && (await opened(l))?.role === 'edit', 'Lena to have One’s board', 5000);
    expect(await seats(one)).toBe(2);
    expect(await opens(lena, id, one, l)).toBe('allowed');
  });

  it('goes with someone who leaves the call, at once, and comes back with them', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' });
    const one = (await opened(r.k))?.documentId ?? '';
    expect(await seats(one)).toBe(1);
    await r.k.leave();
    await until(async () => (await seats(one)) === 0, 'Kofi’s seat to go as he leaves', 5000);
    const back = await invited(r.host, r.code, r.kofi, r.k.ticket.identity);
    await until(async () => (await opened(back))?.role === 'edit', 'Kofi to have it back', 5000);
    expect(await seats(one)).toBe(1);
  });

  it('puts right at the next upkeep a room’s seat that a crash kept from someone', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' });
    const one = (await opened(r.k))?.documentId ?? '';
    // As it stands if the process stopped before anything was done about the seats of whoever's in the room.
    await h.pool.query("DELETE FROM document_access WHERE document_id = $1 AND kind = 'seat'", [one]);
    expect(await opens(r.kofi, r.id, one, r.k)).toBe('not-found');
    await reconcile(h.deps);
    expect(await opens(r.kofi, r.id, one, r.k)).toBe('allowed');
    expect(await seats(one)).toBe(1);
  });

  it('are everyone invited’s once rooms close with nobody in them', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' });
    const one = (await opened(r.k))?.documentId ?? '';
    // Everyone sent to a room has gone: closing them moves nobody, so it's closing that keeps the boards.
    await r.k.leave();
    await r.p.leave();
    await until(async () => (await seats(one)) === 0, 'the seats to go as they leave', 5000);
    await closeAll(r);
    expect(await entries(one)).toBe(3);
    expect(await opens(r.kofi, r.id, one)).toBe('allowed');
  });

  it('close by time in whatever’s done next: the rooms’ boards are everyone invited’s, and come back', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' }, { main: 'retro' });
    const one = (await opened(r.k))?.documentId ?? '';
    // Nobody's in a room by then, so nothing but the rooms closing keeps their boards.
    await r.k.leave();
    await r.p.leave();
    await until(async () => (await seats(one)) === 0, 'the seats to go as they leave', 5000);
    // Time's up, and nobody has said so: the next thing anyone does finds the rooms closed.
    await timeIsUp(r);
    expect((await action(r.art, r.host, { type: 'hand', up: true })).status).toBe(200);
    expect(await entries(one)).toBe(3);
    await until(async () => (await mainBoard(r))?.board.frames.some((f) => f.title === 'One') === true, 'One’s board to land');
  });

  it('close by time in a look for ideas too: it says they closed, their part of the keys goes, their boards are everyone invited’s, and they come back', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' }, { main: 'retro', notes: 'on', said: 'We should name a status page owner.' });
    const one = (await opened(r.k))?.documentId ?? '';
    await until(async () => (await keysOf(r.host.ticket.callId, r.one)) > 0, 'room One’s group in the call’s MLS log');
    await r.k.leave();
    await r.p.leave();
    await until(async () => (await seats(one)) === 0, 'the seats to go as they leave', 5000);
    await timeIsUp(r);
    // The first thing to save the call is a look for ideas from the main room, as a browser with the board open looks.
    const looking = r.host.watchIdeas();
    expect((await settle(r.host, (s) => s.board.ideas.length > 0, 20_000)).board.ideas.length).toBeGreaterThan(0);
    looking();
    // It saved the rooms closed: nothing's open in them, their boards are on their way back, and their part of the keys is gone.
    const kept = await keptOf(r);
    // Their boards are on their way back, or already back if the landing that save started has finished.
    const back = kept.board.landing !== null || (await mainBoard(r))?.board.frames.some((f) => f.title === 'One') === true;
    expect({ rooms: kept.breakouts.open, open: Object.keys(kept.board.open), back }).toEqual({ rooms: null, open: ['main'], back: true });
    expect(await keysOf(r.host.ticket.callId, r.one)).toBe(0);
    // Each room's board is everyone invited's at once, and comes back with whatever's done next.
    await until(async () => (await entries(one)) === 3, 'One’s board to be everyone invited’s');
    expect(await opens(r.kofi, r.id, one)).toBe('allowed');
    expect((await action(r.art, r.host, { type: 'hand', up: true })).status).toBe(200);
    await until(async () => (await mainBoard(r))?.board.frames.some((f) => f.title === 'One') === true, 'One’s board to land');
  });

  it('close by time in a board’s own action: a vote started, they come back with nothing else done', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' }, { main: 'retro' });
    const one = (await opened(r.k))?.documentId ?? '';
    await r.k.leave();
    await r.p.leave();
    await until(async () => (await seats(one)) === 0, 'the seats to go as they leave', 5000);
    await timeIsUp(r);
    await r.host.startVote(null, 3);
    expect((await keptOf(r)).breakouts.open).toBeNull();
    await until(async () => (await mainBoard(r))?.board.frames.some((f) => f.title === 'One') === true, 'One’s board to land');
    expect(await entries(one)).toBe(3);
  });

  it('come back as rooms close, once however many ask: a frame each on the main board, named for the room with who was there', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' }, { main: 'retro' });
    const main = (await opened(r.host))?.documentId ?? '';
    const one = (await opened(r.k))?.documentId ?? '';
    const two = (await opened(r.p))?.documentId ?? '';
    for (const [who, call, board, words] of [[r.kofi, r.k, one, 'Ship the changelog first'], [r.priya, r.p, two, 'Refresh staging nightly']] as const) {
      const page = await pageOf(who, r.id, board, call);
      addObject(page.doc, sticky(words, 0, 0), null);
      await stored(page);
      page.close();
    }
    const before = (await mainBoard(r))?.board.objects.length ?? -1;
    // Every browser at once: the organizer closing twice over, hands going up as the rooms close, and upkeep.
    const close = { type: 'rooms-close' };
    const asked = await Promise.all([
      action(r.art, r.host, close), action(r.art, r.host, close), action(r.kofi, r.k, { type: 'hand', up: true }), action(r.priya, r.p, { type: 'hand', up: true }),
      reconcile(h.deps).then(() => ({ status: 200 }))
    ]);
    expect([asked[0]?.status, asked[1]?.status, asked[4]?.status]).toEqual([200, 200, 200]);
    for (const response of asked.slice(2, 4)) {
      if (!('json' in response)) throw new Error('Missing hand response');
      if (response.status === 409) {
        const body: unknown = await response.json();
        expect(body).toMatchObject({ code: 'conflict', message: 'You moved to another room. Try again from there.' });
      } else expect(response.status).toBe(200);
    }
    // A raise may win before closure, or be refused for its old room afterwards. Neither becomes a main-room raise.
    expect((await settle(r.host, (s) => s.breakouts.open === null)).attention.hands).toEqual([]);
    const landed = async () => (await mainBoard(r))?.board.frames.filter((f) => f.title === 'One' || f.title === 'Two') ?? [];
    await until(async () => (await landed()).length === 2, 'both rooms’ boards to land');
    // Asking again, and upkeep again, change nothing.
    await Promise.all([action(r.art, r.host, close), reconcile(h.deps), reconcile(h.deps)]);
    await rest(300);
    const now = await mainBoard(r);
    expect(now?.id).toBe(main);
    const frames = await landed();
    expect(frames.map((f) => [f.title, f.sub])).toEqual([['One', first(r.kofi)], ['Two', first(r.priya)]]);
    expect(now?.board.objects.length).toBe(before + 4);
    // The call has nothing left to land, and nothing open in rooms.
    const kept = (await storedCall(r.art.ownerId, r.host.ticket.callId)).state['board'];
    expect(kept).toMatchObject({ landing: null, open: { main: { documentId: main } } });
    expect(Object.keys(z.object({ open: z.record(z.string(), z.unknown()) }).parse(kept).open)).toEqual(['main']);
  });

  it('lands a room’s stickies in its frame and none of its pictures, on a main board made for them, and leaves the room’s board whole', async () => {
    const r = await inRooms({ mode: 'each', template: 'retro' });
    expect(await opened(r.host)).toBeNull();
    const one = (await opened(r.k))?.documentId ?? '';
    const page = await pageOf(r.kofi, r.id, one, r.k);
    const frames = readBoard(page.doc).frames;
    const inFrame = (k: number, i: number) => ({ x: (frames[k]?.x ?? 0) + 20, y: 20 + i * 170 });
    const a = addObject(page.doc, { ...sticky('Changelog went out late', 0, 0), ...inFrame(0, 0) }, null) ?? '';
    const b = addObject(page.doc, { ...sticky('Nobody owned the date', 0, 0), ...inFrame(1, 0) }, null) ?? '';
    addObject(page.doc, sticky('One owner for launch comms', 2000, 0), null);
    const picture = addObject(page.doc, { k: 'image', x: 0, y: 700, w: 320, h: 200, media: 'media0001' }, null) ?? '';
    addObject(page.doc, { k: 'shot', x: 400, y: 700, w: 320, h: 200, media: 'media0002', caption: 'The status page' }, null);
    addObject(page.doc, { k: 'line', style: 'elbow', from: { on: a, side: 'r' }, to: { on: b, side: 'l' } }, null);
    addObject(page.doc, { k: 'line', style: 'elbow', from: { on: b, side: 'r' }, to: { on: picture, side: 'l' } }, null);
    await stored(page);
    page.close();
    await closeAll(r);
    // There was no main board, so one is made, after the call, and opens for everyone back in the main room.
    await until(async () => (await opened(r.host))?.name === 'Launch retro', 'a main board for the rooms’ boards');
    expect(await opened(r.k)).toMatchObject({ name: 'Launch retro', everyone: true, role: 'edit', seal: 'Sealed', frame: null });
    const landed = await mainBoard(r);
    const frame = landed?.board.frames.find((f) => f.title === 'One');
    expect(frame?.sub).toBe(first(r.kofi));
    const held = landed?.board.objects.filter((o) => 'f' in o && o.f === frame?.id) ?? [];
    expect(held.flatMap((o) => (o.k === 'note' ? [o.t] : []))).toEqual(['Changelog went out late', 'Nobody owned the date', 'One owner for launch comms']);
    expect(landed?.board.objects.some((o) => o.k === 'image' || o.k === 'shot')).toBe(false);
    // The line between two stickies comes with them; the one to the picture stays behind with it.
    expect(held.filter((o) => o.k === 'line')).toHaveLength(1);
    // Priya's room had nothing on its board but its frames: an empty frame says so.
    expect(landed?.board.frames.find((f) => f.title === 'Two')?.sub).toBe(first(r.priya));
    // The room's own board is as it was, pictures and all.
    const own = await pageOf(r.kofi, r.id, one);
    expect(readBoard(own.doc).objects.filter((o) => o.k === 'image' || o.k === 'shot')).toHaveLength(2);
    own.close();
  });

  it('are everyone invited’s once rooms close, saved boards like any other, and nothing to a teammate who wasn’t invited', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' });
    const one = (await opened(r.k))?.documentId ?? '';
    const two = (await opened(r.p))?.documentId ?? '';
    await closeAll(r);
    // The seats go, and everyone invited, the organizer too, has each by address, as the people its room's notes go to.
    await until(async () => (await seats(one)) === 0 && (await entries(one)) === 3 && (await entries(two)) === 3, 'the rooms’ boards to be everyone invited’s');
    for (const who of [r.kofi, r.priya, r.art]) {
      for (const board of [one, two]) expect(await opens(who, r.id, board)).toBe('allowed');
      expect((await who.api.workspaces.get(r.id)).items.filter((x) => x.id === one || x.id === two).map((x) => [x.name, x.restricted, x.role]).sort()).toEqual([['One board', true, 'edit'], ['Two board', true, 'edit']]);
    }
    // Maya is in the workspace and wasn't invited: she never sees them.
    expect(await opens(r.maya, r.id, one)).toBe('not-found');
    expect((await r.maya.api.workspaces.get(r.id)).items.map((x) => x.id)).not.toEqual(expect.arrayContaining([one]));
    await r.host.leave();
    expect(await opens(r.kofi, r.id, one)).toBe('allowed');
    expect(await opens(r.maya, r.id, two)).toBe('not-found');
  });

  it('shared: one board with a frame each, everyone stays on it, lands on their room’s frame, and nothing has to come back', async () => {
    const r = await inRooms({ mode: 'shared', template: 'retro' });
    const k = await opened(r.k);
    // There was no main board, so one is made from the template, with a frame for each room after it.
    expect(k).toEqual({ workspaceId: r.id, documentId: expect.any(String), name: 'Launch retro', openedBy: r.host.ticket.identity, canClose: false, everyone: true, role: 'edit', seal: 'Sealed', frame: roomFrameId(r.one) });
    const board = k?.documentId ?? '';
    expect(await opened(r.p)).toMatchObject({ documentId: board, frame: roomFrameId(r.two) });
    expect(await opened(r.host)).toMatchObject({ documentId: board, frame: null });
    expect((await read(r.host)).breakouts.open).toMatchObject({ board: 'shared', rooms: [{ board: false }, { board: false }] });
    const shared = (await mainBoard(r))?.board;
    expect(shared?.frames.map((f) => [f.id, f.title, f.sub])).toEqual([
      [expect.any(String), 'Went well', ''], [expect.any(String), 'Could improve', ''], [expect.any(String), 'Actions', ''],
      [roomFrameId(r.one), 'One', first(r.kofi)], [roomFrameId(r.two), 'Two', first(r.priya)]
    ]);
    // Everyone can see every frame while they work.
    expect(await opens(r.priya, r.id, board, r.p)).toBe('allowed');
    expect(await opens(r.kofi, r.id, board, r.k)).toBe('allowed');
    await closeAll(r);
    await rest(300);
    expect(await opened(r.k)).toMatchObject({ documentId: board, frame: null });
    expect((await mainBoard(r))?.board.frames).toHaveLength(5);
    expect((await storedCall(r.art.ownerId, r.host.ticket.callId)).state['board']).toMatchObject({ landing: null, rooms: [] });
  });

  it('shared, on the board that’s open: its frames go after what’s there, once', async () => {
    const r = await inRooms({ mode: 'shared', template: 'blank' }, { main: 'retro' });
    const main = (await opened(r.host))?.documentId ?? '';
    expect(await opened(r.k)).toMatchObject({ documentId: main, frame: roomFrameId(r.one) });
    const frames = (await mainBoard(r))?.board.frames ?? [];
    expect(frames.map((f) => f.title)).toEqual(['Went well', 'Could improve', 'Actions', 'One', 'Two']);
    const right = Math.max(...frames.slice(0, 3).map((f) => f.x + f.w));
    expect(frames[3]?.x).toBeGreaterThan(right);
  });

  it('shared: someone in a room votes on it, as everyone on it does', async () => {
    const r = await inRooms({ mode: 'shared', template: 'retro' });
    const shared = await opened(r.k);
    expect(shared).toMatchObject({ role: 'edit', frame: roomFrameId(r.one) });
    const page = await pageOf(r.kofi, r.id, shared?.documentId ?? '', r.k);
    const frame = readBoard(page.doc).frames.find((f) => f.id === roomFrameId(r.one));
    const mine = addObject(page.doc, sticky('One owner for launch comms', (frame?.x ?? 0) + 20, (frame?.y ?? 0) + 60), null) ?? '';
    await stored(page);
    page.close();
    // The organizer, in the main room, starts a vote on every sticky: Kofi votes in it, takes it back and votes again.
    await r.host.startVote(null, 3);
    expect((await read(r.k)).board.vote).toMatchObject({ on: true, left: 3 });
    await r.k.castVote(mine);
    await r.k.takeBackVote(mine);
    await r.k.castVote(mine);
    expect((await read(r.k)).board.vote).toMatchObject({ mine: [mine], left: 2 });
    await r.host.endVote();
    expect((await read(r.p)).board.vote).toMatchObject({ on: false, results: { [mine]: 1 }, voters: 1 });
  });

  it('never land on a main board the call can’t write on any more: they come back on a new one in its place, and the call says so', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const dana = await account();
    // Dana's Design, where Priya can edit and Art and Kofi aren't; the call's workspace is Art's Product.
    const design = await workspace(dana, 'Design', [[priya, 'edit']]);
    const plan = await saved(dana, design, 'Q3 plan');
    const product = await workspace(art, 'Product', [[kofi, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], workspace: product, title: 'Launch retro' });
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    // Priya brings Design's board for everyone, without letting anyone in, and rooms open with a board each.
    await p.openBoard({ workspaceId: design, documentId: plan, letIn: false });
    expect(await opened(p)).toMatchObject({ documentId: plan, role: 'edit' });
    expect((await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [priya.email] }], minutes: 10, board: { mode: 'each', template: 'blank' } })).status).toBe(200);
    const one = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms[0]?.id ?? '';
    await until(() => k.crypto.getSnapshot().place === one, 'Kofi to be in One');
    await inGroup(k);
    const oneBoard = (await settle(k, (s) => s.board.open?.role === 'edit')).board.open?.documentId ?? '';
    const page = await pageOf(kofi, product, oneBoard, k);
    addObject(page.doc, sticky('CANARY-ROOM-ONLY who owns the merger', 0, 0), null);
    await stored(page);
    page.close();
    // Dana restricts her board: it's hers alone now, and nobody in the call can open it, Priya who brought it included.
    await dana.api.workspaces.share.restrict(design, plan, true);
    expect(await opens(priya, design, plan, p)).toBe('not-found');
    expect((await action(art, host, { type: 'rooms-close' })).status).toBe(200);
    // The rooms' boards come back on a new board in the call's workspace, open for everyone in place of the one they couldn't land on.
    const back = (await settle(host, (s) => s.breakouts.open === null && s.board.open?.documentId !== plan && s.board.open?.role === 'edit')).board.open;
    expect(back).toMatchObject({ workspaceId: product, name: 'Launch retro', role: 'edit', everyone: true });
    const main = await mainBoard({ art, id: product, host });
    expect(main?.board.frames.find((f) => f.title === 'One')?.sub).toBe(first(kofi));
    expect(main?.board.objects.some((o) => o.k === 'note' && o.t.includes('CANARY-ROOM-ONLY'))).toBe(true);
    expect((await read(k)).notices.map((n) => n.text)).toContain('The rooms’ boards came back on a new board. The one that was open can’t take them.');
    // And nothing of the room is on the board only Dana can read.
    const hers = await open(dana, design, plan);
    expect(readBoard(hers.doc).objects.some((o) => o.k === 'note' && o.t.includes('CANARY-ROOM-ONLY'))).toBe(false);
    hers.close();
  });

  it('come back nowhere when the call’s workspace can’t take a new board for them: tried once, said once, and each is still everyone invited’s', async () => {
    const art = await account();
    const kofi = await account();
    const dana = await account();
    // Dana's Product, where Art can edit: the call's workspace, with no main board in it.
    const id = await workspace(dana, 'Product', [[art, 'edit'], [kofi, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: id, title: 'Launch retro' });
    const k = await invited(host, c, kofi);
    expect((await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [] }], minutes: 10, board: { mode: 'each', template: 'blank' } })).status).toBe(200);
    const one = (await settle(k, (s) => s.board.open?.role === 'edit')).board.open?.documentId ?? '';
    await inGroup(k);
    // Dana makes Art read-only in Product: nothing the call makes can go there for the rooms' boards to come back to.
    const artThere = (await dana.api.workspaces.people(id)).find((x) => x.person.email === art.email)?.id ?? '';
    await dana.api.workspaces.setRole(id, artThere, 'read');
    const from = h.logs.length;
    expect((await action(art, host, { type: 'rooms-close' })).status).toBe(200);
    const nowhere = 'The rooms’ boards didn’t come back: this call’s workspace can’t take a new board. Each one is still saved where it was.';
    expect((await settle(k, (s) => s.notices.some((n) => n.text === nowhere))).notices.map((n) => n.text)).toContain(nowhere);
    expect((await keptOf({ art, host })).board.landing).toBeNull();
    // Kofi's back in the main room's group by now, so nothing about moving him is still on its way.
    await inGroup(k);
    await rest(1500);
    // Nothing more is tried on everything anyone does after: five hands are five saves of the call (and at most one more of
    // anything else), and no more tries.
    const version = async () => z.object({ version: z.coerce.number() }).parse((await h.pool.query('SELECT version FROM calls WHERE call_id = $1', [host.ticket.callId])).rows[0]).version;
    const v0 = await version();
    for (let i = 0; i < 5; i++) { expect((await action(kofi, k, { type: 'hand', up: i % 2 === 0 })).status).toBe(200); await rest(200); }
    expect(await version()).toBeLessThanOrEqual(v0 + 6);
    expect(linesSince(from).filter((l) => l.msg.startsWith('rooms’ boards not landed')).map((l) => l.msg)).toEqual(['rooms’ boards not landed: the call’s workspace can’t take a new board']);
    // Each room's board is everyone invited's, where it was made.
    expect(await opens(kofi, id, one)).toBe('allowed');
    expect(await opened(host)).toBeNull();
  });

  it('go from someone let in from the link once they’re taken off the invite, with the room’s notes', async () => {
    const art = await account();
    const lena = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { workspace: id, title: 'Launch retro' });
    // Lena isn't invited: signed in, she asks from the link and is let in, which puts her on the invite.
    const l = await lena.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, l);
    expect((await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [lena.email] }, { name: 'Two', emails: [] }], minutes: 10, board: { mode: 'each', template: 'blank' } })).status).toBe(200);
    const one = (await settle(l, (s) => s.board.open?.role === 'edit')).board.open?.documentId ?? '';
    await closeAll({ art, host });
    await until(async () => (await opens(lena, id, one)) === 'allowed', 'Lena to have One’s board by address');
    // The organizer takes her out of the call, which takes her off the invite: the room's board goes with its notes.
    expect((await action(art, host, { type: 'remove', identity: l.ticket.identity })).status).toBe(200);
    await until(async () => (await opens(lena, id, one)) === 'not-found', 'Lena to lose One’s board', 5_000);
    expect(await opens(art, id, one)).toBe('allowed');
  });
});

describe('presenting a board', () => {
  /** The frames a board's slides are, by title, as everyone who opens it has them: the top-level ones, in order. */
  const slides = async (who: Account, id: string, board: string, call: CallSession) => {
    const page = await pageOf(who, id, board, call);
    const titles = readBoard(page.doc).frames.filter((f) => !f.f).map((f) => f.title);
    page.close();
    return titles;
  };
  /**
   * A call Art hosts in Product, with the launch retro open for everyone: Priya and Theo invited and in it, Jamie with the link,
   * and Kofi invited, who comes later. Its three frames are the slides.
   */
  async function retroOpen() {
    const art = await account();
    const priya = await account();
    const theo = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [priya.email, theo.email, kofi.email], workspace: id, title: 'Launch retro' });
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    const jamie = await guest(host, c);
    await host.openBoard({ template: 'retro' });
    const board = (await opened(host))?.documentId ?? '';
    await until(async () => (await opened(t))?.role === 'edit' && (await opened(jamie.call))?.role === 'edit', 'everyone to have the board');
    return { art, priya, theo, kofi, id, host, c, p, t, jamie, board };
  }

  it('is the board on everyone’s stage, a frame at a time, moved by whoever started it or the organizer, and someone who comes late lands where everyone is', async () => {
    const r = await retroOpen();
    expect(await slides(r.theo, r.id, r.board, r.t)).toEqual(['Went well', 'Could improve', 'Actions']);
    await r.p.startPresenting({ kind: 'board', id: r.board });
    const by = { seat: expect.any(String), name: r.priya.name };
    // One presentation, the same key for everyone, random and made of nothing anyone could read.
    const key = (await presented(r.p))?.key ?? '';
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await presented(r.p)).toEqual({ key, kind: 'board', id: r.board, name: 'Launch retro', section: 0, by, mine: true });
    expect(await presented(r.t)).toEqual({ key, kind: 'board', id: r.board, name: 'Launch retro', section: 0, by, mine: false });
    expect(await presented(r.jamie.call)).toEqual({ key, kind: 'board', id: r.board, name: 'Launch retro', section: 0, by, mine: false });
    expect(await presented(r.host)).toEqual({ key, kind: 'board', id: r.board, name: 'Launch retro', section: 0, by, mine: false });

    // Whoever started it moves it on, and so can the organizer; nobody else, and nobody starts over it.
    await r.p.movePresenting(1);
    expect((await presented(r.t))?.section).toBe(1);
    expect(await code(r.t.movePresenting(2))).toBe('forbidden');
    expect(await code(r.jamie.call.stopPresenting(false))).toBe('forbidden');
    expect(await code(r.t.startPresenting({ kind: 'board', id: r.board }))).toBe('conflict');
    await r.host.movePresenting(2);
    expect((await presented(r.p))?.section).toBe(2);
    // Moving on is the same presentation.
    expect((await presented(r.t))?.key).toBe(key);

    // Kofi comes late: the board is open to him, and he lands on the frame everyone's on.
    const k = await invited(r.host, r.c, r.kofi);
    await until(async () => (await opened(k))?.role === 'edit', 'Kofi to have the board');
    expect(await presented(k)).toEqual({ key, kind: 'board', id: r.board, name: 'Launch retro', section: 2, by, mine: false });
    expect(await opens(r.kofi, r.id, r.board, k)).toBe('allowed');
  });

  it('is only ever the board open where you are, and ends when it closes for everyone', async () => {
    const r = await retroOpen();
    // Another board in the same workspace, a board as a document, and one that isn't there, all read as nothing there.
    const other = await saved(r.art, r.id, 'Planning');
    expect(await refusal(r.host.startPresenting({ kind: 'board', id: other }))).toEqual(await refusal(r.host.startPresenting({ kind: 'board', id: madeUp() })));
    expect(await code(r.host.startPresenting({ kind: 'board', id: other }))).toBe('not-found');
    // A board isn't presented as anything else: a document is no kind of presentation.
    expect((await action(r.art, r.host, { type: 'present-start', what: { kind: 'document', id: r.board } })).status).toBe(400);
    expect(await presented(r.t)).toBeNull();

    // Closed by the organizer, it's over for everyone, closed for everyone, and said at once.
    await r.p.startPresenting({ kind: 'board', id: r.board, section: 1 });
    const key = (await presented(r.t))?.key;
    await r.host.closeBoard();
    for (const call of [r.t, r.jamie.call, r.p, r.host]) expect((await read(call)).workspace).toMatchObject({ present: null, ended: { key, close: true, by: { seat: expect.any(String), name: r.priya.name } } });
    // It doesn't come back with the board.
    await r.host.openBoard({ workspaceId: r.id, documentId: r.board, letIn: true });
    expect(await opened(r.t)).toMatchObject({ documentId: r.board, role: 'edit' });
    expect(await presented(r.t)).toBeNull();
    // And it's in nobody's way.
    await r.t.startPresenting({ kind: 'board', id: r.board });
    expect(await presented(r.host)).toMatchObject({ id: r.board, section: 0, by: { name: r.theo.name } });
  });

  it('changes nobody’s access: someone who can’t open it is told only that it’s on, and by whom, before, during and after', async () => {
    const art = await account();
    const priya = await account();
    const lena = await account();
    const theo = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit'], [lena, 'read']]);
    const board = await saved(art, id, 'Roadmap');
    const { host, code: c } = await callBy(art, { guests: [priya.email, lena.email, theo.email], workspace: id });
    const p = await invited(host, c, priya);
    const l = await invited(host, c, lena);
    const t = await invited(host, c, theo);
    const jamie = await guest(host, c);
    // Brought without the people who can't open it: Theo isn't in Product, and Jamie came with the link.
    await host.openBoard({ workspaceId: id, documentId: board, letIn: false });
    const roles = async () => Promise.all([p, l, t, jamie.call].map(async (call) => { const o = await opened(call); return o ? o.role : 'not open'; }));
    const before = { roles: await roles(), entries: await entries(board) };
    expect(before.roles).toEqual(['edit', 'read', null, null]);

    await p.startPresenting({ kind: 'board', id: board });
    const told = { key: expect.any(String), kind: null, id: null, name: null, section: null, by: { seat: expect.any(String), name: priya.name }, mine: false };
    for (const call of [t, jamie.call]) {
      expect(await presented(call)).toEqual(told);
      expect(said(await read(call))).not.toContain('Roadmap');
    }
    expect(await presented(l)).toMatchObject({ kind: 'board', id: board, name: 'Roadmap', section: 0 });
    await p.movePresenting(1);
    expect(await presented(t)).toEqual(told);
    // Being shown it gave nobody anything, and took nothing from anyone.
    expect(await roles()).toEqual(before.roles);
    expect(await entries(board)).toBe(before.entries);
    expect(await opens(theo, id, board, t)).toBe('not-found');
    expect(await code(open(jamie, id, board, { pass: jamie.call.ticket.pass }).then((s) => { s.close(); }))).toBe('not-found');
    // Lena can look, and only look.
    expect(await code(open(lena, id, board, { pass: l.ticket.pass }).then((s) => { s.close(); }))).toBe('allowed');
    expect((await read(l)).board.open?.role).toBe('read');

    await p.stopPresenting(false);
    expect((await read(t)).workspace.ended).toEqual({ key: expect.any(String), close: false, by: { seat: expect.any(String), name: priya.name } });
    expect(said(await read(t))).not.toContain('Roadmap');
    expect(await roles()).toEqual(before.roles);
    expect(await entries(board)).toBe(before.entries);
    expect(await opens(theo, id, board, t)).toBe('not-found');
  });

  it('keeps everything of the presenter’s but the frame to them: their notes beside it reach nobody, and nothing of them is in the call or on the board', async () => {
    const r = await retroOpen();
    const from = h.logs.length;
    // Their notes beside each frame, kept as the presenter's view keeps them: the frames are the board's own.
    const page0 = await pageOf(r.art, r.id, r.board, r.host);
    const [well, improve] = readBoard(page0.doc).frames.map((f) => f.id);
    page0.close();
    const frameNotes = { [well ?? '']: 'CANARY-FRAME-NOTES open with the sign-ups', [improve ?? '']: 'CANARY-FRAME-NOTES ask Priya about the changelog' };
    for (const [frame, text] of Object.entries(frameNotes)) await r.art.api.workspaces.presenterNotes.setFrame(r.id, r.board, frame, text, { pass: r.host.ticket.pass });
    await r.host.startPresenting({ kind: 'board', id: r.board });
    await r.host.movePresenting(1);
    // Everyone else is told which frame, and who: nothing else, whatever their way in.
    for (const call of [r.p, r.t, r.jamie.call]) {
      const s = await read(call);
      expect(s.workspace.present).toEqual({ key: expect.any(String), kind: 'board', id: r.board, name: 'Launch retro', section: 1, by: { seat: expect.any(String), name: r.art.name }, mine: false });
      expect(said(s)).not.toContain('CANARY-FRAME-NOTES');
    }
    // Their own notes beside it are their own: empty until they write some, and none at all for someone with the link.
    expect(await r.priya.api.workspaces.presenterNotes.frames(r.id, r.board, { pass: r.p.ticket.pass })).toEqual({ frames: {} });
    expect(await r.theo.api.workspaces.presenterNotes.frames(r.id, r.board, { pass: r.t.ticket.pass })).toEqual({ frames: {} });
    expect(await code(r.jamie.api.workspaces.presenterNotes.frames(r.id, r.board, { pass: r.jamie.call.ticket.pass }))).toBe('forbidden');
    // The board everyone has holds nothing of them.
    const page = await pageOf(r.priya, r.id, r.board, r.p);
    expect(boardText(page.doc)).not.toContain('CANARY');
    page.close();
    expect(h.logs.slice(from).join('\n')).not.toContain('CANARY-FRAME-NOTES');
    // And they're the presenter's, as they left them.
    expect(await r.art.api.workspaces.presenterNotes.frames(r.id, r.board, { pass: r.host.ticket.pass })).toEqual({ frames: frameNotes });
  });

  it('waits while whoever’s presenting reloads, and ends for everyone when they leave, said at once, with the board still everyone’s', async () => {
    const r = await retroOpen();
    await r.p.startPresenting({ kind: 'board', id: r.board, section: 1 });
    const key = (await presented(r.t))?.key;
    // A reload is no end: hidden while she's away, with nothing said, and the same presentation when she's back.
    r.p.closing();
    await settle(r.host, (s) => !s.participants.some((x) => x.id === r.p.ticket.identity));
    expect((await read(r.t)).workspace).toMatchObject({ present: null, ended: null });
    const back = await r.priya.api.calls.join(r.c, { mic: false, cam: false, previous: r.p.ticket.pass });
    await inGroup(back);
    await settle(r.host, (s) => s.participants.some((x) => x.id === back.ticket.identity));
    expect((await read(r.t)).workspace).toMatchObject({ present: { key, kind: 'board', id: r.board, section: 1, mine: false }, ended: null });
    expect(await presented(back)).toMatchObject({ key, kind: 'board', section: 1, mine: true });

    // Leaving on purpose ends it for good, for her, and everyone following is told as she goes.
    await back.leave();
    for (const call of [r.t, r.host, r.jamie.call]) expect((await read(call)).workspace).toMatchObject({ present: null, ended: { key, close: false, by: { seat: expect.any(String), name: r.priya.name } } });
    expect(await opened(r.t)).toMatchObject({ documentId: r.board, role: 'edit' });
    // Coming back doesn't bring it back.
    const again = await r.priya.api.calls.join(r.c, { mic: false, cam: false, previous: back.ticket.pass });
    await inGroup(again);
    await settle(r.host, (s) => s.participants.some((x) => x.id === again.ticket.identity));
    expect(await presented(again)).toBeNull();
    expect(await presented(r.t)).toBeNull();
  });

  it('is the board where it’s open, whichever workspace the call views and wherever the board is kept', async () => {
    const r = await retroOpen();
    const other = await workspace(r.art, 'Other', [[r.priya, 'edit']]);
    await r.host.setWorkspace(other);
    expect(await opened(r.t)).toMatchObject({ documentId: r.board, workspaceId: r.id });
    await r.p.startPresenting({ kind: 'board', id: r.board, section: 2 });
    expect(await presented(r.t)).toMatchObject({ kind: 'board', id: r.board, name: 'Launch retro', section: 2, mine: false });
    expect(await presented(r.host)).toMatchObject({ kind: 'board', id: r.board, mine: false });
    // Everyone views the workspace together, so changing it stops what's presented, as it does for a document.
    await r.host.setWorkspace(r.id);
    expect(await presented(r.t)).toBeNull();

    // A board brought from a workspace the call doesn't view: presented from there, to whoever can open it there.
    const design = await workspace(r.art, 'Design', [[r.priya, 'edit']]);
    const board = await saved(r.art, design, 'Onboarding flow');
    await r.host.openBoard({ workspaceId: design, documentId: board, letIn: false });
    await r.p.startPresenting({ kind: 'board', id: board });
    expect(await presented(r.host)).toMatchObject({ kind: 'board', id: board, name: 'Onboarding flow', section: 0, mine: false });
    expect(await presented(r.t)).toEqual({ key: expect.any(String), kind: null, id: null, name: null, section: null, by: { seat: expect.any(String), name: r.priya.name }, mine: false });
  });

  it('ends for everyone, said at once, when its workspace is deleted, or it goes to Trash', async () => {
    const r = await retroOpen();
    const by = { seat: expect.any(String), name: r.priya.name };
    // A board brought from Design, presented by Priya: Design is deleted. Nothing can open it now, so it's over for everyone, and
    // the first read after says so, as every one after it does.
    const design = await workspace(r.art, 'Design', [[r.priya, 'edit']]);
    const flow = await saved(r.art, design, 'Onboarding flow');
    await r.host.openBoard({ workspaceId: design, documentId: flow, letIn: true });
    await r.p.startPresenting({ kind: 'board', id: flow });
    const first = (await presented(r.t))?.key;
    await r.art.api.workspaces.remove(design);
    for (const call of [r.t, r.host, r.p, r.jamie.call]) expect((await read(call)).workspace).toMatchObject({ present: null, ended: { key: first, close: false, by } });
    expect(await opened(r.t)).toBeNull();
    // The retro, presented, goes to Trash: it leaves the call, and its presentation ends for everyone, said at once.
    await r.host.openBoard({ workspaceId: r.id, documentId: r.board, letIn: true });
    await r.p.startPresenting({ kind: 'board', id: r.board });
    const second = (await presented(r.t))?.key;
    await r.art.api.workspaces.items.trash(r.id, r.board);
    for (const call of [r.t, r.host, r.p]) expect((await read(call)).workspace).toMatchObject({ present: null, ended: { key: second, close: false, by } });
    expect(await opened(r.t)).toBeNull();
  });

  it('closing for the presenter keeps the board in the call; closing for everyone closes it, by the presenter or the organizer', async () => {
    const r = await retroOpen();
    const by = { seat: expect.any(String), name: r.priya.name };
    // For Priya alone: the board stays in the call, on everyone's stage, and everyone is told how it ended.
    await r.p.startPresenting({ kind: 'board', id: r.board, section: 1 });
    const first = (await presented(r.t))?.key ?? '';
    await r.p.stopPresenting(false);
    for (const call of [r.p, r.t, r.jamie.call, r.host]) {
      const s = await read(call);
      expect(s.workspace).toMatchObject({ present: null, ended: { key: first, close: false, by } });
      expect(s.board.open).toMatchObject({ documentId: r.board });
    }
    // Nobody else ends it, either way, and the board stays.
    await r.p.startPresenting({ kind: 'board', id: r.board });
    const second = (await presented(r.t))?.key ?? '';
    expect(second).not.toBe(first);
    expect((await read(r.t)).workspace.ended).toBeNull();
    expect(await code(r.t.stopPresenting(true))).toBe('forbidden');
    expect(await code(r.jamie.call.stopPresenting(true))).toBe('forbidden');
    expect(await opened(r.t)).toMatchObject({ documentId: r.board });
    // Priya didn't open it, so she can't close it by itself; for everyone, presenting it, she can: it closes as Close closes it.
    expect(await code(r.p.closeBoard())).toBe('forbidden');
    await r.p.stopPresenting(true);
    for (const call of [r.p, r.t, r.jamie.call, r.host]) {
      const s = await read(call);
      expect(s.workspace).toMatchObject({ present: null, ended: { key: second, close: true, by } });
      expect(s.board.open).toBeNull();
    }
    // Nothing is deleted, and nobody loses what the call gave them: it opens again as it was.
    await r.host.openBoard({ workspaceId: r.id, documentId: r.board, letIn: true });
    expect(await opened(r.t)).toMatchObject({ documentId: r.board, role: 'edit' });
    // The organizer ends someone else's for everyone the same way.
    await r.p.startPresenting({ kind: 'board', id: r.board });
    const third = (await presented(r.t))?.key ?? '';
    await r.host.stopPresenting(true);
    expect((await read(r.t)).workspace).toMatchObject({ present: null, ended: { key: third, close: true, by } });
    expect(await opened(r.t)).toBeNull();
  });

  it('won’t make or bring in a board while someone else presents one here', async () => {
    const r = await retroOpen();
    const planning = await saved(r.art, r.id, 'Planning');
    const boards = async () => inTree(await r.art.api.workspaces.get(r.id)).filter((x) => x.kind === 'board').length;
    const before = await boards();
    const from = h.logs.length;
    await r.p.startPresenting({ kind: 'board', id: r.board });
    // Not a new board, and not a saved one, from anyone who isn't presenting it, the organizer included: nothing is made.
    const told = { code: 'conflict', status: 409, message: 'Someone else is presenting a board here. You can start one once they stop.' };
    expect(await refusal(r.host.openBoard({ template: 'blank' }))).toEqual(told);
    expect(await refusal(r.t.openBoard({ template: 'retro' }))).toEqual(told);
    expect(await refusal(r.host.openBoard({ workspaceId: r.id, documentId: planning, letIn: false }))).toEqual(told);
    expect(await refusal(r.host.openBoard({ workspaceId: r.id, documentId: planning, letIn: true }))).toEqual(told);
    expect(await boards()).toBe(before);
    expect(await opened(r.t)).toMatchObject({ documentId: r.board });
    expect(await presented(r.t)).toMatchObject({ kind: 'board', id: r.board });
    // The refusal names nobody, in what anyone's told or in the log: the call says who's presenting.
    expect(h.logs.slice(from).join('\n')).not.toContain(r.priya.name);
    // Bringing in the board that's presented takes it off nobody's stage, so that's still anyone's to do.
    await r.host.openBoard({ workspaceId: r.id, documentId: r.board, letIn: true });
    expect(await presented(r.t)).toMatchObject({ kind: 'board', id: r.board });
    // Whoever's presenting can open another: their presentation ends with the board it was of, and everyone following is told
    // at once, keeping the old one open on their own.
    const was = (await presented(r.t))?.key;
    await r.p.openBoard({ template: 'blank' });
    expect((await read(r.t)).workspace).toMatchObject({ present: null, ended: { key: was, close: false, by: { seat: expect.any(String), name: r.priya.name } } });
    expect((await opened(r.t))?.documentId).not.toBe(r.board);
    // And once nobody presents one, anyone invited can.
    await r.host.openBoard({ workspaceId: r.id, documentId: planning, letIn: false });
    expect(await opened(r.p)).toMatchObject({ documentId: planning });
    // The workspace presented is in no board's way. Theo, given only the call's board in it, is told who's presenting, never what.
    await r.p.startPresenting({ kind: 'workspace' });
    await r.host.openBoard({ template: 'blank' });
    expect(await presented(r.host)).toMatchObject({ kind: 'workspace', id: r.id });
    expect(await presented(r.t)).toMatchObject({ kind: null, id: null, by: { name: r.priya.name } });
  });

  it('is told in a call that has no workspace, from where the board is kept', async () => {
    const art = await account();
    const priya = await account();
    const design = await workspace(art, 'Design', [[priya, 'edit']]);
    const board = await saved(art, design, 'Onboarding flow');
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: null });
    const p = await invited(host, c, priya);
    await host.openBoard({ workspaceId: design, documentId: board, letIn: false });
    await host.startPresenting({ kind: 'board', id: board });
    expect((await read(p)).workspace).toMatchObject({ id: null, chosen: false });
    expect(await presented(p)).toMatchObject({ kind: 'board', id: board, name: 'Onboarding flow', section: 0, mine: false });
  });

  it('in a room, is the room’s board, for the room; and once rooms close, each room’s frame is a slide of the main board', async () => {
    const r = await inRooms({ mode: 'each', template: 'retro' });
    const one = (await opened(r.k))?.documentId ?? '';
    const two = (await opened(r.p))?.documentId ?? '';
    expect(await code(r.k.startPresenting({ kind: 'board', id: two }))).toBe('not-found');
    await r.k.startPresenting({ kind: 'board', id: one, section: 1 });
    expect(await presented(r.k)).toMatchObject({ kind: 'board', id: one, name: 'One board', section: 1, mine: true });
    expect(await presented(r.p)).toBeNull();
    expect(await presented(r.host)).toBeNull();
    // Priya presents Two's at the same time, in her room.
    await r.p.startPresenting({ kind: 'board', id: two });
    expect(await presented(r.p)).toMatchObject({ id: two, mine: true });
    expect(await presented(r.k)).toMatchObject({ id: one, mine: true });

    await closeAll(r);
    expect(await presented(r.k)).toBeNull();
    expect(await presented(r.p)).toBeNull();
    await until(async () => (await mainBoard(r))?.board.frames.filter((f) => !f.f).length === 2, 'both rooms’ boards to come back');
    const main = await mainBoard(r);
    const mainId = main?.id ?? '';
    expect(main?.board.frames.filter((f) => !f.f).map((f) => [f.title, f.sub])).toEqual([['One', first(r.kofi)], ['Two', first(r.priya)]]);
    await r.host.startPresenting({ kind: 'board', id: mainId });
    await r.host.movePresenting(1);
    expect(await presented(r.k)).toMatchObject({ kind: 'board', id: mainId, section: 1, mine: false });
    expect(await presented(r.p)).toMatchObject({ kind: 'board', id: mainId, section: 1, mine: false });
  });
});

describe('presenting the board the rooms share', () => {
  it('closed for everyone in a room by whoever presents it there, closes for that room alone: only whoever opened it, or the organizer, closes it for the call', async () => {
    const r = await inRooms({ mode: 'shared', template: 'retro' });
    const shared = await opened(r.k);
    // Kofi didn't open it and may not close it: board-close says so.
    expect(shared).toMatchObject({ canClose: false });
    expect(await code(r.k.closeBoard())).toBe('forbidden');
    const board = shared?.documentId ?? '';
    // In room One he presents it to his room, and closes it for everyone ("It closes for everyone in the call"): it's closed for
    // everyone in room One, and the board is still the call's, for room Two and the main room as for room One.
    await r.k.startPresenting({ kind: 'board', id: board });
    const kofis = (await presented(r.k))?.key;
    expect(await presented(r.k)).toMatchObject({ kind: 'board', mine: true });
    await r.k.stopPresenting(true);
    expect((await read(r.k)).workspace).toMatchObject({ present: null, ended: { key: kofis, close: true, by: { seat: expect.any(String), name: r.kofi.name } } });
    for (const call of [r.k, r.p, r.host]) expect((await opened(call))?.documentId).toBe(board);
    for (const call of [r.p, r.host]) expect((await read(call)).workspace.ended).toBeNull();

    // The organizer, visiting room One, presents it there and closes it for everyone: it closes for the call, in every room and
    // the main room, and so does Priya's presentation of it in room Two, closed for everyone, said there at once.
    await r.p.startPresenting({ kind: 'board', id: board });
    const priyas = (await presented(r.p))?.key;
    expect((await action(r.art, r.host, { type: 'rooms-visit', roomId: r.one })).status).toBe(200);
    await r.host.startPresenting({ kind: 'board', id: board });
    const arts = (await presented(r.k))?.key;
    await r.host.stopPresenting(true);
    for (const call of [r.k, r.p, r.host]) expect(await opened(call)).toBeNull();
    expect((await read(r.k)).workspace).toMatchObject({ present: null, ended: { key: arts, close: true } });
    expect((await read(r.p)).workspace).toMatchObject({ present: null, ended: { key: priyas, close: true, by: { seat: expect.any(String), name: r.priya.name } } });
  });

  it('closed for everyone by whoever opened it, closes for the call only while nobody else presents it in another room', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit'], [priya, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], workspace: id, title: 'Launch retro' });
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    // Kofi opens the main board, and the rooms share it.
    await k.openBoard({ template: 'retro' });
    const board = (await opened(host))?.documentId ?? '';
    expect((await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [priya.email] }], minutes: 10, board: { mode: 'shared', template: 'retro' } })).status).toBe(200);
    const [one, two] = ((await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? []).map((x) => x.id);
    await until(() => k.crypto.getSnapshot().place === one && p.crypto.getSnapshot().place === two, 'Kofi and Priya in their rooms');
    expect(await opened(k)).toMatchObject({ documentId: board, canClose: true });
    // With Priya presenting it in room Two, Kofi's close for everyone in room One is for room One alone: it stays the call's.
    await p.startPresenting({ kind: 'board', id: board });
    const hers = (await presented(p))?.key;
    await k.startPresenting({ kind: 'board', id: board });
    const first = (await presented(k))?.key;
    await k.stopPresenting(true);
    expect((await read(k)).workspace).toMatchObject({ present: null, ended: { key: first, close: true } });
    for (const call of [k, p, host]) expect((await opened(call))?.documentId).toBe(board);
    expect((await read(p)).workspace).toMatchObject({ present: { key: hers }, ended: null });
    // Once nobody else presents it, his close for everyone closes it for the call, as board-close would.
    await p.stopPresenting(false);
    await k.startPresenting({ kind: 'board', id: board });
    const second = (await presented(k))?.key;
    await k.stopPresenting(true);
    for (const call of [k, p, host]) expect(await opened(call)).toBeNull();
    expect((await read(k)).workspace).toMatchObject({ present: null, ended: { key: second, close: true } });
    expect((await read(p)).workspace).toMatchObject({ present: null, ended: { key: hers, close: false } });
  });
});

describe('a busy workspace', () => {
  it('holds up nothing in the call: boards wait for the workspace, and letting people in and hands don’t', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const board = await saved(art, id, 'Onboarding flow');
    const { host, code: c } = await callBy(art, { workspace: id });
    const kim = await guest(host, c, 'Kim');
    await host.openBoard({ workspaceId: id, documentId: board, letIn: true });
    expect(await opened(kim.call)).toMatchObject({ role: 'edit' });
    const base = await waitingOnLocks();
    // Something holds the workspace's row, as a long change to it does, on a connection of its own.
    const holder = new pg.Client({ connectionString: process.env['TEST_DATABASE_URL'] });
    await holder.connect();
    let jamie: Awaited<ReturnType<typeof guest>> | undefined;
    let lee: Awaited<ReturnType<typeof guest>> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM workspaces WHERE workspace_id = $1 FOR NO KEY UPDATE', [id]);
      // Two people are let in. Their seats on the board the call lets everyone into wait for the workspace; being let in doesn't.
      jamie = await soon(guest(host, c, 'Jamie'), 'letting Jamie in', 10_000);
      lee = await soon(guest(host, c, 'Lee'), 'letting Lee in', 10_000);
      // A new board is made in the workspace, so it waits too.
      let made = false;
      const opening = host.openBoard({ template: 'blank' }).then(() => { made = true; });
      void opening.catch(() => undefined);
      await until(async () => (await waitingOnLocks()) >= base + 3, 'the seats and the new board to wait for the workspace');
      // Hands go up meanwhile, and everyone reads the call: nothing about it waits.
      const status = (r: Response) => r.status;
      const crowd = [kim, jamie, lee];
      expect(await soon(Promise.all(crowd.map((g, i) => action(g, g.call, { type: 'hand', up: i !== 1 }).then(status))), 'hands going up', 3000)).toEqual([200, 200, 200]);
      expect(await soon(opened(jamie.call), 'reading the call', 3000)).toMatchObject({ role: null });
      expect(made).toBe(false);
      await holder.query('COMMIT');
      await opening;
    } finally {
      await holder.end();
    }
    // Once it's free, the new board is open, and everyone let in meanwhile is seated on both.
    const now = (await opened(host))?.documentId ?? '';
    expect(now).not.toBe(board);
    for (const g of [jamie, lee]) await until(async () => (await opened(g?.call ?? host))?.role === 'edit', 'a seat on the new board');
    await until(async () => (await seats(board)) === 3, 'Kim, Jamie and Lee on the saved board');
    expect(await seats(now)).toBe(3);
  });
});

/**
 * The call's state as a release that didn't know rooms' boards saved it (`origin/main` before the stored shapes came): zod drops
 * what its schemas don't name, so `board` keeps only what's open (without timers or votes) and who it lets in, open rooms lose
 * what they work on, and what was worked on loses the part of the call it was open in.
 */
const Unaware = z.object({
  board: z.object({ open: z.record(z.string(), z.object({ workspaceId: z.string(), documentId: z.string(), by: z.unknown() })).default({}), letIn: z.array(z.unknown()).default([]) }),
  breakouts: z.object({ open: z.object({ rooms: z.array(z.unknown()), from: z.number(), until: z.number(), message: z.unknown(), visiting: z.unknown() }).nullable(), held: z.array(z.unknown()) }),
  workspace: z.object({ worked: z.array(z.object({ workspaceId: z.string(), documentId: z.string(), kind: z.string(), by: z.array(z.unknown()) })) }).passthrough()
}).passthrough();
async function savedUnaware(ownerId: string, callId: string) {
  const was = await storedCall(ownerId, callId);
  await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, sealJson(was.key, was.header, toJson(Unaware.parse(was.state)))]);
}
/** A workspace's tree as a release that didn't know an item could be a room's saved it: every item without `room`. */
async function treeSavedUnaware(workspaceId: string) {
  const ownerId = (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]?.owner_id ?? '';
  const owner = await openOwner(h.deps, ownerId, undefined);
  const at = { key: workspaceKey(owner), header: { v: 1, kind: 'workspace-state', ownerId, workspaceId } as const };
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM workspaces WHERE owner_id = $1', [ownerId])).rows[0]);
  const tree = z.object({ items: z.record(z.string(), z.record(z.string(), z.unknown())) }).passthrough().parse(openJson(at.key, at.header, row.state_ciphertext, z.unknown()));
  const items = Object.fromEntries(Object.entries(tree.items).map(([id, x]) => { const { room: _room, ...rest } = x; return [id, rest]; }));
  await h.pool.query('UPDATE workspaces SET state_ciphertext = $2 WHERE owner_id = $1', [ownerId, sealJson(at.key, at.header, toJson({ ...tree, items }))]);
}
/** Whether a board is in its workspace's Trash, and whether the tree still says it's a room's, as the server reads it. */
async function itemOf(workspaceId: string, itemId: string) {
  const ownerId = (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]?.owner_id ?? '';
  const owner = await openOwner(h.deps, ownerId, undefined);
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM workspaces WHERE owner_id = $1', [ownerId])).rows[0]);
  const Tree = z.object({ items: z.record(z.string(), z.object({ trashedAt: z.string().nullable(), room: z.unknown().optional() }).passthrough()) }).passthrough();
  const item = Tree.parse(openJson(workspaceKey(owner), { v: 1, kind: 'workspace-state', ownerId, workspaceId }, row.state_ciphertext, z.unknown())).items[itemId];
  return { trashed: item ? item.trashedAt !== null : null, room: item?.room ?? null };
}

describe('what the previous release stored', () => {
  it('still opens: a call and a meeting from before any of this, and a board opens in them once the organizer makes a workspace', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, { guests: [kofi.email], workspace: null });
    const k = await invited(host, c, kofi);
    const { callId } = host.ticket;
    // Sealed as the release before this one sealed it: no `board`, and no `workspace`.
    const before = await storedCall(art.ownerId, callId);
    expect(before.state).toHaveProperty('board');
    const { board: _b, workspace: _w, ...older } = before.state;
    await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [art.ownerId, callId, sealJson(before.key, before.header, toJson(older))]);
    const o = await openOwner(h.deps, art.ownerId, undefined);
    const meeting = await getItem(o, o.pool, 'meeting', host.getSnapshot().meetingId, MeetingManifest, 'That meeting');
    const { workspaceId: _id, agenda: _a, ...oldMeeting } = meeting.manifest;
    await saveRevision(o, o.pool, meeting.itemId, meeting.revisionId, oldMeeting);

    expect((await read(host)).board).toEqual({ open: null, timer: null, vote: null, ideas: [] });
    expect((await read(k)).board).toEqual({ open: null, timer: null, vote: null, ideas: [] });
    expect(await code(k.closeBoard())).toBe('conflict');
    expect(await code(k.openBoard({ template: 'retro' }))).toBe('conflict');
    const made = await withWorkspace(host);
    await k.openBoard({ template: 'retro' });
    const open1 = await opened(host);
    expect(open1).toMatchObject({ workspaceId: made, openedBy: k.ticket.identity, role: 'edit', seal: 'Sealed', frame: null });
    // And it's stored in the new shape from then on, in the part of the call it's in: where it is and who opened it, and no template.
    const after = await storedCall(art.ownerId, callId);
    expect(after.state['board']).toMatchObject({ open: { main: { workspaceId: open1?.workspaceId, documentId: open1?.documentId } } });
    expect(JSON.stringify(after.state['board'])).not.toContain('template');
    await host.leave();
  });

  it('still opens with rooms open from before rooms had boards, and a workspace from before an item could be a room’s', async () => {
    const r = await inRooms(NO_ROOM_BOARD);
    const { callId } = r.host.ticket;
    const plan = await saved(r.art, r.id, 'Launch plan');
    // Sealed as the release before this one sealed it: open rooms with no Board row, and the call's boards with no rooms' boards.
    const before = await storedCall(r.art.ownerId, callId);
    const Old = z.object({ breakouts: z.object({ open: z.record(z.string(), z.unknown()) }).passthrough(), board: z.record(z.string(), z.unknown()) }).passthrough();
    const was = Old.parse(before.state);
    expect(was.breakouts.open).toHaveProperty('board');
    expect(was.board).toHaveProperty('rooms');
    const { board: _row, ...openBefore } = was.breakouts.open;
    const { rooms: _rooms, landing: _landing, ...boardBefore } = was.board;
    await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [r.art.ownerId, callId, sealJson(before.key, before.header, toJson({ ...was, breakouts: { ...was.breakouts, open: openBefore }, board: boardBefore }))]);
    const owner = await openOwner(h.deps, (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [r.id])).rows[0]?.owner_id ?? '', undefined);
    const ws = { key: workspaceKey(owner), header: { v: 1, kind: 'workspace-state', ownerId: owner.ownerId, workspaceId: r.id } as const };
    const wsRow = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM workspaces WHERE owner_id = $1', [owner.ownerId])).rows[0]);
    const Items = z.object({ items: z.record(z.string(), z.record(z.string(), z.unknown())) }).passthrough();
    const tree = Items.parse(openJson(ws.key, ws.header, wsRow.state_ciphertext, z.unknown()));
    const items = Object.fromEntries(Object.entries(tree.items).map(([id, x]) => { const { room: _room, ...rest } = x; return [id, rest]; }));
    await h.pool.query('UPDATE workspaces SET state_ciphertext = $2 WHERE owner_id = $1', [owner.ownerId, sealJson(ws.key, ws.header, toJson({ ...tree, items }))]);

    // The rooms read as having nothing to work on, and work as they did; a board can be started in one, and comes back.
    expect((await read(r.host)).breakouts.open).toMatchObject({ board: 'none', rooms: [{ id: r.one, board: false }, { id: r.two, board: false }] });
    expect(Object.values(tree.items).length).toBeGreaterThan(0);
    expect((await r.art.api.workspaces.get(r.id)).items.map((x) => x.id)).toContain(plan);
    await r.k.openBoard({ template: 'blank' });
    const board = (await opened(r.k))?.documentId ?? '';
    expect(await opened(r.k)).toMatchObject({ name: 'One board', seal: 'Sealed to this room' });
    expect(await opens(r.priya, r.id, board, r.p)).toBe('not-found');
    // Stored in the new shape from then on.
    const after = await storedCall(r.art.ownerId, callId);
    expect(after.state['board']).toMatchObject({ rooms: [{ documentId: board, room: r.one, kept: false }], landing: null });
    await closeAll(r);
    await until(async () => (await mainBoard(r))?.board.frames.some((f) => f.title === 'One') === true, 'the room’s board to come back');
    expect(await opens(r.priya, r.id, board)).toBe('allowed');
  });

  it('a board presented that isn’t open where it was presented, as the release before could keep, is over', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    const p = await invited(host, c, priya);
    await host.openBoard({ template: 'blank' });
    const board = (await opened(host))?.documentId ?? '';
    const other = await saved(art, id, 'Planning');
    await host.startPresenting({ kind: 'board', id: board });
    // As the release before kept one: a board in the workspace the call views, that isn't open in the call.
    const { callId } = host.ticket;
    const was = await storedCall(art.ownerId, callId);
    const Space = z.object({ present: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough();
    const space = Space.parse(was.state['workspace']);
    const older = { ...was.state, workspace: { ...space, present: space.present.map((x) => ({ ...x, id: other })) } };
    await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [art.ownerId, callId, sealJson(was.key, was.header, toJson(older))]);

    expect(await presented(p)).toBeNull();
    expect(await presented(host)).toBeNull();
    // There's nothing to move or stop, it's in nobody's way, and the next change takes it out of what the call keeps.
    expect(await code(host.movePresenting(1))).toBe('conflict');
    expect(await code(host.stopPresenting(false))).toBe('conflict');
    await p.startPresenting({ kind: 'board', id: board });
    expect(await presented(host)).toMatchObject({ kind: 'board', id: board, by: { name: priya.name } });
    expect(JSON.stringify((await storedCall(art.ownerId, callId)).state['workspace'])).not.toContain(other);
  });

  it('a board the release before presented, with no key, is told with one that holds from read to read and from person to person', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    const p = await invited(host, c, priya);
    await host.openBoard({ template: 'blank' });
    const board = (await opened(host))?.documentId ?? '';
    await p.startPresenting({ kind: 'board', id: board, section: 1 });
    // As the release before keeps one: with no key, and no start.
    const { callId } = host.ticket;
    const was = await storedCall(art.ownerId, callId);
    const Space = z.object({ present: z.array(z.record(z.string(), z.unknown())) }).passthrough();
    const space = Space.parse(was.state['workspace']);
    const older = { ...was.state, workspace: { ...space, present: space.present.map(({ key: _key, since: _since, ...x }) => x) } };
    await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [art.ownerId, callId, sealJson(was.key, was.header, toJson(older))]);

    // Everyone is told the same key for it, never an empty one, and it says nothing of what's presented.
    const key = (await presented(host))?.key ?? '';
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await presented(p)).toMatchObject({ key, kind: 'board', id: board, section: 1, mine: true });
    expect((await presented(host))?.key).toBe(key);
    // Moved on, it's the same presentation; stopped, it's that one that ended.
    await p.movePresenting(2);
    expect(await presented(host)).toMatchObject({ key, section: 2 });
    await p.stopPresenting(false);
    expect((await read(host)).workspace).toMatchObject({ present: null, ended: { key, close: false } });
    // Presenting it again is a new presentation.
    await p.startPresenting({ kind: 'board', id: board });
    expect((await presented(host))?.key).not.toBe(key);
  });

  it('keeps a presentation the next release writes through a save that doesn’t change it', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [priya.email], workspace: id });
    const p = await invited(host, c, priya);
    await host.openBoard({ template: 'blank' });
    const board = (await opened(host))?.documentId ?? '';
    await p.startPresenting({ kind: 'board', id: board });
    // As the next release keeps presenting: the board, with which presentation it is and since when, the workspace presented,
    // and how the last presentation ended.
    const { callId } = host.ticket;
    const was = await storedCall(art.ownerId, callId);
    const Space = z.object({ present: z.array(z.object({ by: z.unknown() }).passthrough()) }).passthrough();
    const space = Space.parse(was.state['workspace']);
    const by = space.present[0]?.by;
    if (!by) throw new Error('nothing presented');
    const present = space.present.map((x) => ({ ...x, key: 'k2', since: 3 }));
    const presenting = [{ place: 'main', workspaceId: id, key: 'k1', since: 1, by }];
    const ended = [{ place: 'main', key: 'k0', close: true, by, at: 2 }];
    await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [art.ownerId, callId, sealJson(was.key, was.header, toJson({ ...was.state, workspace: { ...space, present, space: presenting, ended } }))]);

    // Priya raises her hand through this release, which reads the call and saves it: the board is still presented, and all of
    // it is kept as it was written.
    expect((await action(priya, p, { type: 'hand', up: true })).status).toBe(200);
    expect((await settle(host, (s) => s.participants.some((x) => x.id === p.ticket.identity && x.hand))).workspace.present).toMatchObject({ kind: 'board', id: board });
    const after = Space.parse((await storedCall(art.ownerId, callId)).state['workspace']);
    expect({ present: after.present, space: after['space'], ended: after['ended'] }).toEqual({ present, space: presenting, ended });
  });

  it('a call it saved while rooms have boards still keeps each with its room, and everyone invited has them after, none in Trash', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' });
    const one = (await opened(r.k))?.documentId ?? '';
    const two = (await opened(r.p))?.documentId ?? '';
    // A browser's request reached a release that didn't know rooms' boards, which saved the call: a hand, a key moving, anything.
    await savedUnaware(r.art.ownerId, r.host.ticket.callId);
    // Kofi moves from One to Two: One's board goes from him, and Two's comes, as the call finds its rooms' boards again.
    expect((await action(r.art, r.host, { type: 'rooms-move', email: r.kofi.email, roomId: r.two })).status).toBe(200);
    expect({ one: await opens(r.kofi, r.id, one, r.k), two: await opens(r.kofi, r.id, two, r.k) }).toEqual({ one: 'not-found', two: 'allowed' });
    expect(Object.fromEntries((await keptOf(r)).board.rooms.map((b) => [b.documentId, b.room]))).toEqual({ [one]: r.one, [two]: r.two });
    // Rooms close and the call ends: each room's board is everyone invited's, and none is in Trash.
    await closeAll(r);
    await until(async () => (await mainBoard(r))?.board.frames.filter((f) => f.title === 'One' || f.title === 'Two').length === 2, 'both rooms’ boards to land');
    await r.host.leave();
    for (const who of [r.kofi, r.priya, r.art]) expect([await opens(who, r.id, one), await opens(who, r.id, two)]).toEqual(['allowed', 'allowed']);
    expect([await itemOf(r.id, one), await itemOf(r.id, two)]).toEqual([{ trashed: false, room: null }, { trashed: false, room: null }]);
    expect(await opens(r.maya, r.id, one)).toBe('not-found');
  });

  it('a workspace it saved during the call still never hands an empty room’s board to the admins, and the call puts its mark back', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' });
    const one = (await opened(r.k))?.documentId ?? '';
    // Everyone in One has gone for a moment: nobody holds its board.
    await r.k.leave();
    await until(async () => (await seats(one)) === 0, 'Kofi’s seat to go as he leaves', 5000);
    // Meanwhile something in Product changed through a release that didn't know an item could be a room's, which saved its tree.
    await treeSavedUnaware(r.id);
    expect((await itemOf(r.id, one)).room).toBeNull();
    // The admin takes Maya out of Product: whatever only she could open goes to the admins, and a room's board to nobody.
    const maya = (await r.art.api.workspaces.people(r.id)).find((x) => x.person.email === r.maya.email)?.id ?? '';
    await r.art.api.workspaces.removePerson(r.id, maya);
    expect({ art: await opens(r.art, r.id, one), entries: await entries(one) }).toEqual({ art: 'not-found', entries: 0 });
    // Kofi comes back to One: the call has the board's mark put back as it seats him.
    const back = await invited(r.host, r.code, r.kofi, r.k.ticket.identity);
    await until(async () => (await opened(back))?.role === 'edit', 'Kofi to have One’s board again', 5000);
    expect((await itemOf(r.id, one)).room).toEqual({ ownerId: r.art.ownerId, callId: r.host.ticket.callId });
  });

  it('a call it ended keeps its rooms’ boards for everyone invited, the first time anything in their workspace asks: never Trash, nor the admins’', async () => {
    const r = await inRooms({ mode: 'each', template: 'blank' });
    const lena = await account();
    await r.art.api.workspaces.addPerson(r.id, lena.email, 'admin');
    const one = (await opened(r.k))?.documentId ?? '';
    const two = (await opened(r.p))?.documentId ?? '';
    // The call ends through a release that knew rooms' boards only well enough to leave them be: its seats end, the call keeps
    // nothing of its boards, and each board is still marked its room's, with nobody to open it.
    const was = await storedCall(r.art.ownerId, r.host.ticket.callId);
    const ended = { ...was.state, board: { open: {}, letIn: [], rooms: [], landing: null, ideas: {} }, workspace: { asks: [], present: [], play: [], worked: [], agendaLooked: false, agendaDraft: null, viewing: null, home: null, made: [] } };
    await h.pool.query("UPDATE calls SET state = 'ended', ended_at = now(), state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2", [r.art.ownerId, r.host.ticket.callId, sealJson(was.key, was.header, toJson(ended))]);
    await h.pool.query("DELETE FROM document_access WHERE call_id = $1 AND kind = 'seat'", [r.host.ticket.callId]);
    expect([await entries(one), (await itemOf(r.id, one)).room]).toEqual([0, { ownerId: r.art.ownerId, callId: r.host.ticket.callId }]);
    // Something in Product asks what nobody can open: an admin takes Maya out.
    const maya = (await r.art.api.workspaces.people(r.id)).find((x) => x.person.email === r.maya.email)?.id ?? '';
    await r.art.api.workspaces.removePerson(r.id, maya);
    // Each room's board is everyone invited's by address, as the call's end would have left it, and a restricted board like any other.
    for (const board of [one, two]) {
      expect(await entries(board)).toBe(3);
      expect(await itemOf(r.id, board)).toEqual({ trashed: false, room: null });
      for (const who of [r.art, r.kofi, r.priya]) expect(await opens(who, r.id, board)).toBe('allowed');
      expect(await opens(lena, r.id, board)).toBe('not-found');
    }
  });

  it('ends with the call: what it kept of its boards goes', async () => {
    const art = await account();
    const { host } = await callBy(art);
    await host.openBoard({ template: 'blank' });
    const { callId } = host.ticket;
    expect(JSON.stringify((await storedCall(art.ownerId, callId)).state['board'])).toContain(art.name);
    await host.leave();
    expect((await storedCall(art.ownerId, callId)).state['board']).toEqual({ open: {}, letIn: [], rooms: [], landing: null, ideas: {} });
  });
});
