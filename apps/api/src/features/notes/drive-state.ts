import { DriveExportChoiceSchema, DriveExportFormatSchema, DriveFolderSchema, type DriveExportJob, type DriveSettings } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../context';
import { openJson, sealJson, stateKey, toJson } from '../../crypto';
import { bytea, exec, maybeOne, rows, timestamp, type Db } from '../../db';

export const Connection = z.object({
  email: z.string().email(), permissionId: z.string(), refreshToken: z.string().nullable(), credentialVersion: z.string(), generation: z.string(),
  status: z.enum(['connected', 'reconnect']), enabled: z.boolean(), destination: DriveFolderSchema.nullable(),
  formats: z.array(DriveExportFormatSchema), enabledAt: z.string()
});
export type Connection = z.infer<typeof Connection>;
export const JobState = z.object({
  destination: DriveFolderSchema, generation: z.string(), fileId: z.string().nullable(),
  sourceHash: z.string(), uploadedHash: z.string().nullable(), reason: z.string().nullable(),
  uploadSession: z.object({ url: z.string().url(), size: z.number().int().min(1), hash: z.string(), offset: z.number().int().min(0).default(0) }).nullable().default(null),
  priorCopies: z.array(z.object({ fileId: z.string(), destination: DriveFolderSchema })).default([]),
  fileUrl: z.string().nullable(), updatedAt: z.string()
});
export type JobState = z.infer<typeof JobState>;
export const JobRow = z.object({ job_id: z.string(), source_owner_id: z.string(), note_id: z.string(), format: DriveExportFormatSchema, state: z.enum(['pending', 'uploading', 'uploaded', 'failed', 'reconnect']), attempt: z.number(), state_ciphertext: bytea, lease_id: z.string().nullable().default(null) });
export type JobRow = z.infer<typeof JobRow>;
const header = (o: Owner, scope: string) => ({ v: 1 as const, kind: 'drive-export', ownerId: o.ownerId, scope });
export const seal = (o: Owner, scope: string, value: unknown): Uint8Array => sealJson(stateKey(o.root, o.ownerId, `drive:${scope}`), header(o, scope), toJson(value));
export const open = <S extends z.ZodType>(o: Owner, scope: string, bytes: Uint8Array, schema: S): z.infer<S> => openJson(stateKey(o.root, o.ownerId, `drive:${scope}`), header(o, scope), bytes, schema);
export async function connection(o: Owner, db: Db = o.pool): Promise<Connection | undefined> {
  const row = await maybeOne(db, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM drive_connections WHERE owner_id = $1', [o.ownerId]);
  return row ? open(o, 'connection', row.state_ciphertext, Connection) : undefined;
}
export async function saveConnection(o: Owner, value: Connection, db: Db = o.pool): Promise<void> {
  await exec(db, 'INSERT INTO drive_connections (owner_id, state_ciphertext) VALUES ($1,$2) ON CONFLICT (owner_id) DO UPDATE SET state_ciphertext = EXCLUDED.state_ciphertext', [o.ownerId, seal(o, 'connection', value)]);
}
/** Revocation never recreates a disconnected connection or overwrites a concurrent reauthorization. */
export async function reconnect(o: Owner, expected: Connection): Promise<void> {
  const row = await maybeOne(o.pool, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM drive_connections WHERE owner_id = $1', [o.ownerId]);
  if (!row) return;
  const latest = open(o, 'connection', row.state_ciphertext, Connection);
  if (latest.generation !== expected.generation || latest.credentialVersion !== expected.credentialVersion || latest.refreshToken !== expected.refreshToken) return;
  await exec(o.pool, 'UPDATE drive_connections SET state_ciphertext = $3 WHERE owner_id = $1 AND state_ciphertext = $2', [o.ownerId, row.state_ciphertext, seal(o, 'connection', { ...latest, status: 'reconnect', refreshToken: null })]);
}
export function settings(value: Connection | undefined): DriveSettings {
  return value ? { connection: { status: value.status, email: value.email }, enabled: value.enabled, destination: value.destination, formats: value.formats }
    : { connection: { status: 'disconnected', email: null }, enabled: false, destination: null, formats: ['notes-markdown', 'transcript-text'] };
}
export async function override(o: Owner, noteId: string, db: Db = o.pool) {
  const row = await maybeOne(db, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM drive_call_exports WHERE owner_id = $1 AND note_id = $2', [o.ownerId, noteId]);
  return row ? open(o, `call:${noteId}`, row.state_ciphertext, DriveExportChoiceSchema) : null;
}
type JobLocation = Pick<JobRow, 'job_id' | 'note_id' | 'source_owner_id' | 'format'>;
const jobHeader = (o: Owner, row: JobLocation) => ({ ...header(o, `job:${row.job_id}`), noteId: row.note_id, sourceOwnerId: row.source_owner_id, format: row.format });
export const sealJob = (o: Owner, row: JobLocation, value: JobState): Uint8Array => sealJson(stateKey(o.root, o.ownerId, `drive:job:${row.job_id}`), jobHeader(o, row), toJson(value));
export const jobState = (o: Owner, row: JobRow): JobState => openJson(stateKey(o.root, o.ownerId, `drive:job:${row.job_id}`), jobHeader(o, row), row.state_ciphertext, JobState);
/** A job as its owner sees it. `due`: when it's next tried, which only a pending one says. */
export function jobView(o: Owner, row: JobRow, due: Date | null): DriveExportJob {
  const state = jobState(o, row);
  return {
    id: row.job_id, noteId: row.note_id, format: row.format, status: row.state, reason: state.reason, fileUrl: state.fileUrl, updatedAt: state.updatedAt,
    nextAt: row.state === 'pending' && due ? due.toISOString() : null
  };
}
export async function jobs(o: Owner, noteId?: string): Promise<DriveExportJob[]> {
  const found = await rows(o.pool, JobRow.extend({ due_at: timestamp }), 'SELECT job_id, source_owner_id, note_id, format, state, attempt, state_ciphertext, lease_id, due_at FROM drive_export_jobs WHERE owner_id = $1 AND ($2::text IS NULL OR note_id = $2) ORDER BY due_at DESC LIMIT 100', [o.ownerId, noteId ?? null]);
  return found.map((row) => jobView(o, row, row.due_at));
}
export async function saveJob(o: Owner, row: JobRow, state: JobState, status: JobRow['state'], delaySeconds = 0): Promise<void> {
  await exec(o.pool, `UPDATE drive_export_jobs SET state = $3, state_ciphertext = $4, lease_until = CASE WHEN $3 = 'uploading' THEN now() + interval '5 minutes' ELSE NULL END, lease_id = CASE WHEN $3 = 'uploading' THEN lease_id ELSE NULL END, due_at = now() + make_interval(secs => $5) WHERE owner_id = $1 AND job_id = $2 AND ($6::text IS NULL OR lease_id = $6) AND ($6::text IS NOT NULL OR state <> 'uploading')`, [o.ownerId, row.job_id, status, sealJob(o, row, { ...state, updatedAt: new Date().toISOString() }), delaySeconds, row.lease_id]);
}
