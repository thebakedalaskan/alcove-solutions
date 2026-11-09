import { type BoardCheck, type CallState } from '@alcove/api';
import { tx, type Db } from '../../db';
import { ConflictError } from '../../errors';
import * as boards from './boards';
import { MeetingManifest } from '../meetings/service';
import { getItem } from '../../vault';
import { boardPlace } from './places';
import { readerInCall } from '../workspaces/access';
import { endSeat } from '../workspaces/service';
import { log } from '../../log';
import { hereIn, inPlaceOf, knownIn, type Viewer, whereIs } from './participants';
import { load, saveSettled, secondsIn, settle } from './state';
import { afterClosing, syncBoardSeats, syncRoomBoards } from './room-boards';
import { tellRoom } from './notifications';
import { view } from './read-model';

const clog = log.child({ component: 'calls' });

/**
 * Someone opens or closes a board, in two steps (`boards.prepare`), as everything about the call's workspace is: what reads or
 * changes a workspace, with nothing of the call held; then the call's row, held only to save what came of it, from the call as
 * it is then. Seats given meanwhile to someone taken out are taken back once it's let go, and anyone let in meanwhile is seated.
 */
export async function actOnBoard(v: Viewer, callId: string, a: boards.BoardAction): Promise<CallState> {
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
    await tellRoom(o, room, callId, { call: true, log: false });
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
export async function runOnBoard(v: Viewer, callId: string, a: boards.RunAction): Promise<CallState> {
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
    if (ran.tell) await tellRoom(o, room, callId, { call: true, log: false });
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
