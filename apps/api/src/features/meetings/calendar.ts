/*
 * Google Calendar. Connecting the calendar leaves a refresh token
 * sealed in the account's vault. From it, Alcove reads the other events of any week asked for, and keeps
 * its own calls on the calendar: an Alcove call is a Google event with the Alcove link and a private
 * marker, and Google sends everyone on it the invitation, every change and the cancellation
 * (sendUpdates=all). Someone invited has their own copy, without the marker, so it's the link that
 * says it's an Alcove call. A call offering times holds each of them with an event of the organizer's own, which
 * nobody is invited to. Access tokens live in memory for under an hour and are never stored.
 */
import { isTimeZone, type Busy, type Calendar, type CalendarEvent, type Interval, type Repeat, type RepeatRule, type Rsvp } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { exec, tx, type Db } from '../../platform/db';
import { inCompany } from '../profile/demo-directory';
import { sampleWeek } from './demo-week';
import { ForbiddenError, NotFoundError, UnavailableError, ValidationError } from '../../platform/errors';
import { isCalendarEventScope, refreshAccess, revokeRefresh, within, type Grant } from '../../providers/google';
import { log } from '../../platform/log';
import { createItem, listItems, saveRevision, type Loaded } from '../../keys/vault';
import { zoned } from '../../platform/zones';
import { profile } from '../profile/profile';
import { isGuestAddress, type MeetingManifest } from './service';
import { personOf } from '../profile/portraits';

const clog = log.child({ component: 'calendar' });
const DAY = 86_400_000;

const Connection = z.object({
  provider: z.literal('google'),
  /** Lets the server reach the calendar later. Sealed with the rest of the account; never logged. */
  refreshToken: z.string().optional(),
  scopes: z.array(z.string()),
  connectedAt: z.string()
});
export type Connection = z.infer<typeof Connection>;

const access = new Map<string, { token: string; until: number; revisionId: string }>();
const remember = (ownerId: string, revisionId: string, token: string, expiresIn: number) => access.set(ownerId, { token, revisionId, until: Date.now() + Math.max(30, expiresIn - 60) * 1000 });

async function connectionItem(o: Owner, db: Db = o.pool): Promise<Loaded<Connection> | undefined> {
  return (await listItems(o, db, 'connection', Connection))[0];
}
const connection = async (o: Owner): Promise<Connection | undefined> => (await connectionItem(o))?.manifest;

/** Serialize connection changes, including the first connect and stale refresh responses. */
async function saveConnection(o: Owner, manifest: Connection, expectedRevision?: string): Promise<string | undefined> {
  return tx(o.pool, async (c) => {
    if (!await exec(c, 'SELECT 1 FROM owners WHERE owner_id = $1 FOR UPDATE', [o.ownerId])) return undefined;
    const cur = await connectionItem(o, c);
    if (expectedRevision && cur?.revisionId !== expectedRevision) return undefined;
    if (cur) return saveRevision(o, c, cur.itemId, cur.revisionId, manifest);
    return (await createItem(o, c, 'connection', manifest)).revisionId;
  });
}

/** Saves a durable Calendar grant. If Google returns only a short-lived token, keep the old connection. */
export async function connect(o: Owner, grant: Grant): Promise<boolean> {
  const refreshToken = grant.refreshToken;
  if (!refreshToken) {
    clog.warn('google calendar refresh token missing', { ownerId: o.ownerId });
    return connected(o);
  }
  const revisionId = await saveConnection(o, { provider: 'google', refreshToken, scopes: grant.scopes, connectedAt: new Date().toISOString() });
  if (!revisionId) return false;
  remember(o.ownerId, revisionId, grant.accessToken, grant.expiresIn);
  clog.info('google connected', { ownerId: o.ownerId, calendar: true, refresh: true });
  return true;
}

const usable = (c: Connection | undefined): c is Connection & { refreshToken: string } => !!c?.refreshToken && c.scopes.some(isCalendarEventScope);

/** A valid access token, refreshing it when it's about to expire. Null when the calendar isn't connected (any more). */
async function token(o: Owner, signal?: AbortSignal | undefined): Promise<string | null> {
  const item = await connectionItem(o);
  if (!item || !usable(item.manifest)) return null;
  const conn = item.manifest;
  const cached = access.get(o.ownerId);
  if (cached?.revisionId === item.revisionId && cached.until > Date.now()) return cached.token;
  const r = await refreshAccess(o, conn.refreshToken, signal);
  if (r.ok) {
    // A disconnect, reconnect, or account deletion while Google responded invalidates this refresh.
    if ((await connectionItem(o))?.revisionId !== item.revisionId) return null;
    remember(o.ownerId, item.revisionId, r.accessToken, r.expiresIn);
    return r.accessToken;
  }
  if (r.revoked) {
    // Access was withdrawn at Google: forget the token so the app asks again.
    const saved = await saveConnection(o, { provider: 'google', scopes: conn.scopes.filter((s) => !isCalendarEventScope(s)), connectedAt: conn.connectedAt }, item.revisionId);
    if (saved) clog.info('google calendar access withdrawn', { ownerId: o.ownerId });
    return null;
  }
  throw new UnavailableError('Google Calendar can’t be reached right now.', { context: { step: 'refresh' } });
}

