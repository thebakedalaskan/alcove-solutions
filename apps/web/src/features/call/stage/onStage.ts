/*
 * What's on your stage (docs: Calls and recordings › The call screen). Your stage holds one thing: a screen someone shares, a
 * board, or the workspace, each in its frame (frame.tsx). Opening something puts away what was there: something presented
 * becomes its tile with the people, and something open just for you closes (the workspace keeps your place, caret and undo).
 * The one exception is Show beside, which puts a second presented thing beside the first, as two screens sit.
 *
 * A presentation that starts takes the stage of everyone who isn't already watching another one: they follow it, and are
 * told. Someone watching another gets it as a tile, told with Show it. On a board and in the workspace a follower can work on
 * their own (`own`) and follow again; a screen can't be unfollowed. Close is for you: someone else's presentation becomes its
 * tile while they present it, and so does your own screen, still shared. When a presentation ends, its tile goes; what was on a
 * follower's stage stays open just for them, unless it closed for everyone (`CallWorkspace.ended`).
 *
 * The call says every end it decides as it happens (`ended`, naming the presentation's key), and that ends it at once. Two more
 * end at once with nothing said: one its presenter replaces with another here (a new key from the same seat), and everything
 * presented where you were when you go to another part of the call (a room, or back). A presentation that goes with none of
 * that is its presenter reloading: it's waited for a while, quietly, and comes back as it was, with no tile flickering and
 * nothing said; if it doesn't, it's said to have ended. All of this is this browser's alone: nothing here is sent.
 */
import { firstName, type CallPresentEnded, type CallState, type CallWorkspace, type Person } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { callName } from '~/lib/people';
import { organizerFirst } from '../rooms/Hosting';
import { SOMEONE } from '../session/participants';
import type { StageShare } from './Stage';

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
  /** Whoever presents it, and their seat in the call: null for a screen, which is its sharer's for as long as it lasts. */
  by: Person;
  seat: string | null;
  first: string;
  mine: boolean;
  /** What its tile and the toasts call it: "Launch retro", "the workspace", "Priya’s screen". */
  name: string;
}

/** How long a presentation that went without saying how it ended is waited for: its presenter may be reloading. */
const HOLD_MS = 30_000;
/** How long something presented that lands as a tile while you watch something else glows where it lands. */
const FRESH_MS = 3000;

export interface StageTold {
  /** Someone else's presentation started: you're following it, or (watching another) it's a tile, with `show`. */
  started: (p: Presented, following: boolean, show: () => void) => void;
  /**
   * A presentation ended, someone else's or yours (`p.mine`): whether it was on your stage, whether it closed for everyone, and
   * whether the call said so (`said`), rather than its presenter not coming back from a reload. Yours closed for everyone
   * without you is the organizer's doing. Ends with nothing to say (replaced, or left behind as you moved) aren't told.
   */
  ended: (p: Presented, was: { onStage: boolean; closed: boolean; said: boolean }) => void;
}

