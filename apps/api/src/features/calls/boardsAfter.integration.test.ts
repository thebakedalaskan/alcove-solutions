/**
 * After a call with a board, through browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres, the
 * object store, LiveKit and the stand-in NEAR AI: the note carries the boards open in the call, each with the part of the call
 * it was open in; the notes read a board everyone the note went to can open, and only in the notes of its part, and make its
 * Actions frame's stickies follow-ups; a board someone couldn't open stays out of the one summary everyone gets. And bringing
 * a board to a call: Start a call here, a call scheduled with one, and the next call in a series.
 */
import { AlcoveApiError, type AudioPiece, type CallSession, type CallState, type DocSession, type Note, type TranscriptClip } from '@alcove/api';
import { addObject, readBoard } from '@alcove/board';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from '../../crypto';
import { NoteManifest } from '../notes/service';
import { openOwner } from '../../owners';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';
import { getItem, saveRevision } from '../../vault';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
type Account = Awaited<ReturnType<typeof account>>;
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AlcoveApiError ? { code: e.code, message: e.message } : { code: 'not-an-api-error', message: String(e) }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await sleep(30);
  }
}
/** Reads the call again until `pred` holds, or the wait is up. */
async function settle(call: CallSession, pred: (s: CallState) => boolean, ms = 20_000): Promise<CallState> {
  const by = Date.now() + ms;
  while (!pred(call.getSnapshot()) && Date.now() < by) { await call.refresh({ call: true, log: false }); await sleep(30); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
const inPlace = (call: CallSession, place: string) => until(() => { const s = call.crypto.getSnapshot(); return s.status === 'in' && s.place === place && Boolean(s.media?.send); }, 'someone in their part of the call');
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, s: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: ms });
/** The host's browser hears `who` say `words`. */
const say = (host: CallSession, who: CallSession, words: string, atMs = 0) => host.transcribe(speech(words, atMs), who.ticket.identity);

/** What the notes model was asked to write notes from, oldest first. */
const NOTES = 'You write the notes';
const notesAsked = () => h.near.instructions.flatMap((s, i) => (s.startsWith(NOTES) ? [h.near.prompts[i] ?? ''] : []));
/** The notes requests since `from` that hold `marker`: each test's words are its own, so this finds its own requests. */
const askedWith = (from: number, marker: string) => notesAsked().slice(from).filter((p) => p.includes(marker));

/** Someone signed in and invited, in the call. */
async function joined(host: CallSession, code: string, who: Account) {
  const call = await who.api.calls.join(code, { mic: true, cam: false });
  await inGroup(call);
  await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
  return call;
}
/** A call `art` hosts with notes on and `guests` invited, recording. */
async function notedCall(art: Account, guests: string[], o: { documents?: string[] } = {}) {
  const { code } = await art.api.calls.startNow({ notes: 'on', guests, ...(o.documents ? { documents: o.documents } : {}) });
  const host = await art.api.calls.join(code, { mic: true, cam: false });
  await inGroup(host);
  for (const at of [0, 1, 2, 3]) await host.appendAudio(piece(audioBytes('board-after'), 0, at));
  return { code, host };
}
async function opened(who: Account, workspaceId: string, documentId: string, pass?: string): Promise<DocSession> {
  const s = await who.api.workspaces.document(workspaceId, documentId, pass ? { pass } : {});
  await s.ready;
  return s;
}
/**
 * Writes on a board as a browser does: each sticky in the frame with that title, one under another, and frames first when it
 * has none (a blank board). Waits until all of it has reached Alcove.
 */
