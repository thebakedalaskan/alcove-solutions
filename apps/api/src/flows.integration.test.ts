/**
 * End-to-end flows against the real API, Postgres and object store (see AGENTS.md: integration
 * tests only). Passkeys are real WebAuthn from a software authenticator. Leakage checks plant
 * canaries and confirm they never reach database rows or stored objects in plaintext.
 */
import { AlcoveApiError, OPERATION_HEADER, REQUEST_ID_HEADER, type AudioPiece, type CallSession, type CallState } from '@alcove/api';
import type { ClientEvent } from '@alcove/api-http';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFetch, softPasskeys } from './testing/soft-passkey';
import { ORIGIN, startHarness, type Harness } from './testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

function audioBytes(marker: string): Uint8Array<ArrayBuffer> {
  const src = Buffer.concat([Buffer.from(marker), randomBytes(4096)]);
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, seq: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
/** The API's log lines, parsed. */
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const logLines = () => h.logs.flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
const linesFor = (requestId: string) => logLines().filter((l) => l['requestId'] === requestId);
const soft = (prf = true) => softPasskeys({ origin: ORIGIN, rpId: 'localhost', prf });
async function newAccount(name = 'Maya Chen') { const c = h.client(); return { ...c, session: await c.api.auth.createAccount(name) }; }
/** Waits until optimistic call actions have been confirmed by the server. */
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) await new Promise((r) => setTimeout(r, 30));
  return call.getSnapshot();
}
/** Only attributes leave the cookie parser, so assertion failures cannot print session secrets. */
function cookieAttributes(header: string) {
  const attributes = new Set(header.split(';').slice(1).map((attribute) => attribute.trim().toLowerCase()));
  return {
    secure: attributes.has('secure'), httpOnly: attributes.has('httponly'), sameSiteStrict: attributes.has('samesite=strict'),
    pathRoot: attributes.has('path=/'), removed: attributes.has('max-age=0')
  };
}

