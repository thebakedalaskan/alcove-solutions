import { type CallAction, type CallEndResult, type CallState } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { id128, openJson, sealJson, stateKey, toJson } from '../crypto';
import { bytea, exec, maybeOne, timestamp, tx, type Db } from '../db';
import { ConflictError, NotFoundError, notFound } from '../errors';
import { me } from './account';
import { appendPiece, createRecording, progress, setRecordingState, type Piece } from './audio';
import { MeetingManifest, findByCode, updateManifest } from './meetings';
import type { Loaded } from '../vault';
import { getItem } from '../vault';
import { blankNote, createNoteWithRecording, finishRecording } from './notes';
import { log } from '../log';

const clog = log.child({ component: 'calls' });

const Notice = z.object({ id: z.string(), text: z.string(), kind: z.enum(['notes', 'people', 'info']) });
const Stored = z.object({
  mic: z.boolean(), cam: z.boolean(), hand: z.boolean(), sharing: z.object({ title: z.string() }).nullable(),
  notes: z.object({ status: z.enum(['off', 'on']), everOn: z.boolean(), noteId: z.string().nullable(), recordingId: z.string().nullable(), segment: z.number() }),
  chat: z.array(z.object({ id: z.string(), text: z.string(), at: z.number() })),
  notices: z.array(Notice)
});
type Stored = z.infer<typeof Stored>;
const Row = z.object({ call_id: z.string(), meeting_item_id: z.string(), state: z.enum(['live', 'ended']), started_at: timestamp, ended_at: timestamp.nullable(), state_ciphertext: bytea });
const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call:${callId}`);
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
    participants: [{ id: o.ownerId, person, isMe: true, isOrganizer: true, mic: s.mic, cam: s.cam, hand: s.hand }],
    sharing: s.sharing,
    notes: { status: s.notes.status, everOn: s.notes.everOn, noteId: s.notes.noteId, recording: await progress(o, s.notes.recordingId, s.notes.segment) },
    chat: s.chat.map((m) => ({ id: m.id, from: person, isMe: true, text: m.text, at: m.at })),
    notices: s.notices, isOrganizer: true
  };
}

/** Notes on: the first time a note and its recording are created; after that a new segment starts. */
async function startNotes(o: Owner, db: Db, s: Stored, meeting: Loaded<MeetingManifest>): Promise<Stored> {
  if (s.notes.recordingId) {
    await setRecordingState(o, db, s.notes.recordingId, 'recording');
    return { ...s, notes: { ...s.notes, status: 'on', everOn: true, segment: s.notes.segment + 1 } };
  }
  const { noteId, recordingId } = await createNoteWithRecording(o, db,
    (rid) => blankNote({ kind: 'call', title: meeting.manifest.title, recordingId: rid, meetingId: meeting.itemId, invited: meeting.manifest.guests }),
    (nid) => createRecording(o, db, nid));
  return { ...s, notes: { ...s.notes, status: 'on', everOn: true, noteId, recordingId, segment: 0 } };
}

export async function join(o: Owner, code: string, opts: { mic: boolean; cam: boolean }): Promise<CallState> {
  const callId = await tx(o.pool, async (c) => {
    const meeting = await findByCode(o, code, c);
    if (!meeting) throw new NotFoundError('There’s no call with that code. Check the link and try again.');
    const live = await maybeOne(c, z.object({ call_id: z.string() }), `SELECT call_id FROM calls WHERE owner_id = $1 AND meeting_item_id = $2 AND state = 'live'`, [o.ownerId, meeting.itemId]);
    if (live) { clog.info('rejoined call', { callId: live.call_id, meetingId: meeting.itemId }); return live.call_id; }
    const id = id128();
    let s: Stored = { mic: opts.mic, cam: opts.cam, hand: false, sharing: null, chat: [], notices: [], notes: { status: 'off', everOn: false, noteId: null, recordingId: null, segment: 0 } };
    await exec(c, `INSERT INTO calls (owner_id, call_id, meeting_item_id, state, started_at, version, state_ciphertext) VALUES ($1,$2,$3,'live',now(),0,$4)`,
      [o.ownerId, id, meeting.itemId, sealJson(key(o, id), header(o, id), toJson(s))]);
    if (meeting.manifest.notes === 'on') s = notice(await startNotes(o, c, s, meeting), 'Notes are on. Everyone here can see that.');
    await save(o, c, id, s);
    await updateManifest(o, c, meeting.itemId, (m) => ({ ...m, status: 'live' }));
    clog.info('call started', { callId: id, meetingId: meeting.itemId, mic: opts.mic, cam: opts.cam, notes: s.notes.status, noteId: s.notes.noteId, recordingId: s.notes.recordingId });
    return id;
  });
  return view(o, o.pool, callId);
}

export async function act(o: Owner, callId: string, a: CallAction): Promise<CallState> {
  await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, action: a.type } });
    const at = Math.round((Date.now() - row.started_at.getTime()) / 1000);
    let s = state;
    switch (a.type) {
      case 'mic': s = { ...s, mic: a.on }; break;
      case 'cam': s = { ...s, cam: a.on }; break;
      case 'hand': s = { ...s, hand: a.up }; break;
      case 'sharing': s = a.on ? notice({ ...s, sharing: { title: a.title ?? 'Your screen' } }, s.notes.status === 'on' ? 'You’re presenting. The recording keeps running.' : 'You’re presenting.', 'info') : { ...s, sharing: null }; break;
      case 'chat': s = { ...s, chat: [...s.chat, { id: id128(), text: a.text, at }] }; break;
      case 'notes': {
        if (a.on === (s.notes.status === 'on')) break;
        if (a.on) {
          const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
          s = notice(await startNotes(o, c, s, meeting), 'You turned on notes. Everyone here can see that.');
        } else {
          if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'paused');
          s = notice({ ...s, notes: { ...s.notes, status: 'off' } }, 'You turned off notes. What was written so far is kept.');
        }
        break;
      }
      case 'dismiss': s = { ...s, notices: s.notices.filter((n) => n.id !== a.id) }; break;
    }
    await save(o, c, callId, s);
    // Action type and resulting states only; chat text and titles stay sealed.
    clog.at(a.type === 'dismiss' || a.type === 'chat' ? 'debug' : 'info', 'call action', { callId, action: a.type, notes: s.notes.status, segment: s.notes.segment, sharing: Boolean(s.sharing) });
  });
  return view(o, o.pool, callId);
}

export async function audio(o: Owner, callId: string, piece: Piece): Promise<CallState> {
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: piece.segment, seq: piece.seq, notes: state.notes.status, currentSegment: state.notes.segment };
  if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
  if (state.notes.status !== 'on' || !state.notes.recordingId) throw new ConflictError('Notes aren’t recording right now.', { context: ctx });
  if (piece.segment !== state.notes.segment) throw new ConflictError('That audio belongs to an earlier part of the recording.', { context: ctx });
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
    clog.info(row.state === 'live' ? 'call ended' : 'left an ended call', { callId, meetingId: row.meeting_item_id, duration, noteId: s.notes.noteId });
    return { meetingId: row.meeting_item_id, pendingNoteId: s.notes.noteId, duration };
  });
}
export const state = (o: Owner, callId: string) => view(o, o.pool, callId);
