import { firstName, type NoteSummary, type Person, type Received, type Recipient } from '@alcove/api';
import { sameEmail, someNames } from '~/lib/people';

/** What a note's row says under its title. */
export function noteMeta(n: NoteSummary): string {
  const where = n.kind === 'room' ? 'In the room · ' : '';
  if (n.status === 'recording') return `${where}Recording`;
  if (n.status === 'pending') return `${where}Waiting to be written`;
  return `${where}${n.totalActions ? `${n.totalActions} follow-up${n.totalActions === 1 ? '' : 's'}` : 'No follow-ups'}`;
}

/** How you came to have someone else's note: "Shared by Theo with Leads", "Shared by Priya", or "From Kofi’s call". */
export function receivedLine(r: Received): string {
  const by = firstName(r.by.name);
  if (r.role === 'invited') return `From ${by}’s call`;
  return r.group ? `Shared by ${by} with ${r.group}` : `Shared by ${by}`;
}

/** How someone has a note: they ran the call, were invited to it, or who shared it with them afterwards (and with which group). */
export function roleLine(r: Recipient, me: string | undefined): string {
  if (r.role === 'organizer') return 'Organizer';
  if (r.role === 'invited') return 'Invited';
  if (!r.by) return 'Shared afterwards';
  const by = me && sameEmail(r.by, { email: me }) ? 'you' : firstName(r.by.name);
  return r.group ? `Shared by ${by} with ${r.group}` : `Shared afterwards by ${by}`;
}

/** Who has a note, you first: "You, Priya, Theo and Kofi", or "You, Priya, Theo and 47 more". */
export function peopleLine(people: Person[], me: string | undefined): string {
  const mine = (p: Person) => !!me && sameEmail(p, { email: me });
  return someNames([...people.filter(mine).map((p) => ({ ...p, name: 'You' })), ...people.filter((p) => !mine(p))]);
}
