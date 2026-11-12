/*
 * Workspaces and the documents in them, kept in the world. A document is a real Y.Doc, started from the same bytes the API
 * starts every document with and written with the editor's own blocks (the world's `pages`), so the editor opens it as it
 * opens any other; what's typed stays in this story. Nobody else is ever in it. A page can say Alcove refused some of what
 * this browser wrote: its session opens couldn't-save, with those words on the page, until they're copied, saved as a new
 * document or discarded. Files are kept in the world (`media`) and read back as the browser's own object URLs; a tag waits
 * in the world (`mentions`) until it's seen.
 *
 * A board starts empty, as the API makes one, and holds what the world's `boards` draws on it. A call writes on it as the server
 * would (`boardDoc`), and puts the people in it on it (`onTheBoard`): each on the board's awareness as the server passes them on,
 * with their pointer and their view. Whoever the world has on a board is on it the same way, and in the workspace's own list of
 * who's here. Its `standing` opens it Reconnecting, Couldn't save, or taken from under you.
 */
import {
  AlcoveApiError, DOC_SEED, randomClient, servedType, type DocSession, type DocSize, type DocStatus, type DocUnsentCopy, type DocVersion, type DocVersionSummary,
  type DocumentRole, type DocumentShare, type ItemInput, type ItemPlace, type MediaPictureOptions, type MediaUploadOptions, type MentionBody, type MentionNotice, type Person,
  type SearchDoc, type ShareEntry, type ShareTarget, type WorkspaceItem, type WorkspaceLive, type WorkspaceMedia, type WorkspaceMention, type WorkspacePerson,
  type WorkspaceHere, type WorkspaceRole, type WorkspaceSummary, type WorkspaceTree, type WorkspaceView, type WorkspaceReadOptions, type WorkspaceWhere
} from '@alcove/api';
import { itemsOnPage, newBlockId } from '@alcove/api/retire';
import { NO_PRESENCE } from '@alcove/board';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { COMMENTS } from '~/features/workspace/editor/names';
import { setTitle } from '~/features/workspace/editor/title';
import type { BlockJSON } from '~/features/workspace/editor/types';
import { appendBlocks, contentOf } from '~/features/workspace/editor/ydoc';
import { isOnline } from '../browser';
import type { PageThread, Space } from '../world';
import { personAt } from '../world/people';
import { Pushed, pause } from './live';
import { writersIn } from './writers';
import { current, me, nextId } from './state';

const notFound = () => new AlcoveApiError('not-found', 'That workspace isn’t there, or you can’t open it.');

/** A workspace as the world keeps it. */
export function treeOf(id: string): Space {
  const tree = current().workspaces.find((w) => w.id === id);
  if (!tree) throw notFound();
  return tree;
}
/** Its tree, as the API sends it: what the Drive says of it besides stays out. */
const treeOnly = ({ createdAt: _made, call: _call, ...tree }: Space): WorkspaceTree => tree;
export const treeFor = (id: string): WorkspaceTree => treeOnly(treeOf(id));
const summaryOf = ({ items: _items, inCall: _inCall, ...rest }: Space): WorkspaceSummary => rest;
/** Your Drive: every workspace you're in, the newest first, then each one you only have documents in. */
const drive = (a: WorkspaceSummary, b: WorkspaceSummary) => Number(a.role === null) - Number(b.role === null) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
export const workspaceList = (): WorkspaceSummary[] => current().workspaces.map(summaryOf).sort(drive);

const authorOf = () => { const p = me(); return p.portrait ? { name: p.name, portrait: p.portrait } : null; };

/** Where an item goes among its siblings: after `after`, first (null), or last. */
function place(items: WorkspaceItem[], item: WorkspaceItem, to: ItemPlace): WorkspaceItem[] {
  const rest = items.filter((i) => i.id !== item.id);
  const moved = { ...item, parent: to.parent };
  if (to.after === undefined) return [...rest, moved];
  const at = to.after === null ? rest.findIndex((i) => i.parent === to.parent) : rest.findIndex((i) => i.id === to.after) + 1;
  return at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
}

function edit(id: string, change: (items: WorkspaceItem[]) => WorkspaceItem[]): void {
  const tree = treeOf(id);
  tree.items = change(tree.items);
  for (const live of watching) live.refresh(id);
}

