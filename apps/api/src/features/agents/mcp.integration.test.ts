import { AgentWriteResultSchema, type AgentScope, type AlcoveApi } from '@alcove/api';
import { request as httpRequest } from 'node:http';
import { z } from 'zod';
import { id128, sealJson, stateKey } from '../../crypto';
import { openOwner } from '../../owners';
import { speechWav } from '../../testing/fake-near';
import { connectGoogleCalendar, ORIGIN, type Browser } from '../../testing/harness';
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
const encodings = (value: string) => [value, Buffer.from(value).toString('hex'), Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')];
const LogLine = z.object({ msg: z.string(), level: z.number() }).passthrough();
const logged = (msg: string) => h.logs.flatMap((line) => { const parsed = LogLine.safeParse(JSON.parse(line)); return parsed.success && parsed.data.msg === msg ? [parsed.data] : []; });
async function ownerOf(browser: Browser): Promise<string> {
  const session = await browser.api.auth.getSession();
  if (!session) throw new Error('Nobody is signed in.');
  return session.ownerId;
}
/** How many rows of what agents did an account has, straight from the table. */
async function activityRows(ownerId: string, grantId?: string): Promise<number> {
  const counted = await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM agent_activity WHERE owner_id = $1 AND ($2::text IS NULL OR grant_id = $2)', [ownerId, grantId ?? null]);
  return counted.rows[0]?.n ?? -1;
}
async function listNotes(agent: { client: Client }, times: number) {
  for (let i = 0; i < times; i++) expect((await agent.client.callTool({ name: 'list_notes', arguments: {} })).isError).not.toBe(true);
}
let googleSequence = 0;
/** A real account, signed in with the stand-in Google, its calendar connected. */
async function googleAccount(name: string) {
  const b = h.browser();
  const n = `${Date.now().toString(36)}${(++googleSequence).toString(36)}`;
  const who = { sub: `google-${n}`, email: `${name.toLowerCase()}.${n}@example.com`, name };
  h.google.next(who);
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('Not signed in with Google.');
  expect(await connectGoogleCalendar(h, b, who)).toBe(`${ORIGIN}/settings?calendar=connected#calendar`);
  return { ...b, session, sub: who.sub };
}
/** Spoils the sealed manifest of an item's current revision, as damaged storage would: it no longer passes its check. */
async function spoil(ownerId: string, itemId: string): Promise<void> {
  const head = (await h.pool.query<{ revision_id: string; manifest_ciphertext: Buffer }>(`SELECT r.revision_id, r.manifest_ciphertext FROM items i
    JOIN revisions r ON r.owner_id = i.owner_id AND r.revision_id = i.current_revision_id WHERE i.owner_id = $1 AND i.item_id = $2`, [ownerId, itemId])).rows[0];
  if (!head) throw new Error('There is no such item to spoil.');
  const sealed = z.object({ ciphertext: z.string() }).passthrough().parse(JSON.parse(head.manifest_ciphertext.toString('utf8')));
  const flipped = `${sealed.ciphertext.startsWith('A') ? 'B' : 'A'}${sealed.ciphertext.slice(1)}`;
  await h.pool.query('UPDATE revisions SET manifest_ciphertext = $3 WHERE owner_id = $1 AND revision_id = $2', [ownerId, head.revision_id, Buffer.from(JSON.stringify({ ...sealed, ciphertext: flipped }))]);
}
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

  it('takes tools out of discovery and refuses them from the next request once a connection is narrowed, and widening brings them back', async () => {
    const browser = await account();
    const agent = await connect(browser, ['notes:read', 'meetings:read'], true);
    try {
      const names = async () => (await agent.client.listTools()).tools.map(tool => tool.name).sort();
      expect(await names()).toContain('list_meetings');
      expect((await agent.client.callTool({ name: 'list_meetings', arguments: { limit: 1 } })).isError).not.toBe(true);
      await browser.api.agents.update(agent.connection.id, { scopes: ['notes:read'] });
      expect(await names()).toEqual(['ask_note', 'ask_notes', 'get_inbox', 'get_note', 'get_personal_notes', 'list_notes']);
      await expect(agent.client.callTool({ name: 'list_meetings', arguments: { limit: 1 } })).rejects.toThrow('not found');
      expect((await agent.client.callTool({ name: 'list_notes', arguments: {} })).isError).not.toBe(true);
      await browser.api.agents.update(agent.connection.id, { scopes: ['notes:read', 'meetings:read', 'meetings:write'] });
      expect(await names()).toEqual(expect.arrayContaining(['list_meetings', 'schedule_call', 'list_notes']));
      expect((await agent.client.callTool({ name: 'list_meetings', arguments: { limit: 1 } })).isError).not.toBe(true);
    } finally { await agent.client.close(); }
  });
});

