/**
 * End-to-end flows against the real API, Postgres and object store (see AGENTS.md: integration
 * tests only). Each test signs in through the API like the web app does. Leakage checks plant
 * canaries and confirm they never reach database rows, stored objects or logs in plaintext.
 */
import { AlcoveApiError, OPERATION_HEADER, REQUEST_ID_HEADER, firstName, type AlcoveApi, type AnswerPart, type AudioPiece, type CallSession, type CallState, type NoteProgress, type TranscriptClip } from '@alcove/api';
import { createHttpApi, type ClientEvent } from '@alcove/api-http';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config';
import { cookieName } from './sessions';
import { startFakeDstack } from './testing/fake-dstack';
import { PNG, type GoogleUser, type Spoil } from './testing/fake-google';
import { speechWav, startFakeNear, type Tamper } from './testing/fake-near';
import { ORIGIN, cookieFetch, startHarness, type Browser, type Harness } from './testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => h.closeCalls());

function audioBytes(marker: string): Uint8Array<ArrayBuffer> {
  const src = Buffer.concat([Buffer.from(marker), randomBytes(4096)]);
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}
/** Five seconds of recorded audio, number `seq` of its segment, starting `at` seconds into it (by default where 5-second pieces fall). */
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, seq: number, at = seq * 5): AudioPiece => ({ data: new Blob([bytes]), segment, seq, at, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
/** A clip of speech saying `words` (sentences split by " // ") in `language`, starting `at` seconds into its segment; empty words are silence. */
const speech = (words: string, segment: number, at: number, ms = 4000, language = 'en'): TranscriptClip => ({ data: new Blob([speechWav(words, ms, language)], { type: 'audio/wav' }), segment, at, durationMs: ms });
/** Follows a note's progress until its notes are written (or the stream gives up). */
async function written(api: AlcoveApi, noteId: string): Promise<NoteProgress[]> {
  const steps: NoteProgress[] = [];
  for await (const p of api.notes.progress(noteId)) steps.push(p);
  return steps;
}
async function asked(api: AlcoveApi, noteId: string, question: string): Promise<AnswerPart[]> {
  const parts: AnswerPart[] = [];
  for await (const p of api.notes.ask(noteId, question)) parts.push(p);
  return parts;
}
/** Asks across every note this browser's account has. */
async function askedAll(api: AlcoveApi, question: string): Promise<AnswerPart[]> {
  const parts: AnswerPart[] = [];
  for await (const p of api.notes.askAll(question)) parts.push(p);
  return parts;
}
/** Pauses or resumes a room recording and waits for the server to have done it (the app shows it at once). */
async function settled(b: Browser, recordingId: string, type: 'pause' | 'resume') {
  const r = await b.fetch(`${h.baseUrl}/v1/recordings/${recordingId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type }) });
  expect(r.status).toBe(200);
}
/** Polls until `ok` holds, for background work such as the notes worker. */
async function until(ok: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`Timed out waiting for ${what}`);
}
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
/** The API's log lines, parsed. */
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const logLines = () => h.logs.flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
const linesFor = (requestId: string) => logLines().filter((l) => l['requestId'] === requestId);
let seq = 0;
/** A work email nobody has used yet in this run. */
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh account: single sign-on signs in whoever's work email is typed. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, isNew: r.isNew };
}
/** The organizer leaving ends the call; anything else is a mistake in the test. */
async function ended(call: CallSession) { const r = await call.leave(); if (!r) throw new Error('the organizer’s leave ended nothing'); return r; }
/** Waits until optimistic call actions have been confirmed by the server. */
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  // Other people's changes arrive by fetching the call again (in the app, the server's nudge does it).
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return call.getSnapshot();
}
const SpotlightReply = z.object({ spotlight: z.string().nullable() });
const SessionReply = z.object({ ownerId: z.string() });
/**
 * Signs in with Google the way a browser does: off to Google and back, following each redirect by
 * hand so the browser's cookies see every hop (a second pass to Google included). Returns where the
 * API finally sends the browser. `tamper` and `deliverIn` apply to the first return from Google.
 */
async function viaGoogle(b: Browser, user: GoogleUser, o: { spoil?: Spoil; tamper?: (callback: URL) => void; deliverIn?: Browser; consent?: boolean } = {}): Promise<URL> {
  h.google.next(user, o.spoil);
  let url = new URL(`${h.baseUrl}/v1/auth/google${o.consent ? '?consent=1' : ''}`);
  let first = true;
  for (let hop = 0; hop < 10; hop++) {
    if (url.origin === new URL(ORIGIN).origin) return url;
    let res: Response;
    if (url.origin === h.google.issuer) res = await fetch(url, { redirect: 'manual' });
    else if (url.pathname.endsWith('/callback') && first) {
      first = false;
      o.tamper?.(url);
      res = await (o.deliverIn ?? b).fetch(url, { redirect: 'manual' });
    } else res = await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  throw new Error('Too many redirects while signing in with Google.');
}
/** Where a sign-in ended up, without the origin. */
const landed = (u: URL) => `${u.pathname}${u.search}`;
/** Only a cookie's attributes leave this parser, so a failing assertion can't print a session secret. */
function cookieAttributes(header: string) {
  const attributes = new Set(header.split(';').slice(1).map((a) => a.trim().toLowerCase()));
  return {
    secure: attributes.has('secure'), httpOnly: attributes.has('httponly'), sameSiteStrict: attributes.has('samesite=strict'),
    pathRoot: attributes.has('path=/'), removed: attributes.has('max-age=0')
  };
}

describe('public readiness', () => {
  it('answers health checks on /health and /healthz without a session', async () => {
    const b = h.browser();
    expect(await b.api.auth.getSession()).toBeNull();
    for (const path of ['/health', '/healthz']) {
      const res = await b.fetch(`${h.baseUrl}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(z.object({ ok: z.literal(true), inference: z.enum(['configured', 'missing']) }).parse(await res.json()).ok).toBe(true);
    }
  });
});

