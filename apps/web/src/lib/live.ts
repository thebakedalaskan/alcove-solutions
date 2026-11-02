import type { CallParticipant, CallSession, CallState, LiveStore, RoomRecording } from '@alcove/api';
import { useSyncExternalStore } from 'react';
import type { LocalMedia } from '~/features/call/media';

export function useLive<S>(store: LiveStore<S>): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/* Live sessions and local media outlive a single route (pre-join hands both to the call screen). */
export const sessions: { call: { code: string; session: CallSession } | null; recording: RoomRecording | null; media: LocalMedia | null } = {
  call: null,
  recording: null,
  media: null
};

/** The current user's own tile in a call. */
export const selfIn = (s: CallState): CallParticipant | undefined => s.participants.find((p) => p.isMe);
