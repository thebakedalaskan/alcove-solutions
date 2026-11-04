/*
 * The call's panels on screen, as panels.ts solves them. `PanelHost` is the call's area: it holds the one layer of tiles
 * and shares (Stage.tsx), the side panels, and a place each for the workspace and the board, and it's where everything
 * about arranging them happens, for all of them alike: the lines between panels, the handle each has, tabs pulled out of
 * a panel, the sunrise glow that shows where something will land, and the same again from the keyboard.
 *
 * A drag changes the arrangement in memory; it's remembered when it's let go. Only your screen changes.
 */
import { CallPanelLeafIdSchema, CallPanelTabSchema, type CallPanelGroup, type CallPanelTab, type CallPanels } from '@alcove/api';
import { Icon, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from 'react';
import {
  dragDivider, dropAt, dropBox, dropSpots, evenDivider, groupLeaf, groupWith, moveLeaf, tearTab,
  type Divider, type Drop, type Horizon, type Leaf, type PanelFacts, type Size, type Solved
} from './panels';
import { GLIDE } from './Stage';
import type { Box } from './stageLayout';

const at = (r: Box) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
const isTab = (v: string | null): v is CallPanelTab => CallPanelTabSchema.options.some((t) => t === v);
/** What a handle says it moves. */
const leafOf = (v: string | null): Leaf | null => { const r = CallPanelLeafIdSchema.safeParse(v); return r.success ? r.data : null; };
const TAB_NAMES: Record<CallPanelTab, string> = { notes: 'Notes', yours: 'Yours', transcript: 'Transcript', ask: 'Ask', chat: 'Chat', people: 'People' };
export const tabName = (t: CallPanelTab) => TAB_NAMES[t];

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
  const [h, setH] = useState<Horizon>({ dock: 0, base: 0 });
  useLayoutEffect(() => {
    const a = area.current;
    const b = bar.current;
    const dock = b?.querySelector('.ac-dock');
    if (!a || !b || !dock) return;
    const read = () => {
      const top = a.getBoundingClientRect();
      const dockBox = dock.getBoundingClientRect();
      const next = { dock: Math.round(dockBox.left - top.left), base: Math.round(b.getBoundingClientRect().bottom - top.top - 10) };
      setH((was) => (was.dock === next.dock && was.base === next.base ? was : next));
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
interface Dragging {
  moving: Moving; label: string;
  /** The pointer, or for the keyboard the middle of what's lit. */
  x: number; y: number;
  drop: Drop | null;
  keys: boolean;
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
  const line = useRef<{ d: Divider; x: number; y: number; start: CallPanels; moved: boolean } | null>(null);
  const armed = useRef<{ moving: Moving; x: number; y: number; pointer: number } | null>(null);
  const moved = useRef(false);
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

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    moved.current = false;
    if (A.phone) return;
    const dv = e.target.closest('[data-div]');
    if (dv) {
      const d = dividers.find((x) => x.key === dv.getAttribute('data-div'));
      if (!d) return;
      e.preventDefault();
      line.current = { d, x: e.clientX, y: e.clientY, start: panels, moved: false };
      setSizing(d.key);
      onLive(true);
      // On the line itself, so a double-click still lands on it.
      dv.setPointerCapture(e.pointerId);
      return;
    }
    const mv = e.target.closest('[data-move]');
    const leaf = mv ? leafOf(mv.getAttribute('data-move')) : null;
    if (leaf) { armed.current = { moving: { kind: 'panel', id: leaf }, x: e.clientX, y: e.clientY, pointer: e.pointerId }; return; }
    const tab = e.target.closest('[data-tab]')?.getAttribute('data-tab') ?? null;
    if (isTab(tab)) armed.current = { moving: { kind: 'tab', id: tab }, x: e.clientX, y: e.clientY, pointer: e.pointerId };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const l = line.current;
    if (l) {
      const delta = l.d.dir === 'row' ? e.clientX - l.x : e.clientY - l.y;
      if (!delta && !l.moved) return;
      l.moved = true;
      arrangeLive(dragDivider(l.start, l.d, delta));
      return;
    }
    const a = armed.current;
    if (!a) return;
    if (!drag && Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) < 6) return;
    if (!drag) e.currentTarget.setPointerCapture(a.pointer);
    const p = local(e);
    setDrag({ moving: a.moving, label: nameOf(a.moving), x: p.x, y: p.y, drop: spot(p.x, p.y, a.moving), keys: false });
  };
  const up = (e: ReactPointerEvent) => {
    const l = line.current;
    if (l) {
      line.current = null;
      setSizing(null);
      onLive(false);
      // What's on screen is what's kept now.
      if (l.moved) { arrange((p) => ({ ...p })); onArranged(); }
      return;
    }
    armed.current = null;
    if (!drag || drag.keys) return;
    moved.current = true;
    setDrag(null);
    if (drag.drop && e.type === 'pointerup') place(drag.moving, drag.drop);
  };
  /** A drag let go over a tab isn't a click on it. */
  const click = (e: ReactMouseEvent) => { if (moved.current) { moved.current = false; e.stopPropagation(); e.preventDefault(); } };
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
      arrange((p) => (by === null ? evenDivider(p, d) : dragDivider(p, d, by)));
      onArranged();
      return;
    }
    if (drag) return;
    const mv = e.target.closest('[data-move]');
    const leaf = mv ? leafOf(mv.getAttribute('data-move')) : null;
    if (leaf && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); pickUp({ kind: 'panel', id: leaf }); return; }
    const tab = e.target.closest('[data-tab]')?.getAttribute('data-tab') ?? null;
    if (isTab(tab) && e.key === 'Enter' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); pickUp({ kind: 'tab', id: tab }); }
  };

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
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); armed.current = null; setDrag(null); setSaid(`${d.label} stays where it was.`); return; }
      if (!d.keys) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') {
        setDrag(null);
        if (d.drop) { h.place(d.moving, d.drop); setSaid(`${d.label} moved.`); } else setSaid(`${d.label} stays where it was.`);
        // Focus stays with what moved, which may have come back to life somewhere else.
        const id = d.moving.kind === 'panel' ? d.moving.id : null;
        if (id) requestAnimationFrame(() => { area.current?.querySelector<HTMLElement>(`[data-move="${id}"]`)?.focus(); });
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
  const canMove = !A.phone;

  /* The side panels, worked out only when they change: a drag's pointer moving doesn't touch what's in them. */
  const open = panels.groups.filter((g) => g.open);
  const sides = useMemo(() => open.flatMap((g) => {
    const leaf = groupLeaf(g.id);
    const r = shown(leaf) ?? { x: size.w - 336, y: 0, w: 336, h: size.h };
    return [(
      <motion.aside key={g.id} className={cn('ic-side', A.float && 'is-float', A.phone && 'is-phone', !rects[leaf] && 'is-off')} aria-label={label(leaf)} data-group={g.id}
        initial={reduce ? { ...at(r), opacity: 0 } : { ...at(r), opacity: 0, x: 12 }} animate={{ ...at(r), opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: 12 }} transition={slide}>
        {canMove && <button type="button" className="ic-grab" data-move={leaf} aria-label={`Drag to move ${label(leaf)}`} title="Drag to move" />}
        {group(g)}
      </motion.aside>
    )];
    // `open` follows `panels`, and `shown` is read from `solved`.
  }), [panels, solved, group, label, size, slide, reduce, canMove, A.float, A.phone]);

  const surface = (leaf: 'ws' | 'board', name: string, draw: ((r: Box) => ReactNode) | undefined) => {
    if (!draw || !facts[leaf]) return null;
    const r = shown(leaf);
    if (!r) return null;
    return (
      <motion.section key={leaf} className={cn('ic-surface', !rects[leaf] && 'is-off')} aria-label={name} data-surface={leaf} initial={false} animate={at(r)} transition={slide}>
        {canMove && <button type="button" className="ic-grab" data-move={leaf} aria-label={`Drag to move the ${name.toLowerCase()}`} title="Drag to move" />}
        {draw(r)}
      </motion.section>
    );
  };

  return (
    <div ref={area} className={cn('ic-main', sizing && 'is-resizing', drag && 'is-dragging')}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={click} onDoubleClick={double} onKeyDown={keys}>
      {tiles}
      {surface('ws', 'Workspace', ws)}
      {surface('board', 'Board', board)}
      <AnimatePresence initial={false}>{sides}</AnimatePresence>
      {dividers.map((d) => (
        <span key={d.key} className={cn('ic-div', d.dir === 'col' && 'is-col', sizing === d.key && 'is-on')} data-div={d.key} role="separator" tabIndex={0} style={at(d.rect)}
          aria-orientation={d.dir === 'row' ? 'vertical' : 'horizontal'} aria-label={`Room for ${label(d.a)} and ${label(d.b)}. Only your screen changes`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((100 * d.sa) / Math.max(1, d.sa + d.sb))} title="Drag to resize, double-click to even out"><i /></span>
      ))}
      {glow && <div className={cn('ic-drop', drag?.drop && `is-${drag.drop.side}`)} style={at({ x: glow.x + 4, y: glow.y + 4, w: Math.max(0, glow.w - 8), h: Math.max(0, glow.h - 8) })} />}
      {drag && <div className="ic-ghost" style={{ left: drag.x + 12, top: drag.y + 10 }}><Icon name="grip" size={15} /><span>{drag.label}</span></div>}
      {swap && <div className="ic-swapbar">{swap}</div>}
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
