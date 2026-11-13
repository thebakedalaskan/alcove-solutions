/*
 * A board someone asked to open as their call starts: Start a call here, on a board's page (docs: Calls and recordings › A board
 * in a call). Joining a call never opens a board, so it's kept on this browser from the moment the call is made until that
 * call is under way here, and then opened on their stage just for them, once, as a board they picked would be: Present brings
 * everyone. A reload in between forgets it.
 */
import { useEffect } from 'react';
import type { BoardToOpen } from '~/features/calls/flow/context';

/** By the call's code. */
const asked = new Map<string, BoardToOpen>();

/** Opens `board` on your stage once the call with this code is under way on this browser. */
export function openWhenStarted(code: string, board: BoardToOpen): void {
  asked.set(code, board);
}

/** Opens the board asked for as this call started, on your stage just for you, once it's under way here. */
export function useOpenWhenStarted(code: string, live: boolean, open: (board: BoardToOpen) => void): void {
  useEffect(() => {
    const board = asked.get(code);
    if (!live || !board) return;
    asked.delete(code);
    open(board);
  }, [code, live, open]);
}
