/*
 * A new account's way in, shared between the screens it crosses: the account being created, the arch
 * opening into Home, and the tour of Home after it. Also asks for the tour again from your menu and Settings.
 * Lives in memory only: a reload lands on Home like any other visit.
 */
import { HomeTourSchema } from '@alcove/api';
import { useEffect, useSyncExternalStore } from 'react';
import { log } from '~/lib/log';

const olog = log.child({ component: 'onboarding' });

export interface ArrivalState {
  /** creating: the account screen is up. opening: the arch is opening into Home. */
  stage: 'none' | 'creating' | 'opening';
  /**
   * The account screen went up over a page already showing (the welcome page), so it fades in over it. Otherwise it came
   * with the app's first render, Google's way back having loaded the app here, and is there at once.
   */
  over: boolean;
  /** Counts arches opened, so the app shell can come in again behind one. */
  opened: number;
  /** The tour, once asked for. `auto`: after the account was created, so only if it wasn't seen yet. */
  tour: { n: number; auto: boolean } | null;
}

let state: ArrivalState = { stage: 'none', over: false, opened: 0, tour: null };
const subs = new Set<() => void>();
const set = (patch: Partial<ArrivalState>) => { state = { ...state, ...patch }; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
let asked = 0;
/** The account screen's place is on the page (`useArrivalHost`): the app has rendered. */
let hosted = false;
/** The account screen covers the page, so what's under it can change unseen. */
let covers = false;
const covering = new Set<() => void>();

export const arrival = {
  /**
   * A new account: the account screen goes up over whatever is there. Settles once it covers the page, so Home loads behind
   * it unseen rather than showing through it as it fades in: at once when the app hasn't rendered yet, as the screen is
   * then there from the first frame.
   */
  begin: (): Promise<void> => {
    if (state.stage === 'none') {
      olog.info('account arrival started');
      covers = !hosted;
      set({ stage: 'creating', over: hosted });
    }
    return covers ? Promise.resolve() : new Promise((resolve) => { covering.add(resolve); });
  },
  /** The account screen covers the page. */
  cover: () => { covers = true; for (const f of covering) f(); covering.clear(); },
  /** The arch starts opening; Home comes in behind it. */
  open: () => set({ stage: 'opening', opened: state.opened + 1 }),
  /** Home is fully in view: the tour follows. */
  done: () => set({ stage: 'none', tour: { n: ++asked, auto: true } }),
  /** Take the tour (again), from your menu or Settings. */
  askTour: () => set({ tour: { n: ++asked, auto: false } }),
  /** The tour has been opened for the last request. */
  tourTaken: () => set({ tour: null })
};

export const useArrival = () => useSyncExternalStore(subscribe, () => state, () => state);

/** The account screen's place (features/onboarding/Arrival.tsx) is on the page while this is mounted. */
export function useArrivalHost(): void {
  useEffect(() => { hosted = true; return () => { hosted = false; }; }, []);
}

/* Whether someone has seen the tour: remembered in this browser, per account. */
const tourKey = (ownerId: string) => `alcove.tour.${ownerId}`;
export function tourSeen(ownerId: string): boolean {
  try {
    const raw = localStorage.getItem(tourKey(ownerId));
    return raw !== null && HomeTourSchema.safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
}
export function rememberTour(ownerId: string) {
  try { localStorage.setItem(tourKey(ownerId), JSON.stringify({ seenAt: new Date().toISOString() })); } catch (e) { olog.debug('tour not remembered', { err: e }); }
}
/** The account is gone: so is what this browser remembered for it. */
export function forgetTour(ownerId: string) {
  try { localStorage.removeItem(tourKey(ownerId)); } catch (e) { olog.debug('tour not forgotten', { err: e }); }
}
