/*
 * Whether the hour-left toast (user-flows 16.12) has been said this period, per account, in this browser
 * (`alcove.hour-left.<ownerId>`, only the period's end). Signing out or deleting the account here forgets it.
 */
import { log } from '~/lib/log';

const hlog = log.child({ component: 'plan-doors' });

/** Said once a period, per account, in this browser; once in this tab when the browser keeps nothing. */
const toldHere = new Set<string>();
const toldKey = (ownerId: string) => `alcove.hour-left.${ownerId}`;

/** Whether this period's hour-left toast is still to be said, and keeps that it now has been. */
export function tellOnce(ownerId: string, periodTo: string): boolean {
  try {
    if (localStorage.getItem(toldKey(ownerId)) === periodTo) return false;
    localStorage.setItem(toldKey(ownerId), periodTo);
    return true;
  } catch (e) {
    hlog.debug('the hour-left toast isn’t kept in this browser', { err: e });
    const here = `${ownerId}:${periodTo}`;
    if (toldHere.has(here)) return false;
    toldHere.add(here);
    return true;
  }
}

/** Forgets that the toast was said, for an account signing out or deleted on this browser. */
export function forgetHourLeft(ownerId: string): void {
  try { localStorage.removeItem(toldKey(ownerId)); } catch (e) { hlog.debug('the hour-left mark isn’t removed', { err: e }); }
}
