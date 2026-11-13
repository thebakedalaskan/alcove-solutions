import type { ReactNode } from 'react';

const literally = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Marks every word of a search where it shows, each word whole. `starts`: only where a word starts with it, as a name is
 * found by a word that starts one of its names ("may" finds Maya, and marks nothing inside another word).
 */
export function marked(text: string, terms: string[], starts = false): ReactNode {
  if (!terms.length) return text;
  const words = new RegExp(`(${starts ? '(?<![\\p{L}\\p{N}])' : ''}(?:${terms.map((t) => `${literally(t)}[\\p{L}\\p{N}]*`).join('|')}))`, 'giu');
  return text.split(words).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/**
 * A long line, cut so what matched is near its start: when the match is `room` characters in or further, it starts a word
 * or two (`lead` characters) before it. Notes' rows have one line for it; the palette's moments have two.
 */
export function nearMatch(text: string, terms: string[], room = 46, lead = 24): string {
  const low = text.toLowerCase();
  const at = Math.min(...terms.map((t) => low.indexOf(t)).filter((i) => i >= 0));
  return at < room || !Number.isFinite(at) ? text : `…${text.slice(text.lastIndexOf(' ', at - lead) + 1)}`;
}
