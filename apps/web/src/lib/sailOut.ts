/*
 * Signing in from the welcome page sails out of its cove to Home (docs/design/pages.md › Welcome). A way in can leave for the
 * provider and come back, so where the cove stood waits in this tab's sessionStorage meanwhile: when the way in was pressed,
 * and where the hero's horizon, sun and words were on screen if it was in view (`SailOutStoredSchema`). Geometry only,
 * never a name or anything typed. It lasts ten minutes, like the sign-in attempt itself, and is used once: Home takes it.
 */
import { SailOutStoredSchema, type SailOutStored } from '@alcove/api';
import { log } from './log';

const slog = log.child({ component: 'sail-out' });
const KEY = 'alcove.sail-out';
const MINUTES = 10;

/** A way in was pressed on the welcome page: Home sails out of the hero's cove, as it stands on screen now (or `null`). */
export function keepSailOut(hero: SailOutStored['hero']): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), hero } satisfies SailOutStored));
  } catch (e) {
    // Private browsing and the like: Home just opens, as it does after any other sign-in.
    slog.debug('cove not kept for signing in', { err: e });
  }
}

/** No sign-in from the welcome page is on its way (it was refused, or signing in started somewhere else). */
export function forgetSailOut(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch (e) {
    slog.debug('cove to sail out of not forgotten', { err: e });
  }
}

/** The cove to sail out of, once, if a way in was pressed on the welcome page in this tab in the last ten minutes. */
export function takeSailOut(): SailOutStored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(KEY);
    const kept = SailOutStoredSchema.safeParse(JSON.parse(raw));
    if (!kept.success) { slog.debug('cove to sail out of not readable', { issues: kept.error.issues.length }); return null; }
    const age = Date.now() - kept.data.at;
    return age >= 0 && age < MINUTES * 60_000 ? kept.data : null;
  } catch (e) {
    slog.debug('cove to sail out of not readable', { err: e });
    return null;
  }
}
