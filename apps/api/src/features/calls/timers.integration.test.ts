import { AlcoveApiError, type CallSession, type CallState, type CallTimer } from '@alcove/api';
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
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function inGroup(call: CallSession): Promise<void> { await until(() => call.crypto.getSnapshot().status === 'in', 'admitted to the call'); }
async function read(call: CallSession): Promise<CallState> { await call.refresh({ call: true, log: false }); return call.getSnapshot(); }
async function timerOf(call: CallSession): Promise<CallTimer> { const timer = (await read(call)).timer; if (!timer) throw new Error('No timer running'); return timer; }
const refusal = async (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => e instanceof AlcoveApiError ? e.code : String(e));
async function joined() {
  const owner = await account();
  const { code } = await owner.api.calls.startNow({ notes: 'off' });
  const call = await owner.api.calls.join(code, { mic: false, cam: false });
  return { owner, code, call };
}
/** The call's sealed state as the server keeps it: its key, header and opened record, to read or to write as an earlier release did. */
async function sealedState(ownerId: string, callId: string) {
  const o = await openOwner(h.deps, ownerId, undefined);
  const key = stateKey(o.root, o.ownerId, `call:${callId}`);
  const header = { v: 1, kind: 'call-state', ownerId: o.ownerId, callId } as const;
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [ownerId, callId])).rows[0]);
  const record = openJson(key, header, row.state_ciphertext, z.record(z.string(), z.unknown()));
  const write = async (next: Record<string, unknown>) => {
    await h.pool.query('UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, sealJson(key, header, toJson(next))]);
  };
  return { record, write };
}

