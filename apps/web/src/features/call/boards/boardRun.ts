/*
 * The vote on the board open in a call, for `<BoardSurface run>`: the vote from the call's state, and what the bar's Vote does.
 * The board knows nothing of the call, so this is where they meet. The call's one countdown is the call's own (useCallTimer.ts).
 */
import type { CallSession, CallState } from '@alcove/api';
import { useMemo, useRef } from 'react';
import type { BoardRun, RunVote } from '~/features/board/tools/run';

/** The same value as last time while it holds the same, so the board draws again only when its vote changes, not on every read of the call. */
function useSame<T>(value: T): T {
  const kept = useRef(value);
  if (JSON.stringify(kept.current) !== JSON.stringify(value)) kept.current = value;
  return kept.current;
}

/** The run for the board open where this person is in the call, or nothing while there's no board they can open. */
export function useBoardRun(call: CallSession, state: CallState): BoardRun | undefined {
  const { open, vote } = state.board;
  const runVote = useSame<RunVote | null>(vote && { on: vote.on, frame: vote.frame, per: vote.per, mine: vote.mine, results: vote.results, voters: vote.voters, canEnd: vote.canEnd });
  const canOpen = open !== null && open.role !== null;
  return useMemo(() => (canOpen ? {
    vote: runVote,
    startVote: (frame, per) => call.startVote(frame, per),
    castVote: (sticky) => call.castVote(sticky),
    takeBackVote: (sticky) => call.takeBackVote(sticky),
    endVote: () => call.endVote(),
    clearVote: () => call.clearVote()
  } : undefined), [call, canOpen, runVote]);
}
