/*
 * What agents did, for their owner alone (docs: Agents and MCP › What your agents did). Each completed tool call keeps the
 * tool, the note or call it was about and how many it found, sealed under the owner's own keys: never a title, a name or
 * anything said. A title is read when the list is, from what the owner can open then, so it's null once that's gone.
 */
import { AgentActivityIdSchema, AgentActivityPageSchema, AgentToolSchema, type AgentActivity, type AgentActivityPage, type AgentTool } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, fromUtf8, id128, openJson, sealJson, stateKey, toJson, unb64u, utf8 } from '../../crypto';
import { bigintText, bytea, exec, rows, timestamp } from '../../db';
import { ValidationError, toAppError } from '../../errors';
import { log } from '../../log';
import * as meetings from '../meetings/service';
import * as notes from '../notes/service';
import type { AgentPrincipal } from './service';

const alog = log.child({ component: 'agent-activity' });
/** How long what agents did is kept, and how much of it each connection keeps at most. */
const KEPT_DAYS = 30;
const KEPT_ROWS = 1000;
/** Other people's notes and calls on a page are named this many at a time: each opens its owner's keys and reads their vault. */
const LOOKUPS_AT_ONCE = 4;

/** What one tool call did: the tool, the note and call it was about, and how many it found. IDs and a number only. */
export interface Did { tool: AgentTool; noteId?: string | undefined; meetingId?: string | undefined; count?: number | undefined }
/** As it's sealed. A tool a later release stops offering still opens; it just isn't listed. */
const Body = z.object({ tool: z.string(), noteId: z.string().max(64).optional(), meetingId: z.string().max(64).optional(), count: z.number().int().min(0).optional() });
const Row = z.object({ id: z.string(), grant_id: z.string(), created_at: timestamp, at_us: bigintText, body_ciphertext: bytea });
/** Where a page ended: the last row's time, to the microsecond Postgres keeps, and its ID. */
const Cursor = z.object({ t: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), id: AgentActivityIdSchema });

const header = (ownerId: string, activityId: string) => ({ v: 1 as const, kind: 'agent-activity', ownerId, activityId });
/** The owner's activity key, for one use, wiped after it. */
function withKey<T>(o: Owner, use: (key: Uint8Array) => T): T {
  const key = stateKey(o.root, o.ownerId, 'agent-activity');
  try { return use(key); } finally { key.fill(0); }
}

/** Keeps one completed tool call. It's sealed before anything waits, so keys wiped while the row is on its way can't stop it. */
export async function record(principal: AgentPrincipal, did: Did): Promise<void> {
  const { owner: o, connection } = principal;
  const id = id128();
  const body = withKey(o, (key) => sealJson(key, header(o.ownerId, id), toJson(did)));
  await exec(o.pool, 'INSERT INTO agent_activity (owner_id, grant_id, id, body_ciphertext) VALUES ($1,$2,$3,$4)', [o.ownerId, connection.id, id, body]);
}

const cursorOf = (row: { at_us: number; id: string }): string => b64u(utf8(JSON.stringify({ t: row.at_us, id: row.id })));
function cursorFrom(value: string): z.infer<typeof Cursor> {
  try { return Cursor.parse(JSON.parse(fromUtf8(unb64u(value)))); }
  catch { throw new ValidationError('That page of activity isn’t one Alcove gave out. Start again from the newest.'); }
}

/** Runs `work` for each of these, at most `width` at a time. */
async function inTurns<T>(items: T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
  const waiting = [...items];
  const worker = async () => { for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) await work(next); };
  await Promise.all(Array.from({ length: Math.min(width, waiting.length) }, worker));
}
/** Says why a note or call on a page has no title. Gone, or not the owner's any more, is ordinary; anything else is said at its own level. */
function untitled(e: unknown, about: { noteId: string } | { meetingId: string }): void {
  const app = toAppError(e);
  alog.at(app.code === 'not-found' ? 'debug' : app.level, 'agent activity left untitled', { ...about, code: app.code });
}
/**
 * The titles of a page's notes and calls as the owner can read them now: their own read together, then each of other
 * people's by the check reading it takes, a few at a time. Only manifests, never Google, and nothing of it is kept.
 */
