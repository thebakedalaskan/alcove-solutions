/**
 * A board's timer and vote in a call, through browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres,
 * the object store and the local LiveKit server, with the board drawn through `@alcove/board` on a real document session, as a
 * browser draws it: what each person is told and when, who may do what, the limits, and what the previous release stored.
 */
import { AlcoveApiError, CALL_TOPIC, type CallBoardOpen, type CallSession, type CallState, type DocSession, type DocSessionOptions, type WorkspaceRole } from '@alcove/api';
import { addObject, moveObjects, removeObjects, type NewObject } from '@alcove/board';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from '../../crypto';
import { openOwner } from '../../owners';
import { startHarness, type Browser, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const inRoom: TestParticipant[] = [];
afterEach(async () => { await Promise.all(inRoom.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
async function account(email = unique(), b = h.browser()): Promise<Account> {
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
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
const board = async (call: CallSession) => (await read(call)).board;
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
  await settle(host, (s) => s.participants.some((p) => p.id === who.ticket.identity));
}
/** Someone with the link and no account, let in. `previous`: their pass from before, as after a reload. */
async function guest(host: CallSession, callCode: string, name = 'Jamie Guest') {
  const b = h.browser();
  const call = await b.api.calls.join(callCode, { mic: false, cam: false, name });
  await letIn(host, call);
  return { ...b, call };
}
/** Someone signed in and invited, in the call: back from a reload with `previous`. */
async function invited(host: CallSession, callCode: string, who: Browser, previous?: string) {
  const call = await who.api.calls.join(callCode, { mic: false, cam: false, ...(previous ? { previous } : {}) });
  await inGroup(call);
  await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
  return call;
}
/** A call `org` hosts, with `guests` invited. */
async function callBy(org: Account, guests: string[] = []) {
  const { code: c } = await org.api.calls.startNow({ notes: 'off', guests });
  const host = await org.api.calls.join(c, { mic: false, cam: false });
  await inGroup(host);
  return { host, code: c };
}
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
async function openDoc(who: Browser, id: string, document: string, opts: DocSessionOptions = {}): Promise<DocSession> {
  const s = await who.api.workspaces.document(id, document, opts);
  await s.ready;
  return s;
}
const stored = (s: DocSession) => until(() => s.getSnapshot().status === 'saved', 'everything to reach Alcove');
/** Everything the call told this person, as text: what a sticky's ID would be found in. */
const said = (s: CallState) => JSON.stringify(s);
/** An action as a browser sends it, whatever the client would make of it. */
const action = (who: Browser, call: CallSession, a: unknown) => who.fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(a) });
/** The call's own record of itself, opened as the server opens it, and how to put it back. */
async function storedCall(ownerId: string, callId: string) {
  const o = await openOwner(h.deps, ownerId, undefined);
  const key = stateKey(o.root, ownerId, `call:${callId}`);
  const header = { v: 1, kind: 'call-state', ownerId, callId } as const;
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [ownerId, callId])).rows[0]);
  const state = openJson(key, header, row.state_ciphertext, z.record(z.string(), z.unknown()));
  const put = (next: Record<string, unknown>) => h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, sealJson(key, header, toJson(next))]);
  return { state, put };
}
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
/** How many connections to the database are waiting for a lock now. */
const waitingOnLocks = () => count("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
/**
 * Runs `both` while something else holds the call's row, as a busy moment does, so each gets as far as it can before the row
 * is let go, and then they go one at a time. What each came to, in order: null for done, or its refusal.
 */
async function atOnce(callId: string, both: (() => Promise<unknown>)[]) {
  const holder = new pg.Client({ connectionString: process.env['TEST_DATABASE_URL'] });
  await holder.connect();
  try {
    const base = await waitingOnLocks();
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM calls WHERE call_id = $1 FOR UPDATE', [callId]);
    const going = both.map((f) => refusal(f()));
    await until(async () => (await waitingOnLocks()) >= base + both.length, 'each to wait for the call');
    await holder.query('COMMIT');
    return await Promise.all(going);
  } finally {
    await holder.end();
  }
}
/**
 * Holds the call's row while `steps` start one after another, each either waiting for the row, so they reach it in that order once
 * it's let go (Postgres grants a row's lock first come, first served), or answered before it. What each came to, in order.
 */
async function inTurn(callId: string, steps: (() => Promise<unknown>)[]) {
  const holder = new pg.Client({ connectionString: process.env['TEST_DATABASE_URL'] });
  await holder.connect();
  try {
    const base = await waitingOnLocks();
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM calls WHERE call_id = $1 FOR UPDATE', [callId]);
    const going: Promise<unknown>[] = [];
    let queued = 0;
    for (const step of steps) {
      let answered = false;
      going.push(refusal(step()).finally(() => { answered = true; }));
      const ahead = queued;
      await until(async () => answered || (await waitingOnLocks()) >= base + ahead + 1, 'the step to wait for the call, or be answered');
      if (!answered) queued += 1;
    }
    await holder.query('COMMIT');
    return await Promise.all(going);
  } finally {
    await holder.end();
  }
}
/** The main room's open board in a call as it's stored, to change as an older release, or time, would have left it. */
const OpenStored = z.object({ open: z.object({ main: z.record(z.string(), z.unknown()) }).passthrough() }).passthrough();

/* ---------- a board to vote on, drawn as a browser draws it ---------- */

const DRAWN_BY = 'a test browser';
function add(doc: Y.Doc, o: NewObject): string {
  const id = addObject(doc, o, DRAWN_BY);
  if (!id) throw new Error('the board refused it');
  return id;
}
const frameAt = (title: string, x: number, y: number, w = 360, h = 530): NewObject => ({ k: 'frame', x, y, w, h, c: '', role: '', hint: '', sub: '', sorted: false, title });
const stickyAt = (x: number, y: number, t: string): NewObject => ({ k: 'note', x, y, w: 150, h: 150, c: 'rose', size: 'm', t });
/**
 * A retro on the board open in the call: four stickies in Could improve, and in a frame inside it one more; a sticky in Actions;
 * and one in neither. Drawn by `who`, who can edit it.
 */
async function retro(who: Browser, open: CallBoardOpen | null, opts: DocSessionOptions = {}) {
  const page = await openDoc(who, open?.workspaceId ?? '', open?.documentId ?? '', opts);
  const d = page.doc;
  const fix = add(d, frameAt('Could improve', 0, 0, 360, 700));
  const s1 = add(d, stickyAt(20, 20, 'Nobody owned the status page'));
  const s2 = add(d, stickyAt(190, 20, 'Changelog went out late'));
  const s3 = add(d, stickyAt(20, 190, 'Staging data was stale'));
  const s4 = add(d, stickyAt(190, 190, 'One checklist in three tools'));
  const inner = add(d, frameAt('Billing', 20, 360, 320, 320));
  const deep = add(d, stickyAt(40, 400, 'The billing bug'));
  const act = add(d, frameAt('Actions', 400, 0));
  const action1 = add(d, stickyAt(420, 20, 'One owner for launch comms'));
  const loose = add(d, stickyAt(900, 0, 'On its own'));
  await stored(page);
  return { page, fix, s1, s2, s3, s4, inner, deep, act, action1, loose };
}

describe('the timer', () => {
  it('runs from now for everyone where the board is, and a late joiner and a reconnect get it', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'retro' });
    expect(await board(k)).toMatchObject({ timer: null, vote: null });

    // Ten minutes in, so from now and from when the call started aren't the same.
    await h.pool.query("UPDATE calls SET started_at = started_at - interval '10 minutes' WHERE owner_id = $1 AND call_id = $2", [art.ownerId, host.ticket.callId]);
    const before = (await read(k)).elapsed;
    expect(before).toBeGreaterThanOrEqual(600);
    await k.startTimer(5);
    const timer = k.getSnapshot().board.timer;
    expect(timer).toEqual({ until: expect.any(Number), length: 300, text: 'Add your stickies', canStop: true });
    // Five minutes from when it started, as the call counts, which is what everyone's countdown goes by.
    const until5 = timer?.until ?? 0;
    expect(until5 - before).toBeGreaterThanOrEqual(300);
    expect(until5 - before).toBeLessThanOrEqual(302);
    expect((await board(host)).timer).toEqual(timer);

    // Someone who comes in later is told it, as it is, and can't stop it.
    const p = await invited(host, c, priya);
    expect((await board(p)).timer).toEqual({ until: until5, length: 300, text: 'Add your stickies', canStop: false });
    // Kofi back after a reload still has it, and can still stop it: it's his whichever connection he's on.
    k.closing();
    const k2 = await invited(host, c, kofi, k.ticket.pass);
    expect((await board(k2)).timer).toEqual(timer);
    await k2.stopTimer();
    expect((await board(p)).timer).toBeNull();
    await host.leave();
  });

  it('is started by anyone who can edit the board, and stopped only by whoever started it or the organizer', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c);
    // Nothing to run it on.
    expect(await refusal(k.startTimer(3))).toEqual({ code: 'conflict', status: 409, message: 'No board is open here.' });
    await host.openBoard({ template: 'blank' });

    await k.startTimer(3);
    expect(await refusal(p.stopTimer())).toEqual({ code: 'forbidden', status: 403, message: 'Only whoever started the timer, or the organizer, can stop it.' });
    expect(await refusal(jamie.call.stopTimer())).toMatchObject({ code: 'forbidden' });
    expect((await board(p)).timer).toMatchObject({ length: 180, canStop: false });
    // The organizer can stop anyone's.
    expect((await board(host)).timer?.canStop).toBe(true);
    await host.stopTimer();
    expect((await board(k)).timer).toBeNull();
    // Stopping one that's gone changes nothing, as a second press of Stop finds.
    expect(await code(host.stopTimer())).toBe('allowed');
    // A guest who can edit the board starts one too, and stops their own.
    await jamie.call.startTimer(10);
    expect((await board(jamie.call)).timer).toMatchObject({ length: 600, canStop: true });
    await jamie.call.stopTimer();
    expect((await board(host)).timer).toBeNull();
    // Only the three lengths, and stopping is null.
    for (const minutes of [0, 1, 4, 60, '5', undefined]) expect((await action(art, host, { type: 'board-timer', minutes })).status).toBe(400);
    await host.leave();
  });

  it('starts over only for whoever started it or the organizer while it runs, and for anyone once it’s run out', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    await host.openBoard({ template: 'blank' });
    await k.startTimer(10);
    const first = (await board(k)).timer;
    expect(await refusal(p.startTimer(3))).toEqual({ code: 'conflict', status: 409, message: 'A timer is running. Whoever started it, or the organizer, can stop it.' });
    expect((await board(p)).timer).toEqual({ ...first, canStop: false });
    // Kofi starts it over, and so can the organizer.
    await k.startTimer(3);
    expect((await board(p)).timer).toMatchObject({ length: 180, canStop: false });
    await host.startTimer(5);
    expect((await board(k)).timer).toMatchObject({ length: 300, canStop: false });
    expect((await board(host)).timer?.canStop).toBe(true);

    // Once it's run out it says so until it's stopped, and anyone who can edit can start another.
    const call = await storedCall(art.ownerId, host.ticket.callId);
    const boards = OpenStored.parse(call.state['board']);
    await call.put({ ...call.state, board: { ...boards, open: { main: { ...boards.open.main, timer: { ...z.record(z.string(), z.unknown()).parse(boards.open.main['timer']), until: 1 } } } } });
    expect((await board(p)).timer).toMatchObject({ until: 1, length: 300, canStop: false });
    await p.startTimer(3);
    expect((await board(k)).timer).toMatchObject({ length: 180, canStop: false });
    expect((await board(p)).timer?.canStop).toBe(true);
    await host.leave();
  });
});

