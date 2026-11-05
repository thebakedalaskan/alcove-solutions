/*
 * The private audio behind a note. Each time notes were turned back on, a new segment started; the player plays them
 * one after another as a single recording. Audio is decrypted by the server for a signed-in recipient only, and the
 * browser's own element reads it by byte range: it starts as soon as the first of it arrives and goes to any moment, and
 * whatever was asked of it last is what it does. Until someone presses play, moving along the line reads nothing. A
 * recording has no index to seek by, so going far ahead reads through what's between, once; a browser that won't do that
 * (Firefox stops at what it has already read) gets the segment whole, and plays it from memory. What a URL gives is
 * pinned to a number of pieces, because a browser holds a URL to the length it first said: while a call is recording,
 * reading further is a new URL. The note draws all this as its horizon (CallLine.tsx). Where it's got to changes several
 * times a second, so what shows it reads `pos` through `usePlayerAt`, and the rest of the page isn't drawn again for it.
 */
import { errorCode, type AudioSegment } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { useRecheckNote } from '~/lib/queries';

const plog = log.child({ component: 'player' });

export interface PlayerState {
  total: number;
  playing: boolean;
  /** It has been asked for something it hasn't got yet. */
  busy: boolean;
  toggle: () => void;
  /** Goes to a moment in the whole recording, playing on from there if it was playing. `play` starts it if it wasn't. */
  seek: (seconds: number, play?: boolean) => void;
  /** Where it's got to. */
  pos: () => number;
  /** Says when `pos` changes. */
  subscribe: (on: () => void) => () => void;
}

/** Something worked out from where the player has got to, which draws again only when it changes. */
export function usePlayerAt<T extends string | number | boolean | undefined>(player: PlayerState, read: (pos: number) => T): T {
  return useSyncExternalStore(player.subscribe, () => read(player.pos()));
}

/** Where each segment starts in the whole recording, and whether it's still growing. */
function planOf(segments: AudioSegment[], live: boolean) {
  let total = 0;
  const starts = segments.map((s) => { const at = total; total += s.seconds; return at; });
  return { segments, starts, total, live };
}

/** How close to the end of a segment counts as all of it: what a piece says it lasts is near enough, not exact. */
const NEAR_THE_END = 5;

/**
 * Whether the element says it can go to `t`, in a segment of `seconds`. Its own duration won't say: Firefox gives what it
 * has read so far as the duration of a recording with no index, and stops there as if that were the end.
 */
function canReach(a: HTMLMediaElement, t: number, seconds: number): boolean {
  if (t < 1) return true;
  for (let i = 0; i < a.seekable.length; i++) {
    const end = a.seekable.end(i);
    if (t >= a.seekable.start(i) && (t <= end || end >= seconds - NEAR_THE_END)) return true;
  }
  return false;
}

/** A segment on its way whole: where to go and whether to play once it's here, which change as people press things. */
interface Fetching { url: string; stop: AbortController; offset: number; play: boolean }

