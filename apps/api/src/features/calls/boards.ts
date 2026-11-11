/*
 * A board in a call (docs: Calls and recordings › A board in a call). A board is a workspace item. What's the call's is which
 * one is open in each part of it, and which boards it lets people into, kept in its sealed state (features/calls/space-state.ts): where
 * each is, who opened it or let people in, by their name, address and seat, and the seats it's been worked out for. What a
 * board is called, and who can open it, aren't kept: they're read from its workspace for each person every time, so someone
 * who loses one stops being told about it at once, and someone who can't open one is told nothing that names it.
 *
 * Nothing here decides who can open what: features/workspaces/access.ts does. `calls.ts` holds the call's row and says when to do
 * what; this is what's done. A live call comes first, so what touches a workspace is done with nothing of the call held, in
 * the workspace's own transaction, and the call's row is held only to save what came of it.
 *
 * A board's vote is kept with it in the call's state, because it's this session's: closing the board ends it, and a saved
 * board has none. Votes are kept here and nowhere else: each person is told their own, and nobody a count until the vote ends,
 * when everyone is told them all at once. Nothing about a vote is written to the board.
 */
import { MAIN_PLACE, firstName, type BoardCheck, type BoardTemplate, type BreakoutBoard, type CallAction, type CallBoard, type DocumentRole } from '@alcove/api';
import { roomFrameId } from '@alcove/board';
import type { Owner } from '../../context';
import { id128 } from '../../crypto';
import { exec, tx, type Db } from '../../db';
import { AppError, ConflictError, ForbiddenError, NotFoundError, notFound } from '../../errors';
import { publish } from '../../live/hub';
import { log, type LogContext } from '../../log';
import { findItem } from '../../vault';
import { profile } from '../account/account';
import type { Viewer } from './participants';
import { type BoardLetIn, type BoardVote, type CallBoards, type CallSpace, type Controller, type Landing, type OpenBoard, type RoomBoard } from './space-state';
import { boardClosed, boardPresentedOver, controllerOf, ending } from './workspace';
import { MeetingManifest } from '../meetings/service';
import { boardPlace, type Placing } from './places';
import {
  TREE_NOTICE, cantEdit, cantOpen, emailIndex, entriesOn, grant, heldBy, holdersOf, limitKey, organizerEdits, readerInCall, requireDocument, requireSharing, roleOf, saveState, seatIndex, seatsInStep,
  serverWorkspace, standingIn, trashOf, whoInCall, workspaceFor, workspaceForCall,
  type Grant, type HeldWorkspace, type Maker, type Reader, type Who, type Workspace, type WorkspaceAs
} from '../workspaces/access';
import { readDocument, writeDocument } from '../workspaces/documents';
import { addBoard } from '../workspaces/service';

const blog = log.child({ component: 'call-boards' });

/**
 * How many boards one call can let everyone into, the ones it made included: its sealed state is read on every request. It's
 * asked before a board is made, with nothing of the call held, so two made at once can take it one past.
 */
const MAX_BOARDS = 50;
/** A board's name is the call's, on one line. */
const nameOf = (title: string): string => title.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';

export type BoardAction = Extract<CallAction, { type: 'board-open' | 'board-close' }>;
export const isBoardAction = (a: CallAction): a is BoardAction => a.type === 'board-open' || a.type === 'board-close';

/** What the rules here read of a call: its boards, and what's presented, which a board opening mustn't take off anyone's stage. */
export interface Boarded extends Placing { board: CallBoards; removed: string[]; workspace: CallSpace }
/** Someone in the call, as a seat on a board names them. */
export interface Here { seat: string; name: string; email: string | null }

/* ---------- what each person is told ---------- */

/** Nothing open, and all that someone waiting to be let in is told. */
export const NO_BOARD: CallBoard = { open: null, timer: null, vote: null, ideas: [] };

/** What the part of the call someone's in says about who can see its board. */
const sealOf = (place: string): string => (place === MAIN_PLACE ? 'Sealed' : 'Sealed to this room');
/** Whether a board is a room's own, made for it or started there: everyone in the room works on it. */
const roomsOwn = (s: Boarded, documentId: string): boolean => roomBoardsOf(s.board).some((r) => r.documentId === documentId);
/**
 * The board open in the part of the call someone's in, as they may know it, with its vote for anyone who can open it.
 * One that's in Trash or gone has left the call for everyone, and comes back with it. One that can't be read reads as one they
 * can't open: a call doesn't depend on what's in a workspace, so nothing here can stop anyone reading the call. In a room on a
 * board every room shares, it says which frame is the room's.
 */
export async function shownTo(v: Viewer, s: Boarded, place: string): Promise<CallBoard> {
  const at = boardPlace(s, place);
  const open = s.board.open[at];
  if (!open) return NO_BOARD;
  const opener = s.people.findLast((j) => j.person === open.by.person && j.status === 'in');
  const seen = { openedBy: opener?.identity ?? null, canClose: open.by.person === v.pass.person || v.isOrganizer, seal: sealOf(at), frame: at === place ? null : roomFrameId(place) };
  const shut: CallBoard = { open: { workspaceId: null, documentId: null, name: null, role: null, ...seen, everyone: false }, timer: null, vote: null, ideas: [] };
  try {
    const w = await serverWorkspace(v.organizer, open.workspaceId);
    const item = w?.state.items[open.documentId];
    if (!w || !item || trashOf(w.state, open.documentId)) return NO_BOARD;
    const reader = await readerInCall(v);
    const holders = await holdersOf(v.organizer.pool, w.owner.ownerId, reader.principals);
    const role = roleOf(reader, standingIn(holders, reader), open.documentId, item);
    if (!role) return shut;
    // Everyone here can add to it while the call made it and it's still the call's to give, which is when someone new gets a seat;
    // a room's own board is everyone's in the room.
    const everyone = roomsOwn(s, open.documentId) || (s.board.letIn.some((e) => e.documentId === open.documentId && e.by === null) && await stillTheCalls(v.organizer, w, v.organizer.pool, open.documentId));
    // Ideas from the call are the call's to add (calls.ts), for whoever can add to the board.
    return { open: { workspaceId: open.workspaceId, documentId: open.documentId, name: item.name, role, ...seen, everyone }, timer: null, ...sessionFor(v, reader, s, open, role === 'edit'), ideas: [] };
  } catch (e) {
    blog.warn('board not read for someone in a call', { callId: v.pass.callId, err: e });
    return shut;
  }
}

/** The frames of the board open in a part of the call, by their titles, for ideas from the call to say which each fits. */
export async function framesOf(o: Owner, open: OpenBoard): Promise<{ id: string; title: string }[]> {
  const w = await serverWorkspace(o, open.workspaceId);
  if (!w?.state.items[open.documentId] || trashOf(w.state, open.documentId)) return [];
  return readDocument(w, open.documentId, 'frames', {});
}

/** The same address, whatever its case. */
const sameAddress = (a: string | null | undefined, b: string | null): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();
/**
 * Whether someone is whoever started something, as a vote counts people: the same person in the call, on any connection of
 * theirs; signed in, the same account, on any device.
 */
const isStarter = (v: Viewer, reader: Reader, by: Controller): boolean => by.person === v.pass.person || (reader.account !== undefined && sameAddress(reader.email, by.email));
/** Whether someone may stop what someone started: they started it, or they're the organizer. */
const startedBy = (v: Viewer, reader: Reader, by: Controller): boolean => isStarter(v, reader, by) || v.isOrganizer;
/** Whoever started something, on a connection or device of theirs, or the organizer, is in the call now: it's theirs to stop. */
const keeperHere = (s: Placing, by: Controller): boolean =>
  s.people.some((j) => j.status === 'in' && (j.person === by.person || j.role === 'host' || sameAddress(j.email, by.email)));
/**
 * Whether someone may end and clear the vote that `by` started: whoever started it, or the organizer. While neither of them is
 * in the call, anyone who can edit the board (`edits`) may, so no vote is left on with nobody to end it; once either is back,
 * it's theirs again.
 */
