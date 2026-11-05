/*
 * ProseMirror and Yjs have to hold the same document. y-prosemirror writes ProseMirror's document to Yjs on every view
 * update, so a change that fails on its way to ProseMirror isn't only unseen: the next keystroke here erases it for everyone.
 * So whatever goes wrong while a change is being drawn, the page is drawn again from Yjs, and if even that fails nothing is
 * written back until it works. Someone who can only read never writes at all, whatever else happens on the page.
 *
 * Whoever is typing shouldn't notice any of this: the selection stays where it was, by block, or goes to the nearest place
 * there is, and a key that couldn't be written is written again.
 */
import type { Node as PMNode, NodeType } from 'prosemirror-model';
import { NodeSelection, Selection, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { getRelativeSelection, relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror';
import { log } from '~/lib/log';
import { BlocksSelection, findBlock } from '../commands';
import type { EditorRuntime } from '../runtime';
import { blockIdOf } from '../schema';
import { writeDocument } from '../write';
import { syncOf, type FollowChange } from '../ydoc';
import { beside, caretBefore, retireLeaving } from './retire';

const elog = log.child({ component: 'editor' });

/** Somewhere in a document that survives it being drawn again: which block, and how far into it. */
interface Spot { id: string | null; index: number; offset: number }

interface HeldSelection { anchor: Spot; head: Spot; whole: NodeType | null; blocks: boolean }

function holdSelection(state: EditorState): HeldSelection {
  const { doc, selection: sel } = state;
  const spot = (pos: number): Spot => {
    const $pos = doc.resolve(pos);
    const index = $pos.index(0);
    const start = $pos.depth > 0 ? $pos.before(1) : pos;
    return { id: blockIdOf(doc.child(Math.min(index, doc.childCount - 1))), index, offset: pos - start };
  };
  return { anchor: spot(sel.anchor), head: spot(sel.head), whole: sel instanceof NodeSelection ? sel.node.type : null, blocks: sel instanceof BlocksSelection };
}

/** Where a spot is now: in its block, wherever that's gone, or beside where it was. */
function placeOf(doc: PMNode, spot: Spot): number {
  const block = spot.id === null ? null : findBlock(doc, spot.id);
  if (block) return block.pos + Math.min(spot.offset, block.node.nodeSize - 1);
  if (spot.index === 0) return Math.min(spot.offset, doc.child(0).nodeSize - 1);
  return beside(doc, spot.index, false).from;
}

function selectionFor(doc: PMNode, held: HeldSelection, known: number | null): Selection {
  if (held.blocks) return new BlocksSelection(doc);
  const anchor = placeOf(doc, held.anchor);
  const atNode = (pos: number) => held.whole !== null && doc.nodeAt(pos)?.type === held.whole;
  if (known !== null && atNode(known)) return NodeSelection.create(doc, known);
  if (atNode(anchor)) return NodeSelection.create(doc, anchor);
  /* What was selected has gone: the caret goes where it was. */
  if (held.whole) return Selection.near(doc.resolve(known ?? anchor), 1);
  return TextSelection.between(doc.resolve(anchor), doc.resolve(placeOf(doc, held.head)));
}

/** Starts looking after the view. Returns what draws it again from its document. */
export function keepInStep(rt: EditorRuntime, view: EditorView): () => void {
  const sync = syncOf(view.state);
  if (!sync) return () => undefined;
  const { binding, type: fragment, doc: ydoc } = sync;
  const follow: FollowChange = binding._observeFunction;
  /* Null between changes, whatever its types say. */
  const caret: { beforeTransactionSelection: unknown } = binding;

  const putSelection = (held: HeldSelection, known: number | null) => {
    const { state } = view;
    view.dispatch(state.tr.setSelection(selectionFor(state.doc, held, known)));
  };

  const redraw = () => {
    const stopped = rt.halted;
    const held = holdSelection(view.state);
    const before = caret.beforeTransactionSelection;
    /* Nothing in the document yet means nothing has been synced: writing would make a second title. */
    rt.halted = fragment.length === 0;
    try {
      /* Saying there's one stops it placing a selection of its own by number, which can't mean anything in a document drawn again. */
      binding.beforeTransactionSelection = getRelativeSelection(binding, view.state);
      binding._forceRerender();
      caret.beforeTransactionSelection = before;
      putSelection(held, null);
    } catch (err) {
      caret.beforeTransactionSelection = before;
      elog.error('the page can’t be drawn from its document, so it stops writing', { err, blocks: fragment.length });
      if (!stopped) rt.props.onToast?.({ icon: 'alert', text: 'This page stopped following changes. Reload to keep editing.' });
      rt.halted = true;
    }
  };

  const guarded: FollowChange = (events, tr) => {
    if (rt.halted) { redraw(); return; }
    /* y-prosemirror can't put back a selection of something that may have gone, or of all the blocks, so that's done here. */
    const { selection } = view.state;
    const whole = selection instanceof NodeSelection || selection instanceof BlocksSelection ? holdSelection(view.state) : null;
    const relative = binding.beforeTransactionSelection;
    try {
      if (whole) caret.beforeTransactionSelection = null;
      follow(events, tr);
      if (whole) {
        const known = whole.whole && relative ? relativePositionToAbsolutePosition(ydoc, fragment, relative.anchor, binding.mapping) : null;
        binding.mux(() => { putSelection(whole, known); });
      }
    } catch (err) {
      elog.warn('a change didn’t reach the page, so it’s drawn again from the document', { err, blocks: fragment.length });
      redraw();
    }
  };

  const write = (doc: PMNode) => {
    ydoc.transact(() => {
      retireLeaving(view);
      writeDocument(ydoc, fragment, doc, binding, caretBefore(view));
      binding.beforeTransactionSelection = getRelativeSelection(binding, view.state);
    }, ySyncPluginKey);
  };

  /* Once more, on its own, after y-prosemirror has let go of the change it was writing. What's on the page is the person's. */
  const writeAgain = (first: unknown) => {
    if (view.isDestroyed || rt.readOnly || rt.halted) return;
    try {
      binding.mux(() => { write(view.state.doc); });
    } catch (err) {
      elog.error('a change here couldn’t be written to the document, so the page is drawn from it again', { err, first, blocks: fragment.length });
      rt.props.onToast?.({ icon: 'alert', text: 'Your last edit couldn’t be saved, so it’s been taken back.' });
      redraw();
    }
  };

  fragment.unobserveDeep(follow);
  fragment.observeDeep(guarded);
  binding._observeFunction = guarded;
  binding._prosemirrorChanged = (doc) => {
    if (rt.readOnly || rt.halted) return;
    try {
      write(doc);
    } catch (err) {
      elog.warn('a change here couldn’t be written to the document, so it’s tried again', { err, blocks: fragment.length });
      queueMicrotask(() => { writeAgain(err); });
    }
  };
  return redraw;
}
