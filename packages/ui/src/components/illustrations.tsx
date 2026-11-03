/* Illustrations, in the sunrise palette. */

/** An empty arch with the sun low behind the horizon: for lists with nothing in them yet. */
export function EmptyArch({ width = 66 }: { width?: number }) {
  return (
    <svg className="ill" width={width} height={(width * 74) / 66} viewBox="0 0 66 74" aria-hidden="true">
      <defs><clipPath id="empty-arch"><path d="M7 70V32a26 26 0 0 1 52 0v38z" /></clipPath></defs>
      <path d="M7 70V32a26 26 0 0 1 52 0v38z" fill="var(--sunk)" />
      <g clipPath="url(#empty-arch)"><circle cx="33" cy="56" r="11" fill="var(--sun)" opacity=".55" /><rect x="0" y="56" width="66" height="20" fill="var(--sunk-2)" /></g>
      <path d="M7 70V32a26 26 0 0 1 52 0v38z" fill="none" stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="3 4" />
      <path d="M7 56h52" stroke="var(--line-2)" strokeWidth="1.5" />
    </svg>
  );
}

/** An arch outline with nothing in it: what's left after deleting. */
export function GoneArch() {
  return (
    <svg width="72" height="80" viewBox="0 0 72 80" aria-hidden="true">
      <path d="M8 76V34a28 28 0 0 1 56 0v42z" fill="none" stroke="var(--line-2)" strokeWidth="1.6" strokeDasharray="3 5" />
    </svg>
  );
}
