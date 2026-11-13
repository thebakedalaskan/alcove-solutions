/*
 * Workspaces: an owner with its own keys, its people, its tree of documents, boards and folders, and streams of it
 * (docs: Data and storage › Workspaces). The name and tree are one sealed state, changed only under the workspace's row
 * lock and read per reader, so nobody is ever sent what they can't open. Who can do what is features/workspaces/access.ts's to say;
 * this module does what access allows. What a document or board holds isn't here: to the tree they're rows of a kind.
 */
import {
  type DocumentRole, type DocumentShare, type ItemCall, type ItemKind, type ItemPlace, type Person, type PresenceBody, type ShareEntry, type ShareTarget, type WorkspaceHere, type WorkspaceItem, type WorkspaceLiveEvent, type WorkspacePerson,
  type WorkspaceRole, type WorkspaceSummary, type WorkspaceTree
} from '@alcove/api';
import type { StreamingApi } from 'hono/utils/stream';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, blindIndex, id128, openJson, sealJson, sha, toJson, utf8, type RecordHeader } from '../../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../db';
import { AppError, ConflictError, invalid, notFound } from '../../errors';
import { publish, type StreamPlace } from '../../live/hub';
import { announce, roomFor, type Room, type Snapshot } from '../../live/room';
import { LiveStream, type Line, type Step } from '../../live/stream';
import { log } from '../../log';
import { createOwner, findOwner, indexKey, lockOwner, ownerFrom } from '../../owners';
import {
  TREE_NOTICE, canOpen, change, emailIndex, entriesOn, grant, grantsFor, limitKey, openSharedPerson, openState, personIn, personKey, placeableIn, requireEditable, requireItem, requireRole, requireSharing, roleOf, saveState, sealSharedPerson, sealState, seatEnded, seatIndex,
  serverWorkspace, standingIn, trashOf, workspaceFor, workspaceKey, type Credentials, type Grant, type MadeFor, type Maker, type Reader, type Standing, type StoredCall, type StoredItem, type Who, type Workspace, type WorkspaceState
} from './access';
import { profile } from '../account/account';
import { addressesIn, seated } from '../calls/participants';
import { tellCall } from '../calls/notifications';
import { roomsOfCalls } from '../calls/room-boards';
import { collect, copyUses, releaseDocuments, releaseWorkspace } from './media';
import { personOf, portraitFor } from '../account/portraits';
import { copyContent, kindOf, moveClientTags, startContent } from './documents';
import { waitingFor } from './mentions';

const wlog = log.child({ component: 'workspaces' });

/** A workspace's tree is small: it's one record, rewritten by every change and sent whole. */
const MAX_ITEMS = 5000;
const MAX_NAME = 200;
/** How many folders deep a tree can go. A stored tree can be deeper than this, so nothing that walks one recurses. */
const MAX_DEPTH = 32;
/** How many workspaces one address can have made and not deleted, in or out of them. */
const MAX_MADE = 100;
const MAX_PEOPLE = 1000;
/** How long something stays in Trash. */
export const TRASH_MS = 30 * 24 * 60 * 60_000;
/** Workspaces with something due that one maintenance run looks at. */
const TRASH_BATCH = 100;

/* ---------- where things fall among their siblings ---------- */

/*
 * Positions are strings that sort plainly, so something can always land between two others without touching either:
 * base 62, read as a fraction, never ending in 0, which leaves room below every position.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const digit = (i: number): string => DIGITS.charAt(i);
const FIRST = 'V';
/** After everything: one step on, so a list built from the top stays short. */
function afterLast(a: string): string {
  const i = DIGITS.indexOf(a.slice(-1));
  return i < DIGITS.length - 1 ? a.slice(0, -1) + digit(i + 1) : a + FIRST;
}
/** Before everything: one step back, and a digit further once there's no room left. */
function beforeFirst(b: string): string {
  const i = DIGITS.indexOf(b.slice(-1));
  return i > 1 ? b.slice(0, -1) + digit(i - 1) : `${b.slice(0, -1)}0${FIRST}`;
}
/** Halfway between two positions, a before b. */
function halfway(a: string, b: string): string {
  let same = 0;
  while ((a[same] ?? '0') === b[same]) same++;
  const head = b.slice(0, same);
  const from = DIGITS.indexOf(a[same] ?? '0');
  const to = DIGITS.indexOf(b[same] ?? '0');
  if (to - from > 1) return head + digit(Math.round((from + to) / 2));
  // No digit between them. Whatever follows `a`'s digit is below `b`, so the room is above what's left of `a`.
  const rest = a.slice(same + 1);
  return head + digit(from) + (rest ? afterLast(rest) : FIRST);
}
const positionBetween = (a: string | null, b: string | null): string => (a === null ? (b === null ? FIRST : beforeFirst(b)) : b === null ? afterLast(a) : halfway(a, b));
/** `n` positions after `a`, in order, under one new one: fixed-width steps, so moving a great many at once keeps them short. */
function positionsAfter(a: string | null, n: number): string[] {
  const head = positionBetween(a, null);
  const width = Math.max(1, n.toString(36).length);
  return Array.from({ length: n }, (_, i) => `${head}${i.toString(36).padStart(width, '0')}1`);
}
const byPosition = (a: { pos: string }, b: { pos: string }): number => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0);
interface Child { id: string; item: StoredItem; pos: string }
/** What's in each folder, in order: one pass, so going through a whole tree stays cheap at any size it can be. */
function childrenIn(s: WorkspaceState): Map<string | null, Child[]> {
  const kids = new Map<string | null, Child[]>();
  for (const [id, item] of Object.entries(s.items)) {
    const here = kids.get(item.parent) ?? [];
    here.push({ id, item, pos: item.pos });
    kids.set(item.parent, here);
  }
  for (const here of kids.values()) here.sort(byPosition);
  return kids;
}

/** The position for landing in `parent`: last (`after` left out), first (null), or just after a sibling. `moving` isn't among its own siblings. */
function positionIn(s: WorkspaceState, parent: string | null, after?: string | null | undefined, moving?: string | undefined): string {
  const siblings = (childrenIn(s).get(parent) ?? []).filter((x) => x.id !== moving);
  if (after === undefined) return positionBetween(siblings.at(-1)?.pos ?? null, null);
  if (after === null) return positionBetween(null, siblings[0]?.pos ?? null);
  const at = siblings.findIndex((x) => x.id === after);
  const before = siblings[at];
  if (!before) throw invalid('That isn’t next to where this is going.');
  return positionBetween(before.pos, siblings[at + 1]?.pos ?? null);
}
/** Everything inside these, however deep, in one pass, leaving out the ones asked about. */
function insideOf(s: WorkspaceState, ids: string[]): string[] {
  const kids = childrenIn(s);
  const seen = new Set(ids);
  const found: string[] = [];
  const stack = [...ids];
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    for (const { id } of kids.get(at) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      found.push(id);
      stack.push(id);
    }
  }
  return found;
}
/** How many folders down `id` is, itself included; 0 for the top. */
function depthOf(s: WorkspaceState, id: string | null): number {
  const seen = new Set<string>();
  for (let at = id; at !== null && !seen.has(at); at = s.items[at]?.parent ?? null) seen.add(at);
  return seen.size;
}
/** How many levels of folders `id` is, itself included, counted no further than the limit; 0 for anything else. */
function heightOf(s: WorkspaceState, id: string): number {
  if (s.items[id]?.kind !== 'folder') return 0;
  const kids = childrenIn(s);
  let height = 0;
  for (let level = [id]; level.length && height <= MAX_DEPTH; height++) {
    level = level.flatMap((x) => (kids.get(x) ?? []).filter((c) => c.item.kind === 'folder').map((c) => c.id));
  }
  return height;
}
const withItem = (s: WorkspaceState, id: string, item: StoredItem): WorkspaceState => ({ ...s, items: { ...s.items, [id]: item } });
function withoutItems(s: WorkspaceState, ids: string[]): WorkspaceState {
  const gone = new Set(ids);
  return { ...s, items: Object.fromEntries(Object.entries(s.items).filter(([id]) => !gone.has(id))) };
}
const holdsContent = (kind: ItemKind): boolean => kind !== 'folder';
/** Remembers that an address's name is on something here, so deleting that account can find this workspace after it has left. */
const noteAuthor = (w: { owner: Owner }, db: Db, email: string, madeWorkspace = false): Promise<number> => exec(db, `INSERT INTO workspace_authors (owner_id, email_index, made_workspace) VALUES ($1,$2,$3)
  ON CONFLICT (owner_id, email_index) DO UPDATE SET made_workspace = workspace_authors.made_workspace OR EXCLUDED.made_workspace`, [w.owner.ownerId, blindIndex(indexKey(w.owner), 'email', email), madeWorkspace]);
/** Who's making something: an account by its name and address, a guest in a call by the name they're in it under. */
const makerOf = (r: Reader): Maker => ({ name: r.account?.name ?? r.seat?.name ?? '', email: (r.email ?? '').trim().toLowerCase() });

/* ---------- reading ---------- */

/**
 * Each call's folder in a tree as one reader may read its pages (docs: Calls and recordings › The call's home): the live ones
 * while the call's on, for whoever's in it (`seatCall`, the call their pass is for); then the call's note, for its organizer
 * and whoever has it now, which the note's own rows say. One small query for a tree, whatever's in it. Nothing of the call or
 * the note is opened here, and someone without them is told only that the call was there, which the folder says anyway.
 */
export async function callsIn(db: Db, who: Who, seatCall: string | null, s: WorkspaceState): Promise<Map<string, ItemCall>> {
  const folders = Object.entries(s.items).flatMap(([id, item]) => (item.call ? [{ id, call: item.call }] : []));
  const out = new Map<string, ItemCall>();
  if (!folders.length) return out;
  const email = who.email?.trim().toLowerCase();
  const asked = folders.flatMap(({ call }) => (call.ended && call.noteId ? [call] : []));
  /** Each note that's still there, by its organizer and ID, and whether this reader has it under their address. */
  const notes = new Map<string, boolean>();
  if (asked.length) {
    const found = await rows(db, z.object({ owner_id: z.string(), note_item_id: z.string(), held: z.boolean() }), `SELECT t.owner_id, t.note_item_id,
        EXISTS (SELECT 1 FROM note_access a WHERE a.owner_id = t.owner_id AND a.note_item_id = t.note_item_id AND a.email_index = ANY($1::bytea[])) AS held
      FROM unnest($2::text[], $3::text[]) AS t(owner_id, note_item_id)
      JOIN items i ON i.owner_id = t.owner_id AND i.item_id = t.note_item_id AND i.kind = 'note' AND i.deleted_at IS NULL`, [who.principals, asked.map((c) => c.ownerId), asked.map((c) => c.noteId ?? '')]);
    for (const r of found) notes.set(`${r.owner_id}:${r.note_item_id}`, r.held);
  }
  for (const { id, call } of folders) {
    const held = call.noteId === null ? undefined : notes.get(`${call.ownerId}:${call.noteId}`);
    const theirs = call.ended && held !== undefined && (held || call.organizer === email);
    out.set(id, { startedAt: call.startedAt, on: !call.ended, here: !call.ended && seatCall === call.callId, noteId: theirs ? call.noteId : null });
  }
  return out;
}

