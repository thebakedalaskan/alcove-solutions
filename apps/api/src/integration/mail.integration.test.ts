/**
 * The email Alcove sends (docs: Privacy, keys and sessions › Email), end to end: invitations made through the real API over
 * HTTP via @alcove/api-http, real Postgres, and the stand-in Resend. An email goes once its invitation is committed, sealed
 * in the outbox until then; a send whose answer never came goes again under the same idempotency key, and Resend sends it
 * once; Resend busy or failing is tried again later, after its `retry-after`, eight times at most; Resend refusing it is
 * given up on at once; past `mail.per_day` the rest waits for the next day; without a key nothing is sent. An address is
 * emailed one invitation a day at most from all of Alcove, and can stop them, from the email's page or its one-click
 * unsubscribe, with the same answer for any token: its invitations are still made, and never emailed again. Every way of
 * writing one mailbox shares its caps and its stop, and a team deleted and made again starts none of them over. Every
 * invitation is written as an email alike, and whether it goes is decided as it's sent. Names in it never read as links.
 */
import { createHttpApi } from '@alcove/api-http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { WorkAnswer } from '../features/operator/wire';
import { maintain } from '../maintenance';
import { ORIGIN, startHarness, type Harness } from '../testing/harness';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(async () => { vi.useRealTimers(); await h.resetLimits(); });

const DAY = 86_400_000;
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
const LogLine = z.object({ msg: z.string(), level: z.number() }).passthrough();
const logsSince = (from: number) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
const said = (from: number, msg: string) => logsSince(from).filter((l) => l.msg === msg);
const sentTo = (to: string) => h.resend.sent.filter((e) => e.to.includes(to));
/** The outbox's rows, by what's in the clear: when each is due and how many tries it's had. */
const outbox = async () => (await h.pool.query<{ mail_id: string; attempts: number; send_after: Date }>('SELECT mail_id, attempts, send_after FROM mail_outbox ORDER BY send_after')).rows;
/** Today's count of emails sent, all of Alcove's. */
const sentToday = async () => (await h.pool.query<{ sent: number }>('SELECT sent FROM mail_days WHERE day = $1', [new Date().toISOString().slice(0, 10)])).rows[0]?.sent ?? 0;
const tokenIn = (text: string) => /stop-email#([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? 'no token';
/** Why each email was dropped since `from`, as the log says it. */
const droppedSince = (from: number) => said(from, 'mail dropped').map((l) => l['why']);
/** Signs in through the stand-in Google, which brings whatever name it's given. */
async function withGoogle(email: string, name: string) {
  const b = h.browser();
  h.google.next({ sub: `mail-sub-${seq++}`, email, name });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  return { ...b, session, email };
}

