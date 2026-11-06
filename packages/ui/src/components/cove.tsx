/*
 * The cove the welcome page looks out of, and signing in sailing out of it to Home.
 *
 * `Cove` is land drawn into a `Horizon` (its `land`): three headlands a side, far, mid and near, their tops rolling hills
 * with stands of pines and cypresses, each ending in a cliff face down to the water with the light catching one side of it;
 * sea stacks by the mouth of the bay; every one of them mirrored in the water, broken by ripples, with foam where the nearest
 * meet it. The sky and the sea are the evening's own, so what sails or leaps passes behind the cliffs, and gulls fly in front.
 * It's a drawing of plain numbers, the same numbers draw the same cove, and `seed` picks which one. Nothing rises within 24px
 * of the words on the sky: where the words reach across a narrow window, the whole land lies lower instead.
 *
 * `SailOut` is the cove over the real Home just after signing in, starting where the welcome page showed it: the headlands
 * go by on either side, nearest first, the horizon comes up to Home's and the sun eases to Home's size, only ever rising.
 * Then Alcove's frame forms round the sea (the side panel slides in and the page takes its rounded edge), Home's contents
 * rise in, and the sea clears to leave the real Home. It's decorative: it takes no focus, and a press, a key, the wheel or
 * a change of width ends it at once.
 */
import { memo, useId, useLayoutEffect, useMemo, useRef, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Horizon, type Showing } from './horizon';
import { EASE } from './motion';

/** Words on the sky, as a box the land keeps clear of: its left and right edges and its bottom, in px. */
export interface CoveWords { l: number; r: number; b: number }

