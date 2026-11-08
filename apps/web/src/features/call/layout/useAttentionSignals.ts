import type { CallAttention } from '@alcove/api';
import { useEffect, useRef, useState } from 'react';

/** A server-clock projection of temporary feedback. The LiveStore remains the only source of call data. */
export function useAttentionSignals(attention: CallAttention) {
  const clock = useRef({ source: attention, received: performance.now() });
  if (clock.current.source !== attention) clock.current = { source: attention, received: performance.now() };
  const [tick, setTick] = useState(0);
  const now = Date.parse(attention.serverNow) + Math.max(0, performance.now() - clock.current.received);
  const active = attention.signals.filter((s) => Date.parse(s.expiresAt) > now);
  const next = active.reduce<number | null>((at, s) => { const expires = Date.parse(s.expiresAt); return at === null || expires < at ? expires : at; }, null);
  // Own only the nearest expiry wake-up, disposed on a new snapshot, expiry or unmount.
  useEffect(() => {
    if (next === null) return;
    const serverNow = Date.parse(attention.serverNow) + Math.max(0, performance.now() - clock.current.received);
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(1, next - serverNow + 1));
    return () => clearTimeout(timer);
  }, [attention, next, tick]);
  return active;
}
