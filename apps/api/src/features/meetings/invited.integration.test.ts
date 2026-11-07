/**
 * People invited to a call, from their own accounts: what they see of it, answering, and how that reaches its
 * organizer. Calls started now, which nobody sees until someone is in them. Calls that offer times, until someone with
 * the link picks one. The real API over HTTP via @alcove/api-http, real Postgres and the local LiveKit server.
 */
import { AlcoveApiError, OPERATION_HEADER, type CallSession, type CallState, type Meeting, type MeetingInput } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { tx } from '../../db';
import { openOwner } from '../../owners';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';
import { findItem, saveRevision } from '../../vault';

// Calls go through the real LiveKit server; every wait below is bounded and says what it was waiting for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { vi.useRealTimers(); h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const refusal = (p: Promise<unknown>) => p.then(() => 'went through', code);
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh demo account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
/** A real account, signed in with (the stand-in) Google, with its calendar connected. */
async function googleAccount(name: string, address?: string | undefined) {
  const b = h.browser();
  const n = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  const sub = `google-${n}`;
  h.google.next({ sub, email: address ?? `${name.toLowerCase()}.${n}@example.com`, name });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  return { ...b, session, sub };
}
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const call = (title: string, guests: string[], more: Partial<MeetingInput> = {}): MeetingInput => ({ title, startsAt: inDays(1), durationMinutes: 30, guests, notes: 'off', ...more });
const listed = (ms: Meeting[], id: string) => ms.find((m) => m.id === id);
const invites = async (meetingId: string) => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM meeting_access WHERE meeting_item_id = $1', [meetingId])).rows[0]?.n;
const nobody = { yes: 0, maybe: 0, no: 0, waiting: 0 };
/** Rewrites a call's stored manifest, as an earlier release (or a later task's field) left it. */
async function stored(ownerId: string, meetingId: string, change: (m: Record<string, unknown>) => Record<string, unknown>) {
  const o = await openOwner(h.deps, ownerId, undefined);
  await tx(h.pool, async (c) => {
    const head = await findItem(o, c, 'meeting', meetingId, z.looseObject({}));
    if (!head) throw new Error('that call isn’t stored');
    await saveRevision(o, c, meetingId, head.revisionId, change(head.manifest));
  });
}
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function settle(session: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(session.getSnapshot()); i++) { await session.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return session.getSnapshot();
}
const inGroup = (session: CallSession) => waitFor(() => session.crypto.getSnapshot().status === 'in' && session.crypto.getSnapshot().media !== null, `${session.ticket.role} in the call’s group`);

