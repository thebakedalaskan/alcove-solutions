/**
 * Team (docs: Plans and usage › Team), end to end: the real API over HTTP via @alcove/api-http, real Postgres and the object
 * store. Making a team and buying its licenses from the admin's balance; one-time invites; a license taken on a visit and
 * never by a read, replacing Pro; the alerts the admin is given; auto-purchase; refunds; the pool and its grace; members
 * leaving and taken off; each person's own allowance; nobody reaching another team; and accounts going.
 */
import { AlcoveApiError, type AlcoveApi, type Purchase, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LimitName } from '../../limits';
import { maintain } from '../../maintenance';
import { speechWav } from '../../testing/fake-near';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';
import { standing } from './meter';
import { creditBySupport } from './support';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(async () => { h.closeCalls(); vi.useRealTimers(); await h.resetLimits(); });

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const LICENSE = 40_000_000;
const PRICE = 20_000_000;
const refusal = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
/** Signs in through the stand-in Google, which is how an account comes to have a new address: the same `sub`, another address. */
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
  return { ...b, session, email: session.user.email };
}
const setLimit = (name: LimitName, value: number) => h.pool.query('INSERT INTO service_limits (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()', [name, value]);
const fileOf = (n: number) => { const out = new Uint8Array(new ArrayBuffer(n)); out.set(randomBytes(n)); return new File([out], 'harbour.png', { type: 'image/png' }); };
const speech = (words: string, atMs: number): TranscriptClip => ({ data: new Blob([speechWav(words, 6000)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: 6000 });
async function written(api: AlcoveApi, noteId: string): Promise<void> { for await (const p of api.notes.progress(noteId)) if (p.ready) return; }
async function workspace(who: Account, name: string) {
  const { id } = await who.api.workspaces.create(name);
  const doc = (await who.api.workspaces.items.create(id, { kind: 'document', name: 'Plan', parent: null })).id;
  return { id, doc };
}
const upload = (who: Account, at: { id: string; doc: string }, bytes: number) => refusal(who.api.workspaces.media.upload(at.id, at.doc, fileOf(bytes)));
const FULL = 'plan-limit: Your storage is full. Delete something, or move to a plan with more room.';
const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
/** Money in, as a person adds it: a top-up the fake 1Click settles in full. */
async function deposit(who: Account, microUsd: number): Promise<void> {
  const t = await who.api.plans.startTopUp(BASE_USDC, microUsd);
  h.oneclick.set(t.address ?? '', 'SUCCESS', { depositedAmount: String(microUsd), amountOut: String(microUsd), intentHashes: [`intent-${t.id}`] });
  await who.api.plans.topUp(t.id);
}
/** Money in for a test that isn't about adding it: as support adds it. */
const give = (who: Account, microUsd: number) => creditBySupport(h.deps, who.email, microUsd);
/** A payment for `count` licenses, which the fake 1Click settles in full: what became of its purchase once it was added. */
async function payFor(who: Account, count: number) {
  const buys: Purchase = { kind: 'licenses', count, microUsdPerLicense: LICENSE };
  const t = await who.api.plans.startTopUp(BASE_USDC, count * LICENSE, buys);
  h.oneclick.set(t.address ?? '', 'SUCCESS', { depositedAmount: String(count * LICENSE), amountOut: String(count * LICENSE), intentHashes: [`intent-${t.id}`] });
  return (await who.api.plans.topUp(t.id)).purchase;
}
const labels = async (who: Account) => (await who.api.plans.plan()).balance.history.map((e) => e.label);
const kinds = async (who: Account) => (await who.api.plans.plan()).notices.map((n) => n.kind);
/** A team with `who` as its admin and `licenses` bought (the admin hasn't taken one). */
async function team(who: Account, licenses = 0, name = 'Vandelay Industries') {
  const made = await who.api.teams.create(name);
  if (!licenses) return made;
  await give(who, licenses * LICENSE);
  return who.api.teams.buyLicenses(licenses, LICENSE);
}
const secretOf = (link: string) => link.slice(link.indexOf('#') + 1);
/** `who` joins the admin's team through a link the admin made. */
async function joined(admin: Account, who: Account) {
  return who.api.teams.join(secretOf((await admin.api.teams.invite()).link));
}
const memberId = async (admin: Account, who: Account) => (await admin.api.teams.mine())?.members.find((m) => m.person.email === who.email)?.id ?? 'not on the team';
const GONE = 'not-found: That link to join a team has been used or has expired. Ask the team’s admin for a new one.';
const ADMIN_ONLY = 'forbidden: Only the team’s admin can do that.';
const NO_TEAM = 'not-found: You’re not on a team.';

describe('making a team and its licenses', () => {
  it('A3: a new account picks Team: adds money, makes a team, buys licenses, and takes one the next time it uses Alcove', async () => {
    const ann = await account();
    await deposit(ann, 3 * LICENSE);
    const made = await ann.api.teams.create('Vandelay Industries');
    expect(made).toMatchObject({
      name: 'Vandelay Industries', role: 'admin', licensed: false, storage: { usedBytes: 0, limitBytes: 0 },
      members: [{ role: 'admin', you: true, person: { email: ann.email }, license: { state: 'none', until: null, wanted: null } }],
      licenses: { unconsumed: 0, refundableMicroUsd: 0, autoPurchase: false }
    });
    expect((await ann.api.teams.buyLicenses(3, LICENSE)).licenses).toEqual({ unconsumed: 3, refundableMicroUsd: 3 * LICENSE, autoPurchase: false });
    expect(await labels(ann)).toEqual(['Team, 3 licenses', 'Added, 120 USDC']);
    // Buying isn't taking one, and neither is reading the session or the plan.
    await ann.api.auth.getSession();
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', balance: { microUsd: 0 }, team: { id: made.id, name: 'Vandelay Industries', role: 'admin', licensed: false } });
    await ann.api.auth.visit();
    const plan = await ann.api.plans.plan();
    expect(plan).toMatchObject({
      kind: 'team', team: { licensed: true }, notes: { minutesLeft: 3000, minutesPerPeriod: 3000, stopped: false },
      storage: { usedBytes: 0, limitBytes: 100 * GiB, fileBytes: 512 * MiB }, grace: null, over: { storage: false }
    });
    expect(Date.parse(plan.period.to) - Date.parse(plan.period.from)).toBe(30 * 86_400_000);
    expect(await ann.api.teams.mine()).toMatchObject({
      licensed: true, storage: { limitBytes: 100 * GiB }, licenses: { unconsumed: 2, refundableMicroUsd: 2 * LICENSE },
      members: [{ license: { state: 'live', until: plan.period.to, wanted: null } }]
    });
    // A visit with a live license takes nothing more.
    await ann.api.auth.visit();
    expect((await ann.api.teams.mine())?.licenses?.unconsumed).toBe(2);
  });

  it('G1: offers Team from the limits, and buys 1 to 500 licenses at the price shown, refusing a short balance or a changed price', async () => {
    expect((await (await account()).api.plans.offers()).team).toEqual({ notesMinutes: 3000, storageBytes: 100 * GiB, fileBytes: 512 * MiB, microUsdPerLicense: LICENSE, maxLicenses: 500 });
    const ann = await account();
    await team(ann);
    await give(ann, LICENSE);
    expect(await refusal(ann.api.teams.buyLicenses(501, LICENSE))).toBe('invalid: Buy 1 to 500 licenses at a time.');
    expect(await refusal(ann.api.teams.buyLicenses(1, 30_000_000))).toBe('conflict: The price of a team license has changed. Look at it again before buying.');
    // What they cost, never the balance: a refusal's words are logged.
    expect(await refusal(ann.api.teams.buyLicenses(2, LICENSE))).toBe('conflict: Your balance is short of what 2 team licenses cost ($80). Add money first.');
    expect(await ann.api.plans.plan()).toMatchObject({ balance: { microUsd: LICENSE } });
    expect((await ann.api.teams.buyLicenses(1, LICENSE)).licenses?.unconsumed).toBe(1);
    // One team each: its admin can't make another.
    expect(await refusal(ann.api.teams.create('Another'))).toBe('conflict: You’re on a team already. Leave it before making one.');
  });

  it('G2: an invite works once; a second use, an expired one, a made-up one, or someone already on a team is refused', async () => {
    await setLimit('team.invite_seconds', 60);
    const ann = await account();
    const bob = await account();
    const cy = await account();
    await team(ann, 2);
    const { link, expiresAt } = await ann.api.teams.invite();
    expect(link).toMatch(new RegExp(`^${h.deps.cfg.WEB_ORIGIN}/team/join#[A-Za-z0-9_-]{43}$`));
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(50_000);
    // Only a hash of the secret is kept.
    expect((await h.pool.query('SELECT count(*)::int AS n FROM team_invites WHERE secret_sha256 = $1', [Buffer.from(secretOf(link))])).rows[0]).toEqual({ n: 0 });
    expect(await bob.api.teams.peek(secretOf(link))).toEqual({ name: 'Vandelay Industries', admin: expect.objectContaining({ email: ann.email }), expiresAt });
    expect(await bob.api.teams.join(secretOf(link))).toMatchObject({ role: 'member', licensed: true, licenses: null });
    expect(await refusal(cy.api.teams.join(secretOf(link)))).toBe(GONE);
    expect(await refusal(cy.api.teams.peek(secretOf(link)))).toBe(GONE);
    expect(await refusal(cy.api.teams.join(randomBytes(32).toString('base64url')))).toBe(GONE);
    // Someone on a team already, the admin included, is refused, and the link still works for whoever it was meant for.
    const next = await ann.api.teams.invite();
    expect(await refusal(bob.api.teams.join(secretOf(next.link)))).toBe('conflict: You’re on a team already. Leave it before joining another.');
    expect(await refusal(ann.api.teams.join(secretOf(next.link)))).toBe('conflict: You’re on a team already. Leave it before joining another.');
    expect(await bob.api.teams.peek(secretOf(next.link))).toMatchObject({ name: 'Vandelay Industries' });
    // Only the admin makes one.
    expect(await refusal(bob.api.teams.invite())).toBe(ADMIN_ONLY);
    // Expired: refused, and upkeep deletes it.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(next.expiresAt) + 1000 });
    expect(await refusal(cy.api.teams.join(secretOf(next.link)))).toBe(GONE);
    await maintain(h.deps);
    const teamId = (await ann.api.teams.mine())?.id;
    expect((await h.pool.query('SELECT count(*)::int AS n FROM team_invites WHERE team_id = $1', [teamId])).rows[0]).toEqual({ n: 0 });
    expect(await cy.api.teams.mine()).toBeNull();
  });
});

describe('licenses', () => {
  it('G3: joining with a license left takes one; with none, the member stays on their own plan and is told to ask, and the admin that none are left', async () => {
    const ann = await account();
    const bob = await account();
    const cy = await account();
    await team(ann, 1);
    await joined(ann, bob);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'team', team: { role: 'member', licensed: true }, notices: [] });
    expect(await joined(ann, cy)).toMatchObject({ licensed: false, members: [{}, {}, { you: true, license: { state: 'none', until: null, wanted: expect.any(String) } }] });
    expect(await cy.api.plans.plan()).toMatchObject({ kind: 'free', team: { licensed: false }, notices: [{ kind: 'license-needed', until: null, count: null }] });
    expect((await ann.api.plans.plan()).notices).toMatchObject([{ kind: 'licenses-none', until: null, count: null }, { kind: 'licenses-low', count: 0 }]);
    // Coming back tells nobody twice.
    await cy.api.auth.visit();
    expect(await kinds(cy)).toEqual(['license-needed']);
    expect(await kinds(ann)).toEqual(['licenses-none', 'licenses-low']);
    // Once the admin buys more, the next visit takes one.
    await give(ann, LICENSE);
    await ann.api.teams.buyLicenses(1, LICENSE);
    await cy.api.auth.visit();
    expect(await cy.api.plans.plan()).toMatchObject({ kind: 'team', team: { licensed: true } });
    expect((await cy.api.teams.mine())?.members.find((m) => m.you)?.license).toMatchObject({ state: 'live', wanted: null });
  });

  it('G4: tells the admin once when fewer than 5 licenses are left, and again only once there have been 5 or more since', async () => {
    const ann = await account();
    await team(ann, 6);
    await joined(ann, await account());
    expect(await kinds(ann)).toEqual([]);
    await joined(ann, await account());
    expect((await ann.api.plans.plan()).notices).toMatchObject([{ kind: 'licenses-low', count: 4, until: null }]);
    await joined(ann, await account());
    expect(await kinds(ann)).toEqual(['licenses-low']);
    // Back to 5, then below again.
    await give(ann, 2 * LICENSE);
    expect((await ann.api.teams.buyLicenses(2, LICENSE)).licenses?.unconsumed).toBe(5);
    await joined(ann, await account());
    expect((await ann.api.plans.plan()).notices).toMatchObject([{ kind: 'licenses-low', count: 4 }, { kind: 'licenses-low', count: 4 }]);
  });

  it('G5: with auto-purchase on, buys a license from the admin’s balance when none is left, and says none are left when it can’t pay', async () => {
    const ann = await account();
    const bob = await account();
    const cy = await account();
    await team(ann);
    expect((await ann.api.teams.setAutoPurchase(true)).licenses).toEqual({ unconsumed: 0, refundableMicroUsd: 0, autoPurchase: true });
    expect(await refusal(bob.api.teams.setAutoPurchase(true))).toBe(NO_TEAM);
    await give(ann, LICENSE);
    expect(await joined(ann, bob)).toMatchObject({ licensed: true });
    const after = await ann.api.plans.plan();
    expect(after.balance).toMatchObject({ microUsd: 0, history: [{ label: 'Team license, bought for a member', microUsd: -LICENSE }, {}] });
    expect(await joined(ann, cy)).toMatchObject({ licensed: false });
    expect(await kinds(ann)).toEqual(['licenses-none', 'licenses-low']);
    expect(await kinds(cy)).toEqual(['license-needed']);
    expect(await refusal(bob.api.teams.setAutoPurchase(false))).toBe(ADMIN_ONLY);
  });

  it('G6: an ended license isn’t taken again by reading the session or the plan, only by a visit', async () => {
    await setLimit('plan.period_seconds', 3600);
    const ann = await account();
    const bob = await account();
    await team(ann, 2);
    await joined(ann, bob);
    const until = Date.parse((await bob.api.plans.plan()).period.to);
    vi.useFakeTimers({ toFake: ['Date'], now: until + 60_000 });
    await bob.api.auth.getSession();
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'free', period: { from: new Date(until).toISOString() }, team: { licensed: false } });
    expect(await bob.api.teams.mine()).toMatchObject({ licensed: false, members: [{}, { you: true, license: { state: 'ended', until: new Date(until).toISOString(), wanted: null } }] });
    expect((await ann.api.teams.mine())?.licenses?.unconsumed).toBe(1);
    await bob.api.auth.visit();
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'team', period: { from: new Date(until + 60_000).toISOString() }, notes: { minutesLeft: 3000 } });
    expect((await ann.api.teams.mine())?.licenses?.unconsumed).toBe(0);
  });

  it('G7: a license replaces Pro at once: the running month is lost and the ones that haven’t started go back to the balance', async () => {
    const ann = await account();
    const bob = await account();
    await give(bob, 3 * PRICE);
    expect((await bob.api.plans.buyPro(3, PRICE)).pro.months).toHaveLength(3);
    await team(ann, 1);
    await joined(ann, bob);
    const plan = await bob.api.plans.plan();
    expect(plan).toMatchObject({
      kind: 'team', pro: { months: [], until: null, refundableMicroUsd: 0 }, balance: { microUsd: 2 * PRICE },
      notices: [{ kind: 'license-replaced-pro', count: 2, until: null }]
    });
    expect(plan.balance.history[0]).toMatchObject({ label: 'Refund: 2 months of Pro, for a team license', microUsd: 2 * PRICE });
    // While the license lasts Pro can't be bought, and upkeep has nothing to say about the Pro that's gone.
    expect(await refusal(bob.api.plans.buyPro(1, PRICE))).toBe('conflict: You’re on your team’s plan while your license lasts, so Pro can’t be bought now.');
    await h.pool.query('UPDATE plan_accounts SET due_at = now() WHERE owner_id = $1', [bob.session.ownerId]);
    await maintain(h.deps);
    expect(await kinds(bob)).toEqual(['license-replaced-pro']);
  });

  it('G8: an admin without a license still manages the team', async () => {
    const ann = await account();
    const bob = await account();
    const cy = await account();
    await team(ann, 1);
    await joined(ann, bob);
    await ann.api.auth.visit();
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', team: { role: 'admin', licensed: false } });
    // The admin is told none are left, never to ask themselves.
    expect(await kinds(ann)).toEqual(['licenses-none', 'licenses-low']);
    const mine = await ann.api.teams.mine();
    expect(mine).toMatchObject({ role: 'admin', licensed: false, licenses: { unconsumed: 0 } });
    expect(mine?.members.find((m) => m.you)?.license).toMatchObject({ state: 'none', wanted: expect.any(String) });
    await joined(ann, cy);
    await give(ann, LICENSE);
    expect((await ann.api.teams.buyLicenses(1, LICENSE)).licenses?.unconsumed).toBe(1);
    expect((await ann.api.teams.setAutoPurchase(true)).licenses?.autoPurchase).toBe(true);
    expect((await ann.api.teams.remove(await memberId(ann, cy))).members).toHaveLength(2);
  });

  it('G9: refunds the licenses nobody has taken, never one someone has, and the rest when an empty team is deleted', async () => {
    const ann = await account();
    const bob = await account();
    await team(ann, 3);
    await joined(ann, bob);
    expect((await ann.api.teams.refundLicenses()).licenses).toEqual({ unconsumed: 0, refundableMicroUsd: 0, autoPurchase: false });
    expect(await ann.api.plans.plan()).toMatchObject({ balance: { microUsd: 2 * LICENSE, history: [{ label: 'Team licenses refunded, 2', microUsd: 2 * LICENSE }, {}, {}] } });
    expect(await refusal(ann.api.teams.refundLicenses())).toBe('conflict: There’s no license to refund that nobody has taken. A license someone has taken isn’t refunded.');
    expect(await refusal(bob.api.teams.refundLicenses())).toBe(ADMIN_ONLY);
    // Deleting: refused while someone else is on it, then the unconsumed go back to the balance.
    await ann.api.teams.buyLicenses(2, LICENSE);
    expect(await refusal(ann.api.teams.delete())).toBe('conflict: Take everyone else off the team first: a team can be deleted once nobody else is on it.');
    expect(await refusal(bob.api.teams.delete())).toBe(ADMIN_ONLY);
    const teamId = (await ann.api.teams.mine())?.id;
    await ann.api.teams.remove(await memberId(ann, bob));
    await ann.api.teams.delete();
    const after = await ann.api.plans.plan();
    expect(after).toMatchObject({ team: null, balance: { microUsd: 2 * LICENSE } });
    expect(after.balance.history[0]).toMatchObject({ label: 'Team licenses refunded, 2', microUsd: 2 * LICENSE });
    expect(await ann.api.teams.mine()).toBeNull();
    expect((await h.pool.query('SELECT (SELECT count(*) FROM teams WHERE team_id = $1) + (SELECT count(*) FROM team_members WHERE team_id = $1) AS n', [teamId])).rows[0]).toEqual({ n: '0' });
    // A team again, from scratch.
    expect(await ann.api.teams.create('Again')).toMatchObject({ name: 'Again', licenses: { unconsumed: 0 } });
  });

  it('G16: licenses bought with a payment are taken on a visit, refunded while nobody has, and tell the admin again when few or none are left', async () => {
    await setLimit('team.low_licenses', 2);
    const ann = await account();
    const [bob, cy, dee] = await Promise.all([account(), account(), account()]);
    await team(ann);
    // Bob joins with none to take: he stays on his own plan, and the admin is told none are left.
    await joined(ann, bob);
    expect(await kinds(ann)).toEqual(['licenses-none']);
    // The admin pays for three. Once the payment is added they're bought, and nobody has one yet.
    expect(await payFor(ann, 3)).toEqual({ buys: { kind: 'licenses', count: 3, microUsdPerLicense: LICENSE }, outcome: 'bought', why: null });
    expect((await ann.api.teams.mine())?.licenses).toEqual({ unconsumed: 3, refundableMicroUsd: 3 * LICENSE, autoPurchase: false });
    expect(await labels(ann)).toEqual(['Team, 3 licenses', 'Added, 120 USDC']);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'free', team: { licensed: false } });
    // Bob's next visit takes one, the oldest; Cy joins and takes another, which leaves fewer than 2.
    await bob.api.auth.visit();
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'team', team: { licensed: true }, notes: { minutesLeft: 3000 } });
    expect((await ann.api.teams.mine())?.licenses?.unconsumed).toBe(2);
    expect(await kinds(ann)).toEqual(['licenses-none']);
    expect(await joined(ann, cy)).toMatchObject({ licensed: true });
    expect((await ann.api.plans.plan()).notices).toMatchObject([{ kind: 'licenses-low', count: 1 }, { kind: 'licenses-none' }]);
    // The one nobody has taken goes back to the balance at what it cost.
    expect((await ann.api.teams.refundLicenses()).licenses).toEqual({ unconsumed: 0, refundableMicroUsd: 0, autoPurchase: false });
    expect(await ann.api.plans.plan()).toMatchObject({ balance: { microUsd: LICENSE, history: [{ label: 'Team licenses refunded, 1', microUsd: LICENSE }, {}, {}] } });
    // Buying let the admin be told again: none left for Dee.
    await joined(ann, dee);
    expect(await kinds(dee)).toEqual(['license-needed']);
    expect(await kinds(ann)).toEqual(['licenses-none', 'licenses-low', 'licenses-none']);
    // Two more by payment: Dee's next visit takes one, and the admin is told again that few are left.
    expect((await payFor(ann, 2))?.outcome).toBe('bought');
    await dee.api.auth.visit();
    expect(await dee.api.plans.plan()).toMatchObject({ kind: 'team', team: { licensed: true } });
    expect((await ann.api.plans.plan()).notices).toMatchObject([{ kind: 'licenses-low', count: 1 }, { kind: 'licenses-none' }, { kind: 'licenses-low' }, { kind: 'licenses-none' }]);
  });
});

