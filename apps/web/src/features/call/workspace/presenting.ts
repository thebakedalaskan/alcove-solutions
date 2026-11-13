/*
 * Presenting the workspace, as this browser has it (docs: Calls and recordings › Presenting). The call says what's presented in
 * the part of it you're in (`CallWorkspace.present`), the same for everyone who can open it; where its presenter is comes from
 * the workspace's presence, so nothing new goes to the server. Everyone who has it on their stage follows the presenter with
 * the workspace's own Follow (features/workspace/follow.ts): to their page and their line. Unfollow, or a click, a scroll or a
 * key in it, and you work on your own (onStage.ts `own`); Follow brings you back. Unfollowing takes you back to where you were
 * before you followed.
 *
 * Someone who can't open the workspace is told who's presenting, and nothing else.
 */
import { errorCode, firstName, type CallParticipant, type CallPresent, type CallPresentEnded, type CallSession } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CallTogether, WorkspacePlace } from '~/features/workspace/context';
import type { StopFollowing } from '~/features/workspace/follow';
import { log } from '~/lib/log';

const plog = log.child({ component: 'presenting' });

/** The workspace presented where you are, and what you're doing about it. */
export interface WorkspacePresentation {
  /** Whoever presents it, by their connection, which presence knows them by. */
  connection: string | null;
  /** Where its presenter is, in words, for Follow on the frame's bar: what's named is only ever what you can open. Null while that isn't known here. */
  where: string | null;
  /** Presents the workspace to everyone in this part of the call. */
  start: () => Promise<void>;
  /** Ends it: for you (everyone following keeps it open, on their own), or for everyone. */
  stop: (close: boolean) => Promise<void>;
}

export function useWorkspacePresenting({ session, present, ended, participants, onStage, following, together, at, act, say, failed, onOwn, access }: {
  session: CallSession;
  present: CallPresent | null;
  /** How the last presentation here ended, as the call says. */
  ended: CallPresentEnded | null;
  participants: readonly CallParticipant[];
  /** The presented workspace is on your stage and in sight. */
  onStage: boolean;
  /** You follow whoever presents it, rather than work on your own. */
  following: boolean;
  /** What the workspace says of who's where, and who you follow. */
  together: CallTogether;
  /** Where your own page is now. */
  at: WorkspacePlace;
  act: { follow: (connection: string) => void; stopFollowing: (how?: StopFollowing) => void; go: (to: WorkspacePlace) => void };
  say: (toast: WsToastData) => void;
  failed: (e: unknown) => void;
  /** You stopped following it from inside the workspace: a click, a scroll, a key or Escape. */
  onOwn: () => void;
  /** The call's board is one you can't open, brought by someone here you can ask for it, as its frame asks: read as it's presented. */
  access: () => { who: string; onAsk: () => void } | null;
}): WorkspacePresentation {
  const ws = present?.kind === 'workspace' ? present : null;
  const by = ws?.by ?? present?.by ?? null;
  const presenterIn = by ? participants.find((p) => p.seat === by.seat) ?? null : null;
  const connection = presenterIn && !presenterIn.isMe ? presenterIn.id : null;
  const mine = ws?.mine === true;
  const watching = ws !== null && !mine && onStage;

  /*
   * Following: the workspace follows the presenter through presence. It's asked once the workspace knows they're there, and
   * once it's following, its stopping (a click, a scroll, a key, Escape) is you working on your own.
   */
  const want = watching && following && connection !== null;
  const engaged = useRef(false);
  const followable = connection !== null && together.followable.includes(connection);
  const followingThem = connection !== null && together.following === connection;
  const latest = useRef({ act, onOwn, access });
  latest.current = { act, onOwn, access };
  useEffect(() => {
    if (!want || !connection) { engaged.current = false; return; }
    if (followingThem) { engaged.current = true; return; }
    // A click, a scroll, a key or Escape in it: you work on your own where you are, rather than go back to where you were.
    if (engaged.current) { engaged.current = false; before.current = null; latest.current.onOwn(); return; }
    if (followable) latest.current.act.follow(connection);
  }, [want, connection, followable, followingThem]);

  /* Where you were before following, so Unfollow takes you back there. */
  const before = useRef<WorkspacePlace | null>(null);
  const atNow = useRef(at);
  atNow.current = at;
  const wasWant = useRef(want);
  useEffect(() => {
    const was = wasWant.current;
    wasWant.current = want;
    if (want && !was) before.current = atNow.current;
    if (!want && was) {
      if (followingThem) latest.current.act.stopFollowing('quiet');
      // Unfollowed, still on your stage: back where you were. Ended, closed or put away: you stay where you are.
      const back = before.current;
      before.current = null;
      if (watching && !following && back) latest.current.act.go(back);
    }
  }, [want]);

  /*
   * Someone who can't open what's presented is told who's presenting, and nothing else, and that it ended only if the call says
   * it did because its presenter left. Everyone else hears how it ended from their stage (stage/onStage.ts). While the call's
   * board is one they can't open, brought by someone here, the toast asks for it, as the board's own frame does.
   */
  const toldOf = useRef<string | null>(null);
  useEffect(() => {
    if (!present) return;
    if (present.kind !== null || present.key === toldOf.current) return;
    toldOf.current = present.key;
    say(wsToast.presentingPrivate(firstName(present.by.name), latest.current.access() ?? undefined));
  }, [present, say]);
  const endedKey = ended && ended.key === toldOf.current ? ended.key : null;
  useEffect(() => {
    if (!endedKey || !ended || ended.close) return;
    toldOf.current = null;
    if (!participants.some((p) => p.seat === ended.by.seat)) say(wsToast.presenterLeft(firstName(ended.by.name)));
    // An end is read once, as it comes: `endedKey` says which.
  }, [endedKey]);

  const start = useCallback(async () => {
    try {
      await session.startPresenting({ kind: 'workspace' });
      say(wsToast.workspaceOn());
    } catch (e) {
      plog.info('presenting the workspace didn’t start', { code: errorCode(e) });
      failed(e);
      throw e;
    }
  }, [session, say, failed]);
  const stop = useCallback(async (close: boolean) => {
    try {
      await session.stopPresenting(close);
    } catch (e) {
      plog.info('presenting didn’t stop', { code: errorCode(e), close });
      failed(e);
      throw e;
    }
  }, [session, failed]);
  const where = connection ? together.where[connection] ?? null : null;
  return useMemo(() => ({ connection, where, start, stop }), [connection, where, start, stop]);
}
