/*
 * Closing what's on your stage: for you, or (your presentation) for you or for everyone. Close, on a frame's bar or the lit Board
 * or Workspace, asks on your own presentation, on its frame, in front; and so it does on the call's board nobody presents, for
 * whoever may take it out of the call (`boardClosable`). Close's question is `asking`. Where the keys land as things close is
 * landKeys.ts's; what's said as they do is the workspace's words (`wsToast`).
 */
import type { CallSession } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useState, type RefObject } from 'react';
import { holding, type useLandKeys } from '../layout/landKeys';
import type { useSide } from '../layout/side';
import { isScreen, type ThingId, type useOnStage } from './onStage';

export function useClosing({ stage, land, side, session, inRoom, sharedBoardLeaves, boardClosable, stopWorkspace, stopBoard, stoppedByMe, stopShare, toFront, leaveFocus, say, about, failed }: {
  stage: ReturnType<typeof useOnStage>;
  land: ReturnType<typeof useLandKeys>;
  side: ReturnType<typeof useSide>;
  session: CallSession;
  /** You're in a breakout room. */
  inRoom: boolean;
  /** Rooms share the call's board, and you opened it or you're the organizer: For everyone takes it out of the call, every room too. */
  sharedBoardLeaves: boolean;
  /** You may take the call's board out of the call while nobody presents it: Close asks you for whom. */
  boardClosable: boolean;
  /** Your presentation of the workspace or of a board ends, for you or for everyone. */
  stopWorkspace: (everyone: boolean) => Promise<void>;
  stopBoard: (everyone: boolean) => Promise<void>;
  /** A presentation you ended, which you've been told about, so its end isn't said twice. */
  stoppedByMe: RefObject<string | null>;
  stopShare: () => void;
  /** Two on your stage with no room for both take turns: what Close asks about comes to the front. */
  toFront: (id: ThingId) => void;
  leaveFocus: () => void;
  say: (toast: WsToastData, topic?: string) => void;
  about: (id: ThingId) => string;
  failed: (e: unknown) => void;
}) {
  const [asking, setAsking] = useState<ThingId | null>(null);
  const closeThing = (id: ThingId) => {
    const p = stage.presentedOf(id);
    if ((p?.mine && !isScreen(id)) || (id === 'board' && !p && boardClosable)) { toFront(id); setAsking(id); return; }
    closeForMe(id);
  };
  /** Stop sharing, on your own screen's bar: it stops for everyone. */
  const stopMine = (id: ThingId) => { land({ to: 'opener', id }, holding()); stopShare(); };
  /** It closes on your stage alone: a presentation, someone else's or your own screen, becomes its tile, and anything else closes. */
  const closeForMe = (id: ThingId) => {
    const p = stage.presentedOf(id);
    setAsking(null);
    if (stage.on.length <= 1) leaveFocus();
    land(p ? { to: 'tile', id } : { to: 'opener', id }, holding());
    stage.close(id);
    if (p) say(p.mine && isScreen(id) ? wsToast.screenAway() : wsToast.closedWhile(p.first), about(id));
  };
  /** The call's board leaves the call for everyone, as whoever opened it or the organizer: the board says so as it goes (callBoard.ts). */
  const closeBoardForAll = () => {
    setAsking(null);
    land({ to: 'opener', id: 'board' }, holding());
    session.closeBoard().catch(failed);
  };
  /**
   * What your presentation's For everyone closes: in a room, it's that room's, unless it's the board every room shares and you
   * opened it or you're the organizer, when the board leaves the call. Anywhere else, it's everyone's in the call.
   */
  const forRoomOnly = (id: ThingId) => inRoom && !(id === 'board' && sharedBoardLeaves);
  const closesFor = (id: ThingId): string | undefined => (forRoomOnly(id) ? 'It closes for everyone in this room.' : inRoom ? 'It closes for everyone in the call, every room too.' : undefined);
  /** Your presentation of a board or the workspace ends, for you or for everyone: from Close's question, or Share's. */
  const closeFor = (id: ThingId, everyone: boolean) => {
    setAsking(null);
    const stop = id === 'ws' ? stopWorkspace : stopBoard;
    const was = stage.on;
    stoppedByMe.current = stage.presentedOf(id)?.key ?? null;
    stop(everyone).then(() => {
      if (was.includes(id) && was.length <= 1) leaveFocus();
      land({ to: 'opener', id }, holding());
      stage.close(id);
      if (side.view === 'mine') side.close();
      say(everyone ? wsToast.closedForAll(forRoomOnly(id)) : wsToast.closedForYou(), about(id));
    }, () => { stoppedByMe.current = null; });
  };
  /** Close's question on your own presentation's frame: for you, or for everyone, and what that closes. */
  const askFor = (id: ThingId, phone: boolean) => ({ open: asking === id, onOpenChange: (o: boolean) => setAsking(o ? id : null), onMe: () => closeFor(id, false), onEveryone: () => closeFor(id, true), everyone: closesFor(id), phone });
  return { asking, setAsking, closeThing, stopMine, closeForMe, closeBoardForAll, closeFor, closesFor, askFor };
}
export type Closing = ReturnType<typeof useClosing>;