/** One item as a reader sees it. `trash` is what it's in Trash with, on its own or with a folder. */
function wireItem(id: string, item: StoredItem, role: DocumentRole, outside: boolean, trash: { at: string; by: string | null } | null, call: ItemCall | null): WorkspaceItem {
  return {
    id, kind: item.kind, name: item.name, parent: outside ? null : item.parent, by: item.by && { name: item.by.name, portrait: portraitFor(item.by.email || item.by.name) },
    createdAt: item.createdAt, editedAt: item.editedAt, trashedAt: trash?.at ?? null, trashedBy: trash?.by ?? null, restricted: item.restricted, role, call
  };
}
type Seen = Standing & { workspaceId: string; state: WorkspaceState; people: number };
/**
 * The workspace as one reader sees it: everything they can open, in order, with parents first, and each call's folder as `calls`
 * says they may read it. Someone in a call that uses it sees it as its people do, folders and name, but not how many they are.
 */
function treeFor(who: Who, w: Seen, calls: ReadonlyMap<string, ItemCall>): WorkspaceTree {
  const outside = w.role === null && !w.call;
  const items: WorkspaceItem[] = [];
  const kids = childrenIn(w.state);
  type Next = { child: Child; above: { at: string; by: string | null } | null };
  const next = (parent: string | null, above: Next['above']): Next[] => (kids.get(parent) ?? []).map((child) => ({ child, above })).reverse();
  const stack = next(null, null);
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    const { id, item } = at.child;
    const trash = item.trashedAt ? { at: item.trashedAt, by: item.trashedBy } : at.above;
    const role = roleOf(who, w, id, item);
    if (role) items.push(wireItem(id, item, role, outside, trash, calls.get(id) ?? null));
    stack.push(...next(id, trash));
  }
  return { id: w.workspaceId, name: outside ? null : w.state.name, role: w.role, inCall: w.call, people: w.role === null ? null : w.people, items };
}
export async function tree(d: Deps, reader: Reader, workspaceId: string): Promise<WorkspaceTree> {
  const w = await workspaceFor(d, reader, workspaceId);
  return treeFor(reader, w, await callsIn(d.pool, reader, reader.seat?.callId ?? null, w.state));
}
export async function item(d: Deps, reader: Reader, workspaceId: string, itemId: string): Promise<WorkspaceItem> {
  const w = await workspaceFor(d, reader, workspaceId);
  const found = requireItem(reader, w, itemId);
  const calls = found.item.call ? await callsIn(d.pool, reader, reader.seat?.callId ?? null, { ...w.state, items: { [itemId]: found.item } }) : new Map<string, ItemCall>();
  return wireItem(itemId, found.item, found.role, w.role === null && !w.call, trashOf(w.state, itemId), calls.get(itemId) ?? null);
}

const ListedRow = z.object({ owner_id: z.string(), workspace_id: z.string(), state_ciphertext: bytea, role: z.enum(['admin', 'edit', 'read']).nullable(), people: z.number(), created_at: timestamp });
/**
 * The Drive: every workspace someone's in, newest first, a call's home with the call it was made for; then each one they only
 * have documents in, which says nothing about itself, not even when it was made.
 */
export async function list(reader: Reader): Promise<WorkspaceSummary[]> {
  const o = reader.account?.owner;
  if (!o) return [];
  const found = await rows(o.pool, ListedRow, `SELECT w.owner_id, w.workspace_id, w.state_ciphertext, m.role, w.created_at,
      (SELECT count(*)::int FROM workspace_members x WHERE x.owner_id = w.owner_id) AS people
    FROM workspaces w LEFT JOIN workspace_members m ON m.owner_id = w.owner_id AND m.email_index = ANY($1::bytea[])
    WHERE m.role IS NOT NULL OR EXISTS (SELECT 1 FROM document_access a WHERE a.owner_id = w.owner_id AND a.principal_index = ANY($1::bytea[]))
    ORDER BY w.created_at DESC, w.workspace_id`, [reader.principals]);
  const mine: WorkspaceSummary[] = [];
  const given: WorkspaceSummary[] = [];
  for (const r of found) {
    if (r.role === null) { given.push({ id: r.workspace_id, name: null, role: null, people: null, createdAt: null, call: null }); continue; }
    const owner = await findOwner(o, r.owner_id, undefined);
    // Deleted since its row was read: nobody has it any more.
    if (!owner) continue;
    const state = openState(owner, r.workspace_id, r.state_ciphertext);
    mine.push({ id: r.workspace_id, name: state.name, role: r.role, people: r.people, createdAt: r.created_at.toISOString(), call: state.madeFor && { title: state.madeFor.title, at: state.madeFor.at } });
  }
  return [...mine, ...given];
}

/* ---------- changing ---------- */

const addDocuments = async (w: Pick<Workspace, 'owner'>, db: Db, ids: string[]): Promise<void> => {
  if (ids.length) await exec(db, 'INSERT INTO documents (owner_id, document_id) SELECT $1, unnest($2::text[])', [w.owner.ownerId, ids]);
};
/** Documents going for good, with the files only they had: the caller collects those once its transaction commits. */
const removeDocuments = async (o: Owner, db: Db, ids: string[]): Promise<void> => {
  if (!ids.length) return;
  await releaseDocuments(o, db, ids);
  await exec(db, 'DELETE FROM documents WHERE owner_id = $1 AND document_id = ANY($2::text[])', [o.ownerId, ids]);
};
function requireRoom(w: Pick<Workspace, 'state' | 'workspaceId'>, adding: number): void {
  if (Object.keys(w.state.items).length + adding > MAX_ITEMS) throw new ConflictError('This workspace is full. Delete something from it first.', { context: { workspaceId: w.workspaceId, items: Object.keys(w.state.items).length } });
}
/** Refuses what would take folders past the limit: `height` levels of them, landing in `parent`. */
function requireDepth(w: Workspace, parent: string | null, height: number): void {
  if (height > 0 && depthOf(w.state, parent) + height > MAX_DEPTH) throw invalid(`Folders can only go ${MAX_DEPTH} deep.`, { workspaceId: w.workspaceId });
}
/** Where something may land: the top, or a folder this reader can open that's in the tree. */
function landing(reader: Reader, w: Workspace, parent: string | null): string | null {
  if (parent === null) return null;
  if (requireItem(reader, w, parent).item.kind !== 'folder') throw invalid('Only a folder can hold other things.', { workspaceId: w.workspaceId });
  if (trashOf(w.state, parent)) throw new ConflictError('That folder is in Trash.', { context: { workspaceId: w.workspaceId, itemId: parent } });
  return parent;
}

/**
 * A workspace someone makes, with them as its admin, in the caller's transaction. `madeFor`: the call it's made in, as a home
 * is (`MadeFor`), so who's in it follows that call's invite (`followInvite`).
 */
