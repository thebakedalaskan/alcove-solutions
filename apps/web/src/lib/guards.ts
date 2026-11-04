import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { takeReturn } from './afterSignIn';
import { q } from './queries';

/**
 * The signed-in session, or off to the welcome screen to sign in. Someone who signed in from a call's join page goes
 * back to it, wherever Google's way back landed them.
 */
export async function requireAccount(qc: QueryClient) {
  const s = await qc.ensureQueryData(q.session());
  if (!s) throw redirect({ to: '/welcome' });
  const back = takeReturn();
  if (back) throw redirect({ to: '/join/$code', params: { code: back }, replace: true });
  return s;
}