describe('the pool and the people in it', () => {
  it('G12: pools 100 GB a live license across everyone licensed, with a grace when a license ends and it shrinks below what’s stored', async () => {
    await setLimit('plan.period_seconds', 3600);
    await setLimit('plan.grace_seconds', 600);
    await setLimit('plan.team.storage_bytes', MiB);
    const t0 = Date.now();
    const ann = await account();
    const bob = await account();
    await team(ann, 2);
    await joined(ann, bob);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'team', storage: { usedBytes: 0, limitBytes: MiB } });
    // Half an hour on, the admin takes the other: the pool is two licenses' worth, and one person can use more than their share.
    vi.useFakeTimers({ toFake: ['Date'], now: t0 + 1_800_000 });
    await ann.api.auth.visit();
    const ours = await workspace(ann, 'Ours');
    expect(await upload(ann, ours, MiB + MiB / 2)).toBe('succeeded');
    const pooled = await bob.api.plans.plan();
    expect(pooled.storage.limitBytes).toBe(2 * MiB);
    expect(pooled.storage.usedBytes).toBeGreaterThan(MiB + MiB / 2);
    expect((await ann.api.teams.mine())?.storage).toEqual({ usedBytes: pooled.storage.usedBytes, limitBytes: 2 * MiB });
    const bobs = await workspace(bob, 'His');
    expect(await upload(bob, bobs, MiB / 2)).toBe(FULL);
    // Bob's license ends: the pool is one license, below what's stored, so it gets the grace, held to what it was.
    const bobEnd = Date.parse(pooled.period.to);
    vi.useFakeTimers({ toFake: ['Date'], now: bobEnd + 60_000 });
    await maintain(h.deps);
    const shrunk = await ann.api.plans.plan();
    expect(shrunk).toMatchObject({ kind: 'team', grace: { until: new Date(bobEnd + 660_000).toISOString(), storage: true }, over: { storage: false }, storage: { limitBytes: 2 * MiB } });
    expect(await upload(ann, ours, 1024)).toBe('succeeded');
    // After it, nothing more is stored until there's room; and the grace isn't given twice.
    vi.useFakeTimers({ toFake: ['Date'], now: bobEnd + 720_000 });
    await maintain(h.deps);
    expect(await ann.api.plans.plan()).toMatchObject({ grace: null, over: { storage: true }, storage: { limitBytes: MiB } });
    expect(await upload(ann, ours, 1024)).toBe(FULL);
    // Bob comes back: his visit takes a license, and the pool has room again.
    await give(ann, LICENSE);
    await ann.api.teams.buyLicenses(1, LICENSE);
    await bob.api.auth.visit();
    expect(await ann.api.plans.plan()).toMatchObject({ grace: null, over: { storage: false }, storage: { limitBytes: 2 * MiB } });
    expect(await upload(ann, ours, 1024)).toBe('succeeded');
  });

  it('G14: someone taken off the team drops to Free with the grace and loses the team; a member can leave; the admin can’t', async () => {
    await setLimit('plan.team.storage_bytes', MiB);
    await setLimit('plan.free.storage_bytes', MiB / 4);
    await setLimit('plan.grace_seconds', 1800);
    const ann = await account();
    const bob = await account();
    const cy = await account();
    await team(ann, 2);
    await joined(ann, bob);
    const his = await workspace(bob, 'His');
    expect(await upload(bob, his, MiB / 2)).toBe('succeeded');
    const removed = await ann.api.teams.remove(await memberId(ann, bob));
    expect(removed.members.map((m) => m.person.email)).toEqual([ann.email]);
    // His license isn't refunded.
    expect(removed.licenses?.unconsumed).toBe(1);
    expect(await bob.api.teams.mine()).toBeNull();
    const now = Date.now();
    const free = await bob.api.plans.plan();
    expect(free).toMatchObject({ kind: 'free', team: null, notes: { minutesLeft: 300 }, over: { storage: false }, storage: { limitBytes: MiB } });
    expect(Date.parse(free.period.from)).toBeGreaterThan(now - 60_000);
    expect(Date.parse(free.grace?.until ?? '')).toBeGreaterThan(now + 1_700_000);
    // Through the grace he's held to a team's storage for a person, and after it to Free's.
    expect(await upload(bob, his, 1024)).toBe('succeeded');
    expect(await refusal(bob.api.teams.leave())).toBe(NO_TEAM);
    vi.useFakeTimers({ toFake: ['Date'], now: now + 1_860_000 });
    expect(await bob.api.plans.plan()).toMatchObject({ grace: null, over: { storage: true }, storage: { limitBytes: MiB / 4 } });
    expect(await upload(bob, his, 1024)).toBe(FULL);
    vi.useRealTimers();
    // A member leaves.
    await joined(ann, cy);
    await cy.api.teams.leave();
    expect(await cy.api.teams.mine()).toBeNull();
    expect(await cy.api.plans.plan()).toMatchObject({ kind: 'free', team: null });
    // The admin can neither leave nor take themselves off.
    expect(await refusal(ann.api.teams.leave())).toBe('conflict: You’re the team’s admin, so you can’t leave it. Delete the team once nobody else is on it.');
    expect(await refusal(ann.api.teams.remove(await memberId(ann, ann)))).toBe('conflict: You can’t take yourself off your own team. Delete the team once nobody else is on it.');
  });

  it('G15: each licensed person has their own notes for their license’s period', async () => {
    await setLimit('ai.hour_micro_usd', 60_000);
    const ann = await account();
    const bob = await account();
    // Bob spends some of Free's first: a license brings the whole of Team's.
    const before = await bob.api.recordings.start({ title: 'On Free' });
    await before.transcribe(speech('We agreed to ship on Monday.', 0));
    await written(bob.api, (await before.stop()).pendingNoteId);
    expect((await bob.api.plans.plan()).notes.minutesLeft).toBeLessThan(300);
    await team(ann, 2);
    await ann.api.auth.visit();
    await joined(ann, bob);
    expect((await bob.api.plans.plan()).notes).toEqual({ minutesLeft: 3000, minutesPerPeriod: 3000, stopped: false });
    const rec = await bob.api.recordings.start({ title: 'On Team' });
    await rec.transcribe(speech('We agreed to ship on Tuesday.', 0));
    await written(bob.api, (await rec.stop()).pendingNoteId);
    expect((await bob.api.plans.plan()).notes.minutesLeft).toBeLessThan(3000);
    expect((await ann.api.plans.plan()).notes).toEqual({ minutesLeft: 3000, minutesPerPeriod: 3000, stopped: false });
  });
});

