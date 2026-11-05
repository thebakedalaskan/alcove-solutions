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
import { DocCaretStateSchema, firstName } from '@alcove/api';
import { log } from '~/lib/log';
import type { Caret, EditorRuntime } from '../runtime';
import { syncOf } from '../ydoc';

/** How long a caret keeps its name after it last moved. */
const QUIET = 3000;

const key = new PluginKey<DecorationSet>('carets');

const elog = log.child({ component: 'editor-carets' });

interface Other { client: number; user: { id: string | null; name: string }; anchor: number; head: number }

/** Who sent something that can't be read, so one browser repeating itself is one line in the log. */
const refused = new WeakMap<Awareness, Set<number>>();
function refuse(awareness: Awareness, client: number, err: unknown): void {
  const seen = refused.get(awareness) ?? new Set<number>();
  refused.set(awareness, seen);
  if (seen.has(client)) return;
  seen.add(client);
  elog.warn('a caret from another browser can’t be read, so it isn’t shown', { client, err });
}

/**
 * Where everyone else is. All of this came from other browsers: a caret that can't be read or placed isn't drawn, and
 * nothing it holds gets as far as stopping the page.
 */
function othersIn(state: EditorState, awareness: Awareness): Other[] {
  const sync = syncOf(state);
  if (!sync || sync.binding.mapping.size === 0) return [];
  const out: Other[] = [];
  const max = Math.max(state.doc.content.size - 1, 0);
  awareness.getStates().forEach((aw, client) => {
    if (client === sync.doc.clientID) return;
    const parsed = DocCaretStateSchema.safeParse(aw);
    if (!parsed.success) { refuse(awareness, client, parsed.error); return; }
    const { cursor, user } = parsed.data;
    if (!cursor) return;
    try {
      const anchor = relativePositionToAbsolutePosition(sync.doc, sync.type, Y.createRelativePositionFromJSON(cursor.anchor), sync.binding.mapping);
      const head = relativePositionToAbsolutePosition(sync.doc, sync.type, Y.createRelativePositionFromJSON(cursor.head), sync.binding.mapping);
      if (anchor === null || head === null) return;
      out.push({ client, user: { id: user?.id ?? null, name: user?.name ?? '' }, anchor: Math.max(0, Math.min(anchor, max)), head: Math.max(0, Math.min(head, max)) });
    } catch (err) { refuse(awareness, client, err); }
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
      let at: ReturnType<EditorView['coordsAtPos']>;
      try { at = view.coordsAtPos(o.head, 1); } catch (err) { refuse(awareness, o.client, err); continue; }
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
      let sent: { anchor: Y.RelativePosition; head: Y.RelativePosition } | null = null;
      /* A caret at the end of a line stays at the same place in Yjs as words go in before it, so typing says so itself: that's what brings a name back. */
      let typed = 0;

      /* Tells everyone where this browser's caret is. */
      const publish = () => {
        const sync = syncOf(view.state);
        if (!sync || sync.binding.mapping.size === 0) return;
        if (!view.hasFocus()) {
          if (sent) awareness.setLocalStateField('cursor', null);
          sent = null;
          return;
        }
        const { anchor: a, head: h } = view.state.selection;
        const anchor = absolutePositionToRelativePosition(a, sync.type, sync.binding.mapping);
        const head = absolutePositionToRelativePosition(h, sync.type, sync.binding.mapping);
        if (sent && Y.compareRelativePositions(sent.anchor, anchor) && Y.compareRelativePositions(sent.head, head)) return;
        sent = { anchor, head };
        awareness.setLocalStateField('cursor', sent);
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
        update: (_, before) => {
          publish();
          if (view.state.doc !== before.doc && !syncOf(view.state)?.isChangeOrigin) awareness.setLocalStateField('typed', ++typed);
          draw(view);
        },
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
