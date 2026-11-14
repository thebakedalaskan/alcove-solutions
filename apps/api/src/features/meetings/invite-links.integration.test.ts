/**
 * Your own invite link (docs: Privacy, keys and sessions › Invite links; user-flows 10), end to end: the real API over HTTP via
 * @alcove/api-http, real Postgres. The link is the same on every ask; anyone who opens it sees who it's from, signed in or not;
 * an account made from it tells its sender once, and nothing else does; only the sender sees who joined; nothing readable
 * reaches a row, a receipt or a log line; and deleting either account takes what it said.
 */
import { AlcoveApiError } from '@alcove/api';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const refusal = (p: Promise<unknown>) => p.then(() => 'went through', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
let seq = 0;
const unique = (who: string) => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh demo account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(email = unique('person')) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email, isNew: r.isNew };
}
type Account = Awaited<ReturnType<typeof account>>;
/** Signs in through the stand-in Google: the same `sub` again is the same account, with whatever name it brings now. */
async function withGoogle(email: string, sub: string, name: string): Promise<Account> {
  const b = h.browser();
  h.google.next({ sub, email, name });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  return { ...b, session, email, isNew: false };
}
const secretOf = (link: string) => link.slice(link.indexOf('#') + 1);
/** An account made long enough ago that it can't say it came from anyone's link: as one made yesterday. */
const madeBefore = (who: Account) => h.pool.query("UPDATE owners SET created_at = now() - interval '61 minutes' WHERE owner_id = $1", [who.session.ownerId]);
/** Who joined from `who`'s link, as they see it: name and address, newest first. */
const joinedFrom = async (who: Account) => (await who.api.people.inviteLink()).joined.map((j) => [j.person.name, j.person.email]);
const NOWHERE = 'not-found: This invite link doesn’t lead anywhere. Ask whoever sent it to copy it again from their Team page.';
/** The line saying what someone saying they joined from a link came to. */
const JoinedLine = z.object({ msg: z.literal('joined from an invite link'), ownerId: z.string(), outcome: z.string() });