export function usePlayer(noteId: string, segments: AudioSegment[], live: boolean): PlayerState {
  const toast = useToast();
  const recheck = useRecheckNote(noteId);
  const plan = useMemo(() => planOf(segments, live), [segments, live]);
  /** A note read again while it plays has more of its recording, and that mustn't stop it. */
  const latest = useRef(plan);
  useEffect(() => { latest.current = plan; }, [plan]);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** The segment in the element, once one is, and the URL of what it's reading. */
  const at = useRef(-1);
  const loaded = useRef<string | null>(null);
  const here = useRef(0);
  /** A time asked for before the element has read anything. Until it has, its own time says nothing about where this is. */
  const wanted = useRef<number | null>(null);
  /** A seek on its way, to see whether it gets there. */
  const aim = useRef<number | null>(null);
  const fetching = useRef<Fetching | null>(null);
  /** The object URL of the segment in the element, when it's whole in memory. */
  const held = useRef<string | null>(null);
  /** Counts what's been asked, so that reading a note again can tell if anything was asked meanwhile. */
  const asked = useRef(0);
  const listeners = useRef(new Set<() => void>());
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);

  const move = useCallback((seconds: number) => { here.current = seconds; for (const on of listeners.current) on(); }, []);
  const pos = useCallback(() => here.current, []);
  const subscribe = useCallback((on: () => void) => { listeners.current.add(on); return () => { listeners.current.delete(on); }; }, []);
  /** What the button shows is the element's own state, whichever order it says so in, or what's wanted of what's on its way. */
  const sync = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    const f = fetching.current;
    setPlaying(f ? f.play : !a.paused);
    setBusy(!!f || a.seeking || (!a.paused && a.readyState < a.HAVE_FUTURE_DATA));
  }, []);
  const stopFetching = useCallback(() => {
    fetching.current?.stop.abort();
    if (fetching.current) wanted.current = null;
    fetching.current = null;
  }, []);
  const letGo = useCallback(() => {
    if (held.current) URL.revokeObjectURL(held.current);
    held.current = null;
  }, []);

  const start = useCallback((a: HTMLAudioElement) => {
    a.play().catch((e: unknown) => {
      // Something newer was asked of it, or the segment failed, which `error` deals with.
      if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'NotSupportedError')) return;
      plog.warn('audio could not play', { err: e, noteId, segment: at.current });
      toast('The recording didn’t start. Press play to try again.', { icon: 'x' });
    });
  }, [noteId, toast]);

  const failed = useCallback(async () => {
    const a = audio.current;
    if (!a) return;
    plog.warn('audio could not be read', { code: a.error?.code, noteId, segment: at.current });
    // The element is finished with this: emptied, and pressing play reads it again from where it stopped.
    at.current = -1;
    loaded.current = null;
    wanted.current = null;
    aim.current = null;
    a.removeAttribute('src');
    a.load();
    letGo();
    setPlaying(false);
    setBusy(false);
    // The element can't say why. If the session is over, the query layer sees that and signs out.
    const over = await recheck().then(() => false, (e: unknown) => errorCode(e) === 'unauthenticated');
    if (!over && audio.current === a) toast('That part of the recording wouldn’t play. Press play to try again.', { icon: 'x' });
  }, [noteId, letGo, recheck, toast]);

  /** For a browser that can't get to `offset` in the segment it's reading: fetches it whole, and goes there from memory. */
  const fetchWhole = useCallback((offset: number, play: boolean) => {
    const a = audio.current;
    const seg = latest.current.segments[at.current];
    const url = loaded.current;
    if (!a || !seg || !url) return;
    const f: Fetching = { url, stop: new AbortController(), offset, play };
    fetching.current = f;
    wanted.current = offset;
    aim.current = null;
    a.pause();
    sync();
    plog.info('audio read whole, for a browser that can’t seek it by range', { noteId, segment: seg.index });
    api.notes.audio(noteId, seg.index, seg.pieces, f.stop.signal).then((whole) => {
      if (fetching.current !== f) return;
      fetching.current = null;
      held.current = URL.createObjectURL(whole);
      a.src = held.current;
      wanted.current = f.offset;
      a.currentTime = f.offset;
      if (f.play) start(a);
      sync();
    }, () => {
      if (fetching.current !== f) return;
      fetching.current = null;
      void failed();
    });
  }, [noteId, failed, start, sync]);

  const load = useCallback((i: number, offset: number, play: boolean) => {
    const a = audio.current;
    const seg = latest.current.segments[i];
    if (!a || !seg) return;
    const url = api.notes.audioUrl(noteId, seg.index, seg.pieces);
    const f = fetching.current;
    // On its way whole already: whatever's wanted now is what happens when it's here.
    if (f?.url === url) { f.offset = offset; f.play = play; wanted.current = offset; sync(); return; }
    stopFetching();
    if (loaded.current !== url) {
      at.current = i;
      loaded.current = url;
      a.src = url;
      letGo();
    }
    if (a.readyState === a.HAVE_NOTHING) wanted.current = offset;
    else if (!held.current && !canReach(a, offset, seg.seconds)) { fetchWhole(offset, play); return; }
    if (Math.abs(a.currentTime - offset) > 0.25) {
      aim.current = held.current ? null : offset;
      a.currentTime = offset;
    }
    if (play) start(a);
    sync();
  }, [noteId, fetchWhole, letGo, start, stopFetching, sync]);

  const seek = useCallback((seconds: number, play = false) => {
    const { starts, total } = latest.current;
    const s = Math.max(0, Math.min(total, seconds));
    const i = Math.max(0, starts.findLastIndex((x) => x <= s));
    const go = play || (fetching.current ? fetching.current.play : audio.current?.paused === false);
    asked.current++;
    move(s);
    if (go || at.current === i) { load(i, s - (starts[i] ?? 0), go); return; }
    // Paused with something else in the element, there's only the sun to move: pressing play starts from there.
    stopFetching();
    sync();
  }, [load, move, stopFetching, sync]);

  /** Reads a recording that's still going again, at the end of what it had, and plays on if there's more. `pressed`: someone asked to. */
  const more = useCallback(async (pressed: boolean) => {
    const ask = ++asked.current;
    if (pressed) setBusy(true);
    const note = await recheck().catch((e: unknown) => { plog.info('a recording in progress could not be read again', { err: e, noteId }); });
    if (ask !== asked.current) return;
    if (note) latest.current = planOf(note.audio, note.status === 'recording');
    setBusy(false);
    if (latest.current.total - here.current > 1) seek(here.current, true);
    else if (pressed) toast('That’s all that’s been recorded so far.', { icon: 'mic' });
  }, [noteId, recheck, seek, toast]);

  useEffect(() => {
    const a = new Audio();
    audio.current = a;
    const off = new AbortController();
    const on = (type: keyof HTMLMediaElementEventMap, run: () => void) => a.addEventListener(type, run, { signal: off.signal });
    const inElement = () => latest.current.segments[at.current]?.seconds ?? 0;
    for (const type of ['play', 'pause', 'playing', 'waiting', 'seeking', 'seeked', 'canplay', 'emptied'] as const) on(type, sync);
    on('timeupdate', () => {
      if (at.current < 0 || wanted.current !== null || aim.current !== null) return;
      const { starts, total } = latest.current;
      // What a piece holds can run a little past what it says it lasts, and the sun stops where the line does.
      move(Math.min(total, (starts[at.current] ?? 0) + a.currentTime));
    });
    on('loadedmetadata', () => {
      const to = wanted.current;
      if (to === null || fetching.current) return;
      wanted.current = null;
      if (!held.current && !canReach(a, to, inElement())) { fetchWhole(to, !a.paused); return; }
      // Not every browser keeps a time it was given before it had read anything.
      if (Math.abs(a.currentTime - to) > 1) a.currentTime = to;
    });
    on('seeked', () => {
      const to = aim.current;
      aim.current = null;
      // A browser that can't get there says nothing, and stops short.
      if (to !== null && a.currentTime < to - 2 && a.currentTime < inElement() - NEAR_THE_END) fetchWhole(to, !a.paused);
    });
    on('ended', () => {
      // Firefox ends where it had read to, if it was told to go past that: this was on its way whole for that reason.
      if (fetching.current) return;
      const next = at.current + 1;
      if (next < latest.current.segments.length) { load(next, 0, true); return; }
      move(latest.current.total);
      if (latest.current.live) void more(false);
    });
    // What it was reading doesn't matter once the segment is on its way whole.
    on('error', () => { if (!fetching.current) void failed(); });
    return () => {
      off.abort();
      asked.current++;
      stopFetching();
      a.pause();
      a.removeAttribute('src');
      a.load();
      letGo();
      audio.current = null;
      at.current = -1;
      loaded.current = null;
      wanted.current = null;
      aim.current = null;
    };
  }, [failed, fetchWhole, letGo, load, more, move, stopFetching, sync]);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    const f = fetching.current;
    if (f) { f.play = !f.play; sync(); return; }
    if (!a.paused) { asked.current++; a.pause(); return; }
    const { total, live: growing } = latest.current;
    if (here.current < total) seek(here.current, true);
    else if (growing) void more(true);
    else seek(0, true);
  }, [more, seek, sync]);
  const { total } = plan;
  return useMemo(() => ({ total, playing, busy, toggle, seek, pos, subscribe }), [total, playing, busy, toggle, seek, pos, subscribe]);
}
