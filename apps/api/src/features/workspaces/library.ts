/*
 * Documents people bring to calls: what's in their workspaces, as features/workspaces/access.ts lets each of them have it. A
 * call keeps only IDs and each person is told, on every read, what they may know of them, so a name, who can open what and
 * whether something's still there are never out of date.
 */
import type { CallDocument, Document, DocumentKind, DocumentLibrary, WorkspaceTree } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, closedDocumentKey, mac, utf8 } from '../../crypto';
import { NotFoundError, ValidationError } from '../../errors';
import { log } from '../../log';
import { findItem } from '../../vault';
import { WorkedDocument } from '../calls/space-state';
import { accountReader, broughtFrom, whoseItIs, type BroughtKind, type Reader, type Who } from './access';
import { list, tree } from './service';

const dlog = log.child({ component: 'documents' });

/** What each kind of item is on a call. */
const KINDS: Record<BroughtKind, DocumentKind> = { document: 'doc', board: 'board' };

/**
 * What a call keeps for a document. An item's own ID doesn't say which workspace it's in, and only a workspace's keys open
 * its tree, so this names both: the workspace's public handle and the item, 22 characters of base64url each with a dot
 * between. To everything else it's one opaque ID. An ID from the sample catalog, which stored calls can still hold, doesn't
 * look like this, so it names nothing.
 */
const broughtId = (workspaceId: string, itemId: string): string => `${workspaceId}.${itemId}`;
const BROUGHT_ID = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/;

/**
 * What someone who can't open something on a call knows it by. What the call keeps says which workspace and which item, and
 * they may know neither. It would also show the same thing on two calls, or to two people, as the same thing. This is
 * keyed to its reader and worked out for one call, so all it can say is "this entry, here": no two people's can be compared,
 * nor one person's across calls, and it's the same on every read. It looks like any other ID.
 */
const closedId = (viewer: Owner, meetingId: string, kept: string): string =>
  b64u(mac(closedDocumentKey(viewer.root, viewer.ownerId), utf8(`${meetingId}\n${kept}`))).slice(0, 22);

/** What can be brought from a workspace as someone sees it, newest first. Who sees what is settled by then. */
const bringable = (t: WorkspaceTree): Document[] => t.items.flatMap((x): Document[] => (
  x.kind !== 'folder' && x.trashedAt === null ? [{ id: broughtId(t.id, x.id), item: x.id, name: x.name, kind: KINDS[x.kind], by: whoseItIs(x.by), updatedAt: x.editedAt }] : []
)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** A workspace as someone sees it, unless it went, or they lost it, since it was listed. */
async function stillThere(o: Owner, reader: Reader, workspaceId: string): Promise<WorkspaceTree | undefined> {
  try {
    return await tree(o, reader, workspaceId);
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
    dlog.debug('workspace gone from a library', { workspaceId });
    return undefined;
  }
}

/** What someone can bring to a call: what they can open with their account, by workspace. A seat in a call adds nothing, because it ends with that call. */
export async function library(o: Owner): Promise<DocumentLibrary> {
  const reader = await accountReader(o);
  const workspaces: DocumentLibrary['workspaces'] = [];
  for (const { id } of await list(reader)) {
    const seen = await stillThere(o, reader, id);
    const documents = seen ? bringable(seen) : [];
    if (seen && documents.length) workspaces.push({ id, name: seen.name, documents });
  }
  return { workspaces };
}

/**
 * Refuses anything that isn't in the organizer's library, and anything twice. It only compares: what a request sends reaches
 * no workspace, so a made-up ID and a real one they can't open go the same way and read the same. What's on the call already
 * (`kept`) can stay, because they can lose it after bringing it, and that shouldn't stop every other change to the call.
 * Taken off, it's like anything else they can't open. This is for what a request sends: a list a call already keeps is
 * carried on as it stands, to the next call in a series and to the calls a repeat adds.
 */
export async function validDocuments(o: Owner, ids: string[], kept: readonly string[] = []): Promise<void> {
  const adding = ids.filter((id) => !kept.includes(id));
  const theirs = new Set(adding.length ? (await library(o)).workspaces.flatMap((w) => w.documents.map((d) => d.id)) : []);
  const unknown = adding.filter((id) => !theirs.has(id)).length;
  if (unknown || new Set(ids).size !== ids.length) throw new ValidationError('Bring documents from your own library, each once.', { context: { documents: ids.length, unknown } });
}

/** What a note keeps of what was worked on in its call, read on its own (features/notes/service.ts has the rest). */
const NoteWorked = z.object({ workedOn: z.array(WorkedDocument).default([]) });
/**
 * The boards open for everyone in a call, as what its organizer can bring (`Document.id`), for the next call in its series to
 * bring as well: there they're offered first, as anything brought is. One they can't bring now isn't carried.
 */
export async function boardsFrom(o: Owner, noteId: string | undefined): Promise<string[]> {
  const note = noteId ? await findItem(o, o.pool, 'note', noteId, NoteWorked) : undefined;
  const ids = (note?.manifest.workedOn ?? []).filter((x) => x.kind === 'board' && x.open !== null).map((x) => broughtId(x.workspaceId, x.documentId));
  if (!ids.length) return [];
  const theirs = new Set((await library(o)).workspaces.flatMap((w) => w.documents.map((d) => d.id)));
  return [...new Set(ids)].filter((id) => theirs.has(id));
}

/**
 * What a list sent for this call means. Whoever can't open something on it was told `closedId`, and sends that back with
 * the rest, so it means what the call keeps. It means nothing on any other call, and nothing to anyone else.
 */
export function keptIds(viewer: Owner, meetingId: string, kept: readonly string[], sent: readonly string[]): string[] {
  const told = new Map(kept.map((id) => [closedId(viewer, meetingId, id), id]));
  return sent.map((id) => told.get(id) ?? id);
}

/** One of a call's documents as `viewer` is told it: `documentsFor` read it, and this says which call it's on. */
export const shownOn = (viewer: Owner, meetingId: string, doc: CallDocument): CallDocument => (doc.name === null ? { ...doc, id: closedId(viewer, meetingId, doc.id) } : doc);

/**
 * What a call's documents say to someone: a name only for those who can open one. One that's in Trash or gone isn't listed,
 * and nor is anything in a workspace that can't be read: a call doesn't depend on what's brought to it. `ids` are what the
 * call keeps, never what a request sent: reading them answers for things `viewer` can't open. They're still the IDs the
 * call keeps, so a list is read once for any number of calls: nothing leaves without going through `shownOn`.
 */
export async function documentsFor(d: Deps, ids: readonly string[], viewer: Who): Promise<CallDocument[]> {
  const places = new Map<string, string[]>();
  for (const id of ids) {
    const [, workspaceId, itemId] = BROUGHT_ID.exec(id) ?? [];
    if (workspaceId && itemId) places.set(workspaceId, [...(places.get(workspaceId) ?? []), itemId]);
  }
  const found = new Map<string, CallDocument>();
  for (const [workspaceId, items] of places) {
    try {
      for (const { id, kind, by, name } of await broughtFrom(d, viewer, workspaceId, items)) {
        const brought = broughtId(workspaceId, id);
        found.set(brought, { id: brought, kind: KINDS[kind], by, name });
      }
    } catch (e) {
      dlog.warn('documents not read', { workspaceId, err: e });
    }
  }
  return ids.flatMap((id) => found.get(id) ?? []);
}
