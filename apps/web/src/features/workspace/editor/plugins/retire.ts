/*
 * Blocks leaving the page without their elements being deleted (../retire.ts says why), and what's left to tidy afterwards.
 *
 * - Anything done here that takes a block off the page, however it was done, puts an empty stand-in back where it was. So
 *   ProseMirror still has one node per element, y-prosemirror never deletes an element, and the element is retired just
 *   before y-prosemirror writes the rest. The stand-in is what the element will be, so the two stay the same document.
 * - `moveBlock` works on the Yjs elements directly. Left to y-prosemirror, which compares by position, a move would rewrite
 *   the text of every block it passes, and the words of anyone typing in those would land in the wrong place.
 * - A caret doesn't stay in a block that isn't on the page: it goes where the words went, or to the next block.
 * - Words someone was typing as the block left stay safe where they are. Only their author folds them into the block they
 *   were meant for, so it happens once, and that's only tidying: nothing is lost if it never happens.
 * - If two people move one block, two elements end up with one ID. Every browser retires the same one, unless someone has
 *   typed in it since: then it stays too.
 */
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { allBlocks, blockAt, findBlock } from '../commands';
import { newBlockId } from '../names';
import { followUndo, gatherWords, holdsNothing, KEPT_ATTRS, retire, settleCopies, strayWords, type StrayWords } from '../retire';
import type { EditorRuntime } from '../runtime';
import { blockIdOf, isGone, schema, textAttr } from '../schema';
import { elementOf, syncOf, type SyncBinding, type SyncState } from '../ydoc';
import { fromSync } from './blockIds';
import { flash } from './decor';

/** A block on its way off the page: its element, and the stand-in ProseMirror now has for it. */
interface Leaving { element: Y.XmlElement; node: PMNode }

const key = new PluginKey<readonly Leaving[]>('retire');

interface HeldCaret { id: string; anchor: number; head: number }

/** A selection inside one block, as offsets into it. Those survive the block going somewhere else. */
function caretOf(state: EditorState): HeldCaret | null {
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return null;
  const a = blockAt(sel.$anchor), h = blockAt(sel.$head);
  return a?.id && a.id === h?.id ? { id: a.id, anchor: sel.anchor - a.pos, head: sel.head - a.pos } : null;
}

function putCaret(view: EditorView, held: HeldCaret): void {
  const { doc } = view.state;
  const ref = findBlock(doc, held.id);
  if (!ref) return;
  const inside = (n: number) => ref.pos + Math.max(1, Math.min(ref.node.nodeSize - 1, n));
  view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(inside(held.anchor)), doc.resolve(inside(held.head)))));
}

/** Moves a block to one side of another, for everyone. Returns false if it's already there. */
export function moveBlock(rt: EditorRuntime, id: string, target: string, side: 'before' | 'after'): boolean {
  const view = rt.readOnly ? null : rt.view;
  const sync = view ? syncOf(view.state) : null;
  if (!view || !sync || id === target) return false;
  const fragment = sync.type;
  const from = elementOf(fragment, id), to = elementOf(fragment, target);
  if (!from || !to) return false;
  /* On the page it's beside there already, whatever may be between them in the document. */
  const blocks = allBlocks(view.state.doc);
  const here = blocks.findIndex((b) => b.id === id), there = blocks.findIndex((b) => b.id === target);
  if (here + (side === 'before' ? 1 : -1) === there) return false;
  const held = caretOf(view.state);
  const undo = yUndoPluginKey.getState(view.state)?.undoManager;
  /* Its own step: ⌘Z takes back the move, not the move and the typing either side of it. */
  undo?.stopCapturing();
  sync.doc.transact(() => {
    const copy = from.element.clone();
    copy.removeAttribute('gone');
    fragment.insert(to.index + (side === 'after' ? 1 : 0), [copy]);
    retire(from.element, newBlockId(), id);
  }, ySyncPluginKey);
  undo?.stopCapturing();
  if (held?.id === id) putCaret(view, held);
  flash(view, id);
  return true;
}

/** The same blocks in the same order, which is every keystroke. */
function sameBlocks(a: PMNode, b: PMNode): boolean {
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i += 1) {
    const x = a.child(i), y = b.child(i);
    if (x !== y && (x.type !== y.type || blockIdOf(x) !== blockIdOf(y))) return false;
  }
  return true;
}

