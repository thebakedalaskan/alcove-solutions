/**
 * The call helps with a board, through browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres,
 * the object store, LiveKit and the stand-in NEAR AI: ideas from what's said while notes are on, offered to the part of the
 * call they were said in, with who said each and the frame it fits, and gone once added; and Sort into themes, which works
 * with notes off and outside a call, is refused while a call is paused, and sends the notes model the stickies picked and
 * nothing else.
 */
import { AlcoveApiError, type AudioPiece, type CallSession, type CallState, type DocSession, type TranscriptClip } from '@alcove/api';
import { readBoard, roomFrameId } from '@alcove/board';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, stateKey } from '../../crypto';
import { openOwner } from '../../owners';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

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

/** Asks of the notes model, by what they're for. */
const asked = (what: string) => h.near.instructions.flatMap((s, i) => (s.startsWith(what) ? [h.near.prompts[i] ?? ''] : []));
const IDEAS = 'You pick out ideas';
const THEMES = 'You sort the stickies';

/** An organizer and someone invited, in a call with notes as asked, and a retro board open for everyone. */
async function boardCall(notes: 'on' | 'off' = 'on') {
  const art = await account(unique('art'));
  const kofi = await account(unique('kofi'));
  const { code } = await art.api.calls.startNow({ notes, guests: [kofi.email] });
  const host = await art.api.calls.join(code, { mic: true, cam: false });
  await inGroup(host);
  const k = await kofi.api.calls.join(code, { mic: true, cam: false });
  await inGroup(k);
  await settle(host, (s) => s.participants.some((p) => p.id === k.ticket.identity));
  if (notes === 'on') for (const at of [0, 1, 2, 3]) await host.appendAudio(piece(audioBytes('board-helps'), 0, at));
  await host.openBoard({ template: 'retro' });
  const open = host.getSnapshot().board.open;
  const where = { workspaceId: open?.workspaceId ?? '', documentId: open?.documentId ?? '' };
  return { art, kofi, host, k, code, ...where };
}
async function opened(who: { api: { workspaces: { document: (id: string, doc: string, o?: { pass?: string }) => Promise<DocSession> } } }, workspaceId: string, documentId: string, pass?: string): Promise<DocSession> {
  const s = await who.api.workspaces.document(workspaceId, documentId, pass ? { pass } : {});
  await s.ready;
  return s;
}
/** The parts of the call that have ideas kept for them, as the call's sealed state has them. */
async function ideasKept(ownerId: string, callId: string): Promise<string[]> {
  const o = await openOwner(h.deps, ownerId, undefined);
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [ownerId, callId])).rows[0]);
  const state = openJson(stateKey(o.root, ownerId, `call:${callId}`), { v: 1, kind: 'call-state', ownerId, callId }, row.state_ciphertext, z.object({ board: z.object({ ideas: z.record(z.string(), z.unknown()) }).passthrough() }).passthrough());
  return Object.keys(state.board.ideas);
}
/** Someone signed in and invited, joining, in the call's group and in its list. */
async function joins(host: CallSession, code: string, who: Awaited<ReturnType<typeof account>>) {
  const call = await who.api.calls.join(code, { mic: true, cam: false });
  await inGroup(call);
  await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
  return call;
}
/** Looks for ideas from where `call` is, until the call offers some, and stops looking. */
async function ideasOf(call: CallSession, n = 1): Promise<CallState['board']['ideas']> {
  const stop = call.watchIdeas();
  try {
    return (await settle(call, (s) => s.board.ideas.length >= n)).board.ideas;
  } finally {
    stop();
  }
}

