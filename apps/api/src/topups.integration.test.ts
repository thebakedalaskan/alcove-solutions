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
const depositRows = async (ownerId: string) => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM deposits WHERE owner_id = $1', [ownerId])).rows[0]?.n;

describe('top-ups', () => {
  it('lists the allowlisted routes and the tiers', async () => {
    const { api } = await account();
    const { routes, tiers } = await api.credits.routes();
    expect(routes.map((r) => `${r.token} ${r.chain}`)).toContain('USDC base');
    expect(routes.some((r) => r.id === NOT_ALLOWLISTED)).toBe(false);
    expect(routes.find((r) => r.chain === 'eth' && r.token === 'USDC')?.minimum).toBe('20');
    expect(routes.find((r) => r.chain === 'base')?.minimum).toBe('5');
    expect(routes.find((r) => r.chain === 'bsc' && r.token === 'USDC')).toMatchObject({ chainName: 'BNB Chain', minimum: '5' });
    expect(tiers.map((t) => t.from)).toEqual(['0', '45', '80']);
  });

  it('opens a top-up: a quote paying the treasury, and an address to send to', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC);
    expect(t).toMatchObject({ state: 'waiting', received: null, route: { token: 'USDC', chain: 'base', minimum: '5' } });
    expect(t.address).toContain('canary-deposit-address');
    const TREASURY = h.oneclick.settings.TREASURY_INTENTS_ACCOUNT;
    expect(h.oneclick.quotes.at(-1)).toMatchObject({
      swapType: 'FLEX_INPUT', depositType: 'ORIGIN_CHAIN', originAsset: BASE_USDC,
      destinationAsset: NEAR_USDC, recipient: TREASURY, recipientType: 'INTENTS', refundTo: TREASURY, refundType: 'INTENTS',
      amount: '5000000', slippageTolerance: 100, dry: false
    });
    expect(h.oneclick.apiKeys.at(-1)).toBe(h.oneclick.settings.ONECLICK_API_KEY);
    expect(await api.credits.topUp(t.id)).toEqual(t);
    expect((await api.credits.topUps()).map((x) => x.id)).toEqual([t.id]);
  });

  it('refuses a route that isn’t offered', async () => {
    const { api, session } = await account();
    expect(await failure(api.credits.startTopUp(NOT_ALLOWLISTED))).toBe('invalid');
    expect(await depositRows(session.ownerId)).toBe(0);
  });

  it('keeps top-ups to their owner', async () => {
    const a = await account();
    const b = await account();
    const t = await a.api.credits.startTopUp(BASE_USDC);
    expect(await failure(b.api.credits.topUp(t.id))).toBe('not-found');
    expect(await b.api.credits.topUps()).toEqual([]);
  });

  it('says top-ups are unavailable when 1Click isn’t set up, or won’t quote', async () => {
    const second = await h.secondServer({ ONECLICK_API_KEY: '' });
    try {
      const api: AlcoveApi = createHttpApi({ baseUrl: second.baseUrl, fetch: cookieFetch(ORIGIN) });
      await api.auth.signIn('sso', { email: unique() });
      const theirs = await (await account()).api.credits.startTopUp(BASE_USDC);
      expect(await failure(api.credits.routes())).toBe('unavailable');
      expect(await failure(api.credits.startTopUp(BASE_USDC))).toBe('unavailable');
      expect(await failure(api.credits.topUp(theirs.id))).toBe('unavailable');
      expect(await failure(api.credits.topUps())).toBe('unavailable');
    } finally {
      await second.close();
    }

    const { api, session } = await account();
    h.oneclick.down(true);
    try {
      expect(await failure(api.credits.startTopUp(BASE_USDC))).toBe('unavailable');
    } finally {
      h.oneclick.down(false);
    }
    expect(await depositRows(session.ownerId)).toBe(0);
  });

  it('credits what reached the treasury once, and stops showing the address', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '25000000', amountOut: '25000000', refundedAmount: '0', intentHashes: ['canary-intent-hash'] });
    const done = await api.credits.topUp(t.id);
    expect(done).toMatchObject({ state: 'credited', address: null, memo: null, received: { amount: '25', credits: 25_000 } });
    expect(await api.credits.topUp(t.id)).toEqual(done);
    await watch(h.deps);
    expect((await api.credits.balance()).balance).toBe(10_000 + 25_000);
    expect((await api.credits.topUps()).find((x) => x.id === t.id)).toEqual(done);
  });

  it('picks the tier from what was sent', async () => {
    const { api } = await account();
    const a = await api.credits.startTopUp(BASE_USDC);
    h.oneclick.set(addr(a), 'SUCCESS', { depositedAmount: '45000000', amountOut: '44995000', intentHashes: ['h45'] });
    expect((await api.credits.topUp(a.id)).received).toEqual({ amount: '44.995', credits: 49_994 });
    const b = await api.credits.startTopUp(BASE_USDC);
    h.oneclick.set(addr(b), 'SUCCESS', { depositedAmount: '80000000', amountOut: '79990000', intentHashes: ['h80'] });
    expect((await api.credits.topUp(b.id)).received).toEqual({ amount: '79.99', credits: 99_987 });
    expect((await api.credits.balance()).balance).toBe(10_000 + 49_994 + 99_987);
  });

  it('reads 18-decimal tokens', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BNB_USDC);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '50000000000000000000', amountOut: '49990000', intentHashes: ['h50'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '49.99', credits: 55_544 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 55_544);
  });

  it('credits a refund of at least 1 USD and holds a smaller one', async () => {
    const { api } = await account();
    const big = await api.credits.startTopUp(TRON_USDT);
    h.oneclick.set(addr(big), 'REFUNDED', { depositedAmount: '3000000', amountOut: '0', refundedAmount: '3000000', intentHashes: ['h3'] });
    expect(await api.credits.topUp(big.id)).toMatchObject({ state: 'credited', address: null, received: { amount: '3', credits: 3_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 3_000);

    const small = await api.credits.startTopUp(TRON_USDT);
    h.oneclick.set(addr(small), 'REFUNDED', { depositedAmount: '400000', amountOut: '0', refundedAmount: '400000', intentHashes: ['h04'] });
    expect(await api.credits.topUp(small.id)).toMatchObject({ state: 'held', address: null, received: { amount: '0.4', credits: 0 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 3_000);
  });

  it('marks a failed swap and logs only its ID', async () => {
    const { api } = await account();
    const t = await api.credits.startTopUp(BASE_USDC);
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
    const t = await api.credits.startTopUp(BASE_USDC);
    const from = h.logs.length;
    h.oneclick.set(addr(t), 'SOMETHING_NEW');
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'waiting', address: addr(t) });
    expect(logsSince(from).some((l) => l.level === 40 && l.line.includes('SOMETHING_NEW'))).toBe(true);

    await forgetCheck(t.id);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '10000000', amountOut: '10000000', intentHashes: ['h10'] });
    expect(await api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { amount: '10', credits: 10_000 } });
    expect((await api.credits.balance()).balance).toBe(10_000 + 10_000);
  });

  it('credits once when the watcher and the app race', async () => {
    const email = unique();
    const one = await account(email);
    const two = await account(email);
    const t = await one.api.credits.startTopUp(BASE_USDC);
    h.oneclick.set(addr(t), 'SUCCESS', { depositedAmount: '20000000', amountOut: '20000000', intentHashes: ['h20'] });
    await Promise.all([watch(h.deps), watch(h.deps), one.api.credits.topUp(t.id), two.api.credits.topUp(t.id)]);
    expect(await two.api.credits.topUp(t.id)).toMatchObject({ state: 'credited', received: { credits: 20_000 } });
    expect((await one.api.credits.balance()).balance).toBe(10_000 + 20_000);
  });
});
