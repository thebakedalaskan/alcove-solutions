/*
 * Undo for one browser, as a history of plain copies. Yjs's UndoManager is built for text: on objects several people edit at
 * once it restores or refuses item by item, which can leave a field with no value and an object gone for everyone. So this
 * keeps a plain copy of every object and thread, read again whenever anyone touches it. A change made under this browser's
 * origin records what it touched as the copy `before` and `after`, and undo walks that back by comparing plain values.
 *
 * That's what makes its promises hold, with nothing to work round. A field only goes back if it still holds what this browser
 * left there, so undo only ever takes back this browser's own changes. Something only goes if this browser made it and nobody
 * else has touched it, so nobody's work goes with it. No field is ever deleted, and what comes back is made the way `addObject`
 * makes it, so nothing is left that won't read. And an entry never spans someone else's change to that id, so `before` to
 * `after` is only ever this browser's doing, even with two people typing in one sticky at once.
 */
import * as Y from 'yjs';
import { isRecord, listOf, mapOf, recordOf, rootMap, same } from './read';
import { BOARD_COMMENTS, BOARD_OBJECTS } from './shape';
import { difference } from './text';
import { inLine, put, putThread, type TableAxis } from './write';

/** What became of an undo or redo: whether anything changed, or what went wrong, for the caller to log. */
export type StepResult = { ok: true; changed: boolean } | { ok: false; error: unknown };

export interface BoardHistory {
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): StepResult;
  redo(): StepResult;
  /** Everything until `end` is one step, however long it takes: a drag, or all that's typed in one go. */
  begin(): void;
  end(): void;
  /** Forgets the step in progress, leaving nothing to undo: a blank sticky left behind. */
  drop(): void;
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

/** An object or a thread as plain values. */
type Copy = Record<string, unknown>;

/** One of the doc's two roots, and what's known about it. */
interface Root {
  name: string;
  map: Y.Map<unknown>;
  /** How something on this root is made again. */
  make: (map: Y.Map<unknown>, id: string, fields: Copy) => void;
  copies: Map<string, Copy>;
  /**
   * How many times someone else has written to each id. A write that lost the merge counts: whoever made it still moved that
   * sticky. Under `id/part`, what that count was when someone else last brought back a row, column or cell.
   */
  others: Map<string, number>;
}

/** What one change did to one id. Null means it didn't exist. Undoing goes from `after` to `before`. */
interface Entry {
  root: Root;
  id: string;
  before: Copy | null;
  after: Copy | null;
  /** The root's `others` for this id when this was written, so going back can tell if anyone has written to it since. */
  others: number;
}

const wordsOf = (value: unknown): string => (typeof value === 'string' ? value : '');
const idOf = (value: unknown): unknown => recordOf(value)['id'];

/** An object or thread as plain values, or null if there isn't one. A cell with no words reads the same as no cell, so it's left out. */
function copyOf(value: unknown): Copy | null {
  const m = mapOf(value);
  if (!m) return null;
  const copy: Copy = m.toJSON();
  if (isRecord(copy['cells'])) copy['cells'] = Object.fromEntries(Object.entries(copy['cells']).filter(([, words]) => words !== ''));
  return copy;
}

/** A table's rows, columns and cells, each of which can come and go by itself. */
const partsOf = (copy: Copy | null): unknown[] => [...listOf(copy?.['rows']).map(idOf), ...listOf(copy?.['cols']).map(idOf), ...Object.keys(recordOf(copy?.['cells']))];

/** The ids a transaction touched on one root: the object an event is inside, or the keys of the root itself. */
function touched(events: readonly Y.YEvent<Y.AbstractType<unknown>>[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    const [id] = event.path;
    if (typeof id === 'string') ids.add(id);
    else if (event instanceof Y.YMapEvent) for (const key of event.keysChanged) if (typeof key === 'string') ids.add(key);
  }
  return ids;
}

/** What something names: a line's attached ends, or the object a thread is pinned to. */
function names(value: unknown): unknown[] {
  const m = mapOf(value);
  if (!m) return [];
  return m.get('k') === 'line' ? [m.get('from'), m.get('to')].map((end) => recordOf(end)['on']) : [m.get('on')];
}

/** Takes a Y.Text to these words by the smallest change, so carets stay where they are and whatever else is there is left alone. */
function rewrite(text: Y.Text, words: string): void {
  const { start, remove, insert } = difference(text.toString(), words, 0);
  if (remove) text.delete(start, remove);
  if (insert) text.insert(start, insert);
}

