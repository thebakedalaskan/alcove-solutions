/*
 * What keys and menus do to blocks. Everything works on one top-level block at a time, found by position or ID:
 * the flat document means a block's neighbours are simply the ones beside it.
 */
import { Fragment, type Attrs, type Node as PMNode, type NodeType, type ResolvedPos } from 'prosemirror-model';
import { NodeSelection, Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { addRowAfter, CellSelection, goToNextCell, isInTable, selectedRect, TableMap } from 'prosemirror-tables';
import { newBlockId } from './names';
import { blockIdOf, headingLevel, indentAttr, isListLine, isPlainLine, lineKind, MAX_INDENT, schema, textAttr } from './schema';
import type { BlockKind } from './types';

const n = schema.nodes;

/** A top-level block: the title isn't one. */
export interface BlockRef { node: PMNode; pos: number; index: number; id: string | null }

export function allBlocks(doc: PMNode): BlockRef[] {
  const out: BlockRef[] = [];
  doc.forEach((node, pos, index) => { if (index > 0) out.push({ node, pos, index, id: blockIdOf(node) }); });
  return out;
}

export function findBlock(doc: PMNode, id: string): BlockRef | null {
  return allBlocks(doc).find((b) => b.id === id) ?? null;
}

/** The block a position is inside. */
export function blockAt($pos: ResolvedPos): BlockRef | null {
  if ($pos.depth < 1 || $pos.index(0) === 0) return null;
  const node = $pos.node(1);
  return { node, pos: $pos.before(1), index: $pos.index(0), id: blockIdOf(node) };
}

/** The block the selection starts in, including a block selected whole. */
export function selectedBlock(state: EditorState): BlockRef | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.$from.depth === 0) {
    const index = sel.$from.index(0);
    return index === 0 ? null : { node: sel.node, pos: sel.from, index, id: blockIdOf(sel.node) };
  }
  return blockAt(sel.$from);
}

/** What scrolls the page. */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return null;
}

/**
 * Walks the blocks in order, keeping a count per indent. A line starts the deeper levels over; a bullet or checklist
 * line breaks the count at its own level and deeper; anything else breaks all of it. Returns a numbered line's number.
 */
export function countLine(counts: number[], node: PMNode): number | null {
  const level = indentAttr(node);
  if (lineKind(node) === 'numbered') {
    const next = (counts[level] ?? 0) + 1;
    counts[level] = next;
    counts.fill(0, level + 1);
    return next;
  }
  counts.fill(0, isListLine(node) ? level : 0);
  return null;
}

/** Nothing typed: no words and no tags. */
export const isBlank = (node: PMNode): boolean => node.isTextblock && node.textContent.trim() === '' && node.content.size === node.textContent.length;

/** The kind Turn into and `/` call this block. */
export function kindOf(node: PMNode): BlockKind | null {
  if (node.type === n.toggle) return 'toggle';
  if (node.type === n.code) return 'code';
  if (node.type !== n.line) return null;
  const kind = lineKind(node);
  switch (kind) {
    case 'heading': { const l = headingLevel(node); return l === 1 ? 'h1' : l === 2 ? 'h2' : 'h3'; }
    case 'bullet':
    case 'numbered':
    case 'todo':
    case 'quote':
    case 'callout': return kind;
    default: return 'paragraph';
  }
}

type LineBlockKind = Exclude<BlockKind, 'toggle' | 'code'>;
const isLineKind = (kind: BlockKind): kind is LineBlockKind => kind !== 'toggle' && kind !== 'code';

/** What makes a line each kind. Everything else about a line is absent until it means something. */
const LINE_KINDS: Record<LineBlockKind, Attrs> = {
  paragraph: {},
  h1: { kind: 'heading', level: 1 },
  h2: { kind: 'heading', level: 2 },
  h3: { kind: 'heading', level: 3 },
  bullet: { kind: 'bullet' },
  numbered: { kind: 'numbered' },
  todo: { kind: 'todo' },
  quote: { kind: 'quote' },
  callout: { kind: 'callout', icon: 'bulb' }
};

const lineAttrs = (kind: LineBlockKind, id: string | null, indent: number): Attrs => ({
  ...LINE_KINDS[kind], id, indent: indent > 0 && (kind === 'bullet' || kind === 'numbered' || kind === 'todo') ? indent : null
});

