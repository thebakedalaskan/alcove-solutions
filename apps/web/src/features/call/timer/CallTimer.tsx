/*
 * The call's timer, in the top bar (and over the stage in focus). Whoever hosts has Timer: it opens Timer for everyone, where
 * they pick a length and start it. Once one runs, the button is the countdown for everyone, and opens the same popover: the
 * host pauses, resumes, adds a minute or stops it there, and everyone else reads it. Nothing here keeps the time: it comes
 * from the call (useCallTimer).
 */
import { CALL_TIMER_MAX_SECONDS, errorMessage, type CallSession, type CallTimerControl } from '@alcove/api';
import { CallTimerButton, CallTimerCard, CallTimerLength, CallTimerRun, Popover, cn, timerClock, useToast } from '@alcove/ui';
import { useRef, useState } from 'react';
import { log } from '~/lib/log';
import type { CallTimerView } from './useCallTimer';

const tlog = log.child({ component: 'call-timer' });

export function CallTimer({ session, view, host, connected, open, onOpenChange, phone = false, className }: {
  session: CallSession; view: CallTimerView;
  /** You host now: only then can you start or change it. */
  host: boolean;
  /** Connected to the call: its controls wait while it isn't. The countdown carries on regardless. */
  connected: boolean;
  open: boolean; onOpenChange: (open: boolean) => void;
  phone?: boolean | undefined; className?: string | undefined;
}) {
  const [minutes, setMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const toast = useToast();
  const { timer } = view;
  if (!timer && !host) return null;
  const control = (input: CallTimerControl) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    session.controlTimer(input)
      .catch((err: unknown) => { tlog.warn('timer control failed', { err, callId: session.ticket.callId, action: input.action }); toast(errorMessage(err), { icon: 'x' }); })
      .finally(() => { pending.current = false; setBusy(false); });
  };
  const max = Math.floor(CALL_TIMER_MAX_SECONDS / 60);
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="start" label="Timer for everyone" tip={phone ? undefined : 'Timer for everyone'} className={cn('ac-timer-pop', phone && 'is-sheet')}
      anchor={<CallTimerButton time={view.time} label={view.label} tone={view.tone} compact={phone} className={className} />}>
      <CallTimerCard time={view.time ?? timerClock(minutes * 60)} tone={view.tone} status={view.status}>
        {!host ? <p className="ac-timer-note">Only the host can change it.</p>
          : !timer ? <CallTimerLength minutes={minutes} max={max} onMinutes={(m) => setMinutes(Math.min(max, Math.max(1, m)))} starting={busy} disabled={!connected}
            onStart={() => control({ action: 'start', durationSeconds: minutes * 60 })} />
          : <CallTimerRun paused={timer.status === 'paused'} disabled={!connected}
            onPause={() => control({ action: 'pause', expectedRevision: timer.revision })} onResume={() => control({ action: 'resume', expectedRevision: timer.revision })}
            onAddMinute={() => control({ action: 'add-time', expectedRevision: timer.revision, seconds: 60 })} onStop={() => control({ action: 'stop', expectedRevision: timer.revision })} />}
        {host && !connected && <p className="ac-timer-note">Reconnecting. You can change the timer once you’re back.</p>}
      </CallTimerCard>
    </Popover>
  );
}
