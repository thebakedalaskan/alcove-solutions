/**
 * A note's writing, as an operator sees it and retries it (features/notes/operator/routes.ts): signed requests to the real API
 * over HTTP, on real Postgres and the object store, with the stand-in NEAR AI and Google Drive. A note being recorded, being
 * written and written; a job a writer holds left alone; a job waiting on the notes model, its failed write among the lines the
 * lookup gives, made due and written at once, not five minutes later; a job queued to be tried again after a failed attempt,
 * made due and written before its time came; a job that outlived its last attempt, finished without a summary once its
 * writer's lease ran out and listed among the work report's finals; Drive exports waiting to be tried again made due and
 * sent, and another account's left as they were; one that failed for good listed among the finals and left to the person's
 * own Try again; the operator CLI saying where a note's writing stands and retrying its notes and its exports; anything but a
 * note's ID refused; and no word of the transcript, no title, address or name in any answer, anything the CLI printed, or any
 * log line.
 */
import type { AudioPiece, DriveExportFormat, TranscriptClip } from '@alcove/api';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseOperatorKeys } from '../../../keys/operator-keys';
import { speechWav } from '../../../testing/fakes/near';
import type { GoogleUser } from '../../../testing/fakes/google';
import { ORIGIN, startHarness, type Browser, type Harness } from '../../../testing/harness';
import { WorkAnswer } from '../../operator/wire';
import { idle } from '../drive-exports/worker';
import { ExportsRetryAnswer, NoteAnswer, NoteRetryAnswer } from './operator';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => { h.closeCalls(); h.google.drive.refuse(); h.near.failNext(0, 'down'); });

