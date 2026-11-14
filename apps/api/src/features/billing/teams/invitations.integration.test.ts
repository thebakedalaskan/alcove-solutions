/**
 * Invitations to a team (docs: Plans and usage › Team › Invitations), end to end: the real API over HTTP via @alcove/api-http,
 * real Postgres, and the stand-in Resend the email goes to. A first invitation makes a free team named for the company page
 * (or for whoever invites, at a personal address); Alcove emails each address, and an account that signs in with it sees it
 * in the app, accepts it or puts it aside; an invitation's own link joins its team; someone on a team joins another only by
 * leaving theirs; invitations are sent again at most once a day and three times in their 30 days, cancelled, and end with
 * their inviter and when they run out; nothing of them reaches another team; and the company page says who's invited.
 * Asking a free team's admin to upgrade it, and renaming it, are here too.
 */
import { AlcoveApiError, InvitationsMadeSchema, MyTeamSchema, OPERATION_HEADER } from '@alcove/api';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openOwner } from '../../../keys/owners';
import { maintain } from '../../../maintenance';
import { ORIGIN, startHarness, type Harness } from '../../../testing/harness';
import { profile } from '../../profile/profile';
import { creditBySupport } from '../support';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(async () => { vi.useRealTimers(); await h.resetLimits(); });

