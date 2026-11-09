import { AgentWriteResultSchema, type AgentScope, type AlcoveApi } from '@alcove/api';
import { request as httpRequest } from 'node:http';
import { z } from 'zod';
import { id128 } from '../../crypto';
import { speechWav } from '../../testing/fake-near';
import { type Browser } from '../../testing/harness';
import { Client, SdkHttpError, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

describe('remote agent MCP', () => {
  it('requires an agent credential at the real SDK connection boundary', async () => {
    const client = new Client({ name: 'alcove-flow', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`)));
      expect.fail('An anonymous client connected.');
    } catch (error) {
      expect(error).toBeInstanceOf(SdkHttpError);
      if (error instanceof SdkHttpError) expect(error.status).toBe(401);
    } finally { await client.close(); }
  });
});

let accountSequence = 0;
async function account(): Promise<Browser> {
  const browser = h.browser();
  await browser.api.auth.signIn('sso', { email: `mcp.${Date.now()}.${++accountSequence}@tests.example` });
  return browser;
}
async function connect(browser: Browser, scopes: AgentScope[], modern = false, endpoint = `${h.baseUrl}/mcp`) {
  const issued = await browser.api.agents.createToken({ name: 'Flow client', scopes, expiresInDays: 1 });
  const responseTypes: string[] = [];
  const client = new Client({ name: 'alcove-flow', version: '1.0.0' }, { versionNegotiation: { mode: modern ? 'auto' : 'legacy' } });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { authProvider: { token: async () => issued.token }, fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 200 && (init?.method ?? 'GET') === 'POST') responseTypes.push(response.headers.get('content-type') ?? '');
    return response;
  } }));
  return { client, responseTypes, ...issued };
}
const Schedule = z.object({ meetingId: z.string(), url: z.url() });
const NotePage = z.object({ items: z.array(z.object({ id: z.string() })), nextOffset: z.number().nullable() });
async function recorded(api: AlcoveApi, title: string): Promise<string> {
  const recording = await api.recordings.start({ title });
  await recording.transcribe({ data: new Blob([speechWav('We agreed to finish the report. // The report is ready next Tuesday. // Who will review the report?')], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 });
  const { pendingNoteId } = await recording.stop();
  for await (const progress of api.notes.progress(pendingNoteId)) if (progress.ready) break;
  return pendingNoteId;
}

describe('scoped SDK flows', () => {
  it('discovers only granted tools in legacy and modern protocols, rejects cookies and untrusted Origins', async () => {
    const browser = await account();
    for (const modern of [false, true]) {
      const agent = await connect(browser, ['notes:read', 'meetings:read'], modern);
      try {
        const catalog = await agent.client.listTools();
        expect(catalog.tools.map(tool => tool.name).sort()).toEqual(['ask_note', 'ask_notes', 'find_people', 'get_inbox', 'get_meeting', 'get_note', 'get_personal_notes', 'list_meetings', 'list_notes']);
        expect(catalog.tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
        const result = await agent.client.callTool({ name: 'list_notes', arguments: {} });
        expect(NotePage.parse(result.structuredContent)).toEqual({ items: [], nextOffset: null });
        expect((await agent.client.callTool({ name: 'list_meetings', arguments: { limit: 1 } })).isError).not.toBe(true);
        expect((await agent.client.callTool({ name: 'find_people', arguments: { query: 'someone@tests.example', limit: 1 } })).isError).not.toBe(true);
        expect((await agent.client.callTool({ name: 'list_notes', arguments: { limit: 101 } })).isError).toBe(true);
        expect(agent.responseTypes.every(type => type.includes('application/json'))).toBe(true);
        await expect(agent.client.callTool({ name: 'schedule_call', arguments: {} })).rejects.toThrow('not found');
        const forbidden = await fetch(`${h.baseUrl}/mcp`, { method: 'POST', headers: { origin: 'https://untrusted.example', authorization: `Bearer ${agent.token}` }, body: '{}' });
        expect(forbidden.status).toBe(403);
        const wrongHost = await new Promise<number>((resolve, reject) => {
          const request = httpRequest(new URL(`${h.baseUrl}/mcp`), { method: 'POST', headers: { host: 'untrusted.example', authorization: `Bearer ${agent.token}` } }, response => { response.resume(); resolve(response.statusCode ?? 0); });
          request.on('error', reject); request.end('{}');
        });
        expect(wrongHost).toBe(403);
        const oversized = await fetch(`${h.baseUrl}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${agent.token}` }, body: 'x'.repeat(65 * 1024) });
        expect(oversized.status).toBe(413);
      } finally { await agent.client.close(); }
    }
    const cookieOnly = await browser.fetch(`${h.baseUrl}/mcp`, { method: 'POST', body: '{}' });
    expect(cookieOnly.status).toBe(401);
    expect(cookieOnly.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
    expect((await fetch(`${h.baseUrl}/mcp`)).status).toBe(405);
  });

  it('schedules, reads, updates, answers and cancels calls with bounded write results and durable retry protection across instances', async () => {
    const browser = await account();
    const guest = await account();
    const guestSession = await guest.api.auth.getSession();
    if (!guestSession) throw new Error('The guest did not sign in.');
    const agent = await connect(browser, ['meetings:write']);
    const input = { title: 'MCP scheduling canary', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [guestSession.user.email], notes: 'on' };
    const operationId = id128();
    try {
      const invalidOperation = id128();
      const tooLong = await agent.client.callTool({ name: 'schedule_call', arguments: { operationId: invalidOperation, input: { ...input, durationMinutes: 660 } } });
      expect(tooLong.isError).toBe(true);
      const invalidReceipts = await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM agent_operations WHERE grant_id=$1 AND operation_id=$2', [agent.connection.id, invalidOperation]);
      expect(invalidReceipts.rows[0]?.n).toBe(0);
      const first = await agent.client.callTool({ name: 'schedule_call', arguments: { operationId, input } });
      expect(first.isError).not.toBe(true);
      const made = Schedule.parse(first.structuredContent);
      expect(AgentWriteResultSchema.parse(first.structuredContent)).toMatchObject({ ok: true, meetingId: made.meetingId });
      expect(JSON.stringify(first)).not.toContain(input.title);
      expect((await browser.api.meetings.get(made.meetingId)).title).toBe(input.title);
      const second = await h.secondServer();
      const replay = new Client({ name: 'retry-client', version: '1.0.0' });
      try {
        await replay.connect(new StreamableHTTPClientTransport(new URL(`${second.baseUrl}/mcp`), { authProvider: { token: async () => agent.token } }));
        expect(Schedule.parse((await replay.callTool({ name: 'schedule_call', arguments: { operationId, input } })).structuredContent)).toEqual(made);
        const mismatched = await replay.callTool({ name: 'schedule_call', arguments: { operationId, input: { ...input, title: 'Different arguments' } } });
        expect(mismatched.isError).toBe(true);
        expect(JSON.stringify(mismatched)).toContain('conflict');
      } finally { await replay.close(); await second.close(); }
      const concurrentId = id128();
      const concurrent = await Promise.all([1, 2].map(() => agent.client.callTool({ name: 'schedule_call', arguments: { operationId: concurrentId, input: { ...input, title: 'Concurrent canary' } } })));
      const successes = concurrent.filter(result => !result.isError).map(result => Schedule.parse(result.structuredContent));
      expect(successes.length).toBeGreaterThanOrEqual(1);
      expect(new Set(successes.map(result => result.meetingId)).size).toBe(1);
      expect((await browser.api.meetings.upcoming()).filter(meeting => meeting.title === 'Concurrent canary')).toHaveLength(1);
      // Simulate a process that reserved the operation and died before acknowledging its outcome.
      await h.pool.query("UPDATE agent_operations SET state='pending', result_sealed=NULL WHERE grant_id=$1 AND operation_id=$2", [agent.connection.id, concurrentId]);
      const uncertain = await agent.client.callTool({ name: 'schedule_call', arguments: { operationId: concurrentId, input: { ...input, title: 'Concurrent canary' } } });
      expect(uncertain.isError).toBe(true);
      expect(JSON.stringify(uncertain)).toContain('uncertain');
      expect((await browser.api.meetings.upcoming()).filter(meeting => meeting.title === 'Concurrent canary')).toHaveLength(1);
      const changed = await agent.client.callTool({ name: 'update_call', arguments: { meetingId: made.meetingId, patch: { title: 'Updated title canary' } } });
      expect(changed.structuredContent).toEqual({ ok: true, meetingId: made.meetingId });
      const guestAgent = await connect(guest, ['meetings:read', 'meetings:write']);
      try {
        expect((await guestAgent.client.callTool({ name: 'get_meeting', arguments: { meetingId: made.meetingId } })).isError).not.toBe(true);
        expect((await guestAgent.client.callTool({ name: 'answer_call', arguments: { meetingId: made.meetingId, answer: 'yes' } })).structuredContent).toEqual({ ok: true, meetingId: made.meetingId });
        expect((await guestAgent.client.callTool({ name: 'update_call', arguments: { meetingId: made.meetingId, patch: { title: 'Forbidden' } } })).isError).toBe(true);
      } finally { await guestAgent.client.close(); }
      const outsider = await connect(await account(), ['meetings:read', 'meetings:write']);
      try {
        expect((await outsider.client.callTool({ name: 'get_meeting', arguments: { meetingId: made.meetingId } })).isError).toBe(true);
        expect((await outsider.client.callTool({ name: 'cancel_call', arguments: { meetingId: made.meetingId } })).isError).toBe(true);
      } finally { await outsider.client.close(); }
      expect((await agent.client.callTool({ name: 'schedule_next_call', arguments: { meetingId: made.meetingId, operationId: id128(), startsAt: new Date(Date.now() + 172_800_000).toISOString() } })).isError).not.toBe(true);
      expect((await agent.client.callTool({ name: 'start_call', arguments: { operationId: id128(), input: {} } })).isError).not.toBe(true);
      expect((await agent.client.callTool({ name: 'cancel_call', arguments: { meetingId: made.meetingId } })).structuredContent).toEqual({ ok: true, meetingId: made.meetingId });
      await browser.api.agents.revoke(agent.connection.id);
      await expect(agent.client.callTool({ name: 'start_call', arguments: { operationId: id128(), input: {} } })).rejects.toBeDefined();
    } finally { await agent.client.close(); }
  });

  it('reads and changes authorized notes, keeps personal data private, and stops access after sharing is removed', async () => {
    const browser = await account();
    const other = await account();
    const session = await other.api.auth.getSession();
    if (!session) throw new Error('The recipient did not sign in.');
    const noteId = await recorded(browser.api, 'MCP private note canary');
    const otherNoteId = await recorded(other.api, 'MCP foreign note canary');
    const agent = await connect(browser, ['notes:read', 'notes:write', 'notes:share', 'notes:delete']);
    const writeOnly = await connect(browser, ['notes:write']);
    const recipient = await connect(other, ['notes:read', 'notes:write']);
    try {
      expect((await agent.client.callTool({ name: 'get_note', arguments: { noteId: otherNoteId } })).isError).toBe(true);
      expect((await agent.client.callTool({ name: 'delete_note', arguments: { noteId: otherNoteId } })).isError).toBe(true);
      const listed = NotePage.parse((await agent.client.callTool({ name: 'list_notes', arguments: { limit: 1 } })).structuredContent);
      expect(listed.items.map(note => note.id)).toContain(noteId);
      const proposed = await agent.client.callTool({ name: 'propose_decision', arguments: { noteId, proposal: { text: 'Agent decision canary' } } });
      expect(proposed.structuredContent).toEqual({ ok: true, noteId });
      expect(JSON.stringify(proposed)).not.toContain('Agent decision canary');
      const onlyWrite = await writeOnly.client.callTool({ name: 'propose_action', arguments: { noteId, proposal: { text: 'Writer-only follow-up' } } });
      expect(onlyWrite.structuredContent).toEqual({ ok: true, noteId });
      expect(JSON.stringify(onlyWrite)).not.toContain('MCP private note canary');
      await expect(writeOnly.client.callTool({ name: 'get_note', arguments: { noteId } })).rejects.toThrow('not found');
      const note = await browser.api.notes.get(noteId);
      const question = note.questions[0];
      if (!question) throw new Error('The transcript did not produce a question.');
      expect((await agent.client.callTool({ name: 'update_question', arguments: { noteId, questionId: question.id, patch: { state: 'answered' } } })).isError).not.toBe(true);
      const line = note.transcript?.[0];
      if (!line) throw new Error('The transcript was not retained.');
      expect((await agent.client.callTool({ name: 'correct_transcript', arguments: { noteId, lineId: line.id, patch: { text: 'We agreed to finish the report carefully.' } } })).structuredContent).toEqual({ ok: true, noteId });
      expect((await agent.client.callTool({ name: 'get_inbox', arguments: { limit: 1 } })).isError).not.toBe(true);
      const decision = note.decisions.find(item => item.text === 'Agent decision canary');
      if (!decision) throw new Error('The decision was not proposed.');
      expect((await agent.client.callTool({ name: 'update_decision', arguments: { noteId, decisionId: decision.id, patch: { state: 'confirmed', seen: { text: decision.text } } } })).isError).not.toBe(true);
      expect((await agent.client.callTool({ name: 'propose_action', arguments: { noteId, proposal: { text: 'Agent follow-up canary' } } })).isError).not.toBe(true);
      const awaitingReview = await browser.api.notes.get(noteId);
      expect(awaitingReview.actions.some(item => item.text === 'Agent follow-up canary')).toBe(false);
      const proposal = awaitingReview.suggestions.find(item => item.text === 'Agent follow-up canary');
      if (!proposal) throw new Error('The follow-up was not proposed for human review.');
      expect((await agent.client.callTool({ name: 'update_action', arguments: { noteId, actionId: proposal.id, patch: { done: true } } })).isError).toBe(true);
      const accepted = await browser.api.notes.reviewAction(noteId, { id: proposal.id, revision: proposal.revision, decision: 'accept' });
      const action = accepted.actions.find(item => item.id === proposal.id);
      if (!action) throw new Error('Human review did not promote the follow-up.');
      expect(action.takenOn).toBe(false);
      expect((await agent.client.callTool({ name: 'update_action', arguments: { noteId, actionId: action.id, patch: { done: true } } })).isError).not.toBe(true);
      const repeatable = { name: 'propose_action', arguments: { noteId, proposal: { text: 'Dismissed agent suggestion canary' } } };
      for (let attempt = 0; attempt < 2; attempt++) expect((await agent.client.callTool(repeatable)).isError).not.toBe(true);
      const repeated = (await browser.api.notes.get(noteId)).suggestions.filter(item => item.text === repeatable.arguments.proposal.text);
      expect(repeated).toHaveLength(1);
      const dismissible = repeated[0];
      if (!dismissible) throw new Error('The agent suggestion is not reviewable.');
      await browser.api.notes.reviewAction(noteId, { id: dismissible.id, revision: dismissible.revision, decision: 'dismiss' });
      expect((await agent.client.callTool(repeatable)).isError).not.toBe(true);
      const afterDismissal = await browser.api.notes.get(noteId);
      expect([...afterDismissal.actions, ...afterDismissal.suggestions].some(item => item.text === repeatable.arguments.proposal.text)).toBe(false);
      expect((await agent.client.callTool({ name: 'ask_note', arguments: { noteId, question: 'When is the report ready?' } })).isError).not.toBe(true);
      expect((await agent.client.callTool({ name: 'ask_notes', arguments: { question: 'When is the report ready?' } })).isError).not.toBe(true);
      const personalArgs = { noteId, operationId: id128(), input: { kind: 'note', text: 'MCP personal secrecy canary' } };
      const personal = AgentWriteResultSchema.parse((await agent.client.callTool({ name: 'add_personal_note', arguments: personalArgs })).structuredContent);
      expect(personal.entryId).toBeDefined();
      expect((await agent.client.callTool({ name: 'add_personal_note', arguments: personalArgs })).structuredContent).toEqual(personal);
      expect((await browser.api.notes.personal(noteId).get()).entries).toHaveLength(1);
      const different = await Promise.all(['First simultaneous entry', 'Second simultaneous entry'].map(text => agent.client.callTool({ name: 'add_personal_note', arguments: { noteId, operationId: id128(), input: { kind: 'note', text } } })));
      const distinctIds = different.map(result => AgentWriteResultSchema.parse(result.structuredContent).entryId);
      expect(new Set(distinctIds).size).toBe(2);
      const currentEntries = (await browser.api.notes.personal(noteId).get()).entries;
      for (const [index, result] of different.entries()) {
        const entryId = AgentWriteResultSchema.parse(result.structuredContent).entryId;
        expect(currentEntries.find(entry => entry.id === entryId)).toMatchObject({ text: index === 0 ? 'First simultaneous entry' : 'Second simultaneous entry' });
      }
      expect((await agent.client.callTool({ name: 'edit_personal_note', arguments: { noteId, entryId: personal.entryId, text: 'MCP edited secrecy canary' } })).isError).not.toBe(true);
      expect((await agent.client.callTool({ name: 'share_note', arguments: { noteId, share: { emails: [session.user.email] } } })).structuredContent).toEqual({ ok: true, noteId });
      expect(JSON.stringify(await recipient.client.callTool({ name: 'get_note', arguments: { noteId } }))).toContain('MCP private note canary');
      expect(JSON.stringify(await recipient.client.callTool({ name: 'get_personal_notes', arguments: { noteId } }))).not.toContain('MCP edited secrecy canary');
      await other.api.notes.delete(noteId);
      expect((await recipient.client.callTool({ name: 'get_note', arguments: { noteId } })).isError).toBe(true);
      expect((await recipient.client.callTool({ name: 'add_personal_note', arguments: { ...personalArgs, operationId: id128() } })).isError).toBe(true);
      expect((await agent.client.callTool({ name: 'remove_personal_note', arguments: { noteId, entryId: personal.entryId } })).isError).not.toBe(true);
      expect((await agent.client.callTool({ name: 'add_personal_note', arguments: personalArgs })).isError).toBe(true);
      expect((await browser.api.notes.personal(noteId).get()).entries.some(entry => entry.id === personal.entryId)).toBe(false);
      for (const table of ['agent_operations', 'agent_grants', 'agent_tokens']) {
        const raw = await h.pool.query(`SELECT row_to_json(t)::text AS value FROM ${table} t`);
        expect(JSON.stringify(raw.rows)).not.toMatch(/MCP personal secrecy canary|MCP edited secrecy canary|MCP scheduling canary/);
      }
      expect(h.logs.join('')).not.toMatch(/MCP personal secrecy canary|MCP edited secrecy canary|MCP private note canary|MCP scheduling canary/);
      expect((await agent.client.callTool({ name: 'rewrite_note', arguments: { noteId } })).structuredContent).toEqual({ ok: true, noteId });
      for await (const progress of browser.api.notes.progress(noteId)) if (progress.ready) break;
      expect((await agent.client.callTool({ name: 'delete_note', arguments: { noteId } })).isError).not.toBe(true);
      expect((await agent.client.callTool({ name: 'get_note', arguments: { noteId } })).isError).toBe(true);
    } finally { await agent.client.close(); await recipient.client.close(); await writeOnly.client.close(); }
  });

  it('reads paginated calendar events and availability without granting meeting access', async () => {
    const browser = await account();
    const agent = await connect(browser, ['calendar:read'], true);
    try {
      expect((await agent.client.listTools()).tools.map(tool => tool.name)).toEqual(['get_calendar', 'get_availability']);
      const result = await agent.client.callTool({ name: 'get_calendar', arguments: { limit: 1 } });
      expect(result.isError).not.toBe(true);
      expect(z.object({ source: z.enum(['none', 'sample', 'google']), items: z.array(z.unknown()).max(1), nextOffset: z.number().nullable() }).parse(result.structuredContent)).toBeDefined();
      const busy = await agent.client.callTool({ name: 'get_availability', arguments: { emails: [], from: new Date().toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() } });
      expect(busy.isError).not.toBe(true);
      await expect(agent.client.callTool({ name: 'get_meeting', arguments: { meetingId: id128() } })).rejects.toThrow('not found');
    } finally { await agent.client.close(); }
  });

});
