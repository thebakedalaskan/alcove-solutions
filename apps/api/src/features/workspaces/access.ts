/*
 * Who can open what in a workspace: the one place that decides (docs: Privacy, keys and sessions › Who can open a
 * workspace). Everything that reads or changes a workspace asks here first, and nothing else makes up its own rule.
 *
 * A reader is an account, known by the keyed hash of its address, or someone in a call, known by a keyed hash of their
 * seat, from their call pass; signed in and in a call, they're both, and have what each gives them. A workspace role
 * applies to everything in it, except a restricted document, which opens only for its creator and the people it's
 * shared with. `document_access` opens one document for anyone. Being an admin, a call's organizer or in a call opens
 * nothing by itself.
 *
 * Someone with no access gets the same `not-found` for a real ID and a made-up one, wherever they ask.
 */
import { ItemKindSchema, firstName, type DocumentRole, type ItemKind, type Person, type ShareTarget, type WorkspaceRole } from '@alcove/api';
import type pg from 'pg';
import { z } from 'zod';
import { readPass } from '../../callPass';
import type { Deps, Owner } from '../../context';
import { b64u, blindIndex, id128, mac, openJson, sealJson, stateKey, toJson, type RecordHeader } from '../../crypto';
import { bigintText, bytea, exec, maybeOne, rows, tx, type Db } from '../../db';
import { AppError, AuthError, ConflictError, ForbiddenError, ValidationError, notFound } from '../../errors';
import { publish, type Hub } from '../../live/hub';
import { log } from '../../log';
import type { MediaToken } from '../../mediaToken';
import { findOwner, masterKey, openOwner } from '../../owners';
import { findSession } from '../../sessions';
import { profile } from '../account/account';
import { inSeat, seated, seatedIn, seatOfViewer, viewerOf, type Viewer } from '../calls/participants';
import { nudgeCall } from '../calls/notifications';
import { settledHome } from '../calls/workspace-actions';
import { personOf, portraitFor } from '../account/portraits';

const xlog = log.child({ component: 'access' });

/** IDs are 22 characters of base64url; anything else names nothing. */
export const ID128 = /^[A-Za-z0-9_-]{22}$/;
export const isItemId = (id: string): boolean => ID128.test(id);
/** The notice that the tree, or who can open what, changed: every stream of the workspace looks again. */
export const TREE_NOTICE = 'tree';

/* ---------- what a workspace keeps, sealed ---------- */

/** Who made something: their name and address as they were. A deleted account leaves its name and no address. */
const Maker = z.object({ name: z.string(), email: z.string() });
export type Maker = z.infer<typeof Maker>;
/**
 * What makes a folder a call's own (docs: Calls and recordings › The call's home): which call, whose, and, once it's over,
 * its note. Its pages read the call or the note, through their own access: nothing of either is kept here.
 */
export const StoredCall = z.object({
  /** The organizer's owner, whose call and note it is. */
  ownerId: z.string(),
  callId: z.string(),
  /** The organizer's address, as it was: they read its pages whatever the note's rows say. */
  organizer: z.string(),
  startedAt: z.string(),
  /** Set once the call has ended (`ended`), if it had notes. */
  noteId: z.string().nullable(),
  ended: z.boolean()
});
export type StoredCall = z.infer<typeof StoredCall>;
export const StoredItem = z.object({
  kind: ItemKindSchema,
  name: z.string(),
  /** The folder it's in, or null at the top. */
  parent: z.string().nullable(),
  /** Where it falls among its siblings: positions sort as plain strings (features/workspaces/service.ts). */
  pos: z.string(),
  /** Null when nobody in particular made it: then nobody gets the creator's rule, and restricted, it opens only for the people it's shared with. */
  by: Maker.nullable(),
  createdAt: z.string(),
  editedAt: z.string(),
  /** Set on what was sent to Trash itself; what's inside a folder in Trash is there with it. */
  trashedAt: z.string().nullable(),
  trashedBy: z.string().nullable(),
  restricted: z.boolean(),
  /**
   * The address of whoever restricted it, when that wasn't its creator: they keep it as its creator does, for as long as
   * it's restricted and they're in the workspace. It gives nobody an entry in `document_access`, so nothing outlives it.
   */
  restrictedBy: z.string().nullable().default(null),
  /** On a call's folder only. */
  call: StoredCall.nullable().default(null),
  /**
   * A board made for a breakout room, while its call goes on (the organizer's owner, and the call): only seats for whoever's in
   * that room open it, and they come and go, so it isn't stranded when there's nobody in it for a moment. Once the call is over
   * it's a restricted board like any other. Null on anything else, and on what was stored before rooms had boards.
   */
  room: z.object({ ownerId: z.string(), callId: z.string() }).nullable().default(null)
});
export type StoredItem = z.infer<typeof StoredItem>;
/**
 * The call a workspace was made for, as its home: what it was called and when, and its meeting and series (the series' later
 * calls share it). `out`: the addresses taken out of it by hand, or who left: the invite never puts them back. Whom the invite
 * put there is on each member (`workspaces.ts`), so taking them off the invite takes out only them.
 */
