/*
 * What this person sees ahead of the doc. Every write to a doc costs everyone on it and adds to what it stores, so a drag
 * doesn't write each frame. What's being dragged is held here, at full speed on this person's sheet with the lines attached to
 * it following, and the doc hears where it's got to on a slower beat, and where it ended, however it ended. So the doc says
 * less, and what others see moves in steps. Those are eased here: a step is drawn as it travels, a frame at a time, rather
 * than with a transition, so that lines and rings go with what they belong to.
 */
import { afterMove, afterResize, hasBox, isAttached, moveObjects, resizeObject, type BoardObject, type BoardView, type Box, type LineEnd, type Move } from '@alcove/board';
import type { Board } from './useBoard';

/** How often a drag writes. What's on the wire is batched at this too, so nobody hears it any sooner. */
const BEAT_MS = 150;
/** How long a step takes to arrive. Longer than the beat, so that a late one finds it still moving, as with a pointer. */
const EASE_MS = 180;
/** More than this moving at once is a board arriving, or a person coming back online, and nobody's watching it travel. */
const EASE_AT_MOST = 600;

/** What's left of a step, and when it started. */
interface Step extends Box {
  at: number;
}

const NOTHING_HELD: ReadonlyMap<string, BoardObject> = new Map();

/** `o`, wherever `place` has it: the words and everything else stay what the doc says. */
function inPlace(o: BoardObject, place: BoardObject | undefined): BoardObject {
  if (!place) return o;
  if (o.k === 'line') return place.k === 'line' ? { ...o, from: place.from, to: place.to } : o;
  if (!hasBox(place)) return o;
  return o.k === 'ink' && place.k === 'ink' ? { ...o, x: place.x, y: place.y, w: place.w, h: place.h, pts: place.pts } : { ...o, x: place.x, y: place.y, w: place.w, h: place.h };
}

/** Where something is. A line's place is its first free end, and a line attached at both ends goes where they go. */
function placeOf(o: BoardObject): Box | null {
  if (hasBox(o)) return o;
  const free = [o.k === 'line' ? o.from : null, o.k === 'line' ? o.to : null].find((end) => end && !isAttached(end));
  return free && !isAttached(free) ? { x: free.x, y: free.y, w: 0, h: 0 } : null;
}

const left = (step: Step, now: number): number => Math.max(0, 1 - (now - step.at) / EASE_MS);

/** `o`, with what's left of a step still to travel. */
function onTheWay(o: BoardObject, step: Step | undefined, now: number): BoardObject {
  if (!step) return o;
  const k = left(step, now), dx = step.x * k, dy = step.y * k;
  if (hasBox(o)) return { ...o, x: o.x + dx, y: o.y + dy, w: o.w + step.w * k, h: o.h + step.h * k };
  if (o.k !== 'line') return o;
  const end = (e: LineEnd): LineEnd => (isAttached(e) ? e : { x: e.x + dx, y: e.y + dy });
  return { ...o, from: end(o.from), to: end(o.to) };
}

export class BoardOverlay {
  /** Says that what's shown has changed. */
  private readonly shownChanged: () => void;
  private held = NOTHING_HELD;
  /** Writes what's held, if it hasn't been yet. */
  private unwritten: (() => void) | null = null;
  private beat: ReturnType<typeof setTimeout> | undefined;
  private readonly steps = new Map<string, Step>();
  private frame = 0;

  constructor(shownChanged: () => void) {
    this.shownChanged = shownChanged;
  }

  /** Shows these where they are now, and has `write` put them there on the beat. The first goes at once, so others see a drag start. */
  hold(objects: ReadonlyMap<string, BoardObject>, write: () => void): void {
    this.held = objects;
    // Held, it's where the pointer has it, and what was left of someone else's move to it is over.
    for (const id of objects.keys()) this.steps.delete(id);
    this.unwritten = write;
    this.shownChanged();
    if (this.beat === undefined) this.onTheBeat();
  }

  private onTheBeat = (): void => {
    this.beat = undefined;
    if (!this.unwritten) return;
    this.writeHeld();
    this.beat = setTimeout(this.onTheBeat, BEAT_MS);
  };

  private writeHeld(): void {
    const write = this.unwritten;
    this.unwritten = null;
    write?.();
  }

  /** Lets go of what's held. Wherever it's got to goes to the doc now, whatever ended the drag. */
  land(): void {
    clearTimeout(this.beat);
    this.beat = undefined;
    this.writeHeld();
    this.held = NOTHING_HELD;
  }

  /** The doc has changed, and not by this person's hand: what someone else moved sets off from where it's shown now. */
  heard(before: BoardView, after: BoardView): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = performance.now();
    const moved = after.objects.flatMap((o) => {
      const was = before.byId.get(o.id);
      if (!was || was === o || this.held.has(o.id)) return [];
      const from = placeOf(was), to = placeOf(o), step = this.steps.get(o.id), k = step ? left(step, now) : 0;
      if (!from || !to) return [];
      const next = { x: from.x - to.x + (step?.x ?? 0) * k, y: from.y - to.y + (step?.y ?? 0) * k, w: from.w - to.w + (step?.w ?? 0) * k, h: from.h - to.h + (step?.h ?? 0) * k, at: now };
      return next.x || next.y || next.w || next.h ? [[o.id, next] as const] : [];
    });
    if (moved.length > EASE_AT_MOST) return;
    for (const [id, step] of moved) this.steps.set(id, step);
    if (this.steps.size) this.frame ||= requestAnimationFrame(this.travel);
  }

  private travel = (now: number): void => {
    this.frame = 0;
    for (const [id, step] of this.steps) if (left(step, now) === 0) this.steps.delete(id);
    this.shownChanged();
    if (this.steps.size) this.frame = requestAnimationFrame(this.travel);
  };

  /** The doc as this person sees it. */
  over(view: BoardView): BoardView {
    if (!this.held.size && !this.steps.size) return view;
    const now = performance.now();
    const objects = view.objects.map((o) => onTheWay(inPlace(o, this.held.get(o.id)), this.steps.get(o.id), now));
    return { objects, byId: new Map(objects.map((o) => [o.id, o])), frames: objects.filter((o) => o.k === 'frame') };
  }

  stop(): void {
    clearTimeout(this.beat);
    this.beat = undefined;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.steps.clear();
  }
}

/** Moves things with the pointer: on this sheet at once, and in the doc on the beat. */
export function dragTo(board: Board, moves: readonly Move[]): void {
  board.overlay.hold(afterMove(board.written, moves), () => moveObjects(board.doc, moves, board.origin));
}

/** Sizes something with the pointer, the same way. */
export function stretchTo(board: Board, id: string, box: Box): void {
  const o = board.written.byId.get(id);
  if (o && hasBox(o)) board.overlay.hold(new Map([[id, afterResize(o, box)]]), () => resizeObject(board.doc, id, box, board.origin));
}
