import { animate, motion, useReducedMotion, type Variants } from 'motion/react';
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * The easing curves, for motion/react. `out` for arrivals, `inOut` for moves, `expo` for long
 * entrances and glides, `in` for leaving, `soft` for a whole page fading in over another (`--ease-expo`
 * and `--ease-soft` in CSS). Nothing snaps.
 */
export const EASE = {
  out: [0.22, 0.8, 0.24, 1],
  inOut: [0.65, 0, 0.35, 1],
  expo: [0.16, 1, 0.3, 1],
  in: [0.4, 0, 1, 1],
  soft: [0, 0, 0.58, 1]
} as const;

/**
 * The `--duration-*` tokens in seconds, for motion/react (in ms for the Web Animations API): the scale, and the slower
 * clock of a page taking another's place.
 */
export const DURATION = { 1: 0.14, 2: 0.24, 3: 0.42, 4: 0.9, 5: 2.4, 'page-1': 0.34, 'page-2': 0.5, 'page-3': 0.6, 'page-4': 1.1 } as const;

/** Whether whoever's looking asked for less motion: then what moves simply happens. */
const lessMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What's laid out beside `el`: its container's children, through any box that's `display: contents`, but not what floats over them. */
function laidOutWith(el: HTMLElement): HTMLElement[] {
  let box = el.parentElement;
  while (box && getComputedStyle(box).display === 'contents') box = box.parentElement;
  const out: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const style = getComputedStyle(child);
      if (style.display === 'contents') walk(child);
      else if (style.position !== 'absolute' && style.position !== 'fixed') out.push(child);
    }
  };
  if (box) walk(box);
  return out;
}

/**
 * Folds `el` away where it stands, then calls `done`, which takes it out: its height and opacity go to nothing over
 * --duration-2, easing in, and so does the room it leaves beside it (the gap or margin to what's laid out after it, or before
 * it when it's last), so nothing under it moves again once it's gone. It stays folded until it's taken out. Its container
 * should be a block or a flex column: a grid keeps its gaps. Under reduced motion, `done` at once.
 */
export function foldAway(el: HTMLElement, done: () => void): void {
  if (lessMotion() || typeof el.animate !== 'function' || !el.isConnected) { done(); return; }
  const box = el.getBoundingClientRect();
  const others = laidOutWith(el).filter((x) => x !== el && !el.contains(x)).map((x) => x.getBoundingClientRect()).filter((r) => r.height > 0);
  const after = others.filter((r) => r.top >= box.bottom - 0.5).sort((a, b) => a.top - b.top)[0];
  const before = after ? undefined : others.filter((r) => r.bottom <= box.top + 0.5).sort((a, b) => b.bottom - a.bottom)[0];
  const style = getComputedStyle(el);
  const mt = Number.parseFloat(style.marginTop) || 0;
  const mb = Number.parseFloat(style.marginBottom) || 0;
  el.style.overflow = 'hidden';
  const folding = el.animate([
    { height: `${box.height}px`, opacity: 1, marginTop: `${mt}px`, marginBottom: `${mb}px` },
    { height: '0px', opacity: 0, marginTop: `${mt - (before ? box.top - before.bottom : 0)}px`, marginBottom: `${mb - (after ? after.top - box.bottom : 0)}px` }
  ], { duration: DURATION[2] * 1000, easing: `cubic-bezier(${EASE.in.join(', ')})`, fill: 'forwards' });
  folding.addEventListener('finish', done, { once: true });
}

/**
 * Leaves a still copy of `el` where it stands, fading out over --duration-2 on the soft curve, so what takes its place in
 * the same moment fades in over it rather than after a blank: one view of a page crossfading into another. The copy can't be
 * pressed or focused, screen readers don't hear it, its IDs are gone, nothing in it moves, and it's removed once it has
 * faded; it's marked `data-leaving`. `drop` names what to leave out of it (selectors, inside it), such as the evening
 * behind, which stays, or a copy still fading from before. Nothing under reduced motion.
 */