/** A room recording of `words` by `who`, its notes written. */
async function note(who: Account, title: string, words: string): Promise<string> {
  const rec = await who.api.recordings.start({ title });
  await rec.transcribe(speech(words, 0));
  const id = (await rec.stop()).pendingNoteId;
  await written(who.api, id);
  return id;
}
async function drain<T>(it: AsyncIterable<T>): Promise<T[]> { const out: T[] = []; for await (const x of it) out.push(x); return out; }
/** What the notes model was sent for a question across notes. */
const promptFor = (question: string) => h.near.prompts.filter((p) => p.includes(`Question: ${question}`)).at(-1) ?? '';
const TEAM_READS = 'forbidden: This note is visible to your team to read and ask about. Only its organizer changes it.';
const NO_NOTE = 'not-found: Those notes doesn’t exist, or you don’t have access to it.';
const NO_WORKSPACE = 'not-found: That workspace doesn’t exist, or you don’t have access to it.';

describe('team notes, Ask and team workspaces', () => {
  it('G10: a note made visible to the team opens for licensed members to read and ask about, refuses every change, and stays after its organizer leaves', async () => {
    await setLimit('plan.period_seconds', 3600);
    const [ann, bob, cy, dee, eve] = await Promise.all([account(), account(), account(), account(), account()]);
    await team(ann, 2);
    await joined(ann, bob);
    await joined(ann, cy);
    // Dee joins with no license left: on the team, but not licensed.
    expect(await joined(ann, dee)).toMatchObject({ licensed: false });
    const id = await note(bob, 'Harbour launch', 'We agreed the harbour opens on Friday.');
    expect(await refusal(cy.api.notes.get(id))).toBe(NO_NOTE);
    // Only its organizer makes it visible: someone it was given to can't.
    await bob.api.notes.share(id, { emails: [eve.email] });
    expect(await refusal(eve.api.notes.setTeamVisible(id, true))).toBe('forbidden: Only the organizer can make these notes visible to their team.');
    await bob.api.notes.setTeamVisible(id, true);
    await bob.api.notes.setTeamVisible(id, true);
    expect(await bob.api.notes.get(id)).toMatchObject({ teamVisible: true });
    expect((await h.pool.query('SELECT count(*)::int AS n FROM team_notes WHERE note_item_id = $1', [id])).rows[0]).toEqual({ n: 1 });
    // Cy reads it, says how she has it, finds it among the team's notes and asks about it; it isn't in her own notes.
    const seen = await cy.api.notes.get(id);
    expect(seen).toMatchObject({ title: 'Harbour launch', teamVisible: true, received: { role: 'team', by: { email: bob.email } } });
    expect((await cy.api.teams.notes()).map((n) => [n.id, n.received?.role])).toEqual([[id, 'team']]);
    expect((await bob.api.teams.notes()).map((n) => [n.id, n.received])).toEqual([[id, undefined]]);
    expect((await cy.api.notes.list()).map((n) => n.id)).not.toContain(id);
    expect((await drain(cy.api.notes.ask(id, 'When does the harbour open?'))).length).toBeGreaterThan(0);
    // Every change, and anything of hers on it, is refused.
    const action = seen.actions[0]?.id ?? 'AAAAAAAAAAAAAAAAAAAAAA';
    const writes: (() => Promise<unknown>)[] = [
      () => cy.api.notes.share(id, { emails: [unique()] }), () => cy.api.notes.createLink(id), () => cy.api.notes.links(id),
      () => cy.api.notes.proposeDecision(id, { text: 'Open on Saturday instead.' }), () => cy.api.notes.proposeAction(id, { text: 'Book the ferry.' }),
      () => cy.api.notes.updateAction(id, action, { done: true }), () => cy.api.notes.rewrite(id), () => cy.api.notes.delete(id),
      () => cy.api.notes.personal(id).add({ kind: 'note', text: 'Mine.' }), () => cy.api.notes.personal(id).get(), () => cy.api.notes.sharedAudience(id),
      () => cy.api.notes.setTeamVisible(id, false), () => cy.api.drive.forNote(id)
    ];
    for (const write of writes) expect(await refusal(write())).toBe(TEAM_READS);
    expect(await cy.api.notes.get(id)).toMatchObject({ teamVisible: true, decisions: seen.decisions, actions: seen.actions });
    // Only licensed members: Dee, on the team without a license, and Eve's own copy aside, nobody else.
    expect(await refusal(dee.api.notes.get(id))).toBe(NO_NOTE);
    expect(await dee.api.teams.notes()).toEqual([]);
    expect((await eve.api.notes.get(id)).received?.role).toBe('shared');
    // Bob leaves the team: it stays visible to it. Off the team he can stop that, but not start it again.
    await bob.api.teams.leave();
    expect((await cy.api.notes.get(id)).received?.role).toBe('team');
    expect(await refusal(bob.api.notes.setTeamVisible(id, true))).toBe('forbidden: You need a license on a team to make notes visible to it.');
    await bob.api.notes.setTeamVisible(id, false);
    expect(await refusal(cy.api.notes.get(id))).toBe(NO_NOTE);
    expect(await cy.api.teams.notes()).toEqual([]);
    // Visible again (back on the team), until Cy's license ends; and it goes with the note.
    await joined(ann, bob);
    await give(ann, LICENSE);
    await ann.api.teams.buyLicenses(1, LICENSE);
    await bob.api.auth.visit();
    await bob.api.notes.setTeamVisible(id, true);
    expect((await cy.api.notes.get(id)).received?.role).toBe('team');
    const until = Date.parse((await cy.api.plans.plan()).period.to);
    vi.useFakeTimers({ toFake: ['Date'], now: until + 60_000 });
    expect(await refusal(cy.api.notes.get(id))).toBe(NO_NOTE);
    vi.useRealTimers();
    await bob.api.notes.delete(id);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM team_notes WHERE note_item_id = $1', [id])).rows[0]).toEqual({ n: 0 });
  });

  it('G11: Ask reads the team’s notes too; @-references go first, at most 5, and one you can’t open is refused', async () => {
    const [ann, bob, cy] = await Promise.all([account(), account(), account()]);
    await team(ann, 2);
    await ann.api.auth.visit();
    await joined(ann, bob);
    const ours = await note(bob, 'Lighthouse budget', 'The lighthouse budget is twelve thousand.');
    const mine = await note(ann, 'Harbour rota', 'Kofi takes the harbour rota in March.');
    const theirs = await note(cy, 'Quarry survey', 'The quarry survey closes on Tuesday.');
    await drain(ann.api.notes.askAll('What is the lighthouse budget?'));
    expect(promptFor('What is the lighthouse budget?')).not.toContain('Lighthouse budget');
    await bob.api.notes.setTeamVisible(ours, true);
    await drain(ann.api.notes.askAll('What is the lighthouse budget again?'));
    const prompt = promptFor('What is the lighthouse budget again?');
    expect(prompt).toContain('Lighthouse budget');
    expect(prompt).toContain('Harbour rota');
    expect(prompt).not.toContain('Quarry survey');
    // A question that shares no words with a note sends none of its transcript, unless it refers to it.
    await drain(ann.api.notes.askAll('Anything else?'));
    expect(promptFor('Anything else?')).not.toMatch(/L1 .*twelve thousand/);
    await drain(ann.api.notes.askAll('Anything more?', [ours, mine]));
    expect(promptFor('Anything more?')).toMatch(/L1 .*twelve thousand/);
    // A reference to a note you can't open is refused, as one that never was; more than 5, in words. Nothing goes to the model.
    const asked = h.near.prompts.length;
    expect(await refusal(drain(ann.api.notes.askAll('Anything?', [theirs])))).toBe(NO_NOTE);
    expect(await refusal(drain(ann.api.notes.askAll('Anything?', ['AAAAAAAAAAAAAAAAAAAAAA'])))).toBe(NO_NOTE);
    expect(await refusal(drain(ann.api.notes.askAll('Anything?', [mine, ours, theirs, 'a', 'b', 'c'])))).toBe('invalid: Refer to 5 notes at most in one question.');
    expect(h.near.prompts.length).toBe(asked);
    // Someone on no team asks across their own notes only.
    await drain(cy.api.notes.askAll('What is the lighthouse budget, Cy?'));
    expect(promptFor('What is the lighthouse budget, Cy?')).not.toContain('Lighthouse budget');
  });

  it('G12′: a team workspace is the whole team’s or only the people added, from the pool, and the whole team’s only while licensed', async () => {
    await setLimit('plan.period_seconds', 3600);
    const [ann, bob, cy, eve] = await Promise.all([account(), account(), account(), account()]);
    await team(ann, 3);
    await ann.api.auth.visit();
    await joined(ann, bob);
    await joined(ann, cy);
    const whole = await workspace(ann, 'Whole team');
    const { id: few } = await ann.api.workspaces.create('Only some', { access: 'added' });
    const { id: own } = await eve.api.workspaces.create('Eve’s', { access: 'team' });
    expect(await ann.api.workspaces.get(whole.id)).toMatchObject({ role: 'admin', teamAccess: 'team' });
    expect(await ann.api.workspaces.get(few)).toMatchObject({ role: 'admin', teamAccess: 'added' });
    // Off a team, `access` means nothing.
    expect(await eve.api.workspaces.get(own)).toMatchObject({ role: 'admin', teamAccess: null });
    // Bob is in the whole team's without being added, and edits it; the other one isn't his.
    expect((await bob.api.workspaces.list()).map((w) => [w.name, w.role, w.teamAccess])).toEqual([['Whole team', 'edit', 'team']]);
    expect(await bob.api.workspaces.get(whole.id)).toMatchObject({ role: 'edit', teamAccess: 'team', items: [{ id: whole.doc }] });
    await bob.api.workspaces.items.create(whole.id, { kind: 'document', name: 'Bob’s', parent: null });
    expect(await refusal(bob.api.workspaces.get(few))).toBe(NO_WORKSPACE);
    expect(await refusal(eve.api.workspaces.get(whole.id))).toBe(NO_WORKSPACE);
    // Someone added who's on the team as `read` edits it while it's the whole team's.
    await ann.api.workspaces.addPerson(few, cy.email, 'read');
    expect(await cy.api.workspaces.get(few)).toMatchObject({ role: 'read' });
    // Only an admin changes who's in it, only on a team's, and opening it to the team takes a license on that team.
    expect(await refusal(bob.api.workspaces.setTeamAccess(whole.id, 'added'))).toBe('forbidden: Only an admin can do that.');
    expect(await refusal(eve.api.workspaces.setTeamAccess(few, 'team'))).toBe(NO_WORKSPACE);
    expect(await refusal(eve.api.workspaces.setTeamAccess(own, 'team'))).toBe('conflict: This workspace isn’t a team’s, so there’s no team to open it to.');
    await ann.api.workspaces.setTeamAccess(few, 'team');
    expect(await cy.api.workspaces.get(few)).toMatchObject({ role: 'edit', teamAccess: 'team' });
    expect(await bob.api.workspaces.get(few)).toMatchObject({ role: 'edit', teamAccess: 'team' });
    await ann.api.workspaces.setTeamAccess(few, 'added');
    expect(await refusal(bob.api.workspaces.get(few))).toBe(NO_WORKSPACE);
    expect(await cy.api.workspaces.get(few)).toMatchObject({ role: 'read', teamAccess: 'added' });
    // What's stored in it counts against the pool.
    expect(await upload(ann, whole, 64 * 1024)).toBe('succeeded');
    const used = (await ann.api.teams.mine())?.storage.usedBytes ?? 0;
    expect(used).toBeGreaterThanOrEqual(64 * 1024);
    expect((await bob.api.plans.plan()).storage.usedBytes).toBe(used);
    // Taken off the team, Bob is out at once; Cy is out once her license ends.
    await ann.api.teams.remove(await memberId(ann, bob));
    expect(await refusal(bob.api.workspaces.get(whole.id))).toBe(NO_WORKSPACE);
    expect(await bob.api.workspaces.list()).toEqual([]);
    const until = Date.parse((await cy.api.plans.plan()).period.to);
    vi.useFakeTimers({ toFake: ['Date'], now: until + 60_000 });
    expect(await refusal(cy.api.workspaces.get(whole.id))).toBe(NO_WORKSPACE);
    vi.useRealTimers();
  });

  it('G13: AI in a team workspace is paid for by whoever pressed it, from their own plan, as it is in any other', async () => {
    const [ann, bob, eve] = await Promise.all([account(), account(), account()]);
    await team(ann, 2);
    await ann.api.auth.visit();
    await joined(ann, bob);
    const ours = await workspace(ann, 'Ours');
    const spent = async (who: Account) => (await standing(h.deps, h.pool, who.session.ownerId)).byKind['documents'] ?? 0;
    expect(await drain(bob.api.workspaces.ask(ours.id, ours.doc, { action: 'shorter', text: 'A long way of saying it' }))).toEqual([{ type: 'text', text: 'Shorter: A long way of saying it' }]);
    expect(await spent(bob)).toBeGreaterThan(0);
    expect(await spent(ann)).toBe(0);
    // Eve's workspace isn't a team's, and it's the same there: Bob pressed it, so Bob pays, not Eve.
    const hers = await workspace(eve, 'Hers');
    await eve.api.workspaces.addPerson(hers.id, bob.email, 'edit');
    const before = await spent(bob);
    await drain(bob.api.workspaces.ask(hers.id, hers.doc, { action: 'checklist', text: 'Book the room; send the brief' }));
    expect(await spent(bob)).toBeGreaterThan(before);
    expect(await spent(eve)).toBe(0);
  });

  it('I2: a note, a reference or a workspace from a request only reaches what its caller can open', async () => {
    const [ann, bob, cy, dee] = await Promise.all([account(), account(), account(), account()]);
    await team(ann, 1, 'Ours');
    await ann.api.auth.visit();
    await team(cy, 2, 'Theirs');
    await cy.api.auth.visit();
    await joined(cy, dee);
    const theirs = await note(cy, 'Their plan', 'The plan ships in June.');
    await cy.api.notes.setTeamVisible(theirs, true);
    expect((await dee.api.teams.notes()).map((n) => n.id)).toEqual([theirs]);
    // Another team's note: unknown to Ann, to read, to refer to, or to make visible.
    expect(await refusal(ann.api.notes.get(theirs))).toBe(NO_NOTE);
    expect(await refusal(drain(ann.api.notes.askAll('When does it ship?', [theirs])))).toBe(NO_NOTE);
    expect(await refusal(ann.api.notes.setTeamVisible(theirs, true))).toBe(NO_NOTE);
    expect(await refusal(ann.api.notes.setTeamVisible(theirs, false))).toBe(NO_NOTE);
    expect(await ann.api.teams.notes()).toEqual([]);
    expect(await refusal(bob.api.notes.setTeamVisible(theirs, false))).toBe(NO_NOTE);
    // Dee can't stop it being visible: it isn't hers.
    expect(await refusal(dee.api.notes.setTeamVisible(theirs, false))).toBe(TEAM_READS);
    expect((await cy.api.notes.get(theirs)).teamVisible).toBe(true);
    // Another team's workspace for the whole team.
    const { id } = await cy.api.workspaces.create('Theirs');
    expect(await refusal(ann.api.workspaces.get(id))).toBe(NO_WORKSPACE);
    expect(await refusal(ann.api.workspaces.setTeamAccess(id, 'added'))).toBe(NO_WORKSPACE);
    expect((await ann.api.workspaces.list()).map((w) => w.id)).not.toContain(id);
  });
});

