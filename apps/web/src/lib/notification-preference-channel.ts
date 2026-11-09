/** Short-lived explicit leaf choices; the query owner alone keeps confirmed account preferences. */
import { NotificationPreferenceSignalSchema, NotificationPrefsInputSchema, type NotificationPreferenceSignal, type NotificationPrefs } from '@alcove/api';
import { accountGeneration } from './signedOut';

type Key = keyof NotificationPrefs;
const keys = NotificationPrefsInputSchema.keyof().options;
function putLeaf(patch: Partial<NotificationPrefs>, key: Key, value: NotificationPrefs[Key] | undefined): void {
  if (key === 'beforeCall') { if (typeof value === 'number') patch.beforeCall = value; }
  else if (typeof value === 'boolean') patch[key] = value;
}

const sameGeneration = (signal: NotificationPreferenceSignal) => signal.ownerId === null ? signal.generation === null : signal.generation !== null && accountGeneration(signal.ownerId) === signal.generation;
const inTime = (signal: NotificationPreferenceSignal) => signal.at <= Date.now() + 1000 && Date.now() - signal.at < 90_000;
const live = (signal: NotificationPreferenceSignal) => sameGeneration(signal) && inTime(signal);
const ownerKey = (owner: string | null) => owner ?? 'guest';
const latest = new Map<string, Partial<Record<Key, NotificationPreferenceSignal>>>();
const listeners = new Set<(signal: NotificationPreferenceSignal) => void>();
let channel: BroadcastChannel | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
const changed = () => dispatchEvent(new Event('alcove-notification-preferences'));
function scheduleExpiry(): void {
  clearTimeout(expiry);
  prune();
  const ends = [...latest.values()].flatMap((leaves) => keys.flatMap((key) => {
    const signal = leaves[key]; return signal ? [signal.at + 90_000] : [];
  }));
  expiry = ends.length ? setTimeout(() => { prune(); changed(); scheduleExpiry(); }, Math.max(1, Math.min(...ends) - Date.now())) : undefined;
}
function prune(): void {
  for (const [owner, leaves] of latest) {
    const generation = owner === 'guest' ? null : accountGeneration(owner);
    for (const key of keys) { const signal = leaves[key]; if (signal && (!inTime(signal) || signal.generation !== generation || (owner !== 'guest' && generation === null))) delete leaves[key]; }
    if (!keys.some((key) => leaves[key])) latest.delete(owner);
  }
}
function take(signal: NotificationPreferenceSignal): void {
  if (!live(signal)) return;
  prune();
  const owner = ownerKey(signal.ownerId);
  const leaves = latest.get(owner) ?? {};
  const accepted: Partial<NotificationPrefs> = {};
  const accept = <K extends Key>(key: K) => {
    const value = signal.patch[key];
    const previous = leaves[key];
    if (value === undefined) return;
    if (signal.phase !== 'pending') { if (previous?.nonce !== signal.nonce || previous.generation !== signal.generation || previous.phase !== 'pending') return; }
    else if (previous && (previous.at > signal.at || (previous.at === signal.at && previous.nonce >= signal.nonce))) return;
    leaves[key] = signal; putLeaf(accepted, key, value);
  };
  for (const key of keys) accept(key);
  if (!Object.keys(accepted).length) return;
  latest.set(owner, leaves);
  for (const listener of listeners) listener({ ...signal, patch: accepted });
  changed(); scheduleExpiry();
}
/** Overlay only explicitly chosen live leaves, never incidental fields from another tab's full snapshot. */
export function notificationPreferenceIntent(owner: string | null): Partial<NotificationPrefs> {
  prune();
  const leaves = latest.get(ownerKey(owner));
  const patch: Partial<NotificationPrefs> = {};
  const copy = <K extends Key>(key: K) => { const value = leaves?.[key]?.patch[key]; putLeaf(patch, key, value); };
  for (const key of keys) copy(key);
  return patch;
}
export function announceNotificationPreferences(ownerId: string | null, patch: Partial<NotificationPrefs>): string {
  prune();
  const leaves = latest.get(ownerKey(ownerId));
  const at = Math.max(Date.now(), ...keys.map((key) => (leaves?.[key]?.at ?? 0) + 1));
  const signal: NotificationPreferenceSignal = { ownerId, generation: ownerId === null ? null : accountGeneration(ownerId), patch: structuredClone(patch), nonce: crypto.randomUUID(), at, phase: 'pending' };
  take(signal); if (live(signal)) channel?.postMessage(signal);
  return signal.nonce;
}
/** A failed command releases only leaves it still owns; newer choices in any tab remain in place. */
export function settleNotificationPreferences(ownerId: string, nonce: string, current: NotificationPrefs, phase: 'confirmed' | 'rollback'): void {
  prune();
  const leaves = latest.get(ownerKey(ownerId));
  const patch: Partial<NotificationPrefs> = {};
  const copy = <K extends Key>(key: K) => { if (leaves?.[key]?.nonce === nonce) putLeaf(patch, key, current[key]); };
  for (const key of keys) copy(key);
  const original = keys.map((key) => leaves?.[key]).find((signal) => signal?.nonce === nonce && signal.phase === 'pending');
  if (!Object.keys(patch).length || !original) return;
  const signal: NotificationPreferenceSignal = { ...original, patch, phase };
  take(signal); if (live(signal)) channel?.postMessage(signal);
}
const clear = () => { latest.clear(); clearTimeout(expiry); expiry = undefined; changed(); };
export function watchNotificationPreferences(listener: (signal: NotificationPreferenceSignal) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) addEventListener('alcove-notifications-clear', clear);
  if (listeners.size === 1 && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('alcove-notification-preferences');
    channel.onmessage = (event: MessageEvent<unknown>) => { const parsed = NotificationPreferenceSignalSchema.safeParse(event.data); if (parsed.success) take(parsed.data); };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = null; clear(); removeEventListener('alcove-notifications-clear', clear); } };
}