const mayFinish = (v: Viewer, reader: Reader, s: Placing, by: Controller, edits: boolean): boolean => startedBy(v, reader, by) || (edits && !keeperHere(s, by));
/** How many people have a vote in it. */
const votersOf = (vote: BoardVote): number => Object.values(vote.ballots).filter((b) => b.length > 0).length;
/** Each sticky's votes, once a vote has ended. */
function countsOf(vote: BoardVote): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sticky of Object.values(vote.ballots).flat()) counts[sticky] = (counts[sticky] ?? 0) + 1;
  return counts;
}
/**
 * A board's vote, as one person may know it: their own votes, and every count only once it's ended. Nobody is told how many have
 * voted, or who, while it's on; who started it is said, as who opened the board is, so everyone who can open the board is told a
 * vote started there, whether or not they have it open. `voter` is who they are to the vote (`limitKey`): their account when
 * they're signed in, so it's one set of votes on every device, else the person their pass names, as media counts a guest's
 * uploads. `edits`: they can edit the board.
 */
function sessionFor(v: Viewer, reader: Reader, s: Placing, open: OpenBoard, edits: boolean): Pick<CallBoard, 'vote'> {
  const { vote } = open;
  const mine = vote?.ballots[limitKey(reader)] ?? [];
  const starter = vote ? s.people.findLast((j) => j.person === vote.by.person && j.status === 'in') : undefined;
  return {
    vote: vote && {
      on: !vote.ended, frame: vote.frame, per: vote.per, left: Math.max(0, vote.per - mine.length), mine,
      results: vote.ended ? countsOf(vote) : {}, voters: vote.ended ? votersOf(vote) : 0, canEnd: mayFinish(v, reader, s, vote.by, edits),
      startedBy: starter?.identity ?? null
    }
  };
}

/* ---------- who may do what ---------- */

/** Guests can add to a board once it's open. Starting one, and asking what starting one would mean, is for anyone invited. */
export function requireStarter(v: Viewer, what: string): void {
  if (v.role === 'guest') throw new ForbiddenError('Guests can add to a board, but can’t start one.', { context: { callId: v.pass.callId, role: v.role, what }, level: 'info' });
}
/** A saved board is brought to the main room: a room's board is its own, and has to stay with the people in it. */
export function requireMainRoom(callId: string, place: string, what: string): void {
  if (place !== MAIN_PLACE) throw new ConflictError('Open a board from the main room.', { context: { callId, what } });
}

const noBoard = (documentId: string) => notFound('That board', { documentId });
/**
 * A saved board, for someone who could bring it to the call: one they can edit, in the workspace they say it's in, wherever
 * that is. `letIn`: and they may share it, which is the workspace's rule, so nobody gets past it through a call. Whatever they
 * can't reach is the same refusal, in the same words, as what isn't there: a workspace they can't open, a board that isn't in
 * the one named, and one they can only read.
 */
async function bringable(o: Owner, reader: Reader, workspaceId: string, documentId: string, need: { letIn: boolean; db: Db; lock?: 'change' | 'hold' | undefined }): Promise<Workspace> {
  try {
    const w = await workspaceFor(o, reader, workspaceId, need.db, need.lock);
    if (requireDocument(reader, w, documentId, 'edit').item.kind !== 'board') throw noBoard(documentId);
    if (need.letIn) requireSharing(reader, w, documentId);
    return w;
  } catch (e) {
    throw e instanceof NotFoundError ? noBoard(documentId) : e;
  }
}
const mayShare = (who: Who, w: WorkspaceAs, documentId: string): boolean => {
  try {
    requireSharing(who, w, documentId);
    return true;
  } catch (e) {
    if (e instanceof AppError && e.status < 500) return false;
    throw e;
  }
};

/** What the menu asks before a saved board opens: who in the call can't open it, and whether this person may let them in. */
export async function check(o: Owner, reader: Reader, x: { callId: string; place: string; here: Here[] }, workspaceId: string, documentId: string): Promise<BoardCheck> {
  requireMainRoom(x.callId, x.place, 'board-check');
  const w = await bringable(o, reader, workspaceId, documentId, { letIn: false, db: o.pool });
  const left = await cantOpen(w, o.pool, documentId, x.here.map((p) => ({ ...p, who: whoInCall(o, x.callId, p) })));
  return { cannot: left.map((p) => firstName(p.name)), mayLetIn: mayShare(reader, w, documentId) };
}

/* ---------- letting people in ---------- */

/** Whether a board hasn't been worked out for someone: not on the seat they're on now, and not as an address it went to. */
const unseen = (e: BoardLetIn, p: Here): boolean => !e.seen.includes(p.seat) && !(p.email !== null && e.seen.includes(p.email));
/**
 * Works a board out for everyone here it hasn't been yet: whoever it isn't open to gets a seat, which ends with the call. On
 * a board the call made that's whoever can't edit it, because everyone here works on it, unless someone chose otherwise. On a
 * saved one it's whoever can't open it, and what the workspace gives anyone else stays what they have. Someone the call knows
 * by address whose other connections it was worked out for is seated only as those seats stand: not at all if one was taken
 * back, at `read` if one is `read`, so a new tab never undoes what someone did to a seat. A guest is known only by the name
 * they typed, so a guest's new tab is someone new. `known` is everyone in the call who wasn't taken out of it, here now or not.
 * In the caller's transaction, which holds the workspace's row. Says which seats it gave, for whoever saves it to check them.
 */
async function letInHere(w: HeldWorkspace, db: Db, callId: string, entry: BoardLetIn, here: Here[], known: Here[]): Promise<{ entry: BoardLetIn; seats: string[] }> {
  const fresh = here.filter((p) => unseen(entry, p));
  if (!fresh.length) return { entry, seats: [] };
  const left = await (entry.by === null ? cantEdit : cantOpen)(w, db, entry.documentId, fresh.map((p) => ({ ...p, who: whoInCall(w.owner, callId, p) })));
  const earlierOf = (p: Here): Uint8Array[] => (p.email === null ? [] : known.filter((k) => k.email === p.email && k.seat !== p.seat && entry.seen.includes(k.seat)).map((k) => seatIndex(w.owner, callId, k.seat)));
  const indexes = left.flatMap(earlierOf);
  const entryOn = indexes.length ? await entriesOn(w, db, entry.documentId, indexes) : (): DocumentRole | undefined => undefined;
  const seated = left.flatMap((p) => {
    const earlier = earlierOf(p).map(entryOn);
    return earlier.includes(undefined) ? [] : [{ p, role: earlier.includes('read') ? 'read' as const : 'edit' as const }];
  });
  if (seated.length) await grant(w, db, entry.documentId, seated.map(({ p, role }): Grant => ({ kind: 'seat', callId, seat: p.seat, name: p.name, role })));
  return { entry: { ...entry, seen: [...entry.seen, ...fresh.map((p) => p.seat)] }, seats: seated.map(({ p }) => p.seat) };
}
/**
 * Seats given while the call's row wasn't held, to people taken out of the call meanwhile: theirs to take back once the row is
 * let go, as their removal does. `known` is everyone who wasn't taken out, as the call stands under its row.
 */
const removedFrom = (known: Here[], seats: string[]): string[] => seats.filter((seat) => !known.some((k) => k.seat === seat));
/** Whether someone who let people in still may: a seat outlives whoever gave it, but nobody new gets one in their name. */
async function stillShares(w: HeldWorkspace, db: Db, callId: string, by: Controller, documentId: string): Promise<boolean> {
  const who = whoInCall(w.owner, callId, by);
  return mayShare(who, await heldBy(w, db, who), documentId);
}
/**
 * Whether a board the call made is still the call's to give. Restricted, someone has decided who has it. And a call adds to a
 * workspace on its organizer's word alone, so that goes when they can't edit there.
 */
const stillTheCalls = async (o: Owner, w: HeldWorkspace, db: Db, documentId: string): Promise<boolean> =>
  w.state.items[documentId]?.restricted === false && organizerEdits(o, w, db, (await profile(o, db)).email);

/** What the call lets people into that has someone here it hasn't been worked out for. */
export const dueIn = (board: CallBoards, here: Here[]): BoardLetIn[] => board.letIn.filter((e) => here.some((p) => unseen(e, p)));
/** What working a board out for newcomers came to: the decision it went by, as it was, and as it is now, and the seats it gave. */
export interface Seated { from: BoardLetIn; next: BoardLetIn; seats: string[] }
/**
 * Everyone here who's new to one board the call lets people into, on the word of whoever decided that, if it still stands: in
 * the workspace's own transaction, with nothing of the call held. Undefined when there's nothing to do. What came of it is
 * saved with `withSeen`, under the call's row.
 */
