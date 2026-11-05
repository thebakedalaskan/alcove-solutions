/**
 * A board in a call, through browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres, the object
 * store and the local LiveKit server: who can open one and who sees it, closing it, bringing a saved board and who's let in,
 * the workspace it's saved in, and what someone left out is told, which is nothing that names it.
 */
import { AlcoveApiError, type CallSession, type CallState, type DocSession, type DocSessionOptions, type WorkspaceRole } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from './crypto';
import { startHarness, type Browser, type Harness } from './testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from './testing/livekit';
import { reconcile } from './modules/calls';
import { MeetingManifest } from './modules/meetings';
import { openOwner } from './owners';
import { getItem, saveRevision } from './vault';

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
async function invited(host: CallSession, callCode: string, who: Account) {
  const call = await who.api.calls.join(callCode, { mic: false, cam: false });
  await inGroup(call);
  await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
  return call;
}
/** A call `org` hosts, with `guests` invited. */
async function callBy(org: Account, o: { guests?: string[]; title?: string } = {}) {
  const { code: c } = await org.api.calls.startNow({ notes: 'off', guests: o.guests ?? [], ...(o.title ? { title: o.title } : {}) });
  const host = await org.api.calls.join(c, { mic: false, cam: false });
  await inGroup(host);
  return { host, code: c };
}
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
/** Everything the call told this person, as text: what a name would be found in. */
const said = (s: CallState) => JSON.stringify(s);
/** An action as a browser sends it, whatever the client would make of it. */
const action = (who: Browser, call: CallSession, a: unknown) => who.fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(a) });
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
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email], title: 'Launch  review' });
    await host.setWorkspace(id);
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c);
    const pass = { pass: jamie.call.ticket.pass };
    expect(host.getSnapshot().board).toEqual({ open: null });
    const stream = art.api.workspaces.live(id);
    await until(() => stream.getSnapshot().status === 'live', 'the stream');

    // Kofi isn't in the workspace, and being invited is enough.
    await k.openBoard({ template: 'retro' });
    const made = k.getSnapshot().board.open;
    const board = made?.documentId ?? '';
    expect(made).toEqual({ workspaceId: id, documentId: board, name: 'Launch review', openedBy: k.ticket.identity, canClose: true, role: 'edit', seal: 'Sealed' });
    expect(await opened(host)).toEqual({ ...made, canClose: true });
    expect(await opened(p)).toEqual({ ...made, canClose: false });
    expect(await opened(jamie.call)).toEqual({ ...made, canClose: false });

    // It's an item like any other, by whoever started it, and every stream of the workspace hears of it.
    await until(() => stream.getSnapshot().tree?.items.some((x) => x.id === board) === true, 'the stream to hear of it');
    expect((await art.api.workspaces.get(id)).items).toEqual([expect.objectContaining({ id: board, kind: 'board', name: 'Launch review', parent: null, restricted: false, role: 'edit', by: expect.objectContaining({ name: kofi.name }) })]);
    // The workspace's people have it by their role, and those invited by email. A guest has a seat, and only that.
    expect((await lena.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'read']]);
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
    expect((await art.api.workspaces.get(id)).items.map((x) => x.id)).toEqual([board]);
  });

  it('takes every template, and nothing else', async () => {
    const art = await account();
    const { host } = await callBy(art);
    for (const template of ['blank', 'retro', 'ideas', 'flow', 'what-why-next'] as const) await host.openBoard({ template });
    expect(host.getSnapshot().board.open).toMatchObject({ role: 'edit' });
    expect((await action(art, host, { type: 'board-open', template: 'not-a-template' })).status).toBe(400);
    expect((await action(art, host, { type: 'board-open' })).status).toBe(400);
    expect((await action(art, host, { type: 'board-open', documentId: 'nope', letIn: false })).status).toBe(400);
    expect((await action(art, host, { type: 'board-open', documentId: madeUp() })).status).toBe(400);
  });

  it('isn’t a guest’s to start: they’re told so at info, and it settles nothing', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const board = await saved(art, id, 'Theirs');
    const { host, code: c } = await callBy(art);
    const jamie = await guest(host, c);
    const from = h.logs.length;
    const told = { code: 'forbidden', status: 403, message: 'Guests can add to a board, but can’t start one.' };
    expect(await refusal(jamie.call.openBoard({ template: 'blank' }))).toEqual(told);
    expect(await refusal(jamie.call.openBoard({ documentId: board, letIn: false }))).toEqual(told);
    expect(await refusal(jamie.call.boardCheck(board))).toEqual(told);
    // The same whatever's asked for, so it says nothing about what exists.
    expect(await refusal(jamie.call.openBoard({ documentId: madeUp(), letIn: true }))).toEqual(told);
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
    expect(await code(waiting.boardCheck(madeUp()))).toBe('forbidden');
    await host.openBoard({ template: 'blank' });
    expect(waiting.getSnapshot().board).toEqual({ open: null });
    await waiting.refresh({ call: true, log: false });
    expect(waiting.getSnapshot().board).toEqual({ open: null });
  });

  it('reaches whoever comes late or comes back, as a guest’s seat or the board they opened', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    await host.setWorkspace(id);
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
    const { host, code: c } = await callBy(art, { guests: [kofi.email], title: 'Planning' });
    await host.setWorkspace(id);
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'blank' });
    const before = host.getSnapshot().board.open?.documentId ?? '';
    await k.openBoard({ template: 'flow' });
    const after = k.getSnapshot().board.open?.documentId ?? '';
    expect(after).not.toBe(before);
    // Who opened it now is whoever opened this one: the one it replaced was theirs and nobody's now.
    expect(await opened(host)).toMatchObject({ documentId: after, openedBy: k.ticket.identity, canClose: true });
    expect(k.getSnapshot().board.open).toMatchObject({ documentId: after, openedBy: k.ticket.identity, canClose: true });
    expect((await art.api.workspaces.get(id)).items.map((x) => x.id).sort()).toEqual([before, after].sort());
    // Two at once: one is open, and both are kept.
    await Promise.all([host.openBoard({ template: 'blank' }), k.openBoard({ template: 'blank' })]);
    const items = (await art.api.workspaces.get(id)).items.map((x) => x.id);
    expect(items).toHaveLength(4);
    expect(items).toContain((await opened(host))?.documentId);
    expect((await opened(k))?.documentId).toBe((await opened(host))?.documentId);
  });

  it('keeps a call from making boards without end', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const { host } = await callBy(art);
    await host.setWorkspace(id);
    for (let i = 0; i < 50; i++) await host.openBoard({ template: 'blank' });
    const last = (await opened(host))?.documentId;
    expect(await refusal(host.openBoard({ template: 'blank' }))).toMatchObject({ code: 'conflict', message: 'This call has as many boards as it can take. Open one it already has.' });
    expect((await art.api.workspaces.get(id)).items).toHaveLength(50);
    // The ones it made still open, and what was open stays.
    expect(await opened(host)).toMatchObject({ documentId: last });
    const made = (await art.api.workspaces.get(id)).items[0]?.id ?? '';
    await host.openBoard({ documentId: made, letIn: false });
    expect((await opened(host))?.documentId).toBe(made);
    await host.openBoard({ documentId: made, letIn: true });
    // A saved board that's new to the call can open, and it's letting everyone into another that it hasn't room for.
    const other = await saved(art, id, 'Another');
    expect(await code(host.openBoard({ documentId: other, letIn: true }))).toBe('conflict');
    await host.openBoard({ documentId: other, letIn: false });
    expect((await opened(host))?.documentId).toBe(other);
  });

  it('is refused in a workspace the organizer can’t edit in any more, and the call goes on', async () => {
    const art = await account();
    const lena = await account();
    const kofi = await account();
    const id = await workspace(lena, 'Lena’s', [[art, 'edit']]);
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    await host.setWorkspace(id);
    const k = await invited(host, c, kofi);
    const people = await lena.api.workspaces.people(id);
    const them = people.find((p) => p.person.email === art.email)?.id ?? '';
    await lena.api.workspaces.setRole(id, them, 'read');
    const told = { code: 'conflict', status: 409, message: 'This call’s workspace can’t take a new board. Ask the organizer to choose another.' };
    const toldThem = { code: 'conflict', status: 409, message: 'You can’t add to this call’s workspace any more. Choose another.' };
    expect(await refusal(k.openBoard({ template: 'blank' }))).toEqual(told);
    expect(await refusal(host.openBoard({ template: 'blank' }))).toEqual(toldThem);
    await lena.api.workspaces.removePerson(id, them);
    expect(await refusal(k.openBoard({ template: 'blank' }))).toEqual(told);
    expect(await refusal(host.openBoard({ template: 'blank' }))).toEqual(toldThem);
    expect((await lena.api.workspaces.get(id)).items).toEqual([]);
    expect(await opened(k)).toBeNull();
    // Choosing another puts it right.
    await host.newWorkspace('Art’s');
    await k.openBoard({ template: 'blank' });
    expect((await opened(k))?.workspaceId).toBe((await read(host)).workspace.id);
  });

  it('is read again while it’s open, so what happens to it outside the call shows with no nudge', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    await host.setWorkspace(id);
    const k = await invited(host, c, kofi);
    await k.openBoard({ template: 'blank' });
    const board = k.getSnapshot().board.open?.documentId ?? '';
    // Nothing tells the call: a browser finds out by reading it, as it checks its keys.
    await art.api.workspaces.items.rename(id, board, 'Renamed');
    await until(() => k.getSnapshot().board.open?.name === 'Renamed', 'the new name to show');
    await art.api.workspaces.items.trash(id, board);
    await until(() => k.getSnapshot().board.open === null, 'the board to go');
  });

  it('goes from the call when it’s in Trash or deleted, and comes back with it', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    await host.setWorkspace(id);
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
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email] });
    await host.setWorkspace(id);
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
    expect(k.getSnapshot().board).toEqual({ open: null });
    expect((await read(jamie.call)).board).toEqual({ open: null });
    expect((await art.api.workspaces.get(id)).items.map((x) => x.id)).toEqual([board]);
    expect(await seats(board)).toBe(1);
    expect((await jamie.api.workspaces.get(id, { pass: jamie.call.ticket.pass })).items.map((x) => x.id)).toEqual([board]);

    // People may open it again: it's the same board, and the guest is still in it.
    await p.openBoard({ documentId: board, letIn: false });
    expect(await opened(jamie.call)).toMatchObject({ documentId: board, role: 'edit', openedBy: p.ticket.identity });
    expect(await refusal(k.closeBoard())).toEqual(notYours);

    // The organizer, whoever opened it.
    await host.closeBoard();
    expect(await opened(p)).toBeNull();
    expect((await art.api.workspaces.get(id)).items.map((x) => x.id)).toEqual([board]);
  });

  it('stays the organizer’s when whoever opened it has gone, and doesn’t go with hosting', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email] });
    await host.setWorkspace(id);
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
    const { host, code: c } = await callBy(art, { guests: [priya.email, rita.email, theo.email], title: 'Weekly' });
    await host.setWorkspace(id);
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
    expect(await code(r.openBoard({ documentId: board, letIn: false }))).toBe('forbidden');
    expect(await code(r.boardCheck(board))).toBe('forbidden');
    expect(await code(t.openBoard({ documentId: board, letIn: false }))).toBe('not-found');
    expect(await code(t.boardCheck(board))).toBe('not-found');
    // Only a board is a board, and one in Trash is in Trash.
    for (const other of [plan, folder, madeUp()]) {
      expect(await code(p.openBoard({ documentId: other, letIn: false }))).toBe('not-found');
      expect(await code(p.boardCheck(other))).toBe('not-found');
    }
    expect(await refusal(p.openBoard({ documentId: plan, letIn: false }))).toEqual(await refusal(p.openBoard({ documentId: madeUp(), letIn: false })));
    const old = await saved(art, id, 'Old');
    await art.api.workspaces.items.trash(id, old);
    expect(await code(p.openBoard({ documentId: old, letIn: false }))).toBe('conflict');
    expect(await code(p.boardCheck(old))).toBe('conflict');
    expect(await opened(host)).toBeNull();

    // Who can't open it, by first name, in the order they came. Rita can read it, so she isn't one of them.
    const shown = await p.boardCheck(board);
    expect(shown).toEqual({ cannot: [first(theo), 'Jamie'], mayLetIn: true });
    expect(await host.boardCheck(board)).toEqual(shown);
    // Asking changes nothing.
    expect(await entries(board)).toBe(0);
    expect(await opened(t)).toBeNull();
    // Nobody who's gone is named.
    await jamie.call.leave();
    await settle(host, (s) => !s.participants.some((x) => x.id === jamie.call.ticket.identity));
    expect(await p.boardCheck(board)).toEqual({ cannot: [first(theo)], mayLetIn: true });
  });

  it('asks for the right to share it before letting anyone in, whatever else they can do', async () => {
    const { art, theo, id, board, host, code: c } = await room();
    const t = await invited(host, c, theo);
    await guest(host, c);
    // Theo can edit it and isn't in the workspace: that's the workspace's rule, and a call doesn't get round it.
    await art.api.workspaces.share.set(id, board, [{ email: theo.email }], 'edit');
    expect(await t.boardCheck(board)).toEqual({ cannot: ['Jamie'], mayLetIn: false });
    expect(await code(t.openBoard({ documentId: board, letIn: true }))).toBe('not-found');
    expect(await opened(t)).toBeNull();
    expect(await seats(board)).toBe(0);
    // Without letting anyone in, they can bring it.
    await t.openBoard({ documentId: board, letIn: false });
    expect(await opened(host)).toMatchObject({ documentId: board, openedBy: t.ticket.identity, role: 'edit' });
    expect(await seats(board)).toBe(0);
  });

  it('lets people in for the call: everyone who can’t open it, anyone admitted later, and it all ends with the call', async () => {
    const { art, priya, rita, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const r = await invited(host, c, rita);
    const t = await invited(host, c, theo);
    const jamie = await guest(host, c);
    await p.openBoard({ documentId: board, letIn: true });
    expect(p.getSnapshot().board.open).toEqual({ workspaceId: id, documentId: board, name: 'Onboarding flow', openedBy: p.ticket.identity, canClose: true, role: 'edit', seal: 'Sealed' });
    // Only the people who couldn't open it: Rita keeps what the workspace gives her.
    expect(await seats(board)).toBe(2);
    for (const who of [t, jamie.call]) expect(await opened(who)).toMatchObject({ documentId: board, name: 'Onboarding flow', role: 'edit', canClose: false });
    expect(await opened(r)).toMatchObject({ documentId: board, role: 'read' });
    expect((await art.api.workspaces.share.list(id, board)).entries.map((e) => [e.kind, e.role]).sort()).toEqual([['seat', 'edit'], ['seat', 'edit']]);
    // They see that one board and nothing else in the workspace, by their seat.
    expect((await theo.api.workspaces.get(id, { pass: t.ticket.pass })).items.map((x) => x.id)).toEqual([board]);
    expect(await p.boardCheck(board)).toEqual({ cannot: [], mayLetIn: true });

    // Someone admitted later gets a seat too: it's a policy on the call, not a list.
    const sam = await guest(host, c, 'Sam Guest');
    await until(async () => (await opened(sam.call))?.role === 'edit', 'a seat for someone admitted later');
    expect(await seats(board)).toBe(3);
    // Closing leaves the policy where it was, and someone admitted now finds it when it's opened again.
    await p.closeBoard();
    const lee = await guest(host, c, 'Lee Guest');
    await until(async () => (await seats(board)) === 4, 'a seat for someone admitted while it’s closed');
    await p.openBoard({ documentId: board, letIn: false });
    expect(await opened(lee.call)).toMatchObject({ documentId: board, role: 'edit' });

    // It all ends with the call.
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'every seat to end with the call');
    expect(await code(theo.api.workspaces.get(id))).toBe('not-found');
    expect((await art.api.workspaces.get(id)).items.map((x) => x.id)).toEqual([board]);
    expect(await entries(board)).toBe(0);
  });

  it('opens without them: they see a board they can’t open, and so does anyone admitted later', async () => {
    const { priya, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    await p.openBoard({ documentId: board, letIn: false });
    const left = { workspaceId: null, documentId: null, name: null, openedBy: p.ticket.identity, canClose: false, role: null, seal: 'Sealed' };
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
    await p.openBoard({ documentId: board, letIn: true });
    expect(await opened(t)).toMatchObject({ documentId: board, role: 'edit' });
    expect(await opened(jamie.call)).toMatchObject({ documentId: board, role: 'edit' });
  });

  it('keeps a seat taken back in Share taken back, and everything that’s been decided decided', async () => {
    const { art, priya, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c, 'Jamie Guest');
    await p.openBoard({ documentId: board, letIn: true });
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
    await p.openBoard({ documentId: board, letIn: true });
    expect(await opened(back)).toMatchObject({ role: 'edit' });
    expect(await seats(board)).toBe(2);
  });

  it('stops letting people in once whoever did it can’t share it any more', async () => {
    const { art, priya, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    await p.openBoard({ documentId: board, letIn: true });
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
    await p.openBoard({ documentId: board, letIn: true });
    const page = await open(priya, id, board, { pass: p.ticket.pass });
    await art.api.workspaces.share.restrict(id, board, true);
    // Priya had it through the workspace. She can still close it, as whoever opened it, and that's all she's told.
    const seen = await read(p);
    expect(seen.board.open).toEqual({ workspaceId: null, documentId: null, name: null, openedBy: p.ticket.identity, canClose: true, role: null, seal: 'Sealed' });
    expect(said(seen)).not.toContain('Onboarding flow');
    await until(() => page.getSnapshot().closed === 'access', 'her page to close');
    expect(await code(p.openBoard({ documentId: board, letIn: false }))).toBe('not-found');
    expect(await code(p.boardCheck(board))).toBe('not-found');
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
    const { host, code: c } = await callBy(art, { guests: [priya.email] });
    await host.setWorkspace(id);
    const p = await invited(host, c, priya);
    inRoom.push(await connect(await p.room(), { sending: p.crypto }));
    await host.handOff(p.ticket.identity);
    await settle(p, (s) => s.isHost);
    await inGroup(p);
    await p.openBoard({ documentId: board, letIn: true });
    expect(await seats(board)).toBe(0);
    const back = await art.api.calls.join(c, { mic: false, cam: false });
    await inGroup(back);
    expect(await opened(back)).toMatchObject({ documentId: board, role: 'edit', canClose: true });
    expect(await seats(board)).toBe(1);
  });

  it('opens from where it is when it was brought to the call, whichever workspace the call uses now', async () => {
    const { art, priya, theo, id, board, host, code: c } = await room();
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    await host.bringDocument(board, true);
    const other = await workspace(art, 'Other', [[priya, 'edit'], [theo, 'edit']]);
    await host.setWorkspace(other);
    expect(await p.boardCheck(board)).toEqual({ cannot: [first(theo)], mayLetIn: true });
    // Someone in the call's workspace who can't reach where it was brought from is told what anyone's told about nothing.
    const nothing = madeUp();
    expect(await refusal(t.boardCheck(board))).toEqual(await refusal(t.boardCheck(nothing)));
    expect(await refusal(t.openBoard({ documentId: board, letIn: false }))).toEqual(await refusal(t.openBoard({ documentId: nothing, letIn: false })));
    await p.openBoard({ documentId: board, letIn: false });
    expect(await opened(host)).toMatchObject({ workspaceId: id, documentId: board, name: 'Onboarding flow' });
    // A new board goes where the call is now, and moving the call interrupts nothing that's open.
    await host.setWorkspace(id);
    expect(await opened(p)).toMatchObject({ workspaceId: id, documentId: board });
    await host.setWorkspace(other);
    expect(await opened(p)).toMatchObject({ workspaceId: id, documentId: board });
    await p.openBoard({ template: 'blank' });
    expect(await opened(host)).toMatchObject({ workspaceId: other });
  });

  it('tells someone left out nothing about it: not in the call, an error or a log', async () => {
    const art = await account();
    const theo = await account();
    const id = await workspace(art, 'CANARY-SPACE Product');
    const board = await saved(art, id, 'CANARY-BOARD Onboarding flow');
    const { host, code: c } = await callBy(art, { guests: [theo.email], title: 'Weekly' });
    await host.setWorkspace(id);
    const t = await invited(host, c, theo);
    const jamie = await guest(host, c);
    const from = h.logs.length;
    await host.openBoard({ documentId: board, letIn: false });
    expect(host.getSnapshot().board.open?.name).toBe('CANARY-BOARD Onboarding flow');
    for (const call of [t, jamie.call]) {
      const seen = await read(call);
      expect(seen.board.open).toEqual({ workspaceId: null, documentId: null, name: null, openedBy: host.ticket.identity, canClose: false, role: null, seal: 'Sealed' });
      for (const name of ['CANARY', id, board]) expect(said(seen), name).not.toContain(name);
    }
    // What they try reads the same as for what doesn't exist, in the same words.
    const nothing = madeUp();
    expect(await refusal(t.boardCheck(board))).toEqual(await refusal(t.boardCheck(nothing)));
    expect(await refusal(t.openBoard({ documentId: board, letIn: false }))).toEqual(await refusal(t.openBoard({ documentId: nothing, letIn: false })));
    expect(await refusal(t.openBoard({ documentId: board, letIn: true }))).toEqual(await refusal(t.openBoard({ documentId: nothing, letIn: true })));
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
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
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
    await host.openBoard({ documentId: board, letIn: true });
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
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
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
    for (const who of [rita, sara]) expect((await who.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'edit']]);
  });

  it('stops being given to anyone new once someone restricts it: that’s someone deciding who has it', async () => {
    const art = await account();
    const nora = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const n = await nora.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, n);
    await until(async () => (await opened(n))?.role === 'edit', 'a seat for Nora');
    await art.api.workspaces.share.restrict(id, board, true);
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(1);
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
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const n = await nora.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, n);
    await until(async () => (await opened(n))?.role === 'edit', 'a seat for Nora');
    const people = await lena.api.workspaces.people(id);
    await lena.api.workspaces.setRole(id, people.find((p) => p.person.email === art.email)?.id ?? '', 'read');
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toMatchObject({ role: null, name: null });
    expect(await seats(board)).toBe(1);
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seats to end with the call');
    expect(await entries(board)).toBe(0);
    expect(await code(nora.api.workspaces.get(id))).toBe('not-found');
  });

  it('can still be opened to people by someone who may share it, on their word and not the call’s', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    await art.api.workspaces.share.restrict(id, board, true);
    const jamie = await guest(host, c);
    await rest(150);
    expect(await opened(jamie.call)).toMatchObject({ role: null });
    // Art made it, so Art can share it. Everyone here is let in, and so is anyone after.
    await host.openBoard({ documentId: board, letIn: true });
    expect(await opened(jamie.call)).toMatchObject({ role: 'edit' });
    const sam = await guest(host, c, 'Sam Guest');
    await until(async () => (await opened(sam.call))?.role === 'edit', 'a seat for Sam');
  });

  it('gives someone taken out of the call nothing opened after they went, and leaves them what they had, as the note does', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email] });
    await host.setWorkspace(id);
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

  it('stays with whoever’s on the invite and has a seat when the call ends, however they got there', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    await host.setWorkspace(id);
    const k = await invited(host, c, kofi);
    // Taken out and back by the link: they were invited from the start, so they're still on the invite, and not from the link.
    await host.remove(k.ticket.identity);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    const back = await invited(host, c, kofi);
    await until(async () => (await opened(back))?.role === 'edit', 'a seat for Kofi');
    await host.leave();
    await until(async () => (await seats(board)) === 0, 'the seats to end with the call');
    expect((await kofi.api.workspaces.get(id)).items.map((x) => [x.id, x.role])).toEqual([[board, 'edit']]);
  });
});

