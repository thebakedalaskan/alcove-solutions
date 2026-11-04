/*
 * The stage: everyone's tiles, what's shared, the bar that says what's shared or spotlighted, and the captions. Tiles
 * sit where the layout engine (stageLayout.ts) puts them and glide there. Your own view (view.ts): drag tiles into
 * another order, make one bigger from its corner, drag the line beside a shared screen, pin people, and see yourself
 * in the grid, in a corner or not at all. Every tile can be focused, then pinned, moved and sized from the keyboard
 * (its ⋯ menu says how). All of that changes your view only. With rooms open, the organizer's stage shows every
 * room; everyone else's shows the people in their own room.
 */
import { CALL_SHARE_ROOM, CALL_SHARE_SPLIT, type Person, type SelfView, type StageCorner } from '@alcove/api';
import { Avatar, Button, CallTile, EmptyState, Icon, NotesSign, Tooltip, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { callName } from '~/lib/people';
import { useSettledSpeakers } from './speakers';
import { arrange, fitGrid, isShareKey, place, reslot, shareKey, steady, type Handle, type Rect } from './stageLayout';
import { ShareMenu, TileMenu, type PersonMenu } from './TileMenu';
import { FeedVideo, type Feed } from './Video';
import type { CallView } from './view';
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
}
/** Something shared: whose it is (their participant ID), its feed, the line on it, and what menus call it. */
export interface StageShare { id: string; feed: Feed; label: string; name: string }
/** Open rooms, as the organizer oversees them: who's in each, and who in a room raised a hand for help. */
export interface StageRooms {
  rooms: { name: string; ids: string[]; help: string | null }[];
  /** Everyone in no room: the organizer while there, guests, and anyone not sent to a room. */
  main: string[];
  /** The room you're in, or null for the main room. */
  joined: number | null;
  left: number;
  message: { from: Person; text: string } | null;
  notesOn: boolean;
}

const GLIDE = { duration: 0.5, ease: [0.45, 0, 0.2, 1] } as const;
const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const box = (r: Rect) => ({ left: r[0], top: r[1], width: r[2], height: r[3] });
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
/** Where a handle is along its space, 0 to 1. */
const along = (hd: Handle, p: { x: number; y: number }) => (hd.along === 'x' ? (p.x - hd.area.x) / Math.max(1, hd.area.w - 12) : (p.y - hd.area.y) / Math.max(1, hd.area.h - 12));
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

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