/** A small generator, so a seed always draws the same cove. */
function seeded(seed: number): () => number {
  let n = seed;
  return () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const xy = (x: number, y: number) => `${r1(x)} ${r1(y)}`;
type Pt = readonly [number, number];
const pathOf = (pts: readonly Pt[], X: (x: number) => number) => `M${pts.map(([x, y]) => xy(X(x), y)).join('L')}Z`;

function pine(x: number, y: number, h: number): string {
  let d = `M${xy(x - 1, y)}h2v${r1(-h * 0.2)}h-2Z`;
  for (let k = 0; k < 3; k++) {
    const bottom = y - h * (0.14 + k * 0.24), apex = bottom - h * 0.42, half = h * 0.25 * (1 - k * 0.22);
    d += `M${xy(x - half, bottom)}L${xy(x, apex)}L${xy(x + half, bottom)}Z`;
  }
  return d;
}
function cypress(x: number, y: number, h: number): string {
  const w = h * 0.3;
  return `M${xy(x, y - h)}C${xy(x + w * 0.62, y - h * 0.62)} ${xy(x + w * 0.56, y - h * 0.08)} ${xy(x, y)}C${xy(x - w * 0.56, y - h * 0.08)} ${xy(x - w * 0.62, y - h * 0.62)} ${xy(x, y - h)}Z`;
}

type Tone = 'far' | 'mid' | 'near';
type Side = 'l' | 'r';
/**
 * Three headlands a side, from the far tip by the mouth to the cliff beside you: how far in each reaches (a share of the
 * width), and how high it stands at the edge and at its tip (a share of the sky).
 */
const HEADLANDS: readonly { tone: Tone; reach: number; out: number; tip: number }[] = [
  { tone: 'far', reach: 0.43, out: 0.17, tip: 0.055 },
  { tone: 'mid', reach: 0.3, out: 0.38, tip: 0.14 },
  { tone: 'near', reach: 0.16, out: 0.66, tip: 0.27 }
];
/** No cliff or tree comes nearer the words than this, and no hill top nearer the horizon than `LOW`. */
const CLEAR = 24;
const LOW = 6;
/** How far below its foot the nearest cliff's reflection reaches, at most. */
export const COVE_REFLECTION = 64;

/** One part of the cove, painted in this order: a headland on one side, or the stacks by the mouth. */
type Part =
  | { kind: 'land'; side: Side; tone: Tone; base: number; refl: string; rock: string; face: string; foam: string }
  | { kind: 'stacks'; base: number; refl: string; rock: string };
interface Drawing { ripples: string; parts: Part[]; height: number }

interface Plan { width: number; line: number; sky: number; foot: number; words: readonly CoveWords[]; seed: number }

/** How low the land must keep between `a` and `b` (px across) for the words above it: their lowest bottom there, and 24px. */
function roofOver(words: readonly CoveWords[], a: number, b: number): number {
  let v = Number.NEGATIVE_INFINITY;
  for (const k of words) if (b > k.l - CLEAR - 4 && a < k.r + CLEAR + 4) v = Math.max(v, k.b + CLEAR);
  return v;
}

/** Where the land reaches up to, across the window: `k` a share of the land's height above the horizon, less `lift` px. */
interface Reach { x: number; k: number; lift: number }
/** A quadratic curve's point at `t`, for one coordinate. */
const bend = (a: number, c: number, b: number, t: number) => (1 - t) * (1 - t) * a + 2 * t * (1 - t) * c + t * t * b;

/**
 * Draws the cove with the land `S` px to the sky's full height. Every random number is drawn in the same order whatever
 * `S` is, so the land drawn lower is the same land. `reach` collects the outline of everything that stands up (the hills
 * along their curves, each tip's cliff edge and the stacks) for the land to be lowered under the words.
 */
function draw({ width: W, line: hz, foot, words, seed }: Plan, S: number, reach?: Reach[]): Drawing {
  const r = seeded(seed);
  const roof = (a: number, b: number, y: number) => Math.min(Math.max(y, roofOver(words, a, b)), hz - LOW);
  const baseOf = (tone: Tone) => (tone === 'far' ? hz + 4 : tone === 'mid' ? hz + (foot - hz) * 0.36 : foot);
  let ripples = '';
  for (let y = hz + 84, k = 0; y < foot + 40; y += 9 + k * 1.6, k++) {
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const w = (18 + r() * 46) * (1 + k * 0.12), x = W * (0.18 + r() * 0.64);
      ripples += `M${xy(x - w / 2, y)}h${r1(w)}`;
    }
  }
  const parts: Part[] = [];
  for (const L of HEADLANDS) {
    if (L.tone === 'mid') {
      /* Sea stacks stand off the right-hand headland, by the mouth. */
      const sb = hz + 9, sh = S * 0.13, sw = Math.max(16, S * 0.045), sx = W * (0.655 + r() * 0.03);
      const stack = (x: number, h: number, w: number): Pt[] => [[x - w / 2, sb], [x - w * 0.42, sb - h * 0.55], [x - w * 0.3, sb - h * 0.96], [x + w * 0.05, sb - h], [x + w * 0.34, sb - h * 0.82], [x + w * 0.46, sb - h * 0.4], [x + w / 2, sb]];
      const I = (x: number) => x;
      const under = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x, sb + (sb - y) * 0.28]);
      const one = stack(sx, sh, sw), two = stack(sx + sw * 1.35, sh * 0.5, sw * 0.7);
      const left = sx - sw / 2, right = sx + sw * 1.7;
      for (let j = 0; j <= 6; j++) reach?.push({ x: left + ((right - left) * j) / 6, k: 0.13, lift: 9 });
      parts.push({ kind: 'stacks', base: r1(sb), refl: pathOf(under(one), I) + pathOf(under(two), I), rock: pathOf(one, I) + pathOf(two, I) });
    }
    const base = baseOf(L.tone);
    for (const side of ['l', 'r'] as const) {
      const X = (x: number) => (side === 'l' ? x : W - x);
      const xOut = -40, xTip = W * L.reach * (0.94 + r() * 0.12), n = 12;
      const top: Pt[] = [];
      const ks: number[] = [];
      const waves = [[2 + r() * 1.5, r() * 6.3, 0.03], [4.5 + r() * 2, r() * 6.3, 0.012]] as const;
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = xOut + (xTip - xOut) * t;
        let k = L.out + (L.tip - L.out) * Math.pow(t, 1.15);
        for (const [kk, ph, amp] of waves) k -= Math.sin(t * Math.PI * kk + ph) * amp * (1 - t * 0.6);
        k -= (r() - 0.5) * 0.008;
        ks.push(k);
        top.push([x, roof(X(x), X(x), hz - S * k)]);
      }
      const last = top[n];
      if (!last) continue;
      if (reach) {
        /* The hills as drawn: a curve through each top point, from the middle of the one before to the middle of the next,
           then a straight run to the tip; and the tip's edge, where the cliff face starts down towards the bay. */
        const at = (i: number): [number, number] => [top[i]?.[0] ?? xOut, ks[i] ?? 0];
        const mid = (i: number): [number, number] => { const [xa, ka] = at(i), [xb, kb] = at(i + 1); return [(xa + xb) / 2, (ka + kb) / 2]; };
        for (let i = 1; i < n; i++) {
          const [x0, k0] = i === 1 ? at(0) : mid(i - 1), [x1, k1] = at(i), [x2, k2] = mid(i);
          for (let j = 0; j <= 8; j++) reach.push({ x: X(bend(x0, x1, x2, j / 8)), k: bend(k0, k1, k2, j / 8), lift: 0 });
        }
        const [xm, km] = mid(n - 1), kn = ks[n] ?? 0, edge = Math.max(16, (base - hz + S * kn) * 0.36) * 0.26;
        for (let j = 0; j <= 4; j++) reach.push({ x: X(xm + ((last[0] - xm) * j) / 4), k: km + ((kn - km) * j) / 4, lift: 0 });
        for (let j = 1; j <= 4; j++) reach.push({ x: X(last[0] + (edge * j) / 4), k: kn, lift: 0 });
      }
      const drop = base - last[1], faceW = Math.max(16, drop * (0.24 + r() * 0.12));
      const jag = (u: number, v: number): Pt => [last[0] + faceW * u + (r() - 0.5) * faceW * 0.12, last[1] + drop * v];
      const f1 = jag(0.2, 0.18), f2 = jag(0.44, 0.42), f3 = jag(0.7, 0.7), toe: Pt = [last[0] + faceW, base];
      /* The top as rolling hills, then the face down to the water, rock all the way. */
      const [first] = top;
      let hill = first ? `M${xy(X(first[0]), first[1])}` : '';
      for (let i = 1; i < n; i++) {
        const p = top[i], q = top[i + 1];
        if (p && q) hill += `Q${xy(X(p[0]), p[1])} ${xy(X((p[0] + q[0]) / 2), (p[1] + q[1]) / 2)}`;
      }
      const tail: Pt[] = [last, f1, f2, f3, toe, [xOut, base]];
      const rockD = hill + tail.map(([x, y]) => `L${xy(X(x), y)}`).join('') + 'Z';
      const band: Pt[] = [last, f1, f2, f3, toe, [toe[0] - faceW * 0.5, base], [f3[0] - faceW * 0.42, f3[1]], [f2[0] - faceW * 0.34, f2[1]], [f1[0] - faceW * 0.26, f1[1]]];
      const rock: Pt[] = [...top, f1, f2, f3, toe, [xOut, base]];
      const depth = Math.min(L.tone === 'near' ? COVE_REFLECTION : 40, (base - Math.min(...top.map((p) => p[1]))) * 0.3);
      const refl: Pt[] = rock.map(([x, y]) => [x, base + Math.min(depth, (base - y) * 0.3)]);
      /* Trees in small stands along the top, never in front of the words: not one side of them. */
      let trees = '';
      const stands = L.tone === 'near' ? 3 : L.tone === 'mid' ? 2 : 1, each = L.tone === 'far' ? 2 : 3;
      const size = L.tone === 'near' ? [26, 30] : L.tone === 'mid' ? [13, 15] : [7, 5];
      for (let k = 0; k < stands; k++) {
        const c = 0.08 + r() * 0.66;
        for (let m = 0; m < each; m++) {
          const t = clamp(c + (r() - 0.5) * 0.09, 0.03, 0.82), i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i, p = top[i], q = top[i + 1];
          if (!p || !q) continue;
          const h = ((size[0] ?? 0) + r() * (size[1] ?? 0)) * Math.min(1.15, Math.max(0.7, S / 640)), cyp = r() < 0.4;
          const x = p[0] + (q[0] - p[0]) * f, y = p[1] + (q[1] - p[1]) * f + 3, tall = cyp ? h * 1.18 : h, half = cyp ? tall * 0.19 : h * 0.25;
          if (roof(X(x) - half, X(x) + half, y - tall) > y - tall + 0.5) continue;
          trees += cyp ? cypress(X(x), y, tall) : pine(X(x), y, h);
        }
      }
      let foam = '';
      for (let j = 0; j < 4; j++) {
        const w = 6 + r() * 16, x = toe[0] - 6 - j * (14 + r() * 18);
        foam += `M${xy(X(x) - w / 2, base - 1)}h${r1(w)}`;
      }
      parts.push({ kind: 'land', side, tone: L.tone, base: r1(base), refl: pathOf(refl, X), rock: rockD + trees, face: pathOf(band, X), foam });
    }
  }
  return { ripples, parts, height: r1(foot + 90) };
}

