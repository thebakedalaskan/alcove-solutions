/*
 * A part of the welcome page on the evening: the scene behind it (`Horizon`), a sky as tall as what's in it, and the water
 * under the horizon for everything else. The horizon follows the sky's height, and the scene only moves while its horizon
 * is on screen. `sun` ties the sun to the scroll: the hero's sets as the page leaves it, the last one comes up as the page
 * reaches it. With reduced motion the sun stays where it's drawn.
 *
 * `cove` puts the part in a cove (`Cove`), looking out to sea. Its cliffs and trees never rise within 24px of the words on
 * the sky, measured where the words rest (an entrance doesn't move them), and it's drawn again when they move or the window
 * changes size. What's on the water starts below the cove's reflections (`--cv-reach`).
 */
import { COVE_REFLECTION, Cove, Horizon, cn, restingBox, useCoveFit, type CoveWords, type Moment, type SailFrom } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A cove for a part: which one (`seed`), and where its nearest cliffs meet the water for a sky this tall (px from the top). */
export interface SkyCove { seed: number; foot: (sky: number) => number }

/** The cove as a part draws it, in the part's own px. */
interface Land { width: number; line: number; foot: number; words: CoveWords[] }

/** The words on a part's sky (everything standing on it), and the nav over the top of the page, in the part's px. */
function wordsOn(part: HTMLElement, sky: HTMLElement): CoveWords[] {
  const words: CoveWords[] = [];
  for (const el of Array.from(sky.firstElementChild?.children ?? [])) {
    const box = el instanceof HTMLElement ? restingBox(el, part) : null;
    if (box && box.r > box.l) words.push(box);
  }
  const nav = Number.parseFloat(getComputedStyle(part).getPropertyValue('--lp-nav'));
  if (nav > part.offsetTop) words.push({ l: 0, r: part.clientWidth, b: nav - part.offsetTop });
  return words;
}

const sameLand = (a: Land | null, b: Land) => a !== null && a.width === b.width && a.line === b.line && a.foot === b.foot &&
  a.words.length === b.words.length && a.words.every((w, i) => { const v = b.words[i]; return v !== undefined && v.l === w.l && v.r === w.r && v.b === w.b; });

/**
 * A part's cove as it stands on the window now, if its horizon is in view: what signing in from it sails out of. Its sun is
 * measured where it's drawn, sunk by the scroll or lifted by pointing at Google.
 */
export function coveOnScreen(part: HTMLElement, cove: SkyCove): SailFrom | null {
  const sky = Number.parseFloat(part.style.getPropertyValue('--hz'));
  const up = part.querySelector(':scope > .lp-sky-up');
  const sun = part.querySelector(':scope > .hz .hz-sun');
  if (!(sky > 0) || !(up instanceof HTMLElement) || !sun) return null;
  const box = part.getBoundingClientRect();
  const line = box.top + sky;
  const tall = document.documentElement.clientHeight;
  if (line < tall * 0.25 || line > tall + 40) return null;
  const s = sun.getBoundingClientRect();
  return {
    width: part.clientWidth, line, sky, foot: box.top + Math.round(cove.foot(sky)), sun: s.top + s.height / 2 - line, r: s.height / 2,
    words: wordsOn(part, up).map((w) => ({ l: w.l + box.left, r: w.r + box.left, b: w.b + box.top })), seed: cove.seed
  };
}

