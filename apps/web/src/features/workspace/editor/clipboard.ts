/*
 * The clipboard, both ways. Out: the flat blocks become real lists and clean HTML, and plain text keeps the typed
 * shortcuts, so a list stays a list wherever it lands. In: what comes from Word, Google Docs, Notion and the web is
 * turned into plain HTML first (nested lists flattened, paragraphs in a cell joined), and the schema's rules read that.
 */
import { MAX_DOC_BYTES, MAX_DOC_ITEMS, MAX_DOC_UPDATE_BYTES } from '@alcove/api';
import { itemsOnPage, newBlockId } from '@alcove/api/retire';
import { DOMSerializer, Fragment, Slice, type DOMOutputSpec, type Node as PMNode, type ResolvedPos } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import * as Y from 'yjs';
import { galleryItems, liveLines, mediaIn } from './blocks/attrs';
import { dateLabel } from './blocks/dates';
import { allBlocks, countLine, isBlank, selectedBlock } from './commands';
import type { EditorRuntime } from './runtime';
import { headingLevel, indentAttr, isGone, lineKind, MAX_INDENT, safeHref, schema, textAttr } from './schema';
import type { InsertAt } from './types';

const n = schema.nodes;
const CANT_OPEN = 'A document you can’t open';
const CANT_OPEN_BOARD = 'A board you can’t open';

/* -------- out, as HTML */

/** Consecutive list lines become one list, with their indents as nested lists. */
function buildLists(root: DocumentFragment): void {
  const doc = root.ownerDocument;
  let open: { indent: number; kind: string; list: HTMLElement }[] = [];
  for (const line of [...root.childNodes]) {
    if (!(line instanceof HTMLElement) || !line.hasAttribute('data-list')) { open = []; continue; }
    const kind = line.getAttribute('data-list') ?? 'bullet';
    const indent = Number(line.getAttribute('data-indent') ?? 0);
    while (open.length > 0 && (open.at(-1)?.indent ?? 0) > indent) open.pop();
    if (open.at(-1)?.indent === indent && open.at(-1)?.kind !== kind) open.pop();
    let top = open.at(-1);
    if (!top || top.indent < indent) {
      const list = doc.createElement(kind === 'numbered' ? 'ol' : 'ul');
      if (kind === 'todo') list.setAttribute('data-list', 'todo');
      const holder = top?.list.lastElementChild;
      if (holder) holder.append(list);
      else if (top) top.list.append(list);
      else root.insertBefore(list, line);
      top = { indent, kind, list };
      open.push(top);
    }
    top.list.append(line);
    line.removeAttribute('data-indent');
    line.removeAttribute('data-list');
    if (kind === 'todo') {
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.disabled = true;
      box.checked = line.getAttribute('data-done') === 'true';
      if (box.checked) box.setAttribute('checked', '');
      line.prepend(box, ' ');
      line.removeAttribute('data-done');
    }
  }
}

class CleanSerializer extends DOMSerializer {
  override serializeFragment(fragment: Fragment, options?: { document?: Document }, target?: HTMLElement | DocumentFragment): HTMLElement | DocumentFragment {
    const out = super.serializeFragment(fragment, options, target);
    if (!target && out instanceof DocumentFragment) buildLists(out);
    return out;
  }
}

/** Comments stay in the document. A tag to a document says its name, if this reader may know it. */
export function cleanSerializer(rt: EditorRuntime): DOMSerializer {
  const name = (doc: string) => rt.props.documentName?.(doc) ?? CANT_OPEN;
  const nodes: Record<string, (node: PMNode) => DOMOutputSpec> = {
    ...DOMSerializer.nodesFromSchema(schema),
    docref: (node) => { const doc = textAttr(node, 'doc') ?? ''; return ['span', { 'data-docref': doc }, name(doc)]; },
    dateChip: (node) => { const date = textAttr(node, 'date') ?? ''; return ['time', { 'data-chip': '', datetime: date }, dateLabel(date)]; },
    doclink: (node) => { const doc = textAttr(node, 'doc') ?? ''; return ['p', { 'data-alcove-block': 'doclink', 'data-attrs': JSON.stringify({ doc }) }, name(doc)]; },
    board: (node) => { const board = textAttr(node, 'board') ?? ''; return ['p', { 'data-alcove-block': 'board', 'data-attrs': JSON.stringify({ board }) }, rt.props.documentName?.(board) ?? CANT_OPEN_BOARD]; }
  };
  const { comment: _comment, ...marks } = DOMSerializer.marksFromSchema(schema);
  return new CleanSerializer(nodes, marks);
}

