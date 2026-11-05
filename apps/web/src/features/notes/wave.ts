/*
 * The light under a note's horizon: what was said, the way light lies on water. The page never decodes a call's audio,
 * so it's drawn from the transcript. Each row of glints is one level of how much was said, so the row nearest the line
 * is almost unbroken and the deepest rows catch only the busiest moments, and where nobody spoke the water is still.
 */
import type { TranscriptLine } from '@alcove/api';

export interface Glint { x: number; w: number; top: number; o: number; far: number; every: number; after: number }

/** How finely the call is cut up across the line, and how many rows of light lie under it. */
const BINS = 300;
const ROWS = 6;
/** A line is taken to run on until the next one, this many seconds at most: a transcript line starts when someone speaks, and doesn't say when they stop. */
const HOLD = 40;
/** A busy stretch, in words a second. */
const BUSY = 3;

function seeded(seed: number): () => number {
  let n = seed;
  return () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
}
const seedOf = (id: string) => { let h = 7; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 2147483646; return h + 1; };

/** How much was being said through the call, from nothing to the busiest it gets, in BINS steps. */
function levels(id: string, lines: readonly TranscriptLine[], seconds: number): number[] {
  const amp = new Array<number>(BINS).fill(0);
  const r = seeded(seedOf(id));
  const [a, b, c] = [r() * 6, r() * 6, r() * 6];
  lines.forEach((l, i) => {
    const next = lines[i + 1]?.at ?? seconds;
    const words = l.text.trim().split(/\s+/).length;
    const length = Math.max(1, Math.min(HOLD, next - l.at));
    const busy = Math.min(1, words / length / BUSY);
    const from = Math.floor((l.at / seconds) * BINS);
    const to = Math.min(BINS - 1, Math.ceil(((l.at + length) / seconds) * BINS));
    for (let k = from; k <= to; k++) {
      // Long swells for how much is being said, shorter ones for phrases, and a little breath between them.
      const swell = 0.5 + 0.5 * Math.sin(k / 21 + a);
      const phrase = 0.5 + 0.5 * Math.sin(k / 7 + b);
      const word = 0.5 + 0.5 * Math.sin(k / 2.6 + c);
      const v = 0.14 + 0.3 * busy + 0.34 * swell * swell + 0.2 * phrase * phrase + 0.1 * word + (r() - 0.5) * 0.14;
      amp[k] = Math.max(amp[k] ?? 0, Math.max(0, Math.min(1, v)));
    }
  });
  return amp;
}

/** The glints for a call `seconds` long. A glint is a short stroke: the nearer the line, the longer it runs. */
export function noteWave(id: string, lines: readonly TranscriptLine[], seconds: number): Glint[] {
  if (seconds <= 0 || !lines.length) return [];
  const amp = levels(id, lines, seconds);
  const out: Glint[] = [];
  const g = seeded(31);
  const e = seeded(53);
  for (let row = 0; row < ROWS; row++) {
    const far = row / (ROWS - 1);
    const line = 0.1 + row * 0.135;
    let x = g() * 3;
    while (x < BINS) {
      const w = (3 + g() * 8) * (1 - far * 0.55);
      const gap = 1 + g() * (3 + far * 7);
      const mid = Math.min(BINS - 1, Math.round(x + w / 2));
      if ((amp[mid] ?? 0) > line + (g() - 0.5) * 0.06) {
        out.push({ x: (x / BINS) * 100, w: (Math.min(w, BINS - x) / BINS) * 100, top: 7 + row * 8, o: 0.95 - far * 0.55, far, every: 34 + e() * 22, after: -e() * 56 });
      }
      x += w + gap;
    }
  }
  return out;
}
