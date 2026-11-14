/*
 * A call, as an operator sees it from outside the enclave (routes.ts). Looked up by a call's, a meeting's or a
 * note's ID, each run of the call says: its row's facts; counts and states from its sealed state, opened here as upkeep opens
 * it, never its fields; its recorder; its notes job; its LiveKit room; and the signs of a call that won't end
 * (lifecycle.ts › stuckSignals). Closing the room of a call that has ended is here too, and the calls the work report counts
 * (callsWork); ending a stuck call is lifecycle.ts's (endStuckCall). Never a name, an address, a title, the call's code or its
 * room's name: IDs, states, counts and times. The answers' schemas are here, and the operator CLI
 * (features/operator/cli/calls.ts) parses them.
 */
import { z, ZodError } from 'zod';
import type { Deps, Owner } from '../../../platform/context';
import { maybeOne, rows, timestamp } from '../../../platform/db';
import { ConflictError, DatabaseError, IntegrityError, NotFoundError, UnavailableError } from '../../../platform/errors';
import { limitsNow } from '../../../platform/limits';
import { log } from '../../../platform/log';
import { findOwner } from '../../../keys/owners';
import { NotesJobAnswer, clipsOf, noteJob } from '../../notes/operator/operator';
import { HOST_GRACE_MS, LEFT_UP_MS, ROOM_GRACE_MS, roomSeen, roomsUp, stuckSignals, type RoomSeen } from '../lifecycle';
import { placesTaken, type Joined } from '../places';
import { load, type Stored } from '../state';

const clog = log.child({ component: 'calls' });

const ByRole = z.object({ host: z.number(), invited: z.number(), guest: z.number() });
type ByRole = z.infer<typeof ByRole>;

/** What an operator may know of a run's sealed state: counts and states, never who. */
const Inside = z.object({
  /** Each person once, as their connections stand together (one in, and they're in), by role. */
  people: z.object({ in: ByRole, waiting: ByRole, left: ByRole, denied: ByRole }),
  /** Places taken (people in, and those it lets in by itself), of the most a call holds (`call.max_people`). */
  places: z.object({ taken: z.number(), most: z.number() }),
  /** Whether someone stands in for the organizer as host. */
  standIn: z.boolean(),
  notes: z.object({ status: z.enum(['off', 'on', 'paused']), everOn: z.boolean(), segment: z.number() }),
  breakoutRooms: z.number(),
  liveShares: z.number(),
  timerRunning: z.boolean()
});
type Inside = z.infer<typeof Inside>;

/** One run of a call: rejoining a call that has ended starts another, with a note of its own. */
export const CallRunAnswer = z.object({
  callId: z.string(),
  state: z.enum(['live', 'ended']),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** How long it ran, or has run so far, in seconds, and how far past the longest a call runs (`call.max_seconds`): 0 within it. */
  seconds: z.number(),
  pastLongestS: z.number(),
  locked: z.boolean(),
  /** While it's live: whether the connection that hosts is here, away (LiveKit said it left, `hostAwayS` ago), or there's none. */
  host: z.enum(['here', 'away', 'none']).nullable(),
  hostAwayS: z.number().nullable(),
  /** One more for every change of host. */
  generation: z.number(),
  /** From its sealed state: null when it won't open, which is logged. */
  inside: Inside.nullable(),
  /** What records its notes: segments, pieces and seconds of audio, and the live transcript's clips. Null without notes. */
  recorder: z.object({
    recordingId: z.string(), state: z.enum(['recording', 'paused', 'stopped']), segments: z.number(), pieces: z.number(), seconds: z.number(),
    clips: z.number(), sinceLastClipS: z.number().nullable()
  }).nullable(),
  notesJob: NotesJobAnswer.nullable(),
  /** Its LiveKit room, asked about for a live call or one that ended within the hour; null when it wasn't asked, or didn't say (`livekit`). */
  room: z.object({ exists: z.boolean(), participants: z.number(), publishers: z.number() }).nullable(),
  livekit: z.enum(['asked', 'not-asked', 'unanswered']),
  signals: z.object({ overdue: z.boolean(), hostGone: z.boolean(), roomGone: z.boolean(), noRoom: z.boolean(), roomLeftUp: z.boolean() })
});
export type CallRunAnswer = z.infer<typeof CallRunAnswer>;