export const MadeFor = z.object({ title: z.string(), at: z.string(), meetingId: z.string(), seriesId: z.string().nullable(), out: z.array(z.string()).default([]) });
export type MadeFor = z.infer<typeof MadeFor>;
/** A workspace's name and tree: one record, because its server serialises every change under the row's lock. */
export const WorkspaceState = z.object({ name: z.string(), items: z.record(z.string(), StoredItem), madeFor: MadeFor.nullable().default(null) });
export type WorkspaceState = z.infer<typeof WorkspaceState>;

/** Seals what's kept for a workspace: `workspace-state`, `workspace-member` and `document-access` records. */
export const workspaceKey = (o: Owner): Uint8Array => stateKey(o.root, o.ownerId, 'workspace');
const stateHeader = (o: Owner, workspaceId: string): RecordHeader => ({ v: 1, kind: 'workspace-state', ownerId: o.ownerId, workspaceId });
export const sealState = (o: Owner, workspaceId: string, s: WorkspaceState): Uint8Array => sealJson(workspaceKey(o), stateHeader(o, workspaceId), toJson(s));
export const openState = (o: Owner, workspaceId: string, sealed: Uint8Array): WorkspaceState => openJson(workspaceKey(o), stateHeader(o, workspaceId), sealed, WorkspaceState);

/** Who someone is, on a `document_access` row: an address, or the name of whoever's in a seat. */
const SharedPerson = z.object({ email: z.string().optional(), name: z.string().optional() });
export type SharedPerson = z.infer<typeof SharedPerson>;
const accessHeader = (o: Owner, workspaceId: string, documentId: string, accessId: string): RecordHeader => ({ v: 1, kind: 'document-access', ownerId: o.ownerId, workspaceId, documentId, accessId });
export const openSharedPerson = (o: Owner, workspaceId: string, documentId: string, accessId: string, sealed: Uint8Array): SharedPerson => openJson(workspaceKey(o), accessHeader(o, workspaceId, documentId, accessId), sealed, SharedPerson);
export const sealSharedPerson = (o: Owner, workspaceId: string, documentId: string, accessId: string, who: SharedPerson): Uint8Array => sealJson(workspaceKey(o), accessHeader(o, workspaceId, documentId, accessId), toJson(who));

/* ---------- who's reading ---------- */

/** What a request brought with it. A stream keeps these, not the keys they open, and asks again each time it pings. */
export interface Credentials { session: string | undefined; pass: string | undefined }
/** Who access is decided for: their address, if they have one here, and every index their access is filed under. */
export interface Who { email: string | undefined; principals: Uint8Array[] }
/** Someone's place in a call, while they're let in and it's going on. */
export interface Seat { callId: string; seat: string; name: string; viewer: Viewer }
/** Who's asking, for this request: the account with its keys, their seat, or both. */
export interface Reader extends Who {
  account: { owner: Owner; name: string } | undefined;
  seat: Seat | undefined;
}

export const emailIndex = (d: Deps, email: string): Uint8Array => blindIndex(masterKey(d), 'email', email);
export const seatIndex = (d: Deps, callId: string, seat: string): Uint8Array => blindIndex(masterKey(d), 'call-seat', `${callId}:${seat}`);

/** The seat behind a call pass. Removed, not let in, or the call is over: no seat. */
async function seatFrom(d: Deps, token: string | undefined, account: Owner | undefined): Promise<Seat | undefined> {
  const pass = readPass(d.cfg, token);
  if (!pass) return undefined;
  try {
    const viewer = await viewerOf(d, pass, () => Promise.resolve(account));
    return viewer.inCall ? { callId: pass.callId, seat: seatOfViewer(viewer), name: pass.name, viewer } : undefined;
  } catch (e) {
    if (e instanceof AppError && e.status < 500) { xlog.debug('a call pass opens nothing here', { callId: pass.callId, code: e.code }); return undefined; }
    throw e;
  }
}

async function readerWith(d: Deps, owner: Owner | undefined, seat: Seat | undefined): Promise<Reader> {
  const me = owner && await profile(owner);
  return {
    account: owner && me ? { owner, name: me.name } : undefined, seat, email: me?.email,
    principals: [...(me ? [emailIndex(d, me.email)] : []), ...(seat ? [seatIndex(d, seat.callId, seat.seat)] : [])]
  };
}
async function reader(d: Deps, owner: Owner | undefined, pass: string | undefined): Promise<Reader> {
  const seat = await seatFrom(d, pass, owner);
  if (!owner && !seat) throw new AuthError('Sign in to Alcove first.');
  return readerWith(d, owner, seat);
}
/** Who's behind a request that reaches a workspace by session or call pass. Nobody: `unauthenticated`, whatever it asks for. */
export async function readerOf(d: Deps, who: Credentials): Promise<Reader> {
  const session = await findSession(d, who.session);
  return reader(d, session ? await openOwner(d, session.ownerId, session) : undefined, who.pass);
}
/** The same for a request already signed in. */
export const accountReader = (owner: Owner, pass?: string | undefined): Promise<Reader> => reader(owner, owner, pass);
/**
 * Who someone in a call is to a workspace, from what the call already knows: what their session gives them and, once
 * they're let in, their seat. The same as `readerOf` says for that browser, so what the call tells them is what opens.
 */
