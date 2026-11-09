/*
 * The session on the board open in a call, for `<BoardSurface run>`: its timer and vote from the call's state, what the bar's
 * Timer and Vote do, and the chime as a timer runs out. The board knows nothing of the call, so this is where they meet.
 *
 * The chime is the call's, not the board's: it sounds wherever the board is, hidden to a tile or not. It plays once in this
 * browser, in whichever tab gets there first, through the speaker the call plays through where a page can choose one, and
 * as everything a tab plays does, it's silent in a tab someone has muted. A timer that ran out before this browser saw it
 * running, as for someone who joins late, makes no sound.
 */
import type { CallSession, CallState } from '@alcove/api';
import { useEffect, useMemo, useRef } from 'react';
import type { BoardRun, RunTimer, RunVote } from '~/features/board/tools/run';
import { playSound, stopSounds } from '~/lib/audio-output';
import { useSoundPreferences } from '~/lib/sound-preferences';

/**
 * When the timer runs out, on this browser's clock. The call says it in seconds since the call started, and `elapsed` is that
 * count as this browser has it, so they're the same moment whatever its clock says. It's worked out once for each timer, from
 * the snapshot that brought it: `elapsed` only ticks on from there.
 */
function useEndsAt(until: number | null, elapsed: number): number | null {
  const seen = useRef<{ until: number; endsAt: number } | null>(null);
  if (until === null) return null;
  if (seen.current?.until !== until) seen.current = { until, endsAt: Date.now() + (until - elapsed) * 1000 };
  return seen.current.endsAt;
}

/** The same value as last time while it holds the same, so the board draws again only when its timer or vote changes, not on every read of the call. */
function useSame<T>(value: T): T {
  const kept = useRef(value);
  if (JSON.stringify(kept.current) !== JSON.stringify(value)) kept.current = value;
  return kept.current;
}

/** Chimes as the timer runs out, if this browser saw it running. */
function useChime(endsAt: number | null, key: string, speakerId: string | null): void {
  const { prefs, ready } = useSoundPreferences();
  const owner = useRef({});
  const current = useRef({ prefs, speakerId });
  const available = useRef(ready);
  available.current = ready;
  current.current = { prefs, speakerId };
  useEffect(() => () => stopSounds(owner.current), [prefs]);
  useEffect(() => {
    if (endsAt === null) return undefined;
    const ms = endsAt - Date.now();
    if (ms <= 0) return undefined;
    const at = setTimeout(() => { if (!available.current) return; playSound({ owner: owner.current, cue: 'timer', key: `timer:${key}`, until: Date.now() + 1200, current: () => current.current }); }, ms);
    return () => { clearTimeout(at); stopSounds(owner.current); };
  }, [endsAt, key]);
}

/**
 * The run for the board open where this person is in the call, or nothing while there's no board they can open. `speakerId`
 * is where the call plays (`LocalMedia`'s), for the chime.
 */
export function useBoardRun(call: CallSession, state: CallState, speakerId: string | null): BoardRun | undefined {
  const { open, timer, vote } = state.board;
  const endsAt = useEndsAt(timer?.until ?? null, state.elapsed);
  useChime(endsAt, `${state.callId}:${timer?.until ?? ''}`, speakerId);
  const runTimer = useSame<RunTimer | null>(timer && endsAt !== null ? { endsAt, minutes: Math.round(timer.length / 60), text: timer.text, canStop: timer.canStop } : null);
  const runVote = useSame<RunVote | null>(vote && { on: vote.on, frame: vote.frame, per: vote.per, mine: vote.mine, results: vote.results, voters: vote.voters, canEnd: vote.canEnd });
  const canOpen = open !== null && open.role !== null;
  return useMemo(() => (canOpen ? {
    timer: runTimer,
    vote: runVote,
    startTimer: (minutes) => call.startTimer(minutes),
    stopTimer: () => call.stopTimer(),
    startVote: (frame, per) => call.startVote(frame, per),
    castVote: (sticky) => call.castVote(sticky),
    takeBackVote: (sticky) => call.takeBackVote(sticky),
    endVote: () => call.endVote(),
    clearVote: () => call.clearVote()
  } : undefined), [call, canOpen, runTimer, runVote]);
}
