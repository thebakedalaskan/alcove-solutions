import type { LiveStore, Unsubscribe } from '@alcove/api';

/** Tiny immutable store: every change replaces the snapshot so React's useSyncExternalStore sees it. */
export class Store<S> implements LiveStore<S> {
  private listeners = new Set<() => void>();
  constructor(protected state: S) {}
  getSnapshot = (): S => this.state;
  subscribe = (l: () => void): Unsubscribe => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  protected set(patch: Partial<S> | ((s: S) => Partial<S>)) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
