/*
 * Leaving the call. Whoever hosts ends it for everyone, or leaves it going with someone else hosting; anyone else just leaves,
 * through the same capture and media cleanup. Leave's question is for whoever hosts, and what makes way for it: nothing else
 * stays open over the call under it, or once the call's over; it goes for someone who no longer hosts; and asked in the floating
 * call's own window, it goes with that window. Moving to another device lets go here first too.
 */
import { errorMessage, type CallSession, type CallState, type Meeting } from '@alcove/api';
import type { LeaveHost, useToast } from '@alcove/ui';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { useLeaveGuard } from '~/lib/live';
import { log } from '~/lib/log';
import { callName } from '~/lib/people';
import type { CallRoom } from '../media/livekit';
import type { LocalMedia } from '../media/media';
import type { CallVolumes } from '../media/volume';
import type { useNotesCapture } from '../notes/useNotesCapture';
import { organizerFirst } from '../rooms/Hosting';
import { leftOf, onTheWay, type Left, type LeftHow } from './CallOver';
import { sessions } from './handoff';
import { rememberPass } from './pass';
import type { useCallControls } from './useCallControls';

const clog = log.child({ component: 'call' });

type Guard = RefObject<ReturnType<typeof useLeaveGuard>>;
type Toast = ReturnType<typeof useToast>;
type Capture = ReturnType<typeof useNotesCapture>;
/** Your microphone and camera as you leave: Rejoin brings them back as they were. */
type MediaAsLeft = { mic: boolean; cam: boolean };

/**
 * Where leaving stands. Leave's question, for whoever hosts, open over Leave or in the floating call's own window; a departure on
 * its way (ending the call, or leaving it, for anyone else; or leaving it with someone hosting), with `departing` saying so to
 * what runs while it's on its way; and the call over here, its page taken over and the call easing back under it.
 */
export function useDeparture() {
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveInFloating, setLeaveInFloating] = useState(false);
  const [leavingAs, setLeavingAs] = useState<'end' | 'keep' | null>(null);
  const departing = useRef(false);
  const [done, setDone] = useState(false);
  return { leaveOpen, setLeaveOpen, leaveInFloating, setLeaveInFloating, leavingAs, setLeavingAs, leaving: leavingAs !== null, departing, done, setDone };
}
export type Departure = ReturnType<typeof useDeparture>;

/**
 * The call is over here: its page takes over with what it needs to know of the call, taken now from the call as it last was
 * (`last`) and your microphone and camera as you left, and the call eases back under it. Leaving on the way somewhere, such as to
 * a call that rang, carries on there instead, with a word of what happened.
 */
export function whenOver({ last, organizer, meeting, guard, toast, departure, closeMenus, onOver }: {
  last: RefObject<CallState>;
  organizer: boolean;
  /** Who's invited, as only the organizer reads it. */
  meeting: Meeting | null | undefined;
  guard: Guard;
  toast: Toast;
  departure: Departure;
  /** Whatever's open over the call goes with it. */
  closeMenus: () => void;
  onOver: (left: Left) => void;
}): (how: LeftHow, media: MediaAsLeft) => void {
  return (how, media) => {
    const left = leftOf({ last: last.current, how, media, invited: organizer ? meeting?.guests ?? null : null });
    if (guard.current.proceed()) { toast(onTheWay(left), { icon: 'leave' }); return; }
    departure.setDone(true);
    departure.setLeaveOpen(false);
    closeMenus();
    onOver(left);
  };
}

/**
 * Moving to another device. Letting go here comes first: what the notes heard so far is sent, then the microphone and camera stop
 * and this device leaves the room. Only then is the new device let in (features/move/useMoveOut.ts).
 */
export function letGoForMove({ over, capture, session, room, media, guard }: { over: RefObject<boolean>; capture: Capture; session: CallSession; room: CallRoom; media: LocalMedia; guard: Guard }): () => Promise<void> {
  return async () => {
    over.current = true;
    const departure = capture.departure('move');
    await departure.flush();
    departure.finish();
    session.close();
    await room.leave().catch((e: unknown) => clog.debug('leaving the room to move', { err: e }));
    media.stop();
    sessions.media = null;
    guard.current.release();
  };
}