describe('the outbox', () => {
  it('sends an invitation once its answer is lost on the way: again under the same key, which Resend sends once', async () => {
    const sam = await account();
    const to = unique('priya');
    h.resend.fail(1, { status: 'lost' });
    const from = h.logs.length;
    await sam.api.teams.invite([to]);
    // Resend sent it; the API never heard, so it's put off to try again, under the same key.
    await expect.poll(() => said(from, 'mail retried').length, { timeout: 10_000 }).toBe(1);
    expect(sentTo(to)).toHaveLength(1);
    const [row] = await outbox();
    expect(row).toMatchObject({ attempts: 1 });
    vi.useFakeTimers({ toFake: ['Date'], now: (row?.send_after.getTime() ?? 0) + 1000 });
    await maintain(h.deps);
    expect(await outbox()).toEqual([]);
    expect(sentTo(to)).toHaveLength(1);
    const keys = h.resend.requests.filter((r) => r.key === sentTo(to)[0]?.key);
    expect(keys.map((r) => r.status)).toEqual([0, 200]);
    // Resend's status is another service's, said apart from what Alcove answered the request that asked for it.
    expect(said(from, 'mail sent')).toEqual([expect.objectContaining({ mailId: row?.mail_id, attempts: 2, upstreamStatus: 200, resendId: sentTo(to)[0]?.id })]);
    expect(said(from, 'mail sent')[0]).not.toHaveProperty('status');
  });

  it('tries again after Resend’s retry-after, and after a wait of its own, and gives up on what Resend refuses, at error with its name', async () => {
    const sam = await account();
    const [a, b, c] = [unique('busy'), unique('failing'), unique('refused')];
    // Busy, with a retry-after of two minutes: the wait is the longer of that and a minute.
    h.resend.fail(1, { status: 429, retryAfter: 120 });
    let from = h.logs.length;
    await sam.api.teams.invite([a]);
    await expect.poll(() => said(from, 'mail retried').length, { timeout: 10_000 }).toBe(1);
    expect(said(from, 'mail retried')[0]).toMatchObject({ upstreamStatus: 429, upstreamError: 'rate_limit_exceeded', attempts: 1, afterMs: 120_000 });
    const busy = (await outbox())[0];
    const start = Date.now();
    expect((busy?.send_after.getTime() ?? 0) - start).toBeGreaterThan(110_000);
    vi.useFakeTimers({ toFake: ['Date'], now: start + 60_000 });
    await maintain(h.deps);
    expect(sentTo(a)).toEqual([]);
    vi.setSystemTime(start + 121_000);
    await maintain(h.deps);
    expect(sentTo(a)).toHaveLength(1);
    vi.useRealTimers();
    // Failing: tried again a minute on.
    h.resend.fail(1, { status: 500 });
    from = h.logs.length;
    await sam.api.teams.invite([b]);
    await expect.poll(() => said(from, 'mail retried').length, { timeout: 10_000 }).toBe(1);
    expect(said(from, 'mail retried')[0]).toMatchObject({ upstreamStatus: 500, upstreamError: 'application_error', afterMs: 60_000 });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61_000 });
    await maintain(h.deps);
    expect(sentTo(b)).toHaveLength(1);
    vi.useRealTimers();
    // Refused: given up on at once, at error, with Resend's name for why and nothing of what it was.
    h.resend.fail(1, { status: 422, name: 'validation_error' });
    from = h.logs.length;
    await sam.api.teams.invite([c]);
    await expect.poll(() => said(from, 'mail dropped').length, { timeout: 10_000 }).toBe(1);
    expect(said(from, 'mail dropped')[0]).toMatchObject({ level: 50, why: 'refused', upstreamStatus: 422, upstreamError: 'validation_error', attempts: 1 });
    expect(sentTo(c)).toEqual([]);
    expect(await outbox()).toEqual([]);
    // The invitation is there all the same.
    expect((await sam.api.teams.mine())?.invitations.map((i) => i.person.email)).toContain(c);
    // Every send carried the API key and the row's ID as its idempotency key.
    for (const r of h.resend.requests) expect([r.apiKey, r.key]).toEqual([h.resend.settings.RESEND_API_KEY, expect.stringMatching(/^[A-Za-z0-9_-]{22}$/)]);
  });

  it('gives up at warn after eight tries over the hours', async () => {
    const sam = await account();
    const to = unique('never');
    h.resend.fail(8, { status: 500 });
    const from = h.logs.length;
    await sam.api.teams.invite([to]);
    await expect.poll(() => said(from, 'mail retried').length, { timeout: 10_000 }).toBe(1);
    let now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now });
    for (let tries = 2; tries <= 8; tries++) {
      const [row] = await outbox();
      if (!row) throw new Error(`gone after ${tries - 1} tries`);
      now = row.send_after.getTime() + 1000;
      vi.setSystemTime(now);
      await maintain(h.deps);
    }
    expect(await outbox()).toEqual([]);
    expect(said(from, 'mail retried').map((l) => l['afterMs'])).toEqual([60_000, 300_000, 900_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000]);
    expect(said(from, 'mail dropped')).toEqual([expect.objectContaining({ level: 40, why: 'tries', attempts: 8, upstreamStatus: 500 })]);
    expect(sentTo(to)).toEqual([]);
  });

  it('sends at most mail.per_day in a day, all of Alcove’s, the rest waiting for the next day, as operators see', async () => {
    const sam = await account();
    const [a, b] = [unique('first'), unique('second')];
    await h.setLimit('mail.per_day', (await sentToday()) + 1);
    const from = h.logs.length;
    await sam.api.teams.invite([a, b]);
    await expect.poll(() => sentTo(a).length + sentTo(b).length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => said(from, 'mail waits for tomorrow: the day’s emails have gone').length, { timeout: 10_000 }).toBe(1);
    const [waiting] = await outbox();
    const now = new Date();
    const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    expect(waiting).toMatchObject({ attempts: 0, send_after: new Date(tomorrow) });
    // Operators see it waiting, by its times and tries alone.
    const work = WorkAnswer.parse(await (await h.operator.read.get('/v1/operator/work')).json());
    if (!work.queues.ok) throw new Error('the queues weren’t counted');
    expect(work.queues.mail).toMatchObject({ waiting: 1, due: 0, failing: 0, highestAttempt: 0 });
    await maintain(h.deps);
    expect(sentTo(a).length + sentTo(b).length).toBe(1);
    vi.useFakeTimers({ toFake: ['Date'], now: tomorrow + 1000 });
    await maintain(h.deps);
    expect(sentTo(a).length + sentTo(b).length).toBe(2);
  });

  it('never sends what waited for an invitation that ended meanwhile: cancelled, or gone with whoever made it', async () => {
    const sam = await account();
    const ken = await account();
    await sam.api.teams.invite([ken.email]);
    await ken.api.teams.acceptInvitation((await ken.api.teams.invitations())[0]?.id ?? 'no invitation');
    const [cancelled, left] = [unique('cancelled'), unique('left')];
    await h.setLimit('mail.per_day', await sentToday());
    await sam.api.teams.invite([cancelled]);
    await ken.api.teams.invite([left]);
    await expect.poll(async () => (await outbox()).length, { timeout: 10_000 }).toBe(2);
    await sam.api.teams.cancelInvitation((await sam.api.teams.mine())?.invitations.find((i) => i.person.email === cancelled)?.id ?? '');
    expect(await outbox()).toHaveLength(1);
    // Ken leaves: what he asked goes with him, its email too, unsent, with his name and address in it.
    await ken.api.teams.leave();
    expect(await outbox()).toEqual([]);
    await h.resetLimits();
    const now = new Date();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 1) });
    await maintain(h.deps);
    expect([...sentTo(cancelled), ...sentTo(left)]).toEqual([]);
  });

  it('sends one email of an invitation sent again while the one before still waits: the latest', async () => {
    const sam = await account();
    const to = unique('patient');
    await h.setLimit('mail.per_day', 0);
    await sam.api.teams.invite([to]);
    await expect.poll(async () => (await outbox()).length, { timeout: 10_000 }).toBe(1);
    const [first] = await outbox();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DAY + 1000 });
    await sam.api.teams.resendInvitation((await sam.api.teams.mine())?.invitations[0]?.id ?? '');
    await expect.poll(async () => (await outbox()).map((r) => r.mail_id), { timeout: 10_000 }).not.toEqual([first?.mail_id]);
    expect(await outbox()).toHaveLength(1);
    await h.resetLimits();
    vi.setSystemTime(Date.now() + DAY);
    await maintain(h.deps);
    expect(sentTo(to)).toHaveLength(1);
  });

  it('sends nothing without a key, saying so at info, and the invitation is there as ever', async () => {
    const plain = await h.secondServer({ RESEND_API_KEY: undefined });
    try {
      const sam = await account();
      const priya = await account();
      const there = createHttpApi({ baseUrl: plain.baseUrl, fetch: sam.fetch });
      const from = h.logs.length;
      await there.teams.invite([priya.email]);
      await expect.poll(() => said(from, 'mail not sent: no provider').length, { timeout: 10_000 }).toBe(1);
      expect(said(from, 'mail not sent: no provider')[0]).toMatchObject({ level: 30, mailId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) });
      expect(sentTo(priya.email)).toEqual([]);
      expect(await outbox()).toEqual([]);
      expect((await priya.api.teams.invitations()).map((i) => i.from.email)).toEqual([sam.email]);
    } finally {
      await plain.close();
    }
  });
});