const DAY = 86_400_000;
const LICENSE = 40_000_000;
const refusal = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
let seq = 0;
const unique = (who = 'person', domain = 'tests.example') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@${domain}`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email, name: r.session.user.name };
}
type Account = Awaited<ReturnType<typeof account>>;
const secretOf = (link: string) => link.slice(link.indexOf('#') + 1);
const ENDED = 'not-found: That invitation doesn’t exist, or it has ended.';
const NOWHERE = 'not-found: This link doesn’t lead anywhere any more. Ask whoever sent it for a new one.';
const ON_A_TEAM = 'conflict: You’re on a team already. Leave it to join this one.';
const ONLY_THEIRS = 'forbidden: Only whoever invited them, or the team’s admin, can do that.';
/** The emails sent to `to`, once `n` have gone: they go once the invitation is committed, a moment after its answer. */
async function emailsTo(to: string, n = 1) {
  await expect.poll(() => h.resend.sent.filter((e) => e.to.includes(to)).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(n);
  return h.resend.sent.filter((e) => e.to.includes(to));
}
/** The invitation link an email to `to` carries (the latest). */
async function linkTo(to: string, n = 1): Promise<string> {
  const link = /https:\/\/localhost:3000\/invite#[A-Za-z0-9_-]{43}/.exec((await emailsTo(to, n)).at(-1)?.text ?? '')?.[0];
  if (!link) throw new Error('no invitation link in the email');
  return link;
}
/** `who`'s invitation from `from`, as they see it in the app. */
async function invitationFrom(who: Account, from: Account) {
  const found = (await who.api.teams.invitations()).find((i) => i.from.email === from.email);
  if (!found) throw new Error('no invitation from them');
  return found;
}
/** `who` gets on `admin`'s team as anyone does: invited, and accepting it. */
async function joined(admin: Account, who: Account) {
  await admin.api.teams.invite([who.email]);
  return who.api.teams.acceptInvitation((await invitationFrom(who, admin)).id);
}
const kinds = async (who: Account) => (await who.api.plans.plan()).notices.map((n) => n.kind);
const give = (who: Account, microUsd: number) => creditBySupport(h.deps, who.email, microUsd, { lookup: 'ids-and-addresses' });
const memberId = async (admin: Account, who: Account) => (await admin.api.teams.mine())?.members.find((m) => m.person.email === who.email)?.id ?? 'not on the team';
/** The routes an account's receipts were kept for. */
const methods = async (who: Account) => (await h.pool.query<{ method: string }>('SELECT method FROM operations WHERE owner_id = $1', [who.session.ownerId])).rows.map((r) => r.method);
/**
 * Sends one request twice under one operation ID, as a retry does when an answer is lost on its way: what it was answered
 * with, and what the retry was answered with, from the receipt the first kept.
 */
async function twice(who: Account, method: string, path: string, body?: unknown): Promise<[unknown, unknown]> {
  const op = randomBytes(16).toString('base64url');
  const send = async () => {
    const res = await who.fetch(`${h.baseUrl}/v1${path}`, { method, headers: { [OPERATION_HEADER]: op, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(res.status, `${method} ${path}`).toBe(200);
    const answer: unknown = await res.json();
    return answer;
  };
  return [await send(), await send()];
}

describe('inviting', () => {
  it('a first invitation makes a free team named for the company page, and Alcove emails each address from it, replying to whoever invited', async () => {
    const sam = await account(unique('sam', 'vandelay.industries'));
    const priya = await account();
    const ken = unique('ken');
    expect(await sam.api.teams.mine()).toBeNull();
    // An address typed twice, once in capitals with spaces, is one invitation.
    const made = await sam.api.teams.invite([priya.email, ken, ` ${ken.toUpperCase()} `]);
    expect(made).toMatchObject({
      invited: 2, already: 0,
      team: { name: 'Vandelay Industries', role: 'admin', tier: 'free', licensed: false, members: [{ role: 'admin', you: true, person: { email: sam.email } }], licenses: { unconsumed: 0, autoPurchase: false } }
    });
    expect(made.team.invitations.map((i) => i.person.email).sort()).toEqual([priya.email, ken].sort());
    for (const i of made.team.invitations) {
      // First invited now, sent once by this team, and not to be sent again for a day.
      expect(i).toMatchObject({ invitedBy: { email: sam.email, name: sam.name }, you: true, manage: true, madeAt: i.at, resendWhy: 'recent', sends: 1 });
      expect(Date.parse(i.expiresAt) - Date.parse(i.at)).toBe(30 * DAY);
      // Sent once a day at most.
      expect(Date.parse(i.resendAt ?? '') - Date.parse(i.at)).toBe(DAY);
    }
    expect((await sam.api.plans.plan()).team).toMatchObject({ name: 'Vandelay Industries', role: 'admin', tier: 'free', licensed: false });
    // An email each, from Alcove, replying to Sam, with a link of its own, one that stops them, and its pictures inline.
    const [email] = await emailsTo(ken);
    expect(email).toMatchObject({
      from: 'Alcove <invites@mail.alcove.solutions>', to: [ken], reply_to: sam.email, subject: 'Sam invited you to join Vandelay Industries on Alcove',
      headers: { 'List-Unsubscribe': expect.stringMatching(new RegExp(`^<${h.baseUrl}/v1/mail/stop\\?token=[A-Za-z0-9_-]{43}>$`)), 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    });
    expect(email?.attachments?.map((a) => [a.content_id, a.content_type])).toEqual([['evening@alcove.solutions', 'image/png'], ['evening-night@alcove.solutions', 'image/png']]);
    expect(email?.html).toContain('cid:evening@alcove.solutions');
    expect(email?.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(email?.text).toMatch(new RegExp(`Stop them: ${ORIGIN}/stop-email#[A-Za-z0-9_-]{43}`));
    const link = await linkTo(ken);
    expect(email?.html).toContain(link);
    expect(link).not.toBe(await linkTo(priya.email));
    // Its link says who asked, and the team, to anyone holding it: the people on it by name, never their address.
    expect(await h.browser().api.people.peekInvite(secretOf(link))).toEqual({
      kind: 'invitation', from: expect.objectContaining({ email: sam.email, name: sam.name }), yours: false,
      team: { name: 'Vandelay Industries', people: 1, faces: [expect.objectContaining({ name: sam.name, email: '' })] }, invitationId: null
    });
    // Only its hash is kept.
    const rows = await h.pool.query<{ secret_sha256: Buffer }>('SELECT secret_sha256 FROM team_invitations WHERE team_id = $1', [made.team.id]);
    expect(rows.rows.filter((r) => r.secret_sha256.equals(createHash('sha256').update(secretOf(link)).digest()))).toHaveLength(1);
  });

  it('at a personal address the team is named for whoever invites, and the company page says who’s invited to it', async () => {
    const solo = await account(unique('solo', 'personal.example'));
    expect(await solo.api.people.team()).toBeNull();
    expect((await solo.api.teams.invite([unique('pal')])).team).toMatchObject({ name: 'Solo’s team', tier: 'free', role: 'admin' });
    // At a company, the company page's people say whether they've been invited to the team you're on.
    const art = await account(unique('art', 'vandelay.industries'));
    expect((await art.api.people.team())?.members.some((m) => m.invited)).toBe(false);
    await art.api.teams.invite(['lena@vandelay.industries']);
    expect((await art.api.people.team())?.members.filter((m) => m.invited).map((m) => m.person.email)).toEqual(['lena@vandelay.industries']);
    // Someone else at the company, on no team, sees nobody invited: it's per team.
    expect((await (await account(unique('maya', 'vandelay.industries'))).api.people.team())?.members.some((m) => m.invited)).toBe(false);
  });

  it('invites up to what’s left of the day’s invitations, in the order asked, saying how many it left out; refuses your own address, and anything once none are left, changing nothing; and takes more the next day', async () => {
    const sam = await account();
    expect(await refusal(sam.api.teams.invite([sam.email.toUpperCase()]))).toBe('invalid: That’s you.');
    expect(await refusal(sam.api.teams.invite(['not an address']))).toMatch(/^invalid: /);
    await h.setLimit('team.invitations_per_day', 2);
    // Three asked with two left today: the first two, and one over.
    const [a, b, c] = [unique('a'), unique('b'), unique('c')];
    const made = await sam.api.teams.invite([a, b, c]);
    expect(made).toMatchObject({ invited: 2, already: 0, over: 1 });
    expect(made.team.invitations.map((i) => i.person.email).sort()).toEqual([a, b].sort());
    // None left now: refused, with nothing changed.
    expect(await refusal(sam.api.teams.invite([c]))).toBe('conflict: You’ve invited 2 people today. Invite more tomorrow, or copy your link.');
    // Someone invited already, who can't be sent it again yet, counts nothing, and isn't refused.
    expect(await sam.api.teams.invite([a])).toMatchObject({ invited: 1, already: 0, over: 0 });
    expect((await sam.api.teams.mine())?.invitations).toHaveLength(2);
    // With no team and none left, nothing at all is made: no team either.
    await sam.api.teams.delete();
    expect(await refusal(sam.api.teams.invite([c]))).toBe('conflict: You’ve invited 2 people today. Invite more tomorrow, or copy your link.');
    expect(await sam.api.teams.mine()).toBeNull();
    // The next day (UTC), more.
    const now = new Date();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1) });
    expect(await sam.api.teams.invite([c])).toMatchObject({ invited: 1, over: 0 });
  });

  it('an account sees its invitations by the address it signs in with, accepts one and is on the team, and the invitation is used up', async () => {
    const sam = await account();
    const priya = await account();
    const ken = await account();
    await sam.api.teams.invite([priya.email]);
    expect(await ken.api.teams.invitations()).toEqual([]);
    const seen = await invitationFrom(priya, sam);
    expect(seen).toMatchObject({
      from: { email: sam.email, name: sam.name }, putAside: false,
      // tests.example is a work domain: the team is named for its company page.
      team: { name: 'Tests', people: 1, faces: [{ name: sam.name, email: '' }] }
    });
    expect(Date.parse(seen.expiresAt) - Date.parse(seen.at)).toBe(30 * DAY);
    // Another account can't take it, whatever it knows.
    expect(await refusal(ken.api.teams.acceptInvitation(seen.id))).toBe(ENDED);
    const team = await priya.api.teams.acceptInvitation(seen.id);
    expect(team).toMatchObject({ role: 'member', tier: 'free', licensed: false, invitations: [], licenses: null, members: [{ person: { email: sam.email } }, { you: true, person: { email: priya.email } }] });
    expect(await priya.api.teams.invitations()).toEqual([]);
    expect(await refusal(priya.api.teams.acceptInvitation(seen.id))).toBe(ENDED);
    // Its email's link leads nowhere now, and invited again she's on it already.
    expect(await refusal(h.browser().api.people.peekInvite(secretOf(await linkTo(priya.email))))).toBe(NOWHERE);
    expect(await sam.api.teams.invite([priya.email])).toMatchObject({ invited: 0, already: 1 });
    // A free team tells nobody about licenses, and she stays on her own plan.
    expect(await priya.api.plans.plan()).toMatchObject({ kind: 'free', team: { role: 'member', tier: 'free', licensed: false } });
    expect([await kinds(priya), await kinds(sam)]).toEqual([[], []]);
  });

  it('Not now puts an invitation aside for whoever it’s to alone, in their own profile: it stays theirs to accept, the team sees nothing change, and no row or receipt says so', async () => {
    const sam = await account();
    const priya = await account();
    const ken = await account();
    await sam.api.teams.invite([priya.email]);
    const { id } = await invitationFrom(priya, sam);
    const before = (await sam.api.teams.mine())?.invitations;
    expect(await refusal(ken.api.teams.putInvitationAside(id))).toBe(ENDED);
    await priya.api.teams.putInvitationAside(id);
    await priya.api.teams.putInvitationAside(id);
    expect(await priya.api.teams.invitations()).toEqual([expect.objectContaining({ id, putAside: true })]);
    expect((await sam.api.teams.mine())?.invitations).toEqual(before);
    // It's in her profile, sealed in her own vault, and in no column or receipt.
    const o = await openOwner(h.deps, priya.session.ownerId, undefined);
    expect((await profile(o)).putAside).toEqual([id]);
    expect((await h.pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'team_invitations' AND column_name = 'put_aside'")).rows[0]).toEqual({ n: 0 });
    expect(await methods(priya)).not.toContain('POST /v1/team/invitations/:id/put-aside');
    // Accepted, as ever; and once it's no invitation to her, her profile forgets it as her invitations are read.
    expect(await priya.api.teams.acceptInvitation(id)).toMatchObject({ role: 'member' });
    expect(await priya.api.teams.invitations()).toEqual([]);
    expect((await profile(o)).putAside).toEqual([]);
  });

  it('its link says its own ID to whoever it’s to, signed in, and whether whoever opens it is on its team; nobody joins their own team by it, which leaves it for whoever it’s for', async () => {
    const sam = await account();
    const [priya, ken, stranger] = await Promise.all([account(), account(), account()]);
    await joined(sam, ken);
    await sam.api.teams.invite([priya.email]);
    const secret = secretOf(await linkTo(priya.email));
    const { id } = await invitationFrom(priya, sam);
    // To Priya, signed in, it says which invitation it is, so Not now can put it aside; to anyone else, signed in or not, it doesn't.
    expect(await priya.api.people.peekInvite(secret)).toMatchObject({ kind: 'invitation', yours: false, invitationId: id });
    expect(await h.browser().api.people.peekInvite(secret)).toMatchObject({ kind: 'invitation', yours: false, invitationId: null });
    expect(await stranger.api.people.peekInvite(secret)).toMatchObject({ yours: false, invitationId: null });
    // To someone on its team it's theirs, and they can't join their own team by it: it's left as it is.
    expect(await ken.api.people.peekInvite(secret)).toMatchObject({ yours: true, invitationId: null });
    for (const who of [ken, sam]) expect(await refusal(who.api.teams.join(secret))).toBe('conflict: You’re on that team already.');
    expect(await priya.api.people.peekInvite(secret)).toMatchObject({ invitationId: id });
    expect(await priya.api.teams.join(secret)).toMatchObject({ role: 'member' });
  });
});

