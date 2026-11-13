/*
 * Recorded audio. Each recording has its own random Krec, stored only wrapped under the owner
 * wrap key. Pieces are sealed records in O01 under random object IDs; SQL holds only the object
 * ID, ciphertext digest and length, duration and codec (docs: Meetings › recording keys).
 */
import type { AudioSegment, RecordingProgress } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../context';
import { equalBytes, id128, openKey, openRecord, random, recordPlainBytes, sealKey, sealRecord, sha, type RecordHeader } from '../../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../../db';
import { errorMessage } from '@alcove/api';
import { InternalError, IntegrityError, NotFoundError, conflict } from '../../errors';
import { currentLogContext, log } from '../../log';
import { fromZero, soundStarts } from './stretchFile';

const alog = log.child({ component: 'audio' });

const scope = (recordingId: string) => `recording:${recordingId}`;
const header = (o: Owner, recordingId: string, segment: number, seq: number, objectId: string): RecordHeader =>
  ({ v: 1, kind: 'audio', ownerId: o.ownerId, recordingId, segment, seq, objectId, keyVersion: '1' });

/** A new recording for a note, started at `startedAt`: now, or a room recording's own start when it's uploaded later. */
export async function createRecording(o: Owner, db: Db, noteItemId: string, startedAt: Date): Promise<string> {
  const recordingId = id128();
  const krec = random(32);
  await exec(db, `INSERT INTO recordings (owner_id, recording_id, note_item_id, state, key_envelope, started_at, version)
                  VALUES ($1,$2,$3,'recording',$4,$5,0)`, [o.ownerId, recordingId, noteItemId, sealKey(o.wrapKey, o.ownerId, scope(recordingId), krec, '1'), startedAt]);
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
  return { krec: openKey(o.wrapKey, o.ownerId, scope(recordingId), r.key_envelope, '1'), state: r.state };
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

/** Objects queued at most this many at a time: upkeep comes back every few minutes for the rest. */
const QUEUE_BATCH = 500;
/** How many deletes go to the object store at once. */
const QUEUE_AT_ONCE = 25;
/**
 * Deletes what's queued in object_gc, the oldest first: everything, or for upkeep, or only these owners', straight after
 * the commit that queued it, so something deleted goes now rather than at the next run. What the store refuses stays
 * queued, with why. Returns how many went.
 */
export async function deleteQueued(d: Pick<Owner, 'pool' | 'objects'>, ownerIds?: string[] | undefined): Promise<number> {
  const due = await rows(d.pool, z.object({ object_id: z.string() }), `SELECT object_id FROM object_gc${ownerIds ? ' WHERE owner_id = ANY($2::text[])' : ''} ORDER BY queued_at LIMIT $1`, [QUEUE_BATCH, ...(ownerIds ? [ownerIds] : [])]);
  let deleted = 0;
  for (let i = 0; i < due.length; i += QUEUE_AT_ONCE) {
    await Promise.all(due.slice(i, i + QUEUE_AT_ONCE).map(async (g) => {
      try {
        await d.objects.delete(g.object_id);
        await exec(d.pool, 'DELETE FROM object_gc WHERE object_id = $1', [g.object_id]);
        deleted++;
      } catch (e) {
        alog.warn('object delete failed; it stays queued', { objectId: g.object_id, err: e });
        await exec(d.pool, 'UPDATE object_gc SET attempts = attempts + 1, last_error = $2 WHERE object_id = $1', [g.object_id, errorMessage(e).slice(0, 200)]);
      }
    }));
  }
  return deleted;
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

/**
 * A stretch of a recording, as whole pieces of it: what Hear it plays of a call that's still going. Its times count from
 * 0 at `startMs`, where its first piece starts in the segment.
 */
export interface Stretch { bytes: Uint8Array; mimeType: string; startMs: number; endMs: number }

const StretchPiece = z.object({ seq: z.number(), at_ms: z.coerce.number(), duration_ms: z.coerce.number(), object_id: z.string(), cipher_sha256: bytea, cipher_bytes: z.coerce.number(), mime_type: z.string() });
type StretchPiece = z.infer<typeof StretchPiece>;

/**
 * The pieces of one segment from `fromMs` to `toMs` (in the segment, pauses not counted) that `may` lets through, each
 * whole, in an unbroken run: a piece is never cut short, so what's heard is what was recorded, and one the listener may
 * not hear is never sent, nor anything after it. The run opens on its first piece's own sound (stretchFile.ts): a run
 * that doesn't start the segment leaves out the end of the piece before it, which its first piece starts with, and is
 * preceded by what the segment's first piece says the recording is, without any of its sound. It ends with the end of
 * its own last piece's sound, which the next piece starts with, once that's here. Its times then count from 0, so it
 * plays by itself, from where it starts, in any browser. `pending` when none of the segment's pieces reach the stretch
 * and none come after it: it may still be on its way, if the segment is still being recorded (the caller knows). Null when
 * none of it may be heard, or it can't be played from where it starts.
 */
export async function stretch(o: Owner, recordingId: string, segment: number, fromMs: number, toMs: number, may: (startMs: number, endMs: number) => boolean): Promise<Stretch | 'pending' | null> {
  const found = await rows(o.pool, StretchPiece, `SELECT seq, at_ms, duration_ms, object_id, cipher_sha256, cipher_bytes, mime_type FROM recording_pieces
    WHERE owner_id = $1 AND recording_id = $2 AND segment = $3 AND (seq = 0 OR (at_ms < $5 AND at_ms + duration_ms > $4)) ORDER BY seq`, [o.ownerId, recordingId, segment, fromMs, toMs]);
  const over = found.filter((p) => p.at_ms < toMs && p.at_ms + p.duration_ms > fromMs);
  if (!over.length) {
    // Pieces go up in order as they're recorded, so a stretch with none of its own and nothing after it is still to come.
    const later = await maybeOne(o.pool, z.object({ seq: z.number() }), 'SELECT seq FROM recording_pieces WHERE owner_id = $1 AND recording_id = $2 AND segment = $3 AND at_ms >= $4 LIMIT 1', [o.ownerId, recordingId, segment, toMs]);
    return later ? null : 'pending';
  }
  const run: StretchPiece[] = [];
  for (const p of over) {
    const last = run.at(-1);
    if (!may(p.at_ms, p.at_ms + p.duration_ms) || (last && p.seq !== last.seq + 1)) { if (run.length) break; continue; }
    run.push(p);
  }
  const head = run[0];
  const tail = run.at(-1);
  if (!head || !tail) return null;
  const cant = (why: string) => { alog.warn('a stretch of a recording can’t be played from where it starts', { recordingId, segment, seq: head.seq, why, mimeType: head.mime_type }); return null; };
  const { krec } = await krecOf(o, recordingId);
  const parts: Uint8Array[] = [];
  /** The end of the run's last block, from the next piece's first bytes. */
  let lastEnd: Uint8Array | null = null;
  try {
    const open = async (p: StretchPiece): Promise<Uint8Array> => {
      const location = header(o, recordingId, segment, p.seq, p.object_id);
      const ct = await o.objects.get(p.object_id);
      if (!equalBytes(sha(ct), p.cipher_sha256)) throw new IntegrityError('A piece of this recording failed its integrity check.', { context: { recordingId, segment, seq: p.seq, objectId: p.object_id } });
      return openRecord(krec, location, ct);
    };
    if (head.seq !== 0) {
      const first = found.find((p) => p.seq === 0);
      const opened = first ? await open(first) : null;
      const ends = opened ? soundStarts(opened, head.mime_type) : null;
      if (opened && ends) parts.push(opened.slice(0, ends));
      opened?.fill(0);
      if (!ends) return cant('no set-up');
    }
    const setUp = parts[0]?.length ?? 0;
    for (const p of run) {
      const plain = await open(p);
      const from = p === head && head.seq !== 0 ? soundStarts(plain, head.mime_type) : 0;
      if (from !== null) parts.push(from ? plain.slice(from) : plain);
      if (from) plain.fill(0);
      if (from === null) { plain.fill(0); return cant('no sound in its first piece'); }
    }
    // The run's last piece ends part way through a block: the rest of it, and of its Cluster or fragment, is what the next
    // piece starts with, up to that piece's own first Cluster or fragment. Once the next piece is here, that goes too, so a
    // line said in a piece's last half second keeps its end. It's sound from the last piece's own time, none of the next's.
    const next = await maybeOne(o.pool, StretchPiece, `SELECT seq, at_ms, duration_ms, object_id, cipher_sha256, cipher_bytes, mime_type FROM recording_pieces
      WHERE owner_id = $1 AND recording_id = $2 AND segment = $3 AND seq = $4`, [o.ownerId, recordingId, segment, tail.seq + 1]);
    if (next && next.mime_type === head.mime_type) {
      const plain = await open(next);
      const own = soundStarts(plain, next.mime_type);
      if (own) lastEnd = plain.slice(0, own);
      plain.fill(0);
    }
    const join = (xs: Uint8Array[]): Uint8Array => {
      const b = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
      let at = 0;
      for (const x of xs) { b.set(x, at); at += x.length; }
      return b;
    };
    const fromItsStart = (b: Uint8Array): Uint8Array | null => {
      const sound = head.seq === 0 ? soundStarts(b, head.mime_type) : setUp;
      return sound === null ? null : fromZero(b, sound, head.mime_type);
    };
    let bytes = join(lastEnd ? [...parts, lastEnd] : parts);
    let playable = fromItsStart(bytes);
    // What the next piece starts with that doesn't read as the end of this one is left out, rather than the whole stretch.
    if (!playable && lastEnd) { bytes.fill(0); bytes = join(parts); playable = fromItsStart(bytes); }
    // The segment's own start plays as it was recorded, from 0, even where it can't be read through.
    if (!playable && head.seq !== 0) { bytes.fill(0); return cant('not laid out as a recording is'); }
    return { bytes: playable ?? bytes, mimeType: head.mime_type, startMs: head.at_ms, endMs: tail.at_ms + tail.duration_ms };
  } finally {
    for (const x of parts) x.fill(0);
    lastEnd?.fill(0);
    krec.fill(0);
  }
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
