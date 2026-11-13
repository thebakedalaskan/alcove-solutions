/*
 * The call's timer: one countdown, the same for everyone in the call. Its button sits in the call's top bar (and over the
 * stage in focus, and in the floating call), and opens Timer for everyone: the time said big, then, for the host, the lengths
 * to start one with, or Pause, +1 min and Stop while one runs. Everyone else reads the same seconds. Stateless: the time is
 * worked out by whoever shows it.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { Button } from '../foundation/primitives';

/** How the timer stands: none yet (the host's Timer), counting down, paused, in its last 30 seconds, or over time. */
export type CallTimerTone = 'ready' | 'running' | 'paused' | 'warning' | 'overtime';
const ICONS: Record<CallTimerTone, IconName> = { ready: 'timer', running: 'timer', paused: 'pause', warning: 'alert', overtime: 'alert' };

/** Seconds as a timer reads them, 4:59, 12:00 or 1:05:00, rounded up, so a countdown shows its whole length as it starts. */
export function timerClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/**
 * The timer's button: Timer while none runs (only the host has it then), and the countdown itself once one does, for
 * everyone. `label` says it in words, what's left and how it stands. It can anchor a popover. `compact`: on a phone, where
 * Timer is its icon alone.
 */
export const CallTimerButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  time: string | null; label: string; tone: CallTimerTone; compact?: boolean | undefined;
}>(function CallTimerButton({ time, label, tone, compact = false, className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} className={cn('ac-call-timer-button', `is-${tone}`, compact && 'is-compact', className)} {...rest}>
      <Icon name={ICONS[tone]} size={17} />
      {time ? <b>{time}</b> : !compact && <span>Timer</span>}
    </button>
  );
});

/** Timer for everyone, the timer's popover: the time said big, how it stands, and under it what the host can do. */
export function CallTimerCard({ time, tone, status, children }: { time: string; tone: CallTimerTone; status?: string | null | undefined; children?: ReactNode }) {
  return (
    <div className={cn('ac-timer-card', `is-${tone}`)}>
      <div className="ac-timer-head">Timer for everyone</div>
      <div className="ac-timer-big" role="timer">{time}</div>
      {status && <p className="ac-timer-status">{status}</p>}
      {children}
    </div>
  );
}

/** The lengths a timer usually runs, in minutes. */
export const CALL_TIMER_LENGTHS = [1, 3, 5, 10, 15] as const;

/**
 * Choosing how long, for the host: the usual lengths, a minute less or more, and Start (`starting` while it's on its way).
 * `disabled` while the call's connection is away.
 */
export function CallTimerLength({ minutes, max, onMinutes, onStart, starting = false, disabled = false }: {
  minutes: number; max: number; onMinutes: (minutes: number) => void; onStart: () => void; starting?: boolean | undefined; disabled?: boolean | undefined;
}) {
  return (
    <>
      <div className="ac-timer-lengths" role="group" aria-label="How long">
        {CALL_TIMER_LENGTHS.map((m) => (
          // Opening it, or stopping a timer, puts you on the length picked.
          <button key={m} type="button" aria-pressed={m === minutes} autoFocus={m === minutes} disabled={disabled} onClick={() => onMinutes(m)}>{m} min</button>
        ))}
      </div>
      <div className="ac-timer-row">
        <Button size="sm" icon="minus" aria-label="A minute less" disabled={disabled || minutes <= 1} onClick={() => onMinutes(minutes - 1)} />
        <Button size="sm" icon="plus" aria-label="A minute more" disabled={disabled || minutes >= max} onClick={() => onMinutes(minutes + 1)} />
        <Button variant="primary" size="sm" icon="play" className="is-start" loading={starting} disabled={disabled} onClick={onStart}>Start</Button>
      </div>
    </>
  );
}

/**
 * A countdown under way, for the host: Pause or Resume, a minute more, and Stop. A press on its way leaves them enabled, so
 * focus stays put: whoever shows them ignores a second press meanwhile. `disabled` while the call's connection is away.
 */
export function CallTimerRun({ paused, onPause, onResume, onAddMinute, onStop, disabled = false }: {
  paused: boolean; onPause: () => void; onResume: () => void; onAddMinute: () => void; onStop: () => void; disabled?: boolean | undefined;
}) {
  return (
    <div className="ac-timer-row is-run">
      {/* Starting one puts you here, on the same button as it pauses and resumes. */}
      {paused ? <Button size="sm" icon="play" autoFocus disabled={disabled} onClick={onResume}>Resume</Button> : <Button size="sm" icon="pause" autoFocus disabled={disabled} onClick={onPause}>Pause</Button>}
      <Button size="sm" disabled={disabled} onClick={onAddMinute}>+1 min</Button>
      <Button size="sm" variant="quiet" disabled={disabled} onClick={onStop}>Stop</Button>
    </div>
  );
}
