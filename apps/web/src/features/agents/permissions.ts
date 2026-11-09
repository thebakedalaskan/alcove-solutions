import { type AgentScope } from '@alcove/api';
import type { AgentPermission } from '@alcove/ui';

/** Each permission an agent can have: what it's called where it's chosen, what it allows, and its `short` name in a connection's line. */
export const PERMISSIONS = [
  { id: 'notes:read', label: 'Read notes', short: 'Read notes', detail: 'Find notes, read available transcripts, ask questions, and read your own entries.' },
  { id: 'notes:write', label: 'Edit notes and follow-ups', short: 'Edit notes', detail: 'Propose and update decisions and tasks, correct transcripts, and manage your own entries.' },
  { id: 'notes:share', label: 'Share notes', short: 'Share notes', detail: 'Give other people access to notes you are allowed to share.' },
  { id: 'notes:delete', label: 'Delete notes', short: 'Delete notes', detail: 'Delete your notes for everyone, or remove shared notes from your account.' },
  { id: 'meetings:read', label: 'Read calls and find people', short: 'Read calls', detail: 'See upcoming and past calls and find people to invite.' },
  { id: 'meetings:write', label: 'Schedule and manage calls', short: 'Manage calls', detail: 'Create, change and cancel calls. A connected calendar sends invitations and updates.' },
  { id: 'calendar:read', label: 'Read calendar and availability', short: 'Read calendar', detail: 'See calendar events and check when people are busy.' }
] satisfies ReadonlyArray<AgentPermission & { id: AgentScope; short: string }>;

export const READ_SCOPES: AgentScope[] = ['notes:read', 'meetings:read', 'calendar:read'];

/** What a connection can do, in a line: "Read notes · Read calls · Read calendar", in the order they're chosen in. */
export function canDo(scopes: readonly AgentScope[]): string {
  return PERMISSIONS.filter((p) => scopes.includes(p.id)).map((p) => p.short).join(' · ');
}
