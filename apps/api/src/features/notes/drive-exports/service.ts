import type { DriveCallExports, DriveExportChoice, DriveExportInput, DriveExportJob, DriveSettings } from '@alcove/api';
import type { Owner } from '../../../platform/context';
import { exec, maybeOne, rows, tx, type Db } from '../../../platform/db';
import { ConflictError, NotFoundError } from '../../../platform/errors';
import { connection, jobs, JobRow, jobView, override, saveConnection, seal, sealJob, settings, jobState } from './state';
import * as provider from './provider';
import { holdAccess, locate } from '../access';
import { automatic, kick, synchronize } from './worker';

/** Short policy changes take turns across instances. Network access and pooled reads happen before the transaction. */
export async function lock(o: Owner, db: Db): Promise<void> { await exec(db, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 9170))', [o.ownerId]); }
export const get = async (o: Owner): Promise<DriveSettings> => settings(await connection(o));
async function choice(o: Owner, input: DriveExportInput, current: Awaited<ReturnType<typeof connection>>): Promise<DriveExportChoice> {
  if (input.enabled && (!current || current.status !== 'connected')) throw new ConflictError('Connect Google Drive before enabling uploads.');
  if (input.enabled && (!input.destinationId || !input.formats.length)) throw new ConflictError('Choose a destination folder and at least one export format.');
  const destination = input.destinationId && current ? await provider.folder(o, await provider.token(o, current), input.destinationId) : null;
  return { enabled: input.enabled, destination, formats: [...new Set(input.formats)] };
}
export async function update(o: Owner, input: DriveExportInput): Promise<DriveSettings> {
  const current = await connection(o);
  if (!current) throw new ConflictError('Connect Google Drive before changing exports.');
  const next = await choice(o, input, current);
  return tx(o.pool, async (db) => {
    await lock(o, db);
    const latest = await connection(o, db);
    if (!latest || latest.generation !== current.generation) throw new ConflictError('Your Google Drive connection changed. Try again.');
    const saved = { ...latest, ...next, enabledAt: next.enabled && !latest.enabled ? new Date().toISOString() : latest.enabledAt };
    await saveConnection(o, saved, db);
    return settings(saved);
  });
}
export async function disconnect(o: Owner): Promise<DriveSettings> {
  await tx(o.pool, async (db) => {
    await lock(o, db);
    await exec(db, 'DELETE FROM drive_export_jobs WHERE owner_id = $1', [o.ownerId]);
    await exec(db, 'DELETE FROM drive_call_exports WHERE owner_id = $1', [o.ownerId]);
    await exec(db, 'DELETE FROM drive_connections WHERE owner_id = $1', [o.ownerId]);
  });
  // Google revokes an entire client's grant, including Calendar. Local deletion keeps these connections independent.
  return settings(undefined);
}
export async function folders(o: Owner) {
  const current = await connection(o);
  if (!current) return [];
  return provider.folders(o, await provider.token(o, current));
}
/** This person's exports of one call: its own choice, if it has one, what applies, whether automatic exports cover it, and its jobs. */
export async function forNote(o: Owner, noteId: string): Promise<DriveCallExports> {
  const found = await locate(o, noteId);
  try {
    if (found.note.manifest.kind !== 'call') throw new NotFoundError('Google Drive call exports are only available for calls.');
    const current = await connection(o);
    const selected = await override(o, noteId);
    const effective = selected ?? (current ? { enabled: current.enabled, destination: current.destination, formats: current.formats } : { enabled: false, destination: null, formats: [] });
    await synchronize(o, noteId);
    return { noteId, override: selected, effective, automatic: automatic(current, found.note.manifest.endedAt), jobs: await jobs(o, noteId) };
  } finally { if (!found.mine) { found.owner.root.fill(0); found.owner.wrapKey.fill(0); } }
}
export async function setForNote(o: Owner, noteId: string, input: DriveExportInput | null): Promise<DriveCallExports> {
  const found = await locate(o, noteId);
  try {
    if (found.note.manifest.kind !== 'call') throw new NotFoundError('Google Drive call exports are only available for calls.');
    const current = await connection(o);
    const next = input === null ? null : await choice(o, input, current);
    await tx(o.pool, async (db) => {
      await lock(o, db);
      await holdAccess(o, found, db);
      const latest = await connection(o, db);
      if (next && (!latest || latest.generation !== current?.generation)) throw new ConflictError('Your Google Drive connection changed. Try again.');
      if (next === null) await exec(db, 'DELETE FROM drive_call_exports WHERE owner_id = $1 AND note_id = $2', [o.ownerId, noteId]);
      else await exec(db, 'INSERT INTO drive_call_exports (owner_id, source_owner_id, note_id, state_ciphertext) VALUES ($1,$2,$3,$4) ON CONFLICT (owner_id, note_id) DO UPDATE SET state_ciphertext = EXCLUDED.state_ciphertext', [o.ownerId, found.owner.ownerId, noteId, seal(o, `call:${noteId}`, next)]);
      // A different Google account cannot reuse the previous account's provider IDs. This explicit per-call
      // consent intentionally creates that account's own copy; reconnecting the same account keeps all IDs.
      if (next?.enabled && next.destination && latest) {
        const existing = await rows(db, JobRow, 'SELECT job_id, source_owner_id, note_id, format, state, attempt, state_ciphertext, lease_id FROM drive_export_jobs WHERE owner_id = $1 AND note_id = $2', [o.ownerId, noteId]);
        for (const job of existing) {
          const state = jobState(o, job);
          if (state.generation === latest.generation || !next.formats.includes(job.format)) continue;
          const fresh = { ...state, generation: latest.generation, destination: next.destination, fileId: null, uploadedHash: null, uploadSession: null, fileUrl: null, priorCopies: [...state.priorCopies, ...(state.fileId ? [{ fileId: state.fileId, destination: state.destination }] : [])], reason: null, updatedAt: new Date().toISOString() };
          await exec(db, "UPDATE drive_export_jobs SET state = 'pending', attempt = 0, lease_until = NULL, lease_id = NULL, due_at = now(), state_ciphertext = $3 WHERE owner_id = $1 AND job_id = $2", [o.ownerId, job.job_id, sealJob(o, job, fresh)]);
        }
      }
      // Reserved provider IDs survive same-account policy changes, including an upload whose response never arrived.
    });
  } finally { if (!found.mine) { found.owner.root.fill(0); found.owner.wrapKey.fill(0); } }
  // Its jobs are worked out here, and what's due goes now, in the background: not at the next upkeep.
  const exports = await forNote(o, noteId);
  kick(o, o.ownerId);
  return exports;
}
export async function retry(o: Owner, jobId: string): Promise<DriveExportJob> {
  const row = await maybeOne(o.pool, JobRow, 'SELECT job_id, source_owner_id, note_id, format, state, attempt, state_ciphertext, lease_id FROM drive_export_jobs WHERE owner_id = $1 AND job_id = $2', [o.ownerId, jobId]);
  if (!row) throw new NotFoundError('That export is no longer available.');
  const found = await locate(o, row.note_id);
  try {
    if (row.state === 'uploaded') return jobView(o, row, null);
    if (row.state === 'uploading') throw new ConflictError('This export is uploading. Wait for it to finish.');
    const current = await connection(o);
    if (!current || current.status !== 'connected') throw new ConflictError('Reconnect Google Drive before retrying this upload.');
    const selected = await override(o, row.note_id);
    const effective = selected ?? current;
    if (!effective.enabled || !effective.formats.includes(row.format)) throw new ConflictError('Enable this export before retrying it.');
    const state = jobState(o, row);
    if (!effective.destination) throw new ConflictError('Choose a destination folder before retrying.');
    const access = await provider.token(o, current);
    const destination = await provider.folder(o, access, effective.destination.id);
    const changed = state.generation !== current.generation || destination.id !== state.destination.id;
    if (changed && state.fileId && state.generation === current.generation) {
      // Check an ambiguous old upload before an explicitly chosen new destination creates a new copy.
      // Even if that old file was removed or became unreadable, its reserved ID remains in the sealed history.
      const previous = await provider.file(o, access, state.fileId);
      if (previous && previous.appProperties['alcoveJob'] !== row.job_id) throw new ConflictError('The previous exported file no longer matches this export.');
    }
    const retried = changed ? { ...state, destination, generation: current.generation, fileId: null, uploadedHash: null, uploadSession: null, fileUrl: null, priorCopies: [...state.priorCopies, ...(state.fileId ? [{ fileId: state.fileId, destination: state.destination }] : [])] } : state;
    const queued = await tx(o.pool, async (db) => {
      await lock(o, db);
      await holdAccess(o, found, db);
      const latest = await connection(o, db);
      if (!latest || latest.generation !== current.generation) throw new ConflictError('Your Google Drive connection changed. Try again.');
      const next = { ...retried, reason: null, updatedAt: new Date().toISOString() };
      await exec(db, "UPDATE drive_export_jobs SET state = 'pending', state_ciphertext = $3, attempt = 0, lease_until = NULL, lease_id = NULL, due_at = now() WHERE owner_id = $1 AND job_id = $2 AND state IN ('pending', 'failed', 'reconnect')", [o.ownerId, jobId, sealJob(o, row, next)]);
      return jobView(o, { ...row, state: 'pending', state_ciphertext: sealJob(o, row, next).slice() }, new Date());
    });
    // Tried again now, in the background: not at the next upkeep.
    kick(o, o.ownerId);
    return queued;
  } finally { if (!found.mine) { found.owner.root.fill(0); found.owner.wrapKey.fill(0); } }
}
export const listJobs = jobs;
