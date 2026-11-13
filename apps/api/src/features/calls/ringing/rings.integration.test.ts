/**
 * Ringing people into a call: the real API over HTTP via @alcove/api-http, real Postgres and the object store, with
 * each person's rings arriving on the stream their browser holds. A ring lasts 45 seconds and an answer can put it
 * off for 15 minutes, so tests move a ring's times in the database rather than wait, and then watch the stream
 * catch up with no request from anyone.
 */
import { AlcoveApiError, RingsSnapshotSchema, type CallSession, type CallState, type IncomingRing, type LiveStore } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { maintain } from '../../../maintenance';
import { MAX_GUESTS } from '../../meetings/service';
import type { GoogleUser } from '../../../testing/fakes/google';
import { ORIGIN, cookieFetch, startHarness, type Browser, type Harness } from '../../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

type Rings = LiveStore<IncomingRing[]> & { close(): void };
/** Streams a test opened: closed after each test, so one test's rings never reach the next. */
const open: Rings[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) s.close();
  h.closeCalls();
  await h.pool.query('DELETE FROM call_rings');
});

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const unique = (who = 'person', domain = 'tests.example') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@${domain}`;
/** A work address at the demo company, whose directory is its team. */
const atVandelay = (who = 'org') => unique(who, 'vandelay.industries');
/** A work domain with no directory, where whoever is on your calls at it is your team. */
const aDomain = () => `${unique('acme').replace(/[.@]/g, '-')}.example`;
const THEO = 'theo@vandelay.industries';
const KOFI = 'kofi@vandelay.industries';
const SAM = 'sam@vandelay.industries';
const LENA = 'lena@vandelay.industries';
/** A fresh account, or one signing in again: single sign-on signs in whoever's work email is typed. */
async function account(email = unique(), o: Parameters<Harness['browser']>[0] = {}) {
  const b = h.browser(o);
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
/** Signs someone in with Google, the way a browser does: a real account, unlike one from single sign-on. */
async function viaGoogle(user: GoogleUser): Promise<Browser> {
  const b = h.browser();
  h.google.next(user);
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10; hop++) {
    if (url.origin === new URL(ORIGIN).origin) return b;
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  throw new Error('Too many redirects while signing in with Google.');
}
/** A browser whose every request goes to `target()`, and is counted: the stream's own requests show up as `/v1/rings`. */
function routed(target: () => string) {
  const inner = cookieFetch(ORIGIN);
  const asked: string[] = [];
  const f: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    asked.push(url.pathname);
    return inner(`${target()}${url.pathname}${url.search}`, init);
  };
  return { browser: h.browser({ fetch: f }), asked };
}
const ringsOf = (b: Browser): Rings => { const s = b.api.rings.live(); open.push(s); return s; };
async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 8_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}
/** The ring showing on a stream, once it's there. */
async function card(s: Rings, what = 'the ring to arrive'): Promise<IncomingRing> {
  await waitFor(() => s.getSnapshot().length > 0, what);
  const [c] = s.getSnapshot();
  if (!c) throw new Error('no ring');
  return c;
}
/** What the server itself says is ringing someone now: a stream's first line, read by hand, with no browser's timers to help. */
async function serverSays(b: Browser): Promise<IncomingRing[]> {
  const stop = new AbortController();
  const reader = (await b.fetch(`${h.baseUrl}/v1/rings`, { signal: stop.signal })).body?.getReader();
  if (!reader) throw new Error('no stream');
  const text = new TextDecoder();
  let line = '';
  while (!line.includes('\n')) { const { value, done } = await reader.read(); if (done) throw new Error('the stream ended before its first line'); line += text.decode(value, { stream: true }); }
  stop.abort();
  return RingsSnapshotSchema.parse(JSON.parse(line)).rings;
}
/** Refreshes until the call's state matches (other people's changes arrive by refetching). */
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await sleep(30); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`, 15_000);
/** A live call its organizer is in, at the organizer's browser. */
async function hosting(org: Browser, input: Parameters<Browser['api']['calls']['startNow']>[0] = {}) {
  const { code: link } = await org.api.calls.startNow(input);
  return { link, host: await org.api.calls.join(link, { mic: true, cam: false }) };
}
/** A request about a call with someone's pass, as their browser would send one, carrying whatever the test wants. */
const asMember = (call: CallSession, body: unknown) => fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(body)
});
const ringRows = async () => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM call_rings')).rows[0]?.n;
/** A ring's time has come and gone, as far as anyone can tell: it started a ring's length ago and stops in a moment. */
const runOut = (id: string) => h.pool.query(`UPDATE call_rings SET deliver_at = now() - interval '45 seconds', expires_at = now() + interval '200 milliseconds' WHERE ring_id = $1`, [id]);

