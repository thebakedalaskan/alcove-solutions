import {
  AgentActionPatchSchema, AgentActionProposalSchema, AgentAnswerCallSchema, AgentAskNoteSchema, AgentAskNotesSchema,
  AgentAvailabilitySchema, AgentCancelCallSchema, AgentDecisionPatchSchema, AgentDecisionProposalSchema,
  AgentListMeetingsSchema, AgentListNotesSchema, AgentMeetingIdSchema, AgentNextCallSchema, AgentNoteIdSchema,
  AgentPageSchema, AgentPeopleSchema, AgentPersonalAddSchema, AgentPersonalEditSchema, AgentPersonalEntrySchema,
  AgentQuestionPatchSchema, AgentScheduleSchema, AgentShareNoteSchema, AgentStartCallSchema, AgentTranscriptPatchSchema,
  AgentUpdateCallSchema, type AgentScope, type Meeting
} from '@alcove/api';
import { McpServer, type ToolAnnotations, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Deps } from '../../../context';
import { toJson } from '../../../crypto';
import { AppError, InternalError, UnavailableError } from '../../../errors';
import { log } from '../../../log';
import { requireScope, type AgentPrincipal } from '../service';
import * as calendar from '../../meetings/calendar';
import * as meetings from '../../meetings/service';
import * as notes from '../../notes/service';
import * as people from '../../account/people';
import * as personal from '../../notes/personal';
import * as writer from '../../notes/writer';
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
const link = (d: Deps, code: string) => `${d.cfg.WEB_ORIGIN}/join/${code}`;
const callResult = (d: Deps, meeting: Meeting) => ({ ok: true, meetingId: meeting.id, url: link(d, meeting.code) });

