/*
 * The live transcript of a note while it is being recorded (docs: notes-and-inference). The browser
 * sends a few seconds of speech at a time; each clip is transcribed and kept as one sealed row, even
 * when nothing in it survived the filter, tagged with a keyed hash of where it starts in the recording,
 * so a retried clip is stored (and transcribed) once. Each row also keeps the evidence of the verified
 * model the clip was sent to. When the recording stops, the lines and that evidence move into the note
 * and the rows go.
 */
import { InferenceEvidenceSchema, type InferenceEvidence, type Speaker, type TranscriptLine } from '@alcove/api';
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
const Stored = z.object({ lines: z.array(Line), evidence: InferenceEvidenceSchema });

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
  const { heard, evidence } = await transcribe(o.cfg, clip.wav, clip.durationMs);
  const lines: Line[] = heard.map((x) => ({ id: id128(), at: Math.round((before + clip.startMs / 1000 + x.start) * 10) / 10, text: x.text }));
  const kept = await tx(o.pool, async (c) => {
    // Stopping takes this row's lock to move the transcript into the note. Sharing it here means
    // a clip either lands before the move, or sees the recording stopped and stays out.
    const r = await maybeOne(c, z.object({ state: z.string() }), 'SELECT state FROM recordings WHERE owner_id = $1 AND recording_id = $2 FOR SHARE', [o.ownerId, t.recordingId]);
    if (!r || r.state === 'stopped') return false;
    // Kept even without lines: the note says which verified models everything said in it went to.
    await exec(c, 'INSERT INTO transcript_clips (owner_id, note_item_id, clip_tag, clip_ciphertext) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [o.ownerId, t.noteId, tag, sealJson(key(o, t.noteId), header(o, t.noteId, tag), toJson({ lines, evidence }))]);
    return true;
  });
  if (kept) tlog.debug('clip transcribed into the live transcript', { ...ctx, lines: lines.length });
  else tlog.info('clip arrived after the recording stopped; dropped', { ...ctx, lines: lines.length });
}

async function clips(o: Owner, db: Db, noteId: string): Promise<z.infer<typeof Stored>[]> {
  const found = await rows(db, z.object({ clip_tag: bytea, clip_ciphertext: bytea }), 'SELECT clip_tag, clip_ciphertext FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
  const k = key(o, noteId);
  return found.map((r) => openJson(k, header(o, noteId, r.clip_tag), r.clip_ciphertext, Stored));
}

/** Every line heard so far for a note that's still recording, in order. */
export async function lines(o: Owner, db: Db, noteId: string): Promise<Line[]> {
  return (await clips(o, db, noteId)).flatMap((c) => c.lines).sort((a, b) => a.at - b.at);
}

/**
 * The verified models a note's speech went to: each verification once, the first time it was used.
 * Checking the same model again (every few minutes while in use) is the same verification unless its
 * key, its OS image, its measured configuration or the gateway's changed.
 */
export async function heardBy(o: Owner, db: Db, noteId: string): Promise<InferenceEvidence[]> {
  const same = (e: InferenceEvidence) => [e.model, e.key, e.os, e.compose, e.tdx.status, e.gateway.os, e.gateway.compose, e.gateway.status].join('|');
  const first = new Map<string, InferenceEvidence>();
  for (const { evidence } of (await clips(o, db, noteId)).sort((a, b) => a.evidence.verifiedAt.localeCompare(b.evidence.verifiedAt))) {
    if (!first.has(same(evidence))) first.set(same(evidence), evidence);
  }
  return [...first.values()];
}

/** Lines as the app shows them, said by `speaker` when anyone can tell. */
export const spoken = (ls: Line[], speaker: Speaker | undefined): TranscriptLine[] =>
  ls.map((l) => ({ id: l.id, at: l.at, ...(speaker ? { speaker } : {}), text: l.text }));

/** Removes a note's live transcript, and its lines in other languages, once its lines are in the note. */
export async function clear(o: Owner, db: Db, noteId: string): Promise<number> {
  await exec(db, 'DELETE FROM transcript_translations WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
  return exec(db, 'DELETE FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
}

/* ---------- the live transcript in other languages ---------- */

const Translated = z.object({ lineId: z.string(), language: z.string(), text: z.string() });
const lineTag = (o: Owner, noteId: string, lineId: string, language: string) => mac(key(o, noteId), utf8(`translation:${lineId}:${language}`));
const translationHeader = (o: Owner, noteId: string, tag: Uint8Array) => ({ v: 1 as const, kind: 'transcript-translation', ownerId: o.ownerId, noteId, tag: b64u(tag) });

/** Lines of a note's live transcript already translated into `language`, by line ID. */
export async function translations(o: Owner, noteId: string, lineIds: string[], language: string): Promise<Map<string, string>> {
  const tags = lineIds.map((id) => Buffer.from(lineTag(o, noteId, id, language)));
  const found = await rows(o.pool, z.object({ line_tag: bytea, translation_ciphertext: bytea }),
    'SELECT line_tag, translation_ciphertext FROM transcript_translations WHERE owner_id = $1 AND note_item_id = $2 AND line_tag = ANY($3::bytea[])', [o.ownerId, noteId, tags]);
  const k = key(o, noteId);
  const out = new Map<string, string>();
  for (const r of found) {
    const t = openJson(k, translationHeader(o, noteId, r.line_tag), r.translation_ciphertext, Translated);
    if (t.language === language) out.set(t.lineId, t.text);
  }
  return out;
}

/**
 * Keeps lines translated into `language`, sealed, while the note is being recorded. Once the
 * recording has stopped they aren't kept: the live transcript they belong to is gone.
 */
export async function keepTranslations(o: Owner, t: Target, language: string, lines: { lineId: string; text: string }[]): Promise<void> {
  if (!lines.length) return;
  await tx(o.pool, async (c) => {
    const r = await maybeOne(c, z.object({ state: z.string() }), 'SELECT state FROM recordings WHERE owner_id = $1 AND recording_id = $2 FOR SHARE', [o.ownerId, t.recordingId]);
    if (!r || r.state === 'stopped') return;
    for (const l of lines) {
      const tag = lineTag(o, t.noteId, l.lineId, language);
      await exec(c, 'INSERT INTO transcript_translations (owner_id, note_item_id, line_tag, translation_ciphertext) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [o.ownerId, t.noteId, tag, sealJson(key(o, t.noteId), translationHeader(o, t.noteId, tag), toJson({ lineId: l.lineId, language, text: l.text }))]);
    }
  });
}