/** Drops the access token kept in memory for an account, when its connection or the whole account is deleted. */
export const forgetAccess = (ownerId: string): void => { access.delete(ownerId); };

/** The sealed refresh token, read before its connection goes, so Google can be told to revoke it afterwards. */
export const grantToRevoke = async (o: Owner): Promise<string | undefined> => (await connection(o))?.refreshToken;

/**
 * Revokes a refresh token at Google, best effort: a failure is logged by the Google module and never blocks what
 * asked for it. `signal` is the caller's own time limit, if it has one.
 */
export async function revokeGrant(o: Owner, refreshToken: string | undefined, signal?: AbortSignal | undefined): Promise<void> {
  if (!refreshToken) return;
  const revoked = await revokeRefresh(o, refreshToken, signal);
  clog.info('google grant revoke', { ownerId: o.ownerId, revoked });
}

/**
 * Forgets the sealed refresh token and the access token in memory. Revoking at Google would also
 * revoke the app's Drive grant, so disconnecting either integration only removes its own credentials.
 */
export async function disconnect(o: Owner, series: () => Promise<ReadonlyMap<string, string>>): Promise<Calendar> {
  const removed = await tx(o.pool, async (c) => {
    await exec(c, 'SELECT 1 FROM owners WHERE owner_id = $1 FOR UPDATE', [o.ownerId]);
    return exec(c, "DELETE FROM items WHERE owner_id = $1 AND kind = 'connection'", [o.ownerId]);
  });
  forgetAccess(o.ownerId);
  clog.info('google disconnected', { ownerId: o.ownerId, connections: removed });
  return view(o, series);
}

/** Whether this account's calls go on a Google Calendar. */
export const connected = async (o: Owner) => usable(await connection(o));

/**
 * One Calendar API request, 8 seconds at most, and sooner if the caller's `signal` says so (the token refresh
 * before it, too). A timeout or a network failure is thrown as fetch throws it (see `unreachable`).
 */
