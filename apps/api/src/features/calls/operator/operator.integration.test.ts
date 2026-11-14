/**
 * A call, as an operator sees it and acts on it (features/calls/operator/routes.ts): signed requests to the real API over HTTP,
 * on real Postgres, the object store and the local LiveKit server, with people in the call through @alcove/api-http and
 * @livekit/rtc-node. The signs of a call that won't end, and ending only one that is, once, while its host ends it too; the
 * work report counting them as a call's lookup reads them; a call looked up by its ID, its meeting's or its note's, with its
 * counts and its room, and a run the newest ten leave out by its own ID; a call's code refused; a room left up after a call
 * ended closed, and a live call's left alone; with LiveKit out of reach, nothing ended or closed on its silence, and each
 * answer saying it didn't answer; one account's lookup naming nothing of another's; no name, address, title, code or room
 * name in any answer or log line; and the CLI, which keeps only the ID of an address, refuses a join link before it sends
 * anything, and closes a room left up.
 *
 * Operators' keys have limits of their own (http/operator.ts), so what a test waits for is watched in LiveKit itself, and the
 * operator asked once it's there. A host joining has upkeep look at every live call 26 seconds later (joining.ts): the test
 * that makes calls look stuck by hand runs first, before any of those are due, and acts within seconds of each call starting;
 * a call that only its row makes look stuck later on keeps its host in its room, where upkeep finds it.
 */
import type { AudioPiece, CallSession, TranscriptClip } from '@alcove/api';
import { DisconnectReason } from '@livekit/rtc-node';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { b64u } from '../../../keys/crypto';
import { CODE } from '../../../platform/runs';
import { OUTSIDE, startServer } from '../../../start';
import { speechWav } from '../../../testing/fakes/near';
import { ORIGIN, startHarness, type Harness } from '../../../testing/harness';
import { connect, deleteRoomDirectly, disposeLiveKit, tokenDirectly, type TestParticipant } from '../../../testing/livekit';
import { signedClient, type SignedClient, type TestKey } from '../../../testing/operator';
import { ChecksAnswer } from '../../operator/checks';
import { WorkAnswer } from '../../operator/wire';
import { CallAnswer, CallEndAnswer, RoomCloseAnswer, type CallRunAnswer } from './operator';

// People join the room through real WebRTC, which a busy machine can be slow to set up: every step says what it waited for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });

const rooms: TestParticipant[] = [];
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((p) => p.disconnect().catch(() => undefined)));
  h.closeCalls();
  await h.resetLimits();
});

