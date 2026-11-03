import type { CallParticipant, CallSession, CallState, LiveStore, RoomRecording } from '@alcove/api';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { LocalMedia } from '~/features/call/media';

export function useLive<S>(store: LiveStore<S>): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** The time now, refreshed every `every` milliseconds, for "in 12 min" and the like. */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]);
  return now;
}

/* Live sessions and local media outlive a single route (pre-join hands both to the call screen). */
export const sessions: { call: { code: string; session: CallSession } | null; recording: RoomRecording | null; media: LocalMedia | null } = {
  call: null,
  recording: null,
  media: null
};

/** The current user's own tile in a call. */
export const selfIn = (s: CallState): CallParticipant | undefined => s.participants.find((p) => p.isMe);
