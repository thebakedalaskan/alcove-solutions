/*
 * Where this tab goes once it's signed in, when signing in started on a page with somewhere to come back to: a call's join
 * page, an agent's request at Agents, a link to someone's notes, an invite to a team, or Plans with checkout open (Get Pro on
 * the welcome page). Google needs the current tab when its popup is blocked or can't report back, and its way back lands on
 * /ready or /home, so where to go waits in this tab's sessionStorage (AfterSignInSchema): not in the sign-in URL, because a
 * call's code and a link's or an invite's secret are secrets and the API's request logs keep URLs. It's one slot, so a
 * sign-in started somewhere else since takes its place, and nothing else is waiting to race it. It lasts ten minutes, like
 * the sign-in attempt itself, and is used once; with a popup the page it started on stays open and clears it.
 */
import { AfterSignInStoredSchema, type AfterSignIn, type AfterSignInStored } from '@alcove/api';
import { log } from './log';

const alog = log.child({ component: 'after-sign-in' });
const KEY = 'alcove.after-sign-in';
const MINUTES = 10;

/** Signing in from here: come back to `back` afterwards, in place of anything kept before. */
export function returnTo(back: AfterSignIn): void {
  try {
    const kept: AfterSignInStored = { back, until: Date.now() + MINUTES * 60_000 };
    sessionStorage.setItem(KEY, JSON.stringify(kept));
  } catch (e) {
    // Private browsing and the like: after signing in this tab lands on Home, and the page's own link still works.
    alog.debug('way back not kept for after sign-in', { to: back.to, err: e });
  }
}

/** No sign-in is coming back to what's kept (it finished in a popup, failed, or was left). */
export function clearReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch (e) {
    alog.debug('way back not cleared', { err: e });
  }
}

/** Where to go back to, without taking it, if a sign-in started in the last ten minutes kept one; an older one is dropped. */
export function keptReturn(): AfterSignIn | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const w = AfterSignInStoredSchema.safeParse(JSON.parse(raw));
    if (w.success && w.data.until > Date.now()) return w.data.back;
    sessionStorage.removeItem(KEY);
    return null;
  } catch (e) {
    alog.debug('way back not readable', { err: e });
    return null;
  }
}

const goesTo = <T extends AfterSignIn['to']>(back: AfterSignIn, to: T): back is Extract<AfterSignIn, { to: T }> => back.to === to;

/** What's kept, taken once, if it goes `to` there: a link's page or an invite's takes its own secret, which never goes in a URL. */
export function takeReturnTo<T extends AfterSignIn['to']>(to: T): Extract<AfterSignIn, { to: T }> | null {
  const back = keptReturn();
  if (!back || !goesTo(back, to)) return null;
  clearReturn();
  return back;
}
