import type { NoteSummary, RecipientRole } from '@alcove/api';

/** What a note's row says under its title. */
export function noteMeta(n: NoteSummary): string {
  const where = n.kind === 'room' ? 'In the room · ' : '';
  if (n.status === 'recording') return `${where}Recording`;
  if (n.status === 'pending') return `${where}Waiting to be written`;
  return `${where}${n.totalActions ? `${n.totalActions} follow-up${n.totalActions === 1 ? '' : 's'}` : 'No follow-ups'}`;
}

/** How someone came to have a note. */
export const ROLE: Record<RecipientRole, string> = { organizer: 'Organizer', invited: 'Invited', shared: 'Shared afterwards' };
