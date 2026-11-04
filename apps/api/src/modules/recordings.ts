import type { RecordingAction, RecordingStopResult, RoomRecordingState } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { maybeOne, timestamp, tx } from '../db';
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
  const heard = r.state === 'stopped' ? [] : (await transcripts.lines(o, o.pool, r.note_item_id)).slice(-transcripts.LIVE_LINES);
  return {
    id: recordingId, noteId: r.note_item_id, title: note.manifest.title, startedAt: r.started_at.toISOString(), elapsed: p.seconds, status: r.state, recording: p,
    transcript: transcripts.spoken(heard)
  };
}

export async function start(o: Owner, title: string): Promise<RoomRecordingState> {
  const { recordingId } = await tx(o.pool, (c) => createNoteWithRecording(o, c,
    (rid) => blankNote({ kind: 'room', title: title.trim() || 'Untitled recording', recordingId: rid, invited: [] }),
    (nid) => createRecording(o, c, nid)));
  rlog.info('room recording started', { recordingId });
  return view(o, recordingId);
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
  const ctx = { recordingId, segment: clip.segment, startMs: clip.startMs, state: r.state };
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
