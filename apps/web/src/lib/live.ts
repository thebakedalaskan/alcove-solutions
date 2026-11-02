import type { CallParticipant, CallSession, CallState, LiveStore, RoomRecording } from '@alcove/api';
import { useSyncExternalStore } from 'react';

export function useLive<S>(store: LiveStore<S>): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/* Live sessions outlive a single route (pre-join hands the call to the call screen), so they're held here. */
export const sessions: { call: { code: string; session: CallSession } | null; recording: RoomRecording | null } = {
  call: null,
  recording: null
};

/** The current user's own tile in a call. */
export const selfIn = (s: CallState): CallParticipant | undefined => s.participants.find((p) => p.isMe);
