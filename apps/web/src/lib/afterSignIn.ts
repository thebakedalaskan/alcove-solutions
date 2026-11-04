/*
 * Back to a call's join page after signing in with Google from it. Google's way back lands on /ready or /home, so the
 * page to return to waits in this tab's sessionStorage: not in the sign-in URL, because a call's code is its link's
 * secret and the API's request logs keep URLs. It lasts ten minutes, like the sign-in attempt itself, and is used once.
 */
import { CallReturnStoredSchema } from '@alcove/api';
import { log } from './log';

const alog = log.child({ component: 'after-sign-in' });
const KEY = 'alcove.after-sign-in';
const MINUTES = 10;

/** Signing in from this call's join page: come back to it afterwards. */
export function returnToCall(code: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ code, until: Date.now() + MINUTES * 60_000 }));
  } catch (e) {
    // Private browsing and the like: after signing in this tab lands on Home, and the link still works.
    alog.debug('join page not kept for after sign-in', { err: e });
  }
}

/** No Google sign-in is coming back to a join page (it was left, or the person signed in another way). */
export function clearReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch (e) {
    alog.debug('join page to go back to not cleared', { err: e });
  }
}

/** The call to go back to, once, if signing in started on its join page in the last ten minutes; an older one is dropped. */
export function takeReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(KEY);
    const w = CallReturnStoredSchema.safeParse(JSON.parse(raw));
    return w.success && w.data.until > Date.now() ? w.data.code : null;
  } catch (e) {
    alog.debug('join page to go back to not readable', { err: e });
    return null;
  }
}