export const readerInCall = async (v: Viewer): Promise<Reader> =>
  readerWith(v.organizer, await v.session(), v.inCall ? { callId: v.pass.callId, seat: seatOfViewer(v), name: v.pass.name, viewer: v } : undefined);
/** Who someone else in a call is to a workspace, from what the call keeps of them. */
export const whoInCall = (d: Deps, callId: string, x: { seat: string; email: string | null }): Who =>
  ({ email: x.email ?? undefined, principals: [...(x.email === null ? [] : [emailIndex(d, x.email)]), seatIndex(d, callId, x.seat)] });
/** Who a limit counts: the account, or the person in a call. */
export const limitKey = (r: Reader): string => r.account?.owner.ownerId ?? r.seat?.viewer.pass.person ?? 'nobody';
/**
 * Who a file's URL says is asking, for a request that can't send a pass: an `<img>` or a player brings its cookie and the
 * URL, and nothing else. An account counts only with its own session, so a URL is nothing in anyone else's browser, and
 * stops when the session does. A seat counts while someone's let in to it and its call is going on, as a pass does.
 * Neither: nobody.
 */
export async function whoNamed(d: Deps, named: Pick<MediaToken, 'account' | 'seat'>, sessionId: string | undefined): Promise<Who | undefined> {
  const session = named.account === null ? undefined : await findSession(d, sessionId);
  const owner = session && session.ownerId === named.account ? await findOwner(d, session.ownerId, session) : undefined;
  const me = owner && await profile(owner);
  const seat = named.seat && (await inSeat(d, named.seat)) ? named.seat : undefined;
  if (!me && !seat) return undefined;
  return { email: me?.email, principals: [...(me ? [emailIndex(d, me.email)] : []), ...(seat ? [seatIndex(d, seat.callId, seat.seat)] : [])] };
}

/**
 * Who a reader is to the others in a workspace. `id` is a keyed hash of how access knows them, the same for them on every
 * connection and for nobody anywhere else, so it can go on a caret that someone outside the workspace sees: an address
 * can't. The address is in `email`, for `Room.seenBy` to pass on or not.
 */
export const personKey = (o: Owner, principal: Uint8Array): string => b64u(mac(stateKey(o.root, o.ownerId, 'workspace-person'), principal)).slice(0, 22);
export function personIn(o: Owner, r: Reader): Person {
  const id = personKey(o, r.principals[0] ?? new Uint8Array(0));
  const name = r.account?.name ?? r.seat?.name ?? '';
  return r.email === undefined ? { id, name, email: '', portrait: portraitFor(id) } : { ...personOf(r.email, name), id };
}

/* ---------- where someone stands in a workspace ---------- */

/** What a reader has in a workspace: their role, each document given to them beyond it, and of those what isn't only a seat in a call. */
export interface Standing { role: WorkspaceRole | null; grants: Map<string, DocumentRole>; lasting: Map<string, DocumentRole> }
const stronger = (a: DocumentRole | undefined, b: DocumentRole | undefined): DocumentRole | undefined => (a === 'edit' || b === 'edit' ? 'edit' : a ?? b);
/** Whether anything in the workspace opens for them at all. */
export const canOpen = (s: Standing): boolean => s.role !== null || s.grants.size > 0;