export async function createIn(o: Owner, c: Db, name: string, madeFor: Omit<MadeFor, 'out'> | null = null): Promise<{ id: string }> {
  const me = await profile(o, c);
  const id = id128();
  // One at a time for an account, so two at once can't both be the hundredth.
  await lockOwner(o, c);
  const made = await maybeOne(c, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM workspace_authors WHERE email_index = $1 AND made_workspace', [blindIndex(indexKey(o), 'email', me.email)]);
  if ((made?.n ?? 0) >= MAX_MADE) throw new ConflictError('You’ve made as many workspaces as you can. Delete one first.', { context: { ownerId: o.ownerId, made: made?.n } });
  const { ownerId, root } = await createOwner(o, c);
  const owner = ownerFrom(o, ownerId, root, undefined);
  await exec(c, 'INSERT INTO workspaces (owner_id, workspace_id, state_ciphertext) VALUES ($1,$2,$3)', [ownerId, id, sealState(owner, id, { name, items: {}, madeFor: madeFor && { ...madeFor, out: [] }, about: '' })]);
  await addMember(owner, c, id, me.email, 'admin', me.name);
  await noteAuthor({ owner }, c, me.email, true);
  wlog.info('workspace created', { workspaceId: id });
  return { id };
}
export const create = (o: Owner, name: string): Promise<{ id: string }> => tx(o.pool, (c) => createIn(o, c, name));

/* ---------- a call's home ---------- */

/** A call's folder, as its home keeps it. */
export interface CallFolder { id: string; name: string; call: StoredCall }
const folderOf = (f: CallFolder, pos: string, at: string): StoredItem => ({
  kind: 'folder', name: f.name, parent: null, pos, by: null, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, restrictedBy: null, call: f.call, room: null
});
/** The people invited to a call, as a home keeps them: lower-cased, once each, without its organizer. */
const inviteesOf = (invited: string[], organizer: string): string[] => [...new Set(invited.map((e) => e.trim().toLowerCase()))].filter((e) => e && e !== organizer.trim().toLowerCase());

/**
 * A call's new home, in the caller's transaction, which holds the call's row (or, before the call, its meeting's): nobody else
 * can reach it yet, so nothing waits on it. The organizer is its admin and the call's folder is at the top; a home made before
 * the call has none until the call starts and makes its own. Everyone invited, the same people who get the notes, is let in to
 * edit once that row is let go (`followInvite`), so a big invite never holds the call up. It's the call's, so it doesn't count
 * towards the workspaces someone can make (`MAX_MADE`).
 */
export async function makeHome(o: Owner, c: Db, home: { name: string; madeFor: Omit<MadeFor, 'out'>; folder?: CallFolder | undefined }): Promise<{ id: string }> {
  const me = await profile(o, c);
  const id = id128();
  const { ownerId, root } = await createOwner(o, c);
  const owner = ownerFrom(o, ownerId, root, undefined);
  const items = home.folder ? { [home.folder.id]: folderOf(home.folder, FIRST, new Date().toISOString()) } : {};
  const state: WorkspaceState = { name: home.name, items, madeFor: { ...home.madeFor, out: [] }, about: '' };
  await exec(c, 'INSERT INTO workspaces (owner_id, workspace_id, state_ciphertext) VALUES ($1,$2,$3)', [ownerId, id, sealState(owner, id, state)]);
  await addMember(owner, c, id, me.email, 'admin', me.name);
  await noteAuthor({ owner }, c, me.email);
  wlog.info('call home made', { workspaceId: id });
  return { id };
}

/**
 * Puts a call's folder at the top of its home, in the caller's transaction, which holds the home's row (`serverWorkspace` with
 * `change`), unless it's there already: whoever gets there first makes it, with the ID the call took for it. True when it's
 * there now; false for a workspace with no room for it, and the call settles on another home.
 */
export async function addCallFolder(w: HeldWorkspace, db: Db, folder: CallFolder): Promise<boolean> {
  if (w.state.items[folder.id]) return true;
  if (Object.keys(w.state.items).length >= MAX_ITEMS) { wlog.warn('no room for a call’s folder', { workspaceId: w.workspaceId }); return false; }
  w.state = withItem(w.state, folder.id, folderOf(folder, positionIn(w.state, null, null), new Date().toISOString()));
  await saveState(w, db);
  await publish(db, w.workspaceId, TREE_NOTICE);
  wlog.info('call folder made', { workspaceId: w.workspaceId, folderId: folder.id });
  return true;
}

/** What a change to a call's invite asks of its home: who it just put on the invite, and who it just took off. */
export interface InviteChange { add?: string[] | undefined; gone?: string[] | undefined }
/**
 * Who's in a call's home follows its invite, when it was made for that call or its series (`MadeFor`), one change at a time:
 * whoever the change put on the invite is let in to edit, once, unless they're in already or out by hand (`MadeFor.out`:
 * taken out, or they left); and whoever it took off is taken out, if the invite let them in and nobody has changed their place
 * by hand since. Anyone added or changed by hand stays as they are. In the caller's transaction, which holds the home's row.
 */
export async function followInvite(w: HeldWorkspace, db: Db, organizer: string, change: InviteChange): Promise<{ added: number; removed: number }> {
  const made = w.state.madeFor;
  if (!made) return { added: 0, removed: 0 };
  const members = await rows(db, Member, 'SELECT member_id, email_index, role, person_ciphertext, created_at FROM workspace_members WHERE owner_id = $1', [w.owner.ownerId]);
  const indexOf = (email: string) => blindIndex(indexKey(w.owner), 'email', email);
  const memberOf = (email: string) => { const at = indexOf(email); return members.find((m) => Buffer.compare(m.email_index, at) === 0); };
  const leaving = inviteesOf(change.gone ?? [], organizer).flatMap((e) => {
    const m = memberOf(e);
    return m && m.role === 'edit' && personOfMember(w, m).invited ? [m] : [];
  });
  const joining = inviteesOf(change.add ?? [], organizer).filter((e) => !made.out.includes(e) && !memberOf(e)).slice(0, Math.max(0, MAX_PEOPLE - members.length));
  for (const email of joining) await addMember(w.owner, db, w.workspaceId, email, 'edit', undefined, true);
  for (const m of leaving) await dropMember(w, db, m, 'taken');
  if (joining.length || leaving.length) {
    await saveState(w, db);
    await publish(db, w.workspaceId, TREE_NOTICE);
    wlog.info('call home follows its invite', { workspaceId: w.workspaceId, added: joining.length, removed: leaving.length });
  }
  return { added: joining.length, removed: leaving.length };
}
export async function rename(d: Deps, reader: Reader, workspaceId: string, name: string): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    requireRole(w, 'admin');
    w.state = { ...w.state, name };
  });
}
/** What a workspace is for, in one line, for anyone in it. */
export async function about(d: Deps, reader: Reader, workspaceId: string): Promise<string> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireRole(w, 'in');
  return w.state.about;
}
/** Says what a workspace is for, for everyone in it. Admins only, as with its name. */
export async function setAbout(d: Deps, reader: Reader, workspaceId: string, line: string): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    requireRole(w, 'admin');
    if (w.state.about !== line) w.state = { ...w.state, about: line };
  });
  wlog.info('workspace about set', { workspaceId, said: line !== '' });
}
/**
 * Deletes a workspace and everything it holds, in the caller's transaction: its owner row goes, and the rest with it. Only
 * its files' objects outlive that, queued for the caller to collect once it commits.
 */
async function deleteOwner(db: Db, ownerId: string): Promise<void> {
  await releaseWorkspace(db, ownerId);
  await exec(db, 'DELETE FROM owners WHERE owner_id = $1', [ownerId]);
}
export async function remove(d: Deps, reader: Reader, workspaceId: string): Promise<void> {
  const ownerId = await change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'admin');
    await deleteOwner(c, w.owner.ownerId);
    return w.owner.ownerId;
  });
  await collect(d, [ownerId]);
  wlog.info('workspace deleted', { workspaceId });
}

/* ---------- people ---------- */

/**
 * Who a member is, beside the keyed hash of their address, so it goes with their row. `invited`: a call's invite let them into
 * its home, and nobody has changed their place by hand since, so taking them off the invite takes them out again.
 */
const MemberPerson = z.object({ email: z.string(), name: z.string().optional(), invited: z.boolean().default(false) });
const memberHeader = (o: Owner, workspaceId: string, memberId: string): RecordHeader => ({ v: 1, kind: 'workspace-member', ownerId: o.ownerId, workspaceId, memberId });
const Member = z.object({ member_id: z.string(), email_index: bytea, role: z.enum(['admin', 'edit', 'read']), person_ciphertext: bytea, created_at: timestamp });
const sealMember = (o: Owner, workspaceId: string, memberId: string, who: z.input<typeof MemberPerson>): Uint8Array => sealJson(workspaceKey(o), memberHeader(o, workspaceId, memberId), toJson(who));
const personOfMember = (w: Pick<HeldWorkspace, 'owner' | 'workspaceId'>, m: z.infer<typeof Member>) => openJson(workspaceKey(w.owner), memberHeader(w.owner, w.workspaceId, m.member_id), m.person_ciphertext, MemberPerson);
async function addMember(o: Owner, db: Db, workspaceId: string, email: string, role: WorkspaceRole, name?: string | undefined, invited = false): Promise<string> {
  const memberId = id128();
  const person = sealMember(o, workspaceId, memberId, { email: email.trim().toLowerCase(), ...(name ? { name } : {}), ...(invited ? { invited } : {}) });
  await exec(db, 'INSERT INTO workspace_members (owner_id, member_id, email_index, role, person_ciphertext) VALUES ($1,$2,$3,$4,$5)', [o.ownerId, memberId, blindIndex(indexKey(o), 'email', email), role, person]);
  return memberId;
}
/** Someone's place changed by hand: from now on it's theirs, not the invite's, and an address back by hand isn't out any more. */
async function byHand(w: Workspace, db: Db, m: z.infer<typeof Member>): Promise<void> {
  const who = personOfMember(w, m);
  if (who.invited) await exec(db, 'UPDATE workspace_members SET person_ciphertext = $3 WHERE owner_id = $1 AND member_id = $2', [w.owner.ownerId, m.member_id, sealMember(w.owner, w.workspaceId, m.member_id, { ...who, invited: false })]);
  const made = w.state.madeFor;
  if (made?.out.includes(who.email)) w.state = { ...w.state, madeFor: { ...made, out: made.out.filter((e) => e !== who.email) } };
}
const admins = async (w: Workspace, db: Db): Promise<number> => (await maybeOne(db, z.object({ n: z.number() }), "SELECT count(*)::int AS n FROM workspace_members WHERE owner_id = $1 AND role = 'admin'", [w.owner.ownerId]))?.n ?? 0;
const onlyAdmin = (w: Workspace) => new ConflictError('A workspace needs an admin. Make someone else one first.', { context: { workspaceId: w.workspaceId } });
const memberBy = (w: Workspace, db: Db, memberId: string) => maybeOne(db, Member, 'SELECT member_id, email_index, role, person_ciphertext, created_at FROM workspace_members WHERE owner_id = $1 AND member_id = $2', [w.owner.ownerId, memberId]);
const noOne = (w: Workspace, memberId: string) => notFound('That person', { workspaceId: w.workspaceId, memberId });

export async function people(d: Deps, reader: Reader, workspaceId: string): Promise<WorkspacePerson[]> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireRole(w, 'in');
  const found = await rows(d.pool, Member, 'SELECT member_id, email_index, role, person_ciphertext, created_at FROM workspace_members WHERE owner_id = $1 ORDER BY created_at, member_id', [w.owner.ownerId]);
  return found.map((m) => {
    const who = openJson(workspaceKey(w.owner), memberHeader(w.owner, workspaceId, m.member_id), m.person_ciphertext, MemberPerson);
    return { id: m.member_id, person: { ...personOf(who.email, who.name), id: personKey(w.owner, m.email_index) }, role: m.role, since: m.created_at.toISOString(), isMe: reader.principals.some((p) => Buffer.compare(p, m.email_index) === 0) };
  });
}
/**
 * The IDs this workspace's documents know people by, for addresses a document may tag or quote: each keyed under the
 * workspace's own keys, as a member's is (`people`), so an ID in a document says nothing about an address, and nobody can
 * check a guess against one without asking here. Anyone in the workspace may ask about any address; someone who can open
 * something here only through a call, about the people who've been in that call, the organizer among them.
 */
