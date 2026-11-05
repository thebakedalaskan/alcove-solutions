/*
 * What pressing something does: a `/` item, a tag, a row of a block's menu, a button on the format bar. These are the
 * same calls the EditorHandle makes, so a screen outside the editor gets exactly what the menus get.
 */
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { absolutePositionToRelativePosition, yUndoPluginKey } from 'y-prosemirror';
import { blockAt, blockLabel, caretInto, findBlock, isBlank, makeBlock, placeBlocks, selectedBlock, turnBlock, allBlocks, type BlockRef } from './commands';
import { startThread } from './comments';
import { galleryItems } from './blocks/attrs';
import type { SlashId } from './menus/rows';
import { appear, decorChange, flash, heldRange, type HeldRange } from './plugins/decor';
import { moveBlock } from './plugins/retire';
import type { EditorRuntime, OpenMenu } from './runtime';
import { newBlockId } from './names';
import { hasBlockId, safeHref, schema } from './schema';
import type { BlockJSON, BlockKind, InsertAt, LiveLine, LiveWhat, MentionItem, MomentLine, MovingBlock, Rect } from './types';
import { syncOf } from './ydoc';

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

/** Delete, in a block's menu: gone at once, with a moment to take it back. */
export function deleteFromMenu(rt: EditorRuntime, id: string): void {
  const view = rt.view;
  removeBlock(rt, id);
  rt.menu.set(null);
  if (!view) return;
  const manager = yUndoPluginKey.getState(view.state)?.undoManager;
  manager?.stopCapturing();
  rt.props.onToast?.({ icon: 'trash', text: 'Block deleted', label: 'Undo', run: () => { manager?.undo(); } });
}

/** A block as plain data, and what it's called. */
export function movingBlock(state: EditorState, id: string): MovingBlock | null {
  const ref = findBlock(state.doc, id);
  if (!ref) return null;
  const block: BlockJSON = ref.node.toJSON();
  return { id, block, label: blockLabel(ref.node) };
}

/** A block leaves for another document: gone from here once it's safely there. */
export async function sendBlock(rt: EditorRuntime, id: string, to: string): Promise<void> {
  rt.menu.set(null);
  const view = editing(rt);
  const moving = view ? movingBlock(view.state, id) : null;
  if (!moving || !rt.props.onMoveBlock) return;
  if (await rt.props.onMoveBlock(moving, to)) removeBlock(rt, id);
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

export function setCaption(rt: EditorRuntime, pos: number, index: number, cap: string): void {
  const node = rt.view?.state.doc.nodeAt(pos);
  if (!node) return;
  setBlockAttrs(rt, pos, { items: galleryItems(node).map((item, i) => (i === index ? { ...item, cap } : item)) }, true);
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
  const nodes = blocks.map((b) => withFreshId(schema.nodeFromJSON(b)));
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

const selectionRect = (view: EditorView): Rect => {
  const range = view.dom.ownerDocument.getSelection();
  return range && range.rangeCount > 0 ? range.getRangeAt(0).getBoundingClientRect() : view.dom.getBoundingClientRect();
};

/** Holds the selected words for a comment, then hands over a draft. ⌘⇧M and the bar's Comment both come here. */
export function startComment(rt: EditorRuntime): boolean {
  const view = rt.view;
  const onComment = rt.props.onComment;
  if (!view || !onComment) return false;
  const { state } = view;
  const sync = syncOf(state);
  const { from, to, empty } = state.selection;
  const block = selectedBlock(state)?.id;
  if (!sync || empty || !block) return false;
  const held: HeldRange = {
    anchor: absolutePositionToRelativePosition(from, sync.type, sync.binding.mapping),
    head: absolutePositionToRelativePosition(to, sync.type, sync.binding.mapping)
  };
  const rect = selectionRect(view);
  const quote = textOfSelection(state);
  view.dispatch(decorChange(state.tr, { held }));
  const letGo = () => { if (!view.isDestroyed) view.dispatch(decorChange(view.state.tr, { held: null })); };
  onComment({
    quote, block, rect,
    send: (message) => {
      const id = newBlockId();
      const range = heldRange(view.state);
      startThread(sync.doc, id, { quote, block }, message);
      if (range) view.dispatch(decorChange(view.state.tr.addMark(range.from, range.to, m.comment.create({ id })), { held: null }));
      else letGo();
      return id;
    },
    cancel: letGo
  });
  return true;
}

/** Comment, in a block's menu: on the block's first five words. */
export function commentOnBlock(rt: EditorRuntime, id: string): void {
  const view = rt.view;
  rt.menu.set(null);
  const ref = view ? findBlock(view.state.doc, id) : null;
  if (!view || !ref) return;
  const line = ref.node.isTextblock ? ref.node : ref.node.firstChild?.isTextblock ? ref.node.firstChild : null;
  if (!line || line.content.size === 0) return;
  const start = ref.pos + (line === ref.node ? 1 : 2);
  const words = line.textContent.trim().split(/\s+/).slice(0, 5).join(' ');
  const offset = Math.max(0, line.textContent.indexOf(words));
  const to = Math.min(start + offset + words.length, start + line.content.size);
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + offset, to)));
  startComment(rt);
}

export function askAboutSelection(rt: EditorRuntime): void {
  const view = rt.view;
  const onAsk = rt.props.onAsk;
  if (!view || !onAsk) return;
  const { state } = view;
  const block = selectedBlock(state)?.id;
  if (!block || state.selection.empty) return;
  const { from, to } = state.selection;
  rt.bar.set(null);
  onAsk({
    text: textOfSelection(state), block, rect: selectionRect(view),
    replace: (blocks) => {
      const live = editing(rt);
      if (!live) return;
      const nodes = blocks.map((b) => withFreshId(schema.nodeFromJSON(b)));
      live.dispatch(live.state.tr.replaceWith(Math.min(from, live.state.doc.content.size), Math.min(to, live.state.doc.content.size), nodes));
    }
  });
}

/** Opens the link field over the selection, or edits the link it's in. */
export function openLinkField(rt: EditorRuntime): boolean {
  const view = editing(rt);
  if (!view) return false;
  const { state } = view;
  const { from, to, empty } = state.selection;
  if (empty) return false;
  let href = '';
  state.doc.nodesBetween(from, to, (node) => {
    const link = node.marks.find((x) => x.type === m.link);
    if (link && typeof link.attrs['href'] === 'string') href = link.attrs['href'];
  });
  rt.bar.set(null);
  rt.menu.set({ kind: 'link', from, to, href, rect: selectionRect(view) });
  return true;
}

/** Sets the link on the range, or takes it off with nothing typed. */
export function applyLink(rt: EditorRuntime, from: number, to: number, value: string): void {
  const view = editing(rt);
  rt.menu.set(null);
  if (!view) return;
  const href = safeHref(value);
  const tr = view.state.tr.removeMark(from, to, m.link);
  if (href) tr.addMark(from, to, m.link.create({ href }));
  view.focus();
  view.dispatch(tr);
}
