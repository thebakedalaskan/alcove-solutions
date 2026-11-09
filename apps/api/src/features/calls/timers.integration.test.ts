import { AlcoveApiError, type CallSession, type CallState } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from '../../crypto';
import { openOwner } from '../../owners';
import { startHarness, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
const rooms: TestParticipant[] = [];
afterEach(async () => { await Promise.all(rooms.splice(0).map((p) => p.disconnect())); h.closeCalls(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
let serial = 0;
async function account() {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email: `timer.${Date.now()}.${serial++}@tests.example` });
  return { ...b, ownerId: session.ownerId, email: session.user.email };
}
async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const end = Date.now() + 15_000;
  while (!(await check())) { if (Date.now() > end) throw new Error(`Timed out: ${what}`); await new Promise((r) => setTimeout(r, 25)); }
}
async function inGroup(call: CallSession): Promise<void> { await until(() => call.crypto.getSnapshot().status === 'in', 'admitted to the call'); }
async function read(call: CallSession): Promise<CallState> { await call.refresh({ call: true, log: false }); return call.getSnapshot(); }
const segment = (id: string, label = 'Opening', durationSeconds = 60) => ({ id, label, durationSeconds, presenter: null });
const refusal = async (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => e instanceof AlcoveApiError ? e.code : String(e));
async function revision(call: CallSession) { const timer = (await read(call)).timerSequence; if (!timer) throw new Error('Timer missing'); return timer.revision; }
async function joined() {
  const owner = await account();
  const { code } = await owner.api.calls.startNow({ notes: 'off' });
  const call = await owner.api.calls.join(code, { mic: false, cam: false });
  return { owner, code, call };
}

describe('presenter timer sequences through the real API', () => {
  it('runs, overruns, pauses, adds time, edits future slots and explicitly advances once under concurrency', async () => {
    const { call } = await joined();
    expect((await read(call)).timerSequence).toBeNull();
    await call.setTimerSequence({ expectedRevision: null, segments: [segment('first', 'Opening', 1), segment('second'), segment('third')] });
    await call.controlTimer({ expectedRevision: await revision(call), action: 'start' });
    await new Promise((r) => setTimeout(r, 1100));
    const running = (await read(call)).timerSequence;
    expect(running?.status).toBe('running');
    expect(running?.activeIndex).toBe(0);
    await call.controlTimer({ expectedRevision: await revision(call), action: 'pause' });
    expect((await read(call)).timerSequence?.elapsedMs).toBeGreaterThan(1000);
    await call.controlTimer({ expectedRevision: await revision(call), action: 'add-time', seconds: 30 });
    expect((await read(call)).timerSequence?.addedSeconds).toBe(30);
    const rev = await revision(call);
    expect(await refusal(call.setTimerSequence({ expectedRevision: rev, segments: [segment('first', 'Changed', 1), segment('second')] }))).toBe('conflict');
    await call.setTimerSequence({ expectedRevision: rev, segments: [segment('first', 'Opening', 1), segment('third'), segment('second', 'New ending')] });
    await call.controlTimer({ expectedRevision: await revision(call), action: 'resume' });
    const expectedRevision = await revision(call);
    const advanced = await Promise.all([refusal(call.controlTimer({ expectedRevision, action: 'advance' })), refusal(call.controlTimer({ expectedRevision, action: 'advance' }))]);
    expect(advanced.sort()).toEqual(['allowed', 'conflict']);
    expect((await read(call)).timerSequence).toMatchObject({ activeIndex: 1, elapsedMs: 0, addedSeconds: 0, status: 'running' });
    await call.controlTimer({ expectedRevision: await revision(call), action: 'restart' });
    await call.controlTimer({ expectedRevision: await revision(call), action: 'skip' });
    await call.controlTimer({ expectedRevision: await revision(call), action: 'advance' });
    expect((await read(call)).timerSequence?.status).toBe('finished');
    await call.setTimerSequence({ expectedRevision: await revision(call), segments: [segment('new-agenda')] });
    expect((await read(call)).timerSequence).toMatchObject({ status: 'ready', activeIndex: 0, elapsedMs: 0, startedAt: null, addedSeconds: 0 });
  });

  it('keeps its clock independent of board timers, board replacement and workspace changes', async () => {
    const { owner, call } = await joined();
    await call.setTimerSequence({ expectedRevision: null, segments: [segment('opening')] });
    await call.controlTimer({ expectedRevision: 0, action: 'start' });
    const timer = (await read(call)).timerSequence;
    await call.openBoard({ template: 'blank' });
    await call.startTimer(3);
    expect((await read(call)).timerSequence).toEqual(timer);
    await call.stopTimer();
    await call.closeBoard();
    await call.openBoard({ template: 'retro' });
    await call.openWorkspace();
    const workspace = await owner.api.workspaces.create('Another workspace');
    await call.setWorkspace(workspace.id);
    expect((await read(call)).timerSequence).toEqual(timer);
  });

  it('reveals the sequence only after admission, survives rejoining and changes control with the current host', async () => {
    const owner = await account(); const invited = await account();
    const { code } = await owner.api.calls.startNow({ notes: 'off', guests: [invited.email] });
    const host = await owner.api.calls.join(code, { mic: false, cam: false });
    await inGroup(host);
    await host.setTimerSequence({ expectedRevision: null, segments: [segment('first'), segment('second')] });
    await host.controlTimer({ expectedRevision: 0, action: 'start' });
    const guest = h.browser();
    const waiting = await guest.api.calls.join(code, { mic: false, cam: false, name: 'Sam Guest' });
    expect((await read(waiting)).timerSequence).toBeNull();
    expect(await refusal(waiting.controlTimer({ expectedRevision: 1, action: 'pause' }))).toBe('forbidden');
    await until(async () => (await read(host)).waiting.some((w) => w.id === waiting.ticket.identity), 'guest request');
    await host.admit(waiting.ticket.identity); await inGroup(waiting);
    expect((await read(waiting)).timerSequence).toMatchObject({ status: 'running', revision: 1 });
    expect(await refusal(waiting.setTimerSequence({ expectedRevision: 1, segments: [segment('replacement')] }))).toBe('forbidden');
    expect(await refusal(waiting.controlTimer({ expectedRevision: 1, action: 'pause' }))).toBe('forbidden');
    expect(await refusal(guest.api.calls.timerPresets.list())).toBe('unauthenticated');
    const member = await invited.api.calls.join(code, { mic: false, cam: false }); await inGroup(member);
    expect(await refusal(member.controlTimer({ expectedRevision: 1, action: 'pause' }))).toBe('forbidden');
    const beforeReconnect = (await read(waiting)).timerSequence;
    const previous = waiting.ticket.pass; waiting.close();
    const back = await guest.api.calls.join(code, { mic: false, cam: false, name: 'Sam Guest', previous }); await inGroup(back);
    expect((await read(back)).timerSequence).toEqual(beforeReconnect);
    rooms.push(await connect(await member.room(), { sending: member.crypto }));
    await until(async () => (await read(host)).host.next.includes(member.ticket.identity), 'eligible replacement host');
    await host.handOff(member.ticket.identity);
    await until(async () => (await read(member)).isHost, 'replacement host');
    await member.controlTimer({ expectedRevision: 1, action: 'pause' });
    expect((await read(member)).timerSequence?.status).toBe('paused');
    expect(await refusal(host.controlTimer({ expectedRevision: 2, action: 'advance' }))).toBe('conflict');
    const returned = await owner.api.calls.join(code, { mic: false, cam: false }); await inGroup(returned);
    await until(async () => (await read(returned)).isHost, 'organizer returned');
    expect(await refusal(member.controlTimer({ expectedRevision: 2, action: 'advance' }))).toBe('conflict');
    await returned.controlTimer({ expectedRevision: 2, action: 'resume' });
    expect((await read(back)).timerSequence?.status).toBe('running');
  });

  it('keeps presets private, copies fresh timer state, revises intentionally and physically deletes with the account', async () => {
    const a = await account(); const b = await account();
    const input = { name: 'Private agenda canary XQ97', segments: [{ ...segment('private', 'Private segment canary LP43'), presenter: 'Private presenter canary FH81' }] };
    const preset = await a.api.calls.timerPresets.create(input);
    expect(await b.api.calls.timerPresets.list()).toEqual([]);
    expect(await refusal(b.api.calls.timerPresets.update(preset.id, { ...input, expectedRevision: preset.revision }))).toBe('not-found');
    expect(await refusal(b.api.calls.timerPresets.remove(preset.id))).toBe('not-found');
    const copy = await a.api.calls.timerPresets.create({ ...input, name: 'Agenda copy' });
    expect(copy.id).not.toBe(preset.id);
    const updated = await a.api.calls.timerPresets.update(preset.id, { ...input, name: 'Edited agenda', expectedRevision: preset.revision });
    expect(updated.revision).toBe(preset.revision + 1);
    expect(await refusal(a.api.calls.timerPresets.update(preset.id, { ...input, expectedRevision: preset.revision }))).toBe('conflict');
    const { code } = await a.api.calls.startNow({ notes: 'off' });
    const call = await a.api.calls.join(code, { mic: false, cam: false });
    await call.setTimerSequence({ expectedRevision: null, segments: copy.segments });
    await call.controlTimer({ expectedRevision: await revision(call), action: 'start' });
    expect((await a.api.calls.timerPresets.list()).find((p) => p.id === copy.id)).toEqual(copy);
    const dump = JSON.stringify((await h.pool.query('SELECT owner_id, preset_id, ciphertext FROM timer_presets WHERE owner_id = $1', [a.ownerId])).rows);
    const callsDump = JSON.stringify((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1', [a.ownerId])).rows);
    for (const canary of [input.name, input.segments[0]?.label ?? '', input.segments[0]?.presenter ?? '']) {
      expect(dump).not.toContain(canary); expect(callsDump).not.toContain(canary); expect(h.logs.join('\n')).not.toContain(canary);
    }
    const savedRequests: { input: RequestInfo | URL; init: RequestInit | undefined }[] = [];
    const observing = createHttpApi({ baseUrl: h.baseUrl, fetch: async (input, init) => {
      if (init?.method === 'PATCH') savedRequests.push({ input, init });
      return a.fetch(input, init);
    } });
    await observing.calls.timerPresets.update(copy.id, { ...input, name: 'Updated copy', expectedRevision: copy.revision });
    expect((await h.pool.query("SELECT 1 FROM operations WHERE owner_id = $1 AND method LIKE '%timer-presets%'", [a.ownerId])).rows).toEqual([]);
    await a.api.calls.timerPresets.remove(copy.id);
    expect((await a.api.calls.timerPresets.list()).some((p) => p.id === copy.id)).toBe(false);
    const requestToReplay = savedRequests.at(-1);
    if (!requestToReplay) throw new Error('No preset update request was captured.');
    expect((await a.fetch(requestToReplay.input, requestToReplay.init)).status).toBe(404);
    await a.api.account.delete();
    expect((await h.pool.query('SELECT 1 FROM timer_presets WHERE owner_id = $1', [a.ownerId])).rows).toEqual([]);
  });

  it('accepts a full sequence and preset with maximum-length non-ASCII labels and presenters', async () => {
    const { owner, call } = await joined();
    const segments = Array.from({ length: 50 }, (_, i) => ({ id: `slot${i}`.padEnd(64, 'x'), label: '界'.repeat(120), durationSeconds: 86_400, presenter: '字'.repeat(120) }));
    const preset = await owner.api.calls.timerPresets.create({ name: '議'.repeat(120), segments });
    expect(preset.segments).toEqual(segments);
    await call.setTimerSequence({ expectedRevision: null, segments: preset.segments });
    expect((await read(call)).timerSequence?.segments).toEqual(segments);
    const updated = await owner.api.calls.timerPresets.update(preset.id, { name: '案'.repeat(120), expectedRevision: preset.revision, segments });
    expect(updated.name).toBe('案'.repeat(120));
  });

  it('rejects invalid definitions and commands, cross-site changes and expired host sessions', async () => {
    const { owner, code, call } = await joined();
    const request = (path: string, body: unknown, method = 'POST', origin?: string) => owner.fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/timer/${path}`, { method, headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass, ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    for (const segments of [[], [segment('same'), segment('same')], [segment('zero', 'Opening', 0)], [segment('negative', 'Opening', -1)], [segment('fraction', 'Opening', 1.5)], [segment('huge', 'Opening', 86_401)], [segment('blank', '   ')], Array.from({ length: 51 }, (_, i) => segment(`slot${i}`))]) {
      expect((await request('sequence', { expectedRevision: null, segments }, 'PATCH')).status).toBe(400);
    }
    await call.setTimerSequence({ expectedRevision: null, segments: [segment('first')] });
    for (const command of [{ action: 'add-time', seconds: 0 }, { action: 'add-time', seconds: -10 }, { action: 'add-time', seconds: 1.5 }, { action: 'add-time', seconds: 86_401 }, { action: 'unknown' }]) {
      expect((await request('control', { expectedRevision: 0, ...command })).status).toBe(400);
    }
    expect(await refusal(call.controlTimer({ expectedRevision: 0, action: 'pause' }))).toBe('conflict');
    expect((await request('control', { expectedRevision: 0, action: 'start' }, 'POST', 'https://elsewhere.example')).status).toBe(403);
    await call.controlTimer({ expectedRevision: 0, action: 'start' });
    const current = (await read(call)).timerSequence;
    await h.pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE owner_id = $1", [owner.ownerId]);
    expect(await refusal(call.controlTimer({ expectedRevision: 1, action: 'advance' }))).toBe('forbidden');
    expect(await refusal(owner.api.calls.timerPresets.list())).toBe('unauthenticated');
    await owner.api.auth.signIn('sso', { email: owner.email });
    const back = await owner.api.calls.join(code, { mic: false, cam: false });
    expect((await read(back)).timerSequence).toEqual(current);
  });

  it('opens old sealed state with no timer and keeps the running sequence on another API process', async () => {
    const { owner, call } = await joined();
    const o = await openOwner(h.deps, owner.ownerId, undefined);
    const key = stateKey(o.root, o.ownerId, `call:${call.ticket.callId}`);
    const header = { v: 1, kind: 'call-state', ownerId: o.ownerId, callId: call.ticket.callId } as const;
    const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, call.ticket.callId])).rows[0]);
    const old = openJson(key, header, row.state_ciphertext, z.record(z.string(), z.unknown()));
    delete old['timerSequence'];
    await h.pool.query('UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, call.ticket.callId, sealJson(key, header, toJson(old))]);
    expect((await read(call)).timerSequence).toBeNull();
    await call.setTimerSequence({ expectedRevision: null, segments: [segment('fresh')] });
    await call.controlTimer({ expectedRevision: await revision(call), action: 'start' });
    const second = await h.secondServer();
    try {
      const res = await owner.fetch(`${second.baseUrl}/v1/live/calls/${call.ticket.callId}`, { headers: { 'x-alcove-call': call.ticket.pass } });
      expect(res.status).toBe(200);
      const current = (await read(call)).timerSequence;
      expect(z.object({ timerSequence: z.unknown() }).parse(await res.json()).timerSequence).toEqual(current);
      const api = createHttpApi({ baseUrl: second.baseUrl, fetch: owner.fetch });
      expect(await api.calls.timerPresets.list()).toEqual([]);

    } finally { await second.close(); }
  });
});
