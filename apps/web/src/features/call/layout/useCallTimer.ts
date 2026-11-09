/*
 * The call's timer as this browser shows it. What's left is worked out from the call's clock (the server's, `useCallClock`) each
 * time it's painted, never counted down here, so a tab in the background, a reconnect or a late join shows the same second as
 * everyone else. Owns one repaint a second while it runs and a soft chime at 0:00, which follows your call sounds (Timers,
 * quiet, volume).
 */
import { type CallState } from '@alcove/api';
import { timerClock, type CallTimerTone } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { playSound, stopSounds } from '~/lib/audio-output';
import { useSoundPreferences } from '~/lib/sound-preferences';
import type { CallClock } from './status';

export function useCallTimer(state: CallState, clock: CallClock, connected: boolean, speakerId: string | null) {
  const [, paint] = useState(0);
  const sound = useSoundPreferences();
  const owner = useRef({});
  const live = useRef({ prefs: sound.prefs, speakerId, allowed: false });
  live.current = { prefs: sound.prefs, speakerId, allowed: connected && sound.ready && state.phase === 'in-call' };
  const timer = state.timer;
  // The server's time now, read as this paints (a repaint a second runs it again), from the one anchor the call keeps.
  const serverNow = Date.now() + clock.skew;
  const elapsed = timer ? timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, serverNow - timer.startedAt)) : 0;
  const remaining = timer ? timer.durationSeconds - elapsed / 1000 : 0;
  const overtime = timer !== null && remaining <= 0;
  const paused = timer?.status === 'paused';
  const warning = timer?.status === 'running' && remaining > 0 && remaining <= 30;
  const tone: CallTimerTone = !timer ? 'ready' : overtime ? 'overtime' : paused ? 'paused' : warning ? 'warning' : 'running';
  // Over time it counts up from +0:00, a whole second at a time.
  const time = !timer ? null : overtime ? `+${timerClock(Math.floor(-remaining))}` : timerClock(remaining);
  const status = !timer ? null : overtime ? paused ? 'Paused, over time' : 'Over time' : paused ? 'Paused' : null;
  const label = !time ? 'Timer for everyone' : overtime ? `Timer: ${time} over time${paused ? ', paused' : ''}` : `Timer: ${time} left${paused ? ', paused' : ''}`;
  /** For a screen reader, said as it changes: once as it starts, pauses, nears the end and runs out. */
  const say = !timer ? '' : overtime ? 'The timer is over time.' : paused ? 'The timer is paused.' : warning ? '30 seconds left on the timer.' : 'The timer is running.';
  // Owns the repaint while it runs. Backgrounding never stops the clock: it's the server's.
  useEffect(() => {
    if (timer?.status !== 'running') return;
    const repaint = setInterval(() => paint((n) => n + 1), 1000);
    const visible = () => paint((n) => n + 1);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(repaint); document.removeEventListener('visibilitychange', visible); };
  }, [timer?.status]);
  useEffect(() => () => stopSounds(owner.current), [state.callId, connected, sound.prefs]);
  // The chime, once, as this browser sees it reach zero: not for someone who joins or comes back to it over time.
  const previous = useRef<{ callId: string; key: string; remaining: number; at: number } | null>(null);
  useEffect(() => {
    const before = previous.current;
    const now = performance.now();
    const key = timer ? `${timer.id}:${timer.durationSeconds}` : '';
    previous.current = connected && timer?.status === 'running' ? { callId: state.callId, key, remaining, at: now } : null;
    if (!live.current.allowed || !timer || !before || before.callId !== state.callId || before.key !== key || now - before.at > 5000 || before.remaining <= 0 || remaining > 0) return;
    playSound({ owner: owner.current, cue: 'timer', key: `call-timer:${state.callId}:${key}`, until: Date.now() + 1000, current: () => ({ prefs: { ...live.current.prefs, enabled: live.current.prefs.enabled && live.current.allowed }, speakerId: live.current.speakerId }) });
  }, [state.callId, timer, remaining, connected]);
  return { timer, remaining, time, tone, status, label, say };
}
export type CallTimerView = ReturnType<typeof useCallTimer>;
