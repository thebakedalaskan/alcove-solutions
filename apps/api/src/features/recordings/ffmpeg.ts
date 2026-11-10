/*
 * ffmpeg, for shared screens' video (docs: Calls and recordings › Shared screens). It only ever runs with pipes:
 * decrypted video goes in on stdin and comes out on stdout, so nothing readable touches a disk. Two jobs:
 *
 *  - remux: the pieces a presenter's browser recorded, joined into one video that a browser can seek, without
 *    re-encoding (`-c copy`). Writing to a pipe, ffmpeg can't go back to write a WebM's index (its Cues) or its
 *    duration, so they're added here: the clusters it wrote are copied behind a new header that has both. MP4 comes
 *    out fragmented, with the fragment index (mfra) ffmpeg writes at the end.
 *  - frames: decodes a video and gives back JPEGs (at most 1600 px across) at the moments asked for, each with the
 *    same frame on a 48 × 27 grey grid (screenGrid.ts), from the same pass, for telling whether the screen changed.
 *
 * The binary is ffmpeg-static's (pinned in package.json), or FFMPEG_PATH where the bundle runs without node_modules
 * (the Dockerfile copies the same binary into the image). Logs carry sizes, counts, durations and exit codes only.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { MediaError } from '../../errors';
import { log } from '../../log';
import { GRID_BYTES, GRID_H, GRID_W } from './screenGrid';

const flog = log.child({ component: 'ffmpeg' });

/** The video types shared screens are recorded, stored and replayed in. */
export const VIDEO_TYPES = ['video/webm', 'video/mp4'] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];
/** A MIME type (codecs and all) as one of VIDEO_TYPES, or null. */
export function videoType(mime: string): VideoType | null {
  const base = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  return VIDEO_TYPES.find((t) => t === base) ?? null;
}

let resolved: string | null = null;
/** The ffmpeg binary: FFMPEG_PATH, or ffmpeg-static's. */
function binary(): string {
  if (resolved) return resolved;
  const fromEnv = process.env['FFMPEG_PATH'];
  const found = fromEnv || z.string().nullable().parse(createRequire(import.meta.url)('ffmpeg-static'));
  if (!found) throw new MediaError(undefined, { context: { why: 'no ffmpeg binary for this platform' } });
  resolved = found;
  return found;
}

/**
 * Runs ffmpeg with `args`, writing `input` to its stdin (with backpressure) and handing each chunk of stdout to
 * `out`, and of its fourth pipe (`pipe:3`, a second output) to `side`, when given. Resolves once it exits cleanly. ffmpeg's own failures are a MediaError with its exit code; `input` failing
 * (the object store, an integrity check) stops ffmpeg and is thrown as it is, so the job tries again rather than
 * taking the video for one that can't be read.
 */
