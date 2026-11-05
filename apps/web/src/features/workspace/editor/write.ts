/*
 * What ProseMirror's document becomes in Yjs: y-prosemirror's `updateYFragment`, from the version pinned in package.json,
 * with one rule added. A text is never deleted, only the words in it. Whatever reaches a deleted text is lost on every
 * browser, which is what @alcove/api/retire is for, and y-prosemirror only spares a text that's alone in its line, so a line
 * with a tag or a line break in it lost whatever anyone was typing as someone cleared it. Between blocks, this is
 * `updateYFragment` as it was, and it's kept close to it to stay comparable.
 *
 * Inside a line, the two sides are read as one run of letters, with anything that isn't text as one letter, and only the
 * stretch that differs is written. So taking out a tag touches no words at all, and leaves the texts either side of it next
 * to each other. A line can hold any number of texts, empty ones included: an empty text is nothing to ProseMirror, and
 * texts side by side are one run of words to it.
 *
 * What this writes never needs a text to be made while someone else may be making the same one: a new line starts with an
 * empty text in it, and whatever isn't text has one either side. Two texts made at once in one place would sit side by side,
 * and y-prosemirror's reader merges those by deleting one (its #160), in the one browser that made it.
 */
import { encodeAny, toBase64 } from 'lib0/buffer';
import { digest } from 'lib0/hash/sha256';
import type { Mark, MarkType, Node as PMNode } from 'prosemirror-model';
import { ySyncPluginKey, type absolutePositionToRelativePosition } from 'y-prosemirror';
import * as Y from 'yjs';

/** y-prosemirror's record of which node each element is. Texts have no entry here: nothing needs one. */
export type ProsemirrorMapping = Parameters<typeof absolutePositionToRelativePosition>[2];

/** What's kept between writes: the record, and which marks can overlap themselves. */
export interface WriteMeta { mapping: ProsemirrorMapping; isOMark: Map<MarkType, boolean> }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== null);
  return keys.length === Object.keys(b).filter((key) => b[key] !== null).length && keys.every((key) => sameValue(a[key], b[key]));
}

/** Attributes hold more than the strings Yjs's types say they do. */
interface Attributed { setAttribute(key: string, value: unknown): void }
export const setAttr = (element: Attributed, key: string, value: unknown): void => { element.setAttribute(key, value); };

const defaultOf = (node: PMNode, key: string): unknown => node.type.spec.attrs?.[key]?.default;

/** An attribute a node has only because it has to have one is the same as none, so a retired block never has its defaults written back. */
const sameAttr = (written: unknown, wanted: unknown, blank: unknown): boolean => (
  written === undefined || written === null ? wanted === undefined || wanted === null || sameValue(wanted, blank) : sameValue(written, wanted)
);

function sameAttrs(element: Y.XmlElement, node: PMNode): boolean {
  const written: Record<string, unknown> = element.getAttributes();
  for (const key of new Set([...Object.keys(written), ...Object.keys(node.attrs)])) {
    if (!sameAttr(written[key], node.attrs[key], defaultOf(node, key))) return false;
  }
  return true;
}

function writeAttrs(element: Y.XmlElement, node: PMNode): void {
  const written: Record<string, unknown> = element.getAttributes();
  for (const [key, value] of Object.entries<unknown>(node.attrs)) {
    if (value === null) element.removeAttribute(key);
    else if (!sameAttr(written[key], value, defaultOf(node, key))) setAttr(element, key, value);
  }
  for (const key of Object.keys(written)) if (node.attrs[key] === undefined) element.removeAttribute(key);
}

/** y-prosemirror's `hashOfJSON`: a mark that can overlap itself is stored under its name and this, so two of them can share a letter. */
function hashOf(mark: Mark): string {
  const hash = digest(encodeAny(mark.toJSON()));
  for (let i = 6; i < hash.length; i += 1) hash[i % 6] = (hash[i % 6] ?? 0) ^ (hash[i] ?? 0);
  return toBase64(hash.slice(0, 6));
}

