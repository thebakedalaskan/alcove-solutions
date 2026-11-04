/**
 * Joining a call by its link without being invited: what the link tells anyone before they join, signed-in people
 * the organizer lets in (added to the invite, so they get the notes) next to guests (who don't), how every refusal
 * fails safely with a request ID, and what a guest's call pass can reach (its own call, nothing else). The real API
 * over HTTP via @alcove/api-http, real Postgres, the object store and the local LiveKit server.
 */
import { AlcoveApiError, type AlcoveApi, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { speechWav } from './testing/fake-near';
import { ORIGIN, startHarness, type Harness } from './testing/harness';
import { disposeLiveKit } from './testing/livekit';

// Calls go through the real LiveKit server; every wait below is bounded and says what it was waiting for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { vi.useRealTimers(); h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh account: single sign-on signs in whoever's work email is typed. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const guestBrowser = () => h.browser().api;
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
const speech = (words: string, segment: number, startMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, startMs, durationMs: ms });
/** Every progress step of a note until it's written. */
async function written(api: AlcoveApi, noteId: string) { for await (const p of api.notes.progress(noteId)) if (p.ready) return; }
/** The log lines written while handling one request. */
const linesOf = (requestId: string) => h.logs.filter((l) => l.includes(requestId));

describe('the call’s link, before joining', () => {
  it('says whether notes are on and whether the call has ended, and tells someone signed in whether they’re invited', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'off', guests: [invitedEmail] });
    const anyone = guestBrowser();
    const invited = await account(invitedEmail);
    const stranger = await account();
    expect(await anyone.calls.card(c)).toEqual({ title: expect.any(String), organizerName: org.session.user.name, hostHere: false, locked: false, ended: false, notes: 'off', invited: false });
    expect((await invited.api.calls.card(c)).invited).toBe(true);
    expect((await stranger.api.calls.card(c)).invited).toBe(false);
    expect((await org.api.calls.card(c)).invited).toBe(true);
    // A call scheduled with notes says so before anyone has joined.
    const scheduled = await org.api.meetings.create({ title: 'Planning', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on' });
    expect((await anyone.calls.card(scheduled.code)).notes).toBe('on');

    // Once the call is on, the call's own notes count: the organizer turning them on shows before anyone asks.
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    expect(await anyone.calls.card(c)).toMatchObject({ hostHere: true, notes: 'off', ended: false });
    host.setNotes(true);
    await settle(host, (s) => s.notes.status === 'on');
    expect((await anyone.calls.card(c)).notes).toBe('on');

    await host.leave();
    expect(await anyone.calls.card(c)).toMatchObject({ hostHere: false, ended: true });
    // Over: nobody but the organizer can start it again, and the link says so rather than "waiting for the host".
    for (const attempt of [() => anyone.calls.join(c, { mic: true, cam: false, name: 'Sam' }), () => invited.api.calls.join(c, { mic: true, cam: false })]) {
      const e = await attempt().catch((x: unknown) => x);
      expect([code(e), e instanceof Error ? e.message : '']).toEqual(['conflict', 'This call has ended.']);
    }
    const again = await org.api.calls.join(c, { mic: true, cam: false });
    expect(await anyone.calls.card(c)).toMatchObject({ hostHere: true, ended: false });
    await again.leave();
  });
});