let seq = 0;
/** A made-up person's address at Vandelay Industries, unique to this run: the name an account takes comes from it. */
const unique = (who: string) => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@vandelay.test`;
async function account(email = unique('noor.halvorsen')) {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, session, email };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}
const piece = (n: number): AudioPiece => ({ data: new Blob([Buffer.from(`CANARY-AUDIO-${n}`)]), segment: 0, seq: n, at: n * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string): TranscriptClip => ({ data: new Blob([speechWav(words, 4000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 });
/** Until the note's notes are final, as the public stream says. */
async function written(b: Browser, noteId: string) {
  for await (const _progress of b.api.notes.progress(noteId)) { /* until they're final */ }
}
const Job = z.object({ state: z.string(), attempt: z.number() });
/** The note's notes job as its row has it, its state and attempt, watched directly: an operator's key has limits of its own. */
const jobOf = async (ownerId: string) => z.array(Job).parse((await h.pool.query(`SELECT state, attempt FROM content_jobs WHERE owner_id = $1 AND kind = 'notes'`, [ownerId])).rows)[0];
/** A note's Drive exports as their rows have them, watched the same way. */
const exportsOf = async (noteId: string) => z.array(Job).parse((await h.pool.query('SELECT state, attempt FROM drive_export_jobs WHERE note_id = $1', [noteId])).rows);

const Refusal = z.object({ code: z.string(), message: z.string() });
/** Every answer an operator got here, as it came: none may hold a word said, a title, an address or a name. */
const answers: string[] = [];
async function said(r: Response): Promise<unknown> {
  const text = await r.text();
  answers.push(text);
  return JSON.parse(text);
}
const lookUp = async (noteId: string) => {
  const r = await h.operator.read.get(`/v1/operator/notes/${noteId}`);
  expect(r.status, `the lookup of ${noteId}`).toBe(200);
  return NoteAnswer.parse(await said(r));
};
/** This instance's work report (features/operator/work.ts), as a read key gets it: its finals come from the ring. */
const work = async () => {
  const r = await h.operator.read.get('/v1/operator/work');
  expect(r.status, 'the work report').toBe(200);
  return WorkAnswer.parse(await said(r));
};
/** A retry with a ticket's reference, or with none (`null`). */
const retry = (noteId: string, reason: string | null = 'INC-77') => h.operator.write.post(`/v1/operator/notes/${noteId}/retry`, reason === null ? {} : { reason });
const retryExports = (noteId: string) => h.operator.write.post(`/v1/operator/notes/${noteId}/exports/retry`, { reason: 'INC-77' });
/** None of these anywhere: not in any answer an operator got, nor in any log line since `from`. */
function nowhere(from: number, canaries: string[]) {
  const logs = h.logs.slice(from).join('\n');
  const text = answers.join('\n');
  for (const c of canaries) {
    expect(text.includes(c), `${c} in an answer`).toBe(false);
    expect(logs.includes(c), `${c} in a log line`).toBe(false);
  }
}

describe('a note’s writing, as an operator sees it', () => {
  it('says where a note being recorded, being written and written stands, and leaves its job alone while a writer holds it', async () => {
    const from = h.logs.length;
    const b = await account();
    const title = `CANARY-RECORDING-TITLE-${seq++}`;
    const rec = await b.api.recordings.start({ title });
    const noteId = rec.getSnapshot().noteId;
    await rec.appendAudio(piece(0));
    await rec.transcribe(speech('CANARYWORD zanzibar quokka'));
    // While it records: its recording, the live transcript's clip, and no job yet.
    expect(await lookUp(noteId)).toMatchObject({
      noteId, instance: expect.stringMatching(/\S/), recording: { state: 'recording', endedAt: null, screensTailEndsBy: null }, job: null,
      transcript: { clips: 1 }, exports: [], screens: { pieces: 0, bytes: 0, videos: 0, joinDue: false }
    });

    // Being written: the stand-in holds the notes model's answer while an operator looks, and tries to retry.
    const during: { look?: unknown; retry?: { status: number; body: unknown }; failed?: unknown } = {};
    h.near.holdNext(async () => {
      try {
        during.look = await said(await h.operator.read.get(`/v1/operator/notes/${noteId}`));
        const r = await retry(noteId);
        during.retry = { status: r.status, body: await said(r) };
      } catch (e) {
        during.failed = e;
      }
    });
    expect((await rec.stop()).pendingNoteId).toBe(noteId);
    await written(b, noteId);
    expect(during.failed).toBeUndefined();
    const held = NoteAnswer.parse(during.look);
    expect(held).toMatchObject({ recording: { state: 'stopped' }, job: { state: 'writing', attempt: 1, claimable: false, again: false }, transcript: { clips: 0 } });
    // The first notes are queued as the recording stops, so when they were queued is exact.
    expect(held.job?.queuedAt).toBe(held.recording?.endedAt);
    expect(during.retry?.status).toBe(409);
    expect(Refusal.parse(during.retry?.body).message).toBe('Notes are being written now.');

    // Written: no job, and the transcript has gone into the note.
    expect(await lookUp(noteId)).toMatchObject({ job: null, recording: { state: 'stopped' }, transcript: { clips: 0, sinceLastS: null } });
    expect((await b.api.notes.get(noteId)).status).toBe('ready');
    const none = await retry(noteId);
    expect(none.status).toBe(409);
    expect(Refusal.parse(await said(none)).message).toBe('Those notes aren’t waiting to be written; nothing was done.');
    nowhere(from, [title, b.email, b.session.user.name, 'CANARYWORD', 'zanzibar', 'quokka']);
  });

  it('makes a job waiting on the notes model due, and its notes are written at once', async () => {
    const from = h.logs.length;
    const b = await account();
    const title = `CANARY-WAITING-TITLE-${seq++}`;
    const rec = await b.api.recordings.start({ title });
    const noteId = rec.getSnapshot().noteId;
    await rec.transcribe(speech('CANARYWORD We agreed to wait for the marmoset report.'));
    // The notes model is busy: its notes request gets a 503, so the job waits five minutes, without using its attempt.
    h.near.failNext(1, 'down', 'notes');
    await rec.stop();
    await waitFor(async () => (await jobOf(b.session.ownerId))?.state === 'waiting', 'the job to wait on the notes model');
    const waiting = await lookUp(noteId);
    expect(waiting.job).toMatchObject({ state: 'waiting', attempt: 0, claimable: false, again: false });
    // And why, as this instance logged it: the writer's failed write, with the 503 the notes model sent in its sealed reply.
    expect(waiting.recent).toContainEqual({ at: expect.any(String), msg: 'notes waiting for the notes model to answer', code: 'unavailable', upstreamStatus: 503 });
    expect(Date.parse(waiting.job?.leaseUntil ?? '') - Date.now()).toBeGreaterThan(200_000);
    expect((await b.api.notes.get(noteId)).status).toBe('pending');

    // A read key can't, and an action needs a reason.
    expect((await h.operator.read.post(`/v1/operator/notes/${noteId}/retry`, { reason: 'INC-77' })).status).toBe(403);
    expect((await retry(noteId, null)).status).toBe(400);
    // The model answers again: made due, the notes are written now.
    const asked = Date.now();
    const r = await retry(noteId);
    expect(r.status).toBe(200);
    expect(NoteRetryAnswer.parse(await said(r))).toMatchObject({
      noteId, jobId: waiting.job?.jobId, before: { state: 'waiting', attempt: 0, claimable: false }, after: { state: 'waiting', attempt: 0, claimable: true }
    });
    await written(b, noteId);
    expect((await b.api.notes.get(noteId)).status).toBe('ready');
    expect(Date.now() - asked).toBeLessThan(60_000);
    expect(await lookUp(noteId)).toMatchObject({ job: null });
    // Again: nothing is waiting, and nothing is done.
    expect((await retry(noteId)).status).toBe(409);
    expect(h.logs.slice(from).some((l) => l.includes('"msg":"notes job made due by an operator"') && l.includes(noteId) && l.includes('"before":"waiting"'))).toBe(true);
    nowhere(from, [title, b.email, b.session.user.name, 'CANARYWORD', 'marmoset']);
  });

  it('makes a job queued to be tried again after a failed attempt due, and its notes are written before its time comes', async () => {
    const from = h.logs.length;
    const b = await account();
    const title = `CANARY-QUEUED-TITLE-${seq++}`;
    const rec = await b.api.recordings.start({ title });
    const noteId = rec.getSnapshot().noteId;
    await rec.transcribe(speech('CANARYWORD We agreed to reprint the pangolin brochures.'));
    // The notes model answers in prose: the attempt is used up, and the job is queued to be tried again 20 s later.
    h.near.failNext(1, 'prose', 'notes');
    await rec.stop();
    await waitFor(async () => { const j = await jobOf(b.session.ownerId); return j?.state === 'queued' && j.attempt === 1; }, 'the first attempt to fail');
    const failedAt = Date.now();
    const queued = await lookUp(noteId);
    expect(queued.job).toMatchObject({ state: 'queued', attempt: 1, leaseUntil: expect.any(String), claimable: false, again: false });
    // Why, as this instance logged it: the attempt that failed, by its code.
    expect(queued.recent).toContainEqual(expect.objectContaining({ msg: 'notes not written yet; trying again', code: 'unavailable' }));

    // Made due by the writer's own rule, its attempt left as it was, and the writer started.
    const r = await retry(noteId);
    expect(r.status).toBe(200);
    expect(NoteRetryAnswer.parse(await said(r))).toMatchObject({
      noteId, jobId: queued.job?.jobId, before: { state: 'queued', attempt: 1, claimable: false }, after: { state: 'queued', attempt: 1, claimable: true }
    });
    await written(b, noteId);
    const note = await b.api.notes.get(noteId);
    expect(note.status).toBe('ready');
    expect(note.summary).not.toBe('');
    expect(note.writtenAt).not.toBeNull();
    // Written now, not when the 20 s it was queued for are up.
    expect(Date.now() - failedAt).toBeLessThan(15_000);
    expect(await lookUp(noteId)).toMatchObject({ job: null });
    nowhere(from, [title, b.email, b.session.user.name, 'CANARYWORD', 'pangolin']);
  });

  it('finishes a note without a summary once its job outlived its last attempt, and the work report lists it among the finals', async () => {
    const from = h.logs.length;
    const b = await account();
    const title = `CANARY-OUTLIVED-TITLE-${seq++}`;
    const rec = await b.api.recordings.start({ title });
    const noteId = rec.getSnapshot().noteId;
    await rec.transcribe(speech('CANARYWORD The wombat census runs late.'));
    h.near.failNext(1, 'prose', 'notes');
    await rec.stop();
    await waitFor(async () => { const j = await jobOf(b.session.ownerId); return j?.state === 'queued' && j.attempt === 1; }, 'the first attempt to fail');
    // Its third attempt, as a writer holds it while it writes: an operator's retry is refused while that writer's lease lasts.
    await h.pool.query(`UPDATE content_jobs SET state = 'writing', attempt = 3, lease_until = now() + interval '1 hour' WHERE owner_id = $1 AND kind = 'notes'`, [b.session.ownerId]);
    const held = await retry(noteId);
    expect(held.status).toBe(409);
    expect(Refusal.parse(await said(held)).message).toBe('Notes are being written now.');
    // That writer stopped part way, and its lease has run out: the job is the writer's to take again, past its last attempt.
    await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1 AND kind = 'notes'`, [b.session.ownerId]);
    const stuck = await lookUp(noteId);
    expect(stuck.job).toMatchObject({ state: 'writing', attempt: 3, claimable: true });
    const r = await retry(noteId);
    expect(r.status).toBe(200);
    expect(NoteRetryAnswer.parse(await said(r))).toMatchObject({ before: { state: 'writing', attempt: 3, claimable: true }, after: { state: 'writing', attempt: 3, claimable: true } });
    // The writer it started finishes the note without a summary, and says so as work given up for good.
    await written(b, noteId);
    expect(await b.api.notes.get(noteId)).toMatchObject({ status: 'ready', summary: '', writtenAt: null });
    expect(h.logs.slice(from).some((l) => l.includes('"msg":"notes job outlived its last attempt; finishing the note without a summary"') && l.includes('"final":"notes-without-summary"') && l.includes(noteId))).toBe(true);
    expect((await work()).finals).toContainEqual(expect.objectContaining({ kind: 'notes-without-summary', noteId, jobId: stuck.job?.jobId }));
    nowhere(from, [title, b.email, b.session.user.name, 'CANARYWORD', 'wombat']);
  });

  it('refuses anything but a note’s ID, and an ID no note has, saying none of it back', async () => {
    const from = h.logs.length;
    for (const typed of ['abc-defg-hij', 'short']) {
      for (const r of [await h.operator.read.get(`/v1/operator/notes/${typed}`), await retry(typed), await retryExports(typed)]) {
        expect(r.status, typed).toBe(400);
        expect(JSON.stringify(Refusal.parse(await said(r)))).not.toContain(typed);
      }
    }
    const none = await h.operator.read.get('/v1/operator/notes/AAAAAAAAAAAAAAAAAAAAAA');
    expect(none.status).toBe(404);
    expect(Refusal.parse(await said(none)).message).toBe('No note has that ID.');
    expect(h.logs.slice(from).join('\n')).not.toContain('abc-defg-hij');
  });
});

