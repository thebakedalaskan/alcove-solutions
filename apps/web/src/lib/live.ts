/*
 * Live things and the browser around them, for every feature: reading a LiveStore (`useLive`), the connection, a media query,
 * a value that has settled, the time now, and keeping someone on a live screen (a call, a room recording) until they end it.
 */
import type { LiveStore } from '@alcove/api';
import { useBlocker } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

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

/**
 * The time now, refreshed every `every` milliseconds, for "in 12 min" and the like. Refreshes fall on the clock's own marks
 * (every whole 30 seconds, by default), so wherever the time decides something, Home's line and the call at the foot of the side
 * panel among them, it turns over everywhere at once.
 */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = () => every - (Date.now() % every);
    let t = setTimeout(function tick() { setNow(Date.now()); t = setTimeout(tick, next()); }, next());
    return () => clearTimeout(t);
  }, [every]);
  return now;
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