export function createItem(id: string, input: ItemInput): { id: string } {
  const now = new Date().toISOString();
  const item: WorkspaceItem = {
    id: nextId('item').padEnd(22, '0'), kind: input.kind, name: input.name ?? '', parent: input.parent ?? null, by: authorOf(),
    createdAt: now, editedAt: now, trashedAt: null, trashedBy: null, restricted: false, role: 'edit', call: null
  };
  edit(id, (items) => place([...items, item], item, { parent: item.parent, ...(input.after !== undefined ? { after: input.after } : {}) }));
  return { id: item.id };
}
export const renameItem = (id: string, itemId: string, name: string) => edit(id, (items) => items.map((i) => (i.id === itemId ? { ...i, name, editedAt: new Date().toISOString() } : i)));
export const moveItem = (id: string, itemId: string, to: ItemPlace) => edit(id, (items) => { const it = items.find((i) => i.id === itemId); return it ? place(items, it, to) : items; });
/** To Trash, with what's in it: whoever has one of them open is told it's in Trash, as the server's stream tells them. */
export function trashItem(id: string, itemId: string): void {
  const gone = treeOf(id).items.filter((i) => i.id === itemId || i.parent === itemId).map((i) => i.id);
  edit(id, (items) => items.map((i) => (gone.includes(i.id) ? { ...i, trashedAt: new Date().toISOString(), trashedBy: me().name } : i)));
  sessionsHear(gone, (s) => ({ ...s, trashed: true }));
}
/** Back from Trash: whoever has it open is told. */
export function restoreItem(id: string, itemId: string): void {
  edit(id, (items) => items.map((i) => (i.id === itemId ? { ...i, trashedAt: null, trashedBy: null } : i)));
  sessionsHear([itemId], (s) => ({ ...s, trashed: false }));
}
/** A workspace deleted, and everything in it: whoever has something of it open is told it's gone for everyone. */
export function removeWorkspace(id: string): void {
  const ids = treeOf(id).items.map((i) => i.id);
  current().workspaces = current().workspaces.filter((x) => x.id !== id);
  sessionsHear(ids, (s) => ({ ...s, closed: 'deleted' }));
}
export const deleteItem = (id: string, itemId: string) => edit(id, (items) => items.filter((i) => i.id !== itemId && i.parent !== itemId));
export function duplicateItem(id: string, itemId: string): { id: string } {
  const it = treeOf(id).items.find((i) => i.id === itemId);
  if (!it) throw notFound();
  return createItem(id, { kind: it.kind, name: it.name ? `${it.name} copy` : '', parent: it.parent, after: it.id });
}

/** Everyone in a workspace: you, as the workspace has you, and the people on your team who use Alcove, one of them its admin if you aren't. */
export function peopleIn(id: string): WorkspacePerson[] {
  const mine: WorkspaceRole = treeOf(id).role ?? 'read';
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const members = current().workspaces.find((w) => w.id === id)?.members ?? (current().team?.members ?? []).filter((m) => m.onAlcove).map((m) => m.person);
  const team = members.map((person, i): WorkspacePerson => ({ id: `wp-${i}`, person, role: mine !== 'admin' && i === 0 ? 'admin' : 'edit', since, isMe: false }));
  return [{ id: 'wp-me', person: me(), role: mine, since, isMe: true }, ...team];
}
export function addPerson(id: string, email: string, _role: WorkspaceRole): { id: string } {
  treeOf(id);
  return { id: `wp-${personAt(email).email}` };
}

/**
 * Who has a document. Everyone who can open it, by address: the workspace's people unless it's restricted (then you, who
 * restricted it), and everyone it's shared with. The seats it's shared with in the call, for people with no address here.
 */
export function shareOf(id: string, documentId: string): DocumentShare {
  const tree = treeOf(id);
  const doc = tree.items.find((i) => i.id === documentId);
  const restricted = doc?.restricted ?? false;
  const entries = current().shares[documentId] ?? [];
  const insiders = restricted ? [me().email] : peopleIn(id).map((p) => p.person.email);
  const canOpen = [...new Set([...insiders, ...entries.flatMap((e) => (e.kind === 'email' ? [e.person.email] : []))])];
  const seats = entries.flatMap((e) => (e.kind === 'seat' ? [e.person.id] : []));
  return { workspace: { name: tree.name ?? '', people: tree.people ?? 0 }, restricted, entries, canOpen, seats };
}
/** Shares a document with each of `to`, as `role`: someone it's shared with already keeps their entry, with the new role. */
export function shareWith(documentId: string, to: ShareTarget[], role: DocumentRole): void {
  const w = current();
  const since = new Date().toISOString();
  let entries = w.shares[documentId] ?? [];
  for (const t of to) {
    if ('email' in t) {
      const person = personAt(t.email);
      const had = entries.some((e) => e.kind === 'email' && e.person.email === person.email);
      entries = had
        ? entries.map((e) => (e.kind === 'email' && e.person.email === person.email ? { ...e, role } : e))
        : [...entries, { id: nextId('share'), kind: 'email', person, role, since } satisfies ShareEntry];
    } else {
      entries = [...entries, { id: nextId('share'), kind: 'seat', person: { id: t.seat, name: 'Someone in the call', email: '' }, role, since } satisfies ShareEntry];
    }
  }
  w.shares[documentId] = entries;
}
export function unshare(documentId: string, entryId: string): void {
  const w = current();
  w.shares[documentId] = (w.shares[documentId] ?? []).filter((e) => e.id !== entryId);
}
export const restrict = (id: string, documentId: string, restricted: boolean) => edit(id, (items) => items.map((i) => (i.id === documentId ? { ...i, restricted } : i)));

