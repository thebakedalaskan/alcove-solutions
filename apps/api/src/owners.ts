/*
 * Account keys (docs: privacy-keys-and-sessions › Key inventory). Each account has a random root
 * key, stored only wrapped under the server's master key. A request opens it, checks it against
 * the account's root check, and works with its own copies.
 *
 * Inside the TEE the master is the TEE's own, and wraps root_envelope_v2. Accounts made before it have only
 * root_envelope, under the master from before (serverKeys.ts): while that old master is held, opening one wraps its
 * root again under the master now, and new accounts get both envelopes, so the release before still opens them. Outside a
 * TEE, KMASTER is that master from before, and root keys are wrapped and opened in root_envelope alone, as the release
 * before the TEE does, so nothing a TEE couldn't open is ever written there.
 */
import { z } from 'zod';
import type { Deps, Owner } from './context';
import { b64u, equalBytes, openKey, ownerRootWrapKey, ownerWrapKey, random, rootCheck, sealKey, unb64u, type KeyVersion } from './crypto';
import { bytea, exec, maybeOne, type Db } from './db';
import { AuthError, IntegrityError } from './errors';
import { log } from './log';
import type { Session } from './sessions';

const olog = log.child({ component: 'owners' });
const ROOT_SCOPE = 'owner-root';
/** The master key now: inside a TEE, the TEE's own, which wraps root_envelope_v2; outside one, KMASTER. */
export const masterKey = (d: Pick<Deps, 'cfg'>): Uint8Array => unb64u(d.cfg.KMASTER, 32);
/** The key the blind indexes are keyed by. */
export const indexKey = (d: Pick<Deps, 'cfg'>): Uint8Array => unb64u(d.cfg.INDEX_KEY, 32);
/** The master from before the TEE, while one is held: it wraps root_envelope. Outside a TEE it's KMASTER itself. */
export const legacyMasterKey = (d: Pick<Deps, 'cfg'>): Uint8Array | undefined => (d.cfg.LEGACY_KMASTER === undefined ? undefined : unb64u(d.cfg.LEGACY_KMASTER, 32));
/** The master root_envelope_v2 is wrapped under: only inside a TEE. */
const teeMaster = (d: Pick<Deps, 'cfg'>): Uint8Array | undefined => (d.cfg.TEE === 'none' ? undefined : masterKey(d));

/** An account's root key, wrapped under a master: keyVersion 2 under the master now, 1 under the one from before the TEE. */
export function sealRoot(master: Uint8Array, ownerId: string, root: Uint8Array, keyVersion: KeyVersion): Uint8Array {
  const wrap = ownerRootWrapKey(master, ownerId);
  try { return sealKey(wrap, ownerId, ROOT_SCOPE, root, keyVersion); } finally { wrap.fill(0); }
}
/** Opens an account's root key and checks it against the account's root check, so a wrong key never opens an empty vault. */
export function openRoot(master: Uint8Array, ownerId: string, envelope: Uint8Array, keyVersion: KeyVersion, check: Uint8Array): Uint8Array {
  const wrap = ownerRootWrapKey(master, ownerId);
  let root: Uint8Array;
  try { root = openKey(wrap, ownerId, ROOT_SCOPE, envelope, keyVersion); } finally { wrap.fill(0); }
  if (!equalBytes(check, rootCheck(root, ownerId))) {
    root.fill(0);
    throw new IntegrityError('This account’s key doesn’t match its check.', { context: { ownerId, keyVersion } });
  }
  return root;
}

/**
 * Creates an owner with a fresh root key, in the caller's transaction: an account, or a workspace (features/workspaces/service.ts).
 * Inside a TEE its root is wrapped under the master now, and under the old master too while one is held; outside one, under
 * KMASTER in the old envelope alone.
 */
export async function createOwner(d: Deps, db: Db): Promise<{ ownerId: string; root: Uint8Array }> {
  const ownerId = b64u(random(32));
  const root = random(32);
  const now = teeMaster(d);
  const old = legacyMasterKey(d);
  if (!now && !old) throw new IntegrityError('Nothing here can wrap an account’s key.', { context: { tee: d.cfg.TEE } });
  await exec(db, 'INSERT INTO owners (owner_id, root_envelope_v2, root_envelope, root_check) VALUES ($1,$2,$3,$4)',
    [ownerId, now ? sealRoot(now, ownerId, root, '2') : null, old ? sealRoot(old, ownerId, root, '1') : null, rootCheck(root, ownerId)]);
  return { ownerId, root };
}

