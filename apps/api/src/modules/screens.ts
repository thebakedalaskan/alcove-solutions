/*
 * Shared screens in a call's notes (docs: Calls and recordings › Shared screens). Call media is end-to-end
 * encrypted, so only browsers see a share: while screen notes are on, the presenter's own browser sends a frame of its
 * own share when the screen has changed. Each frame is kept once, sealed: the image as an object under a random name,
 * under the recording's key like the audio; whose share it was, when, and later what the notes model read on it, in
 * its row, under the note's screen key. When the call ends its frames become the note's screen moments, each with the
 * stretch of the recording it was on screen. The notes worker has the private notes model read each one (images go
 * only sealed to its verified key), and the notes refer to them. Deleting the note deletes them all, objects included.
 */
import { ScreenLegibleSchema, ScreenRegionSchema, type AudioSegment, type CaptureGap, type ScreenFrameReceipt, type ScreenMoment, type Speaker } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { b64u, equalBytes, id128, mac, openJson, openRecord, sealJson, sealRecord, sha, stateKey, toJson, utf8, type RecordHeader } from '../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../db';
import { ConflictError, IntegrityError, InternalError, UnansweredError, UnverifiedError, notFound } from '../errors';
import { log } from '../log';
import { krecOf, queueDelete } from './audio';
import { recorded, type CaptureChange, type ScreenChange } from './capture';
import { readScreen } from './drafting';

const slog = log.child({ component: 'screens' });

/** How many frames the notes model reads at once while the notes are written. */
const READ_AT_ONCE = 4;
/** How long to wait before fetching a frame's image a second time. */
const FETCH_AGAIN_MS = 2_000;

/** What the notes model read on a frame: how legible it was, its title, the text on it, and the parts worth pointing at. */
export const Reading = z.object({ legible: ScreenLegibleSchema, title: z.string(), text: z.string(), regions: z.array(ScreenRegionSchema) });
export type Reading = z.infer<typeof Reading>;
const UNREAD: Reading = { legible: 'unread', title: '', text: '', regions: [] };
/**
 * A frame's sealed row: whose share (`presenter`, a participant ID; `share`, its LiveKit track ID), when it was taken
 * (seconds since the call started) and the recording's segment then, its size, and what the notes model read on it,
 * once it has.
 */
const Info = z.object({ presenter: z.string(), share: z.string(), at: z.number(), segment: z.number(), width: z.number(), height: z.number(), reading: Reading.nullable() });
type Info = z.infer<typeof Info>;
/** One frame of a note, opened. */
export type Frame = Info & { id: string };
const infoOf = (f: Frame): Info => ({ presenter: f.presenter, share: f.share, at: f.at, segment: f.segment, width: f.width, height: f.height, reading: f.reading });

/** A frame as its presenter's browser sent it, checked: their participant ID, the share, when, the segment, the JPEG and its size. */
export interface Upload { presenter: string; share: string; at: number; segment: number; jpeg: Uint8Array; width: number; height: number }
/** Where frames go: the note being made, and the recording whose key seals them. */
export interface Target { noteId: string; recordingId: string }

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

/** How many frames a note has kept. */
const countOf = async (o: Owner, db: Db, noteId: string) =>
  (await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM screen_frames WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]))?.n ?? 0;
/** Whether a note has kept as many frames as one call's notes may (`SCREEN_FRAMES_MAX`). */
export const full = async (o: Owner, db: Db, noteId: string) => (await countOf(o, db, noteId)) >= o.cfg.SCREEN_FRAMES_MAX;

/**
 * Keeps one frame of someone's share in a note, while its recording is taking things: the image sealed under the
 * recording's key as an object, read back and checked, then the row. The same frame again (a retry) is kept once and
 * answers with the ID it already has. A frame that arrives once the recording paused or stopped is refused, and its
 * object deleted. Once the note has as many frames as it may keep, it says `full` and keeps nothing.
 */