export function useOnStage({ presented, ended, place, settled, told, kept }: {
  /** What's presented in your part of the call now, in the order it started. */
  presented: readonly Presented[];
  /** How the last presentation here ended, as the call says. */
  ended: CallPresentEnded | null;
  /** The part of the call you're in: going to another ends what was presented where you were, unsaid. */
  place: string;
  /** The call has settled since joining or reconnecting: presentations that appear now started now. */
  settled: () => boolean;
  told: StageTold;
  /** The workspace was on your stage before a reload. */
  kept: boolean;
}) {
  const [on, setOnState] = useState<readonly ThingId[]>(() => (kept ? ['ws'] : []));
  /** Presentations you're working on your own in, rather than following, by key. */
  const [own, setOwn] = useState<ReadonlySet<string>>(() => new Set());
  /** Presentations that went without an end, waited for a while in case their presenter is reloading. */
  const [held, setHeld] = useState<ReadonlyMap<string, { p: Presented; until: number }>>(() => new Map());
  const heldNow = useRef(held);
  heldNow.current = held;
  /** What's on your stage, as the last change left it: changes made one after another in one go each see the one before. */
  const onNow = useRef(on);
  const setOn = useCallback((next: readonly ThingId[]) => { onNow.current = next; setOnState(next); }, []);
  const endedNow = useRef(ended);
  endedNow.current = ended;
  const toldNow = useRef(told);
  toldNow.current = told;
  const settledNow = useRef(settled);
  settledNow.current = settled;
  /** The presentation each thing came onto your stage with, so an end for everyone closes only that one. */
  const came = useRef(new Map<ThingId, string>());
  /** Presentations that just landed as tiles while you watch another, by key: they glow where they land. */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const freshTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const t of freshTimers.current) clearTimeout(t); }, []);
  const landed = useCallback((key: string) => {
    setFresh((was) => new Set(was).add(key));
    const t = setTimeout(() => { freshTimers.current.delete(t); setFresh((was) => { const n = new Set(was); n.delete(key); return n; }); }, FRESH_MS);
    freshTimers.current.add(t);
  }, []);

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
  }, [setOn]);
  const remove = useCallback((id: ThingId) => {
    came.current.delete(id);
    if (onNow.current.includes(id)) setOn(onNow.current.filter((x) => x !== id));
  }, [setOn]);
  const follow = useCallback((key: string, on: boolean) => setOwn((was) => {
    if (was.has(key) === !on) return was;
    const next = new Set(was);
    if (on) next.delete(key); else next.add(key);
    return next;
  }), []);

  /* Presentations starting and ending, from what the call says. */
  const presentedKey = presented.map((p) => `${p.id}=${p.key}`).join(' ');
  /** Each presentation as last seen, by key, with the part of the call it was presented in. */
  const seen = useRef<Map<string, { p: Presented; place: string }> | null>(null);
  useEffect(() => {
    const was = seen.current;
    const now = new Map(presented.map((p) => [p.key, { p, place: was?.get(p.key)?.place ?? place }]));
    seen.current = now;
    if (!was) {
      // Back from a reload with the workspace kept on your stage, it came with what's presented there, as it would have.
      for (const p of presented) if (onNow.current.includes(p.id)) came.current.set(p.id, p.key);
      // Joining while something is presented (or back from a reload while you present it): with nothing else on your stage, you're in it.
      const first = presented.find((p) => p.mine) ?? presented[0];
      if (first && !onNow.current.length) put(first.id, first.key);
      return;
    }
    const end = endedNow.current;
    // What ended goes first, so whatever starts in its place takes the stage.
    for (const [key, { p, place: where }] of was) {
      if (now.has(key)) continue;
      // You've gone to another part of the call: nothing will say how what was presented where you were ended.
      if (where !== place) { finish(p, { closed: false, said: false, quiet: true }); continue; }
      // A screen stops for good, and so does whatever the call says ended.
      if (isScreen(p.id) || end?.key === key) { finish(p, { closed: end?.key === key && end.close, said: end?.key === key, quiet: false }); continue; }
      // Its presenter presents something else here: that's its end.
      if (p.seat !== null && presented.some((q) => q.seat === p.seat && !was.has(q.key))) { finish(p, { closed: false, said: false, quiet: true }); continue; }
      // Nothing says it ended: its presenter is reloading, so it's waited for.
      setHeld((h) => new Map(h).set(key, { p, until: Date.now() + HOLD_MS }));
    }
    for (const [key, { p }] of now) {
      if (was.has(key)) continue;
      // It came back from being waited for: as it was.
      if (heldNow.current.has(key)) { setHeld((h) => { const n = new Map(h); n.delete(key); return n; }); continue; }
      if (p.mine) { put(p.id, key); follow(key, true); continue; }
      // Watching another presentation: it's a tile with the people, told once you're settled in.
      const watching = onNow.current.some((id) => id !== p.id && liveNow.current.has(id));
      if (watching) {
        if (settledNow.current()) { toldNow.current.started(p, false, () => { put(p.id, key); follow(key, true); }); landed(key); }
        continue;
      }
      // Into everyone's stage that isn't watching another presentation: what was open just for them closes.
      put(p.id, key);
      follow(key, true);
      if (settledNow.current()) toldNow.current.started(p, true, () => undefined);
    }
    // `presentedKey` and `place` say what this reads of `presented`.
  }, [presentedKey, place]);

  /**
   * A presentation is over: its tile goes; on your stage it closes if it closed for everyone, and otherwise stays, just for you.
   * Only what came onto your stage with this presentation closes or lets go of it: a newer one there is left as it is.
   */
  const finish = (p: Presented, how: { closed: boolean; said: boolean; quiet: boolean }) => {
    follow(p.key, true);
    const onStage = onNow.current.includes(p.id);
    const itsOwn = came.current.get(p.id) === p.key;
    if (onStage && (isScreen(p.id) || (how.closed && itsOwn))) remove(p.id);
    else if (onStage && itsOwn) came.current.delete(p.id);
    if (!how.quiet) toldNow.current.ended(p, { onStage, closed: how.closed, said: how.said });
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
      for (const d of done) finishNow.current(d.p, { closed: false, said: false, quiet: false });
    }, Math.max(0, next - Date.now()));
    return () => clearTimeout(t);
  }, [held]);
  /* An end that's said while it's being waited for settles it at once. */
  useEffect(() => {
    if (!ended) return;
    const h = held.get(ended.key);
    if (!h) return;
    setHeld((was) => { const n = new Map(was); n.delete(ended.key); return n; });
    finishNow.current(h.p, { closed: ended.close, said: true, quiet: false });
  }, [ended?.key, ended?.close]);
  /* Gone to another part of the call: what was waited for where you were won't come back here. */
  const placeWas = useRef(place);
  useEffect(() => {
    if (placeWas.current === place) return;
    placeWas.current = place;
    if (!heldNow.current.size) return;
    const gone = [...heldNow.current.values()];
    setHeld(new Map());
    for (const h of gone) finishNow.current(h.p, { closed: false, said: false, quiet: true });
  }, [place]);

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
    setOn([...onNow.current.filter((x) => x !== id).slice(0, 1), id]);
  }, [follow, setOn]);
  const tiles = useMemo(() => live.filter((p) => !on.includes(p.id)), [live, onKey]);
  return useMemo(() => ({
    on, tiles, presented: live, presentedOf, open, close: remove, beside,
    /** Just landed as a tile while you watched something else: it glows where it lands. */
    fresh: (key: string) => fresh.has(key),
    /** You follow whoever presents it: always on a screen; on a board or in the workspace until you work on your own. */
    following: (id: ThingId) => { const p = byId.get(id); return p !== undefined && !p.mine && (isScreen(id) || !own.has(p.key)); },
    setFollow: (id: ThingId, to: boolean) => { const p = byId.get(id); if (p) follow(p.key, to); }
  }), [on, tiles, live, presentedOf, open, remove, beside, fresh, byId, own, follow]);
}

