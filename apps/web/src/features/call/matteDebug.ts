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

/** The segmentation models the debug view can compare. Outside development it's always the landscape one. */
export const MATTE_MODELS = ['landscape', 'multiclass'] as const;
export type MatteModel = (typeof MATTE_MODELS)[number];

/** How much the mask moves between frames where it's unsure (0.1–0.9), as the average change per pixel, 0–1, and
 * how long each frame took, for `model`. */
export interface MatteFlicker { model: MatteModel; reading: number; settled: number; edge: number; msPerFrame: number }

const KEY = 'alcove:matte-debug';
const MODEL_KEY = 'alcove:matte-model';
const stored = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const remember = (key: string, value: string | null) => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { dlog.debug('the switch isn’t remembered', { err: e }); }
};
const isModel = (v: string | null): v is MatteModel => MATTE_MODELS.some((m) => m === v);

let on = import.meta.env.DEV && stored(KEY) === '1';
const storedModel = stored(MODEL_KEY);
let model: MatteModel = import.meta.env.DEV && isModel(storedModel) ? storedModel : 'landscape';
let flicker: MatteFlicker | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const matteDebug = {
  on: (): boolean => on,
  set(next: boolean): void {
    on = import.meta.env.DEV && next;
    flicker = null;
    remember(KEY, on ? '1' : null);
    changed();
  },
  model: (): MatteModel => model,
  setModel(next: MatteModel): void {
    if (!import.meta.env.DEV || next === model) return;
    model = next;
    flicker = null;
    remember(MODEL_KEY, next === 'landscape' ? null : next);
    changed();
  },
  /** The matte's latest numbers, averaged over a few frames. */
  report(f: MatteFlicker): void {
    flicker = f;
    dlog.debug('flicker', { model: f.model, reading: f.reading, settled: f.settled, edge: f.edge, msPerFrame: f.msPerFrame });
    changed();
  }
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useMatteDebug = (): boolean => useSyncExternalStore(subscribe, () => on);
export const useMatteModel = (): MatteModel => useSyncExternalStore(subscribe, () => model);
export const useMatteFlicker = (): MatteFlicker | null => useSyncExternalStore(subscribe, () => flicker);
