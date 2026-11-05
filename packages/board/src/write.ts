/*
 * Every change to a board, each one a single `doc.transact` under the caller's origin, so even something as big
 * as Sort into themes is one undo. A write brings what it's given inside the limits, or refuses it, and checks
 * the result with the schema `readBoard` uses, so nothing written here is left out for anyone. Text people are
 * typing doesn't come through here: that's the object's Y.Text, from `objectText`, and the surface keeps it inside
 * the limit. Only two browsers merging can pass it, which is why `readBoard` cuts text rather than leaving it out.
 */
import * as Y from 'yjs';
import { bounds, centre, contains, frameAt } from './geometry';
import { mapOf, readBoard, rootMap, same } from './read';
import {
  BOARD_COMMENTS, BOARD_LIMITS, BOARD_OBJECTS, BOARD_REACH, BoardObjectSchema, LineEndSchema, TABLE_MAX, TableLineSchema, cellKey, cut, hasBox, isAttached, layerOf, newId,
  type BoardObject, type BoardView, type Box, type FrameObject, type InkColour, type LineEnd, type LineStyle, type NewObject, type NoteObject, type PlacedObject, type ShapeKind, type StickyColour
} from './shape';

/** Where an object was let go. */
export interface Move {
  id: string;
  x: number;
  y: number;
}

/** A `setObjects` patch. Each object takes the fields it has and ignores the rest. */
export interface ObjectPatch {
  at?: number;
  c?: StickyColour | InkColour | '';
  size?: 's' | 'm' | 'l' | 'title' | 'heading' | 'body';
  s?: ShapeKind;
  role?: '' | 'actions';
  hint?: string;
  sub?: string;
  style?: LineStyle;
  from?: LineEnd;
  to?: LineEnd;
  tool?: 'pen' | 'marker';
  media?: string;
  item?: string;
  caption?: string;
  parent?: string;
}

export type TableAxis = 'rows' | 'cols';

const PATCHABLE = new Set(['at', 'c', 'size', 's', 'role', 'hint', 'sub', 'style', 'from', 'to', 'tool', 'media', 'item', 'caption', 'parent']);
const WORDS = new Set(['t', 'title', 'hint', 'sub', 'caption']);
const TIDY_GAP = 20;
/** Sorted stickies sit in columns of two, under a label: the canvas's numbers, from a frame's top left. */
const THEME = { across: 380, step: 164, x: 30, y: 92, sticky: 150, margin: 30, label: { x: 34, y: 34, w: 300, h: 30 } } as const;
const THEME_COLOURS: readonly StickyColour[] = ['butter', 'sky', 'rose', 'peach', 'lilac', 'mist'];
/** The gap between one piece of work and the next: the gutter between the canvas's frames. */
export const BESIDE = 40;

const between = (min: number, max: number, n: number): number => Math.min(max, Math.max(min, n));
const reach = (n: number): number => between(-BOARD_REACH, BOARD_REACH, n);
const side = (n: number): number => between(BOARD_LIMITS.minSide, BOARD_LIMITS.maxSide, n);

function limited(key: string, value: unknown): unknown {
  if (typeof value === 'number' && (key === 'x' || key === 'y')) return reach(value);
  if (typeof value === 'number' && (key === 'w' || key === 'h')) return side(value);
  if (typeof value === 'string' && WORDS.has(key)) return cut(value);
  if (key === 'pts' && Array.isArray(value)) return value.slice(0, Math.min(value.length - (value.length % 2), BOARD_LIMITS.points * 2));
  return value;
}

/** An object brought inside the limits, or null if it still isn't one `readBoard` would keep. */
function admit(fields: Record<string, unknown>): BoardObject | null {
  const parsed = BoardObjectSchema.safeParse(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, limited(key, value)])));
  return parsed.success ? parsed.data : null;
}

