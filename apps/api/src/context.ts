import type pg from 'pg';
import type { Config } from './config';
import type { ObjectStore } from './objects';
import type { Session } from './sessions';

export interface Deps {
  cfg: Config;
  pool: pg.Pool;
  objects: ObjectStore;
}
/** Everything an owner-scoped handler needs: the account and its keys, opened for this request. */
export interface Owner extends Deps {
  ownerId: string;
  /** The browser session behind the request, if there is one. */
  session: Session | undefined;
  /** This request's own copies of the account keys. */
  root: Uint8Array;
  wrapKey: Uint8Array;
}