describe('public readiness', () => {
  it('reports public readiness before unlocking an account', async () => {
    const client = h.client();
    expect(await client.api.auth.getSession()).toBeNull();
    for (const path of ['/health', '/healthz']) {
      const response = await client.fetch(`${h.baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      const health = z.object({ ok: z.literal(true), inference: z.enum(['configured', 'missing']) }).parse(await response.json());
      expect(health.ok).toBe(true);
    }
    expect(await client.api.auth.getSession()).toBeNull();
  });
});

describe('accounts and passkeys', () => {
  it('locks and unlocks an account with an HTTPS host-prefixed cookie', async () => {
    const attributes: ReturnType<typeof cookieAttributes>[] = [];
    const browser = cookieFetch(ORIGIN);
    const { api } = h.client(undefined, async (input, init) => {
      const response = await browser(input, init);
      for (const header of response.headers.getSetCookie()) {
        if (header.startsWith('__Host-alcove_session=')) attributes.push(cookieAttributes(header));
      }
      return response;
    });
    const session = await api.auth.createAccount('HTTPS Cookie Check');
    expect(attributes.at(-1)).toEqual({ secure: true, httpOnly: true, sameSiteStrict: true, pathRoot: true, removed: false });
    expect((await api.auth.getSession())?.ownerId).toBe(session.ownerId);

    await api.auth.lock();
    expect(attributes.at(-1)).toMatchObject({ secure: true, pathRoot: true, removed: true });
    expect(await api.auth.getSession()).toBeNull();
    expect((await api.auth.unlock()).ownerId).toBe(session.ownerId);
    expect(attributes.at(-1)).toEqual({ secure: true, httpOnly: true, sameSiteStrict: true, pathRoot: true, removed: false });
    await api.auth.lock();
  });

  it('clears an invalidated HTTPS cookie before unlocking the account again', async () => {
    const { api, fetch: browser, session } = await newAccount('Invalidated HTTPS Cookie');
    // A restart closes in-memory sessions while browsers still hold their old cookies.
    h.deps.sessions.closeAll();
    const response = await browser(`${h.baseUrl}/v1/passkeys`);
    expect(response.status).toBe(423);
    const attributes = response.headers.getSetCookie().filter((header) => header.startsWith('__Host-alcove_session=')).map(cookieAttributes);
    expect(attributes).toMatchObject([{ secure: true, pathRoot: true, removed: true }]);
    expect(await api.auth.getSession()).toBeNull();
    expect((await api.auth.unlock()).ownerId).toBe(session.ownerId);
    await api.auth.lock();
  });

  it('creates an account with a passkey, locks, and unlocks back into the same encrypted vault', async () => {
    const { api, session } = await newAccount();
    expect(session.user.name).toBe('Maya Chen');
    expect(session.ownerId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.rootSource).toBe('prf');
    expect((await api.account.setupSteps()).map((s) => [s.id, s.done])).toEqual([['passkey', true], ['first-call', false], ['second-passkey', false]]);
    expect(await api.credits.balance()).toEqual({ balance: 10_000, perMinute: 25 });
    expect((await api.credits.history())[0]).toMatchObject({ label: 'Welcome credits', amount: 10_000 });

    const m = await api.meetings.create({ title: 'Locked away', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [], notes: 'full', audience: 'everyone' });
    await api.auth.lock();
    expect(await api.auth.getSession()).toBeNull();
    expect(code(await api.meetings.upcoming().catch((e: unknown) => e))).toBe('unauthenticated');

    const again = await api.auth.unlock();
    expect(again.ownerId).toBe(session.ownerId);
    expect((await api.meetings.upcoming()).map((x) => x.id)).toContain(m.id);
  });

  it('refuses a passkey whose secret is wrong instead of opening an empty vault', async () => {
    const { device } = await newAccount('Wrong Key');
    const real = 'credentials' in device && Array.isArray(device.credentials) ? device.credentials : [];
    const tampered = soft();
    for (const c of real) tampered.credentials.push({ ...c, secret: new Uint8Array(randomBytes(32)) });
    expect(code(await h.client(tampered).api.auth.unlock().catch((e: unknown) => e))).toBe('key-unavailable');
  });

  it('adds a second passkey only after a fresh passkey proof, and it unlocks the same account elsewhere', async () => {
    const device = soft();
    const first = h.client(device);
    const session = await first.api.auth.createAccount('Two Keys');
    // The new passkey is created on the same authenticator after it re-proves with the first one.
    const added = await first.api.account.addPasskey();
    expect(added.deviceName).toBe('Test laptop');
    const newCred = device.credentials.find((c) => Buffer.from(c.id).toString('base64url') === added.id);
    if (!newCred) throw new Error('expected the new credential');
    const phone = soft();
    phone.credentials.push(newCred);
    const other = h.client(phone);
    expect((await other.api.auth.unlock()).ownerId).toBe(session.ownerId);
    expect((await other.api.account.passkeys()).length).toBe(2);
    expect((await other.api.account.setupSteps()).find((s) => s.id === 'second-passkey')?.done).toBe(true);

    // One current session per owner: unlocking elsewhere locked the first browser.
    expect(code(await first.api.account.passkeys().catch((e: unknown) => e))).toBe('locked');

    // Removing needs a fresh proof too, and the last passkey can never be removed.
    const original = (await other.api.account.passkeys()).find((p) => p.id !== added.id)?.id ?? '';
    await other.api.account.removePasskey(original);
    expect((await other.api.account.passkeys()).map((p) => p.id)).toEqual([added.id]);
    expect(code(await other.api.account.removePasskey(added.id).catch((e: unknown) => e))).toBe('conflict');
  });

  it('refuses to add a passkey with only a session cookie', async () => {
    const { fetch } = await newAccount('Cookie Thief');
    const res = await fetch(`${h.baseUrl}/v1/passkeys/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
  });

  it('refuses state changes from other origins and non-JSON bodies', async () => {
    const { fetch } = await newAccount('Origin Check');
    const evil = await fetch(`${h.baseUrl}/v1/calls`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:4000' }, body: '{}' });
    expect(evil.status).toBe(403);
    const plain = await fetch(`${h.baseUrl}/v1/calls`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(plain.status).toBe(400);
  });

  it('falls back to a device-held secret when the authenticator has no PRF', async () => {
    const c = h.client(soft(false));
    const s = await c.api.auth.createAccount('No PRF');
    expect(s.rootSource).toBe('device');
    await c.api.auth.lock();
    expect((await c.api.auth.unlock()).ownerId).toBe(s.ownerId);
  });

  it('renames the account and keeps preferences', async () => {
    const { api } = await newAccount('Old Name');
    expect((await api.account.rename('New Name')).user.name).toBe('New Name');
    expect(await api.account.updatePreferences({ notesDefault: 'always' })).toEqual({ notesDefault: 'always', keep: 'full' });
    expect(await api.account.preferences()).toEqual({ notesDefault: 'always', keep: 'full' });
  });
});

describe('meetings', () => {
  it('schedules, edits, changes notes and cancels a meeting', async () => {
    const { api } = await newAccount();
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const m = await api.meetings.create({ title: 'Harbor kickoff', startsAt: start, durationMinutes: 30, guests: ['Ben@Harbor.health', 'sam@fastmail.com'], notes: 'full', audience: 'everyone' });
    expect(m).toMatchObject({ title: 'Harbor kickoff', isHost: true, status: 'scheduled', notes: 'full' });
    expect(m.guests.map((g) => [g.email, g.rsvp])).toEqual([['ben@harbor.health', 'pending'], ['sam@fastmail.com', 'pending']]);
    expect(m.code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect((await api.meetings.byCode(m.code))?.id).toBe(m.id);

    const edited = await api.meetings.update(m.id, { title: 'Harbor kickoff (moved)', durationMinutes: 45, guests: ['ben@harbor.health'] });
    expect(edited.title).toBe('Harbor kickoff (moved)');
    expect((new Date(edited.endsAt).getTime() - new Date(edited.startsAt).getTime()) / 60_000).toBe(45);
    expect(edited.guests).toHaveLength(1);
    expect((await api.meetings.setNotes(m.id, 'off')).notes).toBe('off');

    await api.meetings.cancel(m.id);
    expect((await api.meetings.upcoming()).map((x) => x.id)).not.toContain(m.id);
    expect(await api.meetings.byCode(m.code)).toBeNull();
  });

  it('applies a retried mutation only once (operation IDs)', async () => {
    const { fetch } = await newAccount();
    const body = JSON.stringify({ title: 'Once', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [], notes: 'off', audience: 'everyone' });
    const send = (op: string, b = body) => fetch(`${h.baseUrl}/v1/meetings`, { method: 'POST', headers: { 'content-type': 'application/json', [OPERATION_HEADER]: op }, body: b });
    const op = Buffer.from(randomBytes(16)).toString('base64url');
    const first = await (await send(op)).json();
    const second = await (await send(op)).json();
    expect(second).toEqual(first);
    expect((await send(op, body.replace('Once', 'Twice'))).status).toBe(409);
  });
});

describe('calls with notes', () => {
  it('records encrypted audio across segments, ends the call and hands the recording to notes', async () => {
    const { api, fetch: own } = await newAccount();
    const { code: callCode } = await api.calls.createInstant();
    const call = await api.calls.join(callCode, { mic: true, cam: true, notes: 'full', audience: 'everyone' });
    let s = call.getSnapshot();
    expect(s.title).toBe('Maya’s call');
    expect(s.notes).toMatchObject({ status: 'on', mode: 'full', everOn: true });
    expect(s.notes.noteId).toBeTruthy();
    expect(s.participants).toHaveLength(1);

    const seg0 = [audioBytes('CANARY-AUDIO-0'), audioBytes('CANARY-AUDIO-1')];
    await call.appendAudio(piece(seg0[0] ?? audioBytes(''), 0, 0));
    await call.appendAudio(piece(seg0[1] ?? audioBytes(''), 0, 1));
    await call.appendAudio(piece(seg0[1] ?? audioBytes(''), 0, 1)); // retry of the same piece is a no-op
    expect(call.getSnapshot().notes.recording).toEqual({ segment: 0, pieces: 2, seconds: 10 });

    call.pauseNotes();
    s = await settle(call, (x) => x.notes.status === 'paused');
    expect(code(await call.appendAudio(piece(audioBytes('x'), 0, 2)).catch((e: unknown) => e))).toBe('conflict');
    call.stopNotes();
    await settle(call, (x) => x.notes.status === 'off');
    call.startNotes('notes');
    s = await settle(call, (x) => x.notes.status === 'on' && x.notes.recording.segment === 1);
    await call.appendAudio(piece(audioBytes('segment-one'), 1, 0));

    call.sendChat('CANARY-CHAT agenda link');
    call.setSharing(true, 'Pilot timeline');
    call.setMic(false);
    s = await settle(call, (x) => x.chat.length === 1 && !!x.sharing && x.participants[0]?.mic === false);
    expect(s.chat[0]?.text).toBe('CANARY-CHAT agenda link');

    const end = await call.leave();
    expect(end.pendingNoteId).toBe(s.notes.noteId);
    const noteId = end.pendingNoteId ?? '';

    const steps = [];
    for await (const p of api.notes.progress(noteId)) steps.push(p);
    expect(steps.at(-1)?.ready).toBe(true);

    const note = await api.notes.get(noteId);
    expect(note).toMatchObject({ kind: 'call', status: 'pending', keep: 'full', title: 'Maya’s call' });
    expect(note.audio.map((a) => [a.index, a.pieces])).toEqual([[0, 2], [1, 1]]);

    // The decrypted segment is exactly the concatenation of what was recorded.
    expect((await h.client().fetch(api.notes.audioUrl(noteId, 0))).status).toBe(401); // another browser can't read it
    const mine = await own(api.notes.audioUrl(noteId, 0));
    expect(Buffer.from(await mine.arrayBuffer()).equals(Buffer.concat(seg0))).toBe(true);

    const past = await api.meetings.past();
    expect(past[0]).toMatchObject({ status: 'ended', noteId });
    expect((await api.account.setupSteps()).find((x) => x.id === 'first-call')?.done).toBe(true);
    expect((await api.notes.list()).map((n) => n.id)).toContain(noteId);
    expect(code(await (async () => { for await (const p of api.notes.ask(noteId, 'What happened?')) void p; })().catch((e: unknown) => e))).toBe('unavailable');
  });

  it('joins without notes and leaves no note behind', async () => {
    const { api } = await newAccount();
    const { code: c } = await api.calls.createInstant();
    const call = await api.calls.join(c, { mic: true, cam: false, notes: 'off' });
    expect(call.getSnapshot().notes.status).toBe('off');
    expect((await call.leave()).pendingNoteId).toBeNull();
    expect(await api.notes.list()).toEqual([]);
  });

  it('keeps every owner’s calls, notes, audio and recordings out of reach of other accounts', async () => {
    const a = await newAccount('A');
    const b = await newAccount('B');
    const { code: c } = await a.api.calls.createInstant();
    expect(code(await b.api.calls.join(c, { mic: true, cam: true }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await a.api.calls.join('zzz-zzzz-zzz', { mic: true, cam: true }).catch((e: unknown) => e))).toBe('not-found');

    const rec = await a.api.recordings.start('Mine');
    const state = rec.getSnapshot();
    await rec.appendAudio(piece(audioBytes('private'), 0, 0));
    expect(code(await b.api.notes.get(state.noteId).catch((e: unknown) => e))).toBe('not-found');
    expect((await b.fetch(a.api.notes.audioUrl(state.noteId, 0))).status).toBe(404);
    const steal = await b.fetch(`${h.baseUrl}/v1/recordings/${state.id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(steal.status).toBe(404);
    expect(code(await b.api.meetings.get(state.noteId).catch((e: unknown) => e))).toBe('not-found');
  });
});

describe('room recordings', () => {
  it('records in the room, renames, stops into a private note, and can be discarded', async () => {
    const { api } = await newAccount();
    const rec = await api.recordings.start('Board prep');
    await rec.appendAudio(piece(audioBytes('room-0'), 0, 0));
    rec.rename('Board prep with Dana');
    rec.pause();
    await new Promise((r) => setTimeout(r, 150));
    expect(code(await rec.appendAudio(piece(audioBytes('while paused'), 0, 1)).catch((e: unknown) => e))).toBe('conflict');
    rec.resume();
    await new Promise((r) => setTimeout(r, 150));
    const { pendingNoteId } = await rec.stop();
    const note = await api.notes.get(pendingNoteId);
    expect(note).toMatchObject({ kind: 'room', title: 'Board prep with Dana', status: 'pending', audience: 'host' });
    expect((await api.notes.list({ kind: 'room' })).map((n) => n.id)).toEqual([pendingNoteId]);

    const throwaway = await api.recordings.start('Throwaway');
    await throwaway.appendAudio(piece(audioBytes('gone'), 0, 0));
    await throwaway.discard();
    expect((await api.notes.list()).map((n) => n.title)).toEqual(['Board prep with Dana']);

    const objectIds = (await h.pool.query('SELECT p.object_id FROM recording_pieces p JOIN recordings r USING (owner_id, recording_id) WHERE r.note_item_id = $1', [pendingNoteId])).rows.map((r) => String(r.object_id));
    expect(objectIds.length).toBeGreaterThan(0);
    await api.notes.delete(pendingNoteId);
    expect(await api.notes.list()).toEqual([]);
    // Gone for good: no revisions, recording rows, jobs, receipts or objects remain for this owner.
    const owner = (await api.auth.getSession())?.ownerId ?? '';
    // The only receipt left is the delete's own ({"deleted":true}); older ones were purged with the note.
    for (const t of ['revisions WHERE item_id = $2', 'recordings WHERE note_item_id = $2', "operations WHERE method NOT LIKE 'DELETE%'"]) {
      const r = await h.pool.query(`SELECT count(*)::int AS n FROM ${t.split(' WHERE ')[0]} WHERE owner_id = $1 AND ${t.split(' WHERE ')[1]}`, t.includes('$2') ? [owner, pendingNoteId] : [owner]);
      expect(r.rows[0]?.n).toBe(0);
    }
    for (const id of objectIds) expect(await h.objects.get(id).then(() => 'exists', () => 'gone')).toBe('gone');
  });
});

describe('privacy at rest', () => {
  it('keeps names, titles, guests, chat, labels and audio out of rows and objects in any encoding', async () => {
    // Watch the wire for the secrets a browser sends, so the logs can be checked for them too.
    const secrets: string[] = [];
    const jar = cookieFetch(ORIGIN);
    const tap: typeof fetch = async (input, init) => {
      const sent = typeof init?.body === 'string' ? z.record(z.string(), z.unknown()).safeParse(JSON.parse(init.body)) : undefined;
      if (sent?.success) for (const k of ['prf', 'deviceSecret']) { const v = sent.data[k]; if (typeof v === 'string') secrets.push(v); }
      const res = await jar(input, init);
      const cookie = /alcove_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
      if (cookie) secrets.push(cookie);
      return res;
    };
    const c = h.client(soft(), tap, 'CANARY-DEVICE laptop');
    const { ownerId } = await c.api.auth.createAccount('CANARY-NAME Person');
    const m = await c.api.meetings.create({ title: 'CANARY-TITLE secret merger', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: ['canary-guest@example.com'], notes: 'full', audience: 'everyone' });
    await c.api.meetings.update(m.id, { title: 'CANARY-EDIT renamed merger' });
    const { code: cc } = await c.api.calls.createInstant();
    const call = await c.api.calls.join(cc, { mic: true, cam: true, notes: 'full' });
    await call.appendAudio(piece(audioBytes('CANARY-AUDIO-RAW'), 0, 0));
    call.sendChat('CANARY-CHAT private remark');
    await settle(call, (x) => x.chat.length === 1);
    await call.leave();
    const rec = await c.api.recordings.start('Room');
    rec.rename('CANARY-ROOM title');
    await new Promise((r) => setTimeout(r, 150));
    await rec.stop();
    await c.api.notes.list({ text: 'CANARY-SEARCH words' });

    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM owners x UNION ALL SELECT row_to_json(x)::text FROM passkeys x UNION ALL
      SELECT row_to_json(x)::text FROM items x UNION ALL SELECT row_to_json(x)::text FROM revisions x UNION ALL
      SELECT row_to_json(x)::text FROM calls x UNION ALL SELECT row_to_json(x)::text FROM recordings x UNION ALL
      SELECT row_to_json(x)::text FROM recording_pieces x UNION ALL SELECT row_to_json(x)::text FROM billing_accounts x UNION ALL
      SELECT row_to_json(x)::text FROM content_jobs x UNION ALL SELECT row_to_json(x)::text FROM operations x) q`);
    const rowsText = String(dump.rows[0]?.all ?? '');
    // bytea renders as hex; our records embed base64url; check every encoding a plaintext bug could produce.
    const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
    const canaries = ['CANARY-NAME', 'CANARY-TITLE', 'CANARY-EDIT', 'canary-guest', 'CANARY-CHAT', 'CANARY-AUDIO', 'CANARY-DEVICE', 'CANARY-ROOM', 'CANARY-SEARCH', 'Welcome credits'];
    const hexRows = Buffer.from(rowsText).toString('utf8');
    for (const canary of canaries) for (const enc of encodings(canary)) expect(hexRows.includes(enc), `${canary} as ${enc}`).toBe(false);

    // Every object in the bucket, not only the referenced ones.
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const canary of canaries) for (const enc of encodings(canary)) expect(bytes.includes(Buffer.from(enc)), `${canary} in ${obj.id}`).toBe(false);
    }
    expect(ownerId).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // And the logs, which ran at debug level for this whole flow: no content, no keys, no session cookie.
    expect(secrets.length).toBeGreaterThanOrEqual(2);
    const logText = h.logs.join('');
    expect(logText).toContain(ownerId);
    for (const canary of canaries) for (const enc of encodings(canary)) expect(logText.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
    for (const secret of secrets) expect(logText.includes(secret), 'a secret in logs').toBe(false);
    expect(logText).not.toContain(m.code);
  });
});

describe('maintenance', () => {
  it('deletes unreferenced objects and closes expired sessions', async () => {
    const { maintain } = await import('./maintenance');
    await h.objects.put('orphanorphanorphan0000', new Uint8Array([1, 2, 3]));
    const r = await maintain(h.deps, { orphanAgeMs: 0 });
    expect(r.orphans).toBeGreaterThanOrEqual(1);
    expect(await h.objects.get('orphanorphanorphan0000').then(() => 'exists', () => 'gone')).toBe('gone');
  });
});

describe('home data', () => {
  it('reports week stats and open actions from real activity', async () => {
    const { api } = await newAccount();
    const { code: c } = await api.calls.createInstant();
    const call = await api.calls.join(c, { mic: true, cam: true, notes: 'full' });
    await call.leave();
    const week = await api.stats.week();
    expect(week.minutesByDay).toHaveLength(7);
    expect(week.notes).toBe(1);
    expect(await api.notes.openActions()).toEqual([]);
  });
});


describe('logging and errors', () => {
  it('ties a failed request to its log line by request ID, with the error class and context', async () => {
    const events: ClientEvent[] = [];
    const c = h.client(soft(), undefined, undefined, (e) => events.push(e));
    await c.api.auth.createAccount('Log Reader');
    expect(events.find((e) => e.msg === 'passkey created')?.context).toMatchObject({ prf: true, keySource: 'prf' });

    const err = await c.api.meetings.get('AAAAAAAAAAAAAAAAAAAAAA').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AlcoveApiError);
    const requestId = err instanceof AlcoveApiError ? err.requestId : undefined;
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(err instanceof AlcoveApiError ? [err.code, err.status, err.method] : []).toEqual(['not-found', 404, 'GET']);
    expect(events.find((e) => e.msg === 'request failed' && e.context['requestId'] === requestId)?.context).toMatchObject({ code: 'not-found', status: 404 });

    const lines = linesFor(requestId ?? '');
    expect(lines.find((l) => l['errorClass'] === 'NotFoundError')).toMatchObject({ code: 'not-found', status: 404, path: expect.stringMatching(/^\/v1\/meetings\//) });
    expect(lines.find((l) => l.msg === 'request refused')).toMatchObject({ status: 404, ownerId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    // Database queries made for that request carry its ID too.
    expect(lines.some((l) => l['component'] === 'db')).toBe(true);
  });

  it('keeps a request ID the caller sends, and masks call codes in logged paths', async () => {
    const { api, fetch } = await newAccount('Header Echo');
    const { code: callCode } = await api.calls.createInstant();
    const res = await fetch(`${h.baseUrl}/v1/calls/${callCode}/meeting`, { headers: { [REQUEST_ID_HEADER]: 'trace-abc-123' } });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('trace-abc-123');
    expect(linesFor('trace-abc-123').find((l) => l.msg === 'request')).toMatchObject({ path: '/v1/calls/:code/meeting', status: 200 });
    expect(h.logs.join('')).not.toContain(callCode);
    const bad = await fetch(`${h.baseUrl}/v1/session`, { headers: { [REQUEST_ID_HEADER]: 'bad id with spaces' } });
    expect(bad.headers.get(REQUEST_ID_HEADER)).not.toBe('bad id with spaces');
  });

  it('records browser reports in the server log and refuses malformed or cross-site ones', async () => {
    const f = cookieFetch(ORIGIN);
    const post = (body: unknown, headers: Record<string, string> = {}) => f(`${h.baseUrl}/v1/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const ok = await post({ entries: [{ level: 'error', msg: 'audio piece lost after 3 attempts', at: new Date().toISOString(), context: { component: 'media', seq: 7, requestId: 'req-from-browser' } }] });
    expect(ok.status).toBe(200);
    expect(logLines().find((l) => l.msg === 'audio piece lost after 3 attempts')).toMatchObject({ level: 50, source: 'browser', seq: 7, requestId: expect.any(String) });
    expect((await post({ entries: [{ level: 'error', msg: 'x'.repeat(500), at: 'now', context: {} }] })).status).toBe(400);
    expect((await post({ entries: [] })).status).toBe(400);
    expect((await post({ entries: [{ level: 'warn', msg: 'hi', at: 'now' }] }, { origin: 'http://evil.example' })).status).toBe(403);
  });

  it('logs unexpected server failures with their cause, and tells the client only a request ID', async () => {
    const { api } = await newAccount('Broken Store');
    const call = await api.calls.join((await api.calls.createInstant()).code, { mic: true, cam: false, notes: 'full' });
    const realPut = h.deps.objects.put;
    h.deps.objects.put = () => Promise.reject(new Error('disk on fire'));
    const err = await call.appendAudio(piece(audioBytes('x'), 0, 0)).catch((e: unknown) => e).finally(() => { h.deps.objects.put = realPut; });
    expect(err).toBeInstanceOf(AlcoveApiError);
    if (!(err instanceof AlcoveApiError)) return;
    expect([err.code, err.status]).toEqual(['unknown', 500]);
    expect(err.message).not.toContain('disk on fire');
    // Anything that isn't an AppError becomes an InternalError whose cause is the original.
    const line = linesFor(err.requestId ?? '').find((l) => l['errorClass'] === 'InternalError');
    expect(line).toMatchObject({ level: 50, code: 'unknown', status: 500, component: 'http' });
    // The serialized error carries the whole chain, stack included.
    expect(JSON.stringify(line?.['err'])).toContain('disk on fire');
    expect(linesFor(err.requestId ?? '').some((l) => l.msg === 'audio piece not recorded; deleting its object' || l.msg === 'request failed')).toBe(true);
    await call.leave();
  });
});
