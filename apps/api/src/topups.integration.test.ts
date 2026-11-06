/**
 * Adding credits by sending stablecoins, end to end: the real API over HTTP via @alcove/api-http, real Postgres,
 * and a stand-in NEAR Intents 1Click (testing/fake-oneclick.ts) that quotes deposit addresses and reports on them.
 */
import { AlcoveApiError, type AlcoveApi, type TopUp } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { watch } from './modules/deposits';
import { NOT_ALLOWLISTED } from './testing/fake-oneclick';
import { ORIGIN, cookieFetch, startHarness, type Harness } from './testing/harness';

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
/** Makes only these top-ups due for the watcher; every other open one waits an hour, so a pass sees just these. */
const dueOnly = (...ids: string[]) => h.pool.query(
  "UPDATE deposits SET check_after = CASE WHEN deposit_id = ANY($1) THEN now() ELSE now() + interval '1 hour' END WHERE state IN ('waiting','arriving','short','cancelled')", [ids]);
/** Seconds until the watcher looks at this top-up again. */
const nextCheckIn = async (id: string) =>
  Number((await h.pool.query<{ s: string }>('SELECT extract(epoch FROM check_after - now())::text AS s FROM deposits WHERE deposit_id = $1', [id])).rows[0]?.s);
/** Within 3 seconds of `want`: a pass, a query and a busy test machine all take time. */
const about = (got: number, want: number) => { expect(got).toBeGreaterThanOrEqual(want - 3); expect(got).toBeLessThanOrEqual(want + 3); };
/** Seconds until the watcher gives up on this top-up. */
const giveUpIn = async (id: string) =>
  Number((await h.pool.query<{ s: string }>('SELECT extract(epoch FROM give_up_at - now())::text AS s FROM deposits WHERE deposit_id = $1', [id])).rows[0]?.s);
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
  for (let i = 0; i < 10; i++) opened.push(await api.credits.startTopUp(BASE_USDC, 10_000));
  for (let i = 0; i < 5; i++) opened.push(await second.credits.startTopUp(BASE_USDC, 10_000));
  return { api, second, opened, close: () => server.close() };
}
const depositRows = async (ownerId: string) => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM deposits WHERE owner_id = $1', [ownerId])).rows[0]?.n;

