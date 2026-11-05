/*
 * What's left to do around a retired block in a browser that's writing in it (`@alcove/api/retire` says what retiring is):
 * the words its author was typing as it left, the words its author had deleted that a copy brought back, and what ⌘Z
 * remembers of either.
 */
import { empty, KEPT_ATTRS, retire, seenIn, type Seen } from '@alcove/api/retire';
import * as Y from 'yjs';

/** Part of a text, as Yjs reads one out. */
interface TextPart { insert?: unknown; attributes?: Record<string, unknown> }

const partsOf = (text: Y.XmlText): TextPart[] => text.toDelta();

/** A stretch of text, by who wrote it, how far into the words read it starts, and how far into its block. */
interface Run { client: number; clock: number; length: number; at: number; place: number }

/** The words in a block that `counts` says to read, with what isn't text left out. */
function runsOf(type: Y.XmlElement, counts: (item: Y.Item) => boolean): { runs: Run[]; text: string } {
  const runs: Run[] = [];
  let text = '', place = 0;
  for (const child of type.toArray()) {
    if (!(child instanceof Y.XmlText)) { place += 1; continue; }
    for (let item = child._start; item !== null; item = item.right) {
      if (item.content instanceof Y.ContentString && counts(item)) {
        runs.push({ client: item.id.client, clock: item.id.clock, length: item.length, at: text.length, place });
        text += item.content.str;
      }
      if (!item.deleted && item.countable) place += item.length;
    }
  }
  return { runs, text };
}

/** Whether a change wrote this, rather than finding it there. */
const writtenIn = (tr: Y.Transaction, item: Y.Item): boolean => item.id.clock >= (tr.beforeState.get(item.id.client) ?? 0);

/** Where words can go in a block: a line, code, or a toggle's line. Nothing else holds text directly. */
function textHolder(element: Y.XmlElement): Y.XmlElement | null {
  if (element.nodeName === 'line' || element.nodeName === 'code') return element;
  const first = element.nodeName === 'toggle' ? element.get(0) : null;
  return first instanceof Y.XmlElement ? first : null;
}

/** How far into a block a place in words a change copied there is: only what it wrote is looked at, so the same letters already there aren't mistaken for them. */
function landing(holder: Y.XmlElement, words: string, offset: number, tr: Y.Transaction): number | null {
  const { runs, text } = runsOf(holder, (item) => !item.deleted && writtenIn(tr, item));
  const found = text.indexOf(words);
  const at = found + offset;
  const run = runs.find((r) => at > r.at && at <= r.at + r.length) ?? runs.find((r) => at === r.at);
  return found < 0 || !run ? null : run.place + at - run.at;
}

/** The words in a retired block that its author typed where the block used to be, and where they belong in the block that took the rest. */
export interface StrayWords { element: Y.XmlElement; target: string; parts: { insert: string; attributes: Record<string, unknown> }[]; runs: Run[]; at: number | null; seen: Seen }

/**
 * What this browser typed into a block in the moment it was retired, read from the change that retired it (`tr`): what that
 * change deleted can still be read until it ends. Null if anyone else's words are in there too, or if it isn't a plain run
 * of text: then the block stays on the page as it is, which is always safe.
 */
export function strayWords(element: Y.XmlElement, into: Y.XmlElement | undefined, tr: Y.Transaction, client: number): StrayWords | null {
  const target: unknown = element.getAttribute('gone');
  if (typeof target !== 'string' || target === '') return null;
  const parts: StrayWords['parts'] = [];
  const runs: Run[] = [];
  let before = '', after = '', words = '';
  for (const child of element.toArray()) {
    if (!(child instanceof Y.XmlText)) return null;
    for (let item = child._start; item !== null; item = item.right) {
      if (!(item.content instanceof Y.ContentString)) continue;
      if (!item.deleted) {
        if (item.id.client !== client) return null;
        runs.push({ client, clock: item.id.clock, length: item.length, at: words.length, place: 0 });
        words += item.content.str;
      } else if (Y.isDeleted(tr.deleteSet, item.id)) {
        if (words) after += item.content.str;
        else before += item.content.str;
      }
    }
    for (const part of partsOf(child)) {
      if (typeof part.insert !== 'string') return null;
      parts.push({ insert: part.insert, attributes: part.attributes ?? {} });
    }
  }
  if (!words) return null;
  const holder = into ? textHolder(into) : null;
  return { element, target, parts, runs, at: holder ? landing(holder, before + after, before.length, tr) : null, seen: seenIn(tr.doc) };
}

