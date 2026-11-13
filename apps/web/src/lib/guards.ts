import { errorCode, type Session } from '@alcove/api';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { clearReturn, keptReturn } from './afterSignIn';
import { signedInHere } from './device';
import { q } from './queries';
import { signedOut } from './signedOut';

/**
 * Who's using the app: the signed-in session, or, when Alcove can't be asked (no connection), the account this
 * browser was signed in to last, known only by its ID. Then Record works and every other screen says it's offline.
 */
export type Account = { offline: false; session: Session } | { offline: true; ownerId: string };

/**
 * The session as Alcove says (null: signed out), or 'offline' when it can't be asked: no connection, or the request
 * didn't get through. A 401 is a signed-out session as ever; other failures throw. An account signed out in this browser
 * is signed out, though the app still holds its session while it leaves for the welcome page (useSignOut, lib/queries.ts).
 */
export async function sessionOrOffline(qc: QueryClient): Promise<Session | null | 'offline'> {
  const known = qc.getQueryData(q.session().queryKey);
  if (known && signedOut(known.ownerId)) return null;
  if (known !== undefined) return known;
  if (!navigator.onLine) return 'offline';
  try {
    return await qc.ensureQueryData(q.session());
  } catch (e) {
    if (errorCode(e) === 'network') return 'offline';
    throw e;
  }
}

/**
 * The signed-in account, or off to the welcome screen to sign in. Signing in that started on a page with somewhere to come
 * back to goes there, wherever Google's way back landed (lib/afterSignIn.ts): a call's join page, Agents for an agent's
 * request, where it asks, Plans with checkout open for Get Pro on the welcome page, or the page of a link to someone's notes
 * or of an invite to a team, which asks before anything opens. A preload (a link hovered) never uses one up. Without a
 * connection, someone signed in on this device carries on offline.
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
