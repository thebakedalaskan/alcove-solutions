/*
 * In the call: eight features played on one call. The steps are on one side and the call on the other, held in view
 * (sticky) while the steps scroll past; on narrower screens the call sticks at the top and the steps scroll under it.
 * Each step plays as it crosses the middle of the window, cancelling the one before, and ends on a still that tells its
 * story. A pointer shows every click. Under reduced motion each step shows its still. Nothing runs, and nothing on the
 * call moves, while the tour is off screen.
 */
import { Fit, Icon, cn } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { TourStage } from './TourStage';
import {
  SCRIPT, STAGE_H, STAGE_W, STEPS, STILL, apply, opened, pointed, stepOf, type Beat, type Point, type Stage, type StepId, type Where
} from './tourSteps';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Where what's marked `data-at` is on the stage, in design pixels. */
function find(stage: HTMLElement, at: string) {
  const el = stage.querySelector(`[data-at="${at}"]`);
  if (!el) return null;
  const a = el.getBoundingClientRect(), b = stage.getBoundingClientRect(), k = b.width / STAGE_W || 1;
  return { x: (a.left - b.left) / k, y: (a.top - b.top) / k, w: a.width / k, h: a.height / k };
}

/** Where a menu opens beside what opened it, kept on the stage. */
function menuAt(stage: HTMLElement, pop: string, at: string, where: Where): Point | null {
  const a = find(stage, at), menu = stage.querySelector(`[data-pop="${pop}"]`);
  if (!a || !(menu instanceof HTMLElement)) return null;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const p = where === 'above' ? { x: a.x + a.w / 2 - w / 2, y: a.y - h - 10 }
    : where === 'above-right' ? { x: a.x + a.w - w, y: a.y - h - 8 }
      : where === 'right' ? { x: a.x + a.w + 6, y: a.y - 6 }
        : { x: a.x + a.w - w, y: a.y + a.h + 8 };
  return { x: clamp(p.x, 10, STAGE_W - 10 - w), y: clamp(p.y, 10, STAGE_H - 10 - h) };
}

/**
 * Plays the step crossing the middle of the window. Every wait is time on screen, and a step that's been replaced stops
 * at its next beat. Before the tour is reached, the call shows the first step's still.
 */
function useTour(tour: RefObject<HTMLDivElement | null>, stage: RefObject<HTMLDivElement | null>, reduce: boolean) {
  const [s, setS] = useState<Stage>(STILL.notes);
  const [active, setActive] = useState<StepId>('notes');
  const [still, setStill] = useState(true);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const root = tour.current;
    if (!root) return undefined;
    let run = 0;
    let current: StepId | null = null;
    let seen = false;
    let waiting: ((go: boolean) => void)[] = [];
    const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
    const open = () => (seen ? Promise.resolve(true) : new Promise<boolean>((r) => { waiting.push(r); }));
    const delay = (ms: number) => new Promise<boolean>((r) => {
      const t = setTimeout(() => { timers.delete(t); r(true); }, ms);
      timers.set(t, () => r(false));
    });
    /* True once `ms` of on-screen time has passed; false if another step started meanwhile. */
    const sleep = async (ms: number, my: number) => (await open()) && my === run && (await delay(ms)) && my === run && (await open()) && my === run;
    const stop = () => {
      timers.forEach((cancel, t) => { clearTimeout(t); cancel(); });
      timers.clear();
      const w = waiting;
      waiting = [];
      w.forEach((r) => r(false));
    };

    const play = async (beats: readonly Beat[], my: number) => {
      for (const b of beats) {
        if (my !== run) return;
        const box = stage.current;
        switch (b.t) {
          case 'wait':
            if (!(await sleep(b.ms, my))) return;
            break;
          case 'set':
            setS((x) => apply(x, b.patch));
            break;
          case 'point': {
            const r = box && find(box, b.at);
            if (r) setS((x) => pointed(x, { x: r.x + r.w / 2, y: r.y + r.h / 2 }));
            break;
          }
          case 'tap':
            setS((x) => ({ ...x, cur: { ...x.cur, taps: x.cur.taps + 1 } }));
            break;
          case 'leave':
            setS((x) => ({ ...x, cur: { ...x.cur, on: false } }));
            break;
          case 'pop': {
            const at = box && menuAt(box, b.pop, b.at, b.where);
            setS((x) => opened(x, b.pop, at, b.keep));
            break;
          }
          case 'tick':
            void (async () => { while (await sleep(b.ms, my)) setS((x) => apply(x, b.patch)); })();
            break;
        }
      }
    };

    const go = (id: StepId) => {
      if (id === current) return;
      current = id;
      run += 1;
      stop();
      setActive(id);
      setStill(reduce);
      if (reduce) setS(STILL[id]);
      else void play(SCRIPT[id], run);
    };

    /* The tour on screen: waits run, and so do the call's own loops (a speaker's level, a caret). */
    const band = new IntersectionObserver((es) => {
      const e = es[es.length - 1];
      if (!e) return;
      seen = e.isIntersecting;
      setOn(seen);
      if (seen) {
        const w = waiting;
        waiting = [];
        w.forEach((r) => r(true));
      }
    });
    band.observe(root);

    /* A step plays as it crosses the middle of the window; on narrow screens, the part under the call. */
    const narrow = matchMedia('(max-width: 1080px)');
    let steps: IntersectionObserver | null = null;
    const watch = () => {
      steps?.disconnect();
      const io = new IntersectionObserver((es) => es.forEach((e) => {
        const id = stepOf(e.target.getAttribute('data-step'));
        if (e.isIntersecting && id) go(id);
      }), { rootMargin: narrow.matches ? '-66% 0px -26% 0px' : '-46% 0px -46% 0px' });
      root.querySelectorAll('[data-step]').forEach((el) => io.observe(el));
      steps = io;
    };
    watch();
    narrow.addEventListener('change', watch);

    return () => {
      run += 1;
      stop();
      band.disconnect();
      steps?.disconnect();
      narrow.removeEventListener('change', watch);
    };
  }, [tour, stage, reduce]);

  return { s, active, still, on };
}

/** The steps beside the call, the one it's playing lit. Drawn again only when that changes, not at every beat of the call. */
const Steps = memo(function Steps({ active }: { active: StepId }) {
  return (
    <div className="lp-tour-steps">
      {STEPS.map((x) => (
        <article key={x.id} className={cn('lp-tour-step', x.id === active && 'is-on')} data-step={x.id}>
          <span className="lp-tour-ic"><Icon name={x.icon} size={20} /></span>
          <h3>{x.title}</h3>
          <p>{x.line}</p>
        </article>
      ))}
    </div>
  );
});

export function CallTour() {
  const reduce = useReducedMotion() ?? false;
  const tour = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { s, active, still, on } = useTour(tour, stage, reduce);
  return (
    <div ref={tour} className={cn('lp-tour', on && 'is-on')}>
      <Steps active={active} />
      <div className="lp-tour-stage">
        <Fit width={STAGE_W} height={STAGE_H} stageRef={stage} className="lp-tour-fit" label={STEPS.find((x) => x.id === active)?.shows ?? STEPS[0]?.shows ?? 'An Alcove call'}>
          <TourStage s={s} still={still} />
        </Fit>
      </div>
    </div>
  );
}
