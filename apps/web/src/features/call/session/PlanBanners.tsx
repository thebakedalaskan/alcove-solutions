/*
 * What's said about the whole call until it's closed (docs: Plans and usage): notes stopped because the organizer's notes
 * or storage ran out, for everyone, with the ways to more for whoever organizes (PlanStop.tsx), which open checkout over the
 * call; the organizer's notes about to run out at this call's pace, for them alone; and the call about to reach its longest,
 * for everyone, 5 minutes before. Each drops from the top and stays until its × is pressed, once in this tab, through a
 * reload. While Notes is open on your side, its own bar says the stop, so the banner waits.
 */
import type { CallState } from '@alcove/api';
import { CallBanner } from '@alcove/ui';
import { AnimatePresence } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { useNow } from '~/lib/live';
import { hm } from '~/lib/time';
import { StopWays, type PlanStop } from '../notes/PlanStop';
import { keepSeen, seenNotices } from './seen';

/** How long before the call's end everyone is told. */
const ENDS_SOON_MS = 5 * 60_000;

export function PlanBanners({ state, stop, notesOpen }: {
  state: CallState;
  /** The organizer's plan has stopped notes: what's said about it, and the ways to more (PlanStop.tsx). */
  stop: PlanStop | null;
  /** Notes is open on your side, where the stop is said over its tabs. */
  notesOpen: boolean;
}) {
  const now = useNow(15_000);
  const [closed, setClosed] = useState(() => seenNotices(state.callId));
  const close = (key: string) => setClosed((was) => { const next = new Set(was).add(key); keepSeen(state.callId, next); return next; });
  const { runningOut } = state.capture;
  const ends = Date.parse(state.endsAt);
  const banners: { key: string; node: (key: string) => ReactNode }[] = [];
  if (stop) {
    if (!notesOpen) {
      banners.push({
        key: `stopped:${stop.at}`,
        node: (key) => (
          <CallBanner key={key} icon="notesPen" tone="caution" title={stop.title} onClose={() => close(key)}
            actions={stop.ways.length > 0 ? <StopWays ways={stop.ways} /> : undefined}>
            {stop.line}
          </CallBanner>
        )
      });
    }
  } else if (runningOut) {
    banners.push({
      key: `running-out:${runningOut.at}`,
      node: (key) => (
        <CallBanner key={key} icon="clock" title="About 5 minutes of notes left" onClose={() => close(key)}>
          At this call’s pace. Notes stop then, and the call goes on.
        </CallBanner>
      )
    });
  }
  if (state.phase === 'in-call' && ends - now <= ENDS_SOON_MS) {
    banners.push({
      key: `ends:${state.endsAt}`,
      node: (key) => (
        <CallBanner key={key} icon="clock" title={`This call ends at ${hm(state.endsAt)}`} onClose={() => close(key)}>
          A call runs for up to {Math.round((ends - Date.parse(state.startedAt)) / 3_600_000)} hours. Its notes are written once it ends.
        </CallBanner>
      )
    });
  }
  const shown = banners.filter((b) => !closed.has(b.key));
  return (
    <div className="ic-limits">
      <AnimatePresence initial={false}>{shown.map((b) => b.node(b.key))}</AnimatePresence>
    </div>
  );
}
