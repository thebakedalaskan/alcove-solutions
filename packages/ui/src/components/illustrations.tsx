/* Illustrations, drawn from the tokens. */
import { useId } from 'react';

/** The empty arch with the sun low behind the horizon: for lists with nothing in them yet. */
export function EmptyArch({ width = 66 }: { width?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="ac-arch-art" width={width} height={(width * 74) / 66} viewBox="0 0 66 74" aria-hidden="true">
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
