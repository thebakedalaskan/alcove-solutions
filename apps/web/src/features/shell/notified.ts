/*
 * Which browser notifications have shown, so each shows once (notify.ts shows them): for a day, in localStorage for the
 * account (`alcove.notified.<ownerId>`: each event's kind and IDs, and when it showed), so no tab, reload or new tab
 * shows it again. It goes when someone signs out or deletes their account here (lib/queries.ts, which notify.ts needs,
 * so this can't be part of it), and so do the notifications still showing.
 */
import { NotifiedStoredSchema, NotificationReceiptSchema, type NotificationReceipt } from '@alcove/api';
import { log } from '~/lib/log';

const nlog = log.child({ component: 'notify' });

const PREFIX = 'alcove.notified.';
/** What's been shown is remembered this long. */
const KEPT_MS = 24 * 60 * 60_000;
const KEEP = 500;

const storeOf = (owner: string) => `${PREFIX}${owner}`;
/** Shown this session, by account and key: what storage can't keep (a private window) is still kept here. */
const memory = new Map<string, number>();
function shownFor(owner: string, now: number): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const raw = localStorage.getItem(storeOf(owner));
    const r = raw === null ? null : NotifiedStoredSchema.safeParse(JSON.parse(raw));
    if (r?.success) for (const e of r.data) if (now - e.at < KEPT_MS) out.set(e.key, e.at);
  } catch (e) {
    nlog.debug('shown notifications not read', { err: e });
  }
  return out;
}

export const wasShown = (owner: string, key: string) => memory.has(`${owner} ${key}`) || shownFor(owner, Date.now()).has(key);

export function remember(owner: string, key: string) {
  const now = Date.now();
  for (const [k, at] of memory) if (now - at >= KEPT_MS) memory.delete(k);
  memory.set(`${owner} ${key}`, now);
  while (memory.size > KEEP) { const first = memory.keys().next().value; if (!first) break; memory.delete(first); }
  const all = shownFor(owner, now);
  all.set(key, now);
  const kept = [...all].map(([k, at]) => ({ key: k, at })).slice(-KEEP);
  try { localStorage.setItem(storeOf(owner), JSON.stringify(kept)); } catch (e) { nlog.debug('shown notification not kept', { err: e }); }
}

/**
 * Signed out, or the account deleted, on this device: nothing of its notifications stays. What's been shown is
 * forgotten, for every account here, and the ones still showing close, so no title stays in the notification centre.
 */
export async function forgetNotified(): Promise<void> {
  generation++;
  dispatchEvent(new Event('alcove-notifications-clear'));
  memory.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch (e) {
    nlog.warn('shown notifications not forgotten', { err: e });
  }
  try {
    const db = await receiptDb();
    await new Promise<void>((resolve, reject) => { const transaction = db.transaction('receipts', 'readwrite'); transaction.objectStore('receipts').clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
  } catch (e) { nlog.warn('notification receipts not cleared', { err: e }); }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const n of (await reg?.getNotifications()) ?? []) n.close();
  } catch (e) {
    nlog.warn('notifications still showing not closed', { err: e });
  }
}


const DB = 'alcove-notifications';
const MAX_RECEIPTS = 4096;
let opened: Promise<IDBDatabase> | null = null;
let generation = 0;
function receiptDb(): Promise<IDBDatabase> {
  if (opened) return opened;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('receipts', { keyPath: 'id' });
    let abandoned = false;
    const timeout = setTimeout(() => { abandoned = true; reject(new DOMException('Notification receipts did not respond.', 'TimeoutError')); }, 5000);
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onblocked = () => { clearTimeout(timeout); abandoned = true; reject(new DOMException('Notification receipts are unavailable.', 'InvalidStateError')); };
    request.onsuccess = () => { clearTimeout(timeout); const db = request.result; if (abandoned) { db.close(); return; } db.onversionchange = () => { db.close(); opened = null; }; resolve(db); };
  });
  opened = attempt;
  void attempt.catch(() => { if (opened === attempt) opened = null; });
  return attempt;
}
export interface AlertReceipt { readonly key: string; readonly until: number }
export interface ReceiptClaim { readonly id: string; readonly key: string; readonly token: string }
/** A single read/write transaction claims all fresh keys, even without Web Locks and across simultaneous tabs. */
export async function claimAlerts(owner: string, alerts: readonly AlertReceipt[]): Promise<ReceiptClaim[]> {
  const atGeneration = generation;
  const db = await receiptDb();
  if (atGeneration !== generation) return [];
  return new Promise<ReceiptClaim[]>((resolve, reject) => {
    const transaction = db.transaction('receipts', 'readwrite');
    const store = transaction.objectStore('receipts');
    const claims: ReceiptClaim[] = [];
    const now = Date.now();
    const request = store.getAll(undefined, MAX_RECEIPTS + 1);
    request.onsuccess = () => {
      const raw: unknown = request.result;
      const parsed = NotificationReceiptSchema.array().max(MAX_RECEIPTS + 1).safeParse(raw);
      if (!parsed.success) { transaction.abort(); return; }
      const rows = new Map<string, NotificationReceipt>();
      for (const receipt of parsed.data) {
        if (receipt.until <= now) store.delete(receipt.id);
        else rows.set(receipt.id, receipt);
      }
      for (const alert of alerts) {
        if (alert.until <= now || wasShown(owner, alert.key)) continue;
        const id = `${owner} ${alert.key}`;
        const existing = rows.get(id);
        if (existing && (existing.state === 'shown' || existing.lease > now)) continue;
        if (!existing && rows.size >= MAX_RECEIPTS) continue;
        const receipt: NotificationReceipt = { id, owner, key: alert.key, token: crypto.randomUUID(), state: 'pending', at: now, until: alert.until, lease: now + 30_000 };
        store.put(receipt); rows.set(id, receipt); claims.push({ id, key: alert.key, token: receipt.token });
      }
    };
    transaction.oncomplete = () => resolve(atGeneration === generation ? claims : []);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Notification receipts are unavailable.', 'InvalidStateError'));
  });
}
/** A late or canceled delivery can only complete/release its own original claims. */
export async function finishAlerts(owner: string, claims: readonly ReceiptClaim[], shown: boolean): Promise<void> {
  if (!claims.length) return;
  const atGeneration = generation;
  const db = await receiptDb();
  if (atGeneration !== generation) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('receipts', 'readwrite');
    const store = transaction.objectStore('receipts');
    for (const claim of claims) {
      const request = store.get(claim.id);
      request.onsuccess = () => {
        const value: unknown = request.result;
        const parsed = NotificationReceiptSchema.safeParse(value);
        if (!parsed.success || parsed.data.token !== claim.token) return;
        if (shown) store.put({ ...parsed.data, state: 'shown' });
        else store.delete(claim.id);
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  if (shown && atGeneration === generation) for (const claim of claims) remember(owner, claim.key);
}
