import {
  CALL_TOPIC, type AnswerPart, type CallAction, type CallCard, type CallEndResult, type CallRole, type CallState, type CallTicket, type CatchUp, type Person
} from '@alcove/api';
import { z } from 'zod';
import { issuePass, type CallPass } from '../callPass';
import type { Deps, Owner } from '../context';
import type { LiveKitEvent } from '../livekit';
import { id128, openJson, sealJson, stateKey, toJson } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, notFound } from '../errors';
import { openOwner } from '../owners';
import { me } from './account';
import * as drafting from './drafting';
import { personOf, portraitFor } from './portraits';
import { appendPiece, createRecording, progress, setRecordingState, type Piece } from './audio';
import { lookupCode } from './codes';
import { MeetingManifest, updateManifest } from './meetings';
import type { Loaded } from '../vault';
import { getItem } from '../vault';
import { blankNote, createNoteWithRecording, finishRecording } from './notes';
import * as transcripts from './transcripts';
import * as writer from './writer';
import { log } from '../log';

const clog = log.child({ component: 'calls' });

/**
 * Who is asking about a call: anyone in it, by their call pass. The organizer's keys are opened for the
 * request (KMASTER), so guests' chat, catch-up and ask work without an account.
 */
export interface Viewer { pass: CallPass; organizer: Owner; isOrganizer: boolean }