describe('people invited to a call', () => {
  it('see it on their own account and answer, the organizer’s counts change, and once they’re taken off it’s gone', async () => {
    const org = await account();
    const [lena, kofi] = [unique('lena'), unique('kofi')];
    const m = await org.api.meetings.create(call('Pricing review', [lena, kofi], { notes: 'on' }));
    expect([m.isOrganizer, m.rsvp, m.rsvps]).toEqual([true, null, { ...nobody, waiting: 2 }]);

    // Lena signs in for the first time, after being invited: nothing else put the call on her account.
    const guest = await account(lena);
    const seen = listed(await guest.api.meetings.upcoming(), m.id);
    expect(seen).toMatchObject({
      title: 'Pricing review', isOrganizer: false, organizer: { id: org.session.ownerId, name: org.session.user.name }, code: m.code, status: 'scheduled', notes: 'on',
      guestCount: 2, rsvp: null, rsvps: { ...nobody, waiting: 2 }
    });
    expect(seen?.guests.map((g) => g.email)).toEqual([lena, kofi]);
    expect(await guest.api.meetings.get(m.id)).toEqual(seen);

    const yes = await guest.api.meetings.answer(m.id, 'yes');
    expect([yes.isOrganizer, yes.rsvp, yes.rsvps]).toEqual([false, 'yes', { ...nobody, yes: 1, waiting: 1 }]);
    expect((await org.api.meetings.get(m.id)).rsvps).toEqual({ ...nobody, yes: 1, waiting: 1 });
    expect(listed(await org.api.meetings.upcoming(), m.id)).toMatchObject({ rsvp: null, rsvps: { ...nobody, yes: 1, waiting: 1 } });
    // Answering again is a change of mind, not a second answer.
    await guest.api.meetings.answer(m.id, 'maybe');
    expect((await org.api.meetings.get(m.id)).rsvps).toEqual({ ...nobody, maybe: 1, waiting: 1 });

    // Changes reach them, and people who stay keep their answers when the invite changes.
    const third = unique('third');
    await org.api.meetings.update(m.id, { title: 'Pricing, again', guests: [lena, kofi, third] });
    expect(await guest.api.meetings.get(m.id)).toMatchObject({ title: 'Pricing, again', guestCount: 3, rsvp: 'maybe', rsvps: { ...nobody, maybe: 1, waiting: 2 } });

    // Taken off: the call and their answer go, and it's as if it never was.
    await org.api.meetings.update(m.id, { guests: [kofi, third] });
    expect(listed(await guest.api.meetings.upcoming(), m.id)).toBeUndefined();
    expect(await refusal(guest.api.meetings.get(m.id))).toBe('not-found');
    expect(await refusal(guest.api.meetings.answer(m.id, 'yes'))).toBe('not-found');
    expect((await org.api.meetings.get(m.id)).rsvps).toEqual({ ...nobody, waiting: 2 });
    // Put back, they start again.
    await org.api.meetings.update(m.id, { guests: [lena, kofi, third] });
    expect((await guest.api.meetings.get(m.id)).rsvp).toBeNull();

    await org.api.meetings.cancel(m.id);
    expect(await invites(m.id)).toBe(0);
    expect(await refusal(guest.api.meetings.get(m.id))).toBe('not-found');
  });

  it('see them among their own calls, soonest first', async () => {
    const org = await account();
    const guest = await account();
    const email = guest.session.user.email;
    const last = await org.api.meetings.create(call('Third', [email], { startsAt: inDays(30) }));
    const first = await org.api.meetings.create(call('First', [email], { startsAt: inDays(28) }));
    const mine = await guest.api.meetings.create(call('Second', [], { startsAt: inDays(29) }));
    const ids = [first.id, mine.id, last.id];
    expect((await guest.api.meetings.upcoming()).map((m) => m.id).filter((id) => ids.includes(id))).toEqual(ids);
  });

  it('keep no copy of the call by answering: a retry once it’s cancelled finds nothing', async () => {
    const org = await account();
    const guest = await account();
    const m = await org.api.meetings.create(call('Receipt canary', [guest.session.user.email]));
    const op = randomBytes(16).toString('base64url');
    const send = () => guest.fetch(`${h.baseUrl}/v1/meetings/${m.id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json', [OPERATION_HEADER]: op }, body: JSON.stringify({ answer: 'yes' }) });
    const answered = await send();
    expect(answered.status).toBe(200);
    expect(await answered.text()).toContain('Receipt canary');
    // It sets what it says, so a retry changes nothing.
    expect((await send()).status).toBe(200);
    expect((await org.api.meetings.get(m.id)).rsvps).toEqual({ ...nobody, yes: 1 });

    await org.api.meetings.cancel(m.id);
    const retried = await send();
    expect(retried.status).toBe(404);
    expect(await retried.text()).not.toContain('Receipt canary');
    expect((await h.pool.query('SELECT 1 FROM operations WHERE owner_id = $1', [guest.session.ownerId])).rowCount).toBe(0);
  });

  it('see names up to 25 people invited, and past that only how many', async () => {
    const org = await account();
    const guest = await account();
    const others = Array.from({ length: 24 }, (_, i) => unique(`g${i}`));
    const m = await org.api.meetings.create(call('All hands', [guest.session.user.email, ...others]));
    const small = await guest.api.meetings.get(m.id);
    expect([small.guests.length, small.guestCount]).toEqual([25, 25]);

    const one = unique('one-more');
    await org.api.meetings.update(m.id, { guests: [guest.session.user.email, ...others, one] });
    const big = await guest.api.meetings.get(m.id);
    expect([big.guests, big.guestCount, big.rsvps.waiting]).toEqual([[], 26, 26]);
    const wire = JSON.stringify([big, listed(await guest.api.meetings.upcoming(), m.id)]);
    for (const address of [...others, one]) expect(wire).not.toContain(address);
    // The organizer still sees everyone.
    expect((await org.api.meetings.get(m.id)).guests).toHaveLength(26);
  });

  it('can reach only their own invites: everyone else gets what a call that doesn’t exist gets', async () => {
    const org = await account();
    const guest = await account();
    const stranger = await account();
    const m = await org.api.meetings.create(call('Board prep', [guest.session.user.email]));
    const missing = await stranger.api.meetings.get('no-such-meeting').catch((e: unknown) => e);
    expect(code(missing)).toBe('not-found');
    const message = (e: unknown) => (e instanceof Error ? e.message : '');
    for (const attempt of [() => stranger.api.meetings.get(m.id), () => stranger.api.meetings.answer(m.id, 'yes')]) {
      const e = await attempt().catch((x: unknown) => x);
      expect([code(e), message(e)]).toEqual(['not-found', message(missing)]);
    }
    expect(listed(await stranger.api.meetings.upcoming(), m.id)).toBeUndefined();
    // The organizer isn't invited to their own call, so has no answer to give.
    expect(await refusal(org.api.meetings.answer(m.id, 'yes'))).toBe('not-found');
    // Being invited lets someone read a call and answer, and nothing else.
    expect(await refusal(guest.api.meetings.update(m.id, { title: 'Mine now' }))).toBe('not-found');
    expect(await refusal(guest.api.meetings.cancel(m.id))).toBe('not-found');
    expect(await refusal(guest.api.meetings.scheduleNext(m.id, inDays(8)))).toBe('not-found');
    expect(await guest.api.meetings.byCode(m.code)).toBeNull();
    expect((await org.api.meetings.get(m.id)).title).toBe('Board prep');
  });

  it('see a real organizer’s call only from a real account: nothing checks a demo sign-in’s address', async () => {
    const org = await googleAccount('Bram');
    const real = await googleAccount('Ana');
    const demoAddress = unique('demo');
    const m = await org.api.meetings.create(call('Acquisition', [real.session.user.email, demoAddress]));
    const demo = await account(demoAddress);
    expect(listed(await demo.api.meetings.upcoming(), m.id)).toBeUndefined();
    expect(await refusal(demo.api.meetings.get(m.id))).toBe('not-found');
    expect(await refusal(demo.api.meetings.answer(m.id, 'yes'))).toBe('not-found');
    expect((await org.api.meetings.get(m.id)).rsvps.yes).toBe(0);
    expect(listed(await real.api.meetings.upcoming(), m.id)?.isOrganizer).toBe(false);
    // Nobody checked who a demo organizer is, so what they write stays off a real account's Home. Demo accounts see each other's.
    const demoCall = await demo.api.meetings.create(call('Demo day', [real.session.user.email, unique('colleague')]));
    expect(listed(await real.api.meetings.upcoming(), demoCall.id)).toBeUndefined();
    expect(await refusal(real.api.meetings.get(demoCall.id))).toBe('not-found');
    const colleague = await account(demoCall.guests.find((g) => g.email !== real.session.user.email)?.email ?? '');
    expect(listed(await colleague.api.meetings.upcoming(), demoCall.id)?.isOrganizer).toBe(false);
  });

  it('don’t get what’s only the organizer’s: the note, the calendar link, or a series link their invitation didn’t carry', async () => {
    const org = await googleAccount('Bram');
    const guest = await googleAccount('Ana');
    const m = await org.api.meetings.create(call('Quarterly', [guest.session.user.email], { notes: 'on' }));
    expect(m.calendarUrl).toMatch(/^https:/);
    const onCalendar = await guest.api.meetings.get(m.id);
    expect(onCalendar).not.toHaveProperty('calendarUrl');
    // The call happens with notes and is started again, so it has a note and is on again for everyone invited.
    await (await org.api.calls.join(m.code, { mic: true, cam: false })).leave();
    await org.api.calls.join(m.code, { mic: true, cam: false });
    expect((await org.api.meetings.get(m.id)).noteId).toBeTruthy();
    const live = await guest.api.meetings.get(m.id);
    expect(live.status).toBe('live');
    expect(live).not.toHaveProperty('noteId');

    // A series' link is on the calendar invitation, so someone invited has it: without one, they don't get it from here.
    await stored(org.session.ownerId, m.id, (x) => ({ ...x, seriesCode: 'abc-defg-hij' }));
    expect((await org.api.meetings.get(m.id)).seriesCode).toBe('abc-defg-hij');
    expect((await guest.api.meetings.get(m.id)).seriesCode).toBe('abc-defg-hij');
    await stored(org.session.ownerId, m.id, ({ calendarEvent: _event, ...x }) => x);
    expect(await guest.api.meetings.get(m.id)).not.toHaveProperty('seriesCode');
  });

  it('lose a call once it ends or its time is well past', async () => {
    const org = await account();
    const guest = await account();
    const email = guest.session.user.email;
    const held = await org.api.meetings.create(call('Held', [email]));
    await (await org.api.calls.join(held.code, { mic: true, cam: false })).leave();
    expect(listed(await guest.api.meetings.upcoming(), held.id)).toBeUndefined();
    expect(await refusal(guest.api.meetings.get(held.id))).toBe('not-found');
    expect(await refusal(guest.api.meetings.answer(held.id, 'yes'))).toBe('not-found');

    // Never held, and an hour past its time: Upcoming lets it go, for everyone.
    const missed = await org.api.meetings.create(call('Missed', [email], { startsAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }));
    expect(await invites(missed.id)).toBe(1);
    expect(await refusal(guest.api.meetings.get(missed.id))).toBe('not-found');
    expect(await invites(missed.id)).toBe(0);
    // Moved to next week it's on again, and everyone's invited again.
    await org.api.meetings.update(missed.id, { startsAt: inDays(7) });
    expect(listed(await guest.api.meetings.upcoming(), missed.id)?.rsvp).toBeNull();
  });

  it('leave no row behind when a call ends, for an address with no account too, and are back if the organizer starts it again', async () => {
    const org = await account();
    const meeting = await org.api.meetings.create(call('Held', [unique('no-account')]));
    expect(await invites(meeting.id)).toBe(1);
    await (await org.api.calls.join(meeting.code, { mic: true, cam: false })).leave();
    expect(await invites(meeting.id)).toBe(0);
    // Reopened, it's a call people are invited to, for as long as it's on.
    const again = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    expect(await invites(meeting.id)).toBe(1);
    await again.leave();
    expect(await invites(meeting.id)).toBe(0);
  });

  it('leave no row behind once the organizer’s own read finds a call past its time, with nobody’s account to read it', async () => {
    const org = await account();
    const nobody = unique('no-account');
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const missed = await org.api.meetings.create(call('Missed', [nobody], { startsAt: threeHoursAgo }));
    const soon = await org.api.meetings.create(call('Soon', [nobody]));
    // One running well over is past its time too, and its invite goes when it ends, as any call's does.
    const running = await org.api.meetings.create(call('Running over', [nobody], { startsAt: threeHoursAgo }));
    const session = await org.api.calls.join(running.code, { mic: true, cam: false });
    expect(await invites(missed.id)).toBe(1);

    expect(listed(await org.api.meetings.upcoming(), missed.id)).toBeUndefined();
    expect(await invites(missed.id)).toBe(0);
    expect(await invites(soon.id)).toBe(1);
    expect(await invites(running.id)).toBe(1);
    await session.leave();
    expect(await invites(running.id)).toBe(0);

    // Moved to next week it's on again, and everyone's invited again.
    await org.api.meetings.update(missed.id, { startsAt: inDays(7) });
    expect(await invites(missed.id)).toBe(1);
  });

  it('are read together: a list of many calls from one organizer takes no more reads than a list of one', async () => {
    const org = await account();
    const few = await account();
    const many = await account();
    await org.api.meetings.create(call('Only one', [few.session.user.email]));
    for (let i = 0; i < 12; i++) await org.api.meetings.create(call(`Call ${i}`, [many.session.user.email]));
    /** The reads of stored items it takes for someone to see their calls. */
    const reads = async (who: Awaited<ReturnType<typeof account>>, calls: number) => {
      const mark = h.logs.length;
      expect((await who.api.meetings.upcoming()).filter((m) => !m.isOrganizer)).toHaveLength(calls);
      return h.logs.slice(mark).filter((l) => l.includes('"msg":"query"') && l.includes('SELECT i.item_id')).length;
    };
    expect(await reads(many, 12)).toBe(await reads(few, 1));
  });

  it('see what’s coming in the next 90 days, whatever someone else puts further out on their Home', async () => {
    const org = await account();
    const guest = await account();
    const email = guest.session.user.email;
    const near = await org.api.meetings.create(call('Near', [email], { startsAt: inDays(89) }));
    const far = await org.api.meetings.create(call('Far', [email], { startsAt: inDays(91) }));
    const seen = await guest.api.meetings.upcoming();
    expect(listed(seen, near.id)?.title).toBe('Near');
    expect(listed(seen, far.id)).toBeUndefined();
    // It's still theirs to open and answer, and all the organizer's own.
    expect((await guest.api.meetings.get(far.id)).title).toBe('Far');
    await guest.api.meetings.answer(far.id, 'yes');
    expect(listed(await org.api.meetings.upcoming(), far.id)?.rsvps.yes).toBe(1);
  });

  it('reach calls scheduled before this release: the organizer’s next read fills in the invite, and stored calls still open', async () => {
    const org = await account();
    const lena = await account();
    const kofi = unique('kofi');
    const m = await org.api.meetings.create(call('From last week', [lena.session.user.email, kofi]));
    // As the previous release stored it: none of the fields this work added, and no rows.
    await stored(org.session.ownerId, m.id, ({ instant: _i, choices: _c, joinMuted: _j, documents: _d, ...old }) => old);
    await h.pool.query('DELETE FROM meeting_access WHERE meeting_item_id = $1', [m.id]);
    expect(await refusal(lena.api.meetings.get(m.id))).toBe('not-found');

    expect(listed(await org.api.meetings.upcoming(), m.id)).toMatchObject({ instant: false, joinMuted: false, documents: [], choices: { keepTranscript: true, keepRecording: true, allowScreens: true } });
    expect(await invites(m.id)).toBe(2);
    expect(listed(await lena.api.meetings.upcoming(), m.id)?.isOrganizer).toBe(false);
    await lena.api.meetings.answer(m.id, 'no');

    // Rows that drifted from the guests are put right the same way, keeping the answers of people who stayed.
    await h.pool.query(`DELETE FROM meeting_access WHERE meeting_item_id = $1 AND answer_ciphertext IS NULL`, [m.id]);
    expect(listed(await org.api.meetings.upcoming(), m.id)?.rsvps).toEqual({ ...nobody, no: 1, waiting: 1 });
    expect(await invites(m.id)).toBe(2);
  });

  it('keep up with everything that changes who’s invited: the next call in a series, an event moved to Alcove, and people let in from the link', async () => {
    const org = await googleAccount('Bram');
    const invited = await googleAccount('Ana');
    const email = invited.session.user.email;
    const first = await org.api.meetings.create(call('Weekly', [email]));
    const next = await org.api.meetings.scheduleNext(first.id, inDays(8));
    expect(listed(await invited.api.meetings.upcoming(), next.id)).toMatchObject({ isOrganizer: false, seriesId: next.seriesId });

    const start = inDays(2);
    h.google.calendar(org.sub).push({ id: 'moved', summary: 'Moved over', start: { dateTime: start }, end: { dateTime: new Date(Date.parse(start) + 1_800_000).toISOString() }, organizer: { email: org.session.user.email, self: true }, attendees: [{ email }] });
    const moved = await org.api.calendar.adopt('moved', 'off');
    expect(listed(await invited.api.meetings.upcoming(), moved.id)?.title).toBe('Moved over');

    // Someone signed in whom the organizer lets in is on the invite from then on, and taken off when they're removed.
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await googleAccount('Sam');
    const asking = await asker.api.calls.join(c, { mic: true, cam: false });
    await settle(host, (s) => s.waiting.some((w) => w.id === asking.ticket.identity));
    await host.admit(asking.ticket.identity);
    await inGroup(asking);
    const { meetingId } = host.getSnapshot();
    expect(listed(await asker.api.meetings.upcoming(), meetingId)).toMatchObject({ isOrganizer: false, status: 'live' });
    await host.remove(asking.ticket.identity);
    expect(await invites(meetingId)).toBe(0);
    expect(await refusal(asker.api.meetings.get(meetingId))).toBe('not-found');
  });

  it('answer in a sealed row: nothing shows what they said, not even its length, and it opens only where it was written', async () => {
    const org = await account();
    const people = await Promise.all([account(), account(), account()]);
    const m = await org.api.meetings.create(call('Canary answers', people.map((p) => p.session.user.email)));
    const said = ['yes', 'maybe', 'no'] as const;
    await Promise.all(people.map((p, i) => p.api.meetings.answer(m.id, said[i] ?? 'yes')));

    const { rows } = await h.pool.query<{ email_index: Buffer; answer_ciphertext: Buffer }>('SELECT email_index, answer_ciphertext FROM meeting_access WHERE meeting_item_id = $1', [m.id]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.answer_ciphertext.length)).size).toBe(1);
    for (const r of rows) {
      const record = z.object({ header: z.record(z.string(), z.unknown()) }).parse(JSON.parse(r.answer_ciphertext.toString('utf8')));
      expect(record.header).toEqual({ v: 1, kind: 'meeting-answer', ownerId: org.session.ownerId, meetingId: m.id, emailIndex: r.email_index.toString('base64url') });
      expect(r.email_index.toString('hex')).not.toContain(Buffer.from('tests.example').toString('hex'));
      for (const word of said) expect(r.answer_ciphertext.toString('utf8')).not.toContain(`"${word}"`);
    }
    // The hash has its own purpose: a row can't be matched to anyone's account without the master key.
    const { rows: joined } = await h.pool.query('SELECT 1 FROM meeting_access a JOIN identities i ON i.email_index = a.email_index WHERE a.meeting_item_id = $1', [m.id]);
    expect(joined).toEqual([]);

    // Moved to someone else's row, an answer doesn't open.
    const [a, b] = rows;
    if (!a || !b) throw new Error('two rows are needed');
    await h.pool.query('UPDATE meeting_access SET answer_ciphertext = $3 WHERE meeting_item_id = $1 AND email_index = $2', [m.id, a.email_index, b.answer_ciphertext]);
    expect(await refusal(org.api.meetings.get(m.id))).toBe('key-unavailable');
    await h.pool.query('UPDATE meeting_access SET answer_ciphertext = $3 WHERE meeting_item_id = $1 AND email_index = $2', [m.id, a.email_index, a.answer_ciphertext]);
    expect((await org.api.meetings.get(m.id)).rsvps).toEqual({ ...nobody, yes: 1, maybe: 1, no: 1 });
  });

  it('take their answers with them when they delete their account, unless the address has another account', async () => {
    const org = await googleAccount('Bram');
    const guest = await googleAccount('Ana');
    const address = guest.session.user.email;
    const m = await org.api.meetings.create(call('Goodbye', [address]));
    await guest.api.meetings.answer(m.id, 'yes');
    // Someone else signs in with that address too, as a second account can: the answer is theirs as well.
    const twin = await googleAccount('Twin', address);
    await guest.api.account.delete();
    expect((await twin.api.meetings.get(m.id)).rsvp).toBe('yes');
    await twin.api.account.delete();
    // Still on the invite, which is the organizer's, and no longer an answer anyone gave.
    expect(await org.api.meetings.get(m.id)).toMatchObject({ guestCount: 1, rsvps: { ...nobody, waiting: 1 } });
    expect((await h.pool.query('SELECT 1 FROM meeting_access WHERE meeting_item_id = $1 AND answer_ciphertext IS NOT NULL', [m.id])).rowCount).toBe(0);
  });

  it('can’t leave an answer behind by answering as they’re taken off', async () => {
    const org = await account();
    const guest = await account();
    const stays = unique('stays');
    const email = guest.session.user.email;
    for (let i = 0; i < 10; i++) {
      const m = await org.api.meetings.create(call(`Race ${i}`, [email, stays]));
      const [answered] = await Promise.all([refusal(guest.api.meetings.answer(m.id, 'yes')), org.api.meetings.update(m.id, { guests: [stays] })]);
      expect(['went through', 'not-found']).toContain(answered);
      expect((await org.api.meetings.get(m.id)).rsvps).toEqual({ ...nobody, waiting: 1 });
      expect(await invites(m.id)).toBe(1);
    }
  });

  it('are counted from Google too, for anyone with no answer in Alcove, when the organizer opens the call', async () => {
    const org = await googleAccount('Bram');
    const ana = await googleAccount('Ana');
    const [kofi, lena, sam] = [unique('kofi'), unique('lena'), unique('sam')];
    const m = await org.api.meetings.create(call('Roadmap', [ana.session.user.email, kofi, lena, sam]));
    const event = h.google.calendar(org.sub).find((e) => e.summary === 'Roadmap');
    if (!event) throw new Error('the call isn’t on the calendar');
    event.attendees = [
      { email: org.session.user.email, self: true, responseStatus: 'accepted' }, { email: ana.session.user.email, responseStatus: 'accepted' },
      { email: kofi.toUpperCase(), responseStatus: 'declined' }, { email: lena, responseStatus: 'tentative' }, { email: sam, responseStatus: 'needsAction' }, { email: 'not-invited@example.com', responseStatus: 'accepted' }
    ];
    // Ana said yes in Google and no in Alcove: what she said here is what counts.
    await ana.api.meetings.answer(m.id, 'no');
    const counts = { yes: 0, maybe: 1, no: 2, waiting: 1 };
    expect((await org.api.meetings.get(m.id)).rsvps).toEqual(counts);

    // Only then: a list reads Google for nobody, and neither does someone invited.
    const reads = h.google.calls.length;
    const alcoveOnly = { ...nobody, no: 1, waiting: 3 };
    expect(listed(await org.api.meetings.upcoming(), m.id)?.rsvps).toEqual(alcoveOnly);
    expect((await ana.api.meetings.get(m.id)).rsvps).toEqual(alcoveOnly);
    expect(h.google.calls.length).toBe(reads);

    // Google not answering, or the event gone from it, leaves the counts as they are.
    h.google.unresponsive(true);
    try {
      expect((await org.api.meetings.get(m.id)).rsvps).toEqual(alcoveOnly);
    } finally {
      h.google.unresponsive(false);
    }
    h.google.calendar(org.sub).splice(0);
    expect((await org.api.meetings.get(m.id)).rsvps).toEqual(alcoveOnly);
  });

  it('find the call in their own Google Calendar, which can join it and says which call it is', async () => {
    const org = await googleAccount('Bram');
    const guest = await googleAccount('Ana');
    const m = await org.api.meetings.create(call('Sync', [guest.session.user.email]));
    const event = h.google.calendar(org.sub).find((e) => e.summary === 'Sync');
    if (!event) throw new Error('the call isn’t on the calendar');
    const when = { start: { dateTime: inDays(1) }, end: { dateTime: inDays(2) } };
    h.google.calendar(guest.sub).push(
      // Their copy, as Google keeps it: the marker Alcove puts on the organizer's is private to that copy.
      { ...event, id: 'their-copy', extendedProperties: {}, organizer: { email: org.session.user.email } },
      { id: 'another-alcove', summary: 'Someone else’s', location: `https://alcove.example/join/${m.code}`, ...when },
      { id: 'no-code', summary: 'Almost', location: `${ORIGIN}/join/not-a-code`, ...when },
      { id: 'meet', summary: 'Meet', hangoutLink: 'https://meet.google.com/abc-defg-hij', ...when }
    );
    const events = (await guest.api.calendar.get()).events;
    expect(events.find((e) => e.id === 'their-copy')).toMatchObject({ alcoveCode: m.code, join: { url: `${ORIGIN}/join/${m.code}`, label: 'Alcove' } });
    expect((await guest.api.meetings.upcoming()).some((c) => c.code === m.code)).toBe(true);
    for (const id of ['another-alcove', 'no-code', 'meet']) expect(events.find((e) => e.id === id)).not.toHaveProperty('alcoveCode');
    expect(events.find((e) => e.id === 'meet')?.join?.label).toBe('Google Meet');
    // The organizer's own copy stays Alcove's call, and isn't listed twice.
    expect((await org.api.calendar.get()).events.map((e) => e.title)).not.toContain('Sync');
  });
});

