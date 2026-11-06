/**
 * The listener (apps/listener) hears a call for its notes, end to end: the real API over HTTP via @alcove/api-http,
 * real Postgres, LiveKit and the call's end-to-end encryption, and main's fake NEAR AI. It's let into the call without
 * anyone being asked, so it's a member of the call's group and holds everyone's keys; it opens each person's microphone with
 * that person's own key, cuts their speech into clips and sends them itself. The API asks LiveKit to send a listener to
 * every part of a live call with notes on (LiveKit pushes the job to a registered listener process), and takes what's
 * said there only from the listener that joined with the dispatch's invite.
 */
import type { CallSession, CallState } from '@alcove/api';
import { createListenerApi } from '@alcove/api-http';
import { listen, serveDispatch, type Serving } from '@alcove/listener';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AlcoveApiError, CALL_PASS_HEADER } from '@alcove/api';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { z } from 'zod';
import { ORIGIN, cookieFetch, startHarness, type Harness } from '../../testing/harness';
import { speechWav } from '../../testing/fake-near';
import { signWebhook } from '../../testing/livekit';
import { startWorker, type Worker } from '../../testing/workers';
import { supervise } from './listening';
import { grantDocumentToCall } from '../workspaces/access';
import { openOwner } from '../../owners';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';

// Letting people into a call goes through its MLS group, which a busy CI runner can be slow at.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const rooms: TestParticipant[] = [];
const serving: Serving[] = [];
const workers: Worker[] = [];
afterEach(async () => {
  await Promise.all(serving.splice(0).map((w) => w.stop().catch(() => undefined)));
  await Promise.all(workers.splice(0).map((w) => w.stop().catch(() => undefined)));
  await Promise.all(rooms.splice(0).map((p) => p.disconnect().catch(() => undefined)));
  h.closeCalls();
});

