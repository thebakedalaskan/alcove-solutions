/*
 * Joining a team by its link (docs/design/pages.md › Team, joining; the canvas's Join board): one card on the team's evening.
 * The link's secret is in its fragment, which no server sees, and it leaves the address bar at once. Signed in, the card asks
 * whose team it is and says what joining gives you, with Not now and Join; nothing happens until Join. Joining takes one of
 * the team's licenses if one is left, and the card says so, or that none was and the admin has been told. Signed out, it asks
 * you to sign in first: the invite waits in this tab while you do (lib/afterSignIn.ts), Google's way back included, and the
 * card asks once you're back. A used or expired invite, being on a team already, no invite at all and no connection each say
 * so, and what to do.
 */
import { TeamSecretBodySchema, errorCode, errorMessage, type DemoProvider, type MyTeam, type TeamInvitePeek } from '@alcove/api';
import { Button, Dots, JoinCard, JoinEvening, buttonClass, useToast, type JoinFact } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { hoursOfNotes } from '~/features/plans/words';
import { WaysIn, type Auth, type Busy } from '~/features/welcome/WaysIn';
import { clearReturn, returnTo, takeReturnTo } from '~/lib/afterSignIn';
import { sessionOrOffline } from '~/lib/guards';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { q, useGoogleSignIn, useJoinTeam, useSignIn } from '~/lib/queries';
import { byWhen, dayFullMonth } from '~/lib/time';

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
  taken ??= takeReturnTo('team')?.secret ?? null;
  return taken;
}

type Joining =
  | { at: 'checking' } | { at: 'sign-in' }
  | { at: 'ask'; peek: TeamInvitePeek } | { at: 'joining'; peek: TeamInvitePeek } | { at: 'joined'; team: MyTeam }
  /** On a team already: another one (`other`), the one the invite is for, or the invite is your own (`same`). */
  | { at: 'other'; peek: TeamInvitePeek; mine: MyTeam } | { at: 'same'; peek: TeamInvitePeek; yours: boolean }
  | { at: 'used' } | { at: 'no-link' } | { at: 'unreachable' } | { at: 'failed'; message: string };

