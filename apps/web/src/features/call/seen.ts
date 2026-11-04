/*
 * Notices this tab has shown for a call ("Notes are on…"), so coming back after a reload doesn't say them again.
 * sessionStorage: this tab only, gone when it closes; a new device shows the latest once. Only random notice IDs.
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
