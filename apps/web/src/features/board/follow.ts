/*
 * Following someone, and Go to. Following reads that person's `view` and drives this camera, until something stops it:
 * `Board` knows every stop there is (a scroll, a zoom, Esc), so this only watches `following` go. All of them end the same
 * way, with the camera back where it was before, because the view you were following was never your own.
 *
 * It starts with the board's glide. After that a person's view arrives ten times a second, and a glide starting again each
 * time would stutter and trail, so the camera eases towards the latest one a frame at a time, and stops when it gets there.
 */
import { BOARD_VIEW_WIDTH } from '@alcove/board';
import { overlayOpen, typing } from '~/lib/keys';
import type { BoardPlace } from './camera';
import type { Board } from './useBoard';

/**
 * How quickly the camera catches up, in ms. It eases towards a point that eases towards their view, so its speed changes
 * smoothly from one update to the next. A steady pan trails by twice this, and a jump takes about the board's glide.
 */
const EASE_MS = 70;
/** Close enough to stop: half a pixel, and a zoom no one could see the difference in. */
const NEAR_PX = 0.5;
const NEAR_ZOOM = 0.0005;

const BACK = 'Back to your own view.';

/** What following needs to know about the people on the board. */
export interface FollowedPeople {
  /** Where someone is looking, if they're on the board. Their most recent browser, if they have two. */
  viewOf(id: string): BoardPlace | null;
  nameOf(id: string): string | undefined;
}

/** This view as others read it, from a sheet `width` wide. See `BOARD_VIEW_WIDTH`. */
export const sharedView = ({ x, y, z }: BoardPlace, width: number): BoardPlace => ({ x, y, z: z * BOARD_VIEW_WIDTH / width });

/** Someone's view on this sheet, `width` wide: the same middle, at the zoom that shows the same width of the board. What the height shows depends on the sheet. */
export const viewHere = ({ x, y, z }: BoardPlace, width: number): BoardPlace => ({ x, y, z: z * width / BOARD_VIEW_WIDTH });

const sameView = (a: BoardPlace | null, b: BoardPlace | null): boolean => a?.x === b?.x && a?.y === b?.y && a?.z === b?.z;

/** Part of the way from `a` to `b`. Zoom goes by ratio, which is how a change of zoom looks. */
const between = (a: BoardPlace, b: BoardPlace, k: number): BoardPlace => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z * (b.z / a.z) ** k });

const stillness = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class BoardFollowing {
  /** Says something to the person at this board. */
  say: (text: string) => void = () => undefined;

  private readonly board: Board;
  private readonly people: FollowedPeople;
  /** Who this camera is following, which trails the board's own `following` until `boardChanged` has seen it. */
  private who: string | null = null;
  /** Where this person was before they started, which is where stopping takes them. */
  private home: BoardPlace | null = null;
  /** What to say on the way back, if it isn't the usual. */
  private parting: string | null = null;
  /** Their last view, to tell a new one from someone else's update. */
  private seen: BoardPlace | null = null;
  /** Where the camera is heading, on this sheet, while it's on its way. */
  private goal: BoardPlace | null = null;
  /** The point between the camera and `goal` that the camera eases towards. */
  private lead: BoardPlace | null = null;
  private frame = 0;
  private last = 0;

  constructor(board: Board, people: FollowedPeople) {
    this.board = board;
    this.people = people;
  }

  /** Starts watching. Returns how to stop. */
  attach(sheet: HTMLElement): () => void {
    const stopBoard = this.board.subscribe(this.boardChanged);
    // A menu on someone's tile starts this, so the keyboard can well be somewhere else. Inside the sheet, the board's own keys see Esc.
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !this.who || typing(e.target) || overlayOpen()) return;
      if (e.target instanceof Node && sheet.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      this.board.stopFollow();
    };
    addEventListener('keydown', escape, { capture: true });
    this.boardChanged();
    return () => {
      stopBoard();
      removeEventListener('keydown', escape, { capture: true });
      this.halt();
      this.who = null;
      this.home = null;
    };
  }

  /** Goes once to where someone is, with the glide. It isn't following, so there's nothing to come back from afterwards. */
  goTo(id: string): void {
    const { board } = this, view = this.people.viewOf(id);
    if (!view) {
      this.say(this.notHere(id));
      return;
    }
    this.home = null;
    board.stopFollow();
    board.goTo(viewHere(view, board.camera.width));
  }

  /** Someone on the board said something, or this sheet changed size. */
  heard = (): void => {
    const { who } = this;
    if (!who) return;
    const view = this.people.viewOf(who);
    if (!view) {
      this.parting = `${this.people.nameOf(who) ?? 'They'} left the board. ${BACK}`;
      this.board.stopFollow();
    } else if (!sameView(view, this.seen)) {
      this.seen = view;
      this.head(view);
    }
  };

  /** This sheet changed size, so what shows the same width has too. */
  refit(): void {
    this.seen = null;
    this.heard();
  }

  private notHere(id: string): string {
    return `${this.people.nameOf(id) ?? 'That person'} isn't on the board.`;
  }

  private boardChanged = (): void => {
    const { following, glide } = this.board.getSnapshot();
    if (following !== this.who) this.turn(following);
    else if (!glide) this.ease();
  };

  private turn(next: string | null): void {
    this.who = next;
    if (next === null) {
      this.back();
      return;
    }
    const view = this.people.viewOf(next);
    if (!view) {
      this.parting = this.notHere(next);
      this.board.stopFollow();
      return;
    }
    const { board } = this;
    this.halt();
    // Going from one person straight to another, where you were is still where you were.
    this.home ??= board.camera.place();
    this.seen = view;
    board.goTo(viewHere(view, board.camera.width));
  }

  private back(): void {
    this.halt();
    const { home, parting } = this;
    this.home = null;
    this.parting = null;
    if (home) this.board.goTo(home);
    const text = parting ?? (home ? BACK : null);
    if (text) this.say(text);
  }

  private halt(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.goal = null;
    this.lead = null;
    this.seen = null;
  }

  private head(view: BoardPlace): void {
    const { camera } = this.board;
    const here = viewHere(view, camera.width);
    // What this sheet can reach, which is as near as the camera will ever get.
    this.goal = { ...here, z: camera.centred(here).z };
    this.ease();
  }

  /** Sets off towards the goal, once the glide that started this has finished. */
  private ease(): void {
    const { board, goal } = this;
    if (!goal || this.frame || board.getSnapshot().glide) return;
    if (stillness()) {
      board.camera.set(board.camera.centred(goal));
      this.goal = null;
      return;
    }
    this.lead ??= board.camera.place();
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.step);
  }

  private step = (now: number): void => {
    this.frame = 0;
    const { goal, lead } = this;
    if (!goal || !lead) return;
    const { camera } = this.board;
    const k = 1 - Math.exp(-Math.max(0, now - this.last) / EASE_MS);
    this.last = now;
    this.lead = between(lead, goal, k);
    const next = between(camera.place(), this.lead, k);
    if (Math.hypot(goal.x - next.x, goal.y - next.y) * next.z < NEAR_PX && Math.abs(next.z / goal.z - 1) < NEAR_ZOOM) {
      camera.set(camera.centred(goal));
      this.goal = null;
      this.lead = null;
      return;
    }
    camera.set(camera.centred(next));
    this.frame = requestAnimationFrame(this.step);
  };
}
