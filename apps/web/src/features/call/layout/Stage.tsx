/*
 * The stage: everyone's tiles, what's presented and isn't on your stage (a tile with the people, which takes you back to it),
 * the bar that says what's spotlighted, and the captions. It's one layer over the whole of the call's area, so that nothing
 * playing ever remounts as the frames around it (frame.tsx) come and go: tiles sit where the layout engine (stageLayout.ts)
 * puts them and glide there. Your own view (view.ts): drag tiles into another order, make one bigger from its corner, pin
 * people, and see yourself in the grid, in a corner or not at all. Every tile can be focused, then pinned, moved and sized
 * from the keyboard (its ⋯ menu says how). All of that changes your view only. With rooms open, the organizer's stage shows
 * every room, beside what's open on it; everyone else's shows the people in their own room.
 *
 * Beside what's open on your stage, the people sit as View says: as a column of tiles, as arches, or small on the horizon
 * beside the dock, where whoever's talking or has a hand up rises. A small toolbar over them folds them to arches, or hides
 * them.
 */
import type { CallPeopleMode, Person, SelfView, StageCorner } from '@alcove/api';
import { Avatar, Button, CallTile, CaptureSign, EmptyState, Icon, NotesSign, PresentedTile, Tooltip, WsPersonCard, WsPopover, cn, volumeTag, type IconName } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { callName } from '~/lib/people';
import { useSettledSpeakers } from '../media/speakers';
import { arrange, fitGrid, isThingKey, isWaitKey, placeFrame, reslot, steady, thingKey, waitKey, type Rect, type StageFrame } from './stageLayout';
import { ThingMenu, TileMenu, type PersonMenu } from './TileMenu';
import { FeedVideo, type Feed } from '../media/Video';
import type { CallView } from './view';
import type { CallTogether } from '~/features/workspace/context';
import type { VolumeActions } from '../media/volume';

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
/**
 * What a tile shows of the workspace, by connection: Follow, Following, who's writing, and who was just tagged. On a phone,
 * someone's arch opens their card instead, with Go there and Tag as well.
 */
export interface StageTogether extends CallTogether {
  lit: string | null; onFollow: (connection: string) => void; onStop: () => void;
  onGo: (connection: string) => void; onTag: (connection: string) => void;
  /** A document is open here that you can write in, so you can tag someone in it. */
  canTag: () => boolean;
}

