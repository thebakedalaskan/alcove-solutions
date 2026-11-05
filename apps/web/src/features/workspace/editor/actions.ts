/*
 * What pressing something does: a `/` item, a tag, a row of a block's menu, a button on the format bar. These are the
 * same calls the EditorHandle makes, so a screen outside the editor gets exactly what the menus get.
 */
import { newBlockId, retire, seenIn } from '@alcove/api/retire';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import { blockAt, blockLabel, caretInto, findBlock, isBlank, leafWords, makeBlock, placeBlocks, selectedBlock, turnBlock, allBlocks, type BlockRef } from './commands';
import { startThread } from './comments';
import type { SlashId } from './menus/rows';
import { appear, decorChange, flash, holding, holdRange, rangeOf } from './plugins/decor';
import { moveBlock } from './plugins/retire';
import type { EditorRuntime, HeldWords, OpenMenu } from './runtime';
import type { HeldRange } from './plugins/decor';
import { blockFromJSON, captionKey, hasBlockId, learnAttrs, lineKind, safeHref, schema } from './schema';
import type { BlockJSON, BlockKind, InsertAt, LiveLine, LiveWhat, MentionItem, MomentLine, MovingBlock, Rect } from './types';
import { elementOf, syncOf } from './ydoc';

const n = schema.nodes;
const m = schema.marks;

/** The page's text blocks that `/` can make by turning the line it's on. */
const KINDS: ReadonlySet<string> = new Set<BlockKind>(['paragraph', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'code']);
const isKind = (id: SlashId): id is BlockKind => KINDS.has(id);

/** A view that may be changed: nobody without edit access writes anything. */
const editing = (rt: EditorRuntime): EditorView | null => (rt.readOnly ? null : rt.view);

const rectOfBlock = (view: EditorView, pos: number): Rect | null => {
  const dom = view.nodeDOM(pos);
  return dom instanceof Element ? dom.getBoundingClientRect() : null;
};

/** A table of empty cells, the first row its header. */
export function makeTable(id: string, rows = 3, columns = 3): PMNode {
  const row = (type: typeof n.table_cell) => n.table_row.create(null, Array.from({ length: columns }, () => type.create()));
  return n.table.create({ id }, [row(n.table_header), ...Array.from({ length: rows - 1 }, () => row(n.table_cell))]);
}

/** Takes the `/word` out and leaves what the line is now. */
function clearTrigger(tr: Transaction, from: number, to: number): BlockRef | null {
  tr.delete(from, to);
  return blockAt(tr.doc.resolve(from));
}

/** Where blocks made from `/` go: in place of the line if it's empty, under it if it isn't. */
function placeFor(tr: Transaction, ref: BlockRef, nodes: (keepId: string | null) => PMNode[]): number {
  const empty = isBlank(ref.node);
  return placeBlocks(tr, ref, nodes(empty ? ref.id : null), empty);
}

export function pickSlash(rt: EditorRuntime, menu: Extract<OpenMenu, { kind: 'slash' }>, id: SlashId): void {
  const view = editing(rt);
  if (!view) return;
  rt.menu.set(null);
  const tr = view.state.tr;
  const ref = clearTrigger(tr, menu.from, menu.to);
  if (!ref) return;
  const empty = isBlank(ref.node);
  const anchor = () => { const dom = ref.id ? rectOfBlock(view, findBlock(view.state.doc, ref.id)?.pos ?? -1) : null; return dom; };

  if (isKind(id)) {
    if (empty) {
      turnBlock(tr, ref, id);
      /* The caret goes to the line's end, which is the first place in a toggle's line. */
      tr.setSelection(TextSelection.near(tr.doc.resolve(ref.pos + (id === 'toggle' ? 2 : 1))));
    } else {
      const at = placeBlocks(tr, ref, [makeBlock(id, newBlockId())], false);
      caretInto(tr, at + 1);
    }
    view.dispatch(tr.scrollIntoView());
    view.focus();
    return;
  }

  switch (id) {
    case 'divider': {
      const at = placeFor(tr, ref, (keep) => [n.divider.create({ id: keep ?? newBlockId() }), n.line.create({ id: newBlockId() })]);
      view.dispatch(caretInto(tr, at + 2).scrollIntoView());
      view.focus();
      return;
    }
    case 'table': {
      const at = placeFor(tr, ref, (keep) => [makeTable(keep ?? newBlockId())]);
      view.dispatch(caretInto(tr, at + 3).scrollIntoView());
      view.focus();
      return;
    }
    case 'decided':
    case 'followups': {
      const block = empty && ref.id ? ref.id : newBlockId();
      const at = placeFor(tr, ref, () => [n.live.create({ id: block, what: id }), n.line.create({ id: newBlockId() })]);
      view.dispatch(caretInto(tr, at + 2).scrollIntoView());
      view.focus();
      rt.props.call?.onLive?.(id, block);
      return;
    }
    case 'photo': {
      const block = empty && ref.id ? ref.id : newBlockId();
      placeFor(tr, ref, () => [n.gallery.create({ id: block })]);
      view.dispatch(tr.scrollIntoView());
      const placed = findBlock(view.state.doc, block);
      rt.props.onPick?.({ kind: 'photo', block, at: { replace: block }, rect: placed ? rectOfBlock(view, placed.pos) : null });
      return;
    }
    case 'video':
    case 'file': {
      view.dispatch(tr);
      if (ref.id) rt.props.onPick?.({ kind: id, block: null, at: empty ? { replace: ref.id } : { after: ref.id }, rect: anchor() });
      return;
    }
    case 'moment':
      view.dispatch(tr);
      if (ref.id) rt.menu.set({ kind: 'moment', block: ref.id });
      return;
    case 'doclink':
      view.dispatch(tr);
      if (ref.id) rt.menu.set({ kind: 'documents', block: ref.id });
      return;
    default:
      view.dispatch(tr);
  }
}

