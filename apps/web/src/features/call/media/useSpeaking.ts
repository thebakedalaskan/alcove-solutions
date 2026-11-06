import { useEffect, useState } from 'react';
import type { LocalMedia } from './media';

/** Whether you're talking now, from the real microphone level. */
export function useSpeaking(media: LocalMedia, on: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!on) { setSpeaking(false); return; }
    const t = setInterval(() => setSpeaking(media.level() > 0.09), 160);
    return () => clearInterval(t);
  }, [media, on]);
  return speaking;
}
