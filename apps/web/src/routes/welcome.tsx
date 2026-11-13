import { createFileRoute, redirect } from '@tanstack/react-router';
import { GoogleSignInSearchSchema } from '@alcove/api';
import { GoogleComplete } from '~/features/welcome/GoogleComplete';
import { WelcomePage } from '~/features/welcome/Landing';
import { signedInHere } from '~/features/account/device';
import { sessionOrOffline } from '~/features/account/guards';

export const Route = createFileRoute('/welcome')({
  validateSearch: (s: Record<string, unknown>) => GoogleSignInSearchSchema.parse(s),
  beforeLoad: async ({ context, search }) => {
    if (search.popup) return;
    const s = await sessionOrOffline(context.queryClient);
    // Offline, someone signed in here can still record; anyone else sees this page, and signs in once they're back.
    if (s === 'offline') { if (signedInHere()) throw redirect({ to: '/record', replace: true }); return; }
    if (s) throw redirect({ to: '/home', replace: true });
  },
  component: Welcome
});

/* Google's popup comes back here to finish signing in; anyone else signed out sees the welcome page (features/welcome/Landing.tsx). */
function Welcome() {
  const { popup, next, signin } = Route.useSearch();
  if (popup) return <GoogleComplete popup={popup} result={next && !signin ? { type: 'complete', next } : { type: 'refused', reason: signin ?? 'failed' }} />;
  return <WelcomePage signin={signin} />;
}