describe('signing in', () => {
  it('signs in with Microsoft as Art Vandelay, with his sample calendar, and keeps one account across browsers', async () => {
    const first = h.browser();
    const r = await first.api.auth.signIn('microsoft');
    expect(r.isNew).toBe(true);
    expect(r.session).toMatchObject({ provider: 'microsoft', sample: true, user: { name: 'Art Vandelay', email: 'art@vandelay.industries', photoUrl: '/people/art-vandelay.jpg' } });
    expect(r.session.ownerId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await first.api.auth.getSession()).toMatchObject({ ownerId: r.session.ownerId, provider: 'microsoft' });

    // His calendar came with him: the next call starts in about 12 minutes and the rest of the day follows.
    const day = await first.api.meetings.upcoming();
    expect(day.map((m) => [m.title, m.notes])).toEqual([
      ['Weekly with Theo', 'on'], ['Contract follow-up with Ana', 'off'], ['Lumen: pilot prep', 'on'], ['Interview: Jonas Weber', 'off'], ['Studio stand-up', 'off']
    ]);
    const inMinutes = (new Date(day[0]?.startsAt ?? 0).getTime() - Date.now()) / 60_000;
    expect(inMinutes).toBeGreaterThan(10);
    expect(inMinutes).toBeLessThanOrEqual(17);
    expect(day[0]).toMatchObject({ isOrganizer: true, organizer: { name: 'Art Vandelay', id: r.session.ownerId }, status: 'scheduled' });
    expect(day[2]?.guests.map((g) => g.name)).toEqual(['Priya Raman', 'Inès Moreau', 'Kofi Asante', 'Sam Ortiz']);
    expect(await first.api.credits.balance()).toEqual({ balance: 10_000, granted: 10_000, usedThisMonth: 0, perMinute: 25 });

    // Another browser is the same person: both sessions stay open, and the calendar isn't placed twice.
    const second = h.browser();
    const again = await second.api.auth.signIn('microsoft');
    expect([again.isNew, again.session.ownerId]).toEqual([false, r.session.ownerId]);
    expect(await second.api.meetings.upcoming()).toHaveLength(5);
    expect((await first.api.auth.getSession())?.ownerId).toBe(r.session.ownerId);

    // Signing out ends only that browser's session.
    await first.api.auth.signOut();
    expect(await first.api.auth.getSession()).toBeNull();
    expect(code(await first.api.meetings.upcoming().catch((e: unknown) => e))).toBe('unauthenticated');
    expect((await second.api.auth.getSession())?.ownerId).toBe(r.session.ownerId);
  });

  it('keeps the session in a Secure, HttpOnly, SameSite=Strict host cookie, and clears it the same way', async () => {
    const seen: ReturnType<typeof cookieAttributes>[] = [];
    const jar = cookieFetch(ORIGIN);
    const b = h.browser({
      fetch: async (input, init) => {
        const res = await jar(input, init);
        for (const header of res.headers.getSetCookie()) if (header.startsWith(`${cookieName(true)}=`)) seen.push(cookieAttributes(header));
        return res;
      }
    });
    await b.api.auth.signIn('sso', { email: unique('cookie') });
    expect(seen.at(-1)).toEqual({ secure: true, httpOnly: true, sameSiteStrict: true, pathRoot: true, removed: false });
    await b.api.auth.signOut();
    expect(seen.at(-1)).toMatchObject({ secure: true, pathRoot: true, removed: true });
    expect(await b.api.auth.getSession()).toBeNull();

    // A session that ended on the server is cleared from the browser on its next request.
    const { session } = await b.api.auth.signIn('sso', { email: unique('cookie') });
    await h.pool.query('DELETE FROM sessions WHERE owner_id = $1', [session.ownerId]);
    expect((await b.fetch(`${h.baseUrl}/v1/meetings`)).status).toBe(401);
    expect(seen.at(-1)).toMatchObject({ secure: true, pathRoot: true, removed: true });
  });

  it('signs in with single sign-on as whoever’s work email was typed, but never at an address someone could own', async () => {
    const r = await h.browser().api.auth.signIn('sso', { email: '  Dana.Wu@Harbourline.example ' });
    expect(r).toMatchObject({ isNew: true, session: { provider: 'sso', user: { name: 'Dana Wu', email: 'dana.wu@harbourline.example' } } });
    expect(r.session.user.photoUrl).toBeUndefined();
    expect(r.session.user.portrait).toBeDefined();
    const back = await h.browser().api.auth.signIn('sso', { email: 'dana.wu@harbourline.example' });
    expect([back.isNew, back.session.ownerId]).toEqual([false, r.session.ownerId]);
    expect(code(await h.browser().api.auth.signIn('sso').catch((e: unknown) => e))).toBe('invalid');
    expect(code(await h.browser().api.auth.signIn('sso', { email: 'not-an-email' }).catch((e: unknown) => e))).toBe('invalid');
    // Nothing checks the address, so a real person's can't be claimed (and with it the notes shared with them).
    for (const email of ['dana.wu@harbourline.co', 'someone@gmail.com', 'x@example.com.attacker.io']) {
      expect(code(await h.browser().api.auth.signIn('sso', { email }).catch((e: unknown) => e)), email).toBe('invalid');
    }
    // The demo company's addresses still work, so a demo has colleagues to share with.
    expect((await h.browser().api.auth.signIn('sso', { email: 'theo@vandelay.industries' })).session.user.email).toBe('theo@vandelay.industries');
  });

  it('keeps sessions across a restart and refuses a cookie after sign-out', async () => {
    const cookies: string[] = [];
    const jar = cookieFetch(ORIGIN);
    const tap: typeof fetch = async (input, init) => {
      const res = await jar(input, init);
      const m = new RegExp(`${cookieName(true)}=([^;]+)`).exec(res.headers.get('set-cookie') ?? '');
      if (m?.[1]) cookies.push(m[1]);
      return res;
    };
    const b = h.browser({ fetch: tap });
    const { session } = await b.api.auth.signIn('sso', { email: unique('restart') });
    // Another API process on the same database knows the session: nothing lives only in memory.
    const second = await h.secondServer();
    expect(SessionReply.parse(await (await tap(`${second.baseUrl}/v1/session`)).json()).ownerId).toBe(session.ownerId);
    await second.close();

    await b.api.auth.signOut();
    expect(cookies[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const replay = await fetch(`${h.baseUrl}/v1/meetings`, { headers: { cookie: `${cookieName(true)}=${cookies[0] ?? ''}`, origin: ORIGIN } });
    expect(replay.status).toBe(401);
  });

  it('refuses state changes from other origins and non-JSON bodies', async () => {
    const { fetch } = await account();
    const evil = await fetch(`${h.baseUrl}/v1/calls`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:4000' }, body: '{}' });
    expect(evil.status).toBe(403);
    const plain = await fetch(`${h.baseUrl}/v1/calls`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(plain.status).toBe(400);
  });

  it('preferences start with defaults and keep every field', async () => {
    const { api, fetch } = await account();
    const patchRaw = async (body: unknown) => (await fetch(`${h.baseUrl}/v1/account/preferences`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) })).status;
    const defaults = {
      notesDefault: 'on', notesLanguage: 'call', summaryLength: 'short', addToCalendar: true, showOtherMeetings: true, recordOffline: true,
      notifications: { beforeCall: 5, notesReady: true, sharedWithYou: true, notesRequested: true, followUpDue: false },
      pinned: [], groups: []
    };
    expect(await api.account.preferences()).toEqual(defaults);
    const patched = await api.account.updatePreferences({
      summaryLength: 'detailed',
      notifications: { beforeCall: 1, notesReady: true, sharedWithYou: true, notesRequested: true, followUpDue: false }
    });
    expect(patched).toEqual({ ...defaults, summaryLength: 'detailed', notifications: { ...defaults.notifications, beforeCall: 1 } });
    expect(await api.account.preferences()).toEqual(patched);
    const grouped = await api.account.updatePreferences({ groups: [{ id: 'g1', name: 'Design', emails: ['sam@example.com'] }] });
    expect(grouped.groups).toHaveLength(1);
    expect(await patchRaw({ notesLanguage: 'xx' })).toBe(400);
    expect(await patchRaw({ pinned: ['a', 'a'] })).toBe(400);
    expect(await api.account.preferences()).toEqual(grouped);
  });

  it('keeps the notes default, and new calls start with it', async () => {
    const { api } = await account();
    expect((await api.account.preferences()).notesDefault).toBe('on');
    expect((await api.account.updatePreferences({ notesDefault: 'off' })).notesDefault).toBe('off');
    const call = await api.calls.join((await api.calls.startNow()).code, { mic: true, cam: false });
    expect(call.getSnapshot().capture.mode).toBe('off');
    await call.leave();
  });
});

describe('signing in with Google', () => {

  it('shows guests in a call no profile photos, since photos only load signed in', async () => {
    const b = h.browser();
    const n = Date.now().toString(36);
    const ana: GoogleUser = { sub: `photo-host-${n}`, email: `ana.${n}@example.com`, name: 'Ana Ortiz', picture: `${h.google.issuer}/photo/ana-${n}` };
    expect(landed(await viaGoogle(b, ana))).toBe('/ready');
    const host = await b.api.calls.join((await b.api.calls.startNow({})).code, { mic: true, cam: false });
    expect(host.getSnapshot().participants[0]?.person.photoUrl?.startsWith(`${h.baseUrl}/v1/photos/`)).toBe(true);
    const guest = await h.browser().api.calls.join(host.getSnapshot().code, { mic: true, cam: false, name: 'Sam' });
    await settle(host, (x) => x.waiting.length === 1);
    await host.admit(guest.ticket.identity);
    const seen = await settle(guest, (x) => x.participants.length === 2);
    expect(seen.participants.find((p) => p.isOrganizer)?.person).toMatchObject({ name: 'Ana Ortiz' });
    expect(seen.participants.find((p) => p.isOrganizer)?.person.photoUrl).toBeUndefined();
    await host.leave();
  });
  it('goes to Google and back, believes only what Google signed, and keeps one account per Google account', async () => {
    // Off to Google with a fresh state, nonce and PKCE challenge, asking for identity and calendar events.
    const b = h.browser();
    const start = await b.fetch(`${h.baseUrl}/v1/auth/google`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get('location') ?? '');
    expect(to.origin).toBe(h.google.issuer);
    expect(Object.fromEntries(to.searchParams)).toMatchObject({
      client_id: h.google.clientId, redirect_uri: `${h.baseUrl}/v1/auth/google/callback`, response_type: 'code',
      scope: 'openid email profile https://www.googleapis.com/auth/calendar.events', access_type: 'offline', code_challenge_method: 'S256'
    });
    for (const k of ['state', 'nonce', 'code_challenge']) expect(to.searchParams.get(k)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(start.headers.get('set-cookie')).toMatch(/^__Host-alcove_google=[^;]+;.*HttpOnly.*SameSite=Lax/i);

    // Someone invites Ben to a call with notes before he has ever used Alcove.
    const ben: GoogleUser = { sub: '104412233445566778899', email: 'Ben.Kay@Example.com', name: 'Ben Kay', picture: `${h.google.issuer}/photo/ben-1` };
    const host = await account();
    const call = await host.api.calls.join((await host.api.calls.startNow({ notes: 'on', guests: ['ben.kay@example.com'] })).code, { mic: true, cam: false });
    await call.appendAudio(piece(audioBytes('for-ben'), 0, 0));
    const noteId = call.getSnapshot().notes.noteId ?? '';
    await call.leave();

    // His first sign-in creates his account from what Google verified, and lands on the welcome step.
    expect(landed(await viaGoogle(b, ben))).toBe('/ready');
    const s = await b.api.auth.getSession();
    expect(s).toMatchObject({ provider: 'google', sample: false, user: { name: 'Ben Kay', email: 'ben.kay@example.com' } });
    // The photo comes from Alcove, not from Google: an opaque URL on the API that only works signed in.
    const photo = s?.user.photoUrl ?? '';
    expect(photo.startsWith(`${h.baseUrl}/v1/photos/`)).toBe(true);
    expect(photo).not.toContain('ben-1');
    const fetchesBefore = h.google.photoFetches();
    const got = await b.fetch(photo);
    expect([got.status, got.headers.get('content-type')]).toEqual([200, 'image/png']);
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    await b.fetch(photo); // served from memory the second time
    expect(h.google.photoFetches() - fetchesBefore).toBe(1);
    expect((await h.browser().fetch(photo)).status).toBe(401);
    expect((await b.fetch(`${photo.slice(0, -4)}AAAA`)).status).toBe(404);
    // A real account starts with no sample calls and no sample directory: its calendar is Google's.
    expect(await b.api.meetings.upcoming()).toEqual([]);
    expect(await b.api.people.team()).toEqual({ name: 'Example', domain: 'example.com', members: [] });
    // The notes he was invited to are his, because Google verified that address.
    expect((await b.api.notes.list()).map((n) => n.id)).toContain(noteId);

    // Again, in another browser: the same account, straight to Home, with the photo Google has now.
    const later = h.browser();
    expect(landed(await viaGoogle(later, { ...ben, picture: `${h.google.issuer}/photo/ben-2` }))).toBe('/home');
    const again = await later.api.auth.getSession();
    expect(again?.ownerId).toBe(s?.ownerId);
    // A new photo at Google is a new URL here too, and still never Google's own.
    expect([again?.user.photoUrl === photo, again?.user.photoUrl?.startsWith(`${h.baseUrl}/v1/photos/`)]).toEqual([false, true]);
  });

  it('turns away a cancelled, stale, forged or replayed sign-in, and signs nobody in', async () => {
    const who: GoogleUser = { sub: 'g-turned-away', email: 'turned.away@example.com', name: 'Turned Away' };
    const attempt = async (o: Parameters<typeof viaGoogle>[2] = {}, user = who) => {
      const b = h.browser();
      const end = landed(await viaGoogle(b, user, o));
      return [end, await (o.deliverIn ?? b).api.auth.getSession()];
    };
    expect(await attempt({ spoil: 'deny' })).toEqual(['/welcome?signin=cancelled', null]);
    expect(await attempt({ tamper: (u) => u.searchParams.set('state', 'forged-state') })).toEqual(['/welcome?signin=expired', null]);
    // A callback delivered in a browser that never started it: someone trying to sign a victim into their own account.
    expect(await attempt({ deliverIn: h.browser() })).toEqual(['/welcome?signin=expired', null]);
    expect(await attempt({ spoil: 'wrong-audience' })).toEqual(['/welcome?signin=failed', null]);
    expect(await attempt({ spoil: 'wrong-nonce' })).toEqual(['/welcome?signin=failed', null]);
    expect(await attempt({ spoil: 'expired' })).toEqual(['/welcome?signin=failed', null]);
    // An address Google hasn't verified could receive someone else's notes, so it isn't accepted.
    expect(await attempt({}, { ...who, emailVerified: false })).toEqual(['/welcome?signin=unverified', null]);

    // A code is good once: replaying it with a fresh attempt fails at Google.
    const b = h.browser();
    let code = '';
    expect(landed(await viaGoogle(b, who, { tamper: (u) => { code = u.searchParams.get('code') ?? ''; } }))).toBe('/ready');
    const again = h.browser();
    expect(landed(await viaGoogle(again, who, { tamper: (u) => u.searchParams.set('code', code) }))).toBe('/welcome?signin=failed');
    expect(await again.api.auth.getSession()).toBeNull();

    // The demo sign-in doesn't speak for Google.
    const fake = await b.fetch(`${h.baseUrl}/v1/auth/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'google' }) });
    expect(fake.status).toBe(400);
  });

  it('says Google sign-in isn’t set up on a server without a Google client', async () => {
    const bare = await h.secondServer({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
    const res = await fetch(`${bare.baseUrl}/v1/auth/google`, { redirect: 'manual' });
    expect(res.headers.get('location')).toBe(`${ORIGIN}/welcome?signin=unavailable`);
    await bare.close();
  });
});

describe('Google Calendar', () => {
  const at = (days: number, hour: number, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
  const person = (n: string): GoogleUser => ({ sub: `g-cal-${n}-${seq++}`, email: `${n}.${seq}@calendar.example`, name: `Cal ${n}` });

  it('shows the coming week’s meetings beside Alcove’s calls, and leaves out what isn’t a call', async () => {
    const ana = person('ana');
    const self = { email: ana.email, self: true };
    h.google.calendar(ana.sub).push(
      { id: 'design', summary: 'Design sync', start: { dateTime: at(1, 10) }, end: { dateTime: at(1, 10, 30) }, hangoutLink: 'https://meet.google.com/abc-defg-hij',
        organizer: { email: 'lead@calendar.example', displayName: 'Lead Person' }, attendees: [self, { email: 'lead@calendar.example' }, { email: 'kim@calendar.example', displayName: 'Kim Park' }] },
      { id: 'one-on-one', summary: '1:1 with Kim', start: { dateTime: at(2, 9) }, end: { dateTime: at(2, 9, 30) }, location: 'https://us02web.zoom.us/j/123456789',
        organizer: { email: ana.email, self: true }, attendees: [self, { email: 'kim@calendar.example' }] },
      { id: 'offsite', summary: 'Offsite', start: { date: at(3, 0).slice(0, 10) }, end: { date: at(4, 0).slice(0, 10) } },
      { id: 'declined', summary: 'Not going', start: { dateTime: at(1, 15) }, end: { dateTime: at(1, 16) }, attendees: [{ ...self, responseStatus: 'declined' }] },
      { id: 'focus', summary: 'Focus', eventType: 'focusTime', start: { dateTime: at(1, 12) }, end: { dateTime: at(1, 13) } },
      { id: 'alcove', summary: 'Already an Alcove call', start: { dateTime: at(1, 17) }, end: { dateTime: at(1, 17, 30) }, extendedProperties: { private: { alcoveMeeting: 'x' } } },
      { id: 'far', summary: 'Next month', start: { dateTime: at(20, 10) }, end: { dateTime: at(20, 11) } }
    );
    const b = h.browser();
    expect(landed(await viaGoogle(b, ana))).toBe('/ready');
    const cal = await b.api.calendar.get();
    expect([cal.source, cal.needsAccess]).toEqual(['google', false]);
    expect(cal.events.map((e) => [e.title, e.isOrganizer, e.join?.label])).toEqual([['Design sync', false, 'Google Meet'], ['1:1 with Kim', true, 'Zoom']]);
    expect(cal.events[0]).toMatchObject({ organizer: { name: 'Lead Person' }, guests: [{ name: 'Kim Park' }], join: { url: 'https://meet.google.com/abc-defg-hij' } });
  });

  it('puts scheduled calls on the calendar, so Google invites everyone, and keeps the event in step', async () => {
    const ben = person('ben');
    const b = h.browser();
    await viaGoogle(b, ben);
    const calls = () => h.google.calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.sendUpdates]);
    const before = h.google.calls.length;

    const m = await b.api.meetings.create({ title: 'Pricing review', startsAt: at(1, 14), durationMinutes: 45, guests: ['priya@example.com', 'kofi@example.com'], notes: 'on' });
    expect(m.calendarUrl).toMatch(/^https:\/\/calendar\.google\.com\//);
    const [event] = h.google.calendar(ben.sub);
    expect(event).toMatchObject({
      summary: 'Pricing review', location: `${ORIGIN}/join/${m.code}`, attendees: [{ email: 'priya@example.com' }, { email: 'kofi@example.com' }],
      start: { dateTime: m.startsAt }, end: { dateTime: m.endsAt }, extendedProperties: { private: { alcoveMeeting: m.id } }
    });
    expect(event?.description).toContain(`${ORIGIN}/join/${m.code}`);
    expect(event?.description).toContain('Notes are on');

    // Changes go to everyone through the calendar.
    const moved = await b.api.meetings.update(m.id, { startsAt: at(1, 16), durationMinutes: 30, guests: ['priya@example.com'], notes: 'off' });
    expect(h.google.calendar(ben.sub)[0]).toMatchObject({ start: { dateTime: moved.startsAt }, attendees: [{ email: 'priya@example.com' }] });
    expect(h.google.calendar(ben.sub)[0]?.description).not.toContain('Notes are on');
    // Alcove's own calls aren't listed twice.
    expect((await b.api.calendar.get()).events).toEqual([]);

    await b.api.meetings.cancel(m.id);
    expect(h.google.calendar(ben.sub)).toEqual([]);
    expect(h.google.calls.slice(before).filter((c) => c.method !== 'GET').map((c) => [c.method, c.sendUpdates])).toEqual([['POST', 'all'], ['PATCH', 'all'], ['DELETE', 'all']]);
    expect(calls().length).toBeGreaterThanOrEqual(3);
  });

  it('makes an organizer’s own event an Alcove call, once, and only theirs', async () => {
    const cleo = person('cleo');
    h.google.calendar(cleo.sub).push(
      { id: 'mine', summary: 'Hiring sync', description: 'Agenda: two candidates.', start: { dateTime: at(1, 11) }, end: { dateTime: at(1, 11, 45) }, htmlLink: 'https://calendar.google.com/calendar/event?eid=mine',
        organizer: { email: cleo.email, self: true }, attendees: [{ email: cleo.email, self: true }, { email: 'sam@example.com' }, { email: 'room-4@resource.calendar.google.com', resource: true }] },
      { id: 'theirs', summary: 'Their standup', start: { dateTime: at(1, 9) }, end: { dateTime: at(1, 9, 15) }, organizer: { email: 'boss@example.com' }, attendees: [{ email: cleo.email, self: true }] }
    );
    const b = h.browser();
    await viaGoogle(b, cleo);
    const m = await b.api.calendar.adopt('mine', 'on');
    expect(m).toMatchObject({ title: 'Hiring sync', notes: 'on', guests: [{ email: 'sam@example.com' }], calendarUrl: 'https://calendar.google.com/calendar/event?eid=mine' });
    expect(m.startsAt).toBe(new Date(at(1, 11)).toISOString());
    const event = h.google.calendar(cleo.sub).find((e) => e.id === 'mine');
    expect(event).toMatchObject({ location: `${ORIGIN}/join/${m.code}`, extendedProperties: { private: { alcoveMeeting: m.id } } });
    expect(event?.description).toContain('Agenda: two candidates.');
    expect((await b.api.meetings.upcoming()).map((x) => x.id)).toContain(m.id);
    expect((await b.api.calendar.get()).events.map((e) => e.id)).toEqual(['theirs']);
    expect((await b.api.calendar.adopt('mine')).id).toBe(m.id);
    expect(code(await b.api.calendar.adopt('theirs').catch((e: unknown) => e))).toBe('forbidden');
  });

  it('with addToCalendar off, scheduled calls stay off Google Calendar', async () => {
    const fay = person('fay');
    const b = h.browser();
    await viaGoogle(b, fay);
    await b.api.account.updatePreferences({ addToCalendar: false });
    const before = h.google.calls.filter((c) => c.method !== 'GET').length;
    const m = await b.api.meetings.create({ title: 'Just us', startsAt: at(1, 9), durationMinutes: 30, guests: ['kim@example.com'], notes: 'on' });
    expect(m.calendarUrl).toBeUndefined();
    await b.api.meetings.update(m.id, { title: 'Just us, moved', startsAt: at(1, 10) });
    await b.api.meetings.cancel(m.id);
    expect(h.google.calendar(fay.sub)).toEqual([]);
    expect(h.google.calls.filter((c) => c.method !== 'GET')).toHaveLength(before);
    // The calendar stays connected, for reading.
    expect((await b.api.calendar.get()).needsAccess).toBe(false);

    // Turning it back on puts new calls on the calendar again.
    await b.api.account.updatePreferences({ addToCalendar: true });
    expect((await b.api.meetings.create({ title: 'On the calendar', startsAt: at(1, 9), durationMinutes: 30, guests: [], notes: 'off' })).calendarUrl).toMatch(/^https:/);
    expect(h.google.calendar(fay.sub)).toHaveLength(1);
  });

  it('disconnecting forgets the calendar', async () => {
    const gus = person('gus');
    const tokensBefore = h.google.refreshTokens();
    const b = h.browser();
    await viaGoogle(b, gus);
    const ownerId = (await b.api.auth.getSession())?.ownerId;
    const kept = await b.api.meetings.create({ title: 'Already on it', startsAt: at(1, 9), durationMinutes: 30, guests: [], notes: 'off' });
    const token = h.google.refreshTokens().filter((t) => !tokensBefore.includes(t));
    expect(token).toHaveLength(1);
    const connections = async () => (await h.pool.query("SELECT count(*)::int AS n FROM items WHERE owner_id = $1 AND kind = 'connection'", [ownerId])).rows[0]?.n;
    expect(await connections()).toBe(1);

    expect(h.google.revocations()).not.toContain(token[0]);
    expect(await b.api.calendar.disconnect()).toEqual({ source: 'google', needsAccess: true, events: [] });
    // Alcove's grant is revoked at Google, with the token that was stored.
    expect(h.google.revocations()).toEqual(expect.arrayContaining(token));
    expect(token.filter((t) => h.google.honours(t))).toEqual([]);
    // Physically gone: no row, no revision, nothing flagged.
    expect(await connections()).toBe(0);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM items WHERE owner_id = $1 AND deleted_at IS NOT NULL', [ownerId])).rows[0]?.n).toBe(0);
    expect(await b.api.calendar.get()).toEqual({ source: 'google', needsAccess: true, events: [] });

    // Scheduling, changing and cancelling no longer touch Google.
    const calls = h.google.calls.length;
    const m = await b.api.meetings.create({ title: 'Local now', startsAt: at(1, 11), durationMinutes: 30, guests: [], notes: 'off' });
    expect(m.calendarUrl).toBeUndefined();
    await b.api.meetings.update(kept.id, { title: 'Renamed' });
    await b.api.meetings.cancel(kept.id);
    expect(h.google.calls).toHaveLength(calls);

    // Disconnecting again is fine, and the person can connect again.
    expect((await b.api.calendar.disconnect()).needsAccess).toBe(true);
    expect(landed(await viaGoogle(b, gus, { consent: true }))).toBe('/home');
    expect((await b.api.calendar.get()).needsAccess).toBe(false);
    expect(await connections()).toBe(1);
  });

  it('keeps working after the access token expires, asks again when Google forgot, and says when access is gone', async () => {
    // Google remembered an earlier yes and sends no refresh token: Alcove asks once more, then lands where it was going.
    const dee = person('dee');
    h.google.preconsent(dee.sub);
    const b = h.browser();
    expect(landed(await viaGoogle(b, dee))).toBe('/ready');
    h.google.expireAccess();
    expect((await b.api.calendar.get()).source).toBe('google');
    await b.api.meetings.create({ title: 'After an hour', startsAt: at(1, 9), durationMinutes: 30, guests: [], notes: 'off' });
    expect(h.google.calendar(dee.sub)).toHaveLength(1);

    // Someone who unticks calendar access still signs in; the app can ask for it, and calls stay in Alcove.
    const eli = person('eli');
    const e = h.browser();
    expect(landed(await viaGoogle(e, eli, { spoil: 'no-calendar' }))).toBe('/ready');
    expect(await e.api.calendar.get()).toEqual({ source: 'google', needsAccess: true, events: [] });
    expect((await e.api.meetings.create({ title: 'Local only', startsAt: at(1, 9), durationMinutes: 30, guests: [], notes: 'off' })).calendarUrl).toBeUndefined();
    expect(e.api.calendar.connectUrl()).toBe(`${h.baseUrl}/v1/auth/google?consent=1`);
    expect(landed(await viaGoogle(e, eli, { consent: true }))).toBe('/home');
    expect((await e.api.calendar.get()).needsAccess).toBe(false);

    // Access withdrawn at Google: the next read says so instead of failing.
    h.google.revoke(dee.sub);
    expect(await b.api.calendar.get()).toEqual({ source: 'google', needsAccess: true, events: [] });

    // Demo accounts have their sample day instead.
    expect((await (await account()).api.calendar.get()).source).toBe('sample');
  });

  it('opens none of the calls to read a calendar until Google has answered with an event that repeats', async () => {
    // A demo account has sample calls and no Google Calendar: reading its calendar opens its profile, and nothing else.
    const demo = await account();
    expect((await demo.api.meetings.upcoming()).length).toBeGreaterThan(1);
    const requestId = `calendar-read-${Date.now().toString(36)}${(seq++).toString(36)}`;
    const res = await demo.fetch(`${h.baseUrl}/v1/calendar`, { headers: { [REQUEST_ID_HEADER]: requestId } });
    expect(await res.json()).toEqual({ source: 'sample', needsAccess: false, events: [] });
    // Each sealed item the request read, by how many came back: the one profile.
    const opened = linesFor(requestId).flatMap((l) => (typeof l['sql'] === 'string' && l['sql'].startsWith('SELECT i.item_id') ? [l['rows']] : []));
    expect(opened).toEqual([1]);
  });
});

describe('people and team', () => {
  it('suggests colleagues and people from calls, and anyone typed in full', async () => {
    const art = h.browser();
    await art.api.auth.signIn('microsoft');
    const everyone = await art.api.people.search('');
    expect(everyone.map((s) => s.person.email)).toEqual(expect.arrayContaining(['theo@vandelay.industries', 'priya@lumen.health']));
    expect(everyone.find((s) => s.person.email === 'theo@vandelay.industries')).toMatchObject({ source: 'team', onAlcove: true, person: { name: 'Theo Martin' } });
    expect(everyone.some((s) => s.person.email === 'art@vandelay.industries')).toBe(false);
    expect((await art.api.people.search('pri')).map((s) => s.person.name)).toEqual(['Priya Raman']);
    expect((await art.api.people.search('INÈS')).map((s) => s.person.email)).toEqual(['ines@lumen.health']);
    expect(await art.api.people.search('jamie@harbourline.co')).toEqual([expect.objectContaining({ source: 'new', onAlcove: false, person: expect.objectContaining({ email: 'jamie@harbourline.co' }) })]);

    // An address that belongs to an Alcove account says so.
    await account('jordan.lee@harbourline.example');
    expect((await art.api.people.search('jordan.lee@harbourline.example'))[0]).toMatchObject({ source: 'new', onAlcove: true });
  });

  it('shows the company directory and invites colleagues', async () => {
    const art = h.browser();
    await art.api.auth.signIn('microsoft');
    const team = await art.api.people.team();
    expect(team).toMatchObject({ name: 'Vandelay Industries', domain: 'vandelay.industries' });
    expect(team?.members.map((m) => [m.person.name, m.onAlcove, m.invited])).toEqual([['Theo Martin', true, false], ['Kofi Asante', true, false], ['Sam Ortiz', false, false], ['Lena Fischer', false, false]]);
    const after = await art.api.people.inviteToTeam(['sam@vandelay.industries', 'lena@vandelay.industries']);
    expect(after.members.filter((m) => m.invited).map((m) => m.person.name)).toEqual(['Sam Ortiz', 'Lena Fischer']);
    expect((await art.api.people.inviteToTeam([' SAM@Vandelay.Industries '])).members.find((m) => m.person.email === 'sam@vandelay.industries')?.invited).toBe(true);
    expect(code(await art.api.people.inviteToTeam(['someone@elsewhere.example']).catch((e: unknown) => e))).toBe('invalid');

    const outsider = await account();
    expect(await outsider.api.people.team()).toMatchObject({ domain: 'tests.example', members: [] });
    expect(code(await outsider.api.people.inviteToTeam(['sam@vandelay.industries']).catch((e: unknown) => e))).toBe('invalid');
  });

  it('reads a busy calendar newest first, so the recent colleagues are on the team', async () => {
    const me: GoogleUser = { sub: `g-team-busy-${seq++}`, email: `busy.${seq}@acme.example`, name: 'Busy Acme' };
    const day = 86_400_000;
    const busy = (id: string, at: number, who: string) => ({ id, summary: id, start: { dateTime: new Date(at).toISOString() }, end: { dateTime: new Date(at + 1_800_000).toISOString() }, attendees: [{ email: me.email, self: true }, { email: who }] });
    const events = Array.from({ length: 300 }, (_, i) => busy(`old-${i}`, Date.now() - 20 * day + i * 60_000, 'filler@acme.example'));
    h.google.calendar(me.sub).push(...events, busy('yesterday', Date.now() - day, 'late@acme.example'), busy('tomorrow', Date.now() + day, 'newest@acme.example'));
    const b = h.browser();
    await viaGoogle(b, me);
    expect((await b.api.people.team())?.members.map((m) => m.person.email).sort()).toEqual(['filler@acme.example', 'late@acme.example', 'newest@acme.example']);
  });

  it('gives the directory people titles', async () => {
    const art = h.browser();
    await art.api.auth.signIn('microsoft');
    const team = await art.api.people.team();
    expect(team?.members.every((m) => (m.title ?? '').length > 0)).toBe(true);
    expect(team?.members[0]).toMatchObject({ person: { name: 'Theo Martin' }, title: 'Engineering' });
  });

  it('makes a work account\'s team of the colleagues it has met, and personal addresses have none', async () => {
    const ann = { sub: `g-team-ann-${seq++}`, email: 'ann@acme.example', name: 'Ann Acme' };
    const me: GoogleUser = { sub: `g-team-me-${seq++}`, email: `me.${seq}@acme.example`, name: 'Me Acme' };
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    const earlier = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const later = new Date(Date.now() + 86_400_000 + 1_800_000).toISOString();
    h.google.calendar(me.sub).push(
      { id: 'past-sync', summary: 'Sync', start: { dateTime: earlier(10) }, end: { dateTime: earlier(10) }, organizer: { email: 'Cara@Acme.example' }, attendees: [{ email: me.email, self: true }, { email: 'cara@acme.example' }, { email: 'dan@other.example' }] },
      { id: 'soon', summary: 'Plan', start: { dateTime: soon }, end: { dateTime: later }, organizer: { email: me.email, self: true }, attendees: [{ email: me.email, self: true }, { email: 'ANN@acme.example' }, { email: 'room@acme.example', resource: true }] }
    );
    const b = h.browser();
    await viaGoogle(b, me);
    await b.api.meetings.create({ title: 'Call', startsAt: soon, durationMinutes: 30, guests: ['bob@other.example', 'eve@acme.example', me.email], notes: 'off' });
    const team = await b.api.people.team();
    expect(team).toMatchObject({ name: 'Acme', domain: 'acme.example' });
    expect(team?.members.map((m) => [m.person.email, m.onAlcove, m.invited]).sort()).toEqual([
      ['ann@acme.example', false, false], ['cara@acme.example', false, false], ['eve@acme.example', false, false]
    ]);

    // Once Ann signs in, she is on Alcove; inviting marks the invite, and only people on the team can be invited.
    await viaGoogle(h.browser(), ann);
    const after = await b.api.people.team();
    expect(after?.members.find((m) => m.person.email === 'ann@acme.example')).toMatchObject({ onAlcove: true, invited: false });
    const invited = await b.api.people.inviteToTeam(['cara@acme.example']);
    expect(invited.members.filter((m) => m.invited).map((m) => m.person.email)).toEqual(['cara@acme.example']);
    expect(code(await b.api.people.inviteToTeam(['bob@other.example']).catch((e: unknown) => e))).toBe('invalid');

    // Someone at a personal address has no team, and nobody else's colleagues leak across accounts.
    const gmail = h.browser();
    await viaGoogle(gmail, { sub: `g-team-gmail-${seq++}`, email: `someone.${seq}@gmail.com`, name: 'Some One' });
    await gmail.api.meetings.create({ title: 'Friends', startsAt: soon, durationMinutes: 30, guests: ['pal@gmail.com'], notes: 'off' });
    expect(await gmail.api.people.team()).toBeNull();
    expect(code(await gmail.api.people.inviteToTeam(['pal@gmail.com']).catch((e: unknown) => e))).toBe('invalid');
    const other = await account(`other.${seq++}@acme.example`);
    expect((await other.api.people.team())?.members).toEqual([]);
  });

  it('when the calendar can’t be read, makes the team of the people on Alcove calls, and logs why', async () => {
    const me: GoogleUser = { sub: `g-team-down-${seq++}`, email: `down.${seq}@acme.example`, name: 'Down Acme' };
    const day = 86_400_000;
    h.google.calendar(me.sub).push({ id: 'met', summary: 'Sync', start: { dateTime: new Date(Date.now() - day).toISOString() }, end: { dateTime: new Date(Date.now() - day + 1_800_000).toISOString() }, attendees: [{ email: me.email, self: true }, { email: 'cal@acme.example' }] });
    const b = h.browser();
    await viaGoogle(b, me);
    const ownerId = (await b.api.auth.getSession())?.ownerId;
    await b.api.meetings.create({ title: 'Call', startsAt: new Date(Date.now() + day).toISOString(), durationMinutes: 30, guests: ['eve@acme.example'], notes: 'off' });
    expect((await b.api.people.team())?.members.map((m) => m.person.email).sort()).toEqual(['cal@acme.example', 'eve@acme.example']);

    // Access withdrawn at Google: the calendar can't be read, so the team is who was on Alcove calls, and the
    // warning says what went wrong.
    h.google.revoke(me.sub);
    expect((await b.api.people.team())?.members.map((m) => m.person.email)).toEqual(['eve@acme.example']);
    expect(logLines().find((l) => l.msg === 'calendar colleagues unavailable' && l['ownerId'] === ownerId)).toMatchObject({ level: 40, events: 0, err: { type: 'UnavailableError', message: 'Google Calendar isn’t connected.' } });
  });
});

describe('meetings', () => {
  it('schedules with people invited by email, edits, changes notes and cancels', async () => {
    const { api, session } = await account();
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const m = await api.meetings.create({ title: 'Harbor kickoff', startsAt: start, durationMinutes: 30, guests: ['Ben@Harbor.health', 'sam@fastmail.com', 'ben@harbor.health', session.user.email], notes: 'on' });
    expect(m).toMatchObject({ title: 'Harbor kickoff', isOrganizer: true, status: 'scheduled', notes: 'on', organizer: { id: session.ownerId } });
    // Lower-cased, once each, and never the organizer.
    expect(m.guests.map((g) => g.email)).toEqual(['ben@harbor.health', 'sam@fastmail.com']);
    expect(m.code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect((await api.meetings.byCode(m.code))?.id).toBe(m.id);

    const edited = await api.meetings.update(m.id, { title: 'Harbor kickoff (moved)', durationMinutes: 45, guests: ['ben@harbor.health'], notes: 'off' });
    expect(edited).toMatchObject({ title: 'Harbor kickoff (moved)', notes: 'off' });
    expect((new Date(edited.endsAt).getTime() - new Date(edited.startsAt).getTime()) / 60_000).toBe(45);
    expect(edited.guests.map((g) => g.email)).toEqual(['ben@harbor.health']);
    expect(code(await api.meetings.update(m.id, { guests: ['not an address'] }).catch((e: unknown) => e))).toBe('invalid');

    await api.meetings.cancel(m.id);
    expect((await api.meetings.upcoming()).map((x) => x.id)).not.toContain(m.id);
    expect(await api.meetings.byCode(m.code)).toBeNull();
  });

  it('applies a retried mutation only once (operation IDs)', async () => {
    const { fetch } = await account();
    const body = JSON.stringify({ title: 'Once', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [], notes: 'off' });
    const send = (op: string, b = body) => fetch(`${h.baseUrl}/v1/meetings`, { method: 'POST', headers: { 'content-type': 'application/json', [OPERATION_HEADER]: op }, body: b });
    const op = Buffer.from(randomBytes(16)).toString('base64url');
    const first = await (await send(op)).json();
    const second = await (await send(op)).json();
    expect(second).toEqual(first);
    expect((await send(op, body.replace('Once', 'Twice'))).status).toBe(409);
  });
});

describe('calls with notes', () => {
  it('records encrypted audio while notes are on, across turning them off and on, and hands the recording to notes', async () => {
    const { api, fetch: own, session } = await account();
    const { code: callCode } = await api.calls.startNow({ notes: 'on', guests: ['priya@lumen.health'] });
    const call = await api.calls.join(callCode, { mic: true, cam: true });
    let s = call.getSnapshot();
    expect(s.title).toBe(`${firstName(session.user.name)}’s call`);
    expect(s.capture.mode).toBe('on');
    expect(s.notes.everOn).toBe(true);
    expect(s.notes.noteId).toBeTruthy();
    expect(s.isOrganizer).toBe(true);
    expect(s.participants).toEqual([expect.objectContaining({ isMe: true, isOrganizer: true })]);

    const seg0 = [audioBytes('CANARY-AUDIO-0'), audioBytes('CANARY-AUDIO-1')];
    await call.appendAudio(piece(seg0[0] ?? audioBytes(''), 0, 0));
    await call.appendAudio(piece(seg0[1] ?? audioBytes(''), 0, 1));
    await call.appendAudio(piece(seg0[1] ?? audioBytes(''), 0, 1)); // retry of the same piece is a no-op
    expect(call.getSnapshot().notes.recording).toEqual({ segment: 0, pieces: 2, seconds: 10 });

    call.setNotes(false);
    await settle(call, (x) => x.capture.mode === 'off');
    expect(code(await call.appendAudio(piece(audioBytes('x'), 0, 2)).catch((e: unknown) => e))).toBe('conflict');
    call.setNotes(true);
    s = await settle(call, (x) => x.capture.mode === 'on' && x.notes.recording.segment === 1);
    expect(s.notes.recording.segment).toBe(1);
    await call.appendAudio(piece(audioBytes('segment-one'), 1, 0));

    // Chat is end-to-end encrypted in the call's MLS group: this browser keeps what it sent.
    await call.sendChat('CANARY-CHAT agenda link');
    expect(call.crypto.getSnapshot().chat[0]?.text).toBe('CANARY-CHAT agenda link');
    s = call.getSnapshot();

    const end = await ended(call);
    expect(end.pendingNoteId).toBe(s.notes.noteId);
    const noteId = end.pendingNoteId ?? '';

    // Nothing was said, so there's nothing to write: the note is finished with its audio and no summary.
    expect((await written(api, noteId)).at(-1)?.ready).toBe(true);

    const note = await api.notes.get(noteId);
    expect(note).toMatchObject({ kind: 'call', status: 'ready', title: `${firstName(session.user.name)}’s call`, summary: '', transcript: [] });
    expect(note.audio.map((a) => [a.index, a.pieces])).toEqual([[0, 2], [1, 1]]);

    // The decrypted segment is exactly the concatenation of what was recorded, and only for this account.
    expect((await h.browser().fetch(api.notes.audioUrl(noteId, 0))).status).toBe(401);
    const mine = await own(api.notes.audioUrl(noteId, 0));
    expect(Buffer.from(await mine.arrayBuffer()).equals(Buffer.concat(seg0))).toBe(true);

    expect((await api.meetings.past())[0]).toMatchObject({ status: 'ended', noteId });
    expect((await api.notes.list()).map((n) => n.id)).toContain(noteId);
    expect(code(await asked(api, noteId, 'What happened?').catch((e: unknown) => e))).toBe('conflict');
  });

  it('joining the call again while notes are on records into a new segment, so the new recorder loses nothing', async () => {
    const { api, fetch: own } = await account();
    const { code: callCode } = await api.calls.startNow({ notes: 'on' });
    const first = await api.calls.join(callCode, { mic: true, cam: false });
    const before = [audioBytes('before-0'), audioBytes('before-1'), audioBytes('before-2')];
    for (const [seq, bytes] of before.entries()) await first.appendAudio(piece(bytes, 0, seq));
    // The page reloads and joins the same call again. Its new recorder counts from 0, by its own clock (a
    // few milliseconds off the old one's), in the segment the call is on now.
    const again = await api.calls.join(callCode, { mic: true, cam: false });
    const s = again.getSnapshot();
    expect(s).toMatchObject({ callId: first.getSnapshot().callId, capture: { mode: 'on' }, notes: { recording: { pieces: 3, seconds: 15 } } });
    const after = [audioBytes('after-0'), audioBytes('after-1'), audioBytes('after-2')];
    for (const [seq, bytes] of after.entries()) await again.appendAudio(piece(bytes, s.notes.recording.segment, seq, seq * 5.004));
    expect(again.getSnapshot().notes.recording).toEqual({ segment: 1, pieces: 6, seconds: 30 });
    // The old page's recorder, had it carried on, belongs to the earlier segment, and its connection was taken
    // over by the new one: the call takes nothing more from it.
    expect(code(await first.appendAudio(piece(audioBytes('old-page'), 0, 3)).catch((e: unknown) => e))).toBe('forbidden');

    const noteId = (await again.leave())?.pendingNoteId ?? '';
    await first.leave();
    await written(api, noteId);
    expect((await api.notes.get(noteId)).audio.map((a) => [a.index, a.pieces, a.seconds])).toEqual([[0, 3, 15], [1, 3, 15]]);
    const audio = async (segment: number) => Buffer.from(await (await own(api.notes.audioUrl(noteId, segment))).arrayBuffer());
    expect((await audio(0)).equals(Buffer.concat(before))).toBe(true);
    expect((await audio(1)).equals(Buffer.concat(after))).toBe(true);
  });

  it('joins a call without notes and leaves no note behind', async () => {
    const { api } = await account();
    const call = await api.calls.join((await api.calls.startNow({ notes: 'off' })).code, { mic: true, cam: false });
    expect(call.getSnapshot().capture.mode).toBe('off');
    expect((await ended(call)).pendingNoteId).toBeNull();
    expect(await api.notes.list()).toEqual([]);
  });

  it('keeps every owner’s calls, notes, audio and recordings out of reach of other accounts', async () => {
    const a = await account();
    const b = await account();
    const { code: c } = await a.api.calls.startNow();
    // Another account can only come in by the link, as a guest, once the organizer is there.
    expect(code(await b.api.calls.join(c, { mic: true, cam: true }).catch((e: unknown) => e))).toBe('conflict');
    const hosting = await a.api.calls.join(c, { mic: true, cam: true });
    expect((await b.api.calls.join(c, { mic: true, cam: true })).ticket.role).toBe('guest');
    await hosting.leave();
    expect(code(await a.api.calls.join('zzz-zzzz-zzz', { mic: true, cam: true }).catch((e: unknown) => e))).toBe('not-found');

    const rec = await a.api.recordings.start({ title: 'Mine' });
    const state = rec.getSnapshot();
    await rec.appendAudio(piece(audioBytes('private'), 0, 0));
    // Sending that same piece to someone else's recording finds nothing, though it's stored there. Nor
    // does a different one: no conflict gives away that anything is stored at that place.
    const resend = (atMs: string) => b.fetch(`${h.baseUrl}/v1/recordings/${state.id}/audio`, {
      method: 'POST', body: new Blob([audioBytes('private')]),
      headers: { 'content-type': 'audio/webm', 'x-alcove-segment': '0', 'x-alcove-seq': '0', 'x-alcove-at-ms': atMs, 'x-alcove-duration-ms': '5000' }
    });
    expect((await resend('0')).status).toBe(404);
    expect((await resend('7')).status).toBe(404);
    expect(code(await b.api.notes.get(state.noteId).catch((e: unknown) => e))).toBe('not-found');
    expect((await b.fetch(a.api.notes.audioUrl(state.noteId, 0))).status).toBe(404);
    const steal = await b.fetch(`${h.baseUrl}/v1/recordings/${state.id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(steal.status).toBe(404);
    expect(code(await b.api.meetings.get(state.noteId).catch((e: unknown) => e))).toBe('not-found');
  });
});

describe('live transcript and written notes', () => {
  it('transcribes what’s said while notes are on, and writes the notes when the call ends', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = `kofi@g${Date.now().toString(36)}${(seq++).toString(36)}.example`;
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [guestEmail] });
    const call = await org.api.calls.join(c, { mic: true, cam: false });
    const heardBefore = h.near.calls.filter((x) => x.path.endsWith('/audio/transcriptions')).length;
    await call.appendAudio(piece(audioBytes('seg0-a'), 0, 0));
    await call.appendAudio(piece(audioBytes('seg0-b'), 0, 1));

    await call.transcribe(speech('We agreed to move the launch to the 18th.', 0, 0), call.ticket.identity);
    expect(call.getSnapshot().transcript).toEqual([
      { id: expect.any(String), at: 0, text: 'We agreed to move the launch to the 18th.', speaker: { name: org.session.user.name, person: expect.objectContaining({ email: org.session.user.email }) } }
    ]);
    await call.transcribe(speech('We agreed to move the launch to the 18th.', 0, 0), call.ticket.identity); // a retry is kept once, and not transcribed again
    await call.transcribe(speech('', 0, 4), call.ticket.identity); // silence: what Whisper "hears" in it is dropped
    await call.transcribe(speech('Kofi will send the new screens by Wednesday. // Priya checks the numbers.', 0, 6), call.ticket.identity);
    expect(call.getSnapshot().transcript.map((l) => [l.at, l.text])).toEqual([
      [0, 'We agreed to move the launch to the 18th.'], [6, 'Kofi will send the new screens by Wednesday.'], [8, 'Priya checks the numbers.']
    ]);
    expect(h.near.calls.filter((x) => x.path.endsWith('/audio/transcriptions')).length - heardBefore).toBe(2 + 1);

    // Notes off: nothing more is transcribed. Back on, lines continue after the first segment's 10 seconds.
    call.setNotes(false);
    await settle(call, (x) => x.capture.mode === 'off');
    expect(code(await call.transcribe(speech('Off the record.', 0, 12), call.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    call.setNotes(true);
    await settle(call, (x) => x.capture.mode === 'on' && x.notes.recording.segment === 1);
    expect(code(await call.transcribe(speech('From before.', 0, 14), call.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    await call.transcribe(speech('That is everything for today.', 1, 0), call.ticket.identity);
    expect(call.getSnapshot().transcript.at(-1)).toMatchObject({ at: 10, text: 'That is everything for today.' });

    const noteId = (await ended(call)).pendingNoteId ?? '';
    const steps = await written(org.api, noteId);
    expect(steps.at(-1)).toMatchObject({ ready: true, steps: expect.arrayContaining([{ label: 'Transcript of 4 lines', done: true }, { label: 'Notes written', done: true }]) });
    const note = await org.api.notes.get(noteId);
    expect(note.status).toBe('ready');
    expect(note.transcript?.map((l) => l.text)).toEqual(['We agreed to move the launch to the 18th.', 'Kofi will send the new screens by Wednesday.', 'Priya checks the numbers.', 'That is everything for today.']);
    expect(note.summary).toBe('Heard 4 lines. It ended on: That is everything for today.');
    // What the notes heard is proposed, and follow-ups only suggest who: nobody is committed by the notes.
    expect(note.decisions).toEqual([{ id: expect.any(String), text: 'We agreed to move the launch to the 18th.', at: 0, state: 'proposed', changes: [] }]);
    expect(note.actions).toEqual([{
      id: expect.any(String), text: 'Send the new screens by Wednesday', owner: { name: 'Kofi', person: expect.objectContaining({ email: guestEmail }) },
      takenOn: false, due: 'Wednesday', at: 6, done: false, changes: []
    }]);
    expect(note.chapters.map((x) => x.at)).toEqual([0, 8]);
    expect(note.suggestedQuestions).toHaveLength(3);
    // Each model was verified first, on the dstack image NEAR AI's models boot, and the speech and the
    // transcript went sealed to its attested key, at its own endpoint.
    const measured = h.near.composes();
    const checked = { verifiedAt: expect.any(String), tdx: { status: 'UpToDate', quote: expect.stringMatching(/^[0-9a-f]{64}$/) }, os: 'dstack-nvidia-0.5.12', gpu: { count: 8, arch: 'HOPPER' }, gateway: { status: 'UpToDate', os: 'dstack-0.5.12', compose: measured.gateway } };
    expect(note.inference).toEqual([
      { model: 'openai/whisper-large-v3', task: 'transcript', key: h.near.keys().transcript, compose: measured.transcript, ...checked },
      { model: 'z-ai/glm-5.3-flash', task: 'notes', key: h.near.keys().notes, compose: measured.notes, ...checked }
    ]);
    expect(h.near.calls.filter((x) => x.encryption === 'none')).toEqual([]);
    // The notes model was sent the transcript with names, not anyone's address.
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toContain(`[00:06] ${org.session.user.name}: Kofi will send the new screens by Wednesday.`);
    expect(prompt).not.toContain(guestEmail);
    expect(prompt).not.toContain(org.session.user.email);

    // The live transcript moved into the note, the job is done, and the minutes recorded (not the call's length) were charged.
    expect((await h.pool.query('SELECT count(*)::int AS n FROM transcript_clips WHERE note_item_id = $1', [noteId])).rows[0]?.n).toBe(0);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM content_jobs WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.n).toBe(0);
    const credits = await org.api.credits.balance();
    expect(credits.balance).toBe(credits.granted - Math.max(1, Math.ceil(note.audio.reduce((n, a) => n + a.seconds, 0) / 60)) * credits.perMinute);

    // Anyone with the notes can ask about the call, and hear where the answer comes from.
    expect(await asked(org.api, noteId, 'When is the launch now?')).toEqual([{ type: 'text', text: 'From the call: We agreed to move the launch to the 18th.' }, { type: 'cite', noteId, at: 0 }]);
    const guest = await account(guestEmail);
    expect((await asked(guest.api, noteId, 'Who checks the numbers?'))[0]).toEqual({ type: 'text', text: 'From the call: Priya checks the numbers.' });
    expect(code(await asked((await account()).api, noteId, 'Anything?').catch((e: unknown) => e))).toBe('not-found');
  });

  it('sends each clip in the call’s language once its clips agree on it, and then with who’s in the call and the words said before', async () => {
    const org = await account(unique('organizer'));
    const guest = `priya.raman@l${Date.now().toString(36)}.example`;
    const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on', guests: [guest] })).code, { mic: true, cam: false });
    const names = `${org.session.user.name}, Priya Raman.`;
    const from = h.near.transcriptions.length;
    const sent = () => h.near.transcriptions.slice(from);
    const said = [
      'We should look at the launch plan first.', 'The beta went out to forty customers on Monday.', 'Most of them finished onboarding within a day.',
      'Kofi will send the new screens by Wednesday.', 'Priya checks the numbers before the board meeting.', 'The pricing page still needs a review.',
      'Support tickets went down by a third.', 'We agreed to keep the free tier.', 'Siobhan owns the migration plan now.'
    ];
    for (const [i, words] of said.entries()) await call.transcribe(speech(words, 0, i * 4), call.ticket.identity);
    // Until three clips agree on a language, Whisper picks it for each, from the sound alone.
    const unsure = { language: null, prompt: null };
    expect(sent().slice(0, 3)).toEqual([unsure, unsure, unsure]);
    // Then each clip goes in the call's language, with who's in the call and the words said before it.
    expect(sent()[3]).toEqual({ language: 'en', prompt: `${names} ${said.slice(0, 3).join(' ')}` });
    // As many of those words as fit, from the newest.
    const late = sent()[8]?.prompt ?? '';
    expect(late.startsWith(`${names} `) && late.endsWith(said[7] ?? '-')).toBe(true);
    expect(late).not.toContain(said[0]);
    expect(Buffer.byteLength(late.slice(names.length + 1))).toBeLessThanOrEqual(250);
    // A retried clip is still sent once.
    await call.transcribe(speech(said[0] ?? '', 0, 0), call.ticket.identity);
    expect(sent()).toHaveLength(9);

    // After six in the call's language, a clip too short to tell keeps it; the next long enough goes without it, and Whisper picks again.
    await call.transcribe(speech('Sounds good to me, thanks.', 0, 36, 3000), call.ticket.identity);
    expect(sent()[9]?.language).toBe('en');
    await call.transcribe(speech('Wir verschieben den Start auf Donnerstag.', 0, 40, 4000, 'de'), call.ticket.identity);
    expect(sent()[10]).toEqual(unsure);
    // Someone spoke another language: neither the language nor a prompt is sent until that clip is no longer among the newest.
    await call.transcribe(speech('Then we can tell the sales team on Friday.', 0, 44), call.ticket.identity);
    expect(sent()[11]).toEqual(unsure);
    expect(call.getSnapshot().transcript.map((l) => l.text)).toEqual([...said, 'Sounds good to me, thanks.', 'Wir verschieben den Start auf Donnerstag.', 'Then we can tell the sales team on Friday.']);
    await ended(call);

    // Each note has its own: another account's room recording starts from nothing, with its own people and words.
    const other = await account(unique('other'));
    const rec = await other.api.recordings.start({ title: 'Design crit' });
    const room = ['Sam will tidy the spacing by Friday.', 'The header stays dark for now.', 'Jo checks the icons on Monday.', 'Can we ship it on Friday?'];
    for (const [i, words] of room.entries()) await rec.transcribe(speech(words, 0, i * 4));
    expect(h.near.transcriptions.at(-1)).toEqual({ language: 'en', prompt: `${other.session.user.name}. ${room.slice(0, 3).join(' ')}` });
    // A short reply that says back what was just said is kept: people agree to things that way.
    await rec.transcribe(speech('Ship it on Friday.', 0, 16));
    expect(h.near.transcriptions.at(-1)?.prompt?.endsWith('Can we ship it on Friday?')).toBe(true);
    // What Whisper says back from its prompt instead of what it heard is dropped, and so is a sentence it says twice over.
    await rec.transcribe(speech('The header stays dark for now. Jo checks the icons on Monday.', 0, 20));
    await rec.transcribe(speech('We should test it on phones. // We should test it on phones.', 0, 24));
    await rec.transcribe(speech('Okay, that works. Can you share the link? Okay, that works. Can you share the link?', 0, 28));
    expect(rec.getSnapshot().transcript.map((l) => l.text)).toEqual([...room, 'Ship it on Friday.', 'We should test it on phones.', 'Okay, that works. Can you share the link?']);
    await rec.discard();
    // What a clip was sent with is sealed with it, and only whether a language was sent or found, and the prompt's size, are logged.
    expect(h.logs.join('')).not.toContain('Siobhan owns the migration plan');
  });

  it('drops the subtitle credits and closing lines Whisper invents in quiet, in its languages, and keeps sentences about the same things', async () => {
    const rec = await (await account(unique('captions'))).api.recordings.start({ title: 'Captions review' });
    const invented = [
      ["Sous-titrage ST' 501", 'fr'], ['Untertitel im Auftrag des ZDF, 2017', 'de'], ['Субтитры сделал DimaTorzok', 'ru'], ['字幕by索兰娅', 'zh'],
      ['자막 제공 및 광고를 포함하고 있습니다', 'ko'], ['Danke.', 'de'], ['Merci beaucoup.', 'fr'], ['감사합니다.', 'ko']
    ] as const;
    const real = [
      ['Les sous-titres en direct marchent bien maintenant.', 'fr'], ['Die Untertitel der Präsentation fehlen noch.', 'de'], ['Нам нужно добавить субтитры к видео.', 'ru'],
      ['我们需要给视频加字幕。', 'zh'], ['자막이 안 나와요.', 'ko'], ['Captions by default are off for guests.', 'en'], ['Danke, das hilft uns sehr.', 'de']
    ] as const;
    for (const [i, [words, language]] of [...invented, ...real].entries()) await rec.transcribe(speech(words, 0, i * 4, 4000, language));
    expect(rec.getSnapshot().transcript.map((l) => l.text)).toEqual(real.map(([words]) => words));
    await rec.discard();
  });

  it('sends no answer about notes that were deleted or removed while it was being written', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = unique('guest');
    const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on', guests: [guestEmail] })).code, { mic: true, cam: false });
    await call.transcribe(speech('We agreed to sell the old van. // The buyer pays on Monday.', 0, 0), call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const guest = await account(guestEmail);
    /** Asks while the notes model takes its time, and does `meanwhile` once the question has reached it. */
    const slowly = async (api: AlcoveApi, meanwhile: () => Promise<void>): Promise<unknown> => {
      const sent = h.near.prompts.length;
      h.near.slowNext(1500);
      const answer = asked(api, noteId, 'When does the buyer pay?').catch((e: unknown) => e);
      await until(async () => h.near.prompts.length > sent, 'the question to reach the notes model');
      await meanwhile();
      return answer;
    };
    const refusal = (e: unknown) => (e instanceof AlcoveApiError ? [e.code, e.message] : ['not-an-api-error', '']);
    const gone = ['conflict', 'These notes were deleted or removed from yours while the answer was being written, so it isn’t shown.'];
    // Someone it was given to removes it from their notes while their answer is being written; then the organizer deletes it while theirs is.
    expect(refusal(await slowly(guest.api, () => guest.api.notes.delete(noteId)))).toEqual(gone);
    expect(code(await asked(guest.api, noteId, 'When does the buyer pay?').catch((e: unknown) => e))).toBe('not-found');
    expect(refusal(await slowly(org.api, () => org.api.notes.delete(noteId)))).toEqual(gone);
    expect(h.logs.join('')).not.toContain('buyer pays');
  });

  it('catches someone up during a call, for them alone, with the moments each point comes from', async () => {
    const a = await account();
    const call = await a.api.calls.join((await a.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const id = call.getSnapshot().callId;
    await call.appendAudio(piece(audioBytes('catch-a'), 0, 0));
    // The server places speech by when it began: the first clip as the call starts, the second six seconds in.
    const heardAt = (s: number) => performance.now() - (Date.now() - (Date.parse(call.getSnapshot().startedAt) + s * 1000));
    await call.transcribe({ ...speech('We should move the launch. // Can we afford the delay?', 0, 0), heardAt: heardAt(0) }, call.ticket.identity);
    await new Promise((r) => setTimeout(r, 6200));
    await call.transcribe({ ...speech('We agreed to move the launch to the 18th. // Kofi will send the screens by Wednesday.', 0, 6), heardAt: heardAt(6) }, call.ticket.identity);
    const line = (text: string) => call.getSnapshot().transcript.find((l) => l.text === text)?.id ?? `missing: ${text}`;
    const moment = (text: string, said: number) => [{ kind: 'transcript', lineId: line(text), said: expect.closeTo(said, 0) }];
    const sent = h.near.calls.length;
    const c = await call.catchUp({ kind: 'all' });
    // It went sealed to the verified notes model, at its own endpoint, with each line numbered for it to point at.
    expect(h.near.calls.slice(sent).map((x) => [x.path, x.encryption])).toEqual([['/v1/chat/completions', 'ohttp']]);
    expect(h.near.prompts.at(-1)).toContain(`L3 [00:06] ${a.session.user.name}: We agreed to move the launch to the 18th.`);
    // Each point carries the line it came from. The model also claimed a decision it couldn't point to a line for,
    // and pointed at lines that aren't there: none of that is shown.
    expect(c).toMatchObject({
      summary: 'Catching up on 4 lines.',
      decided: [{ text: 'We agreed to move the launch to the 18th.', evidence: moment('We agreed to move the launch to the 18th.', 6) }],
      proposed: [{ text: 'We should move the launch.', evidence: moment('We should move the launch.', 0) }],
      open: [{ text: 'Can we afford the delay?', evidence: moment('Can we afford the delay?', 2) }],
      next: [{ text: 'Kofi will send the screens by Wednesday.', owner: 'Kofi', due: 'Wednesday', evidence: moment('Kofi will send the screens by Wednesday.', 8) }],
      read: { from: 0, lines: 4, through: expect.closeTo(8, 0), gaps: [], missed: [], whileHere: false }
    });
    expect(c.read.asOf).toBeGreaterThanOrEqual(0);

    // Asking about the call answers with the line the answer comes from.
    expect(await call.askSoFar('Who sends the screens?', { kind: 'all' })).toMatchObject({
      text: 'From the call: Kofi will send the screens by Wednesday.', evidence: moment('Kofi will send the screens by Wednesday.', 8), read: { lines: 4 }
    });
    // A stretch picked on the call's clock reads only what was said in it.
    expect(await call.catchUp({ kind: 'between', from: 1, to: 7 })).toMatchObject({
      read: { from: 1, to: 7, lines: 2 }, decided: [{ text: 'We agreed to move the launch to the 18th.' }], proposed: [], open: [{ text: 'Can we afford the delay?' }], next: []
    });
    // Opening a moment gives that line and what was said around it.
    const opened = await call.moment(line('We agreed to move the launch to the 18th.'));
    expect(opened.lineId).toBe(line('We agreed to move the launch to the 18th.'));
    expect(opened.lines.map((l) => l.text)).toEqual(['We should move the launch.', 'Can we afford the delay?', 'We agreed to move the launch to the 18th.', 'Kofi will send the screens by Wednesday.']);

    // While notes were off nothing was heard, and a catch-up says so.
    call.setNotes(false);
    await settle(call, (x) => x.capture.mode === 'off');
    await new Promise((r) => setTimeout(r, 1100));
    call.setNotes(true);
    await settle(call, (x) => x.capture.mode === 'on' && x.notes.recording.segment === 1);
    const gaps = (await call.catchUp({ kind: 'all' })).read.gaps;
    expect(gaps).toEqual([{ kind: 'off', from: expect.any(String), to: expect.any(String), at: 5 }]);
    expect(Date.parse(gaps[0]?.to ?? '') - Date.parse(gaps[0]?.from ?? '')).toBeGreaterThanOrEqual(1000);

    // Nobody else can catch up on this call, and nothing about it keeps a receipt.
    const b = await account();
    // Without this call's pass there's no way in.
    const steal = await b.fetch(`${h.baseUrl}/v1/live/calls/${id}/catch-up`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ range: { kind: 'all' } }) });
    expect(steal.status).toBe(401);
    expect((await h.pool.query("SELECT count(*)::int AS n FROM operations WHERE owner_id = $1 AND (method LIKE '%catch-up%' OR method LIKE '%/ask')", [a.session.ownerId])).rows[0]?.n).toBe(0);
    await call.leave();
    expect(code(await call.catchUp({ kind: 'all' }).catch((e: unknown) => e))).toBe('conflict');

    // A call that never had notes on has nothing to catch up on.
    const quiet = await a.api.calls.join((await a.api.calls.startNow({ notes: 'off' })).code, { mic: true, cam: false });
    expect(code(await quiet.catchUp({ kind: 'all' }).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await quiet.askSoFar('Anything?', { kind: 'all' }).catch((e: unknown) => e))).toBe('conflict');
    await quiet.leave();
  });

  it('transcribes a room recording without naming who spoke, and writes its notes when it stops', async () => {
    const b = await account();
    const { api } = b;
    const rec = await api.recordings.start({ title: 'Design crit' });
    await rec.appendAudio(piece(audioBytes('room-a'), 0, 0));
    await rec.transcribe(speech('Sam will tidy the spacing by Friday.', 0, 0));
    expect(rec.getSnapshot().transcript).toEqual([{ id: expect.any(String), at: 0, text: 'Sam will tidy the spacing by Friday.' }]);
    rec.pause();
    await settled(b, rec.getSnapshot().id, 'pause');
    expect(code(await rec.transcribe(speech('While paused.', 0, 4)).catch((e: unknown) => e))).toBe('conflict');
    rec.resume();
    await settled(b, rec.getSnapshot().id, 'resume');
    await rec.transcribe(speech('We decided to keep the darker header.', 0, 4));
    const { pendingNoteId } = await rec.stop();
    expect((await rec.stop()).pendingNoteId).toBe(pendingNoteId); // stopping twice finishes it once
    await written(api, pendingNoteId);
    const note = await api.notes.get(pendingNoteId);
    expect(note).toMatchObject({ kind: 'room', status: 'ready', decisions: [{ text: 'We decided to keep the darker header.', at: 4, state: 'proposed' }] });
    expect(note.transcript?.map((l) => [l.at, l.text, l.speaker])).toEqual([[0, 'Sam will tidy the spacing by Friday.', undefined], [4, 'We decided to keep the darker header.', undefined]]);
    expect(note.actions).toEqual([{ id: expect.any(String), text: 'Tidy the spacing by Friday', owner: { name: 'Sam' }, takenOn: false, due: 'Friday', at: 0, done: false, changes: [] }]);
  });

  it('notes are written in the chosen language and length', async () => {
    const wrote = async (b: Awaited<ReturnType<typeof account>>, how: 'call' | 'room') => {
      const before = h.near.instructions.length;
      if (how === 'room') {
        const rec = await b.api.recordings.start({ title: 'Language check' });
        await rec.appendAudio(piece(audioBytes('lang-room'), 0, 0));
        await rec.transcribe(speech('Sam will tidy the spacing by Friday.', 0, 0));
        await written(b.api, (await rec.stop()).pendingNoteId);
      } else {
        const call = await b.api.calls.join((await b.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
        await call.transcribe(speech('We agreed to move the launch to the 18th.', 0, 0), call.ticket.identity);
        await written(b.api, (await call.leave())?.pendingNoteId ?? '');
      }
      return h.near.instructions.slice(before).filter((x) => x.startsWith('You write the notes'));
    };
    const standard = await account();
    expect(await wrote(standard, 'call')).toEqual([expect.stringContaining('Write in the language the call was held in.')]);
    expect((await wrote(standard, 'call'))[0]).toContain('summary: two or three plain sentences');

    const chosen = await account();
    await chosen.api.account.updatePreferences({ notesLanguage: 'es', summaryLength: 'detailed' });
    const [call] = await wrote(chosen, 'call');
    expect(call).toContain('Write in Spanish.');
    expect(call).toContain('summary: a short paragraph for each topic');
    expect(call).not.toContain('two or three plain sentences');
    // A room recording follows the person who recorded it.
    const [room] = await wrote(chosen, 'room');
    expect(room).toContain('Write in Spanish.');
    expect(room).toContain('a short paragraph for each topic');
    // Decisions, follow-ups and chapters are written the same way either way.
    expect(call).toContain('decisions: what the people agreed');
    // Someone else's choice doesn't reach a call they only joined: the organizer's decides.
    const guest = await account();
    await guest.api.account.updatePreferences({ notesLanguage: 'fr' });
    const shared = await chosen.api.calls.join((await chosen.api.calls.startNow({ notes: 'on', guests: [guest.session.user.email] })).code, { mic: true, cam: false });
    const before = h.near.instructions.length;
    await shared.transcribe(speech('We agreed to ship.', 0, 0), shared.ticket.identity);
    await written(chosen.api, (await shared.leave())?.pendingNoteId ?? '');
    const sent = h.near.instructions.slice(before).filter((x) => x.startsWith('You write the notes'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Write in Spanish.');
  });

  it('takes speech only as 16 kHz mono WAV, only while recording, and only into your own calls', async () => {
    const a = await account();
    const b = await account();
    const call = await a.api.calls.join((await a.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const id = call.getSnapshot().callId;
    // The organizer's browser sends the call's pass with everything about the call; nobody else has it.
    const post = (who: Browser, base: string, path: string, bytes: Uint8Array<ArrayBuffer>, o: { type?: string; ms?: string; speaker?: string; ago?: string | null } = {}) => who.fetch(`${base}/v1${path}`, {
      method: 'POST', body: new Blob([bytes]),
      headers: {
        'content-type': o.type ?? 'audio/wav', 'x-alcove-segment': '0', 'x-alcove-at-ms': '0', 'x-alcove-duration-ms': o.ms ?? '4000',
        ...(o.ago === null ? {} : { 'x-alcove-ago-ms': o.ago ?? '4000' }), ...(who === a ? { 'x-alcove-call': call.ticket.pass, 'x-alcove-speaker': o.speaker ?? call.ticket.identity } : {})
      }
    });
    const hello = () => speechWav('Hello there.');
    // A call's speech says when it began, so the call can place it where its speaker was then.
    expect((await post(a, h.baseUrl, `/live/calls/${id}/transcribe`, hello(), { ago: null })).status).toBe(400);
    expect((await post(a, h.baseUrl, `/live/calls/${id}/transcribe`, hello(), { ago: 'soon' })).status).toBe(400);
    expect((await post(a, h.baseUrl, `/live/calls/${id}/transcribe`, hello(), { ago: '900000' })).status).toBe(400);
    expect((await post(a, h.baseUrl, `/live/calls/${id}/transcribe`, hello(), { type: 'audio/webm' })).status).toBe(400);
    const stereo = hello(); new DataView(stereo.buffer).setUint16(22, 2, true);
    expect((await post(a, h.baseUrl, `/live/calls/${id}/transcribe`, stereo)).status).toBe(400);
    const cd = hello(); new DataView(cd.buffer).setUint32(24, 44_100, true);
    expect((await post(a, h.baseUrl, `/live/calls/${id}/transcribe`, cd)).status).toBe(400);
    expect((await post(a, h.baseUrl, `/live/calls/${id}/transcribe`, hello(), { ms: '45000' })).status).toBe(400);
    // A call's speech says whose it is.
    expect((await post(a, h.baseUrl, `/live/calls/${id}/transcribe`, hello(), { speaker: '' })).status).toBe(400);
    expect((await post(b, h.baseUrl, `/live/calls/${id}/transcribe`, hello())).status).toBe(401);
    const rec = await a.api.recordings.start({ title: 'Mine' });
    expect((await post(b, h.baseUrl, `/recordings/${rec.getSnapshot().id}/transcribe`, hello())).status).toBe(404);
    expect(code(await rec.transcribe(speech('Hello.', 1, 0)).catch((e: unknown) => e))).toBe('invalid');
    await rec.discard();
    // A server without NEAR AI keeps the recording but says the live transcript isn't available there.
    const plain = await h.secondServer({ NEAR_AI_API_KEY: undefined });
    try {
      expect((await post(a, plain.baseUrl, `/live/calls/${id}/transcribe`, hello())).status).toBe(503);
    } finally {
      await plain.close();
    }
    await call.leave();
    expect(code(await call.transcribe(speech('Too late.', 0, 0), call.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
  });

  it('deletes a note while its notes are still being written', async () => {
    const { api, session } = await account();
    h.near.slowNext(800);
    const rec = await api.recordings.start({ title: 'Gone quickly' });
    await rec.transcribe(speech('We agreed to delete this right away.', 0, 0));
    const { pendingNoteId } = await rec.stop();
    await until(async () => (await h.pool.query("SELECT 1 FROM content_jobs WHERE owner_id = $1 AND state = 'writing'", [session.ownerId])).rowCount === 1, 'the notes to start being written');
    await api.notes.delete(pendingNoteId);
    expect(code(await api.notes.get(pendingNoteId).catch((e: unknown) => e))).toBe('not-found');
    // The worker finds the note gone, drops its job and doesn't try again.
    await until(async () => (await h.pool.query('SELECT 1 FROM content_jobs WHERE owner_id = $1', [session.ownerId])).rowCount === 0, 'the job to be dropped');
    await new Promise((r) => setTimeout(r, 900));
    expect((await h.pool.query('SELECT count(*)::int AS n FROM items WHERE owner_id = $1 AND item_id = $2', [session.ownerId, pendingNoteId])).rows[0]?.n).toBe(0);
  });

  it('tries again when the notes model’s answer can’t be used, and keeps the transcript if it never can', async () => {
    const { maintain } = await import('./maintenance');
    const { api, session } = await account();
    const job = async () => (await h.pool.query<{ state: string; attempt: number }>('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [session.ownerId])).rows[0];
    const retryNow = async () => {
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [session.ownerId]);
      await maintain(h.deps);
    };

    // An answer in prose instead of notes: the next attempt writes them.
    h.near.failNext(1, 'prose');
    let rec = await api.recordings.start({ title: 'Retry' });
    await rec.transcribe(speech('We agreed to ship on Monday.', 0, 0));
    let { pendingNoteId } = await rec.stop();
    await until(async () => { const j = await job(); return j?.state === 'queued' && j.attempt === 1; }, 'the first attempt to fail');
    expect(await job()).toEqual({ state: 'queued', attempt: 1 });
    for await (const p of api.notes.progress(pendingNoteId)) { expect(p.steps.at(-1)).toEqual({ label: 'The notes service is busy. Trying again shortly', done: false }); break; }
    await retryNow();
    expect((await api.notes.get(pendingNoteId)).decisions.map((d) => d.text)).toEqual(['We agreed to ship on Monday.']);

    // Never a usable answer: after three attempts the note is finished without a summary, keeps its transcript, and
    // costs nothing. (A model that doesn't answer at all makes the note wait instead: see below.)
    const before = (await api.credits.balance()).balance;
    h.near.failNext(3, 'prose');
    rec = await api.recordings.start({ title: 'Never' });
    await rec.transcribe(speech('Nobody will read this summary.', 0, 0));
    ({ pendingNoteId } = await rec.stop());
    await until(async () => { const j = await job(); return j?.state === 'queued' && j.attempt === 1; }, 'the first attempt to fail');
    await retryNow();
    expect(await job()).toEqual({ state: 'queued', attempt: 2 });
    await retryNow();
    expect(await job()).toBeUndefined();
    const note = await api.notes.get(pendingNoteId);
    expect(note).toMatchObject({ status: 'ready', summary: '', decisions: [], actions: [], chapters: [] });
    expect(note.transcript?.map((l) => l.text)).toEqual(['Nobody will read this summary.']);
    expect((await api.credits.balance()).balance).toBe(before);
  });
});

describe('in the call: hands, spotlight, breakout rooms and captions', () => {
  /** Sends one call action straight to the API, with someone's call pass if they have one, and returns its status (the app's session turns refusals into notices). */
  const act = async (b: Browser, callId: string, action: unknown, pass?: string) => (await b.fetch(`${h.baseUrl}/v1/live/calls/${callId}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(pass ? { 'x-alcove-call': pass } : {}) }, body: JSON.stringify(action)
  })).status;

  it('raises a hand, spotlights only someone in the call, and keeps both to the organizer’s own call', async () => {
    const a = await account();
    const call = await a.api.calls.join((await a.api.calls.startNow()).code, { mic: true, cam: false });
    const s0 = call.getSnapshot();
    expect(s0).toMatchObject({ spotlight: null, breakouts: { open: null, held: [] }, isOrganizer: true });
    const me = s0.participants[0]?.id ?? '';
    call.setHand(true);
    call.setSpotlight(me);
    let s = await settle(call, (x) => x.participants[0]?.hand === true && x.spotlight === me && x.notices.length === 0);
    expect(s.participants[0]).toMatchObject({ hand: true, isOrganizer: true });
    expect(s.spotlight).toBe(me);
    // Nobody who isn't in the call can be spotlighted.
    expect(await act(a, s.callId, { type: 'spotlight', participantId: 'someone-else' }, call.ticket.pass)).toBe(400);
    call.setSpotlight(null);
    s = await settle(call, (x) => x.spotlight === null);
    expect(s.spotlight).toBeNull();
    // Someone without the call's pass can't do anything in it.
    const b = await account();
    expect(await act(b, s.callId, { type: 'spotlight', participantId: null })).toBe(401);
    expect(await act(b, s.callId, { type: 'hand', up: true })).toBe(401);
    expect(await act(b, s.callId, { type: 'rooms-open', rooms: [{ name: 'A', emails: [] }, { name: 'B', emails: [] }], minutes: 5 })).toBe(401);
    // A guest let in raises their own hand, which everyone sees; spotlight and rooms stay the organizer's.
    const guestTab = h.browser();
    const guest = await guestTab.api.calls.join(s.code, { mic: true, cam: false, name: 'Sam' });
    await settle(call, (x) => x.waiting.some((w) => w.id === guest.ticket.identity));
    await call.admit(guest.ticket.identity);
    for (let i = 0; i < 100 && guest.crypto.getSnapshot().status !== 'in'; i++) await new Promise((r) => setTimeout(r, 30));
    expect(await act(guestTab, s.callId, { type: 'hand', up: true }, guest.ticket.pass)).toBe(200);
    expect((await settle(call, (x) => x.participants.some((p) => p.id === guest.ticket.identity && p.hand))).participants.find((p) => p.id === guest.ticket.identity)?.hand).toBe(true);
    expect(await act(guestTab, s.callId, { type: 'spotlight', participantId: guest.ticket.identity }, guest.ticket.pass)).toBe(403);
    expect(await act(guestTab, s.callId, { type: 'rooms-open', rooms: [{ name: 'A', emails: [] }, { name: 'B', emails: [] }], minutes: 5 }, guest.ticket.pass)).toBe(403);
    await call.leave();
    expect(await act(a, s.callId, { type: 'hand', up: false }, call.ticket.pass)).toBe(409);
  });

  it('opens breakout rooms for invited people only, messages them, brings them back, and puts the rooms in the notes', async () => {
    const org = await account(unique('organizer'));
    const kofi = `kofi@g${Date.now().toString(36)}${(seq++).toString(36)}.example`;
    const lena = `lena@g${Date.now().toString(36)}${(seq++).toString(36)}.example`;
    const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on', guests: [kofi, lena] })).code, { mic: true, cam: false });
    const id = call.getSnapshot().callId;
    await call.transcribe(speech('We agreed to split into two rooms.', 0, 0), call.ticket.identity);

    // Only people invited to the call, each in one room, in two to eight rooms.
    expect(await act(org, id, { type: 'rooms-open', rooms: [{ name: 'Design', emails: [kofi] }, { name: 'Support', emails: ['stranger@elsewhere.example'] }], minutes: 5 }, call.ticket.pass)).toBe(400);
    expect(await act(org, id, { type: 'rooms-open', rooms: [{ name: 'Design', emails: [kofi] }, { name: 'Support', emails: [kofi] }], minutes: 5 }, call.ticket.pass)).toBe(400);
    expect(await act(org, id, { type: 'rooms-open', rooms: [{ name: 'Alone', emails: [kofi] }], minutes: 5 }, call.ticket.pass)).toBe(400);
    expect(await act(org, id, { type: 'rooms-message', text: 'Nobody to tell' }, call.ticket.pass)).toBe(409);

    call.setSpotlight(call.getSnapshot().participants[0]?.id ?? null);
    // The spotlight is optimistic on the client: wait until the server holds it, so opening rooms can't overtake it.
    await until(async () => SpotlightReply.parse(await (await org.fetch(`${h.baseUrl}/v1/live/calls/${id}`, { headers: { 'x-alcove-call': call.ticket.pass } })).json()).spotlight !== null, 'the server to confirm the spotlight');
    call.openRooms({ rooms: [{ name: 'Design', emails: [kofi.toUpperCase()] }, { name: 'Support', emails: [lena] }], minutes: 5 });
    let s = await settle(call, (x) => x.breakouts.open !== null);
    const open = s.breakouts.open;
    expect(open?.rooms.map((r) => [r.name, r.people.map((p) => p.email)])).toEqual([['Design', [kofi]], ['Support', [lena]]]);
    expect((open?.until ?? 0) - (open?.from ?? 0)).toBe(300);
    expect(s.spotlight).toBeNull(); // opening rooms ends a spotlight: everyone's stage changes
    expect(await act(org, id, { type: 'rooms-open', rooms: [{ name: 'A', emails: [] }, { name: 'B', emails: [] }], minutes: 5 }, call.ticket.pass)).toBe(409);

    call.messageRooms('Two minutes left');
    s = await settle(call, (x) => x.breakouts.open?.message?.text === 'Two minutes left');
    expect(s.breakouts.open?.message).toMatchObject({ text: 'Two minutes left', at: expect.any(Number) });

    call.closeRooms();
    s = await settle(call, (x) => x.breakouts.open === null);
    expect(s.breakouts.held.map((h) => h.rooms.map((r) => r.name))).toEqual([['Design', 'Support']]);

    // Rooms still open when the call ends come back too; every room the call held goes into its notes.
    call.openRooms({ rooms: [{ name: 'Pairs A', emails: [lena] }, { name: 'Pairs B', emails: [] }], minutes: 10 });
    await settle(call, (x) => x.breakouts.open !== null);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    const rooms = note.chapters.filter((c) => c.title === '2 breakout rooms');
    expect(rooms).toHaveLength(2);
    expect(rooms[0]?.summary).toBe('Design: Kofi. Support: Lena. 1 min.');
    expect(rooms[1]?.summary).toBe('Pairs A: Lena. Pairs B: nobody invited. 1 min.');
    expect(note.chapters.map((c) => c.at)).toEqual([...note.chapters.map((c) => c.at)].sort((x, y) => x - y));
  });

  it('says who is in each room, and lets the organizer visit one, where the people in it see and hear them', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = unique('kofi');
    const call = await org.api.calls.join((await org.api.calls.startNow({ guests: [kofiEmail] })).code, { mic: true, cam: false });
    const { callId: id, code: callCode } = call.getSnapshot();
    const me = call.ticket.identity;
    const kofi = await account(kofiEmail);
    const kofiCall = await kofi.api.calls.join(callCode, { mic: true, cam: false });
    const them = kofiCall.ticket.identity;
    await settle(call, (x) => x.participants.some((p) => p.id === them));
    expect(await act(org, id, { type: 'rooms-visit', roomId: null }, call.ticket.pass)).toBe(409);

    call.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 5 });
    let s = await settle(call, (x) => x.breakouts.open !== null);
    const design = s.breakouts.open?.rooms[0]?.id ?? '';
    // Who's in each room, by participant ID: the invited people sent there who are in the call. The organizer starts in the main room.
    expect(s.breakouts.open?.rooms.map((r) => r.members)).toEqual([[them], []]);

    call.visitRoom(design);
    s = await settle(call, (x) => x.breakouts.open?.rooms[0]?.members.includes(me) === true);
    expect([...(s.breakouts.open?.rooms[0]?.members ?? [])].sort()).toEqual([me, them].sort());
    // Kofi's browser learns it from the call, and keeps its media to the people in the room.
    expect((await settle(kofiCall, (x) => x.breakouts.open?.rooms[0]?.members.includes(me) === true)).breakouts.open?.rooms[0]?.members).toContain(me);
    call.visitRoom(null);
    s = await settle(call, (x) => x.breakouts.open?.rooms[0]?.members.length === 1);
    expect(s.breakouts.open?.rooms.map((r) => r.members)).toEqual([[them], []]);

    // Only a room this call has open, and only the organizer.
    expect(await act(org, id, { type: 'rooms-visit', roomId: 'not-a-room' }, call.ticket.pass)).toBe(400);
    expect(await act(kofi, id, { type: 'rooms-visit', roomId: design }, kofiCall.ticket.pass)).toBe(403);
    const other = await account();
    const otherCall = await other.api.calls.join((await other.api.calls.startNow()).code, { mic: true, cam: false });
    otherCall.openRooms({ rooms: [{ name: 'Theirs', emails: [] }, { name: 'Also theirs', emails: [] }], minutes: 5 });
    const theirs = (await settle(otherCall, (x) => x.breakouts.open !== null)).breakouts.open?.rooms[0]?.id ?? '';
    expect(theirs).not.toBe('');
    expect(await act(org, id, { type: 'rooms-visit', roomId: theirs }, call.ticket.pass)).toBe(400);
    expect(await act(other, id, { type: 'rooms-visit', roomId: design }, otherCall.ticket.pass)).toBe(401);

    // Closing the rooms brings the organizer back with everyone; rooms opened again start with them in the main room.
    call.visitRoom(design);
    await settle(call, (x) => x.breakouts.open?.rooms[0]?.members.includes(me) === true);
    call.closeRooms();
    await settle(call, (x) => x.breakouts.open === null);
    call.openRooms({ rooms: [{ name: 'Again', emails: [kofiEmail] }, { name: 'Empty', emails: [] }], minutes: 5 });
    s = await settle(call, (x) => x.breakouts.open !== null);
    expect(s.breakouts.open?.rooms.map((r) => r.members)).toEqual([[them], []]);
    expect(await kofiCall.leave()).toBeNull();
    await ended(otherCall);
    await ended(call);
  });

  it('translates live captions for the person asking, once per line and language, and keeps them only while the call records', async () => {
    const a = await account();
    const call = await a.api.calls.join((await a.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const id = call.getSnapshot().callId;
    await call.transcribe(speech('The launch moves to the 18th. // Kofi will send the screens.', 0, 0), call.ticket.identity);
    const lines = call.getSnapshot().transcript;
    const ids = lines.map((l) => l.id);
    const translated = () => h.near.calls.filter((x) => x.path.endsWith('/chat/completions')).length;
    const before = translated();
    const sent = h.near.calls.length;
    expect(await call.translate(ids, 'es')).toEqual([
      { id: ids[0], text: '[Spanish] The launch moves to the 18th.' }, { id: ids[1], text: '[Spanish] Kofi will send the screens.' }
    ]);
    expect(translated() - before).toBe(1);
    // Asking again comes from the sealed copy; another language is translated once more; unknown lines are left out.
    expect(await call.translate([ids[1] ?? '', 'not-a-line'], 'es')).toEqual([{ id: ids[1], text: '[Spanish] Kofi will send the screens.' }]);
    expect(translated() - before).toBe(1);
    expect((await call.translate(ids, 'ja')).map((x) => x.text)).toEqual(['[Japanese] The launch moves to the 18th.', '[Japanese] Kofi will send the screens.']);
    expect(translated() - before).toBe(2);
    // Both went sealed to the verified notes model, at its own endpoint, never in plaintext.
    expect(h.near.calls.slice(sent).map((x) => [x.path, x.encryption])).toEqual([['/v1/chat/completions', 'ohttp'], ['/v1/chat/completions', 'ohttp']]);
    const rows = async () => (await h.pool.query('SELECT count(*)::int AS n FROM transcript_translations WHERE owner_id = $1', [a.session.ownerId])).rows[0]?.n;
    expect(await rows()).toBe(4);

    // Another account can't read this call's captions, even with the line IDs; its own call doesn't have them.
    const b = await account();
    const steal = await b.fetch(`${h.baseUrl}/v1/live/calls/${id}/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'es', lines: ids }) });
    expect(steal.status).toBe(401);
    const theirs = await b.api.calls.join((await b.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await theirs.transcribe(speech('Something else entirely.', 0, 0), theirs.ticket.identity);
    expect(await theirs.translate(ids, 'es')).toEqual([]);
    await theirs.leave();
    expect((await a.fetch(`${h.baseUrl}/v1/live/calls/${id}/translate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: JSON.stringify({ language: 'xx', lines: ids }) })).status).toBe(400);

    // When the call ends the captions go with the live transcript.
    await call.leave();
    expect(await rows()).toBe(0);
    expect(code(await call.translate(ids, 'es').catch((e: unknown) => e))).toBe('conflict');
    const quiet = await a.api.calls.join((await a.api.calls.startNow({ notes: 'off' })).code, { mic: true, cam: false });
    expect(code(await quiet.translate(['x'], 'es').catch((e: unknown) => e))).toBe('conflict');
    await quiet.leave();
  });
});

describe('verified private inference', () => {
  /** A NEAR AI of its own and an API server that uses it, so nothing has been verified, or refused, there yet. */
  async function ownNear() {
    const near = await startFakeNear();
    const server = await h.secondServer(near.settings);
    const api = createHttpApi({ baseUrl: server.baseUrl, fetch: cookieFetch(ORIGIN) });
    const { session } = await api.auth.signIn('sso', { email: unique() });
    return { near, api, session, deps: { ...h.deps, cfg: { ...h.deps.cfg, ...near.settings } }, close: async () => { await server.close(); await near.close(); } };
  }
  const logsSince = (from: number) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
  const said = (e: unknown) => (e instanceof AlcoveApiError ? e.message : 'not-an-api-error');
  const job = async (ownerId: string) => (await h.pool.query<{ state: string; attempt: number }>('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [ownerId])).rows[0];
  const dueNow = (ownerId: string) => h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [ownerId]);
  const unreadable = (received: { body: Buffer }[], ...canaries: string[]) => {
    const wire = Buffer.concat(received.map((r) => r.body));
    for (const c of canaries) for (const enc of [c, Buffer.from(c).toString('hex'), Buffer.from(c).toString('base64').slice(0, 12)]) expect(wire.includes(Buffer.from(enc)), `${c} as ${enc} on the wire`).toBe(false);
  };

  it('sends nothing to a model whose evidence doesn’t check out, in any of the ways it can fail, and logs why', async () => {
    const cases: [Tamper, 'model' | 'gateway', string][] = [
      ['quote', 'model', 'tdx-quote'], ['quote', 'gateway', 'tdx-quote'], ['nonce', 'model', 'nonce'], ['nonce', 'gateway', 'nonce'],
      ['key', 'model', 'signing-key'], ['key', 'gateway', 'signing-key'], ['os-image', 'model', 'os-image'], ['os-image', 'gateway', 'os-image'],
      ['compose', 'model', 'compose'], ['compose', 'gateway', 'compose'], ['rtmr3', 'model', 'rtmr3'], ['rtmr3', 'gateway', 'rtmr3'],
      ['ohttp-key', 'model', 'ohttp-key'], ['gpu-nonce', 'model', 'nonce'], ['verdict-nonce', 'model', 'nonce'], ['gpu', 'model', 'gpu'],
      ['model-mismatch', 'model', 'model-mismatch'], ['expired', 'model', 'expired'], ['tcb', 'model', 'tcb-status'], ['unnamed-platform', 'model', 'tdx-quote'],
      ['nvidia-root', 'model', 'gpu'], ['nvidia-expired', 'model', 'gpu'], ['nvidia-not-ca', 'model', 'gpu'],
      ['pcs-down', 'model', 'collateral-unavailable'], ['nras-down', 'model', 'gpu-unavailable'], ['jwks-down', 'model', 'gpu-unavailable'], ['report-down', 'model', 'report-unavailable']
    ];
    const refused: Record<string, unknown> = {};
    for (const [how, of, expected] of cases) {
      const own = await ownNear();
      try {
        own.near.tamper(how, of);
        const rec = await own.api.recordings.start({ title: 'Checked first' });
        const from = h.logs.length;
        const e = await rec.transcribe(speech(`CANARY-UNVERIFIED ${how}: the merger closes on Friday.`, 0, 0)).catch((x: unknown) => x);
        const couldntCheck = expected.endsWith('-unavailable');
        expect([code(e), said(e)]).toEqual(['unavailable', couldntCheck ? 'We couldn’t check NEAR AI’s private model right now, so nothing was sent. Try again in a moment.' : 'We couldn’t verify NEAR AI’s private model, so nothing was sent. Try again in a moment.']);
        const line = logsSince(from).find((l) => l.msg === 'model evidence refused');
        expect(line, `${how} on the ${of}`).toMatchObject({ model: 'openai/whisper-large-v3', task: 'transcript', ms: expect.any(Number) });
        refused[`${how}/${of}`] = line?.['code'];
        // Nothing with content reached NEAR AI: only requests for its evidence, and NVIDIA only the GPU evidence.
        expect(own.near.calls).toEqual([]);
        expect(own.near.received.every((r) => r.path === '/nvidia/v3/attest/gpu')).toBe(true);
        unreadable(own.near.received, 'CANARY-UNVERIFIED', 'merger closes');
      } finally {
        await own.close();
      }
    }
    expect(refused).toEqual(Object.fromEntries(cases.map(([how, of, expected]) => [`${how}/${of}`, expected])));
  });

  it('stands by a refusal for a while, uses a report that checks out over one that doesn’t, and sends once it checks out', async () => {
    const own = await ownNear();
    try {
      const rec = await own.api.recordings.start({ title: 'Checked first' });
      own.near.tamper('quote');
      expect(code(await rec.transcribe(speech('One.', 0, 0)).catch((e: unknown) => e))).toBe('unavailable');
      // The next clip within half a minute is refused without fetching the evidence again.
      let from = h.logs.length;
      expect(code(await rec.transcribe(speech('Two.', 0, 4)).catch((e: unknown) => e))).toBe('unavailable');
      expect(logsSince(from).filter((l) => l.msg === 'model evidence refused' || l.msg === 'model verified')).toEqual([]);
      await rec.discard();
      own.near.tamper(null);
    } finally {
      await own.close();
    }

    const other = await ownNear();
    try {
      // NEAR AI returns a tampered report ahead of an honest one: the tampered one is refused, the honest one used.
      other.near.tamper('extra-candidate');
      const from = h.logs.length;
      const rec = await other.api.recordings.start({ title: 'Two reports' });
      await rec.transcribe(speech('Now it checks out.', 0, 0));
      expect(rec.getSnapshot().transcript.map((l) => l.text)).toEqual(['Now it checks out.']);
      expect(logsSince(from).find((l) => l.msg === 'model report refused')).toMatchObject({ code: 'tdx-quote', candidate: 0, candidates: 2 });
      expect(logsSince(from).find((l) => l.msg === 'model verified')).toMatchObject({ model: 'openai/whisper-large-v3', code: 'verified', candidates: 2, passed: 1, os: 'dstack-nvidia-0.5.12' });
      expect(other.near.calls.map((c) => [c.path, c.encryption])).toEqual([['/v1/audio/transcriptions', 'ohttp']]);
      other.near.tamper(null);
      await rec.discard();
    } finally {
      await other.close();
    }
  });

  it('keeps a note waiting while the notes model doesn’t answer, without using up its attempts', async () => {
    const own = await ownNear();
    try {
      const rec = await own.api.recordings.start({ title: 'Waits for an answer' });
      await rec.transcribe(speech('We agreed to wait for an answer.', 0, 0));
      // NEAR AI is busy for a while: the sealed notes request gets a 503 every time it's tried.
      own.near.failNext(4, 'down');
      const { pendingNoteId } = await rec.stop();
      await until(async () => (await job(own.session.ownerId))?.state === 'waiting', 'the job to wait');
      const { maintain } = await import('./maintenance');
      for (let i = 0; i < 3; i++) {
        await dueNow(own.session.ownerId);
        await maintain(own.deps);
        expect(await job(own.session.ownerId)).toEqual({ state: 'waiting', attempt: 0 });
      }
      expect((await own.api.notes.get(pendingNoteId)).status).toBe('pending');
      expect(logLines().some((l) => l.msg === 'notes waiting for the notes model to answer')).toBe(true);
      // It answers again: the notes are written, with no attempt used up along the way.
      await dueNow(own.session.ownerId);
      await maintain(own.deps);
      expect(await own.api.notes.get(pendingNoteId)).toMatchObject({ status: 'ready', summary: 'Heard 1 lines. It ended on: We agreed to wait for an answer.' });
      expect(own.near.calls.filter((c) => c.path === '/v1/chat/completions').map((c) => c.encryption)).toEqual(['ohttp', 'ohttp', 'ohttp', 'ohttp', 'ohttp']);
    } finally {
      await own.close();
    }
  });

  it('keeps a note waiting while the notes model can’t be verified, without using up its attempts', async () => {
    const own = await ownNear();
    try {
      const rec = await own.api.recordings.start({ title: 'Waits for NVIDIA' });
      await rec.transcribe(speech('We agreed to wait for NVIDIA.', 0, 0));
      // NVIDIA's attestation service is down: the notes model can't be verified, so the transcript isn't sent.
      own.near.tamper('nras-down');
      const { pendingNoteId } = await rec.stop();
      await until(async () => (await job(own.session.ownerId))?.state === 'waiting', 'the job to wait');
      const { maintain } = await import('./maintenance');
      for (let i = 0; i < 4; i++) {
        await dueNow(own.session.ownerId);
        await maintain(own.deps);
        expect(await job(own.session.ownerId)).toEqual({ state: 'waiting', attempt: 0 });
      }
      for await (const p of own.api.notes.progress(pendingNoteId)) { expect(p.steps.at(-1)).toEqual({ label: 'Waiting for the notes model. The notes are written as soon as it’s verified and answering', done: false }); break; }
      expect((await own.api.notes.get(pendingNoteId)).status).toBe('pending');
      expect(own.near.calls.filter((c) => c.path === '/v1/chat/completions')).toEqual([]);
      expect(logLines().some((l) => l.msg === 'notes waiting for the notes model to check out')).toBe(true);

      // NVIDIA comes back. The refusal stands for half a minute here, so a fresh NEAR AI plays it coming back.
      const back = await startFakeNear();
      try {
        await dueNow(own.session.ownerId);
        await maintain({ ...own.deps, cfg: { ...own.deps.cfg, ...back.settings } });
        const note = await own.api.notes.get(pendingNoteId);
        expect(note).toMatchObject({ status: 'ready', summary: 'Heard 1 lines. It ended on: We agreed to wait for NVIDIA.' });
        expect(note.inference.map((x) => [x.task, x.key])).toEqual([['transcript', own.near.keys().transcript], ['notes', back.keys().notes]]);
        expect(back.calls.map((c) => [c.path, c.encryption])).toEqual([['/v1/chat/completions', 'ohttp']]);
      } finally {
        await back.close();
      }
    } finally {
      await own.close();
    }
  });

  it('refuses a reply that isn’t sealed under the request, and sends nothing more when a model won’t open its key or its new key doesn’t check out', async () => {
    const own = await ownNear();
    try {
      const rec = await own.api.recordings.start({ title: 'Sealed replies' });
      await rec.transcribe(speech('We agreed the replies are sealed.', 0, 0));
      // A reply someone else sealed doesn't open, and isn't used.
      own.near.tamper('reply-sealed');
      let from = h.logs.length;
      expect(code(await rec.transcribe(speech('Not this one.', 0, 4)).catch((e: unknown) => e))).toBe('unavailable');
      expect(logsSince(from).find((l) => l.msg === 'reply refused')).toMatchObject({ what: 'transcribe', code: 'reply-sealed' });
      const { pendingNoteId } = await rec.stop();
      // For the notes, that's a failed attempt like any other: content went out, sealed, and the reply was bad.
      await until(async () => { const j = await job(own.session.ownerId); return j?.state === 'queued' && j.attempt === 1; }, 'the first attempt to fail');
      expect(await job(own.session.ownerId)).toEqual({ state: 'queued', attempt: 1 });
      own.near.tamper(null);
      const { maintain } = await import('./maintenance');
      await dueNow(own.session.ownerId);
      await maintain(own.deps);
      expect((await own.api.notes.get(pendingNoteId)).decisions.map((d) => d.text)).toEqual(['We agreed the replies are sealed.']);

      // The model won't open what was sealed to its key, though its evidence still names that key:
      // Alcove verifies again, finds the same key, and doesn't send the request again.
      own.near.tamper('refuse');
      const sent = own.near.received.length;
      from = h.logs.length;
      expect(code(await asked(own.api, pendingNoteId, 'Is this sent twice?').catch((e: unknown) => e))).toBe('unavailable');
      expect(logsSince(from).find((l) => l.msg === 'model key not accepted; verified again')).toMatchObject({ model: 'z-ai/glm-5.3-flash', changed: false });
      expect(own.near.received.slice(sent).filter((r) => r.path === '/direct/glm/ohttp')).toHaveLength(1);
      own.near.tamper(null);

      // The model moves to a new key whose evidence doesn't check out: the request sealed to the old key,
      // which the model didn't open, stays the only one, and the answer says so.
      own.near.rotate('notes');
      own.near.tamper('quote');
      const before = own.near.received.length;
      from = h.logs.length;
      const e = await asked(own.api, pendingNoteId, 'Is this sent to the new key?').catch((x: unknown) => x);
      expect([code(e), said(e)]).toEqual(['unavailable', 'NEAR AI’s private model changed, and its new evidence didn’t check out, so the request wasn’t sent again. Try again in a moment.']);
      expect(logsSince(from).find((l) => l.msg === 'model evidence refused')).toMatchObject({ model: 'z-ai/glm-5.3-flash', code: 'tdx-quote' });
      expect(logsSince(from).some((l) => l.msg === 'model key not accepted; verified again')).toBe(false);
      expect(own.near.received.slice(before).filter((r) => r.path === '/direct/glm/ohttp')).toHaveLength(1);
      own.near.tamper(null);
    } finally {
      await own.close();
    }
  });

  it('verifies again when a model’s key changes, and when its verification runs out, and the note keeps every verification', async () => {
    const own = await ownNear();
    try {
      const rec = await own.api.recordings.start({ title: 'Keys change' });
      await rec.transcribe(speech('Before the key changed.', 0, 0));
      const first = own.near.keys();
      // The model stops taking the old key: Alcove verifies the new one and sends the clip again, to it.
      own.near.rotate('transcript');
      let from = h.logs.length;
      await rec.transcribe(speech('', 0, 4)); // silence: nothing is kept, but it went to the new key
      expect(logsSince(from).find((l) => l.msg === 'model key not accepted; verified again')).toMatchObject({ model: 'openai/whisper-large-v3', changed: true });
      const second = own.near.keys();
      await rec.transcribe(speech('After the key changed.', 0, 6));
      expect(rec.getSnapshot().transcript.map((l) => l.text)).toEqual(['Before the key changed.', 'After the key changed.']);
      const { pendingNoteId } = await rec.stop();
      await written(own.api, pendingNoteId);
      // The note keeps every verification its speech went to, the silent clip's included, then the notes model's.
      expect((await own.api.notes.get(pendingNoteId)).inference.map((x) => [x.task, x.key])).toEqual([['transcript', first.transcript], ['transcript', second.transcript], ['notes', first.notes]]);

      own.near.rotate('notes');
      from = h.logs.length;
      expect((await asked(own.api, pendingNoteId, 'What changed?'))[0]).toEqual({ type: 'text', text: 'From the call: Before the key changed.' });
      expect(logsSince(from).find((l) => l.msg === 'model key not accepted; verified again')).toMatchObject({ model: 'z-ai/glm-5.3-flash', changed: true });

      // A verification holds only while NVIDIA's verdict does. After it, the next question checks again, and is refused if it doesn't check out.
      own.near.verdictLifetime(2);
      own.near.rotate('notes');
      await asked(own.api, pendingNoteId, 'What changed?');
      const sent = own.near.calls.length;
      await new Promise((r) => setTimeout(r, 2100));
      own.near.tamper('quote');
      from = h.logs.length;
      expect(code(await asked(own.api, pendingNoteId, 'What changed?').catch((e: unknown) => e))).toBe('unavailable');
      expect(logsSince(from).find((l) => l.msg === 'model evidence refused')).toMatchObject({ model: 'z-ai/glm-5.3-flash', code: 'tdx-quote' });
      expect(own.near.calls).toHaveLength(sent);
    } finally {
      await own.close();
    }
  });
});

describe('confirming what the notes say', () => {
  it('lets people confirm decisions and take on follow-ups, and remembers who did what', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = `kofi@g${Date.now().toString(36)}${(seq++).toString(36)}.example`;
    const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on', guests: [guestEmail] })).code, { mic: true, cam: false });
    await call.transcribe(speech('We agreed to move the launch to the 18th. // Kofi will send the new screens by Wednesday.', 0, 0), call.ticket.identity);
    const noteId = (await ended(call)).pendingNoteId ?? '';
    await written(org.api, noteId);
    let note = await org.api.notes.get(noteId);
    const decision = note.decisions[0]?.id ?? '';
    const action = note.actions[0]?.id ?? '';
    const guest = await account(guestEmail);
    const who = (n: { changes: { by: { email: string }; what: string; before?: string | undefined }[] }) => n.changes.map((c) => [c.by.email, c.what, c.before ?? null]);

    // Anyone with the notes confirms a decision, rewords it, says it wasn't decided after all, or reopens it.
    note = await guest.api.notes.updateDecision(noteId, decision, { state: 'confirmed' });
    expect(note.decisions[0]?.state).toBe('confirmed');
    note = await org.api.notes.updateDecision(noteId, decision, { text: 'The launch moves to the 18th.' });
    note = await org.api.notes.updateDecision(noteId, decision, { state: 'rejected' });
    note = await guest.api.notes.updateDecision(noteId, decision, { state: 'proposed' });
    expect(note.decisions[0]).toMatchObject({ text: 'The launch moves to the 18th.', state: 'proposed' });
    expect(who(note.decisions[0] ?? { changes: [] })).toEqual([
      [guestEmail, 'confirmed', null], [org.session.user.email, 'reworded', 'We agreed to move the launch to the 18th.'],
      [org.session.user.email, 'rejected', null], [guestEmail, 'reopened', null]
    ]);
    // Asking for what's already so changes nothing.
    expect(who((await guest.api.notes.updateDecision(noteId, decision, { state: 'proposed' })).decisions[0] ?? { changes: [] })).toHaveLength(4);

    // The notes only suggest who does what: only that person can take it on.
    expect(code(await org.api.notes.updateAction(noteId, action, { takeOn: true }).catch((e: unknown) => e))).toBe('forbidden');
    note = await guest.api.notes.updateAction(noteId, action, { takeOn: true });
    expect(note.actions[0]).toMatchObject({ takenOn: true, owner: { person: { email: guestEmail } } });
    // Taking it over yourself is taking it on; it can only go to someone who has the notes.
    note = await org.api.notes.updateAction(noteId, action, { owner: org.session.user.email, due: 'Friday' });
    expect(note.actions[0]).toMatchObject({ takenOn: true, owner: { person: { email: org.session.user.email } }, due: 'Friday' });
    expect(code(await org.api.notes.updateAction(noteId, action, { owner: unique('outsider') }).catch((e: unknown) => e))).toBe('invalid');
    // Given to someone else, it waits for them to say yes.
    note = await org.api.notes.updateAction(noteId, action, { owner: guestEmail });
    expect(note.actions[0]).toMatchObject({ takenOn: false, owner: { person: { email: guestEmail } } });
    expect(code(await org.api.notes.updateAction(noteId, action, { takeOn: true }).catch((e: unknown) => e))).toBe('forbidden');
    note = await org.api.notes.updateAction(noteId, action, { owner: org.session.user.email, text: 'Send the final screens', done: true });
    note = await guest.api.notes.updateAction(noteId, action, { owner: null, due: null });
    expect(note.actions[0]).toMatchObject({ text: 'Send the final screens', takenOn: false, done: true });
    expect(note.actions[0]?.owner).toBeUndefined();
    expect(note.actions[0]?.due).toBeUndefined();
    expect(who(note.actions[0] ?? { changes: [] })).toEqual([
      [guestEmail, 'took-on', null], [org.session.user.email, 'took-on', 'Kofi'], [org.session.user.email, 'due', 'Wednesday'],
      [org.session.user.email, 'reassigned', org.session.user.name],
      [org.session.user.email, 'reworded', 'Send the new screens by Wednesday'], [org.session.user.email, 'took-on', 'Kofi'], [org.session.user.email, 'done', null],
      [guestEmail, 'reassigned', org.session.user.name], [guestEmail, 'due', 'Friday']
    ]);

    // Nobody without the notes can touch them, nothing that isn't there can be changed, and a note being written waits.
    const stranger = await account();
    expect(code(await stranger.api.notes.updateDecision(noteId, decision, { state: 'confirmed' }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await stranger.api.notes.updateAction(noteId, action, { done: false }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await org.api.notes.updateAction(noteId, 'AAAAAAAAAAAAAAAAAAAAAA', { done: true }).catch((e: unknown) => e))).toBe('not-found');
    const rec = await org.api.recordings.start({ title: 'Still going' });
    expect(code(await org.api.notes.updateDecision(rec.getSnapshot().noteId, decision, { state: 'confirmed' }).catch((e: unknown) => e))).toBe('conflict');
    await rec.discard();
  });
});

describe('the inbox', () => {
  /** A written note whose one decision and one follow-up (for the guest, Kofi) are still the notes' suggestions. */
  async function suggested(org: Awaited<ReturnType<typeof account>>, guestEmail: string, said: string) {
    const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on', guests: [guestEmail] })).code, { mic: true, cam: false });
    await call.transcribe(speech(said, 0, 0), call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    return { noteId, decision: note.decisions[0]?.id ?? '', action: note.actions[0]?.id ?? '' };
  }

  it('the inbox gathers your follow-ups and unconfirmed decisions from every note you have', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = `kofi@g${Date.now().toString(36)}${(seq++).toString(36)}.example`;
    const first = await suggested(org, guestEmail, 'We agreed to move the launch to the 18th. // Kofi will send the new screens by Wednesday.');
    const second = await suggested(org, guestEmail, 'We agreed to keep the beta small. // Kofi will write the invite by Friday.');
    const guest = await account(guestEmail);

    // The follow-up is Kofi's: it's in his inbox, not yet taken on, and not in the organizer's.
    const mine = await guest.api.notes.inbox();
    expect(mine.followUps.map((a) => a.noteId)).toEqual([second.noteId, first.noteId]);
    expect(mine.followUps[0]).toMatchObject({ takenOn: false, noteId: second.noteId, noteTitle: expect.any(String), noteStartedAt: expect.any(String), owner: { person: { email: guestEmail } } });
    expect((await org.api.notes.inbox()).followUps).toEqual([]);
    // A proposed decision waits for both, newest note first.
    for (const reader of [org, guest]) {
      const inbox = await reader.api.notes.inbox();
      expect(inbox.decisions.map((d) => [d.noteId, d.state])).toEqual([[second.noteId, 'proposed'], [first.noteId, 'proposed']]);
      expect(inbox.decisions[0]).toMatchObject({ noteTitle: expect.any(String), noteStartedAt: expect.any(String), id: second.decision });
    }

    // Confirming it removes it for both; a follow-up that is done leaves.
    await guest.api.notes.updateDecision(second.noteId, second.decision, { state: 'confirmed' });
    for (const reader of [org, guest]) expect((await reader.api.notes.inbox()).decisions.map((d) => d.noteId)).toEqual([first.noteId]);
    await guest.api.notes.updateAction(second.noteId, second.action, { done: true });
    expect((await guest.api.notes.inbox()).followUps.map((a) => a.noteId)).toEqual([first.noteId]);

    // A note you removed, or never had, isn't in your inbox; a stranger's inbox is empty.
    await guest.api.notes.updateDecision(first.noteId, first.decision, { state: 'confirmed' });
    await guest.api.notes.delete(first.noteId);
    expect(await guest.api.notes.inbox()).toEqual({ followUps: [], decisions: [] });
    expect(await (await account()).api.notes.inbox()).toEqual({ followUps: [], decisions: [] });
  });

  it('a follow-up can’t be given to someone who removed the note', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = `kofi@g${Date.now().toString(36)}${(seq++).toString(36)}.example`;
    const { noteId, action } = await suggested(org, guestEmail, 'We agreed to move the launch to the 18th. // Kofi will send the new screens by Wednesday.');
    const guest = await account(guestEmail);
    await org.api.notes.updateAction(noteId, action, { owner: null });
    expect((await org.api.notes.updateAction(noteId, action, { owner: guestEmail })).actions[0]).toMatchObject({ owner: { person: { email: guestEmail } } });
    await org.api.notes.updateAction(noteId, action, { owner: null });

    await guest.api.notes.delete(noteId);
    expect(code(await org.api.notes.updateAction(noteId, action, { owner: guestEmail }).catch((e: unknown) => e))).toBe('invalid');
    // Given the note again, they can have it.
    await org.api.notes.share(noteId, { emails: [guestEmail] });
    expect((await org.api.notes.updateAction(noteId, action, { owner: guestEmail })).actions[0]).toMatchObject({ owner: { person: { email: guestEmail } } });
  });
});

describe('asking your notes', () => {
  const NOTHING = 'You don’t have any notes to answer from yet.';
  const WRITING = 'Your notes aren’t written yet. Ask again once they’re ready.';
  /** A room recording called `title` in which `said` was heard (sentences split by " // ", two seconds apart), once its notes are written. */
  async function recorded(api: AlcoveApi, title: string, said: string): Promise<string> {
    const rec = await api.recordings.start({ title });
    await rec.transcribe(speech(said, 0, 0));
    const { pendingNoteId } = await rec.stop();
    await written(api, pendingNoteId);
    return pendingNoteId;
  }
  const cited = (parts: AnswerPart[]) => parts.flatMap((p) => (p.type === 'cite' ? [p.noteId] : []));
  /** What a request to NEAR AI was, leaving out its size: where it went, for which model, and how it was sealed. */
  const route = (calls: typeof h.near.calls) => calls.map((c) => [c.path, c.model, c.encryption, c.key]);

  it('asking your notes answers from the notes you have and cites them', async () => {
    const me = await account(unique('asker'));
    const org = await account(unique('organizer'));
    // One note of your own, and one from a call you were invited to.
    const planning = await recorded(me.api, 'Launch planning', 'The budget stays as it is. // We agreed to move the launch to the 18th.');
    const call = await org.api.calls.join((await org.api.calls.startNow({ title: 'Launch party', notes: 'on', guests: [me.session.user.email] })).code, { mic: true, cam: false });
    await call.transcribe(speech('The launch party is at the studio on the 19th.', 0, 0), call.ticket.identity);
    const party = (await call.leave())?.pendingNoteId ?? '';
    await written(org.api, party);

    const sent = h.near.calls.length;
    const parts = await askedAll(me.api, 'When is the launch?');
    // The answer comes from both notes, newest first, and cites only them: the note the model made up is dropped.
    expect(parts).toEqual([
      { type: 'text', text: 'From your notes: The launch party is at the studio on the 19th. We agreed to move the launch to the 18th.' },
      { type: 'cite', noteId: party, at: 0 },
      { type: 'cite', noteId: planning, at: 2 }
    ]);
    // It went once, to the notes model, sealed to the key its verified evidence vouches for, at its own endpoint...
    const across = h.near.calls.slice(sent);
    expect(across).toEqual([{ path: '/v1/chat/completions', model: 'z-ai/glm-5.3-flash', bytes: expect.any(Number), encryption: 'ohttp', key: h.near.keys().notes }]);
    const prompt = h.near.prompts.at(-1) ?? '';
    // ...the way asking about one note goes.
    expect((await asked(me.api, planning, 'When is the launch?'))[0]).toEqual({ type: 'text', text: 'From the call: We agreed to move the launch to the 18th.' });
    expect(route(h.near.calls.slice(sent + 1))).toEqual(route(across));

    // The model read both notes, numbered newest first, and the question: names, never anyone's address.
    expect(prompt).toContain('[Note 1]\nMeeting: Launch party');
    expect(prompt).toContain('[Note 2]\nMeeting: Launch planning');
    expect(prompt).toContain(`[00:00] ${org.session.user.name}: The launch party is at the studio on the 19th.`);
    expect(prompt).toContain('[00:02] We agreed to move the launch to the 18th.');
    expect(prompt).toMatch(/\nQuestion: When is the launch\?$/);
    for (const email of [me.session.user.email, org.session.user.email]) expect(prompt).not.toContain(email);
    expect(Buffer.concat(h.near.received.map((r) => r.body)).includes(Buffer.from('When is the launch'))).toBe(false);
    // Nothing keeps the answer: no receipt, and the log has counts only.
    expect((await h.pool.query("SELECT count(*)::int AS n FROM operations WHERE owner_id = $1 AND method LIKE '%/ask'", [me.session.ownerId])).rows[0]?.n).toBe(0);
    expect(logLines().filter((l) => l.msg === 'question answered across notes').at(-1)).toMatchObject({ notes: 2, ready: 2, sent: 2, cites: 2, ms: expect.any(Number) });

    // A question is 1 to 500 characters.
    expect(code(await askedAll(me.api, '   ').catch((e: unknown) => e))).toBe('invalid');
    expect(code(await askedAll(me.api, 'x'.repeat(501)).catch((e: unknown) => e))).toBe('invalid');
  });

  it('asking with no ready notes says so without a model call', async () => {
    const b = await account(unique('newcomer'));
    /** Asks, and checks that NEAR AI was sent nothing while it answered: no request to a model, and no request at all. */
    const quietly = async (question: string) => {
      const before = { calls: h.near.calls.length, received: h.near.received.length };
      const parts = await askedAll(b.api, question);
      expect({ calls: h.near.calls.length, received: h.near.received.length }).toEqual(before);
      return parts;
    };
    expect(await quietly('What did we decide?')).toEqual([{ type: 'text', text: NOTHING }]);

    // A written note in which nothing was said, and notes not written yet: a room recording still going...
    const silent = await b.api.recordings.start({ title: 'Nothing said' });
    await written(b.api, (await silent.stop()).pendingNoteId);
    const going = await b.api.recordings.start({ title: 'Still going' });
    // ...one with speech, so with transcript lines, whose notes the notes model wrote unusably the first time, so
    // they wait to be tried again (20 seconds later)...
    const job = async () => (await h.pool.query<{ state: string; attempt: number }>('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [b.session.ownerId])).rows[0];
    const held = await b.api.recordings.start({ title: 'Being written' });
    await held.transcribe(speech('We decided to hold the launch until the audit is done.', 0, 0));
    h.near.failNext(1, 'prose');
    const beingWritten = (await held.stop()).pendingNoteId;
    await until(async () => { const j = await job(); return j?.state === 'queued' && j.attempt === 1; }, 'the first attempt to fail');
    expect(await b.api.notes.get(beingWritten)).toMatchObject({ status: 'pending', transcript: [{ text: 'We decided to hold the launch until the audit is done.' }] });
    // ...and one stopped on a server without the notes service, which waits (stopped last, so no worker of this account takes it).
    const plain = await h.secondServer({ NEAR_AI_API_KEY: undefined });
    let waiting = '';
    try {
      const there = createHttpApi({ baseUrl: plain.baseUrl, fetch: b.fetch });
      waiting = (await (await there.recordings.start({ title: 'Waiting for the notes service' })).stop()).pendingNoteId;
    } finally {
      await plain.close();
    }
    expect((await b.api.notes.list()).map((n) => n.status).sort()).toEqual(['pending', 'pending', 'ready', 'recording']);
    expect(await quietly('What did we decide?')).toEqual([{ type: 'text', text: WRITING }]);
    expect(logLines().filter((l) => l.msg === 'asked across notes with nothing to answer from').at(-1)).toMatchObject({ notes: 4, writing: true });

    // Once another note is written, the answer comes from it alone: neither the note still being written nor the
    // one with nothing in it is in what the model reads.
    await going.discard();
    await b.api.notes.delete(waiting);
    const launch = await recorded(b.api, 'Launch review', 'We decided the launch moves to the 18th.');
    const sent = h.near.calls.length;
    expect(await askedAll(b.api, 'What did we decide?')).toEqual([{ type: 'text', text: 'From your notes: We decided the launch moves to the 18th.' }, { type: 'cite', noteId: launch, at: 0 }]);
    expect(h.near.calls).toHaveLength(sent + 1);
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt.match(/^\[Note \d+\]$/gm)).toHaveLength(1);
    for (const left of ['Being written', 'hold the launch', 'Nothing said']) expect(prompt).not.toContain(left);
    expect((await b.api.notes.get(beingWritten)).status).toBe('pending');

    // With nothing on its way any more, the note with nothing in it still leaves nothing to answer from.
    await b.api.notes.delete(beingWritten);
    await b.api.notes.delete(launch);
    expect(await quietly('What did we decide?')).toEqual([{ type: 'text', text: NOTHING }]);
  });

  it('sends no answer across notes when a note it read was deleted or removed while it was being written', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = unique('guest');
    const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on', guests: [guestEmail] })).code, { mic: true, cam: false });
    await call.transcribe(speech('We agreed to sell the old van. // The buyer pays on Monday.', 0, 0), call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const guest = await account(guestEmail);
    // The guest removes the notes from theirs while the answer, which quotes them, is being written: it isn't sent.
    const sent = h.near.prompts.length;
    h.near.slowNext(1500);
    const answer = askedAll(guest.api, 'When does the buyer pay?').catch((e: unknown) => e);
    await until(async () => h.near.prompts.length > sent, 'the question to reach the notes model');
    await guest.api.notes.delete(noteId);
    const refused = await answer;
    expect(refused instanceof AlcoveApiError ? [refused.code, refused.message] : refused).toEqual(['conflict', 'Notes it read were deleted or removed from yours while the answer was being written, so it isn’t shown. Ask again.']);
    // Asked again, there's nothing left to answer from; the organizer's own answer still comes.
    expect(await askedAll(guest.api, 'When does the buyer pay?')).toEqual([{ type: 'text', text: 'You don’t have any notes to answer from yet.' }]);
    expect((await askedAll(org.api, 'When does the buyer pay?'))[0]).toEqual({ type: 'text', text: 'From your notes: The buyer pays on Monday.' });
    expect(h.logs.join('')).not.toContain('buyer pays');
  });

  it('a stranger’s question never cites another account’s notes', async () => {
    const owner = await account(unique('owner'));
    const stranger = await account(unique('stranger'));
    const theirs = await recorded(owner.api, 'Merger timeline', 'The merger closes on Friday.');
    // A stranger with no notes of their own gets nothing of the owner's, and nothing is sent.
    const sent = h.near.calls.length;
    expect(await askedAll(stranger.api, 'When does the merger close?')).toEqual([{ type: 'text', text: NOTHING }]);
    expect(h.near.calls).toHaveLength(sent);

    // With a note of their own, the model reads only theirs, and the answer cites only theirs.
    const own = await recorded(stranger.api, 'Merger party', 'The merger party is on Saturday.');
    expect(await askedAll(stranger.api, 'When does the merger close?')).toEqual([
      { type: 'text', text: 'From your notes: The merger party is on Saturday.' }, { type: 'cite', noteId: own, at: 0 }
    ]);
    let prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toContain('Merger party');
    expect(prompt).not.toContain('Merger timeline');
    expect(prompt).not.toContain('closes on Friday');

    // Shared with them, the owner's note is one of theirs too; removed from their notes, it isn't any more.
    await owner.api.notes.share(theirs, { emails: [stranger.session.user.email] });
    expect(cited(await askedAll(stranger.api, 'When does the merger close?'))).toEqual([own, theirs]);
    await stranger.api.notes.delete(theirs);
    expect(cited(await askedAll(stranger.api, 'When does the merger close?'))).toEqual([own]);
    prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).not.toContain('closes on Friday');
  });

  it('asks the 12 notes that share the most with the question, and as much of a long transcript as fits, nearest what matched', async () => {
    const b = await account(unique('busy'));
    // A long recording: 400 lines of about 400 characters, one of them about pricing, in the middle.
    const said = (i: number) => (i === 200 ? 'Pricing for schools is half the usual price.' : i === 399 ? 'That was all.' : `Line ${i} goes over the plans for the office move in some detail ${'and then some more detail '.repeat(13).trim()}`);
    const long = Array.from({ length: 400 }, (_, i) => said(i));
    const ids = [await recorded(b.api, 'Office move', long.join(' // '))];
    // Eleven short ones about pricing, and the newest, which isn't.
    ids.push(...await Promise.all(Array.from({ length: 11 }, (_, i) => recorded(b.api, `Pricing review ${i + 1}`, `We looked at pricing again, round ${i + 1}.`))));
    await recorded(b.api, 'Friday drinks', 'The weather looks good for the terrace.');

    const parts = await askedAll(b.api, 'What did we say about pricing?');
    const prompt = h.near.prompts.at(-1) ?? '';
    // Twelve notes went: the ones about pricing. The newest note, which isn't, stayed out.
    expect(prompt.match(/^\[Note \d+\]$/gm)).toHaveLength(12);
    expect(prompt).not.toContain('Friday drinks');
    for (let i = 1; i <= 11; i++) expect(prompt).toContain(`We looked at pricing again, round ${i}.`);
    // The long transcript was cut to the lines nearest the one about pricing, within what asking about one note may send.
    expect(prompt).toContain(said(200));
    for (const i of [150, 199, 201, 250]) expect(prompt).toContain(said(i));
    for (const i of [0, 1, 397, 398]) expect(prompt).not.toContain(said(i));
    // Nor a short line far from it that would still have fitted (the last one, which the summary quotes).
    expect(prompt).not.toContain(`[13:18] ${said(399)}`);
    expect(prompt).toContain('[…]');
    expect(prompt.length).toBeGreaterThan(100_000);
    expect(prompt.length).toBeLessThanOrEqual(121_000);
    // At most six cites, all of notes it was given.
    expect(cited(parts)).toHaveLength(6);
    expect(cited(parts).every((id) => ids.includes(id))).toBe(true);
  });
});

/** Records a call with notes on and leaves it, so the note exists for the organizer and each guest. */
async function noteFrom(org: Awaited<ReturnType<typeof account>>, guests: string[] = []): Promise<string> {
  const { code: c } = await org.api.calls.startNow({ notes: 'on', guests });
  const call = await org.api.calls.join(c, { mic: true, cam: false });
  const noteId = call.getSnapshot().notes.noteId ?? '';
  await call.leave();
  return noteId;
}

describe('pinned notes', () => {
  it('pins keep their order and refuse notes you don’t have', async () => {
    const me = await account(unique('pinner'));
    const a = await noteFrom(me);
    const b = await noteFrom(me);
    expect((await me.api.account.updatePreferences({ pinned: [b, a] })).pinned).toEqual([b, a]);
    expect((await me.api.account.preferences()).pinned).toEqual([b, a]);

    const other = await account(unique('other'));
    const theirs = await noteFrom(other);
    expect(code(await me.api.account.updatePreferences({ pinned: [b, theirs] }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await me.api.account.updatePreferences({ pinned: ['nope'] }).catch((e: unknown) => e))).toBe('not-found');
    expect((await me.api.account.preferences()).pinned).toEqual([b, a]);

    // A ninth pin is refused, as is anything that isn't a list of eight or fewer.
    const nine = Array.from({ length: 9 }, (_, i) => `n${i}`);
    expect(code(await me.api.account.updatePreferences({ pinned: nine }).catch((e: unknown) => e))).toBe('invalid');
    expect((await me.api.account.updatePreferences({ pinned: [] })).pinned).toEqual([]);
  });

  it('deleting or removing a note unpins it', async () => {
    const org = await account(unique('organizer'));
    const keeper = await account(unique('keeper'));
    const leaver = await account(unique('leaver'));
    const own = await noteFrom(org);
    const shared = await noteFrom(org, [keeper.session.user.email, leaver.session.user.email]);

    // Owner deletes their own pinned note: gone from their pins.
    await org.api.account.updatePreferences({ pinned: [shared, own] });
    await org.api.notes.delete(own);
    expect((await org.api.account.preferences()).pinned).toEqual([shared]);

    // A recipient who removes a shared note from their notes no longer has it pinned.
    await leaver.api.account.updatePreferences({ pinned: [shared] });
    await leaver.api.notes.delete(shared);
    expect((await leaver.api.account.preferences()).pinned).toEqual([]);

    // A recipient who pinned a shared note stops seeing it once the owner deletes it.
    await keeper.api.account.updatePreferences({ pinned: [shared] });
    expect((await keeper.api.account.preferences()).pinned).toEqual([shared]);
    await org.api.notes.delete(shared);
    expect((await org.api.account.preferences()).pinned).toEqual([]);
    expect((await keeper.api.account.preferences()).pinned).toEqual([]);
  });
});

describe('who has the notes', () => {
  it('gives the notes to everyone invited when the call ends, and lets anyone with them share them on', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = unique('guest');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [guestEmail] });
    const call = await org.api.calls.join(c, { mic: true, cam: false });
    await call.appendAudio(piece(audioBytes('shared-audio'), 0, 0));
    const noteId = call.getSnapshot().notes.noteId ?? '';
    expect(code(await org.api.notes.share(noteId, { emails: [unique()] }).catch((e: unknown) => e))).toBe('invalid');

    // Nobody invited sees the note while the call is still on.
    const guest = await account(guestEmail);
    expect((await guest.api.notes.list()).map((n) => n.id)).not.toContain(noteId);
    expect(code(await guest.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
    await call.leave();

    // When it ends, everyone invited has it, from the organizer, along with who else has it.
    expect((await guest.api.notes.list()).find((n) => n.id === noteId)).toMatchObject({ received: { role: 'invited', by: { id: org.session.ownerId } } });
    const note = await guest.api.notes.get(noteId);
    expect(note.recipients.map((r) => [r.person.email, r.role])).toEqual([[org.session.user.email, 'organizer'], [guestEmail, 'invited']]);
    expect((await guest.fetch(guest.api.notes.audioUrl(noteId, 0))).status).toBe(200);

    // Anyone with the notes can share them on; people who already have them aren't added twice.
    const laterEmail = unique('later');
    const shared = await guest.api.notes.share(noteId, { emails: [laterEmail, org.session.user.email, guestEmail] });
    expect(shared.recipients.map((r) => r.role)).toEqual(['organizer', 'invited', 'shared']);
    const later = await account(laterEmail);
    expect((await later.api.notes.get(noteId)).received).toMatchObject({ role: 'shared', by: { id: guest.session.ownerId, email: guestEmail } });
    expect(code(await later.api.notes.share(noteId, { emails: ['not an email'] }).catch((e: unknown) => e))).toBe('invalid');

    // Someone who was never given them can't reach them.
    const stranger = await account();
    expect(code(await stranger.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
    expect((await stranger.fetch(stranger.api.notes.audioUrl(noteId, 0))).status).toBe(404);

    // Removing someone else's note only takes it out of your own notes...
    await later.api.notes.delete(noteId);
    expect(code(await later.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
    expect((await guest.api.notes.get(noteId)).id).toBe(noteId);
    // ...and the organizer deleting it takes it from everyone.
    await org.api.notes.delete(noteId);
    expect(code(await guest.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
    expect((await h.pool.query('SELECT count(*)::int AS n FROM note_access WHERE note_item_id = $1', [noteId])).rows[0]?.n).toBe(0);
  });

  it('a note shared with a group says who shared it and with which group', async () => {
    const org = await account(unique('organizer'));
    const member = await account(unique('member'));
    // The client expands the group: its addresses, one of them not on Alcove yet, and its name.
    const notYet = unique('not-yet');
    const noteId = await noteFrom(org);
    const shared = await org.api.notes.share(noteId, { emails: [member.session.user.email, notYet], group: 'Product' });

    // Whoever it reached sees who shared it, with which group, and when.
    const got = (await member.api.notes.list()).find((n) => n.id === noteId)?.received;
    expect(got).toMatchObject({ role: 'shared', by: org.session.user, group: 'Product' });
    expect(Math.abs(Date.parse(got?.at ?? '') - Date.now())).toBeLessThan(60_000);
    expect((await member.api.notes.get(noteId)).received).toEqual(got);
    // The note lists each of them with who shared it, the group and when; the organizer's own came from nobody.
    for (const email of [member.session.user.email, notYet]) {
      expect(shared.recipients.find((r) => r.person.email === email)).toMatchObject({ role: 'shared', by: { id: org.session.ownerId }, group: 'Product', at: got?.at });
    }
    expect((await org.api.notes.list()).find((n) => n.id === noteId)?.received).toBeUndefined();
    expect((await org.api.notes.get(noteId)).received).toBeUndefined();

    // Shared on by someone else, without a group: they're who it came from.
    const next = await account(unique('next'));
    await member.api.notes.share(noteId, { emails: [next.session.user.email] });
    const onward = (await next.api.notes.get(noteId)).received;
    expect(onward).toMatchObject({ role: 'shared', by: { id: member.session.ownerId, name: member.session.user.name, email: member.session.user.email } });
    expect(onward?.group).toBeUndefined();
    const entry = (await org.api.notes.get(noteId)).recipients.find((r) => r.person.email === next.session.user.email);
    expect(entry).toMatchObject({ role: 'shared', by: { id: member.session.ownerId } });
    expect(entry?.group).toBeUndefined();
  });

  it('invited people see the organizer as who it came from', async () => {
    const org = await account(unique('organizer'));
    const guest = await account(unique('guest'));
    const before = Date.now();
    const noteId = await noteFrom(org, [guest.session.user.email]);

    const got = (await guest.api.notes.list()).find((n) => n.id === noteId)?.received;
    expect(got).toMatchObject({ role: 'invited', by: org.session.user });
    expect(got?.group).toBeUndefined();
    // When they got it: when the call ended.
    expect(Date.parse(got?.at ?? '')).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(got?.at ?? '')).toBeLessThanOrEqual(Date.now());
    expect((await guest.api.notes.get(noteId)).received).toEqual(got);
    // On the note, people invited carry when they got it, and nothing about sharing.
    const invited = (await org.api.notes.get(noteId)).recipients.find((r) => r.person.email === guest.session.user.email);
    expect(invited).toMatchObject({ role: 'invited', at: got?.at });
    expect(invited?.by).toBeUndefined();
    expect(invited?.group).toBeUndefined();
  });

  it('someone who removed the notes isn’t listed as having them, and sharing with their group gives them back', async () => {
    const org = await account(unique('organizer'));
    const guest = await account(unique('guest'));
    const member = await account(unique('member'));
    const keeper = await account(unique('keeper'));
    const noteId = await noteFrom(org, [guest.session.user.email]);
    await org.api.notes.share(noteId, { emails: [member.session.user.email, keeper.session.user.email], group: 'Product' });
    const kept = (await keeper.api.notes.get(noteId)).received;
    const holders = async () => (await org.api.notes.get(noteId)).recipients.map((r) => [r.person.email, r.role, r.group]);
    expect(await holders()).toEqual([
      [org.session.user.email, 'organizer', undefined], [guest.session.user.email, 'invited', undefined],
      [member.session.user.email, 'shared', 'Product'], [keeper.session.user.email, 'shared', 'Product']
    ]);

    // Removing them from your notes takes you off the list everyone else sees, invited or shared.
    await guest.api.notes.delete(noteId);
    await member.api.notes.delete(noteId);
    expect(await holders()).toEqual([[org.session.user.email, 'organizer', undefined], [keeper.session.user.email, 'shared', 'Product']]);
    expect((await org.api.notes.list()).find((n) => n.id === noteId)?.people.map((p) => p.email)).toEqual([org.session.user.email, keeper.session.user.email]);
    expect((await keeper.api.notes.get(noteId)).people.map((p) => p.email)).toEqual([org.session.user.email, keeper.session.user.email]);

    // Sharing with a group they're in gives the notes back to them, shared this time; whoever still has them is skipped.
    const again = await org.api.notes.share(noteId, { emails: [guest.session.user.email, member.session.user.email, keeper.session.user.email], group: 'Launch' });
    expect(again.recipients.map((r) => [r.person.email, r.role, r.group])).toEqual([
      [org.session.user.email, 'organizer', undefined], [keeper.session.user.email, 'shared', 'Product'],
      [guest.session.user.email, 'shared', 'Launch'], [member.session.user.email, 'shared', 'Launch']
    ]);
    expect((await guest.api.notes.get(noteId)).received).toMatchObject({ role: 'shared', by: { id: org.session.ownerId }, group: 'Launch' });
    expect((await member.api.notes.list()).find((n) => n.id === noteId)?.received).toMatchObject({ role: 'shared', group: 'Launch' });
    expect((await keeper.api.notes.get(noteId)).received).toEqual(kept);
  });

  it('refuses a group of 51 addresses, a group name over 40 characters, and notes you don’t have', async () => {
    const org = await account(unique('organizer'));
    const noteId = await noteFrom(org);
    const crowd = Array.from({ length: 51 }, () => unique('crowd'));
    expect(code(await org.api.notes.share(noteId, { emails: crowd, group: 'Everyone' }).catch((e: unknown) => e))).toBe('invalid');
    expect(code(await org.api.notes.share(noteId, { emails: [unique()], group: 'x'.repeat(41) }).catch((e: unknown) => e))).toBe('invalid');
    expect(code(await org.api.notes.share(noteId, { emails: [unique()], group: '   ' }).catch((e: unknown) => e))).toBe('invalid');
    expect((await org.api.notes.get(noteId)).recipients).toHaveLength(1);
    // Fifty people and a 40-character name are fine.
    const fifty = await org.api.notes.share(noteId, { emails: crowd.slice(0, 50), group: 'g'.repeat(40) });
    expect(fifty.recipients).toHaveLength(51);
    expect(new Set(fifty.recipients.slice(1).map((r) => r.group))).toEqual(new Set(['g'.repeat(40)]));

    // Another account's note, or none at all: not found, and nobody gets anything.
    const stranger = await account(unique('stranger'));
    const target = unique('target');
    expect(code(await stranger.api.notes.share(noteId, { emails: [target], group: 'Product' }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await stranger.api.notes.share('AAAAAAAAAAAAAAAAAAAAAA', { emails: [target], group: 'Product' }).catch((e: unknown) => e))).toBe('not-found');
    expect((await org.api.notes.get(noteId)).recipients.map((r) => r.person.email)).not.toContain(target);
    expect((await (await account(target)).api.notes.list()).map((n) => n.id)).not.toContain(noteId);
  });

  it('keeps no receipt of a note for anyone, so a note deleted since can’t come back through a retried request', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = unique('guest');
    const call = await org.api.calls.join((await org.api.calls.startNow({ title: 'Receipt canary', notes: 'on', guests: [guestEmail] })).code, { mic: true, cam: false });
    await call.transcribe(speech('We agreed to ship on Thursday. // Can we test it first? // Someone will write the release notes.', 0, 0), call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    const guest = await account(guestEmail);

    // Everything someone given the notes can change, each with an operation ID, as the app sends it.
    const edits: [string, string, unknown][] = [
      ['PATCH', `decisions/${note.decisions[0]?.id ?? ''}`, { state: 'confirmed' }],
      ['PATCH', `questions/${note.questions[0]?.id ?? ''}`, { state: 'answered' }],
      ['PATCH', `actions/${note.actions[0]?.id ?? ''}`, { done: true }],
      ['POST', 'share', { emails: [unique('later')] }]
    ];
    const ops = edits.map(() => Buffer.from(randomBytes(16)).toString('base64url'));
    const send = (i: number) => {
      const [method, path, body] = edits[i] ?? ['GET', '', null];
      return guest.fetch(`${h.baseUrl}/v1/notes/${noteId}/${path}`, { method, headers: { 'content-type': 'application/json', [OPERATION_HEADER]: ops[i] ?? '' }, body: JSON.stringify(body) });
    };
    for (let i = 0; i < edits.length; i++) {
      const r = await send(i);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('Receipt canary');
    }
    // They set what they say, so a retry changes nothing.
    expect((await send(0)).status).toBe(200);
    expect((await org.api.notes.get(noteId)).decisions[0]?.changes.map((c) => c.what)).toEqual(['confirmed']);

    // Deleted: retrying any of them finds no note, rather than a copy of it, and no receipt kept the note anywhere.
    await org.api.notes.delete(noteId);
    for (let i = 0; i < edits.length; i++) {
      const r = await send(i);
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain('Receipt canary');
    }
    expect((await h.pool.query('SELECT count(*)::int AS n FROM operations WHERE owner_id = $1', [guest.session.ownerId])).rows[0]?.n).toBe(0);
  });
});

describe('room recordings', () => {
  it('records in the room, renames, stops into a private note, and can be discarded', async () => {
    const b = await account();
    const { api, session } = b;
    const rec = await api.recordings.start({ title: 'Board prep' });
    await rec.appendAudio(piece(audioBytes('room-0'), 0, 0));
    rec.rename('Board prep with Dana');
    rec.pause();
    await settled(b, rec.getSnapshot().id, 'pause');
    expect(code(await rec.appendAudio(piece(audioBytes('while paused'), 0, 1)).catch((e: unknown) => e))).toBe('conflict');
    rec.resume();
    await settled(b, rec.getSnapshot().id, 'resume');
    const { pendingNoteId } = await rec.stop();
    await written(api, pendingNoteId);
    expect(await api.notes.get(pendingNoteId)).toMatchObject({ kind: 'room', title: 'Board prep with Dana', status: 'ready' });
    expect((await api.notes.list({ kind: 'room' })).map((n) => n.id)).toEqual([pendingNoteId]);

    const throwaway = await api.recordings.start({ title: 'Throwaway' });
    await throwaway.appendAudio(piece(audioBytes('gone'), 0, 0));
    await throwaway.discard();
    expect((await api.notes.list()).map((n) => n.title)).toEqual(['Board prep with Dana']);

    const objectIds = (await h.pool.query('SELECT p.object_id FROM recording_pieces p JOIN recordings r USING (owner_id, recording_id) WHERE r.note_item_id = $1', [pendingNoteId])).rows.map((r) => String(r.object_id));
    expect(objectIds.length).toBeGreaterThan(0);
    await api.notes.delete(pendingNoteId);
    expect(await api.notes.list()).toEqual([]);
    // Gone for good: no revisions, recording rows, jobs, receipts or objects remain for this owner.
    // The only receipt left is the delete's own ({"deleted":true}); older ones were purged with the note.
    for (const t of ['revisions WHERE item_id = $2', 'recordings WHERE note_item_id = $2', 'transcript_clips WHERE note_item_id = $2', 'content_jobs WHERE true', "operations WHERE method NOT LIKE 'DELETE%'"]) {
      const r = await h.pool.query(`SELECT count(*)::int AS n FROM ${t.split(' WHERE ')[0]} WHERE owner_id = $1 AND ${t.split(' WHERE ')[1]}`, t.includes('$2') ? [session.ownerId, pendingNoteId] : [session.ownerId]);
      expect(r.rows[0]?.n).toBe(0);
    }
    for (const id of objectIds) expect(await h.objects.get(id).then(() => 'exists', () => 'gone')).toBe('gone');
  });

  it('a recording made offline uploads later with its own times', async () => {
    const { api } = await account();
    // Recorded two hours ago without a connection, and uploaded now: every piece and clip says where it was.
    const startedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const rec = await api.recordings.start({ title: 'Site visit', startedAt });
    expect(rec.getSnapshot()).toMatchObject({ title: 'Site visit', startedAt, status: 'recording' });
    for (const at of [0, 5, 10]) await rec.appendAudio(piece(audioBytes(`site-${at}`), 0, at / 5, at));
    await rec.transcribe(speech('We agreed to fix the gate first.', 0, 1));
    await rec.transcribe(speech('Ana will order the hinges by Monday.', 0, 7));
    expect(rec.getSnapshot().transcript.map((l) => [l.at, l.text])).toEqual([[1, 'We agreed to fix the gate first.'], [7, 'Ana will order the hinges by Monday.']]);
    // It lasted as long as its audio, not the two hours since it started.
    const { pendingNoteId, duration } = await rec.stop();
    expect(duration).toBe(15);
    await written(api, pendingNoteId);
    const note = await api.notes.get(pendingNoteId);
    expect(note).toMatchObject({ kind: 'room', title: 'Site visit', status: 'ready', startedAt, duration: 15 });
    expect(note.audio).toEqual([{ index: 0, pieces: 3, seconds: 15, mimeType: 'audio/webm;codecs=opus' }]);
    expect(note.transcript?.map((l) => [l.at, l.text])).toEqual([[1, 'We agreed to fix the gate first.'], [7, 'Ana will order the hinges by Monday.']]);
    expect(note.decisions.map((d) => [d.at, d.text])).toEqual([[1, 'We agreed to fix the gate first.']]);
    // Among the notes, it sits at the time it was recorded.
    expect((await api.notes.list({ kind: 'room' })).map((n) => [n.id, n.startedAt])).toEqual([[pendingNoteId, startedAt]]);
  });

  it('the same piece twice is stored once, when an interrupted upload starts again', async () => {
    const { api, fetch: own, session } = await account();
    const transcribed = () => h.near.calls.filter((x) => x.path.endsWith('/audio/transcriptions')).length;
    const heardBefore = transcribed();
    const startedAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const takes = [audioBytes('take-0'), audioBytes('take-1'), audioBytes('take-2')];
    const first = await api.recordings.start({ title: 'Workshop', startedAt });
    await first.appendAudio(piece(takes[0] ?? audioBytes(''), 0, 0));
    await first.appendAudio(piece(takes[1] ?? audioBytes(''), 0, 1));
    await first.transcribe(speech('We agreed to start with the roof.', 0, 1));
    // The tab closed mid-upload. Opened again, it starts from the same moment and sends everything again.
    const again = await api.recordings.start({ title: 'Workshop', startedAt });
    expect(again.getSnapshot()).toMatchObject({ id: first.getSnapshot().id, noteId: first.getSnapshot().noteId, recording: { pieces: 2, seconds: 10 } });
    for (const [seq, bytes] of takes.entries()) await again.appendAudio(piece(bytes, 0, seq));
    await again.appendAudio(piece(takes[2] ?? audioBytes(''), 0, 2)); // and a retry of the last one
    await again.transcribe(speech('We agreed to start with the roof.', 0, 1));
    await again.transcribe(speech('Ben brings the ladder.', 0, 9));
    // A different piece can't take the place of one already stored: one that starts elsewhere, or lasts longer or shorter.
    expect(code(await again.appendAudio(piece(audioBytes('not-take-1'), 0, 1, 6)).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await again.appendAudio({ ...piece(audioBytes('not-take-2'), 0, 2), durationMs: 4000 }).catch((e: unknown) => e))).toBe('conflict');
    const { pendingNoteId, duration } = await again.stop();
    expect(duration).toBe(15);
    expect((await first.stop()).pendingNoteId).toBe(pendingNoteId);
    // Once it has stopped, sending a stored piece again still changes nothing, and a new one is refused.
    await again.appendAudio(piece(takes[0] ?? audioBytes(''), 0, 0));
    expect(code(await again.appendAudio(piece(audioBytes('after-stop'), 0, 3)).catch((e: unknown) => e))).toBe('conflict');
    await written(api, pendingNoteId);

    // One note, with each piece once and in order, and each clip transcribed once.
    expect((await api.notes.list({ kind: 'room' })).map((n) => n.id)).toEqual([pendingNoteId]);
    const note = await api.notes.get(pendingNoteId);
    expect(note.audio).toEqual([expect.objectContaining({ index: 0, pieces: 3, seconds: 15 })]);
    expect(note.transcript?.map((l) => [l.at, l.text])).toEqual([[1, 'We agreed to start with the roof.'], [9, 'Ben brings the ladder.']]);
    expect(transcribed() - heardBefore).toBe(2);
    const audio = Buffer.from(await (await own(api.notes.audioUrl(pendingNoteId, 0))).arrayBuffer());
    expect(audio.equals(Buffer.concat(takes))).toBe(true);
    // The account's stored bytes count each piece once, the resends after stopping included.
    const kept = (await h.pool.query<{ pieces: number; bytes: string; stored: string }>(
      'SELECT count(*)::int AS pieces, sum(cipher_bytes)::text AS bytes, (SELECT stored_bytes::text FROM owners WHERE owner_id = $1) AS stored FROM recording_pieces WHERE owner_id = $1', [session.ownerId])).rows[0];
    expect(kept?.pieces).toBe(3);
    expect(kept?.stored).toBe(kept?.bytes);
  });

  it('starting from the same moment twice at once makes one recording, and only in your own account', async () => {
    const a = await account();
    const b = await account();
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const [x, y] = await Promise.all([a.api.recordings.start({ startedAt }), a.api.recordings.start({ startedAt })]);
    expect(y.getSnapshot().id).toBe(x.getSnapshot().id);
    expect((await a.api.notes.list()).map((n) => n.id)).toEqual([x.getSnapshot().noteId]);
    // Someone else's recording from the same moment is theirs, and neither can reach the other's.
    const theirs = await b.api.recordings.start({ startedAt });
    expect(theirs.getSnapshot().id).not.toBe(x.getSnapshot().id);
    expect(code(await b.api.notes.get(x.getSnapshot().noteId).catch((e: unknown) => e))).toBe('not-found');
    expect((await b.api.notes.list()).map((n) => n.id)).toEqual([theirs.getSnapshot().noteId]);
    const [p, q] = await Promise.all([x.stop(), y.stop()]);
    expect(q.pendingNoteId).toBe(p.pendingNoteId);
    await theirs.discard();
  });

  it('a call’s recording from the same moment isn’t carried on as a room recording', async () => {
    const { api, session } = await account();
    const call = await api.calls.join((await api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    const callNote = call.getSnapshot().notes.noteId ?? '';
    const found = (await h.pool.query<{ recording_id: string; started_at: Date }>('SELECT recording_id, started_at FROM recordings WHERE owner_id = $1 AND note_item_id = $2', [session.ownerId, callNote])).rows[0];
    expect(found?.recording_id).toBeTruthy();
    const rec = await api.recordings.start({ title: 'Same moment', startedAt: found?.started_at.toISOString() ?? '' });
    expect(rec.getSnapshot()).toMatchObject({ title: 'Same moment', status: 'recording', startedAt: found?.started_at.toISOString() });
    expect(rec.getSnapshot().id).not.toBe(found?.recording_id);
    expect(rec.getSnapshot().noteId).not.toBe(callNote);
    await rec.discard();
    await call.leave();
  });

  it('a start 15 days ago, or in the future, is refused as invalid', async () => {
    const b = await account();
    const DAY = 86_400_000;
    const from = (ms: number) => new Date(Date.now() + ms).toISOString();
    for (const startedAt of [from(-15 * DAY), from(10 * 60_000), from(3_600_000), 'yesterday']) {
      expect(code(await b.api.recordings.start({ startedAt }).catch((e: unknown) => e))).toBe('invalid');
    }
    expect(await b.api.notes.list()).toEqual([]);
    // Up to 14 days back is fine, and so is a device clock running a minute ahead of the server's.
    for (const startedAt of [from(-13 * DAY), from(60_000)]) await (await b.api.recordings.start({ startedAt })).discard();
    // An upload already under way can still finish once the recording is older than 14 days.
    const old = from(-13 * DAY);
    const rec = await b.api.recordings.start({ startedAt: old });
    const older = new Date(Date.parse(old) - 2 * DAY).toISOString();
    await h.pool.query('UPDATE recordings SET started_at = $3 WHERE owner_id = $1 AND recording_id = $2', [b.session.ownerId, rec.getSnapshot().id, older]);
    expect((await b.api.recordings.start({ startedAt: older })).getSnapshot().id).toBe(rec.getSnapshot().id);
    await rec.discard();
    expect(await b.api.notes.list()).toEqual([]);
  });
});

describe('credits', () => {
  it('the balance says how much was used this month', async () => {
    const { api, session } = await account();
    expect(await api.credits.balance()).toEqual({ balance: 10_000, granted: 10_000, usedThisMonth: 0, perMinute: 25 });

    // Notes written now are charged now: 25 credits a minute recorded, rounded up.
    const rec = await api.recordings.start({ title: 'Usage' });
    await rec.appendAudio(piece(audioBytes('usage'), 0, 0));
    await rec.transcribe(speech('We agreed to ship on Monday.', 0, 0));
    await written(api, (await rec.stop()).pendingNoteId);
    expect(await api.credits.balance()).toEqual({ balance: 9_975, granted: 10_000, usedThisMonth: 25, perMinute: 25 });

    // The month starts at 00:00 UTC on the 1st. A charge made the moment before counts against the balance
    // but not against this month; one made at that moment counts against both. The history is sealed under
    // the service key, so these are charged the way the notes worker charges, with the clock set to then.
    const { charge } = await import('./modules/billing');
    const now = new Date();
    const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    try {
      vi.useFakeTimers({ toFake: ['Date'], now: month - 1 });
      await charge(h.deps, h.pool, session.ownerId, { amount: 100, label: 'Notes, 4 min' });
      vi.setSystemTime(month);
      await charge(h.deps, h.pool, session.ownerId, { amount: 50, label: 'Notes, 2 min' });
    } finally {
      vi.useRealTimers();
    }
    expect(await api.credits.balance()).toEqual({ balance: 9_825, granted: 10_000, usedThisMonth: 75, perMinute: 25 });
  });
});

describe('deleting an account', () => {
  it('deleting an account removes everything it owns', async () => {
    const { maintain } = await import('./maintenance');
    // Lena signs in with Google in two browsers: her account keeps a Google connection (the calendar's tokens) and two sessions.
    const lena: GoogleUser = { sub: `g-leaving-${seq++}`, email: unique('lena'), name: 'Lena Leaving' };
    const tokensBefore = h.google.refreshTokens();
    const b = h.browser();
    await viaGoogle(b, lena);
    const elsewhere = h.browser();
    await viaGoogle(elsewhere, lena);
    const lenaToken = h.google.refreshTokens().filter((t) => !tokensBefore.includes(t));
    expect(lenaToken).toHaveLength(1);
    const ownerId = (await b.api.auth.getSession())?.ownerId ?? '';
    const guest = await account(unique('guest'));
    const ann = await account(unique('ann'));
    const kofi = await account(unique('kofi'));

    // What she organized: a call's notes and audio, which went to her guest, who pinned them; a call she
    // scheduled, on her calendar; her own pins and a group.
    const ended = await b.api.calls.join((await b.api.calls.startNow({ notes: 'on', guests: [guest.session.user.email] })).code, { mic: true, cam: false });
    await ended.appendAudio(piece(audioBytes('leaving-call'), 0, 0));
    const callNote = (await ended.leave())?.pendingNoteId ?? '';
    await written(b.api, callNote);
    await guest.api.account.updatePreferences({ pinned: [callNote] });
    await b.api.meetings.create({ title: 'Next week', startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), durationMinutes: 30, guests: [guest.session.user.email], notes: 'on' });
    await b.api.account.updatePreferences({ pinned: [callNote], groups: [{ id: 'crew', name: 'Crew', emails: [guest.session.user.email] }] });
    // A room recording whose notes are queued to be tried again...
    const rec = await b.api.recordings.start({ title: 'Waiting' });
    await rec.appendAudio(piece(audioBytes('leaving-room'), 0, 0));
    await rec.transcribe(speech('We agreed to leave on Friday.', 0, 0));
    h.near.failNext(1, 'prose');
    await rec.stop();
    await until(async () => (await h.pool.query("SELECT 1 FROM content_jobs WHERE owner_id = $1 AND state = 'queued' AND attempt = 1", [ownerId])).rowCount === 1, 'the first attempt to fail');
    // ...and a call still going, with notes on: its audio, the live transcript and a caption in German.
    const live = await b.api.calls.join((await b.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await live.appendAudio(piece(audioBytes('leaving-live'), 0, 0));
    await live.transcribe(speech('We are still talking.', 0, 0), live.ticket.identity);
    expect(await live.translate(live.getSnapshot().transcript.map((l) => l.id), 'de')).toHaveLength(1);
    // A chat line in it goes into the call's end-to-end encrypted log, and its LiveKit room is open.
    await until(async () => live.crypto.getSnapshot().status === 'in', 'her browser to be in the call’s group');
    await live.sendChat('Still here.');
    expect((await h.deps.livekit.existingRooms([live.ticket.roomName])).size).toBe(1);
    // Notes other people gave her: Ann invited her to one call, and shared another note with her, which she shared on with Kofi.
    const invitedTo = await noteFrom(ann, [lena.email]);
    const sharedWith = await noteFrom(ann);
    await ann.api.notes.share(sharedWith, { emails: [lena.email] });
    await b.api.notes.share(sharedWith, { emails: [kofi.session.user.email] });

    // Every table that keeps an account's rows has some of hers.
    const tables = (await h.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'owner_id' ORDER BY table_name")).rows.map((r) => r.table_name);
    expect(tables).toEqual([
      'billing_accounts', 'call_codes', 'call_mls', 'calls', 'content_jobs', 'identities', 'items', 'note_access', 'object_gc', 'operations', 'owners', 'recording_pieces',
      'recordings', 'revisions', 'screen_frames', 'sessions', 'transcript_clips', 'transcript_translations'
    ]);
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await h.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE owner_id = $1`, [ownerId])).rows[0]?.n ?? -1] as const)));
    const before = await counts();
    // Shared screens need someone sharing in a LiveKit room: deleting an account's frames is in screens.integration.test.ts.
    for (const t of tables) if (t !== 'object_gc' && t !== 'screen_frames') expect(before[t], t).toBeGreaterThan(0);
    expect((await h.pool.query<{ kind: string }>('SELECT DISTINCT kind FROM items WHERE owner_id = $1 ORDER BY kind', [ownerId])).rows.map((r) => r.kind)).toEqual(['connection', 'meeting', 'note', 'profile']);
    const [identity] = (await h.pool.query<{ email_index: Buffer }>('SELECT email_index FROM identities WHERE owner_id = $1', [ownerId])).rows;
    if (!identity) throw new Error('Lena has no sign-in identity');
    const givenToHer = async () => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM note_access WHERE email_index = $1', [identity.email_index])).rows[0]?.n;
    expect(await givenToHer()).toBe(2);
    const objects = (await h.pool.query<{ object_id: string }>('SELECT object_id FROM recording_pieces WHERE owner_id = $1', [ownerId])).rows.map((r) => r.object_id);
    expect(objects).toHaveLength(3);

    // Her call next week is on her Google calendar, and she has never asked Google to revoke anything.
    expect(h.google.calendar(lena.sub).map((e) => e.summary)).toEqual(['Next week']);
    expect(h.google.revocations()).not.toContain(lenaToken[0]);
    const googleCalls = h.google.calls.length;

    // She deletes her account, just as the object store refuses to delete one of her objects. Her audio is
    // deleted before Google is asked to revoke her grant, so a slow Google never holds it up.
    const realDelete = h.deps.objects.delete;
    let refused = '';
    const afterRevoke: string[] = [];
    h.deps.objects.delete = async (id) => {
      if (h.google.revocations().some((t) => lenaToken.includes(t))) afterRevoke.push(id);
      if (refused) return realDelete(id);
      refused = id;
      throw new Error('the store is busy');
    };
    try {
      await b.api.account.delete();
    } finally {
      h.deps.objects.delete = realDelete;
    }
    expect(afterRevoke).toEqual([]);

    // Her call next week was cancelled on Google (its guests are told), and Alcove's grant was revoked there.
    expect(h.google.calendar(lena.sub)).toEqual([]);
    expect(h.google.calls.slice(googleCalls).filter((c) => c.method === 'DELETE')).toEqual([{ method: 'DELETE', path: expect.stringContaining('/events/'), sendUpdates: 'all' }]);
    expect(h.google.revocations()).toEqual(expect.arrayContaining(lenaToken));
    expect(lenaToken.filter((t) => h.google.honours(t))).toEqual([]);
    expect(logLines().find((l) => l.msg === 'account deleted' && l['ownerId'] === ownerId)).toMatchObject({ calendarCancelled: 1, calendarKept: 0, calendarNotCancelled: 0, objects: 3 });

    // She's signed out in every browser, and her call is gone with her: its LiveKit room is closed, which takes everyone out.
    expect((await h.deps.livekit.existingRooms([live.ticket.roomName])).size).toBe(0);
    expect(await b.api.auth.getSession()).toBeNull();
    expect(await elsewhere.api.auth.getSession()).toBeNull();
    expect(code(await elsewhere.api.meetings.upcoming().catch((e: unknown) => e))).toBe('unauthenticated');
    await live.leave().catch(() => undefined);
    // Not one row of hers is left in any table, and nothing gives her address anyone's notes. Only the object
    // the store refused waits in object_gc, by its ID, until maintenance deletes it.
    expect(await counts()).toEqual({ ...Object.fromEntries(tables.map((t) => [t, 0])), object_gc: 1 });
    expect(await givenToHer()).toBe(0);
    const stored = (id: string) => h.objects.get(id).then(() => true, () => false);
    expect(await Promise.all(objects.map(stored))).toEqual(objects.map((id) => id === refused));
    await maintain(h.deps);
    expect(await stored(refused)).toBe(false);
    expect((await counts())['object_gc']).toBe(0);

    // The notes she organized are gone for everyone she gave them to, and off their pins.
    expect(code(await guest.api.notes.get(callNote).catch((e: unknown) => e))).toBe('not-found');
    expect((await guest.api.notes.list()).map((n) => n.id)).not.toContain(callNote);
    expect((await guest.api.account.preferences()).pinned).toEqual([]);
    // Ann's notes are still Ann's, without her on them. Kofi keeps the one she shared with him, which still says
    // she did: that's sealed in Ann's note, and deleting an account writes into nobody else's vault.
    expect((await ann.api.notes.get(invitedTo)).recipients.map((r) => r.person.email)).toEqual([ann.session.user.email]);
    expect((await ann.api.notes.get(sharedWith)).recipients.map((r) => [r.person.email, r.role])).toEqual([[ann.session.user.email, 'organizer'], [kofi.session.user.email, 'shared']]);
    expect((await kofi.api.notes.get(sharedWith)).received).toMatchObject({ role: 'shared', by: { name: 'Lena Leaving' } });

    // Signing in again with the same Google account starts a new, empty account with the welcome credits.
    const fresh = h.browser();
    expect(landed(await viaGoogle(fresh, lena))).toBe('/ready');
    expect((await fresh.api.auth.getSession())?.ownerId).not.toBe(ownerId);
    expect(await fresh.api.credits.balance()).toEqual({ balance: 10_000, granted: 10_000, usedThisMonth: 0, perMinute: 25 });
    expect(await fresh.api.notes.list()).toEqual([]);
    expect(await fresh.api.meetings.upcoming()).toEqual([]);
    expect(await fresh.api.account.preferences()).toMatchObject({ pinned: [], groups: [] });
  });

  it('another account at the same address keeps the notes given to that address', async () => {
    // One address, two accounts: single sign-on and Google. Notes go to the address, so both have them.
    const email = unique('twice');
    const sso = await account(email);
    const google = h.browser();
    await viaGoogle(google, { sub: `g-twice-${seq++}`, email, name: 'Twice Signed' });
    const ann = await account(unique('ann'));
    const noteId = await noteFrom(ann);
    await ann.api.notes.share(noteId, { emails: [email] });
    for (const b of [sso, google]) expect((await b.api.notes.list()).map((n) => n.id)).toContain(noteId);

    // Deleting one of them doesn't take the notes from the other, which still signs in with that address.
    await sso.api.account.delete();
    expect((await google.api.notes.get(noteId)).id).toBe(noteId);
    expect((await ann.api.notes.get(noteId)).recipients.map((r) => r.person.email)).toEqual([ann.session.user.email, email]);
  });

  const leaver = (n: string): GoogleUser => ({ sub: `g-leaving-${n}-${seq++}`, email: unique(n), name: `${n} Leaving` });
  /** Signs someone in with Google, with the refresh token Google issued them. */
  async function withGoogle(who: GoogleUser) {
    const before = h.google.refreshTokens();
    const b = h.browser();
    await viaGoogle(b, who);
    const [token = ''] = h.google.refreshTokens().filter((t) => !before.includes(t));
    return { ...b, ownerId: (await b.api.auth.getSession())?.ownerId ?? '', token };
  }
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  /** The API's log lines for one account, oldest first. */
  const loggedFor = (ownerId: string) => logLines().filter((l) => l['ownerId'] === ownerId);
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  /** The tables that still have rows of this account (none, once it's deleted). */
  async function leftOf(ownerId: string): Promise<string[]> {
    const tables = (await h.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'owner_id'")).rows.map((r) => r.table_name);
    const n = async (t: string) => (await h.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE owner_id = $1`, [ownerId])).rows[0]?.n ?? 0;
    return (await Promise.all(tables.map(async (t) => ((await n(t)) ? [t] : [])))).flat();
  }

  it('when Google fails, deletes the account all the same, and logs why without saying who', async () => {
    const who = leaver('mo');
    const mo = await withGoogle(who);
    for (const n of [1, 2]) await mo.api.meetings.create({ title: `Planning ${n}`, startsAt: days(n), durationMinutes: 30, guests: ['ola@guests.example'], notes: 'off' });
    expect(h.google.calendar(who.sub)).toHaveLength(2);

    // Mo withdraws Alcove's access at Google, and then deletes the account.
    h.google.revoke(who.sub);
    await mo.api.account.delete();

    // Everything is deleted all the same.
    expect(await mo.api.auth.getSession()).toBeNull();
    expect(await leftOf(mo.ownerId)).toEqual([]);
    // Google refused, so both calls are still on its calendar. The warning says so, and why (not "unknown"),
    // with no token and nobody's address.
    expect(h.google.calendar(who.sub)).toHaveLength(2);
    const lines = loggedFor(mo.ownerId);
    expect(lines.find((l) => l.msg === 'calendar events not cancelled')).toMatchObject({ level: 40, cancelled: 0, notCancelled: 2, err: { type: 'UnavailableError', code: 'unavailable', message: 'Google Calendar isn’t connected.' } });
    expect(lines.find((l) => l.msg === 'google grant not revoked')).toMatchObject({ level: 40, status: 400, googleError: 'invalid_token' });
    expect(lines.find((l) => l.msg === 'account deleted')).toMatchObject({ calendarCancelled: 0, calendarNotCancelled: 2 });
    expect(JSON.stringify(lines)).not.toContain(mo.token);
    expect(JSON.stringify(lines).match(EMAIL) ?? []).toEqual([]);
  });

  it('cancels every call still on, begun or not, and leaves an event moved from the calendar as it was', async () => {
    const who = leaver('cleo');
    const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
    // Her own event, made in Google Calendar, which she moved to Alcove.
    h.google.calendar(who.sub).push({
      id: 'her-own', summary: 'Board prep', description: 'Agenda: the budget.', start: { dateTime: minutes(120) }, end: { dateTime: minutes(150) },
      organizer: { email: who.email, self: true }, attendees: [{ email: who.email, self: true }, { email: 'board@guests.example' }]
    });
    const cleo = await withGoogle(who);
    const moved = await cleo.api.calendar.adopt('her-own', 'off');
    // A call whose time has come but hasn't started, and one she started early.
    await cleo.api.meetings.create({ title: 'Ten minutes in', startsAt: minutes(-10), durationMinutes: 30, guests: ['ann@guests.example'], notes: 'off' });
    const early = await cleo.api.meetings.create({ title: 'Tomorrow, begun now', startsAt: days(1), durationMinutes: 30, guests: ['ben@guests.example'], notes: 'off' });
    const live = await cleo.api.calls.join(early.code, { mic: true, cam: false });
    expect((await cleo.api.meetings.upcoming()).map((m) => m.status).sort()).toEqual(['live', 'scheduled', 'scheduled']);
    const own = structuredClone(h.google.calendar(who.sub).find((e) => e.id === 'her-own'));
    expect(own?.location).toBe(`${ORIGIN}/join/${moved.code}`);
    const before = h.google.calls.length;

    await cleo.api.account.delete();
    await live.leave().catch(() => undefined);

    // Both calls are cancelled on Google, which tells their guests.
    expect(h.google.calls.slice(before).filter((c) => c.method === 'DELETE').map((c) => c.sendUpdates)).toEqual(['all', 'all']);
    // Her own event stays on her calendar as it was, Alcove link and all, though the link leads nowhere now.
    expect(h.google.calendar(who.sub)).toEqual([own]);
    expect(loggedFor(cleo.ownerId).find((l) => l.msg === 'account deleted')).toMatchObject({ calendarCancelled: 2, calendarKept: 1, calendarNotCancelled: 0 });
    expect(await (await withGoogle(who)).api.meetings.byCode(moved.code)).toBeNull();
  });

  it('when Google stops answering, waits seconds, not minutes, and deletes the account', async () => {
    const who = leaver('dan');
    const dan = await withGoogle(who);
    for (const n of [1, 2]) await dan.api.meetings.create({ title: `Review ${n}`, startsAt: days(n), durationMinutes: 30, guests: ['pia@guests.example'], notes: 'off' });
    const before = h.google.calls.length;

    h.google.unresponsive(true);
    const t0 = performance.now();
    try {
      await dan.api.account.delete();
    } finally {
      h.google.unresponsive(false);
    }

    // Cancelling stopped at the first call Google didn't answer, and the revoke had a few seconds of its own:
    // about 11 seconds in all. Then everything was gone.
    expect(performance.now() - t0).toBeLessThan(14_000);
    expect(h.google.calls.slice(before).map((c) => c.method)).toEqual(['DELETE']);
    expect(h.google.calendar(who.sub)).toHaveLength(2);
    expect(h.google.revocations()).toContain(dan.token);
    expect(await leftOf(dan.ownerId)).toEqual([]);
    const lines = loggedFor(dan.ownerId);
    expect(lines.find((l) => l.msg === 'calendar events not cancelled')).toMatchObject({ level: 40, cancelled: 0, notCancelled: 2, err: { name: 'TimeoutError' } });
    expect(lines.find((l) => l.msg === 'google grant not revoked')).toMatchObject({ level: 40, err: { name: 'TimeoutError' } });
    expect(JSON.stringify(lines).match(EMAIL) ?? []).toEqual([]);
  });

  it('a deletion that loses the race to another finds nothing left to delete', async () => {
    const racer = await account(unique('racer'));
    const ownerId = racer.session.ownerId;
    const hold = await h.pool.connect();
    const gate = await h.pool.connect();
    const pidOf = async (c: typeof hold) => (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid ?? 0;
    /** Whether some other backend waits for a lock this one holds or has asked for first. */
    const blocks = async (pid: number) => ((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])).rows[0]?.n ?? 0) > 0;
    const outcome = (p: Promise<void>) => p.then(() => 'deleted', (e: unknown) => code(e));
    try {
      // The first deletion is held just before it commits, on the account's billing row, which goes with the account.
      await hold.query('BEGIN');
      await hold.query('SELECT 1 FROM billing_accounts WHERE owner_id = $1 FOR UPDATE', [ownerId]);
      const first = outcome(racer.api.account.delete());
      await until(async () => blocks(await pidOf(hold)), 'the first deletion to wait');
      // The second arrives signed in, as the account is still there, and reaches the account's profile only once
      // the first has committed: a lock on the items table, asked for behind the first deletion, holds it back.
      await gate.query('BEGIN');
      const gatePid = await pidOf(gate);
      const gated = gate.query('LOCK TABLE items IN ACCESS EXCLUSIVE MODE');
      await until(async () => (await h.pool.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = $2', [gatePid, 'Lock'])).rowCount === 1, 'the gate to wait');
      const second = outcome(racer.api.account.delete());
      await until(() => blocks(gatePid), 'the second deletion to wait at the gate');
      await hold.query('COMMIT');
      await gated;
      await gate.query('COMMIT');
      expect([await first, await second]).toEqual(['deleted', 'deleted']);
    } finally {
      for (const c of [hold, gate]) { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
    }
    expect(loggedFor(ownerId).filter((l) => l.msg === 'account already deleted')).toHaveLength(1);
  });
});

describe('the shared demo account', () => {
  it('can’t be deleted', async () => {
    const demo = h.browser();
    await demo.api.auth.signIn('microsoft');
    const refused = await demo.api.account.delete().catch((e: unknown) => e);
    expect(code(refused)).toBe('forbidden');
    expect(refused).toMatchObject({ message: 'This is the shared demo account, so it can’t be deleted.' });
    // Still signed in, with its sample calendar.
    expect((await demo.api.auth.getSession())?.sample).toBe(true);
    expect((await demo.api.meetings.upcoming()).length).toBeGreaterThan(0);
  });
});

describe('privacy at rest', () => {
  it('keeps names, emails, titles, guests, chat, groups and audio out of rows, objects and logs in any encoding', async () => {
    // Watch the wire for the session cookies a browser receives, so the logs can be checked for them too.
    const secrets: string[] = [];
    /** A browser whose session and sign-in cookies are collected, to check none of them reach the logs. */
    const tapped = () => {
      const jar = cookieFetch(ORIGIN);
      const tap: typeof fetch = async (input, init) => {
        const res = await jar(input, init);
        for (const name of [cookieName(true), '__Host-alcove_google']) {
          const cookie = new RegExp(`${name}=([^;]+)`).exec(res.headers.get('set-cookie') ?? '')?.[1];
          if (cookie) secrets.push(cookie);
        }
        return res;
      };
      return h.browser({ fetch: tap });
    };
    const c = tapped();
    const { session } = await c.api.auth.signIn('sso', { email: 'canary-person@canary.example' });
    expect(session.user.name).toBe('Canary Person');
    const m = await c.api.meetings.create({ title: 'CANARY-TITLE secret merger', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: ['canary-guest@example.com'], notes: 'on' });
    await c.api.meetings.update(m.id, { title: 'CANARY-EDIT renamed merger' });
    const call = await c.api.calls.join((await c.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: true });
    await call.appendAudio(piece(audioBytes('CANARY-AUDIO-RAW'), 0, 0));
    await call.transcribe(speech('CANARY-SPEECH the merger closes on Friday.', 0, 0), call.ticket.identity);
    expect(call.getSnapshot().transcript.map((l) => l.text)).toEqual(['CANARY-SPEECH the merger closes on Friday.']);
    // While the call is on, the live transcript is sealed rows too.
    const liveClips = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM transcript_clips x`)).rows[0]?.all ?? '');
    expect(liveClips).not.toBe('');
    await call.sendChat('CANARY-CHAT private remark');
    expect(call.crypto.getSnapshot().chat.map((m) => m.text)).toEqual(['CANARY-CHAT private remark']);
    // Captions in another language, and breakout room names and messages, are sealed too.
    expect((await call.translate(call.getSnapshot().transcript.map((l) => l.id), 'de'))[0]?.text).toContain('CANARY-SPEECH');
    call.openRooms({ rooms: [{ name: 'CANARY-BREAKOUT one', emails: [] }, { name: 'CANARY-BREAKOUT two', emails: [] }], minutes: 5 });
    await settle(call, (x) => x.breakouts.open !== null);
    call.messageRooms('CANARY-BROADCAST to every room');
    await settle(call, (x) => x.breakouts.open?.message !== null);
    const caught = await call.catchUp({ kind: 'all' });
    expect(caught.read.lines).toBe(1);
    await call.askSoFar('What closes on Friday? CANARY-ASKED', { kind: 'all' });
    await call.catchUpWindow();
    await call.moment(call.getSnapshot().transcript[0]?.id ?? '');
    const translations = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM transcript_translations x`)).rows[0]?.all ?? '');
    expect(translations).not.toBe('');
    const callRows = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM calls x`)).rows[0]?.all ?? '');
    const live = `${liveClips} ${translations} ${callRows}`;
    await call.leave();
    const rec = await c.api.recordings.start({ title: 'Room' });
    rec.rename('CANARY-ROOM title');
    await rec.transcribe(speech('CANARY-SPEECH in the room.', 0, 0));
    await new Promise((r) => setTimeout(r, 150));
    const { pendingNoteId: roomNote } = await rec.stop();
    await written(c.api, roomNote);
    // A question across every note: it goes sealed to the notes model and is kept nowhere.
    expect((await askedAll(c.api, 'CANARY-ASKED across notes: what was said in the room?'))[0]?.type).toBe('text');
    // A group: its name and members stay sealed in the profile; sharing with it carries the name, sealed in the note.
    const members = ['canary-member-one@example.com', 'canary-member-two@example.com'];
    await c.api.account.updatePreferences({ groups: [{ id: 'launch-crew', name: 'CANARY-GROUP-launch crew', emails: members }] });
    await c.api.notes.share(roomNote, { emails: members, group: 'CANARY-GROUP-launch crew' });
    const member = tapped();
    await member.api.auth.signIn('sso', { email: 'canary-member-one@example.com' });
    expect((await member.api.notes.list()).find((n) => n.id === roomNote)?.received).toMatchObject({ role: 'shared', group: 'CANARY-GROUP-launch crew' });
    await c.api.notes.list({ text: 'CANARY-SEARCH words' });
    await c.api.people.search('CANARY-PEOPLE query');
    // And someone who signs in with Google: their Google account ID, name, address and photo stay sealed too,
    // and so does the call they put on their Google Calendar.
    const g = tapped();
    const issuedBefore = h.google.refreshTokens();
    expect(landed(await viaGoogle(g, { sub: 'canary-google-sub-31337', email: 'canary.googler@canary.example', name: 'Canary Googler', picture: 'https://lh3.googleusercontent.com/a/canary-photo' }))).toBe('/ready');
    const googlerToken = h.google.refreshTokens().filter((t) => !issuedBefore.includes(t));
    expect(googlerToken).toHaveLength(1);
    expect((await g.api.meetings.create({ title: 'CANARY-GCAL planning', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: ['canary-gcal-guest@canary.example'], notes: 'off' })).calendarUrl).toMatch(/^https:/);
    // A series: a question its call left open, the next call in it, and a question asked across it. A
    // recurring Google event's ID, which names its series, stays sealed and out of logged paths.
    const sync = await c.api.calls.join((await c.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await sync.transcribe(speech('CANARY-QUESTION who signs the merger?', 0, 0), sync.ticket.identity);
    const synced = await sync.leave();
    await written(c.api, synced?.pendingNoteId ?? '');
    expect((await c.api.notes.get(synced?.pendingNoteId ?? '')).questions.map((x) => x.text)).toEqual(['CANARY-QUESTION who signs the merger?']);
    const following = await c.api.meetings.scheduleNext(sync.getSnapshot().meetingId, new Date(Date.now() + 7 * 86_400_000).toISOString());
    for await (const part of c.api.series.ask(following.seriesId ?? '', 'CANARY-SERIES-ASK who signs it?', 'Europe/London')) expect(part.type).toMatch(/text|source/);
    const tomorrow = Date.now() + 86_400_000;
    const when = { start: { dateTime: new Date(tomorrow).toISOString() }, end: { dateTime: new Date(tomorrow + 1_800_000).toISOString() } };
    h.google.calendar('canary-google-sub-31337').push(
      { id: 'canary-recurring-id_1', recurringEventId: 'canary-recurring-id', summary: 'Standing call', ...when, organizer: { email: 'canary.googler@canary.example', self: true } },
      { id: 'canary-theirs-event', summary: 'Their call', ...when, organizer: { email: 'boss@canary.example' } },
      { id: 'canary-allday-event', summary: 'Offsite', start: { date: new Date(tomorrow).toISOString().slice(0, 10) }, end: { date: new Date(tomorrow + 86_400_000).toISOString().slice(0, 10) }, organizer: { email: 'canary.googler@canary.example', self: true } }
    );
    expect((await g.api.calendar.adopt('canary-recurring-id_1', 'off')).seriesId).toBeTruthy();
    // Adopts that are refused (someone else's event, an all-day one, one that isn't there) keep the event's ID out of the logs too.
    const refusals: [string, string][] = [['canary-theirs-event', 'forbidden'], ['canary-allday-event', 'not-found'], ['canary-missing-event', 'not-found']];
    for (const [id, refusal] of refusals) expect(code(await g.api.calendar.adopt(id).catch((e: unknown) => e))).toBe(refusal);

    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM owners x UNION ALL SELECT row_to_json(x)::text FROM identities x UNION ALL
      SELECT row_to_json(x)::text FROM sessions x UNION ALL SELECT row_to_json(x)::text FROM items x UNION ALL
      SELECT row_to_json(x)::text FROM revisions x UNION ALL SELECT row_to_json(x)::text FROM calls x UNION ALL
      SELECT row_to_json(x)::text FROM recordings x UNION ALL SELECT row_to_json(x)::text FROM recording_pieces x UNION ALL
      SELECT row_to_json(x)::text FROM billing_accounts x UNION ALL SELECT row_to_json(x)::text FROM content_jobs x UNION ALL
      SELECT row_to_json(x)::text FROM operations x UNION ALL SELECT row_to_json(x)::text FROM note_access x UNION ALL
      SELECT row_to_json(x)::text FROM transcript_clips x UNION ALL SELECT row_to_json(x)::text FROM transcript_translations x UNION ALL
      SELECT row_to_json(x)::text FROM screen_frames x) q`);
    const rowsText = `${String(dump.rows[0]?.all ?? '')} ${live}`;
    // bytea renders as hex; our records embed base64url; check every encoding a plaintext bug could produce.
    const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
    const canaries = [
      'canary-person', 'Canary Person', 'CANARY-TITLE', 'CANARY-EDIT', 'canary-guest', 'CANARY-CHAT', 'CANARY-AUDIO', 'CANARY-ROOM', 'CANARY-SEARCH', 'CANARY-PEOPLE', 'CANARY-SPEECH', 'merger closes',
      'CANARY-BREAKOUT', 'CANARY-BROADCAST', 'CANARY-GROUP', 'canary-member', 'CANARY-ASKED',
      'Welcome credits', 'Art Vandelay', 'vandelay', 'Weekly with Theo', 'lumen.health',
      'canary-google-sub', 'canary.googler', 'Canary Googler', 'canary-photo', 'CANARY-GCAL', 'canary-gcal',
      'CANARY-QUESTION', 'CANARY-SERIES-ASK', 'CANARY-ASKED', 'canary-recurring-id', 'canary-theirs-event', 'canary-allday-event', 'canary-missing-event'
    ];
    for (const canary of canaries) for (const enc of encodings(canary)) expect(rowsText.includes(enc), `${canary} as ${enc}`).toBe(false);

    // Every object in the bucket, not only the referenced ones.
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const canary of canaries) for (const enc of encodings(canary)) expect(bytes.includes(Buffer.from(enc)), `${canary} in ${obj.id}`).toBe(false);
    }

    // Deleting an account logs IDs and counts, like everything else: nothing of who it was. It happens after
    // the scans of rows and objects above, so the deleted accounts' rows were part of them. Deleting the
    // Googler's cancels the call Alcove put on their Google Calendar, leaves their own events there (the one
    // they moved to Alcove too), and has Google revoke their refresh token; the log check below covers that
    // token too.
    await member.api.account.delete();
    await g.api.account.delete();
    expect(h.google.calendar('canary-google-sub-31337').map((e) => e.id)).toEqual(['canary-recurring-id_1', 'canary-theirs-event', 'canary-allday-event']);
    expect(googlerToken.filter((t) => h.google.honours(t))).toEqual([]);

    // And NEAR AI: the clips, transcripts, titles, names and questions it was sent crossed the wire sealed
    // to the verified models, never readable, though the models themselves read them (the fake's prompts).
    expect(h.near.prompts.some((p) => p.includes('CANARY-SPEECH'))).toBe(true);
    const wire = Buffer.concat(h.near.received.map((r) => r.body));
    for (const canary of [...canaries, 'What closes on Friday']) for (const enc of encodings(canary)) expect(wire.includes(Buffer.from(enc)), `${canary} as ${enc} on the wire to NEAR AI`).toBe(false);
    expect(h.near.calls.filter((x) => x.encryption === 'none')).toEqual([]);

    // And the logs, which ran at debug level for this whole flow: no content, no emails, no session cookies.
    expect(secrets.length).toBeGreaterThanOrEqual(1);
    const logText = h.logs.join('');
    expect(logText).toContain(session.ownerId);
    for (const canary of canaries) for (const enc of encodings(canary)) expect(logText.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
    for (const secret of secrets) expect(logText.includes(secret), 'a session cookie in logs').toBe(false);
    // Logs are built to leave the confidential VM: no email address of anyone, ever, and no client address.
    expect(logText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []).toEqual([]);
    expect(logText.match(/\b10\.1\.\d{1,3}\.\d{1,3}\b/g) ?? []).toEqual([]);
    // Google refresh tokens are sealed in the vault and never logged: every one Google issued, revoked ones too.
    expect(h.google.refreshTokens()).toEqual(expect.arrayContaining(googlerToken));
    for (const t of h.google.refreshTokens()) {
      for (const enc of encodings(t)) expect(rowsText.includes(enc), 'a refresh token in rows').toBe(false);
      expect(logText.includes(t), 'a refresh token in logs').toBe(false);
    }
    expect(logText).not.toContain(m.code);
  });
});

describe('confidential computing', () => {
  it('says plainly when it isn’t running in a TEE, and which build it is', async () => {
    const nonce = randomBytes(32).toString('hex');
    expect(await h.browser().api.trust.attestation(nonce)).toEqual({ tee: 'none', nonce, build: { commit: 'dev' } });
    expect((await h.browser().fetch(`${h.baseUrl}/v1/attestation?nonce=not-hex`)).status).toBe(400);
    expect(await (await fetch(`${h.baseUrl}/health`)).json()).toMatchObject({ ok: true, tee: 'none', commit: 'dev' });
  });

  it('inside a TEE takes its keys only from the TEE, and attests to its build with the verifier’s nonce', async () => {
    const tee = await startFakeDstack();
    try {
      // Whoever can set the environment would hold keys put there, so inside a TEE they're refused.
      await expect(loadConfig({ ...process.env, TEE: 'dstack', DSTACK_SOCKET: tee.socket })).rejects.toThrow(/key service/);
      const withoutKeys = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'KMASTER' && k !== 'KSERVICE'));
      const cfg = await loadConfig({ ...withoutKeys, TEE: 'dstack', DSTACK_SOCKET: tee.socket, ALCOVE_COMMIT: 'abc1234' });
      expect([cfg.KMASTER, cfg.KSERVICE]).toEqual([tee.key('alcove/kmaster/v1'), tee.key('alcove/kservice/v1')]);
      await expect(loadConfig({ ...withoutKeys, TEE: 'none' })).rejects.toThrow(/required outside a TEE/);
      // So would whoever sets the roots inference is verified against, or the services it's checked with.
      const { INTEL_ROOT_CA, NVIDIA_ROOT_CA, INTEL_PCS_URL, NVIDIA_NRAS_URL } = h.near.settings;
      for (const [name, value] of Object.entries({ INTEL_ROOT_CA, NVIDIA_ROOT_CA, INTEL_PCS_URL, NVIDIA_NRAS_URL })) {
        await expect(loadConfig({ ...withoutKeys, TEE: 'dstack', DSTACK_SOCKET: tee.socket, [name]: value })).rejects.toThrow(new RegExp(`${name}: inside a TEE, inference is verified only against the built-in roots`));
      }

      const server = await h.secondServer({ TEE: 'dstack', DSTACK_SOCKET: tee.socket, ALCOVE_COMMIT: 'abc1234' });
      try {
        const nonce = randomBytes(32).toString('hex');
        const a = await createHttpApi({ baseUrl: server.baseUrl, fetch: cookieFetch(ORIGIN) }).trust.attestation(nonce);
        if (a.tee !== 'dstack') throw new Error('expected a TEE attestation');
        const expected = createHash('sha512').update(`alcove-attestation/v1\n${nonce}\nabc1234`).digest('hex');
        expect(a).toMatchObject({ nonce, build: { commit: 'abc1234' }, reportData: expected, appId: tee.appId, instanceId: 'fake-instance', composeHash: 'ab'.repeat(32) });
        // The quote vouches for exactly that: this nonce and this build.
        expect(a.quote.endsWith(expected)).toBe(true);
        expect(JSON.parse(a.eventLog)).toEqual([expect.objectContaining({ imr: 3, event: 'compose-hash' })]);
      } finally {
        await server.close();
      }
    } finally {
      await tee.close();
    }
  });
});

describe('maintenance', () => {
  it('refuses a database whose applied migrations were edited or removed', async () => {
    const { migrate } = await import('./migrate');
    expect(await migrate(h.pool)).toEqual([]);
    const [row] = (await h.pool.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations ORDER BY name LIMIT 1')).rows;
    if (!row) throw new Error('no migrations recorded');
    // As if the file had been edited in place after this database was built.
    await h.pool.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [row.name, 'edited-since']);
    await expect(migrate(h.pool)).rejects.toThrow(/changed after it was applied/);
    // As if a migration had been deleted.
    await h.pool.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [row.name, row.checksum]);
    await h.pool.query("INSERT INTO schema_migrations (name, checksum) VALUES ('0099_gone.sql', 'x')");
    await expect(migrate(h.pool)).rejects.toThrow(/no longer in the repository/);
    await h.pool.query("DELETE FROM schema_migrations WHERE name = '0099_gone.sql'");
    expect(await migrate(h.pool)).toEqual([]);
  });

  it('removes ended sessions and unreferenced objects', async () => {
    const { maintain } = await import('./maintenance');
    const a = await account();
    await h.pool.query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE owner_id = $1`, [a.session.ownerId]);
    await h.objects.put('orphanorphanorphan0000', new Uint8Array([1, 2, 3]));
    // The object store's clock can run a few milliseconds ahead of ours.
    await new Promise((r) => setTimeout(r, 1100));
    const r = await maintain(h.deps, { orphanAgeMs: 0 });
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect(r.orphans).toBeGreaterThanOrEqual(1);
    expect(await a.api.auth.getSession()).toBeNull();
    expect(await h.objects.get('orphanorphanorphan0000').then(() => 'exists', () => 'gone')).toBe('gone');
  });
});

describe('logging and errors', () => {
  it('ties a failed request to its log line by request ID, with the error class and context', async () => {
    const events: ClientEvent[] = [];
    const c = h.browser({ onEvent: (e) => events.push(e) });
    await c.api.auth.signIn('sso', { email: unique('logs') });

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
    const { api, fetch } = await account();
    const { code: callCode } = await api.calls.startNow();
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
    const { api } = await account();
    const call = await api.calls.join((await api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
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
    await call.leave();
  });
});
