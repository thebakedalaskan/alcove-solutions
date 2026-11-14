/*
 * A note's writing, as an operator sees it from outside the enclave (routes.ts): where its recording, its notes job,
 * its live transcript, its Drive exports and its shared screens stand, read from their rows alone, and what this
 * instance logged about it going wrong, from the ring (platform/recent.ts), which keeps no free text. No sealed column
 * is selected and no key is opened, so nothing anyone said is read. Retrying makes a notes job that waits on the notes
 * model, or is queued to be tried again, due now and starts the writer; retrying the exports makes those waiting to be
 * tried again due now and starts their exporters. The answers' schemas are here, and the operator CLI
 * (features/operator/cli/calls.ts) parses them.
 */
import { DriveExportFormatSchema } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../../platform/context';
import { exec, maybeOne, rows, timestamp, tx, type Db } from '../../../platform/db';
import { ConflictError } from '../../../platform/errors';
import { log } from '../../../platform/log';
import { recent } from '../../../platform/recent';
import * as screens from '../../recordings/screens/screens';
import { kick as kickExports } from '../drive-exports/worker';
import { claimableNotes, kick as kickWriter } from '../writing/writer';

const nlog = log.child({ component: 'notes' });

/** A notes job's state, and whether the writer can take it now, by the writer's own rule (writer.ts › claimableNotes). */
const JobNow = z.object({ state: z.enum(['queued', 'writing', 'waiting']), attempt: z.number(), leaseUntil: z.string().nullable(), claimable: z.boolean() });
export type JobNow = z.infer<typeof JobNow>;

/**
 * A note's notes job (docs: Notes and inference › Note states). `attempt` counts claims, up to 3; one whose model didn't check
 * out or answer gave its attempt back. `queuedAt` is when it was queued: exactly, for the first notes; for notes being written
 * again (`again`), when the notes it was queued for were saved, so it was queued then or later and has waited at most since.
 */
export const NotesJobAnswer = JobNow.extend({ jobId: z.string(), queuedAt: z.string(), again: z.boolean() });
export type NotesJobAnswer = z.infer<typeof NotesJobAnswer>;

/**
 * A line this instance logged about a note that says something went wrong (the ring, platform/recent.ts): when, its message,
 * the error's code, and the status another service answered with (`upstreamStatus`): the notes model's, say.
 */
const NoteLine = z.object({ at: z.string(), msg: z.string(), code: z.string().nullable(), upstreamStatus: z.number().int().nullable() });
export type NoteLine = z.infer<typeof NoteLine>;

/** GET /v1/operator/notes/:noteId. */
export const NoteAnswer = z.object({
  instance: z.string(),
  at: z.string(),
  noteId: z.string(),
  /** Its recording: `screensTailEndsBy`, the latest a kept shared screen's last piece can arrive, null without one that ended. */
  recording: z.object({
    recordingId: z.string(), state: z.enum(['recording', 'paused', 'stopped']), startedAt: z.string(), endedAt: z.string().nullable(), screensTailEndsBy: z.string().nullable()
  }).nullable(),
  /** Its notes job, or null once its notes are written (or when it never had any). */
  job: NotesJobAnswer.nullable(),
  /** The live transcript's clips, kept until the recording stops, and how long since the last was heard. */
  transcript: z.object({ clips: z.number(), sinceLastS: z.number().nullable() }),
  /** Its Drive exports, the organizer's and those of people it went to: whose is said, never who. */
  exports: z.array(z.object({
    jobId: z.string(), format: DriveExportFormatSchema, state: z.enum(['pending', 'uploading', 'uploaded', 'failed', 'reconnect']), attempt: z.number(),
    dueAt: z.string(), leased: z.boolean(), to: z.enum(['organizer', 'invited'])
  })),
  /** Its kept shared screens: pieces still to be joined into video, and their bytes; videos joined; whether joining them is due. */
  screens: z.object({ pieces: z.number(), bytes: z.number(), videos: z.number(), joinDue: z.boolean() }),
  /**
   * This instance's recent lines about it that say something went wrong, oldest first: its writer's failures, and requests
   * about it refused or failed. Another instance's, and older ones, are in Cloud Logging.
   */
  recent: z.array(NoteLine)
});
export type NoteAnswer = z.infer<typeof NoteAnswer>;

/** POST /v1/operator/notes/:noteId/retry: the notes job before and after it was made due. */
export const NoteRetryAnswer = z.object({ instance: z.string(), at: z.string(), noteId: z.string(), jobId: z.string(), before: JobNow, after: JobNow });
export type NoteRetryAnswer = z.infer<typeof NoteRetryAnswer>;

/** POST /v1/operator/notes/:noteId/exports/retry: how many exports were made due. */
export const ExportsRetryAnswer = z.object({ instance: z.string(), at: z.string(), noteId: z.string(), retried: z.number() });
export type ExportsRetryAnswer = z.infer<typeof ExportsRetryAnswer>;

