/*
 * The ways in. Google signs in in a popup and the waiting page opens the app. Demo Microsoft
 * and single sign-on are available in builds that enable them.
 */
import { errorMessage, type DemoProvider, type SignInProvider } from '@alcove/api';
import { Button, EASE, Field, ProviderButton, ProviderMark, Spinner, useToast } from '@alcove/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { clearReturn, returnToAgent, returnToCall } from '~/lib/afterSignIn';
import { isEmail } from '~/lib/people';
import { useGoogleSignIn, useSignIn } from '~/lib/queries';
import { forgetSailOut } from '~/lib/sailOut';

export type Busy = DemoProvider | 'google' | null;
export interface Auth { busy: Busy; leaving: boolean; google: () => void; cancelGoogle?: (() => void) | undefined; go: (provider: DemoProvider, email?: string) => Promise<void> }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One sign-in for the whole page, so every set of buttons shows the same busy state. `call`: signing in from that
 * call's join page, which carries on there (Google comes back to it) instead of going to Home, and doesn't sail out of
 * the welcome page's cove. `agent`: signing in to let an agent in, which carries on at Agents, where it asks.
 */
export function useAuth(o: { call?: string | undefined; agent?: string | undefined } = {}): Auth {
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const navigate = useNavigate();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);
  const [leaving, setLeaving] = useState(false);
  const reduce = useReducedMotion();

  const enter = async (next: '/ready' | '/home' | '/move') => {
    if (o.call) { clearReturn(); setBusy(null); return; }
    if (o.agent) { clearReturn(); setBusy(null); await navigate({ to: '/agents', search: { request: o.agent }, replace: true }); return; }
    setLeaving(true);
    // Home loads while the words fade, so it opens as the welcome page goes, with nothing blank between. (Not /ready: its
    // loading starts a new account's arrival.)
    await Promise.all([sleep(reduce ? 0 : 300), next === '/home' ? router.preloadRoute({ to: '/home' }).catch(() => undefined) : undefined]);
    await navigate({ to: next, replace: true });
  };

  /* Coming back with the browser's Back button restores this page as it was left: busy, and a Google sign-in started from a
     join page may have been left there, so its way back is forgotten. */
  useEffect(() => {
    const on = (e: PageTransitionEvent) => { if (!e.persisted) return; setBusy(null); if (o.call || o.agent) clearReturn(); };
    addEventListener('pageshow', on);
    return () => removeEventListener('pageshow', on);
  }, [o.call, o.agent]);

  return {
    busy, leaving,
    google: () => {
      setBusy('google');
      // Signing in to join a call or connect an agent carries on there, so it doesn't sail out of the welcome page's cove.
      if (o.call) { returnToCall(o.call); forgetSailOut(); }
      if (o.agent) { returnToAgent(o.agent); forgetSailOut(); }
      void googleSignIn.start().then(async (r) => {
        if (r === 'redirecting') return;
        if (r && 'session' in r) await enter(r.next);
        else { clearReturn(); forgetSailOut(); setBusy(null); }
      }).catch((e: unknown) => { clearReturn(); forgetSailOut(); toast(errorMessage(e), { icon: 'x' }); setBusy(null); });
    },
    cancelGoogle: googleSignIn.cancel,
    go: async (provider, email) => {
      setBusy(provider);
      if (o.call || o.agent) forgetSailOut();
      try {
        const r = await signIn.mutateAsync({ provider, email: provider === 'sso' ? email?.trim() : undefined });
        await enter(r.isNew ? '/ready' : '/home');
      } catch (e) {
        toast(errorMessage(e), { icon: 'x' });
        setBusy(null);
      }
    }
  };
}

const swap = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } } as const;
const demoAuthEnabled = import.meta.env.VITE_ALCOVE_DEMO_AUTH_ENABLED !== 'false';

/**
 * The build's sign-in providers, further limited by `only` when signing in from a call. `hero` lays them out in a row
 * on the welcome page's sky with Google filled; `stack` puts them in one column.
 */
export function WaysIn({ auth, layout, only, note }: { auth: Auth; layout: 'hero' | 'stack'; only?: SignInProvider[] | undefined; note?: ReactNode }) {
  const offers = (provider: SignInProvider) => !only || only.includes(provider);
  const reduce = useReducedMotion() ?? false;
  const [sso, setSso] = useState(false);
  const [email, setEmail] = useState('');
  /* The email field takes focus as it appears. */
  const input = useCallback((el: HTMLInputElement | null) => { el?.focus({ preventScroll: true }); }, []);
  const ok = isEmail(email);
  const locked = auth.busy !== null;

  const google = auth.busy === 'google' ? 'Waiting for Google…' : 'Continue with Google';
  const cancelGoogle = auth.busy === 'google' && auth.cancelGoogle && <Button variant="quiet" size="sm" onClick={auth.cancelGoogle}>Cancel sign-in</Button>;
  const microsoft = demoAuthEnabled && offers('microsoft') && <ProviderButton provider="microsoft" busy={auth.busy === 'microsoft'} disabled={locked} onClick={() => void auth.go('microsoft')}>{auth.busy === 'microsoft' ? 'Opening Microsoft…' : 'Continue with Microsoft'}</ProviderButton>;
  const providers = (
    <>
      {offers('google') && <ProviderButton provider="google" busy={auth.busy === 'google'} disabled={locked} onClick={auth.google}>{google}</ProviderButton>}
      {microsoft}
    </>
  );
  const ssoButton = demoAuthEnabled && offers('sso') && <Button variant="quiet" size={layout === 'hero' ? 'sm' : 'md'} icon="key" disabled={locked} onClick={() => setSso(true)}>Use single sign-on</Button>;
  /* The sun under the welcome page's buttons lifts a little when you point at Google, as Home's does under Start now. */
  const filled = offers('google') && (
    <Button variant="primary" size="lg" className="lp-go" disabled={locked} onClick={auth.google}>
      {auth.busy === 'google' ? <Spinner /> : <ProviderMark provider="google" className="lp-pm" />}{google}
    </Button>
  );
  const t = reduce ? { duration: 0 } : { duration: 0.45, ease: EASE.out };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {demoAuthEnabled && sso ? (
        <motion.form key="sso" className="lp-sso" {...swap} transition={t} onSubmit={(e) => { e.preventDefault(); if (ok && !locked) void auth.go('sso', email); }}>
          <Field ref={input} label="Work email" type="email" placeholder="you@example.com" autoComplete="off" spellCheck={false} value={email} disabled={locked}
            onChange={(e) => setEmail(e.target.value)} hint="To try single sign-on, use any address at example.com." />
          <div className="acts">
            <Button type="submit" variant="primary" iconRight="right" loading={auth.busy === 'sso'} disabled={!ok}>{auth.busy === 'sso' ? 'Signing in…' : 'Continue'}</Button>
            <Button variant="quiet" disabled={locked} onClick={() => setSso(false)}>Back</Button>
          </div>
        </motion.form>
      ) : layout === 'hero' ? (
        <motion.div key="ways" className="lp-ways-in" {...swap} transition={t}>
          <div className="lp-ways">{filled}{microsoft}</div>
          <div className="lp-meta">{cancelGoogle || ssoButton}{note && <span>{note}</span>}</div>
        </motion.div>
      ) : (
        <motion.div key="ways" className="ways" {...swap} transition={t}>
          {providers}
          {cancelGoogle}
          {ssoButton}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
