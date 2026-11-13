import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { GoogleSignInSearchSchema } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import { Landing } from '~/features/welcome/Landing';
import { GoogleComplete } from '~/features/welcome/GoogleComplete';
import { useAuth } from '~/features/welcome/WaysIn';
import { takeReturnTo } from '~/lib/afterSignIn';
import { signedInHere } from '~/lib/device';
import { sessionOrOffline } from '~/lib/guards';
import { GOOGLE_REFUSED } from '~/lib/googleSignIn';
import { forgetSailOut } from '~/lib/sailOut';

/** Why a sign-in with Google came back without signing in, as the API reports it. */
type Refused = keyof typeof GOOGLE_REFUSED;

export const Route = createFileRoute('/welcome')({
  validateSearch: (s: Record<string, unknown>) => GoogleSignInSearchSchema.parse(s),
  beforeLoad: async ({ context, search }) => {
    if (search.popup) return;
    const s = await sessionOrOffline(context.queryClient);
    // Offline, someone signed in here can still record; anyone else sees this page, and signs in once they're back.
    if (s === 'offline') { if (signedInHere()) throw redirect({ to: '/record', replace: true }); return; }
    if (s) throw redirect({ to: '/home', replace: true });
  },
  component: WelcomePage
});

function WelcomePage() {
  const { popup, next, signin } = Route.useSearch();
  if (popup) return <GoogleComplete popup={popup} result={next && !signin ? { type: 'complete', next } : { type: 'refused', reason: signin ?? 'failed' }} />;
  return <Welcome />;
}

/* Signed out: the welcome page, with the ways in at the top and the bottom. */
function Welcome() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { signin } = Route.useSearch();

  /* Back from Google without a session: say why once, then tidy the address, or go back to the call it started from. No
     sign-in is on its way to Home, so there's no cove to sail out of. */
  const handled = useRef<Refused | null>(null);
  useEffect(() => {
    // Once per refusal, however often the effect runs: the call to go back to can be taken only once.
    if (!signin || handled.current === signin) return;
    handled.current = signin;
    forgetSailOut();
    toast(GOOGLE_REFUSED[signin], { icon: 'x', ms: 5200 });
    const agent = takeReturnTo('agent');
    if (agent) { void navigate({ to: '/connect', search: { request: agent.requestId }, replace: true }); return; }
    const call = takeReturnTo('call');
    void navigate(call ? { to: '/join/$code', params: { code: call.code }, replace: true } : { to: '/welcome', search: {}, replace: true });
  }, [signin, toast, navigate]);

  return <Landing auth={auth} />;
}