async function run(what: string, args: string[], input: AsyncIterable<Uint8Array>, out: (chunk: Uint8Array) => void, side?: ((chunk: Uint8Array) => void) | undefined): Promise<{ inBytes: number; outBytes: number; ms: number }> {
  const t0 = performance.now();
  const p = spawn(binary(), ['-hide_banner', '-loglevel', 'error', ...args], { stdio: side ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
  let inBytes = 0;
  let outBytes = 0;
  let errBytes = 0;
  p.stdout.on('data', (c: Buffer) => { outBytes += c.length; out(new Uint8Array(c.buffer, c.byteOffset, c.length)); });
  const extra = p.stdio[3];
  if (side && extra instanceof Readable) extra.on('data', (c: Buffer) => { outBytes += c.length; side(new Uint8Array(c.buffer, c.byteOffset, c.length)); });
  // ffmpeg's own messages are read and dropped: only how much it said is logged.
  p.stderr.on('data', (c: Buffer) => { errBytes += c.length; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code, signal) => resolve({ code, signal }));
  });
  // Observed now: `exited` can reject (e.g. ENOENT) while `feed` is still awaited; the await below still sees the rejection.
  exited.catch(() => undefined);
  // One listener for every wait on stdin below: ffmpeg gone means nothing more will drain.
  let gone = false;
  let wake: (() => void) | null = null;
  p.once('close', () => { gone = true; wake?.(); });
  // If ffmpeg stops reading (it failed), writing gives EPIPE: its exit code says what happened.
  p.stdin.on('error', () => undefined);
  const feed = (async () => {
    try {
      // Once ffmpeg is gone nothing reads what comes next, so the input stops being pulled (and fetched, and decrypted).
      for await (const chunk of input) {
        if (gone || p.stdin.destroyed) break;
        inBytes += chunk.length;
        if (!p.stdin.write(chunk) && !gone) {
          await new Promise<void>((resolve) => { wake = resolve; p.stdin.once('drain', resolve); });
          wake = null;
          if (gone || p.stdin.destroyed) break;
        }
      }
    } finally {
      p.stdin.end();
    }
  })();
  const fed: unknown[] = [];
  await feed.catch((e: unknown) => { fed.push(e); p.kill('SIGKILL'); });
  const { code, signal } = await exited.catch((e: unknown) => { throw new MediaError(undefined, { cause: e, context: { what } }); });
  const ms = Math.round(performance.now() - t0);
  if (fed.length) {
    flog.debug('ffmpeg stopped: its input failed', { what, inBytes, ms, err: fed[0] });
    throw fed[0];
  }
  if (code !== 0) throw new MediaError(undefined, { context: { what, code, signal, inBytes, outBytes, errBytes, ms } });
  return { inBytes, outBytes, ms };
}

/**
 * A video held as the pieces it was made of, in order, so it's never copied whole again to be cut into chunks:
 * `length` is all of them together.
 */
export interface Video { parts: Uint8Array[]; length: number }
/** Bytes `from` to `to` (exclusive) of a video: a view when one part holds them, otherwise copied from the parts that do. */
export function videoSlice(v: Video, from: number, to: number): Uint8Array {
  const end = Math.min(to, v.length);
  const out = new Uint8Array(Math.max(0, end - from));
  let at = 0;
  for (const p of v.parts) {
    const next = at + p.length;
    if (next > from && at < end) {
      if (at <= from && next >= end) return p.subarray(from - at, end - at);
      const s = Math.max(from, at);
      out.set(p.subarray(s - at, Math.min(end, next) - at), s - from);
    }
    at = next;
    if (at >= end) break;
  }
  return out;
}

/**
 * Joins one share's recorded pieces (a single WebM or fragmented MP4 stream, cut where the browser cut it) into one
 * video a browser can seek, without re-encoding: a WebM with its index and duration, or a fragmented MP4 with its
 * fragment index.
 */
