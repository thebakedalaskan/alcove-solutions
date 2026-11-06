/*
 * What's drawn on the blocks without being part of them: the placeholder on an empty line, the glow where something
 * landed, the fading block while it's dragged, words held for a comment, each block's count of open comments, and the
 * numbers of a numbered list, which follow every move because they're counted here and stored nowhere.
 * `tr.replace` over the whole document is how every remote change arrives, so nothing here maps positions: it's all
 * worked out again from the document, which is a walk over a few hundred blocks.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from 'y-prosemirror';
import * as Y from 'yjs';
import type { EditorRuntime } from '../runtime';
import { schema, textOf } from '../schema';
import { syncOf } from '../ydoc';
import { allBlocks, countLine } from '../commands';

/** A range held by relative positions, so it stays on the same words while others type around it. */
export interface HeldRange { anchor: Y.RelativePosition; head: Y.RelativePosition }

interface DecorState { focused: boolean; flash: ReadonlySet<string>; appear: ReadonlySet<string>; ghost: string | null; held: HeldRange | null; asking: boolean }

type DecorChange = Partial<Pick<DecorState, 'focused' | 'ghost' | 'held' | 'appear' | 'asking'>> & { flash?: { id: string; on: boolean } | undefined };

const key = new PluginKey<DecorState>('block-decor');

export const decorChange = (tr: Transaction, change: DecorChange): Transaction => tr.setMeta(key, change);

/** Holds a range across a wait: whatever is typed around it, the range stays on the same words. */
export function holdRange(state: EditorState, from: number, to: number): HeldRange | null {
  const sync = syncOf(state);
  if (!sync) return null;
  return { anchor: absolutePositionToRelativePosition(from, sync.type, sync.binding.mapping), head: absolutePositionToRelativePosition(to, sync.type, sync.binding.mapping) };
}

/** Where a held range is now, in positions. Null once nothing is left in it. */
export function rangeOf(state: EditorState, held: HeldRange): { from: number; to: number } | null {
  const sync = syncOf(state);
  if (!sync) return null;
  const from = relativePositionToAbsolutePosition(sync.doc, sync.type, held.anchor, sync.binding.mapping);
  const to = relativePositionToAbsolutePosition(sync.doc, sync.type, held.head, sync.binding.mapping);
  return from === null || to === null || from === to ? null : { from: Math.min(from, to), to: Math.max(from, to) };
}

/** The range a comment is being written about, in positions. */
function heldRange(state: EditorState): { from: number; to: number } | null {
  const held = key.getState(state)?.held;
  return held ? rangeOf(state, held) : null;
}

/** Whether these words are the ones held now: something else may have taken over since. */
export const holding = (state: EditorState, held: HeldRange): boolean => key.getState(state)?.held === held;

/** The dots beside words Alcove is writing over. */
function writingDots(): HTMLElement {
  const dots = document.createElement('span');
  dots.className = 'ac-dots wb-asking';
  dots.setAttribute('aria-hidden', 'true');
  dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  return dots;
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
      init: () => ({ focused: false, flash: new Set(), appear: new Set(), ghost: null, held: null, asking: false }),
      apply(tr, was) {
        const change: DecorChange | undefined = tr.getMeta(key);
        if (!change) return was;
        const flash = new Set(was.flash);
        if (change.flash?.on) flash.add(change.flash.id);
        else if (change.flash) flash.delete(change.flash.id);
        return {
          focused: change.focused ?? was.focused,
          flash,
          appear: change.appear ?? was.appear,
          ghost: change.ghost === undefined ? was.ghost : change.ghost,
          held: change.held === undefined ? was.held : change.held,
          asking: change.asking ?? was.asking
        };
      }
    },
    props: {
      decorations(state) {
        const s = key.getState(state);
        if (!s) return null;
        const out: Decoration[] = [];
        const title = state.doc.child(0);
        if (title.content.size === 0) out.push(Decoration.node(0, title.nodeSize, { class: 'is-empty', 'data-ph': rt.props.titleHint || 'Untitled' }));
        out.push(Decoration.widget(title.nodeSize, rt.byline, { key: 'byline', side: -1, ignoreSelection: true, stopEvent: () => true }));

        /* A placeholder shows on the line you're on, while you're in the document. */
        const sel = state.selection;
        if (s.focused && sel instanceof TextSelection && sel.empty && sel.$from.parent.content.size === 0 && sel.$from.depth > 0 && sel.$from.parent !== title) {
          out.push(Decoration.node(sel.$from.before(), sel.$from.after(), { class: 'is-empty' }));
        }

        const counts = [0, 0, 0];
        for (const b of allBlocks(state.doc)) {
          const number = countLine(counts, b.node);
          const classes = [];
          if (b.id && s.flash.has(b.id)) classes.push('is-flash');
          if (b.id && s.appear.has(b.id)) classes.push('is-appear');
          if (b.id && b.id === s.ghost) classes.push('is-ghosted');
          if (b.id && rt.props.changed?.has(b.id)) classes.push('is-added');
          const threads = threadsIn(b.node, rt);
          if (classes.length || threads || number !== null) {
            out.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, classes.length ? { class: classes.join(' ') } : {}, { number, threadId: threads?.id, threadCount: threads?.count }));
          }
        }

        const held = heldRange(state);
        if (held) out.push(Decoration.inline(held.from, held.to, { class: 'fs' }));
        if (held && s.asking) out.push(Decoration.widget(held.to, writingDots, { key: 'asking', side: 1, ignoreSelection: true }));
        return DecorationSet.create(state.doc, out);
      },
      handleDOMEvents: {
        focus: (view) => { view.dispatch(decorChange(view.state.tr, { focused: true })); return false; },
        blur: (view) => { view.dispatch(decorChange(view.state.tr, { focused: false })); return false; }
      }
    }
  });
}

/** Fades blocks in together, 140 ms, as a template's do. */
export function appear(view: EditorView, ids: readonly string[]): void {
  view.dispatch(decorChange(view.state.tr, { appear: new Set(ids) }));
  setTimeout(() => { if (!view.isDestroyed) view.dispatch(decorChange(view.state.tr, { appear: new Set() })); }, 160);
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
