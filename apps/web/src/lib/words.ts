/*
 * Words around counts and sentences, said the same way everywhere: a count with its noun, a phrase that starts a
 * sentence, and names in a sentence.
 */

/** The first letter in capitals and the rest as it is, for a phrase that starts a sentence. */
export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Words in a sentence: "Claude", "Claude and Cursor", "Claude, Cursor and Codex". */
export function joined(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}
/** Up to `max` words, then how many more: "Priya, Inès, Kofi and 2 more". One more is named instead. */
export function joinedSome(words: readonly string[], max = 3): string {
  if (words.length <= max + 1) return joined(words);
  return `${words.slice(0, max).join(', ')} and ${words.length - max} more`;
}

/** A count with its noun: "1 note", "3 notes". `many` when the plural isn't the noun with an s. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** How much room something takes, as people read it: "under 1 MB", "214 MB", "1.2 GB". */
export const sizeLabel = (bytes: number): string =>
  bytes < 1e6 ? 'under 1 MB' : bytes < 1e9 ? `${Math.round(bytes / 1e6)} MB` : `${(bytes / 1e9).toFixed(1)} GB`;
