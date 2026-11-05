import {
  CALL_TOPIC, CAPTION_LANGUAGES, LIVE_TRANSCRIPT_LINES, CallBackBodySchema, CallCommitBodySchema, CallKeyPackageBodySchema, CallMessageBodySchema, MAIN_PLACE, type Breakouts,
  type CallAction, type CallAnswer, type CallCard, type CallEndResult, type CallHost, type CallMls, type CallMlsGroup, type CallMlsItem, type CallMoment, type CallNudge, type CallRole,
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
import { openOwner } from '../owners';
import { me, profile } from './account';
import { CallSpace, NO_SPACE, withWorked, type WorkedBy, type WorkedDocument } from './callSpace';
import * as space from './callWorkspace';
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
import { callFor } from './repeats';
import type { Loaded } from '../vault';
import { findItem, getItem } from '../vault';
import { blankNote, createNoteWithRecording, finishRecording, type HeldRoom } from './notes';
import { addToInvite, addedFromLink, takeOffInvite } from './invites';
import { mayStandIn, noticesFor, standIns, type HostChange } from './hosting';
import {
  BreakoutState, Joined, chatSince, committerOf, departedFrom, epochIn, groupOf, mainScribeOf, needsKeys, pendingFor, placeAt, placeOf, placesOf, readableBy, readerOf, readersAt, relocate,
  type Room
} from './places';
import * as rings from './rings';
import { keepRooms, scribeAt, scribedIn, scribeOf } from './scribes';
import * as screens from './screens';
import * as series from './series';
import * as transcripts from './transcripts';
import { readerInCall, workspaceOwner } from './workspaceAccess';
import { endSeat, endSeats } from './workspaces';
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
  workspace: CallSpace.default(NO_SPACE)
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
/** Saves the call's sealed state, with each open breakout room's record brought up to date: who was in it, and its scribe. */
async function save(o: Owner, db: Db, callId: string, s: Stored) {
  const kept = keepRooms(s, Date.now());
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
  if (closed.length) {
    await exec(db, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND grp = ANY($3::text[])', [o.ownerId, callId, closed]);
    clog.info('breakout rooms closed', { callId, rooms: closed.length });
  }
  return after;
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
    open: open ? { rooms: open.rooms.map((r) => ({ ...roomOf(r, true), paused: r.pauses.at(-1)?.paused === true })), from: open.from, until: open.until, message: open.message } : null,
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
/** Tells a call to read itself again when something outside it changed what someone there can open. It needs only where its room is. */
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
/** Everyone in the call now or, with `place`, in that part of it, by seat, with the name they're in it under. */
export async function seatedIn(o: Owner, callId: string, place?: string | undefined): Promise<Map<string, string>> {
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const key = seatKey(o, callId);
  return new Map(s.people.filter((j) => j.status === 'in' && (place === undefined || placeOf(s, j) === place)).map((j) => [seatOf(key, j), j.name]));
}
export const seated = (v: Viewer): Promise<Map<string, string>> => seatedIn(v.organizer, v.pass.callId);

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
      host: { id: null, standIn: false, organizer: { id: 'organizer', name: '', email: '' }, next: [] }, transcript: [], liveNotes: NO_NOTES, workspace: PRIVATE, notices: []
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
    // Each notice to the people it's for: everyone, only those in the room it's about, one connection, or everyone but one.
    notices: s.notices.filter((n) => (n.place === undefined || n.place === where) && (n.to === undefined || n.to === v.pass.identity) && n.not !== v.pass.identity)
      .map((n) => ({ id: n.id, text: n.text, kind: n.kind }))
  };
}

/** What someone who isn't in the call yet is told of its workspace: nothing. */
const PRIVATE: CallWorkspace = { id: null, name: null, chosenBy: { id: 'organizer', name: '', email: '' }, canOpen: false, role: null, documents: [], agenda: null, present: null, play: null, asks: [], asked: 'no' };

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
        host: joined.identity, moving: null, people: [{ ...joined, hosting: [{ from: joined.since, to: null }] }], spotlight: null, breakouts: { open: null, held: [] }, removed: [], pointing: true, othersPointOff: [], chatAt: {}, notices: [], workspace: NO_SPACE,
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
    if (before) s = sharesEnd(withPerson(s, before.identity, (j) => ({ ...j, status: 'left', replaced: true, left: j.status === 'in' ? Date.now() : j.left })), before.status === 'in' ? [before.identity] : [], tenthsIn(live.started_at));
    const seq = live.mls_seq + 1;
    await appendMls(o, c, live.call_id, { seq, generation: live.mls_generation, epoch: live.mls_epoch, grp: null }, 'keypackage', me.identity, keyPackage);
    await exec(c, 'UPDATE calls SET mls_seq = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, live.call_id, seq]);
    await save(o, c, live.call_id, s);
    return { callId: live.call_id, roomName: live.room_name, replaced: null, row: live, state: s, admit: me.admit, generation: live.mls_generation, person: me.person, hosts: false };
  });
}