async function api<S extends z.ZodType>(o: Owner, method: string, path: string, schema: S, o2: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal | undefined } = {}): Promise<z.infer<S>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await token(o, o2.signal);
    if (!t) throw new UnavailableError('Google Calendar isn’t connected.', { context: { op: method } });
    const url = new URL(`${o.cfg.GOOGLE_API_URL.replace(/\/$/, '')}/calendar/v3${path}`);
    for (const [k, v] of Object.entries(o2.query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${t}`, accept: 'application/json', ...(o2.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(o2.body === undefined ? {} : { body: JSON.stringify(o2.body) }),
      signal: within(8000, o2.signal)
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
  /** `transparent`: it doesn't block time on the calendar, as all-day events usually don't. */
  transparency: z.string().optional(),
  /** Present on each occurrence of a recurring event: Google's ID for the whole series. */
  recurringEventId: z.string().optional(),
  /** On a recurring event itself: how it repeats, as iCalendar lines. */
  recurrence: z.array(z.string()).optional(),
  organizer: z.object({ email: z.string().optional(), displayName: z.string().optional(), self: z.boolean().optional() }).optional(),
  attendees: z.array(Attendee).optional(), hangoutLink: z.string().optional(),
  conferenceData: z.object({
    entryPoints: z.array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() })).optional(),
    conferenceSolution: z.object({ name: z.string().optional() }).optional()
  }).optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional()
});
type GoogleEvent = z.infer<typeof GoogleEvent>;
const GoogleList = z.object({ items: z.array(GoogleEvent).default([]), nextPageToken: z.string().optional(), timeZone: z.string().optional() });
/** The private property that marks an event as an Alcove call. */
const MARK = 'alcoveMeeting';
/** The private property that marks an event as a time held for a call that offers it, until a guest picks. */
const HOLD = 'alcoveHold';

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

const CALL_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
/** The code of the Alcove link an event has as its location: everyone's copy of an Alcove call carries one. */
function alcoveCodeOf(e: GoogleEvent, origin: string): string | undefined {
  const prefix = `${origin}/join/`;
  const link = e.location?.trim() ?? '';
  const code = link.startsWith(prefix) ? link.slice(prefix.length) : '';
  return CALL_CODE.test(code) ? code : undefined;
}

/**
 * Someone's own events worth showing beside Alcove's calls: timed, not declined, not Alcove's own.
 * An occurrence of a recurring event they've held in Alcove before says which of their series it continues.
 * Their copy of someone else's Alcove call says which call it is, and joins it.
 */
function toEvent(e: GoogleEvent, series: ReadonlyMap<string, string>, origin: string): CalendarEvent | null {
  if (e.status === 'cancelled' || !e.start?.dateTime || !e.end?.dateTime) return null;
  if (e.eventType && e.eventType !== 'default') return null;
  if (e.extendedProperties?.private?.[MARK] || e.extendedProperties?.private?.[HOLD]) return null;
  const me = e.attendees?.find((a) => a.self);
  if (me?.responseStatus === 'declined') return null;
  const organizerEmail = (e.organizer?.email ?? '').toLowerCase();
  const guests = (e.attendees ?? []).filter((a) => !a.self && !a.resource && a.email && a.email.toLowerCase() !== organizerEmail);
  const alcoveCode = alcoveCodeOf(e, origin);
  const join = alcoveCode ? { url: `${origin}/join/${alcoveCode}`, label: 'Alcove' } : joinOf(e);
  const seriesId = e.recurringEventId ? series.get(e.recurringEventId) : undefined;
  return {
    id: e.id, title: e.summary?.trim() || 'Busy', startsAt: new Date(e.start.dateTime).toISOString(), endsAt: new Date(e.end.dateTime).toISOString(),
    organizer: personOf(organizerEmail || 'unknown@calendar.invalid', e.organizer?.displayName), isOrganizer: !!e.organizer?.self,
    guests: guests.map((a) => personOf(a.email ?? '', a.displayName)), ...(join ? { join } : {}),
    calendarUrl: e.htmlLink && isUrl(e.htmlLink) ? e.htmlLink : 'https://calendar.google.com/', ...(seriesId ? { seriesId } : {}), ...(alcoveCode ? { alcoveCode } : {})
  };
}

/** The most events one read of a stretch asked for returns: a month of a busy calendar. */
const MOST_IN_RANGE = 250;
/**
 * The coming week's other events (and the last hour's, for calls already going), or with `range` every one in that
 * stretch, past ones too: any week a calendar is looked at. `series` reads which of the account's own series follow
 * which recurring events, by Google's IDs for them: only once the calendar has answered with an occurrence of one,
 * since it opens every call's manifest.
 */
export async function view(o: Owner, series: () => Promise<ReadonlyMap<string, string>>, range?: { from: Date; to: Date } | undefined): Promise<Calendar> {
  if ((await profile(o)).sample) return { source: 'sample', needsAccess: false, events: [] };
  const conn = await connection(o);
  if (!conn) return o.session?.provider === 'google' ? { source: 'google', needsAccess: true, events: [] } : { source: 'none', needsAccess: false, events: [] };
  if (!usable(conn)) return { source: 'google', needsAccess: true, events: [] };
  const now = Date.now();
  const window = range ?? { from: new Date(now - 60 * 60_000), to: new Date(now + 7 * DAY) };
  let list: z.infer<typeof GoogleList>;
  try {
    list = await api(o, 'GET', '/calendars/primary/events', GoogleList, {
      query: { timeMin: window.from.toISOString(), timeMax: window.to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(range ? MOST_IN_RANGE : 100) }
    });
  } catch (e) {
    // Access withdrawn at Google is found out here: the app asks for it again instead of failing.
    if (!usable(await connection(o))) return { source: 'google', needsAccess: true, events: [] };
    throw e;
  }
  const followed = list.items.some((e) => e.recurringEventId) ? await series() : new Map<string, string>();
  // The coming week leaves out what's over; a stretch asked for keeps everything in it.
  const shown = (x: CalendarEvent) => (range ? true : new Date(x.endsAt).getTime() > now);
  const events = list.items.flatMap((e) => { const x = toEvent(e, followed, o.cfg.WEB_ORIGIN); return x && shown(x) ? [x] : []; });
  clog.debug('calendar read', { ownerId: o.ownerId, events: events.length, range: !!range });
  return { source: 'google', needsAccess: false, events };
}

/**
 * Everyone on the events around now, as lower-cased addresses: the coming 7 days first, then the past
 * in 30-day windows (up to 90 days back), each read page by page, so the newest events come first.
 * Stops at 90 days or 500 events, and after 4 seconds in all. Resource rooms and cancelled events are
 * left out. Nothing when the calendar can't be read or Google is too slow.
 */
export async function metEmails(o: Owner): Promise<string[]> {
  if ((await profile(o)).sample || !usable(await connection(o))) return [];
  const now = Date.now();
  const signal = AbortSignal.timeout(4000);
  const windows = [[now, now + 7 * DAY], [now - 30 * DAY, now], [now - 60 * DAY, now - 30 * DAY], [now - 90 * DAY, now - 60 * DAY]] as const;
  const out: string[] = [];
  let read = 0;
  try {
    for (const [from, to] of windows) {
      let pageToken: string | undefined;
      do {
        if (read >= 500) return out;
        const list = await api(o, 'GET', '/calendars/primary/events', GoogleList, {
          signal,
          query: { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken ? { pageToken } : {}) }
        });
        read += list.items.length;
        for (const e of list.items) {
          if (e.status === 'cancelled') continue;
          for (const x of [e.organizer?.email, ...(e.attendees ?? []).filter((a) => !a.resource).map((a) => a.email)]) if (x) out.push(x.trim().toLowerCase());
        }
        pageToken = list.nextPageToken;
      } while (pageToken);
    }
    return out;
  } catch (e) {
    clog.warn('calendar colleagues unavailable', { ownerId: o.ownerId, events: read, err: e });
    return [];
  }
}

/* ---------- when people are busy: read when it's asked for, and kept nowhere ---------- */

/** The longest stretch anyone can ask about. */
const MAX_BUSY_DAYS = 31;
/** Google answers about at most this many calendars at a time. */
const FREE_BUSY_CALENDARS = 50;
/** The most of someone's own events read for one answer, a page at a time: 1,000 in a month is more than a calendar has. */
const BUSY_PAGES = 4;
const BUSY_PAGE = 250;

/** A stretch of time, in ms. */
interface Span { from: number; to: number }
const FreeBusy = z.object({
  calendars: z.record(z.string(), z.object({ busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]), errors: z.array(z.unknown()).default([]) })).default({})
});

/** Stretches as one list: inside the range, soonest first, and whatever overlaps as one. */
function tidy(spans: Span[], range: { from: Date; to: Date }): Interval[] {
  const [start, end] = [range.from.getTime(), range.to.getTime()];
  const inside = spans.map((s) => ({ from: Math.max(s.from, start), to: Math.min(s.to, end) })).filter((s) => s.from < s.to).sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of inside) {
    const last = out.at(-1);
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out.map((s) => ({ from: new Date(s.from).toISOString(), to: new Date(s.to).toISOString() }));
}

/**
 * When an event of someone's own holds them: not cancelled, not declined, and not marked free. An all-day event holds
 * its days on `zone`'s clock. Unlike what `view` shows, every type of event counts, and Alcove's own.
 */
function heldBy(e: GoogleEvent, zone: string): Span | null {
  if (e.status === 'cancelled' || e.transparency === 'transparent' || e.attendees?.find((a) => a.self)?.responseStatus === 'declined') return null;
  const moment = (w: GoogleEvent['start']) => (w?.dateTime ? Date.parse(w.dateTime) : w?.date ? zoned(w.date, 0, zone).getTime() : Number.NaN);
  const [from, to] = [moment(e.start), moment(e.end)];
  return Number.isNaN(from) || Number.isNaN(to) ? null : { from, to };
}

/** What holds someone on their own calendar, page by page. The calendar's own time zone says where its all-day events fall. */
async function ownEvents(o: Owner, range: { from: Date; to: Date }, zone: string): Promise<Span[]> {
  const out: Span[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < BUSY_PAGES; page++) {
    const list = await api(o, 'GET', '/calendars/primary/events', GoogleList, {
      query: { timeMin: range.from.toISOString(), timeMax: range.to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(BUSY_PAGE), ...(pageToken ? { pageToken } : {}) }
    });
    const where = list.timeZone && isTimeZone(list.timeZone) ? list.timeZone : zone;
    out.push(...list.items.flatMap((e) => { const held = heldBy(e, where); return held ? [held] : []; }));
    pageToken = list.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/**
 * When other people are busy, by address, as far as this account can see: Google's free/busy, 50 calendars at a time.
 * Anyone not in the answer can't be read: their calendar is private, Google said so for that calendar, or it refused the
 * whole request, as it does (403) for a connection from before free/busy was asked for. None of that fails the answer.
 * No address reaches the log, and neither does Google's reply, whose keys are addresses: only how many, and what happened.
 */
async function othersBusy(o: Owner, emails: string[], range: { from: Date; to: Date }): Promise<Map<string, Interval[]>> {
  const read = new Map<string, Interval[]>();
  const chunks = Array.from({ length: Math.ceil(emails.length / FREE_BUSY_CALENDARS) }, (_, i) => emails.slice(i * FREE_BUSY_CALENDARS, (i + 1) * FREE_BUSY_CALENDARS));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const { calendars } = await api(o, 'POST', '/freeBusy', FreeBusy, {
        body: { timeMin: range.from.toISOString(), timeMax: range.to.toISOString(), calendarExpansionMax: chunk.length, items: chunk.map((id) => ({ id })) }
      });
      for (const [id, c] of Object.entries(calendars)) {
        if (!c.errors.length) read.set(id.toLowerCase(), tidy(c.busy.map((b) => ({ from: Date.parse(b.start), to: Date.parse(b.end) })), range));
      }
    } catch (e) {
      const status = e instanceof UnavailableError ? e.context['status'] : undefined;
      clog.at(status === 403 ? 'info' : 'warn', 'free/busy not read', { ownerId: o.ownerId, people: chunk.length, status, errorClass: e instanceof Error ? e.name : 'unknown' });
    }
  }));
  return read;
}

/** The stretch asked about, of busy times or of your own calendar, refused when it can't be read or runs past 31 days. */
export function stretch(from: string, to: string): { from: Date; to: Date } {
  const range = { from: new Date(from), to: new Date(to) };
  const days = (range.to.getTime() - range.from.getTime()) / DAY;
  if (Number.isNaN(days) || days <= 0) throw new ValidationError('Ask about a stretch of time that ends after it starts.', { context: { days: Number.isNaN(days) ? 'unreadable' : Math.round(days) } });
  if (days > MAX_BUSY_DAYS) throw new ValidationError(`Ask about ${MAX_BUSY_DAYS} days at most.`, { context: { days: Math.ceil(days) } });
  return range;
}

/** The times a call holds you: still to come or going on, and neither waiting for a guest to pick a time nor started now with nobody in it. */
const callTimes = (calls: Loaded<MeetingManifest>[]): Span[] =>
  calls.flatMap(({ manifest: m }) => (m.status === 'ended' || m.offer || (m.instant && m.status === 'scheduled') ? [] : [{ from: Date.parse(m.startsAt), to: Date.parse(m.endsAt) }]));

/** What's known of you and these people: see `busy`. */
async function busyOf(o: Owner, emails: string[], range: { from: Date; to: Date }, zone: string, calls: Span[]): Promise<Busy> {
  const nobody = (source: Busy['source'], more: Span[] = []): Busy => ({ source, you: tidy([...calls, ...more], range), people: emails.map((email) => ({ email, busy: null })) });
  const me = await profile(o);
  if (me.sample) {
    const week = sampleWeek(range, zone);
    return { ...nobody('sample', week(me.email)), people: emails.map((email) => ({ email, busy: inCompany(me.email) && inCompany(email) ? tidy(week(email), range) : null })) };
  }
  if (!usable(await connection(o))) return nobody('none');
  let events: Span[];
  try {
    events = await ownEvents(o, range, zone);
  } catch (e) {
    // Access withdrawn at Google is found out here, as when reading the calendar.
    if (!usable(await connection(o))) return nobody('none');
    throw e;
  }
  const read = await othersBusy(o, emails.filter(isGuestAddress), range);
  return { ...nobody('google', events), people: emails.map((email) => ({ email, busy: read.get(email) ?? null })) };
}

/**
 * When you and these people are busy between two times, at most 31 days apart. `you` is your calendar and your own calls
 * (`calls` reads them). A person's `busy` is null when it can't be read. With no calendar connected, or access withdrawn
 * at Google, that's everyone, and `you` is your calls alone. A demo account reads a made-up week, its own and the
 * company's, and nobody's outside it. Only counts reach the log, and nothing is kept.
 */
export async function busy(o: Owner, q: { emails: string[]; from: string; to: string; timeZone?: string | undefined }, calls: () => Promise<Loaded<MeetingManifest>[]>): Promise<Busy> {
  const range = stretch(q.from, q.to);
  const b = await busyOf(o, [...new Set(q.emails)], range, q.timeZone ?? 'UTC', callTimes(await calls()));
  clog.info('busy times read', { ownerId: o.ownerId, source: b.source, stretches: b.you.length, people: b.people.length, readable: b.people.filter((p) => p.busy).length });
  return b;
}

/* ---------- Alcove's calls on the calendar ---------- */
function eventBody(o: Owner, meetingId: string, m: MeetingManifest, before?: string | undefined) {
  // In a series the calendar carries its one link, which leads to whichever call is on now or next.
  const link = `${o.cfg.WEB_ORIGIN}/join/${m.seriesCode ?? m.code}`;
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

/** Whether newly scheduled calls go on a calendar: one is connected, and the account wants them there. */
export const places = async (o: Owner): Promise<boolean> => (await profile(o)).preferences.addToCalendar && connected(o);

/** Puts a newly scheduled call on the calendar, which sends everyone invited an invitation. Null without a calendar. */
export async function place(o: Owner, meetingId: string, m: MeetingManifest): Promise<{ eventId: string; url?: string | undefined } | null> {
  if (!(await places(o))) return null;
  const e = await api(o, 'POST', '/calendars/primary/events', GoogleEvent, { query: { sendUpdates: 'all' }, body: eventBody(o, meetingId, m) });
  clog.info('call placed on calendar', { ownerId: o.ownerId, meetingId, guests: m.guests.length });
  return { eventId: e.id, url: e.htmlLink && isUrl(e.htmlLink) ? e.htmlLink : undefined };
}

/** Brings the calendar event in line with the call; everyone on it gets the update. */
export async function change(o: Owner, eventId: string, meetingId: string, m: MeetingManifest, before?: string | undefined): Promise<void> {
  if (!(await connected(o))) return;
  await api(o, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}`, GoogleEvent, { query: { sendUpdates: 'all' }, body: eventBody(o, meetingId, m, before) });
  clog.info('calendar event updated', { ownerId: o.ownerId, meetingId, guests: m.guests.length });
}

