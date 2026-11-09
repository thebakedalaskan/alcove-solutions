/*
 * Someone's status in the call (Be right back, Listening only, On my phone): what each is called and drawn with, how it reads on
 * a tile and in People ("Be right back · 14:37"), and the call's own clock, which says when one has run out. Only whoever set it
 * changes it, from their own tile's menu; it goes when its time runs out, when they talk, or when they say they're back.
 */
import { CallStatusKindSchema, type CallState, type CallStatus, type CallStatusKind, type CallStatusMinutes } from '@alcove/api';
import type { IconName, TileStatus } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { hm } from '~/lib/time';
import { useTalking } from '../media/useSpeaking';

export const STATUS: Readonly<Record<CallStatusKind, { icon: IconName; label: string }>> = {
  away: { icon: 'away', label: 'Be right back' },
  listening: { icon: 'listening', label: 'Listening only' },
  phone: { icon: 'phone', label: 'On my phone' }
};
export const STATUS_KINDS: readonly CallStatusKind[] = CallStatusKindSchema.options;
/** Back in 2, 5 or 10 minutes. */
export const STATUS_MINUTES: readonly CallStatusMinutes[] = [2, 5, 10];

/** The call's clock as this browser reads it: the server's time now, and how far ahead of this browser's clock it is (ms). */
export interface CallClock { now: number; skew: number }

/** A status that hasn't run out by `now`, on the call's clock. */
export const statusNow = (s: CallStatus | null, now: number): CallStatus | null => (s && (s.until === null || Date.parse(s.until) > now) ? s : null);

/** How a status reads: "Be right back · 14:37", or "Listening only" with no time set. */
export const statusText = (s: CallStatus): string => `${STATUS[s.kind].label}${s.until ? ` · ${hm(s.until)}` : ''}`;

/** The time chosen for a status, in minutes, while it's one of the menu's. */
export function statusMinutes(s: CallStatus | null): CallStatusMinutes | null {
  if (!s?.until) return null;
  const minutes = Math.round((Date.parse(s.until) - Date.parse(s.since)) / 60_000);
  return STATUS_MINUTES.find((m) => m === minutes) ?? null;
}

/** A status as a tile shows it, with its time on this browser's clock for the line that counts it down; null once it's run out. */
export function tileStatus(s: CallStatus | null, clock: CallClock): TileStatus | null {
  const live = statusNow(s, clock.now);
  if (!live) return null;
  const until = live.until ? Date.parse(live.until) - clock.skew : null;
  return {
    icon: STATUS[live.kind].icon, text: statusText(live), short: live.until ? hm(live.until) : STATUS[live.kind].label, away: live.kind === 'away',
    time: until === null ? null : { since: Date.parse(live.since) - clock.skew, until }
  };
}

/**
 * The call's clock, from the server's time on the latest snapshot: the one anchor for everything that counts time in the call
 * (statuses here, the call's timer in `useCallTimer`). It reads again once the nearest status runs out, so a status leaves every
 * tile and People as its time does, without waiting for the call to be read again.
 */
export function useCallClock(state: CallState): CallClock {
  const at = useRef({ serverNow: state.attention.serverNow, received: Date.now() });
  if (at.current.serverNow !== state.attention.serverNow) at.current = { serverNow: state.attention.serverNow, received: Date.now() };
  const skew = Date.parse(at.current.serverNow) - at.current.received;
  const [, tick] = useState(0);
  const now = Date.now() + skew;
  const next = state.participants.reduce<number | null>((soonest, p) => {
    const until = p.status?.until ? Date.parse(p.status.until) : null;
    return until !== null && until > now && (soonest === null || until < soonest) ? until : soonest;
  }, null);
  // Owns the one wake-up for the nearest status to run out, replaced as soon as that changes.
  useEffect(() => {
    if (next === null) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.max(50, next - (Date.now() + skew) + 50));
    return () => clearTimeout(timer);
  }, [next, skew]);
  return { now, skew };
}

/**
 * Your status goes when you talk: a couple of seconds of mostly talking, with your microphone on, says you're back, once while
 * you have it. What's said in the first few seconds doesn't count, as someone often says "be right back" as they set it.
 * `level` is your microphone's (0 to 1); a room's noise stays under what counts as talking (`useTalking`).
 */
export function useStatusEndsWhenYouTalk(listening: boolean, level: () => number, back: () => void): void {
  const talking = useTalking(level, listening, { loud: 0.14, enough: 10, quiet: Infinity, grace: 30 });
  const latest = useRef(back);
  latest.current = back;
  useEffect(() => { if (talking) latest.current(); }, [talking]);
}
