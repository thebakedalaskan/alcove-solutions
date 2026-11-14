/*
 * The server's keys, and carrying a database's accounts into the TEE (docs: privacy-keys-and-sessions › Moving to
 * confidential computing). Inside the TEE (Google Cloud Confidential Space) the master is 32 random bytes made there the first
 * time it starts on a database, wrapped by Cloud KMS for attested builds only (a KeyWrapper), and kept wrapped in server_keys
 * (row `master`). It isn't the KMASTER the database's accounts were made under, so what else the server needs is one record
 * of kind `server-keys`, sealed under the master (row `bundle`): the keys of what's stored under the old master that the TEE
 * still reads (the blind indexes and photo tokens), KSERVICE, and the old master until it's retired. Every instance unwraps
 * the same master and opens the same bundle; nothing Cloud KMS won't unwrap the master for can.
 *
 * The old master is used only while the TEE is started with it (LEGACY_SECRETS, which its attestation shows): then accounts
 * whose root key the master doesn't open yet are opened under it and wrapped again, lazily as they're opened (owners.ts) and
 * all of them by `rewrapOwners`, which the server starts once it listens, and new accounts get an envelope under it too, so
 * the release before still opens them. Started without it, the TEE uses none, whatever the bundle carries.
 *
 * Outside a TEE there's nothing to carry: KMASTER and KSERVICE come from the environment, and KMASTER is the master from
 * before the TEE, which wraps root_envelope alone.
 */
import type pg from 'pg';
import { z } from 'zod';
import type { Config } from '../platform/config';
import type { Deps } from '../platform/context';
import { b64u, deriveIndexKey, equalBytes, fromUtf8, openRecord, photoTokenKey, random, sealJson, serverKeysKey, unb64u } from './crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../platform/db';
import { ConflictError, IntegrityError, InternalError, KeyError } from '../platform/errors';
import { log } from '../platform/log';
import { legacyMasterKey, masterKey, openRoot, sealRoot } from './owners';

const klog = log.child({ component: 'server-keys' });

/** Wraps and unwraps the master: Cloud KMS, under a key only attested builds may use. Ciphertext in, ciphertext out, as it stores it. */
export interface KeyWrapper {
  /** Which key it wraps under, as what it refuses names it: the Cloud KMS key's resource name. */
  readonly key: string;
  wrap(plaintext: Uint8Array): Promise<Uint8Array>;
  unwrap(ciphertext: Uint8Array): Promise<Uint8Array>;
}
/** The KMASTER and KSERVICE a database's accounts were made under before the TEE, each base64url of 32 bytes. */
export interface LegacyKeys { kmaster: string; kservice: string }
/**
 * Whether a KSERVICE opens one account's accounting as it's stored: its plan (`plan-account`), or its credits from before plans
 * (`billing`). How those are sealed is billing's to say (features/billing/plans.ts › opensAccounting), so whoever starts the
 * server hands it in, and carrying the old keys over checks them with it.
 */
export type OpensAccounting = (kservice: Uint8Array, kind: 'plan-account' | 'billing', ownerId: string, stateCiphertext: Uint8Array) => boolean;
/**
 * Where the keys come from. Outside a TEE: the environment's. Inside one: the master as Cloud KMS unwraps it (`wrapper`), and
 * the server keys sealed under it, carried over from the old keys the TEE was started with (`legacy`, read from Secret Manager
 * as LEGACY_SECRETS names them, and checked with `opensAccounting`), or forgetting the old master for good (`retire`).
 */
export type KeySource =
  | { tee: 'none'; kmaster: string; kservice: string }
  | { tee: 'confidential-space'; wrapper: KeyWrapper; legacy: LegacyKeys | undefined; retire: boolean; opensAccounting: OpensAccounting };
/** The keys the server runs with. */
export type Keys = Pick<Config, 'KMASTER' | 'KSERVICE' | 'INDEX_KEY' | 'PHOTO_KEY' | 'LEGACY_KMASTER'>;

const Key = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const Legacy = z.object({ kmaster: Key, kservice: Key });
/**
 * The bundle's body: the keys of what's stored under the master from before the TEE that the TEE keeps reading (the blind
 * indexes, and the photo tokens notes keep), KSERVICE, and the old master, which is null once it's retired, or if there never
 * was one.
 */