const Notice = z.object({ id: z.string(), text: z.string(), kind: z.enum(['notes', 'people', 'info']) });
/** Everyone who has joined, by LiveKit identity, so the call can show account names and photos. Sealed: LiveKit never gets emails or photos. */
const Joined = z.object({ identity: z.string(), role: z.enum(['host', 'invited', 'guest']), name: z.string(), email: z.string().optional(), photoUrl: z.string().optional() });
type Joined = z.infer<typeof Joined>;
const Stored = z.object({
  notes: z.object({
    status: z.enum(['off', 'on']), everOn: z.boolean(), noteId: z.string().nullable(), recordingId: z.string().nullable(), segment: z.number(),
    /** Each time notes went on or off, in seconds since the call started, so a catch-up can say what it's missing. */
    history: z.array(z.object({ at: z.number(), on: z.boolean() }))
  }),
  /** `from` is the sender's LiveKit identity, resolved through `people` when shown. */
  chat: z.array(z.object({ id: z.string(), text: z.string(), at: z.number(), from: z.string() })),
  people: z.array(Joined),
  /** Identities the organizer removed: their passes stop working. */
  removed: z.array(z.string()),
  notices: z.array(Notice)
});
type Stored = z.infer<typeof Stored>;
const Row = z.object({
  call_id: z.string(), meeting_item_id: z.string(), state: z.enum(['live', 'ended']), started_at: timestamp, ended_at: timestamp.nullable(), state_ciphertext: bytea,
  room_name: z.string().nullable(), host_identity: z.string().nullable(), host_joined_at: timestamp.nullable(), host_left_at: timestamp.nullable(), locked: z.boolean()
});
type Row = z.infer<typeof Row>;
const COLUMNS = 'call_id, meeting_item_id, state, started_at, ended_at, state_ciphertext, room_name, host_identity, host_joined_at, host_left_at, locked';
const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call:${callId}`);
const header = (o: Owner, callId: string) => ({ v: 1 as const, kind: 'call-state', ownerId: o.ownerId, callId });

async function load(o: Owner, db: Db, callId: string, lock = false) {
  const r = await maybeOne(db, Row, `SELECT ${COLUMNS} FROM calls WHERE owner_id = $1 AND call_id = $2${lock ? ' FOR UPDATE' : ''}`, [o.ownerId, callId]);
  if (!r) throw notFound('That call');
  return { row: r, state: openJson(key(o, callId), header(o, callId), r.state_ciphertext, Stored) };
}
async function save(o: Owner, db: Db, callId: string, s: Stored) {
  await exec(db, 'UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, sealJson(key(o, callId), header(o, callId), toJson(s))]);
}
const notice = (s: Stored, text: string, kind: 'notes' | 'people' | 'info' = 'notes'): Stored => ({ ...s, notices: [...s.notices.slice(-2), { id: id128(), text, kind }] });
const hostHere = (r: Pick<Row, 'state' | 'host_identity' | 'host_left_at'>) => r.state === 'live' && r.host_identity !== null && r.host_left_at === null;
/** Tells everyone in the room the call changed (chat, notes, transcript, people), so they fetch it again. */
async function nudge(o: Owner, roomName: string | null, callId: string): Promise<void> {
  if (!roomName) return;
  await o.livekit.sendData(roomName, new TextEncoder().encode(JSON.stringify({ v: 1, kind: 'changed' })), CALL_TOPIC)
    .catch((e: unknown) => clog.warn('room not told about a change', { callId, err: e }));
}

/** Someone as the call shows them: the organizer and invited people by their account, guests by the name they typed. */
function personFor(j: Joined | undefined, identity: string, fallbackName: string, organizer: Person): Person {
  if (j?.role === 'host') return organizer;
  if (j?.email) return { ...personOf(j.email, j.name), ...(j.photoUrl ? { photoUrl: j.photoUrl } : {}) };
  return { id: identity, name: j?.name ?? fallbackName, email: '', portrait: portraitFor(identity) };
}

/**
 * Who a call pass belongs to, for this request. A removed person's pass stops working, and once the call is
 * over only the organizer can read it. Host powers go with the organizer's current connection only, and
 * only together with the organizer's own session.
 */
export async function viewerOf(d: Deps, pass: CallPass, sessionOwnerId: string | undefined): Promise<Viewer> {
  const organizer = await openOwner(d, pass.ownerId, undefined);
  const { row, state: s } = await load(organizer, organizer.pool, pass.callId);
  const theOrganizer = pass.role === 'host' && sessionOwnerId === pass.ownerId;
  const ctx = { callId: pass.callId, role: pass.role };
  if (s.removed.includes(pass.identity)) throw new ForbiddenError('The host removed you from this call.', { context: ctx });
  if (row.state !== 'live' && !theOrganizer) throw new ConflictError('This call has ended.', { context: ctx });
  return { pass, organizer, isOrganizer: theOrganizer && pass.identity === row.host_identity };
}

async function view(v: Viewer, db: Db, callId: string): Promise<CallState> {
  const o = v.organizer;
  const { row, state: s } = await load(o, db, callId);
  const meeting = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const organizer = await me(o);
  const end = row.ended_at ?? new Date();
  const heard = s.notes.noteId && row.state === 'live' ? (await transcripts.lines(o, db, s.notes.noteId)).slice(-transcripts.LIVE_LINES) : [];
  const joined = new Map(s.people.map((j) => [j.identity, j]));
  // Who's connected comes from LiveKit; if it can't be asked, the call still answers (with just you).
  const here = row.room_name && row.state === 'live'
    ? await o.livekit.participants(row.room_name).catch((e: unknown) => { clog.warn('could not ask LiveKit who is in the call', { callId, err: e }); return []; })
    : [];
  if (row.state === 'live' && !here.some((p) => p.identity === v.pass.identity)) here.push({ identity: v.pass.identity, name: v.pass.name });
  return {
    callId, meetingId: row.meeting_item_id, code: meeting.manifest.code, title: meeting.manifest.title, startedAt: row.started_at.toISOString(),
    elapsed: Math.max(0, Math.round((end.getTime() - row.started_at.getTime()) / 1000)), phase: row.state === 'live' ? 'in-call' : 'ended',
    participants: here.map((p) => ({ id: p.identity, person: personFor(joined.get(p.identity), p.identity, p.name, organizer), isMe: p.identity === v.pass.identity, isOrganizer: p.identity === row.host_identity })),
    locked: row.locked,
    notes: { status: s.notes.status, everOn: s.notes.everOn, noteId: s.notes.noteId, recording: await progress(o, s.notes.recordingId, s.notes.segment) },
    chat: s.chat.map((m) => ({ id: m.id, from: personFor(joined.get(m.from), m.from, 'Someone', organizer), isMe: m.from === v.pass.identity, text: m.text, at: m.at })),
    transcript: transcripts.spoken(heard, { name: organizer.name, person: organizer }),
    notices: s.notices, isOrganizer: v.isOrganizer
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

/* ---------- joining by link: for anyone; the organizer's keys are opened with KMASTER ---------- */

async function meetingFor(d: Deps, code: string) {
  const link = await lookupCode(d, code);
  if (!link) throw new NotFoundError('There’s no call with that code. Check the link and try again.');
  const organizer = await openOwner(d, link.ownerId, undefined);
  const meeting = await getItem(organizer, d.pool, 'meeting', link.meetingId, MeetingManifest, 'That meeting');
  return { organizer, meeting };
}
const liveCall = (o: Owner, db: Db, meetingId: string, lock = false) => maybeOne(db, Row,
  `SELECT ${COLUMNS} FROM calls WHERE owner_id = $1 AND meeting_item_id = $2 AND state = 'live' ORDER BY started_at DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [o.ownerId, meetingId]);

