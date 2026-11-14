/*
 * The call's address: the call while you're in it, then, once it's over for you, its own page (CallOver.tsx), which Rejoin can
 * turn back into the call. Nothing cuts between them, and nothing here keeps time: the call eases back under its page until the
 * page says it has arrived, and a call Rejoin brings back comes up under the page until the page says it has faded. Opened
 * without a call in this tab (a reload after leaving, say), it's the join page.
 */
import type { CallSession } from '@alcove/api';
import { Navigate } from '@tanstack/react-router';
import { useState } from 'react';
import { sessions } from './handoff';
import { CallOverPage, type Left } from './CallOver';
import { InCall } from './InCall';

/**
 * What's here: the call; the call easing back under its page as the page arrives; the page; or a call Rejoin brought back,
 * coming up under the page as it fades. Rejoin pressed while the page was still arriving (`arriving`: straight back after
 * leaving by mistake, say) lets its arrival play on under the fade, so the page fades from wherever it had got to.
 */
type Here =
  | { at: 'call'; call: CallSession }
  | { at: 'easing'; call: CallSession; left: Left }
  | { at: 'page'; left: Left }
  | { at: 'back'; call: CallSession; left: Left; arriving: boolean };

export function CallPage({ code }: { code: string }) {
  /* The call this page shows: the one this tab joined, then whichever Rejoin brings back. */
  const [here, setHere] = useState<Here | null>(() => (sessions.call?.code === code ? { at: 'call', call: sessions.call.session } : null));
  if (!here) return <Navigate to="/join/$code" params={{ code }} replace />;
  const call = here.at === 'page' ? null : here.call;
  const left = here.at === 'call' ? null : here.left;
  return (
    <>
      {call && (
        <InCall key={`${call.ticket.callId}:${call.ticket.identity}`} session={call} returning={here.at === 'back'}
          onOver={(l) => setHere({ at: 'easing', call, left: l })} />
      )}
      {left && (
        <CallOverPage key={left.at} left={left} entering={here.at === 'easing' || (here.at === 'back' && here.arriving)} back={here.at === 'back'}
          onEntered={() => setHere((h) => (h?.at === 'easing' ? { at: 'page', left: h.left } : h))}
          onBack={(s) => setHere((h) => ({ at: 'back', call: s, left, arriving: h?.at === 'easing' }))}
          onGone={() => setHere((h) => (h?.at === 'back' ? { at: 'call', call: h.call } : h))} />
      )}
    </>
  );
}
