/**
 * Calls that repeat: a series with one link and one recurring event, changing and cancelling one call or this and
 * later ones, and everything that has to keep working when a call in the middle goes or moves. The real API over HTTP
 * via @alcove/api-http, real Postgres, the local LiveKit server, and the stand-in Google, whose recurring events
 * expand their rules in their own time zones and which notes everything it emails.
 */
import { AlcoveApiError, MAX_SERIES_CALLS, REQUEST_ID_HEADER, type CallSession, type CallState, type Meeting, type MeetingInput, type RepeatInput, type RepeatRule } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openOwner } from '../../owners';
import type { FakeEvent } from '../../testing/fake-google';
import { connectGoogleCalendar, cookieFetch, ORIGIN, startHarness, type Browser, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';
import { findItem } from '../../vault';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.google.refuse(); h.closeCalls(); });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const refusal = (p: Promise<unknown>) => p.then(() => 'went through', code);
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh demo account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
/** A real account, signed in with (the stand-in) Google, with its calendar connected. */
async function googleAccount(name: string, address?: string | undefined) {
  const b = h.browser();
  const n = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  const sub = `google-${n}`;
  const email = address ?? `${name.toLowerCase()}.${n}@example.com`;
  const who = { sub, email, name };
  h.google.next(who);
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  expect(await connectGoogleCalendar(h, b, who)).toBe(`${ORIGIN}/settings?calendar=connected#calendar`);
  return { ...b, session, sub, email };
}
type Account = Awaited<ReturnType<typeof account>>;

const day = (at: number) => new Date(at).toISOString().slice(0, 10);
/** On the hour, a couple of days off, so every call in a test is still to come. */
const soon = (days = 2) => Math.ceil((Date.now() + days * DAY) / HOUR) * HOUR;
/** What the app sends for every week on one day, in UTC: a week apart. */
function weekly(first: number, count: number): RepeatInput {
  const occurrences = Array.from({ length: count }, (_, i) => new Date(first + i * 7 * DAY).toISOString());
  return { rule: { every: 'week', weeks: 1, days: [new Date(first).getUTCDay()] }, until: day(first + (count - 1) * 7 * DAY), timeZone: 'UTC', occurrences };
}
const schedule = (title: string, guests: string[], count = 4, more: Partial<MeetingInput> = {}): MeetingInput => {
  const first = soon();
  return { title, startsAt: new Date(first).toISOString(), durationMinutes: 30, guests, notes: 'off', repeat: weekly(first, count), ...more };
};
/** A series' calls still to come, soonest first. */
const upcomingIn = async (a: Pick<Account, 'api'>, seriesId: string | undefined) => (await a.api.meetings.upcoming()).filter((m) => m.seriesId === seriesId).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
const at = <T,>(list: T[], i: number): T => {
  const v = list[i];
  if (v === undefined) throw new Error(`nothing at ${i}`);
  return v;
};
const joined = (o: { guests: { email: string }[] }) => o.guests.map((g) => g.email).sort();
const starts = (ms: Meeting[]) => ms.map((m) => m.startsAt);
/** The recurring events on someone's calendar, oldest first. */
const masters = (sub: string) => h.google.calendar(sub).filter((e) => e.recurrence);
const only = (sub: string): FakeEvent => at(masters(sub), 0);
const occurrences = (sub: string, e: FakeEvent) => h.google.instances(sub, e.id);
const startOf = (e: FakeEvent) => new Date(e.start?.dateTime ?? '').toISOString();
const linkTo = (c: string | undefined) => `${ORIGIN}/join/${c ?? ''}`;
/** The writes made to Google since `mark`: reading never emails anyone. */
const writesSince = (mark: number) => h.google.calls.slice(mark).filter((c) => c.method !== 'GET');
const mailAbout = (...ids: string[]) => h.google.mail.filter((m) => ids.includes(m.eventId));
const inserted = (ownerId: string, sql: string) => h.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, [ownerId]).then((r) => r.rows[0]?.n);
const seriesItems = (ownerId: string) => inserted(ownerId, `items WHERE owner_id = $1 AND kind = 'series'`);
/** A series' item as it's stored, opened with its organizer's keys. */
async function sealed(ownerId: string, seriesId: string | undefined) {
  const item = await findItem(await openOwner(h.deps, ownerId, undefined), h.pool, 'series', seriesId ?? '', z.looseObject({ title: z.string() }));
  if (!item) throw new Error('that series isn’t stored');
  return item.manifest;
}
/** Holds a call by a code until `session.leave()`. */
const hold = (a: Pick<Account, 'api'>, c: string): Promise<CallSession> => a.api.calls.join(c, { mic: false, cam: false });
const end = async (s: CallSession) => { await s.leave(); };
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function settled(session: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(session.getSnapshot()); i++) { await session.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return session.getSnapshot();
}
const inGroup = (session: CallSession) => waitFor(() => session.crypto.getSnapshot().status === 'in' && session.crypto.getSnapshot().media !== null, `${session.ticket.role} in the call’s group`);

describe('a repeating call, from start to end', () => {
  it('schedule → the link joins → cancel the first → change one → change the rest → cancel them → nothing left', async () => {
    const org = await googleAccount('Wren');
    const first = await org.api.meetings.create(schedule('Whole journey', [unique('lena')], 5));
    const link = first.seriesCode ?? '';
    const [one, two, three, four, five] = await upcomingIn(org, first.seriesId);
    if (!one || !two || !three || !four || !five) throw new Error('five calls were scheduled');
    expect(h.google.calendar(org.sub)).toHaveLength(1);

    const joinedFirst = await hold(org, link);
    expect(joinedFirst.getSnapshot().meetingId).toBe(one.id);
    await end(joinedFirst);
    // It keeps the link for now: its time isn't even up.
    expect((await h.browser().api.calls.card(link)).ended).toBe(true);
    await org.api.meetings.cancel(two.id);

    await org.api.meetings.update(three.id, { title: 'Only the third' });
    await org.api.meetings.update(four.id, { title: 'From the fourth' }, { scope: 'following' });
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.title)).toEqual(['Only the third', 'From the fourth', 'From the fourth']);

    await org.api.meetings.cancel(three.id, { scope: 'following' });
    expect(await upcomingIn(org, first.seriesId)).toEqual([]);
    // The call that was held stays, with the link leading to it; cancelling it too leaves nothing.
    expect((await h.browser().api.calls.card(link)).ended).toBe(true);
    await org.api.meetings.cancel(one.id);
    expect(await seriesItems(org.session.ownerId)).toBe(0);
    expect(await refusal(h.browser().api.calls.card(link))).toBe('not-found');
    expect(h.google.calendar(org.sub)).toEqual([]);
  });
});