export function leaveFading(el: HTMLElement, drop: readonly string[] = []): void {
  if (lessMotion() || !el.isConnected || typeof el.animate !== 'function') return;
  const copy = el.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return;
  for (const s of drop) for (const x of Array.from(copy.querySelectorAll(s))) x.remove();
  for (const x of Array.from(copy.querySelectorAll('[id]'))) x.removeAttribute('id');
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('data-leaving', '');
  copy.inert = true;
  // Still: what rises or moves in the page as it comes in would do it again in the copy.
  for (const x of [copy, ...Array.from(copy.querySelectorAll('*'))]) if (x instanceof HTMLElement || x instanceof SVGElement) x.style.animation = 'none';
  const box = el.getBoundingClientRect();
  Object.assign(copy.style, {
    position: 'absolute', left: '0px', top: '0px', zIndex: '1', width: `${box.width}px`, height: `${box.height}px`, minHeight: '0px', margin: '0px',
    pointerEvents: 'none', transition: 'none'
  });
  el.append(copy);
  const fading = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION[2] * 1000, easing: `cubic-bezier(${EASE.soft.join(', ')})`, fill: 'forwards' });
  fading.addEventListener('finish', () => copy.remove(), { once: true });
}

const VIEW = { once: true, margin: '0px 0px -12% 0px' } as const;
const rise: Variants = { hidden: { opacity: 0, y: 36 }, shown: { opacity: 1, y: 0, transition: { duration: 1.1, ease: EASE.expo } } };
const lift: Variants = { hidden: { opacity: 0, y: 70, scale: 0.97 }, shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 1.4, ease: EASE.expo } } };

/**
 * Rises into place the first time it scrolls into view. `lift` for a large frame or picture, which
 * comes up from further and grows slightly. Under reduced motion it's simply there.
 */
export function Reveal({ lift: isLift = false, className, children }: { lift?: boolean; className?: string | undefined; children: ReactNode }) {
  const reduce = useReducedMotion();
  return <motion.div className={className} variants={isLift ? lift : rise} initial={reduce ? false : 'hidden'} whileInView="shown" viewport={VIEW}>{children}</motion.div>;
}

/** Each child rises into place in turn, the first time the group scrolls into view. */
export function RevealGroup({ className, children }: { className?: string | undefined; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : 'hidden'} whileInView="shown" viewport={VIEW} variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.12 } } }}>
      {Children.map(children, (c) => c === null || c === false ? null : <motion.div variants={rise}>{c}</motion.div>)}
    </motion.div>
  );
}

/** Counts up to `value` from wherever it last was. */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('en-US'), duration = 1.2, className }: { value: number; format?: (v: number) => string; duration?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const c = animate(from.current, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(v) });
    from.current = value;
    return () => c.stop();
  }, [value, duration, reduce]);
  return <span className={cn('tabular', className)}>{format(shown)}</span>;
}

/** Text that writes itself in, a word at a time. */
export function Words({ text, from = 0, className }: { text: string; from?: number; className?: string }) {
  const words = text.split(' ');
  return (
    <span className={className}>
      {words.map((w, i) => <span key={`${i}-${w}`} className="ac-word" style={{ '--w': i, '--from': `${from}ms` }}>{w}{i < words.length - 1 ? ' ' : ''}</span>)}
    </span>
  );
}

/** A check mark that draws itself when `done` flips on, over `duration` seconds. */
export function CheckDraw({ done, size = 12, duration = 0.36, className }: { done: boolean; size?: number; duration?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <motion.path d="m5 12.6 4.4 4.4L19 7.6" initial={false} animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }} transition={{ duration, ease: [0.22, 0.8, 0.24, 1] }} />
    </svg>
  );
}

/** Three dots for "listening" and other waits. */
export const Dots = ({ className }: { className?: string }) => <span aria-hidden="true" className={cn('ac-dots', className)}><i /><i /><i /></span>;