/** Puts a tag where `@word` was, and tells whoever needs telling. */
export function pickMention(rt: EditorRuntime, menu: Extract<OpenMenu, { kind: 'mention' }>, item: MentionItem): void {
  const view = editing(rt);
  if (!view) return;
  rt.menu.set(null);
  const chip = item.kind === 'person' ? n.mention.create({ id: item.person.id, name: item.person.name })
    : item.kind === 'document' ? n.docref.create({ doc: item.id })
      : n.dateChip.create({ date: item.date });
  const tr = view.state.tr.replaceWith(menu.from, menu.to, [chip, schema.text(' ')]);
  tr.setSelection(TextSelection.create(tr.doc, menu.from + 2));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  if (item.kind === 'person') {
    const dom = view.nodeDOM(menu.from);
    rt.props.onTagged?.(item.person, menu.block, dom instanceof Element ? dom.getBoundingClientRect() : null);
  }
}

/** Link to a document: a block on a line of its own, under the line if there are words on it. */
export function pickDocument(rt: EditorRuntime, block: string, doc: string): void {
  const view = editing(rt);
  rt.menu.set(null);
  const ref = view ? findBlock(view.state.doc, block) : null;
  if (!view || !ref) return;
  const tr = view.state.tr;
  const at = placeFor(tr, ref, (keep) => [n.doclink.create({ id: keep ?? newBlockId(), doc }), n.line.create({ id: newBlockId() })]);
  view.dispatch(caretInto(tr, at + 2).scrollIntoView());
  view.focus();
}

/** A quote from the transcript, with who said it and when. The caret goes on underneath it. */
export function pickMoment(rt: EditorRuntime, block: string, line: MomentLine): void {
  const view = editing(rt);
  rt.menu.set(null);
  const ref = view ? findBlock(view.state.doc, block) : null;
  if (!view || !ref) return;
  const id = isBlank(ref.node) && ref.id ? ref.id : newBlockId();
  const tr = view.state.tr;
  const at = placeFor(tr, ref, () => [
    n.moment.create({ id, person: line.person?.id ?? null, name: line.person?.name ?? line.name, at: line.at, text: line.text, line: line.id }),
    n.line.create({ id: newBlockId() })
  ]);
  view.dispatch(caretInto(tr, at + 2).scrollIntoView());
  view.focus();
  flash(view, id);
}

/** Plus, in the margin: a new line under this one with `/` already typed, so it's the same menu as the keyboard's. */
export function addBelow(rt: EditorRuntime, id: string): void {
  const view = editing(rt);
  const ref = view ? findBlock(view.state.doc, id) : null;
  if (!view || !ref) return;
  const at = ref.pos + ref.node.nodeSize;
  const tr = view.state.tr.insert(at, n.line.create({ id: newBlockId() }, schema.text('/')));
  view.focus();
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
}

export function turnInto(rt: EditorRuntime, id: string, kind: BlockKind): void {
  const view = editing(rt);
  const ref = view ? findBlock(view.state.doc, id) : null;
  if (!view || !ref) return;
  const tr = view.state.tr;
  turnBlock(tr, ref, kind);
  view.dispatch(tr);
}