function put(objects: Y.Map<unknown>, o: BoardObject): void {
  const m = new Y.Map<unknown>();
  for (const [key, value] of Object.entries<unknown>(o)) {
    if (key === 'id' || key === 'rows' || key === 'cols' || key === 'cells') continue;
    m.set(key, (key === 't' || key === 'title') && typeof value === 'string' ? new Y.Text(value) : value);
  }
  if (o.k === 'table') {
    const cells = new Y.Map<Y.Text>();
    for (const row of o.rows) for (const col of o.cols) cells.set(cellKey(row.id, col.id), new Y.Text(o.cells[cellKey(row.id, col.id)] ?? ''));
    m.set('rows', Y.Array.from(o.rows));
    m.set('cols', Y.Array.from(o.cols));
    m.set('cells', cells);
  }
  objects.set(o.id, m);
}

/** Clamps, checks and writes one object. For the writers that work out its id, `at` and `f` themselves. */
export function insert(objects: Y.Map<unknown>, fields: Record<string, unknown>): BoardObject | null {
  const object = admit(fields);
  if (object) put(objects, object);
  return object;
}

/** The one way into a board: a transaction under the caller's origin, or `refused` if the doc holds no board. */
export function writing<T>(doc: Y.Doc, origin: unknown, refused: T, change: (objects: Y.Map<unknown>) => T): T {
  const objects = rootMap(doc, BOARD_OBJECTS);
  return objects ? doc.transact(() => change(objects), origin) : refused;
}

const lastRead = new WeakMap<Y.Doc, BoardView>();

/** The board now, from the last read of it, so that a drag's writes don't parse the whole board on every frame. */
export function viewOf(doc: Y.Doc): BoardView {
  const view = readBoard(doc, lastRead.get(doc));
  lastRead.set(doc, view);
  return view;
}

/** Hands out `at`s above everything in each layer. */
export function stack(view: BoardView): (k: BoardObject['k']) => number {
  const tops = new Map<number, number>();
  for (const o of view.objects) tops.set(layerOf(o.k), Math.max(tops.get(layerOf(o.k)) ?? 0, o.at));
  return (k) => {
    const next = (tops.get(layerOf(k)) ?? 0) + 1;
    tops.set(layerOf(k), next);
    return next;
  };
}

/** Where new work goes so it lands on nothing: carrying on the row to the right, or the origin of an empty board. */
export function clearSpot(view: BoardView): { x: number; y: number } {
  const placed = view.objects.filter(hasBox);
  if (!placed.length) return { x: 0, y: 0 };
  const b = bounds(placed);
  return { x: b.x + b.w + BESIDE, y: b.y };
}

const change = (m: Y.Map<unknown>, key: string, value: unknown): void => {
  if (!same(m.get(key), value)) m.set(key, value);
};

/** Whether an end of a line has something to hold on to. */
function joins(view: BoardView, end: LineEnd): boolean {
  if (!isAttached(end)) return true;
  const target = view.byId.get(end.on);
  return target !== undefined && hasBox(target);
}

/** The middle of an object, or of a line's free ends. A line attached at both ends is in no particular place. */
function spotOf(o: NewObject | BoardObject): { x: number; y: number } | null {
  if (o.k !== 'line') return centre(o);
  const free = [o.from, o.to].flatMap((end) => (isAttached(end) ? [] : [end]));
  const first = free[0];
  if (!first) return null;
  return { x: free.reduce((n, end) => n + end.x, 0) / free.length, y: free.reduce((n, end) => n + end.y, 0) / free.length };
}

/** Adds an object and returns its id, or null if the board is full or the object can't be on it. */
export function addObject(doc: Y.Doc, input: NewObject, origin: unknown): string | null {
  return writing<string | null>(doc, origin, null, (objects) => {
    if (objects.size >= BOARD_LIMITS.objects) return null;
    const view = viewOf(doc);
    if (input.k === 'line' && !(joins(view, input.from) && joins(view, input.to))) return null;
    const spot = spotOf(input);
    const f = input.f ?? (spot ? (frameAt(view, spot.x, spot.y)?.id ?? '') : '');
    return insert(objects, { ...input, id: newId(), at: stack(view)(input.k), f })?.id ?? null;
  });
}

