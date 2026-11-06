/**
 * What two people put on a board at the same moment, through browsers talking to the real API over HTTP via @alcove/api-http,
 * on real Postgres, the object store, LiveKit and the stand-in NEAR AI, with @alcove/board making every change the way the
 * board's surface makes it: ideas from the call added by two people at once, into one frame or the same idea twice, two branches
 * from one idea, and an idea added just as its frame's drag lands. Each browser writes before it has heard the other. Once they
 * have, each does what the surface does as it reads the board again (features/board/landing.ts): moves what it has just put
 * there off anything that landed exactly on it, as if it had been put there in the first place.
 */
import type { AudioPiece, CallSession, CallState, DocSession, TranscriptClip } from '@alcove/api';
import {
  addBranch, addMindMap, addStickies, apart, hasBox, makeHistory, moveObjects, objectText, putOf, readBoard, stillPut, stickyFrom, type BoardHistory, type BoardStep, type Box, type Landing, type Put
} from '@alcove/board';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Browser, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string };
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean, ms = 20_000): Promise<CallState> {
  const by = Date.now() + ms;
  while (!pred(call.getSnapshot()) && Date.now() < by) { await call.refresh({ call: true, log: false }); await sleep(30); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, s: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: ms });
const say = (host: CallSession, who: CallSession, words: string, atMs = 0) => host.transcribe(speech(words, atMs), who.ticket.identity);

/* ---------- a browser at a board ---------- */

/** A tab with a board open: its session, the origin its writes go under, its undo, and what it has just put on the board, as the surface keeps them. */
interface Tab { s: DocSession; doc: Y.Doc; me: object; history: BoardHistory; put: Put[]; moved: number }
async function open(who: Browser, workspaceId: string, documentId: string, pass?: string): Promise<Tab> {
  const s = await who.api.workspaces.document(workspaceId, documentId, pass ? { pass } : {});
  await s.ready;
  const me = {};
  return { s, doc: s.doc, me, history: makeHistory(s.doc, me), put: [], moved: 0 };
}
/** Everything on a board as it reads, in drawing order: what two people must agree on. */
const shown = (t: Tab) => JSON.stringify(readBoard(t.doc).objects);
const agree = async (tabs: Tab[], what: string) => {
  const [one, ...others] = tabs;
  if (one) await until(() => others.every((t) => shown(t) === shown(one)), what);
};
/** Stickies from outside the board, as the tray's Add and Add all write them: a step of their own, each watched once it's there. */
function land(t: Tab, stickies: Landing[]): { ids: string[]; step: BoardStep | null } {
  const { result, step } = t.history.separate(() => addStickies(t.doc, stickies, { x: 0, y: 0 }, 'butter', t.me));
  const ids = result.flatMap((r) => (r.added === 'made' && r.id ? [r.id] : []));
  for (const id of ids) { const p = putOf(readBoard(t.doc), id); if (p) t.put.push(p); }
  return { ids, step };
}
/** What the surface does as it reads the board again: moves what it has just put there off anything that has landed exactly on it. */
function keepApart(t: Tab): void {
  const view = readBoard(t.doc);
  for (const m of apart(view, t.put.filter((p) => stillPut(view, p)))) {
    t.history.amend(m.id, () => moveObjects(t.doc, [m], t.me));
    t.moved += 1;
    t.put = t.put.map((p) => (p.id === m.id ? putOf(readBoard(t.doc), m.id) ?? p : p));
  }
}
/** Both have heard each other, and each has kept apart what it put there, and that's been heard too. */
async function heard(a: Tab, b: Tab): Promise<void> {
  await agree([a, b], 'the two browsers to hear each other');
  keepApart(a);
  keepApart(b);
  await agree([a, b], 'what was moved apart to be heard');
}
const boxOf = (t: Tab, id: string): (Box & { f: string }) | null => {
  const o = readBoard(t.doc).byId.get(id);
  return o && hasBox(o) ? { x: o.x, y: o.y, w: o.w, h: o.h, f: o.f } : null;
};
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const holds = (f: Box, o: Box) => o.x >= f.x && o.y >= f.y && o.x + o.w <= f.x + f.w && o.y + o.h <= f.y + f.h;

/* ---------- a call with ideas ---------- */

