/*
 * Everything that follows the text as it changes, in one place: `/` and `@` opening and narrowing as you type, the
 * format bar over a selection, the title reaching the list, and where the writer is for presence. A remote change
 * replaces the whole document, so all of it is worked out again from the state instead of being mapped.
 */
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { allBlocks, blockAt, isBlank, selectedBlock } from '../commands';
import { slashGroups } from '../menus/rows';
import type { EditorRuntime, FormatBarState, OpenMenu } from '../runtime';
import { schema } from '../schema';
import type { EditorPresence } from '../types';
import { syncOf } from '../ydoc';

const TITLE_WAIT = 300;
const TYPING_HOLD = 1500;

const m = schema.marks;

/** Whether the page has nothing on it but its title. */
const nothingWritten = (state: EditorState) => allBlocks(state.doc).every((b) => isBlank(b.node));

interface Trigger { kind: 'slash' | 'mention'; block: string; from: number; to: number; query: string }

/** The `/word` or `@word` the caret is at the end of. `/` makes blocks, so it only works on a line of its own level. */
function triggerAt(state: EditorState): Trigger | null {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return null;
  const $c = sel.$from, parent = $c.parent;
  if (!parent.isTextblock || parent.type.spec.code || parent.type === schema.nodes.title) return null;
  const block = blockAt($c)?.id;
  if (!block) return null;
  const before = parent.textBetween(0, $c.parentOffset, undefined, '\n');
  const slash = $c.depth === 1 ? /(?:^|\s)\/([^\s/]{0,18})$/.exec(before) : null;
  const mention = /(?:^|\s)@([^\s@]{0,18})$/.exec(before);
  const hit = slash ?? mention;
  if (!hit) return null;
  const query = hit[1] ?? '';
  return { kind: slash ? 'slash' : 'mention', block, from: $c.pos - query.length - 1, to: $c.pos, query };
}

const sameMenu = (a: OpenMenu, t: Trigger) => a.kind === t.kind && a.block === t.block && a.from === t.from && a.to === t.to && a.query === t.query;

function followTrigger(rt: EditorRuntime, state: EditorState, typed: boolean): void {
  const t = triggerAt(state);
  if (!t) rt.dismissed = null;
  const open = rt.menu.get();
  /* A search that's found nothing for three letters isn't a search. */
  const wanted = t && !(t.kind === 'slash' && t.query.length > 2 && slashGroups(t.query, rt.props.call !== undefined, rt.props.onPick !== undefined).length === 0) ? t : null;
  if (open && (open.kind === 'slash' || open.kind === 'mention')) {
    if (!wanted || wanted.kind !== open.kind) rt.menu.set(null);
    else if (!sameMenu(open, wanted)) rt.menu.set(wanted);
    return;
  }
  if (typed && open && (open.kind === 'documents' || open.kind === 'moment' || open.kind === 'block')) rt.menu.set(null);
  if (typed && wanted && rt.dismissed !== wanted.from && !rt.readOnly) rt.menu.set(wanted);
}

/** What the bar over a selection shows, or null where it doesn't belong. */
function barFor(rt: EditorRuntime, view: EditorView): FormatBarState | null {
  const { state } = view;
  const sel = state.selection;
  if (rt.readOnly || rt.selecting || rt.menu.get() || rt.drag.get() || !view.hasFocus()) return null;
  if (!(sel instanceof TextSelection) || sel.empty) return null;
  const canMark = sel.$from.parent.type.allowsMarkType(m.bold) && sel.$to.parent.type.allowsMarkType(m.bold);
  const dom = view.dom.ownerDocument.getSelection();
  if (!canMark || !dom || dom.rangeCount === 0) return null;
  const rect = dom.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const on = (type: typeof m.bold) => state.doc.rangeHasMark(sel.from, sel.to, type);
  return { rect, bold: on(m.bold), italic: on(m.italic), strike: on(m.strike), link: on(m.link), highlight: on(m.highlight) };
}

export function watchPlugin(rt: EditorRuntime): Plugin {
  return new Plugin({
    key: new PluginKey('watch'),
    view(view) {
      let title = view.state.doc.child(0).textContent;
      let titleTimer: ReturnType<typeof setTimeout> | undefined;
      let typingTimer: ReturnType<typeof setTimeout> | undefined;
      let frame = 0;
      let presence: EditorPresence = { block: null, typing: false };

      const tell = (next: EditorPresence) => {
        if (next.block === presence.block && next.typing === presence.typing) return;
        presence = next;
        rt.props.onPresence?.(next);
      };
      const showBar = () => { rt.bar.set(barFor(rt, view)); };
      rt.blank.set(nothingWritten(view.state));
      const onDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        rt.selecting = true;
        rt.bar.set(null);
      };
      const onUp = () => {
        if (!rt.selecting) return;
        rt.selecting = false;
        /* The click that made the selection lands first. */
        setTimeout(showBar, 0);
      };
      const onScroll = () => {
        if (frame || !rt.bar.get()) return;
        frame = requestAnimationFrame(() => { frame = 0; showBar(); });
      };
      view.dom.addEventListener('mousedown', onDown);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('scroll', onScroll, true);

      return {
        update(_, prev) {
          const state = view.state;
          const sync = syncOf(state);
          const remote = sync?.isChangeOrigin === true;
          const changed = state.doc !== prev.doc;
          const typed = changed && !remote;
          followTrigger(rt, state, typed);
          showBar();
          if (changed) rt.blank.set(nothingWritten(state));

          const nextTitle = state.doc.child(0).textContent;
          if (nextTitle !== title) {
            title = nextTitle;
            if (!remote || sync?.isUndoRedoOperation) {
              clearTimeout(titleTimer);
              titleTimer = setTimeout(() => rt.props.onTitle?.(nextTitle), TITLE_WAIT);
            }
          }

          if (typed) {
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => tell({ ...presence, typing: false }), TYPING_HOLD);
          }
          tell({ block: selectedBlock(state)?.id ?? null, typing: typed || presence.typing });
          rt.layout.set(rt.layout.get() + 1);
        },
        destroy() {
          clearTimeout(titleTimer);
          clearTimeout(typingTimer);
          cancelAnimationFrame(frame);
          view.dom.removeEventListener('mousedown', onDown);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('scroll', onScroll, true);
        }
      };
    }
  });
}
