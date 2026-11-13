/*
 * Shared screens in a call's notes (docs: Calls and recordings › Shared screens). Call media is end-to-end encrypted,
 * so only browsers see a share. When notes are on, a presenter says whether each share goes in the notes; while one
 * that does is going (and notes aren't paused), the presenter's own browser records it and sends the video in pieces.
 *
 *  - Shares (`screen_shares`): every share started while the call's recording exists, whether it's kept, and when it
 *    started and ended; whose it was is sealed.
 *  - Pieces (`screen_pieces`): each sealed under the recording's key as an object under a random name, like audio.
 *  - Video (`screen_videos`): once the call is over, finishVideo joins each kept share's pieces in each segment into
 *    one video a browser can seek (ffmpeg, pipes only), sealed in 4 MiB chunks so replay opens only what a range
 *    needs, and deletes the pieces. A share whose pieces can't be joined (not video, or failing its integrity check) is
 *    left out of replay and its pieces deleted. A call set not to keep its recording keeps no video either: it stays
 *    only until the notes are written, since the frames are taken from it (purgeVideo).
 *  - Frames (`screen_frames`): JPEGs taken from the video at moments picked from what was said (and the moment a few
 *    seconds before a change, to compare with), each read and judged by the vision model. The note shows the key ones,
 *    at most one to a transcript line; the rest are deleted once the notes are saved. Notes written before video was kept
 *    have theirs from the presenter's browser, read the same way.
 *
 * Deleting the note deletes all of it, objects included.
 */
import { InferenceEvidenceSchema, ScreenLegibleSchema, ScreenRegionSchema, ScreenRelevanceSchema, SpeakerSchema, type InferenceEvidence, type ScreenMoment, type ScreenRelevance, type ScreenShare, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, equalBytes, id128, mac, openJson, openRecord, random, sealJson, sealRecord, sha, stateKey, toJson, utf8, type RecordHeader } from '../../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../../db';
import { IntegrityError, InternalError, MediaError, PlanLimitError, UnansweredError, UnverifiedError, ValidationError, conflict, notFound } from '../../errors';
import { frames as takeFrames, remux, videoType, type TakenFrame, type Video, type VideoSink, type VideoType } from './ffmpeg';
import type { ChatModel, Meter } from '../../inference';
import { log } from '../../log';
import { openOwner } from '../../owners';
import { krecOf, queueDelete, segments } from './audio';
import { PICK_WHY, pickMoments, readScreen, selectFrames, type FramePick, type PickWhy, type ScreenContext } from '../notes/drafting';
import { GRID_BYTES } from './screenGrid';

const slog = log.child({ component: 'screens' });

/** How many frames the notes model reads at once while the notes are written. */
const READ_AT_ONCE = 4;
/** How long to wait before fetching a frame's image a second time. */
const FETCH_AGAIN_MS = 2_000;

/**
 * What the notes model read on a frame: how legible it was, its title, the text on it, what it shows beyond its words,
 * what changed on it since the frame before a change (when it was compared with one), and the parts worth pointing at.
 */
export const Reading = z.object({
  legible: ScreenLegibleSchema, title: z.string(), text: z.string(), shows: z.string().default(''), changed: z.string().default(''), regions: z.array(ScreenRegionSchema)
});
export type Reading = z.infer<typeof Reading>;
const UNREAD: Reading = { legible: 'unread', title: '', text: '', shows: '', changed: '', regions: [] };
/** Why a frame was picked. Frames kept while stretches nothing pointed at were filled in ('fill') read as a share's start. */
const PickWhySchema = z.preprocess((v) => (v === 'fill' ? 'start' : v), z.enum(PICK_WHY));
/**
 * A frame's sealed row: whose share (`presenter`, a participant ID, empty for frames taken from video; `share`, the
 * share's ID), when it was taken and the recording's segment then, its size, and what the vision model read on it, once
 * it has. `at` is seconds since the call started for frames a presenter's browser sent (notes written before video was
 * kept, `pick` null), and seconds into the recording (to a tenth) for frames taken from a kept share's video
 * (keepFrame), with why that moment was picked and the words that picked it (`cue`). `relevance` is how much it matters
 * to what was said, and `model` the vision model that read it, so notes written again with another one read it again.
 * `grid` is the frame on the grey grid (screenGrid.ts, base64), for telling whether the screen changed. Rows written
 * before any of these were kept take the defaults.
 */
const Info = z.object({
  presenter: z.string(), share: z.string(), at: z.number(), segment: z.number(), width: z.number(), height: z.number(), reading: Reading.nullable(),
  relevance: ScreenRelevanceSchema.nullable().default(null), cue: z.string().default(''), pick: PickWhySchema.nullable().default(null), model: z.string().nullable().default(null),
  grid: z.string().nullable().default(null)
});
type Info = z.infer<typeof Info>;
/** One frame of a note, opened. */
export type Frame = Info & { id: string };
const infoOf = (f: Frame): Info => ({
  presenter: f.presenter, share: f.share, at: f.at, segment: f.segment, width: f.width, height: f.height, reading: f.reading, relevance: f.relevance, cue: f.cue, pick: f.pick, model: f.model,
  grid: f.grid
});
const gridText = (grid: Uint8Array | null) => (grid && grid.length === GRID_BYTES ? Buffer.from(grid).toString('base64') : null);
/** Each frame's grey grid by its ID, for the frames that have one. */
export function gridsOf(frames: Frame[]): Map<string, Uint8Array> {
  return new Map(frames.flatMap((f) => {
    const g = f.grid === null ? null : Uint8Array.from(Buffer.from(f.grid, 'base64'));
    return g && g.length === GRID_BYTES ? [[f.id, g]] : [];
  }));
}
const sealInfo = (o: Owner, noteId: string, f: Frame) => exec(o.pool, 'UPDATE screen_frames SET info_ciphertext = $4 WHERE owner_id = $1 AND note_item_id = $2 AND frame_id = $3',
  [o.ownerId, noteId, f.id, sealJson(infoKey(o, noteId), infoHeader(o, noteId, f.id), toJson(infoOf(f)))]);

const infoKey = (o: Owner, noteId: string) => stateKey(o.root, o.ownerId, `screen:${noteId}`);
const infoHeader = (o: Owner, noteId: string, frameId: string): RecordHeader => ({ v: 1, kind: 'screen-frame-info', ownerId: o.ownerId, noteId, frameId });
const imageHeader = (o: Owner, recordingId: string, frameId: string, objectId: string): RecordHeader =>
  ({ v: 1, kind: 'screen-frame', ownerId: o.ownerId, recordingId, frameId, objectId, keyVersion: '1' });
/** The same frame of the same share is the same tag, so a retry is kept once. */
const tagOf = (o: Owner, noteId: string, share: string, jpeg: Uint8Array) => mac(infoKey(o, noteId), utf8(`frame:${share}:${b64u(sha(jpeg))}`));

/**
 * A JPEG's size, read from its frame header, or null if it isn't a JPEG. Nothing else of the image is read here:
 * only the notes model, in its attested VM, ever decodes it.
 */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    // Fill bytes, and markers that stand alone.
    if (marker === 0xff) { i++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (length < 2) return null;
    // Start of frame (baseline, progressive and the rest, never DHT, JPG or DAC): its height and width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= b.length) return null;
      const height = ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0);
      const width = ((b[i + 7] ?? 0) << 8) | (b[i + 8] ?? 0);
      return width && height ? { width, height } : null;
    }
    // The image data starts before any frame header: not a JPEG we can place.
    if (marker === 0xda) return null;
    i += 2 + length;
  }
  return null;
}

const Row = z.object({ frame_id: z.string(), info_ciphertext: bytea });

/**
 * Every frame of a note, oldest first, opened. This is also where catch-up during a call can find what has been
 * shown so far (each frame's ID, presenter, share and time), to point at it once it reads screens.
 */
