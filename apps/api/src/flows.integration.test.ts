/**
 * End-to-end flows against the real API, Postgres and object store (see AGENTS.md: integration
 * tests only). Each test signs in through the API like the web app does. Leakage checks plant
 * canaries and confirm they never reach database rows, stored objects or logs in plaintext.
 */
import { AlcoveApiError, OPERATION_HEADER, REQUEST_ID_HEADER, firstName, type AudioPiece, type CallSession, type CallState } from '@alcove/api';
import type { ClientEvent } from '@alcove/api-http';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieName } from './sessions';
import type { GoogleUser, Spoil } from './testing/fake-google';
import { ORIGIN, cookieFetch, startHarness, type Browser, type Harness } from './testing/harness';

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
let seq = 0;
/** A work email nobody has used yet in this run. */
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh account: single sign-on signs in whoever's work email is typed. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, isNew: r.isNew };
}
/** Waits until optimistic call actions have been confirmed by the server. */
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) await new Promise((r) => setTimeout(r, 30));
  return call.getSnapshot();
}
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
    expect(await first.api.credits.balance()).toEqual({ balance: 10_000, granted: 10_000, perMinute: 25 });

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

  it('signs in with single sign-on as whoever’s work email was typed', async () => {
    const r = await h.browser().api.auth.signIn('sso', { email: '  Dana.Wu@Harbourline.co ' });
    expect(r).toMatchObject({ isNew: true, session: { provider: 'sso', user: { name: 'Dana Wu', email: 'dana.wu@harbourline.co' } } });
    expect(r.session.user.photoUrl).toBeUndefined();
    expect(r.session.user.portrait).toBeDefined();
    const back = await h.browser().api.auth.signIn('sso', { email: 'dana.wu@harbourline.co' });
    expect([back.isNew, back.session.ownerId]).toEqual([false, r.session.ownerId]);
    expect(code(await h.browser().api.auth.signIn('sso').catch((e: unknown) => e))).toBe('invalid');
    expect(code(await h.browser().api.auth.signIn('sso', { email: 'not-an-email' }).catch((e: unknown) => e))).toBe('invalid');
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

  it('keeps the notes default, and new calls start with it', async () => {
    const { api } = await account();
    expect(await api.account.preferences()).toEqual({ notesDefault: 'on' });
    expect(await api.account.updatePreferences({ notesDefault: 'off' })).toEqual({ notesDefault: 'off' });
    const call = await api.calls.join((await api.calls.startNow()).code, { mic: true, cam: false });
    expect(call.getSnapshot().notes.status).toBe('off');
    await call.leave();
  });
});

