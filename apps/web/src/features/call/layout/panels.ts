/*
 * How the call shares the main area, left of your side (side.ts). Everything you can look at there is a panel: the stage,
 * the people, each shared screen, the workspace and the board. Panels sit in a small tree of rows and columns that only you
 * can see: hiding one keeps its place, and a line between two resizes them. When there isn't room, panels give way in a
 * fixed order (see `adapt`), so the same arrangement works from a wide monitor down to a phone.
 *
 * With nothing beside the call, the stage is one panel: stageLayout.ts places the people and what's shared on it, as it
 * always has. Once the workspace or the board is open, or something is shared with the people folded to arches or hidden
 * (View's Beside what's shared), the stage comes apart and the people and each share shown big stand as panels of their own
 * (`Adapted.apart`).
 * Either way they're drawn in one layer (Stage.tsx), so nothing that's playing ever remounts when a panel moves.
 *
 * Shares sit in seats (`share:1`, `share:2`), so what's kept for your account never names a share: whoever shares takes
 * a free seat for as long as they're shown big (`seatShares`).
 *
 * Everything here is pure: an arrangement in, a new one or some rectangles out.
 */
import { CALL_PANEL_SIZE_MAX, type CallPanelBranch, type CallPanelLeaf, type CallPanelLeafId, type CallPanelNode, type CallPanels, type CallPeopleMode } from '@alcove/api';
import type { Box } from './stageLayout';

export type Leaf = CallPanelLeafId;
export type ShareLeaf = 'share:1' | 'share:2';
export type PeopleMode = CallPeopleMode;
export interface Size { w: number; h: number }

/** Under this wide, a window is a phone: one thing at a time, and your side a sheet over the call. */
export const PHONE_W = 600;
/** The gap between panels, and between them and your side. */
export const GAP = 12;
/** The least the stage is given across. */
const STAGE_MIN = 380;
/** The people as arches: in a column, or a strip. A tile strip's height, while it hasn't been dragged. */
const ARCH_W = 74;
const ARCH_STRIP = 86;
const TILE_STRIP = 128;
/** Just the document: how far it stands from the window's edges, and how much is left at the bottom for the dock and the arches. */
const ZEN_EDGE = 12;
const ZEN_DOCK = 56;
/** The width people take beside something else, unless dragged. */
export const tileWidth = (w: number) => (w > 1700 ? 300 : w > 1400 ? 248 : 204);

/* ---------- the tree ---------- */

const N = (dir: 'row' | 'col', kids: CallPanelNode[], o: { flex?: number } = {}): CallPanelBranch => ({ dir, kids, ...o });
const L = (id: Leaf, o: { flex?: number } = {}): CallPanelLeaf => ({ id, ...o });
export const isBranch = (n: CallPanelNode): n is CallPanelBranch => 'kids' in n;
export const SHARE_SEATS: ShareLeaf[] = ['share:1', 'share:2'];
export const isShareLeaf = (id: Leaf): id is ShareLeaf => id === 'share:1' || id === 'share:2';

const seats = (dir: 'row' | 'col', flex: number) => N(dir, [L('share:1', { flex: 1 }), L('share:2', { flex: 1 })], { flex });
/** The call's own arrangement: what's shared, the workspace and the board side by side, and the people at the end. */
const callsOwn = () => N('row', [N('row', [L('stage'), seats('col', 1.05), L('ws', { flex: 1.35 }), L('board', { flex: 1.35 })]), L('people')]);
/** The board leading, with a share shown big at the top of the column beside it and everyone under that. */
const boardFirst = () => N('row', [L('stage'), L('board', { flex: 2 }), L('ws', { flex: 2 }), N('col', [seats('col', 1), L('people')], { flex: 0.85 })]);

export const DEFAULT_PANELS: CallPanels = { tree: callsOwn(), people: 'tiles', list: true, apart: false };

const leavesOf = (n: CallPanelNode): Leaf[] => (isBranch(n) ? n.kids.flatMap(leavesOf) : [n.id]);
const sameTree = (a: CallPanelNode, b: CallPanelNode): boolean => {
  if (a.flex !== b.flex || a.px !== b.px || a.pxh !== b.pxh) return false;
  if (isBranch(a) && isBranch(b)) return a.dir === b.dir && a.kids.length === b.kids.length && a.kids.every((k, i) => { const o = b.kids[i]; return !!o && sameTree(k, o); });
  return !isBranch(a) && !isBranch(b) && a.id === b.id;
};

