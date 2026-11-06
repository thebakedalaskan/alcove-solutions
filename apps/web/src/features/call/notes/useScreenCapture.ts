import type { CallSession, CallState } from '@alcove/api';
import { useEffect, useRef, useState } from 'react';
import { ScreenFrames } from './frames';

interface ScreenCaptureInput {
  session: CallSession;
  state: CallState;
  screen: MediaStream | null;
  myShare: string | null;
}

/** Sends screen-note frames only while capture permits it in the main room. */
export function useScreenCapture({ session, state, screen, myShare }: ScreenCaptureInput) {
  const self = session.ticket.identity;
  const live = state.phase === 'in-call';
  const [frameProblem, setFrameProblem] = useState<string | null>(null);
  /*
   * Your own shared screen, while screen notes are on: this browser looks at it and sends what changes to the notes
   * (features/call/notes/frames.ts). Paused, off, or in a breakout room, it stops at once and drops what wasn't sent; a share
   * that ends says so, so its last frame stops there in the notes.
   */
  const frames = useRef<ScreenFrames | null>(null);
  if (!frames.current) frames.current = new ScreenFrames((f) => session.shareFrame(f), (share) => session.shareEnded(share), setFrameProblem);
  const screensOn = state.capture.screen.mode === 'on';
  const sharingInRoom = !!state.breakouts.open?.rooms.some((r) => r.members.includes(self));
  useEffect(() => {
    const f = frames.current;
    if (!f) return;
    if (screen && myShare && screensOn && live && !sharingInRoom) f.start(screen, myShare);
    else f.stop();
  }, [screen, myShare, screensOn, live, sharingInRoom]);
  const lastShare = useRef<string | null>(null);
  useEffect(() => {
    const was = lastShare.current;
    lastShare.current = myShare;
    if (was && was !== myShare) frames.current?.end(was);
  }, [myShare]);
  useEffect(() => () => frames.current?.stop(), []);

  return { frameProblem, sharingInRoom, screensOn };
}
