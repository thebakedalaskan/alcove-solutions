/*
 * What a search of your notes looks for, read the same way by the server, which finds the notes, and the app, which marks
 * the words. Words count in any order and each must be somewhere in a note. A question goes to the notes model when it's
 * asked, and until then the list shows the notes that have any of its words, without the small ones every question carries.
 */
const SMALL = new Set(('a an and are about all at be been but by can could did do does for from get got had has have how i if in into is it its just like me more my not of on or our out over '
  + 'said say she should so some than that the their them then there these they this those to too up us was we were what when where which who why will with would you your').split(' '));
const ASKS = /^(what|who|whom|whose|when|where|why|how|did|do|does|is|are|was|were|can|could|should|which|has|have|catch|draft|summarise|summarize)\b/i;

/** What's typed into a search: its words to look for, and whether it reads as a question. */
export interface NoteSearch { terms: string[]; question: boolean }

export function searchOf(text: string): NoteSearch {
  const typed = text.trim();
  const question = typed.endsWith('?') || ASKS.test(typed);
  const words = [...new Set(typed.toLowerCase().replace(/[?!.,;:"“”()]/g, ' ').split(/\s+/).filter(Boolean))];
  return { terms: question ? words.filter((w) => w.length > 2 && !SMALL.has(w)) : words, question };
}

/** How many of a search's words `text` has. */
export const termsIn = (text: string, terms: string[]): number => {
  const low = text.toLowerCase();
  return terms.filter((t) => low.includes(t)).length;
};

/**
 * The words of someone's name, lower-cased, parted at spaces, and at hyphens and dashes too: "Mary-Jane O'Neil" is
 * "mary-jane", "mary", "jane" and "o'neil". So the name as it's written finds them ("mary-jane"), and so does either part.
 */
export const nameWords = (name: string): string[] => {
  const low = name.toLowerCase();
  return [...new Set([...low.split(/\s+/), ...low.split(/[\s\-‐–]+/)].filter(Boolean))];
};

/**
 * Whether a search's word, lower-cased already as `searchOf` gives it, starts one of the words of a name (`nameWords`).
 * A single letter starts too many names to say anything.
 */
export const startsName = (words: readonly string[], term: string): boolean => term.length >= 2 && words.some((w) => w.startsWith(term));

/** How many of a search's words start one of the words of `name` ("ma" and "chen" are both in "Maya Chen"), ignoring case. */
export const namesIn = (name: string, terms: string[]): number => {
  const words = nameWords(name);
  return terms.filter((t) => startsName(words, t.toLowerCase())).length;
};

/**
 * `termsSaid` for a line read already, for a caller reading many lines and names: its words lower-cased (`low`), its
 * speaker's name split into its words (`name`, from `nameWords`, empty for nobody) and the search's words lower-cased, as
 * `searchOf` gives them.
 */
export const termsSaidIn = (low: string, name: readonly string[], terms: readonly string[]): number =>
  terms.filter((t) => low.includes(t) || startsName(name, t)).length;

/**
 * How many of a search's words a line of what was said has: in its words, or starting one of the words of its speaker's
 * name, so a name finds what that person said though nobody said the name.
 */
export const termsSaid = (line: { text: string; speaker?: { name: string } | undefined }, terms: string[]): number =>
  termsSaidIn(line.text.toLowerCase(), line.speaker ? nameWords(line.speaker.name) : [], terms.map((t) => t.toLowerCase()));
