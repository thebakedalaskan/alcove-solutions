/*
 * Where each object is: one shared Y.Array of `{ k, x, y, w, h }`, `k` being the object's id. It's a list rather than keys of each
 * object's Y.Map because of how Yjs keeps what's superseded: a Y.Map keeps every value a key has ever had, so a busy board's `x`
 * and `y` would reach the document's ceiling on structures through dragging alone, while on a list a run of one browser's deleted
 * entries, each inserted right after the one before, collapses into one. So each browser keeps its own run: a write puts all its
 * places, as one block, right after the last entry this browser wrote, and deletes the entries they replace. One person's writes,
 * of one thing or a thousand, then stay side by side whatever anyone else writes meanwhile, instead of interleaving with theirs at
 * the end of the list. A browser's first write goes at the end. When two browsers write one key at once, the later entry in the
 * list wins on every browser.
 *
 * An entry is only ever deleted by a write that has seen it and replaces it with a newer one for its key, or that finds it's for
 * nothing on the board, or isn't a place. So whoever has to know about a move does: a delete of someone's entry comes with that
 * newer entry, or with its object gone. The one that lost to a move at the same moment stays until its key is next moved.
 *
 * A write's places go into the list together at its end, from one read of the list. Until then a read takes them from the write
 * itself, so a write that reads the board again part way, as Sort into themes does after it grows a frame, sees where it has put
 * things. A read of the list itself goes through it once and is kept until the list changes: writing here forgets it, and any
 * other change is forgotten before any observer hears of it, so nobody reads where things were. What a peer put in the list is
 * `unknown` until it parses, and an entry that doesn't is ignored.
 */
import * as Y from 'yjs';
import { PlaceSchema, type Place } from './shape';

/** A root as a list, or null if this browser already opened it as something else, where `getArray` would throw. */
export function rootList(doc: Y.Doc, name: string): Y.Array<unknown> | null {
  const root = doc.share.get(name);
  if (root !== undefined && root.constructor !== Y.AbstractType && !(root instanceof Y.Array)) return null;
  return doc.getArray<unknown>(name);
}

/** What each entry parsed to. An entry is the same object each time the list is read, so each one is parsed once. */
const parsed = new WeakMap<object, Place | null>();
/** Where the write under way has put things in each list, by key, until `tidyPlaces` writes it there. */
const pending = new WeakMap<Y.Array<unknown>, Map<string, Place>>();
/** The entries this browser wrote, which are the same objects in the list for as long as the doc is open. */
const mine = new WeakSet<object>();
/** Each list's places as last read, until it changes. */
const known = new WeakMap<Y.Array<unknown>, ReadonlyMap<string, Place>>();
/** Docs that forget their lists' places whenever a transaction changes them. */
const forgetting = new WeakSet<Y.Doc>();

/** An entry in the list as a place, or null if it isn't one. */
export function asPlace(entry: unknown): Place | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const was = parsed.get(entry);
  if (was !== undefined) return was;
  const result = PlaceSchema.safeParse(entry);
  const place = result.success ? result.data : null;
  parsed.set(entry, place);
  return place;
}

/** Each key's place: where the write under way has put it, or else the last entry for it in the list that parses. */
export function placesIn(list: Y.Array<unknown>): ReadonlyMap<string, Place> {
  const read = readList(list), waiting = pending.get(list);
  if (!waiting?.size) return read;
  const now = new Map(read);
  for (const [k, place] of waiting) now.set(k, place);
  return now;
}

/** The list's places, from the last read of it if nothing has changed it since. */
function readList(list: Y.Array<unknown>): ReadonlyMap<string, Place> {
  const kept = known.get(list);
  if (kept) return kept;
  const places = new Map<string, Place>();
  for (const entry of list.toArray()) {
    const place = asPlace(entry);
    if (place) places.set(place.k, place);
  }
  const doc = list.doc;
  if (!doc) return places;
  if (!forgetting.has(doc)) {
    forgetting.add(doc);
    doc.on('beforeObserverCalls', (transaction: Y.Transaction) => {
      transaction.changed.forEach((_, type) => {
        if (type instanceof Y.Array) known.delete(type);
      });
    });
  }
  known.set(list, places);
  return places;
}

/** Puts something somewhere. It goes into the list when the write ends, in `tidyPlaces`, and replaces every entry for it there. */
export function setPlace(list: Y.Array<unknown>, place: Place): void {
  const waiting = pending.get(list) ?? new Map<string, Place>();
  pending.set(list, waiting);
  waiting.set(place.k, { k: place.k, x: place.x, y: place.y, w: place.w, h: place.h });
}

/** Whether this browser wrote an entry. */
function isMine(entry: unknown): boolean {
  return typeof entry === 'object' && entry !== null && mine.has(entry);
}

/**
 * The end of every write, in its transaction. Writes what it put somewhere, in the order it was put, as one block right after the
 * last entry this browser wrote, or at the end if it has none. Then deletes what nobody needs: every other entry for a key it wrote,
 * an entry that doesn't parse, and one for something `keep` says isn't on the board. A place for something that isn't is never written.
 */
export function tidyPlaces(list: Y.Array<unknown>, keep: (k: string) => boolean): void {
  const waiting = pending.get(list);
  pending.delete(list);
  const entries = list.toArray(), places = entries.map(asPlace);
  const written = [...(waiting?.values() ?? [])].filter((place) => keep(place.k)), keys = new Set(written.map((place) => place.k));
  // The block goes right after this browser's last entry, so the entries after that index move along by its length.
  let after = entries.length - 1;
  if (written.length) {
    const last = entries.findLastIndex(isMine);
    known.delete(list);
    for (const entry of written) mine.add(entry);
    if (last >= 0) {
      after = last;
      list.insert(last + 1, written);
    } else list.push(written);
  }
  const dead = (at: number): boolean => {
    const place = places[at];
    return !place || !keep(place.k) || keys.has(place.k);
  };
  const now = (at: number): number => (at > after ? at + written.length : at);
  // From the end, so the rest stay where they are, and each run at once, never across the block just written.
  for (let end = entries.length; end > 0;) {
    if (!dead(end - 1)) {
      end -= 1;
      continue;
    }
    let start = end - 1;
    while (start > 0 && dead(start - 1) && start - 1 !== after) start -= 1;
    known.delete(list);
    list.delete(now(start), end - start);
    end = start;
  }
}
