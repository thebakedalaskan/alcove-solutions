/*
 * The call in the floating window (FloatingCallPortal.tsx): what's on your stage in front, or else a screen being watched, or else
 * whoever's speaking, someone else, or you; your microphone, camera and hand; what's waiting on you, each opening its place back
 * in the call; and Leave, whose question comes into this window when it was asked here (`asking`). Until this browser holds the
 * call's keys, nothing plays.
 */
import type { CallCrypto } from '@alcove/api';
import { CallTimerButton, LeaveChoices, type FloatingAttention } from '@alcove/ui';
import { callName } from '~/lib/people';
import { stateOf } from '../media/access';
import type { RoomView } from '../media/livekit';
import type { MediaSnapshot } from '../media/media';
import { FeedVideo } from '../media/Video';
import type { useLeaving } from '../session/leaving';
import type { useCallControls } from '../session/useCallControls';
import { screenOf, type ThingId } from '../stage/onStage';
import type { StageParticipant, StageShare } from '../stage/Stage';
import type { useCallTimer } from '../timer/useCallTimer';
import { FloatingCallPortal } from './FloatingCallPortal';
import type { useFloatingWindow } from './floatingWindow';

export function FloatingView({ floating, title, timer, onTimer, shares, front, screensShown, people, speaker, crypto, connection, m, controls, hand, busy, attention, soundBlocked, onSound, onAttention, leave, asking }: {
  floating: ReturnType<typeof useFloatingWindow>;
  title: string;
  timer: ReturnType<typeof useCallTimer>;
  /** Timer for everyone, back in the call. */
  onTimer: () => void;
  shares: readonly StageShare[];
  /** What's in front on your stage while two take turns. */
  front: ThingId | null;
  /** Whose screens are on your stage. */
  screensShown: readonly string[];
  /** Who's on your stage. */
  people: readonly StageParticipant[];
  speaker: string | null;
  crypto: CallCrypto;
  connection: RoomView['connection'];
  m: MediaSnapshot;
  controls: ReturnType<typeof useCallControls>;
  hand: boolean;
  busy: boolean;
  attention: { hands: number; questions: number; waiting: number; chat: number };
  soundBlocked: boolean;
  onSound: () => void;
  /** Where each count leads, back in the call. */
  onAttention: (kind: FloatingAttention) => void;
  leave: ReturnType<typeof useLeaving>;
  /** Leave's question is up, in this window. */
  asking: boolean;
}) {
  const returnToCall = () => { floating.owner.returnToCall(); };
  const share = (front ? shares.find((s) => screenOf(s.id) === front) : undefined) ?? shares.find((s) => screensShown.includes(s.id));
  const here = people.filter((p) => p.isMe || crypto.members.includes(p.id));
  const person = here.find((p) => p.id === speaker) ?? here.find((p) => !p.isMe) ?? here.find((p) => p.isMe);
  const feed = crypto.status === 'in' ? share?.feed ?? person?.video ?? null : null;
  return (
    <FloatingCallPortal target={floating.target} view={{
      title,
      timer: timer.time ? <CallTimerButton time={timer.time} label={timer.label} tone={timer.tone} onClick={() => { returnToCall(); onTimer(); }} /> : null,
      picture: feed ? <FeedVideo feed={feed} className={!share && person?.isMe ? 'is-self' : undefined} /> : null,
      person: share?.presenter ?? person?.person ?? null,
      label: crypto.status === 'moving' ? 'Moving between rooms…' : crypto.status !== 'in' ? 'Connecting securely…' : share?.label ?? (person ? `${callName(person.person)}${person.video ? '' : ' · camera off'}` : 'Waiting for someone to join'),
      connection,
      mic: { on: m.mic, pending: controls.pending.mic, problem: m.access.mic.problem ? stateOf('mic', m.access.mic.problem) : null },
      cam: { on: m.cam, pending: controls.pending.cam, problem: m.access.cam.problem ? stateOf('cam', m.access.cam.problem) : null },
      hand, handPending: controls.pending.hand, busy,
      // While Leave's question is in the window, what went wrong is said under its choices instead.
      attention, error: crypto.status === 'failed' ? 'This device lost the call’s encryption keys. Return to the call to reload.' : asking ? null : controls.error, soundBlocked, onSound,
      onMic: () => controls.mic('floating'), onCam: () => controls.cam('floating'), onHand: () => controls.hand(!hand, 'floating'),
      onLeave: () => leave.request('floating'),
      onReturn: returnToCall,
      onAttention: (kind) => { returnToCall(); onAttention(kind); },
      children: asking ? <LeaveChoices {...leave.choices} title={leave.title} onStay={leave.stay} /> : null
    }} />
  );
}
