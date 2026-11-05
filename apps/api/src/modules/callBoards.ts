/*
 * A board in a call (docs: Calls and recordings › A board in a call). A board is a workspace item. What's the call's is which
 * one is open in each part of it, and which boards it lets people into, kept in its sealed state (modules/callSpace.ts) as IDs
 * and nothing else. What a board is called, and who can open it, are read from its workspace for each person every time, so
 * someone who loses one stops being told about it at once, and someone who can't open one is told nothing that names it.
 *
 * Nothing here decides who can open what: modules/workspaceAccess.ts does. `calls.ts` holds the call's row and says when to do
 * what; this is what's done.
 */
import { MAIN_PLACE, firstName, type BoardCheck, type BoardTemplate, type CallAction, type CallBoard } from '@alcove/api';
import type { Deps, Owner } from '../context';
import { tx, type Db } from '../db';
import { AppError, ConflictError, ForbiddenError, NotFoundError, notFound } from '../errors';
import { log } from '../log';
import { findItem } from '../vault';
import { profile } from './account';
import type { Viewer } from './calls';
import type { BoardLetIn, CallBoards, Controller, OpenBoard } from './callSpace';
import { controllerOf, placeOfBrought } from './callWorkspace';
import { MeetingManifest } from './meetings';
import type { Placing } from './places';
import {
  cantOpen, grant, holdersOf, readerInCall, requireDocument, requireOrganizerEdits, requireSharing, roleOf, seatIndex, serverWorkspace, standingIn, trashOf, whoInCall, workspaceFor,
  type Grant, type HeldWorkspace, type Maker, type Reader, type Who, type Workspace
} from './workspaceAccess';
import { addBoard } from './workspaces';

const blog = log.child({ component: 'call-boards' });

/** How many boards one call can let everyone into, the ones it made included: its sealed state is read on every request. */
const MAX_BOARDS = 50;
/** A board's name is the call's, on one line. */
const nameOf = (title: string): string => title.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';

export type BoardAction = Extract<CallAction, { type: 'board-open' | 'board-close' }>;
export const isBoardAction = (a: CallAction): a is BoardAction => a.type === 'board-open' || a.type === 'board-close';

/** What the rules here read of a call. */
export interface Boarded extends Placing { board: CallBoards }
/** Someone in the call, as a seat on a board names them. */
export interface Here { seat: string; name: string; email: string | null }

/* ---------- what each person is told ---------- */

/** Nothing open, and all that someone waiting to be let in is told. */
export const NO_BOARD: CallBoard = { open: null };

/** What the part of the call someone's in says about who can see its board. */
const sealOf = (place: string): string => (place === MAIN_PLACE ? 'Sealed' : 'Sealed to this room');
/**
 * The board open in the part of the call someone's in, as they may know it. One that's in Trash or gone has left the call for
 * everyone, and comes back with it. One that can't be read reads as one they can't open: a call doesn't depend on what's in a
 * workspace, so nothing here can stop anyone reading the call.
 */
export async function shownTo(v: Viewer, s: Boarded, place: string): Promise<CallBoard> {
  const open = s.board.open[place];
  if (!open) return NO_BOARD;
  const opener = s.people.findLast((j) => j.person === open.by.person && j.status === 'in');
  const seen = { openedBy: opener?.identity ?? null, canClose: open.by.person === v.pass.person || v.isOrganizer, seal: sealOf(place) };
  const shut: CallBoard = { open: { workspaceId: null, documentId: null, name: null, role: null, ...seen } };
  try {
    const w = await serverWorkspace(v.organizer, open.workspaceId);
    const item = w?.state.items[open.documentId];
    if (!w || !item || trashOf(w.state, open.documentId)) return NO_BOARD;
    const reader = await readerInCall(v);
    const holders = await holdersOf(v.organizer.pool, w.owner.ownerId, reader.principals);
    const role = roleOf(reader, standingIn(holders, reader), open.documentId, item);
    return role ? { open: { workspaceId: open.workspaceId, documentId: open.documentId, name: item.name, role, ...seen } } : shut;
  } catch (e) {
    blog.warn('board not read for someone in a call', { callId: v.pass.callId, err: e });
    return shut;
  }
}

/* ---------- who may do what ---------- */

