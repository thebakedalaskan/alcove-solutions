/*
 * Whether Team has been offered at an invite (user-flows 16.21), per account, in this browser (`alcove.team-offer.<ownerId>`).
 * Signing out or deleting the account here forgets it.
 */
import { log } from '~/lib/log';

const olog = log.child({ component: 'plan-doors' });

/** Offered once per account in this browser; once in this tab when the browser keeps nothing. */
const offeredHere = new Set<string>();
const offeredKey = (ownerId: string) => `alcove.team-offer.${ownerId}`;

/** Whether Team is still to be offered to this account, and keeps that it now has been. */
export function offerOnce(ownerId: string): boolean {
  try {
    if (localStorage.getItem(offeredKey(ownerId)) !== null) return false;
    localStorage.setItem(offeredKey(ownerId), '1');
    return true;
  } catch (e) {
    olog.debug('the Team offer isn’t kept in this browser', { err: e });
    if (offeredHere.has(ownerId)) return false;
    offeredHere.add(ownerId);
    return true;
  }
}

/** Forgets that Team was offered, for an account signing out or deleted on this browser. */
export function forgetTeamOffer(ownerId: string): void {
  try { localStorage.removeItem(offeredKey(ownerId)); } catch (e) { olog.debug('the Team offer’s mark isn’t removed', { err: e }); }
}
