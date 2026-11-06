import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useToast } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import { Landing } from '~/features/welcome/Landing';
import { useAuth } from '~/features/welcome/WaysIn';
import { takeAgentReturn, takeReturn } from '~/lib/afterSignIn';
import { signedInHere } from '~/lib/device';
import { sessionOrOffline } from '~/lib/guards';

/** Why a sign-in with Google came back without signing in, as the API reports it. */
const REFUSED = {
  cancelled: 'Google sign-in was cancelled.',
  expired: 'That sign-in took too long or started in another tab. Try again.',
  unverified: 'Google hasn’t verified that account’s email address, so Alcove can’t use it.',
  unavailable: 'Google sign-in isn’t set up on this server.',
  busy: 'Too many sign-in attempts. Wait a minute and try again.',
  failed: 'Couldn’t sign in with Google. Try again.'
} as const;
type Refused = keyof typeof REFUSED;
const isRefused = (v: unknown): v is Refused => typeof v === 'string' && Object.keys(REFUSED).includes(v);

export const Route = createFileRoute('/welcome')({
  validateSearch: (s: Record<string, unknown>): { signin?: Refused | undefined } => ({ signin: isRefused(s['signin']) ? s['signin'] : undefined }),
  beforeLoad: async ({ context }) => {
    const s = await sessionOrOffline(context.queryClient);
    // Offline, someone signed in here can still record; anyone else sees this page, and signs in once they're back.
    if (s === 'offline') { if (signedInHere()) throw redirect({ to: '/record', replace: true }); return; }
    if (s) throw redirect({ to: '/home', replace: true });
  },
  component: Welcome
});

/* Signed out: the welcome page, with the ways in at the top and the bottom. */
function Welcome() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { signin } = Route.useSearch();

  /* Back from Google without a session: say why once, then tidy the address, or go back to the call it started from. */
  const handled = useRef<Refused | null>(null);
  useEffect(() => {
    // Once per refusal, however often the effect runs: the call to go back to can be taken only once.
    if (!signin || handled.current === signin) return;
    handled.current = signin;
    toast(REFUSED[signin], { icon: 'x', ms: 5200 });
    const agent = takeAgentReturn();
    if (agent) { void navigate({ to: '/connect', search: { request: agent }, replace: true }); return; }
    const call = takeReturn();
    void navigate(call ? { to: '/join/$code', params: { code: call }, replace: true } : { to: '/welcome', search: {}, replace: true });
  }, [signin, toast, navigate]);

  return <Landing auth={auth} />;
}
