/*
 * The board on your stage, in its frame (stage/frame.tsx): the call's, or a saved one just for you (`saved`). Its bar has its name
 * and the menu that name opens, who presents it and who follows them, Present, and Close; its foot has the presenter's pager.
 * How it stands is said in its page's words (features/board/standing.ts): its seal, what that says on hover and pressed, and
 * Reconnecting and Couldn't save in its pill, with Try again. While all's well, the seal says what's true of it in this call.
 * Present, on a saved board just for you, brings it into the call first, for everyone here to edit when it's yours to share, so
 * whoever joins later can too, asking first if some people here can't open it (`usePresentBoard`).
 */
import type { CallSession, CallState, WorkspaceItem } from '@alcove/api';
import { useToast, wsToast, type IconName, type PresentAskProps, type WsToastData } from '@alcove/ui';
import { callName } from '~/lib/people';
import { useMemo, useState } from 'react';
import type { BoardPager } from '~/features/board/CallBoard';
import { StandingPill, roomPills, type PillKind } from '~/features/board/pills';
import { ENCRYPTED, standingOf } from '~/features/board/standing';
import type { BoardRun } from '~/features/board/tools/run';
import type { useRenameBoard } from '~/features/workspace/queries';
import { ShareSheetFor } from '~/features/workspace/sharing/Sheets';
import { holding, type useLandKeys } from '../layout/landKeys';
import type { useBreakoutRooms } from '../rooms/useBreakoutRooms';
import type { Closing } from '../stage/closing';
import { BoardPagerFoot, Frame, FrameBox, byOf, copyLinkOf, type FrameBar, type FramePlace } from '../stage/frame';
import type { useOnStage } from '../stage/onStage';
import type { Box } from '../stage/stageLayout';
import type { WorkspacePanelState } from '../workspace/WorkspacePanel';
import { bringAndPresent, presentAskOf } from './BoardPicker';
import type { useBoardPresenting } from './boardPresenting';
import { BoardLeaf, BoardMenuRows } from './BoardStage';
import type { CallBoard, SavedBoard } from './callBoard';

export interface BoardFrameProps {
  id: 'board' | 'saved';
  box: Box;
  place: FramePlace;
  session: CallSession;
  state: CallState;
  me: string;
  board: CallBoard;
  run: BoardRun | undefined;
  theme: 'light' | 'dark';
  /** Rooms, as you're in them: their time is in the board's one pill, and a room's own board says who can see it. */
  rooms: Pick<ReturnType<typeof useBreakoutRooms>, 'open' | 'roomName' | 'left' | 'landing' | 'myRoomId'>;
  /** Which kind of pill the board shows, as that changes: the status bar says the rooms only while the board doesn't. */
  onPill: (kind: PillKind | null) => void;
  notesOn: boolean;
  online: boolean;
  /** What you've changed since it last saved, which its pill counts. */
  changes: number;
  presenting: ReturnType<typeof useBoardPresenting>;
  stage: ReturnType<typeof useOnStage>;
  closing: Closing;
  /** You may take the call's board out of the call while nobody presents it. */
  closable: boolean;
  /** You may present a board: invited, not a guest, and nobody else presents one here. */
  mayPresent: boolean;
  organizer: boolean;
  /** The organizer's, on someone else's presentation: it closes for everyone. */
  closeTheirs: () => void;
  /** Present, on its bar, while you may. */
  present: PresentBoard;
  spaceName: (workspaceId: string) => string | null;
  /** The workspace the call views, where a board kept there comes up in the call. */
  spaceId: string | null;
  act: WorkspacePanelState['act'];
  rename: ReturnType<typeof useRenameBoard>;
  /** The board as its workspace has it, for its Share. */
  item: WorkspaceItem | undefined;
  /** Whoever brought a board you can't open, and asking them to let you in. */
  asker: Asker;
  say: (toast: WsToastData) => void;
  failed: (e: unknown) => void;
}

