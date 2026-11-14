/**
 * Nudges you got, each said once as a quiet toast on your side of the call: when more people send the same one, its toast says
 * so again with the new count, in place of the last. Notes already there when the call opens here (a reload, say) aren't said
 * again. "You're muted" offers Unmute while you are, and pressing it later does nothing once you aren't (`unmute` is null then).
 */
import type { CallState } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import { NUDGES, nudgeSaid } from './nudges';

export function useNudgeAlerts({ state, ready, unmute }: { state: CallState; ready: boolean; unmute: (() => void) | null }): void {
  const toast = useToast();
  /** How many people each note had when it was last said, by its ID. Null until the first snapshot this browser can trust. */
  const said = useRef<Map<string, number> | null>(null);
  const latest = useRef(unmute);
  latest.current = unmute;
  const notes = state.attention.nudges;
  useEffect(() => {
    if (!ready) return;
    const known = said.current;
    if (!known) { said.current = new Map(notes.map((n) => [n.id, n.count])); return; }
    for (const n of notes) {
      if ((known.get(n.id) ?? 0) >= n.count) continue;
      known.set(n.id, n.count);
      const muted = n.kind === 'muted' && latest.current !== null;
      toast(nudgeSaid(n), { icon: NUDGES[n.kind].icon, topic: `nudge:${n.id}`, ms: 6000, ...(muted ? { action: { label: 'Unmute', onClick: () => latest.current?.() } } : {}) });
    }
  }, [notes, ready, toast]);
}
