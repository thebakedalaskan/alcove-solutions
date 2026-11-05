/*
 * A workspace kept up to date in the browser (docs: Data and storage › Live traffic): a LiveStore the screen reads with
 * useLive(), fed by the workspace's NDJSON stream. A stream that just ends is opened again, quietly, because the API lets
 * go of them every few minutes; one that fails is opened again with growing waits, keeping what it last showed. A stream
 * that says `closed`, or won't open any more, is over: what it showed goes, because this reader can't open it now.
 */
import { errorCode, type WorkspaceLive, type WorkspaceLiveEvent, type WorkspaceView } from '@alcove/api';

const FIRST_WAIT_MS = 500;
const LONGEST_WAIT_MS = 10_000;
/** A stream that lasted at least this long was fine, so opening it again waits for nothing. */
const STEADY_MS = 1_000;
/** A stream that says nothing for this long has gone, whatever the connection claims: a ping comes every 25 seconds. */
export const QUIET_MS = 60_000;
/** In Node (tests), timers mustn't keep the process alive. */
const unref = (t: unknown) => { if (t && typeof t === 'object' && 'unref' in t && typeof t.unref === 'function') t.unref(); };

type Ending = 'over' | 'ended' | 'failed';

export class HttpWorkspaceLive implements WorkspaceLive {
  private view: WorkspaceView = { status: 'connecting', tree: null, here: [] };
  private readonly listeners = new Set<() => void>();
  private closed = false;
  private connection: AbortController | null = null;
  private stopWaiting: (() => void) | null = null;

  constructor(private readonly open: (signal: AbortSignal) => AsyncIterable<WorkspaceLiveEvent>, private readonly quietMs: number) {
    void this.run();
  }

  getSnapshot = (): WorkspaceView => this.view;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  close = () => {
    this.closed = true;
    this.connection?.abort();
    this.stopWaiting?.();
    this.set({ status: 'closed', tree: null, here: [] });
  };

  private set(p: Partial<WorkspaceView>) {
    this.view = { ...this.view, ...p };
    this.listeners.forEach((l) => l());
  }
  private take(e: WorkspaceLiveEvent) {
    if (e.type === 'tree') this.set({ status: 'live', tree: e.tree });
    else if (e.type === 'access' && this.view.tree) this.set({ tree: { ...this.view.tree, role: e.role } });
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
