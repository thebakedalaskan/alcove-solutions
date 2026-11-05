/*
 * The stage: everyone's tiles, what's shared, the bar that says what's shared or spotlighted, and the captions. It's one
 * layer over the whole of the call's area, so that nothing playing ever remounts as the panels around it (panels.ts) move:
 * tiles sit where the layout engine (stageLayout.ts) puts them and glide there. Your own view (view.ts): drag tiles into
 * another order, make one bigger from its corner, drag the line beside a shared screen, pin people, and see yourself
 * in the grid, in a corner or not at all. Every tile can be focused, then pinned, moved and sized from the keyboard
 * (its ⋯ menu says how). All of that changes your view only. With rooms open, the organizer's stage shows every
 * room; everyone else's shows the people in their own room.
 *
 * Shares shown big have a handle, and the people a small toolbar, to set them apart from the stage as panels of their
 * own. Then they sit where the panels put them: the people as tiles or arches, or small on the horizon beside the dock,
 * where whoever's talking or has a hand up rises.
 *
 * Several people can share at once. Each share names whoever shares it, in the arch; two fit side by side with a line
 * between them, and the rest wait as tiles: a click (or P) shows one big, beside what's big or, when two already are,
 * in place of the one that's been big longest. A share that starts later glows for a moment where the layout puts it:
 * until you choose, a second one goes big beside the first, and once you have, a new one comes in as a tile.
 *
 * Someone else's share you see big can be looked at closer, for you only (ShareSurface.tsx): zoomed, moved around,
 * frozen, stepped back through its last pictures, or opened in its own window, where the stage keeps it as a tile.
 *
 * Anyone the call lets point can point at a share shown big and live here (SharePointing.tsx): their pointer, with their
 * name, and marks that fade, which everyone sees on that share wherever it is on their stage (and in its own window),
 * however they've framed it, while they see it live.
 */
import { CALL_SHARE_ROOM, CALL_SHARE_SPLIT, type CallPeopleMode, type Person, type SelfView, type StageCorner } from '@alcove/api';
import { Avatar, Button, CallTile, CaptureSign, EmptyState, Icon, NotesSign, Tooltip, cn, useToast } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLive } from '~/lib/live';
import { callName } from '~/lib/people';
import type { ShareMarks } from './marks';
import { popKind } from './popOut';
import { LOOK_ARIA, ShareLooks } from './shareLook';
import { ShareMarksDrawing, SharePointing, type PointingKeys } from './SharePointing';
import { ShareAway, ShareMenuFor, ShareSurface, ShareWindow } from './ShareSurface';
import { seatShares, type Leaf, type ShareLeaf } from './panels';
import { useSettledSpeakers } from './speakers';
import { MAX_FEATURED, arrange, fitGrid, isShareKey, isWaitKey, placeFrame, reslot, shareKey, steady, waitKey, type Handle, type Rect, type StageFrame } from './stageLayout';
import { TileMenu, type PersonMenu } from './TileMenu';
import { FeedVideo, type Feed } from './Video';
import type { CallView } from './view';
import type { CallTogether } from '~/features/workspace/context';
import type { VolumeActions } from './volume';
import { volumeTag } from './VolumeControl';

export interface StageParticipant {
  id: string;
  /** The same across their reconnections: what your own layout keeps them by. */
  seat: string;
  person: Person; isMe: boolean; mic: boolean; hand: boolean; speaking: boolean;
  /** Their camera, when it's on and this browser plays their media. */
  video: Feed | null;
  /** How loud they are for you (0 to 1), or null for yourself and where the browser can't set it. */
  volume: number | null;
  /** In the call, but not yet in this browser's encrypted group, so none of their media plays here yet. */
  connecting: boolean;
}
/** What a tile shows of the workspace, by connection: Follow, Following, who's writing, and who was just tagged. */
export interface StageTogether extends CallTogether { lit: string | null; onFollow: (connection: string) => void; onStop: () => void }

/** Something shared: whose it is (their participant ID), its feed, and what it's called. */
export interface StageShare {
  id: string;
  feed: Feed;
  /** Who shares it, shown in the arch beside the line on it: a share is never told apart by colour alone. */
  presenter: Person;
  mine: boolean;
  /** The line on it ("Ana is sharing"), and what menus call it ("Ana’s screen"). */
  label: string;
  name: string;
  /** The sound it carries, if any: muted for you or not, and the switch. Never for your own, which doesn't play here. */
  sound: { muted: boolean; toggle: () => void } | null;
  /**
   * Pointing at it: its picture's track sid, which pointers and marks name it by, and what keeps you from pointing at it
   * now, if anything (the organizer turned pointing off, or its presenter doesn't let others point). Null until the call's
   * room has it (your own share, until it's published).
   */
  point: { sid: string; closed: 'call' | 'presenter' | null } | null;
}
/** Someone rung who isn't in the call, waiting in a tile of their own: who, and what the tile shows. */
export interface StageWaiter { id: string; person: Person; tile: ReactNode }
/** About how wide "Aiko raised a hand" is. */
const HZ_WORDS = 150;
/** How long a share that just started keeps its glow class: longer than the glow itself (--duration-5), so it plays out. */
const NEW_MS = 3000;
/**
 * Open rooms, as the organizer oversees them: who's in each, who in a room raised a hand for help, and what its notes
 * are doing (on, paused on its own or with the whole call, or off).
 */
export interface StageRooms {
  rooms: { name: string; ids: string[]; help: string | null; notes: 'on' | 'paused' | 'off' }[];
  /** Everyone in no room: the organizer while there, guests, and anyone not sent to a room. */
  main: string[];
  /** The room you're in, or null for the main room. */
  joined: number | null;
  left: number;
  message: { from: Person; text: string } | null;
}

/** Everything glides to a new place together, panels and tiles alike: --duration-3 on --ease-out. */
export const GLIDE = { duration: 0.42, ease: [0.22, 0.8, 0.24, 1] } as const;
/** Someone coming in: the tiles make room slowly enough to see who it's for. */
const MAKE_ROOM = { duration: 0.9, ease: [0.45, 0, 0.2, 1] } as const;
const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const box = (r: Rect) => ({ left: r[0], top: r[1], width: r[2], height: r[3] });
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
/** Where a handle is along its space, 0 to 1, with the pointer on the middle of the line, snapping at half as every line does. */
const along = (hd: Handle, p: { x: number; y: number }) => {
  const room = Math.max(1, (hd.along === 'x' ? hd.area.w : hd.area.h) - 12);
  const v = ((hd.along === 'x' ? p.x - hd.area.x : p.y - hd.area.y) - 6) / room;
  return Math.abs(v - 0.5) * room < 8 ? 0.5 : v;
};
/** The corner a picture dropped at (x, y) goes to, or that Shift and an arrow move it to. */
function cornerAt(x: number, y: number, w: number, h: number): StageCorner {
  return `${y < h / 2 ? 'top' : 'bottom'}-${x < w / 2 ? 'left' : 'right'}`;
}
function cornerBy(c: StageCorner, key: string): StageCorner {
  const top = c.startsWith('top');
  const left = c.endsWith('left');
  if (key === 'ArrowLeft') return top ? 'top-left' : 'bottom-left';
  if (key === 'ArrowRight') return top ? 'top-right' : 'bottom-right';
  if (key === 'ArrowUp') return left ? 'top-left' : 'top-right';
  return left ? 'bottom-left' : 'bottom-right';
}