/** What's left of a line in a block that holds plain text only: the words, tags as what they say, and the words a comment hangs on. */
const codeContent = (content: Fragment): Fragment => {
  const out: PMNode[] = [];
  content.forEach((c) => {
    const text = c.isText ? c.text ?? '' : c.type === n.hardBreak ? '\n' : textAttr(c, 'name') ?? textAttr(c, 'date') ?? '';
    if (text) out.push(schema.text(text, c.marks.filter((mark) => mark.type === schema.marks.comment)));
  });
  return Fragment.fromArray(out);
};

/** An empty block of a kind, or holding `content`. */
export function makeBlock(kind: BlockKind, id: string | null = null, content: Fragment = Fragment.empty, indent = 0): PMNode {
  if (kind === 'toggle') return n.toggle.create({ id, open: true }, [n.toggleSummary.create(null, content), n.toggleBody.create()]);
  if (kind === 'code') return n.code.create({ id }, codeContent(content));
  return n.line.create(lineAttrs(kind, id, indent), content);
}

/**
 * Changes a block's kind and keeps its ID, its text and the caret's place in it. From one kind of line to another that's
 * only an attribute. Only what holds text can turn: nothing else has anything to carry over.
 */
export function turnBlock(tr: Transaction, ref: BlockRef, kind: BlockKind): void {
  const was = kindOf(ref.node);
  if (was === null || was === kind) return;
  const { node, pos, id } = ref;
  const end = pos + node.nodeSize;
  const indent = isListLine(node) ? indentAttr(node) : 0;
  if (node.type === n.line && isLineKind(kind)) {
    tr.setNodeMarkup(pos, null, lineAttrs(kind, id, indent));
    return;
  }
  if (node.type === n.toggle) {
    const head = node.child(0), body = node.child(1);
    const offset = tr.selection.$from.parent === head ? tr.selection.$from.parentOffset : 0;
    const out = [makeBlock(kind, id, head.content)];
    if (body.content.size > 0) out.push(n.line.create({ id: newBlockId() }, body.content));
    tr.replaceWith(pos, end, out);
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1 + offset)));
    return;
  }
  const offset = tr.selection.$from.parent === node ? tr.selection.$from.parentOffset : 0;
  tr.replaceWith(pos, end, makeBlock(kind, id, node.content, indent));
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + (kind === 'toggle' ? 2 : 1) + offset)));
}

/** Puts `nodes` after a block, or in its place. The first one keeps the place's ID when it takes its place. */
export function placeBlocks(tr: Transaction, ref: BlockRef, nodes: readonly PMNode[], replace: boolean): number {
  const from = replace ? ref.pos : ref.pos + ref.node.nodeSize;
  const to = replace ? ref.pos + ref.node.nodeSize : from;
  tr.replaceWith(from, to, [...nodes]);
  return from;
}

/** The caret at the start of what's at `pos`, looking forward. */
export const caretInto = (tr: Transaction, pos: number): Transaction => tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), 1));

/* -------- Enter */
function exitTitle(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined): boolean {
  if (dispatch) {
    const title = state.doc.child(0);
    dispatch(caretInto(state.tr, title.nodeSize + 1).scrollIntoView());
  }
  return true;
}

/** Tab through a table's cells; past the last, a new row. */
function nextCell(dir: 1 | -1): Command {
  return (state, dispatch, view) => {
    if (goToNextCell(dir)(state, dispatch, view)) return true;
    if (dir < 0) return true;
    if (!dispatch) return addRowAfter(state);
    const rect = selectedRect(state);
    return addRowAfter(state, (tr) => {
      const table = tr.doc.nodeAt(rect.tableStart - 1);
      if (!table) { dispatch(tr); return; }
      const cell = rect.tableStart + TableMap.get(table).positionAt(rect.bottom, 0, table);
      dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(cell + 1))).scrollIntoView());
    });
  };
}

/** What Enter makes after a line: lists go on, everything else goes back to text. */
function splitAs(parent: PMNode): { type: NodeType; attrs: Attrs } {
  return { type: n.line, attrs: isListLine(parent) ? { kind: lineKind(parent), indent: parent.attrs['indent'], id: null } : { id: null } };
}

