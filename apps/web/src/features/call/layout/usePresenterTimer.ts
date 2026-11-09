import { CallTimerCuePreferenceSchema, type CallState } from '@alcove/api';
import { useEffect, useRef, useState } from 'react';
import { playSound, stopSounds } from '~/lib/audio-output';
import { log } from '~/lib/log';
import { useSoundPreferences } from '~/lib/sound-preferences';
import { timerDuration } from './TimerPlan';
import type { CallTimerTone } from '@alcove/ui';

const KEY = 'alcove.presenter-timer.cue';
const tlog = log.child({ component: 'presenter-timer' });
function readCue(): boolean {
  try { const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'false'); const parsed = CallTimerCuePreferenceSchema.safeParse(stored); return parsed.success && parsed.data; }
  catch { return false; }
}

/** One local wake-up paints server time. The countdown never depends on accumulated browser ticks. */
export function usePresenterTimer(state: CallState, connected: boolean, speakerId: string | null) {
  const clock = useRef({ callId: state.callId, serverNow: state.attention.serverNow, received: performance.now() });
  if (clock.current.callId !== state.callId || clock.current.serverNow !== state.attention.serverNow) clock.current = { callId: state.callId, serverNow: state.attention.serverNow, received: performance.now() };
  const [, paint] = useState(0);
  const [cue, setCue] = useState(readCue);
  const sound = useSoundPreferences();
  const owner = useRef({});
  const live = useRef({ prefs: sound.prefs, speakerId, allowed: false });
  live.current = { prefs: sound.prefs, speakerId, allowed: cue && connected && sound.ready && state.phase === 'in-call' };
  const sequence = state.timerSequence;
  const segment = sequence?.segments[sequence.activeIndex];
  const serverNow = Date.parse(state.attention.serverNow) + Math.max(0, performance.now() - clock.current.received);
  const elapsed = sequence ? sequence.elapsedMs + (sequence.startedAt === null ? 0 : Math.max(0, serverNow - sequence.startedAt)) : 0;
  const remaining = segment ? segment.durationSeconds + (sequence?.addedSeconds ?? 0) - elapsed / 1000 : 0;
  const overtime = (sequence?.status === 'running' || sequence?.status === 'paused') && remaining <= 0;
  const warning = sequence?.status === 'running' && remaining > 0 && remaining <= 30;
  const tone: CallTimerTone = !sequence ? 'ready' : sequence.status === 'finished' ? 'finished' : overtime ? 'overtime' : sequence.status === 'paused' ? 'paused' : warning ? 'warning' : sequence.status;
  const status = !sequence || sequence.status === 'ready' ? 'Ready' : sequence.status === 'finished' ? 'Sequence finished' : sequence.status === 'paused' ? overtime ? 'Paused · over time' : 'Paused' : overtime ? 'Time is up · over time' : warning ? '30 seconds or less left' : 'Running';
  const time = !sequence ? 'Timer' : sequence.status === 'finished' ? 'Done' : `${overtime ? '+' : ''}${timerDuration(Math.abs(remaining))}`;
  const next = sequence?.segments[sequence.activeIndex + 1];
  // Own and dispose only the display repaint; backgrounding never pauses the anchored sequence.
  useEffect(() => {
    if (sequence?.status !== 'running') return;
    const timer = setInterval(() => paint((n) => n + 1), 1000);
    const visible = () => paint((n) => n + 1);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [sequence?.status]);
  useEffect(() => {
    const changed = () => setCue(readCue());
    addEventListener('storage', changed);
    addEventListener('alcove-timer-cue', changed);
    return () => { removeEventListener('storage', changed); removeEventListener('alcove-timer-cue', changed); };
  }, []);
  useEffect(() => () => stopSounds(owner.current), [state.callId, connected, cue, sound.prefs]);
  const previous = useRef<{ callId: string; segmentId: string; remaining: number; at: number } | null>(null);
  useEffect(() => {
    const before = previous.current;
    const now = performance.now();
    previous.current = connected && sequence?.status === 'running' && segment ? { callId: state.callId, segmentId: segment.id, remaining, at: now } : null;
    if (!live.current.allowed || !segment || !sequence || !before || before.callId !== state.callId || before.segmentId !== segment.id || now - before.at > 5000 || before.remaining <= 0 || remaining > 0) return;
    playSound({ owner: owner.current, cue: 'timer', key: `presenter-timer:${state.callId}:${segment.id}:${sequence.startedAt}`, until: Date.now() + 1000, current: () => ({ prefs: { ...live.current.prefs, enabled: live.current.prefs.enabled && live.current.allowed }, speakerId: live.current.speakerId }) });
  }, [state.callId, sequence, segment, remaining, connected]);
  const changeCue = (on: boolean) => {
    setCue(on);
    try { localStorage.setItem(KEY, JSON.stringify(on)); dispatchEvent(new Event('alcove-timer-cue')); }
    catch (err) { tlog.debug('timer cue choice kept in this tab', { err }); }
  };
  const me = state.participants.find((p) => p.isMe);
  const mine = Boolean(segment?.presenter && me && [me.person.name, me.person.email].some((name) => name.trim().toLocaleLowerCase() === segment.presenter?.trim().toLocaleLowerCase()));
  return { sequence, segment, next, remaining, time, tone, status, mine, warning, overtime, cue, changeCue };
}
export type PresenterTimer = ReturnType<typeof usePresenterTimer>;
