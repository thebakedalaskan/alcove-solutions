/*
 * What's drawn on the blocks without being part of them: the placeholder on an empty line, the glow where something
 * landed, the fading block while it's dragged, words held for a comment, and each block's count of open comments.
 * `tr.replace` over the whole document is how every remote change arrives, so nothing here maps positions: it's all
 * worked out again from the document, which is a walk over a few hundred blocks.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { relativePositionToAbsolutePosition } from 'y-prosemirror';
import * as Y from 'yjs';
import type { EditorRuntime } from '../runtime';
import { schema, textOf } from '../schema';
import { syncOf } from '../ydoc';
import { allBlocks } from '../commands';

/** A range held by relative positions, so it stays on the same words while others type around it. */
export interface HeldRange { anchor: Y.RelativePosition; head: Y.RelativePosition }

interface DecorState { focused: boolean; flash: ReadonlySet<string>; ghost: string | null; held: HeldRange | null }

type DecorChange = Partial<Pick<DecorState, 'focused' | 'ghost' | 'held'>> & { flash?: { id: string; on: boolean } | undefined; threads?: true | undefined };

const key = new PluginKey<DecorState>('block-decor');

export const decorChange = (tr: Transaction, change: DecorChange): Transaction => tr.setMeta(key, change);

/** The range a comment is being written about, in positions. */
export function heldRange(state: EditorState): { from: number; to: number } | null {
  const held = key.getState(state)?.held;
  const sync = syncOf(state);
  if (!held || !sync) return null;
  const from = relativePositionToAbsolutePosition(sync.doc, sync.type, held.anchor, sync.binding.mapping);
  const to = relativePositionToAbsolutePosition(sync.doc, sync.type, held.head, sync.binding.mapping);
  return from === null || to === null || from === to ? null : { from: Math.min(from, to), to: Math.max(from, to) };
}

/** Comments in a block, open ones only: the first thread's ID, and how many messages there are in all. */
function threadsIn(block: PMNode, rt: EditorRuntime): { id: string; count: number } | null {
  if (rt.threads.get().size === 0) return null;
  const seen = new Set<string>();
  block.descendants((node) => {
    for (const mark of node.marks) {
      const id = mark.type === schema.marks.comment ? textOf(mark.attrs['id']) : null;
      if (id && rt.threads.get().get(id)?.open) seen.add(id);
    }
  });
  const [first] = seen;
  if (first === undefined) return null;
  let count = 0;
  for (const id of seen) count += rt.threads.get().get(id)?.count ?? 0;
  return { id: first, count };
}

export function decorPlugin(rt: EditorRuntime): Plugin {
  return new Plugin<DecorState>({
    key,
    state: {
      init: () => ({ focused: false, flash: new Set(), ghost: null, held: null }),
      apply(tr, was) {
        const change: DecorChange | undefined = tr.getMeta(key);
        if (!change) return was;
        const flash = new Set(was.flash);
        if (change.flash?.on) flash.add(change.flash.id);
        else if (change.flash) flash.delete(change.flash.id);
        return {
          focused: change.focused ?? was.focused,
          flash,
          ghost: change.ghost === undefined ? was.ghost : change.ghost,
          held: change.held === undefined ? was.held : change.held
        };
      }
    },
    props: {
      decorations(state) {
        const s = key.getState(state);
        if (!s) return null;
        const out: Decoration[] = [];
        const title = state.doc.child(0);
        if (title.content.size === 0) out.push(Decoration.node(0, title.nodeSize, { class: 'is-empty' }));
        out.push(Decoration.widget(title.nodeSize, rt.byline, { key: 'byline', side: -1, ignoreSelection: true }));

        /* A placeholder shows on the line you're on, while you're in the document. */
        const sel = state.selection;
        if (s.focused && sel instanceof TextSelection && sel.empty && sel.$from.parent.content.size === 0 && sel.$from.depth > 0 && sel.$from.parent !== title) {
          out.push(Decoration.node(sel.$from.before(), sel.$from.after(), { class: 'is-empty' }));
        }

        for (const b of allBlocks(state.doc)) {
          const classes = [];
          if (b.id && s.flash.has(b.id)) classes.push('is-flash');
          if (b.id && b.id === s.ghost) classes.push('is-ghosted');
          const threads = threadsIn(b.node, rt);
          if (classes.length || threads) {
            out.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, classes.length ? { class: classes.join(' ') } : {}, threads ? { threadId: threads.id, threadCount: threads.count } : {}));
          }
        }

        const held = heldRange(state);
        if (held) out.push(Decoration.inline(held.from, held.to, { class: 'fs' }));
        return DecorationSet.create(state.doc, out);
      },
      handleDOMEvents: {
        focus: (view) => { view.dispatch(decorChange(view.state.tr, { focused: true })); return false; },
        blur: (view) => { view.dispatch(decorChange(view.state.tr, { focused: false })); return false; }
      }
    }
  });
}

/** Makes a block glow for 1.6 s. */
export function flash(view: EditorView, id: string): void {
  view.dispatch(decorChange(view.state.tr, { flash: { id, on: false } }));
  /* Taking the class off for a frame starts the glow over if it's already going. */
  requestAnimationFrame(() => {
    if (view.isDestroyed) return;
    view.dispatch(decorChange(view.state.tr, { flash: { id, on: true } }));
    setTimeout(() => { if (!view.isDestroyed) view.dispatch(decorChange(view.state.tr, { flash: { id, on: false } })); }, 1600);
  });
}