describe('nobody reaches another team', () => {
  it('I2: team, member and invite IDs from a request only work on the caller’s own team, as its admin', async () => {
    const [ann, bob, cy, dee, eve] = await Promise.all([account(), account(), account(), account(), account()]);
    await team(ann, 1, 'Ours');
    await joined(ann, bob);
    await team(cy, 1, 'Theirs');
    await joined(cy, dee);
    const deeId = await memberId(cy, dee);
    const annId = await memberId(ann, ann);
    expect(await refusal(ann.api.teams.remove(deeId))).toBe('not-found: That person isn’t on your team.');
    expect((await cy.api.teams.mine())?.members.map((m) => m.person.email)).toEqual([cy.email, dee.email]);
    expect(await refusal(ann.api.teams.remove('AAAAAAAAAAAAAAAAAAAAAA'))).toBe('not-found: That person isn’t on your team.');
    // A member manages nothing, and sees nothing of the licenses or money.
    const asBob = [() => bob.api.teams.remove(annId), () => bob.api.teams.invite(), () => bob.api.teams.buyLicenses(1, LICENSE), () => bob.api.teams.refundLicenses(), () => bob.api.teams.setAutoPurchase(true), () => bob.api.teams.delete()];
    for (const call of asBob) expect(await refusal(call())).toBe(ADMIN_ONLY);
    expect((await bob.api.teams.mine())?.licenses).toBeNull();
    // Someone on no team has no team to act on.
    expect(await eve.api.teams.mine()).toBeNull();
    const asEve = [() => eve.api.teams.remove(deeId), () => eve.api.teams.invite(), () => eve.api.teams.leave(), () => eve.api.teams.delete(), () => eve.api.teams.buyLicenses(1, LICENSE)];
    for (const call of asEve) expect(await refusal(call())).toBe(NO_TEAM);
    // Another account's notice is unknown.
    const [low] = (await ann.api.plans.plan()).notices;
    expect(low?.kind).toBe('licenses-low');
    expect(await refusal(cy.api.plans.dismissNotice(low?.id ?? ''))).toMatch(/^not-found: /);
    // An invite joins only the team it was made for.
    expect(await joined(cy, eve)).toMatchObject({ name: 'Theirs' });
    expect((await ann.api.teams.mine())?.members).toHaveLength(2);
  });
});

