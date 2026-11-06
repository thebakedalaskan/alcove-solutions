/**
 * What boards in calls keep (their rooms' boards, their landing, ideas, timers and votes) in a call's sealed state, in a
 * workspace's tree and in a note, through saves that don't change them. The release before this one stored these shapes and
 * wrote none of them, so mid-deploy each release keeps every field the other wrote. A board made for a breakout room is never
 * stranded while its call goes on, and once its call is over it's kept for everyone the call invited. Through the real API over
 * HTTP via @alcove/api-http, on real Postgres, the object store and the local LiveKit server; each record is written as boards in
 * calls write it, sealed as the server seals it.
 */
import { AlcoveApiError, type AlcoveApi, type CallSession, type CallState, type TranscriptClip, type WorkspaceRole } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from './crypto';
import { NoteManifest } from './modules/notes';
import { openState, sealState, type WorkspaceState } from './modules/workspaceAccess';
import { findOwner, openOwner } from './owners';
import { speechWav } from './testing/fake-near';
import { startHarness, type Browser, type Harness } from './testing/harness';
import { disposeLiveKit } from './testing/livekit';
import { getItem, saveRevision } from './vault';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
const madeUp = () => randomBytes(16).toString('base64url');
/** An id as a board names what's on it. */
const onBoard = () => randomBytes(9).toString('base64url');
const code = (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error'));
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await rest(30);
  }
}
const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function settle(call: CallSession, pred: (s: CallState) => boolean, ms = 15_000): Promise<CallState> {
  const by = Date.now() + ms;
  while (!pred(call.getSnapshot()) && Date.now() < by) { await call.refresh({ call: true, log: false }); await rest(30); }
  return call.getSnapshot();
}
async function invited(host: CallSession, callCode: string, who: Account) {
  const call = await who.api.calls.join(callCode, { mic: true, cam: false });
  await inGroup(call);
  await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
  return call;
}
const action = (who: Browser, call: CallSession, a: unknown) => who.fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(a)
});
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}

/** A call's sealed state as the server keeps it, and a way to put it back as another release would have saved it. */
async function storedCall(ownerId: string, callId: string) {
  const o = await openOwner(h.deps, ownerId, undefined);
  const key = stateKey(o.root, ownerId, `call:${callId}`);
  const header = { v: 1, kind: 'call-state', ownerId, callId } as const;
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [ownerId, callId])).rows[0]);
  const state = openJson(key, header, row.state_ciphertext, z.record(z.string(), z.unknown()));
  const put = (next: unknown) => h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, sealJson(key, header, toJson(next))]);
  return { state, put };
}
/** The parts of a call's state the next release adds to, as this test reads and writes them: the rest passes through. */
const Kept = z.object({
  board: z.object({ open: z.record(z.string(), z.object({ by: z.unknown() }).passthrough()) }).passthrough(),
  breakouts: z.object({ open: z.record(z.string(), z.unknown()).nullable() }).passthrough(),
  workspace: z.object({ worked: z.array(z.record(z.string(), z.unknown())) }).passthrough()
}).passthrough();

/** A workspace's sealed tree, changed as another release would have saved it. */
async function rewrite(workspaceId: string, change: (s: WorkspaceState) => WorkspaceState) {
  const row = z.object({ owner_id: z.string(), state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT owner_id, state_ciphertext FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]);
  const owner = await findOwner(h.deps, row.owner_id, undefined);
  if (!owner) throw new Error('no such workspace');
  await h.pool.query('UPDATE workspaces SET state_ciphertext = $2 WHERE owner_id = $1', [row.owner_id, sealState(owner, workspaceId, change(openState(owner, workspaceId, row.state_ciphertext)))]);
}
async function tree(workspaceId: string): Promise<WorkspaceState> {
  const row = z.object({ owner_id: z.string(), state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT owner_id, state_ciphertext FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]);
  const owner = await findOwner(h.deps, row.owner_id, undefined);
  if (!owner) throw new Error('no such workspace');
  return openState(owner, workspaceId, row.state_ciphertext);
}
/** Whether `who` can open a document: its session opens, or it's refused. */
const opens = (who: Browser, workspaceId: string, documentId: string) => code(who.api.workspaces.document(workspaceId, documentId).then(async (d) => {
  try { await d.ready; } finally { d.close(); }
}));
const entries = async (documentId: string) => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM document_access WHERE document_id = $1', [documentId])).rows[0]?.n ?? -1;

