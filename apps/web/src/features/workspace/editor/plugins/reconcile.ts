/*
 * Yjs can't move an element, only delete it and insert a copy, and a block changes kind the same way. So someone
 * typing in a block while it's moved has their words go into the deleted element, and two people moving one block
 * leave two copies. Dragging and this plugin keep that from costing anyone their words:
 *
 * - `moveBlock` edits the Yjs elements directly. Left to y-prosemirror, which compares by position, a move would
 *   rewrite the text of every block it passes, and the words of anyone typing in those would land in the wrong place.
 * - When a change deletes a block whose ID lives on in another element, whoever typed words the new element is
 *   missing puts them back. Only the author does this, so it happens once however many people are watching, and it
 *   happens whenever the change reaches them, however long they were offline.
 * - If two elements end up with one ID, every browser drops the same one: the same delete twice is the same delete.
 * - A caret in a block that moved goes with it.
 */
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { blockAt, findBlock } from '../commands';
import type { EditorRuntime } from '../runtime';
import { elementOf, syncOf } from '../ydoc';
import { flash } from './decor';

/** Marks this plugin's own writes, so it can look at them too: dropping a copy can lose words just as a move can. */
const RECONCILE = Symbol('reconcile');

/** Stands for anything in a block's text that isn't text, so two blocks can be compared. */
const OBJECT = '￼';

/** Past this many character pairs, two versions of a line are compared by their ends only. */
const MAX_COMPARE = 250_000;

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
  const view = rt.view;
  const sync = view ? syncOf(view.state) : null;
  if (!view || !sync || id === target) return false;
  const fragment = sync.type;
  const from = elementOf(fragment, id), to = elementOf(fragment, target);
  if (!from || !to) return false;
  const index = to.index + (side === 'after' ? 1 : 0);
  if (index === from.index || index === from.index + 1) return false;
  const held = caretOf(view.state);
  /* Its own step: ⌘Z takes back the move, not the move and the typing before it. */
  yUndoPluginKey.getState(view.state)?.undoManager.stopCapturing();
  sync.doc.transact(() => {
    const copy = from.element.clone();
    fragment.delete(from.index, 1);
    fragment.insert(index > from.index ? index - 1 : index, [copy]);
  }, ySyncPluginKey);
  if (held?.id === id) putCaret(view, held);
  flash(view, id);
  return true;
}

/** A block's stored ID, which still reads after it's deleted, until the end of the transaction. */
function storedId(element: Y.XmlElement): string | null {
  const [value]: unknown[] = element._map.get('id')?.content.getContent() ?? [];
  return typeof value === 'string' ? value : null;
}

interface Flat { text: string; mine: boolean[] }

/** A block's text and what's between it, with which characters are this client's. */
function flatten(type: Y.XmlElement | Y.XmlText | Y.XmlFragment, counts: (item: Y.Item) => boolean, client: number, out: Flat = { text: '', mine: [] }): Flat {
  const add = (s: string, mine: boolean) => {
    out.text += s;
    for (let i = 0; i < s.length; i += 1) out.mine.push(mine);
  };
  for (let item = type._start; item !== null; item = item.right) {
    if (!counts(item)) continue;
    const { content } = item;
    if (content instanceof Y.ContentString) add(content.str, item.id.client === client);
    else if (content instanceof Y.ContentType) {
      const inner: unknown = content.type;
      if (inner instanceof Y.XmlText) flatten(inner, counts, client, out);
      else if (inner instanceof Y.XmlElement) {
        add(OBJECT, false);
        flatten(inner, counts, client, out);
        add(OBJECT, false);
      }
    }
  }
  return out;
}

/** For each character of `a`, where it is in `b`, or -1. The longest common subsequence, so words in the middle line up. */
function align(a: string, b: string): number[] {
  const out = new Array<number>(a.length).fill(-1);
  if (a.length * b.length > MAX_COMPARE) return out;
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a.charAt(i) === b.charAt(j) ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a.charAt(i) === b.charAt(j)) { out[i] = j; i += 1; j += 1; }
    else if (at(i + 1, j) >= at(i, j + 1)) i += 1;
    else j += 1;
  }
  return out;
}

interface Insert { at: number; text: string }

/** This client's words in `was` that `now` doesn't have, and where in `now` they belong. */
function missingWords(was: Flat, now: string): Insert[] {
  let start = 0;
  while (start < was.text.length && start < now.length && was.text.charAt(start) === now.charAt(start)) start += 1;
  let end = 0;
  while (end < was.text.length - start && end < now.length - start && was.text.charAt(was.text.length - 1 - end) === now.charAt(now.length - 1 - end)) end += 1;
  const a = was.text.slice(start, was.text.length - end), b = now.slice(start, now.length - end);
  const places = align(a, b);
  const out: Insert[] = [];
  let cursor = start;
  for (let i = 0; i < a.length; i += 1) {
    const place = places[i] ?? -1;
    if (place >= 0) { cursor = start + place + 1; continue; }
    if (!was.mine[start + i]) continue;
    const last = out.at(-1);
    if (last?.at === cursor) last.text += a.charAt(i);
    else out.push({ at: cursor, text: a.charAt(i) });
  }
  return out;
}