function attributesOf(marks: readonly Mark[], meta: WriteMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const mark of marks) {
    let overlaps = meta.isOMark.get(mark.type);
    if (overlaps === undefined) {
      overlaps = !mark.type.excludes(mark.type);
      meta.isOMark.set(mark.type, overlaps);
    }
    out[overlaps ? `${mark.type.name}--${hashOf(mark)}` : mark.type.name] = mark.attrs;
  }
  return out;
}

/* -------- making what isn't there yet */
function makeText(nodes: readonly PMNode[], meta: WriteMeta): Y.XmlText {
  const text = new Y.XmlText();
  text.applyDelta(nodes.map((node) => ({ insert: node.text ?? '', attributes: attributesOf(node.marks, meta) })));
  return text;
}

function makeElement(node: PMNode, meta: WriteMeta): Y.XmlElement {
  const element = new Y.XmlElement(node.type.name);
  for (const [key, value] of Object.entries<unknown>(node.attrs)) if (value !== null) setAttr(element, key, value);
  element.insert(0, makeContent(node, meta));
  meta.mapping.set(element, node);
  return element;
}

/** What's in a new element: in a line, always a text first and last, and between any two things that aren't text. */
function makeContent(node: PMNode, meta: WriteMeta): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  let run: PMNode[] = [];
  const endRun = () => { out.push(makeText(run, meta)); run = []; };
  node.forEach((child) => {
    if (child.isText) { run.push(child); return; }
    if (node.inlineContent) endRun();
    out.push(makeElement(child, meta));
  });
  if (node.inlineContent) endRun();
  return out;
}

/* -------- a line, as one run of letters */
/** Stands for anything in a line that isn't text, so offsets count the way ProseMirror's do. */
const OBJECT = '￼';

/** A line's letters, and where in them what isn't text is. */
interface Flat<T> { words: string; objects: Map<number, T> }

const lettersOf = (text: Y.XmlText): string => text.toDelta().map((part: { insert?: unknown }) => (typeof part.insert === 'string' ? part.insert : OBJECT)).join('');

function flatElement(children: readonly unknown[]): Flat<Y.XmlElement> {
  const objects = new Map<number, Y.XmlElement>();
  let words = '';
  for (const child of children) {
    if (child instanceof Y.XmlText) words += lettersOf(child);
    else if (child instanceof Y.XmlElement) {
      objects.set(words.length, child);
      words += OBJECT;
    }
  }
  return { words, objects };
}

function flatNode(node: PMNode): Flat<PMNode> {
  const objects = new Map<number, PMNode>();
  let words = '';
  node.forEach((child) => {
    if (child.isText) words += child.text ?? '';
    else {
      objects.set(words.length, child);
      words += OBJECT;
    }
  });
  return { words, objects };
}

function sameObject(element: Y.XmlElement | undefined, node: PMNode | undefined, meta: WriteMeta): boolean {
  if (element === undefined || node === undefined) return element === node;
  return meta.mapping.get(element) === node || sameElement(element, node, meta);
}

const isHighHalf = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowHalf = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** How much of two lines is the same from each end. Never between the two halves of a character. */
function commonEnds(was: Flat<Y.XmlElement>, now: Flat<PMNode>, meta: WriteMeta): { left: number; right: number } {
  const plain = was.objects.size === 0 && now.objects.size === 0;
  const same = (i: number, j: number) => was.words.charCodeAt(i) === now.words.charCodeAt(j) && (plain || sameObject(was.objects.get(i), now.objects.get(j), meta));
  const shorter = Math.min(was.words.length, now.words.length);
  let left = 0;
  while (left < shorter && same(left, left)) left += 1;
  if (left > 0 && isHighHalf(was.words.charCodeAt(left - 1))) left -= 1;
  let right = 0;
  while (left + right < shorter && same(was.words.length - 1 - right, now.words.length - 1 - right)) right += 1;
  if (right > 0 && isLowHalf(was.words.charCodeAt(was.words.length - right))) right -= 1;
  return { left, right };
}

const sizeOf = (child: unknown): number => (child instanceof Y.XmlText ? child.length : child instanceof Y.XmlElement ? 1 : 0);

