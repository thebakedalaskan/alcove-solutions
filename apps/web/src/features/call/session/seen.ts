/*
 * Notices this tab has shown for a call ("Notes are on…"), so coming back after a reload doesn't say them again, and whether
 * it closed "Just you so far". sessionStorage: this tab only, gone when it closes; a new device shows the latest once. Only
 * random IDs.
 */
import { CallNoticesSeenSchema } from '@alcove/api';
import { log } from '~/lib/log';

const slog = log.child({ component: 'call-notices' });
const key = (callId: string) => `alcove.call-seen.${callId}`;

export function seenNotices(callId: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key(callId)) ?? '[]');
    const r = CallNoticesSeenSchema.safeParse(raw);
    return new Set(r.success ? r.data : []);
  } catch (e) {
    slog.debug('seen notices not readable', { err: e });
    return new Set();
  }
}

export function keepSeen(callId: string, seen: Set<string>): void {
  try { sessionStorage.setItem(key(callId), JSON.stringify([...seen].slice(-50))); } catch (e) { slog.debug('seen notices not kept', { err: e }); }
}

/** "Just you so far", closed in this tab: it stays closed for the rest of this call, through a reload. Only the call's random ID. */
const aloneKey = (callId: string) => `alcove.call-alone.${callId}`;

export function aloneClosed(callId: string): boolean {
  try { return sessionStorage.getItem(aloneKey(callId)) === '1'; } catch (e) { slog.debug('closed alone card not readable', { err: e }); return false; }
}

export function closeAlone(callId: string): void {
  try { sessionStorage.setItem(aloneKey(callId), '1'); } catch (e) { slog.debug('closed alone card not kept', { err: e }); }
}
