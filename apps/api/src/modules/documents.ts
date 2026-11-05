/*
 * Documents people bring to calls: what's in their workspaces, as modules/workspaceAccess.ts lets each of them have it. A
 * call keeps only IDs and each person is told, on every read, what they may know of them, so a name, who can open what and
 * whether something's still there are never out of date.
 */
import { firstName, type CallDocument, type Document, type DocumentKind, type DocumentLibrary, type ItemKind, type WorkspaceTree } from '@alcove/api';
import type { Deps, Owner } from '../context';
import { NotFoundError, ValidationError } from '../errors';
import { log } from '../log';
import { accountReader, broughtFrom, type Reader, type Who } from './workspaceAccess';
import { list, tree } from './workspaces';

const dlog = log.child({ component: 'documents' });

/** What each kind of item is on a call. A folder has no place on one. */
const KINDS: Partial<Record<ItemKind, DocumentKind>> = { document: 'doc', board: 'board' };

/**
 * What a call keeps for a document. An item's own ID doesn't say which workspace it's in, and only a workspace's keys open
 * its tree, so this names both: the workspace's public handle and the item, 22 characters of base64url each with a dot
 * between. To everything else it's one opaque ID. An ID from the sample catalog, which stored calls can still hold, doesn't
 * look like this, so it names nothing.
 */
const broughtId = (workspaceId: string, itemId: string): string => `${workspaceId}.${itemId}`;
const BROUGHT_ID = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/;

/** Whose something is, by first name, and nobody's when nobody in particular made it. */
const whose = (by: { name: string } | null): string | null => (by?.name.trim() ? firstName(by.name) : null);

/** What can be brought from a workspace as someone sees it, newest first. Who sees what is settled by then. */
const bringable = (t: WorkspaceTree): Document[] => t.items.flatMap((x): Document[] => {
  const kind = KINDS[x.kind];
  return kind && x.trashedAt === null ? [{ id: broughtId(t.id, x.id), name: x.name, kind, by: whose(x.by), updatedAt: x.editedAt }] : [];
}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

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
 * Taken off, it's like anything else they can't open.
 */
export async function validDocuments(o: Owner, ids: string[], kept: readonly string[] = []): Promise<void> {
  const adding = ids.filter((id) => !kept.includes(id));
  const theirs = new Set(adding.length ? (await library(o)).workspaces.flatMap((w) => w.documents.map((d) => d.id)) : []);
  const unknown = adding.filter((id) => !theirs.has(id)).length;
  if (unknown || new Set(ids).size !== ids.length) throw new ValidationError('Bring documents from your own library, each once.', { context: { documents: ids.length, unknown } });
}

/**
 * What a call's documents say to someone: a name only for those who can open one. One that's in Trash or gone isn't listed,
 * and nor is anything in a workspace that can't be read: a call doesn't depend on what's brought to it. `ids` are what the
 * call keeps, never what a request sent: reading them answers for things `viewer` can't open.
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
      for (const { id, item, role } of await broughtFrom(d, viewer, workspaceId, items)) {
        const kind = KINDS[item.kind];
        const brought = broughtId(workspaceId, id);
        if (kind) found.set(brought, { id: brought, kind, by: whose(item.by), name: role ? item.name : null });
      }
    } catch (e) {
      dlog.warn('documents not read', { workspaceId, err: e });
    }
  }
  return ids.flatMap((id) => found.get(id) ?? []);
}
