import { NotesAudienceSchema, type CallAction, type CallEndResult, type CallState, type NotesAudience, type NotesMode } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { id128, openJson, sealJson, stateKey, toJson } from '../crypto';
import { bytea, exec, maybeOne, timestamp, tx, type Db } from '../db';
import { ApiError, notFound } from '../errors';
import { me } from './account';
import { appendPiece, createRecording, progress, setRecordingState, type Piece } from './audio';
import { MeetingManifest, findByCode, updateManifest } from './meetings';
import { getItem } from '../vault';
import { blankNote, createNoteWithRecording, finishRecording } from './notes';

const Notice = z.object({ id: z.string(), text: z.string(), kind: z.enum(['notes', 'people', 'info']) });
const Stored = z.object({
  mic: z.boolean(), cam: z.boolean(), hand: z.boolean(), sharing: z.object({ title: z.string() }).nullable(),
  notes: z.object({ status: z.enum(['off', 'on', 'paused']), mode: z.enum(['full', 'notes']), audience: NotesAudienceSchema, everOn: z.boolean(), noteId: z.string().nullable(), recordingId: z.string().nullable(), segment: z.number() }),
  chat: z.array(z.object({ id: z.string(), text: z.string(), at: z.number() })),
  notices: z.array(Notice)
});
type Stored = z.infer<typeof Stored>;
const Row = z.object({ call_id: z.string(), meeting_item_id: z.string(), state: z.enum(['live', 'ended']), started_at: timestamp, ended_at: timestamp.nullable(), state_ciphertext: bytea });
const key = (o: Owner, callId: string) => stateKey(o.wrapKey, `call:${callId}`);
const header = (o: Owner, callId: string) => ({ v: 1 as const, kind: 'call-state', ownerId: o.ownerId, callId });