describe('keeping seats in step', () => {
  it('puts right at the next upkeep a seat that a crash kept from someone let in', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
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
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    await host.openBoard({ template: 'blank' });
    const full = host.getSnapshot().board.open?.documentId ?? '';
    await host.openBoard({ template: 'blank' });
    const beside = host.getSnapshot().board.open?.documentId ?? '';
    await host.setWorkspace(other);
    await host.openBoard({ template: 'blank' });
    const elsewhere = host.getSnapshot().board.open?.documentId ?? '';
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

  it('is the organizer’s most recently used otherwise, kept on the meeting, so it doesn’t change mid-way', async () => {
    const art = await account();
    const kofi = await account();
    await workspace(art, 'First');
    const second = await workspace(art, 'Second');
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    const k = await invited(host, c, kofi);
    await k.openBoard({ template: 'blank' });
    expect(await opened(host)).toMatchObject({ workspaceId: second });
    expect((await art.api.meetings.get(host.getSnapshot().meetingId)).workspaceId).toBe(second);
    await workspace(art, 'Third');
    await k.openBoard({ template: 'blank' });
    expect(await opened(host)).toMatchObject({ workspaceId: second });
    expect((await art.api.workspaces.get(second)).items).toHaveLength(2);
  });

  it('is a new one in the organizer’s name when they have none, whoever opened it', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    const k = await invited(host, c, kofi);
    await Promise.all([k.openBoard({ template: 'blank' }), host.openBoard({ template: 'blank' })]);
    const mine = await art.api.workspaces.list();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ role: 'admin', people: 1 });
    expect(mine[0]?.name).toContain(first(art));
    expect(await opened(host)).toMatchObject({ workspaceId: mine[0]?.id });
    // It isn't Kofi's: he has what was opened with him, and it's the organizer's workspace.
    expect((await kofi.api.workspaces.list()).filter((x) => x.role !== null)).toEqual([]);
    expect((await read(k)).workspace).toMatchObject({ id: mine[0]?.id, name: null, role: null, canOpen: true });
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
    await host.openBoard({ template: 'blank' });
    const settled = host.getSnapshot().board.open?.workspaceId;
    expect(settled).toBeTruthy();
    await until(async () => (await art.api.meetings.get(calls[1]?.id ?? '')).workspaceId === settled, 'the next call to follow');
    await host.leave();
    const next = await art.api.calls.join(calls[1]?.code ?? '', { mic: false, cam: false });
    await inGroup(next);
    await next.openBoard({ template: 'blank' });
    expect(next.getSnapshot().board.open?.workspaceId).toBe(settled);
    expect((await art.api.workspaces.get(settled ?? '')).items).toHaveLength(2);
    // The next call scheduled by hand takes it along too.
    const later = await art.api.meetings.scheduleNext(calls[1]?.id ?? '', new Date(at + 21 * 86_400_000).toISOString());
    expect(later.workspaceId).toBe(settled);
  });

  it('isn’t something a request can name, and someone else’s board reads as one that isn’t there', async () => {
    const art = await account();
    const lena = await account();
    const kofi = await account();
    const product = await workspace(art, 'Product');
    const hers = await workspace(lena, 'CANARY-HERS');
    const hidden = await saved(lena, hers, 'CANARY-HIDDEN');
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    await host.setWorkspace(product);
    const k = await invited(host, c, kofi);
    const nothing = madeUp();
    for (const call of [host, k]) {
      expect(await refusal(call.openBoard({ documentId: hidden, letIn: false }))).toEqual(await refusal(call.openBoard({ documentId: nothing, letIn: false })));
      expect(await refusal(call.openBoard({ documentId: hidden, letIn: true }))).toEqual(await refusal(call.openBoard({ documentId: nothing, letIn: true })));
      expect(await refusal(call.boardCheck(hidden))).toEqual(await refusal(call.boardCheck(nothing)));
      expect(await code(call.boardCheck(hidden))).toBe('not-found');
    }
    // A request naming a workspace is heard for what's in it and no more.
    const sent = await action(art, host, { type: 'board-open', documentId: hidden, workspaceId: hers, letIn: false });
    expect(sent.status).toBe(404);
    expect(await sent.text()).not.toContain('CANARY');
    const into = await action(art, host, { type: 'board-open', template: 'blank', workspaceId: hers, parent: hidden });
    expect(into.status).toBe(200);
    expect((await lena.api.workspaces.get(hers)).items.map((x) => x.id)).toEqual([hidden]);
    expect((await art.api.workspaces.get(product)).items.map((x) => x.kind)).toEqual(['board']);
    expect(await opened(host)).toMatchObject({ workspaceId: product });
    // Nor does a meeting take one its organizer can't reach, so nothing brings it into the call that way.
    expect(await code(art.api.meetings.update(host.getSnapshot().meetingId, { workspaceId: hers }))).toBe('not-found');
    // Nor can a browser reach what isn't theirs with a pass from this call.
    expect(await code(kofi.api.workspaces.get(hers, { pass: k.ticket.pass }))).toBe('not-found');
    // A board in this call's workspace from another call's point of view is nobody's business either.
    const elsewhere = await callBy(lena);
    await elsewhere.host.setWorkspace(hers);
    const theirs = elsewhere.host;
    expect(await refusal(theirs.openBoard({ documentId: (await opened(host))?.documentId ?? '', letIn: false }))).toEqual(await refusal(theirs.openBoard({ documentId: nothing, letIn: false })));
  });
});