const Bundle = z.object({ indexKey: Key, photoKey: Key, kservice: Key, legacyKmaster: Key.nullable() });
type Bundle = z.infer<typeof Bundle>;
const HEADER = { v: 1 as const, kind: 'server-keys', ownerId: '', id: 'bundle' };
/** How many accounts the old master has to open, and how many billing accounts KSERVICE, before they're believed. */
const CHECKED = 5;

const same = (a: string, b: string) => equalBytes(unb64u(a, 32), unb64u(b, 32));
const StoredRecord = z.object({ record: bytea });
const row = async (db: Db, id: 'master' | 'bundle') => (await maybeOne(db, StoredRecord, 'SELECT record FROM server_keys WHERE id = $1', [id]))?.record;
/** Keys derived from a master, base64url. */
const fromMaster = (master: Uint8Array, derive: (m: Uint8Array) => Uint8Array) => { const k = derive(master); try { return b64u(k); } finally { k.fill(0); } };

/**
 * The master: unwrapped from what's stored, or, the first time the TEE starts on a database, made here, wrapped and stored
 * first. Instances starting at once may each make one; whichever is stored first is the master, and each unwraps that.
 * A new master is never made where it would leave an account no key here opens: beside server keys sealed under another, or
 * over accounts wrapped under another, unless every one of those also has its old envelope and the old master is here to
 * open it (`carrying`), so each is opened that way and wrapped again (owners.ts, `rewrapOwners`).
 */
async function masterOf(pool: pg.Pool, wrapper: KeyWrapper, carrying: boolean): Promise<Uint8Array> {
  let wrapped = await row(pool, 'master');
  if (!wrapped) {
    // Server keys without their master can't be opened by a new one: making it would only bury the one they need.
    if (await row(pool, 'bundle')) throw new KeyError('The server keys are here, but their master isn’t: restore server_keys row master.');
    const before = await maybeOne(pool, z.object({ wrapped: z.number(), only: z.number() }),
      'SELECT count(*) FILTER (WHERE root_envelope_v2 IS NOT NULL)::int AS wrapped, count(*) FILTER (WHERE root_envelope_v2 IS NOT NULL AND root_envelope IS NULL)::int AS only FROM owners');
    if (before && before.wrapped > 0) {
      if (!carrying || before.only > 0) {
        throw new KeyError('Accounts here are wrapped under a master that isn’t here: restore server_keys row master. A new one would never open them.', { context: before });
      }
      klog.warn('a new master over accounts wrapped under another; each opens under the old master and is wrapped again', { accounts: before.wrapped });
    }
    const made = random(32);
    let ciphertext: Uint8Array;
    try { ciphertext = await wrapper.wrap(made); } catch (e) {
      throw new KeyError(`A new master couldn’t be wrapped with ${wrapper.key}: Cloud KMS refused this build.`, { cause: e, context: { key: wrapper.key } });
    } finally { made.fill(0); }
    const inserted = await exec(pool, "INSERT INTO server_keys (id, record) VALUES ('master', $1) ON CONFLICT (id) DO NOTHING", [ciphertext]);
    klog.info(inserted ? 'master made' : 'master made by another instance');
    wrapped = await row(pool, 'master');
    if (!wrapped) throw new InternalError('The master was stored, but isn’t there.');
  }
  return unwrapped(wrapper, wrapped);
}

/** The master, as Cloud KMS unwraps what's stored. */
async function unwrapped(wrapper: KeyWrapper, wrapped: Uint8Array): Promise<Uint8Array> {
  let master: Uint8Array;
  // A copy of its own: pg hands back a Buffer, which can be a view into memory it shares.
  try { master = await wrapper.unwrap(new Uint8Array(wrapped)); } catch (e) {
    throw new KeyError(`The master here doesn’t unwrap with ${wrapper.key}: Cloud KMS refused this build, or it was wrapped with another key.`, { cause: e, context: { key: wrapper.key } });
  }
  if (master.length !== 32) throw new IntegrityError('The master here isn’t 32 bytes.', { context: { bytes: master.length } });
  return master;
}