async function noteTitles(o: Owner, ids: string[]): Promise<Map<string, string>> {
  const titles = await notes.ownNoteTitles(o, ids);
  await inTurns(ids.filter((id) => !titles.has(id)), LOOKUPS_AT_ONCE, async (noteId) => {
    try { titles.set(noteId, await notes.noteTitle(o, noteId)); } catch (e) { untitled(e, { noteId }); }
  });
  return titles;
}
async function callTitles(o: Owner, ids: string[]): Promise<Map<string, meetings.CallTitle>> {
  const titles = await meetings.ownCallTitles(o, ids);
  await inTurns(ids.filter((id) => !titles.has(id)), LOOKUPS_AT_ONCE, async (meetingId) => {
    try { titles.set(meetingId, await meetings.invitedCallTitle(o, meetingId)); } catch (e) { untitled(e, { meetingId }); }
  });
  return titles;
}
const distinct = (ids: (string | undefined)[]): string[] => [...new Set(ids.filter((id): id is string => id !== undefined))];
const iso = (value: string): string | null => { const at = new Date(value); return Number.isNaN(at.getTime()) ? null : at.toISOString(); };

/** A page of what the owner's agents did, newest first. Only what a connection that still works did. */
export async function list(o: Owner, q: { before?: string | undefined; limit: number }): Promise<AgentActivityPage> {
  const from = q.before === undefined ? undefined : cursorFrom(q.before);
  const found = await rows(o.pool, Row, `SELECT a.id, a.grant_id, a.created_at, (extract(epoch FROM a.created_at) * 1000000)::bigint AS at_us, a.body_ciphertext
    FROM agent_activity a JOIN agent_grants g ON g.owner_id = a.owner_id AND g.id = a.grant_id
    WHERE a.owner_id = $1 AND g.expires_at > now()${from ? " AND (a.created_at, a.id) < (timestamptz 'epoch' + $3::bigint * interval '1 microsecond', $4)" : ''}
    ORDER BY a.created_at DESC, a.id DESC LIMIT $2`, from ? [o.ownerId, q.limit + 1, from.t, from.id] : [o.ownerId, q.limit + 1]);
  const page = found.slice(0, q.limit);
  const opened = withKey(o, (key) => page.flatMap((row) => {
    const did = openJson(key, header(o.ownerId, row.id), row.body_ciphertext, Body);
    const tool = AgentToolSchema.safeParse(did.tool);
    if (tool.success) return [{ row, did, tool: tool.data }];
    alog.debug('agent activity of a tool no longer offered', { activityId: row.id });
    return [];
  }));
  const noteNames = await noteTitles(o, distinct(opened.map(({ did }) => did.noteId)));
  const callNames = await callTitles(o, distinct(opened.map(({ did }) => did.meetingId)));
  const items = opened.map(({ row, did, tool }): AgentActivity => {
    const call = did.meetingId === undefined ? undefined : callNames.get(did.meetingId);
    return {
      id: row.id, connectionId: row.grant_id, at: row.created_at.toISOString(), tool,
      noteId: did.noteId ?? null, noteTitle: did.noteId === undefined ? null : noteNames.get(did.noteId) ?? null,
      meetingId: did.meetingId ?? null, meetingTitle: call?.title ?? null, meetingStartsAt: call?.startsAt ? iso(call.startsAt) : null,
      count: did.count ?? null
    };
  });
  const last = page.at(-1);
  return AgentActivityPageSchema.parse({ items, next: found.length > q.limit && last ? cursorOf(last) : null });
}

/**
 * Upkeep: what agents did goes after 30 days, and past each connection's newest 1,000, so one agent can't push out what
 * another did. What a connection did goes with it, so this runs after the grants are swept.
 */
export async function sweep(d: Deps): Promise<number> {
  const old = await exec(d.pool, 'DELETE FROM agent_activity WHERE created_at < now() - make_interval(days => $1)', [KEPT_DAYS]);
  const beyond = await exec(d.pool, `DELETE FROM agent_activity a USING (
      SELECT owner_id, id FROM (
        SELECT owner_id, id, row_number() OVER (PARTITION BY owner_id, grant_id ORDER BY created_at DESC, id DESC) AS n FROM agent_activity
        WHERE (owner_id, grant_id) IN (SELECT owner_id, grant_id FROM agent_activity GROUP BY owner_id, grant_id HAVING count(*) > $1)
      ) ranked WHERE n > $1
    ) extra WHERE a.owner_id = extra.owner_id AND a.id = extra.id`, [KEPT_ROWS]);
  return old + beyond;
}
