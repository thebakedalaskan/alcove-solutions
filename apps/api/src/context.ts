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
  wrapKey: Uint8Array;
}