export async function framesOf(o: Owner, db: Db, noteId: string): Promise<Frame[]> {
  const found = await rows(db, Row, 'SELECT frame_id, info_ciphertext FROM screen_frames WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
  const k = infoKey(o, noteId);
  return found.map((r) => ({ id: r.frame_id, ...openJson(k, infoHeader(o, noteId, r.frame_id), r.info_ciphertext, Info) })).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** One frame's image, decrypted and checked, for someone the note's access check let through. */
export async function image(o: Owner, noteId: string, recordingId: string, frameId: string): Promise<Uint8Array> {
  const r = await maybeOne(o.pool, z.object({ object_id: z.string(), cipher_sha256: bytea }),
    'SELECT object_id, cipher_sha256 FROM screen_frames WHERE owner_id = $1 AND note_item_id = $2 AND frame_id = $3', [o.ownerId, noteId, frameId]);
  if (!r) throw notFound('That frame', { noteId });
  const ct = await o.objects.get(r.object_id);
  if (!equalBytes(sha(ct), r.cipher_sha256)) throw new IntegrityError('A shared-screen frame failed its integrity check.', { context: { noteId, frameId, objectId: r.object_id } });
  const { krec } = await krecOf(o, recordingId);
  try {
    return openRecord(krec, imageHeader(o, recordingId, frameId, r.object_id), ct);
  } finally {
    krec.fill(0);
  }
}

/** A note's frame objects and their stored bytes, for deleting the note. */
export async function frameObjects(o: Owner, db: Db, noteId: string): Promise<{ ids: string[]; bytes: number }> {
  const objs = await rows(db, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }), 'SELECT object_id, cipher_bytes FROM screen_frames WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
  return { ids: objs.map((x) => x.object_id), bytes: objs.reduce((n, x) => n + x.cipher_bytes, 0) };
}

/**
 * Notes written before frames were picked from video: has the notes model read every frame the presenter's browser sent
 * that it hasn't read yet, a few at a time, and keeps each reading in the frame's row as soon as it's made, so a job tried
 * again carries on where it was. A frame whose reply can't be used, twice, is kept as unread rather than guessed at.
 * When the model's evidence doesn't check out, or it doesn't answer, that's thrown: the notes wait. Returns every frame
 * with what was read on it.
 */
export async function readAll(o: Owner, meter: Meter, noteId: string, recordingId: string): Promise<Frame[]> {
  const frames = await framesOf(o, o.pool, noteId);
  const todo = frames.filter((f) => !f.reading);
  const t0 = performance.now();
  for (let i = 0; i < todo.length; i += READ_AT_ONCE) {
    await Promise.all(todo.slice(i, i + READ_AT_ONCE).map(async (f) => {
      const r = await readOne(o, meter, noteId, recordingId, f, undefined, undefined);
      f.reading = r.reading;
      await sealInfo(o, noteId, f);
    }));
  }
  if (todo.length) {
    const by = (l: Reading['legible']) => todo.filter((f) => f.reading?.legible === l).length;
    slog.info('shared screens read', { noteId, frames: frames.length, read: todo.length, clear: by('clear'), partly: by('partly'), unreadable: by('unreadable'), unread: by('unread'), ms: Math.round(performance.now() - t0) });
  }
  return frames;
}
/**
 * One frame read, with how much it matters and the verification it went to (none when it couldn't be read). A frame that
 * couldn't be read is kept as unread and supporting: only a frame the model judged unrelated is left out.
 */
async function readOne(o: Owner, meter: Meter, noteId: string, recordingId: string, f: Frame, context: ScreenContext | undefined, via: ChatModel | undefined, beforeId?: string | undefined): Promise<{ reading: Reading; relevance: ScreenRelevance; evidence: InferenceEvidence | null }> {
  const unread = { reading: UNREAD, relevance: 'supporting' as const, evidence: null };
  // One image never costs the notes: a frame that won't open, or that still can't be fetched on a second try (the
  // object store failing, or its object gone), is kept as unread and the notes carry on without it.
  let jpeg: Uint8Array | null = null;
  for (let tries = 1; !jpeg; tries++) {
    try {
      jpeg = await image(o, noteId, recordingId, f.id);
    } catch (e) {
      if (e instanceof IntegrityError) { slog.error('a frame failed its integrity check; kept as unread', { noteId, frameId: f.id, err: e }); return unread; }
      if (tries >= 2) { slog.warn('a frame’s image couldn’t be fetched; kept as unread', { noteId, frameId: f.id, err: e }); return unread; }
      await new Promise((r) => setTimeout(r, FETCH_AGAIN_MS));
    }
  }
  // The screen before a change is only to compare with: without it, the frame is read alone.
  let before: Uint8Array | undefined;
  if (beforeId) {
    try {
      before = await image(o, noteId, recordingId, beforeId);
    } catch (e) {
      slog.warn('the frame before a change couldn’t be fetched; the frame is read alone', { noteId, frameId: f.id, beforeId, err: e });
    }
  }
  for (let tries = 1; ; tries++) {
    try {
      return await readScreen(o.cfg, meter, jpeg, { context, via, before });
    } catch (e) {
      if (e instanceof UnverifiedError || e instanceof UnansweredError || e instanceof PlanLimitError) throw e;
      if (tries >= 2) { slog.warn('a frame couldn’t be read; kept as unread', { noteId, frameId: f.id, model: via?.model ?? o.cfg.NEAR_AI_NOTES_MODEL, err: e }); return unread; }
    }
  }
}

/** A note's screen moments with what the notes model has read on each frame since. */
export function withReadings(shown: ScreenMoment[], frames: Frame[]): ScreenMoment[] {
  const read = new Map(frames.map((f) => [f.id, f.reading]));
  return shown.map((m) => {
    const r = read.get(m.id);
    return r ? { ...m, legible: r.legible, title: r.title, text: r.text, shows: r.shows, changed: r.changed, regions: r.regions } : m;
  });
}

/**
 * Keeps one JPEG taken from a kept share's video as a frame of the note (for the analysis that picks and reads them):
 * the image sealed under the recording's key as an object, read back and checked, then its sealed row, with the frame
 * on the grey grid. `at` is seconds into the recording. The same image of the same share again is kept once, and
 * answers with the ID it has.
 */
export async function keepFrame(o: Owner, noteId: string, recordingId: string, f: { share: string; presenter: string; at: number; segment: number; jpeg: Uint8Array; grid: Uint8Array | null; cue: string; pick: FramePick['why'] }): Promise<{ id: string; duplicate: boolean }> {
  const size = jpegSize(f.jpeg);
  if (!size) throw new MediaError(undefined, { context: { noteId, recordingId, why: 'not a jpeg', bytes: f.jpeg.length } });
  const tag = tagOf(o, noteId, f.share, f.jpeg);
  const same = () => maybeOne(o.pool, z.object({ frame_id: z.string() }), 'SELECT frame_id FROM screen_frames WHERE owner_id = $1 AND note_item_id = $2 AND frame_tag = $3', [o.ownerId, noteId, tag]);
  const seen = await same();
  if (seen) return { id: seen.frame_id, duplicate: true };
  const frameId = id128();
  const objectId = id128();
  const ctx = { noteId, recordingId, segment: f.segment, bytes: f.jpeg.length, width: size.width, height: size.height };
  const { krec } = await krecOf(o, recordingId);
  const ct = sealRecord(krec, imageHeader(o, recordingId, frameId, objectId), f.jpeg);
  krec.fill(0);
  const digest = await putChecked(o, objectId, ct, ctx);
  const info: Info = { presenter: f.presenter, share: f.share, at: f.at, segment: f.segment, width: size.width, height: size.height, reading: null, relevance: null, cue: f.cue, pick: f.pick, model: null, grid: gridText(f.grid) };
  let inserted = 0;
  try {
    inserted = await tx(o.pool, async (c) => {
      const n = await exec(c, `INSERT INTO screen_frames (owner_id, note_item_id, frame_id, frame_tag, object_id, cipher_sha256, cipher_bytes, info_ciphertext)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [o.ownerId, noteId, frameId, tag, objectId, digest, ct.length, sealJson(infoKey(o, noteId), infoHeader(o, noteId, frameId), toJson(info))]);
      if (n === 1) await exec(c, 'UPDATE owners SET stored_bytes = stored_bytes + $2, version = version + 1 WHERE owner_id = $1', [o.ownerId, ct.length]);
      return n;
    });
  } catch (e) {
    slog.warn('frame not kept; deleting its object', { ...ctx, objectId, err: e });
    await queueDelete(o, [objectId]);
    throw e;
  }
  if (inserted === 1) { slog.debug('frame kept', { ...ctx, frameId, stored: ct.length }); return { id: frameId, duplicate: false }; }
  await queueDelete(o, [objectId]);
  return { id: (await same())?.frame_id ?? frameId, duplicate: true };
}

/**
 * Deletes frames the analysis left out (`left`: the frames it took and read, and frames of picks there are no longer)
 * that a note's saved screens (`kept`, moment IDs) don't use, in the caller's transaction (the one saving the note): their
 * rows and the bytes they counted. Returns their objects, for the caller to delete once it commits (queueDelete).
 */
export async function dropUnused(o: Owner, db: Db, noteId: string, left: string[], kept: Set<string>): Promise<string[]> {
  const unused = left.filter((id) => !kept.has(id));
  if (!unused.length) return [];
  const del = await rows(db, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }),
    'DELETE FROM screen_frames WHERE owner_id = $1 AND note_item_id = $2 AND frame_id = ANY($3::text[]) RETURNING object_id, cipher_bytes', [o.ownerId, noteId, unused]);
  const bytes = del.reduce((n, x) => n + x.cipher_bytes, 0);
  if (bytes) await exec(db, 'UPDATE owners SET stored_bytes = greatest(0, stored_bytes - $2), version = version + 1 WHERE owner_id = $1', [o.ownerId, bytes]);
  slog.debug('unused frames deleted', { noteId, frames: del.length, bytes });
  return del.map((x) => x.object_id);
}

/** Deletes a note's frames that it doesn't show: what a notes job took before it was stopped. Returns their objects, to delete once this commits. */
export async function dropUnshown(o: Owner, db: Db, noteId: string, shown: Set<string>): Promise<string[]> {
  const all = await rows(db, z.object({ frame_id: z.string() }), 'SELECT frame_id FROM screen_frames WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
  return dropUnused(o, db, noteId, all.map((x) => x.frame_id), shown);
}

/** Puts a sealed object, reads it back and checks it, and returns its digest. A copy that didn't store is deleted. */
async function putChecked(o: Owner, objectId: string, ct: Uint8Array, ctx: Record<string, string | number>): Promise<Uint8Array> {
  await o.objects.put(objectId, ct);
  const back = await o.objects.get(objectId);
  const digest = sha(ct);
  if (back.length !== ct.length || !equalBytes(sha(back), digest)) {
    await queueDelete(o, [objectId]);
    throw new InternalError('The encrypted video didn’t store correctly. It will be retried.', { context: { ...ctx, objectId, wrote: ct.length, readBack: back.length } });
  }
  return digest;
}

/* ---------- shares: who shared, whether it's kept, and when ---------- */

/** What's sealed about a share: the presenter's participant ID, and who they are as the notes name speakers. */
const ShareMeta = z.object({ identity: z.string(), presenter: SpeakerSchema.optional() });
export type ShareMeta = z.infer<typeof ShareMeta>;
const shareKey = (o: Owner, recordingId: string) => stateKey(o.root, o.ownerId, `screen-share:${recordingId}`);
const shareHeader = (o: Owner, recordingId: string, shareId: string): RecordHeader => ({ v: 1, kind: 'screen-share', ownerId: o.ownerId, recordingId, shareId });

/**
 * A share starting while the call's recording exists, in the caller's transaction: whether it's kept for the notes, who
 * shares it (sealed), and where it starts (ms into the call, and the recording's segment then).
 */
export async function startShare(o: Owner, db: Db, recordingId: string, shareId: string, s: { keep: boolean; meta: ShareMeta; atMs: number; segment: number }): Promise<void> {
  const meta: ShareMeta = { identity: s.meta.identity, ...(s.meta.presenter ? { presenter: s.meta.presenter } : {}) };
  await exec(db, `INSERT INTO screen_shares (owner_id, recording_id, share_id, keep, meta_ciphertext, started_ms, started_segment) VALUES ($1,$2,$3,$4,$5,$6,$7)
                  ON CONFLICT DO NOTHING`, [o.ownerId, recordingId, shareId, s.keep, sealJson(shareKey(o, recordingId), shareHeader(o, recordingId, shareId), toJson(meta)), Math.round(s.atMs), s.segment]);
}
/** Shares that ended (their presenter stopped, left, or was moved; or notes went off), in the caller's transaction. Ending one twice keeps the first end. */
export async function endShares(o: Owner, db: Db, recordingId: string, shareIds: string[], atMs: number, segment: number): Promise<void> {
  if (!shareIds.length) return;
  await exec(db, `UPDATE screen_shares SET ended_ms = $4, ended_segment = $5 WHERE owner_id = $1 AND recording_id = $2 AND share_id = ANY($3::text[]) AND ended_ms IS NULL`,
    [o.ownerId, recordingId, shareIds, Math.round(atMs), segment]);
}

/* ---------- pieces: the presenter's browser recording a kept share ---------- */

/** A piece from the browser: its place in the share's video (segment, seq), where it starts in its segment (pauses not counted), and its bytes. */
export interface Piece { segment: number; seq: number; atMs: number; durationMs: number; mimeType: string; bytes: Uint8Array }
const pieceHeader = (o: Owner, recordingId: string, shareId: string, segment: number, seq: number, objectId: string): RecordHeader =>
  ({ v: 1, kind: 'screen-video', ownerId: o.ownerId, recordingId, shareId, segment, seq, objectId, keyVersion: '1' });

/**
 * Whether this piece is stored already. Its place holds only the piece that starts where it does and lasts as long: a
 * different one sent to it is refused (409), never dropped as if it were stored.
 */
export async function pieceStored(o: Owner, recordingId: string, shareId: string, p: Pick<Piece, 'segment' | 'seq' | 'atMs' | 'durationMs'>): Promise<boolean> {
  const there = await maybeOne(o.pool, z.object({ at_ms: z.number(), duration_ms: z.number() }),
    'SELECT at_ms, duration_ms FROM screen_pieces WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 AND segment = $4 AND seq = $5', [o.ownerId, recordingId, shareId, p.segment, p.seq]);
  if (!there) return false;
  if (there.at_ms !== p.atMs || there.duration_ms !== p.durationMs) {
    throw conflict('A different piece of this shared screen is already stored at that place.', {
      recordingId, shareId, segment: p.segment, seq: p.seq, atMs: p.atMs, storedAtMs: there.at_ms, durationMs: p.durationMs, storedDurationMs: there.duration_ms
    });
  }
  return true;
}

/**
 * How long after a kept share ends its presenter's last piece is still taken: their browser hands it over as the share
 * stops, or as the call ends, and it can take a moment to arrive. The notes wait this long after the call (writer.ts).
 */
export const SHARE_TAIL_MS = 20_000;

/**
 * A kept share that has ended, for its tail: whether it's kept, the segment it ended in, and when it ended on the wall
 * clock, from the call's start (`callStartedAt`) and its end in the call, or when the recording stopped if that's
 * earlier. Null when it's unknown or hasn't ended.
 */
export async function shareEnd(o: Owner, recordingId: string, shareId: string, callStartedAt: Date): Promise<{ keep: boolean; segment: number; at: number } | null> {
  const r = await maybeOne(o.pool, z.object({ keep: z.boolean(), ended_ms: z.coerce.number().nullable(), ended_segment: z.number().nullable(), stopped: z.coerce.number().nullable() }),
    `SELECT s.keep, s.ended_ms, s.ended_segment, (extract(epoch FROM r.ended_at) * 1000)::bigint AS stopped
     FROM screen_shares s JOIN recordings r ON r.owner_id = s.owner_id AND r.recording_id = s.recording_id
     WHERE s.owner_id = $1 AND s.recording_id = $2 AND s.share_id = $3`, [o.ownerId, recordingId, shareId]);
  if (!r || r.ended_ms === null || r.ended_segment === null) return null;
  const at = callStartedAt.getTime() + r.ended_ms;
  return { keep: r.keep, segment: r.ended_segment, at: r.stopped === null ? at : Math.min(at, r.stopped) };
}

/**
 * When the last kept share's tail is over, as an epoch ms, for a recording that has stopped: its end in the call, put on
 * the wall clock from when the recording stopped and how long the call ran (`callSeconds`). Null without a kept share
 * that ended, or before the recording stops.
 */
export async function tailEndsAt(o: Pick<Owner, 'pool' | 'ownerId'>, recordingId: string, callSeconds: number): Promise<number | null> {
  const r = await maybeOne(o.pool, z.object({ stopped: z.coerce.number().nullable(), last: z.coerce.number().nullable() }),
    `SELECT (extract(epoch FROM r.ended_at) * 1000)::bigint AS stopped, max(s.ended_ms) AS last
     FROM recordings r LEFT JOIN screen_shares s ON s.owner_id = r.owner_id AND s.recording_id = r.recording_id AND s.keep
     WHERE r.owner_id = $1 AND r.recording_id = $2 GROUP BY r.ended_at`, [o.ownerId, recordingId]);
  if (!r || r.stopped === null || r.last === null) return null;
  return r.stopped - Math.max(0, callSeconds * 1000 - r.last) + SHARE_TAIL_MS;
}

/** The most a share's pieces may hold together for each second it has been up (about five times what a browser records), and before it starts counting. */
const BUDGET_PER_SECOND = 250_000;
const BUDGET_FROM_SECONDS = 30;
/** The most a share's stored pieces may hold together once it has been up `seconds`. */
export const shareBudget = (seconds: number) => Math.round((Math.max(0, seconds) + BUDGET_FROM_SECONDS) * BUDGET_PER_SECOND);

/**
 * Encrypts, stores and verifies one piece of a kept share's video, after the call has let it through (calls.ts checks
 * whose share it is, that it's kept and going, or within its tail, and that notes are on). Sending a piece that's stored
 * already is a no-op, so retries are safe. Refused while notes are paused, and once the recording has stopped unless
 * it's the share's tail (`tail`). A piece that arrives once its share's video is joined is refused (404), so nothing is
 * left behind that the video doesn't hold: storing it holds the share's row, which joining locks. A piece that would
 * take the share's pieces past `budget` bytes (shareBudget, from how long it has been up) is refused (409), so nobody
 * fills the organizer's storage under one share.
 */
export async function appendPiece(o: Owner, recordingId: string, shareId: string, p: Piece, budget: number, tail = false): Promise<void> {
  const where = { recordingId, shareId, segment: p.segment, seq: p.seq, atMs: p.atMs, tail: tail ? 1 : 0 };
  if (await pieceStored(o, recordingId, shareId, p)) { slog.debug('screen piece already stored', where); return; }
  const { krec, state } = await krecOf(o, recordingId);
  if (state !== 'recording' && !(tail && state === 'stopped')) { krec.fill(0); throw conflict(state === 'paused' ? 'Notes are paused.' : 'Notes aren’t on right now.', { ...where, state }); }
  const objectId = id128();
  const ct = sealRecord(krec, pieceHeader(o, recordingId, shareId, p.segment, p.seq, objectId), p.bytes);
  krec.fill(0);
  const digest = await putChecked(o, objectId, ct, where);
  let inserted: number | 'joined' | 'over';
  try {
    inserted = await tx(o.pool, async (c): Promise<number | 'joined' | 'over'> => {
      const share = await maybeOne(c, z.object({ keep: z.boolean() }), 'SELECT keep FROM screen_shares WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 FOR UPDATE', [o.ownerId, recordingId, shareId]);
      if (!share || !share.keep) return 'joined';
      const video = await maybeOne(c, z.object({ chunk: z.number() }), 'SELECT chunk FROM screen_videos WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 AND segment = $4 LIMIT 1',
        [o.ownerId, recordingId, shareId, p.segment]);
      if (video) return 'joined';
      // What the share holds already, by the size of what was sent: a share is never more than its budget.
      const held = await maybeOne(c, z.object({ bytes: z.coerce.number() }), 'SELECT coalesce(sum(cipher_bytes), 0) AS bytes FROM screen_pieces WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3',
        [o.ownerId, recordingId, shareId]);
      if ((held?.bytes ?? 0) + ct.length > budget) return 'over';
      const n = await exec(c, `INSERT INTO screen_pieces (owner_id, recording_id, share_id, segment, seq, at_ms, duration_ms, object_id, cipher_sha256, cipher_bytes, mime_type)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
        [o.ownerId, recordingId, shareId, p.segment, p.seq, p.atMs, p.durationMs, objectId, digest, ct.length, p.mimeType]);
      if (n === 1) await exec(c, 'UPDATE owners SET stored_bytes = stored_bytes + $2, version = version + 1 WHERE owner_id = $1', [o.ownerId, ct.length]);
      return n;
    });
    if (inserted === 1) { slog.debug('screen piece stored', { ...where, bytes: ct.length, durationMs: p.durationMs }); return; }
  } catch (e) {
    slog.warn('screen piece not recorded; deleting its object', { ...where, objectId, err: e });
    await queueDelete(o, [objectId]);
    throw e;
  }
  if (inserted === 'over') {
    await queueDelete(o, [objectId]);
    throw conflict('This shared screen has sent more video than it could have recorded.', { ...where, bytes: ct.length, budget });
  }
  if (inserted === 'joined') {
    await queueDelete(o, [objectId]);
    throw notFound('That share', { ...where, joined: 1 });
  }
  // Another request stored this place first. Ours is a copy of that piece, unless it's a different one.
  await queueDelete(o, [objectId]);
  if (await pieceStored(o, recordingId, shareId, p)) slog.info('screen piece raced a retry; dropping the duplicate', where);
  else slog.info('screen piece raced its recording being deleted; dropping it', where);
}

/** Decrypts one share's pieces in one segment, in order: MediaRecorder's pieces join into one stream. */
async function* piecesOf(o: Owner, recordingId: string, shareId: string, segment: number): AsyncGenerator<Uint8Array> {
  const pieces = await rows(o.pool, z.object({ seq: z.number(), object_id: z.string(), cipher_sha256: bytea }),
    'SELECT seq, object_id, cipher_sha256 FROM screen_pieces WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 AND segment = $4 ORDER BY seq', [o.ownerId, recordingId, shareId, segment]);
  const { krec } = await krecOf(o, recordingId);
  try {
    for (const p of pieces) {
      const ct = await o.objects.get(p.object_id);
      if (!equalBytes(sha(ct), p.cipher_sha256)) throw new IntegrityError('A piece of a shared screen failed its integrity check.', { context: { recordingId, shareId, segment, seq: p.seq, objectId: p.object_id } });
      yield openRecord(krec, pieceHeader(o, recordingId, shareId, segment, p.seq, p.object_id), ct);
    }
  } finally {
    krec.fill(0);
  }
}

/* ---------- video: each kept share's pieces in a segment, joined into one seekable video ---------- */

/** How much of a video one sealed chunk holds. */
export const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;
const chunkHeader = (o: Owner, recordingId: string, shareId: string, segment: number, chunk: number, chunks: number, objectId: string): RecordHeader =>
  ({ v: 1, kind: 'screen-video-chunk', ownerId: o.ownerId, recordingId, shareId, segment, chunk, chunks, objectId, keyVersion: '1' });

/**
 * ffmpeg output staged as encrypted objects, under a fresh key held only for this join. A crash loses the key; the
 * normal orphan sweep removes the unreadable objects. Successful and failed joins delete them in finally. No
 * plaintext file is written (Cloud Run's writable filesystem is memory-backed), and one MiB is buffered per sink.
 */
function stageVideo(o: Owner, recordingId: string, shareId: string, segment: number): VideoSink & { close: () => Promise<void> } {
  const key = random(32);
  const stageId = id128();
  const chunkBytes = 1024 * 1024;
  const buffer = new Uint8Array(chunkBytes);
  const pieces: { objectId: string; digest: Uint8Array; bytes: number }[] = [];
  const objects: string[] = [];
  let length = 0;
  let used = 0;
  let cached: { chunk: number; plain: Uint8Array } | null = null;
  const header = (objectId: string, chunk: number): RecordHeader => ({ v: 1, kind: 'screen-video-stage', ownerId: o.ownerId, recordingId, shareId, segment, stageId, objectId, chunk });
  const flush = async () => {
    if (!used) return;
    const objectId = id128();
    objects.push(objectId);
    const ct = sealRecord(key, header(objectId, pieces.length), buffer.subarray(0, used));
    const digest = await putChecked(o, objectId, ct, { recordingId, shareId, segment, stageId, chunk: pieces.length });
    pieces.push({ objectId, digest, bytes: used });
    buffer.fill(0);
    used = 0;
  };
  return {
    append: async (bytes) => {
      for (let at = 0; at < bytes.length;) {
        const n = Math.min(chunkBytes - used, bytes.length - at);
        buffer.set(bytes.subarray(at, at + n), used);
        used += n;
        at += n;
        length += n;
        if (used === chunkBytes) await flush();
      }
    },
    finish: async () => {
      await flush();
      return { length, read: async (from, to) => {
        if (from < 0 || to < from || to > length || to - from > VIDEO_CHUNK_BYTES) throw new MediaError(undefined, { context: { recordingId, shareId, segment, why: 'staging range', bytes: to - from } });
        const out = new Uint8Array(to - from);
        for (let at = from; at < to;) {
          const chunk = Math.floor(at / chunkBytes);
          const p = pieces[chunk];
          if (!p) throw new MediaError(undefined, { context: { recordingId, shareId, segment, why: 'staging chunk', chunk } });
          if (cached?.chunk !== chunk) {
            const ct = await o.objects.get(p.objectId);
            // Staging can be regenerated from the original pieces: do not classify this as an irreparably bad input.
            if (!equalBytes(sha(ct), p.digest)) throw new InternalError('A staged shared screen failed its integrity check. It will be retried.', { context: { recordingId, shareId, segment, stageId, chunk } });
            cached?.plain.fill(0);
            cached = { chunk, plain: openRecord(key, header(p.objectId, chunk), ct) };
          }
          const within = at - chunk * chunkBytes;
          const n = Math.min(p.bytes - within, to - at);
          out.set(cached.plain.subarray(within, within + n), at - from);
          at += n;
        }
        return out;
      } };
    },
    close: async () => {
      key.fill(0);
      buffer.fill(0);
      cached?.plain.fill(0);
      cached = null;
      for (let i = 0; i < objects.length; i += 8) await queueDelete(o, objects.slice(i, i + 8));
    }
  };
}

const Group = z.object({ share_id: z.string(), segment: z.number(), at_ms: z.number(), end_ms: z.coerce.number(), mime_type: z.string(), pieces: z.coerce.number(), bytes: z.coerce.number() });
type Group = z.infer<typeof Group>;
/** Kept shares' pieces by share and segment: every one of the recording's, or (`only`) one share's in one segment. */
const groupsOf = (o: Owner, db: Db, recordingId: string, only?: { share: string; segment: number } | undefined) =>
  rows(db, Group, `SELECT p.share_id, p.segment, min(p.at_ms)::int AS at_ms, max(p.at_ms + p.duration_ms) AS end_ms, min(p.mime_type) AS mime_type,
                          count(*) AS pieces, sum(p.cipher_bytes) AS bytes
                   FROM screen_pieces p JOIN screen_shares s ON s.owner_id = p.owner_id AND s.recording_id = p.recording_id AND s.share_id = p.share_id
                   WHERE p.owner_id = $1 AND p.recording_id = $2 AND s.keep AND ($3::text IS NULL OR (p.share_id = $3 AND p.segment = $4))
                   GROUP BY p.share_id, p.segment ORDER BY p.share_id, p.segment`, [o.ownerId, recordingId, only?.share ?? null, only?.segment ?? 0]);

/**
 * Once a call is over: for every kept share and segment that still has pieces, joins them into one video a browser can
 * seek, seals it into chunks, and deletes the pieces (rows, then objects). The chunks and the pieces' end are one
 * transaction, so a job that stopped halfway and runs again carries on: whatever has its video only loses its pieces.
 * A piece that came in while the video was being joined (its share's tail) is joined in once more. A share whose video
 * won't join (ffmpeg can't read it, or a piece fails its integrity check) is left out of replay and its pieces deleted;
 * the object store failing is thrown, so the job tries again. Safe to run again.
 */
export async function finishVideo(o: Owner, recordingId: string): Promise<{ videos: number; failed: number }> {
  return alone(o, recordingId, () => joinVideo(o, recordingId));
}

/** Joins going on in this process, by recording: the next one for a recording waits for the one before. */
const joining = new Map<string, Promise<unknown>>();
/** Two joins across all owners: ffmpeg and its bounded staging buffers cannot multiply with simultaneous call ends. */
const waitingJoins: (() => void)[] = [];
let activeJoins = 0;
async function withJoinSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeJoins < 2) activeJoins++;
  else await new Promise<void>((resolve) => waitingJoins.push(resolve));
  try { return await fn(); }
  finally {
    const next = waitingJoins.shift();
    if (next) next();
    else activeJoins--;
  }
}
/**
 * Runs `fn` once every join of the same recording started before it in this process is done, so the notes job and
 * joinDue never remux the same pieces at once here: whoever comes second finds the video joined and has nothing to do.
 * It holds no database connection while it waits or works (a server can have just one). Two instances that join the
 * same recording at once are kept apart by storeVideo, which keeps the first video and lets the other go.
 */