/**
 * The cove for these numbers. The land stands as high as the sky allows, unless the words would meet it: then all of it is
 * drawn lower, by as much as the highest point under the words needs, so the hills keep their shape instead of being cut flat.
 */
function drawCove(plan: Plan): Drawing {
  const reach: Reach[] = [];
  const full = draw(plan, plan.sky, reach);
  let fit = plan.sky;
  for (const p of reach) {
    const roof = Math.min(roofOver(plan.words, p.x, p.x), plan.line - LOW);
    if (p.k > 0 && Number.isFinite(roof)) fit = Math.min(fit, (plan.line + p.lift - roof) / p.k);
  }
  return fit < plan.sky ? draw(plan, Math.max(0, fit * 0.995)) : full;
}

/** How each depth goes by as you sail out: how far (a share of the width), how much nearer it comes, and its share of the time. */
const OUT: Record<Tone | 'stacks', readonly [number, number, number]> = { near: [0.98, 2.4, 0.7], mid: [0.88, 1.8, 0.84], stacks: [0.82, 1.5, 0.94], far: [0.8, 1.35, 1] };
const PASS = 'cubic-bezier(.55, 0, .3, 1)';

export interface CoveProps {
  /** How wide the scene is, in px. */
  width: number;
  /** Where the horizon is, in px from the top of the scene. */
  line: number;
  /** How tall the sky is, which sets how high the land stands: the horizon's own height unless the scene has moved. */
  sky?: number | undefined;
  /** Where the nearest cliffs meet the water, in px from the top. */
  foot: number;
  /** The words on the sky, in the scene's px, that no cliff or tree rises in front of. */
  words: readonly CoveWords[];
  /** Which cove: the same seed and numbers always draw the same one. */
  seed: number;
  /** Sailing out of it: the headlands go by on either side, nearest first, and the bay's ripples slide away. In ms. */
  out?: { delay: number; ms: number } | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}