/**
 * The IDs this workspace's documents know people by, for the addresses asked about: a member's is the one they have here,
 * the one the people list and who's here give them too, as the API's are, so a tag, a comment and a caret find the same face.
 */
export function idsIn(id: string, emails: string[]): Record<string, string> {
  const people = peopleIn(id);
  return Object.fromEntries(emails.flatMap((email) => {
    const lower = email.trim().toLowerCase();
    const found = people.find((p) => p.person.email.toLowerCase() === lower);
    return found ? [[lower, found.person.id]] : [];
  }));
}

/* ---------- tags ---------- */

/** The documents you can open in a workspace now. */
const openable = (space: Space): Set<string> => new Set(space.items.filter((i) => i.kind !== 'folder' && i.trashedAt === null).map((i) => i.id));
const asMention = ({ workspaceId: _space, name: _name, ...tag }: MentionNotice): WorkspaceMention => tag;
/** Tags waiting for you in a workspace, the oldest first, in documents you can open now. */
function mentionsIn(id: string): WorkspaceMention[] {
  const open = openable(treeOf(id));
  return current().mentions.filter((m) => m.workspaceId === id && open.has(m.document)).map(asMention).reverse();
}
/** What you've been tagged in and haven't seen, in every workspace, the newest first: only what you can open now. */
export function mentionsEverywhere(): MentionNotice[] {
  const w = current();
  return w.mentions.filter((m) => { const space = w.workspaces.find((s) => s.id === m.workspaceId); return space !== undefined && openable(space).has(m.document); });
}
/** You've seen a tag: it isn't kept any more. One that's gone already is fine. */
export function seeMention(mentionId: string): void {
  const w = current();
  const tag = w.mentions.find((m) => m.id === mentionId);
  w.mentions = w.mentions.filter((m) => m.id !== mentionId);
  if (tag) for (const live of watching) live.refresh(tag.workspaceId);
}
/** Telling someone you tagged them, in a document you can edit. Nobody else is in this story to hear it. */
export function mention(id: string, documentId: string, _tag: MentionBody): void {
  editable(id, documentId);
}

/** Someone tags you in a document: it waits in the world until it's seen, and the workspace's stream says so at once. */
export function tagYou(tag: MentionNotice): void {
  current().mentions.unshift(tag);
  for (const live of watching) live.refresh(tag.workspaceId);
}

/* ---------- live ---------- */

/** Who else is in each workspace now, by its ID: people in a call (src/api/call.ts) say where they are. */
const presence = new Map<string, WorkspaceHere[]>();
/** Everyone else in a workspace, whole, as its stream says it whenever that changes. */
export function hereIn(id: string, here: WorkspaceHere[]): void {
  presence.set(id, here);
  for (const live of watching) live.refresh(id);
}

const watching = new Set<LiveWorkspace>();
/**
 * Who's in a workspace now, as the server tells it: you, whoever the world has on its boards, each on one connection with the
 * board they have open, and whoever a call says is here.
 */
function hereNow(id: string): WorkspaceHere[] {
  const you: WorkspaceHere = { person: me(), connection: 'standin-you', callIdentity: null, document: null, block: null, typing: false, page: null, elsewhere: false, isMe: true };
  const open = treeOf(id).items.filter((i) => i.kind !== 'folder' && i.trashedAt === null);
  const on = (i: WorkspaceItem, who: Person, typing: boolean): WorkspaceHere => ({
    person: who, connection: `standin-${i.id}-${who.id}`, callIdentity: null, document: i.id, block: null, typing, page: null, elsewhere: false, isMe: false
  });
  return [you, ...open.flatMap((i) => [...(current().boards[i.id]?.here ?? []).map(({ who }) => on(i, who, false)), ...(current().pages[i.id]?.here ?? []).map(({ who }) => on(i, who, true))]), ...(presence.get(id) ?? [])];
}

