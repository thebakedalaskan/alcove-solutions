/*
 * What a document is made of. Blocks are flat: `doc` is `title block+`, so handles, drag and links stay simple, and
 * lists are flat blocks with an `indent`. `toDOM` here is the clean HTML a document copies out as; on screen every
 * block is drawn by a node view (blocks/views.ts). The Yjs documents the server reads hold these same names and
 * attributes, so changing a name or an attribute's meaning is a change to stored data.
 */
import { Fragment, Schema, type Attrs, type DOMOutputSpec, type MarkSpec, type Mark, type Node as PMNode, type NodeSpec, type NodeType, type TagParseRule } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

type NodeName =
  | 'doc' | 'title' | 'paragraph' | 'heading' | 'bullet' | 'numbered' | 'todo' | 'toggle' | 'toggleSummary' | 'toggleBody' | 'quote' | 'callout'
  | 'divider' | 'code' | 'table' | 'table_row' | 'table_cell' | 'table_header' | 'gallery' | 'file' | 'video' | 'doclink' | 'live' | 'moment'
  | 'unsupported' | 'text' | 'hardBreak' | 'mention' | 'dateChip' | 'docref';
type MarkName = 'bold' | 'italic' | 'strike' | 'inlineCode' | 'link' | 'highlight' | 'comment';

/** Lists go no deeper than this. */
export const MAX_INDENT = 2;

const id = { id: { default: null } };
const indent = { indent: { default: 0 } };

const clampIndent = (n: number) => Math.max(0, Math.min(MAX_INDENT, Number.isFinite(n) ? Math.round(n) : 0));
const indentOf = (el: HTMLElement) => clampIndent(Number(el.getAttribute('data-indent') ?? 0));

/** One flat list line, as clipboard.ts writes it when it flattens a pasted list. */
const listLine = (kind: string): readonly TagParseRule[] => [{ tag: `div[data-alcove="${kind}"]`, getAttrs: (el) => ({ indent: indentOf(el), done: el.getAttribute('data-done') === 'true' }) }];

const tables = tableNodes({ tableGroup: 'block', cellContent: 'inline*', cellAttributes: {} });

/** A number, or nothing. Attributes come from other people's browsers. */
const numberOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The words in a list attribute, for what a block looks like copied out. */
const listOf = (node: PMNode, key: string, field: string): string[] => {
  const list: unknown = node.attrs[key];
  return Array.isArray(list) ? list.flatMap((v: unknown) => { const text = isRecord(v) ? v[field] : null; return typeof text === 'string' && text ? [text] : []; }) : [];
};

/**
 * A block that isn't text copies out as what it says, to anywhere, and carries its attributes for pasting back into
 * a document. Not its ID: a pasted copy is a new block.
 */
function copied(node: PMNode, tag: string, words: string): DOMOutputSpec {
  const { id: _id, ...attrs } = node.attrs;
  return [tag, { 'data-alcove-block': node.type.name, 'data-attrs': JSON.stringify(attrs) }, words];
}

function wholeBlock(name: string): readonly TagParseRule[] {
  return [{
    tag: `[data-alcove-block="${name}"]`,
    getAttrs: (el) => {
      try {
        const attrs: unknown = JSON.parse(el.getAttribute('data-attrs') ?? '{}');
        return isRecord(attrs) ? attrs : false;
      } catch { return false; }
    }
  }];
}