/**
 * GET /v1/operator/calls/:id: which kind of ID matched, its meeting, and its newest runs, newest first, then the run the ID
 * names (a call's own, or the one that took a note) when it's older than those.
 */
export const CallAnswer = z.object({
  instance: z.string(),
  at: z.string(),
  matchedAs: z.enum(['call', 'meeting', 'note']),
  meetingId: z.string(),
  runs: z.array(CallRunAnswer),
  /** Runs left out: older than the newest RUNS, but for the one the ID names, which is always here. */
  olderRuns: z.number()
});
export type CallAnswer = z.infer<typeof CallAnswer>;

/** POST /v1/operator/calls/:callId/end. */
export const CallEndAnswer = z.object({ instance: z.string(), at: z.string(), callId: z.string(), ended: z.literal(true) });
export type CallEndAnswer = z.infer<typeof CallEndAnswer>;

/** POST /v1/operator/calls/:callId/room/close: whether LiveKit still had the room, which is gone now. */
export const RoomCloseAnswer = z.object({ instance: z.string(), at: z.string(), callId: z.string(), deleted: z.boolean() });
export type RoomCloseAnswer = z.infer<typeof RoomCloseAnswer>;

/** The most runs one answer holds, the newest, besides the one an ID names. */
const RUNS = 10;
const iso = (t: Date) => t.toISOString();

type Match = { matchedAs: 'call' | 'meeting'; ownerId: string; meetingId: string } | { matchedAs: 'note'; ownerId: string; startedAt: Date };

/** Whose an ID is: tried as a call's, then a meeting's (by its code's row, or a run's), then a note's (by its recording). */
async function matchOf(d: Pick<Deps, 'pool'>, id: string): Promise<Match | undefined> {
  const call = await maybeOne(d.pool, z.object({ owner_id: z.string(), meeting_item_id: z.string() }), 'SELECT owner_id, meeting_item_id FROM calls WHERE call_id = $1 LIMIT 1', [id]);
  if (call) return { matchedAs: 'call', ownerId: call.owner_id, meetingId: call.meeting_item_id };
  const meeting = await maybeOne(d.pool, z.object({ owner_id: z.string() }), `SELECT owner_id FROM call_codes WHERE meeting_item_id = $1
    UNION ALL SELECT owner_id FROM calls WHERE meeting_item_id = $1 LIMIT 1`, [id]);
  if (meeting) return { matchedAs: 'meeting', ownerId: meeting.owner_id, meetingId: id };
  const note = await maybeOne(d.pool, z.object({ owner_id: z.string(), started_at: timestamp }), `SELECT r.owner_id, r.started_at FROM recordings r
    JOIN items i ON i.owner_id = r.owner_id AND i.item_id = r.note_item_id AND i.kind = 'note' AND i.deleted_at IS NULL
    WHERE r.note_item_id = $1 ORDER BY r.started_at DESC LIMIT 1`, [id]);
  return note ? { matchedAs: 'note', ownerId: note.owner_id, startedAt: note.started_at } : undefined;
}

/**
 * A run's sealed state, opened as upkeep opens it, or undefined when it won't open, or the run has just gone: that's logged,
 * and the run is still described by its row.
 */
async function stateOf(o: Owner, callId: string): Promise<Stored | undefined> {
  try {
    return (await load(o, o.pool, callId)).state;
  } catch (e) {
    if (!(e instanceof IntegrityError || e instanceof ZodError || e instanceof SyntaxError || e instanceof NotFoundError)) throw e;
    clog.warn('a call’s state didn’t open for an operator', { callId, errorClass: e.name });
    return undefined;
  }
}