/** Everything in a workspace's rows that says who has what, for working out anyone's standing. */
export interface Holders {
  members: { email_index: Uint8Array; role: WorkspaceRole }[];
  shares: { principal_index: Uint8Array; document_id: string; role: DocumentRole; kind: 'email' | 'seat' }[];
}
const MemberRow = z.object({ email_index: bytea, role: z.enum(['admin', 'edit', 'read']) });
const ShareRow = z.object({ principal_index: bytea, document_id: z.string(), role: z.enum(['edit', 'read']), kind: z.enum(['email', 'seat']) });
/** What these people have in a workspace, and nothing of anyone else's, however many it's shared with. */
export async function holdersOf(db: Db, ownerId: string, principals: Uint8Array[]): Promise<Holders> {
  return {
    members: await rows(db, MemberRow, 'SELECT email_index, role FROM workspace_members WHERE owner_id = $1 AND email_index = ANY($2::bytea[])', [ownerId, principals]),
    shares: await rows(db, ShareRow, 'SELECT principal_index, document_id, role, kind FROM document_access WHERE owner_id = $1 AND principal_index = ANY($2::bytea[])', [ownerId, principals])
  };
}
/** How many people are in a workspace. */
export const peopleIn = async (db: Db, ownerId: string): Promise<number> => (await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM workspace_members WHERE owner_id = $1', [ownerId]))?.n ?? 0;
const among = (principals: Uint8Array[], index: Uint8Array): boolean => principals.some((p) => Buffer.compare(p, index) === 0);
export function standingIn(h: Holders, who: Who): Standing {
  const grants = new Map<string, DocumentRole>();
  const lasting = new Map<string, DocumentRole>();
  for (const s of h.shares) {
    if (!among(who.principals, s.principal_index)) continue;
    for (const given of s.kind === 'seat' ? [grants] : [grants, lasting]) {
      const role = stronger(given.get(s.document_id), s.role);
      if (role) given.set(s.document_id, role);
    }
  }
  return { role: h.members.find((m) => among(who.principals, m.email_index))?.role ?? null, grants, lasting };
}

/** What someone can do with one item, or undefined when it doesn't exist for them. */
export function roleOf(who: Who, s: Pick<Standing, 'role' | 'grants'>, id: string, item: Pick<StoredItem, 'kind' | 'by' | 'restricted' | 'restrictedBy'>): DocumentRole | undefined {
  const asMember = s.role === null ? undefined : s.role === 'read' ? 'read' : 'edit';
  if (item.kind === 'folder') return asMember;
  const email = who.email?.trim().toLowerCase();
  const mine = email !== undefined && (item.by?.email === email || item.restrictedBy === email);
  return stronger(!item.restricted || mine ? asMember : undefined, s.grants.get(id));
}

/** A workspace opened for one reader: its keys for this request, its state, and where they stand. */
export interface Workspace extends Standing {
  workspaceId: string;
  owner: Owner;
  state: WorkspaceState;
  people: number;
  /** Moves on with every change to the tree or to who has what, so a stream knows whether it's behind. */
  version: number;
}
const WorkspaceRow = z.object({ owner_id: z.string(), version: bigintText, state_ciphertext: bytea });
const missing = (workspaceId: string) => notFound('That workspace', { workspaceId });
const LOCKS = { change: ' FOR NO KEY UPDATE', hold: ' FOR SHARE' };

/**
 * Opens a workspace for a reader, or `not-found`, the same for a real ID and a made-up one. `lock`, in a transaction:
 * `change` holds the row for changing the workspace or anyone's access to it; `hold` keeps those from changing until
 * the transaction ends, for work that must not land after someone loses access. Either way the answer is the one that
 * holds under the lock.
 */
export async function workspaceFor(d: Deps, who: Who, workspaceId: string, db: Db = d.pool, lock?: keyof typeof LOCKS): Promise<Workspace> {
  if (!ID128.test(workspaceId)) throw missing(workspaceId);
  const row = await maybeOne(db, WorkspaceRow, `SELECT owner_id, version, state_ciphertext FROM workspaces WHERE workspace_id = $1${lock ? LOCKS[lock] : ''}`, [workspaceId]);
  if (!row) throw missing(workspaceId);
  const standing = standingIn(await holdersOf(db, row.owner_id, who.principals), who);
  if (!canOpen(standing)) throw missing(workspaceId);
  // Only now, with access settled, are the workspace's keys opened. Deleted a moment ago: it's gone.
  const owner = await findOwner(d, row.owner_id, undefined, db);
  if (!owner) throw missing(workspaceId);
  return { ...standing, workspaceId, owner, state: openState(owner, workspaceId, row.state_ciphertext), people: await peopleIn(db, row.owner_id), version: row.version };
}

/** How far a workspace has moved on: whatever changes the tree or who has what moves it, so an answer given at this version still holds. */
export async function workspaceVersion(d: Deps, workspaceId: string): Promise<number | undefined> {
  return (await maybeOne(d.pool, z.object({ version: bigintText }), 'SELECT version FROM workspaces WHERE workspace_id = $1', [workspaceId]))?.version;
}

/** A yes to something, as of a version of the workspace. Only that: no keys, and nothing of the tree. */
interface Yes { version: number; role: WorkspaceRole | null; editedAt: string }
/** What a remembered yes gives: the keys of this request, and what was true of the tree. */
export interface Allowed extends Omit<Yes, 'version'> { owner: Owner; workspaceId: string }
const MAX_REMEMBERED = 4096;
const yesByHub = new WeakMap<Hub, Map<string, Yes>>();
const VersionRow = z.object({ owner_id: z.string(), version: bigintText });
/**
 * For what's asked many times a second: opening a tree costs in proportion to its size, and someone typing asks every few
 * keys. So a yes is remembered, for as long as the workspace's version says it still holds, and the answer costs one small
 * query. A no isn't remembered, and always comes from `workspaceFor`, which is the only thing that decides. `lock` as there.
 */
async function remembering(d: Deps, who: Who, workspaceId: string, what: string, ask: (w: Workspace) => string, db: Db, lock?: keyof typeof LOCKS): Promise<Allowed> {
  if (!ID128.test(workspaceId)) throw missing(workspaceId);
  const row = await maybeOne(db, VersionRow, `SELECT owner_id, version FROM workspaces WHERE workspace_id = $1${lock ? LOCKS[lock] : ''}`, [workspaceId]);
  const remembered = yesByHub.get(d.hub) ?? new Map<string, Yes>();
  yesByHub.set(d.hub, remembered);
  const key = `${workspaceId}:${what}:${who.email ?? ''}:${who.principals.map(b64u).join()}`;
  const yes = remembered.get(key);
  if (row && yes?.version === row.version) {
    const owner = await findOwner(d, row.owner_id, undefined, db);
    if (!owner) throw missing(workspaceId);
    return { owner, workspaceId, role: yes.role, editedAt: yes.editedAt };
  }
  const w = await workspaceFor(d, who, workspaceId, db, lock);
  const editedAt = ask(w);
  remembered.delete(key);
  remembered.set(key, { version: w.version, role: w.role, editedAt });
  for (const oldest of remembered.keys()) {
    if (remembered.size <= MAX_REMEMBERED) break;
    remembered.delete(oldest);
  }
  return { owner: w.owner, workspaceId, role: w.role, editedAt };
}
/** `requireDocument(..., 'edit')`, for each update. */
export const editableBy = (d: Deps, who: Who, workspaceId: string, documentId: string, db: Db = d.pool, lock?: keyof typeof LOCKS): Promise<Allowed> =>
  remembering(d, who, workspaceId, `edit:${documentId}`, (w) => requireDocument(who, w, documentId, 'edit').item.editedAt, db, lock);
/** That someone can open the workspace, and `documentId` in it, if any: for saying where they are. */
export const placeableIn = (d: Deps, who: Who, workspaceId: string, documentId: string | null): Promise<Allowed> =>
  remembering(d, who, workspaceId, `read:${documentId ?? ''}`, (w) => (documentId === null ? '' : requireDocument(who, w, documentId, 'read').item.editedAt), d.pool);

/** A workspace the server is working on for a call, not for anyone in it: its keys, its tree, and the version that's at. What's shown from it is for whoever opened it to decide. */
export type HeldWorkspace = Pick<Workspace, 'owner' | 'workspaceId' | 'state' | 'version'>;
/** Opens one for that, or nothing once it's gone. `lock`: as `workspaceFor`. These IDs come from a call, where only what its organizer could reach gets in. */
export async function serverWorkspace(d: Deps, workspaceId: string, db: Db = d.pool, lock?: keyof typeof LOCKS): Promise<HeldWorkspace | undefined> {
  const row = await maybeOne(db, WorkspaceRow, `SELECT owner_id, version, state_ciphertext FROM workspaces WHERE workspace_id = $1${lock ? LOCKS[lock] : ''}`, [workspaceId]);
  const owner = row && await findOwner(d, row.owner_id, undefined, db);
  return row && owner ? { owner, workspaceId, state: openState(owner, workspaceId, row.state_ciphertext), version: row.version } : undefined;
}
/** Who a workspace is, if it's still there, without opening anything of it. */
export const workspaceOwner = async (db: Db, workspaceId: string): Promise<string | undefined> => (await maybeOne(db, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId]))?.owner_id;
/** The same, and how far it's moved on, which says whether what was read of it still holds. */
export async function workspaceAt(db: Db, workspaceId: string): Promise<{ ownerId: string; version: number } | undefined> {
  const row = await maybeOne(db, VersionRow, 'SELECT owner_id, version FROM workspaces WHERE workspace_id = $1', [workspaceId]);
  return row && { ownerId: row.owner_id, version: row.version };
}

