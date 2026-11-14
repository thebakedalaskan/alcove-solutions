/**
 * Invite links (docs: Privacy, keys and sessions › Invite links; Plans and usage › Team › The team's link; user-flows 10), end
 * to end: the real API over HTTP via @alcove/api-http, real Postgres. A team has one link, its admin's, which everyone on it
 * copies and only the admin makes again; someone at a company on no team has their own. The link is the same on every ask
 * until it's made again, and the one before then leads nowhere; anyone who opens it sees who it's from and the team it joins,
 * signed in or not, and whether it's their own or their team's; joining from it puts you on that team, or makes the team of
 * someone on none. A member's own link leads nowhere while they're on someone else's team. Nothing readable reaches a row, a
 * receipt or a log line; a sign-in that brings a new name or address shows on the link's page; and the link goes with its
 * owner's account.
 */
import { AlcoveApiError } from '@alcove/api';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maintain } from '../../../maintenance';
import { ORIGIN, startHarness, type Harness } from '../../../testing/harness';
import { portraitFor } from '../../profile/portraits';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const refusal = (p: Promise<unknown>) => p.then(() => 'went through', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
let seq = 0;
const unique = (who: string, domain = 'tests.example') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@${domain}`;
/** A fresh demo account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(email = unique('person')) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email, name: r.session.user.name };
}
type Account = Awaited<ReturnType<typeof account>>;
/** Signs in through the stand-in Google: the same `sub` again is the same account, with whatever name and address it brings now. */
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
  return { ...b, session, email, name };
}
const secretOf = (link: string) => link.slice(link.indexOf('#') + 1);
const linkOf = async (who: Account) => secretOf((await who.api.people.inviteLink()).link);
const NOWHERE = 'not-found: This link doesn’t lead anywhere any more. Ask whoever sent it for a new one.';
const NO_LINK = 'forbidden: Only someone at a company, or on a team, has an invite link. Start a team to have one.';
const methods = async (who: Account) => (await h.pool.query<{ method: string }>('SELECT method FROM operations WHERE owner_id = $1', [who.session.ownerId])).rows.map((r) => r.method);

describe('your own invite link, on no team', () => {
  it('is the same on every ask, says who it’s from to anyone, and to its owner that it’s theirs; its secret is kept nowhere', async () => {
    const maya = await account(unique('maya'));
    const first = await maya.api.people.inviteLink();
    expect(first).toEqual({ link: expect.stringMatching(new RegExp(`^${ORIGIN}/invite#[A-Za-z0-9_-]{43}$`)) });
    expect((await maya.api.people.inviteLink()).link).toBe(first.link);
    const secret = secretOf(first.link);
    // Signed out, the link says who it's from, as anyone else sees them, and that there's no team yet: joining makes Maya's.
    const stranger = h.browser();
    expect(await stranger.api.auth.getSession()).toBeNull();
    expect(await stranger.api.people.peekInvite(secret)).toEqual({ kind: 'link', from: expect.objectContaining({ id: maya.email, email: maya.email, name: maya.name }), yours: false, team: null, invitationId: null });
    // Signed in, it's Maya's own to her, and nobody else's.
    expect((await maya.api.people.peekInvite(secret)).yours).toBe(true);
    expect((await (await account(unique('theo'))).api.people.peekInvite(secret)).yours).toBe(false);
    // A made-up link and a malformed one.
    expect(await refusal(stranger.api.people.peekInvite('A'.repeat(43)))).toBe(NOWHERE);
    expect(await refusal(stranger.api.people.peekInvite('too-short'))).toMatch(/^invalid: /);
    expect(await refusal(stranger.api.people.peekInvite(`${secret.slice(0, 42)}=`))).toMatch(/^invalid: /);
    // Only its hash is a column, and its secret is in no row, no receipt and no log line.
    const row = (await h.pool.query<{ all: string | null }>('SELECT string_agg(row_to_json(x)::text, \' \') AS all FROM invite_links x')).rows[0]?.all ?? '';
    expect(row).toContain('from_ciphertext');
    for (const enc of [secret, Buffer.from(secret).toString('hex'), maya.email, maya.name]) expect(row.includes(enc), enc).toBe(false);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM invite_links WHERE secret_sha256 = $1', [createHash('sha256').update(secret).digest()])).rows[0]).toEqual({ n: 1 });
    expect(await methods(maya)).not.toContain('POST /v1/team/link');
    expect(h.logs.join('').includes(secret)).toBe(false);
  });

  it('is for someone at a company or on a team: at a personal address on no team there’s none, and with a team there is', async () => {
    const solo = await account(unique('solo', 'personal.example'));
    expect(await solo.api.people.team()).toBeNull();
    expect(await refusal(solo.api.people.inviteLink())).toBe(NO_LINK);
    expect(await refusal(solo.api.people.newInviteLink())).toBe(NO_LINK);
    await solo.api.teams.create('Solo’s team');
    const link = await linkOf(solo);
    expect(await h.browser().api.people.peekInvite(link)).toMatchObject({ kind: 'link', from: { email: solo.email }, team: { name: 'Solo’s team', people: 1 } });
    // Deleting the team leaves a link at a personal address leading nowhere: there's nothing to copy it from.
    await solo.api.teams.delete();
    expect(await refusal(h.browser().api.people.peekInvite(link))).toBe(NOWHERE);
  });

  it('makes its owner’s team when someone joins from it, named for their company page, and is the team’s from then', async () => {
    const maya = await account(unique('maya', 'vandelay.industries'));
    const link = await linkOf(maya);
    // Maya's own link, with no team, is for whoever she sends it to.
    expect(await refusal(maya.api.teams.join(link))).toBe('invalid: That’s your own invite link: whoever you send it to joins you.');
    const sam = await account(unique('sam'));
    expect(await sam.api.teams.join(link)).toMatchObject({
      name: 'Vandelay Industries', role: 'member', tier: 'free',
      members: [{ role: 'admin', person: { email: maya.email, name: maya.name } }, { role: 'member', you: true, person: { email: sam.email } }]
    });
    expect(await maya.api.teams.mine()).toMatchObject({ name: 'Vandelay Industries', role: 'admin' });
    // The same link is the team's now: the next joins it, and everyone on it copies it.
    expect(await (await account(unique('kofi'))).api.teams.join(link)).toMatchObject({ name: 'Vandelay Industries' });
    expect(await linkOf(sam)).toBe(link);
    expect(await h.browser().api.people.peekInvite(link)).toMatchObject({ kind: 'link', from: { email: maya.email }, team: { name: 'Vandelay Industries', people: 3 } });
    // Someone on it joining it again changes nothing.
    expect((await sam.api.teams.join(link)).members).toHaveLength(3);
    const said = h.logs.map((l): unknown => JSON.parse(l)).filter((l) => typeof l === 'object' && l !== null && 'msg' in l && l.msg === 'team joined from a link');
    expect(said).toEqual(expect.arrayContaining([expect.objectContaining({ ownerId: sam.session.ownerId, kind: 'link', made: true }), expect.objectContaining({ kind: 'link', made: false, already: true })]));
    // Joining keeps a receipt by IDs and counts (invitations.integration.test.ts › receipts), and the secret in no row.
    expect(await methods(sam)).toContain('POST /v1/team/join');
  });
});

