/*
 * What a document is made of. Blocks are flat: `doc` is `title block+`, so handles, drag and links stay simple, and
 * lists are flat lines with an `indent`. Every kind of line is one node, `line`, told apart by its `kind`: turning a line
 * into another kind only changes an attribute, which merges with whatever anyone is typing in it. Code, toggles and
 * tables are their own nodes, because they hold something a line can't. `toDOM` here is the clean HTML a document copies
 * out as; on screen every block is drawn by a node view (blocks/views.ts). The Yjs documents the server reads hold these
 * same names and attributes, so changing a name or an attribute's meaning is a change to stored data.
 */
import { Fragment, Schema, type Attrs, type DOMOutputSpec, type Mark, type MarkSpec, type MarkType, type Node as PMNode, type NodeSpec, type NodeType, type TagParseRule } from 'prosemirror-model';
import { BlockAttrsSchema } from '@alcove/api';
import { tableNodes } from 'prosemirror-tables';
import { log } from '~/lib/log';
import type { BlockJSON } from './types';

const elog = log.child({ component: 'editor-schema' });

type NodeName =
  | 'doc' | 'title' | 'line' | 'toggle' | 'toggleSummary' | 'toggleBody'
  | 'divider' | 'code' | 'table' | 'table_row' | 'table_cell' | 'table_header' | 'gallery' | 'file' | 'video' | 'doclink' | 'live' | 'moment'
  | 'unsupported' | 'unsupportedInline' | 'text' | 'hardBreak' | 'mention' | 'dateChip' | 'docref';
type MarkName = 'bold' | 'italic' | 'strike' | 'inlineCode' | 'link' | 'highlight' | 'comment';

/** Lists go no deeper than this. */
export const MAX_INDENT = 2;

/*
 * What every block has. `gone` is set on a block that has left the page: it says which block took its words, and it's ''
 * if none did. See retire.ts.
 */
const block = { id: { default: null }, gone: { default: null } };

const clampIndent = (n: number) => Math.max(0, Math.min(MAX_INDENT, Number.isFinite(n) ? Math.round(n) : 0));
const indentOf = (el: HTMLElement) => clampIndent(Number(el.getAttribute('data-indent') ?? 0));

/** One flat list line, as clipboard.ts writes it when it flattens a pasted list. */
const listLine = (kind: string): TagParseRule => ({
  tag: `div[data-alcove="${kind}"]`,
  getAttrs: (el) => ({ kind, indent: indentOf(el) || null, done: kind === 'todo' && el.getAttribute('data-done') === 'true' ? true : null })
});

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
  const { id: _id, gone: _gone, ...attrs } = node.attrs;
  return [tag, { 'data-alcove-block': node.type.name, 'data-attrs': JSON.stringify(attrs) }, words];
}

function wholeBlock(name: string): readonly TagParseRule[] {
  return [{
    tag: `[data-alcove-block="${name}"]`,
    /* Before the rule for the plain `p` or `blockquote` this is written as. */
    priority: 60,
    getAttrs: (el) => {
      try {
        const attrs = BlockAttrsSchema.parse(JSON.parse(el.getAttribute('data-attrs') ?? '{}'));
        learnAttrs(schema.nodes[name], attrs);
        return attrs;
      } catch (err) {
        /* Anyone's page can put anything on the clipboard: this just isn't that block. */
        elog.info('a pasted block’s attributes can’t be read, so it’s pasted as what it says', { err, block: name });
        return false;
      }
    }
  }];
}

/** A line, as it copies out. */
function lineDOM(node: PMNode): DOMOutputSpec {
  const kind = lineKind(node);
  switch (kind) {
    case 'heading': return [`h${headingLevel(node)}`, 0];
    case 'bullet':
    case 'numbered': return ['li', { 'data-list': kind, 'data-indent': String(indentAttr(node)) }, 0];
    case 'todo': return ['li', { 'data-list': 'todo', 'data-indent': String(indentAttr(node)), 'data-done': String(node.attrs['done'] === true) }, 0];
    case 'quote': return ['blockquote', 0];
    case 'callout': return ['aside', { 'data-icon': textAttr(node, 'icon') ?? 'bulb' }, 0];
    default: return ['p', 0];
  }
}