/**
 * Leaving, as Leave and Leave's question do it. The last audio and speech go before the call ends or this browser leaves it: the
 * server refuses them after. That's the host's, and a breakout room scribe's for its room. The recorder is paused, not stopped,
 * until it has: if ending fails, the same recorder carries on, so its pieces stay in order in the same segment (a new one would
 * number its pieces from the start again, and the server keeps the first of each). Leaving with someone else hosting sends the
 * last audio and speech first, then the call is theirs, and its page says who's hosting until the organizer's back: only the
 * organizer's Rejoin takes it back. If they can't host after all, you stay, and the paused recorder carries on in the same segment.
 *
 * Whoever hosts decides what happens to everyone, in Leave's question. Alone in the call, pressing Leave (in the dock, or in the
 * floating call's own window) ends it at once, with nobody to hand it to and nothing to choose; any other way out while alone
 * (going back a page, anywhere else in the app, a call that rang) asks first, End's line saying leaving ends the call, so nothing
 * ends it by accident. The question goes for someone who no longer hosts.
 */
export function useLeaving({ session, state, hosting, departure, capture, room, media, volumes, forgetLayout, qc, over, guard, controls, toast, mediaNow, overHere }: {
  session: CallSession;
  state: CallState;
  hosting: boolean;
  departure: Departure;
  capture: Capture;
  room: CallRoom;
  media: LocalMedia;
  volumes: CallVolumes;
  /** Leaving the call forgets how you arranged it (layout/view.ts). */
  forgetLayout: () => void;
  qc: QueryClient;
  /** This tab has let go of the call. */
  over: RefObject<boolean>;
  guard: Guard;
  /** The dock's controls, which say what went wrong under Leave's question. */
  controls: ReturnType<typeof useCallControls>;
  toast: Toast;
  mediaNow: () => MediaAsLeft;
  overHere: (how: LeftHow, media: MediaAsLeft) => void;
}) {
  const { setLeaveOpen, setLeavingAs, departing, done, leaveOpen } = departure;
  /** Leave's question is up, as a departure that fails finds it. */
  const askingNow = useRef(false);
  askingNow.current = hosting && leaveOpen;
  const end = async (hostConfirmed = false) => {
    if (departing.current) return;
    departing.current = true;
    setLeavingAs('end');
    const was = mediaNow();
    const capturing = capture.departure('leave');
    try {
      await capturing.flush();
      // Uploading the final audio can outlast a host change. A new host must choose before ending everyone's call.
      if (!hostConfirmed && session.getSnapshot().isHost) {
        capturing.rollback();
        setLeaveOpen(true);
        return;
      }
      const r = await session.leave();
      capturing.finish();
      over.current = true;
      forgetLayout();
      // Ending the call deletes its room, which disconnects everyone at once; anyone else leaves the room now.
      if (!r) void room.leave();
      media.stop();
      volumes.clear();
      sessions.media = null;
      sessions.call = null;
      // Whoever comes back to a call they left (Rejoin, or its link after a reload) isn't asked again.
      if (!r) rememberPass(state.code, session.ticket.pass);
      void qc.invalidateQueries();
      overHere(r ? { kind: 'ended', elapsed: r.duration, noteId: r.pendingNoteId } : { kind: 'left' }, was);
    } catch (e) {
      capturing.rollback();
      clog.error('leaving the call failed', { err: e });
      controls.setError(errorMessage(e));
      guard.current.stay();
      // Leave's question, while it's open, says why under its choices.
      if (!askingNow.current) toast(errorMessage(e), { icon: 'x' });
    } finally {
      departing.current = false;
      setLeavingAs(null);
    }
  };
  const handOff = async (to: string) => {
    if (departing.current) return;
    departing.current = true;
    setLeavingAs('keep');
    const who = state.participants.find((p) => p.id === to)?.person;
    const was = mediaNow();
    const capturing = capture.departure('hand-off');
    try {
      await capturing.flush();
      await session.handOff(to);
      capturing.finish(() => {
        over.current = true;
        forgetLayout();
      });
      void room.leave();
      media.stop();
      volumes.clear();
      sessions.media = null;
      sessions.call = null;
      rememberPass(state.code, session.ticket.pass);
      void qc.invalidateQueries();
      overHere({ kind: 'handed', to: who ? callName(who) : 'Someone else' }, was);
    } catch (e) {
      capturing.rollback();
      clog.warn('handing the call on failed', { err: e });
      controls.setError(errorMessage(e));
      // Back to the question, which says why under its choices.
      setLeaveOpen(true);
    } finally {
      departing.current = false;
      setLeavingAs(null);
    }
  };
  const onlyYou = state.participants.every((p) => p.isMe);
  const request = (from: 'dock' | 'floating' | 'elsewhere') => {
    if (departing.current || done) return;
    controls.setError(null);
    departure.setLeaveInFloating(from === 'floating');
    if (hosting && (!onlyYou || from === 'elsewhere')) setLeaveOpen(true);
    else void end(hosting);
  };
  useLeaveAskFollowsHosting({ hosting, leaveOpen, done, setLeaveOpen, guard });
  /** Stay in the call: the question goes, and so does wherever you were going. Not while it's ending. */
  const stay = () => { if (departure.leaving) return; setLeaveOpen(false); guard.current.stay(); };
  /* Who could host after you, best first, as the call names them: for Leave's question. */
  const hosts: LeaveHost[] = state.host.next.flatMap((id) => { const p = state.participants.find((x) => x.id === id); return p ? [{ id, person: p.person }] : []; });
  /*
   * Leave's question: End for everyone, or leave it going with someone hosting (the best person is chosen already, and Change
   * shows who else could). Someone standing in for the organizer sees leaving it going first; alone, End is all there is, and its
   * line says leaving ends the call.
   */
  const choices = {
    onEnd: () => void end(true), onKeep: (to: string) => void handOff(to), notes: state.notes.everOn, alone: onlyYou, hosts,
    standingInFor: state.host.standIn && hosting ? organizerFirst(state) : null, busy: departure.leavingAs, error: controls.error
  };
  return { request, stay, choices, title: `Leave ${state.title}` };
}

