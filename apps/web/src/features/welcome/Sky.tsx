/*
 * A part of the welcome page on the evening: the scene behind it (`Horizon`), a sky as tall as what's in it, and the water
 * under the horizon for everything else. The horizon follows the sky's height, and the scene only moves while its horizon
 * is on screen. `sun` ties the sun to the scroll: the hero's sets as the page leaves it, the last one comes up as the page
 * reaches it. With reduced motion the sun stays where it's drawn.
 */
import { Horizon, cn, type Moment } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function Sky({ moment, sky, children, sun, className, id }: {
  moment: Moment;
  /** What stands on the sky, above the horizon. Its height is where the horizon is. */
  sky: ReactNode;
  /** What sits on the water, under the horizon. */
  children?: ReactNode;
  /** The sun follows the scroll: `set` sinks as the page scrolls away, `rise` comes up as the page reaches it. */
  sun?: 'set' | 'rise' | undefined;
  className?: string | undefined;
  id?: string | undefined;
}) {
  const box = useRef<HTMLElement>(null);
  const up = useRef<HTMLDivElement>(null);
  const eye = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion() ?? false;

  /* The horizon is where the sky ends, and the scene runs only while it's in view. */
  useEffect(() => {
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

  return (
    <section ref={box} id={id} className={cn('lp-sky', className)}>
      <Horizon moment={moment} />
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
