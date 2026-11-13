/*
 * A shared screen on your stage, in its frame (stage/frame.tsx). Someone else's: how you look at it, pointing at it, its own
 * window, a picture of it put on the board in the call (whoever shares it is told), and, for the organizer, stopping it for
 * everyone. Your own: Stop sharing, as it goes out, and its menu: whether others may point at it, clearing everyone's marks, and
 * changing what you share.
 */
import { errorMessage, type CallSession, type CallState, type Person } from '@alcove/api';
import { useToast, wsToast, type WsToastData } from '@alcove/ui';
import type { RefObject } from 'react';
import { callName } from '~/lib/people';
import { hm } from '~/lib/time';
import { BOARD_SHOT_TOPIC, keepShot, shotNotice, type CallBoard } from '../boards/callBoard';
import type { CallRoom } from '../media/livekit';
import type { MediaSnapshot } from '../media/media';
import type { Closing } from '../stage/closing';
import { Frame, FrameBox, type FrameBar, type FramePlace } from '../stage/frame';
import type { ThingId, useOnStage } from '../stage/onStage';
import type { StageShare } from '../stage/Stage';
import type { Box } from '../stage/stageLayout';
import type { ShareMarks } from './marks';
import { MyShareMenuRows, ShareInFrame, ShareMenuRows, type Looks, type Pointing } from './ShareInFrame';

/** Your own share, as its frame shows it: whether the call has it yet, whether it's read for the notes, and pointing at it. */
export interface YourShare {
  /** The call has it: until LiveKit has published it, it's starting. */
  published: boolean;
  /** It's kept for the notes. */
  kept: boolean;
  m: MediaSnapshot;
  /** Others may point at it: your choice, which everyone sees. */
  othersPoint: boolean;
  /** The call lets anyone point at a share (the organizer's switch). */
  pointingOn: boolean;
  /** Everyone's marks on it, to clear. */
  marksOn: number;
  /** Its picture's track sid, which marks name it by. */
  sid: string | null;
  /** Change what you share: Share › Your screen again. */
  onChange: () => void;
}