export const enter: Command = (state, dispatch, view) => {
  const sel = state.selection;
  if (sel instanceof CellSelection) return true;
  if (sel instanceof BlocksSelection) {
    if (dispatch) dispatch(state.tr.deleteSelection().scrollIntoView());
    return true;
  }
  if (sel instanceof NodeSelection) {
    const ref = selectedBlock(state);
    if (!ref) return false;
    if (dispatch) {
      const tr = state.tr.insert(ref.pos + ref.node.nodeSize, n.line.create({ id: newBlockId() }));
      dispatch(caretInto(tr, ref.pos + ref.node.nodeSize + 1).scrollIntoView());
    }
    return true;
  }
  const { $from } = sel;
  const parent = $from.parent;
  if (parent.type === n.title) return exitTitle(state, dispatch);
  if (parent.type.spec.code) {
    if (dispatch) dispatch(state.tr.insertText('\n').scrollIntoView());
    return true;
  }
  if (isInTable(state)) return nextCell(1)(state, dispatch, view);
  if (parent.type === n.toggleBody) return lineBreak(state, dispatch);
  if (parent.type === n.toggleSummary) {
    const ref = blockAt($from);
    if (!ref) return false;
    if (!dispatch) return true;
    if (ref.node.attrs['open'] === true) dispatch(caretInto(state.tr, $from.after() + 1).scrollIntoView());
    else {
      const tr = state.tr.insert(ref.pos + ref.node.nodeSize, n.line.create({ id: newBlockId() }));
      dispatch(caretInto(tr, ref.pos + ref.node.nodeSize + 1).scrollIntoView());
    }
    return true;
  }
  const ref = blockAt($from);
  if (!ref) return false;
  if (!dispatch) return true;
  const tr = state.tr;

  /* A selection across blocks goes first, and Enter carries on from there. */
  if (!sel.empty) tr.deleteSelection();
  const $c = tr.selection.$from;
  const line = $c.parent;
  const here = blockAt($c);
  if (!here) return false;

  /* --- on its own line is a divider. */
  if (sel.empty && isPlainLine(line) && line.textContent === '---' && line.childCount === 1) {
    tr.replaceWith(here.pos, here.pos + line.nodeSize, [n.divider.create({ id: here.id }), n.line.create({ id: newBlockId() })]);
    dispatch(caretInto(tr, here.pos + 2).scrollIntoView());
    return true;
  }

  /* Enter on an empty list line steps out one level, then back to text. */
  if (sel.empty && isListLine(line) && isBlank(line)) {
    const indent = indentAttr(line);
    if (indent > 0) tr.setNodeAttribute(here.pos, 'indent', indent > 1 ? indent - 1 : null);
    else turnBlock(tr, here, 'paragraph');
    dispatch(tr.scrollIntoView());
    return true;
  }

  /* At the very start of a line that isn't a list, the line stays what it is and moves down. */
  if ($c.parentOffset === 0 && line.content.size > 0 && !isListLine(line)) {
    tr.insert(here.pos, n.line.create({ id: newBlockId() }));
    dispatch(tr.scrollIntoView());
    return true;
  }

  const after = splitAs(line);
  tr.split($c.pos, 1, [after]);
  dispatch(tr.scrollIntoView());
  return true;
};

export const lineBreak: Command = (state, dispatch) => {
  const parent = state.selection.$from.parent;
  if (parent.type === n.title) return true;
  if (!dispatch) return true;
  if (parent.type.spec.code) dispatch(state.tr.insertText('\n').scrollIntoView());
  else dispatch(state.tr.replaceSelectionWith(n.hardBreak.create()).scrollIntoView());
  return true;
};

