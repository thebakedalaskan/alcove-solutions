import { MAIN_PLACE } from '@alcove/api';
import type { Deps, Owner } from '../../../platform/context';
import { id128 } from '../../../keys/crypto';
import { tx, type Db } from '../../../platform/db';
import { ConflictError, NotFoundError } from '../../../platform/errors';
import { findOwner } from '../../../keys/owners';
import { profile } from '../../profile/profile';
import { CallBoards, withWorked, type Controller, type FoundRoomBoard, type Landing, type RoomBoard } from '../workspace/space-state';
import { type WorkedBy, type WorkedDocument } from '../../workspaces/worked';
import * as space from '../workspace/workspace';
import * as boards from './boards';
import { MeetingManifest } from '../../meetings/service';
import { findItem, getItem } from '../../../keys/vault';
import { placesOf } from '../places';
import { serverWorkspace, trashOf, type CallRef } from '../../workspaces/access';
import type { RoomsOfCall } from '../../workspaces/calls';
import { endSeat } from '../../workspaces/service';
import { workspaceCalls } from '../workspace/seats';
import { log } from '../../../platform/log';
import { load, notice, save, settle, type Row, type Stored } from '../state';
import { hereIn, inPlaceOf, knownIn, seatKey, seatOf, type Viewer } from '../participants';
import { tellRoom } from '../attention/notifications';

const clog = log.child({ component: 'calls' });

/**
 * What follows a save that closed rooms (`closed`, as `saveSettled` says), once the call's row is let go: each room's board goes
 * from the seats of whoever was in it to everyone invited (`syncRoomBoards`), before anyone's told; then `answer`, what whoever
 * asked is told, and anyone else; and then the rooms' boards come back to the main board (`landRooms`), which nobody waits for
 * and which tells everyone itself once they're there.
 */
export async function afterClosing<T>(call: CallRef, closed: boolean, answer: () => Promise<T>): Promise<T> {
  if (closed) await syncRoomBoards(call);
  const out = await answer();
  if (closed) void landRooms(call);
  return out;
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
    for (const seat of ended) await endSeat(o, callId, seat, workspaceCalls);
    if (changed) await tellRoom(o, row.room_name, callId, { call: true, log: false });
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
export const ROOMS_ON_NEW_BOARD = 'The rooms share a new board. The one that was open can’t take their frames.';

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
          await tellRoom(o, row.room_name, callId, { call: true, log: false });
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
        board = { ...board, open: { ...board.open, [MAIN_PLACE]: { workspaceId: made.workspaceId, documentId: made.documentId, by, vote: null } }, letIn: [...board.letIn, made.entry], ideas };
      }
      await save(o, c, callId, insteadOf !== null && made ? notice({ ...held.state, board }, LANDED_ELSEWHERE, 'info') : { ...held.state, board });
      return rest.length > 0;
    });
    if (made) void syncBoardSeats(call);
    await tellRoom(o, row.room_name, callId, { call: true, log: false });
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

/**
 * The call is over: each room's board it hadn't kept yet is kept now, for everyone invited, every one it can find
 * (`roomBoardsFound`), and rooms open as it ended land, on the board open in the main room while it's still the call's to write
 * on. Nothing is made for them now.
 */
export async function keepRoomBoards(o: Owner, callId: string, s: Pick<Stored, 'board' | 'workspace'>, invited: string[]): Promise<void> {
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
