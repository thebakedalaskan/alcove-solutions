/**
 * Adding money by sending stablecoins, end to end: the real API over HTTP via @alcove/api-http, real Postgres,
 * and a stand-in NEAR Intents 1Click (testing/fake-oneclick.ts) that quotes deposit addresses and reports on them. And
 * buying with a payment: what a top-up was opened to buy, bought once its money is added.
 */
import { AlcoveApiError, MAX_TOP_UP_MICRO_USD, type AlcoveApi, type Purchase, type TopUp } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { DepositRecord, watch } from './deposits';
import { creditByEmail } from './support';
import { NOT_ALLOWLISTED } from '../../testing/fake-oneclick';
import { ORIGIN, cookieFetch, startHarness, type Harness } from '../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const ETH_USDC = 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near';
const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const BNB_USDC = 'nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r';
const TRON_USDT = 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near';
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const failure = (p: Promise<unknown>) => p.then(() => 'succeeded', code);
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
/** The address a top-up shows, while it shows one. */
function addr(t: TopUp): string {
  if (!t.address) throw new Error(`top-up ${t.id} shows no address`);
  return t.address;
}
/** The API's log lines since `from`, parsed (pino levels: 40 warn, 50 error). */
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const logsSince = (from: number) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [{ ...r.data, line: l }] : []; });
/** As if 5 seconds had passed since the app last asked 1Click about this top-up. */
const forgetCheck = (id: string) => h.pool.query('UPDATE deposits SET checked_at = NULL WHERE deposit_id = $1', [id]);
/** Makes only these top-ups due for the watcher; every other one still watched waits an hour, so a pass sees just these. */
const dueOnly = (...ids: string[]) => h.pool.query(
  "UPDATE deposits SET check_after = CASE WHEN deposit_id = ANY($1) THEN now() ELSE now() + interval '1 hour' END WHERE state NOT IN ('credited','held') AND check_after < 'infinity'", [ids]);
/** Makes every top-up still watched but these wait an hour, leaving these as they are. */
const notDue = (...ids: string[]) => h.pool.query(
  "UPDATE deposits SET check_after = now() + interval '1 hour' WHERE state NOT IN ('credited','held') AND check_after < 'infinity' AND NOT deposit_id = ANY($1)", [ids]);
/** Seconds until the watcher looks at this top-up again. */
const nextCheckIn = async (id: string) =>
  Number((await h.pool.query<{ s: string }>('SELECT extract(epoch FROM check_after - now())::text AS s FROM deposits WHERE deposit_id = $1', [id])).rows[0]?.s);
/** Within 3 seconds of `want`: a pass, a query and a busy test machine all take time. */
const about = (got: number, want: number) => { expect(got).toBeGreaterThanOrEqual(want - 3); expect(got).toBeLessThanOrEqual(want + 3); };
const balance = async (api: AlcoveApi) => (await api.plans.plan()).balance.microUsd;
const stateOf = async (id: string) => (await h.pool.query<{ state: string }>('SELECT state FROM deposits WHERE deposit_id = $1', [id])).rows[0]?.state;
/**
 * Opens 15 top-ups for one person, the most that can wait at once: 10 through the test server and 5 through a second
 * one on the same database, since each API instance lets an account open 10 a minute. `second` is signed in as them.
 */
async function fifteen() {
  const email = unique();
  const { api } = await account(email);
  const server = await h.secondServer();
  const second: AlcoveApi = createHttpApi({ baseUrl: server.baseUrl, fetch: cookieFetch(ORIGIN) });
  await second.auth.signIn('sso', { email });
  const opened: TopUp[] = [];
  for (let i = 0; i < 10; i++) opened.push(await api.plans.startTopUp(BASE_USDC, 10_000_000));
  for (let i = 0; i < 5; i++) opened.push(await second.plans.startTopUp(BASE_USDC, 10_000_000));
  return { api, second, opened, close: () => server.close() };
}
const depositRows = async (ownerId: string) => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM deposits WHERE owner_id = $1', [ownerId])).rows[0]?.n;