describe('sending again and cancelling', () => {
  it('sends again once a day at most and three times in its days, starting them again, with the same link; cancelling and inviting again counts on', async () => {
    // Ten days for an invitation, so the days it's sent in are seen within a session's life.
    const LIFE = 10 * DAY;
    await h.setLimit('team.invitation_seconds', LIFE / 1000);
    const sam = await account();
    const priya = await account();
    const made = (await sam.api.teams.invite([priya.email])).team.invitations[0];
    if (!made) throw new Error('no invitation');
    const first = Date.parse(made.at);
    const link = await linkTo(priya.email);
    expect(await refusal(sam.api.teams.resendInvitation(made.id))).toBe('conflict: That invitation was sent too recently to send again yet.');
    // A day on: sent again, its 30 days from now, by email to the same link.
    vi.useFakeTimers({ toFake: ['Date'], now: first + DAY + 1000 });
    const again = (await sam.api.teams.resendInvitation(made.id)).invitations[0];
    expect(again).toMatchObject({
      id: made.id, madeAt: made.madeAt, at: new Date(first + DAY + 1000).toISOString(), expiresAt: new Date(first + DAY + 1000 + LIFE).toISOString(),
      resendAt: new Date(first + 2 * DAY + 1000).toISOString(), resendWhy: 'recent', sends: 2
    });
    expect(await linkTo(priya.email, 2)).toBe(link);
    // A third, a day after that; then it's been sent 3 times, and can't be until the first is as old as an invitation lasts.
    vi.setSystemTime(first + 2 * DAY + 2000);
    expect((await sam.api.teams.resendInvitation(made.id)).invitations[0]).toMatchObject({ madeAt: made.madeAt, resendAt: new Date(first + LIFE).toISOString(), resendWhy: 'most', sends: 3 });
    await emailsTo(priya.email, 3);
    vi.setSystemTime(first + 4 * DAY);
    expect(await refusal(sam.api.teams.resendInvitation(made.id))).toBe('conflict: That invitation has been sent 3 times, so it can’t be sent again yet.');
    // Cancelled and invited again, it's made, but can't be sent until then either: no email goes.
    await sam.api.teams.cancelInvitation(made.id);
    const remade = (await sam.api.teams.invite([priya.email])).team.invitations[0];
    expect(remade).toMatchObject({ madeAt: new Date(first + 4 * DAY).toISOString(), resendAt: new Date(first + LIFE).toISOString(), resendWhy: 'most', sends: 3 });
    expect(remade?.id).not.toBe(made.id);
    expect(await priya.api.teams.invitations()).toEqual([expect.objectContaining({ id: remade?.id })]);
    await new Promise((r) => setTimeout(r, 300));
    expect(h.resend.sent.filter((e) => e.to.includes(priya.email))).toHaveLength(3);
    // Once the first is that old, one more goes.
    vi.setSystemTime(first + LIFE + 1000);
    expect((await sam.api.teams.resendInvitation(remade?.id ?? '')).invitations[0]).toMatchObject({ resendAt: new Date(first + DAY + 1000 + LIFE).toISOString(), resendWhy: 'most', sends: 3 });
    await emailsTo(priya.email, 4);
  });

  it('sends again and cancels for whoever invited them and the admin alone, and a cancelled invitation’s link leads nowhere', async () => {
    const sam = await account();
    const ken = await account();
    const [priya, lee] = [unique('priya'), unique('lee')];
    await joined(sam, ken);
    await sam.api.teams.invite([priya]);
    await ken.api.teams.invite([lee]);
    const list = (await ken.api.teams.mine())?.invitations ?? [];
    const samsOne = list.find((i) => i.person.email === priya);
    const kensOne = list.find((i) => i.person.email === lee);
    // Everyone on the team sees every invitation, and who may manage each.
    expect([samsOne, kensOne]).toMatchObject([{ invitedBy: { email: sam.email }, you: false, manage: false }, { invitedBy: { email: ken.email }, you: true, manage: true }]);
    expect((await sam.api.teams.mine())?.invitations.map((i) => [i.person.email, i.manage]).sort()).toEqual([[lee, true], [priya, true]].sort());
    const link = await linkTo(priya);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DAY + 1000 });
    expect(await refusal(ken.api.teams.resendInvitation(samsOne?.id ?? ''))).toBe(ONLY_THEIRS);
    expect(await refusal(ken.api.teams.cancelInvitation(samsOne?.id ?? ''))).toBe(ONLY_THEIRS);
    // The admin manages anyone's.
    expect((await sam.api.teams.resendInvitation(kensOne?.id ?? '')).invitations.find((i) => i.id === kensOne?.id)).toMatchObject({ invitedBy: { email: ken.email } });
    await ken.api.teams.cancelInvitation(kensOne?.id ?? '');
    expect((await sam.api.teams.cancelInvitation(samsOne?.id ?? '')).invitations).toEqual([]);
    expect(await refusal(h.browser().api.people.peekInvite(secretOf(link)))).toBe(NOWHERE);
    expect(await refusal(sam.api.teams.cancelInvitation(samsOne?.id ?? ''))).toBe(ENDED);
  });

  it('counts sending again against the day’s invitations of whoever does it', async () => {
    await h.setLimit('team.invitations_per_day', 1);
    const sam = await account();
    const { id } = (await sam.api.teams.invite([unique()])).team.invitations[0] ?? { id: '' };
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DAY + 1000 });
    await sam.api.teams.resendInvitation(id);
    vi.setSystemTime(Date.now() + DAY + 1000);
    await sam.api.teams.resendInvitation(id);
    expect(await refusal(sam.api.teams.invite([unique()]))).toBe('conflict: You’ve invited 1 person today. Invite more tomorrow, or copy your link.');
  });
});

