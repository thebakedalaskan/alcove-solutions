import {
  CALL_TOPIC, CAPTION_LANGUAGES, LIVE_TRANSCRIPT_LINES, CallBackBodySchema, CallCommitBodySchema, CallKeyPackageBodySchema, CallMessageBodySchema, MAIN_PLACE, MAX_CALL_IDEAS, firstName, type Breakouts,
  type BoardCheck, type CallAction, type CallBoard, type CallBoardIdea, type CallAnswer, type CallCard, type CallEndResult, type CallHost, type CallMls, type CallMlsGroup, type CallMlsItem, type CallMoment, type CallNudge, type CallRole,
  type CallState, type CallTicket, type CaptionLanguage, type CaptionTranslation, type CaptureGap, type CatchUp, type CatchUpRange, type CatchUpWindow, type Changer, type LiveNotes, type Person,
  type CallFollowUps, type CallWorkspace, type CallWorkspaceAsk, type CallWorkspaceSwitch, type DocFollowUpTick, type RingReply, type ScreenFrameReceipt, type SeriesAnswerPart, type Speaker
} from '@alcove/api';
import { z } from 'zod';
import { issuePass, readPass, type CallPass } from '../callPass';
import type { Deps, Owner } from '../context';
import type { LiveKitEvent } from '../livekit';
import { b64u, id128, mac, openJson, openRecord, sealJson, sealRecord, stateKey, toJson, unb64u, utf8 } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { AuthError, ConflictError, ForbiddenError, NotFoundError, UnavailableError, ValidationError, notFound } from '../errors';
import { findOwner, openOwner } from '../owners';
import { me, profile } from './account';
import { CallBoards, CallSpace, NO_BOARDS, NO_SPACE, withOpenBoards, withWorked, type Controller, type FoundRoomBoard, type Landing, type RoomBoard, type StoredIdea, type WorkedBy, type WorkedDocument } from './callSpace';
import * as space from './callWorkspace';
import * as boards from './callBoards';
import * as catchup from './catchup';
import * as drafting from './drafting';
import * as liveNotes from './liveNotes';
import * as personal from './personal';
import { personOf, portraitFor } from './portraits';
import { appendPiece, createRecording, queueDelete, segments, setRecordingState, type Piece } from './audio';
import * as capture from './capture';
import { dropInvites, notesCanGo, syncAccess } from './access';
import { lookupCode } from './codes';
import { MeetingManifest, minutesOf, pickTime, updateManifest } from './meetings';
import { callFor, zoneOf } from './repeats';
import type { Loaded } from '../vault';
import { findItem, getItem } from '../vault';
import { blankNote, createNoteWithRecording, finishRecording, type HeldRoom } from './notes';
import { addToInvite, addedFromLink, takeOffInvite } from './invites';
import { mayStandIn, noticesFor, standIns, type HostChange } from './hosting';
import {
  BreakoutState, Joined, boardPlace, chatSince, committerOf, departedFrom, epochIn, groupOf, mainScribeOf, needsKeys, pendingFor, placeAt, placeOf, placesOf, readableBy, readerOf, readersAt, relocate,
  type Room
} from './places';
import * as rings from './rings';
import { keepRooms, scribeAt, scribedIn, scribeOf } from './scribes';
import * as screens from './screens';
import * as series from './series';
import * as transcripts from './transcripts';
import { readerInCall, serverWorkspace, trashOf, workspaceOwner, type CallRef } from './workspaceAccess';
import { endSeat, endSeats, makeHome } from './workspaces';
import * as writer from './writer';
import { log } from '../log';

const clog = log.child({ component: 'calls' });

/**
 * Who is asking about a call: anyone who joined it, by their call pass. The organizer's keys are opened for
 * the request (KMASTER), so guests' catch-up and ask work without an account. `inCall`: let in (the
 * organizer always is); someone still waiting only learns whether they've been let in. `role`: theirs as the
 * call stands, which can be more than their pass says (someone signed in whom the organizer let in from the link
 * is invited now). `isHost`: this connection hosts now (the organizer's, or someone's standing in for them), with its
 * account's session; `stale`: it hosted before and the call has gone on from another connection (another of the
 * organizer's tabs or devices, someone standing in, or the organizer back), so what it still sends as host is out of
 * date rather than never allowed. `session`: the account behind this request, if there is one, opened when it's asked for.
 */
export interface Viewer { pass: CallPass; organizer: Owner; session: () => Promise<Owner | undefined>; isOrganizer: boolean; isHost: boolean; stale: boolean; inCall: boolean; role: CallRole }

/**
 * Something the call says happened, as a toast: to everyone in the call, only to the people in one breakout room
 * (`place`), to one connection alone (`to`), or to everyone but one (`not`).
 */
const Notice = z.object({ id: z.string(), text: z.string(), kind: z.enum(['notes', 'people', 'info']), place: z.string().optional(), to: z.string().optional(), not: z.string().optional() });
/**
 * Call state written before hand-off has no `host`: then the organizer's connection in the call hosted it, as it always
 * did (none once they'd left). Anything else is left for the schema to judge.
 */
const BeforeHandOff = z.object({ people: z.array(z.object({ identity: z.string(), role: z.string(), status: z.string() })) });
const withHost = (v: unknown): unknown => {
  if (typeof v !== 'object' || v === null || 'host' in v) return v;
  const s = BeforeHandOff.safeParse(v);
  return s.success ? { ...v, host: s.data.people.find((j) => j.role === 'host' && j.status === 'in')?.identity ?? null } : v;
};
const Stored = z.preprocess(withHost, z.object({
  /**
   * The connection that hosts now (modules/hosting.ts): the organizer's, or someone's standing in while the organizer is
   * away. It commits for every part of the call's group (see committerOf). The `host_identity` column says the same,
   * for LiveKit's webhooks and upkeep, which read it without opening the call; both change only in newGeneration.
   */
  host: z.string().nullable().default(null),
  /**
   * The connection that hosts let go to move to another device, whose new device has until `until` (ms) to come in:
   * nobody takes over, and the call doesn't end for want of a host, while it can still arrive. Null otherwise.
   */
  moving: z.object({ until: z.number() }).nullable().default(null),
  notes: z.object({
    /** What the call captures now (modules/capture.ts): notes off, on, or on and paused by the organizer. */
    status: capture.CaptureStatus, everOn: z.boolean(), noteId: z.string().nullable(), recordingId: z.string().nullable(), segment: z.number(),
    /**
     * When the current segment of the recording began, in seconds since the call started, on this server's clock. A
     * breakout room's speech is placed in the segment from it: its scribe's browser counts from when it loaded, not from
     * when the segment began. 0 for a call stored before it was kept.
     */
    segmentFrom: z.number().default(0),
    /** Every change to it, oldest first, so everyone can see who changed it and when, and what wasn't captured. */
    history: z.array(capture.CaptureChange),
    /** Asks for notes, the latest of each person. */
    asks: z.array(capture.NotesAsk),
    /** What the organizer's current connection says it can't capture now (no microphone, or a browser that can't record or listen). */
    unavailable: z.array(capture.CapturePartName),
    /**
     * Shared screens read for the notes (modules/screens.ts): whether they're read now, every time that changed, and
     * the shares that ended (their presenter's browser said so, or the presenter left), so what a share showed last
     * stops there.
     */
    screens: z.object({ on: z.boolean(), history: z.array(capture.ScreenChange), ended: z.array(screens.ShareEnd) }),
    /** The stretches with notes on but the host's browser out of the call, until another connection hosted. */
    offline: z.array(capture.OfflineStretch).default([])
  }),
  people: z.array(Joined),
  /** Who the organizer put on everyone's main stage, by identity. */
  spotlight: z.string().nullable(),
  /** Breakout rooms: those open now and those that have closed (see the places module). */
  breakouts: BreakoutState,
  /** People (by `person`) the organizer removed: every pass of theirs stops working. */
  removed: z.array(z.string()),
  /**
   * Pointing at shared screens: whether anyone may (the organizer's switch, on until they turn it off), and the people
   * (by `person`, so it holds across their reconnections) who don't let others point at what they share. The pointers
   * and marks themselves go from browser to browser, encrypted end to end, and never come here.
   */
  pointing: z.boolean(),
  othersPointOff: z.array(z.string()),
  /** Where in this generation's log each part of the call last had chat, so people who come in later know there was chat they can't read. */
  chatAt: z.record(z.string(), z.number()),
  notices: z.array(Notice),
  /** What's going on in the workspace the call uses: who's asking to see it, what's being presented and played, and what's been worked on. */
  workspace: CallSpace.default(NO_SPACE),
  /** Which board is open in each part of the call, and which boards it lets everyone into. */
  board: CallBoards.default(NO_BOARDS)
}));
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

/** The call's row and state; `lock` takes the row's lock (`true`) or shares it (`'share'`) for the rest of the transaction. */
async function load(o: Owner, db: Db, callId: string, lock: boolean | 'share' = false) {
  const r = await maybeOne(db, Row, `SELECT ${COLUMNS} FROM calls WHERE owner_id = $1 AND call_id = $2${lock === 'share' ? ' FOR SHARE' : lock ? ' FOR UPDATE' : ''}`, [o.ownerId, callId]);
  if (!r) throw notFound('That call');
  return { row: r, state: openJson(key(o, callId), header(o, callId), r.state_ciphertext, Stored) };
}
/**
 * Saves the call's sealed state, with each open breakout room's record brought up to date: who was in it, and its scribe. `s` is
 * the call as it was read under its row, changed: a call worked out from a settled one is saved with `saveSettled`, so rooms whose
 * time ran out close with what goes with them.
 */
async function save(o: Owner, db: Db, callId: string, s: Stored) {
  // A board open in any part of the call goes into the note, for that part's notes to read, whether or not anyone changes it.
  const kept = keepRooms({ ...s, workspace: withOpenBoards(s.workspace, s.board.open) }, Date.now());
  await exec(db, 'UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, sealJson(key(o, callId), header(o, callId), toJson(kept))]);
}
const notice = (s: Stored, text: string, kind: 'notes' | 'people' | 'info' = 'notes', place?: string | undefined): Stored =>
  ({ ...s, notices: [...s.notices.slice(-2), { id: id128(), text, kind, ...(place ? { place } : {}) }] });
/** A host change, told: the new host in their own words, everyone else in the same sentence (modules/hosting.ts). */
const hostNotices = (s: Stored, change: HostChange, organizer: string): Stored =>
  ({ ...s, notices: [...s.notices, ...noticesFor(change, organizer).map((n) => ({ id: id128(), text: n.text, kind: 'people' as const, ...(n.to ? { to: n.to } : {}), ...(n.not ? { not: n.not } : {}) }))].slice(-4) });
const withPerson = (s: Stored, identity: string, change: (j: Joined) => Joined): Stored => ({ ...s, people: s.people.map((j) => (j.identity === identity ? change(j) : j)) });
const secondsIn = (startedAt: Date, at = Date.now()) => Math.max(0, Math.round((at - startedAt.getTime()) / 1000));
/** The same, to a tenth of a second: what notes and shared screens do, so even a short change shows where it was. */
const tenthsIn = (startedAt: Date, at = Date.now()) => Math.max(0, Math.round((at - startedAt.getTime()) / 100) / 10);
/** The connection that hosts left the room and nothing has taken its place yet: nothing is captured meanwhile. */
const hostAway = (r: Pick<Row, 'state' | 'host_identity' | 'host_left_at'>) => r.state === 'live' && r.host_identity !== null && r.host_left_at !== null;

/* ---------- breakout rooms: who is where is worked out in modules/places.ts; changing it is here ---------- */

/** Rooms, closing: everyone in one goes back to the main room (their browsers rejoin its group), and the rooms go to the notes. */
function closeRooms(s: Stored, to: number, startedMs: number): Stored {
  const open = s.breakouts.open;
  if (!open) return s;
  const closed = new Set(open.rooms.map((r) => r.id));
  const at = startedMs + to * 1000;
  return {
    ...s,
    people: s.people.map((j) => (j.group !== null && closed.has(j.group) ? { ...j, group: null } : j)),
    breakouts: {
      open: null,
      held: [...s.breakouts.held, {
        // Each room's record goes with it, for its section of the notes. Its scribe's last term ends now: speech said
        // before then that's still on its way is taken, and nothing said after.
        rooms: open.rooms.map((r) => ({ id: r.id, name: r.name, emails: r.emails, pauses: r.pauses, seen: r.seen, scribes: r.scribes.map((x) => (x.until === null ? { ...x, until: Math.max(x.from, at) } : x)) })),
        from: open.from, to
      }]
    }
  };
}
/**
 * The call as it stands at `nowMs`: rooms whose time is up have closed, whether or not anyone said so, and everyone who
 * was in one has been back in the main room since they closed.
 */
function settle(s: Stored, row: Pick<Row, 'started_at' | 'mls_seq'>, nowMs = Date.now()): Stored {
  const open = s.breakouts.open;
  if (!open || secondsIn(row.started_at, nowMs) < open.until) return s;
  return relocate(s, closeRooms(s, open.until, row.started_at.getTime()), row.started_at.getTime() + open.until * 1000, row.mls_seq);
}
/** Whether breakout rooms were open at `t` (ms): then a line said in any part of the call is for the people there at the time. */
function roomsOpenAt(s: Stored, row: Pick<Row, 'started_at'>, t: number): boolean {
  const at = (t - row.started_at.getTime()) / 1000;
  const open = s.breakouts.open;
  return Boolean(open && open.from <= at) || s.breakouts.held.some((h) => h.from <= at && at < h.to);
}
/**
 * What rooms closing takes with them, in the transaction that saves it: their entries in the call's MLS log, so their
 * chat, which is live only. What was heard in them stays, sealed, until the call ends and it goes into each room's
 * section of the notes.
 */
async function roomsChanged(o: Owner, db: Db, callId: string, before: Stored, after: Stored): Promise<Stored> {
  const open = new Set(placesOf(after));
  const closed = placesOf(before).filter((p) => !open.has(p));
  if (!closed.length) return after;
  await exec(db, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND grp = ANY($3::text[])', [o.ownerId, callId, closed]);
  clog.info('breakout rooms closed', { callId, rooms: closed.length });
  // Each room's board comes back to the main room, named for the room with who was there (as its notes name them), once the
  // row's let go: `landRooms`.
  const held = after.breakouts.held.at(-1);
  const names = (seen: string[]) => seen.flatMap((key) => { const j = key === 'organizer' ? undefined : after.people.findLast((x) => x.person === key); return j ? [firstName(j.name)] : []; });
  const rooms = closed.flatMap((id) => { const r = held?.rooms.find((x) => x.id === id); return r ? [{ id, name: r.name, who: names(r.seen) }] : []; });
  return boards.roomsClosed(after, rooms, after.workspace.home?.workspaceId ?? null, id128);
}
/** Whether a part of the call open in `before` isn't in `after`: rooms closed between them. */
const roomsClosedBetween = (before: Stored, after: Stored): boolean => {
  const open = new Set(placesOf(after));
  return placesOf(before).some((p) => !open.has(p));
};
/**
 * Saves the call as `next`, worked out from `stored`, the call as it was read under its row, settled: rooms whose time is up
 * close as it's saved, and what goes with them goes (`roomsChanged`), whatever is first to save the call once their time runs
 * out. Says what was saved, and whether rooms closed, for the caller to follow through once the row's let go (`afterClosing`).
 */
async function saveSettled(o: Owner, db: Db, callId: string, stored: Stored, next: Stored): Promise<{ s: Stored; closed: boolean }> {
  const s = space.tidied(await roomsChanged(o, db, callId, stored, next));
  await save(o, db, callId, s);
  return { s, closed: roomsClosedBetween(stored, s) };
}
/**
 * What follows a save that closed rooms (`closed`, as `saveSettled` says), once the call's row is let go: each room's board goes
 * from the seats of whoever was in it to everyone invited (`syncRoomBoards`), before anyone's told; then `answer`, what whoever
 * asked is told, and anyone else; and then the rooms' boards come back to the main board (`landRooms`), which nobody waits for
 * and which tells everyone itself once they're there.
 */
async function afterClosing<T>(call: CallRef, closed: boolean, answer: () => Promise<T>): Promise<T> {
  if (closed) await syncRoomBoards(call);
  const out = await answer();
  if (closed) void landRooms(call);
  return out;
}
/**
 * Rooms as the call shows them: the people sent to each, and who's in each now, by identity (the organizer too, in
 * the room they're visiting). A guest has only the link, so of the people sent to a room they see those in the call,
 * by name, and nobody's address.
 */
function breakoutsOf(s: Stored, v: Viewer, organizer: Person): Breakouts {
  const here = s.people.filter((j) => j.status === 'in');
  const open = s.breakouts.open;
  const shown = (e: string): Person[] => {
    if (v.role !== 'guest') return [personOf(e)];
    const j = here.find((x) => x.email?.toLowerCase() === e);
    return j ? [forViewer(v, personFor(j, j.identity, j.name, organizer), j.identity)] : [];
  };
  const roomOf = (r: z.infer<typeof Room>, live: boolean) => ({
    id: r.id, name: r.name, people: r.emails.flatMap(shown),
    members: live ? here.filter((j) => placeOf(s, j) === r.id).map((j) => j.identity) : []
  });
  return {
    open: open ? {
      rooms: open.rooms.map((r) => ({ ...roomOf(r, true), paused: r.pauses.at(-1)?.paused === true, board: s.board.open[r.id] !== undefined })),
      board: open.board.mode, from: open.from, until: open.until, message: open.message
    } : null,
    held: s.breakouts.held.map((h) => ({ rooms: h.rooms.map((r) => roomOf(r, false)), from: h.from, to: h.to }))
  };
}

/* ---------- the call's MLS log: ordered and relayed here, read only in browsers ---------- */

type MlsKind = 'keypackage' | 'commit' | 'welcome' | 'message';
const mlsKey = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-mls:${callId}`);
/** Binds a log entry to its call, place in the log, kind and part of the call's group (none for a key package). */
const mlsHeader = (o: Owner, callId: string, seq: number, kind: MlsKind, grp: string | null) => ({ v: 1 as const, kind: 'call-mls', ownerId: o.ownerId, callId, seq, mlsKind: kind, grp });
const MlsRow = z.object({ seq: z.coerce.number().int(), kind: z.enum(['keypackage', 'commit', 'welcome', 'message']), party: z.string().nullable(), grp: z.string().nullable(), epoch: z.coerce.number().int(), body_ciphertext: bytea });
/** Appends to the call's log at `seq` (the caller holds the call's row lock and moves mls_seq on): a key package (no group), or a commit, welcome or message for one part of the call's group. */
async function appendMls(o: Owner, db: Db, callId: string, at: { seq: number; generation: number; epoch: number; grp: string | null }, kind: MlsKind, party: string | null, body: string): Promise<void> {
  await exec(db, 'INSERT INTO call_mls (owner_id, call_id, seq, generation, kind, party, grp, epoch, body_ciphertext) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [o.ownerId, callId, at.seq, at.generation, kind, party, at.grp, at.epoch, sealRecord(mlsKey(o, callId), mlsHeader(o, callId, at.seq, kind, at.grp), unb64u(body))]);
}
const openMls = (o: Owner, callId: string, r: z.infer<typeof MlsRow>) => b64u(openRecord(mlsKey(o, callId), mlsHeader(o, callId, r.seq, r.kind, r.grp), r.body_ciphertext));
/**
 * Taken out while their connection was away (it dropped for longer than LiveKit waits, or their tab slept), and not
 * because anyone wanted them out: the same connection can come back in as it is (`mlsBack`).
 */
const mayComeBack = (j: Joined) => j.role !== 'host' && j.status === 'left' && !j.replaced;
const hostHere = (r: Pick<Row, 'state' | 'host_identity' | 'host_left_at'>) => r.state === 'live' && r.host_identity !== null && r.host_left_at === null;
/** Tells everyone in the room what changed (the call itself, its MLS log, or both), so they fetch that again. Nothing else. */
async function nudge(o: Pick<Deps, 'livekit'>, roomName: string | null, callId: string, what: { call: boolean; log: boolean }): Promise<void> {
  if (!roomName) return;
  const n: CallNudge = { v: 1, kind: 'changed', ...what };
  await o.livekit.sendData(roomName, new TextEncoder().encode(JSON.stringify(n)), CALL_TOPIC)
    .catch((e: unknown) => clog.warn('room not told about a change', { callId, err: e }));
}

const RoomOf = z.object({ room_name: z.string().nullable() });
/**
 * Tells a call to read itself again when something outside it changed what someone there can open. It needs only where its
 * room is. This one query isn't scoped by owner, because it can't be: a seat in `document_access` names a call, and the call is
 * its organizer's, who's a different owner that nothing in a workspace records. The ID came from that row, never a request,
 * and all this learns is a room's random name, which goes nowhere but the nudge.
 */
export async function nudgeCall(d: Pick<Deps, 'pool' | 'livekit'>, callId: string): Promise<void> {
  const r = await maybeOne(d.pool, RoomOf, `SELECT room_name FROM calls WHERE call_id = $1 AND state = 'live'`, [callId]);
  if (r) await nudge(d, r.room_name, callId, { call: true, log: false });
}

/** Someone as the call shows them: the organizer, invited people and anyone signed in by their account, guests by the name they typed. */
function personFor(j: Joined | undefined, identity: string, fallbackName: string, organizer: Person): Person {
  if (j?.role === 'host') return organizer;
  if (j?.email) return { ...personOf(j.email, j.name), ...(j.photoUrl ? { photoUrl: j.photoUrl } : {}) };
  return { id: identity, name: j?.name ?? fallbackName, email: '', portrait: portraitFor(identity) };
}

/**
 * When each connection in a call last asked this API anything (ms), by `callId|identity`. A page in a call asks at least
 * every few seconds, so it's how late its page is known to have been there. A stay that ends without the page saying so
 * (it crashed, its goodbye was lost, its tab slept) ends no later than this: time nobody can say they were there for is
 * never counted as theirs, so a guest with the link never reads what was said in it. Kept in memory, as the API runs as
 * one instance; after a restart it's unknown until each page asks again, and such a stay ends where it began instead.
 */
const lastAsked = new Map<string, number>();
const LAST_ASKED_MAX = 50_000;
function asked(callId: string, identity: string): void {
  const key = `${callId}|${identity}`;
  // Oldest first, so what's dropped when it's full is what was heard from longest ago.
  lastAsked.delete(key);
  lastAsked.set(key, Date.now());
  if (lastAsked.size > LAST_ASKED_MAX) {
    const oldest = lastAsked.keys().next();
    if (!oldest.done) lastAsked.delete(oldest.value);
  }
}
/** The latest a connection that went without a word is known to have been in the call: never after `until`, nor before it came in. */
const knownUntil = (callId: string, j: Pick<Joined, 'identity' | 'since'>, until: number): number =>
  Math.min(until, Math.max(j.since, lastAsked.get(`${callId}|${j.identity}`) ?? j.since));

/**
 * Who a call pass belongs to, for this request. A removed person's pass stops working, and once the call is over only
 * the organizer can read it. The organizer's powers go with the organizer's current connection only; host powers with
 * the connection that hosts (the organizer's, or someone's standing in for them). Either only together with the same
 * account's session (`session` opens it, only when it's needed): the organizer's own, or for someone standing in, an
 * account with the invited address they joined with.
 */
export async function viewerOf(d: Deps, pass: CallPass, session: () => Promise<Owner | undefined>): Promise<Viewer> {
  const organizer = await openOwner(d, pass.ownerId, undefined);
  const { row, state: s } = await load(organizer, organizer.pool, pass.callId);
  const signedIn = pass.role === 'host' || s.host === pass.identity ? await session() : undefined;
  const theOrganizer = pass.role === 'host' && signedIn?.ownerId === pass.ownerId;
  const ctx = { callId: pass.callId, role: pass.role };
  if (s.removed.includes(pass.person)) throw new ForbiddenError('The host removed you from this call.', { context: ctx });
  if (row.state !== 'live' && !theOrganizer) throw new ConflictError('This call has ended.', { context: ctx });
  const mine = s.people.find((j) => j.identity === pass.identity);
  // The organizer's current connection: the one of theirs that's in the call (joining again leaves the others).
  const isOrganizer = theOrganizer && mine?.role === 'host' && mine.status === 'in';
  const standingIn = !isOrganizer && s.host === pass.identity && mine !== undefined && mayStandIn(mine) && signedIn !== undefined && mine.email !== undefined
    && (await profile(signedIn)).email.toLowerCase() === mine.email;
  const isHost = s.host === pass.identity && (isOrganizer || standingIn);
  // Never more than the pass says, except a guest the organizer let in and so added to the invite.
  const role: CallRole = pass.role === 'guest' && mine?.role === 'invited' ? 'invited' : pass.role;
  if (mine?.status === 'in') asked(pass.callId, pass.identity);
  return { pass, organizer, session, isOrganizer, isHost, stale: (mine?.hosting.length ?? 0) > 0 && s.host !== pass.identity, inCall: isOrganizer || isHost || mine?.status === 'in', role };
}
/** Everything about a call but whether you're let in needs you to be in it. */
export function requireIn(v: Viewer, what: string): void {
  if (!v.inCall) throw new ForbiddenError('Wait until the host lets you in.', { context: { callId: v.pass.callId, role: v.pass.role, what } });
}

/**
 * Someone as this viewer may see them. A guest has only the link, so they see people by name and portrait
 * under their call identity: no email address (nor an ID made from one), and no photo, which loads only
 * for signed-in browsers anyway.
 */
function forViewer(v: Viewer, p: Person, identity: string): Person {
  if (v.role !== 'guest') return p;
  return { id: identity, name: p.name, email: '', ...(p.portrait ? { portrait: p.portrait } : {}) };
}

/**
 * Who said each line: the person behind the participant ID it was heard from, as `v` may see them (everyone in
 * full for the notes). An ID the call doesn't know names nobody.
 */
function speakersIn(s: Stored, organizer: Person, v?: Viewer | undefined): (identity: string) => Speaker | undefined {
  const by = new Map(s.people.map((j) => [j.identity, j]));
  const named = new Map<string, Speaker | undefined>();
  return (identity) => {
    if (named.has(identity)) return named.get(identity);
    const j = by.get(identity);
    const p = j ? personFor(j, identity, j.name, organizer) : undefined;
    const speaker = p ? { name: p.name, person: v ? forViewer(v, p, identity) : p } : undefined;
    named.set(identity, speaker);
    return speaker;
  };
}

/** Every breakout room the call has had, by ID, with its name. */
function roomsIn(s: Stored): (id: string) => { id: string; name: string } | undefined {
  const all = new Map([...(s.breakouts.open?.rooms ?? []), ...s.breakouts.held.flatMap((h) => h.rooms)].map((r) => [r.id, { id: r.id, name: r.name }]));
  return (id) => all.get(id);
}

/**
 * Seats: what each viewer's own layout keys people by. Someone's seat is the same across their reconnections (a reload's
 * pass carries their `person`; the organizer has one seat on any device), and a MAC of that random `person` under a key
 * for this call from the organizer's root: nobody can work one out, it says nothing about who anyone is, and it differs
 * in every call. Never stored. Anyone but the organizer joining from a second browser is a new person, with a new seat.
 */
const seatKey = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-seat:${callId}`);
const seatFor = (key: Uint8Array, role: Joined['role'], person: string) => b64u(mac(key, utf8(role === 'host' ? 'organizer' : person))).slice(0, 22);
const seatOf = (key: Uint8Array, j: Joined) => seatFor(key, j.role, j.person);
/** The seat of whoever a pass belongs to. */
export const seatOfViewer = (v: Viewer): string => seatFor(seatKey(v.organizer, v.pass.callId), v.pass.role, v.pass.person);
/**
 * Whether someone's in a seat now, known only by its name: the call is going on, and whoever has the seat is let in and
 * wasn't taken out. It's what a pass's viewer says, for what carries a seat in place of a pass.
 */
export async function inSeat(d: Deps, at: { callId: string; organizer: string; seat: string }): Promise<boolean> {
  const o = await findOwner(d, at.organizer, undefined);
  if (!o) return false;
  const found = await load(o, o.pool, at.callId).catch((e: unknown) => { if (e instanceof NotFoundError) return undefined; throw e; });
  if (found?.row.state !== 'live') return false;
  const key = seatKey(o, at.callId);
  return found.state.people.some((j) => j.status === 'in' && !found.state.removed.includes(j.person) && seatOf(key, j) === at.seat);
}
/** Everyone in the call now or, with `place`, in that part of it, by seat, with the name they're in it under. */
export async function seatedIn(o: Owner, callId: string, place?: string | undefined): Promise<Map<string, string>> {
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const key = seatKey(o, callId);
  return new Map(s.people.filter((j) => j.status === 'in' && (place === undefined || placeOf(s, j) === place)).map((j) => [seatOf(key, j), j.name]));
}
export const seated = (v: Viewer): Promise<Map<string, string>> => seatedIn(v.organizer, v.pass.callId);
/** The addresses of everyone who's been in this viewer's call, the organizer's among them, lower-cased: whoever a quote or a follow-up from it can name. */
export async function addressesIn(v: Viewer): Promise<Set<string>> {
  const { state: s } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const organizer = (await profile(v.organizer)).email;
  return new Set([organizer, ...s.people.flatMap((j) => (j.email ? [j.email] : []))].map((e) => e.trim().toLowerCase()));
}
/** The address someone in a seat of this call signed in with, if the call kept one. */
export async function addressIn(v: Viewer, seat: string): Promise<string | undefined> {
  const { state: s } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const key = seatKey(v.organizer, v.pass.callId);
  return s.people.find((j) => seatOf(key, j) === seat)?.email?.toLowerCase();
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
    locked: row.locked, pointing: s.pointing, generation: row.mls_generation, isOrganizer: v.isOrganizer, isHost: v.isHost, role: v.role
  };
  // Someone still waiting to be let in learns what's captured, and nothing else: nobody's name, nothing that was said.
  if (!v.inCall) {
    return {
      ...base, participants: [], waiting: [], ringing: [], leaving: [], spotlight: null, breakouts: { open: null, held: [] }, capture: anonymousCapture(s, row), notes: { everOn: false, noteId: null, recording: { segment: 0, pieces: 0, seconds: 0 } },
      host: { id: null, standIn: false, organizer: { id: 'organizer', name: '', email: '' }, next: [] }, transcript: [], liveNotes: NO_NOTES, workspace: PRIVATE, board: boards.NO_BOARD, notices: []
    };
  }
  const rooms = settle(s, row, end.getTime());
  const segs = s.notes.recordingId ? await segments(o, s.notes.recordingId) : [];
  // What was said where the viewer is now, while they were there: one room's lines never show in another, or in the main room.
  const viewing = rooms.people.find((j) => j.identity === v.pass.identity);
  const invited = invitedIn(meeting);
  const heard = s.notes.noteId && row.state === 'live' ? await transcripts.latest(o, db, s.notes.noteId, LIVE_TRANSCRIPT_LINES, mayRead(v, rooms, viewing, row.started_at, invited)) : [];
  const where = viewing ? placeOf(rooms, viewing) : MAIN_PLACE;
  const open = rooms.breakouts.open;
  const roomHere = open?.rooms.find((r) => r.id === where);
  // Who's in: whoever the host's browser let into the group and hasn't left. Never asked of LiveKit, so reads cost nothing there.
  const here = row.state === 'live' ? s.people.filter((j) => j.status === 'in') : [];
  const seats = seatKey(o, callId);
  const mine = s.notes.asks.find((a) => a.person === v.pass.person);
  const who = hostOf(rooms, v, organizer, row.state === 'live');
  // Who's asking to see the workspace, from whoever is in the call now: for the organizer, as they see everyone.
  const asks: CallWorkspaceAsk[] = !v.isOrganizer ? [] : rooms.workspace.asks.flatMap((a) => {
    const j = here.findLast((p) => p.person === a.person);
    return a.state === 'asking' && j ? [{ id: a.id, participantId: j.identity, person: personFor(j, j.identity, j.name, organizer), at: new Date(a.at).toISOString() }] : [];
  });
  const { shown: workspace, lost } = await space.shownTo({ v, callId, meeting: meeting.manifest, s: rooms, place: where, chosenBy: who.organizer, asks });
  if (lost.present.length || lost.play.length) await stopLost(o, callId, lost);
  return {
    ...base,
    participants: here.map((j) => ({
      id: j.identity, seat: seatOf(seats, j), person: forViewer(v, personFor(j, j.identity, j.name, organizer), j.identity), isMe: j.identity === v.pass.identity,
      isOrganizer: j.role === 'host', hand: j.hand, othersPoint: !s.othersPointOff.includes(j.person)
    })),
    spotlight: s.spotlight && here.some((j) => j.identity === s.spotlight) ? s.spotlight : null,
    breakouts: breakoutsOf(rooms, v, organizer),
    waiting: v.isHost ? s.people.filter((j) => j.status === 'waiting' && j.admit === 'ask' && j.keysFor === row.mls_generation).map((j) => ({ id: j.identity, person: personFor(j, j.identity, j.name, organizer) })) : [],
    ringing: v.isOrganizer ? await rings.rungIn(o, db, row.meeting_item_id, here.flatMap((j) => (j.email ? [j.email.toLowerCase()] : []))) : [],
    // Connections on their way out of their group (the host's browser takes them out), shown as who they are.
    leaving: row.state === 'live' ? s.people.filter((j) => j.status === 'left' && groupOf(s, j) !== null && j.role !== 'host').map((j) => ({
      id: j.identity, seat: seatOf(seats, j), person: forViewer(v, personFor(j, j.identity, j.name, organizer), j.identity),
      now: s.people.find((x) => x.person === j.person && x.status === 'in')?.identity ?? null
    })) : [],
    host: who,
    capture: {
      ...capture.stateFor({
        status: s.notes.status, history: s.notes.history, startedAt: row.started_at, organizer: organizer.name, unavailable: s.notes.unavailable, away: hostAway(row), screens: s.notes.screens,
        gaps: capture.gapsOf(s.notes.history, s.notes.offline, row.started_at, segs, row.ended_at ? secondsIn(row.started_at, row.ended_at.getTime()) : undefined),
        // Open asks, from whoever is in the call now: everyone sees them, like raised hands.
        requests: s.notes.asks.flatMap((a) => {
          const j = here.findLast((p) => p.person === a.person);
          return a.state === 'asking' && j ? [{ id: a.id, participantId: j.identity, at: new Date(a.at).toISOString() }] : [];
        }),
        asked: mine ? { state: mine.state, at: new Date(mine.at).toISOString() } : null
      }),
      // In a breakout room, what's captured there as well: the call's capture, held while the organizer has paused the room.
      room: open && roomHere ? capture.roomStateFor({
        status: s.notes.status, history: s.notes.history, offline: s.notes.offline, startedAt: row.started_at, organizer: organizer.name,
        room: { id: roomHere.id, from: open.from, pauses: roomHere.pauses, scribe: scribeOf(rooms, roomHere.id) }, now: secondsIn(row.started_at, end.getTime())
      }) : null
    },
    notes: { everOn: s.notes.everOn, noteId: s.notes.noteId, recording: { segment: s.notes.segment, pieces: segs.reduce((n, g) => n + g.pieces, 0), seconds: segs.reduce((n, g) => n + g.seconds, 0) } },
    // Lines stay inside their segment once it's over, so what was said before a pause is shown before it.
    transcript: transcripts.spoken(transcripts.placed(heard, segs, s.notes.status === 'on' ? s.notes.segment : undefined), speakersIn(rooms, organizer, v), roomsIn(rooms)),
    liveNotes: await notesFor(v, db, row, rooms, viewing, where, invited),
    workspace,
    board: await boardFor(v, rooms, viewing, where, row, invited),
    // Each notice to the people it's for: everyone, only those in the room it's about, one connection, or everyone but one.
    notices: s.notices.filter((n) => (n.place === undefined || n.place === where) && (n.to === undefined || n.to === v.pass.identity) && n.not !== v.pass.identity)
      .map((n) => ({ id: n.id, text: n.text, kind: n.kind }))
  };
}

