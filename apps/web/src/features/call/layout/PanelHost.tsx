/*
 * The call's area: the main area, where the people and what's open on your stage are (Stage.tsx and frame.tsx, placed by
 * panels.ts), and your side at its right. Your side shows one view at a time at a fixed width, sliding in as the main area
 * makes room for it. Where the stage would be too narrow beside it, it slides in over the stage instead, which dims behind it
 * as a phone's call does, and a press on the stage puts it away; the top bar and the dock stay as they are. On a phone it's a
 * sheet over the whole call, which keeps the keys while it's up: Tab goes round what's in it.
 *
 * What's open on your stage comes before the people in the page, so Tab reaches it first; it's drawn over them either way.
 */
import { ThemeScope, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { Horizon, Size } from './panels';
import { GLIDE } from './Stage';
import type { Box } from './stageLayout';

/** Your side coming in from the right edge, or going back there; on a phone, rising over the call. */
const SLIDE = { duration: 0.38, ease: [0.45, 0, 0.2, 1] } as const;
const at = (r: Box) => ({ left: r.x, top: r.y, width: r.w, height: r.h });

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

/** Your side, as the area shows it. */
export interface HostSide {
  /** Which view it shows: a change of view keeps the side where it is, and changes what's in it. */
  view: string;
  /** What it's called, for the side itself and for putting it away. */
  label: string;
  width: number;
  /** A phone: it's a sheet over the call, with the call dimmed behind it. */
  phone: boolean;
  /** The stage would be too narrow beside it: it sits over the stage at the right, which keeps its width and dims under it. */
  over: boolean;
  /** Your theme, which the side follows while the call around it stays night. */
  theme: 'light' | 'dark';
  onClose: () => void;
  children: ReactNode;
}

export function PanelHost({ area, size, tiles, frames, side, swap }: {
  /** The call's area and its size (`useCallArea`). */
  area: RefObject<HTMLDivElement | null>;
  size: Size;
  /** The one layer of people and what's presented as tiles. */
  tiles: ReactNode;
  /** What's open on your stage, each in its frame. */
  frames: ReactNode;
  /** Your side, while it shows something. */
  side: HostSide | null;
  /** On a phone, what's showing when two things take turns: it sits under the row of arches. */
  swap?: ReactNode;
}) {
  const reduce = useReducedMotion();
  // Nothing is placed until the area has been measured, which is before the first paint: at no size at all, everything would start from a corner.
  const measured = useRef(false);
  if (size.w > 0) measured.current = true;
  const slide = reduce ? { duration: 0 } : GLIDE;

  /* Your side: at the right of the area, the main area having made room, or on a phone a sheet risen over the call. */
  const sideBox: Box = { x: size.w - (side?.width ?? 0), y: 0, w: side?.width ?? 0, h: size.h };
  /*
   * A sheet over the call takes the keys as it rises, and as it changes what it shows: what's under it can't be reached. Beside
   * the stage, your side takes them when what it shows changes under them (from inside it, where what had them is going), or
   * left them nowhere; keys anywhere else stay.
   */
  const sheet = useRef<HTMLElement>(null);
  const view = side?.view ?? null;
  const onPhone = side?.phone === true;
  useEffect(() => {
    if (!view) return;
    const at = document.activeElement;
    const lost = at === null || at === document.body;
    if (onPhone || lost || (at !== sheet.current && sheet.current?.contains(at))) sheet.current?.focus({ preventScroll: true });
  }, [view, onPhone]);
  /** Tab and Shift+Tab go round what's in the phone's sheet, never out to the call behind it. */
  const keepKeys = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !onPhone) return;
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')]
      .filter((el) => el.getClientRects().length > 0 && el.closest('[inert]') === null);
    const first = all[0];
    const last = all.at(-1);
    const at = document.activeElement;
    if (!first || !last) { e.preventDefault(); return; }
    if (e.shiftKey && (at === first || at === e.currentTarget)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  const away = reduce ? { opacity: 0 } : side?.phone ? { y: '100%' } : { x: sideBox.w + 40 };
  const here = side?.phone ? { opacity: 1, y: 0 } : { ...at(sideBox), opacity: 1, x: 0 };
  return (
    <div ref={area} className="ic-main">
      {measured.current && frames}
      {measured.current && tiles}
      {swap && <div className="ic-swapbar">{swap}</div>}
      <AnimatePresence>
        {measured.current && (side?.phone || side?.over) && (
          <motion.div key={side.phone ? 'scrim' : 'dim'} className={cn('ic-scrim', !side.phone && 'is-over')} aria-hidden="true" onClick={side.onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : { duration: 0.24 }} />
        )}
        {measured.current && side && (
          <motion.aside key={side.phone ? 'sheet' : 'side'} ref={sheet} tabIndex={-1} onKeyDown={keepKeys} className={cn('ic-side', side.theme, side.phone && 'is-sheet', side.over && !side.phone && 'is-over')} aria-label={side.label} data-view={side.view}
            initial={side.phone ? away : { ...at(sideBox), ...away }} animate={here} exit={away}
            transition={reduce ? { duration: 0 } : side.phone ? SLIDE : { ...slide, x: SLIDE }}>
            <ThemeScope theme={side.theme}>{side.children}</ThemeScope>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