describe('joining', () => {
  it('an invitation’s own link joins its team once, from a new account at another address or from an account that has one', async () => {
    const sam = await account();
    const priya = await account();
    const newcomer = unique('newcomer');
    await sam.api.teams.invite([newcomer, priya.email]);
    // Someone signs up from the email at another address of theirs: anyone holding the link can use it, once.
    const other = await account(unique('newcomer.work'));
    const via = secretOf(await linkTo(newcomer));
    expect(await other.api.teams.join(via)).toMatchObject({ role: 'member', members: [{}, { you: true, person: { email: other.email } }] });
    expect((await sam.api.teams.mine())?.invitations.map((i) => i.person.email)).toEqual([priya.email]);
    expect(await refusal((await account()).api.teams.join(via))).toBe(NOWHERE);
    // An account that had one joins from its email too, and it's used up in the app as well.
    expect(await priya.api.teams.join(secretOf(await linkTo(priya.email)))).toMatchObject({ role: 'member' });
    expect(await priya.api.teams.invitations()).toEqual([]);
    // A made-up secret and a malformed one.
    expect(await refusal(priya.api.teams.join('B'.repeat(43)))).toBe(NOWHERE);
    expect(await refusal(priya.api.teams.join('too-short'))).toMatch(/^invalid: /);
    // Joining keeps its receipt by IDs and counts alone (as `receipts` shows), never the secret, which is in its body.
    expect(await methods(priya)).toContain('POST /v1/team/join');
  });

  it('someone on a team joins another only by leaving theirs: a member leaves it, its admin alone deletes it, and its admin with others can’t', async () => {
    const sam = await account();
    const [ken, lu, oz, ol] = await Promise.all([account(), account(), account(), account()]);
    await sam.api.teams.create('Vandelay');
    // Ken is on Lumen as a member; Lu runs Lumen with a license nobody took; Oz runs Other, with Ol on it.
    await lu.api.teams.create('Lumen');
    await give(lu, LICENSE);
    await lu.api.teams.buyLicenses(1, LICENSE);
    await joined(lu, ken);
    await oz.api.teams.create('Other');
    await joined(oz, ol);
    await sam.api.teams.invite([ken.email, lu.email, oz.email]);
    // Asked first: without leaving, nothing changes, and the refusal names no team (the app has both names).
    const kens = await invitationFrom(ken, sam);
    expect(await refusal(ken.api.teams.acceptInvitation(kens.id))).toBe(ON_A_TEAM);
    expect((await ken.api.teams.mine())?.name).toBe('Lumen');
    // Leaving Lumen as he joins: Lumen goes on without him, and his license (the one Lu bought) isn't refunded.
    expect(await ken.api.teams.acceptInvitation(kens.id, true)).toMatchObject({ name: 'Vandelay', role: 'member' });
    expect((await lu.api.teams.mine())?.members.map((m) => m.person.email)).toEqual([lu.email]);
    // Lu, alone on Lumen, deletes it as she joins: its unconsumed licenses go back to her balance.
    await give(lu, LICENSE);
    await lu.api.teams.buyLicenses(1, LICENSE);
    expect(await lu.api.teams.acceptInvitation((await invitationFrom(lu, sam)).id, true)).toMatchObject({ name: 'Vandelay', role: 'member' });
    expect((await lu.api.plans.plan()).balance.history[0]).toMatchObject({ label: 'Team licenses refunded, 1', microUsd: LICENSE });
    // Oz runs Other with Ol on it: refused even when asked to leave.
    expect(await refusal(oz.api.teams.acceptInvitation((await invitationFrom(oz, sam)).id, true))).toBe('conflict: You admin your team, and 1 other is on it. You can join another once nobody else is on yours.');
    expect((await oz.api.teams.mine())?.name).toBe('Other');
    expect((await sam.api.teams.mine())?.members.map((m) => m.person.email)).toEqual([sam.email, ken.email, lu.email]);
  });

  it('takes a license on joining a team that has one, as any visit does', async () => {
    const sam = await account();
    const priya = await account();
    await sam.api.teams.create('Vandelay');
    await give(sam, LICENSE);
    await sam.api.teams.buyLicenses(1, LICENSE);
    expect(await joined(sam, priya)).toMatchObject({ tier: 'team', licensed: true });
    expect((await sam.api.teams.mine())?.tier).toBe('team');
  });
});

