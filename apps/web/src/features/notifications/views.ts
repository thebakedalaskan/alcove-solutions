/** Opaque focused-view presence: another open tab can show the action instead of a redundant OS alert. */
import { NotificationViewSignalSchema, type NotificationViewSignal } from '@alcove/api';
import { log } from '~/lib/log';

const nlog = log.child({ component: 'notification-views' });
const PREFIX = 'alcove.notification-view.';
const EXPIRES_MS = 6500;
const publishers = new Set<() => readonly string[]>();
const views = new Map<string, { contexts: readonly string[]; at: number }>();
let tab: string | null = null;
let channel: BroadcastChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let warned = false;
let publishedAt = 0;
const focused = () => document.visibilityState === 'visible' && document.hasFocus();
const current = () => focused() ? [...new Set([...publishers].flatMap((publish) => [...publish()]))].slice(0, 10) : [];
function take(signal: NotificationViewSignal, announce = true): void {
  let changed = false;
  if (signal.type === 'view') {
    const before = views.get(signal.tab);
    if (before && signal.at < before.at) return;
    if (signal.at > Date.now() + 1000 || Date.now() - signal.at >= EXPIRES_MS) changed = views.delete(signal.tab);
    else if (!before || before.at !== signal.at || JSON.stringify(before.contexts) !== JSON.stringify(signal.contexts)) {
      views.set(signal.tab, { contexts: signal.contexts, at: signal.at }); changed = true;
    }
  } else if (signal.type === 'gone') changed = views.delete(signal.tab);
  else { publish(); return; }
  if (announce && changed) dispatchEvent(new Event('alcove-notification-views'));
}
function publish(): void {
  if (!tab) return;
  publishedAt = Math.max(Date.now(), publishedAt + 1);
  const signal: NotificationViewSignal = { type: 'view', tab, contexts: current(), at: publishedAt };
  take(signal); channel?.postMessage(signal);
  try { localStorage.setItem(`${PREFIX}${tab}`, JSON.stringify(signal)); }
  catch { if (!warned) { warned = true; nlog.debug('focused notification views are not persisted'); } }
}
const storage = (event: StorageEvent) => {
  if (!event.key?.startsWith(PREFIX)) return;
  if (event.newValue === null) { views.delete(event.key.slice(PREFIX.length)); return; }
  try { const raw: unknown = JSON.parse(event.newValue); const parsed = NotificationViewSignalSchema.safeParse(raw); if (parsed.success) take(parsed.data); }
  catch { /* An invalid presence record grants no suppression. */ }
};
/** Every publisher owns its subscription. The last one removes listeners, timer, channel and its ephemeral row. */
export function watchNotificationViews(publisher: () => readonly string[]): () => void {
  publishers.add(publisher);
  if (publishers.size === 1) {
    tab = crypto.randomUUID();
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('alcove-notification-views');
      channel.onmessage = (event: MessageEvent<unknown>) => { const parsed = NotificationViewSignalSchema.safeParse(event.data); if (parsed.success) take(parsed.data); };
      channel.postMessage({ type: 'look' } satisfies NotificationViewSignal);
    }
    addEventListener('focus', publish); addEventListener('blur', publish); addEventListener('storage', storage);
    document.addEventListener('visibilitychange', publish);
    timer = setInterval(publish, 2000);
  }
  publish();
  return () => {
    publishers.delete(publisher);
    if (publishers.size) { publish(); return; }
    if (tab) {
      channel?.postMessage({ type: 'gone', tab } satisfies NotificationViewSignal);
      try { localStorage.removeItem(`${PREFIX}${tab}`); } catch { /* This ephemeral record expires. */ }
      views.delete(tab);
    }
    if (timer) clearInterval(timer);
    timer = null; channel?.close(); channel = null; tab = null; publishedAt = 0; views.clear();
    removeEventListener('focus', publish); removeEventListener('blur', publish); removeEventListener('storage', storage);
    document.removeEventListener('visibilitychange', publish);
  };
}
export function refreshNotificationViews(): void { publish(); }
/** Presence expires quickly after a crash; only focused views suppress a notification. */
export function notificationOnScreen(context: string): boolean {
  if (current().includes(context)) return true;
  const now = Date.now();
  try {
    const expired: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const parsed = NotificationViewSignalSchema.safeParse(JSON.parse(raw));
      if (parsed.success && parsed.data.type === 'view') {
        if (parsed.data.at > now + 1000 || now - parsed.data.at >= EXPIRES_MS) expired.push(key);
        // A lookup never schedules another delivery pass. Only an actual presence event does.
        take(parsed.data, false);
      } else expired.push(key);
    }
    for (const key of expired) localStorage.removeItem(key);
  } catch { /* Broadcast presence still works when storage is unavailable. */ }
  for (const [id, view] of views) {
    if (view.at > now + EXPIRES_MS || now - view.at >= EXPIRES_MS) { views.delete(id); continue; }
    if (view.contexts.includes(context)) return true;
  }
  return false;
}
