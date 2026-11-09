/*
 * A stand-in for Google, for integration tests: OpenID Connect discovery, an authorize endpoint that
 * "signs in" whoever the test says, a token endpoint that checks the client secret, the one-time code,
 * the redirect URI and the PKCE verifier, ID tokens signed with a real RS256 key published at its
 * JWKS, refresh tokens issued the way Google issues them (only on first consent, or when asked again)
 * and revoked at its revocation endpoint, and a Calendar API behind bearer tokens. Recurring events
 * work as Google's do: they need a time zone, their rule is expanded in it, and each occurrence can be
 * changed or cancelled alone. The API talks to it over HTTP exactly as it talks to Google, so nothing in
 * the sign-in or calendar path is stubbed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { z } from 'zod';
import { createFakeDrive, DRIVE_SCOPE, type FakeDrive } from './fake-drive';

export interface GoogleUser { sub: string; email: string; name?: string | undefined; picture?: string | undefined; emailVerified?: boolean | undefined }
/**
 * Ways the next sign-in goes wrong on Google's side; `no-calendar` is someone unticking calendar access, and
 * `no-freebusy` a grant from before free/busy was asked for.
 */
export type Spoil = 'deny' | 'wrong-audience' | 'wrong-nonce' | 'expired' | 'no-calendar' | 'no-freebusy' | 'no-drive';
/** A calendar event as Google stores it (the fields Alcove uses). */
export interface FakeEvent {
  id: string; status?: string; summary?: string; description?: string; location?: string; htmlLink?: string; eventType?: string; hangoutLink?: string; transparency?: string;
  /** On each occurrence of a recurring event: the series' ID. */
  recurringEventId?: string;
  /** On a recurring event: how it repeats. */
  recurrence?: string[];
  /** On an occurrence: when the rule put it, wherever it's been moved. */
  originalStartTime?: { dateTime?: string; timeZone?: string };
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}
export interface FakeGoogle {
  drive: FakeDrive;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The redirect URI the OAuth client is registered with; anything else is refused, as Google does. */
  register(redirectUri: string): void;
  /** Who signs in at Google next (and on any second pass), and how it should go wrong, if at all. */
  next(user: GoogleUser, spoil?: Spoil): void;
  /** Someone's primary calendar, to seed and to check. */
  calendar(sub: string): FakeEvent[];
  /** What free/busy says of an address. Anyone it hasn't been told about reads as a private calendar does. */
  freeBusy(email: string, busy: { start: string; end: string }[]): void;
  /** Calls to the Calendar API, oldest first. */
  calls: { method: string; path: string; sendUpdates: string | null }[];
  /** What Google emailed people, oldest first: anything written with `sendUpdates=all`, once for everyone on the event. */
  mail: { kind: 'invitation' | 'update' | 'cancellation'; eventId: string; to: string[] }[];
  /** The occurrences a recurring event has now, cancelled ones left out. */
  instances(sub: string, eventId: string): FakeEvent[];
  /** Refuses the Calendar API calls that match, with a 500, until this is called again with nothing. */
  refuse(match?: ((call: { method: string; path: string }) => boolean) | undefined): void;
  /** Keeps the Calendar API calls that match waiting, as a slow Google does, until the function this gives back is called. */
  hold(match: (call: { method: string; path: string }) => boolean): () => void;
  /** As if this person had agreed before: Google then sends no refresh token unless asked again. */
  preconsent(sub: string): void;
  /** Every access token stops working (as when one expires); refresh tokens still do. */
  expireAccess(): void;
  /** The person withdraws Alcove's access at Google. */
  revoke(sub: string): void;
  /**
   * Google stops answering (true) or answers again (false). Requests still arrive, and those to the Calendar
   * API and the revocation endpoint are noted in `calls` and `revocations()`, but get no reply until the
   * caller gives up.
   */
  unresponsive(on: boolean): void;
  /** Tokens Alcove asked Google to revoke at its revocation endpoint, oldest first. */
  revocations(): string[];
  /** Every refresh token issued so far, revoked ones too, to check none of them ever leaks. */
  refreshTokens(): string[];
  /** Whether Google still honours this refresh token: issued, and not revoked since. */
  honours(refreshToken: string): boolean;
  /** How many times a profile photo was fetched from here. */
  photoFetches(): number;
  close(): Promise<void>;
}

const CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
const FREEBUSY = 'https://www.googleapis.com/auth/calendar.events.freebusy';
/** How many calendars free/busy answers about unless it's asked for more, and the most it can be. */
const CALENDAR_EXPANSION = { usual: 20, most: 50 };
const FreeBusyQuery = z.object({ timeMin: z.string(), timeMax: z.string(), calendarExpansionMax: z.number().optional(), items: z.array(z.object({ id: z.string() })) });
/** A 1×1 PNG, as a profile photo. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let photoFetches = 0;
interface Grant { user: GoogleUser; nonce: string; challenge: string; redirectUri: string; spoil: Spoil | undefined; scopes: string[]; refresh: boolean }

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_MS = 86_400_000;
/** The clock in a time zone at a moment, as a UTC time: its difference from the moment is the zone's offset. */
function clockAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(at));
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
}
/**
 * The moment a clock time (as a UTC time) happens in a time zone, as RFC 5545 reads one: where the clocks go back it
 * happens twice, and it's the first; where they go forward past it it doesn't happen, and it's read with the offset
 * from before the change.
 */
function momentOf(clock: number, timeZone: string): number {
  const before = clock - (clockAt(clock - DAY_MS, timeZone) - (clock - DAY_MS));
  const after = clock - (clockAt(clock + DAY_MS, timeZone) - (clock + DAY_MS));
  if (clockAt(before, timeZone) === clock) return before;
  return clockAt(after, timeZone) === clock ? after : before;
}
const untilOf = (v: string | undefined) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : Infinity;
};
/**
 * When a recurring event's occurrences start: the two kinds of rule Alcove writes, every n weeks on some days (weeks
 * begin on Monday, as they do when a rule doesn't say) and one weekday of each month, read at the same clock time in the
 * event's time zone. The event's own start always counts. Google refuses a rule with no time zone, so one is here.
 */