/** What a block says, to tell two copies of it apart. */
const saying = (element: Y.XmlElement): string => {
  const captions = Object.entries(element.getAttributes()).filter(([key]) => key.startsWith('cap:')).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([element.toArray().map(String).join(''), captions]);
};

/**
 * Two people moved one block, so two elements have its ID. Every browser settles on the same one. The other goes only if
 * it says the same: someone may have typed in it since, and then it stays too, as a block of its own.
 */
export function settleCopies(copy: Y.XmlElement, keeper: Y.XmlElement, id: string, fresh: string): void {
  if (saying(copy) === saying(keeper)) retire(copy, fresh, id);
  else copy.setAttribute('id', fresh);
}

type DeleteSet = ReturnType<typeof Y.createDeleteSet>;

function addTo(set: DeleteSet, client: number, clock: number, len: number): void {
  const list = set.clients.get(client) ?? [];
  list.push({ clock, len });
  list.sort((a, b) => a.clock - b.clock);
  set.clients.set(client, list);
}

/** Tells undo where words went: every step that remembers typing what `was` says now also remembers what `now` says, from `base` on. */
function rewire(manager: Y.UndoManager, was: readonly Run[], now: readonly Run[], base: number, client: number): void {
  for (const step of manager.undoStack) {
    for (const typed of [...(step.insertions.clients.get(client) ?? [])]) {
      for (const run of was) {
        const start = Math.max(typed.clock, run.clock), end = Math.min(typed.clock + typed.len, run.clock + run.length);
        if (run.client !== client || start >= end) continue;
        const first = base + run.at + start - run.clock, last = first + end - start;
        for (const there of now) {
          const from = Math.max(first, there.at), to = Math.min(last, there.at + there.length);
          if (from < to) addTo(step.insertions, there.client, there.clock + from - there.at, to - from);
        }
      }
    }
  }
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
  const now = runsOf(holder, (item) => !item.deleted && writtenIn(tr, item));
  const base = now.text.indexOf(was.text);
  if (base < 0 || was.text === '') return;
  rewire(manager, was.runs, now.runs, base, client);
  /* A block that a step here brought to the page goes with that step wherever it's been moved: taking its ID leaves it to `settleUndone`. */
  const made = element._item?.id, name = into._map.get('id');
  if (!made || !name || !into._item || !writtenIn(tr, into._item)) return;
  for (const step of manager.undoStack) if (Y.isDeleted(step.insertions, made)) addTo(step.insertions, name.id.client, name.id.clock, 1);
}

/**
 * Puts stray words into the block they were meant for and takes them out of where they landed, in one step, so they're in
 * exactly one place. It only ever writes text into something that holds text. If there's nowhere for them it does nothing,
 * and the words stay on the page where they are. Undo follows them there. Returns how far into the block they end, for the caret.
 */
export function gatherWords(stray: StrayWords, into: Y.XmlElement, undo: Y.UndoManager | undefined): number | null {
  const holder = textHolder(into);
  const doc = holder?.doc;
  if (!holder || !doc) return null;
  const children = holder.toArray();
  const size = children.reduce((n, child) => n + (child instanceof Y.XmlText ? child.length : 1), 0);
  const at = Math.min(stray.at ?? size, size);
  const first = Y.getState(doc.store, doc.clientID);
  let left = at, text: Y.XmlText | null = null;
  for (const child of children) {
    if (child instanceof Y.XmlText && left <= child.length) { text = child; break; }
    left -= child instanceof Y.XmlText ? child.length : 1;
  }
  if (!text) {
    text = new Y.XmlText();
    left = 0;
    holder.insert(holder.length, [text]);
  }
  let end = left;
  for (const part of stray.parts) {
    text.insert(end, part.insert, part.attributes);
    end += part.insert.length;
  }
  if (undo) rewire(undo, stray.runs, runsOf(holder, (item) => item.id.client === doc.clientID && item.id.clock >= first).runs, 0, doc.clientID);
  empty(stray.element, stray.seen);
  return at + end - left;
}

/** Stands for anything in a line that isn't text, so offsets count the way ProseMirror's do. */
const OBJECT = '￼';

/** The change that took a block's words somewhere else: where to, who wrote it and how far their clock had got, and what the block's `gone` was before. Null for anything else. */
export interface Moved { target: string; client: number; clock: number; was: string | null }

