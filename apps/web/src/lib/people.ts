/* How people are named in sentences across the app, and how names and addresses are read. */
import { firstName, type Person } from '@alcove/api';

type Named = { name: string; email: string };
/** Whether this reads as a whole email address. */
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
/** Lower case without accents, for matching what's typed against a name. */
export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** The name in an address, when it starts with one: "jamie.lee@…" is Jamie. */
const nameInAddress = (email: string) => {
  const word = /^\p{L}{2,}(?=[._+@-])/u.exec(email)?.[0];
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : email;
};
/** Someone's first name; with only an address to go on, the name in it, or the address itself ("r.okoye@…"). */
export const callName = (p: Named) => (p.name && p.name !== p.email && !isEmail(p.name) ? firstName(p.name) : nameInAddress(p.email));
/** "Theo", "Theo and Priya", "Theo, Priya and Kofi" */
export function listNames(people: Named[]): string {
  const n = people.map(callName);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n.at(-1) ?? ''}`;
}
/** Up to `max` names, then how many more: "Priya, Inès, Kofi and 2 more". One more is named instead. */
export function someNames(people: Named[], max = 3): string {
  if (people.length <= max + 1) return listNames(people);
  return `${people.slice(0, max).map(callName).join(', ')} and ${people.length - max} more`;
}
/** Someone known only by the address typed for them. */
export const byEmail = (email: string): Person => ({ id: email, name: email, email });
export const sameEmail = (a: { email: string }, b: { email: string }) => a.email.toLowerCase() === b.email.toLowerCase();
/** Someone in a transcript or a follow-up, as the reader sees them: "You", or their first name. */
export const spokenName = (s: { name: string; person?: Named | undefined }, me: string | undefined) =>
  (me && s.person && sameEmail(s.person, { email: me }) ? 'You' : firstName(s.name));
