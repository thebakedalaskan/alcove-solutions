import { animate, motion, useReducedMotion, type Variants } from 'motion/react';
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';

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
