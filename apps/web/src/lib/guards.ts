import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { q } from './queries';

/** Signed in with a passkey, or off to onboarding. */
export async function requireAccount(qc: QueryClient) {
  const s = await qc.ensureQueryData(q.session());
  if (!s) throw redirect({ to: '/welcome' });
  if (!s.hasPasskey) throw redirect({ to: '/passkey' });
  return s;
}
