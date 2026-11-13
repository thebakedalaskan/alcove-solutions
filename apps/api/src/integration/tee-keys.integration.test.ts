/*
 * Carrying accounts into the TEE (docs: privacy-keys-and-sessions › Moving to confidential computing). A database from before
 * the TEE has every root key wrapped under the old KMASTER, its blind indexes keyed by it and its billing sealed under the old
 * KSERVICE. Inside the TEE (Confidential Space) the master is made there and kept wrapped by Cloud KMS (here, its stand-in).
 * Given the old keys (LEGACY_SECRETS), the API seals what it needs of them under that master (server_keys), opens those
 * accounts, wraps their root keys again under the master, and lets the old master go only once every account has moved.
 * Accounts open through the real API, signed in with Google as a browser does.
 */
import { AlcoveApiError } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { b64u, deriveIndexKey, photoTokenKey, random, rootCheck, unb64u } from '../crypto';
import { sealRoot } from '../owners';
import { resolveKeys, rewrapOwners, type KeySource, type KeyWrapper, type LegacyKeys } from '../serverKeys';
import type { GoogleUser } from '../testing/fake-google';
import { fakeKms } from '../testing/fake-kms';
import { ORIGIN, cookieFetch, startHarness, type Browser, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
// Each test starts from the database as the release before the TEE leaves it: no server keys, and the old envelopes only.
beforeEach(async () => {
  await h.pool.query('DELETE FROM server_keys');
  await h.pool.query('DELETE FROM owners WHERE root_envelope IS NULL');
  await h.pool.query('UPDATE owners SET root_envelope_v2 = NULL');
});

/** Cloud KMS, as the TEE's builds reach it: the same key every time, as the harness's TEE servers use. */
const kms = fakeKms();
let seq = 0;
const person = (name: string, picture?: string): GoogleUser => { const n = seq++; return { sub: `tee-${name}-${n}-${Date.now()}`, email: `${name}.${n}@vandelay.test`, name: `${name} Example`, ...(picture ? { picture } : {}) }; };
/** An account made on the release before, signed in with single sign-on, so the database has accounts. */
async function someone() {
  const email = `someone.${seq++}@vandelay.test`;
  const r = await h.browser().api.auth.signIn('sso', { email });
  return { email, ownerId: r.session.ownerId };
}
const count = async (sql: string, params: unknown[] = []) => z.object({ n: z.number() }).parse((await h.pool.query(sql, params)).rows[0]).n;
const stored = async (id: 'master' | 'bundle') => z.object({ record: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT record FROM server_keys WHERE id = $1', [id])).rows[0]).record;
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const Envelopes = z.object({ old: z.boolean(), now: z.boolean() });
const envelopes = async (ownerId: string | undefined) => Envelopes.parse((await h.pool.query('SELECT root_envelope IS NOT NULL AS old, root_envelope_v2 IS NOT NULL AS now FROM owners WHERE owner_id = $1', [ownerId])).rows[0]);

/** The keys the database had before the TEE: the harness's own, as the old Cloud Run API had them. */
const legacy = (): LegacyKeys => ({ kmaster: h.deps.cfg.KMASTER, kservice: h.deps.cfg.KSERVICE });
/** Where key resolution takes the keys from inside the TEE: Cloud KMS's stand-in, started with the old keys or not. */
const inside = (more: { legacy?: LegacyKeys; retire?: boolean; wrapper?: KeyWrapper } = {}): KeySource =>
  ({ tee: 'confidential-space', wrapper: more.wrapper ?? kms, legacy: more.legacy, retire: more.retire ?? false });
/** An API inside the TEE, on the same database, its keys resolved as the server resolves them at start. */
const inTee = (old?: LegacyKeys) => h.secondServer({ TEE: 'confidential-space', ...(old ? { legacy: old } : {}) });
/** The harness's deps as an instance inside the TEE runs, with these keys. */
const teeDeps = (keys: Awaited<ReturnType<typeof resolveKeys>>) => ({ ...h.deps, cfg: { ...h.deps.cfg, TEE: 'confidential-space' as const, ...keys } });

/** A browser whose every request goes to whichever server `at` names now: one address in front of both, as at the switch. */
function browserAt(at: () => string): Browser {
  const jar = cookieFetch(ORIGIN);
  const to: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return jar(new URL(`${url.pathname}${url.search}`, at()), init);
  };
  return { fetch: to, api: createHttpApi({ baseUrl: at(), fetch: to }) };
}
/** Signs in with Google the way a browser does, following each redirect by hand. Where the app lands. */
async function viaGoogle(b: Browser, user: GoogleUser): Promise<string> {
  h.google.next(user);
  let url = new URL(b.api.auth.signInUrl('google'));
  for (let hop = 0; hop < 10; hop++) {
    if (url.origin === new URL(ORIGIN).origin) return `${url.pathname}${url.search}`;
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  throw new Error('Too many redirects while signing in with Google.');
}
/** Waits for what an account's opening does in the background: its root wrapped again under the master. */
async function until(ok: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`Timed out waiting for ${what}`);
}
/** An account as the release before makes one: its root key under the old master alone. */
function oldAccount(): [string, Uint8Array, Uint8Array] {
  const ownerId = b64u(random(32));
  const root = random(32);
  return [ownerId, sealRoot(unb64u(h.deps.cfg.KMASTER, 32), ownerId, root, '1'), rootCheck(root, ownerId)];
}
/** Waits until a transaction somewhere waits for the lock on owners. */
const waitingOnOwners = () => until(async () => (await count("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND relation = 'owners'::regclass")) > 0, 'a wait on the owners table');

describe('server keys', () => {
  it('seals fresh server keys only on a database with no accounts, and instances starting at once agree on them', async () => {
    // A database the TEE starts on with nobody in it yet. Two instances start at once: each makes a master and fresh keys, and
    // whichever is stored first is what both run with.
    await h.pool.query('DELETE FROM owners');
    const [blue, green] = await Promise.all([resolveKeys(h.pool, inside()), resolveKeys(h.pool, inside())]);
    expect(blue).toEqual(green);
    expect(await count('SELECT count(*)::int AS n FROM server_keys')).toBe(2);
    // The master is what Cloud KMS unwraps from the row, the index and photo keys derive from it, KSERVICE is new, and there's no old master.
    expect(blue.KMASTER).toBe(b64u(await kms.unwrap(await stored('master'))));
    expect(blue.INDEX_KEY).toBe(b64u(deriveIndexKey(unb64u(blue.KMASTER, 32))));
    expect(blue.PHOTO_KEY).toBe(b64u(photoTokenKey(unb64u(blue.KMASTER, 32))));
    expect(blue.KSERVICE).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([blue.KMASTER, blue.KSERVICE]).not.toContain(h.deps.cfg.KMASTER);
    expect(blue.LEGACY_KMASTER).toBeUndefined();

    // The first account has the master's envelope only, and signs in again on another instance.
    const first = await inTee();
    try {
      const eve = person('eve');
      const made = browserAt(() => first.baseUrl);
      expect(await viaGoogle(made, eve)).toBe('/ready');
      const ownerId = (await made.api.auth.getSession())?.ownerId;
      expect(await envelopes(ownerId)).toEqual({ old: false, now: true });
      const again = browserAt(() => first.baseUrl);
      expect(await viaGoogle(again, eve)).toBe('/home');
      expect((await again.api.auth.getSession())?.ownerId).toBe(ownerId);
      await again.api.account.delete();
    } finally {
      await first.close();
    }
  });

  it('carries accounts made before the TEE into it', async () => {
    // Someone on the release before: signed in with Google, with a photo, a call scheduled with a guest, credits to spend.
    const ann = person('ann', `${h.google.issuer}/photo/ann-1`);
    const before = browserAt(() => h.baseUrl);
    expect(await viaGoogle(before, ann)).toBe('/ready');
    const session = await before.api.auth.getSession();
    const ownerId = session?.ownerId;
    expect(ownerId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The photo's URL, as notes keep it (who spoke): sealed under a key from the old master.
    const photo = session?.user.photoUrl ?? '';
    const photoToken = photo.slice(photo.lastIndexOf('/') + 1);
    expect(photo.startsWith(`${h.baseUrl}/v1/photos/`)).toBe(true);
    const m = await before.api.meetings.create({ title: 'Quarterly with Theo', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: ['guest@vandelay.test'], notes: 'on' });
    const balance = await before.api.credits.balance();
    // As that release leaves the database: only the old envelopes, and no server keys.
    expect(await envelopes(ownerId)).toEqual({ old: true, now: false });

    const first = await inTee(legacy());
    try {
      expect(first.cfg.KMASTER).toBe(b64u(await kms.unwrap(await stored('master'))));
      const there = browserAt(() => first.baseUrl);
      // The same account, found by the same blind index, opened through the old envelope.
      expect(await viaGoogle(there, ann)).toBe('/home');
      expect((await there.api.auth.getSession())?.ownerId).toBe(ownerId);
      expect((await there.api.meetings.get(m.id)).guests.map((g) => g.email)).toEqual(['guest@vandelay.test']);
      expect((await there.api.meetings.upcoming()).map((x) => x.id)).toContain(m.id);
      expect((await there.api.meetings.byCode(m.code))?.id).toBe(m.id);
      expect(await there.api.credits.balance()).toEqual(balance);
      // Her photo's URL from before still opens, and is the one the TEE makes for it now: the photo key is carried.
      expect((await there.api.auth.getSession())?.user.photoUrl?.endsWith(`/v1/photos/${photoToken}`)).toBe(true);
      const shown = await there.fetch(`${first.baseUrl}/v1/photos/${photoToken}`);
      expect([shown.status, shown.headers.get('content-type')]).toEqual([200, 'image/png']);
      // Every account's root key is wrapped again under the TEE's master.
      let left = -1;
      for (let i = 0; i < 5 && left !== 0; i++) {
        const r = await rewrapOwners({ ...h.deps, cfg: first.cfg });
        expect(r.failed).toBe(0);
        left = r.remaining;
      }
      expect(left).toBe(0);
      expect(await count('SELECT count(*)::int AS n FROM owners WHERE root_envelope_v2 IS NULL')).toBe(0);

      // Someone who signs up on the release before after that pass, which writes only the old envelope, opens all the same,
      // and is wrapped again under the master as they do.
      const bea = person('bea');
      const early = browserAt(() => h.baseUrl);
      expect(await viaGoogle(early, bea)).toBe('/ready');
      const beaId = (await early.api.auth.getSession())?.ownerId;
      expect(await envelopes(beaId)).toEqual({ old: true, now: false });
      const late = browserAt(() => first.baseUrl);
      expect(await viaGoogle(late, bea)).toBe('/home');
      expect((await late.api.auth.getSession())?.ownerId).toBe(beaId);
      await until(async () => (await count('SELECT count(*)::int AS n FROM owners WHERE root_envelope_v2 IS NULL')) === 0, 'her root wrapped again');
    } finally {
      await first.close();
    }

    // Started again without the old keys: it holds no old master, but every account has moved, so all of it still opens.
    const second = await inTee();
    try {
      expect(second.cfg.LEGACY_KMASTER).toBeUndefined();
      const again = browserAt(() => second.baseUrl);
      expect(await viaGoogle(again, ann)).toBe('/home');
      expect((await again.api.auth.getSession())?.ownerId).toBe(ownerId);
      expect((await again.api.meetings.get(m.id)).title).toBe('Quarterly with Theo');
      expect(await again.api.credits.balance()).toEqual(balance);
    } finally {
      await second.close();
    }
  });

  it('an account made in the TEE while the old master is held signs in on the release before', async () => {
    await someone();
    const tee = await inTee(legacy());
    let ownerId: string | undefined;
    let workspace = '';
    const cat = person('cat');
    let meeting = '';
    try {
      // Made in the TEE: both envelopes, the old one under the old master, and so is a workspace (an owner too).
      const made = browserAt(() => tee.baseUrl);
      expect(await viaGoogle(made, cat)).toBe('/ready');
      ownerId = (await made.api.auth.getSession())?.ownerId;
      expect(await envelopes(ownerId)).toEqual({ old: true, now: true });
      meeting = (await made.api.meetings.create({ title: 'Made in the TEE', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on' })).id;
      workspace = (await made.api.workspaces.create('Rollback')).id;
      expect(await count('SELECT count(*)::int AS n FROM owners o JOIN workspaces w ON w.owner_id = o.owner_id WHERE w.workspace_id = $1 AND o.root_envelope IS NOT NULL AND o.root_envelope_v2 IS NOT NULL', [workspace])).toBe(1);
    } finally {
      await tee.close();
    }
    // Rolled back: the release before reads root_envelope alone, under the old KMASTER, and finds all of it.
    await h.pool.query('UPDATE owners SET root_envelope_v2 = NULL');
    const back = browserAt(() => h.baseUrl);
    expect(await viaGoogle(back, cat)).toBe('/home');
    expect((await back.api.auth.getSession())?.ownerId).toBe(ownerId);
    expect((await back.api.meetings.get(meeting)).title).toBe('Made in the TEE');
    expect((await back.api.workspaces.list()).map((w) => w.id)).toContain(workspace);
  });

  it('refuses to start on accounts it can’t open', async () => {
    await someone();
    // Fresh server keys over these accounts would lock everyone out.
    await expect(resolveKeys(h.pool, inside())).rejects.toThrow(/old KMASTER/);
    await expect(resolveKeys(h.pool, inside({ legacy: { kmaster: randomBytes(32).toString('base64url'), kservice: h.deps.cfg.KSERVICE } }))).rejects.toThrow(/KMASTER doesn’t open/);
    // So would another KSERVICE: every balance would stop opening.
    await expect(resolveKeys(h.pool, inside({ legacy: { kmaster: h.deps.cfg.KMASTER, kservice: randomBytes(32).toString('base64url') } }))).rejects.toThrow(/KSERVICE doesn’t open/);
    expect(await count("SELECT count(*)::int AS n FROM server_keys WHERE id = 'bundle'")).toBe(0);
    // Once they're sealed, old keys other than the ones carried are refused.
    await resolveKeys(h.pool, inside({ legacy: legacy() }));
    await expect(resolveKeys(h.pool, inside({ legacy: { kmaster: h.deps.cfg.KMASTER, kservice: randomBytes(32).toString('base64url') } }))).rejects.toThrow(/aren’t the ones/);
    // And a database a TEE has carried over is never run outside one: new root keys there would go under the old master alone.
    await expect(resolveKeys(h.pool, { tee: 'none', kmaster: h.deps.cfg.KMASTER, kservice: h.deps.cfg.KSERVICE })).rejects.toThrow(/belongs to a TEE/);
  });

  it('a master wrapped for another key can’t be opened', async () => {
    await someone();
    await resolveKeys(h.pool, inside({ legacy: legacy() }));
    // Another Cloud KMS key, or a build Cloud KMS won't unwrap for.
    await expect(resolveKeys(h.pool, inside({ wrapper: fakeKms('another-key') }))).rejects.toThrow(/doesn’t unwrap/);
    // Another master than the one the server keys were sealed under.
    const ours = await stored('master');
    await h.pool.query("UPDATE server_keys SET record = $1 WHERE id = 'master'", [await kms.wrap(randomBytes(32))]);
    await expect(resolveKeys(h.pool, inside())).rejects.toThrow(/weren’t sealed under this master/);
    // And none: a new one is never made beside server keys it couldn't open.
    await h.pool.query("DELETE FROM server_keys WHERE id = 'master'");
    await expect(resolveKeys(h.pool, inside())).rejects.toThrow(/their master isn’t/);
    expect(await count("SELECT count(*)::int AS n FROM server_keys WHERE id = 'master'")).toBe(0);
    // Put back, everything opens again: with the old master while it's started with the old keys, and without it otherwise.
    await h.pool.query("INSERT INTO server_keys (id, record) VALUES ('master', $1)", [ours]);
    expect((await resolveKeys(h.pool, inside({ legacy: legacy() }))).LEGACY_KMASTER).toBe(h.deps.cfg.KMASTER);
    expect((await resolveKeys(h.pool, inside())).LEGACY_KMASTER).toBeUndefined();
  });

  it('a master made again opens accounts through the old one, and is never made over accounts only the lost one opens', async () => {
    const made = await Promise.all([someone(), someone(), someone()]);
    const first = await resolveKeys(h.pool, inside({ legacy: legacy() }));
    expect((await rewrapOwners(teeDeps(first))).remaining).toBe(0);
    // Both rows lost, as in a partial restore: every account has an envelope under a master that isn't here.
    await h.pool.query('DELETE FROM server_keys');
    const from = h.logs.length;
    const again = await resolveKeys(h.pool, inside({ legacy: legacy() }));
    expect(again.KMASTER).not.toBe(first.KMASTER);
    expect(h.logs.slice(from).some((l) => l.includes('"msg":"a new master over accounts wrapped under another'))).toBe(true);
    // Retiring the old master now would lose them: refused.
    await expect(resolveKeys(h.pool, inside({ retire: true }))).rejects.toThrow(/only the old master opens/);
    // Each opens through its old envelope, and is wrapped again under the new master as it's opened.
    const server = await inTee(legacy());
    try {
      const signedIn = await browserAt(() => server.baseUrl).api.auth.signIn('sso', { email: made[0]?.email ?? '' });
      expect(signedIn.session.ownerId).toBe(made[0]?.ownerId);
    } finally {
      await server.close();
    }
    // And all of them by the pass, which counts what the master doesn't open yet.
    expect(await rewrapOwners(teeDeps(again))).toMatchObject({ failed: 0, remaining: 0 });
    expect((await resolveKeys(h.pool, inside({ retire: true }))).LEGACY_KMASTER).toBeUndefined();

    // An account made since, under the new master alone, can't be opened by any other: no master is made over it.
    const cat = person('cat');
    const tee = await inTee();
    try { expect(await viaGoogle(browserAt(() => tee.baseUrl), cat)).toBe('/ready'); } finally { await tee.close(); }
    await h.pool.query('DELETE FROM server_keys');
    await expect(resolveKeys(h.pool, inside({ legacy: legacy() }))).rejects.toThrow(/wrapped under a master that isn’t here/);
    expect(await count('SELECT count(*)::int AS n FROM server_keys')).toBe(0);
  });

  it('uses the old master only while it’s started with the old keys', async () => {
    const late = await someone();
    const carried = await resolveKeys(h.pool, inside({ legacy: legacy() }));
    expect(carried.LEGACY_KMASTER).toBe(h.deps.cfg.KMASTER);
    // Started without them, whatever the server keys carry: no old envelope for new accounts, none opened, none wrapped again.
    const server = await inTee();
    try {
      expect(server.cfg.LEGACY_KMASTER).toBeUndefined();
      const dee = person('dee');
      const made = browserAt(() => server.baseUrl);
      expect(await viaGoogle(made, dee)).toBe('/ready');
      expect(await envelopes((await made.api.auth.getSession())?.ownerId)).toEqual({ old: false, now: true });
      expect(code(await browserAt(() => server.baseUrl).api.auth.signIn('sso', { email: late.email }).catch((e: unknown) => e))).toBe('key-unavailable');
      expect(await envelopes(late.ownerId)).toEqual({ old: true, now: false });
      expect(await rewrapOwners({ ...h.deps, cfg: server.cfg })).toMatchObject({ rewrapped: 0, failed: 0 });
      await made.api.account.delete();
    } finally {
      await server.close();
    }
    // A copy of the server keys from before retirement, put back after it, brings nothing back without the old keys.
    const before = await stored('bundle');
    expect((await rewrapOwners(teeDeps(carried))).remaining).toBe(0);
    expect((await resolveKeys(h.pool, inside({ retire: true }))).LEGACY_KMASTER).toBeUndefined();
    await h.pool.query("UPDATE server_keys SET record = $1 WHERE id = 'bundle'", [before]);
    expect((await resolveKeys(h.pool, inside())).LEGACY_KMASTER).toBeUndefined();
  });

  it('two instances starting at once agree on one bundle', async () => {
    await someone();
    const [blue, green] = await Promise.all([resolveKeys(h.pool, inside({ legacy: legacy() })), resolveKeys(h.pool, inside({ legacy: legacy() }))]);
    expect(blue).toEqual(green);
    expect(blue).toEqual({
      KMASTER: b64u(await kms.unwrap(await stored('master'))), KSERVICE: h.deps.cfg.KSERVICE, INDEX_KEY: h.deps.cfg.INDEX_KEY, PHOTO_KEY: h.deps.cfg.PHOTO_KEY, LEGACY_KMASTER: h.deps.cfg.KMASTER
    });
    expect(await count("SELECT count(*)::int AS n FROM server_keys WHERE id = 'master'")).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM server_keys WHERE id = 'bundle'")).toBe(1);
  });

  it('rewraps every account across pages, counting one that won’t open', async () => {
    const made = await Promise.all(Array.from({ length: 5 }, () => someone()));
    const carried = await resolveKeys(h.pool, inside({ legacy: legacy() }));
    // One account's old envelope is another's: it won't open under the old master as its own.
    const [broken, other] = made;
    await h.pool.query('UPDATE owners SET root_envelope = (SELECT root_envelope FROM owners WHERE owner_id = $2) WHERE owner_id = $1', [broken?.ownerId, other?.ownerId]);
    const left = await count('SELECT count(*)::int AS n FROM owners WHERE root_envelope_v2 IS NULL');
    const from = h.logs.length;
    // Two at a time: every page is read, and the one that won't open is passed over, not read again.
    expect(await rewrapOwners(teeDeps(carried), { batch: 2 })).toEqual({ rewrapped: left - 1, failed: 1, remaining: 1 });
    const said = h.logs.slice(from).map((l) => z.object({ level: z.number(), msg: z.string() }).passthrough().parse(JSON.parse(l))).filter((l) => l.msg === 'owner not rewrapped');
    expect(said).toEqual([expect.objectContaining({ level: 40, ownerId: broken?.ownerId, err: expect.objectContaining({ message: expect.any(String) }) })]);
    expect(await count('SELECT count(*)::int AS n FROM owners WHERE root_envelope_v2 IS NULL')).toBe(1);
    await h.pool.query('DELETE FROM owners WHERE owner_id = $1', [broken?.ownerId]);
  });

  it('waits for an account being made, then refuses fresh keys and retirement', async () => {
    // Fresh keys on a database with no accounts, while the release before is making one: the check waits for it, and refuses.
    await h.pool.query('DELETE FROM owners');
    const c = await h.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO owners (owner_id, root_envelope, root_check) VALUES ($1, $2, $3)', oldAccount());
      const fresh = resolveKeys(h.pool, inside()).then(() => 'sealed', (e: unknown) => e);
      await waitingOnOwners();
      await c.query('COMMIT');
      expect(await fresh).toEqual(expect.objectContaining({ message: expect.stringMatching(/has accounts but no server keys/) }));
      expect(await count("SELECT count(*)::int AS n FROM server_keys WHERE id = 'bundle'")).toBe(0);
    } finally { c.release(); }

    // Retiring the old master, while the release before makes an account under it alone: the count waits for it, and refuses.
    await h.pool.query('DELETE FROM server_keys');
    const carried = await resolveKeys(h.pool, inside({ legacy: legacy() }));
    expect((await rewrapOwners(teeDeps(carried))).remaining).toBe(0);
    const d = await h.pool.connect();
    try {
      await d.query('BEGIN');
      await d.query('INSERT INTO owners (owner_id, root_envelope, root_check) VALUES ($1, $2, $3)', oldAccount());
      const retiring = resolveKeys(h.pool, inside({ retire: true })).then(() => 'retired', (e: unknown) => e);
      await waitingOnOwners();
      await d.query('COMMIT');
      expect(await retiring).toEqual(expect.objectContaining({ message: expect.stringMatching(/still/) }));
      expect((await resolveKeys(h.pool, inside({ legacy: legacy() }))).LEGACY_KMASTER).toBe(h.deps.cfg.KMASTER);
    } finally { d.release(); }
  });

  it('retires the old master only once every account has moved', async () => {
    const late = await someone();
    const carried = await resolveKeys(h.pool, inside({ legacy: legacy() }));
    const inTheTee = teeDeps(carried);
    expect((await rewrapOwners(inTheTee)).remaining).toBe(0);
    // An account the release before made after that, and nobody has opened since.
    await h.pool.query('UPDATE owners SET root_envelope_v2 = NULL WHERE owner_id = $1', [late.ownerId]);
    await expect(resolveKeys(h.pool, inside({ retire: true }))).rejects.toThrow(/still/);
    expect((await resolveKeys(h.pool, inside({ legacy: legacy() }))).LEGACY_KMASTER).toBe(h.deps.cfg.KMASTER);
    expect(await rewrapOwners(inTheTee)).toEqual({ rewrapped: 1, failed: 0, remaining: 0 });
    expect((await resolveKeys(h.pool, inside({ retire: true }))).LEGACY_KMASTER).toBeUndefined();
    // Retired for good: started again it holds no old master, and won't take the old keys back.
    expect((await resolveKeys(h.pool, inside())).LEGACY_KMASTER).toBeUndefined();
    await expect(resolveKeys(h.pool, inside({ legacy: legacy() }))).rejects.toThrow(/retired/);

    const server = await inTee();
    try {
      // An account made now has only the master's envelope, and signs in again.
      const cat = person('cat');
      const made = browserAt(() => server.baseUrl);
      expect(await viaGoogle(made, cat)).toBe('/ready');
      const ownerId = (await made.api.auth.getSession())?.ownerId;
      expect(await envelopes(ownerId)).toEqual({ old: false, now: true });
      const again = browserAt(() => server.baseUrl);
      expect(await viaGoogle(again, cat)).toBe('/home');
      expect((await again.api.auth.getSession())?.ownerId).toBe(ownerId);
      await again.api.account.delete();
      // Should the release before still make an account now, it can't be opened here: refused, not a failure.
      await h.pool.query('UPDATE owners SET root_envelope_v2 = NULL WHERE owner_id = $1', [late.ownerId]);
      expect(code(await browserAt(() => server.baseUrl).api.auth.signIn('sso', { email: late.email }).catch((e: unknown) => e))).toBe('key-unavailable');
    } finally {
      await server.close();
    }
  });

  it('a sign-in begun before the switch fails cleanly', async () => {
    const dee = person('dee');
    const server = await inTee(legacy());
    try {
      let at = h.baseUrl;
      const b = browserAt(() => at);
      h.google.next(dee);
      // Begun on the release before: the attempt the browser carries to Google is sealed under the old master...
      const away = await b.fetch(b.api.auth.signInUrl('google'), { redirect: 'manual' });
      const back = await fetch(away.headers.get('location') ?? '', { redirect: 'manual' });
      // ...and Google sends the browser back once the TEE is serving.
      at = server.baseUrl;
      const from = h.logs.length;
      const end = await b.fetch(back.headers.get('location') ?? '', { redirect: 'manual' });
      // Not a failure: the welcome page says the sign-in took too long, to try again, and nobody is signed in.
      expect(end.status).toBe(302);
      expect(end.headers.get('location')).toBe(`${ORIGIN}/welcome?signin=expired`);
      expect(await b.api.auth.getSession()).toBeNull();
      const said = h.logs.slice(from).map((l) => z.object({ level: z.number(), msg: z.string() }).passthrough().parse(JSON.parse(l)));
      expect(said.filter((l) => l.level >= 50)).toEqual([]);
      expect(said.map((l) => l.msg)).toContain('google sign-in attempt cookie rejected');
      // Trying again signs them in.
      expect(await viaGoogle(b, dee)).toBe('/ready');
      expect(await b.api.auth.getSession()).not.toBeNull();
    } finally {
      await server.close();
    }
  });
});
