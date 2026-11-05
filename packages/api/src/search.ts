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