describe('calls started now', () => {
  it('reach no calendar: renaming one in the lobby emails nobody', async () => {
    const org = await googleAccount('Bram');
    const guest = unique('guest');
    const writes = () => h.google.calls.filter((x) => x.method !== 'GET').length;
    const before = writes();
    const { code: c } = await org.api.calls.startNow({ guests: [guest] });
    const m = await org.api.meetings.byCode(c);
    if (!m) throw new Error('the call isn’t there');
    expect(m.instant).toBe(true);
    const changed = await org.api.meetings.update(m.id, { title: 'Quick one', notes: 'off', guests: [guest, unique('other')], joinMuted: true, documents: [], choices: { keepTranscript: false, keepRecording: false, allowScreens: false } });
    expect(changed).toMatchObject({ title: 'Quick one', notes: 'off', guestCount: 2, joinMuted: true, choices: { keepTranscript: false, keepRecording: false, allowScreens: false } });
    expect(h.google.calendar(org.sub)).toEqual([]);
    expect(writes()).toBe(before);
    expect(await h.browser().api.calls.card(c)).toMatchObject({ title: 'Quick one', joinMuted: true, choices: { keepTranscript: false } });
  });

  it('aren’t listed until someone is in them, for anyone, and backing out of the lobby cancels', async () => {
    const org = await account();
    const guest = await account();
    const { code: c } = await org.api.calls.startNow({ title: 'Right now', guests: [guest.session.user.email] });
    const m = await org.api.meetings.byCode(c);
    if (!m) throw new Error('the call isn’t there');
    expect(listed(await org.api.meetings.upcoming(), m.id)).toBeUndefined();
    expect(listed(await guest.api.meetings.upcoming(), m.id)).toBeUndefined();

    const host = await org.api.calls.join(c, { mic: true, cam: false });
    expect(listed(await org.api.meetings.upcoming(), m.id)?.status).toBe('live');
    expect(listed(await guest.api.meetings.upcoming(), m.id)).toMatchObject({ status: 'live', isOrganizer: false, instant: true });
    await host.leave();

    const { code: left } = await org.api.calls.startNow({ guests: [guest.session.user.email] });
    const lobby = await org.api.meetings.byCode(left);
    if (!lobby) throw new Error('the call isn’t there');
    await org.api.meetings.cancel(lobby.id);
    expect(await org.api.meetings.byCode(left)).toBeNull();
    expect(await refusal(h.browser().api.calls.card(left))).toBe('not-found');
    expect(await invites(lobby.id)).toBe(0);
  });

  it('are swept up by the next one once they’re over a day old and nobody ever joined', async () => {
    const org = await account();
    const other = await account();
    const start = async (who: typeof org, title: string) => {
      const { code: c } = await who.api.calls.startNow({ title });
      const m = await who.api.meetings.byCode(c);
      if (!m) throw new Error('the call isn’t there');
      return m;
    };
    const age = (id: string) => h.pool.query(`UPDATE revisions SET created_at = now() - interval '25 hours' WHERE item_id = $1`, [id]);
    const abandoned = await start(org, 'Abandoned');
    const recent = await start(org, 'Just now');
    const held = await start(org, 'Held');
    await (await org.api.calls.join(held.code, { mic: true, cam: false })).leave();
    const someoneElses = await start(other, 'Theirs');
    const planned = await org.api.meetings.create(call('Planned', []));
    for (const m of [abandoned, held, someoneElses, planned]) await age(m.id);

    await start(org, 'Next');
    expect(await org.api.meetings.byCode(abandoned.code)).toBeNull();
    expect(await refusal(h.browser().api.calls.card(abandoned.code))).toBe('not-found');
    for (const m of [recent, held, planned]) expect((await org.api.meetings.byCode(m.code))?.id).toBe(m.id);
    expect((await other.api.meetings.byCode(someoneElses.code))?.id).toBe(someoneElses.id);
  });
});

