/*
 * How API instances hear each other (docs: Data and storage › Live traffic). Anything that changes a workspace says so
 * with `publish`, in its own transaction, so the notice goes out when the change commits and not if it rolls back. Each
 * instance runs one hub with one LISTEN connection of its own (never from the pool, whose connections come and go), and
 * hands every notice to whoever subscribed to that workspace here, its own notices included: one path, whichever
 * instance made the change.
 *
 * A notice is a workspace's ID and a short text. It carries IDs or something sealed and never anything readable, because
 * Postgres keeps it in the clear for as long as it takes to deliver.
 *
 * A connection can go quiet without closing, and LISTEN alone would never know: nothing is expected on it. So the hub asks
 * it something on a clock, and treats one that doesn't answer as gone.
 */
import pg from 'pg';
import { exec, type Db } from '../db';
import { InternalError, UnavailableError } from '../errors';
import { log } from '../log';

const hlog = log.child({ component: 'hub' });
const CHANNEL = 'alcove_workspace';
/** Postgres refuses a notice of 8000 bytes or more. */
const MAX_NOTICE = 7900;
const FIRST_WAIT_MS = 250;
const LONGEST_WAIT_MS = 5_000;
/** How long letting go of a connection can take: one that's gone quiet never says goodbye. */
const LET_GO_MS = 1_000;
/** How often the hub checks its connection is alive, and how long that connection has to answer. */
export interface HubTiming { checkMs: number; timeoutMs: number }
const after = <T>(ms: number, value: T): { done: Promise<T>; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return { done: new Promise<T>((resolve) => { timer = setTimeout(() => resolve(value), ms); }), cancel: () => clearTimeout(timer) };
};

/** Tells every instance, this one too, once `db`'s transaction commits (at once outside a transaction). */
export async function publish(db: Db, workspaceId: string, notice: string): Promise<void> {
  const payload = `${workspaceId}:${notice}`;
  if (payload.length > MAX_NOTICE) throw new InternalError(undefined, { context: { workspaceId, bytes: payload.length } });
  await exec(db, 'SELECT pg_notify($1, $2)', [CHANNEL, payload]);
}

/**
 * What a subscriber hears. `notice`: someone published this for the workspace. `missed`: the hub lost its connection and
 * has it back, so notices may have gone unheard: read everything again. `closing`: this instance is shutting down: end
 * the stream, without saying anyone lost anything, so the browser opens it again elsewhere.
 */
export type HubEvent = { kind: 'notice'; notice: string } | { kind: 'missed' } | { kind: 'closing' };
export type HubListener = (e: HubEvent) => void;

/** What a live stream is of. Each kind has its own limit, and one person's streams of each are counted here on each instance. */
export type StreamKind = 'workspace' | 'document';
const STREAM_LIMITS: Record<StreamKind, number> = { workspace: 8, document: 8 };

export interface Hub {
  /**
   * Hears a workspace's notices until the function it resolves with is called. It resolves once the hub is listening, so
   * anything read after that can't miss a change: a stream subscribes first and reads second.
   */
  subscribe(workspaceId: string, listener: HubListener): Promise<() => void>;
  /**
   * Takes one of `who`'s places for a stream of this kind, or refuses with `unavailable`. Refused rather than closing their
   * oldest: a stream at work is never taken from them, and refusing costs nothing, which matters to anyone opening streams to
   * run an instance out of memory. A browser refused like this tries again on its own, and gets in when one closes. The
   * function it returns gives the place back, once, however often it's called.
   */
  admit(kind: StreamKind, who: string): () => void;
  /** Tells every subscriber it's `closing`, then lets go of the connection. Nobody can subscribe after. */
  close(): Promise<void>;
}

class ListeningHub implements Hub {
  private readonly listeners = new Map<string, Set<HubListener>>();
  private readonly streams = new Map<string, number>();
  private client: pg.Client | null = null;
  /** The connection being made, which everyone subscribing meanwhile waits for. */
  private connecting: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private health: ReturnType<typeof setInterval> | null = null;
  private wait = FIRST_WAIT_MS;
  private closed = false;

  constructor(private readonly databaseUrl: string, private readonly timing: HubTiming) {}

  async subscribe(workspaceId: string, listener: HubListener): Promise<() => void> {
    await this.listening();
    if (this.closed) throw new UnavailableError('This server is shutting down. Try again.');
    const here = this.listeners.get(workspaceId) ?? new Set<HubListener>();
    this.listeners.set(workspaceId, here);
    here.add(listener);
    return () => {
      here.delete(listener);
      if (!here.size && this.listeners.get(workspaceId) === here) this.listeners.delete(workspaceId);
    };
  }

