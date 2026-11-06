/*
 * The matte's debug view (development only), kept apart from matte.ts so the switch doesn't load MediaPipe. While it's
 * on, the camera shows four quarters in place of the picture, laid out for your own mirrored preview: top left what the model reads this frame, top right the
 * mask once it's settled, bottom left the edge as drawn, bottom right the camera with what's taken as room tinted.
 * `flicker()` says how much each moves at the edge from frame to frame, so someone sitting still can tell where
 * shimmer comes from: the model, or the settling and drawing after it.
 */
import { useSyncExternalStore } from 'react';
import { log } from '~/lib/log';

const dlog = log.child({ component: 'matte-debug' });

/** How much the mask moves between frames where it's unsure (0.1–0.9), as the average change per pixel, 0–1. */
export interface MatteFlicker { reading: number; settled: number; edge: number }

const KEY = 'alcove:matte-debug';
const stored = (): boolean => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};

let on = import.meta.env.DEV && stored();
let flicker: MatteFlicker | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const matteDebug = {
  on: (): boolean => on,
  set(next: boolean): void {
    on = import.meta.env.DEV && next;
    flicker = null;
    try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { dlog.debug('the switch isn’t remembered', { err: e }); }
    changed();
  },
  /** The matte's latest numbers, averaged over a few frames. */
  report(f: MatteFlicker): void {
    flicker = f;
    dlog.debug('flicker', { reading: f.reading, settled: f.settled, edge: f.edge });
    changed();
  }
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useMatteDebug = (): boolean => useSyncExternalStore(subscribe, () => on);
export const useMatteFlicker = (): MatteFlicker | null => useSyncExternalStore(subscribe, () => flicker);