/** Whether an arrangement read back from this browser holds together: every panel has one place. */
export function panelsSound(a: CallPanels): boolean {
  if (!isBranch(a.tree)) return false;
  const leaves = leavesOf(a.tree);
  return new Set(leaves).size === leaves.length && (['stage', 'people', 'ws', 'board', 'share:1', 'share:2'] satisfies Leaf[]).every((id) => leaves.includes(id));
}

/** You changed something the call doesn't start with: Reset my view has something to do. */
export const isArranged = (a: CallPanels) => a.people !== 'tiles' || !a.list || a.apart || !sameTree(a.tree, callsOwn());
/** The call's own arrangement, with nothing resized: the board can lead beside a share without undoing anything of yours. */
export const isCallsOwn = (a: CallPanels) => !a.apart && sameTree(a.tree, callsOwn());
/** The board leads, and a share shown big stands at the top of the column beside it. */
export const boardBesideShare = (a: CallPanels): CallPanels => ({ ...a, tree: boardFirst(), apart: true });

/* ---------- what's showing, and what gives way ---------- */

export interface PanelFacts {
  /** The workspace and the board are open. */
  ws: boolean;
  board: boolean;
  /** The seats of the shares shown big. */
  shown: ShareLeaf[];
  /** Which of the workspace, the board and the shares you've brought up, for when they have to take turns. */
  front: Leaf | null;
  /** A phone: one thing at a time. */
  phone: boolean;
  /** Just the document: everything else steps back, and it has this, past the bars that tuck away. */
  zen: Box | null;
  /** The organizer's stage shows every breakout room, so it stays whole. */
  rooms: boolean;
  /** Room to keep at the top and bottom of the panels for the status bar and captions, once the stage has come apart. */
  top: number;
  bottom: number;
}
export type Gave = 'people' | 'list' | 'tabs' | 'phone';
export interface Adapted {
  /** The people and what's shared are panels of their own, rather than sharing the stage. */
  apart: boolean;
  people: PeopleMode;
  /** The workspace shows its list. */
  list: boolean;
  /** The workspace, the board and the shares take turns, with `front` showing. */
  tabs: boolean;
  front: Leaf | null;
  gave: Gave[];
  phone: boolean;
}

/** What could lead the screen: the workspace, the board, and each share shown big. */
const mains = (f: PanelFacts): Leaf[] => { const open: Leaf[] = f.zen ? [] : [...f.shown]; if (f.board) open.unshift('board'); if (f.ws) open.unshift('ws'); return open; };

function leafShown(id: Leaf, f: PanelFacts, A: Adapted): boolean {
  if (id === 'stage') return !A.apart;
  if (id === 'people') return A.apart && A.people !== 'hidden';
  // The rooms keep the stage, and the workspace and the board stand beside it.
  if (id === 'ws' || id === 'board') return (A.apart || f.rooms) && f[id] && (!A.tabs || A.front === id);
  return A.apart && f.shown.includes(id) && !f.zen && (!A.tabs || A.front === id);
}
const nodeShown = (n: CallPanelNode, f: PanelFacts, A: Adapted): boolean => (isBranch(n) ? n.kids.some((k) => nodeShown(k, f, A)) : leafShown(n.id, f, A));

/** The least a leaf can do with across. Anything dragged wider gives that back first (`shareOut`). */
function minOf(n: CallPanelLeaf, A: Adapted, inCol: boolean): number {
  if (n.id === 'stage') return STAGE_MIN;
  if (n.id === 'ws') return A.list ? 760 : 400;
  if (n.id === 'board') return 400;
  if (isShareLeaf(n.id)) return A.list ? 420 : 340;
  return A.people === 'arches' ? ARCH_W : inCol ? 120 : Math.min(n.px ?? 204, 204);
}
function need(n: CallPanelNode, f: PanelFacts, A: Adapted, inCol: boolean): number {
  if (!isBranch(n)) return leafShown(n.id, f, A) ? minOf(n, A, inCol) : 0;
  const ks = n.kids.map((k) => need(k, f, A, n.dir === 'col')).filter((v) => v > 0);
  if (!ks.length) return 0;
  return n.dir === 'row' ? ks.reduce((s, v) => s + v, 0) + GAP * (ks.length - 1) : Math.max(...ks);
}

/**
 * The order things give way as the room runs out, always the same: tiles fold to arches, the list tucks away, then the
 * workspace, the board and the shares take turns. On a phone it's one thing at a time.
 */