export function Sky({ moment, sky, children, sun, cove, className, id }: {
  moment: Moment;
  /** What stands on the sky, above the horizon. Its height is where the horizon is. */
  sky: ReactNode;
  /** What sits on the water, under the horizon. */
  children?: ReactNode;
  /** The sun follows the scroll: `set` sinks as the page scrolls away, `rise` comes up as the page reaches it. */
  sun?: 'set' | 'rise' | undefined;
  /** The part looks out of this cove. */
  cove?: SkyCove | undefined;
  className?: string | undefined;
  id?: string | undefined;
}) {
  const box = useRef<HTMLElement>(null);
  const up = useRef<HTMLDivElement>(null);
  const eye = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion() ?? false;
  const [land, setLand] = useState<Land | null>(null);

  /* The horizon is where the sky ends, set before the part is first drawn, and the scene runs only while it's in view. */
  useLayoutEffect(() => {
    const el = box.current, top = up.current, watch = eye.current;
    if (!el || !top || !watch) return undefined;
    const sync = () => el.style.setProperty('--hz', `${Math.round(top.offsetHeight)}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(top);
    const io = new IntersectionObserver((es) => { const e = es.at(-1); if (e) el.classList.toggle('is-on', e.isIntersecting); }, { rootMargin: '80px 0px' });
    io.observe(watch);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);

  /*
   * The cove is drawn as the part is first laid out, and again a moment after anything it keeps clear of changes: the sky's
   * height, the words (a font arriving, or single sign-on opening in place, which brings something new to watch) or the window.
   */
  useCoveFit(() => {
    const el = box.current, top = up.current;
    if (!cove || !el || !top) return null;
    return () => {
      const line = Math.round(top.offsetHeight);
      const next: Land = { width: el.clientWidth, line, foot: Math.round(cove.foot(line)), words: wordsOn(el, top) };
      el.style.setProperty('--cv-reach', `${next.foot - line + COVE_REFLECTION}px`);
      setLand((was) => (sameLand(was, next) ? was : next));
      return [top, ...Array.from(top.firstElementChild?.children ?? [])];
    };
  }, [cove]);

  /*
   * The sun follows the scroll while its part is near the window, and is left alone the rest of the time. Where it stands
   * is written on the scene (the Horizon's own root), not on the part: the part holds everything on its water, and a
   * value set on it would restyle all of that every frame. A value that hasn't changed isn't written again.
   */
  useEffect(() => {
    const el = box.current;
    const scene = el?.querySelector(':scope > .hz');
    if (!el || !(scene instanceof HTMLElement) || !sun || reduce) return undefined;
    const name = sun === 'set' ? '--lp-set' : '--lp-rise';
    let frame = 0;
    let written = '';
    const draw = () => {
      frame = 0;
      const hz = Number.parseFloat(el.style.getPropertyValue('--hz')) || 600;
      const at = sun === 'set'
        ? scrollY / (hz * 0.8)
        : (el.getBoundingClientRect().top + hz - 0.72 * innerHeight) / (0.3 * innerHeight);
      const v = clamp(at, 0, 1).toFixed(3);
      if (v === written) return;
      written = v;
      scene.style.setProperty(name, v);
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(draw); };
    let near = false;
    const follow = (on: boolean) => {
      if (on === near) return;
      near = on;
      if (on) {
        addEventListener('scroll', later, { passive: true });
        addEventListener('resize', later);
      } else {
        removeEventListener('scroll', later);
        removeEventListener('resize', later);
      }
    };
    /* Near: within a window's height of the window, so the sun is in place before any of the part shows. */
    const io = new IntersectionObserver((es) => {
      const e = es.at(-1);
      if (!e) return;
      draw();
      follow(e.isIntersecting);
    }, { rootMargin: '100% 0px' });
    draw();
    io.observe(el);
    return () => {
      io.disconnect();
      follow(false);
      cancelAnimationFrame(frame);
      scene.style.removeProperty(name);
    };
  }, [sun, reduce]);

  const seed = cove?.seed;
  const ground = useMemo(() => (land && seed !== undefined ? <Cove width={land.width} line={land.line} foot={land.foot} words={land.words} seed={seed} /> : undefined), [land, seed]);

  return (
    <section ref={box} id={id} className={cn('lp-sky', cove && 'has-cove', className)}>
      <Horizon moment={moment} land={ground} />
      <span ref={eye} className="lp-sky-eye" aria-hidden="true" />
      <div ref={up} className="lp-sky-up">{sky}</div>
      {children}
    </section>
  );
}

/** A part's title and what it's for, in a sentence or two. */
export function PartHead({ title, children, id, center = false, className }: { title: ReactNode; children: ReactNode; id?: string | undefined; center?: boolean | undefined; className?: string | undefined }) {
  return (
    <div className={cn('lp-head', center && 'is-center', className)}>
      <h2 id={id} className="lp-h2">{title}</h2>
      <p className="lp-lede">{children}</p>
    </div>
  );
}