/* ---------- during the call: the organizer's controls, and what anyone in it can do ---------- */

/** Everything in `act` but a raised hand, an ask for notes, your own share's pointing, ticking a follow-up and what goes by what you can open in the workspace is whoever hosts' (the organizer's own besides, checked by the API). */
export const anyone = (a: CallAction): boolean => a.type === 'hand' || a.type === 'request-notes' || a.type === 'others-point' || a.type === 'follow-up' || space.anyonesAction(a);
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
  if (a.type === 'workspace-open') return openWorkspace(v, callId);
  if (space.isSpaceAction(a)) return actOnWorkspace(v, callId, a);
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
  await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, action: a.type } });
    const at = secondsIn(row.started_at);
    // To a tenth of a second, for what's captured and for rooms opening: even a short pause falls on the right side of a room's opening.
    const exact = tenthsIn(row.started_at);
    const settled = settle(state, row);
    let s = settled;
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
    } else if (a.type === 'follow-up') {
      await tickFollowUp(v, c, row, s, a);
    } else if (a.type === 'pointing') {
      if (a.on !== s.pointing) {
        s = notice({ ...s, pointing: a.on }, a.on ? 'The organizer turned on pointing at shared screens.' : 'The organizer turned off pointing at shared screens.', 'info');
      }
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
      // Each room gets its own MLS group: everyone sent to one leaves the main room's group and joins the room's.
      s = { ...s, spotlight: null, breakouts: { ...s.breakouts, open: { rooms: a.rooms.map((r) => ({ id: id128(), name: r.name, emails: r.emails, epoch: 0, pauses: [], scribes: [], seen: [] })), from: exact, until: exact + a.minutes * 60, message: null, visiting: null } } };
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
        clog.info('taken off the invite', { callId, meetingId: row.meeting_item_id, noteId: s.notes.noteId });
      }
    } else if (a.type === 'lock') {
      locked = a.on;
      await exec(c, 'UPDATE calls SET locked = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, locked]);
    } else if (a.type === 'ring') {
      // Nobody new can come into a locked call, so nobody is rung into one. Someone already here has no need of a ring.
      if (locked) throw new ConflictError('This call is locked, so nobody new can join. Unlock it to ring someone.', { context: ctx });
      const here = new Set(s.people.flatMap((j) => (j.status === 'in' && j.email ? [j.email.toLowerCase()] : [])));
      await rings.ring(o, c, { meetingId: row.meeting_item_id, noteId: s.notes.noteId }, a.emails.filter((e) => !here.has(e)));
    } else if (a.type === 'stop-ring') {
      await rings.stop(o, c, row.meeting_item_id, a.ringId);
    } else {
      s = await changeCapture(v, c, row, s, a, exact);
    }
    const moved = s.people.filter((j) => j.status === 'in' && j.role !== 'host' && placeOf(settled, j) !== placeOf(s, j)).length;
    // Whoever left the main room (sent to a room, or the organizer visiting one) takes their share with them: it stops
    // there in the notes. Each share is ended by presenter, not by share, so it's read again once they're back.
    s = sharesEnd(s, s.people.filter((j) => j.status === 'in' && placeOf(settled, j) === MAIN_PLACE && placeOf(s, j) !== MAIN_PLACE).map((j) => j.identity), exact);
    s = space.tidied(await roomsChanged(o, c, callId, state, relocate(settled, s, Date.now(), row.mls_seq)));
    await save(o, c, callId, s);
    // Anyone sent to another part of the call (or back) moves group: their browser and the organizer's read the log again.
    clog.info('call action', {
      callId, action: a.type, notes: s.notes.status, screens: s.notes.screens.on, segment: s.notes.segment, asks: s.notes.asks.filter((x) => x.state === 'asking').length, unavailable: s.notes.unavailable.length,
      connections: gone.length, spotlight: Boolean(s.spotlight), rooms: s.breakouts.open?.rooms.length ?? 0, visiting: Boolean(s.breakouts.open?.visiting), roomsHeld: s.breakouts.held.length, moved,
      pointing: s.pointing, othersPointOff: s.othersPointOff.length
    });
    return { room: row.room_name, gone, moved, removed };
  }).then(async ({ room, gone, moved, removed }) => {
    if (room) for (const who of gone) await o.livekit.removeParticipant(room, who).catch((e: unknown) => clog.info('removed person already gone', { callId, err: e }));
    // What the call gave them in a workspace goes with them.
    if (removed) await endSeat(o, callId, removed);
    await nudge(o, room, callId, { call: true, log: a.type === 'remove' || a.type === 'deny' || moved > 0 });
  });
  return view(v, o.pool, callId);
}