export async function seatNewcomers(o: Owner, callId: string, documentId: string, board: CallBoards, here: Here[], known: Here[]): Promise<Seated | undefined> {
  const entry = dueIn(board, here).find((e) => e.documentId === documentId);
  if (!entry) return undefined;
  return tx(o.pool, async (db) => {
    const w = await serverWorkspace(o, entry.workspaceId, db, 'change');
    if (!w?.state.items[documentId] || trashOf(w.state, documentId)) return undefined;
    if (!(await (entry.by ? stillShares(w, db, callId, entry.by, documentId) : stillTheCalls(o, w, db, documentId)))) return undefined;
    const { entry: next, seats } = await letInHere(w, db, callId, entry, here, known);
    return { from: entry, next, seats };
  });
}
/**
 * Adds who a board has been worked out for to the call as it is now, under its row: only to the same decision, which a new one
 * replaces. Undefined when it was replaced meanwhile: what was given stays a seat like any other, and the new decision works
 * everyone out by its own lights.
 */
export function withSeen(board: CallBoards, done: Seated): CallBoards | undefined {
  const same = (e: BoardLetIn) => e.documentId === done.from.documentId && (e.by?.person ?? null) === (done.from.by?.person ?? null) && done.from.seen.every((x) => e.seen.includes(x));
  const now = board.letIn.find(same);
  if (!now) return undefined;
  const seen = [...new Set([...now.seen, ...done.next.seen])];
  return seen.length === now.seen.length ? board : { ...board, letIn: board.letIn.map((e) => (e === now ? { ...now, seen } : e)) };
}
/** The seats given to people taken out of the call while they were being given, as the call stands under its row. */
export const seatsToTakeBack = (known: Here[], done: Seated): string[] => removedFrom(known, done.seats);
/**
 * When a call ends, with nothing held and before its seats go: someone who joined the invite during it keeps a board the call
 * made by email, as everyone invited when it was made does, if it's still the call's to give. Their seats say what they keep:
 * every seat the board has been worked out for has to be there still, so one taken back in Share stays taken back however many
 * tabs they opened after, and one set to `read` stays `read`. `people` is everyone who wasn't taken out of the call: seats that
 * ended with that don't count, as letting someone back in starts afresh. An entry for their address is someone's decision, and
 * stays. One that can't be kept stops nothing else, and none of this is worth failing the end of a call.
 */
export async function keepForInvited(o: Owner, callId: string, meetingId: string, board: CallBoards, people: Here[]): Promise<void> {
  try {
    const made = board.letIn.filter((e) => e.by === null);
    const fromLink = new Set(made.length ? ((await findItem(o, o.pool, 'meeting', meetingId, MeetingManifest))?.manifest.addedFromLink ?? []).map((e) => e.toLowerCase()) : []);
    const late = [...new Set(people.flatMap((p) => (p.email && fromLink.has(p.email) ? [p.email] : [])))];
    for (const e of late.length ? made : []) {
      await tx(o.pool, async (c) => {
        const w = await serverWorkspace(o, e.workspaceId, c, 'change');
        if (!w?.state.items[e.documentId] || !(await stillTheCalls(o, w, c, e.documentId))) return;
        const seatsOf = (email: string) => people.filter((p) => p.email === email && e.seen.includes(p.seat)).map((p) => seatIndex(o, callId, p.seat));
        const entryOn = await entriesOn(w, c, e.documentId, [...late.flatMap(seatsOf), ...late.map((email) => emailIndex(o, email))]);
        const kept = late.flatMap((email): Grant[] => {
          const roles = seatsOf(email).map(entryOn);
          return !roles.length || roles.includes(undefined) || entryOn(emailIndex(o, email)) ? [] : [{ kind: 'email', email, role: roles.includes('read') ? 'read' : 'edit' }];
        });
        if (kept.length) await grant(w, c, e.documentId, kept);
      }).catch((err: unknown) => blog.warn('board not kept for someone invited', { callId, workspaceId: e.workspaceId, documentId: e.documentId, err }));
    }
  } catch (e) {
    blog.warn('boards not kept for people added during a call', { callId, err: e });
  }
}

/* ---------- what people do ---------- */

/** What a call is when someone does something about a board: read with nothing held, and read again under its row. */
export interface Changing<S extends Boarded> {
  v: Viewer; reader: Reader; callId: string;
  meeting: Pick<MeetingManifest, 'title' | 'guests' | 'addedFromLink'>;
  s: S;
  /** Where whoever's asking is in the call, and everyone there now. */
  place: string;
  inPlace: Here[];
  here: Here[];
  /** Everyone in the call who wasn't taken out of it, here now or not: what someone's other connections were given. */
  known: Here[];
  /** Whoever's asking, as a new board names them. */
  maker: Maker;
}
/**
 * What came of it: the call as it is now; the seats given to people taken out of the call meanwhile, for the caller to take back
 * once the call's row is let go; and what happened, to log once it's saved.
 */
export interface Changed<S> {
  s: S;
  ended: string[];
  done: { what: 'board opened'; workspaceId: string; documentId: string; made: boolean; letIn: boolean; invited: number; here: number } | { what: 'board closed'; workspaceId: string; documentId: string; presented: number };
}
/**
 * The change to what the call keeps, under its row, from the call as it is then. It never needs asking again: a board made and a
 * seat given stand whatever happened meanwhile, as they would have a moment earlier, and what it saves goes by the call as it is.
 */
export type Apply<S extends Boarded> = (y: Changing<S>) => Changed<S>;

const fullUp = (callId: string) => new ConflictError('This call has as many boards as it can take. Open one it already has.', { context: { callId, boards: MAX_BOARDS } });
/**
 * The call with a board open in the main room. The same board again keeps its vote, since the session on it carries on, and the
 * ideas from the call there; any other starts with neither, since those ideas were for the frames of what was open.
 */
const opening = <S extends Boarded>(s: S, open: Omit<OpenBoard, 'vote'>, letIn: BoardLetIn[] = s.board.letIn): S => {
  const was = s.board.open[MAIN_PLACE];
  const same = was !== undefined && was.documentId === open.documentId;
  const kept = { vote: was && same ? was.vote : null };
  const { [MAIN_PLACE]: _was, ...others } = s.board.ideas;
  return { ...s, board: { ...s.board, open: { ...s.board.open, [MAIN_PLACE]: { ...open, ...kept } }, letIn, ideas: same ? s.board.ideas : others } };
};

/** The call's home can't take a new board: its organizer can't edit there any more. */
const homeShut = (asOrganizer: boolean, callId: string, workspaceId: string) => new ConflictError(asOrganizer
  ? 'You can’t add to this call’s home any more. You can still open a board that’s saved.'
  : 'This call’s home can’t take a new board any more. You can still open one that’s saved.', { context: { callId, workspaceId } });

/** Everyone invited, as the call stands, but whoever came in from the link, and whoever was taken out and hasn't come back. */
function invitedNow(s: Boarded, meeting: Pick<MeetingManifest, 'guests' | 'addedFromLink'>, here: Here[]): string[] {
  const back = new Set(here.flatMap((p) => (p.email ? [p.email.toLowerCase()] : [])));
  const out = s.people.flatMap((j) => (j.email && s.removed.includes(j.person) && !back.has(j.email.toLowerCase()) ? [j.email] : []));
  const notNow = new Set([...(meeting.addedFromLink ?? []), ...out].map((e) => e.toLowerCase()));
  return meeting.guests.filter((e) => !notNow.has(e.toLowerCase()));
}

/**
 * Everyone on the invite as the call stands, whoever came in from the link included, but whoever was taken out and hasn't
 * come back: who a room's notes go to, and so who has its board once rooms close. Taking someone off the invite takes it back
 * (`offRoomBoards`).
 */
export function onInvite(s: Boarded, guests: string[], here: Here[]): string[] {
  const back = new Set(here.flatMap((p) => (p.email ? [p.email.toLowerCase()] : [])));
  const out = new Set(s.people.flatMap((j) => (j.email && s.removed.includes(j.person) && !back.has(j.email.toLowerCase()) ? [j.email.toLowerCase()] : [])));
  return guests.filter((e) => !out.has(e.toLowerCase()));
}

