import type { RecordingAction, RecordingStopResult, RoomRecordingState } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { maybeOne, timestamp, tx } from '../db';
import { ApiError } from '../errors';
import { getItem } from '../vault';
import { appendPiece, createRecording, progress, setRecordingState, type Piece } from './audio';
import { NoteManifest, blankNote, createNoteWithRecording, finishRecording, remove, updateNote } from './notes';

const Row = z.object({ note_item_id: z.string(), state: z.enum(['recording', 'paused', 'stopped']), started_at: timestamp });
async function row(o: Owner, recordingId: string) {
  const r = await maybeOne(o.pool, Row, 'SELECT note_item_id, state, started_at FROM recordings WHERE owner_id = $1 AND recording_id = $2', [o.ownerId, recordingId]);
  if (!r) throw new ApiError('not-found', 'That recording doesn’t exist.');
  return r;
}

export async function view(o: Owner, recordingId: string): Promise<RoomRecordingState> {
  const r = await row(o, recordingId);
  const note = await getItem(o, o.pool, 'note', r.note_item_id, NoteManifest, 'That recording');
  const p = await progress(o, recordingId, 0);
  return { id: recordingId, noteId: r.note_item_id, title: note.manifest.title, startedAt: r.started_at.toISOString(), elapsed: p.seconds, status: r.state, recording: p };
}

export async function start(o: Owner, title: string): Promise<RoomRecordingState> {
  const { recordingId } = await tx(o.pool, (c) => createNoteWithRecording(o, c,
    (rid) => blankNote({ kind: 'room', title: title.trim() || 'Untitled recording', keep: 'full', audience: 'host', recordingId: rid }),
    (nid) => createRecording(o, c, nid)));
  return view(o, recordingId);
}

export async function act(o: Owner, recordingId: string, a: RecordingAction): Promise<RoomRecordingState> {
  const r = await row(o, recordingId);
  if (r.state === 'stopped') throw new ApiError('conflict', 'This recording has stopped.');
  await tx(o.pool, async (c) => {
    if (a.type === 'rename') await updateNote(o, c, r.note_item_id, (n) => ({ ...n, title: a.title }));
    if (a.type === 'pause') await setRecordingState(o, c, recordingId, 'paused');
    if (a.type === 'resume') await setRecordingState(o, c, recordingId, 'recording');
  });
  return view(o, recordingId);
}

export async function audio(o: Owner, recordingId: string, piece: Piece): Promise<RoomRecordingState> {
  if (piece.segment !== 0) throw new ApiError('invalid', 'Room recordings have one segment.');
  await appendPiece(o, recordingId, piece);
  return view(o, recordingId);
}

export async function stop(o: Owner, recordingId: string): Promise<RecordingStopResult> {
  const r = await row(o, recordingId);
  const p = await progress(o, recordingId, 0);
  await tx(o.pool, async (c) => {
    await setRecordingState(o, c, recordingId, 'stopped');
    await finishRecording(o, c, r.note_item_id, p.seconds);
  });
  return { pendingNoteId: r.note_item_id, duration: p.seconds };
}

export async function discard(o: Owner, recordingId: string): Promise<void> {
  const r = await row(o, recordingId);
  await remove(o, r.note_item_id);
}