/** What anyone with the link sees before joining. */
export async function card(d: Deps, code: string): Promise<CallCard> {
  const { organizer, meeting } = await meetingFor(d, code);
  const live = await liveCall(organizer, d.pool, meeting.itemId);
  return { title: meeting.manifest.title, organizerName: (await me(organizer)).name, hostHere: live ? hostHere(live) : false, locked: live?.locked ?? false };
}

const GuestName = z.string().transform((n) => n.trim()).pipe(z.string().min(1).max(60));

/**
 * Lets someone into a call by its link. The organizer hosts (one organizer connection at a time: a new one
 * takes over the recording on a new segment); invited people join with their accounts; anyone else needs a
 * name. Everyone but the organizer waits until the organizer is there, and is kept out while it's locked.
 */
export async function join(d: Deps, code: string, who: { owner?: Owner | undefined; name?: string | undefined; mic: boolean; cam: boolean }): Promise<{ ticket: CallTicket; state: CallState }> {
  const { organizer: o, meeting } = await meetingFor(d, code);
  const asker = who.owner ? await me(who.owner) : undefined;
  const role: CallRole = who.owner?.ownerId === o.ownerId ? 'host'
    : asker && meeting.manifest.guests.some((g) => g.toLowerCase() === asker.email.toLowerCase()) ? 'invited' : 'guest';
  let name: string;
  if (asker && role !== 'guest') name = asker.name;
  else {
    const parsed = GuestName.safeParse(who.name ?? asker?.name ?? '');
    if (!parsed.success) throw new ValidationError('Enter your name to join.', { context: { role } });
    name = parsed.data;
  }
  const identity = `p_${id128()}`;
  const joined: Joined = { identity, role, name, ...(asker && role !== 'guest' ? { email: asker.email, ...(asker.photoUrl ? { photoUrl: asker.photoUrl } : {}) } : {}) };

  const j = role === 'host' ? await hostJoin(o, meeting, joined, who) : await guestJoin(o, meeting, joined);
  // If the organizer's browser never reaches the room, the call doesn't carry on without them.
  if (role === 'host') setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after the organizer joined failed', { err })); }, HOST_GRACE_MS + 1_000).unref();
  if (j.replaced) await o.livekit.removeParticipant(j.roomName, j.replaced).catch((e: unknown) => clog.info('previous organizer connection already gone', { callId: j.callId, err: e }));
  await o.livekit.ensureRoom(j.roomName);
  await nudge(o, j.roomName, j.callId);
  clog.info('call joined', { callId: j.callId, meetingId: meeting.itemId, role });
  const pass = issuePass(d.cfg, { callId: j.callId, ownerId: o.ownerId, identity, role, name });
  const ticket: CallTicket = { callId: j.callId, serverUrl: d.cfg.LIVEKIT_URL, token: await o.livekit.token({ roomName: j.roomName, identity, name }), roomName: j.roomName, identity, role, pass };
  const viewer: Viewer = { pass: { v: 1, callId: j.callId, ownerId: o.ownerId, identity, role, name, exp: 0 }, organizer: o, isOrganizer: role === 'host' };
  return { ticket, state: await view(viewer, d.pool, j.callId) };
}

interface Joining { callId: string; roomName: string; replaced: string | null; row: Pick<Row, 'host_identity' | 'locked'>; state: Stored }

