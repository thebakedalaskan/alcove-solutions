/*
 * The vote on the board open in a call, for `<BoardSurface run>`: the vote from the call's state, and what the bar's Vote does.
 * The board knows nothing of the call, so this is where they meet. The call's one countdown is the call's own (useCallTimer.ts).
 * A vote reaches everyone in that part of the call who can open the board: anyone without the board on their stage is told one
 * started, with Vote, which opens it there (`useVoteStarted`).
 */
import { firstName, type CallSession, type CallState } from '@alcove/api';
import { useEffect, useMemo, useRef } from 'react';
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

/**
 * Tells someone a vote started on the board in their part of the call while that board isn't on their stage, and by whom: "Priya
 * started a vote on Launch retro.", with Vote, which opens the board there, on the vote's frame (`join`). Only the call tells them,
 * and only someone who can open the board is told of a vote. A vote that's on as they join, or as they arrive in another part of
 * the call, was already under way, so it says nothing; nor is whoever started it told.
 */
export function useVoteStarted({ state, me, place, settled, onStage, say, join }: {
  state: CallState;
  me: string;
  /** The part of the call this person is in. */
  place: string;
  /** The call has settled since joining or reconnecting: a vote that's on now started now. */
  settled: () => boolean;
  /** The board in the call is on their stage, where the vote's pill says it. */
  onStage: boolean;
  say: (text: string, onVote: () => void) => void;
  /** Opens the board in the call on their stage, on the vote's frame (null: every sticky). */
  join: (frame: string | null) => void;
}): void {
  const vote = state.board.vote;
  const on = vote?.on === true;
  const seen = useRef<{ on: boolean; place: string } | null>(null);
  const latest = useRef({ state, me, settled, onStage, say, join });
  latest.current = { state, me, settled, onStage, say, join };
  useEffect(() => {
    const was = seen.current;
    seen.current = { on, place };
    if (!was || was.place !== place || was.on || !on || !latest.current.settled()) return;
    const now = latest.current;
    const started = now.state.board.vote;
    if (!started || now.onStage || started.startedBy === now.me) return;
    const by = now.state.participants.find((p) => p.id === started.startedBy);
    const board = now.state.board.open?.name ?? 'the board';
    const frame = started.frame;
    now.say(by ? `${firstName(by.person.name)} started a vote on ${board}.` : `A vote started on ${board}.`, () => latest.current.join(frame));
  }, [on, place]);
}
