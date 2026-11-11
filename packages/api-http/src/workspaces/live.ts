import { AlcoveApiError, errorCode, type PresenceBody, type WorkspaceLive, type WorkspaceLiveEvent, type WorkspaceView, type WorkspaceWhere } from '@alcove/api';

const FIRST_WAIT_MS = 500;

const LONGEST_WAIT_MS = 10_000;

/** A stream that lasted at least this long was fine, so opening it again waits for nothing. */
const STEADY_MS = 1_000;

/** A stream that says nothing for this long has gone, whatever the connection claims: a ping comes every 25 seconds. */
export const QUIET_MS = 60_000;

/** How often an open workspace says this browser is still there: the API forgets it after 30 seconds of silence. */
export const PRESENCE_BEAT_MS = 10_000;

/** How long a change of place waits for the next one, so typing fast is one word to the API. */
const PRESENCE_WAIT_MS = 100;

/** In Node (tests), timers mustn't keep the process alive. */
export const unref = (t: unknown) => { if (t && typeof t === 'object' && 'unref' in t && typeof t.unref === 'function') t.unref(); };

const NOWHERE: WorkspaceWhere = { document: null, block: null, typing: false, page: null };

/** A name this browser makes up, for its connection in `here` or for a stream: 22 characters of base64url. */
export const newName = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Whether the API may still hold a stream this browser stopped reading, for a reason other than the API ending it, so it
 * should be told: not when the API turned it away (it answered with a status), or it never got there (`network`, before
 * any answer). A try given up while it waited, or a stream that broke or said something unreadable, may be held.
 */
export const stillHeld = (e: unknown): boolean => !(e instanceof AlcoveApiError && (e.status !== undefined || e.code === 'network'));

/**
 * Tells `retry` when there's reason to think a stream that's down would open now: the browser's back online, or the tab's
 * back in view. Returns what stops listening. Nothing in Node.
 */
export function onChances(retry: () => void): () => void {
  const shown = () => { if (globalThis.document?.visibilityState === 'visible') retry(); };
  globalThis.addEventListener?.('online', retry);
  globalThis.document?.addEventListener('visibilitychange', shown);
  return () => {
    globalThis.removeEventListener?.('online', retry);
    globalThis.document?.removeEventListener('visibilitychange', shown);
  };
}


type Ending = 'over' | 'ended' | 'failed';


export class HttpWorkspaceLive implements WorkspaceLive {
  private view: WorkspaceView = { status: 'connecting', tree: null, here: [], mentions: [] };
  private readonly listeners = new Set<() => void>();
  private closed = false;
  private connection: AbortController | null = null;
  private stopWaiting: (() => void) | null = null;
  /** Try now was asked for: the next try goes at once. */
  private hurry = false;
  private readonly stopListening: () => void;
  /** What this browser says about where it is. */
  private readonly name = newName();
  private where: WorkspaceWhere = NOWHERE;
  private said = false;
  private saying: ReturnType<typeof setTimeout> | undefined;
  private beat: ReturnType<typeof setInterval> | undefined;

  constructor(
    /** Opens a stream, by the name this browser gives it. */
    private readonly open: (signal: AbortSignal, stream: string) => AsyncIterable<WorkspaceLiveEvent>, private readonly quietMs: number,
    private readonly tell: (body: PresenceBody, keepalive: boolean) => Promise<unknown>, private readonly beatMs: number,
    private readonly heard: (mention: string) => Promise<unknown>,
    /** Tells the API this browser closed the stream it gave this name, which it can't always hear: as the page may be going. */
    private readonly end: (stream: string) => void
  ) {
    this.stopListening = onChances(this.retry);
    void this.run();
  }