/**
 * Cancels the calendar event; everyone on it is told. Says what happened: `cancelled` now, `gone` already (which
 * is fine), or `not-connected`, when there's no calendar to send it to. `signal` is the caller's own time limit.
 */
export async function withdraw(o: Owner, eventId: string, meetingId: string, signal?: AbortSignal | undefined): Promise<'cancelled' | 'gone' | 'not-connected'> {
  if (!(await connected(o))) return 'not-connected';
  try {
    await api(o, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}`, z.unknown(), { query: { sendUpdates: 'all' }, signal });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
    clog.info('calendar event already gone', { ownerId: o.ownerId, meetingId });
    return 'gone';
  }
  clog.info('calendar event cancelled', { ownerId: o.ownerId, meetingId });
  return 'cancelled';
}

/*
 * A series on the calendar: one recurring event for all its calls, so everyone gets one invitation and not one per
 * call. Each call is one of its instances, and keeps that instance's ID, so one call can change or go on its own.
 * Google expands the rule where the organizer is (`start.timeZone`, which it requires of a recurring event), so the
 * calls keep their clock time when the clocks change, as the browser worked them out.
 */

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
/** A moment as iCalendar writes one in UTC. */
const utcStamp = (at: Date) => at.toISOString().replace(/[-:]|\.\d{3}/g, '');
/**
 * How a series repeats, as Google reads it. It runs to the end of the UTC day of its last call: not the end of `until`
 * in UTC, where an evening call in Los Angeles on the last day falls on the day after and would be lost, and not past
 * the last call, so a series the browser stopped at the most calls allowed doesn't run on without it.
 */
function rrule(rule: RepeatRule, lastStart: string): string {
  const until = `${lastStart.slice(0, 10).replaceAll('-', '')}T235959Z`;
  if (rule.every === 'month') return `RRULE:FREQ=MONTHLY;BYDAY=${rule.week}${BYDAY[rule.day]};UNTIL=${until}`;
  const days = [...rule.days].sort((a, b) => a - b).map((d) => BYDAY[d]).join(',');
  return `RRULE:FREQ=WEEKLY;INTERVAL=${rule.weeks};BYDAY=${days};UNTIL=${until}`;
}

/**
 * A run of a series' calls on one recurring event: how they repeat, and the first and last of them. The event starts
 * at the first, and takes the rest of what it says from the last: when one call has been changed on its own, it's most
 * likely the one coming up, and its title and guests shouldn't go to everything after it.
 */
export interface SeriesRun { repeat: Repeat; first: MeetingManifest; last: MeetingManifest }
/** What a recurring event says about its calls. Its times and how it repeats go separately: changing those is what can undo what's been changed on single calls. */
function seriesDetails(o: Owner, seriesId: string, m: MeetingManifest) {
  const { start: _start, end: _end, ...details } = eventBody(o, seriesId, m);
  return details;
}
const inZone = (m: MeetingManifest, timeZone: string) => ({ start: { dateTime: m.startsAt, timeZone }, end: { dateTime: m.endsAt, timeZone } });
const seriesTimes = ({ repeat, first, last }: SeriesRun) => ({ ...inZone(first, repeat.timeZone), recurrence: [rrule(repeat.rule, last.startsAt)] });

/** Puts a run of calls on the calendar as one recurring event: everyone invited gets one invitation. */
export async function placeSeries(o: Owner, seriesId: string, run: SeriesRun): Promise<string> {
  const e = await api(o, 'POST', '/calendars/primary/events', GoogleEvent, { query: { sendUpdates: 'all' }, body: { ...seriesDetails(o, seriesId, run.last), ...seriesTimes(run) } });
  clog.info('series placed on calendar', { ownerId: o.ownerId, seriesId, guests: run.last.guests.length });
  return e.id;
}

/**
 * Brings a recurring event in line with `like`, one of its calls; everyone on it gets one update. Its times and rule
 * change only with `run`, and who's on it only with `guests`: anything else leaves a call changed on its own as it is.
 * It's also how a single event starts repeating: it keeps its ID, so nobody gets a second invitation.
 */
export async function changeSeries(o: Owner, eventId: string, seriesId: string, like: MeetingManifest, change: { run?: SeriesRun | undefined; guests: boolean }): Promise<void> {
  const { attendees, ...details } = seriesDetails(o, seriesId, like);
  await api(o, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}`, GoogleEvent, { query: { sendUpdates: 'all' }, body: { ...details, ...(change.guests ? { attendees } : {}), ...(change.run ? seriesTimes(change.run) : {}) } });
  clog.info('series updated on calendar', { ownerId: o.ownerId, seriesId, guests: like.guests.length, times: !!change.run });
}

