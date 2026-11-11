import { CALL_TIMER_MAX_SECONDS, CallTimerSchema, MAIN_PLACE, ModelIdSchema, firstName } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../context';
import { id128, openJson, sealJson, stateKey, toJson } from '../../crypto';
import { bytea, exec, maybeOne, timestamp, type Db } from '../../db';
import { notFound } from '../../errors';
import { CallBoards, CallSpace, NO_BOARDS, NO_SPACE, withOpenBoards } from './space-state';
import * as space from './workspace';
import * as boards from './boards';
import * as capture from './capture';
import { noticesFor, type HostChange } from './hosting';
import { BreakoutState, Joined, placesOf, relocate } from './places';
import { keepRooms } from './scribes';
import * as screens from '../recordings/screens';
import { carryModel } from '../notes/carryModel';
import { carryFrameCapture, FrameCapture } from '../recordings/storedFrames';
import { log } from '../../log';
import { syncAttention } from './attention';

const clog = log.child({ component: 'calls' });

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
const LiveShare = z.object({
  id: z.string(), identity: z.string(), keep: z.boolean(), recorded: z.boolean(), from: z.number(), until: z.number().nullable(),
  /** LiveKit listed this presenter's screen while this share was active. Older shares must verify before sending a tail. */
  published: z.boolean().default(false)
});

type LiveShare = z.infer<typeof LiveShare>;


/**
 * Call state written before the call's timer was one countdown keeps `timerSequence`: segments the host stepped through.
 * The segment it was on reads as the countdown, with the time added to it, and keeps its clock; a sequence still to start or
 * finished reads as no timer, and so does one that doesn't read. The next save writes `timer` in its place.
 */
const BeforeCountdown = z.object({
  timerSequence: z.object({
    revision: z.number().int().nonnegative(),
    segments: z.array(z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/), durationSeconds: z.number().int().min(1) })),
    activeIndex: z.number().int().nonnegative(),
    status: z.enum(['ready', 'running', 'paused', 'finished']),
    elapsedMs: z.number().nonnegative(),
    startedAt: z.number().nonnegative().nullable(),
    addedSeconds: z.number().int().nonnegative()
  }).nullable()
});

const withTimer = (v: unknown): unknown => {
  if (typeof v !== 'object' || v === null || 'timer' in v) return v;
  const old = BeforeCountdown.safeParse(v).data?.timerSequence;
  const segment = old?.segments[old.activeIndex];
  if (!old || !segment || old.status === 'ready' || old.status === 'finished') return v;
  const running = old.status === 'running' && old.startedAt !== null;
  const durationSeconds = Math.min(CALL_TIMER_MAX_SECONDS, segment.durationSeconds + old.addedSeconds);
  return { ...v, timer: { id: segment.id, revision: old.revision, durationSeconds, status: running ? 'running' : 'paused', elapsedMs: old.elapsedMs, startedAt: running ? old.startedAt : null } };
};

export const Stored = z.preprocess((v) => withTimer(withHost(v)), z.object({
  /**
   * The connection that hosts now (features/calls/hosting.ts): the organizer's, or someone's standing in while the organizer is
   * away. It commits for every part of the call's group (see committerOf). The `host_identity` column says the same,
   * for LiveKit's webhooks and upkeep, which read it without opening the call; both change only in newGeneration.
   */
  host: z.string().nullable().default(null),
  /**
   * The connection that hosts let go to move to another device, whose new device has until `until` (ms) to come in:
   * nobody takes over, and the call doesn't end for want of a host, while it can still arrive. Null otherwise.
   */
  moving: z.object({ until: z.number() }).nullable().default(null),
  notes: z.preprocess((v) => carryFrameCapture(carryModel(v)), z.object({
    /** What the call captures now (features/calls/capture.ts): notes off, on, or on and paused by the organizer. */
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
     * Shared screens kept for the notes (features/recordings/screens.ts): every time a kept share started going with none
     * before, or the last one stopped. A call stored before shares were asked about has none.
     */
    screenHistory: z.array(capture.ScreenChange).default([]),
    /** Captured frames from a previous release's still-live call, until they become note moments when it ends. */
    frameCapture: FrameCapture.nullable().default(null),
    /** The model the organizer chose for the notes (null: the default model). Goes into the note. */
    model: ModelIdSchema.nullable().default(null),
    /** The stretches with notes on but the host's browser out of the call, until another connection hosted. */
    offline: z.array(capture.OfflineStretch).default([])
  })),
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
  /**
   * Shares started in the call (features/recordings/screens.ts), the latest MAX_SHARES: whose (`identity`), whether the
   * presenter said it goes in the notes and it still does (`keep`), whether it has a row with the recording
   * (`recorded`), and when it started and ended (seconds since the call started; `until` null while it's going).
   */
  shares: z.array(LiveShare).default([]),
  /** Where in this generation's log each part of the call last had chat, so people who come in later know there was chat they can't read. */
  chatAt: z.record(z.string(), z.number()),
  /** This person's opaque chat message IDs, sealed with call state and kept across their reconnections. */
  chatRead: z.record(z.string(), z.array(z.string())).default({}),
  notices: z.array(Notice),
  /** What's going on in the workspace the call uses: who's asking to see it, what's being presented and played, and what's been worked on. */
  workspace: CallSpace.default(NO_SPACE),
  /** Which board is open in each part of the call, and which boards it lets everyone into. */
  board: CallBoards.default(NO_BOARDS),
  /** The call's timer, the same for everyone in it (features/calls/timers.ts), or null while none runs. */
  timer: CallTimerSchema.nullable().default(null)
}));