/** Takes a stretch out of a line. Its texts stay, with their words gone. */
function takeOut(line: Y.XmlFragment, from: number, to: number, meta: WriteMeta): void {
  const children = line.toArray();
  const spans: { start: number; end: number }[] = [];
  let at = 0;
  for (const child of children) {
    spans.push({ start: at, end: at + sizeOf(child) });
    at += sizeOf(child);
  }
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i], span = spans[i];
    if (!child || !span) continue;
    const start = Math.max(from, span.start), end = Math.min(to, span.end);
    if (start >= end) continue;
    if (child instanceof Y.XmlText) child.delete(start - span.start, end - start);
    else {
      meta.mapping.delete(child);
      line.delete(i, 1);
    }
  }
}

/** What's new in a line, in order: words, and what isn't text. */
function partsBetween(now: Flat<PMNode>, from: number, to: number): (string | PMNode)[] {
  const out: (string | PMNode)[] = [];
  let at = from;
  for (let i = from; i < to; i += 1) {
    const object = now.objects.get(i);
    if (!object) continue;
    if (i > at) out.push(now.words.slice(at, i));
    out.push(object);
    at = i + 1;
  }
  if (to > at) out.push(now.words.slice(at, to));
  return out;
}

/** Where a place in a line is: the first text it's in, if any, and which child of the line comes after it if it isn't in one. */
function spotIn(children: readonly unknown[], place: number): { text: Y.XmlText | null; within: number; index: number } {
  let at = 0, index = 0;
  for (const child of children) {
    if (child instanceof Y.XmlText && place <= at + child.length) return { text: child, within: place - at, index };
    if (place === at) break;
    at += sizeOf(child);
    index += 1;
  }
  return { text: null, within: 0, index };
}

/** Puts what's new into a line at `place`. It goes into the text that's there. Only something that isn't text in the middle of one divides it, and then what's after it is written again after that. */
function putIn(line: Y.XmlFragment, place: number, parts: (string | PMNode)[], meta: WriteMeta): void {
  if (parts.length === 0) return;
  const children = line.toArray();
  const { text, within, index } = spotIn(children, place);
  const first = parts[0], last = parts.at(-1);
  if (parts.length === 1 && typeof first === 'string') {
    if (text) text.insert(within, first);
    else line.insert(index, [new Y.XmlText(first)]);
    return;
  }
  const opening = typeof first === 'string' ? first : '';
  const closing = typeof last === 'string' ? last : '';
  /* Between the words either side, what isn't text goes in with a text between each. */
  const between: (Y.XmlElement | Y.XmlText)[] = [];
  let previous: string | PMNode | null = null;
  for (const part of parts.slice(typeof first === 'string' ? 1 : 0, typeof last === 'string' ? -1 : undefined)) {
    if (typeof part === 'string') between.push(new Y.XmlText(part));
    else {
      if (previous !== null && typeof previous !== 'string') between.push(new Y.XmlText());
      between.push(makeElement(part, meta));
    }
    previous = part;
  }
  /* At the very start of a text, it all goes in front and the text stays as it is. */
  if (text && within === 0 && text.length > 0) {
    line.insert(index, [new Y.XmlText(opening), ...between]);
    if (closing) text.insert(0, closing);
    return;
  }
  const tail = text ? lettersOf(text).slice(within) : '';
  if (text) {
    if (tail) text.delete(within, tail.length);
    if (opening) text.insert(within, opening);
  }
  const after = text ? index + 1 : index;
  const next = children[after];
  const words = closing + tail;
  if (next instanceof Y.XmlText) {
    if (words) next.insert(0, words);
    line.insert(after, text ? between : [new Y.XmlText(opening), ...between]);
  } else line.insert(after, [...(text ? [] : [new Y.XmlText(opening)]), ...between, new Y.XmlText(words)]);
}

/** A stretch of a text and its marks. */
interface Span { length: number; attributes: Record<string, unknown> }

const spansOf = (text: Y.XmlText): Span[] => text.toDelta().map((part: { insert?: unknown; attributes?: Record<string, unknown> }) => ({
  length: typeof part.insert === 'string' ? part.insert.length : 1, attributes: part.attributes ?? {}
}));