/**
 * Ends a recurring event before `before`, a call's start, as "this and following events" does in Google Calendar:
 * everything from there on goes from the calendar, the calls before stay, and everyone on it gets one update. Google
 * replaces an array that's sent, so all of `recurrence` goes.
 */
export async function endSeries(o: Owner, eventId: string, seriesId: string, before: string): Promise<void> {
  const path = `/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const e = await api(o, 'GET', path, GoogleEvent);
  const until = utcStamp(new Date(new Date(before).getTime() - 1000));
  const ended = (line: string) => `RRULE:${[...line.slice('RRULE:'.length).split(';').filter((part) => !part.startsWith('UNTIL=')), `UNTIL=${until}`].join(';')}`;
  const recurrence = (e.recurrence ?? []).map((line) => (line.startsWith('RRULE:') ? ended(line) : line));
  await api(o, 'PATCH', path, GoogleEvent, { query: { sendUpdates: 'all' }, body: { recurrence } });
  clog.info('series ended early on calendar', { ownerId: o.ownerId, seriesId });
}

/** One occurrence of a recurring event. `guests` are lower-cased addresses, without the organizer or any room. */
export interface Instance { id: string; startsAt: string; endsAt: string; title: string; guests: string[]; url?: string | undefined }
/** The occurrences a recurring event has now, soonest first: what's been cancelled one at a time isn't among them. */
export async function instances(o: Owner, eventId: string): Promise<Instance[]> {
  const out: Instance[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api(o, 'GET', `/calendars/primary/events/${encodeURIComponent(eventId)}/instances`, GoogleList, { query: { maxResults: '250', ...(pageToken ? { pageToken } : {}) } });
    for (const e of page.items) {
      if (e.status === 'cancelled' || !e.start?.dateTime) continue;
      const guests = (e.attendees ?? []).flatMap((a) => (a.email && !a.self && !a.organizer && !a.resource ? [a.email.toLowerCase()] : []));
      out.push({ id: e.id, startsAt: new Date(e.start.dateTime).toISOString(), endsAt: new Date(e.end?.dateTime ?? e.start.dateTime).toISOString(), title: e.summary ?? '', guests, url: e.htmlLink && isUrl(e.htmlLink) ? e.htmlLink : undefined });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Brings one call of a series in line, alone: the rest of the recurring event stays as it is. Everyone on it hears
 * about this one call. `quietly` is for fixing up an occurrence right after one invitation or update has gone out
 * about the whole series: without it, a series with a few changed calls would email everyone once for each. Only
 * what a call can change on its own goes: the rest it has from the recurring event.
 */
export async function changeInstance(o: Owner, eventId: string, meetingId: string, m: MeetingManifest, timeZone: string, quietly = false): Promise<void> {
  const { summary, location, description, attendees } = eventBody(o, meetingId, m);
  await api(o, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}`, GoogleEvent, { query: { sendUpdates: quietly ? 'none' : 'all' }, body: { summary, location, description, attendees, ...inZone(m, timeZone) } });
  clog.info('call in a series updated on calendar', { ownerId: o.ownerId, meetingId, guests: m.guests.length, quietly });
}