/** What the call needs to make its main board. `id`, when it's been taken for it under the call's row, makes it once. */
export interface MainBoardFor {
  o: Owner; callId: string; s: Boarded; meeting: Pick<MeetingManifest, 'title' | 'guests' | 'addedFromLink'>;
  here: Here[]; known: Here[]; maker: Maker; asOrganizer: boolean; id?: string | undefined;
}
/** A main board made: where, the decision it lets everyone in by, and the seats that gave. */
export interface MadeMain { w: HeldWorkspace; workspaceId: string; documentId: string; entry: BoardLetIn; seats: string[]; invited: number }
/**
 * The call's main board, made in the call's home, in the call's folder there, in the workspace's own transaction with nothing of
 * the call held, or `shut` when the home can't take it: its organizer can't edit there any more, and a call adds to a workspace
 * only while they can. Everyone invited has it by email, and anyone else here a seat.
 */
async function madeMain(m: MainBoardFor, workspaceId: string, folderId: string | null): Promise<MadeMain | 'shut'> {
  const { o, callId } = m;
  return tx(o.pool, async (c) => {
    const w = await serverWorkspace(o, workspaceId, c, 'change');
    if (!w) throw notFound('That workspace', { callId });
    if (!(await organizerEdits(o, w, c, (await profile(o, c)).email))) return 'shut';
    const there = m.id !== undefined && w.state.items[m.id] !== undefined;
    const documentId = await addBoard(w, c, nameOf(m.meeting.title), { by: m.maker, id: m.id }, folderId);
    const invited = invitedNow(m.s, m.meeting, m.here);
    if (invited.length && !there) await grant(w, c, documentId, invited.map((email): Grant => ({ kind: 'email', email, role: 'edit' })));
    const { entry, seats } = await letInHere(w, c, callId, { workspaceId, documentId, by: null, seen: invited.map((e) => e.toLowerCase()) }, m.here, m.known);
    return { w, workspaceId, documentId, entry, seats, invited: invited.length };
  });
}
/**
 * Makes the call's main board, as a new board from the board picker does (Board, or Share › A board, then New), and as rooms
 * sharing one board do when nothing they can share is open. One the home can't take is refused, in the words its asker is told.
 */
export async function makeMainBoard(m: MainBoardFor, workspaceId: string, folderId: string | null): Promise<MadeMain> {
  const made = await madeMain(m, workspaceId, folderId);
  if (made === 'shut') throw homeShut(m.asOrganizer, m.callId, workspaceId);
  return made;
}

/**
 * Whether whoever opened a board in the call can still edit it, as `w` has them: what the call writes on a board it didn't make
 * itself, a frame for each room or the rooms' boards coming back, it writes on their word, as it gives seats on it on the word
 * of whoever let people in (`stillShares`). `w` is held by the caller when the answer has to hold until it's written.
 */
async function stillEdits(w: HeldWorkspace, db: Db, callId: string, by: Controller, documentId: string): Promise<boolean> {
  const who = whoInCall(w.owner, callId, by);
  try {
    requireDocument(who, await heldBy(w, db, who), documentId, 'edit');
    return true;
  } catch (e) {
    if (e instanceof AppError && e.status < 500) return false;
    throw e;
  }
}
/**
 * The same, asked again in the transaction that writes to the board, with its workspace held: so the call writes nothing on a
 * board someone lost the moment before. `refused` is thrown when it doesn't hold, for the writer to tell from anything else.
 */
const stillEditing = (o: Owner, callId: string, at: { workspaceId: string; documentId: string; by: Controller }, refused: ConflictError) => async (c: Db): Promise<void> => {
  const w = await serverWorkspace(o, at.workspaceId, c, 'hold');
  if (!w || !(await stillEdits(w, c, callId, at.by, at.documentId))) throw refused;
};

/**
 * A new board in the call's home, in the call's folder there, whichever workspace everyone's viewing. The people invited get it by email, so it stays theirs through the note, and
 * anyone else here a seat. Someone on the invite because they were let in from the link has a seat too, for now: taking them out
 * of the call takes them off the invite, and a seat goes with them where an address wouldn't. `keepForInvited` sees to whoever's
 * still on it when the call ends. Nobody taken out of the call and still out is given what's opened after they went, though they
 * stay on the invite: what they had before, they keep, as they keep the note. An address it goes to is never given a seat too:
 * what someone does to that entry is theirs to do. It's all done in the workspace's own transaction, with nothing of the call
 * held; anyone let in before the call's row is taken is seated by `syncBoardSeats` after. Then it's filled from its template,
 * still before the call's row says it's open: until then nobody can know it's there, so whoever opens it finds its template on.
 * A board left as it started is still a board, so a fill that fails is said in the log and refuses nobody.
 */
async function prepareNew<S extends Boarded>(x: Changing<S>, template: BoardTemplate): Promise<Apply<S>> {
  const { v, s, callId, meeting } = x;
  const o = v.organizer;
  if (s.board.letIn.length >= MAX_BOARDS) throw fullUp(callId);
  const { workspaceId, folderId } = await workspaceForCall(o, { organizer: o, callId });
  const made = await makeMainBoard({ o, callId, s, meeting, here: x.here, known: x.known, maker: x.maker, asOrganizer: v.isOrganizer }, workspaceId, folderId);
  // Its template goes on before the call says it's open, so whatever reads it from then on, a browser or ideas from the call,
  // finds its frames. A board left as it started is still a board, so nothing about filling it is worth refusing the person who
  // opened it.
  await fillBoard(made.w, made.documentId, template).catch((e: unknown) => blog.warn('board not filled from its template', { callId, documentId: made.documentId, err: e }));
  const by = controllerOf(v, x.reader);
  return (y) => ({
    s: opening(y.s, { workspaceId, documentId: made.documentId, by }, [...y.s.board.letIn, made.entry]),
    ended: removedFrom(y.known, made.seats),
    done: { what: 'board opened', workspaceId, documentId: made.documentId, made: true, letIn: true, invited: made.invited, here: made.entry.seen.length }
  });
}

/* ---------- boards in breakout rooms ---------- */

/** How many boards a call can make for its rooms in all, however many times they open: its sealed state is read on every request. */
const MAX_ROOM_BOARDS = 64;
/** A room's board is named after its room. */
const roomBoardName = (room: string): string => nameOf(`${room} board`);
const roomsFull = (callId: string) => new ConflictError('This call has made as many boards for its rooms as it can.', { context: { callId, boards: MAX_ROOM_BOARDS } });

/**
 * Boards for rooms, made in the call's home with nothing of the call held: one each, named for it, restricted with nobody as its
 * creator. Nobody has one yet: who's in each room gets it from `syncRoomBoards`, once the call says the board is the room's.
 */
async function makeRoomBoards(o: Owner, callId: string, asOrganizer: boolean, rooms: { name: string }[]): Promise<{ w: HeldWorkspace; workspaceId: string; documentIds: string[] }> {
  const { workspaceId, folderId } = await workspaceForCall(o, { organizer: o, callId });
  return tx(o.pool, async (c) => {
    const w = await serverWorkspace(o, workspaceId, c, 'change');
    if (!w) throw notFound('That workspace', { callId });
    if (!(await organizerEdits(o, w, c, (await profile(o, c)).email))) throw homeShut(asOrganizer, callId, workspaceId);
    const documentIds: string[] = [];
    for (const r of rooms) {
      documentIds.push(await addBoard(w, c, roomBoardName(r.name), { by: null, room: { ownerId: o.ownerId, callId } }, folderId));
    }
    return { w, workspaceId, documentIds };
  });
}

/**
 * A new board started in a room, for the room alone: restricted, with nobody as its creator, so whoever started it has it only
 * while they're in the room, as everyone else there does. Everyone there gets it once it's open (`syncRoomBoards`).
 */
