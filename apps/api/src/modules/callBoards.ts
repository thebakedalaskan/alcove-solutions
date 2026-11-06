/*
 * A board in a call (docs: Calls and recordings › A board in a call). A board is a workspace item. What's the call's is which
 * one is open in each part of it, and which boards it lets people into, kept in its sealed state (modules/callSpace.ts): where
 * each is, who opened it or let people in, by their name, address and seat, and the seats it's been worked out for. What a
 * board is called, and who can open it, aren't kept: they're read from its workspace for each person every time, so someone
 * who loses one stops being told about it at once, and someone who can't open one is told nothing that names it.
 *
 * Nothing here decides who can open what: modules/workspaceAccess.ts does. `calls.ts` holds the call's row and says when to do
 * what; this is what's done. A live call comes first, so what touches a workspace is done with nothing of the call held, in
 * the workspace's own transaction, and the call's row is held only to save what came of it.
 */
import { MAIN_PLACE, firstName, type BoardCheck, type BoardTemplate, type CallAction, type CallBoard, type DocumentRole } from '@alcove/api';
import type { Owner } from '../context';
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
  workspaceForCall,
  type Grant, type HeldWorkspace, type Maker, type Reader, type Who, type Workspace, type WorkspaceAs
} from './workspaceAccess';
import { writeDocument } from './workspaceDocuments';
import { addBoard } from './workspaces';

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
/**
 * What came of it: the call as it is now; the seats given to people taken out of the call meanwhile, for the caller to take back
 * once the call's row is let go; and what happened, to log once it's saved.
 */
export interface Changed<S> {
  s: S;
  ended: string[];
  done: { what: 'board opened'; workspaceId: string; documentId: string; made: boolean; letIn: boolean; invited: number; here: number } | { what: 'board closed'; workspaceId: string; documentId: string };
}
/**
 * The change to what the call keeps, under its row, from the call as it is then. It never needs asking again: a board made and a
 * seat given stand whatever happened meanwhile, as they would have a moment earlier, and what it saves goes by the call as it is.
 */
export type Apply<S extends Boarded> = (y: Changing<S>) => Changed<S>;

const fullUp = (callId: string) => new ConflictError('This call has as many boards as it can take. Open one it already has.', { context: { callId, boards: MAX_BOARDS } });
const opening = <S extends Boarded>(s: S, open: OpenBoard, letIn: BoardLetIn[] = s.board.letIn): S => ({ ...s, board: { open: { ...s.board.open, [MAIN_PLACE]: open }, letIn } });

/**
 * A new board in the workspace the call uses. The people invited get it by email, so it stays theirs through the note, and
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
  const { workspaceId } = await workspaceForCall(o, { organizer: o, callId });
  const made = await tx(o.pool, async (c) => {
    const w = await serverWorkspace(o, workspaceId, c, 'change');
    if (!w) throw notFound('That workspace', { callId });
    if (!(await organizerEdits(o, w, c, (await profile(o, c)).email))) {
      throw new ConflictError(v.isOrganizer ? 'You can’t add to this call’s workspace any more. Choose another.' : 'This call’s workspace can’t take a new board. Ask the organizer to choose another.', { context: { callId, workspaceId } });
    }
    const documentId = await addBoard(w, c, nameOf(meeting.title), x.maker);
    const back = new Set(x.here.flatMap((p) => (p.email ? [p.email.toLowerCase()] : [])));
    const out = s.people.flatMap((j) => (j.email && s.removed.includes(j.person) && !back.has(j.email.toLowerCase()) ? [j.email] : []));
    const notNow = new Set([...(meeting.addedFromLink ?? []), ...out].map((e) => e.toLowerCase()));
    const invited = meeting.guests.filter((e) => !notNow.has(e.toLowerCase()));
    if (invited.length) await grant(w, c, documentId, invited.map((email): Grant => ({ kind: 'email', email, role: 'edit' })));
    const { entry, seats } = await letInHere(w, c, callId, { workspaceId, documentId, by: null, seen: invited.map((e) => e.toLowerCase()) }, x.here, x.known);
    return { w, documentId, entry, seats, invited: invited.length };
  });
  await fillBoard(made.w, made.documentId, template).catch((e: unknown) => blog.warn('board not filled from its template', { callId, documentId: made.documentId, err: e }));
  const by = controllerOf(v, x.reader);
  return (y) => ({
    s: opening(y.s, { workspaceId, documentId: made.documentId, by }, [...y.s.board.letIn, made.entry]),
    ended: removedFrom(y.known, made.seats),
    done: { what: 'board opened', workspaceId, documentId: made.documentId, made: true, letIn: true, invited: made.invited, here: made.entry.seen.length }
  });
}

/**
 * A saved board. `letIn` is a new decision about everyone here, so it's worked out afresh, in the workspace's own transaction. A
 * board the call made stays the call's to give, whoever brings it back, for as long as it's the call's to give: past that it's on
 * this person's word. Without `letIn` nothing in the workspace changes, so it's only read.
 */
