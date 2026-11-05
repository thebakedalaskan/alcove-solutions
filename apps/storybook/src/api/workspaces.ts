/*
 * Workspaces and the documents in them, kept in the world. A document is a real Y.Doc, started from the same bytes the API
 * starts every document with, so the editor opens it as it opens any other; what's typed stays in this story. Nobody else
 * is ever in it.
 */
import {
  AlcoveApiError, DOC_SEED, randomClient, type DocSession, type DocSize, type DocStatus, type DocUnsentCopy, type DocVersion, type DocVersionSummary, type DocumentRole,
  type DocumentShare, type ItemInput, type ItemPlace, type SearchDoc, type ShareTarget, type WorkspaceItem, type WorkspaceLive, type WorkspacePerson,
  type WorkspaceRole, type WorkspaceSummary, type WorkspaceTree, type WorkspaceView, type WorkspaceWhere
} from '@alcove/api';
import { itemsOnPage } from '@alcove/api/retire';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { personAt } from '../world/people';
import { Pushed } from './live';
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

/** Everyone in a workspace: you, its admin, and the people on your team who use Alcove. */
export function peopleIn(id: string): WorkspacePerson[] {
  treeOf(id);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const team = (current().team?.members ?? []).filter((m) => m.onAlcove).map((m, i): WorkspacePerson => ({ id: `wp-${i}`, person: m.person, role: 'edit', since, isMe: false }));
  return [{ id: 'wp-me', person: me(), role: 'admin', since, isMe: true }, ...team];
}
export function addPerson(id: string, email: string, _role: WorkspaceRole): { id: string } {
  treeOf(id);
  return { id: `wp-${personAt(email).email}` };
}

const shares = new Map<string, DocumentShare['entries']>();
export function shareOf(id: string, documentId: string): DocumentShare {
  const tree = treeOf(id);
  const doc = tree.items.find((i) => i.id === documentId);
  return { workspace: { name: tree.name ?? '', people: tree.people ?? 0 }, restricted: doc?.restricted ?? false, entries: shares.get(documentId) ?? [] };
}
export function shareWith(documentId: string, to: ShareTarget[], role: DocumentRole): void {
  const since = new Date().toISOString();
  const added = to.map((t) => ('email' in t
    ? { id: nextId('share'), kind: 'email' as const, person: personAt(t.email), role, since }
    : { id: nextId('share'), kind: 'seat' as const, person: { id: t.seat, name: 'Someone in the call', email: '' }, role, since }));
  shares.set(documentId, [...(shares.get(documentId) ?? []), ...added]);
}
export function unshare(documentId: string, entryId: string): void {
  shares.set(documentId, (shares.get(documentId) ?? []).filter((e) => e.id !== entryId));
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

const docs = new Map<string, Y.Doc>();
/** A document as a browser holds one: on a Yjs client of its own, never one of those only the API writes as. */
function ownDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = randomClient();
  return doc;
}
class Document extends Pushed<DocStatus> implements DocSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly ready: Promise<void>;
  constructor(documentId: string, role: DocumentRole) {
    super({ status: 'saved', refused: null, role, trashed: false, closed: null, unsent: false });
    const known = docs.get(documentId);
    this.doc = known ?? ownDoc();
    if (!known) { Y.applyUpdate(this.doc, DOC_SEED); docs.set(documentId, this.doc); }
    this.awareness = new Awareness(this.doc);
    this.ready = Promise.resolve();
  }
  /** Nothing here waits on Alcove, so nobody has words of their own that it hasn't taken. */
  unsentCopy(): DocUnsentCopy { return { text: '', token: { vector: Y.encodeStateVector(this.doc), keys: [] } }; }
  size(): DocSize { return { bytes: Y.encodeStateAsUpdate(this.doc).length, items: itemsOnPage(this.doc) }; }
  /** There's never anything unsent here to let go of. */
  discardUnsaved(): Promise<void> { this.close(); return Promise.resolve(); }
  override close(): void { this.awareness.destroy(); super.close(); }
}
export function openDocument(id: string, documentId: string): DocSession {
  const item = treeOf(id).items.find((i) => i.id === documentId);
  if (!item || item.kind === 'folder') throw notFound();
  return new Document(documentId, item.role);
}
/** A new document or board of a state, made as the API makes one: a document starts from the seed, then takes the state. */
export function saveCopy(id: string, input: ItemInput & { state: Uint8Array }): { id: string } {
  const made = createItem(id, input);
  const doc = ownDoc();
  if (input.kind === 'document') Y.applyUpdate(doc, DOC_SEED);
  Y.applyUpdate(doc, input.state);
  docs.set(made.id, doc);
  return made;
}
/** The documents kept for this story go when it does. */
export function forgetDocuments(): void {
  for (const d of docs.values()) d.destroy();
  docs.clear();
  shares.clear();
  watching.clear();
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
