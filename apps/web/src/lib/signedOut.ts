/*
 * Signing out, or deleting the account, in one tab is heard in every other tab of this browser at once (BroadcastChannel
 * `alcove-account`). From then on nothing is kept here for that account, in any tab: what was kept was deleted on purpose,
 * and nothing may bring it back, nor the device key that sealed it. The other tabs leave for the welcome page, so none of
 * them goes on saying that what's written there is safe. Signing in again is heard the same way, and keeping starts again.
 */
import { AccountSignalSchema, type AccountSignal } from '@alcove/api';

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('alcove-account');
const gone = new Set<string>();
const listeners = new Set<(owner: string, deleted: boolean) => void>();

channel?.addEventListener('message', (e: MessageEvent<unknown>) => {
  const signal = AccountSignalSchema.safeParse(e.data);
  if (!signal.success) return;
  const s = signal.data;
  if (s.type === 'signed-in') { gone.delete(s.owner); return; }
  gone.add(s.owner);
  listeners.forEach((l) => l(s.owner, s.deleted));
});
const say = (signal: AccountSignal) => { channel?.postMessage(signal); };

/** Whether `owner` signed out in this browser since this page loaded, in this tab or another. */
export const signedOut = (owner: string): boolean => gone.has(owner);

/** This tab is signing `owner` out, or deleting the account: from now on nothing is kept for them, here or in any other tab. */
export function announceSignOut(owner: string, deleted: boolean): void {
  gone.add(owner);
  say({ type: 'signed-out', owner, deleted });
}

/** `owner` signed in here: every tab keeps what's written for them again. */
export function announceSignIn(owner: string): void {
  gone.delete(owner);
  say({ type: 'signed-in', owner });
}

/** Another tab signed someone out, or deleted their account. */
export function onSignedOutElsewhere(listener: (owner: string, deleted: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
