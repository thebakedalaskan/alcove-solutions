import { GoogleSignInMessageSchema, type GoogleSignInResult } from '@alcove/api';
import { Button, EmptyState } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { GOOGLE_REFUSED, googleSignInChannel } from '~/features/account/googleSignIn';
import { log } from '~/lib/log';

/** The popup's return page. It never shows the account or starts the opening animation here. */
export function GoogleComplete({ popup, result }: { popup: string; result: GoogleSignInResult }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel;
    try { channel = new BroadcastChannel(googleSignInChannel(popup)); }
    catch (e) { log.child({ component: 'google-sign-in' }).debug('popup completion channel unavailable', { err: e }); return; }
    const send = () => channel.postMessage(result);
    channel.addEventListener('message', (e: MessageEvent<unknown>) => {
      const message = GoogleSignInMessageSchema.safeParse(e.data);
      if (message.success && message.data.type === 'received') window.close();
    });
    send();
    // Repeat until the waiting tab acknowledges; loading or restoring a tab mustn't lose the result.
    const repeat = setInterval(send, 250);
    const timeout = setTimeout(() => { clearInterval(repeat); channel.close(); }, 60_000);
    return () => { clearInterval(repeat); clearTimeout(timeout); channel.close(); };
  }, [popup, result.type, result.type === 'complete' ? result.next : result.reason]);
  const complete = result.type === 'complete';
  return (
    <main className="min-h-dvh grid place-items-center bg-ground p-6">
      <EmptyState title={complete ? 'You’re signed in' : 'Google sign-in didn’t finish'} action={
        <Button variant="primary" onClick={() => void navigate({ to: result.type === 'complete' ? result.next : '/welcome', search: {}, replace: true })}>
          {complete ? 'Continue in this tab' : 'Try again'}
        </Button>
      }>
        {result.type === 'complete' ? 'Return to the Alcove tab you opened this from. You can close this window.' : GOOGLE_REFUSED[result.reason]}
      </EmptyState>
    </main>
  );
}