function seal(master: Uint8Array, bundle: Bundle): Uint8Array {
  const key = serverKeysKey(master);
  try { return sealJson(key, HEADER, bundle); } finally { key.fill(0); }
}
function open(master: Uint8Array, record: Uint8Array): Bundle {
  const key = serverKeysKey(master);
  let body: Uint8Array;
  try {
    body = openRecord(key, HEADER, record);
  } catch (e) {
    throw new KeyError('These server keys weren’t sealed under this master: they don’t open here.', { cause: e });
  } finally {
    key.fill(0);
  }
  const bundle = Bundle.safeParse(JSON.parse(fromUtf8(body)));
  body.fill(0);
  if (!bundle.success) throw new IntegrityError('The server keys don’t read as server keys.', { context: { issues: bundle.error.issues.length } });
  return bundle.data;
}
const stored = async (db: Db, master: Uint8Array): Promise<Bundle | undefined> => {
  const record = await row(db, 'bundle');
  return record ? open(master, record) : undefined;
};

/**
 * The old keys open what the database has under them, else carrying them over would lock everyone out: the old master
 * opens accounts' root keys, root checks and all, and KSERVICE their billing: their plans, and their credits from before plans.
 */
async function believe(db: Db, legacy: LegacyKeys, opensAccounting: OpensAccounting): Promise<void> {
  const owners = await rows(db, z.object({ owner_id: z.string(), root_envelope: bytea, root_check: bytea }),
    'SELECT owner_id, root_envelope, root_check FROM owners WHERE root_envelope IS NOT NULL ORDER BY owner_id LIMIT $1', [CHECKED]);
  const kmaster = unb64u(legacy.kmaster, 32);
  let failed = 0;
  for (const r of owners) {
    try { openRoot(kmaster, r.owner_id, r.root_envelope, '1', r.root_check).fill(0); } catch { failed++; }
  }
  kmaster.fill(0);
  if (failed) throw new KeyError('The old KMASTER doesn’t open this database’s accounts.', { context: { checked: owners.length, failed } });
  // Accounts' plans, and their credits from before plans, which are still stored.
  const Sealed = z.object({ owner_id: z.string(), state_ciphertext: bytea });
  const plans = await rows(db, Sealed, 'SELECT owner_id, state_ciphertext FROM plan_accounts ORDER BY owner_id LIMIT $1', [CHECKED]);
  const credits = await rows(db, Sealed, 'SELECT owner_id, state_ciphertext FROM billing_accounts ORDER BY owner_id LIMIT $1', [CHECKED]);
  const kservice = unb64u(legacy.kservice, 32);
  const unread = plans.filter((b) => !opensAccounting(kservice, 'plan-account', b.owner_id, b.state_ciphertext)).length
    + credits.filter((b) => !opensAccounting(kservice, 'billing', b.owner_id, b.state_ciphertext)).length;
  kservice.fill(0);
  const billing = plans.length + credits.length;
  if (unread) throw new KeyError('The old KSERVICE doesn’t open this database’s billing.', { context: { checked: billing, failed: unread } });
  klog.info('old keys open the accounts', { checked: owners.length, billing });
}

/**
 * Seals the first server keys there are, and returns what's stored then: another instance may have sealed them first, and
 * whatever is stored wins. Carried over from the old keys when they're given; fresh only on a database with no accounts.
 */