export function adapt(a: CallPanels, size: Size, f: PanelFacts): Adapted {
  const open = mains(f);
  const apart = !f.rooms && (f.ws || f.board || (!f.phone && f.shown.length > 0 && (a.apart || a.people !== 'tiles')));
  const front = f.front && open.includes(f.front) ? f.front : open[0] ?? null;
  if (f.phone) return { apart, people: 'arches', list: false, tabs: open.length > 1, front, gave: ['phone'], phone: true };
  const A: Adapted = { apart, people: !apart ? 'tiles' : f.zen ? 'hidden' : a.people, list: a.list && f.ws && !f.zen, tabs: false, front, gave: [], phone: false };
  /*
   * A share shown beside the workspace or the board: the people fold to arches and the list tucks away, so both stay
   * readable. Nothing of yours changes, so they're back as they were once the share goes back to a tile.
   */
  if (apart && !f.zen && f.shown.length > 0 && (f.ws || f.board)) {
    if (A.people === 'tiles') { A.people = 'arches'; A.gave.push('people'); }
    if (A.list) { A.list = false; A.gave.push('list'); }
  }
  const fits = () => need(a.tree, f, A, false) <= size.w;
  if (!fits() && A.people === 'tiles' && apart) { A.people = 'arches'; A.gave.push('people'); }
  if (!fits() && A.list) { A.list = false; A.gave.push('list'); }
  if (!fits() && open.length > 1) { A.tabs = true; A.gave.push('tabs'); }
  return A;
}

/* ---------- turning the tree into rectangles ---------- */

/** The least a line can drag a panel down to, across or (`row` false) high. The people can go all the way: they fold. */
const dragMin = (k: CallPanelNode, row: boolean) => {
  if (!isBranch(k) && k.id === 'people') return 34;
  if (!row) return 140;
  return !isBranch(k) && k.id === 'stage' ? STAGE_MIN : !isBranch(k) && (k.id === 'ws' || k.id === 'board') ? 340 : 260;
};

/**
 * A line between two panels. `path` finds their branch in the tree and `ia` and `ib` the two in it; `pa` and `pb` find what
 * sizes them, which is deeper down when a branch shows only one thing. `others`: whatever else in the branch takes a share
 * of the room, what it weighs and how much it has.
 */
export interface Divider { key: string; path: number[]; ia: number; ib: number; pa: number[]; pb: number[]; dir: 'row' | 'col'; sa: number; sb: number; rect: Box; a: Leaf; b: Leaf; others: { flex: number; size: number } | null }
export interface Solved {
  A: Adapted;
  /** Where each panel showing goes, in the call's area. */
  rects: Partial<Record<Leaf, Box>>;
  dividers: Divider[];
  gave: Gave[];
  /** The area the panels share: all of it, less the room kept for the status bar and captions once the stage has come apart. */
  box: Box;
}

const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

/**
 * Fits sizes into `total`: nothing under its floor if that can be helped, the difference taken from whatever has room to
 * give in proportion to it, and if nothing does, everything gives alike, so a panel can never run off the screen.
 */
function shareOut(sizes: number[], floors: number[], total: number): number[] {
  let out = sizes.map((s, i) => Math.max(s, floors[i] ?? 0));
  const over = sum(out) - total;
  if (over <= 0.01) return out;
  const spare = sum(out.map((s, i) => s - (floors[i] ?? 0)));
  if (spare > 0) { const k = Math.min(1, over / spare); out = out.map((s, i) => s - (s - (floors[i] ?? 0)) * k); }
  const left = sum(out);
  return left > total + 0.01 ? out.map((s) => (s * total) / left) : out;
}

const whole = (r: Box): Box => { const x = Math.round(r.x); const y = Math.round(r.y); return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y }; };

function solvePhone(size: Size, f: PanelFacts, A: Adapted): Solved {
  const box: Box = { x: 0, y: 0, w: size.w, h: size.h };
  const rects: Solved['rects'] = {};
  // With the workspace or the board open the people are a row of arches over one thing at a time, under the status bar while
  // it says anything (`f.top`), as a wider screen's panels are.
  const bar = A.apart ? f.top : 0;
  const top = A.apart ? bar + (A.tabs ? 116 : 78) : 0;
  const body: Box = { x: 0, y: top, w: size.w, h: Math.max(0, size.h - top) };
  if (A.apart) {
    rects.people = { x: 8, y: bar + 4, w: size.w - 16, h: 64 };
    for (const id of mains(f)) if (!A.tabs || id === A.front) rects[id] = body;
  } else {
    rects.stage = box;
    // The rooms keep the stage, and what's open goes over it until it's closed: one thing at a time.
    if (f.rooms) for (const id of mains(f)) rects[id] = box;
  }
  return { A, rects, dividers: [], gave: A.gave, box };
}

