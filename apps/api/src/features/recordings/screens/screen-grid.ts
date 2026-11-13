/*
 * A frame of a shared screen on a small grey grid, one byte a cell, which ffmpeg draws as it takes the frame
 * (ffmpeg.frames): cheap to compare, and blind to a moving cursor. The notes are told how each frame compares with
 * its share's frame before it, so a screen that didn't change isn't attached to the notes twice (drafting.attachments).
 * The measure is the one the call's own change detector used.
 */

export const GRID_W = 48;
export const GRID_H = 27;
/** A grid's size in bytes. */
export const GRID_BYTES = GRID_W * GRID_H;
/** How far a cell's brightness must move to count as moved. */
const CELL = 24;
/** Under this share of cells moved, a frame is the same as the other; from this one on, it changed a lot. */
const SAME = 0.02;
const A_LOT = 0.15;

/** How one frame compares with another: the same, changed a little or a lot, or unknown when either has no grid. */
export type ScreenChange = 'same' | 'a little' | 'a lot' | 'unknown';

/** How much of the grid moved between two frames, from 0 to 1. */
function moved(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > CELL) n++;
  return n / a.length;
}

/** How frame `b` compares with frame `a`, by their grids. */
export function changeOf(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): ScreenChange {
  if (!a || !b || a.length !== GRID_BYTES || b.length !== GRID_BYTES) return 'unknown';
  const m = moved(a, b);
  return m < SAME ? 'same' : m < A_LOT ? 'a little' : 'a lot';
}