/** A workspace, and where someone stands in it: what's needed to ask what they can do there. */
export type WorkspaceAs = HeldWorkspace & Standing;
/** How someone stands in a workspace that's already held, with nothing opened again. */
export const heldBy = async (w: HeldWorkspace, db: Db, who: Who): Promise<WorkspaceAs> => ({ ...w, ...standingIn(await holdersOf(db, w.owner.ownerId, who.principals), who) });

/** Saves the state, and says what's in Trash and since when, so maintenance needn't open every workspace to find out. */
export async function saveState(w: { owner: Owner; workspaceId: string; state: WorkspaceState }, db: Db): Promise<void> {
  const since = Object.values(w.state.items).flatMap((i) => (i.trashedAt ? [i.trashedAt] : [])).sort()[0] ?? null;
  await exec(db, 'UPDATE workspaces SET state_ciphertext = $2, trash_since = $3, version = version + 1 WHERE owner_id = $1', [w.owner.ownerId, sealState(w.owner, w.workspaceId, w.state), since]);
}
/**
 * One change to a workspace: under its row lock, with this reader's access as it stands under that lock. `fn` puts what
 * it changes in `w.state`. Every stream looks again once the transaction commits.
 */
export function change<T>(d: Deps, who: Who, workspaceId: string, fn: (w: Workspace, c: pg.PoolClient) => T | Promise<T>): Promise<T> {
  return tx(d.pool, async (c) => {
    const w = await workspaceFor(d, who, workspaceId, c, 'change');
    const before = w.state;
    const out = await fn(w, c);
    // A change to who has what moves the version on as a change to the tree does: it's how a stream knows it's behind.
    if (w.state !== before) await saveState(w, c);
    else await exec(c, 'UPDATE workspaces SET version = version + 1 WHERE owner_id = $1', [w.owner.ownerId]);
    await publish(c, workspaceId, TREE_NOTICE);
    return out;
  });
}

/* ---------- what they can do there ---------- */