describe('top-ups', () => {
  it('lists the allowlisted routes with their minimum in credits, the tiers and the presets', async () => {
    const { api } = await account();
    const { routes, tiers, presets, perMinute } = await api.credits.routes();
    expect(routes.map((r) => `${r.token} ${r.chain}`)).toContain('USDC base');
    expect(routes.some((r) => r.id === NOT_ALLOWLISTED)).toBe(false);
    expect(routes.find((r) => r.chain === 'eth' && r.token === 'USDC')).toMatchObject({ minimum: '20', minimumCredits: 20_000 });
    expect(routes.find((r) => r.chain === 'base')).toMatchObject({ minimum: '5', minimumCredits: 5_000 });
    expect(routes.find((r) => r.chain === 'bsc' && r.token === 'USDC')).toMatchObject({ chainName: 'BNB Chain', minimum: '5', minimumCredits: 5_000 });
    expect(tiers.map((t) => t.fromCredits)).toEqual([0, 50_000, 100_000]);
    expect(tiers.map((t) => Math.round(t.creditsPerUsd * 1000) / 1000)).toEqual([1000, 1111.111, 1250]);
    expect(presets).toEqual([10_000, 50_000, 100_000]);
    expect(perMinute).toBe(25);
  });

  it('opens a top-up for an amount of credits: a quote paying the treasury for exactly their price', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 10_000);
    expect(t).toMatchObject({ state: 'waiting', received: null, asked: { amount: '10', credits: 10_000 }, route: { token: 'USDC', chain: 'base', minimum: '5' } });
    expect(t.address).toContain('canary-deposit-address');
    const TREASURY = h.oneclick.settings.TREASURY_INTENTS_ACCOUNT;
    expect(h.oneclick.quotes.at(-1)).toMatchObject({
      swapType: 'FLEX_INPUT', depositType: 'ORIGIN_CHAIN', originAsset: BASE_USDC,
      destinationAsset: NEAR_USDC, recipient: TREASURY, recipientType: 'INTENTS', refundTo: TREASURY, refundType: 'INTENTS',
      amount: '10000000', slippageTolerance: 100, dry: false
    });
    expect(h.oneclick.apiKeys.at(-1)).toBe(h.oneclick.settings.ONECLICK_API_KEY);
    expect(await api.credits.topUp(t.id)).toEqual(t);
    expect((await api.credits.topUps()).map((x) => x.id)).toEqual([t.id]);
  });

  it('prices the presets and any amount by the tier of the credits bought', async () => {
    const { api } = await account();
    const cases: [number, string, string][] = [
      [50_000, '45000000', '45'], [100_000, '80000000', '80'], [46_000, '46000000', '46'], [12_345, '12345000', '12.345'], [99_999, '89999100', '89.9991']
    ];
    for (const [credits, amount, shown] of cases) {
      const t = await api.credits.startTopUp(BASE_USDC, credits);
      expect(h.oneclick.quotes.at(-1)?.amount).toBe(amount);
      expect(t.asked).toEqual({ amount: shown, credits });
    }
    const bnb = await api.credits.startTopUp(BNB_USDC, 50_000);
    expect(h.oneclick.quotes.at(-1)?.amount).toBe('45000000000000000000');
    expect(bnb.asked).toEqual({ amount: '45', credits: 50_000 });
  });

  it('refuses fewer credits than a route’s minimum buys, or more than one top-up adds', async () => {
    const { api, session } = await account();
    const quotes = h.oneclick.quotes.length;
    const from = h.logs.length;
    const e = await api.credits.startTopUp(BASE_USDC, 4_999).catch((x: unknown) => x);
    // The refusal is logged by its reason, never with how many credits were asked for.
    expect(logsSince(from).filter((l) => l.line.includes('"credits"'))).toEqual([]);
    expect(code(e)).toBe('invalid');
    expect(e instanceof AlcoveApiError ? e.message : '').toBe('The least you can add with USDC on Base is 5,000 credits.');
    expect(await failure(api.credits.startTopUp(ETH_USDC, 19_999))).toBe('invalid');
    expect(await failure(api.credits.startTopUp(BASE_USDC, 10_000_001))).toBe('invalid');
    expect(await failure(api.credits.startTopUp(BASE_USDC, 10_000.5))).toBe('invalid');
    expect(h.oneclick.quotes.length).toBe(quotes);
    expect(await depositRows(session.ownerId)).toBe(0);
    expect((await api.credits.startTopUp(ETH_USDC, 20_000)).asked).toEqual({ amount: '20', credits: 20_000 });
  });

  it('refuses a route that isn’t offered', async () => {
    const { api, session } = await account();
    expect(await failure(api.credits.startTopUp(NOT_ALLOWLISTED, 10_000))).toBe('invalid');
    expect(await depositRows(session.ownerId)).toBe(0);
  });

  it('keeps top-ups to their owner', async () => {
    const a = await account();
    const b = await account();
    const t = await a.api.credits.startTopUp(BASE_USDC, 10_000);
    expect(await failure(b.api.credits.topUp(t.id))).toBe('not-found');
    expect(await b.api.credits.topUps()).toEqual([]);
  });

  it('quotes without a partner key, sending none', async () => {
    const second = await h.secondServer({ ONECLICK_API_KEY: '' });
    try {
      const api: AlcoveApi = createHttpApi({ baseUrl: second.baseUrl, fetch: cookieFetch(ORIGIN) });
      await api.auth.signIn('sso', { email: unique() });
      const t = await api.credits.startTopUp(BASE_USDC, 10_000);
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
      const theirs = await (await account()).api.credits.startTopUp(BASE_USDC, 10_000);
      expect(await failure(api.credits.routes())).toBe('unavailable');
      expect(await failure(api.credits.startTopUp(BASE_USDC, 10_000))).toBe('unavailable');
      expect(await failure(api.credits.topUp(theirs.id))).toBe('unavailable');
      expect(await failure(api.credits.topUps())).toBe('unavailable');
    } finally {
      await second.close();
    }

    const { api, session } = await account();
    h.oneclick.down(true);
    try {
      expect(await failure(api.credits.startTopUp(BASE_USDC, 10_000))).toBe('unavailable');
    } finally {
      h.oneclick.down(false);
    }
    expect(await depositRows(session.ownerId)).toBe(0);
  });

  it('credits exactly what was promised for the amount asked, once, and stops showing the address', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 50_000);
    // 1Click's fee comes out of what reaches the treasury; the credits go by what was sent.
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '45000000', amountOut: '44990000', refundedAmount: '0', intentHashes: ['canary-intent-hash'] });
    const done = await api.credits.topUp(t.id);
    expect(done).toMatchObject({ state: 'credited', address: null, memo: null, asked: { amount: '45', credits: 50_000 }, received: { amount: '45', credits: 50_000 } });
    expect(await api.credits.topUp(t.id)).toEqual(done);
    await watch(h.deps);
    const balance = await api.credits.balance();
    expect(balance.balance).toBe(10_000 + 50_000);
    expect((await api.credits.topUps()).find((x) => x.id === t.id)).toEqual(done);
  });

  it('credits the promise for a payment a little under the amount asked, within 1Click’s band', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 50_000);
    // The band reaches down to 44.55 USDC.
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '44600000', amountOut: '44590000', intentHashes: ['h446'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '44.6', credits: 50_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 50_000);
  });

  it('credits more sent than asked at the rate the credits were priced at', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 50_000);
    // 9 USDC over, at 10,000/9 credits per USD.
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '54000000', amountOut: '53990000', intentHashes: ['h54'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '54', credits: 60_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 60_000);
  });

  it('credits a swap below 1Click’s band as what it buys by itself', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 50_000);
    // 40 USDC of the 45 asked, under the band's 44.55: 40,000 credits, not the 50,000 promised.
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '40000000', amountOut: '39990000', intentHashes: ['h40'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '40', credits: 40_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 40_000);
  });

  it('refuses a quote for another amount, or with a band wider than 1.5%, and logs it as an error without amounts', async () => {
    const { api, session } = await account();
    const from = h.logs.length;
    h.oneclick.nextQuote({ amountIn: '9000000' });
    expect(await failure(api.credits.startTopUp(BASE_USDC, 10_000))).toBe('unavailable');
    h.oneclick.nextQuote({ minAmountIn: '9840000' });
    expect(await failure(api.credits.startTopUp(BASE_USDC, 10_000))).toBe('unavailable');
    expect(await depositRows(session.ownerId)).toBe(0);
    const lines = logsSince(from);
    expect(lines.some((l) => l.level === 50 && l.line.includes('unexpected-quote-amount'))).toBe(true);
    expect(lines.some((l) => l.level === 50 && l.line.includes('unexpected-quote-band'))).toBe(true);
    expect(lines.filter((l) => /9000000|9840000|10000000/.test(l.line))).toEqual([]);
    // A band of exactly 1.5% is taken.
    h.oneclick.nextQuote({ minAmountIn: '9850000' });
    expect((await api.credits.startTopUp(BASE_USDC, 10_000)).state).toBe('waiting');
  });

  it('reads 18-decimal tokens', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BNB_USDC, 50_000);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '45000000000000000000', amountOut: '44990000', intentHashes: ['h45'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '45', credits: 50_000 } });
    // Just under the price, within the band: the promise.
    const under = await api.credits.startTopUp(BNB_USDC, 50_000);
    h.oneclick.set(addr(under), 'SUCCESS', { depositedAmount: '44700000000000000001', amountOut: '44690000', intentHashes: ['h447'] });
    expect(await api.credits.topUp(under.id)).toMatchObject({ state: 'credited', received: { amount: '44.7', credits: 50_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 50_000 + 50_000);
  });

  it('credits an 18-decimal refund whose units match 1Click’s own rendering, and credits nothing when they don’t', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BNB_USDC, 50_000);
    h.oneclick.set(addr(t), 'REFUNDED', {
      depositedAmount: '30000000000000000000', depositedAmountFormatted: '30.0', amountOut: '0',
      refundedAmount: '30000000000000000000', refundedAmountFormatted: '30', intentHashes: ['h30']
    });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '30', credits: 30_000 } });

    // A refund in units other than the token's (6 decimals on an 18-decimal token) disagrees with "30": not credited.
    const odd = await api.credits.startTopUp(BNB_USDC, 50_000);
    h.oneclick.set(addr(odd), 'REFUNDED', {
      depositedAmount: '30000000000000000000', depositedAmountFormatted: '30', amountOut: '0',
      refundedAmount: '30000000', refundedAmountFormatted: '30', intentHashes: ['h30b']
    });
    expect(await api.credits.topUp(odd.id)).toMatchObject({ state: 'arriving', address: null, received: null });
    expect((await api.credits.balance()).balance).toBe(10_000 + 30_000);
  });

  it('shows a payment under the band as short, with the address, and credits it as what it buys once refunded', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 50_000);
    h.oneclick.set(addr(t), 'INCOMPLETE_DEPOSIT', { depositedAmount: '30000000' });
    expect(await api.credits.topUp(t.id)).toMatchObject({
      state: 'short', address: t.address, memo: t.memo, asked: { amount: '45', credits: 50_000 }, received: { amount: '30', credits: null }
    });
    expect((await api.credits.balance()).balance).toBe(10_000);

    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'REFUNDED', { depositedAmount: '30000000', amountOut: '0', refundedAmount: '30000000', intentHashes: ['h30'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '30', credits: 30_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 30_000);
  });

  it('credits what was promised when the rest of a short payment is sent to the same address', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 50_000);
    h.oneclick.set(addr(t), 'INCOMPLETE_DEPOSIT', { depositedAmount: '30000000' });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'short', address: t.address });

    // 1Click adds the second payment to the first and swaps the total.
    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '45000000', amountOut: '44995500', intentHashes: ['h45'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '45', credits: 50_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 50_000);
  });

  it('credits a refund at the tier it reaches, however small, holds one worth no credits, and adds a swapped part', async () => {
    const { api } = await account();
    // 46 USD by itself buys 51,111 credits: past 50,000, so at 10,000/9.
    const big = await api.credits.startTopUp(TRON_USDT, 50_000);
    h.oneclick.set(addr(big), 'REFUNDED', { depositedAmount: '46000000', amountOut: '0', refundedAmount: '46000000', intentHashes: ['h46'] });
    expect(await api.credits.topUp(big.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '46', credits: 51_111 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 51_111);

    const small = await api.credits.startTopUp(TRON_USDT, 10_000);
    h.oneclick.set(addr(small), 'REFUNDED', { depositedAmount: '400000', amountOut: '0', refundedAmount: '400000', intentHashes: ['h04'] });
    expect(await api.credits.topUp(small.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '0.4', credits: 400 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 51_111 + 400);

    // Half a thousandth of a USD buys no whole credit: held.
    const dust = await api.credits.startTopUp(TRON_USDT, 10_000);
    h.oneclick.set(addr(dust), 'REFUNDED', { depositedAmount: '500', amountOut: '0', refundedAmount: '500', intentHashes: ['h0005'] });
    expect(await api.credits.topUp(dust.id)).toMatchObject({ state: 'held', address: null, received: { amount: '0.0005', credits: 0 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 51_111 + 400);

    // 80 sent for 100,000 credits, 60 swapped and 20 refunded: the whole 80 reached the treasury, so it's the promise.
    const part = await api.credits.startTopUp(TRON_USDT, 100_000);
    h.oneclick.set(addr(part), 'REFUNDED', { depositedAmount: '80000000', amountOut: '59990000', refundedAmount: '20000000', intentHashes: ['h80'] });
    expect(await api.credits.topUp(part.id)).toMatchObject({ state: 'credited', received: { amount: '80', credits: 100_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 51_111 + 400 + 100_000);
  });

  it('marks a failed swap and logs only its ID', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 10_000);
    const from = h.logs.length;
    h.oneclick.set(addr(t), 'FAILED');
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'failed', address: null, received: null });
    const lines = logsSince(from);
    expect(lines.some((l) => l.level === 50 && l.line.includes(t.id))).toBe(true);
    expect(lines.filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
    expect((await api.credits.balance()).balance).toBe(10_000);
  });

  it('keeps a deposit open on a status it doesn’t know', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 10_000);
    const from = h.logs.length;
    h.oneclick.set(addr(t), 'SOMETHING_NEW');
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'waiting', address: addr(t) });
    expect(logsSince(from).some((l) => l.level === 40 && l.line.includes('SOMETHING_NEW'))).toBe(true);

    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['h10'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '10', credits: 10_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 10_000);
  });

  it('treats a finished swap that doesn’t say what came out as arriving, and hides the address', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 25_000);
    const from = h.logs.length;
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '25000000', amountOut: null, intentHashes: ['h25'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'arriving', address: null, memo: null });
    const warned = logsSince(from).filter((l) => l.level === 40 && l.line.includes('SUCCESS'));
    expect(warned.length).toBe(1);
    expect(warned.filter((l) => l.line.includes('25000000'))).toEqual([]);
    expect((await api.credits.balance()).balance).toBe(10_000);

    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'SUCCESS', { amountOut: '25000000' });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '25', credits: 25_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 25_000);
  });

  it('the watcher credits a settled deposit without anyone opening it', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 25_000);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '25000000', amountOut: '25000000', intentHashes: ['hw25'] });
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect((await api.credits.balance()).balance).toBe(10_000 + 25_000);
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '25', credits: 25_000 } });
    await dueOnly();
    expect(await watch(h.deps)).toEqual({ checked: 0, credited: 0 });
  });

  it('checks a young deposit again in 10 seconds and an old one less often', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 10_000);
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    about(await nextCheckIn(t.id), 10);

    await h.pool.query("UPDATE deposits SET created_at = now() - interval '30 minutes', check_after = now() WHERE deposit_id = $1", [t.id]);
    await watch(h.deps);
    about(await nextCheckIn(t.id), 60);

    await h.pool.query("UPDATE deposits SET created_at = now() - interval '3 hours', check_after = now() WHERE deposit_id = $1", [t.id]);
    await watch(h.deps);
    about(await nextCheckIn(t.id), 300);
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'waiting', address: addr(t) });
  });

  it('asks 1Click once more at the deadline: credits a late payment, expires an empty one, fails a stuck or unknown one', async () => {
    const { api } = await account();
    const quiet = await api.credits.startTopUp(BASE_USDC, 10_000);
    const stuck = await api.credits.startTopUp(BASE_USDC, 10_000);
    const late = await api.credits.startTopUp(BASE_USDC, 12_000);
    const sealed = await api.credits.startTopUp(BASE_USDC, 10_000);
    const odd = await api.credits.startTopUp(BASE_USDC, 10_000);
    h.oneclick.set(addr(stuck), 'PROCESSING');
    expect(await api.credits.topUp(stuck.id)).toMatchObject({ state: 'arriving', address: null });
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
    expect(await api.credits.topUp(quiet.id)).toMatchObject({ state: 'expired', address: null, received: null });
    expect(await api.credits.topUp(stuck.id)).toMatchObject({ state: 'failed', address: null, received: null });
    expect(await api.credits.topUp(late.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '12', credits: 12_000 } });
    expect(await api.credits.topUp(odd.id)).toMatchObject({ state: 'failed', address: null });
    expect(await stateOf(sealed.id)).toBe('failed');
    const lines = logsSince(from);
    for (const id of [stuck.id, sealed.id, odd.id]) expect(lines.some((l) => l.level === 50 && l.line.includes(id))).toBe(true);
    expect(lines.some((l) => l.level === 50 && l.line.includes(quiet.id))).toBe(false);
    expect(lines.filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
    expect((await api.credits.balance()).balance).toBe(10_000 + 12_000);
  });

  it('keeps checking when 1Click is down', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 15_000);
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
    expect((await api.credits.balance()).balance).toBe(10_000 + 15_000);
  });

  it('never shows the address again once a payment was seen', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 10_000);
    const address = addr(t);
    h.oneclick.set(address, 'PROCESSING');
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'arriving', address: null });
    await forgetCheck(t.id);
    h.oneclick.set(address, 'PENDING_DEPOSIT');
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'arriving', address: null });
    await dueOnly(t.id);
    await watch(h.deps);
    expect(await stateOf(t.id)).toBe('arriving');
  });

  it('fails, never expires, a deposit 1Click says is arriving or short at the deadline', async () => {
    const { api } = await account();
    const short = await api.credits.startTopUp(BASE_USDC, 10_000);
    const arriving = await api.credits.startTopUp(BASE_USDC, 10_000);
    // Nobody opened them since: each is still stored as waiting when the last check finds money on its way.
    h.oneclick.set(addr(short), 'INCOMPLETE_DEPOSIT');
    h.oneclick.set(addr(arriving), 'PROCESSING');
    const ids = [short.id, arriving.id];
    expect([await stateOf(short.id), await stateOf(arriving.id)]).toEqual(['waiting', 'waiting']);
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = ANY($1)", [ids]);
    await dueOnly(...ids);
    const from = h.logs.length;
    expect(await watch(h.deps)).toEqual({ checked: 2, credited: 0 });
    expect(await api.credits.topUp(short.id)).toMatchObject({ state: 'failed', address: null });
    expect(await api.credits.topUp(arriving.id)).toMatchObject({ state: 'failed', address: null });
    const lines = logsSince(from);
    for (const id of ids) expect(lines.some((l) => l.level === 50 && l.line.includes(id))).toBe(true);
    expect(lines.filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
    expect(lines.filter((l) => l.level >= 30 && /expired/.test(l.msg))).toEqual([]);
  });

  it('waits 6 hours more from now, once, when 1Click can’t answer at the deadline', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 10_000);
    // The deadline passed long ago, as after the API was down for a while: the 6 hours count from now.
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '3 days' WHERE deposit_id = $1", [t.id]);
    await dueOnly(t.id);
    const from = h.logs.length;
    h.oneclick.down(true);
    try {
      expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
      expect(await stateOf(t.id)).toBe('waiting');
      about(await giveUpIn(t.id), 6 * 3600);
      expect(logsSince(from).some((l) => l.level === 40 && l.line.includes(t.id))).toBe(true);

      // Still down 6 hours later: it gives up as before.
      await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = $1", [t.id]);
      await dueOnly(t.id);
      expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
      expect(await stateOf(t.id)).toBe('expired');
    } finally {
      h.oneclick.down(false);
    }
    expect(logsSince(from).filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
  });

  it('opens at most 15 top-ups waiting for a payment, and 10 a minute', async () => {
    const { api, second, opened, close } = await fifteen();
    try {
      const quotes = h.oneclick.quotes.length;
      const e = await second.credits.startTopUp(BASE_USDC, 10_000).catch((x: unknown) => x);
      expect(code(e)).toBe('conflict');
      expect(e instanceof AlcoveApiError ? e.message : '').toBe('You already have 15 top-ups waiting for a payment. Use or cancel one of those, or wait for them to expire.');
      expect(h.oneclick.quotes.length).toBe(quotes);
      // One of them is on its way now, so there's room for another.
      const first = opened[0];
      if (!first) throw new Error('no top-up opened');
      h.oneclick.set(addr(first), 'PROCESSING');
      expect(await api.credits.topUp(first.id)).toMatchObject({ state: 'arriving' });
      expect((await second.credits.startTopUp(BASE_USDC, 10_000)).state).toBe('waiting');
      expect(await failure(second.credits.startTopUp(BASE_USDC, 10_000))).toBe('conflict');
      expect(await failure(second.credits.startTopUp(BASE_USDC, 10_000))).toBe('conflict');
      expect(await failure(second.credits.startTopUp(BASE_USDC, 10_000))).toBe('conflict');
      // The eleventh attempt in a minute on that server.
      expect(await failure(second.credits.startTopUp(BASE_USDC, 10_000))).toBe('unavailable');
    } finally {
      await close();
    }
  });

  it('doesn’t count top-ups whose address has expired against the 15 waiting', async () => {
    const { second, opened, close } = await fifteen();
    try {
      // Their addresses expired an hour ago; they're still watched, for a day, for a late payment.
      await h.pool.query("UPDATE deposits SET give_up_at = now() + interval '23 hours' WHERE deposit_id = ANY($1)", [opened.map((t) => t.id)]);
      expect((await second.credits.startTopUp(BASE_USDC, 10_000)).state).toBe('waiting');
      expect(new Set(await Promise.all(opened.map((t) => stateOf(t.id))))).toEqual(new Set(['waiting']));
    } finally {
      await close();
    }
  });

  it('cancels a waiting top-up: no address, not counted toward the 15 waiting, among the finished ones', async () => {
    const { api, second, opened, close } = await fifteen();
    try {
      expect(await failure(second.credits.startTopUp(BASE_USDC, 10_000))).toBe('conflict');
      const first = opened[0];
      if (!first) throw new Error('no top-up opened');
      const from = h.logs.length;
      const cancelled = await api.credits.cancelTopUp(first.id);
      expect(cancelled).toMatchObject({ id: first.id, state: 'cancelled', address: null, memo: null, received: null });
      expect(await api.credits.topUp(first.id)).toEqual(cancelled);
      expect(logsSince(from).some((l) => l.msg === 'top-up cancelled' && l.line.includes(first.id))).toBe(true);
      expect(logsSince(from).filter((l) => l.line.includes('canary-deposit-address'))).toEqual([]);
      const another = await second.credits.startTopUp(BASE_USDC, 10_000);
      expect(another.state).toBe('waiting');
      // The open part lists the 15 waiting ones; the cancelled one comes after them, among the finished.
      const list = await api.credits.topUps();
      expect(list.length).toBe(16);
      expect(new Set(list.slice(0, 15).map((t) => t.id))).toEqual(new Set([another.id, ...opened.slice(1).map((t) => t.id)]));
      expect(list.at(-1)).toEqual(cancelled);
    } finally {
      await close();
    }
  });

  it('cancels only a top-up nothing has reached, and only the owner’s', async () => {
    const { api } = await account();
    const short = await api.credits.startTopUp(BASE_USDC, 10_000);
    const arriving = await api.credits.startTopUp(BASE_USDC, 10_000);
    const credited = await api.credits.startTopUp(BASE_USDC, 10_000);
    h.oneclick.set(addr(short), 'INCOMPLETE_DEPOSIT', { depositedAmount: '3000000' });
    h.oneclick.set(addr(arriving), 'PROCESSING');
    h.oneclick.set(addr(credited), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['hc10'] });
    expect((await api.credits.topUp(short.id)).state).toBe('short');
    expect((await api.credits.topUp(arriving.id)).state).toBe('arriving');
    expect((await api.credits.topUp(credited.id)).state).toBe('credited');
    const e = await api.credits.cancelTopUp(short.id).catch((x: unknown) => x);
    expect(code(e)).toBe('conflict');
    expect(e instanceof AlcoveApiError ? e.message : '').toBe('This top-up can’t be cancelled any more: a payment has already reached it.');
    expect(await failure(api.credits.cancelTopUp(arriving.id))).toBe('conflict');
    expect(await failure(api.credits.cancelTopUp(credited.id))).toBe('conflict');
    expect([await stateOf(short.id), await stateOf(arriving.id), await stateOf(credited.id)]).toEqual(['short', 'arriving', 'credited']);

    const waiting = await api.credits.startTopUp(BASE_USDC, 10_000);
    expect((await api.credits.cancelTopUp(waiting.id)).state).toBe('cancelled');
    expect(await failure(api.credits.cancelTopUp(waiting.id))).toBe('conflict');

    const other = await account();
    const theirs = await other.api.credits.startTopUp(BASE_USDC, 10_000);
    expect(await failure(api.credits.cancelTopUp(theirs.id))).toBe('not-found');
    expect(await failure(api.credits.cancelTopUp('not-a-top-up'))).toBe('not-found');
    expect(await stateOf(theirs.id)).toBe('waiting');
    expect((await api.credits.balance()).balance).toBe(10_000 + 10_000);
  });

  it('credits a payment that reaches a cancelled top-up anyway, and a stale answer leaves it cancelled', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 20_000);
    const address = addr(t);
    await api.credits.cancelTopUp(t.id);

    // 1Click still says it's waiting: it stays cancelled, without its address, by the watcher and the app.
    h.oneclick.set(address, 'PENDING_DEPOSIT');
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    expect(await stateOf(t.id)).toBe('cancelled');
    await forgetCheck(t.id);
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'cancelled', address: null });

    // Sent from an exchange before it was cancelled: it moves on and is credited the promise.
    h.oneclick.set(address, 'PROCESSING');
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    expect(await stateOf(t.id)).toBe('arriving');
    h.oneclick.set(address, 'SUCCESS', { depositedAmount: '20000000', amountOut: '20000000', intentHashes: ['hcx20'] });
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '20', credits: 20_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 20_000);

    // Straight from cancelled to settled, as the app sees it.
    const direct = await api.credits.startTopUp(BASE_USDC, 10_000);
    await api.credits.cancelTopUp(direct.id);
    h.oneclick.set(addr(direct), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['hcd10'] });
    await forgetCheck(direct.id);
    expect(await api.credits.topUp(direct.id)).toMatchObject({ state: 'credited', received: { amount: '10', credits: 10_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 20_000 + 10_000);
  });

  it('keeps a cancelled top-up nothing reached cancelled at the deadline, and stops checking it; fails one 1Click says is arriving then', async () => {
    const { api } = await account();
    const quiet = await api.credits.startTopUp(BASE_USDC, 10_000);
    const stuck = await api.credits.startTopUp(BASE_USDC, 10_000);
    await api.credits.cancelTopUp(quiet.id);
    await api.credits.cancelTopUp(stuck.id);
    h.oneclick.set(addr(stuck), 'PROCESSING');
    const ids = [quiet.id, stuck.id];
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = ANY($1)", [ids]);
    await dueOnly(...ids);
    const from = h.logs.length;
    expect(await watch(h.deps)).toEqual({ checked: 2, credited: 0 });
    expect(await api.credits.topUp(quiet.id)).toMatchObject({ state: 'cancelled', address: null });
    expect(await api.credits.topUp(stuck.id)).toMatchObject({ state: 'failed', address: null });
    const lines = logsSince(from);
    expect(lines.some((l) => l.level === 30 && l.line.includes(quiet.id))).toBe(true);
    expect(lines.some((l) => l.level >= 50 && l.line.includes(quiet.id))).toBe(false);
    expect(lines.some((l) => l.level === 50 && l.line.includes(stuck.id))).toBe(true);
    // Never due again: the next pass doesn't take it.
    expect(await nextCheckIn(quiet.id)).toBe(Infinity);
    await h.pool.query("UPDATE deposits SET check_after = now() + interval '1 hour' WHERE state IN ('waiting','arriving','short','cancelled') AND deposit_id <> $1", [quiet.id]);
    expect(await watch(h.deps)).toEqual({ checked: 0, credited: 0 });
    expect(await stateOf(quiet.id)).toBe('cancelled');
  });

  it('watches a cancelled top-up again when a payment shows up after its deadline, and credits it without the app open', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC, 10_000);
    const address = addr(t);
    await api.credits.cancelTopUp(t.id);
    // At the deadline 1Click hadn't seen the payment yet: it stays cancelled and stops being checked.
    h.oneclick.set(address, 'PENDING_DEPOSIT');
    await h.pool.query("UPDATE deposits SET give_up_at = now() - interval '1 second' WHERE deposit_id = $1", [t.id]);
    await dueOnly(t.id);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 0 });
    expect(await nextCheckIn(t.id)).toBe(Infinity);

    // Opened later, 1Click now sees it arriving: it's due for the watcher again.
    h.oneclick.set(address, 'PROCESSING');
    await forgetCheck(t.id);
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'arriving', address: null });
    about(await nextCheckIn(t.id), 0);

    // The app is closed; the watcher alone credits it once it settles.
    h.oneclick.set(address, 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['hlate10'] });
    await h.pool.query("UPDATE deposits SET check_after = now() + interval '1 hour' WHERE state IN ('waiting','arriving','short','cancelled') AND deposit_id <> $1", [t.id]);
    expect(await watch(h.deps)).toEqual({ checked: 1, credited: 1 });
    expect(await stateOf(t.id)).toBe('credited');
    expect((await api.credits.balance()).balance).toBe(10_000 + 10_000);
  });

  it('moves a cancelled top-up on to short, showing the address again, or failed', async () => {
    const { api } = await account();
    const short = await api.credits.startTopUp(BASE_USDC, 10_000);
    const failed = await api.credits.startTopUp(BASE_USDC, 10_000);
    await api.credits.cancelTopUp(short.id);
    await api.credits.cancelTopUp(failed.id);
    h.oneclick.set(addr(short), 'INCOMPLETE_DEPOSIT', { depositedAmount: '3000000' });
    h.oneclick.set(addr(failed), 'FAILED');
    await forgetCheck(short.id);
    await forgetCheck(failed.id);
    expect(await api.credits.topUp(short.id)).toMatchObject({ state: 'short', address: short.address, received: { amount: '3', credits: null } });
    expect(await api.credits.topUp(failed.id)).toMatchObject({ state: 'failed', address: null });
  });

  it('credits once when the watcher and the app race', async () => {
    const email = unique();
    const one = await account(email);
    const two = await account(email);
    const t = await one.api.credits.startTopUp(BASE_USDC, 20_000);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '20000000', amountOut: '20000000', intentHashes: ['h20'] });
    await dueOnly(t.id);
    await Promise.all([watch(h.deps), watch(h.deps), one.api.credits.topUp(t.id), two.api.credits.topUp(t.id)]);
    expect(await two.api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { credits: 20_000 } });
    expect((await one.api.credits.balance()).balance).toBe(10_000 + 20_000);
  });
});
