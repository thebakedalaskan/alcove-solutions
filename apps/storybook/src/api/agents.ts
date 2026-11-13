/*
 * Made-up agents, scoped to the story's world and signed-in account, as the design canvas tells it on the demo day:
 * Claude, signed in since 21 Oct, used 4 minutes ago (it's just booked the onboarding review); Cursor, signed in on Monday,
 * that can only read; and Art's Weekly digest, a script with a personal token. What they did is kept as the server keeps
 * it, the tool and what it touched, and titles are read from the world when it's listed, so a note deleted since reads
 * back with none. Or Claude alone, just connected, having done nothing yet. Two requests stand for an agent asking to
 * connect (Claude asking for everything, Claude Code for less), and one that has ended.
 */
import { AGENT_SCOPES, AgentActivityQuerySchema, AgentActivitySchema, AgentConnectionSchema, AlcoveApiError, type AgentActivity, type AgentConnection, type AgentScope, type AgentTool } from '@alcove/api';
import type { World } from '../world';
import { call } from '../world/build';
import { iso } from '../world/clock';
import { KOFI, PRIYA } from '../world/people';

/** Public consent pointers for previews; none grants access or works outside Storybook. */
export const AGENT_REQUEST = 'storybook-agent-request'.padEnd(43, '_');
export const CODE_AGENT_REQUEST = 'storybook-code-agent-request'.padEnd(43, '_');
export const EXPIRED_AGENT_REQUEST = 'storybook-expired-request'.padEnd(43, '_');
export const AGENT_CONNECT_PATH = `/connect?request=${AGENT_REQUEST}`;
/** Agents, asked by Claude: where `/connect` sends someone who's signed in. */
export const AGENT_ASK_PATH = `/agents?request=${AGENT_REQUEST}`;
export const PREVIEW_AGENT_TOKEN = 'storybook-preview-token-not-valid-outside-this-story';
export const PREVIEW_MCP_ENDPOINT = 'https://api.example.com/mcp';

/**
 * What each request asks for, by its pointer, and where allowing sends the browser back: a website for Claude, an app
 * on this computer (a port on its loopback address) for Claude Code.
 */
const REQUESTS: ReadonlyMap<string, { clientName: string; redirectHost: string; scopes: readonly AgentScope[] }> = new Map([
  [AGENT_REQUEST, { clientName: 'Claude', redirectHost: 'claude.ai', scopes: AGENT_SCOPES }],
  [CODE_AGENT_REQUEST, { clientName: 'Claude Code', redirectHost: '127.0.0.1:53682', scopes: ['notes:read', 'notes:write', 'meetings:read'] }]
]);
export const agentRequest = (id: string) => REQUESTS.get(id);

/** What an agent did, as the server seals it: the tool, what it touched and how many it found. Titles aren't kept. */
interface Did { id: string; connectionId: string; at: string; tool: AgentTool; noteId?: string | undefined; meetingId?: string | undefined; count?: number | undefined }
interface Held { connections: AgentConnection[]; did: Did[]; answered: Set<string> }

const byWorld = new WeakMap<World, Map<string, Held>>();
function heldFor(w: World): Held {
  const ownerId = w.session?.ownerId;
  if (!ownerId) throw new AlcoveApiError('unauthenticated', 'Sign in to Alcove first.');
  let owners = byWorld.get(w);
  if (!owners) { owners = new Map(); byWorld.set(w, owners); }
  const held = owners.get(ownerId) ?? { connections: [], did: [], answered: new Set<string>() };
  held.connections = held.connections.filter((c) => Date.parse(c.expiresAt) > Date.now());
  owners.set(ownerId, held);
  return held;
}

export function agentsFor(w: World): { connections: AgentConnection[]; save(connections: AgentConnection[]): void } {
  const held = heldFor(w);
  return {
    connections: held.connections,
    save: (next) => {
      held.connections = next.map((c) => AgentConnectionSchema.parse(c));
      /* Disconnecting deletes what it did. */
      held.did = held.did.filter((d) => held.connections.some((c) => c.id === d.connectionId));
    }
  };
}
export const forgetAgents = (w: World): void => { byWorld.delete(w); };

/** Whether a request has been answered, and so has ended. */
export const answered = (w: World, requestId: string): boolean => heldFor(w).answered.has(requestId);
/** A request's answer: once it's given, the request has ended. */
export function answer(w: World, requestId: string): boolean {
  const held = heldFor(w);
  if (held.answered.has(requestId)) return false;
  held.answered.add(requestId);
  return true;
}