/** A copy under the block, with its own ID. Comments stay with the original. */
export function duplicateBlock(rt: EditorRuntime, id: string): void {
  const view = editing(rt);
  const ref = view ? findBlock(view.state.doc, id) : null;
  if (!view || !ref) return;
  const copyId = newBlockId();
  const at = ref.pos + ref.node.nodeSize;
  const tr = view.state.tr.insert(at, ref.node.type.create({ ...ref.node.attrs, id: copyId, gone: null }, ref.node.content, ref.node.marks));
  tr.removeMark(at, at + ref.node.nodeSize, m.comment);
  view.dispatch(tr);
  flash(view, copyId);
}

export function removeBlock(rt: EditorRuntime, id: string): void {
  const view = editing(rt);
  const ref = view ? findBlock(view.state.doc, id) : null;
  if (!view || !ref) return;
  view.dispatch(view.state.tr.delete(ref.pos, ref.pos + ref.node.nodeSize));
}

/** Delete, in a block's menu: gone at once, with a moment to take it back. The toast takes back this, whatever's been typed since. */
export function deleteFromMenu(rt: EditorRuntime, id: string): void {
  const view = editing(rt);
  rt.menu.set(null);
  if (!view) return;
  const manager: Y.UndoManager | undefined = yUndoPluginKey.getState(view.state)?.undoManager;
  manager?.stopCapturing();
  removeBlock(rt, id);
  manager?.stopCapturing();
  const step = manager?.undoStack.at(-1);
  rt.props.onToast?.({
    icon: 'trash', text: 'Block deleted', label: 'Undo',
    run: () => {
      const at = step ? manager?.undoStack.indexOf(step) ?? -1 : -1;
      if (!manager || !step || at < 0) return;
      manager.undoStack.splice(at, 1);
      manager.undoStack.push(step);
      manager.undo();
    }
  });
}

/** A block's menu, from the keyboard: on the block the caret is in. */
export function openBlockMenu(rt: EditorRuntime): boolean {
  const view = editing(rt);
  const ref = view ? selectedBlock(view.state) : null;
  const dom = view && ref ? view.nodeDOM(ref.pos) : null;
  if (!ref?.id || !(dom instanceof Element)) return false;
  rt.menu.set({ kind: 'block', block: ref.id, rect: dom.getBoundingClientRect(), keyboard: true });
  return true;
}