export function solve(a: CallPanels, size: Size, f: PanelFacts): Solved {
  const A = adapt(a, size, f);
  if (A.phone) return solvePhone(size, f, A);
  const room: Box = f.zen ?? { x: 0, y: 0, w: size.w, h: size.h };
  const box: Box = A.apart ? { ...room, y: room.y + f.top, h: Math.max(0, room.h - f.top - f.bottom) } : room;
  const rects: Solved['rects'] = {};
  const dividers: Divider[] = [];
  const tw = tileWidth(size.w);
  /** A branch showing one thing is as big as that thing, wherever it's kept. */
  const sizedBy = (k: CallPanelNode, path: number[]): { node: CallPanelNode; path: number[] } => {
    if (!isBranch(k)) return { node: k, path };
    const shown = k.kids.flatMap((x, i) => (nodeShown(x, f, A) ? [{ x, i }] : []));
    const [one] = shown;
    return one && shown.length === 1 ? sizedBy(one.x, [...path, one.i]) : { node: k, path };
  };
  const pxOf = (k: CallPanelNode, row: boolean): number | null => {
    if (isBranch(k)) return null;
    if (k.id === 'people') return row ? (A.people === 'arches' ? ARCH_W : k.px ?? tw) : (A.people === 'arches' ? ARCH_STRIP : k.pxh ?? TILE_STRIP);
    return (row ? k.px : k.pxh) ?? null;
  };
  /** The size a panel won't be squeezed under in this row or column: never more than a line can drag it down to, so a line keeps up with the pointer. */
  const floorOf = (k: CallPanelNode, row: boolean): number => {
    return !isBranch(k) && k.id === 'people' ? Math.min(pxOf(k, row) ?? 0, row ? minOf(k, A, false) : 140) : dragMin(k, row);
  };
  const firstShown = (n: CallPanelNode): Leaf => { if (!isBranch(n)) return n.id; const k = n.kids.find((x) => nodeShown(x, f, A)); return k ? firstShown(k) : 'stage'; };
  const walk = (n: CallPanelNode, r: Box, path: number[]) => {
    if (!isBranch(n)) { rects[n.id] = whole(r); return; }
    const ks = n.kids.flatMap((k, i) => (nodeShown(k, f, A) ? [{ k, i }] : []));
    const [only] = ks;
    if (!only) return;
    if (ks.length === 1) { walk(only.k, r, [...path, only.i]); return; }
    const row = n.dir === 'row';
    const total = (row ? r.w : r.h) - GAP * (ks.length - 1);
    const by = ks.map(({ k, i }) => sizedBy(k, [...path, i]));
    const px = by.map((b) => pxOf(b.node, row));
    const hasFlex = px.includes(null);
    const weight = (j: number, k: CallPanelNode) => px[j] ?? k.flex ?? 1;
    const fixed = hasFlex ? sum(px.flatMap((p) => (p === null ? [] : [p]))) : 0;
    const flex = sum(ks.flatMap(({ k }, j) => (hasFlex && px[j] !== null ? [] : [weight(j, k)])));
    const rem = Math.max(0, total - fixed);
    const sizes = shareOut(ks.map(({ k }, j) => { const p = px[j] ?? null; return p !== null && hasFlex ? p : (rem * weight(j, k)) / flex; }), by.map((b) => floorOf(b.node, row)), total);
    let pos = row ? r.x : r.y;
    ks.forEach(({ k, i }, j) => {
      const s = sizes[j] ?? 0;
      walk(k, row ? { x: pos, y: r.y, w: s, h: r.h } : { x: r.x, y: pos, w: r.w, h: s }, [...path, i]);
      pos += s;
      const next = ks[j + 1];
      if (!next) return;
      const rest = ks.flatMap((x, m) => (px[m] === null && m !== j && m !== j + 1 ? [{ flex: weight(m, x.k), size: sizes[m] ?? 0 }] : []));
      const a = firstShown(k);
      const b = firstShown(next.k);
      // People folded for want of room have no room to give: a line beside them would only pretend.
      if (!(A.gave.includes('people') && (a === 'people' || b === 'people'))) {
        dividers.push({
          key: `${a}|${b}`, path, ia: i, ib: next.i, pa: by[j]?.path ?? [], pb: by[j + 1]?.path ?? [], dir: n.dir, sa: s, sb: sizes[j + 1] ?? 0,
          rect: whole(row ? { x: pos, y: r.y, w: GAP, h: r.h } : { x: r.x, y: pos, w: r.w, h: GAP }), a, b,
          others: rest.length ? { flex: sum(rest.map((o) => o.flex)), size: sum(rest.map((o) => o.size)) } : null
        });
      }
      pos += GAP;
    });
  };
  walk(a.tree, box, []);
  // However the panels were arranged, a narrow document gives up its list before its words.
  if (rects.ws && rects.ws.w < 620 && A.list) { A.list = false; if (!A.gave.includes('list')) A.gave.push('list'); }
  return { A, rects, dividers, gave: A.gave, box };
}

