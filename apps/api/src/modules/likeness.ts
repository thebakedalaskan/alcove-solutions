/*
 * Whether two things the notes said are the same item in other words. The notes model words things afresh every time
 * and people reword what they settle, so the same thing is told by its words, by when it came up, and for a follow-up
 * by the lines it comes from and who it's for (docs: Notes and inference › Live notes). A follow-up taken for another
 * hands it someone's tick, so when in doubt two are two. Nothing here is kept.
 */
import { firstName } from '@alcove/api';
import { fold, keyWords } from './drafting';

/** What's compared of anything the notes said: its words, and when it came up (seconds), if they said. */
export interface Said { text: string; at?: number | undefined }
/** What's compared of a follow-up besides: who it's for, by name, the transcript lines it comes from, by ID, and what those lines say. */
export interface SaidFollowUp extends Said { owner?: string | undefined; lines: readonly string[]; heard: string }

/**
 * The same item in other words, for notes written again: most of the shorter one's words are in the other, and they
 * point at moments within a minute of each other (or one points at none).
 */
const ALIKE = { share: 0.6, seconds: 60 };
const wordsOf = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(' ').filter(Boolean);
const near = (a: Said, b: Said) => a.at === undefined || b.at === undefined || Math.abs(a.at - b.at) <= ALIKE.seconds;
export function alike(a: Said, b: Said): boolean {
  if (!near(a, b)) return false;
  const [x, y] = [wordsOf(a.text), wordsOf(b.text)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!short.length) return false;
  const left = new Map<string, number>();
  for (const w of long) left.set(w, (left.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of short) { const n = left.get(w) ?? 0; if (n) { shared++; left.set(w, n - 1); } }
  return shared >= ALIKE.share * short.length;
}

/** Runs of scripts written without spaces between words: there are no words to split them into, so they're compared by pairs of characters. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]+/gu;
/**
 * What a text says, to compare: the words that say what it's about (`keyWords`, so never "the" or "to"), the numbers,
 * which tell job 7 from job 8 however short they are, and pairs of characters of anything written without spaces.
 */
export function termsOf(text: string): Set<string> {
  const clean = text.normalize('NFKC');
  const pairs = (clean.match(UNSPACED) ?? []).flatMap((run) => { const cs = [...run]; return cs.length < 2 ? cs : cs.slice(1).map((c, i) => `${cs[i] ?? ''}${c}`); });
  return new Set([...keyWords(clean.replace(UNSPACED, ' ')), ...(clean.match(/\p{N}+/gu) ?? []), ...pairs]);
}
/** The share of the shorter set that's in the other, and how many that was. */
function overlap(x: Set<string>, y: Set<string>): { shared: number; share: number } {
  const shared = [...x].filter((w) => y.has(w)).length;
  return { shared, share: shared / Math.max(1, Math.min(x.size, y.size)) };
}

/** Follow-ups for two different people are two follow-ups, however alike: by first name, as the notes model gives them. */
export const sameOwner = (a: string | undefined, b: string | undefined): boolean => !a || !b || fold(firstName(a)) === fold(firstName(b));

/** How much of the shorter one's terms two follow-ups from the same line must share: enough to be about the same thing, however it's reworded. */
const SAME_LINE_SHARE = 1 / 3;
/**
 * How plainly two follow-ups are one item, 0 for not at all. They never are when they name two people. From a line in
 * common, they are when they share enough of what they say, unless each says something from its own lines that the other
 * doesn't, which is how two things to do in one sentence read ("send the report", "send the invoice"), and not how a
 * rewording reads: its new words aren't in the line. With no line in common they are only when everything the shorter
 * one says, at least two things, is in the other, within a minute. A line in common counts for more, and then the
 * larger share.
 */
export function likeness(a: SaidFollowUp, b: SaidFollowUp): number {
  if (!sameOwner(a.owner, b.owner)) return 0;
  const [x, y] = [termsOf(a.text), termsOf(b.text)];
  const { shared, share } = overlap(x, y);
  if (a.lines.some((l) => b.lines.includes(l))) {
    const own = (terms: Set<string>, other: Set<string>, heard: string) => { const h = termsOf(heard); return [...terms].some((w) => !other.has(w) && h.has(w)); };
    return share >= SAME_LINE_SHARE && !(own(x, y, a.heard) && own(y, x, b.heard)) ? 2 + share : 0;
  }
  return share === 1 && shared >= 2 && near(a, b) ? 1 + share : 0;
}
/** Whether something's words are written in another language from `heard`: what it says isn't what was said there. Names and numbers cross over, so it takes most of them. */
export const notInWordsOf = (text: string, heard: string): boolean => {
  const x = termsOf(text);
  const y = termsOf(heard);
  return [...x].filter((w) => y.has(w)).length < x.size / 2;
};

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
