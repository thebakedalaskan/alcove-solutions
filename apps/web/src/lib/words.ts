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

/** A plan's room, in the binary units its limits are set in, as people read them: "10 GB", "2.1 GB", "512 MB". */
export function roomLabel(bytes: number): string {
  const gb = bytes / 2 ** 30;
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  const mb = bytes / 2 ** 20;
  return mb >= 1 ? `${Math.round(mb)} MB` : 'under 1 MB';
}

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const wholeDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
/** An amount in micro-USD as people read it: "$20", "$12.50", "$0.50". */
export const usd = (microUsd: number): string => (microUsd % 1_000_000 === 0 ? wholeDollars : dollars).format(microUsd / 1_000_000);
/** An amount to pay or get back, to the cent: "$20.00", "$12.50". */
export const usdCents = (microUsd: number): string => dollars.format(microUsd / 1_000_000);