let seq = 0;
/** A made-up person's address at Vandelay Industries, unique to this run: the name an account takes comes from it. */
const unique = (who: string) => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@vandelay.test`;
async function account(email = unique('wren.calloway')) {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, session, email };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await waitFor(async () => { await host.refresh(); return host.getSnapshot().waiting.some((w) => w.id === who.ticket.identity); }, 'the ask to reach the host');
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
/** Into the call's LiveKit room, as a browser goes once it's let in, sending with its own key. */
async function joinRoom(call: CallSession): Promise<TestParticipant> {
  await inGroup(call);
  const p = await connect(await call.room(), { sending: call.crypto });
  rooms.push(p);
  return p;
}
/** Who LiveKit has in a room, watched directly: how many, and how many publish. */
const inRoom = async (room: string) => {
  const there = await h.deps.livekit.occupants(room);
  return there === null ? null : { participants: there.length, publishers: there.filter((p) => p.publishing).length };
};
const piece = (n: number): AudioPiece => ({ data: new Blob([Buffer.from(`CANARY-AUDIO-${n}`)]), segment: 0, seq: n, at: n * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string): TranscriptClip => ({ data: new Blob([speechWav(words, 4000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 });

const Refusal = z.object({ code: z.string(), message: z.string() });
/** Every answer an operator got here, as it came: none may hold a name, an address, a title, a code or a room's name. */
const answers: string[] = [];
async function said(r: Response): Promise<unknown> {
  const text = await r.text();
  answers.push(text);
  return JSON.parse(text);
}
const lookUp = async (id: string) => {
  const r = await h.operator.read.get(`/v1/operator/calls/${id}`);
  expect(r.status, `the lookup of ${id}`).toBe(200);
  return CallAnswer.parse(await said(r));
};
const runOf = (a: { runs: CallRunAnswer[] }, callId: string): CallRunAnswer => {
  const run = a.runs.find((x) => x.callId === callId);
  if (!run) throw new Error(`no run ${callId} in the answer`);
  return run;
};
const run = async (callId: string) => runOf(await lookUp(callId), callId);
/** Ending a call, with a ticket's reference, or with none (`null`). */
const end = (callId: string, reason: string | null = 'INC-77') => h.operator.write.post(`/v1/operator/calls/${callId}/end`, reason === null ? {} : { reason });
const closeRoom = (callId: string) => h.operator.write.post(`/v1/operator/calls/${callId}/room/close`, { reason: 'INC-77' });
/** The calls the work report counts (features/operator/work.ts), as a read key gets them from `via`'s instance. */
async function counted(via: SignedClient = h.operator.read) {
  const r = await via.get('/v1/operator/work');
  expect(r.status, 'the work report').toBe(200);
  const w = WorkAnswer.parse(await said(r));
  if (!w.queues.ok) throw new Error(`The queues weren’t counted: ${w.queues.code}`);
  return w.queues.calls;
}
/** How many log lines since `from` say `msg` about `id`. */
const linesSaying = (from: number, msg: string, id: string) => h.logs.slice(from).filter((l) => l.includes(`"msg":"${msg}"`) && l.includes(id)).length;
/** A port nothing listens on: a LiveKit there refuses every connection. */
const closedPort = () => new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const at = s.address(); s.close(() => resolve(typeof at === 'object' && at ? at.port : 9)); });
});
/**
 * Another instance on the harness's database and bucket, started as production starts one (start.ts), whose LiveKit is out of
 * reach: its LIVEKIT_URL is `url`, which nothing answers. It lists the harness's operator keys, and its clients sign for its API_URL.
 */
async function withoutLiveKit(url: string) {
  const cfg = h.deps.cfg;
  const api = 'https://api.vandelay.test';
  const running = await startServer({
    TEE: 'none', DATABASE_URL: cfg.DATABASE_URL, OBJECTS_ENDPOINT: cfg.OBJECTS_ENDPOINT, OBJECTS_BUCKET: cfg.OBJECTS_BUCKET,
    OBJECTS_ACCESS_KEY: cfg.OBJECTS_ACCESS_KEY, OBJECTS_SECRET_KEY: cfg.OBJECTS_SECRET_KEY, KMASTER: cfg.KMASTER, KSERVICE: cfg.KSERVICE,
    LIVEKIT_URL: url, LIVEKIT_API_KEY: cfg.LIVEKIT_API_KEY, LIVEKIT_API_SECRET: cfg.LIVEKIT_API_SECRET,
    WEB_ORIGIN: ORIGIN, API_URL: api, API_PORT: '0', API_HOST: '127.0.0.1', DEMO_AUTH_ENABLED: 'false',
    LIMITS_CACHE_MS: '0', FEATURE_FLAGS_CACHE_MS: '0', DOC_WORKERS: '1',
    OPERATOR_KEYS: [h.operator.keys.read, h.operator.keys.write].map((k) => `${k.key.scope}:${b64u(k.key.publicKey)}`).join(',')
  }, OUTSIDE);
  const base = `http://127.0.0.1:${'api' in running.ports ? running.ports.api : 0}`;
  const audience = new URL(api).origin;
  return { read: signedClient(base, audience, h.operator.keys.read), write: signedClient(base, audience, h.operator.keys.write), close: () => running.close() };
}
/** None of these anywhere: not in any answer an operator got, nor in any log line since `from`. */
function nowhere(from: number, canaries: string[]) {
  const logs = h.logs.slice(from).join('\n');
  const text = answers.join('\n');
  for (const c of canaries) {
    expect(text.includes(c), `${c} in an answer`).toBe(false);
    expect(logs.includes(c), `${c} in a log line`).toBe(false);
  }
}
/** A call started now with notes on, its organizer in it as host. */
async function started(o: { title?: string; guests?: string[] } = {}) {
  const org = await account();
  const title = o.title ?? `CANARY-TITLE-${seq++}`;
  const { code } = await org.api.calls.startNow({ title, notes: 'on', ...(o.guests ? { guests: o.guests } : {}) });
  const host = await org.api.calls.join(code, { mic: true, cam: false });
  const s = host.getSnapshot();
  return { org, host, code, title, callId: host.ticket.callId, room: host.ticket.roomName, meetingId: s.meetingId, noteId: s.notes.noteId ?? '' };
}
/** A call whose host's browser went once it was in its group, as a stuck call's has: nothing about it changes by itself. */
async function abandoned() {
  const c = await started();
  await inGroup(c.host);
  c.host.close();
  return c;
}

