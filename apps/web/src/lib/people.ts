/* How people are named in sentences across the app, and how names and addresses are read. */
import { firstName, type Person } from '@alcove/api';
import { joined, joinedSome } from './words';

type Named = { name: string; email: string };
/** Whether this reads as a whole email address. */
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
/** What's on a line someone types people into, to match against: a comma or semicolon pasted after an address isn't part of it. */
export const typedIn = (query: string) => query.trim().replace(/[,;\s]+$/, '').toLowerCase();
/** Lower case without accents, for matching what's typed against a name. */
export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const spaced = (s: string) => fold(s).trim().replace(/\s+/gu, ' ');
/**
 * The people whose name, or a word of it, or their address before the @, starts with what was typed after an `@`, those
 * whose name starts with it first. "pr", "ram" and "priya r" all find Priya Raman, and a letter of the address everyone
 * shares finds nobody by itself, so the list narrows with each letter.
 */
export function startingWith<T>(typed: string, people: readonly T[], who: (item: T) => Named): T[] {
  const t = spaced(typed);
  if (!t) return [...people];
  const rank = (p: Named): number => {
    const name = spaced(p.name);
    if (name.startsWith(t)) return 0;
    if (name.split(/[\s'\u2019.-]+/u).some((w) => w.startsWith(t))) return 1;
    const local = fold(p.email.split('@')[0] ?? '');
    return local.startsWith(t) || local.split(/[._+-]+/u).some((w) => w.startsWith(t)) ? 2 : -1;
  };
  return people.map((item, at) => ({ item, at, rank: rank(who(item)) })).filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.at - b.at).map((r) => r.item);
}
/** The name in an address, when it starts with one: "jamie.lee@…" is Jamie. */
const nameInAddress = (email: string) => {
  const word = /^\p{L}{2,}(?=[._+@-])/u.exec(email)?.[0];
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : email;
};
/** Someone's first name; with only an address to go on, the name in it, or the address itself ("r.okoye@…"). */
export const callName = (p: Named) => (p.name && p.name !== p.email && !isEmail(p.name) ? firstName(p.name) : nameInAddress(p.email));
/** "Theo", "Theo and Priya", "Theo, Priya and Kofi" */
export const listNames = (people: Named[]): string => joined(people.map(callName));
/** Up to `max` names, then how many more: "Priya, Inès, Kofi and 2 more". One more is named instead. */
export const someNames = (people: Named[], max = 3): string => joinedSome(people.map(callName), max);
/** Someone known only by the address typed for them. */
export const byEmail = (email: string): Person => ({ id: email, name: email, email });
export const sameEmail = (a: { email: string }, b: { email: string }) => a.email.toLowerCase() === b.email.toLowerCase();
/** Someone in a transcript or a follow-up, as the reader sees them: "You", or their first name. */
export const spokenName = (s: { name: string; person?: Named | undefined }, me: string | undefined) =>
  (me && s.person && sameEmail(s.person, { email: me }) ? 'You' : firstName(s.name));
