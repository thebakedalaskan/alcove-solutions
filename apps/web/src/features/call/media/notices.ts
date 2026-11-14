/*
 * What happens to your microphone and camera without you pressing anything, said once, as it happens: the organizer muting
 * your microphone, and a device unplugged, back, or allowed again.
 */
import type { useToast } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import type { DeviceChange } from './media';

export function useMediaNotices({ hostMuted, changes, toast }: {
  /** How many times the organizer has muted this browser's microphone (RoomView.hostMuted). */
  hostMuted: number;
  /** The latest changes nobody pressed a button for (MediaSnapshot.changes). */
  changes: readonly DeviceChange[];
  toast: ReturnType<typeof useToast>;
}): void {
  /* The organizer muted your microphone: the dock already shows it off; say who did it. */
  const muted = useRef(0);
  useEffect(() => {
    if (hostMuted <= muted.current) return;
    muted.current = hostMuted;
    toast('The organizer muted your microphone. Unmute when you’re ready.', { icon: 'micOff', ms: 5000 });
  }, [hostMuted, toast]);
  /* A device unplugged, back, or allowed again: each change after the ones there were as the call opened. */
  const seenChange = useRef(changes.at(-1)?.n ?? 0);
  useEffect(() => {
    for (const c of changes) {
      if (c.n <= seenChange.current) continue;
      seenChange.current = c.n;
      toast(c.text, { icon: c.kind === 'mic' ? 'mic' : c.kind === 'cam' ? 'video' : 'speaker', ms: 6000 });
    }
  }, [changes, toast]);
}
