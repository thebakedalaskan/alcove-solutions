/*
 * This tab's hold on the call, as it changes without anything pressed here: its keys falling out of step, the connection
 * dropping for good, the call ending or going on without this tab, and the connection coming back. InCall.tsx calls each where
 * it runs among the call screen's other lifecycles.
 */
import type { CallCrypto, CallSession, CallState } from '@alcove/api';
import { wsToast, type useToast, type WsToastData } from '@alcove/ui';
import type { QueryClient } from '@tanstack/react-query';
import type { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, type RefObject } from 'react';
import { type useLeaveGuard } from '~/lib/live';
import { sessions } from './handoff';
import type { CallRoom, RoomView } from '../media/livekit';
import type { LocalMedia } from '../media/media';
import type { CallVolumes } from '../media/volume';
import type { LeftHow } from './CallOver';

type Toast = ReturnType<typeof useToast>;
type Guard = RefObject<ReturnType<typeof useLeaveGuard>>;

/** Takes away the toast that said why this tab left the call: it isn't true any more once the tab joins again. */
let leftToast: (() => void) | null = null;

/** Joining again takes away what was said as this tab last left the call (`useOutOfTheCall`). */
export function useForgetWhyLeft(): void {
  useEffect(() => { leftToast?.(); leftToast = null; }, []);
}

/** This device's keys fell out of step: joining again (a reload) puts it back in, without anyone letting it in. */
export function useKeysLost(status: CallCrypto['status'], toast: Toast, guard: Guard): void {
  useEffect(() => {
    if (status !== 'failed') return;
    toast('This device lost the call’s encryption keys. Reload to join again.', { icon: 'x', ms: 120_000, action: { label: 'Reload', onClick: () => { guard.current.release(); location.reload(); } } });
  }, [status, toast]);
}

/**
 * Whoever hosts ended the call: it's over here too, and its page says so. Otherwise the host removed you, or the call went on
 * from another tab or device: you're told, and go back to the call's link. The organizer is removed only by joining from another
 * device; this screen then lets go of the call. An organizer's tab that was away long enough for someone else to host goes back
 * to the join page, where joining takes the call back. A connection that dropped for good asks for a reload. `over`: this tab
 * has let go of the call already, by leaving, ending it, handing it on or moving it; `overHere` and `mediaNow` read the call and
 * your devices as they are when it's over.
 */
export function useOutOfTheCall({ session, code, phase, roomView, cryptoStatus, outOfGroup, organizerTab, leaving, done, over, guard, toast, navigate, qc, room, media, volumes, forgetLayout, discardDisplaced, mediaNow, overHere }: {
  session: CallSession;
  code: string;
  /** The call's phase, as the server last said it. */
  phase: CallState['phase'];
  roomView: RoomView;
  cryptoStatus: CallCrypto['status'];
  /** This tab is out of the call's group: removed, or away long enough for someone else to host. */
  outOfGroup: boolean;
  /** This tab joined as the organizer. */
  organizerTab: boolean;
  leaving: boolean;
  done: boolean;
  over: RefObject<boolean>;
  guard: Guard;
  toast: Toast;
  navigate: ReturnType<typeof useNavigate>;
  qc: QueryClient;
  room: CallRoom;
  media: LocalMedia;
  volumes: CallVolumes;
  forgetLayout: () => void;
  discardDisplaced: () => void;
  mediaNow: () => { mic: boolean; cam: boolean };
  overHere: (how: LeftHow, media: { mic: boolean; cam: boolean }) => void;
}): void {
  /* The connection dropped for good: its toast offers a reload, until the call says this tab is out of it (someone else hosts now). */
  const dropped = useRef<(() => void) | null>(null);
  /* The call says it has ended, or its room went with it, and not by anything this tab did: whoever hosts ended it, or Alcove did. */
  const endedByHost = !organizerTab && ((roomView.connection === 'ended' && roomView.endReason === 'ended-by-host') || phase === 'ended');
  useEffect(() => {
    if (leaving || done || (over.current && !(dropped.current && outOfGroup))) return;
    if (roomView.connection === 'ended' && roomView.endReason === 'error' && !outOfGroup && !endedByHost) {
      over.current = true;
      dropped.current = toast('The call’s connection dropped. Reload to join again.', { icon: 'x', ms: 120_000, action: { label: 'Reload', onClick: () => { guard.current.release(); location.reload(); } } });
      return;
    }
    const gone = (roomView.connection === 'ended' && roomView.endReason === 'removed') || endedByHost;
    if (!gone && !outOfGroup) return;
    dropped.current?.();
    dropped.current = null;
    over.current = true;
    const was = mediaNow();
    discardDisplaced();
    session.close();
    void room.leave();
    sessions.call = null;
    forgetLayout();
    media.stop();
    volumes.clear();
    sessions.media = null;
    void qc.invalidateQueries();
    if (endedByHost) {
      overHere({ kind: 'ended-by' }, was);
      return;
    }
    guard.current.release();
    const away = cryptoStatus === 'away';
    leftToast = toast(away ? 'Your connection dropped, so someone else is hosting. Join again to take the call back.'
      : organizerTab ? 'You joined this call from another device.'
        : roomView.endReason === 'removed' ? 'The host removed you from the call.'
          : 'You’re no longer in this call here. You can join again.', { icon: 'leave', ...(away ? { ms: 8000 } : {}) });
    void navigate(organizerTab && !away ? { to: '/home', replace: true } : { to: '/join/$code', params: { code }, replace: true });
    // overHere and mediaNow read the call and your devices as they are when this runs.
  }, [roomView.connection, roomView.endReason, endedByHost, outOfGroup, cryptoStatus, leaving, done, organizerTab, code, forgetLayout, media, volumes, navigate, toast, session, room, qc, discardDisplaced]);
}

/**
 * The connection, this browser's or the call's media's, is back after it was down: said once, in the workspace's place for what
 * it says (`act`), so a document saying its edits are saved says so instead. Not once the call's over here.
 */
export function useReconnectedSaid(down: boolean, done: boolean, act: { say: (toast: WsToastData) => void }): void {
  const wasDown = useRef(false);
  useEffect(() => {
    if (down) { wasDown.current = true; return; }
    if (!wasDown.current || done) return;
    wasDown.current = false;
    act.say(wsToast.reconnected());
  }, [down, done, act]);
}
