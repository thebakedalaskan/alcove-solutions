/*
 * Workspaces: an owner with its own keys, its people, its tree of documents, boards and folders, and streams of it
 * (docs: Data and storage › Workspaces). The name and tree are one sealed state, changed only under the workspace's row
 * lock and read per reader, so nobody is ever sent what they can't open. Who can do what is modules/workspaceAccess.ts's to say;
 * this module does what access allows. What a document or board holds isn't here: to the tree they're rows of a kind.
 */
import {
  type DocumentRole, type DocumentShare, type ItemKind, type ItemPlace, type Person, type PresenceBody, type ShareEntry, type ShareTarget, type WorkspaceHere, type WorkspaceItem, type WorkspaceLiveEvent, type WorkspacePerson,
  type WorkspaceRole, type WorkspaceSummary, type WorkspaceTree
} from '@alcove/api';
import type { StreamingApi } from 'hono/utils/stream';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, blindIndex, id128, openJson, sealJson, sha, toJson, utf8, type RecordHeader } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { ConflictError, invalid, notFound } from '../errors';
import { publish } from '../live/hub';
import { announce, roomFor, type Room, type Snapshot } from '../live/room';
import { LiveStream, type Line, type Step } from '../live/stream';
import { log } from '../log';
import { createOwner, findOwner, lockOwner, masterKey, ownerFrom } from '../owners';
import {
  TREE_NOTICE, canOpen, change, grant, grantsFor, limitKey, openSharedPerson, openState, personIn, requireDocument, requireEditable, requireItem, requireRole, requireSharing, roleOf, saveState, sealSharedPerson, sealState, seatIndex, standingIn, trashOf,
  workspaceFor, workspaceKey, type Credentials, type Maker, type Reader, type Standing, type StoredItem, type Who, type Workspace, type WorkspaceState
} from './workspaceAccess';
import { profile } from './account';
import { personOf, portraitFor } from './portraits';
import { copyContent, kindOf, startContent } from './workspaceDocuments';

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
  ON CONFLICT (owner_id, email_index) DO UPDATE SET made_workspace = workspace_authors.made_workspace OR EXCLUDED.made_workspace`, [w.owner.ownerId, blindIndex(masterKey(w.owner), 'email', email), madeWorkspace]);
const makerOf = (r: Reader): Maker => ({ name: r.account?.name ?? '', email: (r.email ?? '').trim().toLowerCase() });

/* ---------- reading ---------- */

/** One item as a reader sees it. `trash` is what it's in Trash with, on its own or with a folder. */
function wireItem(id: string, item: StoredItem, role: DocumentRole, outside: boolean, trash: { at: string; by: string | null } | null): WorkspaceItem {
  return {
    id, kind: item.kind, name: item.name, parent: outside ? null : item.parent, by: item.by && { name: item.by.name, portrait: portraitFor(item.by.email || item.by.name) },
    createdAt: item.createdAt, editedAt: item.editedAt, trashedAt: trash?.at ?? null, trashedBy: trash?.by ?? null, restricted: item.restricted, role
  };
}
type Seen = Standing & { workspaceId: string; state: WorkspaceState; people: number };
/** The workspace as one reader sees it: everything they can open, in order, with parents first. */
function treeFor(who: Who, w: Seen): WorkspaceTree {
  const outside = w.role === null;
  const items: WorkspaceItem[] = [];
  const kids = childrenIn(w.state);
  type Next = { child: Child; above: { at: string; by: string | null } | null };
  const next = (parent: string | null, above: Next['above']): Next[] => (kids.get(parent) ?? []).map((child) => ({ child, above })).reverse();
  const stack = next(null, null);
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    const { id, item } = at.child;
    const trash = item.trashedAt ? { at: item.trashedAt, by: item.trashedBy } : at.above;
    const role = roleOf(who, w, id, item);
    if (role) items.push(wireItem(id, item, role, outside, trash));
    stack.push(...next(id, trash));
  }
  return { id: w.workspaceId, name: outside ? null : w.state.name, role: w.role, people: outside ? null : w.people, items };
}
export const tree = async (d: Deps, reader: Reader, workspaceId: string): Promise<WorkspaceTree> => treeFor(reader, await workspaceFor(d, reader, workspaceId));
export async function item(d: Deps, reader: Reader, workspaceId: string, itemId: string): Promise<WorkspaceItem> {
  const w = await workspaceFor(d, reader, workspaceId);
  const found = requireItem(reader, w, itemId);
  return wireItem(itemId, found.item, found.role, w.role === null, trashOf(w.state, itemId));
}

const ListedRow = z.object({ owner_id: z.string(), workspace_id: z.string(), state_ciphertext: bytea, role: z.enum(['admin', 'edit', 'read']).nullable(), people: z.number() });
/** Every workspace someone's in, by name, then each one they only have documents in, which says nothing about itself. */
export async function list(reader: Reader): Promise<WorkspaceSummary[]> {
  const o = reader.account?.owner;
  if (!o) return [];
  const found = await rows(o.pool, ListedRow, `SELECT w.owner_id, w.workspace_id, w.state_ciphertext, m.role,
      (SELECT count(*)::int FROM workspace_members x WHERE x.owner_id = w.owner_id) AS people
    FROM workspaces w LEFT JOIN workspace_members m ON m.owner_id = w.owner_id AND m.email_index = ANY($1::bytea[])
    WHERE m.role IS NOT NULL OR EXISTS (SELECT 1 FROM document_access a WHERE a.owner_id = w.owner_id AND a.principal_index = ANY($1::bytea[]))`, [reader.principals]);
  const mine: WorkspaceSummary[] = [];
  const given: WorkspaceSummary[] = [];
  for (const r of found) {
    if (r.role === null) { given.push({ id: r.workspace_id, name: null, role: null, people: null }); continue; }
    const owner = await findOwner(o, r.owner_id, undefined);
    // Deleted since its row was read: nobody has it any more.
    if (owner) mine.push({ id: r.workspace_id, name: openState(owner, r.workspace_id, r.state_ciphertext).name, role: r.role, people: r.people });
  }
  return [...mine.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), ...given];
}

/* ---------- changing ---------- */

const addDocuments = async (w: Workspace, db: Db, ids: string[]): Promise<void> => {
  if (ids.length) await exec(db, 'INSERT INTO documents (owner_id, document_id) SELECT $1, unnest($2::text[])', [w.owner.ownerId, ids]);
};
const removeDocuments = async (o: Owner, db: Db, ids: string[]): Promise<void> => {
  if (ids.length) await exec(db, 'DELETE FROM documents WHERE owner_id = $1 AND document_id = ANY($2::text[])', [o.ownerId, ids]);
};
function requireRoom(w: Workspace, adding: number): void {
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

export async function create(o: Owner, name: string): Promise<{ id: string }> {
  const me = await profile(o);
  const id = id128();
  await tx(o.pool, async (c) => {
    // One at a time for an account, so two at once can't both be the hundredth.
    await lockOwner(o, c);
    const made = await maybeOne(c, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM workspace_authors WHERE email_index = $1 AND made_workspace', [blindIndex(masterKey(o), 'email', me.email)]);
    if ((made?.n ?? 0) >= MAX_MADE) throw new ConflictError('You’ve made as many workspaces as you can. Delete one first.', { context: { ownerId: o.ownerId, made: made?.n } });
    const { ownerId, root } = await createOwner(o, c);
    const owner = ownerFrom(o, ownerId, root, undefined);
    await exec(c, 'INSERT INTO workspaces (owner_id, workspace_id, state_ciphertext) VALUES ($1,$2,$3)', [ownerId, id, sealState(owner, id, { name, items: {} })]);
    await addMember(owner, c, id, me.email, 'admin', me.name);
    await noteAuthor({ owner }, c, me.email, true);
  });
  wlog.info('workspace created', { workspaceId: id });
  return { id };
}
export async function rename(d: Deps, reader: Reader, workspaceId: string, name: string): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    requireRole(w, 'admin');
    w.state = { ...w.state, name };
  });
}
/** Deletes a workspace and everything it holds, in the caller's transaction: its owner row goes, and the rest with it. */
const deleteOwner = (db: Db, ownerId: string): Promise<number> => exec(db, 'DELETE FROM owners WHERE owner_id = $1', [ownerId]);
export async function remove(d: Deps, reader: Reader, workspaceId: string): Promise<void> {
  await change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'admin');
    await deleteOwner(c, w.owner.ownerId);
  });
  wlog.info('workspace deleted', { workspaceId });
}

/* ---------- people ---------- */

/** Who a member is, beside the keyed hash of their address, so it goes with their row. */
const MemberPerson = z.object({ email: z.string(), name: z.string().optional() });
const memberHeader = (o: Owner, workspaceId: string, memberId: string): RecordHeader => ({ v: 1, kind: 'workspace-member', ownerId: o.ownerId, workspaceId, memberId });
const Member = z.object({ member_id: z.string(), email_index: bytea, role: z.enum(['admin', 'edit', 'read']), person_ciphertext: bytea, created_at: timestamp });
async function addMember(o: Owner, db: Db, workspaceId: string, email: string, role: WorkspaceRole, name?: string | undefined): Promise<string> {
  const memberId = id128();
  const person = sealJson(workspaceKey(o), memberHeader(o, workspaceId, memberId), toJson({ email: email.trim().toLowerCase(), ...(name ? { name } : {}) }));
  await exec(db, 'INSERT INTO workspace_members (owner_id, member_id, email_index, role, person_ciphertext) VALUES ($1,$2,$3,$4,$5)', [o.ownerId, memberId, blindIndex(masterKey(o), 'email', email), role, person]);
  return memberId;
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
    return { id: m.member_id, person: personOf(who.email, who.name), role: m.role, since: m.created_at.toISOString(), isMe: reader.principals.some((p) => Buffer.compare(p, m.email_index) === 0) };
  });
}
export async function addPerson(d: Deps, reader: Reader, workspaceId: string, email: string, role: WorkspaceRole): Promise<{ id: string }> {
  return change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'admin');
    const index = blindIndex(masterKey(d), 'email', email);
    const there = await maybeOne(c, Member, 'SELECT member_id, email_index, role, person_ciphertext, created_at FROM workspace_members WHERE owner_id = $1 AND email_index = $2', [w.owner.ownerId, index]);
    if (!there) {
      if (w.people >= MAX_PEOPLE) throw new ConflictError('This workspace has as many people as it can. Take someone out first.', { context: { workspaceId, people: w.people } });
      const id = await addMember(w.owner, c, workspaceId, email, role);
      wlog.info('person added', { workspaceId, memberId: id, role });
      return { id };
    }
    await setMemberRole(w, c, there, role);
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
    await exec(c, 'DELETE FROM workspace_members WHERE owner_id = $1 AND member_id = $2', [w.owner.ownerId, memberId]);
    // What they had by restricting something goes with them: coming back gives them only what they're given.
    const { email } = openJson(workspaceKey(w.owner), memberHeader(w.owner, workspaceId, memberId), m.person_ciphertext, MemberPerson);
    w.state = { ...w.state, items: Object.fromEntries(Object.entries(w.state.items).map(([id, x]) => [id, x.restrictedBy === email ? { ...x, restrictedBy: null } : x])) };
    const trashed = await trashStranded(w, c);
    wlog.info('person removed', { workspaceId, memberId, leaving, trashed });
  });
}

/* ---------- the tree ---------- */

export interface NewItem { kind: ItemKind; name: string; parent: string | null; after?: string | null | undefined }
export async function createItem(d: Deps, reader: Reader, workspaceId: string, input: NewItem): Promise<{ id: string }> {
  return change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'edit');
    requireRoom(w, 1);
    const parent = landing(reader, w, input.parent);
    requireDepth(w, parent, input.kind === 'folder' ? 1 : 0);
    if (input.after) requireItem(reader, w, input.after);
    const id = id128();
    const at = new Date().toISOString();
    w.state = withItem(w.state, id, {
      kind: input.kind, name: input.name, parent, pos: positionIn(w.state, parent, input.after), by: makerOf(reader), createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, restrictedBy: null
    });
    if (holdsContent(input.kind)) await addDocuments(w, c, [id]);
    if (input.kind === 'document') await startContent(w, c, [id]);
    await noteAuthor(w, c, makerOf(reader).email);
    wlog.info('item created', { workspaceId, itemId: id, kind: input.kind });
    return { id };
  });
}
export async function renameItem(d: Deps, reader: Reader, workspaceId: string, itemId: string, name: string): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    const { item: it } = requireEditable(reader, w, itemId);
    w.state = withItem(w.state, itemId, { ...it, name, editedAt: new Date().toISOString() });
  });
}
export async function moveItem(d: Deps, reader: Reader, workspaceId: string, itemId: string, to: ItemPlace): Promise<void> {
  await change(d, reader, workspaceId, (w) => {
    requireRole(w, 'edit');
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
interface Copied { from: string; id: string; item: StoredItem }
/** A copy of `id`, and of everything `reader` can open in it, by a new person and shared with nobody. The copy of `id` comes first. */
function copied(reader: Reader, w: Workspace, id: string, parent: string | null, pos: string, name: string): Copied[] {
  const kids = childrenIn(w.state);
  const at = new Date().toISOString();
  const out: Copied[] = [];
  const stack = [{ from: id, copy: id128(), parent, pos, name }];
  for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
    const source = w.state.items[x.from];
    if (!source) continue;
    out.push({ from: x.from, id: x.copy, item: { ...source, name: x.name, parent: x.parent, pos: x.pos, by: makerOf(reader), createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restrictedBy: null } });
    for (const child of kids.get(x.from) ?? []) {
      if (!child.item.trashedAt && roleOf(reader, w, child.id, child.item)) stack.push({ from: child.id, copy: id128(), parent: x.copy, pos: child.item.pos, name: child.item.name });
    }
  }
  return out;
}
export async function duplicateItem(d: Deps, reader: Reader, workspaceId: string, itemId: string): Promise<{ id: string }> {
  const { place, id, content } = await change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'edit');
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
    await noteAuthor(w, c, makerOf(reader).email);
    wlog.info('item duplicated', { workspaceId, itemId, copy: id, items: out.length });
    return { place: w, id, content };
  });
  // What they hold comes after the lock, so nobody's typing waits on it. They start from the seed, like anything new.
  for (const x of content) await copyContent(place, x.from, x.id, kindOf(x.item), x.item.name);
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
    requireRole(w, 'edit');
    const { item: it } = requireEditable(reader, w, itemId, 'fine');
    if (trashOf(w.state, itemId)) return;
    liftOut(reader, w, itemId, it.parent);
    w.state = withItem(w.state, itemId, { ...it, trashedAt: new Date().toISOString(), trashedBy: reader.account?.name ?? '' });
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
  await change(d, reader, workspaceId, async (w, c) => {
    requireRole(w, 'edit');
    const { item: it } = requireEditable(reader, w, itemId, 'fine');
    if (!trashOf(w.state, itemId)) throw new ConflictError('Move it to Trash first.', { context: { workspaceId, itemId } });
    liftOut(reader, w, itemId, nearestInTree(w.state, it.parent));
    const gone = [itemId, ...insideOf(w.state, [itemId])];
    await removeDocuments(w.owner, c, gone);
    w.state = withoutItems(w.state, gone);
    wlog.info('item deleted for good', { workspaceId, itemId, items: gone.length });
  });
}

/* ---------- sharing ---------- */

const ShareRow = z.object({ access_id: z.string(), kind: z.enum(['email', 'seat']), role: z.enum(['edit', 'read']), person_ciphertext: bytea, created_at: timestamp });
export async function shareList(d: Deps, reader: Reader, workspaceId: string, documentId: string): Promise<DocumentShare> {
  const w = await workspaceFor(d, reader, workspaceId);
  const { item: it } = requireSharing(reader, w, documentId);
  const found = await rows(d.pool, ShareRow, 'SELECT access_id, kind, role, person_ciphertext, created_at FROM document_access WHERE owner_id = $1 AND document_id = $2 ORDER BY created_at, access_id', [w.owner.ownerId, documentId]);
  const entries = found.map((r): ShareEntry => {
    const who = openSharedPerson(w.owner, workspaceId, documentId, r.access_id, r.person_ciphertext);
    const person: Person = who.email !== undefined ? personOf(who.email) : { id: r.access_id, name: who.name ?? '', email: '', portrait: portraitFor(r.access_id) };
    return { id: r.access_id, kind: r.kind, person, role: r.role, since: r.created_at.toISOString() };
  });
  return { workspace: { name: w.state.name, people: w.people }, restricted: it.restricted, entries };
}
export async function share(d: Deps, reader: Reader, workspaceId: string, documentId: string, to: ShareTarget[], role: DocumentRole): Promise<void> {
  const grants = await grantsFor(reader, to, role);
  await change(d, reader, workspaceId, async (w, c) => {
    requireSharing(reader, w, documentId);
    await grant(w, c, documentId, grants);
    wlog.info('document shared', { workspaceId, documentId, people: grants.length, role });
  });
}
export async function unshare(d: Deps, reader: Reader, workspaceId: string, documentId: string, accessId: string): Promise<void> {
  await change(d, reader, workspaceId, async (w, c) => {
    requireSharing(reader, w, documentId);
    const removed = await exec(c, 'DELETE FROM document_access WHERE owner_id = $1 AND document_id = $2 AND access_id = $3', [w.owner.ownerId, documentId, accessId]);
    if (!removed) throw notFound('That person', { workspaceId, documentId });
    await trashStranded(w, c);
    wlog.info('document unshared', { workspaceId, documentId, accessId });
  });
}
export async function restrict(d: Deps, reader: Reader, workspaceId: string, documentId: string, restricted: boolean): Promise<void> {
  await change(d, reader, workspaceId, async (w, c) => {
    const { item: it } = requireSharing(reader, w, documentId);
    if (it.restricted === restricted) return;
    // Whoever restricts something they didn't make would otherwise lock themselves out of it: they keep it as its creator does.
    const me = makerOf(reader).email;
    const keeper = restricted && it.by?.email !== me ? me : null;
    w.state = withItem(w.state, documentId, { ...it, restricted, restrictedBy: keeper });
    if (keeper) await noteAuthor(w, c, keeper);
    wlog.info('document restricted', { workspaceId, documentId, restricted });
  });
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

/**
 * What's restricted and nobody can open any more: no creator or restrictor in the workspace, and nobody it's shared with.
 * Each address is hashed once however many things carry it, and this reads under the lock, so it stays one pass.
 */
async function strandedIn(w: HeldWorkspace, db: Db): Promise<string[]> {
  const restricted = Object.entries(w.state.items).filter(([, x]) => x.restricted);
  if (!restricted.length) return [];
  const members = new Set((await rows(db, z.object({ email_index: bytea }), 'SELECT email_index FROM workspace_members WHERE owner_id = $1', [w.owner.ownerId])).map((r) => b64u(r.email_index)));
  const given = new Set((await rows(db, z.object({ document_id: z.string() }), 'SELECT DISTINCT document_id FROM document_access WHERE owner_id = $1 AND document_id = ANY($2::text[])', [w.owner.ownerId, restricted.map(([id]) => id)])).map((r) => r.document_id));
  const indexes = new Map<string, string>();
  const inHere = (email: string | null | undefined): boolean => {
    if (!email) return false;
    const index = indexes.get(email) ?? b64u(blindIndex(masterKey(w.owner), 'email', email));
    indexes.set(email, index);
    return members.has(index);
  };
  return restricted.filter(([id, x]) => !given.has(id) && !inHere(x.by?.email) && !inHere(x.restrictedBy)).map(([id]) => id);
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
 * Deletes for good what's been in Trash for `ageMs`, with what's in it, and returns how many things went. Each workspace
 * goes in a transaction of its own, and one that fails is logged and left for next time: nothing in one workspace can stop
 * the others.
 */
export async function sweepTrash(d: Deps, ageMs: number = TRASH_MS): Promise<number> {
  const cutoff = new Date(Date.now() - ageMs);
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
    after = due.at(-1);
    if (due.length < TRASH_BATCH) return deleted;
  }
}

/** Takes the seats these rows find out of each workspace, under that workspace's lock, as anything else that changes who has what. */
async function dropSeats(d: Deps, ownerIds: string[], remove: (db: Db, ownerId: string) => Promise<number>): Promise<number> {
  let ended = 0;
  for (const ownerId of ownerIds) {
    try {
      ended += await tx(d.pool, async (c) => {
        const w = await held(d, c, ownerId);
        if (!w) return 0;
        const n = await remove(c, ownerId);
        await trashStranded(w, c);
        await saveState(w, c);
        await publish(c, w.workspaceId, TREE_NOTICE);
        return n;
      });
    } catch (e) {
      wlog.warn('seats not ended', { ownerId, err: e });
    }
  }
  return ended;
}
const OwnerRow = z.object({ owner_id: z.string() });
const SEATS_OF_CALLS = "DELETE FROM document_access WHERE owner_id = $1 AND kind = 'seat' AND call_id = ANY($2::text[])";
/** Takes away everything these calls gave people's seats, wherever it was given. */
export async function endSeats(d: Deps, callIds: string[]): Promise<number> {
  const found = await rows(d.pool, OwnerRow, "SELECT DISTINCT owner_id FROM document_access WHERE kind = 'seat' AND call_id = ANY($1::text[]) ORDER BY owner_id", [callIds]);
  const ended = await dropSeats(d, found.map((r) => r.owner_id), (db, ownerId) => exec(db, SEATS_OF_CALLS, [ownerId, callIds]));
  if (ended) wlog.info('seats ended', { calls: callIds.length, seats: ended });
  return ended;
}
/** The same for one seat, when its person is taken out of the call. */
export async function endSeat(d: Deps, callId: string, seat: string): Promise<void> {
  const index = seatIndex(d, callId, seat);
  const found = await rows(d.pool, OwnerRow, 'SELECT DISTINCT owner_id FROM document_access WHERE principal_index = $1 ORDER BY owner_id', [index]);
  await dropSeats(d, found.map((r) => r.owner_id), (db, ownerId) => exec(db, 'DELETE FROM document_access WHERE owner_id = $1 AND principal_index = $2', [ownerId, index]));
}
/** Ends seats whose call is over, should nothing else have: a call's end does it, but not if the process stopped in between. */
export async function sweepSeats(d: Deps): Promise<number> {
  const over = await rows(d.pool, z.object({ call_id: z.string() }), `SELECT DISTINCT a.call_id FROM document_access a WHERE a.kind = 'seat'
    AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.call_id = a.call_id AND c.state = 'live')`);
  return over.length ? endSeats(d, over.map((r) => r.call_id)) : 0;
}

/**
 * An account is being deleted, in the caller's transaction: it comes out of every workspace its address still appears in,
 * as a member, on a document, or on something it made or restricted there, unless another account still signs in with that
 * address; and what its calls (`callIds`) gave people's seats ends either way. A workspace left with nobody in it is
 * deleted; one left with no admin gets its longest-standing person as its admin; a restricted document only it could open
 * goes, and anything else left with nobody to open it goes to Trash; and what it made keeps its name and no longer its
 * address. Every row is touched under its workspace's lock, the order every change takes, and locks go in order of owner,
 * so two accounts leaving together never deadlock.
 */
export async function forgetAccount(o: Owner, db: Db, email: string, callIds: string[]): Promise<{ workspaces: number; deleted: number }> {
  const address = email.trim().toLowerCase();
  const index = blindIndex(masterKey(o), 'email', address);
  const elsewhere = await maybeOne(db, z.object({ n: z.number() }), 'SELECT 1 AS n FROM identities WHERE email_index = $1 AND owner_id <> $2 LIMIT 1', [index, o.ownerId]);
  const found = await rows(db, OwnerRow, `SELECT owner_id FROM document_access WHERE kind = 'seat' AND call_id = ANY($2::text[])
    UNION SELECT owner_id FROM workspace_members WHERE email_index = $1 AND $3
    UNION SELECT owner_id FROM workspace_authors WHERE email_index = $1 AND $3
    UNION SELECT owner_id FROM document_access WHERE principal_index = $1 AND $3 ORDER BY owner_id`, [index, callIds, !elsewhere]);
  let deleted = 0;
  for (const { owner_id: ownerId } of found) {
    const w = await held(o, db, ownerId);
    if (!w) continue;
    await exec(db, SEATS_OF_CALLS, [ownerId, callIds]);
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
  return { workspaces: found.length, deleted };
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
  const index = blindIndex(masterKey(d), 'email', address);
  if (await maybeOne(db, z.object({ n: z.number() }), 'SELECT 1 AS n FROM identities WHERE email_index = $1 AND owner_id <> $2 LIMIT 1', [from, ownerId])) return 0;
  const found = await rows(db, OwnerRow, `SELECT owner_id FROM workspace_members WHERE email_index = $1
    UNION SELECT owner_id FROM workspace_authors WHERE email_index = $1
    UNION SELECT owner_id FROM document_access WHERE principal_index = $1 ORDER BY owner_id`, [from]);
  for (const { owner_id: workspaceOwner } of found) {
    const w = await held(d, db, workspaceOwner);
    if (!w) continue;
    await moveMember(w, db, from, index, address);
    await moveShares(w, db, from, index, address);
    await exec(db, `INSERT INTO workspace_authors (owner_id, email_index, made_workspace) SELECT owner_id, $3, made_workspace FROM workspace_authors WHERE owner_id = $1 AND email_index = $2
      ON CONFLICT (owner_id, email_index) DO UPDATE SET made_workspace = workspace_authors.made_workspace OR EXCLUDED.made_workspace`, [workspaceOwner, from, index]);
    await exec(db, 'DELETE FROM workspace_authors WHERE owner_id = $1 AND email_index = $2', [workspaceOwner, from]);
    // Each address in the tree is hashed once, however many things carry it.
    const was = new Map<string, boolean>();
    const theirs = (email: string | null | undefined): boolean => {
      if (!email) return false;
      const known = was.get(email) ?? Buffer.compare(blindIndex(masterKey(d), 'email', email), from) === 0;
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

  constructor(d: Deps, room: Room, credentials: Credentials, who: Who, first: WorkspaceTree, standing: Standing, version: number, release: () => void, private readonly callId: string | null) {
    super(d, room, credentials, who, version, release, { workspaceId: room.workspaceId });
    this.first = first;
    this.shown = shortHash(JSON.stringify(first));
    this.role = first.role;
    this.standing = standing;
  }
  override heard(): void { this.moved = true; this.poke(); }

  /** What this reader sees of a snapshot. False once they can't open the workspace any more. */
  private async show(s: Snapshot, line: Line<WorkspaceLiveEvent>): Promise<boolean> {
    if (!s) return false;
    const standing = standingIn(s, this.who);
    if (!canOpen(standing)) return this.someoneNew();
    this.standing = standing;
    if (standing.role !== this.role) {
      this.role = standing.role;
      await line({ type: 'access', role: standing.role });
    }
    const tree = treeFor(this.who, { ...s, ...standing });
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
 * browser goes, this instance shuts down, or it's time to let go.
 */
export async function open(d: Deps, credentials: Credentials, reader: Reader, workspaceId: string): Promise<(out: StreamingApi) => Promise<void>> {
  const release = d.hub.admit('workspace', limitKey(reader));
  try {
    const known = await workspaceFor(d, reader, workspaceId);
    const room = roomFor(d, workspaceId);
    const stream = new TreeStream(d, room, credentials, { email: reader.email, principals: reader.principals }, treeFor(reader, known), { role: known.role, grants: known.grants }, known.version, release, reader.seat?.callId ?? null);
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

/** Says where a browser is, for everyone who may know. Nobody can be placed in something they can't open. */
export async function present(d: Deps, reader: Reader, workspaceId: string, body: PresenceBody): Promise<void> {
  const w = await workspaceFor(d, reader, workspaceId);
  if (!('gone' in body) && body.document !== null) requireDocument(reader, w, body.document, 'read');
  await announce(w, reader, personIn(w.owner, reader), body.connection, 'gone' in body ? 'gone' : { document: body.document, block: body.block, typing: body.typing });
}
