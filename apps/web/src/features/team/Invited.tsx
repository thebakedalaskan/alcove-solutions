/*
 * Someone's invite link (docs/design/pages.md › Team, an invite link; docs/product/user-flows.md 10): one card on the team's
 * evening, saying who it's from. The link's secret is in its fragment, which no server sees, and it leaves the address bar at
 * once. Signed out, the card is theirs: who asked you, what Alcove is for, and the ways in, while the link waits in this tab
 * (features/account/afterSignIn.ts), Google's way back included. An account made from the card tells them it joined, then its
 * first sign-in goes on as it would from the welcome page: the account arrives, then the plans, then Home. An account that
 * was there already tells nobody, and the card says so, with Go to Home, as it does for anyone signed in when they open the
 * link. Your own link says it's yours. A link that leads nowhere, no link at all, no connection and a failure each say so,
 * and what to do.
 */
import { InviteSecretSchema, errorCode, errorMessage, type DemoProvider, type Person } from '@alcove/api';
import { Button, Dots, JoinCard, JoinEvening, buttonClass, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { WaysIn, type Auth, type Busy } from '~/features/account/WaysIn';
import { clearReturn, returnTo, takeReturnTo } from '~/features/account/afterSignIn';
import { sessionOrOffline } from '~/features/account/guards';
import { useGoogleSignIn, useSignIn } from '~/features/account/signIn';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { teamQueries, useJoinedByInvite } from './queries';

const ilog = log.child({ component: 'invite-link' });

/** The link this page took: its secret, and whether an account was just made from it on Google's way back here (`arriving`). */
interface Taken { secret: string; arriving: boolean }
/* What this page took, so reading again (React may call a state initializer twice) gives the same answer. */
let taken: Taken | null = null;
/** The link: from its fragment, taken out of the address bar (and so out of history) straight away, or kept while signing in. */
function takeLink(): Taken | null {
  const raw = location.hash.slice(1);
  if (raw) {
    history.replaceState(history.state, '', location.pathname);
    const r = InviteSecretSchema.safeParse(raw);
    taken = r.success ? { secret: r.data, arriving: false } : null;
    return taken;
  }
  if (!taken) {
    const kept = takeReturnTo('invite');
    taken = kept ? { secret: kept.secret, arriving: kept.arriving === true } : null;
  }
  return taken;
}

type Opening =
  | { at: 'checking' } | { at: 'sign-in'; from: Person } | { at: 'telling'; from: Person }
  /** Signed in: an account from before, or your own link (`yours`). */
  | { at: 'already'; from: Person } | { at: 'yours'; from: Person }
  | { at: 'nowhere' } | { at: 'no-link' } | { at: 'unreachable' } | { at: 'failed'; message: string };

export function InvitedPage() {
  const [link] = useState(takeLink);
  const [opening, setOpening] = useState<Opening>({ at: 'checking' });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tell = useJoinedByInvite();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);
  /** The account signed in was made from this card (or on Google's way back here): Try again still tells its sender. */
  const madeHere = useRef(link?.arriving === true);

  /** Why the link didn't open: said on the card, and logged by its code alone. */
  const refused = (e: unknown) => {
    const code = errorCode(e);
    ilog.info('invite link not opened', { code });
    setOpening(code === 'network' ? { at: 'unreachable' } : code === 'not-found' ? { at: 'nowhere' } : { at: 'failed', message: errorMessage(e) });
  };
  /**
   * An account just made from the link: whoever sent it is told, then its first sign-in goes on as from the welcome page.
   * Telling them is worth a moment, never the arrival: anything but no connection goes on without it.
   */
  const arrive = async (from: Person, secret: string) => {
    setOpening({ at: 'telling', from });
    try {
      await tell.mutateAsync(secret);
    } catch (e) {
      const code = errorCode(e);
      if (code === 'network') { setOpening({ at: 'unreachable' }); return; }
      ilog.warn('invite link’s sender not told', { code });
    }
    taken = null;
    await navigate({ to: '/ready', replace: true });
  };
  /**
   * Who the link is from, and who's signed in: the card for them, or for you once you're in. `madeNow`: the account just
   * signed in was made from this card, which is what tells its sender. Nothing else tells anyone.
   */
  const open = async (madeNow = false) => {
    if (madeNow) madeHere.current = true;
    if (!link) { setOpening({ at: 'no-link' }); return; }
    setOpening({ at: 'checking' });
    let from: Person;
    try { from = (await qc.fetchQuery(teamQueries.invitedBy(link.secret))).from; }
    catch (e) { refused(e); return; }
    const s = await sessionOrOffline(qc).catch(() => 'offline' as const);
    if (s === 'offline') { setOpening({ at: 'unreachable' }); return; }
    if (!s) { setOpening({ at: 'sign-in', from }); return; }
    if (sameEmail(from, s.user)) { setOpening({ at: 'yours', from }); return; }
    if (madeHere.current) { await arrive(from, link.secret); return; }
    setOpening({ at: 'already', from });
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open();
  });
  // Leaving the page, by Go to Home or any other way, forgets the link here: opening it again asks again.
  useEffect(() => () => { taken = null; }, []);

  /* Signing in here stays here: a new account tells whoever sent the link, and one from before is told it's on Alcove. */
  const auth: Auth = {
    busy, leaving: false,
    google: () => {
      if (!link) return;
      // In case Google takes the whole tab: its way back comes here again, through /ready for an account it made.
      returnTo({ to: 'invite', secret: link.secret });
      setBusy('google');
      void googleSignIn.start().then(async (r) => {
        if (r === 'redirecting') return;
        clearReturn();
        setBusy(null);
        if (r && 'session' in r) await open(r.next === '/ready');
      }).catch((e: unknown) => { clearReturn(); toast(errorMessage(e), { icon: 'x' }); setBusy(null); });
    },
    cancelGoogle: googleSignIn.cancel,
    go: async (provider: DemoProvider, email?: string) => {
      setBusy(provider);
      try {
        const r = await signIn.mutateAsync({ provider, email: provider === 'sso' ? email?.trim() : undefined });
        setBusy(null);
        await open(r.isNew);
      } catch (e) { toast(errorMessage(e), { icon: 'x' }); setBusy(null); }
    }
  };

  const alcove = <Link to="/home" className={buttonClass()}>Open Alcove</Link>;
  if (opening.at === 'checking' || opening.at === 'telling') {
    return (
      <JoinEvening>
        <p className="tj-wait" role="status"><Dots /> {opening.at === 'telling' ? `Telling ${callName(opening.from)} you joined` : 'Opening the invite'}</p>
      </JoinEvening>
    );
  }
  if (opening.at === 'sign-in') {
    const { from } = opening;
    return (
      <JoinEvening>
        <JoinCard faces={[from]} title={`${callName(from)} asked you to join them on Alcove`}
          line="Alcove is for calls: each one gets its notes and a workspace of its own. Sign in to get started."
          actions={<WaysIn auth={auth} layout="hero" />}
          foot={<Link to="/welcome" className={buttonClass({ variant: 'quiet', size: 'sm' })}>See what Alcove does</Link>} />
      </JoinEvening>
    );
  }
  if (opening.at === 'already') {
    const { from } = opening;
    return (
      <JoinEvening>
        <JoinCard faces={[from]} title="You’re on Alcove already" line={`${callName(from)}’s link is for someone new to Alcove, so there’s nothing to do here.`}
          actions={<Link to="/home" className={buttonClass({ variant: 'primary' })}>Go to Home</Link>} />
      </JoinEvening>
    );
  }
  if (opening.at === 'yours') {
    return (
      <JoinEvening>
        <JoinCard faces={[opening.from]} title="This is your invite link" line="Send it to someone you’d like on Alcove."
          actions={<Link to="/team" className={buttonClass({ variant: 'primary' })}>Go to Team</Link>} />
      </JoinEvening>
    );
  }
  if (opening.at === 'nowhere') {
    return (
      <JoinEvening>
        <JoinCard title="This invite link doesn’t lead anywhere"
          line="Part of it may be missing, or whoever sent it isn’t on Alcove any more. Ask them to send it again." actions={alcove} />
      </JoinEvening>
    );
  }
  if (opening.at === 'no-link') {
    return (
      <JoinEvening>
        <JoinCard title="There’s no invite here" line="Open the whole link you were sent: the part after # says who it’s from." actions={alcove} />
      </JoinEvening>
    );
  }
  return (
    <JoinEvening>
      <JoinCard title={opening.at === 'unreachable' ? 'Can’t reach Alcove' : 'The invite didn’t open'}
        line={opening.at === 'unreachable' ? 'Check this device’s connection, then try again.' : opening.message}
        actions={<Button variant="primary" icon="retry" onClick={() => void open()}>Try again</Button>} />
    </JoinEvening>
  );
}
