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
  /** How many times someone else has written to each id. A write that lost the merge counts: whoever made it still moved that sticky. */
  others: Map<string, number>;
  /** Under `id/part`, what `others` was when someone else last brought back a row, column or cell. A cell goes under its words too: new words typed in an empty cell haven't brought back the old ones. */
  back: Map<string, number>;
  /** Under `id/part`, what `others` was when someone else last wrote in a cell, or a cell of a row or column. */
  wrote: Map<string, number>;
}

/** What someone else has done to a table's parts since an entry was written. */
interface Since {
  back: (part: unknown) => boolean;
  wrote: (part: unknown) => boolean;
  /** The cells that can't be written to now, as their row or column has gone. */
  away: ReadonlySet<string>;
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

/** How many steps each stack keeps. A step holds whole copies, so this is what bounds a long session. The oldest goes. */
const LIMIT = 100;

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

/** The cells a transaction wrote in, as an id and a key, even if they had gone again by the time it reached this browser. A cell going with its row is no write. */
function cellsWritten(events: readonly Y.YEvent<Y.AbstractType<unknown>>[]): [string, string][] {
  const cells: [string, string][] = [];
  for (const event of events) {
    const [id, field, key] = event.path;
    if (typeof id !== 'string' || field !== 'cells') continue;
    if (typeof key === 'string') cells.push([id, key]);
    else if (event instanceof Y.YMapEvent) for (const cell of event.keysChanged) if (typeof cell === 'string' && event.keys.get(cell)?.action !== 'delete') cells.push([id, cell]);
  }
  return cells;
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

/**
 * Each cell of a table is a field of its own. One that went with its row is made again, unless someone else has since brought back
 * those words, or written there and it has gone again: then what's in the cell is in a newer undo than this one.
 */
function cellsBack(cells: Y.Map<unknown>, before: Copy, after: Copy, now: Copy, since: Since): void {
  const was = recordOf(before['cells']), left = recordOf(after['cells']), held = recordOf(now['cells']);
  const lines = new Set(partsOf(after)), here = new Set(partsOf(now));
  for (const key of new Set([...Object.keys(was), ...Object.keys(left)])) {
    const words = wordsOf(was[key]), mine = wordsOf(left[key]);
    const spent = !mine && (since.back(`${key}${words}`) || (since.wrote(key) && key.split(':').some((line) => !lines.has(line) && !here.has(line))));
    if (words === mine || since.away.has(key) || wordsOf(held[key]) !== mine || spent) continue;
    const cell = cells.get(key);
    if (cell instanceof Y.Text) rewrite(cell, words);
    else cells.set(key, new Y.Text(words));
  }
}

/**
 * Each row or column of a table, or reply in a thread, is a field of its own, so someone adding or removing another
 * doesn't stop this one going back. One this browser added goes, unless it's `kept`. One it resized goes back, if nobody has
 * resized it since. One it removed returns after the one it followed, unless it's back, or someone has brought it back since.
 */
function linesBack(lines: Y.Array<unknown>, before: readonly unknown[], after: readonly unknown[], kept: (id: unknown) => boolean, returned: (part: unknown) => boolean): void {
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
    else if (!left.has(id) && !returned(id)) {
      lines.insert(place, [line]);
      ids.splice(place, 0, id);
      place += 1;
    }
  }
}

/** The cells this change wrote in, without taking their row or column itself, that have since lost one. They read as empty, but what's in them is in someone's undo, so they wait for it. */
function cellsAway(before: Copy, after: Copy, now: Copy): Set<string> {
  const left = new Set(partsOf(after)), here = new Set(partsOf(now)), was = recordOf(before['cells']), wrote = recordOf(after['cells']);
  const changed = Object.keys({ ...was, ...wrote }).filter((key) => wordsOf(was[key]) !== wordsOf(wrote[key]));
  return new Set(changed.filter((key) => key.split(':').every((line) => left.has(line)) && key.split(':').some((line) => !here.has(line))));
}

/**
 * Whether a row or column this browser added holds anything it didn't write, so it can't go: words that were waiting for it, or
 * that someone has put there since. Those aren't only what's on it now: they may be waiting in another undo, and they'd need this line to be read.
 */
function written(id: unknown, axis: TableAxis, before: Copy, after: Copy, now: Copy, since: Since): boolean {
  const was = recordOf(before['cells']), left = recordOf(after['cells']);
  return since.wrote(id) || (typeof id === 'string' && Object.entries(recordOf(now['cells'])).some(([key, words]) => inLine(key, axis, id) && (words !== left[key] || key in was)));
}

/** Sets back what this browser changed in something, field by field. A field someone has changed since stays theirs, and none is ever deleted. */
function fieldsBack(m: Y.Map<unknown>, before: Copy, after: Copy, now: Copy, since: Since): void {
  for (const [key, was] of Object.entries(before)) {
    const left = after[key], live = m.get(key);
    if (same(was, left)) continue;
    if (live instanceof Y.Array) linesBack(live, listOf(was), listOf(left), (id) => (key === 'rows' || key === 'cols') && written(id, key, before, after, now, since), since.back);
    else if (live instanceof Y.Map) cellsBack(live, before, after, now, since);
    else if (!same(now[key], left)) continue;
    else if (live instanceof Y.Text) rewrite(live, wordsOf(was));
    else m.set(key, was);
  }
}

/** Starts keeping the history of what this browser does under `origin`. */
export function makeHistory(doc: Y.Doc, origin: unknown): BoardHistory {
  const root = (name: string, make: Root['make']): Root[] => {
    const map = rootMap(doc, name);
    return map ? [{ name, map, make, copies: new Map(), others: new Map(), back: new Map(), wrote: new Map() }] : [];
  };
  const roots = [...root(BOARD_OBJECTS, put), ...root(BOARD_COMMENTS, putThread)];
  /** Going back is under its own origin, so it isn't recorded as a new step. */
  const applying = {};
  const undos: Entry[][] = [], redos: Entry[][] = [];
  const listeners = new Set<() => void>();
  /** What's been recorded for the step in progress, and the latest entry for each id in it. */
  let pending: Entry[] = [];
  const latest = new Map<string, Entry>();
  let open = false;
  /** The transaction walking a step, until it has finished: it can be someone else's, and then nothing shows until theirs ends. */
  let walking: Y.Transaction | null = null;
  /** Where what a press does lands, and whether it has. */
  let landing = redos;
  let landed = false;

  const tell = (): void => {
    for (const listener of listeners) listener();
  };

  /**
   * One id changed. Within a step that's one entry per id, keeping the first `before`, until someone else writes to it. A removal
   * has an entry of its own, so what it took comes back with it, even if this browser made it in the same step.
   */
  const record = (at: Root, id: string, before: Copy | null, after: Copy | null): void => {
    const others = at.others.get(id) ?? 0, key = `${at.name}:${id}`, entry = latest.get(key);
    if (after && entry?.others === others) {
      entry.after = after;
      return;
    }
    const next = { root: at, id, before, after, others };
    pending.push(next);
    latest.set(key, next);
  };

  /** What's been recorded, leaving out whatever came to nothing, like a drag that ended where it began. */
  const take = (): Entry[] => {
    const step = pending.filter(({ before, after }) => !same(before, after));
    pending = [];
    latest.clear();
    return step;
  };

  const keep = (stack: Entry[][], step: Entry[]): void => {
    stack.push(step);
    if (stack.length > LIMIT) stack.shift();
  };

  const close = (): void => {
    const step = take();
    if (!step.length) return;
    keep(undos, step);
    redos.length = 0;
  };

  const stops = roots.map((at) => {
    const seen = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction): void => {
      const mine = transaction.origin === origin || transaction === walking;
      for (const id of touched(events)) {
        const before = at.copies.get(id) ?? null, after = copyOf(at.map.get(id));
        if (after) at.copies.set(id, after);
        else at.copies.delete(id);
        if (mine) {
          record(at, id, before, after);
          continue;
        }
        const others = (at.others.get(id) ?? 0) + 1, had = new Set(partsOf(before)), cells = recordOf(after?.['cells']);
        at.others.set(id, others);
        for (const part of partsOf(after)) if (!had.has(part)) at.back.set(`${id}/${String(part)}${wordsOf(cells[String(part)])}`, others);
      }
      if (!mine) for (const [id, key] of cellsWritten(events)) for (const part of [key, ...key.split(':')]) at.wrote.set(`${id}/${part}`, at.others.get(id) ?? 0);
    };
    at.map.forEach((value, id) => {
      const copy = copyOf(value);
      if (copy) at.copies.set(id, copy);
    });
    at.map.observeDeep(seen);
    return () => at.map.unobserveDeep(seen);
  });