export function ownerFrom(d: Deps, ownerId: string, root: Uint8Array, session: Session | undefined): Owner {
  return { ...d, ownerId, session, root, wrapKey: ownerWrapKey(root, ownerId) };
}

/**
 * Holds the account's row for the rest of the transaction, so work of the account's that must not
 * interleave takes turns. NO KEY UPDATE: rows that refer to the account can still be written meanwhile.
 */
export async function lockOwner(o: Owner, db: Db): Promise<void> {
  await exec(db, 'SELECT 1 FROM owners WHERE owner_id = $1 FOR NO KEY UPDATE', [o.ownerId]);
}

/** Owners this instance is wrapping again now, so an account opened by many requests at once is written once. */
const rewrapping = new Set<string>();
/**
 * Wraps a root opened from the old envelope again under the master now, in place of `replacing` (none, or one the master
 * doesn't open). Apart from the request, on a connection of its own: the request may hold the account's row in its
 * transaction, and nothing it does waits for this. Losing the race to another instance, or to the bulk rewrap
 * (serverKeys.ts), changes nothing.
 */
function rewrapLater(d: Pick<Deps, 'cfg' | 'pool'>, master: Uint8Array, ownerId: string, root: Uint8Array, replacing: Uint8Array | null): void {
  if (rewrapping.has(ownerId)) return;
  rewrapping.add(ownerId);
  const envelope = sealRoot(master, ownerId, root, '2');
  void exec(d.pool, 'UPDATE owners SET root_envelope_v2 = $2 WHERE owner_id = $1 AND root_envelope_v2 IS NOT DISTINCT FROM $3', [ownerId, envelope, replacing])
    .then((n) => { if (n) olog.debug('owner rewrapped', { ownerId, replaced: replacing !== null }); })
    .catch((e: unknown) => olog.warn('owner not rewrapped', { ownerId, err: e }))
    .finally(() => rewrapping.delete(ownerId));
}

const KeyRow = z.object({ root_envelope_v2: bytea.nullable(), root_envelope: bytea.nullable(), root_check: bytea });
/** Opens an account's keys for one request (or one piece of background work). */
export async function openOwner(d: Deps, ownerId: string, session: Session | undefined, db: Db = d.pool): Promise<Owner> {
  const o = await findOwner(d, ownerId, session, db);
  if (!o) throw new AuthError('That account no longer exists. Sign in again.', { context: { ownerId } });
  return o;
}
/**
 * Opens an account's keys, or nothing once the account has been deleted. For reaching someone else's
 * vault, where their account being gone isn't the caller's sign-in ending.
 */
export async function findOwner(d: Deps, ownerId: string, session: Session | undefined, db: Db = d.pool): Promise<Owner | undefined> {
  const root = await openRootKey(d, ownerId, db);
  return root && ownerFrom(d, ownerId, root, session);
}
/**
 * An owner's root key alone, opened and checked against its root check, or nothing once it's been deleted: for work that
 * needs only a key derived from it (a team's, features/billing/teams.ts), even where there's no request. The caller zeroes it.
 *
 * Inside a TEE, the new envelope under the master; when there's none, or it doesn't open (wrapped under a master that isn't
 * this one), the old envelope under the old master while it's held, which is then wrapped again under the master.
 */
export async function openRootKey(d: Pick<Deps, 'cfg' | 'pool'>, ownerId: string, db: Db = d.pool): Promise<Uint8Array | undefined> {
  const r = await maybeOne(db, KeyRow, 'SELECT root_envelope_v2, root_envelope, root_check FROM owners WHERE owner_id = $1', [ownerId]);
  if (!r) return undefined;
  const now = teeMaster(d);
  const old = legacyMasterKey(d);
  if (now && r.root_envelope_v2) {
    try {
      return openRoot(now, ownerId, r.root_envelope_v2, '2', r.root_check);
    } catch (e) {
      if (!old || !r.root_envelope) throw e;
      // Wrapped under another master, as a master made again over accounts leaves them: the old envelope still opens.
      olog.warn('owner opened under the old master: its new envelope is under another', { ownerId, err: e });
    }
  }
  if (!r.root_envelope || !old) throw new IntegrityError('This account’s key can’t be opened here.', { context: { ownerId, oldEnvelope: !!r.root_envelope, oldMaster: !!old } });
  const root = openRoot(old, ownerId, r.root_envelope, '1', r.root_check);
  // Sealed again under the master now before this returns, so the caller zeroing the root later changes nothing of it.
  if (now) rewrapLater(d, now, ownerId, root, r.root_envelope_v2);
  return root;
}