async function prepareInRoom<S extends Boarded>(x: Changing<S>, template: BoardTemplate): Promise<Apply<S>> {
  const { v, s, callId, place } = x;
  const room = s.breakouts.open?.rooms.find((r) => r.id === place);
  if (!room) throw new ConflictError('That room has closed.', { context: { callId } });
  if (s.board.rooms.length >= MAX_ROOM_BOARDS) throw roomsFull(callId);
  const made = await makeRoomBoards(v.organizer, callId, v.isOrganizer, [{ name: room.name }]);
  const documentId = made.documentIds[0] ?? '';
  // As a new board in the main room, its template goes on before the call says it's open.
  await fillBoard(made.w, documentId, template).catch((e: unknown) => blog.warn('board not filled from its template', { callId, documentId, err: e }));
  const by = controllerOf(v, x.reader);
  return (y) => {
    const still = y.s.breakouts.open?.rooms.some((r) => r.id === place) === true;
    const rooms = [...y.s.board.rooms, { workspaceId: made.workspaceId, documentId, room: place, kept: false }];
    // A room that closed meanwhile keeps nothing open; its board is kept for everyone invited all the same.
    const open = still ? { ...y.s.board.open, [place]: { workspaceId: made.workspaceId, documentId, by, vote: null } } : y.s.board.open;
    // Ideas from the call there were for whatever was open: they go with it.
    const { [place]: _was, ...ideas } = y.s.board.ideas;
    return {
      s: { ...y.s, board: { ...y.s.board, open, rooms, ideas } },
      ended: [],
      done: { what: 'board opened', workspaceId: made.workspaceId, documentId, made: true, letIn: false, invited: 0, here: x.inPlace.length }
    };
  };
}

/** What rooms opening with something to work on made, with nothing of the call held, for the call to save as they open. */
export interface RoomsReady {
  /** The rooms' ids, taken for them here. */
  ids: string[];
  /** A board each: where, by room. */
  each: { workspaceId: string; documentIds: string[] } | null;
  /** A main board made for rooms to share, when none they could share was open. */
  main: MadeMain | null;
  /** That board is in place of the one open in the main room, which can't take the rooms' frames: the call says so. */
  instead: boolean;
  /** Whoever opened the rooms, as what they made names them. */
  by: Controller;
}
/** Rooms opening, as `prepareRooms` reads them: who's going where (by seat, and by name), what's open in the main room now, and who's opening them. */
export interface RoomsPlan {
  rooms: { name: string; people: Here[] }[];
  board: BreakoutBoard;
  main: MainBoardFor;
  ids: string[];
  by: Controller;
}
/**
 * Rooms opening with a board each, or one board they share, in two steps as everything about a workspace is: this one, with
 * nothing of the call held, makes what's needed and seats whoever's going where; the call's row is held only to open the rooms.
 * A board each is restricted with nobody as its creator, so only the seats of whoever's in its room open it. A shared board is
 * the one open in the main room, while whoever opened it can still edit it, or a new one, as when nothing is open, with an
 * empty frame for each room put on it now so everyone lands on theirs. Whether the open one can take them is asked again as the
 * frames are written, with its workspace held, so they're never written on a board its opener lost a moment before.
 */
export async function prepareRooms(plan: RoomsPlan): Promise<RoomsReady> {
  const { o, callId } = plan.main;
  const filled = (w: HeldWorkspace, documentId: string) => fillBoard(w, documentId, plan.board.template).catch((e: unknown) => blog.warn('board not filled from its template', { callId, documentId, err: e }));
  if (plan.board.mode === 'each') {
    if (plan.main.s.board.rooms.length + plan.rooms.length > MAX_ROOM_BOARDS) throw roomsFull(callId);
    const made = await makeRoomBoards(o, callId, plan.main.asOrganizer, plan.rooms);
    // Each is filled before the rooms open, so everyone arrives to its frames.
    await Promise.all(made.documentIds.map((documentId) => filled(made.w, documentId)));
    return { ids: plan.ids, each: { workspaceId: made.workspaceId, documentIds: made.documentIds }, main: null, instead: false, by: plan.by };
  }
  if (plan.board.mode !== 'shared') return { ids: plan.ids, each: null, main: null, instead: false, by: plan.by };
  const open = plan.main.s.board.open[MAIN_PLACE];
  let main: MadeMain | null = null;
  let onto: { w: HeldWorkspace; documentId: string; by: Controller | null };
  const w = open ? await serverWorkspace(o, open.workspaceId) : undefined;
  if (open && (!w?.state.items[open.documentId] || trashOf(w.state, open.documentId))) throw new ConflictError('The board that was open has gone. Open rooms again.', { context: { callId } });
  if (open && w && await stillEdits(w, o.pool, callId, open.by, open.documentId)) {
    onto = { w, documentId: open.documentId, by: open.by };
  } else {
    if (plan.main.s.board.letIn.length >= MAX_BOARDS) throw fullUp(callId);
    const { workspaceId, folderId } = await workspaceForCall(o, { organizer: o, callId });
    main = await makeMainBoard(plan.main, workspaceId, folderId);
    onto = { w: main.w, documentId: main.documentId, by: null };
    await filled(main.w, main.documentId);
  }
  const who = (people: Here[]) => people.map((p) => firstName(p.name));
  const refused = new ConflictError('The board that was open can’t take the rooms’ frames any more. Open rooms again.', { context: { callId } });
  const holding = onto.by ? stillEditing(o, callId, { workspaceId: onto.w.workspaceId, documentId: onto.documentId, by: onto.by }, refused) : undefined;
  await writeDocument(onto.w, onto.documentId, 'roomFrames', { kind: 'board', rooms: plan.rooms.map((r, k) => ({ id: plan.ids[k] ?? '', name: r.name, who: who(r.people) })) }, { callId, holding });
  return { ids: plan.ids, each: null, main, instead: open !== undefined && main !== null, by: plan.by };
}

/**
 * Rooms that didn't open after all (the call moved on before its row was held): the boards made for them have nobody, so
 * nobody's seated on them. A board made for rooms to share is an ordinary one, saved like any other.
 */
export async function dropRoomsReady(o: Owner, callId: string, ready: RoomsReady): Promise<void> {
  const each = ready.each;
  if (!each) return;
  await tx(o.pool, async (c) => {
    const w = await serverWorkspace(o, each.workspaceId, c, 'change');
    if (!w) return;
    for (const documentId of each.documentIds) await seatsInStep(w, c, documentId, callId, [], 'edit');
  }).catch((err: unknown) => blog.warn('boards for rooms that didn’t open not let go of', { callId, err }));
}

/**
 * Every board the call made for its rooms or that was started in one, as the call keeps them (`board.rooms`), and any board open
 * in a room that a save by a release that didn't know rooms' boards left out of them: only a room's own board ever opens in one.
 */
export function roomBoardsOf(board: Pick<CallBoards, 'rooms' | 'open'>): RoomBoard[] {
  const known = new Set(board.rooms.map((r) => r.documentId));
  const lost = Object.entries(board.open).flatMap(([room, b]): RoomBoard[] => (room !== MAIN_PLACE && !known.has(b.documentId) ? [{ workspaceId: b.workspaceId, documentId: b.documentId, room, kept: false }] : []));
  return lost.length ? [...board.rooms, ...lost] : board.rooms;
}

/**
 * Rooms closing, under the call's row as it saves them: what was open in them closes, what was said in them as ideas for their
 * boards goes with them, and every board made for them comes back to the main room, landing as a frame each once the row's let
 * go (`landing`): on the board open there, or a new one, made once, whose id is taken now. `who` is the first names of whoever
 * was in each room. A call with nothing of its rooms' to land has none. A board open in a room that the call had lost track of
 * (`roomBoardsOf`) is kept with the rest from now on.
 */
export function roomsClosed<S extends Boarded>(s: S, closed: { id: string; name: string; who: string[] }[], home: string | null, newId: () => string): S {
  const gone = new Set(closed.map((r) => r.id));
  const rooms = roomBoardsOf(s.board);
  const open = Object.fromEntries(Object.entries(s.board.open).filter(([place]) => !gone.has(place)));
  const ideas = Object.fromEntries(Object.entries(s.board.ideas).filter(([place]) => !gone.has(place)));
  const coming = closed.flatMap((r) => {
    const board = rooms.findLast((b) => b.room === r.id);
    return board ? [{ room: r.id, workspaceId: board.workspaceId, documentId: board.documentId, name: r.name, who: r.who }] : [];
  });
  const was = s.board.landing;
  const main = open[MAIN_PLACE];
  const into = was?.into ?? (main ? { workspaceId: main.workspaceId, documentId: main.documentId } : { workspaceId: home ?? coming[0]?.workspaceId ?? '', documentId: newId() });
  const landing: Landing | null = coming.length ? { rooms: [...(was?.rooms ?? []), ...coming], into, make: was ? was.make : !main, until: was?.until ?? 0, tries: was?.tries ?? 0 } : was;
  return { ...s, board: { ...s.board, open, ideas, rooms, landing } };
}

