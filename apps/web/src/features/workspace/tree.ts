/*
 * What a workspace's tree says, worked out from the whole tree its stream sends: what's in each folder, the rows the list
 * shows, where something sits and where a drag would land it. Nothing here talks to anything.
 */
import type { ItemPlace, WorkspaceItem } from '@alcove/api';

/** What a row says for something nobody has named yet. */
const UNNAMED: Record<WorkspaceItem['kind'], string> = { document: 'Untitled', folder: 'Untitled folder', board: 'Untitled board' };
export const nameOf = (item: Pick<WorkspaceItem, 'kind' | 'name'>): string => item.name || UNNAMED[item.kind];

/** A title can run on: the list keeps what fits in a name, on one line. */
export const nameFrom = (title: string): string => title.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * A workspace's items, by ID and by what's in each folder. `kids` leaves out Trash, and boards where they aren't listed: a call
 * shows its boards itself, on the stage, so its workspace lists documents and folders. `all` has everything, boards included.
 */
export interface Tree {
  all: ReadonlyMap<string, WorkspaceItem>;
  kids: ReadonlyMap<string | null, readonly WorkspaceItem[]>;
  /** Boards are in the list: the workspace as a page. */
  boards: boolean;
}

export function treeOf(items: readonly WorkspaceItem[], boards: boolean): Tree {
  const all = new Map(items.map((i) => [i.id, i]));
  const kids = new Map<string | null, WorkspaceItem[]>();
  for (const item of items) {
    if (item.trashedAt !== null || (!boards && item.kind === 'board')) continue;
    const at = item.parent !== null && all.has(item.parent) ? item.parent : null;
    const here = kids.get(at);
    if (here) here.push(item);
    else kids.set(at, [item]);
  }
  return { all, kids, boards };
}

const kidsOf = (t: Tree, parent: string | null): readonly WorkspaceItem[] => t.kids.get(parent) ?? [];

/** A row in the list: something in the tree, or the folder being made in `draftIn`. */
export type ListRow = { draft: false; item: WorkspaceItem; depth: number; open: boolean } | { draft: true; depth: number };

/**
 * Everything the list shows, top to bottom: what's inside a folder only while it's open. A folder being made goes last in
 * the folder it's going into (`draftIn`; null is the top, undefined none).
 */
export function rowsOf(t: Tree, open: ReadonlySet<string>, draftIn?: string | null | undefined): ListRow[] {
  const out: ListRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const item of kidsOf(t, parent)) {
      const isOpen = item.kind === 'folder' && open.has(item.id);
      out.push({ draft: false, item, depth, open: isOpen });
      if (isOpen) walk(item.id, depth + 1);
    }
    if (draftIn === parent) out.push({ draft: true, depth });
  };
  walk(null, 0);
  return out;
}

/** The folders around something, outermost first. */
export function foldersAbove(t: Tree, id: string): WorkspaceItem[] {
  const out: WorkspaceItem[] = [];
  let at = t.all.get(id)?.parent ?? null;
  while (at !== null) {
    const folder = t.all.get(at);
    if (!folder) break;
    out.unshift(folder);
    at = folder.parent;
  }
  return out;
}

/** Whether `id` is `folder`, or is somewhere inside it. */
export function isWithin(t: Tree, id: string, folder: string): boolean {
  return id === folder || foldersAbove(t, id).some((f) => f.id === folder);
}

/** Where something sits now, to put it back. */
export function placeOf(t: Tree, id: string): ItemPlace {
  const parent = t.all.get(id)?.parent ?? null;
  const siblings = kidsOf(t, parent);
  const at = siblings.findIndex((i) => i.id === id);
  return { parent, after: at > 0 ? siblings[at - 1]?.id ?? null : null };
}

export type DropSide = 'before' | 'after' | 'inside';

/** Where something lands dropped on `target`: inside it, at its end, or just before or after it among its siblings. */
export function landing(t: Tree, moving: string, target: string, side: DropSide): ItemPlace {
  if (side === 'inside') return { parent: target };
  const parent = t.all.get(target)?.parent ?? null;
  if (side === 'after') return { parent, after: target };
  const siblings = kidsOf(t, parent).filter((i) => i.id !== moving);
  const at = siblings.findIndex((i) => i.id === target);
  return { parent, after: at > 0 ? siblings[at - 1]?.id ?? null : null };
}

