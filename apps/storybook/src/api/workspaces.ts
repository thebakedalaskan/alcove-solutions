/*
 * Workspaces and the documents in them, kept in the world. A document is a real Y.Doc, started from the same bytes the API
 * starts every document with and written with the editor's own blocks (the world's `pages`), so the editor opens it as it
 * opens any other; what's typed stays in this story. Nobody else is ever in it. A page can say Alcove refused some of what
 * this browser wrote: its session opens couldn't-save, with those words on the page, until they're copied, saved as a new
 * document or discarded. Files are kept in the world (`media`) and read back as the browser's own object URLs.
 */
import {
  AlcoveApiError, DOC_SEED, type DocSession, type DocSize, type DocStatus, type DocUnsentCopy, type DocVersion, type DocVersionSummary, type DocumentRole,
  type DocumentShare, type ItemInput, type ItemPlace, type SearchDoc, type ShareEntry, type ShareTarget, type WorkspaceItem, type WorkspaceLive,
  type WorkspacePerson, type WorkspaceRole, type WorkspaceSummary, type WorkspaceTree, type WorkspaceView, type WorkspaceWhere, servedType, type MediaPictureOptions, type MediaUploadOptions, type WorkspaceMedia, type WorkspaceReadOptions
} from '@alcove/api';
import { itemsOnPage } from '@alcove/api/retire';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { setTitle } from '~/features/workspace/editor/title';
import type { BlockJSON } from '~/features/workspace/editor/types';
import { appendBlocks, contentOf } from '~/features/workspace/editor/ydoc';
import { isOnline } from '../browser';
import { personAt } from '../world/people';
import { Pushed, pause } from './live';
import { current, me, nextId } from './state';

const notFound = () => new AlcoveApiError('not-found', 'That workspace isn’t there, or you can’t open it.');

export function treeOf(id: string): WorkspaceTree {
  const tree = current().workspaces.find((w) => w.id === id);
  if (!tree) throw notFound();
  return tree;
}
const summaryOf = ({ items: _items, ...rest }: WorkspaceTree): WorkspaceSummary => rest;
export const workspaceList = (): WorkspaceSummary[] => current().workspaces.map(summaryOf);

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
    createdAt: now, editedAt: now, trashedAt: null, trashedBy: null, restricted: false, role: 'edit'
  };
  edit(id, (items) => place([...items, item], item, { parent: item.parent, ...(input.after !== undefined ? { after: input.after } : {}) }));
  return { id: item.id };
}
export const renameItem = (id: string, itemId: string, name: string) => edit(id, (items) => items.map((i) => (i.id === itemId ? { ...i, name, editedAt: new Date().toISOString() } : i)));
export const moveItem = (id: string, itemId: string, to: ItemPlace) => edit(id, (items) => { const it = items.find((i) => i.id === itemId); return it ? place(items, it, to) : items; });
export const trashItem = (id: string, itemId: string) => edit(id, (items) => items.map((i) => (i.id === itemId || i.parent === itemId ? { ...i, trashedAt: new Date().toISOString(), trashedBy: me().name } : i)));
export const restoreItem = (id: string, itemId: string) => edit(id, (items) => items.map((i) => (i.id === itemId ? { ...i, trashedAt: null, trashedBy: null } : i)));
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
  const team = (current().team?.members ?? []).filter((m) => m.onAlcove)
    .map((m, i): WorkspacePerson => ({ id: `wp-${i}`, person: m.person, role: mine !== 'admin' && i === 0 ? 'admin' : 'edit', since, isMe: false }));
  return [{ id: 'wp-me', person: me(), role: mine, since, isMe: true }, ...team];
}
export function addPerson(id: string, email: string, _role: WorkspaceRole): { id: string } {
  treeOf(id);
  return { id: `wp-${personAt(email).email}` };
}

export function shareOf(id: string, documentId: string): DocumentShare {
  const tree = treeOf(id);
  const doc = tree.items.find((i) => i.id === documentId);
  return { workspace: { name: tree.name ?? '', people: tree.people ?? 0 }, restricted: doc?.restricted ?? false, entries: current().shares[documentId] ?? [] };
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

/* ---------- live ---------- */

const watching = new Set<LiveWorkspace>();
class LiveWorkspace extends Pushed<WorkspaceView> implements WorkspaceLive {
  constructor(private readonly id: string) {
    super({ status: 'live', tree: structuredClone(treeOf(id)), here: [] });
    watching.add(this);
  }
  refresh(id: string): void { if (id === this.id) this.update((v) => ({ ...v, tree: structuredClone(treeOf(id)) })); }
  present(_where: WorkspaceWhere): void { /* Nobody else is here to see where you are. */ }
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
const openable = (tree: WorkspaceTree): Set<string> => new Set(tree.items.filter((i) => i.kind !== 'folder' && i.trashedAt === null).map((i) => i.id));
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
  current().media.unshift({ workspace: id, media, body: () => Promise.resolve(file) });
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
const lineOf = (text: string): BlockJSON => ({ type: 'line', content: [{ type: 'text', text }] });
/**
 * A document as the world has it: its title, what its page says, and whatever of it Alcove refused, which only this browser
 * has. The empty first line every document starts with is written over, as typing into it would be.
 */
function documentOf(item: WorkspaceItem): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, DOC_SEED);
  if (item.kind !== 'document') return doc;
  setTitle(doc, item.name);
  const page = current().pages[item.id];
  const blocks = [...(page?.blocks ?? []), ...(page?.refused?.words ?? []).map(lineOf)];
  if (blocks.length > 0) {
    appendBlocks(doc, blocks);
    contentOf(doc).delete(1, 1);
  }
  return doc;
}
class Document extends Pushed<DocStatus> implements DocSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly ready: Promise<void>;
  private readonly id: string;
  constructor(item: WorkspaceItem) {
    const refused = current().pages[item.id]?.refused ?? null;
    super({ status: refused ? 'failed' : 'saved', refused: refused?.why ?? null, role: item.role, trashed: item.trashedAt !== null, closed: null, unsent: refused !== null });
    this.id = item.id;
    const known = docs.get(item.id);
    this.doc = known ?? documentOf(item);
    if (!known) docs.set(item.id, this.doc);
    this.awareness = new Awareness(this.doc);
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
  override close(): void { this.awareness.destroy(); super.close(); }
}
export function openDocument(id: string, documentId: string): DocSession {
  const item = treeOf(id).items.find((i) => i.id === documentId);
  if (!item || item.kind === 'folder') throw notFound();
  return new Document(item);
}
/**
 * A new document or board of a state, made as the API makes one: a document starts from the seed, takes the state, and is
 * titled with the name it's given.
 */
export function saveCopy(id: string, input: ItemInput & { state: Uint8Array }): { id: string } {
  const made = createItem(id, input);
  const doc = new Y.Doc();
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
  watching.clear();
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

export const noVersions = (): DocVersionSummary[] => [];
export const noVersion = (): Promise<DocVersion> => Promise.reject(new AlcoveApiError('not-found', 'That version isn’t there.'));
/** Every document you can open here, as words, for searching in this browser. */
export async function* searchText(id: string): AsyncIterable<SearchDoc> {
  for (const i of treeOf(id).items) {
    if (i.kind === 'folder' || i.trashedAt) continue;
    yield { id: i.id, kind: i.kind, name: i.name, title: i.name, blocks: [] };
  }
}
