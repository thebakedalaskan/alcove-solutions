import { animate, motion, useInView, useReducedMotion, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';

/** Counts up to `value` once it scrolls into view. */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('en-US'), duration = 1.4, className }: { value: number; format?: (v: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setShown(value); return; }
    const c = animate(from.current, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(v) });
    from.current = value;
    return () => c.stop();
  }, [inView, value, duration, reduce]);
  return <span ref={ref} className={cn('tabular', className)}>{format(shown)}</span>;
}

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } };
export const riseItem: Variants = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 0.8, 0.24, 1] } } };

/** Staggers the entrance of its direct <StaggerItem> children. */
export function Stagger({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'ul' }) {
  const M = motion[as];
  return <M className={className} variants={container} initial="hidden" animate="show">{children}</M>;
}
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return <motion.div className={className} variants={riseItem}>{children}</motion.div>;
}

/** Circular progress, 0..1. */
export function Ring({ value, size = 44, label }: { value: number; size?: number; label?: ReactNode }) {
  const r = 15; const c = 2 * Math.PI * r;
  return (
    <span className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={r} className="fill-none stroke-well" strokeWidth={3.5} />
        <motion.circle cx="18" cy="18" r={r} className="fill-none stroke-ok" strokeWidth={3.5} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value) }} transition={{ duration: 1.1, ease: [0.22, 0.8, 0.24, 1], delay: 0.3 }} />
      </svg>
      {label && <b className="font-mono text-[11px] font-bold">{label}</b>}
    </span>
  );
}

/** A check mark that draws itself when `done` flips on. */
export function CheckDraw({ done, className }: { done: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-3.5 fill-none stroke-current stroke-[3] [stroke-linecap:round] [stroke-linejoin:round]', className)} aria-hidden>
      <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }} transition={{ duration: 0.35, ease: [0.22, 0.8, 0.24, 1] }} />
    </svg>
  );
}

export function WaitingDots({ className }: { className?: string }) {
  return <span className={cn('inline-flex gap-1', className)}>{[0, 1, 2].map((i) => <i key={i} className="size-[5px] rounded-full bg-current animate-[dot3_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>;
}
