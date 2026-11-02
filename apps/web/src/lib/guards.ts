import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { q } from './queries';

/** An unlocked owner, or off to the welcome screen to create an account or unlock. */
export async function requireAccount(qc: QueryClient) {
  const s = await qc.ensureQueryData(q.session());
  if (!s) throw redirect({ to: '/welcome' });
  return s;
}
