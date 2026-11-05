/*
 * How a block leaves the page. Yjs can't move an element, only delete it and insert a copy, and whatever lands in a deleted
 * element is lost: on every browser and on the server, with nothing left to find it by. So a block's element is never
 * deleted. It's retired: everything in it that this browser can see goes, and the element stays where it was, with `gone`
 * saying which block took its words ('' if none did) and a new `id`, because its old one may live on in that block.
 *
 * A retired element with nothing in it isn't on the page. Whatever reaches it afterwards, from someone who hadn't heard
 * yet, however long they were offline and whether or not they reloaded, is in a live element. Yjs keeps it like any other
 * words on every browser, and the block is back on the page holding just those. Nothing has to notice or put anything
 * back for that to be true. The words someone deleted stay deleted, because only what they could see is ever touched.
 *
 * Only Yjs here, so this works on a document that isn't open.
 */
import * as Y from 'yjs';

/** What a block is made of, as opposed to what's in it. Anything else inside a block is a tag in its text. */
const STRUCTURE: ReadonlySet<string> = new Set(['toggleSummary', 'toggleBody', 'table_row', 'table_cell', 'table_header']);

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

/** Takes out everything in `type` that's been seen. The texts stay: someone may be typing in them. */
function empty(type: Y.XmlElement, seen: Seen | undefined): void {
  const children = type.toArray();
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i];
    if (child instanceof Y.XmlText) emptyText(child, seen);
    else if (child instanceof Y.XmlElement && STRUCTURE.has(child.nodeName)) empty(child, seen);
    else if (child?._item && isSeen(child._item, seen)) type.delete(i, 1);
  }
}

/**
 * Retires a block. `seen` limits it to what a copy of the block holds, for a copy taken a while ago: without it, everything
 * this browser can see goes.
 */
export function retire(element: Y.XmlElement, id: string, target: string, seen?: Seen): void {
  empty(element, seen);
  for (const key of Object.keys(element.getAttributes())) {
    const item = element._map.get(key);
    if (!KEPT_ATTRS.has(key) && item && isSeen(item, seen)) element.removeAttribute(key);
  }
  element.setAttribute('id', id);
  element.setAttribute('gone', target);
}

/** The words in a retired block that its author typed where the block used to be, and where they stood among the words that left. */
export interface StrayWords { element: Y.XmlElement; target: string; words: string; before: string; after: string }

/**
 * What this browser typed into a block in the moment it was retired, read from the change that retired it (`tr`): what that
 * change deleted can still be read until it ends. Null if anyone else's words are in there too, or if it isn't a plain run
 * of text: then the block stays on the page as it is, which is always safe.
 */
export function strayWords(element: Y.XmlElement, tr: Y.Transaction, client: number): StrayWords | null {
  const target: unknown = element.getAttribute('gone');
  if (typeof target !== 'string' || target === '') return null;
  let before = '', after = '', words = '';
  for (const child of element.toArray()) {
    if (!(child instanceof Y.XmlText)) return null;
    for (let item = child._start; item !== null; item = item.right) {
      if (!(item.content instanceof Y.ContentString)) continue;
      if (!item.deleted) {
        if (item.id.client !== client) return null;
        words += item.content.str;
      } else if (Y.isDeleted(tr.deleteSet, item.id)) {
        if (words) after += item.content.str;
        else before += item.content.str;
      }
    }
  }
  return words ? { element, target, words, before, after } : null;
}

/** Stands for anything in a line that isn't text, so offsets count the way ProseMirror's do. */
const OBJECT = '￼';

const wordsOf = (text: Y.XmlText): string => text.toDelta().map((part: { insert?: unknown }) => (typeof part.insert === 'string' ? part.insert : OBJECT)).join('');

/** Where words can go in a block: a line, code, or a toggle's line. Nothing else holds text directly. */
function textHolder(element: Y.XmlElement): Y.XmlElement | null {
  if (element.nodeName === 'line' || element.nodeName === 'code') return element;
  const first = element.nodeName === 'toggle' ? element.get(0) : null;
  return first instanceof Y.XmlElement ? first : null;
}

/**
 * Puts stray words into the block they were meant for and takes them out of where they landed, in one step, so they're in
 * exactly one place. It only ever writes text into something that holds text. If there's nowhere for them it does nothing,
 * and the words stay on the page where they are. Returns how far into the block they end, for the caret.
 */
export function gatherWords(stray: StrayWords, into: Y.XmlElement): number | null {
  const holder = textHolder(into);
  if (!holder) return null;
  const children = holder.toArray();
  const whole = children.map((child) => (child instanceof Y.XmlText ? wordsOf(child) : OBJECT)).join('');
  const found = whole.indexOf(stray.before + stray.after);
  const at = found < 0 ? whole.length : found + stray.before.length;
  let left = at, placed = false;
  for (const child of children) {
    if (child instanceof Y.XmlText && left <= child.length) { child.insert(left, stray.words); placed = true; break; }
    left -= child instanceof Y.XmlText ? child.length : 1;
  }
  if (!placed) holder.insert(holder.length, [new Y.XmlText(stray.words)]);
  empty(stray.element, undefined);
  return at + stray.words.length;
}