/** Where the stage and what's on it are: what's said over the call goes here. */
export function mainRoom(s: Solved): Box {
  const boxes = (['stage', 'people', 'ws', 'board', 'share:1', 'share:2'] as const).flatMap((k) => { const r = s.rects[k]; return r ? [r] : []; });
  if (!boxes.length) return s.box;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** The room for just the document, in the call's area: the bars have tucked away, so it reaches past it. */
export const zenRoom = (size: Size, h: Horizon): Box => ({
  x: ZEN_EDGE - h.left, y: ZEN_EDGE - h.top, w: size.w + 2 * (h.left - ZEN_EDGE), h: h.base + 10 - ZEN_DOCK + h.top - ZEN_EDGE
});

/* ---------- changing the arrangement ---------- */

interface Found { parent: CallPanelBranch; i: number; node: CallPanelNode }
function find(n: CallPanelNode, id: Leaf): Found | null {
  if (!isBranch(n)) return null;
  for (const [i, k] of n.kids.entries()) {
    if (!isBranch(k) && k.id === id) return { parent: n, i, node: k };
    const deep = find(k, id);
    if (deep) return deep;
  }
  return null;
}
function parentOfBranch(n: CallPanelNode, b: CallPanelBranch): Found | null {
  if (!isBranch(n)) return null;
  for (const [i, k] of n.kids.entries()) {
    if (k === b) return { parent: n, i, node: k };
    const deep = parentOfBranch(k, b);
    if (deep) return deep;
  }
  return null;
}
/** Where `id` sits. For the stage, that's the branch it leads, with everything it would hold. */
function anchor(root: CallPanelNode, id: Leaf): Found | null {
  const at = find(root, id);
  if (!at || id !== 'stage') return at;
  return parentOfBranch(root, at.parent) ?? at;
}
/** No branch with one thing in it, or nothing, after something left it. */
function tidy(n: CallPanelNode): CallPanelNode | null {
  if (!isBranch(n)) return n;
  const kids = n.kids.flatMap((k) => { const t = tidy(k); return t ? [t] : []; });
  const [only] = kids;
  if (!only) return null;
  if (kids.length > 1) return { ...n, kids };
  return n.flex === undefined ? only : { ...only, flex: n.flex };
}
const tidied = (n: CallPanelNode) => tidy(n) ?? n;
const has = (n: CallPanelNode, id: Leaf) => leavesOf(n).includes(id);
/** Swaps two panels: each takes the other's place, at the size of that place. */
function swapped(root: CallPanelNode, a: Leaf, b: Leaf): void {
  const wide = anchor(root, a);
  const other = anchor(root, b);
  // A panel inside the stage's branch swaps with the stage alone.
  const pa = wide && has(wide.node, b) ? find(root, a) : wide;
  const pb = other && has(other.node, a) ? find(root, b) : other;
  if (!pa || !pb) return;
  const place = (n: CallPanelNode) => ({ flex: n.flex, px: n.px, pxh: n.pxh });
  const [ka, kb] = [place(pa.node), place(pb.node)];
  pa.parent.kids[pa.i] = { ...pb.node, ...ka };
  pb.parent.kids[pb.i] = { ...pa.node, ...kb };
}

/** Swaps two panels, for you: each takes the other's place, at the size of that place. */
export function swapLeaves(a: CallPanels, x: Leaf, y: Leaf): CallPanels {
  if (x === y) return a;
  const tree = structuredClone(a.tree);
  swapped(tree, x, y);
  return { ...a, tree: tidied(tree) };
}

const atPath = (root: CallPanelNode, path: number[]): CallPanelNode | null => {
  let n: CallPanelNode | undefined = root;
  for (const i of path) n = n && isBranch(n) ? n.kids[i] : undefined;
  return n ?? null;
};
/** Both sides of a line in a copy of the tree: as they sit in their branch, and what sizes them. */
function sidesOf(a: CallPanels, d: Divider) {
  const tree = structuredClone(a.tree);
  const parent = atPath(tree, d.path);
  const ka = parent && isBranch(parent) ? parent.kids[d.ia] : undefined;
  const kb = parent && isBranch(parent) ? parent.kids[d.ib] : undefined;
  const sa = atPath(tree, d.pa);
  const sb = atPath(tree, d.pb);
  return ka && kb && sa && sb ? { tree, ka, kb, sa, sb, people: !isBranch(sa) && sa.id === 'people' ? sa : !isBranch(sb) && sb.id === 'people' ? sb : null } : null;
}
/** A size as the arrangement can keep it: anything else wouldn't read back through its schema, and the arrangement would be lost. */
const keepable = (v: number) => (v > 0 ? Math.min(v, CALL_PANEL_SIZE_MAX) : 1);
/**
 * Beside a panel that holds its size, one that takes a share of what's left would share any change with whatever else
 * does, and the line wouldn't keep up. It's weighed to end up at `size`, and they stay as they are.
 */
function weigh(k: CallPanelNode, size: number, d: Divider) {
  if (d.others && d.others.size > 0) k.flex = keepable((d.others.flex * size) / d.others.size);
}
/** Whether a panel holds its size in pixels along this line, or takes a share of what's left. */
const heldSize = (k: CallPanelNode, row: boolean) => !isBranch(k) && (k.id === 'people' || (row ? k.px : k.pxh) !== undefined);

/**
 * Moves the line `d` by `delta` pixels from where it was when `d` was solved, so a drag follows the pointer exactly. It
 * snaps at half. The people fold as their line closes in: to arches, then away.
 */
export function dragDivider(a: CallPanels, d: Divider, delta: number): CallPanels {
  const s = sidesOf(a, d);
  if (!s) return a;
  const { tree, ka, kb, people } = s;
  const row = d.dir === 'row';
  const key = row ? 'px' : 'pxh';
  const tot = d.sa + d.sb;
  let na = Math.max(Math.min(dragMin(s.sa, row), tot / 2), Math.min(tot - Math.min(dragMin(s.sb, row), tot / 2), d.sa + delta));
  if (!people && Math.abs(tot - 2 * na) < 16) na = tot / 2;
  const nb = tot - na;
  if (people) {
    const size = people === s.sa ? na : nb;
    if (size < 52) return { ...a, tree, people: 'hidden' };
    if (size < (row ? 120 : 100)) { delete people[key]; return { ...a, tree, people: 'arches' }; }
    people[key] = keepable(size);
    // A panel beside them that holds its size gives or takes what they do, so nothing else in the row moves.
    const other = people === s.sa ? s.sb : s.sa;
    if (heldSize(other, row)) other[key] = keepable(tot - size);
    else weigh(people === s.sa ? kb : ka, tot - size, d);
    return { ...a, tree, people: 'tiles' };
  }
  const fa = heldSize(s.sa, row);
  const fb = heldSize(s.sb, row);
  if (fa) s.sa[key] = keepable(na);
  if (fb) s.sb[key] = keepable(nb);
  if (!fa && !fb) { const f = (ka.flex ?? 1) + (kb.flex ?? 1); ka.flex = keepable((f * na) / tot); kb.flex = keepable((f * nb) / tot); }
  else if (fa !== fb) weigh(fa ? kb : ka, fa ? nb : na, d);
  return { ...a, tree };
}
/** Evens the two panels either side of a line; beside the people, it puts them both back to the width they start at. */
export function evenDivider(a: CallPanels, d: Divider): CallPanels {
  const s = sidesOf(a, d);
  if (!s) return a;
  const { tree, ka, kb, people } = s;
  const row = d.dir === 'row';
  const key = row ? 'px' : 'pxh';
  if (people) {
    const other = people === s.sa ? s.sb : s.sa;
    delete people[key];
    if (heldSize(other, row)) delete other[key];
    return { ...a, tree, people: 'tiles' };
  }
  const half = keepable((d.sa + d.sb) / 2);
  const fa = heldSize(s.sa, row);
  const fb = heldSize(s.sb, row);
  if (fa) s.sa[key] = half;
  if (fb) s.sb[key] = half;
  if (!fa && !fb) { const f = keepable(((ka.flex ?? 1) + (kb.flex ?? 1)) / 2); ka.flex = f; kb.flex = f; }
  else if (fa !== fb) weigh(fa ? kb : ka, half, d);
  return { ...a, tree };
}

/** Back to the call's own arrangement. */
export const reset = (): CallPanels => ({ ...DEFAULT_PANELS, tree: callsOwn() });
export const setPeople = (a: CallPanels, people: PeopleMode): CallPanels => ({ ...a, people });
export const setList = (a: CallPanels, list: boolean): CallPanels => ({ ...a, list });

/** Gives a shown share more of the room beside the workspace or the board, or back. */
export function growShare(a: CallPanels, id: ShareLeaf): CallPanels {
  const tree = structuredClone(a.tree);
  const at = find(tree, id);
  const work = find(tree, 'ws') ?? find(tree, 'board');
  if (!at || !work) return a;
  const inCol = at.parent.dir === 'col' && at.parent !== tree ? parentOfBranch(tree, at.parent)?.node : undefined;
  const host = inCol ?? at.node;
  const big = (host.flex ?? 1) > (work.node.flex ?? 1) * 1.4;
  host.flex = big ? 1.05 : 2.4;
  work.node.flex = big ? 1.35 : 1;
  return { ...a, tree };
}

/* ---------- the people ---------- */

export interface TileItem { id: string; share: boolean }
export type TileMode = 'tile' | 'arch' | 'horizon';
export interface TileSpot { box: Box; mode: TileMode }
export interface PeoplePlaced {
  spots: Map<string, TileSpot>;
  /** Who there's no room for: kept in place, out of sight, so nothing remounts. */
  off: Set<string>;
  /** Stands in for them: how many there are, and where it goes. */
  more: (TileSpot & { n: number }) | null;
}
export interface Horizon {
  /** Where the dock starts and ends, in the call's area: the horizon stops short of it. */
  dock: number;
  dockEnd: number;
  /** The ground they stand on. */
  base: number;
  /** How far the call's area is from the top and the left of the window. */
  top: number;
  left: number;
}
const TILE_GAP = 10;
/** The smallest a tile gets before the rest wait behind a count. */
const TILE_MIN = { w: 88, h: 48 };

/** The first `n`, with anyone in `loud` (talking, or with a hand up) taking the place of the last who isn't. */
function keepLoud(items: TileItem[], n: number, loud: ReadonlySet<string>): TileItem[] {
  const kept = items.slice(0, n);
  for (const it of items.slice(n)) {
    if (!loud.has(it.id)) continue;
    const at = kept.findLastIndex((k) => !loud.has(k.id));
    if (at < 0) break;
    kept[at] = it;
  }
  return kept;
}
function result(items: TileItem[], kept: TileItem[], at: (it: TileItem, i: number) => TileSpot, chip: TileSpot | null, nowhere?: TileSpot): PeoplePlaced {
  const spots = new Map(kept.map((it, i) => [it.id, at(it, i)]));
  const off = new Set(items.filter((it) => !spots.has(it.id)).map((it) => it.id));
  const [first] = kept;
  const under = chip ?? (first ? at(first, 0) : nowhere);
  if (under) for (const id of off) spots.set(id, under);
  return { spots, off, more: chip && off.size ? { ...chip, n: off.size } : null };
}

/** On the horizon: small arches stand in the empty space beside the dock, and whoever's talking rises (Stage.tsx). */
function onHorizon(items: TileItem[], h: Horizon, loud: ReadonlySet<string>): PeoplePlaced {
  const size = (it: TileItem) => (it.share ? { w: 54, h: 34 } : { w: 34, h: 38 });
  const room = h.dock - 8;
  /** Where a row of them ends. */
  const end = (list: TileItem[]) => 2 + sum(list.map((it) => size(it).w + 6)) - 6;
  let n = items.length;
  while (n > 1 && end(items.slice(0, n)) + (n < items.length ? 40 : 0) > room) n--;
  const kept = keepLoud(items, n, loud);
  // With room for one, it's whoever's talking, with nothing else beside them. With none, nobody: the dock comes first.
  while (kept.length && end(kept) > room) kept.pop();
  let x = 2;
  const xs = kept.map((it) => { const at = x; x += size(it).w + 6; return at; });
  const chip: TileSpot | null = kept.length < items.length && x + 34 <= room ? { box: { x, y: h.base - 38, w: 34, h: 38 }, mode: 'horizon' } : null;
  return result(items, kept, (it, i) => { const s = size(it); return { box: { x: xs[i] ?? 0, y: h.base - s.h, w: s.w, h: s.h }, mode: 'horizon' }; }, chip, { box: { x: 2, y: h.base - 38, w: 34, h: 38 }, mode: 'horizon' });
}

function inArches(r: Box, items: TileItem[], loud: ReadonlySet<string>, small: boolean): PeoplePlaced {
  const [aw, ah] = small ? [58, 64] : [74, 82];
  const tall = r.h >= r.w;
  const space = tall ? r.h : r.w;
  const size = tall ? ah : aw;
  const pitch = small ? 70 : tall ? 92 : 84;
  // Arches never overlap: as many as fit, then the count. With room for one, it's whoever's talking.
  const fit = Math.max(1, Math.floor((space + pitch - size) / pitch));
  const n = items.length > fit ? Math.max(1, fit - 1) : items.length;
  const at = (i: number): Box => ({ x: tall ? r.x + (r.w - aw) / 2 : r.x + i * pitch, y: tall ? r.y + i * pitch : r.y + (r.h - ah) / 2, w: aw, h: ah });
  return result(items, keepLoud(items, n, loud), (_, i) => ({ box: at(i), mode: 'arch' }), n < items.length && fit > 1 ? { box: at(n), mode: 'arch' } : null);
}

function inTiles(r: Box, items: TileItem[], loud: ReadonlySet<string>): PeoplePlaced {
  const cap = Math.max(1, Math.floor((r.w + TILE_GAP) / (TILE_MIN.w + TILE_GAP)) * Math.floor((r.h + TILE_GAP) / (TILE_MIN.h + TILE_GAP)));
  const over = items.length > cap;
  const kept = keepLoud(items, over ? Math.max(1, cap - 1) : items.length, loud);
  const chip = over && cap > 1;
  const n = kept.length + (chip ? 1 : 0);
  let best: { c: number; rows: number; w: number; h: number; area: number } | null = null;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const w1 = (r.w - TILE_GAP * (c - 1)) / c;
    const h1 = (r.h - TILE_GAP * (rows - 1)) / rows;
    const s = Math.min(w1, h1 * 1.6);
    const area = s * (s / 1.6);
    if (!best || area > best.area) best = { c, rows, w: w1, h: h1, area };
  }
  if (!best) return { spots: new Map(), off: new Set(), more: null };
  const { c, rows } = best;
  const th = Math.min(best.h, best.w * 0.68);
  const tw = Math.min(best.w, th * 1.9);
  const at = (i: number): Box => {
    const row = Math.floor(i / c);
    const inRow = row === rows - 1 ? n - row * c : c;
    return { x: r.x + (r.w - (inRow * tw + (inRow - 1) * TILE_GAP)) / 2 + (i % c) * (tw + TILE_GAP), y: r.y + row * (th + TILE_GAP), w: tw, h: th };
  };
  return result(items, kept, (_, i) => ({ box: at(i), mode: 'tile' }), chip ? { box: at(kept.length), mode: 'tile' } : null);
}

