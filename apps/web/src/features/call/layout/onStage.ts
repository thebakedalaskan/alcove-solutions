/*
 * What's on your stage (docs: Calls and recordings › The call screen). Your stage holds one thing: a screen someone shares, a
 * board, or the workspace, each in its frame (frame.tsx). Opening something puts away what was there: something presented
 * becomes its tile with the people, and something open just for you closes (the workspace keeps your place, caret and undo).
 * The one exception is Show beside, which puts a second presented thing beside the first, as two screens sit.
 *
 * A presentation that starts takes the stage of everyone who isn't already watching another one: they follow it, and are
 * told. Someone watching another gets it as a tile, told with Show it. On a board and in the workspace a follower can work on
 * their own (`own`) and follow again; a screen can't be unfollowed. Close is for you: someone else's presentation becomes its
 * tile while they present it. When a presentation ends, its tile goes; what was on a follower's stage stays open just for them,
 * unless it closed for everyone (`CallWorkspace.ended`).
 *
 * A presentation that goes without saying how it ended is waited for a while: its presenter may be reloading, and it comes
 * back as it was, with no tile flickering and nothing said. All of this is this browser's alone: nothing here is sent.
 */
import type { CallPresentEnded, Person } from '@alcove/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Something that can be on your stage: the workspace, the board in the call, a saved board open just for you, or a screen by whoever shares it. */
export type ThingId = 'ws' | 'board' | 'saved' | `screen:${string}`;
export const screenOf = (sharer: string): ThingId => `screen:${sharer}`;
export const isScreen = (id: ThingId): id is `screen:${string}` => id.startsWith('screen:');
/** Whose screen a screen's thing is: their participant ID. */
export const sharerOf = (id: ThingId): string | null => (isScreen(id) ? id.slice('screen:'.length) : null);

/** Something presented in your part of the call. */
export interface Presented {
  id: ThingId;
  /** One presentation, from its start to its end: a board's or the workspace's as the call says, a screen's by its sharer. */
  key: string;
  /** Whoever presents it. */
  by: Person;
  first: string;
  mine: boolean;
  /** What its tile and the toasts call it: "Launch retro", "the workspace", "Priya’s screen". */
  name: string;
}

/** How long a presentation that went without saying how it ended is waited for: its presenter may be reloading. */
const HOLD_MS = 30_000;

export interface StageTold {
  /** Someone else's presentation started: you're following it, or (watching another) it's a tile, with `show`. */
  started: (p: Presented, following: boolean, show: () => void) => void;
  /** Someone else's presentation ended: whether it was on your stage, and whether it closed for everyone. */
  ended: (p: Presented, was: { onStage: boolean; closed: boolean }) => void;
}