async function write(who: Account, workspaceId: string, documentId: string, stickies: Record<string, string[]>, pass?: string) {
  const s = await opened(who, workspaceId, documentId, pass);
  let x = 0;
  for (const [title, words] of Object.entries(stickies)) {
    if (!readBoard(s.doc).frames.some((f) => f.title === title)) {
      addObject(s.doc, { k: 'frame', x, y: 2000, w: 360, h: 530, c: 'sky', role: title === 'Actions' ? 'actions' : '', hint: '', sub: '', sorted: false, title }, null);
      x += 400;
    }
    const frame = readBoard(s.doc).frames.find((f) => f.title === title);
    if (!frame) throw new Error(`no frame called ${title}`);
    words.forEach((t, i) => addObject(s.doc, { k: 'note', x: frame.x + 20, y: frame.y + 60 + i * 160, w: 150, h: 150, c: 'sky', size: 'm', t }, null));
  }
  await until(() => s.getSnapshot().status === 'saved', 'the board to reach Alcove');
  s.close();
}
/** The note once its notes are written, as `who` reads it. */
async function noteOf(who: Account, noteId: string | null | undefined): Promise<Note> {
  const by = Date.now() + 60_000;
  for (;;) {
    const n = await who.api.notes.get(noteId ?? '');
    if (n.status === 'ready') return n;
    if (Date.now() > by) throw new Error('timed out waiting for the notes');
    await sleep(40);
  }
}
/** The call's sealed state, changed under its row lock as the server changes it: what a later change leaves in it. */
async function inCallState(ownerId: string, callId: string, change: (s: Record<string, unknown>) => Record<string, unknown>) {
  const o = await openOwner(h.deps, ownerId, undefined);
  const key = stateKey(o.root, ownerId, `call:${callId}`);
  const header = { v: 1, kind: 'call-state', ownerId, callId } as const;
  const c = await h.pool.connect();
  try {
    await c.query('BEGIN');
    const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await c.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2 FOR UPDATE', [ownerId, callId])).rows[0]);
    const state = openJson(key, header, row.state_ciphertext, z.record(z.string(), z.unknown()));
    await c.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, sealJson(key, header, toJson(change(state)))]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
/** What `who` can bring to a call, by the item's own ID. */
async function libraryId(who: Account, item: string): Promise<string> {
  const found = (await who.api.documents.list()).workspaces.flatMap((w) => w.documents).find((d) => d.item === item);
  if (!found) throw new Error('not in the library');
  return found.id;
}

describe('the note after a call with a board', () => {
  it('has the board, the notes read it, and its Actions frame’s stickies are follow-ups from the board', async () => {
    const art = await account(unique('art'));
    const kofi = await account(unique('kofi'));
    const { code, host } = await notedCall(art, [kofi.email]);
    const k = await joined(host, code, kofi);
    await host.openBoard({ template: 'retro' });
    const open = (await settle(host, (s) => s.board.open?.role === 'edit')).board.open;
    const [workspaceId, board] = [open?.workspaceId ?? '', open?.documentId ?? ''];
    await write(art, workspaceId, board, {
      'Went well': ['CANARY-WENTWELL beta sign-ups beat the plan'],
      Actions: ['Kofi: Write the launch runbook', 'Refresh staging every night', 'Tag the release, forgotten by the model']
    }, host.ticket.pass);
    await say(host, k, 'Kofi will send the deck by Friday.', 1000);
    const from = notesAsked().length;
    const noteId = (await host.leave())?.pendingNoteId;
    const note = await noteOf(art, noteId);

    // The notes model read the board, fenced, with its Actions frame's stickies labelled, in one request.
    const sent = askedWith(from, 'CANARY-WENTWELL');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('<board>');
    expect(sent[0]).toMatch(/^B1 Kofi: Write the launch runbook$/m);
    expect(sent[0]).toMatch(/^B3 Tag the release, forgotten by the model$/m);
    expect(note.summary).toContain('Read 1 board.');
    // What was said is a follow-up as ever; each sticky is one from the board, owners and all, and one the model left out is
    // still there, as the board has it, for nobody yet.
    const spoken = note.actions.filter((a) => a.from === null);
    expect(spoken.map((a) => [a.text, a.owner?.name])).toEqual([['Send the deck by Friday', 'Kofi']]);
    const fromBoard = note.actions.filter((a) => a.from === 'board');
    expect(fromBoard.map((a) => a.text)).toEqual(['Write the launch runbook', 'Refresh staging every night', 'Tag the release, forgotten by the model']);
    expect(fromBoard.map((a) => a.owner?.name ?? null)).toEqual(['Kofi', null, null]);
    expect(fromBoard.every((a) => !a.takenOn && !a.done)).toBe(true);
    // What backs them is the board, under their own heading: nothing said need, so the note doesn't say nothing does.
    expect(fromBoard.map((a) => a.evidence.flags)).toEqual([[], [], []]);
    expect(spoken[0]?.evidence.flags).toEqual([]);
    // The board is on the note, in the main room's part, and everyone the note went to can open it, Kofi included.
    const onNote = { workspaceId, id: board, kind: 'board', name: expect.any(String), room: null, everyone: true, by: expect.any(Array) };
    expect(note.workedOn).toEqual([expect.objectContaining(onNote)]);
    expect((await kofi.api.notes.get(noteId ?? '')).workedOn).toEqual([expect.objectContaining(onNote)]);
    // Kofi takes his on, as any follow-up: the board's are follow-ups like the rest.
    const runbook = fromBoard[0]?.id ?? '';
    await kofi.api.notes.updateAction(note.id, runbook, { owner: kofi.email, seen: { text: 'Write the launch runbook', due: null } });
    expect((await art.api.notes.get(note.id)).actions.find((a) => a.id === runbook)).toMatchObject({ takenOn: true, from: 'board' });
  });

  it('leaves a board opened without someone out of the summary everyone gets, and says so', async () => {
    const art = await account(unique('art'));
    const kofi = await account(unique('kofi'));
    // Art's own board, which Kofi can't open.
    const { id: space } = await art.api.workspaces.create('Planning');
    const board = (await art.api.workspaces.items.create(space, { kind: 'board', name: 'Pricing' })).id;
    await write(art, space, board, { 'Ideas': ['CANARY-UNSHARED raise the price'], Actions: ['CANARY-UNSHARED-ACTION email the board'] });
    for (const letIn of [false, true]) {
      const { code, host } = await notedCall(art, [kofi.email]);
      const k = await joined(host, code, kofi);
      // Opened for the call without letting Kofi in, and then let in for this call alone: either way, after the call he can't.
      await host.openBoard({ workspaceId: space, documentId: board, letIn });
      expect((await settle(k, (s) => (letIn ? s.board.open?.role === 'edit' : s.board.open !== null))).board.open?.role ?? null).toBe(letIn ? 'edit' : null);
      await say(host, k, 'Kofi will check the numbers by Monday.', 1000);
      const from = notesAsked().length;
      const noteId = (await host.leave())?.pendingNoteId;
      const note = await noteOf(art, noteId);
      const sent = notesAsked().slice(from).filter((p) => p.includes('check the numbers'));
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toContain('CANARY-UNSHARED');
      expect(sent[0]).not.toContain('<board>');
      expect(note.summary).not.toContain('board');
      expect(note.actions.map((a) => [a.text, a.from])).toEqual([['Check the numbers by Monday', null]]);
      // Art can open it, so his note has it, saying not everyone can. Kofi's says nothing of it.
      expect(note.workedOn).toEqual([expect.objectContaining({ id: board, kind: 'board', name: 'Pricing', workspace: 'Planning', everyone: false })]);
      expect((await kofi.api.notes.get(noteId ?? '')).workedOn).toEqual([]);
    }
  });

  it('leaves the board out of notes written again once the note has gone to someone who can’t open it, and says so', async () => {
    const art = await account(unique('art'));
    const kofi = await account(unique('kofi'));
    const zed = await account(unique('zed'));
    const { code, host } = await notedCall(art, [kofi.email]);
    const k = await joined(host, code, kofi);
    await host.openBoard({ template: 'retro' });
    const open = (await settle(host, (s) => s.board.open?.role === 'edit')).board.open;
    const [workspaceId, board] = [open?.workspaceId ?? '', open?.documentId ?? ''];
    await write(art, workspaceId, board, { 'Went well': ['CANARY-BEFORE beta sign-ups beat the plan'] }, host.ticket.pass);
    await say(host, k, 'Kofi will send the deck by Friday.', 1000);
    const from = notesAsked().length;
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    const first = await noteOf(art, noteId);
    expect(askedWith(from, 'send the deck')[0]).toContain('CANARY-BEFORE');
    expect(first.workedOn.find((x) => x.id === board)?.everyone).toBe(true);
    // The organizer shares the note with Zed, who can't open the board: the note says it isn't everyone's any more.
    await art.api.notes.share(noteId, { emails: [zed.email] });
    expect(await refusal(zed.api.workspaces.document(workspaceId, board).then(async (d) => { try { await d.ready; } finally { d.close(); } }))).toMatchObject({ code: 'not-found' });
    expect((await art.api.notes.get(noteId)).workedOn.find((x) => x.id === board)?.everyone).toBe(false);
    // The board gets more on it, and the organizer has the notes written again: one summary goes to Zed too, so it's left out.
    await write(art, workspaceId, board, { 'Went well': ['CANARY-AFTER the changelog went out late'] });
    const again = notesAsked().length;
    await art.api.notes.rewrite(noteId);
    const by = Date.now() + 60_000;
    for (;;) {
      const n = await art.api.notes.get(noteId);
      if (n.status === 'ready' && n.writtenAt !== first.writtenAt && !n.writingAgain) break;
      if (Date.now() > by) throw new Error('timed out waiting for the notes to be written again');
      await sleep(40);
    }
    const sent = askedWith(again, 'send the deck');
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('CANARY-AFTER');
    expect(sent[0]).not.toContain('<board>');
  });

  it('reads each room’s own board for that room’s section alone, and the main room’s for the call’s', async () => {
    const art = await account(unique('art'));
    const [kofiEmail, lenaEmail] = [unique('kofi'), unique('lena')];
    const kofi = await account(kofiEmail);
    const lena = await account(lenaEmail);
    const { code, host } = await notedCall(art, [kofiEmail, lenaEmail]);
    const k = await joined(host, code, kofi);
    const l = await joined(host, code, lena);
    await host.openBoard({ template: 'retro' });
    const open = (await settle(host, (s) => s.board.open?.role === 'edit')).board.open;
    const [workspaceId, main] = [open?.workspaceId ?? '', open?.documentId ?? ''];
    await write(art, workspaceId, main, { 'Went well': ['CANARY-MAINBOARD the launch went well'], Actions: ['CANARY-MAINACTION name a comms owner'] }, host.ticket.pass);
    // Rooms open with a board each. Kofi writes on Design's as he talks; Support's stays as its template left it.
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 10, board: { mode: 'each', template: 'retro' } });
    const rooms = (await settle(host, (s) => (s.breakouts.open?.rooms.length ?? 0) === 2)).breakouts.open?.rooms ?? [];
    const [room, support] = [rooms[0]?.id ?? '', rooms[1]?.id ?? ''];
    await inPlace(k, room);
    const design = (await settle(k, (x) => x.board.open?.name === 'Design board' && x.board.open.role === 'edit')).board.open;
    await write(kofi, design?.workspaceId ?? '', design?.documentId ?? '', { 'What happened': ['CANARY-ROOMBOARD the buttons clash'], Actions: ['CANARY-ROOMACTION repaint the buttons'] }, k.ticket.pass);
    await settle(k, (x) => x.capture.room?.id === room && x.capture.room.scribe === k.ticket.identity);
    await k.transcribe(speech('Kofi will mock up the new buttons.', 2000), k.ticket.identity);
    await say(host, l, 'Lena will brief support on Monday.', 3000);
    const from = notesAsked().length;
    const noteId = (await host.leave())?.pendingNoteId;
    const note = await noteOf(art, noteId);

    // As the call ended, each room's board became everyone invited's, so the notes read it, for its own room's section alone.
    const inRoom = askedWith(from, 'Part: the breakout room “Design”');
    const inMain = askedWith(from, 'Lena will brief support');
    expect(inRoom).toHaveLength(1);
    expect(inMain).toHaveLength(1);
    expect(inRoom[0]).toContain('CANARY-ROOMBOARD');
    expect(inRoom[0]).not.toContain('CANARY-MAINBOARD');
    expect(inRoom[0]).not.toContain('CANARY-MAINACTION');
    expect(inMain[0]).toContain('CANARY-MAINBOARD');
    // Each part's follow-ups from its own board, and each board in its own part of the note: the main one, and each room's.
    expect(note.actions.filter((a) => a.from === 'board').map((a) => a.text)).toEqual(['CANARY-MAINACTION name a comms owner']);
    const section = note.rooms.find((r) => r.id === room);
    expect(section?.actions.filter((a) => a.from === 'board').map((a) => a.text)).toEqual(['CANARY-ROOMACTION repaint the buttons']);
    expect(section?.actions.filter((a) => a.from === null).map((a) => a.text)).toEqual(['Mock up the new buttons']);
    const boards = note.workedOn.filter((x) => x.kind === 'board');
    expect(boards.map((x) => [x.id, x.room, x.everyone])).toEqual(expect.arrayContaining([[main, null, true], [design?.documentId, room, true], [expect.any(String), support, true]]));
    expect(boards).toHaveLength(3);
    // Lena, who was in neither room, has every room's board on her note too, as everyone invited does.
    expect((await lena.api.notes.get(noteId ?? '')).workedOn.filter((x) => x.room !== null).map((x) => x.room).sort()).toEqual([room, support].sort());
  });

  it('still opens a note, and ends a call, written before boards were noted', async () => {
    const art = await account(unique('art'));
    const kofi = await account(unique('kofi'));
    const { code, host } = await notedCall(art, [kofi.email]);
    const k = await joined(host, code, kofi);
    await host.openBoard({ template: 'retro' });
    const open = (await settle(host, (s) => s.board.open?.role === 'edit')).board.open;
    await write(art, open?.workspaceId ?? '', open?.documentId ?? '', { Actions: ['Ship the fix'] }, host.ticket.pass);
    await say(host, k, 'Kofi will review the fix by Tuesday.', 1000);
    // The call as the release before this one kept it: what was worked on says nothing of where a board was open.
    await inCallState(art.ownerId, host.ticket.callId, (s) => {
      const space = z.object({ worked: z.array(z.record(z.string(), z.unknown())) }).passthrough().parse(s['workspace']);
      return { ...s, workspace: { ...space, worked: space.worked.map(({ open: _open, ...rest }) => rest) } };
    });
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    const note = await noteOf(art, noteId);
    // Nothing said where it was open, but it was still open as the call ended, which notes it then: the notes read it.
    expect(note.actions.map((a) => [a.text, a.from])).toEqual([['Review the fix by Tuesday', null], ['Ship the fix', 'board']]);
    expect(note.workedOn.map((x) => [x.kind, x.room])).toEqual([['board', null]]);
    // And the note as that release wrote it: follow-ups without `from`, and what was worked on without where.
    const o = await openOwner(h.deps, art.ownerId, undefined);
    const stored = await getItem(o, o.pool, 'note', noteId, NoteManifest, 'Those notes');
    const older = { ...stored.manifest, actions: stored.manifest.actions.map(({ from: _from, ...rest }) => rest), workedOn: stored.manifest.workedOn.map(({ open: _open, ...rest }) => rest) };
    await saveRevision(o, o.pool, stored.itemId, stored.revisionId, older);
    const read = await art.api.notes.get(noteId);
    expect(read.actions.map((a) => [a.text, a.from])).toEqual([['Review the fix by Tuesday', null], ['Ship the fix', null]]);
    expect(read.workedOn).toEqual([expect.objectContaining({ kind: 'board', room: null, everyone: true })]);
    expect((await kofi.api.notes.get(noteId)).workedOn).toHaveLength(1);
  });
});