const nodes: Record<NodeName, NodeSpec> = {
  doc: { content: 'title block+' },
  title: { content: 'text*', marks: '', defining: true, toDOM: () => ['h1', 0] },

  /*
   * The first block is what fills a blank line, so it stays first. `kind` is absent on plain text, and every attribute
   * here is absent until it means something, so a line only stores what makes it what it is.
   */
  line: {
    group: 'block', content: 'inline*',
    attrs: { ...block, kind: { default: null }, level: { default: null }, indent: { default: null }, done: { default: null }, icon: { default: null } },
    parseDOM: [
      { tag: 'p' },
      { tag: 'h1', attrs: { kind: 'heading', level: 1 } }, { tag: 'h2', attrs: { kind: 'heading', level: 2 } }, { tag: 'h3', attrs: { kind: 'heading', level: 3 } },
      { tag: 'h4', attrs: { kind: 'heading', level: 3 } }, { tag: 'h5', attrs: { kind: 'heading', level: 3 } }, { tag: 'h6', attrs: { kind: 'heading', level: 3 } },
      { tag: 'blockquote', attrs: { kind: 'quote' } },
      { tag: 'aside', getAttrs: (el) => ({ kind: 'callout', icon: el.getAttribute('data-icon') ?? 'bulb' }) },
      listLine('bullet'), listLine('numbered'), listLine('todo')
    ],
    toDOM: lineDOM
  },
  toggle: {
    group: 'block', content: 'toggleSummary toggleBody', defining: true, attrs: { ...block, open: { default: true } },
    parseDOM: [{ tag: 'details', getAttrs: (el) => ({ open: el.hasAttribute('open') }) }],
    toDOM: (node) => ['details', node.attrs['open'] === true ? { open: '' } : {}, 0]
  },
  toggleSummary: { content: 'inline*', defining: true, parseDOM: [{ tag: 'summary' }], toDOM: () => ['summary', 0] },
  toggleBody: { content: 'inline*', parseDOM: [{ tag: 'div[data-alcove="body"]' }], toDOM: () => ['div', { 'data-alcove': 'body' }, 0] },
  divider: { group: 'block', atom: true, attrs: block, parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
  /* Words a comment hangs on stay on them here too. */
  code: { group: 'block', content: 'text*', marks: 'comment', code: true, defining: true, attrs: block, parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', ['code', 0]] },

  table: { ...tables.table, attrs: block },
  table_row: tables.table_row,
  table_cell: tables.table_cell,
  table_header: tables.table_header,

  /* What can't be typed: drawn from attributes by React, with handlers from the Editor's props. */
  gallery: {
    group: 'block', atom: true, attrs: { ...block, items: { default: [] }, up: { default: null }, failed: { default: null }, width: { default: 100 } },
    parseDOM: wholeBlock('gallery'), toDOM: (node) => copied(node, 'p', captionsOf(node).join(' · '))
  },
  file: {
    group: 'block', atom: true, attrs: { ...block, media: { default: null }, name: { default: '' }, size: { default: null }, up: { default: null }, failed: { default: null } },
    parseDOM: wholeBlock('file'), toDOM: (node) => copied(node, 'p', textAttr(node, 'name') ?? '')
  },
  video: {
    group: 'block', atom: true,
    attrs: { ...block, media: { default: null }, title: { default: '' }, poster: { default: null }, dur: { default: 0 }, width: { default: null }, height: { default: null }, up: { default: null }, failed: { default: null } },
    parseDOM: wholeBlock('video'), toDOM: (node) => copied(node, 'p', textAttr(node, 'title') ?? '')
  },
  doclink: { group: 'block', atom: true, attrs: { ...block, doc: { default: '' } }, parseDOM: wholeBlock('doclink'), toDOM: (node) => copied(node, 'p', '') },
  live: {
    group: 'block', atom: true, attrs: { ...block, what: { default: 'decided' }, lines: { default: [] } },
    parseDOM: wholeBlock('live'), toDOM: (node) => copied(node, 'p', listOf(node, 'lines', 'text').join(' · '))
  },
  moment: {
    group: 'block', atom: true, attrs: { ...block, person: { default: null }, name: { default: '' }, at: { default: '' }, text: { default: '' }, line: { default: null } },
    parseDOM: wholeBlock('moment'), toDOM: (node) => copied(node, 'blockquote', `${textAttr(node, 'text') ?? ''} (${textAttr(node, 'name') ?? ''}, ${textAttr(node, 'at') ?? ''})`)
  },
  /* A block from a newer Alcove. Kept as it is, because a browser that can't read a block must never delete it. */
  unsupported: { group: 'block', atom: true, attrs: { ...block, name: { default: '' } }, toDOM: () => ['p'] },
  /* The same inside a line. */
  unsupportedInline: { inline: true, group: 'inline', atom: true, attrs: { name: { default: '' } }, toDOM: () => ['span'] },

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

/**
 * Lets a type carry an attribute it wasn't written with. ProseMirror drops what a type doesn't declare, and y-prosemirror
 * then removes it from the element, for everyone, on the next edit.
 */
export function learnAttrs(type: NodeType | MarkType | undefined, attrs: Attrs | null | undefined): void {
  const known: unknown = type ? Reflect.get(type, 'attrs') : null;
  if (!attrs || !isRecord(known)) return;
  for (const name of Object.keys(attrs)) if (!(name in known)) known[name] = { hasDefault: true, default: null, isRequired: false };
}

/** A mark this release doesn't know, with the name it came with: y-prosemirror writes back a mark by its type's name. */
function learnMark(schema: Schema, name: string): MarkType {
  const type = new Schema({ nodes: { doc: { content: 'text*' }, text: {} }, marks: { kept: { excludes: '', inclusive: false, toDOM: () => ['span', 0] } } }).marks['kept'];
  if (!type) throw new RangeError('A schema made with a mark has that mark');
  /* After the marks this release knows, whichever order they were met in. */
  Object.assign(type, { name, rank: Object.keys(schema.marks).length });
  Object.assign(schema.marks, { [name]: type });
  return type;
}

/** What took the place of a stand-in once it turned out to be inside a line. */
const inlineStandIns = new WeakMap<PMNode, PMNode>();

/** The node to hold for one made from an element: what's in the document, if that's since changed. */
export const inDocument = (node: PMNode): PMNode => inlineStandIns.get(node) ?? node;

/*
 * y-prosemirror deletes, for everyone, any element or text it can't make a node or mark from, and removes from an element
 * whatever its node doesn't carry. A tab left open across a deploy must not do that to what the release after it adds. So
 * nothing read from a document is ever refused here: what isn't known is carried as it came. An unknown block becomes
 * `unsupported`, and one that doesn't fit where it is does too. An unknown tag can't be told from a block until the line
 * around it is made, so that's when it becomes `unsupportedInline`. Unknown marks and attributes are learned as they're met.
 */
class BlockSchema extends Schema<NodeName, MarkName> {
  private standIn(name: string, attrs: Attrs | null | undefined): PMNode {
    return super.node('unsupported', { id: attrs?.['id'] ?? null, gone: attrs?.['gone'] ?? null, name });
  }

  override node(type: string | NodeType, attrs?: Attrs | null, content?: Fragment | PMNode | readonly PMNode[], marks?: readonly Mark[]): PMNode {
    if (typeof type !== 'string') return super.node(type, attrs, content, marks);
    const known = this.nodes[type];
    if (!known) return this.standIn(type, attrs);
    learnAttrs(known, attrs);
    try {
      return super.node(known, attrs, known.inlineContent && Array.isArray(content) ? content.map((child: PMNode) => this.inline(child)) : content, marks);
    } catch (err) {
      elog.warn('a block doesn’t fit where it is, so it’s left as it is', { err, block: type });
      return this.standIn(type, attrs);
    }
  }

  private inline(node: PMNode): PMNode {
    if (node.type !== this.nodes.unsupported) return node;
    const made = inlineStandIns.get(node) ?? this.nodes.unsupportedInline.create({ name: node.attrs['name'] });
    inlineStandIns.set(node, made);
    return made;
  }

  override mark(type: string | MarkType, attrs?: Attrs | null): Mark {
    const known = typeof type === 'string' ? this.marks[type] ?? learnMark(this, type) : type;
    learnAttrs(known, attrs);
    return known.create(attrs);
  }

  /* Text that isn't text, from a release that embeds things in a line: y-prosemirror would delete all the words around it. */
  override text(text: string, marks?: readonly Mark[] | null): PMNode {
    const words: unknown = text;
    return super.text(typeof words === 'string' && words !== '' ? words : '￼', marks);
  }
}

export const schema = new BlockSchema({ nodes, marks });

/** A block from its JSON, keeping what this release doesn't know about it. */
export function blockFromJSON(json: BlockJSON): PMNode {
  learnAttrs(schema.nodes[json.type], json.attrs);
  return schema.nodeFromJSON(json);
}

/* -------- reading attributes: what's in a document came from other people's browsers, so nothing is taken on trust */
export const textOf = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const textAttr = (node: PMNode, key: string): string | null => textOf(node.attrs[key]);
export const numberAttr = (node: PMNode, key: string): number | null => numberOf(node.attrs[key]);
export const headingLevel = (node: PMNode): 1 | 2 | 3 => { const l: unknown = node.attrs['level']; return l === 1 || l === 3 ? l : l === 2 ? 2 : 1; };
export const indentAttr = (node: PMNode): number => clampIndent(numberOf(node.attrs['indent']) ?? 0);
export const blockIdOf = (node: PMNode): string | null => textOf(node.attrs['id']);

/** What kind of line this is: null for plain text, and for anything that isn't a line. */
export const lineKind = (node: PMNode): string | null => (node.type === schema.nodes.line ? textAttr(node, 'kind') : null);
/** Plain text: what Enter makes, and what Backspace turns any other line into before joining it to the one above. */
export const isPlainLine = (node: PMNode): boolean => node.type === schema.nodes.line && lineKind(node) === null;

/** A photo's caption is an attribute of its own, so two people captioning two photos of a gallery don't write over each other. */
export const captionKey = (media: string): string => `cap:${media}`;
export const captionsOf = (node: PMNode): string[] => Object.entries(node.attrs).flatMap(([name, value]: [string, unknown]) => (name.startsWith('cap:') && typeof value === 'string' && value !== '' ? [value] : []));

/** A block that has left the page and has no words of anyone's in it: it stays in the document, drawn as nothing. */
export const isGone = (node: PMNode): boolean => textAttr(node, 'gone') !== null && node.textContent === '' && captionsOf(node).length === 0;

/** Only links that are safe to open. A document's text comes from other people. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const t = href.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}([/?#:]|$)/i.test(t)) return `https://${t}`;
  return null;
}

/** What Enter makes after these, what Tab can indent, and what a list line is. */
const LIST_KINDS: ReadonlySet<string | null> = new Set(['bullet', 'numbered', 'todo']);
export const isListLine = (node: PMNode): boolean => LIST_KINDS.has(lineKind(node));
/** The blocks whose text someone could be typing in: they're kept when an undo would otherwise remove them under someone else's words. */
export const TEXT_NODES: ReadonlySet<string> = new Set(['line', 'code', 'toggleSummary', 'toggleBody', 'table_cell', 'table_header', 'title']);

/**
 * A block that gets an ID: everything but the title, and `unsupported`. That one has to stay exactly as it came. Giving
 * it an ID would make it differ from its element, and y-prosemirror would replace the element it can't read with it.
 */
export const hasBlockId = (node: PMNode): boolean => node.type.spec.group === 'block' && node.type !== schema.nodes.unsupported;
