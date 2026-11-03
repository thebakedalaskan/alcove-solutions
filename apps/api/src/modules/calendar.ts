/*
 * Google Calendar. A Google sign-in that grants the calendar leaves a connection: a refresh token
 * sealed in the account's vault. From it, Alcove reads the coming week's other events, and keeps
 * its own calls on the calendar: an Alcove call is a Google event with the Alcove link and a private
 * marker, and Google sends everyone on it the invitation, every change and the cancellation
 * (sendUpdates=all). Access tokens live in memory for under an hour and are never stored.
 */
import type { Calendar, CalendarEvent } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { tx } from '../db';
import { ForbiddenError, NotFoundError, UnavailableError } from '../errors';
import { CALENDAR_SCOPE, refreshAccess, type Grant } from '../google';
import { log } from '../log';
import { createItem, listItems, saveRevision } from '../vault';
import { profile } from './account';
import type { MeetingManifest } from './meetings';
import { personOf } from './portraits';

const clog = log.child({ component: 'calendar' });

const Connection = z.object({
  provider: z.literal('google'),
  /** Lets the server reach the calendar later. Sealed with the rest of the account; never logged. */
  refreshToken: z.string().optional(),
  scopes: z.array(z.string()),
  connectedAt: z.string()
});
export type Connection = z.infer<typeof Connection>;

const access = new Map<string, { token: string; until: number }>();
const remember = (ownerId: string, token: string, expiresIn: number) => access.set(ownerId, { token, until: Date.now() + Math.max(30, expiresIn - 60) * 1000 });

async function connection(o: Owner): Promise<Connection | undefined> {
  return (await listItems(o, o.pool, 'connection', Connection))[0]?.manifest;
}

async function saveConnection(o: Owner, fn: (cur: Connection | undefined) => Connection): Promise<Connection> {
  return tx(o.pool, async (c) => {
    const [cur] = await listItems(o, c, 'connection', Connection);
    const next = fn(cur?.manifest);
    if (cur) await saveRevision(o, c, cur.itemId, cur.revisionId, next);
    else await createItem(o, c, 'connection', next);
    return next;
  });
}

/** Keeps what a Google sign-in granted. A new refresh token replaces the old; without one, the old one stays. */
export async function connect(o: Owner, grant: Grant): Promise<Connection> {
  remember(o.ownerId, grant.accessToken, grant.expiresIn);
  const conn = await saveConnection(o, (cur) => {
    const refreshToken = grant.refreshToken ?? cur?.refreshToken;
    return { provider: 'google', ...(refreshToken ? { refreshToken } : {}), scopes: grant.scopes, connectedAt: new Date().toISOString() };
  });
  clog.info('google connected', { ownerId: o.ownerId, calendar: conn.scopes.includes(CALENDAR_SCOPE), refresh: !!conn.refreshToken });
  return conn;
}

const usable = (c: Connection | undefined): c is Connection & { refreshToken: string } => !!c?.refreshToken && c.scopes.includes(CALENDAR_SCOPE);

/** A valid access token, refreshing it when it's about to expire. Null when the calendar isn't connected (any more). */
async function token(o: Owner): Promise<string | null> {
  const cached = access.get(o.ownerId);
  if (cached && cached.until > Date.now()) return cached.token;
  const conn = await connection(o);
  if (!usable(conn)) return null;
  const r = await refreshAccess(o, conn.refreshToken);
  if (r.ok) { remember(o.ownerId, r.accessToken, r.expiresIn); return r.accessToken; }
  if (r.revoked) {
    // Access was withdrawn at Google: forget the token so the app asks again.
    await saveConnection(o, (cur) => ({ provider: 'google', scopes: (cur?.scopes ?? []).filter((s) => s !== CALENDAR_SCOPE), connectedAt: cur?.connectedAt ?? new Date().toISOString() }));
    clog.info('google calendar access withdrawn', { ownerId: o.ownerId });
    return null;
  }
  throw new UnavailableError('Google Calendar can’t be reached right now.', { context: { step: 'refresh' } });
}

/** Whether this account's calls go on a Google Calendar. */
export const connected = async (o: Owner) => usable(await connection(o));