/** What they did, newest first, a page at a time; titles from the notes and calls Art can still open. */
export function activityOf(w: World, query: unknown): { items: AgentActivity[]; next: string | null } {
  const { before, limit } = AgentActivityQuerySchema.parse(query ?? {});
  const all = heldFor(w).did.toSorted((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const from = before ? all.findIndex((d) => d.id === before) + 1 : 0;
  const page = all.slice(from, from + limit);
  const items = page.map((d) => {
    const note = d.noteId ? w.notes.find((n) => n.id === d.noteId) : undefined;
    const meeting = d.meetingId ? w.meetings.find((m) => m.id === d.meetingId) : undefined;
    return AgentActivitySchema.parse({
      id: d.id, connectionId: d.connectionId, at: d.at, tool: d.tool, noteId: d.noteId ?? null, noteTitle: note?.title ?? null,
      meetingId: d.meetingId ?? null, meetingTitle: meeting?.title ?? null, meetingStartsAt: meeting?.startsAt ?? null, count: d.count ?? null
    });
  });
  const last = page.at(-1);
  return { items, next: last && from + limit < all.length ? last.id : null };
}

const CLAUDE = 'storybook-claude'.padEnd(22, '_');
const CURSOR = 'storybook-cursor'.padEnd(22, '_');
const DIGEST = 'storybook-digest'.padEnd(22, '_');
const GIVEN: AgentScope[] = ['notes:read', 'notes:write', 'meetings:read', 'meetings:write', 'calendar:read'];

/** The onboarding review Claude booked four minutes ago: Tuesday at 11:00 with Priya and Kofi, notes on. */
const ONBOARDING = call({ id: 'm-onboarding', title: 'Onboarding review', startsAt: iso(6, 11, 0), minutes: 45, code: 'onb-revw-art', guests: [PRIYA, KOFI] });

let made = 0;
/** One thing an agent did, `days` after the demo day at `h:m`. */
const did = (connectionId: string, days: number, h: number, m: number, tool: AgentTool, about: { noteId?: string; meetingId?: string; count?: number } = {}, s = 0): Did =>
  ({ id: `storybook-did-${++made}`.padEnd(22, '_'), connectionId, at: iso(days, h, m, s), tool, ...about });

/**
 * Claude (signed in, used 4 minutes ago, five permissions), Cursor (signed in, reading only) and the Weekly digest (a
 * personal token), with three weeks of what they did. `ending` is when Cursor's access ends, if it isn't a month away.
 */
export function withAgentConnections(w: World, cursorEnds = iso(28, 9, 40)): void {
  w.meetings = [...w.meetings.filter((m) => m.id !== ONBOARDING.id), ONBOARDING];
  const held = heldFor(w);
  held.connections = [
    { id: CLAUDE, name: 'Claude', kind: 'oauth', scopes: GIVEN, createdAt: iso(-14, 15, 20), expiresAt: iso(16, 15, 20), lastUsedAt: iso(0, 16, 8) },
    { id: CURSOR, name: 'Cursor', kind: 'oauth', scopes: ['notes:read', 'meetings:read'], createdAt: iso(-2, 9, 40), expiresAt: cursorEnds, lastUsedAt: iso(-1, 17, 30) },
    { id: DIGEST, name: 'Weekly digest', kind: 'token', scopes: ['notes:read'], createdAt: iso(-9, 8, 55), expiresAt: iso(21, 8, 55), lastUsedAt: iso(-2, 9, 0) }
  ].map((c) => AgentConnectionSchema.parse(c));
  made = 0;
  held.did = [
    did(CLAUDE, 0, 16, 8, 'schedule_call', { meetingId: ONBOARDING.id }),
    did(CLAUDE, 0, 16, 7, 'get_availability', {}, 40),
    did(CLAUDE, 0, 16, 7, 'get_note', { noteId: 'n7' }, 10),
    did(CLAUDE, 0, 16, 6, 'list_notes', { count: 3 }),
    did(CLAUDE, 0, 11, 40, 'propose_action', { noteId: 'n1' }),
    did(CLAUDE, 0, 10, 2, 'propose_decision', { noteId: 'n2' }),
    did(CURSOR, -1, 17, 30, 'get_note', { noteId: 'n4' }),
    did(CURSOR, -1, 15, 20, 'list_meetings', { count: 5 }),
    did(CURSOR, -2, 11, 20, 'get_note', { noteId: 'n6' }),
    did(DIGEST, -2, 9, 0, 'list_notes', { count: 6 }),
    did(CLAUDE, -5, 10, 42, 'schedule_call', { meetingId: 'm-proposal' }),
    did(CLAUDE, -5, 10, 40, 'find_people', { count: 2 }),
    did(CLAUDE, -5, 10, 30, 'get_note', { noteId: 'n-old-retro' }),
    did(CLAUDE, -6, 9, 7, 'update_action', { noteId: 'n7' }),
    did(CLAUDE, -6, 9, 5, 'get_inbox', { count: 4 }),
    did(CLAUDE, -8, 16, 50, 'ask_note', { noteId: 'n7' }),
    did(DIGEST, -9, 9, 1, 'get_note', { noteId: 'n8' }),
    did(DIGEST, -9, 9, 0, 'list_notes', { count: 5 }),
    did(CLAUDE, -14, 15, 31, 'list_meetings', { count: 6 }),
    did(CLAUDE, -14, 15, 30, 'get_calendar', { count: 8 })
  ];
}

/** The same, with Cursor's access ending tomorrow afternoon. */
export const withAgentEnding = (w: World): void => withAgentConnections(w, iso(1, 9, 40));

/** Claude alone, allowed a few minutes ago with everything but sharing and deleting, and not used yet: it's done nothing. */
export function withClaudeJustConnected(w: World): void {
  const held = heldFor(w);
  held.connections = [
    AgentConnectionSchema.parse({ id: CLAUDE, name: 'Claude', kind: 'oauth', scopes: GIVEN, createdAt: iso(0, 16, 4), expiresAt: iso(30, 16, 4), lastUsedAt: null })
  ];
  held.did = [];
}

/** A new connection, as allowing an agent makes one: signed in now, for 30 days, not used yet. */
export function connectionAllowed(name: string, scopes: readonly AgentScope[]): AgentConnection {
  const now = Date.now();
  return AgentConnectionSchema.parse({ id: `storybook-new-${now % 1_000_000}`.padEnd(22, '_'), name, kind: 'oauth', scopes, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 86_400_000).toISOString(), lastUsedAt: null });
}