/** What someone who isn't in the call yet is told of its workspace: nothing. */
const PRIVATE: CallWorkspace = { id: null, home: null, name: null, chosenBy: { id: 'organizer', name: '', email: '' }, canOpen: false, role: null, documents: [], agenda: null, present: null, play: null, asks: [], asked: 'no' };

/**
 * Who hosts, as this viewer sees it: the connection hosting now and whether it stands in for the organizer, the
 * organizer by name, and for whoever hosts, who could take over from them (never a guest).
 */
function hostOf(s: Stored, v: Viewer, organizer: Person, live: boolean): CallHost {
  const host = live ? s.people.find((j) => j.identity === s.host) : undefined;
  const organizerHere = s.people.find((j) => j.role === 'host' && j.status === 'in');
  return {
    id: host?.identity ?? null,
    standIn: host !== undefined && host.role !== 'host',
    organizer: forViewer(v, organizer, organizerHere?.identity ?? 'organizer'),
    next: v.isHost ? standIns(s, new Set([v.pass.identity])).map((j) => j.identity) : []
  };
}

/** What's captured, for someone who isn't in the call (asking to join, or reading the call's card): no names, no gaps, no asks. */
function anonymousCapture(s: Stored, row: Pick<Row, 'started_at' | 'state' | 'host_identity' | 'host_left_at'>) {
  return capture.stateFor({ status: s.notes.status, history: s.notes.history, startedAt: row.started_at, organizer: null, unavailable: s.notes.unavailable, away: hostAway(row), screens: s.notes.screens, gaps: [], requests: [], asked: null });
}

/**
 * Notes on, or resumed, `at` seconds into the call: the first time a note and its recording are created, keeping what
 * the call was set to keep, with shared screens read from then on if it was set to; after that a new segment starts.
 * Anyone who asked for notes has their answer: yes.
 */
async function startNotes(o: Owner, db: Db, s: Stored, meeting: Loaded<MeetingManifest>, at: number, by: capture.CaptureChange['by']): Promise<Stored> {
  const asks = capture.answered(s.notes.asks);
  if (s.notes.recordingId) {
    await setRecordingState(o, db, s.notes.recordingId, 'recording');
    const segment = s.notes.segment + 1;
    return { ...s, notes: { ...s.notes, status: 'on', everOn: true, segment, segmentFrom: at, history: [...s.notes.history, { at, status: 'on', by, segment }], asks, unavailable: [] } };
  }
  const startedAt = new Date();
  const { keepTranscript, keepRecording, readScreens } = meeting.manifest.choices;
  const { noteId, recordingId } = await createNoteWithRecording(o, db,
    (rid) => blankNote({ kind: 'call', title: meeting.manifest.title, startedAt, recordingId: rid, meetingId: meeting.itemId, invited: meeting.manifest.guests, keep: { transcript: keepTranscript, recording: keepRecording } }),
    (nid) => createRecording(o, db, nid, startedAt));
  const sc = s.notes.screens;
  const screensNow = readScreens && !sc.on ? { ...sc, on: true, history: [...sc.history, { at, on: true, segment: 0, by }] } : sc;
  return { ...s, notes: { ...s.notes, status: 'on', everOn: true, noteId, recordingId, segment: 0, segmentFrom: at, screens: screensNow, history: [...s.notes.history, { at, status: 'on', by, segment: 0 }], asks, unavailable: [] } };
}
/**
 * Notes paused or off, `at` seconds into the call: the recording stops taking audio until notes are on again. What
 * the host's browser couldn't capture is forgotten with every change: it says again once notes are back on, so
 * nobody is told something isn't captured when it is. Turning notes off stops shared screens being read too; pausing
 * holds them with everything else.
 */
async function stopNotes(o: Owner, db: Db, s: Stored, at: number, status: 'paused' | 'off'): Promise<Stored> {
  if (s.notes.recordingId && s.notes.status === 'on') await setRecordingState(o, db, s.notes.recordingId, 'paused');
  const sc = s.notes.screens;
  const screensNow = status === 'off' && sc.on ? { ...sc, on: false, history: [...sc.history, { at, on: false, segment: s.notes.segment, by: 'organizer' as const }] } : sc;
  return { ...s, notes: { ...s.notes, status, screens: screensNow, history: [...s.notes.history, { at, status, by: 'organizer', segment: s.notes.segment }], unavailable: [] } };
}

/* ---------- joining by link: for anyone; the organizer's keys are opened with KMASTER ---------- */