export async function idsOf(d: Deps, reader: Reader, workspaceId: string, emails: string[]): Promise<Record<string, string>> {
  const w = await workspaceFor(d, reader, workspaceId);
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  const inCall = w.role === null && reader.seat ? await addressesIn(reader.seat.viewer) : new Set<string>();
  const may = w.role !== null ? wanted : wanted.filter((e) => inCall.has(e));
  wlog.debug('people’s IDs given', { workspaceId, asked: wanted.length, given: may.length, member: w.role !== null });
  return Object.fromEntries(may.map((e) => [e, personKey(w.owner, blindIndex(indexKey(d), 'email', e))]));
}
export async function addPerson(d: Deps, reader: Reader, workspaceId: string, email: string, role: WorkspaceRole): Promise<{ id: string }> {
  return change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'admin');
    const index = blindIndex(indexKey(d), 'email', email);
    const there = await maybeOne(c, Member, 'SELECT member_id, email_index, role, person_ciphertext, created_at FROM workspace_members WHERE owner_id = $1 AND email_index = $2', [w.owner.ownerId, index]);
    if (!there) {
      if (w.people >= MAX_PEOPLE) throw new ConflictError('This workspace has as many people as it can. Take someone out first.', { context: { workspaceId, people: w.people } });
      const id = await addMember(w.owner, c, workspaceId, email, role);
      const made = w.state.madeFor;
      const address = email.trim().toLowerCase();
      if (made?.out.includes(address)) w.state = { ...w.state, madeFor: { ...made, out: made.out.filter((e) => e !== address) } };
      wlog.info('person added', { workspaceId, memberId: id, role });
      return { id };
    }
    await setMemberRole(w, c, there, role);
    await byHand(w, c, there);
    return { id: there.member_id };
  });
}
async function setMemberRole(w: Workspace, db: Db, m: z.infer<typeof Member>, role: WorkspaceRole): Promise<void> {
  if (m.role === 'admin' && role !== 'admin' && (await admins(w, db)) <= 1) throw onlyAdmin(w);
  await exec(db, 'UPDATE workspace_members SET role = $3 WHERE owner_id = $1 AND member_id = $2', [w.owner.ownerId, m.member_id, role]);
  wlog.info('role changed', { workspaceId: w.workspaceId, memberId: m.member_id, role });
}
export async function setRole(d: Deps, reader: Reader, workspaceId: string, memberId: string, role: WorkspaceRole): Promise<void> {
  await change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'admin');
    const m = await memberBy(w, c, memberId);
    if (!m) throw noOne(w, memberId);
    await setMemberRole(w, c, m, role);
    await byHand(w, c, m);
  });
}
export async function removePerson(d: Deps, reader: Reader, workspaceId: string, memberId: string): Promise<void> {
  await change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'in');
    const m = await memberBy(w, c, memberId);
    const leaving = m !== undefined && reader.principals.some((p) => Buffer.compare(p, m.email_index) === 0);
    if (!leaving) requireRole(w, 'admin');
    if (!m) throw noOne(w, memberId);
    if (m.role === 'admin' && (await admins(w, c)) <= 1) throw onlyAdmin(w);
    const stranded = await dropMember(w, c, m, leaving ? 'left' : 'taken');
    // A call's invite never puts back someone taken out by hand, or who left. The newest are kept, as many as can be in it.
    const made = w.state.madeFor;
    const { email } = personOfMember(w, m);
    if (made && !made.out.includes(email)) w.state = { ...w.state, madeFor: { ...made, out: [...made.out, email].slice(-MAX_PEOPLE) } };
    wlog.info('person removed', { workspaceId, memberId, leaving, stranded });
  });
}
/**
 * Takes someone out, in the caller's transaction, which holds the workspace's row; the caller saves the state. What they had
 * by restricting something goes with them, so coming back gives them only what they're given. What only they could reach:
 * taken out (`taken`, by an admin or by a call's invite), it goes to the workspace's admins (`handStranded`), so nobody's
 * words are lost to a change nobody made of that document; leaving (`left`), it's still theirs, in Trash, for 30 days, should
 * they come back (`trashStranded`), and nobody else's to read. How much did.
 */
async function dropMember(w: HeldWorkspace, c: Db, m: z.infer<typeof Member>, why: 'taken' | 'left'): Promise<number> {
  await exec(c, 'DELETE FROM workspace_members WHERE owner_id = $1 AND member_id = $2', [w.owner.ownerId, m.member_id]);
  await exec(c, 'DELETE FROM workspace_mentions WHERE owner_id = $1 AND principal_index = $2', [w.owner.ownerId, m.email_index]);
  const { email } = personOfMember(w, m);
  w.state = { ...w.state, items: Object.fromEntries(Object.entries(w.state.items).map(([id, x]) => [id, x.restrictedBy === email ? { ...x, restrictedBy: null } : x])) };
  return why === 'taken' ? handStranded(w, c) : trashStranded(w, c);
}

/* ---------- the tree ---------- */

export interface NewItem { kind: ItemKind; name: string; parent: string | null; after?: string | null | undefined }
/**
 * Who a new item is by, or nobody in particular (`null`); its id, when one was taken for it already; and, for a breakout
 * room's board, the call that's for, which makes it restricted with only what the call gives opening it.
 */
export interface Making { by: Maker | null; id?: string | undefined; room?: StoredItem['room'] | undefined }
/** Puts something new in `w.state`, in the caller's transaction, which holds the workspace's row and saves it. */
async function addItem(w: HeldWorkspace, c: Db, input: NewItem, made: Making): Promise<string> {
  requireRoom(w, 1);
  const id = made.id ?? id128();
  const room = made.room ?? null;
  const at = new Date().toISOString();
  w.state = withItem(w.state, id, {
    kind: input.kind, name: input.name, parent: input.parent, pos: positionIn(w.state, input.parent, input.after), by: made.by, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null,
    restricted: room !== null, restrictedBy: null, call: null, room
  });
  if (holdsContent(input.kind)) await addDocuments(w, c, [id]);
  if (input.kind === 'document') await startContent(w, c, [id]);
  if (made.by) await noteAuthor(w, c, made.by.email);
  wlog.info('item created', { workspaceId: w.workspaceId, itemId: id, kind: input.kind, room: room !== null });
  return id;
}
export async function createItem(d: Deps, reader: Reader, workspaceId: string, input: NewItem): Promise<{ id: string }> {
  return change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'change');
    const parent = landing(reader, w, input.parent);
    requireDepth(w, parent, input.kind === 'folder' ? 1 : 0);
    if (input.after) requireItem(reader, w, input.after);
    return { id: await addItem(w, c, { ...input, parent }, { by: makerOf(reader) }) };
  });
}
/**
 * A board the server makes for a call, in the caller's transaction, which holds the workspace's row: the same as making one
 * here, for someone in the call who needn't be in the workspace. `made.by` is who it's made for; a breakout room's board is
 * nobody's, with the room's call as `made.room`. It goes in the call's folder (`folder`), beside its notes, while that's there
 * and not in Trash, and at the top of the tree otherwise. `made.id`, taken for it under the call's row, makes it once.
 */
export async function addBoard(w: HeldWorkspace, db: Db, name: string, made: Making, folder: string | null = null): Promise<string> {
  if (made.id && w.state.items[made.id]) return made.id;
  const into = folder !== null && w.state.items[folder]?.kind === 'folder' && !trashOf(w.state, folder) ? folder : null;
  const id = await addItem(w, db, { kind: 'board', name, parent: into }, made);
  await saveState(w, db);
  await publish(db, w.workspaceId, TREE_NOTICE);
  return id;
}
export async function renameItem(d: Deps, reader: Reader, workspaceId: string, itemId: string, name: string): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    const { item: it } = requireEditable(reader, w, itemId);
    w.state = withItem(w.state, itemId, { ...it, name, editedAt: new Date().toISOString() });
  });
  // A name changed from a call shows in it, as the board's or what's presented: the call is told to look again.
  if (reader.seat) await tellCall(d, reader.seat.callId);
}
export async function moveItem(d: Deps, reader: Reader, workspaceId: string, itemId: string, to: ItemPlace): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    requireRole(w, 'change');
    const { item: it } = requireEditable(reader, w, itemId);
    const parent = landing(reader, w, to.parent);
    if (to.after) requireItem(reader, w, to.after);
    // A folder can't go inside itself. Folders are the only parents, and nobody in a workspace has one hidden from them.
    for (let at = parent; at !== null; at = w.state.items[at]?.parent ?? null) {
      if (at === itemId) throw invalid('A folder can’t go inside itself.', { workspaceId, itemId });
    }
    requireDepth(w, parent, heightOf(w.state, itemId));
    w.state = withItem(w.state, itemId, { ...it, parent, pos: positionIn(w.state, parent, to.after, itemId) });
  });
}
/**
 * A document the server makes beside another, in the caller's transaction, which holds the workspace's row: in the same
 * folder, just after it, for the same people. What the other is restricted to, this is restricted to, so nothing carried
 * over from it reaches anyone new; seats ended with their call. It starts from the seed: what it says is written after. `id`,
 * when what's making it has settled on one already.
 */
export async function addBeside(w: HeldWorkspace, db: Db, like: string, name: string, id: string = id128()): Promise<string> {
  const from = w.state.items[like];
  if (!from) throw notFound('That document', { workspaceId: w.workspaceId, documentId: like });
  if (Object.keys(w.state.items).length >= MAX_ITEMS) throw new ConflictError('This workspace is full. Delete something from it first.', { context: { workspaceId: w.workspaceId } });
  const at = new Date().toISOString();
  w.state = withItem(w.state, id, {
    kind: 'document', name, parent: from.parent, pos: positionIn(w.state, from.parent, like), by: from.by, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: from.restricted, restrictedBy: from.restrictedBy, call: null, room: null
  });
  await addDocuments(w, db, [id]);
  await startContent(w, db, [id]);
  const shared = await rows(db, ShareRow, "SELECT access_id, kind, role, person_ciphertext, created_at FROM document_access WHERE owner_id = $1 AND document_id = $2 AND kind = 'email'", [w.owner.ownerId, like]);
  const grants = shared.flatMap((r) => { const { email } = openSharedPerson(w.owner, w.workspaceId, like, r.access_id, r.person_ciphertext); return email ? [{ kind: 'email' as const, email, role: r.role }] : []; });
  if (grants.length) await grant(w, db, id, grants);
  await saveState(w, db);
  await publish(db, w.workspaceId, TREE_NOTICE);
  wlog.info('item made beside another', { workspaceId: w.workspaceId, itemId: id, shared: grants.length });
  return id;
}

interface Copied { from: string; id: string; item: StoredItem }
/** A copy of `id`, and of everything `reader` can open in it, by a new person and shared with nobody. The copy of `id` comes first. A copy of a call's folder is a folder: the call's pages stay with the call's own. */
function copied(reader: Reader, w: Workspace, id: string, parent: string | null, pos: string, name: string): Copied[] {
  const kids = childrenIn(w.state);
  const at = new Date().toISOString();
  const out: Copied[] = [];
  const stack = [{ from: id, copy: id128(), parent, pos, name }];
  for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
    const source = w.state.items[x.from];
    if (!source) continue;
    out.push({ from: x.from, id: x.copy, item: { ...source, name: x.name, parent: x.parent, pos: x.pos, by: makerOf(reader), createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restrictedBy: null, call: null, room: null } });
    for (const child of kids.get(x.from) ?? []) {
      if (!child.item.trashedAt && roleOf(reader, w, child.id, child.item)) stack.push({ from: child.id, copy: id128(), parent: x.copy, pos: child.item.pos, name: child.item.name });
    }
  }
  return out;
}
/**
 * Takes a copy that couldn't be filled away for good, as the server's own doing: this request made it, so it needs nothing of
 * whoever asked, who may make things here only through a call, or have lost even that since. Only what it made goes, and only
 * while it's still in the copy: anything someone put in it meanwhile comes out to where the copy was, first.
 */