/** Each cell of a table is a field of its own. One that went with its row is made again, unless someone else has brought it back since. */
function cellsBack(cells: Y.Map<unknown>, before: Copy, after: Copy, now: Copy, spent: (part: unknown) => boolean): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = wordsOf(before[key]), left = wordsOf(after[key]);
    if (was === left || wordsOf(now[key]) !== left || spent(key)) continue;
    const cell = cells.get(key);
    if (cell instanceof Y.Text) rewrite(cell, was);
    else cells.set(key, new Y.Text(was));
  }
}

/**
 * Each row or column of a table, or reply in a thread, is a field of its own, so someone adding or removing another
 * doesn't stop this one going back. One this browser added goes, unless it's `kept`. One it resized goes back, if nobody has
 * resized it since. One it removed returns after the one it followed, unless it's back, or someone has brought it back since.
 */
function linesBack(lines: Y.Array<unknown>, before: readonly unknown[], after: readonly unknown[], kept: (id: unknown) => boolean, spent: (part: unknown) => boolean): void {
  const was = new Map(before.map((line) => [idOf(line), line])), left = new Map(after.map((line) => [idOf(line), line]));
  const live = lines.toArray();
  for (let at = live.length - 1; at >= 0; at -= 1) {
    const id = idOf(live[at]), mine = left.get(id), back = was.get(id);
    if (mine === undefined || same(back, mine) || !same(live[at], mine) || (back === undefined && kept(id))) continue;
    lines.delete(at);
    if (back !== undefined) lines.insert(at, [back]);
  }
  const ids = lines.toArray().map(idOf);
  let place = 0;
  for (const line of before) {
    const id = idOf(line), found = ids.indexOf(id);
    if (found >= 0) place = found + 1;
    else if (!left.has(id) && !spent(id)) {
      lines.insert(place, [line]);
      ids.splice(place, 0, id);
      place += 1;
    }
  }
}

/** Whether a row or column has a cell holding anything but what this browser left there, so it can't go. */
function written(id: unknown, axis: TableAxis, after: Copy, now: Copy): boolean {
  const left = recordOf(after['cells']);
  return typeof id === 'string' && Object.entries(recordOf(now['cells'])).some(([key, words]) => inLine(key, axis, id) && words !== left[key]);
}

/** Sets back what this browser changed in something, field by field. A field someone has changed since stays theirs, and none is ever deleted. */
function fieldsBack(m: Y.Map<unknown>, before: Copy, after: Copy, now: Copy, spent: (part: unknown) => boolean): void {
  for (const [key, was] of Object.entries(before)) {
    const left = after[key], live = m.get(key);
    if (same(was, left)) continue;
    if (live instanceof Y.Array) linesBack(live, listOf(was), listOf(left), (id) => written(id, key === 'rows' ? 'rows' : 'cols', after, now), spent);
    else if (live instanceof Y.Map) cellsBack(live, recordOf(was), recordOf(left), recordOf(now[key]), spent);
    else if (!same(now[key], left)) continue;
    else if (live instanceof Y.Text) rewrite(live, wordsOf(was));
    else m.set(key, was);
  }
}

