/*
 * The board's keys. M, V and C stay the call's, in every mode, so nobody turns their camera off by reaching for a tool.
 * That's why Select is Esc. Everything here sleeps while someone types in a sticky, so letters are letters. A key the board
 * acted on goes no further, so the call and the app don't act on it too, and anything else is left for them.
 */
import type { BoardTool } from '@alcove/ui';
import { typing, withShortcutKey } from '~/lib/keys';
import type { Board } from './useBoard';

interface BoardKey {
  /** It changes the board, so it's not for someone who can only look. */
  edits: boolean;
  /** Does what the key does. False if there was nothing to do, which leaves the key for the call. */
  run: (board: Board, e: KeyboardEvent) => boolean;
}

/** Never the board's, whatever is added below. */
const CALL_KEYS: ReadonlySet<string> = new Set(['m', 'v', 'c']);

/** The tools, by key. */
export const TOOL_KEYS = new Map<string, BoardTool>([['n', 'note'], ['t', 'text'], ['s', 'shape'], ['l', 'line'], ['p', 'pen'], ['f', 'frame']]);

const did = (run: (board: Board, e: KeyboardEvent) => void): BoardKey['run'] => (board, e) => {
  run(board, e);
  return true;
};
const show: BoardKey = { edits: false, run: did((board) => board.showEverything()) };
const zoomIn: BoardKey = { edits: false, run: did((board) => board.zoomIn()) };
const zoomOut: BoardKey = { edits: false, run: did((board) => board.zoomOut()) };
const remove: BoardKey = { edits: true, run: (board) => board.removeSelected() };

/** With ⌘, or Ctrl off a Mac. */
const MOD_KEYS = new Map<string, BoardKey>([
  ['z', { edits: true, run: did((board, e) => { if (e.shiftKey) board.redo(); else board.undo(); }) }],
  ['d', { edits: true, run: did((board) => board.duplicateSelected()) }],
  ['a', { edits: true, run: did((board) => board.selectAll()) }]
]);

const PLAIN_KEYS = new Map<string, BoardKey>([
  ['escape', { edits: false, run: (board) => board.escape() }],
  ['backspace', remove],
  ['delete', remove],
  ['k', { edits: true, run: (board) => board.runMore('comment') }],
  ['!', show],
  ['=', zoomIn],
  ['+', zoomIn],
  ['-', zoomOut]
]);

const keyFor = (k: string, mod: boolean): BoardKey | undefined => {
  if (mod) return MOD_KEYS.get(k);
  const tool = TOOL_KEYS.get(k);
  return tool ? { edits: true, run: did((board) => board.pickTool(tool)) } : PLAIN_KEYS.get(k);
};

/** Whether a key press belongs to a button or a link inside the sheet, which Space would otherwise be taken from. */
const onControl = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('button, a');

export function keyDown(board: Board, e: KeyboardEvent): void {
  if (typing(e.target) || e.altKey) return;
  const mod = withShortcutKey(e);
  if (!mod && (e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (!mod && CALL_KEYS.has(k)) return;
  if (k === ' ' && !mod) {
    if (onControl(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!board.getSnapshot().space) board.set({ space: true });
    return;
  }
  const key = keyFor(e.shiftKey && k === '1' ? '!' : k, mod);
  if (!key || (key.edits && !board.canEdit) || !key.run(board, e)) return;
  e.preventDefault();
  e.stopPropagation();
}

export function keyUp(board: Board, e: KeyboardEvent): void {
  if (e.key === ' ' && board.getSnapshot().space) board.set({ space: false });
}