async function hostJoin(o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, opts: { mic: boolean; cam: boolean }): Promise<Joining> {
  return tx(o.pool, async (c) => {
    const live = await liveCall(o, c, meeting.itemId, true);
    if (!live) {
      const callId = id128();
      const roomName = `r_${id128()}`;
      let s: Stored = { chat: [], people: [joined], removed: [], notices: [], notes: { status: 'off', everOn: false, noteId: null, recordingId: null, segment: 0, history: [] } };
      await exec(c, `INSERT INTO calls (owner_id, call_id, meeting_item_id, state, started_at, version, state_ciphertext, room_name, host_identity, host_joined_at) VALUES ($1,$2,$3,'live',now(),0,$4,$5,$6,now())`,
        [o.ownerId, callId, meeting.itemId, sealJson(key(o, callId), header(o, callId), toJson(s)), roomName, joined.identity]);
      if (meeting.manifest.notes === 'on') s = notice(await startNotes(o, c, s, meeting, 0), 'Notes are on. Everyone here can see that.');
      await save(o, c, callId, s);
      await updateManifest(o, c, meeting.itemId, (m) => ({ ...m, status: 'live' }));
      clog.info('call started', { callId, meetingId: meeting.itemId, mic: opts.mic, cam: opts.cam, notes: s.notes.status, noteId: s.notes.noteId, recordingId: s.notes.recordingId });
      return { callId, roomName, replaced: null, row: { host_identity: joined.identity, locked: false }, state: s };
    }
    const { state } = await load(o, c, live.call_id, true);
    let s: Stored = { ...state, people: [...state.people, joined] };
    // Taking over from another of the organizer's connections: its part of the recording ends, a new segment starts here.
    if (live.host_identity && s.notes.status === 'on' && s.notes.recordingId) s = { ...s, notes: { ...s.notes, segment: s.notes.segment + 1 } };
    await save(o, c, live.call_id, s);
    const roomName = live.room_name ?? `r_${id128()}`;
    await exec(c, 'UPDATE calls SET host_identity = $3, host_joined_at = now(), host_left_at = NULL, room_name = $4, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, live.call_id, joined.identity, roomName]);
    clog.info('organizer rejoined call', { callId: live.call_id, meetingId: meeting.itemId, replaced: Boolean(live.host_identity), segment: s.notes.segment });
    return { callId: live.call_id, roomName, replaced: live.host_identity, row: { host_identity: joined.identity, locked: live.locked }, state: s };
  });
}

async function guestJoin(o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined): Promise<Joining> {
  return tx(o.pool, async (c) => {
    const live = await liveCall(o, c, meeting.itemId, true);
    if (!live || !hostHere(live) || !live.room_name) throw new ConflictError('Waiting for the host to start the call.', { context: { meetingId: meeting.itemId, role: joined.role } });
    if (live.locked) throw new ForbiddenError('The host has locked this call.', { context: { callId: live.call_id, role: joined.role } });
    const { state } = await load(o, c, live.call_id, true);
    const s: Stored = { ...state, people: [...state.people, joined] };
    await save(o, c, live.call_id, s);
    return { callId: live.call_id, roomName: live.room_name, replaced: null, row: live, state: s };
  });
}

/* ---------- during the call: the organizer's controls, and what anyone in it can do ---------- */

export async function act(v: Viewer, callId: string, a: CallAction): Promise<CallState> {
  const o = v.organizer;
  if (a.type === 'mute') {
    // Carried out by LiveKit; nothing about the call changes here.
    const { row } = await load(o, o.pool, callId);
    if (row.state !== 'live' || !row.room_name) throw new ConflictError('This call has ended.', { context: { callId, action: a.type } });
    await o.livekit.muteTrack(row.room_name, a.identity, a.trackSid);
    clog.info('host control', { callId, action: a.type, target: a.identity });
    return view(v, o.pool, callId);
  }
  await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, action: a.type } });
    const at = Math.round((Date.now() - row.started_at.getTime()) / 1000);
    let s = state;
    // Chat from anyone in the call, saved with it under the organizer's keys.
    let locked = row.locked;
    if (a.type === 'chat') s = { ...s, chat: [...s.chat, { id: id128(), text: a.text, at, from: v.pass.identity }] };
    else if (a.type === 'remove') {
      // Their pass stops working here; LiveKit disconnects them once this is saved. They can join again unless it's locked.
      if (a.identity === row.host_identity) throw new ValidationError('The organizer can’t remove themselves.', { context: { callId } });
      s = { ...s, removed: [...s.removed, a.identity] };
    } else if (a.type === 'lock') {
      locked = a.on;
      await exec(c, 'UPDATE calls SET locked = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, locked]);
    } else if (a.on !== (s.notes.status === 'on')) {
      if (a.on) {
        const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
        s = notice(await startNotes(o, c, s, meeting, at), 'The organizer turned on notes. Everyone here can see that.');
      } else {
        if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'paused');
        s = notice({ ...s, notes: { ...s.notes, status: 'off', history: [...s.notes.history, { at, on: false }] } }, 'The organizer turned off notes. What was written so far is kept.');
      }
    }
    await save(o, c, callId, s);
    // Action type and resulting states only; chat text stays sealed.
    clog.at(a.type === 'chat' ? 'debug' : 'info', 'call action', { callId, action: a.type, notes: s.notes.status, segment: s.notes.segment });
    return row.room_name;
  }).then(async (room) => {
    if (a.type === 'remove' && room) await o.livekit.removeParticipant(room, a.identity).catch((e: unknown) => clog.info('removed person already gone', { callId, err: e }));
    await nudge(o, room, callId);
  });
  return view(v, o.pool, callId);
}

