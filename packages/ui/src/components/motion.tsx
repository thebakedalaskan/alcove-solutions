import { animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../cn';

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
      {words.map((w, i) => <span key={`${i}-${w}`} className="word" style={{ '--w': i, '--from': `${from}ms` }}>{w}{i < words.length - 1 ? ' ' : ''}</span>)}
    </span>
  );
}

/** A check mark that draws itself when `done` flips on. */
export function CheckDraw({ done, size = 12, className }: { done: boolean; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <motion.path d="m5 12.6 4.4 4.4L19 7.6" initial={false} animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }} transition={{ duration: 0.36, ease: [0.22, 0.8, 0.24, 1] }} />
    </svg>
  );
}

/** Three dots for "listening" and other waits. */
export const Dots = ({ className }: { className?: string }) => <span aria-hidden="true" className={cn('dots', className)}><i /><i /><i /></span>;
