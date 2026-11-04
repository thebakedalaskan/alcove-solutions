import {
  CALL_TOPIC, CAPTION_LANGUAGES, CallCommitBodySchema, CallKeyPackageBodySchema, CallMessageBodySchema, type AnswerPart, type Breakouts, type CallAction, type CallCard,
  type CallEndResult, type CallMls, type CallMlsItem, type CallNudge, type CallRole, type CallState, type CallTicket, type CaptionLanguage, type CaptionTranslation, type CaptureGap,
  type CatchUp, type Person
} from '@alcove/api';
import { z } from 'zod';
import { issuePass, readPass, type CallPass } from '../callPass';
import type { Deps, Owner } from '../context';
import type { LiveKitEvent } from '../livekit';
import { b64u, id128, openJson, openRecord, sealJson, sealRecord, stateKey, toJson, unb64u } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, notFound } from '../errors';
import { openOwner } from '../owners';
import { me } from './account';
import * as drafting from './drafting';
import { personOf, portraitFor } from './portraits';
import { appendPiece, createRecording, segments, setRecordingState, type Piece } from './audio';
import * as capture from './capture';
import { lookupCode } from './codes';
import { MeetingManifest, updateManifest } from './meetings';
import type { Loaded } from '../vault';
import { getItem } from '../vault';
import { HeldRooms, blankNote, createNoteWithRecording, finishRecording } from './notes';
import * as transcripts from './transcripts';
import * as writer from './writer';
import { log } from '../log';

const clog = log.child({ component: 'calls' });

/**
 * Who is asking about a call: anyone who joined it, by their call pass. The organizer's keys are opened for
 * the request (KMASTER), so guests' catch-up and ask work without an account. `inCall`: let in (the
 * organizer always is); someone still waiting only learns whether they've been let in.
 */
export interface Viewer { pass: CallPass; organizer: Owner; isOrganizer: boolean; inCall: boolean }

const Notice = z.object({ id: z.string(), text: z.string(), kind: z.enum(['notes', 'people', 'info']) });
/** A breakout room as kept: invited people by email, shown with their names when the call is read. */
const Room = HeldRooms.shape.rooms.element;
/**
 * Everyone who has joined, by LiveKit identity, so the call can show account names and photos. Sealed: LiveKit
 * never gets names, emails or photos.
 * - `person`: the same for every connection one browser makes to the call, so removing someone removes all of them.
 * - `status`: waiting to be let in, in, left, or turned away.
 * - `admit`: whether the organizer's browser adds them without asking (invited people, and people let in before who came back).
 * - `keysFor`: the generation their latest key package is for.
 * - `inGroup`: in the current generation's MLS group (a commit added them and none has removed them).
 * - `replaced`: their pass brought them back on another connection, so it can't again.
 * - `chatBefore`: chat had been sent before they were let in, so their browser can't read all of it.
 * - `since`: when they were let in, in ms.
 */
const Joined = z.object({
  identity: z.string(), person: z.string(), role: z.enum(['host', 'invited', 'guest']), name: z.string(), email: z.string().optional(), photoUrl: z.string().optional(),
  status: z.enum(['waiting', 'in', 'left', 'denied']), admit: z.enum(['auto', 'ask']), keysFor: z.number(), inGroup: z.boolean(), replaced: z.boolean(), chatBefore: z.boolean(),
  since: z.number(), hand: z.boolean()
});
type Joined = z.infer<typeof Joined>;
const Stored = z.object({
  notes: z.object({
    /** What the call captures now (modules/capture.ts): notes off, on, or on and paused by the organizer. */
    status: capture.CaptureStatus, everOn: z.boolean(), noteId: z.string().nullable(), recordingId: z.string().nullable(), segment: z.number(),
    /** Every change to it, oldest first, so everyone can see who changed it and when, and what wasn't captured. */
    history: z.array(capture.CaptureChange),
    /** Asks for notes, the latest of each person. */
    asks: z.array(capture.NotesAsk)
  }),
  people: z.array(Joined),
  /** Who the organizer put on everyone's main stage, by identity. */
  spotlight: z.string().nullable(),
  /**
   * Breakout rooms: those open now (invited people, by email, and the room the organizer is visiting, or null
   * for the main room), and those that have closed, which go into the notes.
   */
  breakouts: z.object({
    open: z.object({ rooms: z.array(Room), from: z.number(), until: z.number(), message: z.object({ text: z.string(), at: z.number() }).nullable(), visiting: z.string().nullable() }).nullable(),
    held: z.array(HeldRooms)
  }),
  /** People (by `person`) the organizer removed: every pass of theirs stops working. */
  removed: z.array(z.string()),
  /** Whether anyone has chatted yet, so people let in later know there was chat they can't read. */
  chatEver: z.boolean(),
  notices: z.array(Notice)
});
type Stored = z.infer<typeof Stored>;
const Row = z.object({
  call_id: z.string(), meeting_item_id: z.string(), state: z.enum(['live', 'ended']), started_at: timestamp, ended_at: timestamp.nullable(), state_ciphertext: bytea,
  room_name: z.string().nullable(), host_identity: z.string().nullable(), host_joined_at: timestamp.nullable(), host_left_at: timestamp.nullable(), locked: z.boolean(),
  mls_generation: z.coerce.number().int(), mls_epoch: z.coerce.number().int(), mls_seq: z.coerce.number().int()
});
type Row = z.infer<typeof Row>;
const COLUMNS = 'call_id, meeting_item_id, state, started_at, ended_at, state_ciphertext, room_name, host_identity, host_joined_at, host_left_at, locked, mls_generation, mls_epoch, mls_seq';
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
const withPerson = (s: Stored, identity: string, change: (j: Joined) => Joined): Stored => ({ ...s, people: s.people.map((j) => (j.identity === identity ? change(j) : j)) });
const secondsIn = (startedAt: Date, at = Date.now()) => Math.max(0, Math.round((at - startedAt.getTime()) / 1000));

/** Rooms whose time is up have closed, whether or not anyone said so: everyone is back, and the rooms go to the notes. */
function settleRooms(s: Stored, now: number): Stored {
  const open = s.breakouts.open;
  if (!open || now < open.until) return s;
  return { ...s, breakouts: { open: null, held: [...s.breakouts.held, { rooms: open.rooms, from: open.from, to: open.until }] } };
}
/** Rooms as the call shows them: invited people by name, and who's in each now, by identity (the organizer too, in the room they're visiting). */
function breakoutsOf(s: Stored): Breakouts {
  const here = s.people.filter((j) => j.status === 'in');
  const open = s.breakouts.open;
  const roomsOf = (rooms: z.infer<typeof Room>[], live: boolean) => rooms.map((r) => ({
    id: r.id, name: r.name, people: r.emails.map((e) => personOf(e)),
    members: live ? here.filter((j) => (j.role === 'host' ? open?.visiting === r.id : Boolean(j.email && r.emails.includes(j.email.toLowerCase())))).map((j) => j.identity) : []
  }));
  return {
    open: open ? { rooms: roomsOf(open.rooms, true), from: open.from, until: open.until, message: open.message } : null,
    held: s.breakouts.held.map((h) => ({ rooms: roomsOf(h.rooms, false), from: h.from, to: h.to }))
  };
}

/* ---------- the call's MLS log: ordered and relayed here, read only in browsers ---------- */