/**
 * Once the call's over here, or while Leave's question is up: what the workspace said last, such as a switch with Back, means
 * nothing any more and would sit over the question (`act.hush`), and Settings and Background never stay open under it
 * (`closeWindows`): one window at a time.
 */
export function useQuietForLeave({ done, leaveOpen, act, closeWindows }: { done: boolean; leaveOpen: boolean; act: { hush: () => void }; closeWindows: () => void }): void {
  useEffect(() => { if (done || leaveOpen) act.hush(); }, [done, leaveOpen, act]);
  useEffect(() => { if (done || leaveOpen) closeWindows(); }, [done, leaveOpen]);
}

/** Leave's question is for whoever hosts: someone who no longer does stays in the call, and wherever they were going is forgotten. */
export function useLeaveAskFollowsHosting({ hosting, leaveOpen, done, setLeaveOpen, guard }: {
  hosting: boolean;
  leaveOpen: boolean;
  done: boolean;
  setLeaveOpen: (open: boolean) => void;
  guard: Guard;
}): void {
  useEffect(() => {
    if (!hosting && leaveOpen && !done) {
      setLeaveOpen(false);
      guard.current.stay();
    }
  }, [hosting, leaveOpen, done]);
}

/**
 * Leave's question asked in the floating call's own window goes when that window does, and so does wherever you were going,
 * unless you're on your way out already.
 */
export function useLeaveAskGoesWithFloating({ target, inFloating, leaving, setInFloating, setLeaveOpen, guard }: {
  /** The floating call's window, while it's open. */
  target: Window | null;
  /** Leave's question was asked there. */
  inFloating: boolean;
  leaving: boolean;
  setInFloating: (asked: boolean) => void;
  setLeaveOpen: (open: boolean) => void;
  guard: Guard;
}): void {
  useEffect(() => {
    if (target || !inFloating) return;
    setInFloating(false);
    if (!leaving) { setLeaveOpen(false); guard.current.stay(); }
  }, [target, inFloating, leaving]);
}