export type Stored = z.infer<typeof Stored>;

export const Row = z.object({
  version: z.coerce.number().int().nonnegative(), attention_ciphertext: bytea.nullable(),
  call_id: z.string(), meeting_item_id: z.string(), state: z.enum(['live', 'ended']), started_at: timestamp, ended_at: timestamp.nullable(), state_ciphertext: bytea,
  room_name: z.string().nullable(), host_identity: z.string().nullable(), host_joined_at: timestamp.nullable(), host_left_at: timestamp.nullable(), locked: z.boolean(),
  mls_generation: z.coerce.number().int(), mls_epoch: z.coerce.number().int(), mls_seq: z.coerce.number().int()
});

export type Row = z.infer<typeof Row>;

const COLUMNS = 'version, (SELECT ciphertext FROM call_attention WHERE call_attention.owner_id = calls.owner_id AND call_attention.call_id = calls.call_id) AS attention_ciphertext, call_id, meeting_item_id, state, started_at, ended_at, state_ciphertext, room_name, host_identity, host_joined_at, host_left_at, locked, mls_generation, mls_epoch, mls_seq';

export const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call:${callId}`);

export const header = (o: Owner, callId: string) => ({ v: 1 as const, kind: 'call-state', ownerId: o.ownerId, callId });

/** The call's row and state; `lock` takes the row's lock (`true`) or shares it (`'share'`) for the rest of the transaction. */
export async function load(o: Owner, db: Db, callId: string, lock: boolean | 'share' = false) {
  const r = await maybeOne(db, Row, `SELECT ${COLUMNS} FROM calls WHERE owner_id = $1 AND call_id = $2${lock === 'share' ? ' FOR SHARE' : lock ? ' FOR UPDATE' : ''}`, [o.ownerId, callId]);
  if (!r) throw notFound('That call');
  return { row: r, state: openJson(key(o, callId), header(o, callId), r.state_ciphertext, Stored) };
}

/**
 * Saves the call's sealed state, with each open breakout room's record brought up to date: who was in it, and its scribe. `s` is
 * the call as it was read under its row, changed: a call worked out from a settled one is saved with `saveSettled`, so rooms whose
 * time ran out close with what goes with them. What's over goes from it as it's saved, and a presentation that's over is said to
 * have ended where it was presented (`space.tidied`): whatever ended it is this change, so it's said as it happens. Says what it
 * saved, before each room's record.
 */
export async function save(o: Owner, db: Db, callId: string, s: Stored): Promise<Stored> {
  const before = await load(o, db, callId);
  const tidy = space.tidied(s, space.ending(o, callId));
  if (before.row.state === 'live') await syncAttention(o, db, callId, before.state, tidy);
  // A board open in any part of the call goes into the note, for that part's notes to read, whether or not anyone changes it.
  const kept = keepRooms({ ...tidy, workspace: withOpenBoards(tidy.workspace, tidy.board.open) }, Date.now());
  await exec(db, 'UPDATE calls SET state_ciphertext = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, sealJson(key(o, callId), header(o, callId), toJson(kept))]);
  return tidy;
}

/** A notice for everyone, or only those in one part of the call (`place`), and for everyone but one connection (`not`). */
export const notice = (s: Stored, text: string, kind: 'notes' | 'people' | 'info' = 'notes', place?: string | undefined, not?: string | undefined): Stored =>
  ({ ...s, notices: [...s.notices.slice(-2), { id: id128(), text, kind, ...(place ? { place } : {}), ...(not ? { not } : {}) }] });

/** A host change, told: the new host in their own words, everyone else in the same sentence (features/calls/hosting.ts). */
export const hostNotices = (s: Stored, change: HostChange, organizer: string): Stored =>
  ({ ...s, notices: [...s.notices, ...noticesFor(change, organizer).map((n) => ({ id: id128(), text: n.text, kind: 'people' as const, ...(n.to ? { to: n.to } : {}), ...(n.not ? { not: n.not } : {}) }))].slice(-4) });

export const withPerson = (s: Stored, identity: string, change: (j: Joined) => Joined): Stored => ({ ...s, people: s.people.map((j) => (j.identity === identity ? change(j) : j)) });

export const secondsIn = (startedAt: Date, at = Date.now()) => Math.max(0, Math.round((at - startedAt.getTime()) / 1000));

/** The same, to a tenth of a second: what notes and shared screens do, so even a short change shows where it was. */
export const tenthsIn = (startedAt: Date, at = Date.now()) => Math.max(0, Math.round((at - startedAt.getTime()) / 100) / 10);

/** The connection that hosts left the room and nothing has taken its place yet: nothing is captured meanwhile. */
export const hostAway = (r: Pick<Row, 'state' | 'host_identity' | 'host_left_at'>) => r.state === 'live' && r.host_identity !== null && r.host_left_at !== null;

/* ---------- breakout rooms: who is where is worked out in features/calls/places.ts; changing it is here ---------- */

/** Rooms, closing: everyone in one goes back to the main room (their browsers rejoin its group), and the rooms go to the notes. */
export function closeRooms(s: Stored, to: number, startedMs: number): Stored {
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
        rooms: open.rooms.map((r) => ({ id: r.id, name: r.name, emails: r.emails, guests: r.guests, pauses: r.pauses, seen: r.seen, scribes: r.scribes.map((x) => (x.until === null ? { ...x, until: Math.max(x.from, at) } : x)) })),
        from: open.from, to
      }]
    }
  };
}

/**
 * The call as it stands at `nowMs`: rooms whose time is up have closed, whether or not anyone said so, and everyone who
 * was in one has been back in the main room since they closed.
 */
export function settle(s: Stored, row: Pick<Row, 'started_at' | 'mls_seq'>, nowMs = Date.now()): Stored {
  const open = s.breakouts.open;
  if (!open || secondsIn(row.started_at, nowMs) < open.until) return s;
  return relocate(s, closeRooms(s, open.until, row.started_at.getTime()), row.started_at.getTime() + open.until * 1000, row.mls_seq);
}

/** Whether breakout rooms were open at `t` (ms): then a line said in any part of the call is for the people there at the time. */
export function roomsOpenAt(s: Stored, row: Pick<Row, 'started_at'>, t: number): boolean {
  const at = (t - row.started_at.getTime()) / 1000;
  const open = s.breakouts.open;
  return Boolean(open && open.from <= at) || s.breakouts.held.some((h) => h.from <= at && at < h.to);
}

/**
 * What rooms closing takes with them, in the transaction that saves it: their entries in the call's MLS log, so their
 * chat, which is live only. What was heard in them stays, sealed, until the call ends and it goes into each room's
 * section of the notes.
 */
export async function roomsChanged(o: Owner, db: Db, callId: string, before: Stored, after: Stored): Promise<Stored> {
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
export const roomsClosedBetween = (before: Stored, after: Stored): boolean => {
  const open = new Set(placesOf(after));
  return placesOf(before).some((p) => !open.has(p));
};

/**
 * Saves the call as `next`, worked out from `stored`, the call as it was read under its row, settled: rooms whose time is up
 * close as it's saved, and what goes with them goes (`roomsChanged`), whatever is first to save the call once their time runs
 * out. Says what was saved, and whether rooms closed, for the caller to follow through once the row's let go (`afterClosing`).
 */
export async function saveSettled(o: Owner, db: Db, callId: string, stored: Stored, next: Stored): Promise<{ s: Stored; closed: boolean }> {
  const s = await save(o, db, callId, await roomsChanged(o, db, callId, stored, next));
  return { s, closed: roomsClosedBetween(stored, s) };
}

/**
 * Taken out while their connection was away (it dropped for longer than LiveKit waits, or their tab slept), and not
 * because anyone wanted them out: the same connection can come back in as it is (`mlsBack`).
 */
export const mayComeBack = (j: Joined) => j.role !== 'host' && j.status === 'left' && !j.replaced;

export const hostHere = (r: Pick<Row, 'state' | 'host_identity' | 'host_left_at'>) => r.state === 'live' && r.host_identity !== null && r.host_left_at === null;

export const liveCall = (o: Owner, db: Db, meetingId: string, lock = false) => maybeOne(db, Row,
  `SELECT ${COLUMNS} FROM calls WHERE owner_id = $1 AND meeting_item_id = $2 AND state = 'live' ORDER BY started_at DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [o.ownerId, meetingId]);

