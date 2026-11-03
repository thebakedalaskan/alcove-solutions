/*
 * The live transcript of a note while it is being recorded (docs: notes-and-inference). The browser
 * sends a few seconds of speech at a time; each clip is transcribed and kept as one sealed row,
 * tagged with a keyed hash of where it starts in the recording, so a retried clip is stored (and
 * transcribed) once. When the recording stops, the lines move into the note and the rows go.
 */
import type { Speaker, TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { b64u, id128, mac, openJson, sealJson, stateKey, toJson, utf8 } from '../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../db';
import { transcribe } from '../inference';
import { log } from '../log';
import { segments } from './audio';

const tlog = log.child({ component: 'transcripts' });

/** How many of the latest lines a call or room recording shows while it's going. */
export const LIVE_LINES = 200;

/** Speech from the browser: where it starts in its segment (pauses not counted), and its WAV bytes. */
export interface Clip { segment: number; startMs: number; durationMs: number; wav: Uint8Array }
/** Where a clip's lines go: the recording it was part of, and the note being made from it. */
export interface Target { recordingId: string; noteId: string }

/** A line as kept. Who said it comes from the note when it's shown: the organizer in a call, nobody in particular in a room. */
const Line = z.object({ id: z.string(), at: z.number(), text: z.string() });
export type Line = z.infer<typeof Line>;
const Stored = z.object({ lines: z.array(Line) });

const key = (o: Owner, noteId: string) => stateKey(o.root, o.ownerId, `transcript:${noteId}`);
const tagOf = (o: Owner, noteId: string, segment: number, startMs: number) => mac(key(o, noteId), utf8(`clip:${segment}:${startMs}`));
const header = (o: Owner, noteId: string, tag: Uint8Array) => ({ v: 1 as const, kind: 'transcript-clip', ownerId: o.ownerId, noteId, tag: b64u(tag) });

/**
 * Transcribes one clip into a note's live transcript. A clip heard before is skipped; one that
 * comes back after the recording stopped is dropped, because its note has already been finished.
 */
export async function hear(o: Owner, t: Target, clip: Clip): Promise<void> {
  const tag = tagOf(o, t.noteId, clip.segment, clip.startMs);
  const ctx = { noteId: t.noteId, recordingId: t.recordingId, segment: clip.segment, startMs: clip.startMs, durationMs: clip.durationMs, bytes: clip.wav.length };
  const seen = await maybeOne(o.pool, z.object({ n: z.number() }), 'SELECT 1 AS n FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2 AND clip_tag = $3', [o.ownerId, t.noteId, tag]);
  if (seen) { tlog.debug('clip already transcribed', ctx); return; }
  // Lines are placed in the whole recording the way the note's player counts it: earlier segments first.
  const before = (await segments(o, t.recordingId)).filter((s) => s.index < clip.segment).reduce((n, s) => n + s.seconds, 0);
  const heard = await transcribe(o.cfg, clip.wav, clip.durationMs);
  const lines: Line[] = heard.map((x) => ({ id: id128(), at: Math.round((before + clip.startMs / 1000 + x.start) * 10) / 10, text: x.text }));
  const kept = await tx(o.pool, async (c) => {
    // Stopping takes this row's lock to move the transcript into the note. Sharing it here means
    // a clip either lands before the move, or sees the recording stopped and stays out.
    const r = await maybeOne(c, z.object({ state: z.string() }), 'SELECT state FROM recordings WHERE owner_id = $1 AND recording_id = $2 FOR SHARE', [o.ownerId, t.recordingId]);
    if (!r || r.state === 'stopped') return false;
    if (lines.length) {
      await exec(c, 'INSERT INTO transcript_clips (owner_id, note_item_id, clip_tag, clip_ciphertext) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [o.ownerId, t.noteId, tag, sealJson(key(o, t.noteId), header(o, t.noteId, tag), toJson({ lines }))]);
    }
    return true;
  });
  if (kept) tlog.debug('clip transcribed into the live transcript', { ...ctx, lines: lines.length });
  else tlog.info('clip arrived after the recording stopped; dropped', { ...ctx, lines: lines.length });
}

/** Every line heard so far for a note that's still recording, in order. */
export async function lines(o: Owner, db: Db, noteId: string): Promise<Line[]> {
  const found = await rows(db, z.object({ clip_tag: bytea, clip_ciphertext: bytea }), 'SELECT clip_tag, clip_ciphertext FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
  const k = key(o, noteId);
  return found.flatMap((r) => openJson(k, header(o, noteId, r.clip_tag), r.clip_ciphertext, Stored).lines).sort((a, b) => a.at - b.at);
}

/** Lines as the app shows them, said by `speaker` when anyone can tell. */
export const spoken = (ls: Line[], speaker: Speaker | undefined): TranscriptLine[] =>
  ls.map((l) => ({ id: l.id, at: l.at, ...(speaker ? { speaker } : {}), text: l.text }));

/** Removes a note's live transcript once its lines are in the note. */
export async function clear(o: Owner, db: Db, noteId: string): Promise<number> {
  return exec(db, 'DELETE FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
}