async function alone<T>(o: Owner, recordingId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${o.ownerId}:${recordingId}`;
  const before = joining.get(key) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(() => withJoinSlot(fn));
  const done = run.catch(() => undefined);
  joining.set(key, done);
  try {
    return await run;
  } finally {
    if (joining.get(key) === done) joining.delete(key);
  }
}

/**
 * Joins the shares of every stopped recording whose kept shares still have pieces and whose tail is over, so replay
 * doesn't depend on the notes service: an owner's, or everyone's when `ownerId` is omitted. A recording whose tail isn't
 * over is left, and `waitMs` is how long until the soonest one is (null when none waits). The tail is taken as ending
 * `SHARE_TAIL_MS` after the recording stopped, the latest it can end, since the call's length isn't known without opening
 * its note; a share that ended earlier is joined a little later than it could be, never before its last piece. One
 * recording failing is logged and doesn't stop the rest; the next kick or maintenance run tries it again.
 */
export async function joinDue(d: Deps, ownerId?: string | undefined): Promise<{ joined: number; waitMs: number | null }> {
  const due = await rows(d.pool, z.object({ owner_id: z.string(), recording_id: z.string() }),
    `SELECT DISTINCT p.owner_id, p.recording_id FROM screen_pieces p
     JOIN screen_shares s ON s.owner_id = p.owner_id AND s.recording_id = p.recording_id AND s.share_id = p.share_id AND s.keep
     JOIN recordings r ON r.owner_id = p.owner_id AND r.recording_id = p.recording_id AND r.state = 'stopped'
     WHERE ($1::text IS NULL OR p.owner_id = $1) LIMIT 200`, [ownerId ?? null]);
  let joined = 0;
  let waitMs: number | null = null;
  for (const r of due) {
    try {
      const tail = await tailEndsAt({ pool: d.pool, ownerId: r.owner_id }, r.recording_id, 0);
      if (tail !== null && tail > Date.now()) { waitMs = Math.min(waitMs ?? Number.POSITIVE_INFINITY, tail - Date.now()); continue; }
      const o = await openOwner(d, r.owner_id, undefined);
      try {
        const done = await finishVideo(o, r.recording_id);
        if (done.videos) joined++;
      } finally {
        o.root.fill(0);
        o.wrapKey.fill(0);
      }
    } catch (e) {
      slog.warn('shared screens not joined into video; will try again', { recordingId: r.recording_id, err: e });
    }
  }
  return { joined, waitMs };
}

/** Joins every kept share's pieces, segment by segment. A share that can't be joined fails for good, so it is counted and its pieces deleted. */
async function joinVideo(o: Owner, recordingId: string): Promise<{ videos: number; failed: number }> {
  const groups = await groupsOf(o, o.pool, recordingId);
  let videos = 0;
  let failed = 0;
  for (const first of groups) {
    const ctx = { recordingId, shareId: first.share_id, segment: first.segment, pieces: first.pieces };
    const done = await maybeOne(o.pool, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM screen_videos WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 AND segment = $4',
      [o.ownerId, recordingId, first.share_id, first.segment]);
    if (done?.n) { await dropPieces(o, recordingId, first.share_id, first.segment); continue; }
    let g: Group | undefined = first;
    for (let pass = 1; g; pass++) {
      const type = videoType(g.mime_type);
      const stage = stageVideo(o, recordingId, g.share_id, g.segment);
      try {
        let video: Video;
        try {
          if (!type) throw new MediaError(undefined, { context: { ...ctx, why: 'type' } });
          video = await remux(piecesOf(o, recordingId, g.share_id, g.segment), g.mime_type, stage);
        } catch (e) {
          if (!(e instanceof MediaError) && !(e instanceof IntegrityError)) throw e;
          slog.at(e instanceof IntegrityError ? 'error' : 'warn', 'a shared screen’s video couldn’t be joined; left out of replay, and its pieces deleted', { ...ctx, err: e });
          // Both failures are the same every time, so the pieces go rather than being joined again at every upkeep.
          await dropPieces(o, recordingId, g.share_id, g.segment);
          failed++;
          break;
        }
        // More pieces since it was joined: once, it's joined again with them; after that it's kept as it is.
        const more = await storeVideo(o, recordingId, g, type, video, pass < 2);
        if (more) { slog.info('a shared screen’s video got more pieces while it was joined; joining again', { ...ctx, pieces: more.pieces }); g = more; continue; }
        videos++;
        g = undefined;
      } finally {
        await stage.close();
      }
    }
  }
  if (groups.length) slog.info('shared screens joined into video', { recordingId, videos, failed, segments: groups.length });
  return { videos, failed };
}

/**
 * Whether a recording's kept shares are joined into video that replay can seek in: true once none of their pieces are
 * left and some video is, false while they wait to be joined, null when no kept share sent anything (nothing to wait for).
 */
export async function videoReady(o: Owner, recordingId: string): Promise<boolean | null> {
  const r = await maybeOne(o.pool, z.object({ pieces: z.number(), videos: z.number() }), `SELECT
      (SELECT count(*)::int FROM screen_pieces WHERE owner_id = $1 AND recording_id = $2) AS pieces,
      (SELECT count(*)::int FROM screen_videos WHERE owner_id = $1 AND recording_id = $2) AS videos`, [o.ownerId, recordingId]);
  if (!r || (!r.pieces && !r.videos)) return null;
  return r.pieces === 0;
}

/**
 * Seals a joined video in chunks, checks each, and keeps their rows in one transaction with the pieces gone (rows, then
 * objects once it commits). The share's row is locked first, so no piece is stored meanwhile (appendPiece), and the
 * pieces counted again: when more came in since it was joined and `again` allows, nothing is kept and the share's
 * pieces are returned, to join again. When another join (on another instance) kept this share's video first, this one
 * keeps nothing and its objects go.
 */
async function storeVideo(o: Owner, recordingId: string, g: Group, type: VideoType, video: Video, again: boolean): Promise<Group | null> {
  const chunks = Math.max(1, Math.ceil(video.length / VIDEO_CHUNK_BYTES));
  const stored: { chunk: number; objectId: string; digest: Uint8Array; bytes: number; plain: number }[] = [];
  const where = { recordingId, shareId: g.share_id, segment: g.segment };
  const { krec } = await krecOf(o, recordingId);
  try {
    for (let chunk = 0; chunk < chunks; chunk++) {
      const plain = await video.read(chunk * VIDEO_CHUNK_BYTES, Math.min(video.length, (chunk + 1) * VIDEO_CHUNK_BYTES));
      const objectId = id128();
      const ct = sealRecord(krec, chunkHeader(o, recordingId, g.share_id, g.segment, chunk, chunks, objectId), plain);
      const digest = await putChecked(o, objectId, ct, { ...where, chunk });
      stored.push({ chunk, objectId, digest, bytes: ct.length, plain: plain.length });
    }
  } catch (e) {
    await queueDelete(o, stored.map((x) => x.objectId));
    throw e;
  } finally {
    krec.fill(0);
  }
  const durationMs = Math.max(0, g.end_ms - g.at_ms);
  let out: { more: Group | null; pieces: string[]; kept: boolean };
  try {
    out = await tx(o.pool, async (c) => {
      await exec(c, 'SELECT 1 FROM screen_shares WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 FOR UPDATE', [o.ownerId, recordingId, g.share_id]);
      const had = await maybeOne(c, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM screen_videos WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 AND segment = $4',
        [o.ownerId, recordingId, g.share_id, g.segment]);
      if (had?.n) return { more: null, pieces: [], kept: true };
      const now = (await groupsOf(o, c, recordingId, { share: g.share_id, segment: g.segment }))[0];
      // The winner may have finished the notes and purged temporary video while this instance was still remuxing.
      // Keeping a stale result then would resurrect a recording that the organizer asked us to delete.
      if (!now) return { more: null, pieces: [], kept: true };
      if (again && now && now.pieces !== g.pieces) return { more: now, pieces: [], kept: false };
      for (const x of stored) {
        await exec(c, `INSERT INTO screen_videos (owner_id, recording_id, share_id, segment, chunk, object_id, cipher_sha256, cipher_bytes, plain_bytes, total_bytes, chunks, at_ms, duration_ms, mime_type)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [o.ownerId, recordingId, g.share_id, g.segment, x.chunk, x.objectId, x.digest, x.bytes, x.plain, video.length, chunks, g.at_ms, durationMs, type]);
      }
      const gone = await rows(c, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }),
        'DELETE FROM screen_pieces WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 AND segment = $4 RETURNING object_id, cipher_bytes', [o.ownerId, recordingId, g.share_id, g.segment]);
      const added = stored.reduce((n, x) => n + x.bytes, 0) - gone.reduce((n, x) => n + x.cipher_bytes, 0);
      await exec(c, 'UPDATE owners SET stored_bytes = greatest(0, stored_bytes + $2), version = version + 1 WHERE owner_id = $1', [o.ownerId, added]);
      return { more: null, pieces: gone.map((x) => x.object_id), kept: false };
    });
  } catch (e) {
    slog.warn('shared screen video not recorded; deleting its objects', { ...where, err: e });
    await queueDelete(o, stored.map((x) => x.objectId));
    throw e;
  }
  if (out.more) { await queueDelete(o, stored.map((x) => x.objectId)); return out.more; }
  if (out.kept) {
    await queueDelete(o, stored.map((x) => x.objectId));
    slog.info('shared screen video no longer needs this join; this one let go', where);
    return null;
  }
  await queueDelete(o, out.pieces);
  slog.debug('shared screen video stored', { ...where, chunks, bytes: video.length, durationMs, pieces: out.pieces.length });
  return null;
}