/**
 * What the capture gate needs to know about this call, in one of its parts (`place`): a breakout room captures at most
 * what the call does, and nothing while the organizer has paused it.
 */
/** A breakout room's own pauses, while it's open or since it closed. */
export const roomPausesOf = (s: Stored, room: string): capture.RoomPause[] =>
  (s.breakouts.open?.rooms.find((r) => r.id === room) ?? s.breakouts.held.flatMap((h) => h.rooms).find((r) => r.id === room))?.pauses ?? [];

export const capturing = (row: Pick<Row, 'state'>, s: Stored, place: string = MAIN_PLACE): capture.Capturing => {
  const room = s.breakouts.open?.rooms.find((r) => r.id === place);
  const status = room ? capture.roomStatus(s.notes.status, room.pauses) : s.notes.status;
  return { live: row.state === 'live', status, noteId: s.notes.noteId, recordingId: s.notes.recordingId, room: status !== s.notes.status };
};

/* ---------- shared screens: each share, and the video of those kept for the notes (features/recordings/screens.ts) ---------- */

/** At most this many shares are remembered in a call (its sealed state stays small): the oldest ended ones go first. */
const MAX_SHARES = 200;

/** Shared screens as capture shows them: whether a kept share is going now, and every time that changed. */
export const screensOf = (s: Stored) => ({ live: s.shares.some((x) => x.until === null && x.keep), history: s.notes.screenHistory });

