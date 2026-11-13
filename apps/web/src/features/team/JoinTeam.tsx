/*
 * Joining a team by its link (docs: Plans and usage › Team). The secret comes in the link's fragment, which no server sees,
 * and leaves the address bar at once. Signed in, the page says whose team it is and asks: Join, or Not now. Joining takes a
 * license if one is there, and the Team page opens. Signed out, it asks them to sign in first, here, and then asks the same;
 * a sign-in with Google that takes the whole tab keeps the secret in this tab (afterSignIn.ts) and comes back here. A
 * refusal (a used or expired link, already on a team) says what the server says.
 */
import { TeamSecretBodySchema, errorCode, errorMessage, firstName, type DemoProvider, type TeamInvitePeek } from '@alcove/api';
import { Avatar, Button, Dots, GuestCard, Icon, buttonClass, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { WaysIn, type Auth, type Busy } from '~/features/welcome/WaysIn';
import { returnToTeam, takeTeamReturn } from '~/lib/afterSignIn';
import { sessionOrOffline } from '~/lib/guards';
import { log } from '~/lib/log';
import { q, useGoogleSignIn, useJoinTeam, useSignIn } from '~/lib/queries';

const jlog = log.child({ component: 'team-join' });

/* What this page took, so reading again (React may call a state initializer twice) gives the same answer. */
let taken: string | null = null;
/** The link's secret: from its fragment, taken out of the address bar (and so out of history) straight away, or kept while signing in. */
function takeSecret(): string | null {
  const raw = location.hash.slice(1);
  if (raw) {
    history.replaceState(history.state, '', location.pathname);
    const r = TeamSecretBodySchema.shape.secret.safeParse(raw);
    taken = r.success ? r.data : null;
    return taken;
  }
  taken ??= takeTeamReturn();
  return taken;
}

type Joining =
  | { at: 'checking' } | { at: 'ask'; peek: TeamInvitePeek } | { at: 'joining'; peek: TeamInvitePeek } | { at: 'sign-in' } | { at: 'no-link' }
  | { at: 'refused'; message: string } | { at: 'unreachable' };

export function JoinTeamPage() {
  const [secret] = useState(takeSecret);
  const [joining, setJoining] = useState<Joining>({ at: 'checking' });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const join = useJoinTeam();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);

  const failed = (e: unknown) => {
    const code = errorCode(e);
    jlog.info('team link not used', { code });
    setJoining(code === 'network' ? { at: 'unreachable' } : code === 'unauthenticated' ? { at: 'sign-in' } : { at: 'refused', message: errorMessage(e) });
  };
  /** Signed in: whose team the link joins, to ask. Signed out: sign in first. Joins nothing. */
  const ask = async () => {
    if (!secret) { setJoining({ at: 'no-link' }); return; }
    setJoining({ at: 'checking' });
    const s = await sessionOrOffline(qc).catch(() => 'offline' as const);
    if (s === 'offline') { setJoining({ at: 'unreachable' }); return; }
    if (!s) { setJoining({ at: 'sign-in' }); return; }
    try { setJoining({ at: 'ask', peek: await qc.fetchQuery(q.teamInvite(secret)) }); } catch (e) { failed(e); }
  };
  const go = (peek: TeamInvitePeek) => {
    if (!secret) { setJoining({ at: 'no-link' }); return; }
    setJoining({ at: 'joining', peek });
    join.mutate(secret, {
      onSuccess: (t) => {
        taken = null;
        toast(t.licensed ? `You’re on ${t.name}.` : `You’re on ${t.name}, without a license for now.`, { icon: 'check' });
        void navigate({ to: '/team', replace: true });
      },
      onError: failed
    });
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask();
  });
  // Leaving the page, by Not now or any other way, forgets the link here: opening it again asks again.
  useEffect(() => () => { taken = null; }, []);

  const auth: Auth = {
    busy, leaving: false,
    google: () => {
      if (!secret) return;
      returnToTeam(secret);
      setBusy('google');
      void googleSignIn.start().then(async (r) => {
        if (r === 'redirecting') return;
        takeTeamReturn();
        setBusy(null);
        if (r && 'session' in r) await ask();
      }).catch((e: unknown) => { takeTeamReturn(); toast(errorMessage(e), { icon: 'x' }); setBusy(null); });
    },
    cancelGoogle: googleSignIn.cancel,
    go: async (provider: DemoProvider, email?: string) => {
      setBusy(provider);
      try { await signIn.mutateAsync({ provider, email: provider === 'sso' ? email?.trim() : undefined }); setBusy(null); await ask(); }
      catch (e) { toast(errorMessage(e), { icon: 'x' }); setBusy(null); }
    }
  };

  if (joining.at === 'ask' || joining.at === 'joining') {
    const { peek } = joining;
    return (
      <GuestCard>
        <Avatar person={peek.admin} size={56} />
        <h1>Join {peek.name}, {firstName(peek.admin.name)}’s team?</h1>
        <p>Its notes and workspaces open to you while you have a license from the team. {firstName(peek.admin.name)} buys them.</p>
        <Button variant="primary" size="lg" loading={joining.at === 'joining'} onClick={() => go(peek)}>{joining.at === 'joining' ? 'Joining' : 'Join'}</Button>
        <Link to="/home" className={buttonClass({ variant: 'quiet' })}>Not now</Link>
      </GuestCard>
    );
  }
  if (joining.at === 'sign-in') {
    return (
      <GuestCard>
        <span className="rg-done"><Icon name="people" size={24} /></span>
        <h1>Someone asked you to join their team</h1>
        <p>Sign in to see whose team it is. You join with the account you sign in with, and only once you say so.</p>
        <WaysIn auth={auth} layout="stack" />
      </GuestCard>
    );
  }
  if (joining.at === 'no-link' || joining.at === 'refused') {
    return (
      <GuestCard>
        <span className="rg-done is-quiet"><Icon name={joining.at === 'refused' ? 'clock' : 'link'} size={24} /></span>
        <h1>{joining.at === 'refused' ? 'This link can’t join you to a team' : 'There’s no link here'}</h1>
        <p>{joining.at === 'refused' ? joining.message : 'Open the whole link you were sent: the part after # is what joins the team.'}</p>
        <Link to="/team" className={buttonClass({ size: 'lg' })}>Go to Team</Link>
      </GuestCard>
    );
  }
  if (joining.at === 'unreachable') {
    return (
      <GuestCard>
        <span className="rg-done is-quiet"><Icon name="wifiOff" size={24} /></span>
        <h1>Can’t reach Alcove</h1>
        <p>Check this device’s connection. The link still works.</p>
        <Button variant="primary" size="lg" icon="repeat" onClick={() => void ask()}>Try again</Button>
      </GuestCard>
    );
  }
  return <GuestCard><p role="status"><Dots /> Checking who’s signed in</p></GuestCard>;
}