/** What each frame directly holds. */
function heldBy(view: BoardView): Map<string, BoardObject[]> {
  const held = new Map<string, BoardObject[]>();
  for (const o of view.objects) {
    if (!o.f) continue;
    const list = held.get(o.f);
    if (list) list.push(o);
    else held.set(o.f, [o]);
  }
  return held;
}

/** Every object inside these, however deep. A loop, not recursion: a peer can nest frames as deep as the board allows. */
function within(held: ReadonlyMap<string, readonly BoardObject[]>, ids: Iterable<string>): Set<string> {
  const found = new Set<string>();
  const waiting = [...ids];
  for (let id = waiting.pop(); id !== undefined; id = waiting.pop()) {
    for (const o of held.get(id) ?? []) {
      if (found.has(o.id)) continue;
      found.add(o.id);
      waiting.push(o.id);
    }
  }
  return found;
}

/** Where a move starts from: an object's corner, or a line's first free end. A line attached at both ends can't move. */
function startOf(o: BoardObject | undefined): { x: number; y: number } | null {
  if (!o) return null;
  if (o.k !== 'line') return o;
  if (!isAttached(o.from)) return o.from;
  return isAttached(o.to) ? null : o.to;
}

/** The frame something lands in: the one it was carried in if it's still there, or else the one on top at its spot. */
function landing(o: BoardObject, spot: { x: number; y: number }, frames: readonly FrameObject[], carried: ReadonlySet<string>, inner: ReadonlySet<string>): string {
  const home = frames.find((f) => f.id === o.f);
  if (home && carried.has(home.id) && contains(home, spot.x, spot.y)) return home.id;
  return frames.findLast((f) => f.id !== o.id && !inner.has(f.id) && contains(f, spot.x, spot.y))?.id ?? '';
}

/** Moves objects, takes each frame's contents along, and settles `f` by where what was moved landed. */
function relocate(objects: Y.Map<unknown>, view: BoardView, moves: readonly Move[]): void {
  const wanted = new Map<string, { dx: number; dy: number }>();
  for (const { id, x, y } of moves) {
    const from = startOf(view.byId.get(id));
    if (from && Number.isFinite(x) && Number.isFinite(y)) wanted.set(id, { dx: reach(x) - from.x, dy: reach(y) - from.y });
  }

  const held = heldBy(view);
  const shifts = new Map(wanted);
  const waiting = [...wanted];
  for (let next = waiting.pop(); next; next = waiting.pop()) {
    const [id, shift] = next;
    for (const o of held.get(id) ?? []) {
      if (wanted.has(o.id) || shifts.has(o.id)) continue;
      shifts.set(o.id, shift);
      waiting.push([o.id, shift]);
    }
  }

  const shifted = (end: LineEnd, dx: number, dy: number): LineEnd => (isAttached(end) ? end : { x: reach(end.x + dx), y: reach(end.y + dy) });
  const moved = new Map<string, BoardObject>();
  for (const [id, { dx, dy }] of shifts) {
    const o = view.byId.get(id), m = mapOf(objects.get(id));
    if (!o || !m) continue;
    const next = o.k === 'line' ? { ...o, from: shifted(o.from, dx, dy), to: shifted(o.to, dx, dy) } : { ...o, x: reach(o.x + dx), y: reach(o.y + dy) };
    moved.set(id, next);
    if (next.k === 'line') {
      change(m, 'from', next.from);
      change(m, 'to', next.to);
    } else {
      change(m, 'x', next.x);
      change(m, 'y', next.y);
    }
  }

  const frames = view.frames.flatMap((f) => {
    const next = moved.get(f.id) ?? f;
    return next.k === 'frame' ? [next] : [];
  });
  const carried = new Set(shifts.keys());
  for (const id of wanted.keys()) {
    const o = moved.get(id), m = mapOf(objects.get(id)), spot = o ? spotOf(o) : null;
    if (o && m && spot) change(m, 'f', landing(o, spot, frames, carried, o.k === 'frame' ? within(held, [o.id]) : new Set()));
  }
}