export async function audio(v: Viewer, callId: string, piece: Piece): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: piece.segment, seq: piece.seq, notes: state.notes.status, currentSegment: state.notes.segment };
  if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
  if (state.notes.status !== 'on' || !state.notes.recordingId) throw new ConflictError('Notes aren’t recording right now.', { context: ctx });
  if (piece.segment !== state.notes.segment) throw new ConflictError('That audio belongs to an earlier part of the recording.', { context: ctx });
  await appendPiece(o, state.notes.recordingId, piece);
  return view(v, o.pool, callId);
}

/** Transcribes a few seconds of speech into the call's live transcript, while notes are on. */
export async function transcribe(v: Viewer, callId: string, clip: transcripts.Clip): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: clip.segment, startMs: clip.startMs, notes: state.notes.status, currentSegment: state.notes.segment };
  if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
  if (state.notes.status !== 'on' || !state.notes.recordingId || !state.notes.noteId) throw new ConflictError('Notes aren’t on right now.', { context: ctx });
  if (clip.segment !== state.notes.segment) throw new ConflictError('That speech belongs to an earlier part of the recording.', { context: ctx });
  await transcripts.hear(o, { recordingId: state.notes.recordingId, noteId: state.notes.noteId }, clip);
  await nudge(o, row.room_name, callId);
  return view(v, o.pool, callId);
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
  const asOf = Math.max(0, Math.round((Date.now() - row.started_at.getTime()) / 1000));
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
export async function catchUp(v: Viewer, callId: string, minutes: number | undefined): Promise<CatchUp> {
  const { all, asOf, gaps, brief } = await sofar(v.organizer, callId, 'catch-up');
  const through = all.at(-1)?.at ?? 0;
  const from = minutes ? Math.max(0, through - minutes * 60) : 0;
  const read = all.filter((l) => l.at >= from);
  const base = { from, through, lines: read.length, gaps, asOf };
  if (!read.length) return { summary: '', decided: [], proposed: [], open: [], next: [], ...base };
  const t0 = performance.now();
  const sorted = await drafting.catchUp(v.organizer.cfg, brief(read));
  clog.info('caught up during a call', { callId, minutes: minutes ?? null, lines: read.length, gaps: gaps.length, ms: Math.round(performance.now() - t0) });
  return { ...sorted, ...base };
}

/** Answers a question about the call so far, from the live transcript, for the person asking alone. */
export async function askSoFar(v: Viewer, callId: string, question: string): Promise<AnswerPart[]> {
  const { all, person, brief } = await sofar(v.organizer, callId, 'ask');
  if (!all.length) throw new ConflictError('Nothing has been transcribed yet, so there’s nothing to ask about.', { context: { callId } });
  const asker: Person = v.isOrganizer ? person : { id: v.pass.identity, name: v.pass.name, email: '' };
  const t0 = performance.now();
  const parts = await drafting.answer(v.organizer.cfg, brief(all), asker, question);
  clog.info('question answered during a call', { callId, lines: all.length, cites: parts.length - 1, ms: Math.round(performance.now() - t0) });
  return parts;
}

/**
 * Ends the call for everyone: the recording stops, the transcript moves into the note, the note goes to
 * everyone invited, and the LiveKit room goes. The organizer leaving, a webhook and upkeep all end it here.
 */