/** Follows Google's consent from a signed-in browser, back to the app. */
async function finishConsent(b: Browser, url: string) {
  let next = new URL(url);
  for (let i = 0; i < 8; i++) {
    if (next.origin === ORIGIN) return;
    const res = await (next.origin === h.google.issuer ? fetch(next, { redirect: 'manual' }) : b.fetch(next, { redirect: 'manual' }));
    const location = res.headers.get('location');
    if (!location) throw new Error(`Consent stopped at ${res.status}`);
    next = new URL(location, next);
  }
  throw new Error('Too many consent redirects.');
}
const FORMATS: DriveExportFormat[] = ['notes-markdown'];
/** An account with Drive connected and its folder picked, exporting each call's notes once they're final. */
async function withDrive() {
  const b = await account();
  const id = randomUUID();
  const google: GoogleUser = { sub: `drive-${id}`, email: `noor.${id}@vandelay.example`, name: 'Noor Halvorsen' };
  const destinationId = `folder_${id}`;
  h.google.drive.folder(google.sub, { id: destinationId, name: `CANARY-DRIVE-FOLDER-${id}` });
  h.google.drive.pick(google.sub, destinationId);
  h.google.next(google);
  await finishConsent(b, (await b.api.drive.connect()).url);
  await b.api.drive.update({ enabled: true, destinationId, formats: FORMATS });
  return b;
}
/** A call with notes, ended and written, its export tried once. */
async function exportedCall(b: Browser) {
  const call = await b.api.calls.join((await b.api.calls.startNow({ title: `CANARY-EXPORT-TITLE-${seq++}`, notes: 'on' })).code, { mic: true, cam: false });
  await call.appendAudio(piece(0));
  await call.transcribe(speech('The team agreed to launch on Friday.'), call.ticket.identity);
  const noteId = call.getSnapshot().notes.noteId ?? '';
  await call.leave();
  await written(b, noteId);
  // Its export starts once the notes are final, which can be a moment after the note says they're ready.
  await waitFor(async () => { await idle(); return (await exportsOf(noteId)).some((x) => x.attempt > 0 && x.state !== 'uploading'); }, 'its export to be tried');
  return noteId;
}