async function prepareSaved<S extends Boarded>(x: Changing<S>, documentId: string, letIn: boolean): Promise<Apply<S>> {
  const { v, reader, s, callId } = x;
  const o = v.organizer;
  const by = controllerOf(v, reader);
  const there = s.board.letIn.find((e) => e.documentId === documentId);
  if (letIn && !there && s.board.letIn.length >= MAX_BOARDS) throw fullUp(callId);
  if (!letIn) {
    const { workspaceId } = await bringable(o, reader, x.meeting, documentId, { letIn: false, db: o.pool });
    return (y) => ({ s: opening(y.s, { workspaceId, documentId, by }), ended: [], done: { what: 'board opened', workspaceId, documentId, made: false, letIn: false, invited: 0, here: 0 } });
  }
  const r = await tx(o.pool, async (c) => {
    const w = await bringable(o, reader, x.meeting, documentId, { letIn: true, db: c, lock: 'change' });
    const decided = there?.by === null && await stillTheCalls(o, w, c, documentId) ? null : by;
    return { workspaceId: w.workspaceId, ...await letInHere(w, c, callId, { workspaceId: w.workspaceId, documentId, by: decided, seen: [] }, x.here, x.known) };
  });
  return (y) => ({
    s: opening(y.s, { workspaceId: r.workspaceId, documentId, by }, [...y.s.board.letIn.filter((e) => e.documentId !== documentId), r.entry]),
    ended: removedFrom(y.known, r.seats),
    done: { what: 'board opened', workspaceId: r.workspaceId, documentId, made: false, letIn: true, invited: 0, here: r.entry.seen.length }
  });
}

/** Whoever opened it, or the organizer. It closes for everyone there, and that's all: seats stay until the call ends, because people may open it again. */
function closing<S extends Boarded>(y: Changing<S>): Changed<S> {
  const { v, s, callId, place } = y;
  const open = s.board.open[place];
  if (!open) throw new ConflictError('No board is open here.', { context: { callId } });
  if (open.by.person !== v.pass.person && !v.isOrganizer) throw new ForbiddenError('Only whoever opened this board, or the organizer, can close it.', { context: { callId, role: v.role } });
  const { [place]: _closed, ...rest } = s.board.open;
  return { s: { ...s, board: { ...s.board, open: rest } }, ended: [], done: { what: 'board closed', workspaceId: open.workspaceId, documentId: open.documentId } };
}

/**
 * Whatever someone does about a board, in two steps, because a live call comes first: nothing under the call's row waits on a
 * workspace's lock or opens one. This is the first, with nothing of the call held: who may, whether what's asked for opens, and
 * what changes in the workspace, in a transaction of its own. What it returns is the second (`Apply`). What's refused whatever
 * happens is refused first, so a guest, or someone in a breakout room, settles nothing.
 */
export async function prepare<S extends Boarded>(x: Changing<S>, a: BoardAction): Promise<Apply<S>> {
  if (a.type === 'board-close') return closing;
  requireMainRoom(x.callId, x.place, a.type);
  return 'template' in a ? prepareNew(x, a.template) : prepareSaved(x, a.documentId, a.letIn);
}

/**
 * Fills a new board from its template, through its log like any change, so whoever has it open sees it arrive, everyone gets the
 * same frames and nobody's undo can take them away. It's the server's, written once however often it's asked, with the board's
 * id as its seed, and only on a board nobody has put anything on yet (documentOps.ts's `boardTemplate`). Blank writes nothing.
 */
async function fillBoard(w: HeldWorkspace, documentId: string, template: BoardTemplate): Promise<void> {
  await writeDocument(w, documentId, 'boardTemplate', { kind: 'board', template, seed: documentId });
}
