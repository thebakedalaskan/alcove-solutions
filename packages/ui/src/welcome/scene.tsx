/* Scenes: small pictures of the product, drawn at a fixed size and played while they're on screen. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '../foundation/cn';

/**
 * A scene drawn at a fixed design size (`width` × `height` in px) and scaled to the width of its
 * column, so everything inside can be placed in design pixels. A picture by default (`label` is its
 * description and nothing inside can be focused); `interactive` for one people can use.
 */
export function Fit({ width, height, label, interactive = false, stageRef, className, children }: {
  width: number; height: number; label: string; interactive?: boolean;
  stageRef?: RefObject<HTMLDivElement | null> | undefined; className?: string | undefined; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const apply = () => setK(el.clientWidth / width || 1);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className={cn('ac-fit', className)} style={{ aspectRatio: `${width} / ${height}` }} role={interactive ? 'group' : 'img'} aria-label={label}>
      <div ref={stageRef} className="ac-fit-stage" style={{ width, height, transform: `scale(${k})` }} inert={!interactive}>{children}</div>
    </div>
  );
}

/** Thrown into a scene's loop when the scene goes away, to end it. */
class SceneGone extends Error {}

/** Anything that finishes: a promise or an animation's controls. */
export interface Thenable { then(done: () => void, failed: () => void): unknown }

/** The beats of a scene's loop. Every wait pauses while the scene is off screen and ends the loop when it unmounts. */
export interface SceneClock {
  /** Resolves once the scene is on screen. */
  open(): Promise<void>;
  /** Waits `ms` of on-screen time. */
  sleep(ms: number): Promise<void>;
  /** Waits for an animation (or a promise) to finish. */
  wait(p: Thenable): Promise<void>;
}

/**
 * Runs `run` while `enabled`, for as long as the component is mounted. The loop only advances while
 * `ref`'s element is at least 15% on screen.
 */
export function useSceneLoop(ref: RefObject<Element | null>, run: (c: SceneClock) => Promise<void>, enabled: boolean) {
  const latest = useRef(run);
  useLayoutEffect(() => { latest.current = run; });
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let on = false;
    let gone = false;
    let waiting: (() => void)[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stops = new Set<(e: SceneGone) => void>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) on = e.isIntersecting;
      if (on) { const w = waiting; waiting = []; w.forEach((r) => r()); }
    }, { threshold: 0.15 });
    io.observe(el);
    const guard = (start: (done: () => void) => void) => new Promise<void>((resolve, reject) => {
      if (gone) { reject(new SceneGone()); return; }
      const stop = (e: SceneGone) => reject(e);
      stops.add(stop);
      start(() => { stops.delete(stop); resolve(); });
    });
    const open = () => (on && !gone ? Promise.resolve() : guard((done) => { waiting.push(done); }));
    const delay = (ms: number) => guard((done) => { const t = setTimeout(() => { timers.delete(t); done(); }, ms); timers.add(t); });
    const clock: SceneClock = {
      open,
      sleep: async (ms) => { await open(); await delay(ms); await open(); },
      wait: (p) => guard((done) => { p.then(done, done); })
    };
    latest.current(clock).catch((e: unknown) => { if (!(e instanceof SceneGone)) queueMicrotask(() => { throw e; }); });
    return () => {
      gone = true;
      io.disconnect();
      timers.forEach(clearTimeout);
      stops.forEach((s) => s(new SceneGone()));
    };
  }, [ref, enabled]);
}