/** The marks ProseMirror has on each text of a line that says what it says. */
function wantedSpans(texts: readonly Y.XmlText[], node: PMNode, meta: WriteMeta): Span[][] {
  const runs: PMNode[] = [];
  node.forEach((child) => { if (child.isText) runs.push(child); });
  let run = 0, used = 0;
  return texts.map((text) => {
    const spans: Span[] = [];
    let left = text.length;
    while (left > 0) {
      const part = runs[run];
      if (!part) break;
      const length = Math.min(left, part.nodeSize - used);
      spans.push({ length, attributes: attributesOf(part.marks, meta) });
      left -= length;
      used += length;
      if (used === part.nodeSize) { run += 1; used = 0; }
    }
    return spans;
  });
}

const sameSpans = (a: readonly Span[], b: readonly Span[]): boolean => a.length === b.length && a.every((span, i) => span.length === b[i]?.length && sameValue(span.attributes, b[i]?.attributes));

const textsIn = (children: readonly unknown[]): Y.XmlText[] => children.flatMap((child) => (child instanceof Y.XmlText ? [child] : []));

function writeMarks(text: Y.XmlText, spans: readonly Span[]): void {
  const clear: Record<string, null> = {};
  for (let item = text._start; item !== null; item = item.right) if (!item.deleted && item.content instanceof Y.ContentFormat) clear[item.content.key] = null;
  text.applyDelta(spans.map((span) => ({ retain: span.length, attributes: { ...clear, ...span.attributes } })));
}

function writeLine(line: Y.XmlFragment, node: PMNode, meta: WriteMeta): void {
  const was = flatElement(line.toArray()), now = flatNode(node);
  const { left, right } = commonEnds(was, now, meta);
  takeOut(line, left, was.words.length - right, meta);
  putIn(line, left, partsBetween(now, left, now.words.length - right), meta);
  const children = line.toArray();
  const texts = textsIn(children);
  wantedSpans(texts, node, meta).forEach((spans, i) => {
    const text = texts[i];
    if (text && !sameSpans(spansOf(text), spans)) writeMarks(text, spans);
  });
  const objects = [...now.objects.values()];
  let at = 0;
  for (const child of children) {
    if (!(child instanceof Y.XmlElement)) continue;
    const object = objects[at];
    if (object) meta.mapping.set(child, object);
    at += 1;
  }
}

function sameLine(line: Y.XmlElement, node: PMNode, meta: WriteMeta): boolean {
  const children = line.toArray();
  const was = flatElement(children), now = flatNode(node);
  if (was.words !== now.words || was.objects.size !== now.objects.size) return false;
  for (const [at, element] of was.objects) if (!sameObject(element, now.objects.get(at), meta)) return false;
  const texts = textsIn(children);
  return wantedSpans(texts, node, meta).every((spans, i) => { const text = texts[i]; return text !== undefined && sameSpans(spansOf(text), spans); });
}

/** Whether an element says exactly what a node says. */
function sameElement(element: Y.XmlElement, node: PMNode, meta: WriteMeta): boolean {
  if (element.nodeName !== node.type.name || !sameAttrs(element, node)) return false;
  if (node.inlineContent) return sameLine(element, node, meta);
  const children = element.toArray();
  return children.length === node.childCount && children.every((child, i) => child instanceof Y.XmlElement && sameElement(child, node.child(i), meta));
}

/* -------- between blocks: `updateYFragment` as it was */
/** The same thing, as far as anyone can tell, and the record says so from here on. */
function matches(child: unknown, node: PMNode, meta: WriteMeta): boolean {
  if (!(child instanceof Y.XmlElement)) return false;
  if (meta.mapping.get(child) === node) return true;
  if (!sameElement(child, node, meta)) return false;
  meta.mapping.set(child, node);
  return true;
}

/** Words and what isn't text, for telling how alike two blocks are. */
function partsOfElement(element: Y.XmlElement): (string | Y.XmlElement)[] {
  const out: (string | Y.XmlElement)[] = [];
  for (const child of element.toArray()) {
    const end = out.at(-1);
    if (child instanceof Y.XmlElement) out.push(child);
    else if (child instanceof Y.XmlText && child.length > 0) {
      if (typeof end === 'string') out[out.length - 1] = end + lettersOf(child);
      else out.push(lettersOf(child));
    }
  }
  return out;
}

