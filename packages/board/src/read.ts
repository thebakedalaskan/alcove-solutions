/*
 * Reading a board. Everything in the doc came from other people's browsers, so it's `unknown` until it
 * parses, and one bad object mustn't take a board down for everyone: what doesn't parse is left out. What
 * comes back holds together for the code that draws it: `f` names a frame on the board or nothing, frames
 * nest without going round in circles, and every line's attached ends are there to attach to.
 *
 * Two limits are exceptions to leaving out, because two people can pass them together and no write can stop that:
 * a sticky mustn't vanish over its text, nor a table over its rows. So a read keeps the object and cuts what's past
 * the limit, and the doc stays whole: nothing is lost, and editing a merged sticky still shows all of it.
 */
import * as Y from 'yjs';
import { BOARD_COMMENTS, BOARD_LIMITS, BOARD_OBJECTS, BoardObjectSchema, TABLE_MAX, TableLinesSchema, cut, hasBox, isAttached, layerOf, type BoardObject, type BoardView, type FrameObject, type LineEnd, type TableLine } from './shape';

/** A root as a map, or null if this browser already opened it as something else, where `getMap` would throw. */
export function rootMap(doc: Y.Doc, name: string): Y.Map<unknown> | null {
  const root = doc.share.get(name);
  if (root !== undefined && root.constructor !== Y.AbstractType && !(root instanceof Y.Map)) return null;
  return doc.getMap<unknown>(name);
}

export const mapOf = (value: unknown): Y.Map<unknown> | null => (value instanceof Y.Map ? value : null);
const textOf = (value: unknown): string | undefined => (value instanceof Y.Text ? cut(value.toString()) : undefined);