/** A share's pieces in a segment, once its video is kept: rows (and the bytes they count) in a transaction, then objects. */
async function dropPieces(o: Owner, recordingId: string, shareId: string, segment: number): Promise<void> {
  const gone = await tx(o.pool, async (c) => {
    const del = await rows(c, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }),
      'DELETE FROM screen_pieces WHERE owner_id = $1 AND recording_id = $2 AND share_id = $3 AND segment = $4 RETURNING object_id, cipher_bytes', [o.ownerId, recordingId, shareId, segment]);
    const bytes = del.reduce((n, x) => n + x.cipher_bytes, 0);
    if (bytes) await exec(c, 'UPDATE owners SET stored_bytes = greatest(0, stored_bytes - $2), version = version + 1 WHERE owner_id = $1', [o.ownerId, bytes]);
    return del.map((x) => x.object_id);
  });
  await queueDelete(o, gone);
}

/**
 * Deletes a recording's shared-screen video and pieces, in the caller's transaction, for a call set not to keep its
 * recording: stored bytes go down to match. Returns their objects, for the caller to delete once the transaction
 * commits (queueDelete).
 */
export async function purgeVideo(o: Owner, db: Db, recordingId: string): Promise<string[]> {
  // The same lock as appendPiece/storeVideo, taken before either DELETE: an in-flight join must commit before the
  // purge, or observe that its source pieces are gone after it. It can never publish after a completed purge.
  await exec(db, 'SELECT 1 FROM screen_shares WHERE owner_id = $1 AND recording_id = $2 ORDER BY share_id FOR UPDATE', [o.ownerId, recordingId]);
  const gone = [
    ...await rows(db, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }), 'DELETE FROM screen_videos WHERE owner_id = $1 AND recording_id = $2 RETURNING object_id, cipher_bytes', [o.ownerId, recordingId]),
    ...await rows(db, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }), 'DELETE FROM screen_pieces WHERE owner_id = $1 AND recording_id = $2 RETURNING object_id, cipher_bytes', [o.ownerId, recordingId])
  ];
  // The source metadata is no longer needed by the saved frames. Removing it also prevents an upload admitted
  // before the purge from inserting its piece after a slow object write completes.
  await exec(db, 'DELETE FROM screen_shares WHERE owner_id = $1 AND recording_id = $2', [o.ownerId, recordingId]);
  if (!gone.length) return [];
  await exec(db, 'UPDATE owners SET stored_bytes = greatest(0, stored_bytes - $2), version = version + 1 WHERE owner_id = $1', [o.ownerId, gone.reduce((n, x) => n + x.cipher_bytes, 0)]);
  slog.info('shared screen video deleted, as the call was set to', { recordingId, objects: gone.length });
  return gone.map((x) => x.object_id);
}