/** Starts keeping the history of what this browser does under `origin`. */
export function makeHistory(doc: Y.Doc, origin: unknown): BoardHistory {
  const root = (name: string, make: Root['make']): Root[] => {
    const map = rootMap(doc, name);
    return map ? [{ name, map, make, copies: new Map(), others: new Map() }] : [];
  };
  const roots = [...root(BOARD_OBJECTS, put), ...root(BOARD_COMMENTS, putThread)];
  /** Going back is under its own origin, so it isn't recorded as a new step, and it stays this browser's rather than someone else's. */
  const applying = {};
  const undos: Entry[][] = [], redos: Entry[][] = [];
  const listeners = new Set<() => void>();
  /** What's been recorded for the step in progress, and the latest entry for each id in it. */
  let pending: Entry[] = [];
  const latest = new Map<string, Entry>();
  let open = false;

  const tell = (): void => {
    for (const listener of listeners) listener();
  };

  /** One id changed. Within a step that's one entry per id, keeping the first `before`, until someone else writes to it. */
  const record = (at: Root, id: string, before: Copy | null, after: Copy | null): void => {
    const others = at.others.get(id) ?? 0, key = `${at.name}:${id}`, entry = latest.get(key);
    if (entry?.others === others) {
      entry.after = after;
      return;
    }
    const next = { root: at, id, before, after, others };
    pending.push(next);
    latest.set(key, next);
  };

  /** What's been recorded, leaving out whatever came to nothing, like a sticky added and taken away again. */
  const take = (): Entry[] => {
    const step = pending.filter(({ before, after }) => !same(before, after));
    pending = [];
    latest.clear();
    return step;
  };

  const close = (): void => {
    const step = take();
    if (!step.length) return;
    undos.push(step);
    redos.length = 0;
  };

  const stops = roots.map((at) => {
    const seen = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction): void => {
      const mine = transaction.origin === origin || transaction.origin === applying;
      for (const id of touched(events)) {
        const before = at.copies.get(id) ?? null, after = copyOf(at.map.get(id));
        if (after) at.copies.set(id, after);
        else at.copies.delete(id);
        if (mine) {
          record(at, id, before, after);
          continue;
        }
        const others = (at.others.get(id) ?? 0) + 1, had = new Set(partsOf(before));
        at.others.set(id, others);
        for (const part of partsOf(after)) if (!had.has(part)) at.others.set(`${id}/${String(part)}`, others);
      }
    };
    at.map.forEach((value, id) => {
      const copy = copyOf(value);
      if (copy) at.copies.set(id, copy);
    });
    at.map.observeDeep(seen);
    return () => at.map.unobserveDeep(seen);
  });

  const finished = (transaction: Y.Transaction): void => {
    if (transaction.origin !== origin) return;
    if (!open) close();
    tell();
  };
  doc.on('afterTransaction', finished);

  /** Whether anyone else has written to this since. Once they have, what this browser added isn't only its own, and what it removed has been brought back, even if it has gone again. */
  const untouched = ({ root: at, id, others }: Entry): boolean => (at.others.get(id) ?? 0) === others;

  /** Something this browser added goes only if it's exactly as left, nobody else has written to it, and nothing staying behind names it. */
  const takeAway = (added: readonly Entry[]): void => {
    const asLeft = added.filter((entry) => untouched(entry) && same(copyOf(entry.root.map.get(entry.id)), entry.after));
    const going = new Set(asLeft.map(({ id }) => id));
    for (let settled = !going.size; !settled;) {
      settled = true;
      for (const { map } of roots) {
        map.forEach((value, id) => {
          for (const on of names(value)) {
            if (typeof on !== 'string' || !going.has(on) || going.has(id)) continue;
            going.delete(on);
            settled = false;
          }
        });
      }
    }
    for (const { root: at, id } of asLeft) if (going.has(id)) at.map.delete(id);
  };

  /** Walks a step back, last to first. What was added waits for the end, when what it depends on has settled. */
  const walk = (step: readonly Entry[]): void => {
    doc.transact(() => {
      const added: Entry[] = [];
      for (const entry of [...step].reverse()) {
        const { root: at, id, before, after } = entry, m = mapOf(at.map.get(id)), now = copyOf(m);
        if (!before) added.push(entry);
        else if (!after && !now && untouched(entry)) at.make(at.map, id, before);
        else if (after && m && now) fieldsBack(m, before, after, now, (part) => (at.others.get(`${id}/${String(part)}`) ?? 0) > entry.others);
      }
      takeAway(added);
    }, applying);
  };

  /** Walks back steps until one changes something. What that actually did goes on the other stack, and what it didn't do is forgotten. */
  const travel = (from: Entry[][], to: Entry[][]): StepResult => {
    if (open) return { ok: true, changed: false };
    const landed = (): boolean => {
      const step = take();
      if (step.length) to.push(step);
      return step.length > 0;
    };
    try {
      for (let step = from.pop(); step; step = from.pop()) {
        walk(step);
        if (landed()) return { ok: true, changed: true };
      }
      return { ok: true, changed: false };
    } catch (error) {
      landed();
      return { ok: false, error };
    } finally {
      tell();
    }
  };

  return {
    canUndo: () => undos.length > 0 || pending.length > 0,
    canRedo: () => redos.length > 0,
    undo: () => travel(undos, redos),
    redo: () => travel(redos, undos),
    begin() {
      open = true;
    },
    end() {
      open = false;
      close();
      tell();
    },
    drop() {
      open = false;
      take();
      tell();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    destroy() {
      doc.off('afterTransaction', finished);
      for (const stop of stops) stop();
      listeners.clear();
    }
  };
}
