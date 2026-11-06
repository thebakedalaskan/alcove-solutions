/*
 * Account keys (docs: privacy-keys-and-sessions › Key inventory). Each account has a random root
 * key, stored only wrapped under the server's master key. A request opens it, checks it against
 * the account's root check, and works with its own copies.
 */
import { z } from 'zod';
import type { Deps, Owner } from './context';
import { b64u, equalBytes, openKey, ownerRootWrapKey, ownerWrapKey, random, rootCheck, sealKey, unb64u } from './crypto';
import { bytea, exec, maybeOne, type Db } from './db';
import { AuthError, IntegrityError } from './errors';
import type { Session } from './sessions';

const ROOT_SCOPE = 'owner-root';
export const masterKey = (d: Deps) => unb64u(d.cfg.KMASTER, 32);

/** Creates an owner with a fresh root key, in the caller's transaction: an account, or a workspace (features/workspaces/service.ts). */
export async function createOwner(d: Deps, db: Db): Promise<{ ownerId: string; root: Uint8Array }> {
  const ownerId = b64u(random(32));
  const root = random(32);
  const envelope = sealKey(ownerRootWrapKey(masterKey(d), ownerId), ownerId, ROOT_SCOPE, root);
  await exec(db, 'INSERT INTO owners (owner_id, root_envelope, root_check) VALUES ($1,$2,$3)', [ownerId, envelope, rootCheck(root, ownerId)]);
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

const KeyRow = z.object({ root_envelope: bytea, root_check: bytea });
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
  const r = await maybeOne(db, KeyRow, 'SELECT root_envelope, root_check FROM owners WHERE owner_id = $1', [ownerId]);
  if (!r) return undefined;
  const root = openKey(ownerRootWrapKey(masterKey(d), ownerId), ownerId, ROOT_SCOPE, r.root_envelope);
  if (!equalBytes(r.root_check, rootCheck(root, ownerId))) {
    root.fill(0);
    throw new IntegrityError('This account’s key doesn’t match its check.', { context: { ownerId } });
  }
  return ownerFrom(d, ownerId, root, session);
}
