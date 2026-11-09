import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { id128 } from '../../crypto';
import { exec, maybeOne, rows } from '../../db';
import { NotFoundError } from '../../errors';
import { log, withLogContext } from '../../log';
import { findOwner } from '../../owners';
import { artifact } from './drive-artifacts';
import { connection, JobRow, jobState, override, reconnect, saveJob, sealJob, type Connection } from './drive-state';
import { heldNoteIds, locate } from './service';
import * as provider from './drive-provider';

const dlog = log.child({ component: 'drive-exports' });
/** One durable export per selected artifact. Regeneration updates that file; ordinary duplicate events change nothing. */
export async function synchronize(o: Owner, onlyNoteId?: string): Promise<void> {
  const current = await connection(o);
  if (!current) return;
  const ids = onlyNoteId ? new Set([onlyNoteId]) : await heldNoteIds(o);
  if (!onlyNoteId) await exec(o.pool, 'DELETE FROM drive_export_jobs WHERE owner_id = $1 AND NOT (note_id = ANY($2::text[]))', [o.ownerId, [...ids]]);
  for (const noteId of ids) {
    let found;
    try { found = await locate(o, noteId); } catch (error) { if (error instanceof NotFoundError) continue; throw error; }
    try {
      if (found.note.manifest.kind !== 'call') continue;
      const selected = await override(o, noteId);
      const effective = selected ?? current;
      // Default consent starts now, not at the beginning of someone's private history.
      const ended = found.note.manifest.endedAt;
      if (!effective.enabled || !effective.destination || (!selected && (!ended || ended < current.enabledAt))) {

        continue;
      }

      for (const format of effective.formats) {
        const made = await artifact(o, noteId, format);
        if (!made) continue;
        const previous = await maybeOne(o.pool, JobRow, 'SELECT job_id, source_owner_id, note_id, format, state, attempt, state_ciphertext, lease_id FROM drive_export_jobs WHERE owner_id = $1 AND note_id = $2 AND format = $3', [o.ownerId, noteId, format]);
        if (previous) {
          const state = jobState(o, previous);
          if (state.generation !== current.generation || previous.state === 'uploading') continue;
          // A late old worker can write 'reconnect' after OAuth's resume scan. Reconcile that durable
          // ordering on every upkeep; a connected credential for the same account can resume this reservation.
          if (previous.state === 'reconnect' && current.status === 'connected') await saveJob(o, previous, { ...state, reason: null }, 'pending');
          if (state.sourceHash === made.hash) continue;
          // Keep the original selected destination and file ID when a finalized source is regenerated.
          await saveJob(o, previous, { ...state, sourceHash: made.hash, reason: null }, 'pending');
        } else {
          const jobId = id128();
          const state = { destination: effective.destination, uploadSession: null, priorCopies: [], generation: current.generation, fileId: null, sourceHash: made.hash, uploadedHash: null, reason: null, fileUrl: null, updatedAt: new Date().toISOString() };
          await exec(o.pool, "INSERT INTO drive_export_jobs (owner_id, job_id, source_owner_id, note_id, format, state, state_ciphertext) VALUES ($1,$2,$3,$4,$5,'pending',$6) ON CONFLICT (owner_id, note_id, format) DO NOTHING", [o.ownerId, jobId, found.owner.ownerId, noteId, format, sealJob(o, { job_id: jobId, note_id: noteId, source_owner_id: found.owner.ownerId, format }, state)]);
        }
      }
    } finally { if (!found.mine) { found.owner.root.fill(0); found.owner.wrapKey.fill(0); } }
  }
}
async function active(o: Owner, row: JobRow, expected: Connection): Promise<void> {
  const present = await exec(o.pool, `UPDATE drive_export_jobs SET lease_until = now() + interval '5 minutes' WHERE owner_id = $1 AND job_id = $2 AND state = 'uploading' AND lease_id = $3`, [o.ownerId, row.job_id, row.lease_id]);
  if (!present) throw new provider.DriveFailure('source');
  const latest = await connection(o);
  const selected = await override(o, row.note_id);
  const effective = selected ?? latest;
  if (!latest || latest.generation !== expected.generation || latest.status !== 'connected') throw new provider.DriveFailure('reconnect');
  if (latest.credentialVersion !== expected.credentialVersion) throw new provider.DriveFailure('transient');
  if (!effective?.enabled || !effective.formats.includes(row.format)) throw new provider.DriveFailure('source');
  const found = await locate(o, row.note_id);
  try { if (found.owner.ownerId !== row.source_owner_id) throw new provider.DriveFailure('source'); }
  finally { if (!found.mine) { found.owner.root.fill(0); found.owner.wrapKey.fill(0); } }
}
async function run(o: Owner, row: JobRow): Promise<void> {
  let state = jobState(o, row);
  let attempted: Connection | undefined;
  try {
    {
      // A worker that waited for another instance reads the job again before sending anything.
      const latest = await maybeOne(o.pool, JobRow, 'SELECT job_id, source_owner_id, note_id, format, state, attempt, state_ciphertext, lease_id FROM drive_export_jobs WHERE owner_id = $1 AND job_id = $2', [o.ownerId, row.job_id]);
      if (!latest || latest.state === 'uploaded' || latest.lease_id !== row.lease_id) return;
      state = jobState(o, latest);
      const current = await connection(o);
      attempted = current;
      if (!current || current.generation !== state.generation) throw new provider.DriveFailure('reconnect');
      await active(o, row, current);
      const made = await artifact(o, row.note_id, row.format);
      if (!made) throw new provider.DriveFailure('source');
      const access = await provider.token(o, current);
      await provider.folder(o, access, state.destination.id);
      if (!state.fileId) {
        state = { ...state, fileId: await provider.generateId(o, access), sourceHash: made.hash };
        // Persist the reserved ID before the first request that could create a file.
        await saveJob(o, row, state, 'uploading');
      }
      const fileId = state.fileId;
      if (!fileId) throw new provider.DriveFailure('transient');
      const existing = await provider.file(o, access, fileId);
      if (existing && (existing.trashed || !existing.parents.includes(state.destination.id) || existing.appProperties['alcoveJob'] !== row.job_id)) throw new provider.DriveFailure('destination');
      if (!existing || existing.appProperties['alcoveVersion'] !== made.hash) {
        await active(o, row, current);
        await provider.upload(o, access, { id: fileId, destinationId: state.destination.id, name: made.name, mimeType: made.mimeType, jobId: row.job_id, hash: made.hash, exists: !!existing, bytes: made.bytes(), size: made.size, session: state.uploadSession, check: () => active(o, row, current), saveSession: async (session) => { state = { ...state, uploadSession: session }; await saveJob(o, row, state, 'uploading'); } });
      }
      state = { ...state, sourceHash: made.hash, uploadedHash: made.hash, uploadSession: null, reason: null, fileUrl: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view` };
      await saveJob(o, row, state, 'uploaded');
      dlog.info('export uploaded', { jobId: row.job_id, noteId: row.note_id, format: row.format });
    }
  } catch (error) {
    const failure = error instanceof provider.DriveFailure ? error : error instanceof NotFoundError ? new provider.DriveFailure('source') : new provider.DriveFailure('transient');
    let refreshed = false;
    if (failure.why === 'reconnect' && attempted) {
      // Only the exact failed credential may be invalidated. A late old response cannot erase fresh consent.
      await reconnect(o, attempted);
      const latest = await connection(o);
      refreshed = latest?.generation === state.generation && latest.status === 'connected' && latest.credentialVersion !== attempted.credentialVersion;
    }
    const status = failure.why === 'reconnect' ? (refreshed ? 'pending' : 'reconnect') : failure.why === 'transient' && row.attempt < 8 ? 'pending' : 'failed';
    await saveJob(o, row, { ...state, reason: refreshed ? null : failure.message }, status, Math.min(3600, 20 * 2 ** Math.min(row.attempt, 7)));
    dlog.warn('export waiting', { jobId: row.job_id, noteId: row.note_id, reason: failure.why, attempt: row.attempt, ...(error instanceof provider.DriveFailure || error instanceof NotFoundError ? {} : { err: error }) });
  }
}
/** Opens and wipes the exporting owner's keys for each scan/job, just like the notes writer. */
export async function work(d: Deps, ownerId?: string): Promise<number> {
  let after = '';
  for (;;) {
    const owners = await rows(d.pool, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM drive_connections WHERE ($1::text IS NULL OR owner_id = $1) AND owner_id > $2 ORDER BY owner_id LIMIT 100', [ownerId ?? null, after]);
    for (const entry of owners) {
      const owner = await findOwner(d, entry.owner_id, undefined);
      if (!owner) continue;
      try { await synchronize(owner); }
      catch (error) { dlog.warn('export scan delayed', { ownerId: owner.ownerId, code: error instanceof provider.DriveFailure ? error.why : 'unavailable', ...(error instanceof provider.DriveFailure ? {} : { err: error }) }); }
      finally { owner.root.fill(0); owner.wrapKey.fill(0); }
    }
    const last = owners.at(-1);
    if (!last || owners.length < 100) break;
    after = last.owner_id;
  }
  let completed = 0;
  for (let count = 0; count < 30; count++) {
    const row = await maybeOne(d.pool, JobRow.extend({ owner_id: z.string() }), `WITH due AS (
      SELECT owner_id, job_id FROM drive_export_jobs WHERE (state = 'pending' OR state = 'uploading') AND due_at <= now() AND (lease_until IS NULL OR lease_until < now()) AND ($1::text IS NULL OR owner_id = $1) ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE drive_export_jobs j SET state = 'uploading', lease_id = $2, lease_until = now() + interval '5 minutes', attempt = j.attempt + 1 FROM due WHERE j.owner_id = due.owner_id AND j.job_id = due.job_id RETURNING j.*`, [ownerId ?? null, id128()]);
    if (!row) break;
    const owner = await findOwner(d, row.owner_id, undefined);
    if (!owner) continue;
    try { await withLogContext({ ownerId: row.owner_id, jobId: row.job_id }, () => run(owner, row)); completed++; }
    finally { owner.root.fill(0); owner.wrapKey.fill(0); }
  }
  return completed;
}