const VideoRow = z.object({ share_id: z.string(), segment: z.number(), at_ms: z.number(), duration_ms: z.number(), meta_ciphertext: bytea, started_ms: z.coerce.number() });

/**
 * The kept shares that have video, oldest first, on the recording's timeline as the note's player counts it: a segment
 * starts where the audio of the segments before it ends, and a share's video in a segment starts `at_ms` into it
 * (pauses not counted, like audio). Its video's own time 0 is that `at`. Each with whose it was and a label to tell it
 * apart from their other shares ("Priya’s screen", then "Priya’s screen (2)"). Segment lengths are `kept` (seconds by
 * segment index, saved in the note when the recording stopped) when there are any, and otherwise the audio's own: a
 * call that doesn't keep its recording has no audio left to measure.
 */
export async function shareIntervals(o: Owner, recordingId: string, kept: number[]): Promise<ScreenShare[]> {
  const found = await rows(o.pool, VideoRow, `SELECT v.share_id, v.segment, v.at_ms, v.duration_ms, s.meta_ciphertext, s.started_ms
                                               FROM screen_videos v JOIN screen_shares s ON s.owner_id = v.owner_id AND s.recording_id = v.recording_id AND s.share_id = v.share_id
                                               WHERE v.owner_id = $1 AND v.recording_id = $2 AND v.chunk = 0 AND s.keep ORDER BY s.started_ms, v.share_id, v.segment`, [o.ownerId, recordingId]);
  if (!found.length) return [];
  const audio = kept.length ? kept.map((seconds, index) => ({ index, seconds })) : await segments(o, recordingId);
  const before = (segment: number) => audio.filter((g) => g.index < segment).reduce((n, g) => n + g.seconds, 0);
  const length = (segment: number) => audio.find((g) => g.index === segment)?.seconds;
  const tenth = (x: number) => Math.round(x * 10) / 10;
  const shares = new Map<string, ScreenShare>();
  const labels = new Map<string, number>();
  for (const r of found) {
    const base = before(r.segment);
    const at = tenth(base + r.at_ms / 1000);
    const end = base + (r.at_ms + r.duration_ms) / 1000;
    // Inside its segment's audio, which is the clock replay keeps.
    const segLength = length(r.segment);
    const until = tenth(Math.max(at, segLength === undefined ? end : Math.min(end, base + segLength)));
    let s = shares.get(r.share_id);
    if (!s) {
      const meta = openJson(shareKey(o, recordingId), shareHeader(o, recordingId, r.share_id), r.meta_ciphertext, ShareMeta);
      const name = meta.presenter ? `${meta.presenter.name}’s screen` : 'Shared screen';
      const n = (labels.get(name) ?? 0) + 1;
      labels.set(name, n);
      s = { id: r.share_id, ...(meta.presenter ? { presenter: meta.presenter } : {}), label: n > 1 ? `${name} (${n})` : name, at, until, segments: [] };
      shares.set(r.share_id, s);
    }
    s.segments.push({ segment: r.segment, at, until });
    s.at = Math.min(s.at, at);
    s.until = Math.max(s.until, until);
  }
  return [...shares.values()].sort((a, b) => a.at - b.at);
}

