import { isAcceptedFollowUp, firstName, type ActionItem, type Note, type NoteSummary, type Person, type Received, type Recipient, type RecipientRole } from '@alcove/api';
import { sameEmail, someNames } from '~/lib/people';
import { noteDay, noteWhen } from '~/lib/time';

/** What a note's row says under its title: its day, and how it came to you (receivedLine) or that it was in the room. */
export const noteLine = (n: NoteSummary): string =>
  [noteDay(n.startedAt), ...(n.received ? [receivedLine(n.received)] : n.kind === 'room' ? ['In the room'] : [])].join(' · ');

/**
 * Who you are to a note, for what you may do in it: its organizer when it's yours, otherwise as you got it. A team's note
 * is read like one shared with you: it can only be read and asked about.
 */
export const readerRole = (r: Received | undefined): RecipientRole => (!r ? 'organizer' : r.role === 'team' ? 'shared' : r.role);

/**
 * How you came to have someone else's note: "Shared by Theo with Leads", "Shared by Priya", "From Lena’s link", "From
 * Kofi’s call", or "From Priya, visible to Vandelay Industries" (`team`, the team's name, when it's known).
 */
export function receivedLine(r: Received, team?: string | undefined): string {
  const by = firstName(r.by.name);
  if (r.role === 'team') return `From ${by}, visible to ${team ?? 'your team'}`;
  if (r.role === 'invited') return `From ${by}’s call`;
  if (r.link) return `From ${by}’s link`;
  return r.group ? `Shared by ${by} with ${r.group}` : `Shared by ${by}`;
}

/** How someone has a note: they ran the call, were invited to it, opened someone's link, or who shared it with them afterwards (and with which group). */
export function roleLine(r: Recipient, me: string | undefined): string {
  if (r.role === 'organizer') return 'Organizer';
  if (r.role === 'invited') return 'Invited';
  if (!r.by) return 'Shared afterwards';
  const yours = !!me && sameEmail(r.by, { email: me });
  if (r.link) return yours ? 'By your link' : `By ${firstName(r.by.name)}’s link`;
  const by = yours ? 'you' : firstName(r.by.name);
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
  const said = n.actions.filter((a) => isAcceptedFollowUp(a) && a.from === null);
  const fromBoards = n.actions.filter((a) => isAcceptedFollowUp(a) && a.from === 'board');
  const line = (a: ActionItem) => `- ${a.text}${about(a) ? ` (${about(a)})` : ''}`;
  // The full summary, under the short one, as the note shows it: its paragraphs a blank line apart.
  const full = n.details.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return [
    n.title, noteWhen(n.startedAt, n.duration), '', n.summary,
    ...(full.length ? ['', 'Full summary', full.join('\n\n')] : []),
    ...(decided.length ? ['', 'Decisions', ...decided.map((d) => `- ${d.text}${d.state === 'proposed' ? ' (not confirmed yet)' : d.state === 'superseded' ? ' (no longer holds)' : ''}`)] : []),
    ...(open.length ? ['', 'Still open', ...open.map((x) => `- ${x.text}`)] : []),
    ...(said.length ? ['', 'Follow-ups', ...said.map(line)] : []),
    ...(fromBoards.length ? ['', 'Follow-ups from the board', ...fromBoards.map(line)] : []),
    ...(n.additions.some((a) => a.text) ? ['', 'Shared notes', ...n.additions.filter((a) => a.text).map((a) => `- ${a.text} (${a.by.name})`)] : [])
  ].join('\n');
}

/**
 * A call's notes as Markdown, to keep on this device: its title and when, the summary and the full one, what was decided and
 * whether it's confirmed, what's still open, the follow-ups with who and when, each breakout room's, and the shared notes.
 */
export function noteAsMarkdown(n: Note): string {
  const about = (a: ActionItem) => [a.owner ? `${a.owner.name}${a.takenOn ? '' : ', not taken on yet'}` : '', a.due && !a.takenOn ? `suggested for ${a.due}` : a.due].filter((x): x is string => !!x).join(', ');
  const item = (a: ActionItem) => `- [${a.done ? 'x' : ' '}] ${a.text}${about(a) ? ` (${about(a)})` : ''}`;
  const decided = (ds: Note['decisions']) => ds.filter((d) => d.state !== 'rejected').map((d) => `- ${d.text}${d.state === 'proposed' ? ' (not confirmed yet)' : d.state === 'superseded' ? ' (no longer holds)' : ''}`);
  const open = (qs: Note['questions']) => qs.filter((x) => x.state === 'open').map((x) => `- ${x.text}`);
  const part = (title: string, lines: string[]) => (lines.length ? ['', `## ${title}`, '', ...lines] : []);
  const full = n.details.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const rooms = n.rooms.flatMap((r) => {
    const lines = [...(r.summary ? [r.summary, ''] : []), ...decided(r.decisions), ...open(r.questions), ...r.actions.filter(isAcceptedFollowUp).map(item)];
    return lines.length ? ['', `### ${r.name}`, '', ...lines] : [];
  });
  return [
    `# ${n.title}`, '', noteWhen(n.startedAt, n.duration), '', n.summary,
    ...part('Full summary', full.flatMap((p, i) => (i ? ['', p] : [p]))),
    ...part('Decided', decided(n.decisions)),
    ...part('Still open', open(n.questions)),
    ...part('Follow-ups', n.actions.filter((a) => isAcceptedFollowUp(a) && a.from === null).map(item)),
    ...part('Follow-ups from the board', n.actions.filter((a) => isAcceptedFollowUp(a) && a.from === 'board').map(item)),
    ...part('How it went', n.chapters.map((c) => `- **${c.title}**${c.summary ? `: ${c.summary}` : ''}`)),
    ...(rooms.length ? ['', '## Breakout rooms', ...rooms] : []),
    ...part('Shared notes', n.additions.filter((a) => a.text).map((a) => `- ${a.text} (${a.by.name})`)),
    ''
  ].join('\n');
}