export function BoardFrame({ id, box, place, session, state, me, board, run, theme, rooms, onPill, notesOn, online, changes, presenting, stage, closing, closable, mayPresent, organizer, closeTheirs, present, spaceName, spaceId, act, rename, item, asker, say, failed }: BoardFrameProps) {
  const toast = useToast();
  const { open, roomName, left, landing, myRoomId } = rooms;
  const boardOpen = board.drawn;
  const boardWhere = boardOpen?.workspaceId ? spaceName(boardOpen.workspaceId) : null;
  const viewOnly = boardOpen?.role === 'read';
  /** A room's own board: only the people in the room see it, until rooms close. On the board every room shares, you're on the main board. */
  const roomsOwn = boardOpen !== null && !board.savedDrawn && roomName !== null && boardOpen.frame === null;
  const sealed = boardOpen?.seal ?? 'Sealed';
  const boardStatus = board.status;
  const standing = standingOf({
    status: boardStatus, offline: boardStatus !== null && (boardStatus.status === 'offline' || (!online && boardStatus.status !== 'failed')), readOnly: viewOnly,
    changes, tryAgain: board.tryAgain, tryNow: online ? board.tryNow : undefined, kept: boardWhere ? { icon: 'lock', text: `Saved in ${boardWhere}.` } : null,
    sealed: {
      seal: sealed, title: `${sealed}. Encrypted in storage.`,
      rows: roomsOwn ? [
        { icon: 'lock', text: `Only the people in ${roomName} can see this board.` },
        { icon: 'door', text: 'When rooms close it comes back to the main room, and everyone in the call sees it.' },
        ENCRYPTED
      ] : board.savedDrawn ? [
        { icon: 'lock', text: boardWhere ? `Only on your screen. Saved in ${boardWhere}.` : 'Only on your screen.' },
        ENCRYPTED
      ] : [
        ...(boardOpen?.everyone ? [{ icon: 'lock' as const, text: boardWhere ? `Everyone in this call can add to it. Saved in ${boardWhere}.` : 'Everyone in this call can add to it.' }]
          : boardWhere ? [{ icon: 'lock' as const, text: `Saved in ${boardWhere}.` }] : []),
        ...(notesOn ? [{ icon: 'notes' as const, text: 'The notes can use this board.' }] : []),
        ENCRYPTED
      ]
    }
  });
  /*
   * The rooms' time on the board, in its one pill: the room you're in, or how many rooms share the main board, and how long is
   * left. While that's the pill the board shows, it's said there, and the rooms line above says nothing more.
   */
  const roomsPill = roomPills(open ? { name: roomName, rooms: open.rooms.length, shared: open.board === 'shared', left } : null);
  /** Where a board is kept: the workspace everyone's viewing comes up in the call, and any other opens in a tab of its own. */
  const openSaved = (workspaceId: string) => {
    if (workspaceId === spaceId) { act.wantList(); return; }
    window.open(`/drive/${encodeURIComponent(workspaceId)}`, '_blank', 'noopener');
  };
  /*
   * Something the board links to opens as its workspace does: in the call when everyone's viewing that workspace, and in a tab of
   * its own for an account anywhere else. A guest has nowhere else to open it.
   */
  const linkedIn = boardOpen?.workspaceId ?? null;
  const linkHere = linkedIn !== null && linkedIn === spaceId;
  const linkOpens = linkedIn !== null && (linkHere || state.role !== 'guest');
  const openLinked = useMemo(() => (linkedIn && linkOpens ? (doc: string) => {
    if (linkHere) { act.openAt({ kind: 'document', id: doc }); return; }
    window.open(`/drive/${encodeURIComponent(linkedIn)}/${encodeURIComponent(doc)}`, '_blank', 'noopener');
  } : undefined), [linkedIn, linkOpens, linkHere, act]);
  /** The board's own address, which opens it for whoever can open it. */
  const boardLink = linkedIn && boardOpen?.documentId ? `${location.origin}/drive/${encodeURIComponent(linkedIn)}/${encodeURIComponent(boardOpen.documentId)}` : undefined;
  /** Rename, in the board's frame's name menu: its name becomes a field on the board's bar. */
  const [renameAsk, setRenameAsk] = useState(0);
  const boardRename = boardOpen?.workspaceId && boardOpen.documentId && boardOpen.role === 'edit' ? (() => {
    const { workspaceId, documentId } = boardOpen;
    return (name: string) => rename.mutateAsync({ workspaceId, id: documentId, name }).catch((e: unknown) => { failed(e); throw e; });
  })() : undefined;
  /** Who can add to it: the board's own Share, as its workspace has it, in place of the name menu's rows. */
  const boardShare = boardOpen?.workspaceId && boardOpen.documentId && boardOpen.role === 'edit' && item && item.id === boardOpen.documentId && item.role === 'edit' && item.trashedAt === null
    ? <ShareSheetFor workspaceId={boardOpen.workspaceId} item={{ ...item, name: boardOpen.name ?? item.name }} say={act.say} pass={board.savedDrawn ? undefined : session.ticket.pass} />
    : null;
  /** What the board says to you, with its own icon: what you were typing in going, a trash can. Following says its own, with an eye. */
  const sayBoard = (text: string, icon: IconName) => { toast(text, { icon }); };
  /** Where whoever presents the board is, for the pager at its frame's foot. */
  const [pager, setPager] = useState<BoardPager | null>(null);
  const p = id === 'board' ? stage.presentedOf('board') : null;
  const canPresent = p === null && !place.phone && mayPresent && boardOpen?.role === 'edit' && !board.sinking;
  const where = boardOpen?.workspaceId && boardWhere ? { name: boardWhere, onOpen: () => openSaved(boardOpen.workspaceId ?? '') } : null;
  /*
   * Who can edit the call's board, while everyone here can: everyone in a room, on a room's own board; anyone else, everyone in the
   * call, which a guest is told as theirs while they're in it. It's what the Share sheet says, for whoever has it to open.
   */
  const roomBoard = myRoomId !== null && open?.board === 'each';
  const editors = !state.board.open?.everyone ? null : roomBoard ? 'Everyone in this room can edit' : state.role === 'guest' ? 'You can edit while you’re in the call' : 'Everyone in the call can edit';
  const access = id === 'board' && editors ? { label: editors, opens: boardShare !== null } : null;
  /** The call's board nobody presents, for whoever may take it out of the call: for you, it stays in the call; for everyone, it leaves it. */
  const boardAsk = {
    open: closing.asking === 'board', onOpenChange: (o: boolean) => closing.setAsking(o ? 'board' : null), onMe: () => closing.closeForMe('board'), onEveryone: closing.closeBoardForAll, phone: place.phone,
    me: 'It stays in the call, and Board opens it again.', everyone: boardWhere ? `It leaves the call for everyone, and stays saved in ${boardWhere}.` : 'It leaves the call for everyone, and stays saved.'
  };
  const bar: FrameBar = {
    icon: 'presentation', name: boardOpen?.name ?? 'Board', by: byOf(p), followers: place.followers, phone: place.phone, focus: place.focus, clears: place.clears, access,
    follow: p && !p.mine ? { on: stage.following('board'), where: pager?.part || 'the board', onToggle: () => stage.setFollow('board', !stage.following('board')) } : null,
    present: canPresent ? { onPress: present.now, busy: present.busy, ask: present.ask ?? undefined } : null,
    onClose: () => closing.closeThing(id), ask: p?.mine ? closing.askFor(id, place.phone) : id === 'board' && !p && closable ? boardAsk : null,
    rows: (close, start) => {
      // What the board itself has to offer, read as the menu opens: there's none until it's drawn here. Night board changes
      // it for everyone, so it's for whoever can change it.
      const h = board.handle.current;
      return (
        <BoardMenuRows rename={boardRename ? () => setRenameAsk((n) => n + 1) : undefined} where={where} share={boardShare} link={copyLinkOf(boardLink, say, failed)}
          image={h ? () => h.saveImage() : undefined} pdf={h ? () => h.savePdf() : undefined} night={h && boardOpen?.role === 'edit' ? { on: h.night(), onToggle: () => h.setNight(!h.night()) } : undefined}
          start={start} onDone={close} />
      );
    },
    stop: p && !p.mine && organizer ? { label: 'Close it for everyone', onPick: closeTheirs } : null
  };
  const mine = p?.mine === true && pager !== null && presenting.present !== null;
  return (
    <FrameBox id={id} box={box} shown focused={place.focused}>
      <Frame bar={bar} foot={mine && pager ? (
        <BoardPagerFoot pager={pager} onBack={() => presenting.present?.onMove(pager.at - 2)} onNext={() => presenting.present?.onMove(pager.at)}
          notes={presenting.present?.notes ?? null} />
      ) : undefined}>
        <BoardLeaf board={board} seal={standing} rename={boardRename} renameAsk={renameAsk} run={run} theme={theme}
          pills={{ ...roomsPill, standing: standing.pill && <StandingPill pill={standing.pill} /> }} onPill={onPill}
          phone={place.phone} openLinked={openLinked} link={boardLink} opener={board.drawn?.openedBy !== me ? asker.opener : null} onAsk={asker.ask} onSay={sayBoard} landing={landing}
          present={presenting.present} onPager={setPager} />
      </Frame>
    </FrameBox>
  );
}