describe('a vote', () => {
  it('tells nobody a count while it’s on, and everyone every count at once when it ends', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);

    await k.startVote(b.fix, 3);
    const started = { on: true, frame: b.fix, per: 3, left: 3, mine: [], results: {}, voters: 0 };
    expect((await board(k)).vote).toEqual({ ...started, canEnd: true });
    for (const who of [host, p, jamie.call]) expect((await board(who)).vote).toEqual({ ...started, canEnd: who === host });

    await host.castVote(b.s1);
    await host.castVote(b.s2);
    await k.castVote(b.s2);
    await k.castVote(b.s3);
    await jamie.call.castVote(b.s1);
    await jamie.call.castVote(b.s4);
    // Each browser holds its own votes and nothing of anyone else's: not a count, not who has voted, not what for.
    const theirs: [CallSession, string[], string[]][] = [[host, [b.s1, b.s2], [b.s3, b.s4]], [k, [b.s2, b.s3], [b.s1, b.s4]], [jamie.call, [b.s1, b.s4], [b.s2, b.s3]], [p, [], [b.s1, b.s2, b.s3, b.s4]]];
    for (const [who, mine, others] of theirs) {
      const s = await read(who);
      expect(s.board.vote).toEqual({ ...started, left: 3 - mine.length, mine, canEnd: who === host || who === k });
      for (const id of others) expect(said(s)).not.toContain(id);
    }

    // Kofi started it, so Kofi ends it, and every count reaches everyone at once.
    await k.endVote();
    const results = { [b.s1]: 2, [b.s2]: 2, [b.s3]: 1, [b.s4]: 1 };
    for (const [who, mine] of theirs) {
      expect((await board(who)).vote).toEqual({ on: false, frame: b.fix, per: 3, left: 3 - mine.length, mine, results, voters: 3, canEnd: who === host || who === k });
    }
    // Nothing about it was written to the board.
    expect(JSON.stringify(b.page.doc.toJSON())).not.toContain('"votes"');
    // Done clears it for everyone.
    await k.clearVote();
    for (const [who] of theirs) expect((await board(who)).vote).toBeNull();
    await host.leave();
  });

  it('tells nobody else when someone votes, so nobody can count votes as they’re cast', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    await host.startVote(b.fix, 5);
    const room = await connect(await p.room(), { sending: p.crypto });
    inRoom.push(room);
    // A browser that's only just reached the room can miss what's sent that moment, so this one has heard something first.
    let ready = false;
    const warm = room.nextNudge().then(() => { ready = true; });
    while (!ready) { await host.lock(false); await rest(50); }
    await warm;
    const nudges = () => room.received(CALL_TOPIC).filter((d) => d.from === null).length;
    const quiet = nudges();
    await k.castVote(b.s1);
    await k.castVote(b.s2);
    await k.takeBackVote(b.s2);
    await host.castVote(b.s3);
    await rest(1500);
    expect(nudges()).toBe(quiet);
    // Ending it is everyone's news.
    const ended = room.nextNudge();
    await host.endVote();
    await ended;
    expect((await board(p)).vote).toMatchObject({ on: false, results: { [b.s1]: 1, [b.s3]: 1 }, voters: 2 });
    await host.leave();
  });

  it('keeps your votes across a reload and on your other devices, and a late joiner gets the vote', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const k = await invited(host, c, kofi);
    const jamie = await guest(host, c);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    await host.startVote(b.fix, 3);
    await k.castVote(b.s1);
    await jamie.call.castVote(b.s2);

    // In later, Priya is told the vote is on and has all her votes, and nothing of anyone's.
    const p = await invited(host, c, priya);
    const late = await read(p);
    expect(late.board.vote).toEqual({ on: true, frame: b.fix, per: 3, left: 3, mine: [], results: {}, voters: 0, canEnd: false });
    expect(said(late)).not.toContain(b.s1);
    // Back after a reload, Kofi and Jamie have what they voted for.
    k.closing();
    const k2 = await invited(host, c, kofi, k.ticket.pass);
    expect((await board(k2)).vote).toMatchObject({ on: true, left: 2, mine: [b.s1] });
    jamie.call.closing();
    const j2 = await jamie.api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest', previous: jamie.call.ticket.pass });
    await inGroup(j2);
    expect((await board(j2)).vote).toMatchObject({ left: 2, mine: [b.s2] });
    // Kofi in on a second device too, with no pass from the first: still Kofi, with one set of votes between them.
    const phone = h.browser();
    await phone.api.auth.signIn('sso', { email: kofi.email });
    const k3 = await invited(host, c, phone);
    expect((await board(k3)).vote).toMatchObject({ left: 2, mine: [b.s1] });
    await k3.castVote(b.s3);
    await k3.castVote(b.s4);
    expect((await board(k2)).vote).toMatchObject({ left: 0, mine: [b.s1, b.s3, b.s4] });
    expect(await refusal(k2.castVote(b.s2))).toEqual({ code: 'conflict', status: 409, message: 'You’ve used all your votes. Take one back to vote for this.' });
    await host.endVote();
    expect((await board(p)).vote).toMatchObject({ results: { [b.s1]: 1, [b.s2]: 1, [b.s3]: 1, [b.s4]: 1 }, voters: 2 });
    await host.leave();
  });

  it('counts a guest’s votes as the person their pass names: a second tab with that pass shares them, and another guest has their own', async () => {
    const art = await account();
    const { host, code: c } = await callBy(art);
    const jamie = await guest(host, c);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    await host.startVote(b.fix, 3);
    await jamie.call.castVote(b.s1);
    await jamie.call.castVote(b.s2);
    // Jamie opens a second tab with the first one's pass, as a duplicated tab has it: Jamie, with the votes cast so far.
    const tab = await jamie.api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest', previous: jamie.call.ticket.pass });
    await inGroup(tab);
    expect((await board(tab)).vote).toMatchObject({ left: 1, mine: [b.s1, b.s2] });
    await tab.castVote(b.s3);
    expect(await refusal(tab.castVote(b.s4))).toEqual({ code: 'conflict', status: 409, message: 'You’ve used all your votes. Take one back to vote for this.' });
    // A vote taken back there is one Jamie has again.
    await tab.takeBackVote(b.s1);
    await tab.castVote(b.s4);
    expect((await board(tab)).vote).toMatchObject({ left: 0, mine: [b.s2, b.s3, b.s4] });
    // Another guest is someone else, with votes of their own.
    const sam = await guest(host, c, 'Sam Guest');
    expect((await board(sam.call)).vote).toMatchObject({ left: 3, mine: [] });
    await sam.call.castVote(b.s2);
    await host.endVote();
    expect((await board(host)).vote).toMatchObject({ results: { [b.s2]: 2, [b.s3]: 1, [b.s4]: 1 }, voters: 2 });
    await host.leave();
  });

  it('counts a vote only for a sticky still in it, however a take-back and a vote from two devices land, and when it ends', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, [kofi.email]);
    const laptop = await invited(host, c, kofi);
    const phoneBrowser = h.browser();
    await phoneBrowser.api.auth.signIn('sso', { email: kofi.email });
    const phone = await invited(host, c, phoneBrowser);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    await host.startVote(b.fix, 3);
    const notInIt = { code: 'conflict', status: 409, message: 'That sticky isn’t part of this vote.' };
    // Kofi votes for S2, which is then deleted. His laptop takes the vote back and his phone votes for it again, reaching the
    // call in that order: the vote is still his when the phone asks, but the sticky isn't in the vote, so it's refused.
    await laptop.castVote(b.s2);
    removeObjects(b.page.doc, [b.s2], DRAWN_BY);
    await stored(b.page);
    const [back, again] = await inTurn(host.ticket.callId, [() => laptop.takeBackVote(b.s2), () => phone.castVote(b.s2)]);
    expect(back).toBeNull();
    expect(again).toEqual(notInIt);
    expect((await board(laptop)).vote?.mine).toEqual([]);
    // Votes cast for a sticky that's since been deleted, or moved out of the frame, count for nothing when it ends.
    await laptop.castVote(b.s3);
    await laptop.castVote(b.s4);
    await host.castVote(b.s4);
    await host.castVote(b.s1);
    removeObjects(b.page.doc, [b.s3], DRAWN_BY);
    moveObjects(b.page.doc, [{ id: b.s4, x: 1200, y: 0 }], DRAWN_BY);
    await stored(b.page);
    await host.endVote();
    expect((await board(phone)).vote).toMatchObject({ on: false, results: { [b.s1]: 1 }, voters: 1 });
    await host.leave();
  });

  it('takes nothing from another board, even one the voter can edit', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const other = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Elsewhere' })).id;
    const page = await openDoc(art, id, other);
    const elsewhereFrame = add(page.doc, frameAt('Elsewhere', 0, 0));
    const elsewhereSticky = add(page.doc, stickyAt(20, 20, 'Not this board'));
    await stored(page);
    const { host } = await callBy(art);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    expect(await refusal(host.startVote(elsewhereFrame, 3))).toEqual({ code: 'conflict', status: 409, message: 'That frame isn’t on this board.' });
    await host.startVote(null, 3);
    expect(await refusal(host.castVote(elsewhereSticky))).toEqual({ code: 'conflict', status: 409, message: 'That sticky isn’t part of this vote.' });
    await host.castVote(b.s1);
    expect((await board(host)).vote).toMatchObject({ mine: [b.s1], left: 2 });
    await host.leave();
  });

  it('is stopped and ended by whoever started it from any device of theirs, and theirs while any of them is here', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const laptop = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const phoneBrowser = h.browser();
    await phoneBrowser.api.auth.signIn('sso', { email: kofi.email });
    const phone = await invited(host, c, phoneBrowser);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    await laptop.startTimer(5);
    await laptop.startVote(b.fix, 3);
    await laptop.castVote(b.s1);
    // On his phone, which joined without the laptop's pass, it's his: his vote, Stop and End.
    expect((await board(phone))).toMatchObject({ timer: { canStop: true }, vote: { mine: [b.s1], canEnd: true } });
    // With the organizer gone and his laptop gone, he's still here on his phone, so it's not Priya's to stop.
    inRoom.push(await connect(await p.room(), { sending: p.crypto }));
    await host.handOff(p.ticket.identity);
    await settle(p, (s) => s.isHost);
    await laptop.leave();
    expect((await board(p)).timer?.canStop).toBe(false);
    expect(await refusal(p.stopTimer())).toMatchObject({ code: 'forbidden' });
    await phone.endVote();
    await phone.stopTimer();
    expect(await board(p)).toMatchObject({ timer: null, vote: { on: false, results: { [b.s1]: 1 }, voters: 1 } });
    await phone.clearVote();
    expect((await board(p)).vote).toBeNull();
    await p.leave();
  });

  it('can’t start on top of another, nor while one’s results haven’t been cleared', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, [kofi.email]);
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    await k.startVote(b.fix, 3);
    await k.castVote(b.s1);
    const second = { code: 'conflict', status: 409, message: 'There’s a vote on this board already.' };
    // Not by anyone: not whoever started it, not the organizer, and not on another frame.
    expect(await refusal(k.startVote(b.fix, 5))).toEqual(second);
    expect(await refusal(host.startVote(b.act, 3))).toEqual(second);
    expect(await refusal(host.startVote(null, 10))).toEqual(second);
    // The first goes on as it was.
    expect((await board(k)).vote).toMatchObject({ on: true, frame: b.fix, per: 3, mine: [b.s1] });
    await k.endVote();
    expect(await refusal(host.startVote(b.act, 3))).toEqual(second);
    expect((await board(host)).vote).toMatchObject({ on: false, results: { [b.s1]: 1 } });
    await k.clearVote();
    await host.startVote(b.act, 5);
    expect((await board(k)).vote).toEqual({ on: true, frame: b.act, per: 5, left: 5, mine: [], results: {}, voters: 0, canEnd: false });
    await host.leave();
  });

  it('takes one vote a sticky, up to your votes each, and only for stickies it’s on', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, [kofi.email]);
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    // A vote is on a frame that's on this board.
    const noFrame = { code: 'conflict', status: 409, message: 'That frame isn’t on this board.' };
    expect(await refusal(k.startVote(b.s1, 3))).toEqual(noFrame);
    expect(await refusal(k.startVote('AAAAAAAAAAAA', 3))).toEqual(noFrame);
    for (const per of [0, 1, 4, 20, '3', undefined]) expect((await action(kofi, k, { type: 'board-vote', step: 'start', frame: b.fix, per })).status).toBe(400);
    expect((await action(kofi, k, { type: 'board-vote', step: 'start', frame: 'not-an-id', per: 3 })).status).toBe(400);
    await k.startVote(b.fix, 3);

    // One vote a sticky: voting again for one changes nothing.
    await k.castVote(b.s1);
    await k.castVote(b.s1);
    expect((await board(k)).vote).toMatchObject({ left: 2, mine: [b.s1] });
    // Inside the frame however deep, and nowhere else: not another frame's, not one in no frame, not a frame, not one that isn't there.
    await k.castVote(b.deep);
    const notInIt = { code: 'conflict', status: 409, message: 'That sticky isn’t part of this vote.' };
    for (const id of [b.action1, b.loose, b.fix, b.inner, 'AAAAAAAAAAAA']) expect(await refusal(k.castVote(id))).toEqual(notInIt);
    expect((await action(kofi, k, { type: 'board-vote', step: 'cast', sticky: 'nope' })).status).toBe(400);
    // Up to your votes each, and taking one back frees it.
    await k.castVote(b.s2);
    expect((await board(k)).vote).toMatchObject({ left: 0, mine: [b.s1, b.deep, b.s2] });
    expect(await refusal(k.castVote(b.s3))).toEqual({ code: 'conflict', status: 409, message: 'You’ve used all your votes. Take one back to vote for this.' });
    await k.takeBackVote(b.s2);
    // Taking back what isn't there changes nothing.
    await k.takeBackVote(b.s4);
    await k.castVote(b.s3);
    expect((await board(k)).vote).toMatchObject({ left: 0, mine: [b.s1, b.deep, b.s3] });
    // Once it's ended, nothing more is cast or taken back.
    await host.endVote();
    const ended = { code: 'conflict', status: 409, message: 'This vote has ended.' };
    expect(await refusal(k.takeBackVote(b.s1))).toEqual(ended);
    expect(await refusal(host.castVote(b.s4))).toEqual(ended);
    expect((await board(host)).vote).toMatchObject({ results: { [b.s1]: 1, [b.deep]: 1, [b.s3]: 1 }, voters: 1 });
    await host.clearVote();
    expect(await refusal(k.castVote(b.s1))).toEqual({ code: 'conflict', status: 409, message: 'There’s no vote on this board.' });

    // With no frame it's on every sticky on the board, and still only stickies.
    await k.startVote(null, 5);
    for (const id of [b.s1, b.action1, b.loose, b.deep]) await k.castVote(id);
    expect(await refusal(k.castVote(b.act))).toEqual(notInIt);
    expect((await board(k)).vote).toMatchObject({ frame: null, left: 1, mine: [b.s1, b.action1, b.loose, b.deep] });
    await host.leave();
  });

  it('is started by anyone who can edit the board, and ended and cleared only by whoever started it or the organizer', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);

    await k.startVote(b.fix, 3);
    expect(await refusal(p.endVote())).toEqual({ code: 'forbidden', status: 403, message: 'Only whoever started the vote, or the organizer, can end it.' });
    expect(await refusal(jamie.call.endVote())).toMatchObject({ code: 'forbidden' });
    expect(await refusal(k.clearVote())).toEqual({ code: 'conflict', status: 409, message: 'End the vote first.' });
    // The organizer can end anyone's, and ending again changes nothing.
    await host.endVote();
    expect(await code(host.endVote())).toBe('allowed');
    expect(await refusal(p.clearVote())).toEqual({ code: 'forbidden', status: 403, message: 'Only whoever started the vote, or the organizer, can clear it.' });
    expect((await board(p)).vote).toMatchObject({ on: false, canEnd: false });
    await k.clearVote();
    expect(await code(k.clearVote())).toBe('allowed');
    expect(await refusal(k.endVote())).toEqual({ code: 'conflict', status: 409, message: 'There’s no vote on this board.' });

    // A guest who can edit the board starts one, votes in it, and ends it; the organizer clears it.
    await jamie.call.startVote(b.fix, 5);
    await jamie.call.castVote(b.s4);
    await k.castVote(b.s4);
    expect((await board(jamie.call)).vote).toMatchObject({ left: 4, mine: [b.s4], canEnd: true });
    expect(await refusal(k.endVote())).toMatchObject({ code: 'forbidden' });
    await jamie.call.endVote();
    expect((await board(k)).vote).toMatchObject({ on: false, results: { [b.s4]: 2 }, voters: 2 });
    await host.clearVote();
    expect((await board(jamie.call)).vote).toBeNull();
    for (const step of ['nope', undefined]) expect((await action(art, host, { type: 'board-vote', step })).status).toBe(400);
    await host.leave();
  });
});