const iso = (t: Date) => t.toISOString();

/** Whose a note is, by its ID alone: undefined when no note has it, or it has been deleted. */
export async function noteOwner(d: Pick<Deps, 'pool'>, noteId: string): Promise<string | undefined> {
  const r = await maybeOne(d.pool, z.object({ owner_id: z.string() }), `SELECT owner_id FROM items WHERE item_id = $1 AND kind = 'note' AND deleted_at IS NULL LIMIT 1`, [noteId]);
  return r?.owner_id;
}

const JobRow = z.object({ job_id: z.string(), state: z.enum(['queued', 'writing', 'waiting']), attempt: z.number(), lease_until: timestamp.nullable(), claimable: z.boolean() });
const jobNow = (r: z.infer<typeof JobRow>): JobNow => ({ state: r.state, attempt: r.attempt, leaseUntil: r.lease_until ? iso(r.lease_until) : null, claimable: r.claimable });

/**
 * A note's notes job, from its row alone, or null when it has none. Its first notes are queued in the transaction that stops
 * the recording, for the revision that transaction makes, so the two share a time; notes written again are queued for the
 * revision that holds them then, which was made earlier.
 */
export async function noteJob(db: Db, ownerId: string, noteId: string): Promise<NotesJobAnswer | null> {
  const r = await maybeOne(db, JobRow.extend({ queued_at: timestamp, again: z.boolean() }), `
    SELECT j.job_id, j.state, j.attempt, j.lease_until, ${claimableNotes('j')} AS claimable, r.created_at AS queued_at,
      NOT EXISTS (SELECT 1 FROM recordings x WHERE x.owner_id = j.owner_id AND x.note_item_id = r.item_id AND x.ended_at = r.created_at) AS again
    FROM content_jobs j JOIN revisions r ON r.owner_id = j.owner_id AND r.revision_id = j.revision_id
    WHERE j.owner_id = $1 AND j.kind = 'notes' AND r.item_id = $2 ORDER BY r.created_at DESC LIMIT 1`, [ownerId, noteId]);
  return r ? { jobId: r.job_id, ...jobNow(r), queuedAt: iso(r.queued_at), again: r.again } : null;
}

const RecordingRow = z.object({ recording_id: z.string(), state: z.enum(['recording', 'paused', 'stopped']), started_at: timestamp, ended_at: timestamp.nullable() });
const Count = z.object({ n: z.number() });
const Clips = z.object({ clips: z.number(), since: z.number().nullable() });
const Pieces = z.object({ pieces: z.number(), bytes: z.coerce.number() });
const ExportRow = z.object({
  job_id: z.string(), format: DriveExportFormatSchema, state: z.enum(['pending', 'uploading', 'uploaded', 'failed', 'reconnect']), attempt: z.number(),
  due_at: timestamp, leased: z.boolean(), organizer: z.boolean()
});

/** The live transcript's clips for a note, and how long since the last was heard, in the database's own time. */
export async function clipsOf(db: Db, ownerId: string, noteId: string): Promise<{ clips: number; sinceLastS: number | null }> {
  const r = await maybeOne(db, Clips, `SELECT count(*)::int AS clips, extract(epoch FROM now() - max(heard_at))::float8 AS since
    FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2`, [ownerId, noteId]);
  const since = r?.since ?? null;
  return { clips: r?.clips ?? 0, sinceLastS: since === null ? null : Math.max(0, Math.round(since)) };
}