/** The call a code leads to: its own, or for a series' code the one that's on now or next. */
async function meetingFor(d: Deps, code: string) {
  const link = await lookupCode(d, code);
  const organizer = link && await openOwner(d, link.ownerId, undefined);
  const meeting = organizer && link && (await findItem(organizer, d.pool, 'meeting', link.meetingId, MeetingManifest) ?? await callFor(organizer, link.meetingId));
  if (!organizer || !meeting) throw new NotFoundError('There’s no call with that code. Check the link and try again.');
  return { organizer, meeting };
}
const liveCall = (o: Owner, db: Db, meetingId: string, lock = false) => maybeOne(db, Row,
  `SELECT ${COLUMNS} FROM calls WHERE owner_id = $1 AND meeting_item_id = $2 AND state = 'live' ORDER BY started_at DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [o.ownerId, meetingId]);

/** Who someone is to a call: its organizer, invited by email (signed in with an invited address), or a guest. */
const roleOf = (owner: Owner | undefined, email: string | undefined, organizer: Owner, m: MeetingManifest): CallRole =>
  owner?.ownerId === organizer.ownerId ? 'host' : email && m.guests.some((g) => g.toLowerCase() === email.toLowerCase()) ? 'invited' : 'guest';

/**
 * What anyone with the link sees before joining: the title and organizer, whether they can come in yet, and what the
 * call captures (nobody's name, nothing that's been said, so they know before they ask); for someone signed in, where
 * they stand; which ways of signing in get the notes; and while the call offers times, the ones still to come.
 */
export async function card(d: Deps, code: string, owner?: Owner | undefined): Promise<CallCard> {
  const { organizer, meeting } = await meetingFor(d, code);
  const live = await liveCall(organizer, d.pool, meeting.itemId);
  // What the call captures now, and who hosts it, from the row just read.
  const s = live ? openJson(key(organizer, live.call_id), header(organizer, live.call_id), live.state_ciphertext, Stored) : null;
  const now = live && s ? anonymousCapture(s, live) : null;
  const host = await profile(organizer);
  const asker = owner ? await profile(owner) : undefined;
  const role = roleOf(owner, asker?.email, organizer, meeting.manifest);
  // Someone standing in for the organizer: named only to the organizer, whose joining takes the call back.
  const standIn = live && hostHere(live) ? s?.people.find((j) => j.identity === s.host && j.role !== 'host') : undefined;
  // Letting someone in adds them to the invite only when the organizer does it: while someone stands in, they'd be a guest.
  const you: CallCard['you'] = role !== 'guest' ? 'invited' : asker && notesCanGo(asker, host) && !standIn ? 'asks' : 'guest';
  const { offer } = meeting.manifest;
  return {
    startsAt: meeting.manifest.startsAt,
    title: meeting.manifest.title, organizerName: host.name, hostHere: live ? hostHere(live) : false, standIn: standIn ? (role === 'host' ? { name: standIn.name } : {}) : null, locked: live?.locked ?? false,
    notes: meeting.manifest.notes, choices: meeting.manifest.choices, joinMuted: meeting.manifest.joinMuted,
    offer: offer ? { times: offer.times.filter((t) => new Date(t).getTime() > Date.now()), minutes: minutesOf(meeting.manifest) } : null,
    capture: now, ended: !live && meeting.manifest.status === 'ended', you,
    signInForNotes: host.sample ? ['google', 'microsoft', 'sso'] : ['google']
  };
}

/**
 * Settles a call that offers times on one of them, for anyone with its link, signed in or not. The link is what lets
 * them, as it lets them see the times. It answers with the card, which has no times to pick from any more.
 */
export async function pick(d: Deps, code: string, at: string, owner?: Owner | undefined): Promise<CallCard> {
  const { organizer, meeting } = await meetingFor(d, code);
  await pickTime(organizer, meeting.itemId, at);
  return card(d, code, owner);
}

/** A guest's name as typed, on one line: control characters and line breaks become spaces, and runs of spaces one. */
const GuestName = z.string().transform((n) => n.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(60));

/**
 * Lets someone into a call by its link. The organizer hosts (one organizer connection at a time: a new one
 * takes over the recording on a new segment); invited people join with their accounts; anyone else asks: someone
 * signed in under their account's name, with their address when the notes may go to it (the organizer sees it, and
 * letting them in adds it to the invite), anyone else with a typed name. Everyone but the organizer waits until the
 * organizer is there, and is kept out while it's locked or once it has ended.
 */
export async function join(d: Deps, code: string, who: { owner?: Owner | undefined; name?: string | undefined; mic: boolean; cam: boolean; identity: string; keyPackage: string; previous?: string | undefined }): Promise<{ ticket: CallTicket; state: CallState }> {
  const { organizer: o, meeting } = await meetingFor(d, code);
  // Nobody comes in until someone has picked a time, the organizer included: the call has none yet.
  if (meeting.manifest.offer) throw new ConflictError('This call doesn’t have a time yet.', { context: { meetingId: meeting.itemId } });
  const asker = who.owner ? await me(who.owner) : undefined;
  const role = roleOf(who.owner, asker?.email, o, meeting.manifest);
  // Only an address the notes may go to comes with an ask: any other signed-in asker is a guest by name.
  const keepsAddress = who.owner !== undefined && (role !== 'guest' || notesCanGo(await profile(who.owner), await profile(o)));
  let name: string;
  if (asker) name = asker.name;
  else {
    const parsed = GuestName.safeParse(who.name ?? '');
    if (!parsed.success) throw new ValidationError('Enter your name to join.', { context: { role } });
    name = parsed.data;
  }
  // Chosen by the browser (its key package names it): random, and new for every connection.
  const identity = who.identity;
  const joined: Joined = {
    identity, person: id128(), role, name, ...(asker && keepsAddress ? { email: asker.email.toLowerCase(), ...(asker.photoUrl ? { photoUrl: asker.photoUrl } : {}) } : {}),
    status: role === 'host' ? 'in' : 'waiting', admit: role === 'guest' ? 'ask' : 'auto', keysFor: 0, group: role === 'host' ? MAIN_PLACE : null, from: 0,
    placedAt: Date.now(), placedSeq: 0, wasIn: null, leftAt: {}, replaced: false, chatBefore: false, since: Date.now(), left: null, earlier: [], hand: false, hosting: []
  };
  // A pass from this browser's earlier connection to the same call: someone let in before is let in again without asking.
  const earlier = who.previous ? readPass(d.cfg, who.previous) : undefined;
  return enter(d, o, meeting, joined, { mic: who.mic, cam: who.cam, keyPackage: who.keyPackage, earlier, owner: who.owner });
}

/** A connection that came before, of someone coming back: from a reload's pass, or a move from another device. */
type Earlier = Pick<CallPass, 'callId' | 'identity' | 'person'>;

/**
 * Lets a new connection into the call (joining, or coming back from a reload or another device), and hands back its
 * ticket. The organizer's takes over from their previous connection; anyone else's asks, or comes back as `earlier`.
 */
async function enter(d: Deps, o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, who: { mic: boolean; cam: boolean; keyPackage: string; earlier?: Earlier | undefined; moving?: boolean | undefined; host?: string | undefined; owner?: Owner | undefined }): Promise<{ ticket: CallTicket; state: CallState }> {
  const { identity, role, name } = joined;
  const j = role === 'host' ? await hostJoin(o, meeting, joined, who) : await guestJoin(o, meeting, joined, who.keyPackage, who.earlier, who.moving === true);
  // If the new host's browser never reaches the room, someone else hosts, or the call ends when nobody can.
  if (j.hosts) setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after a host joined failed', { err })); }, HOST_GRACE_MS + 1_000).unref();
  if (j.replaced) await o.livekit.removeParticipant(j.roomName, j.replaced).catch((e: unknown) => clog.info('previous host connection already gone', { callId: j.callId, err: e }));
  await o.livekit.ensureRoom(j.roomName);
  // A new host starts a new group (everyone fetches the call and its log); someone asking only concerns the host's browser.
  // A connection that hosts is in the call from the start, with no commit to let it in. Joining doesn't wait for a workspace:
  // a seat lands a moment later, and the call reads itself again when it does.
  if (j.hosts) void syncBoardSeats({ organizer: o, callId: j.callId });
  await nudge(o, j.roomName, j.callId, { call: j.hosts, log: true });
  clog.info(role === 'host' ? 'call joined' : 'asked to join a call', { callId: j.callId, meetingId: meeting.itemId, role, admit: j.admit, generation: j.generation, back: Boolean(who.earlier) });
  return ticketFor(d, o, j.callId, { identity, role, name, person: j.person, hosts: j.hosts, owner: who.owner }, j.roomName);
}

/** A connection's ticket (a new pass), and the call as it sees it. */
async function ticketFor(d: Deps, o: Owner, callId: string, who: Pick<Joined, 'identity' | 'role' | 'name' | 'person'> & { inCall?: boolean | undefined; hosts: boolean; owner?: Owner | undefined }, roomName: string): Promise<{ ticket: CallTicket; state: CallState }> {
  const { identity, role, name, person } = who;
  const pass = issuePass(d.cfg, { callId, ownerId: o.ownerId, identity, role, name, person });
  const ticket: CallTicket = { callId, serverUrl: d.cfg.LIVEKIT_URL, roomName, identity, role, pass };
  // The role the call has for them (an invited person's, a guest's), as #62's join gave it: what they may see follows it.
  const viewer: Viewer = { pass: { v: 1, callId, ownerId: o.ownerId, identity, role, name, person, exp: 0 }, organizer: o, session: () => Promise.resolve(who.owner), isOrganizer: role === 'host', isHost: who.hosts, stale: false, inCall: who.hosts || who.inCall === true, role };
  return { ticket, state: await view(viewer, d.pool, callId) };
}

/* ---------- moving to another device (modules/moves.ts keeps the moves; the call lets the new device in) ---------- */

/** Someone in a call, as a move needs them: who they are, and where they stand. */
export interface Mover { identity: string; person: string; role: CallRole; name: string; email: string | null; status: Joined['status']; replaced: boolean; removed: boolean }
/** A call and one connection in it, for a move: what the new device is told, and whether the move can go on. */
export async function moverOf(o: Owner, callId: string, identity: string): Promise<{ live: boolean; roomName: string | null; hostIdentity: string | null; title: string; organizerName: string; mover: Mover | null }> {
  const { row, state } = await load(o, o.pool, callId);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const organizerName = (await me(o)).name;
  const j = state.people.find((x) => x.identity === identity);
  return {
    live: row.state === 'live', roomName: row.room_name, hostIdentity: row.host_identity, title: meeting.manifest.title, organizerName,
    mover: j ? { identity: j.identity, person: j.person, role: j.role, name: j.role === 'host' ? organizerName : j.name, email: j.email ?? null, status: j.status, replaced: j.replaced, removed: state.removed.includes(j.person) } : null
  };
}

/**
 * The new device of someone moving, let into the call in place of the connection that let go: the organizer's as
 * the organizer's new connection (a new key generation, the recording on a new segment, as when they join from
 * another device); anyone else's the way a reload comes back, as the same person with the same name, role, hand
 * and spotlight, and so the same seat and breakout room. Hands back the new connection's ticket.
 */
export async function moveIn(d: Deps, o: Owner, callId: string, from: { identity: string; person: string }, to: { identity: string; keyPackage: string }, media: { mic: boolean; cam: boolean }): Promise<{ ticket: CallTicket; state: CallState }> {
  const { row, state } = await load(o, o.pool, callId);
  const was = state.people.find((j) => j.identity === from.identity && j.person === from.person);
  if (row.state !== 'live' || !was || was.replaced || state.removed.includes(was.person) || (was.status !== 'in' && was.status !== 'left')) {
    throw new ConflictError('Your place in this call can’t move here any more.', { context: { callId, reason: 'moved-from', status: was?.status ?? 'none' } });
  }
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const host = was.role === 'host';
  // A new connection of the same person, as a fresh join makes one, keeping only who they are (and their hand): in no group
  // yet, so the host's browser adds it to the group of the part of the call they're in, and takes the old one out.
  const joined: Joined = {
    identity: to.identity, person: was.person, role: was.role, name: was.name, ...(was.email ? { email: was.email } : {}), ...(was.photoUrl ? { photoUrl: was.photoUrl } : {}),
    status: host ? 'in' : 'waiting', admit: 'auto', keysFor: 0, group: host ? MAIN_PLACE : null, from: 0,
    placedAt: Date.now(), placedSeq: 0, wasIn: null, leftAt: {}, replaced: false, chatBefore: false, since: Date.now(), left: null, earlier: [], hand: was.hand, hosting: []
  };
  return enter(d, o, meeting, joined, { ...media, keyPackage: to.keyPackage, ...(host ? { host: from.identity } : { earlier: { callId, identity: from.identity, person: from.person }, moving: true }) });
}

/** The ticket of a move's new connection again, if its answer was lost on the way: a new pass for the same connection. */
export async function reissue(d: Deps, o: Owner, callId: string, identity: string): Promise<{ ticket: CallTicket; state: CallState }> {
  const { row, state } = await load(o, o.pool, callId);
  const j = state.people.find((x) => x.identity === identity);
  if (row.state !== 'live' || !row.room_name || !j || state.removed.includes(j.person) || j.replaced || (j.status !== 'in' && j.status !== 'waiting')) {
    throw new ConflictError('Your place in this call can’t move here any more.', { context: { callId, reason: 'reissue', status: j?.status ?? 'none' } });
  }
  return ticketFor(d, o, callId, { ...j, inCall: j.status === 'in', hosts: state.host === j.identity }, row.room_name);
}

/**
 * A connection let go to move to another device, whose new device has until `until` (ms) to come in. The connection
 * that hosts (the organizer's, or a stand-in's) is counted gone from now, and nobody takes over or ends the call while
 * the move can still arrive: its new device hosts on from where it was, as joining from another device does. A move
 * that runs out is a host gone like any other. Anyone else's is gone from the call now, so the host's browser takes it
 * out of the group and the keys move on before the new device comes in.
 */
export async function letGo(d: Deps, o: Owner, callId: string, m: Pick<Mover, 'identity' | 'role'>, until: number): Promise<void> {
  const hosting = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live' || state.host !== m.identity) return false;
    await save(o, c, callId, { ...state, moving: { until } });
    await exec(c, 'UPDATE calls SET host_left_at = now() WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [o.ownerId, callId, m.identity]);
    return true;
  });
  if (hosting) setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after a host’s move ran out failed', { err })); }, until - Date.now() + 1_000).unref();
  else if (m.role !== 'host') await departed(o, callId, m.identity);
}

/** `hosts`: the connection joining hosts the call from now on (the organizer's, or a stand-in's reload). */
interface Joining { callId: string; roomName: string; replaced: string | null; row: Pick<Row, 'host_identity' | 'locked'>; state: Stored; admit: 'auto' | 'ask'; generation: number; person: string; hosts: boolean }

/**
 * The call goes on with another connection hosting (docs: Calls and recordings › Host hand-off): `host` (already among
 * the call's people, or `joining` now) hosts from now on, and `gone` (connections) have left. Every change of host
 * starts a new generation of MLS groups for every part of the call, which the new host's browser creates, so it's leaf 0
 * of each and the only committer there: the old host's keys stay with the old groups, everyone already let in rejoins
 * their part's new group with fresh keys without asking, open rooms stay open, and anyone still waiting keeps waiting
 * (key packages aren't tied to a group, so theirs carry over). What the notes capture carries over exactly: on stays on,
 * its recording going on in a new segment from the new host's browser; paused or off stay so, since only the organizer
 * changes them. `told` says what everyone hears about it. Runs in the caller's transaction, which holds the call's row:
 * the host and the generation change together, so no two browsers ever commit in one generation.
 */
async function newGeneration(o: Owner, c: Db, live: Row, state: Stored, change: { host: Joined; joining: boolean; gone: string[] }, told?: { change: HostChange; organizer: string } | undefined): Promise<{ state: Stored; generation: number; roomName: string }> {
  const generation = live.mls_generation + 1;
  const waiting = new Set(state.people.filter((j) => j.status === 'waiting' && j.keysFor === live.mls_generation).map((j) => j.identity));
  const kps = await rows(c, MlsRow, `SELECT seq, kind, party, grp, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND kind = 'keypackage' ORDER BY seq`,
    [o.ownerId, live.call_id, live.mls_generation]);
  const carried = kps.flatMap((r) => (r.party && waiting.has(r.party) ? [{ party: r.party, body: openMls(o, live.call_id, r) }] : []));
  const kept = new Set(carried.map((k) => k.party));
  const gone = new Set(change.gone);
  // The old host's connection was gone from when LiveKit said so; anyone else who goes, from now. Nothing either heard
  // after that was sent.
  const now = Date.now();
  const goneAt = (j: Joined) => (j.status !== 'in' ? j.left : (j.identity === live.host_identity ? live.host_left_at?.getTime() : undefined) ?? now);
  // The old host stops hosting when it went, or now; the new one hosts from now.
  const hostedUntil = (j: Joined): Joined['hosting'] => j.hosting.map((h) => (h.to === null ? { ...h, to: (gone.has(j.identity) ? goneAt(j) : null) ?? now } : h));
  const hosting = change.host.hosting.at(-1)?.to === null ? change.host.hosting : [...change.host.hosting, { from: now, to: null }];
  const open = state.breakouts.open;
  // In every group from the start of the generation: its own browser makes them.
  const host: Joined = { ...change.host, status: 'in', keysFor: generation, group: MAIN_PLACE, placedSeq: live.mls_seq + carried.length, hosting };
  let s: Stored = {
    ...state,
    host: host.identity,
    people: [...state.people.map((j): Joined => (j.identity === host.identity ? host
      : { ...j, group: null, leftAt: {}, hosting: hostedUntil(j), ...(gone.has(j.identity) ? { status: 'left' as const, left: goneAt(j) } : {}), ...(kept.has(j.identity) ? { keysFor: generation } : {}) })),
    ...(change.joining ? [host] : [])],
    // Open rooms stay open, each with a new group from its first epoch.
    breakouts: { ...state.breakouts, open: open ? { ...open, rooms: open.rooms.map((r) => ({ ...r, epoch: 0 })) } : null },
    chatAt: {},
    moving: null,
    // The same person on a new connection (the organizer's, or a stand-in's reload or move) is still the one spotlighted.
    spotlight: state.people.find((j) => j.identity === state.spotlight)?.person === host.person ? host.identity : state.spotlight
  };
  // Whoever left takes their shares with them.
  s = sharesEnd(s, state.people.filter((j) => gone.has(j.identity) && j.status === 'in').map((j) => j.identity), tenthsIn(live.started_at));
  // What the old host's browser couldn't capture was its own: the new host's says for itself. While notes are on, the
  // old browser's part of the recording ends, and a new segment starts in the new one's.
  s = { ...s, notes: { ...s.notes, unavailable: [] } };
  if (state.host !== null && s.notes.status === 'on' && s.notes.recordingId) {
    // If the old host's connection had already left the room (it dropped, or a reload or a move let go of it), the
    // host's browser was out of the call from then until now: nothing was recorded or heard, a gap in the notes after
    // the segment it was recording. With nobody saying it left, it was still there, and nothing was missed.
    const at = tenthsIn(live.started_at);
    const from = live.host_left_at ? Math.max(tenthsIn(live.started_at, live.host_left_at.getTime()), s.notes.history.at(-1)?.at ?? 0) : at;
    const offline = from < at ? [...s.notes.offline, { from, to: at, segment: s.notes.segment }] : s.notes.offline;
    s = { ...s, notes: { ...s.notes, segment: s.notes.segment + 1, segmentFrom: at, offline } };
  }
  if (told) s = hostNotices(s, told.change, told.organizer);
  await save(o, c, live.call_id, s);
  const roomName = live.room_name ?? `r_${id128()}`;
  await exec(c, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, live.call_id]);
  let seq = live.mls_seq;
  for (const k of carried) { seq += 1; await appendMls(o, c, live.call_id, { seq, generation, epoch: 0, grp: null }, 'keypackage', k.party, k.body); }
  await exec(c, 'UPDATE calls SET host_identity = $3, host_joined_at = now(), host_left_at = NULL, room_name = $4, mls_generation = $5, mls_epoch = 0, mls_seq = $6, version = version + 1 WHERE owner_id = $1 AND call_id = $2',
    [o.ownerId, live.call_id, host.identity, roomName, generation, seq]);
  return { state: s, generation, roomName };
}

async function hostJoin(o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, opts: { mic: boolean; cam: boolean; host?: string | undefined }): Promise<Joining> {
  return tx(o.pool, async (c) => {
    const live = await liveCall(o, c, meeting.itemId, true);
    if (!live) {
      const callId = id128();
      const roomName = `r_${id128()}`;
      let s: Stored = {
        host: joined.identity, moving: null, people: [{ ...joined, hosting: [{ from: joined.since, to: null }] }], spotlight: null, breakouts: { open: null, held: [] }, removed: [], pointing: true, othersPointOff: [], chatAt: {}, notices: [], workspace: NO_SPACE, board: NO_BOARDS,
        notes: { status: 'off', everOn: false, noteId: null, recordingId: null, segment: 0, segmentFrom: 0, history: [], asks: [], unavailable: [], offline: [], screens: { on: false, history: [], ended: [] } }
      };
      await exec(c, `INSERT INTO calls (owner_id, call_id, meeting_item_id, state, started_at, version, state_ciphertext, room_name, host_identity, host_joined_at) VALUES ($1,$2,$3,'live',now(),0,$4,$5,$6,now())`,
        [o.ownerId, callId, meeting.itemId, sealJson(key(o, callId), header(o, callId), toJson(s)), roomName, joined.identity]);
      if (meeting.manifest.notes === 'on') {
        s = await startNotes(o, c, s, meeting, 0, 'schedule');
        s = notice(s, s.notes.screens.on ? 'Notes are on, and what anyone shares is read for them. Everyone here can see that.' : 'Notes are on. Everyone here can see that.');
      }
      await save(o, c, callId, s);
      const started = await updateManifest(o, c, meeting.itemId, (m) => ({ ...m, status: 'live' }));
      // A call that ended, or went past its time, let go of its invite: it's on now, and everyone on it is invited.
      await syncAccess(o, c, meeting.itemId, started.guests);
      clog.info('call started', { callId, meetingId: meeting.itemId, mic: opts.mic, cam: opts.cam, notes: s.notes.status, noteId: s.notes.noteId, recordingId: s.notes.recordingId });
      return { callId, roomName, replaced: null, row: { host_identity: joined.identity, locked: false }, state: s, admit: 'auto', generation: 0, person: joined.person, hosts: true };
    }
    const { state } = await load(o, c, live.call_id, true);
    if (state.people.some((j) => j.identity === joined.identity)) throw new ConflictError('Join the call again.', { context: { callId: live.call_id, reason: 'identity' } });
    // Moving from one device to another: only from the organizer's connection as it is now.
    if (opts.host !== undefined && opts.host !== live.host_identity) throw new ConflictError('The organizer’s connection changed while this was moving. Make a new code and try again.', { context: { callId: live.call_id, reason: 'host' } });
    // A new organizer connection (a reload, another device, or coming back while someone stood in) hosts from now on, in a
    // new generation: the organizer's earlier connection, if one is still in the call, leaves it; someone standing in
    // stays, and rejoins their part's new group like everyone else, unless LiveKit has said their connection left: then
    // they're gone from then, and nobody hosted in between.
    const earlier = state.people.find((j) => j.role === 'host' && j.status === 'in');
    const standIn = state.people.find((j) => j.identity === state.host && j.role !== 'host' && j.status === 'in');
    const standInGone = standIn !== undefined && live.host_left_at !== null;
    // The organizer is one person across their connections (a reload, another device), as anyone else is across a
    // reload: what's kept by person, such as whether others may point at what they share, holds when they come back,
    // and so does their raised hand.
    const last = state.people.findLast((j) => j.role === 'host');
    const host: Joined = { ...joined, person: last?.person ?? joined.person, hand: last?.hand ?? false };
    const told = standIn ? { change: { kind: 'back' as const, standIn, organizer: joined }, organizer: (await me(o, c)).name } : undefined;
    const gone = [...(earlier ? [earlier.identity] : []), ...(standIn && standInGone ? [standIn.identity] : [])];
    const { state: s, generation, roomName } = await newGeneration(o, c, live, state, { host, joining: true, gone }, told);
    clog.info(standIn ? 'organizer back, hosting again' : 'organizer rejoined call', { callId: live.call_id, meetingId: meeting.itemId, replaced: Boolean(earlier), segment: s.notes.segment, generation });
    return { callId: live.call_id, roomName, replaced: earlier?.identity ?? null, row: { host_identity: joined.identity, locked: live.locked }, state: s, admit: 'auto', generation, person: host.person, hosts: true };
  });
}

async function guestJoin(o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, keyPackage: string, earlier: Earlier | undefined, moving = false): Promise<Joining> {
  return tx(o.pool, async (c) => {
    const live = await liveCall(o, c, meeting.itemId, true);
    // Over and not started again: only the organizer can start it.
    if (!live && meeting.manifest.status === 'ended') throw new ConflictError('This call has ended.', { context: { meetingId: meeting.itemId, role: joined.role } });
    if (!live || !live.room_name) throw new ConflictError('Waiting for the host to start the call.', { context: { meetingId: meeting.itemId, role: joined.role } });
    const { state } = await load(o, c, live.call_id, true);
    if (state.people.some((j) => j.identity === joined.identity)) throw new ConflictError('Join the call again.', { context: { callId: live.call_id, reason: 'identity' } });
    // Back from a reload or another device: whoever was let in before (and not removed) needn't ask again, and is
    // the same person, as long as they come back as the same account (or still none): a pass never carries anyone
    // else in. Their old connection's place is over, and its pass can't bring anyone back again.
    const before = earlier && earlier.callId === live.call_id && !state.removed.includes(earlier.person)
      ? state.people.find((j) => j.identity === earlier.identity && j.person === earlier.person && !j.replaced && j.role !== 'host' && (j.status === 'in' || j.status === 'left')
        && (j.email ?? '') === (joined.email ?? '')) : undefined;
    // A move brings in only the person whose place it was, as they are now: removed or replaced since it was checked
    // (that read held no lock), it brings nobody in, rather than letting them in as someone new without asking.
    if (moving && !before) throw new ConflictError('Your place in this call can’t move here any more.', { context: { callId: live.call_id, reason: 'moved-from' } });
    // A lock keeps new people out, not someone coming back to the place they had.
    if (live.locked && !before) throw new ForbiddenError('The host has locked this call.', { context: { callId: live.call_id, role: joined.role } });
    // Coming back keeps their raised hand, and the spotlight if it was theirs.
    const me: Joined = { ...joined, keysFor: live.mls_generation, group: null, ...(before ? { admit: 'auto' as const, person: before.person, hand: before.hand } : {}) };
    // Someone standing in for the organizer who reloads comes back hosting, as the organizer would: the new connection
    // hosts in a new generation, so the call is never left without a host meanwhile, locked or not.
    if (before && before.identity === state.host && mayStandIn({ ...me, status: 'in' })) {
      const { state: s, generation } = await newGeneration(o, c, live, withPerson(state, before.identity, (j) => ({ ...j, replaced: true })), { host: me, joining: true, gone: [before.identity] });
      clog.info('stand-in host came back on a new connection', { callId: live.call_id, generation });
      return { callId: live.call_id, roomName: live.room_name, replaced: before.identity, row: live, state: s, admit: 'auto', generation, person: me.person, hosts: true };
    }
    if (!hostHere(live)) throw new ConflictError('Waiting for the host to start the call.', { context: { meetingId: meeting.itemId, role: joined.role } });
    let s: Stored = { ...state, people: [...state.people, me], spotlight: before && state.spotlight === before.identity ? me.identity : state.spotlight };
    // An old connection still in never said it went (its page crashed, or its goodbye hasn't come): its stay ends when it
    // was last heard from, not now, so the time between isn't counted as theirs for a guest coming back to read.
    if (before) s = sharesEnd(withPerson(s, before.identity, (j) => ({ ...j, status: 'left', replaced: true, left: j.status === 'in' ? knownUntil(live.call_id, j, Date.now()) : j.left })), before.status === 'in' ? [before.identity] : [], tenthsIn(live.started_at));
    const seq = live.mls_seq + 1;
    await appendMls(o, c, live.call_id, { seq, generation: live.mls_generation, epoch: live.mls_epoch, grp: null }, 'keypackage', me.identity, keyPackage);
    await exec(c, 'UPDATE calls SET mls_seq = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, live.call_id, seq]);
    await save(o, c, live.call_id, s);
    return { callId: live.call_id, roomName: live.room_name, replaced: null, row: live, state: s, admit: me.admit, generation: live.mls_generation, person: me.person, hosts: false };
  });
}

/* ---------- during the call: the organizer's controls, and what anyone in it can do ---------- */

/**
 * Everything in `act` but a raised hand, an ask for notes, your own share's pointing, ticking or adding a follow-up, what goes by
 * what you can open in the workspace, a board and its timer and vote, and ideas from the call done with, is whoever hosts' (the
 * organizer's own besides, checked by the API).
 */
export const anyone = (a: CallAction): boolean =>
  a.type === 'hand' || a.type === 'request-notes' || a.type === 'others-point' || a.type === 'follow-up' || a.type === 'follow-up-add' || a.type === 'board-ideas-done' || space.anyonesAction(a) ||
  boards.isBoardAction(a) || boards.isRunAction(a);
/**
 * Refused for a connection that doesn't host now (`who`: the connection that does, by default whoever hosts): checked
 * again where it counts, as the host may have changed since the request came in. The same 409 as the API's for a
 * connection that hosted before, so its browser drops what it was still sending.
 */
function stillHosting(v: Viewer, s: Stored, ctx: Record<string, string | number | boolean | null>, who: string | null = s.host): void {
  if (who !== v.pass.identity) throw new ConflictError('You’re not hosting this call from here any more.', { context: { ...ctx, why: 'not host' }, level: 'info' });
}

export async function act(v: Viewer, callId: string, a: CallAction): Promise<CallState> {
  const o = v.organizer;
  if (a.type === 'workspace-open') return openWorkspace(v, callId, a.timeZone);
  if (space.isSpaceAction(a)) return actOnWorkspace(v, callId, a);
  if (boards.isBoardAction(a)) return actOnBoard(v, callId, a);
  if (boards.isRunAction(a)) return runOnBoard(v, callId, a);
  if (a.type === 'mute') {
    // Carried out by LiveKit; nothing about the call changes here.
    const { row, state } = await load(o, o.pool, callId);
    if (row.state !== 'live' || !row.room_name) throw new ConflictError('This call has ended.', { context: { callId, action: a.type } });
    stillHosting(v, state, { callId, action: a.type });
    await o.livekit.muteTrack(row.room_name, a.identity, a.trackSid);
    clog.info('host control', { callId, action: a.type, target: a.identity });
    return view(v, o.pool, callId);
  }
  // Who may be rung is settled before the call's lock is taken: knowing the team can take a calendar read.
  if (a.type === 'ring') await rings.mayRing(o, (await load(o, o.pool, callId)).row.meeting_item_id, a.emails);
  /**
   * Who the invite took on (`add`) or let go of (`gone`), for the call's home to follow once the call's row is let go, and the
   * workspaces made in the call (`made`), which do too.
   */
  const invite: { meetingId: string; add: string[]; gone: string[]; made: string[] } | null = a.type === 'ring' || a.type === 'remove' ? { meetingId: '', add: [], gone: [], made: [] } : null;
  // Rooms opening with something to work on: it's made first, with nothing of the call held.
  const ready = a.type === 'rooms-open' && a.board.mode !== 'none' ? await roomsReady(v, callId, a) : undefined;
  await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, action: a.type } });
    const at = secondsIn(row.started_at);
    // To a tenth of a second, for what's captured and for rooms opening: even a short pause falls on the right side of a room's opening.
    const exact = tenthsIn(row.started_at);
    const settled = settle(state, row);
    let s = settled;
    if (invite) invite.meetingId = row.meeting_item_id;
    let locked = row.locked;
    let gone: string[] = [];
    /** The seat of whoever this takes out of the call. */
    let removed: string | null = null;
    const ctx = { callId, action: a.type };
    // Under the call's row lock: a stand-in's last click as the organizer takes the call back is refused, not carried out.
    if (!anyone(a)) stillHosting(v, state, ctx);
    if (a.type === 'hand') {
      s = withPerson(s, v.pass.identity, (j) => ({ ...j, hand: a.up }));
    } else if (a.type === 'others-point') {
      // Someone's own choice about what they share, by person, so it holds when they come back on another connection.
      const off = s.othersPointOff.filter((p) => p !== v.pass.person);
      s = { ...s, othersPointOff: a.on ? off : [...off, v.pass.person] };
    } else if (a.type === 'board-ideas-done') {
      // Added to the board, or put aside: they go for everyone in the part of the call they're from, and nothing of them stays.
      const place = whereIs(v, settled);
      const kept = s.board.ideas[place];
      if (kept) s = { ...s, board: { ...s.board, ideas: { ...s.board.ideas, [place]: { ...kept, list: kept.list.filter((i) => !a.ids.includes(i.id)) } } } };
    } else if (a.type === 'follow-up') {
      await tickFollowUp(v, c, row, s, a);
    } else if (a.type === 'follow-up-add') {
      await addFollowUp(v, c, row, s, a, at);
    } else if (a.type === 'pointing') {
      if (a.on !== s.pointing) {
        s = notice({ ...s, pointing: a.on }, a.on ? 'The organizer turned on pointing at shared screens.' : 'The organizer turned off pointing at shared screens.', 'info');
      }
    } else if (a.type === 'spotlight') {
      // Only someone in the call can be spotlighted.
      if (a.participantId !== null && !s.people.some((j) => j.identity === a.participantId && j.status === 'in')) throw new ValidationError('That person isn’t in this call.', { context: ctx });
      s = { ...s, spotlight: a.participantId };
    } else if (a.type === 'rooms-open') {
      checkRooms(s, a, (await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting')).manifest, ctx);
      // Each room gets its own MLS group: everyone sent to one leaves the main room's group and joins the room's. What they
      // have to work on was made before the call's row was taken (`roomsReady`), and opens with them.
      const rooms = a.rooms.map((r, k) => ({ id: ready?.ids[k] ?? id128(), name: r.name, emails: r.emails, epoch: 0, pauses: [], scribes: [], seen: [] }));
      s = { ...s, spotlight: null, board: ready ? withRoomsReady(s.board, ready, rooms.map((r) => r.id)) : s.board, breakouts: { ...s.breakouts, open: { rooms, from: exact, until: exact + a.minutes * 60, message: null, visiting: null, board: a.board } } };
      // The board that was open can't take the rooms' frames, so they share a new one in its place: everyone is told why it changed.
      if (ready?.instead) s = notice(s, ROOMS_ON_NEW_BOARD, 'info');
    } else if (a.type === 'rooms-close') {
      s = closeRooms(s, exact, row.started_at.getTime());
    } else if (a.type === 'rooms-rename') {
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      if (!open.rooms.some((r) => r.id === a.roomId)) throw new ValidationError('That room isn’t open.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => (r.id === a.roomId ? { ...r, name: a.name } : r)) } } };
    } else if (a.type === 'rooms-move') {
      // Someone invited, to another open room or back to the main room: their browser leaves its group and joins the new part's.
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      if (a.roomId !== null && !open.rooms.some((r) => r.id === a.roomId)) throw new ValidationError('That room isn’t open.', { context: ctx });
      const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
      if (!meeting.manifest.guests.some((e) => e.toLowerCase() === a.email)) throw new ValidationError('Only people invited to this call can be sent to a room.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => ({ ...r, emails: [...r.emails.filter((e) => e !== a.email), ...(r.id === a.roomId ? [a.email] : [])] })) } } };
    } else if (a.type === 'rooms-message') {
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, message: { text: a.text, at } } } };
    } else if (a.type === 'rooms-pause') {
      // One room's notes held, or carried on, while the call's are on. The call's notes don't change, and only that room hears about it.
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      const room = open.rooms.find((r) => r.id === a.roomId);
      if (!room) throw new ValidationError('That room isn’t open.', { context: ctx });
      if ((room.pauses.at(-1)?.paused === true) !== a.paused) {
        if (a.paused && s.notes.status !== 'on') throw new ConflictError('Notes aren’t on, so there’s nothing to pause.', { context: ctx });
        const pause = { at: exact, paused: a.paused };
        s = { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => (r.id === room.id ? { ...r, pauses: [...r.pauses, pause] } : r)) } } };
        s = notice(s, a.paused ? 'The organizer paused notes in this room. Nothing said here is transcribed or sent to the AI until they resume.'
          : 'The organizer resumed notes in this room. Everyone here can see that.', 'notes', room.id);
      }
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
      // host's browser takes them out of the group, so the keys move on without them.
      const target = s.people.find((j) => j.identity === a.identity);
      // Nobody removes the organizer (someone standing in hosts their call), and whoever hosts doesn't remove themselves.
      if (target?.role === 'host') throw new ValidationError('Nobody can remove the organizer.', { context: { callId } });
      if (a.identity === s.host) throw new ValidationError('You can’t remove yourself. Leave the call instead.', { context: { callId } });
      if (!target) throw new ValidationError('That person isn’t in this call.', { context: { callId } });
      gone = s.people.filter((j) => j.person === target.person && j.status === 'in').map((j) => j.identity);
      removed = seatOf(seatKey(o, callId), target);
      s = sharesEnd({
        ...s, removed: [...s.removed, target.person],
        people: s.people.map((j) => (j.person === target.person ? { ...j, status: j.status === 'in' ? 'left' : j.status === 'waiting' ? 'denied' : j.status, left: j.status === 'in' ? Date.now() : j.left } : j))
      }, gone, tenthsIn(row.started_at));
      // On the invite because they were let in from the link (in this run of the call or an earlier one): the organizer
      // removing them takes that back, so they don't get the notes, once no other connection of theirs is still in the
      // call. The invite is the organizer's alone: someone standing in only takes them out of the call.
      const email = target.email;
      const stillIn = (e: string) => s.people.some((j) => j.email === e && j.status === 'in' && !s.removed.includes(j.person));
      if (v.isOrganizer && email && !stillIn(email) && await addedFromLink(o, c, row.meeting_item_id, email)) {
        await takeOffInvite(o, c, { meetingId: row.meeting_item_id, noteId: s.notes.noteId }, email);
        invite?.gone.push(email);
        clog.info('taken off the invite', { callId, meetingId: row.meeting_item_id, noteId: s.notes.noteId });
      }
    } else if (a.type === 'lock') {
      locked = a.on;
      await exec(c, 'UPDATE calls SET locked = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, locked]);
    } else if (a.type === 'ring') {
      // Nobody new can come into a locked call, so nobody is rung into one. Someone already here has no need of a ring.
      if (locked) throw new ConflictError('This call is locked, so nobody new can join. Unlock it to ring someone.', { context: ctx });
      const here = new Set(s.people.flatMap((j) => (j.status === 'in' && j.email ? [j.email.toLowerCase()] : [])));
      invite?.add.push(...await rings.ring(o, c, { meetingId: row.meeting_item_id, noteId: s.notes.noteId }, a.emails.filter((e) => !here.has(e))));
    } else if (a.type === 'stop-ring') {
      await rings.stop(o, c, row.meeting_item_id, a.ringId);
    } else {
      s = await changeCapture(v, c, row, s, a, exact);
    }
    const moved = s.people.filter((j) => j.status === 'in' && j.role !== 'host' && placeOf(settled, j) !== placeOf(s, j)).length;
    // Whoever left the main room (sent to a room, or the organizer visiting one) takes their share with them: it stops
    // there in the notes. Each share is ended by presenter, not by share, so it's read again once they're back.
    s = sharesEnd(s, s.people.filter((j) => j.status === 'in' && placeOf(settled, j) === MAIN_PLACE && placeOf(s, j) !== MAIN_PLACE).map((j) => j.identity), exact);
    s = (await saveSettled(o, c, callId, state, relocate(settled, s, Date.now(), row.mls_seq))).s;
    // Anyone sent to another part of the call (or back) moves group: their browser and the organizer's read the log again.
    clog.info('call action', {
      callId, action: a.type, notes: s.notes.status, screens: s.notes.screens.on, segment: s.notes.segment, asks: s.notes.asks.filter((x) => x.state === 'asking').length, unavailable: s.notes.unavailable.length,
      connections: gone.length, spotlight: Boolean(s.spotlight), rooms: s.breakouts.open?.rooms.length ?? 0, visiting: Boolean(s.breakouts.open?.visiting), roomsHeld: s.breakouts.held.length, moved,
      pointing: s.pointing, othersPointOff: s.othersPointOff.length
    });
    if (invite) invite.made = s.workspace.made;
    // Who has each room's board changes only as people move or rooms open or close, by time or by hand.
    const shifted = moved > 0 || a.type === 'rooms-open' || a.type === 'rooms-close' || a.type === 'rooms-move' || a.type === 'rooms-visit' || (state.breakouts.open !== null) !== (s.breakouts.open !== null);
    return { room: row.room_name, gone, moved, removed, board: s.board, shifted };
  }).then(async ({ room, gone, moved, removed, board, shifted }) => {
    if (room) for (const who of gone) await o.livekit.removeParticipant(room, who).catch((e: unknown) => clog.info('removed person already gone', { callId, err: e }));
    // What the call gave them in a workspace goes with them.
    if (removed) await endSeat(o, callId, removed);
    // So does a place in a home made for the call that the invite gave them; someone rung is on the invite, so in it. And a
    // room's board they had by address, as they don't get that room's notes.
    if (invite) await space.followHome(o, invite.meetingId, invite, invite.made);
    if (invite?.gone.length) await boards.offRoomBoards(o, board, invite.gone);
    // Each room's board goes with whoever's in its room before anyone's told, so whoever's moved out has lost it by then.
    if (shifted) await syncRoomBoards({ organizer: o, callId });
    if (ready?.main) void syncBoardSeats({ organizer: o, callId });
    await nudge(o, room, callId, { call: true, log: a.type === 'remove' || a.type === 'deny' || moved > 0 });
    if (board.landing) void landRooms({ organizer: o, callId });
  }, async (e: unknown) => {
    if (ready) await boards.dropRoomsReady(o, callId, ready);
    throw e;
  });
  return view(v, o.pool, callId);
}

/** Whether rooms can open as asked: none are open, and everyone sent to one is invited, once. */
function checkRooms(s: Stored, a: Extract<CallAction, { type: 'rooms-open' }>, meeting: Pick<MeetingManifest, 'guests'>, ctx: Record<string, string>): void {
  if (s.breakouts.open) throw new ConflictError('Rooms are already open.', { context: ctx });
  const invited = new Set(meeting.guests.map((e) => e.toLowerCase()));
  const placed = a.rooms.flatMap((r) => r.emails);
  if (placed.some((e) => !invited.has(e))) throw new ValidationError('Only people invited to this call can be sent to a room.', { context: { ...ctx, rooms: a.rooms.length } });
  if (new Set(placed).size !== placed.length) throw new ValidationError('Someone is in two rooms. Each person goes to one room.', { context: { ...ctx, rooms: a.rooms.length } });
}
/**
 * What rooms opening with a board each, or one they share, need, made with nothing of the call held (callBoards.ts's
 * `prepareRooms`), from the call as it stands: whoever's going to each room, by seat, is seated on its board now. What can't
 * open is refused first, so nothing is made for rooms that won't open.
 */
async function roomsReady(v: Viewer, callId: string, a: Extract<CallAction, { type: 'rooms-open' }>): Promise<boards.RoomsReady> {
  const o = v.organizer;
  const ctx = { callId, action: a.type };
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
  const s = settle(state, row);
  stillHosting(v, s, ctx);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  checkRooms(s, a, meeting.manifest, ctx);
  const going = (emails: string[]) => seatsOf(o, callId, s.people.filter((j) => j.status === 'in' && j.role !== 'host' && j.email !== undefined && emails.includes(j.email.toLowerCase())));
  const reader = await readerInCall(v);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const main: boards.MainBoardFor = {
    o, callId, s, meeting: meeting.manifest, here: hereIn(o, callId, s), known: knownIn(o, callId, s), maker: { name: mine?.name ?? v.pass.name, email: mine?.email ?? '' }, asOrganizer: v.isOrganizer
  };
  return boards.prepareRooms({ rooms: a.rooms.map((r) => ({ name: r.name, people: going(r.emails) })), board: a.board, main, ids: a.rooms.map(() => id128()), by: space.controllerOf(v, reader) });
}
/** The call's boards with what rooms opening made: each room's board open in it, and a shared board open in the main room. */
function withRoomsReady(board: CallBoards, ready: boards.RoomsReady, ids: string[]): CallBoards {
  if (ready.each) {
    const each = ready.each;
    const made = ids.flatMap((room, k) => { const documentId = each.documentIds[k]; return documentId ? [{ room, documentId }] : []; });
    return {
      ...board,
      open: { ...board.open, ...Object.fromEntries(made.map((m) => [m.room, { workspaceId: each.workspaceId, documentId: m.documentId, by: ready.by, timer: null, vote: null }])) },
      rooms: [...board.rooms, ...made.map((m) => ({ workspaceId: each.workspaceId, documentId: m.documentId, room: m.room, kept: false }))]
    };
  }
  const main = ready.main;
  if (!main) return board;
  return { ...board, open: { ...board.open, [MAIN_PLACE]: { workspaceId: main.workspaceId, documentId: main.documentId, by: ready.by, timer: null, vote: null } }, letIn: [...board.letIn, main.entry] };
}

/* ---------- the workspace a call uses: what's done is modules/callWorkspace.ts; the call's row is held here ---------- */

/** How many times something done about the call's workspace is asked afresh when the call moved on under it, before it's refused. */
const SPACE_TRIES = 3;
/**
 * Something done about the call's workspace. A live call comes first, so it's in two steps (`space.prepare`): everything that
 * reads a workspace or changes one, with nothing of the call held; then the call's row, held only to check again what that
 * went by, from the call's own state, and to save. When the call moved on in between, it's all asked afresh.
 */
async function actOnWorkspace(v: Viewer, callId: string, a: space.SpaceAction): Promise<CallState> {
  const o = v.organizer;
  const reader = await readerInCall(v);
  const ctx = { callId, action: a.type };
  const seats = seatKey(o, callId);
  const seatOfJ = (j: Joined) => seatOf(seats, j);
  /** The call as it stands, read with `db`: the pool, or the transaction that holds its row. */
  const read = async (db: Db, held: boolean) => {
    const { row, state } = await load(o, db, callId, held);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    if (!anyone(a)) stillHosting(v, state, ctx);
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity);
    const meeting = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
    return { row, state, changing: { v, reader, callId, meeting, startedAt: row.started_at, s, place: mine ? placeOf(s, mine) : MAIN_PLACE, now: Date.now(), seatOf: seatOfJ } };
  };
  for (let tries = 1; ; tries++) {
    const apply = await space.prepare((await read(o.pool, false)).changing, a);
    const done = await tx(o.pool, async (c) => {
      const { row, state, changing } = await read(c, true);
      const changed = await apply({ ...changing, c });
      if (changed === 'again') return 'again';
      const { closed } = await saveSettled(o, c, callId, state, changed.s);
      clog.info('call action', { callId, action: a.type, present: changed.s.workspace.present.length, play: changed.s.workspace.play.length, asks: changed.s.workspace.asks.length, tries });
      return { room: row.room_name, ended: changed.ended, made: changed.made, meetingId: row.meeting_item_id, closed };
    });
    if (done === 'again') {
      if (tries < SPACE_TRIES) continue;
      throw new ConflictError('This call changed while that was being done. Try again.', { context: { ...ctx, tries } });
    }
    // A grant to someone removed while it was made goes, as their removal took everything else.
    if (done.ended) await endSeat(o, callId, done.ended);
    if (done.made) await space.followHome(o, done.meetingId, { add: done.made.guests }, [done.made.workspaceId]);
    return afterClosing({ organizer: o, callId }, done.closed, async () => {
      await nudge(o, done.room, callId, { call: true, log: false });
      return view(v, o.pool, callId);
    });
  }
}

/**
 * Whoever started something has lost its document: it stops for everyone, and doesn't come back if they're given it again.
 * Reading the call finds this out, and a read isn't refused for it: the next read tries again.
 */
async function stopLost(o: Owner, callId: string, lost: space.Lost): Promise<void> {
  try {
    const room = await tx(o.pool, async (c) => {
      const { row, state } = await load(o, c, callId, true);
      if (row.state === 'live') await save(o, c, callId, { ...state, workspace: space.withoutLost(state.workspace, lost) });
      return row.room_name;
    });
    clog.info('stopped: whoever started it lost the document', { callId, present: lost.present.length, play: lost.play.length });
    await nudge(o, room, callId, { call: true, log: false });
  } catch (e) {
    clog.warn('what someone lost not stopped', { callId, err: e });
  }
}

/**
 * The call's home, and this run of the call's folder in it, settled the first time anyone asks (docs: Calls and recordings ›
 * The call's home): the meeting's, a workspace its organizer chose or its series has, while they can still make things in it
 * and it has room for the folder; else a new one made for the call, named after it and the day where `timeZone` is. Under the
 * call's row, so everyone asking at once gets the same: a new home is made there, since nobody else can reach it yet, and
 * for a home that's there already the folder's ID is taken there, and the folder made in that workspace's own transaction
 * with nothing of the call held. Everyone invited is let into a home made for the call once the call's row is let go. A home
 * deleted since is settled again, and one with no room for the folder (`full`) gives way to a new one. Whose it is, and what's
 * in it, the meeting's organizer decides: whoever asks first only settles it.
 */
export async function settledHome(o: Owner, callId: string, timeZone?: string | undefined, full: string | null = null): Promise<{ workspaceId: string; folderId: string }> {
  const { row, state } = await load(o, o.pool, callId);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const had = state.workspace.home;
  const chosen = meeting.manifest.workspaceId;
  if (had?.made && had.workspaceId === chosen && await workspaceOwner(o.pool, chosen)) return had;
  const organizer = (await profile(o)).email;
  // Asked with nothing held: a home the organizer can no longer make things in is no home of theirs, nor one with no room.
  const usable = chosen !== full && (await space.usableHome(o, organizer, chosen)) !== undefined;
  const zone = timeZone ?? (meeting.manifest.seriesId ? await zoneOf(o, meeting.manifest.seriesId) : undefined) ?? 'UTC';
  const name = space.homeName(meeting.manifest.title, row.started_at, zone);
  const taken = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, what: 'workspace' } });
    const m = await getItem(o, c, 'meeting', held.row.meeting_item_id, MeetingManifest, 'That meeting');
    const now = m.manifest.workspaceId;
    const h = held.state.workspace.home;
    if (now !== chosen) return { again: true } as const;
    // Who's invited, as it stands under the call's row: whoever an invite change adds after this finds the home named.
    const guests = m.manifest.guests;
    if (now !== null && usable) {
      if (h?.workspaceId === now) return { again: false, home: h, made: false, was: now, guests } as const;
      const claim = { workspaceId: now, folderId: id128(), made: false };
      await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, home: claim } });
      return { again: false, home: claim, made: false, was: now, guests } as const;
    }
    const folder = space.folderFor(o, organizer, callId, id128(), name, held.row.started_at);
    const { id } = await makeHome(o, c, { name, madeFor: space.madeForCall(m, held.row.started_at), folder });
    await updateManifest(o, c, m.itemId, (x) => ({ ...x, workspaceId: id }));
    const home = { workspaceId: id, folderId: folder.id, made: true };
    await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, home } });
    clog.info('call settled on a new home', { callId, workspaceId: id, full: full !== null });
    return { again: false, home, made: true, was: now, room: held.row.room_name, guests } as const;
  });
  // The meeting changed while this was asked: ask again, from what it says now.
  if (taken.again) return settledHome(o, callId, timeZone, full);
  const { home } = taken;
  if (taken.made) {
    // Everyone invited comes in now the call's row is let go, so a big invite never holds the call up.
    await space.followHome(o, row.meeting_item_id, { add: taken.guests });
    await space.carryForward(o, row.meeting_item_id, taken.was, home.workspaceId);
    await nudge(o, taken.room, callId, { call: true, log: false });
    return home;
  }
  if (!home.made) {
    const folder = space.folderFor(o, organizer, callId, home.folderId, name, row.started_at);
    const put = await space.folderIn(o, home.workspaceId, folder);
    if (put === 'gone') throw notFound('That workspace', { callId, workspaceId: home.workspaceId });
    // No room for the folder: the call settles on a new home, and only a folder that's there is ever marked made.
    if (put === 'full') return settledHome(o, callId, timeZone, home.workspaceId);
    await tx(o.pool, async (c) => {
      const held = await load(o, c, callId, true);
      const h = held.state.workspace.home;
      if (held.row.state === 'live' && h?.folderId === home.folderId && !h.made) await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, home: { ...h, made: true } } });
    });
    await space.followHome(o, row.meeting_item_id, { add: taken.guests });
    clog.info('call folder settled in its home', { callId, workspaceId: home.workspaceId });
  }
  return { workspaceId: home.workspaceId, folderId: home.folderId };
}

/**
 * Looks, in each run of a call, for an agenda to make, until there is one or there's none to make. What it says is worked out
 * with nothing held. Whoever opens Workspace first takes it on, under the call's row, so there's one however many open it at
 * once; it's made in the workspace's own transaction and filled in with nothing of the call held, and only once it's filled in
 * does the call say it's done, the meeting name it, and it take the last one's place. A try that fails lets go, keeping the
 * document it was making, so the next person opening Workspace fills that one in.
 */
async function agendaFor(o: Owner, callId: string): Promise<void> {
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live' || state.workspace.agendaLooked || space.makingAgenda(state.workspace, Date.now())) return;
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const plan = await space.planAgenda(o, meeting);
  const draft = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live' || held.state.workspace.agendaLooked || space.makingAgenda(held.state.workspace, Date.now())) return undefined;
    const claimed = space.claimAgenda(held.state.workspace, plan, Date.now());
    await save(o, c, callId, { ...held.state, workspace: claimed.space });
    return claimed.draft;
  });
  if (!draft || !plan) return;
  try {
    const made = await space.makeAgenda(o, plan, draft);
    if (made) await space.fillAgenda(made, plan, callId);
    await tx(o.pool, async (c) => {
      const held = await load(o, c, callId, true);
      if (held.row.state === 'live') await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, agendaLooked: true, agendaDraft: null } });
      if (made) await updateManifest(o, c, meeting.itemId, (m) => space.withAgenda(m, plan, made.documentId));
    });
    if (!made) return;
    clog.info('next agenda made', { callId, workspaceId: plan.workspaceId, documentId: made.documentId, carried: plan.open.length });
    await nudge(o, row.room_name, callId, { call: true, log: false });
  } catch (e) {
    await tx(o.pool, async (c) => {
      const held = await load(o, c, callId, true);
      const w = held.state.workspace;
      if (held.row.state === 'live' && w.agendaDraft?.documentId === draft.documentId) await save(o, c, callId, { ...held.state, workspace: { ...w, agendaDraft: { ...w.agendaDraft, until: 0 } } });
    }).catch((err: unknown) => clog.warn('next agenda not let go of', { callId, err }));
    throw e;
  }
}

/**
 * Someone opens Workspace. A home that can't be made for a guest opening it is the organizer's to hear about, not theirs,
 * and an agenda that can't be made is no reason anyone can't open the rest.
 */
async function openWorkspace(v: Viewer, callId: string, timeZone: string | undefined): Promise<CallState> {
  const o = v.organizer;
  try {
    await settledHome(o, callId, timeZone);
    await agendaFor(o, callId).catch((e: unknown) => clog.warn('next agenda not made', { callId, err: e }));
  } catch (e) {
    if (v.isOrganizer || !(e instanceof ConflictError)) throw e;
    clog.info('workspace not settled for someone opening it', { callId, code: e.code });
  }
  return view(v, o.pool, callId);
}

/** What viewing another workspace in the call would mean, for the organizer to decide. */
export async function previewWorkspace(v: Viewer, callId: string, workspaceId: string): Promise<CallWorkspaceSwitch> {
  return space.preview(v, await readerInCall(v), (await load(v.organizer, v.organizer.pool, callId)).state.people, workspaceId);
}

/* ---------- a board in a call: what's done is modules/callBoards.ts; the call's row is held here ---------- */

/** These connections, once for each person, as a seat on a board names them. */
function seatsOf(o: Owner, callId: string, people: Joined[]): boards.Here[] {
  const key = seatKey(o, callId);
  return [...new Map(people.map((j) => { const seat = seatOf(key, j); return [seat, { seat, name: j.name, email: j.email ?? null }] as const; })).values()];
}
/** Everyone in the call now, wherever they are in it: a main board is for the whole call. */
const hereIn = (o: Owner, callId: string, s: Stored): boards.Here[] => seatsOf(o, callId, s.people.filter((j) => j.status === 'in'));
/** Everyone in one part of the call now: whoever's in a room is who its board is for. */
const inPlaceOf = (o: Owner, callId: string, s: Stored, place: string): boards.Here[] => seatsOf(o, callId, s.people.filter((j) => j.status === 'in' && placeOf(s, j) === place));
/** Everyone the call has had who wasn't taken out of it, here now or not. Taking someone out ends their seats, so those don't count. */
const knownIn = (o: Owner, callId: string, s: Stored): boards.Here[] => seatsOf(o, callId, s.people.filter((j) => !s.removed.includes(j.person)));
/** The part of the call someone asking is in. */
function whereIs(v: Viewer, s: Stored): string {
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  return mine ? placeOf(s, mine) : MAIN_PLACE;
}

/**
 * Someone opens or closes a board, in two steps (`boards.prepare`), as everything about the call's workspace is: what reads or
 * changes a workspace, with nothing of the call held; then the call's row, held only to save what came of it, from the call as
 * it is then. Seats given meanwhile to someone taken out are taken back once it's let go, and anyone let in meanwhile is seated.
 */
async function actOnBoard(v: Viewer, callId: string, a: boards.BoardAction): Promise<CallState> {
  const o = v.organizer;
  if (a.type === 'board-open') boards.requireStarter(v, a.type);
  const reader = await readerInCall(v);
  const ctx = { callId, action: a.type };
  /** The call as it stands, read with `db`: the pool, or the transaction that holds its row. */
  const read = async (db: Db, held: boolean) => {
    const { row, state } = await load(o, db, callId, held);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity);
    const { manifest } = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
    const place = whereIs(v, s);
    return {
      row, state,
      changing: { v, reader, callId, meeting: manifest, s, place, inPlace: inPlaceOf(o, callId, s, place), here: hereIn(o, callId, s), known: knownIn(o, callId, s), maker: { name: mine?.name ?? v.pass.name, email: mine?.email ?? '' } }
    };
  };
  const apply = await boards.prepare((await read(o.pool, false)).changing, a);
  const { room, changed, roomBoards, closed } = await tx(o.pool, async (c) => {
    const { row, state, changing } = await read(c, true);
    const done = apply(changing);
    const saved = await saveSettled(o, c, callId, state, done.s);
    return { room: row.room_name, changed: done, roomBoards: state.board.rooms.length, closed: saved.closed };
  });
  const { what, ...done } = changed.done;
  clog.info(what, { ...done, callId });
  // A seat given to someone taken out while it was given goes, as their removal took everything else.
  for (const seat of changed.ended) await endSeat(o, callId, seat);
  // Anyone let in while it was being opened; and in a room, whoever's come or gone meanwhile.
  if (a.type === 'board-open') void syncBoardSeats({ organizer: o, callId });
  // Rooms whose time ran out closed with it, and come back; a board started in a room is everyone's there before anyone's told.
  return afterClosing({ organizer: o, callId }, closed, async () => {
    if (!closed && changed.s.board.rooms.length > roomBoards) await syncRoomBoards({ organizer: o, callId });
    await nudge(o, room, callId, { call: true, log: false });
    return view(v, o.pool, callId);
  });
}

/**
 * Someone runs the session on a board: its timer, and a vote. In two steps, as opening one is: what asks the workspace whether
 * they can edit it, and the board what's on it, with nothing of the call held; then the call's row, held only to save what came
 * of it. Everyone where the board is reads the call again, except for a vote cast or taken back, which is told to nobody else.
 * It's the board open where they are: in a room on the one board every room shares, the main room's (`boardPlace`), whose
 * timer and vote they're told of there, so they run and vote in them as everyone else on it does.
 */
async function runOnBoard(v: Viewer, callId: string, a: boards.RunAction): Promise<CallState> {
  const o = v.organizer;
  const reader = await readerInCall(v);
  const ctx = { callId, action: a.type };
  /** The call as it stands, read with `db`: the pool, or the transaction that holds its row. */
  const read = async (db: Db, held: boolean) => {
    const { row, state } = await load(o, db, callId, held);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    const s = settle(state, row);
    return { row, state, running: { v, reader, callId, s, place: boardPlace(s, whereIs(v, s)), now: secondsIn(row.started_at) } };
  };
  const apply = await boards.prepareRun((await read(o.pool, false)).running, a);
  const { room, ran, closed } = await tx(o.pool, async (c) => {
    const { row, state, running } = await read(c, true);
    const done = apply(running);
    const saved = done.changed ? await saveSettled(o, c, callId, state, done.s) : undefined;
    return { room: row.room_name, ran: done, closed: saved?.closed === true };
  });
  if (ran.done.quiet) clog.debug(ran.done.what, ran.done.context);
  else clog.info(ran.done.what, ran.done.context);
  // Rooms whose time ran out closed with it, and come back. A vote cast still tells nobody: their landing says it itself.
  return afterClosing({ organizer: o, callId }, closed, async () => {
    if (ran.tell) await nudge(o, room, callId, { call: true, log: false });
    return view(v, o.pool, callId);
  });
}

/** What opening a saved board would mean, for the menu to ask first. It holds nothing of the call. */
export async function boardCheck(v: Viewer, callId: string, workspaceId: string, documentId: string): Promise<BoardCheck> {
  boards.requireStarter(v, 'board-check');
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, what: 'board-check' } });
  const s = settle(state, row);
  return boards.check(o, await readerInCall(v), { callId, place: whereIs(v, s), here: hereIn(o, callId, s) }, workspaceId, documentId);
}

/**
 * Keeps what the call lets people into in step with who's in it: started wherever someone's let in, without waiting for it,
 * and run by upkeep, for anyone a crash left without their seat. One board at a time, so nothing here holds two workspaces'
 * locks and one that can't take anyone more stops nothing else. Each is two steps, as everything about the workspace is: the
 * seats, in the workspace's own transaction, with nothing of the call held; then the call's row, held only to save who's been
 * worked out. A seat given to someone taken out meanwhile is taken back, as is one given as the call ended. This fails on its
 * own, with a log line: letting someone in is done by then.
 */
export async function syncBoardSeats(call: CallRef): Promise<void> {
  const { organizer: o, callId } = call;
  try {
    const { row, state } = await load(o, o.pool, callId);
    if (row.state !== 'live') return;
    const s = settle(state, row);
    let changed = false;
    const ended = new Set<string>();
    for (const e of boards.dueIn(s.board, hereIn(o, callId, s))) {
      try {
        const done = await boards.seatNewcomers(o, callId, e.documentId, s.board, hereIn(o, callId, s), knownIn(o, callId, s));
        if (!done) continue;
        const saved = await tx(o.pool, async (c) => {
          const held = await load(o, c, callId, true);
          if (held.row.state !== 'live') return { saved: false, ended: done.seats };
          const board = boards.withSeen(held.state.board, done);
          if (board && board !== held.state.board) await save(o, c, callId, { ...held.state, board });
          return { saved: board !== undefined && board !== held.state.board, ended: boards.seatsToTakeBack(knownIn(o, callId, held.state), done) };
        });
        changed ||= saved.saved || done.seats.length > 0;
        for (const seat of saved.ended) ended.add(seat);
      } catch (err) {
        clog.warn('seats on a board not kept up', { callId, workspaceId: e.workspaceId, documentId: e.documentId, err });
      }
    }
    for (const seat of ended) await endSeat(o, callId, seat);
    if (changed) await nudge(o, row.room_name, callId, { call: true, log: false });
  } catch (e) {
    clog.warn('seats on the call’s boards not kept up', { callId, err: e });
  }
}

/**
 * What a room's board needs, read with `db` while its workspace is held: whether its room is open and who's in it, the
 * organizer while visiting; and once it's closed, everyone who gets it by address, the people its room's notes go to: the
 * organizer, and everyone on the invite who wasn't taken out of the call. A board nothing names the room of any more (`null`)
 * is for nobody while rooms are open, and everyone invited's once they've closed.
 */
async function roomNow(o: Owner, db: Db, callId: string, room: string | null): Promise<boards.RoomNow> {
  const { row, state } = await load(o, db, callId);
  const s = settle(state, row);
  const open = row.state === 'live' ? s.breakouts.open : null;
  if (open && (room === null || open.rooms.some((r) => r.id === room))) return { open: true, seats: room === null ? [] : inPlaceOf(o, callId, s, room), invited: [] };
  const meeting = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  return { open: false, seats: [], invited: [(await profile(o, db)).email, ...boards.onInvite(s, meeting.manifest.guests, hereIn(o, callId, s))] };
}

/**
 * Every board of the call's rooms: what the call keeps of them (`boards.roomBoardsOf`), and any its home's tree says is one of
 * this call's rooms' (`StoredItem.room`) that the call has no word of, as a save by a release that didn't know rooms' boards can
 * leave it. A board found only in the tree is for a room nothing names any more (`room: null`).
 */
async function roomBoardsFound(o: Owner, callId: string, s: Pick<Stored, 'board' | 'workspace'>): Promise<FoundRoomBoard[]> {
  const known = boards.roomBoardsOf(s.board);
  const home = s.workspace.home?.workspaceId;
  const w = home ? await serverWorkspace(o, home) : undefined;
  if (!w) return known;
  const there = new Set(known.map((b) => b.documentId));
  const marked = Object.entries(w.state.items).flatMap(([id, x]): FoundRoomBoard[] =>
    (x.room?.ownerId === o.ownerId && x.room.callId === callId && !there.has(id) && !trashOf(w.state, id) ? [{ workspaceId: w.workspaceId, documentId: id, room: null, kept: false }] : []));
  return [...known, ...marked];
}

/**
 * Keeps each room's board with the people in its room (docs: Calls and recordings › Boards in breakout rooms): its readers are
 * the seats of whoever's in the room now, the organizer's only while they're visiting. It's run wherever people move, before
 * anyone's told, so someone moved out of a room has lost its board by the time they hear, and by upkeep. Once a room has
 * closed its seats go, and everyone invited has its board by address, as a saved board like any other: then it's kept, and
 * nothing here looks at it again. It goes by every board of the call's rooms it can find (`roomBoardsFound`), so a save by a
 * release that didn't know them leaves none of them behind. One board at a time, in its workspace's own transaction with
 * nothing of the call held. Says whether anything changed. This fails on its own, with a log line: what moved people is done
 * by then.
 */
export async function syncRoomBoards(call: CallRef): Promise<boolean> {
  const { organizer: o, callId } = call;
  try {
    const { row, state } = await load(o, o.pool, callId);
    if (row.state !== 'live') return false;
    const found = await roomBoardsFound(o, callId, state);
    let changed = 0;
    const kept: string[] = [];
    for (const b of found.filter((r) => !r.kept)) {
      try {
        const done = await boards.roomInStep(o, callId, b, (db) => roomNow(o, db, callId, b.room));
        changed += done.changed;
        if (done.kept) kept.push(b.documentId);
      } catch (err) {
        clog.warn('a room’s board not kept with its room', { callId, workspaceId: b.workspaceId, documentId: b.documentId, err });
      }
    }
    // What the call had lost track of, with the room it's for, it keeps with the rest from now on.
    const lost = found.flatMap((b): RoomBoard[] => (b.room !== null && !state.board.rooms.some((r) => r.documentId === b.documentId) ? [{ ...b, room: b.room }] : []));
    if (kept.length || lost.length) await keptRooms(o, callId, kept, lost);
    if (changed) clog.info('room boards kept with their rooms', { callId, changed, kept: kept.length, found: lost.length });
    return changed > 0;
  } catch (e) {
    clog.warn('room boards not kept with their rooms', { callId, err: e });
    return false;
  }
}
/**
 * Room boards that everyone invited has by address now, so nothing about who's in their room changes them any more, and room
 * boards the call had lost track of (`lost`), kept with the rest from now on: under the call's row. Entries for boards open in
 * rooms that have closed, which a release that didn't know rooms' boards left, go: nothing reads them.
 */
async function keptRooms(o: Owner, callId: string, documentIds: string[], lost: RoomBoard[]): Promise<void> {
  await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live') return;
    const board = held.state.board;
    const known = new Set(board.rooms.map((r) => r.documentId));
    const rooms = [...board.rooms, ...lost.filter((r) => !known.has(r.documentId))].map((r): RoomBoard => (documentIds.includes(r.documentId) ? { ...r, kept: true } : r));
    const places = new Set(placesOf(held.state));
    const open = Object.fromEntries(Object.entries(board.open).filter(([place]) => places.has(place)));
    await save(o, c, callId, { ...held.state, board: { ...board, rooms, open } });
  });
}

/** What a call says of its rooms' boards to a workspace asking what's stranded (`roomsOfCalls`). */
export type RoomsOfCall = { live: true; boards: string[] } | { live: false; invited: string[] };
/**
 * What these calls (by organizer and call, as a workspace's tree names them) say of their rooms' boards, for a workspace asking
 * what's stranded, read with `db`, its transaction, and holding nothing of any call: for a call going on, every board of its
 * rooms it keeps (`boards.roomBoardsOf`); for one that's over, everyone its rooms' boards go to by address, as `roomNow` has them
 * once rooms have closed. A call that's gone, or whose organizer is, says nothing. These IDs come from a workspace's own tree.
 */
export async function roomsOfCalls(d: Deps, calls: { ownerId: string; callId: string }[], db: Db): Promise<Map<string, RoomsOfCall>> {
  const out = new Map<string, RoomsOfCall>();
  for (const at of calls) {
    const key = `${at.ownerId}/${at.callId}`;
    if (out.has(key)) continue;
    const o = await findOwner(d, at.ownerId, undefined, db);
    const found = o && await load(o, db, at.callId).catch((e: unknown) => { if (e instanceof NotFoundError) return undefined; throw e; });
    if (!o || !found) continue;
    if (found.row.state === 'live') {
      out.set(key, { live: true, boards: boards.roomBoardsOf(found.state.board).map((b) => b.documentId) });
      continue;
    }
    const meeting = await findItem(o, db, 'meeting', found.row.meeting_item_id, MeetingManifest);
    out.set(key, { live: false, invited: [(await profile(o, db)).email, ...(meeting ? boards.onInvite(found.state, meeting.manifest.guests, hereIn(o, at.callId, found.state)) : [])] });
  }
  return out;
}

/** How long whoever's landing rooms' boards has them before anyone else may try. */
const LANDING_MS = 60_000;
/** How many tries at landing may fail before it's given up, and how long after the first failure the next may be: twice that after the next. */
const LANDING_TRIES = 3;
const LANDING_AGAIN_MS = 30_000;
/** What the call says when the rooms' boards don't come back where they would. */
const LANDED_ELSEWHERE = 'The rooms’ boards came back on a new board. The one that was open can’t take them.';
const LANDED_NOWHERE = 'The rooms’ boards didn’t come back: this call’s home can’t take a new board any more. Each one is still saved there.';
/** What it says when the rooms share a new board for the same reason. */
const ROOMS_ON_NEW_BOARD = 'The rooms share a new board. The one that was open can’t take their frames.';

/** The landing under the call's row, if it's still the one claimed until `until`: whatever changed it meanwhile has it now. */
const stillLanding = (held: { row: Row; state: Stored }, until: number): Landing | undefined => {
  const l = held.state.board.landing;
  return held.row.state === 'live' && l?.until === until ? l : undefined;
};
/**
 * A try at landing that failed: it's let go, and the next try may be only once some time has gone by, longer each time, so a
 * landing that can't be done doesn't cost every call action a try. After a few it's given up, said once at warn: each room's
 * board is kept for everyone invited all the same. Under the call's row.
 */
async function landingFailed(o: Owner, callId: string, until: number, e: unknown): Promise<void> {
  await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    const l = stillLanding(held, until);
    if (!l) return;
    const tries = l.tries + 1;
    const next = tries >= LANDING_TRIES ? null : { ...l, tries, until: Date.now() + LANDING_AGAIN_MS * 2 ** (tries - 1) };
    await save(o, c, callId, { ...held.state, board: { ...held.state.board, landing: next } });
    if (next) clog.info('rooms’ boards not landed yet; trying again later', { callId, tries, againInS: Math.round((next.until - Date.now()) / 1000), err: e });
    else clog.warn('rooms’ boards not landed, and given up', { callId, tries, rooms: l.rooms.length, err: e });
  }).catch((err: unknown) => clog.warn('landing rooms’ boards not let go of', { callId, err }));
}

/**
 * Lands rooms' boards on the main board once rooms have closed (the call's `landing`), in three steps, as everything about a
 * workspace is: whoever's first takes it on under the call's row, so there's one landing however many ask at once; it's done
 * with nothing of the call held; and only then does the call let it go, opening in the main room the board it made, if it made
 * one and nothing else is open there. Landing again changes nothing, so one cut short is done again by the next to ask, or
 * upkeep, once some time has gone by (`landingFailed`). A board open in the main room that isn't the call's to write on any
 * more (`boards.land`'s `elsewhere`) gives way to a new one in the call's home, made for them as when nothing is open, which
 * opens in its place; and when the home can't take a new board, they come back nowhere. Either way the call says so. Fails on
 * its own, with a log line.
 */
export async function landRooms(call: CallRef): Promise<void> {
  const { organizer: o, callId } = call;
  try {
    const claimed = await tx(o.pool, async (c) => {
      const { row, state } = await load(o, c, callId, true);
      const l = state.board.landing;
      if (row.state !== 'live' || !l || l.until > Date.now()) return undefined;
      const until = Date.now() + LANDING_MS;
      await save(o, c, callId, { ...state, board: { ...state.board, landing: { ...l, until } } });
      return { ...l, until };
    });
    if (!claimed) return;
    const { row, state } = await load(o, o.pool, callId);
    const s = settle(state, row);
    const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
    const organizer = await profile(o);
    const main: boards.MainBoardFor = { o, callId, s, meeting: meeting.manifest, here: hereIn(o, callId, s), known: knownIn(o, callId, s), maker: { name: organizer.name, email: organizer.email }, asOrganizer: true };
    const home = s.workspace.home;
    const open = s.board.open[MAIN_PLACE];
    let l: Landing = claimed;
    /** The board open in the main room that the one made for them takes the place of. */
    let insteadOf: string | null = null;
    let made: boards.MadeMain | null = null;
    for (;;) {
      const opener = !l.make && open?.documentId === l.into.documentId ? open.by : null;
      let landed: boards.Landed;
      try {
        landed = await boards.land(o, callId, l, { main, folderId: home?.workspaceId === l.into.workspaceId ? home.folderId : null }, opener);
      } catch (e) {
        await landingFailed(o, callId, claimed.until, e);
        return;
      }
      if (landed.kind === 'landed') { made = landed.made; break; }
      if (landed.kind === 'elsewhere' && insteadOf !== null) {
        await landingFailed(o, callId, claimed.until, new ConflictError('The board made for the rooms’ boards can’t take them.', { context: { callId } }));
        return;
      }
      if (landed.kind === 'shut') {
        // Nothing can be made for them: each room's board stays as it is, everyone invited's, and the call says so.
        const told = await tx(o.pool, async (c) => {
          const held = await load(o, c, callId, true);
          if (!stillLanding(held, claimed.until)) return false;
          await save(o, c, callId, notice({ ...held.state, board: { ...held.state.board, landing: null } }, LANDED_NOWHERE, 'info'));
          return true;
        });
        if (told) {
          clog.info('rooms’ boards not landed: the call’s home can’t take a new board', { callId, rooms: l.rooms.length });
          await nudge(o, row.room_name, callId, { call: true, log: false });
        }
        return;
      }
      // The board they were coming back to isn't the call's to write on any more: a new one in the call's home, as when nothing's open.
      const into = { workspaceId: home?.workspaceId ?? l.rooms[0]?.workspaceId ?? l.into.workspaceId, documentId: id128() };
      const moved = await tx(o.pool, async (c) => {
        const held = await load(o, c, callId, true);
        const now = stillLanding(held, claimed.until);
        if (!now) return undefined;
        const next: Landing = { ...now, into, make: true };
        await save(o, c, callId, { ...held.state, board: { ...held.state.board, landing: next } });
        return next;
      });
      if (!moved) return;
      clog.info('rooms’ boards come back on a new board: the one open can’t take them', { callId, rooms: moved.rooms.length });
      insteadOf = l.into.documentId;
      l = moved;
    }
    const host = s.people.findLast((j) => j.role === 'host');
    const by: Controller | null = host ? { person: host.person, seat: seatOf(seatKey(o, callId), host), name: organizer.name, email: organizer.email } : null;
    const again = await tx(o.pool, async (c) => {
      const held = await load(o, c, callId, true);
      const now = stillLanding(held, claimed.until);
      if (!now) return false;
      // Rooms that closed meanwhile land next, on the same board.
      const rest = now.rooms.filter((r) => !l.rooms.some((x) => x.documentId === r.documentId));
      let board: CallBoards = { ...held.state.board, landing: rest.length ? { ...now, rooms: rest, into: l.into, make: false, until: 0, tries: 0 } : null };
      // The board made for them opens for everyone, in place of the one that couldn't take them, as another opening would replace it.
      const there = board.open[MAIN_PLACE];
      if (made && by && (!there || there.documentId === insteadOf)) {
        const { [MAIN_PLACE]: _was, ...ideas } = board.ideas;
        board = { ...board, open: { ...board.open, [MAIN_PLACE]: { workspaceId: made.workspaceId, documentId: made.documentId, by, timer: null, vote: null } }, letIn: [...board.letIn, made.entry], ideas };
      }
      await save(o, c, callId, insteadOf !== null && made ? notice({ ...held.state, board }, LANDED_ELSEWHERE, 'info') : { ...held.state, board });
      return rest.length > 0;
    });
    if (made) void syncBoardSeats(call);
    await nudge(o, row.room_name, callId, { call: true, log: false });
    if (again) void landRooms(call);
  } catch (e) {
    clog.warn('rooms’ boards not landed', { callId, err: e });
  }
}

/** Who worked on what is only ever added to: each person and document is noted once, so typing doesn't hold the call's row. */
const noted = new Set<string>();
/**
 * Someone in this call changed a document. It's noted under the call's row, once for each of them, and it's worth less than
 * what they typed, which is safe by now: a failure is logged, and the next update tries again. Only the first looks at what
 * the document is: every update comes through here, and what's asked for each of those is kept as small as it can be.
 */
export async function workedOn(v: Viewer, at: Pick<WorkedDocument, 'workspaceId' | 'documentId'>, by: WorkedBy): Promise<void> {
  const o = v.organizer;
  const { callId } = v.pass;
  const key = `${callId}|${at.workspaceId}|${at.documentId}|${by.id}`;
  if (noted.has(key)) return;
  try {
    const entry = await space.workedEntry(o, at);
    if (!entry) return;
    await tx(o.pool, async (c) => {
      const { row, state } = await load(o, c, callId, true);
      const next = row.state === 'live' ? withWorked(state.workspace, entry, by) : undefined;
      if (next) await save(o, c, callId, { ...state, workspace: next });
    });
    if (noted.size > 10_000) noted.clear();
    noted.add(key);
  } catch (e) {
    clog.warn('what was worked on in a call not kept', { callId, workspaceId: at.workspaceId, documentId: at.documentId, err: e });
  }
}

/** The call's follow-ups as this person may read them: the live notes' where they are, and the documents' they can open. */
export async function followUpsIn(v: Viewer, callId: string): Promise<CallFollowUps> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'follow-ups' } });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const place = mine ? placeOf(s, mine) : MAIN_PLACE;
  const invited = invitedIn(await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting'));
  return space.followUps(o, await readerInCall(v), await notesFor(v, o.pool, row, s, mine, place, invited), capturing(row, s, place).status, s.workspace.worked);
}
/** Ticks a to-do in a document worked on in this call, and it's worked on by whoever ticked it. */
export async function tickDocumentFollowUp(v: Viewer, callId: string, t: DocFollowUpTick): Promise<CallFollowUps> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'follow-ups' } });
  const { entry, by } = await space.tick(o, await readerInCall(v), callId, state.workspace.worked, t);
  await workedOn(v, entry, by);
  return followUpsIn(v, callId);
}

/**
 * Asking about a selection needs in a call what catching up does: everything that reaches the AI from a call waits while
 * notes, or the room someone's in, are paused, and a call whose notes have never been on sends it nothing.
 */
export async function mayAskInCall(v: Viewer): Promise<void> {
  const { row, state } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const ctx = { callId: v.pass.callId, what: 'ask-selection' };
  const call = capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE);
  capture.mayReachAi(call, 'ask', ctx);
  if (!call.noteId) throw new ConflictError('Notes aren’t on in this call, so nothing goes to the AI from it.', { context: ctx });
}

/**
 * Sort into themes on a board, from a call: someone asked for it, about what people wrote, so it needs no notes, only that the
 * part of the call they're in isn't paused, when nothing goes to the AI.
 */
export async function maySortInCall(v: Viewer): Promise<void> {
  const { row, state } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  capture.mayReachAi(capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE), 'sort', { callId: v.pass.callId, what: 'board-sort' });
}

/** Someone rung answers: the organizer's browser is told, so their arch shows it. */
export async function answerRing(who: Owner, ringId: string, reply: RingReply): Promise<void> {
  const { organizer, meetingId } = await rings.answer(who, ringId, reply);
  const live = await liveCall(organizer, organizer.pool, meetingId);
  if (live) await nudge(organizer, live.room_name, live.call_id, { call: true, log: false });
}

type CaptureAction = Extract<CallAction, { type: 'notes' | 'pause' | 'resume' | 'request-notes' | 'decline-notes' | 'unavailable' | 'screens' }>;
/**
 * What the call captures, changed (modules/capture.ts). Only the organizer turns notes on or off, pauses and resumes
 * them, has shared screens read or stops it, says not now to an ask, and says what their browser can't capture (app.ts
 * lets nobody else through). Anyone else in the call asks for notes while they're off or paused, or takes the ask
 * back. Turning notes on, or resuming, says yes to every ask.
 */
async function changeCapture(v: Viewer, c: Db, row: Row, s: Stored, a: CaptureAction, at: number): Promise<Stored> {
  const o = v.organizer;
  const ctx = { callId: row.call_id, action: a.type, notes: s.notes.status };
  const meeting = () => getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  if (a.type === 'notes') {
    if (a.on && s.notes.status !== 'on') {
      const on = await startNotes(o, c, s, await meeting(), at, 'organizer');
      return notice(on, on.notes.screens.on ? 'The organizer turned on notes, and what anyone shares is read for them. Everyone here can see that.' : 'The organizer turned on notes. Everyone here can see that.');
    }
    if (!a.on && s.notes.status !== 'off') {
      const { keepTranscript, keepRecording } = (await meeting()).manifest.choices;
      return notice(await stopNotes(o, c, s, at, 'off'), keepTranscript && keepRecording ? 'The organizer turned off notes. What was written so far is kept.' : 'The organizer turned off notes. What was captured so far still goes into the notes.');
    }
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
  if (a.type === 'unavailable') {
    // What the host's browser can't capture now (no microphone, or a browser that can't record or listen). It
    // only means something while notes are on; one that arrives after a pause or notes off is from before it.
    if (s.notes.status !== 'on') return s;
    return { ...s, notes: { ...s.notes, unavailable: [...new Set(a.parts)] } };
  }
  if (a.type === 'screens') {
    const sc = s.notes.screens;
    if (a.on === sc.on) return s;
    // Frames go into the notes, beside what was said, so they're read only while there are notes to read them into.
    if (a.on && s.notes.status === 'off') throw new ConflictError('Turn on notes first: shared screens are read for the notes.', { context: ctx });
    if (a.on && s.notes.noteId && await screens.full(o, c, s.notes.noteId)) throw new ConflictError(FULL, { context: { ...ctx, max: o.cfg.SCREEN_FRAMES_MAX } });
    const next: Stored = { ...s, notes: { ...s.notes, screens: { ...sc, on: a.on, history: [...sc.history, { at, on: a.on, segment: s.notes.segment, by: 'organizer' }] } } };
    return notice(next, a.on ? 'The organizer turned on shared screens in the notes. What anyone shares is read for them.' : 'The organizer turned off shared screens in the notes. What was shared before is kept.');
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

/**
 * What the capture gate needs to know about this call, in one of its parts (`place`): a breakout room captures at most
 * what the call does, and nothing while the organizer has paused it.
 */
/** A breakout room's own pauses, while it's open or since it closed. */
const roomPausesOf = (s: Stored, room: string): capture.RoomPause[] =>
  (s.breakouts.open?.rooms.find((r) => r.id === room) ?? s.breakouts.held.flatMap((h) => h.rooms).find((r) => r.id === room))?.pauses ?? [];
const capturing = (row: Pick<Row, 'state'>, s: Stored, place: string = MAIN_PLACE): capture.Capturing => {
  const room = s.breakouts.open?.rooms.find((r) => r.id === place);
  const status = room ? capture.roomStatus(s.notes.status, room.pauses) : s.notes.status;
  return { live: row.state === 'live', status, noteId: s.notes.noteId, recordingId: s.notes.recordingId, screens: s.notes.screens.on, room: status !== s.notes.status };
};

export async function audio(v: Viewer, callId: string, piece: Piece): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: piece.segment, seq: piece.seq, currentSegment: state.notes.segment };
  stillHosting(v, state, ctx, mainScribeOf(state));
  const into = capture.mayCapture(capturing(row, state), 'audio', ctx);
  if (piece.segment !== state.notes.segment) throw new ConflictError('That audio belongs to an earlier part of the recording.', { context: ctx });
  await appendPiece(o, into.recordingId, piece);
  return view(v, o.pool, callId);
}

/**
 * Speech heard in the call, into the live transcript under whoever said it while notes are on: by the browser of whoever
 * hosts in the main room, by a breakout room's scribe in the room (someone in the call, or just gone, for a clip still on
 * its way). It's placed in the part of the call its speaker was in when they began (`began`, ms on this server's clock):
 * a clip still on its way when someone moves stays where it was said. Said while rooms were open, it's kept for the
 * people there then; a room's lines stay until the call ends, a room that has closed since included, and go into its
 * section of the notes.
 */
export async function transcribe(v: Viewer, callId: string, clip: transcripts.Clip, speaker: string, began: number, count: () => void): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const nowMs = Date.now();
  const s = settle(state, row, nowMs);
  const ctx = { callId, segment: clip.segment, atMs: clip.atMs, currentSegment: state.notes.segment, agoMs: nowMs - began };
  const into = capture.mayCapture(capturing(row, state), 'speech', ctx);
  if (clip.segment !== state.notes.segment) throw new ConflictError('That speech belongs to an earlier part of the recording.', { context: ctx });
  const who = s.people.find((j) => j.identity === speaker);
  if (!who || (who.status !== 'in' && who.status !== 'left')) throw new ValidationError('That speech isn’t from anyone in this call.', { context: ctx });
  // Nobody's speech begins before they came into the call.
  const t0 = Math.max(began, who.since);
  const place = placeAt(s, who, t0);
  if (place === undefined) throw new ConflictError('Where that speech was said can’t be told any more.', { context: { ...ctx, why: 'moved since' } });
  // One browser hears each part of the call, and only it sends what's said there: the main room whoever hosts now, a
  // breakout room its scribe when the speech began (scribes.ts), even if that's changed since. A connection that hosted
  // before is told it's out of date, so what it still sends stops there quietly.
  const term = place === MAIN_PLACE ? undefined : scribeAt(s, place, t0);
  if ((place === MAIN_PLACE ? mainScribeOf(s) : term?.identity) !== v.pass.identity) {
    const refused = { ...ctx, room: place !== MAIN_PLACE ? 1 : 0, term: term?.term ?? null };
    if (v.stale) throw new ConflictError('You’re not hosting this call from here any more.', { context: { ...refused, why: 'not host' }, level: 'info' });
    throw new ForbiddenError(place === MAIN_PLACE ? 'Only the host’s browser sends what’s said in the main room.' : 'Only the room’s scribe sends what’s said in a breakout room.', { context: refused });
  }
  // Counted against the voice's and the account's allowances only now: speech refused above costs nobody's.
  count();
  // The gate again, for the part of the call it was said in: a room the organizer paused takes nothing.
  capture.mayCapture(capturing(row, s, place), 'speech', { ...ctx, why: 'room paused' });
  // A breakout room's speech is taken only if the room was capturing when it began, and placed in the segment by this
  // server's clock: its scribe's browser counts from when it loaded, not from when the segment began.
  let atMs: number | undefined;
  if (place !== MAIN_PLACE) {
    const said = (t0 - row.started_at.getTime()) / 1000;
    if (!capture.roomCapturingAt(s.notes.history, roomPausesOf(s, place), said)) {
      throw new ConflictError('Notes were paused in this room when that was said.', { context: { ...ctx, why: 'said while paused' } });
    }
    atMs = Math.max(0, Math.round((said - s.notes.segmentFrom) * 1000));
  }
  const readers = roomsOpenAt(s, row, t0) ? readersAt(s, place, t0) : undefined;
  await transcripts.hear(o, into, clip, { speaker, ...(place !== MAIN_PLACE ? { room: place } : {}), ...(readers ? { readers } : {}), began: t0, ...(atMs === undefined ? {} : { atMs }) });
  await nudge(o, row.room_name, callId, { call: true, log: false });
  return view(v, o.pool, callId);
}

/* ---------- shared screens: frames from each presenter's own browser, while screen notes are on ---------- */

/** A frame as its presenter's browser sent it: which share, when it was taken (ms, on this server's clock), the JPEG and its size. */
export interface FrameUpload { share: string; takenAt: number; jpeg: Uint8Array; width: number; height: number }

/** Shares LiveKit said someone has up, by room, identity and track, for a few seconds: frames come every few seconds. */
const sharing = new Map<string, number>();
const SHARE_SEEN_MS = 10_000;
/** Whether `identity` is sharing the screen `share` in the call's room now, as LiveKit sees its tracks. Never a camera. */
async function ownShare(o: Owner, roomName: string, identity: string, share: string): Promise<boolean> {
  const id = `${roomName}|${identity}|${share}`;
  if ((sharing.get(id) ?? 0) > Date.now()) return true;
  const shares = await o.livekit.screenShares(roomName).catch((e: unknown) => {
    throw new UnavailableError('We couldn’t check the shared screen with the call’s media server. Try again in a moment.', { cause: e });
  });
  const yes = shares.some((x) => x.identity === identity && x.sid === share);
  if (yes) {
    if (sharing.size > 10_000) sharing.clear();
    sharing.set(id, Date.now() + SHARE_SEEN_MS);
  }
  return yes;
}

/**
 * A frame of someone's own shared screen, into the call's notes, while screen notes are on (the capture gate decides,
 * as for audio and speech). Only the presenter's own share: LiveKit must list it as a screen this person is sharing in
 * this call, so another person's share, a camera or a share that's over is refused, as is one their browser said
 * ended. Nothing is taken from a breakout room, or that was taken before screen notes came on or were resumed. It's
 * placed where it was on screen: when it was taken, by the server's clock. Once the notes have kept as many frames
 * as they may, screen notes turn off for everyone, saying why.
 */
export async function shareFrame(v: Viewer, callId: string, f: FrameUpload): Promise<ScreenFrameReceipt> {
  requireIn(v, 'screen');
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const at = tenthsIn(row.started_at, f.takenAt);
  const ctx = { callId, segment: s.notes.segment, bytes: f.jpeg.length, ageMs: Date.now() - f.takenAt, role: v.pass.role };
  // Where its presenter was when it was taken (never before they came into the call), as for speech: a frame from a
  // breakout room, the organizer's own share while it's visiting one included, stays out of the notes. So does one
  // whose place can't be told any more (two moves since).
  const presenter = s.people.find((j) => j.identity === v.pass.identity);
  const where = presenter ? placeAt(s, presenter, Math.max(f.takenAt, presenter.since)) : undefined;
  const into = capture.mayCapture({ ...capturing(row, s), inRoom: where !== MAIN_PLACE }, 'screen', ctx);
  // Taken before notes came on, were resumed, or screens were turned on: from a stretch that wasn't captured.
  const since = Math.max(s.notes.history.filter((h) => h.status === 'on').at(-1)?.at ?? 0, s.notes.screens.history.filter((h) => h.on).at(-1)?.at ?? 0);
  if (at < since) throw new ConflictError('That frame was taken before screen notes were on, so it isn’t kept.', { context: { ...ctx, early: Math.round((since - at) * 10) / 10 } });
  const over = s.notes.screens.ended.some((e) => e.presenter === v.pass.identity && e.share === f.share && e.at <= at);
  if (over || !row.room_name || !(await ownShare(o, row.room_name, v.pass.identity, f.share))) throw new ForbiddenError(NOT_YOURS, { context: { ...ctx, ended: over } });
  const kept = await screens.keep(o, into, { presenter: v.pass.identity, share: f.share, at, segment: s.notes.segment, jpeg: f.jpeg, width: f.width, height: f.height });
  if (kept !== 'full') return kept;
  await screensFull(o, callId);
  throw new ConflictError(FULL, { context: { ...ctx, max: o.cfg.SCREEN_FRAMES_MAX } });
}
const NOT_YOURS = 'That isn’t a screen you’re sharing in this call.';
const FULL = 'The notes have kept as many shared screens as they can for this call.';

/** The notes are full of frames: screen notes turn off for everyone, with a notice saying why, as if the organizer had. */
async function screensFull(o: Owner, callId: string): Promise<void> {
  const turned = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const sc = state.notes.screens;
    if (row.state !== 'live' || !sc.on) return null;
    const off: Stored = { ...state, notes: { ...state.notes, screens: { ...sc, on: false, history: [...sc.history, { at: tenthsIn(row.started_at), on: false, segment: state.notes.segment, by: 'organizer' }] } } };
    await save(o, c, callId, notice(off, 'Shared screens are off: the notes have kept as many as they can for this call. What was shared is kept.'));
    return { room: row.room_name };
  });
  if (!turned) return;
  clog.info('screen notes turned off: the notes are full', { callId, max: o.cfg.SCREEN_FRAMES_MAX });
  await nudge(o, turned.room, callId, { call: true, log: false });
}

/** At most this many ended shares are remembered in a call (its sealed state stays small). */
const MAX_ENDED = 500;
/**
 * Shares that ended, `at` seconds into the call: what each showed last stops there in the notes. Only while screens
 * have ever been read in the call (otherwise there's nothing to stop).
 */
function sharesEnd(s: Stored, ends: (string | { share: string | null; presenter: string })[], at: number): Stored {
  const sc = s.notes.screens;
  if (!sc.history.length || !ends.length) return s;
  const more = ends.map((e) => (typeof e === 'string' ? { share: null, presenter: e } : e)).map((e) => ({ ...e, at, segment: s.notes.segment }));
  return { ...s, notes: { ...s.notes, screens: { ...sc, ended: [...sc.ended, ...more].slice(0, MAX_ENDED) } } };
}
/** The presenter's browser says one of its shares ended: what it showed last stops there in the notes. Only their own shares. */
export async function shareEnded(v: Viewer, callId: string, share: string): Promise<void> {
  requireIn(v, 'share-ended');
  const o = v.organizer;
  await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId } });
    if (state.notes.screens.ended.some((e) => e.share === share && e.presenter === v.pass.identity)) return;
    await save(o, c, callId, sharesEnd(state, [{ share, presenter: v.pass.identity }], tenthsIn(row.started_at)));
  });
  // Frames of it already checked with LiveKit stop being taken at once, not when that check runs out.
  for (const id of sharing.keys()) if (id.endsWith(`|${v.pass.identity}|${share}`)) sharing.delete(id);
  clog.debug('share ended', { callId, role: v.pass.role });
}

/* ---------- end-to-end encryption: the API orders and relays the call's MLS messages, and never reads them ---------- */

/** At most this many entries of the log in one answer; `more` says to ask again. */
const MLS_PAGE = 100;

/**
 * The call's MLS log after `after`, as this person may see it. The host's browser reads every group's commits from
 * the start of the generation, and chat only from the part of the call it's in, since it got there; whom it may add to
 * each group comes with that person's latest key package, however long ago it arrived. Anyone else reads only the group
 * of the part of the call they're in: their welcome into it, its commits, and its chat while they're there, since they
 * last got there. Read up to the call's last seq as it stood, so nothing is skipped or sent twice. Also where they stand
 * and where they are, and for the host's browser whom to let into each group and take out of it.
 */
export async function mlsSync(v: Viewer, callId: string, after: number): Promise<CallMls> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  // Rooms whose time is up have closed for the keys too: nobody is in their groups any more.
  const s = settle(state, row);
  const gen = row.mls_generation;
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  // Where they stand as of this read, not the pass check's: the host's browser may have let them in in between. The
  // connection that hosts gets the committer's view: it makes and commits every group in this generation.
  const hosting = v.isHost && s.host === v.pass.identity;
  // An organizer's connection that's gone while someone stands in: joining again takes the call back.
  const away = mine?.role === 'host' && mine.status === 'left' && !s.people.some((j) => j.role === 'host' && j.status === 'in');
  const admission = hosting || mine?.status === 'in' ? 'in' : mine?.status === 'waiting' ? 'waiting' : away && row.state === 'live' ? 'away' : mine && mayComeBack(mine) ? 'out' : 'denied';
  const place = mine ? placeOf(s, mine) : MAIN_PLACE;
  const group = mine ? groupOf(s, mine) : null;
  const quiet: CallMls = { generation: gen, admission, committer: committerOf(s), place, group, groups: [], items: [], earlierChat: false, keys: false, latest: after, more: false };
  if (admission !== 'in' || row.state !== 'live' || !mine) return quiet;
  const keys = needsKeys(s, gen, mine);
  let from = after;
  let found: z.infer<typeof MlsRow>[];
  if (hosting) {
    found = await rows(o.pool, MlsRow,
      `SELECT seq, kind, party, grp, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND seq > $4 AND seq <= $5
         AND (kind = 'commit' OR (kind = 'message' AND grp = $6 AND seq > $7)) ORDER BY seq LIMIT ${MLS_PAGE}`,
      [o.ownerId, callId, gen, from, row.mls_seq, place, mine.placedSeq]);
  } else {
    // In no group yet (or between two): nothing to read until the welcome comes; fresh keys first, if there are none to add them with.
    if (group === null) return { ...quiet, keys };
    from = Math.max(after, mine.from - 1);
    // Chat only from since they last came into this part of the call: someone moved out and straight back before their
    // removal was committed doesn't get what was said while they were away.
    found = await rows(o.pool, MlsRow,
      `SELECT seq, kind, party, grp, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND seq > $4 AND seq <= $5 AND grp = $6
         AND (kind = 'commit' OR (kind = 'welcome' AND party = $7) OR (kind = 'message' AND $8 AND seq > $9)) ORDER BY seq LIMIT ${MLS_PAGE}`,
      [o.ownerId, callId, gen, from, row.mls_seq, group, v.pass.identity, place === group, mine.placedSeq]);
  }
  const items: CallMlsItem[] = [];
  for (const r of found) if (r.grp !== null && r.kind !== 'keypackage') items.push({ kind: r.kind, seq: r.seq, group: r.grp, epoch: r.epoch, body: openMls(o, callId, r) });
  const more = found.length === MLS_PAGE;
  const latest = more ? (found.at(-1)?.seq ?? from) : Math.max(from, row.mls_seq);
  const groups: CallMlsGroup[] = hosting ? await groupsFor(o, callId, row, s)
    : group === null ? [] : [{ id: group, epoch: epochIn(row.mls_epoch, s, group) ?? 0, pending: [], departed: [] }];
  const out: CallMls = { ...quiet, groups, items, latest, more, keys, earlierChat: (hosting || place === group) && mine.chatBefore };
  clog.debug('call keys synced', {
    callId, generation: gen, admission, groups: groups.length, items: items.length, more, after,
    departed: groups.reduce((n, g) => n + g.departed.length, 0), pending: groups.reduce((n, g) => n + g.pending.length, 0), room: place !== MAIN_PLACE, keys
  });
  return out;
}

/**
 * For the host's browser, every part of the call's group: its epoch, who to take out, and who it may add, each
 * with their latest key package. A key package can arrive before its owner may be added (someone being moved sends one
 * while still in their old group), so it's handed over with them rather than only as the log goes by.
 */
async function groupsFor(o: Owner, callId: string, row: Row, s: Stored): Promise<CallMlsGroup[]> {
  const gen = row.mls_generation;
  const pending = placesOf(s).map((p) => ({ place: p, people: s.people.filter(pendingFor(s, gen, p)) }));
  const ids = pending.flatMap((g) => g.people.map((j) => j.identity));
  const kps = ids.length ? await rows(o.pool, MlsRow,
    `SELECT DISTINCT ON (party) seq, kind, party, grp, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND kind = 'keypackage' AND party = ANY($4::text[]) ORDER BY party, seq DESC`,
    [o.ownerId, callId, gen, ids]) : [];
  const kpOf = new Map(kps.flatMap((r): [string, string][] => (r.party ? [[r.party, openMls(o, callId, r)]] : [])));
  return pending.map((g) => ({
    id: g.place, epoch: epochIn(row.mls_epoch, s, g.place) ?? 0,
    pending: g.people.flatMap((j) => { const keyPackage = kpOf.get(j.identity); return keyPackage ? [{ id: j.identity, admit: j.admit, keyPackage }] : []; }),
    departed: s.people.filter(departedFrom(s, g.place)).map((j) => j.identity)
  }));
}

/**
 * A commit from the host's browser to one part of the call's group: who it adds and removes, and the welcome for whoever
 * it adds. The API takes exactly one commit per epoch for each group, in order, so every browser applies the same ones,
 * and only from the connection hosting in this generation, checked again here under the call's row lock: a host that
 * was replaced a moment ago can't slip one in. Everyone added must be someone the host's browser may add to that group
 * now (in no other group); anyone removed is out of that group, and nothing else; a commit adding nobody and removing
 * nobody just moves the keys on.
 */
export async function mlsCommit(v: Viewer, callId: string, b: z.infer<typeof CallCommitBodySchema>): Promise<{ epoch: number }> {
  const o = v.organizer;
  const ctx = { callId, generation: b.generation, epoch: b.epoch, added: b.added.length, removed: b.removed.length, room: b.group !== MAIN_PLACE };
  /** The meeting, and who this put on its invite: a home made for the call lets them in too, as does each workspace made in it. */
  const invited: { meetingId: string; add: string[]; made: string[] } = { meetingId: '', add: [], made: [] };
  const { room, closed } = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    let s = settle(state, row);
    stillHosting(v, s, ctx, committerOf(s));
    const epoch = epochIn(row.mls_epoch, s, b.group);
    if (epoch === undefined) throw new ConflictError('That room has closed.', { context: ctx, level: 'info' });
    if (b.generation !== row.mls_generation || b.epoch !== epoch) {
      throw new ConflictError('The call’s keys have moved on. Catch up and try again.', { context: { ...ctx, current: epoch, currentGeneration: row.mls_generation }, level: 'info' });
    }
    const may = pendingFor(s, row.mls_generation, b.group);
    const people = new Map(s.people.map((j) => [j.identity, j]));
    for (const id of b.added) {
      const j = people.get(id);
      // Nobody the organizer removed is added again, whichever connection of theirs is asking.
      if (!j || !may(j) || s.removed.includes(j.person)) throw new ValidationError('Someone in that commit isn’t waiting to join.', { context: ctx });
    }
    if (new Set(b.added).size !== b.added.length) throw new ValidationError('Someone is in that commit twice.', { context: ctx });
    if (b.added.length && !b.welcome) throw new ValidationError('Adding people needs a welcome for them.', { context: ctx });
    const at = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq: at, generation: row.mls_generation, epoch: b.epoch, grp: b.group }, 'commit', null, b.commit);
    let seq = at;
    const welcomed = new Map<string, number>();
    for (const id of b.added) {
      seq += 1;
      welcomed.set(id, seq);
      if (b.welcome) await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: b.epoch + 1, grp: b.group }, 'welcome', id, b.welcome);
    }
    if (b.group === MAIN_PLACE) {
      await exec(c, 'UPDATE calls SET mls_epoch = $3, mls_seq = $4, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, b.epoch + 1, seq]);
    } else {
      await exec(c, 'UPDATE calls SET mls_seq = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, seq]);
      const open = s.breakouts.open;
      if (open) s = { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => (r.id === b.group ? { ...r, epoch: b.epoch + 1 } : r)) } } };
    }
    const now = Date.now();
    // Added: in that group from now (their key package is used up), reading its log from their welcome, and told whether
    // there was chat there they can't read. Newly let in: in the call, and in their part of it, from now.
    for (const id of b.added) {
      s = withPerson(s, id, (j) => ({
        ...j, status: 'in', group: b.group, keysFor: -1, from: welcomed.get(id) ?? seq, chatBefore: chatSince(s, j, b.group),
        ...(j.status === 'in' ? {} : { since: now, placedAt: now, placedSeq: at, wasIn: null })
      }));
    }
    // Taken out: out of that group, and nothing more. Leaving the call is the API's to say, not a commit's.
    for (const id of b.removed) s = withPerson(s, id, (j) => (j.group === b.group ? { ...j, group: null } : j));
    // Nobody in the call needs ringing: the ring goes the moment they're let in, so an arch becomes a tile with no gap.
    await rings.arrived(o, c, row.meeting_item_id, b.added.flatMap((id) => { const email = people.get(id)?.email; return email ? [email] : []; }));
    // Signed in and let in by the organizer, who saw who it was (they asked; nobody let in without asking counts):
    // added to the invite, so they get the notes like everyone invited. Only the organizer adds anyone to their invite:
    // whoever someone standing in lets in is in the call as a guest, without the notes. An address comes with an ask
    // only when the notes may go to it (see join).
    const signedIn = !v.isOrganizer ? [] : b.added.flatMap((id) => { const j = people.get(id); return j?.status === 'waiting' && j.admit === 'ask' && j.role === 'guest' && j.email ? [{ id, email: j.email }] : []; });
    if (signedIn.length) {
      const wanted = [...new Set(signedIn.map((x) => x.email))];
      const added = await addToInvite(o, c, { meetingId: row.meeting_item_id, noteId: s.notes.noteId }, wanted);
      for (const x of signedIn) if (added.includes(x.email)) s = withPerson(s, x.id, (j) => ({ ...j, role: 'invited' }));
      invited.meetingId = row.meeting_item_id;
      invited.add.push(...added);
      invited.made = s.workspace.made;
      clog.info('added to the invite', { callId, meetingId: row.meeting_item_id, noteId: s.notes.noteId, people: added.length });
      // The invite is full: they're in the call, as guests, without the notes.
      if (added.length < wanted.length) clog.warn('invite full; let in without the notes', { callId, meetingId: row.meeting_item_id, people: wanted.length - added.length });
    }
    return { room: row.room_name, closed: (await saveSettled(o, c, callId, state, s)).closed };
  });
  clog.info('call keys moved on', { ...ctx, next: b.epoch + 1, bytes: b.commit.length + (b.welcome?.length ?? 0) });
  if (invited.add.length) await space.followHome(o, invited.meetingId, invited, invited.made);
  // Rooms whose time ran out closed with it, and come back.
  return afterClosing({ organizer: o, callId }, closed, async () => {
    // Letting someone in doesn't wait for a workspace: a seat lands a moment later, and the call reads itself again when it does.
    if (b.added.length) { void syncBoardSeats({ organizer: o, callId }); if (!closed) void syncRoomBoards({ organizer: o, callId }); }
    await nudge(o, room, callId, { call: closed || b.added.length > 0 || b.removed.length > 0, log: true });
    if (b.added.length && room) {
      // Whoever was just let in should reach the room soon; anyone who doesn't (their tab closed while they asked) is taken out.
      const d: Deps = { cfg: o.cfg, pool: o.pool, objects: o.objects, livekit: o.livekit, hub: o.hub, docs: o.docs };
      const ownerId = o.ownerId;
      setTimeout(() => { arrivals(d, ownerId, callId, room, Date.now()).catch((err: unknown) => clog.warn('checking who reached the room failed', { callId, err })); }, ARRIVAL_MS + 1_000).unref();
    }
    return { epoch: b.epoch + 1 };
  });
}

/**
 * Chat, as an MLS message from someone in the group of the part of the call they're in: stored as it came, and
 * relayed to everyone in that group. Nobody chats into another part of the call, whoever hosts included.
 */
export async function mlsMessage(v: Viewer, callId: string, b: z.infer<typeof CallMessageBodySchema>): Promise<void> {
  requireIn(v, 'chat');
  const o = v.organizer;
  const ctx = { callId, epoch: b.epoch, room: b.group !== MAIN_PLACE };
  const { room, closed } = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity);
    // Whoever hosts is in every group, and chats only in the part of the call it's in; anyone else, in the group they're in.
    if (!mine || placeOf(s, mine) !== b.group || (mine.identity !== s.host && groupOf(s, mine) !== b.group)) throw new ValidationError('You’re in another part of the call now.', { context: ctx });
    const epoch = epochIn(row.mls_epoch, s, b.group);
    if (epoch === undefined || b.generation !== row.mls_generation || b.epoch > epoch) throw new ConflictError('The call’s keys have moved on. Catch up and try again.', { context: { ...ctx, current: epoch ?? null }, level: 'info' });
    const seq = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: b.epoch, grp: b.group }, 'message', null, b.message);
    await exec(c, 'UPDATE calls SET mls_seq = $3 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, seq]);
    return { room: row.room_name, closed: (await saveSettled(o, c, callId, state, { ...s, chatAt: { ...s.chatAt, [b.group]: seq } })).closed };
  });
  // Sizes only: what was said is in the MLS message, which nobody here can read.
  clog.debug('chat relayed', { ...ctx, bytes: b.message.length });
  await afterClosing({ organizer: o, callId }, closed, () => nudge(o, room, callId, { call: closed, log: true }));
}

/**
 * A fresh key package from someone already let in who's on their way into a group (after the connection that hosts
 * changed, or a move to another part of the call): the host's browser adds them with it.
 */
export async function mlsKeyPackage(v: Viewer, callId: string, b: z.infer<typeof CallKeyPackageBodySchema>): Promise<void> {
  requireIn(v, 'rejoin');
  const o = v.organizer;
  const r = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity);
    if (row.state !== 'live' || !mine || b.generation !== row.mls_generation || !needsKeys(s, row.mls_generation, mine)) {
      throw new ConflictError('There’s nothing to rejoin.', { context: { callId, generation: b.generation, current: row.mls_generation }, level: 'info' });
    }
    const seq = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: row.mls_epoch, grp: null }, 'keypackage', mine.identity, b.keyPackage);
    await exec(c, 'UPDATE calls SET mls_seq = $3 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, seq]);
    const next = withPerson(s, mine.identity, (j) => ({ ...j, admit: 'auto', keysFor: row.mls_generation }));
    const { closed } = await saveSettled(o, c, callId, state, next);
    return { room: row.room_name, moving: groupOf(s, mine) !== null || placeOf(s, mine) !== MAIN_PLACE, closed };
  });
  clog.info('keys sent to join another group', { callId, generation: b.generation, moving: r.moving });
  await afterClosing({ organizer: o, callId }, r.closed, () => nudge(o, r.room, callId, { call: r.closed, log: true }));
}

/**
 * Back in as they were, after being taken out while their connection was away: the same connection and person (seat,
 * hand and all), with a fresh key package for the host's browser to add them by. Nobody removed, turned away,
 * or whose place went to another tab or device comes back this way; they join again.
 */
export async function mlsBack(v: Viewer, callId: string, b: z.infer<typeof CallBackBodySchema>): Promise<void> {
  const o = v.organizer;
  const { room, closed } = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity && j.person === v.pass.person);
    if (row.state !== 'live' || !mine || !mayComeBack(mine) || b.generation !== row.mls_generation) {
      throw new ConflictError('There’s no way back in from here. Join the call again.', { context: { callId, generation: b.generation, current: row.mls_generation, status: mine?.status ?? 'none' }, level: 'info' });
    }
    // The host's browser takes them out of their group first, so its keys move on without the connection that went.
    if (groupOf(s, mine) !== null) throw new ConflictError('Still moving the call’s keys on. Try again in a moment.', { context: { callId, reason: 'in-group' }, level: 'info' });
    // In again from now, in the same part of the call: the log asks this browser for keys next, as for anyone on their way
    // into a group, and the host's browser adds it. A fresh ARRIVAL_MS to reach the room, if its connection is still coming back.
    // Its time in before the drop is kept as an earlier stretch, so the time it was away stays time away (a guest reads
    // nothing said then, and catching up "while you were away" finds it).
    const now = Date.now();
    const next = withPerson(s, mine.identity, (j) => ({ ...j, status: 'in', admit: 'auto', earlier: [...j.earlier, { since: j.since, left: j.left ?? now }], since: now, left: null }));
    return { room: row.room_name, closed: (await saveSettled(o, c, callId, state, next)).closed };
  });
  clog.info('back in the call after its connection dropped', { callId, generation: b.generation });
  await afterClosing({ organizer: o, callId }, closed, () => nudge(o, room, callId, { call: true, log: true }));
}

/** A LiveKit token, only for someone the host's browser let in. It names nobody. */
export async function roomToken(v: Viewer, callId: string): Promise<{ token: string }> {
  requireIn(v, 'room');
  const { row } = await load(v.organizer, v.organizer.pool, callId);
  if (row.state !== 'live' || !row.room_name) throw new ConflictError('This call has ended.', { context: { callId } });
  return { token: await v.organizer.livekit.token({ roomName: row.room_name, identity: v.pass.identity }) };
}

/**
 * Live transcript lines in another language, for the person asking: only lines they may read (said in the part of the
 * call they're in, while they were there). Each line is translated once per language and kept sealed with the live
 * transcript, which goes when the recording stops (and a room's, when it closes).
 */
export async function translate(v: Viewer, callId: string, language: CaptionLanguage, lineIds: string[]): Promise<CaptionTranslation[]> {
  requireIn(v, 'translate');
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const ctx = { callId, language, asked: lineIds.length };
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const into = capture.mayCapture(capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE), 'captions', ctx);
  const asked = new Set(lineIds);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const wanted = (await transcripts.lines(o, o.pool, into.noteId, mayRead(v, s, mine, row.started_at, invitedIn(meeting)))).filter((l) => asked.has(l.id));
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

/** When a line was said, in seconds since the call started (to a tenth), as everyone's time in the call is counted. */
const saidIn = (startedAt: Date) => (l: transcripts.Line): number | undefined => (l.when === undefined ? undefined : Math.max(0, Math.round((l.when - startedAt.getTime()) / 100) / 10));
/** The people on the invite, by address: they get the notes, whether they were invited when the call was scheduled or added once let in. */
const invitedIn = (m: Loaded<MeetingManifest>) => new Set(m.manifest.guests.map((e) => e.toLowerCase()));

/* ---------- catching up: for the person asking alone, from what they may read; nothing is kept ---------- */

/**
 * A guest's own time in the call, which is all of it they may read: someone not on the invite doesn't get the notes,
 * so reads only what they were there for, as with chat from before they came. Null for the organizer and for everyone
 * on the invite now, whether they were invited when the call was scheduled or added once let in from the link.
 */
function onlyHere(v: Viewer, s: Stored, mine: Joined | undefined, startedAt: Date, invited: Set<string>): catchup.Open[] | null {
  if (v.pass.role === 'host') return null;
  const email = mine?.email?.toLowerCase();
  if (email && invited.has(email)) return null;
  return mine ? catchup.presence(s.people, mine, startedAt.getTime()) : [];
}
/**
 * Which lines of the live transcript someone may read: the call's one rule (places.ts readableBy: what was said in
 * the part of the call they're in now, while they were there), and on top of it, for a guest with the link, only what
 * was said while they were in the call.
 */
function mayRead(v: Viewer, s: Stored, mine: Joined | undefined, startedAt: Date, invited: Set<string>): (l: transcripts.Line) => boolean {
  const rule = readableBy(s, mine);
  const here = onlyHere(v, s, mine, startedAt, invited);
  const said = saidIn(startedAt);
  return (l) => rule(l) && catchup.readable(here, said(l));
}
/**
 * What wasn't captured where someone is: the call's gaps, or in a breakout room, the room's since it opened (the
 * call's notes off or paused, the room's own pauses, and the host's browser out of the call).
 */
function gapsFor(row: Row, s: Stored, place: string, segs: Parameters<typeof capture.gapsOf>[3]): CaptureGap[] {
  const open = s.breakouts.open;
  const room = place === MAIN_PLACE ? undefined : open?.rooms.find((r) => r.id === place);
  const all = !open || !room ? capture.gapsOf(s.notes.history, s.notes.offline, row.started_at, segs)
    : capture.roomGaps(s.notes.history, s.notes.offline, room.pauses, open.from, row.started_at, secondsIn(row.started_at));
  // The host's browser out of the call is told once, as `missed` (catchup.missedOf, from when each connection hosted),
  // never also as a gap.
  return all.filter((g) => g.kind !== 'offline');
}
/** What a viewer can catch up on: their time in the call, their latest time away, what they may read, and the gaps. */
function windowFor(v: Viewer, row: Row, s: Stored, mine: Joined | undefined, invited: Set<string>, gaps: CaptureGap[]): catchup.Window {
  // To a tenth, as lines and everyone's time in the call are counted.
  const now = Math.max(0, Math.round((Date.now() - row.started_at.getTime()) / 100) / 10);
  const time = mine ? catchup.presence(s.people, mine, row.started_at.getTime()) : [];
  return catchup.windowOf(now, row.started_at.getTime(), time, onlyHere(v, s, mine, row.started_at, invited) === null, gaps);
}
/**
 * Stretches with notes on (not off or paused) and nothing transcribed where someone is. In the main room: no hosting
 * browser, which sends what's said there, was in the call. The connection hosting now stopped sending when LiveKit said
 * it left, though it hosts until another does. In a breakout room: it had no scribe, since it opened (before that, there
 * was no room to miss).
 */
function missedIn(row: Row, s: Stored, w: catchup.Window, place: string): catchup.Open[] {
  if (place !== MAIN_PLACE) {
    const scribed = scribedIn(s, place).map((x) => ({ from: tenthsIn(row.started_at, x.from), to: x.until === null ? null : tenthsIn(row.started_at, x.until) }));
    return catchup.missedOf([{ from: 0, to: s.breakouts.open?.from ?? 0 }, ...scribed], w);
  }
  const left = row.host_left_at?.getTime();
  const people = left === undefined ? s.people
    : s.people.map((j) => (j.identity === s.host ? { ...j, hosting: j.hosting.map((h) => (h.to === null ? { ...h, to: left } : h)) } : j));
  return catchup.missedOf(catchup.hostingOf(people, row.started_at.getTime()), w);
}

/**
 * What the notes model reads of a part of the call so far: the lines `keep` takes, the window they're read through, what
 * can't be in them, and the brief it's told.
 */
async function soFarIn(o: Owner, row: Row, s: Stored, into: { noteId: string; recordingId: string }, meeting: Loaded<MeetingManifest>, place: string, keep: (l: transcripts.Line) => boolean, windowFrom: (gaps: CaptureGap[]) => catchup.Window) {
  const person = await me(o);
  const segs = await segments(o, into.recordingId);
  const window = windowFrom(gapsFor(row, s, place, segs));
  const said = saidIn(row.started_at);
  // Lines stay inside their segment once it's over, so what was said before a pause is read before it.
  const all = transcripts.placed(await transcripts.lines(o, o.pool, into.noteId, keep), segs, s.notes.status === 'on' ? s.notes.segment : undefined)
    .map((l) => ({ ...l, said: said(l) }));
  const brief = (ls: transcripts.HeardLine[], gaps: CaptureGap[]): drafting.Brief => ({
    title: meeting.manifest.title, kind: 'call', organizer: person, people: meeting.manifest.guests.map((e) => personOf(e)),
    seconds: window.now, lines: transcripts.spoken(ls, speakersIn(s, person), roomsIn(s)), gaps, live: true
  });
  return { all, window, missed: missedIn(row, s, window, place), person, brief };
}
/**
 * A live call and its transcript so far, for the person asking: what was said in the part of the call they're in now,
 * while they were there (and for a guest with the link, while they were in the call), with the stretches nothing was
 * captured in. Like everything that reaches the AI, it waits while notes, or their breakout room, are paused.
 */
async function sofar(v: Viewer, callId: string, what: 'catch-up' | 'ask') {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const place = mine ? placeOf(s, mine) : MAIN_PLACE;
  const into = capture.mayCapture(capturing(row, s, place), what, { callId, part: place !== MAIN_PLACE ? 'room' : 'main' });
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  return soFarIn(o, row, s, into, meeting, place, mayRead(v, s, mine, row.started_at, invited), (gaps) => windowFor(v, row, s, mine, invited, gaps));
}

/**
 * The viewer's grants checked again once an answer is written, which can take the model up to a minute: still in
 * this live call, and not removed. An answer that quotes the call isn't sent to someone who's no longer in it.
 */
async function stillIn(v: Viewer, callId: string, what: 'catch-up' | 'ask'): Promise<void> {
  const { row, state: s } = await load(v.organizer, v.organizer.pool, callId);
  const ctx = { callId, what, role: v.pass.role };
  if (s.removed.includes(v.pass.person)) throw new ForbiddenError('The host removed you from this call.', { context: ctx });
  if (row.state !== 'live') throw new ConflictError('The call ended while the answer was being written. Its notes have everything.', { context: ctx });
  const here = v.isOrganizer ? row.host_identity === v.pass.identity : s.people.some((j) => j.identity === v.pass.identity && j.status === 'in');
  if (!here) throw new ForbiddenError('You left the call while the answer was being written, so it isn’t shown.', { context: ctx });
}

/** Where a stretch of the call has got to, from the live transcript: for the person asking alone, from what they may read. */
export async function catchUp(v: Viewer, callId: string, range: CatchUpRange): Promise<CatchUp> {
  const { all, window, missed, brief } = await sofar(v, callId, 'catch-up');
  const { lines, read } = catchup.readOf(all, range, window, missed, { callId, what: 'catch-up' });
  const ctx = { callId, range: range.kind, lines: lines.length, gaps: read.gaps.length, missed: read.missed.length, whileHere: read.whileHere };
  // Nothing said, nothing sent: an empty stretch never reaches the notes model.
  if (!lines.length) { clog.info('caught up on a stretch with nothing said', ctx); return { summary: '', decided: [], proposed: [], open: [], next: [], read }; }
  const t0 = performance.now();
  const sorted = await drafting.catchUp(v.organizer.cfg, brief(lines, read.gaps), catchup.describe(range, read.whileHere));
  await stillIn(v, callId, 'catch-up');
  const cite = (xs: drafting.Cited[]) => xs.map(({ refs, ...x }) => ({ ...x, evidence: catchup.evidenceOf(refs, lines) }));
  const out: CatchUp = { summary: sorted.summary, decided: cite(sorted.decided), proposed: cite(sorted.proposed), open: cite(sorted.open), next: cite(sorted.next), read: catchup.withCut(read, sorted.cut, lines) };
  clog.info('caught up during a call', { ...ctx, items: out.decided.length + out.proposed.length + out.open.length + out.next.length, uncited: sorted.uncited, cut: sorted.cut?.count ?? 0, ms: Math.round(performance.now() - t0) });
  return out;
}

/** Answers a question from a stretch of the call's live transcript, for the person asking alone, with the moments it comes from. */
export async function askSoFar(v: Viewer, callId: string, question: string, range: CatchUpRange): Promise<CallAnswer> {
  const { all, window, missed, person, brief } = await sofar(v, callId, 'ask');
  const { lines, read } = catchup.readOf(all, range, window, missed, { callId, what: 'ask' });
  const ctx = { callId, range: range.kind, lines: lines.length, whileHere: read.whileHere };
  if (!lines.length) { clog.info('question about a stretch with nothing said', ctx); return { text: '', evidence: [], read }; }
  const asker: Person = v.isOrganizer ? person : { id: v.pass.identity, name: v.pass.name, email: '' };
  const t0 = performance.now();
  const a = await drafting.answerSoFar(v.organizer.cfg, brief(lines, read.gaps), asker, question, catchup.describe(range, read.whileHere));
  await stillIn(v, callId, 'ask');
  clog.info('question answered during a call', { ...ctx, cites: a.refs.length, cut: a.cut?.count ?? 0, ms: Math.round(performance.now() - t0) });
  return { text: a.text, evidence: catchup.evidenceOf(a.refs, lines), read: catchup.withCut(read, a.cut, lines) };
}

/** The series a call is in, by its link: what carries over into it is read for whoever asks (modules/series.ts). */
export const seriesOf = async (d: Deps, code: string): Promise<string | undefined> => (await meetingFor(d, code)).meeting.manifest.seriesId;

/**
 * Answers a question across the earlier calls in this call's series, from the notes `asker`'s own account has now: being
 * in this call adds nothing to them. It reads nothing of this call, so it needs no notes here, but while notes are
 * paused nothing goes to the AI, questions included.
 */
export async function askEarlier(v: Viewer, callId: string, asker: Owner, question: string, timeZone: string): Promise<SeriesAnswerPart[]> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  capture.mayReachAi(capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE), 'ask', { callId, what: 'ask-earlier' });
  const { seriesId } = (await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting')).manifest;
  if (!seriesId) throw notFound('That series', { callId });
  return series.ask(asker, seriesId, question, timeZone);
}


/* ---------- the call's shared live notes: kept in modules/liveNotes.ts; who reads what, and when they're refreshed, is here ---------- */

/** Nothing to read: until notes are written, for someone waiting to be let in, and once the call has ended and they're in the note. */
const NO_NOTES: LiveNotes = { notes: null, added: [], writing: false, error: null };
/** As much of a whole call's follow-ups as its live notes keep from one refresh, as many as the notes at the end may have. */
const FOLLOW_UPS_READ = 20;

/** Who's reading the live notes of the part of the call someone is in: as lines list their readers, and for a guest, their time in the call. */
const readerFor = (v: Viewer, s: Stored, mine: Joined, startedAt: Date, invited: Set<string>): liveNotes.Reader => ({ me: readerOf(mine), here: onlyHere(v, s, mine, startedAt, invited) });

/** The live notes of the part of the call someone is in now: everyone's, or notes of their own from what they may read. */
async function notesFor(v: Viewer, db: Db, row: Row, s: Stored, mine: Joined | undefined, place: string, invited: Set<string>): Promise<LiveNotes> {
  if (!mine || row.state !== 'live' || !s.notes.noteId) return NO_NOTES;
  return liveNotes.shownTo(await liveNotes.find(v.organizer, db, row.call_id, place, readerFor(v, s, mine, row.started_at, invited)), capturing(row, s, place).status === 'on');
}

/**
 * What a part of the call's notes read: everything said there. Except that what the main room said while rooms were open
 * is for the people who stayed: it's read while those rooms are open, and left out once they've closed, so that everyone
 * back in the main room can read one set of notes, and tick them. It stays in the transcript of whoever may read it, in
 * their catching up, and the note.
 */
function sharedIn(row: Pick<Row, 'started_at'>, s: Stored, place: string): (l: transcripts.Line) => boolean {
  const open = s.breakouts.open;
  const said = saidIn(row.started_at);
  return (l) => (l.room ?? MAIN_PLACE) === place && (place !== MAIN_PLACE || l.readers === undefined || (open !== null && (said(l) ?? 0) >= open.from));
}

/** Connections that looked and found nothing that could be written for them, until when they don't need to look again. They have no row to say so. */
const resting = new Map<string, number>();
const REST_MS = 30_000;

/**
 * Someone in the call is looking at the live notes. What the notes read of this part of the call is split by what this
 * person may read of it: all of it is everyone's view, and anything less is a view of its own, named by what they can't
 * read, which the notes model never sees for them. If that view has something new, it's been at least half a minute and
 * nobody else is at it, it's refreshed now, for everyone in it. Nobody's credits pay for it, as for catching up. True when
 * this look refreshed them; any other look at the same time answers false at once. Nothing is held while the model reads.
 */
export async function watchNotes(v: Viewer, callId: string): Promise<boolean> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'live-notes' } });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  if (!mine) return false;
  const place = placeOf(s, mine);
  const { status, noteId, recordingId } = capturing(row, s, place);
  if (status !== 'on' || !noteId || !recordingId) return false;
  const restKey = `${callId}|${v.pass.identity}`;
  if ((resting.get(restKey) ?? 0) > Date.now()) return false;
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  const reader = readerFor(v, s, mine, row.started_at, invited);
  const found = await liveNotes.find(o, o.pool, callId, place, reader);
  // Their notes are up to date, or it isn't time: said without reading the transcript, which is nearly every look.
  const theirs = found.own ?? found.view;
  if (theirs !== null && !(await liveNotes.due(o, o.pool, callId, place, theirs, noteId))) return false;
  clog.debug('reading the transcript for the live notes', { callId, part: place !== MAIN_PLACE ? 'room' : 'main' });
  const clips = await liveNotes.clipsOf(o, o.pool, noteId);
  const part = await soFarIn(o, row, s, { noteId, recordingId }, meeting, place, sharedIn(row, s, place), (gaps) => catchup.windowOf(tenthsIn(row.started_at), row.started_at.getTime(), [], true, gaps));
  const may = mayRead(v, s, mine, row.started_at, invited);
  const barred = part.all.flatMap((l) => (!may(l) && l.said !== undefined ? [{ ...l, said: l.said }] : []));
  const view = barred.length ? liveNotes.digestOf(barred) : liveNotes.ALL;
  const ctx = { callId, part: place !== MAIN_PLACE ? 'room' : 'main', view: barred.length ? 'narrowed' : 'all' };
  const whole: CatchUpRange = { kind: 'all' };
  const { lines, read } = catchup.readOf(barred.length ? part.all.filter(may) : part.all, whole, part.window, part.missed, ctx);
  const heard = liveNotes.digestOf(lines);
  // Nothing they may read, or a view of their own that would read what they're reading already: a run would write it again.
  if (!lines.length || (view !== found.view && heard === found.stored?.notes?.heard)) {
    if (resting.size > 10_000) resting.clear();
    resting.set(restKey, Date.now() + REST_MS);
    return false;
  }
  // Under the call's row, shared: a pause is either here to see, and nothing is claimed, or comes after what got through.
  const claim = await tx(o.pool, async (c) => {
    const now = await load(o, c, callId, 'share');
    const at = settle(now.state, now.row);
    if (!placesOf(at).includes(place)) return null;
    capture.mayCapture(capturing(now.row, at, place), 'live-notes', ctx);
    return liveNotes.claim(o, c, callId, place, view, clips, lines, barred);
  });
  if (!claim) return false;
  if (heard === claim.heard) {
    await liveNotes.release(o, callId, place, view, claim);
    clog.debug('nothing new for the live notes', { ...ctx, lines: lines.length });
    return false;
  }
  try {
    // Everyone reading them sees they're being written.
    await nudge(o, row.room_name, callId, { call: true, log: false });
    const t0 = performance.now();
    const known = liveNotes.knownTo(claim, lines);
    const sorted = await drafting.catchUp(o.cfg, part.brief(lines, read.gaps), catchup.describe(whole, barred.length > 0), { followUps: FOLLOW_UPS_READ, known });
    const done = {
      lines: lines.length, gaps: read.gaps.length, missed: read.missed.length, uncited: sorted.uncited, known: known.length, same: sorted.next.filter((f) => f.same).length, strays: sorted.strays,
      cut: sorted.cut?.count ?? 0, ms: Math.round(performance.now() - t0)
    };
    const run = liveNotes.runOf(sorted, lines, barred, { ...catchup.withCut(read, sorted.cut, lines), whileHere: barred.length > 0 });
    if (!await liveNotes.keep(o, callId, place, view, claim, run, reader)) {
      clog.info('live notes written too late to keep', { ...ctx, ...done });
      return false;
    }
    clog.info('live notes written', { ...ctx, ...done, points: sorted.decided.length + sorted.proposed.length + sorted.open.length + sorted.next.length });
    await nudge(o, row.room_name, callId, { call: true, log: false });
    return true;
  } catch (e) {
    clog.warn('live notes not refreshed', { ...ctx, err: e });
    if (await liveNotes.failed(o, callId, place, view, claim)) await nudge(o, row.room_name, callId, { call: true, log: false });
    return false;
  }
}

/* ---------- ideas from the call, for the board open in the part of the call they were said in ---------- */

/** Whoever said an idea, when the call doesn't know them any more. */
const SOMEONE: Person = { id: 'someone', name: 'Someone', email: '', portrait: portraitFor('someone') };
/** Ideas in a part of the call are looked for at most this often, however many browsers have its board open. */
const IDEAS_EVERY_MS = 60_000;
/** How long a look holds its claim: longer than the notes model takes to be verified and answer. If its worker dies, the next look takes over after this. */
const IDEAS_LEASE_MS = 150_000;
/** What a look at ideas reads: what was said lately. */
const IDEAS_READ: CatchUpRange = { kind: 'recent', minutes: 5 };

/** A line as an idea keeps it, for `mayRead`: where it was said, when, and who may read it. */
const lineOf = (place: string, l: { when?: number | undefined; readers?: string[] | undefined }): transcripts.Line => ({
  id: '', at: 0, end: 0, text: '', ...(place === MAIN_PLACE ? {} : { room: place }), ...(l.when === undefined ? {} : { when: l.when }), ...(l.readers ? { readers: l.readers } : {})
});

/**
 * The board open in the part of the call someone's in, as they may know it, with that part's ideas from the call while notes
 * are on there: only for someone who can add to the board, and only the ones they may read every line of what they were
 * picked from, so nobody is told anything of what they may not read. A part's ideas are for its own board: in a room on the one
 * board every room shares there are none, since not everyone on that board may read what's said in the room.
 */
async function boardFor(v: Viewer, s: Stored, mine: Joined | undefined, place: string, row: Row, invited: Set<string>): Promise<CallBoard> {
  const shown = await boards.shownTo(v, s, place);
  const kept = s.board.ideas[place];
  if (!kept?.list.length || !mine || row.state !== 'live' || shown.open?.role !== 'edit' || capturing(row, s, place).status !== 'on') return shown;
  const may = mayRead(v, s, mine, row.started_at, invited);
  const organizer = await me(v.organizer);
  const speaker = speakersIn(s, organizer, v);
  const ideas = kept.list.filter((i) => i.seen.every((l) => may(lineOf(place, l)))).map((i): CallBoardIdea => ({
    id: i.id, text: i.text,
    said: { person: (i.speaker ? speaker(i.speaker)?.person : undefined) ?? SOMEONE, at: i.when === undefined ? null : new Date(i.when).toISOString(), words: i.words },
    frame: i.frame
  }));
  return { ...shown, ideas };
}

/** Connections that looked for ideas and found it wasn't for them to look, until when they needn't look again. */
const restingIdeas = new Map<string, number>();

/**
 * Someone in the call has its board open, while notes are on in the part of the call they're in. If it's been a minute since
 * that part's ideas were last looked for, nobody else is at it, and something new was said, what was said lately is read now,
 * for everyone there, with the board's frames, and the notes model offers ideas worth a sticky: each from one line, which
 * says who said it and when, and in the frame it fits. Ideas come only from what everyone in that part may read: someone who
 * may read less doesn't look. Nobody's credits pay for it, as for the live notes. True when this look found some; any other
 * look at the same time answers false at once. Nothing is held while the model reads. A part looks only at its own board:
 * a room on the board every room shares has none of its own, so nobody there looks. Claiming the look and letting it go both
 * save the call (`saveSettled`), so rooms whose time ran out close with either: their boards are everyone invited's once the
 * look is done, and they land with the next look or whatever's done next in the call.
 */
export async function watchIdeas(v: Viewer, callId: string): Promise<boolean> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') return false;
  // Rooms' boards waiting to come back land now, as after anything done in the call: a look comes every 15 seconds.
  const waiting = state.board.landing;
  if (waiting && waiting.until <= Date.now()) void landRooms({ organizer: o, callId });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  if (!mine) return false;
  const place = placeOf(s, mine);
  const open = s.board.open[place];
  const kept = s.board.ideas[place];
  const now = Date.now();
  if (!open || (kept && (kept.at + IDEAS_EVERY_MS > now || (kept.running ?? 0) > now))) return false;
  const { status, noteId, recordingId } = capturing(row, s, place);
  if (status !== 'on' || !noteId || !recordingId) return false;
  const restKey = `${callId}|${v.pass.identity}`;
  if ((restingIdeas.get(restKey) ?? 0) > now) return false;
  const rest = () => {
    if (restingIdeas.size > 10_000) restingIdeas.clear();
    restingIdeas.set(restKey, Date.now() + IDEAS_EVERY_MS);
    return false;
  };
  // Only someone who can add to the board looks for what to add to it.
  if ((await boards.shownTo(v, s, place)).open?.role !== 'edit') return rest();
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  const ctx = { callId, part: place !== MAIN_PLACE ? 'room' : 'main' };
  const part = await soFarIn(o, row, s, { noteId, recordingId }, meeting, place, sharedIn(row, s, place), (gaps) => catchup.windowOf(tenthsIn(row.started_at), row.started_at.getTime(), [], true, gaps));
  const may = mayRead(v, s, mine, row.started_at, invited);
  if (part.all.some((l) => !may(l))) return rest();
  const { lines, read } = catchup.readOf(part.all, IDEAS_READ, part.window, part.missed, ctx);
  const heard = liveNotes.digestOf(lines);
  if (!lines.length || heard === kept?.heard) return false;
  // Under the call's row: a pause is either here to see, and nothing is claimed, or comes after what got through.
  const claimed = await tx(o.pool, async (c) => {
    const at = await load(o, c, callId, true);
    const held = settle(at.state, at.row);
    const was = held.board.ideas[place];
    const stamp = Date.now();
    if (!placesOf(held).includes(place) || !held.board.open[place] || (was && (was.at + IDEAS_EVERY_MS > stamp || (was.running ?? 0) > stamp))) return undefined;
    capture.mayCapture(capturing(at.row, held, place), 'ideas', ctx);
    const claim = { at: stamp, heard: was?.heard ?? '', running: stamp + IDEAS_LEASE_MS, list: was?.list ?? [] };
    return saveSettled(o, c, callId, at.state, { ...held, board: { ...held.board, ideas: { ...held.board.ideas, [place]: claim } } });
  });
  if (!claimed) return false;
  /** Whether rooms closed with either save, for them to come back once the look's done. */
  let closed = claimed.closed;
  /** Lets the claim go, keeping what's offered, and anything new: under the row again, so an idea added meanwhile stays added. */
  const settleIdeas = (found: StoredIdea[]) => tx(o.pool, async (c) => {
    const at = await load(o, c, callId, true);
    const held = settle(at.state, at.row);
    const was = held.board.ideas[place];
    // The board closed or changed meanwhile, or its room did: what was found was for it.
    if (!was || held.board.open[place]?.documentId !== open.documentId) return false;
    const list = placesOf(held).includes(place) ? [...was.list, ...found].slice(-MAX_CALL_IDEAS) : was.list;
    const saved = await saveSettled(o, c, callId, at.state, { ...held, board: { ...held.board, ideas: { ...held.board.ideas, [place]: { ...was, heard, running: null, list } } } });
    closed ||= saved.closed;
    return found.length > 0 && saved.s.board.ideas[place] !== undefined;
  });
  try {
    const t0 = performance.now();
    const frames = await boards.framesOf(o, open);
    const brief = part.brief(lines, read.gaps);
    const found = await drafting.ideasFrom(o.cfg, brief, frames, kept?.list.map((i) => i.text) ?? []);
    const seen = lines.map((l) => ({ ...(l.when === undefined ? {} : { when: l.when }), ...(l.readers ? { readers: l.readers } : {}) }));
    const ideas = found.flatMap((f): StoredIdea[] => {
      const line = lines[f.line];
      return line ? [{ id: id128(), text: f.text, words: f.said, ...(line.speaker ? { speaker: line.speaker } : {}), ...(line.when === undefined ? {} : { when: line.when }), frame: f.frame, seen }] : [];
    });
    const offered = await settleIdeas(ideas);
    clog.info('ideas from the call looked for', { ...ctx, lines: lines.length, frames: frames.length, ideas: ideas.length, ms: Math.round(performance.now() - t0) });
    // Rooms that closed meanwhile have their boards kept for everyone invited before anyone's told.
    if (closed) await syncRoomBoards({ organizer: o, callId });
    if (offered || closed) await nudge(o, row.room_name, callId, { call: true, log: false });
    return offered;
  } catch (e) {
    clog.warn('ideas from the call not looked for', { ...ctx, err: e });
    await settleIdeas([]).catch((err: unknown) => clog.warn('a look for ideas not let go', { ...ctx, err }));
    if (closed) {
      await syncRoomBoards({ organizer: o, callId });
      await nudge(o, row.room_name, callId, { call: true, log: false });
    }
    return false;
  }
}

/**
 * Who's changing the follow-ups of the part of the call they're in, for everyone there, in the caller's transaction, which
 * holds the call's row, so the call can't end halfway through. It's for anyone in the call who gets the notes, as
 * `mayChangeAction` has it for a follow-up nobody has taken on, which nothing is until the notes are written. A guest with
 * the link doesn't get them.
 */
async function changing(v: Viewer, c: Db, row: Row, s: Stored, what: CallAction['type']): Promise<{ mine: Joined; by: Changer; place: string; reader: liveNotes.Reader }> {
  const o = v.organizer;
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  if (!mine || onlyHere(v, s, mine, row.started_at, invited) !== null) throw new ForbiddenError('The notes go to the people invited, so only they can change follow-ups.', { context: { callId: row.call_id, role: v.pass.role, what } });
  const organizer = mine.role === 'host' ? await me(o) : undefined;
  const by: Changer = { id: organizer ? o.ownerId : null, name: organizer?.name ?? mine.name, email: organizer?.email ?? mine.email ?? '', as: organizer ? 'organizer' : 'invited' };
  return { mine, by, place: placeOf(s, mine), reader: readerFor(v, s, mine, row.started_at, invited) };
}

/** A follow-up of the live notes, ticked or not, for everyone in that part of the call. */
async function tickFollowUp(v: Viewer, c: Db, row: Row, s: Stored, a: Extract<CallAction, { type: 'follow-up' }>): Promise<void> {
  const { by, place, reader } = await changing(v, c, row, s, a.type);
  await liveNotes.tick(v.organizer, c, row.call_id, place, a.id, a.done, by, reader);
}

/** A follow-up nobody said, for whoever adds it. It goes into the note, so there has to be one. */
async function addFollowUp(v: Viewer, c: Db, row: Row, s: Stored, a: Extract<CallAction, { type: 'follow-up-add' }>, said: number): Promise<void> {
  const o = v.organizer;
  const { mine, by, place, reader } = await changing(v, c, row, s, a.type);
  if (!s.notes.noteId) throw new ConflictError('Notes haven’t been on in this call, so there’s nowhere for this to go.', { context: { callId: row.call_id, what: a.type } });
  const person = personFor(mine, mine.identity, mine.name, await me(o));
  await liveNotes.add(o, c, row.call_id, place, { text: a.text, owner: { name: person.name, person }, by, said }, reader);
}

/** What this person can catch up on, for choosing what to read. */
export async function catchUpWindow(v: Viewer, callId: string): Promise<CatchUpWindow> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'window' } });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const segs = s.notes.recordingId ? await segments(o, s.notes.recordingId) : [];
  return catchup.shown(windowFor(v, row, s, mine, invitedIn(meeting), gapsFor(row, s, mine ? placeOf(s, mine) : MAIN_PLACE, segs)));
}

/** How many lines either side of a moment come with it. */
const AROUND = 6;
/**
 * A line of the live transcript from a catch-up or an answer, and a few either side, for the person opening it: only
 * from this call's live transcript, and only what they may read now. Anything else isn't found, whether or not it
 * exists, so nothing can be learned by asking.
 */
export async function moment(v: Viewer, callId: string, lineId: string): Promise<CallMoment> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'moment' } });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const said = saidIn(row.started_at);
  const lines = s.notes.noteId ? (await transcripts.lines(o, o.pool, s.notes.noteId, mayRead(v, s, mine, row.started_at, invitedIn(meeting))))
    .flatMap((l) => { const at = said(l); return at === undefined ? [] : [{ ...l, said: at }]; }) : [];
  const i = lines.findIndex((l) => l.id === lineId);
  if (i < 0) throw notFound('That moment of the call', { callId, what: 'moment' });
  const around = lines.slice(Math.max(0, i - AROUND), i + AROUND + 1);
  const saidAt = new Map(around.map((l) => [l.id, l.said]));
  const organizer = await me(o);
  clog.debug('transcript moment opened', { callId, lines: around.length });
  return { lineId, lines: transcripts.spoken(around, speakersIn(s, organizer, v), roomsIn(s)).map((l) => ({ ...l, said: saidAt.get(l.id) ?? 0 })) };
}

/* ---------- your own notes, from inside the call: for your account alone, and nothing of them goes into the call ---------- */

/**
 * Someone's own notes on this call: their account's (the session with the request, which has to be whoever this
 * connection joined as), on the call's note, and what they may read here now, by the same rule as everything else in a
 * call. Someone with only the link has no account to keep anything under, and doesn't get the note it would go with.
 */
export async function personalIn(v: Viewer, callId: string, session: () => Promise<Owner | undefined>): Promise<personal.Place> {
  requireIn(v, 'personal');
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, role: v.pass.role };
  const ended = () => new ConflictError('This call has ended. Your own notes are with its notes.', { context: ctx });
  if (row.state !== 'live') throw ended();
  if (v.role === 'guest') throw new ForbiddenError('You joined with the link, so there’s no account to keep your own notes under.', { context: ctx });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const author = await session();
  if (!author) throw new AuthError('Sign in to Alcove first.', { context: ctx });
  const same = v.pass.role === 'host' ? author.ownerId === o.ownerId : !!mine?.email && (await profile(author)).email.toLowerCase() === mine.email.toLowerCase();
  if (!same) throw new ForbiddenError('This browser is signed in to another account.', { context: ctx });
  const noteId = s.notes.noteId;
  if (!noteId) throw new ConflictError('Your own notes go with the call’s, and notes haven’t been on in this call.', { context: ctx });
  const place = mine ? placeOf(s, mine) : MAIN_PLACE;
  const here = place === MAIN_PLACE ? null : place;
  return {
    author, noteOwnerId: o.ownerId, noteId,
    reader: async () => {
      const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
      const heard = await transcripts.lines(o, o.pool, noteId, mayRead(v, s, mine, row.started_at, invitedIn(meeting)));
      const said = saidIn(row.started_at);
      const lines = transcripts.spoken(heard, speakersIn(s, await me(o), v), roomsIn(s)).map((l, i): personal.LiveLine => {
        const h = heard[i];
        return { ...l, when: h?.when, said: h ? said(h) : undefined };
      });
      const t = tenthsIn(row.started_at);
      // Marked while nothing is captured here: there'll be nothing there to open, and the recording doesn't move on.
      const at = capturing(row, s, place).status === 'on' ? capture.recorded(s.notes.history, s.notes.offline, t, t) : null;
      return personal.callReader(lines, here, { kind: 'moment', at, when: Date.now(), room: here });
    },
    // Ending the call takes its row: anything written after it isn't in time for who gets the note to be settled.
    holdNote: async (c) => {
      if ((await load(o, c, callId, 'share')).row.state !== 'live') throw ended();
      if (!(await exec(c, `SELECT 1 FROM items WHERE owner_id = $1 AND item_id = $2 AND kind = 'note' AND deleted_at IS NULL FOR KEY SHARE`, [o.ownerId, noteId]))) throw notFound('Those notes', { noteId });
    }
  };
}

/**
 * Ends the call for everyone: the recording stops, the transcript moves into the note, the note goes to
 * everyone invited, and the LiveKit room goes. A call set not to keep its recording deletes it here, once the note
 * has what it worked out from it. The organizer leaving, a webhook and upkeep all end it here.
 */
async function endCall(o: Owner, callId: string, unless?: (r: Row) => boolean): Promise<CallEndResult | null> {
  let room: string | null = null;
  let audio: string[] = [];
  let worked: WorkedDocument[] = [];
  let home: CallSpace['home'] = null;
  /** What the call kept of its boards, and its home, whose tree has every room's board. */
  let kept: Pick<Stored, 'board' | 'workspace'> = { board: NO_BOARDS, workspace: NO_SPACE };
  let everyone: boards.Here[] = [];
  /** Who has the rooms' boards by address once the call's over: the organizer, and everyone on the invite as it ended. */
  let invitedAtEnd: string[] = [];
  const end = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    // Upkeep decided from an earlier read; the organizer may have come back since.
    if (unless?.(row)) return null;
    room = row.room_name;
    const duration = Math.max(1, secondsIn(row.started_at));
    // Rooms still open come back when the call ends, and go into the notes with the rest: each room's own section.
    const open = state.breakouts.open;
    const closed = open ? closeRooms(state, Math.min(open.until, duration), row.started_at.getTime()) : state;
    if (row.state === 'live') {
      await exec(c, `UPDATE calls SET state = 'ended', ended_at = now(), version = version + 1 WHERE owner_id = $1 AND call_id = $2`, [o.ownerId, callId]);
    }
    const s = row.state === 'live' ? await roomsChanged(o, c, callId, state, relocate(state, closed, Date.now(), row.mls_seq)) : closed;
    if (row.state === 'live') {
      // Whatever was open anywhere as it ended is noted too, rooms' boards included, as every save notes it.
      worked = withOpenBoards(s.workspace, state.board.open).worked;
      home = s.workspace.home;
      kept = { board: s.board, workspace: s.workspace };
      everyone = knownIn(o, callId, s);
      // Who has the rooms' boards by address, whatever the call says of them: one it lost track of is found in its home's tree.
      const m = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
      invitedAtEnd = [(await profile(o, c)).email, ...boards.onInvite(s, m.manifest.guests, hereIn(o, callId, s))];
      // What the call kept of its workspace goes with it: what was worked on goes into its note, if it has one, and nowhere else.
      await save(o, c, callId, { ...s, workspace: NO_SPACE, board: NO_BOARDS });
      // The MLS log only matters while the call runs, and nobody is rung into a call that's over.
      await exec(c, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
      await rings.clear(o, c, row.meeting_item_id);
      // Who's invited lasts as long as the call does. Its note has its own list.
      await dropInvites(o, c, [row.meeting_item_id]);
      if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'stopped');
      // The live notes end with the call: what was ticked and what people added go into the note, and the notes at the end take over.
      const { ticked, added } = await liveNotes.finish(o, c, callId);
      if (s.notes.noteId) {
        // Ending while the host's browser is out of the call (it never came back): nothing was captured since it left.
        const gone = row.host_left_at && s.notes.status === 'on' ? tenthsIn(row.started_at, row.host_left_at.getTime()) : null;
        const offline = gone !== null && gone < duration ? [...s.notes.offline, { from: gone, to: duration, segment: s.notes.segment }] : s.notes.offline;
        const recorded = (at: number) => capture.recorded(s.notes.history, offline, at, duration);
        const held = s.breakouts.held.map((h) => ({ rooms: h.rooms.map((r) => ({ id: r.id, name: r.name, emails: r.emails })), from: recorded(h.from), to: recorded(h.to) }));
        const segs = s.notes.recordingId ? await segments(o, s.notes.recordingId, c) : [];
        // The stretches nothing was captured in go into the note, so it says so where they fall.
        const gaps = capture.gapsOf(s.notes.history, offline, row.started_at, segs, duration);
        // And what was on shared screens, each frame where it was shown and for how long, its presenter named as the call names speakers.
        const organizer = await me(o, c);
        const speakerOf = speakersIn(s, organizer);
        const shown = screens.moments(await screens.framesOf(o, c, s.notes.noteId), {
          history: s.notes.history, offline, screens: s.notes.screens.history, ended: s.notes.screens.ended, gaps, segments: segs, duration, presenterOf: speakerOf
        });
        // Each breakout room's section: everyone who was in it (the organizer if it came in), when, and its own gaps.
        const peopleOf = (seen: string[]): Speaker[] => seen.flatMap((key) => {
          const j = key === 'organizer' ? undefined : s.people.findLast((x) => x.person === key);
          const p = key === 'organizer' ? organizer : j ? personFor(j, j.identity, j.name, organizer) : undefined;
          return p ? [{ name: p.name, person: p }] : [];
        });
        const rooms: HeldRoom[] = s.breakouts.held.flatMap((h) => h.rooms.map((r) => ({
          id: r.id, name: r.name, people: peopleOf(r.seen), from: recorded(h.from), to: recorded(h.to),
          gaps: capture.roomGaps(s.notes.history, offline, r.pauses, h.from, row.started_at, h.to, h.to)
        })));
        audio = await finishRecording(o, c, s.notes.noteId, duration, held, speakerOf, gaps, shown, rooms, ticked, worked, added.map((a) => ({ room: a.room, action: liveNotes.toNote(a, recorded(a.said)) })));
      }
      await updateManifest(o, c, row.meeting_item_id, (m) => ({ ...m, status: 'ended', duration, ...(s.notes.noteId ? { noteId: s.notes.noteId } : {}) }));
    }
    clog.info(row.state === 'live' ? 'call ended' : 'left an ended call', { callId, meetingId: row.meeting_item_id, duration, noteId: s.notes.noteId });
    return { meetingId: row.meeting_item_id, pendingNoteId: s.notes.noteId, duration, startedAt: row.started_at, ended: row.state === 'live' };
  });
  if (!end) return null;
  await queueDelete(o, audio);
  // Nor do moves to other devices. Deleted once the call has ended, so a move coming in at that moment never waits on it.
  await exec(o.pool, 'DELETE FROM call_moves WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
  await boards.keepForInvited(o, callId, end.meetingId, kept.board, everyone);
  // Every room's board is everyone invited's now, before its seats go, and what was open in rooms as the call ended lands on
  // the main board, if there is one: there's no main room to come back to.
  await keepRoomBoards(o, callId, kept, invitedAtEnd);
  // Nor does anything shared with people's seats in it (maintenance sweeps up, should this be cut short).
  await endSeats(o, [callId]);
  if (end.pendingNoteId) writer.kick(o, o.ownerId);
  // Deleting the room disconnects everyone in it, which is how their browsers learn the call ended: an ended call is the organizer's alone to read.
  if (room) await o.livekit.deleteRoom(room).catch((e: unknown) => clog.warn('room not deleted', { callId, err: e }));
  // What's kept of the workspace is the last thing and nobody waits for it: it can take a worker as long as a worker has for
  // each document, and nothing about the call's end depends on it. It says itself when something didn't work.
  if (end.ended) void space.afterCall(o, { callId, meetingId: end.meetingId, worked, noteId: end.pendingNoteId, home, startedAt: end.startedAt });
  return { meetingId: end.meetingId, pendingNoteId: end.pendingNoteId, duration: end.duration };
}

/**
 * The call is over: each room's board it hadn't kept yet is kept now, for everyone invited, every one it can find
 * (`roomBoardsFound`), and rooms open as it ended land, on the board open in the main room while it's still the call's to write
 * on. Nothing is made for them now.
 */
async function keepRoomBoards(o: Owner, callId: string, s: Pick<Stored, 'board' | 'workspace'>, invited: string[]): Promise<void> {
  const found = await roomBoardsFound(o, callId, s).catch((err: unknown) => { clog.warn('rooms’ boards not found as the call ended', { callId, err }); return boards.roomBoardsOf(s.board); });
  for (const b of found.filter((r) => !r.kept)) {
    await boards.roomInStep(o, callId, b, () => Promise.resolve({ open: false, seats: [], invited })).catch((err: unknown) => clog.warn('a room’s board not kept as the call ended', { callId, documentId: b.documentId, err }));
  }
  const l = s.board.landing;
  if (!l) return;
  const open = s.board.open[MAIN_PLACE];
  const opener = !l.make && open?.documentId === l.into.documentId ? open.by : null;
  void boards.land(o, callId, l, null, opener).then((landed) => {
    if (landed.kind !== 'landed') clog.info('rooms’ boards not landed as the call ended: the board open can’t take them', { callId, rooms: l.rooms.length });
  }, (err: unknown) => clog.warn('rooms’ boards not landed as the call ended', { callId, err }));
}

/**
 * Leaving. Anyone but whoever hosts just goes: the host's browser takes them out of the group. Whoever hosts ends the
 * call for everyone (`end`); a host's page going away (`end` false: it hadn't heard yet that it hosts) hands the call to
 * whoever's next, and is refused when nobody can take it, so a page going away never ends it.
 */
export async function leave(v: Viewer, callId: string, end: boolean, onPurpose = false): Promise<CallEndResult | null> {
  if (!v.isHost) {
    await departed(v.organizer, callId, v.pass.identity, Date.now(), onPurpose);
    return null;
  }
  if (!end) {
    await handOff(v, callId, null, onPurpose);
    return null;
  }
  const ended = await endCall(v.organizer, callId);
  if (!ended) throw new ConflictError('This call has ended.', { context: { callId } });
  return ended;
}

/**
 * Whoever hosts leaves, and the call goes on with `to` hosting until the organizer is back (docs: Calls and recordings ›
 * Host hand-off), or with whoever's next when `to` is null: someone invited who's in the call and in its LiveKit room.
 * One transaction takes the leaver out and starts the new host's generation, so the call is never without a host.
 * Refused (409) when they can't host now, and nothing changes: the leaver stays, and can choose again or end the call.
 */
export async function handOff(v: Viewer, callId: string, to: string | null, onPurpose = to !== null): Promise<void> {
  const o = v.organizer;
  const ctx = { callId, role: v.pass.role, standIn: !v.isOrganizer };
  const { row: first } = await load(o, o.pool, callId);
  if (first.state !== 'live' || !first.room_name) throw new ConflictError('This call has ended.', { context: ctx });
  // A browser that isn't in the room can't take over. Asked before the row lock, so LiveKit never holds it up; if it
  // can't be asked, the call's own word that they're in it will do.
  const connected = await o.livekit.participants(first.room_name).then((ps) => new Set(ps.map((p) => p.identity)), () => undefined);
  const r = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    // Rooms whose time is up close now, taking what was said in them along.
    const s = await roomsChanged(o, c, callId, state, settle(state, row));
    stillHosting(v, s, ctx);
    const from = s.people.find((j) => j.identity === v.pass.identity);
    const can = standIns(s, new Set([v.pass.identity]), connected);
    const next = to === null ? can[0] : can.find((j) => j.identity === to);
    if (!from || !next) {
      throw new ConflictError(to === null ? 'Nobody else here can host. End the call for everyone instead.' : 'They can’t host right now. Choose someone else, or end the call.',
        { context: { ...ctx, why: 'not eligible', chosen: to !== null } });
    }
    const organizer = (await me(o, c)).name;
    const { state: after, generation } = await newGeneration(o, c, row, onPurpose ? space.leftForGood(s, from.person, from.identity) : s, { host: next, joining: false, gone: [from.identity] }, { change: { kind: 'left', from, to: next }, organizer });
    clog.info('host handed off and left', { ...ctx, generation, segment: after.notes.segment, notes: after.notes.status });
    return { room: row.room_name, closed: roomsClosedBetween(state, s) };
  });
  if (r.room) await o.livekit.removeParticipant(r.room, v.pass.identity).catch((e: unknown) => clog.info('host already gone from the room', { callId, err: e }));
  await afterClosing({ organizer: o, callId }, r.closed, () => nudge(o, r.room, callId, { call: true, log: true }));
}

/**
 * Someone other than whoever hosts is gone (left, or LiveKit says so): the host's browser removes them from the group,
 * so the keys move on. Someone still asking to be let in takes their request back. The host going is handOff's, or
 * upkeep's (reconcile), never this. `onPurpose`: they chose to, so what they started stops; only they can say so, and a
 * connection dropping or a page reloading comes back to what it left. `noticed`: Alcove found out, from LiveKit or upkeep,
 * rather than the connection saying so, so it went some time before `at`: its stay ends when it was last heard from.
 */
async function departed(o: Owner, callId: string, identity: string, at = Date.now(), onPurpose = false, noticed = false): Promise<void> {
  const r = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    const { row } = held;
    const j = held.state.people.find((x) => x.identity === identity && x.role !== 'host' && x.identity !== held.state.host);
    const state = j && onPurpose ? space.leftForGood(held.state, j.person, identity) : held.state;
    if (row.state !== 'live' || !j) return null;
    if (j.status !== 'in' && j.status !== 'waiting') {
      // LiveKit's word that they'd gone got here first.
      if (state !== held.state) await save(o, c, callId, state);
      return null;
    }
    // Someone who was in is kept, as having left (a reload's pass brings them back, hand and all), and their shares
    // end. Someone who only asked is kept as turned away: nothing of theirs, a pass included, brings them in without
    // asking again, and their identity can't come back as someone else (to be let in by a toast still showing the first ask).
    await save(o, c, callId, sharesEnd(withPerson(state, identity, (x) => (j.status === 'waiting' ? { ...x, status: 'denied' } : { ...x, status: 'left', left: noticed ? knownUntil(callId, x, at) : at })),
      j.status === 'in' ? [identity] : [], tenthsIn(row.started_at)));
    return { room: row.room_name, was: j.status, rooms: held.state.board.rooms.some((x) => !x.kept) };
  });
  if (r) {
    clog.info(r.was === 'waiting' ? 'someone stopped asking to join' : 'someone left the call', { callId });
    // Someone who's gone isn't in their room: its board goes with them, and comes back when they do.
    if (r.rooms) await syncRoomBoards({ organizer: o, callId });
    await nudge(o, r.room, callId, { call: true, log: true });
  }
}

/* ---------- the call's lifecycle from LiveKit: webhooks and upkeep, with nobody's session ---------- */

/**
 * How long the host's connection may be gone (LiveKit said it left, and still doesn't have it) before someone else hosts:
 * long enough for a reload to come back hosting by itself, short enough that the call isn't long without anyone letting
 * people in, moving its keys on or taking its notes.
 */
export const HANDOFF_MS = 10_000;
/**
 * How long the host's connection may be gone before the call ends when nobody can host instead, and how long a new
 * host's browser has to reach the room at all: LiveKit's 20 s departure timeout, plus margin.
 */
export const HOST_GRACE_MS = 25_000;
/** How long after LiveKit says someone left before asking it whether they're really gone. */
const LEFT_CHECK_MS = 3_000;
/** `at` is when LiveKit said they left (ms): their time in the call ends then, not when this check ran. */
async function goneFromRoom(d: Deps, ownerId: string, callId: string, roomName: string | null, identity: string, at: number): Promise<void> {
  const here = roomName ? await d.livekit.participants(roomName).then((ps) => ps.some((p) => p.identity === identity), () => false) : false;
  if (here) { clog.info('left and came back to the room', { callId }); return; }
  await departed(await openOwner(d, ownerId, undefined), callId, identity, at, false, true);
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
  // Upkeep comes through here, so a seat that a crash kept from someone let in is put right, and so is a room's board, and
  // rooms' boards a crash kept from landing land.
  if (row.state === 'live' && state.board.letIn.length) await syncBoardSeats({ organizer: o, callId });
  if (row.state === 'live' && state.board.rooms.some((r) => !r.kept)) await syncRoomBoards({ organizer: o, callId });
  if (row.state === 'live' && state.board.landing) await landRooms({ organizer: o, callId });
  const due = row.state === 'live' ? state.people.filter((j) => j.role !== 'host' && j.identity !== state.host && j.status === 'in' && now - j.since >= ARRIVAL_MS) : [];
  if (!due.length) return;
  const here = new Set((await d.livekit.participants(roomName)).map((p) => p.identity));
  for (const j of due) {
    if (here.has(j.identity)) continue;
    clog.info('someone let in isn’t in the room', { callId, role: j.role });
    await departed(o, callId, j.identity, now, false, true);
  }
}
const ByRoom = z.object({ owner_id: z.string(), call_id: z.string(), host_identity: z.string().nullable() });

/** Applies a verified LiveKit webhook. Rooms are unique, so the room finds the call (and its organizer, and who hosts). */
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
      const heard = Date.now();
      setTimeout(() => { goneFromRoom(d, r.owner_id, r.call_id, e.roomName, who, heard).catch((err: unknown) => clog.warn('checking who left failed', { callId: r.call_id, err })); }, LEFT_CHECK_MS).unref();
    }
    return;
  }
  if (e.event === 'participant_left') {
    // A reload or a dropped connection: if the host doesn't come back in time someone else hosts, and the call ends only
    // when nobody can.
    await exec(d.pool, 'UPDATE calls SET host_left_at = now() WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [r.owner_id, r.call_id, e.identity]);
    clog.info('host connection left', { callId: r.call_id });
    for (const after of [HANDOFF_MS, HOST_GRACE_MS]) setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after the host left failed', { err })); }, after + 1_000).unref();
  } else if (e.event === 'participant_joined') {
    await exec(d.pool, 'UPDATE calls SET host_left_at = NULL WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [r.owner_id, r.call_id, e.identity]);
  } else return;
  // Everyone's screen says what's captured: nothing while the host's browser is out of the call.
  await nudge(await openOwner(d, r.owner_id, undefined), e.roomName, r.call_id, { call: true, log: false });
}

const LiveCall = z.object({ owner_id: z.string(), call_id: z.string(), room_name: z.string(), host_identity: z.string().nullable(), host_joined_at: timestamp.nullable(), host_left_at: timestamp.nullable(), started_at: timestamp });
type LiveCall = z.infer<typeof LiveCall>;

/**
 * Looks after live calls whose host is gone: once LiveKit has said the host's connection left (HANDOFF_MS ago), or its
 * browser never reached the room (HOST_GRACE_MS), someone else hosts (standInFor); if nobody can, the call ends once the
 * host has been gone past HOST_GRACE_MS, as it always has. Calls whose room LiveKit no longer has end too. Whether the
 * host is in the room is asked of LiveKit, so a missed webhook neither ends a call nor keeps one going, and nothing
 * changes while LiveKit can't be asked.
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
  // Each call on its own: one that can't be handed on or ended this time never holds up the others.
  for (const c of live) {
    const done = await reconcileCall(d, c, rooms, now).catch((err: unknown) => {
      clog.warn('upkeep of a call failed', { callId: c.call_id, err });
      return false;
    });
    if (done) ended++;
  }
  return ended;
}
/** Upkeep of one live call: who reached the room, a hand-off once its host is gone, or its end. True when it ended. */
async function reconcileCall(d: Deps, c: LiveCall, rooms: ReadonlySet<string>, now: number): Promise<boolean> {
  const since = c.host_left_at ?? c.host_joined_at;
  const roomGone = now - c.started_at.getTime() > 60_000 && !rooms.has(c.room_name);
  let hostGone = !roomGone && since !== null && now - since.getTime() > (c.host_left_at ? HANDOFF_MS : HOST_GRACE_MS);
  let connected: Set<string> | undefined;
  if (hostGone) {
    connected = await d.livekit.participants(c.room_name).then((ps) => new Set(ps.map((p) => p.identity)), () => undefined);
    if (!connected || (c.host_identity !== null && connected.has(c.host_identity))) {
      hostGone = false;
      if (connected && c.host_left_at) await exec(d.pool, 'UPDATE calls SET host_left_at = NULL WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [c.owner_id, c.call_id, c.host_identity]);
    }
  }
  if (!hostGone && !roomGone) {
    await arrivals(d, c.owner_id, c.call_id, c.room_name, now).catch((err: unknown) => clog.warn('checking who reached the room failed', { callId: c.call_id, err }));
    return false;
  }
  if (hostGone && connected) {
    // Someone else hosts if anyone can; if nobody can yet, the call waits until the grace runs out.
    if ((await standInFor(d, c, connected, now)) !== 'nobody') return false;
    if (since !== null && now - since.getTime() <= HOST_GRACE_MS) return false;
  }
  const end = await endCall(await openOwner(d, c.owner_id, undefined), c.call_id, (r) => !roomGone && r.host_identity !== c.host_identity);
  if (!end) return false;
  clog.info('call ended without a host', { callId: c.call_id, reason: hostGone ? 'host gone, nobody can host' : 'room gone' });
  return true;
}

/**
 * Someone else hosts, once the host's connection has been gone long enough: the best of the invited people in the call
 * who are in its LiveKit room (`connected`). Reconcile decided from an earlier read, so it's all checked again under
 * the call's row lock. `handed`: done; `nobody`: nobody can host; `moved on`: the host changed meanwhile (came back,
 * or someone already took over), so there's nothing to do.
 */
async function standInFor(d: Deps, c: LiveCall, connected: ReadonlySet<string>, now: number): Promise<'handed' | 'nobody' | 'moved on'> {
  const o = await openOwner(d, c.owner_id, undefined);
  const r = await tx(o.pool, async (tc) => {
    const { row, state } = await load(o, tc, c.call_id, true);
    const same = row.state === 'live' && row.host_identity === c.host_identity && row.host_left_at?.getTime() === c.host_left_at?.getTime();
    if (!same) return { result: 'moved on' as const, room: null, closed: false };
    // Its connection let go to move to another device, which can still arrive: the call waits for it. One that ran out
    // is a host gone like any other.
    if (state.moving && state.moving.until > now) return { result: 'moved on' as const, room: null, closed: false };
    const s = await roomsChanged(o, tc, c.call_id, state, settle(state, row, now));
    const from = s.people.find((j) => j.identity === s.host);
    const next = standIns(s, new Set(s.host ? [s.host] : []), connected)[0];
    if (!next) return { result: 'nobody' as const, room: null, closed: false };
    const told = from ? { change: { kind: 'dropped' as const, from, to: next }, organizer: (await me(o, tc)).name } : undefined;
    const { generation, state: after } = await newGeneration(o, tc, row, s, { host: next, joining: false, gone: from ? [from.identity] : [] }, told);
    clog.info('host gone; someone else hosts', { callId: c.call_id, generation, from: from?.role === 'host' ? 'organizer' : 'stand-in', segment: after.notes.segment, notes: after.notes.status });
    return { result: 'handed' as const, room: row.room_name, closed: roomsClosedBetween(state, s) };
  });
  return afterClosing({ organizer: o, callId: c.call_id }, r.closed, async () => {
    if (r.result === 'handed') await nudge(o, r.room, c.call_id, { call: true, log: true });
    return r.result;
  });
}
export const state = (v: Viewer, callId: string) => view(v, v.organizer.pool, callId);
