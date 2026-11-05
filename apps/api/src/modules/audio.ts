/*
 * Recorded audio. Each recording has its own random Krec, stored only wrapped under the owner
 * wrap key. Pieces are sealed records in O01 under random object IDs; SQL holds only the object
 * ID, ciphertext digest and length, duration and codec (docs: Meetings › recording keys).
 */
import type { AudioSegment, RecordingProgress } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { equalBytes, id128, openKey, openRecord, random, recordPlainBytes, sealKey, sealRecord, sha, type RecordHeader } from '../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../db';
import { errorMessage } from '@alcove/api';
import { InternalError, IntegrityError, NotFoundError, conflict } from '../errors';
import { currentLogContext, log } from '../log';

const alog = log.child({ component: 'audio' });

const scope = (recordingId: string) => `recording:${recordingId}`;
const header = (o: Owner, recordingId: string, segment: number, seq: number, objectId: string): RecordHeader =>
  ({ v: 1, kind: 'audio', ownerId: o.ownerId, recordingId, segment, seq, objectId, keyVersion: '1' });

/** A new recording for a note, started at `startedAt`: now, or a room recording's own start when it's uploaded later. */
export async function createRecording(o: Owner, db: Db, noteItemId: string, startedAt: Date): Promise<string> {
  const recordingId = id128();
  const krec = random(32);
  await exec(db, `INSERT INTO recordings (owner_id, recording_id, note_item_id, state, key_envelope, started_at, version)
                  VALUES ($1,$2,$3,'recording',$4,$5,0)`, [o.ownerId, recordingId, noteItemId, sealKey(o.wrapKey, o.ownerId, scope(recordingId), krec), startedAt]);
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

/** A piece from the browser: its place in the recording, where it starts in its segment (pauses not counted), and its bytes. */
export interface Piece { segment: number; seq: number; atMs: number; durationMs: number; mimeType: string; bytes: Uint8Array }

/**
 * Whether this piece is stored already. Its place (segment, seq) holds only the piece that starts
 * where it does and lasts as long: a different piece sent to it is refused, never dropped as if it
 * were stored.
 */
async function stored(o: Owner, recordingId: string, p: Piece): Promise<boolean> {
  const there = await maybeOne(o.pool, z.object({ at_ms: z.number(), duration_ms: z.number() }),
    'SELECT at_ms, duration_ms FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2 AND segment = $3 AND seq = $4', [o.ownerId, recordingId, p.segment, p.seq]);
  if (!there) return false;
  if (there.at_ms !== p.atMs || there.duration_ms !== p.durationMs) {
    throw conflict('A different piece of audio is already stored at that place in the recording.', {
      recordingId, segment: p.segment, seq: p.seq, atMs: p.atMs, storedAtMs: there.at_ms, durationMs: p.durationMs, storedDurationMs: there.duration_ms
    });
  }
  return true;
}

/**
 * Encrypts, stores and verifies one piece. Sending a piece that's stored already is a no-op, even
 * once the recording has paused or stopped, so retries and resumed uploads are safe. A piece is
 * recorded holding the recording's row, which stopping changes: it either lands before the recording
 * stops, where whatever stopping does to its pieces reaches it, or is refused and its object deleted.
 */
export async function appendPiece(o: Owner, recordingId: string, p: Piece): Promise<void> {
  const where = { recordingId, segment: p.segment, seq: p.seq, atMs: p.atMs };
  if (await stored(o, recordingId, p)) { alog.debug('audio piece already stored', where); return; }
  const { krec, state } = await krecOf(o, recordingId);
  if (state !== 'recording') { krec.fill(0); throw conflict(state === 'paused' ? 'Recording is paused.' : 'This recording has already stopped.', { ...where, state }); }
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
  let outcome: 'stored' | 'raced' | 'stopped' | 'gone';
  try {
    outcome = await tx(o.pool, async (c) => {
      const now = await maybeOne(c, z.object({ state: z.string() }), 'SELECT state FROM recordings WHERE owner_id = $1 AND recording_id = $2 FOR SHARE', [o.ownerId, recordingId]);
      if (!now) return 'gone';
      if (now.state === 'stopped') return 'stopped';
      const inserted = await exec(c, `INSERT INTO recording_pieces (owner_id, recording_id, segment, seq, at_ms, object_id, cipher_sha256, cipher_bytes, duration_ms, mime_type)
                                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, [o.ownerId, recordingId, p.segment, p.seq, p.atMs, objectId, digest, ct.length, p.durationMs, p.mimeType]);
      if (inserted !== 1) return 'raced';
      await exec(c, 'UPDATE owners SET stored_bytes = stored_bytes + $2, version = version + 1 WHERE owner_id = $1', [o.ownerId, ct.length]);
      return 'stored';
    });
  } catch (e) {
    alog.warn('audio piece not recorded; deleting its object', { ...where, objectId, err: e });
    await queueDelete(o, [objectId]);
    throw e;
  }
  if (outcome === 'stored') { alog.debug('audio piece stored', { ...where, bytes: ct.length, durationMs: p.durationMs }); return; }
  await queueDelete(o, [objectId]);
  if (outcome === 'stopped') throw conflict('This recording has already stopped.', { ...where, state: outcome });
  // Another request stored this place first. Ours is a copy of that piece, unless it's a different one.
  if (outcome === 'raced' && await stored(o, recordingId, p)) alog.info('audio piece raced a retry; dropping the duplicate', where);
  else alog.info('audio piece raced its recording being deleted; dropping it', where);
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

/**
 * Deletes a recording's audio pieces, in the caller's transaction, for a call set not to keep its recording: stored
 * bytes go down to match, and the recording's row stays, since its key seals the call's shared-screen frames. Returns
 * the pieces' objects, for the caller to delete once the transaction commits (queueDelete).
 */
export async function purgeAudio(o: Owner, db: Db, recordingId: string): Promise<string[]> {
  const gone = await rows(db, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }),
    'DELETE FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2 RETURNING object_id, cipher_bytes', [o.ownerId, recordingId]);
  if (!gone.length) return [];
  await exec(db, 'UPDATE owners SET stored_bytes = greatest(0, stored_bytes - $2), version = version + 1 WHERE owner_id = $1', [o.ownerId, gone.reduce((n, p) => n + p.cipher_bytes, 0)]);
  alog.info('recording deleted, as the call was set to', { recordingId, pieces: gone.length });
  return gone.map((p) => p.object_id);
}

const Seg = z.object({ segment: z.number(), pieces: z.coerce.number(), ms: z.coerce.number(), mime_type: z.string() });
/** `db`: a transaction reads on its own connection. */
export async function segments(o: Owner, recordingId: string, db: Db = o.pool): Promise<AudioSegment[]> {
  return (await rows(db, Seg, `SELECT segment, count(*) AS pieces, coalesce(sum(duration_ms),0) AS ms, min(mime_type) AS mime_type
                               FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2 GROUP BY segment ORDER BY segment`, [o.ownerId, recordingId]))
    .map((s) => ({ index: s.segment, pieces: s.pieces, seconds: Math.round(s.ms / 1000), mimeType: s.mime_type }));
}
export async function progress(o: Owner, recordingId: string | null, segment: number): Promise<RecordingProgress> {
  if (!recordingId) return { segment, pieces: 0, seconds: 0 };
  const segs = await segments(o, recordingId);
  return { segment, pieces: segs.reduce((n, s) => n + s.pieces, 0), seconds: segs.reduce((n, s) => n + s.seconds, 0) };
}

/**
 * Pieces read ahead of the one being sent. A recording is hundreds of small objects, so what a long one costs is the
 * store's round trip for each. Eight keeps that out of the way and keeps what a listener who stops has cost small; the
 * bytes keep a recording of the largest pieces the API takes from holding much more than it would otherwise.
 */
const READ_AHEAD = 8;
const READ_AHEAD_BYTES = 2 * 1024 * 1024;

/** Opens `pieces` in order, as far ahead as is allowed and always the next one. Stopping waits for what's under way. */
async function* ahead<P extends { size: number }>(pieces: P[], open: (p: P) => Promise<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reading: { size: number; opened: Promise<Uint8Array> }[] = [];
  let next = 0;
  let held = 0;
  try {
    for (;;) {
      for (let p = pieces[next]; p && reading.length < READ_AHEAD && (!reading.length || held + p.size <= READ_AHEAD_BYTES); p = pieces[next]) {
        const opened = open(p);
        // Failing is for whoever reaches it: someone who stopped reading before it never will.
        opened.catch(() => undefined);
        reading.push({ size: p.size, opened });
        held += p.size;
        next++;
      }
      const first = reading.shift();
      if (!first) return;
      const plain = await first.opened;
      held -= first.size;
      yield plain;
    }
  } finally {
    await Promise.allSettled(reading.map((r) => r.opened));
  }
}

/** One segment, as far as it's asked for, as a file: how long it is, and any stretch of it. */
export interface AudioFile {
  bytes: number;
  /** Decrypts from byte `from` to byte `to`, both included, in order. */
  read(from: number, to: number): AsyncGenerator<Uint8Array>;
}

const SegmentPiece = z.object({ seq: z.number(), object_id: z.string(), cipher_sha256: bytea, cipher_bytes: z.coerce.number() });
/**
 * The first `count` pieces of a segment as a file. MediaRecorder pieces concatenate into one playable file, and how long
 * each is follows from how long it's stored. A recording still going keeps growing, so what's asked for by a number of
 * pieces stays the same file, however often it's asked for again.
 */
export async function file(o: Owner, recordingId: string, segment: number, count: number): Promise<AudioFile> {
  const stored = await rows(o.pool, SegmentPiece,
    'SELECT seq, object_id, cipher_sha256, cipher_bytes FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2 AND segment = $3 ORDER BY seq LIMIT $4', [o.ownerId, recordingId, segment, count]);
  if (!stored.length) throw new NotFoundError('No audio in that part of the recording.');
  let bytes = 0;
  const pieces = stored.map((p) => {
    const start = bytes;
    const location = header(o, recordingId, segment, p.seq, p.object_id);
    const size = recordPlainBytes(location, p.cipher_bytes);
    bytes += size;
    return { ...p, location, start, size };
  });
  return {
    bytes,
    async *read(from, to) {
      const { krec } = await krecOf(o, recordingId);
      try {
        yield* ahead(pieces.filter((p) => p.start + p.size > from && p.start <= to), async (p) => {
          const ct = await o.objects.get(p.object_id);
          if (!equalBytes(sha(ct), p.cipher_sha256)) throw new IntegrityError('A piece of this recording failed its integrity check.', { context: { recordingId, segment, seq: p.seq, objectId: p.object_id } });
          const plain = openRecord(krec, p.location, ct);
          if (plain.length !== p.size) throw new IntegrityError('A piece of this recording isn’t the length it was stored at.', { context: { recordingId, segment, seq: p.seq, objectId: p.object_id } });
          return plain.subarray(Math.max(0, from - p.start), to + 1 - p.start);
        });
      } finally {
        krec.fill(0);
      }
    }
  };
}

/** Longer than node-server spends on a reply's first chunks, which it reads before writing anything. */
const AFTER_THE_FIRST_READS_MS = 5;

/**
 * A response body from what `chunks` gives, read only as fast as it's taken. The first chunk comes before anything is
 * sent, so a stretch that can't be read is an ordinary error. A failure after that breaks the connection, so nothing can
 * take a short file for a whole one: it waits for the reply to have started, because node-server takes a failure in its
 * first reads for the end of the reply. `gone` says the listener left, which is what wipes the key if they left before
 * the reply began, and is no failure of ours.
 */
export async function body(chunks: AsyncGenerator<Uint8Array>, gone: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const first = await chunks.next();
  // What's read later isn't read inside the request, so its failure has to bring the request's ID along.
  const blog = alog.child(currentLogContext());
  const stop = () => void chunks.return(undefined);
  if (gone.aborted) stop(); else gone.addEventListener('abort', stop, { once: true });
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(out) { if (first.done) out.close(); else out.enqueue(first.value); },
    async pull(out) {
      try {
        const next = await chunks.next();
        if (cancelled) return;
        if (next.done) out.close(); else out.enqueue(next.value);
      } catch (e) {
        if (cancelled || gone.aborted) {
          blog.debug('a read failed after the listener left', { err: e });
          if (!cancelled) out.close();
          return;
        }
        blog.error('audio stopped partway through', { err: e });
        await new Promise((r) => setTimeout(r, AFTER_THE_FIRST_READS_MS));
        out.error(e);
      }
    },
    cancel() { cancelled = true; stop(); }
  }, { highWaterMark: 0 });
}

/** Objects and stored bytes of a note's recording, for deleting the note. */
export async function noteObjects(o: Owner, db: Db, noteItemId: string): Promise<{ ids: string[]; bytes: number }> {
  const objs = await rows(db, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }),
    `SELECT p.object_id, p.cipher_bytes FROM recording_pieces p JOIN recordings r ON r.owner_id = p.owner_id AND r.recording_id = p.recording_id
     WHERE r.owner_id = $1 AND r.note_item_id = $2`, [o.ownerId, noteItemId]);
  return { ids: objs.map((x) => x.object_id), bytes: objs.reduce((n, x) => n + x.cipher_bytes, 0) };
}
