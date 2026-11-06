/*
 * The call's area: the main area as panels.ts solves it, and your side at its right. The main area holds the one layer of
 * tiles and shares (Stage.tsx), a place each for the workspace and the board, and the lines between panels, which resize them
 * for you alone. Your side shows one view at a time at a fixed width, sliding in as the main area makes room for it; on a
 * phone it's a sheet over the whole call.
 *
 * A line being dragged changes the arrangement in memory; it's remembered when it's let go, wherever that is.
 */
import type { CallPanels, CallPeopleMode } from '@alcove/api';
import { ThemeScope, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { log } from '~/lib/log';
import { dragDivider, evenDivider, solve, type Divider, type Horizon, type Leaf, type PanelFacts, type Size, type Solved } from './panels';
import { GLIDE } from './Stage';
import type { Box } from './stageLayout';

const plog = log.child({ component: 'panels' });
/** Your side coming in from the right edge, or going back there; on a phone, rising over the call. */
const SLIDE = { duration: 0.38, ease: [0.45, 0, 0.2, 1] } as const;
const at = (r: Box) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
const PEOPLE_SAID: Record<CallPeopleMode, string> = { tiles: 'People back as tiles.', arches: 'People folded to arches.', hidden: 'People hidden. Shift and P brings them back.' };

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

/** Holds on to a pointer while it's down, so letting go outside the window still comes here. */
function keep(el: Element | null, pointer: number) {
  try { el?.setPointerCapture(pointer); } catch (e) { plog.debug('pointer already let go', { err: e }); }
}

/** Your side, as the area shows it. */
export interface HostSide {
  /** Which view it shows: a change of view keeps the side where it is, and changes what's in it. */
  view: string;
  /** What it's called, for the side itself and for putting it away. */
  label: string;
  width: number;
  /** A phone: it's a sheet over the call, with the call dimmed behind it. */
  phone: boolean;
  /** Your theme, which the side follows while the call around it stays night. */
  theme: 'light' | 'dark';
  onClose: () => void;
  children: ReactNode;
}

/** A line being dragged, from the press until it's let go, wherever that is. */
interface Press { pointer: number; x: number; y: number; d: Divider; start: CallPanels; moved: boolean }

export function PanelHost({ area, size, main, panels, solved, facts, arrange, arrangeLive, onLive, onArranged, label, tiles, side, ws, board, swap }: {
  /** The call's area and its size (`useCallArea`). */
  area: RefObject<HTMLDivElement | null>;
  size: Size;
  /** What's left of the area for the main area, beside your side. */
  main: Size;
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
  /** What a panel is called: "Kofi’s screen", "Workspace". */
  label: (leaf: Leaf) => string;
  /** The one layer of tiles and shares. */
  tiles: ReactNode;
  /** Your side, while it shows something. */
  side: HostSide | null;
  /** The workspace and the board, once something fills them. Each is given where it is, kept mounted while it's behind something else. */
  ws?: ((r: Box) => ReactNode) | undefined;
  board?: ((r: Box) => ReactNode) | undefined;
  /** On a phone, what's showing when things take turns: it sits under the row of arches. */
  swap?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const { rects, dividers } = solved;
  const [sizing, setSizing] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const press = useRef<Press | null>(null);
  const unlisten = useRef<(() => void) | null>(null);
  // Nothing is placed until the area has been measured, which is before the first paint: at no size at all, everything would start from a corner.
  const measured = useRef(false);
  if (size.w > 0) measured.current = true;
  // Panels stay where they last were while they have no place (behind others), so they keep what's in them.
  const last = useRef(new Map<string, Box>());

  /** Ends the drag of a line, wherever it was let go. */
  const letGo = () => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    unlisten.current?.();
    setSizing(null);
    onLive(false);
    // What's on screen is what's kept now.
    if (p.moved) { arrange((a) => ({ ...a })); onArranged(); }
  };
  const follow = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    // No button down: it was let go somewhere this page never heard of.
    if (!e.buttons) { letGo(); return; }
    const delta = p.d.dir === 'row' ? e.clientX - p.x : e.clientY - p.y;
    if (!delta && !p.moved) return;
    p.moved = true;
    arrangeLive(dragDivider(p.start, p.d, delta));
  };
  const pointer = useRef({ follow, letGo });
  pointer.current = { follow, letGo };
  /* A press is followed on the window until it's let go: the line it started on can go, and it can end anywhere. */
  const hold = (p: Press) => {
    press.current = p;
    const mine = (e: PointerEvent) => e.pointerId === p.pointer;
    const moved = (e: PointerEvent) => { if (mine(e)) pointer.current.follow(e); };
    const up = (e: PointerEvent) => { if (mine(e)) pointer.current.letGo(); };
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
  /* What's held can go: a share ending takes its line with it. The people folding away is the drag itself, which can still bring them back. */
  useEffect(() => {
    const p = press.current;
    if (p && !solve(p.start, main, facts).dividers.some((x) => x.key === p.d.key)) letGo();
  });

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !(e.target instanceof Element) || solved.A.phone) return;
    const dv = e.target.closest('[data-div]');
    if (!dv) return;
    // One at a time. A press that finds a line still held means that was let go out of sight.
    letGo();
    const d = dividers.find((x) => x.key === dv.getAttribute('data-div'));
    if (!d) return;
    e.preventDefault();
    hold({ pointer: e.pointerId, x: e.clientX, y: e.clientY, d, start: panels, moved: false });
    setSizing(d.key);
    onLive(true);
    // On the line itself, so a double-click still lands on it.
    keep(dv, e.pointerId);
  };
  const double = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element)) return;
    const key = e.target.closest('[data-div]')?.getAttribute('data-div');
    const d = dividers.find((x) => x.key === key);
    if (!d) return;
    arrange((p) => evenDivider(p, d));
    onArranged();
  };
  /* From the keyboard, a line moves with the arrow keys, Home and End take it all the way, and Enter evens it. */
  const keys = (e: ReactKeyboardEvent) => {
    if (!(e.target instanceof Element)) return;
    const dv = e.target.closest('[data-div]');
    if (!dv) return;
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
  };

  /* A line you're on can go from under you, when the people fold away: focus moves to what stood beside it. */
  const lines = useRef(dividers);
  const active = document.activeElement;
  const onLine = active instanceof HTMLElement ? lines.current.find((d) => d.key === active.dataset['div']) : undefined;
  useLayoutEffect(() => {
    lines.current = dividers;
    if (!onLine || dividers.some((d) => d.key === onLine.key)) return;
    const root = area.current;
    (root?.querySelector<HTMLElement>('[data-div]') ?? root?.querySelector<HTMLElement>('.ic-slot[tabindex="0"]'))?.focus();
    if (panels.people === 'hidden') setSaid(PEOPLE_SAID.hidden);
  });

  const shown = (leaf: Leaf) => { const r = rects[leaf]; if (r) last.current.set(leaf, r); return r ?? last.current.get(leaf) ?? null; };
  const slide = reduce || sizing ? { duration: 0 } : GLIDE;

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
        {draw(r)}
      </motion.section>
    );
  };

  /* Your side: at the right of the area, the main area having made room, or on a phone a sheet risen over the call. */
  const sideBox: Box = { x: size.w - (side?.width ?? 0), y: 0, w: side?.width ?? 0, h: size.h };
  const away = reduce ? { opacity: 0 } : side?.phone ? { y: '100%' } : { x: sideBox.w + 40 };
  const here = side?.phone ? { opacity: 1, y: 0 } : { ...at(sideBox), opacity: 1, x: 0 };
  return (
    <div ref={area} className={cn('ic-main', sizing && 'is-resizing')} onPointerDown={down} onDoubleClick={double} onKeyDown={keys}>
      {measured.current && tiles}
      {measured.current && surface('ws', 'Workspace', ws)}
      {measured.current && surface('board', 'Board', board)}
      {measured.current && dividers.map((d) => (
        <span key={d.key} className={cn('ic-div', d.dir === 'col' && 'is-col', sizing === d.key && 'is-on')} data-div={d.key} role="separator" tabIndex={0} style={at(d.rect)}
          aria-orientation={d.dir === 'row' ? 'vertical' : 'horizontal'} aria-label={`Room for ${label(d.a)} and ${label(d.b)}. Only your screen changes`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((100 * d.sa) / Math.max(1, d.sa + d.sb))} title="Drag to resize, double-click to even out"><i /></span>
      ))}
      {/* On a phone, under the people, and the status bar while it says anything. */}
      {swap && <div className="ic-swapbar" style={solved.A.apart && facts.top > 0 ? { translate: `0 ${facts.top}px` } : undefined}>{swap}</div>}
      <AnimatePresence>
        {measured.current && side?.phone && <motion.div key="scrim" className="ic-scrim" aria-hidden="true" onClick={side.onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : { duration: 0.24 }} />}
        {measured.current && side && (
          <motion.aside key={side.phone ? 'sheet' : 'side'} className={cn('ic-side', side.theme, side.phone && 'is-sheet')} aria-label={side.label} data-view={side.view}
            initial={side.phone ? away : { ...at(sideBox), ...away }} animate={here} exit={away}
            transition={reduce ? { duration: 0 } : side.phone ? SLIDE : { ...slide, x: SLIDE }}>
            <ThemeScope theme={side.theme}>{side.children}</ThemeScope>
          </motion.aside>
        )}
      </AnimatePresence>
      <span className="sr-only" role="status">{said}</span>
    </div>
  );
}
