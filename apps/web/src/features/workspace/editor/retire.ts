/*
 * What's left to do around a retired block in a browser that's writing in it (`@alcove/api/retire` says what retiring is):
 * the words its author was typing as it left, and what ⌘Z remembers of them.
 */
import { empty, retire, seenIn, type Seen } from '@alcove/api/retire';
import * as Y from 'yjs';

/** The words in a retired block that its author typed where the block used to be, and where they stood among the words that left. */
export interface StrayWords { element: Y.XmlElement; target: string; words: string; before: string; after: string; seen: Seen }

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
  return words ? { element, target, words, before, after, seen: seenIn(tr.doc) } : null;
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

/** What a block says, to tell two copies of it apart. */
const saying = (element: Y.XmlElement): string => {
  const captions = Object.entries(element.getAttributes()).filter(([key]) => key.startsWith('cap:')).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([element.toArray().map(String), captions]);
};

/**
 * Two people moved one block, so two elements have its ID. Every browser settles on the same one. The other goes only if
 * it says the same: someone may have typed in it since, and then it stays too, as a block of its own.
 */
export function settleCopies(copy: Y.XmlElement, keeper: Y.XmlElement, id: string, fresh: string): void {
  if (saying(copy) === saying(keeper)) retire(copy, fresh, id);
  else copy.setAttribute('id', fresh);
}

/** A stretch of text, by who wrote it, and how far into its block it starts. */
interface Run { client: number; clock: number; length: number; at: number }

function runsOf(type: Y.XmlElement, counts: (item: Y.Item) => boolean): { runs: Run[]; text: string } {
  const runs: Run[] = [];
  let text = '';
  for (const child of type.toArray()) {
    if (!(child instanceof Y.XmlText)) { text += OBJECT; continue; }
    for (let item = child._start; item !== null; item = item.right) {
      if (!(item.content instanceof Y.ContentString) || !counts(item)) continue;
      runs.push({ client: item.id.client, clock: item.id.clock, length: item.length, at: text.length });
      text += item.content.str;
    }
  }
  return { runs, text };
}

/**
 * Someone else retired a block this browser typed in, and copied the words somewhere else, as new text of theirs. Undo here
 * remembers the words it typed, which have just gone, so it would skip them and take back something older instead. This
 * tells it where those words are now. Read from the change that did it (`tr`), while what it deleted can still be read.
 */
export function followUndo(manager: Y.UndoManager, element: Y.XmlElement, into: Y.XmlElement, tr: Y.Transaction, client: number): void {
  const holder = textHolder(into);
  if (!holder) return;
  const was = runsOf(element, (item) => item.deleted && Y.isDeleted(tr.deleteSet, item.id));
  const now = runsOf(holder, (item) => !item.deleted);
  const base = now.text.indexOf(was.text);
  if (base < 0 || was.text === '') return;
  for (const step of manager.undoStack) {
    for (const typed of [...(step.insertions.clients.get(client) ?? [])]) {
      for (const run of was.runs) {
        const start = Math.max(typed.clock, run.clock), end = Math.min(typed.clock + typed.len, run.clock + run.length);
        if (run.client !== client || start >= end) continue;
        const first = base + run.at + start - run.clock, last = first + end - start;
        for (const there of now.runs) {
          const from = Math.max(first, there.at), to = Math.min(last, there.at + there.length);
          if (from >= to) continue;
          const list = step.insertions.clients.get(there.client) ?? [];
          list.push({ clock: there.clock + from - there.at, len: to - from });
          step.insertions.clients.set(there.client, list);
        }
      }
    }
  }
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
  empty(stray.element, stray.seen);
  return at + stray.words.length;
}
