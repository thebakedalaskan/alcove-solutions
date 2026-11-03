import { CAPTION_LANGUAGES, type AnswerPart, type Breakouts, type CallAction, type CallEndResult, type CallState, type CaptionLanguage, type CaptionTranslation, type CatchUp } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { id128, openJson, sealJson, stateKey, toJson } from '../crypto';
import { bytea, exec, maybeOne, timestamp, tx, type Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, notFound } from '../errors';
import { me } from './account';
import * as drafting from './drafting';
import { personOf } from './portraits';
import { appendPiece, createRecording, progress, setRecordingState, type Piece } from './audio';
import { MeetingManifest, findByCode, updateManifest } from './meetings';
import type { Loaded } from '../vault';
import { getItem } from '../vault';
import { HeldRooms, blankNote, createNoteWithRecording, finishRecording } from './notes';
import * as transcripts from './transcripts';
import * as writer from './writer';
import { log } from '../log';

const clog = log.child({ component: 'calls' });

const Notice = z.object({ id: z.string(), text: z.string(), kind: z.enum(['notes', 'people', 'info']) });
/** A breakout room as kept: invited people by email, shown with their names when the call is read. */
const Room = HeldRooms.shape.rooms.element;
const Stored = z.object({
  mic: z.boolean(), cam: z.boolean(), hand: z.boolean(), sharing: z.object({ title: z.string() }).nullable(),
  /** The participant on everyone's main stage, by participant ID. */
  spotlight: z.string().nullable(),
  breakouts: z.object({
    open: z.object({ rooms: z.array(Room), from: z.number(), until: z.number(), message: z.object({ text: z.string(), at: z.number() }).nullable() }).nullable(),
    held: z.array(HeldRooms)
  }),
  notes: z.object({
    status: z.enum(['off', 'on']), everOn: z.boolean(), noteId: z.string().nullable(), recordingId: z.string().nullable(), segment: z.number(),
    /** Each time notes went on or off, in seconds since the call started, so a catch-up can say what it's missing. */
    history: z.array(z.object({ at: z.number(), on: z.boolean() }))
  }),
  chat: z.array(z.object({ id: z.string(), text: z.string(), at: z.number() })),
  notices: z.array(Notice)
});
type Stored = z.infer<typeof Stored>;
const Row = z.object({ owner_id: z.string(), call_id: z.string(), meeting_item_id: z.string(), state: z.enum(['live', 'ended']), started_at: timestamp, ended_at: timestamp.nullable(), state_ciphertext: bytea });
const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call:${callId}`);
const header = (o: Owner, callId: string) => ({ v: 1 as const, kind: 'call-state', ownerId: o.ownerId, callId });

async function load(o: Owner, db: Db, callId: string, lock = false) {
  const r = await maybeOne(db, Row, `SELECT owner_id, call_id, meeting_item_id, state, started_at, ended_at, state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2${lock ? ' FOR UPDATE' : ''}`, [o.ownerId, callId]);
  if (!r) throw notFound('That call');
  return { row: r, state: openJson(key(o, callId), header(o, callId), r.state_ciphertext, Stored) };
}
async function save(o: Owner, db: Db, callId: string, s: Stored) {
  await exec(db, 'UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, sealJson(key(o, callId), header(o, callId), toJson(s))]);
}
const notice = (s: Stored, text: string, kind: 'notes' | 'people' | 'info' = 'notes'): Stored => ({ ...s, notices: [...s.notices.slice(-2), { id: id128(), text, kind }] });
const secondsIn = (startedAt: Date, at = Date.now()) => Math.max(0, Math.round((at - startedAt.getTime()) / 1000));

/** Rooms whose time is up have closed, whether or not anyone said so: everyone is back, and the rooms go to the notes. */
function settleRooms(s: Stored, now: number): Stored {
  const open = s.breakouts.open;
  if (!open || now < open.until) return s;
  return { ...s, breakouts: { open: null, held: [...s.breakouts.held, { rooms: open.rooms, from: open.from, to: open.until }] } };
}
const roomsOf = (rooms: z.infer<typeof Room>[]) => rooms.map((r) => ({ id: r.id, name: r.name, people: r.emails.map((e) => personOf(e)) }));
function breakoutsOf(s: Stored): Breakouts {
  const open = s.breakouts.open;
  return {
    open: open ? { rooms: roomsOf(open.rooms), from: open.from, until: open.until, message: open.message } : null,
    held: s.breakouts.held.map((h) => ({ rooms: roomsOf(h.rooms), from: h.from, to: h.to }))
  };
}
/** The organizer is whoever the call belongs to. Calls are joined from the organizer's own vault today; guests will join from theirs. */
const organizes = (o: Owner, row: { owner_id: string }) => row.owner_id === o.ownerId;
/** Spotlight and breakout rooms change everyone's call, so only the organizer may. */
function organizerOnly(o: Owner, row: { owner_id: string }, ctx: { callId: string; action: string }) {
  if (!organizes(o, row)) throw new ForbiddenError('Only the organizer can do that.', { context: ctx });
}

async function view(o: Owner, db: Db, callId: string): Promise<CallState> {
  const { row, state: s } = await load(o, db, callId);
  const meeting = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const person = await me(o);
  const end = row.ended_at ?? new Date();
  const live = settleRooms(s, secondsIn(row.started_at, end.getTime()));
  const heard = s.notes.noteId && row.state === 'live' ? (await transcripts.lines(o, db, s.notes.noteId)).slice(-transcripts.LIVE_LINES) : [];
  return {
    callId, meetingId: row.meeting_item_id, code: meeting.manifest.code, title: meeting.manifest.title, startedAt: row.started_at.toISOString(),
    elapsed: Math.max(0, Math.round((end.getTime() - row.started_at.getTime()) / 1000)), phase: row.state === 'live' ? 'in-call' : 'ended',
    participants: [{ id: o.ownerId, person, isMe: true, isOrganizer: organizes(o, row), mic: s.mic, cam: s.cam, hand: s.hand }],
    sharing: s.sharing,
    spotlight: s.spotlight,
    breakouts: breakoutsOf(live),
    notes: { status: s.notes.status, everOn: s.notes.everOn, noteId: s.notes.noteId, recording: await progress(o, s.notes.recordingId, s.notes.segment) },
    chat: s.chat.map((m) => ({ id: m.id, from: person, isMe: true, text: m.text, at: m.at })),
    transcript: transcripts.spoken(heard, { name: person.name, person }),
    notices: s.notices, isOrganizer: organizes(o, row)
  };
}

/** Notes on, `at` seconds into the call: the first time a note and its recording are created; after that a new segment starts. */
async function startNotes(o: Owner, db: Db, s: Stored, meeting: Loaded<MeetingManifest>, at: number): Promise<Stored> {
  const history = [...s.notes.history, { at, on: true }];
  if (s.notes.recordingId) {
    await setRecordingState(o, db, s.notes.recordingId, 'recording');
    return { ...s, notes: { ...s.notes, status: 'on', everOn: true, segment: s.notes.segment + 1, history } };
  }
  const { noteId, recordingId } = await createNoteWithRecording(o, db,
    (rid) => blankNote({ kind: 'call', title: meeting.manifest.title, recordingId: rid, meetingId: meeting.itemId, invited: meeting.manifest.guests }),
    (nid) => createRecording(o, db, nid));
  return { ...s, notes: { ...s.notes, status: 'on', everOn: true, noteId, recordingId, segment: 0, history } };
}

export async function join(o: Owner, code: string, opts: { mic: boolean; cam: boolean }): Promise<CallState> {
  const callId = await tx(o.pool, async (c) => {
    const meeting = await findByCode(o, code, c);
    if (!meeting) throw new NotFoundError('There’s no call with that code. Check the link and try again.');
    const live = await maybeOne(c, z.object({ call_id: z.string() }), `SELECT call_id FROM calls WHERE owner_id = $1 AND meeting_item_id = $2 AND state = 'live'`, [o.ownerId, meeting.itemId]);
    if (live) { clog.info('rejoined call', { callId: live.call_id, meetingId: meeting.itemId }); return live.call_id; }
    const id = id128();
    let s: Stored = { mic: opts.mic, cam: opts.cam, hand: false, sharing: null, spotlight: null, breakouts: { open: null, held: [] }, chat: [], notices: [], notes: { status: 'off', everOn: false, noteId: null, recordingId: null, segment: 0, history: [] } };
    await exec(c, `INSERT INTO calls (owner_id, call_id, meeting_item_id, state, started_at, version, state_ciphertext) VALUES ($1,$2,$3,'live',now(),0,$4)`,
      [o.ownerId, id, meeting.itemId, sealJson(key(o, id), header(o, id), toJson(s))]);
    if (meeting.manifest.notes === 'on') s = notice(await startNotes(o, c, s, meeting, 0), 'Notes are on. Everyone here can see that.');
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
    const at = secondsIn(row.started_at);
    let s = settleRooms(state, at);
    const ctx = { callId, action: a.type };
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
          s = notice(await startNotes(o, c, s, meeting, at), 'You turned on notes. Everyone here can see that.');
        } else {
          if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'paused');
          s = notice({ ...s, notes: { ...s.notes, status: 'off', history: [...s.notes.history, { at, on: false }] } }, 'You turned off notes. What was written so far is kept.');
        }
        break;
      }
      case 'dismiss': s = { ...s, notices: s.notices.filter((n) => n.id !== a.id) }; break;
      case 'spotlight': {
        organizerOnly(o, row, ctx);
        // Only someone in the call can be spotlighted: today that's whoever joined, by their owner ID.
        if (a.participantId !== null && a.participantId !== o.ownerId) throw new ValidationError('That person isn’t in this call.', { context: ctx });
        s = { ...s, spotlight: a.participantId };
        break;
      }
      case 'rooms-open': {
        organizerOnly(o, row, ctx);
        if (s.breakouts.open) throw new ConflictError('Rooms are already open.', { context: ctx });
        const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
        const invited = new Set(meeting.manifest.guests.map((e) => e.toLowerCase()));
        const placed = a.rooms.flatMap((r) => r.emails);
        if (placed.some((e) => !invited.has(e))) throw new ValidationError('Only people invited to this call can be sent to a room.', { context: { ...ctx, rooms: a.rooms.length } });
        if (new Set(placed).size !== placed.length) throw new ValidationError('Someone is in two rooms. Each person goes to one room.', { context: { ...ctx, rooms: a.rooms.length } });
        s = { ...s, spotlight: null, breakouts: { ...s.breakouts, open: { rooms: a.rooms.map((r) => ({ id: id128(), name: r.name, emails: r.emails })), from: at, until: at + a.minutes * 60, message: null } } };
        break;
      }
      case 'rooms-close': {
        organizerOnly(o, row, ctx);
        const open = s.breakouts.open;
        if (!open) break;
        s = { ...s, breakouts: { open: null, held: [...s.breakouts.held, { rooms: open.rooms, from: open.from, to: at }] } };
        break;
      }
      case 'rooms-message': {
        organizerOnly(o, row, ctx);
        const open = s.breakouts.open;
        if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
        s = { ...s, breakouts: { ...s.breakouts, open: { ...open, message: { text: a.text, at } } } };
        break;
      }
    }
    await save(o, c, callId, s);
    // Action type and resulting states only; chat text and titles stay sealed.
    clog.at(a.type === 'dismiss' || a.type === 'chat' ? 'debug' : 'info', 'call action', {
      callId, action: a.type, notes: s.notes.status, segment: s.notes.segment, sharing: Boolean(s.sharing), spotlight: Boolean(s.spotlight),
      rooms: s.breakouts.open?.rooms.length ?? 0, roomsHeld: s.breakouts.held.length
    });
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

/** Transcribes a few seconds of speech into the call's live transcript, while notes are on. */
export async function transcribe(o: Owner, callId: string, clip: transcripts.Clip): Promise<CallState> {
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: clip.segment, startMs: clip.startMs, notes: state.notes.status, currentSegment: state.notes.segment };
  if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
  if (state.notes.status !== 'on' || !state.notes.recordingId || !state.notes.noteId) throw new ConflictError('Notes aren’t on right now.', { context: ctx });
  if (clip.segment !== state.notes.segment) throw new ConflictError('That speech belongs to an earlier part of the recording.', { context: ctx });
  await transcripts.hear(o, { recordingId: state.notes.recordingId, noteId: state.notes.noteId }, clip);
  return view(o, o.pool, callId);
}

/** A moment of the call (seconds since it started) as seconds into its recording, which only runs while notes are on. */
function recorded(history: Stored['notes']['history'], at: number, end: number): number {
  let total = 0;
  let onSince: number | null = null;
  for (const h of [...history, { at: end, on: false }]) {
    if (h.on && onSince === null) onSince = h.at;
    else if (!h.on && onSince !== null) { total += Math.max(0, Math.min(at, h.at) - onSince); onSince = null; }
  }
  return total;
}

/** When notes were off, from the start of the call until `now`, in seconds since it started. */
function gapsOf(history: Stored['notes']['history'], now: number): CatchUp['gaps'] {
  const gaps: CatchUp['gaps'] = [];
  let offSince: number | null = 0;
  for (const h of history) {
    if (h.on && offSince !== null) { if (h.at > offSince) gaps.push({ from: offSince, to: h.at }); offSince = null; }
    else if (!h.on && offSince === null) offSince = h.at;
  }
  if (offSince !== null && now > offSince) gaps.push({ from: offSince, to: now });
  return gaps;
}

/** A live call and its transcript so far, for the person asking. Nothing about catching up is stored. */
async function sofar(o: Owner, callId: string, what: string) {
  const { row, state: s } = await load(o, o.pool, callId);
  const ctx = { callId, what };
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: ctx });
  if (!s.notes.noteId) throw new ConflictError('Notes haven’t been on in this call, so nothing has been transcribed.', { context: ctx });
  const asOf = secondsIn(row.started_at);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const person = await me(o);
  const all = await transcripts.lines(o, o.pool, s.notes.noteId);
  const brief = (ls: transcripts.Line[]): drafting.Brief => ({
    title: meeting.manifest.title, kind: 'call', organizer: person, people: meeting.manifest.guests.map((e) => personOf(e)),
    seconds: asOf, lines: transcripts.spoken(ls, { name: person.name, person }), live: true
  });
  return { all, asOf, gaps: gapsOf(s.notes.history, asOf), person, brief };
}

/** Where the call has got to, from the live transcript: the last `minutes`, or all of it. For the person asking alone. */
export async function catchUp(o: Owner, callId: string, minutes: number | undefined): Promise<CatchUp> {
  const { all, asOf, gaps, brief } = await sofar(o, callId, 'catch-up');
  const through = all.at(-1)?.at ?? 0;
  const from = minutes ? Math.max(0, through - minutes * 60) : 0;
  const read = all.filter((l) => l.at >= from);
  const base = { from, through, lines: read.length, gaps, asOf };
  if (!read.length) return { summary: '', decided: [], proposed: [], open: [], next: [], ...base };
  const t0 = performance.now();
  const sorted = await drafting.catchUp(o.cfg, brief(read));
  clog.info('caught up during a call', { callId, minutes: minutes ?? null, lines: read.length, gaps: gaps.length, ms: Math.round(performance.now() - t0) });
  return { ...sorted, ...base };
}

/** Answers a question about the call so far, from the live transcript, for the person asking alone. */
export async function askSoFar(o: Owner, callId: string, question: string): Promise<AnswerPart[]> {
  const { all, person, brief } = await sofar(o, callId, 'ask');
  if (!all.length) throw new ConflictError('Nothing has been transcribed yet, so there’s nothing to ask about.', { context: { callId } });
  const t0 = performance.now();
  const parts = await drafting.answer(o.cfg, brief(all), person, question);
  clog.info('question answered during a call', { callId, lines: all.length, cites: parts.length - 1, ms: Math.round(performance.now() - t0) });
  return parts;
}

/**
 * Live transcript lines in another language, for the person asking. Each line is translated once
 * per language and kept sealed with the live transcript, which goes when the recording stops.
 */
export async function translate(o: Owner, callId: string, language: CaptionLanguage, lineIds: string[]): Promise<CaptionTranslation[]> {
  const { row, state: s } = await load(o, o.pool, callId);
  const ctx = { callId, language, asked: lineIds.length };
  if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
  if (!s.notes.noteId || !s.notes.recordingId) throw new ConflictError('Notes haven’t been on in this call, so there are no captions to translate.', { context: ctx });
  const asked = new Set(lineIds);
  const wanted = (await transcripts.lines(o, o.pool, s.notes.noteId)).filter((l) => asked.has(l.id));
  if (!wanted.length) return [];
  const have = await transcripts.translations(o, s.notes.noteId, wanted.map((l) => l.id), language);
  const missing = wanted.filter((l) => !have.has(l.id));
  if (missing.length) {
    const t0 = performance.now();
    const fresh = await drafting.translate(o.cfg, missing.map((l) => ({ id: l.id, text: l.text })), CAPTION_LANGUAGES.find((x) => x.code === language)?.english ?? language);
    await transcripts.keepTranslations(o, { recordingId: s.notes.recordingId, noteId: s.notes.noteId }, language, [...fresh].map(([lineId, text]) => ({ lineId, text })));
    for (const [id, text] of fresh) have.set(id, text);
    clog.info('captions translated', { ...ctx, found: wanted.length, cached: wanted.length - missing.length, translated: fresh.size, ms: Math.round(performance.now() - t0) });
  } else clog.debug('captions translated from cache', { ...ctx, found: wanted.length });
  return wanted.flatMap((l) => { const text = have.get(l.id); return text === undefined ? [] : [{ id: l.id, text }]; });
}

export async function leave(o: Owner, callId: string): Promise<CallEndResult> {
  const end = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const duration = Math.max(1, secondsIn(row.started_at));
    // Rooms still open come back when the call ends, and go into the notes with the rest.
    const open = state.breakouts.open;
    const s: Stored = open ? { ...state, breakouts: { open: null, held: [...state.breakouts.held, { rooms: open.rooms, from: open.from, to: Math.min(open.until, duration) }] } } : state;
    if (row.state === 'live') {
      await save(o, c, callId, s);
      await exec(c, `UPDATE calls SET state = 'ended', ended_at = now(), version = version + 1 WHERE owner_id = $1 AND call_id = $2`, [o.ownerId, callId]);
      if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'stopped');
      if (s.notes.noteId) await finishRecording(o, c, s.notes.noteId, duration, s.breakouts.held.map((h) => ({ ...h, from: recorded(s.notes.history, h.from, duration), to: recorded(s.notes.history, h.to, duration) })));
      await updateManifest(o, c, row.meeting_item_id, (m) => ({ ...m, status: 'ended', duration, ...(s.notes.noteId ? { noteId: s.notes.noteId } : {}) }));
    }
    clog.info(row.state === 'live' ? 'call ended' : 'left an ended call', { callId, meetingId: row.meeting_item_id, duration, noteId: s.notes.noteId });
    return { meetingId: row.meeting_item_id, pendingNoteId: s.notes.noteId, duration };
  });
  if (end.pendingNoteId) writer.kick(o, o.ownerId);
  return end;
}
export const state = (o: Owner, callId: string) => view(o, o.pool, callId);