describe('making calls', () => {
  it('limits how fast an account can make them, however it does, and nobody else’s', async () => {
    const org = await account();
    const first = await org.api.meetings.create(call('One', [unique('them')]));
    for (let i = 1; i < 28; i++) await org.api.meetings.create(call(`Call ${i}`, [unique('them')]));
    await org.api.calls.startNow({ title: 'Now' });
    await org.api.meetings.scheduleNext(first.id, inDays(8));
    // That's 30 in a minute, by three doors, and none of them opens again: nor does making one repeat.
    expect(await refusal(org.api.meetings.create(call('One too many', [])))).toBe('unavailable');
    expect(await refusal(org.api.calls.startNow({ title: 'Now again' }))).toBe('unavailable');
    expect(await refusal(org.api.meetings.scheduleNext(first.id, inDays(9)))).toBe('unavailable');
    const at = new Date(first.startsAt).getTime();
    const weeks = [0, 1].map((n) => new Date(at + n * 7 * 86_400_000).toISOString());
    expect(await refusal(org.api.meetings.update(first.id, { repeat: { rule: { every: 'week', weeks: 1, days: [new Date(at).getUTCDay()] }, until: inDays(10).slice(0, 10), timeZone: 'UTC', occurrences: weeks } }))).toBe('unavailable');
    // Changing a call is no new call, and someone else's allowance is their own.
    expect((await org.api.meetings.update(first.id, { title: 'Still mine' })).title).toBe('Still mine');
    expect((await (await account()).api.meetings.create(call('Mine', []))).title).toBe('Mine');
  });
});

