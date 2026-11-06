import { DOC_FRAGMENT } from './documents';
import * as Y from 'yjs';
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';


/** A block's stable ID. Random, so two browsers can never make the same one. */
export function newBlockId(): string {
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(12))) out += ID_ALPHABET.charAt(b % ID_ALPHABET.length);
  return out;
}


/** The tags in a line's text, which go with the words. Anything else inside a block is what it's made of, or from a newer Alcove, and stays: someone may be typing in it. */
export const TAGS: ReadonlySet<string> = new Set(['hardBreak', 'mention', 'dateChip', 'docref']);

/** What a block is made of, whose attributes it needs to stay what it is. */
export const STRUCTURE: ReadonlySet<string> = new Set(['toggleSummary', 'toggleBody', 'table_row', 'table_cell', 'table_header']);


/** What a retired block keeps, so words that reach it later look as they did when they were written. No file names, and nothing else anyone said. */
export const KEPT_ATTRS: ReadonlySet<string> = new Set(['id', 'gone', 'kind', 'level', 'indent', 'done', 'icon', 'open']);


/** How far this browser had got when it took a copy of a block, by writer: a Yjs state vector. */
export type Seen = ReadonlyMap<number, number>;


export const seenIn = (doc: Y.Doc): Seen => Y.decodeStateVector(Y.encodeStateVector(doc));


const isSeen = (item: Y.Item, seen: Seen | undefined): boolean => seen === undefined || item.id.clock < (seen.get(item.id.client) ?? 0);


/** Deletes the words in a text that a copy holds. Whatever was typed since is left alone. */
function emptyText(text: Y.XmlText, seen: Seen | undefined): void {
  if (seen === undefined) { text.delete(0, text.length); return; }
  const runs: { at: number; length: number }[] = [];
  let index = 0;
  for (let item = text._start; item !== null; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const length = Math.min(item.length, Math.max(0, (seen.get(item.id.client) ?? 0) - item.id.clock));
    if (length > 0) runs.push({ at: index, length });
    index += item.length;
  }
  for (const run of runs.reverse()) text.delete(run.at, run.length);
}


function emptyAttrs(element: Y.XmlElement, seen: Seen | undefined): void {
  for (const key of Object.keys(element.getAttributes())) {
    const item = element._map.get(key);
    if (!KEPT_ATTRS.has(key) && item && isSeen(item, seen)) element.removeAttribute(key);
  }
}


/** Takes out everything in `type` that's been seen. The texts stay: someone may be typing in them. */
export function empty(type: Y.XmlElement, seen: Seen | undefined): void {
  const children = type.toArray();
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i];
    if (child instanceof Y.XmlText) emptyText(child, seen);
    else if (child instanceof Y.XmlElement && !TAGS.has(child.nodeName)) {
      empty(child, seen);
      if (!STRUCTURE.has(child.nodeName)) emptyAttrs(child, seen);
    } else if (child?._item && isSeen(child._item, seen)) type.delete(i, 1);
  }
}


/**
 * Retires a block. `seen` limits it to what a copy of the block holds, for a copy taken a while ago: without it, everything
 * this browser can see goes.
 *
 * What it writes, for anyone judging an update: two small attributes on an element that's already there, `id` and `gone`,
 * and deletes. Never new text and never a new element.
 */
export function retire(element: Y.XmlElement, id: string, target: string, seen?: Seen): void {
  empty(element, seen);
  emptyAttrs(element, seen);
  element.setAttribute('id', id);
  element.setAttribute('gone', target);
}


/** Retiring takes every other attribute away, so one that's here now was written since: a file's name, a caption, live lines. */
const saysSomething = (element: Y.XmlElement): boolean =>
  Object.entries<unknown>(element.getAttributes()).some(([key, value]) => !KEPT_ATTRS.has(key) && value !== null && value !== undefined && value !== '');


/** Nothing in it that anyone said: no words, no tags, and no attribute written since it was retired. */
export function holdsNothing(type: Y.XmlFragment): boolean {
  if (type instanceof Y.XmlElement && !STRUCTURE.has(type.nodeName) && saysSomething(type)) return false;
  return type.toArray().every((child) => {
    if (child instanceof Y.XmlText) return child.length === 0;
    return !(child instanceof Y.XmlElement) || (!TAGS.has(child.nodeName) && holdsNothing(child));
  });
}