/** Every registered callback owns the exception boundary: the SDK must never receive an unsafe error message. */
export function buildServer(d: Deps, principal: AgentPrincipal, pending: Set<Promise<unknown>>): McpServer {
  const server = new McpServer({ name: 'alcove', version: '1.0.0' }, { maxToolInputElements: 4000, capabilities: { tools: { listChanged: false } } });
  const o = principal.owner;
  function register<S extends z.ZodObject & StandardSchemaWithJSON>(name: string, scope: AgentScope, description: string, inputSchema: S,
    annotations: ToolAnnotations, run: (input: z.output<S>) => Promise<unknown>, inference = false) {
    if (!principal.connection.scopes.includes(scope)) return;
    server.registerTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(name, { description, inputSchema, annotations }, async (input) => {
      const started = performance.now();
      try {
        requireScope(principal, scope);
        limit(d, o.ownerId, inference ? 'inference' : annotations.readOnlyHint ? 'read' : 'write');
        const task = run(inputSchema.parse(input));
        pending.add(task);
        let value: unknown;
        try { value = await task; } finally { pending.delete(task); }
        const output = toJson(value);
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
  register('list_notes', 'notes:read', 'Find your notes and notes shared with you, newest first. Search text stays in the request body.', AgentListNotesSchema, READ,
    async q => page(await notes.list(o, { kind: q.kind, text: q.text }), q));
  register('get_note', 'notes:read', 'Read one note with the transcript and shared sections you may currently access.', AgentNoteIdSchema, READ, q => notes.get(o, q.noteId));
  register('ask_note', 'notes:read', 'Ask a question about one note using Alcove private inference; returns cited answer parts.', AgentAskNoteSchema, READ, async q => ({ parts: await notes.ask(o, q.noteId, q.question) }), true);
  register('ask_notes', 'notes:read', 'Ask across notes you may currently read using Alcove private inference.', AgentAskNotesSchema, READ, async q => ({ parts: await notes.askAll(o, q.question) }), true);
  register('get_inbox', 'notes:read', 'List your unfinished follow-ups and decisions waiting for your answer.', AgentPageSchema, READ, async q => {
    const inbox = await notes.inbox(o);
    return page([...inbox.followUps.map(item => ({ kind: 'follow_up', ...item })), ...inbox.decisions.map(item => ({ kind: 'decision', ...item }))], q);
  });
  register('get_personal_notes', 'notes:read', 'Read only your own private entries on a note you may currently access.', AgentNoteIdSchema.extend(AgentPageSchema.shape), READ, async q => {
    const personalNotes = await personal.read(await personal.ofNote(o, q.noteId));
    return { noteId: q.noteId, ...page(personalNotes.entries, q) };
  });
  register('propose_decision', 'notes:write', 'Propose a decision in your own words. Repeating the same proposal adds nothing. Returns only an acknowledgment.', AgentDecisionProposalSchema, WRITE,
    async q => { await notes.proposeDecision(o, q.noteId, q.proposal); return { ok: true, noteId: q.noteId }; });
  register('update_decision', 'notes:write', 'Confirm, reject, reopen, reword or dispute a decision within your current permissions. Returns only an acknowledgment.', AgentDecisionPatchSchema, WRITE,
    async q => { await notes.updateDecision(o, q.noteId, q.decisionId, q.patch); return { ok: true, noteId: q.noteId }; });
  register('propose_action', 'notes:write', 'Propose a follow-up. Repeating the same proposal adds nothing. Returns only an acknowledgment.', AgentActionProposalSchema, WRITE,
    async q => { await notes.proposeAction(o, q.noteId, q.proposal); return { ok: true, noteId: q.noteId }; });
  register('update_action', 'notes:write', 'Take on, assign, date, reword or tick a follow-up within your current permissions. Returns only an acknowledgment.', AgentActionPatchSchema, WRITE,
    async q => { await notes.updateAction(o, q.noteId, q.actionId, q.patch); return { ok: true, noteId: q.noteId }; });
  register('update_question', 'notes:write', 'Mark a question answered, reopen it or reword it. Returns only an acknowledgment.', AgentQuestionPatchSchema, WRITE,
    async q => { await notes.updateQuestion(o, q.noteId, q.questionId, q.patch); return { ok: true, noteId: q.noteId }; });
  register('correct_transcript', 'notes:write', 'Correct or confirm a retained transcript line within your current permissions. Returns only an acknowledgment.', AgentTranscriptPatchSchema, WRITE,
    async q => { await notes.correctLine(o, q.noteId, q.lineId, q.patch); return { ok: true, noteId: q.noteId }; });
  register('rewrite_note', 'notes:write', 'Queue the notes to be written again from their retained transcript; organizer only. Returns only an acknowledgment.', AgentNoteIdSchema, CREATE,
    async q => { await notes.rewrite(o, q.noteId); writer.kick(d, o.ownerId); return { ok: true, noteId: q.noteId }; }, true);
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
    async q => { await notes.share(o, q.noteId, q.share); return { ok: true, noteId: q.noteId }; });
  register('delete_note', 'notes:delete', 'Permanently delete your note, or remove a shared note from your own library. Returns only an acknowledgment.', AgentNoteIdSchema, DELETE,
    async q => { await notes.remove(o, q.noteId); return { ok: true, noteId: q.noteId }; });
  register('list_meetings', 'meetings:read', 'List upcoming calls or your past calls with usable Alcove join links.', AgentListMeetingsSchema, READ,
    async q => page((await (q.view === 'past' ? meetings.past(o) : meetings.upcoming(o))).map(meeting => ({ ...meeting, url: link(d, meeting.code) })), q));
  register('get_meeting', 'meetings:read', 'Read a call you organize or are currently invited to, including its Alcove join link.', AgentMeetingIdSchema, READ,
    async q => { const meeting = await meetings.get(o, q.meetingId); return { ...meeting, url: link(d, meeting.code) }; });
  register('find_people', 'meetings:read', 'Find people from your existing Alcove contacts and calendar for an invitation.', AgentPeopleSchema, READ, async q => page(await people.search(o, q.query), q));
  register('schedule_call', 'meetings:write', 'Schedule an Alcove call. May send real Google Calendar invitations when connected. Use operationId for retries. Returns only IDs and the join link.', AgentScheduleSchema, { ...CREATE, openWorldHint: true }, async q =>
    created(principal, 'schedule_call', q.operationId, q, async () => (await meetings.create(o, q.input)).id, async id => callResult(d, await meetings.get(o, id))));
  register('update_call', 'meetings:write', 'Update a call you organize. May update real Google Calendar invitations when connected. Returns only an acknowledgment.', AgentUpdateCallSchema, CALENDAR_WRITE,
    async q => { await meetings.update(o, q.meetingId, q.patch, q.scope); return { ok: true, meetingId: q.meetingId }; });
  register('cancel_call', 'meetings:write', 'Cancel your call and its Google Calendar invitation when connected. Returns only an acknowledgment.', AgentCancelCallSchema, { ...DELETE, openWorldHint: true },
    async q => { await meetings.cancel(o, q.meetingId, q.scope); return { ok: true, meetingId: q.meetingId }; });
  register('answer_call', 'meetings:write', 'Set your answer to an Alcove call invitation to yes, maybe or no. Returns only an acknowledgment.', AgentAnswerCallSchema, WRITE,
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
    return { source: view.source, needsAccess: view.needsAccess, ...page(view.events, q) };
  });
  register('get_availability', 'calendar:read', 'Find busy intervals for you and the named people from the calendars you can currently read.', AgentAvailabilitySchema, { ...READ, openWorldHint: true },
    q => calendar.busy(o, q, () => meetings.all(o)));
  return server;
}
