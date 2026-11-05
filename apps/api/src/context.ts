import type pg from 'pg';
import type { Config } from './config';
import type { DocPool } from './live/docPool';
import type { Hub } from './live/hub';
import type { LiveKit } from './livekit';
import type { ObjectStore } from './objects';
import type { Session } from './sessions';

export interface Deps {
  cfg: Config;
  pool: pg.Pool;
  objects: ObjectStore;
  livekit: LiveKit;
  /** This instance's end of what API instances tell each other. */
  hub: Hub;
  /** The workers that open documents, so nothing in one can stop the event loop. */
  docs: DocPool;
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