/** What's copied is what's on the page. */
export function transformCopied(slice: Slice): Slice {
  const nodes: PMNode[] = [];
  slice.content.forEach((node) => { if (!isGone(node)) nodes.push(node); });
  return nodes.length === slice.content.childCount ? slice : new Slice(Fragment.fromArray(nodes), slice.openStart, slice.openEnd);
}

/* -------- out, as text */

function inlineText(node: PMNode, rt: EditorRuntime): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) out += child.text ?? '';
    else if (child.type === n.hardBreak) out += '\n';
    else if (child.type === n.mention) out += textAttr(child, 'name') ?? '';
    else if (child.type === n.dateChip) out += dateLabel(textAttr(child, 'date') ?? '');
    else if (child.type === n.docref) out += rt.props.documentName?.(textAttr(child, 'doc') ?? '') ?? CANT_OPEN;
  });
  return out;
}

function blockText(node: PMNode, rt: EditorRuntime, number: number, marked: boolean): string[] {
  const text = inlineText(node, rt);
  const pad = '  '.repeat(indentAttr(node));
  switch (lineKind(node)) {
    case 'heading': return [marked ? `${'#'.repeat(headingLevel(node))} ${text}` : text];
    case 'bullet': return [marked ? `${pad}- ${text}` : text];
    case 'numbered': return [marked ? `${pad}${number}. ${text}` : text];
    case 'todo': return [marked ? `${pad}[${node.attrs['done'] === true ? 'x' : ' '}] ${text}` : text];
    case 'quote': return [marked ? `> ${text}` : text];
    default: break;
  }
  switch (node.type.name) {
    case 'divider': return ['---'];
    case 'toggle': return [inlineText(node.child(0), rt), inlineText(node.child(1), rt)].filter(Boolean);
    case 'table': {
      const rows: string[] = [];
      node.forEach((row) => { const cells: string[] = []; row.forEach((cell) => cells.push(inlineText(cell, rt))); rows.push(cells.join('\t')); });
      return rows;
    }
    case 'gallery': return galleryItems(node).map((i) => i.cap || i.name);
    case 'file': return [textAttr(node, 'name') ?? ''];
    case 'video': return [textAttr(node, 'title') ?? ''];
    case 'doclink': return [rt.props.documentName?.(textAttr(node, 'doc') ?? '') ?? CANT_OPEN];
    case 'board': return [rt.props.documentName?.(textAttr(node, 'board') ?? '') ?? CANT_OPEN_BOARD];
    case 'live': return liveLines(node).map((l) => l.text);
    case 'moment': return [`“${textAttr(node, 'text') ?? ''}” ${textAttr(node, 'name') ?? ''}, ${textAttr(node, 'at') ?? ''}`];
    default: return [text];
  }
}

/** Plain text, with the same marks you'd type. A few words from inside a line are just those words. */
export function sliceText(rt: EditorRuntime, slice: Slice): string {
  const marked = slice.content.childCount > 1 || slice.openStart === 0;
  const lines: string[] = [];
  const counts = [0, 0, 0];
  slice.content.forEach((node) => { lines.push(...blockText(node, rt, countLine(counts, node) ?? 1, marked)); });
  return lines.join('\n');
}

/* -------- in, from HTML */

const isList = (node: Node): node is HTMLElement => node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL');
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR', 'UL', 'OL', 'DETAILS', 'SECTION', 'ARTICLE', 'ASIDE', 'FIGURE']);
const isBlock = (node: Node): node is HTMLElement => node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName);
const TEXT_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE']);

/** Takes an element out and keeps what was in it. */
function unwrap(el: Element): void { el.replaceWith(...el.childNodes); }