describe('when invitations end', () => {
  it('ends what someone invited when they leave the team, are taken off it, or delete their account', async () => {
    const sam = await account();
    const [ken, lee, mo] = await Promise.all([account(), account(), account()]);
    for (const who of [ken, lee, mo]) await joined(sam, who);
    const [priya, quinn, rae] = [unique('priya'), unique('quinn'), unique('rae')];
    await ken.api.teams.invite([priya]);
    await lee.api.teams.invite([quinn]);
    await mo.api.teams.invite([rae]);
    const links = { priya: await linkTo(priya), quinn: await linkTo(quinn), rae: await linkTo(rae) };
    const invited = async () => ((await sam.api.teams.mine())?.invitations ?? []).map((i) => i.person.email).sort();
    expect(await invited()).toEqual([priya, quinn, rae].sort());
    await ken.api.teams.leave();
    expect(await invited()).toEqual([quinn, rae].sort());
    await sam.api.teams.remove(await memberId(sam, lee));
    expect(await invited()).toEqual([rae]);
    await mo.api.account.delete();
    expect(await invited()).toEqual([]);
    for (const link of Object.values(links)) expect(await refusal(h.browser().api.people.peekInvite(secretOf(link)))).toBe(NOWHERE);
    // The admin can invite them again.
    expect((await sam.api.teams.invite([priya])).invited).toBe(1);
  });

  it('runs out after its days: refused, out of every list, taken out by upkeep, and made again by inviting', async () => {
    await h.setLimit('team.invitation_seconds', 2 * 86_400);
    const sam = await account();
    const priya = await account();
    const made = (await sam.api.teams.invite([priya.email])).team;
    const { id } = await invitationFrom(priya, sam);
    const link = await linkTo(priya.email);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * DAY + 1000 });
    expect(await priya.api.teams.invitations()).toEqual([]);
    expect((await sam.api.teams.mine())?.invitations).toEqual([]);
    expect(await refusal(priya.api.teams.acceptInvitation(id))).toBe(ENDED);
    expect(await refusal(h.browser().api.people.peekInvite(secretOf(link)))).toBe(NOWHERE);
    expect(await refusal(priya.api.teams.join(secretOf(link)))).toBe(NOWHERE);
    await maintain(h.deps);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM team_invitations WHERE team_id = $1', [made.id])).rows[0]).toEqual({ n: 0 });
    // Invited again: a new invitation, with a new link; the old one still leads nowhere.
    await sam.api.teams.invite([priya.email]);
    expect((await invitationFrom(priya, sam)).id).not.toBe(id);
    expect(await refusal(h.browser().api.people.peekInvite(secretOf(link)))).toBe(NOWHERE);
  });
});