describe('ideas from the call', () => {
  it('are offered while notes are on, each with who said it and the frame it fits, to everyone there who can add to the board', async () => {
    const { art, host, k, workspaceId, documentId } = await boardCall();
    const page = await opened(art, workspaceId, documentId);
    const improve = readBoard(page.doc).frames.find((f) => f.title === 'Could improve')?.id;
    expect(improve).toBeTruthy();
    const IDEA = 'We should improve how the changelog goes out, before the post.';
    const STAGING = 'We should check staging the day before every launch.';
    await say(host, k, 'Morning, everyone.', 0);
    await say(host, k, IDEA, 4000);
    await say(host, k, STAGING, 8000);
    const before = asked(IDEAS).length;
    const seen = await ideasOf(k);
    // One look, from the lines said there, with the board's frames by their titles.
    expect(asked(IDEAS).length).toBe(before + 1);
    const prompt = asked(IDEAS).at(-1) ?? '';
    expect(prompt).toContain(IDEA);
    expect(prompt).toContain('Could improve');
    // What the model made up, from a line it wasn't sent, is left out.
    expect(seen.map((i) => i.text)).toEqual([IDEA, STAGING]);
    expect(seen[0]?.said.person.name).toBe((await k.getSnapshot()).participants.find((p) => p.id === k.ticket.identity)?.person.name);
    expect(seen[0]?.said.at).not.toBeNull();
    expect(seen[0]?.frame).toBe(improve);
    // With what was said: the words the model picked from the line, or the line's own when they weren't said there.
    expect(seen.map((i) => i.said.words)).toEqual(['We should improve how the changelog goes out', STAGING]);
    // Everyone there who can add to the board is offered the same.
    expect((await settle(host, (s) => s.board.ideas.length > 0)).board.ideas.map((i) => i.id)).toEqual(seen.map((i) => i.id));
    page.close();
  });

  it('are looked for once however many look, and not again straight away', async () => {
    const { host, k } = await boardCall();
    await say(host, k, 'We should name a status page owner.', 0);
    const before = asked(IDEAS).length;
    const stops = [host.watchIdeas(), k.watchIdeas()];
    await settle(k, (s) => s.board.ideas.length > 0);
    await sleep(500);
    for (const stop of stops) stop();
    expect(asked(IDEAS).length).toBe(before + 1);
    // Something new said: it waits for the minute to be up.
    await say(host, k, 'We should check staging the day before.', 5000);
    const again = k.watchIdeas();
    await sleep(1500);
    again();
    expect(asked(IDEAS).length).toBe(before + 1);
  });

  it('go for everyone once they’re added or put aside, and with the board when it closes', async () => {
    const { host, k } = await boardCall();
    await say(host, k, 'We should name a status page owner.', 0);
    const [idea] = await ideasOf(k);
    await k.ideasDone([idea?.id ?? '']);
    expect((await settle(host, (s) => s.board.ideas.length === 0)).board.ideas).toEqual([]);
    expect((await settle(k, (s) => s.board.ideas.length === 0)).board.ideas).toEqual([]);
  });

  it('aren’t looked for while notes are off, and aren’t offered while they’re paused', async () => {
    const off = await boardCall('off');
    const before = asked(IDEAS).length;
    const stop = off.k.watchIdeas();
    await sleep(1500);
    stop();
    expect(asked(IDEAS).length).toBe(before);
    expect(off.k.getSnapshot().board.ideas).toEqual([]);

    const on = await boardCall('on');
    await say(on.host, on.k, 'We should name a status page owner.', 0);
    await ideasOf(on.k);
    await on.host.pause();
    // Nothing is offered while nothing may reach the AI, and nothing is looked for.
    expect((await settle(on.k, (s) => s.board.ideas.length === 0)).board.ideas).toEqual([]);
    const paused = asked(IDEAS).length;
    const again = on.k.watchIdeas();
    await sleep(1500);
    again();
    expect(asked(IDEAS).length).toBe(paused);
  });

  it('stay in the part of the call they were said in: a room’s lines never reach the main room’s, and nobody in a room is offered the main room’s', async () => {
    const art = await account(unique('art'));
    const [kofiEmail, lenaEmail] = [unique('kofi'), unique('lena')];
    const { code } = await art.api.calls.startNow({ notes: 'on', guests: [kofiEmail, lenaEmail] });
    const host = await art.api.calls.join(code, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(code, { mic: true, cam: false });
    await inGroup(kofi);
    const lena = await (await account(lenaEmail)).api.calls.join(code, { mic: true, cam: false });
    await inGroup(lena);
    await host.appendAudio(piece(audioBytes('rooms'), 0, 0));
    await host.openBoard({ template: 'retro' });
    // Rooms open two at least: Design has Kofi, and Support nobody yet. Lena stays in the main room with the board.
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 10, board: { mode: 'none', template: 'retro' } });
    const design = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms[0]?.id ?? '';
    await inPlace(kofi, design);
    await settle(kofi, (x) => x.capture.room?.id === design && x.capture.room.scribe === kofi.ticket.identity);
    const ROOM = 'CANARY-ROOM we should repaint the buttons.';
    const MAIN = 'We should name a status page owner.';
    await kofi.transcribe(speech(ROOM, 2000), kofi.ticket.identity);
    await say(host, lena, MAIN, 3000);
    const before = asked(IDEAS).length;
    const inMain = await ideasOf(lena);
    expect(inMain.map((i) => i.text)).toEqual([MAIN]);
    for (const prompt of asked(IDEAS).slice(before)) expect(prompt).not.toContain('CANARY-ROOM');
    // Kofi, in the room, has no board there, and isn't offered the main room's.
    const stop = kofi.watchIdeas();
    await sleep(1000);
    stop();
    expect((await settle(kofi, () => true)).board.ideas).toEqual([]);
  });

  it('aren’t looked for or offered in a room on the one board every room shares: not everyone on it may read the room', async () => {
    const art = await account(unique('art'));
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { code } = await art.api.calls.startNow({ notes: 'on', guests: [kofi.email, lena.email] });
    const host = await art.api.calls.join(code, { mic: true, cam: false });
    await inGroup(host);
    const k = await joins(host, code, kofi);
    const l = await joins(host, code, lena);
    await host.appendAudio(piece(audioBytes('shared'), 0, 0));
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [] }], minutes: 10, board: { mode: 'shared', template: 'retro' } });
    const design = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms[0]?.id ?? '';
    await inPlace(k, design);
    expect((await settle(k, (s) => s.board.open?.frame === roomFrameId(design))).board.open).toMatchObject({ role: 'edit', frame: roomFrameId(design) });
    await settle(k, (x) => x.capture.room?.id === design && x.capture.room.scribe === k.ticket.identity);
    await k.transcribe(speech('CANARY-SHARED-ROOM we should repaint the buttons.', 2000), k.ticket.identity);
    await say(host, l, 'We should name a status page owner.', 3000);
    // Kofi, in the room on the board everyone shares, doesn't look, and nothing he said goes to the notes model for it.
    const before = asked(IDEAS).length;
    const stop = k.watchIdeas();
    await sleep(1500);
    stop();
    expect(asked(IDEAS).length).toBe(before);
    // The main room's look is the main room's, and Kofi isn't offered what it found.
    expect((await ideasOf(l)).map((i) => i.text)).toEqual(['We should name a status page owner.']);
    for (const prompt of asked(IDEAS).slice(before)) expect(prompt).not.toContain('CANARY-SHARED-ROOM');
    expect((await settle(k, () => true)).board.ideas).toEqual([]);
  });

  it('from a room go when the room closes, as they go when its board closes', async () => {
    const art = await account(unique('art'));
    const kofi = await account(unique('kofi'));
    const { code } = await art.api.calls.startNow({ notes: 'on', guests: [kofi.email] });
    const host = await art.api.calls.join(code, { mic: true, cam: false });
    await inGroup(host);
    const k = await joins(host, code, kofi);
    await host.appendAudio(piece(audioBytes('rooms'), 0, 0));
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [] }], minutes: 10, board: { mode: 'each', template: 'retro' } });
    const design = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms[0]?.id ?? '';
    await inPlace(k, design);
    await settle(k, (x) => x.capture.room?.id === design && x.capture.room.scribe === k.ticket.identity && x.board.open?.role === 'edit');
    await k.transcribe(speech('We should check staging the day before every launch.', 2000), k.ticket.identity);
    expect((await ideasOf(k)).length).toBeGreaterThan(0);
    expect(await ideasKept(art.ownerId, host.ticket.callId)).toContain(design);
    // Rooms close: the room's board closes with it, and what was said there, as ideas for it, goes too.
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    await until(async () => !(await ideasKept(art.ownerId, host.ticket.callId)).includes(design), 'the room’s ideas to go');
  });

  it('are never offered to someone let in later from what was said before they came', async () => {
    const { host, code } = await boardCall();
    await say(host, host, 'We should name a status page owner.', 0);
    expect((await ideasOf(host)).length).toBeGreaterThan(0);
    // Jamie comes with the link afterwards: the board the call made is theirs to add to, and the idea is from before them.
    const jamie = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Jamie Guest' });
    await settle(host, (s) => s.waiting.some((w) => w.id === jamie.ticket.identity));
    await host.admit(jamie.ticket.identity);
    await inGroup(jamie);
    const seen = await settle(jamie, (s) => s.board.open?.role === 'edit');
    expect({ role: seen.board.open?.role, ideas: seen.board.ideas }).toEqual({ role: 'edit', ideas: [] });
    expect((await settle(host, () => true)).board.ideas.length).toBeGreaterThan(0);
  });

  it('aren’t looked for, or offered, for someone who can only read the board', async () => {
    const art = await account(unique('art'));
    const lena = await account(unique('lena'));
    const { id } = await art.api.workspaces.create('Product');
    await art.api.workspaces.addPerson(id, lena.email, 'read');
    const board = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Roadmap' })).id;
    const { code } = await art.api.meetings.create({ title: 'Roadmap review', startsAt: new Date(Date.now() + 60_000).toISOString(), durationMinutes: 30, guests: [lena.email], notes: 'on', workspaceId: id });
    const host = await art.api.calls.join(code, { mic: true, cam: false });
    await inGroup(host);
    for (const at of [0, 1, 2, 3]) await host.appendAudio(piece(audioBytes('read-only'), 0, at));
    const l = await joins(host, code, lena);
    await host.openBoard({ workspaceId: id, documentId: board, letIn: false });
    expect((await settle(l, (s) => s.board.open !== null)).board.open?.role).toBe('read');
    await say(host, host, 'We should name a status page owner.', 0);
    const before = asked(IDEAS).length;
    const stop = l.watchIdeas();
    await sleep(1500);
    stop();
    expect(asked(IDEAS).length).toBe(before);
    expect((await ideasOf(host)).length).toBeGreaterThan(0);
    expect((await settle(l, () => true)).board.ideas).toEqual([]);
  });
});

