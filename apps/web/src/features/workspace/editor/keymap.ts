/* The keyboard: what's on the canvas's Keyboard board, and the typed shortcuts that turn a line into a block. */
import { newBlockId } from '@alcove/api/retire';
import { exitCode, toggleMark } from 'prosemirror-commands';
import { InputRule } from 'prosemirror-inputrules';
import type { Attrs } from 'prosemirror-model';
import { TextSelection, type Command } from 'prosemirror-state';
import { redoCommand, undoCommand, yUndoPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import { changeDateTag, leaveText, nudgeBlock, openBlockMenu, openLinkField, startComment, tickLine } from './actions';
import { arrow, backspace, blockAt, deleteForward, enter, indent, lineBreak, selectAll, turnBlock } from './commands';
import { dropSpentSteps } from './retire';
import type { EditorRuntime } from './runtime';
import { isPlainLine, schema } from './schema';
import type { BlockKind } from './types';

const m = schema.marks;
const n = schema.nodes;

/** Undo that always counts as handled: the browser's own undo would fight the document's. */
const always = (command: Command): Command => (state, dispatch, view) => { command(state, dispatch, view); return true; };

/** ⌘Z takes back the last thing done here. If someone else has already taken that away, there's nothing to do, and it does nothing rather than something older. */
const undoStep: Command = (state, dispatch, view) => {
  const manager: Y.UndoManager | undefined = yUndoPluginKey.getState(state)?.undoManager;
  return (manager !== undefined && dropSpentSteps(manager)) || undoCommand(state, dispatch, view);
};

export const editorKeys = (rt: EditorRuntime): Record<string, Command> => ({
  /* On a date tag the arrow keys selected, Enter opens the calendar to change it. */
  Enter: (state, dispatch, view) => changeDateTag(rt) || enter(state, dispatch, view),
  'Shift-Enter': lineBreak,
  'Mod-Enter': (state, dispatch, view) => tickLine(rt) || exitCode(state, dispatch, view),
  Backspace: backspace,
  Delete: deleteForward,
  ArrowUp: arrow(-1, 'up'),
  ArrowDown: arrow(1, 'down'),
  ArrowLeft: arrow(-1, 'backward'),
  ArrowRight: arrow(1, 'forward'),
  Tab: indent(1),
  'Shift-Tab': indent(-1),
  'Mod-a': selectAll,
  'Mod-b': toggleMark(m.bold),
  'Mod-i': toggleMark(m.italic),
  'Mod-e': toggleMark(m.inlineCode),
  'Mod-Shift-x': toggleMark(m.strike),
  'Mod-Shift-h': toggleMark(m.highlight),
  /* With nothing selected, ⌘K is the call's Find anything. */
  'Mod-k': () => openLinkField(rt),
  'Mod-Shift-m': () => startComment(rt),
  'Mod-/': () => openBlockMenu(rt),
  /* Tab is indent here, so this is the way out for someone without a pointer. Menus take Esc first. */
  Escape: () => leaveText(rt),
  'Mod-z': always(undoStep),
  'Mod-Shift-z': always(redoCommand),
  'Mod-y': always(redoCommand),
  'Mod-Shift-ArrowUp': () => nudgeBlock(rt, -1),
  'Mod-Shift-ArrowDown': () => nudgeBlock(rt, 1)
});

/** A line that starts with one of these becomes that kind of block as you press space. */
function lineRule(pattern: RegExp, kind: BlockKind): InputRule {
  return new InputRule(pattern, (state, _, start, end) => {
    const $start = state.doc.resolve(start);
    const ref = blockAt($start);
    if (!ref || $start.depth !== 1) return null;
    const tr = state.tr.delete(start, end);
    const line = blockAt(tr.doc.resolve(start));
    if (!line) return null;
    turnBlock(tr, line, kind);
    return tr;
  });
}

/** `---` and a space is a divider, with a line to carry on in. */
const dividerRule = new InputRule(/^---\s$/, (state, _, start, end) => {
  const $start = state.doc.resolve(start);
  const ref = blockAt($start);
  if (!ref || $start.depth !== 1 || !isPlainLine(ref.node) || end - start !== ref.node.content.size) return null;
  const attrs: Attrs = { id: ref.id };
  const tr = state.tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, [n.divider.create(attrs), n.line.create({ id: newBlockId() })]);
  return tr.setSelection(TextSelection.near(tr.doc.resolve(ref.pos + 2)));
});

export const typedShortcuts: InputRule[] = [
  lineRule(/^#\s$/, 'h1'),
  lineRule(/^##\s$/, 'h2'),
  lineRule(/^###\s$/, 'h3'),
  lineRule(/^[-*]\s$/, 'bullet'),
  lineRule(/^1\.\s$/, 'numbered'),
  lineRule(/^\[ ?\]\s$/, 'todo'),
  lineRule(/^>\s$/, 'quote'),
  dividerRule
];