export async function remux(input: AsyncIterable<Uint8Array>, mime: string): Promise<Video> {
  const type = videoType(mime);
  if (!type) throw new MediaError(undefined, { context: { what: 'remux', why: 'type' } });
  const parts: Uint8Array[] = [];
  const args = type === 'video/webm'
    ? ['-i', 'pipe:0', '-map', '0:v:0', '-c', 'copy', '-f', 'webm', 'pipe:1']
    : ['-i', 'pipe:0', '-map', '0:v:0', '-c', 'copy', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1'];
  const r = await run('remux', args, input, (c) => parts.push(c));
  let out: Uint8Array[] = parts;
  if (type === 'video/webm') {
    // The WebM is read whole to be indexed; ffmpeg's own pieces go as soon as they're joined, and the clusters are
    // kept as views of that one copy.
    const joined = Buffer.concat(parts);
    parts.length = 0;
    out = seekableWebm(new Uint8Array(joined.buffer, joined.byteOffset, joined.length));
  }
  const video = { parts: out, length: out.reduce((n, x) => n + x.length, 0) };
  flog.debug('video remuxed', { type, inBytes: r.inBytes, outBytes: video.length, ms: r.ms });
  return video;
}

/**
 * A frame taken from a video: when (seconds into the video, as asked), the JPEG, and the same frame on the grey grid
 * (GRID_W × GRID_H bytes; null if ffmpeg didn't draw it).
 */
export interface TakenFrame { at: number; jpeg: Uint8Array; grid: Uint8Array | null }
/** Frames are taken on a grid this fine: a moment is the frame showing at the nearest tenth of a second. */
const GRID = 10;

/**
 * Decodes a video and takes a JPEG of what it showed at each of `at` (seconds into the video), at most `maxWidth`
 * pixels across, and the same frame on the grey grid (each cell the mean of its area, so one stray pixel moves
 * little), from the same pass. Moments past the end of the video get nothing; moments on the same tenth of a second
 * share a frame. In the order asked.
 */
export async function frames(input: AsyncIterable<Uint8Array>, mime: string, at: number[], maxWidth = 1600): Promise<TakenFrame[]> {
  if (!videoType(mime)) throw new MediaError(undefined, { context: { what: 'frames', why: 'type' } });
  const slots = [...new Set(at.filter((t) => Number.isFinite(t) && t >= 0).map((t) => Math.round(t * GRID)))].sort((a, b) => a - b);
  if (!slots.length) return [];
  // A constant grid first (a still screen sends few frames, so each moment needs the one showing then), then the
  // grid's frames that were asked for: each as a JPEG on stdout, and on the grey grid on the fourth pipe.
  const pick = slots.map((n) => `eq(n\\,${n})`).join('+');
  const width = Math.max(16, Math.round(maxWidth));
  const graph = `[0:v:0]fps=fps=${GRID}:start_time=0,select='${pick}',split=2[a][b];[a]scale=w='min(${width}\\,iw)':h=-2[jpeg];`
    + `[b]scale=w=${GRID_W}:h=${GRID_H}:flags=area,format=gray[grid]`;
  const args = ['-i', 'pipe:0', '-filter_complex', graph,
    '-map', '[jpeg]', '-fps_mode', 'passthrough', '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe', 'pipe:1',
    '-map', '[grid]', '-fps_mode', 'passthrough', '-c:v', 'rawvideo', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:3'];
  const jpegs: Uint8Array[] = [];
  const split = jpegSplitter((j) => jpegs.push(j));
  const grey: Buffer[] = [];
  const r = await run('frames', args, input, split, (c) => grey.push(Buffer.from(c)));
  const grids = Buffer.concat(grey);
  // Frames come out in grid order, and stop at the end of the video: the first ones asked for are the ones there.
  const bySlot = new Map(slots.slice(0, jpegs.length).map((n, i) => {
    const grid = (i + 1) * GRID_BYTES <= grids.length ? Uint8Array.from(grids.subarray(i * GRID_BYTES, (i + 1) * GRID_BYTES)) : null;
    return [n, { jpeg: jpegs[i], grid }];
  }));
  const out = at.flatMap((t) => {
    const f = bySlot.get(Math.round(t * GRID));
    return f?.jpeg ? [{ at: t, jpeg: f.jpeg, grid: f.grid }] : [];
  });
  flog.debug('frames taken', { asked: at.length, taken: jpegs.length, grids: Math.floor(grids.length / GRID_BYTES), inBytes: r.inBytes, outBytes: r.outBytes, ms: r.ms });
  return out;
}

/**
 * Splits ffmpeg's MJPEG stream into JPEGs, at each image's start (FFD8) and end (FFD9) markers. Inside the image data
 * a 0xFF byte is always followed by 0x00 or a restart marker, so an end marker is always the image's end.
 */
function jpegSplitter(emit: (jpeg: Uint8Array) => void): (chunk: Uint8Array) => void {
  // Chunks of the image being read (or of the bytes before the next start), and whether the last byte seen was 0xFF.
  let held: Uint8Array[] = [];
  let inImage = false;
  let ff = false;
  return (chunk) => {
    let from = 0; // where the part of this chunk still to be kept begins
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      if (ff) {
        ff = false;
        if (!inImage && byte === 0xd8) {
          // The 0xFF before it may be in an earlier chunk, so it's carried on its own.
          inImage = true;
          held = [Uint8Array.of(0xff)];
          from = i;
          continue;
        }
        if (inImage && byte === 0xd9) {
          emit(Buffer.concat([...held, chunk.subarray(from, i + 1)]));
          held = [];
          inImage = false;
          from = i + 1;
          continue;
        }
      }
      if (byte === 0xff) ff = true;
    }
    if (inImage) held.push(chunk.subarray(from));
  };
}

/* ---------- WebM: the clusters ffmpeg wrote, behind a header with their index (Cues) and the duration ---------- */

const ID = { segment: 0x18538067, seekHead: 0x114d9b74, seek: 0x4dbb, seekId: 0x53ab, seekPosition: 0x53ac, info: 0x1549a966, timecodeScale: 0x2ad7b1,
  duration: 0x4489, tracks: 0x1654ae6b, trackEntry: 0xae, trackNumber: 0xd7, trackType: 0x83, defaultDuration: 0x23e383, tags: 0x1254c367, cues: 0x1c53bb6b,
  cuePoint: 0xbb, cueTime: 0xb3, cueTrackPositions: 0xb7, cueTrack: 0xf7, cueClusterPosition: 0xf1, cluster: 0x1f43b675, timecode: 0xe7, simpleBlock: 0xa3,
  blockGroup: 0xa0, block: 0xa1, referenceBlock: 0xfb, blockDuration: 0x9b } as const;

interface El { id: number; idBytes: Uint8Array; start: number; body: number; end: number; unknown: boolean }
const bad = (why: string, at?: number | undefined) => new MediaError(undefined, { context: { what: 'webm', why, ...(at === undefined ? {} : { at }) } });

/** One EBML element at `i`: its ID, where its body starts and ends (the end of `limit` when its size is unknown). */
function element(b: Uint8Array, i: number, limit: number): El {
  const first = b[i];
  if (first === undefined || first === 0) throw bad('id', i);
  const idLen = Math.clz32(first) - 23;
  if (idLen > 4 || i + idLen > limit) throw bad('id', i);
  let id = 0;
  for (let k = 0; k < idLen; k++) id = id * 256 + (b[i + k] ?? 0);
  const s = i + idLen;
  const lead = b[s];
  if (lead === undefined || lead === 0) throw bad('size', s);
  const sizeLen = Math.clz32(lead) - 23;
  let size = lead & (0xff >> sizeLen);
  let allOnes = size === 0xff >> sizeLen;
  for (let k = 1; k < sizeLen; k++) {
    const x = b[s + k] ?? 0;
    if (x !== 0xff) allOnes = false;
    size = size * 256 + x;
  }
  const body = s + sizeLen;
  const end = allOnes ? limit : body + size;
  if (end > limit) throw bad('truncated', i);
  return { id, idBytes: b.slice(i, s), start: i, body, end, unknown: allOnes };
}
function* children(b: Uint8Array, from: number, to: number): Generator<El> {
  for (let i = from; i < to;) {
    const e = element(b, i, to);
    yield e;
    i = e.end;
  }
}
const uint = (b: Uint8Array, e: El) => { let v = 0; for (let i = e.body; i < e.end; i++) v = v * 256 + (b[i] ?? 0); return v; };
function float(b: Uint8Array, e: El): number {
  const v = new DataView(b.buffer, b.byteOffset + e.body, e.end - e.body);
  return e.end - e.body === 4 ? v.getFloat32(0) : v.getFloat64(0);
}

/** EBML writing, every size and number 8 bytes wide, so how big a part is never depends on the numbers in it. */
const idOf = (id: number) => { const out: number[] = []; for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff); return Uint8Array.from(out); };
function size8(n: number): Uint8Array { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, BigInt(n)); out[0] = 0x01; return out; }
const master = (id: number, ...body: Uint8Array[]) => Buffer.concat([idOf(id), size8(body.reduce((n, x) => n + x.length, 0)), ...body]);
function uint8(id: number, v: number): Uint8Array { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, BigInt(Math.max(0, Math.round(v)))); return master(id, out); }
function float8(id: number, v: number): Uint8Array { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, v); return master(id, out); }

