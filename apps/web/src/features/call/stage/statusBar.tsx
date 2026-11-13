/*
 * The status bar over the stage (Stage.tsx draws it): what's true of the call for you now, a pill each. Talking on mute, the sound
 * the browser holds back, cameras you've hidden, moving between parts of the call, who's hosting while the organizer's away, the
 * rooms and how long they have left (or the organizer's message to every room), nobody here yet, and who's spotlighted. It's
 * built only from what's there, so with nothing to say over the call there's no band above it, and the stage starts at the top.
 */
import type { CallState } from '@alcove/api';
import { Avatar, Dots, Icon } from '@alcove/ui';
import type { ReactNode } from 'react';
import { callName } from '~/lib/people';
import { HostSpill } from '../rooms/Hosting';
import type { useBreakoutRooms } from '../rooms/useBreakoutRooms';

/** Time left in the rooms, as the rooms show it: 4:12. */
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export interface StatusFacts {
  state: CallState;
  organizer: boolean;
  hosting: boolean;
  live: boolean;
  /** Breakout rooms, as you're in them. */
  rooms: Pick<ReturnType<typeof useBreakoutRooms>, 'open' | 'roomName' | 'message' | 'roomsOnBoards' | 'organizerPerson' | 'left'>;
  /** On the way to another part of the call: nothing is heard or sent until this browser holds the new part's keys. */
  moving: boolean;
  /** The board on the stage says the rooms' time in its own pill, so the line says nothing more. */
  pillSaysRooms: boolean;
  talkingOnMute: boolean;
  onUnmute: () => void;
  soundBlocked: boolean;
  onPlaySound: () => void;
  /** Cameras hidden by your own choice, while anyone else is here. */
  camerasHidden: boolean;
  onShowCameras: () => void;
  /** Nobody else is here yet, and nobody's being rung. */
  alone: boolean;
  onCopyLink: () => void;
  /** Who's spotlighted for everyone, by name, or null for you; none while rooms are open. */
  spotlight: { name: string | null } | null;
  onStopSpotlight: () => void;
  /** Whoever stands in for the organizer brings everyone back from the rooms. */
  onBringBack: () => void;
}

/** The status bar's pills, or nothing when there's nothing to say. */
export function statusPills(f: StatusFacts): ReactNode {
  const { open, roomName, message, roomsOnBoards, organizerPerson, left } = f.rooms;
  const movingBar = f.moving && (
    <div className="ic-spill" role="status"><Dots /><span className="tx2">{roomName ? <>Moving you to <b>{roomName}</b></> : <>Moving you back to the <b>main room</b></>}</span></div>
  );
  /*
   * In a room (or the main room while rooms are open): where you are and how long for. In rooms without boards, the organizer's
   * message to every room shows here for a moment; with boards it's a toast.
   */
  const roomBar = open && (!f.organizer || roomName !== null) && (movingBar || (message && !roomsOnBoards ? (
    <div className="ic-banner">{organizerPerson && <Avatar person={organizerPerson} size={24} />}<span><b>{organizerPerson ? callName(organizerPerson) : 'The organizer'}</b> to all rooms: {message.text}</span></div>
  ) : !f.pillSaysRooms && (
    <div className="ic-spill"><Icon name={left <= 30 ? 'timer' : 'door'} size={15} />
      <span className="tx2">{left <= 30 ? <>Rooms close in <b>{mmss(left)}</b>. Everyone comes back to the main room.</> : <>You’re in <b>{roomName ?? 'the main room'}</b> · everyone comes back in {mmss(left)}</>}</span>
    </div>
  )));
  // Closed, the card that says you're alone is gone for the rest of the call: the link is still in People.
  const alone = f.alone && (
    <div className="ic-spill"><Icon name="link" size={15} /><span className="tx2">Nobody else is here yet</span>
      <button type="button" className="sp-btn is-strong" onClick={f.onCopyLink}>Copy link</button>
    </div>
  );
  /* Talking with your microphone muted: said at the top of the call, with Unmute, from your microphone's level here alone. */
  const mutePill = f.talkingOnMute && (
    <div className="ic-spill" role="status"><Icon name="micOff" size={15} /><span className="tx2">You’re talking on mute</span>
      <button type="button" className="sp-btn is-strong" onClick={f.onUnmute}>Unmute</button>
    </div>
  );
  const soundPill = f.soundBlocked && (
    <div className="ic-spill"><Icon name="speakerOff" size={15} /><span className="tx2">Your browser is holding back the call’s sound</span>
      <button type="button" className="sp-btn is-strong" onClick={f.onPlaySound}>Play sound</button>
    </div>
  );
  // Hidden by this person's own choice, remembered in this browser: said while anyone else is here, or everyone just seems
  // to have their camera off. On a narrow screen it's the icon and the button, the words kept for screen readers.
  const camsPill = f.camerasHidden && (
    <div className="ic-spill is-cams"><Icon name="videoOff" size={15} /><span className="tx2">Cameras are hidden for you</span>
      <button type="button" className="sp-btn is-strong" onClick={f.onShowCameras}>Show cameras</button>
    </div>
  );
  /* While someone stands in for the organizer, everyone sees who; whoever it is can bring everyone back from the rooms. */
  const hostPill = f.state.host.standIn && f.live && <HostSpill state={f.state} onBringBack={open && f.hosting ? f.onBringBack : undefined} />;
  const spotlight = f.spotlight;
  return open
    ? (f.organizer ? (mutePill || soundPill || camsPill || roomBar ? <>{mutePill}{soundPill}{camsPill}{roomBar}</> : null)
      : [mutePill, soundPill, camsPill, hostPill, roomBar].some(Boolean) ? <>{mutePill}{soundPill}{camsPill}{hostPill}{roomBar}</> : null)
    : (spotlight || alone || mutePill || soundPill || movingBar || camsPill || hostPill) ? (
      <>
        {mutePill}
        {soundPill}
        {movingBar}
        {camsPill}
        {hostPill}
        {alone}
        {spotlight && (
          <div className="ic-spill"><Icon name="spotlight" size={15} /><span className="tx2">{spotlight.name ? <><b>{spotlight.name}</b> is spotlighted for everyone</> : <><b>You’re</b> spotlighted for everyone</>}</span>
            {f.hosting && <button type="button" className="sp-btn is-strong" onClick={f.onStopSpotlight}>Stop spotlight</button>}
          </div>
        )}
      </>
    ) : null;
}