/**
 * Moves objects to where they were let go. What a frame holds goes with it, and each object you moved ends up in
 * the frame it landed in, or none. A line's `x y` say where its first free end goes, and the other follows.
 */
export function moveObjects(doc: Y.Doc, moves: readonly Move[], origin: unknown): void {
  writing(doc, origin, undefined, (objects) => relocate(objects, viewOf(doc), moves));
}

/** Gives an object a new box, inside the limits. A stroke stretches with its box. */
export function resizeObject(doc: Y.Doc, id: string, box: Box, origin: unknown): void {
  writing(doc, origin, undefined, (objects) => {
    const o = viewOf(doc).byId.get(id), m = mapOf(objects.get(id));
    if (!o || !m || o.k === 'line' || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) return;
    const next = { x: reach(box.x), y: reach(box.y), w: side(box.w), h: side(box.h) };
    if (o.k === 'ink') change(m, 'pts', o.pts.map((n, i) => reach(n * (i % 2 ? next.h / o.h : next.w / o.w))));
    for (const [key, value] of Object.entries(next)) change(m, key, value);
  });
}

/** Changes fields on several objects at once. Each takes what applies to it, and refuses a value it can't hold. */
export function setObjects(doc: Y.Doc, ids: readonly string[], patch: ObjectPatch, origin: unknown): void {
  writing(doc, origin, undefined, (objects) => {
    const view = viewOf(doc);
    for (const id of ids) {
      const o = view.byId.get(id), m = mapOf(objects.get(id));
      if (!o || !m) continue;
      const changes = Object.fromEntries(Object.entries<unknown>({ ...patch }).filter(([key]) => PATCHABLE.has(key) && Object.hasOwn(o, key)));
      const next = admit({ ...o, ...changes });
      if (!next || (next.k === 'line' && !(joins(view, next.from) && joins(view, next.to)))) continue;
      for (const [key, value] of Object.entries<unknown>(next)) if (Object.hasOwn(changes, key)) change(m, key, value);
    }
  });
}

/** Hands out `at`s below everything in each layer. */
function beneath(view: BoardView): (k: BoardObject['k']) => number {
  const lows = new Map<number, number>();
  for (const o of view.objects) lows.set(layerOf(o.k), Math.min(lows.get(layerOf(o.k)) ?? o.at, o.at));
  return (k) => {
    const next = (lows.get(layerOf(k)) ?? 0) - 1;
    lows.set(layerOf(k), next);
    return next;
  };
}

/** Brings objects in front of everything else in their layer, or sends them behind it, keeping their order among themselves. */
export function stackObjects(doc: Y.Doc, ids: readonly string[], edge: 'front' | 'back', origin: unknown): void {
  writing(doc, origin, undefined, (objects) => {
    const view = viewOf(doc);
    const picked = new Set(ids);
    const list = view.objects.filter((o) => picked.has(o.id));
    const next = edge === 'front' ? stack(view) : beneath(view);
    for (const o of edge === 'front' ? list : list.reverse()) {
      const m = mapOf(objects.get(o.id));
      if (m) change(m, 'at', next(o.k));
    }
  });
}

function pointsAt(value: unknown, gone: ReadonlySet<string>): boolean {
  const end = LineEndSchema.safeParse(value);
  return end.success && isAttached(end.data) && gone.has(end.data.on);
}

/**
 * Removes objects, with the lines attached to them and the comments pinned to them. What was in a frame stays on
 * the board. Lines are found in the doc rather than the view, to reach one already left dangling by someone else.
 */
