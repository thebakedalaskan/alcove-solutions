/*
 * Who's talking, settled: someone else who has been talking for a moment, so a cough or a quick "yes" changes nothing. They
 * stay it while they talk, and for a little while after. It says who's talking (at the end of the transcript) and keeps
 * them a place beside what's open, but never puts anyone on the main stage: only a pin or the organizer's spotlight does that
 * (stageLayout.ts).
 *
 * Only whether people are speaking is used (LiveKit's speaker detection, your own microphone level), never what's said.
 */
import { useEffect, useRef, useState } from 'react';

/** Talking this long makes someone the speaker. */
const SETTLE_MS = 600;
/** A new speaker keeps it at least this long. */
const HOLD_MS = 2_000;

interface Talker { id: string; isMe: boolean; speaking: boolean }

/** The speaker, never you: re-checked as people start and stop talking, and every 200 ms while anyone else talks. */
export function useSettledSpeaker(people: Talker[]): string | null {
  const key = people.filter((p) => p.speaking).map((p) => p.id).join(' ');
  const meNow = useRef<string | null>(null);
  meNow.current = people.find((p) => p.isMe)?.id ?? null;
  const [speaker, setSpeaker] = useState<string | null>(null);
  const since = useRef(new Map<string, number>());
  const lead = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });

  useEffect(() => {
    const now = Date.now();
    const s = since.current;
    const others = key ? key.split(' ').filter((id) => id !== meNow.current) : [];
    for (const id of [...s.keys()]) if (!others.includes(id)) s.delete(id);
    for (const id of others) if (!s.has(id)) s.set(id, now);
    const pick = () => {
      const t = Date.now();
      const cur = lead.current;
      if (cur.id && s.has(cur.id)) return;
      if (cur.id && t - cur.at < HOLD_MS) return;
      let best: string | null = null;
      let from = Infinity;
      for (const [id, at] of s) if (t - at >= SETTLE_MS && at < from) { best = id; from = at; }
      if (!best || best === cur.id) return;
      lead.current = { id: best, at: t };
      setSpeaker(best);
    };
    pick();
    if (!s.size) return;
    const timer = setInterval(pick, 200);
    return () => clearInterval(timer);
  }, [key]);

  return speaker;
}