describe('a call that won’t end', () => {
  it('says when a call’s room is gone, it has no room, or its host is gone from an empty room, and ends each', async () => {
    const from = h.logs.length;
    // Its room gone, more than a minute after it started.
    const gone = await abandoned();
    await h.pool.query(`UPDATE calls SET started_at = now() - interval '2 minutes' WHERE call_id = $1`, [gone.callId]);
    await deleteRoomDirectly(h.deps.cfg, gone.room);
    expect(await run(gone.callId)).toMatchObject({
      state: 'live', room: { exists: false, participants: 0, publishers: 0 }, livekit: 'asked', signals: { roomGone: true, overdue: false, hostGone: false, noRoom: false }
    });
    // The work report counts each sign as the lookup reads it, here of the only call on: LiveKit asked once which rooms are up.
    expect(await counted()).toMatchObject({ live: 1, overdue: 0, noRoom: 0, roomGone: 1, roomLeftUp: 0, livekit: null });
    expect((await end(gone.callId)).status).toBe(200);
    expect((await run(gone.callId)).state).toBe('ended');

    // Its host never reached its room, more than the grace ago, and nobody else is in it.
    const away = await abandoned();
    await h.pool.query(`UPDATE calls SET host_joined_at = now() - interval '30 seconds' WHERE call_id = $1`, [away.callId]);
    expect(await run(away.callId)).toMatchObject({ host: 'here', room: { exists: true, participants: 0 }, signals: { hostGone: true, roomGone: false, overdue: false } });
    // The work report counts only hosts that left, by the row: one that never reached the room takes LiveKit's word to tell.
    expect(await counted()).toMatchObject({ live: 1, hostAway: 0, roomGone: 0, endedLastHour: 1, roomLeftUp: 0 });
    const ended = await end(away.callId);
    expect(ended.status).toBe(200);
    expect(CallEndAnswer.parse(await said(ended))).toMatchObject({ callId: away.callId, ended: true });
    expect(await run(away.callId)).toMatchObject({ state: 'ended', recorder: { state: 'stopped' } });

    // No room at all: LiveKit isn't asked, and nobody can be in it.
    const roomless = await abandoned();
    await deleteRoomDirectly(h.deps.cfg, roomless.room);
    await h.pool.query('UPDATE calls SET room_name = NULL WHERE call_id = $1', [roomless.callId]);
    expect(await run(roomless.callId)).toMatchObject({ room: null, livekit: 'not-asked', signals: { noRoom: true } });
    expect(await counted()).toMatchObject({ live: 1, noRoom: 1, endedLastHour: 2 });
    expect((await end(roomless.callId)).status).toBe(200);

    const lines = h.logs.slice(from).filter((l) => l.includes('"msg":"stuck call ended by an operator"'));
    expect(lines.map((l) => [l.includes(gone.callId), l.includes(away.callId), l.includes(roomless.callId)])).toEqual([[true, false, false], [false, true, false], [false, false, true]]);
    nowhere(from, [gone.room, away.room, roomless.room, gone.code, away.code, roomless.code, gone.title, away.org.email]);
  });

  it('ends a call that has run as long as a call can, but not one that’s well, and its notes are written', async () => {
    const from = h.logs.length;
    const { org, host, callId, noteId, room } = await started();
    await joinRoom(host);
    await host.transcribe(speech('We agreed to ship the beta on Friday.'), host.ticket.identity);
    // Well: its host is in its room, and it's young. Nothing is done.
    const well = await end(callId);
    expect(well.status).toBe(409);
    expect(Refusal.parse(await said(well))).toEqual({ code: 'conflict', message: 'That call isn’t stuck; nothing was done.' });
    expect(await run(callId)).toMatchObject({ state: 'live', signals: { overdue: false, hostGone: false, roomGone: false, noRoom: false, roomLeftUp: false } });
    // A read key can't, and an action needs a reason.
    expect((await h.operator.read.post(`/v1/operator/calls/${callId}/end`, { reason: 'INC-77' })).status).toBe(403);
    expect((await end(callId, null)).status).toBe(400);

    // Past its longest: as short as a call's longest can be set (its floor, 10 minutes), and the call started 11 minutes ago.
    await h.setLimit('call.max_seconds', 600);
    await h.pool.query(`UPDATE calls SET started_at = now() - interval '11 minutes' WHERE call_id = $1`, [callId]);
    const overdue = await run(callId);
    expect(overdue).toMatchObject({ state: 'live', signals: { overdue: true, hostGone: false, roomGone: false, noRoom: false } });
    expect(overdue.pastLongestS).toBeGreaterThanOrEqual(59);
    const ended = await end(callId);
    expect(ended.status).toBe(200);
    expect(CallEndAnswer.parse(await said(ended))).toMatchObject({ callId, ended: true });
    expect(await run(callId)).toMatchObject({ state: 'ended', recorder: { state: 'stopped' } });
    // As when its host leaves: everyone's out of its room, which is gone, and its notes are written.
    await waitFor(async () => (await inRoom(room)) === null, 'its room to go');
    for await (const _progress of org.api.notes.progress(noteId)) { /* until they're written */ }
    expect((await org.api.notes.get(noteId)).status).toBe('ready');
    // A second time is nothing to do.
    const again = await end(callId);
    expect(again.status).toBe(409);
    expect(Refusal.parse(await said(again)).message).toBe('That call has ended already; nothing was done.');
    expect(h.logs.slice(from).some((l) => l.includes('"msg":"stuck call ended by an operator"') && l.includes(callId) && l.includes('"overdue":true'))).toBe(true);
  });

  it('ends a call past its longest once when its host ends it at the same moment, and writes its notes once', async () => {
    const from = h.logs.length;
    const { org, host, callId, noteId } = await started();
    await joinRoom(host);
    await host.transcribe(speech('We agreed to send the latex samples on Monday.'), host.ticket.identity);
    await h.setLimit('call.max_seconds', 600);
    await h.pool.query(`UPDATE calls SET started_at = now() - interval '11 minutes' WHERE call_id = $1`, [callId]);
    // The operator ends it as its host leaves, ending it for everyone: whichever holds the call's row first ends it.
    const [ended] = await Promise.all([end(callId), host.leave()]);
    const answer = await said(ended);
    if (ended.status === 200) {
      expect(CallEndAnswer.parse(answer)).toMatchObject({ callId, ended: true });
      expect(linesSaying(from, 'stuck call ended by an operator', callId)).toBe(1);
    } else {
      // Its host came first, and the operator is told so.
      expect(ended.status).toBe(409);
      expect(Refusal.parse(answer).message).toBe('That call has ended already; nothing was done.');
      expect(linesSaying(from, 'stuck call ended by an operator', callId)).toBe(0);
    }
    // Either way, it ended once, with one notes job.
    expect(linesSaying(from, 'call ended', callId)).toBe(1);
    expect(linesSaying(from, 'notes job queued', noteId)).toBe(1);
    expect(await run(callId)).toMatchObject({ state: 'ended', recorder: { state: 'stopped' } });
    for await (const _progress of org.api.notes.progress(noteId)) { /* until they're written */ }
    expect((await org.api.notes.get(noteId)).status).toBe('ready');
    await waitFor(() => linesSaying(from, 'notes written', noteId) > 0, 'the writer to say it wrote the notes');
    expect(linesSaying(from, 'notes written', noteId)).toBe(1);
  });

  it('closes the room of a call that has ended, and leaves a live call’s alone', async () => {
    const from = h.logs.length;
    const { host, callId, room } = await started();
    await joinRoom(host);
    const live = await closeRoom(callId);
    expect(live.status).toBe(409);
    expect(Refusal.parse(await said(live)).message).toBe('That call is still on, and its room is its own; nothing was done.');
    expect(await inRoom(room)).not.toBeNull();
    await host.leave();
    // Its room left up after it ended, with someone still in it, as when deleting it failed.
    await h.deps.livekit.ensureRoom(room);
    const lingering = await connect({ serverUrl: h.deps.cfg.LIVEKIT_URL, token: await tokenDirectly(h.deps.cfg, room, 'left-behind'), identity: 'left-behind' });
    rooms.push(lingering);
    await waitFor(async () => (await inRoom(room))?.participants === 1, 'LiveKit to list who’s left behind');
    expect(await run(callId)).toMatchObject({ state: 'ended', room: { exists: true, participants: 1 }, signals: { roomLeftUp: true } });
    const closed = await closeRoom(callId);
    expect(closed.status).toBe(200);
    expect(RoomCloseAnswer.parse(await said(closed))).toMatchObject({ callId, deleted: true });
    expect(await lingering.disconnectReason()).toBe(DisconnectReason.ROOM_DELETED);
    expect(await run(callId)).toMatchObject({ room: { exists: false }, signals: { roomLeftUp: false } });
    // Again: nothing up, nothing closed.
    expect(RoomCloseAnswer.parse(await said(await closeRoom(callId)))).toMatchObject({ deleted: false });
    nowhere(from, [room]);
  });
});