/** Guests can add to a board once it's open. Starting one, and asking what starting one would mean, is for anyone invited. */
export function requireStarter(v: Viewer, what: string): void {
  if (v.role === 'guest') throw new ForbiddenError('Guests can add to a board, but can’t start one.', { context: { callId: v.pass.callId, role: v.role, what }, level: 'info' });
}
/** Boards are for the main room until rooms have their own: a room's has to stay with the people in it. */
function requireMainRoom(callId: string, place: string, what: string): void {
  if (place !== MAIN_PLACE) throw new ConflictError('Open a board from the main room.', { context: { callId, what } });
}

const noBoard = (documentId: string) => notFound('That board', { documentId });
/**
 * A saved board, for someone who could bring it to the call: one they can edit, where it was brought from or in the workspace
 * the call uses. `letIn`: and they may share it, which is the workspace's rule, so nobody gets past it through a call.
 * Whatever they can't reach is the same refusal, in the same words, as what isn't there.
 */
async function bringable(o: Owner, reader: Reader, m: Pick<MeetingManifest, 'workspaceId' | 'documents'>, documentId: string, need: { letIn: boolean; db: Db; lock?: 'change' | 'hold' | undefined }): Promise<Workspace> {
  const workspaceId = m.documents.flatMap((id) => { const at = placeOfBrought(id); return at?.documentId === documentId ? [at.workspaceId] : []; })[0] ?? m.workspaceId;
  if (!workspaceId) throw noBoard(documentId);
  try {
    const w = await workspaceFor(o, reader, workspaceId, need.db, need.lock);
    if (requireDocument(reader, w, documentId, 'edit').item.kind !== 'board') throw noBoard(documentId);
    if (need.letIn) requireSharing(reader, w, documentId);
    return w;
  } catch (e) {
    throw e instanceof NotFoundError ? noBoard(documentId) : e;
  }
}
const mayShare = (who: Who, w: Workspace, documentId: string): boolean => {
  try {
    requireSharing(who, w, documentId);
    return true;
  } catch (e) {
    if (e instanceof AppError && e.status < 500) return false;
    throw e;
  }
};

/** What the menu asks before a saved board opens: who in the call can't open it, and whether this person may let them in. */
export async function check(o: Owner, reader: Reader, x: { callId: string; meeting: Pick<MeetingManifest, 'workspaceId' | 'documents'>; place: string; here: Here[] }, documentId: string): Promise<BoardCheck> {
  requireMainRoom(x.callId, x.place, 'board-check');
  const w = await bringable(o, reader, x.meeting, documentId, { letIn: false, db: o.pool });
  const left = await cantOpen(w, o.pool, documentId, x.here.map((p) => ({ ...p, who: whoInCall(o, x.callId, p) })));
  return { cannot: left.map((p) => firstName(p.name)), mayLetIn: mayShare(reader, w, documentId) };
}

/* ---------- letting people in ---------- */

/**
 * Works a board out for everyone here it hasn't been yet: whoever can't open it gets a seat, which ends with the call, and
 * nobody else is touched, so what someone has from the workspace stays what they have. In the caller's transaction, which
 * holds the workspace's row.
 */
async function letInHere(w: HeldWorkspace, db: Db, callId: string, entry: BoardLetIn, here: Here[]): Promise<BoardLetIn> {
  const fresh = here.filter((p) => !entry.seen.includes(p.seat));
  if (!fresh.length) return entry;
  const left = await cantOpen(w, db, entry.documentId, fresh.map((p) => ({ ...p, who: whoInCall(w.owner, callId, p) })));
  if (left.length) await grant(w, db, entry.documentId, left.map((p): Grant => ({ kind: 'seat', callId, seat: p.seat, name: p.name, role: 'edit' })));
  return { ...entry, seen: [...entry.seen, ...fresh.map((p) => p.seat)] };
}
/** Whether someone who let people in still may: a seat outlives whoever gave it, but nobody new gets one in their name. */
async function stillShares(o: Owner, db: Db, callId: string, by: Controller, entry: BoardLetIn): Promise<boolean> {
  const who = whoInCall(o, callId, by);
  try {
    return mayShare(who, await workspaceFor(o, who, entry.workspaceId, db), entry.documentId);
  } catch (e) {
    if (e instanceof NotFoundError) return false;
    throw e;
  }
}
/**
 * Everyone here who's new to what the call lets people into in one workspace, in the caller's transaction, which holds the
 * call's row. The same `board` back when nothing changed.
 */