/**
 * The run that took a note, and its meeting: a run of the organizer's that was on when the note's recording started (a few
 * minutes either way, for clocks), whose sealed state names the note. Undefined for a note no call took: a room recording's.
 */
async function runOfNote(o: Owner, noteId: string, startedAt: Date): Promise<{ callId: string; meetingId: string } | undefined> {
  const near = await rows(o.pool, z.object({ call_id: z.string(), meeting_item_id: z.string() }), `SELECT call_id, meeting_item_id FROM calls
    WHERE owner_id = $1 AND started_at <= $2::timestamptz + interval '10 minutes' AND (ended_at IS NULL OR ended_at >= $2::timestamptz - interval '10 minutes')
    ORDER BY started_at DESC LIMIT 20`, [o.ownerId, startedAt]);
  for (const c of near) if ((await stateOf(o, c.call_id))?.notes.noteId === noteId) return { callId: c.call_id, meetingId: c.meeting_item_id };
  return undefined;
}

const zero = (): ByRole => ({ host: 0, invited: 0, guest: 0 });
const RANK: Record<Joined['status'], number> = { in: 0, waiting: 1, left: 2, denied: 3 };

function insideOf(s: Stored, most: number): Inside {
  // A person's connections (a reload, a comeback) taken together: in if one is, and by that one's role.
  const people = new Map<string, Joined>();
  for (const j of s.people) {
    const was = people.get(j.person);
    if (!was || RANK[j.status] < RANK[was.status] || (RANK[j.status] === RANK[was.status] && j.since > was.since)) people.set(j.person, j);
  }
  const counts = { in: zero(), waiting: zero(), left: zero(), denied: zero() };
  for (const j of people.values()) counts[j.status][j.role] += 1;
  const host = s.people.find((j) => j.identity === s.host);
  return {
    people: counts,
    places: { taken: placesTaken(s), most },
    standIn: host !== undefined && host.role !== 'host',
    notes: { status: s.notes.status, everOn: s.notes.everOn, segment: s.notes.segment },
    breakoutRooms: s.breakouts.open?.rooms.length ?? 0,
    liveShares: s.shares.filter((x) => x.until === null).length,
    timerRunning: s.timer?.status === 'running'
  };
}

const RecorderRow = z.object({ state: z.enum(['recording', 'paused', 'stopped']), segments: z.number(), pieces: z.number(), ms: z.coerce.number() });

async function recorderOf(o: Owner, recordingId: string, noteId: string | null): Promise<CallRunAnswer['recorder']> {
  const r = await maybeOne(o.pool, RecorderRow, `SELECT r.state, count(DISTINCT p.segment)::int AS segments, count(p.seq)::int AS pieces, coalesce(sum(p.duration_ms), 0)::bigint AS ms
    FROM recordings r LEFT JOIN recording_pieces p ON p.owner_id = r.owner_id AND p.recording_id = r.recording_id
    WHERE r.owner_id = $1 AND r.recording_id = $2 GROUP BY r.state`, [o.ownerId, recordingId]);
  if (!r) return null;
  const heard = noteId ? await clipsOf(o.pool, o.ownerId, noteId) : { clips: 0, sinceLastS: null };
  return { recordingId, state: r.state, segments: r.segments, pieces: r.pieces, seconds: Math.round(r.ms / 1000), clips: heard.clips, sinceLastClipS: heard.sinceLastS };
}

const RunRow = z.object({
  call_id: z.string(), state: z.enum(['live', 'ended']), started_at: timestamp, ended_at: timestamp.nullable(), room_name: z.string().nullable(),
  host_identity: z.string().nullable(), host_joined_at: timestamp.nullable(), host_left_at: timestamp.nullable(), locked: z.boolean(), mls_generation: z.coerce.number().int()
});
type RunRow = z.infer<typeof RunRow>;
const RUN_COLUMNS = 'call_id, state, started_at, ended_at, room_name, host_identity, host_joined_at, host_left_at, locked, mls_generation';