/**
 * Whether the call has settled since joining or reconnecting: something that starts once you're settled in is told, and so is
 * something that stops; not while the room connects or reconnects, when shares come and go with the connection. It starts again
 * whenever the connection or your part of the call (`unitKey`) changes: shares come and go with either. A call that ends empties
 * the call (its state, or the room's disconnect, whichever comes first) in the render that says so, as a reconnect does: `live`
 * and `connected` cover those.
 */
export function useSettled(live: boolean, connected: boolean, unitKey: string | null): () => boolean {
  const settledAt = useRef<number | null>(null);
  useEffect(() => { settledAt.current = connected ? Date.now() : null; }, [connected, unitKey]);
  return () => live && connected && settledAt.current !== null && Date.now() - settledAt.current > 4000;
}

/**
 * What a toast offers (Show it), by the key of the presentation it's about, goes once it's been taken up some other way, or what
 * it's about stops: once that presentation isn't a tile any more.
 */
export function useOffersFollowTiles(offers: RefObject<Map<string, () => void>>, tiles: readonly { key: string }[]): void {
  const tileKey = tiles.map((t) => t.key).join(' ');
  useEffect(() => {
    for (const [key, close] of offers.current) if (!tileKey.split(' ').includes(key)) { close(); offers.current.delete(key); }
  }, [tileKey]);
}

/**
 * What's presented here, and what's on your stage, with what's said as it changes. Screens, as many as four, and one board or the
 * workspace (the call's `present`). A presentation that starts takes the stage of everyone who isn't watching another; anything
 * presented that isn't on your stage is a tile with the people. Something that starts once you're settled in is told, and so is
 * something that stops: `settled` is known before the stage hears what's presented. A toast's Show it goes once it's been taken
 * up some other way, or what it's about stops. `stoppedByMe`: a presentation or share you ended, yours or (as the organizer)
 * someone else's, which you've been told about, so its end isn't said twice. Each toast is about what it says (`about`), so a
 * newer one about the same thing takes its place.
 */