describe('breakout rooms', () => {
  it('are their own part of the call: a main board doesn’t show there, and one can’t start there yet', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    await host.setWorkspace(id);
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'blank' });
    const board = host.getSnapshot().board.open?.documentId ?? '';
    host.openRooms({ rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [] }], minutes: 5 });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await until(() => k.crypto.getSnapshot().place === rooms[0]?.id, 'Kofi to be in their room');
    expect(await opened(k)).toBeNull();
    expect(await opened(host)).toMatchObject({ documentId: board });
    const told = { code: 'conflict', status: 409, message: 'Open a board from the main room.' };
    expect(await refusal(k.openBoard({ template: 'blank' }))).toEqual(told);
    expect(await refusal(k.openBoard({ documentId: board, letIn: false }))).toEqual(told);
    expect(await refusal(k.boardCheck(board))).toEqual(told);
    expect(await refusal(k.closeBoard())).toMatchObject({ code: 'conflict', message: 'No board is open here.' });
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    await until(async () => (await opened(k))?.documentId === board, 'Kofi to find it back in the main room');
  });

  it('settle nothing by being refused: a workspace isn’t made for a board that won’t open', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    const k = await invited(host, c, kofi);
    host.openRooms({ rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [] }], minutes: 5 });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await until(() => k.crypto.getSnapshot().place === rooms[0]?.id, 'Kofi to be in their room');
    expect(await code(k.openBoard({ template: 'blank' }))).toBe('conflict');
    expect(await art.api.workspaces.list()).toEqual([]);
    expect((await art.api.meetings.get(host.getSnapshot().meetingId)).workspaceId).toBeNull();
  });

  it('counts whoever’s in one among the people a main board leaves out, and seats them too', async () => {
    const art = await account();
    const theo = await account();
    const id = await workspace(art, 'Product');
    const board = await saved(art, id, 'Onboarding flow');
    const { host, code: c } = await callBy(art, { guests: [theo.email] });
    await host.setWorkspace(id);
    const t = await invited(host, c, theo);
    host.openRooms({ rooms: [{ name: 'One', emails: [theo.email] }, { name: 'Two', emails: [] }], minutes: 5 });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await until(() => t.crypto.getSnapshot().place === rooms[0]?.id, 'Theo to be in their room');
    expect(await host.boardCheck(board)).toEqual({ cannot: [first(theo)], mayLetIn: true });
    await host.openBoard({ documentId: board, letIn: true });
    expect(await seats(board)).toBe(1);
    expect(await opened(t)).toBeNull();
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    await until(async () => (await opened(t))?.role === 'edit', 'Theo to find it back in the main room');
  });
});