/**
 * Where the people go once they're a panel of their own: tiles, arches in a column or a strip, or on the horizon when
 * they have no panel. `small` is the row of arches on a phone. Whoever's talking or has a hand up (`loud`) always has a
 * place, however many are here.
 */
export function placePeople(r: Box | null, items: TileItem[], mode: PeopleMode, h: Horizon, loud: ReadonlySet<string>, small = false): PeoplePlaced {
  if (!items.length) return { spots: new Map(), off: new Set(), more: null };
  if (mode === 'hidden' || !r) return onHorizon(items, h, loud);
  return mode === 'arches' || r.w <= 112 || r.h <= 100 ? inArches(r, items, loud, small) : inTiles(r, items, loud);
}

/** Gives each share shown big a seat: the one it has, or the first free. Seats that are free stay where they are in the tree. */
export function seatShares(seated: ReadonlyMap<string, ShareLeaf>, shown: string[]): Map<string, ShareLeaf> {
  const out = new Map(shown.flatMap((id): [string, ShareLeaf][] => { const s = seated.get(id); return s ? [[id, s]] : []; }));
  for (const id of shown) {
    if (out.has(id)) continue;
    const free = SHARE_SEATS.find((s) => ![...out.values()].includes(s));
    if (free) out.set(id, free);
  }
  return out;
}
