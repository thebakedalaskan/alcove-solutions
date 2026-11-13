/** Owns OS handles, async delivery, atomic receipts, burst grouping and reconciliation for every source. */
import { BrowserNotificationDataSchema, type BrowserNotificationData, type CallNotificationCategory, type NotificationOpen } from '@alcove/api';
import { log } from '~/lib/log';
import { notificationsPauseHolds } from '~/lib/notification-pause';
import { accountGeneration, onSignedOutElsewhere, signedOut } from '~/lib/signedOut';
import { claimAlerts, finishAlerts, type ReceiptClaim } from './notified';
import { notificationOnScreen } from './notification-views';

const nlog = log.child({ component: 'notification-delivery' });
export type BrowserAlertKind = CallNotificationCategory | 'call' | 'ready' | 'shared' | 'due' | 'tagged' | 'ringing' | 'plan';
export interface BrowserAlert {
  readonly key: string; readonly kind: BrowserAlertKind; readonly context: string; readonly open: NotificationOpen;
  readonly raisedAt: number; readonly expiresAt: number;
}
export interface NotificationSource {
  readonly token: object; readonly scope: string; readonly owner: string; readonly ownerId: string | null;
  readonly alerts: readonly BrowserAlert[];
  allowed(kind?: BrowserAlertKind, key?: string): boolean;
  /**
   * When the account's pause on notifications ends, in ms (as lib/notification-pause.ts reads it), read as it decides; null
   * for none, and for a guest.
   */
  notificationsPauseEnd(): number | null;
  open(data: BrowserNotificationData): void;
  failed(): void;
}
interface Shown {
  readonly data: BrowserNotificationData; readonly signature: string; readonly token: object; readonly instance: object;
  readonly close: () => Promise<void>;
}
const sources = new Map<string, NotificationSource>();
const shown = new Map<string, Shown>();
const revoked = new WeakSet<object>();
const adopted = new WeakSet<object>();
const warned = new WeakSet<object>();
const failedAt = new WeakMap<object, number>();
const summaries = new WeakMap<object, string>();
const origins = new WeakMap<object, { owner: string; generation: string | null }>();
const deliveryTraces = new WeakMap<object, string>();
let running: Promise<void> | null = null;
let again = false;
let expiration: ReturnType<typeof setTimeout> | null = null;
let cleanup: (() => void) | null = null;
let epoch = 0;

function browserWait<T>(task: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException('Browser notifications did not respond.', 'TimeoutError')), 5000);
    void task.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}
const permission = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';
/**
 * Paused notifications (lib/notification-pause.ts): while the account's pause holds, nothing reaches you from the browser but
 * someone asking to join a call you host (only a host is alerted for that). Asked as each alert would show, so they start
 * again by themselves when the time passes, and one held through the pause shows then if it's still timely.
 */
