import type { ReactNode } from 'react';

/** Marks where a search matched, the first time it does. */
export function highlight(s: string, term: string): ReactNode {
  if (!term) return s;
  const i = s.toLowerCase().indexOf(term.toLowerCase());
  return i < 0 ? s : <>{s.slice(0, i)}<mark>{s.slice(i, i + term.length)}</mark>{s.slice(i + term.length)}</>;
}

const literally = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Marks every word of a search where it shows, each word whole. */
export function marked(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const words = new RegExp(`(${terms.map((t) => `${literally(t)}[\\p{L}\\p{N}]*`).join('|')})`, 'giu');
  return text.split(words).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/** A long line, cut so what matched is near its start. */
export function nearMatch(text: string, terms: string[]): string {
  const low = text.toLowerCase();
  const at = Math.min(...terms.map((t) => low.indexOf(t)).filter((i) => i >= 0));
  return at < 46 || !Number.isFinite(at) ? text : `…${text.slice(text.lastIndexOf(' ', at - 24) + 1)}`;
}
