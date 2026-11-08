/** Attention flows through the real browser client, API, Postgres and object store. */
import { AlcoveApiError, CallStateSchema, type CallSession } from '@alcove/api';
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


/** Upgrade and elapsed-time fixtures still enter and read through the real authenticated API. */
async function rewriteRecord(ownerId: string, callId: string, kind: 'call-state' | 'call-attention', change: (value: Record<string, unknown>) => Record<string, unknown>) {
  const owner = await openOwner(h.deps, ownerId, undefined);
  const key = stateKey(owner.root, ownerId, `${kind === 'call-state' ? 'call' : 'call-attention'}:${callId}`);
  const header = { v: 1, kind, ownerId, callId } as const;
  const sql = kind === 'call-state' ? 'SELECT state_ciphertext AS ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2' : 'SELECT ciphertext FROM call_attention WHERE owner_id = $1 AND call_id = $2';
  const row = z.object({ ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query(sql, [ownerId, callId])).rows[0]);
  const value = openJson(key, header, row.ciphertext, z.record(z.string(), z.unknown()));
  const ciphertext = sealJson(key, header, toJson(change(value)));
  await h.pool.query(kind === 'call-state' ? 'UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2' : 'UPDATE call_attention SET ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, ciphertext]);
}

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
    expect(await failure(second.call.clearHands())).toBe('forbidden');
    await host.lowerHand(entry.id);
    await resumed.setHand(true);
    await host.lowerHand(entry.id);
    expect((await read(host)).attention.hands).toHaveLength(2);
    await host.clearHands();
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
    const kept = await h.pool.query<{ ciphertext: Buffer }>('SELECT ciphertext FROM call_attention WHERE owner_id = $1 AND call_id = $2', [organizer.ownerId, host.ticket.callId]);
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0]?.ciphertext.toString('utf8')).not.toContain(canary);
    expect(JSON.stringify(h.logs)).not.toContain(canary);
    await host.leave();
    expect((await h.pool.query('SELECT 1 FROM call_attention WHERE owner_id = $1 AND call_id = $2', [organizer.ownerId, host.ticket.callId])).rowCount).toBe(0);
  });

  it('keeps feedback and question audiences inside their room, including later arrivals and moderator visits', async () => {
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
    await a.setFeedback('cant-hear');
    expect((await read(b)).attention.questions).toEqual([]);
    expect((await read(host)).attention.signals).toEqual([]);
    host.visitRoom(north.id);
    await until(async () => (await read(host)).attention.place === north.id);
    expect((await read(host)).attention.questions).toEqual([]);
    expect(await failure(host.pinQuestion('question_room_private_001'))).toBe('not-found');
    host.moveToRoom(outsider.email, north.id);
    await until(async () => (await read(b)).attention.place === north.id);
    expect((await read(b)).attention.questions).toEqual([]);
    expect(await failure(b.voteQuestion('question_room_private_001', true))).toBe('not-found');
    host.closeRooms();
    await until(async () => (await read(a)).attention.place === 'main');
    expect((await read(a)).attention.signals).toEqual([]);
    await host.leave();
  });
  it('upgrades existing raised hands once and expires feedback on the server clock', async () => {
    const { host, code, organizer } = await start();
    const peer = await enter(host, code);
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-state', (value) => {
      const old = z.object({ people: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, people: old.people.map((p) => ({ ...p, hand: p['identity'] === peer.call.ticket.identity })) };
    });
    await h.pool.query('DELETE FROM call_attention WHERE owner_id = $1 AND call_id = $2', [organizer.ownerId, host.ticket.callId]);
    const oldHand = (await read(host)).attention.hands[0];
    expect(oldHand?.participantId).toBe(peer.call.ticket.identity);
    await peer.call.setFeedback('yes');
    expect((await read(host)).attention.hands[0]).toEqual(oldHand);
    expect((await read(host)).attention.signals).toHaveLength(1);
    await rewriteRecord(organizer.ownerId, host.ticket.callId, 'call-attention', (value) => {
      const old = z.object({ signals: z.array(z.record(z.string(), z.unknown())) }).parse(value);
      return { ...value, signals: old.signals.map((signal) => ({ ...signal, until: Date.now() - 1 })) };
    });
    expect((await read(host)).attention.signals).toEqual([]);
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