describe('what the release before this one makes', () => {
  it('upkeep takes the one-time links to a team it made once they’ve run out, as it can still make them while a deploy rolls, and leaves the rest', async () => {
    const sam = await account();
    const { id } = await sam.api.teams.create('Vandelay');
    await h.pool.query('INSERT INTO team_invites (secret_sha256, team_id, expires_at) VALUES ($1, $3, $4), ($2, $3, $5)', [randomBytes(32), randomBytes(32), id, new Date(Date.now() - 1000), new Date(Date.now() + DAY)]);
    await maintain(h.deps);
    expect((await h.pool.query('SELECT expires_at > now() AS live FROM team_invites WHERE team_id = $1', [id])).rows).toEqual([{ live: true }]);
  });
});

describe('two at once', () => {
  it('two people inviting one address at once make one invitation, and someone taken off as they invite is told so or invites, never an error of Alcove’s', async () => {
    const sam = await account();
    const ken = await account();
    await joined(sam, ken);
    for (let n = 0; n < 4; n++) {
      const to = unique('both');
      expect(await Promise.all([refusal(sam.api.teams.invite([to])), refusal(ken.api.teams.invite([to]))])).toEqual(['succeeded', 'succeeded']);
      expect((await sam.api.teams.mine())?.invitations.filter((i) => i.person.email === to)).toHaveLength(1);
    }
    for (let n = 0; n < 3; n++) {
      const lee = await account();
      await joined(sam, lee);
      const leeId = await memberId(sam, lee);
      const [invited, removed] = await Promise.all([refusal(lee.api.teams.invite([unique('late')])), refusal(sam.api.teams.remove(leeId))]);
      expect(removed).toBe('succeeded');
      expect(['succeeded', 'conflict: You’re not on that team any more.']).toContain(invited);
      // Whatever he asked of the team went with him.
      expect((await sam.api.teams.mine())?.invitations.filter((i) => i.invitedBy.email === lee.email)).toEqual([]);
    }
  });
});

