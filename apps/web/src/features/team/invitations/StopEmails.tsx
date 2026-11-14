/*
 * Stopping invitation emails (`/stop-email#<token>`; docs/design/pages.md › Team, stopping invitation emails; the design's
 * 5.1): the page every invitation email's foot links to. One card on the team's evening: Stop invitation emails?, one button,
 * then that Alcove won't email you invitations again. It needs no sign-in. The token is in the fragment, which no server
 * sees, and it leaves the address bar at once. Whatever the token, the answer is the same: whether it stopped anything is
 * nobody's to know, so nothing here says. Invitations to the address are still made and still show in Alcove. Offline, and
 * anything going wrong, say so in caution, as it happens, with Try again.
 */
import { MailStopBodySchema, errorCode, errorMessage } from '@alcove/api';
import { Button, JoinCard, JoinEvening, buttonClass } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { log } from '~/lib/log';
import { useStopEmails } from '../queries';

const slog = log.child({ component: 'stop-email' });

/* What this page took, so reading again (React may call a state initializer twice) gives the same answer. */
let taken: string | null = null;
/** The token: from the fragment, taken out of the address bar (and so out of history) straight away. */
function takeToken(): string | null {
  const raw = location.hash.slice(1);
  if (raw) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    const r = MailStopBodySchema.shape.token.safeParse(raw);
    taken = r.success ? r.data : null;
  }
  return taken;
}

type Stopping = { at: 'ask' } | { at: 'stopped' } | { at: 'no-token' } | { at: 'offline' } | { at: 'failed'; message: string };

export function StopEmailsPage() {
  const [token] = useState(takeToken);
  const stop = useStopEmails();
  const [stopping, setStopping] = useState<Stopping>(token ? { at: 'ask' } : { at: 'no-token' });
  // Leaving the page forgets the token here.
  useEffect(() => () => { taken = null; }, []);

  const go = () => {
    if (!token) return;
    stop.mutate(token, {
      onSuccess: () => { slog.info('invitation emails stopped'); setStopping({ at: 'stopped' }); },
      onError: (e) => {
        const code = errorCode(e);
        slog.info('invitation emails not stopped', { code });
        setStopping(code === 'network' || !navigator.onLine ? { at: 'offline' } : { at: 'failed', message: errorMessage(e) });
      }
    });
  };
  const alcove = <Link to="/home" className={buttonClass({ variant: 'quiet' })}>Open Alcove</Link>;

  if (stopping.at === 'stopped') {
    return <JoinEvening><JoinCard done title="Alcove won’t email you invitations again." line="Any you’re sent still show in Alcove, on Team." actions={alcove} /></JoinEvening>;
  }
  if (stopping.at === 'no-token') {
    return (
      <JoinEvening>
        <JoinCard title="There’s nothing to stop here" line="Open the whole link from the email: the part after # is what stops them." actions={alcove} />
      </JoinEvening>
    );
  }
  const trouble = stopping.at === 'offline' ? 'You’re offline. Check this device’s connection, then try again.' : stopping.at === 'failed' ? stopping.message : null;
  return (
    <JoinEvening>
      <JoinCard title="Stop invitation emails?"
        line="Alcove won’t email this address invitations to join a team any more. Any you’re sent still show in Alcove."
        problem={trouble}
        actions={<Button variant="primary" icon={trouble ? 'retry' : undefined} loading={stop.isPending} onClick={go}>{trouble ? 'Try again' : 'Stop invitation emails'}</Button>} />
    </JoinEvening>
  );
}
