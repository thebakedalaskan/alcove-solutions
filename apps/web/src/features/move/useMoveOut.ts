/*
 * The device the call is on, moving it to another one: the sheet's move while it's open, and letting go here once
 * the new device is ready. Letting go is the call screen's (`letGo`: the last notes audio is sent, then the
 * microphone and camera stop and this device leaves the room); only then does it confirm, so the new device's
 * microphone never comes on while this one's is still live.
 */
import type { CallMoveOut, CallSession, LiveStore, MoveDevice, MoveMedia, MoveOutState, MoveProblem } from '@alcove/api';
import { errorMessage, errorRequestId } from '@alcove/api';
import { useEffect, useRef, useState } from 'react';
import { useLive } from '~/lib/live';
import { log } from '~/lib/log';

const mlog = log.child({ component: 'move' });
const IDLE: LiveStore<MoveOutState | null> = { getSnapshot: () => null, subscribe: () => () => undefined };

export interface MoveOutControl {
  open: boolean;
  move: CallMoveOut | null;
  /** Set once this device has moved, or let go and the move didn't finish. */
  moved: { to: MoveDevice | null; problem: MoveProblem | null } | null;
  show(): void;
  /** Closes the sheet: a move that hasn't happened is called off, and this device stays in the call. */
  hide(): void;
  /** Lets go here and moves to the device that's ready. */
  go(): Promise<void>;
  /** A fresh code after the last ran out or was called off. */
  again(): void;
}

export function useMoveOut(session: CallSession, media: () => MoveMedia, letGo: () => Promise<void>): MoveOutControl {
  const [open, setOpen] = useState(false);
  const [move, setMove] = useState<CallMoveOut | null>(null);
  const [moved, setMoved] = useState<MoveOutControl['moved']>(null);
  const going = useRef(false);
  const latest = useRef({ media, letGo });
  latest.current = { media, letGo };

  // A code as the sheet opens; the move is called off if the sheet goes before it's used.
  useEffect(() => {
    if (!open || move) return;
    let alive = true;
    void session.startMove(latest.current.media()).then((m) => { if (alive) setMove(m); else m.close(); });
    return () => { alive = false; };
  }, [open, move, session]);
  useEffect(() => () => { if (!going.current) move?.close(); }, [move]);

  const go = async () => {
    if (!move || going.current) return;
    going.current = true;
    const was = latest.current.media();
    mlog.info('letting go to move', { mic: was.mic, cam: was.cam });
    await latest.current.letGo();
    try {
      await move.confirm(was);
      setMoved({ to: move.getSnapshot().device, problem: null });
    } catch (e) {
      // This device has let go, so it says so, and how to get back in.
      setMoved({ to: move.getSnapshot().device, problem: { message: errorMessage(e), requestId: errorRequestId(e) ?? null } });
    }
    setOpen(false);
  };
  const goRef = useRef(go);
  goRef.current = go;

  // Signed in to the same account on the new device: nothing to ask here, so this device lets go by itself.
  const store: LiveStore<MoveOutState | null> = move ?? IDLE;
  const s = useLive(store);
  useEffect(() => { if (s?.stage === 'ready' && s.sameAccount) void goRef.current(); }, [s?.stage, s?.sameAccount]);

  return {
    open, move, moved,
    show: () => setOpen(true),
    hide: () => { if (going.current) return; move?.close(); setMove(null); setOpen(false); },
    go,
    again: () => { void move?.renew(); }
  };
}
