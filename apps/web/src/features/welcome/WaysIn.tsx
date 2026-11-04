/*
 * The ways in. Google is a real sign-in: the browser goes there and comes back to the API. Microsoft
 * and single sign-on sign in on the spot; single sign-on asks for a work email first, inline.
 */
import { errorMessage, type DemoProvider } from '@alcove/api';
import { Button, EASE, Field, ProviderButton, useToast } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { returnToCall } from '~/lib/afterSignIn';
import { isEmail } from '~/lib/parse';
import { googleSignInUrl, useSignIn } from '~/lib/queries';

export type Busy = DemoProvider | 'google' | null;
export interface Auth { busy: Busy; leaving: boolean; google: () => void; go: (provider: DemoProvider, email?: string) => Promise<void> }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One sign-in for the whole page, so every set of buttons shows the same busy state. `call`: signing in from that
 * call's join page, which carries on there (Google comes back to it) instead of going to Home.
 */
export function useAuth(o: { call?: string | undefined } = {}): Auth {
  const signIn = useSignIn();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);
  const [leaving, setLeaving] = useState(false);

  /* Coming back with the browser's Back button restores this page as it was left: busy. */
  useEffect(() => {
    const on = (e: PageTransitionEvent) => { if (e.persisted) setBusy(null); };
    addEventListener('pageshow', on);
    return () => removeEventListener('pageshow', on);
  }, []);

  return {
    busy, leaving,
    google: () => { setBusy('google'); if (o.call) returnToCall(o.call); location.assign(googleSignInUrl()); },
    go: async (provider, email) => {
      setBusy(provider);
      try {
        const r = await signIn.mutateAsync({ provider, email: provider === 'sso' ? email?.trim() : undefined });
        // From a join page: it shows the account now, and joining goes on from there.
        if (o.call) { setBusy(null); return; }
        setLeaving(true);
        await sleep(300);
        await navigate({ to: r.isNew ? '/ready' : '/home', replace: true });
      } catch (e) {
        toast(errorMessage(e), { icon: 'x' });
        setBusy(null);
      }
    }
  };
}

const swap = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } } as const;

/** Google, Microsoft and single sign-on. `hero` lays them out under the headline; `stack` in one column. */
export function WaysIn({ auth, layout }: { auth: Auth; layout: 'hero' | 'stack' }) {
  const reduce = useReducedMotion() ?? false;
  const [sso, setSso] = useState(false);
  const [email, setEmail] = useState('');
  /* The email field takes focus as it appears. */
  const input = useCallback((el: HTMLInputElement | null) => { el?.focus({ preventScroll: true }); }, []);
  const ok = isEmail(email);
  const locked = auth.busy !== null;

  const providers = (
    <>
      <ProviderButton provider="google" busy={auth.busy === 'google'} disabled={locked} onClick={auth.google}>{auth.busy === 'google' ? 'Opening Google…' : 'Continue with Google'}</ProviderButton>
      <ProviderButton provider="microsoft" busy={auth.busy === 'microsoft'} disabled={locked} onClick={() => void auth.go('microsoft')}>{auth.busy === 'microsoft' ? 'Opening Microsoft…' : 'Continue with Microsoft'}</ProviderButton>
    </>
  );
  const ssoButton = () => <Button variant="quiet" size={layout === 'hero' ? 'sm' : 'md'} icon="key" disabled={locked} onClick={() => setSso(true)}>Use single sign-on</Button>;
  const t = reduce ? { duration: 0 } : { duration: 0.45, ease: EASE.out };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {sso ? (
        <motion.form key="sso" className="lp-sso" {...swap} transition={t} onSubmit={(e) => { e.preventDefault(); if (ok && !locked) void auth.go('sso', email); }}>
          <Field ref={input} label="Work email" type="email" placeholder="you@example.com" autoComplete="off" spellCheck={false} value={email} disabled={locked}
            onChange={(e) => setEmail(e.target.value)} hint="To try single sign-on, use any address at example.com." />
          <div className="acts">
            <Button type="submit" variant="primary" iconRight="right" loading={auth.busy === 'sso'} disabled={!ok}>{auth.busy === 'sso' ? 'Signing in…' : 'Continue'}</Button>
            <Button variant="quiet" disabled={locked} onClick={() => setSso(false)}>Back</Button>
          </div>
        </motion.form>
      ) : layout === 'hero' ? (
        <motion.div key="ways" {...swap} transition={t}>
          <div className="lp-ways">{providers}</div>
          <div className="lp-meta">{ssoButton()}<span>Free to start, with 400 minutes of notes.</span></div>
        </motion.div>
      ) : (
        <motion.div key="ways" className="ways" {...swap} transition={t}>
          {providers}
          {ssoButton()}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
