/*
 * Recording in the room: a private note and its recording. The browser sends 5-second pieces of
 * audio and clips of speech, each saying where it falls in the recording, so a recording made without
 * a connection can be uploaded later and keep its own times: its start, its length (the pieces'
 * total) and when each line was said (docs: calls-and-recordings › Room recordings).
 */
import { LIVE_TRANSCRIPT_LINES, MAX_RECORDING_AGE_DAYS, type RecordingAction, type RecordingStopResult, type RoomRecordingInput, type RoomRecordingState } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { unb64u } from '../crypto';
import { exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getItem } from '../vault';
import { appendPiece, createRecording, progress, setRecordingState, type Piece } from './audio';
import { NoteManifest, blankNote, createNoteWithRecording, finishRecording, remove, updateNote } from './notes';
import * as transcripts from './transcripts';
import * as writer from './writer';
import { log } from '../log';

const rlog = log.child({ component: 'recordings' });

const Row = z.object({ note_item_id: z.string(), state: z.enum(['recording', 'paused', 'stopped']), started_at: timestamp });
async function row(o: Owner, recordingId: string) {
  const r = await maybeOne(o.pool, Row, 'SELECT note_item_id, state, started_at FROM recordings WHERE owner_id = $1 AND recording_id = $2', [o.ownerId, recordingId]);
  if (!r) throw new NotFoundError('That recording doesn’t exist.');
  return r;
}

export async function view(o: Owner, recordingId: string): Promise<RoomRecordingState> {
  const r = await row(o, recordingId);
  const note = await getItem(o, o.pool, 'note', r.note_item_id, NoteManifest, 'That recording');
  const p = await progress(o, recordingId, 0);
  const heard = r.state === 'stopped' ? [] : (await transcripts.lines(o, o.pool, r.note_item_id)).slice(-LIVE_TRANSCRIPT_LINES);
  return {
    id: recordingId, noteId: r.note_item_id, title: note.manifest.title, startedAt: r.started_at.toISOString(), elapsed: p.seconds, status: r.state, recording: p,
    transcript: transcripts.spoken(heard)
  };
}

/** How far ahead of this server's clock a recording's own start may be: a device's clock can run a little fast. */
const CLOCK_SKEW_SECONDS = 5 * 60;
/** The first key of the lock that makes starts from the same moment wait for each other, per account. */
const START_LOCK = 0x52454301;

/**
 * Starts a room recording: now, or at `startedAt` for one recorded without a connection and uploaded
 * later, which may be up to MAX_RECORDING_AGE_DAYS back but not in the future. Starting again from a
 * moment this account already has a room recording from carries on with that recording, as it is and
 * however old it is by now, so an upload that was cut off (a closed tab, an answer that never arrived)
 * resumes instead of making a second note.
 */
export async function start(o: Owner, input: RoomRecordingInput): Promise<RoomRecordingState> {
  const own = input.startedAt === undefined ? undefined : new Date(input.startedAt);
  const secondsAgo = own ? Math.round((Date.now() - own.getTime()) / 1000) : 0;
  if (Number.isNaN(secondsAgo)) throw new ValidationError('That recording’s start isn’t a real time.');
  const { recordingId, again } = await tx(o.pool, async (c) => {
    if (own) {
      await exec(c, 'SELECT pg_advisory_xact_lock($1, $2)', [START_LOCK, Buffer.from(unb64u(o.ownerId, 32)).readInt32BE(0)]);
      const same = await roomRecordingFrom(o, c, own);
      if (same) return { recordingId: same, again: true };
      if (secondsAgo > MAX_RECORDING_AGE_DAYS * 86_400) throw new ValidationError(`Recordings can be uploaded for up to ${MAX_RECORDING_AGE_DAYS} days after they start. This one started earlier.`, { context: { secondsAgo } });
      if (secondsAgo < -CLOCK_SKEW_SECONDS) throw new ValidationError('This recording starts in the future. Check the clock on this device.', { context: { secondsAgo } });
    }
    const at = own ?? new Date();
    const made = await createNoteWithRecording(o, c,
      (rid) => blankNote({ kind: 'room', title: input.title || 'Untitled recording', startedAt: at, recordingId: rid, invited: [] }),
      (nid) => createRecording(o, c, nid, at));
    return { recordingId: made.recordingId, again: false };
  });
  rlog.info(again ? 'room recording started again; carrying on with it' : 'room recording started', { recordingId, secondsAgo });
  return view(o, recordingId);
}