const nodes: Record<NodeName, NodeSpec> = {
  doc: { content: 'title block+' },
  title: { content: 'text*', marks: '', defining: true, toDOM: () => ['h1', 0] },

  /* The first block is what fills a blank line, so it stays first. */
  paragraph: { group: 'block', content: 'inline*', attrs: id, parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
  heading: {
    group: 'block', content: 'inline*', defining: true, attrs: { ...id, level: { default: 1 } },
    parseDOM: [{ tag: 'h1', attrs: { level: 1 } }, { tag: 'h2', attrs: { level: 2 } }, { tag: 'h3', attrs: { level: 3 } }, { tag: 'h4', attrs: { level: 3 } }, { tag: 'h5', attrs: { level: 3 } }, { tag: 'h6', attrs: { level: 3 } }],
    toDOM: (node) => [`h${headingLevel(node)}`, 0]
  },
  bullet: {
    group: 'block', content: 'inline*', defining: true, attrs: { ...id, ...indent }, parseDOM: listLine('bullet'),
    toDOM: (node) => ['li', { 'data-list': 'bullet', 'data-indent': String(indentAttr(node)) }, 0]
  },
  numbered: {
    group: 'block', content: 'inline*', defining: true, attrs: { ...id, ...indent }, parseDOM: listLine('numbered'),
    toDOM: (node) => ['li', { 'data-list': 'numbered', 'data-indent': String(indentAttr(node)) }, 0]
  },
  todo: {
    group: 'block', content: 'inline*', defining: true, attrs: { ...id, ...indent, done: { default: false } }, parseDOM: listLine('todo'),
    toDOM: (node) => ['li', { 'data-list': 'todo', 'data-indent': String(indentAttr(node)), 'data-done': String(node.attrs['done'] === true) }, 0]
  },
  toggle: {
    group: 'block', content: 'toggleSummary toggleBody', defining: true, attrs: { ...id, open: { default: true } },
    parseDOM: [{ tag: 'details', getAttrs: (el) => ({ open: el.hasAttribute('open') }) }],
    toDOM: (node) => ['details', node.attrs['open'] === true ? { open: '' } : {}, 0]
  },
  toggleSummary: { content: 'inline*', defining: true, parseDOM: [{ tag: 'summary' }], toDOM: () => ['summary', 0] },
  toggleBody: { content: 'inline*', parseDOM: [{ tag: 'div[data-alcove="body"]' }], toDOM: () => ['div', { 'data-alcove': 'body' }, 0] },
  quote: { group: 'block', content: 'inline*', defining: true, attrs: id, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
  callout: {
    group: 'block', content: 'inline*', defining: true, attrs: { ...id, icon: { default: 'bulb' } },
    parseDOM: [{ tag: 'aside', getAttrs: (el) => ({ icon: el.getAttribute('data-icon') ?? 'bulb' }) }],
    toDOM: (node) => ['aside', { 'data-icon': textAttr(node, 'icon') ?? 'bulb' }, 0]
  },
  divider: { group: 'block', atom: true, attrs: id, parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
  code: { group: 'block', content: 'text*', marks: '', code: true, defining: true, attrs: id, parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', ['code', 0]] },

  table: { ...tables.table, attrs: id },
  table_row: tables.table_row,
  table_cell: tables.table_cell,
  table_header: tables.table_header,

  /* What can't be typed: drawn from attributes by React, with handlers from the Editor's props. */
  gallery: {
    group: 'block', atom: true, attrs: { ...id, items: { default: [] }, up: { default: null }, failed: { default: null }, width: { default: 100 } },
    parseDOM: wholeBlock('gallery'), toDOM: (node) => copied(node, 'p', listOf(node, 'items', 'cap').join(' · '))
  },
  file: {
    group: 'block', atom: true, attrs: { ...id, media: { default: null }, name: { default: '' }, size: { default: null }, up: { default: null }, failed: { default: null } },
    parseDOM: wholeBlock('file'), toDOM: (node) => copied(node, 'p', textAttr(node, 'name') ?? '')
  },
  video: {
    group: 'block', atom: true,
    attrs: { ...id, media: { default: null }, title: { default: '' }, poster: { default: null }, dur: { default: 0 }, width: { default: null }, height: { default: null }, up: { default: null }, failed: { default: null } },
    parseDOM: wholeBlock('video'), toDOM: (node) => copied(node, 'p', textAttr(node, 'title') ?? '')
  },
  doclink: { group: 'block', atom: true, attrs: { ...id, doc: { default: '' } }, parseDOM: wholeBlock('doclink'), toDOM: (node) => copied(node, 'p', '') },
  live: {
    group: 'block', atom: true, attrs: { ...id, what: { default: 'decided' }, lines: { default: [] } },
    parseDOM: wholeBlock('live'), toDOM: (node) => copied(node, 'p', listOf(node, 'lines', 'text').join(' · '))
  },
  moment: {
    group: 'block', atom: true, attrs: { ...id, person: { default: null }, name: { default: '' }, at: { default: '' }, text: { default: '' }, line: { default: null } },
    parseDOM: wholeBlock('moment'), toDOM: (node) => copied(node, 'blockquote', `${textAttr(node, 'text') ?? ''} (${textAttr(node, 'name') ?? ''}, ${textAttr(node, 'at') ?? ''})`)
  },
  /* A block from a newer Alcove. Kept as it is, because a browser that can't read a block must never delete it. */
  unsupported: { group: 'block', atom: true, attrs: { ...id, name: { default: '' } }, toDOM: () => ['p'] },

  text: { group: 'inline' },
  hardBreak: { inline: true, group: 'inline', selectable: false, linebreakReplacement: true, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  /* `id` is whoever `people` knows them by; `name` is what to show someone who doesn't. */
  mention: {
    inline: true, group: 'inline', atom: true, attrs: { id: { default: '' }, name: { default: '' } },
    parseDOM: [{ tag: 'span[data-mention]', getAttrs: (el) => ({ id: el.getAttribute('data-mention') ?? '', name: el.textContent }) }],
    toDOM: (node) => ['span', { 'data-mention': textAttr(node, 'id') ?? '' }, textAttr(node, 'name') ?? '']
  },
  /* `date` is YYYY-MM-DD, so Today stays the day it was written. */
  dateChip: {
    inline: true, group: 'inline', atom: true, attrs: { date: { default: '' } },
    parseDOM: [{ tag: 'time[data-chip]', getAttrs: (el) => ({ date: el.getAttribute('datetime') ?? '' }) }],
    toDOM: (node) => ['time', { 'data-chip': '', datetime: textAttr(node, 'date') ?? '' }, textAttr(node, 'date') ?? '']
  },
  /* Only the document's ID: its name is looked up for each reader, so a reader who can't open it never sees it. */
  docref: {
    inline: true, group: 'inline', atom: true, attrs: { doc: { default: '' } },
    parseDOM: [{ tag: 'span[data-docref]', getAttrs: (el) => ({ doc: el.getAttribute('data-docref') ?? '' }) }],
    toDOM: (node) => ['span', { 'data-docref': textAttr(node, 'doc') ?? '' }]
  }
};

const marks: Record<MarkName, MarkSpec> = {
  bold: {
    parseDOM: [
      { tag: 'strong' },
      /* Google Docs wraps what it copies in a <b> that isn't bold. */
      { tag: 'b', getAttrs: (el) => el.style.fontWeight !== 'normal' && null },
      { style: 'font-weight=400', clearMark: (m) => m.type.name === 'bold' },
      { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2,})$/.test(v) && null }
    ],
    toDOM: () => ['b', 0]
  },
  italic: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }, { style: 'font-style=normal', clearMark: (m) => m.type.name === 'italic' }],
    toDOM: () => ['i', 0]
  },
  strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration', getAttrs: (v) => v.includes('line-through') && null }, { style: 'text-decoration-line', getAttrs: (v) => v.includes('line-through') && null }], toDOM: () => ['s', 0] },
  /* ProseMirror won't have a mark and a node share a name, and `code` is the block. */
  inlineCode: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
  link: {
    attrs: { href: { default: '' } }, inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (el) => { const href = safeHref(el.getAttribute('href')); return href ? { href } : false; } }],
    toDOM: (mark) => { const href = safeHref(mark.attrs['href']); return ['a', href ? { href, rel: 'noopener noreferrer nofollow', target: '_blank' } : {}, 0]; }
  },
  highlight: { parseDOM: [{ tag: 'mark' }], toDOM: () => ['mark', { class: 'whl' }, 0] },
  /* Words a thread hangs on. It can overlap another thread. Nothing parses it, so a pasted copy never reopens a thread. */
  comment: { attrs: { id: { default: '' } }, excludes: '', inclusive: false, toDOM: (mark) => ['mark', { class: 'wc', 'data-c': textOf(mark.attrs['id']) ?? '' }, 0] }
};