/** What's left in a block once it's retired: what it's made of, and whatever this release can't read. */
const emptied = (node: PMNode): Fragment => {
  const parts: PMNode[] = [];
  node.forEach((part) => {
    if (part.type === schema.nodes.unsupportedInline) parts.push(part);
    else if (!node.inlineContent) parts.push(part.type.create(part.attrs, emptied(part)));
  });
  return Fragment.fromArray(parts);
};

/** What an element is after it's retired. */
function standIn(node: PMNode, id: string, target: string): PMNode {
  const kept = Object.fromEntries(Object.entries(node.attrs).filter(([name]) => KEPT_ATTRS.has(name)));
  return node.type.create({ ...kept, id, gone: target }, emptied(node));
}

/** Whether the block at `pos` before these changes is still there after them, for a block with no ID to tell by. */
function outlives(transactions: readonly Transaction[], pos: number): number | null {
  let at = pos;
  for (const t of transactions) {
    const mapped = t.mapping.mapResult(at, 1);
    if (mapped.deleted) return null;
    at = mapped.pos;
  }
  return at;
}

/** Puts a stand-in back for every block these changes took off the page. Returns what has to be retired. */
function keepBlocks(tr: Transaction, transactions: readonly Transaction[], before: EditorState, sync: SyncState): Leaving[] {
  const after = tr.doc;
  if (sameBlocks(before.doc, after)) return [];
  const here = new Map<PMNode, number>();
  const byId = new Map<string, { node: PMNode; pos: number }>();
  after.forEach((node, pos, index) => {
    if (index === 0) return;
    here.set(node, pos);
    const id = blockIdOf(node);
    if (id) byId.set(id, { node, pos });
  });
  const elements = sync.type.toArray();
  const out: Leaving[] = [];
  let cursor = after.child(0).nodeSize;
  let above: PMNode | null = null;
  before.doc.forEach((node, pos, index) => {
    if (index === 0) return;
    const id = blockIdOf(node);
    const same = id ? byId.get(id) : undefined;
    const stays = here.get(node) ?? (same?.node.type === node.type ? same?.pos : id === null ? outlives(transactions, pos) : null);
    if (stays !== undefined && stays !== null) {
      above = after.nodeAt(stays);
      cursor = tr.mapping.map(stays) + (above?.nodeSize ?? 0);
      return;
    }
    const element = elements[index];
    const found = element instanceof Y.XmlElement && sync.binding.mapping.get(element) === node ? element : id ? elementOf(sync.type, id)?.element : undefined;
    if (!found) return;
    /* Already off the page: it only has to stay in the document. */
    if (isGone(node)) { tr.insert(cursor, node); cursor += node.nodeSize; return; }
    /* It changed into something else that kept its ID, or it was joined to the block above: its words are at the end of that. */
    const joined: PMNode | null = above;
    const target = same ? id : node.textContent !== '' && joined?.textContent.endsWith(node.textContent) ? blockIdOf(joined) : null;
    const left = standIn(node, newBlockId(), target ?? '');
    tr.insert(cursor, left);
    cursor += left.nodeSize;
    out.push({ element: found, node: left });
  });
  return out;
}

/** The nearest place for a caret that can't stay in the block at `index`. */
function beside(doc: PMNode, index: number): Selection {
  const blocks = allBlocks(doc);
  const next = blocks.find((b) => b.index > index) ?? blocks.at(-1);
  if (next) return Selection.near(doc.resolve(next.node.isAtom ? next.pos : next.pos + 1), 1);
  return TextSelection.create(doc, doc.child(0).nodeSize - 1);
}

/** A caret in a block that's left the page goes where its words went, the same way from their end, or else beside it. */
function keepCaretOnPage(tr: Transaction, before: EditorState): void {
  const sel = tr.selection;
  const inside = sel instanceof NodeSelection && sel.$from.depth === 0 ? { node: sel.node, index: sel.$from.index(0) } : blockAt(sel.$head);
  if (!inside || !isGone(inside.node)) return;
  const target = textAttr(inside.node, 'gone');
  const to = target ? findBlock(tr.doc, target) : null;
  if (!to) { tr.setSelection(beside(tr.doc, inside.index)); return; }
  const line = to.node.type === schema.nodes.toggle ? to.node.child(0) : to.node;
  if (!line.isTextblock) { tr.setSelection(beside(tr.doc, to.index - 1)); return; }
  const { $head } = before.selection;
  const fromEnd = $head.parent.content.size - $head.parentOffset;
  tr.setSelection(TextSelection.create(tr.doc, to.pos + (line === to.node ? 1 : 2) + Math.max(0, line.content.size - fromEnd)));
}