async function unmake(d: Deps, workspaceId: string, made: string[]): Promise<void> {
  const ours = new Set(made);
  const ownerId = await tx(d.pool, async (c) => {
    const w = await serverWorkspace(d, workspaceId, c, 'change');
    const top = made[0];
    const copy = top === undefined ? undefined : w?.state.items[top];
    if (!w || top === undefined || !copy) return undefined;
    const inCopy = [top, ...insideOf(w.state, [top])];
    const theirs = inCopy.filter((x) => !ours.has(x) && ours.has(w.state.items[x]?.parent ?? ''));
    const places = positionsAfter((childrenIn(w.state).get(copy.parent) ?? []).at(-1)?.pos ?? null, theirs.length);
    const items = { ...w.state.items };
    theirs.forEach((x, i) => {
      const found = items[x];
      const pos = places[i];
      if (found && pos) items[x] = { ...found, parent: copy.parent, pos };
    });
    const gone = inCopy.filter((x) => ours.has(x));
    await removeDocuments(w.owner, c, gone);
    w.state = withoutItems({ ...w.state, items }, gone);
    await saveState(w, c);
    await publish(c, workspaceId, TREE_NOTICE);
    wlog.info('a copy that wasn’t filled was taken away', { workspaceId, copy: top, items: gone.length, kept: theirs.length });
    return w.owner.ownerId;
  });
  if (ownerId) await collect(d, [ownerId]);
}
export async function duplicateItem(d: Deps, reader: Reader, workspaceId: string, itemId: string): Promise<{ id: string }> {
  const { place, id, made, content } = await change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'change');
    const { item: it } = requireEditable(reader, w, itemId);
    requireDepth(w, it.parent, heightOf(w.state, itemId));
    const name = it.name ? `${it.name.slice(0, MAX_NAME - ' copy'.length)} copy` : '';
    const out = copied(reader, w, itemId, it.parent, positionIn(w.state, it.parent, itemId), name);
    const id = out[0]?.id ?? '';
    requireRoom(w, out.length);
    w.state = { ...w.state, items: { ...w.state.items, ...Object.fromEntries(out.map((x) => [x.id, x.item])) } };
    const content = out.filter((x) => holdsContent(x.item.kind));
    await addDocuments(w, c, content.map((x) => x.id));
    await startContent(w, c, content.filter((x) => x.item.kind === 'document').map((x) => x.id));
    await copyUses(w.owner, c, content.map((x) => ({ from: x.from, to: x.id })));
    await noteAuthor(w, c, makerOf(reader).email);
    wlog.info('item duplicated', { workspaceId, itemId, copy: id, items: out.length });
    return { place: w, id, made: out.map((x) => x.id), content };
  });
  // What they hold comes after the lock, so nobody's typing waits on it. They start from the seed, like anything new.
  try {
    for (const x of content) await copyContent(place, x.from, x.id, kindOf(x.item), x.item.name, limitKey(reader));
  } catch (e) {
    // A copy that says less than what it's a copy of is worse than none: it goes for good, and they try again.
    await unmake(d, workspaceId, made).catch((err: unknown) => wlog.warn('a copy that wasn’t filled stayed in the tree', { workspaceId, itemId, copy: id, err }));
    throw e;
  }
  return { id };
}
/**
 * What's inside `id` that `reader` couldn't send to Trash or delete by itself comes out to `to` before anything happens to
 * the folder: nobody decides the fate of what they can only read, or can't see, and it never says that it was there. It
 * runs under the workspace's lock, so it goes through the tree once however much comes out.
 */
function liftOut(reader: Reader, w: Workspace, id: string, to: string | null): void {
  const out = insideOf(w.state, [id]).filter((x) => { const found = w.state.items[x]; return found !== undefined && roleOf(reader, w, x, found) !== 'edit'; });
  if (!out.length) return;
  const places = positionsAfter((childrenIn(w.state).get(to) ?? []).at(-1)?.pos ?? null, out.length);
  const items = { ...w.state.items };
  out.forEach((x, i) => {
    const found = items[x];
    const pos = places[i];
    if (found && pos) items[x] = { ...found, parent: to, pos };
  });
  w.state = { ...w.state, items };
}
export async function trashItem(d: Deps, reader: Reader, workspaceId: string, itemId: string): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    requireRole(w, 'change');
    const { item: it } = requireEditable(reader, w, itemId, 'fine');
    if (trashOf(w.state, itemId)) return;
    liftOut(reader, w, itemId, it.parent);
    // A guest in a call is who they are there, as on what they make (`makerOf`).
    w.state = withItem(w.state, itemId, { ...it, trashedAt: new Date().toISOString(), trashedBy: reader.account?.name ?? reader.seat?.name ?? '' });
    wlog.info('item sent to Trash', { workspaceId, itemId });
  });
}
export async function restoreItem(d: Deps, reader: Reader, workspaceId: string, itemId: string): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    const { item: it } = requireEditable(reader, w, itemId, 'fine');
    const above = trashOf(w.state, it.parent);
    if (!it.trashedAt && !above) return;
    // Its folder isn't in the tree any more: it comes back to the top.
    w.state = withItem(w.state, itemId, { ...it, trashedAt: null, trashedBy: null, ...(above ? { parent: null, pos: positionIn(w.state, null, undefined, itemId) } : {}) });
    wlog.info('item restored', { workspaceId, itemId });
  });
}
/** The nearest folder from `parent` up that's still in the tree, or the top: above the topmost thing in Trash, which takes all that's under it. */
function nearestInTree(s: WorkspaceState, parent: string | null): string | null {
  const seen = new Set<string>();
  for (let at = parent; at !== null && !seen.has(at); at = s.items[at]?.parent ?? null) seen.add(at);
  const chain = [...seen];
  return chain[chain.findLastIndex((x) => s.items[x]?.trashedAt) + 1] ?? null;
}
export async function deleteItem(d: Deps, reader: Reader, workspaceId: string, itemId: string): Promise<void> {
  const ownerId = await change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'edit');
    const { item: it } = requireEditable(reader, w, itemId, 'fine');
    if (!trashOf(w.state, itemId)) throw new ConflictError('Move it to Trash first.', { context: { workspaceId, itemId } });
    liftOut(reader, w, itemId, nearestInTree(w.state, it.parent));
    const gone = [itemId, ...insideOf(w.state, [itemId])];
    await removeDocuments(w.owner, c, gone);
    w.state = withoutItems(w.state, gone);
    wlog.info('item deleted for good', { workspaceId, itemId, items: gone.length });
    return w.owner.ownerId;
  });
  await collect(d, [ownerId]);
}

/* ---------- sharing ---------- */

const ShareRow = z.object({ access_id: z.string(), kind: z.enum(['email', 'seat']), role: z.enum(['edit', 'read']), person_ciphertext: bytea, created_at: timestamp });
/** With how access knows them, which for a seat is all there is to find them by. */
const ShareRowIndexed = ShareRow.extend({ principal_index: bytea });
/** The addresses of everyone in the workspace who can open this, by the rule that decides it, and everyone it's given to. */
async function whoCanOpen(w: Workspace, documentId: string, item: StoredItem, entries: ShareEntry[]): Promise<string[]> {
  const found = await rows(w.owner.pool, Member, 'SELECT member_id, email_index, role, person_ciphertext, created_at FROM workspace_members WHERE owner_id = $1', [w.owner.ownerId]);
  const members = found.flatMap((m) => {
    const { email } = openJson(workspaceKey(w.owner), memberHeader(w.owner, w.workspaceId, m.member_id), m.person_ciphertext, MemberPerson);
    return roleOf({ email, principals: [m.email_index], calls: [] }, { role: m.role, grants: new Map() }, documentId, item) ? [email] : [];
  });
  return [...new Set([...members, ...entries.flatMap((e) => (e.kind === 'email' ? [e.person.email] : []))])];
}
export async function shareList(d: Deps, reader: Reader, workspaceId: string, documentId: string): Promise<DocumentShare> {
  const w = await workspaceFor(d, reader, workspaceId);
  const { item: it } = requireSharing(reader, w, documentId);
  const found = await rows(d.pool, ShareRowIndexed, 'SELECT access_id, kind, role, principal_index, person_ciphertext, created_at FROM document_access WHERE owner_id = $1 AND document_id = $2 ORDER BY created_at, access_id', [w.owner.ownerId, documentId]);
  const entries = found.map((r): ShareEntry => {
    const who = openSharedPerson(w.owner, workspaceId, documentId, r.access_id, r.person_ciphertext);
    const person: Person = who.email !== undefined ? personOf(who.email) : { id: r.access_id, name: who.name ?? '', email: '', portrait: portraitFor(r.access_id) };
    return { id: r.access_id, kind: r.kind, person, role: r.role, since: r.created_at.toISOString() };
  });
  /* A seat's hash can't be read back, so it's the seats in this reader's own call that are looked for. */
  const given = new Set(found.filter((r) => r.kind === 'seat').map((r) => b64u(r.principal_index)));
  const inCall = reader.seat && given.size > 0 ? [...(await seated(reader.seat.viewer)).keys()] : [];
  const callId = reader.seat?.callId ?? '';
  return { workspace: { name: w.state.name, people: w.people }, restricted: it.restricted, entries, canOpen: await whoCanOpen(w, documentId, it, entries), seats: inCall.filter((s) => given.has(b64u(seatIndex(d, callId, s)))) };
}
/** The calls a document is open to by a seat in, live or not: the ones a change to who has it could matter to now. */
async function seatedIn(db: Db, ownerId: string, documentId: string): Promise<string[]> {
  const found = await rows(db, z.object({ call_id: z.string() }), 'SELECT DISTINCT call_id FROM document_access WHERE owner_id = $1 AND document_id = $2 AND call_id IS NOT NULL', [ownerId, documentId]);
  return found.map((r) => r.call_id);
}
/**
 * A change to who has a document is told at once to the call it was made from, and to every call it's open to by a seat in,
 * so everyone's role there changes then and not at their next read: a board open in a call goes read-only, or opens, in a moment.
 * Only a call that's on hears it.
 */