  getSnapshot = (): WorkspaceView => this.view;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  present = (where: WorkspaceWhere) => {
    this.where = where;
    if (this.saying !== undefined || this.closed) return;
    this.saying = setTimeout(() => { this.saying = undefined; this.say(); }, PRESENCE_WAIT_MS);
    unref(this.saying);
  };
  /** It leaves the view at once. */
  seen = async (mention: string) => {
    this.set({ mentions: this.view.mentions.filter((m) => m.id !== mention) });
    await this.heard(mention).catch(() => undefined);
  };
  retry = () => {
    if (this.closed || this.view.status === 'live') return;
    this.hurry = true;
    if (this.stopWaiting) this.stopWaiting();
    else this.connection?.abort();
  };
  close = () => {
    this.closed = true;
    this.stopListening();
    this.connection?.abort();
    this.stopWaiting?.();
    this.quiet();
    if (this.said) this.tell({ connection: this.name, gone: true }, true).catch(() => undefined);
    this.set({ status: 'closed', tree: null, here: [], mentions: [] });
  };

  private set(p: Partial<WorkspaceView>) {
    this.view = { ...this.view, ...p };
    this.listeners.forEach((l) => l());
  }
  private take(e: WorkspaceLiveEvent) {
    if (e.type === 'tree') {
      const arrived = this.view.status !== 'live';
      this.set({ status: 'live', tree: e.tree });
      if (arrived) this.arrived();
    } else if (e.type === 'presence') this.set({ here: e.here });
    else if (e.type === 'mentions') this.set({ mentions: e.mentions });
    else if (e.type === 'access' && this.view.tree) this.set({ tree: { ...this.view.tree, role: e.role } });
  }

  /** Connected: here, and saying so for as long as that lasts. */
  private arrived() {
    this.say();
    clearInterval(this.beat);
    this.beat = setInterval(() => this.say(), this.beatMs);
    unref(this.beat);
  }
  private quiet() {
    clearTimeout(this.saying);
    this.saying = undefined;
    clearInterval(this.beat);
  }
  /** Best effort: the next beat says it again. Somewhere this reader can't open now, they're simply here. */
  private say() {
    const where = this.where;
    this.said = true;
    this.tell({ connection: this.name, ...where }, false).catch((e: unknown) => {
      if (errorCode(e) === 'not-found' && where.document !== null && this.where === where) this.present(NOWHERE);
    });
  }

  /** One connection, until it ends. Silence past `quietMs` cuts it. A stream this browser stops reading, it says it's closed. */
  private async follow(): Promise<Ending> {
    const connection = new AbortController();
    this.connection = connection;
    const name = newName();
    let held = true;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => connection.abort(), this.quietMs);
      unref(quiet);
    };
    heard();
    try {
      for await (const e of this.open(connection.signal, name)) {
        heard();
        if (e.type === 'closed') { held = false; return 'over'; }
        this.take(e);
      }
      held = false;
      return 'ended';
    } catch (e) {
      held = stillHeld(e);
      const code = errorCode(e);
      return code === 'not-found' || code === 'unauthenticated' || code === 'forbidden' ? 'over' : 'failed';
    } finally {
      clearTimeout(quiet);
      if (held) this.end(name);
    }
  }

  /** Whether Try now was asked for since the last try, which it now takes. */
  private hurried(): boolean {
    const was = this.hurry;
    this.hurry = false;
    return was;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.stopWaiting = null; resolve(); }, ms);
      unref(timer);
      this.stopWaiting = () => { clearTimeout(timer); this.stopWaiting = null; resolve(); };
    });
  }

  private async run(): Promise<void> {
    let wait = FIRST_WAIT_MS;
    while (!this.closed) {
      const opened = Date.now();
      const ending = await this.follow();
      if (this.closed) return;
      if (ending === 'over') {
        this.closed = true;
        this.stopListening();
        this.quiet();
        this.set({ status: 'closed', tree: null, here: [], mentions: [] });
        return;
      }
      // A try given up for Try now didn't fail: the next goes at once.
      if (ending === 'failed' && !this.hurry) this.set({ status: 'reconnecting' });
      const steady = Date.now() - opened >= STEADY_MS;
      if (this.hurried() || (ending === 'ended' && steady)) { wait = FIRST_WAIT_MS; continue; }
      if (steady) wait = FIRST_WAIT_MS;
      // A little apart, so everyone a restart cut off doesn't come back in the same moment.
      await this.wait(ending === 'ended' ? Math.min(wait, 100) : wait * (0.8 + Math.random() * 0.4));
      wait = this.hurried() ? FIRST_WAIT_MS : Math.min(wait * 2, LONGEST_WAIT_MS);
    }
  }
}