describe('what the next release stores', () => {
  it('keeps a call’s rooms’ boards, their landing, ideas, a board’s timer and vote, what rooms work on and boards noted as open, through a save of its own', async () => {
    const art = await account();
    const kofi = await account();
    const { code: c } = await art.api.calls.startNow({ guests: [kofi.email], notes: 'off' });
    const host = await art.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await invited(host, c, kofi);
    await host.openBoard({ template: 'retro' });
    const open = (await settle(host, (s) => s.board.open?.role === 'edit')).board.open;
    const [workspaceId, documentId] = [open?.workspaceId ?? '', open?.documentId ?? ''];
    expect((await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [] }], minutes: 10, board: { mode: 'none', template: 'blank' } })).status).toBe(200);
    const room = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms[0]?.id ?? '';

    // The next release stores all of this in the call as it goes on.
    const was = await storedCall(art.ownerId, host.ticket.callId);
    const s = Kept.parse(was.state);
    const main = s.board.open['main'];
    if (!main || !s.breakouts.open) throw new Error('no board, or no rooms');
    const timer = { until: 900, length: 300, by: main.by };
    const vote = { id: madeUp(), frame: onBoard(), per: 3, by: main.by, ballots: { [madeUp()]: [onBoard(), onBoard()] }, ended: false };
    const rooms = [{ workspaceId, documentId: madeUp(), room, kept: false }];
    // A landing someone is doing as the save happens, so nothing takes it on meanwhile.
    const landing = { rooms: [{ room, workspaceId, documentId: rooms[0]?.documentId ?? '', name: 'One', who: ['Kofi'] }], into: { workspaceId, documentId }, make: false, until: Date.now() + 3_600_000 };
    const ideas = {
      main: { at: 1_000, heard: madeUp(), running: null, list: [{ id: madeUp(), text: 'Name a status page owner', words: 'We should name a status page owner.', speaker: host.ticket.identity, when: 1_000, frame: onBoard(), seen: [{ when: 1_000, readers: [madeUp()] }, {}] }] }
    };
    const working = { mode: 'each', template: 'what-why-next' };
    const noted = { workspaceId, documentId, kind: 'board', by: [], open: 'main' };
    await was.put({
      ...s,
      board: { ...s.board, open: { ...s.board.open, main: { ...main, timer, vote } }, rooms, landing, ideas },
      breakouts: { ...s.breakouts, open: { ...s.breakouts.open, board: working } },
      workspace: { ...s.workspace, worked: [...s.workspace.worked, noted] }
    });

    // Something done in the call that this release serves: it reads the call and saves it.
    expect((await action(art, host, { type: 'hand', up: true })).status).toBe(200);
    expect((await settle(host, (x) => x.participants.some((p) => p.isMe && p.hand))).breakouts.open?.rooms.length).toBe(2);
    const after = Kept.parse((await storedCall(art.ownerId, host.ticket.callId)).state);
    // Whether a room's board is kept yet is this release's to decide as it saves, so only what the next release wrote is compared.
    expect(after.board).toMatchObject({ open: { main: { timer, vote } }, rooms: rooms.map(({ kept: _kept, ...r }) => r), landing, ideas });
    expect(after.breakouts.open).toMatchObject({ board: working });
    expect(after.workspace.worked).toContainEqual(noted);
    await host.leave();
  });

  it('opens a call stored before any of it, and keeps it in the new shape from then on', async () => {
    const art = await account();
    const kofi = await account();
    const { code: c } = await art.api.calls.startNow({ guests: [kofi.email], notes: 'off' });
    const host = await art.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await invited(host, c, kofi);
    await host.openBoard({ template: 'retro' });
    const open = (await settle(host, (s) => s.board.open?.role === 'edit')).board.open;
    expect((await action(art, host, { type: 'rooms-open', rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [] }], minutes: 10, board: { mode: 'none', template: 'blank' } })).status).toBe(200);
    await settle(host, (s) => s.breakouts.open !== null);

    // Stored as the release before this one stored it: none of the next release's fields anywhere.
    const was = await storedCall(art.ownerId, host.ticket.callId);
    const s = Kept.parse(was.state);
    if (!s.breakouts.open) throw new Error('no rooms');
    const strip = (x: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k)));
    await was.put({
      ...s,
      board: { ...strip(s.board, 'rooms', 'landing', 'ideas'), open: Object.fromEntries(Object.entries(s.board.open).map(([k, v]) => [k, strip(v, 'timer', 'vote')])) },
      breakouts: { ...s.breakouts, open: strip(s.breakouts.open, 'board') },
      workspace: { ...s.workspace, worked: [...s.workspace.worked.map((w) => strip(w, 'open')), { workspaceId: open?.workspaceId, documentId: open?.documentId, kind: 'board', by: [] }] }
    });

    expect((await action(art, host, { type: 'hand', up: true })).status).toBe(200);
    expect((await settle(host, (x) => x.participants.some((p) => p.isMe && p.hand))).board.open?.documentId).toBe(open?.documentId);
    const after = Kept.parse((await storedCall(art.ownerId, host.ticket.callId)).state);
    expect(after.board).toMatchObject({ open: { main: { timer: null, vote: null } }, rooms: [], landing: null, ideas: {} });
    expect(after.breakouts.open).toMatchObject({ board: { mode: 'none', template: 'blank' } });
    // A board open in the call is noted in the part it's open in as the call is saved.
    expect(after.workspace.worked).toContainEqual({ workspaceId: open?.workspaceId, documentId: open?.documentId, kind: 'board', by: [], open: 'main' });
    await host.leave();
  });

  it('keeps a breakout room’s board in a workspace’s tree, and never strands it: not to the admins, and not to Trash', async () => {
    const art = await account();
    const kofi = await account();
    const maya = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit'], [maya, 'edit']]);
    const roomBoard = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'One board' })).id;
    const lost = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Maya’s plan' })).id;
    const plan = (await art.api.workspaces.items.create(id, { kind: 'document', name: 'Launch plan' })).id;
    const { code: c } = await art.api.calls.startNow({ guests: [kofi.email], notes: 'off' });
    const host = await art.api.calls.join(c, { mic: false, cam: false });
    await inGroup(host);
    // As the next release makes a room's board: restricted, nobody's, for the call. Beside it, something restricted only
    // Maya could open, which is stranded once she's gone, as anything like it is.
    const room = { ownerId: art.ownerId, callId: host.ticket.callId };
    await rewrite(id, (s) => {
      const one = s.items[roomBoard];
      const hers = s.items[lost];
      if (!one || !hers) throw new Error('no such item');
      return { ...s, items: { ...s.items, [roomBoard]: { ...one, restricted: true, by: null, room }, [lost]: { ...hers, restricted: true, by: { name: maya.name, email: maya.email } } } };
    });

    // Something in Product changes through this release, which saves its tree: the board stays the room's.
    await art.api.workspaces.items.rename(id, plan, 'Launch plan, final');
    expect((await tree(id)).items[roomBoard]?.room).toEqual(room);
    // An admin takes Maya out: what only she could open goes to the admins, and the room's board goes to nobody.
    const mayaThere = (await art.api.workspaces.people(id)).find((p) => p.person.email === maya.email)?.id ?? '';
    await art.api.workspaces.removePerson(id, mayaThere);
    expect(await opens(art, id, lost)).toBe('allowed');
    expect({ art: await opens(art, id, roomBoard), entries: await entries(roomBoard) }).toEqual({ art: 'not-found', entries: 0 });
    // Something shared and taken back sends whatever nobody can open to Trash: not the room's board.
    await art.api.workspaces.share.set(id, plan, [{ email: kofi.email }], 'read');
    const shared = (await art.api.workspaces.share.list(id, plan)).entries.find((e) => e.person.email === kofi.email)?.id ?? '';
    await art.api.workspaces.share.remove(id, plan, shared);
    const after = (await tree(id)).items[roomBoard];
    expect({ trashed: after?.trashedAt ?? null, room: after?.room }).toEqual({ trashed: null, room });
    await host.leave();
    // Once its call is over it's kept for everyone the call invited, the first time anything in Product asks what nobody can
    // open: by address, a restricted board like any other, neither in Trash nor the admins' alone.
    await art.api.workspaces.share.set(id, plan, [{ email: kofi.email }], 'read');
    await art.api.workspaces.share.remove(id, plan, (await art.api.workspaces.share.list(id, plan)).entries.find((e) => e.person.email === kofi.email)?.id ?? '');
    const kept = (await tree(id)).items[roomBoard];
    expect({ trashed: kept?.trashedAt ?? null, room: kept?.room ?? null }).toEqual({ trashed: null, room: null });
    expect({ kofi: await opens(kofi, id, roomBoard), art: await opens(art, id, roomBoard), entries: await entries(roomBoard) }).toEqual({ kofi: 'allowed', art: 'allowed', entries: 2 });
    expect(await opens(maya, id, roomBoard)).toBe('not-found');
  });

  it('keeps where a follow-up was written down, through a save of its own', async () => {
    const art = await account();
    const { code: c } = await art.api.calls.startNow({ notes: 'on' });
    const call = await art.api.calls.join(c, { mic: true, cam: false });
    await inGroup(call);
    const speech: TranscriptClip = { data: new Blob([speechWav('Kofi will send the deck by Friday.')], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 };
    await call.transcribe(speech, call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await written(art.api, noteId);
    const first = (await art.api.notes.get(noteId)).actions[0];
    expect(first).toMatchObject({ text: 'Send the deck by Friday', from: null });

    // The next release keeps a follow-up from a board's Actions frame as that.
    const o = await openOwner(h.deps, art.ownerId, undefined);
    const stored = await getItem(o, o.pool, 'note', noteId, NoteManifest, 'That note');
    await saveRevision(o, o.pool, stored.itemId, stored.revisionId, { ...stored.manifest, actions: stored.manifest.actions.map((a) => (a.id === first?.id ? { ...a, from: 'board' } : a)) });
    expect((await art.api.notes.get(noteId)).actions[0]?.from).toBe('board');

    // The organizer rewords it, through this release, which saves the note: it's still from the board.
    expect((await art.api.notes.updateAction(noteId, first?.id ?? '', { text: 'Send the deck, with the numbers' })).actions[0]).toMatchObject({ text: 'Send the deck, with the numbers', from: 'board' });
    expect((await getItem(o, o.pool, 'note', noteId, NoteManifest, 'That note')).manifest.actions[0]?.from).toBe('board');
  });
});

async function written(api: AlcoveApi, noteId: string): Promise<void> {
  for await (const p of api.notes.progress(noteId)) if (p.ready) return;
}