/* ---------- the workspace a call uses: what's done is modules/callWorkspace.ts; the call's row is held here ---------- */

/**
 * Something done about the call's workspace, under its row. Who's asking, and whether a video to play is in its document, are
 * settled before that's taken: they read accounts and documents, and nothing in the call waits on those.
 */
async function actOnWorkspace(v: Viewer, callId: string, a: space.SpaceAction): Promise<CallState> {
  const o = v.organizer;
  const reader = await readerInCall(v);
  if (a.type === 'play-start') {
    const { row } = await load(o, o.pool, callId);
    await space.mayPlay(o, reader, (await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting')).manifest.workspaceId, a.documentId, a.mediaId);
  }
  const { room, moved, meetingId } = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const ctx = { callId, action: a.type };
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    if (!anyone(a)) stillHosting(v, state, ctx);
    const settled = settle(state, row);
    const mine = settled.people.find((j) => j.identity === v.pass.identity);
    const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
    const seats = seatKey(o, callId);
    const done = await space.change({ v, reader, c, callId, meeting, s: settled, place: mine ? placeOf(settled, mine) : MAIN_PLACE, now: Date.now(), seatOf: (j) => seatOf(seats, j) }, a);
    await save(o, c, callId, space.tidied(await roomsChanged(o, c, callId, state, done.s)));
    clog.info('call action', { callId, action: a.type, present: done.s.workspace.present.length, play: done.s.workspace.play.length, asks: done.s.workspace.asks.length });
    return { room: row.room_name, moved: done.moved, meetingId: row.meeting_item_id };
  });
  if (moved) {
    await space.noteUsed(o, moved.to);
    await space.carryForward(o, meetingId, moved.from, moved.to);
  }
  await nudge(o, room, callId, { call: true, log: false });
  return view(v, o.pool, callId);
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
 * The workspace a call uses, settled the first time it's asked for, under the call's row so that everyone asking at once
 * gets the same one. A workspace deleted since it was chosen is settled again.
 */
export async function settledWorkspace(o: Owner, callId: string): Promise<string> {
  const { row } = await load(o, o.pool, callId);
  const { workspaceId } = (await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting')).manifest;
  if (workspaceId && await workspaceOwner(o.pool, workspaceId)) return workspaceId;
  const chosen = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, what: 'workspace' } });
    const was = (await getItem(o, c, 'meeting', held.row.meeting_item_id, MeetingManifest, 'That meeting')).manifest.workspaceId;
    if (was && await workspaceOwner(c, was)) return { id: was, was, room: null };
    const id = await space.chooseFor(o, c);
    await updateManifest(o, c, held.row.meeting_item_id, (m) => ({ ...m, workspaceId: id }));
    clog.info('call settled on a workspace', { callId, workspaceId: id });
    return { id, was, room: held.row.room_name };
  });
  if (chosen.id !== chosen.was) {
    await space.noteUsed(o, chosen.id);
    await space.carryForward(o, row.meeting_item_id, chosen.was, chosen.id);
    await nudge(o, chosen.room, callId, { call: true, log: false });
  }
  return chosen.id;
}

/**
 * Looks once, in each run of a call, for an agenda to make: what it says is worked out with nothing held, and it's made under
 * the call's row, so there's one however many people open Workspace at once. What goes in it is written after that.
 */