describe('receipts', () => {
  it('a retry of inviting, sending again, cancelling, accepting, joining or renaming is answered from a receipt that keeps IDs and counts, and no name or address', async () => {
    const sam = await account(unique('sam', 'vandelay.industries'));
    const [priya, ken, lu] = await Promise.all([account(), account(), account()]);
    const named = [sam.email, sam.name, priya.email, priya.name, ken.email, ken.name, lu.email, lu.name, 'Vandelay Industries', 'Renamed Crew'];
    const says = (v: unknown) => named.filter((n) => JSON.stringify(v).includes(n));
    // Inviting, once: the retry's answer has the answer's shape, by IDs and counts alone.
    const [made, retried] = await twice(sam, 'POST', '/team/invitations', { emails: [priya.email, ken.email] });
    const first = InvitationsMadeSchema.parse(made);
    const again = InvitationsMadeSchema.parse(retried);
    expect(says(first)).not.toEqual([]);
    expect(says(again)).toEqual([]);
    expect(again).toMatchObject({ invited: 2, already: 0, over: 0, team: { id: first.team.id, name: '', role: 'admin', tier: 'free', members: [{ id: first.team.members[0]?.id, role: 'admin', you: true }] } });
    expect(again.team.invitations.map((i) => [i.id, i.sends, i.resendWhy])).toEqual(first.team.invitations.map((i) => [i.id, i.sends, i.resendWhy]));
    expect((await sam.api.teams.mine())?.invitations).toHaveLength(2);
    const priyas = first.team.invitations.find((i) => i.person.email === priya.email)?.id ?? '';
    const kens = first.team.invitations.find((i) => i.person.email === ken.email)?.id ?? '';
    // Sending again, a day on; cancelling; renaming; accepting; joining by the team's link: each the same.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DAY + 1000 });
    const link = secretOf((await sam.api.people.inviteLink()).link);
    const asked: [typeof sam, string, string, unknown][] = [
      [sam, 'POST', `/team/invitations/${priyas}/resend`, {}],
      [sam, 'DELETE', `/team/invitations/${kens}`, undefined],
      [sam, 'PUT', '/team/name', { name: 'Renamed Crew' }],
      [priya, 'POST', `/team/invitations/${priyas}/accept`, { leave: false }],
      [lu, 'POST', '/team/join', { secret: link, leave: false }]
    ];
    for (const [who, method, path, body] of asked) {
      const [answer, retry] = await twice(who, method, path, body);
      const team = MyTeamSchema.parse(answer);
      const kept = MyTeamSchema.parse(retry);
      expect(says(team), path).not.toEqual([]);
      expect(says(kept), path).toEqual([]);
      expect(kept, path).toMatchObject({ id: team.id, name: '', role: team.role, tier: team.tier, licensed: team.licensed, storage: team.storage, licenses: team.licenses });
      expect(kept.members.map((m) => [m.id, m.role, m.you, m.license.state]), path).toEqual(team.members.map((m) => [m.id, m.role, m.you, m.license.state]));
      expect(kept.invitations.map((i) => i.id), path).toEqual(team.invitations.map((i) => i.id));
    }
    // Each happened once: sent again once, cancelled, renamed, and both on the team.
    expect(await sam.api.teams.mine()).toMatchObject({ name: 'Renamed Crew', invitations: [] });
    expect((await sam.api.teams.mine())?.members.map((m) => m.person.email)).toEqual([sam.email, priya.email, lu.email]);
  });
});

describe('nobody reaches another team’s invitations', () => {
  it('takes an invitation’s ID from a request only on its own team, or from whoever it’s to', async () => {
    const [ann, cy, eve, priya, dee] = await Promise.all([account(), account(), account(), account(), account()]);
    await ann.api.teams.invite([priya.email]);
    await cy.api.teams.invite([dee.email]);
    const ours = await invitationFrom(priya, ann);
    const theirs = await invitationFrom(dee, cy);
    const made = 'AAAAAAAAAAAAAAAAAAAAAA';
    // Another team's, and one that never was: the same not-found, to its admin and to someone on no team.
    for (const call of [() => ann.api.teams.resendInvitation(theirs.id), () => ann.api.teams.cancelInvitation(theirs.id), () => ann.api.teams.cancelInvitation(made), () => eve.api.teams.cancelInvitation(ours.id), () => eve.api.teams.resendInvitation(ours.id)]) {
      expect(await refusal(call())).toBe(ENDED);
    }
    // Someone else's invitation, to accept or put aside: the same.
    for (const call of [() => dee.api.teams.acceptInvitation(ours.id), () => dee.api.teams.putInvitationAside(ours.id), () => priya.api.teams.acceptInvitation(theirs.id), () => eve.api.teams.acceptInvitation(made)]) {
      expect(await refusal(call())).toBe(ENDED);
    }
    expect((await cy.api.teams.mine())?.invitations.map((i) => i.id)).toEqual([theirs.id]);
    expect(await eve.api.teams.mine()).toBeNull();
  });
});

