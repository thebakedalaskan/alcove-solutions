import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { q } from './queries';

/** The signed-in session, or off to the welcome screen to sign in. */
export async function requireAccount(qc: QueryClient) {
  const s = await qc.ensureQueryData(q.session());
  if (!s) throw redirect({ to: '/welcome' });
  return s;
}
