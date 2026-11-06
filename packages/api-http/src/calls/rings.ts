import { errorCode, type IncomingRing, type LiveStore, RING_SECONDS } from '@alcove/api';

type Emit = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, context: Record<string, string | number | boolean | null>) => void;

/** In Node (tests), timers mustn't keep the process alive. */
const unref = (t: unknown) => { if (t && typeof t === 'object' && 'unref' in t && typeof t.unref === 'function') t.unref(); };


/** The longest wait between tries while the API can't be reached, in ms. */
const RETRY_MAX_MS = 30_000;

const RING_MS = RING_SECONDS * 1000;


/** One showing of a ring: rung again, it has the same ID and a new `expiresAt`. */
const tag = (r: IncomingRing) => `${r.id}@${r.expiresAt}`;

/**
 * When a ring stops if nothing more is heard, by this browser's clock. The server just said it's ringing, so a clock
 * that's wrong never hides it: at most a ring's length from now. While the stream is up, it's the server that ends it.
 */
function endOf(r: IncomingRing): number {
  const left = Date.parse(r.expiresAt) - Date.now();
  return Date.now() + (left > 0 && left < RING_MS ? left : RING_MS);
}

interface Showing { ring: IncomingRing; until: number }


export class HttpRings implements LiveStore<IncomingRing[]> {
  private snapshot: IncomingRing[] = [];
  private showing: Showing[] = [];
  /** Showings answered in this browser: gone at once, whatever a snapshot already on its way says. */
  private answered = new Set<string>();
  private listeners = new Set<() => void>();
  private stream: AbortController | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private silence: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly connect: (signal: AbortSignal) => AsyncIterable<{ rings: IncomingRing[] }>, private readonly silenceMs: number, private readonly emit: Emit, private readonly onClose: () => void) {
    void this.run();
  }

  getSnapshot = (): IncomingRing[] => this.snapshot;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.stream?.abort();
    for (const t of [this.expiry, this.silence, this.retry]) if (t) clearTimeout(t);
    this.onClose();
  };

  /** Someone answered this ring here. */
  answeredHere(id: string): void {
    for (const s of this.showing) if (s.ring.id === id) this.answered.add(tag(s.ring));
    this.show(this.showing.filter((s) => s.ring.id !== id));
  }

  /** A stream at a time, for as long as this is open. */
  private async run(): Promise<void> {
    let tries = 0;
    while (!this.closed) {
      const stream = new AbortController();
      this.stream = stream;
      this.listenFor(stream);
      try {
        for await (const { rings } of this.connect(stream.signal)) {
          tries = 0;
          this.listenFor(stream);
          this.take(rings);
        }
      } catch (e) {
        tries += 1;
        if (!this.closed) this.emit('debug', 'rings stream dropped', { tries, code: errorCode(e) });
      }
      if (this.silence) clearTimeout(this.silence);
      if (!this.closed) await this.pause(tries);
    }
  }

  /** Gives up on a stream that's gone quiet: the connection died without saying so. Each line starts this over. */
  private listenFor(stream: AbortController): void {
    if (this.silence) clearTimeout(this.silence);
    this.silence = setTimeout(() => stream.abort(), this.silenceMs);
    unref(this.silence);
  }

  /** Browsers come back spread out, however many streams ended at once, and slower while it's failing. */
  private pause(tries: number): Promise<void> {
    const ms = tries === 0 ? Math.random() * 1000 : Math.min(RETRY_MAX_MS, 1000 * 2 ** (tries - 1)) * (0.5 + Math.random() / 2);
    return new Promise((resolve) => {
      this.retry = setTimeout(resolve, ms);
      unref(this.retry);
    });
  }

  private take(rings: IncomingRing[]): void {
    const heard = new Set(rings.map(tag));
    this.answered = new Set([...this.answered].filter((t) => heard.has(t)));
    this.show(rings.filter((r) => !this.answered.has(tag(r))).map((ring) => ({ ring, until: endOf(ring) })));
  }

  /** What shows now. Rings past their time drop by themselves, even with the stream down; a snapshot saying the same changes nothing. */
  private show(next: Showing[]): void {
    const was = this.showing;
    const changed = next.length !== was.length || next.some((s, i) => { const w = was[i]; return !w || tag(w.ring) !== tag(s.ring); });
    this.showing = next;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    if (next.length) {
      this.expiry = setTimeout(() => this.show(this.showing.filter((s) => s.until > Date.now())), Math.max(0, Math.min(...next.map((s) => s.until)) - Date.now()));
      unref(this.expiry);
    }
    if (!changed) return;
    this.snapshot = next.map((s) => s.ring);
    this.listeners.forEach((l) => l());
  }
}