describe('one address', () => {
  it('is emailed one invitation a day at most from all of Alcove, which nobody on a team can tell', async () => {
    const [sam, lu] = await Promise.all([account(), account()]);
    const to = unique('priya');
    await sam.api.teams.invite([to]);
    await expect.poll(() => sentTo(to).length, { timeout: 10_000 }).toBe(1);
    // Another team invites the same address that day: it's made, with no email, and its people see it as any other.
    const theirs = (await lu.api.teams.invite([to])).team.invitations[0];
    expect(theirs).toMatchObject({ person: { email: to } });
    expect(Date.parse(theirs?.resendAt ?? '') - Date.parse(theirs?.at ?? '')).toBe(DAY);
    await new Promise((r) => setTimeout(r, 300));
    expect(sentTo(to)).toHaveLength(1);
    // The next day it's theirs to send, and it's emailed.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DAY + 1000 });
    await lu.api.teams.resendInvitation(theirs?.id ?? '');
    await expect.poll(() => sentTo(to).length, { timeout: 10_000 }).toBe(2);
  });

  it('stops Alcove’s emails from the email’s page or its one-click unsubscribe, the same for any token: what waits never goes, and its invitations are still made', async () => {
    const [sam, lu, kay] = await Promise.all([account(), account(), account()]);
    const to = unique('stopper');
    await sam.api.teams.invite([to]);
    await expect.poll(() => sentTo(to).length, { timeout: 10_000 }).toBe(1);
    const [email] = sentTo(to);
    const token = tokenIn(email?.text ?? '');
    const oneClick = /^<(.+)>$/.exec(email?.headers?.['List-Unsubscribe'] ?? '')?.[1] ?? 'no url';
    expect(oneClick).toBe(`${h.baseUrl}/v1/mail/stop?token=${token}`);
    // Another team's email to it waits for the next day, as the day's have all gone.
    await h.setLimit('mail.address_per_day', 5);
    await h.setLimit('mail.per_day', await sentToday());
    await lu.api.teams.invite([to]);
    await expect.poll(async () => (await outbox()).length, { timeout: 10_000 }).toBe(1);
    const from = h.logs.length;
    // A made-up token and a malformed one: the same answer as a real one, and nothing stopped.
    const stranger = h.browser();
    await stranger.api.people.stopEmails('A'.repeat(43));
    expect((await fetch(`${h.baseUrl}/v1/mail/stop?token=nonsense`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })).status).toBe(204);
    // A mail app opening the URL in a browser is sent on to the app's page, with the token out of every server's sight, and stops nothing.
    const opened = await fetch(oneClick, { redirect: 'manual' });
    expect([opened.status, opened.headers.get('location')]).toEqual([303, `${ORIGIN}/stop-email#${token}`]);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM mail_stops')).rows[0]).toEqual({ n: 0 });
    // The one-click POST, as a mail app sends it from its own servers: no Origin of the app's, a form's body, the token in the URL.
    expect((await fetch(oneClick, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })).status).toBe(204);
    // And the page, again: the same answer.
    await stranger.api.people.stopEmails(token);
    expect(said(from, 'mail stop asked').map((l) => l['outcome'])).toEqual(['refused', 'refused', 'stopped', 'already']);
    // Kept by a blind index alone: neither the token nor the address is in the row, nor in any log line.
    const stops = String((await h.pool.query<{ all: string | null }>('SELECT string_agg(row_to_json(x)::text, \' \') AS all FROM mail_stops x')).rows[0]?.all ?? '');
    for (const enc of [token, to, Buffer.from(token).toString('hex')]) expect(stops.includes(enc), enc).toBe(false);
    expect(h.logs.join('').includes(token)).toBe(false);
    // What was waiting never goes: the next day it's dropped as it comes due.
    await h.resetLimits();
    const now = new Date();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 1) });
    await maintain(h.deps);
    expect(await outbox()).toEqual([]);
    expect(said(from, 'mail dropped')).toEqual([expect.objectContaining({ level: 30, why: 'stopped' })]);
    // From then on its invitations are made, and never emailed: by a team that asked it before, and one that hadn't.
    vi.setSystemTime(Date.now() + DAY);
    const ours = (await sam.api.teams.mine())?.invitations[0];
    await sam.api.teams.resendInvitation(ours?.id ?? '');
    expect((await kay.api.teams.invite([to])).team.invitations.map((i) => i.person.email)).toEqual([to]);
    await new Promise((r) => setTimeout(r, 300));
    expect(sentTo(to)).toHaveLength(1);
    expect(await outbox()).toEqual([]);
  });
});

