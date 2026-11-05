/*
 * ProseMirror and Yjs have to hold the same document. y-prosemirror writes ProseMirror's document to Yjs on every view
 * update, so a change that fails on its way to ProseMirror isn't only unseen: the next keystroke here erases it for everyone.
 * So whatever goes wrong while a change is being drawn, the page is drawn again from Yjs, and if even that fails nothing is
 * written back until it works. Someone who can only read never writes at all, whatever else happens on the page.
 */
import type { EditorView } from 'prosemirror-view';
import { log } from '~/lib/log';
import type { EditorRuntime } from '../runtime';
import { syncOf, type FollowChange } from '../ydoc';

const elog = log.child({ component: 'editor' });

/** Starts looking after the view. Returns what draws it again from its document. */
export function keepInStep(rt: EditorRuntime, view: EditorView): () => void {
  const sync = syncOf(view.state);
  if (!sync) return () => undefined;
  const { binding, type: fragment } = sync;
  const follow = binding._observeFunction;
  const write = binding._prosemirrorChanged.bind(binding);

  const redraw = () => {
    const stopped = rt.halted;
    /* Nothing in the document yet means nothing has been synced: writing would make a second title. */
    rt.halted = fragment.length === 0;
    try {
      binding._forceRerender();
    } catch (err) {
      elog.error('the page can’t be drawn from its document, so it stops writing', { err, blocks: fragment.length });
      if (!stopped) rt.props.onToast?.({ icon: 'alert', text: 'This page stopped following changes. Reload to keep editing.' });
      rt.halted = true;
    }
  };

  const guarded: FollowChange = (events, tr) => {
    if (rt.halted) { redraw(); return; }
    try {
      follow(events, tr);
    } catch (err) {
      elog.warn('a change didn’t reach the page, so it’s drawn again from the document', { err, blocks: fragment.length });
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
      elog.error('a change here couldn’t be written to the document, so the page is drawn from it again', { err, blocks: fragment.length });
      /* After y-prosemirror has let go: it's in the middle of writing. */
      queueMicrotask(redraw);
    }
  };
  return redraw;
}
