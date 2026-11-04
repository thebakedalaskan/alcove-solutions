/*
 * Which browser notifications have shown, so each shows once (notify.ts shows them): for a day, in localStorage for the
 * account (`alcove.notified.<ownerId>`: each event's kind and IDs, and when it showed), so no tab, reload or new tab
 * shows it again. It goes when someone signs out or deletes their account here (lib/queries.ts, which notify.ts needs,
 * so this can't be part of it), and so do the notifications still showing.
 */
import { NotifiedStoredSchema } from '@alcove/api';
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
  memory.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch (e) {
    nlog.warn('shown notifications not forgotten', { err: e });
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const n of (await reg?.getNotifications()) ?? []) n.close();
  } catch (e) {
    nlog.warn('notifications still showing not closed', { err: e });
  }
}