describe('a team’s link', () => {
  it('is its admin’s, for everyone on it, says the team and that it’s theirs, and only the admin makes a new one, which stops the old for everybody', async () => {
    const ann = await account(unique('ann'));
    await ann.api.teams.create('Vandelay');
    const link = await linkOf(ann);
    const bob = await account(unique('bob'));
    expect(await bob.api.teams.join(link)).toMatchObject({ name: 'Vandelay', role: 'member' });
    expect(await linkOf(bob)).toBe(link);
    // Opened by someone on it: theirs. By anyone else: who it's from (the admin) and the team, by name and faces.
    expect((await bob.api.people.peekInvite(link)).yours).toBe(true);
    const seen = await h.browser().api.people.peekInvite(link);
    expect(seen).toEqual({
      kind: 'link', from: expect.objectContaining({ email: ann.email, name: ann.name }), yours: false,
      team: { name: 'Vandelay', people: 2, faces: [expect.objectContaining({ name: ann.name, email: '' }), expect.objectContaining({ name: bob.name, email: '' })] }, invitationId: null
    });
    // Ann, whose link it is, looks as she does everywhere; Bob's face follows from his member ID, so no guess at his address
    // can be checked against it.
    const [annFace, bobFace] = seen.team?.faces ?? [];
    expect(annFace?.portrait).toEqual(portraitFor(ann.email));
    expect(bobFace?.portrait).toEqual(portraitFor(bobFace?.id ?? ''));
    expect(bobFace?.portrait).not.toEqual(portraitFor(bob.email));
    expect(await refusal(bob.api.people.newInviteLink())).toBe('forbidden: Only the team’s admin can make a new link: it’s everyone’s on the team.');
    const made = await ann.api.people.newInviteLink();
    expect(secretOf(made.link)).not.toBe(link);
    expect(await refusal(h.browser().api.people.peekInvite(link))).toBe(NOWHERE);
    expect(await refusal((await account(unique('cy'))).api.teams.join(link))).toBe(NOWHERE);
    expect(await linkOf(bob)).toBe(secretOf(made.link));
    expect(await methods(ann)).not.toContain('POST /v1/team/link/new');
    expect(h.logs.join('').includes(secretOf(made.link))).toBe(false);
  });

  it('leaves a member’s own link leading nowhere while they’re on someone else’s team, and working again once they leave', async () => {
    const ann = await account(unique('ann'));
    await ann.api.teams.create('Vandelay');
    const ken = await account(unique('ken'));
    const kens = await linkOf(ken);
    await ken.api.teams.join(await linkOf(ann));
    expect(await refusal(h.browser().api.people.peekInvite(kens))).toBe(NOWHERE);
    expect(await refusal((await account(unique('lee'))).api.teams.join(kens))).toBe(NOWHERE);
    await ken.api.teams.leave();
    expect(await h.browser().api.people.peekInvite(kens)).toMatchObject({ kind: 'link', from: { email: ken.email }, team: null });
  });

  it('is made again as someone is taken off the team, or the team is deleted, on its own or by its admin joining another: the link they had leads nowhere', async () => {
    const ann = await account(unique('ann'));
    await ann.api.teams.create('Vandelay');
    const link = await linkOf(ann);
    const bob = await account(unique('bob'));
    await bob.api.teams.join(link);
    // Bob is taken off: the link he copied can't put him back, nor anyone else on.
    await ann.api.teams.remove((await ann.api.teams.mine())?.members.find((m) => m.role === 'member')?.id ?? '');
    expect(await refusal(bob.api.teams.join(link))).toBe(NOWHERE);
    expect(await refusal(h.browser().api.people.peekInvite(link))).toBe(NOWHERE);
    const now = await linkOf(ann);
    expect(now).not.toBe(link);
    expect(await linkOf(ann)).toBe(now);
    // The team is deleted: its link leads nowhere, not even to a team made anew for Ann, whose company page has a link of its own.
    await ann.api.teams.delete();
    expect(await refusal(h.browser().api.people.peekInvite(now))).toBe(NOWHERE);
    expect(await refusal((await account(unique('cy'))).api.teams.join(now))).toBe(NOWHERE);
    expect(await linkOf(ann)).not.toBe(now);
    // Its admin, alone on it, deletes it to join another: the same.
    const lu = await account(unique('lu'));
    await lu.api.teams.create('Lumen');
    const lumen = await linkOf(lu);
    expect(await lu.api.teams.join(await linkOf(ann), true)).toMatchObject({ role: 'member' });
    expect(await refusal(h.browser().api.people.peekInvite(lumen))).toBe(NOWHERE);
    await lu.api.teams.leave();
    expect(await refusal(h.browser().api.people.peekInvite(lumen))).toBe(NOWHERE);
    expect(await h.browser().api.people.peekInvite(await linkOf(lu))).toMatchObject({ kind: 'link', from: { email: lu.email }, team: null });
  });

  it('asks to leave a team before joining from a link, as an invitation does', async () => {
    const ann = await account(unique('ann'));
    await ann.api.teams.create('Vandelay');
    const lu = await account(unique('lu'));
    await lu.api.teams.create('Lumen');
    const link = await linkOf(ann);
    expect(await refusal(lu.api.teams.join(link))).toBe('conflict: You’re on a team already. Leave it to join this one.');
    expect(await lu.api.teams.join(link, true)).toMatchObject({ name: 'Vandelay', role: 'member' });
  });
});