async function agendaFor(o: Owner, callId: string): Promise<void> {
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live' || state.workspace.agendaLooked) return;
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const plan = await space.planAgenda(o, meeting);
  const made = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live' || held.state.workspace.agendaLooked) return undefined;
    await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, agendaLooked: true } });
    return plan ? space.claimAgenda(o, c, meeting.itemId, plan) : undefined;
  });
  if (!made || !plan) return;
  await space.fillAgenda(made, plan, callId);
  clog.info('next agenda made', { callId, workspaceId: plan.workspaceId, documentId: made.documentId, carried: plan.open.length });
  await nudge(o, row.room_name, callId, { call: true, log: false });
}

/**
 * Someone opens Workspace. A workspace that can't be made for a guest opening it is the organizer's to hear about, not
 * theirs, and an agenda that can't be made is no reason anyone can't open the rest.
 */
async function openWorkspace(v: Viewer, callId: string): Promise<CallState> {
  const o = v.organizer;
  try {
    await settledWorkspace(o, callId);
    await agendaFor(o, callId).catch((e: unknown) => clog.warn('next agenda not made', { callId, err: e }));
  } catch (e) {
    if (v.isOrganizer || !(e instanceof ConflictError)) throw e;
    clog.info('workspace not settled for someone opening it', { callId, code: e.code });
  }
  return view(v, o.pool, callId);
}

/** What changing the call's workspace would mean, for the organizer to decide. */
export async function previewWorkspace(v: Viewer, callId: string, workspaceId: string): Promise<CallWorkspaceSwitch> {
  return space.preview(v, await readerInCall(v), (await load(v.organizer, v.organizer.pool, callId)).state.people, workspaceId);
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

/** Everything that reaches the AI from a call waits while notes, or the room someone's in, are paused. */
export async function mayAskInCall(v: Viewer): Promise<void> {
  const { row, state } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  capture.mayReachAi(capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE), 'ask', { callId: v.pass.callId, what: 'ask-selection' });
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
  const room = await tx(o.pool, async (c) => {
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
      clog.info('added to the invite', { callId, meetingId: row.meeting_item_id, noteId: s.notes.noteId, people: added.length });
      // The invite is full: they're in the call, as guests, without the notes.
      if (added.length < wanted.length) clog.warn('invite full; let in without the notes', { callId, meetingId: row.meeting_item_id, people: wanted.length - added.length });
    }
    s = await roomsChanged(o, c, callId, state, s);
    await save(o, c, callId, s);
    return row.room_name;
  });
  clog.info('call keys moved on', { ...ctx, next: b.epoch + 1, bytes: b.commit.length + (b.welcome?.length ?? 0) });
  await nudge(o, room, callId, { call: b.added.length > 0 || b.removed.length > 0, log: true });
  if (b.added.length && room) {
    // Whoever was just let in should reach the room soon; anyone who doesn't (their tab closed while they asked) is taken out.
    const d: Deps = { cfg: o.cfg, pool: o.pool, objects: o.objects, livekit: o.livekit, hub: o.hub, docs: o.docs };
    const ownerId = o.ownerId;
    setTimeout(() => { arrivals(d, ownerId, callId, room, Date.now()).catch((err: unknown) => clog.warn('checking who reached the room failed', { callId, err })); }, ARRIVAL_MS + 1_000).unref();
  }
  return { epoch: b.epoch + 1 };
}

/**
 * Chat, as an MLS message from someone in the group of the part of the call they're in: stored as it came, and
 * relayed to everyone in that group. Nobody chats into another part of the call, whoever hosts included.
 */
export async function mlsMessage(v: Viewer, callId: string, b: z.infer<typeof CallMessageBodySchema>): Promise<void> {
  requireIn(v, 'chat');
  const o = v.organizer;
  const ctx = { callId, epoch: b.epoch, room: b.group !== MAIN_PLACE };
  const room = await tx(o.pool, async (c) => {
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
    await save(o, c, callId, await roomsChanged(o, c, callId, state, { ...s, chatAt: { ...s.chatAt, [b.group]: seq } }));
    return row.room_name;
  });
  // Sizes only: what was said is in the MLS message, which nobody here can read.
  clog.debug('chat relayed', { ...ctx, bytes: b.message.length });
  await nudge(o, room, callId, { call: false, log: true });
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
    await save(o, c, callId, await roomsChanged(o, c, callId, state, next));
    return { room: row.room_name, moving: groupOf(s, mine) !== null || placeOf(s, mine) !== MAIN_PLACE };
  });
  clog.info('keys sent to join another group', { callId, generation: b.generation, moving: r.moving });
  await nudge(o, r.room, callId, { call: false, log: true });
}