export async function seatNewcomers(o: Owner, db: Db, callId: string, workspaceId: string, board: CallBoards, here: Here[]): Promise<CallBoards> {
  const due = board.letIn.filter((e) => e.workspaceId === workspaceId && here.some((p) => !e.seen.includes(p.seat)));
  const w = due.length ? await serverWorkspace(o, workspaceId, db, 'change') : undefined;
  if (!w) return board;
  const next = new Map<BoardLetIn, BoardLetIn>();
  for (const e of due) {
    if (!w.state.items[e.documentId] || trashOf(w.state, e.documentId) || (e.by && !(await stillShares(o, db, callId, e.by, e)))) continue;
    next.set(e, await letInHere(w, db, callId, e, here));
  }
  return next.size ? { ...board, letIn: board.letIn.map((e) => next.get(e) ?? e) } : board;
}
/**
 * When a call ends, with nothing held and before its seats go: someone who joined the invite during it keeps what it made by
 * email, as everyone on the invite when it was made does, if they still have their seat. Taken out of the call, they came off
 * the invite with it, and a seat taken back in Share stays taken back. None of this is worth failing the end of a call.
 */
export async function keepForInvited(o: Owner, callId: string, meetingId: string, board: CallBoards, people: Here[]): Promise<void> {
  try {
    const made = board.letIn.filter((e) => e.by === null);
    const late = new Set(made.length ? ((await findItem(o, o.pool, 'meeting', meetingId, MeetingManifest))?.manifest.addedFromLink ?? []).map((e) => e.toLowerCase()) : []);
    const invited = people.flatMap((p) => (p.email && late.has(p.email) ? [{ email: p.email, who: { email: undefined, principals: [seatIndex(o, callId, p.seat)] } }] : []));
    for (const e of invited.length ? made : []) {
      await tx(o.pool, async (c) => {
        const w = await serverWorkspace(o, e.workspaceId, c, 'change');
        if (!w?.state.items[e.documentId]) return;
        const seatless = new Set(await cantOpen(w, c, e.documentId, invited));
        const seated = invited.filter((p) => !seatless.has(p));
        if (seated.length) await grant(w, c, e.documentId, seated.map(({ email }): Grant => ({ kind: 'email', email, role: 'edit' })));
      });
    }
  } catch (e) {
    blog.warn('boards not kept for people added during a call', { callId, err: e });
  }
}

/* ---------- what people do ---------- */

/** What's needed to change what a call keeps, in its transaction, which holds its row. */
export interface Changing<S extends Boarded> {
  v: Viewer; reader: Reader; c: Db; callId: string;
  meeting: Pick<MeetingManifest, 'title' | 'guests' | 'workspaceId' | 'documents' | 'addedFromLink'>;
  s: S;
  /** Where whoever's asking is in the call. */
  place: string;
  here: Here[];
  /** Whoever's asking, as a new board names them. */
  maker: Maker;
}
/** What came of it: the call as it is now, and for a new board what's left to fill it from its template. */
export interface Changed<S> { s: S; made?: { w: HeldWorkspace; documentId: string; template: BoardTemplate } | undefined }

const fullUp = (callId: string) => new ConflictError('This call has as many boards as it can take. Open one it already has.', { context: { callId, boards: MAX_BOARDS } });
const opening = <S extends Boarded>(s: S, place: string, open: OpenBoard, letIn: BoardLetIn[] = s.board.letIn): S => ({ ...s, board: { open: { ...s.board.open, [place]: open }, letIn } });

/**
 * A new board in the workspace the call uses. The people invited get it by email, so it stays theirs through the note, and
 * anyone else here a seat. Someone on the invite because they were let in from the link has a seat too, for now: taking them out
 * of the call takes them off the invite, and a seat goes with them where an address wouldn't. `keepForInvited` sees to whoever's
 * still on it when the call ends.
 */