export async function keep(o: Owner, t: Target, f: Upload): Promise<ScreenFrameReceipt | 'full'> {
  const tag = tagOf(o, t.noteId, f.share, f.jpeg);
  const ctx = { noteId: t.noteId, recordingId: t.recordingId, segment: f.segment, bytes: f.jpeg.length, width: f.width, height: f.height };
  const same = () => maybeOne(o.pool, z.object({ frame_id: z.string() }), 'SELECT frame_id FROM screen_frames WHERE owner_id = $1 AND note_item_id = $2 AND frame_tag = $3', [o.ownerId, t.noteId, tag]);
  const seen = await same();
  if (seen) { slog.debug('frame already kept', ctx); return { id: seen.frame_id, duplicate: true }; }
  if (await full(o, o.pool, t.noteId)) { slog.info('frame refused: the notes have kept as many as they can', { ...ctx, max: o.cfg.SCREEN_FRAMES_MAX }); return 'full'; }

  const frameId = id128();
  const objectId = id128();
  const { krec, state } = await krecOf(o, t.recordingId);
  if (state !== 'recording') { krec.fill(0); throw new ConflictError('Notes aren’t recording right now.', { context: { ...ctx, state } }); }
  const ct = sealRecord(krec, imageHeader(o, t.recordingId, frameId, objectId), f.jpeg);
  krec.fill(0);
  await o.objects.put(objectId, ct);
  const back = await o.objects.get(objectId);
  const digest = sha(ct);
  if (back.length !== ct.length || !equalBytes(sha(back), digest)) {
    await queueDelete(o, [objectId]);
    throw new InternalError('The encrypted frame didn’t store correctly. It will be retried.', { context: { ...ctx, objectId, wrote: ct.length, readBack: back.length } });
  }
  const info: Info = { presenter: f.presenter, share: f.share, at: f.at, segment: f.segment, width: f.width, height: f.height, reading: null };
  let outcome: 'kept' | 'raced' | 'stopped';
  try {
    outcome = await tx(o.pool, async (c) => {
      // Pausing and stopping change the recording's row: holding it here, a frame either lands first or stays out.
      const r = await maybeOne(c, z.object({ state: z.string() }), 'SELECT state FROM recordings WHERE owner_id = $1 AND recording_id = $2 FOR SHARE', [o.ownerId, t.recordingId]);
      if (!r || r.state !== 'recording') return 'stopped';
      const n = await exec(c, `INSERT INTO screen_frames (owner_id, note_item_id, frame_id, frame_tag, object_id, cipher_sha256, cipher_bytes, info_ciphertext)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [o.ownerId, t.noteId, frameId, tag, objectId, digest, ct.length, sealJson(infoKey(o, t.noteId), infoHeader(o, t.noteId, frameId), toJson(info))]);
      if (n !== 1) return 'raced';
      await exec(c, 'UPDATE owners SET stored_bytes = stored_bytes + $2, version = version + 1 WHERE owner_id = $1', [o.ownerId, ct.length]);
      return 'kept';
    });
  } catch (e) {
    slog.warn('frame not recorded; deleting its object', { ...ctx, objectId, err: e });
    await queueDelete(o, [objectId]);
    throw e;
  }
  if (outcome === 'kept') { slog.debug('frame kept', { ...ctx, frameId, stored: ct.length }); return { id: frameId, duplicate: false }; }
  await queueDelete(o, [objectId]);
  if (outcome === 'stopped') throw new ConflictError('Notes aren’t recording right now.', { context: ctx });
  slog.info('frame raced a retry; keeping the first', ctx);
  return { id: (await same())?.frame_id ?? frameId, duplicate: true };
}

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
 * Has the private notes model read every frame of a note it hasn't read yet, a few at a time, and keeps each reading
 * in the frame's row as soon as it's made, so a job tried again carries on where it was. A frame whose reply can't be
 * used, twice, is kept as unread rather than guessed at. When the model's evidence doesn't check out, or it doesn't
 * answer, that's thrown: the notes wait. Returns every frame with what was read on it.
 */
export async function readAll(o: Owner, noteId: string, recordingId: string): Promise<Frame[]> {
  const frames = await framesOf(o, o.pool, noteId);
  const todo = frames.filter((f) => !f.reading);
  const t0 = performance.now();
  for (let i = 0; i < todo.length; i += READ_AT_ONCE) {
    await Promise.all(todo.slice(i, i + READ_AT_ONCE).map(async (f) => {
      f.reading = await readOne(o, noteId, recordingId, f);
      await exec(o.pool, 'UPDATE screen_frames SET info_ciphertext = $4 WHERE owner_id = $1 AND note_item_id = $2 AND frame_id = $3',
        [o.ownerId, noteId, f.id, sealJson(infoKey(o, noteId), infoHeader(o, noteId, f.id), toJson(infoOf(f)))]);
    }));
  }
  if (todo.length) {
    const by = (l: Reading['legible']) => todo.filter((f) => f.reading?.legible === l).length;
    slog.info('shared screens read', { noteId, frames: frames.length, read: todo.length, clear: by('clear'), partly: by('partly'), unreadable: by('unreadable'), unread: by('unread'), ms: Math.round(performance.now() - t0) });
  }
  return frames;
}
async function readOne(o: Owner, noteId: string, recordingId: string, f: Frame): Promise<Reading> {
  // One image never costs the notes: a frame that won't open, or that still can't be fetched on a second try (the
  // object store failing, or its object gone), is kept as unread and the notes carry on without it.
  let jpeg: Uint8Array | null = null;
  for (let tries = 1; !jpeg; tries++) {
    try {
      jpeg = await image(o, noteId, recordingId, f.id);
    } catch (e) {
      if (e instanceof IntegrityError) { slog.error('a frame failed its integrity check; kept as unread', { noteId, frameId: f.id, err: e }); return UNREAD; }
      if (tries >= 2) { slog.warn('a frame’s image couldn’t be fetched; kept as unread', { noteId, frameId: f.id, err: e }); return UNREAD; }
      await new Promise((r) => setTimeout(r, FETCH_AGAIN_MS));
    }
  }
  for (let tries = 1; ; tries++) {
    try {
      return await readScreen(o.cfg, jpeg);
    } catch (e) {
      if (e instanceof UnverifiedError || e instanceof UnansweredError) throw e;
      if (tries >= 2) { slog.warn('a frame couldn’t be read; kept as unread', { noteId, frameId: f.id, err: e }); return UNREAD; }
    }
  }
}

/**
 * Where a share stopped showing anything, `at` seconds into the call while the recording was in `segment`: its
 * presenter's browser said it ended (`share`), or the presenter's connection left the call, which ends every share of
 * theirs (`share` null).
 */
export const ShareEnd = z.object({ share: z.string().nullable(), presenter: z.string(), at: z.number(), segment: z.number().int() });
export type ShareEnd = z.infer<typeof ShareEnd>;
export interface Timeline {
  /** Notes on, off and paused, with the segment each started or ended. */
  history: CaptureChange[];
  /** Shared screens read, and stopped. */
  screens: ScreenChange[];
  ended: ShareEnd[];
  /** The stretches nothing was captured in, where they fall in the recording. */
  gaps: CaptureGap[];
  segments: AudioSegment[];
  /** How long the call lasted, in seconds. */
  duration: number;
  /** Who a participant ID is, as the notes name them. */
  presenterOf: (identity: string) => Speaker | undefined;
}

/**
 * A call's frames as its note's screen moments: each placed in the recording, on screen until its share's next
 * frame, its share ending (or its presenter leaving), screen notes stopping, notes pausing or going off, a stretch
 * with nothing captured, or the end of the recording. Whatever was read on each comes with it.
 */
export function moments(frames: Frame[], t: Timeline): ScreenMoment[] {
  const before = (segment: number) => t.segments.filter((g) => g.index < segment).reduce((n, g) => n + g.seconds, 0);
  const length = (segment: number) => t.segments.find((g) => g.index === segment)?.seconds ?? 0;
  /**
   * A moment of the call (seconds since it started) in the recording. In a segment with audio, as speech clips are
   * placed: from when the segment started, kept inside its audio. In one without (the organizer had no microphone),
   * as the call ran, less the stretches notes were paused or off.
   */
  const place = (at: number, segment: number): number => {
    const seconds = length(segment);
    if (!seconds) return Math.round(recorded(t.history, at, t.duration) * 10) / 10;
    const start = t.history.find((h) => h.status === 'on' && h.segment === segment)?.at;
    const into = start === undefined ? recorded(t.history, at, t.duration) : before(segment) + Math.max(0, at - start);
    return Math.round(Math.min(Math.max(into, before(segment)), before(segment) + Math.max(0, seconds - 0.1)) * 10) / 10;
  };
  const placed = frames.map((f) => ({ f, at: place(f.at, f.segment) }));
  const audio = t.segments.reduce((n, g) => n + g.seconds, 0);
  const called = recorded(t.history, t.duration, t.duration);
  // The recording ends with its audio; frames placed by the call's clock (no audio then) run to the call's end.
  const recordedEnd = placed.some((p) => !length(p.f.segment)) ? Math.max(audio, called) : audio || called;
  const stops = [
    ...t.screens.filter((c) => !c.on).map((c) => place(c.at, c.segment)),
    ...t.history.filter((h) => h.status !== 'on').map((h) => place(h.at, h.segment)),
    ...t.gaps.map((g) => g.at)
  ];
  // In recording order, which is how the notes model reads and numbers them.
  return placed.sort((a, b) => a.at - b.at || a.f.at - b.f.at).map(({ f, at }) => {
    const next = placed.find((p) => p.f.presenter === f.presenter && p.f.share === f.share && p.f.at > f.at)?.at;
    const end = t.ended.find((e) => e.presenter === f.presenter && (e.share === null || e.share === f.share) && e.at >= f.at);
    const until = Math.min(recordedEnd, ...[next, end ? place(end.at, end.segment) : undefined, ...stops].filter((x): x is number => x !== undefined && x > at));
    const r = f.reading ?? UNREAD;
    const presenter = t.presenterOf(f.presenter);
    return {
      id: f.id, at, until: Math.max(at, Math.round(until * 10) / 10), ...(presenter ? { presenter } : {}), share: f.share, width: f.width, height: f.height,
      legible: r.legible, title: r.title, text: r.text, description: '', regions: r.regions
    };
  });
}

/** A note's screen moments with what the notes model has read on each frame since. */
export function withReadings(shown: ScreenMoment[], frames: Frame[]): ScreenMoment[] {
  const read = new Map(frames.map((f) => [f.id, f.reading]));
  return shown.map((m) => {
    const r = read.get(m.id);
    return r ? { ...m, legible: r.legible, title: r.title, text: r.text, regions: r.regions } : m;
  });
}
