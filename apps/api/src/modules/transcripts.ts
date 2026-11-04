/*
 * The live transcript of a note while it is being recorded (docs: notes-and-inference). The browser
 * sends a few seconds of speech at a time; each clip is transcribed and kept as one sealed row, even
 * when nothing in it survived the filter, tagged with a keyed hash of where it starts in the recording
 * and whose speech it is, so a retried clip is stored (and transcribed) once. Each row also keeps the evidence of the verified
 * model the clip was sent to. In a call each line says who said it, the breakout room it was said in (if any), and, while
 * rooms are open, who may read it: the people who were in that part of the call when it was said. A room's lines go when
 * the room closes. When the recording stops, the main room's lines and that evidence move into the note and the rows go.
 *
 * Once the clips Whisper heard surely agree on the call's language, the clips of everyone it has been asked about
 * go in it, so short and accented clips aren't taken for another, with a prompt of who's in the call and the words
 * said just before it in the same part of the call (where the server placed it). Each row keeps whose clip it was,
 * the language Whisper picked for it when it picked one surely, and whether it asked Whisper what its speaker speaks.
 */
import { InferenceEvidenceSchema, type AudioSegment, type InferenceEvidence, type Speaker, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { b64u, id128, mac, openJson, sealJson, stateKey, toJson, utf8 } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { speechPrompt, transcribe, type SpeechContext } from '../inference';
import { log } from '../log';
import { findItem } from '../vault';
import { profile } from './account';
import { segments } from './audio';
import { nameOf, personOf } from './portraits';

const tlog = log.child({ component: 'transcripts' });

/** Speech from the browser: where it starts in its segment (pauses not counted), and its WAV bytes. */
export interface Clip { segment: number; startMs: number; durationMs: number; wav: Uint8Array }
/** Where a clip's lines go: the recording it was part of, and the note being made from it. */
export interface Target { recordingId: string; noteId: string }

/**
 * A line as kept. In a call, `speaker` is the participant ID of whoever said it (named from the call when it's
 * shown), `room` the breakout room it was said in, if any, and `readers` (said while rooms were open) who may read
 * it: the people in that part of the call when it was said, by their call seat's person. A room recording names
 * nobody, and anyone with the recording reads it.
 */
const Line = z.object({ id: z.string(), at: z.number(), text: z.string(), speaker: z.string().optional(), room: z.string().optional(), readers: z.array(z.string()).optional() });
export type Line = z.infer<typeof Line>;
/** A line, and the segment of the recording its clip was part of. */
export type HeardLine = Line & { segment: number };
const Stored = z.object({
  segment: z.number(), lines: z.array(Line), evidence: InferenceEvidenceSchema,
  /** In a call, whose speech the clip was (a participant ID), even when none of it survived the filter. */
  speaker: z.string().optional(),
  /** The language Whisper picked for this clip by itself, when it was sure (it wasn't told the call's). */
  language: z.string().optional(),
  /**
   * The clip asked Whisper what its speaker speaks: it went without the call's language, and Whisper was sure of its
   * language or it was long enough to tell (RECHECK_MS). Heard at length but unsure is how Whisper hears accented speech.
   */
  asked: z.boolean().optional()
});
type Stored = z.infer<typeof Stored>;
/** Recording order: segment by segment, then by when in the recording. */
const inOrder = (a: Pick<HeardLine, 'segment' | 'at'>, b: Pick<HeardLine, 'segment' | 'at'>) => a.segment - b.segment || a.at - b.at;
const heardLines = (c: Stored): HeardLine[] => c.lines.map((l) => ({ ...l, segment: c.segment }));

/** The newest clips a clip's context is read from: its prompt, and the evidence for the call's language. */
const RECENT = 20;
/**
 * The call's language is the one Whisper picked surely for at least this many of the newest clips, if it picked
 * no other for any of them. One clip in another language (someone speaks another, or the call moves on to it)
 * stops it being sent until that clip is no longer among the newest.
 */
const AGREE = 3;
/**
 * Clips sent with the call's language say nothing new about it, so once this many of someone's have been since they
 * were last asked about, their next clip long enough to tell goes without it and Whisper picks again.
 */
const RECHECK_EVERY = 6;
const RECHECK_MS = 3500;

const key = (o: Owner, noteId: string) => stateKey(o.root, o.ownerId, `transcript:${noteId}`);
/** One clip of one person's speech: the same person's retried clip has the same tag, two people speaking at once don't. */
const tagOf = (o: Owner, noteId: string, segment: number, startMs: number, speaker: string) => mac(key(o, noteId), utf8(`clip:${segment}:${startMs}:${speaker}`));
const header = (o: Owner, noteId: string, tag: Uint8Array) => ({ v: 1 as const, kind: 'transcript-clip', ownerId: o.ownerId, noteId, tag: b64u(tag) });

/** Whose speech a call's clip is (a participant ID), the breakout room it was said in, if any, and who may read it, if not everyone in the call. */
export interface Heard { speaker: string; room?: string | undefined; readers?: string[] | undefined }
/**
 * Asked inside the transaction that keeps a clip or a translation, holding the call's row: whether what it belongs
 * to is still there. False drops it (its room closed while it was being transcribed, and that room's lines are gone).
 */
export type Still = (db: Db) => Promise<boolean>;

/**
 * Transcribes one clip into a note's live transcript. A clip heard before is skipped; one that comes back after the
 * recording stopped, or after the room it was said in closed, is dropped: its note is finished, or its room's lines
 * are gone.
 */
export async function hear(o: Owner, t: Target, clip: Clip, by?: Heard | undefined, still?: Still | undefined): Promise<void> {
  const tag = tagOf(o, t.noteId, clip.segment, clip.startMs, by?.speaker ?? '');
  const ctx = { noteId: t.noteId, recordingId: t.recordingId, segment: clip.segment, startMs: clip.startMs, durationMs: clip.durationMs, bytes: clip.wav.length, room: Boolean(by?.room) };
  const seen = await maybeOne(o.pool, z.object({ n: z.number() }), 'SELECT 1 AS n FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2 AND clip_tag = $3', [o.ownerId, t.noteId, tag]);
  if (seen) { tlog.debug('clip already transcribed', ctx); return; }
  const [segs, recent] = await Promise.all([segments(o, t.recordingId), newest(o, o.pool, t.noteId, RECENT)]);
  // Lines are placed in the whole recording the way the note's player counts it: earlier segments first.
  const at = segs.filter((s) => s.index < clip.segment).reduce((n, s) => n + s.seconds, 0) + clip.startMs / 1000;
  const callIn = languageFor(recent, by?.speaker, clip.durationMs);
  // With the call's language only, a prompt of who's in the call and the words said before (see languageFor), in
  // the same part of the call, as the server placed this clip: a breakout room's words go to Whisper only with that
  // room's clips, and back.
  const context: SpeechContext = callIn ? { language: callIn, prompt: speechPrompt(await peopleIn(o, t.noteId), wordsBefore(recent, { segment: clip.segment, at }, by?.room)) } : {};
  const { heard, language, evidence } = await transcribe(o.cfg, clip.wav, clip.durationMs, context);
  const lines: Line[] = heard.map((x) => ({
    id: id128(), at: Math.round((at + x.start) * 10) / 10, text: x.text,
    ...(by ? { speaker: by.speaker, ...(by.room ? { room: by.room } : {}), ...(by.readers ? { readers: by.readers } : {}) } : {})
  }));
  const stored: Stored = { segment: clip.segment, lines, evidence, ...(by ? { speaker: by.speaker } : {}), ...(language ? { language } : {}), ...(!context.language && (language || clip.durationMs >= RECHECK_MS) ? { asked: true } : {}) };
  const kept = await tx(o.pool, async (c) => {
    // Whatever the clip belongs to is checked again now, after the seconds transcribing took: the call's row first
    // (closing a room holds it), then the recording, the order stopping takes them in.
    if (still && !(await still(c))) return 'gone' as const;
    // Stopping takes this row's lock to move the transcript into the note. Sharing it here means
    // a clip either lands before the move, or sees the recording stopped and stays out.
    const r = await maybeOne(c, z.object({ state: z.string() }), 'SELECT state FROM recordings WHERE owner_id = $1 AND recording_id = $2 FOR SHARE', [o.ownerId, t.recordingId]);
    if (!r || r.state === 'stopped') return 'stopped' as const;
    // Kept even without lines: the note says which verified models everything said in it went to.
    await exec(c, 'INSERT INTO transcript_clips (owner_id, note_item_id, clip_tag, clip_ciphertext) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [o.ownerId, t.noteId, tag, sealJson(key(o, t.noteId), header(o, t.noteId, tag), toJson(stored))]);
    return 'kept' as const;
  });
  if (kept === 'kept') tlog.debug('clip transcribed into the live transcript', { ...ctx, lines: lines.length });
  else tlog.info(kept === 'gone' ? 'clip arrived after its room closed; dropped' : 'clip arrived after the recording stopped; dropped', { ...ctx, lines: lines.length });
}

/**
 * The language a clip is sent in, from the newest clips (newest first): the call's, once the clips Whisper heard
 * surely agree on it, for someone a clip among them asked Whisper about. Anyone else (just joined, or quiet for a
 * while) may speak another, so their clip goes without it and Whisper picks. Clips sent with it add nothing to the
 * evidence, so after RECHECK_EVERY of someone's since, their next one long enough to tell goes without it.
 * A prompt goes only with it: Whisper writes a clip in its prompt's language, so without the call's language a clip
 * said in another (someone else's, or the call's next) would come back in the prompt's.
 */
function languageFor(recent: Stored[], speaker: string | undefined, durationMs: number): string | undefined {
  const picked = recent.flatMap((c) => (c.language ? [c.language] : []));
  const first = picked[0];
  if (first === undefined || picked.length < AGREE || picked.some((l) => l !== first)) return undefined;
  const sinceAsked = recent.filter((c) => c.speaker === speaker).findIndex((c) => c.asked);
  if (sinceAsked < 0) return undefined;
  return sinceAsked >= RECHECK_EVERY && durationMs >= RECHECK_MS ? undefined : first;
}

/**
 * The words of the newest clips' lines said in the clip's part of the call before `here`, in recording order: `room` is
 * where the server placed the clip (calls.ts, from where its speaker was when they began; none for the main room), and
 * each line keeps where it was placed, so a prompt never carries one part's words into another's.
 */
const wordsBefore = (recent: Stored[], here: Pick<HeardLine, 'segment' | 'at'>, room: string | undefined): string =>
  [...recent].reverse().flatMap(heardLines).filter((l) => l.room === room && inOrder(l, here) < 0).sort(inOrder).map((l) => l.text).join(' ');

/** The part of a note's manifest that says who was invited. */
const Invited = z.object({ invited: z.array(z.string()) });
/** What a note's people are called, as said in its call: the organizer, then everyone invited (named from their address when nobody knows them). */
async function peopleIn(o: Owner, noteId: string): Promise<string[]> {
  const note = await findItem(o, o.pool, 'note', noteId, Invited);
  const invited = (note?.manifest.invited ?? []).map((e) => nameOf(personOf(e)));
  return [(await profile(o)).name, ...invited];
}

/** A note's newest clips, newest first. */
async function newest(o: Owner, db: Db, noteId: string, n: number): Promise<Stored[]> {
  const found = await rows(db, z.object({ clip_tag: bytea, clip_ciphertext: bytea }),
    'SELECT clip_tag, clip_ciphertext FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2 ORDER BY heard_at DESC LIMIT $3', [o.ownerId, noteId, n]);
  const k = key(o, noteId);
  return found.map((r) => openJson(k, header(o, noteId, r.clip_tag), r.clip_ciphertext, Stored));
}

const ClipRow = z.object({ clip_tag: bytea, clip_ciphertext: bytea, heard_at: timestamp });
const opened = (o: Owner, noteId: string, r: z.infer<typeof ClipRow>) => ({ ...openJson(key(o, noteId), header(o, noteId, r.clip_tag), r.clip_ciphertext, Stored), tag: r.clip_tag });
async function clips(o: Owner, db: Db, noteId: string): Promise<ReturnType<typeof opened>[]> {
  const found = await rows(db, ClipRow, 'SELECT clip_tag, clip_ciphertext, heard_at FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
  return found.map((r) => opened(o, noteId, r));
}

/** Every line heard so far for a note that's still recording, in recording order (those `keep` takes, if it's given). */
export async function lines(o: Owner, db: Db, noteId: string, keep: (l: Line) => boolean = () => true): Promise<HeardLine[]> {
  return (await clips(o, db, noteId)).flatMap(heardLines).filter(keep).sort(inOrder);
}

/**
 * Lines kept inside their own segment of the recording, in order. A line placed past the end of its segment's audio
 * (its last pieces were dropped when notes were paused, or never arrived) goes at the end of that segment, and one
 * placed before its start (an earlier segment's audio arrived after it) at the start, so nothing said before a pause
 * lands after it. `open` is the segment still being recorded, whose end isn't known yet; a segment with no audio
 * can't be measured either.
 */
export function placed(ls: HeardLine[], segs: AudioSegment[], open?: number | undefined): HeardLine[] {
  const start = (segment: number) => segs.filter((g) => g.index < segment).reduce((n, g) => n + g.seconds, 0);
  return ls.map((l) => {
    const seconds = segs.find((g) => g.index === l.segment)?.seconds ?? 0;
    if (l.segment === open || !seconds) return l;
    const from = start(l.segment);
    return { ...l, at: Math.round(Math.min(Math.max(l.at, from), Math.max(from, from + seconds - 0.1)) * 10) / 10 };
  }).sort(inOrder);
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

/** Clips read back at a time while finding the latest lines. */
const LATEST_PAGE = 200;
/**
 * The latest `n` lines `keep` takes (someone's part of the call, as they may read it) for a note that's still
 * recording, in order. Read from the newest clips back, a page at a time, until there are `n` or no clips are left,
 * so a long call's live view stays cheap and a part of the call that's been quiet a while still shows its last lines.
 */
export async function latest(o: Owner, db: Db, noteId: string, n: number, keep: (l: Line) => boolean): Promise<HeardLine[]> {
  const out: HeardLine[] = [];
  let cursor: { at: Date; tag: Uint8Array } | null = null;
  for (;;) {
    const page: z.infer<typeof ClipRow>[] = await rows(db, ClipRow,
      `SELECT clip_tag, clip_ciphertext, heard_at FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2
         AND ($3::timestamptz IS NULL OR (heard_at, clip_tag) < ($3::timestamptz, $4::bytea)) ORDER BY heard_at DESC, clip_tag DESC LIMIT ${LATEST_PAGE}`,
      [o.ownerId, noteId, cursor?.at ?? null, cursor ? Buffer.from(cursor.tag) : Buffer.alloc(0)]);
    for (const r of page) out.push(...heardLines(opened(o, noteId, r)).filter(keep));
    const last = page.at(-1);
    if (out.length >= n || page.length < LATEST_PAGE || !last) break;
    cursor = { at: last.heard_at, tag: last.clip_tag };
  }
  return out.sort(inOrder).slice(-n);
}

/**
 * Deletes what was heard in breakout rooms that have closed, and those lines in other languages: a room's lines
 * live only as long as the room. Returns how many clips went.
 */
export async function dropRooms(o: Owner, db: Db, noteId: string, rooms: string[]): Promise<number> {
  if (!rooms.length) return 0;
  const gone = (await clips(o, db, noteId)).filter((c) => c.lines.some((l) => l.room !== undefined && rooms.includes(l.room)));
  if (!gone.length) return 0;
  const lineIds = new Set(gone.flatMap((c) => c.lines.map((l) => l.id)));
  await exec(db, 'DELETE FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2 AND clip_tag = ANY($3::bytea[])', [o.ownerId, noteId, gone.map((c) => Buffer.from(c.tag))]);
  const found = await rows(db, z.object({ line_tag: bytea, translation_ciphertext: bytea }), 'SELECT line_tag, translation_ciphertext FROM transcript_translations WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]);
  const k = key(o, noteId);
  const stale = found.filter((r) => lineIds.has(openJson(k, translationHeader(o, noteId, r.line_tag), r.translation_ciphertext, Translated).lineId)).map((r) => Buffer.from(r.line_tag));
  if (stale.length) await exec(db, 'DELETE FROM transcript_translations WHERE owner_id = $1 AND note_item_id = $2 AND line_tag = ANY($3::bytea[])', [o.ownerId, noteId, stale]);
  tlog.info('a closed room’s lines deleted', { noteId, clips: gone.length, translations: stale.length });
  return gone.length;
}

/** Lines as the app shows them: each said by whoever `speakerOf` names (nobody, in a room recording), in the room `roomOf` names. */
export const spoken = (ls: Line[], speakerOf: (identity: string) => Speaker | undefined = () => undefined,
  roomOf: (id: string) => { id: string; name: string } | undefined = () => undefined): TranscriptLine[] =>
  ls.map((l) => {
    const speaker = l.speaker ? speakerOf(l.speaker) : undefined;
    const room = l.room ? roomOf(l.room) : undefined;
    return { id: l.id, at: l.at, ...(speaker ? { speaker } : {}), ...(room ? { room } : {}), text: l.text };
  });

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
 * Keeps lines translated into `language`, sealed, while the note is being recorded. Once the recording has stopped,
 * or the lines' room has closed (`still`), they aren't kept: the live transcript they belong to is gone.
 */
export async function keepTranslations(o: Owner, t: Target, language: string, lines: { lineId: string; text: string }[], still?: Still | undefined): Promise<void> {
  if (!lines.length) return;
  await tx(o.pool, async (c) => {
    if (still && !(await still(c))) return;
    const r = await maybeOne(c, z.object({ state: z.string() }), 'SELECT state FROM recordings WHERE owner_id = $1 AND recording_id = $2 FOR SHARE', [o.ownerId, t.recordingId]);
    if (!r || r.state === 'stopped') return;
    for (const l of lines) {
      const tag = lineTag(o, t.noteId, l.lineId, language);
      await exec(c, 'INSERT INTO transcript_translations (owner_id, note_item_id, line_tag, translation_ciphertext) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [o.ownerId, t.noteId, tag, sealJson(key(o, t.noteId), translationHeader(o, t.noteId, tag), toJson({ lineId: l.lineId, language, text: l.text }))]);
    }
  });
}
