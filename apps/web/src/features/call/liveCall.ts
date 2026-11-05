/*
 * What the call's screen gives the workspace of its notes, follow-ups and transcript (features/workspace/live), and what the
 * side panels get back: where their arrows send things. The screen renders far more often than any of this changes, so what
 * the workspace holds is one object for the whole call, and it reads what changes from the session.
 */
import type { CallSession, LiveStore, Person } from '@alcove/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveBeside, LiveCall, LivePut } from '~/features/workspace/live/types';

/** Who's talking, for whatever shows it, without the call's screen drawing anything for it. */
class Speaking implements LiveStore<Person | null> {
  private who: Person | null = null;
  private readonly listeners = new Set<() => void>();
  getSnapshot = () => this.who;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(who: Person | null) {
    if (who?.id === this.who?.id) return;
    this.who = who;
    for (const l of this.listeners) l();
  }
}

export interface LiveCallActions { notes: (on: boolean) => void; ask: (up: boolean) => void; beside: (view: LiveBeside) => void; reveal: () => void }

export function useLiveCall(session: CallSession, talking: Person | null, actions: LiveCallActions): { live: LiveCall; put: LivePut | null } {
  const [put, setPut] = useState<LivePut | null>(null);
  const [speaking] = useState(() => new Speaking());
  useEffect(() => { speaking.set(talking); }, [speaking, talking]);
  const latest = useRef(actions);
  latest.current = actions;
  const live = useMemo((): LiveCall => ({
    session, speaking, onPut: setPut,
    notes: (on) => latest.current.notes(on),
    ask: (up) => latest.current.ask(up),
    beside: (view) => latest.current.beside(view),
    reveal: () => latest.current.reveal()
  }), [session, speaking]);
  return { live, put };
}