/** Which elements are `id`-for-`id` copies, and of what: every browser picks the same ones. */
function doubles(fragment: Y.XmlFragment): { element: Y.XmlElement; keeper: Y.XmlElement; id: string }[] {
  const first = new Map<string, Y.XmlElement>();
  const out: { element: Y.XmlElement; keeper: Y.XmlElement; id: string }[] = [];
  const older = (a: Y.XmlElement, b: Y.XmlElement) => {
    const x = a._item?.id, y = b._item?.id;
    return !x || !y ? false : x.client !== y.client ? x.client < y.client : x.clock < y.clock;
  };
  for (const child of fragment.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    const id: unknown = child.getAttribute('id');
    if (typeof id !== 'string') continue;
    const seen = first.get(id);
    if (!seen) first.set(id, child);
    else if (older(child, seen)) { first.set(id, child); out.push({ element: seen, keeper: child, id }); } else out.push({ element: child, keeper: seen, id });
  }
  return out;
}

/** Writes that only tidy up, so they're no step of anyone's to undo, and don't take away what could be redone. */
const TIDYING = Symbol('tidying');

/** y-prosemirror's record of which node each element is, cleared for what's inside a block about to change under it. */
function forget(binding: SyncBinding, type: Y.XmlElement): void {
  for (const child of type.toArray()) {
    binding.mapping.delete(child);
    if (child instanceof Y.XmlElement) forget(binding, child);
  }
}

/** The same record, for a stand-in: what's left inside it is its structure, and texts with nothing in them need no entry. */
function remember(binding: SyncBinding, element: Y.XmlElement, node: PMNode): void {
  binding.mapping.set(element, node);
  let index = 0;
  for (const part of element.toArray()) {
    if (!(part instanceof Y.XmlElement) || index >= node.childCount) continue;
    remember(binding, part, node.child(index));
    index += 1;
  }
}

