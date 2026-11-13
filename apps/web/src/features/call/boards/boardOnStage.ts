/*
 * The board on your stage, kept in step with the call. The board itself is callBoard.ts's, and what's on your stage is
 * stage/onStage.ts's: here a saved board just for you stays while it's on your stage, the call's board opens there and leaves it
 * with your part of the call, the one you had stays as yours when someone else makes a new one, and your role on it is read again
 * as soon as the board hears it change.
 */
import { errorCode, type CallSession, type CallState, type CallWorkspace, type Person } from '@alcove/api';
import type { useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRenameBoard, workspaceQueries } from '~/features/workspace/queries';
import { log } from '~/lib/log';
import type { CallRoom } from '../media/livekit';
import type { ThingId, useOnStage } from '../stage/onStage';
import { useBoardRun } from './boardRun';
import { useCallBoard, useShotHeard, type CallBoard, type SavedBoard } from './callBoard';

const clog = log.child({ component: 'call' });

/** A saved board you opened just for you, while it's on your stage (`onStage`): once it isn't, it's let go. */
export function useSavedBoard(onStage: boolean): [SavedBoard | null, Dispatch<SetStateAction<SavedBoard | null>>] {
  const [saved, setSaved] = useState<SavedBoard | null>(null);
  useEffect(() => { if (!onStage && saved) setSaved(null); }, [onStage, saved]);
  return [saved, setSaved];
}

/**
 * The call's board on your stage. A breakout room's board, and the board the rooms come back to, open on everyone's stage there;
 * the board rooms share opens on the stage of whoever oversees them (`board.arrived`). The board in the call, closed (and done
 * sinking), leaves your stage. Someone else making a new board changes the board in the call, but never what's on your stage: the
 * one you had stays open, just for you, as a saved board.
 */
export function useBoardFollowsCall({ board, open, on, me, stageOpen, stageClose, setSaved }: {
  board: CallBoard;
  /** The board in your part of the call, as the call says. */
  open: CallState['board']['open'];
  /** What's on your stage. */
  on: readonly ThingId[];
  me: string;
  stageOpen: (id: ThingId) => void;
  stageClose: (id: ThingId) => void;
  setSaved: (saved: SavedBoard) => void;
}): void {
  const boardArrived = board.arrived;
  useEffect(() => { if (boardArrived > 0) stageOpen('board'); }, [boardArrived, stageOpen]);
  const boardGone = open === null && !board.sinking && on.includes('board');
  useEffect(() => { if (boardGone) stageClose('board'); }, [boardGone, stageClose]);
  const callBoardDoc = open?.documentId ?? null;
  const lastCallBoard = useRef(open);
  useEffect(() => {
    const was = lastCallBoard.current;
    lastCallBoard.current = open;
    if (!was?.documentId || !was.workspaceId || !callBoardDoc || was.documentId === callBoardDoc || !on.includes('board') || open?.openedBy === me || was.role === null) return;
    setSaved({ workspaceId: was.workspaceId, documentId: was.documentId, name: was.name ?? 'Untitled board' });
    stageOpen('saved');
  }, [callBoardDoc]);
}

/**
 * Your role on the open board changed, by Share in this call or anywhere else: the board's own document hears it first, so the
 * call is read again then, and the board turns read-only, or back, in a moment rather than at the next read.
 */
export function useRoleFollows(session: CallSession, board: CallBoard): void {
  const docRole = board.status?.role ?? null;
  useEffect(() => {
    const said = board.open?.role ?? null;
    if (board.savedDrawn || docRole === null || said === null || docRole === said) return;
    session.refresh({ call: true, log: false }).catch((e: unknown) => clog.info('call not read again for a board’s role', { code: errorCode(e) }));
  }, [docRole]);
}

/**
 * The board in your part of the call, or a saved one just for you, on your stage (callBoard.ts), kept in step with the call as
 * above. With none open, nothing here is drawn or loaded, and the call is as it always is. Your workspaces, to name a board's and
 * know whether you're in it, are read only once a board is open or the board picker opens (`listing`), so a call that never has
 * one never lists them; the board's own entry in its workspace, for its Share, only while you're in that workspace. Someone put a
 * picture of your screen on the board: you're told, so nothing of your screen goes there without you knowing.
 */
export function useBoardHere({ session, state, stage, space, listing, place, cameBack, me, owner, talking, room, myShare, whoIs, toast }: {
  session: CallSession;
  state: CallState;
  stage: ReturnType<typeof useOnStage>;
  space: CallWorkspace;
  /** The board picker is open, under Board or in Share. */
  listing: boolean;
  place: string;
  cameBack: () => boolean;
  me: string;
  owner: string | null;
  talking: readonly string[];
  room: CallRoom;
  /** Your share's picture, by its track sid in the call. */
  myShare: string | null;
  whoIs: (id: string) => Person;
  toast: ReturnType<typeof useToast>;
}) {
  /** A saved board you opened just for you, while it's on your stage. */
  const savedOn = stage.on.includes('saved');
  const [saved, setSaved] = useSavedBoard(savedOn);
  const drive = useQuery({ ...workspaceQueries.workspaces(), enabled: state.role !== 'guest' && (state.board.open !== null || saved !== null || listing) }).data;
  const spaceName = (id: string): string | null => drive?.find((w) => w.id === id)?.name ?? (space.id === id ? space.name : null);
  const board = useCallBoard({
    stage: savedOn && saved ? 'saved' : stage.on.includes('board') ? 'call' : null, saved: savedOn ? saved : null,
    place, cameBack, spaceName, session, state, me, owner, talking,
    say: (text, icon, action) => { toast(text, { icon, action }); }
  });
  useBoardFollowsCall({ board, open: state.board.open, on: stage.on, me, stageOpen: stage.open, stageClose: stage.close, setSaved });
  const run = useBoardRun(session, state);
  useRoleFollows(session, board);
  const rename = useRenameBoard(board.savedDrawn ? undefined : session.ticket.pass);
  /* Who can add to it: the board's own Share, as its workspace has it, for someone in that workspace who can edit it there. */
  const boardSpace = board.drawn?.workspaceId ?? null;
  // The call says your place in the workspace it views; any other is in your Drive.
  const member = boardSpace !== null && ((space.id === boardSpace && space.role !== null) || (drive ?? []).some((w) => w.id === boardSpace && w.role !== null));
  const item = useQuery({ ...workspaceQueries.workspaceItem(boardSpace ?? '', board.drawn?.documentId ?? ''), enabled: member && !!board.drawn?.documentId }).data;
  useShotHeard({ room, myShare, whoIs, toast });
  return { saved, setSaved, spaceName, board, run, rename, item };
}
