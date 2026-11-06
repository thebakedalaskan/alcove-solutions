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

export function Sky({ moment, sky, children, sun, className, id, label }: {
  moment: Moment;
  /** What stands on the sky, above the horizon. Its height is where the horizon is. */
  sky: ReactNode;
  /** What sits on the water, under the horizon. */
  children?: ReactNode;
  /** The sun follows the scroll: `set` sinks as the page scrolls away, `rise` comes up as the page reaches it. */
  sun?: 'set' | 'rise' | undefined;
  className?: string | undefined;
  id?: string | undefined;
  label?: string | undefined;
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
    const io = new IntersectionObserver(([e]) => { if (e) el.classList.toggle('is-on', e.isIntersecting); }, { rootMargin: '80px 0px' });
    io.observe(watch);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || !sun || reduce) return undefined;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const hz = Number.parseFloat(el.style.getPropertyValue('--hz')) || 600;
      if (sun === 'set') {
        el.style.setProperty('--lp-set', clamp(scrollY / (hz * 0.8), 0, 1).toFixed(3));
      } else {
        const line = el.getBoundingClientRect().top + hz, vh = innerHeight;
        el.style.setProperty('--lp-rise', clamp((line - 0.72 * vh) / (0.3 * vh), 0, 1).toFixed(3));
      }
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(draw); };
    draw();
    addEventListener('scroll', later, { passive: true });
    addEventListener('resize', later);
    return () => { cancelAnimationFrame(frame); removeEventListener('scroll', later); removeEventListener('resize', later); };
  }, [sun, reduce]);

  return (
    <section ref={box} id={id} aria-label={label} className={cn('lp-sky', className)}>
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