async function endCall(o: Owner, callId: string, unless?: (r: Row) => boolean): Promise<CallEndResult | null> {
  let room: string | null = null;
  const end = await tx(o.pool, async (c) => {
    const { row, state: s } = await load(o, c, callId, true);
    // Upkeep decided from an earlier read; the organizer may have come back since.
    if (unless?.(row)) return null;
    room = row.room_name;
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
  if (!end) return null;
  if (end.pendingNoteId) writer.kick(o, o.ownerId);
  await nudge(o, room, callId);
  if (room) await o.livekit.deleteRoom(room).catch((e: unknown) => clog.warn('room not deleted', { callId, err: e }));
  return end;
}

/** The organizer leaving ends the call for everyone. */
export async function leave(v: Viewer, callId: string): Promise<CallEndResult> {
  const end = await endCall(v.organizer, callId);
  if (!end) throw new ConflictError('This call has ended.', { context: { callId } });
  return end;
}

/* ---------- the call's lifecycle from LiveKit: webhooks and upkeep, with nobody's session ---------- */

/** How long the organizer's connection may be gone before the call ends: LiveKit's 20 s departure timeout, plus margin. */
const HOST_GRACE_MS = 25_000;
const ByRoom = z.object({ owner_id: z.string(), call_id: z.string(), host_identity: z.string().nullable() });

/** Applies a verified LiveKit webhook. Rooms are unique, so the room finds the call (and its organizer). */
export async function onRoomEvent(d: Deps, e: LiveKitEvent): Promise<void> {
  if (!e.roomName) return;
  const r = await maybeOne(d.pool, ByRoom, `SELECT owner_id, call_id, host_identity FROM calls WHERE room_name = $1 AND state = 'live'`, [e.roomName]);
  if (!r) { clog.debug('livekit event for no live call', { event: e.event }); return; }
  if (e.event === 'room_finished') { await endCall(await openOwner(d, r.owner_id, undefined), r.call_id); return; }
  if (!e.identity || e.identity !== r.host_identity) return;
  if (e.event === 'participant_left') {
    // A reload or a dropped connection: the call ends only if the organizer doesn't come back in time.
    await exec(d.pool, 'UPDATE calls SET host_left_at = now() WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [r.owner_id, r.call_id, e.identity]);
    clog.info('organizer connection left', { callId: r.call_id });
    setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after the organizer left failed', { err })); }, HOST_GRACE_MS + 1_000).unref();
  } else if (e.event === 'participant_joined') {
    await exec(d.pool, 'UPDATE calls SET host_left_at = NULL WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [r.owner_id, r.call_id, e.identity]);
  }
}

/**
 * Ends live calls whose organizer has been gone past the grace period (left, or never reached the room),
 * or whose room LiveKit no longer has. Whether the organizer is in the room is asked of LiveKit, so a
 * missed webhook neither ends a call nor keeps one going.
 */
export async function reconcile(d: Deps, now = Date.now()): Promise<number> {
  const Live = z.object({ owner_id: z.string(), call_id: z.string(), room_name: z.string(), host_identity: z.string().nullable(), host_joined_at: timestamp.nullable(), host_left_at: timestamp.nullable(), started_at: timestamp });
  const live = await rows(d.pool, Live, `SELECT owner_id, call_id, room_name, host_identity, host_joined_at, host_left_at, started_at FROM calls WHERE state = 'live' AND room_name IS NOT NULL ORDER BY started_at LIMIT 500`);
  const rooms = await d.livekit.existingRooms(live.flatMap((c) => (now - c.started_at.getTime() > 60_000 ? [c.room_name] : [])));
  let ended = 0;
  for (const c of live) {
    const since = c.host_left_at ?? c.host_joined_at;
    let hostGone = since !== null && now - since.getTime() > HOST_GRACE_MS;
    if (hostGone) {
      const inRoom = await d.livekit.participants(c.room_name).then((ps) => ps.some((p) => p.identity === c.host_identity), () => true);
      if (inRoom) {
        hostGone = false;
        if (c.host_left_at) await exec(d.pool, 'UPDATE calls SET host_left_at = NULL WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [c.owner_id, c.call_id, c.host_identity]);
      }
    }
    const roomGone = now - c.started_at.getTime() > 60_000 && !rooms.has(c.room_name);
    if (!hostGone && !roomGone) continue;
    const end = await endCall(await openOwner(d, c.owner_id, undefined), c.call_id, (r) => !roomGone && r.host_identity !== c.host_identity);
    if (!end) continue;
    clog.info('call ended without the organizer', { callId: c.call_id, reason: hostGone ? 'organizer gone' : 'room gone' });
    ended++;
  }
  return ended;
}
export const state = (v: Viewer, callId: string) => view(v, v.organizer.pool, callId);