class LiveWorkspace extends Pushed<WorkspaceView> implements WorkspaceLive {
  constructor(private readonly id: string) {
    super({ status: current().streamsDown?.includes(id) ? 'reconnecting' : 'live', tree: structuredClone(treeFor(id)), here: hereNow(id), mentions: mentionsIn(id) });
    watching.add(this);
  }
  /**
   * Try now: a stream that couldn't reach Alcove does now, once the browser's online, and stays so for the rest of the story.
   * An arrow property, as `getSnapshot` is: the app hands it to a button unbound.
   */
  retry = (): void => {
    if (this.getSnapshot().status !== 'reconnecting' || !isOnline()) return;
    const w = current();
    w.streamsDown = w.streamsDown?.filter((s) => s !== this.id);
    this.update((v) => ({ ...v, status: 'live', tree: structuredClone(treeFor(this.id)), here: hereNow(this.id), mentions: mentionsIn(this.id) }));
  };
  /** Shown again: nothing here is ever under way, so a stream that's down is only waiting, and tries now, as Try now does. */
  wake = (): void => { this.retry(); };
  refresh(id: string): void { if (id === this.id) this.update((v) => ({ ...v, tree: structuredClone(treeFor(id)), here: hereNow(id), mentions: mentionsIn(id) })); }
  present(_where: WorkspaceWhere): void { /* Nobody else is here to see where you are. */ }
  async seen(mentionId: string): Promise<void> {
    await pause(60);
    seeMention(mentionId);
  }
  override close(): void { watching.delete(this); super.close(); }
}
export const liveWorkspace = (id: string): WorkspaceLive => new LiveWorkspace(id);

/* ---------- files (from 519a0327, the workspace session's stand-in, in this branch's words) ---------- */

/** The limit in force, as the API has it unless it's changed. */
const MOST_BYTES = 512 * 1024 * 1024;
/** How an upload goes here: a few pieces, a moment each, so a block shows it uploading. */
const UPLOAD_PIECES = 6;
const PIECE_MS = 450;
/** Where each file is read from, once it's been asked for: a player keeps it. They go with the story. */
const urls = new Map<string, string>();
const noFile = () => new AlcoveApiError('not-found', 'That file doesn’t exist, or you don’t have access to it.');

