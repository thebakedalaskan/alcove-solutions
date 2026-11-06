/*
 * A mind map: ideas as nodes, each naming the one it branches from (`parent`), so the branches between them are drawn
 * from that and never stored as lines. A first idea has no parent. New ideas branch to the right of the one they come
 * from, one under another, the way the board's frames run.
 */
import { hasBox, type BoardView, type NodeObject } from './shape';
import { addObject, viewOf } from './write';
import type * as Y from 'yjs';

/** How big a node starts: a first idea, and one that branches from another. */
export const NODE = { first: { w: 220, h: 72 }, branch: { w: 190, h: 56 } } as const;
/** How far a branch sits to the right of what it comes from, and below the branch before it. */
const ACROSS = 72, UNDER = 20;
/** The room a new mind map wants, so its first branches land clear too: its first idea, with a column of branches beside it. */
export const MAP_ROOM = { w: NODE.first.w + ACROSS + NODE.branch.w, h: NODE.first.h + 2 * (NODE.branch.h + UNDER) } as const;

/** Starts a mind map with its first idea, nobody's words yet, with its middle at `x y`. */
export function addMindMap(doc: Y.Doc, at: { x: number; y: number }, origin: unknown): string | null {
  const { w, h } = NODE.first;
  return addObject(doc, { k: 'node', x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h, parent: '', t: '' }, origin);
}

/**
 * Where a new idea branching from `from` goes: to its right, under the ones that already branch from it, or level with it if
 * it's the first. `except` is one not to count, such as a branch being placed again because another landed on it.
 */
export function branchSpot(view: BoardView, from: NodeObject, except = ''): { x: number; y: number } {
  const { h } = NODE.branch;
  const after = view.objects.filter((o): o is NodeObject => o.k === 'node' && o.parent === from.id && o.id !== except);
  const y = after.length ? Math.max(...after.map((o) => o.y + o.h)) + UNDER : Math.round(from.y + (from.h - h) / 2);
  return { x: from.x + from.w + ACROSS, y };
}

/** A new idea branching from `parent`, where `branchSpot` puts it. */
export function addBranch(doc: Y.Doc, parent: string, origin: unknown): string | null {
  const view = viewOf(doc);
  const from = view.byId.get(parent);
  if (from?.k !== 'node') return null;
  const { w, h } = NODE.branch;
  return addObject(doc, { k: 'node', ...branchSpot(view, from), w, h, parent, t: '' }, origin);
}

/** A new idea beside `node`: another branch from what it comes from, or, beside a first idea, another first idea under it. */
export function addSibling(doc: Y.Doc, node: string, origin: unknown): string | null {
  const view = viewOf(doc);
  const o = view.byId.get(node);
  if (o?.k !== 'node') return null;
  if (o.parent && view.byId.get(o.parent)?.k === 'node') return addBranch(doc, o.parent, origin);
  const { w, h } = NODE.first;
  return addObject(doc, { k: 'node', x: o.x, y: o.y + o.h + UNDER * 2, w, h, parent: '', t: '' }, origin);
}

/** Each idea with the one it branches from, for the branches drawn between them: only where both are on the board. */
export function branches(view: BoardView): { from: NodeObject; to: NodeObject }[] {
  return view.objects.flatMap((o) => {
    if (o.k !== 'node' || !o.parent) return [];
    const from = view.byId.get(o.parent);
    return from?.k === 'node' && hasBox(from) ? [{ from, to: o }] : [];
  });
}

/** The branch between two ideas, in board units: a curve from the right of one to the left of the other. */
export function branchPath(from: NodeObject, to: NodeObject): string {
  const x0 = from.x + from.w, y0 = from.y + from.h / 2, x1 = to.x, y1 = to.y + to.h / 2;
  const bend = Math.max(24, (x1 - x0) / 2);
  return `M${x0} ${y0} C${x0 + bend} ${y0} ${x1 - bend} ${y1} ${x1} ${y1}`;
}
