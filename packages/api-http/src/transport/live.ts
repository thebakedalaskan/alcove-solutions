import { type LiveStore } from '@alcove/api';

/** A small store for something a screen reads with useLive(). */
export class Box<T> implements LiveStore<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) { }
  getSnapshot = (): T => this.value;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  set(v: T) { this.value = v; this.listeners.forEach((l) => l()); }
}

export class Live<S extends { elapsed: number }> {
  protected state: S;
  private listeners = new Set<() => void>();
  private ticker: ReturnType<typeof setInterval> | null;
  constructor(initial: S, tick: (s: S) => boolean) {
    this.state = initial;
    this.ticker = setInterval(() => { if (tick(this.state)) this.set({ ...this.state, elapsed: this.state.elapsed + 1 }); }, 1000);
  }
  getSnapshot = (): S => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  protected set(s: S) { this.state = s; this.listeners.forEach((l) => l()); }
  /** Applies the server's answer but keeps the local clock if it's ahead (the server rounds). */
  protected apply(s: S) { this.set({ ...s, elapsed: Math.max(s.elapsed, this.state.elapsed) }); }
  protected stopTicking() { if (this.ticker) clearInterval(this.ticker); this.ticker = null; }
}

/** In Node (tests), a call's timers mustn't keep the process alive. */
export function unref(t: unknown) {
  if (t && typeof t === 'object' && 'unref' in t && typeof t.unref === 'function') t.unref();
}