  admit(kind: StreamKind, who: string): () => void {
    const key = `${kind}:${who}`;
    const open = this.streams.get(key) ?? 0;
    if (open >= STREAM_LIMITS[kind]) throw new UnavailableError('You have this open in too many windows. Close one and it will carry on here.', { context: { kind, open } });
    this.streams.set(key, open + 1);
    let holding = true;
    return () => {
      if (!holding) return;
      holding = false;
      const left = (this.streams.get(key) ?? 1) - 1;
      if (left) this.streams.set(key, left);
      else this.streams.delete(key);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.watch(null);
    this.tellEveryone({ kind: 'closing' });
    this.listeners.clear();
    await this.connecting?.catch(() => undefined);
    const c = this.client;
    this.client = null;
    if (!c) return;
    const limit = after(LET_GO_MS, undefined);
    await Promise.race([c.end().catch((e: unknown) => hlog.info('connection closed with an error', { err: e })), limit.done]);
    limit.cancel();
    c.connection.stream.destroy();
  }

  private listening(): Promise<void> {
    if (this.closed) return Promise.reject(new UnavailableError('This server is shutting down. Try again.'));
    if (this.client) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.databaseUrl, application_name: 'alcove-hub', keepAlive: true });
    client.on('notification', (m) => this.heard(m.payload));
    client.on('error', (e) => this.lost(client, e));
    client.on('end', () => this.lost(client, undefined));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (e) {
      await client.end().catch(() => undefined);
      throw e;
    }
    if (this.closed) { await client.end().catch(() => undefined); return; }
    this.client = client;
    this.wait = FIRST_WAIT_MS;
    this.watch(client);
    hlog.info('listening');
  }

  /** Checks this connection on a clock, instead of whichever one it was checking. */
  private watch(client: pg.Client | null): void {
    if (this.health) clearInterval(this.health);
    this.health = null;
    if (!client) return;
    let checking = false;
    this.health = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.check(client).finally(() => { checking = false; });
    }, this.timing.checkMs);
    this.health.unref();
  }
  private async check(client: pg.Client): Promise<void> {
    const limit = after(this.timing.timeoutMs, 'quiet');
    const answer = await Promise.race([client.query('SELECT 1').then(() => 'alive', () => 'failed'), limit.done]);
    limit.cancel();
    if (answer !== 'alive') this.lost(client, new UnavailableError('The hub’s connection stopped answering.', { context: { answer } }));
  }

  private heard(payload: string | undefined): void {
    const at = payload?.indexOf(':') ?? -1;
    if (payload === undefined || at < 0) return;
    const here = this.listeners.get(payload.slice(0, at));
    if (here) this.tell(here, { kind: 'notice', notice: payload.slice(at + 1) });
  }

  /** The connection went. Only the one in use matters: a connection given up on, or let go of, reports going too. */
  private lost(client: pg.Client, e: unknown): void {
    if (this.client !== client) return;
    this.client = null;
    this.watch(null);
    // Not end(): that waits for a goodbye a connection gone quiet will never send.
    client.connection.stream.destroy();
    hlog.warn('lost its connection to the database', { subscribed: this.listeners.size, err: e });
    this.reconnect();
  }

  /** While anyone's subscribed: anyone later connects by subscribing. Everyone hears `missed` once it's back. */
  private reconnect(): void {
    if (this.closed || this.retry || !this.listeners.size) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.listening().then(() => this.tellEveryone({ kind: 'missed' }), (e: unknown) => {
        hlog.warn('can’t listen yet', { waitMs: this.wait, err: e });
        this.wait = Math.min(this.wait * 2, LONGEST_WAIT_MS);
        this.reconnect();
      });
    }, this.wait);
    this.retry.unref();
  }

  private tellEveryone(e: HubEvent): void {
    for (const here of this.listeners.values()) this.tell(here, e);
  }
  private tell(here: Set<HubListener>, e: HubEvent): void {
    for (const listener of [...here]) {
      try {
        listener(e);
      } catch (err) {
        hlog.error('a subscriber failed', { kind: e.kind, err });
      }
    }
  }
}

/** This instance's hub. It connects when someone first subscribes, so an instance nobody streams from holds no connection. */
export const createHub = (databaseUrl: string, timing: HubTiming): Hub => new ListeningHub(databaseUrl, timing);