const ChunkRow = z.object({ chunk: z.number(), object_id: z.string(), cipher_sha256: bytea, plain_bytes: z.number(), total_bytes: z.coerce.number(), chunks: z.number(), mime_type: z.string() });
/** What a share's video in a segment is: its type and size. Not found when it has none (or isn't kept). */
async function videoChunks(o: Owner, recordingId: string, shareId: string, segment: number) {
  const chunks = await rows(o.pool, ChunkRow, `SELECT v.chunk, v.object_id, v.cipher_sha256, v.plain_bytes, v.total_bytes, v.chunks, v.mime_type
                                               FROM screen_videos v JOIN screen_shares s ON s.owner_id = v.owner_id AND s.recording_id = v.recording_id AND s.share_id = v.share_id
                                               WHERE v.owner_id = $1 AND v.recording_id = $2 AND v.share_id = $3 AND v.segment = $4 AND s.keep ORDER BY v.chunk`,
  [o.ownerId, recordingId, shareId, segment]);
  const first = chunks[0];
  const type = first ? videoType(first.mime_type) : null;
  if (!first || !type || chunks.length !== first.chunks) throw notFound('That shared screen’s video', { recordingId, segment });
  return { chunks, type, total: first.total_bytes };
}

/** One chunk, fetched, checked and opened. */
async function openChunk(o: Owner, krec: Uint8Array, recordingId: string, shareId: string, segment: number, c: z.infer<typeof ChunkRow>): Promise<Uint8Array> {
  const ct = await o.objects.get(c.object_id);
  if (!equalBytes(sha(ct), c.cipher_sha256)) throw new IntegrityError('A shared screen’s video failed its integrity check.', { context: { recordingId, shareId, segment, chunk: c.chunk, objectId: c.object_id } });
  return openRecord(krec, chunkHeader(o, recordingId, shareId, segment, c.chunk, c.chunks, c.object_id), ct);
}