describe('changing a scheduled call', () => {
  it('changes the calendar only for what the event shows', async () => {
    const org = await googleAccount('Bram');
    const m = await org.api.meetings.create(call('Review', [unique('guest')]));
    const writes = () => h.google.calls.filter((x) => x.method === 'PATCH').length;
    const before = writes();
    const changed = await org.api.meetings.update(m.id, { joinMuted: true, documents: [], choices: { keepTranscript: false, keepRecording: true, allowScreens: false } });
    expect(changed).toMatchObject({ joinMuted: true, choices: { keepTranscript: false } });
    expect(writes()).toBe(before);
    await org.api.meetings.update(m.id, { title: 'Review, moved' });
    expect(writes()).toBe(before + 1);
    expect(h.google.calendar(org.sub).find((e) => e.summary === 'Review, moved')).toBeTruthy();
  });

  it('takes up to 300 people', async () => {
    const org = await account();
    const people = Array.from({ length: 300 }, (_, i) => unique(`p${i}`));
    const m = await org.api.meetings.create(call('Town hall', people));
    expect([m.guestCount, await invites(m.id)]).toEqual([300, 300]);
    expect(await refusal(org.api.meetings.update(m.id, { guests: [...people, unique('over')] }))).toBe('invalid');
  });
});

describe('offering times', () => {
  it('waits for someone with the link to pick: nothing’s on a calendar and nobody can join, and then the first pick settles it', async () => {
    const org = await googleAccount('Bram');
    const jamie = unique('jamie');
    const times = [inDays(1), inDays(2), inDays(3)];
    const [first = '', second = ''] = times;
    const m = await org.api.meetings.create(call('Catch-up', [jamie], { startsAt: second, durationMinutes: 45, offer: times }));
    expect([m.offer, m.startsAt, m.status]).toEqual([{ times }, first, 'scheduled']);
    expect(m).not.toHaveProperty('calendarUrl');
    expect(h.google.calendar(org.sub)).toEqual([]);
    expect(listed(await org.api.meetings.upcoming(), m.id)?.offer).toEqual({ times });
    // Changing it puts nothing on the calendar either.
    expect((await org.api.meetings.update(m.id, { title: 'Catch-up with Jamie' })).offer).toEqual({ times });
    expect(h.google.calendar(org.sub)).toEqual([]);

    // Anyone with the link sees the times, with no account, and neither they nor the organizer can come in yet.
    const anyone = h.browser().api;
    expect((await anyone.calls.card(m.code)).offer).toEqual({ times, minutes: 45 });
    expect(await refusal(anyone.calls.join(m.code, { mic: false, cam: false, name: 'Jamie' }))).toBe('conflict');
    expect(await refusal(org.api.calls.join(m.code, { mic: false, cam: false }))).toBe('conflict');

    expect(await refusal(anyone.calls.pick(m.code, inDays(4)))).toBe('invalid');
    expect(await refusal(anyone.calls.pick(m.code, 'not a time'))).toBe('invalid');
    expect(await refusal(anyone.calls.pick('abc-defg-hij', second))).toBe('not-found');
    expect((await anyone.calls.card(m.code)).offer?.times).toEqual(times);

    expect((await anyone.calls.pick(m.code, second)).offer).toBeNull();
    const settled = await org.api.meetings.get(m.id);
    expect(settled).not.toHaveProperty('offer');
    expect([settled.startsAt, settled.endsAt]).toEqual([second, new Date(Date.parse(second) + 45 * 60_000).toISOString()]);
    expect(settled.calendarUrl).toMatch(/^https:/);
    expect(h.google.calendar(org.sub).map((e) => [e.summary, e.start?.dateTime, e.attendees?.map((a) => a.email)])).toEqual([['Catch-up with Jamie', second, [jamie]]]);

    // Any later pick is refused, the same time or another, and changes nothing.
    expect(await refusal(anyone.calls.pick(m.code, second))).toBe('conflict');
    expect(await refusal(anyone.calls.pick(m.code, first))).toBe('conflict');
    expect((await org.api.meetings.get(m.id)).startsAt).toBe(second);
    // The call can be joined now.
    expect((await org.api.calls.join(m.code, { mic: false, cam: false })).ticket.role).toBe('host');
  });

  it('goes on the calendar once, whatever changes while Google is asked, and everyone hears of it once', async () => {
    const org = await googleAccount('Bea');
    const guest = unique('guest');
    const offered = await org.api.meetings.create(call('Pick one', [guest], { offer: [inDays(2), inDays(3)] }));
    const posted = () => h.google.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/events')).length;
    const before = posted();
    const release = h.google.hold((c) => c.method === 'POST' && c.path.endsWith('/events'));
    const picking = h.browser().api.calls.pick(offered.code, offered.offer?.times[0] ?? '');
    await waitFor(() => posted() === before + 1, 'Google to be asked');

    // Changed while Google is thinking: the change goes through, and nothing else goes to Google.
    expect((await org.api.meetings.update(offered.id, { title: 'Picked, and renamed' })).title).toBe('Picked, and renamed');
    expect(posted()).toBe(before + 1);
    // Who's asking Google is nobody's business but the call's.
    expect(await (await org.fetch(`${h.baseUrl}/v1/meetings/${offered.id}`)).text()).not.toContain('placing');
    release();
    await picking;

    const [event, ...more] = h.google.calendar(org.sub);
    expect(more).toEqual([]);
    expect(event?.summary).toBe('Picked, and renamed');
    expect(h.google.mail.filter((m) => m.eventId === event?.id).map((m) => m.kind)).toEqual(['invitation', 'update']);
    const meeting = await org.api.meetings.get(offered.id);
    expect(meeting.calendarUrl).toBe(event?.htmlLink);
  });

  it('goes on the calendar once when two changes find it missing, and a call that goes meanwhile takes its event with it', async () => {
    const org = await googleAccount('Cy');
    const posted = () => h.google.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/events')).length;
    // Google was down when these were scheduled, so nothing put them on the calendar.
    h.google.refuse((c) => c.method === 'POST');
    const missing = await org.api.meetings.create(call('Not there yet', []));
    const going = await org.api.meetings.create(call('Going', []));
    h.google.refuse();
    expect(h.google.calendar(org.sub)).toEqual([]);

    const before = posted();
    const release = h.google.hold((c) => c.method === 'POST' && c.path.endsWith('/events'));
    const both = Promise.all([org.api.meetings.update(missing.id, { title: 'First' }), org.api.meetings.update(missing.id, { title: 'Second' })]);
    await waitFor(() => posted() === before + 1, 'Google to be asked');
    release();
    await both;
    expect(h.google.calendar(org.sub)).toHaveLength(1);
    expect(h.google.calendar(org.sub)[0]?.summary).toBe((await org.api.meetings.get(missing.id)).title);

    const hold = h.google.hold((c) => c.method === 'POST' && c.path.endsWith('/events'));
    const placing = org.api.meetings.update(going.id, { title: 'Still going' }).catch((e: unknown) => e);
    await waitFor(() => posted() === before + 2, 'Google to be asked again');
    await org.api.meetings.cancel(going.id);
    hold();
    await placing;
    expect(h.google.calendar(org.sub)).toHaveLength(1);
  });

  it('takes over from a process that died asking Google, and won’t repeat a call being placed', async () => {
    const org = await googleAccount('Dot');
    const inAMinute = new Date(Date.now() + 60_000).toISOString();
    h.google.refuse((c) => c.method === 'POST');
    const m = await org.api.meetings.create(call('Left behind', []));
    h.google.refuse();

    // Someone's asking: a change leaves it to them, and making it repeat is told to wait.
    await stored(org.session.ownerId, m.id, (x) => ({ ...x, placing: inAMinute }));
    await org.api.meetings.update(m.id, { title: 'Not yet' });
    expect(h.google.calendar(org.sub)).toEqual([]);
    const day = new Date(m.startsAt).getUTCDay();
    const twice = [m.startsAt, new Date(new Date(m.startsAt).getTime() + 7 * 86_400_000).toISOString()];
    expect(await refusal(org.api.meetings.update(m.id, { repeat: { rule: { every: 'week', weeks: 1, days: [day] }, until: inDays(10).slice(0, 10), timeZone: 'UTC', occurrences: twice } }))).toBe('conflict');

    // Nobody came back from asking: the claim runs out, and the next change places the call.
    await stored(org.session.ownerId, m.id, (x) => ({ ...x, placing: new Date(Date.now() - 1000).toISOString() }));
    await org.api.meetings.update(m.id, { title: 'Placed at last' });
    expect(h.google.calendar(org.sub).map((e) => e.summary)).toEqual(['Placed at last']);
    expect((await org.api.meetings.get(m.id)).calendarUrl).toBeTruthy();
  });

  it('settles on the first of two people picking at once, and tells the second', async () => {
    const org = await account();
    const [a = '', b = ''] = [inDays(1), inDays(2)];
    const m = await org.api.meetings.create(call('Two guests', [unique('one'), unique('two')], { offer: [a, b] }));
    const picks = await Promise.all([h.browser().api.calls.pick(m.code, a).then(() => a, code), h.browser().api.calls.pick(m.code, b).then(() => b, code)]);
    expect(picks.filter((p) => p === 'conflict')).toHaveLength(1);
    const won = picks.find((p) => p !== 'conflict');
    expect((await org.api.meetings.get(m.id)).startsAt).toBe(won);
  });

  it('lets go of times as they pass, and of the call once the last is well past', async () => {
    const org = await account();
    const guest = await account();
    const [soon = '', later = ''] = [inDays(1), inDays(2)];
    const m = await org.api.meetings.create(call('Passing', [guest.session.user.email], { offer: [soon, later] }));
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(soon) + 3 * 3_600_000 });
    const anyone = h.browser().api;
    expect((await anyone.calls.card(m.code)).offer?.times).toEqual([later]);
    expect(await refusal(anyone.calls.pick(m.code, soon))).toBe('invalid');
    // The first time being past the cut-off doesn't take a call off anyone's list while another is still to come.
    expect(listed(await org.api.meetings.upcoming(), m.id)?.offer?.times).toEqual([soon, later]);
    expect(listed(await guest.api.meetings.upcoming(), m.id)?.offer?.times).toEqual([soon, later]);

    vi.setSystemTime(Date.parse(later) + 3 * 3_600_000);
    expect((await anyone.calls.card(m.code)).offer?.times).toEqual([]);
    expect(listed(await org.api.meetings.upcoming(), m.id)).toBeUndefined();
    expect(listed(await guest.api.meetings.upcoming(), m.id)).toBeUndefined();
  });

  it('shows on the account of anyone it invites, can be cancelled, and is changed only by offering again', async () => {
    const org = await account();
    const guest = await account();
    const times = [inDays(1), inDays(2)];
    const [first = ''] = times;
    const m = await org.api.meetings.create(call('Offered', [guest.session.user.email], { offer: times }));
    expect(listed(await guest.api.meetings.upcoming(), m.id)).toMatchObject({ isOrganizer: false, offer: { times } });
    expect(await refusal(org.api.meetings.update(m.id, { startsAt: inDays(5) }))).toBe('conflict');
    expect(await refusal(org.api.meetings.update(m.id, { offer: [inDays(5), inDays(6)] }))).toBe('invalid');
    expect((await org.api.meetings.update(m.id, { durationMinutes: 60 })).offer).toEqual({ times });
    expect((await h.browser().api.calls.card(m.code)).offer?.minutes).toBe(60);
    expect((await org.api.meetings.get(m.id)).startsAt).toBe(first);

    await org.api.meetings.cancel(m.id);
    expect(await refusal(h.browser().api.calls.card(m.code))).toBe('not-found');
    expect(await refusal(h.browser().api.calls.pick(m.code, first))).toBe('not-found');
  });

  it('takes two or three different times still to come, none with a repeat', async () => {
    const org = await account();
    const offering = (offer: string[], more: Partial<MeetingInput> = {}) => org.api.meetings.create(call('Refused', [], { offer, ...more }));
    const [a = '', b = ''] = [inDays(1), inDays(2)];
    expect(await refusal(offering([a, b], { repeat: { rule: { every: 'week', weeks: 1, days: [1] }, until: inDays(30).slice(0, 10), timeZone: 'Europe/London', occurrences: [a] } }))).toBe('invalid');
    expect(await refusal(offering([a]))).toBe('invalid');
    expect(await refusal(offering([a, a]))).toBe('invalid');
    expect(await refusal(offering([a, 'later']))).toBe('invalid');
    expect(await refusal(offering([new Date(Date.now() - 3_600_000).toISOString(), b]))).toBe('invalid');
    // Soonest first, whatever order they came in.
    expect((await offering([b, a])).offer?.times).toEqual([a, b]);
  });

  it('limits how fast anyone can pick', async () => {
    const browser = h.browser();
    const tries = await Promise.all(Array.from({ length: 31 }, () => refusal(browser.api.calls.pick('abc-defg-hij', inDays(1)))));
    expect(tries.filter((t) => t === 'not-found')).toHaveLength(30);
    expect(tries.filter((t) => t === 'unavailable')).toHaveLength(1);
  });
});
