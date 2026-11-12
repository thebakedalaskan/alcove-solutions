/* The tour: one card that travels to the real interface, and coachmarks. */
import { AnimatePresence, animate, motion, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
import { Icon } from './icon';
import { EASE } from './motion';
import { Button } from './primitives';

export type TourSide = 'below' | 'above' | 'left' | 'right';

/** One slide of the tour: what it's about, the art, and the real element it points at. */
export interface TourSlide {
  id: string;
  title: string;
  text: ReactNode;
  /** A short loop on the dawn sky. Drawn on night, whatever the page's theme. */
  art: ReactNode;
  /** Says where the next button goes ("Show me notes"). The last slide's is the way out. */
  next: string;
  /** The element on the page this slide is about. Looked up again whenever the layout changes. */
  target: () => HTMLElement | null;
  /** Sides of the target the card tries first. */
  prefer: TourSide[];
}

interface Box { x: number; y: number; w: number; h: number; r: number }
interface Spot { x: number; y: number }
type Placement = { side: TourSide | 'sheet'; x: number; y: number };
type How = 'first' | 'move' | 'instant' | 'track';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const EDGE = 16;
const GAP = 58;
/** Below this width the card is a sheet along the bottom (above what it's about, when that's along the bottom too). */
const SHEET = 640;

/** Whether something stays put when the page scrolls (a sticky sidebar, a fixed bar). */
function pinned(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

/** The cut-out around the target, `dy` pixels further down the page than it is now. */
function spotFor(el: HTMLElement, dy: number): Box {
  const r = el.getBoundingClientRect();
  let pad = r.height < 34 ? 7 : 8;
  if (pinned(el)) pad = clamp(r.top - 7, 3, pad);
  const radius = Math.min(Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 10, 30);
  return { x: r.left - pad, y: r.top - pad - dy, w: r.width + pad * 2, h: r.height + pad * 2, r: radius + pad };
}

/** Where the card goes: the first preferred side it fits on, else the side with the most room. */
function place(t: Box, cw: number, ch: number, prefer: TourSide[]): Placement {
  const vw = innerWidth;
  const vh = innerHeight;
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const at: Record<TourSide, Spot> = {
    below: { x: clamp(cx - cw / 2, EDGE, vw - cw - EDGE), y: t.y + t.h + GAP },
    above: { x: clamp(cx - cw / 2, EDGE, vw - cw - EDGE), y: t.y - GAP - ch },
    right: { x: t.x + t.w + GAP, y: clamp(cy - ch / 2, EDGE, vh - ch - EDGE) },
    left: { x: t.x - GAP - cw, y: clamp(cy - ch / 2, EDGE, vh - ch - EDGE) }
  };
  const all: TourSide[] = ['below', 'above', 'right', 'left'];
  const order = [...prefer, ...all.filter((s) => !prefer.includes(s))];
  for (const side of order) {
    const p = at[side];
    if (p.x >= EDGE && p.y >= EDGE && p.x + cw <= vw - EDGE && p.y + ch <= vh - EDGE) return { side, ...p };
  }
  const room: Record<TourSide, number> = { below: vh - (t.y + t.h), above: t.y, right: vw - (t.x + t.w), left: t.x };
  const best = [...order].sort((a, b) => room[b] - room[a])[0] ?? 'below';
  return { side: best, x: clamp(at[best].x, EDGE, vw - cw - EDGE), y: clamp(at[best].y, EDGE, vh - ch - EDGE) };
}

/** A curved arrow from the card's edge to the target's, or null when they nearly touch. */
function arrowFor(side: Placement['side'], c: { x: number; y: number; w: number; h: number }, t: Box): { line: string; head: string } | null {
  const cx = t.x + t.w / 2;
  let s: Spot;
  let e: Spot;
  if (side === 'below' || side === 'sheet') { s = { x: clamp(cx, c.x + 44, c.x + c.w - 44), y: c.y - 10 }; e = { x: clamp(s.x, t.x + 18, t.x + t.w - 18), y: t.y + t.h + 9 }; }
  else if (side === 'above') { s = { x: clamp(cx, c.x + 44, c.x + c.w - 44), y: c.y + c.h + 10 }; e = { x: clamp(s.x, t.x + 18, t.x + t.w - 18), y: t.y - 9 }; }
  else if (side === 'right') { s = { x: c.x - 10, y: clamp(t.y + t.h / 2, c.y + 44, c.y + c.h - 44) }; e = { x: t.x + t.w + 9, y: clamp(s.y, t.y + 12, t.y + t.h - 12) }; }
  else { s = { x: c.x + c.w + 10, y: clamp(t.y + t.h / 2, c.y + 44, c.y + c.h - 44) }; e = { x: t.x - 9, y: clamp(s.y, t.y + 12, t.y + t.h - 12) }; }
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len = Math.hypot(dx, dy);
  if (len < 24) return null;
  const bend = Math.min(34, len * 0.26);
  const sign = side === 'right' || side === 'below' || side === 'sheet' ? 1 : -1;
  const q = { x: s.x + dx / 2 + (-dy / len) * bend * sign, y: s.y + dy / 2 + (dx / len) * bend * sign };
  const tl = Math.hypot(e.x - q.x, e.y - q.y) || 1;
  const tx = (e.x - q.x) / tl;
  const ty = (e.y - q.y) / tl;
  const L = 9;
  const wing = (a: number) => ({ x: e.x - L * (tx * Math.cos(a) - ty * Math.sin(a)), y: e.y - L * (ty * Math.cos(a) + tx * Math.sin(a)) });
  const h1 = wing(0.5);
  const h2 = wing(-0.5);
  const f = (n: number) => n.toFixed(1);
  return { line: `M${f(s.x)} ${f(s.y)}Q${f(q.x)} ${f(q.y)} ${f(e.x)} ${f(e.y)}`, head: `M${f(h1.x)} ${f(h1.y)}L${f(e.x)} ${f(e.y)}L${f(h2.x)} ${f(h2.y)}` };
}

function cutout(b: Box): string {
  const vw = innerWidth;
  const vh = innerHeight;
  const w = Math.max(0, b.w);
  const h = Math.max(0, b.h);
  const r = Math.max(0, Math.min(b.r, w / 2, h / 2));
  const { x, y } = b;
  return `M0 0H${vw}V${vh}H0Z M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp']);
const onButton = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, a');

/**
 * The tour: one card, one idea per slide, that travels to the real thing it's about. The page dims
 * around a cut-out of the target, a ring marks it and an arrow runs from the card to it. The card
 * picks a side it fits on and follows the target when the window changes; below 640px it's a sheet
 * along the bottom, or just above the target when that's down there too (a tab bar), so it stays in sight. Arrow keys and Enter move through it, Escape closes it, and focus stays in the
 * card. Skippable on every slide. `onClose(true)` when the last slide's button was pressed.
 */
export function TourDialog({ slides, onClose }: { slides: TourSlide[]; onClose: (finished: boolean) => void }) {
  const reduce = useReducedMotion() ?? false;
  const [shown, setShown] = useState(-1);
  const [arrow, setArrow] = useState<{ line: string; head: string; n: number; draw: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const scrim = useRef<SVGSVGElement>(null);
  const arrowSvg = useRef<SVGSVGElement>(null);
  const hole = useRef<SVGPathElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const spot = useRef<Box>({ x: 0, y: 0, w: 0, h: 0, r: 13 });
  const pos = useRef<Spot>({ x: 0, y: 0 });
  const cur = useRef(-1);
  const pending = useRef<How | null>(null);
  const moving = useRef<AnimationPlaybackControls[]>([]);
  /** The tour and its card fading in. Moving on finishes them: stopped part way, a fade would hold its value. */
  const fades = useRef<AnimationPlaybackControls[]>([]);
  const busy = useRef(false);
  const closing = useRef(false);
  const lastFocus = useRef<Element | null>(null);
  const arrows = useRef(0);
  /** True while the card glides to a new target (it scrolls the page itself then). */
  const gliding = useRef(false);

  const draw = useCallback(() => {
    const b = spot.current;
    scrim.current?.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    arrowSvg.current?.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    hole.current?.setAttribute('d', cutout(b));
    const rg = ring.current;
    if (rg) Object.assign(rg.style, { transform: `translate(${b.x}px, ${b.y}px)`, width: `${Math.max(0, b.w)}px`, height: `${Math.max(0, b.h)}px`, borderRadius: `${b.r}px` });
    const c = card.current;
    if (c) c.style.transform = `translate(${pos.current.x}px, ${pos.current.y}px)`;
  }, []);

  const stop = () => {
    for (const m of moving.current) m.stop();
    for (const f of fades.current) f.complete();
    moving.current = [];
    fades.current = [];
    gliding.current = false;
  };

  /** Puts the spot, the card and the arrow where slide `i` wants them. False when its target isn't on the page. */
  const layout = useCallback((i: number, how: How): boolean => {
    const s = slides[i];
    const el = s?.target();
    const c = card.current;
    if (!s || !el || !el.getClientRects().length || !c) return false;
    const sheet = innerWidth < SHEET;
    root.current?.classList.toggle('is-sheet', sheet);
    const vh = innerHeight;
    const cw = c.offsetWidth;
    const ch = c.offsetHeight;
    const fixed = pinned(el);
    const r = el.getBoundingClientRect();
    let dy = 0;
    if (!fixed && how !== 'track') {
      const top = sheet ? 88 : 96;
      const bottom = sheet ? vh - ch - 70 : vh - 40;
      if (r.top < top || r.bottom > bottom) {
        const room = Math.max(0, document.documentElement.scrollHeight - vh);
        const want = sheet ? r.top - Math.max(top, (bottom - r.height) * 0.55) : r.top - vh * 0.3;
        dy = Math.round(clamp(want, -scrollY, room - scrollY));
      }
    }
    const t = spotFor(el, dy);
    // A target along the bottom (a tab bar) would be under the sheet: the sheet stands above it, pointing down.
    const lifted = sheet && t.y + t.h > vh - ch;
    root.current?.classList.toggle('is-lifted', lifted);
    let p: Placement;
    if (lifted) p = { side: 'above', x: 0, y: Math.max(EDGE, t.y - ch - GAP) };
    else if (sheet) p = { side: 'sheet', x: 0, y: vh - ch };
    else {
      p = place(t, cw, ch, s.prefer);
      if (!fixed && p.side !== 'right' && p.side !== 'left' && (p.y < EDGE || p.y + ch > vh - EDGE)) p.y = clamp(p.y, EDGE, vh - ch - EDGE);
    }
    const a = arrowFor(p.side, { x: p.x, y: p.y, w: cw, h: ch }, t);
    const showArrow = (animated: boolean) => { gliding.current = false; setArrow(a ? { ...a, n: ++arrows.current, draw: animated } : null); };
    stop();
    // Moving on can cut the first slide's fade-in short (→ pressed quickly): the tour and its card are in by now, whatever it stopped.
    if (how !== 'first') {
      c.style.opacity = '1';
      if (root.current) root.current.style.opacity = '1';
    }
    if (how === 'instant' || how === 'track' || reduce) {
      if (dy) scrollTo(0, scrollY + dy);
      spot.current = t;
      pos.current = { x: p.x, y: p.y };
      draw();
      if (root.current && how !== 'track' && how !== 'instant') root.current.style.opacity = '1';
      showArrow(false);
      return true;
    }
    setArrow(null);
    gliding.current = true;
    const s0 = { ...spot.current };
    const p0 = { ...pos.current };
    const y0 = scrollY;
    if (how === 'first') {
      spot.current = { x: t.x - 26, y: t.y - 26, w: t.w + 52, h: t.h + 52, r: t.r + 26 };
      pos.current = { x: p.x, y: p.y + (sheet ? 40 : 14) };
      draw();
      const from = { ...spot.current };
      const fromY = pos.current.y;
      if (dy) moving.current.push(animate(0, 1, { duration: 0.52, ease: EASE.inOut, onUpdate: (v) => scrollTo(0, y0 + dy * v) }));
      if (root.current) fades.current.push(animate(root.current, { opacity: [0, 1] }, { duration: 0.32, ease: EASE.out }));
      moving.current.push(animate(0, 1, {
        duration: 0.62, delay: 0.05, ease: EASE.expo,
        onUpdate: (v) => { spot.current = { x: lerp(from.x, t.x, v), y: lerp(from.y, t.y, v), w: lerp(from.w, t.w, v), h: lerp(from.h, t.h, v), r: lerp(from.r, t.r, v) }; draw(); },
        onComplete: () => showArrow(true)
      }));
      moving.current.push(animate(0, 1, { duration: 0.55, delay: 0.12, ease: EASE.expo, onUpdate: (v) => { pos.current = { x: p.x, y: lerp(fromY, p.y, v) }; draw(); } }));
      if (c) fades.current.push(animate(c, { opacity: [0, 1] }, { duration: 0.55, delay: 0.12, ease: EASE.expo }));
      return true;
    }
    moving.current.push(animate(0, 1, {
      duration: 0.52, ease: EASE.inOut,
      onUpdate: (v) => {
        if (dy) scrollTo(0, y0 + dy * v);
        spot.current = { x: lerp(s0.x, t.x, v), y: lerp(s0.y, t.y, v), w: lerp(s0.w, t.w, v), h: lerp(s0.h, t.h, v), r: lerp(s0.r, t.r, v) };
        pos.current = { x: lerp(p0.x, p.x, v), y: lerp(p0.y, p.y, v) };
        draw();
      },
      onComplete: () => showArrow(true)
    }));
    return true;
  }, [slides, reduce, draw]);

  const close = useCallback((finished: boolean) => {
    if (closing.current) return;
    closing.current = true;
    stop();
    const done = () => {
      onClose(finished);
      const f = lastFocus.current;
      if (f instanceof HTMLElement && f !== document.body && f.isConnected) f.focus({ preventScroll: true });
    };
    if (reduce || !root.current) { done(); return; }
    void animate(root.current, { opacity: 0 }, { duration: 0.3, ease: EASE.in }).then(done);
  }, [onClose, reduce]);

  const go = useCallback(async (i: number) => {
    if (busy.current || closing.current) return;
    if (i >= slides.length) { close(true); return; }
    if (i < 0) return;
    const first = cur.current < 0;
    busy.current = true;
    if (!first && !reduce && body.current) await animate(body.current, { opacity: 0 }, { duration: 0.14, ease: EASE.in });
    cur.current = i;
    pending.current = first ? 'first' : 'move';
    setShown(i);
  }, [slides.length, close, reduce]);

  /* A new slide is on the card: measure it, move everything to its target, and bring its words in. */
  useLayoutEffect(() => {
    const how = pending.current;
    if (shown < 0 || !how) return;
    pending.current = null;
    busy.current = false;
    if (!layout(shown, how)) {
      // Its target went away (the day changed under the tour): on to the next one.
      void go(shown + 1);
      return;
    }
    if (body.current) {
      if (reduce) body.current.style.opacity = '1';
      else void animate(body.current, { opacity: [0, 1], y: [6, 0] }, { duration: 0.34, delay: 0.2, ease: EASE.out });
    }
    nextBtn.current?.focus({ preventScroll: true });
  }, [shown, layout, go, reduce]);

  useEffect(() => {
    lastFocus.current = document.activeElement;
    void go(0);
    return stop;
    // Opens once, on mount; the slides don't change while it's open.
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const relayout = (how: How) => { if (cur.current >= 0 && !busy.current && !closing.current) layout(cur.current, how); };
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => relayout('instant'), 90); };
    const onScroll = () => { if (!gliding.current) relayout('track'); };
    const hold = (e: Event) => { if (!(e.target instanceof Element && e.target.closest('.ac-tour-card'))) e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton(e.target))) { e.preventDefault(); void go(cur.current + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); void go(cur.current - 1); }
      else if (SCROLL_KEYS.has(e.key) && !onButton(e.target)) e.preventDefault();
    };
    addEventListener('resize', onResize);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('wheel', hold, { passive: false });
    addEventListener('touchmove', hold, { passive: false });
    addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      removeEventListener('resize', onResize);
      removeEventListener('scroll', onScroll);
      removeEventListener('wheel', hold);
      removeEventListener('touchmove', hold);
      removeEventListener('keydown', onKey);
    };
  }, [layout, close, go]);

  /* Focus stays on the card's buttons. */
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !card.current) return;
    const items = Array.from(card.current.querySelectorAll('button'));
    const i = items.findIndex((b) => b === document.activeElement);
    const next = items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length];
    e.preventDefault();
    next?.focus();
  };

  const slide = slides[Math.max(0, shown)];
  const last = shown === slides.length - 1;
  if (!slide) return null;
  return createPortal(
    <div ref={root} className="ac-tour" style={{ opacity: 0 }}>
      <svg ref={scrim} className="ac-tour-scrim" aria-hidden="true"><path ref={hole} fillRule="evenodd" /></svg>
      <div ref={ring} className="ac-tour-ring" aria-hidden="true" />
      <svg ref={arrowSvg} className="ac-tour-arrow" aria-hidden="true">
        {arrow && (
          <g key={arrow.n}>
            <motion.path d={arrow.line} initial={arrow.draw ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.36, ease: EASE.out }} />
            <motion.path d={arrow.head} initial={arrow.draw ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.16, delay: 0.28 }} />
          </g>
        )}
      </svg>
      <div ref={card} className="ac-tour-card" role="dialog" aria-modal="true" aria-labelledby="ac-tour-title" aria-describedby="ac-tour-text" tabIndex={-1} onKeyDown={trap}>
        <div className="art" aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.div key={slide.id} className="ac-tour-art" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.34, delay: 0.14, ease: EASE.out } }} exit={{ opacity: 0, transition: { duration: 0.18 } }}>
              {slide.art}
            </motion.div>
          </AnimatePresence>
        </div>
        <div ref={body} className="body">
          <h3 id="ac-tour-title" className="ac-display-s">{slide.title}</h3>
          <p id="ac-tour-text">{slide.text}</p>
        </div>
        <div className="foot">
          <span className="ac-steps" role="img" aria-label={`Step ${shown + 1} of ${slides.length}`}>{slides.map((s, i) => <i key={s.id} className={cn(i === shown && 'is-on')} />)}</span>
          {!last && <Button variant="quiet" size="sm" onClick={() => close(false)}>Skip tour</Button>}
          <Button ref={nextBtn} variant="primary" size="sm" onClick={() => void go(cur.current + 1)}>{slide.next}{!last && <Icon name="right" size={16} />}</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Points at one part of the interface; give the target the `ac-spot` class. Two lines at most. */
export function Coachmark({ title, children, className }: { title: string; children: ReactNode; className?: string | undefined }) {
  return <div className={cn('ac-coach', className)} role="note"><b>{title}</b>{children}</div>;
}