/** A line's checkbox, wherever the source put it, or null for a line that isn't one. */
function checkOf(li: HTMLElement): boolean | null {
  const role = li.getAttribute('role');
  if (role === 'checkbox') return li.getAttribute('aria-checked') === 'true';
  const input = li.querySelector('input[type="checkbox"]');
  if (input instanceof HTMLInputElement) {
    const checked = input.hasAttribute('checked') || input.checked;
    input.remove();
    return checked;
  }
  if (li.hasAttribute('data-done')) return li.getAttribute('data-done') === 'true';
  const box = li.querySelector('.checkbox');
  if (box) {
    const on = box.classList.contains('checkbox-on');
    box.remove();
    return on;
  }
  /* Notion and others write the box as text. */
  const first = li.firstChild;
  const typed = first?.nodeType === Node.TEXT_NODE ? /^\s*\[( |x|X)\]\s/.exec(first.textContent ?? '') : null;
  if (typed && first) {
    first.textContent = (first.textContent ?? '').slice(typed[0].length);
    return typed[1] !== ' ';
  }
  return null;
}

function flatLine(doc: Document, kind: string, indent: number, done: boolean): HTMLElement {
  const line = doc.createElement('div');
  line.setAttribute('data-alcove', kind);
  line.setAttribute('data-indent', String(Math.min(MAX_INDENT, indent)));
  if (done) line.setAttribute('data-done', 'true');
  return line;
}

/** A list, at any depth, as flat lines. Other blocks inside a line come out beside it. */
function flatten(list: HTMLElement, indent: number, out: Element[]): void {
  const doc = list.ownerDocument;
  const base = list.tagName === 'OL' ? 'numbered' : 'bullet';
  for (const child of [...list.childNodes]) {
    if (isList(child)) { flatten(child, indent + 1, out); continue; }
    if (!(child instanceof HTMLElement) || child.tagName !== 'LI') {
      /* What a list holds outside a line still says something. */
      if (!(child.textContent ?? '').trim()) continue;
      const stray = flatLine(doc, base, indent, false);
      if (child instanceof Element && isBlock(child)) stray.append(...child.childNodes);
      else stray.append(child);
      out.push(stray);
      continue;
    }
    const check = checkOf(child);
    const kind = check === null ? base : 'todo';
    let line: HTMLElement | null = flatLine(doc, kind, indent, check === true);
    out.push(line);
    for (const node of [...child.childNodes]) {
      if (isList(node)) { flatten(node, indent + 1, out); line = null; continue; }
      if (isBlock(node) && TEXT_TAGS.has(node.tagName)) {
        /* A second paragraph in a line becomes a line of its own. */
        if (!line || line.hasChildNodes()) { line = flatLine(doc, kind, indent, false); out.push(line); }
        line.append(...node.childNodes);
        continue;
      }
      if (isBlock(node)) { out.push(node); line = null; continue; }
      if (!line) {
        if (!(node.textContent ?? '').trim()) continue;
        line = flatLine(doc, kind, indent, false);
        out.push(line);
      }
      line.append(node);
    }
  }
}

function flattenLists(root: HTMLElement): void {
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    if (!(list instanceof HTMLElement) || !list.isConnected || list.parentElement?.closest('ul, ol')) continue;
    const out: Element[] = [];
    flatten(list, 0, out);
    /* Where ProseMirror left its note on how the copy was cut. */
    const slice = list.getAttribute('data-pm-slice');
    if (slice !== null) out[0]?.setAttribute('data-pm-slice', slice);
    list.replaceWith(...out);
  }
}

/** Word's lists are paragraphs with a typed marker. */
function wordLists(root: HTMLElement): void {
  const doc = root.ownerDocument;
  for (const p of [...root.querySelectorAll('p')]) {
    const style = p.getAttribute('style') ?? '';
    if (!style.includes('mso-list') && !p.className.startsWith('MsoListParagraph')) continue;
    const level = Number(/level(\d+)/.exec(style)?.[1] ?? 1);
    const marker = [...p.querySelectorAll('span')].find((s) => (s.getAttribute('style') ?? '').replace(/\s/g, '').includes('mso-list:Ignore'));
    const ordered = /^\s*(\d+|[a-zA-Z]{1,4})[.)]/.test(marker?.textContent ?? '');
    marker?.remove();
    const line = flatLine(doc, ordered ? 'numbered' : 'bullet', level - 1, false);
    line.append(...p.childNodes);
    p.replaceWith(line);
  }
}

