/* Illustrations, drawn from the tokens. */
import { useId } from 'react';
import { cn } from '../cn';

/**
 * The empty arch with the sun low behind the horizon: for lists with nothing in them yet. `size` is its
 * width in px (66 in an EmptyState); the height follows.
 */
export function EmptyArch({ size = 66 }: { size?: number | undefined }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="ac-arch-art" width={size} height={(size * 74) / 66} viewBox="0 0 66 74" aria-hidden="true">
      <defs><clipPath id={`${id}ea`}><path d="M7 70V32a26 26 0 0 1 52 0v38z" /></clipPath></defs>
      <path className="well" d="M7 70V32a26 26 0 0 1 52 0v38z" />
      <g clipPath={`url(#${id}ea)`}><circle className="sun" cx="33" cy="56" r="11" /><rect className="land" x="0" y="56" width="66" height="20" /></g>
      <path className="rim" d="M7 70V32a26 26 0 0 1 52 0v38z" strokeWidth="1.5" />
    </svg>
  );
}

/** An arch outline with nothing in it: what's left after deleting. */
export function GoneArch() {
  return (
    <svg className="ac-arch-art" width="72" height="80" viewBox="0 0 72 80" aria-hidden="true">
      <path className="rim" d="M8 76V34a28 28 0 0 1 56 0v42z" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * A few rows not filled in yet, in the colours they'll have: a decision's rose diamond and a follow-up's dashed box, words,
 * and the answer at the end, on a faint panel. For what's waiting on you, before there's anything. `ticks`: boxes to tick
 * and a day at the end instead, for follow-ups.
 */
export function EmptyRows({ ticks = false }: { ticks?: boolean | undefined }) {
  return (
    <span className={cn('ac-empty-rows', ticks && 'is-ticks')} aria-hidden="true">
      <span className="r is-decide"><i className="k" /><i className="l" /><i className="p" /></span>
      <span className="r"><i className="k" /><i className="l s" /><i className="p" /></span>
      <span className="r is-decide"><i className="k" /><i className="l m" /><i className="p" /></span>
    </span>
  );
}

/** A week, drawn: three days with a few meetings in them, tinted as calls and decisions are. For a calendar with nothing in it yet. */
export function EmptyWeek() {
  return (
    <span className="ac-empty-week" aria-hidden="true">
      <span><i /><i className="r" /></span>
      <span><i className="s" /></span>
      <span><i /><i /></span>
    </span>
  );
}

/** Home's small sunset: the sun half down on the horizon, its glitter on the water. For when everything's done. */
export function SmallSunset() {
  return (
    <svg className="ac-small-sunset" width="132" height="58" viewBox="0 0 132 58" aria-hidden="true">
      <path className="s" d="M47 38a19 19 0 0 1 38 0z" />
      <rect className="h" x="0" y="38" width="132" height="1.2" rx=".6" />
      <rect className="g" x="53" y="43" width="26" height="2" rx="1" opacity=".75" />
      <rect className="g" x="57" y="48" width="18" height="2" rx="1" opacity=".5" />
      <rect className="g" x="61" y="53" width="10" height="2" rx="1" opacity=".3" />
    </svg>
  );
}