/**
 * A share's video in a segment, decrypted chunk by chunk, with its type: what the analysis feeds to ffmpeg's `frames`.
 * Not found when there's none.
 */
export async function videoInput(o: Owner, recordingId: string, shareId: string, segment: number): Promise<{ mimeType: VideoType; bytes: number; data: AsyncGenerator<Uint8Array> }> {
  const v = await videoChunks(o, recordingId, shareId, segment);
  async function* data(): AsyncGenerator<Uint8Array> {
    const { krec } = await krecOf(o, recordingId);
    try {
      for (const c of v.chunks) yield await openChunk(o, krec, recordingId, shareId, segment, c);
    } finally {
      krec.fill(0);
    }
  }
  return { mimeType: v.type, bytes: v.total, data: data() };
}

/**
 * A byte range asked for, as in an HTTP Range header: from `start` to `end`, inclusive (`end` null: to the end), or with
 * `start` null, the last `end` bytes.
 */
export type ByteRange = { start: number; end: number | null } | { start: null; end: number };
/** A range that can't be served from a video of this size. */
export class UnsatisfiableRange extends ValidationError {}

/**
 * A share's video in a segment for replay, whole or one range of it, opening only the chunks the range needs: its type,
 * its full size, the range served (inclusive), and the bytes. A range that starts past the end is refused.
 */
export async function videoRange(o: Owner, recordingId: string, shareId: string, segment: number, range: ByteRange | null): Promise<{ mimeType: VideoType; total: number; start: number; end: number; data: AsyncGenerator<Uint8Array> }> {
  const v = await videoChunks(o, recordingId, shareId, segment);
  const start = !range ? 0 : range.start === null ? Math.max(0, v.total - range.end) : range.start;
  const end = !range || range.start === null || range.end === null ? v.total - 1 : Math.min(v.total - 1, range.end);
  if (start >= v.total || end < start || (range?.start === null && range.end === 0)) throw new UnsatisfiableRange('That range isn’t in this video.', { context: { recordingId, segment, total: v.total } });
  async function* data(): AsyncGenerator<Uint8Array> {
    const { krec } = await krecOf(o, recordingId);
    try {
      for (const c of v.chunks) {
        const from = c.chunk * VIDEO_CHUNK_BYTES;
        const to = from + c.plain_bytes - 1;
        if (to < start || from > end) continue;
        const plain = await openChunk(o, krec, recordingId, shareId, segment, c);
        yield plain.subarray(Math.max(0, start - from), Math.min(c.plain_bytes, end - from + 1));
      }
    } finally {
      krec.fill(0);
    }
  }
  return { mimeType: v.type, total: v.total, start, end, data: data() };
}

/** A note's shared-screen video objects (pieces not joined yet, and joined video) and their stored bytes, for deleting the note. */
export async function videoObjects(o: Owner, db: Db, noteId: string): Promise<{ ids: string[]; bytes: number }> {
  const objs = await rows(db, z.object({ object_id: z.string(), cipher_bytes: z.coerce.number() }),
    `SELECT p.object_id, p.cipher_bytes FROM screen_pieces p JOIN recordings r ON r.owner_id = p.owner_id AND r.recording_id = p.recording_id WHERE r.owner_id = $1 AND r.note_item_id = $2
     UNION ALL
     SELECT v.object_id, v.cipher_bytes FROM screen_videos v JOIN recordings r ON r.owner_id = v.owner_id AND r.recording_id = v.recording_id WHERE r.owner_id = $1 AND r.note_item_id = $2`, [o.ownerId, noteId]);
  return { ids: objs.map((x) => x.object_id), bytes: objs.reduce((n, x) => n + x.cipher_bytes, 0) };
}

/* ---------- analysis: frames picked from what was said, read, and judged ---------- */

/** A frame to take, as a notes job keeps it (sealed, in the job), so a job tried again takes the same frames. */
export const FramePickSchema = z.object({ share: z.string(), segment: z.number(), at: z.number(), cue: z.string(), why: PickWhySchema, before: z.number().nullable().default(null) });
/**
 * How far a notes job has got with the shared screens: the frames picked (null until they are), and the ones not to take
 * again (by share and second): the same image as a frame already kept, past the end of the video, or a video frames
 * couldn't be taken from. Jobs kept before unrelated frames were kept until the notes are saved also list those. And the
 * verifications its requests went to so far (`evidence`), so a job tried again still says what picked and read them.
 */
export const ScreenProgressSchema = z.object({ picks: z.array(FramePickSchema).nullable(), skip: z.array(z.string()), evidence: z.array(InferenceEvidenceSchema).default([]) });
export type ScreenProgress = z.infer<typeof ScreenProgressSchema>;

const pickKey = (share: string, at: number) => `${share}:${at}`;

/**
 * The screens the notes are written with: every frame that matters (read key or supporting), in order, each lasting
 * until the end of its share's video in its segment, but never a frame taken only to compare a change with. Which of
 * them the note shows, on which line and until when, is decided by how they were judged (drafting.attachments).
 */
export function momentsOf(frames: Frame[], shares: ScreenShare[]): ScreenMoment[] {
  return [...frames].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).flatMap((f): ScreenMoment[] => {
    const relevance = f.relevance ?? 'supporting';
    if (relevance === 'unrelated' || f.pick === 'before') return [];
    const reading = f.reading ?? UNREAD;
    const share = shares.find((s) => s.id === f.share);
    return [{
      id: f.id, at: f.at, until: share?.segments.find((g) => g.segment === f.segment)?.until ?? f.at, ...(share?.presenter ? { presenter: share.presenter } : {}), share: f.share,
      width: f.width, height: f.height, legible: reading.legible, title: reading.title, text: reading.text, description: '', shows: reading.shows, changed: reading.changed, regions: reading.regions, relevance, cue: f.cue, line: null
    }];
  });
}

