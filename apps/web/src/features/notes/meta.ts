import { firstName, type ActionItem, type Note, type NoteSummary, type Person, type Received, type Recipient } from '@alcove/api';
import { sameEmail, someNames } from '~/lib/people';
import { noteWhen } from '~/lib/time';

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

/** A note as plain text, for pasting somewhere else. */
export function noteAsText(n: Note): string {
  const about = (a: ActionItem) => [a.owner ? `${a.owner.name}${a.takenOn ? '' : ', not taken on yet'}` : '', a.due && !a.takenOn ? `suggested for ${a.due}` : a.due].filter((x): x is string => !!x).join(', ');
  // What people said wasn't decided stays out; what nobody has confirmed yet, or no longer holds, says so.
  const decided = n.decisions.filter((d) => d.state !== 'rejected');
  const open = n.questions.filter((x) => x.state === 'open');
  const said = n.actions.filter((a) => a.from === null);
  const fromBoards = n.actions.filter((a) => a.from === 'board');
  const line = (a: ActionItem) => `- ${a.text}${about(a) ? ` (${about(a)})` : ''}`;
  return [
    n.title, noteWhen(n.startedAt, n.duration), '', n.summary,
    ...(decided.length ? ['', 'Decisions', ...decided.map((d) => `- ${d.text}${d.state === 'proposed' ? ' (not confirmed yet)' : d.state === 'superseded' ? ' (no longer holds)' : ''}`)] : []),
    ...(open.length ? ['', 'Still open', ...open.map((x) => `- ${x.text}`)] : []),
    ...(said.length ? ['', 'Follow-ups', ...said.map(line)] : []),
    ...(fromBoards.length ? ['', 'Follow-ups from the board', ...fromBoards.map(line)] : []),
    ...(n.additions.some((a) => a.text) ? ['', 'Added by people', ...n.additions.filter((a) => a.text).map((a) => `- ${a.text} (${a.by.name})`)] : [])
  ].join('\n');
}
