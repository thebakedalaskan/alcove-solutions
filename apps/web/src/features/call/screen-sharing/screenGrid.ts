/*
 * A shared screen on a small grey grid: cheap to compare, and blind to a moving cursor. The earlier pictures of someone
 * else's share you can step back through (shareLook.ts) tell whether a screen changed by it.
 */

export const GRID_W = 48;
export const GRID_H = 27;
/** How far a cell's brightness must move to count as moved. */
export const CELL = 24;

/** The picture on the grid, drawn on `canvas` (GRID_W × GRID_H, kept for reading back). */
export function gridOf(src: CanvasImageSource, canvas: HTMLCanvasElement): Uint8Array | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, GRID_W, GRID_H);
  const px = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
  const out = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * (px[i * 4] ?? 0) + 0.587 * (px[i * 4 + 1] ?? 0) + 0.114 * (px[i * 4 + 2] ?? 0));
  return out;
}

/** How much of the grid moved between two looks, from 0 to 1. */
export function moved(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > CELL) n++;
  return n / a.length;
}