describe('a call, as an operator sees it', () => {
  it('looks a call up by its ID, its meeting’s and its note’s, with its counts and its room, and nothing of who', async () => {
    const from = h.logs.length;
    const invitedEmail = unique('tova.marsh');
    const { org, host, code, title, callId, room, meetingId, noteId } = await started({ guests: [invitedEmail] });
    expect(noteId).not.toBe('');
    await (await joinRoom(host)).publishTone();
    const invited = await account(invitedEmail);
    await joinRoom(await invited.api.calls.join(code, { mic: true, cam: false }));
    const guest = await h.browser().api.calls.join(code, { mic: true, cam: false, name: 'Quillon Ashgrove' });
    await letIn(host, guest);
    await joinRoom(guest);
    await host.appendAudio(piece(0));
    await host.transcribe(speech('CANARYWORD quokka marmalade'), host.ticket.identity);
    // LiveKit lists the three of them once they're in, and the host's microphone once it's published.
    await waitFor(async () => { const there = await inRoom(room); return there?.participants === 3 && there.publishers === 1; }, 'LiveKit to list the three of them, one publishing');

    const byCall = await lookUp(callId);
    expect(byCall).toMatchObject({ matchedAs: 'call', meetingId, olderRuns: 0, instance: expect.stringMatching(/\S/) });
    expect(byCall.runs.map((r) => r.callId)).toEqual([callId]);
    expect(runOf(byCall, callId)).toMatchObject({
      state: 'live', endedAt: null, pastLongestS: 0, locked: false, host: 'here', hostAwayS: null, generation: 0,
      inside: {
        people: { in: { host: 1, invited: 1, guest: 1 }, waiting: { host: 0, invited: 0, guest: 0 }, left: { host: 0, invited: 0, guest: 0 }, denied: { host: 0, invited: 0, guest: 0 } },
        places: { taken: 3, most: 100 }, standIn: false, notes: { status: 'on', everOn: true, segment: 0 }, breakoutRooms: 0, liveShares: 0, timerRunning: false
      },
      recorder: { state: 'recording', segments: 1, pieces: 1, seconds: 5, clips: 1 },
      notesJob: null,
      room: { exists: true, participants: 3, publishers: 1 },
      livekit: 'asked',
      signals: { overdue: false, hostGone: false, roomGone: false, noRoom: false, roomLeftUp: false }
    });
    // By its meeting's ID (a call ahead's address) and its note's (the address of the call's page): the same call.
    expect(await lookUp(meetingId)).toMatchObject({ matchedAs: 'meeting', meetingId, runs: [expect.objectContaining({ callId })] });
    expect(await lookUp(noteId)).toMatchObject({ matchedAs: 'note', meetingId, runs: [expect.objectContaining({ callId })] });

    await host.leave();
    expect(await run(callId)).toMatchObject({ state: 'ended', host: null, recorder: { state: 'stopped' }, signals: { roomLeftUp: false } });
    nowhere(from, [title, code, room, org.email, invitedEmail, org.session.user.name, invited.session.user.name, 'Quillon Ashgrove', 'CANARYWORD', 'quokka']);
  });

  it('looks a run up by its own ID when the meeting’s newest ten leave it out, and says how many runs are left out', async () => {
    const org = await account();
    const { code } = await org.api.calls.startNow({ title: `CANARY-TITLE-${seq++}`, notes: 'off' });
    // Twelve runs of one call: joining it again once it has ended starts another.
    const runs: string[] = [];
    let meetingId = '';
    for (let i = 0; i < 12; i++) {
      const call = await org.api.calls.join(code, { mic: true, cam: false });
      runs.push(call.ticket.callId);
      meetingId = call.getSnapshot().meetingId;
      await call.leave();
    }
    const newestTen = runs.slice(2).reverse();
    const oldest = runs[0] ?? '';
    // By the oldest run's own ID: the newest ten, newest first, then that one; the run between them is left out.
    const byOldest = await lookUp(oldest);
    expect(byOldest).toMatchObject({ matchedAs: 'call', meetingId, olderRuns: 1 });
    expect(byOldest.runs.map((r) => r.callId)).toEqual([...newestTen, oldest]);
    expect(runOf(byOldest, oldest)).toMatchObject({ state: 'ended', livekit: 'asked', room: { exists: false } });
    // By the meeting's ID, or a run's among the newest: the newest ten, and two left out.
    for (const id of [meetingId, runs[5] ?? '']) {
      const a = await lookUp(id);
      expect(a.runs.map((r) => r.callId), id).toEqual(newestTen);
      expect(a.olderRuns, id).toBe(2);
    }
  });

  it('refuses a call’s code, or anything else that isn’t an ID, and says none of it back or in the log', async () => {
    const from = h.logs.length;
    const { host, code, callId } = await started();
    await joinRoom(host);
    for (const typed of ['abc-defg-hij', code, `join-${code}`, 'short']) {
      const r = await h.operator.read.get(`/v1/operator/calls/${typed}`);
      expect(r.status, typed).toBe(400);
      expect(JSON.stringify(Refusal.parse(await said(r)))).not.toContain(typed);
    }
    for (const r of [await end(code), await closeRoom(code)]) {
      expect(r.status).toBe(400);
      expect(JSON.stringify(Refusal.parse(await said(r)))).not.toContain(code);
    }
    // An ID that names nothing.
    const none = await h.operator.read.get('/v1/operator/calls/AAAAAAAAAAAAAAAAAAAAAA');
    expect(none.status).toBe(404);
    expect(Refusal.parse(await said(none)).message).toBe('No call, meeting or note has that ID.');
    expect((await end('AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    // The call is untouched.
    expect((await run(callId)).state).toBe('live');
    nowhere(from, ['abc-defg-hij', code]);
  });

  it('looks one account’s call up with nothing of another account’s', async () => {
    const a = await started();
    const b = await started();
    const ids = (x: typeof a) => [x.callId, x.meetingId, x.noteId, x.org.session.ownerId];
    for (const [mine, theirs] of [[a, b], [b, a]] as const) {
      const theirRecording = (await run(theirs.callId)).recorder?.recordingId ?? '';
      expect(theirRecording).not.toBe('');
      for (const id of [mine.callId, mine.meetingId, mine.noteId]) {
        const answer = await lookUp(id);
        expect(answer.runs.map((r) => r.callId)).toEqual([mine.callId]);
        const text = JSON.stringify(answer);
        for (const other of [...ids(theirs), theirRecording]) expect(text.includes(other), `${other} in a lookup of ${mine.callId}`).toBe(false);
      }
    }
  });
});

describe('with LiveKit out of reach', () => {
  it('says LiveKit didn’t answer, and neither ends a call nor closes a room on its silence', async () => {
    const from = h.logs.length;
    // As LiveKit's URL is set (ws://), on a port nothing listens on: its server API is the same port over HTTP.
    const nowhereLiveKit = `ws://127.0.0.1:${await closedPort()}`;
    const cut = await withoutLiveKit(nowhereLiveKit);
    try {
      const { org, host, code, title, callId, room } = await started();
      await joinRoom(host);
      await waitFor(async () => (await inRoom(room))?.participants === 1, 'LiveKit to list the host in its room');
      // By its row, its host has hosted for longer than the grace, as on any call that's been on a while: only LiveKit can say
      // whether the host is still in its room.
      await h.pool.query(`UPDATE calls SET host_joined_at = now() - interval '30 seconds' WHERE call_id = $1`, [callId]);
      const looked = await cut.read.get(`/v1/operator/calls/${callId}`);
      expect(looked.status).toBe(200);
      expect(runOf(CallAnswer.parse(await said(looked)), callId)).toMatchObject({
        state: 'live', host: 'here', room: null, livekit: 'unanswered', signals: { overdue: false, hostGone: false, roomGone: false, noRoom: false, roomLeftUp: false }
      });
      const refused = await cut.write.post(`/v1/operator/calls/${callId}/end`, { reason: 'INC-77' });
      expect(refused.status).toBe(503);
      expect(Refusal.parse(await said(refused))).toEqual({
        code: 'unavailable', message: 'LiveKit didn’t say whether the call’s room is up, or who’s in it, so nothing was done. Try again in a moment.'
      });
      // Asked of the LiveKit that answers, it was well all along: its host is in its room, and it's still on.
      expect(await run(callId)).toMatchObject({ state: 'live', livekit: 'asked', room: { exists: true, participants: 1 }, signals: { hostGone: false } });

      // Once it has ended, its room left up, as when deleting it failed: closing it waits for LiveKit to say whether it's up.
      await host.leave();
      await h.deps.livekit.ensureRoom(room);
      const kept = await cut.write.post(`/v1/operator/calls/${callId}/room/close`, { reason: 'INC-77' });
      expect(kept.status).toBe(503);
      expect(Refusal.parse(await said(kept))).toEqual({ code: 'unavailable', message: 'LiveKit didn’t say whether the room is up, so nothing was closed. Try again in a moment.' });
      expect(await inRoom(room)).not.toBeNull();

      // The work report counts the calls from their rows, and says why it has no count of their rooms.
      expect(await counted(cut.read)).toMatchObject({ roomGone: null, roomLeftUp: null, livekit: expect.stringMatching(CODE) });
      // The live checks ask LiveKit on a client of their own, from an instance's LIVEKIT_URL: pointed nowhere, they say how it fails.
      const checking = await h.secondServer({ LIVEKIT_URL: nowhereLiveKit });
      try {
        const r = await signedClient(checking.baseUrl, h.operator.audience, h.operator.keys.read).get('/v1/operator/checks');
        expect(r.status).toBe(200);
        expect(ChecksAnswer.parse(await said(r)).checks.find((x) => x.name === 'livekit')).toMatchObject({ ok: false, code: 'ECONNREFUSED', detail: { rooms: null } });
      } finally {
        await checking.close();
      }

      // The LiveKit that answers closes it.
      const closed = await closeRoom(callId);
      expect(closed.status).toBe(200);
      expect(RoomCloseAnswer.parse(await said(closed))).toMatchObject({ callId, deleted: true });
      nowhere(from, [room, code, title, org.email]);
    } finally {
      await cut.close();
    }
  });
});

describe('the operator CLI', () => {
  it('keeps only the ID of a call’s address, refuses a join link or a code before it sends anything, and closes a room left up', async () => {
    const { host, code, callId, meetingId, noteId, room } = await started();
    await joinRoom(host);
    const home = await mkdtemp(join(tmpdir(), 'alcove-operator-calls-'));
    /** `k`'s key file, as `operator keygen --no-passphrase` writes one: its path. */
    const keyFile = async (k: TestKey, name: string) => {
      const { d: seed } = k.privateKey.export({ format: 'jwk' });
      const path = join(home, name);
      await writeFile(path, JSON.stringify({ v: 1, keyId: k.key.id, publicKey: Buffer.from(k.key.publicKey).toString('base64url'), sealed: null, seed }), { mode: 0o600 });
      return path;
    };
    /** The CLI as an operator runs it: no .env, nothing in its environment but a PATH and a home, and no terminal. */
    const cli = (args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const run = spawn(process.execPath, ['--import', 'tsx', 'src/operator-cli.ts', ...args], { env: { PATH: process.env['PATH'] ?? '', HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      run.stdout.on('data', (b: Buffer) => { out += b.toString(); });
      run.stderr.on('data', (b: Buffer) => { err += b.toString(); });
      run.on('error', reject);
      run.on('close', (exit) => resolve({ code: exit, out, err }));
    });
    try {
      // Refused here: nothing is sent, so it needs no key, and an API that isn't there never hears of it.
      const nowhereApi = ['--api', 'http://127.0.0.1:9'];
      const joinLink = 'That’s a join link: its code lets anyone in. Ask for the address of the call’s page instead.';
      for (const [args, refusal] of [
        [['call', `https://alcove.solutions/join/${code}`], joinLink],
        [['note', `https://alcove.solutions/call/${code}`], joinLink],
        [['call', code], 'That’s a call’s code: it lets anyone in. Ask for the address of the call’s page instead.'],
        [['note', `https://alcove.solutions/calls/upcoming/${meetingId}`], 'That’s the address of a call ahead'],
        [['call', 'end', `https://alcove.solutions/calls/${noteId}`, '--reason', 'INC-77'], 'An address names a call’s note or its meeting']
      ] as const) {
        const r = await cli([...args, ...nowhereApi]);
        expect(r.code, args.join(' ')).toBe(2);
        expect(r.err, args.join(' ')).toContain(refusal);
        expect(r.err, args.join(' ')).not.toMatch(/Request |operator key|Couldn’t reach/);
      }
      // An address as pasted, its ID kept: the call's page, with what follows it.
      const api = ['--api', h.baseUrl, '--audience', h.operator.audience, '--key', await keyFile(h.operator.keys.read, 'operator-key.json')];
      const page = await cli(['call', `https://alcove.solutions/calls/${noteId}?tab=notes`, ...api]);
      expect(page.code, page.err).toBe(0);
      expect(page.out).toMatch(/^Matched as:\s+note$/m);
      expect(page.out).toMatch(new RegExp(`^Call:\\s+${callId}$`, 'm'));
      expect(page.out).toMatch(/^State:\s+live since /m);
      expect(page.err).toMatch(/^Request [A-Za-z0-9_-]{8,64} on \S+$/m);
      const json = await cli(['call', meetingId, '--json', ...api]);
      expect(json.code, json.err).toBe(0);
      expect(CallAnswer.parse(JSON.parse(json.out))).toMatchObject({ matchedAs: 'meeting', runs: [expect.objectContaining({ callId })] });
      // A read key can't end a call: the server's refusal, and exit 1.
      const refused = await cli(['call', 'end', callId, '--reason', 'INC-77', ...api]);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain('That key only reads');

      // Once the call has ended, its room left up, as when deleting it failed: a write key closes it, and says so; then there's none.
      const writes = ['--api', h.baseUrl, '--audience', h.operator.audience, '--key', await keyFile(h.operator.keys.write, 'operator-write-key.json')];
      await host.leave();
      await h.deps.livekit.ensureRoom(room);
      const closed = await cli(['call', 'room', 'close', callId, '--reason', 'INC-77', ...writes]);
      expect(closed.code, closed.err).toBe(0);
      expect(closed.out).toContain(`The room of call ${callId} was up, and is closed.`);
      expect(await inRoom(room)).toBeNull();
      const none = await cli(['call', 'room', 'close', callId, '--reason', 'INC-77', ...writes]);
      expect(none.code, none.err).toBe(0);
      expect(none.out).toContain(`Call ${callId} had no room up; nothing was closed.`);
      for (const r of [page, json, refused, closed, none]) expect(`${r.out}${r.err}`).not.toContain(code);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