/** What a room's board needs now: whether its room is open and who's in it, and once it's closed, who gets it by address. */
export interface RoomNow { open: boolean; seats: Here[]; invited: string[] }
/**
 * Puts one room's board in step with the call, in the workspace's own transaction: the call is read under the workspace's lock
 * (`now`), so the last of several running at once goes by the latest. While its room is open, the seats of whoever's in it, and
 * nobody else's, the organizer's only while they're visiting, and the tree says it's this call's room's (`StoredItem.room`), so
 * nothing strands it meanwhile, even after a release that didn't know that saved the tree without it. Once it's closed no seats,
 * and everyone invited has it by address, as the people its room's notes go to do, unless they have an entry on it already:
 * then it's kept, and a restricted board like any other. Says what changed, and whether it's kept.
 */
export async function roomInStep(o: Owner, callId: string, board: Pick<RoomBoard, 'workspaceId' | 'documentId'>, now: (db: Db) => Promise<RoomNow>): Promise<{ changed: number; kept: boolean }> {
  return tx(o.pool, async (c) => {
    const w = await serverWorkspace(o, board.workspaceId, c, 'change');
    const item = w?.state.items[board.documentId];
    if (!w || !item) return { changed: 0, kept: true };
    const at = await now(c);
    const changed = await seatsInStep(w, c, board.documentId, callId, at.open ? at.seats : [], 'edit');
    const room = at.open ? { ownerId: o.ownerId, callId } : null;
    if (item.room?.ownerId !== room?.ownerId || item.room?.callId !== room?.callId) {
      await saveState({ ...w, state: { ...w.state, items: { ...w.state.items, [board.documentId]: { ...item, room } } } }, c);
      await publish(c, w.workspaceId, TREE_NOTICE);
    }
    if (at.open) return { changed, kept: false };
    const has = await entriesOn(w, c, board.documentId, at.invited.map((e) => emailIndex(o, e)));
    const giving = at.invited.filter((e) => has(emailIndex(o, e)) === undefined);
    if (giving.length) await grant(w, c, board.documentId, giving.map((email): Grant => ({ kind: 'email', email, role: 'edit' })));
    return { changed: changed + giving.length, kept: true };
  });
}

/**
 * What a call taking someone off its invite takes from its rooms' boards: what they had by address, as they don't get the
 * room's notes any more. In each board's workspace's own transaction, with nothing of the call held.
 */
export async function offRoomBoards(o: Owner, board: CallBoards, emails: string[]): Promise<void> {
  if (!emails.length) return;
  for (const b of board.rooms.filter((r) => r.kept)) {
    await tx(o.pool, async (c) => {
      const w = await serverWorkspace(o, b.workspaceId, c, 'change');
      if (!w?.state.items[b.documentId]) return;
      await exec(c, "DELETE FROM document_access WHERE owner_id = $1 AND document_id = $2 AND kind = 'email' AND principal_index = ANY($3::bytea[])", [w.owner.ownerId, b.documentId, emails.map((e) => Buffer.from(emailIndex(o, e)))]);
      await exec(c, 'UPDATE workspaces SET version = version + 1 WHERE owner_id = $1', [w.owner.ownerId]);
      await publish(c, w.workspaceId, TREE_NOTICE);
    }).catch((err: unknown) => blog.warn('a room’s board not taken back from someone off the invite', { workspaceId: b.workspaceId, documentId: b.documentId, err }));
  }
}

/** What landing rooms' boards came to. */
export type Landed =
  /** On the board it was for, made first if it had to be, or nothing of the rooms' was left to land. */
  | { kind: 'landed'; made: MadeMain | null }
  /** The board it was for isn't the call's to write on any more: they land on a new one in the call's home instead. */
  | { kind: 'elsewhere' }
  /** No board can be made for them: the call's home can't take a new one any more. */
  | { kind: 'shut' };
/**
 * Lands rooms' boards on the main board, with nothing of the call held: makes the main board first when there's none and
 * there's a call to make it for (`making`, with the id taken for it as rooms closed, so it's made once), then reads each room's
 * board and writes a frame for it in one update. Landing again changes nothing. A board the call didn't make for them is written
 * on only while it's still open in the main room (`opener` is whoever opened it there, null once it isn't) and they can still
 * edit it, as for the rooms' frames on a board they share: asked first, and again as it's written, with its workspace held.
 * Says the board it made, if it made one, for the call to open in the main room.
 */
export async function land(o: Owner, callId: string, l: Landing, making: { main: MainBoardFor; folderId: string | null } | null, opener: Controller | null): Promise<Landed> {
  let made: MadeMain | null = null;
  if (l.make) {
    if (!making) return { kind: 'landed', made: null };
    const m = await madeMain({ ...making.main, id: l.into.documentId }, l.into.workspaceId, making.folderId);
    if (m === 'shut') return { kind: 'shut' };
    made = m;
  }
  const into = made?.w ?? await serverWorkspace(o, l.into.workspaceId);
  if (!into || (!made && (!opener || !(await stillEdits(into, o.pool, callId, opener, l.into.documentId))))) return { kind: 'elsewhere' };
  const rooms: { key: string; name: string; who: string[]; state: Uint8Array }[] = [];
  for (const r of l.rooms) {
    const w = r.workspaceId === into.workspaceId ? into : await serverWorkspace(o, r.workspaceId);
    if (!w?.state.items[r.documentId] || trashOf(w.state, r.documentId)) continue;
    rooms.push({ key: r.room, name: r.name, who: r.who, state: await readDocument(w, r.documentId, 'state', {}) });
  }
  if (!rooms.length) return { kind: 'landed', made };
  const refused = new ConflictError('The board open in the main room can’t take the rooms’ boards any more.', { context: { callId } });
  const holding = !made && opener ? stillEditing(o, callId, { ...l.into, by: opener }, refused) : undefined;
  try {
    const { result } = await writeDocument(into, l.into.documentId, 'boardLand', { kind: 'board', rooms }, { callId, holding });
    blog.info('rooms’ boards landed', { callId, documentId: l.into.documentId, rooms: rooms.length, landed: result, made: made !== null });
  } catch (e) {
    if (e === refused) return { kind: 'elsewhere' };
    throw e;
  }
  return { kind: 'landed', made };
}

/**
 * A saved board. `letIn` is a new decision about everyone here, so it's worked out afresh, in the workspace's own transaction. A
 * board the call made stays the call's to give, whoever brings it back, for as long as it's the call's to give: past that it's on
 * this person's word. Without `letIn` nothing in the workspace changes, so it's only read.
 */
async function prepareSaved<S extends Boarded>(x: Changing<S>, workspaceId: string, documentId: string, letIn: boolean): Promise<Apply<S>> {
  const { v, reader, s, callId } = x;
  const o = v.organizer;
  const by = controllerOf(v, reader);
  const there = s.board.letIn.find((e) => e.documentId === documentId);
  if (letIn && !there && s.board.letIn.length >= MAX_BOARDS) throw fullUp(callId);
  if (!letIn) {
    await bringable(o, reader, workspaceId, documentId, { letIn: false, db: o.pool });
    return (y) => ({ s: opening(y.s, { workspaceId, documentId, by }), ended: [], done: { what: 'board opened', workspaceId, documentId, made: false, letIn: false, invited: 0, here: 0 } });
  }
  const r = await tx(o.pool, async (c) => {
    const w = await bringable(o, reader, workspaceId, documentId, { letIn: true, db: c, lock: 'change' });
    const decided = there?.by === null && await stillTheCalls(o, w, c, documentId) ? null : by;
    return { workspaceId: w.workspaceId, ...await letInHere(w, c, callId, { workspaceId: w.workspaceId, documentId, by: decided, seen: [] }, x.here, x.known) };
  });
  return (y) => ({
    s: opening(y.s, { workspaceId: r.workspaceId, documentId, by }, [...y.s.board.letIn.filter((e) => e.documentId !== documentId), r.entry]),
    ended: removedFrom(y.known, r.seats),
    done: { what: 'board opened', workspaceId: r.workspaceId, documentId, made: false, letIn: true, invited: 0, here: r.entry.seen.length }
  });
}

