/*
 * The board's keys. M, V and C stay the call's, in every mode, so nobody turns their camera off by reaching for a tool.
 * That's why Select is Esc. Nothing here takes a key going into a field, such as a sticky being typed in. Otherwise the
 * board's keys work at once whenever the sheet has the keys, straight after Esc finishes a sticky too: the moment's pause
 * after typing (`typing`, lib/keys.ts) is for the call's keys and the app's, which the board leaves alone. A field taken from
 * under someone still typing, by the board or by the page, counts as still being typed in until they click, tap or press Esc
 * (`holdBoardKeys`, `caretTaken`), so the rest of their sentence never makes or deletes anything. A key the board acted on goes
 * no further, so the call and the app don't act on it too, and anything else is left for them. While a vote is on, Tab goes
 * from sticky to sticky in it, and Enter or Space votes (`voteKey`). Following whoever presents, a key of the board's is this
 * person starting on their own: it takes them off following, where they are, and does what it does; Esc takes them back to
 * their own view, as Unfollow does.
 */
import type { BoardTool } from '@alcove/ui';
import { caretTaken, editable, withShortcutKey } from '~/lib/keys';
import type { Board } from '../useBoard';

/**
 * A field someone was typing in was taken from them by the board, as a sticky deleted under them or the board closing or
 * going out of reach, and they haven't clicked, tapped or pressed Esc since: they may not know yet.
 */
let held = false;
if (typeof window !== 'undefined') {
  /* Before the sheet hears the key or the press. */
  addEventListener('pointerdown', () => { held = false; }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') held = false; }, true);
}
/** The board took a field from someone typing in it: its keys sleep until they click, tap or press Esc. */
export const holdBoardKeys = (): void => { held = true; };

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

/**
 * While a vote is on, for whoever can vote: Tab from the sheet goes to the first sticky it takes, and on from sticky to sticky
 * in the order they're read (`BoardBallot.order`), the board gliding to one out of view; past the last, Tab goes on as it does
 * from anything. Shift and Tab go back, to the sheet from the first. Enter or Space on a sticky votes for it, or takes the vote
 * back, as a press does. With a tool's options open, Tab from the sheet goes to them, as it always does. Says whether the key
 * was the vote's.
 */
function voteKey(board: Board, e: KeyboardEvent, k: string): boolean {
  const { ballot } = board;
  const sheet = e.currentTarget;
  if (!ballot || !(sheet instanceof HTMLElement)) return false;
  const on = e.target instanceof HTMLElement && e.target.matches('.bo[data-id]') ? e.target.getAttribute('data-id') : null;
  if (k === 'enter' || k === ' ') {
    if (on === null || !ballot.takes(on)) return false;
    if (!e.repeat) ballot.press(on);
    return true;
  }
  if (k !== 'tab') return false;
  if (on === null && (e.target !== sheet || e.shiftKey || board.getSnapshot().fly !== null)) return false;
  const order = ballot.order();
  const at = on === null ? -1 : order.indexOf(on);
  if (on !== null && at < 0) return false;
  const to = e.shiftKey ? at - 1 : at + 1;
  if (to < 0) {
    board.focusSheet();
    return true;
  }
  const id = order[to];
  if (id === undefined) return false;
  board.reveal(id);
  // Past 500 things on the board only what's near the view is drawn, so one out of it is there once the glide has begun.
  let tries = 0;
  const put = (): void => {
    const sticky = sheet.querySelector(`.bo[data-id="${CSS.escape(id)}"]`);
    if (sticky instanceof HTMLElement) sticky.focus({ preventScroll: true });
    else if (tries++ < 30) requestAnimationFrame(put);
  };
  put();
  return true;
}

export function keyDown(board: Board, e: KeyboardEvent): void {
  if (editable(e.target) || e.altKey) return;
  const mod = withShortcutKey(e);
  if (!mod && (e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (!mod && CALL_KEYS.has(k)) return;
  /* Esc has already ended both by the time it gets here. */
  if (!mod && (held || caretTaken())) return;
  if (!mod && voteKey(board, e, k)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (k === ' ' && !mod) {
    if (onControl(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!board.getSnapshot().space) board.set({ space: true });
    return;
  }
  const key = keyFor(e.shiftKey && k === '1' ? '!' : k, mod);
  if (!key || (key.edits && !board.canEdit)) return;
  if (k !== 'escape') board.ownView();
  if (!key.run(board, e)) return;
  e.preventDefault();
  e.stopPropagation();
}

export function keyUp(board: Board, e: KeyboardEvent): void {
  if (e.key === ' ' && board.getSnapshot().space) board.set({ space: false });
}
