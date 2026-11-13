/*
 * Presenting the workspace, as this browser has it (docs: Calls and recordings › Presenting). The call says what's presented in
 * the part of it you're in (`CallWorkspace.present`), the same for everyone who can open it; where its presenter is comes from
 * the workspace's presence, and so does who follows them, which each follower says and only the presenter is told. Everyone
 * who has it on their stage follows the presenter with the workspace's own Follow (features/workspace/follow.ts): to their page
 * and their line, from the moment they're somewhere to follow. Unfollow, following someone else, or going anywhere, a click, a
 * scroll or a key in it, and you work on your own (onStage.ts `own`), whether or not they'd been anywhere yet; Follow brings
 * you back. Unfollowing takes you back to where you were before you followed. Their going quiet for a moment, as a reload does,
 * isn't you going your own way: you follow on when they're back.
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
  /** You went your own way in the workspace (`WorkspaceCall.onOwn`): while you follow whoever presents it, you're on your own now. */
  ownWay: () => void;
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
  /** You work on your own in it from now: the stage stops following its presenter (onStage.ts `own`). */
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
   * Following: the workspace follows the presenter through presence, asked whenever they're somewhere to follow and it isn't
   * already. Anything of your own (`ownWay`), or following someone else, is you working on your own where you are, rather
   * than going back to where you were.
   */
  const want = watching && following && connection !== null;
  const followable = connection !== null && together.followable.includes(connection);
  /*
   * Whom the workspace follows, by their seat, which a reconnection keeps: while the presenter reloads, their old connection and
   * their new one are both them. Someone the call doesn't know yet isn't taken for someone else.
   */
  const followedSeat = together.following === null ? null : participants.find((p) => p.id === together.following)?.seat ?? null;
  const followingThem = together.following !== null && (together.following === connection || (by !== null && followedSeat === by.seat));
  const followingOther = together.following !== null && !followingThem && followedSeat !== null;
  /* Where you were before following, so Unfollow takes you back there. */
  const before = useRef<WorkspacePlace | null>(null);
  const atNow = useRef(at);
  atNow.current = at;
  const latest = useRef({ act, onOwn, access, want });
  latest.current = { act, onOwn, access, want };
  const ownWay = useCallback(() => {
    if (!latest.current.want) return;
    before.current = null;
    latest.current.onOwn();
  }, []);
  /*
   * Following them starts (they present, or you press Follow): they take over from whoever you followed. Once it's going,
   * choosing someone else is your own way.
   */
  const was = useRef<{ want: boolean; connection: string | null; following: string | null }>({ want: false, connection: null, following: null });
  useEffect(() => {
    const prev = was.current;
    was.current = { want, connection, following: together.following };
    if (!want || !connection) return;
    const starting = !prev.want || prev.connection !== connection;
    if (!starting && followingOther && prev.following !== together.following) { ownWay(); return; }
    if (!followingThem && followable) latest.current.act.follow(connection);
  }, [want, connection, followable, followingThem, followingOther, together.following, ownWay]);

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
   * it did because its presenter left. Everyone else hears how it ended from their stage (layout/onStage.ts). While the call's
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
  return useMemo(() => ({ connection, where, start, stop, ownWay }), [connection, where, start, stop, ownWay]);
}