describe('your own invite link', () => {
  it('is the same on every ask, and its page says who it’s from to anyone, signed in or not', async () => {
    const maya = await account(unique('maya'));
    const first = await maya.api.people.inviteLink();
    expect(first.link).toMatch(new RegExp(`^${ORIGIN}/invite#[A-Za-z0-9_-]{43}$`));
    expect(first.joined).toEqual([]);
    expect((await maya.api.people.inviteLink()).link).toBe(first.link);

    // Signed out, the link says who it's from, as anyone else sees them: by address, not by their account's ID.
    const stranger = h.browser();
    expect(await stranger.api.auth.getSession()).toBeNull();
    expect(await stranger.api.people.peekInvite(secretOf(first.link))).toEqual({ from: expect.objectContaining({ id: maya.email, email: maya.email, name: maya.session.user.name }) });
    // A made-up link and a malformed one.
    expect(await refusal(stranger.api.people.peekInvite('A'.repeat(43)))).toBe(NOWHERE);
    expect(await refusal(stranger.api.people.peekInvite('too-short'))).toMatch(/^invalid: /);
    expect(await refusal(stranger.api.people.peekInvite(`${secretOf(first.link).slice(0, 42)}=`))).toMatch(/^invalid: /);

    // Only its hash is a column, and its secret is in no row, no receipt and no log line.
    const secret = secretOf(first.link);
    const rows = String((await h.pool.query<{ all: string | null }>(`SELECT string_agg(t, ' ') AS all FROM (SELECT row_to_json(x)::text AS t FROM invite_links x UNION ALL SELECT row_to_json(y)::text FROM invite_link_joins y) q`)).rows[0]?.all ?? '');
    expect(rows).toContain('from_ciphertext');
    for (const enc of [secret, Buffer.from(secret).toString('hex'), maya.email, maya.session.user.name]) expect(rows.includes(enc), enc).toBe(false);
    expect((await h.pool.query<{ method: string }>('SELECT method FROM operations WHERE owner_id = $1', [maya.session.ownerId])).rows.map((r) => r.method)).not.toContain('POST /v1/team/link');
    expect(h.logs.join('').includes(secret)).toBe(false);
  });

  it('is only for someone at a company: there’s no team at a personal address', async () => {
    const solo = await account(`solo.${seq++}@personal.example`);
    expect(await solo.api.people.team()).toBeNull();
    expect(await refusal(solo.api.people.inviteLink())).toBe('forbidden: Only someone at a company has an invite link. Yours is a personal address.');
  });

  it('tells its sender when an account is made from it, once, and nothing else does', async () => {
    const maya = await account(unique('maya'));
    const secret = secretOf((await maya.api.people.inviteLink()).link);

    // Sam's account is new: it says so, and Maya sees Sam joined.
    const sam = await account(unique('sam'));
    expect(sam.isNew).toBe(true);
    await sam.api.people.joinedByInvite(secret);
    const once = await maya.api.people.inviteLink();
    expect(once.joined).toEqual([{ person: expect.objectContaining({ id: sam.email, email: sam.email, name: sam.session.user.name }), at: expect.any(String) }]);
    // Saying it again changes nothing.
    await sam.api.people.joinedByInvite(secret);
    expect(await joinedFrom(maya)).toEqual([[sam.session.user.name, sam.email]]);

    // Maya on her own link, and an account made before it was sent, change nothing either, and say nothing of why.
    await maya.api.people.joinedByInvite(secret);
    const lena = await account(unique('lena'));
    await madeBefore(lena);
    await lena.api.people.joinedByInvite(secret);
    expect(await joinedFrom(maya)).toEqual([[sam.session.user.name, sam.email]]);

    // Kofi's is new too: the newest is first.
    const kofi = await account(unique('kofi'));
    await kofi.api.people.joinedByInvite(secret);
    expect(await joinedFrom(maya)).toEqual([[kofi.session.user.name, kofi.email], [sam.session.user.name, sam.email]]);

    // A link that leads nowhere is refused, signed out too.
    expect(await refusal(kofi.api.people.joinedByInvite('B'.repeat(43)))).toBe(NOWHERE);
    expect(await refusal(h.browser().api.people.joinedByInvite(secret))).toMatch(/^unauthenticated: /);
    expect((await h.pool.query<{ method: string }>('SELECT method FROM operations WHERE owner_id = $1', [sam.session.ownerId])).rows.map((r) => r.method)).not.toContain('POST /v1/team/link/joined');
    // The log says what each came to, by the account's ID alone, and never the link's secret.
    const named = new Map([[sam.session.ownerId, 'Sam'], [maya.session.ownerId, 'Maya'], [lena.session.ownerId, 'Lena'], [kofi.session.ownerId, 'Kofi']]);
    const outcomes = h.logs.flatMap((l): string[] => {
      const line = JoinedLine.safeParse(JSON.parse(l));
      const who = line.success ? named.get(line.data.ownerId) : undefined;
      return line.success && who ? [`${who} ${line.data.outcome}`] : [];
    });
    expect(outcomes).toEqual(['Sam joined', 'Sam said-already', 'Maya own-link', 'Lena not-new', 'Kofi joined']);
    expect(h.logs.join('').includes(secret)).toBe(false);
  });

  it('shows who joined to its sender alone', async () => {
    const maya = await account(unique('maya'));
    const theo = await account(unique('theo'));
    const mayas = secretOf((await maya.api.people.inviteLink()).link);
    const theos = secretOf((await theo.api.people.inviteLink()).link);
    expect(mayas).not.toBe(theos);
    const sam = await account(unique('sam'));
    await sam.api.people.joinedByInvite(mayas);
    // Theo's link has nobody, though Theo can see who Maya's is from; Sam's own link has nobody either.
    expect((await theo.api.people.inviteLink()).joined).toEqual([]);
    expect((await sam.api.people.inviteLink()).joined).toEqual([]);
    expect((await theo.api.people.peekInvite(mayas)).from.email).toBe(maya.email);
    expect(await joinedFrom(maya)).toEqual([[sam.session.user.name, sam.email]]);
  });

  it('says who it’s from as their provider has them now', async () => {
    const sub = `invite-sub-${seq++}`;
    const before = unique('ann');
    const ann = await withGoogle(before, sub, 'Ann Before');
    const secret = secretOf((await ann.api.people.inviteLink()).link);
    expect((await h.browser().api.people.peekInvite(secret)).from).toMatchObject({ name: 'Ann Before', email: before });
    // Ann's next sign-in brings a new name and address: her link's page follows, without her asking for it again.
    const after = unique('ann.after');
    const again = await withGoogle(after, sub, 'Ann After');
    expect(again.session.ownerId).toBe(ann.session.ownerId);
    expect((await h.browser().api.people.peekInvite(secret)).from).toMatchObject({ name: 'Ann After', email: after });
    expect(secretOf((await again.api.people.inviteLink()).link)).toBe(secret);
  });

  it('goes with its sender’s account, and a joiner’s account takes what it said', async () => {
    const maya = await account(unique('maya'));
    const secret = secretOf((await maya.api.people.inviteLink()).link);
    const sam = await account(unique('sam'));
    const kofi = await account(unique('kofi'));
    await sam.api.people.joinedByInvite(secret);
    await kofi.api.people.joinedByInvite(secret);
    expect(await joinedFrom(maya)).toEqual([[kofi.session.user.name, kofi.email], [sam.session.user.name, sam.email]]);

    // Sam deletes their account: they're gone from Maya's list, and nothing of theirs stays.
    await sam.api.account.delete();
    expect(await joinedFrom(maya)).toEqual([[kofi.session.user.name, kofi.email]]);
    // Maya deletes hers: the link leads nowhere, and its row and everyone who joined from it go with it.
    await maya.api.account.delete();
    expect(await refusal(h.browser().api.people.peekInvite(secret))).toBe(NOWHERE);
    expect(await refusal(kofi.api.people.joinedByInvite(secret))).toBe(NOWHERE);
    const left = await h.pool.query<{ links: number; joins: number }>('SELECT (SELECT count(*)::int FROM invite_links WHERE owner_id = ANY($1)) AS links, (SELECT count(*)::int FROM invite_link_joins WHERE secret_sha256 = $2) AS joins',
      [[maya.session.ownerId, sam.session.ownerId], createHash('sha256').update(secret).digest()]);
    expect(left.rows[0]).toEqual({ links: 0, joins: 0 });
    const deleted = h.logs.map((l): unknown => JSON.parse(l)).filter((l) => typeof l === 'object' && l !== null && 'msg' in l && l.msg === 'account deleted');
    expect(deleted).toEqual(expect.arrayContaining([expect.objectContaining({ ownerId: sam.session.ownerId, inviteJoins: 1 })]));
  });
});