async function api<S extends z.ZodType>(o: Owner, method: string, path: string, schema: S, o2: { query?: Record<string, string>; body?: unknown } = {}): Promise<z.infer<S>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await token(o);
    if (!t) throw new UnavailableError('Google Calendar isn’t connected.', { context: { op: method } });
    const url = new URL(`${o.cfg.GOOGLE_API_URL.replace(/\/$/, '')}/calendar/v3${path}`);
    for (const [k, v] of Object.entries(o2.query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${t}`, accept: 'application/json', ...(o2.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(o2.body === undefined ? {} : { body: JSON.stringify(o2.body) }),
      signal: AbortSignal.timeout(8000)
    });
    // An access token Google has stopped honouring: drop it and try once with a fresh one.
    if (res.status === 401 && attempt === 0) { access.delete(o.ownerId); continue; }
    if (res.status === 404 || res.status === 410) throw new NotFoundError('That calendar event isn’t there any more.', { context: { op: method, status: res.status } });
    if (!res.ok) throw new UnavailableError('Google Calendar didn’t accept that. Try again.', { context: { op: method, status: res.status } });
    return schema.parse(res.status === 204 ? null : await res.json().catch(() => null));
  }
  throw new UnavailableError('Google Calendar didn’t accept that. Try again.', { context: { op: method, status: 401 } });
}

/* ---------- Google's event shape: only what Alcove reads ---------- */
const When = z.object({ dateTime: z.string().optional(), date: z.string().optional() });
const Attendee = z.object({ email: z.string().optional(), displayName: z.string().optional(), self: z.boolean().optional(), organizer: z.boolean().optional(), resource: z.boolean().optional(), responseStatus: z.string().optional() });
const GoogleEvent = z.object({
  id: z.string(), status: z.string().optional(), summary: z.string().optional(), description: z.string().optional(), location: z.string().optional(),
  htmlLink: z.string().optional(), start: When.optional(), end: When.optional(), eventType: z.string().optional(),
  /** Present on each occurrence of a recurring event: Google's ID for the whole series. */
  recurringEventId: z.string().optional(),
  organizer: z.object({ email: z.string().optional(), displayName: z.string().optional(), self: z.boolean().optional() }).optional(),
  attendees: z.array(Attendee).optional(), hangoutLink: z.string().optional(),
  conferenceData: z.object({
    entryPoints: z.array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() })).optional(),
    conferenceSolution: z.object({ name: z.string().optional() }).optional()
  }).optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional()
});
type GoogleEvent = z.infer<typeof GoogleEvent>;
const GoogleList = z.object({ items: z.array(GoogleEvent).default([]) });
/** The private property that marks an event as an Alcove call. */
const MARK = 'alcoveMeeting';

const VIDEO: [RegExp, string][] = [
  [/https:\/\/meet\.google\.com\/[a-z0-9-]+/i, 'Google Meet'],
  [/https:\/\/[\w.-]*zoom\.us\/[^\s<>"')]+/i, 'Zoom'],
  [/https:\/\/teams\.microsoft\.com\/[^\s<>"')]+/i, 'Teams'],
  [/https:\/\/[\w.-]*webex\.com\/[^\s<>"')]+/i, 'Webex']
];
const isUrl = (s: string) => { try { return new URL(s).protocol === 'https:'; } catch { return false; } };
function joinOf(e: GoogleEvent): CalendarEvent['join'] {
  if (e.hangoutLink && isUrl(e.hangoutLink)) return { url: e.hangoutLink, label: 'Google Meet' };
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video' && p.uri && isUrl(p.uri));
  if (video?.uri) return { url: video.uri, label: e.conferenceData?.conferenceSolution?.name ?? 'the call' };
  for (const text of [e.location, e.description]) {
    for (const [re, label] of VIDEO) {
      const m = text?.match(re)?.[0];
      if (m && isUrl(m)) return { url: m, label };
    }
  }
  return undefined;
}

/**
 * Someone's own events worth showing beside Alcove's calls: timed, not declined, not Alcove's own.
 * An occurrence of a recurring event they've held in Alcove before says which of their series it continues.
 */
function toEvent(e: GoogleEvent, series: ReadonlyMap<string, string>): CalendarEvent | null {
  if (e.status === 'cancelled' || !e.start?.dateTime || !e.end?.dateTime) return null;
  if (e.eventType && e.eventType !== 'default') return null;
  if (e.extendedProperties?.private?.[MARK]) return null;
  const me = e.attendees?.find((a) => a.self);
  if (me?.responseStatus === 'declined') return null;
  const organizerEmail = (e.organizer?.email ?? '').toLowerCase();
  const guests = (e.attendees ?? []).filter((a) => !a.self && !a.resource && a.email && a.email.toLowerCase() !== organizerEmail);
  const join = joinOf(e);
  const seriesId = e.recurringEventId ? series.get(e.recurringEventId) : undefined;
  return {
    id: e.id, title: e.summary?.trim() || 'Busy', startsAt: new Date(e.start.dateTime).toISOString(), endsAt: new Date(e.end.dateTime).toISOString(),
    organizer: personOf(organizerEmail || 'unknown@calendar.invalid', e.organizer?.displayName), isOrganizer: !!e.organizer?.self,
    guests: guests.map((a) => personOf(a.email ?? '', a.displayName)), ...(join ? { join } : {}),
    calendarUrl: e.htmlLink && isUrl(e.htmlLink) ? e.htmlLink : 'https://calendar.google.com/', ...(seriesId ? { seriesId } : {})
  };
}

/**
 * The coming week's other events (and the last hour's, for calls already going). `series` maps
 * Google's IDs for recurring events to the account's own series that follow them.
 */
export async function view(o: Owner, series: ReadonlyMap<string, string>): Promise<Calendar> {
  if ((await profile(o)).sample) return { source: 'sample', needsAccess: false, events: [] };
  const conn = await connection(o);
  if (!conn) return { source: 'none', needsAccess: false, events: [] };
  if (!usable(conn)) return { source: 'google', needsAccess: true, events: [] };
  const now = Date.now();
  let list: z.infer<typeof GoogleList>;
  try {
    list = await api(o, 'GET', '/calendars/primary/events', GoogleList, {
      query: { timeMin: new Date(now - 60 * 60_000).toISOString(), timeMax: new Date(now + 7 * 86_400_000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' }
    });
  } catch (e) {
    // Access withdrawn at Google is found out here: the app asks for it again instead of failing.
    if (!usable(await connection(o))) return { source: 'google', needsAccess: true, events: [] };
    throw e;
  }
  const events = list.items.flatMap((e) => { const x = toEvent(e, series); return x && new Date(x.endsAt).getTime() > now ? [x] : []; });
  clog.debug('calendar read', { ownerId: o.ownerId, events: events.length });
  return { source: 'google', needsAccess: false, events };
}

/* ---------- Alcove's calls on the calendar ---------- */
function eventBody(o: Owner, meetingId: string, m: MeetingManifest, before?: string | undefined) {
  const link = `${o.cfg.WEB_ORIGIN}/join/${m.code}`;
  const lines = [`Join the call: ${link}`, m.notes === 'on' ? 'Notes are on: Alcove writes them privately, and everyone invited gets them afterwards.' : '', before ?? ''];
  return {
    summary: m.title, location: link, description: lines.filter(Boolean).join('\n\n'),
    start: { dateTime: m.startsAt }, end: { dateTime: m.endsAt },
    attendees: m.guests.map((email) => ({ email })),
    guestsCanModify: false,
    extendedProperties: { private: { [MARK]: meetingId } },
    source: { title: 'Alcove', url: link }
  };
}

/** Puts a newly scheduled call on the calendar, which sends everyone invited an invitation. Null without a calendar. */
export async function place(o: Owner, meetingId: string, m: MeetingManifest): Promise<{ eventId: string; url?: string | undefined } | null> {
  if (!(await connected(o))) return null;
  const e = await api(o, 'POST', '/calendars/primary/events', GoogleEvent, { query: { sendUpdates: 'all' }, body: eventBody(o, meetingId, m) });
  clog.info('call placed on calendar', { ownerId: o.ownerId, meetingId, guests: m.guests.length });
  return { eventId: e.id, url: e.htmlLink && isUrl(e.htmlLink) ? e.htmlLink : undefined };
}

/** Brings the calendar event in line with the call; everyone on it gets the update. */
export async function change(o: Owner, eventId: string, meetingId: string, m: MeetingManifest, before?: string | undefined): Promise<void> {
  await api(o, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}`, GoogleEvent, { query: { sendUpdates: 'all' }, body: eventBody(o, meetingId, m, before) });
  clog.info('calendar event updated', { ownerId: o.ownerId, meetingId, guests: m.guests.length });
}