/**
 * What a call's kept shares showed while it mattered, for its notes (docs: notes-and-inference › Shared screens). Each
 * step is kept as it's done, so a job tried again carries on where it stopped (`progress`, kept by `save`):
 *
 *  1. The notes model picks the moments what was said points at a screen; selectFrames clamps them into the shares'
 *     video, adds the frame a few seconds before each change it was told of and, when there's room, each share's start,
 *     and keeps to one for every SECONDS_PER_SCREEN_FRAME seconds of sharing and MAX_SCREEN_FRAMES (picks, kept in the job).
 *  2. One ffmpeg pass per share and segment takes those frames from the sealed video, each with its grey grid; each is
 *     sealed as a frame of the note. A frame of a pick that's already kept isn't taken again; frames kept for picks
 *     there are no longer (notes written again, from a corrected transcript) are left out.
 *  3. The model chosen reads each frame not read by it yet, four at a time, with the words that picked it and what was
 *     said around it (and, for a change, the frame before it, to say what changed), and judges how much it matters.
 *     Frames judged unrelated are left out, and keep their row (read, by this model) so a job tried again doesn't read
 *     them again. Frames before a change are never read on their own.
 *
 * Nothing is deleted here: the note's current screens keep their frames until new notes are saved, and frames the saved
 * note doesn't show are deleted then, in the same transaction (dropUnused, from
 * writer.settle).
 *
 * Returns the screens for the notes (momentsOf) with their grids, every frame the analysis has (`left`, for
 * dropUnused), the verifications the requests went to, and the model that read the screens. When a model's evidence
 * doesn't check out, or it doesn't answer, that's thrown: the notes wait.
 */
export async function analyze(o: Owner, noteId: string, recordingId: string, a: {
  lines: TranscriptLine[]; shares: ScreenShare[]; via: ChatModel; meter: Meter; progress: ScreenProgress; save: (p: ScreenProgress) => Promise<void>; renew: () => Promise<void>;
}): Promise<{ shown: ScreenMoment[]; grids: Map<string, Uint8Array>; why: Map<string, PickWhy>; left: string[]; evidence: InferenceEvidence[]; model: string }> {
  const t0 = performance.now();
  const evidence: InferenceEvidence[] = [...a.progress.evidence];
  let picks = a.progress.picks;
  const skip = new Set(a.progress.skip);
  if (!picks) {
    const picked = await pickMoments(o.cfg, a.meter, a.lines, a.shares, a.via);
    evidence.push(...picked.evidence);
    picks = selectFrames(picked.moments, a.shares);
    await a.save({ picks, skip: [], evidence: [...evidence] });
    skip.clear();
    const cued = picks.filter((p) => p.why !== 'start' && p.why !== 'before').length;
    slog.info('screen moments picked', {
      noteId, recordingId, shares: a.shares.length, picked: picked.moments.length, cued, starts: picks.filter((p) => p.why === 'start').length,
      befores: picks.filter((p) => p.why === 'before').length, kept: picks.length, requests: picked.requests, unusable: picked.unusable, ms: Math.round(performance.now() - t0)
    });
  }
  const chosen = picks;
  const save = () => a.save({ picks: chosen, skip: [...skip], evidence: [...evidence] });
  const wanted = new Set(chosen.map((p) => pickKey(p.share, p.at)));

  // Frames kept for picks there are no longer are left out; picks without a frame are taken, a share's segment at a time.
  const before = (await framesOf(o, o.pool, noteId)).filter((f) => f.pick !== null);
  const have = new Set(before.map((f) => pickKey(f.share, f.at)));
  // Left out, but kept until the notes are saved: a new pick that takes the same image as one of them takes it over.
  const stale = new Map(before.filter((f) => !wanted.has(pickKey(f.share, f.at))).map((f) => [f.id, f]));
  const todo = chosen.filter((p) => !have.has(pickKey(p.share, p.at)) && !skip.has(pickKey(p.share, p.at)));
  const groups = new Map<string, FramePick[]>();
  for (const p of todo) groups.set(`${p.share}:${p.segment}`, [...(groups.get(`${p.share}:${p.segment}`) ?? []), p]);
  let taken = 0;
  for (const group of groups.values()) {
    const first = group[0];
    const seg = first ? a.shares.find((s) => s.id === first.share)?.segments.find((g) => g.segment === first.segment) : undefined;
    if (!first || !seg) continue;
    await a.renew();
    const ctx = { noteId, recordingId, shareId: first.share, segment: first.segment, frames: group.length };
    let got: TakenFrame[];
    try {
      const input = await videoInput(o, recordingId, first.share, first.segment);
      // The video's own time 0 is where the share's video starts in the recording.
      got = await takeFrames(input.data, input.mimeType, group.map((p) => p.at - seg.at));
    } catch (e) {
      if (!(e instanceof MediaError) && !(e instanceof IntegrityError)) throw e;
      slog.at(e instanceof IntegrityError ? 'error' : 'warn', 'frames couldn’t be taken from a shared screen’s video; left out of the notes', { ...ctx, err: e });
      for (const p of group) skip.add(pickKey(p.share, p.at));
      await save();
      continue;
    }
    // A change's frame is kept before the one to compare it with: when they're the same image, that one is the
    // duplicate, and the change is read alone.
    for (const p of [...group].sort((x, y) => Number(x.why === 'before') - Number(y.why === 'before'))) {
      const frame = got.find((x) => x.at === p.at - seg.at);
      // Past the end of the video, or the same image as a frame already kept: nothing more to take for it.
      const kept = frame ? await keepFrame(o, noteId, recordingId, { share: p.share, presenter: '', at: p.at, segment: p.segment, jpeg: frame.jpeg, grid: frame.grid, cue: p.cue, pick: p.why }) : null;
      const old = kept?.duplicate ? stale.get(kept.id) : undefined;
      if (old) {
        // The image of a frame left out: it's this pick's now, read again for what was said here.
        stale.delete(old.id);
        Object.assign(old, { at: p.at, segment: p.segment, cue: p.cue, pick: p.why, reading: null, relevance: null, model: null, grid: gridText(frame?.grid ?? null) });
        await sealInfo(o, noteId, old);
        taken++;
      } else if (!kept || kept.duplicate) skip.add(pickKey(p.share, p.at));
      else taken++;
    }
    await save();
  }

  // Read with the model chosen: every frame of a pick that it hasn't read yet. Unrelated ones are left out of the moments.
  const via = a.via;
  const frames = (await framesOf(o, o.pool, noteId)).filter((f) => f.pick !== null && wanted.has(pickKey(f.share, f.at)));
  const byKey = new Map(frames.map((f) => [pickKey(f.share, f.at), f]));
  // The frame each change is compared with, by its pick.
  const beforeOf = new Map(chosen.flatMap((p) => {
    const b = p.before === null ? undefined : byKey.get(pickKey(p.share, p.before));
    return b ? [[pickKey(p.share, p.at), b.id] as const] : [];
  }));
  const unread = frames.filter((f) => f.pick !== 'before' && (!f.reading || f.model !== via.model));
  const t1 = performance.now();
  for (let i = 0; i < unread.length; i += READ_AT_ONCE) {
    await a.renew();
    await Promise.all(unread.slice(i, i + READ_AT_ONCE).map(async (f) => {
      const r = await readOne(o, a.meter, noteId, recordingId, f, { at: f.at, cue: f.cue, why: f.pick ?? 'start', lines: a.lines }, via, beforeOf.get(pickKey(f.share, f.at)));
      f.reading = r.reading;
      f.relevance = r.relevance;
      f.model = via.model;
      if (r.evidence) evidence.push(r.evidence);
      await sealInfo(o, noteId, f);
    }));
    await save();
  }
  const by = (r: ScreenRelevance) => unread.filter((f) => f.relevance === r).length;
  if (unread.length || taken) {
    slog.info('shared screens read', {
      noteId, recordingId, taken, frames: unread.length, compared: unread.filter((f) => beforeOf.has(pickKey(f.share, f.at))).length, keyFrames: by('key'), supporting: by('supporting'), unrelated: by('unrelated'), model: via.model, ms: Math.round(performance.now() - t1)
    });
  }
  // Every frame: the ones the saved notes don't show go when they're saved.
  const left = [...stale.keys(), ...frames.map((f) => f.id)];
  return { shown: momentsOf(frames, a.shares), grids: gridsOf(frames), why: new Map(frames.flatMap((f) => (f.pick ? [[f.id, f.pick] as const] : []))), left, evidence, model: via.model };
}
