/*
 * A workspace kept up to date in the browser (docs: Data and storage › Live traffic): a LiveStore the screen reads with
 * useLive(), fed by the workspace's NDJSON stream. A stream that just ends is opened again, quietly, because the API lets
 * go of them every few minutes; one that fails is opened again with growing waits, keeping what it last showed. A stream
 * that says `closed`, or won't open any more, is over: what it showed goes, because this reader can't open it now.
 */
import { errorCode, type PresenceBody, type WorkspaceLive, type WorkspaceLiveEvent, type WorkspaceView, type WorkspaceWhere } from '@alcove/api';

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
const NOWHERE: WorkspaceWhere = { document: null, block: null, typing: false };
/** What this connection is called in `here`: a name it makes up, because a browser can have the same workspace open twice. */
const newConnection = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

type Ending = 'over' | 'ended' | 'failed';

export class HttpWorkspaceLive implements WorkspaceLive {
  private view: WorkspaceView = { status: 'connecting', tree: null, here: [] };
  private readonly listeners = new Set<() => void>();
  private closed = false;
  private connection: AbortController | null = null;
  private stopWaiting: (() => void) | null = null;
  /** What this browser says about where it is. */
  private readonly name = newConnection();
  private where: WorkspaceWhere = NOWHERE;
  private said = false;
  private saying: ReturnType<typeof setTimeout> | undefined;
  private beat: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly open: (signal: AbortSignal) => AsyncIterable<WorkspaceLiveEvent>, private readonly quietMs: number,
    private readonly tell: (body: PresenceBody, keepalive: boolean) => Promise<unknown>, private readonly beatMs: number
  ) {
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
  close = () => {
    this.closed = true;
    this.connection?.abort();
    this.stopWaiting?.();
    this.quiet();
    if (this.said) this.tell({ connection: this.name, gone: true }, true).catch(() => undefined);
    this.set({ status: 'closed', tree: null, here: [] });
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

  /** One connection, until it ends. Silence past `quietMs` cuts it. */
  private async follow(): Promise<Ending> {
    const connection = new AbortController();
    this.connection = connection;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => connection.abort(), this.quietMs);
      unref(quiet);
    };
    heard();
    try {
      for await (const e of this.open(connection.signal)) {
        heard();
        if (e.type === 'closed') return 'over';
        this.take(e);
      }
      return 'ended';
    } catch (e) {
      const code = errorCode(e);
      return code === 'not-found' || code === 'unauthenticated' || code === 'forbidden' ? 'over' : 'failed';
    } finally {
      clearTimeout(quiet);
    }
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
        this.quiet();
        this.set({ status: 'closed', tree: null, here: [] });
        return;
      }
      if (ending === 'failed') this.set({ status: 'reconnecting' });
      const steady = Date.now() - opened >= STEADY_MS;
      if (ending === 'ended' && steady) { wait = FIRST_WAIT_MS; continue; }
      if (steady) wait = FIRST_WAIT_MS;
      // A little apart, so everyone a restart cut off doesn't come back in the same moment.
      await this.wait(ending === 'ended' ? Math.min(wait, 100) : wait * (0.8 + Math.random() * 0.4));
      wait = Math.min(wait * 2, LONGEST_WAIT_MS);
    }
  }
}
