/*
 * The invite page (`/invite#…`; docs/design/pages.md › Team, the invite page; the design's 4.3 and 4.5): one card on the
 * team's evening, for either kind of secret after the `#`: an invitation's own link, from its email ("Priya invited you to
 * join Vandelay Industries"), or a team's link ("Join Vandelay Industries on Alcove"; "Jonas asked you to join them on Alcove"
 * while Jonas is on no team yet). The secret is in the fragment, which no server sees, and it leaves the address bar at once.
 *
 * Signed out, the card is the invitation, with the ways in, while the link waits in this tab (features/account/afterSignIn.ts),
 * Google's way back and a look at the welcome page included. An account made from the card has said yes by signing in from
 * it, so it joins the team at once, isn't asked to choose a plan (someone joining a team doesn't), and goes on to its
 * arrival as from the welcome page, onto Home, which says "You're on Vandelay Industries." An account from before, or anyone
 * signed in, has Join and Not now (which puts an invitation to you aside, with Undo, as on Team, then goes Home); joining
 * while on another team asks first, in place, and Stay puts the focus back on Join. Your own link, or your team's, says so,
 * with Copy link; an invitation to the team you're on says you're on it already, and never asks you to leave it. An
 * invitation used, cancelled or run out, a link replaced, no link, no connection and a failure each say so, and what to do.
 */