describe('at the same moment', () => {
  it('starts one vote however many start at once, and never takes more votes than someone has, from any device', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, [kofi.email, priya.email]);
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const phone = h.browser();
    await phone.api.auth.signIn('sso', { email: kofi.email });
    const k2 = await invited(host, c, phone);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    const { callId } = host.ticket;

    const starts = await atOnce(callId, [() => p.startVote(b.fix, 3), () => host.startVote(b.act, 5)]);
    expect(starts.filter((r) => r === null)).toHaveLength(1);
    expect(starts.filter((r) => r !== null)).toEqual([{ code: 'conflict', status: 409, message: 'There’s a vote on this board already.' }]);
    expect((await board(k)).vote).toMatchObject(starts[0] === null ? { frame: b.fix, per: 3 } : { frame: b.act, per: 5 });
    await host.endVote();
    await host.clearVote();

    // Kofi has one vote left, and casts it from both his devices at once: one counts.
    await p.startVote(b.fix, 3);
    await k.castVote(b.s1);
    await k2.castVote(b.s2);
    const casts = await atOnce(callId, [() => k.castVote(b.s3), () => k2.castVote(b.s4)]);
    expect(casts.filter((r) => r === null)).toHaveLength(1);
    expect(casts.filter((r) => r !== null)).toEqual([{ code: 'conflict', status: 409, message: 'You’ve used all your votes. Take one back to vote for this.' }]);
    expect((await board(k2)).vote).toMatchObject({ left: 0, mine: [b.s1, b.s2, casts[0] === null ? b.s3 : b.s4] });
    await host.leave();
  });
});