/** One item as this reader has it. */
export interface Opened { id: string; item: StoredItem; role: DocumentRole }
/** When something went to Trash and who sent it, on its own or with a folder it's in. */
export function trashOf(s: WorkspaceState, id: string | null): { at: string; by: string | null } | null {
  const seen = new Set<string>();
  for (let at = id; at !== null && !seen.has(at); at = s.items[at]?.parent ?? null) {
    seen.add(at);
    const item = s.items[at];
    if (item?.trashedAt) return { at: item.trashedAt, by: item.trashedBy };
  }
  return null;
}
const lookedUp = (who: Who, w: WorkspaceAs, id: string): Opened | undefined => {
  const item = ID128.test(id) ? w.state.items[id] : undefined;
  const role = item && roleOf(who, w, id, item);
  return item && role ? { id, item, role } : undefined;
};
/** Anything in the tree this reader can open, folders too. */
export function requireItem(who: Who, w: WorkspaceAs, id: string): Opened {
  const found = lookedUp(who, w, id);
  if (!found) throw notFound('That item', { workspaceId: w.workspaceId, itemId: id });
  return found;
}
const refuse = (w: WorkspaceAs, id: string) => new ForbiddenError('You can read this, but not change it.', { context: { workspaceId: w.workspaceId, itemId: id } });
/** The same, to change: it needs `edit`, and to be in the tree (`inTrash` when it's fine in Trash). */
export function requireEditable(who: Who, w: WorkspaceAs, id: string, inTrash: 'fine' | 'refused' = 'refused'): Opened {
  const found = requireItem(who, w, id);
  if (found.role !== 'edit') throw refuse(w, id);
  if (inTrash === 'refused' && trashOf(w.state, id)) throw new ConflictError('This is in Trash. Restore it to change it.', { context: { workspaceId: w.workspaceId, itemId: id } });
  return found;
}
/**
 * A document or board, to read or to edit. `not-found` when it doesn't exist for this reader, the same for one they can't
 * open and one that was never there; `forbidden` for someone who can only read it; `conflict` to edit one in Trash, which
 * stays readable to whoever could open it, until it's back or gone.
 */
export function requireDocument(who: Who, w: WorkspaceAs, documentId: string, need: DocumentRole): Opened {
  const found = lookedUp(who, w, documentId);
  if (!found || found.item.kind === 'folder') throw notFound('That document', { workspaceId: w.workspaceId, documentId });
  return need === 'edit' ? requireEditable(who, w, documentId) : found;
}
/** What's only for people in the workspace. Anyone else, it doesn't exist for; a role that's too low is refused. */
export function requireRole(w: WorkspaceAs, need: 'in' | 'edit' | 'admin'): void {
  if (w.role === null) throw missing(w.workspaceId);
  if ((need === 'admin' && w.role !== 'admin') || (need === 'edit' && w.role === 'read')) throw new ForbiddenError(need === 'admin' ? 'Only an admin can do that.' : 'You can read this workspace, but not change it.', { context: { workspaceId: w.workspaceId, need } });
}
/**
 * Who gets to say who has a document: someone in the workspace who can edit it, in Trash or not. A seat is for working on it
 * in a call, and gives no say in who has it beyond that.
 */
export function requireSharing(who: Who, w: WorkspaceAs, documentId: string): Opened {
  requireRole(w, 'in');
  const found = requireDocument(who, w, documentId, 'read');
  if (found.role !== 'edit') throw refuse(w, documentId);
  if (roleOf(who, { role: w.role, grants: w.lasting }, documentId, found.item) !== 'edit') throw new ForbiddenError('You can work on this in the call, but you can’t share it.', { context: { workspaceId: w.workspaceId, itemId: documentId } });
  return found;
}

/* ---------- brought to a call ---------- */

/** Whose something is, as people are told: by first name, never an address, and nobody's when nobody in particular made it. */
export const whoseItIs = (by: { name: string } | null): string | null => (by?.name.trim() ? firstName(by.name) : null);
/** What can be brought to a call. A folder holds things, and isn't brought anywhere. */
export type BroughtKind = Exclude<ItemKind, 'folder'>;
/**
 * All anyone on a call may be told about something brought to it: what it is, whose it is, and its name only if it opens
 * for them. Nothing else of the item leaves this module, so nothing further along can pass on an address by mistake.
 */
export interface Brought { id: string; kind: BroughtKind; by: string | null; name: string | null }
/**
 * What `who` may be told about these items, leaving out anything that isn't in the tree or can't be brought. Its answer
 * covers what they can't open, because a call's organizer brought it and says so to everyone on the call, and that's the
 * one reason a workspace's keys open for someone with no place in it. So these IDs come from a call, where only what the
 * organizer could reach gets in. One from a request would ask about anything: features/workspaces/library.ts checks those against
 * what its reader can open instead.
 */
export async function broughtFrom(d: Deps, who: Who, workspaceId: string, ids: readonly string[]): Promise<Brought[]> {
  const row = await maybeOne(d.pool, WorkspaceRow, 'SELECT owner_id, version, state_ciphertext FROM workspaces WHERE workspace_id = $1', [workspaceId]);
  const owner = row && await findOwner(d, row.owner_id, undefined);
  if (!row || !owner) return [];
  const state = openState(owner, workspaceId, row.state_ciphertext);
  const standing = standingIn(await holdersOf(d.pool, row.owner_id, who.principals), who);
  return ids.flatMap((id): Brought[] => {
    const item = state.items[id];
    if (!item || item.kind === 'folder' || trashOf(state, id)) return [];
    return [{ id, kind: item.kind, by: whoseItIs(item.by), name: roleOf(who, standing, id, item) ? item.name : null }];
  });
}