/*
 * y-prosemirror deletes, for everyone, any element it can't make a node from. A tab left open across a deploy
 * must not do that to a block added by the release after it, so an unknown block becomes `unsupported`.
 */
class BlockSchema extends Schema<NodeName, MarkName> {
  override node(type: string | NodeType, attrs?: Attrs | null, content?: Fragment | PMNode | readonly PMNode[], marks?: readonly Mark[]): PMNode {
    if (typeof type === 'string' && !Object.hasOwn(this.nodes, type)) return super.node('unsupported', { name: type });
    return super.node(type, attrs, content, marks);
  }
}

export const schema = new BlockSchema({ nodes, marks });

/* -------- reading attributes: what's in a document came from other people's browsers, so nothing is taken on trust */
export const textOf = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const textAttr = (node: PMNode, key: string): string | null => textOf(node.attrs[key]);
export const numberAttr = (node: PMNode, key: string): number | null => numberOf(node.attrs[key]);
export const headingLevel = (node: PMNode): 1 | 2 | 3 => { const l: unknown = node.attrs['level']; return l === 1 || l === 3 ? l : l === 2 ? 2 : 1; };
export const indentAttr = (node: PMNode): number => clampIndent(numberOf(node.attrs['indent']) ?? 0);
export const blockIdOf = (node: PMNode): string | null => textOf(node.attrs['id']);

/** Only links that are safe to open. A document's text comes from other people. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const t = href.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}([/?#:]|$)/i.test(t)) return `https://${t}`;
  return null;
}

/** What Enter makes after these, what Tab can indent, and what a list line is. */
export const LIST_TYPES: ReadonlySet<string> = new Set(['bullet', 'numbered', 'todo']);
/** The blocks whose text someone could be typing in: they're kept when an undo would otherwise remove them under someone else's words. */
export const TEXT_NODES: ReadonlySet<string> = new Set(['paragraph', 'heading', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'code', 'toggleSummary', 'toggleBody', 'table_cell', 'table_header', 'title']);

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** A block's stable ID. Random, so two browsers can never make the same one. */
export function newBlockId(): string {
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(12))) out += ID_ALPHABET.charAt(b % ID_ALPHABET.length);
  return out;
}

/** A block that has an `id` attribute. Everything in the doc but the title does. */
export const hasBlockId = (node: PMNode): boolean => Object.hasOwn(node.type.spec.attrs ?? {}, 'id') && node.type.spec.group === 'block';