export function removeObjects(doc: Y.Doc, ids: readonly string[], origin: unknown): void {
  writing(doc, origin, undefined, (objects) => {
    const gone = new Set(ids.filter((id) => objects.has(id)));
    objects.forEach((value, id) => {
      const m = mapOf(value);
      if (m?.get('k') === 'line' && (pointsAt(m.get('from'), gone) || pointsAt(m.get('to'), gone))) gone.add(id);
    });
    for (const id of gone) objects.delete(id);

    const comments = rootMap(doc, BOARD_COMMENTS);
    const pinned: string[] = [];
    comments?.forEach((value, id) => {
      const on = mapOf(value)?.get('on');
      if (typeof on === 'string' && gone.has(on)) pinned.push(id);
    });
    for (const id of pinned) comments?.delete(id);
  });
}

/**
 * Copies objects, `by` away from where they are, and returns the copies of what was asked for, in that order. A
 * frame's contents come with it, and so do the lines joining what's copied, so a copy is joined up as the original
 * was. It's all or nothing at the limit: half a selection would be a surprise.
 */
export function duplicateObjects(doc: Y.Doc, ids: readonly string[], by: { x: number; y: number }, origin: unknown): string[] {
  return writing<string[]>(doc, origin, [], (objects) => {
    if (!Number.isFinite(by.x) || !Number.isFinite(by.y)) return [];
    const view = viewOf(doc);
    const asked = ids.filter((id) => view.byId.has(id));
    const picked = new Set([...asked, ...within(heldBy(view), asked)]);
    for (const o of view.objects) {
      const ends = o.k === 'line' ? [o.from, o.to].flatMap((end) => (isAttached(end) ? [end] : [])) : [];
      if (ends.length && ends.every((end) => picked.has(end.on))) picked.add(o.id);
    }
    const list = view.objects.filter((o) => picked.has(o.id));
    if (objects.size + list.length > BOARD_LIMITS.objects) return [];

    const copies = new Map(list.map((o) => [o.id, newId()]));
    const at = stack(view);
    const movedEnd = (end: LineEnd): LineEnd => (isAttached(end) ? { ...end, on: copies.get(end.on) ?? end.on } : { x: reach(end.x + by.x), y: reach(end.y + by.y) });
    for (const o of list) {
      const moved = o.k === 'line' ? { ...o, from: movedEnd(o.from), to: movedEnd(o.to) } : { ...o, x: reach(o.x + by.x), y: reach(o.y + by.y) };
      const spot = spotOf(moved);
      const f = copies.get(o.f) ?? (spot ? (frameAt(view, spot.x, spot.y)?.id ?? '') : '');
      const parent = o.k === 'node' ? { parent: copies.get(o.parent) ?? o.parent } : {};
      insert(objects, { ...moved, ...parent, id: copies.get(o.id), at: at(o.k), f });
    }
    return asked.flatMap((id) => {
      const copy = copies.get(id);
      return copy ? [copy] : [];
    });
  });
}

/** The objects named that a selection can arrange: anything with a box but a frame. */
function arrangeable(view: BoardView, ids: readonly string[]): PlacedObject[] {
  return [...new Set(ids)].flatMap((id) => {
    const o = view.byId.get(id);
    return o && hasBox(o) && o.k !== 'frame' ? [o] : [];
  });
}

/** Lines objects up in a square grid from their top left, in reading order. Grid cells fit the largest, so nothing overlaps. */
export function tidyObjects(doc: Y.Doc, ids: readonly string[], origin: unknown): void {
  writing(doc, origin, undefined, (objects) => {
    const view = viewOf(doc);
    const picked = arrangeable(view, ids);
    if (picked.length < 2) return;
    const b = bounds(picked), cols = Math.ceil(Math.sqrt(picked.length));
    const w = Math.max(...picked.map((o) => o.w)), h = Math.max(...picked.map((o) => o.h));
    const reading = [...picked].sort((p, q) => p.y - q.y || p.x - q.x);
    relocate(objects, view, reading.map((o, i) => ({ id: o.id, x: b.x + (i % cols) * (w + TIDY_GAP), y: b.y + Math.floor(i / cols) * (h + TIDY_GAP) })));
  });
}

