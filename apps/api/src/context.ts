import type pg from 'pg';
import type { Config } from './config';
import type { ObjectStore } from './objects';
import type { OwnerSession, SessionStore } from './sessions';

export interface Deps {
  cfg: Config;
  pool: pg.Pool;
  objects: ObjectStore;
  sessions: SessionStore;
}
/** Everything an owner-scoped handler needs. Only exists while the owner is unlocked. */
export interface Owner extends Deps {
  session: OwnerSession;
  ownerId: string;
  /**
   * Per-request copies of the session keys. Locking zeroes the session's own arrays; a request
   * already in flight keeps working with its copies instead of sealing under zeros.
   */
  root: Uint8Array;
  wrapKey: Uint8Array;
}
