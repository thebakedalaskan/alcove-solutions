/*
 * Words around counts and sentences, said the same way everywhere: a count with its noun, and a phrase that starts a
 * sentence.
 */

/** The first letter in capitals and the rest as it is, for a phrase that starts a sentence. */
export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A count with its noun: "1 note", "3 notes". `many` when the plural isn't the noun with an s. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** How much room something takes, as people read it: "under 1 MB", "214 MB", "1.2 GB". */
export const sizeLabel = (bytes: number): string =>
  bytes < 1e6 ? 'under 1 MB' : bytes < 1e9 ? `${Math.round(bytes / 1e6)} MB` : `${(bytes / 1e9).toFixed(1)} GB`;