/** Both requests pass the first count and get quotes before either can insert its deposit. */
async function raceTopUpStarts(ownerId: string, first: AlcoveApi, second: AlcoveApi): Promise<string[]> {
  const gate = await h.pool.connect();
  let pending: Promise<string>[] = [];
  try {
    await gate.query('BEGIN');
    await gate.query("SELECT pg_advisory_xact_lock(hashtext('alcove/deposits'), hashtext($1))", [ownerId]);
    const quotes = h.oneclick.quotes.length;
    pending = [first, second].map((api) => failure(api.plans.startTopUp(BASE_USDC, 10_000_000)));
    await expect.poll(() => h.oneclick.quotes.length - quotes, { timeout: 5000 }).toBe(2);
    // Both transactions are waiting, so the first count has seen the same last available slot twice.
    await expect.poll(async () => (await h.pool.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'
    `)).rows[0]?.n, { timeout: 5000 }).toBe(2);
    await gate.query('COMMIT');
    return await Promise.all(pending);
  } finally {
    await gate.query('ROLLBACK');
    gate.release();
    await Promise.all(pending);
  }
}

describe('top-ups', () => {
  it('lists the allowlisted routes with their minimum, and the presets: one, three and six periods of Pro', async () => {
    const { api } = await account();
    const { routes, presets } = await api.plans.routes();
    expect(routes.map((r) => `${r.token} ${r.chain}`)).toContain('USDC base');
    expect(routes.some((r) => r.id === NOT_ALLOWLISTED)).toBe(false);
    expect(routes.find((r) => r.chain === 'eth' && r.token === 'USDC')).toMatchObject({ minimum: '20' });
    expect(routes.find((r) => r.chain === 'base')).toMatchObject({ minimum: '5' });
    expect(routes.find((r) => r.chain === 'bsc' && r.token === 'USDC')).toMatchObject({ chainName: 'BNB Chain', minimum: '5' });
    expect(presets).toEqual([20_000_000, 60_000_000, 120_000_000]);
  });

  it('opens a top-up for an amount of dollars: a quote paying the treasury for exactly that', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    expect(t).toMatchObject({ state: 'waiting', received: null, asked: { amount: '10' }, route: { token: 'USDC', chain: 'base', minimum: '5' } });
    expect(t.address).toContain('canary-deposit-address');
    const TREASURY = h.oneclick.settings.TREASURY_INTENTS_ACCOUNT;
    expect(h.oneclick.quotes.at(-1)).toMatchObject({
      swapType: 'FLEX_INPUT', depositType: 'ORIGIN_CHAIN', originAsset: BASE_USDC,
      destinationAsset: NEAR_USDC, recipient: TREASURY, recipientType: 'INTENTS', refundTo: TREASURY, refundType: 'INTENTS',
      amount: '10000000', slippageTolerance: 100, dry: false
    });
    expect(h.oneclick.apiKeys.at(-1)).toBe(h.oneclick.settings.ONECLICK_API_KEY);
    expect(await api.plans.topUp(t.id)).toEqual(t);
    expect((await api.plans.topUps()).map((x) => x.id)).toEqual([t.id]);
  });

  it('quotes the amount asked in the token’s own units, a token as a dollar', async () => {
    const { api } = await account();
    const cases: [number, string, string][] = [[45_000_000, '45000000', '45'], [12_345_678, '12345678', '12.345678'], [8_000_000_000, '8000000000', '8000']];
    for (const [microUsd, amount, shown] of cases) {
      const t = await api.plans.startTopUp(BASE_USDC, microUsd);
      expect(h.oneclick.quotes.at(-1)?.amount).toBe(amount);
      expect(t.asked).toEqual({ amount: shown });
    }
    // BNB Chain's USDC has 18 decimals.
    const bnb = await api.plans.startTopUp(BNB_USDC, 45_000_000);
    expect(h.oneclick.quotes.at(-1)?.amount).toBe('45000000000000000000');
    expect(bnb.asked).toEqual({ amount: '45' });
    const odd = await api.plans.startTopUp(BNB_USDC, 5_000_001);
    expect(h.oneclick.quotes.at(-1)?.amount).toBe('5000001000000000000');
    expect(odd.asked).toEqual({ amount: '5.000001' });
  });

  it('refuses less than a route’s minimum, or more than one top-up adds', async () => {
    const { api, session } = await account();
    const quotes = h.oneclick.quotes.length;
    const from = h.logs.length;
    const e = await api.plans.startTopUp(BASE_USDC, 4_999_999).catch((x: unknown) => x);
    // The refusal is logged by its reason, never with how much was asked for.
    expect(logsSince(from).filter((l) => l.line.includes('4999999'))).toEqual([]);
    expect(code(e)).toBe('invalid');
    expect(e instanceof AlcoveApiError ? e.message : '').toBe('The least you can add with USDC on Base is $5.');
    const eth = await api.plans.startTopUp(ETH_USDC, 19_999_999).catch((x: unknown) => x);
    expect(code(eth)).toBe('invalid');
    expect(eth instanceof AlcoveApiError ? eth.message : '').toBe('The least you can add with USDC on Ethereum is $20.');
    expect(await failure(api.plans.startTopUp(BASE_USDC, MAX_TOP_UP_MICRO_USD + 1))).toBe('invalid');
    expect(await failure(api.plans.startTopUp(BASE_USDC, 10_000_000.5))).toBe('invalid');
    expect(await failure(api.plans.startTopUp(BASE_USDC, 0))).toBe('invalid');
    expect(await failure(api.plans.startTopUp(BASE_USDC, -10_000_000))).toBe('invalid');
    expect(h.oneclick.quotes.length).toBe(quotes);
    expect(await depositRows(session.ownerId)).toBe(0);
    expect((await api.plans.startTopUp(ETH_USDC, 20_000_000)).asked).toEqual({ amount: '20' });
    // The most one top-up adds is taken.
    expect((await api.plans.startTopUp(BASE_USDC, MAX_TOP_UP_MICRO_USD)).asked).toEqual({ amount: '8000' });
  });

  it('refuses a route that isn’t offered', async () => {
    const { api, session } = await account();
    expect(await failure(api.plans.startTopUp(NOT_ALLOWLISTED, 10_000_000))).toBe('invalid');
    expect(await depositRows(session.ownerId)).toBe(0);
  });

  it('keeps top-ups to their owner', async () => {
    const a = await account();
    const b = await account();
    const t = await a.api.plans.startTopUp(BASE_USDC, 10_000_000);
    expect(await failure(b.api.plans.topUp(t.id))).toBe('not-found');
    expect(await b.api.plans.topUps()).toEqual([]);
  });

  it('quotes without a partner key, sending none', async () => {
    const second = await h.secondServer({ ONECLICK_API_KEY: '' });
    try {
      const api: AlcoveApi = createHttpApi({ baseUrl: second.baseUrl, fetch: cookieFetch(ORIGIN) });
      await api.auth.signIn('sso', { email: unique() });
      const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
      expect(t.state).toBe('waiting');
      expect(h.oneclick.apiKeys.at(-1)).toBe('');
    } finally {
      await second.close();
    }
  });

  it('says top-ups are unavailable when there’s no treasury, or 1Click won’t quote', async () => {
    const second = await h.secondServer({ TREASURY_INTENTS_ACCOUNT: '' });
    try {
      const api: AlcoveApi = createHttpApi({ baseUrl: second.baseUrl, fetch: cookieFetch(ORIGIN) });
      await api.auth.signIn('sso', { email: unique() });
      const theirs = await (await account()).api.plans.startTopUp(BASE_USDC, 10_000_000);
      const e = await api.plans.routes().catch((x: unknown) => x);
      expect(code(e)).toBe('unavailable');
      expect(e instanceof AlcoveApiError ? e.message : '').toBe('Adding money isn’t available on this server.');
      expect(await failure(api.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('unavailable');
      expect(await failure(api.plans.topUp(theirs.id))).toBe('unavailable');
      expect(await failure(api.plans.cancelTopUp(theirs.id))).toBe('unavailable');
      expect(await failure(api.plans.topUps())).toBe('unavailable');
    } finally {
      await second.close();
    }

    const { api, session } = await account();
    h.oneclick.down(true);
    try {
      expect(await failure(api.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('unavailable');
    } finally {
      h.oneclick.down(false);
    }
    expect(await depositRows(session.ownerId)).toBe(0);
  });

  it('adds what was asked, once, says so in the balance’s history, and stops showing the address', async () => {
    const { api } = await account();
    expect(await balance(api)).toBe(0);
    const t = await api.plans.startTopUp(BASE_USDC, 45_000_000);
    // 1Click's fee comes out of what reaches the treasury; what's added goes by what was sent.
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '45000000', amountOut: '44990000', refundedAmount: '0', intentHashes: ['canary-intent-hash'] });
    const done = await api.plans.topUp(t.id);
    expect(done).toMatchObject({ state: 'credited', address: null, memo: null, asked: { amount: '45' }, received: { amount: '45', microUsd: 45_000_000 } });
    expect(await api.plans.topUp(t.id)).toEqual(done);
    await watch(h.deps);
    const { balance: now } = await api.plans.plan();
    expect(now.microUsd).toBe(45_000_000);
    expect(now.history).toMatchObject([{ label: 'Added, 45 USDC', microUsd: 45_000_000 }]);
    expect((await api.plans.topUps()).find((x) => x.id === t.id)).toEqual(done);
  });

  it('adds what was asked for a payment a little under it, within 1Click’s band', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 45_000_000);
    // The band reaches down to 44.55 USDC.
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '44600000', amountOut: '44590000', intentHashes: ['h446'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '44.6', microUsd: 45_000_000 } });
    expect(await balance(api)).toBe(45_000_000);
    expect((await api.plans.plan()).balance.history).toMatchObject([{ label: 'Added, 44.6 USDC', microUsd: 45_000_000 }]);
  });

  it('adds everything sent when more than asked', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 45_000_000);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '54000000', amountOut: '53990000', intentHashes: ['h54'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '54', microUsd: 54_000_000 } });
    expect(await balance(api)).toBe(54_000_000);
  });

  it('adds a swap below 1Click’s band as what was sent', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 45_000_000);
    // 40 USDC of the 45 asked, under the band's 44.55: 40, not the 45 asked.
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '40000000', amountOut: '39990000', intentHashes: ['h40'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '40', microUsd: 40_000_000 } });
    expect(await balance(api)).toBe(40_000_000);
  });

  it('refuses a quote for another amount, or with a band wider than 1.5%, and logs it as an error without amounts', async () => {
    const { api, session } = await account();
    const from = h.logs.length;
    h.oneclick.nextQuote({ amountIn: '9000000' });
    expect(await failure(api.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('unavailable');
    h.oneclick.nextQuote({ minAmountIn: '9840000' });
    expect(await failure(api.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('unavailable');
    expect(await depositRows(session.ownerId)).toBe(0);
    const lines = logsSince(from);
    expect(lines.some((l) => l.level === 50 && l.line.includes('unexpected-quote-amount'))).toBe(true);
    expect(lines.some((l) => l.level === 50 && l.line.includes('unexpected-quote-band'))).toBe(true);
    expect(lines.filter((l) => /9000000|9840000|10000000/.test(l.line))).toEqual([]);
    // A band of exactly 1.5% is taken.
    h.oneclick.nextQuote({ minAmountIn: '9850000' });
    expect((await api.plans.startTopUp(BASE_USDC, 10_000_000)).state).toBe('waiting');
  });

  it('reads 18-decimal tokens', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BNB_USDC, 45_000_000);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '45000000000000000000', amountOut: '44990000', intentHashes: ['h45'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '45', microUsd: 45_000_000 } });
    // Just under what was asked, within the band: what was asked.
    const under = await api.plans.startTopUp(BNB_USDC, 45_000_000);
    h.oneclick.set(addr(under), 'SUCCESS', { depositedAmount: '44700000000000000001', amountOut: '44690000', intentHashes: ['h447'] });
    expect(await api.plans.topUp(under.id)).toMatchObject({ state: 'credited', received: { amount: '44.7', microUsd: 45_000_000 } });
    expect(await balance(api)).toBe(45_000_000 + 45_000_000);
  });

  it('adds an 18-decimal refund whose units match 1Click’s own rendering, and adds nothing when they don’t', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BNB_USDC, 45_000_000);
    h.oneclick.set(addr(t), 'REFUNDED', {
      depositedAmount: '30000000000000000000', depositedAmountFormatted: '30.0', amountOut: '0',
      refundedAmount: '30000000000000000000', refundedAmountFormatted: '30', intentHashes: ['h30']
    });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '30', microUsd: 30_000_000 } });

    // A refund in units other than the token's (6 decimals on an 18-decimal token) disagrees with "30": not added.
    const odd = await api.plans.startTopUp(BNB_USDC, 45_000_000);
    h.oneclick.set(addr(odd), 'REFUNDED', {
      depositedAmount: '30000000000000000000', depositedAmountFormatted: '30', amountOut: '0',
      refundedAmount: '30000000', refundedAmountFormatted: '30', intentHashes: ['h30b']
    });
    expect(await api.plans.topUp(odd.id)).toMatchObject({ state: 'arriving', address: null, received: null });
    expect(await balance(api)).toBe(30_000_000);
  });

  it('shows a payment under the band as short, with the address, and adds what was refunded once it is', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 45_000_000);
    h.oneclick.set(addr(t), 'INCOMPLETE_DEPOSIT', { depositedAmount: '30000000' });
    expect(await api.plans.topUp(t.id)).toMatchObject({
      state: 'short', address: t.address, memo: t.memo, asked: { amount: '45' }, received: { amount: '30', microUsd: null }
    });
    expect(await balance(api)).toBe(0);

    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'REFUNDED', { depositedAmount: '30000000', amountOut: '0', refundedAmount: '30000000', intentHashes: ['h30short'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '30', microUsd: 30_000_000 } });
    expect(await balance(api)).toBe(30_000_000);
  });

  it('keeps the amount already received when an older short-payment check arrives later', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    h.oneclick.set(addr(t), 'INCOMPLETE_DEPOSIT', { depositedAmount: '7000000' });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'short', received: { amount: '7', microUsd: null } });

    // A delayed provider observation can arrive after a newer one from another API instance.
    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'INCOMPLETE_DEPOSIT', { depositedAmount: '3000000' });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'short', received: { amount: '7', microUsd: null } });
    expect(await api.plans.topUps()).toContainEqual(expect.objectContaining({ id: t.id, received: { amount: '7', microUsd: null } }));

    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['h-stale-progress'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '10', microUsd: 10_000_000 } });
    expect(await balance(api)).toBe(10_000_000);
  });

  it('adds what was asked when the rest of a short payment is sent to the same address', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 45_000_000);
    h.oneclick.set(addr(t), 'INCOMPLETE_DEPOSIT', { depositedAmount: '30000000' });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'short', address: t.address });

    // 1Click adds the second payment to the first and swaps the total.
    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '45000000', amountOut: '44995500', intentHashes: ['h45rest'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '45', microUsd: 45_000_000 } });
    expect(await balance(api)).toBe(45_000_000);
  });

  it('adds what was refunded to the treasury, however small, and a swapped part of a payment with the rest', async () => {
    const { api } = await account();
    const big = await api.plans.startTopUp(TRON_USDT, 45_000_000);
    h.oneclick.set(addr(big), 'REFUNDED', { depositedAmount: '46000000', amountOut: '0', refundedAmount: '46000000', intentHashes: ['h46'] });
    expect(await api.plans.topUp(big.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '46', microUsd: 46_000_000 } });
    expect(await balance(api)).toBe(46_000_000);

    const small = await api.plans.startTopUp(TRON_USDT, 10_000_000);
    h.oneclick.set(addr(small), 'REFUNDED', { depositedAmount: '400000', amountOut: '0', refundedAmount: '400000', intentHashes: ['h04'] });
    expect(await api.plans.topUp(small.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '0.4', microUsd: 400_000 } });
    expect(await balance(api)).toBe(46_000_000 + 400_000);

    // Half a thousandth of a dollar is still added.
    const dust = await api.plans.startTopUp(TRON_USDT, 10_000_000);
    h.oneclick.set(addr(dust), 'REFUNDED', { depositedAmount: '500', amountOut: '0', refundedAmount: '500', intentHashes: ['h0005'] });
    expect(await api.plans.topUp(dust.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '0.0005', microUsd: 500 } });
    expect(await balance(api)).toBe(46_000_000 + 400_000 + 500);

    // 80 sent, 60 swapped and 20 refunded: the whole 80 reached the treasury, and it was all that was asked.
    const part = await api.plans.startTopUp(TRON_USDT, 80_000_000);
    h.oneclick.set(addr(part), 'REFUNDED', { depositedAmount: '80000000', amountOut: '59990000', refundedAmount: '20000000', intentHashes: ['h80'] });
    expect(await api.plans.topUp(part.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '80', microUsd: 80_000_000 } });
    expect(await balance(api)).toBe(46_000_000 + 400_000 + 500 + 80_000_000);

    // With more asked than that, and 80 under the band, the part swapped and refunded adds what was sent.
    const under = await api.plans.startTopUp(TRON_USDT, 100_000_000);
    h.oneclick.set(addr(under), 'REFUNDED', { depositedAmount: '80000000', amountOut: '59990000', refundedAmount: '20000000', intentHashes: ['h80under'] });
    expect(await api.plans.topUp(under.id)).toMatchObject({ state: 'credited', received: { amount: '80', microUsd: 80_000_000 } });
    expect(await balance(api)).toBe(46_000_000 + 400_000 + 500 + 80_000_000 + 80_000_000);
  });

  it('marks a failed swap and logs only its ID', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const from = h.logs.length;
    h.oneclick.set(addr(t), 'FAILED');
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'failed', address: null, received: null });
    const lines = logsSince(from);
    expect(lines.some((l) => l.level === 50 && l.line.includes(t.id))).toBe(true);
    expect(lines.filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
    expect(await balance(api)).toBe(0);
  });

  it('keeps a deposit open on a status it doesn’t know', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const from = h.logs.length;
    h.oneclick.set(addr(t), 'SOMETHING_NEW');
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'waiting', address: addr(t) });
    expect(logsSince(from).some((l) => l.level === 40 && l.line.includes('SOMETHING_NEW'))).toBe(true);

    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['h10'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '10', microUsd: 10_000_000 } });
    expect(await balance(api)).toBe(10_000_000);
  });

  it('treats a finished swap that doesn’t say what came out as arriving, hides the address, and logs it at error once', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 25_000_000);
    const from = h.logs.length;
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '25000000', amountOut: null, intentHashes: ['h25'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'arriving', address: null, memo: null });
    // Asked again (by the app and the watcher), it says the same: still one error line, so the signal isn't buried.
    await forgetCheck(t.id);
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'arriving' });
    await dueOnly(t.id);
    await watch(h.deps);
    const errors = logsSince(from).filter((l) => l.level >= 40 && l.line.includes(t.id));
    expect(errors.length).toBe(1);
    expect(errors[0]?.level).toBe(50);
    expect(errors[0]?.line).toContain('unreadable-finished-swap');
    expect(logsSince(from).filter((l) => l.line.includes('25000000'))).toEqual([]);
    expect(await balance(api)).toBe(0);

    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'SUCCESS', { amountOut: '25000000' });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '25', microUsd: 25_000_000 } });
    expect(await balance(api)).toBe(25_000_000);
  });

  it('the watcher adds a settled deposit without anyone opening it', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 25_000_000);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '25000000', amountOut: '25000000', intentHashes: ['hw25'] });
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await balance(api)).toBe(25_000_000);
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '25', microUsd: 25_000_000 } });
    await dueOnly();
    expect(await watch(h.deps)).toEqual({ checked: 0, credited: 0 });
  });

  it('checks a young deposit again in 10 seconds and an old one less often', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    about(await nextCheckIn(t.id), 10);

    await h.pool.query("UPDATE deposits SET created_at = now() - interval '30 minutes', check_after = now() WHERE deposit_id = $1", [t.id]);
    await watch(h.deps);
    about(await nextCheckIn(t.id), 60);

    await h.pool.query("UPDATE deposits SET created_at = now() - interval '3 hours', check_after = now() WHERE deposit_id = $1", [t.id]);
    await watch(h.deps);
    about(await nextCheckIn(t.id), 300);

    await h.pool.query("UPDATE deposits SET created_at = now() - interval '2 days', check_after = now() WHERE deposit_id = $1", [t.id]);
    await watch(h.deps);
    about(await nextCheckIn(t.id), 3600);
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'waiting', address: addr(t) });
  });

  it('thins out checks on the long tail, and checks open top-ups before it', async () => {
    const { api } = await account();
    const tail = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await h.pool.query("UPDATE deposits SET state = 'expired', give_up_at = now() - interval '2 hours' WHERE deposit_id = $1", [tail.id]);
    await dueOnly(tail.id);
    await watch(h.deps);
    about(await nextCheckIn(tail.id), 3600);
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '3 days', check_after = now() WHERE deposit_id = $1", [tail.id]);
    await watch(h.deps);
    about(await nextCheckIn(tail.id), 6 * 3600);
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '10 days', check_after = now() WHERE deposit_id = $1", [tail.id]);
    await watch(h.deps);
    about(await nextCheckIn(tail.id), 86_400);

    // 25 long-tail deposits fell due before a fresh one: the fresh one is still checked in the first pass of 20.
    const backlog = await Promise.all(Array.from({ length: 25 }, async () => (await account()).api.plans.startTopUp(BASE_USDC, 10_000_000)));
    const ids = backlog.map((b) => b.id);
    await h.pool.query("UPDATE deposits SET state = 'expired', give_up_at = now() - interval '2 hours' WHERE deposit_id = ANY($1)", [ids]);
    const fresh = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await dueOnly(...ids, fresh.id);
    await h.pool.query("UPDATE deposits SET check_after = now() - interval '1 hour' WHERE deposit_id = ANY($1)", [ids]);
    await watch(h.deps);
    about(await nextCheckIn(fresh.id), 10);
  });

  it('asks 1Click once more at the deadline: adds a late payment, expires an empty one, fails a stuck or unknown one', async () => {
    const { api } = await account();
    const quiet = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const stuck = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const late = await api.plans.startTopUp(BASE_USDC, 12_000_000);
    const sealed = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const odd = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    h.oneclick.set(addr(stuck), 'PROCESSING');
    expect(await api.plans.topUp(stuck.id)).toMatchObject({ state: 'arriving', address: null });
    h.oneclick.set(addr(late), 'SUCCESS', { depositedAmount: '12000000', amountOut: '12000000', intentHashes: ['hw12'] });
    // A status nobody knows, still stored as waiting: something may have arrived, so it isn't called expired.
    h.oneclick.set(addr(odd), 'SOMETHING_NEW');
    // A record that no longer opens can't be asked about: it fails rather than being retried for ever.
    await h.pool.query("UPDATE deposits SET record_ciphertext = '\\x00' WHERE deposit_id = $1", [sealed.id]);
    const from = h.logs.length;
    const ids = [quiet.id, stuck.id, late.id, sealed.id, odd.id];
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = ANY($1)", [ids]);
    await dueOnly(...ids);
    expect(await watch(h.deps)).toEqual({ checked: 5, credited: 1 });
    expect(await api.plans.topUp(quiet.id)).toMatchObject({ state: 'expired', address: null, received: null });
    expect(await api.plans.topUp(stuck.id)).toMatchObject({ state: 'failed', address: null, received: null });
    expect(await api.plans.topUp(late.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '12', microUsd: 12_000_000 } });
    expect(await api.plans.topUp(odd.id)).toMatchObject({ state: 'failed', address: null });
    expect(await stateOf(sealed.id)).toBe('failed');
    const lines = logsSince(from);
    for (const id of [stuck.id, sealed.id, odd.id]) expect(lines.some((l) => l.level === 50 && l.line.includes(id))).toBe(true);
    expect(lines.some((l) => l.level === 50 && l.line.includes(quiet.id))).toBe(false);
    expect(lines.filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
    expect(await balance(api)).toBe(12_000_000);
  });

  it('keeps checking when 1Click is down', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 15_000_000);
    await dueOnly(t.id);
    const from = h.logs.length;
    h.oneclick.down(true);
    try {
      expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    } finally {
      h.oneclick.down(false);
    }
    expect(logsSince(from).some((l) => l.level === 40 && l.line.includes(t.id))).toBe(true);
    about(await nextCheckIn(t.id), 60);
    expect(await stateOf(t.id)).toBe('waiting');

    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '15000000', amountOut: '15000000', intentHashes: ['hw15'] });
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await balance(api)).toBe(15_000_000);
  });

  it('never shows the address again once a payment was seen', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const address = addr(t);
    h.oneclick.set(address, 'PROCESSING');
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'arriving', address: null });
    await forgetCheck(t.id);
    h.oneclick.set(address, 'PENDING_DEPOSIT');
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'arriving', address: null });
    await dueOnly(t.id);
    await watch(h.deps);
    expect(await stateOf(t.id)).toBe('arriving');
  });

  it('fails, never expires, a deposit 1Click says is arriving or short at the deadline', async () => {
    const { api } = await account();
    const short = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const arriving = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    // Nobody opened them since: each is still stored as waiting when the last check finds money on its way.
    h.oneclick.set(addr(short), 'INCOMPLETE_DEPOSIT');
    h.oneclick.set(addr(arriving), 'PROCESSING');
    const ids = [short.id, arriving.id];
    expect([await stateOf(short.id), await stateOf(arriving.id)]).toEqual(['waiting', 'waiting']);
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = ANY($1)", [ids]);
    await dueOnly(...ids);
    const from = h.logs.length;
    expect(await watch(h.deps)).toEqual({ checked: 2, credited: 0 });
    expect(await api.plans.topUp(short.id)).toMatchObject({ state: 'failed', address: null });
    expect(await api.plans.topUp(arriving.id)).toMatchObject({ state: 'failed', address: null });
    const lines = logsSince(from);
    for (const id of ids) expect(lines.some((l) => l.level === 50 && l.line.includes(id))).toBe(true);
    expect(lines.filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
    expect(lines.filter((l) => l.level >= 30 && /expired/.test(l.msg))).toEqual([]);
  });

  it('keeps a top-up open past the deadline while 1Click can’t answer, checked on the thinning tail and logged at error once', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    // The deadline passed days ago, as after the API was down for a while: the tail asks every 6 hours by now.
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '3 days' WHERE deposit_id = $1", [t.id]);
    await dueOnly(t.id);
    const from = h.logs.length;
    h.oneclick.down(true);
    try {
      for (let i = 0; i < 2; i++) {
        await dueOnly(t.id);
        expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
        // Nobody knows whether money came, so it stays open.
        expect(await stateOf(t.id)).toBe('waiting');
        about(await nextCheckIn(t.id), 6 * 3600);
      }
      expect(logsSince(from).filter((l) => l.level === 50 && l.line.includes(t.id)).length).toBe(1);
    } finally {
      h.oneclick.down(false);
    }
    // 1Click answers again, and says nothing arrived: only now has it expired.
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    expect(await stateOf(t.id)).toBe('expired');
    expect(logsSince(from).filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
  });

  it('keeps a top-up open, never expired, when 1Click can’t answer after the deadline, and adds it when 1Click says it was paid', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = $1", [t.id]);
    h.oneclick.down(true);
    try {
      for (let i = 0; i < 3; i++) {
        await dueOnly(t.id);
        await watch(h.deps);
      }
    } finally {
      h.oneclick.down(false);
    }
    expect(await stateOf(t.id)).toBe('waiting');
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '10000000', amountOut: '9999000', intentHashes: ['hdown10'] });
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await balance(api)).toBe(10_000_000);
  });

  it('opens at most 15 top-ups waiting for a payment, and 10 a minute', async () => {
    const { api, second, opened, close } = await fifteen();
    try {
      const quotes = h.oneclick.quotes.length;
      const e = await second.plans.startTopUp(BASE_USDC, 10_000_000).catch((x: unknown) => x);
      expect(code(e)).toBe('conflict');
      expect(e instanceof AlcoveApiError ? e.message : '').toBe('You already have 15 top-ups waiting for a payment. Use or cancel one of those, or wait for them to expire.');
      expect(h.oneclick.quotes.length).toBe(quotes);
      // One of them is on its way now, so there's room for another.
      const first = opened[0];
      if (!first) throw new Error('no top-up opened');
      h.oneclick.set(addr(first), 'PROCESSING');
      expect(await api.plans.topUp(first.id)).toMatchObject({ state: 'arriving' });
      expect((await second.plans.startTopUp(BASE_USDC, 10_000_000)).state).toBe('waiting');
      expect(await failure(second.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('conflict');
      expect(await failure(second.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('conflict');
      expect(await failure(second.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('conflict');
      // The eleventh attempt in a minute on that server.
      expect(await failure(second.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('unavailable');
    } finally {
      await close();
    }
  });

  it('keeps the 15 waiting limit when two API instances race for the last slot', async () => {
    const email = unique();
    const { api, session } = await account(email);
    const server = await h.secondServer();
    try {
      const second: AlcoveApi = createHttpApi({ baseUrl: server.baseUrl, fetch: cookieFetch(ORIGIN) });
      const other = await second.auth.signIn('sso', { email });
      expect(other.session.ownerId).toBe(session.ownerId);
      for (let i = 0; i < 7; i++) {
        await api.plans.startTopUp(BASE_USDC, 10_000_000);
        await second.plans.startTopUp(BASE_USDC, 10_000_000);
      }
      expect(await depositRows(session.ownerId)).toBe(14);

      expect((await raceTopUpStarts(session.ownerId, api, second)).sort()).toEqual(['conflict', 'succeeded']);
      expect(await depositRows(session.ownerId)).toBe(15);
      const topUps = await api.plans.topUps();
      expect(topUps).toHaveLength(15);
      expect(topUps.every((t) => t.state === 'waiting')).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('doesn’t count top-ups whose address has expired against the 15 waiting', async () => {
    const { second, opened, close } = await fifteen();
    try {
      // Their addresses expired an hour ago; they're still watched, for a day, for a late payment.
      await h.pool.query("UPDATE deposits SET give_up_at = now() + interval '23 hours' WHERE deposit_id = ANY($1)", [opened.map((t) => t.id)]);
      expect((await second.plans.startTopUp(BASE_USDC, 10_000_000)).state).toBe('waiting');
      expect(new Set(await Promise.all(opened.map((t) => stateOf(t.id))))).toEqual(new Set(['waiting']));
    } finally {
      await close();
    }
  });

  it('cancels a waiting top-up: no address, not counted toward the 15 waiting, among the finished ones', async () => {
    const { api, second, opened, close } = await fifteen();
    try {
      expect(await failure(second.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('conflict');
      const first = opened[0];
      if (!first) throw new Error('no top-up opened');
      const from = h.logs.length;
      const cancelled = await api.plans.cancelTopUp(first.id);
      expect(cancelled).toMatchObject({ id: first.id, state: 'cancelled', address: null, memo: null, received: null });
      expect(await api.plans.topUp(first.id)).toEqual(cancelled);
      expect(logsSince(from).some((l) => l.msg === 'top-up cancelled' && l.line.includes(first.id))).toBe(true);
      expect(logsSince(from).filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
      const another = await second.plans.startTopUp(BASE_USDC, 10_000_000);
      expect(another.state).toBe('waiting');
      // The open part lists the 15 waiting ones; the cancelled one comes after them, among the finished.
      const list = await api.plans.topUps();
      expect(list.length).toBe(16);
      expect(new Set(list.slice(0, 15).map((t) => t.id))).toEqual(new Set([another.id, ...opened.slice(1).map((t) => t.id)]));
      expect(list.at(-1)).toEqual(cancelled);
    } finally {
      await close();
    }
  });

  it('cancels only a top-up nothing has reached, and only the owner’s', async () => {
    const { api } = await account();
    const short = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const arriving = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const credited = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    h.oneclick.set(addr(short), 'INCOMPLETE_DEPOSIT', { depositedAmount: '3000000' });
    h.oneclick.set(addr(arriving), 'PROCESSING');
    h.oneclick.set(addr(credited), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['hc10'] });
    expect((await api.plans.topUp(short.id)).state).toBe('short');
    expect((await api.plans.topUp(arriving.id)).state).toBe('arriving');
    expect((await api.plans.topUp(credited.id)).state).toBe('credited');
    const e = await api.plans.cancelTopUp(short.id).catch((x: unknown) => x);
    expect(code(e)).toBe('conflict');
    expect(e instanceof AlcoveApiError ? e.message : '').toBe('This top-up can’t be cancelled any more: a payment has already reached it.');
    expect(await failure(api.plans.cancelTopUp(arriving.id))).toBe('conflict');
    expect(await failure(api.plans.cancelTopUp(credited.id))).toBe('conflict');
    expect([await stateOf(short.id), await stateOf(arriving.id), await stateOf(credited.id)]).toEqual(['short', 'arriving', 'credited']);

    const waiting = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    expect((await api.plans.cancelTopUp(waiting.id)).state).toBe('cancelled');
    expect(await failure(api.plans.cancelTopUp(waiting.id))).toBe('conflict');

    const other = await account();
    const theirs = await other.api.plans.startTopUp(BASE_USDC, 10_000_000);
    expect(await failure(api.plans.cancelTopUp(theirs.id))).toBe('not-found');
    expect(await failure(api.plans.cancelTopUp('not-a-top-up'))).toBe('not-found');
    expect(await stateOf(theirs.id)).toBe('waiting');
    expect(await balance(api)).toBe(10_000_000);
  });

  it('adds a payment that reaches a cancelled top-up anyway, and a stale answer leaves it cancelled', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 20_000_000);
    const address = addr(t);
    await api.plans.cancelTopUp(t.id);

    // 1Click still says it's waiting: it stays cancelled, without its address, by the watcher and the app.
    h.oneclick.set(address, 'PENDING_DEPOSIT');
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    expect(await stateOf(t.id)).toBe('cancelled');
    await forgetCheck(t.id);
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'cancelled', address: null });

    // Sent from an exchange before it was cancelled: it moves on and is added.
    h.oneclick.set(address, 'PROCESSING');
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    expect(await stateOf(t.id)).toBe('arriving');
    h.oneclick.set(address, 'SUCCESS', { depositedAmount: '20000000', amountOut: '20000000', intentHashes: ['hcx20'] });
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '20', microUsd: 20_000_000 } });
    expect(await balance(api)).toBe(20_000_000);

    // Straight from cancelled to settled, as the app sees it.
    const direct = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await api.plans.cancelTopUp(direct.id);
    h.oneclick.set(addr(direct), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['hcd10'] });
    await forgetCheck(direct.id);
    expect(await api.plans.topUp(direct.id)).toMatchObject({ state: 'credited', received: { amount: '10', microUsd: 10_000_000 } });
    expect(await balance(api)).toBe(20_000_000 + 10_000_000);
  });

  it('keeps a cancelled top-up nothing reached cancelled at the deadline, then checks it hourly for 30 days; fails one 1Click says is arriving then', async () => {
    const { api } = await account();
    const quiet = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const stuck = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await api.plans.cancelTopUp(quiet.id);
    await api.plans.cancelTopUp(stuck.id);
    h.oneclick.set(addr(stuck), 'PROCESSING');
    const ids = [quiet.id, stuck.id];
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = ANY($1)", [ids]);
    await dueOnly(...ids);
    const from = h.logs.length;
    expect(await watch(h.deps)).toEqual({ checked: 2, credited: 0 });
    expect(await api.plans.topUp(quiet.id)).toMatchObject({ state: 'cancelled', address: null });
    expect(await api.plans.topUp(stuck.id)).toMatchObject({ state: 'failed', address: null });
    const lines = logsSince(from);
    expect(lines.some((l) => l.level === 30 && l.line.includes(quiet.id))).toBe(true);
    expect(lines.some((l) => l.level >= 50 && l.line.includes(quiet.id))).toBe(false);
    expect(lines.some((l) => l.level === 50 && l.line.includes(stuck.id))).toBe(true);
    // Its address still takes a payment 1Click may settle late: asked about hourly, quietly.
    about(await nextCheckIn(quiet.id), 3600);
    about(await nextCheckIn(stuck.id), 3600);
    await dueOnly(quiet.id);
    const again = h.logs.length;
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    expect(await stateOf(quiet.id)).toBe('cancelled');
    expect(logsSince(again).filter((l) => l.level >= 30 && l.line.includes(quiet.id))).toEqual([]);
    // 30 days after its address expired, it isn't asked about again.
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '29 days 1 second' WHERE deposit_id = ANY($1)", [ids]);
    await dueOnly(...ids);
    expect(await watch(h.deps)).toEqual({ checked: 2, credited: 0 });
    expect(await nextCheckIn(quiet.id)).toBe(Infinity);
    expect(await nextCheckIn(stuck.id)).toBe(Infinity);
    await notDue();
    expect(await watch(h.deps)).toEqual({ checked: 0, credited: 0 });
    expect([await stateOf(quiet.id), await stateOf(stuck.id)]).toEqual(['cancelled', 'failed']);
  });

  it('watches a cancelled top-up again when a payment shows up after its deadline, and adds it without the app open', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const address = addr(t);
    await api.plans.cancelTopUp(t.id);
    // At the deadline 1Click hadn't seen the payment yet: it stays cancelled, checked hourly.
    h.oneclick.set(address, 'PENDING_DEPOSIT');
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = $1", [t.id]);
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    about(await nextCheckIn(t.id), 3600);

    // Opened later, 1Click now sees it arriving: it's due for the watcher again.
    h.oneclick.set(address, 'PROCESSING');
    await forgetCheck(t.id);
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'arriving', address: null });
    about(await nextCheckIn(t.id), 0);

    // The app is closed; the watcher alone adds it once it settles.
    h.oneclick.set(address, 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['hlate10'] });
    await notDue(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await stateOf(t.id)).toBe('credited');
    expect(await balance(api)).toBe(10_000_000);
  });

  it('moves a cancelled top-up on to short, showing the address again, or failed', async () => {
    const { api } = await account();
    const short = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const failed = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await api.plans.cancelTopUp(short.id);
    await api.plans.cancelTopUp(failed.id);
    h.oneclick.set(addr(short), 'INCOMPLETE_DEPOSIT', { depositedAmount: '3000000' });
    h.oneclick.set(addr(failed), 'FAILED');
    await forgetCheck(short.id);
    await forgetCheck(failed.id);
    expect(await api.plans.topUp(short.id)).toMatchObject({ state: 'short', address: short.address, received: { amount: '3', microUsd: null } });
    expect(await api.plans.topUp(failed.id)).toMatchObject({ state: 'failed', address: null });
  });

  it('adds once when the watcher and the app race', async () => {
    const email = unique();
    const one = await account(email);
    const two = await account(email);
    const t = await one.api.plans.startTopUp(BASE_USDC, 20_000_000);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '20000000', amountOut: '20000000', intentHashes: ['h20'] });
    await dueOnly(t.id);
    await Promise.all([watch(h.deps), watch(h.deps), one.api.plans.topUp(t.id), two.api.plans.topUp(t.id)]);
    expect(await two.api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { microUsd: 20_000_000 } });
    expect(await balance(one.api)).toBe(20_000_000);
  });

  it('adds nothing when less than 98.5% of what was sent reached the treasury, or more than $8,000 was sent', async () => {
    const { api } = await account();
    const from = h.logs.length;
    const cases: [string, Record<string, string>][] = [
      // 1Click says it succeeded, but nothing (or one micro-USDC) came out of the swap.
      ['SUCCESS', { depositedAmount: '80000000', amountOut: '0' }],
      ['SUCCESS', { depositedAmount: '80000000', amountOut: '1' }],
      // Refunded, but nothing was refunded to the treasury.
      ['REFUNDED', { depositedAmount: '80000000', refundedAmount: '0' }],
      // Part swapped and part refunded, adding up to well under what was sent.
      ['REFUNDED', { depositedAmount: '80000000', amountOut: '30000000', refundedAmount: '20000000' }],
      // Just under the 98.5% that must reach the treasury.
      ['SUCCESS', { depositedAmount: '80000000', amountOut: '78799999' }]
    ];
    const ids: string[] = [];
    for (const [i, [status, amounts]] of cases.entries()) {
      const t = await api.plans.startTopUp(BASE_USDC, 80_000_000);
      h.oneclick.set(addr(t), status, { ...amounts, intentHashes: [`hc1-${i}`] });
      expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'arriving', address: null, received: null });
      ids.push(t.id);
    }
    // A cent over $8,000 sent, all of it swapped: more than one top-up takes.
    const huge = await api.plans.startTopUp(BASE_USDC, MAX_TOP_UP_MICRO_USD);
    h.oneclick.set(addr(huge), 'SUCCESS', { depositedAmount: '8000010000', amountOut: '8000000000', intentHashes: ['hc1-huge'] });
    expect(await api.plans.topUp(huge.id)).toMatchObject({ state: 'arriving', received: null });
    ids.push(huge.id);
    expect(await balance(api)).toBe(0);
    const lines = logsSince(from);
    for (const id of ids) expect(lines.some((l) => l.level === 50 && l.line.includes(id))).toBe(true);
    expect(lines.filter((l) => l.line.includes('less-reached-treasury-than-sent')).length).toBe(5);
    expect(lines.some((l) => l.line.includes('more-than-a-top-up-buys'))).toBe(true);
    expect(lines.filter((l) => /80000000|8000010000/.test(l.line))).toEqual([]);
    // At the deadline each one fails and reaches support; none is added.
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = ANY($1)", [ids]);
    await dueOnly(...ids);
    expect(await watch(h.deps)).toEqual({ checked: ids.length, credited: 0 });
    expect(new Set(await Promise.all(ids.map(stateOf)))).toEqual(new Set(['failed']));
    expect(await balance(api)).toBe(0);
  });

  it('adds exactly $8,000 sent, the most one top-up takes', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, MAX_TOP_UP_MICRO_USD);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '8000000000', amountOut: '7999000000', intentHashes: ['hc1-max'] });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '8000', microUsd: MAX_TOP_UP_MICRO_USD } });
    expect(await balance(api)).toBe(MAX_TOP_UP_MICRO_USD);
  });

  it('adds a finished swap whose amounts agree with 1Click’s own rendering, or come without one', async () => {
    const { api } = await account();
    // 1Click left out how it renders what was deposited, what came out, or what was refunded: added as usual.
    const noDeposited = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    h.oneclick.set(addr(noDeposited), 'SUCCESS', { depositedAmount: '10000000', depositedAmountFormatted: null, amountOut: '10000000', intentHashes: ['hf1'] });
    const noOut = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    h.oneclick.set(addr(noOut), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', amountOutFormatted: null, intentHashes: ['hf2'] });
    const noRefunded = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    h.oneclick.set(addr(noRefunded), 'SUCCESS', { depositedAmount: '10000000', amountOut: '5000000', refundedAmount: '5000000', refundedAmountFormatted: null, intentHashes: ['hf3'] });
    for (const t of [noDeposited, noOut, noRefunded]) {
      expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '10', microUsd: 10_000_000 } });
    }
    // What came out, in other units than USDC's 6 decimals.
    const oddOut = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    h.oneclick.set(addr(oddOut), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', amountOutFormatted: '10000000', intentHashes: ['hf4'] });
    // Refunded, but saying nothing about the refund (as the stand-in does when a test sets nothing).
    const bare = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    h.oneclick.set(addr(bare), 'REFUNDED', { depositedAmount: '10000000', intentHashes: ['hf5'] });
    for (const t of [oddOut, bare]) {
      expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'arriving', address: null, received: null });
    }
    expect(await balance(api)).toBe(3 * 10_000_000);
  });

  it('doesn’t offer a route 1Click lists with other decimals than the allowlist pins', async () => {
    h.oneclick.listDecimals(BNB_USDC, 6);
    // Another server, so its list of routes isn't the one already cached.
    const second = await h.secondServer({});
    try {
      const api: AlcoveApi = createHttpApi({ baseUrl: second.baseUrl, fetch: cookieFetch(ORIGIN) });
      const { session } = await api.auth.signIn('sso', { email: unique() });
      const from = h.logs.length;
      const { routes } = await api.plans.routes();
      expect(routes.some((r) => r.id === BNB_USDC)).toBe(false);
      expect(routes.some((r) => r.id === BASE_USDC)).toBe(true);
      expect(logsSince(from).some((l) => l.level === 50 && l.line.includes(BNB_USDC))).toBe(true);
      const quotes = h.oneclick.quotes.length;
      expect(await failure(api.plans.startTopUp(BNB_USDC, 50_000_000))).toBe('invalid');
      expect(h.oneclick.quotes.length).toBe(quotes);
      expect(await depositRows(session.ownerId)).toBe(0);
    } finally {
      h.oneclick.listDecimals(BNB_USDC, null);
      await second.close();
    }
  });

  it('refuses a quote for another request, or with a deadline under an hour or over 7 days away', async () => {
    const { api, session } = await account();
    const from = h.logs.length;
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    const far = new Date(Date.now() + 8 * 24 * 3_600_000).toISOString();
    const odd = [
      { deadline: soon }, { deadline: far },
      { quoteRequest: { recipient: 'someone-else.near' } }, { quoteRequest: { refundTo: 'someone-else.near' } },
      { quoteRequest: { recipientType: 'DESTINATION_CHAIN' } }, { quoteRequest: { refundType: 'ORIGIN_CHAIN' } },
      { quoteRequest: { swapType: 'EXACT_INPUT' } }, { quoteRequest: { amount: '9000000' } }, { quoteRequest: { originAsset: ETH_USDC } }
    ];
    for (const o of odd) {
      h.oneclick.nextQuote(o);
      expect(await failure(api.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('unavailable');
    }
    expect(await depositRows(session.ownerId)).toBe(0);
    const lines = logsSince(from).filter((l) => l.level === 50);
    expect(lines.filter((l) => l.line.includes('unexpected-quote-deadline')).length).toBe(2);
    expect(lines.filter((l) => l.line.includes('unexpected-quote-request')).length).toBe(7);
  });

  it('remembers for 30 seconds that 1Click couldn’t list its tokens', async () => {
    const second = await h.secondServer({});
    try {
      const api: AlcoveApi = createHttpApi({ baseUrl: second.baseUrl, fetch: cookieFetch(ORIGIN) });
      await api.auth.signIn('sso', { email: unique() });
      h.oneclick.down(true);
      const asked = h.oneclick.apiKeys.length;
      try {
        expect(await failure(api.plans.routes())).toBe('unavailable');
      } finally {
        h.oneclick.down(false);
      }
      expect(h.oneclick.apiKeys.length).toBe(asked + 1);
      expect(await failure(api.plans.routes())).toBe('unavailable');
      expect(await failure(api.plans.startTopUp(BASE_USDC, 10_000_000))).toBe('unavailable');
      expect(h.oneclick.apiKeys.length).toBe(asked + 1);
    } finally {
      await second.close();
    }
  });

  it('adds a failed swap once 1Click refunds it to the treasury, checking it hourly', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(TRON_USDT, 10_000_000);
    h.oneclick.set(addr(t), 'FAILED', { depositedAmount: '10000000' });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'failed' });
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    about(await nextCheckIn(t.id), 3600);
    const from = h.logs.length;
    h.oneclick.set(addr(t), 'REFUNDED', { refundedAmount: '10000000', intentHashes: ['hfr10'] });
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '10', microUsd: 10_000_000 } });
    expect(logsSince(from).some((l) => l.level === 40 && l.line.includes(t.id))).toBe(true);
    expect(await balance(api)).toBe(10_000_000);
  });

  it('adds a payment 1Click settles after the top-up expired, as when the app’s check lands after the watcher gave up', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const stuck = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    const ids = [t.id, stuck.id];
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = ANY($1)", [ids]);
    await dueOnly(...ids);
    expect(await watch(h.deps)).toEqual({ checked: 2, credited: 0 });
    expect([await stateOf(t.id), await stateOf(stuck.id)]).toEqual(['expired', 'expired']);
    about(await nextCheckIn(t.id), 3600);

    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '10000000', amountOut: '9999000', intentHashes: ['hexp10'] });
    await forgetCheck(t.id);
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '10', microUsd: 10_000_000 } });
    expect(await balance(api)).toBe(10_000_000);

    // Something arrived after all, but 1Click hasn't settled it: no longer "nothing arrived", so it reaches support.
    h.oneclick.set(addr(stuck), 'PROCESSING');
    await dueOnly(stuck.id);
    const from = h.logs.length;
    await watch(h.deps);
    expect(await stateOf(stuck.id)).toBe('failed');
    expect(logsSince(from).some((l) => l.level === 50 && l.line.includes(stuck.id))).toBe(true);
  });

  it('opens at most 30 top-ups an account in 24 hours, cancelled ones included', async () => {
    const email = unique();
    const servers = await Promise.all([h.secondServer(), h.secondServer(), h.secondServer()]);
    try {
      const apis: AlcoveApi[] = [];
      for (const s of servers) {
        const api: AlcoveApi = createHttpApi({ baseUrl: s.baseUrl, fetch: cookieFetch(ORIGIN) });
        await api.auth.signIn('sso', { email });
        apis.push(api);
      }
      // Each server lets an account open 10 a minute; cancelling each keeps it under the 15 waiting.
      for (const api of apis) {
        for (let i = 0; i < 10; i++) await api.plans.cancelTopUp((await api.plans.startTopUp(BASE_USDC, 10_000_000)).id);
      }
      const { api } = await account(email);
      const quotes = h.oneclick.quotes.length;
      const e = await api.plans.startTopUp(BASE_USDC, 10_000_000).catch((x: unknown) => x);
      expect(code(e)).toBe('conflict');
      expect(e instanceof AlcoveApiError ? e.message : '').toBe('You’ve opened 30 top-ups in the last 24 hours, the most there can be. Try again later.');
      expect(h.oneclick.quotes.length).toBe(quotes);
      // A day later there's room again.
      await h.pool.query("UPDATE deposits SET created_at = now() - interval '25 hours' WHERE owner_id = (SELECT owner_id FROM deposits WHERE deposit_id = $1)", [
        (await api.plans.topUps())[0]?.id ?? ''
      ]);
      expect((await api.plans.startTopUp(BASE_USDC, 10_000_000)).state).toBe('waiting');
    } finally {
      await Promise.all(servers.map((s) => s.close()));
    }
  });

  it('keeps the 30 a day limit when two API instances race for the last slot', async () => {
    const email = unique();
    const { api, session } = await account(email);
    const servers = await Promise.all([h.secondServer(), h.secondServer(), h.secondServer()]);
    try {
      const apis: AlcoveApi[] = [];
      for (const server of servers) {
        const other: AlcoveApi = createHttpApi({ baseUrl: server.baseUrl, fetch: cookieFetch(ORIGIN) });
        const signedIn = await other.auth.signIn('sso', { email });
        expect(signedIn.session.ownerId).toBe(session.ownerId);
        apis.push(other);
      }
      // Cancel every earlier top-up, so only the daily limit can refuse the concurrent requests.
      for (const [i, other] of apis.entries()) {
        for (let j = 0; j < (i === 2 ? 9 : 10); j++) {
          await other.plans.cancelTopUp((await other.plans.startTopUp(BASE_USDC, 10_000_000)).id);
        }
      }
      expect(await depositRows(session.ownerId)).toBe(29);
      const second = apis.at(-1);
      if (!second) throw new Error('no second API instance');

      expect((await raceTopUpStarts(session.ownerId, api, second)).sort()).toEqual(['conflict', 'succeeded']);
      const counts = (await h.pool.query<{ total: number; waiting: number; cancelled: number; today: number }>(`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE state = 'waiting')::int AS waiting,
          count(*) FILTER (WHERE state = 'cancelled')::int AS cancelled,
          count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today
        FROM deposits WHERE owner_id = $1
      `, [session.ownerId])).rows[0];
      expect(counts).toEqual({ total: 30, waiting: 1, cancelled: 29, today: 30 });
    } finally {
      await Promise.all(servers.map((server) => server.close()));
    }
  });

  it('checks a cancelled top-up every 5 minutes', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await api.plans.cancelTopUp(t.id);
    about(await nextCheckIn(t.id), 300);
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    about(await nextCheckIn(t.id), 300);
  });

  it('asks 1Click once for requests at once about a top-up, and lets an account ask 60 times a minute', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 10_000_000);
    await forgetCheck(t.id);
    let asked = h.oneclick.apiKeys.length;
    await Promise.all(Array.from({ length: 8 }, () => api.plans.topUp(t.id)));
    expect(h.oneclick.apiKeys.length).toBe(asked + 1);

    // 1Click failing doesn't let every request ask again.
    await forgetCheck(t.id);
    asked = h.oneclick.apiKeys.length;
    h.oneclick.down(true);
    try {
      await Promise.all(Array.from({ length: 8 }, () => api.plans.topUp(t.id)));
      await api.plans.topUp(t.id);
    } finally {
      h.oneclick.down(false);
    }
    expect(h.oneclick.apiKeys.length).toBe(asked + 1);

    // 17 so far this minute; 43 more are fine, and the next is refused.
    for (let i = 0; i < 43; i++) await api.plans.topUp(t.id);
    expect(await failure(api.plans.topUp(t.id))).toBe('unavailable');
  });
});

const PRICE = 20_000_000;
const YEARLY = 16_000_000;
const HOURS = 15_000_000;
/** Months of Pro at the price for that many: the yearly one for a year or more. */
const pro = (months: number, microUsdPerMonth = months >= 12 ? YEARLY : PRICE): Purchase => ({ kind: 'pro', months, microUsdPerMonth });
/** Packs of 10 more hours of notes. */
const hours = (packs: number, microUsdPerPack = HOURS): Purchase => ({ kind: 'hours', packs, microUsdPerPack });
/** What a request came to: its code and message when it was refused. */
const said = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
const labels = async (api: AlcoveApi) => (await api.plans.plan()).balance.history.map((e) => e.label);

describe('top-ups that buy', () => {
  afterEach(async () => { await h.resetLimits(); });
  /** 1Click settles `microUsd` sent to the top-up, swapped in full, and the app looks at it. */
  async function paid(api: AlcoveApi, t: TopUp, microUsd: number): Promise<TopUp> {
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: String(microUsd), amountOut: String(microUsd), intentHashes: [`buys-${t.id}`] });
    await forgetCheck(t.id);
    return api.plans.topUp(t.id);
  }
  /** An account with `microUsd` already in its balance, as support adds it. */
  async function withBalance(microUsd: number) {
    const email = unique();
    const who = await account(email);
    await creditByEmail(h.deps, email, microUsd);
    return who;
  }

  it('buys what it was opened for once its payment is added: waiting until then, then bought', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 3 * PRICE, pro(3));
    expect(t).toMatchObject({ state: 'waiting', asked: { amount: '60' }, purchase: { buys: pro(3), outcome: 'waiting', why: null } });
    // On its way: nothing is bought yet.
    h.oneclick.set(addr(t), 'PROCESSING');
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'arriving', purchase: { outcome: 'waiting' } });
    expect((await api.plans.plan()).kind).toBe('free');
    const from = h.logs.length;
    const done = await paid(api, t, 3 * PRICE);
    expect(done).toMatchObject({ state: 'credited', received: { amount: '60', microUsd: 3 * PRICE }, purchase: { buys: pro(3), outcome: 'bought', why: null } });
    // Logged by the top-up's ID and what it bought, never an amount.
    expect(logsSince(from).some((l) => l.msg === 'top-up bought what it was for' && l.line.includes(t.id) && l.line.includes('"buys":"pro"'))).toBe(true);
    expect(logsSince(from).filter((l) => /60000000|"microUsd"/.test(l.line))).toEqual([]);
    const plan = await api.plans.plan();
    expect(plan).toMatchObject({ kind: 'pro', balance: { microUsd: 0 } });
    expect(plan.pro.months).toHaveLength(3);
    expect(plan.balance.history.map((e) => [e.label, e.microUsd])).toEqual([['Pro, 3 months', -3 * PRICE], ['Added, 60 USDC', 3 * PRICE]]);
    expect((await api.plans.topUps()).find((x) => x.id === t.id)).toEqual(done);
    await forgetCheck(t.id);
    expect(await api.plans.topUp(t.id)).toEqual(done);
    expect((await api.plans.plan()).pro.months).toHaveLength(3);
  });

  it('buys with the balance and the payment together, and what’s over stays in the balance', async () => {
    const { api } = await withBalance(50_000_000);
    // A year at the yearly price is $192; with $50 in the balance, the payment asks for the rest. $150 arrives.
    const t = await api.plans.startTopUp(BASE_USDC, 142_000_000, pro(12));
    expect(await paid(api, t, 150_000_000)).toMatchObject({ state: 'credited', received: { amount: '150', microUsd: 150_000_000 }, purchase: { outcome: 'bought' } });
    const plan = await api.plans.plan();
    expect(plan).toMatchObject({ kind: 'pro', balance: { microUsd: 8_000_000 } });
    expect(plan.pro.months.map((m) => m.microUsd)).toEqual(Array.from({ length: 12 }, () => YEARLY));
    expect(plan.balance.history.map((e) => e.label)).toEqual(['Pro, 12 months', 'Added, 150 USDC', 'Added by support']);
  });

  it('buys more notes for the period the payment lands in', async () => {
    const { api } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, 2 * HOURS, hours(2));
    expect(await paid(api, t, 2 * HOURS)).toMatchObject({ state: 'credited', purchase: { buys: hours(2), outcome: 'bought', why: null } });
    expect(await api.plans.plan()).toMatchObject({ kind: 'free', notes: { minutesLeft: 1500, minutesPerPeriod: 1500 }, balance: { microUsd: 0 } });
    expect(await labels(api)).toEqual(['20 more hours of notes', 'Added, 30 USDC']);
  });

  it('refuses to open a payment for what isn’t on offer at the price shown, before anything is quoted', async () => {
    const { api, session } = await account();
    const quotes = h.oneclick.quotes.length;
    const changed = 'conflict: The price of Pro has changed. Look at it again before buying.';
    expect(await said(api.plans.startTopUp(BASE_USDC, 75_000_000, pro(3, 25_000_000)))).toBe(changed);
    // A year is at the yearly price, and fewer months at a month's.
    expect(await said(api.plans.startTopUp(BASE_USDC, 12 * PRICE, pro(12, PRICE)))).toBe(changed);
    expect(await said(api.plans.startTopUp(BASE_USDC, 6 * YEARLY, pro(6, YEARLY)))).toBe(changed);
    expect(await said(api.plans.startTopUp(BASE_USDC, 13 * PRICE, pro(13, PRICE)))).toBe('invalid: Buy 1 to 12 months at a time.');
    expect(await said(api.plans.startTopUp(BASE_USDC, 6 * HOURS, hours(6)))).toBe('invalid: Buy up to 50 hours of notes at a time.');
    expect(await said(api.plans.startTopUp(BASE_USDC, HOURS, hours(1, 10_000_000)))).toBe('conflict: The price of more notes has changed. Look at it again before buying.');
    await h.setLimit('plan.hours.price_micro_usd', 0);
    expect(await said(api.plans.startTopUp(BASE_USDC, HOURS, hours(1, 0)))).toBe('conflict: More notes can’t be bought right now.');
    expect(h.oneclick.quotes.length).toBe(quotes);
    expect(await depositRows(session.ownerId)).toBe(0);
  });

  it('says why it didn’t buy when what it was for changed while the payment was on its way, and leaves the money in the balance', async () => {
    // The price of Pro changed.
    const ann = await account();
    const priced = await ann.api.plans.startTopUp(BASE_USDC, PRICE, pro(1));
    await h.setLimit('plan.pro.price_micro_usd', 25_000_000);
    const from = h.logs.length;
    expect(await paid(ann.api, priced, PRICE)).toMatchObject({
      state: 'credited', received: { microUsd: PRICE },
      purchase: { buys: pro(1), outcome: 'refused', why: 'The price of Pro changed before your payment arrived. It’s in your balance.' }
    });
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', balance: { microUsd: PRICE } });
    expect(await labels(ann.api)).toEqual(['Added, 20 USDC']);
    expect(logsSince(from).some((l) => l.line.includes(priced.id) && l.line.includes('"why":"price"'))).toBe(true);
    await h.resetLimits();
    // One purchase buys fewer months now.
    const bob = await account();
    const many = await bob.api.plans.startTopUp(BASE_USDC, 3 * PRICE, pro(3));
    await h.setLimit('plan.pro_max_months', 2);
    expect((await paid(bob.api, many, 3 * PRICE)).purchase).toEqual({ buys: pro(3), outcome: 'refused', why: 'Since your payment was made, one purchase buys at most 2 months of Pro. It’s in your balance.' });
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'free', balance: { microUsd: 3 * PRICE } });
    await h.resetLimits();
    // More notes aren't offered any more.
    const cy = await account();
    const notes = await cy.api.plans.startTopUp(BASE_USDC, HOURS, hours(1));
    await h.setLimit('plan.hours.price_micro_usd', 0);
    expect((await paid(cy.api, notes, HOURS)).purchase).toEqual({ buys: hours(1), outcome: 'refused', why: 'More notes stopped being offered before your payment arrived. It’s in your balance.' });
    expect(await cy.api.plans.plan()).toMatchObject({ balance: { microUsd: HOURS }, notes: { minutesPerPeriod: 300 } });
  });

  it('says why it didn’t buy when less arrived than it costs, or the balance it counted on was spent, and keeps what arrived', async () => {
    // $40 of the $60 asked arrives: under 1Click's band, so $40 is added, and three months aren't bought.
    const ann = await account();
    const short = await ann.api.plans.startTopUp(BASE_USDC, 3 * PRICE, pro(3));
    h.oneclick.set(addr(short), 'SUCCESS', { depositedAmount: '40000000', amountOut: '39990000', intentHashes: [`short-${short.id}`] });
    expect(await ann.api.plans.topUp(short.id)).toMatchObject({
      state: 'credited', received: { amount: '40', microUsd: 40_000_000 },
      purchase: { buys: pro(3), outcome: 'refused', why: 'Less arrived than 3 months of Pro cost. It’s in your balance.' }
    });
    expect(await ann.api.plans.plan()).toMatchObject({ kind: 'free', balance: { microUsd: 40_000_000 } });
    // All of it arrives, but the $15 in the balance it was counting on went on more notes meanwhile.
    const bob = await withBalance(HOURS);
    const rest = await bob.api.plans.startTopUp(BASE_USDC, 5_000_000, pro(1));
    await bob.api.plans.buyHours(1, HOURS);
    expect((await paid(bob.api, rest, 5_000_000)).purchase).toEqual({
      buys: pro(1), outcome: 'refused', why: 'Your balance was short of what 1 month of Pro costs when your payment arrived. It’s in your balance.'
    });
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'free', balance: { microUsd: 5_000_000 }, notes: { minutesPerPeriod: 900 } });
  });

  it('buys once, however many checks race on it', async () => {
    const email = unique();
    const one = await account(email);
    const two = await account(email);
    // Money for more, so a second purchase would go through if one were made.
    await creditByEmail(h.deps, email, 5 * PRICE);
    const t = await one.api.plans.startTopUp(BASE_USDC, PRICE, pro(1));
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: String(PRICE), amountOut: String(PRICE), intentHashes: [`race-${t.id}`] });
    await dueOnly(t.id);
    await Promise.all([watch(h.deps), watch(h.deps), one.api.plans.topUp(t.id), two.api.plans.topUp(t.id)]);
    expect(await two.api.plans.topUp(t.id)).toMatchObject({ state: 'credited', purchase: { outcome: 'bought' } });
    const plan = await one.api.plans.plan();
    expect(plan).toMatchObject({ kind: 'pro', balance: { microUsd: 5 * PRICE } });
    expect(plan.pro.months).toHaveLength(1);
    expect(await labels(one.api)).toEqual(['Pro, 1 month', 'Added, 20 USDC', 'Added by support']);
  });

  it('still buys what it was for, once, when its payment settles after it was cancelled or expired', async () => {
    const { api } = await account();
    const cancelled = await api.plans.startTopUp(BASE_USDC, PRICE, pro(1));
    expect(await api.plans.cancelTopUp(cancelled.id)).toMatchObject({ state: 'cancelled', purchase: { outcome: 'waiting' } });
    // Sent before it was cancelled, and settled with the app closed.
    h.oneclick.set(addr(cancelled), 'SUCCESS', { depositedAmount: String(PRICE), amountOut: String(PRICE), intentHashes: [`late-${cancelled.id}`] });
    await dueOnly(cancelled.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await api.plans.topUp(cancelled.id)).toMatchObject({ state: 'credited', purchase: { outcome: 'bought' } });
    expect((await api.plans.plan()).kind).toBe('pro');
    // Nothing arrived by its deadline, then 1Click settles a payment after all.
    const expired = await api.plans.startTopUp(BASE_USDC, HOURS, hours(1));
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = $1", [expired.id]);
    await dueOnly(expired.id);
    await watch(h.deps);
    expect(await api.plans.topUp(expired.id)).toMatchObject({ state: 'expired', purchase: { outcome: 'waiting' } });
    expect(await paid(api, expired, HOURS)).toMatchObject({ state: 'credited', purchase: { outcome: 'bought' } });
    expect(await api.plans.plan()).toMatchObject({ kind: 'pro', notes: { minutesPerPeriod: 3600 }, balance: { microUsd: 0 } });
    expect(await labels(api)).toEqual(['10 more hours of notes', 'Added, 15 USDC', 'Pro, 1 month', 'Added, 20 USDC']);
  });

  it('reads a top-up the previous release stored, with no purchase, as one that only adds money', async () => {
    const { api, session } = await account();
    const t = await api.plans.startTopUp(BASE_USDC, PRICE);
    expect(t.purchase).toBeNull();
    // As the previous release wrote it: nothing in the record about a purchase.
    const key = serviceKey(unb64u(h.deps.cfg.KSERVICE, 32), 'accounting');
    const header = { v: 1 as const, kind: 'deposit', ownerId: session.ownerId, depositId: t.id, keyVersion: '1' };
    const row = z.object({ record_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT record_ciphertext FROM deposits WHERE deposit_id = $1', [t.id])).rows[0]);
    const { purchase: _purchase, ...older } = openJson(key, header, row.record_ciphertext, DepositRecord);
    await h.pool.query('UPDATE deposits SET record_ciphertext = $2 WHERE deposit_id = $1', [t.id, sealJson(key, header, toJson(older))]);
    expect(await api.plans.topUp(t.id)).toMatchObject({ state: 'waiting', purchase: null });
    expect(await paid(api, t, PRICE)).toMatchObject({ state: 'credited', received: { microUsd: PRICE }, purchase: null });
    expect(await api.plans.plan()).toMatchObject({ kind: 'free', balance: { microUsd: PRICE } });
  });
});