/** An organizer and someone invited, in a call with notes on and a retro board open for everyone, and each one's tab on it. */
async function ideasCall() {
  const art = await account(unique('art'));
  const kofi = await account(unique('kofi'));
  const { code } = await art.api.calls.startNow({ notes: 'on', guests: [kofi.email] });
  const host = await art.api.calls.join(code, { mic: true, cam: false });
  await inGroup(host);
  const k = await kofi.api.calls.join(code, { mic: true, cam: false });
  await inGroup(k);
  await settle(host, (s) => s.participants.some((p) => p.id === k.ticket.identity));
  for (const at of [0, 1, 2, 3]) await host.appendAudio(piece(audioBytes('at-once'), 0, at));
  await host.openBoard({ template: 'retro' });
  const where = host.getSnapshot().board.open;
  const workspaceId = where?.workspaceId ?? '', documentId = where?.documentId ?? '';
  const [a, b] = await Promise.all([open(art, workspaceId, documentId, host.ticket.pass), open(kofi, workspaceId, documentId, k.ticket.pass)]);
  await until(() => readBoard(a.doc).frames.length === 3 && readBoard(b.doc).frames.length === 3, 'the retro’s frames');
  const frame = (title: string) => readBoard(a.doc).frames.find((f) => f.title === title);
  return { host, k, a, b, frame };
}
/** Looks for ideas from where `call` is, until the call offers `n`, and stops looking. */
async function ideasOf(call: CallSession, n: number): Promise<CallState['board']['ideas']> {
  const stop = call.watchIdeas();
  try {
    return (await settle(call, (s) => s.board.ideas.length >= n, 60_000)).board.ideas;
  } finally {
    stop();
  }
}

describe('ideas from the call added at the same moment', () => {
  it('land side by side when two people add different ones into one frame at once, and Undo still takes back each one’s own', async () => {
    const { host, k, a, b, frame } = await ideasCall();
    await say(host, k, 'We should check staging the day before every launch.', 0);
    await say(host, k, 'We need to name a status page owner.', 4000);
    const [first, second] = await ideasOf(k, 2);
    const actions = frame('Actions');
    if (!first || !second || !actions) throw new Error('no ideas, or no Actions');

    // Each adds one into Actions before hearing of the other: each picks Actions' first free spot.
    const mine = land(a, [{ text: first.text, frame: actions.id, from: first.id }]);
    const theirs = land(b, [{ text: second.text, frame: actions.id, from: second.id }]);
    const [ka] = mine.ids, [kb] = theirs.ids;
    if (!ka || !kb) throw new Error('an idea wasn’t added');
    expect(boxOf(a, ka)).toEqual(boxOf(b, kb));

    // Once they've heard each other, the one drawn on top moves to the next free spot, and only that one.
    await heard(a, b);
    const pa = boxOf(a, ka), pb = boxOf(a, kb);
    if (!pa || !pb) throw new Error('a sticky is missing');
    expect(overlaps(pa, pb)).toBe(false);
    expect([pa.f, pb.f]).toEqual([actions.id, actions.id]);
    expect(holds(actions, pa) && holds(actions, pb)).toBe(true);
    expect(a.moved + b.moved).toBe(1);

    // Telling the call they're on the board takes them off for everyone.
    await Promise.all([host.ideasDone([first.id]), k.ideasDone([second.id])]);
    expect((await settle(host, (s) => s.board.ideas.length === 0)).board.ideas).toEqual([]);
    expect((await settle(k, (s) => s.board.ideas.length === 0)).board.ideas).toEqual([]);

    // The one that moved apart: its toast's Undo takes it away from where it is now, and leaves the other's.
    const moved = a.moved ? { tab: a, step: mine.step, gone: ka, kept: kb } : { tab: b, step: theirs.step, gone: kb, kept: ka };
    if (!moved.step) throw new Error('no step to take back');
    moved.tab.history.undoStep(moved.step);
    await agree([a, b], 'the Undo to be heard');
    expect(readBoard(a.doc).byId.has(moved.gone)).toBe(false);
    expect(readBoard(a.doc).byId.has(moved.kept)).toBe(true);
    // Redo brings it back where it was moved to, on nothing.
    moved.tab.history.redo();
    await agree([a, b], 'the Redo to be heard');
    const back = boxOf(a, moved.gone), other = boxOf(a, moved.kept);
    expect(back !== null && other !== null && !overlaps(back, other)).toBe(true);
    a.s.close();
    b.s.close();
  });

  it('is one sticky when two people add the same idea at once, and goes for everyone once either tells the call', async () => {
    const { host, k, a, b, frame } = await ideasCall();
    await say(host, k, 'We should get the changelog out before the launch post.', 0);
    const [idea] = await ideasOf(k, 1);
    const improve = frame('Could improve');
    if (!idea || !improve) throw new Error('no idea, or no Could improve');

    // Both trays still offer it, and both add it before hearing of the other: the same sticky, by the idea's ID.
    const one: Landing = { text: idea.text, frame: improve.id, from: idea.id };
    land(a, [one]);
    land(b, [one]);
    await heard(a, b);
    const stickies = readBoard(a.doc).objects.filter((o) => o.k === 'note' && o.t === idea.text);
    expect(stickies.map((o) => o.id)).toEqual([stickyFrom(idea.id)]);
    expect(stickies.every((o) => o.f === improve.id && hasBox(o) && holds(improve, o))).toBe(true);

    // A tray that has heard it already leaves it as it is, and counts it as added.
    const before = shown(b);
    expect(addStickies(b.doc, [one], { x: 0, y: 0 }, 'butter', b.me)).toEqual([{ added: 'there', id: stickyFrom(idea.id) }]);
    expect(shown(b)).toBe(before);

    await Promise.all([host.ideasDone([idea.id]), k.ideasDone([idea.id])]);
    expect((await settle(host, (s) => s.board.ideas.length === 0)).board.ideas).toEqual([]);
    expect((await settle(k, (s) => s.board.ideas.length === 0)).board.ideas).toEqual([]);
    a.s.close();
    b.s.close();
  });

  it('goes into its frame as the frame is now when it’s added just as someone’s drag of that frame lands', async () => {
    const { host, k, a, b, frame } = await ideasCall();
    await say(host, k, 'We should write the launch runbook as one of our actions.', 0);
    const [idea] = await ideasOf(k, 1);
    const actions = frame('Actions');
    if (!idea || !actions) throw new Error('no idea, or no Actions');
    // Art's drag of Actions lands 300 to the right as Kofi, who hasn't heard it, adds the idea in Actions as it was.
    moveObjects(a.doc, [{ id: actions.id, x: actions.x + 300, y: actions.y }], a.me);
    const [id] = land(b, [{ text: idea.text, frame: actions.id, from: idea.id }]).ids;
    if (!id) throw new Error('the idea wasn’t added');
    await heard(a, b);
    const now = readBoard(a.doc).byId.get(actions.id), sticky = boxOf(a, id);
    expect(now && hasBox(now) && sticky && sticky.f === actions.id && holds(now, sticky)).toBe(true);
    a.s.close();
    b.s.close();
  });
});

