/*
 * Opening a link to a call's notes (docs: Privacy, keys and sessions › Who can read a note). Its secret comes in the
 * link's fragment, which no server sees, and leaves the address bar at once. The link reads nothing by itself, and opens
 * nothing by itself either: opening it puts the account's name and address in Who has these notes for everyone with them,
 * so signed in, the page first says which account would open them and that everyone with them will see it, and only
 * Open the notes opens it. It also says until when the link works, which it asks first (a link that's run out says so
 * then), and that the notes it opens stay with whoever opened it after that. Then the notes join that account's, as shared
 * by whoever made the link, and the note opens. Signed out, it asks them to sign in first, and then asks the same; a
 * sign-in with Google that takes the whole tab keeps the secret in this tab (afterSignIn.ts) and comes back here to ask.
 */
import { NoteLinkSecretSchema, errorCode, errorMessage, type DemoProvider, type Session } from '@alcove/api';
import { Button, Dots, GuestCard, Icon, buttonClass, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { WaysIn, type Auth, type Busy } from '~/features/account/WaysIn';
import { clearReturn, returnTo, takeReturnTo } from '~/features/account/afterSignIn';
import { sessionOrOffline } from '~/features/account/guards';
import { log } from '~/lib/log';
import { shortDay } from '~/lib/time';
import { accountQueries } from '~/features/account/queries';
import { useGoogleSignIn, useSignIn } from '~/features/account/signIn';
import { sharingQueries, useClaimNoteLink } from './queries';

const llog = log.child({ component: 'note-link' });

/* What this page took, so reading again (React may call a state initializer twice) gives the same answer. */
let taken: string | null = null;
/** The link's secret: from its fragment, taken out of the address bar (and so out of history) straight away, or kept while signing in. */
function takeSecret(): string | null {
  const raw = location.hash.slice(1);
  if (raw) {
    history.replaceState(history.state, '', location.pathname);
    const r = NoteLinkSecretSchema.safeParse(raw);
    taken = r.success ? r.data : null;
    return taken;
  }
  taken ??= takeReturnTo('link')?.secret ?? null;
  return taken;
}

/** The account the page asks about: whose name and address everyone with the notes would see. */
type Asked = { ownerId: string; email: string };
const asked = (s: Session): Asked => ({ ownerId: s.ownerId, email: s.user.email });

/** `until`: when the link stops opening anything, as Alcove said when the page asked. */
type Opening =
  | { at: 'checking' } | { at: 'ask'; who: Asked; until: string } | { at: 'opening'; who: Asked; until: string } | { at: 'sign-in' } | { at: 'no-link' } | { at: 'gone' }
  | { at: 'refused'; message: string } | { at: 'unreachable' };
/** What the page says when looking at or opening the link was refused, or didn't get through. */
function refusedAs(e: unknown): Opening {
  const code = errorCode(e);
  return code === 'not-found' ? { at: 'gone' } : code === 'network' ? { at: 'unreachable' } : code === 'unauthenticated' ? { at: 'sign-in' } : { at: 'refused', message: errorMessage(e) };
}

export function NoteLinkPage() {
  const [secret] = useState(takeSecret);
  const [opening, setOpening] = useState<Opening>({ at: 'checking' });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const claim = useClaimNoteLink();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);

  /**
   * Who's signed in, to ask them before anything opens, and until when the link works, to say so: one that's run out says
   * so now, not once they've said to open it. Signed out, it asks them to sign in. Opens nothing.
   */
  const ask = async () => {
    if (!secret) { setOpening({ at: 'no-link' }); return; }
    setOpening({ at: 'checking' });
    const s = await sessionOrOffline(qc).catch(() => 'offline' as const);
    if (s === 'offline') { setOpening({ at: 'unreachable' }); return; }
    if (!s) { setOpening({ at: 'sign-in' }); return; }
    try {
      const { expiresAt } = await qc.fetchQuery(sharingQueries.noteLink(secret));
      setOpening({ at: 'ask', who: asked(s), until: expiresAt });
    } catch (e) {
      llog.info('note link not looked at', { code: errorCode(e) });
      setOpening(refusedAs(e));
    }
  };
  /** Opens the link as the account the page named, once they've said to: the notes join theirs, and their note opens. */
  const open = async (who: Asked, until: string) => {
    if (!secret) { setOpening({ at: 'no-link' }); return; }
    setOpening({ at: 'opening', who, until });
    try {
      // Asked again now: another tab may have signed someone else in, or out, since. Then it asks again, and opens nothing.
      const now = await qc.fetchQuery({ ...accountQueries.session(), staleTime: 0 });
      if (now?.ownerId !== who.ownerId) { setOpening(now ? { at: 'ask', who: asked(now), until } : { at: 'sign-in' }); return; }
      const { noteId } = await claim.mutateAsync(secret);
      taken = null;
      await navigate({ to: '/calls/$noteId', params: { noteId }, replace: true });
    } catch (e) {
      llog.info('note link not opened', { code: errorCode(e) });
      setOpening(refusedAs(e));
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask();
  });
  // Leaving the page, by Not now or any other way, forgets the link here: opening it again asks again.
  useEffect(() => () => { taken = null; }, []);

  /* Signing in here stays here, and then asks before the link opens, as for anyone signed in already. */
  const auth: Auth = {
    busy, leaving: false,
    google: () => {
      if (!secret) return;
      // In case Google takes the whole tab: the way back comes here again, to ask.
      returnTo({ to: 'link', secret });
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

  if (opening.at === 'ask' || opening.at === 'opening') {
    const { who, until } = opening;
    return (
      <GuestCard>
        <span className="rg-done"><Icon name="notes" size={24} /></span>
        <h1>Someone shared a call’s notes with you</h1>
        <p>Open them as <b>{who.email}</b>? Everyone who has them will see that you did.</p>
        <p className="rg-sealed"><Icon name="clock" size={14} /><span>This link works until {shortDay(new Date(until))}. Notes you open with it stay yours after that.</span></p>
        <Button variant="primary" size="lg" loading={opening.at === 'opening'} onClick={() => void open(who, until)}>
          {opening.at === 'opening' ? 'Opening the notes' : 'Open the notes'}
        </Button>
        <Link to="/home" className={buttonClass({ variant: 'quiet' })}>Not now</Link>
      </GuestCard>
    );
  }
  if (opening.at === 'sign-in') {
    return (
      <GuestCard>
        <span className="rg-done"><Icon name="notes" size={24} /></span>
        <h1>Someone shared a call’s notes with you</h1>
        <p>Sign in to open them. They go to the account you sign in with, to keep, and the link alone opens nothing.</p>
        <WaysIn auth={auth} layout="stack" />
      </GuestCard>
    );
  }
  if (opening.at === 'gone' || opening.at === 'no-link') {
    return (
      <GuestCard>
        <span className="rg-done is-quiet"><Icon name={opening.at === 'gone' ? 'clock' : 'link'} size={24} /></span>
        <h1>{opening.at === 'gone' ? 'This link has run out or been revoked' : 'There’s no link here'}</h1>
        <p>{opening.at === 'gone' ? 'Ask whoever sent it for a new one. If you opened it before, you have the notes already.' : 'Open the whole link you were sent: the part after # is what opens the notes.'}</p>
        <Link to="/calls" className={buttonClass({ size: 'lg' })}>Go to your notes</Link>
      </GuestCard>
    );
  }
  if (opening.at === 'refused') {
    return (
      <GuestCard>
        <span className="rg-done is-quiet"><Icon name="lock" size={24} /></span>
        <h1>These notes can’t open here</h1>
        <p>{opening.message}</p>
        <Link to="/calls" className={buttonClass({ size: 'lg' })}>Go to your notes</Link>
      </GuestCard>
    );
  }
  if (opening.at === 'unreachable') {
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
