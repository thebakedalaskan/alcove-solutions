/*
 * What a request carries for a recording, read from it: a piece of audio, a piece of a shared screen's video and a clip of
 * speech, each with the headers that say where it falls, and which bytes of a shared screen's video it asks for.
 */
import { AUDIO_HEADERS, MAX_AUDIO_PIECE_BYTES, MAX_TRANSCRIPT_CLIP_BYTES, MAX_TRANSCRIPT_CLIP_MS, MAX_VIDEO_PIECE_BYTES, VIDEO_HEADERS } from '@alcove/api';
import { type Context } from 'hono';
import { ValidationError } from '../../platform/errors';
import { position } from '../../http/body';
import * as audioMod from './audio';
import { videoType } from './ffmpeg';
import * as screens from './screens/screens';
import type { Clip } from './transcripts';

/** Reads a raw audio piece and its position headers. */
export async function piece(c: Context): Promise<audioMod.Piece> {
  const num = (name: string) => position(c, name);
  const mimeType = c.req.header('content-type') ?? '';
  if (!/^audio\/(webm|mp4|ogg)/.test(mimeType)) throw new ValidationError('Audio must be WebM, MP4 or Ogg.');
  if (Number(c.req.header('content-length') ?? 0) > MAX_AUDIO_PIECE_BYTES) throw new ValidationError('That piece of audio is empty or too large.');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_PIECE_BYTES) throw new ValidationError('That piece of audio is empty or too large.');
  return { segment: num(AUDIO_HEADERS.segment), seq: num(AUDIO_HEADERS.seq), atMs: num(AUDIO_HEADERS.at), durationMs: num(AUDIO_HEADERS.duration), mimeType, bytes };
}

/** Reads a raw piece of a shared screen's video and its position headers (the share is in the path). */
export async function videoPiece(c: Context): Promise<screens.Piece> {
  const num = (name: string) => position(c, name);
  const mimeType = c.req.header('content-type') ?? '';
  if (!videoType(mimeType) || mimeType.length > 200) throw new ValidationError('A shared screen’s video must be WebM or MP4.');
  if (Number(c.req.header('content-length') ?? 0) > MAX_VIDEO_PIECE_BYTES) throw new ValidationError('That piece of video is empty or too large.');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_VIDEO_PIECE_BYTES) throw new ValidationError('That piece of video is empty or too large.', { context: { bytes: bytes.length } });
  return { segment: num(VIDEO_HEADERS.segment), seq: num(VIDEO_HEADERS.seq), atMs: num(VIDEO_HEADERS.at), durationMs: num(VIDEO_HEADERS.duration), mimeType, bytes };
}

/**
 * An HTTP Range header, as one range of bytes of a shared screen's video: null without one, 'bad' for one this API
 * doesn't serve (more than one range, or not bytes). `bytes=-N` is the last N bytes.
 */
export function videoByteRange(h: string | undefined): screens.ByteRange | null | 'bad' {
  if (h === undefined) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m) return 'bad';
  const [, a = '', b = ''] = m;
  if (a === '' && b === '') return 'bad';
  if (a === '') return { start: null, end: Number(b) };
  const start = Number(a);
  const end = b === '' ? null : Number(b);
  if (!Number.isSafeInteger(start) || (end !== null && (!Number.isSafeInteger(end) || end < start))) return 'bad';
  return { start, end };
}

/** True for the WAV the live transcript takes: uncompressed 16-bit PCM, one channel, 16 kHz. */
function isSpeechWav(b: Uint8Array): boolean {
  if (b.length < 44) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (at: number) => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
  return tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 16_000 && v.getUint16(34, true) === 16;
}

/** Reads a transcript clip: 16 kHz mono WAV, and where it starts in its segment. */
export async function clip(c: Context): Promise<Clip> {
  const num = (name: string) => position(c, name);
  if (!/^audio\/(?:wav|x-wav|wave)\b/.test((c.req.header('content-type') ?? '').toLowerCase())) throw new ValidationError('Speech for the transcript must be WAV audio.');
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_TRANSCRIPT_CLIP_BYTES) throw new ValidationError('That clip of speech is too long.', { context: { bytes: declared } });
  const wav = new Uint8Array(await c.req.arrayBuffer());
  if (wav.length <= 44 || wav.length > MAX_TRANSCRIPT_CLIP_BYTES) throw new ValidationError('That clip of speech is empty or too long.', { context: { bytes: wav.length } });
  if (!isSpeechWav(wav)) throw new ValidationError('Speech for the transcript must be 16 kHz mono 16-bit WAV.', { context: { bytes: wav.length } });
  const durationMs = num(AUDIO_HEADERS.duration);
  if (durationMs > MAX_TRANSCRIPT_CLIP_MS) throw new ValidationError('That clip of speech is too long.', { context: { durationMs } });
  return { segment: num(AUDIO_HEADERS.segment), atMs: num(AUDIO_HEADERS.at), durationMs, wav };
}