async function tellCalls(d: Deps, reader: Reader, seated: readonly string[]): Promise<void> {
  const calls = new Set(seated);
  if (reader.seat) calls.add(reader.seat.callId);
  for (const callId of calls) await tellCall(d, callId);
}
export async function share(d: Deps, reader: Reader, workspaceId: string, documentId: string, to: ShareTarget[], role: DocumentRole): Promise<void> {
  const grants = await grantsFor(reader, to, role);
  const seated = await change(d, reader, workspaceId, async (w, c) => {
    requireSharing(reader, w, documentId);
    await grant(w, c, documentId, grants);
    wlog.info('document shared', { workspaceId, documentId, people: grants.length, role });
    return seatedIn(c, w.owner.ownerId, documentId);
  });
  // What's shared with someone in a call opens by itself, and a role changed in one changes there: its calls look again.
  await tellCalls(d, reader, seated);
}
export async function unshare(d: Deps, reader: Reader, workspaceId: string, documentId: string, accessId: string): Promise<void> {
  const seated = await change(d, reader, workspaceId, async (w, c) => {
    requireSharing(reader, w, documentId);
    const removed = await maybeOne(c, z.object({ call_id: z.string().nullable() }), 'DELETE FROM document_access WHERE owner_id = $1 AND document_id = $2 AND access_id = $3 RETURNING call_id', [w.owner.ownerId, documentId, accessId]);
    if (!removed) throw notFound('That person', { workspaceId, documentId });
    await trashStranded(w, c);
    wlog.info('document unshared', { workspaceId, documentId, accessId });
    return [...(removed.call_id ? [removed.call_id] : []), ...await seatedIn(c, w.owner.ownerId, documentId)];
  });
  await tellCalls(d, reader, seated);
}
export async function restrict(d: Deps, reader: Reader, workspaceId: string, documentId: string, restricted: boolean): Promise<void> {
  const seated = await change(d, reader, workspaceId, async (w, c) => {
    const { item: it } = requireSharing(reader, w, documentId);
    if (it.restricted === restricted) return null;
    // Whoever restricts something they didn't make would otherwise lock themselves out of it: they keep it as its creator does.
    const me = makerOf(reader).email;
    const keeper = restricted && it.by?.email !== me ? me : null;
    w.state = withItem(w.state, documentId, { ...it, restricted, restrictedBy: keeper });
    if (keeper) await noteAuthor(w, c, keeper);
    wlog.info('document restricted', { workspaceId, documentId, restricted });
    return seatedIn(c, w.owner.ownerId, documentId);
  });
  if (seated) await tellCalls(d, reader, seated);
}

/* ---------- upkeep and deleted accounts ---------- */

const Held = z.object({ workspace_id: z.string(), owner_id: z.string(), state_ciphertext: bytea });
interface HeldWorkspace { owner: Owner; workspaceId: string; state: WorkspaceState }
/** A workspace by its owner, locked for the rest of the transaction. Gone since it was found: undefined. */
async function held(d: Deps, db: Db, ownerId: string): Promise<HeldWorkspace | undefined> {
  const row = await maybeOne(db, Held, 'SELECT workspace_id, owner_id, state_ciphertext FROM workspaces WHERE owner_id = $1 FOR NO KEY UPDATE', [ownerId]);
  const owner = row && await findOwner(d, row.owner_id, undefined, db);
  return row && owner ? { owner, workspaceId: row.workspace_id, state: openState(owner, row.workspace_id, row.state_ciphertext) } : undefined;
}

/** A call as a workspace's tree names one, by its organizer and itself. */
interface TreeCall { ownerId: string; callId: string }
const callKey = (c: TreeCall): string => `${c.ownerId}/${c.callId}`;
/** Which of these calls are going on. */
async function liveCalls(db: Db, calls: TreeCall[]): Promise<Set<string>> {
  if (!calls.length) return new Set();
  const live = await rows(db, z.object({ owner_id: z.string(), call_id: z.string() }), `SELECT owner_id, call_id FROM calls WHERE state = 'live'
    AND (owner_id, call_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))`, [calls.map((r) => r.ownerId), calls.map((r) => r.callId)]);
  return new Set(live.map((r) => callKey({ ownerId: r.owner_id, callId: r.call_id })));
}
/**
 * A breakout room's board whose call is over without having kept it, as a release before this one ended its calls: kept now
 * for everyone the call invited, by address at `edit`, as its end would have, unless they have an entry on it already, and from
 * then on a restricted board like any other. One whose call, or its organizer, is gone is one already. In the caller's
 * transaction, which holds the workspace's row and saves its state.
 */
async function keepRoomsOfEndedCalls(w: HeldWorkspace, db: Db): Promise<void> {
  const marked = Object.entries(w.state.items).flatMap(([id, item]) => (item.room ? [{ id, item, room: item.room }] : []));
  if (!marked.length) return;
  const live = await liveCalls(db, marked.map((m) => m.room));
  const over = marked.filter((m) => !live.has(callKey(m.room)));
  if (!over.length) return;
  const said = await roomsOfCalls(w.owner, over.map((m) => m.room), db);
  const items = { ...w.state.items };
  let kept = 0;
  for (const m of over) {
    const call = said.get(callKey(m.room));
    const invited = call && !call.live ? call.invited : [];
    try {
      const has = await entriesOn(w, db, m.id, invited.map((e) => emailIndex(w.owner, e)));
      const giving = invited.filter((e) => has(emailIndex(w.owner, e)) === undefined);
      if (giving.length) await grant(w, db, m.id, giving.map((email): Grant => ({ kind: 'email', email, role: 'edit' })));
    } catch (e) {
      // Kept as its call's, so nothing strands it, and tried again the next time anything here asks.
      if (e instanceof ConflictError) { wlog.warn('a room’s board not kept after its call', { workspaceId: w.workspaceId, itemId: m.id, err: e }); continue; }
      throw e;
    }
    items[m.id] = { ...m.item, room: null };
    kept++;
  }
  w.state = { ...w.state, items };
  if (kept) wlog.info('rooms’ boards kept after their calls', { workspaceId: w.workspaceId, boards: kept });
}
/**
 * The boards calls going on keep for their rooms, of every call with its folder here: a room's board the tree lost the mark of,
 * as a release that didn't know rooms' boards saves the tree, is still its call's.
 */
async function liveRoomBoards(w: HeldWorkspace, db: Db): Promise<Set<string>> {
  const calls = Object.values(w.state.items).flatMap((x): TreeCall[] => (x.kind === 'folder' && x.call ? [{ ownerId: x.call.ownerId, callId: x.call.callId }] : []));
  const live = await liveCalls(db, calls);
  const going = calls.filter((c) => live.has(callKey(c)));
  if (!going.length) return new Set();
  return new Set([...(await roomsOfCalls(w.owner, going, db)).values()].flatMap((x) => (x.live ? x.boards : [])));
}
/**
 * What's restricted and nobody can open any more: no creator or restrictor in the workspace, and nobody it's shared with.
 * Each address is hashed once however many things carry it, and this reads under the lock, so it stays one pass. A breakout
 * room's board is its call's to give until the call has kept it for everyone invited, so it's never stranded: while its call
 * goes on, whatever the tree says of it, since its people come and go; and a call that ended without keeping it has it kept
 * now (`keepRoomsOfEndedCalls`), which is why this is in the caller's transaction, which saves the state.
 */
async function strandedIn(w: HeldWorkspace, db: Db): Promise<string[]> {
  await keepRoomsOfEndedCalls(w, db);
  const restricted = Object.entries(w.state.items).filter(([, x]) => x.restricted && !x.room);
  if (!restricted.length) return [];
  const members = new Set((await rows(db, z.object({ email_index: bytea }), 'SELECT email_index FROM workspace_members WHERE owner_id = $1', [w.owner.ownerId])).map((r) => b64u(r.email_index)));
  const given = new Set((await rows(db, z.object({ document_id: z.string() }), 'SELECT DISTINCT document_id FROM document_access WHERE owner_id = $1 AND document_id = ANY($2::text[])', [w.owner.ownerId, restricted.map(([id]) => id)])).map((r) => r.document_id));
  const indexes = new Map<string, string>();
  const inHere = (email: string | null | undefined): boolean => {
    if (!email) return false;
    const index = indexes.get(email) ?? b64u(blindIndex(indexKey(w.owner), 'email', email));
    indexes.set(email, index);
    return members.has(index);
  };
  const lost = restricted.filter(([id, x]) => !given.has(id) && !inHere(x.by?.email) && !inHere(x.restrictedBy)).map(([id]) => id);
  if (!lost.length) return lost;
  const rooms = await liveRoomBoards(w, db);
  return lost.filter((id) => !rooms.has(id));
}
/**
 * Gives the workspace's admins what nobody can open any more because someone was taken out: restricted as it was, shared with
 * each admin to edit, so they decide its fate and nobody's words go to Trash for a change of people. In the caller's
 * transaction, which holds the workspace's row. How many it gave.
 */
async function handStranded(w: HeldWorkspace, db: Db): Promise<number> {
  const stranded = (await strandedIn(w, db)).filter((id) => !w.state.items[id]?.trashedAt);
  if (!stranded.length) return 0;
  // Its longest-standing hundred admins at most: any of them can give it on.
  const admins = await rows(db, Member, "SELECT member_id, email_index, role, person_ciphertext, created_at FROM workspace_members WHERE owner_id = $1 AND role = 'admin' ORDER BY created_at, member_id LIMIT 100", [w.owner.ownerId]);
  const to = admins.map((m): Grant => ({ kind: 'email', email: personOfMember(w, m).email, role: 'edit' }));
  // A workspace always keeps an admin, so there's someone to give it to; were there nobody, Trash is all that's left.
  if (!to.length) return trashStranded(w, db);
  for (const id of stranded) await grant(w, db, id, to);
  wlog.info('restricted things given to the admins', { workspaceId: w.workspaceId, documents: stranded.length, admins: to.length });
  return stranded.length;
}
/**
 * Sends to Trash what nobody can open any more, rather than leave it sealed for good: nobody who could decide its fate can
 * see it, so it isn't deleted now, and it isn't given to anyone. Its creator finds it in Trash if they come back within 30
 * days, and after that it goes as anything there does. Returns how many went.
 */
async function trashStranded(w: HeldWorkspace, db: Db): Promise<number> {
  const stranded = (await strandedIn(w, db)).filter((id) => !w.state.items[id]?.trashedAt);
  if (!stranded.length) return 0;
  const at = new Date().toISOString();
  const items = { ...w.state.items };
  for (const id of stranded) {
    const found = items[id];
    if (found) items[id] = { ...found, trashedAt: at, trashedBy: null };
  }
  w.state = { ...w.state, items };
  return stranded.length;
}

const Due = z.object({ owner_id: z.string(), workspace_id: z.string(), trash_since: timestamp });
/**
 * Deletes for good what's been in Trash for `ageMs` as of `now`, with what's in it, and returns how many things went. Each
 * workspace goes in a transaction of its own, and one that fails is logged and left for next time: nothing in one workspace
 * can stop the others.
 */