function paused(source: NotificationSource, kind?: BrowserAlertKind, now = Date.now()): boolean {
  return kind !== undefined && kind !== 'admissions' && notificationsPauseHolds(source.notificationsPauseEnd(), now);
}
function allowed(source: NotificationSource, kind?: BrowserAlertKind, key?: string): boolean {
  const origin = origins.get(source.token);
  return !revoked.has(source.token) && permission() && (source.ownerId === null || (origin?.owner === source.ownerId && origin.generation !== null && !signedOut(source.ownerId) && accountGeneration(source.ownerId) === origin.generation))
    && !paused(source, kind) && source.allowed(kind, key);
}
function current(scope: string, token: object): NotificationSource | null {
  const source = sources.get(scope);
  return source?.token === token && allowed(source) ? source : null;
}
const alive = (alert: BrowserAlert, now = Date.now()) => alert.raisedAt <= now + 1000 && alert.expiresAt > now;
const tagOf = (source: NotificationSource, kind: BrowserAlertKind) => `alcove:${source.owner}:${source.scope}:${kind}`;
/** Every string is owned here. Sources cannot accidentally send a name, call title or message preview. */
function words(kind: BrowserAlertKind, many: boolean): { title: string; body: string } {
  switch (kind) {
    case 'privateMessages': return { title: 'Private message in Alcove', body: many ? 'You have unread private messages. Open Alcove to read them.' : 'Open Alcove to read your private message.' };
    case 'replies': return { title: 'Reply in Alcove', body: 'Open Alcove to read the conversation.' };
    case 'chatMentions': return { title: 'Chat mention in Alcove', body: 'Open Alcove to read the message.' };
    case 'hands': return { title: 'Raised hand in Alcove', body: 'Open the call to see who needs your attention.' };
    case 'questions': return { title: 'Question in Alcove', body: 'Open the call to see the question.' };
    case 'admissions': return { title: 'Request to join Alcove', body: 'Open the call to review pending requests.' };
    case 'timers': return { title: 'Timer warning in Alcove', body: 'Open the call to check the current timer.' };
    case 'notesRequested': return { title: 'Notes requested in Alcove', body: 'Open the call to review the request.' };
    case 'call': return { title: 'Alcove call reminder', body: 'Your call starts soon. Open Alcove to join.' };
    case 'ready': return { title: 'Alcove notes are ready', body: 'Open Alcove to read your notes.' };
    case 'shared': return { title: 'Notes shared in Alcove', body: 'Open Alcove to see what was shared with you.' };
    case 'due': return { title: 'Follow-up due in Alcove', body: 'Open Alcove to review your outstanding follow-ups.' };
    case 'tagged': return { title: 'Mention in Alcove', body: 'Open Alcove to read the document.' };
    case 'ringing': return { title: 'Someone is calling you', body: 'Open Alcove to answer.' };
    case 'plan': return { title: 'Your Alcove plan', body: 'Open Alcove to see what changed.' };
  }
}
async function close(tag: string): Promise<void> {
  const item = shown.get(tag);
  if (!item) return;
  shown.delete(tag);
  try { await item.close(); } catch (error) { nlog.debug('notification close unavailable', { err: error }); }
}
async function native(source: NotificationSource, alerts: readonly BrowserAlert[], tag: string, valid: () => boolean): Promise<Shown | null> {
  const primary = alerts[0];
  if (!primary || !valid()) return null;
  const data = BrowserNotificationDataSchema.parse({ v: 1, instance: crypto.randomUUID(), ownerId: source.ownerId, source: source.scope, key: primary.key, open: primary.open });
  const copy = words(primary.kind, alerts.length > 1);
  const signature = JSON.stringify([source.ownerId, source.scope, primary.key, primary.open, alerts.map((alert) => alert.key)]);
  const instance = {};
  const registration = await browserWait(Promise.resolve(navigator.serviceWorker?.getRegistration()));
  if (!valid()) return null;
  if (registration?.active) {
    const closeWorker = async () => {
      for (const item of await browserWait(registration.getNotifications({ tag }))) {
        const held = BrowserNotificationDataSchema.safeParse(item.data);
        if (held.success && held.data.instance === data.instance && held.data.source === source.scope && held.data.ownerId === source.ownerId) item.close();
      }
    };
    const showing = registration.showNotification(copy.title, { body: copy.body, tag, data, silent: true });
    try { await browserWait(showing); }
    catch (error) {
      // A browser may finish after the deadline; that delivery can close only its exact instance.
      void showing.then(closeWorker).catch((late: unknown) => nlog.debug('late notification cleanup unavailable', { err: late }));
      throw error;
    }
    if (!valid()) { await closeWorker(); return null; }
    return { data, signature, token: source.token, instance, close: closeWorker };
  }
  const notification = new Notification(copy.title, { body: copy.body, tag, data, silent: true });
  notification.onclick = () => {
    notification.close();
    window.focus();
    const latest = current(source.scope, source.token);
    if (latest) latest.open(data);
  };
  notification.onerror = () => {
    notification.close();
    if (shown.get(tag)?.instance === instance) shown.delete(tag);
    const latest = current(source.scope, source.token);
    if (latest && !warned.has(source.token)) { warned.add(source.token); latest.failed(); }
    nlog.warn('native notification refused after creation', { kind: primary.kind });
  };
  notification.onclose = () => { if (shown.get(tag)?.instance === instance) shown.delete(tag); };
  if (!valid()) { notification.close(); return null; }
  return { data, signature, token: source.token, instance, close: () => { notification.close(); return Promise.resolve(); } };
}
async function adopt(source: NotificationSource): Promise<void> {
  if (adopted.has(source.token)) return;
  adopted.add(source.token);
  try {
    const registration = await browserWait(Promise.resolve(navigator.serviceWorker?.getRegistration()));
    if (!registration?.active) return;
    for (const notification of await browserWait(registration.getNotifications())) {
      const data = BrowserNotificationDataSchema.safeParse(notification.data);
      // Previous-release previews are closed instead of carrying names/details into the new lifecycle.
      if (!data.success) { notification.close(); continue; }
      if (data.data.source !== source.scope || data.data.ownerId !== source.ownerId) continue;
      const latest = sources.get(source.scope);
      if (latest?.token !== source.token || revoked.has(source.token)) { notification.close(); continue; }
      if (!shown.has(notification.tag)) shown.set(notification.tag, { data: data.data, signature: '', token: source.token, instance: {}, close: () => { notification.close(); return Promise.resolve(); } });
    }
  } catch (error) { adopted.delete(source.token); nlog.debug('existing notifications could not be reconciled', { err: error }); }
}
async function reconcile(): Promise<void> {
  const atEpoch = epoch;
  const wanted = new Set<string>();
  let next = Infinity;
  for (const source of sources.values()) {
    await adopt(source);
    if (!allowed(source)) continue;
    const groups = new Map<BrowserAlertKind, BrowserAlert[]>();
    let held = 0;
    for (const alert of source.alerts) {
      if (!alive(alert)) continue;
      // Held by a pause: looked at again as the pause ends, and shown then if it's still timely.
      const until = paused(source, alert.kind) ? source.notificationsPauseEnd() : null;
      if (until !== null) { held++; if (until < alert.expiresAt) next = Math.min(next, until); continue; }
      if (!allowed(source, alert.kind, alert.key)) continue;
      next = Math.min(next, alert.expiresAt);
      const entries = groups.get(alert.kind) ?? [];
      entries.push(alert); groups.set(alert.kind, entries);
    }
    const diagnostic = JSON.stringify([groups.size, source.alerts.length, source.alerts.filter((alert) => alive(alert)).length, held]);
    if (deliveryTraces.get(source.token) !== diagnostic) { deliveryTraces.set(source.token, diagnostic); nlog.debug('notification groups prepared', { groups: groups.size, count: source.alerts.length, timely: source.alerts.filter((alert) => alive(alert)).length, paused: held }); }
    for (const [kind, entries] of groups) {
      const alerts = entries.sort((a, b) => a.raisedAt - b.raisedAt || a.key.localeCompare(b.key));
      const tag = tagOf(source, kind);
      const primary = alerts[0];
      if (!primary) continue;
      const valid = () => {
        const latest = current(source.scope, source.token);
        return atEpoch === epoch && latest !== null && allowed(latest, primary.kind, primary.key) && alive(primary) && latest.alerts.some((item) => item.key === primary.key)
          && !alerts.some((alert) => notificationOnScreen(alert.context));
      };
      const observedInApp = () => alerts.some((alert) => notificationOnScreen(alert.context));
      let inFront = observedInApp();
      if (!inFront) wanted.add(tag);
      if (Date.now() - (failedAt.get(source.token) ?? -Infinity) < 30_000) continue;
      let claims: ReceiptClaim[] = [];
      try {
        claims = await claimAlerts(source.owner, alerts.map((alert) => ({ key: alert.key, until: alert.expiresAt })));
        if (atEpoch !== epoch || !current(source.scope, source.token)) { await finishAlerts(source.owner, claims, false); continue; }
        inFront = observedInApp();
        if (inFront || !valid()) {
          // Observed in the relevant call/document: it must not turn into a backlog when that view is hidden.
          await finishAlerts(source.owner, claims, inFront);
          await close(tag);
          continue;
        }
        const signature = JSON.stringify([source.ownerId, source.scope, primary.key, primary.open, alerts.map((alert) => alert.key)]);
        const existing = shown.get(tag);
        if (!claims.length && !existing) continue;
        if (!claims.length && existing?.signature === signature) continue;
        const item = await native(source, alerts, tag, valid);
        if (item) {
          shown.set(tag, item);
          warned.delete(source.token); failedAt.delete(source.token);
          await finishAlerts(source.owner, claims, true);
          nlog.debug('notification delivered', { kind, count: alerts.length });
        } else await finishAlerts(source.owner, claims, observedInApp());
      } catch (error) {
        try { await finishAlerts(source.owner, claims, observedInApp()); } catch { /* The original receipt error is reported once. */ }
        nlog.warn('browser notification delivery unavailable', { kind, err: error });
        const latest = current(source.scope, source.token);
        failedAt.set(source.token, Date.now());
        if (latest && !warned.has(source.token)) { warned.add(source.token); latest.failed(); }
      }
    }
  }
  for (const tag of shown.keys()) if (!wanted.has(tag)) await close(tag);
  if (expiration) clearTimeout(expiration);
  expiration = Number.isFinite(next) ? setTimeout(refreshNotifications, Math.max(1, Math.min(30_000, next - Date.now()))) : null;
}
/** Updates coalesce while browser/receipt work is pending; late results always recheck the live source. */
export function refreshNotifications(): void {
  again = true;
  if (running) return;
  running = (async () => { do { again = false; await reconcile(); } while (again); })()
    .catch((error: unknown) => nlog.warn('notification reconciliation unavailable', { err: error }))
    .finally(() => { running = null; if (again) refreshNotifications(); });
}
function install(): void {
  if (cleanup) return;
  const clear = () => {
    epoch++;
    for (const source of sources.values()) revoked.add(source.token);
    sources.clear();
    for (const tag of shown.keys()) void close(tag);
    refreshNotifications();
  };
  const signedOutElsewhere = onSignedOutElsewhere((owner) => {
    epoch++;
    for (const [key, source] of sources) if (source.ownerId === owner) { revoked.add(source.token); sources.delete(key); }
    for (const [tag, item] of shown) if (item.data.ownerId === owner) void close(tag);
    refreshNotifications();
  });
  const storage = (event: StorageEvent) => {
    if (!event.key?.startsWith('alcove.account-state.')) return;
    for (const [tag, item] of shown) { const source = sources.get(item.data.source); if (!source || !allowed(source)) void close(tag); }
    refreshNotifications();
  };
  addEventListener('storage', storage);
  addEventListener('focus', refreshNotifications); addEventListener('blur', refreshNotifications);
  addEventListener('alcove-notifications-clear', clear); addEventListener('alcove-notification-preferences', refreshNotifications); addEventListener('alcove-notification-views', refreshNotifications); document.addEventListener('visibilitychange', refreshNotifications);
  cleanup = () => {
    signedOutElsewhere(); removeEventListener('storage', storage); removeEventListener('focus', refreshNotifications); removeEventListener('blur', refreshNotifications);
    removeEventListener('alcove-notifications-clear', clear); removeEventListener('alcove-notification-preferences', refreshNotifications); removeEventListener('alcove-notification-views', refreshNotifications); document.removeEventListener('visibilitychange', refreshNotifications);
    if (expiration) clearTimeout(expiration); expiration = null; cleanup = null;
  };
}
export function updateNotificationSource(source: NotificationSource): void {
  install();
  if (revoked.has(source.token)) return;
  if (source.ownerId !== null && !origins.has(source.token)) origins.set(source.token, { owner: source.ownerId, generation: accountGeneration(source.ownerId) });
  sources.set(source.scope, source);
  if (source.ownerId !== null && origins.get(source.token)?.generation === null && permission() && source.allowed() && !warned.has(source.token)) { warned.add(source.token); source.failed(); }
  const state = JSON.stringify([allowed(source), source.alerts.length]);
  if (summaries.get(source.token) !== state) { summaries.set(source.token, state); nlog.debug('notification source updated', { allowed: allowed(source), count: source.alerts.length }); }
  if (!allowed(source)) for (const [tag, item] of shown) if (item.data.source === source.scope) void close(tag);
  refreshNotifications();
}
export function removeNotificationSource(scope: string, token: object): void {
  if (sources.get(scope)?.token !== token) return;
  sources.delete(scope); revoked.add(token); epoch++;
  for (const [tag, item] of shown) if (item.data.source === scope) void close(tag);
  refreshNotifications();
  if (!sources.size) cleanup?.();
}

/** Global disable/revocation closes surviving worker alerts too, including ones from a previous tab. */
export async function closeOwnerNotifications(ownerId: string | null, stillDisabled: () => boolean): Promise<void> {
  if (!stillDisabled()) return;
  for (const [tag, item] of shown) if (stillDisabled() && item.data.ownerId === ownerId) await close(tag);
  try {
    const registration = await browserWait(Promise.resolve(navigator.serviceWorker?.getRegistration()));
    const items = registration ? await browserWait(registration.getNotifications()) : [];
    if (!stillDisabled()) return;
    for (const item of items) {
      if (!stillDisabled()) return;
      const data = BrowserNotificationDataSchema.safeParse(item.data);
      if (!data.success || data.data.ownerId === ownerId) item.close();
    }
  } catch (error) { nlog.debug('disabled notifications could not be closed', { err: error }); }
}
