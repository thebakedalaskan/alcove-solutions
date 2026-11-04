/*
 * Recorded audio. Each recording has its own random Krec, stored only wrapped under the owner
 * wrap key. Pieces are sealed records in O01 under random object IDs; SQL holds only the object
 * ID, ciphertext digest and length, duration and codec (docs: Meetings › recording keys).
 */
import type { AudioSegment, RecordingProgress } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { equalBytes, id128, openKey, openRecord, random, sealKey, sealRecord, sha, type RecordHeader } from '../crypto';
import { bytea, exec, maybeOne, rows, type Db } from '../db';
import { errorMessage } from '@alcove/api';
import { InternalError, IntegrityError, NotFoundError, conflict } from '../errors';
import { log } from '../log';

const alog = log.child({ component: 'audio' });

const scope = (recordingId: string) => `recording:${recordingId}`;
const header = (o: Owner, recordingId: string, segment: number, seq: number, objectId: string): RecordHeader =>
  ({ v: 1, kind: 'audio', ownerId: o.ownerId, recordingId, segment, seq, objectId, keyVersion: '1' });

export async function createRecording(o: Owner, db: Db, noteItemId: string): Promise<string> {
  const recordingId = id128();
  const krec = random(32);
  await exec(db, `INSERT INTO recordings (owner_id, recording_id, note_item_id, state, key_envelope, started_at, version)
                  VALUES ($1,$2,$3,'recording',$4,now(),0)`, [o.ownerId, recordingId, noteItemId, sealKey(o.wrapKey, o.ownerId, scope(recordingId), krec)]);
  krec.fill(0);
  return recordingId;
}
export async function setRecordingState(o: Owner, db: Db, recordingId: string, state: 'recording' | 'paused' | 'stopped'): Promise<void> {
  await exec(db, `UPDATE recordings SET state = $3, version = version + 1, ended_at = CASE WHEN $3 = 'stopped' THEN now() ELSE ended_at END
                  WHERE owner_id = $1 AND recording_id = $2`, [o.ownerId, recordingId, state]);
}

const RecRow = z.object({ key_envelope: bytea, state: z.string() });
/** A recording's key (wipe it after use) and its state. Audio pieces and shared-screen frames are sealed under it. */
export async function krecOf(o: Owner, recordingId: string): Promise<{ krec: Uint8Array; state: string }> {
  const r = await maybeOne(o.pool, RecRow, 'SELECT key_envelope, state FROM recordings WHERE owner_id = $1 AND recording_id = $2', [o.ownerId, recordingId]);
  if (!r) throw new NotFoundError('That recording doesn’t exist.');
  return { krec: openKey(o.wrapKey, o.ownerId, scope(recordingId), r.key_envelope), state: r.state };
}

export interface Piece { segment: number; seq: number; durationMs: number; mimeType: string; bytes: Uint8Array }