/** Word's named styles, as what they mean. */
function wordStyles(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const named: [string, string][] = [['MsoTitle', 'h1'], ['MsoSubtitle', 'h2'], ['MsoQuote', 'blockquote'], ['MsoIntenseQuote', 'blockquote']];
  for (const [name, tag] of named) {
    for (const p of [...root.querySelectorAll(`p.${name}`)]) {
      const el = doc.createElement(tag);
      el.append(...p.childNodes);
      p.replaceWith(el);
    }
  }
}

/** What Word and others leave lying about. */
function stripJunk(root: HTMLElement): void {
  for (const el of [...root.querySelectorAll('style, script, meta, link, title, xml')]) el.remove();
  for (const el of [...root.querySelectorAll('*')]) if (el.tagName.includes(':')) unwrap(el);
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
  /* Word's blank line, which is no line at all here. */
  for (const p of [...root.querySelectorAll('p.MsoNormal')]) if (!(p.textContent ?? '').replace(/ /g, ' ').trim() && !p.querySelector('img')) p.remove();
}

/** Joins what's in `el` onto lines, for places that hold one text. */
function joinBlocks(el: HTMLElement): void {
  const doc = el.ownerDocument;
  const parts = [...el.childNodes].filter((c) => isBlock(c));
  parts.forEach((part, i) => {
    if (i > 0) part.parentNode?.insertBefore(doc.createElement('br'), part);
    if (part instanceof Element) unwrap(part);
  });
}

function tables(root: HTMLElement): void {
  for (const cell of [...root.querySelectorAll('td, th')]) if (cell instanceof HTMLElement) joinBlocks(cell);
}

function toggles(root: HTMLElement): void {
  const doc = root.ownerDocument;
  for (const details of [...root.querySelectorAll('details')]) {
    const summary = details.querySelector(':scope > summary');
    const body = doc.createElement('div');
    body.setAttribute('data-alcove', 'body');
    for (const node of [...details.childNodes]) if (node !== summary) body.append(node);
    joinBlocks(body);
    details.append(body);
    if (!summary) details.prepend(doc.createElement('summary'));
  }
}

/**
 * A quote of several paragraphs is several quotes: a block holds one text. Words sitting straight in the quote, as they do
 * in an email, are a quote of their own, and what can't be in a line, like a list or a table, comes out beside it.
 */
function quotes(root: HTMLElement): void {
  const doc = root.ownerDocument;
  for (const quote of [...root.querySelectorAll('blockquote')]) {
    /* Already one text, which may be a block of ours written as a quote. */
    if (![...quote.childNodes].some(isBlock)) continue;
    const out: Node[] = [];
    let words: HTMLElement | null = null;
    for (const child of [...quote.childNodes]) {
      if (isBlock(child)) {
        words = null;
        if (TEXT_TAGS.has(child.tagName)) { const q = doc.createElement('blockquote'); q.append(...child.childNodes); out.push(q); }
        else out.push(child);
      } else if (words) words.append(child);
      else if ((child.textContent ?? '').trim()) {
        words = doc.createElement('blockquote');
        words.append(child);
        out.push(words);
      }
    }
    quote.replaceWith(...out);
  }
}

/** What other apps call a callout. */
function callouts(root: HTMLElement): void {
  const doc = root.ownerDocument;
  for (const el of [...root.querySelectorAll('figure.callout, div.callout, [role="note"]')]) {
    const aside = doc.createElement('aside');
    aside.append(...el.childNodes);
    joinBlocks(aside);
    el.replaceWith(aside);
  }
}

export function cleanPastedHTML(html: string): string {
  const { body } = new window.DOMParser().parseFromString(html, 'text/html');
  stripJunk(body);
  wordLists(body);
  wordStyles(body);
  callouts(body);
  toggles(body);
  quotes(body);
  tables(body);
  flattenLists(body);
  return body.innerHTML;
}

/* -------- in, from text */

