import { errorMessage, type CallSession } from '@alcove/api';
import type { useToast } from '@alcove/ui';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { sessions, useLive, type useLeaveGuard } from '~/lib/live';
import { log } from '~/lib/log';
import { ShareMarks } from '../screen-sharing/marks';
import type { CallRoom, RoomView } from './livekit';
import type { LocalMedia } from './media';

const clog = log.child({ component: 'call' });

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
  useEffect(() => {
    let gone = false;
    let entry = connections.get(session);
    if (!entry) {
      entry = { room: import('~/features/call/media/livekit').then(({ openRoom }) => openRoom(session, media)), users: 0 };
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
  }, [session, media, toast]);
  /* Pointers and marks on what's shared: kept in this browser only, sent and taken through the room, encrypted end to end. */
  const [marks, setMarks] = useState<ShareMarks | null>(null);
  useEffect(() => {
    if (room === NO_ROOM) return;
    const m = new ShareMarks(room, self);
    setMarks(m);
    return () => { m.dispose(); setMarks(null); };
  }, [room, self]);

  return { room, roomView, marks };
}
