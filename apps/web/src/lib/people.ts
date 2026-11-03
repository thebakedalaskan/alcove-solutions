/* How people are named in sentences across the app. */
import { firstName, type Person } from '@alcove/api';
import { isEmail } from './parse';

type Named = { name: string; email: string };
/** Someone's first name, or their address when that's all there is. */
export const callName = (p: Named) => (p.name && p.name !== p.email && !isEmail(p.name) ? firstName(p.name) : p.email);
/** "Theo", "Theo and Priya", "Theo, Priya and Kofi" */
export function listNames(people: Named[]): string {
  const n = people.map(callName);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n.at(-1) ?? ''}`;
}
/** Someone known only by the address typed for them. */
export const byEmail = (email: string): Person => ({ id: email, name: email, email });
export const sameEmail = (a: { email: string }, b: { email: string }) => a.email.toLowerCase() === b.email.toLowerCase();
/** Someone in a transcript or a follow-up, as the reader sees them: "You", or their first name. */
export const spokenName = (s: { name: string; person?: Named | undefined }, me: string | undefined) =>
  (me && s.person && sameEmail(s.person, { email: me }) ? 'You' : firstName(s.name));