describe('one mailbox, however it’s written', () => {
  it('shares its caps and its stop among the ways of writing it: capitals, a +tag, and at Gmail its dots and googlemail.com; each email goes to the address as typed', async () => {
    const [sam, lu, kay] = await Promise.all([account(), account(), account()]);
    const name = `first.last.${Date.now().toString(36)}${(seq++).toString(36)}`;
    const typed = `${name}+work@gmail.com`;
    const dotless = `${name.replace(/\./g, '')}@googlemail.com`;
    await sam.api.teams.invite([typed]);
    await expect.poll(() => sentTo(typed).length, { timeout: 10_000 }).toBe(1);
    expect(sentTo(typed)[0]?.to).toEqual([typed]);
    // Another team, the same day, the same mailbox written another way: invited, and no email, as for the address itself.
    const from = h.logs.length;
    const theirs = (await lu.api.teams.invite([dotless])).team.invitations[0];
    expect(theirs).toMatchObject({ person: { email: dotless }, sends: 1, resendWhy: 'recent' });
    await expect.poll(() => droppedSince(from), { timeout: 10_000 }).toEqual(['address']);
    expect(sentTo(dotless)).toEqual([]);
    // Stopped from the first email, which stops every way of writing it: the next day Lu's goes nowhere, nor a third team's.
    await h.browser().api.people.stopEmails(tokenIn(sentTo(typed)[0]?.text ?? ''));
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DAY + 1000 });
    const later = h.logs.length;
    await lu.api.teams.resendInvitation(theirs?.id ?? '');
    await kay.api.teams.invite([`${name.toUpperCase()}@GMAIL.COM`.toLowerCase()]);
    await expect.poll(() => droppedSince(later), { timeout: 10_000 }).toEqual(['stopped', 'stopped']);
    expect(h.resend.sent.filter((e) => e.to.some((t) => t.includes(name) || t.includes(name.replace(/\./g, ''))))).toHaveLength(1);
  });

  it('shares a +tag’s caps at any domain, and counts a mailbox’s emails for the day through a team deleted and made again', async () => {
    const sam = await account();
    const local = `sam.${Date.now().toString(36)}${(seq++).toString(36)}`;
    const [plain, tagged] = [`${local}@vandelay.example`, `${local}+news@vandelay.example`];
    await sam.api.teams.invite([plain]);
    await expect.poll(() => sentTo(plain).length, { timeout: 10_000 }).toBe(1);
    // The team goes, and another is made at once: the address had its email for the day, however it's written.
    await sam.api.teams.delete();
    const from = h.logs.length;
    expect((await sam.api.teams.invite([tagged, plain])).invited).toBe(2);
    await expect.poll(() => droppedSince(from), { timeout: 10_000 }).toEqual(['address', 'address']);
    expect([...sentTo(plain), ...sentTo(tagged)]).toHaveLength(1);
    // What the caps count names no team, and goes with none: it's kept for its days, by keyed hashes alone.
    const sends = (await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_name = 'mail_sends' AND constraint_type = 'FOREIGN KEY'")).rows[0];
    expect(sends).toEqual({ n: 0 });
  });

  it('writes every invitation as an email alike, whatever becomes of it, and decides as it sends whether it goes', async () => {
    const [sam, lu] = await Promise.all([account(), account()]);
    const [fresh, stopper, emailed] = [unique('fresh'), unique('stopper'), unique('emailed')];
    // One address stopped Alcove's emails, and another had its one email today, from another team.
    await lu.api.teams.invite([stopper, emailed]);
    await expect.poll(() => sentTo(stopper).length + sentTo(emailed).length, { timeout: 10_000 }).toBe(2);
    await h.browser().api.people.stopEmails(tokenIn(sentTo(stopper)[0]?.text ?? ''));
    // Sam invites all three: the same answer for each, and each an email in the outbox, which the sender then decides on.
    const from = h.logs.length;
    const made = await sam.api.teams.invite([fresh, stopper, emailed]);
    expect(made.team.invitations.map((i) => [i.sends, i.resendWhy, i.resendAt === null])).toEqual([[1, 'recent', false], [1, 'recent', false], [1, 'recent', false]]);
    await expect.poll(() => sentTo(fresh).length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => droppedSince(from).sort(), { timeout: 10_000 }).toEqual(['address', 'stopped']);
    expect([sentTo(stopper).length, sentTo(emailed).length]).toEqual([1, 1]);
    expect(said(from, 'mail sent')).toHaveLength(1);
  });
});