/** What a change wrote to `gone`, read even if it lost to something written at the same time: until the change ends, it can be. */
export function movedIn(element: Y.XmlElement, tr: Y.Transaction): Moved | null {
  let moved: { target: string; client: number; clock: number } | null = null, was: string | null = null;
  for (let item = element._map.get('gone') ?? null; item !== null; item = item.left) {
    const value: unknown = item.content.getContent()[0];
    if (typeof value !== 'string') continue;
    if (!writtenIn(tr, item)) was ??= value;
    else if (!moved && value !== '') moved = { target: value, client: item.id.client, clock: item.id.clock };
  }
  return moved && { ...moved, was };
}

/** Whether a block arrived in this change, as a copy does, rather than being there already. */
export const isNewIn = (element: Y.XmlElement, tr: Y.Transaction): boolean => element._item !== null && writtenIn(tr, element._item);

/** Part of what a block said: `mine` if this browser deleted it before the change that retired it. */
interface Said { text: string; mine: boolean }

/** What a line said just before `tr` retired it, as far as this browser can still read it. Undo keeps what it deleted readable, and only that: what anyone else deleted earlier is left out. */
function saidIn(line: Y.XmlElement, tr: Y.Transaction): Said[] {
  const out: Said[] = [];
  const add = (item: Y.Item, text: string) => { out.push({ text, mine: !Y.isDeleted(tr.deleteSet, item.id) }); };
  for (let child = line._start; child !== null; child = child.right) {
    const type: unknown = child.content instanceof Y.ContentType ? child.content.type : null;
    if (type instanceof Y.XmlElement && child.deleted) add(child, OBJECT);
    if (!(type instanceof Y.XmlText)) continue;
    for (let item = type._start; item !== null; item = item.right) if (item.deleted && item.content instanceof Y.ContentString) add(item, item.content.str);
  }
  return out;
}

/** Where a stretch of a copy is. */
interface Copied { owner: Y.XmlText | Y.XmlElement; client: number; clock: number; length: number; at: number }

/** What was copied into a line: what was there, and what anyone wrote there since, isn't part of it. */
function copiedIn(line: Y.XmlElement, isCopy: (item: Y.Item) => boolean): { spots: Copied[]; text: string } {
  const spots: Copied[] = [];
  let text = '';
  for (let child = line._start; child !== null; child = child.right) {
    const type: unknown = child.content instanceof Y.ContentType ? child.content.type : null;
    if (type instanceof Y.XmlElement && isCopy(child)) {
      spots.push({ owner: line, client: child.id.client, clock: child.id.clock, length: 1, at: text.length });
      text += OBJECT;
    }
    if (!(type instanceof Y.XmlText)) continue;
    for (let item = type._start; item !== null; item = item.right) {
      if (!(item.content instanceof Y.ContentString) || !isCopy(item)) continue;
      spots.push({ owner: type, client: item.id.client, clock: item.id.clock, length: item.length, at: text.length });
      text += item.content.str;
    }
  }
  return { spots, text };
}

/**
 * Accounts for every letter of a copy with what a block said, in order, and says which of what this browser deleted is
 * in it. Any of it may not be: the copy's author may have heard of the deletion, or of someone else's. Where the same
 * letters could be either, they're taken to be what wasn't deleted, because that keeps them. Null if the letters can't all
 * be accounted for: then nothing is known for sure, and nothing is touched.
 */
function alignCopy(said: readonly Said[], copy: string): { from: number; to: number }[] | null {
  const failed = new Set<string>();
  const from = (index: number, at: number): { from: number; to: number }[] | null => {
    const part = said[index];
    if (!part) return at === copy.length ? [] : null;
    const key = `${index}:${at}`;
    if (failed.has(key)) return null;
    const taken = () => (copy.startsWith(part.text, at) ? from(index + 1, at + part.text.length) : null);
    let found: { from: number; to: number }[] | null;
    if (part.mine) {
      found = from(index + 1, at);
      const rest = found ? null : taken();
      if (rest) found = [{ from: at, to: at + part.text.length }, ...rest];
    } else found = taken() ?? from(index + 1, at);
    if (!found) failed.add(key);
    return found;
  };
  return from(0, 0);
}

/** Words to take out of a copy, by who wrote them there. */
export type CopiedWords = Omit<Copied, 'at'>[];

/**
 * Someone copied a block as they moved it, while this browser had deleted some of what's in it and they hadn't heard. The
 * copy has those words back, as new words of theirs, and only the deletion's author can tell: what was deleted is still
 * readable here, because undo keeps it, and nowhere else. This finds them in the copy, by what's around them, so they can
 * be deleted again. Words that don't line up exactly with what the copy says are left alone: a copy keeps someone's words
 * rather than risk them.
 */
