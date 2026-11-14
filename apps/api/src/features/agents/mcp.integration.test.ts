import { AGENT_TOOLS, AgentPastCallSchema, AgentWriteResultSchema, type AgentScope, type AlcoveApi } from '@alcove/api';
import { request as httpRequest } from 'node:http';
import { z } from 'zod';
import { id128, sealJson, stateKey } from '../../keys/crypto';
import { openOwner } from '../../keys/owners';
import { getItem, saveRevision } from '../../keys/vault';
import { speechWav } from '../../testing/fakes/near';
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
async function emailOf(browser: Browser): Promise<string> {
  const session = await browser.api.auth.getSession();
  if (!session) throw new Error('Nobody is signed in.');
  return session.user.email;
}
/** The code a tool call was refused with. */
const Refused = z.object({ isError: z.literal(true), content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]) });
const refusalOf = (result: unknown): string => z.object({ code: z.string() }).parse(JSON.parse(Refused.parse(result).content[0].text)).code;
/** Every key in a value, however deep it is. */
function keysIn(value: unknown): string[] {
  const list = z.array(z.unknown()).safeParse(value);
  if (list.success) return list.data.flatMap(keysIn);
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  return record.success ? Object.entries(record.data).flatMap(([key, inner]) => [key, ...keysIn(inner)]) : [];
}
/**
 * Gives a note a breakout room's section, as a call with rooms leaves one, and says its ID. All it holds to start with is
 * the follow-ups the notes suggested there, a copy of the call's: nothing on its checklist, and no decisions or questions.
 * Stored as the call stores it, so it's read as one.
 */
