/*
 * Live stores, as the stand-in makes them: whole snapshots pushed to whoever subscribed (the app reads them with
 * useLive()), and scripts that push the next snapshot after a while (someone joins, notes start). Every timer a store
 * starts stops when the store closes, so nothing from one story runs on into the next.
 */
import type { LiveStore, Unsubscribe } from '@alcove/api';

export class Snapshots<S> implements LiveStore<S> {
  private listeners = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;
  constructor(private state: S) {}

  /* Arrow properties: the app hands these to useSyncExternalStore unbound. */
  getSnapshot = (): S => this.state;
  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Pushes a new snapshot, whole. */
  protected push(next: S): void {
    if (this.closed) return;
    this.state = next;
    for (const l of this.listeners) l();
  }
  /** Pushes what `change` makes of the last snapshot. */
  protected change(change: (now: S) => S): void {
    this.push(change(this.state));
  }
  /** Runs `step` in `ms`, unless the store has closed by then. */
  protected after(ms: number, step: () => void): void {
    if (this.closed) return;
    const t = setTimeout(() => { this.timers.delete(t); if (!this.closed) step(); }, ms);
    this.timers.add(t);
  }
  /** Runs `step` every `ms` until the store closes. */
  protected every(ms: number, step: () => void): void {
    this.after(ms, () => { step(); this.every(ms, step); });
  }
  /** Stops every script; snapshots stay as they last were. */
  protected halt(): void {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

/** A store that only ever changes when the stand-in says so: rings, a workspace, a move. */
export class Pushed<S> extends Snapshots<S> {
  set(next: S): void { this.push(next); }
  update(change: (now: S) => S): void { this.change(change); }
  close(): void { this.halt(); }
}

/** Waits `ms`. */
export const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