describe('what the previous release stored', () => {
  it('still opens: a call and a meeting from before any of this, and a board opens in them', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
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

    expect((await read(host)).board).toEqual({ open: null });
    expect((await read(k)).board).toEqual({ open: null });
    expect(await code(k.closeBoard())).toBe('conflict');
    await k.openBoard({ template: 'retro' });
    const open1 = await opened(host);
    expect(open1).toMatchObject({ openedBy: k.ticket.identity, role: 'edit', seal: 'Sealed' });
    // And it's stored in the new shape from then on, in the part of the call it's in: where it is and who opened it, and no template.
    const after = await storedCall(art.ownerId, callId);
    expect(after.state['board']).toMatchObject({ open: { main: { workspaceId: open1?.workspaceId, documentId: open1?.documentId } } });
    expect(JSON.stringify(after.state['board'])).not.toContain('template');
    await host.leave();
  });

  it('ends with the call: what it kept of its boards goes', async () => {
    const art = await account();
    const { host } = await callBy(art);
    await host.openBoard({ template: 'blank' });
    const { callId } = host.ticket;
    expect(JSON.stringify((await storedCall(art.ownerId, callId)).state['board'])).toContain(art.name);
    await host.leave();
    expect((await storedCall(art.ownerId, callId)).state['board']).toEqual({ open: {}, letIn: [] });
  });
});