  const finished = (transaction: Y.Transaction): void => {
    if (transaction === walking) {
      walking = null;
      const step = take();
      if (step.length) keep(landing, step);
      landed = step.length > 0;
    } else if (transaction.origin !== origin) return;
    else if (!open) close();
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

  /** Walks a step back, last to first. What was added waits for the end, when what it depends on has settled. Returns the changes to something that has gone, which can't apply until it's back. */
  const walk = (step: readonly Entry[]): Entry[] => {
    const waiting: Entry[] = [];
    doc.transact((transaction) => {
      walking = transaction;
      const added: Entry[] = [];
      for (const entry of [...step].reverse()) {
        const { root: at, id, before, after } = entry, m = mapOf(at.map.get(id)), now = copyOf(m);
        const notes = (of: Map<string, number>) => (part: unknown): boolean => (of.get(`${id}/${String(part)}`) ?? 0) > entry.others;
        if (!before) added.push(entry);
        else if (!after) { if (!now && untouched(entry)) at.make(at.map, id, before); }
        else if (m && now) {
          const away = cellsAway(before, after, now);
          const only = (copy: Copy): Copy => ({ ...after, cells: Object.fromEntries(Object.entries(recordOf(copy['cells'])).filter(([key]) => away.has(key))) });
          fieldsBack(m, before, after, now, { back: notes(at.back), wrote: notes(at.wrote), away });
          if (away.size) waiting.unshift({ ...entry, before: only(before), after: only(after) });
        } else waiting.unshift(entry);
      }
      takeAway(added);
    }, applying);
    return waiting;
  };

  /**
   * Walks back steps until one changes something. What that did goes on the other stack, and what it didn't do is forgotten,
   * except a change to something that has gone: that stays where it is, and a press moves past it, as it can apply when it's back.
   * Inside someone else's transaction nothing shows until theirs ends, so one step is all a press can take.
   */
  const travel = (from: Entry[][], to: Entry[][]): StepResult => {
    if (open || walking) return { ok: true, changed: false };
    landing = to;
    landed = false;
    try {
      for (let at = from.length - 1; at >= 0 && !landed && !walking; at -= 1) {
        const [step] = from.splice(at, 1);
        const waiting = step ? walk(step) : [];
        if (waiting.length) from.splice(at, 0, waiting);
      }
      return { ok: true, changed: landed || walking !== null };
    } catch (error) {
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
      undos.length = 0;
      redos.length = 0;
      take();
    }
  };
}