export function Stage({ people, shares, spotlight, view, organizer, bar, caption, rooms, onSpotlight, onPin, onSelf, onCustom, onVolume }: {
  people: StageParticipant[];
  /** What's shared now, oldest first. */
  shares: StageShare[];
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
  onVolume: (id: string, level: number) => void;
}) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const reduce = useReducedMotion();
  const narrow = w > 0 && w < 760;
  const { prefs, layout: lay } = view;
  const talk = useSettledSpeakers(people);
  // The layout is worked out again only when something it depends on changes, not on every render (who's
  // speaking right now, a drag's pointer): in a big call it isn't free.
  const peopleKey = people.map((p) => `${p.id} ${p.seat} ${p.isMe ? 1 : 0}`).join(',');
  const shareIds = shares.map((s) => s.id).join(' ');
  // `people` changes on every render (who's speaking); the plan only needs who's here, which peopleKey says.
  const raw = useMemo(() => arrange({ people, shares: shareIds ? shareIds.split(' ') : [], spotlight, speaker: talk.speaker, dominant: talk.dominant, prefs, layout: lay }),
    [peopleKey, shareIds, spotlight, talk.speaker, talk.dominant, prefs, lay]);
  // While Alcove picks who leads (Speaker view), whoever steps down takes the place of whoever steps up.
  const strip = useRef<{ order: string; auto: boolean; rest: string[] }>({ order: '', auto: false, rest: [] });
  const orderKey = lay.order.join(' ');
  const auto = raw.shape === 'focus' && raw.auto;
  const rest = auto && strip.current.auto && strip.current.order === orderKey ? steady(strip.current.rest, raw.rest) : raw.rest;
  strip.current = { order: orderKey, auto, rest };
  const restKey = rest.join(' ');
  const plan = useMemo(() => ({ ...raw, rest: restKey ? restKey.split(' ') : [], big: narrow ? new Set<string>() : raw.big }), [raw, restKey, narrow]);
  const top = bar ? 46 : 0;
  const bottom = caption ? (w < 700 ? 150 : 124) : 0;
  const L = useMemo(() => place(plan, { width: w, height: h, top, bottom, ratio: prefs.ratio, split: lay.split }), [plan, w, h, top, bottom, prefs.ratio, lay.split]);

  const byId = new Map(people.map((p) => [p.id, p]));
  const seatOf = (id: string) => byId.get(id)?.seat;
  const seats = (ids: string[]) => ids.flatMap((id) => { const s = seatOf(id); return s ? [s] : []; });
  const pinned = new Set(plan.leads.filter((id) => lay.pins.includes(seatOf(id) ?? '')));
  // What a move rearranges: your pins among themselves, or everyone else in your order. A spotlight or Alcove's pick stays put.
  const pinGroup = plan.leads.filter((id) => pinned.has(id));
  const restGroup = plan.rest.filter((k) => !isShareKey(k));
  const groupOf = (id: string) => (pinned.has(id) ? pinGroup : restGroup.includes(id) ? restGroup : null);
  // Dragging and resizing tiles: not on a phone, nor in a strip, nor while rooms are open.
  const handsOn = !narrow && plan.shape !== 'focus' && !rooms;
  const self = plan.self ? byId.get(plan.self.id) ?? null : null;
  const cornered = self && plan.self && !plan.self.folded ? self : null;
  const focusables = [...plan.featured.map(shareKey), ...plan.leads, ...plan.rest, ...(cornered ? [cornered.id] : [])];

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
  const toggleShare = (id: string, big: boolean) => { view.setShare(id, big ? 'tile' : 'big'); onCustom(); };
  const toggleBig = (p: StageParticipant) => { view.setBig(p.seat, !lay.big.includes(p.seat)); onCustom(); };
  const focusTo = (k: string | undefined) => { if (k === undefined) return; setFocusKey(k); els.current.get(k)?.focus(); };

  const latest = useRef({ L, view, onCustom, reorder, groupOf, w, h });
  latest.current = { L, view, onCustom, reorder, groupOf, w, h };

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
      if (d?.on && d.corner) { const p = local(e); latest.current.view.setCorner(cornerAt(p.x, p.y, latest.current.w, latest.current.h)); }
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

  /** A focused tile's keys: Enter its menu, P pin, Shift and an arrow move it, + and − size it, arrows go to the next tile. */
  const keysFor = (k: string) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const onTile = e.target === e.currentTarget;
    const key = e.key;
    const p = byId.get(k);
    const share = isShareKey(k) ? shares.find((s) => shareKey(s.id) === k) : undefined;
    const corner = cornered && k === cornered.id;
    let done = true;
    if ((key === 'Enter' || key === ' ') && onTile) setMenu(k);
    else if (key === 'ContextMenu' || (key === 'F10' && e.shiftKey)) setMenu(k);
    else if ((key === 'p' || key === 'P') && !e.shiftKey) {
      if (share) toggleShare(share.id, L.shares.has(share.id));
      else if (p && !corner) onPin(p);
    } else if (e.shiftKey && ARROWS.has(key)) {
      if (corner) view.setCorner(cornerBy(prefs.corner, key));
      else moveBy(k, key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1);
    } else if (key === '+' || key === '=' || key === '-' || key === '_' || key === '−') {
      const big = key === '+' || key === '=';
      if (p && handsOn && restGroup.includes(k) && lay.big.includes(p.seat) !== big) toggleBig(p);
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

  if (rooms) return <div ref={ref} className="ic-stage"><RoomsStage people={people} rooms={rooms} w={w} h={h} reduce={!!reduce} /></div>;

  const name = (p: StageParticipant) => (p.isMe ? <>{callName(p.person)} <span className="you">(you)</span></> : callName(p.person));
  const menuFor = (p: StageParticipant, corner: boolean): PersonMenu => {
    const g = groupOf(p.id);
    const at = g ? g.indexOf(p.id) : -1;
    const spot = spotlight === p.id;
    return {
      pinned: corner ? undefined : { on: pinned.has(p.id), toggle: () => onPin(p) },
      spotlight: organizer ? { on: spot, toggle: () => onSpotlight(spot ? null : p.id) } : undefined,
      ...(g && g.length > 1 ? { earlier: at > 0 ? () => moveBy(p.id, -1) : null, later: at < g.length - 1 ? () => moveBy(p.id, 1) : null } : {}),
      size: handsOn && restGroup.includes(p.id) ? { big: lay.big.includes(p.seat), toggle: () => toggleBig(p) } : undefined,
      self: p.isMe ? { where: prefs.self, set: onSelf } : undefined,
      volume: p.volume === null ? undefined : { level: p.volume, set: (level) => onVolume(p.id, level) }
    };
  };
  const nothing = !L.slots.size && !L.shares.size;
  return (
    <div ref={ref} className="ic-stage">
      <AnimatePresence>
        {bar && <motion.div key="bar" className="ic-sbar" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={UI}>{bar}</motion.div>}
      </AnimatePresence>
      {shares.map((s) => {
        const k = shareKey(s.id);
        const big = L.shares.get(s.id);
        const r = big ?? L.slots.get(k);
        if (!r) return null;
        return (
          <motion.div key={k} {...tileProps(k, s.label)} aria-roledescription="shared screen" aria-keyshortcuts="Enter P" className={cn('ic-scr', !big && 'is-tile')}
            initial={{ ...box(r), opacity: 0 }} animate={{ ...box(r), opacity: 1 }} transition={reduce || handle.current ? { duration: 0 } : GLIDE}>
            <FeedVideo feed={s.feed} className="screen" />
            <span className="ac-tile-name"><Icon name="screen" size={14} />{s.label}</span>
            <ShareMenu label={s.name} open={menu === k} onOpenChange={(o) => setMenu(o ? k : null)} big={!!big} onToggle={() => toggleShare(s.id, !!big)} />
          </motion.div>
        );
      })}
      {([['divider', L.divider], ['split', L.split]] as const).map(([kind, hd]) => hd && !narrow && (
        <motion.div key={kind} className={cn('ic-divider', hd.along === 'y' && 'is-v')} role="separator" tabIndex={0} data-handle
          aria-orientation={hd.along === 'x' ? 'vertical' : 'horizontal'} aria-valuemin={Math.round((kind === 'divider' ? CALL_SHARE_ROOM : CALL_SHARE_SPLIT).min * 100)}
          aria-valuemax={Math.round((kind === 'divider' ? CALL_SHARE_ROOM : CALL_SHARE_SPLIT).max * 100)}
          aria-valuenow={Math.round((kind === 'divider' ? prefs.ratio : lay.split) * 100)}
          aria-label={kind === 'divider' ? 'Room for shared screens beside the people. Only your view changes' : 'Room for each of the two shared screens. Only your view changes'}
          initial={false} animate={hd.along === 'y' ? { left: hd.x - 28, top: hd.y - 12 } : { left: hd.x - 12, top: hd.y - 28 }} transition={reduce || handle.current ? { duration: 0 } : GLIDE}
          onPointerDown={(e) => { e.preventDefault(); handle.current = kind; }}
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
        const sizing = size?.id === p.seat;
        const pin = pinned.has(p.id);
        const spot = spotlight === p.id;
        const at = dragging ? { left: drag.x, top: drag.y, width: r[2], height: r[3] } : sizing ? { left: r[0], top: r[1], width: size.w, height: size.h } : box(r);
        const said = [p.isMe ? `${callName(p.person)} (you)` : callName(p.person), corner ? 'in your corner' : '', pin ? 'pinned for you' : '', spot ? 'spotlighted for everyone' : '', p.hand ? 'hand raised' : '', p.mic ? '' : 'microphone off', p.volume === null ? '' : volumeTag(p.volume)?.toLowerCase() ?? ''];
        return (
          <motion.div key={p.id} {...tileProps(p.id, said.filter(Boolean).join(', '))}
            className={cn('ic-slot', dragging && 'is-drag', sizing && 'is-sizing', (corner || (handsOn && groupOf(p.id))) && 'can-drag', corner && 'is-corner')}
            onPointerDown={(e) => startDrag(e, p.id, corner)}
            initial={{ ...at, opacity: 0, scale: 0.97 }} animate={{ ...at, opacity: 1, scale: dragging && !corner ? 1.03 : 1 }}
            transition={reduce || dragging || sizing ? { duration: 0 } : { ...GLIDE, opacity: UI, scale: UI }}>
            <CallTile person={p.person} name={name(p)} label={p.person.name} speaking={p.speaking} muted={!p.mic} hand={p.hand} className={cn(p.isMe && 'is-me', pin && 'is-pinned', spot && 'is-spot')}
              chrome={(
                <>
                  {!corner && (
                    <div className="ic-tstate">
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
                          <button type="button" className="tx" aria-label={`${callName(p.person)} back to full volume for you`} onClick={() => onVolume(p.id, 1)}><Icon name="x" size={12} /></button>
                        </span>
                      )}
                    </div>
                  )}
                  <TileMenu who={p.person} me={p.isMe} open={menu === p.id} onOpenChange={(o) => setMenu(o ? p.id : null)} organizer={organizer} menu={menuFor(p, corner)} />
                  {handsOn && restGroup.includes(p.id) && <span className="ic-rs" data-handle aria-hidden="true" onPointerDown={(e) => startGrow(e, p)}><Icon name="resize" size={14} /></span>}
                </>
              )}>
              {p.video ? <FeedVideo feed={p.video} /> : undefined}
            </CallTile>
          </motion.div>
        );
      })}
      {self && plan.self?.folded && L.self && (
        <Tooltip label="Show yourself. Everyone else sees you either way" side="top">
          <motion.button key="self-chip" type="button" className="ic-selfchip" aria-label="Show yourself. Only your view changes" onClick={() => onSelf('corner')}
            initial={{ ...box(L.self), opacity: 0 }} animate={{ ...box(L.self), opacity: 1 }} transition={reduce ? { duration: 0 } : { ...GLIDE, opacity: UI }}>
            <Avatar person={self.person} size={22} /><span>You</span><Icon name="eye" size={15} />
          </motion.button>
        </Tooltip>
      )}
      {nothing && plan.self?.folded && (
        <div className="ic-stage-empty dark">
          <EmptyState title="You’re hidden from your view" action={<Button size="sm" icon="eye" onClick={() => onSelf('corner')}>Show me</Button>}>Anyone who joins sees you as usual.</EmptyState>
        </div>
      )}
      <AnimatePresence>
        {caption && <motion.div key="cap" className="ic-cap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={UI}>{caption}</motion.div>}
      </AnimatePresence>
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
              {room && rooms.notesOn && <NotesSign stage>Notes</NotesSign>}
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
            <CallTile person={p.person} name={p.isMe ? <>{callName(p.person)} <span className="you">(you)</span></> : callName(p.person)} speaking={p.speaking} muted={!p.mic} hand={p.hand}>
              {p.video ? <FeedVideo feed={p.video} /> : undefined}
            </CallTile>
          </motion.div>
        );
      })}
    </>
  );
}
const ROOMBAR = ['linear-gradient(90deg,var(--dawn-2),var(--dawn-3))', 'linear-gradient(90deg,var(--dawn-3),var(--dawn-4))', 'linear-gradient(90deg,var(--dawn-1),var(--dawn-2))'];