describe('what agents did', () => {
  it('keeps each completed tool call for its owner alone, by ID, and reads titles only when it’s listed', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const other = await account();
    const first = await recorded(browser.api, 'CANARY-ACTIVITY first note');
    await recorded(browser.api, 'Second activity note');
    const agent = await connect(browser, ['notes:read', 'meetings:read', 'meetings:write']);
    const outsider = await connect(other, ['notes:read']);
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    try {
      expect((await agent.client.callTool({ name: 'get_note', arguments: { noteId: first } })).isError).not.toBe(true);
      expect(NotePage.parse((await agent.client.callTool({ name: 'list_notes', arguments: { limit: 1 } })).structuredContent).items).toHaveLength(1);
      const booking = { title: 'CANARY-ACTIVITY booking', startsAt, durationMinutes: 30, guests: [], notes: 'on' };
      const booked = Schedule.parse((await agent.client.callTool({ name: 'schedule_call', arguments: { operationId: id128(), input: booking } })).structuredContent);
      // A refused call isn't kept.
      expect((await agent.client.callTool({ name: 'get_note', arguments: { noteId: id128() } })).isError).toBe(true);
      await listNotes(outsider, 1);

      const kept = await browser.api.agents.activity();
      const by = { connectionId: agent.connection.id, id: expect.any(String), at: expect.any(String) };
      expect(kept).toEqual({ next: null, items: [
        { ...by, tool: 'schedule_call', noteId: null, noteTitle: null, meetingId: booked.meetingId, meetingTitle: 'CANARY-ACTIVITY booking', meetingStartsAt: startsAt, count: null },
        // The whole list it found, not the page it was given.
        { ...by, tool: 'list_notes', noteId: null, noteTitle: null, meetingId: null, meetingTitle: null, meetingStartsAt: null, count: 2 },
        { ...by, tool: 'get_note', noteId: first, noteTitle: 'CANARY-ACTIVITY first note', meetingId: null, meetingTitle: null, meetingStartsAt: null, count: null }
      ] });
      expect(await other.api.agents.activity()).toEqual({ next: null, items: [expect.objectContaining({ connectionId: outsider.connection.id, tool: 'list_notes', count: 0 })] });

      // A page at a time, newest first.
      const newest = await browser.api.agents.activity({ limit: 2 });
      expect(newest.items).toEqual(kept.items.slice(0, 2));
      if (!newest.next) throw new Error('There was no page after the first.');
      expect(await browser.api.agents.activity({ limit: 2, before: newest.next })).toEqual({ items: kept.items.slice(2), next: null });
      const raw = await browser.fetch(`${h.baseUrl}/v1/agents/activity?limit=1`);
      expect(raw.headers.get('cache-control')).toBe('no-store');
      for (const query of ['before=nonsense', `before=${Buffer.from(JSON.stringify({ t: -1, id: id128() })).toString('base64url')}`, 'limit=0', 'limit=101']) {
        expect((await browser.fetch(`${h.baseUrl}/v1/agents/activity?${query}`)).status).toBe(400);
      }

      // Nothing readable is stored or logged: titles, and even the IDs it was about, are sealed or not kept at all.
      const dump = String((await h.pool.query("SELECT string_agg(row_to_json(x)::text, ' ') AS text FROM agent_activity x")).rows[0]?.text ?? '');
      for (const sealed of ['CANARY-ACTIVITY', 'Second activity note', first, booked.meetingId]) for (const encoded of encodings(sealed)) expect(dump).not.toContain(encoded);
      expect(h.logs.join('')).not.toMatch(/CANARY-ACTIVITY|Second activity note/);

      // A title is read when it's listed, from what the owner can open then.
      await browser.api.notes.delete(first);
      await browser.api.meetings.cancel(booked.meetingId);
      const after = await browser.api.agents.activity();
      expect(after.items.find(item => item.tool === 'get_note')).toMatchObject({ noteId: first, noteTitle: null });
      expect(after.items.find(item => item.tool === 'schedule_call')).toMatchObject({ meetingId: booked.meetingId, meetingTitle: null, meetingStartsAt: null });

      // Disconnecting takes what it did with it, and only that.
      await browser.api.agents.revoke(agent.connection.id);
      expect(await browser.api.agents.activity()).toEqual({ items: [], next: null });
      expect(await activityRows(ownerId)).toBe(0);
      expect((await other.api.agents.activity()).items).toHaveLength(1);
    } finally { await agent.client.close(); await outsider.client.close(); }
  });

  it('answers a tool call even when what it did can’t be kept', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const agent = await connect(browser, ['notes:read']);
    await h.pool.query(`CREATE FUNCTION refuse_activity() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'not now'; END $$ LANGUAGE plpgsql`);
    await h.pool.query(`CREATE TRIGGER refuse_activity BEFORE INSERT ON agent_activity FOR EACH ROW WHEN (NEW.owner_id = '${ownerId}') EXECUTE FUNCTION refuse_activity()`);
    try {
      const result = await agent.client.callTool({ name: 'list_notes', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(NotePage.parse(result.structuredContent)).toEqual({ items: [], nextOffset: null });
    } finally {
      await h.pool.query('DROP TRIGGER refuse_activity ON agent_activity');
      await h.pool.query('DROP FUNCTION refuse_activity');
      await agent.client.close();
    }
    expect(logged('agent activity not recorded')).toContainEqual(expect.objectContaining({ level: 40, tool: 'list_notes', grantId: agent.connection.id }));
    expect(logged('agent tool completed')).toContainEqual(expect.objectContaining({ tool: 'list_notes', grantId: agent.connection.id }));
    expect(await browser.api.agents.activity()).toEqual({ items: [], next: null });
  });

  it('pages through what was done at the same moment once each, newest first', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const agent = await connect(browser, ['notes:read']);
    try { await listNotes(agent, 4); } finally { await agent.client.close(); }
    const [a, b, c, d] = (await browser.api.agents.activity()).items.map(item => item.id);
    if (!a || !b || !c || !d) throw new Error('Four tool calls were not kept.');
    // Two at the very same microsecond, and all four within one millisecond.
    await h.pool.query(`UPDATE agent_activity SET created_at = date_trunc('second', now()) + CASE WHEN id IN ($2, $3) THEN interval '900 microseconds'
      WHEN id = $4 THEN interval '500 microseconds' ELSE interval '100 microseconds' END WHERE owner_id = $1`, [ownerId, a, b, c]);
    const whole = (await browser.api.agents.activity()).items;
    expect(new Set(whole.map(item => item.at)).size).toBe(1);
    expect(new Set(whole.slice(0, 2).map(item => item.id))).toEqual(new Set([a, b]));
    expect(whole.slice(2).map(item => item.id)).toEqual([c, d]);
    const paged: string[] = [];
    let before: string | undefined;
    for (let turn = 0; turn < 6; turn++) {
      const page = await browser.api.agents.activity({ limit: 1, before });
      paged.push(...page.items.map(item => item.id));
      if (!page.next) break;
      before = page.next;
    }
    expect(paged).toEqual(whole.map(item => item.id));
  });

  it('lets upkeep take what agents did after 30 days, and past each connection’s newest 1,000', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const busy = await connect(browser, ['notes:read']);
    const quiet = await connect(browser, ['notes:read']);
    try { await listNotes(busy, 2); await listNotes(quiet, 2); } finally { await busy.client.close(); await quiet.client.close(); }
    const [newer, older] = (await browser.api.agents.activity()).items.filter(item => item.connectionId === busy.connection.id).map(item => item.id);
    if (!newer || !older) throw new Error('Two tool calls were not kept.');
    await h.pool.query("UPDATE agent_activity SET created_at = now() - interval '31 days' WHERE owner_id = $1 AND id = $2", [ownerId, older]);
    const { maintain } = await import('../../maintenance');
    expect((await maintain(h.deps)).agentActivity).toBeGreaterThanOrEqual(1);
    expect((await browser.api.agents.activity()).items.filter(item => item.connectionId === busy.connection.id).map(item => item.id)).toEqual([newer]);
    // A thousand more for one of them, from earlier in the month: upkeep keeps its newest 1,000, and the other's are its own.
    const oldest = 'x'.repeat(18) + '1000';
    await h.pool.query(`INSERT INTO agent_activity (owner_id, grant_id, id, created_at, body_ciphertext)
      SELECT $1, $2, lpad(n::text, 22, 'x'), now() - n * interval '1 minute', $3 FROM generate_series(1, 1000) n`, [ownerId, busy.connection.id, Buffer.from([0])]);
    expect(await activityRows(ownerId, busy.connection.id)).toBe(1001);
    expect((await maintain(h.deps)).agentActivity).toBeGreaterThanOrEqual(1);
    const left = (await h.pool.query<{ id: string }>('SELECT id FROM agent_activity WHERE owner_id = $1 AND grant_id = $2 ORDER BY created_at DESC, id DESC', [ownerId, busy.connection.id])).rows.map(row => row.id);
    expect(left).toHaveLength(1000);
    expect(left[0]).toBe(newer);
    expect(left).not.toContain(oldest);
    expect(await activityRows(ownerId, quiet.connection.id)).toBe(2);
    expect(await activityRows(ownerId)).toBe(1002);
    await browser.api.agents.revoke(busy.connection.id);
    expect(await activityRows(ownerId, busy.connection.id)).toBe(0);
    expect((await browser.api.agents.activity()).items.map(item => item.connectionId)).toEqual([quiet.connection.id, quiet.connection.id]);
  });

  it('reads what agents did within a budget of its own, for each account', async () => {
    const browser = await account();
    const other = await account();
    for (let read = 0; read < 60; read++) expect((await browser.fetch(`${h.baseUrl}/v1/agents/activity?limit=1`)).status).toBe(200);
    const refused = await browser.fetch(`${h.baseUrl}/v1/agents/activity?limit=1`);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: 'unavailable' });
    // Its own budget: making a token still works, and another account still reads.
    expect((await browser.api.agents.createToken({ name: 'After reading', scopes: ['notes:read'], expiresInDays: 1 })).connection.name).toBe('After reading');
    expect(await other.api.agents.activity()).toEqual({ items: [], next: null });
  });

  it('names the call a booking tool made, not the one it followed', async () => {
    const browser = await account();
    const agent = await connect(browser, ['meetings:write']);
    const firstStart = new Date(Date.now() + 86_400_000).toISOString();
    const nextStart = new Date(Date.now() + 8 * 86_400_000).toISOString();
    try {
      const first = Schedule.parse((await agent.client.callTool({ name: 'schedule_call', arguments: { operationId: id128(), input: { title: 'Weekly planning', startsAt: firstStart, durationMinutes: 30, guests: [], notes: 'off' } } })).structuredContent);
      const next = Schedule.parse((await agent.client.callTool({ name: 'schedule_next_call', arguments: { meetingId: first.meetingId, operationId: id128(), startsAt: nextStart } })).structuredContent);
      const instant = Schedule.parse((await agent.client.callTool({ name: 'start_call', arguments: { operationId: id128(), input: { title: 'Quick sync' } } })).structuredContent);
      expect(new Set([first.meetingId, next.meetingId, instant.meetingId]).size).toBe(3);
      expect((await browser.api.agents.activity()).items.map(item => [item.tool, item.meetingId, item.meetingTitle, item.meetingStartsAt])).toEqual([
        ['start_call', instant.meetingId, 'Quick sync', expect.any(String)],
        ['schedule_next_call', next.meetingId, 'Weekly planning', nextStart],
        ['schedule_call', first.meetingId, 'Weekly planning', firstStart]
      ]);
    } finally { await agent.client.close(); }
  });

  it('gives a call still offering times no start', async () => {
    const browser = await account();
    const agent = await connect(browser, ['meetings:write']);
    const times = [2, 3].map(days => new Date(Date.now() + days * 86_400_000).toISOString());
    try {
      const offered = Schedule.parse((await agent.client.callTool({ name: 'schedule_call', arguments: { operationId: id128(), input: { title: 'Pick a time', startsAt: times[0], durationMinutes: 30, guests: [], notes: 'off', offer: times } } })).structuredContent);
      expect((await browser.api.meetings.get(offered.meetingId)).offer?.times).toEqual(times);
      expect((await browser.api.agents.activity()).items).toEqual([expect.objectContaining({ tool: 'schedule_call', meetingId: offered.meetingId, meetingTitle: 'Pick a time', meetingStartsAt: null })]);
    } finally { await agent.client.close(); }
  });

  it('lists nothing a connection that has run out did, and upkeep then deletes it with the connection', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const agent = await connect(browser, ['notes:read']);
    try { await listNotes(agent, 1); } finally { await agent.client.close(); }
    expect((await browser.api.agents.activity()).items).toHaveLength(1);
    await h.pool.query("UPDATE agent_grants SET expires_at = now() - interval '1 second' WHERE owner_id = $1 AND id = $2", [ownerId, agent.connection.id]);
    expect(await browser.api.agents.activity()).toEqual({ items: [], next: null });
    expect(await activityRows(ownerId)).toBe(1);
    const { maintain } = await import('../../maintenance');
    await maintain(h.deps);
    expect(await activityRows(ownerId)).toBe(0);
  });

  it('skips what a tool no longer offered did, and still answers the page', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const agent = await connect(browser, ['notes:read']);
    try { await listNotes(agent, 1); } finally { await agent.client.close(); }
    // Sealed as a release that offered it would have: the same key, header and shape, newer than the rest.
    const retired = id128();
    const owner = await openOwner(h.deps, ownerId, undefined);
    const key = stateKey(owner.root, ownerId, 'agent-activity');
    const body = sealJson(key, { v: 1, kind: 'agent-activity', ownerId, activityId: retired }, { tool: 'retired_tool', noteId: id128(), count: 3 });
    key.fill(0); owner.root.fill(0); owner.wrapKey.fill(0);
    await h.pool.query("INSERT INTO agent_activity (owner_id, grant_id, id, created_at, body_ciphertext) VALUES ($1, $2, $3, now() + interval '1 second', $4)", [ownerId, agent.connection.id, retired, body]);
    expect((await browser.api.agents.activity()).items.map(item => item.tool)).toEqual(['list_notes']);
    expect(logged('agent activity of a tool no longer offered')).toContainEqual(expect.objectContaining({ activityId: retired }));
  });

  it('names what other people gave the owner while they can read it, from manifests alone, asking Google nothing', async () => {
    const org = await googleAccount('Organizer');
    const guest = await googleAccount('Guest');
    const booker = await connect(org, ['meetings:read', 'meetings:write', 'calendar:read']);
    const reader = await connect(guest, ['notes:read', 'meetings:read']);
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    try {
      const booked = Schedule.parse((await booker.client.callTool({ name: 'schedule_call', arguments: { operationId: id128(), input: { title: 'Given call', startsAt, durationMinutes: 30, guests: [guest.session.user.email], notes: 'off' } } })).structuredContent);
      // Two events of the organizer's own beside it, and a page of one: what's counted is all of them.
      const inHours = (n: number) => ({ dateTime: new Date(Date.now() + n * 3_600_000).toISOString() });
      h.google.calendar(org.sub).push(
        { id: `standup-${id128()}`, summary: 'Standup', start: inHours(2), end: inHours(3), organizer: { email: org.session.user.email, self: true } },
        { id: `review-${id128()}`, summary: 'Review', start: inHours(4), end: inHours(5), organizer: { email: org.session.user.email, self: true } }
      );
      const calendar = z.object({ items: z.array(z.unknown()) }).parse((await booker.client.callTool({ name: 'get_calendar', arguments: { limit: 1 } })).structuredContent);
      expect(calendar.items).toHaveLength(1);
      expect((await booker.client.callTool({ name: 'get_availability', arguments: { emails: [], from: new Date().toISOString(), to: startsAt } })).isError).not.toBe(true);
      const noteId = await recorded(org.api, 'Given note');
      await org.api.notes.share(noteId, { emails: [guest.session.user.email] });
      for (const call of [{ name: 'get_meeting', arguments: { meetingId: booked.meetingId } }, { name: 'get_note', arguments: { noteId } }]) {
        expect((await reader.client.callTool(call)).isError).not.toBe(true);
      }

      const reads = h.google.calls.length;
      expect((await org.api.agents.activity()).items.map(item => [item.tool, item.meetingTitle, item.meetingStartsAt, item.count])).toEqual([
        ['get_availability', null, null, null], ['get_calendar', null, null, 2], ['schedule_call', 'Given call', startsAt, null]
      ]);
      expect((await guest.api.agents.activity()).items.map(item => [item.tool, item.noteTitle, item.meetingTitle, item.meetingStartsAt])).toEqual([
        ['get_note', 'Given note', null, null], ['get_meeting', null, 'Given call', startsAt]
      ]);
      expect(h.google.calls.length).toBe(reads);

      // The organizer deletes the note: gone from the guest's list. Their call's record no longer opens: the page still
      // answers, untitled there, and says so at the error's own level.
      await org.api.notes.delete(noteId);
      await spoil(org.session.ownerId, booked.meetingId);
      expect((await guest.api.agents.activity()).items.map(item => [item.tool, item.noteTitle, item.meetingTitle, item.meetingStartsAt])).toEqual([
        ['get_note', null, null, null], ['get_meeting', null, null, null]
      ]);
      expect(logged('agent activity left untitled')).toEqual(expect.arrayContaining([
        expect.objectContaining({ noteId, code: 'not-found', level: 20 }), expect.objectContaining({ meetingId: booked.meetingId, code: 'key-unavailable', level: 50 })
      ]));
    } finally { await booker.client.close(); await reader.client.close(); }
  });
});
