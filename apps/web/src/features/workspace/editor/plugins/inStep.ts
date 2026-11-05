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

export function keepInStep(rt: EditorRuntime, view: EditorView): void {
  const sync = syncOf(view.state);
  if (!sync) return;
  const { binding, type: fragment } = sync;
  const follow = binding._observeFunction;
  const write = binding._prosemirrorChanged.bind(binding);

  const redraw = () => {
    try {
      binding._forceRerender();
      rt.halted = false;
    } catch (err) {
      elog.error('the page can’t be drawn from its document, so it stops writing', { err, blocks: fragment.length });
      if (!rt.halted) rt.props.onToast?.({ icon: 'alert', text: 'This page stopped following changes. Reload to keep editing.' });
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
  binding._prosemirrorChanged = (doc) => { if (!rt.readOnly && !rt.halted) write(doc); };
}
