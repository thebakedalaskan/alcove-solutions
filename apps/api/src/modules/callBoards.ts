/*
 * A board in a call (docs: Calls and recordings › A board in a call). A board is a workspace item. What's the call's is which
 * one is open in each part of it, and which boards it lets people into, kept in its sealed state (modules/callSpace.ts): where
 * each is, who opened it or let people in, by their name, address and seat, and the seats it's been worked out for. What a
 * board is called, and who can open it, aren't kept: they're read from its workspace for each person every time, so someone
 * who loses one stops being told about it at once, and someone who can't open one is told nothing that names it.
 *
 * Nothing here decides who can open what: modules/workspaceAccess.ts does. `calls.ts` holds the call's row and says when to do
 * what; this is what's done.
 */
import { MAIN_PLACE, firstName, type BoardCheck, type BoardTemplate, type CallAction, type CallBoard, type DocumentRole } from '@alcove/api';
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
  cantEdit, cantOpen, emailIndex, entriesOn, grant, heldBy, holdersOf, organizerEdits, readerInCall, requireDocument, requireSharing, roleOf, seatIndex, serverWorkspace, standingIn, trashOf, whoInCall, workspaceFor,
  type Grant, type HeldWorkspace, type Maker, type Reader, type Who, type Workspace, type WorkspaceAs
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
export interface Boarded extends Placing { board: CallBoards; removed: string[] }
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
export function requireMainRoom(callId: string, place: string, what: string): void {
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
export async function check(o: Owner, reader: Reader, x: { callId: string; meeting: Pick<MeetingManifest, 'workspaceId' | 'documents'>; place: string; here: Here[] }, documentId: string): Promise<BoardCheck> {
  requireMainRoom(x.callId, x.place, 'board-check');
  const w = await bringable(o, reader, x.meeting, documentId, { letIn: false, db: o.pool });
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
 * In the caller's transaction, which holds the workspace's row.
 */
async function letInHere(w: HeldWorkspace, db: Db, callId: string, entry: BoardLetIn, here: Here[], known: Here[]): Promise<BoardLetIn> {
  const fresh = here.filter((p) => unseen(entry, p));
  if (!fresh.length) return entry;
  const left = await (entry.by === null ? cantEdit : cantOpen)(w, db, entry.documentId, fresh.map((p) => ({ ...p, who: whoInCall(w.owner, callId, p) })));
  const earlierOf = (p: Here): Uint8Array[] => (p.email === null ? [] : known.filter((k) => k.email === p.email && k.seat !== p.seat && entry.seen.includes(k.seat)).map((k) => seatIndex(w.owner, callId, k.seat)));
  const indexes = left.flatMap(earlierOf);
  const entryOn = indexes.length ? await entriesOn(w, db, entry.documentId, indexes) : (): DocumentRole | undefined => undefined;
  const seats = left.flatMap((p): Grant[] => {
    const earlier = earlierOf(p).map(entryOn);
    return earlier.includes(undefined) ? [] : [{ kind: 'seat', callId, seat: p.seat, name: p.name, role: earlier.includes('read') ? 'read' : 'edit' }];
  });
  if (seats.length) await grant(w, db, entry.documentId, seats);
  return { ...entry, seen: [...entry.seen, ...fresh.map((p) => p.seat)] };
}
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
/**
 * Everyone here who's new to one board the call lets people into, on the word of whoever decided that, if it still stands. In
 * the caller's transaction, which holds the call's row. The same `board` back when nothing changed.
 */
export async function seatNewcomers(o: Owner, db: Db, callId: string, documentId: string, board: CallBoards, here: Here[], known: Here[]): Promise<CallBoards> {
  const entry = dueIn(board, here).find((e) => e.documentId === documentId);
  const w = entry && await serverWorkspace(o, entry.workspaceId, db, 'change');
  if (!entry || !w?.state.items[documentId] || trashOf(w.state, documentId)) return board;
  if (!(await (entry.by ? stillShares(w, db, callId, entry.by, documentId) : stillTheCalls(o, w, db, documentId)))) return board;
  const next = await letInHere(w, db, callId, entry, here, known);
  return { ...board, letIn: board.letIn.map((e) => (e === entry ? next : e)) };
}
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

/** What's needed to change what a call keeps, in its transaction, which holds its row. */
export interface Changing<S extends Boarded> {
  v: Viewer; reader: Reader; c: Db; callId: string;
  meeting: Pick<MeetingManifest, 'title' | 'guests' | 'workspaceId' | 'documents' | 'addedFromLink'>;
  s: S;
  /** Where whoever's asking is in the call. */
  place: string;
  here: Here[];
  /** Everyone in the call who wasn't taken out of it, here now or not: what someone's other connections were given. */
  known: Here[];
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
 * still on it when the call ends. Nobody taken out of the call and still out is given what's opened after they went, though they
 * stay on the invite: what they had before, they keep, as they keep the note. An address it goes to is never given a seat too:
 * what someone does to that entry is theirs to do.
 */
async function openNew<S extends Boarded>(x: Changing<S>, template: BoardTemplate): Promise<Changed<S>> {
  const { v, c, s, callId, meeting } = x;
  const o = v.organizer;
  if (s.board.letIn.length >= MAX_BOARDS) throw fullUp(callId);
  const w = meeting.workspaceId ? await serverWorkspace(o, meeting.workspaceId, c, 'change') : undefined;
  if (!w) throw notFound('That workspace', { callId });
  if (!(await organizerEdits(o, w, c, (await profile(o, c)).email))) {
    throw new ConflictError(v.isOrganizer ? 'You can’t add to this call’s workspace any more. Choose another.' : 'This call’s workspace can’t take a new board. Ask the organizer to choose another.', { context: { callId, workspaceId: w.workspaceId } });
  }
  const documentId = await addBoard(w, c, nameOf(meeting.title), x.maker);
  const back = new Set(x.here.flatMap((p) => (p.email ? [p.email.toLowerCase()] : [])));
  const out = s.people.flatMap((j) => (j.email && s.removed.includes(j.person) && !back.has(j.email.toLowerCase()) ? [j.email] : []));
  const notNow = new Set([...(meeting.addedFromLink ?? []), ...out].map((e) => e.toLowerCase()));
  const invited = meeting.guests.filter((e) => !notNow.has(e.toLowerCase()));
  if (invited.length) await grant(w, c, documentId, invited.map((email): Grant => ({ kind: 'email', email, role: 'edit' })));
  const entry = await letInHere(w, c, callId, { workspaceId: w.workspaceId, documentId, by: null, seen: invited.map((e) => e.toLowerCase()) }, x.here, x.known);
  blog.info('board opened', { callId, workspaceId: w.workspaceId, documentId, made: true, invited: invited.length, here: entry.seen.length });
  return { s: opening(s, x.place, { workspaceId: w.workspaceId, documentId, by: controllerOf(v, x.reader) }, [...s.board.letIn, entry]), made: { w, documentId, template } };
}

/**
 * A saved board. `letIn` is a new decision about everyone here, so it's worked out afresh. A board the call made stays the
 * call's to give, whoever brings it back, for as long as it's the call's to give: past that it's on this person's word.
 */
async function openSaved<S extends Boarded>(x: Changing<S>, documentId: string, letIn: boolean): Promise<Changed<S>> {
  const { v, reader, c, s, callId } = x;
  const w = await bringable(v.organizer, reader, x.meeting, documentId, { letIn, db: c, lock: letIn ? 'change' : 'hold' });
  const by = controllerOf(v, reader);
  const there = s.board.letIn.find((e) => e.documentId === documentId);
  if (letIn && !there && s.board.letIn.length >= MAX_BOARDS) throw fullUp(callId);
  const entry = letIn ? await letInHere(w, c, callId, { workspaceId: w.workspaceId, documentId, by: there?.by === null && await stillTheCalls(v.organizer, w, c, documentId) ? null : by, seen: [] }, x.here, x.known) : undefined;
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
 * branch. Yjs work happens in worker threads, so this will be `writeDocument` naming an edit in `documentOps.ts`, a pure function
 * of that package's, with plain arguments, so everyone gets the same frames and nobody's undo can take them away. Until then a
 * board starts empty, and the template is stored nowhere.
 */
export const fillBoard = (_d: Deps, _workspace: HeldWorkspace, _documentId: string, _template: BoardTemplate): Promise<void> => Promise.resolve();