/** A screen someone shares: whose it is (their participant ID), its feed, and what it's called. */
export interface StageShare {
  id: string;
  feed: Feed;
  /** Who shares it, shown in the arch beside the line on it: a share is never told apart by colour alone. */
  presenter: Person;
  mine: boolean;
  /** What it says of itself ("Ana is sharing"), and what menus call it ("Ana’s screen"). */
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
/** Something presented that isn't on your stage: its tile among the people, which takes you back to it. */
export interface StagePresented {
  /** Which it is (onStage.ts `ThingId`): its tile's key is `thingKey(id)`. */
  id: string;
  name: string;
  icon: IconName;
  /** "Priya is presenting", "You’re presenting". */
  sub: string;
  by: Person;
  go: 'Join' | 'Open';
  /** What pressing it does: "Join Launch retro", "Go back to Your screen". */
  label: string;
  /** Where its presenter is, for a calm tile with no picture: "Launch plan". */
  where?: string | undefined;
  /** Its live picture, drawn at the tile's size. */
  mini: ((w: number, h: number) => ReactNode) | null;
  onJoin: () => void;
  /** Its ⋯ menu: show it beside what's on your stage, and its sound. */
  beside: (() => void) | null;
  sound: { muted: boolean; toggle: () => void } | null;
  /** It just landed here while you watch something else: it glows where it lands. */
  fresh: boolean;
}
/** About how wide "Aiko raised a hand" is. */
const HZ_WORDS = 150;
/**
 * Open rooms, as the organizer oversees them: who's in each, who in a room raised a hand for help, and what its notes
 * are doing (on, paused on its own or with the whole call, or off).
 */
export interface StageRooms {
  /** Each room: who's in it, who asked for help, its notes, and whether it's on a board of its own, sealed to it. */
  rooms: { name: string; ids: string[]; help: string | null; notes: 'on' | 'paused' | 'off'; board: boolean }[];
  /** Everyone in no room: the organizer while there, guests, and anyone not sent to a room. */
  main: string[];
  /** The room you're in, or null for the main room. */
  joined: number | null;
  left: number;
  /** The rooms are worked on boards, so they take the board's words. Rooms without say what they always have. */
  boards: boolean;
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

/** What the stage shows, worked out above it so the frames can make room for it: everyone, and what's presented that isn't on your stage. */
export function useStagePlan({ people, waiting, tiles, spotlight, view, narrow, hold }: {
  people: StageParticipant[];
  /** People rung who aren't in the call yet, each in a tile of their own after everyone who's here. */
  waiting: StageWaiter[];
  /** What's presented and isn't on your stage, by its id, in the order it started: tiles first among the people. */
  tiles: string[];
  spotlight: string | null;
  view: CallView;
  /** No room for big tiles, or for moving tiles about. */
  narrow: boolean;
  /** Something is open on your stage: the people sit beside it. */
  hold: boolean;
}) {
  const { prefs, layout: lay } = view;
  const talk = useSettledSpeakers(people);
  // The layout is worked out again only when something it depends on changes, not on every render (who's
  // speaking right now, a drag's pointer): in a big call it isn't free.
  const awaited = waiting.map((w) => ({ id: waitKey(w.id), seat: waitKey(w.id), isMe: false, waiting: true }));
  const peopleKey = [...people.map((p) => `${p.id} ${p.seat} ${p.isMe ? 1 : 0}`), ...awaited.map((w) => w.id)].join(',');
  const tilesKey = tiles.join(' ');
  // `people` changes on every render (who's speaking); the plan only needs who's here, which peopleKey says.
  const raw = useMemo(() => arrange({
    people: [...people, ...awaited], tiles: tilesKey ? tilesKey.split(' ').map(thingKey) : [], spotlight, speaker: talk.speaker, dominant: talk.dominant, prefs, layout: lay, hold
  }), [peopleKey, tilesKey, spotlight, talk.speaker, talk.dominant, prefs, lay, hold]);
  // While Alcove picks who leads (Speaker view), whoever steps down takes the place of whoever steps up.
  const strip = useRef<{ order: string; auto: boolean; rest: string[] }>({ order: '', auto: false, rest: [] });
  const orderKey = lay.order.join(' ');
  const auto = raw.shape === 'focus' && raw.auto;
  const rest = auto && strip.current.auto && strip.current.order === orderKey ? steady(strip.current.rest, raw.rest) : raw.rest;
  strip.current = { order: orderKey, auto, rest };
  const restKey = rest.join(' ');
  const plan = useMemo(() => ({ ...raw, rest: restKey ? restKey.split(' ') : [], big: narrow ? new Set<string>() : raw.big }), [raw, restKey, narrow]);
  return { plan, narrow, speaker: talk.speaker };
}
export type StagePlan = ReturnType<typeof useStagePlan>;

/** What the stage does for the board on your stage: finding people on it from their tiles. */
export interface StageBoard {
  /** Go to and Follow on someone's menu, for someone who's on the board. */
  find: (p: StageParticipant) => PersonMenu['board'];
}

export function Stage({ staged, frame, phone, people, waiting, presented, spotlight, view, organizer, together, bar, caption, rooms, onSpotlight, onPin, onSelf, onCustom, volumes, onPeopleMode, onMorePeople, board = null }: {
  /** What it shows (`useStagePlan`). */
  staged: StagePlan;
  /** People working together in the workspace, by connection. */
  together: StageTogether;
  /** Where the main area puts it. */
  frame: StageFrame;
  phone: boolean;
  people: StageParticipant[];
  /** People rung who aren't in the call yet, each in a tile of their own after everyone who's here. */
  waiting: StageWaiter[];
  /** What's presented and isn't on your stage, as tiles. */
  presented: StagePresented[];
  spotlight: string | null;
  view: CallView;
  organizer: boolean;
  /** The status bar's pills: who is spotlighted, the sound held back, the rooms. */
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
  /** Fold the people to arches, back to tiles, or away. */
  onPeopleMode: (m: CallPeopleMode) => void;
  /** Everyone there's no room to show: open People. */
  onMorePeople: () => void;
  /** The board on your stage, or null. */
  board?: StageBoard | null | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { plan, narrow, speaker } = staged;
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
  const restGroup = plan.rest.filter((k) => !isThingKey(k) && !isWaitKey(k));
  const groupOf = (id: string) => (pinned.has(id) ? pinGroup : restGroup.includes(id) ? restGroup : null);
  // Dragging and resizing tiles: not on a phone, nor in a strip, nor among arches, nor while rooms are open.
  const handsOn = !narrow && plan.shape !== 'focus' && !rooms && (!panels || panels.mode === 'tiles');
  // Bigger tiles are the stage's: a column of people keeps them all alike.
  const sizable = handsOn && !panels;
  const self = plan.self ? byId.get(plan.self.id) ?? null : null;
  const cornered = self && plan.self && !plan.self.folded ? self : null;
  const focusables = [...plan.leads, ...plan.rest.filter((k) => !isWaitKey(k)), ...(cornered ? [cornered.id] : [])].filter((k) => !L.off.has(k));
  // The people's own small toolbar: not on a phone, nor while the rooms hold the stage.
  const canFold = !phone && !rooms;

  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ id: string; w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  /** Whose card is open, from their arch on a phone: the same choices a tile gives you on a laptop, in a sheet. */
  const [card, setCard] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tabKey = focusKey && focusables.includes(focusKey) ? focusKey : focusables[0] ?? null;
  const els = useRef(new Map<string, HTMLDivElement>());
  const setEl = (k: string) => (el: HTMLDivElement | null) => { if (el) els.current.set(k, el); else els.current.delete(k); };
  const press = useRef<{ id: string; x: number; y: number; dx: number; dy: number; on: boolean; corner: boolean } | null>(null);
  const grow = useRef<{ id: string; x: number; y: number; w: number; h: number; big: boolean } | null>(null);

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
  const toggleBig = (p: StageParticipant) => { view.setBig(p.seat, !lay.big.includes(p.seat)); onCustom(); };
  const focusTo = (k: string | undefined) => { if (k === undefined) return; setFocusKey(k); els.current.get(k)?.focus(); };

  const latest = useRef({ L, view, onCustom, reorder, groupOf, fx, fy, w, h });
  latest.current = { L, view, onCustom, reorder, groupOf, fx, fy, w, h };

  /* Dragging a tile, its corner, or your own picture: the pointer moves anywhere on the page. */
  useEffect(() => {
    const local = (e: PointerEvent) => { const r = ref.current?.getBoundingClientRect(); return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }; };
    const move = (e: PointerEvent) => {
      const { L: lay2, view: vw, reorder: re, groupOf: groupFor } = latest.current;
      const p = local(e);
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
      const moved = (d?.on && !d.corner) || grow.current;
      if (d?.on && d.corner) { const p = local(e); const c = latest.current; c.view.setCorner(cornerAt(p.x - c.fx, p.y - c.fy, c.w, c.h)); }
      press.current = null; grow.current = null;
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

  /**
   * A focused tile's keys: Enter its menu, P pin, Shift and an arrow move a tile, + and − size it, arrows go to the next tile.
   * On something presented, Enter or P takes you to it.
   */
  const keysFor = (k: string) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const onTile = e.target === e.currentTarget;
    const key = e.key;
    const p = byId.get(k);
    const thing = isThingKey(k) ? presented.find((t) => thingKey(t.id) === k) : undefined;
    const corner = cornered && k === cornered.id;
    let done = true;
    if (thing && onTile && (key === 'Enter' || key === ' ' || ((key === 'p' || key === 'P') && !e.shiftKey))) thing.onJoin();
    else if ((key === 'Enter' || key === ' ') && onTile) setMenu(k);
    else if (key === 'ContextMenu' || (key === 'F10' && e.shiftKey)) setMenu(k);
    else if ((key === 'p' || key === 'P') && !e.shiftKey) { if (p && !corner) onPin(p); }
    else if (e.shiftKey && ARROWS.has(key)) {
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
  /** A tile's group, one tab stop among the tiles: what it says, and the keys it takes. A presented thing's Enter puts it on your stage. */
  const tileProps = (k: string, label: string, thing?: { menu: boolean }) => ({
    ref: setEl(k), tabIndex: k === tabKey ? 0 : -1, role: 'group', 'aria-roledescription': thing ? 'presented' : 'tile', 'aria-label': thing ? label : `${label}. Enter for options`,
    'aria-keyshortcuts': thing ? `Enter P${thing.menu ? ' Shift+F10' : ''}` : 'Enter P Shift+ArrowLeft Shift+ArrowRight', onKeyDown: keysFor(k),
    onFocus: (e: ReactFocusEvent) => { if (e.target === e.currentTarget) setFocusKey(k); }
  });

  // The rooms hold the whole stage, or stand beside what's open on it, and glide between the two.
  if (rooms) return (
    <div ref={ref} className="ic-stage">
      <motion.div className="ic-frame is-rooms" initial={false} animate={{ left: fx, top: fy, width: w, height: h }} transition={reduce ? { duration: 0 } : GLIDE}>
        <RoomsStage people={people} rooms={rooms} w={w} h={h} reduce={!!reduce} />
      </motion.div>
    </div>
  );

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
      following: together.following === p.id ? { on: true, toggle: together.onStop } : together.followable.includes(p.id) ? { on: false, toggle: () => together.onFollow(p.id) } : undefined,
      board: board?.find(p)
    };
  };
  const nothing = !L.slots.size;
  const instant = reduce;
  const glide = instant ? { duration: 0 } : pace;
  // Who's said to be talking, on the horizon: someone who's been at it a moment, as Speaker view counts it, so a quick "yes" moves nothing.
  const talking = (p: StageParticipant) => p.speaking && p.id === speaker;
  const loudOne = people.find((p) => p.hand) ?? people.find(talking);
  const onHorizon = !!panels && panels.mode === 'hidden';
  const ground = onHorizon ? [...L.slots.entries()].filter(([k]) => !L.off.has(k)).reduce((x, [, r]) => Math.max(x, r[0] + r[2]), 0) : 0;
  // The line saying so stands beside them, or past the dock when there's no room this side of it.
  const hzAt = !panels ? null : ground + 28 + HZ_WORDS < panels.horizon.dock ? ground + 28 : panels.horizon.dockEnd + 16 + HZ_WORDS < w ? panels.horizon.dockEnd + 16 : null;
  const peopleBar = L.people && canFold && !narrow && panels && panels.mode !== 'hidden' && L.slots.size > 0;
  const folded = panels?.mode === 'arches';
  const carded = card === null ? null : people.find((p) => p.id === card && !p.isMe) ?? null;
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
      <AnimatePresence>
        {presented.map((t) => {
          const k = thingKey(t.id);
          const r = L.slots.get(k);
          if (!r) return null;
          const mode = L.modes.get(k);
          return (
            <motion.div key={k} {...tileProps(k, `${t.label}. ${t.sub}`, { menu: mode === undefined && (t.beside !== null || t.sound !== null) })} data-tile={t.id} className={cn('ic-slot ic-pslot', mode && `is-${mode}`, L.off.has(k) && 'is-off')}
              initial={{ ...box(r), opacity: 0, scale: 0.97 }} animate={{ ...box(r), opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
              transition={instant ? { duration: 0 } : { ...pace, opacity: UI, scale: UI }}>
              <PresentedTile name={t.name} icon={t.icon} sub={t.sub} by={t.by} go={t.go} label={t.label} where={t.where} small={mode !== undefined} tabIndex={-1} className={t.fresh ? 'is-new' : undefined} onPress={t.onJoin}>
                {mode === undefined && t.mini ? t.mini(r[2], r[3]) : undefined}
              </PresentedTile>
              {mode === undefined && (t.beside || t.sound) && (
                <ThingMenu name={t.name} by={t.by} open={menu === k} onOpenChange={(o) => setMenu(o ? k : null)} onJoin={t.onJoin} go={t.go} beside={t.beside} sound={t.sound} />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
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
            onClick={mode || (board?.find(p) && !corner) ? (e) => {
              if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target) || (e.target instanceof Element && e.target.closest('button'))) return;
              // On a phone, someone you can follow in the workspace gets their card, unless the board is what's open to find them on.
              if (phone && !p.isMe && !board?.find(p) && (together.followable.includes(p.id) || together.following === p.id)) setCard(p.id);
              else setMenu(p.id);
            } : undefined}
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
                    <button type="button" className="ic-tfl" tabIndex={-1} aria-label={`Follow ${callName(p.person)}`} onClick={() => together.onFollow(p.id)}><Icon name="navigate" size={13} /><span>Follow</span></button>
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
          <button type="button" className="b" aria-label={folded ? 'Show as tiles' : 'Fold to arches'} title={folded ? 'Show as tiles' : 'Fold to arches'} onClick={() => onPeopleMode(folded ? 'tiles' : 'arches')}><Icon name={folded ? 'grow' : 'shrink'} size={14} /></button>
          <button type="button" className="b" aria-label="Hide people" title="Hide people (⇧P)" aria-keyshortcuts="Shift+P" onClick={() => onPeopleMode('hidden')}><Icon name="eyeOff" size={14} /></button>
        </div>
      )}
      {onHorizon && panels && loudOne && hzAt !== null && (
        <span className={cn('ic-hz', hzAt > panels.horizon.dock && 'is-past')} style={{ left: hzAt, top: panels.horizon.base - 24 }}>{callName(loudOne.person)} {loudOne.hand ? 'raised a hand' : 'is talking'}</span>
      )}
      {carded && (
        <WsPopover open at={() => els.current.get(carded.id)?.getBoundingClientRect() ?? new DOMRect()} label={callName(carded.person)} onOpenChange={(o) => { if (!o) setCard(null); }}>
          <WsPersonCard person={carded.person} where={together.where[carded.id] ?? 'Not in the workspace'} followed={together.following === carded.id}
            onFollow={() => { setCard(null); together.onFollow(carded.id); }} onStop={() => { setCard(null); together.onStop(); }}
            onGo={together.reachable.includes(carded.id) ? () => { setCard(null); together.onGo(carded.id); } : undefined}
            onTag={together.canTag() ? () => { setCard(null); together.onTag(carded.id); } : undefined}
            onOptions={() => { setCard(null); setMenu(carded.id); }} />
        </WsPopover>
      )}
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
    // A room on its board says so along the bottom, under its people.
    const foot = u.room >= 0 && rooms.rooms[u.room]?.board === true ? 30 : 0;
    const grid = fitGrid(u.ids.length, card[0] + 12, card[1] + 55, card[2] - 24, card[3] - 67 - foot, port ? 1.3 : 0.9, 10);
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
              <Avatar person={rooms.message.from} size={24} /><span><b>{callName(rooms.message.from)}</b>{rooms.boards ? ', to every room: ' : ' to all rooms: '}{rooms.message.text}</span>
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
            {room?.board && <p className="onb"><Icon name="presentation" size={15} /><span>On their board. Join to see it.</span></p>}
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