/** One line of pasted text as a block: the typed shortcuts mean what they mean when typed. */
function lineToBlock(line: string): PMNode {
  const indent = Math.min(MAX_INDENT, Math.floor((/^ */.exec(line)?.[0].length ?? 0) / 2));
  const text = line.trim();
  const content = (s: string) => (s ? schema.text(s) : null);
  const list = /^(?:[-*•]|(\d+[.)]))\s+(.*)$/.exec(text);
  const todo = /^(?:[-*]\s+)?\[( |x|X)?\]\s+(.*)$/.exec(text);
  const heading = /^(#{1,3})\s+(.*)$/.exec(text);
  const quote = /^>\s?(.*)$/.exec(text);
  const id = newBlockId();
  const nested = indent > 0 ? indent : null;
  if (todo) return n.line.create({ id, kind: 'todo', indent: nested, done: todo[1]?.trim() ? true : null }, content(todo[2] ?? ''));
  if (list) return n.line.create({ id, kind: list[1] ? 'numbered' : 'bullet', indent: nested }, content(list[2] ?? ''));
  if (heading) return n.line.create({ id, kind: 'heading', level: heading[1]?.length ?? 1 }, content(heading[2] ?? ''));
  if (quote) return n.line.create({ id, kind: 'quote' }, content(quote[1] ?? ''));
  if (text === '---') return n.divider.create({ id });
  return n.line.create({ id }, content(line));
}

/** Plain text. One line goes into the line you're on; several become blocks. */
export function textToSlice(text: string, $context: ResolvedPos, plain: boolean): Slice {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.at(-1)?.trim() === '') lines.pop();
  if (lines.length <= 1 || $context.parent.type.spec.code) {
    const one = lines.join('\n');
    return one ? new Slice(Fragment.from(schema.text(one, $context.marks())), 0, 0) : Slice.empty;
  }
  /* A table cell or a toggle holds one text: lines stay lines inside it, instead of tearing it in two. */
  if ($context.depth > 1) {
    const parts = lines.flatMap((l, i) => [...(i > 0 ? [n.hardBreak.create()] : []), ...(l ? [schema.text(l, $context.marks())] : [])]);
    return new Slice(Fragment.fromArray(parts), 0, 0);
  }
  const blocks = lines.filter((l) => l.trim() !== '').map((l) => (plain ? n.line.create({ id: newBlockId() }, schema.text(l)) : lineToBlock(l)));
  return Slice.maxOpen(Fragment.fromArray(blocks));
}

/* -------- too much to take in */

/**
 * The most one paste or drop can bring. It goes up as one change, and the API takes as much in one as a document can hold. A
 * line is about 4 items and a cell 5, and undoing a paste is half that again, so these leave room for what's typed around it.
 */
const MAX_PASTE_BLOCKS = 20_000;
const MAX_PASTE_CHARS = 1_000_000;
const MAX_PASTE_BYTES = MAX_DOC_UPDATE_BYTES - 512 * 1024;
/** What a line or a cell comes to besides its words, measured. */
const ITEMS_PER_BLOCK = 5;
const BYTES_PER_BLOCK = 80;

const TOO_MUCH = 'That’s too much to add to this document, so nothing was added. Try a smaller part of it.';

/** Whether a document has room for this much, counted as the API counts it: what's on its page. The API has the last word. */
function hasRoom(doc: Y.Doc, blocks: number, bytes: number): boolean {
  return itemsOnPage(doc) + blocks * ITEMS_PER_BLOCK <= MAX_DOC_ITEMS && Y.encodeStateAsUpdate(doc).length + bytes <= MAX_DOC_BYTES;
}

function fits(rt: EditorRuntime, slice: Slice): boolean {
  const encoder = new TextEncoder();
  let blocks = 0, chars = 0, words = 0;
  slice.content.descendants((node) => {
    if (node.isText) {
      chars += node.text?.length ?? 0;
      words += encoder.encode(node.text).length;
    } else if (node.isTextblock || node.isAtom) blocks += 1;
    return true;
  });
  const bytes = words + blocks * BYTES_PER_BLOCK;
  return blocks <= MAX_PASTE_BLOCKS && chars <= MAX_PASTE_CHARS && bytes <= MAX_PASTE_BYTES && hasRoom(rt.props.doc, blocks, bytes);
}

/** What's been read from the clipboard and doesn't fit. It goes no further: nothing about it reaches the document. */
const refused = new WeakSet<Slice>();

/** Says so, if a paste or a drop was refused, and returns whether it was. What was copied is still on the clipboard. */
export function refuseSlice(rt: EditorRuntime, slice: Slice): boolean {
  if (!refused.delete(slice)) return false;
  rt.props.onToast?.({ icon: 'alert', text: TOO_MUCH });
  return true;
}