/** Ticks the checklist line the caret is in, or doesn't, for what doesn't have one. */
export const tickLine = (rt: EditorRuntime): boolean => {
  const view = editing(rt);
  const ref = view ? selectedBlock(view.state) : null;
  if (!view || !ref || lineKind(ref.node) !== 'todo') return false;
  view.dispatch(view.state.tr.setNodeAttribute(ref.pos, 'done', ref.node.attrs['done'] === true ? null : true));
  return true;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Esc: out of the text, to whatever comes after it, because Tab here is indent. That's the handles beside the block the
 * caret is in, so they can be reached without a pointer, then everything after the page.
 */
export function leaveText(rt: EditorRuntime): boolean {
  const view = rt.view;
  if (!view) return false;
  const block = selectedBlock(view.state)?.id;
  if (block && !rt.readOnly) rt.hover.set(block);
  /* The handles are there once React has drawn them. */
  requestAnimationFrame(() => {
    for (const el of view.dom.ownerDocument.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      const after = (view.dom.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      if (after && !view.dom.contains(el) && el.getClientRects().length > 0) { el.focus(); return; }
    }
    view.dom.blur();
  });
  return true;
}

/** A block as plain data, and what it's called. */
export function movingBlock(state: EditorState, id: string): MovingBlock | null {
  const ref = findBlock(state.doc, id);
  if (!ref) return null;
  const block: BlockJSON = ref.node.toJSON();
  return { id, block, label: blockLabel(ref.node) };
}

/** What another document could take. A block from a newer Alcove can't be written out from here, so it stays where it can't be damaged. */
export const canLeave = (block: BlockJSON): boolean => block.type !== 'unsupported';

/**
 * A block on its way to another document, as it is now, and what to call once it's safely there. Only what went with it
 * leaves: whatever is typed in it while it's on its way stays here, on the page.
 */
export function departure(rt: EditorRuntime, id: string): { moving: MovingBlock; arrived: () => void } | null {
  const view = editing(rt);
  const sync = view ? syncOf(view.state) : null;
  const moving = view ? movingBlock(view.state, id) : null;
  if (!sync || !moving || !canLeave(moving.block)) return null;
  const seen = seenIn(sync.doc);
  return {
    moving,
    arrived: () => {
      const found = rt.readOnly ? null : elementOf(sync.type, id);
      if (found) sync.doc.transact(() => { retire(found.element, newBlockId(), '', seen); }, ySyncPluginKey);
    }
  };
}

/** A block leaves for another document: gone from here once it's safely there. */
export async function sendBlock(rt: EditorRuntime, id: string, to: string): Promise<void> {
  rt.menu.set(null);
  const leaving = departure(rt, id);
  if (!leaving || !rt.props.onMoveBlock) return;
  if (await rt.props.onMoveBlock(leaving.moving, to)) leaving.arrived();
}

/** Moves a block one place up or down, from the keyboard. */
export function nudgeBlock(rt: EditorRuntime, dir: 1 | -1): boolean {
  const view = editing(rt);
  const ref = view ? selectedBlock(view.state) : null;
  if (!view || !ref?.id) return false;
  const blocks = allBlocks(view.state.doc);
  const here = blocks.findIndex((b) => b.id === ref.id);
  const next = blocks[here + dir];
  if (next?.id) moveBlock(rt, ref.id, next.id, dir > 0 ? 'after' : 'before');
  return true;
}

/* -------- attributes */
export function setBlockAttrs(rt: EditorRuntime, pos: number, attrs: Record<string, unknown>, history = false): void {
  const view = editing(rt);
  const node = view?.state.doc.nodeAt(pos);
  if (!view || !node) return;
  const tr = view.state.tr;
  for (const [key, value] of Object.entries(attrs)) tr.setNodeAttribute(pos, key, value);
  view.dispatch(history ? tr : tr.setMeta('addToHistory', false));
}

/** Writes a photo's caption, on its block wherever that's got to. */
export function setCaption(rt: EditorRuntime, block: string, media: string, cap: string): void {
  const view = editing(rt);
  const ref = view ? findBlock(view.state.doc, block) : null;
  if (!view || !ref) return;
  const key = captionKey(media);
  learnAttrs(ref.node.type, { [key]: cap });
  view.dispatch(view.state.tr.setNodeAttribute(ref.pos, key, cap === '' ? null : cap));
}

/** What every `live` block of a kind shows. Any browser in the call can write this: it only changes what's different. */
export function setLiveLines(rt: EditorRuntime, what: LiveWhat, lines: LiveLine[]): void {
  const view = editing(rt);
  if (!view) return;
  const tr = view.state.tr;
  const next = JSON.stringify(lines);
  for (const b of allBlocks(view.state.doc)) {
    if (b.node.type === n.live && b.node.attrs['what'] === what && JSON.stringify(b.node.attrs['lines']) !== next) tr.setNodeAttribute(b.pos, 'lines', lines);
  }
  if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
}

/* -------- adding blocks from outside */
const withFreshId = (node: PMNode): PMNode => (hasBlockId(node) ? node.type.create({ ...node.attrs, id: newBlockId(), gone: null }, node.content, node.marks) : node);

function insertSpan(state: EditorState, at: InsertAt): { from: number; to: number } {
  const { doc } = state;
  const end = doc.content.size;
  const start = doc.child(0).nodeSize;
  if (at === 'start') return { from: start, to: start };
  if (at === 'end') return { from: end, to: end };
  if (at === 'all') return { from: start, to: end };
  if (at === 'caret') {
    const ref = selectedBlock(state);
    if (!ref) return { from: end, to: end };
    const after = ref.pos + ref.node.nodeSize;
    return isBlank(ref.node) ? { from: ref.pos, to: after } : { from: after, to: after };
  }
  const id = 'after' in at ? at.after : 'before' in at ? at.before : at.replace;
  const ref = findBlock(doc, id);
  if (!ref) return { from: end, to: end };
  const after = ref.pos + ref.node.nodeSize;
  if ('after' in at) return { from: after, to: after };
  if ('before' in at) return { from: ref.pos, to: ref.pos };
  return { from: ref.pos, to: after };
}

export function insertBlocks(rt: EditorRuntime, blocks: BlockJSON[], at: InsertAt, options: { focus?: boolean | undefined; flash?: boolean | undefined; appear?: boolean | undefined } = {}): string[] {
  const view = editing(rt);
  if (!view || blocks.length === 0) return [];
  const nodes = blocks.map((b) => withFreshId(blockFromJSON(b)));
  const { from, to } = insertSpan(view.state, at);
  const tr = view.state.tr.replaceWith(from, to, nodes);
  const size = Fragment.fromArray(nodes).size;
  const ids = nodes.flatMap((node) => { const id = node.attrs['id']; return typeof id === 'string' ? [id] : []; });
  if (options.focus) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + size), -1)).scrollIntoView();
    view.focus();
  }
  view.dispatch(tr);
  if (options.flash) for (const id of ids) flash(view, id);
  if (options.appear) appear(view, ids);
  return ids;
}

