import { errorCode, type Session } from '@alcove/api';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { takeReturn } from './afterSignIn';
import { signedInHere } from './device';
import { q } from './queries';

/**
 * Who's using the app: the signed-in session, or, when Alcove can't be asked (no connection), the account this
 * browser was signed in to last, known only by its ID. Then Record works and every other screen says it's offline.
 */
export type Account = { offline: false; session: Session } | { offline: true; ownerId: string };

/**
 * The session as Alcove says (null: signed out), or 'offline' when it can't be asked: no connection, or the request
 * didn't get through. A 401 is a signed-out session as ever; other failures throw.
 */
export async function sessionOrOffline(qc: QueryClient): Promise<Session | null | 'offline'> {
  const known = qc.getQueryData(q.session().queryKey);
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
 * The signed-in account, or off to the welcome screen to sign in. Someone who signed in with Google from a call's join
 * page goes back to it, wherever Google's way back landed them; a preload (a link hovered) never uses that up.
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
  const back = preload ? null : takeReturn();
  if (back) throw redirect({ to: '/join/$code', params: { code: back }, replace: true });
  return { account: { offline: false, session: s } };
}

/** The ID of the account in use: signed in, or signed in on this device last while offline. */
export const ownerOf = (a: Account): string => (a.offline ? a.ownerId : a.session.ownerId);
