/*
 * What the Drive page reads across someone's workspaces (docs: Product › The Drive): what a document says at the top, for its
 * card, and one Trash for every workspace. Google Drive is something else, in features/notes/drive*.ts.
 *
 * Who can open what is features/workspaces/access.ts's to say, asked here as everywhere: nothing is read for anyone who can't
 * open it, and an ID they can't open is left out the same as one that never was. What a document says is read from it as it
 * is, in a worker (`readDocument`), and goes to the browser and nowhere else: it's never kept, logged or put in a receipt.
 */
import { MAX_PREVIEWS, PREVIEW_CHARS, PREVIEW_LINES, type DocumentPreview, type Trashed } from '@alcove/api';
import type { Deps, Owner } from '../../platform/context';
import { AppError } from '../../platform/errors';
import { log } from '../../platform/log';
import { accountReader, limitKey, roleOf, trashOf, workspaceFor, workspaceVersion, type Reader, type Workspace } from './access';
import { readDocument } from './documents/documents';
import { stillThere } from './library/library';
import { TRASH_MS, list } from './service';

const dlog = log.child({ component: 'drive' });

/** Whether a card can show what this says: a document, not a board or a folder, that the reader can open, and not in Trash. */
function previewable(reader: Reader, w: Workspace, id: string): boolean {
  const item = w.state.items[id];
  return item?.kind === 'document' && roleOf(reader, w, id, item) !== undefined && trashOf(w.state, id) === null;
}

/**
 * What each of these documents says at the top, for its card, as it is now: its first lines, the pictures, videos and files it
 * holds. Only what the reader can open; anything else asked about is left out, as a made-up ID is. One that won't open is
 * left out too, and the rest still come. Reading takes a moment, so if who has what changed meanwhile it's asked again, and
 * nothing goes to someone who lost it on the way.
 */
export async function previews(d: Deps, reader: Reader, workspaceId: string, ids: readonly string[]): Promise<DocumentPreview[]> {
  const w = await workspaceFor(d, reader, workspaceId);
  const asked = [...new Set(ids)].slice(0, MAX_PREVIEWS);
  const read: DocumentPreview[] = [];
  for (const id of asked.filter((x) => previewable(reader, w, x))) {
    try {
      read.push({ id, ...(await readDocument(w, id, 'preview', { kind: 'document', lines: PREVIEW_LINES, chars: PREVIEW_CHARS }, limitKey(reader))) });
    } catch (e) {
      dlog.at(e instanceof AppError && e.status < 500 ? 'info' : 'warn', 'a document’s preview wasn’t read', { workspaceId, documentId: id, err: e });
    }
  }
  dlog.debug('previews read', { workspaceId, asked: asked.length, read: read.length });
  if (!read.length || (await workspaceVersion(d, workspaceId)) === w.version) return read;
  const now = await workspaceFor(d, reader, workspaceId);
  return read.filter((p) => previewable(reader, now, p.id));
}

/**
 * One Trash for the Drive: everything in Trash in every workspace someone's in or has something in, as each workspace's tree
 * shows it to them (what's inside a folder in Trash too, with the folder's time), the latest sent there first, each with when
 * it goes for good. A workspace that went, or that they lost, since it was listed has nothing in it for them.
 */
export async function trashed(o: Owner): Promise<Trashed[]> {
  const reader = await accountReader(o);
  const out: Trashed[] = [];
  const spaces = await list(reader);
  for (const { id } of spaces) {
    for (const item of (await stillThere(o, reader, id))?.items ?? []) {
      if (item.trashedAt !== null) out.push({ workspaceId: id, item, deletesAt: new Date(Date.parse(item.trashedAt) + TRASH_MS).toISOString() });
    }
  }
  dlog.debug('trash read', { workspaces: spaces.length, items: out.length });
  return out.sort((a, b) => (b.item.trashedAt ?? '').localeCompare(a.item.trashedAt ?? '') || a.workspaceId.localeCompare(b.workspaceId));
}