/** What LiveKit said of a run's room: not asked (ended over an hour ago, or no room), or asked, with its word (undefined: none). */
type Asked = { asked: false } | { asked: true; room: RoomSeen | undefined };

/**
 * A call, by a call's, a meeting's or a note's ID: its newest runs, newest first, then the run the ID names when it's older
 * than those. `nothing` when no call, meeting or note has the ID; `room-recording` for a note no call took. The organizer's
 * keys are opened for it, and wiped after.
 */
export async function lookUpCall(d: Deps, id: string, instance: string): Promise<CallAnswer | 'nothing' | 'room-recording'> {
  const match = await matchOf(d, id);
  if (!match) return 'nothing';
  const o = await findOwner(d, match.ownerId, undefined);
  if (!o) return 'nothing';
  try {
    // The meeting, and the run the ID names: a call's own, or the one that took a note. A meeting's names none.
    const found = match.matchedAs === 'note' ? await runOfNote(o, id, match.startedAt) : { meetingId: match.meetingId, callId: match.matchedAs === 'call' ? id : null };
    if (!found) return 'room-recording';
    const { meetingId, callId: named } = found;
    const limits = await limitsNow(d);
    const longestS = limits.get('call.max_seconds');
    const most = limits.get('call.max_people');
    const newest = await rows(o.pool, RunRow, `SELECT ${RUN_COLUMNS} FROM calls WHERE owner_id = $1 AND meeting_item_id = $2 ORDER BY started_at DESC, call_id LIMIT $3`,
      [o.ownerId, meetingId, RUNS]);
    // A run the newest leave out is older than all of them: after them, they're all still newest first.
    const older = named === null || newest.some((r) => r.call_id === named) ? undefined
      : await maybeOne(o.pool, RunRow, `SELECT ${RUN_COLUMNS} FROM calls WHERE owner_id = $1 AND meeting_item_id = $2 AND call_id = $3`, [o.ownerId, meetingId, named]);
    const page = older ? [...newest, older] : newest;
    const total = await maybeOne(o.pool, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM calls WHERE owner_id = $1 AND meeting_item_id = $2', [o.ownerId, meetingId]);
    const now = Date.now();
    // LiveKit for every run at once, each given its few seconds: a room live, or left up within the hour.
    const asked = await Promise.all(page.map(async (r): Promise<{ r: RunRow; ask: Asked }> => {
      const room = r.room_name;
      const recent = r.state === 'live' || (r.ended_at !== null && now - r.ended_at.getTime() <= LEFT_UP_MS);
      return { r, ask: room !== null && recent ? { asked: true, room: await roomSeen(d, r.call_id, room) } : { asked: false } };
    }));
    const runs: CallRunAnswer[] = [];
    for (const { r, ask } of asked) {
      const s = await stateOf(o, r.call_id);
      const room = ask.asked ? ask.room : undefined;
      const seconds = Math.max(0, Math.round(((r.ended_at?.getTime() ?? now) - r.started_at.getTime()) / 1000));
      const live = r.state === 'live';
      runs.push({
        callId: r.call_id, state: r.state, startedAt: iso(r.started_at), endedAt: r.ended_at ? iso(r.ended_at) : null,
        seconds, pastLongestS: Math.max(0, seconds - longestS), locked: r.locked,
        host: !live ? null : r.host_identity === null ? 'none' : r.host_left_at ? 'away' : 'here',
        hostAwayS: live && r.host_identity !== null && r.host_left_at ? Math.max(0, Math.round((now - r.host_left_at.getTime()) / 1000)) : null,
        generation: r.mls_generation,
        inside: s ? insideOf(s, most) : null,
        recorder: s?.notes.recordingId ? await recorderOf(o, s.notes.recordingId, s.notes.noteId) : null,
        notesJob: s?.notes.noteId ? await noteJob(o.pool, o.ownerId, s.notes.noteId) : null,
        room: !ask.asked || room === undefined ? null
          : room === 'gone' ? { exists: false, participants: 0, publishers: 0 }
            : { exists: true, participants: room.occupants.length, publishers: room.occupants.filter((p) => p.publishing).length },
        livekit: !ask.asked ? 'not-asked' : room === undefined ? 'unanswered' : 'asked',
        signals: stuckSignals(r, { room, longestS, movingUntil: s?.moving?.until ?? null, now })
      });
    }
    return { instance, at: iso(new Date()), matchedAs: match.matchedAs, meetingId, runs, olderRuns: Math.max(0, (total?.n ?? 0) - runs.length) };
  } finally {
    o.root.fill(0);
    o.wrapKey.fill(0);
  }
}

/** Whether a call has this ID: a run of any call, live or ended. */
export async function callExists(d: Pick<Deps, 'pool'>, callId: string): Promise<boolean> {
  return (await maybeOne(d.pool, z.object({ n: z.number() }), 'SELECT 1 AS n FROM calls WHERE call_id = $1 LIMIT 1', [callId])) !== undefined;
}

/**
 * Closes the LiveKit room of a call that has ended, which disconnects whoever is still in it; nothing stored changes. True
 * when LiveKit still had it. Refused for a live call, whose room is its own, and when LiveKit can't say whether it has it.
 */
export async function closeRoom(d: Deps, callId: string): Promise<boolean> {
  const r = await maybeOne(d.pool, z.object({ state: z.enum(['live', 'ended']), room_name: z.string().nullable() }), 'SELECT state, room_name FROM calls WHERE call_id = $1 LIMIT 1', [callId]);
  if (!r) throw new NotFoundError('No call has that ID.');
  if (r.state === 'live') throw new ConflictError('That call is still on, and its room is its own; nothing was done.', { context: { callId } });
  const room = r.room_name;
  const seen = room === null ? 'gone' : await roomSeen(d, callId, room);
  if (seen === undefined) throw new UnavailableError('LiveKit didn’t say whether the room is up, so nothing was closed. Try again in a moment.', { context: { callId } });
  if (seen !== 'gone' && room !== null) {
    await d.livekit.deleteRoom(room).catch((e: unknown) => {
      throw new UnavailableError('LiveKit couldn’t close the room. Look the call up again to see whether it’s still up.', { cause: e, context: { callId } });
    });
  }
  const deleted = seen !== 'gone';
  clog.info('room of an ended call closed by an operator', { callId, deleted, ...(seen === 'gone' ? {} : { participants: seen.occupants.length }) });
  return deleted;
}

/* ---------- calls in the work report (GET /v1/operator/work, features/operator/work.ts) ---------- */

const Count = z.number().int().nonnegative();

/**
 * Calls, as the work report counts them: from their rows, each sign as stuckSignals (lifecycle.ts) reads it, then LiveKit
 * asked once which of their rooms are up. Counts only: no call's ID, and no room's name.
 */
export const CallsWorkAnswer = z.object({
  /** Calls live now. */
  live: Count,
  /** Live calls that have run as long as a call can (`call.max_seconds`): stuckSignals' `overdue`. */
  overdue: Count,
  /** How far past its longest the most overdue live call is, in whole seconds; null when none is. */
  mostLateS: Count.nullable(),
  /**
   * Live calls whose host's connection left (LiveKit said so) more than HOST_GRACE_MS ago, by the row alone: what a call's
   * lookup says as `host: 'away'`, and the calls upkeep asks LiveKit about. LiveKit isn't asked who's in each room here, nor
   * is a call's sealed state opened (a host moving to another device), so this isn't stuckSignals' `hostGone`: a host who
   * never reached the room isn't counted, and one back in it on another connection still is until the row catches up.
   * `operator call <id>` asks LiveKit, and gives one call's `hostGone`.
   */
  hostAway: Count,
  /** Live calls with no room at all: stuckSignals' `noRoom`. */
  noRoom: Count,
  /** Calls that ended in the last hour (LEFT_UP_MS). */
  endedLastHour: Count,
  /**
   * From one ListRooms of at most MOST_ROOMS rooms, live calls' first, given 5 seconds: live calls more than a minute old
   * (ROOM_GRACE_MS) whose room LiveKit doesn't have (`roomGone`), and calls ended in the last hour whose room it still has
   * (`roomLeftUp`). Null when LiveKit didn't answer, with why in `livekit`.
   */
  roomGone: Count.nullable(),
  roomLeftUp: Count.nullable(),
  /** Why LiveKit didn't say which rooms are up, as a code (`timeout` when it ran out of time); null when it did, or wasn't asked. */
  livekit: z.string().nullable()
});
export type CallsWorkAnswer = z.infer<typeof CallsWorkAnswer>;

/** The most rooms one work report asks LiveKit about: live calls' first, then those of calls ended in the last hour, newest first. */
const MOST_ROOMS = 500;
const CallCounts = z.object({ live: Count, overdue: Count, most_late_s: Count.nullable(), host_away: Count, no_room: Count, ended_last_hour: Count });

/**
 * The calls part of the work report (CallsWorkAnswer): two statements, one after the other, then LiveKit once, with no row
 * held. A room's name is LiveKit's key to its dashboards, so none leaves here.
 */
export async function callsWork(d: Deps): Promise<CallsWorkAnswer> {
  const longestS = (await limitsNow(d)).get('call.max_seconds');
  const c = await maybeOne(d.pool, CallCounts, `
    SELECT count(*) FILTER (WHERE state = 'live')::int AS live,
      count(*) FILTER (WHERE state = 'live' AND started_at <= now() - make_interval(secs => $1))::int AS overdue,
      floor(extract(epoch FROM now() - (min(started_at) FILTER (WHERE state = 'live' AND started_at <= now() - make_interval(secs => $1)) + make_interval(secs => $1))))::int AS most_late_s,
      count(*) FILTER (WHERE state = 'live' AND host_identity IS NOT NULL AND host_left_at < now() - make_interval(secs => $2))::int AS host_away,
      count(*) FILTER (WHERE state = 'live' AND room_name IS NULL)::int AS no_room,
      count(*) FILTER (WHERE state = 'ended' AND ended_at >= now() - make_interval(secs => $3))::int AS ended_last_hour
    FROM calls WHERE state = 'live' OR (state = 'ended' AND ended_at >= now() - make_interval(secs => $3))`, [longestS, HOST_GRACE_MS / 1000, LEFT_UP_MS / 1000]);
  if (!c) throw new DatabaseError(undefined, { context: { why: 'no-row' } });
  const counts = { live: c.live, overdue: c.overdue, mostLateS: c.most_late_s, hostAway: c.host_away, noRoom: c.no_room, endedLastHour: c.ended_last_hour };
  // The rooms whose being up or not says something: live calls' past the grace, and those of calls ended within the hour.
  const asked = await rows(d.pool, z.object({ room_name: z.string(), live: z.boolean() }), `
    SELECT room_name, state = 'live' AS live FROM calls
    WHERE room_name IS NOT NULL AND ((state = 'live' AND started_at < now() - make_interval(secs => $2)) OR (state = 'ended' AND ended_at >= now() - make_interval(secs => $3)))
    ORDER BY (state = 'live') DESC, started_at DESC LIMIT $1`, [MOST_ROOMS, ROOM_GRACE_MS / 1000, LEFT_UP_MS / 1000]);
  if (!asked.length) return { ...counts, roomGone: 0, roomLeftUp: 0, livekit: null };
  const said = await roomsUp(d, asked.map((r) => r.room_name));
  if (!said.ok) return { ...counts, roomGone: null, roomLeftUp: null, livekit: said.code };
  const up = said.up;
  return {
    ...counts,
    roomGone: asked.filter((r) => r.live && !up.has(r.room_name)).length,
    roomLeftUp: asked.filter((r) => !r.live && up.has(r.room_name)).length,
    livekit: null
  };
}
