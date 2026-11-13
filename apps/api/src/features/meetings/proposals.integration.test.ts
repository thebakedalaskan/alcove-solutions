/**
 * What people invited say back to a call's organizer: whether each of them is coming, which only the organizer sees
 * person by person, and asking to move the call to another time, which the organizer answers with Move it or Keep. The
 * real API over HTTP via @alcove/api-http, real Postgres, and the stand-in Google, whose calendar tells everyone when a
 * call moves.
 */
import { AlcoveApiError, OPERATION_HEADER, type Meeting, type MeetingInput } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { tx } from '../../db';
import { openOwner } from '../../owners';
import { connectGoogleCalendar, ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { findItem, saveRevision } from '../../vault';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => { vi.useRealTimers(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const refusal = (p: Promise<unknown>) => p.then(() => 'went through', code);
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh demo account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email: r.session.user.email };
}
/** A real account, signed in with (the stand-in) Google, with its calendar connected. */
async function googleAccount(name: string) {
  const b = h.browser();
  const n = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  const who = { sub: `google-${n}`, email: `${name.toLowerCase()}.${n}@example.com`, name };
  h.google.next(who);
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  expect(await connectGoogleCalendar(h, b, who)).toBe(`${ORIGIN}/settings?calendar=connected#calendar`);
  return { ...b, session, sub: who.sub, email: session.user.email };
}
/** On the hour, `days` from now, so a time moved to reads plainly. */
const at = (days: number, hour: number) => { const d = new Date(Date.now() + days * 86_400_000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const call = (title: string, guests: string[], more: Partial<MeetingInput> = {}): MeetingInput => ({ title, startsAt: at(2, 10), durationMinutes: 45, guests, notes: 'off', ...more });
const listed = (ms: Meeting[], id: string) => ms.find((m) => m.id === id);
const nobody = { yes: 0, maybe: 0, no: 0, waiting: 0 };
/** Rewrites a call's stored manifest, as a call that's under way leaves it. */
async function stored(ownerId: string, meetingId: string, change: (m: Record<string, unknown>) => Record<string, unknown>) {
  const o = await openOwner(h.deps, ownerId, undefined);
  await tx(h.pool, async (c) => {
    const head = await findItem(o, c, 'meeting', meetingId, z.looseObject({}));
    if (!head) throw new Error('that call isn’t stored');
    await saveRevision(o, c, meetingId, head.revisionId, change(head.manifest));
  });
}

describe('what each person invited answered', () => {
  it('is the organizer’s to see, person by person; everyone else sees how many, and their own', async () => {
    const org = await account();
    const [lena, kofi] = [await account(), await account()];
    const sam = unique('sam');
    const m = await org.api.meetings.create(call('Hiring sync', [lena.email, kofi.email, sam]));
    expect(m.answers).toEqual([{ email: lena.email, answer: null }, { email: kofi.email, answer: null }, { email: sam, answer: null }]);

    await lena.api.meetings.answer(m.id, 'yes');
    await kofi.api.meetings.answer(m.id, 'no');
    const answers = [{ email: lena.email, answer: 'yes' }, { email: kofi.email, answer: 'no' }, { email: sam, answer: null }];
    expect((await org.api.meetings.get(m.id)).answers).toEqual(answers);
    expect(listed(await org.api.meetings.upcoming(), m.id)?.answers).toEqual(answers);

    // Someone invited sees how many, and what they said themselves: not what anyone else did.
    const seen = await lena.api.meetings.get(m.id);
    expect([seen.answers, seen.rsvp, seen.rsvps]).toEqual([undefined, 'yes', { ...nobody, yes: 1, no: 1, waiting: 1 }]);
    const wire = await (await kofi.fetch(`${h.baseUrl}/v1/meetings/${m.id}`)).text();
    expect(wire).not.toContain('"answers"');
    expect(listed(await kofi.api.meetings.upcoming(), m.id)?.answers).toBeUndefined();
  });

  it('take what Google heard for anyone with no answer in Alcove, when the organizer opens the call', async () => {
    const org = await googleAccount('Ines');
    const [aiko, theo] = [unique('aiko'), unique('theo')];
    const m = await org.api.meetings.create(call('Roadmap', [aiko, theo]));
    const event = h.google.calendar(org.sub).find((e) => e.summary === 'Roadmap');
    if (!event) throw new Error('the call isn’t on the calendar');
    event.attendees = [{ email: aiko.toUpperCase(), responseStatus: 'tentative' }, { email: theo, responseStatus: 'needsAction' }];
    const opened = await org.api.meetings.get(m.id);
    expect(opened.answers).toEqual([{ email: aiko, answer: 'maybe' }, { email: theo, answer: null }]);
    expect(opened.rsvps).toEqual({ ...nobody, maybe: 1, waiting: 1 });
    // A list reads Google for nobody.
    expect(listed(await org.api.meetings.upcoming(), m.id)?.answers).toEqual([{ email: aiko, answer: null }, { email: theo, answer: null }]);
  });
});

describe('asking to move a call', () => {
  it('reaches the organizer, who moves it there: the calendar tells everyone, and every request goes with the old time', async () => {
    const org = await googleAccount('Ines');
    // Real accounts, as the organizer's is: a demo sign-in never sees a real organizer's call.
    const [aiko, theo] = [await googleAccount('Aiko'), await googleAccount('Theo')];
    const m = await org.api.meetings.create(call('Hiring sync', [aiko.email, theo.email]));
    const [eleven, noon] = [at(2, 11), at(2, 12)];

    const asked = await aiko.api.meetings.propose(m.id, eleven);
    expect(asked.proposals).toEqual([{ email: aiko.email, startsAt: eleven }]);
    expect(asked.startsAt).toBe(m.startsAt);
    await theo.api.meetings.propose(m.id, noon);
    // The organizer sees everyone's, on the call and in the list; someone invited sees only their own.
    const both = [{ email: aiko.email, startsAt: eleven }, { email: theo.email, startsAt: noon }];
    expect((await org.api.meetings.get(m.id)).proposals).toEqual(both);
    expect(listed(await org.api.meetings.upcoming(), m.id)?.proposals).toEqual(both);
    expect((await theo.api.meetings.get(m.id)).proposals).toEqual([{ email: theo.email, startsAt: noon }]);
    expect(listed(await aiko.api.meetings.upcoming(), m.id)?.proposals).toEqual([{ email: aiko.email, startsAt: eleven }]);
    // Asking tells nobody through Google: only the organizer hears, here.
    const mailed = h.google.mail.length;

    const moved = await org.api.meetings.answerProposal(m.id, aiko.email, 'move');
    expect([moved.startsAt, moved.endsAt]).toEqual([eleven, new Date(Date.parse(eleven) + 45 * 60_000).toISOString()]);
    expect(moved.proposals).toEqual([]);
    const event = h.google.calendar(org.sub).find((e) => e.summary === 'Hiring sync');
    expect(event?.start?.dateTime).toBe(eleven);
    expect(h.google.mail.slice(mailed).map((x) => [x.kind, x.to.length])).toEqual([['update', 2]]);
    expect(await aiko.api.meetings.get(m.id)).toMatchObject({ startsAt: eleven, proposals: [] });
    expect((await theo.api.meetings.get(m.id)).proposals).toEqual([]);
  });

  it('keeps its time when the organizer keeps it, letting go of that request alone', async () => {
    const org = await account();
    const [aiko, theo] = [await account(), await account()];
    const m = await org.api.meetings.create(call('Design crit', [aiko.email, theo.email]));
    await aiko.api.meetings.propose(m.id, at(3, 9));
    await theo.api.meetings.propose(m.id, at(3, 16));
    const kept = await org.api.meetings.answerProposal(m.id, aiko.email, 'keep');
    expect([kept.startsAt, kept.proposals]).toEqual([m.startsAt, [{ email: theo.email, startsAt: at(3, 16) }]]);
    expect((await aiko.api.meetings.get(m.id)).proposals).toEqual([]);
    // Answered, it's gone: answering it again finds nothing.
    expect(await refusal(org.api.meetings.answerProposal(m.id, aiko.email, 'move'))).toBe('not-found');
  });

  it('asks again to change what was asked; the organizer changing the time lets go of every request; taken off, yours goes', async () => {
    const org = await account();
    const [aiko, theo] = [await account(), await account()];
    const m = await org.api.meetings.create(call('Pricing', [aiko.email, theo.email]));
    await aiko.api.meetings.propose(m.id, at(3, 9));
    expect((await aiko.api.meetings.propose(m.id, at(3, 15))).proposals).toEqual([{ email: aiko.email, startsAt: at(3, 15) }]);
    expect((await org.api.meetings.get(m.id)).proposals).toEqual([{ email: aiko.email, startsAt: at(3, 15) }]);

    // A change that doesn't move it keeps them; moving it lets them all go.
    expect((await org.api.meetings.update(m.id, { title: 'Pricing, again', durationMinutes: 30 })).proposals).toHaveLength(1);
    expect((await org.api.meetings.update(m.id, { startsAt: at(4, 13) })).proposals).toEqual([]);

    await theo.api.meetings.propose(m.id, at(4, 14));
    await org.api.meetings.update(m.id, { guests: [aiko.email] });
    expect((await org.api.meetings.get(m.id)).proposals).toEqual([]);
    await org.api.meetings.update(m.id, { guests: [aiko.email, theo.email] });
    expect((await theo.api.meetings.get(m.id)).proposals).toEqual([]);
  });

  it('lets go of the requests of the calls a change to this and later ones moves', async () => {
    const org = await account();
    const aiko = await account();
    const zone = 'UTC';
    const first = at(2, 9);
    const weekOn = (n: number) => new Date(Date.parse(first) + n * 7 * 86_400_000).toISOString();
    const day = new Date(first).getUTCDay();
    const repeat = (from: string, n: number) => ({ rule: { every: 'week' as const, weeks: 1 as const, days: [day] }, until: new Date(Date.parse(from) + (n - 1) * 7 * 86_400_000).toISOString().slice(0, 10), timeZone: zone, occurrences: Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 7 * 86_400_000).toISOString()) });
    const s = await org.api.meetings.create(call('Standup', [aiko.email], { startsAt: first, repeat: repeat(first, 3) }));
    const calls = (await org.api.meetings.upcoming()).filter((x) => x.seriesId === s.seriesId);
    const [, second] = calls;
    if (!second) throw new Error('the series has no second call');
    await aiko.api.meetings.propose(s.id, at(2, 11));
    await aiko.api.meetings.propose(second.id, new Date(Date.parse(weekOn(1)) + 3_600_000).toISOString());
    // This call and later ones move an hour: their requests go, and only theirs.
    const later = new Date(Date.parse(second.startsAt) + 3_600_000).toISOString();
    await org.api.meetings.update(second.id, { startsAt: later, repeat: repeat(later, 2) }, { scope: 'following' });
    expect((await org.api.meetings.get(second.id)).proposals).toEqual([]);
    expect((await org.api.meetings.get(s.id)).proposals).toEqual([{ email: aiko.email, startsAt: at(2, 11) }]);
  });

  it('refuses a time gone, the time it has, a call waiting for a pick, and one that has started', async () => {
    const org = await account();
    const aiko = await account();
    const m = await org.api.meetings.create(call('Board prep', [aiko.email]));
    expect(await refusal(aiko.api.meetings.propose(m.id, new Date(Date.now() - 60_000).toISOString()))).toBe('invalid');
    expect(await refusal(aiko.api.meetings.propose(m.id, m.startsAt))).toBe('invalid');
    expect(await refusal(aiko.api.meetings.propose(m.id, 'tomorrow'))).toBe('invalid');
    const offered = await org.api.meetings.create(call('Pick one', [aiko.email], { offer: [at(3, 10), at(4, 10)] }));
    expect(await refusal(aiko.api.meetings.propose(offered.id, at(5, 10)))).toBe('conflict');
    const live = await org.api.meetings.create(call('Under way', [aiko.email]));
    await stored(org.session.ownerId, live.id, (x) => ({ ...x, status: 'live' }));
    expect(await refusal(aiko.api.meetings.propose(live.id, at(5, 11)))).toBe('conflict');
    // A request whose time passes before the organizer answers can't move the call into the past.
    await aiko.api.meetings.propose(m.id, at(3, 11));
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(at(3, 12)) });
    expect(await refusal(org.api.meetings.answerProposal(m.id, aiko.email, 'move'))).toBe('conflict');
    vi.useRealTimers();
    expect((await org.api.meetings.get(m.id)).startsAt).toBe(m.startsAt);
  });

  it('reaches only the organizer: anyone else, and a request nobody made, finds a call that doesn’t exist', async () => {
    const org = await account();
    const aiko = await account();
    const stranger = await account();
    const m = await org.api.meetings.create(call('Acquisition', [aiko.email]));
    await aiko.api.meetings.propose(m.id, at(3, 11));
    // Asking: only someone invited, never the organizer of their own call, nor anyone else.
    for (const who of [stranger, org]) expect(await refusal(who.api.meetings.propose(m.id, at(3, 12)))).toBe('not-found');
    expect(await refusal(stranger.api.meetings.propose('no-such-meeting', at(3, 12)))).toBe('not-found');
    // Answering: only the organizer, for a request that was made.
    for (const who of [stranger, aiko]) expect(await refusal(who.api.meetings.answerProposal(m.id, aiko.email, 'move'))).toBe('not-found');
    expect(await refusal(org.api.meetings.answerProposal(m.id, stranger.email, 'keep'))).toBe('not-found');
    expect(await refusal(stranger.api.meetings.answerProposal('no-such-meeting', aiko.email, 'keep'))).toBe('not-found');
    // Another organizer's call of the same ID shape is nobody's but its own.
    const theirs = await stranger.api.meetings.create(call('Theirs', [aiko.email]));
    expect(await refusal(org.api.meetings.answerProposal(theirs.id, aiko.email, 'keep'))).toBe('not-found');
    expect(await org.api.meetings.get(m.id)).toMatchObject({ startsAt: m.startsAt, proposals: [{ email: aiko.email, startsAt: at(3, 11) }] });
  });

  it('is sealed in the asker’s row: nothing shows when, every request is the same length, and it opens only where it was written', async () => {
    const org = await account();
    const [aiko, theo] = [await account(), await account()];
    const m = await org.api.meetings.create(call('Canary request', [aiko.email, theo.email]));
    const [nine, four] = [at(3, 9), at(3, 16)];
    await aiko.api.meetings.propose(m.id, nine);
    await theo.api.meetings.propose(m.id, four);
    const { rows } = await h.pool.query<{ email_index: Buffer; proposal_ciphertext: Buffer }>('SELECT email_index, proposal_ciphertext FROM meeting_access WHERE meeting_item_id = $1', [m.id]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.proposal_ciphertext.length)).size).toBe(1);
    for (const r of rows) {
      const record = z.object({ header: z.record(z.string(), z.unknown()) }).parse(JSON.parse(r.proposal_ciphertext.toString('utf8')));
      expect(record.header).toEqual({ v: 1, kind: 'meeting-proposal', ownerId: org.session.ownerId, meetingId: m.id, emailIndex: r.email_index.toString('base64url') });
      for (const t of [nine, four, nine.slice(0, 16), four.slice(0, 16)]) {
        for (const enc of [t, Buffer.from(t).toString('hex'), Buffer.from(t).toString('base64')]) expect(r.proposal_ciphertext.toString('utf8')).not.toContain(enc);
      }
    }
    // Moved to someone else's row, a request doesn't open.
    const [a, b] = rows;
    if (!a || !b) throw new Error('two rows are needed');
    await h.pool.query('UPDATE meeting_access SET proposal_ciphertext = $3 WHERE meeting_item_id = $1 AND email_index = $2', [m.id, a.email_index, b.proposal_ciphertext]);
    expect(await refusal(org.api.meetings.get(m.id))).toBe('key-unavailable');
    await h.pool.query('UPDATE meeting_access SET proposal_ciphertext = $3 WHERE meeting_item_id = $1 AND email_index = $2', [m.id, a.email_index, a.proposal_ciphertext]);
    expect((await org.api.meetings.get(m.id)).proposals).toHaveLength(2);
    // The log says a request was made, and never when for.
    const logs = h.logs.join('');
    for (const t of [nine, four]) expect(logs).not.toContain(t);
  });

  it('goes with the account that asked, unless another account signs in with its address', async () => {
    const org = await account();
    const aiko = await account();
    const m = await org.api.meetings.create(call('Goodbye', [aiko.email]));
    await aiko.api.meetings.answer(m.id, 'maybe');
    await aiko.api.meetings.propose(m.id, at(3, 11));
    await aiko.api.account.delete();
    expect(await org.api.meetings.get(m.id)).toMatchObject({ answers: [{ email: aiko.email, answer: null }], proposals: [] });
    expect((await h.pool.query('SELECT 1 FROM meeting_access WHERE meeting_item_id = $1 AND (answer_ciphertext IS NOT NULL OR proposal_ciphertext IS NOT NULL)', [m.id])).rowCount).toBe(0);
  });

  it('keeps no copy of the call by asking; answering keeps the organizer’s receipt, like any change', async () => {
    const org = await account();
    const aiko = await account();
    const m = await org.api.meetings.create(call('Receipt canary', [aiko.email]));
    const op = () => randomBytes(16).toString('base64url');
    const asking = op();
    const ask = () => aiko.fetch(`${h.baseUrl}/v1/meetings/${m.id}/propose`, { method: 'POST', headers: { 'content-type': 'application/json', [OPERATION_HEADER]: asking }, body: JSON.stringify({ startsAt: at(3, 11) }) });
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(200);
    expect((await h.pool.query('SELECT 1 FROM operations WHERE owner_id = $1', [aiko.session.ownerId])).rowCount).toBe(0);

    const answering = op();
    const answer = () => org.fetch(`${h.baseUrl}/v1/meetings/${m.id}/proposals/answer`, { method: 'POST', headers: { 'content-type': 'application/json', [OPERATION_HEADER]: answering }, body: JSON.stringify({ email: aiko.email, answer: 'move' }) });
    const first = await answer();
    expect(first.status).toBe(200);
    // A retry is answered from the receipt: the call isn't moved twice, and the request it answered is gone.
    const again = await answer();
    expect(again.status).toBe(200);
    expect(z.object({ startsAt: z.string() }).parse(await again.json()).startsAt).toBe(at(3, 11));
    expect((await h.pool.query('SELECT 1 FROM operations WHERE owner_id = $1', [org.session.ownerId])).rowCount).toBeGreaterThan(0);
  });
});