let seq = 0;
const tag = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
async function account(email: string) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
async function waitFor(pred: () => boolean, what: string, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean, what: string, ms = 20_000): Promise<CallState> {
  const until = Date.now() + ms;
  while (!pred(call.getSnapshot())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await call.refresh();
    await sleep(100);
  }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
const sendIndex = (call: CallSession) => call.crypto.getSnapshot().media?.send?.index;
const onLatestKey = (call: CallSession) => waitFor(() => sendIndex(call) !== undefined && sendIndex(call) === call.crypto.getSnapshot().media?.epochs.at(-1)?.index, `${call.ticket.role} sending with its newest key`);
/** A test participant speaking in the call's room as `call`, with its own send key: a tone at `hz`, in sentences. */
async function speaks(call: CallSession, hz: number): Promise<void> {
  const p = await connect(await call.room(), { sending: call.crypto });
  rooms.push(p);
  await p.publishTone(hz, { onMs: 2600, offMs: 900 });
}

describe('the listener', () => {
  const listenerKey = () => h.deps.cfg.LISTENER_KEY ?? '';
  const listenerApi = (key = listenerKey()) => createListenerApi({ baseUrl: h.baseUrl, fetch: cookieFetch(ORIGIN), callPollMs: 50, key });
  /** A listener process registered with LiveKit under this run's name. rtc-node's own senders can only send under key index 0, so it hears their newest keys there. */
  const worker = () => {
    const w = serveDispatch({ livekitUrl: h.deps.cfg.LIVEKIT_URL, apiKey: h.deps.cfg.LIVEKIT_API_KEY, apiSecret: h.deps.cfg.LIVEKIT_API_SECRET, agentName: h.deps.cfg.LISTENER_AGENT, api: listenerApi(), keyIndex: () => 0 });
    serving.push(w);
    return w;
  };
  const Task = z.object({ task_id: z.string(), owner_id: z.string(), call_id: z.string(), place: z.string(), dispatches: z.number(), invite_id: z.string().nullable(), holder: z.string().nullable(), joined_at: z.date().nullable(), ended_why: z.string().nullable() });
  /** Every task the call has had, open or ended, oldest first: what's kept to look into afterwards. */
  const history = async (callId: string) => z.array(Task).parse((await h.pool.query('SELECT task_id, owner_id, call_id, place, dispatches, invite_id, holder, joined_at, ended_why FROM listen_tasks WHERE call_id = $1 ORDER BY created_at', [callId])).rows);
  const open = async (callId: string) => (await history(callId)).filter((t) => t.ended_why === null);
  const dispatching = () => new AgentDispatchClient(h.deps.cfg.LIVEKIT_URL.replace(/^ws/, 'http'), h.deps.cfg.LIVEKIT_API_KEY, h.deps.cfg.LIVEKIT_API_SECRET);
  /** The dispatches of this run's listener to the room (LiveKit lists others too). */
  const ours = async (roomName: string) => (await dispatching().listDispatch(roomName)).filter((x) => x.agentName === h.deps.cfg.LISTENER_AGENT);
  /** The invite the latest dispatch to the room carried, as a listener LiveKit sent would read it. */
  const inviteOf = async (roomName: string): Promise<string> => {
    const latest = (await ours(roomName)).sort((a, b) => Number((a.state?.createdAt ?? 0n) - (b.state?.createdAt ?? 0n))).at(-1);
    return z.object({ invite: z.string() }).parse(JSON.parse(latest?.metadata ?? '{}')).invite;
  };
  const keyPackages = async (callId: string) => (await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM call_mls WHERE call_id = $1 AND kind = 'keypackage'", [callId])).rows[0]?.n ?? -1;
  async function until(pred: () => Promise<boolean>, what: string, ms = 20_000): Promise<void> {
    const end = Date.now() + ms;
    while (!(await pred())) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  }

  it('is dispatched by LiveKit when notes go on, joins without anyone asking, and hears everyone under their own names', async () => {
    const w = worker();
    const org = await account(`organizer.${tag()}@tests.example`);
    const kofiEmail = `kofi@k${tag()}.example`;
    const { code } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(code, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(code, { mic: true, cam: false });
    await inGroup(kofi);

    // LiveKit pushes the job to the worker; it joins with the dispatch's invite, and the host's browser lets it in without asking.
    await waitFor(() => w.hearing() === 1, 'the listener hearing the call', 10_000);
    await settle(host, (s) => s.waiting.length === 0 && s.participants.length === 2, 'the listener let in, and shown to nobody');
    await waitFor(() => sendIndex(host) === sendIndex(kofi), 'everyone on the same keys');

    h.near.sayTone(330, 'We agreed to ship on Monday.');
    h.near.sayTone(550, 'I will send the release notes.');
    await speaks(host, 330);
    await speaks(kofi, 550);
    await onLatestKey(host);
    await onLatestKey(kofi);
    const said = await settle(host, (s) => ['We agreed to ship on Monday.', 'I will send the release notes.'].every((t) => s.transcript.some((x) => x.text === t)), 'both voices in the live transcript', 45_000);
    const speakerOf = (text: string) => said.transcript.find((x) => x.text === text)?.speaker?.name;
    expect(speakerOf('We agreed to ship on Monday.')).toBe(org.session.user.name);
    expect(speakerOf('I will send the release notes.')).toBe('Kofi');

    // Notes off: the listener sees the call no longer needs hearing, and leaves. The task stays, ended, saying why.
    await host.setNotes(false);
    await waitFor(() => w.hearing() === 0, 'the listener leaving once notes are off', 10_000);
    expect(await history(host.ticket.callId)).toEqual([expect.objectContaining({ place: 'main', dispatches: 1, holder: expect.stringMatching(/^p_/), joined_at: expect.any(Date), ended_why: 'notes-off' })]);
    // Notes on again: a new task, and a listener sent to it; the ended one is still there.
    await host.setNotes(true);
    await waitFor(() => w.hearing() === 1, 'a listener for notes on again', 10_000);
    expect((await history(host.ticket.callId)).map((t) => t.ended_why)).toEqual(['notes-off', null]);
    await host.leave();
    expect((await history(host.ticket.callId)).map((t) => t.ended_why)).toEqual(['notes-off', 'call-ended']);
  });

  it('keeps hearing someone who turns their camera off', async () => {
    const w = worker();
    const host = await noteTaking();
    await waitFor(() => w.hearing() === 1, 'the listener hearing the call', 10_000);
    const room = await connect(await host.room(), { sending: host.crypto });
    rooms.push(room);
    h.near.sayTone(370, 'Said with the camera on.');
    await room.publishTone(370, { onMs: 2600, offMs: 900 });
    const camera = await room.publishCamera();
    await onLatestKey(host);
    await settle(host, (s) => s.transcript.some((l) => l.text === 'Said with the camera on.'), 'what was said with the camera on', 45_000);
    // The camera goes off; the microphone stays on, and what's said is still heard.
    await room.unpublish(camera);
    h.near.sayTone(370, 'Said with the camera off.');
    await settle(host, (s) => s.transcript.some((l) => l.text === 'Said with the camera off.'), 'what was said with the camera off', 45_000);
    await host.leave();
  });

  it('is hidden in the room: nobody in the call sees it there, though it hears them', async () => {
    worker();
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.joined_at != null, 'the listener in');
    const listener = (await open(callId))[0]?.holder ?? '';
    await until(async () => (await h.deps.livekit.participants(roomName)).some((p) => p.identity === listener), 'the listener in the room');
    const hostRoom = await connect(await host.room(), { sending: host.crypto });
    rooms.push(hostRoom);
    await sleep(1500);
    expect(hostRoom.remoteIdentities()).not.toContain(listener);
    await host.leave();
  });

  it('is named to everyone in the call as the notes listener, never as someone in it, and not once notes are off', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    const id = listener.session.ticket.identity;
    // In the call's group, so every browser sees its keys go to it: named as the listener, and not among the people.
    const on = await settle(host, (s) => s.listeners.includes(id), 'the listener named');
    expect(on.listeners).toEqual([id]);
    expect(on.participants.map((p) => p.id)).not.toContain(id);
    expect(on.leaving.map((l) => l.id)).not.toContain(id);
    // Notes off: it's taken out of the group, and named no more.
    await host.setNotes(false);
    const off = await settle(host, (s) => s.listeners.length === 0, 'the listener gone');
    expect(off.participants.map((p) => p.id)).not.toContain(id);
    expect(off.leaving.map((l) => l.id)).not.toContain(id);
    listener.session.close();
    await host.leave();
  });

  it('is given nothing in the call: a document given to everyone in it goes to the people there, not the listener', async () => {
    const org = await account(`organizer.${tag()}@tests.example`);
    const { id } = await org.api.workspaces.create('Docs');
    const board = (await org.api.workspaces.items.create(id, { kind: 'board', name: 'Board' })).id;
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await inGroup(host);
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    await grantDocumentToCall(h.deps, { workspaceId: id }, board, { organizer: await openOwner(h.deps, org.session.ownerId, undefined), callId }, { role: 'read' });
    const seats = await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM document_access WHERE document_id = $1 AND kind = 'seat'", [board]);
    expect(seats.rows[0]?.n).toBe(1);
    listener.session.close();
    await host.leave();
  });

  it('lets nobody in with an invite used twice, expired, or without the listener service’s key', async () => {
    const org = await account(`organizer.${tag()}@tests.example`);
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await inGroup(host);
    const { callId, roomName } = host.ticket;
    // No listener is registered: LiveKit keeps the dispatch with nobody to take it, and its invite is good for a minute.
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    const invite = await inviteOf(roomName);
    const before = await keyPackages(callId);
    expect(code(await listenerApi('not-the-listener-key-not-the-listener-key').join(invite).catch((e: unknown) => e))).toBe('unauthenticated');
    const first = await listenerApi().join(invite);
    expect(code(await listenerApi().join(invite).catch((e: unknown) => e))).toBe('unauthenticated');
    expect(await keyPackages(callId)).toBe(before + 1);
    expect((await open(callId))[0]).toMatchObject({ invite_id: null, holder: first.session.ticket.identity });
    // It goes: another is sent, and that invite is no good once it's too old.
    first.session.close();
    await hook('participant_left', roomName, first.session.ticket.identity);
    await until(async () => (await open(callId))[0]?.dispatches === 2, 'another listener sent');
    const second = await inviteOf(roomName);
    expect(second).not.toBe(invite);
    await h.pool.query(`UPDATE listen_tasks SET dispatched_at = now() - interval '2 minutes' WHERE call_id = $1 AND ended_at IS NULL`, [callId]);
    expect(code(await listenerApi().join(second).catch((e: unknown) => e))).toBe('unauthenticated');
    await host.leave();
  });

  it('tells LiveKit nothing about the call or its account in what a dispatch carries', async () => {
    const org = await account(`organizer.${tag()}@tests.example`);
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await inGroup(host);
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    // What LiveKit holds: the dispatch's metadata, as its operator could read it.
    const dispatches = await ours(roomName);
    expect(dispatches.length).toBeGreaterThan(0);
    const metadata = dispatches.map((x) => x.metadata).join(' ');
    expect(metadata).toContain('invite');
    const ownerId = org.session.ownerId;
    for (const secret of [ownerId, callId]) for (const enc of [secret, Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url')]) expect(metadata.includes(enc), secret).toBe(false);
    for (const t of dispatches) expect(z.object({ invite: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).safeParse(JSON.parse(t.metadata)).success).toBe(true);
    await host.leave();
  });

  it('keeps ended tasks for a week, then maintenance deletes them', async () => {
    const org = await account(`organizer.${tag()}@tests.example`);
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await inGroup(host);
    const { callId } = host.ticket;
    await host.leave();
    expect((await history(callId)).map((t) => t.ended_why)).toEqual(['call-ended']);
    const { maintain } = await import('../../maintenance');
    await maintain(h.deps);
    expect(await history(callId)).toHaveLength(1);
    await h.pool.query(`UPDATE listen_tasks SET ended_at = now() - interval '8 days' WHERE call_id = $1`, [callId]);
    await maintain(h.deps);
    expect(await history(callId)).toEqual([]);
  });

  /** A listener process of its own, registered with LiveKit. */
  const process_ = async () => { const w = startWorker(h); workers.push(w); await w.registered(); return w; };
  /** A webhook signed the way LiveKit signs them, posted to the API. */
  const hook = async (event: string, roomName: string, identity: string) => {
    const body = JSON.stringify({ event, room: { name: roomName }, participant: { identity } });
    const r = await fetch(`${h.baseUrl}/hooks/livekit`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await signWebhook(h.deps.cfg, body) }, body });
    expect(r.status).toBe(200);
  };
  /** A call with notes on, its organizer hosting. */
  const noteTaking = async () => {
    const org = await account(`organizer.${tag()}@tests.example`);
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await inGroup(host);
    return host;
  };
  const heldBy = async (callId: string) => (await open(callId))[0]?.holder ?? null;

  it('sends another listener when the one hearing the call crashes, and takes the crashed one out', async () => {
    const a = await process_();
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.joined_at != null, 'the first listener in');
    const first = await heldBy(callId);
    const b = await process_();
    a.crash();
    // LiveKit notices the crashed listener gone (about 21 s for a crash) and says so: here, at once.
    await hook('participant_left', roomName, first ?? '');
    await until(async () => { const t = (await open(callId))[0]; return t?.joined_at != null && t.holder !== first; }, 'another listener in', 30_000);
    expect((await open(callId))[0]?.dispatches).toBe(2);
    expect(b.lines.some((l) => l.includes('listener registered with LiveKit'))).toBe(true);
    await host.leave();
  });

  it('sends a listener once there is one to send, when there was none at first', async () => {
    const host = await noteTaking();
    const { callId } = host.ticket;
    await sleep(3000);
    expect((await open(callId))[0]).toMatchObject({ dispatches: 1, holder: null });
    await process_();
    await until(async () => (await open(callId))[0]?.joined_at != null, 'a listener in once one is registered', 25_000);
    expect((await open(callId))[0]?.dispatches).toBeGreaterThanOrEqual(2);
    await host.leave();
  });

  it('sends no listener when there’s no listener service to send', async () => {
    const host = await noteTaking();
    const { callId } = host.ticket;
    await until(async () => (await open(callId))[0]?.dispatches === 1, 'the first send');
    await h.pool.query(`UPDATE listen_tasks SET dispatched_at = now() - interval '1 minute' WHERE call_id = $1 AND ended_at IS NULL`, [callId]);
    // An API with no LISTENER_KEY (as in production until listeners are attested): nothing could join, so nothing is sent.
    const { LISTENER_KEY: _, ...withoutKey } = h.deps.cfg;
    expect(await supervise({ ...h.deps, cfg: withoutKey })).toBe(0);
    expect((await open(callId))[0]?.dispatches).toBe(1);
    await host.leave();
  });

  it('sends one listener, not two, when two instances look at once', async () => {
    const host = await noteTaking();
    const { callId } = host.ticket;
    await until(async () => (await open(callId))[0]?.dispatches === 1, 'the first send');
    // Long enough ago that it's due again, then two looks at once.
    await h.pool.query(`UPDATE listen_tasks SET dispatched_at = now() - interval '1 minute' WHERE call_id = $1 AND ended_at IS NULL`, [callId]);
    await Promise.all([supervise(h.deps), supervise(h.deps)]);
    expect((await open(callId))[0]?.dispatches).toBe(2);
    await host.leave();
  });

  it('waits to send another listener when one can’t come in yet, rather than sending them one after another', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.dispatches === 1, 'the first send');
    // The host's connection is away: nobody can let a listener into the call's group, so it's refused.
    await hook('participant_left', roomName, host.ticket.identity);
    expect(code(await listenerApi().join(await inviteOf(roomName)).then(() => 'joined', (e: unknown) => e))).toBe('conflict');
    // Another is sent only once the first is overdue (ARRIVE_WITHIN_MS), not at once and again and again.
    await sleep(3000);
    expect((await open(callId))[0]).toMatchObject({ dispatches: 1 });
    await until(async () => (await open(callId))[0]?.dispatches === 2, 'another listener sent once the first is overdue', 25_000);
    await host.leave();
  });

  it('sends another listener after a wait, not at once, when one leaves without ever being heard', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    // It joins through the API, then gives up (the host's browser was slow to let it in, or it failed part way): no
    // LiveKit webhook ever says it left, since it never reached the room. One that fails like this every time would
    // otherwise come and go over and over, each time moving everyone's keys on.
    const quitter = await listenerApi().join(await inviteOf(roomName));
    await quitter.session.leave();
    await sleep(3000);
    expect((await open(callId))[0]).toMatchObject({ dispatches: 1 });
    await until(async () => (await open(callId))[0]?.dispatches === 2, 'another listener sent once the wait is over', 25_000);
    expect((await open(callId))[0]?.holder).toBeNull();
    await host.leave();
  });

  it('sends nothing while notes are paused, and carries on once they resume', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    const sends: number[] = [];
    const hearing = await listen({ session: listener.session, keyIndex: () => 0, send: async (clip, speaker) => { sends.push(Date.now()); await listener.session.transcribe(clip, speaker); } });
    h.near.sayTone(410, 'Said before the pause.');
    await speaks(host, 410);
    await onLatestKey(host);
    await waitFor(() => sends.length > 0, 'a clip sent before the pause', 30_000);
    await host.pause();
    await waitFor(() => listener.session.getSnapshot().capture.mode === 'paused', 'the listener seeing the pause', 10_000);
    // The pause promises nothing is transcribed or sent until notes resume: the listener sends nothing at all.
    const atPause = sends.length;
    await sleep(8000);
    expect(sends.length).toBe(atPause);
    await host.resume();
    await waitFor(() => sends.length > atPause, 'a clip sent once notes resume', 30_000);
    await hearing.stop();
    listener.session.close();
    await host.leave();
  });

  it('takes the host’s browser’s clips again once the listener hearing the call goes quiet, and sends another', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    await host.appendAudio({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    await listener.session.transcribe({ data: new Blob([speechWav('Heard by the listener.', 3000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 3000 }, host.ticket.identity);
    await host.transcribe({ data: new Blob([speechWav('Set aside while the listener hears.', 3000)], { type: 'audio/wav' }), segment: 0, at: 4, durationMs: 3000 }, host.ticket.identity);
    // It goes quiet with nobody saying so (a crash LiveKit's word of never arrived): nothing from it for a minute.
    listener.session.close();
    await h.pool.query(`UPDATE listen_tasks SET seen_at = now() - interval '1 minute' WHERE call_id = $1 AND ended_at IS NULL`, [callId]);
    await host.transcribe({ data: new Blob([speechWav('Heard by the browser once the listener went quiet.', 3000)], { type: 'audio/wav' }), segment: 0, at: 8, durationMs: 3000 }, host.ticket.identity);
    const lines = (await settle(host, (s) => s.transcript.some((l) => l.text === 'Heard by the browser once the listener went quiet.'), 'the browser’s line')).transcript.map((l) => l.text);
    expect(lines).not.toContain('Set aside while the listener hears.');
    expect(await supervise(h.deps)).toBe(1);
    expect((await open(callId))[0]?.dispatches).toBe(2);
    await host.leave();
  });

  it('takes the host’s browser’s clips in a new segment until the listener’s are taken there', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    await host.appendAudio({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    await listener.session.transcribe({ data: new Blob([speechWav('Heard by the listener in the first segment.', 3000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 3000 }, host.ticket.identity);
    // Paused and resumed: a new segment, which the listener hasn't been heard in yet.
    await host.pause();
    await host.resume();
    const segment = (await settle(host, (s) => s.notes.recording.segment > 0, 'a new segment')).notes.recording.segment;
    await host.appendAudio({ data: new Blob([new Uint8Array(2048)]), segment, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
    await listener.session.refresh({ call: true, log: false });
    await host.transcribe({ data: new Blob([speechWav('Heard by the browser in the new segment.', 3000)], { type: 'audio/wav' }), segment, at: 0, durationMs: 3000 }, host.ticket.identity);
    await listener.session.transcribe({ data: new Blob([speechWav('Heard by the listener in the new segment.', 3000)], { type: 'audio/wav' }), segment, at: 4, durationMs: 3000 }, host.ticket.identity);
    await host.transcribe({ data: new Blob([speechWav('Set aside once the listener is heard again.', 3000)], { type: 'audio/wav' }), segment, at: 8, durationMs: 3000 }, host.ticket.identity);
    const lines = (await settle(host, (s) => s.transcript.some((l) => l.text === 'Heard by the listener in the new segment.'), 'the listener’s line in the new segment')).transcript.map((l) => l.text);
    expect(lines).toContain('Heard by the browser in the new segment.');
    expect(lines).not.toContain('Set aside once the listener is heard again.');
    listener.session.close();
    await host.leave();
  });

  it('says the transcript goes on while the host’s browser is away and the listener hears, but not the recording', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    await host.appendAudio({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    // The host's browser leaves the room (a reload, a dropped connection) before the listener is heard: nothing is captured.
    await hook('participant_left', roomName, host.ticket.identity);
    expect((await settle(host, (s) => s.capture.away, 'the host away')).capture.mode).toBe('unavailable');
    // Once the listener is heard, the transcript goes on; the recording is the host's browser's, so it doesn't.
    await listener.session.transcribe({ data: new Blob([speechWav('Heard by the listener while the host is away.', 3000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 3000 }, host.ticket.identity);
    const c = (await settle(host, (s) => s.capture.mode === 'on', 'notes on again')).capture;
    expect({ transcript: c.transcript.mode, recording: c.recording.mode, away: c.away }).toEqual({ transcript: 'on', recording: 'unavailable', away: true });
    listener.session.close();
    await host.leave();
  });

  it('lets a listener’s pass do nothing in the call but hear it', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    const r = await cookieFetch(ORIGIN)(`${h.baseUrl}/v1/live/calls/${callId}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', [CALL_PASS_HEADER]: listener.session.ticket.pass }, body: JSON.stringify({ type: 'hand', up: true })
    });
    expect(r.status).toBe(403);
    listener.session.close();
    await host.leave();
  });

  it('takes the main room from the listener alone once what it sends is taken, and the browser’s until then', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    await host.appendAudio({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
    // Before a listener hears it, the host's browser's speech is taken, as it always was.
    await host.transcribe({ data: new Blob([speechWav('Heard by the browser first.', 3000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 3000 }, host.ticket.identity);
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    // In the call but nothing of its taken yet (it may still be coming into the room): the browser's is still taken.
    await host.transcribe({ data: new Blob([speechWav('Heard by the browser while the listener comes in.', 3000)], { type: 'audio/wav' }), segment: 0, at: 4, durationMs: 3000 }, host.ticket.identity);
    await listener.session.transcribe({ data: new Blob([speechWav('Heard by the listener.', 3000)], { type: 'audio/wav' }), segment: 0, at: 8, durationMs: 3000 }, host.ticket.identity);
    // Once the listener's is taken, the browser's is taken as received and set aside: nothing is transcribed twice.
    await host.transcribe({ data: new Blob([speechWav('Heard by the browser again.', 3000)], { type: 'audio/wav' }), segment: 0, at: 12, durationMs: 3000 }, host.ticket.identity);
    await listener.session.transcribe({ data: new Blob([speechWav('Heard by the listener again.', 3000)], { type: 'audio/wav' }), segment: 0, at: 12, durationMs: 3000 }, host.ticket.identity);
    const lines = (await settle(host, (s) => s.transcript.some((l) => l.text === 'Heard by the listener again.'), 'the listener’s second line')).transcript.map((l) => l.text);
    // (The browser's are placed by its own clock, the listener's by the server's, so here they needn't fall in this order.)
    expect([...lines].sort()).toEqual(['Heard by the browser first.', 'Heard by the browser while the listener comes in.', 'Heard by the listener again.', 'Heard by the listener.']);
    listener.session.close();
    await host.leave();
  });

  it('refuses a listener whose part of the call ended under it for good, so it leaves', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    const listener = await listenerApi().join(await inviteOf(roomName));
    await inGroup(listener.session);
    // Notes off and straight back on: a new task, and this listener doesn't hold it.
    await host.setNotes(false);
    await host.setNotes(true);
    const clip = { data: new Blob([speechWav('Said to an old listener.', 3000)], { type: 'audio/wav' }), segment: host.getSnapshot().notes.recording.segment, at: 0, durationMs: 3000 };
    expect(code(await listener.session.transcribe(clip, host.ticket.identity).then(() => 'taken', (e: unknown) => e))).toBe('forbidden');
    listener.session.close();
    await host.leave();
  });

  it('puts a listener out of the call when notes go off, even one that won’t go: out of the room and the keys, with no way back', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    // A listener that ignores being told notes are off: it stays connected, and would come back in if it could.
    const stubborn = await listenerApi().join(await inviteOf(roomName));
    await inGroup(stubborn.session);
    const identity = stubborn.session.ticket.identity;
    rooms.push(await connect(await stubborn.session.room()));
    await until(async () => (await h.deps.livekit.participants(roomName)).some((p) => p.identity === identity), 'the listener in the room');
    await host.setNotes(false);
    // The API takes it out of the room, and the host's browser takes it out of the call's group, so the keys move on without it.
    await until(async () => !(await h.deps.livekit.participants(roomName)).some((p) => p.identity === identity), 'the listener out of the room');
    await waitFor(() => ['removed', 'denied'].includes(stubborn.session.crypto.getSnapshot().status), 'the listener out of the call’s group');
    // It can't come back the way a dropped connection does.
    await sleep(3000);
    expect(['removed', 'denied']).toContain(stubborn.session.crypto.getSnapshot().status);
    stubborn.session.close();
    await host.leave();
  });

  it('takes a late or repeated webhook about a listener as it was, and refuses what a replaced listener sends', async () => {
    const host = await noteTaking();
    const { callId, roomName } = host.ticket;
    await until(async () => (await open(callId))[0]?.invite_id != null, 'the task sent a listener');
    const old = await listenerApi().join(await inviteOf(roomName));
    await inGroup(old.session);
    // LiveKit says it left (a blip): another is sent, and this one is out of the call.
    await hook('participant_left', roomName, old.session.ticket.identity);
    await until(async () => (await open(callId))[0]?.dispatches === 2, 'another listener sent');
    const after = (await open(callId))[0];
    // Late and repeated news about the replaced one changes nothing.
    await hook('participant_joined', roomName, old.session.ticket.identity);
    await hook('participant_left', roomName, old.session.ticket.identity);
    expect((await open(callId))[0]).toEqual(after);
    // What it still sends isn't taken.
    const clip = { data: new Blob([speechWav('Said after it was replaced.', 1000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 1000 };
    expect(code(await old.session.transcribe(clip, host.ticket.identity).then(() => 'taken', (e: unknown) => e))).toMatch(/^(forbidden|conflict|unauthenticated)$/);
    expect(host.getSnapshot().transcript.some((l) => l.text === 'Said after it was replaced.')).toBe(false);
    old.session.close();
    await host.leave();
  });
});
