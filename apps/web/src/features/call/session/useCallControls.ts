import { errorMessage, type CallSession } from '@alcove/api';
import { useEffect, useRef, useState } from 'react';
import { troubles } from '../media/access';
import type { LocalMedia } from '../media/media';

type Device = 'mic' | 'cam';
type Place = 'call' | 'floating';

/** One pending action and confirmed result per control, shared by the full call and its floating presentation. */
export function useCallControls({ session, media, enabled, problem, failed, handChanged }: {
  session: CallSession;
  media: LocalMedia;
  enabled: () => boolean;
  problem: (device: Device) => void;
  failed: (message: string) => void;
  handChanged: (up: boolean) => void;
}) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const busy = useRef({ mic: false, cam: false, hand: false });
  const [pending, setPending] = useState({ mic: false, cam: false, hand: false });
  const [error, setError] = useState<string | null>(null);
  const mark = (kind: Device | 'hand', on: boolean) => {
    busy.current[kind] = on;
    if (alive.current) setPending((p) => ({ ...p, [kind]: on }));
  };
  const sayError = (message: string, place: Place) => {
    if (!alive.current) return;
    setError(message);
    if (place === 'call') failed(message);
  };
  const device = async (kind: Device, place: Place) => {
    if (busy.current[kind] || !enabled()) return;
    mark(kind, true);
    setError(null);
    try {
      const m = media.getSnapshot();
      const ok = await (kind === 'mic' ? media.setMic(!m.mic) : media.setCam(!m.cam));
      if (!ok && alive.current) {
        const trouble = troubles(media.getSnapshot(), [kind])[0];
        const message = trouble ? [trouble.title, trouble.how].filter(Boolean).join(' ') : `Your ${kind === 'mic' ? 'microphone' : 'camera'} didn’t start. Try again.`;
        sayError(message, place);
        if (place === 'call') problem(kind);
      }
    } catch (e) { sayError(errorMessage(e), place); }
    finally { mark(kind, false); }
  };
  const hand = async (up: boolean, place: Place = 'call') => {
    if (busy.current.hand || !enabled()) return;
    mark('hand', true);
    setError(null);
    try {
      await session.setHand(up);
      if (alive.current && place === 'call') handChanged(up);
    } catch (e) { sayError(errorMessage(e), place); }
    finally { mark('hand', false); }
  };
  return {
    pending, error, setError,
    mic: (place: Place = 'call') => { void device('mic', place); },
    cam: (place: Place = 'call') => { void device('cam', place); },
    hand: (up: boolean, place: Place = 'call') => { void hand(up, place); }
  };
}