describe('a note’s Drive exports', () => {
  it('makes exports waiting to be tried again due and sends them, and leaves another account’s as they were', async () => {
    const a = await withDrive();
    const b = await withDrive();
    // Google Drive is down: each export fails once and waits to be tried again, a little later.
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 503);
    const aNote = await exportedCall(a);
    const bNote = await exportedCall(b);
    const before = await lookUp(aNote);
    expect(before.exports).toEqual([{ jobId: expect.any(String), format: 'notes-markdown', state: 'pending', attempt: 1, dueAt: expect.any(String), leased: false, to: 'organizer' }]);
    expect(Date.parse(before.exports[0]?.dueAt ?? '')).toBeGreaterThan(Date.now());
    const theirs = (await lookUp(bNote)).exports[0]?.jobId ?? '';
    expect(theirs).not.toBe('');

    // Drive is back: made due now, the export goes at once.
    h.google.drive.refuse();
    const r = await retryExports(aNote);
    expect(r.status).toBe(200);
    expect(ExportsRetryAnswer.parse(await said(r))).toMatchObject({ noteId: aNote, retried: 1 });
    await idle();
    expect((await a.api.drive.forNote(aNote)).jobs[0]).toMatchObject({ status: 'uploaded' });
    const after = await lookUp(aNote);
    expect(after.exports).toEqual([expect.objectContaining({ jobId: before.exports[0]?.jobId, state: 'uploaded', attempt: 2 })]);
    // The other account's export still waits for its own time, and this note's lookup names nothing of it.
    const other = (await b.api.drive.forNote(bNote)).jobs[0];
    expect(other).toMatchObject({ status: 'pending' });
    expect(Date.parse(other?.nextAt ?? '')).toBeGreaterThan(Date.now());
    for (const id of [bNote, theirs, b.session.ownerId]) expect(JSON.stringify(after).includes(id), id).toBe(false);
    // Again: nothing waits, so nothing is done.
    expect(ExportsRetryAnswer.parse(await said(await retryExports(aNote)))).toMatchObject({ retried: 0 });
  });

  it('lists an export that failed for good among the work report’s finals, and leaves it to the person’s own Try again', async () => {
    const from = h.logs.length;
    const a = await withDrive();
    // Drive refuses the file for good: the folder can't take it.
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 403);
    const noteId = await exportedCall(a);
    const looked = await lookUp(noteId);
    expect(looked.exports).toEqual([{ jobId: expect.any(String), format: 'notes-markdown', state: 'failed', attempt: 1, dueAt: expect.any(String), leased: false, to: 'organizer' }]);
    const jobId = looked.exports[0]?.jobId ?? '';
    // Why, as this instance logged it; and the same line among the finals, by the export's ID and the failure's code.
    expect(looked.recent).toContainEqual(expect.objectContaining({ msg: 'export failed for good', code: 'destination' }));
    expect((await work()).finals).toContainEqual(expect.objectContaining({ kind: 'drive-export-failed', noteId, jobId, code: 'destination' }));
    expect((await a.api.drive.forNote(noteId)).jobs[0]).toMatchObject({ status: 'failed' });
    // Trying it again needs the person's consent, so an operator's retry leaves it as it is, even with Drive back.
    h.google.drive.refuse();
    expect(ExportsRetryAnswer.parse(await said(await retryExports(noteId)))).toMatchObject({ noteId, retried: 0 });
    await idle();
    expect(await exportsOf(noteId)).toEqual([{ state: 'failed', attempt: 1 }]);
    nowhere(from, [a.email, a.session.user.name, 'CANARY-EXPORT-TITLE', 'CANARY-DRIVE-FOLDER']);
  });
});