/* -------- Backspace and Delete */
export const backspace: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const $c = sel.$from;
  if ($c.parentOffset > 0) return false;
  const parent = $c.parent;
  if (parent.type === n.title) return true;
  if (isInTable(state)) return true;
  if (parent.type === n.toggleBody) {
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, $c.before() - 1)));
    return true;
  }
  const ref = blockAt($c);
  if (!ref) return false;
  if (parent.type === n.toggleSummary) {
    if (dispatch) { const tr = state.tr; turnBlock(tr, ref, 'paragraph'); dispatch(tr.scrollIntoView()); }
    return true;
  }
  const tr = state.tr;
  /* A list line steps out first, then any block goes back to text, then the line joins the one above. */
  if (isListLine(parent) && indentAttr(parent) > 0) {
    if (dispatch) dispatch(tr.setNodeAttribute(ref.pos, 'indent', indentAttr(parent) > 1 ? indentAttr(parent) - 1 : null));
    return true;
  }
  if (!isPlainLine(parent)) {
    if (dispatch) { turnBlock(tr, ref, 'paragraph'); dispatch(tr.scrollIntoView()); }
    return true;
  }
  const title = state.doc.child(0);
  if (ref.index === 1) {
    if (dispatch) {
      /* An empty first line goes, unless it's the only one; the caret goes up to the title. */
      if (isBlank(parent) && state.doc.childCount > 2) tr.delete(ref.pos, ref.pos + parent.nodeSize);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, title.nodeSize - 1)).scrollIntoView());
    }
    return true;
  }
  const before = state.doc.child(ref.index - 1);
  if (before.isTextblock) return false;
  if (before.type === n.toggle) {
    /* It joins the toggle's body, so that has to be showing. */
    if (before.attrs['open'] !== true && dispatch) dispatch(tr.setNodeAttribute(ref.pos - before.nodeSize, 'open', true));
    return false;
  }
  if (dispatch) {
    const start = ref.pos - before.nodeSize;
    if (isBlank(parent)) tr.delete(ref.pos, ref.pos + parent.nodeSize);
    if (before.type === n.table) dispatch(tr.setSelection(Selection.near(tr.doc.resolve(ref.pos), -1)).scrollIntoView());
    else dispatch(tr.setSelection(NodeSelection.create(tr.doc, start)).scrollIntoView());
  }
  return true;
};

export const deleteForward: Command = (state) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const $c = sel.$from;
  if ($c.parentOffset < $c.parent.content.size) return false;
  const name = $c.parent.type.name;
  /* The title and a toggle's two halves always stay separate. */
  return name === 'title' || name === 'toggleSummary' || isInTable(state);
};

/* -------- Tab */
export const indent = (dir: 1 | -1): Command => (state, dispatch, view) => {
  if (isInTable(state)) return nextCell(dir)(state, dispatch, view);
  const { $from, to, from } = state.selection;
  if ($from.parent.type.spec.code) {
    if (dir > 0 && dispatch) dispatch(state.tr.insertText('  ').scrollIntoView());
    return true;
  }
  if (!dispatch) return true;
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (parent !== state.doc) return false;
    if (isListLine(node)) {
      const next = Math.max(0, Math.min(MAX_INDENT, indentAttr(node) + dir));
      if (next !== indentAttr(node)) tr.setNodeAttribute(pos, 'indent', next > 0 ? next : null);
    }
    return false;
  });
  if (tr.docChanged) dispatch(tr);
  return true;
};

/* -------- selecting */
/**
 * Every block, whatever they are. Text selections have to start and end in text, so without this a document ending
 * in a photo couldn't be selected whole; ProseMirror's own select-all would take the title with it.
 */
export class BlocksSelection extends Selection {
  constructor(doc: PMNode) { super(doc.resolve(doc.child(0).nodeSize), doc.resolve(doc.content.size)); }
  override map(doc: PMNode): Selection { return new BlocksSelection(doc); }
  override eq(other: Selection): boolean { return other instanceof BlocksSelection; }
  override toJSON(): { type: string } { return { type: 'blocks' }; }
  static override fromJSON(doc: PMNode): BlocksSelection { return new BlocksSelection(doc); }
}
Selection.jsonID('blocks', BlocksSelection);

/** ⌘A: the title, the block you're in if it's a world of its own, else every block, never the title with them. */
export const selectAll: Command = (state, dispatch) => {
  const { doc, selection: sel } = state;
  const { $from } = sel;
  const select = (from: number, to: number) => { if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(doc, from, to))); return true; };
  const whole = $from.parent.isTextblock && sel.from === $from.start() && sel.to === $from.end();
  if (!whole && $from.parent.isTextblock && ($from.parent.type === n.title || $from.parent.type.spec.code || isInTable(state))) return select($from.start(), $from.end());
  if (!dispatch) return true;
  const first = doc.child(1), last = doc.lastChild;
  /* Text at both ends can be an ordinary selection, which is one the format bar can sit on. */
  dispatch(state.tr.setSelection(first.isTextblock && last?.isTextblock ? TextSelection.create(doc, doc.child(0).nodeSize + 1, doc.content.size - 1) : new BlocksSelection(doc)));
  return true;
};

/* -------- what a block is, in words */
/** A short name for a block: its first words, for the thing that follows the pointer when it's dragged. */
export function blockLabel(node: PMNode): string {
  const text = node.textContent.trim() || textAttr(node, 'name') || textAttr(node, 'title') || textAttr(node, 'text') || '';
  return text.slice(0, 44) || 'Block';
}
