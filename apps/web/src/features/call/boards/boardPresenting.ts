/*
 * A board presented in a call, as this browser has it (docs: Calls and recordings › Presenting a board). What's presented,
 * and which frame everyone's on, is the call's, as it is for a document (`usePresenting`, presenting.ts): a board is presented
 * from its own bar, and it's always the one open where you are. What's kept here is yours: your notes beside each frame while
 * you're presenting, the board brought back for it if you'd hidden it, and, while you present it, the board kept in front of
 * you. features/board/CallBoard.tsx draws it.
 */
import { firstName, type CallSession } from '@alcove/api';
import { useCallback, useEffect, useMemo } from 'react';
import type { BoardPresentation } from '~/features/board/CallBoard';
import type { WorkspacePresenting } from '~/features/workspace/context';
import { usePresenterFrameNotes } from '~/features/workspace/presenterNotes';
import type { CallBoard } from './callBoard';

/** What hiding the board you're presenting says instead: everyone's watching it with you, so it stays where you can see it. */
const STOP_PRESENTING_FIRST ='Stop presenting first. Everyone sees this board while you present it.';

export function useBoardPresenting({ session, presenting, board, account, failed, notesFailed, refuse }: {
  session: CallSession;
  presenting: WorkspacePresenting;
  board: CallBoard;
  /** You're signed in, so there's somewhere to keep your notes. */
  account: boolean;
  failed: (e: unknown) => void;
  notesFailed: (message: string) => void;
  /** Says why something you pressed wasn't done. */
  refuse: (text: string) => void;
}): {
  present: BoardPresentation | null;
  start: (() => void) | undefined;
  /**
   * While you present it, the board stays in front of you, so you always see what everyone sees: O, the dock's Board button and
   * a share made big beside it call this instead, which says to stop presenting first. Null while you aren't presenting it.
   */
  hold: (() => void) | null;
} {
  const p = presenting.present;
  const open = board.open;
  const ours = p !== null && p.kind === 'board' && p.id !== null && open !== null && open.documentId === p.id ? p : null;
  const mine = ours?.mine === true;
  const { notes, setNote } = usePresenterFrameNotes({ workspaceId: open?.workspaceId ?? '', boardId: open?.documentId ?? '', pass: session.ticket.pass, mine: mine && account, failed: notesFailed });

  /* Presented to you, it's on your stage even if you'd hidden it: you're back to it as it begins. */
  const begun = ours ? `${ours.by.seat} ${ours.id ?? ''}` : null;
  const { hidden, show } = board;
  useEffect(() => { if (begun && !mine && hidden) show(); }, [begun]);

  const { section, away, setAway, move, stop } = presenting;
  const watch = useCallback((watching: boolean) => setAway(!watching), [setAway]);
  // The organizer can stop anyone's, as they can a document's: from the pill, since it isn't theirs to present.
  const canStop = ours !== null && ours.canControl && !ours.mine;
  const present = useMemo<BoardPresentation | null>(() => (ours ? {
    by: firstName(ours.by.name), mine: ours.mine, section, watching: !away, canStop, onWatch: watch, onMove: move, onStop: stop, notes, onNotes: setNote
  } : null), [ours?.by.name, ours?.mine, section, away, canStop, watch, move, stop, notes, setNote]);

  const boardId = open?.documentId ?? null;
  const start = useMemo(() => (boardId ? () => { session.startPresenting({ kind: 'board', id: boardId }).catch(failed); } : undefined), [session, boardId, failed]);
  const hold = mine ? () => refuse(STOP_PRESENTING_FIRST) : null;
  return { present, start, hold };
}
