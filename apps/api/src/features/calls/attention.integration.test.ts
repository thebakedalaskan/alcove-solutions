/** Attention flows through the real browser client, API, Postgres and object store. */
import { AlcoveApiError, CALL_TOPIC, CallChangedSchema, CallStateSchema, type CallSession } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from '../../crypto';
import { openOwner } from '../../owners';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';
import { startHarness, type Browser, type Harness } from '../../testing/harness';

vi.setConfig({ testTimeout: 90_000 });
let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const connected: TestParticipant[] = [];
afterEach(async () => { await Promise.all(connected.splice(0).map((p) => p.disconnect())); h.closeCalls(); });
let sequence = 0;
async function account() {
  const browser = h.browser();
  const { session } = await browser.api.auth.signIn('sso', { email: `attention.${Date.now()}.${sequence++}@tests.example` });
  return { ...browser, email: session.user.email, ownerId: session.ownerId };
}
async function ready(call: CallSession) {
  const until = Date.now() + 15000;
  while (call.crypto.getSnapshot().status !== 'in' && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  expect(call.crypto.getSnapshot().status).toBe('in');
}
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 15000;
  while (!(await check()) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  expect(await check()).toBe(true);
}
const read = async (call: CallSession) => { await call.refresh(); return call.getSnapshot(); };
const failure = (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => e instanceof AlcoveApiError ? e.code : 'unexpected');
async function start() {
  const organizer = await account();
  const { code } = await organizer.api.calls.startNow({ notes: 'off' });
  const host = await organizer.api.calls.join(code, { mic: false, cam: false });
  await ready(host);
  return { organizer, code, host };
}
async function enter(host: CallSession, code: string, browser: Browser = h.browser()) {
  const call = await browser.api.calls.join(code, { mic: false, cam: false, name: 'Casey Guest' });
  await host.refresh();
  await host.admit(call.ticket.identity);
  await ready(call);
  return { browser, call };
}


/**
 * A call's sealed state or attention as the server keeps it, opened with the organizer's keys: to read, or to write as an earlier
 * release did. Upgrade and elapsed-time fixtures still enter and read through the real authenticated API.
 */
async function sealedRecord(ownerId: string, callId: string, kind: 'call-state' | 'call-attention') {
  const owner = await openOwner(h.deps, ownerId, undefined);
  const key = stateKey(owner.root, ownerId, `${kind === 'call-state' ? 'call' : 'call-attention'}:${callId}`);
  const header = { v: 1, kind, ownerId, callId } as const;
  const sql = kind === 'call-state' ? 'SELECT state_ciphertext AS ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2' : 'SELECT ciphertext FROM call_attention WHERE owner_id = $1 AND call_id = $2';
  const row = z.object({ ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query(sql, [ownerId, callId])).rows[0]);
  const record = openJson(key, header, row.ciphertext, z.record(z.string(), z.unknown()));
  const write = async (next: Record<string, unknown>) => {
    await h.pool.query(kind === 'call-state' ? 'UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2' : 'UPDATE call_attention SET ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, sealJson(key, header, toJson(next))]);
  };
  return { record, write };
}
async function rewriteRecord(ownerId: string, callId: string, kind: 'call-state' | 'call-attention', change: (value: Record<string, unknown>) => Record<string, unknown>) {
  const { record, write } = await sealedRecord(ownerId, callId, kind);
  await write(change(record));
}
/** The call's attention record as it's sealed now, opened with the organizer's keys. Reading it changes nothing. */
const kept = async (ownerId: string, callId: string): Promise<Record<string, unknown>> => (await sealedRecord(ownerId, callId, 'call-attention')).record;
/** The questions in the call's sealed attention, as kept. */
const keptQuestions = async (ownerId: string, callId: string) =>
  z.object({ questions: z.array(z.object({ id: z.string(), identity: z.string(), text: z.string() }).loose()) }).parse(await kept(ownerId, callId)).questions;

describe('nudges and status', () => {
  /** Someone let in from the link under their own name. */
  async function guest(host: CallSession, code: string, name: string) {
    const browser = h.browser();
    const call = await browser.api.calls.join(code, { mic: false, cam: false, name });
    await host.refresh();
    await host.admit(call.ticket.identity);
    await ready(call);
    return { browser, call };
  }
  const statusOf = async (viewer: CallSession, who: CallSession) => (await read(viewer)).participants.find((p) => p.id === who.ticket.identity)?.status;

  it('tells only the person pushed, as one note however many send it, and a repeat from the same sender changes nothing', async () => {
    const { host, code, organizer } = await start();
    const kofi = await guest(host, code, 'Kofi Asante');
    const maya = await guest(host, code, 'Maya Lindqvist');
    const diego = await guest(host, code, 'Diego Ferraz');
    await kofi.call.nudge(maya.call.ticket.identity, 'cant-hear');
    const first = (await read(maya.call)).attention.nudges;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'cant-hear', count: 1, from: { name: 'Kofi Asante' } });
    // Nobody else is told: not whoever sent it, not anyone else in the room, not whoever hosts.
    for (const other of [host, kofi.call, diego.call]) expect((await read(other)).attention.nudges).toEqual([]);
    await kofi.call.nudge(maya.call.ticket.identity, 'cant-hear');
    expect((await read(maya.call)).attention.nudges).toEqual(first);
    await diego.call.nudge(maya.call.ticket.identity, 'cant-hear');
    await host.nudge(maya.call.ticket.identity, 'cant-hear');
    const counted = (await read(maya.call)).attention.nudges;
    expect(counted).toHaveLength(1);
    expect(counted[0]).toMatchObject({ id: first[0]?.id, kind: 'cant-hear', count: 3, from: null });
    // Another kind is a note of its own.
    await kofi.call.nudge(maya.call.ticket.identity, 'slow-down');
    expect((await read(maya.call)).attention.nudges.map((n) => n.kind).sort()).toEqual(['cant-hear', 'slow-down']);
    // A minute on, the notes go, and the same nudge starts a new one.
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-attention', (value) => {
      const old = z.object({ nudges: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, nudges: old.nudges.map((x) => ({ ...x, at: Date.now() - 61_000, last: Date.now() - 61_000 })) };
    });
    expect((await read(maya.call)).attention.nudges).toEqual([]);
    await diego.call.nudge(maya.call.ticket.identity, 'cant-hear');
    const again = (await read(maya.call)).attention.nudges;
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ kind: 'cant-hear', count: 1, from: { name: 'Diego Ferraz' } });
    expect(again[0]?.id).not.toBe(first[0]?.id);
    // Sealed at rest, and never said in a log.
    const sealed = await h.pool.query<{ ciphertext: Buffer }>('SELECT ciphertext FROM call_attention WHERE owner_id = $1 AND call_id = $2', [organizer.ownerId, host.ticket.callId]);
    expect(sealed.rows[0]?.ciphertext.toString('utf8')).not.toContain('cant-hear');
    expect(JSON.stringify(h.logs)).not.toContain('cant-hear');
    expect(JSON.stringify(h.logs)).not.toContain('Maya Lindqvist');
    // Leaving on purpose takes what you were sent with you.
    await maya.call.leave();
    expect((await kept(organizer.ownerId, host.ticket.callId))['nudges']).toEqual([]);
    await host.leave();
  });

  it('refuses a nudge from anyone not in the call, to anyone not in their room, to yourself, and across calls', async () => {
    const first = await start();
    const second = await start();
    const peer = await enter(first.host, first.code);
    const waiting = await h.browser().api.calls.join(first.code, { mic: false, cam: false, name: 'Waiting Guest' });
    expect(await failure(waiting.nudge(first.host.ticket.identity, 'muted'))).toBe('forbidden');
    waiting.close();
    expect(await failure(peer.call.nudge(second.host.ticket.identity, 'muted'))).toBe('conflict');
    expect(await failure(peer.call.nudge(peer.call.ticket.identity, 'muted'))).toBe('conflict');
    // One call's pass opens nothing in another, so its people can't be nudged from there.
    const crossed = await peer.browser.fetch(`${h.baseUrl}/v1/live/calls/${second.host.ticket.callId}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': peer.call.ticket.pass },
      body: JSON.stringify({ type: 'nudge', place: 'main', to: second.host.ticket.identity, kind: 'muted' })
    });
    expect(crossed.status).toBe(401);
    expect((await read(second.host)).attention.nudges).toEqual([]);
    expect((await read(first.host)).attention.nudges).toEqual([]);
    await first.host.leave(); await second.host.leave();
  });

  it('limits nudges to 20 and status changes to 30 a minute for each person, apart from anyone else', async () => {
    const { host, code } = await start();
    const kofi = await guest(host, code, 'Kofi Asante');
    const maya = await guest(host, code, 'Maya Lindqvist');
    const nudges: string[] = [];
    for (let i = 0; i < 21; i++) nudges.push(await failure(kofi.call.nudge(maya.call.ticket.identity, 'cant-hear')));
    expect(nudges.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => 'allowed'));
    expect(nudges[20]).toBe('unavailable');
    expect(await failure(host.nudge(maya.call.ticket.identity, 'cant-hear'))).toBe('allowed');
    const statuses: string[] = [];
    for (let i = 0; i < 31; i++) statuses.push(await failure(maya.call.setStatus(i % 2 ? 'away' : 'phone')));
    expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 'allowed'));
    expect(statuses[30]).toBe('unavailable');
    expect(await failure(kofi.call.setStatus('listening'))).toBe('allowed');
    // What was refused changed nothing: the last status Maya was let set (away) stands, and the note still counts two people.
    expect(await statusOf(host, maya.call)).toMatchObject({ kind: 'away' });
    expect((await read(maya.call)).attention.nudges).toMatchObject([{ kind: 'cant-hear', count: 2 }]);
    await host.leave();
  });

  it('keeps every nudge and status sent at the same moment', async () => {
    const { host, code } = await start();
    const kofi = await guest(host, code, 'Kofi Asante');
    const maya = await guest(host, code, 'Maya Lindqvist');
    const diego = await guest(host, code, 'Diego Ferraz');
    await Promise.all([
      kofi.call.nudge(maya.call.ticket.identity, 'cant-hear'), diego.call.nudge(maya.call.ticket.identity, 'cant-hear'), host.nudge(maya.call.ticket.identity, 'muted'),
      maya.call.setStatus('listening'), kofi.call.setStatus('phone', 5), diego.call.nudge(kofi.call.ticket.identity, 'louder')
    ]);
    expect((await read(maya.call)).attention.nudges.map((n) => `${n.kind} ${n.count}`).sort()).toEqual(['cant-hear 2', 'muted 1']);
    expect((await read(kofi.call)).attention.nudges.map((n) => `${n.kind} ${n.count}`)).toEqual(['louder 1']);
    expect(await statusOf(diego.call, maya.call)).toMatchObject({ kind: 'listening', until: null });
    expect(await statusOf(diego.call, kofi.call)).toMatchObject({ kind: 'phone' });
    await host.leave();
  });

  it('tells only the browser of whoever was nudged to read the call again', async () => {
    const { host, code } = await start();
    const kofi = await guest(host, code, 'Kofi Asante');
    const maya = await guest(host, code, 'Maya Lindqvist');
    const diego = await guest(host, code, 'Diego Ferraz');
    const mayaRoom = await connect(await maya.call.room());
    const diegoRoom = await connect(await diego.call.room());
    connected.push(mayaRoom, diegoRoom);
    // The server's pushes that say only the call changed, as a nudge's and a status's do; keys and admissions change its log too.
    const told = (room: TestParticipant) => room.received(CALL_TOPIC).filter((d) => {
      const sent: unknown = JSON.parse(new TextDecoder().decode(d.payload));
      const push = CallChangedSchema.safeParse(sent);
      return d.from === null && push.success && push.data.call && !push.data.log;
    }).length;
    const before = { maya: told(mayaRoom), diego: told(diegoRoom) };
    await kofi.call.nudge(maya.call.ticket.identity, 'louder');
    await mayaRoom.waitFor(() => told(mayaRoom) > before.maya, 'Maya’s browser told of the nudge');
    // Then something everyone sees, which every browser is told of. The pushes come in order, so had Diego's been told of the
    // nudge, that would have come first.
    await kofi.call.setStatus('away');
    await diegoRoom.waitFor(() => told(diegoRoom) > before.diego, 'Diego’s browser told of the status');
    await mayaRoom.waitFor(() => told(mayaRoom) > before.maya + 1, 'Maya’s browser told of the status');
    expect(told(diegoRoom) - before.diego).toBe(1);
    expect(told(mayaRoom) - before.maya).toBe(2);
    await host.leave();
  });

  it('lets a status and nudges go once their owner’s connection has dropped and stayed away', async () => {
    const { host, code, organizer } = await start();
    const kofi = await guest(host, code, 'Kofi Asante');
    const maya = await guest(host, code, 'Maya Lindqvist');
    await maya.call.setStatus('listening');
    await kofi.call.nudge(maya.call.ticket.identity, 'slow-down');
    // Maya's connection drops without her leaving: LiveKit's word that she went, long enough ago that a reload would be back.
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-state', (value) => {
      const old = z.object({ people: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, people: old.people.map((p) => (p['identity'] === maya.call.ticket.identity ? { ...p, status: 'left', left: Date.now() - 121_000 } : p)) };
    });
    // The next change to the call lets them go from what's kept, and Maya coming back later finds neither.
    await kofi.call.setStatus('phone');
    const sealed = await kept(organizer.ownerId, host.ticket.callId);
    expect(sealed['nudges']).toEqual([]);
    expect(z.object({ statuses: z.array(z.object({ kind: z.string() }).loose()) }).parse(sealed).statuses.map((x) => x.kind)).toEqual(['phone']);
    await host.leave();
  });

  it('shows your status to everyone in the call until it runs out or you clear it, through a reload', async () => {
    const { host, code, organizer } = await start();
    const peer = await enter(host, code);
    await peer.call.setStatus('away', 5);
    const seen = await statusOf(host, peer.call);
    expect(seen).toMatchObject({ kind: 'away' });
    expect(Date.parse(seen?.until ?? '') - Date.parse(seen?.since ?? '')).toBe(5 * 60_000);
    expect(await statusOf(peer.call, peer.call)).toEqual(seen);
    // Another status keeps the time already set; a new time starts again from now.
    await peer.call.setStatus('phone');
    expect(await statusOf(host, peer.call)).toEqual({ ...seen, kind: 'phone' });
    await peer.call.setStatus(null);
    expect(await statusOf(host, peer.call)).toBeNull();
    await peer.call.setStatus('listening');
    expect(await statusOf(host, peer.call)).toMatchObject({ kind: 'listening', until: null });
    const back = await peer.browser.api.calls.join(code, { mic: false, cam: false, previous: peer.call.ticket.pass, name: 'Casey Guest' });
    peer.call.close();
    await ready(back);
    expect(await statusOf(host, back)).toMatchObject({ kind: 'listening', until: null });
    // Its time runs out on the server's clock.
    await back.setStatus('away', 2);
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-attention', (value) => {
      const old = z.object({ statuses: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, statuses: old.statuses.map((x) => ({ ...x, until: Date.now() - 1 })) };
    });
    expect(await statusOf(host, back)).toBeNull();
    // Someone not let in has no status to set.
    const waiting = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Waiting Guest' });
    expect(await failure(waiting.setStatus('away', 2))).toBe('forbidden');
    waiting.close();
    // Leaving on purpose takes it with you.
    await back.setStatus('phone');
    expect(await statusOf(host, back)).toMatchObject({ kind: 'phone' });
    await back.leave();
    expect((await kept(organizer.ownerId, host.ticket.callId))['statuses']).toEqual([]);
    await host.leave();
  });

  it('opens attention sealed by the previous release, with its feedback, and saves it in the new shape', async () => {
    const { host, code, organizer } = await start();
    const peer = await enter(host, code);
    await peer.call.setHand(true);
    // As the previous release sealed it: with its quiet signals, and no nudges or statuses.
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-attention', (value) => ({
      ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'nudges' && key !== 'statuses')),
      signals: [{ place: 'main', readers: ['organizer'], identity: peer.call.ticket.identity, reader: 'previous', placedAt: Date.now(), kind: 'need-break', until: Date.now() + 15_000 }]
    }));
    const before = await read(host);
    expect(before.attention.hands).toHaveLength(1);
    expect(before.attention.nudges).toEqual([]);
    expect(before.participants.map((p) => p.status)).toEqual([null, null]);
    await peer.call.setStatus('away');
    await peer.call.nudge(host.ticket.identity, 'muted');
    const after = await read(host);
    expect(after.attention.hands).toEqual(before.attention.hands);
    expect(after.attention.nudges).toHaveLength(1);
    expect(await statusOf(host, peer.call)).toMatchObject({ kind: 'away', until: null });
    // An empty `signals` stays in what's saved, so the previous release, still serving during a deploy, can open it.
    const saved = await kept(organizer.ownerId, host.ticket.callId);
    expect(Object.keys(saved).sort()).toEqual(['cues', 'hands', 'latest', 'nudges', 'questions', 'signals', 'statuses']);
    expect(saved['signals']).toEqual([]);
    // What went with Attention is refused now.
    for (const gone of [{ type: 'hands-clear', place: 'main' }, { type: 'feedback', place: 'main', kind: 'yes' }]) {
      const refused = await organizer.fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/actions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': host.ticket.pass }, body: JSON.stringify(gone)
      });
      expect(refused.status).toBe(400);
    }
    expect((await read(host)).attention.hands).toHaveLength(1);
    await host.leave();
  });
});

describe('call attention', () => {
  it('orders persistent hands, makes repeated raises idempotent, and protects new raises from stale host actions', async () => {
    const { host, code } = await start();
    const first = await enter(host, code);
    const second = await enter(host, code);
    await first.call.setHand(true);
    await second.call.setHand(true);
    const initial = (await read(host)).attention.hands;
    expect(initial.map((x) => x.participantId)).toEqual([first.call.ticket.identity, second.call.ticket.identity]);
    const entry = initial[0];
    if (!entry) throw new Error('No hand entry');
    await first.call.setHand(true);
    expect((await read(host)).attention.hands).toEqual(initial);
    const resumed = await first.browser.api.calls.join(code, { mic: false, cam: false, previous: first.call.ticket.pass, name: 'Casey Guest' });
    first.call.close();
    await ready(resumed);
    expect((await read(host)).attention.hands[0]).toMatchObject({ id: entry.id, participantId: resumed.ticket.identity, seat: entry.seat, raisedAt: entry.raisedAt });
    expect(await failure(second.call.lowerHand(entry.id))).toBe('forbidden');
    await host.lowerHand(entry.id);
    await resumed.setHand(true);
    await host.lowerHand(entry.id);
    const raised = (await read(host)).attention.hands;
    expect(raised).toHaveLength(2);
    for (const hand of raised) await host.lowerHand(hand.id);
    expect((await read(host)).attention.hands).toEqual([]);
    await host.leave();
  });

  it('keeps Q&A separate, deduplicates retries and account votes, enforces moderation, and seals content', async () => {
    const { host, code, organizer } = await start();
    const voter = await account();
    const first = await enter(host, code, voter);
    const second = await enter(host, code, voter);
    const id = 'question_attention_001';
    const canary = 'QA_PRIVATE_CANARY_RIVERMOUTH_94726';
    await first.call.postQuestion(id, canary);
    await first.call.postQuestion(id, canary);
    await Promise.all([first.call.voteQuestion(id, true), second.call.voteQuestion(id, true)]);
    expect((await read(host)).attention.questions).toHaveLength(1);
    expect((await read(host)).attention.questions[0]).toMatchObject({ id, text: canary, votes: 1, pinned: false, status: 'open' });
    expect((await read(second.call)).attention.questions[0]).toMatchObject({ voted: true, own: true });
    expect(await failure(first.call.resolveQuestion(id, 'answered'))).toBe('forbidden');
    await host.pinQuestion(id);
    await host.resolveQuestion(id, 'answered');
    expect((await read(first.call)).attention.questions[0]).toMatchObject({ status: 'answered', pinned: false });
    // Answered by mistake: it takes no votes while it's closed, and whoever hosts reopens it, nobody else. Its votes are as they were, and it takes them again.
    expect(await failure(second.call.voteQuestion(id, false))).toBe('conflict');
    expect(await failure(first.call.resolveQuestion(id, 'open'))).toBe('forbidden');
    await host.resolveQuestion(id, 'open');
    expect((await read(first.call)).attention.questions[0]).toMatchObject({ status: 'open', votes: 1, voted: true });
    await second.call.voteQuestion(id, false);
    expect((await read(host)).attention.questions[0]).toMatchObject({ status: 'open', votes: 0 });
    await first.call.voteQuestion(id, true);
    // Dismissed, it comes back the same way.
    await host.resolveQuestion(id, 'dismissed');
    expect(await failure(second.call.resolveQuestion(id, 'open'))).toBe('forbidden');
    await host.resolveQuestion(id, 'open');
    expect((await read(second.call)).attention.questions[0]).toMatchObject({ status: 'open', votes: 1, voted: true, pinned: false });
    const sealed = await h.pool.query<{ ciphertext: Buffer }>('SELECT ciphertext FROM call_attention WHERE owner_id = $1 AND call_id = $2', [organizer.ownerId, host.ticket.callId]);
    expect(sealed.rows).toHaveLength(1);
    expect(sealed.rows[0]?.ciphertext.toString('utf8')).not.toContain(canary);
    expect(JSON.stringify(h.logs)).not.toContain(canary);
    await host.leave();
    expect((await h.pool.query('SELECT 1 FROM call_attention WHERE owner_id = $1 AND call_id = $2', [organizer.ownerId, host.ticket.callId])).rowCount).toBe(0);
  });

  it('never says who asked an anonymous question, the host included, while its asker still sees and takes back their own', async () => {
    const { host, code, organizer } = await start();
    const asker = await account();
    const reader = await account();
    // Signed in, so their address is something the call could say.
    const first = await enter(host, code, asker);
    const other = await enter(host, code, reader);
    const id = 'question_anonymous_001';
    const canary = 'ANONYMOUS_QA_CANARY_LIGHTHOUSE_51093';
    await first.call.postQuestion(id, canary, true);
    await first.call.postQuestion(id, canary, true);
    expect(await failure(first.call.postQuestion(id, canary, false))).toBe('conflict');
    await other.call.postQuestion('question_named_001', 'A named question', false);
    // Whoever hosts and everyone else get the words and the votes, and nothing of who asked.
    for (const call of [host, other.call]) {
      const asked = (await read(call)).attention.questions.find((q) => q.id === id);
      expect(asked).toMatchObject({ id, text: canary, author: null, own: false, status: 'open' });
    }
    const named = (await read(host)).attention.questions.find((q) => q.id === 'question_named_001');
    expect(named?.author).not.toBeNull();
    expect(JSON.stringify(host.getSnapshot().attention)).not.toContain(asker.email);
    // What the host's browser is sent, before any client reads it: the question has no author at all.
    const raw = await organizer.fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}`, { headers: { 'x-alcove-call': host.ticket.pass } });
    const sent = z.object({ attention: z.object({ questions: z.array(z.object({ id: z.string(), author: z.unknown() })) }) }).parse(await raw.json());
    expect(sent.attention.questions.find((q) => q.id === id)?.author).toBeNull();
    // The asker is told it's theirs, and the question still says nobody's name, to them too.
    expect((await read(first.call)).attention.questions.find((q) => q.id === id)).toMatchObject({ author: null, own: true });
    // Votes and moderation work as for any question.
    await other.call.voteQuestion(id, true);
    await host.pinQuestion(id);
    expect((await read(first.call)).attention.questions.find((q) => q.id === id)).toMatchObject({ votes: 1, pinned: true, author: null });
    await host.resolveQuestion(id, 'answered');
    expect((await read(other.call)).attention.questions.find((q) => q.id === id)).toMatchObject({ status: 'answered', pinned: false, author: null });
    // Only whoever asked takes it back, and then it goes for everyone.
    expect(await failure(other.call.withdrawQuestion(id))).toBe('forbidden');
    expect(await failure(host.withdrawQuestion(id))).toBe('forbidden');
    await first.call.withdrawQuestion(id);
    for (const call of [host, first.call, other.call]) expect((await read(call)).attention.questions.some((q) => q.id === id)).toBe(false);
    expect(await failure(first.call.withdrawQuestion(id))).toBe('not-found');
    expect(await failure(other.call.voteQuestion(id, true))).toBe('not-found');
    // Taken back, it's gone from the sealed record itself, not only from what anyone reads.
    expect(JSON.stringify(await kept(organizer.ownerId, host.ticket.callId))).not.toContain(canary);
    expect((await keptQuestions(organizer.ownerId, host.ticket.callId)).map((q) => q.id)).toEqual(['question_named_001']);
    const sealed = await h.pool.query<{ ciphertext: Buffer }>('SELECT ciphertext FROM call_attention WHERE owner_id = $1 AND call_id = $2', [organizer.ownerId, host.ticket.callId]);
    expect(sealed.rows[0]?.ciphertext.toString('utf8')).not.toContain(canary);
    expect(JSON.stringify(h.logs)).not.toContain(canary);
    await host.leave();
  });

  it('keeps nothing that says who asked an anonymous question, so the previous release saving it names nobody either', async () => {
    const { host, code, organizer } = await start();
    const asker = await account();
    const other = await enter(host, code);
    const first = await enter(host, code, asker);
    const id = 'question_anonymous_rollback_001';
    await first.call.postQuestion(id, 'Asked without a name', true);
    // The sealed record has no connection, name or address of whoever asked: only the asker's vote says it's theirs.
    const stored = (await keptQuestions(organizer.ownerId, host.ticket.callId)).find((q) => q.id === id);
    const everyone = (await read(host)).participants.map((p) => p.id);
    expect(everyone).toContain(first.call.ticket.identity);
    expect(everyone).not.toContain(stored?.identity);
    expect(JSON.stringify(await kept(organizer.ownerId, host.ticket.callId))).not.toContain(first.call.ticket.identity);
    expect(JSON.stringify(await kept(organizer.ownerId, host.ticket.callId))).not.toContain(asker.email);
    // As the previous release saves it, still serving during a deploy or after a rollback: it doesn't know `anonymous` and drops
    // it, knows nothing of nudges or statuses, and keeps its own quiet signals.
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-attention', (value) => {
      const old = z.object({ questions: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return {
        ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'nudges' && key !== 'statuses')), signals: [],
        questions: old.questions.map((q) => Object.fromEntries(Object.entries(q).filter(([key]) => key !== 'anonymous')))
      };
    });
    for (const call of [host, other.call]) expect((await read(call)).attention.questions.find((q) => q.id === id)).toMatchObject({ author: null, own: false });
    expect((await read(first.call)).attention.questions.find((q) => q.id === id)).toMatchObject({ author: null, own: true });
    // The next save keeps it anonymous, and only whoever asked can take it back.
    await other.call.voteQuestion(id, true);
    expect((await keptQuestions(organizer.ownerId, host.ticket.callId)).find((q) => q.id === id)).toMatchObject({ anonymous: true });
    expect((await read(host)).attention.questions.find((q) => q.id === id)).toMatchObject({ author: null, votes: 1 });
    expect(await failure(other.call.withdrawQuestion(id))).toBe('forbidden');
    await first.call.withdrawQuestion(id);
    expect(JSON.stringify(await kept(organizer.ownerId, host.ticket.callId))).not.toContain('Asked without a name');
    await host.leave();
  });

  it('takes back a named question only in its own call and room, and opens questions stored before anonymity as named', async () => {
    const first = await start();
    const second = await start();
    await first.host.postQuestion('question_withdraw_other_call_001', 'Only the first call can take this back');
    expect(await failure(second.host.withdrawQuestion('question_withdraw_other_call_001'))).toBe('not-found');
    expect((await read(first.host)).attention.questions.map((q) => q.id)).toContain('question_withdraw_other_call_001');
    const stale = await second.organizer.fetch(`${h.baseUrl}/v1/live/calls/${second.host.ticket.callId}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': second.host.ticket.pass },
      body: JSON.stringify({ type: 'question-withdraw', id: 'question_withdraw_other_call_001', place: 'room_that_is_not_current' })
    });
    expect(stale.status).toBe(409);
    // A record from the release before anonymous questions has no `anonymous`: it reads as a named question.
    const peer = await enter(first.host, first.code);
    await peer.call.postQuestion('question_before_anonymity_001', 'Written before anonymity existed');
    await rewriteRecord(first.organizer.ownerId, first.host.ticket.callId, 'call-attention', (value) => {
      const old = z.object({ questions: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, questions: old.questions.map((q) => Object.fromEntries(Object.entries(q).filter(([key]) => key !== 'anonymous'))) };
    });
    const upgraded = (await read(first.host)).attention.questions.find((q) => q.id === 'question_before_anonymity_001');
    expect(upgraded?.author?.name).toBe('Casey Guest');
    expect((await read(peer.call)).attention.questions.find((q) => q.id === 'question_before_anonymity_001')).toMatchObject({ own: true });
    await peer.call.withdrawQuestion('question_before_anonymity_001');
    expect((await read(first.host)).attention.questions.some((q) => q.id === 'question_before_anonymity_001')).toBe(false);
    await first.host.withdrawQuestion('question_withdraw_other_call_001');
    expect((await read(first.host)).attention.questions).toEqual([]);
    await first.host.leave(); await second.host.leave();
  });

  it('keeps nudge and question audiences inside their room, including later arrivals and moderator visits', async () => {
    const organizer = await account();
    const peer = await account();
    const outsider = await account();
    const { code } = await organizer.api.calls.startNow({ notes: 'off', guests: [peer.email, outsider.email] });
    const host = await organizer.api.calls.join(code, { mic: false, cam: false });
    await ready(host);
    const a = await peer.api.calls.join(code, { mic: false, cam: false });
    const b = await outsider.api.calls.join(code, { mic: false, cam: false });
    await ready(a); await ready(b);
    host.openRooms({ rooms: [{ name: 'North', emails: [peer.email] }, { name: 'South', emails: [outsider.email] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    await until(async () => (await read(host)).breakouts.open !== null);
    const north = (await read(host)).breakouts.open?.rooms.find((x) => x.name === 'North');
    if (!north) throw new Error('No room');
    await until(async () => (await read(a)).attention.place === north.id);
    await a.setHand(true);
    const help = (await read(host)).attention.hands.find((hand) => hand.participantId === a.ticket.identity);
    if (!help) throw new Error('Host did not see the room hand');
    const waiting = await h.browser().api.calls.join(code, { mic: false, cam: false, name: 'Waiting Guest' });
    expect((await read(host)).attention.cues.some((cue) => cue.kind === 'admission')).toBe(true);
    const passOnlyResponse = await h.browser().fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}`, { headers: { 'x-alcove-call': host.ticket.pass } });
    expect(passOnlyResponse.status).toBe(200);
    const passOnly = CallStateSchema.parse(await passOnlyResponse.json());
    expect(passOnly.isHost).toBe(false);
    expect(passOnly.attention.hands).toEqual([]);
    expect(passOnly.attention.cues.some((cue) => cue.kind === 'admission' || cue.kind === 'hand')).toBe(false);
    waiting.close();
    expect((await read(b)).attention.hands).toEqual([]);
    await host.lowerHand(help.id);
    expect((await read(a)).attention.hands).toEqual([]);
    await a.postQuestion('question_room_private_001', 'ROOM_QA_CANARY_38562');
    // Nobody in another room can be nudged: a nudge stays where it's said.
    expect(await failure(a.nudge(b.ticket.identity, 'cant-hear'))).toBe('conflict');
    expect((await read(b)).attention.questions).toEqual([]);
    expect((await read(b)).attention.nudges).toEqual([]);
    host.visitRoom(north.id);
    await until(async () => (await read(host)).attention.place === north.id);
    expect((await read(host)).attention.questions).toEqual([]);
    expect(await failure(host.pinQuestion('question_room_private_001'))).toBe('not-found');
    host.moveToRoom({ email: outsider.email }, north.id);
    await until(async () => (await read(b)).attention.place === north.id);
    expect((await read(b)).attention.questions).toEqual([]);
    expect(await failure(b.voteQuestion('question_room_private_001', true))).toBe('not-found');
    // In the same room now, a nudge reaches them there, and a status is everyone's to see.
    await a.nudge(b.ticket.identity, 'slow-down');
    expect((await read(b)).attention.nudges).toMatchObject([{ kind: 'slow-down', count: 1 }]);
    expect((await read(b)).attention.nudges[0]?.from).not.toBeNull();
    await a.setStatus('away');
    host.closeRooms();
    await until(async () => (await read(a)).attention.place === 'main' && (await read(b)).attention.place === 'main');
    expect((await read(a)).attention.nudges).toEqual([]);
    // The nudge stays in the room it was sent in, so it goes as the rooms close; the status goes wherever its owner does.
    expect((await read(b)).attention.nudges).toEqual([]);
    expect((await read(b)).participants.find((p) => p.id === a.ticket.identity)?.status).toMatchObject({ kind: 'away' });
    await host.leave();
  });
  it('upgrades existing raised hands once, through later attention changes', async () => {
    const { host, code, organizer } = await start();
    const peer = await enter(host, code);
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-state', (value) => {
      const old = z.object({ people: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, people: old.people.map((p) => ({ ...p, hand: p['identity'] === peer.call.ticket.identity })) };
    });
    await h.pool.query('DELETE FROM call_attention WHERE owner_id = $1 AND call_id = $2', [organizer.ownerId, host.ticket.callId]);
    const oldHand = (await read(host)).attention.hands[0];
    expect(oldHand?.participantId).toBe(peer.call.ticket.identity);
    await peer.call.nudge(host.ticket.identity, 'louder');
    expect((await read(host)).attention.hands[0]).toEqual(oldHand);
    expect((await read(host)).attention.nudges).toHaveLength(1);
    await peer.call.leave();
    expect((await read(host)).attention.hands).toEqual([]);
    await host.leave();
  });

  it('rejects cross-call question IDs and a delayed submission after changing rooms', async () => {
    const first = await start();
    const second = await start();
    await first.host.postQuestion('question_other_call_001', 'Only the first call');
    expect(await failure(second.host.voteQuestion('question_other_call_001', true))).toBe('not-found');
    expect(await failure(second.host.pinQuestion('question_other_call_001'))).toBe('not-found');
    const stale = await second.organizer.fetch(`${h.baseUrl}/v1/live/calls/${second.host.ticket.callId}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': second.host.ticket.pass },
      body: JSON.stringify({ type: 'question-post', id: 'question_wrong_place_001', text: 'Still private', place: 'room_that_is_not_current' })
    });
    expect(stale.status).toBe(409);
    expect((await read(second.host)).attention.questions).toEqual([]);
    await first.host.leave(); await second.host.leave();
  });

  it('expires abandoned admission requests and refuses a stale approval', async () => {
    const { host, code, organizer } = await start();
    const browser = h.browser();
    const waiting = await browser.api.calls.join(code, { mic: false, cam: false, name: 'Morgan Guest' });
    waiting.close();
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-state', (value) => {
      const old = z.object({ people: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, people: old.people.map((p) => p['identity'] === waiting.ticket.identity ? { ...p, since: Date.now() - 120000, askedAt: Date.now() - 120000 } : p) };
    });
    expect((await read(host)).waiting.some((p) => p.id === waiting.ticket.identity)).toBe(false);
    const log = await organizer.fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/mls?after=0`, { headers: { 'x-alcove-call': host.ticket.pass } });
    const current = z.object({ generation: z.number(), groups: z.array(z.object({ id: z.string(), epoch: z.number() })) }).parse(await log.json());
    const group = current.groups.find((g) => g.id === 'main');
    if (!group) throw new Error('No main group');
    const staleCommit = await organizer.fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/mls/commits`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': host.ticket.pass },
      body: JSON.stringify({ generation: current.generation, group: 'main', epoch: group.epoch, commit: 'AQ', welcome: 'AQ', added: [waiting.ticket.identity], removed: [] })
    });
    expect(staleCommit.status).toBe(400);
    await host.admit(waiting.ticket.identity);
    expect((await read(host)).participants.some((p) => p.id === waiting.ticket.identity)).toBe(false);
    const denied = await browser.fetch(`${h.baseUrl}/v1/live/calls/${waiting.ticket.callId}/mls?after=0`, { headers: { 'x-alcove-call': waiting.ticket.pass } });
    expect(denied.status).toBe(200);
    expect(await denied.json()).toMatchObject({ admission: 'denied' });
    await host.leave();
  });

  it('keeps one pinned question per room across host handoff without disclosing an earlier audience', async () => {
    const organizer = await account();
    const successor = await account();
    const { code } = await organizer.api.calls.startNow({ notes: 'off', guests: [successor.email] });
    const host = await organizer.api.calls.join(code, { mic: false, cam: false });
    await ready(host);
    await host.postQuestion('question_before_handoff_001', 'Only the original audience');
    await host.pinQuestion('question_before_handoff_001');
    const next = await successor.api.calls.join(code, { mic: false, cam: false });
    await ready(next);
    connected.push(await connect(await next.room()));
    expect((await read(next)).attention.questions).toEqual([]);
    await host.handOff(next.ticket.identity);
    await until(async () => (await read(next)).isHost);
    await next.postQuestion('question_after_handoff_001', 'Only the later audience');
    await next.pinQuestion('question_after_handoff_001');
    expect((await read(next)).attention.questions).toHaveLength(1);
    const back = await organizer.api.calls.join(code, { mic: false, cam: false });
    await ready(back);
    const questions = (await read(back)).attention.questions;
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ id: 'question_before_handoff_001', pinned: false });
    await back.leave();
  });

  it('keeps one admission-bound voter when its pass is sent without a cookie or with another account', async () => {
    const { host, code } = await start();
    const accountVoter = await account();
    const first = await enter(host, code, accountVoter);
    const second = await enter(host, code, accountVoter);
    const id = 'question_stable_voter_001';
    await first.call.postQuestion(id, 'One vote from this person');
    await first.call.voteQuestion(id, true);
    for (const browser of [h.browser(), await account()]) {
      const action = await browser.fetch(`${h.baseUrl}/v1/live/calls/${first.call.ticket.callId}/actions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': first.call.ticket.pass },
        body: JSON.stringify({ type: 'question-vote', place: 'main', id, on: true })
      });
      expect(action.status).toBe(200);
      const snapshot = z.object({ attention: z.object({ questions: z.array(z.object({ id: z.string(), votes: z.number(), voted: z.boolean(), own: z.boolean() })) }) }).parse(await action.json());
      expect(snapshot.attention.questions.find((q) => q.id === id)).toMatchObject({ votes: 1, voted: true, own: true });
    }
    expect((await read(second.call)).attention.questions.find((q) => q.id === id)).toMatchObject({ votes: 1, voted: true, own: true });
    const back = await accountVoter.api.calls.join(code, { mic: false, cam: false, previous: first.call.ticket.pass });
    first.call.close();
    await ready(back);
    expect((await read(back)).attention.questions.find((q) => q.id === id)).toMatchObject({ votes: 1, voted: true, own: true });
    await host.leave();
  });

  it('keeps older sealed participant records on one voter identity across new browsers and reloads', async () => {
    const { host, code, organizer } = await start();
    const voter = await account();
    const first = await enter(host, code, voter);
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-state', (value) => {
      const old = z.object({ people: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, people: old.people.map((p) => Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'attentionPrincipal'))) };
    });
    const otherBrowser = h.browser();
    await otherBrowser.api.auth.signIn('sso', { email: voter.email });
    const second = await otherBrowser.api.calls.join(code, { mic: false, cam: false });
    await ready(second);
    const id = 'question_upgrade_voter_001';
    await first.call.postQuestion(id, 'Still one account');
    await first.call.voteQuestion(id, true);
    await second.voteQuestion(id, true);
    expect((await read(host)).attention.questions.find((q) => q.id === id)?.votes).toBe(1);
    expect((await read(second)).attention.questions.find((q) => q.id === id)).toMatchObject({ voted: true, own: true });
    const back = await voter.api.calls.join(code, { mic: false, cam: false, previous: first.call.ticket.pass });
    first.call.close();
    await ready(back);
    expect((await read(back)).attention.questions.find((q) => q.id === id)).toMatchObject({ votes: 1, voted: true, own: true });
    await host.leave();
  });

});
