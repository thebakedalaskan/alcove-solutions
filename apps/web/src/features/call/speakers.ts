/*
 * Who's talking, settled enough to lay the stage out by. A cough or a quick "yes" moves nothing:
 *
 * - The speaker (Speaker view) is someone else who has been talking for a moment. They keep the main stage while they
 *   talk, and for a little while after taking it.
 * - The one doing most of the talking (Auto) has had most of everyone's talk time, yours included, over the last
 *   minute or so; they stop being it only once that's clearly no longer true.
 *
 * Only whether people are speaking is used (LiveKit's speaker detection, your own microphone level), never what's said.
 */
import { useEffect, useRef, useState } from 'react';

/** Talking this long takes the main stage in Speaker view. */
const SETTLE_MS = 600;
/** A new speaker keeps it at least this long. */
const HOLD_MS = 2_000;
/** Talk time is counted over this window, in one-second steps. */
const WINDOW_S = 45;

interface Talker { id: string; isMe: boolean; speaking: boolean }

export function useSettledSpeakers(people: Talker[]): { speaker: string | null; dominant: string | null } {
  const talking = people.filter((p) => p.speaking).map((p) => p.id);
  const key = talking.join(' ');
  const me = people.find((p) => p.isMe)?.id ?? null;
  const latest = useRef({ talking, me });
  latest.current = { talking, me };
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [dominant, setDominant] = useState<string | null>(null);
  const since = useRef(new Map<string, number>());
  const lead = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });

  /* The speaker: re-checked as people start and stop talking, and every 200 ms while anyone else talks. */
  useEffect(() => {
    const now = Date.now();
    const s = since.current;
    const others = key ? key.split(' ').filter((id) => id !== latest.current.me) : [];
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

  /* Most of the talking: each second, who talked, kept for the window. */
  useEffect(() => {
    const seconds: string[][] = [];
    let current: string | null = null;
    const timer = setInterval(() => {
      seconds.push(latest.current.talking);
      if (seconds.length > WINDOW_S) seconds.shift();
      const talk = new Map<string, number>();
      let total = 0;
      for (const sec of seconds) for (const id of sec) { talk.set(id, (talk.get(id) ?? 0) + 1); total++; }
      const share = (id: string | null) => (id && total ? (talk.get(id) ?? 0) / total : 0);
      const still = current !== null && share(current) >= 0.45 && (talk.get(current) ?? 0) >= 8;
      let next = still ? current : null;
      if (!next) {
        for (const [id, n] of talk) if (id !== latest.current.me && n >= 15 && n / total >= 0.7) next = id;
      }
      if (next !== current) { current = next; setDominant(next); }
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  return { speaker, dominant };
}