describe('a new address from the provider', () => {
  it('I6: shows a member, and an invite’s admin, by the name and address they sign in with now, and keeps no hash of any address', async () => {
    const sub = `sub-${seq++}`;
    const old = unique('old');
    const fresh = unique('fresh');
    const ann = await withGoogle(old, sub, 'Ann Before');
    const bob = await account();
    await team(ann, 1);
    await joined(ann, bob);
    const { link } = await ann.api.teams.invite();
    expect((await bob.api.teams.peek(secretOf(link))).admin).toMatchObject({ email: old, name: 'Ann Before' });
    // Ann's provider gives her a new address and name: her next sign-in is the same account, and her team shows her as she is.
    const again = await withGoogle(fresh, sub, 'Ann After');
    expect(again.session.ownerId).toBe(ann.session.ownerId);
    expect((await bob.api.teams.mine())?.members.map((m) => [m.role, m.person.email, m.person.name])).toEqual([['admin', fresh, 'Ann After'], ['member', bob.email, bob.session.user.name]]);
    expect((await again.api.teams.mine())?.members.find((m) => m.you)?.person).toMatchObject({ email: fresh, name: 'Ann After' });
    expect((await bob.api.teams.peek(secretOf(link))).admin).toMatchObject({ email: fresh, name: 'Ann After' });
    // Nothing of a member is in the clear but IDs, times and their role: no keyed hash of an address, the old one or the new.
    const columns = (await h.pool.query<{ name: string }>("SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'team_members' AND table_schema = current_schema() ORDER BY ordinal_position")).rows.map((r) => r.name);
    expect(columns).toEqual(['member_id', 'team_id', 'account_owner_id', 'role', 'person_ciphertext', 'licensed_from', 'licensed_until', 'wanted_at', 'created_at']);
  });
});