/** Where a note's writing stands (GET /v1/operator/notes/:noteId), for a note of `ownerId`'s. */
export async function lookUpNote(d: Pick<Deps, 'pool'>, ownerId: string, noteId: string, instance: string): Promise<NoteAnswer> {
  const db = d.pool;
  const rec = await maybeOne(db, RecordingRow, `SELECT recording_id, state, started_at, ended_at FROM recordings
    WHERE owner_id = $1 AND note_item_id = $2 ORDER BY started_at DESC LIMIT 1`, [ownerId, noteId]);
  const tail = rec ? await screens.tailEndsAt({ pool: db, ownerId }, rec.recording_id, 0) : null;
  const pieces = rec ? await maybeOne(db, Pieces, `SELECT count(*)::int AS pieces, coalesce(sum(cipher_bytes), 0)::bigint AS bytes
    FROM screen_pieces WHERE owner_id = $1 AND recording_id = $2`, [ownerId, rec.recording_id]) : undefined;
  const videos = rec ? await maybeOne(db, Count, `SELECT count(*)::int AS n FROM (SELECT DISTINCT share_id, segment FROM screen_videos
    WHERE owner_id = $1 AND recording_id = $2) v`, [ownerId, rec.recording_id]) : undefined;
  const exports = await rows(db, ExportRow, `SELECT job_id, format, state, attempt, due_at, (lease_until IS NOT NULL AND lease_until > now()) AS leased,
    owner_id = source_owner_id AS organizer FROM drive_export_jobs WHERE source_owner_id = $1 AND note_id = $2 ORDER BY format, job_id`, [ownerId, noteId]);
  const left = pieces?.pieces ?? 0;
  return {
    instance, at: iso(new Date()), noteId,
    recording: rec ? { recordingId: rec.recording_id, state: rec.state, startedAt: iso(rec.started_at), endedAt: rec.ended_at ? iso(rec.ended_at) : null, screensTailEndsBy: tail === null ? null : iso(new Date(tail)) } : null,
    job: await noteJob(db, ownerId, noteId),
    transcript: await clipsOf(db, ownerId, noteId),
    exports: exports.map((x) => ({ jobId: x.job_id, format: x.format, state: x.state, attempt: x.attempt, dueAt: iso(x.due_at), leased: x.leased, to: x.organizer ? 'organizer' : 'invited' })),
    // Joined by the writer, or upkeep, once the recording has stopped and the last piece can't arrive any more (screens.joinDue).
    screens: { pieces: left, bytes: pieces?.bytes ?? 0, videos: videos?.n ?? 0, joinDue: left > 0 && rec?.state === 'stopped' && (tail === null || tail <= Date.now()) },
    recent: recent.forId('noteId', noteId).map((l) => ({ at: iso(new Date(l.at)), msg: l.msg, code: l.code, upstreamStatus: l.upstreamStatus }))
  };
}

/**
 * Makes a note's notes job due now and starts its organizer's writer: one that waits on the notes model (its evidence didn't
 * check out, or it didn't answer), or is queued to be tried again. One already due is left as it is, and the writer started
 * all the same. Refused while a writer holds it, and when the note has no job. Its row is held while it's looked at, so a
 * writer claiming it meanwhile passes it by (`SKIP LOCKED`) and takes it once this is done. Due is by the writer's own rule
 * (claimableNotes): its lease is set a moment before now, so it's due in this transaction's time as in every later one.
 */
export async function retryNotes(d: Deps, ownerId: string, noteId: string): Promise<{ jobId: string; before: JobNow; after: JobNow }> {
  const r = await tx(d.pool, async (c) => {
    const held = await maybeOne(c, JobRow, `SELECT j.job_id, j.state, j.attempt, j.lease_until, ${claimableNotes('j')} AS claimable
      FROM content_jobs j JOIN revisions r ON r.owner_id = j.owner_id AND r.revision_id = j.revision_id
      WHERE j.owner_id = $1 AND j.kind = 'notes' AND r.item_id = $2 ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE OF j`, [ownerId, noteId]);
    if (!held) throw new ConflictError('Those notes aren’t waiting to be written; nothing was done.', { context: { noteId } });
    if (held.state === 'writing' && !held.claimable) throw new ConflictError('Notes are being written now.', { context: { noteId, jobId: held.job_id } });
    await exec(c, `UPDATE content_jobs j SET lease_until = now() - interval '1 millisecond'
      WHERE j.owner_id = $1 AND j.job_id = $2 AND j.state IN ('waiting', 'queued') AND NOT ${claimableNotes('j')}`, [ownerId, held.job_id]);
    const after = await maybeOne(c, JobRow, `SELECT j.job_id, j.state, j.attempt, j.lease_until, ${claimableNotes('j')} AS claimable FROM content_jobs j
      WHERE j.owner_id = $1 AND j.job_id = $2`, [ownerId, held.job_id]);
    return { jobId: held.job_id, before: jobNow(held), after: jobNow(after ?? held) };
  });
  kickWriter(d, ownerId);
  nlog.info('notes job made due by an operator', { noteId, jobId: r.jobId, before: r.before.state, after: r.after.state, attempt: r.after.attempt });
  return r;
}

/**
 * Makes a note's Drive exports that wait to be tried again (`pending`, with no lease) due now, and starts each exporter's
 * uploads: the organizer's, and those of people the note went to. Those that failed for good or need reconnecting are left to
 * the person's own Try again, which needs their consent. Says how many.
 */
export async function retryExports(d: Deps, ownerId: string, noteId: string): Promise<number> {
  const due = await rows(d.pool, z.object({ owner_id: z.string(), job_id: z.string() }), `UPDATE drive_export_jobs SET due_at = now()
    WHERE source_owner_id = $1 AND note_id = $2 AND state = 'pending' AND (lease_until IS NULL OR lease_until < now()) RETURNING owner_id, job_id`, [ownerId, noteId]);
  for (const exporter of new Set(due.map((x) => x.owner_id))) kickExports(d, exporter);
  nlog.info('Drive exports made due by an operator', { noteId, retried: due.length, jobIds: due.map((x) => x.job_id) });
  return due.length;
}