export async function sweepTrash(d: Deps, ageMs: number = TRASH_MS, now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - ageMs);
  let deleted = 0;
  let after: z.infer<typeof Due> | undefined;
  for (;;) {
    const due = await rows(d.pool, Due, `SELECT owner_id, workspace_id, trash_since FROM workspaces WHERE trash_since < $1 AND ($2::timestamptz IS NULL OR (trash_since, owner_id) > ($2::timestamptz, $3::text))
      ORDER BY trash_since, owner_id LIMIT $4`, [cutoff, after?.trash_since ?? null, after?.owner_id ?? '', TRASH_BATCH]);
    for (const { owner_id: ownerId, workspace_id: workspaceId } of due) {
      try {
        deleted += await tx(d.pool, async (c) => {
          const w = await held(d, c, ownerId);
          if (!w) return 0;
          const old = Object.entries(w.state.items).filter(([, i]) => i.trashedAt !== null && Date.parse(i.trashedAt) < cutoff.getTime()).map(([id]) => id);
          const gone = [...old, ...insideOf(w.state, old)];
          await removeDocuments(w.owner, c, gone);
          w.state = withoutItems(w.state, gone);
          await saveState(w, c);
          await publish(c, w.workspaceId, TREE_NOTICE);
          return gone.length;
        });
      } catch (e) {
        wlog.warn('workspace’s Trash not swept', { workspaceId, err: e });
      }
    }
    await collect(d, due.map((x) => x.owner_id));
    after = due.at(-1);
    if (due.length < TRASH_BATCH) return deleted;
  }
}

/** What ending calls' seats took: seats' rows in `document_access`, and the workspaces the calls were open to (`workspace_calls`). */
export interface SeatsEnded { seats: number; workspaces: number }
const NONE_ENDED: SeatsEnded = { seats: 0, workspaces: 0 };
/** Takes the seats these rows find out of each workspace, under that workspace's lock, as anything else that changes who has what. */
async function dropSeats(d: Deps, ownerIds: string[], remove: (db: Db, ownerId: string) => Promise<SeatsEnded>): Promise<SeatsEnded> {
  let seats = 0;
  let workspaces = 0;
  for (const ownerId of ownerIds) {
    try {
      const n = await tx(d.pool, async (c) => {
        const w = await held(d, c, ownerId);
        if (!w) return NONE_ENDED;
        const taken = await remove(c, ownerId);
        await trashStranded(w, c);
        await saveState(w, c);
        await publish(c, w.workspaceId, TREE_NOTICE);
        return taken;
      });
      seats += n.seats;
      workspaces += n.workspaces;
    } catch (e) {
      wlog.warn('seats not ended', { ownerId, err: e });
    }
  }
  return { seats, workspaces };
}
const OwnerRow = z.object({ owner_id: z.string() });
const SEATS_OF_CALLS = "DELETE FROM document_access WHERE owner_id = $1 AND kind = 'seat' AND call_id = ANY($2::text[])";
const OPEN_TO_CALLS = 'DELETE FROM workspace_calls WHERE owner_id = $1 AND call_id = ANY($2::text[])';
/**
 * Takes away everything these calls gave people's seats, wherever it was given, and closes every workspace they were open to
 * (`openToCall`). Seats stop opening anything when their call ends, whatever's left here: this is so nothing outlives it.
 */
export async function endSeats(d: Deps, callIds: string[]): Promise<SeatsEnded> {
  const found = await rows(d.pool, OwnerRow, `SELECT owner_id FROM document_access WHERE kind = 'seat' AND call_id = ANY($1::text[])
    UNION SELECT owner_id FROM workspace_calls WHERE call_id = ANY($1::text[]) ORDER BY owner_id`, [callIds]);
  const ended = await dropSeats(d, found.map((r) => r.owner_id), async (db, ownerId) => ({ seats: await exec(db, SEATS_OF_CALLS, [ownerId, callIds]), workspaces: await exec(db, OPEN_TO_CALLS, [ownerId, callIds]) }));
  if (ended.seats || ended.workspaces) wlog.info('seats ended', { calls: callIds.length, seats: ended.seats, workspaces: ended.workspaces });
  return ended;
}
/**
 * The same for one seat, when its person is taken out of the call: whatever was given to the seat goes. What the call opens to
 * everyone in it stays open to everyone else, so no row of that goes; every workspace it reached is told the seat ended
 * (`seatEnded`), and the streams that carry it look again at once, and close for anyone it was all they had.
 */
export async function endSeat(d: Deps, callId: string, seat: string): Promise<void> {
  const index = seatIndex(d, callId, seat);
  const found = await rows(d.pool, OwnerRow, 'SELECT owner_id FROM document_access WHERE principal_index = $1 ORDER BY owner_id', [index]);
  await dropSeats(d, found.map((r) => r.owner_id), async (db, ownerId) => ({ seats: await exec(db, 'DELETE FROM document_access WHERE owner_id = $1 AND principal_index = $2', [ownerId, index]), workspaces: 0 }));
  await seatEnded(d, callId, seat);
}
/** Ends seats whose call is over, and what it opened, should nothing else have: a call's end does it, but not if the process stopped in between. */
export async function sweepSeats(d: Deps): Promise<SeatsEnded> {
  const over = await rows(d.pool, z.object({ call_id: z.string() }), `SELECT a.call_id FROM document_access a WHERE a.kind = 'seat'
      AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.call_id = a.call_id AND c.state = 'live')
    UNION SELECT w.call_id FROM workspace_calls w WHERE NOT EXISTS (SELECT 1 FROM calls c WHERE c.call_id = w.call_id AND c.state = 'live')`);
  return over.length ? endSeats(d, over.map((r) => r.call_id)) : NONE_ENDED;
}

/**
 * An account is being deleted, in the caller's transaction: it comes out of every workspace its address still appears in,
 * as a member, on a document, or on something it made or restricted there, unless another account still signs in with that
 * address; and what its calls (`callIds`) gave people's seats ends either way. A workspace left with nobody in it is
 * deleted; one left with no admin gets its longest-standing person as its admin; a restricted document only it could open
 * goes, and anything else left with nobody to open it goes to Trash; and what it made keeps its name and no longer its
 * address. Every row is touched under its workspace's lock, the order every change takes, and locks go in order of owner,
 * so two accounts leaving together never deadlock. `owners` are the workspaces it touched, for the caller to collect their
 * files' objects once the transaction commits.
 */
export async function forgetAccount(o: Owner, db: Db, email: string, callIds: string[]): Promise<{ workspaces: number; deleted: number; owners: string[] }> {
  const address = email.trim().toLowerCase();
  const index = blindIndex(indexKey(o), 'email', address);
  const elsewhere = await maybeOne(db, z.object({ n: z.number() }), 'SELECT 1 AS n FROM identities WHERE email_index = $1 AND owner_id <> $2 LIMIT 1', [index, o.ownerId]);
  const found = await rows(db, OwnerRow, `SELECT owner_id FROM document_access WHERE kind = 'seat' AND call_id = ANY($2::text[])
    UNION SELECT owner_id FROM workspace_calls WHERE call_id = ANY($2::text[])
    UNION SELECT owner_id FROM workspace_members WHERE email_index = $1 AND $3
    UNION SELECT owner_id FROM workspace_authors WHERE email_index = $1 AND $3
    UNION SELECT owner_id FROM document_access WHERE principal_index = $1 AND $3 ORDER BY owner_id`, [index, callIds, !elsewhere]);
  let deleted = 0;
  if (!elsewhere) await exec(db, 'DELETE FROM workspace_mentions WHERE principal_index = $1', [index]);
  for (const { owner_id: ownerId } of found) {
    const w = await held(o, db, ownerId);
    if (!w) continue;
    await exec(db, SEATS_OF_CALLS, [ownerId, callIds]);
    await exec(db, OPEN_TO_CALLS, [ownerId, callIds]);
    await publish(db, w.workspaceId, TREE_NOTICE);
    if (!elsewhere) {
      await exec(db, 'DELETE FROM workspace_members WHERE owner_id = $1 AND email_index = $2', [ownerId, index]);
      await exec(db, 'DELETE FROM document_access WHERE owner_id = $1 AND principal_index = $2', [ownerId, index]);
      await exec(db, 'DELETE FROM workspace_authors WHERE owner_id = $1 AND email_index = $2', [ownerId, index]);
      const left = await rows(db, z.object({ member_id: z.string(), role: z.string() }), 'SELECT member_id, role FROM workspace_members WHERE owner_id = $1 ORDER BY created_at, member_id', [ownerId]);
      const first = left[0];
      if (!first) { await deleteOwner(db, ownerId); deleted++; continue; }
      if (!left.some((m) => m.role === 'admin')) await exec(db, "UPDATE workspace_members SET role = 'admin' WHERE owner_id = $1 AND member_id = $2", [ownerId, first.member_id]);
      const theirs = (x: StoredItem | undefined) => x?.by?.email === address || x?.restrictedBy === address;
      const lost = (await strandedIn(w, db)).filter((id) => theirs(w.state.items[id]));
      await removeDocuments(w.owner, db, lost);
      const kept = withoutItems(w.state, lost);
      w.state = { ...kept, items: Object.fromEntries(Object.entries(kept.items).map(([id, x]) => [id, theirs(x) ? { ...x, by: x.by?.email === address ? { ...x.by, email: '' } : x.by, restrictedBy: x.restrictedBy === address ? null : x.restrictedBy } : x])) };
    }
    await trashStranded(w, db);
    await saveState(w, db);
  }
  return { workspaces: found.length, deleted, owners: found.map((f) => f.owner_id) };
}