async function withRoom(ownerId: string, noteId: string): Promise<string> {
  const owner = await openOwner(h.deps, ownerId, undefined);
  try {
    const raw = await getItem(owner, owner.pool, 'note', noteId, z.record(z.string(), z.unknown()), 'That note');
    const suggested = z.array(z.record(z.string(), z.unknown())).parse(raw.manifest['actions']).filter(action => action['review'] === 'suggested').map(action => ({ ...action, id: id128() }));
    const room = { id: id128(), name: 'Design', people: [], from: 0, to: 60, summary: '', decisions: [], questions: [], actions: suggested, chapters: [], gaps: [], transcript: [] };
    await saveRevision(owner, owner.pool, raw.itemId, raw.revisionId, { ...raw.manifest, rooms: [room] });
    return room.id;
  } finally { owner.root.fill(0); owner.wrapKey.fill(0); }
}
/** What adding to a note handed back. */
const addedBy = (result: { structuredContent?: unknown }) => AgentWriteResultSchema.parse(result.structuredContent);
/** Holds a call someone scheduled, with notes on, says something in it, ends it and waits for its notes to be written. */
async function held(org: Browser, title: string, guests: string[]): Promise<{ meetingId: string; startsAt: string; noteId: string }> {
  const meeting = await org.api.meetings.create({ title, startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests, notes: 'on' });
  const call = await org.api.calls.join(meeting.code, { mic: true, cam: false });
  await call.transcribe({ data: new Blob([speechWav('We agreed to ship on Friday.')], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 }, call.ticket.identity);
  const noteId = (await call.leave())?.pendingNoteId;
  if (!noteId) throw new Error('The call kept no notes.');
  for await (const progress of org.api.notes.progress(noteId)) if (progress.ready) break;
  return { meetingId: meeting.id, startsAt: meeting.startsAt, noteId };
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

  it('names a note’s entries and a call’s invitation as Alcove does, in its tools and in what it tells an agent, as far as the connection reaches', async () => {
    const browser = await account();
    for (const modern of [false, true]) {
      const writer = await connect(browser, ['notes:write', 'meetings:write'], modern);
      try {
        const names = (await writer.client.listTools()).tools.map(tool => tool.name);
        expect(names).toEqual(expect.arrayContaining(['propose_decision', 'update_decision', 'add_follow_up', 'update_follow_up', 'add_question', 'update_question', 'respond_to_invite']));
        expect(names.filter(name => /action|answer_call/.test(name))).toEqual([]);
        // Told once it connects only what no one tool says: a note's three lists by the names Alcove shows, with their
        // fields, and who confirms a decision. What each tool does, its own description says.
        const told = writer.client.getInstructions() ?? '';
        for (const said of ['Decided (decisions', 'Follow-ups (followUps', 'Still open (questions', 'confirmed, by the organizer or by someone invited', 'IDs']) expect(told).toContain(said);
        for (const tool of AGENT_TOOLS) expect(told).not.toContain(tool);
        expect(told).not.toContain('action');
      } finally { await writer.client.close(); }
    }
    // The same for any notes permission, and nothing about notes without one.
    const reader = await connect(browser, ['notes:read', 'meetings:read'], true);
    const writerTold = (await connect(browser, ['notes:write'])).client;
    try {
      const told = reader.client.getInstructions() ?? '';
      expect(told).toBe(writerTold.getInstructions());
      for (const tool of AGENT_TOOLS) expect(told).not.toContain(tool);
    } finally { await reader.client.close(); await writerTold.close(); }
    const calendar = await connect(browser, ['calendar:read', 'meetings:write']);
    try {
      const told = calendar.client.getInstructions() ?? '';
      expect(told).toContain('IDs');
      expect(told).not.toMatch(/Decided|Follow-ups|Still open|decision/);
    } finally { await calendar.client.close(); }
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
        expect((await guestAgent.client.callTool({ name: 'respond_to_invite', arguments: { meetingId: made.meetingId, answer: 'yes' } })).structuredContent).toEqual({ ok: true, meetingId: made.meetingId });
        expect((await browser.api.meetings.get(made.meetingId)).answers).toEqual([expect.objectContaining({ email: guestSession.user.email, answer: 'yes' })]);
        // Saying it about your own call isn't answering an invitation.
        expect((await agent.client.callTool({ name: 'respond_to_invite', arguments: { meetingId: made.meetingId, answer: 'no' } })).isError).toBe(true);
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
    const ownEmail = await emailOf(browser);
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
      const proposedId = addedBy(proposed).decisionId;
      expect(proposed.structuredContent).toEqual({ ok: true, noteId, added: true, decisionId: proposedId });
      expect(JSON.stringify(proposed)).not.toContain('Agent decision canary');
      // Writing alone: the answer's ID is how it changes what it added, since it can't read the note to find it.
      const onlyWrite = await writeOnly.client.callTool({ name: 'add_follow_up', arguments: { noteId, followUp: { text: 'Writer-only follow-up' } } });
      const writerFollowUp = addedBy(onlyWrite).followUpId;
      if (!writerFollowUp) throw new Error('Adding a follow-up gave no ID.');
      expect(onlyWrite.structuredContent).toEqual({ ok: true, noteId, added: true, followUpId: writerFollowUp });
      expect(JSON.stringify(onlyWrite)).not.toContain('MCP private note canary');
      await expect(writeOnly.client.callTool({ name: 'get_note', arguments: { noteId } })).rejects.toThrow('not found');
      expect((await writeOnly.client.callTool({ name: 'update_follow_up', arguments: { noteId, followUpId: writerFollowUp, patch: { done: true } } })).structuredContent).toEqual({ ok: true, noteId });
      expect((await browser.api.notes.get(noteId)).actions.find(item => item.id === writerFollowUp)).toMatchObject({ text: 'Writer-only follow-up', done: true });
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
      expect(decision.id).toBe(proposedId);
      expect((await agent.client.callTool({ name: 'update_decision', arguments: { noteId, decisionId: decision.id, patch: { state: 'confirmed', seen: { text: decision.text } } } })).isError).not.toBe(true);
      // A follow-up goes straight onto the checklist, as Add a follow-up in Alcove puts it: not among the suggestions.
      const adding = { name: 'add_follow_up', arguments: { noteId, followUp: { text: 'Agent follow-up canary', due: 'Friday' } } };
      const added = await agent.client.callTool(adding);
      expect(JSON.stringify(added)).not.toContain('Agent follow-up canary');
      const onList = await browser.api.notes.get(noteId);
      expect(onList.suggestions.some(item => item.text === 'Agent follow-up canary')).toBe(false);
      const followUp = onList.actions.find(item => item.text === 'Agent follow-up canary');
      if (!followUp) throw new Error('The follow-up is not on the checklist.');
      expect(added.structuredContent).toEqual({ ok: true, noteId, added: true, followUpId: followUp.id });
      expect(followUp).toMatchObject({ review: 'accepted', takenOn: false, done: false, due: 'Friday', changes: [{ what: 'proposed', by: { email: ownEmail } }] });
      expect((await browser.api.notes.inbox()).followUps).toEqual([]);
      // The same words again add nothing, and say so, with the ID of the one they proposed.
      expect((await agent.client.callTool(adding)).structuredContent).toEqual({ ok: true, noteId, added: false, followUpId: followUp.id });
      expect((await browser.api.notes.get(noteId)).actions.filter(item => item.text === 'Agent follow-up canary')).toHaveLength(1);
      // Changed by its ID, as get_note gives it.
      const change = (patch: Record<string, unknown>) => agent.client.callTool({ name: 'update_follow_up', arguments: { noteId, followUpId: followUp.id, patch } });
      expect((await change({ text: 'Agent follow-up reworded', due: 'Monday' })).structuredContent).toEqual({ ok: true, noteId });
      // Taking it on, here by giving it to yourself, says what was read, and is refused without it or when it's changed since.
      expect(refusalOf(await change({ owner: ownEmail }))).toBe('invalid');
      expect(refusalOf(await change({ owner: ownEmail, seen: { text: 'Agent follow-up canary', due: 'Friday' } }))).toBe('conflict');
      expect((await change({ owner: ownEmail, seen: { text: 'Agent follow-up reworded', due: 'Monday' } })).isError).not.toBe(true);
      expect((await browser.api.notes.inbox()).followUps.map(item => [item.text, item.takenOn])).toEqual([['Agent follow-up reworded', true]]);
      expect((await change({ done: true })).isError).not.toBe(true);
      expect((await browser.api.notes.get(noteId)).actions.find(item => item.id === followUp.id)).toMatchObject({
        text: 'Agent follow-up reworded', due: 'Monday', done: true, takenOn: true, owner: { person: { email: ownEmail } },
        changes: [{ what: 'proposed' }, { what: 'reworded' }, { what: 'due' }, { what: 'took-on' }, { what: 'done' }]
      });
      expect((await browser.api.notes.inbox()).followUps).toEqual([]);
      // Someone without the notes can't be given one, by adding it or changing it.
      const outsider = 'nobody.here@tests.example';
      expect(refusalOf(await agent.client.callTool({ name: 'add_follow_up', arguments: { noteId, followUp: { text: 'For an outsider', owner: outsider } } }))).toBe('invalid');
      expect(refusalOf(await change({ owner: outsider }))).toBe('invalid');
      expect((await browser.api.notes.get(noteId)).actions.some(item => item.text === 'For an outsider')).toBe(false);
      expect(refusalOf(await agent.client.callTool({ name: 'update_follow_up', arguments: { noteId, followUpId: id128(), patch: { done: false } } }))).toBe('not-found');
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

  it('adds an open question to Still open, which anyone with the notes can say was answered, and never repeats its words', async () => {
    const browser = await account();
    const email = await emailOf(browser);
    const noteId = await recorded(browser.api, 'MCP question note');
    // Adding takes only writing: an agent that can't read the note can still add to it.
    const agent = await connect(browser, ['notes:write']);
    const outsider = await connect(await account(), ['notes:write']);
    const asking = { name: 'add_question', arguments: { noteId, question: { text: 'CANARY-QUESTION who signs off on the budget?' } } };
    try {
      const asked = await agent.client.callTool(asking);
      expect(JSON.stringify(asked)).not.toContain('CANARY-QUESTION');
      const open = (await browser.api.notes.get(noteId)).questions.filter(item => item.text === asking.arguments.question.text);
      expect(open).toMatchObject([{ state: 'open', lines: [], changes: [{ what: 'proposed', by: { email, as: 'organizer' } }] }]);
      const questionId = open[0]?.id ?? '';
      expect(asked.structuredContent).toEqual({ ok: true, noteId, added: true, questionId });
      // The same words again add nothing, and say so, with the ID of the one they proposed.
      expect((await agent.client.callTool(asking)).structuredContent).toEqual({ ok: true, noteId, added: false, questionId });
      expect((await browser.api.notes.get(noteId)).questions.filter(item => item.text === asking.arguments.question.text)).toHaveLength(1);
      // Said to be answered, as the notes' own are.
      expect((await agent.client.callTool({ name: 'update_question', arguments: { noteId, questionId, patch: { state: 'answered' } } })).structuredContent).toEqual({ ok: true, noteId });
      expect((await browser.api.notes.get(noteId)).questions.find(item => item.id === questionId)).toMatchObject({ state: 'answered', changes: [{ what: 'proposed' }, { what: 'answered' }] });
      // It rests on lines of the part it goes in, and goes only in a part the note has; nobody without the notes adds one.
      const line = (await browser.api.notes.get(noteId)).transcript?.[0]?.id ?? '';
      const late = addedBy(await agent.client.callTool({ name: 'add_question', arguments: { noteId, question: { text: 'Is the report late?', lines: [line] } } })).questionId;
      expect((await browser.api.notes.get(noteId)).questions.find(item => item.text === 'Is the report late?')).toMatchObject({ id: late, state: 'open', lines: [line], at: expect.any(Number) });
      // Lines from nowhere are refused whether or not the words are there already.
      expect(refusalOf(await agent.client.callTool({ name: 'add_question', arguments: { noteId, question: { text: 'Is the report late?', lines: [id128()] } } }))).toBe('invalid');
      expect(refusalOf(await agent.client.callTool({ name: 'add_question', arguments: { noteId, question: { text: 'From nowhere?', lines: [id128()] } } }))).toBe('invalid');
      expect(refusalOf(await agent.client.callTool({ name: 'add_question', arguments: { noteId, question: { text: 'In no room?', room: id128() } } }))).toBe('not-found');
      expect(refusalOf(await outsider.client.callTool({ name: 'add_question', arguments: { noteId, question: { text: 'Not my call?' } } }))).toBe('not-found');
      const refused = ['From nowhere?', 'In no room?', 'Not my call?'];
      expect((await browser.api.notes.get(noteId)).questions.filter(item => refused.includes(item.text))).toEqual([]);
      expect((await browser.api.agents.activity()).items).toContainEqual(expect.objectContaining({ tool: 'add_question', noteId, noteTitle: 'MCP question note' }));

      // Its words are the note's alone: in no agent table and no log line, where only IDs and counts go.
      for (const table of ['agent_grants', 'agent_tokens', 'agent_operations', 'agent_activity']) {
        const dump = JSON.stringify((await h.pool.query(`SELECT row_to_json(t)::text AS value FROM ${table} t`)).rows);
        for (const encoded of encodings('CANARY-QUESTION')) expect(dump).not.toContain(encoded);
      }
      expect(h.logs.join('')).not.toContain('CANARY-QUESTION');
      expect(logged('question added')).toContainEqual(expect.objectContaining({ noteId, added: true, mine: true }));

      // Written again, the notes keep what someone added as it stands: once, by the same ID, open, still theirs. The
      // notes model is told it's settled.
      const sent = h.near.prompts.length;
      expect((await agent.client.callTool({ name: 'rewrite_note', arguments: { noteId } })).structuredContent).toEqual({ ok: true, noteId });
      for await (const progress of browser.api.notes.progress(noteId)) if (progress.ready) break;
      const again = (await browser.api.notes.get(noteId)).questions;
      expect(again.filter(item => item.text === 'Is the report late?')).toMatchObject([{ id: late, state: 'open', changes: [{ what: 'proposed', by: { email } }] }]);
      expect(again.filter(item => item.text === asking.arguments.question.text)).toMatchObject([{ id: questionId, state: 'answered' }]);
      expect(h.near.prompts.slice(sent).some(prompt => prompt.includes('Question (still open): Is the report late?'))).toBe(true);
      expect(h.logs.join('')).not.toContain('CANARY-QUESTION');
    } finally { await agent.client.close(); await outsider.client.close(); }
  });

  it('names a note’s follow-ups as Alcove does, in every part of the note and in its counts, and never says action', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const noteId = await recorded(browser.api, 'MCP follow-ups note');
    const agent = await connect(browser, ['notes:read', 'notes:write']);
    try {
      const roomId = await withRoom(ownerId, noteId);
      for (const room of [undefined, roomId]) {
        expect((await agent.client.callTool({ name: 'add_follow_up', arguments: { noteId, followUp: { text: 'Send the report', room } } })).isError).not.toBe(true);
      }
      const note = await browser.api.notes.get(noteId);
      const room = note.rooms[0];
      if (!room) throw new Error('The note has no breakout room’s section.');
      expect(room.actions.map(item => item.text)).toEqual(['Send the report']);
      expect(room.suggestions).toHaveLength(note.suggestions.length);

      const read = await agent.client.callTool({ name: 'get_note', arguments: { noteId } });
      const ids = z.array(z.object({ id: z.string() })).transform(items => items.map(item => item.id));
      const FollowUps = z.object({ followUps: ids, suggestedFollowUps: ids });
      const seen = FollowUps.extend({ openFollowUps: z.number(), totalFollowUps: z.number(), rooms: z.array(FollowUps) }).parse(read.structuredContent);
      expect(seen).toEqual({
        followUps: note.actions.map(item => item.id), suggestedFollowUps: note.suggestions.map(item => item.id), openFollowUps: note.openActions, totalFollowUps: note.totalActions,
        rooms: [{ followUps: room.actions.map(item => item.id), suggestedFollowUps: room.suggestions.map(item => item.id) }]
      });
      // Its own and the room's both count.
      expect(seen.totalFollowUps).toBe(note.actions.length + room.actions.length);
      expect(keysIn(read.structuredContent).filter(key => /action/i.test(key))).toEqual([]);

      const listed = await agent.client.callTool({ name: 'list_notes', arguments: {} });
      const items = z.object({ items: z.array(z.object({ id: z.string(), openFollowUps: z.number(), totalFollowUps: z.number() })) }).parse(listed.structuredContent).items;
      expect(items).toEqual([expect.objectContaining({ id: noteId, openFollowUps: note.openActions, totalFollowUps: note.totalActions })]);
      expect(keysIn(listed.structuredContent).filter(key => /action/i.test(key))).toEqual([]);
    } finally { await agent.client.close(); }
  });

  it('changes only the checklist: a follow-up the notes only suggested is refused, and its words go onto the checklist as a follow-up of its own', async () => {
    const browser = await account();
    const noteId = await recorded(browser.api, 'MCP suggestion note');
    const agent = await connect(browser, ['notes:read', 'notes:write']);
    try {
      // "Who will review the report?" is one the notes suggest, waiting for someone to add or dismiss it in Alcove.
      const suggested = (await browser.api.notes.get(noteId)).suggestions[0];
      if (!suggested) throw new Error('The notes suggested no follow-up.');
      const read = z.object({ suggestedFollowUps: z.array(z.object({ id: z.string() })) }).parse((await agent.client.callTool({ name: 'get_note', arguments: { noteId } })).structuredContent);
      expect(read.suggestedFollowUps.map(item => item.id)).toContain(suggested.id);
      // It isn't on the checklist, so no change reaches it, and it's left as it was.
      expect(refusalOf(await agent.client.callTool({ name: 'update_follow_up', arguments: { noteId, followUpId: suggested.id, patch: { done: true } } }))).toBe('not-found');
      expect((await browser.api.notes.get(noteId)).suggestions.find(item => item.id === suggested.id)).toEqual(suggested);
      // Its words added are a follow-up on the checklist, by an ID of its own; the suggestion stays beside it.
      const added = addedBy(await agent.client.callTool({ name: 'add_follow_up', arguments: { noteId, followUp: { text: suggested.text } } }));
      expect(added).toEqual({ ok: true, noteId, added: true, followUpId: expect.any(String) });
      expect(added.followUpId).not.toBe(suggested.id);
      const after = await browser.api.notes.get(noteId);
      expect(after.actions.filter(item => item.text === suggested.text).map(item => item.id)).toEqual([added.followUpId]);
      expect(after.suggestions.find(item => item.id === suggested.id)).toEqual(suggested);
    } finally { await agent.client.close(); }
  });

  it('adds to a breakout room’s part alone, and hands back the room’s entry, not the call’s with the same words', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const noteId = await recorded(browser.api, 'MCP room note');
    const agent = await connect(browser, ['notes:write']);
    /** A decision, a follow-up and an open question with the same words each time, in the call's part or a room's: their IDs. */
    const add = async (room: string | undefined) => [
      addedBy(await agent.client.callTool({ name: 'propose_decision', arguments: { noteId, proposal: { text: 'Ship on Friday', room } } })).decisionId,
      addedBy(await agent.client.callTool({ name: 'add_follow_up', arguments: { noteId, followUp: { text: 'Book the room', room } } })).followUpId,
      addedBy(await agent.client.callTool({ name: 'add_question', arguments: { noteId, question: { text: 'Who pays?', room } } })).questionId
    ];
    try {
      const inCall = await add(undefined);
      const roomId = await withRoom(ownerId, noteId);
      const inRoom = await add(roomId);
      for (const [i, id] of inRoom.entries()) {
        expect(id).toEqual(expect.any(String));
        expect(id).not.toBe(inCall[i]);
      }
      // Again in the room: nothing added, and the room's IDs, not the call's.
      expect(await add(roomId)).toEqual(inRoom);
      const note = await browser.api.notes.get(noteId);
      const room = note.rooms.find(item => item.id === roomId);
      if (!room) throw new Error('The note has no breakout room’s section.');
      const ids = (part: { decisions: { id: string; text: string }[]; actions: { id: string; text: string }[]; questions: { id: string; text: string }[] }) => [
        part.decisions.filter(item => item.text === 'Ship on Friday').map(item => item.id),
        part.actions.filter(item => item.text === 'Book the room').map(item => item.id),
        part.questions.filter(item => item.text === 'Who pays?').map(item => item.id)
      ];
      expect(ids(room)).toEqual(inRoom.map(id => [id]));
      expect(ids(note)).toEqual(inCall.map(id => [id]));
    } finally { await agent.client.close(); }
  });

  it('says whether adding added anything, and hands back an entry’s ID only for one its person proposed', async () => {
    const browser = await account();
    const other = await account();
    const noteId = await recorded(browser.api, 'MCP whose entry note');
    await browser.api.notes.share(noteId, { emails: [await emailOf(other)] });
    await other.api.notes.proposeDecision(noteId, { text: 'Their decision' });
    await other.api.notes.proposeAction(noteId, { text: 'Their follow-up' });
    const note = await browser.api.notes.get(noteId);
    const [notesDecision, notesQuestion] = [note.decisions.find(item => item.changes.length === 0), note.questions.find(item => item.changes.length === 0)];
    if (!notesDecision || !notesQuestion) throw new Error('The notes wrote no decision or question of their own.');
    // Writing alone: it can't read the note, and gets no handle on what someone else, or the notes, wrote.
    const writer = await connect(browser, ['notes:write']);
    const call = async (name: string, args: Record<string, unknown>) => (await writer.client.callTool({ name, arguments: { noteId, ...args } })).structuredContent;
    try {
      expect(await call('propose_decision', { proposal: { text: 'Their decision' } })).toEqual({ ok: true, noteId, added: false });
      expect(await call('add_follow_up', { followUp: { text: 'Their follow-up' } })).toEqual({ ok: true, noteId, added: false });
      expect(await call('propose_decision', { proposal: { text: notesDecision.text } })).toEqual({ ok: true, noteId, added: false });
      expect(await call('add_question', { question: { text: notesQuestion.text } })).toEqual({ ok: true, noteId, added: false });
      // What its person proposed: added with its ID, and again, not added, with the same ID.
      for (const [name, payload, key] of [['propose_decision', { proposal: { text: 'Our decision' } }, 'decisionId'], ['add_follow_up', { followUp: { text: 'Our follow-up' } }, 'followUpId'], ['add_question', { question: { text: 'Our question?' } }, 'questionId']] as const) {
        const first = AgentWriteResultSchema.parse(await call(name, payload));
        expect(first).toEqual({ ok: true, noteId, added: true, [key]: expect.any(String) });
        expect(await call(name, payload)).toEqual({ ok: true, noteId, added: false, [key]: first[key] });
      }
      expect((await browser.api.notes.get(noteId)).decisions.filter(item => item.text === 'Their decision')).toHaveLength(1);
    } finally { await writer.client.close(); }
  });

  it('lists the calls you were in: your own that ended, and the ones you were invited to that kept notes, not notes shared afterwards', async () => {
    const org = await account();
    const guest = await account();
    const later = await account();
    const [orgEmail, guestEmail, laterEmail] = [await emailOf(org), await emailOf(guest), await emailOf(later)];
    const past = await held(org, 'Past call canary', [guestEmail]);
    await org.api.notes.share(past.noteId, { emails: [laterEmail] });
    // A call of the guest's own after it, set for later than the one they were invited to started.
    const theirs = await held(guest, 'Own call canary', []);
    const ahead = await org.api.meetings.create({ title: 'Upcoming canary', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [guestEmail], notes: 'on' });
    const agents = await Promise.all([org, guest, later].map(b => connect(b, ['meetings:read'])));
    const [orgAgent, guestAgent, laterAgent] = agents;
    if (!orgAgent || !guestAgent || !laterAgent) throw new Error('Three agents were not connected.');
    const person = (email: string) => expect.objectContaining({ email });
    const Past = z.object({ items: z.array(AgentPastCallSchema), nextOffset: z.number().nullable() });
    const pastFor = async (agent: { client: Client }) => Past.parse((await agent.client.callTool({ name: 'list_meetings', arguments: { view: 'past' } })).structuredContent);
    try {
      // The organizer's own call, by its ID, which get_meeting reads.
      expect(await pastFor(orgAgent)).toEqual({ nextOffset: null, items: [
        { meetingId: past.meetingId, noteId: past.noteId, title: 'Past call canary', startsAt: past.startsAt, minutes: 1, organizer: person(orgEmail), role: 'organizer', guests: [person(guestEmail)] }
      ] });
      expect((await orgAgent.client.callTool({ name: 'get_meeting', arguments: { meetingId: past.meetingId } })).isError).not.toBe(true);
      // Its guest's invitation went when it was over, so they know it by its note, in the same shape, beside their own
      // call, newest first. Whoever got the notes afterwards wasn't on it.
      const startedAt = (await guest.api.notes.get(past.noteId)).startedAt;
      expect(await pastFor(guestAgent)).toEqual({ nextOffset: null, items: [
        { meetingId: theirs.meetingId, noteId: theirs.noteId, title: 'Own call canary', startsAt: theirs.startsAt, minutes: 1, organizer: person(guestEmail), role: 'organizer', guests: [] },
        { meetingId: null, noteId: past.noteId, title: 'Past call canary', startsAt: startedAt, minutes: 1, organizer: person(orgEmail), role: 'invited', guests: [person(guestEmail)] }
      ] });
      expect(refusalOf(await guestAgent.client.callTool({ name: 'get_meeting', arguments: { meetingId: past.meetingId } }))).toBe('not-found');
      // A note shared afterwards isn't a call they were in.
      expect((await later.api.notes.list()).map(note => note.id)).toEqual([past.noteId]);
      expect(await pastFor(laterAgent)).toEqual({ items: [], nextOffset: null });
      // Calls ahead still list the ones they're invited to, beside their own (a demo account's sample calendar), with the link to join.
      const upcoming = z.object({ items: z.array(z.object({ id: z.string(), isOrganizer: z.boolean(), url: z.url() })) }).parse((await guestAgent.client.callTool({ name: 'list_meetings', arguments: {} })).structuredContent);
      expect(upcoming.items.filter(item => !item.isOrganizer)).toEqual([{ id: ahead.id, isOrganizer: false, url: `${h.deps.cfg.WEB_ORIGIN}/join/${ahead.code}` }]);
      // Each view keeps how many it found; the refused get_meeting isn't kept.
      expect((await guest.api.agents.activity()).items.map(item => [item.tool, item.count])).toEqual([['list_meetings', upcoming.items.length], ['list_meetings', 2]]);
    } finally { await Promise.all(agents.map(agent => agent.client.close())); h.closeCalls(); }
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

  it('lists what the release before kept of a renamed tool under the name it has now', async () => {
    const browser = await account();
    const ownerId = await ownerOf(browser);
    const agent = await connect(browser, ['notes:read']);
    try { await listNotes(agent, 1); } finally { await agent.client.close(); }
    // Sealed as the release before sealed them, under the names its tools had: the same key, header and shape.
    const [noteId, meetingId] = [id128(), id128()];
    const before = [['propose_action', { noteId }], ['update_action', { noteId }], ['answer_call', { meetingId }]] as const;
    const owner = await openOwner(h.deps, ownerId, undefined);
    const key = stateKey(owner.root, ownerId, 'agent-activity');
    for (const [n, [tool, about]] of before.entries()) {
      const id = id128();
      const body = sealJson(key, { v: 1, kind: 'agent-activity', ownerId, activityId: id }, { tool, ...about });
      await h.pool.query("INSERT INTO agent_activity (owner_id, grant_id, id, created_at, body_ciphertext) VALUES ($1, $2, $3, now() + $4::int * interval '1 second', $5)", [ownerId, agent.connection.id, id, n + 1, body]);
    }
    key.fill(0); owner.root.fill(0); owner.wrapKey.fill(0);
    expect((await browser.api.agents.activity()).items.map(item => [item.tool, item.noteId, item.meetingId])).toEqual([
      ['respond_to_invite', null, meetingId], ['update_follow_up', noteId, null], ['add_follow_up', noteId, null], ['list_notes', null, null]
    ]);
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
