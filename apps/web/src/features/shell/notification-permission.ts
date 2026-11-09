/** Owns only browser permission observation. Asking happens exclusively from an explicit settings action. */
import { useSyncExternalStore } from 'react';
import { log } from '~/lib/log';

const nlog = log.child({ component: 'notification-permission' });
export type NotifyPermission = NotificationPermission | 'unsupported';
const supported = () => typeof window !== 'undefined' && 'Notification' in window;
const snapshot = (): NotifyPermission => supported() ? Notification.permission : 'unsupported';
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };
let stopWatching: (() => void) | null = null;
function startWatching() {
  if (stopWatching || !supported()) return;
  let alive = true;
  let status: PermissionStatus | null = null;
  const visible = () => changed();
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('focus', visible);
  void navigator.permissions?.query({ name: 'notifications' }).then((permission) => {
    if (!alive) return;
    status = permission;
    status.addEventListener('change', changed);
  }, (error: unknown) => nlog.debug('notification permission observer unavailable', { err: error }));
  stopWatching = () => {
    alive = false;
    status?.removeEventListener('change', changed);
    document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible);
    stopWatching = null;
  };
}
const subscribe = (listener: () => void) => {
  listeners.add(listener); startWatching();
  return () => { listeners.delete(listener); if (!listeners.size) stopWatching?.(); };
};
export const useNotifyPermission = (): NotifyPermission => useSyncExternalStore(subscribe, snapshot, () => 'default');
export async function askToNotify(): Promise<NotifyPermission> {
  const before = snapshot();
  if (before !== 'default') return before;
  try { await Notification.requestPermission(); }
  catch (error) { nlog.warn('notification permission request unavailable', { err: error }); }
  changed();
  return snapshot();
}