type MlsKind = 'keypackage' | 'commit' | 'welcome' | 'message';
const mlsKey = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-mls:${callId}`);
const mlsHeader = (o: Owner, callId: string, seq: number, kind: MlsKind) => ({ v: 1 as const, kind: 'call-mls', ownerId: o.ownerId, callId, seq, mlsKind: kind });
const MlsRow = z.object({ seq: z.coerce.number().int(), kind: z.enum(['keypackage', 'commit', 'welcome', 'message']), party: z.string().nullable(), epoch: z.coerce.number().int(), body_ciphertext: bytea });
/** Appends to the call's log at `seq` (the caller holds the call's row lock and moves mls_seq on). */
async function appendMls(o: Owner, db: Db, callId: string, at: { seq: number; generation: number; epoch: number }, kind: MlsKind, party: string | null, body: string): Promise<void> {
  await exec(db, 'INSERT INTO call_mls (owner_id, call_id, seq, generation, kind, party, epoch, body_ciphertext) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [o.ownerId, callId, at.seq, at.generation, kind, party, at.epoch, sealRecord(mlsKey(o, callId), mlsHeader(o, callId, at.seq, kind), unb64u(body))]);
}
/** Someone whose key package the organizer's browser may act on now: asking (or invited, on their way in), or let in before and rejoining this generation's group. */
const pendingIn = (generation: number) => (j: Joined) => j.role !== 'host' && !j.inGroup && j.keysFor === generation && (j.status === 'waiting' || j.status === 'in');
/** Let in before the organizer's connection changed: they need to send a fresh key package for this generation's group. */
const needsRejoin = (j: Joined, generation: number) => j.role !== 'host' && j.status === 'in' && !j.inGroup && j.keysFor < generation;
const hostHere = (r: Pick<Row, 'state' | 'host_identity' | 'host_left_at'>) => r.state === 'live' && r.host_identity !== null && r.host_left_at === null;
/** Tells everyone in the room what changed (the call itself, its MLS log, or both), so they fetch that again. Nothing else. */
async function nudge(o: Owner, roomName: string | null, callId: string, what: { call: boolean; log: boolean }): Promise<void> {
  if (!roomName) return;
  const n: CallNudge = { v: 1, kind: 'changed', ...what };
  await o.livekit.sendData(roomName, new TextEncoder().encode(JSON.stringify(n)), CALL_TOPIC)
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
  if (s.removed.includes(pass.person)) throw new ForbiddenError('The host removed you from this call.', { context: ctx });
  if (row.state !== 'live' && !theOrganizer) throw new ConflictError('This call has ended.', { context: ctx });
  const isOrganizer = theOrganizer && pass.identity === row.host_identity;
  return { pass, organizer, isOrganizer, inCall: isOrganizer || s.people.some((j) => j.identity === pass.identity && j.status === 'in') };
}
/** Everything about a call but whether you're let in needs you to be in it. */
export function requireIn(v: Viewer, what: string): void {
  if (!v.inCall) throw new ForbiddenError('Wait until the organizer lets you in.', { context: { callId: v.pass.callId, role: v.pass.role, what } });
}

/**
 * Someone as this viewer may see them. A guest has only the link, so they see people by name and portrait
 * under their call identity: no email address (nor an ID made from one), and no photo, which loads only
 * for signed-in browsers anyway.
 */
function forViewer(v: Viewer, p: Person, identity: string): Person {
  if (v.pass.role !== 'guest') return p;
  return { id: identity, name: p.name, email: '', ...(p.portrait ? { portrait: p.portrait } : {}) };
}

async function view(v: Viewer, db: Db, callId: string): Promise<CallState> {
  const o = v.organizer;
  const { row, state: s } = await load(o, db, callId);
  const meeting = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const organizer = await me(o);
  const end = row.ended_at ?? new Date();
  const base = {
    callId, meetingId: row.meeting_item_id, code: meeting.manifest.code, title: meeting.manifest.title, startedAt: row.started_at.toISOString(),
    elapsed: Math.max(0, Math.round((end.getTime() - row.started_at.getTime()) / 1000)), phase: row.state === 'live' ? 'in-call' as const : 'ended' as const,
    locked: row.locked, generation: row.mls_generation, isOrganizer: v.isOrganizer
  };
  // Someone still waiting to be let in learns what's captured, and nothing else: nobody's name, nothing that was said.
  if (!v.inCall) return { ...base, participants: [], waiting: [], spotlight: null, breakouts: { open: null, held: [] }, capture: anonymousCapture(s, row), notes: { everOn: false, noteId: null, recording: { segment: 0, pieces: 0, seconds: 0 } }, transcript: [], notices: [] };
  const rooms = settleRooms(s, secondsIn(row.started_at, end.getTime()));
  const segs = s.notes.recordingId ? await segments(o, s.notes.recordingId) : [];
  const heard = s.notes.noteId && row.state === 'live' ? await transcripts.latest(o, db, s.notes.noteId, transcripts.LIVE_LINES) : [];
  // Who's in: whoever the organizer's browser let into the group and hasn't left. Never asked of LiveKit, so reads cost nothing there.
  const here = row.state === 'live' ? s.people.filter((j) => j.status === 'in') : [];
  const mine = s.notes.asks.find((a) => a.person === v.pass.person);
  return {
    ...base,
    participants: here.map((j) => ({ id: j.identity, person: forViewer(v, personFor(j, j.identity, j.name, organizer), j.identity), isMe: j.identity === v.pass.identity, isOrganizer: j.identity === row.host_identity, hand: j.hand })),
    spotlight: s.spotlight && here.some((j) => j.identity === s.spotlight) ? s.spotlight : null,
    breakouts: breakoutsOf(rooms),
    waiting: v.isOrganizer ? s.people.filter((j) => j.status === 'waiting' && j.admit === 'ask' && j.keysFor === row.mls_generation).map((j) => ({ id: j.identity, person: personFor(j, j.identity, j.name, organizer) })) : [],
    capture: capture.stateFor({
      status: s.notes.status, history: s.notes.history, startedAt: row.started_at, organizer: organizer.name,
      gaps: capture.gapsOf(s.notes.history, row.started_at, segs, row.ended_at ? secondsIn(row.started_at, row.ended_at.getTime()) : undefined),
      // Open asks, from whoever is in the call now: everyone sees them, like raised hands.
      requests: s.notes.asks.flatMap((a) => {
        const j = here.findLast((p) => p.person === a.person);
        return a.state === 'asking' && j ? [{ id: a.id, participantId: j.identity, at: new Date(a.at).toISOString() }] : [];
      }),
      asked: mine ? { state: mine.state, at: new Date(mine.at).toISOString() } : null
    }),
    notes: { everOn: s.notes.everOn, noteId: s.notes.noteId, recording: { segment: s.notes.segment, pieces: segs.reduce((n, g) => n + g.pieces, 0), seconds: segs.reduce((n, g) => n + g.seconds, 0) } },
    // Lines stay inside their segment once it's over, so what was said before a pause is shown before it.
    transcript: transcripts.spoken(transcripts.placed(heard, segs, s.notes.status === 'on' ? s.notes.segment : undefined), { name: organizer.name, person: forViewer(v, organizer, row.host_identity ?? 'organizer') }),
    notices: s.notices
  };
}

/** What's captured, for someone who isn't in the call (asking to join, or reading the call's card): no names, no gaps, no asks. */
function anonymousCapture(s: Stored, row: Pick<Row, 'started_at'>) {
  return capture.stateFor({ status: s.notes.status, history: s.notes.history, startedAt: row.started_at, organizer: null, gaps: [], requests: [], asked: null });
}

/**
 * Notes on, or resumed, `at` seconds into the call: the first time a note and its recording are created; after that a
 * new segment starts. Anyone who asked for notes has their answer: yes.
 */
async function startNotes(o: Owner, db: Db, s: Stored, meeting: Loaded<MeetingManifest>, at: number, by: capture.CaptureChange['by']): Promise<Stored> {
  const asks = capture.answered(s.notes.asks);
  if (s.notes.recordingId) {
    await setRecordingState(o, db, s.notes.recordingId, 'recording');
    const segment = s.notes.segment + 1;
    return { ...s, notes: { ...s.notes, status: 'on', everOn: true, segment, history: [...s.notes.history, { at, status: 'on', by, segment }], asks } };
  }
  const { noteId, recordingId } = await createNoteWithRecording(o, db,
    (rid) => blankNote({ kind: 'call', title: meeting.manifest.title, recordingId: rid, meetingId: meeting.itemId, invited: meeting.manifest.guests }),
    (nid) => createRecording(o, db, nid));
  return { ...s, notes: { ...s.notes, status: 'on', everOn: true, noteId, recordingId, segment: 0, history: [...s.notes.history, { at, status: 'on', by, segment: 0 }], asks } };
}
/** Notes paused or off, `at` seconds into the call: the recording stops taking audio until notes are on again. */
async function stopNotes(o: Owner, db: Db, s: Stored, at: number, status: 'paused' | 'off'): Promise<Stored> {
  if (s.notes.recordingId && s.notes.status === 'on') await setRecordingState(o, db, s.notes.recordingId, 'paused');
  return { ...s, notes: { ...s.notes, status, history: [...s.notes.history, { at, status, by: 'organizer', segment: s.notes.segment }] } };
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

/** What anyone with the link sees before joining: what the call captures too, without anyone's name, so they know before they ask. */
export async function card(d: Deps, code: string): Promise<CallCard> {
  const { organizer, meeting } = await meetingFor(d, code);
  const live = await liveCall(organizer, d.pool, meeting.itemId);
  const now = live ? anonymousCapture(openJson(key(organizer, live.call_id), header(organizer, live.call_id), live.state_ciphertext, Stored), live) : null;
  return {
    title: meeting.manifest.title, organizerName: (await me(organizer)).name, hostHere: live ? hostHere(live) : false, locked: live?.locked ?? false,
    notes: meeting.manifest.notes, capture: now
  };
}

const GuestName = z.string().transform((n) => n.trim()).pipe(z.string().min(1).max(60));

/**
 * Lets someone into a call by its link. The organizer hosts (one organizer connection at a time: a new one
 * takes over the recording on a new segment); invited people join with their accounts; anyone else needs a
 * name. Everyone but the organizer waits until the organizer is there, and is kept out while it's locked.
 */
export async function join(d: Deps, code: string, who: { owner?: Owner | undefined; name?: string | undefined; mic: boolean; cam: boolean; identity: string; keyPackage: string; previous?: string | undefined }): Promise<{ ticket: CallTicket; state: CallState }> {
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
  // Chosen by the browser (its key package names it): random, and new for every connection.
  const identity = who.identity;
  const joined: Joined = {
    identity, person: id128(), role, name, ...(asker && role !== 'guest' ? { email: asker.email, ...(asker.photoUrl ? { photoUrl: asker.photoUrl } : {}) } : {}),
    status: role === 'host' ? 'in' : 'waiting', admit: role === 'guest' ? 'ask' : 'auto', keysFor: 0, inGroup: role === 'host', replaced: false, chatBefore: false, since: Date.now(), hand: false
  };
  // A pass from this browser's earlier connection to the same call: someone let in before is let in again without asking.
  const earlier = who.previous ? readPass(d.cfg, who.previous) : undefined;

  const j = role === 'host' ? await hostJoin(o, meeting, joined, who) : await guestJoin(o, meeting, joined, who.keyPackage, earlier);
  // If the organizer's browser never reaches the room, the call doesn't carry on without them.
  if (role === 'host') setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after the organizer joined failed', { err })); }, HOST_GRACE_MS + 1_000).unref();
  if (j.replaced) await o.livekit.removeParticipant(j.roomName, j.replaced).catch((e: unknown) => clog.info('previous organizer connection already gone', { callId: j.callId, err: e }));
  await o.livekit.ensureRoom(j.roomName);
  // The organizer joining starts a new group (everyone fetches the call and its log); someone asking only concerns the organizer's browser.
  await nudge(o, j.roomName, j.callId, { call: role === 'host', log: true });
  clog.info(role === 'host' ? 'call joined' : 'asked to join a call', { callId: j.callId, meetingId: meeting.itemId, role, admit: j.admit, generation: j.generation });
  const pass = issuePass(d.cfg, { callId: j.callId, ownerId: o.ownerId, identity, role, name, person: j.person });
  const ticket: CallTicket = { callId: j.callId, serverUrl: d.cfg.LIVEKIT_URL, roomName: j.roomName, identity, role, pass };
  const viewer: Viewer = { pass: { v: 1, callId: j.callId, ownerId: o.ownerId, identity, role, name, person: j.person, exp: 0 }, organizer: o, isOrganizer: role === 'host', inCall: role === 'host' };
  return { ticket, state: await view(viewer, d.pool, j.callId) };
}

interface Joining { callId: string; roomName: string; replaced: string | null; row: Pick<Row, 'host_identity' | 'locked'>; state: Stored; admit: 'auto' | 'ask'; generation: number; person: string }

async function hostJoin(o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, opts: { mic: boolean; cam: boolean }): Promise<Joining> {
  return tx(o.pool, async (c) => {
    const live = await liveCall(o, c, meeting.itemId, true);
    if (!live) {
      const callId = id128();
      const roomName = `r_${id128()}`;
      let s: Stored = { people: [joined], spotlight: null, breakouts: { open: null, held: [] }, removed: [], chatEver: false, notices: [], notes: { status: 'off', everOn: false, noteId: null, recordingId: null, segment: 0, history: [], asks: [] } };
      await exec(c, `INSERT INTO calls (owner_id, call_id, meeting_item_id, state, started_at, version, state_ciphertext, room_name, host_identity, host_joined_at) VALUES ($1,$2,$3,'live',now(),0,$4,$5,$6,now())`,
        [o.ownerId, callId, meeting.itemId, sealJson(key(o, callId), header(o, callId), toJson(s)), roomName, joined.identity]);
      if (meeting.manifest.notes === 'on') s = notice(await startNotes(o, c, s, meeting, 0, 'schedule'), 'Notes are on. Everyone here can see that.');
      await save(o, c, callId, s);
      await updateManifest(o, c, meeting.itemId, (m) => ({ ...m, status: 'live' }));
      clog.info('call started', { callId, meetingId: meeting.itemId, mic: opts.mic, cam: opts.cam, notes: s.notes.status, noteId: s.notes.noteId, recordingId: s.notes.recordingId });
      return { callId, roomName, replaced: null, row: { host_identity: joined.identity, locked: false }, state: s, admit: 'auto', generation: 0, person: joined.person };
    }
    const { state } = await load(o, c, live.call_id, true);
    if (state.people.some((j) => j.identity === joined.identity)) throw new ConflictError('Join the call again.', { context: { callId: live.call_id, reason: 'identity' } });
    // A new organizer connection starts a new MLS group (the old one's keys stay with the old browser): everyone
    // already let in rejoins it without asking, the old connection's place is over, and anyone waiting keeps
    // waiting. Key packages aren't tied to a group, so theirs carry over.
    const generation = live.mls_generation + 1;
    const waiting = new Set(state.people.filter((j) => j.status === 'waiting' && j.keysFor === live.mls_generation).map((j) => j.identity));
    const kps = await rows(c, MlsRow, `SELECT seq, kind, party, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND kind = 'keypackage' ORDER BY seq`,
      [o.ownerId, live.call_id, live.mls_generation]);
    const carried = kps.flatMap((r) => (r.party && waiting.has(r.party) ? [{ party: r.party, body: b64u(openRecord(mlsKey(o, live.call_id), mlsHeader(o, live.call_id, r.seq, 'keypackage'), r.body_ciphertext)) }] : []));
    const kept = new Set(carried.map((k) => k.party));
    let s: Stored = {
      ...state,
      people: [...state.people.map((j): Joined => ({ ...j, inGroup: false, ...(j.identity === live.host_identity ? { status: 'left' as const } : {}), ...(kept.has(j.identity) ? { keysFor: generation } : {}) })),
        { ...joined, keysFor: generation, inGroup: true }]
    };
    // Taking over from another of the organizer's connections: its part of the recording ends, a new segment starts here.
    // Paused notes stay paused, and notes off stay off: only the organizer saying so changes them, never a new connection.
    if (live.host_identity && s.notes.status === 'on' && s.notes.recordingId) s = { ...s, notes: { ...s.notes, segment: s.notes.segment + 1 } };
    await save(o, c, live.call_id, s);
    const roomName = live.room_name ?? `r_${id128()}`;
    await exec(c, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, live.call_id]);
    let seq = live.mls_seq;
    for (const k of carried) { seq += 1; await appendMls(o, c, live.call_id, { seq, generation, epoch: 0 }, 'keypackage', k.party, k.body); }
    await exec(c, 'UPDATE calls SET host_identity = $3, host_joined_at = now(), host_left_at = NULL, room_name = $4, mls_generation = $5, mls_epoch = 0, mls_seq = $6, version = version + 1 WHERE owner_id = $1 AND call_id = $2',
      [o.ownerId, live.call_id, joined.identity, roomName, generation, seq]);
    clog.info('organizer rejoined call', { callId: live.call_id, meetingId: meeting.itemId, replaced: Boolean(live.host_identity), segment: s.notes.segment, generation, waiting: carried.length });
    return { callId: live.call_id, roomName, replaced: live.host_identity, row: { host_identity: joined.identity, locked: live.locked }, state: s, admit: 'auto', generation, person: joined.person };
  });
}

async function guestJoin(o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, keyPackage: string, earlier: CallPass | undefined): Promise<Joining> {
  return tx(o.pool, async (c) => {
    const live = await liveCall(o, c, meeting.itemId, true);
    if (!live || !hostHere(live) || !live.room_name) throw new ConflictError('Waiting for the host to start the call.', { context: { meetingId: meeting.itemId, role: joined.role } });
    if (live.locked) throw new ForbiddenError('The host has locked this call.', { context: { callId: live.call_id, role: joined.role } });
    const { state } = await load(o, c, live.call_id, true);
    if (state.people.some((j) => j.identity === joined.identity)) throw new ConflictError('Join the call again.', { context: { callId: live.call_id, reason: 'identity' } });
    // Back from a reload or another device: whoever was let in before (and not removed) needn't ask again, and is
    // the same person. Their old connection's place is over, and its pass can't bring anyone back again.
    const before = earlier && earlier.callId === live.call_id && !state.removed.includes(earlier.person)
      ? state.people.find((j) => j.identity === earlier.identity && j.person === earlier.person && !j.replaced && j.role !== 'host' && (j.status === 'in' || j.status === 'left')) : undefined;
    const me: Joined = { ...joined, keysFor: live.mls_generation, ...(before ? { admit: 'auto' as const, person: before.person } : {}) };
    let s: Stored = { ...state, people: [...state.people, me] };
    if (before) s = withPerson(s, before.identity, (j) => ({ ...j, status: 'left', replaced: true }));
    const seq = live.mls_seq + 1;
    await appendMls(o, c, live.call_id, { seq, generation: live.mls_generation, epoch: live.mls_epoch }, 'keypackage', me.identity, keyPackage);
    await exec(c, 'UPDATE calls SET mls_seq = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, live.call_id, seq]);
    await save(o, c, live.call_id, s);
    return { callId: live.call_id, roomName: live.room_name, replaced: null, row: live, state: s, admit: me.admit, generation: live.mls_generation, person: me.person };
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
    const at = secondsIn(row.started_at);
    let s = settleRooms(state, at);
    let locked = row.locked;
    let gone: string[] = [];
    const ctx = { callId, action: a.type };
    if (a.type === 'hand') {
      s = withPerson(s, v.pass.identity, (j) => ({ ...j, hand: a.up }));
    } else if (a.type === 'spotlight') {
      // Only someone in the call can be spotlighted.
      if (a.participantId !== null && !s.people.some((j) => j.identity === a.participantId && j.status === 'in')) throw new ValidationError('That person isn’t in this call.', { context: ctx });
      s = { ...s, spotlight: a.participantId };
    } else if (a.type === 'rooms-open') {
      if (s.breakouts.open) throw new ConflictError('Rooms are already open.', { context: ctx });
      const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
      const invited = new Set(meeting.manifest.guests.map((e) => e.toLowerCase()));
      const placed = a.rooms.flatMap((r) => r.emails);
      if (placed.some((e) => !invited.has(e))) throw new ValidationError('Only people invited to this call can be sent to a room.', { context: { ...ctx, rooms: a.rooms.length } });
      if (new Set(placed).size !== placed.length) throw new ValidationError('Someone is in two rooms. Each person goes to one room.', { context: { ...ctx, rooms: a.rooms.length } });
      s = { ...s, spotlight: null, breakouts: { ...s.breakouts, open: { rooms: a.rooms.map((r) => ({ id: id128(), name: r.name, emails: r.emails })), from: at, until: at + a.minutes * 60, message: null, visiting: null } } };
    } else if (a.type === 'rooms-close') {
      const open = s.breakouts.open;
      if (open) s = { ...s, breakouts: { open: null, held: [...s.breakouts.held, { rooms: open.rooms, from: open.from, to: at }] } };
    } else if (a.type === 'rooms-message') {
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, message: { text: a.text, at } } } };
    } else if (a.type === 'rooms-visit') {
      // The organizer is in one room at a time, or the main room: only a room of this call that's open now.
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      if (a.roomId !== null && !open.rooms.some((r) => r.id === a.roomId)) throw new ValidationError('That room isn’t open.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, visiting: a.roomId } } };
    } else if (a.type === 'deny') {
      if (!s.people.some((j) => j.identity === a.identity && j.status === 'waiting')) throw new ValidationError('That person isn’t asking to join.', { context: { callId } });
      s = withPerson(s, a.identity, (j) => ({ ...j, status: 'denied' }));
    } else if (a.type === 'remove') {
      // Every connection of theirs is out: their passes stop working here, LiveKit disconnects them, and the
      // organizer's browser takes them out of the group, so the keys move on without them.
      const target = s.people.find((j) => j.identity === a.identity);
      if (a.identity === row.host_identity || target?.role === 'host') throw new ValidationError('The organizer can’t remove themselves.', { context: { callId } });
      if (!target) throw new ValidationError('That person isn’t in this call.', { context: { callId } });
      gone = s.people.filter((j) => j.person === target.person && j.status === 'in').map((j) => j.identity);
      s = {
        ...s, removed: [...s.removed, target.person],
        people: s.people.map((j) => (j.person === target.person ? { ...j, status: j.status === 'in' ? 'left' : j.status === 'waiting' ? 'denied' : j.status } : j))
      };
    } else if (a.type === 'lock') {
      locked = a.on;
      await exec(c, 'UPDATE calls SET locked = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, locked]);
    } else {
      // To a tenth of a second, so even a short pause shows where it was.
      s = await changeCapture(v, c, row, s, a, Math.round((Date.now() - row.started_at.getTime()) / 100) / 10);
    }
    await save(o, c, callId, s);
    clog.info('call action', {
      callId, action: a.type, notes: s.notes.status, segment: s.notes.segment, asks: s.notes.asks.filter((x) => x.state === 'asking').length, connections: gone.length,
      spotlight: Boolean(s.spotlight), rooms: s.breakouts.open?.rooms.length ?? 0, visiting: Boolean(s.breakouts.open?.visiting), roomsHeld: s.breakouts.held.length
    });
    return { room: row.room_name, gone };
  }).then(async ({ room, gone }) => {
    if (room) for (const who of gone) await o.livekit.removeParticipant(room, who).catch((e: unknown) => clog.info('removed person already gone', { callId, err: e }));
    await nudge(o, room, callId, { call: true, log: a.type === 'remove' || a.type === 'deny' });
  });
  return view(v, o.pool, callId);
}

type CaptureAction = Extract<CallAction, { type: 'notes' | 'pause' | 'resume' | 'request-notes' | 'decline-notes' }>;
/**
 * What the call captures, changed (modules/capture.ts). Only the organizer turns notes on or off, pauses and resumes
 * them, and says not now to an ask (app.ts lets nobody else through). Anyone else in the call asks for notes while
 * they're off or paused, or takes the ask back. Turning notes on, or resuming, says yes to every ask.
 */
async function changeCapture(v: Viewer, c: Db, row: Row, s: Stored, a: CaptureAction, at: number): Promise<Stored> {
  const o = v.organizer;
  const ctx = { callId: row.call_id, action: a.type, notes: s.notes.status };
  const meeting = () => getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  if (a.type === 'notes') {
    if (a.on && s.notes.status !== 'on') return notice(await startNotes(o, c, s, await meeting(), at, 'organizer'), 'The organizer turned on notes. Everyone here can see that.');
    if (!a.on && s.notes.status !== 'off') return notice(await stopNotes(o, c, s, at, 'off'), 'The organizer turned off notes. What was written so far is kept.');
    return s;
  }
  if (a.type === 'pause') {
    if (s.notes.status === 'paused') return s;
    if (s.notes.status !== 'on') throw new ConflictError('Notes aren’t on, so there’s nothing to pause.', { context: ctx });
    return notice(await stopNotes(o, c, s, at, 'paused'), 'The organizer paused notes. Nothing is recorded, transcribed or sent to the AI until they resume.');
  }
  if (a.type === 'resume') {
    if (s.notes.status === 'on') return s;
    if (s.notes.status !== 'paused') throw new ConflictError('Notes are off. Turn them on instead.', { context: ctx });
    return notice(await startNotes(o, c, s, await meeting(), at, 'organizer'), 'The organizer resumed notes. Everyone here can see that.');
  }
  if (a.type === 'request-notes') {
    if (v.isOrganizer) throw new ValidationError('You can turn notes on yourself.', { context: ctx });
    // One ask each: asking again while asking changes nothing, and taking it back forgets it.
    const others = s.notes.asks.filter((x) => x.person !== v.pass.person);
    if (!a.up) return { ...s, notes: { ...s.notes, asks: others } };
    if (s.notes.status === 'on') throw new ConflictError('Notes are already on.', { context: ctx });
    if (s.notes.asks.some((x) => x.person === v.pass.person && x.state === 'asking')) return s;
    return { ...s, notes: { ...s.notes, asks: [...others, { id: id128(), person: v.pass.person, at: Date.now(), state: 'asking' }] } };
  }
  const ask = s.notes.asks.find((x) => x.id === a.requestId && x.state === 'asking');
  if (!ask) throw new ValidationError('That ask for notes isn’t open.', { context: ctx });
  return { ...s, notes: { ...s.notes, asks: s.notes.asks.map((x) => (x.id === ask.id ? { ...x, state: 'declined' as const } : x)) } };
}

/** What the capture gate needs to know about this call. */
const capturing = (row: Pick<Row, 'state'>, s: Stored): capture.Capturing => ({ live: row.state === 'live', status: s.notes.status, noteId: s.notes.noteId, recordingId: s.notes.recordingId });

export async function audio(v: Viewer, callId: string, piece: Piece): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: piece.segment, seq: piece.seq, currentSegment: state.notes.segment };
  const into = capture.mayCapture(capturing(row, state), 'audio', ctx);
  if (piece.segment !== state.notes.segment) throw new ConflictError('That audio belongs to an earlier part of the recording.', { context: ctx });
  await appendPiece(o, into.recordingId, piece);
  return view(v, o.pool, callId);
}

/** Transcribes a few seconds of speech into the call's live transcript, while notes are on. */
export async function transcribe(v: Viewer, callId: string, clip: transcripts.Clip): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: clip.segment, startMs: clip.startMs, currentSegment: state.notes.segment };
  const into = capture.mayCapture(capturing(row, state), 'speech', ctx);
  if (clip.segment !== state.notes.segment) throw new ConflictError('That speech belongs to an earlier part of the recording.', { context: ctx });
  await transcripts.hear(o, into, clip);
  await nudge(o, row.room_name, callId, { call: true, log: false });
  return view(v, o.pool, callId);
}

/* ---------- end-to-end encryption: the API orders and relays the call's MLS messages, and never reads them ---------- */

/** At most this many entries of the log in one answer; `more` says to ask again. */
const MLS_PAGE = 100;

/**
 * The call's MLS log after `after`, as this person may see it: the organizer's browser reads it from the start
 * of the generation (commits, chat, and key packages it may act on); anyone else from their welcome on, since
 * nothing before it is any use to them. Read up to the call's last seq as it stood, so nothing is skipped or
 * sent twice. Also where they stand, and for the organizer's browser whom to let in and take out.
 */
export async function mlsSync(v: Viewer, callId: string, after: number): Promise<CallMls> {
  const o = v.organizer;
  const { row, state: s } = await load(o, o.pool, callId);
  const gen = row.mls_generation;
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  // Where they stand as of this read, not the pass check's: the organizer's browser may have let them in in between.
  const organizer = v.isOrganizer && row.host_identity === v.pass.identity;
  const admission = organizer || mine?.status === 'in' ? 'in' : mine?.status === 'waiting' ? 'waiting' : 'denied';
  const quiet: CallMls = { generation: gen, epoch: row.mls_epoch, admission, organizer: row.host_identity, items: [], departed: [], pending: [], earlierChat: false, rejoin: false, latest: after, more: false };
  if (admission !== 'in' || row.state !== 'live') return quiet;
  let from = after;
  if (!organizer) {
    const welcome = await maybeOne(o.pool, z.object({ seq: z.coerce.number().int() }),
      `SELECT seq FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND kind = 'welcome' AND party = $4 ORDER BY seq DESC LIMIT 1`, [o.ownerId, callId, gen, v.pass.identity]);
    // Let in, but not into this generation's group yet: nothing to read until the welcome comes (rejoining: ask for it).
    if (!welcome) return { ...quiet, rejoin: Boolean(mine && needsRejoin(mine, gen)) };
    from = Math.max(after, welcome.seq - 1);
  }
  const found = await rows(o.pool, MlsRow,
    `SELECT seq, kind, party, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND seq > $4 AND seq <= $5
       AND (kind IN ('commit', 'message') OR (kind = 'welcome' AND party = $6) OR (kind = 'keypackage' AND $7)) ORDER BY seq LIMIT ${MLS_PAGE}`,
    [o.ownerId, callId, gen, from, row.mls_seq, v.pass.identity, organizer]);
  const pendingNow = s.people.filter(pendingIn(gen));
  const asking = new Set(pendingNow.map((j) => j.identity));
  const items: CallMlsItem[] = [];
  for (const r of found) {
    // Only key packages the organizer's browser may still act on.
    if (r.kind === 'keypackage' && !(r.party && asking.has(r.party))) continue;
    const body = b64u(openRecord(mlsKey(o, callId), mlsHeader(o, callId, r.seq, r.kind), r.body_ciphertext));
    if (r.kind === 'keypackage') { if (r.party) items.push({ kind: 'keypackage', seq: r.seq, from: r.party, body }); }
    else items.push({ kind: r.kind, seq: r.seq, epoch: r.epoch, body });
  }
  const more = found.length === MLS_PAGE;
  const latest = more ? (found.at(-1)?.seq ?? from) : Math.max(from, row.mls_seq);
  const out: CallMls = {
    ...quiet, items, latest, more, earlierChat: mine?.chatBefore ?? false,
    // For the organizer's browser: whoever is still in the group but has left (or was removed), and whom it may add now.
    departed: organizer ? s.people.filter((j) => j.status === 'left' && j.inGroup && j.role !== 'host').map((j) => j.identity) : [],
    pending: organizer ? pendingNow.map((j) => ({ id: j.identity, admit: j.admit })) : []
  };
  clog.debug('call keys synced', { callId, generation: gen, epoch: row.mls_epoch, admission, items: items.length, more, departed: out.departed.length, pending: out.pending.length, after });
  return out;
}

/**
 * A commit from the organizer's browser: who it adds and removes, and the welcome for whoever it adds. The
 * API takes exactly one commit per epoch, in order, so every browser applies the same ones. Everyone added
 * must be someone the organizer's browser may add now; a commit adding nobody and removing nobody just moves
 * the keys on.
 */
export async function mlsCommit(v: Viewer, callId: string, b: z.infer<typeof CallCommitBodySchema>): Promise<{ epoch: number }> {
  const o = v.organizer;
  const ctx = { callId, generation: b.generation, epoch: b.epoch, added: b.added.length, removed: b.removed.length };
  const room = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    if (b.generation !== row.mls_generation || b.epoch !== row.mls_epoch) {
      throw new ConflictError('The call’s keys have moved on. Catch up and try again.', { context: { ...ctx, current: row.mls_epoch, currentGeneration: row.mls_generation }, level: 'info' });
    }
    const may = pendingIn(row.mls_generation);
    const people = new Map(state.people.map((j) => [j.identity, j]));
    for (const id of b.added) {
      const j = people.get(id);
      if (!j || !may(j)) throw new ValidationError('Someone in that commit isn’t waiting to join.', { context: ctx });
    }
    if (new Set(b.added).size !== b.added.length) throw new ValidationError('Someone is in that commit twice.', { context: ctx });
    if (b.added.length && !b.welcome) throw new ValidationError('Adding people needs a welcome for them.', { context: ctx });
    let seq = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: b.epoch }, 'commit', null, b.commit);
    for (const id of b.added) {
      seq += 1;
      if (b.welcome) await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: b.epoch + 1 }, 'welcome', id, b.welcome);
    }
    await exec(c, 'UPDATE calls SET mls_epoch = $3, mls_seq = $4, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, b.epoch + 1, seq]);
    let s = state;
    const now = Date.now();
    // Newly let in: in the group from now, and told whether there was chat before. Rejoining: as they were.
    for (const id of b.added) s = withPerson(s, id, (j) => ({ ...j, status: 'in', inGroup: true, ...(j.status === 'in' ? {} : { since: now, chatBefore: state.chatEver }) }));
    for (const id of b.removed) s = withPerson(s, id, (j) => ({ ...j, inGroup: false, status: j.status === 'in' ? 'left' : j.status }));
    await save(o, c, callId, s);
    return row.room_name;
  });
  clog.info('call keys moved on', { ...ctx, next: b.epoch + 1, bytes: b.commit.length + (b.welcome?.length ?? 0) });
  await nudge(o, room, callId, { call: b.added.length > 0 || b.removed.length > 0, log: true });
  if (b.added.length && room) {
    // Whoever was just let in should reach the room soon; anyone who doesn't (their tab closed while they asked) is taken out.
    const d: Deps = { cfg: o.cfg, pool: o.pool, objects: o.objects, livekit: o.livekit };
    const ownerId = o.ownerId;
    setTimeout(() => { arrivals(d, ownerId, callId, room, Date.now()).catch((err: unknown) => clog.warn('checking who reached the room failed', { callId, err })); }, ARRIVAL_MS + 1_000).unref();
  }
  return { epoch: b.epoch + 1 };
}

/** Chat, as an MLS message from someone in the group: stored as it came, and relayed to everyone in it. */
export async function mlsMessage(v: Viewer, callId: string, b: z.infer<typeof CallMessageBodySchema>): Promise<void> {
  requireIn(v, 'chat');
  const o = v.organizer;
  const room = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId } });
    if (b.generation !== row.mls_generation || b.epoch > row.mls_epoch) throw new ConflictError('The call’s keys have moved on. Catch up and try again.', { context: { callId, epoch: b.epoch, current: row.mls_epoch }, level: 'info' });
    const seq = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: b.epoch }, 'message', null, b.message);
    await exec(c, 'UPDATE calls SET mls_seq = $3 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, seq]);
    if (!state.chatEver) await save(o, c, callId, { ...state, chatEver: true });
    return row.room_name;
  });
  // Sizes only: what was said is in the MLS message, which nobody here can read.
  clog.debug('chat relayed', { callId, epoch: b.epoch, bytes: b.message.length });
  await nudge(o, room, callId, { call: false, log: true });
}

/** A fresh key package from someone already let in, after the organizer's connection changed: the organizer's browser adds them to the new group. */
export async function mlsKeyPackage(v: Viewer, callId: string, b: z.infer<typeof CallKeyPackageBodySchema>): Promise<void> {
  requireIn(v, 'rejoin');
  const o = v.organizer;
  const room = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const mine = state.people.find((j) => j.identity === v.pass.identity);
    if (row.state !== 'live' || !mine || b.generation !== row.mls_generation || !needsRejoin(mine, row.mls_generation)) {
      throw new ConflictError('There’s nothing to rejoin.', { context: { callId, generation: b.generation, current: row.mls_generation }, level: 'info' });
    }
    const seq = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: row.mls_epoch }, 'keypackage', mine.identity, b.keyPackage);
    await exec(c, 'UPDATE calls SET mls_seq = $3 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, seq]);
    await save(o, c, callId, withPerson(state, mine.identity, (j) => ({ ...j, admit: 'auto', keysFor: row.mls_generation })));
    return row.room_name;
  });
  clog.info('rejoining a new key generation', { callId, generation: b.generation });
  await nudge(o, room, callId, { call: false, log: true });
}

/** A LiveKit token, only for someone the organizer's browser let in. It names nobody. */
export async function roomToken(v: Viewer, callId: string): Promise<{ token: string }> {
  requireIn(v, 'room');
  const { row } = await load(v.organizer, v.organizer.pool, callId);
  if (row.state !== 'live' || !row.room_name) throw new ConflictError('This call has ended.', { context: { callId } });
  return { token: await v.organizer.livekit.token({ roomName: row.room_name, identity: v.pass.identity }) };
}

/**
 * Live transcript lines in another language, for the person asking. Each line is translated once per
 * language and kept sealed with the live transcript, which goes when the recording stops.
 */
export async function translate(v: Viewer, callId: string, language: CaptionLanguage, lineIds: string[]): Promise<CaptionTranslation[]> {
  requireIn(v, 'translate');
  const o = v.organizer;
  const { row, state: s } = await load(o, o.pool, callId);
  const ctx = { callId, language, asked: lineIds.length };
  const into = capture.mayCapture(capturing(row, s), 'captions', ctx);
  const asked = new Set(lineIds);
  const wanted = (await transcripts.lines(o, o.pool, into.noteId)).filter((l) => asked.has(l.id));
  if (!wanted.length) return [];
  const have = await transcripts.translations(o, into.noteId, wanted.map((l) => l.id), language);
  const missing = wanted.filter((l) => !have.has(l.id));
  if (missing.length) {
    const t0 = performance.now();
    const fresh = await drafting.translate(o.cfg, missing.map((l) => ({ id: l.id, text: l.text })), CAPTION_LANGUAGES.find((x) => x.code === language)?.english ?? language);
    await transcripts.keepTranslations(o, into, language, [...fresh].map(([lineId, text]) => ({ lineId, text })));
    for (const [id, text] of fresh) have.set(id, text);
    clog.info('captions translated', { ...ctx, found: wanted.length, cached: wanted.length - missing.length, translated: fresh.size, ms: Math.round(performance.now() - t0) });
  } else clog.debug('captions translated from cache', { ...ctx, found: wanted.length });
  return wanted.flatMap((l) => { const text = have.get(l.id); return text === undefined ? [] : [{ id: l.id, text }]; });
}

/**
 * A live call and its transcript so far, for the person asking, with the stretches nothing was captured in. Nothing
 * about catching up is stored. Like everything that reaches the AI, it waits while notes are paused.
 */
async function sofar(o: Owner, callId: string, what: 'catch-up' | 'ask') {
  const { row, state: s } = await load(o, o.pool, callId);
  const into = capture.mayCapture(capturing(row, s), what, { callId });
  const asOf = secondsIn(row.started_at);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const person = await me(o);
  const segs = await segments(o, into.recordingId);
  const all = transcripts.placed(await transcripts.lines(o, o.pool, into.noteId), segs, s.notes.status === 'on' ? s.notes.segment : undefined);
  const brief = (ls: transcripts.Line[], gaps: CaptureGap[]): drafting.Brief => ({
    title: meeting.manifest.title, kind: 'call', organizer: person, people: meeting.manifest.guests.map((e) => personOf(e)),
    seconds: asOf, lines: transcripts.spoken(ls, { name: person.name, person }), gaps, live: true
  });
  return { all, asOf, gaps: capture.gapsOf(s.notes.history, row.started_at, segs), person, brief };
}

/** Where the call has got to, from the live transcript: the last `minutes`, or all of it. For the person asking alone. */
export async function catchUp(v: Viewer, callId: string, minutes: number | undefined): Promise<CatchUp> {
  const { all, asOf, gaps, brief } = await sofar(v.organizer, callId, 'catch-up');
  const through = all.at(-1)?.at ?? 0;
  const from = minutes ? Math.max(0, through - minutes * 60) : 0;
  const read = all.filter((l) => l.at >= from);
  // The stretches in what it read, or since: nothing said then can be in it, and it says so.
  const missing = gaps.filter((g) => g.at >= from);
  const base = { from, through, lines: read.length, gaps: missing, asOf };
  if (!read.length) return { summary: '', decided: [], proposed: [], open: [], next: [], ...base };
  const t0 = performance.now();
  const sorted = await drafting.catchUp(v.organizer.cfg, brief(read, missing));
  clog.info('caught up during a call', { callId, minutes: minutes ?? null, lines: read.length, gaps: missing.length, ms: Math.round(performance.now() - t0) });
  return { ...sorted, ...base };
}

/** Answers a question about the call so far, from the live transcript, for the person asking alone. */
export async function askSoFar(v: Viewer, callId: string, question: string): Promise<AnswerPart[]> {
  const { all, gaps, person, brief } = await sofar(v.organizer, callId, 'ask');
  if (!all.length) throw new ConflictError('Nothing has been transcribed yet, so there’s nothing to ask about.', { context: { callId } });
  const asker: Person = v.isOrganizer ? person : { id: v.pass.identity, name: v.pass.name, email: '' };
  const t0 = performance.now();
  const parts = await drafting.answer(v.organizer.cfg, brief(all, gaps), asker, question);
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
    const { row, state } = await load(o, c, callId, true);
    // Upkeep decided from an earlier read; the organizer may have come back since.
    if (unless?.(row)) return null;
    room = row.room_name;
    const duration = Math.max(1, secondsIn(row.started_at));
    // Rooms still open come back when the call ends, and go into the notes with the rest.
    const open = state.breakouts.open;
    const s: Stored = open ? { ...state, breakouts: { open: null, held: [...state.breakouts.held, { rooms: open.rooms, from: open.from, to: Math.min(open.until, duration) }] } } : state;
    if (row.state === 'live') {
      await exec(c, `UPDATE calls SET state = 'ended', ended_at = now(), version = version + 1 WHERE owner_id = $1 AND call_id = $2`, [o.ownerId, callId]);
      await save(o, c, callId, s);
      // The MLS log only matters while the call runs.
      await exec(c, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
      if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'stopped');
      if (s.notes.noteId) {
        const recorded = (at: number) => capture.recorded(s.notes.history, at, duration);
        // The stretches nothing was captured in go into the note, so it says so where they fall.
        const gaps = capture.gapsOf(s.notes.history, row.started_at, s.notes.recordingId ? await segments(o, s.notes.recordingId) : [], duration);
        await finishRecording(o, c, s.notes.noteId, duration, s.breakouts.held.map((h) => ({ ...h, from: recorded(h.from), to: recorded(h.to) })), gaps);
      }
      await updateManifest(o, c, row.meeting_item_id, (m) => ({ ...m, status: 'ended', duration, ...(s.notes.noteId ? { noteId: s.notes.noteId } : {}) }));
    }
    clog.info(row.state === 'live' ? 'call ended' : 'left an ended call', { callId, meetingId: row.meeting_item_id, duration, noteId: s.notes.noteId });
    return { meetingId: row.meeting_item_id, pendingNoteId: s.notes.noteId, duration };
  });
  if (!end) return null;
  if (end.pendingNoteId) writer.kick(o, o.ownerId);
  // Deleting the room disconnects everyone in it, which is how their browsers learn the call ended: an ended call is the organizer's alone to read.
  if (room) await o.livekit.deleteRoom(room).catch((e: unknown) => clog.warn('room not deleted', { callId, err: e }));
  return end;
}

/** The organizer leaving ends the call for everyone. Anyone else just goes: the organizer's browser takes them out of the group. */
export async function leave(v: Viewer, callId: string): Promise<CallEndResult | null> {
  if (!v.isOrganizer) {
    await departed(v.organizer, callId, v.pass.identity);
    return null;
  }
  const end = await endCall(v.organizer, callId);
  if (!end) throw new ConflictError('This call has ended.', { context: { callId } });
  return end;
}

/**
 * Someone other than the organizer is gone (left, or LiveKit says so): the organizer's browser removes them from
 * the group, so the keys move on. Someone still asking to be let in takes their request back.
 */
async function departed(o: Owner, callId: string, identity: string): Promise<void> {
  const r = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const j = state.people.find((x) => x.identity === identity && x.role !== 'host');
    if (row.state !== 'live' || !j || (j.status !== 'in' && j.status !== 'waiting')) return null;
    // Someone who was in is kept, as having left (a reload's pass brings them back). Someone who only asked is
    // forgotten, so nothing of theirs, a pass included, can bring them in without asking again.
    await save(o, c, callId, j.status === 'waiting'
      ? { ...state, people: state.people.filter((x) => x.identity !== identity) }
      : withPerson(state, identity, (x) => ({ ...x, status: 'left', hand: false })));
    return { room: row.room_name, was: j.status };
  });
  if (r) { clog.info(r.was === 'waiting' ? 'someone stopped asking to join' : 'someone left the call', { callId }); await nudge(o, r.room, callId, { call: true, log: true }); }
}

/* ---------- the call's lifecycle from LiveKit: webhooks and upkeep, with nobody's session ---------- */

/** How long the organizer's connection may be gone before the call ends: LiveKit's 20 s departure timeout, plus margin. */
const HOST_GRACE_MS = 25_000;
/** How long after LiveKit says someone left before asking it whether they're really gone. */
const LEFT_CHECK_MS = 3_000;
async function goneFromRoom(d: Deps, ownerId: string, callId: string, roomName: string | null, identity: string): Promise<void> {
  const here = roomName ? await d.livekit.participants(roomName).then((ps) => ps.some((p) => p.identity === identity), () => false) : false;
  if (here) { clog.info('left and came back to the room', { callId }); return; }
  await departed(await openOwner(d, ownerId, undefined), callId, identity);
}
/**
 * How long someone let in has to reach the room before they're taken out. A tab in the background can take a
 * minute to notice it was let in; a browser that closed or died while asking never will.
 */
export const ARRIVAL_MS = 90_000;
/**
 * Takes out whoever was let in at least ARRIVAL_MS ago and isn't in the room: they never got there, or LiveKit's
 * word that they left was missed. Nobody is taken out while LiveKit can't be asked.
 */
async function arrivals(d: Deps, ownerId: string, callId: string, roomName: string, now: number): Promise<void> {
  const o = await openOwner(d, ownerId, undefined);
  const { row, state } = await load(o, o.pool, callId);
  const due = row.state === 'live' ? state.people.filter((j) => j.role !== 'host' && j.status === 'in' && now - j.since >= ARRIVAL_MS) : [];
  if (!due.length) return;
  const here = new Set((await d.livekit.participants(roomName)).map((p) => p.identity));
  for (const j of due) {
    if (here.has(j.identity)) continue;
    clog.info('someone let in isn’t in the room', { callId, role: j.role });
    await departed(o, callId, j.identity);
  }
}
const ByRoom = z.object({ owner_id: z.string(), call_id: z.string(), host_identity: z.string().nullable() });

/** Applies a verified LiveKit webhook. Rooms are unique, so the room finds the call (and its organizer). */
export async function onRoomEvent(d: Deps, e: LiveKitEvent): Promise<void> {
  if (!e.roomName) return;
  const r = await maybeOne(d.pool, ByRoom, `SELECT owner_id, call_id, host_identity FROM calls WHERE room_name = $1 AND state = 'live'`, [e.roomName]);
  if (!r) { clog.debug('livekit event for no live call', { event: e.event }); return; }
  if (e.event === 'room_finished') { await endCall(await openOwner(d, r.owner_id, undefined), r.call_id); return; }
  if (!e.identity) return;
  if (e.identity !== r.host_identity) {
    // LiveKit says someone left: once it's clear they're really gone (a reconnect shows up as leaving and joining again), they're taken out.
    if (e.event === 'participant_left') {
      const who = e.identity;
      setTimeout(() => { goneFromRoom(d, r.owner_id, r.call_id, e.roomName, who).catch((err: unknown) => clog.warn('checking who left failed', { callId: r.call_id, err })); }, LEFT_CHECK_MS).unref();
    }
    return;
  }
  if (e.event === 'participant_left') {
    // A reload or a dropped connection: the call ends only if the organizer doesn't come back in time.
    await exec(d.pool, 'UPDATE calls SET host_left_at = now() WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [r.owner_id, r.call_id, e.identity]);
    clog.info('organizer connection left', { callId: r.call_id });
    setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after the organizer left failed', { err })); }, HOST_GRACE_MS + 1_000).unref();
  } else if (e.event === 'participant_joined') {
    await exec(d.pool, 'UPDATE calls SET host_left_at = NULL WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [r.owner_id, r.call_id, e.identity]);
  }
}

const LiveCall = z.object({ owner_id: z.string(), call_id: z.string(), room_name: z.string(), host_identity: z.string().nullable(), host_joined_at: timestamp.nullable(), host_left_at: timestamp.nullable(), started_at: timestamp });
type LiveCall = z.infer<typeof LiveCall>;

/**
 * Ends live calls whose organizer has been gone past the grace period (left, or never reached the room),
 * or whose room LiveKit no longer has. Whether the organizer is in the room is asked of LiveKit, so a
 * missed webhook neither ends a call nor keeps one going.
 */
export async function reconcile(d: Deps, now = Date.now()): Promise<number> {
  let ended = 0;
  // Every live call, a page at a time.
  for (let last: { at: Date; id: string } | null = null; ;) {
    const page: LiveCall[] = await rows(d.pool, LiveCall, `SELECT owner_id, call_id, room_name, host_identity, host_joined_at, host_left_at, started_at FROM calls
      WHERE state = 'live' AND room_name IS NOT NULL AND ($1::timestamptz IS NULL OR (started_at, call_id) > ($1::timestamptz, $2)) ORDER BY started_at, call_id LIMIT 500`, [last?.at ?? null, last?.id ?? '']);
    if (!page.length) break;
    const tail: LiveCall | undefined = page.at(-1);
    last = tail ? { at: tail.started_at, id: tail.call_id } : null;
    ended += await reconcilePage(d, page, now);
    if (page.length < 500) break;
  }
  return ended;
}
async function reconcilePage(d: Deps, live: LiveCall[], now: number): Promise<number> {
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
    if (!hostGone && !roomGone) {
      await arrivals(d, c.owner_id, c.call_id, c.room_name, now).catch((err: unknown) => clog.warn('checking who reached the room failed', { callId: c.call_id, err }));
      continue;
    }
    const end = await endCall(await openOwner(d, c.owner_id, undefined), c.call_id, (r) => !roomGone && r.host_identity !== c.host_identity);
    if (!end) continue;
    clog.info('call ended without the organizer', { callId: c.call_id, reason: hostGone ? 'organizer gone' : 'room gone' });
    ended++;
  }
  return ended;
}
export const state = (v: Viewer, callId: string) => view(v, v.organizer.pool, callId);