describe('ringing', () => {
  it('rings a teammate on whatever page they have open, and shows the organizer each answer as they give it', async () => {
    const org = await account(atVandelay());
    const { browser: b, asked } = routed(() => h.baseUrl);
    await b.api.auth.signIn('sso', { email: THEO });
    const stream = ringsOf(b);
    const { link, host } = await hosting(org, { title: 'Pricing questions' });
    expect(host.getSnapshot().ringing).toEqual([]);

    await host.ring([THEO]);
    expect(host.getSnapshot().ringing).toMatchObject([{ state: 'ringing', person: { email: THEO, name: 'Theo Martin' } }]);
    expect(host.getSnapshot().ringing[0]?.until).toBeUndefined();

    // It reaches Theo's page by itself, saying who and what, for 45 seconds.
    const ring = await card(stream);
    expect(ring).toMatchObject({ code: link, title: 'Pricing questions', from: { email: org.session.user.email } });
    expect(ring.id).toBe(host.getSnapshot().ringing[0]?.id);
    const lasts = Date.parse(ring.expiresAt) - Date.now();
    expect(lasts).toBeGreaterThan(30_000);
    expect(lasts).toBeLessThanOrEqual(45_000);

    // In 5 minutes: gone from Theo's screen at once, and the organizer sees when they'll be rung again.
    await b.api.rings.answer(ring.id, 'in-5');
    expect(stream.getSnapshot()).toEqual([]);
    const later = (await settle(host, (s) => s.ringing[0]?.state === 'later')).ringing[0];
    expect(later).toMatchObject({ id: ring.id, state: 'later', person: { email: THEO } });
    expect(Date.parse(later?.until ?? '') - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(Date.parse(later?.since ?? '')).toBeLessThan(Date.now());
    // And it stays off Theo's screen until then, however many times the stream reads it.
    await sleep(1200);
    expect(stream.getSnapshot()).toEqual([]);
    expect(await serverSays(b)).toEqual([]);

    // Its time comes: it rings again by itself, with nobody asking, for another 45 seconds, as the same ring.
    const requests = asked.length;
    await h.pool.query(`UPDATE call_rings SET deliver_at = now(), expires_at = now() + interval '45 seconds' WHERE ring_id = $1`, [ring.id]);
    const again = await card(stream, 'the ring to come back');
    expect(again).toMatchObject({ id: ring.id, title: 'Pricing questions' });
    expect(again.expiresAt).not.toBe(ring.expiresAt);
    expect(asked.length).toBe(requests);
    expect((await settle(host, (s) => s.ringing[0]?.state === 'ringing')).ringing[0]?.until).toBeUndefined();

    // Not this time.
    await b.api.rings.answer(ring.id, 'no');
    expect(stream.getSnapshot()).toEqual([]);
    expect((await settle(host, (s) => s.ringing[0]?.state === 'declined')).ringing[0]).toMatchObject({ id: ring.id, state: 'declined' });
    await host.leave();
  });

  it('lets someone rung come straight in, with the notes, and their arch goes as they arrive', async () => {
    const org = await account(atVandelay());
    const kofi = await account(KOFI);
    const stream = ringsOf(kofi);
    const { link, host } = await hosting(org, { title: 'Roof budget', notes: 'on' });
    await inGroup(host);
    await host.ring([KOFI]);
    const ring = await card(stream);

    await kofi.api.rings.answer(ring.id, 'join');
    expect(stream.getSnapshot()).toEqual([]);
    expect((await settle(host, (s) => s.ringing[0]?.state === 'coming')).ringing[0]).toMatchObject({ id: ring.id, state: 'coming' });

    // Ringing put them on the invite: they come in with no asking, and the organizer lets nobody in.
    const call = await kofi.api.calls.join(ring.code, { mic: true, cam: false });
    await inGroup(call);
    expect(call.ticket.role).toBe('invited');
    const there = await settle(host, (s) => s.participants.length === 2);
    expect(there.waiting).toEqual([]);
    expect(there.ringing).toEqual([]);
    expect(await ringRows()).toBe(0);
    expect((await org.api.meetings.byCode(link))?.guests.map((g) => g.email)).toEqual([KOFI]);

    // And the notes come to them, like everyone invited.
    const ended = await host.leave();
    if (!ended?.pendingNoteId) throw new Error('the call kept no notes');
    expect((await kofi.api.notes.get(ended.pendingNoteId)).title).toBe('Roof budget');
  });

  it('leaves out anyone already here, and ringing someone again starts over on the same ring', async () => {
    const org = await account(atVandelay());
    const lena = await account(LENA);
    const email = KOFI;
    const inv = await account(email);
    const { link, host } = await hosting(org, { guests: [email] });
    await inGroup(host);
    const call = await inv.api.calls.join(link, { mic: true, cam: false });
    await inGroup(call);
    await settle(host, (s) => s.participants.length === 2);
    const stream = ringsOf(lena);

    // Someone in the call isn't rung: there's no row, and no card anywhere of theirs.
    await host.ring([email, LENA]);
    expect(host.getSnapshot().ringing.map((r) => r.person.email)).toEqual([LENA]);
    expect(await ringRows()).toBe(1);

    const first = await card(stream);
    await lena.api.rings.answer(first.id, 'no');
    await settle(host, (s) => s.ringing[0]?.state === 'declined');
    await sleep(5);
    await host.ring([LENA]);
    expect(host.getSnapshot().ringing).toMatchObject([{ id: first.id, state: 'ringing' }]);
    const second = await card(stream, 'the ring to start over');
    expect(second.id).toBe(first.id);
    expect(Date.parse(second.expiresAt)).toBeGreaterThan(Date.parse(first.expiresAt));
    await host.leave();
  });

  it('crosses instances: one API takes the ring, another delivers it, and the answer comes back', async () => {
    const second = await h.secondServer();
    try {
      const org = await account(atVandelay());
      const { browser: b } = routed(() => second.baseUrl);
      await b.api.auth.signIn('sso', { email: SAM });
      const stream = ringsOf(b);
      await sleep(50);
      const { host } = await hosting(org, { title: 'Across instances' });
      await host.ring([SAM]);
      const ring = await card(stream);
      expect(ring.title).toBe('Across instances');
      await b.api.rings.answer(ring.id, 'in-15');
      expect(Date.parse((await settle(host, (s) => s.ringing[0]?.state === 'later')).ringing[0]?.until ?? '') - Date.now()).toBeGreaterThan(14 * 60_000);
      await host.leave();
    } finally {
      await second.close();
    }
  });

  it('runs out by itself: the stream empties with no request, and the organizer sees it was missed, whoever it was', async () => {
    const domain = aDomain();
    const org = await account(unique('lead', domain));
    const { browser: b, asked } = routed(() => h.baseUrl);
    const here = unique('here', domain);
    await b.api.auth.signIn('sso', { email: here });
    const stream = ringsOf(b);
    // Three colleagues rung: one with Alcove open, one signed up with no tab open, and one with no account at all.
    const away = unique('away', domain);
    await account(away);
    const nobody = unique('nobody', domain);
    const { host } = await hosting(org, { guests: [here, away, nobody] });
    await host.ring([here, away, nobody]);
    const ring = await card(stream);
    expect(host.getSnapshot().ringing.map((r) => r.state)).toEqual(['ringing', 'ringing', 'ringing']);

    const requests = asked.length;
    for (const r of host.getSnapshot().ringing) await runOut(r.id);
    await waitFor(() => stream.getSnapshot().length === 0, 'the ring to run out');
    expect(asked.length).toBe(requests);
    await sleep(300);
    expect(await serverSays(b)).toEqual([]);

    // Nothing tells them apart: nobody learns who has an account, or who was online.
    const missed = (await settle(host, (s) => s.ringing.every((r) => r.state === 'missed'))).ringing;
    expect(missed.map((r) => r.state)).toEqual(['missed', 'missed', 'missed']);
    expect(new Set(missed.map((r) => Object.keys(r).sort().join())).size).toBe(1);
    expect(missed.find((r) => r.person.email === here)?.id).toBe(ring.id);
    await host.leave();
  });

  it('stops when the organizer says, and they stay on the invite', async () => {
    const org = await account(atVandelay());
    const theo = await account(THEO);
    const stream = ringsOf(theo);
    const { link, host } = await hosting(org);
    await host.ring([THEO]);
    const ring = await card(stream);

    await host.stopRing(ring.id);
    expect(host.getSnapshot().ringing).toEqual([]);
    await waitFor(() => stream.getSnapshot().length === 0, 'the card to go');
    expect(await ringRows()).toBe(0);
    expect((await org.api.meetings.byCode(link))?.guests.map((g) => g.email)).toEqual([THEO]);
    // Stopping one that's over changes nothing, and answering it is too late.
    await host.stopRing(ring.id);
    expect(code(await theo.api.rings.answer(ring.id, 'join').catch((e: unknown) => e))).toBe('not-found');
    await host.leave();
  });

  it('takes every ring with the call when it ends, a ring still to come too', async () => {
    const org = await account(atVandelay());
    const theo = await account(THEO);
    const stream = ringsOf(theo);
    const { host } = await hosting(org);
    await host.ring([THEO]);
    const ring = await card(stream);
    await theo.api.rings.answer(ring.id, 'in-5');
    expect(await ringRows()).toBe(1);

    await host.leave();
    expect(await ringRows()).toBe(0);
    expect(code(await theo.api.rings.answer(ring.id, 'no').catch((e: unknown) => e))).toBe('not-found');
    await sleep(1200);
    expect(stream.getSnapshot()).toEqual([]);
  });

  it('shows a ring in every tab, and answering in one takes it out of the others', async () => {
    const org = await account(atVandelay());
    const lena = await account(LENA);
    const other = await account(LENA);
    const here = ringsOf(lena);
    const there = ringsOf(other);
    const { host } = await hosting(org);
    await host.ring([LENA]);
    const ring = await card(here);
    await card(there);
    await lena.api.rings.answer(ring.id, 'join');
    await waitFor(() => there.getSnapshot().length === 0, 'the other tab to catch up');
    await host.leave();
  });

  it('takes several rings at once on one call, as a lobby ringing a big group sends them', async () => {
    const domain = aDomain();
    const org = await account(unique('lead', domain));
    const emails = Array.from({ length: 14 }, () => unique('wave', domain));
    const { host } = await hosting(org, { guests: emails });
    const t0 = Date.now();
    await Promise.all(emails.map((e) => host.ring([e])));
    // Each waits its turn for the call, and none of them holds everyone else up for it.
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(await ringRows()).toBe(14);
    await host.leave();
  });

  it('takes a whole group’s answers at once', async () => {
    const domain = aDomain();
    const org = await account(unique('lead', domain));
    const group = await Promise.all(Array.from({ length: 16 }, () => account(unique('group', domain))));
    const emails = group.map((g) => g.session.user.email);
    const { host } = await hosting(org, { guests: emails });
    await host.ring(emails);
    const ids = new Map(host.getSnapshot().ringing.map((r) => [r.person.email, r.id]));

    await Promise.all(group.map((g, i) => g.api.rings.answer(ids.get(g.session.user.email) ?? '', i % 2 ? 'no' : 'in-5')));
    const states = (await settle(host, (s) => s.ringing.every((r) => r.state !== 'ringing'))).ringing.map((r) => r.state);
    expect(states.filter((s) => s === 'later')).toHaveLength(8);
    expect(states.filter((s) => s === 'declined')).toHaveLength(8);
    await host.leave();
  });

  it('keeps the upkeep and account deletion promises: nothing of a ring outlasts a day, or the person it was for', async () => {
    const domain = aDomain();
    const org = await account(unique('lead', domain));
    const email = unique('leaving', domain);
    const gone = await account(email);
    const stays = unique('stays', domain);
    const { host } = await hosting(org, { guests: [email, stays] });
    await host.ring([email, stays]);
    expect(await ringRows()).toBe(2);

    // A ring still in a call a day after it ran out goes; one that ran out only just now stays, for its arch.
    await h.pool.query(`UPDATE call_rings SET deliver_at = now() - interval '25 hours', expires_at = now() - interval '25 hours' WHERE ring_id = $1`, [host.getSnapshot().ringing.find((r) => r.person.email === stays)?.id]);
    expect((await maintain(h.deps)).rings).toBe(1);
    await host.refresh();
    expect(host.getSnapshot().ringing.map((r) => r.person.email)).toEqual([email]);

    // Whoever deletes their account takes the rings to it with them, out of other people's calls.
    await gone.api.account.delete();
    expect(await ringRows()).toBe(0);
    await host.refresh();
    expect(host.getSnapshot().ringing).toEqual([]);
    await host.leave();

    // An organizer's rings go with their account, the call still going.
    const leaver = await account(unique('leaver', domain));
    const { host: leaving } = await hosting(leaver, { guests: [stays] });
    await leaving.ring([stays]);
    expect(await ringRows()).toBe(1);
    await leaver.api.account.delete();
    expect(await ringRows()).toBe(0);
  });
});

describe('who can be rung, and by whom', () => {
  it('refuses a stranger the same way whether or not they have an account, and rings nobody', async () => {
    const org = await account(atVandelay());
    const stranger = unique('stranger', 'elsewhere.example');
    await account(stranger);
    const none = unique('nobody', 'elsewhere.example');
    const { link, host } = await hosting(org);

    const refusal = async (emails: string[]) => {
      const e = await host.ring(emails).catch((x: unknown) => x);
      if (!(e instanceof AlcoveApiError)) throw new Error('the ring wasn’t refused');
      return { code: e.code, message: e.message };
    };
    const hasAccount = await refusal([stranger]);
    expect(hasAccount.code).toBe('invalid');
    expect(await refusal([none])).toEqual(hasAccount);
    expect(hasAccount.message).not.toContain('elsewhere');
    // One stranger among teammates refuses the lot.
    expect(await refusal([THEO, none])).toEqual(hasAccount);
    // Nor can the organizer ring themselves.
    expect(await refusal([org.session.user.email])).toEqual(hasAccount);
    expect(await ringRows()).toBe(0);
    expect((await org.api.meetings.byCode(link))?.guests).toEqual([]);
    await host.leave();
  });

  it('takes no invitation for an answer: someone invited is rung only once they’ve said they’re coming', async () => {
    // Anyone can put any address on an invite, so a stranger's call can't reach someone's screen by doing that alone.
    const org = await account(unique('stranger', 'elsewhere.example'));
    const email = unique('them', 'somewhere.example');
    const them = await account(email);
    const stream = ringsOf(them);
    const { link, host } = await hosting(org, { title: 'Your account is locked, join now', guests: [email] });
    const meeting = await org.api.meetings.byCode(link);
    if (!meeting) throw new Error('no call');
    const refusal = async (address: string) => {
      const e = await host.ring([address]).catch((x: unknown) => x);
      if (!(e instanceof AlcoveApiError)) throw new Error('the ring wasn’t refused');
      return { code: e.code, message: e.message };
    };
    const stranger = await refusal(unique('nobody', 'somewhere.example'));
    expect(stranger.code).toBe('invalid');
    expect(stranger.message).not.toContain('somewhere');

    // Invited and silent, or anything short of yes, is the stranger's answer, word for word.
    expect(await refusal(email)).toEqual(stranger);
    for (const answer of ['maybe', 'no'] as const) {
      await them.api.meetings.answer(meeting.id, answer);
      expect(await refusal(email)).toEqual(stranger);
    }
    expect(await ringRows()).toBe(0);
    await sleep(1200);
    expect(stream.getSnapshot()).toEqual([]);

    // Saying they're coming is what lets the organizer reach them.
    await them.api.meetings.answer(meeting.id, 'yes');
    await host.ring([email]);
    expect((await card(stream)).title).toBe('Your account is locked, join now');
    // And taking it back takes that back.
    await them.api.meetings.answer(meeting.id, 'no');
    expect(await refusal(email)).toEqual(stranger);
    await host.leave();
  });

  it('counts colleagues from past calls as the team, at a work domain with no directory', async () => {
    const domain = `${unique('acme').replace(/[.@]/g, '-')}.example`;
    const colleague = unique('dev', domain);
    const org = await account(unique('lead', domain));
    await org.api.meetings.create({ title: 'Earlier', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [colleague], notes: 'off' });
    const { link, host } = await hosting(org);
    await host.ring([colleague]);
    expect(host.getSnapshot().ringing.map((r) => r.person.email)).toEqual([colleague]);
    expect((await org.api.meetings.byCode(link))?.guests.map((g) => g.email)).toEqual([colleague]);
    await host.leave();
  });

  it('rings only for the organizer: nobody else in the call can', async () => {
    const org = await account(atVandelay());
    const email = unique('invited');
    const inv = await account(email);
    const { link, host } = await hosting(org, { guests: [email] });
    await inGroup(host);
    const invited = await inv.api.calls.join(link, { mic: true, cam: false });
    await inGroup(invited);
    const guest = await h.browser().api.calls.join(link, { mic: true, cam: false, name: 'Sam' });
    await settle(host, (s) => s.waiting.some((w) => w.id === guest.ticket.identity));
    await host.admit(guest.ticket.identity);
    await inGroup(guest);

    for (const who of [guest, invited]) {
      expect((await asMember(who, { type: 'ring', emails: [THEO] })).status).toBe(403);
      expect(code(await who.ring([THEO]).catch((e: unknown) => e))).toBe('forbidden');
    }
    expect(await ringRows()).toBe(0);
    // Nor does anyone but the organizer see who was rung.
    await host.ring([THEO]);
    await settle(guest, (s) => s.ringing.length > 0);
    await settle(invited, (s) => s.ringing.length > 0);
    expect(guest.getSnapshot().ringing).toEqual([]);
    expect(invited.getSnapshot().ringing).toEqual([]);
    await host.leave();
  });

  it('keeps a ring to the person it’s for: nobody else can answer it, stop it, or read it', async () => {
    const org = await account(atVandelay());
    const other = await account(atVandelay('other'));
    const theo = await account(THEO);
    const third = await account(unique('third'));
    const stream = ringsOf(theo);
    const snooping = ringsOf(third);
    const { host } = await hosting(org);
    await host.ring([THEO]);
    const ring = await card(stream);

    for (const who of [org, other, third]) expect(code(await who.api.rings.answer(ring.id, 'no').catch((e: unknown) => e))).toBe('not-found');
    expect(code(await theo.api.rings.answer('not-a-ring', 'no').catch((e: unknown) => e))).toBe('not-found');
    expect((await settle(host, (s) => s.ringing[0]?.state !== 'ringing')).ringing).toMatchObject([{ id: ring.id, state: 'ringing' }]);

    // Another organizer's call can't stop it, even by its ID.
    const { host: another } = await hosting(other);
    await another.stopRing(ring.id);
    expect(await ringRows()).toBe(1);
    expect(snooping.getSnapshot()).toEqual([]);
    await another.leave();
    await host.leave();
  });

  it('never crosses between a demo account and a real one, though the organizer sees only that nobody answered', async () => {
    const realEmail = unique('dana', 'work.example');
    const real = await viaGoogle({ sub: `dana-${seq++}`, email: realEmail, name: 'Dana Ruiz' });
    // Nothing checked this address: anyone can claim one at someone's work domain, and so be their teammate on paper.
    const demoEmail = unique('demo', 'work.example');
    const demo = await account(demoEmail);
    const control = await account(unique('control', 'work.example'));
    const realControl = await viaGoogle({ sub: `eli-${seq++}`, email: unique('eli', 'work.example'), name: 'Eli Ruiz' });

    // A real organizer rings an address someone signed in to with no check at all, and a real person.
    const toDemo = ringsOf(demo);
    const toReal = ringsOf(realControl);
    const realEli = (await realControl.api.auth.getSession())?.user.email ?? '';
    const { host: realHost } = await hosting(real, { title: 'Real call', guests: [demoEmail, realEli] });
    await realHost.ring([demoEmail, realEli]);
    const reached = await card(toReal);
    await sleep(1200);
    expect(toDemo.getSnapshot()).toEqual([]);
    const held = realHost.getSnapshot().ringing.find((r) => r.person.email === demoEmail);
    expect(held?.state).toBe('ringing');
    expect(code(await demo.api.rings.answer(held?.id ?? '', 'no').catch((e: unknown) => e))).toBe('not-found');
    await realControl.api.rings.answer(reached.id, 'no');

    // And a demo organizer, whose name and address nobody checked, can't reach a real person's screen.
    const toRealFromDemo = ringsOf(real);
    const toDemoControl = ringsOf(control);
    const { host: demoHost } = await hosting(demo, { title: 'Demo call', guests: [realEmail, control.session.user.email] });
    await demoHost.ring([realEmail, control.session.user.email]);
    await card(toDemoControl);
    await sleep(1200);
    expect(toRealFromDemo.getSnapshot()).toEqual([]);
    await demoHost.leave();
    await realHost.leave();
  });

  it('says so when a ring can’t help: the call is locked, the invite is full, or it’s over', async () => {
    const org = await account(atVandelay());
    const { host } = await hosting(org);
    await host.lock(true);
    expect(code(await host.ring([THEO]).catch((e: unknown) => e))).toBe('conflict');
    expect(await ringRows()).toBe(0);
    await host.lock(false);

    // A full invite refuses the ring rather than leave someone rung who can't come in. Someone on it can still be rung.
    const guests = [KOFI, ...Array.from({ length: MAX_GUESTS - 1 }, (_, i) => `full-${i}@tests.example`)];
    await host.leave();
    const { host: full } = await hosting(org, { guests });
    expect(code(await full.ring([THEO]).catch((e: unknown) => e))).toBe('invalid');
    expect(await ringRows()).toBe(0);
    await full.ring([KOFI]);
    expect(await ringRows()).toBe(1);
    await full.leave();
    expect(code(await full.ring([KOFI]).catch((e: unknown) => e))).toBe('conflict');
    expect(await ringRows()).toBe(0);
  });

  it('limits how fast an organizer can ring', async () => {
    const org = await account(atVandelay());
    const { host } = await hosting(org, { guests: [THEO] });
    let refused: unknown;
    for (let i = 0; i < 25 && !refused; i++) await host.ring([THEO]).catch((e: unknown) => { refused = e; });
    expect(code(refused)).toBe('unavailable');
    await host.leave();
  });
});

describe('the stream', () => {
  const ringQueries = () => h.logs.filter((l) => l.includes('SELECT owner_id, ring_id, meeting_item_id')).length;

  it('lets go of everything when the browser does: no subscriber, no ticker and no reads left', async () => {
    const theo = await account(THEO);
    const stream = ringsOf(theo);
    await waitFor(() => h.logs.some((l) => l.includes('rings stream opened')), 'the stream to open');
    // While someone listens, it keeps reading, once a second.
    const before = ringQueries();
    await waitFor(() => ringQueries() >= before + 2, 'the ticker to run');
    // But it holds no connection to do it: between reads, every one is back in the pool.
    await waitFor(() => h.pool.totalCount > 0 && h.pool.idleCount === h.pool.totalCount, 'every database connection to be idle');

    const marker = h.logs.length;
    stream.close();
    await waitFor(() => h.logs.slice(marker).some((l) => l.includes('rings stream closed') && l.includes('"listening":0')), 'the stream to be released');
    await sleep(1200);
    const after = ringQueries();
    await sleep(2200);
    expect(ringQueries()).toBe(after);
  });

  it('ends by itself in time and reconnects, and a ring meanwhile still arrives', async () => {
    const second = await h.secondServer({ RING_STREAM_SECONDS: 1 });
    try {
      const org = await account(atVandelay());
      const { browser: b, asked } = routed(() => second.baseUrl);
      await b.api.auth.signIn('sso', { email: LENA });
      const stream = ringsOf(b);
      await waitFor(() => asked.filter((p) => p === '/v1/rings').length >= 3, 'the stream to reconnect twice', 10_000);
      const { host } = await hosting(org);
      await host.ring([LENA]);
      expect((await card(stream)).from.email).toBe(org.session.user.email);
      await host.leave();
    } finally {
      await second.close();
    }
  });

  it('survives its instance going away: the browser opens a stream elsewhere and shows what’s ringing now', async () => {
    const second = await h.secondServer();
    let target = second.baseUrl;
    const org = await account(atVandelay());
    const { browser: b, asked } = routed(() => target);
    await b.api.auth.signIn('sso', { email: SAM });
    const stream = ringsOf(b);
    await waitFor(() => asked.includes('/v1/rings'), 'the stream to open');
    await sleep(100);
    const { host } = await hosting(org, { title: 'After the deploy' });

    // The ring goes out with the stream down: what it shows on reconnecting says so.
    target = h.baseUrl;
    await second.close();
    await host.ring([SAM]);
    expect((await card(stream, 'the stream to reconnect')).title).toBe('After the deploy');
    await host.leave();
  });

  it('shows a ring whatever this browser’s clock says: a ring the server just sent is ringing', async () => {
    const org = await account(atVandelay());
    const theo = await account(THEO);
    const stream = ringsOf(theo);
    await sleep(100);
    const { host } = await hosting(org);
    // Two minutes fast: by this clock the ring ran out before it began. Delivery goes by Postgres's clock, so nothing else moves.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 120_000 });
    try {
      await host.ring([THEO]);
      await card(stream);
      await sleep(200);
      expect(stream.getSnapshot()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
    await host.leave();
  });

  it('drops a ring by itself at its time, with no stream to say so', async () => {
    const second = await h.secondServer();
    const org = await account(atVandelay());
    const { browser: b } = routed(() => second.baseUrl);
    await b.api.auth.signIn('sso', { email: LENA });
    const stream = ringsOf(b);
    const { host } = await hosting(org);
    await host.ring([LENA]);
    const ring = await card(stream);

    // A few seconds left, and then the stream goes for good: nothing can tell this browser it's over.
    await h.pool.query(`UPDATE call_rings SET expires_at = now() + interval '3 seconds' WHERE ring_id = $1`, [ring.id]);
    await waitFor(() => stream.getSnapshot()[0]?.expiresAt !== ring.expiresAt, 'the new time to arrive');
    await second.close();
    expect(stream.getSnapshot()).toHaveLength(1);
    await waitFor(() => stream.getSnapshot().length === 0, 'the ring to drop by itself', 6_000);
    await host.leave();
  });

  it('says something every 20 seconds, so a browser can tell a quiet stream from a dead one', async () => {
    const theo = await account(THEO);
    const stop = new AbortController();
    const asked = Date.now();
    const res = await theo.fetch(`${h.baseUrl}/v1/rings`, { signal: stop.signal });
    // The app and the API are different origins in production, and nothing may keep a copy of this.
    expect(Object.fromEntries(['access-control-allow-origin', 'access-control-allow-credentials', 'content-type', 'cache-control'].map((n) => [n, res.headers.get(n)]))).toEqual({
      'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true', 'content-type': 'application/x-ndjson', 'cache-control': 'no-store'
    });
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no stream');
    const text = new TextDecoder();
    let said = '';
    const reading = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) return; said += text.decode(value, { stream: true }); } })().catch(() => undefined);
    /** Waits by the clock the stand-in one below leaves alone. */
    const until = async (ok: () => boolean, what: string) => {
      for (const by = performance.now() + 15_000; !ok();) { if (performance.now() > by) throw new Error(`timed out waiting for ${what}`); await sleep(20); }
    };
    await until(() => said.endsWith('\n'), 'the first line');
    const heard = Date.now();
    expect(said).toBe('{"rings":[]}\n');
    // Nothing changes, so it says the same again once it's been quiet for 20 seconds by the server's clock. That's this
    // process's clock, moved on here instead of waited out, while the streams' ticker, a real timer, goes round each second.
    const Line = z.object({ msg: z.string(), requestId: z.string().optional(), sql: z.string().optional() });
    /** Rounds the ticker has made since `from`: each reads what's ringing, as no request. */
    const rounds = (from: number) => h.logs.slice(from).filter((l) => {
      const r = Line.safeParse(JSON.parse(l));
      return r.success && r.data.requestId === undefined && r.data.msg.endsWith('query') && (r.data.sql ?? '').startsWith('SELECT owner_id, ring_id');
    }).length;
    try {
      // At most 19 seconds after it said anything: two rounds go by, and it says nothing more.
      vi.useFakeTimers({ toFake: ['Date'], now: asked + 19_000 });
      const from = h.logs.length;
      await until(() => rounds(from) >= 2, 'two rounds of the ticker');
      expect(said).toBe('{"rings":[]}\n');
      // At least 20 seconds after: it says the same again.
      vi.setSystemTime(heard + 20_000);
      await until(() => said.split('\n').length >= 3, 'the same again');
    } finally {
      vi.useRealTimers();
      stop.abort();
      await reading;
    }
    expect(said).toBe('{"rings":[]}\n{"rings":[]}\n');
  });

  it('gives up on a stream that’s gone quiet and opens another, as a laptop waking up must', async () => {
    const org = await account(atVandelay());
    // The first stream answers, then says nothing, ever: a connection that died without saying so.
    const real = cookieFetch(ORIGIN);
    let opened = 0;
    const dead = (signal: AbortSignal | null | undefined) => new Response(new ReadableStream<Uint8Array>({ start: (c) => { signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError'))); } }));
    const f: typeof fetch = (input, init) => (String(input).endsWith('/v1/rings') && ++opened === 1 ? Promise.resolve(dead(init?.signal)) : real(input, init));
    const b = h.browser({ fetch: f, ringSilenceMs: 300 });
    await b.api.auth.signIn('sso', { email: KOFI });
    const stream = ringsOf(b);
    const { host } = await hosting(org, { title: 'After the lid' });
    await host.ring([KOFI]);
    expect((await card(stream, 'the stream to be replaced')).title).toBe('After the lid');
    expect(opened).toBeGreaterThanOrEqual(2);
    await host.leave();
  });

  /** A tab's stream, opened by hand on `server`: its first line read, then watched for the server ending it. */
  async function tab(b: Browser, server: string) {
    const stop = new AbortController();
    const res = await b.fetch(`${server}/v1/rings`, { signal: stop.signal });
    const reader = res.body?.getReader();
    const state = { status: res.status, ended: false, close: () => stop.abort() };
    if (!res.ok || !reader) return state;
    await reader.read();
    const watch = async () => { while (!(await reader.read()).done); state.ended = true; };
    watch().catch(() => undefined);
    return state;
  }

  it('holds eight streams an account: another ends its oldest, and every tab that comes back gets in', async () => {
    const server = await h.secondServer();
    const tabs: Awaited<ReturnType<typeof tab>>[] = [];
    try {
      const a = await account();
      const other = await tab(await account(), server.baseUrl);
      tabs.push(other);
      for (let i = 0; i < 8; i++) tabs.push(await tab(a, server.baseUrl));
      expect(tabs.map((t) => t.status)).toEqual(Array.from({ length: 9 }, () => 200));
      await sleep(100);
      expect(tabs.filter((t) => t.ended)).toEqual([]);

      // A ninth, as a tab coming back before the server heard it went: it gets in, and the oldest of this account's goes.
      tabs.push(await tab(a, server.baseUrl));
      expect(tabs.at(-1)?.status).toBe(200);
      await waitFor(() => tabs[1]?.ended === true, 'the account’s oldest stream to end');
      expect(tabs.filter((t) => t.ended)).toHaveLength(1);
      expect(other.ended).toBe(false);
    } finally {
      for (const t of tabs) t.close();
      await server.close();
    }
  });

  it('holds 300 streams a process, leaving room for calls: past that only someone with a stream to give up gets in', async () => {
    const server = await h.secondServer();
    const tabs: Awaited<ReturnType<typeof tab>>[] = [];
    try {
      // 37 accounts with eight tabs each and one with four: every stream this process holds.
      const accounts = await Promise.all(Array.from({ length: 38 }, () => account()));
      await Promise.all(accounts.map(async (a, i) => { for (let n = 0; n < (i === 37 ? 4 : 8); n++) tabs.push(await tab(a, server.baseUrl)); }));
      expect(tabs.map((t) => t.status)).toEqual(Array.from({ length: 300 }, () => 200));

      // Someone with none is told to try again, and their browser does.
      const newcomer = await tab(await account(), server.baseUrl);
      tabs.push(newcomer);
      expect(newcomer.status).toBe(503);
      expect(tabs.filter((t) => t.ended)).toEqual([]);

      // A tab coming back still gets in, on what its account already holds.
      const last = accounts.at(-1);
      if (!last) throw new Error('no accounts');
      const back = await tab(last, server.baseUrl);
      tabs.push(back);
      expect(back.status).toBe(200);
      await waitFor(() => tabs.filter((t) => t.ended).length === 1, 'that account’s oldest stream to end');

      // The room a closed tab leaves is anyone's.
      const gone = tabs.find((t) => !t.ended && t.status === 200);
      gone?.close();
      const fresh = await account();
      await waitFor(async () => { await sleep(200); const t = await tab(fresh, server.baseUrl); tabs.push(t); return t.status === 200; }, 'room for someone new');
    } finally {
      for (const t of tabs) t.close();
      await server.close();
    }
  }, 60_000);

  it('asks who you are first', async () => {
    expect((await fetch(`${h.baseUrl}/v1/rings`)).status).toBe(401);
  });

  it('ends a process’s streams as it shuts down, so nothing holds the shutdown up', async () => {
    const stopping = new AbortController();
    const second = await h.secondServer({}, stopping.signal);
    const { browser: b, asked } = routed(() => second.baseUrl);
    await b.api.auth.signIn('sso', { email: KOFI });
    // Held by the process, not only asked for: shutting down ends the streams it holds.
    const marker = h.logs.length;
    const stream = ringsOf(b);
    await waitFor(() => h.logs.slice(marker).some((l) => l.includes('rings stream opened')), 'the stream to open');
    const opened = asked.filter((p) => p === '/v1/rings').length;
    stopping.abort();
    await waitFor(() => asked.filter((p) => p === '/v1/rings').length > opened, 'the browser to reconnect');
    stream.close();
    await second.close();
  });

  it('stops delivering to a browser signed out, within what it would have shown', async () => {
    const org = await account(atVandelay());
    const theo = await account(THEO);
    // A tab left open: signing out in another leaves its stream open until something new would reach it.
    const marker = h.logs.length;
    const tab = ringsOf(theo);
    await waitFor(() => h.logs.slice(marker).some((l) => l.includes('rings stream opened')), 'the stream to open');
    await theo.api.auth.signOut();
    const { host } = await hosting(org, { title: 'After sign-out' });
    await host.ring([THEO]);
    await waitFor(() => h.logs.slice(marker).some((l) => l.includes('rings stream closed')), 'the stream to end');
    expect(tab.getSnapshot()).toEqual([]);
    await host.leave();
  });
});

describe('privacy', () => {
  it('keeps a ring sealed: no title, address or answer in its row or any log line', async () => {
    const domain = aDomain();
    const org = await account(unique('lead', domain));
    const email = unique('canary-rung', domain);
    const canaryRung = await account(email);
    const stream = ringsOf(canaryRung);
    const { host } = await hosting(org, { title: 'CANARY-RING-TITLE secret', guests: [email] });
    await host.ring([email]);
    const ring = await card(stream);
    expect(ring.title).toBe('CANARY-RING-TITLE secret');

    const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
    const dump = async () => String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM call_rings x`)).rows[0]?.all ?? '');
    const sealed = await dump();
    await canaryRung.api.rings.answer(ring.id, 'in-5');
    const answered = await dump();
    expect(sealed).not.toBe('');
    expect(answered).not.toBe(sealed);
    const logs = h.logs.join('');
    for (const canary of ['CANARY-RING-TITLE', email, 'canary-rung', org.session.user.email]) {
      for (const enc of encodings(canary)) {
        expect(sealed.includes(enc), `${canary} as ${enc} in the row`).toBe(false);
        expect(answered.includes(enc), `${canary} as ${enc} in the answered row`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in the logs`).toBe(false);
      }
    }
    // The logger scrubs any address it's given, so a line that tried to log one shows only as the mark it leaves.
    expect(h.logs.filter((l) => l.includes('"component":"rings"') && l.includes('[email]'))).toEqual([]);
    // The answer isn't in the logs either: it's sealed for a reason. Nor does a receipt say this account was rung.
    expect(logs.includes('"in-5"')).toBe(false);
    expect((await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM operations WHERE method LIKE '%rings%'")).rows[0]?.n).toBe(0);

    // A sealed ring is bound to its row: copied to another, it doesn't open.
    const other = unique('other', domain);
    await account(other);
    await host.leave();
    const { host: next } = await hosting(org, { guests: [email, other] });
    await next.ring([email, other]);
    await h.pool.query(`UPDATE call_rings a SET ring_ciphertext = b.ring_ciphertext FROM call_rings b WHERE a.ring_id <> b.ring_id`);
    expect(code(await next.refresh().then(() => next.ring([email])).catch((e: unknown) => e))).toBe('key-unavailable');
    await h.pool.query('DELETE FROM call_rings');
    await next.leave();
  });
});