/** Whether something is already where it would land. */
export function samePlace(t: Tree, id: string, to: ItemPlace): boolean {
  const was = placeOf(t, id);
  if (was.parent !== to.parent) return false;
  if (to.after === undefined) return kidsOf(t, to.parent).at(-1)?.id === id;
  return was.after === to.after;
}

/** One place earlier or later among its siblings, for moving a row from the keyboard. Null at either end. */
export function nudged(t: Tree, id: string, by: -1 | 1): ItemPlace | null {
  const parent = t.all.get(id)?.parent ?? null;
  const siblings = kidsOf(t, parent);
  const at = siblings.findIndex((i) => i.id === id);
  const next = siblings[at + by];
  if (at < 0 || !next) return null;
  return by < 0 ? { parent, after: siblings[at - 2]?.id ?? null } : { parent, after: next.id };
}

/** Every folder something could move to: not itself, and nothing inside it. */
export function foldersFor(t: Tree, moving: string): { id: string; name: string; path: string }[] {
  const out: { id: string; name: string; path: string }[] = [];
  const walk = (parent: string | null) => {
    for (const item of kidsOf(t, parent)) {
      if (item.kind !== 'folder' || item.id === moving) continue;
      out.push({ id: item.id, name: nameOf(item), path: foldersAbove(t, item.id).map(nameOf).join(' / ') });
      walk(item.id);
    }
  };
  walk(null);
  return out;
}

/** The documents and boards in the list, top to bottom, folders open or not: whatever opens on the page. */
export function documentsIn(t: Tree): WorkspaceItem[] {
  const out: WorkspaceItem[] = [];
  const walk = (parent: string | null) => {
    for (const item of kidsOf(t, parent)) {
      if (item.kind === 'folder') walk(item.id);
      else out.push(item);
    }
  };
  walk(null);
  return out;
}

/** What to show after `gone` leaves the list: the document after it, or the one before, outside anything leaving with it. */
export function nextDocument(t: Tree, gone: string): string | null {
  const docs = documentsIn(t);
  const at = docs.findIndex((d) => d.id === gone);
  const staying = (d: WorkspaceItem) => !isWithin(t, d.id, gone);
  return (docs.slice(at + 1).find(staying) ?? docs.filter(staying).at(-1))?.id ?? null;
}

/**
 * What's in Trash on its own account: something inside a folder there goes and comes back with the folder. The newest first.
 * Boards only where they're listed (`Tree.boards`).
 */
export function trashIn(items: readonly WorkspaceItem[], boards: boolean): WorkspaceItem[] {
  const trashed = new Set(items.filter((i) => i.trashedAt !== null).map((i) => i.id));
  return items
    .filter((i) => i.trashedAt !== null && (boards || i.kind !== 'board') && !(i.parent !== null && trashed.has(i.parent)))
    .sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
}

/** The one ID that changed place between two orders of the same items, when exactly one did. */
function movedAmong(before: readonly string[], after: readonly string[]): string | null {
  const at = before.findIndex((id, i) => id !== after[i]);
  const without = (list: readonly string[], id: string | undefined) => list.filter((x) => x !== id);
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (at < 0) return null;
  const a = before[at], b = after[at];
  if (same(without(before, a), without(after, a))) return a ?? null;
  if (same(without(before, b), without(after, b))) return b ?? null;
  return null;
}

/** What arrived in the list or changed place in it between two trees, to glow. */
export function arrivals(before: Tree, after: Tree): string[] {
  const out = new Set<string>();
  const inList = (t: Tree) => new Set([...t.kids.values()].flat().map((i) => i.id));
  const was = inList(before);
  for (const id of inList(after)) {
    if (!was.has(id) || before.all.get(id)?.parent !== after.all.get(id)?.parent) out.add(id);
  }
  for (const [parent, kids] of after.kids) {
    const here = kids.map((i) => i.id).filter((id) => !out.has(id));
    const staying = new Set(here);
    const there = kidsOf(before, parent).map((i) => i.id).filter((id) => staying.has(id));
    const moved = here.length === there.length ? movedAmong(there, here) : null;
    if (moved) out.add(moved);
  }
  return [...out];
}