describe('the call timer through the real API', () => {
  it('starts, pauses, adds time, resumes and stops one countdown, once under concurrency', async () => {
    const { call } = await joined();
    expect((await read(call)).timer).toBeNull();
    const started = await Promise.all([refusal(call.controlTimer({ action: 'start', durationSeconds: 60 })), refusal(call.controlTimer({ action: 'start', durationSeconds: 300 }))]);
    expect(started.sort()).toEqual(['allowed', 'conflict']);
    const first = await timerOf(call);
    expect(first).toMatchObject({ revision: 0, status: 'running', elapsedMs: 0 });
    expect([60, 300]).toContain(first.durationSeconds);
    expect(first.startedAt).not.toBeNull();
    await rest(1100);
    await call.controlTimer({ action: 'pause', expectedRevision: first.revision });
    const paused = await timerOf(call);
    expect(paused).toMatchObject({ id: first.id, revision: 1, status: 'paused', startedAt: null });
    expect(paused.elapsedMs).toBeGreaterThan(1000);
    await rest(300);
    expect((await timerOf(call)).elapsedMs).toBe(paused.elapsedMs);
    await call.controlTimer({ action: 'add-time', expectedRevision: 1, seconds: 60 });
    expect(await timerOf(call)).toMatchObject({ revision: 2, durationSeconds: first.durationSeconds + 60, status: 'paused' });
    await call.controlTimer({ action: 'resume', expectedRevision: 2 });
    const resumed = await timerOf(call);
    expect(resumed).toMatchObject({ revision: 3, status: 'running', elapsedMs: paused.elapsedMs });
    expect(resumed.startedAt).not.toBeNull();
    // Two presses made against the same countdown: one changes it, the other is told it changed.
    const pauses = await Promise.all([refusal(call.controlTimer({ action: 'pause', expectedRevision: 3 })), refusal(call.controlTimer({ action: 'pause', expectedRevision: 3 }))]);
    expect(pauses.sort()).toEqual(['allowed', 'conflict']);
    expect(await refusal(call.controlTimer({ action: 'pause', expectedRevision: 4 }))).toBe('conflict');
    await call.controlTimer({ action: 'stop', expectedRevision: 4 });
    expect((await read(call)).timer).toBeNull();
    expect(await refusal(call.controlTimer({ action: 'stop', expectedRevision: 4 }))).toBe('conflict');
    await call.controlTimer({ action: 'start', durationSeconds: 180 });
    const second = await timerOf(call);
    expect(second).toMatchObject({ revision: 0, durationSeconds: 180, status: 'running' });
    expect(second.id).not.toBe(first.id);
  });

  it('runs over time until the host adds time, which then counts from now, for a day at most', async () => {
    const { call } = await joined();
    await call.controlTimer({ action: 'start', durationSeconds: 1 });
    await rest(1600);
    // At zero it carries on: still running, and paused, it has run for longer than it was set for.
    expect((await timerOf(call)).status).toBe('running');
    await call.controlTimer({ action: 'pause', expectedRevision: 0 });
    const paused = await timerOf(call);
    expect(paused.elapsedMs).toBeGreaterThan(paused.durationSeconds * 1000);
    await call.controlTimer({ action: 'add-time', expectedRevision: 1, seconds: 60 });
    const added = await timerOf(call);
    expect(added.durationSeconds).toBe(Math.floor(paused.elapsedMs / 1000) + 60);
    expect(added.durationSeconds * 1000 - added.elapsedMs).toBeGreaterThan(59_000);
    expect(added.durationSeconds * 1000 - added.elapsedMs).toBeLessThanOrEqual(60_000);
    await call.controlTimer({ action: 'stop', expectedRevision: 2 });
    await call.controlTimer({ action: 'start', durationSeconds: 86_400 });
    expect(await refusal(call.controlTimer({ action: 'add-time', expectedRevision: 0, seconds: 1 }))).toBe('conflict');
    expect((await timerOf(call)).durationSeconds).toBe(86_400);
  });

  it('keeps its clock independent of boards, board replacement and workspace changes', async () => {
    const { owner, call } = await joined();
    await call.controlTimer({ action: 'start', durationSeconds: 300 });
    const timer = (await read(call)).timer;
    await call.openBoard({ template: 'blank' });
    expect((await read(call)).timer).toEqual(timer);
    await call.closeBoard();
    await call.openBoard({ template: 'retro' });
    await call.openWorkspace();
    const workspace = await owner.api.workspaces.create('Another workspace');
    await call.setWorkspace(workspace.id);
    expect((await read(call)).timer).toEqual(timer);
  });

  it('shows the timer only once let in, survives rejoining and follows whoever hosts now', async () => {
    const owner = await account(); const invited = await account();
    const { code } = await owner.api.calls.startNow({ notes: 'off', guests: [invited.email] });
    const host = await owner.api.calls.join(code, { mic: false, cam: false });
    await inGroup(host);
    await host.controlTimer({ action: 'start', durationSeconds: 600 });
    const guest = h.browser();
    const waiting = await guest.api.calls.join(code, { mic: false, cam: false, name: 'Sam Guest' });
    expect((await read(waiting)).timer).toBeNull();
    expect(await refusal(waiting.controlTimer({ action: 'pause', expectedRevision: 0 }))).toBe('forbidden');
    await until(async () => (await read(host)).waiting.some((w) => w.id === waiting.ticket.identity), 'guest request');
    await host.admit(waiting.ticket.identity); await inGroup(waiting);
    expect((await read(waiting)).timer).toMatchObject({ status: 'running', revision: 0, durationSeconds: 600 });
    expect(await refusal(waiting.controlTimer({ action: 'pause', expectedRevision: 0 }))).toBe('forbidden');
    expect(await refusal(waiting.controlTimer({ action: 'stop', expectedRevision: 0 }))).toBe('forbidden');
    const member = await invited.api.calls.join(code, { mic: false, cam: false }); await inGroup(member);
    expect(await refusal(member.controlTimer({ action: 'add-time', expectedRevision: 0, seconds: 60 }))).toBe('forbidden');
    expect(await refusal(member.controlTimer({ action: 'start', durationSeconds: 60 }))).toBe('forbidden');
    const beforeReconnect = (await read(waiting)).timer;
    const previous = waiting.ticket.pass; waiting.close();
    const back = await guest.api.calls.join(code, { mic: false, cam: false, name: 'Sam Guest', previous }); await inGroup(back);
    expect((await read(back)).timer).toEqual(beforeReconnect);
    rooms.push(await connect(await member.room(), { sending: member.crypto }));
    await until(async () => (await read(host)).host.next.includes(member.ticket.identity), 'eligible replacement host');
    await host.handOff(member.ticket.identity);
    await until(async () => (await read(member)).isHost, 'replacement host');
    await member.controlTimer({ action: 'pause', expectedRevision: 0 });
    expect((await read(member)).timer?.status).toBe('paused');
    expect(await refusal(host.controlTimer({ action: 'resume', expectedRevision: 1 }))).toBe('conflict');
    const returned = await owner.api.calls.join(code, { mic: false, cam: false }); await inGroup(returned);
    await until(async () => (await read(returned)).isHost, 'organizer returned');
    expect(await refusal(member.controlTimer({ action: 'resume', expectedRevision: 1 }))).toBe('conflict');
    await returned.controlTimer({ action: 'resume', expectedRevision: 1 });
    expect((await read(back)).timer?.status).toBe('running');
    await returned.controlTimer({ action: 'stop', expectedRevision: 2 });
    await until(async () => (await read(back)).timer === null, 'the guest sees the timer stopped');
  });

  it('rejects malformed controls, cross-site changes and expired host sessions', async () => {
    const { owner, code, call } = await joined();
    const request = (body: unknown, origin?: string) => owner.fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/timer`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass, ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    for (const command of [
      { action: 'start' }, { action: 'start', durationSeconds: 0 }, { action: 'start', durationSeconds: -1 }, { action: 'start', durationSeconds: 1.5 }, { action: 'start', durationSeconds: 86_401 }, { action: 'start', durationSeconds: '60' },
      { action: 'pause' }, { action: 'stop', expectedRevision: -1 }, { action: 'resume', expectedRevision: 0.5 },
      { action: 'add-time', expectedRevision: 0, seconds: 0 }, { action: 'add-time', expectedRevision: 0, seconds: -10 }, { action: 'add-time', expectedRevision: 0, seconds: 1.5 }, { action: 'add-time', expectedRevision: 0, seconds: 86_401 }, { action: 'add-time', expectedRevision: 0 },
      { action: 'restart', expectedRevision: 0 }, { action: 'advance', expectedRevision: 0 }, { action: 'unknown' }
    ]) expect((await request(command)).status, JSON.stringify(command)).toBe(400);
    expect(await refusal(call.controlTimer({ action: 'pause', expectedRevision: 0 }))).toBe('conflict');
    expect((await request({ action: 'start', durationSeconds: 60 }, 'https://elsewhere.example')).status).toBe(403);
    expect((await read(call)).timer).toBeNull();
    await call.controlTimer({ action: 'start', durationSeconds: 60 });
    expect(await refusal(call.controlTimer({ action: 'resume', expectedRevision: 0 }))).toBe('conflict');
    const current = (await read(call)).timer;
    await h.pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE owner_id = $1", [owner.ownerId]);
    expect(await refusal(call.controlTimer({ action: 'stop', expectedRevision: 0 }))).toBe('forbidden');
    await owner.api.auth.signIn('sso', { email: owner.email });
    const back = await owner.api.calls.join(code, { mic: false, cam: false });
    expect((await read(back)).timer).toEqual(current);
  });

  it('reads a timer sealed by the previous release as its current segment, and keeps it on another API process', async () => {
    const { owner, call } = await joined();
    const callId = call.ticket.callId;
    // As the previous release kept a call's timer: the host's agenda of named segments, with presenters, stepped through.
    const segments = [
      { id: 'opening', label: 'CANARY-OLD-SEGMENT opening', durationSeconds: 120, presenter: 'CANARY-OLD-PRESENTER' },
      { id: 'proposal', label: 'CANARY-OLD-SEGMENT proposal', durationSeconds: 300, presenter: null }
    ];
    const writeOld = async (timerSequence: unknown) => {
      const { record, write } = await sealedState(owner.ownerId, callId);
      delete record['timer'];
      await write({ ...record, timerSequence });
    };
    const startedAt = Date.now() - 5_000;
    await writeOld({ revision: 4, segments, activeIndex: 1, status: 'running', elapsedMs: 20_000, startedAt, addedSeconds: 60 });
    expect((await read(call)).timer).toEqual({ id: 'proposal', revision: 4, durationSeconds: 360, status: 'running', elapsedMs: 20_000, startedAt });
    await writeOld({ revision: 2, segments, activeIndex: 0, status: 'paused', elapsedMs: 45_000, startedAt: null, addedSeconds: 0 });
    expect((await read(call)).timer).toEqual({ id: 'opening', revision: 2, durationSeconds: 120, status: 'paused', elapsedMs: 45_000, startedAt: null });
    for (const status of ['ready', 'finished']) {
      await writeOld({ revision: 7, segments, activeIndex: 1, status, elapsedMs: 0, startedAt: null, addedSeconds: 0 });
      expect((await read(call)).timer, status).toBeNull();
    }
    // A segment as long as a timer runs, with an hour added to it, reads as a day at most, and has no more time to add.
    await writeOld({ revision: 3, segments: [{ id: 'all-day', label: 'CANARY-OLD-SEGMENT all day', durationSeconds: 86_400, presenter: null }], activeIndex: 0, status: 'paused', elapsedMs: 60_000, startedAt: null, addedSeconds: 3_600 });
    expect((await read(call)).timer).toEqual({ id: 'all-day', revision: 3, durationSeconds: 86_400, status: 'paused', elapsedMs: 60_000, startedAt: null });
    expect(await refusal(call.controlTimer({ action: 'add-time', expectedRevision: 3, seconds: 60 }))).toBe('conflict');
    expect((await read(call)).timer).toMatchObject({ revision: 3, durationSeconds: 86_400 });
    await writeOld(null);
    expect((await read(call)).timer).toBeNull();
    // Older still: a call stored before there were timers at all.
    const { record, write } = await sealedState(owner.ownerId, callId);
    delete record['timer'];
    delete record['timerSequence'];
    await write(record);
    expect((await read(call)).timer).toBeNull();
    // The old countdown is the host's to carry on, and the next save keeps it as one countdown, without the agenda's words.
    await writeOld({ revision: 4, segments, activeIndex: 1, status: 'running', elapsedMs: 20_000, startedAt, addedSeconds: 60 });
    await call.controlTimer({ action: 'pause', expectedRevision: 4 });
    const saved = (await sealedState(owner.ownerId, callId)).record;
    expect(saved['timerSequence']).toBeUndefined();
    expect(saved['timer']).toMatchObject({ id: 'proposal', revision: 5, durationSeconds: 360, status: 'paused', startedAt: null });
    expect(JSON.stringify(saved)).not.toContain('CANARY-OLD');
    await call.controlTimer({ action: 'resume', expectedRevision: 5 });
    const second = await h.secondServer();
    try {
      const res = await owner.fetch(`${second.baseUrl}/v1/live/calls/${callId}`, { headers: { 'x-alcove-call': call.ticket.pass } });
      expect(res.status).toBe(200);
      const current = (await read(call)).timer;
      expect(z.object({ timer: z.unknown() }).parse(await res.json()).timer).toEqual(current);
      const stopped = await owner.fetch(`${second.baseUrl}/v1/live/calls/${callId}/timer`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: JSON.stringify({ action: 'stop', expectedRevision: 6 }) });
      expect(stopped.status).toBe(200);
      expect(z.object({ timer: z.null() }).parse(await stopped.json()).timer).toBeNull();
      expect((await read(call)).timer).toBeNull();
    } finally { await second.close(); }
  });
});