/** Whether two plain values hold the same thing. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i] && !same(a[i], b[i])) return false;
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) || Array.isArray(b)) return false;
  const ours = Object.entries(a), theirs = new Map(Object.entries(b));
  return ours.length === theirs.size && ours.every(([key, value]) => theirs.has(key) && same(value, theirs.get(key)));
}

/** A row or column list as stored. Two people resizing one line can leave it twice, so the first one counts, then the first `TABLE_MAX`. */
function linesOf(value: unknown): unknown[] | undefined {
  if (!(value instanceof Y.Array)) return undefined;
  const seen = new Set<unknown>();
  return value.toArray().filter((line: unknown) => {
    const id = typeof line === 'object' && line !== null && 'id' in line ? line.id : line;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, TABLE_MAX);
}

/**
 * A table's written cells as plain values, or undefined if one isn't text. It reads what's stored rather than every row
 * and column, so an empty table costs nothing, and in key order, so every browser reads the same thing. A cell only
 * counts if its row and column are on the table; one left behind by a row someone removed isn't read.
 */
function cellsOf(stored: Y.Map<unknown>, rows: readonly TableLine[], cols: readonly TableLine[]): Record<string, string> | undefined {
  const rowIds = new Set(rows.map((row) => row.id)), colIds = new Set(cols.map((col) => col.id));
  const cells: Record<string, string> = {};
  for (const key of [...stored.keys()].sort()) {
    const [row = '', col = '', rest] = key.split(':');
    if (rest !== undefined || !rowIds.has(row) || !colIds.has(col)) continue;
    const text = textOf(stored.get(key));
    if (text === undefined) return undefined;
    if (text) cells[key] = text;
  }
  return cells;
}

/** A table's rows, columns and cells as plain values. */
function tableFields(m: Y.Map<unknown>): { rows?: unknown; cols?: unknown; cells?: unknown } {
  const rows = TableLinesSchema.safeParse(linesOf(m.get('rows')));
  const cols = TableLinesSchema.safeParse(linesOf(m.get('cols')));
  const stored = mapOf(m.get('cells'));
  if (!rows.success || !cols.success || !stored) return {};
  const cells = cellsOf(stored, rows.data, cols.data);
  return cells ? { rows: rows.data, cols: cols.data, cells } : {};
}

/** Everything an object holds as plain values, its text cut to fit. A `t` that isn't a Y.Text reads as missing, so it won't parse. */
function plainOf(id: string, m: Y.Map<unknown>): Record<string, unknown> {
  const fields = { ...Object.fromEntries(m.entries()), id, t: textOf(m.get('t')), title: textOf(m.get('title')) };
  return m.get('k') === 'table' ? { ...fields, rows: undefined, cols: undefined, cells: undefined, ...tableFields(m) } : fields;
}

function parseObject(id: string, m: Y.Map<unknown>): BoardObject | null {
  const parsed = BoardObjectSchema.safeParse(plainOf(id, m));
  return parsed.success ? parsed.data : null;
}

/**
 * Whether an object still holds what `was` was read from, which it nearly always does. A person dragging
 * re-reads the board every frame, so this keeps zod for what changed: the check has to be exact, though, so a
 * peer swapping a Y.Text for a string of the same words doesn't pass as unchanged.
 */
function unchanged(m: Y.Map<unknown>, was: BoardObject): boolean {
  if (was.k === 'table') {
    const stored = mapOf(m.get('cells'));
    if (!stored || !same(linesOf(m.get('rows')), was.rows) || !same(linesOf(m.get('cols')), was.cols) || !same(cellsOf(stored, was.rows, was.cols), was.cells)) return false;
  }
  for (const [key, value] of Object.entries<unknown>(was)) {
    if (key === 'id' || key === 'rows' || key === 'cols' || key === 'cells') continue;
    if (key === 't' || key === 'title' ? textOf(m.get(key)) !== value : !same(m.get(key), value)) return false;
  }
  return true;
}

/** Layer, then `at`, then id. Compared as code units: `localeCompare` could order two browsers differently. */
function byOrder(a: BoardObject, b: BoardObject): number {
  return layerOf(a.k) - layerOf(b.k) || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Frames whose `f` chain goes round in a circle, which two people nesting frames at once can really cause. */
function framesInCircles(frames: readonly FrameObject[]): Set<string> {
  const parents = new Map(frames.map((f) => [f.id, f.f]));
  const settled = new Set<string>(), circling = new Set<string>();
  for (const frame of frames) {
    const walked = new Set<string>();
    let at = frame.id;
    while (at && !settled.has(at) && !walked.has(at)) {
      walked.add(at);
      at = parents.get(at) ?? '';
    }
    if (walked.has(at)) {
      const path = [...walked];
      for (const id of path.slice(path.indexOf(at))) circling.add(id);
    }
    for (const id of walked) settled.add(id);
  }
  return circling;
}

/**
 * The board as it reads now, leaving out anything that doesn't parse. Pass the last view as `prev` and an
 * object that didn't change comes back as the same reference, and so does the view if nothing changed, which
 * is what lets a move re-render that object alone. Past `BOARD_LIMITS.objects` the same objects are left out
 * in every browser, because the order is the same in every browser.
 */
export function readBoard(doc: Y.Doc, prev?: BoardView): BoardView {
  const read: BoardObject[] = [];
  rootMap(doc, BOARD_OBJECTS)?.forEach((value, id) => {
    const m = mapOf(value);
    if (!m) return;
    const was = prev?.byId.get(id);
    const object = was && unchanged(m, was) ? was : parseObject(id, m);
    if (object) read.push(object);
  });
  const kept = read.sort(byOrder).slice(0, BOARD_LIMITS.objects);

  const allFrames = kept.filter((o) => o.k === 'frame');
  const frameIds = new Set(allFrames.map((f) => f.id));
  const circling = framesInCircles(allFrames);
  const placed = new Set(kept.filter(hasBox).map((o) => o.id));
  const joined = (end: LineEnd): boolean => !isAttached(end) || placed.has(end.on);

  const objects = kept.flatMap((o) => {
    if (o.k === 'line' && !(joined(o.from) && joined(o.to))) return [];
    const settled = (o.f && !frameIds.has(o.f)) || circling.has(o.id) ? { ...o, f: '' } : o;
    const was = prev?.byId.get(o.id);
    return [was && same(settled, was) ? was : settled];
  });
  if (prev && objects.length === prev.objects.length && objects.every((o, i) => o === prev.objects[i])) return prev;
  return { objects, byId: new Map(objects.map((o) => [o.id, o])), frames: objects.filter((o) => o.k === 'frame') };
}

/** Calls `onChange` after any change to what's on the board or its comments. Returns how to stop. */
export function observeBoard(doc: Y.Doc, onChange: () => void): () => void {
  const roots = [rootMap(doc, BOARD_OBJECTS), rootMap(doc, BOARD_COMMENTS)].flatMap((root) => (root ? [root] : []));
  const changed = (): void => onChange();
  for (const root of roots) root.observeDeep(changed);
  return () => {
    for (const root of roots) root.unobserveDeep(changed);
  };
}

/** The Y.Text behind one of an object's text fields, or a table's cell by its `cellKey`. Null if there isn't one. */
export function objectText(doc: Y.Doc, id: string, field = 't'): Y.Text | null {
  const object = mapOf(rootMap(doc, BOARD_OBJECTS)?.get(id));
  const own = object?.get(field);
  if (own instanceof Y.Text) return own;
  const cell = mapOf(object?.get('cells'))?.get(field);
  return cell instanceof Y.Text ? cell : null;
}