function expand(e: FakeEvent): number[] {
  const line = e.recurrence?.find((l) => l.startsWith('RRULE:'))?.slice('RRULE:'.length) ?? '';
  const rule = new Map(line.split(';').map((p): [string, string] => { const [k = '', v = ''] = p.split('='); return [k, v]; }));
  const timeZone = e.start?.timeZone ?? 'UTC';
  const first = Date.parse(e.start?.dateTime ?? '');
  const until = untilOf(rule.get('UNTIL'));
  const clock = clockAt(first, timeZone);
  const timeOfDay = ((clock % DAY_MS) + DAY_MS) % DAY_MS;
  const firstDay = Math.floor(clock / DAY_MS);
  const weekdayOf = (day: number) => new Date(day * DAY_MS).getUTCDay();
  const out = new Set([first]);
  if (rule.get('FREQ') === 'WEEKLY') {
    const days = (rule.get('BYDAY') ?? '').split(',');
    const every = Number(rule.get('INTERVAL') ?? '1');
    const mondayOf = (day: number) => day - ((weekdayOf(day) + 6) % 7);
    for (let day = firstDay; day < firstDay + 800; day++) {
      if (((mondayOf(day) - mondayOf(firstDay)) / 7) % every !== 0 || !days.includes(WEEKDAYS[weekdayOf(day)] ?? '')) continue;
      const at = momentOf(day * DAY_MS + timeOfDay, timeZone);
      if (at > until) break;
      if (at >= first) out.add(at);
    }
  } else if (rule.get('FREQ') === 'MONTHLY') {
    const m = /^(-?\d)([A-Z]{2})$/.exec(rule.get('BYDAY') ?? '');
    const week = Number(m?.[1] ?? 1);
    const weekday = WEEKDAYS.indexOf(m?.[2] ?? 'MO');
    const start = new Date(firstDay * DAY_MS);
    for (let i = 0; i < 120; i++) {
      const monthStart = Math.floor(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1) / DAY_MS);
      const nextMonth = Math.floor(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 1) / DAY_MS);
      const matching: number[] = [];
      for (let day = monthStart; day < nextMonth; day++) if (weekdayOf(day) === weekday) matching.push(day);
      const day = week < 0 ? matching.at(week) : matching[week - 1];
      if (day === undefined) continue;
      const at = momentOf(day * DAY_MS + timeOfDay, timeZone);
      if (at > until) break;
      if (at >= first) out.add(at);
    }
  }
  return [...out].filter((at) => at <= until).sort((a, b) => a - b);
}
const recipients = (e: FakeEvent) => (e.attendees ?? []).flatMap((a) => (a.email ? [a.email] : []));

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function text(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const clientId = 'alcove-test.apps.googleusercontent.com';
  const clientSecret = randomBytes(16).toString('hex');
  const grants = new Map<string, Grant>();
  const accessTokens = new Map<string, { sub: string; scopes: string[] }>();
  /** Refresh tokens Google honours; `issued` keeps every one it ever gave out. */
  const refreshTokens = new Map<string, { sub: string; scopes: string[] }>();
  const issued: string[] = [];
  const consented = new Map<string, Set<string>>();
  const calendars = new Map<string, FakeEvent[]>();
  const availability = new Map<string, { start: string; end: string }[]>();
  const calls: FakeGoogle['calls'] = [];
  const mail: FakeGoogle['mail'] = [];
  /** What's been changed on single occurrences, by recurring event and then by occurrence: their fields, or that they're cancelled. */
  const changes = new Map<string, Map<string, Partial<FakeEvent>>>();
  let refusing: ((call: { method: string; path: string }) => boolean) | undefined;
  const holds: { match: (call: { method: string; path: string }) => boolean; open: Promise<void> }[] = [];
  const revoked: string[] = [];
  /** While Google isn't answering: the replies it owes, left open until the caller gives up. */
  let silent = false;
  const unanswered = new Set<ServerResponse>();
  const hangUp = () => { for (const res of unanswered) res.destroy(); unanswered.clear(); };
  let issuer = '';
  const registered = new Set<string>();
  const drive = createFakeDrive();
  let pending: { user: GoogleUser; spoil: Spoil | undefined } | null = null;
  const calendarOf = (sub: string) => { let c = calendars.get(sub); if (!c) { c = []; calendars.set(sub, c); } return c; };
  const issueAccess = (sub: string, scopes: string[]) => { const t = randomBytes(16).toString('hex'); accessTokens.set(t, { sub, scopes }); return t; };

  /** A recurring event's occurrences as the rule makes them, with what's been changed on each. */
  function occurrencesOf(e: FakeEvent): FakeEvent[] {
    const { recurrence: _rule, ...fields } = e;
    const timeZone = e.start?.timeZone ?? 'UTC';
    const length = Date.parse(e.end?.dateTime ?? '') - Date.parse(e.start?.dateTime ?? '');
    return expand(e).flatMap((at) => {
      const start = new Date(at).toISOString();
      const id = `${e.id}_${start.replace(/[-:]|\.\d{3}/g, '')}`;
      const changed = changes.get(e.id)?.get(id);
      if (changed?.status === 'cancelled') return [];
      return [{
        ...fields, start: { dateTime: start, timeZone }, end: { dateTime: new Date(at + length).toISOString(), timeZone }, htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`, ...changed,
        id, recurringEventId: e.id, originalStartTime: { dateTime: start, timeZone }
      }];
    });
  }
  const tell = (kind: FakeGoogle['mail'][number]['kind'], url: URL, e: FakeEvent) => { if (url.searchParams.get('sendUpdates') === 'all') mail.push({ kind, eventId: e.id, to: recipients(e) }); };

  /** The Calendar API: primary calendar only, behind a bearer token that carries the calendar scope. */
  async function calendarApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const who = accessTokens.get(bearer);
    if (!who) return send(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
    if (!who.scopes.includes(CALENDAR)) return send(res, 403, { error: { code: 403, message: 'Insufficient Permission' } });
    calls.push({ method: req.method ?? '', path: url.pathname, sendUpdates: url.searchParams.get('sendUpdates') });
    await holds.find((h) => h.match({ method: req.method ?? '', path: url.pathname }))?.open;
    if (refusing?.({ method: req.method ?? '', path: url.pathname })) return send(res, 500, { error: { code: 500, message: 'Backend Error' } });
    const events = calendarOf(who.sub);
    const [encoded = '', part] = (url.pathname.split('/events/')[1] ?? '').split('/');
    const id = decodeURIComponent(encoded);
    const found = events.find((e) => e.id === id);
    /** The recurring event an occurrence's ID belongs to, and the occurrence, while it's there. */
    const master = found ? undefined : events.find((e) => e.recurrence && id.startsWith(`${e.id}_`));
    const instance = master ? occurrencesOf(master).find((i) => i.id === id) : undefined;
    if (req.method === 'GET' && part === 'instances') {
      if (!found) return send(res, 404, { error: { code: 404, message: 'Not Found' } });
      const all = occurrencesOf(found);
      const size = Number(url.searchParams.get('maxResults') ?? '250');
      const start = Number(url.searchParams.get('pageToken') ?? '0');
      return send(res, 200, { items: all.slice(start, start + size), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
    }
    if (req.method === 'GET' && !id) {
      const from = Date.parse(url.searchParams.get('timeMin') ?? '1970-01-01T00:00:00Z');
      const to = Date.parse(url.searchParams.get('timeMax') ?? '2999-01-01T00:00:00Z');
      const at = (e: FakeEvent) => Date.parse(e.start?.dateTime ?? `${e.start?.date ?? '1970-01-01'}T00:00:00Z`);
      const end = (e: FakeEvent) => Date.parse(e.end?.dateTime ?? `${e.end?.date ?? '1970-01-01'}T00:00:00Z`);
      const listed = url.searchParams.get('singleEvents') === 'true' ? events.flatMap((e) => (e.recurrence ? occurrencesOf(e) : [e])) : events;
      const inWindow = listed.filter((e) => end(e) > from && at(e) < to).sort((a, b) => at(a) - at(b));
      const size = Number(url.searchParams.get('maxResults') ?? '250');
      const start = Number(url.searchParams.get('pageToken') ?? '0');
      const next = start + size;
      return send(res, 200, { items: inWindow.slice(start, next), ...(next < inWindow.length ? { nextPageToken: String(next) } : {}) });
    }
    if (req.method === 'POST' && !id) {
      const body: unknown = JSON.parse(await text(req));
      const event: FakeEvent = { ...(typeof body === 'object' && body ? body : {}), id: randomBytes(10).toString('hex'), status: 'confirmed' };
      event.htmlLink = `https://calendar.google.com/calendar/event?eid=${event.id}`;
      event.organizer = { email: who.sub === '' ? '' : (users.get(who.sub) ?? ''), self: true };
      if (event.recurrence && !event.start?.timeZone) return send(res, 400, { error: { code: 400, message: 'Missing time zone definition for start time.' } });
      events.push(event);
      tell('invitation', url, event);
      return send(res, 200, event);
    }
    // One occurrence, on its own: the recurring event stays as it is.
    if (master && instance) {
      const held = changes.get(master.id) ?? new Map<string, Partial<FakeEvent>>();
      changes.set(master.id, held);
      if (req.method === 'GET') return send(res, 200, instance);
      if (req.method === 'PATCH') {
        const body: unknown = JSON.parse(await text(req));
        held.set(id, { ...held.get(id), ...(typeof body === 'object' && body ? body : {}) });
        const changed = occurrencesOf(master).find((i) => i.id === id) ?? instance;
        tell('update', url, changed);
        return send(res, 200, changed);
      }
      if (req.method === 'DELETE') {
        held.set(id, { status: 'cancelled' });
        tell('cancellation', url, instance);
        res.writeHead(204);
        res.end();
        return;
      }
    }
    if (!found) return send(res, 404, { error: { code: 404, message: 'Not Found' } });
    if (req.method === 'GET') return send(res, 200, found);
    if (req.method === 'PATCH') {
      const parsed: unknown = JSON.parse(await text(req));
      const body: Partial<FakeEvent> = typeof parsed === 'object' && parsed ? parsed : {};
      if ((body.recurrence ?? found.recurrence) && !(body.start ?? found.start)?.timeZone) return send(res, 400, { error: { code: 400, message: 'Missing time zone definition for start time.' } });
      // Moving a recurring event starts its occurrences over, with new IDs, and what was changed on single ones is lost.
      if (body.start?.dateTime && Date.parse(body.start.dateTime) !== Date.parse(found.start?.dateTime ?? '')) changes.delete(found.id);
      Object.assign(found, body);
      tell('update', url, found);
      return send(res, 200, found);
    }
    if (req.method === 'DELETE') {
      events.splice(events.indexOf(found), 1);
      changes.delete(found.id);
      tell('cancellation', url, found);
      res.writeHead(204);
      res.end();
      return;
    }
    return send(res, 405, { error: { code: 405 } });
  }
  const users = new Map<string, string>();

  /** Free/busy: the scope of its own, a limit on calendars at once, and an error for each one that can't be read. */
  async function freeBusy(req: IncomingMessage, res: ServerResponse, url: URL) {
    const who = accessTokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!who) return send(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
    calls.push({ method: req.method ?? '', path: url.pathname, sendUpdates: null });
    if (!who.scopes.includes(FREEBUSY)) return send(res, 403, { error: { code: 403, message: 'Insufficient Permission' } });
    const q = FreeBusyQuery.parse(JSON.parse(await text(req)));
    if (q.items.length > Math.min(q.calendarExpansionMax ?? CALENDAR_EXPANSION.usual, CALENDAR_EXPANSION.most)) return send(res, 400, { error: { code: 400, message: 'Too many calendars' } });
    return send(res, 200, {
      kind: 'calendar#freeBusy', timeMin: q.timeMin, timeMax: q.timeMax,
      calendars: Object.fromEntries(q.items.map(({ id }) => { const busy = availability.get(id); return [id, busy ? { busy } : { errors: [{ domain: 'calendar', reason: 'notFound' }], busy: [] }]; }))
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', issuer);
    if (silent) {
      if (url.pathname.startsWith('/calendar/v3/')) calls.push({ method: req.method ?? '', path: url.pathname, sendUpdates: url.searchParams.get('sendUpdates') });
      if (req.method === 'POST' && url.pathname === '/revoke') revoked.push(new URLSearchParams(await text(req)).get('token') ?? '');
      unanswered.add(res);
      res.on('close', () => unanswered.delete(res));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, revocation_endpoint: `${issuer}/revoke`, jwks_uri: `${issuer}/jwks` });
    }
    if (req.method === 'GET' && url.pathname === '/jwks') return send(res, 200, { keys: [jwk] });
    // Profile photos, as lh3.googleusercontent.com serves them: a small PNG for any name.
    if (req.method === 'GET' && url.pathname.startsWith('/photo/')) {
      photoFetches++;
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    if (url.pathname.startsWith('/drive/v3/') || url.pathname.startsWith('/upload/drive/v3/') || url.pathname.startsWith('/drive-upload/')) {
      const token = accessTokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      return drive.handle(req, res, url, token ? { ...token, email: users.get(token.sub) ?? '' } : undefined);
    }
    if (url.pathname.startsWith('/calendar/v3/calendars/primary/events')) return calendarApi(req, res, url);
    if (req.method === 'POST' && url.pathname === '/calendar/v3/freeBusy') return freeBusy(req, res, url);
    if (req.method === 'GET' && url.pathname === '/authorize') {
      const q = url.searchParams;
      const asked = (q.get('scope') ?? '').split(' ');
      const valid = q.get('client_id') === clientId && registered.has(q.get('redirect_uri') ?? '') && q.get('response_type') === 'code'
        && (['openid', 'email', 'profile'].every((x) => asked.includes(x)) || (asked.length === 1 && asked[0] === DRIVE_SCOPE)) && q.get('code_challenge_method') === 'S256' && !!q.get('code_challenge') && (asked.includes(DRIVE_SCOPE) || !!q.get('nonce'));
      if (!valid) return send(res, 400, { error: 'invalid_request' });
      const redirectUri = q.get('redirect_uri') ?? '';
      const back = new URL(redirectUri);
      back.searchParams.set('state', q.get('state') ?? '');
      const who = pending;
      if (!who || who.spoil === 'deny') back.searchParams.set('error', 'access_denied');
      else {
        // Granular consent: someone can untick the calendar. Earlier grants carry over (include_granted_scopes).
        const before = consented.get(who.user.sub);
        const unticked = who.spoil === 'no-calendar' ? [CALENDAR, FREEBUSY] : who.spoil === 'no-freebusy' ? [FREEBUSY] : who.spoil === 'no-drive' ? [DRIVE_SCOPE] : [];
        const scopes = [...new Set([...asked.filter((x) => !unticked.includes(x)), ...(q.get('include_granted_scopes') === 'true' ? before ?? [] : [])])];
        // Like Google: a refresh token for offline access only the first time someone agrees, or when asked to agree again.
        const refresh = q.get('access_type') === 'offline' && (!before || (q.get('prompt') ?? '').includes('consent'));
        consented.set(who.user.sub, new Set([...(before ?? []), ...scopes]));
        users.set(who.user.sub, who.user.email.toLowerCase());
        const code = randomBytes(16).toString('hex');
        grants.set(code, { user: who.user, nonce: q.get('nonce') ?? '', challenge: q.get('code_challenge') ?? '', redirectUri, spoil: who.spoil, scopes, refresh });
        back.searchParams.set('code', code);
        const picked = drive.picked(who.user.sub);
        if (q.get('trigger_onepick') === 'true' && picked && scopes.includes(DRIVE_SCOPE)) back.searchParams.set('picked_file_ids', picked);
      }
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    // Revoking a refresh token ends it and every access token made from it, as at Google.
    if (req.method === 'POST' && url.pathname === '/revoke') {
      const token = new URLSearchParams(await text(req)).get('token') ?? '';
      revoked.push(token);
      const held = refreshTokens.get(token);
      if (!held) return send(res, 400, { error: 'invalid_token' });
      refreshTokens.delete(token);
      for (const [t, v] of accessTokens) if (v.sub === held.sub) accessTokens.delete(t);
      return send(res, 200, {});
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      const form = new URLSearchParams(await text(req));
      if (form.get('grant_type') === 'refresh_token') {
        const held = refreshTokens.get(form.get('refresh_token') ?? '');
        if (!held || form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, { access_token: issueAccess(held.sub, held.scopes), token_type: 'Bearer', expires_in: 3599, scope: held.scopes.join(' ') });
      }
      const code = form.get('code') ?? '';
      const grant = grants.get(code);
      grants.delete(code);
      const verified = !!grant && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === grant.challenge;
      if (!grant || !verified || form.get('grant_type') !== 'authorization_code' || form.get('client_id') !== clientId
        || form.get('client_secret') !== clientSecret || form.get('redirect_uri') !== grant.redirectUri) return send(res, 400, { error: 'invalid_grant' });
      const now = Math.floor(Date.now() / 1000);
      const issuedAt = grant.spoil === 'expired' ? now - 7200 : now;
      const idToken = await new SignJWT({
        email: grant.user.email, email_verified: grant.user.emailVerified ?? true,
        ...(grant.user.name ? { name: grant.user.name } : {}), ...(grant.user.picture ? { picture: grant.user.picture } : {}),
        nonce: grant.spoil === 'wrong-nonce' ? 'not-the-nonce' : grant.nonce
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer).setSubject(grant.user.sub).setAudience(grant.spoil === 'wrong-audience' ? 'someone-else.apps.googleusercontent.com' : clientId)
        .setIssuedAt(issuedAt).setExpirationTime(issuedAt + 3600)
        .sign(privateKey);
      const refreshToken = grant.refresh ? randomBytes(24).toString('hex') : undefined;
      if (refreshToken) { refreshTokens.set(refreshToken, { sub: grant.user.sub, scopes: grant.scopes }); issued.push(refreshToken); }
      return send(res, 200, {
        access_token: issueAccess(grant.user.sub, grant.scopes), token_type: 'Bearer', expires_in: 3599, scope: grant.scopes.join(' '), id_token: idToken,
        ...(refreshToken ? { refresh_token: refreshToken } : {})
      });
    }
    return send(res, 404, { error: 'not_found' });
  }

  const server = createServer((req, res) => { handle(req, res).catch(() => send(res, 500, { error: 'server_error' })); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  issuer = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    issuer, clientId, clientSecret, drive,
    register: (uri) => { registered.add(uri); },
    next: (user, spoil) => { pending = { user, spoil }; },
    calendar: calendarOf,
    freeBusy: (email, busy) => { availability.set(email, busy); },
    calls,
    mail,
    instances: (sub, eventId) => { const e = calendarOf(sub).find((x) => x.id === eventId); return e ? occurrencesOf(e) : []; },
    hold: (match) => {
      let release = (): void => undefined;
      const held = { match, open: new Promise<void>((r) => { release = r; }) };
      holds.push(held);
      return () => { holds.splice(holds.indexOf(held), 1); release(); };
    },
    refuse: (match) => { refusing = match; },
    preconsent: (sub) => { consented.set(sub, new Set(['openid', 'email', 'profile', CALENDAR])); },
    expireAccess: () => accessTokens.clear(),
    revoke: (sub) => { for (const [t, v] of refreshTokens) if (v.sub === sub) refreshTokens.delete(t); for (const [t, v] of accessTokens) if (v.sub === sub) accessTokens.delete(t); },
    unresponsive: (on) => { silent = on; if (!on) hangUp(); },
    revocations: () => revoked,
    refreshTokens: () => [...issued],
    honours: (t) => refreshTokens.has(t),
    photoFetches: () => photoFetches,
    close: () => { hangUp(); return new Promise<void>((r) => server.close(() => r())); }
  };
}
