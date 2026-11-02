import { useId } from 'react';
import { cn } from '../cn';

/**
 * The Alcove mark: an arched niche with a lamp burning low inside it.
 * The niche stays dark in both themes; in dark surroundings it gets a hairline so it still reads.
 */
export function Mark({ size = 28, className, animate = false }: { size?: number; className?: string; animate?: boolean }) {
  const id = useId().replace(/:/g, '');
  const niche = 'M6 29.5V15.2C6 9.6 10.5 5 16 5s10 4.6 10 10.2v14.3z';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={cn('block shrink-0 overflow-visible', animate && 'alcove-mark-animate', className)}>
      <defs>
        <radialGradient id={`${id}s`} cx="50%" cy="66%" r="62%">
          <stop offset="0" stopColor="#FFB24A" stopOpacity=".62" />
          <stop offset=".55" stopColor="#FFA62B" stopOpacity=".16" />
          <stop offset="1" stopColor="#FFA62B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}f`} cx="40%" cy="36%" r="70%">
          <stop offset="0" stopColor="#FFE3AE" />
          <stop offset=".55" stopColor="#FFAE3D" />
          <stop offset="1" stopColor="#F08A12" />
        </radialGradient>
      </defs>
      <path className="mark-niche fill-[#1E1A16] dark:stroke-[rgba(255,236,210,.2)] dark:stroke-[.9]" d={niche} />
      <path className="mark-spill" d={niche} fill={`url(#${id}s)`} />
      <circle className="mark-flame" cx="16" cy="21.2" r="4" fill={`url(#${id}f)`} style={{ filter: 'drop-shadow(0 0 1.6px rgba(255,166,43,.95)) drop-shadow(0 0 4px rgba(255,166,43,.45))' }} />
    </svg>
  );
}

export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center', className)} style={{ gap: size * 0.34 }}>
      <Mark size={size} />
      <span className="font-display font-extrabold tracking-[-.045em] leading-none text-ink" style={{ fontSize: size * 1.02 }}>alcove</span>
    </span>
  );
}