describe('scheduling calls that repeat', () => {
  it('makes a call for each time, with one link and one event that invites everyone once', async () => {
    const org = await googleAccount('Olu');
    const [lena, kofi] = [unique('lena'), unique('kofi')];
    const input = schedule('Design sync', [lena, kofi], 4, { notes: 'on', joinMuted: true });
    const mark = h.google.calls.length;
    const first = await org.api.meetings.create(input);

    // It gives back the first call, and each one is an ordinary call with its own code.
    if (!input.repeat) throw new Error('it repeats');
    const { occurrences: times, ...repeat } = input.repeat;
    expect(first).toMatchObject({ title: 'Design sync', startsAt: input.startsAt, status: 'scheduled', notes: 'on', joinMuted: true, repeat });
    const calls = await upcomingIn(org, first.seriesId);
    expect(starts(calls)).toEqual(times);
    expect(new Set(calls.map((c) => c.code)).size).toBe(4);
    expect(new Set(calls.map((c) => c.seriesCode))).toEqual(new Set([first.seriesCode]));
    expect(calls.map((c) => c.code)).not.toContain(first.seriesCode);
    expect(calls.every((c) => joined(c).join() === [kofi, lena].sort().join() && c.repeat?.until === repeat.until)).toBe(true);
    expect(await seriesItems(org.session.ownerId)).toBe(1);

    // One event carries them all, with the series' link and the zone Google needs, and each call knows its occurrence.
    expect(h.google.calendar(org.sub)).toHaveLength(1);
    const master = only(org.sub);
    expect(master).toMatchObject({ summary: 'Design sync', location: linkTo(first.seriesCode), start: { timeZone: 'UTC' }, end: { timeZone: 'UTC' } });
    expect(master.recurrence).toEqual([`RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(input.startsAt).getUTCDay()]};UNTIL=${repeat.until.replaceAll('-', '')}T235959Z`]);
    expect(master.description).toContain(linkTo(first.seriesCode));
    const found = occurrences(org.sub, master);
    expect(found.map(startOf)).toEqual(times);
    expect(calls.map((c) => c.calendarUrl)).toEqual(found.map((i) => i.htmlLink));

    // One invitation, not one per call: one write to Google, one email to each.
    expect(writesSince(mark)).toEqual([{ method: 'POST', path: '/calendar/v3/calendars/primary/events', sendUpdates: 'all' }]);
    expect(mailAbout(master.id)).toEqual([{ kind: 'invitation', eventId: master.id, to: [lena, kofi] }]);

    // Its item holds what belongs to no single call, and nothing else: no times, no guests, no notes setting.
    expect(await sealed(org.session.ownerId, first.seriesId)).toEqual({ title: 'Design sync', repeat, code: first.seriesCode, calendarEvent: { id: master.id } });

    // The series says how it repeats, and doesn't pretend to be a recurring Google event.
    expect(await org.api.series.get(first.seriesId ?? '')).toMatchObject({ id: first.seriesId, recurring: false, repeat, next: { id: first.id } });
    expect((await org.api.meetings.get(calls[2]?.id ?? '')).repeat).toEqual(repeat);
  });

  it('writes every rule so Google works out the same calls', async () => {
    const org = await googleAccount('Rule');
    const firstOf = (weekday: number, from: number) => { let t = from; while (new Date(t).getUTCDay() !== weekday) t += DAY; return t; };
    const stamp = (t: number) => `${day(t).replaceAll('-', '')}T235959Z`;
    const cases: [RepeatRule, number[], string][] = [];
    // Every 2 weeks on two days, from a Tuesday: the weeks skipped are whole weeks, starting on Monday.
    const tuesday = firstOf(2, soon());
    const fortnights = [0, 2, 14, 16, 28].map((d) => tuesday + d * DAY);
    cases.push([{ every: 'week', weeks: 2, days: [4, 2] }, fortnights, `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=${stamp(at(fortnights, 4))}`]);
    // The second Wednesday of each month, and the last Friday of each month, in the next three months.
    const now = new Date();
    const inMonth = (i: number, weekday: number, n: number) => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1, 15));
      const days = Array.from({ length: 31 }, (_, d) => start.getTime() + d * DAY).filter((t) => new Date(t).getUTCMonth() === start.getUTCMonth() && new Date(t).getUTCDay() === weekday);
      return at(days, n < 0 ? days.length + n : n - 1);
    };
    const monthly = (weekday: number, n: number) => [1, 2, 3].map((i) => inMonth(i, weekday, n));
    const second = monthly(3, 2);
    cases.push([{ every: 'month', week: 2, day: 3 }, second, `RRULE:FREQ=MONTHLY;BYDAY=2WE;UNTIL=${stamp(at(second, 2))}`]);
    const last = monthly(5, -1);
    cases.push([{ every: 'month', week: -1, day: 5 }, last, `RRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=${stamp(at(last, 2))}`]);

    for (const [rule, times, line] of cases) {
      const occurrencesAt = times.map((t) => new Date(t).toISOString());
      const first = await org.api.meetings.create({ title: 'Rules', startsAt: at(occurrencesAt, 0), durationMinutes: 30, guests: [], notes: 'off', repeat: { rule, until: day(times.at(-1) ?? 0), timeZone: 'UTC', occurrences: occurrencesAt } });
      const master = masters(org.sub).at(-1);
      if (!master) throw new Error('no recurring event');
      expect(master.recurrence).toEqual([line]);
      expect(occurrences(org.sub, master).map(startOf)).toEqual(occurrencesAt);
      expect((await upcomingIn(org, first.seriesId)).every((c) => c.calendarUrl)).toBe(true);
    }
  });

  it('keeps each call’s clock time when the clocks change, and an evening call on the last day isn’t lost', async () => {
    const org = await googleAccount('Clock');
    const timeZone = 'America/Los_Angeles';
    const offsetAt = (t: number) => {
      const p = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t));
      const n = (type: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === type)?.value ?? 0);
      return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - Math.floor(t / 60_000) * 60_000;
    };
    // The next time the clocks change there, at least three weeks off, so there's room for three calls before it.
    // Measured from noon UTC, so what counts as the day the clocks change doesn't depend on when the test runs.
    let change = Math.floor((Date.now() + 21 * DAY) / DAY) * DAY + 12 * HOUR;
    while (offsetAt(change) === offsetAt(change + DAY)) change += DAY;
    const clockChange = change;
    // 20:30 where the organizer is, every week: in UTC that's the next morning, at a different hour after the change.
    // Clocks change on a Sunday, so counting from 17 days before it, no call falls on that day.
    const local = (t: number, hour: number, minute: number) => {
      const midnight = Math.floor((t + offsetAt(t)) / DAY) * DAY;
      return midnight + hour * HOUR + minute * 60_000 - offsetAt(t);
    };
    const times = [0, 1, 2, 3, 4, 5].map((w) => local(clockChange + (w * 7 - 17) * DAY, 20, 30));
    expect(times.map((t, i) => (i ? t - at(times, i - 1) : 7 * DAY)).filter((gap) => gap !== 7 * DAY)).toHaveLength(1);
    const occurrencesAt = times.map((t) => new Date(t).toISOString());
    const weekday = new Date(at(times, 0) + offsetAt(at(times, 0))).getUTCDay();
    const lastLocalDay = day(at(times, 5) + offsetAt(at(times, 5)));
    const mark = h.logs.length;
    const first = await org.api.meetings.create({
      title: 'Evening check-in', startsAt: at(occurrencesAt, 0), durationMinutes: 30, guests: [unique('kofi')], notes: 'off',
      repeat: { rule: { every: 'week', weeks: 1, days: [weekday] }, until: lastLocalDay, timeZone, occurrences: occurrencesAt }
    });
    const master = only(org.sub);
    expect(master.start?.timeZone).toBe(timeZone);
    expect(occurrences(org.sub, master).map(startOf)).toEqual(occurrencesAt);
    const calls = await upcomingIn(org, first.seriesId);
    expect(calls.map((c) => c.startsAt)).toEqual(occurrencesAt);
    expect(calls.every((c) => c.calendarUrl)).toBe(true);
    // The rule alone came out right: nothing had to be put right afterwards.
    expect(h.logs.slice(mark).some((l) => l.includes('calendar occurrences didn’t match the calls'))).toBe(false);
  });

  it('refuses times that can’t be a repeat, and schedules nothing', async () => {
    const org = await account();
    const first = soon();
    const good = weekly(first, 3);
    const sends = (repeat: RepeatInput, startsAt = new Date(first).toISOString()) => refusal(org.api.meetings.create({ title: 'Refused', startsAt, durationMinutes: 30, guests: [], notes: 'off', repeat }));
    const before = await inserted(org.session.ownerId, `items WHERE owner_id = $1`);
    const [a = '', b = '', c = ''] = good.occurrences;
    // Out of order, twice the same, and one already over.
    expect(await sends({ ...good, occurrences: [a, c, b] })).toBe('invalid');
    expect(await sends({ ...good, occurrences: [a, a, b] })).toBe('invalid');
    expect(await sends({ ...good, occurrences: [new Date(Date.now() - DAY).toISOString(), a, b] }, new Date(Date.now() - DAY).toISOString())).toBe('invalid');
    // The first isn't the call, and one isn't a time at all.
    expect(await sends({ ...good, occurrences: [b, c] })).toBe('invalid');
    expect(await sends({ ...good, occurrences: [a, 'next tuesday'] })).toBe('invalid');
    // Past the end date by more than a time zone can explain; within a day it's only where the organizer is.
    expect(await sends({ ...good, until: day(first) })).toBe('invalid');
    expect(await sends({ ...good, until: day(new Date(c).getTime() - DAY) })).toBe('went through');
    // More than one repeat can schedule.
    expect(await sends(weekly(first, MAX_SERIES_CALLS + 1))).toBe('invalid');
    // What a rule can't be: an end date that isn't one, a day twice, and a zone nobody has heard of.
    expect(await sends({ ...good, until: '2031-02-31' })).toBe('invalid');
    expect(await sends({ ...good, rule: { every: 'week', weeks: 1, days: [2, 2] } })).toBe('invalid');
    expect(await sends({ ...good, timeZone: 'Mars/Olympus' })).toBe('invalid');
    expect(await sends({ ...good, rule: { every: 'week', weeks: 1, days: [] } })).toBe('invalid');
    // Only the one that was fine made anything: a series, and its three calls.
    expect(await inserted(org.session.ownerId, `items WHERE owner_id = $1`)).toBe((before ?? 0) + 4);
  });
});

