/*
 * A board presented in a call, as this browser has it (docs: Calls and recordings › Presenting a board). What's presented, and
 * which frame everyone's on, is the call's (`CallWorkspace.present`): a board is presented from its frame's bar, or straight away
 * from Share, and it's always the board in the call where you are. Whoever presents steps through its frames from the pager at
 * its foot (← and → too), with their own notes beside each frame in the side (`mine`); everyone else sees the frame they're on,
 * until they unfollow to work on their own (layout/onStage.ts). features/board/CallBoard.tsx draws it.
 */
import { errorCode, firstName, type CallPresent, type CallSession } from '@alcove/api';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { BoardPresentation } from '~/features/board/CallBoard';
import { usePresenterFrameNotes } from '~/features/workspace/presenterNotes';
import { log } from '~/lib/log';
import type { CallBoard } from './callBoard';

const plog = log.child({ component: 'board-presenting' });

export function useBoardPresenting({ session, present, board, account, following, onFollow, notesOpen, onNotes, failed, notesFailed }: {
  session: CallSession;
  /** What's presented where you are, as the call says. */
  present: CallPresent | null;
  board: CallBoard;
  /** You're signed in, so there's somewhere to keep your notes. */
  account: boolean;
  /** You follow whoever presents it, rather than work on your own. */
  following: boolean;
  onFollow: (following: boolean) => void;
  /** Your notes are open in the side, and opening or closing them there. */
  notesOpen: boolean;
  onNotes: () => void;
  failed: (e: unknown) => void;
  notesFailed: (message: string) => void;
}): {
  /** The board on your stage presented, as the board draws it; null when it isn't the one presented. */
  present: BoardPresentation | null;
  /** The presentation, whichever board it's of. */
  call: CallPresent | null;
  mine: boolean;
  /** Your notes beside each of its frames, while you present it; null without an account. */
  notes: Readonly<Record<string, string>> | null;
  setNote: (frame: string, text: string) => void;
  /** The frame everyone's on now, from 0. */
  section: number;
  /** Presents the board in the call, from its first frame. */
  start: () => Promise<void>;
  stop: (close: boolean) => Promise<void>;
} {
  const p = present?.kind === 'board' ? present : null;
  const open = board.open;
  // The board on your stage is the one presented: the call's, which is what's drawn unless a saved board just for you is.
  const ours = p !== null && p.id !== null && open !== null && open.documentId === p.id && !board.savedDrawn ? p : null;
  const mine = p?.mine === true;
  const { notes, setNote } = usePresenterFrameNotes({ workspaceId: open?.workspaceId ?? '', boardId: open?.documentId ?? '', pass: session.ticket.pass, mine: mine && account, failed: notesFailed });

  /* Back and Next show at once for whoever presses them; once the call has answered, what it says is what's so. */
  const [moved, setMoved] = useState<{ key: string; section: number; n: number } | null>(null);
  const moves = useRef(0);
  const key = p?.key ?? null;
  const section = moved && moved.key === key ? moved.section : p?.section ?? 0;
  const keyNow = useRef(key);
  keyNow.current = key;
  const move = useCallback((to: number) => {
    const k = keyNow.current;
    if (k === null) return;
    const n = ++moves.current;
    setMoved({ key: k, section: to, n });
    const settle = () => setMoved((m) => (m?.n === n ? null : m));
    session.movePresenting(to).then(settle, (e: unknown) => { settle(); failed(e); });
  }, [session, failed]);

  const boardId = open?.documentId ?? null;
  const start = useCallback(async () => {
    if (!boardId) return;
    try {
      await session.startPresenting({ kind: 'board', id: boardId });
    } catch (e) {
      plog.info('presenting a board didn’t start', { code: errorCode(e) });
      failed(e);
      throw e;
    }
  }, [session, boardId, failed]);
  const stop = useCallback(async (close: boolean) => {
    try {
      await session.stopPresenting(close);
    } catch (e) {
      plog.info('presenting a board didn’t stop', { code: errorCode(e), close });
      failed(e);
      throw e;
    }
  }, [session, failed]);
  const watch = useCallback((on: boolean) => onFollow(on), [onFollow]);
  const presentation = useMemo<BoardPresentation | null>(() => (ours ? {
    by: firstName(ours.by.name), mine: ours.mine, section, watching: !ours.mine && following, onWatch: watch, onMove: move,
    notes: ours.mine && account ? { on: notesOpen, onToggle: onNotes } : null
  } : null), [ours?.by.name, ours?.mine, section, following, watch, move, account, notesOpen, onNotes]);
  return { present: presentation, call: p, mine, notes, setNote, section, start, stop };
}
