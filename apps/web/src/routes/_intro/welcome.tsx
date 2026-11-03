import { errorMessage, type DemoProvider } from '@alcove/api';
import { Icon, ProviderMark, cn, useToast } from '@alcove/ui';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Moment, useMoments } from '~/features/welcome/Moments';
import { isEmail } from '~/lib/parse';
import { googleSignInUrl, q, useSignIn } from '~/lib/queries';

/** Why a sign-in with Google came back without signing in, as the API reports it. */
const REFUSED = {
  cancelled: 'Google sign-in was cancelled.',
  expired: 'That sign-in took too long or started in another tab. Try again.',
  unverified: 'Google hasn’t verified that account’s email address, so Alcove can’t use it.',
  unavailable: 'Google sign-in isn’t set up on this server yet.',
  busy: 'Too many sign-in attempts. Wait a minute and try again.',
  failed: 'Couldn’t sign in with Google. Try again.'
} as const;
type Refused = keyof typeof REFUSED;
const isRefused = (v: unknown): v is Refused => typeof v === 'string' && Object.keys(REFUSED).includes(v);

export const Route = createFileRoute('/_intro/welcome')({
  validateSearch: (s: Record<string, unknown>): { signin?: Refused | undefined } => ({ signin: isRefused(s['signin']) ? s['signin'] : undefined }),
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(q.session())) throw redirect({ to: '/home', replace: true });
  },
  component: Welcome
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* The ways in. One click each: there's nothing to set up first. */
function Welcome() {
  const moments = useMoments<'ways' | 'sso'>('ways');
  const signIn = useSignIn();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<DemoProvider | 'google' | null>(null);
  const { signin } = Route.useSearch();
  const [leaving, setLeaving] = useState(false);
  const [email, setEmail] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const current = moments.list.find((m) => !m.out)?.kind;

  /* Coming back with the browser's Back button restores this page as it was left: busy. */
  useEffect(() => {
    const on = (e: PageTransitionEvent) => { if (e.persisted) setBusy(null); };
    addEventListener('pageshow', on);
    return () => removeEventListener('pageshow', on);
  }, []);

  /* Back from Google without a session: say why once, then tidy the address. */
  useEffect(() => {
    if (!signin) return;
    toast(REFUSED[signin], { icon: 'x', ms: 5200 });
    void navigate({ to: '/welcome', search: {}, replace: true });
  }, [signin, toast, navigate]);

  useEffect(() => {
    if (current !== 'sso') return;
    const t = setTimeout(() => input.current?.focus({ preventScroll: true }), 420);
    return () => clearTimeout(t);
  }, [current]);

  /* Google is a real sign-in: the browser goes there and comes back to the API. */
  const google = () => {
    setBusy('google');
    location.assign(googleSignInUrl());
  };
  /* Microsoft and single sign-on are demo identities for now. */
  const go = async (provider: DemoProvider) => {
    setBusy(provider);
    try {
      const r = await signIn.mutateAsync({ provider, email: provider === 'sso' ? email.trim() : undefined });
      setLeaving(true);
      await sleep(300);
      await navigate({ to: r.isNew ? '/ready' : '/home', replace: true });
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
      setBusy(null);
    }
  };

  const provider = (p: 'google' | 'microsoft', name: string) => (
    <button type="button" className={cn('in-auth-btn', busy === p && 'busy')} disabled={busy !== null} onClick={() => (p === 'google' ? google() : void go(p))}>
      {busy === p ? <><span className="spin" aria-hidden="true" /><span>Opening {name}…</span></> : <><ProviderMark provider={p} /><span>Continue with {name}</span></>}
    </button>
  );
  const ways = [
    <h1 key="h" className="in-title">Calls that take their own notes.</h1>,
    <p key="p" className="in-body">They’re written privately, so not even Alcove can read them.</p>,
    <div key="a" className="in-auth">
      {provider('google', 'Google')}
      {provider('microsoft', 'Microsoft')}
      <button type="button" className="in-sso" disabled={busy !== null} onClick={() => moments.show('sso')}><Icon name="key" size={16} />Use single sign-on (SSO)</button>
    </div>
  ];
  const ok = isEmail(email);
  const sso = [
    <h1 key="h" className="in-title mid">Sign in with SSO</h1>,
    <p key="p" className="in-body">Company sign-in isn’t connected yet. To try it, use any address at example.com.</p>,
    <input key="i" ref={input} className="in-input" type="email" placeholder="you@example.com" autoComplete="off" spellCheck={false} aria-label="Email at example.com"
      value={email} disabled={busy !== null} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok && busy === null) void go('sso'); }} />,
    <div key="a" className="in-actions">
      <button type="button" className={cn('in-cta', busy === 'sso' && 'busy')} disabled={!ok || busy !== null} onClick={() => void go('sso')}>
        {busy === 'sso' ? <><span className="spin" aria-hidden="true" />Signing in…</> : <>Continue <Icon name="right" size={18} /></>}
      </button>
      <button type="button" className="in-link" disabled={busy !== null} onClick={() => moments.show('ways')}>Back</button>
    </div>
  ];
  return <>{moments.list.map((m) => <Moment key={m.id} out={m.out || leaving} replacing={m.replacing} parts={m.kind === 'ways' ? ways : sso} />)}</>;
}
