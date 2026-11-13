/**
 * What happens to shared screens around the notes (docs: Calls and recordings › Shared screens), end to end: the real
 * API over HTTP via @alcove/api-http, real Postgres, the object store, LiveKit and the fake NEAR AI. A call that doesn't
 * keep its recording doesn't keep its screens' video past the notes, a share that can't be joined is let go once, and
 * the model that reads shared screens can be chosen while notes wait.
 */
import { DEFAULT_NOTES_CHOICES, errorCode, type AlcoveApi, type AudioPiece, type CallSession, type NoteProgress, type ScreenPiece, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { joinDue, purgeVideo } from './screens';
import { work } from '../../notes/writing/writer';
import { openOwner } from '../../../keys/owners';
import { queueDelete } from '../../../platform/objects';
import { webmDuration } from '../ffmpeg';
import { ObjectStoreError } from '../../../platform/errors';
import { tx } from '../../../platform/db';
import { speechWav } from '../../../testing/fakes/near';
import { startHarness, type Harness } from '../../../testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from '../../../testing/livekit';
import { cut, recordedWebm } from '../../../testing/video';

// Sharing a screen goes through a real LiveKit server, which a busy CI runner can be slow to set up.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const open: TestParticipant[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
type Account = Awaited<ReturnType<typeof account>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
async function written(api: AlcoveApi, noteId: string): Promise<NoteProgress[]> {
  const steps: NoteProgress[] = [];
  for await (const p of api.notes.progress(noteId)) steps.push(p);
  return steps;
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** Connects to the call's room the way a browser does and shares a screen, waiting until LiveKit lists it (what the API checks pieces against). */
async function shareScreen(call: CallSession): Promise<void> {
  await inGroup(call);
  const p = await connect(await call.room(), { sending: call.crypto });
  open.push(p);
  const { screen } = await p.publishScreen(false);
  const room = p.room.name ?? '';
  for (let i = 0; i < 300; i++) {
    if ((await h.deps.livekit.screenShares(room)).some((x) => x.sid === screen)) return;
    await sleep(50);
  }
  throw new Error('timed out waiting for LiveKit to list the share');
}
const audio = (segment: number): AudioPiece => {
  const src = Buffer.concat([Buffer.from('audio'), randomBytes(1024)]);
  const bytes = new Uint8Array(new ArrayBuffer(src.length));
  bytes.set(src);
  return { data: new Blob([bytes]), segment, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
};
const screenPiece = (share: string, segment: number, i: number, data: Uint8Array<ArrayBuffer>): ScreenPiece =>
  ({ data: new Blob([data]), share, segment, seq: i, at: i * 5, durationMs: 5000, mimeType: 'video/webm;codecs=vp8' });
const speech = (words: string, segment: number): TranscriptClip => ({ data: new Blob([speechWav(words, 3000)], { type: 'audio/wav' }), segment, at: 0, durationMs: 3000 });
const SAID = 'We agreed to ship on Monday. // As you can see the chart is up. // Thanks everyone, talk soon.';
const count = async (table: 'screen_pieces' | 'screen_videos', ownerId: string) =>
  z.object({ n: z.coerce.number() }).parse((await h.pool.query(`SELECT count(*) AS n FROM ${table} WHERE owner_id = $1`, [ownerId])).rows[0]).n;
const logged = (msg: string, recordingId: string) => h.logs.filter((l) => l.includes(`"msg":"${msg}`) && l.includes(recordingId)).length;
const noteOf = async (call: CallSession) => { const end = await call.leave(); if (!end?.pendingNoteId) throw new Error('the call left no note'); return end.pendingNoteId; };
/**
 * A call's shares' tails over at once, and its notes written now rather than when their job next looks: its recording
 * stopped 30 seconds earlier, so no last piece can still come (SHARE_TAIL_MS), and the job, which looked as the call
 * ended and waits that out without using an attempt, is due as soon as it has decided whether it waits.
 */
async function tailOver(ownerId: string): Promise<void> {
  await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [ownerId]);
  const deciding = async () => (await h.pool.query<{ state: string }>(`SELECT state FROM content_jobs WHERE owner_id = $1 AND kind = 'notes'`, [ownerId])).rows.some((j) => j.state === 'writing');
  for (let i = 0; i < 400 && (await deciding()); i++) await sleep(25);
  await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1 AND kind = 'notes' AND state = 'queued'`, [ownerId]);
  await work(h.deps, { ownerId });
}

async function held(org: Account, choices: Partial<typeof DEFAULT_NOTES_CHOICES>) {
  const meeting = await org.api.meetings.create({
    title: 'Supplier review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: { ...DEFAULT_NOTES_CHOICES, ...choices }
  });
  return org.api.calls.join(meeting.code, { mic: true, cam: false });
}

describe('shared screens around the notes', () => {
  it('enforces one share’s storage budget when several pieces arrive together', async () => {
    const org = await account(unique('organizer'));
    const call = await held(org, {});
    const { share } = await call.startShare({ notes: true });
    await shareScreen(call);
    const lock = await h.pool.connect();
    const results: PromiseSettledResult<void>[] = [];
    let pending: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT 1 FROM owners WHERE owner_id = $1 FOR UPDATE', [org.session.ownerId]);
      const data = new Uint8Array(randomBytes(3 * 1024 * 1024));
      pending = Promise.allSettled(Array.from({ length: 4 }, (_, i) => call.appendScreen(screenPiece(share, 0, i, data))));
      await waitFor(async () => {
        const waiting = await h.pool.query<{ n: string }>(`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND (query LIKE 'UPDATE owners SET stored_bytes%' OR query LIKE 'SELECT keep FROM screen_shares%' OR query LIKE 'SELECT 1 FROM screen_shares%')`);
        return Number(waiting.rows[0]?.n ?? 0) >= 4;
      }, 'the concurrent pieces to reach their storage transactions', 5000);
      await lock.query('COMMIT');
      results.push(...await pending);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await pending;
    }
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThan(4);
    expect(results.some((r) => r.status === 'rejected')).toBe(true);
    await call.leave();
  });

  it('drops an in-flight join when temporary video is deleted before its commit', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const call = await held(org, { keepRecording: false });
    const { share } = await call.startShare({ notes: true });
    await shareScreen(call);
    for (const [i, data] of cut(await recordedWebm(10), 2).entries()) await call.appendScreen(screenPiece(share, 0, i, data));
    await call.shareEnded(share);
    const configured = h.deps.cfg;
    h.deps.cfg = { ...configured, NEAR_AI_API_KEY: '' };
    const lock = await h.pool.connect();
    const owner = await openOwner(h.deps, ownerId, undefined);
    let joining: Promise<unknown> | undefined;
    try {
      await noteOf(call);
      await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [ownerId]);
      const row = (await h.pool.query<{ recording_id: string }>('SELECT recording_id FROM recordings WHERE owner_id = $1', [ownerId])).rows[0];
      if (!row) throw new Error('the call left no recording');
      await lock.query('BEGIN');
      await lock.query('SELECT 1 FROM screen_shares WHERE owner_id = $1 AND recording_id = $2 FOR UPDATE', [ownerId, row.recording_id]);
      joining = joinDue(h.deps, ownerId);
      await waitFor(async () => {
        const waiting = await h.pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT 1 FROM screen_shares%'`);
        return Boolean(waiting.rowCount);
      }, 'the completed remux to wait for its commit');
      // Another instance finished the notes and purged the temporary recording while this instance was remuxing.
      const gone = await purgeVideo(owner, lock, row.recording_id);
      await lock.query('COMMIT');
      await queueDelete(owner, gone);
      await joining;
      expect(await count('screen_pieces', ownerId)).toBe(0);
      expect(await count('screen_videos', ownerId)).toBe(0);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await joining;
      owner.root.fill(0);
      owner.wrapKey.fill(0);
      h.deps.cfg = configured;
    }
  });

  it('refuses a tail piece whose object write finishes after its temporary recording was purged', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const call = await held(org, { keepRecording: false });
    const { share } = await call.startShare({ notes: true });
    await shareScreen(call);
    const video = cut(await recordedWebm(10), 2);
    const head = video[0];
    const tail = video[1];
    if (!head || !tail) throw new Error('the video needs two pieces');
    await call.appendScreen(screenPiece(share, 0, 0, head));
    await call.shareEnded(share);
    const configured = h.deps.cfg;
    h.deps.cfg = { ...configured, NEAR_AI_API_KEY: '' };
    const objects = h.deps.objects;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let blocked = false;
    let upload: Promise<string> | undefined;
    const owner = await openOwner(h.deps, ownerId, undefined);
    h.deps.objects = { ...objects, put: async (id, bytes) => { blocked = true; await gate; return objects.put(id, bytes); } };
    try {
      upload = call.appendScreen(screenPiece(share, 0, 1, tail)).then(() => 'stored', (e: unknown) => errorCode(e));
      await waitFor(() => blocked, 'the admitted tail piece to wait on its object write');
      await noteOf(call);
      const row = (await h.pool.query<{ recording_id: string }>('SELECT recording_id FROM recordings WHERE owner_id = $1', [ownerId])).rows[0];
      if (!row) throw new Error('the call left no recording');
      await queueDelete(owner, await tx(h.pool, (c) => purgeVideo(owner, c, row.recording_id)));
      release();
      expect(await upload).toBe('not-found');
      expect(await count('screen_pieces', ownerId)).toBe(0);
      expect(await count('screen_videos', ownerId)).toBe(0);
    } finally {
      release();
      await upload;
      owner.root.fill(0);
      owner.wrapKey.fill(0);
      h.deps.objects = objects;
      h.deps.cfg = configured;
    }
  });

  it('stages a larger replay while its input is arriving, seals every temporary object and removes them afterwards', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const call = await held(org, {});
    const { share } = await call.startShare({ notes: true });
    await shareScreen(call);
    const canary = 'CANARY-screen-remux-stage-private-title';
    const video = await recordedWebm(90, { size: '960x540', title: canary });
    expect(video.length).toBeGreaterThan(1024 * 1024);
    for (const [i, data] of cut(video, 18).entries()) await call.appendScreen(screenPiece(share, 0, i, data));
    await call.shareEnded(share);
    const configured = h.deps.cfg;
    h.deps.cfg = { ...configured, NEAR_AI_API_KEY: '' };
    const objects = h.deps.objects;
    const input = new Set((await h.pool.query<{ object_id: string }>('SELECT object_id FROM screen_pieces WHERE owner_id = $1', [ownerId])).rows.map((r) => r.object_id));
    const fetched = new Set<string>();
    const created = new Set<string>();
    let stagedBeforeEnd = false;
    let plaintext = false;
    h.deps.objects = {
      ...objects,
      get: async (id) => { if (input.has(id)) fetched.add(id); return objects.get(id); },
      put: async (id, bytes) => {
        created.add(id);
        if (fetched.size < input.size) stagedBeforeEnd = true;
        if (Buffer.from(bytes).includes(Buffer.from(canary))) plaintext = true;
        return objects.put(id, bytes);
      }
    };
    try {
      const noteId = await noteOf(call);
      await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [ownerId]);
      await joinDue(h.deps, ownerId);
      expect(stagedBeforeEnd).toBe(true);
      expect(plaintext).toBe(false);
      const response = await org.fetch(org.api.notes.screenVideoUrl(noteId, share, 0));
      expect(response.status).toBe(200);
      expect(webmDuration(new Uint8Array(await response.arrayBuffer()))).toBeCloseTo(90, 0);
      const kept = new Set((await h.pool.query<{ object_id: string }>('SELECT object_id FROM screen_videos WHERE owner_id = $1', [ownerId])).rows.map((r) => r.object_id));
      const left = new Set<string>();
      for await (const object of objects.list()) if (created.has(object.id)) left.add(object.id);
      expect(left).toEqual(kept);
      expect(created.size).toBeGreaterThan(kept.size);
    } finally {
      h.deps.objects = objects;
      h.deps.cfg = configured;
    }
  });

  it('removes failed staging objects and retries from the retained source pieces', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const call = await held(org, {});
    const { share } = await call.startShare({ notes: true });
    await shareScreen(call);
    for (const [i, data] of cut(await recordedWebm(10), 2).entries()) await call.appendScreen(screenPiece(share, 0, i, data));
    await call.shareEnded(share);
    const configured = h.deps.cfg;
    h.deps.cfg = { ...configured, NEAR_AI_API_KEY: '' };
    const objects = h.deps.objects;
    const created = new Set<string>();
    let failed = false;
    h.deps.objects = {
      ...objects,
      put: async (id, bytes) => { created.add(id); return objects.put(id, bytes); },
      get: async (id) => {
        if (created.has(id) && !failed) { failed = true; throw new ObjectStoreError('The object store is temporarily unavailable.'); }
        return objects.get(id);
      }
    };
    try {
      const noteId = await noteOf(call);
      await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [ownerId]);
      expect((await joinDue(h.deps, ownerId)).joined).toBe(0);
      expect(failed).toBe(true);
      expect(await count('screen_pieces', ownerId)).toBe(2);
      expect(await count('screen_videos', ownerId)).toBe(0);
      const left: string[] = [];
      for await (const object of objects.list()) if (created.has(object.id)) left.push(object.id);
      expect(left).toEqual([]);
      h.deps.objects = objects;
      expect((await joinDue(h.deps, ownerId)).joined).toBe(1);
      const response = await org.fetch(org.api.notes.screenVideoUrl(noteId, share, 0));
      expect(response.status).toBe(200);
      expect(webmDuration(new Uint8Array(await response.arrayBuffer()))).toBeCloseTo(10, 0);
    } finally {
      h.deps.objects = objects;
      h.deps.cfg = configured;
    }
  });

  it('keeps a share in its place and deletes its video once the notes are written, when the call doesn’t keep its recording', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const call = await held(org, { keepRecording: false });
    // The first part of the recording is five seconds; the share is in the second, after a pause.
    await call.appendAudio(audio(0));
    await call.pause();
    await call.resume();
    const segment = call.getSnapshot().notes.recording.segment;
    expect(segment).toBe(1);
    await call.appendAudio(audio(segment));
    const { share } = await call.startShare({ notes: true });
    await shareScreen(call);
    for (const [i, data] of cut(await recordedWebm(10), 2).entries()) await call.appendScreen(screenPiece(share, segment, i, data));
    await call.shareEnded(share);
    await call.transcribe(speech(SAID, segment), call.ticket.identity);
    const noteId = await noteOf(call);
    await tailOver(ownerId);
    await written(org.api, noteId);

    const note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', audio: [], kept: { recording: false } });
    // What was on the screen is placed after the first segment's five seconds, though that audio is gone.
    expect(note.screens.length).toBeGreaterThan(0);
    for (const m of note.screens) expect(m.at).toBeGreaterThanOrEqual(5);
    // Its video went with the audio: nothing to replay, nothing stored.
    expect(note.shares).toEqual([]);
    expect((await org.fetch(org.api.notes.screenVideoUrl(noteId, share, segment))).status).toBe(404);
    expect(await count('screen_videos', ownerId)).toBe(0);
    expect(await count('screen_pieces', ownerId)).toBe(0);
    expect((await written(org.api, noteId)).at(-1)?.steps.map((s) => s.label)).not.toContain('Shared screens ready to replay');
  });

  it('lets go of a share whose video can’t be joined once, deleting its pieces', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const { code } = await org.api.calls.startNow({ notes: 'on' });
    const call = await org.api.calls.join(code, { mic: true, cam: false });
    await call.appendAudio(audio(0));
    const { share } = await call.startShare({ notes: true });
    await shareScreen(call);
    // Not a video at all.
    await call.appendScreen(screenPiece(share, 0, 0, new Uint8Array(randomBytes(4096))));
    await call.shareEnded(share);
    // No notes service, so nothing but the join looks at it.
    const configured = h.deps.cfg;
    h.deps.cfg = { ...configured, NEAR_AI_API_KEY: '' };
    try {
      const noteId = await noteOf(call);
      const recording = (await h.pool.query<{ recording_id: string }>('SELECT recording_id FROM recordings WHERE owner_id = $1', [ownerId])).rows[0];
      if (!recording) throw new Error('the call left no recording');
      await h.pool.query(`UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1`, [ownerId]);
      await joinDue(h.deps, ownerId);
      await waitFor(async () => (await count('screen_pieces', ownerId)) === 0, 'the pieces to be deleted');
      expect(logged('a shared screen’s video couldn’t be joined', recording.recording_id)).toBe(1);
      // Nothing is left to join again, and the note doesn't wait for video that won't come.
      expect(await joinDue(h.deps, ownerId)).toEqual({ joined: 0, waitMs: null });
      expect(logged('a shared screen’s video couldn’t be joined', recording.recording_id)).toBe(1);
      expect(await count('screen_videos', ownerId)).toBe(0);
      let first: NoteProgress | undefined;
      for await (const p of org.api.notes.progress(noteId)) { first = p; break; }
      expect(first?.steps.map((s) => s.label).filter((l) => l.includes('shared screens'))).toEqual([]);
      expect((await org.api.notes.get(noteId)).shares).toEqual([]);
    } finally {
      h.deps.cfg = configured;
    }
  });

  it('saves the model chosen for shared screens while notes are waiting to be written, and refuses it while they are being written', async () => {
    const org = await account(unique('organizer'));
    const ownerId = org.session.ownerId;
    const { code } = await org.api.calls.startNow({ notes: 'on' });
    const call = await org.api.calls.join(code, { mic: true, cam: false });
    await call.appendAudio(audio(0));
    await call.transcribe(speech(SAID, 0), call.ticket.identity);
    const noteId = await noteOf(call);
    await written(org.api, noteId);
    expect((await org.api.notes.get(noteId)).status).toBe('ready');

    // The notes model is down: the notes written again wait, with the model chosen when they were asked for.
    h.near.failNext(10_000, 'down', 'notes');
    try {
      await org.api.notes.rewrite(noteId, { model: 'acme/vision-first' });
      expect((await org.api.notes.get(noteId)).model).toBe('acme/vision-first');
      await waitFor(async () => {
        const j = (await h.pool.query<{ state: string }>('SELECT state FROM content_jobs WHERE owner_id = $1', [ownerId])).rows[0];
        return j !== undefined && j.state !== 'writing';
      }, 'the notes job to be waiting');
      // Asked again with another model, the job that waits reads that one.
      const again = await org.api.notes.rewrite(noteId, { model: 'acme/vision-second' });
      expect(again.model).toBe('acme/vision-second');
      expect((await org.api.notes.get(noteId)).model).toBe('acme/vision-second');
      expect((await h.pool.query('SELECT 1 FROM content_jobs WHERE owner_id = $1', [ownerId])).rowCount).toBe(1);
    } finally {
      h.near.failNext(0, 'down');
    }
  });
});