/**
 * Whoever opened it, or the organizer. It closes for everyone there, and that's all: seats stay until the call ends, because
 * people may open it again. In a room on a board every room shares, that's the main room's board. Nobody but the organizer closes
 * it while someone else presents it, as nobody opens a board over theirs (`stageFree`); presented, its presentation ends for
 * everyone too, said at once (`boardClosed`).
 */
function closing<S extends Boarded>(y: Changing<S>): Changed<S> {
  const { v, s, callId } = y;
  const place = boardPlace(s, y.place);
  const open = s.board.open[place];
  if (!open) throw new ConflictError('No board is open here.', { context: { callId } });
  if (open.by.person !== v.pass.person && !v.isOrganizer) throw new ForbiddenError('Only whoever opened this board, or the organizer, can close it.', { context: { callId, role: v.role } });
  if (!v.isOrganizer && boardPresentedOver(s, place, v.pass.person, null)) throw new ConflictError('Someone else is presenting this board. You can close it once they stop.', { context: { callId } });
  const out = boardClosed(s, place, ending(v.organizer, callId), { person: v.pass.person, organizer: v.isOrganizer });
  const presented = s.workspace.present.length - out.workspace.present.length;
  return { s: out, ended: [], done: { what: 'board closed', workspaceId: open.workspaceId, documentId: open.documentId, presented } };
}

/**
 * Nobody makes or brings in a board while someone else presents one where it would open: it would take theirs off everyone's
 * stage. Bringing in the board that's presented (`keeping`) takes nothing off. The call already tells everyone who's presenting,
 * so this names nobody.
 */
function stageFree<S extends Boarded>(y: Changing<S>, keeping: string | null): void {
  if (boardPresentedOver(y.s, y.place, y.v.pass.person, keeping)) throw new ConflictError('Someone else is presenting a board here. You can start one once they stop.', { context: { callId: y.callId, place: y.place === MAIN_PLACE ? 'main' : 'room' } });
}

/**
 * Whatever someone does about a board, in two steps, because a live call comes first: nothing under the call's row waits on a
 * workspace's lock or opens one. This is the first, with nothing of the call held: who may, whether what's asked for opens, and
 * what changes in the workspace, in a transaction of its own. What it returns is the second (`Apply`). What's refused whatever
 * happens is refused first, so a guest, or someone in a breakout room, settles nothing.
 */
export async function prepare<S extends Boarded>(x: Changing<S>, a: BoardAction): Promise<Apply<S>> {
  if (a.type === 'board-close') return closing;
  if (!('template' in a)) requireMainRoom(x.callId, x.place, a.type);
  // Asked before anything is made, and again under the call's row, as someone may have started presenting meanwhile.
  const keeping = 'template' in a ? null : a.documentId;
  stageFree(x, keeping);
  const apply = 'template' in a ? await (x.place === MAIN_PLACE ? prepareNew(x, a.template) : prepareInRoom(x, a.template)) : await prepareSaved(x, a.workspaceId, a.documentId, a.letIn);
  return (y) => { stageFree(y, keeping); return apply(y); };
}

/* ---------- the session on a board: its vote ---------- */

export type RunAction = Extract<CallAction, { type: 'board-vote' }>;
export const isRunAction = (a: CallAction): a is RunAction => a.type === 'board-vote';

/** What a call is when someone runs the session on its board: read with nothing held, and read again under its row. */
export interface Running<S extends Boarded> { v: Viewer; reader: Reader; callId: string; s: S; place: string }
/**
 * What came of it: the call as it is now, which is the call as it was when nothing changed; whether everyone where the board is
 * reads the call again, which a vote cast or taken back never has them do, so nobody can count votes by when the call changes;
 * and what happened, to log once it's saved.
 */
export interface Ran<S> { s: S; changed: boolean; tell: boolean; done: { what: string; quiet: boolean; context: LogContext } }
/** The change to what the call keeps, under its row, from the call as it is then: it asks again whatever could have moved. */
export type ApplyRun<S extends Boarded> = (y: Running<S>) => Ran<S>;

const nothingOpen = (callId: string) => new ConflictError('No board is open here.', { context: { callId } });
const noVote = (callId: string) => new ConflictError('There’s no vote on this board.', { context: { callId } });
const voteEnded = (callId: string) => new ConflictError('This vote has ended.', { context: { callId } });
const noVotesLeft = (callId: string, per: number) => new ConflictError('You’ve used all your votes. Take one back to vote for this.', { context: { callId, per } });
const withOpen = <S extends Boarded>(y: Running<S>, open: OpenBoard): S => ({ ...y.s, board: { ...y.s.board, open: { ...y.s.board.open, [y.place]: open } } });
const unchanged = <S extends Boarded>(y: Running<S>, what: string): Ran<S> => ({ s: y.s, changed: false, tell: false, done: { what, quiet: true, context: { callId: y.callId, changed: false } } });
/** The board open here under the call's row, if it's still the one this was worked out for. */
function stillOpen<S extends Boarded>(y: Running<S>, documentId: string): OpenBoard {
  const open = y.s.board.open[y.place];
  if (!open) throw nothingOpen(y.callId);
  if (open.documentId !== documentId) throw new ConflictError('That board isn’t open here any more.', { context: { callId: y.callId } });
  return open;
}
/** The vote this was worked out for, under the call's row, while it's still open. */
function stillVoting<S extends Boarded>(y: Running<S>, documentId: string, voteId: string): { open: OpenBoard; vote: BoardVote } {
  const open = stillOpen(y, documentId);
  const vote = open.vote;
  if (!vote || vote.id !== voteId || vote.ended) throw voteEnded(y.callId);
  return { open, vote };
}

/**
 * Of the stickies a vote had votes for when it was asked to end, the ones still in it: on the board, inside its frame. A sticky
 * deleted, or moved out of the frame, since its votes were cast counts for nothing.
 */
interface StillIn { voteId: string; asked: ReadonlySet<string>; kept: ReadonlySet<string> }
/** Every voter's votes that still count: for a sticky still in the vote, or one cast since it was asked, which was checked then. */
function counted(ballots: Record<string, string[]>, still: StillIn): Record<string, string[]> {
  return Object.fromEntries(Object.entries(ballots).map(([voter, ids]) => [voter, ids.filter((id) => !still.asked.has(id) || still.kept.has(id))]));
}

/**
 * Ends the vote, so everyone is told every count at once, or clears its results after: whoever started it, or the organizer, or
 * with neither of them here anyone who can edit the board (`edits`, the board found to be theirs to edit). Ending keeps only the
 * votes for stickies still in the vote (`still`). Ending one that's ended, or clearing one that's gone, changes nothing.
 */
function finishVote<S extends Boarded>(y: Running<S>, step: 'end' | 'done', edits: string | null, still: StillIn | null): Ran<S> {
  const open = y.s.board.open[y.place];
  if (!open) throw nothingOpen(y.callId);
  const vote = open.vote;
  if (!vote) {
    if (step === 'done') return unchanged(y, 'board vote cleared');
    throw noVote(y.callId);
  }
  if (!mayFinish(y.v, y.reader, y.s, vote.by, edits === open.documentId)) {
    throw new ForbiddenError(step === 'end' ? 'Only whoever started the vote, or the organizer, can end it.' : 'Only whoever started the vote, or the organizer, can clear it.', { context: { callId: y.callId, role: y.v.role, step }, level: 'info' });
  }
  if (step === 'end') {
    if (vote.ended) return unchanged(y, 'board vote ended');
    const ballots = still?.voteId === vote.id ? counted(vote.ballots, still) : vote.ballots;
    const ended = { ...vote, ballots, ended: true };
    return { s: withOpen(y, { ...open, vote: ended }), changed: true, tell: true, done: { what: 'board vote ended', quiet: false, context: { callId: y.callId, voters: votersOf(ended), per: vote.per } } };
  }
  if (!vote.ended) throw new ConflictError('End the vote first.', { context: { callId: y.callId } });
  return { s: withOpen(y, { ...open, vote: null }), changed: true, tell: true, done: { what: 'board vote cleared', quiet: false, context: { callId: y.callId } } };
}

