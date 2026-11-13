/*
 * The workspace on your stage, in its frame (stage/frame.tsx). It stays here once it's been open, out of sight while it isn't on
 * your stage (`shown`), at the place it was last, so it keeps its place, its caret and its undo. Its bar names it, says who can
 * edit it, who presents it and who follows them, with Present and Close; its list stands beside the page where the frame has the
 * room, and otherwise comes over the page for now. The panel draws a lot, so what it's given keeps its identity while it's the same.
 */
import { errorCode, type CallParticipant, type CallSession, type CallState, type CallWorkspace, type Person } from '@alcove/api';
import type { WsToastData } from '@alcove/ui';
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { WorkspacePlaying } from '~/features/workspace/context';
import type { LiveCall } from '~/features/workspace/live/types';
import { log } from '~/lib/log';
import { holding, type useLandKeys } from '../layout/landKeys';
import type { CallView } from '../layout/view';
import type { Closing } from '../stage/closing';
import { Frame, FrameBox, byOf, copyLinkOf, type FrameBar, type FramePlace } from '../stage/frame';
import type { useOnStage } from '../stage/onStage';
import type { Box } from '../stage/stageLayout';
import type { useWorkspacePresenting } from './presenting';
import { WorkspaceMenuRows, WorkspacePanel, inTheCall, type WorkspacePanelState } from './WorkspacePanel';

const clog = log.child({ component: 'call' });

export function WorkspaceFrame({ box, shown, place, session, state, participants, invited, space, work, name, presenting, stage, closing, organizer, closeTheirs, mayPresent, land, live, playing, foot, view, onCustom, say, failed }: {
  box: Box;
  /** It's on your stage and in sight: something taking turns with it can be in front. */
  shown: boolean;
  place: FramePlace;
  session: CallSession;
  state: CallState;
  /** Who's here, as the call last said, for `@`. */
  participants: readonly CallParticipant[];
  invited: readonly Person[];
  space: CallWorkspace;
  work: WorkspacePanelState;
  /** Its name on the frame: a new one shows while it's being kept, until the call says it. */
  name: string;
  presenting: ReturnType<typeof useWorkspacePresenting>;
  stage: ReturnType<typeof useOnStage>;
  closing: Closing;
  organizer: boolean;
  /** The organizer's, on someone else's presentation: it closes for everyone. */
  closeTheirs: () => void;
  /** You may present it: you can open it, and nobody else presents a board or the workspace here. */
  mayPresent: boolean;
  land: ReturnType<typeof useLandKeys>;
  live: LiveCall;
  playing: WorkspacePlaying;
  /** What sits at the foot of its list while it's in sight: on your own, the call's link. */
  foot: ReactNode;
  view: CallView;
  /** Your view changed from the one the stage gives itself: said once. */
  onCustom: () => void;
  say: (toast: WsToastData) => void;
  failed: (e: unknown) => void;
}) {
  const panels = view.panels;
  /* `@` in the workspace: who's here and who's invited. The call changes all the time and these rarely do, and the workspace draws a lot. */
  const spacePeopleKey = JSON.stringify(participants.map((p) => [p.id, p.seat, p.person, p.isMe]));
  const spacePeople = useMemo(() => participants.map((p) => ({ id: p.id, seat: p.seat, person: p.person, isMe: p.isMe })), [spacePeopleKey]);
  const spaceInvitedKey = JSON.stringify(invited);
  const spaceInvited = useMemo(() => invited, [spaceInvitedKey]);
  /* The workspace's list: beside the page where its frame has the room, and otherwise over the page for now. */
  const listFits = shown && box.w >= 760 && !place.phone;
  const listShown = panels.list && listFits;
  /* The list's button: a list that gave way for want of room comes over the page for now. One you put away comes back. */
  const turnList = () => {
    if (panels.list && !listFits) { work.act.setPeek((on) => !on); return; }
    work.act.setPeek(false);
    view.arrange((p) => ({ ...p, list: !p.list }));
    onCustom();
  };
  const listTurn = useRef(turnList);
  listTurn.current = turnList;
  const toggleList = useCallback(() => { listTurn.current(); }, []);
  /*
   * What needs the list, such as naming a folder, shows it and never hides it: one that gave way comes over the page, and one
   * you put away comes back, or over the page in a frame with no room for it.
   */
  const showList = () => {
    if (listShown) return;
    if (!panels.list) { view.arrange((p) => ({ ...p, list: true })); onCustom(); }
    if (!listFits) work.act.setPeek(true);
  };
  const listShow = useRef(showList);
  listShow.current = showList;
  const onShowList = useCallback(() => { listShow.current(); }, []);
  const wsLink = space.id ? `${location.origin}/drive/${encodeURIComponent(space.id)}` : undefined;
  const p = stage.presentedOf('ws');
  const bar: FrameBar = {
    icon: 'folderOpen', name, by: byOf(p), followers: place.followers, phone: place.phone, focus: place.focus, clears: place.clears,
    access: space.everyone && space.id !== null ? { label: space.role !== null ? 'Everyone in the call can edit' : 'You can edit while you’re in the call', opens: true } : null,
    follow: p && !p.mine ? { on: stage.following('ws'), where: presenting.where ?? 'the workspace', onToggle: () => stage.setFollow('ws', !stage.following('ws')) } : null,
    present: p === null && mayPresent ? { onPress: () => { void presenting.start().then(() => land({ to: 'frame', id: 'ws' }, holding()), () => undefined); }, busy: false } : null,
    onClose: () => closing.closeThing('ws'), ask: p?.mine ? closing.askFor('ws', place.phone) : null,
    rows: (close, start) => (
      <WorkspaceMenuRows workspace={space} organizer={organizer} people={inTheCall(state.participants, state.role)} act={work.act} start={start} onFind={() => work.act.find()} onCopy={copyLinkOf(wsLink, say, failed)}
        onRenamed={() => { session.refresh({ call: true, log: false }).catch((e: unknown) => clog.info('call not read again for a new workspace name', { code: errorCode(e) })); }} onDone={close} />
    ),
    stop: p && !p.mine && organizer ? { label: 'Close it for everyone', onPick: closeTheirs } : null
  };
  return (
    <FrameBox id="ws" box={box} shown={shown} focused={place.focused && shown}>
      <Frame bar={bar}>
        <WorkspacePanel workspace={space} organizer={organizer} pass={session.ticket.pass} at={work.at} settled={work.settled} showing={shown} finding={work.finding} people={spacePeople} invited={spaceInvited} reach={work.reach}
          listOff={!listShown} listPeek={work.peek} listWanted={work.listWanted} live={live} act={work.act} presenter={p && !p.mine ? presenting.connection : null} playing={playing}
          foot={shown ? foot : null} onToggleList={toggleList} onShowList={onShowList} />
      </Frame>
    </FrameBox>
  );
}
