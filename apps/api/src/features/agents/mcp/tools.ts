import {
  AgentAskNoteSchema, AgentAskNotesSchema, AgentAvailabilitySchema, AgentCancelCallSchema, AgentDecisionPatchSchema, AgentDecisionProposalSchema,
  AgentFollowUpAddSchema, AgentFollowUpPatchSchema, AgentInviteResponseSchema, AgentListMeetingsSchema, AgentListNotesSchema, AgentMeetingIdSchema,
  AgentNextCallSchema, AgentNoteIdSchema, AgentPageSchema, AgentPeopleSchema, AgentPersonalAddSchema, AgentPersonalEditSchema, AgentPersonalEntrySchema,
  AgentQuestionAddSchema, AgentQuestionPatchSchema, AgentResourceIdSchema, AgentScheduleSchema, AgentShareNoteSchema, AgentStartCallSchema,
  AgentTranscriptPatchSchema, AgentUpdateCallSchema, type AgentPastCall, type AgentScope, type AgentTool, type Meeting, type Note, type NoteFound
} from '@alcove/api';
import { McpServer, type ToolAnnotations, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Deps, Owner } from '../../../platform/context';
import { toJson, type Json } from '../../../keys/crypto';
import { AppError, InternalError, UnavailableError } from '../../../platform/errors';
import { log } from '../../../platform/log';
import * as activity from '../activity';
import { requireScope, type AgentPrincipal } from '../service';
import * as calendar from '../../meetings/calendar';
import * as meetings from '../../meetings/service';
import * as notes from '../../notes/service';
import * as noteEntries from '../../notes/entries';
import * as noteCorrections from '../../notes/corrections';
import * as noteSharing from '../../notes/sharing';
import * as people from '../../meetings/people';
import * as personal from '../../notes/personal/personal';
import * as writer from '../../notes/writing/writer';
import { workspaceCalls } from '../../calls/workspace/seats';
import { created } from './operations';

const mlog = log.child({ component: 'agent-tools' });
const limits = new WeakMap<Deps, Map<string, { hits: number; until: number }>>();
const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const CREATE: ToolAnnotations = { ...WRITE, idempotentHint: false };
const DELETE: ToolAnnotations = { ...WRITE, destructiveHint: true };
const CALENDAR_WRITE: ToolAnnotations = { ...WRITE, openWorldHint: true };

/** Matches the app's bounded per-account allowances; no credential or content enters the limiter. */
function limit(d: Deps, ownerId: string, kind: 'write' | 'inference' | 'read'): void {
  const map = limits.get(d) ?? new Map<string, { hits: number; until: number }>();
  limits.set(d, map);
  const now = Date.now();
  const key = `${ownerId}:${kind}`;
  let row = map.get(key);
  if (!row || row.until <= now) { row = { hits: 0, until: now + 60_000 }; map.set(key, row); }
  const max = kind === 'inference' ? 20 : kind === 'write' ? 120 : 300;
  if (++row.hits > max) throw new UnavailableError('Too many agent requests. Wait a minute and try again.');
  if (map.size > 50_000) for (const [id, value] of map) if (value.until <= now) map.delete(id);
}
function page<T>(items: T[], input: { limit: number; offset: number }) {
  return { items: items.slice(input.offset, input.offset + input.limit), nextOffset: items.length > input.offset + input.limit ? input.offset + input.limit : null };
}
/** What a tool hands the agent, and how many it found in all: the number its owner's activity keeps, not the page's. */
class Counted {
  constructor(readonly output: unknown, readonly count: number) {}
}
const About = z.object({ noteId: AgentResourceIdSchema.optional(), meetingId: AgentResourceIdSchema.optional() });
/** These make a call: the one they're about is the call made, not the one `schedule_next_call` follows. */
const BOOKS: ReadonlySet<AgentTool> = new Set(['schedule_call', 'schedule_next_call', 'start_call']);
/** The note and call a completed tool call was about, by ID, from what it was asked or the call it made. */
function about(tool: AgentTool, input: unknown, output: Json): Pick<activity.Did, 'noteId' | 'meetingId'> {
  const asked = About.safeParse(input);
  const ids = asked.success ? asked.data : {};
  if (!BOOKS.has(tool)) return ids;
  const made = About.safeParse(output);
  return { ...ids, meetingId: made.success ? made.data.meetingId : undefined };
}
const link = (d: Deps, code: string) => `${d.cfg.WEB_ORIGIN}/join/${code}`;
const callResult = (d: Deps, meeting: Meeting) => ({ ok: true, meetingId: meeting.id, url: link(d, meeting.code) });