describe('signing in with Google', () => {
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
    const ben: GoogleUser = { sub: '104412233445566778899', email: 'Ben.Kay@Example.com', name: 'Ben Kay', picture: 'https://lh3.googleusercontent.com/a/ben-1' };
    const host = await account();
    const call = await host.api.calls.join((await host.api.calls.startNow({ notes: 'on', guests: ['ben.kay@example.com'] })).code, { mic: true, cam: false });
    await call.appendAudio(piece(audioBytes('for-ben'), 0, 0));
    const noteId = call.getSnapshot().notes.noteId ?? '';
    await call.leave();

    // His first sign-in creates his account from what Google verified, and lands on the welcome step.
    expect(landed(await viaGoogle(b, ben))).toBe('/ready');
    const s = await b.api.auth.getSession();
    expect(s).toMatchObject({ provider: 'google', sample: false, user: { name: 'Ben Kay', email: 'ben.kay@example.com', photoUrl: 'https://lh3.googleusercontent.com/a/ben-1' } });
    // A real account starts with no sample calls and no sample directory: its calendar is Google's.
    expect(await b.api.meetings.upcoming()).toEqual([]);
    expect(await b.api.people.team()).toBeNull();
    // The notes he was invited to are his, because Google verified that address.
    expect((await b.api.notes.list()).map((n) => n.id)).toContain(noteId);

    // Again, in another browser: the same account, straight to Home, with the photo Google has now.
    const later = h.browser();
    expect(landed(await viaGoogle(later, { ...ben, picture: 'https://lh3.googleusercontent.com/a/ben-2' }))).toBe('/home');
    expect(await later.api.auth.getSession()).toMatchObject({ ownerId: s?.ownerId, user: { photoUrl: 'https://lh3.googleusercontent.com/a/ben-2' } });
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
    await account('jordan.lee@harbourline.co');
    expect((await art.api.people.search('jordan.lee@harbourline.co'))[0]).toMatchObject({ source: 'new', onAlcove: true });
  });

  it('shows the company directory and invites colleagues', async () => {
    const art = h.browser();
    await art.api.auth.signIn('microsoft');
    const team = await art.api.people.team();
    expect(team).toMatchObject({ name: 'Vandelay Industries', domain: 'vandelay.industries' });
    expect(team?.members.map((m) => [m.person.name, m.onAlcove, m.invited])).toEqual([['Theo Martin', true, false], ['Kofi Asante', true, false], ['Sam Ortiz', false, false], ['Lena Fischer', false, false]]);
    const after = await art.api.people.inviteToTeam(['sam@vandelay.industries', 'lena@vandelay.industries']);
    expect(after.members.filter((m) => m.invited).map((m) => m.person.name)).toEqual(['Sam Ortiz', 'Lena Fischer']);
    expect(code(await art.api.people.inviteToTeam(['someone@elsewhere.example']).catch((e: unknown) => e))).toBe('invalid');

    const outsider = await account();
    expect(await outsider.api.people.team()).toBeNull();
    expect(code(await outsider.api.people.inviteToTeam(['sam@vandelay.industries']).catch((e: unknown) => e))).toBe('invalid');
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
    expect(s.notes).toMatchObject({ status: 'on', everOn: true });
    expect(s.notes.noteId).toBeTruthy();
    expect(s.isOrganizer).toBe(true);
    expect(s.participants).toEqual([expect.objectContaining({ isMe: true, isOrganizer: true })]);

    const seg0 = [audioBytes('CANARY-AUDIO-0'), audioBytes('CANARY-AUDIO-1')];
    await call.appendAudio(piece(seg0[0] ?? audioBytes(''), 0, 0));
    await call.appendAudio(piece(seg0[1] ?? audioBytes(''), 0, 1));
    await call.appendAudio(piece(seg0[1] ?? audioBytes(''), 0, 1)); // retry of the same piece is a no-op
    expect(call.getSnapshot().notes.recording).toEqual({ segment: 0, pieces: 2, seconds: 10 });

    call.setNotes(false);
    await settle(call, (x) => x.notes.status === 'off');
    expect(code(await call.appendAudio(piece(audioBytes('x'), 0, 2)).catch((e: unknown) => e))).toBe('conflict');
    call.setNotes(true);
    s = await settle(call, (x) => x.notes.status === 'on' && x.notes.recording.segment === 1);
    expect(s.notes.recording.segment).toBe(1);
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
    expect(note).toMatchObject({ kind: 'call', status: 'pending', title: `${firstName(session.user.name)}’s call` });
    expect(note.audio.map((a) => [a.index, a.pieces])).toEqual([[0, 2], [1, 1]]);

    // The decrypted segment is exactly the concatenation of what was recorded, and only for this account.
    expect((await h.browser().fetch(api.notes.audioUrl(noteId, 0))).status).toBe(401);
    const mine = await own(api.notes.audioUrl(noteId, 0));
    expect(Buffer.from(await mine.arrayBuffer()).equals(Buffer.concat(seg0))).toBe(true);

    expect((await api.meetings.past())[0]).toMatchObject({ status: 'ended', noteId });
    expect((await api.notes.list()).map((n) => n.id)).toContain(noteId);
    expect(code(await (async () => { for await (const p of api.notes.ask(noteId, 'What happened?')) void p; })().catch((e: unknown) => e))).toBe('unavailable');
  });

  it('joins a call without notes and leaves no note behind', async () => {
    const { api } = await account();
    const call = await api.calls.join((await api.calls.startNow({ notes: 'off' })).code, { mic: true, cam: false });
    expect(call.getSnapshot().notes.status).toBe('off');
    expect((await call.leave()).pendingNoteId).toBeNull();
    expect(await api.notes.list()).toEqual([]);
  });

  it('keeps every owner’s calls, notes, audio and recordings out of reach of other accounts', async () => {
    const a = await account();
    const b = await account();
    const { code: c } = await a.api.calls.startNow();
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

describe('who has the notes', () => {
  it('gives the notes to everyone invited when the call ends, and lets anyone with them share them on', async () => {
    const org = await account(unique('organizer'));
    const guestEmail = unique('guest');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [guestEmail] });
    const call = await org.api.calls.join(c, { mic: true, cam: false });
    await call.appendAudio(piece(audioBytes('shared-audio'), 0, 0));
    const noteId = call.getSnapshot().notes.noteId ?? '';
    expect(code(await org.api.notes.share(noteId, [unique()]).catch((e: unknown) => e))).toBe('invalid');

    // Nobody invited sees the note while the call is still on.
    const guest = await account(guestEmail);
    expect((await guest.api.notes.list()).map((n) => n.id)).not.toContain(noteId);
    expect(code(await guest.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
    await call.leave();

    // When it ends, everyone invited has it, from the organizer, along with who else has it.
    expect((await guest.api.notes.list()).find((n) => n.id === noteId)).toMatchObject({ from: { id: org.session.ownerId } });
    const note = await guest.api.notes.get(noteId);
    expect(note.recipients.map((r) => [r.person.email, r.role])).toEqual([[org.session.user.email, 'organizer'], [guestEmail, 'invited']]);
    expect((await guest.fetch(guest.api.notes.audioUrl(noteId, 0))).status).toBe(200);

    // Anyone with the notes can share them on; people who already have them aren't added twice.
    const laterEmail = unique('later');
    const shared = await guest.api.notes.share(noteId, [laterEmail, org.session.user.email, guestEmail]);
    expect(shared.recipients.map((r) => r.role)).toEqual(['organizer', 'invited', 'shared']);
    const later = await account(laterEmail);
    expect((await later.api.notes.get(noteId)).from?.id).toBe(org.session.ownerId);
    expect(code(await later.api.notes.share(noteId, ['not an email']).catch((e: unknown) => e))).toBe('invalid');

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
});

describe('room recordings', () => {
  it('records in the room, renames, stops into a private note, and can be discarded', async () => {
    const { api, session } = await account();
    const rec = await api.recordings.start('Board prep');
    await rec.appendAudio(piece(audioBytes('room-0'), 0, 0));
    rec.rename('Board prep with Dana');
    rec.pause();
    await new Promise((r) => setTimeout(r, 150));
    expect(code(await rec.appendAudio(piece(audioBytes('while paused'), 0, 1)).catch((e: unknown) => e))).toBe('conflict');
    rec.resume();
    await new Promise((r) => setTimeout(r, 150));
    const { pendingNoteId } = await rec.stop();
    expect(await api.notes.get(pendingNoteId)).toMatchObject({ kind: 'room', title: 'Board prep with Dana', status: 'pending' });
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
    // The only receipt left is the delete's own ({"deleted":true}); older ones were purged with the note.
    for (const t of ['revisions WHERE item_id = $2', 'recordings WHERE note_item_id = $2', "operations WHERE method NOT LIKE 'DELETE%'"]) {
      const r = await h.pool.query(`SELECT count(*)::int AS n FROM ${t.split(' WHERE ')[0]} WHERE owner_id = $1 AND ${t.split(' WHERE ')[1]}`, t.includes('$2') ? [session.ownerId, pendingNoteId] : [session.ownerId]);
      expect(r.rows[0]?.n).toBe(0);
    }
    for (const id of objectIds) expect(await h.objects.get(id).then(() => 'exists', () => 'gone')).toBe('gone');
  });
});

describe('privacy at rest', () => {
  it('keeps names, emails, titles, guests, chat and audio out of rows, objects and logs in any encoding', async () => {
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
    call.sendChat('CANARY-CHAT private remark');
    await settle(call, (x) => x.chat.length === 1);
    await call.leave();
    const rec = await c.api.recordings.start('Room');
    rec.rename('CANARY-ROOM title');
    await new Promise((r) => setTimeout(r, 150));
    await rec.stop();
    await c.api.notes.list({ text: 'CANARY-SEARCH words' });
    await c.api.people.search('CANARY-PEOPLE query');
    // And someone who signs in with Google: their Google account ID, name, address and photo stay sealed too.
    const g = tapped();
    expect(landed(await viaGoogle(g, { sub: 'canary-google-sub-31337', email: 'canary.googler@canary.example', name: 'Canary Googler', picture: 'https://lh3.googleusercontent.com/a/canary-photo' }))).toBe('/ready');

    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM owners x UNION ALL SELECT row_to_json(x)::text FROM identities x UNION ALL
      SELECT row_to_json(x)::text FROM sessions x UNION ALL SELECT row_to_json(x)::text FROM items x UNION ALL
      SELECT row_to_json(x)::text FROM revisions x UNION ALL SELECT row_to_json(x)::text FROM calls x UNION ALL
      SELECT row_to_json(x)::text FROM recordings x UNION ALL SELECT row_to_json(x)::text FROM recording_pieces x UNION ALL
      SELECT row_to_json(x)::text FROM billing_accounts x UNION ALL SELECT row_to_json(x)::text FROM content_jobs x UNION ALL
      SELECT row_to_json(x)::text FROM operations x UNION ALL SELECT row_to_json(x)::text FROM note_access x) q`);
    const rowsText = String(dump.rows[0]?.all ?? '');
    // bytea renders as hex; our records embed base64url; check every encoding a plaintext bug could produce.
    const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
    const canaries = [
      'canary-person', 'Canary Person', 'CANARY-TITLE', 'CANARY-EDIT', 'canary-guest', 'CANARY-CHAT', 'CANARY-AUDIO', 'CANARY-ROOM', 'CANARY-SEARCH', 'CANARY-PEOPLE',
      'Welcome credits', 'Art Vandelay', 'vandelay', 'Weekly with Theo', 'lumen.health',
      'canary-google-sub', 'canary.googler', 'Canary Googler', 'canary-photo'
    ];
    for (const canary of canaries) for (const enc of encodings(canary)) expect(rowsText.includes(enc), `${canary} as ${enc}`).toBe(false);

    // Every object in the bucket, not only the referenced ones.
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const canary of canaries) for (const enc of encodings(canary)) expect(bytes.includes(Buffer.from(enc)), `${canary} in ${obj.id}`).toBe(false);
    }

    // And the logs, which ran at debug level for this whole flow: no content, no emails, no session cookies.
    expect(secrets.length).toBeGreaterThanOrEqual(1);
    const logText = h.logs.join('');
    expect(logText).toContain(session.ownerId);
    for (const canary of canaries) for (const enc of encodings(canary)) expect(logText.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
    for (const secret of secrets) expect(logText.includes(secret), 'a session cookie in logs').toBe(false);
    // Google refresh tokens are sealed in the vault and never logged.
    expect(h.google.refreshTokens().length).toBeGreaterThanOrEqual(1);
    for (const t of h.google.refreshTokens()) {
      for (const enc of encodings(t)) expect(rowsText.includes(enc), 'a refresh token in rows').toBe(false);
      expect(logText.includes(t), 'a refresh token in logs').toBe(false);
    }
    expect(logText).not.toContain(m.code);
  });
});

describe('maintenance', () => {
  it('refuses to start on a database built from a different version of the schema', async () => {
    const { migrate } = await import('./migrate');
    expect(await migrate(h.pool)).toEqual([]);
    const [row] = (await h.pool.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations ORDER BY name LIMIT 1')).rows;
    if (!row) throw new Error('no migrations recorded');
    // As if the file had been edited in place after this database was built.
    await h.pool.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [row.name, 'edited-since']);
    await expect(migrate(h.pool)).rejects.toThrow(/reset/);
    // As if a migration had been deleted.
    await h.pool.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [row.name, row.checksum]);
    await h.pool.query("INSERT INTO schema_migrations (name, checksum) VALUES ('0099_gone.sql', 'x')");
    await expect(migrate(h.pool)).rejects.toThrow(/reset/);
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