export function useCallStage({ state, space, shares, place, inRoom, kept, live, connected, unitKey, say }: {
  state: CallState;
  /** The call's workspace, which says what's presented and how the last presentation ended. */
  space: CallWorkspace;
  shares: readonly StageShare[];
  /** The part of the call you're in. */
  place: string;
  inRoom: boolean;
  /** The workspace was on your stage before a reload. */
  kept: boolean;
  live: boolean;
  connected: boolean;
  /** Who's in your part of the call, which shares come and go with. */
  unitKey: string | null;
  /** Says it, and gives back what takes it away. */
  say: (toast: WsToastData, topic?: string) => () => void;
}) {
  const settled = useSettled(live, connected, unitKey);
  /** What's said about something on your stage, or presented here, is about it: each says the latest of it. */
  const about = (id: ThingId) => `stage:${id}`;
  const presentNow = space.present;
  const presenterIn = presentNow ? state.participants.find((p) => p.seat === presentNow.by.seat) ?? null : null;
  const presented: Presented[] = [
    ...shares.map((s): Presented => ({ id: screenOf(s.id), key: `screen:${s.id}`, by: s.presenter, seat: null, first: s.mine ? 'You' : callName(s.presenter), mine: s.mine, name: s.name })),
    ...(presentNow && presentNow.kind !== null ? [{
      id: presentNow.kind === 'workspace' ? 'ws' as const : 'board' as const, key: presentNow.key, by: presenterIn?.person ?? { ...SOMEONE, name: presentNow.by.name }, seat: presentNow.by.seat,
      first: firstName(presentNow.by.name), mine: presentNow.mine, name: presentNow.kind === 'workspace' ? space.name ?? 'the workspace' : presentNow.name ?? 'the board'
    }] : [])
  ];
  const offers = useRef(new Map<string, () => void>());
  const stoppedByMe = useRef<string | null>(null);
  const stage = useOnStage({
    presented, ended: space.ended, place, settled, kept,
    told: {
      started: (p, following, show) => {
        const what = isScreen(p.id) ? 'their screen' : p.id === 'ws' ? 'the workspace' : p.name;
        if (!following) { offers.current.get(p.key)?.(); offers.current.set(p.key, say(wsToast.presentingToo(p.by, p.first, what, show), about(p.id))); return; }
        say(isScreen(p.id) ? wsToast.presentingScreen(p.first) : p.id === 'ws' ? wsToast.followingWorkspace(p.first) : wsToast.followingBoard(p.first, p.name), about(p.id));
      },
      ended: (p, was) => {
        if (stoppedByMe.current === p.key) { stoppedByMe.current = null; return; }
        const what = p.id === 'ws' ? 'the workspace' : p.name;
        // Yours, closed for everyone, and not by you: only the organizer can, and you're told it was them, as a stopped share is.
        if (p.mine) { if (was.closed && !isScreen(p.id)) say(wsToast.closedByOrganizer(organizerFirst(state), what), about(p.id)); return; }
        if (isScreen(p.id)) { if (was.onStage && settled()) say(wsToast.stoppedSharing(p.first), about(p.id)); return; }
        // The call said it ended, and its presenter is gone from it: they left, which is why.
        if (was.said && !was.closed && p.seat !== null && !state.participants.some((x) => x.seat === p.seat)) { say(wsToast.presenterLeft(p.first), about(p.id)); return; }
        // In a room, the board every room shares closes for that room alone, and stays the call's.
        const roomOnly = inRoom && (p.id === 'ws' || state.board.open !== null);
        say(was.closed && was.onStage ? wsToast.closedEverywhere(what, roomOnly) : wsToast.stoppedPresentingIt(p.id === 'ws' ? 'folderOpen' : 'presentation', p.first, what), about(p.id));
      }
    }
  });
  useOffersFollowTiles(offers, stage.tiles);
  return { stage, settled, about, presenterIn, stoppedByMe };
}