/** Cancels the calendar event; everyone on it is told. An event already gone is fine. */
export async function withdraw(o: Owner, eventId: string, meetingId: string): Promise<void> {
  try {
    await api(o, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}`, z.unknown(), { query: { sendUpdates: 'all' } });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  clog.info('calendar event cancelled', { ownerId: o.ownerId, meetingId });
}

/** One of the account's own events, to make it an Alcove call: the organizer's only, and not one already. */
export async function ownEvent(o: Owner, eventId: string): Promise<{
  title: string; startsAt: string; endsAt: string; guests: string[]; description?: string | undefined; url?: string | undefined; recurringEventId?: string | undefined;
}> {
  const e = await api(o, 'GET', `/calendars/primary/events/${encodeURIComponent(eventId)}`, GoogleEvent);
  if (!e.organizer?.self) throw new ForbiddenError('Only the organizer can move this call to Alcove.', { context: { eventId } });
  if (!e.start?.dateTime || !e.end?.dateTime) throw new NotFoundError('That isn’t a call with a start and end time.', { context: { eventId } });
  const organizer = (e.organizer.email ?? '').toLowerCase();
  const guests = (e.attendees ?? []).flatMap((a) => (!a.self && !a.resource && a.email && a.email.toLowerCase() !== organizer ? [a.email.toLowerCase()] : []));
  return {
    title: e.summary?.trim() || 'Untitled call', startsAt: new Date(e.start.dateTime).toISOString(), endsAt: new Date(e.end.dateTime).toISOString(),
    guests, description: e.description, url: e.htmlLink && isUrl(e.htmlLink) ? e.htmlLink : undefined, recurringEventId: e.recurringEventId
  };
}
