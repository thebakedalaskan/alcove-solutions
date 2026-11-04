/*
 * Whether two things the notes said are the same item in other words. The notes model words things afresh every time
 * and people reword what they settle, so the same thing is told by its words, by when it came up, and for a follow-up
 * by the line it comes from and who it's for (docs: Notes and inference › Live notes). Nothing here is kept.
 */
import { firstName } from '@alcove/api';
import { fold, keyWords } from './drafting';

/** What's compared of anything the notes said: its words, and when it came up (seconds), if they said. */
export interface Said { text: string; at?: number | undefined }
/** What's compared of a follow-up besides: who it's for, by name, and the transcript lines it comes from, by ID. */
export interface SaidFollowUp extends Said { owner?: string | undefined; lines: readonly string[] }

/**
 * The same item in other words: most of the shorter one's words are in the other, and they point at moments within a
 * minute of each other (or one points at none).
 */
const ALIKE = { share: 0.6, seconds: 60 };
const wordsOf = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(' ').filter(Boolean);
export function alike(a: Said, b: Said): boolean {
  if (a.at !== undefined && b.at !== undefined && Math.abs(a.at - b.at) > ALIKE.seconds) return false;
  const [x, y] = [wordsOf(a.text), wordsOf(b.text)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!short.length) return false;
  const left = new Map<string, number>();
  for (const w of long) left.set(w, (left.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of short) { const n = left.get(w) ?? 0; if (n) { shared++; left.set(w, n - 1); } }
  return shared >= ALIKE.share * short.length;
}

/** Follow-ups for two different people are two follow-ups, however alike: by first name, as the notes model gives them. */
const sameOwner = (a: string | undefined, b: string | undefined) => !a || !b || fold(firstName(a)) === fold(firstName(b));

/**
 * How plainly two follow-ups are one item, 0 for not at all. They never are when they name two people. They are when
 * they come from the same line and share a word that says something (a line can hold two things to do, which share
 * none), or are `alike`. Coming from the same line counts for more, and then the more of the shorter one's words the
 * better.
 */
export function likeness(a: SaidFollowUp, b: SaidFollowUp): number {
  if (!sameOwner(a.owner, b.owner)) return 0;
  const [x, y] = [new Set(keyWords(a.text)), new Set(keyWords(b.text))];
  const shared = [...x].filter((w) => y.has(w)).length / Math.max(1, Math.min(x.size, y.size));
  if (shared > 0 && a.lines.some((l) => b.lines.includes(l))) return 2 + shared;
  return alike(a, b) ? 1 + shared : 0;
}

/**
 * Pairs each of `as` with the one of `bs` it most plainly is, the plainest pairs first, each used once. `score` is 0 for
 * a pair that isn't one. Anything left over has no pair.
 */
export function pairUp<A, B>(as: readonly A[], bs: readonly B[], score: (a: A, b: B) => number): Map<A, B> {
  const pairs = as.flatMap((a) => bs.flatMap((b) => { const n = score(a, b); return n > 0 ? [{ a, b, n }] : []; })).sort((p, q) => q.n - p.n);
  const out = new Map<A, B>();
  const taken = new Set<B>();
  for (const { a, b } of pairs) {
    if (out.has(a) || taken.has(b)) continue;
    out.set(a, b);
    taken.add(b);
  }
  return out;
}
