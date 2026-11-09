import type { CallParticipant, CallSession, CallState, LiveStore } from '@alcove/api';
import { useBlocker } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LocalMedia } from '~/features/call/media/media';
import type { StageRecording } from '~/features/record/stage';

export function useLive<S>(store: LiveStore<S>): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const onLine = () => navigator.onLine;
const onConnection = (changed: () => void) => {
  addEventListener('online', changed);
  addEventListener('offline', changed);
  return () => { removeEventListener('online', changed); removeEventListener('offline', changed); };
};
/** Whether this browser has a connection. Offline, recording still works (when it's on in Settings); everything else waits for it. */
export const useOnline = (): boolean => useSyncExternalStore(onConnection, onLine, () => true);

/** Whether a media query matches, such as the phone's width, following it as the window changes. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback((changed: () => void) => {
    const m = matchMedia(query);
    m.addEventListener('change', changed);
    return () => m.removeEventListener('change', changed);
  }, [query]);
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false);
}

/** `value`, once it has stayed the same for `ms`: a search waits for a pause in typing. */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const t = setTimeout(() => setSettled(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return settled;
}

/** The time now, refreshed every `every` milliseconds, for "in 12 min" and the like. */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]);
  return now;
}

/*
 * Live sessions and local media outlive a single route (pre-join hands both to the call screen). Record hands the
 * stage recorder the name for its next recording the same way, in memory: nothing readable goes in the address.
 */
export const sessions: { call: { code: string; session: CallSession } | null; recording: StageRecording | null; media: LocalMedia | null; roomTitle: string | null } = {
  call: null,
  recording: null,
  media: null,
  roomTitle: null
};
/**
 * Tells `session`'s call when this page goes away (closed, reloaded, or left for another), at once: someone asking
 * takes the ask back, and anyone else in the call drops out then rather than when LiveKit notices. A page only put
 * away to come back to (the back-forward cache) carries on where it was.
 */
export function useClosingWithPage(session: CallSession | null) {
  useEffect(() => {
    if (!session) return;
    const gone = (e: PageTransitionEvent) => { if (!e.persisted) session.closing(); };
    window.addEventListener('pagehide', gone);
    return () => window.removeEventListener('pagehide', gone);
  }, [session]);
}

/**
 * Keeps someone on a live screen (a call, a room recording) until they end it. Going back, or
 * anywhere else in the app, opens the screen's own way out instead (`onAttempt`), and closing the
 * tab asks the browser to confirm when `confirmBeforeUnload` is true. Room recordings keep that
 * confirmation: coming back halfway would start a second recorder on the same recording.
 */
export function useLeaveGuard(onAttempt: () => void, confirmBeforeUnload = true) {
  const released = useRef(false);
  const attempt = useRef(onAttempt);
  attempt.current = onAttempt;
  const blocker = useBlocker({ shouldBlockFn: () => !released.current, enableBeforeUnload: () => confirmBeforeUnload && !released.current, withResolver: true });
  const latest = useRef(blocker);
  latest.current = blocker;
  useEffect(() => { if (blocker.status === 'blocked') attempt.current(); }, [blocker.status]);
  return {
    /** The way out was dismissed: stay, and forget where they were going. */
    stay: () => { if (latest.current.status === 'blocked') latest.current.reset(); },
    /** Leaving is settled (the call ended, the recording finished): navigation goes through from now on. */
    release: () => { released.current = true; if (latest.current.status === 'blocked') latest.current.reset(); },
    /** Leaving is settled; carry on to where they were going. False when nothing was waiting. */
    proceed: (): boolean => {
      released.current = true;
      const b = latest.current;
      if (b.status !== 'blocked') return false;
      b.proceed();
      return true;
    }
  };
}

/** The current user's own tile in a call. */
export const selfIn = (s: CallState): CallParticipant | undefined => s.participants.find((p) => p.isMe);