describe('who is told of them', () => {
  it('tells someone who can only read the board, who can’t run either, and someone who can’t open it nothing at all', async () => {
    const art = await account();
    const lena = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[lena, 'read']]);
    const saved = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Planning' })).id;
    const { host, code: c } = await callBy(art, [lena.email, kofi.email]);
    const l = await invited(host, c, lena);
    const k = await invited(host, c, kofi);
    const jamie = await guest(host, c);
    await host.setWorkspace(id);
    // Brought without letting anyone in: Lena can read it, and Kofi and Jamie can't open it.
    await host.openBoard({ workspaceId: id, documentId: saved, letIn: false });
    const b = await retro(art, host.getSnapshot().board.open);
    await host.startTimer(5);
    await host.startVote(b.fix, 3);
    await host.castVote(b.s1);

    expect(await board(l)).toMatchObject({ open: { role: 'read' }, timer: { length: 300, canStop: false }, vote: { on: true, frame: b.fix, left: 3, mine: [], results: {}, voters: 0, canEnd: false } });
    const cantRead = { code: 'forbidden', status: 403, message: 'You can read this, but not change it.' };
    expect(await refusal(l.startTimer(3))).toEqual(cantRead);
    expect(await refusal(l.castVote(b.s2))).toEqual(cantRead);
    expect(await refusal(l.takeBackVote(b.s1))).toEqual(cantRead);
    for (const who of [k, jamie.call]) {
      const s = await read(who);
      expect(s.board).toEqual({ open: expect.objectContaining({ role: null, documentId: null }), timer: null, vote: null, ideas: [] });
      expect(said(s)).not.toContain(b.fix);
      expect(await code(who.castVote(b.s2))).toBe('not-found');
    }
    // With nothing running, someone who can only read still can't start either.
    await host.stopTimer();
    await host.endVote();
    await host.clearVote();
    expect(await refusal(l.startTimer(3))).toEqual(cantRead);
    expect(await refusal(l.startVote(b.fix, 3))).toEqual(cantRead);
    expect(await code(k.startTimer(3))).toBe('not-found');
    expect((await board(host)).timer).toBeNull();
    await host.leave();
  });

  it('answers someone who can’t open the board the same whether a timer runs and a vote is on, has ended, or there’s neither', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product');
    const planning = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Planning' })).id;
    const { host, code: c } = await callBy(art, [kofi.email]);
    const k = await invited(host, c, kofi);
    const jamie = await guest(host, c);
    await host.setWorkspace(id);
    // Brought without letting anyone in: Kofi and Jamie can't open it.
    await host.openBoard({ workspaceId: id, documentId: planning, letIn: false });
    const b = await retro(art, host.getSnapshot().board.open);
    /** Everything someone who can't open it might try, and what each answer is. */
    const tries = async (call: CallSession) => ({
      stopTimer: await refusal(call.stopTimer()), startTimer: await refusal(call.startTimer(3)), startVote: await refusal(call.startVote(null, 3)),
      castVote: await refusal(call.castVote(b.s1)), takeBack: await refusal(call.takeBackVote(b.s1)), endVote: await refusal(call.endVote()), clearVote: await refusal(call.clearVote())
    });
    for (const who of [k, jamie.call]) {
      expect(await board(who)).toMatchObject({ open: { role: null, everyone: false }, timer: null, vote: null });
      const nothingRunning = await tries(who);
      expect(Object.values(nothingRunning).every((r) => r !== null && r.code === 'not-found')).toBe(true);
      await host.startTimer(5);
      await host.startVote(b.fix, 3);
      await host.castVote(b.s1);
      expect(await tries(who)).toEqual(nothingRunning);
      await host.endVote();
      expect(await tries(who)).toEqual(nothingRunning);
      await host.clearVote();
      await host.stopTimer();
    }
    await host.leave();
  });

  it('keeps them when the same board opens again, and they end when it closes or another opens in its place', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, [kofi.email]);
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'retro' });
    const first = host.getSnapshot().board.open;
    const firstId = first?.documentId ?? '';
    const b = await retro(art, first);
    await k.startTimer(10);
    await k.startVote(b.fix, 3);
    await k.castVote(b.s1);
    const running = await board(k);

    // Opening the board that's open carries on with its session.
    await host.openBoard({ workspaceId: first?.workspaceId ?? '', documentId: firstId, letIn: false });
    expect(await board(k)).toEqual(running);
    // Another board in its place starts with neither, and they don't come back with the first.
    await host.openBoard({ template: 'blank' });
    expect(await board(k)).toMatchObject({ timer: null, vote: null });
    await host.openBoard({ workspaceId: first?.workspaceId ?? '', documentId: firstId, letIn: false });
    expect(await board(k)).toMatchObject({ open: { documentId: firstId }, timer: null, vote: null });
    // Closing ends them too.
    await k.startTimer(3);
    await host.closeBoard();
    expect(await board(k)).toEqual({ open: null, timer: null, vote: null, ideas: [] });
    await host.openBoard({ workspaceId: first?.workspaceId ?? '', documentId: firstId, letIn: false });
    expect(await board(k)).toMatchObject({ timer: null, vote: null });
    await host.leave();
  });
});