describe('Sort into themes', () => {
  const stickies = [{ id: 'a1', text: 'Staging data was two days stale' }, { id: 'a2', text: 'Changelog went out after the post' }, { id: 'a3', text: 'Staging should refresh nightly' }];

  it('names themes for the stickies picked, from them alone, with notes off and outside a call', async () => {
    const { art, host, workspaceId, documentId } = await boardCall('off');
    const before = asked(THEMES).length;
    const { themes } = await art.api.workspaces.sortStickies(workspaceId, documentId, { stickies }, { pass: host.ticket.pass });
    // A sticky in two themes, or one the model made up, is dropped; a theme left with nothing goes.
    expect(themes).toEqual([{ name: 'Staging', ids: ['a1', 'a3'] }, { name: 'Changelog', ids: ['a2'] }]);
    const sent = asked(THEMES).slice(before);
    expect(sent).toHaveLength(1);
    // The notes model is sent the stickies picked, and nothing else of the board or the call.
    expect(sent[0]).toContain('S1 Staging data was two days stale');
    expect(sent[0]).toContain('S3 Staging should refresh nightly');
    expect(sent[0]?.match(/^S\d+ /gm)).toHaveLength(3);
    expect(sent[0]).not.toContain('Went well');
    // Outside a call, on the board's own page, it works the same.
    expect((await art.api.workspaces.sortStickies(workspaceId, documentId, { stickies: stickies.slice(0, 2) })).themes.map((t) => t.ids)).toEqual([['a1'], ['a2']]);
  });

  it('is refused while the call is paused, as everything that reaches the AI is', async () => {
    const { art, host, workspaceId, documentId } = await boardCall('on');
    await host.pause();
    const before = asked(THEMES).length;
    expect(await refusal(art.api.workspaces.sortStickies(workspaceId, documentId, { stickies }, { pass: host.ticket.pass }))).toMatchObject({ code: 'conflict', message: expect.stringContaining('paused') });
    expect(asked(THEMES).length).toBe(before);
    await host.resume();
    expect((await art.api.workspaces.sortStickies(workspaceId, documentId, { stickies }, { pass: host.ticket.pass })).themes.length).toBe(2);
  });

  it('is for someone who can edit a board, and only a board', async () => {
    const { art, workspaceId, documentId } = await boardCall('off');
    const reader = await account();
    await art.api.workspaces.addPerson(workspaceId, reader.email, 'read');
    expect(await refusal(reader.api.workspaces.sortStickies(workspaceId, documentId, { stickies }))).toMatchObject({ code: 'forbidden' });
    const stranger = await account();
    expect(await refusal(stranger.api.workspaces.sortStickies(workspaceId, documentId, { stickies }))).toMatchObject({ code: 'not-found' });
    const doc = await art.api.workspaces.items.create(workspaceId, { kind: 'document', name: 'Plan' });
    expect(await refusal(art.api.workspaces.sortStickies(workspaceId, doc.id, { stickies }))).toMatchObject({ code: 'not-found' });
  });

  it('says what’s wrong with what was picked: fewer than two stickies with words, or more than it takes at once', async () => {
    const { art, workspaceId, documentId } = await boardCall('off');
    const before = asked(THEMES).length;
    const sort = (picked: { id: string; text: string }[]) => refusal(art.api.workspaces.sortStickies(workspaceId, documentId, { stickies: picked }));
    const tooFew = { code: 'invalid', message: 'Pick at least two stickies with words to sort.' };
    expect(await sort(stickies.slice(0, 1))).toEqual(tooFew);
    // A blank sticky has nothing to sort by, so it doesn't count.
    expect(await sort([{ id: 'b1', text: 'Staging data was two days stale' }, { id: 'b2', text: '   ' }])).toEqual(tooFew);
    const many = Array.from({ length: 81 }, (_, i) => ({ id: `m${i}`, text: `Idea ${i}` }));
    expect(await sort(many)).toEqual({ code: 'invalid', message: 'Sort up to 80 stickies at a time.' });
    // Nothing refused reached the notes model, and eighty is fine.
    expect(asked(THEMES).length).toBe(before);
    expect((await art.api.workspaces.sortStickies(workspaceId, documentId, { stickies: many.slice(0, 80) })).themes.length).toBeGreaterThan(0);
  });
});
