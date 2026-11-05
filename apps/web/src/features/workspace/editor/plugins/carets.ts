/*
 * Other people in the document. Their selection is a decoration on the text. Their caret is drawn over the text, by
 * blocks/Carets.tsx, instead of being a widget inside it: nothing gets inserted in the words you're typing, which
 * keeps IME composition and spellcheck undisturbed, and a caret's name can fade without being redrawn.
 */
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from 'y-prosemirror';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { firstName } from '@alcove/api';
import type { Caret, EditorRuntime } from '../runtime';
import { syncOf } from '../ydoc';

/** How long a caret keeps its name after it last moved. */
const QUIET = 3000;

const key = new PluginKey<DecorationSet>('carets');

interface Other { client: number; user: { id: string | null; name: string }; anchor: number; head: number }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** What's on the wire: a person's `cursor` and `user` from their awareness state. Awareness comes from other browsers. */
function cursorOf(state: unknown): { anchor: unknown; head: unknown } | null {
  if (!isRecord(state)) return null;
  const c = state['cursor'];
  return isRecord(c) && c['anchor'] !== undefined && c['head'] !== undefined ? { anchor: c['anchor'], head: c['head'] } : null;
}
function userOf(state: unknown): { id: string | null; name: string } {
  const u = isRecord(state) ? state['user'] : null;
  if (!isRecord(u)) return { id: null, name: '' };
  const id = u['id'], name = u['name'];
  return { id: typeof id === 'string' ? id : null, name: typeof name === 'string' ? name : '' };
}

function othersIn(state: EditorState, awareness: Awareness): Other[] {
  const sync = syncOf(state);
  if (!sync || sync.binding.mapping.size === 0) return [];
  const out: Other[] = [];
  const max = Math.max(state.doc.content.size - 1, 0);
  awareness.getStates().forEach((aw, client) => {
    if (client === sync.doc.clientID) return;
    const cursor = cursorOf(aw);
    if (!cursor) return;
    const anchor = relativePositionToAbsolutePosition(sync.doc, sync.type, Y.createRelativePositionFromJSON(cursor.anchor), sync.binding.mapping);
    const head = relativePositionToAbsolutePosition(sync.doc, sync.type, Y.createRelativePositionFromJSON(cursor.head), sync.binding.mapping);
    if (anchor === null || head === null) return;
    out.push({ client, user: userOf(aw), anchor: Math.min(anchor, max), head: Math.min(head, max) });
  });
  return out;
}

const selections = (state: EditorState, awareness: Awareness): DecorationSet => DecorationSet.create(
  state.doc,
  othersIn(state, awareness).flatMap((o) => o.anchor === o.head ? [] : [Decoration.inline(Math.min(o.anchor, o.head), Math.max(o.anchor, o.head), { class: 'rs' }, { inclusiveStart: false, inclusiveEnd: true })])
);

export function caretsPlugin(rt: EditorRuntime, awareness: Awareness): Plugin {
  const moved = new Map<number, number>();
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  /** Where everyone's caret is now, relative to the editor. */
  const measure = (view: EditorView) => {
    const root = rt.root;
    if (!root || view.isDestroyed) return;
    const box = root.getBoundingClientRect();
    const now = Date.now();
    const out: Caret[] = [];
    for (const o of othersIn(view.state, awareness)) {
      const at = view.coordsAtPos(o.head, 1);
      /* A caret inside a closed toggle has nowhere to be. */
      if (at.bottom === at.top) continue;
      const person = o.user.id ? rt.people.get(o.user.id) : undefined;
      const name = person?.name ?? o.user.name;
      out.push({ client: o.client, top: at.top - box.top, left: at.left - box.left, height: at.bottom - at.top, name: firstName(name), person, tag: now - (moved.get(o.client) ?? 0) < QUIET });
    }
    rt.carets.set(out);
  };

  /* Once a frame at most, when layout has settled, so a keystroke never waits on measuring. */
  const draw = (view: EditorView) => {
    if (frame === 0) frame = requestAnimationFrame(() => { frame = 0; measure(view); });
  };

  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => selections(state, awareness),
      apply(tr, was, _old, next) {
        return tr.getMeta(key) || syncOf(next)?.isChangeOrigin ? selections(next, awareness) : was.map(tr.mapping, tr.doc);
      }
    },
    props: { decorations: (state) => key.getState(state) },
    view(view) {
      /* Tells everyone where this browser's caret is. */
      const publish = () => {
        const sync = syncOf(view.state);
        if (!sync || sync.binding.mapping.size === 0) return;
        const current = awareness.getLocalState();
        if (!view.hasFocus()) {
          if (cursorOf(current)) awareness.setLocalStateField('cursor', null);
          return;
        }
        const { anchor: a, head: h } = view.state.selection;
        const anchor = absolutePositionToRelativePosition(a, sync.type, sync.binding.mapping);
        const head = absolutePositionToRelativePosition(h, sync.type, sync.binding.mapping);
        const was = cursorOf(current);
        if (was && Y.compareRelativePositions(Y.createRelativePositionFromJSON(was.anchor), anchor) && Y.compareRelativePositions(Y.createRelativePositionFromJSON(was.head), head)) return;
        awareness.setLocalStateField('cursor', { anchor, head });
      };

      const changed = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        /* This browser's own caret is published from inside a view update, and isn't drawn anyway. */
        const others = [...added, ...updated, ...removed].filter((client) => client !== awareness.clientID);
        if (others.length === 0) return;
        const now = Date.now();
        for (const client of [...added, ...updated]) moved.set(client, now);
        for (const client of removed) moved.delete(client);
        clearTimeout(quiet);
        quiet = setTimeout(() => draw(view), QUIET + 20);
        view.dispatch(view.state.tr.setMeta(key, true));
      };

      /* A block growing or a font arriving moves the text under the carets. */
      const resized = new ResizeObserver(() => draw(view));
      resized.observe(view.dom);

      awareness.on('change', changed);
      view.dom.addEventListener('focusin', publish);
      view.dom.addEventListener('focusout', publish);
      draw(view);
      return {
        update: () => { publish(); draw(view); },
        destroy: () => {
          clearTimeout(quiet);
          cancelAnimationFrame(frame);
          resized.disconnect();
          awareness.off('change', changed);
          view.dom.removeEventListener('focusin', publish);
          view.dom.removeEventListener('focusout', publish);
          awareness.setLocalStateField('cursor', null);
          rt.carets.set([]);
        }
      };
    }
  });
}
