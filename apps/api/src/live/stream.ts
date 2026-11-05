/*
 * One browser's stream of something in a workspace (docs: Data and storage › Live traffic). It holds no keys and nothing of
 * what it shows: only who it's for and what's next, so hundreds fit in a little memory. A stream sleeps until there's a
 * line to write, pings to say it's still there, and checks at each ping that its reader still is. It ends when they lose
 * what it shows, the browser goes or can't keep up, this instance shuts down, or it's time to let go, for the browser to
 * open it again.
 */
import type { StreamingApi } from 'hono/utils/stream';
import type { Deps } from '../context';
import { b64u } from '../crypto';
import { AuthError } from '../errors';
import { log, type LogContext } from '../log';
import { readerOf, type Credentials, type Who } from '../modules/workspaceAccess';
import { findSession } from '../sessions';
import type { Room, RoomMember, Snapshot } from './room';

const slog = log.child({ component: 'live' });
const sameness = (who: Who): string => who.principals.map(b64u).join();

/** What one step of a stream did: nothing to do, a line written, or its reader lost it. */
export type Step = 'idle' | 'wrote' | 'lost';
export type Line<L> = (line: L) => Promise<void>;

export abstract class LiveStream<L> implements RoomMember {
  private wake: (() => void) | undefined;
  /** Something arrived since the last step, which the step may have missed. */
  private poked = false;
  private over = false;
  private next: Snapshot | undefined;

  constructor(
    protected readonly d: Deps, protected readonly room: Room, private readonly credentials: Credentials, protected who: Who,
    /** How far this stream has been shown. -1: it's behind whatever there is. */
    public version: number,
    /** Gives its place among this person's streams back. */
    private readonly release: () => void, private readonly context: LogContext
  ) {}

  get principals(): Uint8Array[] { return this.who.principals; }
  /** Something changed: only the latest matters, so a slow browser skips to it. */
  offer(s: Snapshot): void {
    this.next = s;
    this.version = s?.version ?? -1;
    this.poke();
  }
  protected nextSnapshot(): Snapshot | undefined {
    const s = this.next;
    this.next = undefined;
    return s;
  }
  /** Who's here changed. */
  heard(): void { /* only a workspace's own stream shows it */ }
  end(): void { this.over = true; this.poke(); }
  protected poke(): void { this.poked = true; this.wake?.(); }

  /** The stream's first lines, written before anything else. */
  protected abstract begin(line: Line<L>): Promise<void>;
  /** Writes what's next, if anything. */
  protected abstract step(line: Line<L>): Promise<Step>;
  protected abstract ping(): L;
  /** The last line, once its reader lost it. `session`: it's the reader who's gone, as opposed to what they had. */
  protected abstract closed(session: boolean): L;
  /** It's over: anything more it listens to, it stops. */
  protected leave(): void { this.room.leave(this); }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }
  /**
   * Writes one line. A browser that can't take it within a ping has gone, whatever its connection says: one that went
   * just as its stream opened is never read from at all, and would otherwise hold this stream for good.
   */
  private async write(out: StreamingApi, e: L): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), this.d.cfg.LIVE_PING_MS); });
    const wrote = await Promise.race([out.write(`${JSON.stringify(e)}\n`), late]);
    clearTimeout(timer);
    if (wrote !== 'late') return;
    this.end();
    out.abort();
  }
  /** Who this is now, in full. If it's someone new, the stream is behind. False when nobody's there any more. */
  private async lookAgain(): Promise<boolean> {
    try {
      const reader = await readerOf(this.d, this.credentials);
      const before = sameness(this.who);
      this.who = { email: reader.email, principals: reader.principals };
      if (sameness(this.who) !== before) {
        this.version = -1;
        void this.room.read();
      }
      return true;
    } catch (e) {
      if (e instanceof AuthError) return false;
      throw e;
    }
  }
  /** They look gone, and may only have a new address: a provider's new address moves what they have to another hash, which needs reading again. */
  protected async someoneNew(): Promise<boolean> {
    const before = sameness(this.who);
    return (await this.lookAgain()) && sameness(this.who) !== before;
  }
  /**
   * Each ping, on the clock: is this still someone? Sessions end, passes run out, calls finish, and none of that is a
   * workspace's notice to give. A session is one indexed read. A pass takes the call's state, and only people in a call have one.
   */
  private async stillThere(): Promise<boolean> {
    try {
      return this.credentials.pass === undefined ? (await findSession(this.d, this.credentials.session)) !== undefined : await this.lookAgain();
    } catch (e) {
      slog.warn('stream’s reader not checked', { ...this.context, err: e });
      return true;
    }
  }

  async run(out: StreamingApi): Promise<void> {
    const t0 = Date.now();
    const line: Line<L> = (e) => this.write(out, e);
    const { LIVE_PING_MS: pingMs, LIVE_STREAM_MS: streamMs } = this.d.cfg;
    const letGo = t0 + streamMs;
    let why: 'closed' | 'ended' | 'time' = 'ended';
    let session = false;
    out.onAbort(() => this.end());
    slog.debug('stream opened', this.context);
    try {
      await this.begin(line);
      let ping = t0 + pingMs;
      // The clock comes first, so a busy stream can't keep from noticing its session ended or its time is up.
      while (!this.over) {
        const now = Date.now();
        if (now >= letGo) { why = 'time'; break; }
        if (now >= ping) {
          ping = now + pingMs;
          if (!(await this.stillThere())) { why = 'closed'; session = true; break; }
          await line(this.ping());
          continue;
        }
        this.poked = false;
        const did = await this.step(line);
        if (did === 'lost') { why = 'closed'; break; }
        if (did === 'wrote' || this.poked) continue;
        await this.sleep(Math.min(ping, letGo) - now);
      }
      if (why === 'closed') await line(this.closed(session));
    } catch (e) {
      slog.warn('stream failed', { ...this.context, err: e });
    } finally {
      this.next = undefined;
      this.leave();
      this.release();
      slog.debug('stream ended', { ...this.context, why, ms: Date.now() - t0 });
    }
  }
}
