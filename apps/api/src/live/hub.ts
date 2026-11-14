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
import { exec, type Db } from '../platform/db';
import { InternalError, UnavailableError } from '../platform/errors';
import { log } from '../platform/log';

const hlog = log.child({ component: 'hub' });
const CHANNEL = 'alcove_workspace';
/** Postgres refuses a notice of 8000 bytes or more. */
const MAX_NOTICE = 7900;
const FIRST_WAIT_MS = 250;
const LONGEST_WAIT_MS = 5_000;
/** How long letting go of a connection can take: one that's gone quiet never says goodbye. */
const LET_GO_MS = 1_000;
/**
 * How often the hub checks its connection is alive, how long that connection has to answer, how many streams this instance
 * holds at most, in all and from one address, and how long one of someone's streams has been open before it can be ended to
 * make room for another of theirs, which is also how long after one has been that the next can be.
 */
export interface HubSettings { checkMs: number; timeoutMs: number; maxStreams: number; maxPerAddress: number; makeRoomAfterMs: number }
const after = <T>(ms: number, value: T): { done: Promise<T>; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return { done: new Promise<T>((resolve) => { timer = setTimeout(() => resolve(value), ms); }), cancel: () => clearTimeout(timer) };
};

/** The notice that a workspace's tree, or who can open what in it, changed: every stream of the workspace looks again. */
export const TREE_NOTICE = 'tree';

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

/** What a live stream is of. Each kind has its own limit for one person, counted here on each instance. All of them together have one for everyone. */
export type StreamKind = 'workspace' | 'document';
const STREAM_LIMITS: Record<StreamKind, number> = { workspace: 8, document: 8 };

/**
 * A stream's place among `who`'s: `release` gives it back, once, however often it's called. `ended` aborts when the stream is
 * to end though its browser may still be there: the browser said it closed it (`end`), or it was the oldest of theirs and
 * they needed the place. Its place is given back then and there.
 */
export interface StreamPlace { release: () => void; ended: AbortSignal }

export interface Hub {
  /**
   * Hears a workspace's notices until the function it resolves with is called. It resolves once the hub is listening, so
   * anything read after that can't miss a change: a stream subscribes first and reads second.
   */
  subscribe(workspaceId: string, listener: HubListener): Promise<() => void>;
  /**
   * Takes one of `who`'s places for a stream of this kind, or refuses with `unavailable`. `name`: what the browser calls it
   * (`LIVE_STREAM_HEADER`), for it to say when it closes it; null from a browser that doesn't.
   *
   * At their limit, their oldest stream of the kind ends to make room: on Cloud Run this instance never hears that a browser
   * closed a stream (HTTP/1 doesn't pass it on), so it's the one likeliest to be a tab that went. If that tab is still there,
   * it opens another at once, as when any stream ends. Room is made for each of them, for each kind, at most once every
   * `makeRoomAfterMs`, and only by a stream open that long, so that someone with more tabs open than places takes turns
   * slowly: the tab that just gave up its place is refused, and backs off, rather than ending the next oldest in turn and
   * that one the next, round and round through all of them. Refused, a browser tries again by itself, later each time.
   * Everyone's streams count towards one limit as well, because each holds a request for as long as it's open, and calls
   * need the requests left over, and so do all those from one `address`, because accounts are free, and a few of them
   * mustn't take the lot. Past those, it's refused and nothing ends.
   */
  admit(kind: StreamKind, who: string, address: string, name: string | null): StreamPlace;
  /** Ends `who`'s stream of this kind that their browser calls `name`, if this instance has it: they closed it. Nobody else's. */
  end(kind: StreamKind, who: string, name: string): boolean;
  /** Tells every subscriber it's `closing`, then lets go of the connection. Nobody can subscribe after. */
  close(): Promise<void>;
}

/** A place someone's stream holds: what its browser calls it, where it's from, when it opened, and how to end it. */
interface Held { name: string | null; address: string; since: number; ended: AbortController; released: boolean }