describe('bringing a board to a call', () => {
  it('Start a call here brings it, from your own library alone, and the next call in the series brings it and the call’s own board', async () => {
    const art = await account(unique('art'));
    const lena = await account(unique('lena'));
    const kofi = await account(unique('kofi'));
    const { id: space } = await art.api.workspaces.create('Product');
    const board = (await art.api.workspaces.items.create(space, { kind: 'board', name: 'Launch retro' })).id;
    const brought = await libraryId(art, board);
    // Only what's in your own library, each once: someone else's, made up, or twice, are refused the same way.
    const { id: hers } = await lena.api.workspaces.create('Hers');
    const hersBoard = await libraryId(lena, (await lena.api.workspaces.items.create(hers, { kind: 'board', name: 'Hers' })).id);
    const refused = { code: 'invalid', message: 'Bring documents from your own library, each once.' };
    expect(await refusal(art.api.calls.startNow({ documents: [hersBoard] }))).toEqual(refused);
    expect(await refusal(art.api.calls.startNow({ documents: [`${space}.${'x'.repeat(22)}`] }))).toEqual(refused);
    expect(await refusal(art.api.calls.startNow({ documents: [brought, brought] }))).toEqual(refused);

    const { code, host } = await notedCall(art, [kofi.email], { documents: [brought] });
    // It's brought to the call, and joining doesn't open it: the person who asked opens it as the call starts.
    const state = await settle(host, (s) => s.workspace.documents.length > 0);
    expect(state.workspace.documents).toEqual([{ workspaceId: space, id: board, kind: 'board', name: 'Launch retro', role: 'edit' }]);
    expect(state.board.open).toBeNull();
    await host.openBoard({ workspaceId: space, documentId: board, letIn: false });
    expect((await settle(host, (s) => s.board.open !== null)).board.open).toMatchObject({ workspaceId: space, documentId: board, name: 'Launch retro' });
    // And a new board, opened in the call later.
    const k = await joined(host, code, kofi);
    await host.openBoard({ template: 'retro' });
    const made = (await settle(host, (s) => s.board.open?.documentId !== board)).board.open?.documentId ?? '';
    await say(host, k, 'Kofi will book the next retro.', 1000);
    const meetingId = host.getSnapshot().meetingId;
    await noteOf(art, (await host.leave())?.pendingNoteId);

    // The next call brings what this one brought, and the boards open in it, which its board picker lists first among your team's.
    const next = await art.api.meetings.scheduleNext(meetingId, new Date(Date.now() + 7 * 86_400_000).toISOString());
    expect(next.documents.map((d) => [d.kind, d.name])).toEqual([['board', 'Launch retro'], ['board', expect.any(String)]]);
    const nextHost = await art.api.calls.join(next.code, { mic: false, cam: false });
    await inGroup(nextHost);
    const offered = (await settle(nextHost, (s) => s.workspace.documents.length === 2)).workspace.documents;
    expect(offered.map((d) => d.id).sort()).toEqual([board, made].sort());
    expect(nextHost.getSnapshot().board.open).toBeNull();
  });

  it('scheduled with a call, it’s brought, and doesn’t open by itself', async () => {
    const art = await account(unique('art'));
    const { id: space } = await art.api.workspaces.create('Design');
    const board = (await art.api.workspaces.items.create(space, { kind: 'board', name: 'Onboarding flow' })).id;
    const meeting = await art.api.meetings.create({ title: 'Flow review', startsAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, guests: [], notes: 'off', documents: [await libraryId(art, board)] });
    expect(meeting.documents).toEqual([expect.objectContaining({ kind: 'board', name: 'Onboarding flow' })]);
    const host = await art.api.calls.join(meeting.code, { mic: false, cam: false });
    await inGroup(host);
    const state = await settle(host, (s) => s.workspace.documents.length > 0);
    expect(state.workspace.documents).toEqual([{ workspaceId: space, id: board, kind: 'board', name: 'Onboarding flow', role: 'edit' }]);
    expect(state.board.open).toBeNull();
  });
});
