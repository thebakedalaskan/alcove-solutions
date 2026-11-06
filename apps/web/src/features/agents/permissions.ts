import { type AgentScope } from '@alcove/api';
import type { AgentPermission } from '@alcove/ui';

export const PERMISSIONS = [
  { id: 'notes:read', label: 'Read notes', detail: 'Find notes, read available transcripts, ask questions, and read your own entries.' },
  { id: 'notes:write', label: 'Edit notes and follow-ups', detail: 'Propose and update decisions and tasks, correct transcripts, and manage your own entries.' },
  { id: 'notes:share', label: 'Share notes', detail: 'Give other people access to notes you are allowed to share.' },
  { id: 'notes:delete', label: 'Delete notes', detail: 'Delete your notes for everyone, or remove shared notes from your account.' },
  { id: 'meetings:read', label: 'Read calls and find people', detail: 'See upcoming and past calls and find people to invite.' },
  { id: 'meetings:write', label: 'Schedule and manage calls', detail: 'Create, change and cancel calls. A connected calendar sends invitations and updates.' },
  { id: 'calendar:read', label: 'Read calendar and availability', detail: 'See calendar events and check when people are busy.' }
] satisfies ReadonlyArray<AgentPermission & { id: AgentScope }>;

export const READ_SCOPES: AgentScope[] = ['notes:read', 'meetings:read', 'calendar:read'];
export function scopeLabel(scope: AgentScope): string {
  return PERMISSIONS.find((p) => p.id === scope)?.label ?? scope;
}