describe('deleting an account', () => {
  it('I3: takes a member off their team, refuses the admin of a team with others on it, and takes an empty team with its admin', async () => {
    const ann = await account();
    const bob = await account();
    const cy = await account();
    await team(ann, 2);
    await joined(ann, bob);
    await joined(ann, cy);
    const t = await ann.api.teams.mine();
    await bob.api.account.delete();
    expect((await h.pool.query('SELECT count(*)::int AS n FROM team_members WHERE account_owner_id = $1', [bob.session.ownerId])).rows[0]).toEqual({ n: 0 });
    expect((await ann.api.teams.mine())?.members.map((m) => m.person.email)).toEqual([ann.email, cy.email]);
    expect(await refusal(ann.api.account.delete())).toBe('conflict: You’re the admin of a team with other people on it. Take them off the team and delete it before deleting your account.');
    expect(await ann.api.plans.plan()).toMatchObject({ team: { id: t?.id } });
    await ann.api.teams.remove(await memberId(ann, cy));
    const teamOwner = (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM teams WHERE team_id = $1', [t?.id])).rows[0]?.owner_id;
    await ann.api.account.delete();
    expect((await h.pool.query('SELECT (SELECT count(*) FROM teams WHERE team_id = $1) + (SELECT count(*) FROM team_members WHERE team_id = $1) + (SELECT count(*) FROM owners WHERE owner_id = $2) AS n', [t?.id, teamOwner])).rows[0]).toEqual({ n: '0' });
    // Cy, who was on it, is on no team, and can make one.
    expect(await cy.api.teams.mine()).toBeNull();
  });
});
