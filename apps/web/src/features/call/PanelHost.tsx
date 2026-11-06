/*
 * The call's panels on screen, as panels.ts solves them. `PanelHost` is the call's area: it holds the one layer of tiles
 * and shares (Stage.tsx), the side panels, and a place each for the workspace and the board, and it's where everything
 * about arranging them happens, for all of them alike: the lines between panels, the handle each has, tabs pulled out of
 * a panel, the sunrise glow that shows where something will land, and the same again from the keyboard.
 *
 * A drag changes the arrangement in memory; it's remembered when it's let go, wherever that is. Only your screen changes.
 */
import { CallPanelLeafIdSchema, CallPanelTabSchema, type CallPanelGroup, type CallPanelTab, type CallPanels, type CallPeopleMode } from '@alcove/api';
import { Icon, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from 'react';
import { log } from '~/lib/log';
import {
  dragDivider, dropAt, dropBox, dropSpots, evenDivider, groupLeaf, groupWith, isShareLeaf, moveLeaf, solve, tearTab,
  type Divider, type Drop, type Horizon, type Leaf, type PanelFacts, type Size, type Solved
} from './panels';
import { GLIDE } from './Stage';
import type { Box } from './stageLayout';

const plog = log.child({ component: 'panels' });
/** A side panel coming in from the edge it stands against, or going back there. */
const SLIDE = { duration: 0.38, ease: [0.45, 0, 0.2, 1] } as const;
const at = (r: Box) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
const isTab = (v: string | null): v is CallPanelTab => CallPanelTabSchema.options.some((t) => t === v);
/** What a handle says it moves. */
const leafOf = (v: string | null): Leaf | null => { const r = CallPanelLeafIdSchema.safeParse(v); return r.success ? r.data : null; };
const TAB_NAMES: Record<CallPanelTab, string> = { notes: 'Notes', yours: 'Yours', transcript: 'Transcript', ask: 'Ask', chat: 'Chat', people: 'People' };
export const tabName = (t: CallPanelTab) => TAB_NAMES[t];
const PEOPLE_SAID: Record<CallPeopleMode, string> = { tiles: 'People back as tiles.', arches: 'People folded to arches.', hidden: 'People hidden. Shift and P brings them back.' };

/** What's typed in a panel and not sent yet. It's kept above the panel: a tab moved to another panel starts afresh, and the words go with it. */
export interface Draft { text: string }
export function useDraft(draft: Draft) {
  const [text, setText] = useState(draft.text);
  useEffect(() => { draft.text = text; }, [draft, text]);
  return [text, setText] as const;
}

/** The call's area, as it's measured. */
export function useCallArea() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

/** Where the horizon is, in the call's area: the ground under the dock, and how far it runs before the dock begins. */
export function useHorizon(area: RefObject<HTMLDivElement | null>, bar: RefObject<HTMLElement | null>, size: Size): Horizon {
  const [h, setH] = useState<Horizon>({ dock: 0, dockEnd: 0, base: 0, top: 0, left: 0 });
  useLayoutEffect(() => {
    const a = area.current;
    const b = bar.current;
    const dock = b?.querySelector('.ac-dock');
    if (!a || !b || !dock) return;
    const read = () => {
      const top = a.getBoundingClientRect();
      const dockBox = dock.getBoundingClientRect();
      const next = { dock: Math.round(dockBox.left - top.left), dockEnd: Math.round(dockBox.right - top.left), base: Math.round(b.getBoundingClientRect().bottom - top.top - 10), top: Math.round(top.top), left: Math.round(top.left) };
      setH((was) => (was.dock === next.dock && was.dockEnd === next.dockEnd && was.base === next.base && was.top === next.top && was.left === next.left ? was : next));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(dock);
    ro.observe(b);
    return () => ro.disconnect();
  }, [area, bar, size]);
  return h;
}

export interface PanelHostHandle {
  /** Picks a panel up from the keyboard, as its handle does. */
  pickUp(leaf: Leaf): void;
}
type Moving = { kind: 'panel'; id: Leaf } | { kind: 'tab'; id: CallPanelTab };
/** What a pointer holds, from the press until it's let go, wherever that is. */
type Press = { pointer: number; x: number; y: number } & ({ kind: 'line'; d: Divider; start: CallPanels; moved: boolean } | { kind: 'item'; moving: Moving; from: Element; going: boolean });
interface Dragging {
  moving: Moving; label: string;
  /** The pointer, or for the keyboard the middle of what's lit. */
  x: number; y: number;
  drop: Drop | null;
  keys: boolean;
}

/** Holds on to a pointer while it's down, so letting go outside the window still comes here. */
function keep(el: Element | null, pointer: number) {
  try { el?.setPointerCapture(pointer); } catch (e) { plog.debug('pointer already let go', { err: e }); }
}

const DIRS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The next place to drop in the direction of an arrow key: the nearest that way, the straighter the better. */
function nextSpot<S extends { box: Box }>(x: number, y: number, key: string, spots: S[]): S | null {
  const dir = DIRS[key];
  if (!dir) return null;
  let best: S | null = null;
  let score = Infinity;
  for (const s of spots) {
    const dx = s.box.x + s.box.w / 2 - x;
    const dy = s.box.y + s.box.h / 2 - y;
    const ahead = dx * dir[0] + dy * dir[1];
    if (ahead < 1) continue;
    const v = ahead + 2 * Math.abs(dx * dir[1] + dy * dir[0]);
    if (v < score) { score = v; best = s; }
  }
  return best;
}

export function PanelHost({ area, size, panels, solved, facts, arrange, arrangeLive, onLive, onArranged, label, tiles, group, ws, board, swap, handle }: {
  /** The call's area and its size (`useCallArea`). */
  area: RefObject<HTMLDivElement | null>;
  size: Size;
  panels: CallPanels;
  solved: Solved;
  facts: PanelFacts;
  /** Changes the arrangement and remembers it; `arrangeLive` only shows it, for a line being dragged. */
  arrange: (fn: (p: CallPanels) => CallPanels) => void;
  arrangeLive: (p: CallPanels) => void;
  /** A line is being dragged: everything follows it at once. */
  onLive: (on: boolean) => void;
  /** You changed the arrangement by hand. */
  onArranged: () => void;
  /** What a panel is called: "Kofi’s screen", "Chat". */
  label: (leaf: Leaf) => string;
  /** The one layer of tiles and shares. */
  tiles: ReactNode;
  /** A side panel: its head and what it shows. */
  group: (g: CallPanelGroup) => ReactNode;
  /** The workspace and the board, once something fills them. Each is given where it is, kept mounted while it's behind something else. */
  ws?: ((r: Box) => ReactNode) | undefined;
  board?: ((r: Box) => ReactNode) | undefined;
  /** On a phone, what's showing when things take turns: it sits under the row of arches. */
  swap?: ReactNode;
  handle?: Ref<PanelHostHandle> | undefined;
}) {
  const reduce = useReducedMotion();
  const { A, rects, dividers } = solved;
  const [drag, setDrag] = useState<Dragging | null>(null);
  const [sizing, setSizing] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const press = useRef<Press | null>(null);
  const unlisten = useRef<(() => void) | null>(null);
  // What was just dragged, for the click that comes with letting it go. Nothing else's click is ever touched.
  const dragged = useRef<Element | null>(null);
  // Nothing is placed until the area has been measured, which is before the first paint: at no size at all, everything would start from a corner.
  const measured = useRef(false);
  if (size.w > 0) measured.current = true;
  // Panels stay where they last were while they have no place (behind others, or floating with no room), so they keep what's in them.
  const last = useRef(new Map<string, Box>());

  const spot = (x: number, y: number, m: Moving): Drop | null => {
    const own = m.kind === 'tab' ? groupWith(panels, m.id) : undefined;
    const skip = m.kind === 'panel' ? m.id : own && own.tabs.length < 2 ? groupLeaf(own.id) : null;
    const d = dropAt(solved, size, x, y, skip);
    // A tab let go over the panel it's in stays there.
    return d && own && d.side === 'swap' && d.target === groupLeaf(own.id) ? null : d;
  };
  const place = (m: Moving, d: Drop) => {
    arrange((p) => (m.kind === 'tab' ? tearTab(p, m.id, d.target, d.side, size, facts) : moveLeaf(p, m.id, d.target, d.side, size, facts)));
    onArranged();
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = area.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const nameOf = (m: Moving) => (m.kind === 'panel' ? label(m.id) : tabName(m.id));

  /** Hardly moved from where it was picked up: a handle sits by the edge of the window, and a slip of the hand shouldn't send it there. */
  const barely = (p: Press, q: { x: number; y: number }) => { const from = local({ clientX: p.x, clientY: p.y }); return Math.hypot(q.x - from.x, q.y - from.y) < 28; };
  /** Ends what's held. `where`: the place it was let go, if it's to be put down there. */
  const letGo = (where: { x: number; y: number } | null) => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    unlisten.current?.();
    if (p.kind === 'line') {
      setSizing(null);
      onLive(false);
      // What's on screen is what's kept now.
      if (p.moved) { arrange((a) => ({ ...a })); onArranged(); }
      return;
    }
    if (!p.going) return;
    setDrag(null);
    const slipped = !!where && barely(p, where);
    // A press that hardly went anywhere was a click on a tab, a little unsteady: the area held the pointer, so the tab heard nothing.
    if (slipped && p.moving.kind === 'tab' && p.from instanceof HTMLElement) p.from.click();
    dragged.current = p.from;
    setTimeout(() => { dragged.current = null; });
    const d = where && !slipped && spot(where.x, where.y, p.moving);
    if (d) place(p.moving, d);
  };
  const follow = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    // No button down: it was let go somewhere this page never heard of.
    if (!e.buttons) { letGo(null); return; }
    if (p.kind === 'line') {
      const delta = p.d.dir === 'row' ? e.clientX - p.x : e.clientY - p.y;
      if (!delta && !p.moved) return;
      p.moved = true;
      arrangeLive(dragDivider(p.start, p.d, delta));
      return;
    }
    if (!p.going) {
      if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) < 6) return;
      p.going = true;
      keep(area.current, p.pointer);
    }
    const q = local(e);
    setDrag({ moving: p.moving, label: nameOf(p.moving), x: q.x, y: q.y, drop: barely(p, q) ? null : spot(q.x, q.y, p.moving), keys: false });
  };
  const pointer = useRef({ follow, letGo, local });
  pointer.current = { follow, letGo, local };
  /* A press is followed on the window until it's let go: the line it started on can go, and it can end anywhere. */
  const hold = (p: Press) => {
    press.current = p;
    const mine = (e: PointerEvent) => e.pointerId === p.pointer;
    const moved = (e: PointerEvent) => { if (mine(e)) pointer.current.follow(e); };
    const up = (e: PointerEvent) => { if (mine(e)) pointer.current.letGo(e.type === 'pointerup' ? pointer.current.local(e) : null); };
    // The line went from under the pointer, as the people fold away: the area holds on instead.
    const lost = (e: PointerEvent) => { if (mine(e)) keep(area.current, e.pointerId); };
    addEventListener('pointermove', moved, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
    addEventListener('lostpointercapture', lost, true);
    unlisten.current = () => {
      unlisten.current = null;
      removeEventListener('pointermove', moved, true);
      removeEventListener('pointerup', up, true);
      removeEventListener('pointercancel', up, true);
      removeEventListener('lostpointercapture', lost, true);
    };
  };
  useEffect(() => () => unlisten.current?.(), []);
  /* What's held can go: a share ending takes its line and its handle with it. The people folding away is the drag itself, which can still bring them back. */
  useEffect(() => {
    const p = press.current;
    if (!p) return;
    const gone = p.kind === 'line' ? !solve(p.start, size, facts).dividers.some((x) => x.key === p.d.key)
      : p.going && p.moving.kind === 'panel' && isShareLeaf(p.moving.id) && !facts.shown.includes(p.moving.id);
    if (gone) letGo(null);
  });

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !(e.target instanceof Element) || A.phone || drag?.keys) return;
    // One thing at a time. A press that finds something still held means that was let go out of sight.
    letGo(null);
    const from = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
    const dv = e.target.closest('[data-div]');
    if (dv) {
      const d = dividers.find((x) => x.key === dv.getAttribute('data-div'));
      if (!d) return;
      e.preventDefault();
      hold({ ...from, kind: 'line', d, start: panels, moved: false });
      setSizing(d.key);
      onLive(true);
      // On the line itself, so a double-click still lands on it.
      keep(dv, e.pointerId);
      return;
    }
    const mv = e.target.closest('[data-move]');
    const leaf = mv ? leafOf(mv.getAttribute('data-move')) : null;
    if (mv && leaf) { hold({ ...from, kind: 'item', moving: { kind: 'panel', id: leaf }, from: mv, going: false }); return; }
    const el = e.target.closest('[data-tab]');
    const tab = el?.getAttribute('data-tab') ?? null;
    if (el && isTab(tab)) hold({ ...from, kind: 'item', moving: { kind: 'tab', id: tab }, from: el, going: false });
  };
  /** A drag let go over its own tab isn't a click on it. */
  const click = (e: ReactMouseEvent) => { if (e.isTrusted && e.target instanceof Node && dragged.current?.contains(e.target)) { e.stopPropagation(); e.preventDefault(); } };
  const double = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element)) return;
    const key = e.target.closest('[data-div]')?.getAttribute('data-div');
    const d = dividers.find((x) => x.key === key);
    if (!d) return;
    arrange((p) => evenDivider(p, d));
    onArranged();
  };

  /* From the keyboard: a line moves with the arrow keys; a panel's handle, or Shift and Enter on a tab, picks it up. */
  const pickUp = (m: Moving) => {
    const r = m.kind === 'panel' ? rects[m.id] : undefined;
    const own = m.kind === 'tab' ? groupWith(panels, m.id) : undefined;
    const from = r ?? (own ? rects[groupLeaf(own.id)] : undefined) ?? { x: size.w / 2, y: size.h / 2, w: 0, h: 0 };
    setDrag({ moving: m, label: nameOf(m), x: from.x + from.w / 2, y: from.y + from.h / 2, drop: null, keys: true });
    setSaid(`${nameOf(m)} picked up. The arrow keys choose where it goes, Enter puts it there, Escape leaves it where it was.`);
  };
  useImperativeHandle(handle, () => ({ pickUp: (leaf) => pickUp({ kind: 'panel', id: leaf }) }));
  const keys = (e: ReactKeyboardEvent) => {
    if (!(e.target instanceof Element)) return;
    const dv = e.target.closest('[data-div]');
    if (dv) {
      const d = dividers.find((x) => x.key === dv.getAttribute('data-div'));
      if (!d) return;
      const by = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -24 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 24 : e.key === 'Home' ? -d.sa : e.key === 'End' ? d.sb : null;
      if (by === null && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      const next = by === null ? evenDivider(panels, d) : dragDivider(panels, d, by);
      arrange(() => next);
      onArranged();
      if (next.people !== panels.people) setSaid(PEOPLE_SAID[next.people]);
      return;
    }
    if (drag) return;
    const mv = e.target.closest('[data-move]');
    const leaf = mv ? leafOf(mv.getAttribute('data-move')) : null;
    if (leaf && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); pickUp({ kind: 'panel', id: leaf }); return; }
    const tab = e.target.closest('[data-tab]')?.getAttribute('data-tab') ?? null;
    if (isTab(tab) && e.key === 'Enter' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); pickUp({ kind: 'tab', id: tab }); }
  };

  /* A line you're on can go from under you, when the people fold away: focus moves to what stood beside it. */
  const lines = useRef(dividers);
  const active = document.activeElement;
  const onLine = active instanceof HTMLElement ? lines.current.find((d) => d.key === active.dataset['div']) : undefined;
  useLayoutEffect(() => {
    lines.current = dividers;
    if (!onLine || dividers.some((d) => d.key === onLine.key)) return;
    const beside = onLine.a === 'people' ? onLine.b : onLine.a;
    const root = area.current;
    (root?.querySelector<HTMLElement>(`[data-move="${beside}"]`) ?? root?.querySelector<HTMLElement>('[data-div], [data-move]'))?.focus();
    if (panels.people === 'hidden') setSaid(PEOPLE_SAID.hidden);
  });

  /* While something is held, Escape puts it back and, from the keyboard, the arrows and Enter are the drop's. */
  const held = useRef({ drag, solved, size, panels, place, spots: () => spotsFor(drag, solved, size, panels), label });
  held.current = { drag, solved, size, panels, place, spots: () => spotsFor(drag, solved, size, panels), label };
  const isHeld = !!drag;
  useEffect(() => {
    if (!isHeld) return;
    const onKey = (e: KeyboardEvent) => {
      const h = held.current;
      const d = h.drag;
      if (!d) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pointer.current.letGo(null); setDrag(null); setSaid(`${d.label} stays where it was.`); return; }
      if (!d.keys) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') {
        setDrag(null);
        if (d.drop) { h.place(d.moving, d.drop); setSaid(`${d.label} moved.`); } else setSaid(`${d.label} stays where it was.`);
        // Focus stays with what moved, which may have come back to life somewhere else: a tab, or the panel it became.
        const m = d.moving;
        requestAnimationFrame(() => {
          const root = area.current;
          const tab = m.kind === 'tab' ? root?.querySelector<HTMLElement>(`[data-tab="${m.id}"]`) : null;
          const el = m.kind === 'panel' ? root?.querySelector<HTMLElement>(`[data-move="${m.id}"]`) : tab instanceof HTMLButtonElement ? tab : tab?.closest('.ic-side')?.querySelector<HTMLElement>('[data-move]');
          el?.focus();
        });
        return;
      }
      const next = nextSpot(d.x, d.y, e.key, h.spots());
      if (!next) return;
      setDrag({ ...d, x: next.box.x + next.box.w / 2, y: next.box.y + next.box.h / 2, drop: next.drop });
      setSaid(sayDrop(next.drop, h.label));
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [isHeld, area]);

  const glow = drag?.drop ? dropBox(solved, size, drag.drop) : null;
  const shown = (leaf: Leaf) => { const r = rects[leaf]; if (r) last.current.set(leaf, r); return r ?? last.current.get(leaf) ?? null; };
  const slide = reduce || sizing ? { duration: 0 } : GLIDE;
  const canMove = !A.phone && !facts.zen;

  /* The side panels, worked out only when they change: a drag's pointer moving doesn't touch what's in them. */
  const open = panels.groups.filter((g) => g.open);
  const sides = useMemo(() => open.flatMap((g) => {
    const leaf = groupLeaf(g.id);
    const r = shown(leaf) ?? { x: size.w - 336, y: 0, w: 336, h: size.h };
    // A panel slides in from the edge it stands against, the stage making room. One in among the others fades in where it is.
    const edge = r.x + r.w >= size.w - 1 ? r.w + 40 : r.x <= 1 ? -(r.w + 40) : null;
    const away = reduce ? { opacity: 0 } : edge === null ? { opacity: 0, x: 12 } : { x: edge };
    return [(
      <motion.aside key={g.id} className={cn('ic-side', A.float && 'is-float', A.phone && 'is-phone', !rects[leaf] && 'is-off')} aria-label={label(leaf)} data-group={g.id}
        initial={{ ...at(r), ...away }} animate={{ ...at(r), opacity: 1, x: 0 }} exit={away} transition={reduce ? slide : { ...slide, x: SLIDE }}>
        {canMove && <button type="button" className="ic-grab" data-move={leaf} aria-label={`Drag to move ${label(leaf)}`} title="Drag to move" />}
        {group(g)}
      </motion.aside>
    )];
    // `open` follows `panels`, and `shown` is read from `solved`.
  }), [panels, solved, group, label, size, slide, reduce, canMove, A.float, A.phone]);

  /*
   * The workspace and the board stay here once they've been opened, closed or behind something else, so whatever's in them
   * keeps its place. Opening one, it rises 8 px and fades in as everything else makes room. It comes up where it's going:
   * only what's already showing glides.
   */
  const up = useRef({ ws: false, board: false });
  useEffect(() => { up.current = { ws: facts.ws, board: facts.board }; });
  const surface = (leaf: 'ws' | 'board', name: string, draw: ((r: Box) => ReactNode) | undefined) => {
    if (!draw) return null;
    const r = shown(leaf);
    if (!r) return null;
    const open = facts[leaf];
    const place = open && !up.current[leaf] ? { duration: 0 } : slide;
    const fade = reduce ? { duration: 0 } : open ? { duration: 0.24, ease: GLIDE.ease, delay: 0.09 } : { duration: 0.24, ease: GLIDE.ease };
    return (
      <motion.section key={leaf} className={cn('ic-surface', open ? !rects[leaf] && 'is-off' : 'is-closed')} aria-label={name} data-surface={leaf} aria-hidden={!open || undefined}
        initial={{ ...at(r), opacity: 0, y: 8 }} animate={{ ...at(r), opacity: open ? 1 : 0, y: open ? 0 : 8 }}
        transition={{ left: place, top: place, width: place, height: place, opacity: fade, y: reduce ? { duration: 0 } : { ...GLIDE, delay: open ? 0.06 : 0 } }}>
        {canMove && <button type="button" className="ic-grab" data-move={leaf} aria-label={`Drag to move the ${name.toLowerCase()}`} title="Drag to move" />}
        {draw(r)}
      </motion.section>
    );
  };

  return (
    <div ref={area} className={cn('ic-main', sizing && 'is-resizing', drag && 'is-dragging')}
      onPointerDown={down} onClickCapture={click} onDoubleClick={double} onKeyDown={keys}>
      {measured.current && tiles}
      {measured.current && surface('ws', 'Workspace', ws)}
      {measured.current && surface('board', 'Board', board)}
      <AnimatePresence>{measured.current && sides}</AnimatePresence>
      {measured.current && dividers.map((d) => (
        <span key={d.key} className={cn('ic-div', d.dir === 'col' && 'is-col', sizing === d.key && 'is-on')} data-div={d.key} role="separator" tabIndex={0} style={at(d.rect)}
          aria-orientation={d.dir === 'row' ? 'vertical' : 'horizontal'} aria-label={`Room for ${label(d.a)} and ${label(d.b)}. Only your screen changes`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((100 * d.sa) / Math.max(1, d.sa + d.sb))} title="Drag to resize, double-click to even out"><i /></span>
      ))}
      {glow && <div className={cn('ic-drop', drag?.drop && `is-${drag.drop.side}`)} style={at({ x: glow.x + 4, y: glow.y + 4, w: Math.max(0, glow.w - 8), h: Math.max(0, glow.h - 8) })} />}
      {drag && <div className="ic-ghost" style={{ left: drag.x + 12, top: drag.y + 10 }}><Icon name="grip" size={15} /><span>{drag.label}</span></div>}
      {/* On a phone, under the people, and the status bar while it says anything. */}
      {swap && <div className="ic-swapbar" style={solved.A.apart && facts.top > 0 ? { translate: `0 ${facts.top}px` } : undefined}>{swap}</div>}
      <span className="sr-only" role="status">{said}</span>
    </div>
  );
}

function spotsFor(d: Dragging | null, s: Solved, size: Size, panels: CallPanels) {
  if (!d) return [];
  const own = d.moving.kind === 'tab' ? groupWith(panels, d.moving.id) : undefined;
  const skip = d.moving.kind === 'panel' ? d.moving.id : own && own.tabs.length < 2 ? groupLeaf(own.id) : null;
  return dropSpots(s, size, skip).filter((p) => !(own && p.drop.side === 'swap' && p.drop.target === groupLeaf(own.id)));
}
function sayDrop(d: Drop, label: (leaf: Leaf) => string): string {
  if (d.target === 'root') return `Along the ${d.side} edge of the window`;
  const name = d.target === 'stage' ? 'the stage' : label(d.target);
  return d.side === 'swap' ? `Swap with ${name}` : d.side === 'left' ? `Left of ${name}` : d.side === 'right' ? `Right of ${name}` : d.side === 'top' ? `Above ${name}` : `Below ${name}`;
}