/** The board open where someone is, as the workspace has it for them: the same for every step that runs its session. */
interface Reached { open: OpenBoard; w: Workspace }
/**
 * The board open here, for someone who can open it. Whether they can is the workspace's to say, so it's asked with nothing of the
 * call held, before anything about its vote: someone it isn't open to is told what they'd be told of a board that isn't there,
 * whatever is running on it, so no refusal says whether a vote is on.
 */
async function reaching<S extends Boarded>(x: Running<S>): Promise<Reached> {
  const open = x.s.board.open[x.place];
  if (!open) throw nothingOpen(x.callId);
  const w = await workspaceFor(x.v.organizer, x.reader, open.workspaceId);
  requireDocument(x.reader, w, open.documentId, 'read');
  return { open, w };
}

/** Anyone who can edit a board can run its session: who they are, as what they start says. Someone who can only read it is told so. */
function editingIt<S extends Boarded>(x: Running<S>, r: Reached): Controller {
  requireDocument(x.reader, r.w, r.open.documentId, 'edit');
  return controllerOf(x.v, x.reader);
}

/**
 * Whether someone can edit the board, asked only when that's what decides whether they may end the vote there: they didn't start
 * it and aren't the organizer, and neither of those is in the call. So whoever started it and the organizer can end it on a
 * board they can only read. Someone who can't edit it is told why. The board they can edit, or null.
 */
function editsWithNobodyHere<S extends Boarded>(x: Running<S>, r: Reached, by: Controller | undefined): string | null {
  if (!by || startedBy(x.v, x.reader, by) || keeperHere(x.s, by)) return null;
  editingIt(x, r);
  return r.open.documentId;
}

/** A vote on a frame of the board, or on every sticky with no frame, never on top of another. */
async function prepareVote<S extends Boarded>(x: Running<S>, r: Reached, frame: string | null, per: number): Promise<ApplyRun<S>> {
  const by = editingIt(x, r);
  const { documentId } = r.open;
  if (r.open.vote) throw new ConflictError('There’s a vote on this board already.', { context: { callId: x.callId } });
  if (frame !== null && !(await readDocument(r.w, documentId, 'voteOn', { frame, sticky: null })).frame) throw new ConflictError('That frame isn’t on this board.', { context: { callId: x.callId } });
  return (y) => {
    const open = stillOpen(y, documentId);
    if (open.vote) throw new ConflictError('There’s a vote on this board already.', { context: { callId: y.callId } });
    const vote: BoardVote = { id: id128(), frame, per, by, ballots: {}, ended: false };
    return { s: withOpen(y, { ...open, vote }), changed: true, tell: true, done: { what: 'board vote started', quiet: false, context: { callId: y.callId, per, onFrame: frame !== null } } };
  };
}

/** The vote open now, for someone voting in it: refused whatever the board says once it's gone or ended. */
function voting(r: Reached, callId: string): BoardVote {
  const { vote } = r.open;
  if (!vote) throw noVote(callId);
  if (vote.ended) throw voteEnded(callId);
  return vote;
}

/**
 * A vote for a sticky the vote is on, one a sticky, while this person has votes left. The board is asked every time, a sticky
 * already voted for included: a take-back from another device can land first, and what's cast then must still be in the vote.
 * Only they're told: the call isn't read again by anyone else, so nobody can count votes as they're cast.
 */
async function prepareCast<S extends Boarded>(x: Running<S>, r: Reached, sticky: string): Promise<ApplyRun<S>> {
  const vote = voting(r, x.callId);
  const voter = limitKey(x.reader);
  const mine = vote.ballots[voter] ?? [];
  if (!mine.includes(sticky) && mine.length >= vote.per) throw noVotesLeft(x.callId, vote.per);
  editingIt(x, r);
  const { documentId } = r.open;
  if (!(await readDocument(r.w, documentId, 'voteOn', { frame: vote.frame, sticky })).sticky) throw new ConflictError('That sticky isn’t part of this vote.', { context: { callId: x.callId } });
  return (y) => {
    const { open, vote: now } = stillVoting(y, documentId, vote.id);
    const theirs = now.ballots[voter] ?? [];
    if (theirs.includes(sticky)) return unchanged(y, 'board vote cast');
    if (theirs.length >= now.per) throw noVotesLeft(y.callId, now.per);
    const ballots = { ...now.ballots, [voter]: [...theirs, sticky] };
    return { s: withOpen(y, { ...open, vote: { ...now, ballots } }), changed: true, tell: false, done: { what: 'board vote cast', quiet: true, context: { callId: y.callId } } };
  };
}

/** Takes a vote back, while the vote is on. Taking back one that isn't there changes nothing. */
function prepareTakeBack<S extends Boarded>(x: Running<S>, r: Reached, sticky: string): ApplyRun<S> {
  const vote = voting(r, x.callId);
  const voter = limitKey(x.reader);
  editingIt(x, r);
  const { documentId } = r.open;
  return (y) => {
    const { open, vote: now } = stillVoting(y, documentId, vote.id);
    const theirs = now.ballots[voter] ?? [];
    if (!theirs.includes(sticky)) return unchanged(y, 'board vote taken back');
    const ballots = { ...now.ballots, [voter]: theirs.filter((id) => id !== sticky) };
    return { s: withOpen(y, { ...open, vote: { ...now, ballots } }), changed: true, tell: false, done: { what: 'board vote taken back', quiet: true, context: { callId: y.callId } } };
  };
}

/**
 * Ending a vote: who may (`mayFinish`), and of the stickies it has votes for, which are still in it, read from the board by
 * whoever may end it. With nothing to ask, nothing is read.
 */
async function prepareEnd<S extends Boarded>(x: Running<S>, r: Reached): Promise<ApplyRun<S>> {
  const { vote, documentId } = r.open;
  const edits = editsWithNobodyHere(x, r, vote?.by);
  const asked = vote && !vote.ended && mayFinish(x.v, x.reader, x.s, vote.by, edits === documentId) ? [...new Set(Object.values(vote.ballots).flat())] : [];
  const kept = vote && asked.length ? await readDocument(r.w, documentId, 'stillInVote', { frame: vote.frame, stickies: asked }) : [];
  const still: StillIn | null = vote && asked.length ? { voteId: vote.id, asked: new Set(asked), kept: new Set(kept) } : null;
  return (y) => finishVote(y, 'end', edits, still);
}

/**
 * Whatever someone does to run a vote on a board, in two steps, as everything about a board is. This is the first, with nothing
 * of the call held: whether they can open the board at all, before anything about a vote, then whether they can edit it, which is
 * the workspace's to say, and what's on the board, which is read in a worker as everything in a document is. Ending and clearing
 * are whoever started it's or the organizer's, and need neither; only while neither is in the call does anyone else's need the
 * board. What it returns is the second, under the call's row, which asks again whatever could have changed meanwhile, who's in
 * the call included. Nothing here logs a frame or a sticky, nor who voted for what.
 */
export async function prepareRun<S extends Boarded>(x: Running<S>, a: RunAction): Promise<ApplyRun<S>> {
  const r = await reaching(x);
  switch (a.step) {
    case 'start': return prepareVote(x, r, a.frame, a.per);
    case 'cast': return prepareCast(x, r, a.sticky);
    case 'take-back': return prepareTakeBack(x, r, a.sticky);
    case 'end': return prepareEnd(x, r);
    case 'done': {
      const edits = editsWithNobodyHere(x, r, r.open.vote?.by);
      return (y) => finishVote(y, 'done', edits, null);
    }
  }
}

/**
 * Fills a new board from its template, through its log like any change, so whoever has it open sees it arrive, everyone gets the
 * same frames and nobody's undo can take them away. It's the server's, written once however often it's asked, with the board's
 * id as its seed, and only on a board nobody has put anything on yet (documentOps.ts's `boardTemplate`). Blank writes nothing.
 */
async function fillBoard(w: HeldWorkspace, documentId: string, template: BoardTemplate): Promise<void> {
  await writeDocument(w, documentId, 'boardTemplate', { kind: 'board', template, seed: documentId });
}