/** Inserts text at an offset in `flatten`'s terms. Returns what's left of the offset, or null once it's in. */
function insertInto(type: Y.XmlFragment, offset: number, text: string): number | null {
  let left = offset;
  for (const child of type.toArray()) {
    if (child instanceof Y.XmlText) {
      if (left <= child.length) { child.insert(Math.max(0, left), text); return null; }
      left -= child.length;
    } else if (child instanceof Y.XmlElement) {
      left -= 1;
      if (left < 0) break;
      const rest = insertInto(child, left, text);
      if (rest === null) return null;
      left = rest - 1;
    }
  }
  return left;
}

function putBack(element: Y.XmlElement, inserts: readonly Insert[]): void {
  /* From the end, so each offset is still true when its turn comes. */
  for (const { at, text } of [...inserts].sort((a, b) => b.at - a.at)) {
    if (insertInto(element, at, text) !== null) element.insert(element.length, [new Y.XmlText(text)]);
  }
}

/** The elements to drop because another element has their ID. Every browser picks the same ones. */
function copies(fragment: Y.XmlFragment): Y.XmlElement[] {
  const first = new Map<string, Y.XmlElement>();
  const drop: Y.XmlElement[] = [];
  const older = (a: Y.XmlElement, b: Y.XmlElement) => {
    const x = a._item?.id, y = b._item?.id;
    return !x || !y ? false : x.client !== y.client ? x.client < y.client : x.clock < y.clock;
  };
  for (const child of fragment.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    const id = child.getAttribute('id');
    if (typeof id !== 'string') continue;
    const seen = first.get(id);
    if (!seen) first.set(id, child);
    else if (older(child, seen)) { first.set(id, child); drop.push(seen); } else drop.push(child);
  }
  return drop;
}

export function reconcilePlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('reconcile'),
    view(view) {
      const sync = syncOf(view.state);
      if (!sync) return {};
      const { doc, type: fragment } = sync;
      let held: HeldCaret | null = null;

      const before = () => { held = caretOf(view.state); };

      const after = (tr: Y.Transaction) => {
        /* What this browser writes on purpose needs nothing put right, except an undo, which can bring a block back beside its copy. */
        if (tr.local && tr.origin !== RECONCILE && !(tr.origin instanceof Y.UndoManager)) return;

        /* All of this has to be read now: deleted content is gone when the transaction ends. */
        const lost = new Map<string, { element: Y.XmlElement; was: Flat }>();
        const counted = (item: Y.Item) => !item.deleted || Y.isDeleted(tr.deleteSet, item.id);
        Y.iterateDeletedStructs(tr, tr.deleteSet, (struct) => {
          if (!(struct instanceof Y.Item) || !(struct.content instanceof Y.ContentType)) return;
          const parent: unknown = struct.parent;
          const element: unknown = struct.content.type;
          if (parent !== fragment) return;
          if (!(element instanceof Y.XmlElement)) return;
          const id = storedId(element);
          if (id) lost.set(id, { element, was: flatten(element, counted, doc.clientID) });
        });
        const touched: unknown[] = [...tr.changed.keys()];
        const extra = touched.includes(fragment) ? copies(fragment) : [];
        if (lost.size === 0 && extra.length === 0) return;

        const caret = held;
        /* After the transaction: y-prosemirror keeps track of the selection between them. */
        queueMicrotask(() => {
          if (view.isDestroyed) return;
          const fixes: { element: Y.XmlElement; inserts: Insert[] }[] = [];
          const moved: string[] = [];
          for (const [id, { element, was }] of lost) {
            const live = elementOf(fragment, id);
            if (!live) continue;
            const inserts = missingWords(was, flatten(live.element, (item) => !item.deleted, doc.clientID).text);
            if (inserts.length > 0) fixes.push({ element: live.element, inserts });
            if (live.element.nodeName === element.nodeName) moved.push(id);
          }
          const dropped = extra.filter((e) => e._item !== null && !e._item.deleted);
          if (fixes.length > 0 || dropped.length > 0) {
            doc.transact(() => {
              for (const fix of fixes) putBack(fix.element, fix.inserts);
              for (const copy of dropped) {
                const at = fragment.toArray().indexOf(copy);
                if (at >= 0) fragment.delete(at, 1);
              }
            }, RECONCILE);
          }
          if (caret && lost.has(caret.id)) putCaret(view, caret);
          /* Others see a block arrive where it was dropped, as whoever dropped it does. */
          if (!tr.local) for (const id of moved) flash(view, id);
        });
      };

      doc.on('beforeAllTransactions', before);
      doc.on('afterTransaction', after);
      return {
        destroy() {
          doc.off('beforeAllTransactions', before);
          doc.off('afterTransaction', after);
        }
      };
    }
  });
}