/* ---------- sharing ---------- */

/** How many people one document can be given to. */
const MAX_SHARES = 500;
/** One person to give a document to: by address, or in a seat of a call, which ends with the call. */
export type Grant = { kind: 'email'; email: string; role: DocumentRole } | { kind: 'seat'; callId: string; seat: string; name: string; role: DocumentRole };
/** How access knows them. */
export const principalOf = (d: Deps, g: Grant): Uint8Array => (g.kind === 'email' ? emailIndex(d, g.email) : seatIndex(d, g.callId, g.seat));

/**
 * Gives one document to many people in a single statement, in the caller's transaction, which holds the workspace's row
 * (`workspaceFor(..., 'change')`): all of them or none. Someone who has it already has their role changed. Their streams
 * hear when the transaction commits.
 */
export async function grant(w: Pick<Workspace, 'owner' | 'workspaceId'>, db: Db, documentId: string, grants: Grant[]): Promise<void> {
  const o = w.owner;
  const byIndex = new Map(grants.map((g) => {
    const index = principalOf(o, g);
    return [Buffer.from(index).toString('hex'), { ...g, index, accessId: id128() }] as const;
  }));
  const rowsToAdd = [...byIndex.values()];
  const there = await rows(db, z.object({ principal_index: bytea }), 'SELECT principal_index FROM document_access WHERE owner_id = $1 AND document_id = $2', [o.ownerId, documentId]);
  const had = new Set(there.map((r) => Buffer.from(r.principal_index).toString('hex')));
  const adding = [...byIndex.keys()].filter((k) => !had.has(k)).length;
  if (there.length + adding > MAX_SHARES) throw new ConflictError('This is shared with as many people as it can be. Take someone off first.', { context: { workspaceId: w.workspaceId, documentId, shares: there.length, adding } });
  await exec(db, `INSERT INTO document_access (owner_id, document_id, access_id, principal_index, kind, role, call_id, person_ciphertext)
                  SELECT $1, $2, t.access_id, t.principal_index, t.kind, t.role, t.call_id, t.person_ciphertext
                  FROM unnest($3::text[], $4::bytea[], $5::text[], $6::text[], $7::text[], $8::bytea[]) AS t(access_id, principal_index, kind, role, call_id, person_ciphertext)
                  ON CONFLICT (owner_id, document_id, principal_index) DO UPDATE SET role = EXCLUDED.role`, [
    o.ownerId, documentId, rowsToAdd.map((g) => g.accessId), rowsToAdd.map((g) => Buffer.from(g.index)), rowsToAdd.map((g) => g.kind), rowsToAdd.map((g) => g.role),
    rowsToAdd.map((g) => (g.kind === 'seat' ? g.callId : null)),
    rowsToAdd.map((g) => Buffer.from(sealSharedPerson(o, w.workspaceId, documentId, g.accessId, g.kind === 'email' ? { email: g.email } : { name: g.name })))
  ]);
  await exec(db, 'UPDATE workspaces SET version = version + 1 WHERE owner_id = $1', [o.ownerId]);
  await publish(db, w.workspaceId, TREE_NOTICE);
}

/**
 * Puts the seats a call has on one document in step with `seats`: whoever's missing gets one, as `role`, and every other seat
 * of that call on it goes, in the caller's transaction, which holds the workspace's row. Nothing anyone has by address
 * changes. It's for a breakout room's board, which only the seats of whoever's in its room open, and which its call keeps
 * from being stranded meanwhile (`StoredItem.room`). Their streams hear when the transaction commits. How many it changed.
 */
export async function seatsInStep(w: Pick<Workspace, 'owner' | 'workspaceId'>, db: Db, documentId: string, callId: string, seats: { seat: string; name: string }[], role: DocumentRole): Promise<number> {
  const o = w.owner;
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
  const there = await rows(db, z.object({ principal_index: bytea }), "SELECT principal_index FROM document_access WHERE owner_id = $1 AND document_id = $2 AND kind = 'seat' AND call_id = $3", [o.ownerId, documentId, callId]);
  const had = new Set(there.map((r) => hex(r.principal_index)));
  const wanted = new Map(seats.map((s) => [hex(seatIndex(o, callId, s.seat)), s]));
  const adding = [...wanted].filter(([k]) => !had.has(k)).map(([, s]): Grant => ({ kind: 'seat', callId, seat: s.seat, name: s.name, role }));
  const going = there.filter((r) => !wanted.has(hex(r.principal_index))).map((r) => Buffer.from(r.principal_index));
  if (adding.length) await grant(w, db, documentId, adding);
  if (going.length) {
    await exec(db, "DELETE FROM document_access WHERE owner_id = $1 AND document_id = $2 AND kind = 'seat' AND call_id = $3 AND principal_index = ANY($4::bytea[])", [o.ownerId, documentId, callId, going]);
    await exec(db, 'UPDATE workspaces SET version = version + 1 WHERE owner_id = $1', [o.ownerId]);
    await publish(db, w.workspaceId, TREE_NOTICE);
  }
  return adding.length + going.length;
}