/**
 * Back in as they were, after being taken out while their connection was away: the same connection and person (seat,
 * hand and all), with a fresh key package for the host's browser to add them by. Nobody removed, turned away,
 * or whose place went to another tab or device comes back this way; they join again.
 */
export async function mlsBack(v: Viewer, callId: string, b: z.infer<typeof CallBackBodySchema>): Promise<void> {
  const o = v.organizer;
  const room = await tx(o.pool, async (c) => {
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
    await save(o, c, callId, await roomsChanged(o, c, callId, state, next));
    return row.room_name;
  });
  clog.info('back in the call after its connection dropped', { callId, generation: b.generation });
  await nudge(o, room, callId, { call: true, log: true });
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
const NO_NOTES: LiveNotes = { notes: null, writing: false, error: null };
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

/**
 * A follow-up of the live notes of the part of the call someone is in, ticked or not, for everyone there, in the
 * caller's transaction, which holds the call's row, so the call can't end halfway through. It's for anyone in the call
 * who gets the notes, as `mayChangeAction` has it for a follow-up nobody has taken on, which nothing is until the notes
 * are written. A guest with the link doesn't get them.
 */
async function tickFollowUp(v: Viewer, c: Db, row: Row, s: Stored, a: Extract<CallAction, { type: 'follow-up' }>): Promise<void> {
  const o = v.organizer;
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  if (!mine || onlyHere(v, s, mine, row.started_at, invited) !== null) throw new ForbiddenError('The notes go to the people invited, so only they can tick follow-ups.', { context: { callId: row.call_id, role: v.pass.role, what: a.type } });
  const organizer = mine.role === 'host' ? await me(o) : undefined;
  const by: Changer = { id: organizer ? o.ownerId : null, name: organizer?.name ?? mine.name, email: organizer?.email ?? mine.email ?? '', as: organizer ? 'organizer' : 'invited' };
  await liveNotes.tick(o, c, row.call_id, placeOf(s, mine), a.id, a.done, by, readerFor(v, s, mine, row.started_at, invited));
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
      worked = s.workspace.worked;
      // What the call kept of its workspace goes with it: what was worked on goes into its note, if it has one, and nowhere else.
      await save(o, c, callId, { ...s, workspace: NO_SPACE });
      // The MLS log only matters while the call runs, and nobody is rung into a call that's over.
      await exec(c, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
      await rings.clear(o, c, row.meeting_item_id);
      // Who's invited lasts as long as the call does. Its note has its own list.
      await dropInvites(o, c, [row.meeting_item_id]);
      if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'stopped');
      // The live notes end with the call: what was ticked goes into the note, and the notes at the end take over.
      const ticked = await liveNotes.finish(o, c, callId);
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
        audio = await finishRecording(o, c, s.notes.noteId, duration, held, speakerOf, gaps, shown, rooms, ticked, worked);
      }
      await updateManifest(o, c, row.meeting_item_id, (m) => ({ ...m, status: 'ended', duration, ...(s.notes.noteId ? { noteId: s.notes.noteId } : {}) }));
    }
    clog.info(row.state === 'live' ? 'call ended' : 'left an ended call', { callId, meetingId: row.meeting_item_id, duration, noteId: s.notes.noteId });
    return { meetingId: row.meeting_item_id, pendingNoteId: s.notes.noteId, duration };
  });
  if (!end) return null;
  await queueDelete(o, audio);
  // Nor do moves to other devices. Deleted once the call has ended, so a move coming in at that moment never waits on it.
  await exec(o.pool, 'DELETE FROM call_moves WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
  // Nor does anything shared with people's seats in it (maintenance sweeps up, should this be cut short).
  await endSeats(o, [callId]);
  if (end.pendingNoteId) writer.kick(o, o.ownerId);
  // Deleting the room disconnects everyone in it, which is how their browsers learn the call ended: an ended call is the organizer's alone to read.
  if (room) await o.livekit.deleteRoom(room).catch((e: unknown) => clog.warn('room not deleted', { callId, err: e }));
  // What's kept of the workspace is the last thing and nobody waits for it: it can take a worker as long as a worker has for
  // each document, and nothing about the call's end depends on it. It says itself when something didn't work.
  void space.afterCall(o, callId, end.meetingId, worked);
  return end;
}