async function seed(pool: pg.Pool, master: Uint8Array, legacy: LegacyKeys | undefined, opensAccounting: OpensAccounting): Promise<Bundle> {
  let made: number;
  if (legacy) {
    await believe(pool, legacy, opensAccounting);
    const old = unb64u(legacy.kmaster, 32);
    const carried = { indexKey: fromMaster(old, deriveIndexKey), photoKey: fromMaster(old, photoTokenKey), kservice: legacy.kservice, legacyKmaster: legacy.kmaster };
    old.fill(0);
    made = await exec(pool, "INSERT INTO server_keys (id, record) VALUES ('bundle', $1) ON CONFLICT (id) DO NOTHING", [seal(master, carried)]);
  } else {
    const accounts = async (db: Db) => {
      if (await maybeOne(db, z.object({ one: z.number() }), 'SELECT 1 AS one FROM owners LIMIT 1')) {
        throw new KeyError('This database has accounts but no server keys: start once with the old KMASTER and KSERVICE they were made under (LEGACY_SECRETS).');
      }
    };
    await accounts(pool);
    const fresh = { indexKey: fromMaster(master, deriveIndexKey), photoKey: fromMaster(master, photoTokenKey), kservice: b64u(random(32)), legacyKmaster: null };
    made = await tx(pool, async (c) => {
      // No account can be made while this looks again, so fresh keys are never sealed over one: it could never be opened.
      await exec(c, 'LOCK TABLE owners IN SHARE MODE');
      await accounts(c);
      return exec(c, "INSERT INTO server_keys (id, record) VALUES ('bundle', $1) ON CONFLICT (id) DO NOTHING", [seal(master, fresh)]);
    });
  }
  klog.info(made ? 'server keys sealed' : 'server keys sealed by another instance', { carried: legacy !== undefined });
  const now = await stored(pool, master);
  if (!now) throw new InternalError('The server keys were sealed, but aren’t there.');
  return now;
}

const MovingRow = z.object({ owner_id: z.string(), root_envelope_v2: bytea.nullable(), root_check: bytea });
/** Whether `master` opens this envelope, root check and all. */
function opensUnder(master: Uint8Array, ownerId: string, envelope: Uint8Array, check: Uint8Array): boolean {
  try { openRoot(master, ownerId, envelope, '2', check).fill(0); return true; } catch { return false; }
}

/**
 * What forgetting the old master would leave behind, counted: accounts with both envelopes whose new one the master doesn't
 * open (`wrong`), and accounts with no new envelope yet (`left`). Refused while either is above none (`not-rewrapped`).
 */