describe('a note’s writing on the operator CLI', () => {
  it('says where a note’s writing stands, and retries its notes and its Drive exports', async () => {
    const from = h.logs.length;
    const home = await mkdtemp(join(tmpdir(), 'alcove-operator-notes-'));
    /** The CLI as an operator runs it: no .env, nothing in its environment but a PATH and a home, and no terminal. */
    const cli = (args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const run = spawn(process.execPath, ['--import', 'tsx', 'src/operator-cli.ts', ...args], { env: { PATH: process.env['PATH'] ?? '', HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      run.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      run.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
      run.on('error', reject);
      run.on('close', (code) => { answers.push(out, err); resolve({ code, out, err }); });
    });
    try {
      // A key of the CLI's own making, which a second instance lists for writing.
      const made = await cli(['keygen', '--no-passphrase']);
      expect(made.code).toBe(0);
      const publicKey = /^Public key: ([A-Za-z0-9_-]{43})$/m.exec(made.out)?.[1] ?? '';
      const second = await h.secondServer({ operatorKeys: parseOperatorKeys(`write:${publicKey}`) });
      try {
        const api = ['--api', second.baseUrl, '--audience', h.operator.audience];
        // A note whose notes wait on the notes model, which is busy.
        const b = await account();
        const title = `CANARY-CLI-TITLE-${seq++}`;
        const rec = await b.api.recordings.start({ title });
        const noteId = rec.getSnapshot().noteId;
        await rec.transcribe(speech('CANARYWORD The capybara budget was approved.'));
        h.near.failNext(1, 'down', 'notes');
        await rec.stop();
        await waitFor(async () => (await jobOf(b.session.ownerId))?.state === 'waiting', 'the job to wait on the notes model');
        const shown = await cli(['note', noteId, ...api]);
        expect(shown.code, shown.err).toBe(0);
        expect(shown.out).toMatch(new RegExp(`^Note:\\s+${noteId}$`, 'm'));
        expect(shown.out).toMatch(/^Notes job:\s+\S+: waiting, attempt 0, lease until \S+, not claimable now; queued at \S+$/m);
        expect(shown.out).toMatch(/^Went wrong:\s+\S+ notes waiting for the notes model to answer \(unavailable, upstream 503\)$/m);
        expect(shown.err).toMatch(/^Request [A-Za-z0-9_-]{8,64} on \S+$/m);
        // Made due from the CLI: the notes are written now.
        const retried = await cli(['note', 'retry', noteId, '--reason', 'INC-77', ...api]);
        expect(retried.code, retried.err).toBe(0);
        expect(retried.out).toMatch(/^Before:\s+waiting, attempt 0, lease until \S+, not claimable now$/m);
        expect(retried.out).toMatch(/^After:\s+waiting, attempt 0, lease until \S+, claimable now$/m);
        expect(retried.out).toContain('The writer was started for the note’s organizer.');
        await written(b, noteId);
        expect((await b.api.notes.get(noteId)).status).toBe('ready');

        // A call's notes, whose Drive export waits to be tried again: Drive was down.
        const a = await withDrive();
        h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 503);
        const exported = await exportedCall(a);
        const looked = await cli(['note', exported, ...api]);
        expect(looked.code, looked.err).toBe(0);
        expect(looked.out).toMatch(/^Notes job:\s+none$/m);
        expect(looked.out).toMatch(/^Drive export:\s+notes-markdown to the organizer’s: pending, attempt 1, due \S+$/m);
        // Drive is back: made due from the CLI, the export goes at once; then nothing waits, and nothing is done.
        h.google.drive.refuse();
        expect(await cli(['note', 'exports', 'retry', exported, '--reason', 'INC-77', ...api])).toMatchObject({ code: 0, out: '1 Drive exports made due now; their exporters were started.\n' });
        await idle();
        expect((await a.api.drive.forNote(exported)).jobs[0]).toMatchObject({ status: 'uploaded' });
        expect(await cli(['note', 'exports', 'retry', exported, '--reason', 'INC-77', ...api])).toMatchObject({ code: 0, out: 'No Drive export was waiting to be tried again; nothing was done.\n' });
        nowhere(from, [title, b.email, b.session.user.name, a.email, a.session.user.name, 'CANARYWORD', 'capybara', 'CANARY-EXPORT-TITLE', 'CANARY-DRIVE-FOLDER']);
      } finally {
        await second.close();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
