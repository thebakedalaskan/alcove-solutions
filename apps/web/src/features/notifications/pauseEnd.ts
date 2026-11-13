/*
 * Pause notifications, from your menu at the top right (features/notifications/usePause.ts): for a while nothing reaches you from the
 * browser or by sound, on every device you're signed in on. As quiet mode does, your own microphone going on and off still
 * sounds, and someone asking to join a call you host still reaches you, by sound and by browser notification, since they're
 * waiting at the door. What shows on the page (a ring's card, a call's chat, toasts) doesn't change. It's
 * `notificationsPausedUntil` in the account's preferences, and it ends by itself at its time: browser notifications
 * (features/notifications/delivery.ts) and sounds (soundCues.ts) each ask `notificationsPauseHolds` at the moment
 * something would reach you, so nothing waits on a timer to start again. A guest has no pause.
 */
import type { Preferences } from '@alcove/api';

/** When the pause in `prefs` ends, in ms, as it's kept (a time already past too), or null when there's none. */
export function notificationsPauseEndOf(prefs: Preferences | undefined): number | null {
  const kept = prefs?.notificationsPausedUntil;
  const end = kept ? Date.parse(kept) : Number.NaN;
  return Number.isNaN(end) ? null : end;
}

/** Whether a pause that ends at `end` (as `notificationsPauseEndOf` reads it; null for none) holds at `now`. */
export const notificationsPauseHolds = (end: number | null, now: number): boolean => end !== null && now < end;