describe('what the email says', () => {
  it('says names as they’re written but never as links a mail app could follow, and cuts a long team name in the subject; its link and the inviter’s address stay as they are', async () => {
    const sam = await withGoogle(unique('sam'), 'Dr.Evil Kowalski');
    const team = 'evil.com: free money at you@bank.example, for the whole crew';
    await sam.api.teams.create(team);
    const to = unique('priya');
    await sam.api.teams.invite([to]);
    await expect.poll(() => sentTo(to).length, { timeout: 10_000 }).toBe(1);
    const [email] = sentTo(to);
    const zw = '\u200B';
    const defused = 'evil.' + zw + 'com:' + zw + ' free money at you@' + zw + 'bank.' + zw + 'example, for the whole crew';
    // The subject: the inviter's first name and up to 40 characters of the team's, each dot, colon and at followed by a
    // zero-width space.
    expect(email?.subject).toBe(`Dr.${zw}Evil invited you to join ${'evil.' + zw + 'com:' + zw + ' free money at you@' + zw + 'bank.' + zw + 'exampl…'} on Alcove`);
    expect(Array.from('evil.com: free money at you@bank.exampl…')).toHaveLength(40);
    // The body has the whole name, defused, in its HTML and its text, and never as it was typed.
    for (const body of [email?.html ?? '', email?.text ?? '']) {
      expect(body).toContain(defused);
      expect(body).toContain(`Dr.${zw}Evil invited you to join`);
      expect(body).not.toContain('evil.com');
      expect(body).not.toContain('you@bank');
      expect(body).toMatch(new RegExp(`${ORIGIN}/invite#[A-Za-z0-9_-]{43}`));
      // The inviter's address is said as it is, beside their name, which is defused.
      expect(body).toContain(`Dr.${zw}Evil Kowalski (${sam.email}) invited you.`);
    }
  });
});