/* ---------- times held for a call that offers them ---------- */

/** What a held time is called: the call it holds the time for. */
const holdTitle = (m: MeetingManifest) => `Hold: ${m.title}`;
/** What a held time says: which call it holds the time for, on the organizer's own calendar, inviting nobody. */
function holdBody(o: Owner, meetingId: string, m: MeetingManifest) {
  const link = `${o.cfg.WEB_ORIGIN}/join/${m.code}`;
  return {
    summary: holdTitle(m),
    description: `Held until your guest picks one of the times you offered for this call. Alcove clears the others then.\n\n${link}`,
    extendedProperties: { private: { [HOLD]: meetingId } }, source: { title: 'Alcove', url: link }
  };
}

/** Holds one time a call offers on the organizer's calendar: an event of theirs that invites nobody, so Google tells nobody. Its ID. */
export async function hold(o: Owner, meetingId: string, m: MeetingManifest, at: string): Promise<string> {
  const end = new Date(new Date(at).getTime() + (new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime())).toISOString();
  const e = await api(o, 'POST', '/calendars/primary/events', GoogleEvent, { query: { sendUpdates: 'none' }, body: { ...holdBody(o, meetingId, m), start: { dateTime: at }, end: { dateTime: end }, transparency: 'opaque' } });
  clog.info('offered time held on calendar', { ownerId: o.ownerId, meetingId });
  return e.id;
}

