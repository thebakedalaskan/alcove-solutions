/** Explicit boolean choices propagate at once; profile polling remains authoritative after the short intent lease. */
import { NotificationPreferenceSignalSchema, type NotificationPreferenceSignal, type NotificationPrefs } from '@alcove/api';

import { accountGeneration } from './signedOut';

const sameGeneration = (signal: NotificationPreferenceSignal) => signal.ownerId === null ? signal.generation === null : signal.generation !== null && accountGeneration(signal.ownerId) === signal.generation;
const ownerKey = (owner: string | null) => owner ?? 'guest';
const latest = new Map<string, NotificationPreferenceSignal>();
const listeners = new Set<(signal: NotificationPreferenceSignal) => void>();
let channel: BroadcastChannel | null = null;
function take(signal: NotificationPreferenceSignal): void {
  if (!sameGeneration(signal)) return;
  if (signal.at > Date.now() + 1000 || Date.now() - signal.at >= 90_000) return;
  const previous = notificationPreferenceIntent(signal.ownerId);
  if (previous && (previous.at > signal.at || (previous.at === signal.at && previous.nonce > signal.nonce))) return;
  latest.set(ownerKey(signal.ownerId), signal);
  for (const listener of listeners) listener(signal);
  dispatchEvent(new Event('alcove-notification-preferences'));
}
export function notificationPreferenceIntent(owner: string | null): NotificationPreferenceSignal | null {
  const signal = latest.get(ownerKey(owner));
  if (!signal || Date.now() - signal.at >= 90_000 || signal.at > Date.now() + 1000 || !sameGeneration(signal)) { latest.delete(ownerKey(owner)); return null; }
  return signal;
}
export function announceNotificationPreferences(ownerId: string | null, prefs: NotificationPrefs): string {
  const signal: NotificationPreferenceSignal = { ownerId, generation: ownerId === null ? null : accountGeneration(ownerId), prefs, nonce: crypto.randomUUID(), at: Math.max(Date.now(), (latest.get(ownerKey(ownerId))?.at ?? 0) + 1) };
  take(signal); channel?.postMessage(signal);
  return signal.nonce;
}
const clear = () => latest.clear();
export function watchNotificationPreferences(listener: (signal: NotificationPreferenceSignal) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) addEventListener('alcove-notifications-clear', clear);
  if (listeners.size === 1 && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('alcove-notification-preferences');
    channel.onmessage = (event: MessageEvent<unknown>) => { const parsed = NotificationPreferenceSignalSchema.safeParse(event.data); if (parsed.success) take(parsed.data); };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = null; latest.clear(); removeEventListener('alcove-notifications-clear', clear); } };
}