export function wordsToCut(element: Y.XmlElement, copy: Y.XmlElement, moved: Moved, tr: Y.Transaction): CopiedWords | null {
  const children = element.toArray(), copies = copy.toArray();
  if (!children.some((child) => child instanceof Y.XmlText)) {
    if (element.nodeName !== copy.nodeName || children.length !== copies.length) return null;
    const out: CopiedWords = [];
    for (const [i, child] of children.entries()) {
      const other = copies[i];
      if (!(child instanceof Y.XmlElement) || !(other instanceof Y.XmlElement)) return null;
      const inner = wordsToCut(child, other, moved, tr);
      if (!inner) return null;
      out.push(...inner);
    }
    return out;
  }
  const said = saidIn(element, tr);
  if (!said.some((part) => part.mine)) return [];
  const holder = copies.some((child) => child instanceof Y.XmlText) ? copy : textHolder(copy);
  if (!holder) return null;
  /* A move writes its copy before `gone`. A join, a block turned into another and a copy of a copy come after it. */
  const first = copy._item?.id.client === moved.client && copy._item.id.clock < moved.clock;
  const { spots, text } = copiedIn(holder, (item) => item.id.client === moved.client && writtenIn(tr, item) && (first ? item.id.clock < moved.clock : item.id.clock > moved.clock));
  const cuts = alignCopy(said, text);
  if (!cuts) return null;
  return cuts.flatMap(({ from, to }) => spots.flatMap((spot) => {
    const start = Math.max(from, spot.at), end = Math.min(to, spot.at + spot.length);
    return start < end ? [{ owner: spot.owner, client: spot.client, clock: spot.clock + start - spot.at, length: end - start }] : [];
  }));
}

/** The attributes of a copy that say what this browser took off the block, and nothing since: a caption, or a file's name. */
export function attrsToCut(element: Y.XmlElement, copy: Y.XmlElement, tr: Y.Transaction): string[] {
  return Object.entries<unknown>(copy.getAttributes()).flatMap(([key, value]) => {
    const item = element._map.get(key);
    const said: unknown = item?.deleted && !Y.isDeleted(tr.deleteSet, item.id) ? item.content.getContent()[0] : undefined;
    return !KEPT_ATTRS.has(key) && said !== undefined && JSON.stringify(said) === JSON.stringify(value) ? [key] : [];
  });
}

/** Deletes what `wordsToCut` found. */
export function cutWords(words: CopiedWords): void {
  for (const owner of new Set(words.map((w) => w.owner))) {
    const cuts: { index: number; length: number }[] = [];
    let index = 0;
    for (let item = owner._start; item !== null; item = item.right) {
      if (item.deleted || !item.countable) continue;
      for (const w of words) {
        if (w.owner !== owner || w.client !== item.id.client) continue;
        const start = Math.max(w.clock, item.id.clock), end = Math.min(w.clock + w.length, item.id.clock + item.length);
        if (start < end) cuts.push({ index: index + start - item.id.clock, length: end - start });
      }
      index += item.length;
    }
    for (const cut of cuts.sort((a, b) => b.index - a.index)) owner.delete(cut.index, cut.length);
  }
}

/** Whether a step of undo has anything left to do: what it made is still there, or it has something to put back. */
function stepDoesAnything(manager: Y.UndoManager, step: { insertions: DeleteSet; deletions: DeleteSet }): boolean {
  const { store } = manager.doc;
  const any = (set: DeleteSet, wanted: (item: Y.Item) => boolean): boolean => {
    for (const [client, ranges] of set.clients) {
      const structs = store.clients.get(client);
      if (!structs) continue;
      for (const range of ranges) {
        for (let i = Y.findIndexSS(structs, range.clock); i < structs.length; i += 1) {
          const struct = structs[i];
          if (!struct || struct.id.clock >= range.clock + range.len) break;
          if (struct instanceof Y.Item && wanted(struct)) return true;
        }
      }
    }
    return false;
  };
  return any(step.insertions, (item) => item.redone !== null || (!item.deleted && manager.deleteFilter(item)))
    || any(step.deletions, (item) => !Y.isDeleted(step.insertions, item.id));
}

/**
 * Takes off the top of undo what someone else has already taken away: words in a block they deleted, say. Yjs would skip
 * those and take back whatever's next, which may be something older, anywhere in the document. Returns whether it did.
 */
export function dropSpentSteps(manager: Y.UndoManager): boolean {
  let dropped = false;
  for (let step = manager.undoStack.at(-1); step && !stepDoesAnything(manager, step); step = manager.undoStack.at(-1)) {
    manager.undoStack.pop();
    dropped = true;
  }
  return dropped;
}
