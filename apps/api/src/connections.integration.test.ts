/**
 * What a request takes of the database's connections. A transaction holds one for as long as it lasts, so anything it
 * reads through the pool instead of on that connection waits for a second, and enough at once wait for each other for
 * ever. Whole flows run here on a server with a single connection, where one such read can't get past itself, and the
 * real API over HTTP via @alcove/api-http does everything else as it always does.
 */
import { DEFAULT_NOTES_CHOICES, type AudioPiece, type CallSession, type CallState, type MeetingInput, type NoteProgress, type TranscriptClip } from '@alcove/api';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPool, tx } from './db';
import { maintain } from './maintenance';
import { HANDOFF_MS, reconcile } from './modules/calls';
import { openOwner } from './owners';
import { speechWav } from './testing/fake-near';
import { ORIGIN, cookieFetch, startHarness, type Harness } from './testing/harness';
import { connect, disposeLiveKit, participantsDirectly, signWebhook, type TestParticipant } from './testing/livekit';
import { getItem, saveRevision } from './vault';

vi.setConfig({ testTimeout: 60_000 });

let h: Harness;
let one: pg.Pool;
let single: { baseUrl: string; close(): Promise<void> };
beforeAll(async () => {
  h = await startHarness();
  // A read that waits for a second connection fails here in seconds: without this it would wait for ever.
  one = new pg.Pool({ connectionString: h.deps.cfg.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  single = await h.secondServer({}, undefined, one);
});
afterAll(async () => { await single?.close(); await one?.end(); await h?.close(); await disposeLiveKit(); });
const rooms: TestParticipant[] = [];
afterEach(async () => { await Promise.all(rooms.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A browser whose every request goes to `base`: the server with one connection, unless it's told otherwise. */
function browserOn(base: () => string) {
  const inner = cookieFetch(ORIGIN);
  const f: typeof fetch = (input, init) => { const url = new URL(String(input)); return inner(`${base()}${url.pathname}${url.search}`, init); };
  return h.browser({ fetch: f });
}
async function account(email = unique(), base = () => single.baseUrl) {
  const b = browserOn(base);
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
const piece = (at: number, durationMs = 5000): AudioPiece => ({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq: at, at: at * 5, durationMs, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, atMs: number, ms = 6000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: ms });
async function written(b: Account, noteId: string): Promise<NoteProgress[]> {
  const steps: NoteProgress[] = [];
  for await (const p of b.api.notes.progress(noteId)) steps.push(p);
  return steps;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** In the call's LiveKit room as its browser would be, which is what lets someone host. */
async function inRoom(call: CallSession): Promise<TestParticipant> {
  await inGroup(call);
  const p = await connect(await call.room(), { sending: call.crypto });
  rooms.push(p);
  return p;
}
async function settle(call: CallSession, pred: (s: CallState) => boolean, what: string): Promise<CallState> {
  await waitFor(async () => { await call.refresh().catch(() => undefined); return pred(call.getSnapshot()); }, what);
  return call.getSnapshot();
}
/** The organizer and someone invited, both in the call and its room. */
async function twoInCall() {
  const org = await account();
  const kofi = await account();
  const { code: link } = await org.api.calls.startNow({ guests: [kofi.email], notes: 'on' });
  const host = await org.api.calls.join(link, { mic: true, cam: false });
  const hostRoom = await inRoom(host);
  const call = await kofi.api.calls.join(link, { mic: true, cam: false });
  await inRoom(call);
  return { org, link, host, hostRoom, call };
}
const call = (more: Partial<MeetingInput> = {}): MeetingInput => ({ title: 'One connection', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: DEFAULT_NOTES_CHOICES, ...more });

describe('a server with one connection to the database', () => {
  it('takes a call from start to end, and writes its notes', async () => {
    const org = await account();
    const lena = unique('lena');
    const meeting = await org.api.meetings.create(call({ guests: [lena] }));
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    await inGroup(host);
    await host.appendAudio(piece(0));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    const invited = await account(lena);
    const session = await invited.api.calls.join(meeting.code, { mic: true, cam: false });
    await inGroup(session);
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    await written(org, noteId);
    expect(await org.api.notes.get(noteId)).toMatchObject({ status: 'ready', decisions: [{ text: 'We agreed to ship on Monday.' }], audio: [{ index: 0 }] });
    expect((await invited.api.notes.get(noteId)).status).toBe('ready');
  });

  it('hands a call on, and the organizer takes it back', async () => {
    const { org, link, host, call } = await twoInCall();
    await settle(host, (s) => s.host.next.includes(call.ticket.identity), 'someone who could host');
    await host.handOff(call.ticket.identity);
    await settle(call, (s) => s.isHost, 'Kofi hosting');
    const back = await org.api.calls.join(link, { mic: true, cam: false });
    await settle(back, (s) => s.isHost && s.isOrganizer, 'the organizer back');
    await settle(call, (s) => !s.isHost, 'Kofi told');
    await back.leave();
  });

  it('finds someone else to host when the host’s connection goes', async () => {
    const { host, hostRoom, call } = await twoInCall();
    await hostRoom.disconnect();
    await waitFor(async () => !(await participantsDirectly(h.deps.cfg, host.ticket.roomName)).some((p) => p.identity === host.ticket.identity), 'LiveKit to let go of the host');
    const body = JSON.stringify({ event: 'participant_left', room: { name: host.ticket.roomName }, participant: { identity: host.ticket.identity } });
    const told = await fetch(`${single.baseUrl}/hooks/livekit`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await signWebhook(h.deps.cfg, body) }, body });
    expect(told.status).toBe(200);
    await reconcile({ ...h.deps, pool: one }, Date.now() + HANDOFF_MS + 1_000);
    await settle(call, (s) => s.isHost, 'Kofi hosting');
  });

  it('bills a note stopped by the previous release, which only its audio can say the length of', async () => {
    let server = single.baseUrl;
    const org = await account(unique(), () => server);
    const meeting = await org.api.meetings.create(call());
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    await host.appendAudio(piece(0, 90_000));
    await host.transcribe(speech('We agreed to ship on Monday.', 0), host.ticket.identity);
    // Stopped where no notes service is connected: the job waits, and the note goes back to how that release sealed it.
    const plain = await h.secondServer({ NEAR_AI_API_KEY: undefined });
    server = plain.baseUrl;
    const res = await org.fetch(`${server}/v1/live/calls/${host.ticket.callId}/leave`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': host.ticket.pass }, body: JSON.stringify({ end: true }) });
    server = single.baseUrl;
    await plain.close();
    expect(res.status).toBe(200);
    const noteId = z.object({ ended: z.object({ pendingNoteId: z.string() }) }).parse(await res.json()).ended.pendingNoteId;
    const o = await openOwner(h.deps, org.session.ownerId, undefined);
    await tx(h.pool, async (c) => {
      const cur = await getItem(o, c, 'note', noteId, z.record(z.string(), z.unknown()), 'That note');
      const { recorded: _recorded, ...older } = cur.manifest;
      await saveRevision(o, c, noteId, cur.revisionId, older);
    });
    const before = (await org.api.credits.balance()).balance;
    await maintain({ ...h.deps, pool: one });
    expect(await org.api.notes.get(noteId)).toMatchObject({ status: 'ready', decisions: [{ text: 'We agreed to ship on Monday.' }] });
    expect((await org.api.credits.balance()).balance).toBe(before - 50);
  });
});

describe('every connection taken', () => {
  it('ends twelve calls at once, more than there are connections', async () => {
    const onMain = () => h.baseUrl;
    const hosts = await Promise.all(Array.from({ length: 12 }, async () => {
      const org = await account(unique(), onMain);
      const meeting = await org.api.meetings.create(call());
      const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
      await host.appendAudio(piece(0));
      return host;
    }));
    const ended = await Promise.all(hosts.map((host) => host.leave()));
    expect(ended.filter((e) => e?.pendingNoteId)).toHaveLength(12);
  });

  it('turns a request away in seconds rather than keep it waiting', async () => {
    const pool = createPool(h.deps.cfg.DATABASE_URL);
    const server = await h.secondServer({}, undefined, pool);
    let target = h.baseUrl;
    const org = await account(unique(), () => target);
    const held = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
    try {
      target = server.baseUrl;
      const t0 = Date.now();
      const refused = await org.fetch(`${target}/v1/meetings?range=upcoming`);
      expect(refused.status).toBe(500);
      expect(z.object({ code: z.string() }).parse(await refused.json()).code).toBe('unknown');
      const waited = Date.now() - t0;
      expect(waited).toBeGreaterThanOrEqual(9000);
      expect(waited).toBeLessThan(20_000);
    } finally {
      for (const c of held) c.release();
      await server.close();
      await pool.end();
    }
  });
});