/** Refuses what's far too long to be worth reading at all, before reading it. */
export function refuseText(rt: EditorRuntime, event: Event, data: DataTransfer | null): boolean {
  if ((data?.getData('text/plain').length ?? 0) <= MAX_PASTE_CHARS) return false;
  event.preventDefault();
  rt.props.onToast?.({ icon: 'alert', text: TOO_MUCH });
  return true;
}

/* -------- in, whatever it was */

/** Where something pasted goes when it isn't text: under the line, or in its place if it's empty. */
function pasteAt(view: EditorView): InsertAt {
  const ref = selectedBlock(view.state);
  if (!ref?.id) return 'end';
  return isBlank(ref.node) ? { replace: ref.id } : { after: ref.id };
}

/** A pasted link goes on the words selected. With none, it's the link itself. */
function pasteLink(view: EditorView, url: string): boolean {
  const { state } = view;
  const { from, to, empty, $from } = state.selection;
  const href = safeHref(url);
  if (!href || !$from.parent.type.allowsMarkType(schema.marks.link)) return false;
  const link = schema.marks.link.create({ href });
  const tr = empty ? state.tr.insert(from, schema.text(url, [link])) : state.tr.addMark(from, to, link);
  if (empty) tr.setSelection(TextSelection.create(tr.doc, from + url.length)).removeStoredMark(schema.marks.link);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function handlePaste(rt: EditorRuntime, view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  if (refuseSlice(rt, slice)) return true;
  const data = event.clipboardData;
  if (!data) return false;
  const text = data.getData('text/plain').trim();
  /* Word and Excel put a picture of what was copied beside the words: the words are what was meant. */
  const files = [...data.files];
  if (files.length > 0 && !text) {
    if (rt.props.onUpload) rt.props.onUpload(files, pasteAt(view));
    return true;
  }
  return /^https?:\/\/\S+$/i.test(text) ? pasteLink(view, text) : false;
}

/**
 * What's pasted, as what a table cell or a toggle can hold: one text, with its lines as line breaks. Null for what can't go
 * in a line: a photo goes where the schema can fit it, and cells pasted into a table fill the cells around the caret.
 */
function asOneText(content: Fragment): Slice | null {
  const parts: PMNode[] = [];
  let fits = true;
  const add = (node: PMNode) => {
    if (node.type.spec['tableRole'] !== undefined && node.type !== n.table_cell && node.type !== n.table_header) fits = false;
    else if (node.isInline) parts.push(node);
    else if (node.isTextblock) {
      if (parts.length > 0) parts.push(n.hardBreak.create());
      node.forEach((child) => { parts.push(child); });
    } else if (node.isAtom) fits = false;
    else node.forEach(add);
  };
  content.forEach(add);
  return fits ? new Slice(Fragment.fromArray(parts), 0, 0) : null;
}

/** A pasted copy of a block is a new block. A title can't be anywhere but first. A file from elsewhere needs attaching here. */
export function transformPasted(rt: EditorRuntime, slice: Slice, view: EditorView): Slice {
  if (!fits(rt, slice)) {
    refused.add(slice);
    return slice;
  }
  const known = new Set(allBlocks(view.state.doc).flatMap((b) => mediaIn(b.node)));
  const reached = new Set<string>();
  const nodes: PMNode[] = [];
  slice.content.forEach((node) => {
    nodes.push(node.type === n.title ? n.line.create(null, node.content) : node);
    for (const media of mediaIn(node)) if (!known.has(media)) reached.add(media);
  });
  for (const media of reached) rt.props.onAttachMedia?.(media);
  const content = Fragment.fromArray(nodes);
  const { $from, empty } = view.state.selection;
  if ($from.depth > 1 && $from.parent.isTextblock) {
    const text = asOneText(content);
    if (text) return text;
  }
  /* A heading or a list pasted on a blank line stays what it is, instead of pouring its words into the line. */
  const kept = empty && $from.depth === 1 && isBlank($from.parent) && lineKind($from.parent) === null && lineKind(content.firstChild ?? n.line.create()) !== null;
  return new Slice(content, kept ? 0 : slice.openStart, slice.openEnd);
}