describe('who it’s from', () => {
  it('says them as their provider has them now, a new address alone included', async () => {
    const sub = `invite-sub-${seq++}`;
    const before = unique('ann');
    const ann = await withGoogle(before, sub, 'Ann Before');
    const secret = await linkOf(ann);
    expect((await h.browser().api.people.peekInvite(secret)).from).toMatchObject({ name: 'Ann Before', email: before });
    // Ann's next sign-in brings a new name and address: her link's page follows, without her asking for the link again.
    const after = unique('ann.after');
    const again = await withGoogle(after, sub, 'Ann After');
    expect(again.session.ownerId).toBe(ann.session.ownerId);
    expect((await h.browser().api.people.peekInvite(secret)).from).toMatchObject({ name: 'Ann After', email: after });
    // And one that brings a new address alone, with the same name.
    const latest = unique('ann.latest');
    await withGoogle(latest, sub, 'Ann After');
    expect((await h.browser().api.people.peekInvite(secret)).from).toMatchObject({ name: 'Ann After', email: latest });
    expect(await linkOf(again)).toBe(secret);
  });

  it('keeps nothing of who joined from someone’s link as the release before kept it: upkeep takes every row', async () => {
    const maya = await account(unique('maya'));
    await h.pool.query('INSERT INTO invite_link_joins (owner_id, joiner_index, who_ciphertext) VALUES ($1, $2, $3)', [maya.session.ownerId, randomBytes(32), randomBytes(64)]);
    expect((await maintain(h.deps)).inviteJoins).toBeGreaterThanOrEqual(1);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM invite_link_joins')).rows[0]).toEqual({ n: 0 });
  });

  it('goes with its owner’s account', async () => {
    const maya = await account(unique('maya'));
    const secret = await linkOf(maya);
    await maya.api.account.delete();
    expect(await refusal(h.browser().api.people.peekInvite(secret))).toBe(NOWHERE);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM invite_links WHERE owner_id = $1 OR secret_sha256 = $2', [maya.session.ownerId, createHash('sha256').update(secret).digest()])).rows[0]).toEqual({ n: 0 });
  });
});