/**
 * The one rule for what's on the page: a block is, unless it's retired and holds nothing. Anything reading a document skips
 * these, and shows a retired block that holds something as it would any other.
 */
export function isGone(element: Y.XmlElement): boolean {
  const gone: unknown = element.getAttribute('gone');
  return typeof gone === 'string' && holdsNothing(element);
}


type Weigher = (item: Y.Item) => number;

/** How much something weighs, with what's in it, leaving out what's deleted. Walked with a list: nothing says how deep it goes. */
function liveWeight(top: Y.Item, weigh: Weigher): number {
  let total = 0;
  const waiting = [top];
  for (let item = waiting.pop(); item; item = waiting.pop()) {
    if (item.deleted) continue;
    total += weigh(item);
    if (!(item.content instanceof Y.ContentType)) continue;
    const { type } = item.content;
    for (let child = type._start; child; child = child.right) waiting.push(child);
    waiting.push(...type._map.values());
  }
  return total;
}

/** The weight of everything on a page: all that a document holds but what's deleted and what's in a retired block. */
function pageWeight(doc: Y.Doc, weigh: Weigher): number {
  let total = 0;
  for (const structs of doc.store.clients.values()) for (const struct of structs) if (struct instanceof Y.Item && !struct.deleted) total += weigh(struct);
  for (let item = doc.share.get(DOC_FRAGMENT)?._start ?? null; item; item = item.right) {
    if (item.deleted || !(item.content instanceof Y.ContentType)) continue;
    const { type } = item.content;
    if (type instanceof Y.XmlElement && isGone(type)) total -= liveWeight(item, weigh);
  }
  return total;
}

const jsonLength = (v: unknown): number => JSON.stringify(v ?? null).length;

/** About how many bytes what an item says comes to: words, values and files, and nothing for structure. */
function contentBytes(item: Y.Item): number {
  const { content } = item;
  if (content instanceof Y.ContentString) return content.str.length;
  if (content instanceof Y.ContentAny) return content.arr.reduce<number>((n, v) => n + jsonLength(v), 0);
  if (content instanceof Y.ContentJSON) return content.arr.reduce<number>((n, v) => n + jsonLength(v), 0);
  if (content instanceof Y.ContentBinary) return content.content.length;
  if (content instanceof Y.ContentEmbed) return jsonLength(content.embed);
  if (content instanceof Y.ContentFormat) return content.key.length + jsonLength(content.value);
  return 0;
}


/**
 * How many items a document's page comes to: everything it holds but what's deleted and what's in a retired block. That's
 * what its limit is on, so a page someone emptied has room again, whatever it cost to empty it, and however much of that
 * Yjs has to keep. For a board, it's everything that hasn't been deleted.
 */
export const itemsOnPage = (doc: Y.Doc): number => pageWeight(doc, () => 1);

/** About how many bytes what's on the page says, counted the same way: a move or a join leaves it as it was. */
export const bytesOnPage = (doc: Y.Doc): number => pageWeight(doc, contentBytes);


/** What holds text directly. */
const LINES: ReadonlySet<string> = new Set(['line', 'code', 'toggleSummary', 'toggleBody']);


/**
 * What undo may delete. Undoing a block's arrival takes out what's in it and leaves the element, for the same reason nothing
 * else deletes one: someone may be writing in it. It goes the way of any retired block (`settleUndone`). Only the parts of a
 * table can go, because undoing an added row has to take the row away, and only if nobody's words are in them. A text never
 * goes on its own.
 */
export function undoMayDelete(item: Y.Item, fragment: Y.XmlFragment): boolean {
  if (!(item.content instanceof Y.ContentType)) return true;
  const type: unknown = item.content.type;
  const parent: unknown = item.parent;
  if (type instanceof Y.XmlText) return false;
  if (!(type instanceof Y.XmlElement) || TAGS.has(type.nodeName)) return true;
  if (parent === fragment || LINES.has(type.nodeName)) return false;
  return holdsNothing(type);
}


/** An undo took back a block's arrival, ID and all, and left its element: it gets a new ID, and it's on the page only if someone's words are in it. */
export function settleUndone(element: Y.XmlElement): void {
  element.setAttribute('id', newBlockId());
  if (holdsNothing(element)) element.setAttribute('gone', '');
}