export function useOnStage({ presented, ended, settled, told, kept }: {
  /** What's presented in your part of the call now, in the order it started. */
  presented: readonly Presented[];
  /** How the last presentation here ended, as the call says. */
  ended: CallPresentEnded | null;
  /** The call has settled since joining or reconnecting: presentations that appear now started now. */
  settled: () => boolean;
  told: StageTold;
  /** The workspace was on your stage before a reload. */
  kept: boolean;
}) {
  const [on, setOn] = useState<readonly ThingId[]>(() => (kept ? ['ws'] : []));
  /** Presentations you're working on your own in, rather than following, by key. */
  const [own, setOwn] = useState<ReadonlySet<string>>(() => new Set());
  /** Presentations that went without an end, waited for a while in case their presenter is reloading. */
  const [held, setHeld] = useState<ReadonlyMap<string, { p: Presented; until: number }>>(() => new Map());
  const heldNow = useRef(held);
  heldNow.current = held;
  const onNow = useRef(on);
  onNow.current = on;
  const endedNow = useRef(ended);
  endedNow.current = ended;
  const toldNow = useRef(told);
  toldNow.current = told;
  const settledNow = useRef(settled);
  settledNow.current = settled;
  /** The presentation each thing came onto your stage with, so an end for everyone closes only that one. */
  const came = useRef(new Map<ThingId, string>());

  /* Everything presented, the ones being waited for too: their frames and tiles stay as they were meanwhile. */
  const live = useMemo(() => {
    const keys = new Set(presented.map((p) => p.key));
    return [...presented, ...[...held.values()].filter((h) => !keys.has(h.p.key) && !presented.some((p) => p.id === h.p.id)).map((h) => h.p)];
  }, [presented, held]);
  const byId = useMemo(() => new Map(live.map((p) => [p.id, p])), [live]);
  const liveNow = useRef(byId);
  liveNow.current = byId;

  const put = useCallback((id: ThingId, key: string | null) => {
    if (key) came.current.set(id, key); else came.current.delete(id);
    setOn([id]);
  }, []);
  const remove = useCallback((id: ThingId) => {
    came.current.delete(id);
    setOn((was) => (was.includes(id) ? was.filter((x) => x !== id) : was));
  }, []);
  const follow = useCallback((key: string, on: boolean) => setOwn((was) => {
    if (was.has(key) === !on) return was;
    const next = new Set(was);
    if (on) next.delete(key); else next.add(key);
    return next;
  }), []);

  /* Presentations starting and ending, from what the call says. */
  const presentedKey = presented.map((p) => `${p.id}=${p.key}`).join(' ');
  const seen = useRef<Map<string, Presented> | null>(null);
  useEffect(() => {
    const now = new Map(presented.map((p) => [p.key, p]));
    const was = seen.current;
    seen.current = now;
    if (!was) {
      // Joining while something is presented (or back from a reload while you present it): with nothing else on your stage, you're in it.
      const first = presented.find((p) => p.mine) ?? presented[0];
      if (first && !onNow.current.length) put(first.id, first.key);
      return;
    }
    for (const [key, p] of now) {
      if (was.has(key)) continue;
      // It came back from being waited for: as it was.
      if (heldNow.current.has(key)) { setHeld((h) => { const n = new Map(h); n.delete(key); return n; }); continue; }
      if (p.mine) { put(p.id, key); follow(key, true); continue; }
      // Watching another presentation: it's a tile with the people, told once you're settled in.
      const watching = onNow.current.some((id) => id !== p.id && liveNow.current.has(id));
      if (watching) {
        if (settledNow.current()) toldNow.current.started(p, false, () => { put(p.id, key); follow(key, true); });
        continue;
      }
      // Into everyone's stage that isn't watching another presentation: what was open just for them closes.
      put(p.id, key);
      follow(key, true);
      if (settledNow.current()) toldNow.current.started(p, true, () => undefined);
    }
    for (const [key, p] of was) {
      if (now.has(key)) continue;
      const end = endedNow.current;
      const said = end !== null && end.key === key;
      // A screen stops for good; a board or the workspace that went without saying how is waited for.
      if (!isScreen(p.id) && !said) { setHeld((h) => new Map(h).set(key, { p, until: Date.now() + HOLD_MS })); continue; }
      finish(p, said && end.close);
    }
    // `presentedKey` says what this reads of `presented`.
  }, [presentedKey]);

  /** A presentation is over: its tile goes; on your stage it closes if it closed for everyone, and otherwise stays, just for you. */
  const finish = (p: Presented, closed: boolean) => {
    follow(p.key, true);
    const onStage = onNow.current.includes(p.id);
    if (onStage && (isScreen(p.id) || (closed && came.current.get(p.id) === p.key))) remove(p.id);
    else if (onStage) came.current.delete(p.id);
    if (!p.mine) toldNow.current.ended(p, { onStage, closed });
  };
  const finishNow = useRef(finish);
  finishNow.current = finish;

  /* Whatever was waited for and didn't come back is over, without anything said about how. */
  useEffect(() => {
    if (!held.size) return undefined;
    const next = Math.min(...[...held.values()].map((h) => h.until));
    const t = setTimeout(() => {
      const at = Date.now();
      const done = [...held.values()].filter((h) => h.until <= at);
      if (!done.length) return;
      setHeld((h) => { const n = new Map(h); for (const d of done) n.delete(d.p.key); return n; });
      for (const d of done) finishNow.current(d.p, false);
    }, Math.max(0, next - Date.now()));
    return () => clearTimeout(t);
  }, [held]);
  /* An end that's said while it's being waited for settles it at once. */
  useEffect(() => {
    if (!ended) return;
    const h = held.get(ended.key);
    if (!h) return;
    setHeld((was) => { const n = new Map(was); n.delete(ended.key); return n; });
    finishNow.current(h.p, ended.close);
  }, [ended?.key, ended?.close]);

  /* Something presented that went from the call without an end (a share that stopped) leaves your stage. */
  const onKey = on.join(' ');
  useEffect(() => {
    const gone = on.filter((id) => isScreen(id) && !byId.has(id));
    for (const id of gone) remove(id);
  }, [onKey, byId, remove]);

  const presentedOf = useCallback((id: ThingId): Presented | null => byId.get(id) ?? null, [byId]);
  /** Opens something on your stage: what was there is put away. Something presented opens following its presenter. */
  const open = useCallback((id: ThingId, how: { own?: boolean } = {}) => {
    const p = liveNow.current.get(id);
    put(id, p?.key ?? null);
    if (p) follow(p.key, !how.own);
  }, [put, follow]);
  /** Puts a second presented thing beside the first, or leads with it if your stage was empty. */
  const beside = useCallback((id: ThingId) => {
    const p = liveNow.current.get(id);
    if (!p) return;
    came.current.set(id, p.key);
    follow(p.key, true);
    setOn((was) => [...was.filter((x) => x !== id).slice(0, 1), id]);
  }, [follow]);
  const tiles = useMemo(() => live.filter((p) => !on.includes(p.id)), [live, onKey]);
  return useMemo(() => ({
    on, tiles, presented: live, presentedOf, open, close: remove, beside,
    /** You follow whoever presents it: always on a screen; on a board or in the workspace until you work on your own. */
    following: (id: ThingId) => { const p = byId.get(id); return p !== undefined && !p.mine && (isScreen(id) || !own.has(p.key)); },
    setFollow: (id: ThingId, to: boolean) => { const p = byId.get(id); if (p) follow(p.key, to); }
  }), [on, tiles, live, presentedOf, open, remove, beside, byId, own, follow]);
}
export type OnStage = ReturnType<typeof useOnStage>;