/** A cluster as copied: where it is in ffmpeg's output, and the time of each video keyframe in it (in timecode units). */
interface Cluster { start: number; end: number; keys: number[] }

/**
 * ffmpeg's WebM, written to a pipe, rebuilt so a browser can seek it: the same EBML header, Info (with Duration), Tracks
 * and Tags, then Cues pointing at every cluster with a video keyframe, a SeekHead pointing at all of them, and the
 * clusters as they were. Anything else (Void, the old SeekHead) is dropped. In order, as the pieces it's made of: the
 * new parts, then each cluster as a view of `b`.
 */
function seekableWebm(b: Uint8Array): Uint8Array[] {
  const top = [...children(b, 0, b.length)];
  const header = top.find((e) => e.id === 0x1a45dfa3);
  const segment = top.find((e) => e.id === ID.segment);
  if (!header || !segment) throw bad('no segment');
  let scale = 1_000_000;
  const infoKept: Uint8Array[] = [];
  let tracks: Uint8Array | null = null;
  let tags: Uint8Array | null = null;
  let video: number | null = null;
  let frameNs: number | null = null;
  const clusters: Cluster[] = [];
  let last = 0;
  let lastDuration = 0;
  const gaps: number[] = [];
  let prevTime: number | null = null;
  for (let i = segment.body; i < segment.end;) {
    const e = element(b, i, segment.end);
    i = e.end;
    if (e.id === ID.info) {
      for (const c of children(b, e.body, e.end)) {
        if (c.id === ID.timecodeScale) scale = uint(b, c) || scale;
        if (c.id !== ID.duration) infoKept.push(b.slice(c.start, c.end));
      }
    } else if (e.id === ID.tracks) {
      tracks = b.slice(e.start, e.end);
      for (const t of children(b, e.body, e.end)) {
        if (t.id !== ID.trackEntry) continue;
        let number: number | null = null;
        let type: number | null = null;
        let def: number | null = null;
        for (const f of children(b, t.body, t.end)) {
          if (f.id === ID.trackNumber) number = uint(b, f);
          if (f.id === ID.trackType) type = uint(b, f);
          if (f.id === ID.defaultDuration) def = uint(b, f);
        }
        if (type === 1 && number !== null && video === null) { video = number; frameNs = def; }
      }
    } else if (e.id === ID.tags) {
      tags = b.slice(e.start, e.end);
    } else if (e.id === ID.cluster) {
      if (e.unknown) throw bad('cluster size unknown', e.start);
      let time = 0;
      const keys: number[] = [];
      for (const c of children(b, e.body, e.end)) {
        if (c.id === ID.timecode) { time = uint(b, c); continue; }
        let block: El | null = null;
        let key = false;
        let dur: number | null = null;
        if (c.id === ID.simpleBlock) { block = c; key = ((b[blockFlags(b, c)] ?? 0) & 0x80) !== 0; }
        if (c.id === ID.blockGroup) {
          key = true;
          for (const g of children(b, c.body, c.end)) {
            if (g.id === ID.block) block = g;
            if (g.id === ID.referenceBlock) key = false;
            if (g.id === ID.blockDuration) dur = uint(b, g);
          }
        }
        if (!block) continue;
        const { track, rel } = blockHead(b, block);
        if (track !== video) continue;
        const t = time + rel;
        if (key) keys.push(t);
        if (prevTime !== null && t > prevTime) gaps.push(t - prevTime);
        prevTime = t;
        if (t >= last) { last = t; lastDuration = dur ?? 0; }
      }
      clusters.push({ start: e.start, end: e.end, keys });
    }
  }
  if (video === null || !tracks || !clusters.length) throw bad('no video');
  // How long the last frame shows: its own duration, the track's frame rate, or the typical gap between frames.
  const typical = gaps.length ? [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)] ?? 0 : 0;
  const tail = lastDuration || (frameNs ? frameNs / scale : 0) || typical || Math.round(100_000_000 / scale);
  const info = master(ID.info, ...infoKept, float8(ID.duration, last + tail));

  // Every size below is fixed by how many entries there are, not by the numbers in them: lay out, then fill in.
  const cued = clusters.filter((c) => c.keys.length);
  const cuesFor = (firstCluster: number) => {
    let at = firstCluster;
    const points: Uint8Array[] = [];
    for (const c of clusters) {
      const k = c.keys[0];
      if (k !== undefined) points.push(master(ID.cuePoint, uint8(ID.cueTime, k), master(ID.cueTrackPositions, uint8(ID.cueTrack, video ?? 1), uint8(ID.cueClusterPosition, at))));
      at += c.end - c.start;
    }
    return master(ID.cues, ...points);
  };
  const parts = [info, tracks, ...(tags ? [tags] : []), cuesFor(0)];
  const seekFor = (positions: number[]) => master(ID.seekHead, ...parts.map((p, i) => master(ID.seek, master(ID.seekId, idBytesOf(p)), uint8(ID.seekPosition, positions[i] ?? 0))));
  const headSize = seekFor(parts.map(() => 0)).length;
  const positions: number[] = [];
  let at = headSize;
  for (const p of parts) { positions.push(at); at += p.length; }
  const cues = cuesFor(at);
  if (cues.length !== parts[parts.length - 1]?.length) throw bad('cues size');
  parts[parts.length - 1] = cues;
  const head = seekFor(positions);
  const body = [head, ...parts, ...clusters.map((c) => b.subarray(c.start, c.end))];
  const segmentSize = body.reduce((n, x) => n + x.length, 0);
  const out = [b.subarray(header.start, header.end), idOf(ID.segment), size8(segmentSize), ...body];
  flog.debug('webm indexed', { clusters: clusters.length, cues: cued.length, bytes: out.reduce((n, x) => n + x.length, 0) });
  return out;
}
/** The ID bytes an element starts with. */
function idBytesOf(p: Uint8Array): Uint8Array {
  const first = p[0] ?? 0;
  return p.slice(0, Math.clz32(first) - 23);
}
/** A block's track number and its time relative to its cluster. */
function blockHead(b: Uint8Array, e: El): { track: number; rel: number } {
  const lead = b[e.body] ?? 0;
  const len = Math.clz32(lead) - 23;
  let track = lead & (0xff >> len);
  for (let k = 1; k < len; k++) track = track * 256 + (b[e.body + k] ?? 0);
  const t = e.body + len;
  const rel = new DataView(b.buffer, b.byteOffset + t, 2).getInt16(0);
  return { track, rel };
}
/** Where a SimpleBlock's flags byte is. */
const blockFlags = (b: Uint8Array, e: El) => e.body + (Math.clz32(b[e.body] ?? 0) - 23) + 2;

/** A video's duration in seconds, from a WebM's Info, for checking what was stored. Null when it says none. */
export function webmDuration(b: Uint8Array): number | null {
  const segment = [...children(b, 0, b.length)].find((e) => e.id === ID.segment);
  if (!segment) return null;
  for (let i = segment.body; i < segment.end;) {
    const e = element(b, i, segment.end);
    i = e.end;
    if (e.id !== ID.info) continue;
    let scale = 1_000_000;
    let d: number | null = null;
    for (const c of children(b, e.body, e.end)) {
      if (c.id === ID.timecodeScale) scale = uint(b, c) || scale;
      if (c.id === ID.duration) d = float(b, c);
    }
    return d === null ? null : (d * scale) / 1e9;
  }
  return null;
}