class ListeningHub implements Hub {
  private readonly listeners = new Map<string, Set<HubListener>>();
  /** Each person's places, by kind and person, the oldest first. */
  private readonly streams = new Map<string, Held[]>();
  /**
   * When room was last made among each person's places, by kind and person, for as long as they hold any: someone with none
   * left can't be at their limit again until a stream of theirs has been open `makeRoomAfterMs`, which is as long a wait.
   */
  private readonly madeRoom = new Map<string, number>();
  private readonly addresses = new Map<string, number>();
  private streaming = 0;
  private client: pg.Client | null = null;
  /** The connection being made, which everyone subscribing meanwhile waits for. */
  private connecting: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private health: ReturnType<typeof setInterval> | null = null;
  private wait = FIRST_WAIT_MS;
  private closed = false;

  constructor(private readonly databaseUrl: string, private readonly settings: HubSettings) {}

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

  admit(kind: StreamKind, who: string, address: string, name: string | null): StreamPlace {
    const key = `${kind}:${who}`;
    const theirs = this.streams.get(key) ?? [];
    const now = Date.now();
    const full = theirs.length >= STREAM_LIMITS[kind];
    const oldest = full ? theirs[0] : undefined;
    const lately = this.madeRoom.get(key);
    const waited = lately === undefined ? null : now - lately;
    if (full && (!oldest || now - oldest.since < this.settings.makeRoomAfterMs || (waited !== null && waited < this.settings.makeRoomAfterMs))) {
      throw new UnavailableError('You have this open in too many windows. Close one and it will carry on here.', { context: { kind, open: theirs.length, sinceRoomMs: waited } });
    }
    // What the oldest gives back counts as given back already: ending it is what makes the room.
    const fromThere = (this.addresses.get(address) ?? 0) - (oldest?.address === address ? 1 : 0);
    if (fromThere >= this.settings.maxPerAddress) throw new UnavailableError('Too much is open from this network. Close something and it will carry on here.', { context: { kind, fromThere } });
    if (this.streaming - (oldest ? 1 : 0) >= this.settings.maxStreams) throw new UnavailableError('Alcove is very busy right now. This will carry on by itself in a moment.', { context: { kind, streaming: this.streaming } });
    if (oldest) {
      this.endHeld(key, oldest);
      // Its browser, if it's still there, opens it again at once, and is refused until a while has passed.
      this.madeRoom.set(key, now);
      hlog.info('a stream ended to make room', { kind, open: theirs.length, openMs: now - oldest.since, sinceRoomMs: waited });
    }
    const held: Held = { name, address, since: now, ended: new AbortController(), released: false };
    this.streams.set(key, [...(this.streams.get(key) ?? []), held]);
    this.addresses.set(address, (this.addresses.get(address) ?? 0) + 1);
    this.streaming++;
    return { release: () => this.free(key, held), ended: held.ended.signal };
  }

  end(kind: StreamKind, who: string, name: string): boolean {
    const key = `${kind}:${who}`;
    const held = this.streams.get(key)?.find((h) => h.name === name);
    if (!held) return false;
    this.endHeld(key, held);
    return true;
  }

  /** Gives a place back now, and tells its stream to end. */
  private endHeld(key: string, held: Held): void {
    this.free(key, held);
    held.ended.abort();
  }

  private free(key: string, held: Held): void {
    if (held.released) return;
    held.released = true;
    this.streaming--;
    const left = (this.streams.get(key) ?? []).filter((h) => h !== held);
    if (left.length) this.streams.set(key, left);
    else { this.streams.delete(key); this.madeRoom.delete(key); }
    const there = (this.addresses.get(held.address) ?? 1) - 1;
    if (there) this.addresses.set(held.address, there);
    else this.addresses.delete(held.address);
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
    }, this.settings.checkMs);
    this.health.unref();
  }
  private async check(client: pg.Client): Promise<void> {
    const limit = after(this.settings.timeoutMs, 'quiet');
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
export const createHub = (databaseUrl: string, settings: HubSettings): Hub => new ListeningHub(databaseUrl, settings);