async function load(o: Owner, db: Db, callId: string, lock = false) {
  const r = await maybeOne(db, Row, `SELECT call_id, meeting_item_id, state, started_at, ended_at, state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2${lock ? ' FOR UPDATE' : ''}`, [o.ownerId, callId]);
  if (!r) throw notFound('That call');
  return { row: r, state: openJson(key(o, callId), header(o, callId), r.state_ciphertext, Stored) };
}
async function save(o: Owner, db: Db, callId: string, s: Stored) {
  await exec(db, 'UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, sealJson(key(o, callId), header(o, callId), toJson(s))]);
}
const notice = (s: Stored, text: string, kind: 'notes' | 'people' | 'info' = 'notes'): Stored => ({ ...s, notices: [...s.notices.slice(-2), { id: id128(), text, kind }] });

async function view(o: Owner, db: Db, callId: string): Promise<CallState> {
  const { row, state: s } = await load(o, db, callId);
  const meeting = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const person = await me(o);
  const end = row.ended_at ?? new Date();
  return {
    callId, meetingId: row.meeting_item_id, code: meeting.manifest.code, title: meeting.manifest.title, startedAt: row.started_at.toISOString(),
    elapsed: Math.max(0, Math.round((end.getTime() - row.started_at.getTime()) / 1000)), phase: row.state === 'live' ? 'in-call' : 'ended',
    participants: [{ id: o.ownerId, person, isMe: true, isHost: true, mic: s.mic, cam: s.cam, hand: s.hand }],
    sharing: s.sharing,
    notes: { status: s.notes.status, mode: s.notes.mode, audience: s.notes.audience, everOn: s.notes.everOn, noteId: s.notes.noteId, recording: await progress(o, s.notes.recordingId, s.notes.segment) },
    chat: s.chat.map((m) => ({ id: m.id, from: person, isMe: true, text: m.text, at: m.at })),
    notices: s.notices, canControlNotes: true
  };
}

async function startNotes(o: Owner, db: Db, s: Stored, meetingId: string, title: string, mode: 'full' | 'notes'): Promise<Stored> {
  if (s.notes.recordingId) {
    await setRecordingState(o, db, s.notes.recordingId, 'recording');
    return { ...s, notes: { ...s.notes, status: 'on', mode, everOn: true, segment: s.notes.status === 'off' ? s.notes.segment + 1 : s.notes.segment } };
  }
  const { noteId, recordingId } = await createNoteWithRecording(o, db,
    (rid) => blankNote({ kind: 'call', title, keep: mode, audience: s.notes.audience, recordingId: rid, meetingId }),
    (nid) => createRecording(o, db, nid));
  return { ...s, notes: { ...s.notes, status: 'on', mode, everOn: true, noteId, recordingId, segment: 0 } };
}

export async function join(o: Owner, code: string, opts: { mic: boolean; cam: boolean; notes?: NotesMode | undefined; audience?: NotesAudience | undefined }): Promise<CallState> {
  const callId = await tx(o.pool, async (c) => {
    const meeting = await findByCode(o, code, c);
    if (!meeting) throw new ApiError('not-found', 'There’s no call with that code. Check the link and try again.');
    const live = await maybeOne(c, z.object({ call_id: z.string() }), `SELECT call_id FROM calls WHERE owner_id = $1 AND meeting_item_id = $2 AND state = 'live'`, [o.ownerId, meeting.itemId]);
    if (live) return live.call_id;
    const id = id128();
    const audience = opts.audience ?? meeting.manifest.audience;
    const mode = opts.notes ?? (meeting.manifest.notes === 'ask' ? 'off' : meeting.manifest.notes);
    let s: Stored = { mic: opts.mic, cam: opts.cam, hand: false, sharing: null, chat: [], notices: [], notes: { status: 'off', mode: 'full', audience, everOn: false, noteId: null, recordingId: null, segment: 0 } };
    await exec(c, `INSERT INTO calls (owner_id, call_id, meeting_item_id, state, started_at, version, state_ciphertext) VALUES ($1,$2,$3,'live',now(),0,$4)`,
      [o.ownerId, id, meeting.itemId, sealJson(key(o, id), header(o, id), toJson(s))]);
    if (mode !== 'off') s = notice(await startNotes(o, c, s, meeting.itemId, meeting.manifest.title, mode), 'You started notes. Everyone in the call can see they’re on.');
    await save(o, c, id, s);
    await updateManifest(o, c, meeting.itemId, (m) => ({ ...m, status: 'live' }));
    return id;
  });
  return view(o, o.pool, callId);
}

export async function act(o: Owner, callId: string, a: CallAction): Promise<CallState> {
  await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ApiError('conflict', 'This call has ended.');
    const at = Math.round((Date.now() - row.started_at.getTime()) / 1000);
    let s = state;
    switch (a.type) {
      case 'mic': s = { ...s, mic: a.on }; break;
      case 'cam': s = { ...s, cam: a.on }; break;
      case 'hand': s = { ...s, hand: a.up }; break;
      case 'sharing': s = a.on ? notice({ ...s, sharing: { title: a.title ?? 'Your screen' } }, s.notes.status === 'on' ? 'You’re presenting. The recording keeps running.' : 'You’re presenting.', 'info') : { ...s, sharing: null }; break;
      case 'chat': s = { ...s, chat: [...s.chat, { id: id128(), text: a.text, at }] }; break;
      case 'notes-start': {
        if (s.notes.status === 'on') break;
        const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
        s = notice(await startNotes(o, c, s, row.meeting_item_id, meeting.manifest.title, a.mode), 'You started notes. Everyone in the call can see they’re on.');
        break;
      }
      case 'notes-pause':
        if (s.notes.status !== 'on' || !s.notes.recordingId) throw new ApiError('conflict', 'Notes aren’t on.');
        await setRecordingState(o, c, s.notes.recordingId, 'paused');
        s = notice({ ...s, notes: { ...s.notes, status: 'paused' } }, 'Notes paused. Nothing is recorded until you resume.');
        break;
      case 'notes-resume':
        if (s.notes.status !== 'paused' || !s.notes.recordingId) throw new ApiError('conflict', 'Notes aren’t paused.');
        await setRecordingState(o, c, s.notes.recordingId, 'recording');
        s = notice({ ...s, notes: { ...s.notes, status: 'on' } }, 'Notes resumed.');
        break;
      case 'notes-stop':
        if (s.notes.status === 'off') break;
        if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'paused');
        s = notice({ ...s, notes: { ...s.notes, status: 'off' } }, 'Notes stopped. What was recorded so far is kept.');
        break;
      case 'dismiss': s = { ...s, notices: s.notices.filter((n) => n.id !== a.id) }; break;
    }
    await save(o, c, callId, s);
  });
  return view(o, o.pool, callId);
}

export async function audio(o: Owner, callId: string, piece: Piece): Promise<CallState> {
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ApiError('conflict', 'This call has ended.');
  if (state.notes.status !== 'on' || !state.notes.recordingId) throw new ApiError('conflict', 'Notes aren’t recording right now.');
  if (piece.segment !== state.notes.segment) throw new ApiError('conflict', 'That audio belongs to an earlier part of the recording.');
  await appendPiece(o, state.notes.recordingId, piece);
  return view(o, o.pool, callId);
}

export async function leave(o: Owner, callId: string): Promise<CallEndResult> {
  return tx(o.pool, async (c) => {
    const { row, state: s } = await load(o, c, callId, true);
    const duration = Math.max(1, Math.round((Date.now() - row.started_at.getTime()) / 1000));
    if (row.state === 'live') {
      await exec(c, `UPDATE calls SET state = 'ended', ended_at = now(), version = version + 1 WHERE owner_id = $1 AND call_id = $2`, [o.ownerId, callId]);
      if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'stopped');
      if (s.notes.noteId) await finishRecording(o, c, s.notes.noteId, duration);
      await updateManifest(o, c, row.meeting_item_id, (m) => ({ ...m, status: 'ended', duration, ...(s.notes.noteId ? { noteId: s.notes.noteId } : {}) }));
    }
    return { meetingId: row.meeting_item_id, pendingNoteId: s.notes.noteId, duration };
  });
}
export const state = (o: Owner, callId: string) => view(o, o.pool, callId);