/**
 * A call Art hosts, with a board saved in his workspace brought to it, that Kofi and Priya can edit and Lena can only read,
 * and the retro drawn on it.
 */
async function savedBoardCall(priyaBrowser?: Browser) {
  const art = await account();
  const kofi = await account();
  const priya = await account(undefined, priyaBrowser);
  const lena = await account();
  const id = await workspace(art, 'Product', [[kofi, 'edit'], [priya, 'edit'], [lena, 'read']]);
  const saved = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Planning' })).id;
  const { host, code: c } = await callBy(art, [kofi.email, priya.email, lena.email]);
  const k = await invited(host, c, kofi);
  const p = await invited(host, c, priya);
  const l = await invited(host, c, lena);
  await host.setWorkspace(id);
  await host.openBoard({ workspaceId: id, documentId: saved, letIn: false });
  const b = await retro(art, host.getSnapshot().board.open);
  return { code: c, host, k, p, l, priya, b };
}
/** The organizer leaves and asks Kofi to host, which takes a browser in the call's room, as his would be. */
async function organizerLeaves(host: CallSession, k: CallSession) {
  inRoom.push(await connect(await k.room(), { sending: k.crypto }));
  await host.handOff(k.ticket.identity);
  await settle(k, (s) => s.isHost);
}
const cantRead = { code: 'forbidden', status: 403, message: 'You can read this, but not change it.' };

