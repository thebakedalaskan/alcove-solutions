import { type AgentScope } from '@alcove/api';
import type { AgentPermission } from '@alcove/ui';

/**
 * Each permission an agent can have: what it's called (`label`), what it allows (`detail`), and its `short` name, which is
 * what its chip says and what a question says when your agents don't have it ("Claude can’t book calls").
 */
export const PERMISSIONS = [
  { id: 'notes:read', label: 'Read notes', short: 'Read notes', detail: 'Find notes, read transcripts, and ask questions about them.' },
  { id: 'notes:write', label: 'Edit notes and follow-ups', short: 'Edit notes', detail: 'Propose decisions, add follow-ups and questions, and fix a transcript.' },
  { id: 'notes:share', label: 'Share notes', short: 'Share notes', detail: 'Give people notes you’re allowed to share.' },
  { id: 'notes:delete', label: 'Delete notes', short: 'Delete notes', detail: 'Delete notes, or take shared ones out of yours.' },
  { id: 'meetings:read', label: 'Read calls and find people', short: 'Read calls', detail: 'See past and coming calls, and find people to invite.' },
  { id: 'meetings:write', label: 'Book and change calls', short: 'Book calls', detail: 'Book, move and cancel calls. Your calendar sends the invitations.' },
  { id: 'calendar:read', label: 'Read your calendar', short: 'Read calendar', detail: 'See your meetings, and when people are free.' }
] satisfies ReadonlyArray<AgentPermission & { id: AgentScope; short: string }>;

/** The permissions as chips: each says its short name, and what it allows when the pointer rests on it. */
export const CHIPS: readonly AgentPermission[] = PERMISSIONS.map((p) => ({ id: p.id, label: p.short, detail: `${p.label}. ${p.detail}` }));

export const READ_SCOPES: AgentScope[] = ['notes:read', 'meetings:read', 'calendar:read'];

/** Scopes in the order they're shown, each once. */
export const inOrder = (scopes: readonly AgentScope[]): AgentScope[] => PERMISSIONS.map((p) => p.id).filter((id) => scopes.includes(id));

/** A permission's short name, in a sentence: "can’t book calls". */
export const needs = (scope: AgentScope): string => (PERMISSIONS.find((p) => p.id === scope)?.short ?? scope).toLowerCase();