export function JoinTeamPage() {
  const [secret] = useState(takeSecret);
  const [joining, setJoining] = useState<Joining>({ at: 'checking' });
  const qc = useQueryClient();
  const join = useJoinTeam();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);
  const asking = joining.at === 'ask' || joining.at === 'joining';
  const notes = useQuery({ ...q.offers(), enabled: asking }).data?.team.notesMinutes;

  /** Why the invite wasn't used: said on the card, and logged by its code alone. */
  const refused = async (e: unknown, peek: TeamInvitePeek | null) => {
    const code = errorCode(e);
    jlog.info('team link not used', { code });
    if (code === 'network') { setJoining({ at: 'unreachable' }); return; }
    if (code === 'unauthenticated') { setJoining({ at: 'sign-in' }); return; }
    if (code === 'not-found') { setJoining({ at: 'used' }); return; }
    if (code === 'conflict' && peek) {
      const mine = await qc.fetchQuery({ ...q.myTeam(), staleTime: 0 }).catch(() => null);
      if (mine) { setJoining({ at: 'other', peek, mine }); return; }
    }
    setJoining({ at: 'failed', message: errorMessage(e) });
  };
  /** Signed in: whose team the invite is for, to ask, unless you're on a team already. Signed out: sign in first. Joins nothing. */
  const ask = async () => {
    if (!secret) { setJoining({ at: 'no-link' }); return; }
    setJoining({ at: 'checking' });
    const s = await sessionOrOffline(qc).catch(() => 'offline' as const);
    if (s === 'offline') { setJoining({ at: 'unreachable' }); return; }
    if (!s) { setJoining({ at: 'sign-in' }); return; }
    try {
      const [peek, mine] = await Promise.all([qc.fetchQuery(q.teamInvite(secret)), qc.fetchQuery(q.myTeam())]);
      if (!mine) setJoining({ at: 'ask', peek });
      else if (sameEmail(peek.admin, s.user) || mine.name === peek.name) setJoining({ at: 'same', peek, yours: sameEmail(peek.admin, s.user) });
      else setJoining({ at: 'other', peek, mine });
    } catch (e) { await refused(e, null); }
  };
  const go = (peek: TeamInvitePeek) => {
    if (!secret) { setJoining({ at: 'no-link' }); return; }
    setJoining({ at: 'joining', peek });
    join.mutate(secret, {
      onSuccess: (team) => { taken = null; setJoining({ at: 'joined', team }); },
      onError: (e) => void refused(e, peek)
    });
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask();
  });
  // Leaving the page, by Not now or any other way, forgets the invite here: opening it again asks again.
  useEffect(() => () => { taken = null; }, []);

  const auth: Auth = {
    busy, leaving: false,
    google: () => {
      if (!secret) return;
      returnTo({ to: 'team', secret });
      setBusy('google');
      void googleSignIn.start().then(async (r) => {
        if (r === 'redirecting') return;
        clearReturn();
        setBusy(null);
        if (r && 'session' in r) await ask();
      }).catch((e: unknown) => { clearReturn(); toast(errorMessage(e), { icon: 'x' }); setBusy(null); });
    },
    cancelGoogle: googleSignIn.cancel,
    go: async (provider: DemoProvider, email?: string) => {
      setBusy(provider);
      try { await signIn.mutateAsync({ provider, email: provider === 'sso' ? email?.trim() : undefined }); setBusy(null); await ask(); }
      catch (e) { toast(errorMessage(e), { icon: 'x' }); setBusy(null); }
    }
  };

  /* What joining gives you: a person's notes as the server offers them, once it can be asked. */
  const facts: JoinFact[] = [
    { icon: 'notes', text: notes === undefined ? 'Notes of your own, every month' : `About ${hoursOfNotes(notes)} of notes a month, your own` },
    { icon: 'people', text: 'The notes and workspaces the team shares' },
    { icon: 'upload', text: 'Storage shared by everyone on it' }
  ];
  const open = (to: '/home' | '/team', filled: boolean) => <Link to={to} className={buttonClass({ variant: filled ? 'primary' : 'secondary' })}>Open Alcove</Link>;

  if (joining.at === 'checking') {
    return <JoinEvening><p className="tj-wait" role="status"><Dots /> Opening the invite</p></JoinEvening>;
  }
  if (joining.at === 'sign-in') {
    return (
      <JoinEvening>
        <JoinCard title="Join a team?" line="Someone invited you to their team on Alcove. Sign in first, then join." facts={facts}
          actions={<WaysIn auth={auth} layout="hero" />} foot="The invite waits in this tab while you sign in." />
      </JoinEvening>
    );
  }
  if (joining.at === 'ask' || joining.at === 'joining') {
    const { peek } = joining;
    return (
      <JoinEvening>
        <JoinCard faces={[peek.admin]} title={`Join ${peek.name}?`}
          line={`${callName(peek.admin)} invited you to their team on Alcove. Joining takes one of its licenses, so you have:`} facts={facts}
          actions={(
            <>
              <Link to="/home" className={buttonClass({ variant: 'quiet' })}>Not now</Link>
              <Button variant="primary" loading={joining.at === 'joining'} onClick={() => go(peek)}><span className="ac-clamp-1">Join {peek.name}</span></Button>
            </>
          )}
          foot="Nothing happens until you join. You can leave the team later, from Team." />
      </JoinEvening>
    );
  }
  if (joining.at === 'joined') {
    const { team } = joining;
    const you = team.members.find((m) => m.you);
    const lead = team.members.find((m) => m.role === 'admin');
    const until = you?.license.until ?? null;
    return (
      <JoinEvening>
        {team.licensed ? (
          <JoinCard faces={team.members.map((m) => m.person)} done title={`You’re on ${team.name}`}
            line={`${until === null ? 'Your license is live.' : `Your license runs to ${dayFullMonth(new Date(until))}.`} The notes and workspaces the team shares are yours to open now.`}
            actions={open('/team', true)} foot="Your own notes and calls stay yours." />
        ) : (
          <JoinCard faces={team.members.map((m) => m.person)} done title={`You’re on ${team.name}`}
            line={`None of its licenses was left, so you’re on your own plan for now. ${lead ? callName(lead.person) : 'Its admin'} has been told, and one is yours the next time you open Alcove after they buy more.`}
            actions={open('/team', true)} />
        )}
      </JoinEvening>
    );
  }
  if (joining.at === 'other') {
    const { peek, mine } = joining;
    return (
      <JoinEvening>
        <JoinCard faces={[peek.admin]} title="You’re on a team already"
          line={`You can be on one team at a time. To join ${peek.name}, leave ${mine.name} first, from Team, then open this invite again while it lasts.`}
          actions={open('/team', false)} />
      </JoinEvening>
    );
  }
  if (joining.at === 'same') {
    const { peek, yours } = joining;
    return (
      <JoinEvening>
        <JoinCard faces={[peek.admin]} title={yours ? 'This invite is yours to send' : `You’re on ${peek.name} already`}
          line={yours
            ? `It lets one person join ${peek.name}, until ${byWhen(peek.expiresAt, Date.now())}. Opening it here doesn’t use it.`
            : 'This invite is for someone who isn’t on it yet. Opening it here doesn’t use it.'}
          actions={open('/team', false)} />
      </JoinEvening>
    );
  }
  if (joining.at === 'used') {
    return (
      <JoinEvening>
        <JoinCard title="This invite can’t be used" line="It’s been used, or a day has passed since it was made. Each invite works once. Ask whoever sent it for a new one."
          actions={open('/home', false)} />
      </JoinEvening>
    );
  }
  if (joining.at === 'no-link') {
    return (
      <JoinEvening>
        <JoinCard title="There’s no invite here" line="Open the whole link you were sent: the part after # is what lets you join." actions={open('/home', false)} />
      </JoinEvening>
    );
  }
  return (
    <JoinEvening>
      <JoinCard title={joining.at === 'unreachable' ? 'Can’t reach Alcove' : 'The invite didn’t open'}
        line={joining.at === 'unreachable' ? 'Check this device’s connection, then try again.' : joining.message}
        actions={<Button variant="primary" icon="retry" onClick={() => void ask()}>Try again</Button>} />
    </JoinEvening>
  );
}