describe('with neither whoever started it nor the organizer in the call', () => {
  it('keeps the timer’s starter out while their successful departure response is still on its way', async () => {
    const browser = h.browser();
    let releaseDeparture = () => {};
    const departureResponse = new Promise<void>((resolve) => { releaseDeparture = resolve; });
    let releaseRead = () => {};
    const readResponse = new Promise<void>((resolve) => { releaseRead = resolve; });
    let departing = false;
    let departed = false;
    let heldReads = 0;
    let recoveries = 0;
    const delayed = h.browser({ fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (departing && path.endsWith('/mls/back')) recoveries++;
      const response = await browser.fetch(input, init);
      // Only slow real responses: the server still processes every request and returns its real answer.
      if (departing && path.endsWith('/mls')) { heldReads++; await readResponse; }
      if (departing && path.endsWith('/leave')) { departed = true; await departureResponse; }
      return response;
    } });
    const { host, k, p, l } = await savedBoardCall(delayed);
    await p.startTimer(10);
    await organizerLeaves(host, k);
    departing = true;
    const leaving = p.leave();
    try {
      await until(() => departed, 'the server to accept the departure');
      await until(() => !k.crypto.getSnapshot().members.includes(p.ticket.identity), 'the new host to move the keys on without the starter');
      await until(() => heldReads > 0, 'a concurrent keys read while the departure response is delayed');
      // Another departure can be refused while the successful leave's answer is still in flight.
      expect(await code(p.handOff(k.ticket.identity))).toBe('forbidden');
      releaseRead();
      await p.refresh({ call: false, log: true });
      expect(recoveries, 'a deliberate departure never automatically asks to come back').toBe(0);
      expect((await board(k)).timer).toMatchObject({ length: 600, canStop: true });
      expect(await refusal(l.stopTimer())).toEqual(cantRead);
    } finally {
      releaseRead();
      releaseDeparture();
      await leaving;
    }
    await k.stopTimer();
    await k.leave();
  });

  it('lets anyone who can edit the board stop the timer, or start it over, until one of them is back', async () => {
    const { code: c, host, k, p, l, priya } = await savedBoardCall();
    await p.startTimer(10);
    const notYours = { code: 'forbidden', status: 403, message: 'Only whoever started the timer, or the organizer, can stop it.' };
    const running = { code: 'conflict', status: 409, message: 'A timer is running. Whoever started it, or the organizer, can stop it.' };
    // The organizer goes, and Priya, who started it, is still here: it's hers.
    await organizerLeaves(host, k);
    expect((await board(k)).timer?.canStop).toBe(false);
    expect(await refusal(k.stopTimer())).toEqual(notYours);
    expect(await refusal(k.startTimer(3))).toEqual(running);
    // Priya goes too: anyone who can edit the board can stop it now, and nobody who can only read it.
    await p.leave();
    expect((await board(k)).timer).toMatchObject({ length: 600, canStop: true });
    expect((await board(l)).timer?.canStop).toBe(false);
    expect(await refusal(l.stopTimer())).toEqual(cantRead);
    // Back after a reload, it's Priya's again.
    const p2 = await invited(k, c, priya, p.ticket.pass);
    expect((await board(k)).timer?.canStop).toBe(false);
    expect(await refusal(k.stopTimer())).toEqual(notYours);
    expect((await board(p2)).timer?.canStop).toBe(true);
    // Gone again: Kofi starts it over, so the new one is his, and stops it.
    await p2.leave();
    await k.startTimer(3);
    expect((await board(k)).timer).toMatchObject({ length: 180, canStop: true });
    expect((await board(l)).timer).toMatchObject({ length: 180, canStop: false });
    await k.stopTimer();
    expect((await board(l)).timer).toBeNull();
    await k.leave();
  });

  it('lets anyone who can edit the board end the vote and clear it, until one of them is back', async () => {
    const { code: c, host, k, p, l, priya, b } = await savedBoardCall();
    await p.startVote(b.fix, 3);
    await k.castVote(b.s1);
    const notYours = { code: 'forbidden', status: 403, message: 'Only whoever started the vote, or the organizer, can end it.' };
    // Priya, who started it, goes, and the organizer is still here: it's not Kofi's to end.
    await p.leave();
    expect((await board(k)).vote?.canEnd).toBe(false);
    expect(await refusal(k.endVote())).toEqual(notYours);
    // With the organizer gone as well, Kofi can end it, and Lena, who can only read the board, can't.
    await organizerLeaves(host, k);
    expect((await board(k)).vote?.canEnd).toBe(true);
    expect((await board(l)).vote?.canEnd).toBe(false);
    expect(await refusal(l.endVote())).toEqual(cantRead);
    // Priya back: hers again.
    const p2 = await invited(k, c, priya, p.ticket.pass);
    expect((await board(k)).vote?.canEnd).toBe(false);
    expect(await refusal(k.endVote())).toEqual(notYours);
    expect((await board(p2)).vote).toMatchObject({ on: true, canEnd: true });
    // Gone again: Kofi ends it, everyone gets the counts, and Kofi clears it.
    await p2.leave();
    await k.endVote();
    expect((await board(l)).vote).toMatchObject({ on: false, results: { [b.s1]: 1 }, voters: 1, canEnd: false });
    expect((await board(k)).vote?.canEnd).toBe(true);
    expect(await refusal(l.clearVote())).toEqual(cantRead);
    await k.clearVote();
    expect((await board(l)).vote).toBeNull();
    await k.leave();
  });
});