const unopened = async (db: Db, master: Uint8Array): Promise<number> => {
  let wrong = 0;
  for (let after = ''; ;) {
    const page = await rows(db, MovingRow, `SELECT owner_id, root_envelope_v2, root_check FROM owners
      WHERE root_envelope IS NOT NULL AND root_envelope_v2 IS NOT NULL AND owner_id > $1 ORDER BY owner_id LIMIT 500`, [after]);
    for (const r of page) if (r.root_envelope_v2 && !opensUnder(master, r.owner_id, r.root_envelope_v2, r.root_check)) wrong++;
    const last = page.at(-1);
    if (!last || page.length < 500) break;
    after = last.owner_id;
  }
  return wrong;
};
const withoutNew = async (db: Db): Promise<number> =>
  (await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM owners WHERE root_envelope_v2 IS NULL'))?.n ?? 0;
const notRewrapped = {
  wrong: (wrong: number) => new ConflictError(`${wrong} accounts still have a root key only the old master opens. Start with LEGACY_SECRETS until the API logs owners rewrapped with nothing remaining, then retire it.`, { context: { wrong, reason: 'not-rewrapped' } }),
  left: (left: number) => new ConflictError(`${left} accounts still have their root key only under the old master. Start with LEGACY_SECRETS and without RETIRE_LEGACY_KMASTER until the API logs owners rewrapped with nothing remaining, then retire it.`, { context: { left, reason: 'not-rewrapped' } })
};

/**
 * Forgets the old master, for good, once no account's root key is under it alone: none has only the old envelope, and
 * every new one opens under the master (one that doesn't would be lost with it).
 */
async function retire(pool: pg.Pool, master: Uint8Array, bundle: Bundle): Promise<Bundle> {
  const wrong = await unopened(pool, master);
  if (wrong) throw notRewrapped.wrong(wrong);
  const retired = { ...bundle, legacyKmaster: null };
  await tx(pool, async (c) => {
    // No account can be made under the old master alone while this looks, so none is left behind.
    await exec(c, 'LOCK TABLE owners IN SHARE MODE');
    const left = await withoutNew(c);
    if (left > 0) throw notRewrapped.left(left);
    await exec(c, "UPDATE server_keys SET record = $1, updated_at = now() WHERE id = 'bundle'", [seal(master, retired)]);
  });
  klog.info('old master retired');
  return retired;
}

/**
 * The keys the server runs with. Outside a TEE: KMASTER and KSERVICE from the environment, and the keys derived from KMASTER,
 * which is also the old master; refused on a database a TEE has carried over. Inside one: the master Cloud KMS unwraps, and
 * the rest from the server keys sealed under it, sealed first from the old keys, or fresh on a database with no accounts.
 * The old master is held only while the old keys are given, and they must be the ones carried. Refuses whatever would leave
 * an account it can't open: old keys that don't open what's stored, accounts and no old keys, a master that won't unwrap,
 * server keys that don't open under it, old keys other than the ones carried, and retiring the old master while any
 * account's root key is under it alone.
 */
export async function resolveKeys(pool: pg.Pool, s: KeySource): Promise<Keys> {
  if (s.tee === 'none') {
    // A database a TEE has carried over: outside it, new root keys would go under the old master alone, which the TEE never opens.
    if (await maybeOne(pool, z.object({ one: z.number() }), 'SELECT 1 AS one FROM server_keys LIMIT 1')) {
      throw new KeyError('This database belongs to a TEE (it has server keys): outside one, the API would wrap root keys the TEE can’t open. Start it inside the TEE.');
    }
    const kmaster = unb64u(s.kmaster, 32);
    try {
      return { KMASTER: s.kmaster, KSERVICE: s.kservice, INDEX_KEY: fromMaster(kmaster, deriveIndexKey), PHOTO_KEY: fromMaster(kmaster, photoTokenKey), LEGACY_KMASTER: s.kmaster };
    } finally { kmaster.fill(0); }
  }
  const { wrapper, legacy, retire: retiring } = s;
  checkGiven(legacy, retiring);

  const master = await masterOf(pool, wrapper, legacy !== undefined);
  try {
    let bundle = (await stored(pool, master)) ?? (await seed(pool, master, legacy, s.opensAccounting));
    if (legacy) checkCarried(legacy, bundle);
    if (retiring && bundle.legacyKmaster !== null) bundle = await retire(pool, master, bundle);
    const keys = keysOf(master, bundle, legacy);
    klog.info('server keys opened', { oldMaster: keys.LEGACY_KMASTER !== undefined, carried: bundle.legacyKmaster !== null });
    return keys;
  } finally {
    master.fill(0);
  }
}

/** The old keys a TEE is started with, as a start takes them: each 32 bytes, and never while it retires the old master. */
function checkGiven(legacy: LegacyKeys | undefined, retiring: boolean): void {
  if (legacy && !Legacy.safeParse(legacy).success) throw new KeyError('The old KMASTER and KSERVICE must each be 32 bytes, base64url.');
  if (legacy && retiring) throw new KeyError('Retiring the old master takes the old keys away: start without LEGACY_SECRETS.');
}
/** The old keys given are the ones these server keys carry. */
function checkCarried(legacy: LegacyKeys, bundle: Bundle): void {
  if (bundle.legacyKmaster === null) throw new KeyError('These server keys carry no old master: it was retired, or this database never had one. Start without LEGACY_SECRETS.');
  if (!same(legacy.kmaster, bundle.legacyKmaster) || !same(legacy.kservice, bundle.kservice)) throw new KeyError('The old keys given aren’t the ones these server keys carry.');
}
/** The keys the server runs with: the master, the server keys sealed under it, and the old master while it's given. */
function keysOf(master: Uint8Array, bundle: Bundle, legacy: LegacyKeys | undefined): Keys {
  // The old master is the one given: one only the bundle carries, as a copy of the bundle from before it was retired would, is left alone.
  const old = legacy ? bundle.legacyKmaster ?? undefined : undefined;
  return { KMASTER: b64u(master), KSERVICE: bundle.kservice, INDEX_KEY: bundle.indexKey, PHOTO_KEY: bundle.photoKey, LEGACY_KMASTER: old };
}

/**
 * The keys as a start would resolve them, read only, for the checks job (operator-job.ts). Outside a TEE, as resolveKeys
 * does, which only reads there. Inside one: the master Cloud KMS unwraps from what's stored, the server keys opened under
 * it, and the old keys it's started with checked against them. Nothing is made, sealed, retired or written. Where a start
 * would write, on its first start on a database, this refuses, its code saying what isn't there (`no-master`,
 * `no-server-keys`). Where a start would forget the old master now (`retiring`), what it would refuse that over is counted,
 * and refused as it would be (`not-rewrapped`). `carried`: the server keys still carry the old master.
 */
export async function openKeys(pool: pg.Pool, s: KeySource): Promise<{ keys: Keys; carried: boolean; retiring: boolean }> {
  if (s.tee === 'none') return { keys: await resolveKeys(pool, s), carried: false, retiring: false };
  const { wrapper, legacy, retire: asked } = s;
  checkGiven(legacy, asked);
  const wrapped = await row(pool, 'master');
  if (!wrapped) throw new KeyError('There’s no master here: the first start on a database makes one, and this never does.', { context: { code: 'no-master' } });
  const master = await unwrapped(wrapper, wrapped);
  try {
    const bundle = await stored(pool, master);
    if (!bundle) throw new KeyError('There are no server keys here: the first start on a database seals them, and this never does.', { context: { code: 'no-server-keys' } });
    if (legacy) checkCarried(legacy, bundle);
    const retiring = asked && bundle.legacyKmaster !== null;
    if (retiring) {
      const wrong = await unopened(pool, master);
      if (wrong) throw notRewrapped.wrong(wrong);
      const left = await withoutNew(pool);
      if (left) throw notRewrapped.left(left);
    }
    return { keys: keysOf(master, bundle, legacy), carried: bundle.legacyKmaster !== null, retiring };
  } finally {
    master.fill(0);
  }
}

const OldRow = z.object({ owner_id: z.string(), root_envelope: bytea, root_envelope_v2: bytea.nullable(), root_check: bytea });

/**
 * Inside a TEE holding the old master: wraps the root key of every account the master doesn't open yet (only the old
 * envelope, or a new one that doesn't open) again under the master, in batches, in order of owner ID. Any instance may run
 * it at once as another, or as accounts are opened: an account done already is left as it is. One that won't open is
 * counted, and logged by its ID. `remaining`: accounts the master still doesn't open that the old master did.
 */
export async function rewrapOwners(d: Pick<Deps, 'cfg' | 'pool'>, opts: { batch?: number } = {}): Promise<{ rewrapped: number; failed: number; remaining: number }> {
  const legacy = legacyMasterKey(d);
  const left = async (unopened: number) => unopened + ((await maybeOne(d.pool, z.object({ n: z.number() }),
    'SELECT count(*)::int AS n FROM owners WHERE root_envelope_v2 IS NULL AND root_envelope IS NOT NULL'))?.n ?? 0);
  if (d.cfg.TEE === 'none' || !legacy) return { rewrapped: 0, failed: 0, remaining: await left(0) };
  const master = masterKey(d);
  const batch = opts.batch ?? 200;
  let rewrapped = 0;
  let failed = 0;
  // Accounts with a new envelope the master doesn't open, and that couldn't be wrapped again: still the old master's.
  let unopened = 0;
  let after = '';
  try {
    for (;;) {
      const page = await rows(d.pool, OldRow, `SELECT owner_id, root_envelope, root_envelope_v2, root_check FROM owners
        WHERE root_envelope IS NOT NULL AND owner_id > $1 ORDER BY owner_id LIMIT $2`, [after, batch]);
      for (const r of page) {
        if (r.root_envelope_v2 && opensUnder(master, r.owner_id, r.root_envelope_v2, r.root_check)) continue;
        try {
          const root = openRoot(legacy, r.owner_id, r.root_envelope, '1', r.root_check);
          const envelope = sealRoot(master, r.owner_id, root, '2');
          root.fill(0);
          rewrapped += await exec(d.pool, 'UPDATE owners SET root_envelope_v2 = $2 WHERE owner_id = $1 AND root_envelope_v2 IS NOT DISTINCT FROM $3', [r.owner_id, envelope, r.root_envelope_v2]);
        } catch (e) {
          failed++;
          if (r.root_envelope_v2) unopened++;
          klog.warn('owner not rewrapped', { ownerId: r.owner_id, err: e });
        }
      }
      const last = page.at(-1);
      if (!last || page.length < batch) break;
      after = last.owner_id;
    }
  } finally {
    legacy.fill(0);
    master.fill(0);
  }
  return { rewrapped, failed, remaining: await left(unopened) };
}