async function openNew<S extends Boarded>(x: Changing<S>, template: BoardTemplate): Promise<Changed<S>> {
  const { v, c, s, callId, meeting } = x;
  const o = v.organizer;
  if (s.board.letIn.length >= MAX_BOARDS) throw fullUp(callId);
  const w = meeting.workspaceId ? await serverWorkspace(o, meeting.workspaceId, c, 'change') : undefined;
  if (!w) throw notFound('That workspace', { callId });
  await requireOrganizerEdits(o, w, c, callId, (await profile(o, c)).email);
  const documentId = await addBoard(w, c, nameOf(meeting.title), x.maker);
  const fromLink = new Set((meeting.addedFromLink ?? []).map((e) => e.toLowerCase()));
  const invited = meeting.guests.filter((e) => !fromLink.has(e.toLowerCase()));
  if (invited.length) await grant(w, c, documentId, invited.map((email): Grant => ({ kind: 'email', email, role: 'edit' })));
  const entry = await letInHere(w, c, callId, { workspaceId: w.workspaceId, documentId, by: null, seen: [] }, x.here);
  blog.info('board opened', { callId, workspaceId: w.workspaceId, documentId, made: true, invited: invited.length, here: entry.seen.length });
  return { s: opening(s, x.place, { workspaceId: w.workspaceId, documentId, by: controllerOf(v, x.reader) }, [...s.board.letIn, entry]), made: { w, documentId, template } };
}

/**
 * A saved board. `letIn` is a choice about everyone here, so it's worked out afresh, and whoever made it keeps the board
 * everyone's: what the call made stays the call's to give, whoever brings it back.
 */
async function openSaved<S extends Boarded>(x: Changing<S>, documentId: string, letIn: boolean): Promise<Changed<S>> {
  const { v, reader, c, s, callId } = x;
  const w = await bringable(v.organizer, reader, x.meeting, documentId, { letIn, db: c, lock: letIn ? 'change' : 'hold' });
  const by = controllerOf(v, reader);
  const there = s.board.letIn.find((e) => e.documentId === documentId);
  if (letIn && !there && s.board.letIn.length >= MAX_BOARDS) throw fullUp(callId);
  const entry = letIn ? await letInHere(w, c, callId, { workspaceId: w.workspaceId, documentId, by: there?.by === null ? null : by, seen: [] }, x.here) : undefined;
  blog.info('board opened', { callId, workspaceId: w.workspaceId, documentId, made: false, letIn });
  return { s: opening(s, x.place, { workspaceId: w.workspaceId, documentId, by }, entry ? [...s.board.letIn.filter((e) => e !== there), entry] : s.board.letIn) };
}

/** Whoever opened it, or the organizer. It closes for everyone there, and that's all: seats stay until the call ends, because people may open it again. */
function close<S extends Boarded>(x: Changing<S>): Changed<S> {
  const { v, s, callId, place } = x;
  const open = s.board.open[place];
  if (!open) throw new ConflictError('No board is open here.', { context: { callId } });
  if (open.by.person !== v.pass.person && !v.isOrganizer) throw new ForbiddenError('Only whoever opened this board, or the organizer, can close it.', { context: { callId, role: v.role } });
  const { [place]: _closed, ...rest } = s.board.open;
  blog.info('board closed', { callId, workspaceId: open.workspaceId, documentId: open.documentId });
  return { s: { ...s, board: { ...s.board, open: rest } } };
}

/** Whatever someone does about a board. Who may is checked here, under the call's row, and again by access. */
export function change<S extends Boarded>(x: Changing<S>, a: BoardAction): Promise<Changed<S>> | Changed<S> {
  if (a.type === 'board-close') return close(x);
  requireMainRoom(x.callId, x.place, a.type);
  return 'template' in a ? openNew(x, a.template) : openSaved(x, a.documentId, a.letIn);
}

/**
 * Fills a new board from its template: the one thing here still to complete. It waits for `@alcove/board`, which isn't on this
 * branch. Yjs work is moving into worker threads, so a closure can't cross: this will call that package's pure function by name
 * through `writeDocument`, with plain arguments and nothing captured, so everyone gets the same frames and nobody's undo can
 * take them away. Until then a board starts empty, and the template is stored nowhere.
 */
export const fillBoard = (_d: Deps, _workspace: HeldWorkspace, _documentId: string, _template: BoardTemplate): Promise<void> => Promise.resolve();