describe('signed-in people let in from the link', () => {
  it('adds them to the invite, so they get the notes, while a guest with only a name doesn’t', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await account(unique('asker'));
    const signedIn = await asker.api.calls.join(c, { mic: true, cam: false });
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect([signedIn.ticket.role, guest.ticket.role]).toEqual(['guest', 'guest']);
    expect(signedIn.crypto.getSnapshot().status).toBe('waiting');

    // The organizer sees who's asking: the signed-in person by their account, the guest by the name they typed.
    const asking = (await settle(host, (s) => s.waiting.length === 2)).waiting;
    expect(asking.find((w) => w.id === signedIn.ticket.identity)?.person).toMatchObject({ name: asker.session.user.name, email: asker.session.user.email });
    expect(asking.find((w) => w.id === guest.ticket.identity)?.person).toMatchObject({ name: 'Sam', email: '' });

    await letIn(host, signedIn);
    await letIn(host, guest);
    // On the invite now, as if invited by email: the call says so, and they see people as invited people do.
    expect((await org.api.meetings.get(host.getSnapshot().meetingId)).guests.map((g) => g.email)).toEqual([asker.session.user.email]);
    const theirs = await settle(signedIn, (s) => s.participants.length === 3);
    expect(theirs.role).toBe('invited');
    expect(JSON.stringify(theirs.participants)).toContain(org.session.user.email);
    const guests = await settle(guest, (s) => s.participants.length === 3);
    expect(guests.role).toBe('guest');
    expect(JSON.stringify(guests)).not.toContain('@');
    // From then on they're invited: coming back on another connection, the organizer's browser lets them in without asking.
    const back = await asker.api.calls.join(c, { mic: true, cam: false });
    expect(back.ticket.role).toBe('invited');
    await inGroup(back);

    await host.transcribe(speech('We agreed to ship on Friday.', 0, 0));
    const end = await host.leave();
    const noteId = end?.pendingNoteId ?? '';
    await written(org.api, noteId);
    // The notes reach them like anyone invited. The guest has no account, and their pass reads no notes.
    expect((await asker.api.notes.get(noteId)).id).toBe(noteId);
    expect((await asker.api.notes.list()).map((n) => n.id)).toEqual([noteId]);
    const r = await fetch(`${h.baseUrl}/v1/notes/${noteId}`, { headers: { 'x-alcove-call': guest.ticket.pass, origin: ORIGIN } });
    expect(r.status).toBe(401);
    // Being on this call's invite opens nothing else of the organizer's.
    const other = await org.api.meetings.create({ title: 'Board prep', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on' });
    expect(code(await asker.api.meetings.get(other.id).catch((e: unknown) => e))).toBe('not-found');
  });

  it('takes someone back off the invite when the organizer removes them, so they don’t get the notes', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await account(unique('asker'));
    const signedIn = await asker.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, signedIn);
    const meetingId = host.getSnapshot().meetingId;
    expect((await org.api.meetings.get(meetingId)).guests.map((g) => g.email).sort()).toEqual([asker.session.user.email, invitedEmail].sort());

    await host.remove(signedIn.ticket.identity);
    // Only what letting them in added goes: the person invited by email stays invited.
    expect((await org.api.meetings.get(meetingId)).guests.map((g) => g.email)).toEqual([invitedEmail]);
    await host.transcribe(speech('Budget is approved.', 0, 0));
    const end = await host.leave();
    await written(org.api, end?.pendingNoteId ?? '');
    expect(code(await asker.api.notes.get(end?.pendingNoteId ?? '').catch((e: unknown) => e))).toBe('not-found');
    expect((await (await account(invitedEmail)).api.notes.get(end?.pendingNoteId ?? '')).id).toBe(end?.pendingNoteId);
  });

  it('keeps a signed-in asker’s name and address sealed: out of rows and logs', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await account('canary.asker@canary.example');
    expect(asker.session.user.name).toBe('Canary Asker');
    const signedIn = await asker.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, signedIn);
    await host.leave();
    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM calls x UNION ALL SELECT row_to_json(x)::text FROM items x UNION ALL
      SELECT row_to_json(x)::text FROM revisions x UNION ALL SELECT row_to_json(x)::text FROM note_access x UNION ALL
      SELECT row_to_json(x)::text FROM call_codes x) q`);
    const rows = String(dump.rows[0]?.all ?? '');
    const logs = h.logs.join('');
    for (const canary of ['canary.asker', 'Canary Asker']) {
      for (const enc of [canary, Buffer.from(canary).toString('hex'), Buffer.from(canary).toString('base64url').slice(0, 12)]) {
        expect(rows.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
      }
    }
  });
});

describe('failing safely', () => {
  /** A refusal: its code, its message, and a request ID that finds its log lines, which name no code, pass or name. */
  async function refused(attempt: () => Promise<unknown>, secrets: string[]) {
    const e = await attempt().then(() => null, (x: unknown) => x);
    if (!(e instanceof AlcoveApiError)) throw new Error('expected the API to refuse');
    const id = e.requestId ?? '';
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    const lines = linesOf(id);
    expect(lines.some((l) => l.includes('"request refused"'))).toBe(true);
    for (const s of secrets) expect(lines.join('').includes(s), 'a join secret or name in the request’s log lines').toBe(false);
    return { code: e.code, message: e.message };
  }

  it('refuses an unknown code, a locked call, a removed person, an ended call and an expired pass, each with a request ID', async () => {
    const anyone = guestBrowser();
    expect(await refused(() => anyone.calls.card('zzz-zzzz-zzz'), ['zzz-zzzz-zzz'])).toEqual({ code: 'not-found', message: 'There’s no call with that code. Check the link and try again.' });
    expect((await refused(() => anyone.calls.join('zzz-zzzz-zzz', { mic: true, cam: false, name: 'Sam Unknown' }), ['zzz-zzzz-zzz', 'Sam Unknown'])).code).toBe('not-found');

    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam Removed' });
    await letIn(host, guest);
    const secrets = [c, guest.ticket.pass, host.ticket.pass, 'Sam Removed', 'Lee Locked'];

    await host.lock(true);
    expect(await refused(() => anyone.calls.join(c, { mic: true, cam: false, name: 'Lee Locked' }), secrets)).toEqual({ code: 'forbidden', message: 'The host has locked this call.' });
    await host.lock(false);

    // An expired pass: twelve hours on, the same pass reads nothing, and coming back with it means asking again.
    const later = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Ada Later' });
    await letIn(host, later);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 12 * 3_600_000 + 60_000 });
    expect(await refused(() => later.refresh(), [...secrets, later.ticket.pass])).toEqual({ code: 'unauthenticated', message: 'Join the call again to carry on.' });
    vi.useRealTimers();

    await host.remove(guest.ticket.identity);
    expect(await refused(() => guest.refresh(), secrets)).toEqual({ code: 'forbidden', message: 'The host removed you from this call.' });

    await host.leave();
    expect(await refused(() => later.refresh(), secrets)).toEqual({ code: 'conflict', message: 'This call has ended.' });
    expect(await refused(() => anyone.calls.join(c, { mic: true, cam: false, name: 'Sam' }), secrets)).toEqual({ code: 'conflict', message: 'This call has ended.' });
  });
});

describe('what a guest’s pass reaches', () => {
  it('opens its own call and nothing else: every route that needs an account refuses it', async () => {
    // An organizer with things a pass must never open: a meeting, written notes in a series, and their photo-less profile.
    const org = await account();
    const first = await org.api.calls.join((await org.api.calls.startNow({ title: 'Standup', notes: 'on' })).code, { mic: true, cam: false });
    await first.transcribe(speech('We agreed to ship on Friday.', 0, 0));
    const firstEnd = await first.leave();
    const noteId = firstEnd?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const next = await org.api.meetings.scheduleNext(first.getSnapshot().meetingId, new Date(Date.now() + 7 * 86_400_000).toISOString());
    const ids: Record<string, string> = { id: noteId, decisionId: 'd', actionId: 'a', questionId: 'q', segment: '0', token: 'nothing', code: next.code };
    const meetingIds: Record<string, string> = { id: next.id };
    const seriesIds: Record<string, string> = { id: next.seriesId ?? '' };

    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);

    // Every route of the API, from its own route table: anything outside the call routes and the public ones needs an account.
    const PUBLIC = new Set(['/health', '/healthz', '/hooks/livekit', '/v1/telemetry', '/v1/attestation', '/v1/session', '/v1/auth/sign-in', '/v1/auth/google', '/v1/auth/google/callback', '/v1/calls/:code/card', '/v1/calls/:code/join']);
    const routes = createApp(h.deps).routes.filter((r) => r.method !== 'ALL' && !PUBLIC.has(r.path) && !r.path.startsWith('/v1/live/calls/'));
    expect(routes.length).toBeGreaterThan(30);
    const fill = (path: string) => {
      const by = path.startsWith('/v1/meetings/') ? { ...ids, ...meetingIds } : path.startsWith('/v1/series/') ? { ...ids, ...seriesIds } : ids;
      return path.replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(by[name] ?? 'x'));
    };
    for (const r of routes) {
      const mutating = r.method !== 'GET';
      const res = await fetch(`${h.baseUrl}${fill(r.path)}`, {
        method: r.method, headers: { 'x-alcove-call': guest.ticket.pass, origin: ORIGIN, ...(mutating ? { 'content-type': 'application/json' } : {}) }, ...(mutating ? { body: '{}' } : {})
      });
      expect(`${r.method} ${r.path} → ${res.status}`).toBe(`${r.method} ${r.path} → 401`);
      expect(await res.text()).not.toContain('Standup');
    }
    // Within its own call, only what the organizer's pass may do is refused; another call's routes don't know it.
    for (const [method, path] of [['POST', '/audio'], ['POST', '/transcribe'], ['POST', '/mls/commits']] as const) {
      const res = await fetch(`${h.baseUrl}/v1/live/calls/${guest.ticket.callId}${path}`, { method, headers: { 'x-alcove-call': guest.ticket.pass, origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' });
      expect([path, res.status]).toEqual([path, 403]);
    }
    const res = await fetch(`${h.baseUrl}/v1/live/calls/${first.ticket.callId}`, { headers: { 'x-alcove-call': guest.ticket.pass } });
    expect(res.status).toBe(401);
    await host.leave();
  });
});