/**
 * A note as get_note hands it over, its entries named as Alcove shows them: Decided (`decisions`), Follow-ups (`followUps`,
 * with `suggestedFollowUps`, the ones the notes suggest for review) and Still open (`questions`), the call's and each
 * breakout room's. The API calls follow-ups actions, a word that never reaches an agent.
 */
function noteForAgents(n: Note) {
  const { actions, suggestions, openActions, totalActions, rooms, ...rest } = n;
  return {
    ...rest, openFollowUps: openActions, totalFollowUps: totalActions, followUps: actions, suggestedFollowUps: suggestions,
    rooms: rooms.map(({ actions: followUps, suggestions: suggestedFollowUps, ...room }) => ({ ...room, followUps, suggestedFollowUps }))
  };
}
/** A note as list_notes finds it, its follow-ups counted under that name. */
function foundForAgents(n: NoteFound) {
  const { openActions, totalActions, ...rest } = n;
  return { ...rest, openFollowUps: openActions, totalFollowUps: totalActions };
}
/**
 * What adding to a note hands back, from what the write did: whether it added anything (the same words again add nothing),
 * and the entry's ID only when the person asking proposed it, to change it with the update tools. A connection that can't
 * read the note gets no handle on what someone else, or the notes, wrote. Never the words.
 */
const addedTo = (noteId: string, made: noteEntries.Added, key: 'decisionId' | 'followUpId' | 'questionId') =>
  ({ ok: true, noteId, added: made.added, ...(made.theirs ? { [key]: made.id } : {}) });

/** How long a call ran, in minutes as Alcove shows it (at least one), from its seconds: null when that isn't known. */
const minutesFrom = (seconds: number | undefined): number | null => (seconds !== undefined && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null);
/**
 * The calls this account was in, newest first: its own that ended, and the ones it was invited to that kept notes, which
 * it knows by their notes alone (`notes.invitedCalls`), since an invitation goes once its call is over. A note shared with
 * it afterwards, or its team's, isn't a call it was in.
 */
async function pastCalls(o: Owner): Promise<AgentPastCall[]> {
  const [own, invited] = await Promise.all([meetings.past(o), notes.invitedCalls(o)]);
  return [
    ...own.map((m): AgentPastCall => ({
      meetingId: m.id, noteId: m.noteId ?? null, title: m.title, startsAt: m.startsAt, minutes: minutesFrom(m.duration), organizer: m.organizer, role: 'organizer', guests: m.guests
    })),
    ...invited.map((n): AgentPastCall => ({
      meetingId: null, noteId: n.noteId, title: n.title, startsAt: n.startedAt, minutes: minutesFrom(n.duration), organizer: n.organizer, role: 'invited', guests: n.guests
    }))
  ].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}

/**
 * What the server tells an agent once it connects: only what no one tool's description says. Which tools there are, and
 * what each does, the descriptions of the tools this connection has say.
 */
function instructionsFor(scopes: readonly AgentScope[]): string {
  return [
    'Use the IDs the tools return, never made-up ones.',
    ...(scopes.some((s) => s.startsWith('notes:')) ? [
      'A note keeps three lists, named as Alcove shows them: Decided (decisions: what the call settled), Follow-ups (followUps: things someone will do) and Still open (questions: what the call asked and didn’t settle).',
      'A decision stays proposed until it’s confirmed, by the organizer or by someone invited to the call who didn’t write its words.'
    ] : [])
  ].join(' ');
}