export function ScreenFrame({ id, box, place, share: s, looks, pointing, popOut, marks, yours, session, state, board, room, stage, closing, organizer, stoppedByMe, me, whoIs, say, failed }: {
  id: ThingId;
  box: Box;
  place: FramePlace;
  share: StageShare;
  looks: Looks;
  pointing: Pointing;
  /** Opens someone else's share in a window of its own, where the browser can. */
  popOut: ((s: StageShare) => void) | null;
  marks: ShareMarks | null;
  yours: YourShare;
  session: CallSession;
  state: CallState;
  board: CallBoard;
  room: CallRoom;
  stage: ReturnType<typeof useOnStage>;
  closing: Closing;
  organizer: boolean;
  /** A share the organizer stopped, which they've been told about, so its end isn't said twice. */
  stoppedByMe: RefObject<string | null>;
  me: Person;
  whoIs: (id: string) => Person;
  say: (toast: WsToastData) => void;
  failed: (e: unknown) => void;
}) {
  const toast = useToast();
  const look = s.mine || !('room' in s.feed) ? null : looks.looks.look(s.id);
  const isPopped = looks.popped === s.id;
  const pop = !s.mine && popOut ? (isPopped ? () => looks.looks.popIn(true) : () => popOut(s)) : null;
  /* Your own screen, as its bar says it goes out: what kind of thing, and its sound. "With sound" only while its sound is live. */
  const surfaceWords = yours.m.screenSurface === 'browser' ? 'a tab' : yours.m.screenSurface === 'window' ? 'a window' : yours.m.screenSurface === 'monitor' ? 'your whole screen' : 'your screen';
  const withSound = Boolean(yours.m.screen?.getAudioTracks().some((t) => t.readyState === 'live'));
  /** What you share is read for the notes: your bar says so, as its menu does. */
  const myShareRead = yours.published && yours.kept;
  const myShareMeta = yours.published ? `You’re presenting · ${surfaceWords}${withSound ? ' with sound' : ''}${myShareRead ? ' · Read for the notes' : ''}` : 'Starting to share…';
  const flipOthersPoint = () => {
    const on = !yours.othersPoint;
    session.letOthersPoint(on).then(() => toast(on ? 'Others can point at your screen again' : 'Only you can point at your screen now', { icon: on ? 'pointer' : 'pointerOff' }),
      (e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  /** Another presented thing to put beside what's on your stage, while it holds one. */
  const beside = place.phone || stage.on.length !== 1 ? [] : stage.tiles.filter((t) => t.id !== id).map((t) => ({ name: t.name, onPick: () => stage.beside(t.id) }));
  /** The organizer's: anyone's share stops for everyone, and they're told who stopped it. */
  const stopTheirShare = () => {
    const seat = state.participants.find((p) => p.id === s.id)?.seat;
    if (!seat) return;
    stoppedByMe.current = `screen:${s.id}`;
    session.stopShare(seat).then(() => say(wsToast.stoppedTheirShare(callName(s.presenter))), (e: unknown) => { stoppedByMe.current = null; failed(e); });
  };
  /*
   * Put on the board: a picture of someone else's share as this browser shows it, into the board's own files, and whoever shares
   * it is told. It's on their share's name menu only: your own screen has none.
   */
  const putShot = () => {
    const open = board.open;
    if (!open?.workspaceId || !open.documentId || open.role !== 'edit') return;
    const { workspaceId, documentId } = open;
    const whose = callName(s.presenter);
    const caption = `${whose}’s screen, ${hm(new Date())}`;
    const held = looks.looks.look(s.id);
    keepShot({ workspaceId, documentId, pass: session.ticket.pass }, s.id, held.getSnapshot().held?.ready ? held.heldBitmap() : null, caption).then((media) => {
      if (!media) { toast(`There’s no picture of ${whose}’s screen yet. Try again in a moment.`, { icon: 'image' }); return; }
      if (!board.handle.current?.addShot({ media, caption })) { toast('Open the board in the call to put a picture on it.', { icon: 'image' }); return; }
      if (s.point) room.send(BOARD_SHOT_TOPIC, shotNotice(s.point.sid), { reliable: true });
      toast(`A picture of ${whose}’s screen is on the board. ${whose} can see that.`, { icon: 'image' });
    }).catch(failed);
  };
  const bar: FrameBar = {
    icon: 'screen', name: s.mine ? 'Your screen' : s.name, by: { person: s.presenter, first: s.mine ? 'You' : callName(s.presenter), mine: s.mine },
    followers: place.followers, follow: null, present: null, focus: place.focus, phone: place.phone, onClose: () => closing.closeThing(id), clears: place.clears, ask: null, access: null,
    rows: (close) => (s.mine
      ? <MyShareMenuRows read={myShareRead} othersPoint={yours.pointingOn ? yours.othersPoint : null} marksOn={yours.marksOn} onOthersPoint={flipOthersPoint}
        onClear={() => { if (yours.sid) marks?.clear(yours.sid); }} onChange={yours.onChange} onDone={close} />
      : <ShareMenuRows share={s} look={look} pointing={pointing} popped={isPopped} onPopOut={pop} onPut={board.handle.current && board.open?.role === 'edit' && !board.savedDrawn ? putShot : undefined}
        onBeside={beside} onDone={close} />),
    stop: !s.mine && organizer ? { label: 'Stop it for everyone', onPick: stopTheirShare } : null
  };
  return (
    <FrameBox id={id} box={box} shown focused={place.focused}>
      <Frame bar={bar} meta={s.mine ? myShareMeta : s.kept ? 'Read for the notes' : undefined} onStop={s.mine ? () => closing.stopMine(id) : undefined}>
        <ShareInFrame share={s} look={look} looks={looks.looks} popped={isPopped} marks={marks} me={me} whoIs={whoIs} pointing={pointing} onPopOut={pop} />
      </Frame>
    </FrameBox>
  );
}