export const Cove = memo(function Cove({ width, line, sky, foot, words, seed, out, ref }: CoveProps) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const { ripples, parts, height } = useMemo(() => drawCove({ width, line, sky: sky ?? line, foot, words, seed }), [width, line, sky, foot, words, seed]);
  const groups = useRef<(SVGGElement | null)[]>([]);
  const rips = useRef<SVGGElement>(null);
  const delay = out?.delay, ms = out?.ms;

  useLayoutEffect(() => {
    if (delay === undefined || ms === undefined) return undefined;
    const running: Animation[] = [];
    parts.forEach((p, i) => {
      const g = groups.current[i];
      if (!g) return;
      const left = p.kind === 'land' && p.side === 'l';
      const [dx, sc, share] = OUT[p.kind === 'land' ? p.tone : 'stacks'];
      g.style.transformOrigin = `${left ? 0 : width}px ${p.base}px`;
      running.push(g.animate([{ transform: 'none' }, { transform: `translateX(${r1((left ? -1 : 1) * dx * width)}px) scale(${sc})` }], { duration: ms * share, delay, easing: PASS, fill: 'both' }));
    });
    const g = rips.current;
    if (g) running.push(g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${Math.round(height * 0.14)}px)` }], { duration: ms * 0.7, delay, easing: PASS, fill: 'both' }));
    return () => { for (const a of running) a.cancel(); };
  }, [parts, width, height, delay, ms]);

  const pattern = `cv-p${id}`, mask = `cv-m${id}`;
  return (
    <div ref={ref} className="cv">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* The reflections are striped: the mask lets through two and a half px of every five. */}
        <defs>
          <pattern id={pattern} width="14" height="5" patternUnits="userSpaceOnUse"><rect width="14" height="2.6" fill="white" /></pattern>
          <mask id={mask}><rect width={width} height={height} fill={`url(#${pattern})`} /></mask>
        </defs>
        <g ref={rips} className="cv-rips"><path d={ripples} /></g>
        {parts.map((p, i) => (
          <g key={p.kind === 'land' ? `${p.tone}-${p.side}` : 'stacks'} ref={(el) => { groups.current[i] = el; }} className={p.kind === 'land' ? `cv-${p.tone}` : 'cv-stacks'}>
            <path className="cv-refl" d={p.refl} mask={`url(#${mask})`} />
            <path className="cv-rock" d={p.rock} />
            {p.kind === 'land' && <path className="cv-face" d={p.face} />}
            {p.kind === 'land' && <path className="cv-foam" d={p.foam} />}
          </g>
        ))}
      </svg>
    </div>
  );
});

/* ------------------------------------------------------- signing in: out of the cove to Home */

/** Where the welcome page's cove stood on the window as a way in was pressed (px), and which cove it was. */
export interface SailFrom {
  /** How wide the window is, which the cove is drawn across. */
  width: number;
  /** Its horizon, from the top of the window. */
  line: number;
  /** How tall its sky was, which set how high its land stood. */
  sky: number;
  /** Where its nearest cliffs met the water. */
  foot: number;
  /** How far its sun's middle stood below the horizon: sunk as the page scrolled on, or above it, lifted by pointing at Google. */
  sun: number;
  /** Its sun's radius. */
  r: number;
  /** The words on its sky, which no cliff or tree rose in front of. */
  words: readonly CoveWords[];
  seed: number;
}

/** Home as it's laid out under the sail (px on the window): where it ends up, and the parts of it that come in. */
export interface SailHome {
  /** Home's horizon. */
  line: number;
  /** Its sun's middle, across the window. */
  x: number;
  /** Its sun's radius. */
  r: number;
  /** The page's rounded edge, as insets from the window's edges, and its radius. None on a phone, which has no frame. */
  frame: { top: number; right: number; bottom: number; left: number; radius: number } | null;
  /** What slides in from the left as the frame forms: the side panel's contents. */
  side: Element | null;
  /** What rises into place as the sea clears, in order. */
  rise: readonly Element[];
}

/**
 * The sail, in ms. The cove comes in over what was on screen (IN); the headlands go by, the horizon comes up and the sun
 * eases to Home's (SAIL); the frame forms 60% of the way out, and Home rises in as the sea clears, 86% of the way.
 */
const IN = 380;
const SAIL = 2600;
const FRAME_AT = IN + SAIL * 0.6;
const FRAME_MS = 900;
const CLEAR_AT = IN + SAIL * 0.86;
const CLEAR_MS = 600;
const RISE_MS = 700;
const RISE_EACH = 90;
const SKIP_MS = 200;
const ARRIVE = `cubic-bezier(${EASE.out.join(', ')})`;
const SAILING = { delay: IN, ms: SAIL } as const;
const NOTHING: Showing = { kind: null };
/** Eased at both ends, as the sea carries you. */
const carry = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hundredths = (v: number) => Math.round(v * 100) / 100;
const px = (v: number) => `${v.toFixed(2)}px`;

/**
 * Signing in, out of the cove to the real Home underneath (`home`). It plays once, as it mounts, over everything: in front
 * of the app and out of its way. Nothing in it can be focused, a press, a key, the wheel or a change of width clears it at
 * once, and it's done the moment Home has risen in.
 */
export function SailOut({ from, home, onDone }: { from: SailFrom; home: SailHome; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const sea = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const ride = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useLayoutEffect(() => { done.current = onDone; });
  const start = useRef({ from, home });

  useLayoutEffect(() => {
    const box = root.current, s = sea.current, v = veil.current, c = ride.current;
    if (!box || !s || !v || !c) return undefined;
    const { from, home } = start.current;
    let over = false;
    const finish = () => { if (!over) { over = true; done.current(); } };
    const ours: Animation[] = [];
    const theirs: Animation[] = [];
    ours.push(v.animate([{ opacity: 1, visibility: 'visible' }, { opacity: 0, visibility: 'hidden' }], { duration: IN, easing: 'ease-out', fill: 'forwards' }));

    /* The horizon comes up to Home's with the cove riding on it, and the sun eases to Home's size and onto the horizon. Its
       middle moves by the same eased share as the horizon, so it only ever rises. */
    const fromSun = from.line + from.sun;
    let raf = 0;
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const e = carry(clamp((now - t0 - IN) / SAIL, 0, 1));
      const line = hundredths(from.line + (home.line - from.line) * e);
      const sun = hundredths(fromSun + (home.line - fromSun) * e);
      s.style.setProperty('--hz', px(line));
      s.style.setProperty('--cv-sink', px(sun - line));
      s.style.setProperty('--cv-sun-r', px(from.r + (home.r - from.r) * e));
      c.style.transform = `translateY(${px(line - from.line)})`;
      if (e < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    /* Alcove's frame forms round the sea: the page takes its rounded edge, its sun where Home's is, and the side panel
       slides in beside it. */
    const f = home.frame;
    if (f) {
      const shift = hundredths(home.x - box.clientWidth / 2);
      ours.push(s.animate([
        { transform: 'none', clipPath: 'inset(0px 0px 0px 0px round 0px)' },
        { transform: `translateX(${shift}px)`, clipPath: `inset(${f.top}px ${f.right + shift}px ${f.bottom}px ${f.left - shift}px round ${f.radius}px)` }
      ], { duration: FRAME_MS, delay: FRAME_AT, easing: ARRIVE, fill: 'both' }));
      if (home.side) theirs.push(home.side.animate([{ transform: 'translateX(-100%)' }, { transform: 'none' }], { duration: FRAME_MS, delay: FRAME_AT, easing: ARRIVE, fill: 'backwards' }));
    }
    /* Home rises in as the sea clears, and the sea lets go of the page. */
    home.rise.forEach((el, i) => theirs.push(el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: RISE_MS, delay: CLEAR_AT + i * RISE_EACH, easing: ARRIVE, fill: 'backwards' })));
    const clear = box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLEAR_MS, delay: CLEAR_AT, easing: 'ease-out', fill: 'forwards' });
    ours.push(clear);
    const letGo = setTimeout(() => { s.style.pointerEvents = 'none'; }, CLEAR_AT);
    let left = 1 + theirs.length;
    const one = () => { left -= 1; if (left === 0) finish(); };
    for (const a of [clear, ...theirs]) a.addEventListener('finish', one);

    /* Pressed, a key, the wheel, or the window made narrower or wider: Home is there at once, and the sea clears quickly. A
       phone's address bar coming and going changes only the height, which nothing here depends on. */
    let skipped = false;
    const wide = box.clientWidth;
    const resized = () => { if (box.clientWidth !== wide) skip(); };
    const skip = () => {
      if (skipped || over) return;
      skipped = true;
      s.style.pointerEvents = 'none';
      v.style.pointerEvents = 'none';
      for (const a of [clear, ...theirs]) a.removeEventListener('finish', one);
      for (const a of theirs) a.finish();
      const now = Number.parseFloat(getComputedStyle(box).opacity);
      clear.cancel();
      const quick = box.animate([{ opacity: Number.isFinite(now) ? now : 1 }, { opacity: 0 }], { duration: SKIP_MS, easing: 'ease-out', fill: 'forwards' });
      ours.push(quick);
      quick.addEventListener('finish', finish);
    };
    addEventListener('keydown', skip, true);
    addEventListener('wheel', skip, { passive: true });
    addEventListener('resize', resized);
    box.addEventListener('pointerdown', skip);
    return () => {
      removeEventListener('keydown', skip, true);
      removeEventListener('wheel', skip);
      removeEventListener('resize', resized);
      box.removeEventListener('pointerdown', skip);
      clearTimeout(letGo);
      cancelAnimationFrame(raf);
      /* Whatever happens, Home's own parts are left as they'd be without the sail. */
      for (const a of theirs) a.finish();
      for (const a of ours) a.cancel();
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={root} className="cv-out" aria-hidden="true">
      <div ref={sea} className="cv-sea" style={{ '--hz': `${from.line}px`, '--cv-sink': `${from.sun}px`, '--cv-sun-r': `${from.r}px` }}>
        <Horizon moment="home" only={NOTHING} land={<Cove ref={ride} width={from.width} line={from.line} sky={from.sky} foot={from.foot} words={from.words} seed={from.seed} out={SAILING} />} />
      </div>
      <div ref={veil} className="cv-veil" />
    </div>,
    document.body
  );
}
