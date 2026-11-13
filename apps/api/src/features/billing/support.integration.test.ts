/**
 * Support's command line (docs: Plans and usage › Support), run as support runs it: `billing-cli.ts` in its own process, against
 * the harness's database, with only the settings production's job has bound (the database and KSERVICE), and with KMASTER as
 * well, as it is locally. What it adds is read back through the real API over HTTP via @alcove/api-http, and what it prints
 * and logs, which the job's Cloud Logging keeps, holds no amount, history or address.
 */
import type { TopUp } from '@alcove/api';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { watch } from './deposits';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
/** Another account at the same address, through (the stand-in) Google: a provider of its own, so an account of its own. */
async function googleAccount(email: string) {
  const b = h.browser();
  h.google.next({ sub: `google-${Date.now().toString(36)}${(seq++).toString(36)}`, email, name: 'Sam Google' });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  return { ...b, session };
}
type Account = Awaited<ReturnType<typeof account>>;
const balance = async (who: Pick<Account, 'api'>) => (await who.api.plans.plan()).balance;

/** Everything the command line printed and logged, every run: none of it may hold an address. */
const said: string[] = [];
/**
 * `billing …` in its own process, with production's job's settings and nothing else of the API's (`local` adds KMASTER, as
 * .env has it), logging JSON as the job does. Its exit code, and what it printed and logged.
 */
function billing(args: string[], local = true): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const env = {
      PATH: process.env['PATH'] ?? '', DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '', KSERVICE: h.deps.cfg.KSERVICE, LOG_FORMAT: 'json', LOG_LEVEL: 'info',
      ...(local ? { KMASTER: h.deps.cfg.KMASTER } : {})
    };
    const run = spawn(process.execPath, ['--import', 'tsx', 'src/billing-cli.ts', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    run.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    run.stderr.on('data', (b: Buffer) => { out += b.toString(); });
    run.on('error', reject);
    run.on('close', (code) => { said.push(out); resolve({ code, out }); });
  });
}
/** A top-up of `microUsd` for `who`, and the address 1Click quoted for it. */
async function topUp(who: Account, microUsd: number): Promise<TopUp & { address: string }> {
  const t = await who.api.plans.startTopUp(BASE_USDC, microUsd);
  if (!t.address) throw new Error('no address quoted');
  return { ...t, address: t.address };
}
/** What 1Click says once a top-up of `microUsd` has settled in full. */
const settled = (t: TopUp, microUsd: number) => ({ depositedAmount: String(microUsd), amountOut: String(microUsd), intentHashes: [`support-${t.id}`] });
/** That the deposit's next check is due, so reading it asks 1Click again, as the app's next look would after a while. */
const askAgain = (id: string) => h.pool.query('UPDATE deposits SET checked_at = NULL WHERE deposit_id = $1', [id]);
/** Makes this top-up the one the watcher's next pass takes on: every other one still watched waits an hour. */
const dueOnly = (id: string) => h.pool.query(
  "UPDATE deposits SET check_after = CASE WHEN deposit_id = $1 THEN now() ELSE now() + interval '1 hour' END WHERE state NOT IN ('credited', 'held') AND check_after < 'infinity'", [id]);
/** Whether nothing watches the top-up any more: no pass takes it on, and no look asks 1Click about it. */
const unwatched = async (id: string) => (await h.pool.query<{ closed: boolean }>("SELECT check_after = 'infinity' AS closed FROM deposits WHERE deposit_id = $1", [id])).rows[0]?.closed;
/** How many times the API logged `msg` since `from`. */
const logged = (from: number, msg: string) => h.logs.slice(from).filter((l) => l.includes(`"msg":"${msg}"`)).length;
const ADDED = (ownerId: string) => `Added to the balance of account ${ownerId}, as “Added by support”.`;