/**
 * What the stage shows, worked out above it so the panels can make room for it: everyone and everything shared, in order,
 * which shares are big, and the seat each of those has among the panels.
 */
export function useStagePlan({ people, waiting, shares, spotlight, view, part, paused, narrow, hold, apart }: {
  people: StageParticipant[];
  /** People rung who aren't in the call yet, each in a tile of their own after everyone who's here. */
  waiting: StageWaiter[];
  /** What's shared now, in any order: the stage keeps them in the order they started. */
  shares: StageShare[];
  spotlight: string | null;
  view: CallView;
  /** The part of the call this browser is in (`CallCrypto.place`: the main room or a breakout room): moving to another lets go of everything kept of every share. */
  part: string;
  /** The organizer has paused notes: no earlier pictures of shares are kept meanwhile. */
  paused: boolean;
  /** No room for two shares side by side, for big tiles, or for moving tiles about. */
  narrow: boolean;
  /** The workspace or the board has the room: a share waits as a tile until you bring it in. */
  hold: boolean;
  /** You set the people and shares apart: with a share big, they're panels of their own. */
  apart: boolean;
}) {
  const { prefs, layout: lay } = view;
  const talk = useSettledSpeakers(people);
  // Shares in the order they started here, so one that starts later never goes ahead of what's already shared.
  const seen = useRef(new Map<string, { n: number; at: number }>());
  const started = useRef(0);
  const live = new Set(shares.map((s) => s.id));
  for (const id of [...seen.current.keys()]) if (!live.has(id)) seen.current.delete(id);
  for (const s of shares) if (!seen.current.has(s.id)) seen.current.set(s.id, { n: ++started.current, at: performance.now() });
  const ordered = [...shares].sort((a, b) => (seen.current.get(a.id)?.n ?? 0) - (seen.current.get(b.id)?.n ?? 0));
  const now = performance.now();
  const fresh = (id: string) => now - (seen.current.get(id)?.at ?? 0) < NEW_MS;
  // Two shares side by side; one on a narrow stage, where two would each be too small to read.
  const fit = narrow ? 1 : MAX_FEATURED;
  const own = ordered.find((s) => s.mine)?.id ?? null;
  // How you look at each share (zoom, a picture held still, earlier pictures) and the one in its own window: this
  // screen's only, let go of when it goes, when your part of the call changes, and (earlier pictures) while notes are paused.
  const [looks] = useState(() => new ShareLooks());
  const seenLooks = useLive(looks);
  useEffect(() => () => looks.clear(), [looks]);
  useEffect(() => { looks.policy(part, paused); }, [looks, part, paused]);
  const popped = seenLooks.popped && shares.some((s) => s.id === seenLooks.popped?.id) ? seenLooks.popped.id : null;
  // The layout is worked out again only when something it depends on changes, not on every render (who's
  // speaking right now, a drag's pointer): in a big call it isn't free.
  const awaited = waiting.map((w) => ({ id: waitKey(w.id), seat: waitKey(w.id), isMe: false, waiting: true }));
  const peopleKey = [...people.map((p) => `${p.id} ${p.seat} ${p.isMe ? 1 : 0}`), ...awaited.map((w) => w.id)].join(',');
  const shareIds = ordered.map((s) => s.id).join(' ');
  const wasBig = useRef<string[]>([]);
  // `people` changes on every render (who's speaking); the plan only needs who's here, which peopleKey says.
  const raw = useMemo(() => arrange({ people: [...people, ...awaited], shares: shareIds ? shareIds.split(' ') : [], own, away: popped ? [popped] : [], fit, spotlight, speaker: talk.speaker, dominant: talk.dominant, prefs, layout: lay, hold, kept: wasBig.current, apart }),
    [peopleKey, shareIds, own, popped, fit, spotlight, talk.speaker, talk.dominant, prefs, lay, hold, apart]);
  // While Alcove picks who leads (Speaker view), whoever steps down takes the place of whoever steps up.
  const strip = useRef<{ order: string; auto: boolean; rest: string[] }>({ order: '', auto: false, rest: [] });
  const orderKey = lay.order.join(' ');
  const auto = raw.shape === 'focus' && raw.auto;
  const rest = auto && strip.current.auto && strip.current.order === orderKey ? steady(strip.current.rest, raw.rest) : raw.rest;
  strip.current = { order: orderKey, auto, rest };
  const restKey = rest.join(' ');
  const plan = useMemo(() => ({ ...raw, rest: restKey ? restKey.split(' ') : [], big: narrow ? new Set<string>() : raw.big }), [raw, restKey, narrow]);
  // Everything about a share that stopped goes at once, its window too; one shown as a tile goes back to live and its earlier pictures go.
  const othersKey = ordered.filter((s) => !s.mine).map((s) => s.id).join(' ');
  const keptKey = [...plan.featured, ...(popped ? [popped] : [])].join(' ');
  useEffect(() => { looks.sync(othersKey ? othersKey.split(' ') : [], keptKey ? keptKey.split(' ') : []); }, [looks, othersKey, keptKey]);
  // Each share big keeps its seat for as long as it's big, so another one coming or going moves nothing.
  const seated = useRef(new Map<string, ShareLeaf>());
  seated.current = seatShares(seated.current, plan.featured);
  wasBig.current = plan.featured;
  return { ordered, fresh, looks, seenLooks, popped, plan, shareSeats: seated.current, narrow, shareIds, speaker: talk.speaker };
}
export type StagePlan = ReturnType<typeof useStagePlan>;