/** A column for each theme with stickies left in it. The answer comes from a model, so it can repeat or invent ids. */
function themeColumns(view: BoardView, themes: readonly { name: string; ids: readonly string[] }[]): { name: string; notes: NoteObject[] }[] {
  const seen = new Set<string>();
  return themes.flatMap(({ name, ids }) => {
    const notes = ids.flatMap((id) => {
      const o = view.byId.get(id);
      if (o?.k !== 'note' || seen.has(id)) return [];
      seen.add(id);
      return [o];
    });
    return notes.length ? [{ name, notes }] : [];
  });
}

/**
 * Sorts stickies into named themes in one undo: a column of two for each theme, its stickies in the theme's colour,
 * with its name on top. Stickies sharing a frame stay in it, and it grows to fit them.
 */
export function applyThemes(doc: Y.Doc, themes: readonly { name: string; ids: readonly string[] }[], origin: unknown): void {
  writing(doc, origin, undefined, (objects) => {
    const before = viewOf(doc);
    const columns = themeColumns(before, themes);
    const all = columns.flatMap((column) => column.notes);
    const first = all[0];
    if (!first) return;

    const shared = before.frames.find((f) => f.id === first.f && all.every((o) => o.f === f.id));
    const base = shared ?? bounds(all);
    if (shared) {
      const m = mapOf(objects.get(shared.id));
      const tallest = Math.max(...columns.map((column) => Math.ceil(column.notes.length / 2)));
      const w = THEME.x + (columns.length - 1) * THEME.across + THEME.step + THEME.sticky + THEME.margin;
      const h = THEME.y + (tallest - 1) * THEME.step + THEME.sticky + THEME.margin;
      if (m) {
        change(m, 'w', side(Math.max(shared.w, w)));
        change(m, 'h', side(Math.max(shared.h, h)));
      }
    }

    const view = viewOf(doc);
    relocate(objects, view, columns.flatMap(({ notes }, col) => notes.map((o, i) => ({
      id: o.id, x: base.x + THEME.x + col * THEME.across + (i % 2) * THEME.step, y: base.y + THEME.y + Math.floor(i / 2) * THEME.step
    }))));
    columns.forEach(({ notes }, col) => {
      for (const o of notes) {
        const m = mapOf(objects.get(o.id));
        if (m) change(m, 'c', THEME_COLOURS[col % THEME_COLOURS.length]);
      }
    });

    const at = stack(view);
    let room = BOARD_LIMITS.objects - objects.size;
    columns.forEach(({ name }, col) => {
      if (room <= 0) return;
      room -= 1;
      const label = { x: base.x + THEME.label.x + col * THEME.across, y: base.y + THEME.label.y, w: THEME.label.w, h: THEME.label.h };
      const spot = centre(label);
      insert(objects, { k: 'text', ...label, size: 'heading', t: name, id: newId(), at: at('text'), f: frameAt(view, spot.x, spot.y)?.id ?? '' });
    });
  });
}

const replyOf = (text: string): { id: string; text: string; at: number } => ({ id: newId(), text: cut(text), at: Date.now() });

/** Starts a comment thread pinned to an object, and returns its id. */
export function addThread(doc: Y.Doc, on: string, text: string, origin: unknown): string {
  const id = newId();
  const comments = rootMap(doc, BOARD_COMMENTS);
  if (comments) {
    doc.transact(() => {
      const thread = new Y.Map<unknown>();
      thread.set('on', on);
      thread.set('replies', Y.Array.from([replyOf(text)]));
      comments.set(id, thread);
    }, origin);
  }
  return id;
}

/** Adds a reply to a thread, if it's still there. */
export function addReply(doc: Y.Doc, thread: string, text: string, origin: unknown): void {
  const replies = mapOf(rootMap(doc, BOARD_COMMENTS)?.get(thread))?.get('replies');
  if (replies instanceof Y.Array) doc.transact(() => replies.push([replyOf(text)]), origin);
}