describe('billing on the command line', () => {
  it('adds dollars to an account found by its address where KMASTER is set, and says where its plan stands without an amount', async () => {
    const ann = await account();
    const credit = await billing(['credit', ann.email.toUpperCase(), '4.50']);
    expect(credit).toEqual({ code: 0, out: expect.stringContaining(ADDED(ann.session.ownerId)) });
    expect((await billing(['credit', ann.email, '$20'])).code).toBe(0);
    expect(await balance(ann)).toMatchObject({ microUsd: 24_500_000, history: [{ label: 'Added by support', microUsd: 20_000_000 }, { label: 'Added by support', microUsd: 4_500_000 }] });
    const show = await billing(['show', ann.email]);
    expect(show.code).toBe(0);
    const lines = show.out.split('\n').filter((l) => l && !l.startsWith('{'));
    expect(lines).toEqual([
      `Account ${ann.session.ownerId}`, 'Plan: free; renewing Pro off', 'Months of Pro not over: 0', 'Balance: covers a month of Pro',
      'Changes to the balance kept: 2', 'Notices not dismissed: 0', 'Top-ups: none'
    ]);
    // Nothing it says is an amount: not the balance, not what was added.
    expect(show.out + credit.out).not.toMatch(/\$|4\.5|24\.5|4500000|24500000/);
    // An account by its ID, as production's job finds one: adding to it, and one short of a month of Pro.
    const bob = await account();
    expect(await billing(['credit', bob.session.ownerId, '7'], false)).toMatchObject({ code: 0, out: expect.stringContaining(ADDED(bob.session.ownerId)) });
    expect(await balance(bob)).toMatchObject({ microUsd: 7_000_000, history: [{ label: 'Added by support', microUsd: 7_000_000 }] });
    expect(await billing(['show', bob.session.ownerId], false)).toMatchObject({ code: 0, out: expect.stringContaining('Balance: doesn’t cover a month of Pro') });
  });

  it('refuses an amount that isn’t one, an unknown command, and anyone it can’t find, adding nothing and repeating nothing typed', async () => {
    const ann = await account();
    for (const typed of ['0', '-5', '10000.000001', '1.1234567', '1e3', 'abc', '']) {
      const r = await billing(['credit', ann.email, typed]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('An amount is dollars, more than 0 and at most 10000, with up to 6 decimals: 20, 4.50.');
      expect(r.out).toContain('"msg":"billing refused"');
      expect(r.out).toContain('"why":"not an amount"');
    }
    expect((await balance(ann)).microUsd).toBe(0);
    const usage = await billing(['add', ann.email, '5']);
    expect(usage.code).toBe(1);
    expect(usage.out).toContain('billing credit <who> <usd>');
    const refused = async (args: string[], words: string, local = true) => {
      const r = await billing(args, local);
      expect(r.code).toBe(1);
      expect(r.out).toContain(words);
      expect(r.out).toContain('"msg":"billing refused"');
    };
    await refused(['credit', unique('nobody'), '5'], 'No account has signed in with that address.');
    await refused(['show', 'AAAAAAAAAAAAAAAAAAAAAA'], 'No top-up has that reference.');
    await refused(['show', 'A'.repeat(43)], 'No account has that ID.');
    await refused(['show', 'not-a-reference'], 'Name the account by a top-up’s reference or by its ID.');
    // Production's job has no KMASTER: an address finds nobody there, so support never types one into it.
    await refused(['credit', ann.email, '5'], 'An address finds an account only where KMASTER is set, as it is locally. Name it by a top-up’s reference or by its ID.', false);
    expect((await balance(ann)).microUsd).toBe(0);
  });

  it('refuses an address two accounts sign in with, and adds to neither', async () => {
    const email = unique('shared');
    const one = await account(email);
    const two = await googleAccount(email);
    expect(two.session.ownerId).not.toBe(one.session.ownerId);
    const r = await billing(['credit', email, '5']);
    expect(r).toEqual({ code: 1, out: expect.stringContaining('2 accounts signed in with that address. Nothing was done.') });
    expect((await balance(one)).microUsd).toBe(0);
    expect((await balance(two)).microUsd).toBe(0);
  });

  it('adds a failed top-up’s money by its reference, once, after which it can’t add itself again; refuses one still watched or added already', async () => {
    const ann = await account();
    // Still waiting for a payment: Alcove adds what reaches it by itself, so support can't.
    const open = await topUp(ann, 25_000_000);
    const watched = await billing(['credit', open.id, '25'], false);
    expect(watched.code).toBe(1);
    expect(watched.out).toContain('Alcove is still watching this top-up, and adds what reaches it by itself. Add it by hand once it has failed or expired.');
    expect((await balance(ann)).microUsd).toBe(0);
    // 1Click reports it failed: support adds what reached the treasury, by the reference the person gives.
    h.oneclick.set(open.address, 'FAILED');
    expect(await ann.api.plans.topUp(open.id)).toMatchObject({ state: 'failed' });
    const show = await billing(['show', open.id], false);
    expect(show.out).toContain(`Account ${ann.session.ownerId}`);
    expect(show.out).toContain(`Top-up ${open.id}: failed`);
    expect(show.out).toContain('Top-ups: 1 failed');
    const added = await billing(['credit', open.id, '25'], false);
    expect(added.code).toBe(0);
    expect(added.out).toContain(ADDED(ann.session.ownerId));
    expect(added.out).toContain(`Top-up ${open.id} (failed) is no longer watched, so it can’t add itself again.`);
    expect((await balance(ann)).microUsd).toBe(25_000_000);
    // 1Click settles it cleanly after all: it isn't added a second time.
    h.oneclick.set(open.address, 'SUCCESS', settled(open, 25_000_000));
    await askAgain(open.id);
    expect(await ann.api.plans.topUp(open.id)).toMatchObject({ state: 'failed' });
    expect((await balance(ann)).microUsd).toBe(25_000_000);
    // Nor by support again: its reference adds its money once.
    const again = await billing(['credit', open.id, '25'], false);
    expect(again.code).toBe(1);
    expect(again.out).toContain('This top-up isn’t watched any more, so its reference adds nothing: support has added it already, or its 30 days are over. Add anything more by the account’s ID.');
    expect((await balance(ann)).microUsd).toBe(25_000_000);
    // One given up on with no answer from 1Click (it was down at the deadline) reached support: added, it reads as failed.
    const quiet = await topUp(ann, 5_000_000);
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 minute' WHERE deposit_id = $1", [quiet.id]);
    expect(await billing(['credit', quiet.id, '5'], false)).toMatchObject({ code: 0, out: expect.stringContaining(`Top-up ${quiet.id} (failed) is no longer watched, so it can’t add itself again.`) });
    expect(await ann.api.plans.topUp(quiet.id)).toMatchObject({ state: 'failed' });
    expect((await balance(ann)).microUsd).toBe(30_000_000);
    // A top-up added by itself is refused by its reference, so support never adds it twice. A second payment to its
    // address is a payment of its own, added by the account's ID.
    const used = await topUp(ann, 10_000_000);
    h.oneclick.set(used.address, 'SUCCESS', settled(used, 10_000_000));
    expect(await ann.api.plans.topUp(used.id)).toMatchObject({ state: 'credited' });
    const twice = await billing(['credit', used.id, '10'], false);
    expect(twice.code).toBe(1);
    expect(twice.out).toContain('This top-up was added when its payment arrived. Add a payment of its own to its address by the account’s ID.');
    expect((await balance(ann)).microUsd).toBe(40_000_000);
    expect(await billing(['credit', ann.session.ownerId, '3'], false)).toMatchObject({ code: 0, out: expect.stringContaining(ADDED(ann.session.ownerId)) });
    expect((await balance(ann)).microUsd).toBe(43_000_000);
  });

  it('adds a top-up once when support adds it while a check of it is on its way to 1Click, which answers that it settled', async () => {
    const ann = await account();
    const logsFrom = h.logs.length;
    /** A top-up 1Click said failed, which the person has seen. */
    const failed = async (microUsd: number) => {
      const t = await topUp(ann, microUsd);
      h.oneclick.set(t.address, 'FAILED');
      expect(await ann.api.plans.topUp(t.id)).toMatchObject({ state: 'failed' });
      return t;
    };
    // The person looks at it again, and 1Click answers only once support has added it by hand: that it settled after all.
    const looked = await failed(25_000_000);
    await askAgain(looked.id);
    const answer = h.oneclick.hold(looked.address);
    const looking = ann.api.plans.topUp(looked.id);
    await answer.asked;
    expect((await billing(['credit', looked.id, '25'], false)).code).toBe(0);
    h.oneclick.set(looked.address, 'SUCCESS', settled(looked, 25_000_000));
    answer.release();
    expect(await looking).toMatchObject({ state: 'failed' });
    expect(await balance(ann)).toMatchObject({ microUsd: 25_000_000, history: [{ label: 'Added by support', microUsd: 25_000_000 }] });

    // The watcher's pass took one on just before support added it: 1Click's answer adds nothing either.
    const watched = await failed(10_000_000);
    await dueOnly(watched.id);
    const passAnswer = h.oneclick.hold(watched.address);
    const pass = watch(h.deps);
    await passAnswer.asked;
    expect((await billing(['credit', watched.id, '10'], false)).code).toBe(0);
    h.oneclick.set(watched.address, 'SUCCESS', settled(watched, 10_000_000));
    passAnswer.release();
    expect(await pass).toEqual({ checked: 1, credited: 0 });
    expect(await unwatched(watched.id)).toBe(true);

    // And when 1Click can't answer that pass, it stays unwatched: nothing asks about it again, to add it when 1Click does.
    const unanswered = await failed(5_000_000);
    await dueOnly(unanswered.id);
    const failing = h.oneclick.hold(unanswered.address);
    const failedPass = watch(h.deps);
    await failing.asked;
    expect((await billing(['credit', unanswered.id, '5'], false)).code).toBe(0);
    h.oneclick.down(true);
    failing.release();
    await failedPass;
    h.oneclick.down(false);
    expect(await unwatched(unanswered.id)).toBe(true);
    h.oneclick.set(unanswered.address, 'SUCCESS', settled(unanswered, 5_000_000));
    await askAgain(unanswered.id);
    expect(await ann.api.plans.topUp(unanswered.id)).toMatchObject({ state: 'failed' });
    expect(await watch(h.deps)).toMatchObject({ credited: 0 });

    // Each once, by support alone, and each answer that came after is logged as changing nothing.
    expect(await balance(ann)).toMatchObject({ microUsd: 40_000_000 });
    expect((await balance(ann)).history.map((e) => e.label)).toEqual(['Added by support', 'Added by support', 'Added by support']);
    expect(logged(logsFrom, 'top-up answered once it wasn’t watched any more; nothing changed')).toBe(2);
  });

  it('never says an address back, in what it printed or logged', async () => {
    const addresses = (await Promise.all([account(), account()])).map((a) => a.email);
    for (const email of addresses) {
      await billing(['credit', email, '1']);
      await billing(['show', email]);
      await billing(['show', email], false);
      await billing(['credit', email, 'abc']);
      await billing(['credit', email, '1', email]);
    }
    const all = said.join('\n').toLowerCase();
    for (const email of addresses) expect(all).not.toContain(email.toLowerCase());
    expect(all).not.toContain('@tests.example');
  });
});