/** Whoever brought the board in the call, and asking them to let you into it while you can't open it. */
export interface Asker { opener: string | null; ask: (() => void) | undefined }

/**
 * Asking whoever brought a board you can't open to let you in: in the call's chat, where they'll see it, as you'd ask them
 * yourself. Not on a board you brought.
 */
export function askerOf({ board, me, session, toast, failed }: { board: CallBoard; me: string; session: CallSession; toast: ReturnType<typeof useToast>; failed: (e: unknown) => void }): Asker {
  const opener = board.opener ? callName(board.opener) : null;
  const ask = opener && board.drawn?.openedBy !== me ? () => {
    session.sendChat(`${opener}, could you let me into the board?`).then(() => toast(`Asked ${opener} in the chat.`, { icon: 'chat' }), failed);
  } : undefined;
  return { opener, ask };
}

/**
 * Present, on the board's bar: the call's board is presented from its first frame, and a saved board just for you is brought into
 * the call first, for everyone here to edit when it's yours to share, so whoever joins later can too, asking first if some people
 * here can't open it (`ask`). Either way the keys go to the pager. What's asked, and whether it's on its way (`busy`), is the
 * call's: it stays as it is while the board's frame comes and goes.
 */
export function usePresentBoard({ session, state, board, saved, presenting, stage, land, spaceName, phone, say, failed }: {
  session: CallSession;
  state: CallState;
  board: CallBoard;
  saved: SavedBoard | null;
  presenting: ReturnType<typeof useBoardPresenting>;
  stage: ReturnType<typeof useOnStage>;
  land: ReturnType<typeof useLandKeys>;
  spaceName: (workspaceId: string) => string | null;
  phone: boolean;
  say: (toast: WsToastData) => void;
  failed: (e: unknown) => void;
}) {
  const [ask, setAsk] = useState<PresentAskProps | null>(null);
  const [busy, setBusy] = useState(false);
  const presentSaved = (b: SavedBoard) => {
    setBusy(true);
    const go = (letIn: boolean, says: string | null) => {
      setAsk(null);
      setBusy(true);
      bringAndPresent(session, board, { workspaceId: b.workspaceId, documentId: b.documentId, letIn }, says)
        .then(() => { land({ to: 'pager' }, holding()); stage.open('board'); say(wsToast.boardOn(b.name)); }, failed).finally(() => setBusy(false));
    };
    session.boardCheck(b.workspaceId, b.documentId).then((check) => {
      setBusy(false);
      if (!check.cannot.length) { go(check.mayLetIn, null); return; }
      const asked = presentAskOf(check, { name: b.name, where: spaceName(b.workspaceId) }, (letIn, says) => go(letIn, says));
      setAsk({ open: true, onOpenChange: (o) => { if (!o) setAsk(null); }, ...asked, phone });
    }, (e: unknown) => { setBusy(false); failed(e); });
  };
  const now = () => {
    if (board.savedDrawn && saved) { presentSaved(saved); return; }
    const name = state.board.open?.name ?? 'the board';
    setBusy(true);
    presenting.start().then(() => { land({ to: 'pager' }, holding()); say(wsToast.boardOn(name)); }, () => undefined).finally(() => setBusy(false));
  };
  return { ask, busy, now };
}
export type PresentBoard = ReturnType<typeof usePresentBoard>;