describe('two branches from one idea at once', () => {
  it('land one under the other, and whoever’s moved keeps typing in theirs', async () => {
    const art = await account();
    const kofi = await account();
    const { id } = await art.api.workspaces.create('Product');
    await art.api.workspaces.addPerson(id, kofi.email, 'edit');
    const board = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Launch', parent: null })).id;
    const [a, b] = await Promise.all([open(art, id, board), open(kofi, id, board)]);
    const root = addMindMap(a.doc, { x: 0, y: 0 }, a.me);
    if (!root) throw new Error('no mind map');
    await agree([a, b], 'the idea to reach Kofi');

    // Tab on the same idea in both browsers, each before hearing of the other: one place for both branches.
    a.history.begin();
    b.history.begin();
    const ka = addBranch(a.doc, root, a.me), kb = addBranch(b.doc, root, b.me);
    if (!ka || !kb) throw new Error('a branch wasn’t made');
    for (const [t, k] of [[a, ka], [b, kb]] as const) { const p = putOf(readBoard(t.doc), k); if (p) t.put.push(p); }
    await heard(a, b);
    const pa = boxOf(a, ka), pb = boxOf(a, kb);
    if (!pa || !pb) throw new Error('a branch is missing');
    expect(overlaps(pa, pb)).toBe(false);
    expect(pa.x).toBe(pb.x);
    expect(a.moved + b.moved).toBe(1);

    // Whoever's was moved goes on typing in it, in the step that made it: one Undo takes all of it away, from where it is now.
    const moved = a.moved ? { tab: a, other: b, mine: ka, theirs: kb } : { tab: b, other: a, mine: kb, theirs: ka };
    const words = objectText(moved.tab.doc, moved.mine);
    if (!words) throw new Error('no words on the branch');
    moved.tab.doc.transact(() => words.insert(0, 'Pricing'), moved.tab.me);
    moved.tab.history.end();
    moved.other.history.end();
    await agree([a, b], 'the words to be heard');
    expect(readBoard(a.doc).byId.get(moved.mine)).toMatchObject({ k: 'node', t: 'Pricing', parent: root });
    moved.tab.history.undo();
    await agree([a, b], 'the Undo to be heard');
    expect(readBoard(a.doc).byId.has(moved.mine)).toBe(false);
    expect(readBoard(a.doc).byId.has(moved.theirs)).toBe(true);
    a.s.close();
    b.s.close();
  });
});