function partsOfNode(node: PMNode): (string | PMNode)[] {
  const out: (string | PMNode)[] = [];
  node.forEach((child) => {
    const end = out.at(-1);
    if (!child.isText) out.push(child);
    else if (typeof end === 'string') out[out.length - 1] = end + (child.text ?? '');
    else out.push(child.text ?? '');
  });
  return out;
}

/** y-prosemirror's `computeChildEqualityFactor`: how much of a block already says what a node says, and whether any of it is known to be the same. */
function likeness(element: Y.XmlElement, node: PMNode, meta: WriteMeta): { same: number; known: boolean } {
  const ys = partsOfElement(element), ps = partsOfNode(node);
  const least = Math.min(ys.length, ps.length);
  let left = 0, right = 0, known = false;
  const alike = (y: string | Y.XmlElement | undefined, p: string | PMNode | undefined): boolean => {
    if (typeof y === 'string' || typeof p === 'string') return y === p;
    if (y !== undefined && p !== undefined && meta.mapping.get(y) === p) { known = true; return true; }
    return sameObject(y, p, meta);
  };
  while (left < least && alike(ys[left], ps[left])) left += 1;
  while (left + right < least && alike(ys[ys.length - right - 1], ps[ps.length - right - 1])) right += 1;
  return { same: left + right, known };
}

const sameName = (child: unknown, node: PMNode): child is Y.XmlElement => child instanceof Y.XmlElement && child.nodeName === node.type.name;

function writeBlocks(parent: Y.XmlFragment, node: PMNode, meta: WriteMeta): void {
  const ys = parent.toArray();
  const ps: PMNode[] = [];
  node.forEach((child) => ps.push(child));
  const yCount = ys.length, pCount = ps.length;
  const least = Math.min(yCount, pCount);
  const at = (i: number): PMNode => {
    const child = ps[i];
    if (!child) throw new RangeError('A block counted is a block that’s there');
    return child;
  };
  let left = 0, right = 0;
  while (left < least && matches(ys[left], at(left), meta)) left += 1;
  while (left + right < least && matches(ys[yCount - right - 1], at(pCount - right - 1), meta)) right += 1;
  while (yCount - left - right > 0 && pCount - left - right > 0) {
    const leftY = ys[left], rightY = ys[yCount - right - 1];
    const leftP = at(left), rightP = at(pCount - right - 1);
    if (matches(leftY, leftP, meta)) { left += 1; continue; }
    if (matches(rightY, rightP, meta)) { right += 1; continue; }
    let updateLeft = sameName(leftY, leftP);
    let updateRight = sameName(rightY, rightP);
    if (sameName(leftY, leftP) && sameName(rightY, rightP)) {
      const a = likeness(leftY, leftP, meta), b = likeness(rightY, rightP, meta);
      if (a.known && !b.known) updateRight = false;
      else if (!a.known && b.known) updateLeft = false;
      else if (a.same < b.same) updateLeft = false;
      else updateRight = false;
    }
    if (updateLeft && sameName(leftY, leftP)) {
      write(leftY, leftP, meta);
      left += 1;
    } else if (updateRight && sameName(rightY, rightP)) {
      write(rightY, rightP, meta);
      right += 1;
    } else {
      if (leftY) meta.mapping.delete(leftY);
      parent.delete(left, 1);
      parent.insert(left, [makeElement(leftP, meta)]);
      left += 1;
    }
  }
  const extra = yCount - left - right;
  if (extra > 0) {
    for (const child of ys.slice(left, left + extra)) meta.mapping.delete(child);
    parent.delete(left, extra);
  }
  if (left + right < pCount) parent.insert(left, ps.slice(left, pCount - right).map((child) => makeElement(child, meta)));
}

function write(type: Y.XmlFragment, node: PMNode, meta: WriteMeta): void {
  if (type instanceof Y.XmlElement) writeAttrs(type, node);
  if (node.inlineContent) writeLine(type, node, meta);
  else writeBlocks(type, node, meta);
  /* Last, so that if this fails, writing again doesn't take it as done. */
  meta.mapping.set(type, node);
}

/** Makes a document's blocks say what `node` says, writing only what differs. */
export function writeDocument(doc: Y.Doc, fragment: Y.XmlFragment, node: PMNode, meta: WriteMeta): void {
  doc.transact(() => { write(fragment, node, meta); }, ySyncPluginKey);
}