/** `after`, with the change to whether a kept share is going (from `before`) in its history, `at` seconds into the call. */
export function screenChanged(before: Stored, after: Stored, at: number): Stored {
  const on = screensOf(after).live;
  if (screensOf(before).live === on) return after;
  return { ...after, notes: { ...after.notes, screenHistory: [...after.notes.screenHistory, { at, on, segment: after.notes.segment }] } };
}

/**
 * Shares that ended, `at` seconds into the call: every share of a presenter who went (by participant ID), or one share
 * (by its ID). Their video stops there, in the notes too.
 */
export async function sharesEnd(o: Owner, db: Db, s: Stored, ends: (string | { share: string })[], at: number): Promise<Stored> {
  const ending = s.shares.filter((x) => x.until === null && ends.some((e) => (typeof e === 'string' ? e === x.identity : e.share === x.id)));
  if (!ending.length) return s;
  if (s.notes.recordingId) await screens.endShares(o, db, s.notes.recordingId, ending.filter((x) => x.recorded).map((x) => x.id), at * 1000, s.notes.segment);
  return screenChanged(s, { ...s, shares: s.shares.map((x) => (ending.includes(x) ? { ...x, until: at } : x)) }, at);
}

/** The latest shares, with the oldest ended ones dropped past MAX_SHARES. */
export function trimShares(shares: LiveShare[]): LiveShare[] {
  const over = shares.length - MAX_SHARES;
  if (over <= 0) return shares;
  const drop = new Set(shares.filter((x) => x.until !== null).slice(0, over).map((x) => x.id));
  return shares.filter((x) => !drop.has(x.id));
}
