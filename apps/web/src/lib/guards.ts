import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { takeReturn } from './afterSignIn';
import { q } from './queries';

/**
 * The signed-in session, or off to the welcome screen to sign in. Someone who signed in with Google from a call's join
 * page goes back to it, wherever Google's way back landed them; a preload (a link hovered) never uses that up.
 */
export async function requireAccount(qc: QueryClient, preload = false) {
  const s = await qc.ensureQueryData(q.session());
  if (!s) throw redirect({ to: '/welcome' });
  const back = preload ? null : takeReturn();
  if (back) throw redirect({ to: '/join/$code', params: { code: back }, replace: true });
  return s;
}