export function Stage({ staged, frame, live: sizing, phone, people, waiting, shares, marks, me, whoIs, spotlight, view, organizer, together, bar, caption, rooms, onSpotlight, onPin, onSelf, onCustom, volumes, onShareStarted, onShareStopped, onPeopleMode, onPickUp, onGrowShare, onMorePeople }: {
  /** What it shows (`useStagePlan`). */
  staged: StagePlan;
  /** People working together in the workspace, by connection. */
  together: StageTogether;
  /** Where the panels put it. */
  frame: StageFrame;
  /** A line is being dragged: everything follows it at once. */
  live: boolean;
  phone: boolean;
  people: StageParticipant[];
  /** People rung who aren't in the call yet, each in a tile of their own after everyone who's here. */
  waiting: StageWaiter[];
  /** What's shared now, in any order: the stage keeps them in the order they started. */
  shares: StageShare[];
  /** Pointers and marks on what's shared (null before the room connects), who you are, and who anyone pointing is. */
  marks: ShareMarks | null;
  me: Person;
  whoIs: (id: string) => Person;
  spotlight: string | null;
  view: CallView;
  organizer: boolean;
  /** The status bar's pills: what you share, who is spotlighted. */
  bar: ReactNode;
  caption: ReactNode;
  rooms: StageRooms | null;
  onSpotlight: (id: string | null) => void;
  /** Pin someone for you, or unpin them. */
  onPin: (p: StageParticipant) => void;
  /** See yourself somewhere else. */
  onSelf: (where: SelfView) => void;
  /** The first time you arrange your own view. */
  onCustom: () => void;
  /** How loud someone is for you: your own playback only. */
  volumes: VolumeActions;
  /** Someone else's share started, and whether the layout shows it big for you; `show` shows it big. */
  onShareStarted: (s: StageShare, big: boolean, show: () => void) => void;
  /** Someone else's share stopped, and whether it was big for you. */
  onShareStopped: (s: StageShare, wasBig: boolean) => void;
  /** Fold the people to arches, back to tiles, or away. */
  onPeopleMode: (m: CallPeopleMode) => void;
  /** Pick a panel up from the keyboard: arrows choose where it goes. */
  onPickUp: (leaf: Leaf) => void;
  /** Give a share more of the room, or back: there's a button for it beside the workspace or the board. */
  onGrowShare: ((seat: ShareLeaf) => void) | null;
  /** Everyone there's no room to show: open People. */
  onMorePeople: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { ordered, fresh, looks, seenLooks, popped, plan, shareSeats, narrow, shareIds, speaker } = staged;
  const { prefs, layout: lay } = view;
  const { panels } = frame;
  const { x: fx, y: fy, w, h } = frame.box;
  const L = useMemo(() => placeFrame(plan, frame), [plan, frame]);

  /*
   * Someone rung arriving: the arch they waited in opens into their tile, from where it was, and the others make room.
   * Where each waited is kept by address, for the render they arrive in; anyone else coming in just makes room.
   */
  const arches = useRef(new Map<string, Rect>());
  for (const w of waiting) { const r = L.slots.get(waitKey(w.id)); if (r) arches.current.set(w.person.email.toLowerCase(), r); }
  const opening = useRef(new Map<string, { from: Rect; at: number }>());
  const moment = performance.now();
  for (const p of people) {
    const from = arches.current.get(p.person.email.toLowerCase());
    if (from && !opening.current.has(p.id)) opening.current.set(p.id, { from, at: moment });
  }
  const headcount = useRef({ n: people.length, grew: -Infinity });
  if (people.length > headcount.current.n) headcount.current.grew = moment;
  headcount.current.n = people.length;
  const pace = moment - headcount.current.grew < 1000 ? MAKE_ROOM : GLIDE;
  useEffect(() => {
    for (const p of people) arches.current.delete(p.person.email.toLowerCase());
    for (const [id, o] of opening.current) if (performance.now() - o.at > 1000) opening.current.delete(id);
  });

  const byId = new Map(people.map((p) => [p.id, p]));
  const seatOf = (id: string) => byId.get(id)?.seat;
  const seats = (ids: string[]) => ids.flatMap((id) => { const s = seatOf(id); return s ? [s] : []; });
  const pinned = new Set(plan.leads.filter((id) => lay.pins.includes(seatOf(id) ?? '')));
  // What a move rearranges: your pins among themselves, or everyone else in your order. A spotlight or Alcove's pick stays put.
  const pinGroup = plan.leads.filter((id) => pinned.has(id));
  const restGroup = plan.rest.filter((k) => !isShareKey(k) && !isWaitKey(k));
  const groupOf = (id: string) => (pinned.has(id) ? pinGroup : restGroup.includes(id) ? restGroup : null);
  // Dragging and resizing tiles: not on a phone, nor in a strip, nor among arches, nor while rooms are open.
  const handsOn = !narrow && plan.shape !== 'focus' && !rooms && (!panels || panels.mode === 'tiles');
  // Bigger tiles are the stage's: a panel of people keeps them all alike.
  const sizable = handsOn && !panels;
  const self = plan.self ? byId.get(plan.self.id) ?? null : null;
  const cornered = self && plan.self && !plan.self.folded ? self : null;
  // Shares big that are behind something else for now (they're taking turns): kept as they are, out of sight.
  const behind = new Set(plan.featured.filter((id) => !L.shares.has(id)));
  const focusables = [...plan.featured.filter((id) => !behind.has(id)).map(shareKey), ...plan.leads, ...plan.rest.filter((k) => !isWaitKey(k)), ...(cornered ? [cornered.id] : [])].filter((k) => !L.off.has(k));
  const canMove = !phone && !rooms;

  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ id: string; w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tabKey = focusKey && focusables.includes(focusKey) ? focusKey : focusables[0] ?? null;
  const els = useRef(new Map<string, HTMLDivElement>());
  const setEl = (k: string) => (el: HTMLDivElement | null) => { if (el) els.current.set(k, el); else els.current.delete(k); };
  const press = useRef<{ id: string; x: number; y: number; dx: number; dy: number; on: boolean; corner: boolean } | null>(null);
  const grow = useRef<{ id: string; x: number; y: number; w: number; h: number; big: boolean } | null>(null);
  const handle = useRef<'divider' | 'split' | null>(null);
  // Where a share was last, for while it's behind something else.
  const lastPlace = useRef(new Map<string, Rect>());
  /*
   * The share you're pointing at, by whoever shares it: one at a time, while it's big, live and open to you. Its keys
   * come first while you do (arrows move your pointer there rather than around the picture or to the next tile).
   */
  const [pointingAt, setPointingAt] = useState<string | null>(null);
  const pointKeys = useRef(new Map<string, PointingKeys>());
  const keySetters = useRef(new Map<string, (f: PointingKeys | null) => void>());
  const keysOf = (k: string) => {
    let set = keySetters.current.get(k);
    if (!set) {
      set = (f) => { if (f) pointKeys.current.set(k, f); else pointKeys.current.delete(k); };
      keySetters.current.set(k, set);
    }
    return set;
  };

  /** Puts `id` where `target` is in its group: your pins in a new order, or your order of everyone else. */
  const reorder = (g: string[], id: string, target: string) => {
    const next = g.filter((x) => x !== id);
    next.splice(g.indexOf(target), 0, id);
    if (pinned.has(id)) {
      const shown = seats(next);
      view.setPins([...shown, ...lay.pins.filter((s) => !shown.includes(s))]);
    } else {
      // The group's places in your order, in that order: the strip may show them steadied (Speaker view), not in order.
      const mine = seats(g);
      view.setOrder(reslot(plan.order, plan.order.filter((s) => mine.includes(s)), seats(next)));
    }
    onCustom();
  };
  const moveBy = (id: string, d: -1 | 1) => {
    const g = groupOf(id);
    const target = g?.[g.indexOf(id) + d];
    if (g && target !== undefined) reorder(g, id, target);
  };
  /** Shows a share big (beside what's big, or in place of the one that's been big longest when they don't all fit), or as a tile. */
  const toggleShare = (id: string, big: boolean) => { if (big) view.hideShare(id, plan.featured); else view.showShare(id, plan.featured); if (!onGrowShare) onCustom(); };
  const toggleBig = (p: StageParticipant) => { view.setBig(p.seat, !lay.big.includes(p.seat)); onCustom(); };
  const focusTo = (k: string | undefined) => { if (k === undefined) return; setFocusKey(k); els.current.get(k)?.focus(); };
  /** How you look at someone else's share you see big here (zoom, a picture held still): ShareSurface.tsx. */
  const lookOf = (s: StageShare) => ((L.shares.has(s.id) || behind.has(s.id)) && !s.mine && popped !== s.id && 'room' in s.feed ? looks.look(s.id) : null);
  /** A share you may point at now: open to you, shown big here (not in its own window), and live, not a picture held still. */
  const pointable = (s: StageShare) => s.point !== null && s.point.closed === null && L.shares.has(s.id) && popped !== s.id && !lookOf(s)?.getSnapshot().held;
  const pointingNow = pointingAt !== null && shares.some((s) => s.id === pointingAt && s.point !== null && s.point.closed === null && L.shares.has(s.id) && popped !== s.id) ? pointingAt : null;
  // A share that stops, goes back to a tile or to its own window, or closes to you (its presenter, or the organizer, said so) ends your pointing.
  useEffect(() => { if (pointingAt !== null && pointingNow === null) setPointingAt(null); }, [pointingAt, pointingNow]);
  /** Starts or stops pointing at a share, once however often it's said: focus goes to its tile, where its keys work. */
  const pointAt = (s: StageShare, on: boolean) => {
    if (on && !pointable(s)) return;
    setPointingAt((x) => (on ? s.id : x === s.id ? null : x));
    focusTo(shareKey(s.id));
  };
  const togglePointing = (s: StageShare) => pointAt(s, pointingAt !== s.id);
  // A share you brought back from its own window: focus comes back to its tile, where its keys work.
  const backN = seenLooks.back?.n ?? 0;
  useEffect(() => {
    const id = looks.getSnapshot().back?.id;
    if (!backN || !id) return;
    const k = shareKey(id);
    setFocusKey(k);
    els.current.get(k)?.focus({ preventScroll: true });
  }, [backN, looks]);
  /** Someone else's share in its own window, from the click that asked: the browser opens one only from a click. */
  const toast = useToast();
  const [canPop] = useState(popKind);
  const popOut = (s: StageShare) => {
    const pic = looks.look(s.id).getSnapshot().pic;
    void looks.popOut(s.id, s.name, pic.w > 0 && pic.h > 0 ? pic.w / pic.h : 1.6).then((r) => {
      if (r === 'blocked') toast(canPop === 'window' ? 'Your browser blocked the window. Allow pop-ups for Alcove, then try again.' : 'Your browser didn’t open the window. Try again.', { icon: 'pip' });
    });
  };

  const liveShares = new Set(shares.map((s) => s.id));
  const latest = useRef({ L, plan, view, onCustom, reorder, groupOf, fx, fy, w, h, live: liveShares, beside: !!onGrowShare });
  latest.current = { L, plan, view, onCustom, reorder, groupOf, fx, fy, w, h, live: liveShares, beside: !!onGrowShare };
  /** Shows a share big from a toast, later, beside whatever is big by then (unless it has stopped since). */
  const showLater = (id: string) => () => {
    const c = latest.current;
    if (!c.live.has(id)) return;
    c.view.showShare(id, c.plan.featured);
    if (!c.beside) c.onCustom();
  };

  /* Someone else's share starting or stopping is told to the call screen, which says so when it isn't plain to see. */
  const told = useRef<{ key: string; big: Map<string, { s: StageShare; big: boolean }> } | null>(null);
  useEffect(() => {
    const big = new Map(ordered.map((s) => [s.id, { s, big: plan.featured.includes(s.id) || popped === s.id }]));
    const was = told.current;
    told.current = { key: shareIds, big };
    if (!was || was.key === shareIds || rooms) return;
    for (const [id, x] of big) if (!was.big.has(id) && !x.s.mine) onShareStarted(x.s, x.big, showLater(id));
    for (const x of was.big.values()) if (!big.has(x.s.id) && !x.s.mine) onShareStopped(x.s, x.big);
  });

  /* Dragging a tile, its corner, a line beside a shared screen, or your own picture: the pointer moves anywhere on the page. */
  useEffect(() => {
    const local = (e: PointerEvent) => { const r = ref.current?.getBoundingClientRect(); return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }; };
    const move = (e: PointerEvent) => {
      const { L: lay2, view: vw, reorder: re, groupOf: groupFor } = latest.current;
      const p = local(e);
      if (handle.current === 'divider' && lay2.divider) { vw.setRatio(along(lay2.divider, p)); return; }
      if (handle.current === 'split' && lay2.split) { vw.setSplit(along(lay2.split, p)); return; }
      const g = grow.current;
      if (g) {
        const nw = Math.max(g.w * 0.5, g.w + e.clientX - g.x);
        const nh = Math.max(g.h * 0.5, g.h + e.clientY - g.y);
        setSize({ id: g.id, w: nw, h: nh });
        const by = Math.max(nw / g.w, nh / g.h);
        const want = g.big ? by > 0.72 : by > 1.35;
        if (want !== vw.layout.big.includes(g.id)) vw.setBig(g.id, want);
        return;
      }
      const d = press.current;
      if (!d) return;
      if (!d.on && Math.abs(p.x - d.x) + Math.abs(p.y - d.y) < 6) return;
      d.on = true;
      const x = p.x - d.dx;
      const y = p.y - d.dy;
      setDrag({ id: d.id, x, y });
      if (d.corner) return;
      const mine = lay2.slots.get(d.id);
      const group = groupFor(d.id);
      if (!mine || !group) return;
      const cx = x + mine[2] / 2;
      const cy = y + mine[3] / 2;
      let near: string | null = null;
      let best = Infinity;
      for (const k of group) {
        const r = lay2.slots.get(k);
        if (!r) continue;
        const dist = (r[0] + r[2] / 2 - cx) ** 2 + (r[1] + r[3] / 2 - cy) ** 2;
        if (dist < best) { best = dist; near = k; }
      }
      if (near && near !== d.id) re(group, d.id, near);
    };
    const up = (e: PointerEvent) => {
      const d = press.current;
      // Your corner is a standing choice, not part of the layout Reset puts back, so moving it isn't "arranging".
      const moved = (d?.on && !d.corner) || grow.current || handle.current;
      if (d?.on && d.corner) { const p = local(e); const c = latest.current; c.view.setCorner(cornerAt(p.x - c.fx, p.y - c.fy, c.w, c.h)); }
      press.current = null; grow.current = null; handle.current = null;
      setDrag(null); setSize(null);
      if (moved) latest.current.onCustom();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  }, [ref]);

  const startDrag = (e: ReactPointerEvent, id: string, corner = false) => {
    if (e.button !== 0 || rooms || (!corner && (!handsOn || !groupOf(id)))) return;
    if (e.target instanceof Element && e.target.closest('button, [data-handle]')) return;
    const r = corner ? L.self : L.slots.get(id);
    const at = ref.current?.getBoundingClientRect();
    if (!r || !at) return;
    const x = e.clientX - at.left;
    const y = e.clientY - at.top;
    press.current = { id, x, y, dx: x - r[0], dy: y - r[1], on: false, corner };
  };
  const startGrow = (e: ReactPointerEvent, p: StageParticipant) => {
    const r = L.slots.get(p.id);
    if (!r || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    grow.current = { id: p.seat, x: e.clientX, y: e.clientY, w: r[2], h: r[3], big: lay.big.includes(p.seat) };
  };

  /** A focused tile's keys: Enter its menu, P pin, G pick a share up to move it, Shift and an arrow move a tile, + and − size it, arrows go to the next tile. */
  const keysFor = (k: string) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const onTile = e.target === e.currentTarget;
    const key = e.key;
    const p = byId.get(k);
    const share = isShareKey(k) ? shares.find((s) => shareKey(s.id) === k) : undefined;
    const corner = cornered && k === cornered.id;
    // Pointing at a share: its keys first (arrows move your pointer, Enter marks, Backspace takes a mark back, Escape stops).
    if (share && pointingNow === share.id && onTile && pointKeys.current.get(k)?.(e)) { e.preventDefault(); e.stopPropagation(); return; }
    // Someone else's share you see big: + − 0 zoom, arrows move around while zoomed in, F freezes, comma and full stop step back and on.
    const closer = share && !share.mine && L.shares.has(share.id) && onTile && !(e.shiftKey && ARROWS.has(key));
    let done = true;
    const seat = share ? shareSeats.get(share.id) : undefined;
    if (closer && looks.look(share.id).key(key)) { /* done */ }
    else if ((key === 'l' || key === 'L') && !e.shiftKey && share && onTile && pointable(share)) togglePointing(share);
    else if ((key === 'g' || key === 'G') && !e.shiftKey && seat && canMove && onTile) onPickUp(seat);
    else if ((key === 'Enter' || key === ' ') && onTile) setMenu(k);
    else if (key === 'ContextMenu' || (key === 'F10' && e.shiftKey)) setMenu(k);
    else if ((key === 'p' || key === 'P') && !e.shiftKey) {
      // A share in its own window comes back here, big.
      if (share && popped === share.id) { looks.popIn(); toggleShare(share.id, false); }
      else if (share) toggleShare(share.id, L.shares.has(share.id));
      else if (p && !corner) onPin(p);
    } else if (e.shiftKey && ARROWS.has(key)) {
      if (corner) view.setCorner(cornerBy(prefs.corner, key));
      else moveBy(k, key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1);
    } else if (key === '+' || key === '=' || key === '-' || key === '_' || key === '−') {
      const big = key === '+' || key === '=';
      if (p && sizable && restGroup.includes(k) && lay.big.includes(p.seat) !== big) toggleBig(p);
    } else if (ARROWS.has(key)) focusTo(focusables[Math.max(0, Math.min(focusables.length - 1, focusables.indexOf(k) + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1)))]);
    else if (key === 'Home') focusTo(focusables[0]);
    else if (key === 'End') focusTo(focusables.at(-1));
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };
  const tileProps = (k: string, label: string) => ({
    ref: setEl(k), tabIndex: k === tabKey ? 0 : -1, role: 'group', 'aria-roledescription': 'tile', 'aria-label': `${label}. Enter for options`,
    'aria-keyshortcuts': 'Enter P Shift+ArrowLeft Shift+ArrowRight', onKeyDown: keysFor(k), onFocus: (e: ReactFocusEvent) => { if (e.target === e.currentTarget) setFocusKey(k); }
  });

  if (rooms) return <div ref={ref} className="ic-stage"><div className="ic-frame is-rooms" style={{ left: fx, top: fy, width: w, height: h }}><RoomsStage people={people} rooms={rooms} w={w} h={h} reduce={!!reduce} /></div></div>;

  const name = (p: StageParticipant) => (p.isMe ? <>{callName(p.person)} <span className="you">(you)</span></> : callName(p.person));
  const menuFor = (p: StageParticipant, corner: boolean): PersonMenu => {
    const g = groupOf(p.id);
    const at = g ? g.indexOf(p.id) : -1;
    const spot = spotlight === p.id;
    return {
      pinned: corner ? undefined : { on: pinned.has(p.id), toggle: () => onPin(p) },
      spotlight: organizer ? { on: spot, toggle: () => onSpotlight(spot ? null : p.id) } : undefined,
      ...(g && g.length > 1 ? { earlier: at > 0 ? () => moveBy(p.id, -1) : null, later: at < g.length - 1 ? () => moveBy(p.id, 1) : null } : {}),
      size: sizable && restGroup.includes(p.id) ? { big: lay.big.includes(p.seat), toggle: () => toggleBig(p) } : undefined,
      self: p.isMe ? { where: prefs.self, set: onSelf } : undefined,
      volume: p.volume === null ? undefined : { level: p.volume, set: (level) => volumes.set(p.id, level), toggle: () => volumes.toggle(p.id) },
      following: together.following === p.id ? { on: true, toggle: together.onStop } : together.followable.includes(p.id) ? { on: false, toggle: () => together.onFollow(p.id) } : undefined
    };
  };
  const nothing = !L.slots.size && !L.shares.size;
  const instant = reduce || sizing || !!handle.current;
  const glide = instant ? { duration: 0 } : pace;
  // Who's said to be talking, on the horizon: someone who's been at it a moment, as Speaker view counts it, so a quick "yes" moves nothing.
  const talking = (p: StageParticipant) => p.speaking && p.id === speaker;
  const loudOne = people.find((p) => p.hand) ?? people.find(talking);
  const onHorizon = !!panels && panels.mode === 'hidden';
  const ground = onHorizon ? [...L.slots.entries()].filter(([k]) => !L.off.has(k)).reduce((x, [, r]) => Math.max(x, r[0] + r[2]), 0) : 0;
  // The line saying so stands beside them, or past the dock when there's no room this side of it.
  const hzAt = !panels ? null : ground + 28 + HZ_WORDS < panels.horizon.dock ? ground + 28 : panels.horizon.dockEnd + 16 + HZ_WORDS < w ? panels.horizon.dockEnd + 16 : null;
  const peopleBar = L.people && canMove && !narrow && (panels ? panels.mode !== 'hidden' : plan.shape === 'side') && L.slots.size > 0;
  const folded = panels?.mode === 'arches';
  return (
    <div ref={ref} className="ic-stage">
      <motion.div className="ic-frame" initial={false} animate={box([fx, fy, w, h])} transition={glide}>
        <AnimatePresence>
          {bar && <motion.div key="bar" className="ic-sbar" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={UI}>{bar}</motion.div>}
        </AnimatePresence>
        {nothing && plan.self?.folded && (
          <div className="ic-stage-empty dark">
            <EmptyState title="You’re hidden from your view" action={<Button size="sm" icon="eye" onClick={() => onSelf('corner')}>Show me</Button>}>Anyone who joins sees you as usual.</EmptyState>
          </div>
        )}
        <AnimatePresence>
          {caption && <motion.div key="cap" className="ic-cap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={UI}>{caption}</motion.div>}
        </AnimatePresence>
      </motion.div>
      {ordered.map((s) => {
        const k = shareKey(s.id);
        const big = L.shares.get(s.id);
        const hidden = behind.has(s.id);
        const r = big ?? L.slots.get(k) ?? (hidden ? lastPlace.current.get(k) : undefined);
        if (!r) return null;
        lastPlace.current.set(k, r);
        const away = popped === s.id;
        const seat = shareSeats.get(s.id);
        const tileMode = big ? undefined : L.modes.get(k);
        // Someone else's share you see big can be looked at closer: zoomed, frozen, stepped back through.
        const look = lookOf(s);
        const surface = look && 'room' in s.feed ? { look, feed: s.feed } : null;
        const canPoint = pointable(s);
        const here = pointingNow === s.id;
        const said = [s.label, s.sound ? (s.sound.muted ? 'its sound muted for you' : 'with sound') : '', away ? 'in its own window, P brings it back' : big ? '' : 'a tile, P shows it big',
          here ? 'you’re pointing at it: arrow keys move your pointer, Enter marks, Backspace takes your last mark back, Escape stops' : canPoint ? 'L to point at it' : ''];
        const shortcuts = `Enter P${canPoint ? ' L' : ''}${big && canMove ? ' G' : ''}${look ? ` ${LOOK_ARIA}` : ''}`;
        return (
          <motion.div key={k} {...tileProps(k, said.filter(Boolean).join(', '))} aria-roledescription="shared screen" aria-keyshortcuts={shortcuts}
            aria-describedby={look ? `sv-${s.id}` : undefined}
            className={cn('ic-scr', !big && !hidden && 'is-tile', away && 'is-away', fresh(s.id) && 'is-new', here && 'is-pointing', hidden && 'is-behind', tileMode && `is-${tileMode}`, L.off.has(k) && 'is-off')}
            onClick={big || away ? undefined : (e) => {
              // Not a click in the menu it opened (React passes those up through the portal), nor on any of its buttons.
              if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
              if (!(e.target instanceof Element && e.target.closest('button'))) toggleShare(s.id, false);
            }}
            initial={{ ...box(r), opacity: 0 }} animate={{ ...box(r), opacity: 1 }} transition={glide}>
            {big && seat && canMove && <button type="button" className="ic-grab" tabIndex={-1} data-move={seat} aria-label={`Drag to move ${s.name}`} title="Drag to move" />}
            {(() => {
              if (away) return <ShareAway onBack={() => looks.popIn(true)} />;
              // Pointers and marks go on the picture: in a share you look at closer, on the picture it frames.
              const drawing = s.point && marks ? <ShareMarksDrawing marks={marks} share={s.point.sid} whoIs={whoIs} me={me} /> : null;
              const pointing = s.point && marks ? (
                <SharePointing marks={marks} share={s.point.sid} look={surface?.look ?? null} mine={s.mine} big={!!big} can={s.point.closed === null} active={here}
                  onKeys={keysOf(k)} onActive={(on) => pointAt(s, on)}>{surface ? null : drawing}</SharePointing>
              ) : null;
              return surface ? (
                <ShareSurface look={surface.look} feed={surface.feed} where="stage" label={s.name} describe={`sv-${s.id}`} popOut={canPop ? { open: false, toggle: () => popOut(s) } : null}
                  overLive={drawing}>{pointing}</ShareSurface>
              ) : <><FeedVideo feed={s.feed} className="screen" />{pointing}</>;
            })()}
            <span className="ac-tile-name">
              <Avatar person={s.presenter} size={18} /><span className="tl">{panels && !s.mine ? s.name : s.label}</span>
              {s.sound && <Icon name={s.sound.muted ? 'speakerOff' : 'speaker'} size={14} className="snd" />}
            </span>
            {!big && !away && !panels && <span className="ic-sgrow" aria-hidden="true"><Icon name="grow" size={18} /></span>}
            {!big && !away && panels && !tileMode && <button type="button" className="ic-showit" tabIndex={-1} onClick={() => toggleShare(s.id, false)}><Icon name="grow" size={13} /><span>Show it</span></button>}
            {big && panels && (
              <div className="ic-scr-ac">
                {onGrowShare && seat && <Tooltip label="Make it bigger" side="bottom"><button type="button" tabIndex={-1} aria-label="Make it bigger" onClick={() => onGrowShare(seat)}><Icon name="grow" size={15} /></button></Tooltip>}
                <Tooltip label="Back to a tile. Only you" side="bottom"><button type="button" tabIndex={-1} aria-label="Back to a tile" onClick={() => toggleShare(s.id, true)}><Icon name="x" size={15} /></button></Tooltip>
              </div>
            )}
            <ShareMenuFor look={look} presenter={s.presenter} label={s.name} open={menu === k} onOpenChange={(o) => setMenu(o ? k : null)} big={!!big}
              onToggle={() => toggleShare(s.id, !!big)} sound={s.sound} onMove={big && seat && canMove ? () => onPickUp(seat) : undefined}
              own={s.mine ? undefined : { open: away, toggle: away ? () => looks.popIn(true) : canPop ? () => popOut(s) : null, why: canPop ? null : 'Phones and tablets show shares in the call only.' }}
              point={s.point && !away ? { on: here, can: canPoint, closed: s.point.closed, held: false, toggle: () => togglePointing(s) } : null} />
          </motion.div>
        );
      })}
      {([['divider', L.divider], ['split', L.split]] as const).map(([kind, hd]) => hd && !narrow && (
        <motion.div key={kind} className={cn('ic-div', hd.along === 'y' && 'is-col')} role="separator" tabIndex={0} data-handle title="Drag to resize, double-click to even out"
          aria-orientation={hd.along === 'x' ? 'vertical' : 'horizontal'} aria-valuemin={Math.round((kind === 'divider' ? CALL_SHARE_ROOM : CALL_SHARE_SPLIT).min * 100)}
          aria-valuemax={Math.round((kind === 'divider' ? CALL_SHARE_ROOM : CALL_SHARE_SPLIT).max * 100)}
          aria-valuenow={Math.round((kind === 'divider' ? prefs.ratio : lay.split) * 100)}
          aria-label={kind === 'divider' ? 'Room for shared screens beside the people. Only your view changes' : 'Room for each of the two shared screens. Only your view changes'}
          initial={false} animate={hd.along === 'y' ? { left: hd.area.x, top: hd.y - 6, width: hd.area.w, height: 12 } : { left: hd.x - 6, top: hd.area.y, width: 12, height: hd.area.h }} transition={glide}
          onPointerDown={(e) => { e.preventDefault(); handle.current = kind; }}
          onDoubleClick={() => { if (kind === 'divider') view.setRatio(0.5); else view.setSplit(0.5); onCustom(); }}
          onKeyDown={(e) => {
            const now = kind === 'divider' ? prefs.ratio : lay.split;
            const less = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
            const more = e.key === 'ArrowRight' || e.key === 'ArrowDown';
            const next = less ? now - 0.03 : more ? now + 0.03 : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : e.key === 'Enter' ? (kind === 'divider' ? CALL_SHARE_ROOM : CALL_SHARE_SPLIT).start : null;
            if (next === null) return;
            e.preventDefault();
            if (kind === 'divider') view.setRatio(next); else view.setSplit(next);
            onCustom();
          }}><i /></motion.div>
      ))}
      {people.map((p) => {
        const corner = cornered?.id === p.id;
        const r = corner ? L.self : L.slots.get(p.id);
        if (!r) return null;
        const dragging = drag?.id === p.id;
        const growing = size?.id === p.seat;
        const pin = pinned.has(p.id);
        const spot = spotlight === p.id;
        const following = together.following === p.id;
        const mode = L.modes.get(p.id);
        const here = dragging ? { left: drag.x, top: drag.y, width: r[2], height: r[3] } : growing ? { left: r[0], top: r[1], width: size.w, height: size.h } : box(r);
        const opens = opening.current.get(p.id);
        const said = [p.isMe ? `${callName(p.person)} (you)` : callName(p.person), corner ? 'in your corner' : '', pin ? 'pinned for you' : '', spot ? 'spotlighted for everyone' : '', p.hand ? 'hand raised' : '', p.connecting ? 'connecting' : p.mic ? '' : 'microphone off', p.volume === null ? '' : volumeTag(p.volume)?.toLowerCase() ?? ''];
        return (
          <motion.div key={p.id} {...tileProps(p.id, said.filter(Boolean).join(', '))}
            className={cn('ic-slot', dragging && 'is-drag', growing && 'is-sizing', (corner || (handsOn && groupOf(p.id))) && 'can-drag', corner && 'is-corner', opens && 'rg-opens', mode && `is-${mode}`, mode === 'horizon' && (p.hand || talking(p)) && 'is-up', L.off.has(p.id) && 'is-off')}
            title={mode ? callName(p.person) : undefined}
            onPointerDown={(e) => startDrag(e, p.id, corner)}
            onClick={mode ? (e) => { if (e.target instanceof Node && e.currentTarget.contains(e.target)) setMenu(p.id); } : undefined}
            initial={opens ? { ...box(opens.from), opacity: 1, scale: 1 } : { ...here, opacity: 0, scale: 0.97 }} animate={{ ...here, opacity: 1, scale: dragging && !corner ? 1.03 : 1 }}
            transition={instant || dragging || growing ? { duration: 0 } : { ...pace, opacity: UI, scale: UI }}>
            <CallTile person={p.person} name={name(p)} label={p.person.name} speaking={p.speaking} muted={!p.mic} hand={p.hand} connecting={p.connecting} className={cn(p.isMe && 'is-me', pin && 'is-pinned', spot && 'is-spot', following && 'is-followed', together.lit === p.id && 'is-lit')}
              chrome={(
                <>
                  {!corner && (
                    <div className="ic-tstate">
                      {together.writing.includes(p.id) && <span className="ic-tpen" aria-label="Writing"><Icon name="pen" size={12} /></span>}
                      {spot && (
                        <span className="ic-tch is-spot"><Icon name="spotlight" size={13} /><span className="tl">Spotlight · everyone</span>
                          {organizer && <button type="button" className="tx" aria-label="Stop spotlight for everyone" onClick={() => onSpotlight(null)}><Icon name="x" size={12} /></button>}
                        </span>
                      )}
                      {pin && (
                        <span className="ic-tch"><Icon name="pin" size={13} /><span className="tl">Pinned for you</span>
                          <button type="button" className="tx" aria-label={`Unpin ${callName(p.person)}`} onClick={() => onPin(p)}><Icon name="x" size={12} /></button>
                        </span>
                      )}
                      {p.volume !== null && p.volume < 1 && (
                        <span className="ic-tch"><Icon name={p.volume === 0 ? 'speakerOff' : 'speakerLow'} size={13} /><span className="tl">{volumeTag(p.volume)}</span>
                          <button type="button" className="tx" aria-label={`${callName(p.person)} back to full volume for you`} onClick={() => volumes.set(p.id, 1)}><Icon name="x" size={12} /></button>
                        </span>
                      )}
                    </div>
                  )}
                  {following && !mode && <span className="ic-ton"><Icon name="navigate" size={12} />Following</span>}
                  {!following && !mode && !corner && together.followable.includes(p.id) && (
                    <button type="button" className="ic-tfl" aria-label={`Follow ${callName(p.person)}`} onClick={() => together.onFollow(p.id)}><Icon name="navigate" size={13} /><span>Follow</span></button>
                  )}
                  <TileMenu who={p.person} me={p.isMe} open={menu === p.id} onOpenChange={(o) => setMenu(o ? p.id : null)} organizer={organizer} menu={menuFor(p, corner)} />
                  {sizable && restGroup.includes(p.id) && <span className="ic-rs" data-handle aria-hidden="true" onPointerDown={(e) => startGrow(e, p)}><Icon name="resize" size={14} /></span>}
                </>
              )}>
              {p.video ? <FeedVideo feed={p.video} /> : undefined}
            </CallTile>
          </motion.div>
        );
      })}
      <AnimatePresence>
        {waiting.map((w) => {
          const r = L.slots.get(waitKey(w.id));
          return r ? (
            <motion.div key={waitKey(w.id)} className={cn('ic-slot', L.off.has(waitKey(w.id)) && 'is-off')} initial={{ ...box(r), opacity: 0, scale: 0.97 }} animate={{ ...box(r), opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              transition={instant ? { duration: 0 } : { ...pace, opacity: UI, scale: UI }}>{w.tile}</motion.div>
          ) : null;
        })}
      </AnimatePresence>
      {self && plan.self?.folded && L.self && (
        <Tooltip label="Show yourself. Everyone else sees you either way" side="top">
          <motion.button key="self-chip" type="button" className="ic-selfchip" aria-label="Show yourself. Only your view changes" onClick={() => onSelf('corner')}
            initial={{ ...box(L.self), opacity: 0 }} animate={{ ...box(L.self), opacity: 1 }} transition={instant ? { duration: 0 } : { ...GLIDE, opacity: UI }}>
            <Avatar person={self.person} size={22} /><span>You</span><Icon name="eye" size={15} />
          </motion.button>
        </Tooltip>
      )}
      {L.more && (
        <motion.button key="more" type="button" className={cn('ic-tmore', `is-${L.more.mode}`)} aria-label={`${L.more.n} more in the call. Open People`} title="Open People" onClick={onMorePeople}
          initial={false} animate={box(L.more.rect)} transition={glide}>+{L.more.n}</motion.button>
      )}
      {peopleBar && L.people && (
        <div className="ic-ppl" role="toolbar" aria-label="People" style={{ left: L.people.x + L.people.w / 2, top: L.people.y + 6 }}>
          <button type="button" className="b is-grab" data-move="people" aria-label="Drag to move people" title="Drag to move"><Icon name="grip" size={14} /></button>
          <button type="button" className="b" aria-label={folded ? 'Show as tiles' : 'Fold to arches'} title={folded ? 'Show as tiles' : 'Fold to arches'} onClick={() => onPeopleMode(folded ? 'tiles' : 'arches')}><Icon name={folded ? 'grow' : 'shrink'} size={14} /></button>
          <button type="button" className="b" aria-label="Hide people" title="Hide people (⇧P)" aria-keyshortcuts="Shift+P" onClick={() => onPeopleMode('hidden')}><Icon name="eyeOff" size={14} /></button>
        </div>
      )}
      {onHorizon && panels && loudOne && hzAt !== null && (
        <span className="ic-hz" style={{ left: hzAt, top: panels.horizon.base - 24 }}>{callName(loudOne.person)} {loudOne.hand ? 'raised a hand' : 'is talking'}</span>
      )}
      {seenLooks.popped && popped && (() => {
        const s = ordered.find((x) => x.id === popped);
        const win = seenLooks.popped;
        return s && 'room' in s.feed ? createPortal(
          <ShareWindow look={looks.look(s.id)} feed={s.feed} presenter={s.presenter} name={s.name} kind={win.kind} onBack={() => looks.popIn(true)}
            over={s.point && marks ? <ShareMarksDrawing marks={marks} share={s.point.sid} whoIs={whoIs} me={me} /> : null} />, win.win.document.body
        ) : null;
      })()}
    </div>
  );
}

/** Rooms are open: the main room while anyone is in it, and each room with the people in it. */
function RoomsStage({ people, rooms, w, h, reduce }: { people: StageParticipant[]; rooms: StageRooms; w: number; h: number; reduce: boolean }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const top = 52;
  const port = w < h * 0.9;
  const gap = port ? 10 : 14;
  const units = [
    ...(rooms.main.length ? [{ room: -1, weight: rooms.main.length > 1 ? 1 : 0.5, ids: rooms.main }] : []),
    ...rooms.rooms.map((r, k) => ({ room: k, weight: 1, ids: r.ids }))
  ];
  const total = units.reduce((n, u) => n + u.weight, 0);
  const avail = (port ? h - top : w) - (units.length - 1) * gap;
  let cur = port ? top : 0;
  const placed = units.map((u) => {
    const s = (avail * u.weight) / Math.max(1, total);
    const card: Rect = port ? [0, cur, w, s] : [cur, top, s, h - top];
    cur += s + gap;
    const grid = fitGrid(u.ids.length, card[0] + 12, card[1] + 55, card[2] - 24, card[3] - 67, port ? 1.3 : 0.9, 10);
    return { ...u, card, tiles: u.ids.map((id, k) => ({ id, r: grid[k] })) };
  });
  const soon = rooms.left <= 30;
  const t = mmss(rooms.left);
  return (
    <>
      <div className="ic-lane">
        <AnimatePresence mode="wait" initial={false}>
          {rooms.message ? (
            <motion.div key={`m-${rooms.message.text}`} className="ic-banner" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={UI}>
              <Avatar person={rooms.message.from} size={24} /><span><b>{callName(rooms.message.from)}</b> to all rooms: {rooms.message.text}</span>
            </motion.div>
          ) : (
            <motion.span key="quiet" className={cn('quiet', soon && 'is-soon')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI}>
              <Icon name={soon ? 'timer' : 'door'} size={16} />
              {soon ? `Rooms close in ${t}. Everyone comes back here.` : `${rooms.joined === null ? 'You’re in the main room' : `You’re in ${rooms.rooms[rooms.joined]?.name ?? 'a room'}`} · everyone comes back in ${t}`}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {placed.map((u, k) => {
        const room = u.room >= 0 ? rooms.rooms[u.room] : undefined;
        const here = rooms.joined === (room ? u.room : null);
        const justMe = !room && u.ids.length === 1 && byId.get(u.ids[0] ?? '')?.isMe === true;
        return (
          <motion.div key={`card-${u.room}`} className={cn('ic-roomc', u.room < 0 && 'is-main', here && room && 'is-here', room?.help && 'has-help')}
            initial={{ ...box(u.card), opacity: 0, scale: 0.97 }} animate={{ ...box(u.card), opacity: 1, scale: 1 }} transition={reduce ? { duration: 0 } : { ...GLIDE, delay: k * 0.03 }}>
            {room && <div className="bar" style={{ background: ROOMBAR[u.room % ROOMBAR.length] }} />}
            <div className="h">
              <b>{room ? room.name : 'Main room'}</b>
              <span>{justMe ? 'you' : `${u.ids.length} ${u.ids.length === 1 ? 'person' : 'people'}`}</span>
              {here && !justMe && <span className="here">· you’re here</span>}
              {room?.help && <span className="hand-chip"><Icon name="hand" size={13} />{callName(byId.get(room.help)?.person ?? { name: 'Someone', email: '' })} asked for help</span>}
              {room && <span className="ac-time">{t}</span>}
              {room?.notes === 'on' && <NotesSign stage>Notes</NotesSign>}
              {room?.notes === 'paused' && <CaptureSign mode="paused" stage />}
            </div>
            {!u.ids.length && <p className="empty">Nobody in this room</p>}
          </motion.div>
        );
      })}
      {placed.flatMap((u) => u.tiles).map(({ id, r }) => {
        const p = byId.get(id);
        if (!p || !r) return null;
        return (
          <motion.div key={id} className="ic-slot" initial={{ ...box(r), opacity: 0 }} animate={{ ...box(r), opacity: 1 }} transition={reduce ? { duration: 0 } : GLIDE}>
            <CallTile person={p.person} name={p.isMe ? <>{callName(p.person)} <span className="you">(you)</span></> : callName(p.person)} speaking={p.speaking} muted={!p.mic} hand={p.hand} connecting={p.connecting}>
              {p.video ? <FeedVideo feed={p.video} /> : undefined}
            </CallTile>
          </motion.div>
        );
      })}
    </>
  );
}
const ROOMBAR = ['linear-gradient(90deg,var(--dawn-2),var(--dawn-3))', 'linear-gradient(90deg,var(--dawn-3),var(--dawn-4))', 'linear-gradient(90deg,var(--dawn-1),var(--dawn-2))'];