/** The room recording this account started at exactly `at`, if there is one. */
async function roomRecordingFrom(o: Owner, db: Db, at: Date): Promise<string | undefined> {
  const found = await rows(db, z.object({ recording_id: z.string(), note_item_id: z.string() }), 'SELECT recording_id, note_item_id FROM recordings WHERE owner_id = $1 AND started_at = $2', [o.ownerId, at]);
  for (const r of found) {
    // A call's notes keep their recording here too; only a recording in the room carries on.
    if ((await getItem(o, db, 'note', r.note_item_id, NoteManifest, 'That recording')).manifest.kind === 'room') return r.recording_id;
  }
  return undefined;
}

export async function act(o: Owner, recordingId: string, a: RecordingAction): Promise<RoomRecordingState> {
  const r = await row(o, recordingId);
  if (r.state === 'stopped') throw new ConflictError('This recording has stopped.', { context: { recordingId, action: a.type } });
  await tx(o.pool, async (c) => {
    if (a.type === 'rename') await updateNote(o, c, r.note_item_id, (n) => ({ ...n, title: a.title }));
    if (a.type === 'pause') await setRecordingState(o, c, recordingId, 'paused');
    if (a.type === 'resume') await setRecordingState(o, c, recordingId, 'recording');
  });
  rlog.info('room recording action', { recordingId, action: a.type });
  return view(o, recordingId);
}

export async function audio(o: Owner, recordingId: string, piece: Piece): Promise<RoomRecordingState> {
  if (piece.segment !== 0) throw new ValidationError('Room recordings have one segment.', { context: { recordingId, segment: piece.segment } });
  await appendPiece(o, recordingId, piece);
  return view(o, recordingId);
}

/** Transcribes a few seconds of speech into the live transcript, while recording. */
export async function transcribe(o: Owner, recordingId: string, clip: transcripts.Clip): Promise<RoomRecordingState> {
  const r = await row(o, recordingId);
  const ctx = { recordingId, segment: clip.segment, atMs: clip.atMs, state: r.state };
  if (clip.segment !== 0) throw new ValidationError('Room recordings have one segment.', { context: ctx });
  if (r.state !== 'recording') throw new ConflictError(r.state === 'paused' ? 'Recording is paused.' : 'This recording has stopped.', { context: ctx });
  await transcripts.hear(o, { recordingId, noteId: r.note_item_id }, clip);
  return view(o, recordingId);
}

export async function stop(o: Owner, recordingId: string): Promise<RecordingStopResult> {
  const r = await row(o, recordingId);
  const p = await progress(o, recordingId, 0);
  // Stopping twice (a retry, a second tab) finishes the note once.
  const stopped = await tx(o.pool, async (c) => {
    const now = await maybeOne(c, z.object({ state: z.string() }), 'SELECT state FROM recordings WHERE owner_id = $1 AND recording_id = $2 FOR UPDATE', [o.ownerId, recordingId]);
    if (!now || now.state === 'stopped') return false;
    await setRecordingState(o, c, recordingId, 'stopped');
    await finishRecording(o, c, r.note_item_id, p.seconds);
    return true;
  });
  rlog.info(stopped ? 'room recording stopped' : 'room recording was already stopped', { recordingId, noteId: r.note_item_id, seconds: p.seconds, pieces: p.pieces });
  if (stopped) writer.kick(o, o.ownerId);
  return { pendingNoteId: r.note_item_id, duration: p.seconds };
}

export async function discard(o: Owner, recordingId: string): Promise<void> {
  const r = await row(o, recordingId);
  await remove(o, r.note_item_id);
  rlog.info('room recording discarded', { recordingId, noteId: r.note_item_id });
}
