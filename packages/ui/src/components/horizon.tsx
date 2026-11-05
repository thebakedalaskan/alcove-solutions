/*
 * The evening behind every page: a sky and a sea meeting at --hz, which each page sets as tall as the page is one action.
 * Home is the sunset, and every other page is a moment of the same evening (`moment`): the sun low, then gone, then the
 * night Record is set in. A page goes on it with `Evening`.
 *
 * It moves a little so the page feels awake: the water, the light on it, the clouds, the stars. Everything that moves is
 * a plain element animating transform and opacity, which the browser runs off the main thread, in long cycles that wake
 * it rarely, so a page left open all day costs next to nothing. Each element's resting state is the drawing itself: with
 * reduced motion it's a still picture.
 *
 * Once in a while something passes through, drawn flat like the rest of the scene: gulls, things leaping out of the water,
 * a whale's tail, a shooting star, a balloon in the corner, and boats and ships along the horizon. They come at random, one
 * at a time; the ships take minutes and are sometimes already out there when the page opens. With reduced motion nothing
 * comes. Shown for itself rather than behind a page (`only`), the scene brings one kind of visitor over and over, or none.
 */
import { useReducedMotion } from 'motion/react';
import { memo, useEffect, useMemo, useRef, useState, type AnimationEvent, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../cn';

export type Moment = 'home' | 'team' | 'notes' | 'drive' | 'note' | 'settings' | 'record';

/** A small generator, so the sea is the same on every visit. */
function seeded(seed: number): () => number {
  let n = seed;
  return () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
}

interface Stroke { x: number; y: number; w: number; o: number }
interface Glint extends Stroke { far: number; every: number; after: number }
interface Star { x: number; y: number; s: number; o: number; every: number; after: number }
/** A cloud: where it rests across the page (%) and up the sky (a share of its height), and how long it takes to cross. */
interface Cloud { x: number; at: number; w: number; rows: number; takes: number }
interface Bar { x: number; y: number; w: number; lit: number }

interface Drawing { sun: boolean; glitter: number; shine: number; chop: number; stars: number; streaks: boolean; clouds: Cloud[] }

const CHOP_REACH = 1700;
const CHOP_PER_ROW = 26;
const CHOP_LAYERS = 3;
const SUN_GAP = 106;
const STREAKS: Stroke[] = [{ x: -430, y: -92, w: 460, o: 0.5 }, { x: 40, y: -60, w: 340, o: 0.4 }, { x: -300, y: -34, w: 520, o: 0.35 }];

const MOMENTS: Record<Moment, Drawing> = {
  home: {
    sun: true, glitter: 190, shine: 1, chop: 5, stars: 0, streaks: true,
    clouds: [{ x: 9, at: 0.24, w: 290, rows: 6, takes: 560 }, { x: 66, at: 0.1, w: 210, rows: 5, takes: 800 }, { x: 82, at: 0.44, w: 330, rows: 7, takes: 470 }, { x: 34, at: 0.56, w: 170, rows: 4, takes: 690 }]
  },
  team: {
    sun: true, glitter: 120, shine: 1, chop: 5, stars: 0, streaks: true,
    clouds: [{ x: 78, at: 0.12, w: 270, rows: 6, takes: 600 }, { x: 6, at: 0.34, w: 230, rows: 5, takes: 740 }, { x: 44, at: 0.05, w: 170, rows: 4, takes: 860 }]
  },
  notes: { sun: false, glitter: 70, shine: 0.55, chop: 5, stars: 7, streaks: false, clouds: [{ x: 16, at: 0.3, w: 230, rows: 4, takes: 720 }, { x: 72, at: 0.14, w: 170, rows: 3, takes: 900 }] },
  drive: { sun: false, glitter: 50, shine: 0.45, chop: 4, stars: 5, streaks: false, clouds: [{ x: 64, at: 0.24, w: 220, rows: 4, takes: 780 }, { x: 10, at: 0.12, w: 160, rows: 3, takes: 960 }] },
  note: { sun: false, glitter: 0, shine: 0, chop: 2, stars: 4, streaks: false, clouds: [{ x: 58, at: 0.2, w: 190, rows: 3, takes: 880 }] },
  settings: { sun: false, glitter: 0, shine: 0, chop: 2, stars: 0, streaks: false, clouds: [{ x: 44, at: 0.26, w: 190, rows: 3, takes: 960 }] },
  record: { sun: true, glitter: 150, shine: 1, chop: 5, stars: 22, streaks: false, clouds: [{ x: 24, at: 0.3, w: 260, rows: 4, takes: 940 }] }
};

function drawSea({ sun, glitter, shine, chop: rows }: Drawing): { glints: Glint[]; chop: Stroke[][] } {
  const r = seeded(7);
  const beat = seeded(11);
  const glints: Glint[] = [];
  for (let y = 7; y < glitter; y += 8) {
    const far = y / glitter;
    const spread = 16 + far * 70;
    const n = 1 + Math.round(r() * 2);
    for (let i = 0; i < n; i++) {
      const w = (8 + r() * 30) * (0.7 + far) * 1.4;
      const off = (r() - 0.5) * 2 * spread;
      glints.push({ x: off - w / 2, y, w, o: (0.86 - far * 0.6) * shine, far, every: 34 + beat() * 22, after: -beat() * 56 });
    }
  }
  const chop: Stroke[][] = Array.from({ length: CHOP_LAYERS }, () => []);
  for (let row = 0; row < rows; row++) {
    for (let k = 0; k < CHOP_PER_ROW; k++) {
      const w = 20 + r() * 70;
      const x = -CHOP_REACH + r() * CHOP_REACH * 2;
      if (sun && Math.abs(x) < SUN_GAP) continue;
      chop[row % CHOP_LAYERS]?.push({ x, y: 11 + row * 13, w, o: 0.05 + r() * 0.09 });
    }
  }
  return { glints, chop };
}

function drawStars(n: number): Star[] {
  const r = seeded(41);
  return Array.from({ length: n }, () => ({ x: 3 + r() * 94, y: 4 + r() * r() * 82, s: 1 + r() * 1.4, o: 0.25 + r() * 0.5, every: 38 + r() * 26, after: -r() * 60 }));
}

/** A cloud as the sun's own stripes draw it: thin bars, widest at the bottom, where the last of the light catches them. */
function drawCloud({ w, rows }: Cloud, seed: number): Bar[] {
  const r = seeded(seed);
  return Array.from({ length: rows }, (_, i) => {
    const up = i / rows;
    const width = w * Math.pow(1 - up, 0.75) * (0.82 + r() * 0.3);
    return { x: (w - width) * (0.25 + r() * 0.5), y: -i * 7, w: width, lit: 1 - up };
  });
}

const drawn = (moment: Moment) => {
  const m = MOMENTS[moment];
  return { ...m, ...drawSea(m), starry: drawStars(m.stars), puffs: m.clouds.map((c, i) => ({ ...c, bars: drawCloud(c, 61 + i * 17) })) };
};
const SCENES: Record<Moment, ReturnType<typeof drawn>> = { home: drawn('home'), team: drawn('team'), notes: drawn('notes'), drive: drawn('drive'), note: drawn('note'), settings: drawn('settings'), record: drawn('record') };

/* ------------------------------------------------------- what passes through */
type Span = readonly [number, number];
const between = ([a, b]: Span) => a + Math.random() * (b - a);
const coin = (chance = 0.5) => Math.random() < chance;
const pick = <T,>(from: readonly T[]): T | undefined => from[Math.floor(Math.random() * from.length)];
/** As long as it takes at this speed, on this screen, so a boat is as slow on a phone as on a wide window. */
const crossing = (pxPerSecond: number) => ((innerWidth + 240) / pxPerSecond) * 1000;

/** Everything afloat, drawn at its size in pixels. `funnel` is where its smoke starts, and `lamp` the light it shows after dark. */
interface Craft { w: number; h: number; speed: number; lamp: readonly [number, number]; funnel?: readonly [number, number] | undefined; shape: readonly string[] }
const SHIPS = {
  sail: { w: 40, h: 30, speed: 8, lamp: [30, 19], shape: ['M20 1C26 8 30.5 15 31.5 22H20Z', 'M18 6C13.5 11 10 16.5 8 22H18Z', 'M3 24H37C36 27 33.5 29 30.5 29H9.5C6.5 29 4 27 3 24Z'] },
  steamer: { w: 58, h: 28, speed: 11, lamp: [46, 15], funnel: [20, 0], shape: ['M1 19H57L52 27H7Z', 'M13 13H43V18H13Z', 'M31 8H40V12H31Z', 'M20 3H26.5V12H20Z', 'M47 3V18H45.5V3Z'] },
  trawler: { w: 50, h: 30, speed: 9, lamp: [37, 13], shape: ['M2 20H48L44 28H8C5 28 3 24 2 20Z', 'M28 11H40V20H28Z', 'M16 2H17.5V20H16Z', 'M17 3.5L31 11L30.4 12L16.6 4.6Z', 'M6 13H7.5V20H6Z', 'M10 13H11.5V20H10Z', 'M5 12H12.5V13.5H5Z'] },
  tug: { w: 44, h: 26, speed: 14, lamp: [29, 12], funnel: [20, -3], shape: ['M1 17C8 19 30 19 43 14L40 25H8C5 25 2 21 1 17Z', 'M14 10H30V17H14Z', 'M17 5H27V10H17Z', 'M21 0H25V5H21Z'] },
  tall: {
    w: 64, h: 46, speed: 6, lamp: [52, 31],
    shape: ['M2 34H60L56 44H9C6 44 4 40 2 34Z', 'M60 34L64 30L60.5 35Z', 'M15.4 8H16.6V34H15.4Z', 'M30.4 1H31.6V34H30.4Z', 'M45.4 6H46.6V34H45.4Z', 'M11 19H21C22 24 22 28 21 31H11C12 28 12 24 11 19Z', 'M12.5 9H19.5C20.5 12 20.5 15 19.5 17H12.5C13.5 15 13.5 12 12.5 9Z', 'M24 15H38C39 21 39 27 38 31H24C25 27 25 21 24 15Z', 'M26 3H36C37 7 37 10 36 13H26C27 10 27 7 26 3Z', 'M40 18H52C53 23 53 28 52 31H40C41 28 41 23 40 18Z', 'M42 7H50C51 10 51 13 50 15H42C43 13 43 10 42 7Z', 'M53 31L63 31L53.5 19Z']
  },
  freighter: { w: 84, h: 24, speed: 7, lamp: [15, 8], funnel: [11, -2], shape: ['M1 14H83L79 23H6C4 23 2 18 1 14Z', 'M8 5H20V14H8Z', 'M11 1H15V5H11Z', 'M24 8H32V14H24Z', 'M33 6H41V14H33Z', 'M42 8H50V14H42Z', 'M51 6H59V14H51Z', 'M60 9H68V14H60Z', 'M70 14H83V11Z'] }
} as const satisfies Record<string, Craft>;
type Ship = keyof typeof SHIPS;

/** What leaps, facing right, and the viewBox it's drawn in. How high and how far each goes is in the stylesheet. */
const LEAPERS = {
  fish: { box: '0 0 19 10', d: 'M18 5C15 1 9 0 5 4L1 1.5V8.5L5 6C9 10 15 9 18 5Z' },
  minnow: { box: '0 0 12 6', d: 'M11.5 3C9.5 .8 6 .6 3.5 2.2L.5 .8V5.2L3.5 3.8C6 5.4 9.5 5.2 11.5 3Z' },
  flyer: { box: '0 0 30 12', d: 'M29 6.5C25 4 18 4 13 5.5L5 3L7.5 7L4 10.5L13 8.2C18 9.6 25 9 29 6.5ZM20.5 5.1L11 .5L12.6 5.3Z' },
  marlin: { box: '0 0 46 18', d: 'M46 7L33 8C30 5.5 24 4.5 18 5.5C13 6.5 9 8 6 8.5L1 4L3 9.5L1 15L7 10.5C11 11.5 17 13 23 12.5C27 12.2 31 10.8 33 9.4ZM30 5.4C27 1.5 22 .5 16 1C18 3 18.5 4.5 18.5 5.6Z' },
  dolphin: { box: '0 0 34 16', d: 'M1 11C6 5 13 2 19 2L23 0L23.5 3C27 4 30 6 33 10L29.5 9C26 9 25 9 22 9.5C17 10 12 12 8 14.5L6 12.5C4 12.5 2.5 12 1 11Z' }
} as const;
type Shape = keyof typeof LEAPERS;
interface Jump { shape: Shape; late: string; x: number; y: number }
/** Who goes up in each leap, one after another. */
const LEAPS = {
  fish: [{ shape: 'fish', late: '0s', x: 0, y: 0 }],
  flyer: [{ shape: 'flyer', late: '0s', x: 0, y: 0 }],
  marlin: [{ shape: 'marlin', late: '0s', x: 0, y: 0 }],
  dolphins: [{ shape: 'dolphin', late: '0s', x: 0, y: 0 }, { shape: 'dolphin', late: '.55s', x: -30, y: 3 }],
  school: [
    { shape: 'minnow', late: '0s', x: 0, y: 0 }, { shape: 'minnow', late: '.13s', x: 13, y: 4 }, { shape: 'minnow', late: '.27s', x: -11, y: 3 },
    { shape: 'minnow', late: '.4s', x: 24, y: -1 }, { shape: 'minnow', late: '.56s', x: 6, y: 7 }
  ]
} as const satisfies Record<string, readonly Jump[]>;
type Leaping = keyof typeof LEAPS;

type Quick =
  | { kind: 'gulls'; birds: number; left: boolean; y: number; ms: number }
  | { kind: Leaping; x: number; y: number; back: boolean }
  | { kind: 'whale'; x: number; y: number }
  | { kind: 'star'; x: number; y: number; back: boolean };
type Slow = { kind: Ship; left: boolean; ms: number; into: number } | { kind: 'balloon'; ms: number };

/** What comes to a moment. Heights are from the horizon: up for gulls, down for what leaps. */
interface Life { quick: readonly Quick['kind'][]; slow: readonly Slow['kind'][]; gulls: Span; fish: Span }
const LIFE: Record<Moment, Life> = {
  home: { quick: ['gulls', 'gulls', 'gulls', 'fish', 'fish', 'dolphins', 'school', 'flyer', 'marlin', 'whale'], slow: ['sail', 'sail', 'steamer', 'trawler', 'tall', 'freighter', 'tug', 'balloon'], gulls: [42, 104], fish: [30, 58] },
  team: { quick: ['gulls', 'gulls', 'fish', 'school', 'flyer', 'dolphins'], slow: ['sail', 'steamer', 'trawler', 'tall', 'tug'], gulls: [46, 120], fish: [34, 56] },
  notes: { quick: ['gulls', 'star', 'fish', 'school'], slow: ['sail', 'trawler', 'freighter'], gulls: [16, 44], fish: [16, 34] },
  drive: { quick: ['gulls', 'star', 'fish'], slow: ['sail', 'tug', 'trawler'], gulls: [18, 48], fish: [14, 30] },
  note: { quick: ['star'], slow: [], gulls: [0, 0], fish: [0, 0] },
  settings: { quick: [], slow: ['sail', 'freighter'], gulls: [0, 0], fish: [0, 0] },
  record: { quick: ['star', 'star', 'fish', 'whale'], slow: ['sail', 'tall', 'trawler'], gulls: [0, 0], fish: [30, 70] }
};

function quickVisit(kind: Quick['kind'], life: Life): Quick {
  switch (kind) {
    case 'gulls': return { kind, birds: pick([1, 3, 3, 5]) ?? 1, left: coin(), y: between(life.gulls), ms: crossing(between([105, 150])) };
    case 'whale': return { kind, x: between([8, 88]), y: between([8, 16]) };
    case 'star': return { kind, x: between([12, 78]), y: between([6, 34]), back: coin() };
    case 'dolphins': return { kind, x: between([6, 86]), y: between([10, 20]), back: coin() };
    default: return { kind, x: between([6, 90]), y: between(life.fish), back: coin() };
  }
}

const QUICK_FIRST: Span = [5_000, 12_000];
const QUICK_GAP: Span = [22_000, 60_000];
const SLOW_FIRST: Span = [30_000, 120_000];
const SLOW_GAP: Span = [150_000, 360_000];
const BALLOON_MS: Span = [34_000, 44_000];

function slowVisit(kind: Slow['kind'], into = 0): Slow {
  return kind === 'balloon' ? { kind, ms: between(BALLOON_MS) } : { kind, left: coin(), ms: crossing(SHIPS[kind].speed), into };
}

interface Lane<T> { arrive: () => T | null; first: Span; gap: Span; already?: (() => T | null) | undefined }

/** What's passing through a lane, if anything, and the way to say it's gone. The next one comes after a wait. */
function useVisits<T>(lane: Lane<T>): [T | null, () => void] {
  const [here, setHere] = useState<T | null>(() => lane.already?.() ?? null);
  const wait = useRef(here === null ? lane.first : lane.gap);
  useEffect(() => {
    if (here !== null) return undefined;
    const t = setTimeout(() => { wait.current = lane.gap; setHere(lane.arrive()); }, between(wait.current));
    return () => clearTimeout(t);
  }, [here, lane]);
  return [here, () => setHere(null)];
}

/** Ends what's passing through once its own animation has, not one of the moving parts inside it. */
const onEnd = (gone: () => void) => (e: AnimationEvent) => { if (e.target === e.currentTarget) gone(); };

/* A gull in three poses, wings up, level and down. They take turns like the pages of a flip-book, so it really beats its wings. */
const POSES = [
  'M3 .5C5 3 7.5 5.5 10 6.6C11.6 7.3 13 7.9 14 8.6C15 7.9 16.4 7.3 18 6.6C20.5 5.5 23 3 25 .5C24.6 3.6 22.6 6.6 19.6 8.2C17.4 9.4 15.4 10 14 11C12.6 10 10.6 9.4 8.4 8.2C5.4 6.6 3.4 3.6 3 .5Z',
  'M0 6.5C3 4.5 7 3 10 4.5C11.6 5.3 13 7 14 8.2C15 7 16.4 5.3 18 4.5C21 3 25 4.5 28 6.5C24.5 5.6 21 5.4 18.5 6.6C16.6 7.6 15.2 9.2 14 10.4C12.8 9.2 11.4 7.6 9.5 6.6C7 5.4 3.5 5.6 0 6.5Z',
  'M2 13C3.6 10.4 6.6 7.6 10 6.8C11.6 6.4 13 6.4 14 7C15 6.4 16.4 6.4 18 6.8C21.4 7.6 24.4 10.4 26 13C23.4 11.2 20.6 9.8 18 9.4C16.4 9.2 15 9.4 14 10C13 9.4 11.6 9.2 10 9.4C7.4 9.8 4.6 11.2 2 13Z'
] as const;
/** A loose V behind the leader, who flies at the front whichever way they're going. */
const FLOCK = [{ x: 0, y: 0, w: 28, after: '0s' }, { x: -30, y: -11, w: 23, after: '-1.7s' }, { x: -34, y: 12, w: 22, after: '-3.1s' }, { x: -58, y: -20, w: 19, after: '-.8s' }, { x: -64, y: 22, w: 18, after: '-4.3s' }];

function Gulls({ v, gone }: { v: Extract<Quick, { kind: 'gulls' }>; gone: () => void }) {
  return (
    <div className={cn('hz-fly', v.left && 'is-left')} style={{ top: `calc(var(--hz) - ${v.y}px)`, animationDuration: `${v.ms}ms` }} onAnimationEnd={onEnd(gone)}>
      <div className="hz-glide">
        {FLOCK.slice(0, v.birds).map((b) => (
          <div key={b.x} className="hz-gull" style={{ left: b.x, top: b.y, width: b.w, '--after': b.after }}>
            {POSES.map((d, i) => <svg key={d} className={`is-${i}`} viewBox="0 0 28 14"><path d={d} /></svg>)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Something leaping: off the water at one ring and back in at another, and the last ring says it's over. */
function Jumped({ jump, gone }: { jump: Jump; gone?: (() => void) | undefined }) {
  const { box, d } = LEAPERS[jump.shape];
  return (
    <div className={`hz-jump is-${jump.shape}`} style={{ left: jump.x, top: jump.y, '--late': jump.late }}>
      <i className="hz-ring" />
      <div className="hz-along"><div className="hz-arc"><svg className="hz-leaper" viewBox={box}><path d={d} /></svg></div></div>
      <i className="hz-ring is-late" onAnimationEnd={gone} />
    </div>
  );
}

function Leap({ v, gone }: { v: Extract<Quick, { kind: Leaping }>; gone: () => void }) {
  const jumps: readonly Jump[] = LEAPS[v.kind];
  return (
    <div className={cn('hz-leap', v.back && 'is-back')} style={{ left: `${v.x}%`, top: `calc(var(--hz) + ${v.y}px)` }}>
      {jumps.map((j, i) => <Jumped key={j.late} jump={j} gone={i === jumps.length - 1 ? gone : undefined} />)}
    </div>
  );
}

/** A whale's tail, far out: up out of the water, a moment there, and down again. */
function Whale({ v, gone }: { v: Extract<Quick, { kind: 'whale' }>; gone: () => void }) {
  return (
    <div className="hz-whale" style={{ left: `${v.x}%`, top: `calc(var(--hz) + ${v.y}px)` }}>
      <div className="hz-sound"><svg className="hz-tail" viewBox="0 0 44 28" onAnimationEnd={gone}><path d="M22 28C20.5 20 19.5 15 19 12C17 12.5 12.5 11.5 8 8C5 5.5 2.5 3 1 1C6 1.5 13 2 17.5 4C20 5 21.5 6.3 22 7.3C22.5 6.3 24 5 26.5 4C31 2 38 1.5 43 1C41.5 3 39 5.5 36 8C31.5 11.5 27 12.5 25 12C24.5 15 23.5 20 22 28Z" /></svg></div>
      <i className="hz-ring" /><i className="hz-ring is-late" />
    </div>
  );
}

function Shooting({ v, gone }: { v: Extract<Quick, { kind: 'star' }>; gone: () => void }) {
  return <i className={cn('hz-shoot', v.back && 'is-back')} style={{ left: `${v.x}%`, top: `calc(var(--hz) * ${v.y / 100})` }} onAnimationEnd={onEnd(gone)} />;
}

function Boat({ v, gone }: { v: Extract<Slow, { left: boolean }>; gone: () => void }) {
  const { w, h, lamp, shape, ...rest }: Craft = SHIPS[v.kind];
  const funnel = rest.funnel;
  return (
    <div className={cn('hz-sail', v.left && 'is-left')} style={{ '--cw': `${w}px`, animationDuration: `${v.ms}ms`, animationDelay: `${-v.into * v.ms}ms` }} onAnimationEnd={onEnd(gone)}>
      <div className="hz-craft" style={{ width: w, height: h }}>
        {funnel && <div className="hz-funnel" style={{ left: funnel[0], top: funnel[1] }}><i className="hz-smoke" /><i className="hz-smoke is-2" /><i className="hz-smoke is-3" /></div>}
        <svg className="hz-boat" viewBox={`0 0 ${w} ${h}`}>{shape.map((d) => <path key={d} d={d} />)}</svg>
        <i className="hz-lamp" style={{ left: lamp[0], top: lamp[1] }} />
      </div>
      <i className="hz-wake" /><i className="hz-wake is-2" /><i className="hz-wake is-3" />
    </div>
  );
}

/** A balloon keeps to the corner: in from the edge low down, up in a curve and out again higher up, in under a minute. */
function Balloon({ ms, gone }: { ms: number; gone: () => void }) {
  return (
    <div className="hz-peek" style={{ animationDuration: `${ms}ms` }} onAnimationEnd={onEnd(gone)}>
      <div className="hz-climb" style={{ animationDuration: `${ms}ms` }}>
        <svg className="hz-balloon" viewBox="0 0 30 44">
          <path d="M15 1C7 1 1 7 1 15C1 22.5 8 27 11 33H19C22 27 29 22.5 29 15C29 7 23 1 15 1Z" />
          <path className="hz-gore" d="M15 1C11.5 1 9 7 9 15C9 22 11.5 28 13 33H17C18.5 28 21 22 21 15C21 7 18.5 1 15 1Z" />
          <path d="M12.5 37H17.5V42H12.5Z" /><path className="hz-rope" d="M11.5 33L13 37M18.5 33L17 37" />
        </svg>
      </div>
    </div>
  );
}

function laneOf(moment: Moment): { quick: Lane<Quick>; slow: Lane<Slow> } {
  const life = LIFE[moment];
  const ships = life.slow.filter((k) => k !== 'balloon');
  const slowly = () => { const kind = pick(life.slow); return kind ? slowVisit(kind) : null; };
  return {
    quick: { arrive: () => { const kind = pick(life.quick); return kind ? quickVisit(kind, life) : null; }, first: QUICK_FIRST, gap: QUICK_GAP },
    /* Half the time a ship is already out there when the page opens. */
    slow: { arrive: slowly, first: SLOW_FIRST, gap: SLOW_GAP, already: () => { const kind = pick(ships); return kind && coin() ? slowVisit(kind, between([0.12, 0.5])) : null; } }
  };
}
const LANES: Record<Moment, ReturnType<typeof laneOf>> = { home: laneOf('home'), team: laneOf('team'), notes: laneOf('notes'), drive: laneOf('drive'), note: laneOf('note'), settings: laneOf('settings'), record: laneOf('record') };

/** One quick visitor, drawn as its kind is. */
function Quickly({ v, gone }: { v: Quick; gone: () => void }) {
  if (v.kind === 'gulls') return <Gulls v={v} gone={gone} />;
  if (v.kind === 'whale') return <Whale v={v} gone={gone} />;
  if (v.kind === 'star') return <Shooting v={v} gone={gone} />;
  return <Leap v={v} gone={gone} />;
}
/** One slow visitor: a boat or a ship along the horizon, or the balloon in the corner. */
function Slowly({ v, gone }: { v: Slow; gone: () => void }) {
  return v.kind === 'balloon' ? <Balloon ms={v.ms} gone={gone} /> : <Boat v={v} gone={gone} />;
}

/** Whatever's passing through. It redraws on its own, so the scene around it never does. */
function Passing({ moment }: { moment: Moment }) {
  const [quick, quickGone] = useVisits(LANES[moment].quick);
  const [slow, slowGone] = useVisits(LANES[moment].slow);
  return (
    <>
      {slow && <Slowly v={slow} gone={slowGone} />}
      {quick && <Quickly v={quick} gone={quickGone} />}
    </>
  );
}

/* ------------------------------------------------------- one visitor at a time, to look at */
/** Everything that passes through: the quick things, and the boats, the ships and the balloon. */
export type Visitor = Quick['kind'] | Slow['kind'];
const isSlow = (kind: Visitor): kind is Slow['kind'] => kind === 'balloon' || kind in SHIPS;
const isSlowVisit = (v: Quick | Slow): v is Slow => isSlow(v.kind);

const MOMENT_NAMES = Object.keys(LIFE).filter((m): m is Moment => m in LIFE);
/** Every kind of visitor and the moments it comes to, read from each moment's life, the quick ones first. */
export const VISITORS: readonly { kind: Visitor; moments: readonly Moment[] }[] = [
  ...new Set<Visitor>([...MOMENT_NAMES.flatMap((m) => LIFE[m].quick), ...MOMENT_NAMES.flatMap((m) => LIFE[m].slow)])
].map((kind) => ({ kind, moments: MOMENT_NAMES.filter((m) => LIFE[m].quick.some((k) => k === kind) || LIFE[m].slow.some((k) => k === kind)) }));

/**
 * What passes through when the scene is shown for itself rather than behind a page: one kind of visitor, again and again
 * with hardly a wait, its crossing `pace` times as fast; or, with no kind, nothing at all.
 */
export interface Showing { kind: Visitor | null; pace?: number | undefined }
const AGAIN_FIRST: Span = [300, 800];
const AGAIN_GAP: Span = [700, 1600];

function againOf(moment: Moment, kind: Visitor, pace: number): Lane<Quick | Slow> {
  const life = LIFE[moment];
  const arrive = (): Quick | Slow => {
    if (!isSlow(kind)) return quickVisit(kind, life);
    const v = slowVisit(kind);
    return { ...v, ms: v.ms / pace };
  };
  return { arrive, first: AGAIN_FIRST, gap: AGAIN_GAP };
}

function Again({ moment, kind, pace }: { moment: Moment; kind: Visitor; pace: number }) {
  const lane = useMemo(() => againOf(moment, kind, pace), [moment, kind, pace]);
  const [here, gone] = useVisits(lane);
  if (!here) return null;
  return isSlowVisit(here) ? <Slowly v={here} gone={gone} /> : <Quickly v={here} gone={gone} />;
}

function Visitors({ moment, only }: { moment: Moment; only?: Showing | undefined }) {
  if (useReducedMotion()) return null;
  if (!only) return <Passing moment={moment} />;
  return only.kind ? <Again moment={moment} kind={only.kind} pace={only.pace ?? 1} /> : null;
}

export const Horizon = memo(function Horizon({ moment, only }: { moment: Moment; only?: Showing | undefined }) {
  const scene = SCENES[moment];
  return (
    <div className="hz" data-moment={moment} aria-hidden="true">
      <div className="hz-sky" />
      <div className="hz-sea" />
      <div className="hz-up">
        {scene.starry.map((s) => <i key={`${s.x}-${s.y}`} className="hz-star" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, '--o': s.o, '--every': `${s.every}s`, '--after': `${s.after}s` }} />)}
        <div className="hz-light"><i className="hz-glow" />{scene.sun && <i className="hz-sun" />}</div>
        {scene.puffs.map((c) => (
          <div key={c.x} className="hz-puff" style={{ top: `calc(var(--hz) * ${c.at})`, '--x': c.x, '--takes': `${c.takes}s` }}>
            <div style={{ left: `${c.x}%` }}>{c.bars.map((b) => <i key={b.y} style={{ left: b.x, top: b.y, width: b.w, '--lit': b.lit }} />)}</div>
          </div>
        ))}
      </div>
      <div className="hz-at">
        {scene.streaks && STREAKS.map((c, i) => <i key={c.x} className="hz-cloud" style={{ left: c.x, top: c.y, width: c.w, opacity: c.o, '--i': i }} />)}
        <i className="hz-rim" />
        {scene.chop.map((layer, i) => (
          <div key={i} className="hz-chop" style={{ '--i': i }}>
            {layer.map((c) => <i key={`${c.x}-${c.y}`} style={{ left: c.x, top: c.y, width: c.w, opacity: c.o }} />)}
          </div>
        ))}
      </div>
      <div className="hz-light">
        {scene.glints.map((g) => <i key={`${g.x}-${g.y}`} className="hz-glint" style={{ left: g.x, top: g.y, width: g.w, '--o': g.o, '--far': g.far, '--every': `${g.every}s`, '--after': `${g.after}s` }} />)}
      </div>
      <Visitors moment={moment} only={only} />
    </div>
  );
});

/** A page on the evening: the scene behind it, out to the frame's edges, and the page at its own width in front. */
export function Evening({ moment, className, children, ...rest }: { moment: Moment; children: ReactNode } & Omit<ComponentProps<'div'>, 'children'>) {
  return (
    <div {...rest} className={cn('dusk', className)}>
      <Horizon moment={moment} />
      <div className="dusk-in">{children}</div>
    </div>
  );
}