/** A call, as what's done for it on the server names it: its organizer's keys, and which call. */
export interface CallRef { organizer: Owner; callId: string }

/**
 * The call's home, for the server to work in, and the call's folder at the top of it (`folderId`): what the server makes for
 * the call, such as its board, goes in that folder. The meeting's, else a new one made for the call, settled the first time
 * it's asked for. It opens nothing for anyone.
 */
export async function workspaceForCall(d: Deps, call: CallRef): Promise<HeldWorkspace & { folderId: string }> {
  const { workspaceId, folderId } = await settledHome(call.organizer, call.callId);
  const w = await serverWorkspace(d, workspaceId);
  if (!w) throw missing(workspaceId);
  return { ...w, folderId };
}

/**
 * Gives one document to everyone in a call now or, with `place`, in that part of it: a seat each, which ends with the call or
 * when they're removed from it. Being in the call gives nothing until this says so, and someone who joins after isn't given it.
 */
export async function grantDocumentToCall(d: Deps, workspace: Pick<Workspace, 'workspaceId'>, documentId: string, call: CallRef, opts: { role: DocumentRole; place?: string | undefined }): Promise<void> {
  const people = await seatedIn(call.organizer, call.callId, opts.place);
  await tx(d.pool, async (c) => {
    const w = await serverWorkspace(d, workspace.workspaceId, c, 'change');
    const item = w?.state.items[documentId];
    if (!w || !item || item.kind === 'folder') throw notFound('That document', { workspaceId: workspace.workspaceId, documentId });
    await grant(w, c, documentId, [...people].map(([seat, name]): Grant => ({ kind: 'seat', callId: call.callId, seat, name, role: opts.role })));
  });
  await nudgeCall(d, call.callId);
}

/** What each of these people can do with a document now, and whether they have an entry on it, which is someone's decision. */
async function rolesOn<T extends { who: Who }>(w: HeldWorkspace, db: Db, documentId: string, people: T[]): Promise<{ person: T; role: DocumentRole | undefined; entry: boolean }[]> {
  const item = w.state.items[documentId];
  if (!item) return people.map((person) => ({ person, role: undefined, entry: false }));
  const holders = await holdersOf(db, w.owner.ownerId, people.flatMap((p) => p.who.principals));
  return people.map((person) => ({
    person, role: roleOf(person.who, standingIn(holders, person.who), documentId, item), entry: holders.shares.some((s) => s.document_id === documentId && among(person.who.principals, s.principal_index))
  }));
}
/** Whichever of these people can't open a document, by what each of them has now. */
export const cantOpen = async <T extends { who: Who }>(w: HeldWorkspace, db: Db, documentId: string, people: T[]): Promise<T[]> =>
  (await rolesOn(w, db, documentId, people)).filter((x) => x.role === undefined).map((x) => x.person);
/** The same for changing it: those who can't open it, and those the workspace lets read it. Anyone set to `read` by an entry is left as they were set. */
export const cantEdit = async <T extends { who: Who }>(w: HeldWorkspace, db: Db, documentId: string, people: T[]): Promise<T[]> =>
  (await rolesOn(w, db, documentId, people)).filter((x) => x.role !== 'edit' && !x.entry).map((x) => x.person);
/** What each of these indexes has on a document by an entry of its own, whatever a workspace role gives anyone. */
export async function entriesOn(w: Pick<HeldWorkspace, 'owner'>, db: Db, documentId: string, indexes: Uint8Array[]): Promise<(index: Uint8Array) => DocumentRole | undefined> {
  const shares = (await holdersOf(db, w.owner.ownerId, indexes)).shares.filter((s) => s.document_id === documentId);
  return (index) => shares.find((s) => Buffer.compare(s.principal_index, index) === 0)?.role;
}

/**
 * Whether a call's organizer can still edit in a workspace. A call adds to one, or gives away what it made there, only while
 * they can: it only ever took one they could, and nobody else in the call need be in it.
 */
export async function organizerEdits(d: Deps, w: HeldWorkspace, db: Db, email: string): Promise<boolean> {
  const who: Who = { email, principals: [emailIndex(d, email)] };
  const { role } = standingIn(await holdersOf(db, w.owner.ownerId, who.principals), who);
  return role === 'admin' || role === 'edit';
}

/** What `ShareTarget`s from a browser mean: an address as it is, and a seat in the sharer's own call, with who's in it. */
export async function grantsFor(reader: Reader, to: ShareTarget[], role: DocumentRole): Promise<Grant[]> {
  const asked = to.some((t) => 'seat' in t);
  if (asked && !reader.seat) throw new ValidationError('You can only share with someone in a call from that call.');
  const here = asked && reader.seat ? await seated(reader.seat.viewer) : new Map<string, string>();
  return to.map((t): Grant => {
    if ('email' in t) return { kind: 'email', email: t.email, role };
    const name = here.get(t.seat);
    if (name === undefined || !reader.seat) throw notFound('That person', { callId: reader.seat?.callId });
    return { kind: 'seat', callId: reader.seat.callId, seat: t.seat, name, role };
  });
}
