import type { ReactNode } from 'react';

/** Marks where a search matched, the first time it does. */
export function highlight(s: string, term: string): ReactNode {
  if (!term) return s;
  const i = s.toLowerCase().indexOf(term.toLowerCase());
  return i < 0 ? s : <>{s.slice(0, i)}<mark>{s.slice(i, i + term.length)}</mark>{s.slice(i + term.length)}</>;
}
