/*
 * Where the plan choice shows (docs/design/pages.md › Plans; docs/product/user-flows.md 16.20), decided here and nowhere else.
 * The plan choice is Plans opened by itself once (PlanChoice.tsx): while the server says the plans haven't been shown to the
 * account yet (`Plan.choose`: true for every new account and, once, for every account from before plans), Home opens on them
 * in its place. Only Home, reached as the app opens or after the arrival of a new account: a deep link (a call, a call's page,
 * a join link, agent consent, a public page, a team invite, or any other page of the app) is never interrupted, and the plans
 * wait for the next time Home is reached. Signing in from a call's link or for an agent goes on there, never to Home, so they
 * wait then too.
 *
 * Once the plans have been on screen (here, or on Plans itself), the server is told (`useChosePlans`), and this tab remembers
 * it for the account, so they never show again in it, even when telling the server fails. Left before they were seen (their
 * prices hadn't come, or the connection had gone), they don't show again in this tab either, and the server isn't told: a
 * later visit shows them. The tab keeps that in its sessionStorage, by the account's opaque ID alone, so a reload doesn't
 * show them again and a new tab asks the server afresh. The tour of Home waits while they're up (`usePlanChoiceUp`).
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMatches } from '@tanstack/react-router';
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { overlayOpen } from '~/lib/keys';
import { log } from '~/lib/log';
import { accountQueries } from '~/features/account/queries';
import { planQueries, useChosePlans } from './queries';

const plog = log.child({ component: 'plan-choice' });

/* ---------- the decision ---------- */

/** Everything the decision depends on, named. */
export interface PlanChoiceInputs {
  /** The page being opened (its path). The plans only ever take Home's place. */
  page: string;
  /** What the server says as Home opens: whether the plans haven't been shown yet. Undefined when the plan couldn't be read. */
  choose: boolean | undefined;
  /** Whether this tab is done with them for the account: they were seen (here or on Plans), or left. */
  doneHere: boolean;
}

/**
 * Whether Home opens on the plans: it's Home, the server says they haven't been shown, and this tab hasn't already shown them
 * or been taken past them. A plan that couldn't be read leaves Home as it is.
 */
export const planChoiceShows = ({ page, choose, doneHere }: PlanChoiceInputs): boolean => page === '/home' && choose === true && !doneHere;

/* ---------- what this tab remembers ---------- */

/** For an account in this tab: the plans were seen (and the server told), or the plan choice was left before they were. */
type Here = 'seen' | 'left';
const keyOf = (owner: string) => `alcove.plan-choice.${owner}`;
/** Where a tab without storage (a private window, say) keeps it instead, until it closes. */
const unstored = new Map<string, Here>();

function hereOf(owner: string): Here | null {
  let kept: string | null = null;
  try { kept = sessionStorage.getItem(keyOf(owner)); } catch { /* without storage, it's kept in memory */ }
  return kept === 'seen' || kept === 'left' ? kept : unstored.get(owner) ?? null;
}
function keep(owner: string, here: Here): void {
  try {
    sessionStorage.setItem(keyOf(owner), here);
  } catch (e) {
    unstored.set(owner, here);
    plog.debug('the plan choice is kept in memory for this tab', { err: e });
  }
}
const doneHere = (owner: string): boolean => hereOf(owner) !== null;
/** The plans were seen: true the first time for the account in this tab, when the server is to be told. */
function markSeen(owner: string): boolean {
  if (hereOf(owner) === 'seen') return false;
  keep(owner, 'seen');
  return true;
}