const RANK: Record<WorkspaceRole, number> = { read: 0, edit: 1, admin: 2 };
/** Someone's place in a workspace moves to their new address. If that address is in it already, they stay one person, at the stronger role. */
async function moveMember(w: HeldWorkspace, db: Db, from: Uint8Array, to: Uint8Array, address: string): Promise<void> {
  const ownerId = w.owner.ownerId;
  const at = (index: Uint8Array) => maybeOne(db, Member, 'SELECT member_id, email_index, role, person_ciphertext, created_at FROM workspace_members WHERE owner_id = $1 AND email_index = $2', [ownerId, index]);
  const old = await at(from);
  if (!old) return;
  const there = await at(to);
  if (there) {
    if (RANK[old.role] > RANK[there.role]) await exec(db, 'UPDATE workspace_members SET role = $3 WHERE owner_id = $1 AND member_id = $2', [ownerId, there.member_id, old.role]);
    await exec(db, 'DELETE FROM workspace_members WHERE owner_id = $1 AND member_id = $2', [ownerId, old.member_id]);
    return;
  }
  const who = openJson(workspaceKey(w.owner), memberHeader(w.owner, w.workspaceId, old.member_id), old.person_ciphertext, MemberPerson);
  const sealed = sealJson(workspaceKey(w.owner), memberHeader(w.owner, w.workspaceId, old.member_id), toJson({ ...who, email: address }));
  await exec(db, 'UPDATE workspace_members SET email_index = $3, person_ciphertext = $4 WHERE owner_id = $1 AND member_id = $2', [ownerId, old.member_id, to, sealed]);
}
/** The same for each document given to their old address. */
async function moveShares(w: HeldWorkspace, db: Db, from: Uint8Array, to: Uint8Array, address: string): Promise<void> {
  const ownerId = w.owner.ownerId;
  const Share = z.object({ document_id: z.string(), access_id: z.string(), role: z.enum(['edit', 'read']) });
  const at = (index: Uint8Array) => rows(db, Share, 'SELECT document_id, access_id, role FROM document_access WHERE owner_id = $1 AND principal_index = $2', [ownerId, index]);
  const there = new Map((await at(to)).map((r) => [r.document_id, r]));
  for (const r of await at(from)) {
    const same = there.get(r.document_id);
    if (same) {
      if (r.role === 'edit' && same.role === 'read') await exec(db, "UPDATE document_access SET role = 'edit' WHERE owner_id = $1 AND document_id = $2 AND access_id = $3", [ownerId, same.document_id, same.access_id]);
      await exec(db, 'DELETE FROM document_access WHERE owner_id = $1 AND document_id = $2 AND access_id = $3', [ownerId, r.document_id, r.access_id]);
    } else {
      await exec(db, 'UPDATE document_access SET principal_index = $4, person_ciphertext = $5 WHERE owner_id = $1 AND document_id = $2 AND access_id = $3',
        [ownerId, r.document_id, r.access_id, to, sealSharedPerson(w.owner, w.workspaceId, r.document_id, r.access_id, { email: address })]);
    }
  }
}
/**
 * An account's provider gave it a new address, in the caller's transaction: all it has in workspaces, under the old address's
 * hash, moves to the new one, as does its name on what it made. Access follows the address, so while another account still
 * signs in with the old one, it stays that account's. Locks go in the order `forgetAccount` takes them.
 */
export async function moveAddress(d: Deps, db: Db, ownerId: string, from: Uint8Array, to: string): Promise<number> {
  const address = to.trim().toLowerCase();
  const index = blindIndex(indexKey(d), 'email', address);
  if (await maybeOne(db, z.object({ n: z.number() }), 'SELECT 1 AS n FROM identities WHERE email_index = $1 AND owner_id <> $2 LIMIT 1', [from, ownerId])) return 0;
  const found = await rows(db, OwnerRow, `SELECT owner_id FROM workspace_members WHERE email_index = $1
    UNION SELECT owner_id FROM workspace_authors WHERE email_index = $1
    UNION SELECT owner_id FROM document_access WHERE principal_index = $1
    UNION SELECT owner_id FROM workspace_calls WHERE organizer_index = $1 ORDER BY owner_id`, [from]);
  await exec(db, 'UPDATE workspace_mentions SET principal_index = $2 WHERE principal_index = $1', [from, index]);
  for (const { owner_id: workspaceOwner } of found) {
    const w = await held(d, db, workspaceOwner);
    if (!w) continue;
    // A call they're organizing stays open to everyone in it: it goes by its organizer's address. Under the workspace's lock, as
    // every other change to these rows is.
    await exec(db, 'UPDATE workspace_calls SET organizer_index = $3 WHERE owner_id = $1 AND organizer_index = $2', [workspaceOwner, from, index]);
    await moveMember(w, db, from, index, address);
    await moveShares(w, db, from, index, address);
    await moveClientTags(w.owner, db, from, index);
    await exec(db, `INSERT INTO workspace_authors (owner_id, email_index, made_workspace) SELECT owner_id, $3, made_workspace FROM workspace_authors WHERE owner_id = $1 AND email_index = $2
      ON CONFLICT (owner_id, email_index) DO UPDATE SET made_workspace = workspace_authors.made_workspace OR EXCLUDED.made_workspace`, [workspaceOwner, from, index]);
    await exec(db, 'DELETE FROM workspace_authors WHERE owner_id = $1 AND email_index = $2', [workspaceOwner, from]);
    // Each address in the tree is hashed once, however many things carry it.
    const was = new Map<string, boolean>();
    const theirs = (email: string | null | undefined): boolean => {
      if (!email) return false;
      const known = was.get(email) ?? Buffer.compare(blindIndex(indexKey(d), 'email', email), from) === 0;
      was.set(email, known);
      return known;
    };
    w.state = { ...w.state, items: Object.fromEntries(Object.entries(w.state.items).map(([id, x]) => [id, { ...x, by: x.by && theirs(x.by.email) ? { ...x.by, email: address } : x.by, restrictedBy: theirs(x.restrictedBy) ? address : x.restrictedBy }])) };
    await saveState(w, db);
    await publish(db, w.workspaceId, TREE_NOTICE);
  }
  wlog.info('address moved', { ownerId, workspaces: found.length });
  return found.length;
}

/* ---------- live ---------- */

const shortHash = (text: string): string => b64u(sha(utf8(text)));
const digestOf = (here: WorkspaceHere[]): string => shortHash(JSON.stringify(here));
const NOBODY_HERE = digestOf([]);

/**
 * One browser's stream of a workspace. It holds no keys and no tree: what it last sent is a hash, because a copy for every
 * stream, at a few thousand items, is what ran an instance out of memory. Only who it's for, what to show them next, and
 * its place among this person's streams.
 */
class TreeStream extends LiveStream<WorkspaceLiveEvent> {
  private first: WorkspaceTree | undefined;
  private shown: string;
  private role: WorkspaceRole | null;
  private standing: Standing;
  /** Who's here changed since it was last worked out for this reader, and a hash of what they were last told of it. */
  private moved = true;
  private shownHere = NOBODY_HERE;
  /** This reader's unread tags changed, and a hash of the complete set last sent to this stream. */
  private tagged = true;
  private shownTags: string | null = null;

  constructor(d: Deps, room: Room, credentials: Credentials, who: Who, first: WorkspaceTree, standing: Standing, version: number, place: StreamPlace, private readonly callId: string | null) {
    super(d, room, credentials, who, version, place, { workspaceId: room.workspaceId });
    this.first = first;
    this.shown = shortHash(JSON.stringify(first));
    this.role = first.role;
    this.standing = standing;
  }
  override heard(): void { this.moved = true; this.poke(); }
  override told(): void { this.tagged = true; this.poke(); }

  /** The authorized unread set, whole: a read elsewhere or lost access clears what this stream said before. */
  private async tell(line: Line<WorkspaceLiveEvent>): Promise<boolean> {
    this.tagged = false;
    const waiting = await waitingFor(this.d, this.who, this.room.workspaceId).catch((e: unknown) => {
      // They've lost the workspace, which the next snapshot says.
      if (e instanceof AppError && e.status < 500) return [];
      throw e;
    });
    const hash = shortHash(JSON.stringify(waiting));
    if (hash === this.shownTags) return false;
    this.shownTags = hash;
    await line({ type: 'mentions', mentions: waiting });
    return true;
  }

  /** What this reader sees of a snapshot. False once they can't open the workspace any more. */
  private async show(s: Snapshot, line: Line<WorkspaceLiveEvent>): Promise<boolean> {
    if (!s) return false;
    const standing = standingIn(s, this.who);
    if (!canOpen(standing)) return this.someoneNew();
    this.standing = standing;
    // A tree change can restrict, trash or remove a tagged document while the stream remains open.
    this.tagged = true;
    if (standing.role !== this.role) {
      this.role = standing.role;
      await line({ type: 'access', role: standing.role });
    }
    const tree = treeFor(this.who, { ...s, ...standing }, await callsIn(this.d.pool, this.who, this.callId, s.state));
    const text = JSON.stringify(tree);
    const hash = shortHash(text);
    if (hash !== this.shown) {
      this.shown = hash;
      await line({ type: 'tree', tree });
    }
    return true;
  }
  protected async begin(line: Line<WorkspaceLiveEvent>): Promise<void> {
    const first = this.first;
    this.first = undefined;
    if (first) await line({ type: 'tree', tree: first });
  }
  protected async step(line: Line<WorkspaceLiveEvent>): Promise<Step> {
    const s = this.nextSnapshot();
    if (s !== undefined) return (await this.show(s, line)) ? 'wrote' : 'lost';
    if (this.tagged && await this.tell(line)) return 'wrote';
    if (!this.moved) return 'idle';
    this.moved = false;
    const here = this.room.seenBy({ who: this.who, callId: this.callId, standing: this.standing });
    const digest = digestOf(here);
    if (digest === this.shownHere) return 'idle';
    this.shownHere = digest;
    await line({ type: 'presence', here });
    return 'wrote';
  }
  protected ping(): WorkspaceLiveEvent { return { type: 'ping' }; }
  protected closed(): WorkspaceLiveEvent { return { type: 'closed' }; }
}

/**
 * Opens a stream, if this person has a place for one: that's asked first, because it costs nothing and a tree doesn't. It
 * hears of changes before it relies on what it read, so nothing falls between them, and anyone who can't open the workspace
 * is refused here, before a line is written, as they would be for anything else. Runs until the reader loses it, the
 * browser goes or says it closed it (`name`, as it calls it), its place is needed, this instance shuts down, or it's time to
 * let go.
 */
export async function open(d: Deps, credentials: Credentials, reader: Reader, workspaceId: string, address: string, name: string | null): Promise<(out: StreamingApi) => Promise<void>> {
  const place = d.hub.admit('workspace', limitKey(reader), address, name);
  const release = place.release;
  try {
    const known = await workspaceFor(d, reader, workspaceId);
    const callId = reader.seat?.callId ?? null;
    const room = roomFor(d, workspaceId);
    const stream = new TreeStream(d, room, credentials, { email: reader.email, principals: reader.principals, calls: reader.calls }, treeFor(reader, known, await callsIn(d.pool, reader, callId, known.state)), { role: known.role, grants: known.grants, lasting: known.lasting, call: known.call }, known.version, place, callId);
    room.join(stream);
    try {
      await room.ready;
      // Whatever changed before the room was listening: nothing did, usually, and that costs one small query.
      void room.read();
    } catch (e) {
      room.leave(stream);
      throw e;
    }
    return (out) => stream.run(out);
  } catch (e) {
    release();
    throw e;
  }
}

/** A browser says it closed its stream of a workspace, by what it called it: it ends now, and its place is free. Only the asker's own. */
export function endStream(d: Deps, reader: Reader, name: string): void {
  d.hub.end('workspace', limitKey(reader), name);
}

/** Says where a browser is, for everyone who may know. Nobody can be placed in something they can't open. */
export async function present(d: Deps, reader: Reader, workspaceId: string, body: PresenceBody): Promise<void> {
  const w = await placeableIn(d, reader, workspaceId, 'gone' in body ? null : body.document);
  await announce(w, reader, personIn(w.owner, reader), body.connection, 'gone' in body ? 'gone' : { document: body.document, block: body.block, typing: body.typing, page: body.page });
}