/** Gives a held time the call's name as it is now, telling nobody. */
export async function retitleHold(o: Owner, eventId: string, m: MeetingManifest): Promise<void> {
  if (!(await connected(o))) return;
  await api(o, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}`, GoogleEvent, { query: { sendUpdates: 'none' }, body: { summary: holdTitle(m) } });
}

/** Takes a held time off the calendar, telling nobody. Says what happened, as `withdraw` does. `signal` is the caller's own time limit. */
export async function release(o: Owner, eventId: string, signal?: AbortSignal | undefined): Promise<'cancelled' | 'gone' | 'not-connected'> {
  if (!(await connected(o))) return 'not-connected';
  try {
    await api(o, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}`, z.unknown(), { query: { sendUpdates: 'none' }, signal });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
    return 'gone';
  }
  return 'cancelled';
}

/** Takes an occurrence the series has no call for off the calendar, without a word: it's part of a change everyone has already heard about. */
export async function dropInstance(o: Owner, eventId: string): Promise<void> {
  try {
    await api(o, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}`, z.unknown(), { query: { sendUpdates: 'none' } });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
}

const SAID = new Map<string, Rsvp>([['accepted', 'yes'], ['tentative', 'maybe'], ['declined', 'no']]);
/**
 * What people on a call's event have said in Google, by lower-cased address, for the organizer opening the call: read
 * now and stored nowhere. Nothing without a calendar, and someone who hasn't said isn't there.
 */
export async function answers(o: Owner, eventId: string, signal: AbortSignal): Promise<Map<string, Rsvp>> {
  if (!(await connected(o))) return new Map();
  const e = await api(o, 'GET', `/calendars/primary/events/${encodeURIComponent(eventId)}`, GoogleEvent, { signal });
  return new Map((e.attendees ?? []).flatMap((a): [string, Rsvp][] => { const said = SAID.get(a.responseStatus ?? ''); return a.email && said ? [[a.email.toLowerCase(), said]] : []; }));
}

/** Google didn't answer in time, or couldn't be reached at all (fetch fails with a TypeError): the next request would fare no better. */
export const unreachable = (e: unknown): boolean => e instanceof TypeError || (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'));

/** One of the account's own events, to make it an Alcove call: the organizer's only, and not one already. */
export async function ownEvent(o: Owner, eventId: string): Promise<{
  title: string; startsAt: string; endsAt: string; guests: string[]; description?: string | undefined; url?: string | undefined; recurringEventId?: string | undefined;
}> {
  // Google's event IDs stay out of errors, which are logged with their context: an occurrence's ID names its recurring event.
  const e = await api(o, 'GET', `/calendars/primary/events/${encodeURIComponent(eventId)}`, GoogleEvent);
  if (!e.organizer?.self) throw new ForbiddenError('Only the organizer can move this call to Alcove.');
  if (!e.start?.dateTime || !e.end?.dateTime) throw new NotFoundError('That isn’t a call with a start and end time.', { context: { allDay: !!e.start?.date } });
  const organizer = (e.organizer.email ?? '').toLowerCase();
  const guests = (e.attendees ?? []).flatMap((a) => (!a.self && !a.resource && a.email && a.email.toLowerCase() !== organizer ? [a.email.toLowerCase()] : []));
  return {
    title: e.summary?.trim() || 'Untitled call', startsAt: new Date(e.start.dateTime).toISOString(), endsAt: new Date(e.end.dateTime).toISOString(),
    guests, description: e.description, url: e.htmlLink && isUrl(e.htmlLink) ? e.htmlLink : undefined, recurringEventId: e.recurringEventId
  };
}