/** How many plan choices are on the page: one, while it's up. */
let up = 0;
const subs = new Set<() => void>();
const changed = () => { for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Whether the plan choice is on the page now: the tour of Home waits for Home. */
export const usePlanChoiceUp = (): boolean => useSyncExternalStore(subscribe, () => up > 0, () => false);

/* ---------- Home ---------- */

/**
 * Home's loader asks this with the rest: the plan, so Home knows as it opens whether the plans come first, and when they do, the
 * offers get a moment, so their prices come up with the page (as Plans' own loader gives them), and no longer. It never
 * throws: a plan that can't be read in time leaves Home as it is, and the plans wait for the next time.
 */
export async function planChoiceReady(qc: QueryClient): Promise<void> {
  if (!navigator.onLine) return;
  const moment = () => new Promise<undefined>((r) => setTimeout(r, 1200));
  const plan = await Promise.race([qc.ensureQueryData(planQueries.plan()).catch(() => undefined), moment()]);
  if (!plan?.choose) return;
  await Promise.race([qc.ensureQueryData(planQueries.offers()).catch(() => undefined), moment()]);
}

/**
 * Whether Home opens on the plans for whoever is signed in, as things stand: what the arrival of a new account says opens
 * (`Opening Plans`), decided as Home decides, from the plan /ready reads before the account screen goes up.
 */
export function usePlansFirst(): boolean {
  const owner = useQuery(accountQueries.session()).data?.ownerId ?? null;
  const choose = useQuery(planQueries.plan()).data?.choose;
  return owner !== null && planChoiceShows({ page: '/home', choose, doneHere: doneHere(owner) });
}

/**
 * The page being shown, as the frame has it (features/shell/AppFrame.tsx): the router's location moves as soon as a navigation starts, and
 * an index page's path ends in a slash.
 */
function shownPath(matches: readonly { pathname: string }[]): string {
  const path = matches[matches.length - 1]?.pathname ?? '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Home's question: whether the plans are up in its place, and how to leave them (`leave`: on with the plan you're on, or once
 * what was bought from them is yours). Decided as Home opens, from the plan its loader read, and kept until they're left: the
 * server's answer changing meanwhile (telling it they were seen does) never swaps the page under the reader.
 */
export function usePlanChoice(): { up: boolean; leave: () => void } {
  const qc = useQueryClient();
  const page = useMatches({ select: shownPath });
  const owner = useQuery(accountQueries.session()).data?.ownerId ?? null;
  const [shown, setShown] = useState(() => owner !== null
    && planChoiceShows({ page, choose: qc.getQueryData(planQueries.plan().queryKey)?.choose, doneHere: doneHere(owner) }));
  /* While they're up, the tour waits. */
  useEffect(() => {
    if (!shown) return undefined;
    up += 1;
    changed();
    return () => { up -= 1; changed(); };
  }, [shown]);
  useEffect(() => { if (shown) plog.info('plans up in place of home'); }, [shown]);
  const leave = useCallback(() => {
    if (owner !== null) {
      const seen = hereOf(owner) === 'seen';
      plog.info('plans left for home', { seen });
      if (!seen) keep(owner, 'left');
    }
    setShown(false);
  }, [owner]);
  return { up: shown, leave };
}

/* ---------- seen ---------- */

/** How long the plans are on screen, still, before they count as seen: long enough to have been looked at. */
const SEEN_MS = 700;

/**
 * Tells the server the plans were shown once they've been on screen while it says they haven't (`watching`: the plans
 * themselves, with their prices, not their waiting cards): `el` in view, the tab showing, nothing open over it (the arrival of a
 * new account, checkout, the palette, a menu) and nothing inert round it, for a moment; pressing anything in it counts at once.
 * Told once a tab, for each account. Owns an IntersectionObserver, a timer and three listeners, all gone once they're seen or
 * it stops watching.
 */
export function usePlansSeen(el: RefObject<HTMLElement | null>, watching: boolean): void {
  const owner = useQuery(accountQueries.session()).data?.ownerId ?? null;
  const chose = useChosePlans().mutate;
  useEffect(() => {
    const node = el.current;
    if (!watching || !node || owner === null || hereOf(owner) === 'seen') return undefined;
    let inView = false;
    let since: number | null = null;
    const onScreen = () => inView && document.visibilityState === 'visible' && !overlayOpen() && node.closest('[inert]') === null;
    const stop = () => {
      view.disconnect();
      clearInterval(timer);
      node.removeEventListener('pointerdown', pressed, true);
      node.removeEventListener('keydown', pressed, true);
      document.removeEventListener('visibilitychange', look);
    };
    const seen = () => {
      stop();
      if (!markSeen(owner)) return;
      plog.info('plans seen; telling the server');
      chose();
    };
    const look = () => {
      if (!onScreen()) { since = null; return; }
      since ??= performance.now();
      if (performance.now() - since >= SEEN_MS) seen();
    };
    const pressed = () => { if (onScreen()) seen(); };
    const view = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
      look();
    });
    const timer = setInterval(look, 250);
    view.observe(node);
    node.addEventListener('pointerdown', pressed, true);
    node.addEventListener('keydown', pressed, true);
    document.addEventListener('visibilitychange', look);
    return stop;
  }, [el, watching, owner, chose]);
}
