/**
 * Finding a time and bringing documents, end to end: the real API over HTTP via @alcove/api-http, real Postgres, and
 * the stand-in Google, whose Calendar API the server reads as it reads Google's. Busy times are read when they're
 * asked for and kept nowhere: not in a row, a receipt or a log line. Demo accounts get a made-up week and catalog.
 */
import { AlcoveApiError, type Busy, type Interval } from '@alcove/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { tx } from './db';
import { updateManifest } from './modules/meetings';
import { openOwner } from './owners';
import type { GoogleUser, Spoil } from './testing/fake-google';
import { ORIGIN, startHarness, type Browser, type Harness } from './testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const art = async () => { const b = h.browser(); const r = await b.api.auth.signIn('microsoft'); return { ...b, session: r.session }; };
const person = (name: string): GoogleUser => { const n = seq++; return { sub: `g-${name}-${n}`, email: `${name}.${n}@acme.example`, name: `${name} Example` }; };
/** Signs in with Google the way a browser does, following each redirect by hand. */
async function viaGoogle(b: Browser, user: GoogleUser, spoil?: Spoil): Promise<void> {
  h.google.next(user, spoil);
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10; hop++) {
    if (url.origin === new URL(ORIGIN).origin) return;
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  throw new Error('Too many redirects while signing in with Google.');
}
/** Monday 4 March 2030, and the week that follows. */
const WEEK = { from: '2030-03-04T00:00:00.000Z', to: '2030-03-11T00:00:00.000Z' };
const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2030, 2, 4 + day, hour, minute)).toISOString();
const event = (id: string, from: string, to: string, more: Record<string, unknown> = {}) => ({ id, summary: id, start: { dateTime: from }, end: { dateTime: to }, ...more });
/** Asking the way the app does, straight to the API, for what `calendar.busy` doesn't say: another time zone, or a request that's refused. */
async function ask(b: Browser, body: unknown): Promise<Busy> {
  const res = await b.fetch(`${h.baseUrl}/v1/calendar/busy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
  return z.object({ source: z.enum(['google', 'sample', 'none']), you: z.array(z.object({ from: z.string(), to: z.string() })), people: z.array(z.object({ email: z.string(), busy: z.array(z.object({ from: z.string(), to: z.string() })).nullable() })) }).parse(await res.json());
}
const freeBusyCalls = () => h.google.calls.filter((c) => c.path === '/calendar/v3/freeBusy').length;

describe('reading someone’s own calendar', () => {
  it('counts what holds them: their events and their Alcove calls, and not what they declined or marked free', async () => {
    const me = person('ana');
    const self = { attendees: [{ email: me.email, self: true, responseStatus: 'accepted' }] };
    h.google.calendar(me.sub).push(
      event('sync', at(0, 9), at(0, 10), self),
      // Overlapping ones read as one stretch.
      event('overrun', at(0, 9, 30), at(0, 10, 30)),
      event('focus', at(0, 14), at(0, 15), { eventType: 'focusTime' }),
      event('declined', at(1, 9), at(1, 10), { attendees: [{ email: me.email, self: true, responseStatus: 'declined' }] }),
      event('marked-free', at(1, 11), at(1, 12), { transparency: 'transparent' }),
      event('cancelled', at(1, 13), at(1, 14), { status: 'cancelled' }),
      { id: 'away', summary: 'Away', start: { date: '2030-03-07' }, end: { date: '2030-03-08' } },
      { id: 'birthday', summary: 'Birthday', start: { date: '2030-03-08' }, end: { date: '2030-03-09' }, transparency: 'transparent' },
      // Partly outside what's asked: only the part inside it.
      event('long', at(6, 23), at(7, 2))
    );
    const b = h.browser();
    await viaGoogle(b, me);
    await b.api.meetings.create({ title: 'Pricing', startsAt: at(2, 10), durationMinutes: 30, guests: [], notes: 'off' });

    const r = await ask(b, { emails: [], ...WEEK, timeZone: 'UTC' });
    expect(r.source).toBe('google');
    expect(r.people).toEqual([]);
    expect(r.you).toEqual([
      { from: at(0, 9), to: at(0, 10, 30) }, { from: at(0, 14), to: at(0, 15) }, { from: at(2, 10), to: at(2, 10, 30) },
      { from: at(3, 0), to: at(4, 0) }, { from: at(6, 23), to: at(7, 0) }
    ]);
    // An all-day event holds its day where the calendar is, here as the person asks.
    const tokyo = await ask(b, { emails: [], ...WEEK, timeZone: 'Asia/Tokyo' });
    expect(tokyo.you).toContainEqual({ from: at(2, 15), to: at(3, 15) });
    // Through the client too, which says where the browser is.
    expect((await b.api.calendar.busy([], WEEK)).you.length).toBeGreaterThan(0);
  });

  it('counts a call started now only once someone is in it, not one that’s over, and not one still waiting for a time', async () => {
    const me = person('bram');
    const b = h.browser();
    await viaGoogle(b, me, 'no-calendar');
    const ownerId = (await b.api.auth.getSession())?.ownerId ?? '';
    const range = { from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 3_600_000).toISOString() };
    // Its times are only offered: nothing holds anyone until someone picks one.
    const offered = await b.api.meetings.create({ title: 'Intro', startsAt: new Date().toISOString(), durationMinutes: 30, guests: [], notes: 'off' });
    expect((await b.api.calendar.busy([], range)).you).toHaveLength(1);
    const o = await openOwner(h.deps, ownerId, undefined);
    await tx(h.pool, (c) => updateManifest(o, c, offered.id, (m) => ({ ...m, offer: { times: [m.startsAt] } })));
    expect((await b.api.calendar.busy([], range)).you).toEqual([]);
    const { code: c } = await b.api.calls.startNow({ notes: 'off' });
    expect((await b.api.calendar.busy([], range)).you).toEqual([]);
    const call = await b.api.calls.join(c, { mic: true, cam: false });
    expect((await b.api.calendar.busy([], range)).you).toHaveLength(1);
    await call.leave();
    expect((await b.api.calendar.busy([], range)).you).toEqual([]);
  });

  it('reads every page of a busy month', async () => {
    const me = person('cal');
    h.google.calendar(me.sub).push(...Array.from({ length: 260 }, (_, i) => event(`e-${i}`, at(0, 0, i * 30), at(0, 0, i * 30 + 10))));
    const b = h.browser();
    await viaGoogle(b, me);
    expect((await b.api.calendar.busy([], WEEK)).you).toHaveLength(260);
  });
});

describe('reading other people’s calendars', () => {
  it('asks Google 50 at a time, and an address it can’t read is null, without failing the answer', async () => {
    const me = person('dee');
    const b = h.browser();
    await viaGoogle(b, me);
    h.google.freeBusy('kofi@acme.example', [{ start: at(0, 9), end: at(0, 10) }, { start: at(0, 9, 30), end: at(0, 11) }]);
    h.google.freeBusy('open@acme.example', []);
    const before = freeBusyCalls();
    const many = Array.from({ length: 120 }, (_, i) => `someone.${i}@elsewhere.example`);
    const r = await b.api.calendar.busy(['kofi@acme.example', 'open@acme.example', 'private@gmail.com', 'not an address', ...many], WEEK);
    expect(r.source).toBe('google');
    expect(freeBusyCalls() - before).toBe(3);
    expect(r.people.slice(0, 4)).toEqual([
      // Read as Google gives them, as one tidy list.
      { email: 'kofi@acme.example', busy: [{ from: at(0, 9), to: at(0, 11) }] },
      // Free all week is an answer. Not being able to read it is another.
      { email: 'open@acme.example', busy: [] },
      { email: 'private@gmail.com', busy: null },
      { email: 'not an address', busy: null }
    ]);
    expect(r.people.slice(4).every((p) => p.busy === null)).toBe(true);
    expect(r.people).toHaveLength(124);
  });

  it('reads nobody for a connection from before free/busy was asked for, and still reads their own calendar', async () => {
    const me = person('eli');
    h.google.calendar(me.sub).push(event('sync', at(0, 9), at(0, 10)));
    const b = h.browser();
    await viaGoogle(b, me, 'no-freebusy');
    h.google.freeBusy('kofi@acme.example', [{ start: at(0, 9), end: at(0, 10) }]);
    const r = await b.api.calendar.busy(['kofi@acme.example'], WEEK);
    expect(r).toEqual({ source: 'google', you: [{ from: at(0, 9), to: at(0, 10) }], people: [{ email: 'kofi@acme.example', busy: null }] });
  });

  it('says so when nothing is connected: their own Alcove calls, and nobody’s calendar', async () => {
    const me = person('fay');
    const b = h.browser();
    await viaGoogle(b, me, 'no-calendar');
    await b.api.meetings.create({ title: 'Pricing', startsAt: at(2, 10), durationMinutes: 30, guests: [], notes: 'off' });
    const before = h.google.calls.length;
    expect(await b.api.calendar.busy(['kofi@acme.example'], WEEK)).toEqual({ source: 'none', you: [{ from: at(2, 10), to: at(2, 10, 30) }], people: [{ email: 'kofi@acme.example', busy: null }] });
    expect(h.google.calls.length).toBe(before);
  });

  it('reads as nothing connected once the calendar’s access is withdrawn at Google', async () => {
    const me = person('gus');
    const b = h.browser();
    await viaGoogle(b, me);
    h.google.revoke(me.sub);
    expect(await b.api.calendar.busy(['kofi@acme.example'], WEEK)).toEqual({ source: 'none', you: [], people: [{ email: 'kofi@acme.example', busy: null }] });
  });
});

describe('what asking about busy times leaves behind', () => {
  it('refuses a range it can’t read: past 31 days, backwards, or not a time', async () => {
    const b = await account();
    const refused = (range: { from: string; to: string }) => b.api.calendar.busy([], range).then(() => 'answered', (e: unknown) => code(e));
    expect(await refused({ from: at(0, 0), to: at(31, 0) })).toBe('answered');
    expect(await refused({ from: at(0, 0), to: at(31, 1) })).toBe('invalid');
    expect(await refused({ from: at(1, 0), to: at(0, 0) })).toBe('invalid');
    expect(await refused({ from: 'tomorrow', to: at(0, 0) })).toBe('invalid');
    expect(code(await b.api.calendar.busy(Array.from({ length: 301 }, (_, i) => `a${i}@acme.example`), WEEK).catch((e: unknown) => e))).toBe('invalid');
    expect((await h.browser().fetch(`${h.baseUrl}/v1/calendar/busy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emails: [], ...WEEK }) })).status).toBe(401);
  });

  it('keeps no receipt and no row of it, and logs counts: never who was asked about, or when they’re busy', async () => {
    const me = person('hal');
    h.google.calendar(me.sub).push(event('canary-event', at(0, 9, 11), at(0, 9, 47), { attendees: [{ email: 'canary-attendee@acme.example' }] }));
    const b = h.browser();
    await viaGoogle(b, me);
    h.google.freeBusy('canary-colleague@acme.example', [{ start: at(1, 9, 13), end: at(1, 9, 43) }]);
    const ownerId = (await b.api.auth.getSession())?.ownerId ?? '';
    const receipts = async () => z.object({ n: z.coerce.number() }).parse((await h.pool.query('SELECT count(*) AS n FROM operations WHERE owner_id = $1', [ownerId])).rows[0]).n;
    const had = await receipts();
    const logged = h.logs.length;
    const r = await b.api.calendar.busy(['canary-colleague@acme.example', 'canary-private@gmail.com'], WEEK);
    expect(r.people.map((p) => p.busy?.length ?? null)).toEqual([1, null]);
    expect(await receipts()).toBe(had);

    const lines = h.logs.slice(logged).join('');
    expect(lines).toContain('busy times read');
    for (const secret of ['canary-colleague', 'canary-private', 'canary-attendee', 'canary-event', at(1, 9, 13), at(0, 9, 11), at(1, 9, 43)]) expect(lines, secret).not.toContain(secret);
    expect(lines.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []).toEqual([]);
    const dump = z.object({ all: z.string().nullable() }).parse((await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM items x UNION ALL SELECT row_to_json(x)::text FROM revisions x UNION ALL SELECT row_to_json(x)::text FROM operations x) q`)).rows[0]).all ?? '';
    for (const secret of ['canary-colleague', Buffer.from('canary-colleague').toString('hex'), Buffer.from('canary-private').toString('hex')]) expect(dump, secret).not.toContain(secret);
  });
});

describe('a demo account’s week', () => {
  const clock = (iso: string, zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', weekday: 'short' }).format(new Date(iso));
  const hours = (iso: string, zone: string) => { const [hh = '0', mm = '0'] = clock(iso, zone).split(' ').at(-1)?.split(':') ?? []; return Number(hh) + Number(mm) / 60; };
  const TEAM = ['theo@vandelay.industries', 'kofi@vandelay.industries', 'sam@vandelay.industries', 'lena@vandelay.industries', 'aiko@vandelay.industries', 'maya@vandelay.industries'];

  it('is a believable week: the same on every read, in working hours, with lunch, and different for each person', async () => {
    const a = await art();
    const zone = 'Europe/London';
    const r = await ask(a, { emails: TEAM, ...WEEK, timeZone: zone });
    expect(r.source).toBe('sample');
    expect(await ask(a, { emails: TEAM, ...WEEK, timeZone: zone })).toEqual(r);
    // Asked about one day, it's the same day.
    const tuesday = { from: at(1, 0), to: at(2, 0) };
    const day = await ask(a, { emails: TEAM, ...tuesday, timeZone: zone });
    const within = (x: Interval) => x.from >= tuesday.from && x.to <= tuesday.to;
    expect(day.people).toEqual(r.people.map((p) => ({ email: p.email, busy: p.busy?.filter(within) ?? null })));

    const weeks = r.people.map((p) => p.busy ?? []);
    for (const busy of weeks) {
      expect(busy.length).toBeGreaterThan(5);
      for (const x of busy) {
        expect(clock(x.from, zone)).toMatch(/^(Mon|Tue|Wed|Thu|Fri)/);
        expect(hours(x.from, zone)).toBeGreaterThanOrEqual(9);
        expect(hours(x.to, zone)).toBeLessThanOrEqual(17);
      }
      // Every working day has lunch in it, somewhere around the middle of the day.
      for (let d = 0; d < 5; d++) expect(busy.some((x) => x.from.slice(0, 10) === at(d, 0).slice(0, 10) && hours(x.from, zone) <= 13.5 && hours(x.to, zone) >= 12)).toBe(true);
    }
    // Not everyone at once: nobody's week is anybody else's, and few of its half hours suit the whole team, but some do.
    expect(new Set(weeks.map((w) => JSON.stringify(w))).size).toBe(TEAM.length);
    const halfHours = Array.from({ length: 5 * 16 }, (_, i) => at(Math.floor(i / 16), 9 + Math.floor((i % 16) / 2), (i % 2) * 30));
    const everyoneFree = halfHours.filter((t) => !weeks.some((w) => w.some((x) => x.from <= t && t < x.to)));
    expect(everyoneFree.length).toBeGreaterThan(0);
    expect(everyoneFree.length).toBeLessThan(halfHours.length / 2);
    expect(r.you.length).toBeGreaterThan(5);
  });

  it('keeps working hours where the person asking is', async () => {
    const a = await art();
    const r = await ask(a, { emails: ['theo@vandelay.industries'], ...WEEK, timeZone: 'Asia/Tokyo' });
    for (const x of r.people[0]?.busy ?? []) {
      expect(hours(x.from, 'Asia/Tokyo')).toBeGreaterThanOrEqual(9);
      expect(hours(x.to, 'Asia/Tokyo')).toBeLessThanOrEqual(17);
    }
    // A zone this server doesn't know is no reason to fail the answer.
    expect((await ask(a, { emails: ['theo@vandelay.industries'], ...WEEK, timeZone: 'Mars/Olympus' })).people[0]?.busy?.length).toBeGreaterThan(0);
  });

  it('reads the company for anyone at it, and nobody outside it', async () => {
    const theo = await account('theo@vandelay.industries');
    const r = await theo.api.calendar.busy(['kofi@vandelay.industries', 'nobody.listed@vandelay.industries', 'priya@lumen.health', 'jamie@harbourline.co'], WEEK);
    expect(r.source).toBe('sample');
    expect(r.people.map((p) => p.busy === null)).toEqual([false, false, true, true]);
    // Someone on their own has a week of their own, and can read nobody's.
    const zara = await account(unique('zara'));
    const own = await zara.api.calendar.busy(['kofi@vandelay.industries', unique('nadia')], WEEK);
    expect(own.source).toBe('sample');
    expect(own.you.length).toBeGreaterThan(5);
    expect(own.people.map((p) => p.busy)).toEqual([null, null]);
  });

  it('counts their own calls in it', async () => {
    const zara = await account(unique('zara'));
    await zara.api.meetings.create({ title: 'Sat morning', startsAt: at(5, 10), durationMinutes: 30, guests: [], notes: 'off' });
    expect((await zara.api.calendar.busy([], WEEK)).you).toContainEqual({ from: at(5, 10), to: at(5, 10, 30) });
  });
});

describe('documents', () => {
  const soon = { title: 'Launch check-in', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [], notes: 'off' as const };

  it('gives the demo company two workspaces, someone on their own their documents, and anyone else none', async () => {
    const a = await art();
    const library = await a.api.documents.list();
    expect(library.source).toBe('sample');
    expect(library.workspaces.map((w) => [w.name, w.documents.map((d) => [d.name, d.kind, d.by])])).toEqual([
      ['Product', [['Launch plan', 'doc', 'Priya'], ['Launch checklist', 'sheet', 'Maya'], ['Pricing page copy', 'doc', 'Lena']]],
      ['Design', [['Onboarding flow', 'board', 'Aiko']]]
    ]);
    expect(library.workspaces.flatMap((w) => w.documents).every((d) => !Number.isNaN(Date.parse(d.updatedAt)))).toBe(true);
    expect((await (await account('kofi@vandelay.industries')).api.documents.list()).workspaces.map((w) => w.name)).toEqual(['Product', 'Design']);

    const zara = await account('zara.ahmed@tests.example');
    const own = await zara.api.documents.list();
    expect(own.source).toBe('sample');
    expect(own.workspaces.map((w) => [w.name, w.documents.map((d) => [d.name, d.kind, d.by])])).toEqual([
      ['Your documents', [['Harbourline proposal', 'doc', 'Zara'], ['Rates 2026', 'sheet', 'Zara'], ['Project brief template', 'doc', 'Zara']]]
    ]);

    const real = h.browser();
    await viaGoogle(real, person('ida'));
    expect(await real.api.documents.list()).toEqual({ source: 'none', workspaces: [] });
    expect((await h.browser().fetch(`${h.baseUrl}/v1/documents`)).status).toBe(401);
  });

  it('brings documents to a call, and refuses anything that isn’t in the organizer’s own library', async () => {
    const a = await art();
    const docs = (await a.api.documents.list()).workspaces.flatMap((w) => w.documents);
    const [plan, sheet] = docs;
    const m = await a.api.meetings.create({ ...soon, documents: [plan?.id ?? '', sheet?.id ?? ''] });
    expect(m.documents).toEqual([
      { id: plan?.id, kind: 'doc', by: 'Priya', name: 'Launch plan' },
      { id: sheet?.id, kind: 'sheet', by: 'Maya', name: 'Launch checklist' }
    ]);
    expect((await a.api.meetings.get(m.id)).documents).toEqual(m.documents);

    const refused = (p: Promise<unknown>) => p.then(() => 'accepted', (e: unknown) => code(e));
    expect(await refused(a.api.meetings.create({ ...soon, documents: ['nothing-of-the-kind'] }))).toBe('invalid');
    expect(await refused(a.api.meetings.create({ ...soon, documents: [plan?.id ?? '', plan?.id ?? ''] }))).toBe('invalid');
    expect(await refused(a.api.meetings.update(m.id, { documents: ['nothing-of-the-kind'] }))).toBe('invalid');

    // An ID from someone else's library is unknown here: the demo company's from outside it, and another person's own.
    const zara = await account('zara.bloom@tests.example');
    const nadia = await account('nadia.haddad@tests.example');
    const hers = (await zara.api.documents.list()).workspaces.flatMap((w) => w.documents)[0]?.id ?? '';
    expect((await zara.api.meetings.create({ ...soon, documents: [hers] })).documents).toEqual([{ id: hers, kind: 'doc', by: 'Zara', name: 'Harbourline proposal' }]);
    expect(await refused(nadia.api.meetings.create({ ...soon, documents: [hers] }))).toBe('invalid');
    expect(await refused(nadia.api.meetings.create({ ...soon, documents: [plan?.id ?? ''] }))).toBe('invalid');
    expect(await refused(a.api.meetings.create({ ...soon, documents: [hers] }))).toBe('invalid');
    const real = h.browser();
    await viaGoogle(real, person('jo'));
    expect(await refused(real.api.meetings.create({ ...soon, documents: [plan?.id ?? ''] }))).toBe('invalid');
  });

  it('shows whose a document is, and not its name, to someone who can’t open it', async () => {
    const a = await art();
    const plan = (await a.api.documents.list()).workspaces.flatMap((w) => w.documents)[0]?.id ?? '';
    const zara = await account('zara.chen@tests.example');
    const hers = (await zara.api.documents.list()).workspaces.flatMap((w) => w.documents)[1]?.id ?? '';
    // Someone at another address holding a call with both on it, as a meeting read by someone it was brought to.
    const nadia = await account('nadia.ochoa@tests.example');
    const m = await nadia.api.meetings.create(soon);
    const o = await openOwner(h.deps, nadia.session.ownerId, undefined);
    await tx(h.pool, (c) => updateManifest(o, c, m.id, (x) => ({ ...x, documents: [plan, hers, 'since-deleted'] })));
    expect((await nadia.api.meetings.get(m.id)).documents).toEqual([
      { id: plan, kind: 'doc', by: 'Priya', name: null },
      { id: hers, kind: 'sheet', by: 'Zara', name: null }
    ]);
  });
});