describe('the series link', () => {
  it('leads anyone to the call that’s on or next, and joins it', async () => {
    const org = await account();
    const lena = await account();
    const first = await org.api.meetings.create(schedule('Weekly', [lena.email]));
    const link = first.seriesCode ?? '';
    const calls = await upcomingIn(org, first.seriesId);
    // Before: the first call, for the organizer and for anyone with the link, signed in or not.
    expect((await org.api.meetings.byCode(link))?.id).toBe(first.id);
    expect(await h.browser().api.calls.card(link)).toMatchObject({ title: 'Weekly', hostHere: false, ended: false, you: 'guest' });
    expect((await lena.api.calls.card(link)).you).toBe('invited');
    // A series settled its times long ago: nobody with the link can pick one.
    expect(await refusal(h.browser().api.calls.pick(link, first.startsAt))).toBe('conflict');

    // The organizer's link starts it, and someone invited comes in through the same link.
    const call = await hold(org, link);
    expect(call.getSnapshot()).toMatchObject({ meetingId: first.id, code: first.code });
    expect((await org.api.meetings.get(first.id)).status).toBe('live');
    const in2 = await hold(lena, link);
    expect(in2.getSnapshot().meetingId).toBe(first.id);
    expect(in2.ticket.role).toBe('invited');
    expect((await h.browser().api.calls.card(link)).hostHere).toBe(true);
    await end(call);

    // Over: the link says so for now, as the first call's own link does, and the next call has its own.
    expect((await org.api.meetings.get(first.id)).status).toBe('ended');
    const card = await h.browser().api.calls.card(link);
    expect([card.title, card.ended, card.hostHere]).toEqual(['Weekly', true, false]);
    expect((await h.browser().api.calls.card(first.code)).ended).toBe(true);
    const next = await hold(org, at(calls, 1).code);
    expect(next.getSnapshot().meetingId).toBe(at(calls, 1).id);
    await end(next);
    // Each call keeps its own code for Alcove's Join buttons.
    const third = await hold(org, at(calls, 2).code);
    expect(third.getSnapshot().meetingId).toBe(at(calls, 2).id);
    await end(third);
  });

  it('stays with a call that ended until an hour after its time is up, so opening it can’t start the next one', async () => {
    const org = await account();
    const lena = await account();
    const first = await org.api.meetings.create(schedule('Weekly', [lena.email]));
    const link = first.seriesCode ?? '';
    const [one, two] = [at(await upcomingIn(org, first.seriesId), 0), at(await upcomingIn(org, first.seriesId), 1)];
    // It's on now, with ten minutes of its time left when it ends.
    await org.api.meetings.update(one.id, { startsAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    await end(await hold(org, link));

    // Anyone with the link reads that it ended, the organizer included.
    expect((await h.browser().api.calls.card(link)).ended).toBe(true);
    expect((await lena.api.calls.card(link)).ended).toBe(true);
    expect((await org.api.meetings.byCode(link))?.id).toBe(one.id);
    // The organizer opening it reopens that call, as with any call: next week's is left for next week.
    const again = await hold(org, link);
    expect(again.getSnapshot().meetingId).toBe(one.id);
    await end(again);
    expect((await org.api.meetings.get(two.id)).status).toBe('scheduled');

    // Its own Join starts the next one early all the same, and a call that's on is where the link leads.
    const early = await hold(org, two.code);
    expect(early.getSnapshot().meetingId).toBe(two.id);
    expect((await org.api.meetings.byCode(link))?.id).toBe(two.id);
    await end(early);
  });

  it('moves on once that hour is over, and sooner for a call that starts within it', async () => {
    const org = await account();
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

    // Its time was up an hour and a half ago: it ended late, and the link has moved on.
    const late = await org.api.meetings.create(schedule('Ran late', []));
    const [oneLate, twoLate] = [at(await upcomingIn(org, late.seriesId), 0), at(await upcomingIn(org, late.seriesId), 1)];
    await org.api.meetings.update(oneLate.id, { startsAt: ago(120) });
    await end(await hold(org, oneLate.code));
    expect((await org.api.meetings.byCode(late.seriesCode ?? ''))?.id).toBe(twoLate.id);
    expect((await h.browser().api.calls.card(late.seriesCode ?? '')).ended).toBe(false);

    // The next call starts within the hour: that's the one people are coming to.
    const close = await org.api.meetings.create(schedule('Back to back', []));
    const [oneClose, twoClose] = [at(await upcomingIn(org, close.seriesId), 0), at(await upcomingIn(org, close.seriesId), 1)];
    await org.api.meetings.update(oneClose.id, { startsAt: ago(20) });
    await org.api.meetings.update(twoClose.id, { startsAt: ago(-30) });
    await end(await hold(org, oneClose.code));
    expect((await org.api.meetings.byCode(close.seriesCode ?? ''))?.id).toBe(twoClose.id);
    expect((await h.browser().api.calls.card(close.seriesCode ?? '')).ended).toBe(false);
  });

  it('skips a call nobody held, and leads to the latest once they’re all over', async () => {
    const org = await account();
    const first = await org.api.meetings.create(schedule('Skipped', []));
    const calls = await upcomingIn(org, first.seriesId);
    const [one, two, three, four] = [at(calls, 0), at(calls, 1), at(calls, 2), at(calls, 3)];
    // The first two came and went with nobody there.
    await org.api.meetings.update(one.id, { startsAt: new Date(Date.now() - 4 * DAY).toISOString() });
    await org.api.meetings.update(two.id, { startsAt: new Date(Date.now() - 3 * DAY).toISOString() });
    expect((await org.api.meetings.byCode(first.seriesCode ?? ''))?.id).toBe(three.id);
    const stood = await hold(org, first.seriesCode ?? '');
    expect(stood.getSnapshot().meetingId).toBe(three.id);
    await end(stood);
    // Held and over, all that were left: the link says the latest ended.
    await end(await hold(org, four.code));
    expect((await org.api.meetings.byCode(first.seriesCode ?? ''))?.id).toBe(four.id);
    expect((await h.browser().api.calls.card(first.seriesCode ?? '')).ended).toBe(true);
  });

  it('goes by each call’s own guest list: invited to the series means invited to that call', async () => {
    const org = await account();
    const lena = await account();
    const kofi = unique('kofi');
    const first = await org.api.meetings.create(schedule('Rota', [lena.email, kofi], 3));
    const link = first.seriesCode ?? '';
    const calls = await upcomingIn(org, first.seriesId);

    // Lena is taken off the first call alone, on now and long past its time: to that one Lena is someone with a link,
    // and to the next, invited.
    await org.api.meetings.update(first.id, { guests: [kofi], startsAt: new Date(Date.now() - 3 * HOUR).toISOString() });
    const call = await hold(org, first.code);
    expect((await lena.api.calls.card(link)).you).toBe('asks');
    expect(await refusal(lena.api.meetings.get(first.id))).toBe('not-found');
    expect((await lena.api.meetings.get(at(calls, 1).id)).isOrganizer).toBe(false);
    const asked = await hold(lena, link);
    expect(asked.ticket.role).toBe('guest');
    await end(call);
    expect((await lena.api.calls.card(link)).you).toBe('invited');
  });

  it('lets nobody into one call on the pass of another: someone let in last week asks again this week', async () => {
    const org = await account();
    const first = await org.api.meetings.create(schedule('Drop-in', [], 2));
    const link = first.seriesCode ?? '';
    // Held long past its time, so the link moves on as soon as it ends.
    await org.api.meetings.update(first.id, { startsAt: new Date(Date.now() - 3 * HOUR).toISOString() });
    const week1 = await hold(org, first.code);
    await inGroup(week1);
    const browser = h.browser();
    const sam = await browser.api.calls.join(link, { mic: false, cam: false, name: 'Sam' });
    await settled(week1, (s) => s.waiting.some((w) => w.id === sam.ticket.identity));
    await week1.admit(sam.ticket.identity);
    await inGroup(sam);
    await sam.leave();
    await end(week1);

    // The browser keeps the pass under the link it came by, which is the same one next week, for a different call.
    const week2 = await hold(org, link);
    await inGroup(week2);
    expect(week2.getSnapshot().meetingId).not.toBe(week1.getSnapshot().meetingId);
    const again = await browser.api.calls.join(link, { mic: false, cam: false, name: 'Sam', previous: sam.ticket.pass });
    expect(again.crypto.getSnapshot().status).toBe('waiting');
    await end(week2);
  });

  it('shows people invited how it repeats, and its link only when an invitation carried it', async () => {
    const org = await account();
    const lena = await account();
    const first = await org.api.meetings.create(schedule('No calendar', [lena.email], 2));
    const seen = await lena.api.meetings.get(first.id);
    expect(seen).toMatchObject({ isOrganizer: false, repeat: first.repeat, seriesId: first.seriesId });
    expect(seen.seriesCode).toBeUndefined();
    expect((await upcomingIn(lena, first.seriesId)).map((m) => m.repeat?.until)).toEqual([first.repeat?.until, first.repeat?.until]);

    const googler = await googleAccount('Gabi');
    const address = unique('ren').replace('@tests.example', '@example.com');
    const made = await googler.api.meetings.create(schedule('On a calendar', [address], 2));
    const ren = await googleAccount('Ren', address);
    const theirs = await ren.api.meetings.get(made.id);
    expect(theirs).toMatchObject({ isOrganizer: false, repeat: made.repeat, seriesCode: made.seriesCode });
    expect(theirs.calendarUrl).toBeUndefined();
    // Only the organizer reads the series' plan.
    const heldBy = await org.api.series.get(first.seriesId ?? '');
    expect(heldBy.repeat).toEqual(first.repeat);
    expect(await refusal(lena.api.series.get(first.seriesId ?? ''))).toBe('not-found');
  });
});

describe('cancelling calls in a series', () => {
  it('keeps the link working when the first call goes, for the calls left', async () => {
    const org = await googleAccount('Ada');
    const lena = await account();
    const first = await org.api.meetings.create(schedule('Keeps going', [lena.email], 3));
    const link = first.seriesCode ?? '';
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    expect((await h.browser().api.calls.card(link)).title).toBe('Keeps going');
    const mark = h.google.calls.length;

    await org.api.meetings.cancel(first.id);

    // Only that occurrence went, and everyone heard about that one call.
    const gone = await refusal(org.api.meetings.get(first.id));
    expect(gone).toBe('not-found');
    expect(writesSince(mark)).toEqual([expect.objectContaining({ method: 'DELETE', sendUpdates: 'all' })]);
    expect(occurrences(org.sub, master).map(startOf)).toEqual(starts(calls).slice(1));
    expect(await refusal(h.browser().api.calls.card(first.code))).toBe('not-found');

    // The link leads to the second, which joins, and the series and its one event carry on.
    expect((await org.api.meetings.byCode(link))?.id).toBe(at(calls, 1).id);
    const call = await hold(org, link);
    expect(call.getSnapshot().meetingId).toBe(at(calls, 1).id);
    await end(call);
    expect(await seriesItems(org.session.ownerId)).toBe(1);
    expect(masters(org.sub)).toHaveLength(1);
  });

  it('with this and later calls, ends the event early and keeps what came before', async () => {
    const org = await googleAccount('Bea');
    const first = await org.api.meetings.create(schedule('Winding down', [unique('kofi')], 5));
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    const mark = h.google.calls.length;
    await org.api.meetings.cancel(at(calls, 2).id, { scope: 'following' });

    expect((await upcomingIn(org, first.seriesId)).map((c) => c.id)).toEqual([first.id, at(calls, 1).id]);
    expect(occurrences(org.sub, master).map(startOf)).toEqual(starts(calls).slice(0, 2));
    expect(writesSince(mark)).toEqual([expect.objectContaining({ method: 'PATCH', sendUpdates: 'all' })]);
    // How it repeats now says where it stops.
    expect((await org.api.series.get(first.seriesId ?? '')).repeat?.until).toBe(day(new Date(at(calls, 1).startsAt).getTime()));
    expect((await h.browser().api.calls.card(first.seriesCode ?? '')).title).toBe('Winding down');
  });

  it('from the first call that’s left, removes the whole series with its link', async () => {
    const org = await googleAccount('Cass');
    const kofi = unique('kofi');
    const first = await org.api.meetings.create(schedule('All gone', [kofi], 4));
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    await org.api.meetings.cancel(first.id);
    const mark = h.google.calls.length;
    await org.api.meetings.cancel(at(calls, 1).id, { scope: 'following' });

    // Nothing of it is left: its calls, its item, their revisions, its link, who was invited, the event.
    expect(await upcomingIn(org, first.seriesId)).toEqual([]);
    expect(await seriesItems(org.session.ownerId)).toBe(0);
    expect(await inserted(org.session.ownerId, `items WHERE owner_id = $1 AND kind = 'meeting'`)).toBe(0);
    expect(await inserted(org.session.ownerId, `call_codes WHERE owner_id = $1`)).toBe(0);
    expect(await inserted(org.session.ownerId, `meeting_access WHERE owner_id = $1`)).toBe(0);
    expect(await inserted(org.session.ownerId, `revisions WHERE owner_id = $1 AND item_id = '${first.seriesId ?? ''}'`)).toBe(0);
    // Receipts hold copies of what scheduling and changing it answered: only this cancellation's own is left.
    expect(await inserted(org.session.ownerId, `operations WHERE owner_id = $1`)).toBeLessThanOrEqual(1);
    expect(await refusal(h.browser().api.calls.card(first.seriesCode ?? ''))).toBe('not-found');
    expect(await refusal(org.api.series.get(first.seriesId ?? ''))).toBe('not-found');
    expect(h.google.calendar(org.sub)).toEqual([]);
    expect(writesSince(mark)).toEqual([{ method: 'DELETE', path: `/calendar/v3/calendars/primary/events/${master.id}`, sendUpdates: 'all' }]);
  });

  it('takes a call moved later on its own off the calendar with the calls after it, though the rule put it earlier', async () => {
    const org = await googleAccount('Elle');
    const first = await org.api.meetings.create(schedule('Moved', [unique('lena')], 4));
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    const third = at(calls, 2);
    await org.api.meetings.update(third.id, { startsAt: new Date(new Date(third.startsAt).getTime() + DAY).toISOString() });
    // The event ends before the time the call has now, which is after the place the rule gave it: that place has to go too.
    await org.api.meetings.cancel(third.id, { scope: 'following' });
    expect(occurrences(org.sub, master).map(startOf)).toEqual(starts(calls).slice(0, 2));
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.id)).toEqual([first.id, at(calls, 1).id]);
  });

  it('goes by when calls are now: one moved past the next is after it, for this and later calls too', async () => {
    const org = await googleAccount('Faye');
    const first = await org.api.meetings.create(schedule('Swapped', [], 4));
    const calls = await upcomingIn(org, first.seriesId);
    const [one, two, three] = [at(calls, 0), at(calls, 1), at(calls, 2)];
    // The first call moves to just after the second, so from the second on is every call there is.
    const moved = new Date(new Date(two.startsAt).getTime() + HOUR).toISOString();
    await org.api.meetings.update(one.id, { startsAt: moved });
    await org.api.meetings.update(two.id, { title: 'From here' }, { scope: 'following' });
    expect((await upcomingIn(org, first.seriesId)).map((c) => [c.id, c.title])).toEqual([[two.id, 'From here'], [one.id, 'From here'], [three.id, 'From here'], [at(calls, 3).id, 'From here']]);
    expect(masters(org.sub)).toHaveLength(1);
    expect(occurrences(org.sub, only(org.sub)).map(startOf).sort()).toEqual([two.startsAt, moved, three.startsAt, at(calls, 3).startsAt]);
  });

  it('takes the series when its last call goes on its own, too', async () => {
    const org = await googleAccount('Dee');
    const first = await org.api.meetings.create(schedule('One by one', [], 3));
    const calls = await upcomingIn(org, first.seriesId);
    await org.api.meetings.cancel(at(calls, 2).id, { scope: 'this' });
    await org.api.meetings.cancel(at(calls, 0).id);
    expect(await seriesItems(org.session.ownerId)).toBe(1);
    const mark = h.google.calls.length;
    await org.api.meetings.cancel(at(calls, 1).id);
    expect(await seriesItems(org.session.ownerId)).toBe(0);
    expect(await refusal(h.browser().api.calls.card(first.seriesCode ?? ''))).toBe('not-found');
    expect(h.google.calendar(org.sub)).toEqual([]);
    expect(writesSince(mark)).toHaveLength(1);
  });

  it('never takes a call that’s on or over, and the series stays for it', async () => {
    const org = await account();
    const first = await org.api.meetings.create(schedule('Held', [], 4));
    const calls = await upcomingIn(org, first.seriesId);
    const call = await hold(org, first.code);
    // Happening now: neither this one alone, nor this and later.
    expect(await refusal(org.api.meetings.cancel(first.id))).toBe('conflict');
    const live = await org.api.meetings.cancel(first.id, { scope: 'following' }).catch((e: unknown) => e);
    expect(code(live)).toBe('conflict');
    await end(call);
    const over = await org.api.meetings.cancel(first.id, { scope: 'following' }).catch((e: unknown) => e);
    expect(code(over)).toBe('conflict');
    expect(over).toMatchObject({ message: expect.stringContaining('has started') });

    // From the next one on, everything still to come goes: what was held stays, and the link says it's over.
    await org.api.meetings.cancel(at(calls, 1).id, { scope: 'following' });
    expect((await org.api.meetings.get(first.id)).status).toBe('ended');
    expect(await seriesItems(org.session.ownerId)).toBe(1);
    expect((await h.browser().api.calls.card(first.seriesCode ?? '')).ended).toBe(true);
    // And an ended call can still be cancelled alone: the last one out takes the series.
    await org.api.meetings.cancel(first.id);
    expect(await seriesItems(org.session.ownerId)).toBe(0);
  });

  it('removes only the call a lobby is, and nothing of a series', async () => {
    const org = await account();
    const first = await org.api.meetings.create(schedule('Beside a lobby', [], 2));
    const { code: lobby } = await org.api.calls.startNow({ title: 'A lobby' });
    const id = (await org.api.meetings.byCode(lobby))?.id ?? '';
    await org.api.meetings.cancel(id);
    expect((await h.browser().api.calls.card(first.seriesCode ?? '')).title).toBe('Beside a lobby');
    expect(await seriesItems(org.session.ownerId)).toBe(1);
    expect(await refusal(org.api.meetings.cancel(first.id, { scope: 'following' }).then(() => org.api.meetings.get(first.id)))).toBe('not-found');
  });
});

