/*
 * What a call hands from one page to the next, in memory. Live sessions and local media outlive a single route (pre-join
 * hands both to the call screen). Record hands the stage recorder the name for its next recording the same way: nothing
 * readable goes in the address. A call's page leaving for Home or the notes says so the same way (`arrive`, and when, through
 * `arriveFromCall`), once: the frame takes it as it opens (`takeArrival`), and settles in.
 */
import type { CallSession } from '@alcove/api';
import { useEffect } from 'react';
import type { LocalMedia } from '~/features/call/media/media';
import type { StageRecording } from '~/features/record/stage';

export const sessions: { call: { code: string; session: CallSession } | null; recording: StageRecording | null; media: LocalMedia | null; roomTitle: string | null; arrive: { from: 'call'; at: number } | null } = {
  call: null,
  recording: null,
  media: null,
  roomTitle: null,
  arrive: null
};
/** How soon after a call's page leaves the frame must open to arrive from it. */
const ARRIVING_WITHIN_MS = 4000;
/** A call's page is leaving for the frame (Home, or the notes): the frame arrives from it there. */
export function arriveFromCall(): void {
  sessions.arrive = { from: 'call', at: Date.now() };
}
/**
 * Whether the frame opening now arrives from a call's page, once: taking it uses it up. Only on the way there: one that never
 * arrived (Home sent elsewhere to sign in, say) is forgotten.
 */
export function takeArrival(): boolean {
  const said = sessions.arrive;
  sessions.arrive = null;
  return said !== null && Date.now() - said.at < ARRIVING_WITHIN_MS;
}
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
