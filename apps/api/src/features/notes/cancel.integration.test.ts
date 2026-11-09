/**
 * Writing a call's notes again, and stopping that (docs: Notes and inference › Writing the notes again), end to end: the
 * real API over HTTP via @alcove/api-http, real Postgres and the object store, NEAR AI faked over HTTP. Stopped, the
 * notes stay as they were, with the AI model they had, whether the job was waiting or being written. Written again,
 * the note says what wrote it now, and where in the call each entry came up is the line it came from, whatever second
 * the model said.
 */
import { AlcoveApiError, type AlcoveApi, type AudioPiece, type Note, type TranscriptClip } from '@alcove/api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { work } from './writer';
import { NOTES_MODEL, UNENCRYPTED_MODEL, VISION_MODEL, WRAPPED_UP_S, speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';
import { acceptNoteSuggestions } from '../../testing/follow-ups';

vi.setConfig({ testTimeout: 60_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { h.closeCalls(); await h?.close(); await disposeLiveKit(); });

let seq = 0;
const unique = (who: string) => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique('person')) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
type Account = Awaited<ReturnType<typeof account>>;
const audio = (i: number): AudioPiece => ({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq: i, at: i * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, at: number): TranscriptClip => ({ data: new Blob([speechWav(words, 3000)], { type: 'audio/wav' }), segment: 0, at, durationMs: 3000 });
async function written(api: AlcoveApi, noteId: string): Promise<void> {
  for await (const p of api.notes.progress(noteId)) void p;
}
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
const jobs = async (ownerId: string) => (await h.pool.query<{ state: string }>('SELECT state FROM content_jobs WHERE owner_id = $1', [ownerId])).rows;
/** What the notes say, as people read them: what changes when they're written again, and must not when that's stopped. */
const said = (n: Note) => ({ summary: n.summary, details: n.details, decisions: n.decisions.map((d) => d.text), actions: n.actions.map((a) => a.text), chapters: n.chapters, inference: n.inference });

/** A call with notes on, where the organizer decides something and says what someone will do, written. */
async function call(org: Account, leave = true) {
  const { code: c } = await org.api.calls.startNow({ notes: 'on' });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  for (let i = 0; i < 6; i++) await host.appendAudio(audio(i));
  await host.transcribe(speech('We agreed to ship the beta on Friday.', 2), host.ticket.identity);
  await host.transcribe(speech('Kofi will send the deck by Monday.', 21), host.ticket.identity);
  if (!leave) return { noteId: (await host.leave())?.pendingNoteId ?? '' };
  const noteId = (await host.leave())?.pendingNoteId ?? '';
  await written(org.api, noteId);
  return { noteId };
}

describe('stopping the notes being written again', () => {
  it('leaves the notes and their model as they were while the job waits, and nothing is asked of the model it was for', async () => {
    const org = await account(unique('organizer'));
    const { noteId } = await call(org);
    const before = await org.api.notes.get(noteId);
    expect(before.model).toBeNull();

    // The notes model is down: written again with another model, the job waits.
    h.near.failNext(10_000, 'down', 'notes');
    try {
      expect((await org.api.notes.rewrite(noteId, { model: VISION_MODEL })).model).toBe(VISION_MODEL);
      await waitFor(async () => (await jobs(org.session.ownerId)).some((j) => j.state === 'waiting'), 'the notes job to wait');
      const asked = h.near.chats.length;
      const logsFrom = h.logs.length;
      const stopped = await org.api.notes.cancelRewrite(noteId);
      expect(stopped.writingAgain).toBe(false);
      expect(stopped.model).toBeNull();
      expect(said(stopped)).toEqual(said(before));
      expect(await jobs(org.session.ownerId)).toEqual([]);
      expect(h.logs.slice(logsFrom).some((l) => l.includes('"msg":"notes rewrite cancelled"') && l.includes('"state":"waiting"'))).toBe(true);
      // Stopping again is nothing to do.
      expect(said(await org.api.notes.cancelRewrite(noteId))).toEqual(said(before));
      expect(h.near.chats.slice(asked).filter((x) => x.model === VISION_MODEL)).toEqual([]);
    } finally {
      h.near.failNext(0, 'down');
    }
  });

  it('throws away what was being written when it was stopped part way', async () => {
    const org = await account(unique('organizer'));
    const { noteId } = await call(org);
    const before = await org.api.notes.get(noteId);
    const logsFrom = h.logs.length;
    // Stopped while the model writes them: the reply comes, and nothing of it is saved.
    let during: Note | undefined;
    h.near.holdNext(async () => {
      expect((await jobs(org.session.ownerId)).map((j) => j.state)).toEqual(['writing']);
      during = await org.api.notes.cancelRewrite(noteId);
    });
    await org.api.notes.rewrite(noteId, { model: VISION_MODEL });
    await waitFor(() => h.logs.slice(logsFrom).some((l) => l.includes('"msg":"notes job cancelled; what was written is dropped"')), 'the job to stop');
    expect(during?.writingAgain).toBe(false);
    expect(during?.model).toBeNull();
    const after = await org.api.notes.get(noteId);
    expect(after.writingAgain).toBe(false);
    expect(after.model).toBeNull();
    expect(after.writtenAt).toBe(before.writtenAt);
    expect(said(after)).toEqual(said(before));
    expect(await jobs(org.session.ownerId)).toEqual([]);
    // Written again later, they are: the stop was for that one time.
    await org.api.notes.rewrite(noteId);
    await written(org.api, noteId);
    expect((await org.api.notes.get(noteId)).writtenAt).not.toBe(before.writtenAt);
  });

  it('still says an unencrypted model was sent the call when what it was writing is stopped', async () => {
    const org = await account(unique('organizer'));
    const { noteId } = await call(org);
    const before = await org.api.notes.get(noteId);
    expect(before.unencrypted).toEqual([]);
    const logsFrom = h.logs.length;
    let during: Note | undefined;
    h.near.holdNext(async () => { during = await org.api.notes.cancelRewrite(noteId); });
    await org.api.notes.rewrite(noteId, { model: UNENCRYPTED_MODEL });
    await waitFor(() => h.logs.slice(logsFrom).some((l) => l.includes('"msg":"notes job cancelled; what was written is dropped"')), 'the job to stop');
    // The transcript went to it in plaintext before it was stopped: the note says so, and the notes and model are as they were.
    expect(during?.unencrypted.map((u) => [u.model, u.task])).toEqual([[UNENCRYPTED_MODEL, 'notes']]);
    const after = await org.api.notes.get(noteId);
    expect(after.model).toBeNull();
    expect(after.unencrypted.map((u) => [u.model, u.task])).toEqual([[UNENCRYPTED_MODEL, 'notes']]);
    expect(said(after)).toEqual(said(before));
  });

  it('goes back to the model the notes had when they can’t be written again, and says the model they were sent to', async () => {
    const org = await account(unique('organizer'));
    const { noteId } = await call(org);
    const before = await org.api.notes.get(noteId);
    const ownerId = org.session.ownerId;
    const job = async () => (await h.pool.query<{ state: string; attempt: number }>('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [ownerId])).rows[0];
    h.near.failNext(10_000, 'prose');
    try {
      expect((await org.api.notes.rewrite(noteId, { model: UNENCRYPTED_MODEL })).model).toBe(UNENCRYPTED_MODEL);
      // Three attempts, each answered in prose: the second and third brought forward rather than waited for.
      for (let tried = 1; tried <= 2; tried++) {
        await waitFor(async () => { const j = await job(); return j?.state === 'queued' && j.attempt === tried; }, `attempt ${tried} to fail`);
        await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [ownerId]);
        await work(h.deps, { ownerId });
      }
      await waitFor(async () => !(await job()), 'the job to finish');
    } finally {
      h.near.failNext(0, 'prose');
    }
    const after = await org.api.notes.get(noteId);
    expect(after.writingAgain).toBe(false);
    expect(after.model).toBeNull();
    expect(said(after)).toEqual(said(before));
    expect(after.unencrypted.map((u) => [u.model, u.task])).toEqual([[UNENCRYPTED_MODEL, 'notes']]);
  });

  it('can’t stop the first notes, is the organizer’s alone, and is no one else’s to find', async () => {
    const org = await account(unique('organizer'));
    h.near.failNext(10_000, 'down', 'notes');
    try {
      const { noteId } = await call(org, false);
      expect((await org.api.notes.get(noteId)).status).toBe('pending');
      expect(code(await org.api.notes.cancelRewrite(noteId).catch((e: unknown) => e))).toBe('conflict');
      const stranger = await account();
      expect(code(await stranger.api.notes.cancelRewrite(noteId).catch((e: unknown) => e))).toBe('not-found');
    } finally {
      h.near.failNext(0, 'down');
    }
  });
});

describe('notes written again', () => {
  it('say what wrote them now, and put each entry at the line it came from', async () => {
    const org = await account(unique('organizer'));
    const { noteId } = await call(org);
    await org.api.notes.rewrite(noteId, { model: VISION_MODEL });
    await written(org.api, noteId);
    const note = await acceptNoteSuggestions(org.api, noteId);
    // The transcript's verification and the model that wrote these notes, each once: not the one that wrote them first.
    expect(note.inference.map((e) => `${e.task} ${e.model}`).sort()).toEqual(['notes ' + VISION_MODEL, 'transcript openai/whisper-large-v3']);
    expect(note.inference.some((e) => e.model === NOTES_MODEL)).toBe(false);
    // The model said each came up WRAPPED_UP_S later than it was said; the notes go by the line.
    const lineAt = (id: string | undefined) => Math.round(note.transcript?.find((l) => l.id === id)?.at ?? Number.NaN);
    const [decision] = note.decisions;
    const [action] = note.actions;
    expect(decision?.at).toBe(lineAt(decision?.lines[0]));
    expect(action?.at).toBe(lineAt(action?.lines[0]));
    expect(action?.at).not.toBe(lineAt(action?.lines[0]) + WRAPPED_UP_S);
    // A chapter starts at the time of the line the model named, not at the stray second it gave beside it; the two it
    // started at a line that isn't there, and at none, were dropped.
    expect(note.chapters.map((c) => [c.title, c.at])).toEqual([['Part 1', lineAt(note.transcript?.[0]?.id)]]);
    expect(note.chapters[0]?.at).not.toBe(lineAt(note.transcript?.[0]?.id) + WRAPPED_UP_S);
  });
});