export function retirePlugin(rt: EditorRuntime): Plugin {
  return new Plugin<readonly Leaving[]>({
    key,
    state: {
      init: () => [],
      apply(tr, was) {
        const leaving: readonly Leaving[] | undefined = tr.getMeta(key);
        const kept = tr.getMeta('appendedTransaction') === undefined ? [] : was;
        return leaving ? [...kept, ...leaving] : kept;
      }
    },

    /* The last word on who writes: whatever a key or a menu does, someone who can only read changes nothing. */
    filterTransaction: (tr) => !tr.docChanged || fromSync(tr) || !(rt.readOnly || rt.halted),

    appendTransaction(transactions, before, after) {
      const sync = syncOf(after);
      if (!sync) return null;
      const tr = after.tr;
      const local = !transactions.some(fromSync);
      if (local && transactions.some((t) => t.docChanged && t.getMeta('appendedTransaction') === undefined)) {
        const leaving = keepBlocks(tr, transactions, before, sync);
        if (leaving.length > 0) tr.setMeta(key, leaving);
        /* A block that came back with someone's words is an ordinary block once someone works on it. */
        const worked = blockAt(tr.selection.$head);
        if (worked && textAttr(worked.node, 'gone') !== null && !isGone(worked.node)) tr.setNodeAttribute(worked.pos, 'gone', null);
        /* There's always somewhere to write. */
        if (allBlocks(tr.doc).length === 0) {
          const end = tr.doc.content.size;
          tr.insert(end, schema.nodes.line.create({ id: newBlockId() }));
          tr.setSelection(TextSelection.create(tr.doc, end + 1));
        }
      }
      keepCaretOnPage(tr, before);
      if (!tr.docChanged && !tr.selectionSet) return null;
      return transactions.some((t) => t.getMeta('addToHistory') === false) ? tr.setMeta('addToHistory', false) : tr;
    },

    view(view) {
      const sync = syncOf(view.state);
      if (!sync) return {};
      const { doc, binding, type: fragment } = sync;
      let done: readonly Leaving[] = [];

      /* Writing here, after the fact, can wait until the change that needs it is over: y-prosemirror keeps track of the selection between them. */
      const tidy = (strays: readonly StrayWords[], arrived: readonly string[], unnamed: readonly Y.XmlElement[], redone: readonly Y.XmlElement[]) => {
        queueMicrotask(() => {
          if (view.isDestroyed || rt.readOnly || rt.halted) return;
          const here = blockAt(view.state.selection.$head)?.node;
          let landed: { id: string; offset: number } | null = null;
          const copies = doubles(fragment);
          if (strays.length > 0 || copies.length > 0 || unnamed.length > 0 || redone.length > 0) {
            doc.transact(() => {
              /* First, so words gathered below go into the copy that stays. */
              for (const copy of copies) settleCopies(copy.element, copy.keeper, copy.id, newBlockId());
              for (const stray of strays) {
                const into = elementOf(fragment, stray.target);
                const offset = into ? gatherWords(stray, into.element) : null;
                if (offset !== null && here !== undefined && binding.mapping.get(stray.element) === here) landed = { id: stray.target, offset };
              }
              /* An undo took back a block's arrival, ID and all, and left its element (see `undoMayDelete`): on the page only if someone's words are in it. */
              for (const element of unnamed) {
                element.setAttribute('id', newBlockId());
                if (holdsNothing(element)) element.setAttribute('gone', '');
              }
              /* And what a redo puts back is on the page again, even a blank line. */
              for (const element of redone) element.removeAttribute('gone');
            }, TIDYING);
          }
          if (landed) {
            const { id, offset }: { id: string; offset: number } = landed;
            const ref = findBlock(view.state.doc, id);
            const line = ref?.node.type === schema.nodes.toggle ? ref.node.child(0) : ref?.node;
            if (ref && line?.isTextblock) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, ref.pos + (line === ref.node ? 1 : 2) + Math.min(offset, line.content.size))));
          }
          /* Others see a block arrive where it was dropped, as whoever dropped it does. */
          for (const id of arrived) flash(view, id);
        });
      };

      const after = (tr: Y.Transaction) => {
        const undone = tr.origin instanceof Y.UndoManager;
        if (rt.readOnly || rt.halted || (tr.local && !undone)) return;
        const strays: StrayWords[] = [];
        const arrived: string[] = [];
        const unnamed: Y.XmlElement[] = [];
        const redone: Y.XmlElement[] = [];
        tr.changed.forEach((keys, type) => {
          if (!(type instanceof Y.XmlElement) || type.parent !== fragment) return;
          if (undone && keys.has('id') && type.getAttribute('id') === undefined) unnamed.push(type);
          if (tr.origin instanceof Y.UndoManager && tr.origin.redoing && keys.has('id') && !keys.has('gone') && type.getAttribute('gone') !== undefined) redone.push(type);
          if (!keys.has('gone')) return;
          const gone: unknown = type.getAttribute('gone');
          if (typeof gone !== 'string' || gone === '') return;
          /* All of this has to be read now: what the change deleted is gone when it ends. */
          const stray = strayWords(type, tr, doc.clientID);
          if (stray) strays.push(stray);
          const into = elementOf(fragment, gone)?.element;
          const undo: Y.UndoManager | undefined = yUndoPluginKey.getState(view.state)?.undoManager;
          if (!tr.local && into) {
            if (undo) followUndo(undo, type, into, tr, doc.clientID);
            if (into.nodeName === type.nodeName) arrived.push(gone);
          }
        });
        const touched: ReadonlyMap<unknown, unknown> = tr.changed;
        if (undone || strays.length > 0 || arrived.length > 0 || touched.has(fragment)) tidy(strays, arrived, unnamed, redone);
      };

      doc.on('afterTransaction', after);
      return {
        update() {
          const leaving = key.getState(view.state) ?? [];
          if (leaving.length === 0 || leaving === done) return;
          done = leaving;
          const history = syncOf(view.state)?.addToHistory !== false;
          binding.mux(() => {
            doc.transact((tr) => {
              tr.meta.set('addToHistory', history);
              for (const { element, node } of leaving) {
                forget(binding, element);
                retire(element, blockIdOf(node) ?? newBlockId(), textAttr(node, 'gone') ?? '');
                remember(binding, element, node);
              }
            }, ySyncPluginKey);
          });
        },
        destroy() { doc.off('afterTransaction', after); }
      };
    }
  });
}
