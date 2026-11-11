/*
 * Opening a link to a call's notes (docs: Privacy, keys and sessions › Who can read a note). Its secret comes in the
 * link's fragment, which no server sees, and leaves the address bar at once. The link reads nothing by itself: signed in,
 * the account opens it, the notes join theirs as shared by whoever made the link, and the note opens. Signed out, it asks
 * them to sign in first; a sign-in with Google that takes the whole tab keeps the secret in this tab (afterSignIn.ts) and
 * comes back here.
 */
import { NoteLinkSecretSchema, errorCode, errorMessage, type DemoProvider } from '@alcove/api';
import { Button, Dots, GuestCard, Icon, buttonClass, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { WaysIn, type Auth, type Busy } from '~/features/welcome/WaysIn';
import { returnToLink, takeLinkReturn } from '~/lib/afterSignIn';
import { sessionOrOffline } from '~/lib/guards';
import { log } from '~/lib/log';
import { useClaimNoteLink, useGoogleSignIn, useSignIn } from '~/lib/queries';

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
  taken ??= takeLinkReturn();
  return taken;
}

type Opening = { at: 'opening' } | { at: 'sign-in' } | { at: 'no-link' } | { at: 'gone' } | { at: 'refused'; message: string } | { at: 'unreachable' };

export function NoteLinkPage() {
  const [secret] = useState(takeSecret);
  const [opening, setOpening] = useState<Opening>({ at: 'opening' });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const claim = useClaimNoteLink();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);

  /** Opens the link as whoever's signed in, then their note; signed out, it asks them to sign in. */
  const open = async () => {
    if (!secret) { setOpening({ at: 'no-link' }); return; }
    setOpening({ at: 'opening' });
    const s = await sessionOrOffline(qc).catch(() => 'offline' as const);
    if (s === 'offline') { setOpening({ at: 'unreachable' }); return; }
    if (!s) { setOpening({ at: 'sign-in' }); return; }
    try {
      const { noteId } = await claim.mutateAsync(secret);
      taken = null;
      await navigate({ to: '/notes/$noteId', params: { noteId }, replace: true });
    } catch (e) {
      const code = errorCode(e);
      llog.info('note link not opened', { code });
      setOpening(code === 'not-found' ? { at: 'gone' } : code === 'network' ? { at: 'unreachable' } : code === 'unauthenticated' ? { at: 'sign-in' } : { at: 'refused', message: errorMessage(e) });
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open();
  });

  /* Signing in here stays here: the link opens as soon as there's an account. */
  const auth: Auth = {
    busy, leaving: false,
    google: () => {
      if (!secret) return;
      // In case Google takes the whole tab: the way back opens the link again.
      returnToLink(secret);
      setBusy('google');
      void googleSignIn.start().then(async (r) => {
        if (r === 'redirecting') return;
        takeLinkReturn();
        setBusy(null);
        if (r && 'session' in r) await open();
      }).catch((e: unknown) => { takeLinkReturn(); toast(errorMessage(e), { icon: 'x' }); setBusy(null); });
    },
    cancelGoogle: googleSignIn.cancel,
    go: async (provider: DemoProvider, email?: string) => {
      setBusy(provider);
      try { await signIn.mutateAsync({ provider, email: provider === 'sso' ? email?.trim() : undefined }); setBusy(null); await open(); }
      catch (e) { toast(errorMessage(e), { icon: 'x' }); setBusy(null); }
    }
  };

  if (opening.at === 'sign-in') {
    return (
      <GuestCard>
        <span className="rg-done"><Icon name="notes" size={24} /></span>
        <h1>Someone shared a call’s notes with you</h1>
        <p>Sign in to open them. They go to the account you sign in with, and the link alone opens nothing.</p>
        <WaysIn auth={auth} layout="stack" />
      </GuestCard>
    );
  }
  if (opening.at === 'gone' || opening.at === 'no-link') {
    return (
      <GuestCard>
        <span className="rg-done is-quiet"><Icon name={opening.at === 'gone' ? 'clock' : 'link'} size={24} /></span>
        <h1>{opening.at === 'gone' ? 'This link has run out or been revoked' : 'There’s no link here'}</h1>
        <p>{opening.at === 'gone' ? 'Ask whoever sent it for a new one.' : 'Open the whole link you were sent: the part after # is what opens the notes.'}</p>
        <Link to="/notes" className={buttonClass({ size: 'lg' })}>Go to your notes</Link>
      </GuestCard>
    );
  }
  if (opening.at === 'refused') {
    return (
      <GuestCard>
        <span className="rg-done is-quiet"><Icon name="lock" size={24} /></span>
        <h1>These notes can’t open here</h1>
        <p>{opening.message}</p>
        <Link to="/notes" className={buttonClass({ size: 'lg' })}>Go to your notes</Link>
      </GuestCard>
    );
  }
  if (opening.at === 'unreachable') {
    return (
      <GuestCard>
        <span className="rg-done is-quiet"><Icon name="wifiOff" size={24} /></span>
        <h1>Can’t reach Alcove</h1>
        <p>Check this device’s connection. The link still works.</p>
        <Button variant="primary" size="lg" icon="repeat" onClick={() => void open()}>Try again</Button>
      </GuestCard>
    );
  }
  return <GuestCard><p role="status"><Dots /> Opening the notes</p></GuestCard>;
}