/* -------- the selection */
const textOfSelection = (state: EditorState): string => state.doc.textBetween(state.selection.from, state.selection.to, ' ', ' ');

/** Stands for a tag in a line's text, so an offset into the text is an offset into the line. */
const TAG = '￼';

/** Holds the selection across a wait. */
function holdWords(state: EditorState): HeldWords | null {
  const { from, to } = state.selection;
  const held = holdRange(state, from, to);
  return held ? { held, quote: textOfSelection(state), block: selectedBlock(state)?.id ?? null } : null;
}

/** Words in a block, wherever it is now. */
function findWords(state: EditorState, block: string | null, quote: string): { from: number; to: number } | null {
  const ref = block ? findBlock(state.doc, block) : null;
  if (!ref || !quote) return null;
  let found: { from: number; to: number } | null = null;
  const look = (line: PMNode, pos: number) => {
    const at = line.textBetween(0, line.content.size, undefined, TAG).indexOf(quote);
    if (at >= 0) found ??= { from: pos + 1 + at, to: pos + 1 + at + quote.length };
  };
  if (ref.node.isTextblock) look(ref.node, ref.pos);
  else ref.node.descendants((node, pos) => { if (node.isTextblock) look(node, ref.pos + 1 + pos); return !node.isTextblock; });
  return found;
}

/** Where held words are now. If the block moved, their place went with it, so they're found in the block by what they say. */
function wordsNow(state: EditorState, words: HeldWords): { from: number; to: number } | null {
  const range = rangeOf(state, words.held);
  if (range && state.doc.textBetween(range.from, range.to, ' ', ' ') === words.quote) return range;
  return findWords(state, words.block, words.quote) ?? range;
}

const selectionRect = (view: EditorView): Rect => {
  const range = view.dom.ownerDocument.getSelection();
  return range && range.rangeCount > 0 ? range.getRangeAt(0).getBoundingClientRect() : view.dom.getBoundingClientRect();
};

/** Holds the selected words for a comment, then hands over a draft. ⌘⇧M and the bar's Comment both come here. */
export function startComment(rt: EditorRuntime): boolean {
  const view = editing(rt);
  const onComment = rt.props.onComment;
  if (!view || !onComment) return false;
  const { state } = view;
  const sync = syncOf(state);
  const block = selectedBlock(state)?.id;
  const words = holdWords(state);
  if (!sync || state.selection.empty || !block || !words) return false;
  const { quote, held } = words;
  const rect = selectionRect(view);
  view.dispatch(decorChange(state.tr, { held }));
  const letGo = () => { if (!view.isDestroyed) view.dispatch(decorChange(view.state.tr, { held: null })); };
  onComment({
    quote, block, rect,
    send: (message) => {
      const id = newBlockId();
      const range = wordsNow(view.state, words);
      startThread(sync.doc, id, { quote, block }, message);
      /* A thread isn't undone with ⌘Z, so what it hangs on isn't either. */
      if (range) view.dispatch(decorChange(view.state.tr.addMark(range.from, range.to, m.comment.create({ id })).setMeta('addToHistory', false), { held: null }));
      else letGo();
      return id;
    },
    cancel: letGo
  });
  return true;
}

/** Comment, in a block's menu: on the block's first five words. */
export function commentOnBlock(rt: EditorRuntime, id: string): void {
  const view = editing(rt);
  rt.menu.set(null);
  const ref = view ? findBlock(view.state.doc, id) : null;
  if (!view || !ref) return;
  const line = ref.node.isTextblock ? ref.node : ref.node.firstChild?.isTextblock ? ref.node.firstChild : null;
  if (!line || line.content.size === 0) return;
  const start = ref.pos + (line === ref.node ? 1 : 2);
  const words = /\S+(?:\s+\S+){0,4}/.exec(line.textBetween(0, line.content.size, undefined, TAG));
  if (!words) return;
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + words.index, start + words.index + words[0].length)));
  startComment(rt);
}