/** Every registered callback owns the exception boundary: the SDK must never receive an unsafe error message. */
export function buildServer(d: Deps, principal: AgentPrincipal, pending: Set<Promise<unknown>>): McpServer {
  const server = new McpServer({ name: 'alcove', version: '1.0.0' }, {
    maxToolInputElements: 4000, capabilities: { tools: { listChanged: false } }, instructions: instructionsFor(principal.connection.scopes)
  });
  const o = principal.owner;
  function register<S extends z.ZodObject & StandardSchemaWithJSON>(name: AgentTool, scope: AgentScope, description: string, inputSchema: S,
    annotations: ToolAnnotations, run: (input: z.output<S>) => Promise<unknown>, inference = false) {
    if (!principal.connection.scopes.includes(scope)) return;
    server.registerTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(name, { description, inputSchema, annotations }, async (input) => {
      const started = performance.now();
      try {
        requireScope(principal, scope);
        limit(d, o.ownerId, inference ? 'inference' : annotations.readOnlyHint ? 'read' : 'write');
        const asked = inputSchema.parse(input);
        const task = run(asked);
        pending.add(task);
        let value: unknown;
        try { value = await task; } finally { pending.delete(task); }
        const found = value instanceof Counted ? value : undefined;
        const output = toJson(found ? found.output : value);
        // Kept once it's done, tracked like the tool's own work so the owner's keys outlive it. Not keeping it fails nothing.
        const kept = activity.record(principal, { tool: name, ...about(name, asked, output), count: found?.count })
          .catch((e: unknown) => { mlog.warn('agent activity not recorded', { tool: name, grantId: principal.connection.id, err: e }); });
        pending.add(kept);
        try { await kept; } finally { pending.delete(kept); }
        mlog.info('agent tool completed', { tool: name, grantId: principal.connection.id, ms: Math.round(performance.now() - started) });
        return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
      } catch (error) {
        const code = error instanceof AppError ? error.code : error instanceof z.ZodError ? 'invalid' : 'unknown';
        // Error messages and causes may contain provider responses or decrypted data. Log only the stable code here.
        mlog.at(code === 'unknown' ? 'error' : 'info', 'agent tool refused', { tool: name, grantId: principal.connection.id, code, ms: Math.round(performance.now() - started) });
        const message = error instanceof AppError && error.code !== 'unknown' && error.code !== 'network' ? error.message
          : code === 'invalid' ? 'The tool arguments are invalid.' : 'Alcove could not complete this operation. Check the resource before retrying a write.';
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code, message }) }] };
      }
    });
  }
  register('list_notes', 'notes:read', 'Find the notes you have, newest first: from your own calls and recordings, from calls you were invited to, and ones shared with you. openFollowUps and totalFollowUps count each note’s Follow-ups. Search text stays in the request body.', AgentListNotesSchema, READ,
    async q => { const found = (await notes.list(o, { kind: q.kind, text: q.text })).map(foundForAgents); return new Counted(page(found, q), found.length); });
  register('get_note', 'notes:read', 'Read one note: its summary; Decided (decisions); Follow-ups (followUps, with suggestedFollowUps, the ones the notes suggested that wait for someone to add or dismiss them in Alcove); Still open (questions); the same for each breakout room (rooms); and the transcript and shared sections you may currently access.', AgentNoteIdSchema, READ,
    async q => noteForAgents(await notes.get(o, q.noteId)));
  register('ask_note', 'notes:read', 'Ask a question about one note using Alcove private inference; returns cited answer parts.', AgentAskNoteSchema, READ, async q => ({ parts: await notes.ask(o, q.noteId, q.question) }), true);
  register('ask_notes', 'notes:read', 'Ask across notes you may currently read using Alcove private inference.', AgentAskNotesSchema, READ, async q => ({ parts: await notes.askAll(o, q.question) }), true);
  register('get_inbox', 'notes:read', 'List your unfinished follow-ups and decisions waiting for your answer.', AgentPageSchema, READ, async q => {
    const inbox = await notes.inbox(o);
    const waiting = [...inbox.followUps.map(item => ({ kind: 'follow_up', ...item })), ...inbox.decisions.map(item => ({ kind: 'decision', ...item }))];
    return new Counted(page(waiting, q), waiting.length);
  });
  register('get_personal_notes', 'notes:read', 'Read only your own private entries on a note you may currently access.', AgentNoteIdSchema.extend(AgentPageSchema.shape), READ, async q => {
    const personalNotes = await personal.read(await personal.ofNote(o, q.noteId));
    return { noteId: q.noteId, ...page(personalNotes.entries, q) };
  });
  register('propose_decision', 'notes:write', 'Propose a decision for a note’s Decided: something the call settled, in your own words. It starts proposed. The same words again in that part add nothing (added: false). Returns added and, for a decision you proposed, its decisionId, to change it with update_decision. Nothing else.', AgentDecisionProposalSchema, WRITE,
    async q => addedTo(q.noteId, await noteEntries.proposeDecision(o, q.noteId, q.proposal), 'decisionId'));
  register('update_decision', 'notes:write', 'Change one of a note’s decisions (Decided): confirm it, say it wasn’t decided, reopen it, say it no longer holds, reword it or dispute it, within your current permissions. Confirming needs seen: its words as you read them. Returns only an acknowledgment.', AgentDecisionPatchSchema, WRITE,
    async q => { await noteEntries.updateDecision(o, q.noteId, q.decisionId, q.patch); return { ok: true, noteId: q.noteId }; });
  register('add_follow_up', 'notes:write', 'Add a follow-up to a note’s Follow-ups: something someone will do. It’s on the checklist at once, as when you add one in Alcove. Who it’s for (owner, by email) must have the notes, and takes it on themselves; until then who and when are only suggestions. The same words again in that part add nothing (added: false). Returns added and, for a follow-up you proposed, its followUpId, to change it with update_follow_up. Nothing else.', AgentFollowUpAddSchema, WRITE,
    async q => addedTo(q.noteId, await noteEntries.proposeAction(o, q.noteId, q.followUp), 'followUpId'));
  register('update_follow_up', 'notes:write', 'Change one of a note’s follow-ups (Follow-ups): tick it done, reword it, date it, give it to someone who has the notes or to nobody, or take it on when it’s yours, within your current permissions. Taking it on, or giving it to yourself, needs seen: its words and due date as you read them. Returns only an acknowledgment.', AgentFollowUpPatchSchema, WRITE,
    async q => { await noteEntries.updateAction(o, q.noteId, q.followUpId, q.patch); return { ok: true, noteId: q.noteId }; });
  register('add_question', 'notes:write', 'Add an open question to a note’s Still open: something the call asked and didn’t settle. Anyone with the notes can say it was answered, with update_question. The same words again in that part add nothing (added: false). Returns added and, for a question you proposed, its questionId, to change it with update_question. Nothing else.', AgentQuestionAddSchema, WRITE,
    async q => addedTo(q.noteId, await noteEntries.addQuestion(o, q.noteId, q.question), 'questionId'));
  register('update_question', 'notes:write', 'Change one of a note’s open questions (Still open): say it was answered, open it again, or reword it. Returns only an acknowledgment.', AgentQuestionPatchSchema, WRITE,
    async q => { await noteEntries.updateQuestion(o, q.noteId, q.questionId, q.patch); return { ok: true, noteId: q.noteId }; });
  register('correct_transcript', 'notes:write', 'Correct or confirm a retained transcript line within your current permissions. Returns only an acknowledgment.', AgentTranscriptPatchSchema, WRITE,
    async q => { await noteCorrections.correctLine(o, q.noteId, q.lineId, q.patch); return { ok: true, noteId: q.noteId }; });
  register('rewrite_note', 'notes:write', 'Queue the notes to be written again from their retained transcript; organizer only. Returns only an acknowledgment.', AgentNoteIdSchema, CREATE,
    async q => { await noteCorrections.rewrite(o, q.noteId); writer.kick(d, o.ownerId); return { ok: true, noteId: q.noteId }; }, true);
  register('add_personal_note', 'notes:write', 'Keep a private entry on a note. Use operationId to safely retry the same entry. Returns only IDs.', AgentPersonalAddSchema, CREATE, async q => {
    return created(principal, 'add_personal_note', q.operationId, q, async () => {
      return (await personal.addEntry(await personal.ofNote(o, q.noteId), q.input)).entryId;
    }, async id => {
      const current = await personal.read(await personal.ofNote(o, q.noteId));
      if (!current.entries.some(entry => entry.id === id)) throw new InternalError('The entry no longer exists.');
      return { ok: true, noteId: q.noteId, entryId: id };
    });
  });
  register('edit_personal_note', 'notes:write', 'Edit your own private text entry or bookmark label. Returns only IDs.', AgentPersonalEditSchema, WRITE,
    async q => { await personal.edit(await personal.ofNote(o, q.noteId), q.entryId, q.text); return { ok: true, noteId: q.noteId, entryId: q.entryId }; });
  register('remove_personal_note', 'notes:write', 'Permanently remove one of your private entries. Returns only IDs.', AgentPersonalEntrySchema, DELETE,
    async q => { await personal.remove(await personal.ofNote(o, q.noteId), q.entryId); return { ok: true, noteId: q.noteId, entryId: q.entryId }; });
  register('share_note', 'notes:share', 'Give the named people access to this note, within your current sharing rights. Returns only an acknowledgment.', AgentShareNoteSchema, WRITE,
    async q => { await noteSharing.share(o, q.noteId, q.share); return { ok: true, noteId: q.noteId }; });
  register('delete_note', 'notes:delete', 'Permanently delete your note, or remove a shared note from your own library. Returns only an acknowledgment.', AgentNoteIdSchema, DELETE,
    async q => { await notes.remove(o, q.noteId); return { ok: true, noteId: q.noteId }; });
  register('list_meetings', 'meetings:read', 'List calls, in the view asked for. upcoming: each call as get_meeting reads it, with its Alcove join link (url). past: each as meetingId (your own call’s; null for someone else’s, which get_meeting can’t read once it’s over), noteId (null when it kept no notes), title, startsAt, minutes (how long it ran), organizer, role (organizer or invited) and guests (everyone invited besides the organizer).', AgentListMeetingsSchema, READ,
    async q => {
      if (q.view === 'past') { const calls = await pastCalls(o); return new Counted(page(calls, q), calls.length); }
      const calls = (await meetings.upcoming(o)).map(meeting => ({ ...meeting, url: link(d, meeting.code) }));
      return new Counted(page(calls, q), calls.length);
    });
  register('get_meeting', 'meetings:read', 'Read a call you organize, or one you are invited to that hasn’t ended, including its Alcove join link. Once someone else’s call is over, read its note instead (get_note).', AgentMeetingIdSchema, READ,
    async q => { const meeting = await meetings.get(o, q.meetingId); return { ...meeting, url: link(d, meeting.code) }; });
  register('find_people', 'meetings:read', 'Find people from your existing Alcove contacts and calendar for an invitation.', AgentPeopleSchema, READ, async q => { const found = await people.search(o, q.query); return new Counted(page(found, q), found.length); });
  register('schedule_call', 'meetings:write', 'Schedule an Alcove call. May send real Google Calendar invitations when connected. Use operationId for retries. Returns only IDs and the join link.', AgentScheduleSchema, { ...CREATE, openWorldHint: true }, async q =>
    created(principal, 'schedule_call', q.operationId, q, async () => (await meetings.create(o, q.input)).id, async id => callResult(d, await meetings.get(o, id))));
  register('update_call', 'meetings:write', 'Update a call you organize. May update real Google Calendar invitations when connected. Returns only an acknowledgment.', AgentUpdateCallSchema, CALENDAR_WRITE,
    async q => { await meetings.update(o, q.meetingId, q.patch, q.scope, workspaceCalls); return { ok: true, meetingId: q.meetingId }; });
  register('cancel_call', 'meetings:write', 'Cancel your call and its Google Calendar invitation when connected. Returns only an acknowledgment.', AgentCancelCallSchema, { ...DELETE, openWorldHint: true },
    async q => { await meetings.cancel(o, q.meetingId, q.scope); return { ok: true, meetingId: q.meetingId }; });
  register('respond_to_invite', 'meetings:write', 'Say whether you’re coming to a call someone else organized and invited you to: yes, maybe or no. It doesn’t join a call or answer one that’s ringing. Returns only an acknowledgment.', AgentInviteResponseSchema, WRITE,
    async q => { await meetings.answer(o, q.meetingId, q.answer); return { ok: true, meetingId: q.meetingId }; });
  register('schedule_next_call', 'meetings:write', 'Schedule the next call with the same people and settings. May send real Google Calendar invitations. Use operationId for retries. Returns only IDs and the join link.', AgentNextCallSchema, { ...CREATE, openWorldHint: true }, async q =>
    created(principal, 'schedule_next_call', q.operationId, q, async () => (await meetings.scheduleNext(o, q.meetingId, q.startsAt)).id, async id => callResult(d, await meetings.get(o, id))));
  register('start_call', 'meetings:write', 'Create an instant Alcove call link without joining or starting recording. Use operationId for retries. Returns only IDs and the join link.', AgentStartCallSchema, CREATE, async q =>
    created(principal, 'start_call', q.operationId, q, async () => {
      const made = await meetings.startNow(o, q.input);
      const meeting = await meetings.byCode(o, made.code);
      if (!meeting) throw new InternalError('The created call could not be found.');
      return meeting.id;
    }, async id => callResult(d, await meetings.get(o, id))));
  register('get_calendar', 'calendar:read', 'Read your connected calendar events; does not connect or change Google access.', AgentPageSchema, { ...READ, openWorldHint: true }, async q => {
    const view = await calendar.view(o, () => meetings.recurringSeries(o));
    return new Counted({ source: view.source, needsAccess: view.needsAccess, ...page(view.events, q) }, view.events.length);
  });
  register('get_availability', 'calendar:read', 'Find busy intervals for you and the named people from the calendars you can currently read.', AgentAvailabilitySchema, { ...READ, openWorldHint: true },
    q => calendar.busy(o, q, () => meetings.all(o)));
  return server;
}
