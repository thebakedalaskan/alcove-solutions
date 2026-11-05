/**
 * Adding credits by sending stablecoins, end to end: the real API over HTTP via @alcove/api-http, real Postgres,
 * and a stand-in NEAR Intents 1Click (testing/fake-oneclick.ts) that quotes deposit addresses and reports on them.
 */
import { AlcoveApiError, type AlcoveApi } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOT_ALLOWLISTED } from './testing/fake-oneclick';
import { ORIGIN, cookieFetch, startHarness, type Harness } from './testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const failure = (p: Promise<unknown>) => p.then(() => 'succeeded', code);
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
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
});