function tableOf(objects: Y.Map<unknown>, id: string): { rows: Y.Array<unknown>; cols: Y.Array<unknown>; cells: Y.Map<unknown> } | null {
  const m = mapOf(objects.get(id));
  const rows = m?.get('rows'), cols = m?.get('cols'), cells = mapOf(m?.get('cells'));
  return m?.get('k') === 'table' && rows instanceof Y.Array && cols instanceof Y.Array && cells ? { rows, cols, cells } : null;
}

function lineIds(lines: Y.Array<unknown>): (string | null)[] {
  return lines.toArray().map((line) => {
    const parsed = TableLineSchema.safeParse(line);
    return parsed.success ? parsed.data.id : null;
  });
}

/** Adds a row or column at `index`, with its cells, and returns its id, or null past `TABLE_MAX`. */
export function addTableLine(doc: Y.Doc, id: string, axis: TableAxis, index: number, size: number, origin: unknown): string | null {
  return writing<string | null>(doc, origin, null, (objects) => {
    const table = tableOf(objects, id);
    if (!table || table[axis].length >= TABLE_MAX || !Number.isFinite(size) || !Number.isFinite(index)) return null;
    const line = newId();
    table[axis].insert(between(0, table[axis].length, Math.round(index)), [{ id: line, size: side(size) }]);
    for (const other of lineIds(table[axis === 'rows' ? 'cols' : 'rows'])) {
      if (other) table.cells.set(axis === 'rows' ? cellKey(line, other) : cellKey(other, line), new Y.Text());
    }
    return line;
  });
}

/**
 * Removes a row or column and its cells, in one transaction. A cell someone made at the same moment, in a column this
 * browser hasn't seen, stays in the map, but nothing reads it: a cell is only read through its row and its column.
 */
export function removeTableLine(doc: Y.Doc, id: string, axis: TableAxis, line: string, origin: unknown): void {
  writing(doc, origin, undefined, (objects) => {
    const table = tableOf(objects, id);
    if (!table) return;
    const ids = lineIds(table[axis]);
    for (let i = ids.length - 1; i >= 0; i -= 1) if (ids[i] === line) table[axis].delete(i);
    for (const key of [...table.cells.keys()]) {
      if (axis === 'rows' ? key.startsWith(`${line}:`) : key.endsWith(`:${line}`)) table.cells.delete(key);
    }
  });
}

/** Resizes a row or column. An entry in a Y.Array can't change, so it's replaced where it is. */
export function sizeTableLine(doc: Y.Doc, id: string, axis: TableAxis, line: string, size: number, origin: unknown): void {
  writing(doc, origin, undefined, (objects) => {
    const table = tableOf(objects, id);
    const index = table ? lineIds(table[axis]).indexOf(line) : -1;
    if (!table || index < 0 || !Number.isFinite(size)) return;
    table[axis].delete(index);
    table[axis].insert(index, [{ id: line, size: side(size) }]);
  });
}

/** A cell's Y.Text to type in. One row and one column added at the same moment leave a cell neither made: this makes it. */
export function tableCell(doc: Y.Doc, id: string, row: string, col: string, origin: unknown): Y.Text | null {
  return writing<Y.Text | null>(doc, origin, null, (objects) => {
    const table = tableOf(objects, id);
    if (!table || !lineIds(table.rows).includes(row) || !lineIds(table.cols).includes(col)) return null;
    const key = cellKey(row, col);
    const cell = table.cells.get(key);
    if (cell instanceof Y.Text) return cell;
    const made = new Y.Text();
    table.cells.set(key, made);
    return made;
  });
}

/**
 * Undo for one browser: both roots, with only its origin tracked, which is exactly "undo only ever takes back your
 * own changes". Changes within half a second of each other are one step, so a drag or a burst of typing undoes
 * together. Call `stopCapturing` between gestures that shouldn't.
 */
export function makeUndo(doc: Y.Doc, origin: unknown): Y.UndoManager {
  const roots = [rootMap(doc, BOARD_OBJECTS), rootMap(doc, BOARD_COMMENTS)].flatMap((root) => (root ? [root] : []));
  return new Y.UndoManager(roots, { doc, trackedOrigins: new Set([origin]) });
}
