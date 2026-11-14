import { errorCode, type Session } from '@alcove/api';
import { hashKey, type QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { clearReturn, keptReturn } from './afterSignIn';
import { signedInHere } from './device';
import { accountQueries } from './queries';
import { accountKeys } from './queryKeys';
import { signedOut } from '~/lib/signedOut';

/**
 * Who's using the app: the signed-in session, or, when Alcove can't be asked (no connection), the account this
 * browser was signed in to last, known only by its ID. Then Record works and every other screen says it's offline.
 */
export type Account = { offline: false; session: Session } | { offline: true; ownerId: string };

/**
 * How long a screen waits for Alcove to say who's signed in, when someone is signed in on this device, before it opens
 * offline. A connection that stalls (a weak signal, Wi-Fi with nothing behind it) neither answers nor fails, and every
 * screen, Record too, would stay blank until it did. The answer still counts when it comes (`onSessionAnswer`).
 */
const SESSION_WAIT_MS = 5000;

/**
 * The session as Alcove says (null: signed out), or 'offline' when it can't be asked: no connection, the request didn't
 * get through, or, for someone signed in on this device, it hasn't answered in SESSION_WAIT_MS. A 401 is a signed-out
 * session as ever; other failures throw. An account signed out in this browser is signed out, though the app still holds
 * its session while it leaves for the welcome page (useSignOut, ./signOut.ts).
 */
export async function sessionOrOffline(qc: QueryClient): Promise<Session | null | 'offline'> {
  const known = qc.getQueryData(accountQueries.session().queryKey);
  if (known && signedOut(known.ownerId)) return null;
  if (known !== undefined) return known;
  if (!navigator.onLine) return 'offline';
  const asked = qc.ensureQueryData(accountQueries.session());
  try {
    return signedInHere() ? await answeredWithin(asked) : await asked;
  } catch (e) {
    if (errorCode(e) === 'network') return 'offline';
    throw e;
  }
}

/** The session, or 'offline' once it has taken SESSION_WAIT_MS. Asked on regardless: a late answer lands in the cache. */
async function answeredWithin(asked: Promise<Session | null>): Promise<Session | null | 'offline'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'offline'>((resolve) => { timer = setTimeout(() => resolve('offline'), SESSION_WAIT_MS); });
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls `then` whenever Alcove answers who's signed in: a screen that opened offline because the answer was late reads
 * everything again once it comes. Returns how to stop listening.
 */
export function onSessionAnswer(qc: QueryClient, then: () => void): () => void {
  const session = hashKey(accountKeys.session);
  return qc.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && e.action.type === 'success' && e.query.queryHash === session) then();
  });
}

/**
 * The signed-in account, or off to the welcome screen to sign in. Signing in that started on a page with somewhere to come
 * back to goes there, wherever Google's way back landed (./afterSignIn.ts): a call's join page, Agents for an agent's
 * request, where it asks, Plans with checkout open for Get Pro or Start a team on the welcome page, or the page of a link to
 * someone's notes or of an invite to a team, which asks before anything opens. A preload (a link hovered) never uses one up.
 * Without a connection, someone signed in on this device carries on offline.
 */
export async function requireAccount(qc: QueryClient, preload = false): Promise<{ account: Account }> {
  const s = await sessionOrOffline(qc);
  if (s === 'offline') {
    const here = signedInHere();
    if (!here) throw redirect({ to: '/welcome' });
    return { account: { offline: true, ownerId: here.ownerId } };
  }
  if (!s) throw redirect({ to: '/welcome' });
  const back = preload ? null : keptReturn();
  // A link's page and an invite's take their own secret, which never goes in a URL; the rest are used up here.
  if (back?.to === 'link') throw redirect({ to: '/link', replace: true });
  if (back?.to === 'team') throw redirect({ to: '/team/join', replace: true });
  if (back) clearReturn();
  if (back?.to === 'call') throw redirect({ to: '/join/$code', params: { code: back.code }, replace: true });
  if (back?.to === 'agent') throw redirect({ to: '/agents', search: { request: back.requestId }, replace: true });
  if (back?.to === 'plans') throw redirect({ to: '/plans', search: { checkout: back.checkout }, replace: true });
  return { account: { offline: false, session: s } };
}

/** The ID of the account in use: signed in, or signed in on this device last while offline. */
export const ownerOf = (a: Account): string => (a.offline ? a.ownerId : a.session.ownerId);
