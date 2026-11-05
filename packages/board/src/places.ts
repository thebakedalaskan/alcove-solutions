/*
 * Where each object is: one shared Y.Array of `{ k, x, y, w, h }`, `k` being the object's id. It's a list rather than keys of each
 * object's Y.Map because of how Yjs keeps what's superseded: a Y.Map keeps every value a key has ever had, so a busy board's `x`
 * and `y` would reach the document's ceiling on structures through dragging alone, while on a list a run of one browser's deleted
 * entries collapses into one. So a move pushes a new entry and deletes the ones it replaced, and when two browsers push for one key
 * at once, the later entry in the list wins on every browser.
 *
 * An entry is only ever deleted by a write that has seen it and replaces it with a newer one for its key, or that finds it's for
 * nothing on the board, or isn't a place. So whoever has to know about a move does: a delete of someone's entry comes with that
 * newer entry, or with its object gone. The one that lost to a move at the same moment stays until its key is next moved.
 *
 * A read goes through the list once and is kept until the list changes. A write here forgets it as it writes, so a read in the
 * middle of a transaction sees what that transaction has written; any other change is forgotten before any observer hears of it,
 * so nobody reads where things were. What a peer put in the list is `unknown` until it parses, and an entry that doesn't is ignored.
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
/** The keys each list has had pushed since it was last tidied, whose older entries are to go. */
const moved = new WeakMap<Y.Array<unknown>, Set<string>>();
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

/** Each key's place: the last entry for it in the list that parses. */
export function placesIn(list: Y.Array<unknown>): ReadonlyMap<string, Place> {
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

/** Puts something somewhere: a new entry at the end, which wins over any before it. `tidyPlaces` deletes the ones it replaced. */
export function setPlace(list: Y.Array<unknown>, place: Place): void {
  const keys = moved.get(list) ?? new Set<string>();
  moved.set(list, keys);
  keys.add(place.k);
  known.delete(list);
  // Yjs's push walks to the end from the furthest entry it has looked up by index, or from the start after a peer's change. Looking
  // up the last entry first keeps that walk short when one write puts many things somewhere, as undoing a big delete does.
  if (list.length > 0) list.get(list.length - 1);
  list.push([{ k: place.k, x: place.x, y: place.y, w: place.w, h: place.h }]);
}

/**
 * Deletes what nobody needs: for each key this write moved, every entry but its last, so a move is a delete and a push; an entry
 * that doesn't parse; and one for something `keep` says isn't on the board. Each write runs it at the end, in its transaction.
 */
export function tidyPlaces(list: Y.Array<unknown>, keep: (k: string) => boolean): void {
  const keys = moved.get(list) ?? new Set<string>(), entries = list.toArray(), places = entries.map(asPlace), last = new Map<string, number>();
  moved.delete(list);
  places.forEach((place, at) => {
    if (place) last.set(place.k, at);
  });
  const dead = (at: number): boolean => {
    const place = places[at];
    return !place || !keep(place.k) || (keys.has(place.k) && last.get(place.k) !== at);
  };
  // From the end, so the rest stay where they are, and each run at once.
  for (let end = entries.length; end > 0;) {
    if (!dead(end - 1)) {
      end -= 1;
      continue;
    }
    let start = end - 1;
    while (start > 0 && dead(start - 1)) start -= 1;
    known.delete(list);
    list.delete(start, end - start);
    end = start;
  }
}