/**
 * Leaving. Anyone but whoever hosts just goes: the host's browser takes them out of the group. Whoever hosts ends the
 * call for everyone (`end`); a host's page going away (`end` false: it hadn't heard yet that it hosts) hands the call to
 * whoever's next, and is refused when nobody can take it, so a page going away never ends it.
 */
export async function leave(v: Viewer, callId: string, end: boolean): Promise<CallEndResult | null> {
  if (!v.isHost) {
    await departed(v.organizer, callId, v.pass.identity);
    return null;
  }
  if (!end) {
    await handOff(v, callId, null);
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
export async function handOff(v: Viewer, callId: string, to: string | null): Promise<void> {
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
    const { state: after, generation } = await newGeneration(o, c, row, s, { host: next, joining: false, gone: [from.identity] }, { change: { kind: 'left', from, to: next }, organizer });
    clog.info('host handed off and left', { ...ctx, generation, segment: after.notes.segment, notes: after.notes.status });
    return { room: row.room_name };
  });
  if (r.room) await o.livekit.removeParticipant(r.room, v.pass.identity).catch((e: unknown) => clog.info('host already gone from the room', { callId, err: e }));
  await nudge(o, r.room, callId, { call: true, log: true });
}

/**
 * Someone other than whoever hosts is gone (left, or LiveKit says so): the host's browser removes them from the group,
 * so the keys move on. Someone still asking to be let in takes their request back. The host going is handOff's, or
 * upkeep's (reconcile), never this.
 */
async function departed(o: Owner, callId: string, identity: string, at = Date.now()): Promise<void> {
  const r = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const j = state.people.find((x) => x.identity === identity && x.role !== 'host' && x.identity !== state.host);
    if (row.state !== 'live' || !j || (j.status !== 'in' && j.status !== 'waiting')) return null;
    // Someone who was in is kept, as having left (a reload's pass brings them back, hand and all), and their shares
    // end. Someone who only asked is kept as turned away: nothing of theirs, a pass included, brings them in without
    // asking again, and their identity can't come back as someone else (to be let in by a toast still showing the first ask).
    await save(o, c, callId, sharesEnd(withPerson(state, identity, (x) => (j.status === 'waiting' ? { ...x, status: 'denied' } : { ...x, status: 'left', left: at })),
      j.status === 'in' ? [identity] : [], tenthsIn(row.started_at)));
    return { room: row.room_name, was: j.status };
  });
  if (r) { clog.info(r.was === 'waiting' ? 'someone stopped asking to join' : 'someone left the call', { callId }); await nudge(o, r.room, callId, { call: true, log: true }); }
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
  await departed(await openOwner(d, ownerId, undefined), callId, identity, at);
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
  const due = row.state === 'live' ? state.people.filter((j) => j.role !== 'host' && j.identity !== state.host && j.status === 'in' && now - j.since >= ARRIVAL_MS) : [];
  if (!due.length) return;
  const here = new Set((await d.livekit.participants(roomName)).map((p) => p.identity));
  for (const j of due) {
    if (here.has(j.identity)) continue;
    clog.info('someone let in isn’t in the room', { callId, role: j.role });
    await departed(o, callId, j.identity);
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
    if (!same) return { result: 'moved on' as const, room: null };
    // Its connection let go to move to another device, which can still arrive: the call waits for it. One that ran out
    // is a host gone like any other.
    if (state.moving && state.moving.until > now) return { result: 'moved on' as const, room: null };
    const s = await roomsChanged(o, tc, c.call_id, state, settle(state, row, now));
    const from = s.people.find((j) => j.identity === s.host);
    const next = standIns(s, new Set(s.host ? [s.host] : []), connected)[0];
    if (!next) return { result: 'nobody' as const, room: null };
    const told = from ? { change: { kind: 'dropped' as const, from, to: next }, organizer: (await me(o, tc)).name } : undefined;
    const { generation, state: after } = await newGeneration(o, tc, row, s, { host: next, joining: false, gone: from ? [from.identity] : [] }, told);
    clog.info('host gone; someone else hosts', { callId: c.call_id, generation, from: from?.role === 'host' ? 'organizer' : 'stand-in', segment: after.notes.segment, notes: after.notes.status });
    return { result: 'handed' as const, room: row.room_name };
  });
  if (r.result === 'handed') await nudge(o, r.room, c.call_id, { call: true, log: true });
  return r.result;
}
export const state = (v: Viewer, callId: string) => view(v, v.organizer.pool, callId);