describe('changing calls in a series', () => {
  it('changes one call alone: its occurrence, and nothing else', async () => {
    const org = await googleAccount('Eve');
    const lena = await googleAccount('Lena');
    const kofi = unique('kofi');
    const first = await org.api.meetings.create(schedule('Usual', [lena.email], 4));
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    const second = at(calls, 1);
    const moved = new Date(new Date(second.startsAt).getTime() + 2 * HOUR).toISOString();
    const mark = h.google.calls.length;

    const changed = await org.api.meetings.update(second.id, { title: 'Unusual', startsAt: moved, guests: [kofi] }, { scope: 'this' });
    expect(changed).toMatchObject({ id: second.id, title: 'Unusual', startsAt: moved, seriesCode: first.seriesCode, repeat: first.repeat });

    // One write, to one occurrence, that everyone hears about. The link on it is still the series'.
    const written = writesSince(mark);
    expect(written).toEqual([expect.objectContaining({ method: 'PATCH', sendUpdates: 'all' })]);
    expect(written[0]?.path).not.toBe(`/calendar/v3/calendars/primary/events/${master.id}`);
    const found = occurrences(org.sub, master);
    expect(found.map((i) => i.summary)).toEqual(['Usual', 'Unusual', 'Usual', 'Usual']);
    expect(at(found, 1)).toMatchObject({ location: linkTo(first.seriesCode), attendees: [{ email: kofi }], start: { timeZone: 'UTC' } });
    expect(startOf(at(found, 1))).toBe(moved);
    expect(master.summary).toBe('Usual');

    // The other calls, and who's invited to them, are as they were.
    const after = await upcomingIn(org, first.seriesId);
    expect(after.map((c) => c.title)).toEqual(['Usual', 'Unusual', 'Usual', 'Usual']);
    expect(joined(at(after, 0))).toEqual([lena.email]);
    expect(await refusal(lena.api.meetings.get(second.id))).toBe('not-found');
    expect((await lena.api.meetings.get(first.id)).title).toBe('Usual');
    // With no scope a change reaches this call alone, and how it repeats can't be changed for one call.
    await org.api.meetings.update(at(calls, 2).id, { title: 'No scope' });
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.title)).toEqual(['Usual', 'Unusual', 'No scope', 'Usual']);
    expect(await refusal(org.api.meetings.update(at(calls, 2).id, { repeat: weekly(new Date(at(calls, 2).startsAt).getTime(), 2) }))).toBe('invalid');
  });

  it('this and later calls: the event ends before this one, and a new one carries the same link', async () => {
    const org = await googleAccount('Fay');
    const [lena, kofi] = [unique('lena'), unique('kofi')];
    const first = await org.api.meetings.create(schedule('Old name', [lena], 5));
    const calls = await upcomingIn(org, first.seriesId);
    const old = only(org.sub);
    const third = at(calls, 2);

    const changed = await org.api.meetings.update(third.id, { title: 'New name', guests: [lena, kofi], notes: 'on', durationMinutes: 45 }, { scope: 'following' });
    expect(changed).toMatchObject({ id: third.id, title: 'New name', notes: 'on' });

    const after = await upcomingIn(org, first.seriesId);
    expect(after.map((c) => c.id)).toEqual(calls.map((c) => c.id));
    expect(after.map((c) => c.title)).toEqual(['Old name', 'Old name', 'New name', 'New name', 'New name']);
    expect(after.map((c) => c.guestCount)).toEqual([1, 1, 2, 2, 2]);
    expect(after.map((c) => (new Date(c.endsAt).getTime() - new Date(c.startsAt).getTime()) / 60_000)).toEqual([30, 30, 45, 45, 45]);
    expect(new Set(after.map((c) => c.seriesCode))).toEqual(new Set([first.seriesCode]));

    // On the calendar: the old event stops before this call, and everyone gets one update and one invitation in all.
    const events = masters(org.sub);
    expect(events).toHaveLength(2);
    const fresh = at(events, 1);
    expect(occurrences(org.sub, old).map(startOf)).toEqual(starts(calls).slice(0, 2));
    expect(occurrences(org.sub, fresh).map(startOf)).toEqual(starts(calls).slice(2));
    expect(fresh).toMatchObject({ summary: 'New name', location: linkTo(first.seriesCode), start: { timeZone: 'UTC' } });
    expect(after.map((c) => c.calendarUrl)).toEqual([...occurrences(org.sub, old), ...occurrences(org.sub, fresh)].map((i) => i.htmlLink));
    expect(mailAbout(old.id, fresh.id).map((m) => [m.kind, m.eventId])).toEqual([['invitation', old.id], ['invitation', fresh.id], ['update', old.id]]);

    // The series follows the latest change, and now names the new event; the link leads where it did.
    expect(await sealed(org.session.ownerId, first.seriesId)).toMatchObject({ title: 'New name', calendarEvent: { id: fresh.id } });
    expect((await org.api.meetings.byCode(first.seriesCode ?? ''))?.id).toBe(first.id);

    // A later change from the first call on the new event changes that event, not the old one.
    const mark = h.google.calls.length;
    await org.api.meetings.update(third.id, { title: 'Newer name' }, { scope: 'following' });
    expect(writesSince(mark)).toEqual([{ method: 'PATCH', path: `/calendar/v3/calendars/primary/events/${fresh.id}`, sendUpdates: 'all' }]);
    expect(masters(org.sub).map((e) => e.summary)).toEqual(['Old name', 'Newer name']);
    // One call's own title isn't the series'.
    await org.api.meetings.update(third.id, { title: 'This one only' });
    expect((await sealed(org.session.ownerId, first.seriesId)).title).toBe('Newer name');
    // Google is left alone when nothing it shows changed.
    const quiet = h.google.calls.length;
    await org.api.meetings.update(third.id, { joinMuted: true }, { scope: 'following' });
    expect(writesSince(quiet)).toEqual([]);
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.joinMuted)).toEqual([false, false, true, true, true]);
  });

  it('from the first call, changes the event itself: one update and no new event', async () => {
    const org = await googleAccount('Gus');
    const first = await org.api.meetings.create(schedule('Whole series', [unique('lena')], 3));
    const master = only(org.sub);
    const mark = h.google.calls.length;
    await org.api.meetings.update(first.id, { title: 'All of it' }, { scope: 'following' });
    expect(writesSince(mark)).toEqual([{ method: 'PATCH', path: `/calendar/v3/calendars/primary/events/${master.id}`, sendUpdates: 'all' }]);
    expect(masters(org.sub)).toHaveLength(1);
    expect(occurrences(org.sub, master).map((i) => i.summary)).toEqual(['All of it', 'All of it', 'All of it']);
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.title)).toEqual(['All of it', 'All of it', 'All of it']);

    // The same once the first call has been cancelled: nothing's left for the old event to keep.
    await org.api.meetings.cancel(first.id);
    const second = at(await upcomingIn(org, first.seriesId), 0);
    await org.api.meetings.update(second.id, { title: 'What’s left' }, { scope: 'following' });
    expect(masters(org.sub)).toHaveLength(1);
    expect(occurrences(org.sub, master).map((i) => i.summary)).toEqual(['What’s left', 'What’s left']);
  });

  it('moving them pairs the times with the calls in order, makes what’s new and deletes what’s left over', async () => {
    const org = await googleAccount('Hal');
    const lena = await googleAccount('Lena');
    const first = await org.api.meetings.create(schedule('Moves', [lena.email], 4));
    const calls = await upcomingIn(org, first.seriesId);
    await lena.api.meetings.answer(at(calls, 2).id, 'yes');
    const second = at(calls, 1);
    const from = new Date(second.startsAt).getTime() + DAY;

    // Moving needs to say how.
    expect(await refusal(org.api.meetings.update(second.id, { startsAt: new Date(from).toISOString() }, { scope: 'following' }))).toBe('invalid');
    // And the times start at the call.
    expect(await refusal(org.api.meetings.update(second.id, { startsAt: new Date(from).toISOString(), repeat: weekly(from + DAY, 3) }, { scope: 'following' }))).toBe('invalid');

    // Five calls from here instead of three: the same three calls move, keeping their answers, and two are new.
    const longer = weekly(from, 5);
    await org.api.meetings.update(second.id, { startsAt: new Date(from).toISOString(), repeat: longer }, { scope: 'following' });
    let after = await upcomingIn(org, first.seriesId);
    expect(starts(after)).toEqual([first.startsAt, ...longer.occurrences]);
    expect(after.slice(0, 4).map((c) => c.id)).toEqual(calls.map((c) => c.id));
    expect(after.every((c) => c.seriesCode === first.seriesCode)).toBe(true);
    expect((await lena.api.meetings.get(at(calls, 2).id)).rsvp).toBe('yes');
    expect((await lena.api.meetings.get(at(after, 5).id)).isOrganizer).toBe(false);
    expect((await org.api.series.get(first.seriesId ?? '')).repeat).toMatchObject({ until: longer.until, rule: longer.rule });
    expect(after.every((c) => c.calendarUrl)).toBe(true);
    const events = masters(org.sub);
    expect(events).toHaveLength(2);
    expect(occurrences(org.sub, at(events, 0)).map(startOf)).toEqual([first.startsAt]);
    expect(occurrences(org.sub, at(events, 1)).map(startOf)).toEqual(longer.occurrences);

    // Two from here: the rest go for good, with who was invited to them, and the calendar moves with them.
    const shorter = weekly(from, 2);
    const dropped = after.slice(3).map((c) => c.id);
    await org.api.meetings.update(second.id, { repeat: shorter }, { scope: 'following' });
    after = await upcomingIn(org, first.seriesId);
    expect(starts(after)).toEqual([first.startsAt, ...shorter.occurrences]);
    for (const id of dropped) expect(await refusal(org.api.meetings.get(id))).toBe('not-found');
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM meeting_access WHERE meeting_item_id = ANY($1::text[])', [dropped])).rows[0]?.n).toBe(0);
    expect(occurrences(org.sub, at(masters(org.sub), 1)).map(startOf)).toEqual(shorter.occurrences);
    expect(after.every((c) => c.calendarUrl)).toBe(true);
  });

  it('reaches across every event a series has come to have, and the event that’s left carries on', async () => {
    const org = await googleAccount('Hugo');
    const first = await org.api.meetings.create(schedule('Two halves', [unique('lena')], 6));
    const calls = await upcomingIn(org, first.seriesId);
    const [one, two, , four] = [at(calls, 0), at(calls, 1), at(calls, 2), at(calls, 3)];
    const old = only(org.sub);
    await org.api.meetings.update(four.id, { title: 'Second half' }, { scope: 'following' });
    const second = at(masters(org.sub), 1);
    expect(occurrences(org.sub, second)).toHaveLength(3);

    // From before the split: the first event ends earlier still, the second has nothing left and goes, and a third takes over.
    await org.api.meetings.update(two.id, { title: 'Nearly all' }, { scope: 'following' });
    const events = masters(org.sub);
    expect(events.map((e) => e.id)).not.toContain(second.id);
    expect(events).toHaveLength(2);
    const third = at(events, 1);
    expect(occurrences(org.sub, old).map(startOf)).toEqual([one.startsAt]);
    expect(occurrences(org.sub, third).map(startOf)).toEqual(starts(calls).slice(1));
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.title)).toEqual(['Two halves', 'Nearly all', 'Nearly all', 'Nearly all', 'Nearly all', 'Nearly all']);

    // Cancelling them all from there takes that event, and the first one is what carries the series on.
    await org.api.meetings.cancel(two.id, { scope: 'following' });
    expect(masters(org.sub).map((e) => e.id)).toEqual([old.id]);
    await org.api.meetings.update(one.id, { title: 'Only one left' }, { scope: 'following' });
    expect(masters(org.sub).map((e) => [e.id, e.summary])).toEqual([[old.id, 'Only one left']]);
  });

  it('from the first call after a split, a new title takes in the later event’s calls: none leaves the calendar', async () => {
    const org = await googleAccount('Odin');
    const lena = unique('lena');
    const first = await org.api.meetings.create(schedule('Halves', [lena], 5));
    const calls = await upcomingIn(org, first.seriesId);
    const old = only(org.sub);
    await org.api.meetings.update(at(calls, 2).id, { title: 'Second half' }, { scope: 'following' });
    const later = at(masters(org.sub), 1);
    expect(occurrences(org.sub, old)).toHaveLength(2);
    expect(occurrences(org.sub, later)).toHaveLength(3);

    await org.api.meetings.update(first.id, { title: 'Together again' }, { scope: 'following' });
    const after = await upcomingIn(org, first.seriesId);
    expect(after.map((c) => c.title)).toEqual(calls.map(() => 'Together again'));
    // Five calls in Alcove, five on the calendar: the first event reaches them all, and the second has nothing left to carry.
    expect(masters(org.sub).map((e) => e.id)).toEqual([old.id]);
    expect(occurrences(org.sub, old).map(startOf)).toEqual(starts(calls));
    expect(occurrences(org.sub, old).map((e) => e.summary)).toEqual(calls.map(() => 'Together again'));
    expect(after.map((c) => c.calendarUrl)).toEqual(occurrences(org.sub, old).map((e) => e.htmlLink));
    expect(await sealed(org.session.ownerId, first.seriesId)).toMatchObject({ calendarEvent: { id: old.id } });
  });

  it('from the first call after a split, new guests do the same', async () => {
    const org = await googleAccount('Greta');
    const [lena, kofi] = [unique('lena'), unique('kofi')];
    const first = await org.api.meetings.create(schedule('Halves', [lena], 4));
    const calls = await upcomingIn(org, first.seriesId);
    const old = only(org.sub);
    await org.api.meetings.update(at(calls, 2).id, { title: 'Second half' }, { scope: 'following' });

    await org.api.meetings.update(first.id, { guests: [lena, kofi] }, { scope: 'following' });
    expect((await upcomingIn(org, first.seriesId)).map(joined)).toEqual(calls.map(() => [lena, kofi].sort()));
    expect(masters(org.sub).map((e) => e.id)).toEqual([old.id]);
    expect(occurrences(org.sub, old).map(startOf)).toEqual(starts(calls));
    expect(occurrences(org.sub, old).map((e) => (e.attendees ?? []).map((a) => a.email).sort())).toEqual(calls.map(() => [lena, kofi].sort()));
  });

  it('moving the whole series from its first call moves the one event, and every call finds its new occurrence', async () => {
    const org = await googleAccount('Hana');
    const first = await org.api.meetings.create(schedule('All moved', [unique('lena')], 3));
    const master = only(org.sub);
    const was = occurrences(org.sub, master).map((i) => i.id);
    const from = new Date(first.startsAt).getTime() + 5 * HOUR;
    const repeat = weekly(from, 4);
    const mark = h.google.calls.length;
    await org.api.meetings.update(first.id, { startsAt: new Date(from).toISOString(), repeat }, { scope: 'following' });
    expect(writesSince(mark)).toEqual([{ method: 'PATCH', path: `/calendar/v3/calendars/primary/events/${master.id}`, sendUpdates: 'all' }]);
    expect(masters(org.sub)).toHaveLength(1);
    expect(occurrences(org.sub, master).map(startOf)).toEqual(repeat.occurrences);
    expect(occurrences(org.sub, master).map((i) => i.id)).not.toEqual(expect.arrayContaining(was));
    // Each call's calendar link and event are the new one: changing a single call reaches it.
    const calls = await upcomingIn(org, first.seriesId);
    expect(calls.map((c) => c.calendarUrl)).toEqual(occurrences(org.sub, master).map((i) => i.htmlLink));
    await org.api.meetings.update(at(calls, 1).id, { title: 'Just this one' });
    expect(occurrences(org.sub, master).map((i) => i.summary)).toEqual(['All moved', 'Just this one', 'All moved', 'All moved']);
  });

  it('keeps someone added to one call on that one: changing the rest doesn’t invite them to the series', async () => {
    const org = await googleAccount('Ilse');
    const [lena, visitor] = [unique('lena'), unique('visitor')];
    const first = await org.api.meetings.create(schedule('Regulars', [lena], 5));
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    const invitedTo = (e: FakeEvent) => (e.attendees ?? []).flatMap((a) => (a.email ? [a.email] : [])).sort();

    // On the first call, and then the event itself changes: it stays on that occurrence alone.
    await org.api.meetings.update(first.id, { guests: [lena, visitor], title: 'With a visitor' });
    await org.api.meetings.update(first.id, { notes: 'on' }, { scope: 'following' });
    expect(occurrences(org.sub, master).map(invitedTo)).toEqual([[lena, visitor].sort(), [lena], [lena], [lena], [lena]]);
    expect(master.attendees).toEqual([{ email: lena }]);
    expect(occurrences(org.sub, master).map((i) => i.summary)).toEqual(['With a visitor', 'Regulars', 'Regulars', 'Regulars', 'Regulars']);

    // On a later call, and a new event takes over from it: the invitation goes to the regulars, and the visitor's call keeps them.
    const third = at(calls, 2);
    await org.api.meetings.update(third.id, { guests: [lena, visitor] });
    const mark = h.google.mail.length;
    await org.api.meetings.update(third.id, { notes: 'off' }, { scope: 'following' });
    const fresh = at(masters(org.sub), 1);
    expect(h.google.mail.slice(mark).find((m) => m.kind === 'invitation')).toEqual({ kind: 'invitation', eventId: fresh.id, to: [lena] });
    expect(occurrences(org.sub, fresh).map(invitedTo)).toEqual([[lena, visitor].sort(), [lena], [lena]]);
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.guestCount)).toEqual([2, 1, 2, 1, 1]);
  });

  it('keeps a call’s own length when a new event takes over: an event starts with the length of its first call', async () => {
    const org = await googleAccount('Ida');
    const first = await org.api.meetings.create(schedule('Lengths', [], 4));
    const calls = await upcomingIn(org, first.seriesId);
    await org.api.meetings.update(at(calls, 2).id, { durationMinutes: 45 });

    await org.api.meetings.update(at(calls, 1).id, { title: 'Renamed' }, { scope: 'following' });
    const after = await upcomingIn(org, first.seriesId);
    expect(after.map((c) => (new Date(c.endsAt).getTime() - new Date(c.startsAt).getTime()) / 60_000)).toEqual([30, 30, 45, 30]);
    const fresh = at(masters(org.sub), 1);
    expect(occurrences(org.sub, fresh).map((e) => new Date(e.end?.dateTime ?? '').toISOString())).toEqual(after.slice(1).map((c) => c.endsAt));
  });

  it('carries over what single calls changed: a call cancelled or moved on its own stays that way', async () => {
    const org = await googleAccount('Ira');
    const first = await org.api.meetings.create(schedule('Exceptions', [unique('lena')], 6));
    const calls = await upcomingIn(org, first.seriesId);
    // Week 4 is off, and week 5 is a day later than the rule says.
    await org.api.meetings.cancel(at(calls, 3).id);
    const moved = new Date(new Date(at(calls, 4).startsAt).getTime() + DAY).toISOString();
    await org.api.meetings.update(at(calls, 4).id, { startsAt: moved });

    const mark = h.google.mail.length;
    await org.api.meetings.update(at(calls, 1).id, { title: 'Exceptions, renamed' }, { scope: 'following' });

    // The new event has to come from the rule, which knows nothing of either. They're put right, without a word.
    const fresh = at(masters(org.sub), 1);
    const left = await upcomingIn(org, first.seriesId);
    const expected = [at(calls, 1).startsAt, at(calls, 2).startsAt, moved, at(calls, 5).startsAt];
    expect(occurrences(org.sub, fresh).map(startOf)).toEqual(expected);
    expect(starts(left).slice(1)).toEqual(expected);
    expect(left.every((c) => c.calendarUrl)).toBe(true);
    expect(h.google.mail.slice(mark).map((m) => m.kind).sort()).toEqual(['invitation', 'update']);
    // Every call still knows its own occurrence: changing or cancelling one reaches it.
    await org.api.meetings.cancel(at(left, 4).id);
    expect(occurrences(org.sub, fresh).map(startOf)).toEqual(expected.slice(0, 3));
    await org.api.meetings.update(at(left, 3).id, { title: 'Just this one' });
    expect(occurrences(org.sub, fresh).map((i) => i.summary)).toEqual(['Exceptions, renamed', 'Exceptions, renamed', 'Just this one']);
  });

  it('never rewrites a call that’s on or over, and refuses a change from one', async () => {
    const org = await googleAccount('Jo');
    const first = await org.api.meetings.create(schedule('Started', [], 4));
    const calls = await upcomingIn(org, first.seriesId);
    const [one, two, three] = [at(calls, 0), at(calls, 1), at(calls, 2)];
    await end(await hold(org, one.code));
    const live = await hold(org, three.code);

    // From a call that's on or over: refused, saying why, and nothing changed.
    for (const m of [one, three]) {
      const refused = await org.api.meetings.update(m.id, { title: 'Not this' }, { scope: 'following' }).catch((e: unknown) => e);
      expect(code(refused)).toBe('conflict');
      expect(refused).toMatchObject({ message: expect.stringContaining('has started') });
    }
    // From the call before one that's on: it and the calls after change around it.
    await org.api.meetings.update(two.id, { title: 'Around it', notes: 'on' }, { scope: 'following' });
    const titles = await Promise.all(calls.map((c) => org.api.meetings.get(c.id).then((m) => [m.title, m.notes, m.status])));
    expect(titles).toEqual([['Started', 'off', 'ended'], ['Around it', 'on', 'scheduled'], ['Started', 'off', 'live'], ['Around it', 'on', 'scheduled']]);
    await end(live);
    // On its own a call that's over can't be changed, as ever.
    expect(await refusal(org.api.meetings.update(one.id, { title: 'Not this' }))).toBe('conflict');
  });

  it('makes a call a series, keeping the event it already has', async () => {
    const org = await googleAccount('Kim');
    const lena = unique('lena');
    const startsAt = soon();
    const one = await org.api.meetings.create({ title: 'Just once', startsAt: new Date(startsAt).toISOString(), durationMinutes: 30, guests: [lena], notes: 'off' });
    expect(one.repeat).toBeUndefined();
    const event = at(h.google.calendar(org.sub), 0);
    const repeat = weekly(startsAt, 3);
    const mark = h.google.calls.length;
    const made = await org.api.meetings.update(one.id, { title: 'Every week now', repeat });

    expect(made).toMatchObject({ id: one.id, code: one.code, title: 'Every week now', seriesCode: expect.any(String) });
    expect(made.repeat).toMatchObject({ until: repeat.until });
    const calls = await upcomingIn(org, made.seriesId);
    expect(starts(calls)).toEqual(repeat.occurrences);
    expect(calls.map((c) => c.title)).toEqual(['Every week now', 'Every week now', 'Every week now']);
    expect(calls.every((c) => joined(c).join() === lena && c.calendarUrl)).toBe(true);
    // The one event starts repeating, and carries the series' link: an update, not a cancellation and an invitation.
    expect(h.google.calendar(org.sub).map((e) => e.id)).toEqual([event.id]);
    expect(event).toMatchObject({ location: linkTo(made.seriesCode), start: { timeZone: 'UTC' } });
    expect(occurrences(org.sub, event).map(startOf)).toEqual(repeat.occurrences);
    expect(writesSince(mark)).toEqual([{ method: 'PATCH', path: `/calendar/v3/calendars/primary/events/${event.id}`, sendUpdates: 'all' }]);
    // The call's own link and the series' lead to the same place.
    expect((await h.browser().api.calls.card(one.code)).title).toBe('Every week now');
    expect((await h.browser().api.calls.card(made.seriesCode ?? '')).title).toBe('Every week now');
    expect(await seriesItems(org.session.ownerId)).toBe(1);
    // Once it repeats, it changes as a series does.
    expect(await refusal(org.api.meetings.update(one.id, { repeat }))).toBe('invalid');

    // Off the calendar, it's made from nothing.
    const plain = await account();
    const alone = await plain.api.meetings.create({ title: 'No calendar', startsAt: new Date(startsAt).toISOString(), durationMinutes: 30, guests: [], notes: 'off' });
    expect((await plain.api.meetings.update(alone.id, { repeat }, { scope: 'following' })).seriesCode).toBeTruthy();
    expect(await upcomingIn(plain, (await plain.api.meetings.get(alone.id)).seriesId)).toHaveLength(3);
  });

  it('refuses to repeat what can’t, and this and later on what doesn’t', async () => {
    const org = await googleAccount('Lou');
    const when = soon();
    const repeat = weekly(when, 2);
    const plain = await org.api.meetings.create({ title: 'Plain', startsAt: new Date(when).toISOString(), durationMinutes: 30, guests: [], notes: 'off' });
    expect(await refusal(org.api.meetings.update(plain.id, { title: 'Nothing later' }, { scope: 'following' }))).toBe('conflict');
    expect(await refusal(org.api.meetings.cancel(plain.id, { scope: 'following' }))).toBe('conflict');
    expect((await org.api.meetings.get(plain.id)).title).toBe('Plain');

    // A lobby, a call waiting for someone to pick, and someone's own Google event.
    const { code: lobby } = await org.api.calls.startNow({ title: 'A lobby' });
    expect(await refusal(org.api.meetings.update((await org.api.meetings.byCode(lobby))?.id ?? '', { repeat }))).toBe('conflict');
    const offered = await org.api.meetings.create({ title: 'Pick one', startsAt: new Date(when).toISOString(), durationMinutes: 30, guests: [], notes: 'off', offer: [new Date(when).toISOString(), new Date(when + DAY).toISOString()] });
    expect(await refusal(org.api.meetings.update(offered.id, { repeat }))).toBe('conflict');
    h.google.calendar(org.sub).push({ id: 'their-own-event', summary: 'Theirs', start: { dateTime: new Date(when).toISOString() }, end: { dateTime: new Date(when + HOUR).toISOString() }, organizer: { self: true } });
    const adopted = await org.api.calendar.adopt('their-own-event', 'off');
    expect(await refusal(org.api.meetings.update(adopted.id, { repeat }))).toBe('conflict');
    expect(await seriesItems(org.session.ownerId)).toBe(0);
  });

  it('refuses someone else’s calls, by any scope, as if they weren’t there', async () => {
    const org = await googleAccount('Mo');
    const lena = await account();
    const other = await account();
    const first = await org.api.meetings.create(schedule('Mine', [lena.email], 3));
    const calls = await upcomingIn(org, first.seriesId);
    const repeat = weekly(new Date(first.startsAt).getTime(), 2);
    for (const stranger of [other, lena]) {
      expect(await refusal(stranger.api.meetings.update(first.id, { title: 'Theirs' }, { scope: 'following' }))).toBe('not-found');
      expect(await refusal(stranger.api.meetings.update(first.id, { title: 'Theirs' }, { scope: 'this' }))).toBe('not-found');
      expect(await refusal(stranger.api.meetings.update(first.id, { repeat }))).toBe('not-found');
      expect(await refusal(stranger.api.meetings.cancel(first.id, { scope: 'following' }))).toBe('not-found');
      expect(await refusal(stranger.api.meetings.cancel(at(calls, 1).id, { scope: 'this' }))).toBe('not-found');
    }
    expect(await refusal(other.api.series.get(first.seriesId ?? ''))).toBe('not-found');
    // A series' ID isn't a call's: it opens nothing.
    expect(await refusal(org.api.meetings.get(first.seriesId ?? ''))).toBe('not-found');
    expect(await refusal(org.api.meetings.cancel(first.seriesId ?? ''))).toBe('not-found');
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.title)).toEqual(['Mine', 'Mine', 'Mine']);
    expect(await refusal(org.fetch(`${h.baseUrl}/v1/meetings/${first.id}?scope=everything`, { method: 'DELETE' }).then(async (r) => { if (r.status !== 400) throw new Error(String(r.status)); throw new AlcoveApiError('invalid', await r.text()); }))).toBe('invalid');
  });

  it('takes turns: two quick changes never leave two events carrying the same calls', async () => {
    const org = await googleAccount('Noor');
    const first = await org.api.meetings.create(schedule('Quick', [unique('lena')], 5));
    const calls = await upcomingIn(org, first.seriesId);
    const third = at(calls, 2);
    const results = await Promise.allSettled([
      org.api.meetings.update(third.id, { title: 'First try' }, { scope: 'following' }),
      org.api.meetings.update(third.id, { title: 'Second try' }, { scope: 'following' }),
      org.api.meetings.cancel(at(calls, 4).id)
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    const left = await upcomingIn(org, first.seriesId);
    expect(left).toHaveLength(4);
    const events = masters(org.sub);
    expect(events).toHaveLength(2);
    const fresh = at(events, 1);
    // The calendar agrees with the calls, whichever change got there last.
    expect(occurrences(org.sub, at(events, 0)).map(startOf)).toEqual(starts(left).slice(0, 2));
    expect(occurrences(org.sub, fresh).map(startOf)).toEqual(starts(left).slice(2));
    expect(fresh.summary).toBe(at(left, 2).title);
    expect(left.every((c) => c.calendarUrl)).toBe(true);
    // Nothing's still holding a turn.
    expect((await h.pool.query<{ held: boolean }>('SELECT series_turn_until IS NOT NULL AS held FROM owners WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.held).toBe(false);
  });

  it('gives back only its own turn: a change that outlived its turn leaves the next one’s alone', async () => {
    const org = await googleAccount('Uma');
    const first = await org.api.meetings.create(schedule('Slow', [], 2));
    const turn = async () => (await h.pool.query<{ until: string | null }>('SELECT series_turn_until::text AS until FROM owners WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.until;
    const mark = h.google.calls.length;
    const release = h.google.hold((c) => c.method === 'PATCH');
    const slow = org.api.meetings.update(first.id, { title: 'Slow to reach Google' });
    await waitFor(() => writesSince(mark).length > 0, 'the change to reach Google');
    expect(await turn()).toBeTruthy();

    // Its two minutes run out while Google thinks, and another change takes its turn.
    await h.pool.query(`UPDATE owners SET series_turn_until = now() + interval '1 hour' WHERE owner_id = $1`, [org.session.ownerId]);
    const theirs = await turn();
    release();
    await slow;
    expect(await turn()).toBe(theirs);
    await h.pool.query('UPDATE owners SET series_turn_until = NULL WHERE owner_id = $1', [org.session.ownerId]);
  });

  it('waits for a turn another process holds, and takes over one that ran out', async () => {
    const org = await account();
    const first = await org.api.meetings.create(schedule('Turns', [], 2));
    const take = (until: string) => h.pool.query(`UPDATE owners SET series_turn_until = now() + $2::interval WHERE owner_id = $1`, [org.session.ownerId, until]);
    await take('-1 second');
    await org.api.meetings.update(first.id, { title: 'Ran out' });
    await take('1 hour');
    const waiting = org.api.meetings.update(first.id, { title: 'Waited' });
    await new Promise((r) => setTimeout(r, 300));
    expect((await org.api.meetings.get(first.id)).title).toBe('Ran out');
    await h.pool.query('UPDATE owners SET series_turn_until = NULL WHERE owner_id = $1', [org.session.ownerId]);
    expect((await waiting).title).toBe('Waited');
  });
});

describe('older kinds of series', () => {
  it('work as they did beside one that repeats, and a call scheduled as the next one joins it', async () => {
    const org = await googleAccount('Pat');
    const first = await org.api.meetings.create(schedule('Repeats', [unique('lena')], 2));
    const calls = await upcomingIn(org, first.seriesId);
    const last = at(calls, 1);

    // The next call after the last: its own event, in the same series, and the link leads to it once the rest are done.
    const nextAt = new Date(new Date(last.startsAt).getTime() + 7 * DAY).toISOString();
    const next = await org.api.meetings.scheduleNext(last.id, nextAt);
    expect(next).toMatchObject({ seriesId: first.seriesId, seriesCode: first.seriesCode, startsAt: nextAt });
    expect(next.calendarUrl).toBeTruthy();
    expect(h.google.calendar(org.sub)).toHaveLength(2);
    const own = h.google.calendar(org.sub).find((e) => !e.recurrence);
    expect(own?.location).toBe(linkTo(first.seriesCode));
    await org.api.meetings.cancel(first.id);
    await org.api.meetings.cancel(last.id);
    expect((await org.api.meetings.byCode(first.seriesCode ?? ''))?.id).toBe(next.id);
    // It changes on its own event, and takes the series with it when it's the last.
    await org.api.meetings.update(next.id, { title: 'Next one' }, { scope: 'following' });
    expect(own?.summary).toBe('Next one');
    expect(masters(org.sub)).toEqual([]);
    await org.api.meetings.cancel(next.id, { scope: 'following' });
    expect(h.google.calendar(org.sub)).toEqual([]);
    expect(await seriesItems(org.session.ownerId)).toBe(0);
  });

  it('a next call that a change to how they repeat leaves out takes its own event with it', async () => {
    const org = await googleAccount('Rio');
    const first = await org.api.meetings.create(schedule('Runs out', [], 2));
    const last = at(await upcomingIn(org, first.seriesId), 1);
    await org.api.meetings.scheduleNext(last.id, new Date(new Date(last.startsAt).getTime() + 7 * DAY).toISOString());
    expect(h.google.calendar(org.sub)).toHaveLength(2);
    await org.api.meetings.update(first.id, { repeat: weekly(new Date(first.startsAt).getTime(), 2) }, { scope: 'following' });
    expect(await upcomingIn(org, first.seriesId)).toHaveLength(2);
    expect(h.google.calendar(org.sub).map((e) => Boolean(e.recurrence))).toEqual([true]);
  });

  it('a next call with its own event can take on how they repeat: the new calls it makes go on the calendar', async () => {
    const org = await googleAccount('Lars');
    const first = await org.api.meetings.create(schedule('Goes on', [], 2));
    const last = at(await upcomingIn(org, first.seriesId), 1);
    const when = new Date(last.startsAt).getTime() + 7 * DAY;
    const next = await org.api.meetings.scheduleNext(last.id, new Date(when).toISOString());
    expect(h.google.calendar(org.sub)).toHaveLength(2);

    await org.api.meetings.update(next.id, { repeat: weekly(when, 3) }, { scope: 'following' });
    const calls = await upcomingIn(org, first.seriesId);
    expect(calls).toHaveLength(5);
    // Five calls in Alcove, five on the calendar: two on the first event, one with its own, and two on a new event.
    const [, fresh] = masters(org.sub);
    if (!fresh) throw new Error('the new calls have no event');
    expect(occurrences(org.sub, fresh).map(startOf)).toEqual(starts(calls).slice(3));
    expect(occurrences(org.sub, only(org.sub)).map(startOf)).toEqual(starts(calls).slice(0, 2));
    expect(h.google.calendar(org.sub).filter((e) => !e.recurrence).map(startOf)).toEqual([at(calls, 2).startsAt]);
    expect(calls.every((c) => c.calendarUrl)).toBe(true);
    expect(await sealed(org.session.ownerId, first.seriesId)).toMatchObject({ calendarEvent: { id: fresh.id } });
  });

  it('repeating from the first of a chain of next calls leaves one call at each time, in Alcove and on the calendar', async () => {
    const org = await googleAccount('Ines');
    const when = soon();
    const one = await org.api.meetings.create({ title: 'Chain', startsAt: new Date(when).toISOString(), durationMinutes: 30, guests: [unique('lena')], notes: 'off' });
    const two = await org.api.meetings.scheduleNext(one.id, new Date(when + 7 * DAY).toISOString());
    expect(h.google.calendar(org.sub)).toHaveLength(2);

    await org.api.meetings.update(one.id, { repeat: weekly(when, 4) });
    const calls = await upcomingIn(org, two.seriesId);
    expect(starts(calls)).toEqual([0, 1, 2, 3].map((n) => new Date(when + n * 7 * DAY).toISOString()));
    // The next call stays the call it was, answers and all, with its own event.
    expect(at(calls, 1).id).toBe(two.id);
    const onCalendar = [...occurrences(org.sub, only(org.sub)), ...h.google.calendar(org.sub).filter((e) => !e.recurrence)];
    expect(onCalendar.map(startOf).sort()).toEqual(starts(calls));
  });

  it('a call in a chain that isn’t on the calendar yet joins the event when one of them is made to repeat', async () => {
    const org = await googleAccount('Juno');
    const when = soon();
    const one = await org.api.meetings.create({ title: 'Chain', startsAt: new Date(when).toISOString(), durationMinutes: 30, guests: [], notes: 'off' });
    h.google.refuse((c) => c.method === 'POST');
    const two = await org.api.meetings.scheduleNext(one.id, new Date(when + 7 * DAY).toISOString());
    h.google.refuse();

    await org.api.meetings.update(one.id, { repeat: weekly(when, 3) });
    const calls = await upcomingIn(org, two.seriesId);
    expect(starts(calls)).toEqual([0, 1, 2].map((n) => new Date(when + n * 7 * DAY).toISOString()));
    expect(occurrences(org.sub, only(org.sub)).map(startOf)).toEqual(starts(calls));
    expect(calls.every((c) => c.calendarUrl)).toBe(true);
  });

  it('a series of next calls has no item and no link, until one of its calls is made to repeat', async () => {
    const org = await account();
    const when = soon();
    const one = await org.api.meetings.create({ title: 'Meet again', startsAt: new Date(when).toISOString(), durationMinutes: 30, guests: [], notes: 'off' });
    const two = await org.api.meetings.scheduleNext(one.id, new Date(when + 7 * DAY).toISOString());
    expect(two.seriesId).toBeTruthy();
    expect([two.seriesCode, two.repeat]).toEqual([undefined, undefined]);
    expect((await org.api.series.get(two.seriesId ?? '')).repeat).toBeUndefined();
    expect(await seriesItems(org.session.ownerId)).toBe(0);
    // Each call is cancelled or changed alone: there's no way to reach the calls after one.
    expect(await refusal(org.api.meetings.update(one.id, { title: 'All of them' }, { scope: 'following' }))).toBe('conflict');
    expect(await refusal(org.api.meetings.cancel(one.id, { scope: 'following' }))).toBe('conflict');
    await org.api.meetings.update(two.id, { title: 'Second' });
    expect((await org.api.meetings.get(one.id)).title).toBe('Meet again');

    // Made to repeat, it keeps its series, so what carries over still does.
    const repeat = weekly(when + 7 * DAY, 3);
    const made = await org.api.meetings.update(two.id, { repeat });
    expect(made.seriesId).toBe(two.seriesId);
    expect((await org.api.series.get(two.seriesId ?? '')).repeat?.until).toBe(repeat.until);
    expect((await upcomingIn(org, two.seriesId)).map((c) => [c.title, c.seriesCode])).toEqual([['Meet again', made.seriesCode], ['Second', made.seriesCode], ['Second', made.seriesCode], ['Second', made.seriesCode]]);
    expect((await h.browser().api.calls.card(made.seriesCode ?? '')).title).toBe('Meet again');
    // The call that came first is in the series now: it's refused as one that already repeats, and it counts as one of
    // its calls, so the last to go takes the series with it whichever it is.
    expect(await refusal(org.api.meetings.update(one.id, { repeat: weekly(when, 2) }))).toBe('invalid');
    await org.api.meetings.cancel(two.id, { scope: 'following' });
    expect(await seriesItems(org.session.ownerId)).toBe(1);
    await org.api.meetings.cancel(one.id);
    expect(await seriesItems(org.session.ownerId)).toBe(0);
    expect(await refusal(h.browser().api.calls.card(made.seriesCode ?? ''))).toBe('not-found');
  });

  it('a recurring Google event moved to Alcove stays on its own terms', async () => {
    const org = await googleAccount('Quin');
    const when = soon();
    const google = (i: number): FakeEvent => ({ id: `weekly_${i}`, recurringEventId: 'weekly', summary: 'Theirs', start: { dateTime: new Date(when + i * 7 * DAY).toISOString() }, end: { dateTime: new Date(when + i * 7 * DAY + HOUR).toISOString() }, organizer: { self: true } });
    h.google.calendar(org.sub).push(google(0), google(1));
    const one = await org.api.calendar.adopt('weekly_0', 'off');
    expect(one.seriesId).toBeTruthy();
    expect((await org.api.calendar.adopt('weekly_1', 'off')).seriesId).toBe(one.seriesId);
    expect((await org.api.series.get(one.seriesId ?? ''))).toMatchObject({ recurring: true });
    expect((await org.api.series.get(one.seriesId ?? '')).repeat).toBeUndefined();
    expect(await refusal(org.api.meetings.update(one.id, { title: 'Everything' }, { scope: 'following' }))).toBe('conflict');
    expect(await refusal(org.api.meetings.update(one.id, { repeat: weekly(when, 2) }))).toBe('conflict');
    await org.api.meetings.cancel(one.id);
    expect(h.google.calendar(org.sub).map((e) => e.id)).toEqual(['weekly_1']);
  });
});

describe('when Google fails', () => {
  const failing = (method: string, path = '/events') => (c: { method: string; path: string }) => c.method === method && c.path.includes(path);
  /** The lines logged since `mark`, as they were written. */
  const logged = (mark: number, what: string) => h.logs.slice(mark).filter((l) => l.includes(what));

  it('the calls still exist with no event, and a later change puts them on the calendar', async () => {
    const org = await googleAccount('Rae');
    const mark = h.logs.length;
    h.google.refuse(failing('POST'));
    const first = await org.api.meetings.create(schedule('Down', [unique('lena')], 3));
    expect(first.seriesCode).toBeTruthy();
    const calls = await upcomingIn(org, first.seriesId);
    expect(calls).toHaveLength(3);
    expect(calls.some((c) => c.calendarUrl)).toBe(false);
    expect(logged(mark, 'series not brought up to date on calendar').some((l) => l.includes('"step":"place"'))).toBe(true);
    h.google.refuse();

    // Changing one call doesn't put it on the calendar alone: that would be an invitation for one call of a series.
    await org.api.meetings.update(first.id, { title: 'Just this one' });
    expect(h.google.calendar(org.sub)).toEqual([]);
    // Changing them all does, once it's back.
    await org.api.meetings.update(at(calls, 1).id, { title: 'Back up' }, { scope: 'following' });
    expect(masters(org.sub)).toHaveLength(1);
    expect(occurrences(org.sub, only(org.sub)).map(startOf)).toEqual(starts(calls).slice(1));
    expect((await upcomingIn(org, first.seriesId)).map((c) => Boolean(c.calendarUrl))).toEqual([false, true, true]);
  });

  it('a series whose occurrences can’t be read keeps its event, and finds them later', async () => {
    const org = await googleAccount('Sol');
    const mark = h.logs.length;
    h.google.refuse(failing('GET', '/instances'));
    const first = await org.api.meetings.create(schedule('Half placed', [], 3));
    expect(masters(org.sub)).toHaveLength(1);
    expect(logged(mark, 'series not brought up to date on calendar').some((l) => l.includes('"step":"occurrences"'))).toBe(true);
    const calls = await upcomingIn(org, first.seriesId);
    expect(calls.every((c) => !c.calendarUrl)).toBe(true);
    h.google.refuse();
    // The event isn't lost: changing them all finds the occurrences, and no second event is made.
    await org.api.meetings.update(first.id, { title: 'Whole again' }, { scope: 'following' });
    expect(masters(org.sub)).toHaveLength(1);
    expect((await upcomingIn(org, first.seriesId)).every((c) => c.calendarUrl)).toBe(true);
    // Nor is it lost when everything goes.
    await org.api.meetings.cancel(first.id, { scope: 'following' });
    expect(h.google.calendar(org.sub)).toEqual([]);
  });

  it('finds a call’s occurrence first when it wasn’t read at scheduling, so moving or cancelling one reaches Google', async () => {
    const org = await googleAccount('Ulla');
    const lena = unique('lena');
    h.google.refuse(failing('GET', '/instances'));
    const first = await org.api.meetings.create(schedule('Unread', [lena], 4));
    h.google.refuse();
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    expect(calls.every((c) => !c.calendarUrl)).toBe(true);

    // Moved alone: its own occurrence moves, and everyone on it hears about that call.
    const moved = at(calls, 1);
    const to = new Date(new Date(moved.startsAt).getTime() + 3 * HOUR).toISOString();
    const mark = h.google.mail.length;
    await org.api.meetings.update(moved.id, { startsAt: to });
    expect(occurrences(org.sub, master).map(startOf)).toEqual([at(calls, 0).startsAt, to, at(calls, 2).startsAt, at(calls, 3).startsAt]);
    expect(h.google.mail.slice(mark).map((m) => [m.kind, m.to])).toEqual([['update', [lena]]]);
    expect((await upcomingIn(org, first.seriesId)).every((c) => c.calendarUrl)).toBe(true);

    // Cancelled alone, in a series whose occurrences nobody has read yet.
    h.google.refuse(failing('GET', '/instances'));
    const other = await org.api.meetings.create(schedule('Unread too', [lena], 3));
    h.google.refuse();
    const rest = await upcomingIn(org, other.seriesId);
    const carrying = at(masters(org.sub), 1);
    await org.api.meetings.cancel(at(rest, 1).id);
    expect(occurrences(org.sub, carrying).map(startOf)).toEqual([at(rest, 0).startsAt, at(rest, 2).startsAt]);
  });

  it('says so when it can’t: a call whose occurrence can’t be found changes here, and the log has it', async () => {
    const org = await googleAccount('Vera');
    h.google.refuse(failing('GET', '/instances'));
    const first = await org.api.meetings.create(schedule('Still unread', [], 3));
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);

    // Google still won't say: the calls change all the same, nothing's touched there, and each step that couldn't be is logged.
    const mark = h.logs.length;
    await org.api.meetings.update(at(calls, 1).id, { title: 'Here only' });
    await org.api.meetings.cancel(at(calls, 2).id);
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.title)).toEqual(['Still unread', 'Here only']);
    const steps = logged(mark, 'series not brought up to date on calendar').map((l) => /"step":"(\w+)"/.exec(l)?.[1]);
    expect(steps).toEqual(['occurrences', 'instance', 'occurrences', 'withdraw']);
    h.google.refuse();
    expect(occurrences(org.sub, master)).toHaveLength(3);
  });

  it('a change that doesn’t reach the calendar is logged, and takes nothing off it', async () => {
    const org = await googleAccount('Tam');
    const first = await org.api.meetings.create(schedule('Stays put', [], 4));
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    const third = at(calls, 2);

    // The new event fails: the old one keeps everything, and each call keeps its occurrence.
    let mark = h.logs.length;
    h.google.refuse(failing('POST'));
    await org.api.meetings.update(third.id, { title: 'Renamed here' }, { scope: 'following' });
    expect(logged(mark, 'series not brought up to date on calendar').some((l) => l.includes('"step":"place"'))).toBe(true);
    expect(occurrences(org.sub, master).map(startOf)).toEqual(starts(calls));
    expect(masters(org.sub)).toHaveLength(1);
    h.google.refuse();

    // Ending the old one fails after the new one is up: both are there, and it says so.
    mark = h.logs.length;
    h.google.refuse((c) => c.method === 'PATCH' && c.path.endsWith(master.id));
    await org.api.meetings.update(third.id, { title: 'Renamed again' }, { scope: 'following' });
    expect(logged(mark, 'series not brought up to date on calendar').some((l) => l.includes('"step":"end"'))).toBe(true);
    expect(masters(org.sub)).toHaveLength(2);
    h.google.refuse();

    // One call, and cancelling: Google refuses, the call changes all the same, and it's in the log.
    mark = h.logs.length;
    h.google.refuse((c) => c.method !== 'GET');
    await org.api.meetings.update(first.id, { title: 'Here only' });
    await org.api.meetings.cancel(at(calls, 1).id);
    expect((await upcomingIn(org, first.seriesId)).map((c) => c.title)).toEqual(['Here only', 'Renamed again', 'Renamed again']);
    expect(logged(mark, 'series not brought up to date on calendar').map((l) => /"step":"(\w+)"/.exec(l)?.[1])).toEqual(['instance', 'withdraw']);
  });
});

describe('deleting an account', () => {
  it('withdraws each recurring event once, and removes every series', async () => {
    const org = await googleAccount('Uma');
    const lena = unique('lena');
    const first = await org.api.meetings.create(schedule('Goes', [lena], 4));
    const calls = await upcomingIn(org, first.seriesId);
    await org.api.meetings.update(at(calls, 2).id, { title: 'Split' }, { scope: 'following' });
    const events = masters(org.sub);
    expect(events).toHaveLength(2);
    const other = await org.api.meetings.create(schedule('Also goes', [], 2));
    const link = other.seriesCode ?? '';
    const mark = h.google.calls.length;
    const { ownerId } = org.session;
    await org.api.account.delete();

    // Both halves and the other series: three cancellations, not one per call.
    expect(writesSince(mark).map((c) => c.method)).toEqual(['DELETE', 'DELETE', 'DELETE']);
    expect(h.google.calendar(org.sub)).toEqual([]);
    expect(await inserted(ownerId, `items WHERE owner_id = $1`)).toBe(0);
    expect(await inserted(ownerId, `call_codes WHERE owner_id = $1`)).toBe(0);
    expect(await refusal(h.browser().api.calls.card(link))).toBe('not-found');
  });
});

describe('a big series', () => {
  /*
   * How long a step takes on a loaded runner is the runner's more than the code's: these same steps have taken a third of a
   * second here and two seconds the next time, with nothing different asked of the database. So what's measured is what
   * each step asks of it, which is the code's alone: every statement the API runs is logged under its request's ID (db.ts),
   * a slow one as a slow query. 300 people on 60 calls are 18,000 invitations, so a statement for each person, let alone
   * each person on each call, can't hide. Each address is hashed once (access.ts); hashing all 18,000 would still take a
   * fraction of a second, which no time bound here could tell from a busy runner, so that isn't measured.
   */
  it('schedules, changes and reads 60 calls with 300 people in the same statements as with three', async () => {
    let step = '';
    /** A browser whose requests carry the step's request ID while there is one. */
    const tagging = (): Browser => {
      const own = cookieFetch(ORIGIN);
      return h.browser({ fetch: (input, init) => { const headers = new Headers(init?.headers); if (step) headers.set(REQUEST_ID_HEADER, step); return own(input, { ...init, headers }); } });
    };
    const signedIn = async () => { const b = tagging(); const email = unique(); const { session } = await b.api.auth.signIn('sso', { email }); return { ...b, session, email }; };
    const org = await signedIn();
    const lena = await signedIn();
    // A demo account's sample day is on it already.
    const seeded = (await inserted(org.session.ownerId, `meeting_access WHERE owner_id = $1`)) ?? 0;
    const invites = async () => ((await inserted(org.session.ownerId, `meeting_access WHERE owner_id = $1`)) ?? 0) - seeded;
    const Line = z.object({ msg: z.string(), requestId: z.string().optional(), sql: z.string().optional() });
    /**
     * What a step asks of the database: its statements, in no particular order (a step may run some at once), but for the
     * service limits and feature flags (limits.ts, feature-flags.ts). Every request may read those, and a read on its way
     * is shared, logged under whichever request started it, so whether a step logs one is timing alone.
     */
    const counted = async <T,>(name: string, fn: () => Promise<T>): Promise<[T, string[]]> => {
      step = `series-${name}-${(seq++).toString(36)}`;
      const id = step;
      const from = h.logs.length;
      try {
        const out = await fn();
        const sql = h.logs.slice(from).flatMap((l) => {
          const r = Line.safeParse(JSON.parse(l));
          return r.success && r.data.requestId === id && (r.data.msg === 'query' || r.data.msg === 'slow query') && r.data.sql ? [r.data.sql] : [];
        });
        return [out, sql.filter((q) => !/service_limits|feature_flag/.test(q)).sort()];
      } finally {
        step = '';
      }
    };
    /** The journey with `size` people, Lena first, and what each step asked of the database. */
    const journey = async (size: number) => {
      const people = [lena.email, ...Array.from({ length: size - 1 }, (_, i) => `person.${size}.${i}@tests.example`)];
      const kept = people.slice(0, Math.round(size * 2 / 3));
      const [first, scheduling] = await counted('scheduling', () => org.api.meetings.create(schedule('All hands', people, MAX_SERIES_CALLS)));
      expect(await invites()).toBe(MAX_SERIES_CALLS * size);
      const [calls, reading] = await counted('reading', () => upcomingIn(org, first.seriesId));
      expect(calls).toHaveLength(MAX_SERIES_CALLS);
      const [, changing] = await counted('changing', () => org.api.meetings.update(first.id, { guests: kept, title: 'Fewer hands' }, { scope: 'following' }));
      expect(await invites()).toBe(MAX_SERIES_CALLS * kept.length);
      const [, invited] = await counted('invited', () => upcomingIn(lena, first.seriesId));
      const [, cancelling] = await counted('cancelling', () => org.api.meetings.cancel(first.id, { scope: 'following' }));
      expect(await seriesItems(org.session.ownerId)).toBe(0);
      expect(await invites()).toBe(0);
      return { scheduling, reading, changing, invited, cancelling };
    };
    const many = await journey(300);
    const few = await journey(3);
    expect(Object.values(few).every((sql) => sql.length > 0)).toBe(true);
    expect(many).toEqual(few);
  });
});

describe('what the server keeps to itself', () => {
  it('logs no titles, codes, time zones or Google’s IDs', async () => {
    const org = await googleAccount('Vee');
    const mark = h.logs.length;
    const first = await org.api.meetings.create({ ...schedule('LOGGED-TITLE series', [unique('logged-guest')], 3) });
    const calls = await upcomingIn(org, first.seriesId);
    const master = only(org.sub);
    await org.api.meetings.update(at(calls, 1).id, { title: 'LOGGED-TITLE this' });
    await org.api.meetings.update(at(calls, 1).id, { title: 'LOGGED-TITLE following' }, { scope: 'following' });
    h.google.refuse((c) => c.method !== 'GET');
    await org.api.meetings.update(first.id, { title: 'LOGGED-TITLE failing' });
    await org.api.meetings.cancel(at(calls, 2).id);
    h.google.refuse();
    await org.api.meetings.cancel(first.id, { scope: 'following' });
    const lines = h.logs.slice(mark).join('');
    expect(lines).toContain(first.seriesId);
    const ids = [master.id, ...occurrences(org.sub, master).map((i) => i.id)];
    for (const secret of ['LOGGED-TITLE', 'logged-guest', first.seriesCode ?? 'none', first.code, ...ids, 'RRULE', first.repeat?.until ?? 'none']) expect(lines.includes(secret), secret).toBe(false);
  });
});
