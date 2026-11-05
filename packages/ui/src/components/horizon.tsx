/*
 * Home's sunset: a sky and a sea meeting at --hz, the sun on the line and its glitter on the water, behind the page.
 * The water moves a little so the page feels awake. Everything that moves is a plain element animating transform
 * and opacity, which the browser runs off the main thread, so a Home left open all day costs next to nothing.
 * Each element's resting state is the drawing itself: with reduced motion it's a still picture.
 */
import { memo } from 'react';

/** A small generator, so the sea is the same on every visit. */
function seeded(seed: number): () => number {
  let n = seed;
  return () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
}

interface Stroke { x: number; y: number; w: number; o: number }
interface Glint extends Stroke { far: number; every: number; after: number }

const GLITTER_SPAN = 190;
const CHOP_SPAN = 66;
const CHOP_REACH = 1700;
const CHOP_PER_ROW = 26;
const CHOP_LAYERS = 3;
const CLOUDS: Stroke[] = [{ x: -430, y: -92, w: 460, o: 0.5 }, { x: 40, y: -60, w: 340, o: 0.4 }, { x: -300, y: -34, w: 520, o: 0.35 }];

function drawSea(): { glints: Glint[]; chop: Stroke[][] } {
  const r = seeded(7);
  const beat = seeded(11);
  const glints: Glint[] = [];
  for (let y = 7; y < GLITTER_SPAN; y += 8) {
    const far = y / GLITTER_SPAN;
    const spread = 16 + far * 70;
    const n = 1 + Math.round(r() * 2);
    for (let i = 0; i < n; i++) {
      const w = (8 + r() * 30) * (0.7 + far) * 1.4;
      const off = (r() - 0.5) * 2 * spread;
      glints.push({ x: off - w / 2, y, w, o: 0.86 - far * 0.6, far, every: 34 + beat() * 22, after: -beat() * 56 });
    }
  }
  const chop: Stroke[][] = Array.from({ length: CHOP_LAYERS }, () => []);
  let row = 0;
  for (let y = 11; y < CHOP_SPAN; y += 13) {
    for (let k = 0; k < CHOP_PER_ROW; k++) {
      const w = 20 + r() * 70;
      const x = -CHOP_REACH + r() * CHOP_REACH * 2;
      if (Math.abs(x) < 106) continue;
      chop[row % CHOP_LAYERS]?.push({ x, y, w, o: 0.05 + r() * 0.09 });
    }
    row += 1;
  }
  return { glints, chop };
}

const SEA = drawSea();

/** The scene. Set --hz on an ancestor for where the sky meets the water. It never changes, so nothing around it redraws it. */
export const Horizon = memo(function Horizon() {
  return (
    <div className="hz" aria-hidden="true">
      <div className="hz-sky" />
      <div className="hz-sea" />
      <div className="hz-up"><div className="hz-at"><i className="hz-glow" /><i className="hz-sun" /></div></div>
      <div className="hz-at">
        {CLOUDS.map((c, i) => <i key={c.x} className="hz-cloud" style={{ left: c.x, top: c.y, width: c.w, opacity: c.o, '--i': i }} />)}
        <i className="hz-rim" />
        {SEA.chop.map((layer, i) => (
          <div key={i} className="hz-chop" style={{ '--i': i }}>
            {layer.map((c) => <i key={`${c.x}-${c.y}`} style={{ left: c.x, top: c.y, width: c.w, opacity: c.o }} />)}
          </div>
        ))}
        {SEA.glints.map((g) => (
          <i key={`${g.x}-${g.y}`} className="hz-glint" style={{ left: g.x, top: g.y, width: g.w, '--o': g.o, '--far': g.far, '--every': `${g.every}s`, '--after': `${g.after}s` }} />
        ))}
      </div>
    </div>
  );
});
