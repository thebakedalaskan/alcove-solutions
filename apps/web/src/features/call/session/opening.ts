/*
 * A board someone asked to open as their call starts: Start a call here, on a board's page (docs: Calls and recordings › A board
 * in a call). Joining a call never opens a board, so it's kept on this browser from the moment the call is made until that
 * call is under way here, and then opened for everyone, once. A reload in between forgets it: the board is still brought to
 * the call, first in the Board menu.
 */
import { errorCode, type CallSession } from '@alcove/api';
import { useEffect } from 'react';
import type { BoardToOpen } from '~/features/shell/context';
import { log } from '~/lib/log';

const olog = log.child({ component: 'board-on-start' });

/** By the call's code. */
const asked = new Map<string, BoardToOpen>();

/** Opens `board` for everyone once the call with this code is under way on this browser. */
export function openWhenStarted(code: string, board: BoardToOpen): void {
  asked.set(code, board);
}

/**
 * Opens the board asked for as this call started, once it's under way here and nothing else is open. `expect` is what the call
 * says as it opens, in place of the usual line. One that can't be opened stays brought to the call, and the Board menu has it.
 */
export function useOpenWhenStarted(code: string, session: CallSession, live: boolean, anyOpen: boolean, expect: (text: string) => void, failed: (e: unknown) => void): void {
  useEffect(() => {
    const board = asked.get(code);
    if (!live || !board) return;
    asked.delete(code);
    if (anyOpen) return;
    expect(`${board.name || 'Untitled board'} is open for everyone here.`);
    session.openBoard({ workspaceId: board.workspaceId, documentId: board.documentId, letIn: false }).catch((e: unknown) => {
      expect('');
      olog.info('the board asked for wasn’t opened as the call started', { code: errorCode(e) });
      failed(e);
    });
  }, [code, session, live, anyOpen, expect, failed]);
}
