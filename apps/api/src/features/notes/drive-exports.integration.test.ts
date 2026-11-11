/** Drive exports exercise the real API, persisted jobs, Postgres, objects and an HTTP provider fixture. */
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlcoveApiError, type DriveExportFormat, type TranscriptClip } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openJson, stateKey } from '../../crypto';
import { openOwner } from '../../owners';
import { maintain } from '../../maintenance';
import { idle } from './drive-worker';
import { speechWav } from '../../testing/fake-near';
import { type GoogleUser } from '../../testing/fake-google';
import { ORIGIN, startHarness, type Browser, type Harness } from '../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => { h.closeCalls(); h.google.drive.refuse(); });
const code = (error: unknown) => error instanceof AlcoveApiError ? error.code : 'unexpected';
const FORMATS: DriveExportFormat[] = ['notes-markdown', 'transcript-text', 'recording-zip'];
const user = (): GoogleUser => { const id = randomUUID(); return { sub: `drive-${id}`, email: `mira.${id}@vandelay.example`, name: 'Mira Bell' }; };
async function account() {
  const b = h.browser();
  const session = (await b.api.auth.signIn('sso', { email: `owner.${randomUUID()}@vandelay.example` })).session;
  return { ...b, session };
}
async function finishConsent(b: Browser, url: string) {
  let next = new URL(url);
  for (let i = 0; i < 8; i++) {
    if (next.origin === ORIGIN) return next;
    const res = await (next.origin === h.google.issuer ? fetch(next, { redirect: 'manual' }) : b.fetch(next, { redirect: 'manual' }));
    const location = res.headers.get('location');
    if (!location) throw new Error(`Consent stopped at ${res.status}`);
    next = new URL(location, next);
  }
  throw new Error('Too many consent redirects.');
}
/** Drive connected, its folder picked; with `automatic`, exports after each call turned on. */
async function connected(formats: DriveExportFormat[] = FORMATS, automatic = true) {
  const b = await account(); const google = user(); const destinationId = `folder_${randomUUID()}`;
  h.google.drive.folder(google.sub, { id: destinationId, name: `CANARY-DRIVE-FOLDER-${randomUUID()}`, driveId: 'shared_drive' });
  h.google.drive.pick(google.sub, destinationId); h.google.next(google);
  const consent = await b.api.drive.connect();
  const url = new URL(consent.url);
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
  expect(url.searchParams.get('include_granted_scopes')).toBe('false');
  expect(url.searchParams.get('trigger_onepick')).toBe('true');
  expect(url.searchParams.get('allow_folder_selection')).toBe('true');
  await finishConsent(b, consent.url);
  expect((await b.api.auth.getSession())?.ownerId).toBe(b.session.ownerId);
  expect((await b.api.drive.get()).connection).toEqual({ status: 'connected', email: google.email });
  await b.api.drive.update({ enabled: automatic, destinationId, formats });
  return { ...b, google, destinationId };
}
const speech = (text: string): TranscriptClip => ({ data: new Blob([speechWav(text, 4000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 });
/** A call with notes, ended and written. Its exports start the moment its notes are final; with `settle`, this waits for them. */
async function completed(b: Browser, title = `CANARY-DRIVE-CALL-${randomUUID()}`, privateMessage = false, settle = true) {
  const call = await b.api.calls.join((await b.api.calls.startNow({ title, notes: 'on' })).code, { mic: true, cam: false });
  await call.appendAudio({ data: new Blob(['CANARY-DRIVE-AUDIO-CONTENT']), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm' });
  await call.transcribe(speech('The team agreed to launch on Friday. Mira will share the plan.'), call.ticket.identity);
  const noteId = call.getSnapshot().notes.noteId ?? '';
  expect(noteId).not.toBe('');
  const before = await b.api.drive.forNote(noteId);
  expect(before.jobs.every((job) => job.status !== 'uploaded')).toBe(true);
  await b.api.notes.personal(noteId).add({ kind: 'note', text: 'CANARY-PRIVATE-MATERIAL-NEVER-EXPORT' });
  if (privateMessage) {
    const guest = await h.browser().api.calls.join(call.getSnapshot().code, { mic: false, cam: false, name: 'Mara' });
    for (let i = 0; i < 100 && !call.getSnapshot().waiting.some((p) => p.id === guest.ticket.identity); i++) { await call.refresh(); await new Promise((resolve) => setTimeout(resolve, 30)); }
    await call.admit(guest.ticket.identity);
    for (let i = 0; i < 100 && !call.direct.getSnapshot().peers.includes(guest.ticket.identity); i++) { await call.refresh(); await new Promise((resolve) => setTimeout(resolve, 30)); }
    await call.direct.send(guest.ticket.identity, 'CANARY-DIRECT-MESSAGE-NEVER-EXPORT');
    for (let i = 0; i < 100 && guest.direct.getSnapshot().messages.length === 0; i++) { await guest.refresh(); await new Promise((resolve) => setTimeout(resolve, 30)); }
    expect(guest.direct.getSnapshot().messages[0]?.text).toBe('CANARY-DIRECT-MESSAGE-NEVER-EXPORT');
  }
  await call.leave();
  for await (const _progress of b.api.notes.progress(noteId)) { /* the public stream waits for finalization */ }
  if (settle) await idle();
  return { noteId, title };
}
/** Upkeep, once what started in the background has finished. */
async function runJobs() { await idle(); await maintain(h.deps); }
async function uploaded(b: Browser, noteId: string, expected = FORMATS.length) {
  for (let i = 0; i < 8; i++) {
    await runJobs();
    const jobs = (await b.api.drive.forNote(noteId)).jobs;
    if (jobs.filter((job) => job.status === 'uploaded').length === expected) return jobs;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Exports did not finish: ${JSON.stringify((await b.api.drive.forNote(noteId)).jobs)}`);
}

describe('automatic Google Drive call exports', () => {
  it('connects with minimum consent independently of sign-in and validates shared-drive and inaccessible folders', async () => {
    const b = await connected(['notes-markdown']);
    const folders = await b.api.drive.folders();
    expect(folders).toContainEqual(expect.objectContaining({ id: b.destinationId, driveId: 'shared_drive' }));
    const readOnly = `readonly_${randomUUID()}`;
    h.google.drive.folder(b.google.sub, { id: readOnly, name: 'Cannot write here', canAddChildren: false });
    expect(code(await b.api.drive.update({ enabled: true, destinationId: readOnly, formats: FORMATS }).catch((error: unknown) => error))).toBe('unavailable');
    expect(code(await b.api.drive.update({ enabled: true, destinationId: 'unknown_folder', formats: FORMATS }).catch((error: unknown) => error))).toBe('unavailable');
    expect((await b.api.drive.get()).destination?.id).toBe(b.destinationId);
    expect(code(await h.browser().api.drive.get().catch((error: unknown) => error))).toBe('unauthenticated');
    await b.api.drive.disconnect();
    expect((await b.api.drive.get()).connection.status).toBe('disconnected');
    expect((await b.api.auth.getSession())?.ownerId).toBe(b.session.ownerId);
  });


  it('disconnects Drive without withdrawing an existing Google Calendar connection', async () => {
    const b = h.browser(); const who = user();
    h.google.next(who);
    await finishConsent(b, b.api.auth.signInUrl('google'));
    h.google.next(who);
    await finishConsent(b, b.api.calendar.connectUrl());
    expect((await b.api.calendar.get()).needsAccess).toBe(false);
    const destinationId = `independent_${randomUUID()}`;
    h.google.drive.folder(who.sub, { id: destinationId, name: 'Independent Drive destination' });
    h.google.drive.pick(who.sub, destinationId); h.google.next(who);
    await finishConsent(b, (await b.api.drive.connect()).url);
    expect((await b.api.drive.get()).connection.status).toBe('connected');
    await b.api.drive.disconnect();
    expect((await b.api.drive.get()).connection.status).toBe('disconnected');
    expect((await b.api.calendar.get()).needsAccess).toBe(false);
    expect((await b.api.auth.getSession())?.user.email).toBe(who.email);
  });

  it('refuses declined scope and a callback delivered in another signed-in owner’s browser', async () => {
    const b = await account(); const who = user(); h.google.next(who, 'no-drive');
    await finishConsent(b, (await b.api.drive.connect()).url);
    expect((await b.api.drive.get()).connection.status).toBe('disconnected');
    h.google.next(who);
    const consent = await b.api.drive.connect();
    const response = await fetch(consent.url, { redirect: 'manual' });
    const other = await account();
    const callback = response.headers.get('location') ?? '';
    await other.fetch(callback, { redirect: 'manual' });
    expect((await other.api.drive.get()).connection.status).toBe('disconnected');
    expect((await b.api.drive.get()).connection.status).toBe('disconnected');
  });


  it('refuses Drive consent after its initiating account signs out in the same browser', async () => {
    const b = await account(); const who = user(); const folderId = `signedout_${randomUUID()}`;
    h.google.drive.folder(who.sub, { id: folderId, name: 'Consent must stay cancelled' }); h.google.drive.pick(who.sub, folderId); h.google.next(who);
    const started = await b.api.drive.connect();
    const google = await fetch(started.url, { redirect: 'manual' });
    const callback = google.headers.get('location') ?? '';
    await b.api.auth.signOut();
    const refused = await b.fetch(callback, { redirect: 'manual' });
    expect(refused.headers.get('location')).toBe(`${ORIGIN}/settings?drive=failed`);
    await b.api.auth.signIn('sso', { email: b.session.user.email });
    expect((await b.api.drive.get()).connection.status).toBe('disconnected');
  });

  it('refuses an old consent return after the same browser signs in as a different Alcove account', async () => {
    for (const signsOut of [false, true]) {
      const b = await account(); const who = user(); const folderId = `switched_${randomUUID()}`;
      h.google.drive.folder(who.sub, { id: folderId, name: 'Do not attach to either account' }); h.google.drive.pick(who.sub, folderId); h.google.next(who);
      const started = await b.api.drive.connect();
      const google = await fetch(started.url, { redirect: 'manual' });
      const callback = google.headers.get('location') ?? '';
      if (signsOut) await b.api.auth.signOut();
      const second = await b.api.auth.signIn('sso', { email: `second.${randomUUID()}@vandelay.example` });
      expect(second.session.ownerId).not.toBe(b.session.ownerId);
      const refused = await b.fetch(callback, { redirect: 'manual' });
      expect(refused.headers.get('location')).toBe(`${ORIGIN}/settings?drive=failed`);
      expect((await b.api.drive.get()).connection.status).toBe('disconnected');
      await b.api.auth.signIn('sso', { email: b.session.user.email });
      expect((await b.api.drive.get()).connection.status).toBe('disconnected');
    }
  });

  it('exports only finalized selected shared artifacts, retaining original audio and excluding personal material', async () => {
    const b = await connected(); const { noteId, title } = await completed(b, undefined, true);
    const jobs = await uploaded(b, noteId);
    expect(jobs.map((job) => job.format).sort()).toEqual([...FORMATS].sort());
    expect(jobs.every((job) => job.fileUrl?.startsWith('https://drive.google.com/file/d/'))).toBe(true);
    const files = h.google.drive.files(b.google.sub);
    expect(files).toHaveLength(3);
    expect(files.every((file) => file.parents[0] === b.destinationId)).toBe(true);
    const text = files.filter((file) => file.mimeType !== 'application/zip').map((file) => file.bytes.toString('utf8')).join('\n');
    expect(text).toContain(title);
    expect(text).toContain('launch on Friday');
    // The notes carry the full summary under the short one, as the note page does.
    const notesFile = files.find((file) => file.mimeType === 'text/markdown')?.bytes.toString('utf8') ?? '';
    expect(notesFile).toContain('## Full summary');
    expect(notesFile).toContain('First, The team agreed to launch on Friday.');
    expect(text).not.toContain('CANARY-PRIVATE-MATERIAL-NEVER-EXPORT');
    expect(text).not.toContain('CANARY-DIRECT-MESSAGE-NEVER-EXPORT');
    expect(JSON.stringify(await b.api.notes.get(noteId))).not.toContain('CANARY-DIRECT-MESSAGE-NEVER-EXPORT');
    const recording = files.find((file) => file.mimeType === 'application/zip');
    expect(recording?.bytes.subarray(0, 2).toString()).toBe('PK');
    if (!recording) throw new Error('Expected a retained recording archive.');
    const archiveDirectory = await mkdtemp(join(tmpdir(), 'alcove-drive-archive-'));
    try {
      const archivePath = join(archiveDirectory, 'recording.zip');
      await writeFile(archivePath, recording.bytes);
      // An independent ZIP reader checks all archive CRCs and extracts the exact original audio.
      execFileSync('unzip', ['-tqq', archivePath], { stdio: 'pipe' });
      expect(execFileSync('unzip', ['-p', archivePath], { stdio: 'pipe' }).includes(Buffer.from('CANARY-DIRECT-MESSAGE-NEVER-EXPORT'))).toBe(false);
      const original = execFileSync('unzip', ['-p', archivePath, 'part-001.webm'], { stdio: 'pipe' });
      expect(original.equals(Buffer.from('CANARY-DRIVE-AUDIO-CONTENT'))).toBe(true);
    } finally { await rm(archiveDirectory, { recursive: true, force: true }); }
    expect(h.google.drive.calls.filter((call) => call.path.startsWith('/upload/')).every((call) => call.supportsAllDrives)).toBe(true);
    await runJobs(); await runJobs();
    expect(h.google.drive.files(b.google.sub)).toHaveLength(3);
  });

  it('exports a call from its note with one press, and uploads it without waiting for upkeep', async () => {
    const b = await connected(['notes-markdown', 'transcript-text'], false);
    const { noteId, title } = await completed(b);
    const before = await b.api.drive.forNote(noteId);
    expect(before).toMatchObject({ automatic: 'off', override: null, jobs: [] });
    // Export to Google Drive: this call's own choice, with the folder and files shown, and the uploads start at once.
    const pressed = await b.api.drive.setForNote(noteId, { enabled: true, destinationId: b.destinationId, formats: ['notes-markdown', 'transcript-text'] });
    expect(pressed.override).toMatchObject({ enabled: true, destination: { id: b.destinationId } });
    await idle();
    const jobs = (await b.api.drive.forNote(noteId)).jobs;
    expect(jobs.map((job) => job.status)).toEqual(['uploaded', 'uploaded']);
    expect(jobs.every((job) => job.nextAt === null && job.fileUrl?.startsWith('https://drive.google.com/file/d/'))).toBe(true);
    const files = h.google.drive.files(b.google.sub);
    expect(files.map((file) => file.mimeType).sort()).toEqual(['text/markdown', 'text/plain']);
    expect(files.every((file) => file.parents[0] === b.destinationId && file.bytes.toString('utf8').includes(title))).toBe(true);
  });

  it('says a call that ended before automatic exports were on isn’t covered, exports it when asked, and covers the next call', async () => {
    const b = await connected(['notes-markdown'], false);
    const earlier = await completed(b);
    await b.api.drive.update({ enabled: true, destinationId: b.destinationId, formats: ['notes-markdown'] });
    // The rule the exports follow, said for the call: it ended before they were turned on.
    expect((await b.api.drive.forNote(earlier.noteId)).automatic).toBe('before');
    await runJobs();
    expect((await b.api.drive.forNote(earlier.noteId)).jobs).toEqual([]);
    expect(h.google.drive.files(b.google.sub)).toHaveLength(0);
    // Exported on its own, with one press: no upkeep.
    await b.api.drive.setForNote(earlier.noteId, { enabled: true, destinationId: b.destinationId, formats: ['notes-markdown'] });
    await idle();
    expect((await b.api.drive.forNote(earlier.noteId)).jobs.map((job) => job.status)).toEqual(['uploaded']);
    // A call that ends now is covered, and goes as its notes are final, with no upkeep either.
    const later = await completed(b);
    const covered = await b.api.drive.forNote(later.noteId);
    expect(covered).toMatchObject({ automatic: 'on', override: null });
    expect(covered.jobs.map((job) => job.status)).toEqual(['uploaded']);
    expect(h.google.drive.files(b.google.sub)).toHaveLength(2);
  });

  it('says why a retrying export waits and when it’s tried next, and Try again sends it at once', async () => {
    const b = await connected(['notes-markdown']);
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 503);
    const { noteId } = await completed(b);
    const waiting = (await b.api.drive.forNote(noteId)).jobs[0];
    if (!waiting) throw new Error('Expected the export waiting to be tried again.');
    expect(waiting.status).toBe('pending');
    expect(waiting.reason).toBe('Google Drive could not confirm the upload. It will be checked before trying again.');
    expect(Date.parse(waiting.nextAt ?? '')).toBeGreaterThan(Date.now());
    h.google.drive.refuse();
    const retried = await b.api.drive.retry(waiting.id);
    expect(retried).toMatchObject({ status: 'pending', reason: null });
    await idle();
    expect((await b.api.drive.forNote(noteId)).jobs[0]).toMatchObject({ status: 'uploaded', reason: null, nextAt: null });
  });

  it('keeps exporting when an earlier step of upkeep fails', async () => {
    const b = await connected(['notes-markdown']);
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 503);
    const { noteId } = await completed(b);
    h.google.drive.refuse();
    // A notes job nobody can open, on another of the account's items: the notes step of upkeep fails on it, every time.
    const brokenJob = randomBytes(16).toString('base64url');
    const inserted = await h.pool.query(`INSERT INTO content_jobs (owner_id, job_id, revision_id, kind, state, attempt, job_ciphertext)
      SELECT owner_id, $2, revision_id, 'notes', 'queued', 0, $3 FROM revisions WHERE owner_id = $1 AND item_id <> $4 LIMIT 1`, [b.session.ownerId, brokenJob, Buffer.from('not a sealed notes job'), noteId]);
    expect(inserted.rowCount).toBe(1);
    try {
      await h.pool.query('UPDATE drive_export_jobs SET due_at = now() WHERE owner_id = $1', [b.session.ownerId]);
      await idle();
      await maintain(h.deps);
      expect((await b.api.drive.forNote(noteId)).jobs[0]?.status).toBe('uploaded');
      expect(h.logs.some((line) => line.includes('upkeep step failed') && line.includes('"what":"notes"'))).toBe(true);
    } finally { await h.pool.query('DELETE FROM content_jobs WHERE owner_id = $1 AND job_id = $2', [b.session.ownerId, brokenJob]); }
  });

  it('reconciles a committed upload whose reply was lost and survives a second API process without duplicates', async () => {
    const b = await connected(['notes-markdown']); h.google.drive.loseUploadReply();
    const { noteId } = await completed(b);
    await runJobs();
    const failed = (await b.api.drive.forNote(noteId)).jobs[0];
    expect(failed).toBeDefined();
    const second = await h.secondServer();
    try {
      const api = createHttpApi({ baseUrl: second.baseUrl, fetch: b.fetch });
      const job = (await api.drive.forNote(noteId)).jobs[0];
      if (job && job.status !== 'uploaded') await api.drive.retry(job.id);
      await uploaded(b, noteId, 1);
      expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
      expect(h.google.drive.files(b.google.sub)[0]?.updates).toBe(1);
    } finally { await second.close(); }
  });


  it('resumes a persisted large recording session after an intermediate chunk acknowledgment is lost and another API process retries', async () => {
    const b = await connected(['recording-zip']);
    const call = await b.api.calls.join((await b.api.calls.startNow({ notes: 'on', title: 'Large retained recording' })).code, { mic: true, cam: false });
    const pieces: Uint8Array<ArrayBuffer>[] = [];
    for (let seq = 0; seq < 9; seq++) {
      const bytes = new Uint8Array(1024 * 1024); bytes.fill(seq + 1); pieces.push(bytes);
      await call.appendAudio({ data: new Blob([bytes]), segment: 0, seq, at: seq * 5, durationMs: 5000, mimeType: 'audio/webm' });
    }
    const noteId = call.getSnapshot().notes.noteId ?? '';
    const initiatedBefore = h.google.drive.calls.filter((entry) => entry.path === '/upload/drive/v3/files').length;
    // Its export starts as soon as the notes are final, and the first chunk's acknowledgment is lost on the way.
    h.google.drive.loseChunkReply();
    await call.leave(); for await (const _progress of b.api.notes.progress(noteId)) { /* finalize all retained pieces */ }
    await runJobs();
    const job = (await b.api.drive.forNote(noteId)).jobs[0];
    if (!job) throw new Error('Expected the resumable recording job.');
    expect(job.status).toBe('pending');
    expect(h.google.drive.files(b.google.sub)).toHaveLength(0);
    const firstChunk = h.google.drive.calls.findLast((entry) => entry.path.startsWith('/drive-upload/') && entry.contentRange?.startsWith('bytes 0-'));
    expect(firstChunk?.contentRange).toMatch(/^bytes 0-8388607\//);
    const second = await h.secondServer();
    try {
      const api = createHttpApi({ baseUrl: second.baseUrl, fetch: b.fetch });
      await api.drive.retry(job.id);
      try { await uploaded(b, noteId, 1); }
      catch { throw new Error(`Resumable provider responses: ${JSON.stringify(h.google.drive.calls.filter((entry) => entry.path.startsWith('/drive-upload/')).map((entry) => ({ method: entry.method, range: entry.contentRange, status: entry.status })))}`); }
    } finally { await second.close(); }
    expect(h.google.drive.calls.filter((entry) => entry.path === '/upload/drive/v3/files')).toHaveLength(initiatedBefore + 1);
    const sessionRequests = h.google.drive.calls.filter((entry) => entry.path === firstChunk?.path);
    expect(sessionRequests.some((entry) => entry.contentRange?.startsWith('bytes */'))).toBe(true);
    expect(sessionRequests.some((entry) => entry.contentRange?.startsWith('bytes 8388608-'))).toBe(true);
    const archive = h.google.drive.files(b.google.sub)[0]; if (!archive) throw new Error('Expected the completed recording archive.');
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    const directory = await mkdtemp(join(tmpdir(), 'alcove-drive-resumed-'));
    try {
      const path = join(directory, 'recording.zip'); await writeFile(path, archive.bytes);
      execFileSync('unzip', ['-tqq', path], { stdio: 'pipe' });
      const original = execFileSync('unzip', ['-p', path, 'part-001.webm'], { stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 });
      expect(original.equals(Buffer.concat(pieces))).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('supports explicit retry, stops disabled exports and refuses to redirect from a deleted destination', async () => {
    const b = await connected(['notes-markdown']);
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 503);
    const { noteId } = await completed(b); await runJobs();
    const jobs = (await b.api.drive.forNote(noteId)).jobs;
    expect(jobs).toHaveLength(1);
    const job = jobs[0]; if (!job) throw new Error('Expected a persisted export job.');
    expect(['pending', 'failed']).toContain(job.status);
    h.google.drive.refuse();
    h.google.drive.folder(b.google.sub, { id: b.destinationId, name: 'Deleted destination', driveId: 'shared_drive', trashed: true });
    expect(code(await b.api.drive.retry(job.id).catch((error: unknown) => error))).toBe('unavailable');
    // Advance the persisted retry deadline, without changing its status or sealed job state.
    await h.pool.query('UPDATE drive_export_jobs SET due_at = now() WHERE owner_id = $1', [b.session.ownerId]);
    await runJobs();
    expect((await b.api.drive.forNote(noteId)).jobs[0]?.status).toBe('failed');
    expect(h.google.drive.files(b.google.sub)).toHaveLength(0);
    h.google.drive.folder(b.google.sub, { id: b.destinationId, name: 'Restored destination', driveId: 'shared_drive' });
    await b.api.drive.update({ enabled: false, destinationId: b.destinationId, formats: ['notes-markdown'] });
    expect(code(await b.api.drive.retry(job.id).catch((error: unknown) => error))).toBe('conflict'); await runJobs();
    expect(h.google.drive.files(b.google.sub)).toHaveLength(0);
  });

  it('scopes jobs and per-call overrides by access, stops revoked grants and physically deletes source job records', async () => {
    const b = await connected(['transcript-text']);
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'));
    const { noteId } = await completed(b); await runJobs();
    const other = await account();
    expect(code(await other.api.drive.forNote(noteId).catch((error: unknown) => error))).toBe('not-found');
    expect(code(await other.api.drive.setForNote(noteId, { enabled: true, destinationId: b.destinationId, formats: FORMATS }).catch((error: unknown) => error))).toBe('not-found');
    const job = (await b.api.drive.forNote(noteId)).jobs[0]; if (!job) throw new Error('Expected a job.');
    expect(code(await other.api.drive.retry(job.id).catch((error: unknown) => error))).toBe('not-found');
    expect(await other.api.drive.jobs()).toEqual([]);
    h.google.drive.refuse(); h.google.revoke(b.google.sub);
    expect(code(await b.api.drive.retry(job.id).catch((error: unknown) => error))).toBe('unavailable');
    await h.pool.query('UPDATE drive_export_jobs SET due_at = now() WHERE owner_id = $1', [b.session.ownerId]); await runJobs();
    expect((await b.api.drive.get()).connection.status).toBe('reconnect');
    expect(h.google.drive.files(b.google.sub)).toHaveLength(0);
    await b.api.notes.delete(noteId); await runJobs();
    expect((await h.pool.query('SELECT 1 FROM drive_export_jobs WHERE note_id = $1', [noteId])).rowCount).toBe(0);
    expect((await h.pool.query('SELECT 1 FROM drive_call_exports WHERE note_id = $1', [noteId])).rowCount).toBe(0);
    await b.api.drive.disconnect();
    expect((await h.pool.query('SELECT 1 FROM drive_connections WHERE owner_id = $1', [b.session.ownerId])).rowCount).toBe(0);
  });



  it('resumes preserved pending exports after reconnecting the same Google account without a manual retry', async () => {
    const b = await connected(['notes-markdown']);
    const reservedBefore = h.google.drive.calls.filter((call) => call.path === '/drive/v3/files/generateIds').length;
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 503);
    const { noteId } = await completed(b); await runJobs();
    const job = (await b.api.drive.forNote(noteId)).jobs[0];
    if (!job) throw new Error('Expected a durable pending export.');
    expect(job.status).toBe('pending');
    expect(h.google.drive.calls.filter((call) => call.path === '/drive/v3/files/generateIds')).toHaveLength(reservedBefore + 1);
    h.google.drive.refuse(); h.google.revoke(b.google.sub);
    await h.pool.query('UPDATE drive_export_jobs SET due_at = now() WHERE owner_id = $1', [b.session.ownerId]); await runJobs();
    expect((await b.api.drive.forNote(noteId)).jobs[0]?.status).toBe('reconnect');
    h.google.next(b.google);
    await finishConsent(b, (await b.api.drive.connect()).url);
    expect((await b.api.drive.get()).connection.status).toBe('connected');
    // Reconnecting starts what waited on it at once, without upkeep.
    await idle();
    expect((await b.api.drive.forNote(noteId)).jobs[0]?.status).toBe('uploaded');
    // Model a previous worker's delayed scheduler result landing after OAuth's resumption scan.
    await h.pool.query("UPDATE drive_export_jobs SET state = 'reconnect' WHERE owner_id = $1 AND job_id = $2", [b.session.ownerId, job.id]);
    const resumed = await uploaded(b, noteId, 1);
    expect(resumed[0]?.id).toBe(job.id);
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    expect(h.google.drive.calls.filter((call) => call.path === '/drive/v3/files/generateIds')).toHaveLength(reservedBefore + 1);
  });


  it('keeps freshly reconnected credentials when an older in-flight request later reports unauthorized', async () => {
    const b = await connected(['notes-markdown']);
    const generatedBefore = h.google.drive.calls.filter((call) => call.path === '/drive/v3/files/generateIds').length;
    // The export starts as the notes are final, in the background: its upload's answer is held, then refused.
    const oldResponse = h.google.drive.holdRefusal((call) => call.method === 'POST' && call.path === '/upload/drive/v3/files', 401);
    const { noteId } = await completed(b, undefined, false, false);
    try {
      await oldResponse.arrived;
      h.google.next(b.google);
      await finishConsent(b, (await b.api.drive.connect()).url);
      expect((await b.api.drive.get()).connection.status).toBe('connected');
    } finally { oldResponse.release(); }
    await idle();
    expect((await b.api.drive.get()).connection.status).toBe('connected');
    const job = (await b.api.drive.forNote(noteId)).jobs[0];
    expect(job?.status).toBe('pending');
    await h.pool.query('UPDATE drive_export_jobs SET due_at = now() WHERE owner_id = $1', [b.session.ownerId]);
    await uploaded(b, noteId, 1);
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    expect(h.google.drive.calls.filter((call) => call.path === '/drive/v3/files/generateIds')).toHaveLength(generatedBefore + 1);
  });

  it('retries a Google user rate limit as a transient failure without asking for a different destination', async () => {
    const b = await connected(['notes-markdown']);
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 403, 'userRateLimitExceeded');
    const { noteId } = await completed(b); await runJobs();
    const job = (await b.api.drive.forNote(noteId)).jobs[0];
    if (!job) throw new Error('Expected the rate-limited export.');
    expect(job.status).toBe('pending');
    expect(job.reason).not.toContain('Choose a folder');
    const retry = await h.pool.query<{ seconds: number }>('SELECT EXTRACT(EPOCH FROM due_at - now())::float AS seconds FROM drive_export_jobs WHERE owner_id = $1 AND job_id = $2', [b.session.ownerId, job.id]);
    expect(retry.rows[0]?.seconds).toBeGreaterThan(0);
    h.google.drive.refuse();
    await h.pool.query('UPDATE drive_export_jobs SET due_at = now() WHERE owner_id = $1 AND job_id = $2', [b.session.ownerId, job.id]);
    await uploaded(b, noteId, 1);
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    expect((await b.api.drive.get()).destination?.id).toBe(b.destinationId);
  });


  it('recovers a failed destination only after a replacement is explicitly selected and reuses that replacement file on retry', async () => {
    const b = await connected(['notes-markdown']);
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 503);
    const { noteId } = await completed(b); await runJobs();
    const job = (await b.api.drive.forNote(noteId)).jobs[0]; if (!job) throw new Error('Expected a queued export.');
    h.google.drive.refuse();
    h.google.drive.folder(b.google.sub, { id: b.destinationId, name: 'Destination was deleted', driveId: 'shared_drive', trashed: true });
    await h.pool.query('UPDATE drive_export_jobs SET due_at = now() WHERE owner_id = $1', [b.session.ownerId]); await runJobs();
    expect((await b.api.drive.forNote(noteId)).jobs[0]?.status).toBe('failed');
    const replacement = `replacement_${randomUUID()}`;
    h.google.drive.folder(b.google.sub, { id: replacement, name: 'Selected replacement', driveId: 'shared_drive' });
    await b.api.drive.update({ enabled: true, destinationId: replacement, formats: ['notes-markdown'] });
    await b.api.drive.retry(job.id); await uploaded(b, noteId, 1);
    const file = h.google.drive.files(b.google.sub)[0];
    expect(file?.parents).toEqual([replacement]);
    await b.api.drive.retry(job.id); await runJobs();
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    expect(h.google.drive.files(b.google.sub)[0]?.id).toBe(file?.id);
  });

  it('preserves a committed old copy and seals its history when a user explicitly retries into a new destination', async () => {
    const b = await connected(['notes-markdown']); h.google.drive.loseUploadReply();
    const { noteId } = await completed(b); await runJobs();
    const job = (await b.api.drive.forNote(noteId)).jobs[0]; const oldFile = h.google.drive.files(b.google.sub)[0];
    if (!job || !oldFile) throw new Error('Expected the upload whose committed response was lost.');
    expect(job.status).toBe('pending');
    const replacement = `intentional_${randomUUID()}`;
    h.google.drive.folder(b.google.sub, { id: replacement, name: 'Intentional second destination', driveId: 'shared_drive' });
    await b.api.drive.update({ enabled: true, destinationId: replacement, formats: ['notes-markdown'] });
    await b.api.drive.retry(job.id); await uploaded(b, noteId, 1);
    const files = h.google.drive.files(b.google.sub);
    expect(files).toHaveLength(2);
    expect(files.find((file) => file.id === oldFile.id)?.parents).toEqual([b.destinationId]);
    expect(files.find((file) => file.id !== oldFile.id)?.parents).toEqual([replacement]);
    const stored = await h.pool.query<{ state_ciphertext: Buffer; source_owner_id: string }>('SELECT state_ciphertext, source_owner_id FROM drive_export_jobs WHERE owner_id = $1 AND job_id = $2', [b.session.ownerId, job.id]);
    const bytes = stored.rows[0]?.state_ciphertext;
    if (!bytes) throw new Error('Expected the persisted export history.');
    expect(bytes.includes(Buffer.from(oldFile.id))).toBe(false);
    expect(bytes.includes(Buffer.from(b.destinationId))).toBe(false);
    const owner = await openOwner(h.deps, b.session.ownerId, undefined);
    try {
      const scope = `job:${job.id}`;
      const state = openJson(stateKey(owner.root, owner.ownerId, `drive:${scope}`), { v: 1, kind: 'drive-export', ownerId: owner.ownerId, scope, noteId, sourceOwnerId: stored.rows[0]?.source_owner_id ?? '', format: job.format }, bytes, z.object({ priorCopies: z.array(z.object({ fileId: z.string(), destination: z.object({ id: z.string() }) })) }));
      expect(state.priorCopies).toContainEqual({ fileId: oldFile.id, destination: { id: b.destinationId } });
    } finally { owner.root.fill(0); owner.wrapKey.fill(0); }
    await b.api.drive.retry(job.id); await runJobs();
    expect(h.google.drive.files(b.google.sub)).toHaveLength(2);
  });

  it('requires explicit per-call consent before a different Google account receives an intentional new copy', async () => {
    const b = await connected(['notes-markdown']); const { noteId } = await completed(b); await uploaded(b, noteId, 1);
    await b.api.drive.setForNote(noteId, { enabled: true, destinationId: b.destinationId, formats: ['notes-markdown'] });
    const previous = h.google.drive.files(b.google.sub)[0]; if (!previous) throw new Error('Expected the first account’s copy.');
    const nextGoogle = user(); const nextDestination = `newaccount_${randomUUID()}`;
    h.google.drive.folder(nextGoogle.sub, { id: nextDestination, name: 'Another Google account destination' }); h.google.drive.pick(nextGoogle.sub, nextDestination); h.google.next(nextGoogle);
    await finishConsent(b, (await b.api.drive.connect()).url);
    expect((await b.api.drive.get()).enabled).toBe(false);
    await runJobs();
    expect(h.google.drive.files(nextGoogle.sub)).toHaveLength(0);
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    await b.api.drive.setForNote(noteId, { enabled: true, destinationId: nextDestination, formats: ['notes-markdown'] });
    await uploaded(b, noteId, 1);
    expect(h.google.drive.files(nextGoogle.sub)).toHaveLength(1);
    expect(h.google.drive.files(nextGoogle.sub)[0]?.parents).toEqual([nextDestination]);
    expect(h.google.drive.files(nextGoogle.sub)[0]?.id).not.toBe(previous.id);
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    await runJobs(); expect(h.google.drive.files(nextGoogle.sub)).toHaveLength(1);
  });

  it('uses a per-call destination and updates an existing export when its finalized transcript is regenerated', async () => {
    const b = await connected(['transcript-text']);
    const secondFolder = `override_${randomUUID()}`;
    h.google.drive.folder(b.google.sub, { id: secondFolder, name: 'Project archive', driveId: 'shared_drive' });
    const call = await b.api.calls.join((await b.api.calls.startNow({ notes: 'on', title: 'Destination override' })).code, { mic: true, cam: false });
    await call.transcribe(speech('We agreed to launch on Friday.'), call.ticket.identity);
    const noteId = call.getSnapshot().notes.noteId ?? '';
    const selected = await b.api.drive.setForNote(noteId, { enabled: true, destinationId: secondFolder, formats: ['transcript-text'] });
    expect(selected.override?.destination?.id).toBe(secondFolder);
    expect((await b.api.drive.get()).destination?.id).toBe(b.destinationId);
    await call.leave(); for await (const _progress of b.api.notes.progress(noteId)) { /* finalization */ }
    await uploaded(b, noteId, 1);
    const first = h.google.drive.files(b.google.sub)[0];
    expect(first?.parents).toEqual([secondFolder]);
    const line = (await b.api.notes.get(noteId)).transcript?.[0];
    if (!line || !first) throw new Error('Expected the finalized transcript and its export.');
    await b.api.notes.correctLine(noteId, line.id, { text: 'We agreed to launch on Monday.' });
    await b.api.notes.rewrite(noteId);
    for await (const _progress of b.api.notes.progress(noteId)) { /* rewritten notes */ }
    await runJobs();
    await uploaded(b, noteId, 1);
    const files = h.google.drive.files(b.google.sub);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(first.id);
    expect(files[0]?.bytes.toString('utf8')).toContain('launch on Monday');
    expect(files[0]?.updates).toBe(2);
  });

  it('keeps unretained transcripts and recordings out of Drive even when their formats were selected', async () => {
    const b = await connected();
    const meeting = await b.api.meetings.create({ title: 'Notes only', startsAt: new Date().toISOString(), durationMinutes: 30, guests: [], notes: 'on', choices: { keepTranscript: false, keepRecording: false, allowScreens: false } });
    const call = await b.api.calls.join(meeting.code, { mic: true, cam: false });
    await call.appendAudio({ data: new Blob(['UNRETAINED-AUDIO']), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm' });
    await call.transcribe(speech('Mira will send the notes.'), call.ticket.identity);
    const noteId = call.getSnapshot().notes.noteId ?? '';
    await call.leave(); for await (const _progress of b.api.notes.progress(noteId)) { /* finalization */ }
    await uploaded(b, noteId, 1);
    expect((await b.api.notes.get(noteId)).kept).toEqual({ transcript: false, recording: false });
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    expect(h.google.drive.files(b.google.sub)[0]?.mimeType).toBe('text/markdown');
    const noNotes = await b.api.calls.join((await b.api.calls.startNow({ notes: 'off' })).code, { mic: false, cam: false });
    await noNotes.leave(); await runJobs();
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
  });


  it('does not present failed AI notes as complete while exporting separately finalized artifacts', async () => {
    const b = await connected();
    const call = await b.api.calls.join((await b.api.calls.startNow({ notes: 'on', title: 'Unavailable summary' })).code, { mic: true, cam: false });
    await call.appendAudio({ data: new Blob(['RETAINED-AUDIO-WITHOUT-SUMMARY']), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm' });
    await call.transcribe(speech('The transcript is complete even if the summary fails.'), call.ticket.identity);
    h.near.failNext(3, 'prose');
    const noteId = call.getSnapshot().notes.noteId ?? '';
    await call.leave();
    for (let i = 0; i < 100; i++) {
      const failed = await h.pool.query("SELECT 1 FROM content_jobs WHERE owner_id = $1 AND state = 'queued' AND attempt = 1", [b.session.ownerId]);
      if (failed.rowCount) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    for (let i = 0; i < 2; i++) {
      await h.pool.query("UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1", [b.session.ownerId]);
      await runJobs();
    }
    const note = await b.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', summary: '', writtenAt: null });
    await uploaded(b, noteId, 2);
    expect(h.google.drive.files(b.google.sub).map((file) => file.mimeType).sort()).toEqual(['application/zip', 'text/plain']);
  });


  it('keeps private room recordings outside automatic call exports and refuses a call override for them', async () => {
    const b = await connected();
    const recording = await b.api.recordings.start({ title: 'Private room memo' });
    await recording.appendAudio({ data: new Blob(['PRIVATE-ROOM-MEMO-AUDIO']), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm' });
    await recording.transcribe(speech('A private room memo is not a completed Alcove call.'));
    const { pendingNoteId } = await recording.stop();
    for await (const _progress of b.api.notes.progress(pendingNoteId)) { /* finalize the private memo */ }
    await runJobs();
    expect((await b.api.notes.get(pendingNoteId)).kind).toBe('room');
    expect(h.google.drive.files(b.google.sub)).toHaveLength(0);
    expect(await b.api.drive.jobs()).toEqual([]);
    expect(code(await b.api.drive.forNote(pendingNoteId).catch((error: unknown) => error))).toBe('not-found');
    expect(code(await b.api.drive.setForNote(pendingNoteId, { enabled: true, destinationId: b.destinationId, formats: FORMATS }).catch((error: unknown) => error))).toBe('not-found');
  });

  it('stops a queued shared export after its reader loses source permission and excludes their private material', async () => {
    const reader = await connected(); const organizer = await account();
    const { noteId } = await completed(organizer);
    await organizer.api.notes.share(noteId, { emails: [reader.session.user.email] });
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'));
    await reader.api.drive.setForNote(noteId, { enabled: true, destinationId: reader.destinationId, formats: FORMATS });
    await runJobs();
    expect((await reader.api.drive.forNote(noteId)).jobs.some((job) => job.format === 'recording-zip')).toBe(false);
    await reader.api.notes.delete(noteId);
    h.google.drive.refuse(); await runJobs();
    expect(code(await reader.api.drive.forNote(noteId).catch((error: unknown) => error))).toBe('not-found');
    expect(h.google.drive.files(reader.google.sub)).toHaveLength(0);
    expect((await organizer.api.notes.get(noteId)).status).toBe('ready');
  });


  it('rejects database source-reference tampering instead of exporting a different call through a valid sealed job', async () => {
    const b = await connected(['notes-markdown']);
    h.google.drive.refuse((call) => call.path.startsWith('/upload/'), 503);
    const first = await completed(b, 'Original sealed export source'); await runJobs();
    const job = (await b.api.drive.forNote(first.noteId)).jobs[0]; if (!job) throw new Error('Expected a sealed pending job.');
    const second = await completed(b, 'A different call must not replace the sealed source');
    // The second call's own export, made as its notes were final, makes way for the tampered row.
    await h.pool.query('DELETE FROM drive_export_jobs WHERE owner_id = $1 AND note_id = $2', [b.session.ownerId, second.noteId]);
    await h.pool.query('UPDATE drive_export_jobs SET note_id = $3, due_at = now() WHERE owner_id = $1 AND job_id = $2', [b.session.ownerId, job.id, second.noteId]);
    h.google.drive.refuse();
    expect(code(await b.api.drive.retry(job.id).catch((error: unknown) => error))).toBe('key-unavailable');
    const upkeepError = await runJobs().then(() => null, (error: unknown) => error);
    if (upkeepError !== null) expect(upkeepError instanceof Error ? upkeepError.name : '').toBe('IntegrityError');
    expect(h.google.drive.files(b.google.sub)).toHaveLength(0);
    // The scan may recreate the original source's missing job before finding the corrupted row.
    await h.pool.query('DELETE FROM drive_export_jobs WHERE owner_id = $1 AND note_id = $2 AND job_id <> $3', [b.session.ownerId, first.noteId, job.id]);
    // Restore the row and remove the unrelated source so subsequent maintenance has only the authorized job.
    await h.pool.query("UPDATE drive_export_jobs SET note_id = $3, state = 'pending', due_at = now(), lease_until = NULL, lease_id = NULL WHERE owner_id = $1 AND job_id = $2", [b.session.ownerId, job.id, first.noteId]);
    await b.api.notes.delete(second.noteId);
    await uploaded(b, first.noteId, 1);
    expect(h.google.drive.files(b.google.sub)).toHaveLength(1);
    expect(h.google.drive.files(b.google.sub)[0]?.bytes.toString('utf8')).toContain(first.title);
  });

  it('seals account, destination and job metadata and keeps readable copies out of rows and logs', async () => {
    const b = await connected(['notes-markdown']); const { noteId, title } = await completed(b); await uploaded(b, noteId, 1);
    const settings = await b.api.drive.get();
    const rows = await h.pool.query('SELECT to_jsonb(c)::text AS row FROM drive_connections c UNION ALL SELECT to_jsonb(j)::text AS row FROM drive_export_jobs j UNION ALL SELECT to_jsonb(o)::text AS row FROM drive_call_exports o');
    const saved = rows.rows.map((row: { row: string }) => row.row).join('\n');
    const logs = h.logs.join('\n');
    for (const canary of [b.google.email, title, settings.destination?.name ?? 'unused-folder-canary', b.destinationId, ...h.google.refreshTokens()]) {
      expect(saved).not.toContain(canary); expect(logs).not.toContain(canary);
    }
    const filesBefore = h.google.drive.files(b.google.sub).length;
    await b.api.notes.delete(noteId); await runJobs();
    expect(h.google.drive.files(b.google.sub)).toHaveLength(filesBefore);
  });
});