import { InviteSecretSchema, errorCode, errorMessage, type DemoProvider, type InvitePeek, type MyTeam, type Person } from '@alcove/api';
import { Button, Dots, JoinCard, JoinEvening, TeamAsk, buttonClass, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { WaysIn, useRestored, type Auth, type Busy } from '~/features/account/WaysIn';
import { clearReturn, returnTo, takeReturnTo } from '~/features/account/afterSignIn';
import { sessionOrOffline } from '~/features/account/guards';
import { useGoogleSignIn, useSignIn } from '~/features/account/signIn';
import { useChosePlans } from '~/features/plans/queries';
import { log } from '~/lib/log';
import { callName } from '~/lib/people';
import { UNDO_MS } from './invitations/aside';
import { sayOnArrival } from './invitations/arrival';
import { cantJoin, leaveAsk, leavingOf } from './invitations/leaving';
import { WHAT_ALCOVE_IS, asideSaid, joinLabel, peekTitle, whoIsOn } from './invitations/words';
import { useCopyInvite } from './People';
import { teamQueries, useJoinTeam, useNotNow } from './queries';

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
  | { at: 'checking' } | { at: 'sign-in'; peek: InvitePeek }
  /** An account just made from the card, joining its team before it arrives. */
  | { at: 'arriving'; team: string | null }
  /** Signed in: Join and Not now, with the team you're on now (`mine`), whose leaving joining asks about first. */
  | { at: 'ask'; peek: InvitePeek; mine: MyTeam | null }
  | { at: 'yours'; peek: InvitePeek }
  /** It leads nowhere now: used, cancelled, run out or replaced. `from`, when the page still knows who sent it. */
  | { at: 'ended'; from: Person | null }
  | { at: 'no-link' } | { at: 'unreachable' } | { at: 'failed'; message: string };

export function InvitedPage() {
  const [link] = useState(takeLink);
  const [opening, setOpening] = useState<Opening>({ at: 'checking' });
  /* Leaving the team you're on, asked in place of Join. */
  const [asking, setAsking] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const join = useJoinTeam();
  const chose = useChosePlans();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const notNow = useNotNow();
  const copy = useCopyInvite();
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);
  /* Join takes the focus back once Stay closes the question in its place. */
  const back = useRef(false);
  const joinRef = (el: HTMLButtonElement | null) => { if (el && back.current) { back.current = false; el.focus(); } };
  /** The account signed in was made from this card (or on Google's way back here): Try again still joins it at once. */
  const madeHere = useRef(link?.arriving === true);
  /** What the link said when it last said, for the card while an account is made from it. */
  const said = useRef<InvitePeek | null>(null);
  // Back from Google's own page, this page can come back as it was left, waiting for Google.
  useRestored(() => setBusy(null));

  /** Why the link didn't open: said on the card, and logged by its code alone. */
  const refused = (e: unknown) => {
    const code = errorCode(e);
    ilog.info('invite link not opened', { code });
    setOpening(code === 'network' ? { at: 'unreachable' } : code === 'not-found' ? { at: 'ended', from: said.current?.from ?? null } : { at: 'failed', message: errorMessage(e) });
  };
  /**
   * An account just made from the card joins its team at once, and isn't asked to choose a plan; then its first sign-in goes
   * on as from the welcome page, onto Home, which says which team it's on. The arrival is never skipped because the link
   * stopped leading anywhere or didn't join: then the plans are offered as they are to anyone new.
   */
  const arrive = async (secret: string) => {
    setOpening({ at: 'arriving', team: said.current?.team?.name ?? null });
    try {
      const team = await join.mutateAsync({ secret, leave: false });
      const name = team.name || said.current?.team?.name;
      if (name) sayOnArrival(name);
      await chose.mutateAsync().catch((e: unknown) => ilog.info('the plan choice wasn’t skipped', { code: errorCode(e) }));
    } catch (e) {
      ilog.info('a new account didn’t join from its invite', { code: errorCode(e) });
    }
    taken = null;
    await navigate({ to: '/ready', replace: true });
  };
  /**
   * What the link is, and who's signed in: the card for them, or for you once you're in. `madeNow`: the account just signed in
   * was made from this card, which joins its team at once.
   */
  const open = async (madeNow = false) => {
    if (madeNow) madeHere.current = true;
    setAsking(false);
    if (!link) { setOpening({ at: 'no-link' }); return; }
    if (madeHere.current) { await arrive(link.secret); return; }
    setOpening({ at: 'checking' });
    let peek: InvitePeek;
    try { peek = await qc.fetchQuery(teamQueries.peek(link.secret)); }
    catch (e) { refused(e); return; }
    said.current = peek;
    const s = await sessionOrOffline(qc).catch(() => 'offline' as const);
    if (s === 'offline') { setOpening({ at: 'unreachable' }); return; }
    if (!s) { setOpening({ at: 'sign-in', peek }); return; }
    if (peek.yours) { setOpening({ at: 'yours', peek }); return; }
    const mine = await qc.fetchQuery({ ...teamQueries.myTeam(), staleTime: 0 }).catch(() => null);
    setOpening({ at: 'ask', peek, mine });
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open();
  });
  // Leaving the page, by Not now or any other way, forgets the link here: opening it again asks again.
  useEffect(() => () => { taken = null; }, []);

  /** Join, once asked (or with nothing to ask): you're on the team, and its page opens, saying so. */
  const joining = (peek: InvitePeek, leave: boolean) => {
    if (!link) return;
    join.mutate({ secret: link.secret, leave }, {
      onSuccess: (t) => {
        taken = null;
        const name = t.name || peek.team?.name;
        toast(name ? `You’re on ${name}.` : 'You’re on the team.', { icon: 'people' });
        void navigate({ to: '/team', replace: true });
      },
      onError: (e) => {
        const code = errorCode(e);
        ilog.info('not joined from an invite link', { code, leave });
        if (code === 'not-found') { setOpening({ at: 'ended', from: peek.from }); return; }
        // On a team this page didn't know of (joined from another tab), or on this one already: the link is looked at
        // again, as who's signed in is now, and the card is the one for that.
        if (code === 'conflict' && !leave) { toast(errorMessage(e), { icon: 'x' }); void open(); return; }
        setAsking(false);
        toast(errorMessage(e), { icon: 'x' });
      }
    });
  };
  /** Not now: an invitation to you is put aside, as on Team, with Undo; then Home. */
  const notNowGo = (peek: InvitePeek) => {
    const id = peek.invitationId;
    taken = null;
    void navigate({ to: '/home' });
    if (id === null) return;
    notNow.aside(id, (e) => { ilog.info('an invitation not put aside', { code: errorCode(e) }); toast(errorMessage(e), { icon: 'x' }); });
    // Until when it can still be joined is the invitations' to say: read once it's put aside, and said with Undo.
    const say = (expires: string | null) => toast(asideSaid(expires), { icon: 'check', ms: UNDO_MS, topic: `aside ${id}`, action: { label: 'Undo', onClick: () => { notNow.undo(id); } } });
    void qc.fetchQuery(teamQueries.invitations()).then((list) => say(list.find((i) => i.id === id)?.expiresAt ?? null), () => say(null));
  };

  /* Signing in here stays here: a new account joins at once, and one from before is asked. */
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
  /* A look at the welcome page keeps the link in this tab: Back comes here again, and signing in there comes back to it. */
  const keep = () => { if (link) returnTo({ to: 'invite', secret: link.secret }); };

  const alcove = <Link to="/home" className={buttonClass()}>Open Alcove</Link>;
  if (opening.at === 'checking' || opening.at === 'arriving') {
    const team = opening.at === 'arriving' ? opening.team : null;
    return (
      <JoinEvening>
        <p className="tj-wait" role="status"><Dots /> {opening.at === 'checking' ? 'Opening the invitation' : team ? `Joining ${team}` : 'Opening Alcove'}</p>
      </JoinEvening>
    );
  }
  if (opening.at === 'sign-in' || opening.at === 'ask' || opening.at === 'yours') {
    const { peek } = opening;
    const faces = peek.team?.faces.length ? peek.team.faces : [peek.from];
    const on = peek.team ? whoIsOn(peek.team, peek.kind === 'invitation' ? peek.from : null) : '';
    if (opening.at === 'yours') {
      /* An invitation to the team you're on: there's nothing to join. */
      if (peek.kind === 'invitation') {
        return (
          <JoinEvening>
            <JoinCard faces={faces} title={peekTitle(peek)} line={on || undefined}
              actions={<Link to="/team" className={buttonClass({ variant: 'primary' })}>Go to Team</Link>} />
          </JoinEvening>
        );
      }
      const here = link ? new URL(`/invite#${link.secret}`, location.origin).href : null;
      return (
        <JoinEvening>
          <JoinCard faces={faces} title={peekTitle(peek)}
            line={peek.team ? `Send it to someone you’d like on ${peek.team.name}.` : 'Send it to someone you’d like on a team with you: joining from it starts one, with you as its admin.'}
            actions={(
              <>
                <Link to="/team" className={buttonClass({ variant: 'quiet' })}>Go to Team</Link>
                {here && <Button variant="primary" icon="link" onClick={() => void copy(here, { team: peek.team?.name })}>Copy link</Button>}
              </>
            )} />
        </JoinEvening>
      );
    }
    if (opening.at === 'sign-in') {
      return (
        <JoinEvening>
          <JoinCard faces={faces} title={peekTitle(peek)} line={[on, peek.team ? WHAT_ALCOVE_IS : `${WHAT_ALCOVE_IS} Sign in to get started.`].filter((x) => x !== '').join(' ')}
            actions={<WaysIn auth={auth} layout="hero" />}
            foot={<Link to="/welcome" className={buttonClass({ variant: 'quiet', size: 'sm' })} onClick={keep}>See what Alcove does</Link>} />
        </JoinEvening>
      );
    }
    const leaving = leavingOf(opening.mine);
    const name = peek.team?.name ?? callName(peek.from);
    const ask = asking ? leaveAsk(leaving, { name, from: peek.from }) : null;
    const blocked = cantJoin(leaving, name);
    return (
      <JoinEvening>
        <JoinCard faces={faces} title={peekTitle(peek)} line={on || undefined} note={blocked}
          ask={ask ? <TeamAsk title={ask.title} text={ask.text} confirm={ask.confirm} keep={ask.keep} busy={join.isPending} onConfirm={() => joining(peek, true)} onKeep={() => { back.current = true; setAsking(false); }} /> : undefined}
          actions={(
            <>
              <Button variant={blocked === null ? 'quiet' : 'secondary'} onClick={() => notNowGo(peek)}>Not now</Button>
              {blocked === null && (
                <Button ref={joinRef} variant="primary" loading={join.isPending}
                  onClick={() => { if (leaving.kind === 'none') joining(peek, false); else setAsking(true); }}><span className="ac-clamp-1">{joinLabel(peek)}</span></Button>
              )}
            </>
          )} />
      </JoinEvening>
    );
  }
  if (opening.at === 'ended') {
    return (
      <JoinEvening>
        <JoinCard title="This invitation has ended"
          line={opening.from ? `Ask ${callName(opening.from)} to invite you again.` : 'Ask whoever invited you to invite you again.'} actions={alcove} />
      </JoinEvening>
    );
  }
  if (opening.at === 'no-link') {
    return (
      <JoinEvening>
        <JoinCard title="There’s no invitation here" line="Open the whole link you were sent: the part after # says who it’s from." actions={alcove} />
      </JoinEvening>
    );
  }
  return (
    <JoinEvening>
      <JoinCard title={opening.at === 'unreachable' ? 'Can’t reach Alcove' : 'The invitation didn’t open'}
        line={opening.at === 'unreachable' ? 'Check this device’s connection, then try again.' : opening.message}
        actions={<Button variant="primary" icon="retry" onClick={() => void open()}>Try again</Button>} />
    </JoinEvening>
  );
}
