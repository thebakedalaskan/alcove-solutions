import { errorMessage, type CallSession, type FeatureFlagName } from '@alcove/api';
import type { useToast } from '@alcove/ui';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { sessions, useLive, type useLeaveGuard } from '~/lib/live';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { ShareMarks } from '../screen-sharing/marks';
import { CallReactions } from '../layout/reactions';
import type { CallRoom, RoomView } from './livekit';
import type { LocalMedia } from './media';

const clog = log.child({ component: 'call' });
/** How long opening a call waits for its feature flags before treating them as off. */
const FLAGS_WAIT_MS = 1500;
/**
 * The feature flags a call's room follows, read once as it opens: what the lobby read as the call's media code came down,
 * or else the server's answer. Flags that can't be read, or take longer than FLAGS_WAIT_MS, are off for this call, so a
 * slow answer holds up joining by that at most; either is said in the log, and the room logs the flags it opened with.
 */
function roomFlags(queries: QueryClient): Promise<readonly FeatureFlagName[]> {
  return new Promise((resolve) => {
    const late = setTimeout(() => { clog.info('feature flags not read in time: the call opens without them', { waitMs: FLAGS_WAIT_MS }); resolve([]); }, FLAGS_WAIT_MS);
    void queries.ensureQueryData(q.featureFlags()).then((on) => { clearTimeout(late); resolve(on); }, (err: unknown) => {
      clearTimeout(late);
      clog.info('feature flags not read: the call opens without them', { err });
      resolve([]);
    });
  });
}

/** Before the room has connected: nobody's media yet. */
const NO_VIEW: RoomView = { connection: 'connecting', endReason: null, people: {}, hostMuted: 0, shareStopped: 0, audioBlocked: false, screenFailed: null };
const NO_ROOM: CallRoom = {
  getSnapshot: () => NO_VIEW, subscribe: () => () => undefined, attach: () => () => undefined, heard: () => [], playOnly: () => undefined, startAudio: async () => undefined,
  muteShare: () => undefined, send: () => undefined, receive: () => () => undefined, leave: async () => undefined
};
/**
 * One room connection per call session. React may mount the screen twice (StrictMode in dev); a second
 * connection under the same identity would push the first out of the room, so remounts share this one,
 * and it's left only once no screen uses it.
 */
const connections = new WeakMap<CallSession, { room: Promise<CallRoom>; users: number }>();
interface CallRoomInput {
  session: CallSession;
  media: LocalMedia;
  toast: ReturnType<typeof useToast>;
  guard: RefObject<ReturnType<typeof useLeaveGuard>>;
}

/** Owns one media-room connection and its share marks for this mounted call. */
export function useCallRoom({ session, media, toast, guard: guardRef }: CallRoomInput) {
  const self = session.ticket.identity;
  /* Media comes from pre-join; it starts here if the call page was opened directly. */
  const first = useRef({ mic: media.getSnapshot().mic, cam: media.getSnapshot().cam });
  useEffect(() => {
    sessions.media = media;
    // In the call nothing turns the microphone or camera on by itself: only their buttons do.
    media.setInCall(true);
    if (!media.started) void media.start(first.current);
  }, [media]);

  /* The call's media goes through its LiveKit room (loaded only here); leaving the screen leaves the room. */
  const [room, setRoom] = useState<CallRoom>(NO_ROOM);
  const roomView = useLive(room);
  const queries = useQueryClient();
  useEffect(() => {
    let gone = false;
    let entry = connections.get(session);
    if (!entry) {
      entry = { room: Promise.all([import('~/features/call/media/livekit'), roomFlags(queries)]).then(([{ openRoom }, on]) => openRoom(session, media, new Set(on))), users: 0 };
      connections.set(session, entry);
    }
    const e = entry;
    e.users++;
    e.room.then((r) => { if (!gone) setRoom(r); }, (err: unknown) => {
      connections.delete(session);
      if (gone) return;
      clog.error('could not join the call’s room', { err });
      toast(errorMessage(err), { icon: 'x', ms: 120_000, action: { label: 'Reload', onClick: () => { guardRef.current.release(); location.reload(); } } });
    });
    return () => {
      gone = true;
      e.users--;
      // A remount comes straight back; only a screen that's really gone leaves the room.
      setTimeout(() => {
        if (e.users > 0 || connections.get(session) !== e) return;
        connections.delete(session);
        void e.room.then((r) => r.leave(), () => undefined);
      }, 0);
    };
  }, [session, media, toast, queries]);
  /* Pointers and marks on what's shared: kept in this browser only, sent and taken through the room, encrypted end to end. */
  const [marks, setMarks] = useState<ShareMarks | null>(null);
  useEffect(() => {
    if (room === NO_ROOM) return;
    const m = new ShareMarks(room, self);
    setMarks(m);
    return () => { m.dispose(); setMarks(null); };
  }, [room, self]);
  /* Reactions floating up over the call: the same, and gone in a couple of seconds. */
  const [reactions, setReactions] = useState<CallReactions | null>(null);
  useEffect(() => {
    if (room === NO_ROOM) return;
    const r = new CallReactions(room);
    setReactions(r);
    return () => { r.dispose(); setReactions(null); };
  }, [room]);

  return { room, roomView, marks, reactions };
}