/** Encrypts, stores and verifies one piece. Re-sending the same slot is a no-op, so retries are safe. */
export async function appendPiece(o: Owner, recordingId: string, p: Piece): Promise<void> {
  const { krec, state } = await krecOf(o, recordingId);
  if (state !== 'recording') { krec.fill(0); throw conflict(state === 'paused' ? 'Recording is paused.' : 'This recording has already stopped.', { recordingId, state, segment: p.segment, seq: p.seq }); }
  const exists = await maybeOne(o.pool, z.object({ seq: z.number() }), 'SELECT seq FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2 AND segment = $3 AND seq = $4', [o.ownerId, recordingId, p.segment, p.seq]);
  if (exists) { krec.fill(0); alog.debug('audio piece already stored', { recordingId, segment: p.segment, seq: p.seq }); return; }
  const objectId = id128();
  const ct = sealRecord(krec, header(o, recordingId, p.segment, p.seq, objectId), p.bytes);
  krec.fill(0);
  await o.objects.put(objectId, ct);
  const back = await o.objects.get(objectId);
  const digest = sha(ct);
  if (back.length !== ct.length || !equalBytes(sha(back), digest)) {
    await queueDelete(o, [objectId]);
    throw new InternalError('The encrypted audio didn’t store correctly. It will be retried.', { context: { recordingId, objectId, segment: p.segment, seq: p.seq, wrote: ct.length, readBack: back.length } });
  }
  try {
    const inserted = await exec(o.pool, `INSERT INTO recording_pieces (owner_id, recording_id, segment, seq, object_id, cipher_sha256, cipher_bytes, duration_ms, mime_type)
                                          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, [o.ownerId, recordingId, p.segment, p.seq, objectId, digest, ct.length, p.durationMs, p.mimeType]);
    if (inserted === 1) {
      await exec(o.pool, 'UPDATE owners SET stored_bytes = stored_bytes + $2, version = version + 1 WHERE owner_id = $1', [o.ownerId, ct.length]);
      alog.debug('audio piece stored', { recordingId, segment: p.segment, seq: p.seq, bytes: ct.length, durationMs: p.durationMs });
    } else {
      alog.info('audio piece raced a retry; dropping the duplicate', { recordingId, segment: p.segment, seq: p.seq });
      await queueDelete(o, [objectId]);
    }
  } catch (e) {
    alog.warn('audio piece not recorded; deleting its object', { recordingId, objectId, segment: p.segment, seq: p.seq, err: e });
    await queueDelete(o, [objectId]);
    throw e;
  }
}

/** Deletes objects now; anything that fails is queued for the maintenance loop to retry. */
export async function queueDelete(o: Pick<Owner, 'pool' | 'objects' | 'ownerId'>, objectIds: string[]): Promise<void> {
  await Promise.all(objectIds.map(async (id) => {
    try { await o.objects.delete(id); } catch (e) {
      alog.warn('object delete failed; queued for retry', { objectId: id, err: e });
      await exec(o.pool, 'INSERT INTO object_gc (object_id, owner_id, last_error) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, o.ownerId, errorMessage(e).slice(0, 200)]);
    }
  }));
}

const Seg = z.object({ segment: z.number(), pieces: z.coerce.number(), ms: z.coerce.number(), mime_type: z.string() });
export async function segments(o: Owner, recordingId: string): Promise<AudioSegment[]> {
  return (await rows(o.pool, Seg, `SELECT segment, count(*) AS pieces, coalesce(sum(duration_ms),0) AS ms, min(mime_type) AS mime_type
                                   FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2 GROUP BY segment ORDER BY segment`, [o.ownerId, recordingId]))
    .map((s) => ({ index: s.segment, pieces: s.pieces, seconds: Math.round(s.ms / 1000), mimeType: s.mime_type }));
}
export async function progress(o: Owner, recordingId: string | null, segment: number): Promise<RecordingProgress> {
  if (!recordingId) return { segment, pieces: 0, seconds: 0 };
  const segs = await segments(o, recordingId);
  return { segment, pieces: segs.reduce((n, s) => n + s.pieces, 0), seconds: segs.reduce((n, s) => n + s.seconds, 0) };
}

/** Decrypts one segment's pieces in order. MediaRecorder pieces concatenate into one playable file. */
export async function* stream(o: Owner, recordingId: string, segment: number): AsyncGenerator<Uint8Array> {
  const pieces = await rows(o.pool, z.object({ seq: z.number(), object_id: z.string(), cipher_sha256: bytea }),
    'SELECT seq, object_id, cipher_sha256 FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2 AND segment = $3 ORDER BY seq', [o.ownerId, recordingId, segment]);
  if (!pieces.length) throw new NotFoundError('No audio in that part of the recording.');
  const { krec } = await krecOf(o, recordingId);
  try {
    for (const p of pieces) {
      const ct = await o.objects.get(p.object_id);
      if (!equalBytes(sha(ct), p.cipher_sha256)) throw new IntegrityError('A piece of this recording failed its integrity check.', { context: { recordingId, segment, seq: p.seq, objectId: p.object_id } });
      yield openRecord(krec, header(o, recordingId, segment, p.seq, p.object_id), ct);
    }
  } finally {
    krec.fill(0);
  }
}

/** Objects and stored bytes belonging to a recording, for deletion. */
export async function recordingObjects(o: Owner, db: Db, recordingId: string): Promise<{ ids: string[]; bytes: number }> {
  const objs = await rows(db, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }), 'SELECT object_id, cipher_bytes FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2', [o.ownerId, recordingId]);
  return { ids: objs.map((x) => x.object_id), bytes: objs.reduce((n, x) => n + x.cipher_bytes, 0) };
}