describe('what a session leaves on the board', () => {
  it('writes nothing to the board’s log from a timer starting, through a vote, to its results being cleared', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, [kofi.email]);
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'retro' });
    const open = host.getSnapshot().board.open;
    const b = await retro(art, open);
    // Everyone's browser has stopped writing, so from here on the board's log only moves if something writes to it.
    b.page.close();
    await rest(500);
    const next = () => count('SELECT next_seq::int AS n FROM documents WHERE document_id = $1', [open?.documentId ?? '']);
    const before = await next();
    expect(before).toBeGreaterThan(0);
    await k.startTimer(5);
    await host.startVote(b.fix, 3);
    await k.castVote(b.s1);
    await host.castVote(b.s2);
    await k.takeBackVote(b.s1);
    await k.castVote(b.s3);
    await host.endVote();
    await host.clearVote();
    await k.stopTimer();
    await rest(500);
    expect(await next()).toBe(before);
    await host.leave();
  });
});

describe('what the previous release stored', () => {
  it('still opens: a board open with no timer or vote, which then takes both and keeps them in the new shape', async () => {
    const art = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(art, [kofi.email]);
    const k = await invited(host, c, kofi);
    await host.openBoard({ template: 'retro' });
    const b = await retro(art, host.getSnapshot().board.open);
    const { callId } = host.ticket;
    // Sealed as the release before this one sealed it: an open board with only where it is and who opened it.
    const before = await storedCall(art.ownerId, callId);
    const boards = OpenStored.parse(before.state['board']);
    expect(boards.open.main).toMatchObject({ timer: null, vote: null });
    const { timer: _t, vote: _v, ...older } = boards.open.main;
    await before.put({ ...before.state, board: { ...boards, open: { main: older } } });
    expect(Object.keys(OpenStored.parse((await storedCall(art.ownerId, callId)).state['board']).open.main).sort()).toEqual(['by', 'documentId', 'workspaceId']);

    expect(await board(k)).toMatchObject({ open: { role: 'edit' }, timer: null, vote: null });
    await k.startTimer(3);
    await k.startVote(b.fix, 3);
    await k.castVote(b.s1);
    expect(await board(host)).toMatchObject({ timer: { length: 180, canStop: true }, vote: { on: true, mine: [] } });
    // From then on it's stored in the new shape.
    const after = OpenStored.parse((await storedCall(art.ownerId, callId)).state['board']).open.main;
    expect(after).toMatchObject({ timer: { length: 180 }, vote: { frame: b.fix, per: 3, ended: false } });
    await host.leave();
  });
});