/** The documents you can open in a workspace now. */
/** A document or board you can edit, or why not, in the API's words. */
function editable(id: string, documentId: string): WorkspaceItem {
  const item = treeOf(id).items.find((i) => i.id === documentId);
  if (!item || item.kind === 'folder') throw new AlcoveApiError('not-found', 'That document doesn’t exist, or you don’t have access to it.');
  if (item.role !== 'edit') throw new AlcoveApiError('forbidden', 'You can read this, but not change it.');
  return item;
}
/** A file, as one of the documents you reach it through has it. */
function fileIn(id: string, documentId: string, mediaId: string) {
  const kept = current().media.find((m) => m.workspace === id && m.media.id === mediaId && m.media.documents.includes(documentId));
  if (!kept) throw noFile();
  return kept;
}
/** Keeps a file in a document, a piece at a time: through a lost connection it waits, and a stopped upload leaves nothing. */
export async function upload(id: string, documentId: string, file: File, o: MediaUploadOptions = {}): Promise<WorkspaceMedia> {
  editable(id, documentId);
  if (file.size > MOST_BYTES) throw new AlcoveApiError('invalid', 'This file is bigger than 512 MiB, the most a file can be.');
  const stopped = () => new AlcoveApiError('network', 'That upload was stopped.');
  for (let piece = 1; piece <= UPLOAD_PIECES; piece++) {
    await pause(PIECE_MS);
    while (!isOnline()) { if (o.signal?.aborted) throw stopped(); await pause(500); }
    if (o.signal?.aborted) throw stopped();
    o.onProgress?.({ sent: Math.round((file.size * piece) / UPLOAD_PIECES), total: file.size });
  }
  const media: WorkspaceMedia = {
    id: nextId('media').padEnd(22, '0'), name: file.name.replace(/\s+/g, ' ').trim() || 'File', type: servedType(file.type), size: file.size,
    width: o.width ?? null, height: o.height ?? null, createdAt: new Date().toISOString(), documents: [documentId]
  };
  current().media.unshift({ workspace: id, media, body: () => Promise.resolve(file), ...(o.preview && media.type.startsWith('image/') ? { preview: o.preview } : {}) });
  return structuredClone(media);
}
/** Where to read a file through a document, for a player or a download: the same while the story lasts. */
export async function urlOf(id: string, documentId: string, mediaId: string): Promise<string> {
  const kept = fileIn(id, documentId, mediaId);
  const known = urls.get(mediaId);
  if (known) return known;
  const url = URL.createObjectURL(await kept.body());
  urls.set(mediaId, url);
  return url;
}
/** A picture, as a URL of its own: whoever asked for it lets it go. */
export async function pictureOf(id: string, documentId: string, mediaId: string, o: MediaPictureOptions = {}): Promise<string> {
  const kept = fileIn(id, documentId, mediaId);
  const body = await kept.body();
  if (o.signal?.aborted) throw new AlcoveApiError('network', 'That picture was stopped.');
  return URL.createObjectURL(body);
}
/** A picture's small preview, as a URL of its own, or null for one with none (one the story starts with). */
export async function previewOf(id: string, documentId: string, mediaId: string, o: MediaPictureOptions = {}): Promise<string | null> {
  const kept = fileIn(id, documentId, mediaId);
  if (o.signal?.aborted) throw new AlcoveApiError('network', 'That preview was stopped.');
  return kept.preview ? URL.createObjectURL(kept.preview) : null;
}
/** Reuses a file from another document of the same workspace, for someone who can edit this one. */
export function attach(id: string, documentId: string, mediaId: string): void {
  editable(id, documentId);
  const open = openable(treeOf(id));
  const kept = current().media.find((m) => m.workspace === id && m.media.id === mediaId && m.media.documents.some((d) => open.has(d)));
  if (!kept) throw noFile();
  if (!kept.media.documents.includes(documentId)) kept.media.documents = [...kept.media.documents, documentId];
}
/** Every file you can reach in a workspace, the newest first, each with the documents you reach it through. */
export function mediaIn(id: string): WorkspaceMedia[] {
  const open = openable(treeOf(id));
  return current().media
    .filter((m) => m.workspace === id && m.media.documents.some((d) => open.has(d)))
    .map((m) => ({ ...m.media, documents: m.media.documents.filter((d) => open.has(d)) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/**
 * Deletes a file for good, for everyone, as the API does: refused for someone in only through a seat in a call (a pass,
 * and no place in the workspace), and for anyone who can't edit every document that has it, seen or not, in words that
 * name none of them. Every document that had it shows it removed from then on.
 */
export function removeMedia(id: string, documentId: string, mediaId: string, o: WorkspaceReadOptions = {}): void {
  editable(id, documentId);
  if (o.pass && treeOf(id).role === null) throw new AlcoveApiError('forbidden', 'You can work on this in the call, but you can’t delete its files for good.');
  const kept = fileIn(id, documentId, mediaId);
  const items = treeOf(id).items;
  if (kept.media.documents.some((d) => items.find((i) => i.id === d)?.role !== 'edit')) throw new AlcoveApiError('forbidden', 'This file is also in a document you can’t edit.');
  const w = current();
  w.media = w.media.filter((m) => !(m.workspace === id && m.media.id === mediaId));
  const url = urls.get(mediaId);
  if (url) URL.revokeObjectURL(url);
  urls.delete(mediaId);
}

const docs = new Map<string, Y.Doc>();
/** A document as a browser holds one: on a Yjs client of its own, never one of those only the API writes as. */
function ownDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = randomClient();
  return doc;
}
const lineOf = (text: string): BlockJSON => ({ type: 'line', content: [{ type: 'text', text }] });
/** The ID someone has in a workspace's documents, by their address. */
const idIn = (workspace: string, email: string): string => { const lower = email.toLowerCase(); return idsIn(workspace, [lower])[lower] ?? ''; };
/** A page's tags name people by address (`@` and it): in the document, each is the ID they have in its workspace. */
function tagged(blocks: readonly BlockJSON[], workspace: string): BlockJSON[] {
  const swap = (b: BlockJSON): BlockJSON => {
    const named = b.attrs?.['id'];
    const attrs = b.type === 'mention' && typeof named === 'string' && named.startsWith('@') ? { ...b.attrs, id: idIn(workspace, named.slice(1)) } : b.attrs;
    return { ...b, ...(attrs ? { attrs } : {}), ...(b.content ? { content: b.content.map(swap) } : {}) };
  };
  return blocks.map(swap);
}
/** A page's comment threads, written as the app writes them (editor/comments.ts), each message when the page says it was said. */
function writeThreads(doc: Y.Doc, threads: readonly PageThread[], blocks: readonly string[], workspace: string): void {
  const all = doc.getMap<unknown>(COMMENTS);
  doc.transact(() => {
    for (const t of threads) {
      const block = blocks[t.on];
      if (block === undefined) continue;
      const replies = new Y.Array<unknown>();
      replies.push(t.says.map((m) => ({
        id: newBlockId(), by: idIn(workspace, m.who.email), name: m.who.name, text: m.text, at: new Date(Date.now() - m.hoursAgo * 3_600_000).toISOString(), tags: []
      })));
      const thread = new Y.Map<unknown>();
      thread.set('quote', t.quote);
      thread.set('block', block);
      thread.set('resolved', false);
      thread.set('replies', replies);
      all.set(t.id, thread);
    }
  });
}
/** What a page's blocks say is being uploaded by someone, and hasn't failed: someone else's browser is sending it. */
const sendingIn = (blocks: readonly BlockJSON[]): string[] => blocks.flatMap((b) => {
  const up = b.attrs?.['up'];
  const key = b.attrs?.['upload'];
  return typeof up === 'number' && typeof key === 'string' && b.attrs?.['failed'] === undefined ? [key] : [];
});
/** Whoever else is in a document, as its awareness has them: only ever someone sending an upload. */
const SOMEONE_ELSE = 424242;
/**
 * A document as the world has it: its title, what its page says (tags, comment threads and all), and whatever of it Alcove
 * refused, which only this browser has. The empty first line every document starts with is written over, as typing into it
 * would be.
 */
function documentOf(item: WorkspaceItem, workspace: string): Y.Doc {
  const doc = ownDoc();
  if (item.kind === 'board') {
    current().boards[item.id]?.draw?.(doc);
    return doc;
  }
  Y.applyUpdate(doc, DOC_SEED);
  if (item.kind !== 'document') return doc;
  setTitle(doc, item.name);
  const page = current().pages[item.id];
  const blocks = tagged([...(page?.blocks ?? []), ...(page?.refused?.words ?? []).map(lineOf)], workspace);
  if (blocks.length > 0) {
    const ids = appendBlocks(doc, blocks);
    contentOf(doc).delete(1, 1);
    writeThreads(doc, page?.threads ?? [], ids, workspace);
  }
  return doc;
}
/** How a session opens: as the world's page or board says it stands. */
function statusOf(item: WorkspaceItem): DocStatus {
  const base: DocStatus = { status: 'saved', refused: null, role: item.role, trashed: item.trashedAt !== null, closed: null, unsent: false };
  const refused = current().pages[item.id]?.refused ?? null;
  if (refused) return { ...base, status: 'failed', refused: refused.why, unsent: true };
  if (item.kind !== 'board' && current().pages[item.id]?.standing === 'offline') return { ...base, status: 'offline' };
  const standing = item.kind === 'board' ? current().boards[item.id]?.standing : undefined;
  if (standing === 'offline') return { ...base, status: 'offline', unsent: true };
  if (standing === 'failed') return { ...base, status: 'failed', refused: 'too-large', unsent: true };
  if (standing === 'gone') return { ...base, closed: 'access' };
  return base;
}

/* ---------- who else is on a board ---------- */

/** Someone else on a board in a call: their connection to the call, who they are, where their pointer is, and whether they're typing. */
/** Someone on a board in a call: their pointer, and their view where it isn't round their pointer, as whoever presents it has. */
export interface OnTheBoard { callIdentity: string; person: Person; at: { x: number; y: number }; typing?: boolean | undefined; view?: { x: number; y: number; z: number; h?: number | undefined } | undefined }
/** Who's on each board, by its ID, as the call that has it open puts them there. */
const onBoards = new Map<string, readonly OnTheBoard[]>();
/** Each open session of a board, told when that changes. */
const boardSessions = new Map<string, Set<(people: readonly OnTheBoard[]) => void>>();
/** These people are on the board now, and nobody else is. */
export function onTheBoard(documentId: string, people: readonly OnTheBoard[]): void {
  onBoards.set(documentId, people);
  for (const tell of boardSessions.get(documentId) ?? []) tell(people);
}
/**
 * How often someone on a board moves their pointer a little, as a person reading does: a pointer that stays still for six
 * seconds fades, and Awareness lets go of anyone quiet for thirty.
 */
const DRIFT_MS = 3_500;
/**
 * Keeps a board session's awareness saying who's on it, as the server passes on each of their browsers: whoever the world has on
 * it, and whoever a call that has it open puts there (`onTheBoard`), each with their own client, their pointer and the view round
 * it (which is what Go to and Follow find), and in a call their connection to it on `user`, as the server stamps it. Someone who
 * leaves the board leaves its awareness.
 */
function othersOn(item: WorkspaceItem, awareness: Awareness): () => void {
  const documentId = item.id;
  const placed = (current().boards[documentId]?.here ?? []).map(({ who, x, y }) => ({ key: `world:${who.id}`, user: { id: who.id, name: who.name }, at: { x, y }, typing: false, view: null }));
  const inCall = (people: readonly OnTheBoard[]) => people.map((p) => ({
    key: p.callIdentity, user: { id: p.person.id, name: p.person.name, callIdentity: p.callIdentity }, at: p.at, typing: p.typing ?? false, view: p.view ?? null
  }));
  let everyone = [...placed, ...inCall(onBoards.get(documentId) ?? [])];
  const theirs = new Map<string, Awareness>();
  let beat = 0;
  const say = () => {
    for (const [key, a] of theirs) {
      if (everyone.some((p) => p.key === key)) continue;
      removeAwarenessStates(awareness, [a.clientID], 'standin');
      a.destroy();
      a.doc.destroy();
      theirs.delete(key);
    }
    everyone.forEach((p, i) => {
      const a = theirs.get(p.key) ?? new Awareness(ownDoc());
      theirs.set(p.key, a);
      const d = ((beat + i) % 3) * 6;
      const at = { x: p.at.x + d, y: p.at.y + d / 2 };
      a.setLocalState({ ...NO_PRESENCE, at, view: p.view ?? { x: at.x, y: at.y, z: 1 }, typing: p.typing, user: p.user });
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(a, [a.clientID]), 'standin');
    });
    beat += 1;
  };
  const tell = (now: readonly OnTheBoard[]) => { everyone = [...placed, ...inCall(now)]; say(); };
  const sessions = boardSessions.get(documentId) ?? new Set();
  sessions.add(tell);
  boardSessions.set(documentId, sessions);
  say();
  const again = setInterval(say, DRIFT_MS);
  return () => {
    clearInterval(again);
    sessions.delete(tell);
    for (const a of theirs.values()) { a.destroy(); a.doc.destroy(); }
  };
}

/** Each open session of a document, by the document's ID: what happens to it in its workspace reaches them, as the server's stream says it. */
const sessions = new Map<string, Set<Document>>();
/** How long what was kept here takes to go once a stream's back. */
const SAVING_MS = 700;
/** Every open session of these documents hears what changed: in Trash, back, or gone with their workspace. */
function sessionsHear(ids: readonly string[], change: (s: DocStatus) => DocStatus): void {
  for (const id of ids) for (const d of sessions.get(id) ?? []) d.update(change);
}

class Document extends Pushed<DocStatus> implements DocSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly ready: Promise<void>;
  private readonly id: string;
  private readonly leave: () => void;
  constructor(item: WorkspaceItem, workspace: string) {
    super(statusOf(item));
    this.id = item.id;
    const open = sessions.get(item.id) ?? new Set<Document>();
    open.add(this);
    sessions.set(item.id, open);
    const known = docs.get(item.id);
    this.doc = known ?? documentOf(item, workspace);
    if (!known) docs.set(item.id, this.doc);
    this.awareness = new Awareness(this.doc);
    const sending = sendingIn(current().pages[item.id]?.blocks ?? []);
    if (sending.length > 0) this.awareness.states.set(SOMEONE_ELSE, { uploading: sending });
    this.leave = item.kind === 'board' ? othersOn(item, this.awareness) : writersIn(this.doc, this.awareness, current().pages[item.id]?.here ?? []);
    this.ready = Promise.resolve();
  }
  /** What Alcove refused of this document, which is all this browser wrote here that it hasn't taken. */
  unsentCopy(): DocUnsentCopy {
    const words = current().pages[this.id]?.refused?.words ?? [];
    return { text: words.join('\n'), token: { vector: Y.encodeStateVector(this.doc), keys: [] } };
  }
  size(): DocSize { return { bytes: Y.encodeStateAsUpdate(this.doc).length, items: itemsOnPage(this.doc) }; }
  /** Lets go of what Alcove refused: the document opens again as Alcove has it. */
  discardUnsaved(): Promise<void> {
    const w = current();
    const page = w.pages[this.id];
    if (page?.refused) {
      w.pages[this.id] = { blocks: page.blocks };
      docs.delete(this.id);
    }
    this.close();
    return Promise.resolve();
  }
  /**
   * Try now: a stream that couldn't reach Alcove does now, once the browser's online, and stays so for the rest of the story.
   * What was kept here goes, a moment later. An arrow property, as `getSnapshot` is: the app hands it to a button unbound.
   */
  retry = (): void => {
    const now = this.getSnapshot();
    if (now.status !== 'offline' || !isOnline()) return;
    const w = current();
    const page = w.pages[this.id];
    if (page?.standing) w.pages[this.id] = { ...page, standing: undefined };
    const board = w.boards[this.id];
    if (board?.standing === 'offline') w.boards[this.id] = { ...board, standing: undefined };
    this.update((s) => ({ ...s, status: s.unsent ? 'saving' : 'saved' }));
    if (now.unsent) this.after(SAVING_MS, () => this.update((s) => ({ ...s, status: 'saved', unsent: false })));
  };
  /** Shown again: nothing here is ever under way, so a stream that's down is only waiting, and tries now, as Try now does. */
  wake = (): void => { this.retry(); };
  override close(): void { sessions.get(this.id)?.delete(this); this.leave(); this.awareness.destroy(); super.close(); }
}
/**
 * A board as the world holds it, made the way a browser opening it first would find it: what the call writes on it, as the
 * server would (its template, a frame for each room, rooms' boards coming back), and what scripted people add, goes here.
 */
export function boardDoc(id: string, documentId: string): Y.Doc {
  const known = docs.get(documentId);
  if (known) return known;
  const item = treeOf(id).items.find((i) => i.id === documentId);
  if (!item) throw notFound();
  const doc = documentOf(item, id);
  docs.set(documentId, doc);
  return doc;
}
export function openDocument(id: string, documentId: string): DocSession {
  const item = treeOf(id).items.find((i) => i.id === documentId);
  if (!item || item.kind === 'folder') throw notFound();
  return new Document(item, id);
}
/**
 * A new document or board of a state, made as the API makes one: a document starts from the seed, takes the state, and is
 * titled with the name it's given.
 */
export function saveCopy(id: string, input: ItemInput & { state: Uint8Array }): { id: string } {
  const made = createItem(id, input);
  const doc = ownDoc();
  if (input.kind === 'document') Y.applyUpdate(doc, DOC_SEED);
  Y.applyUpdate(doc, input.state);
  if (input.kind === 'document' && input.name) setTitle(doc, input.name);
  docs.set(made.id, doc);
  return made;
}
/** The documents and files kept for this story go when it does. */
export function forgetDocuments(): void {
  for (const d of docs.values()) d.destroy();
  docs.clear();
  onBoards.clear();
  boardSessions.clear();
  sessions.clear();
  watching.clear();
  presence.clear();
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  frameNotes.clear();
}

/** What you keep beside each frame of a board for presenting it, as your account would, for as long as the story lasts. */
const frameNotes = new Map<string, Map<string, string>>();
export const presenterFrameNotes = (boardId: string): Record<string, string> => Object.fromEntries(frameNotes.get(boardId) ?? []);
export function keepFrameNotes(boardId: string, frame: string, text: string): void {
  const kept = frameNotes.get(boardId) ?? new Map<string, string>();
  if (text) kept.set(frame, text);
  else kept.delete(frame);
  frameNotes.set(boardId, kept);
}

/** A document's versions, the newest first, as the world keeps them (`Page.versions`). */
export function versionsOf(id: string, documentId: string): DocVersionSummary[] {
  treeOf(id);
  return (current().pages[documentId]?.versions ?? []).map((v, i) => ({
    id: `${documentId.slice(0, 20)}v${i}`, at: v.at, by: v.by.flatMap((p) => (p.portrait ? [{ name: p.name, portrait: p.portrait }] : [])), callId: v.call, reason: v.reason
  }));
}
/** A version with its whole state: the page as the world has it, from its blocks, as a document opens. */
export function versionOf(id: string, documentId: string, versionId: string): DocVersion {
  const summary = versionsOf(id, documentId).find((v) => v.id === versionId);
  const item = treeOf(id).items.find((i) => i.id === documentId);
  if (!summary || !item) throw new AlcoveApiError('not-found', 'That version isn’t there.');
  const doc = documentOf(item, id);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return { ...summary, update };
}
/** Every document you can open here, as words, for searching in this browser. */
export async function* searchText(id: string): AsyncIterable<SearchDoc> {
  for (const i of treeFor(id).items) {
    if (i.kind === 'folder' || i.trashedAt) continue;
    yield { id: i.id, kind: i.kind, name: i.name, title: i.name, blocks: [] };
  }
}