const lineOf = (text: string, kind?: 'todo' | undefined): BlockJSON => ({ type: 'line', attrs: kind ? { kind } : {}, content: [{ type: 'text', text }] });

/** Held words, if they still say what they said. What someone changed in them isn't to be written over. */
function sameWords(state: EditorState, words: HeldWords): { from: number; to: number } | null {
  const range = wordsNow(state, words);
  return range && state.doc.textBetween(range.from, range.to, ' ', ' ') === words.quote ? range : null;
}

export function askAboutSelection(rt: EditorRuntime): void {
  const view = rt.view;
  const onAsk = rt.props.onAsk;
  if (!view || !onAsk) return;
  const { state } = view;
  const block = selectedBlock(state)?.id;
  const words = holdWords(state);
  if (!block || state.selection.empty || !words) return;
  const { from, to } = state.selection;
  const text = state.doc.textBetween(from, to, '\n', leafWords);
  const rect = selectionRect(view);
  rt.bar.set(null);
  view.dispatch(decorChange(state.tr, { held: words.held }));

  /** What's been written so far: the words, or the line the next one follows. */
  let written: HeldRange | null = null;
  let last: string | null = null;
  const letGo = () => {
    const live = rt.view;
    if (live && holding(live.state, words.held)) live.dispatch(decorChange(live.state.tr, { held: null, asking: false }));
  };
  /** A line goes after the last one written, or under the block the words were in, or in that block's place if it's empty now. */
  const addLine = (live: EditorView, line: BlockJSON) => {
    const ref = findBlock(live.state.doc, block);
    const at: InsertAt = last ? { after: last } : !ref ? 'end' : isBlank(ref.node) ? { replace: block } : { after: block };
    last = insertBlocks(rt, [line], at, { appear: true }).at(-1) ?? last;
  };
  const writeWords = (live: EditorView, answer: string) => {
    const so = written && rangeOf(live.state, written);
    if (so) {
      live.dispatch(live.state.tr.insertText(answer, so.to));
      written = holdRange(live.state, so.from, so.to + answer.length);
      return;
    }
    const range = sameWords(live.state, words);
    if (!range) { addLine(live, lineOf(answer)); return; }
    live.dispatch(live.state.tr.insertText(answer, range.from, range.to));
    written = holdRange(live.state, range.from, range.from + answer.length);
    flash(live, block);
  };
  const writeTodo = (live: EditorView, line: string) => {
    const range = last ? null : sameWords(live.state, words);
    if (range) live.dispatch(live.state.tr.delete(range.from, range.to));
    addLine(live, lineOf(line, 'todo'));
  };

  onAsk({
    text, block, rect,
    wait: () => {
      const live = editing(rt);
      if (!live) return;
      const range = rangeOf(live.state, words.held);
      const tr = decorChange(live.state.tr, { asking: true });
      live.dispatch(range ? tr.setSelection(TextSelection.create(tr.doc, range.to)) : tr);
    },
    write: (part) => {
      const live = editing(rt);
      if (!live) return;
      letGo();
      if (part.type === 'todo') writeTodo(live, part.text);
      else writeWords(live, part.text);
    },
    done: letGo
  });
}

/** Opens the link field over the selection, or edits the link it's in. */
export function openLinkField(rt: EditorRuntime): boolean {
  const view = editing(rt);
  if (!view) return false;
  const { state } = view;
  const { from, to, empty } = state.selection;
  const words = holdWords(state);
  if (empty || !words) return false;
  let href = '';
  state.doc.nodesBetween(from, to, (node) => {
    const link = node.marks.find((x) => x.type === m.link);
    if (link && typeof link.attrs['href'] === 'string') href = link.attrs['href'];
  });
  rt.bar.set(null);
  rt.menu.set({ kind: 'link', words, href, rect: selectionRect(view) });
  return true;
}

/** Sets the link on the words, or takes it off with nothing typed. If the words have gone, there's nothing to do it to. */
export function applyLink(rt: EditorRuntime, words: HeldWords, value: string): void {
  const view = editing(rt);
  rt.menu.set(null);
  if (!view) return;
  view.focus();
  const range = wordsNow(view.state, words);
  if (!range) { rt.props.onToast?.({ icon: 'alert', text: 'Those words have gone, so the link wasn’t added.' }); return; }
  const href = safeHref(value);
  const tr = view.state.tr.removeMark(range.from, range.to, m.link);
  if (href) tr.addMark(range.from, range.to, m.link.create({ href }));
  view.dispatch(tr);
}