describe('a free team', () => {
  it('lets no other team’s admin, nor anyone on it, dismiss what its admin was told by its ID; and licenses bought answer every ask, for good', async () => {
    const [sam, ken, lu] = await Promise.all([account(), account(), account()]);
    await sam.api.teams.create('Vandelay');
    await joined(sam, ken);
    await lu.api.teams.create('Lumen');
    await ken.api.teams.askToUpgrade();
    const [asked] = (await sam.api.plans.plan()).notices;
    expect(asked?.kind).toBe('upgrade-asked');
    for (const who of [lu, ken]) expect(await refusal(who.api.plans.dismissNotice(asked?.id ?? ''))).toMatch(/^not-found: /);
    expect((await sam.api.plans.plan()).notices).toMatchObject([{ id: asked?.id, kind: 'upgrade-asked' }]);
    // Licenses bought answer it: gone, and still gone once they're refunded before anyone took one.
    await give(sam, LICENSE);
    await sam.api.teams.buyLicenses(1, LICENSE);
    expect((await sam.api.plans.plan()).notices).toEqual([]);
    await sam.api.teams.refundLicenses();
    expect((await sam.api.teams.mine())?.tier).toBe('free');
    expect((await sam.api.plans.plan()).notices).toEqual([]);
    // On Free again, he can ask again.
    await ken.api.teams.askToUpgrade();
    expect((await sam.api.plans.plan()).notices.map((n) => n.kind)).toEqual(['upgrade-asked']);
  });

  it('is renamed by its admin alone', async () => {
    const sam = await account();
    const ken = await account();
    await sam.api.teams.create('Vandelay');
    await joined(sam, ken);
    expect(await sam.api.teams.rename('  Vandelay Industries  ')).toMatchObject({ name: 'Vandelay Industries' });
    expect((await ken.api.plans.plan()).team).toMatchObject({ name: 'Vandelay Industries' });
    expect(await refusal(ken.api.teams.rename('Kensington'))).toBe('forbidden: Only the team’s admin can do that.');
    expect(await refusal(sam.api.teams.rename('   '))).toMatch(/^invalid: /);
    expect(await refusal(sam.api.teams.rename('x'.repeat(121)))).toMatch(/^invalid: /);
  });

  it('tells its admin once a week at most that someone on it asked them to upgrade it, until they dismiss it, and never once it’s on Team', async () => {
    const sam = await account();
    const [ken, lee] = await Promise.all([account(), account()]);
    await sam.api.teams.create('Vandelay');
    await joined(sam, ken);
    await joined(sam, lee);
    const kenId = await memberId(sam, ken);
    const asks = async () => (await sam.api.plans.plan()).notices.filter((n) => n.kind === 'upgrade-asked');
    await ken.api.teams.askToUpgrade();
    const [asked] = await asks();
    expect(asked).toMatchObject({ kind: 'upgrade-asked', memberId: kenId, until: null, count: null, microUsd: null, workspaceId: null });
    // Asking again changes nothing; the admin can't ask; nobody else is told.
    await ken.api.teams.askToUpgrade();
    expect(await asks()).toHaveLength(1);
    expect(await refusal(sam.api.teams.askToUpgrade())).toBe('conflict: You’re the team’s admin: upgrade it from its page.');
    expect(await kinds(ken)).toEqual([]);
    // Dismissed as any notice is, it stays dismissed while the week runs.
    await sam.api.plans.dismissNotice(asked?.id ?? '');
    await ken.api.teams.askToUpgrade();
    expect(await asks()).toEqual([]);
    // A week on, he can ask again; someone who left isn't said.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 7 * 86_400_000 + 1000 });
    await ken.api.teams.askToUpgrade();
    await lee.api.teams.askToUpgrade();
    expect((await asks()).map((n) => n.memberId).sort()).toEqual([kenId, await memberId(sam, lee)].sort());
    await lee.api.teams.leave();
    expect((await asks()).map((n) => n.memberId)).toEqual([kenId]);
    // Once it's on Team, there's nothing to ask: what was asked isn't said, and asking is refused.
    await give(sam, LICENSE);
    await sam.api.teams.buyLicenses(1, LICENSE);
    await ken.api.auth.visit();
    expect(await asks()).toEqual([]);
    expect(await refusal(ken.api.teams.askToUpgrade())).toBe('conflict: Your team is on Team already.');
    // The team keeps who asked by member ID alone, sealed with what it bought.
    const billing = String((await h.pool.query('SELECT billing_ciphertext FROM teams WHERE admin_owner_id = $1', [sam.session.ownerId])).rows[0]?.billing_ciphertext ?? '');
    expect(billing).not.toContain(kenId);
  });
});
