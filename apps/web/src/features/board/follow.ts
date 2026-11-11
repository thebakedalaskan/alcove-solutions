/*
 * Following someone, and Go to. Following reads that person's `view` and drives this camera, until something stops it:
 * `Board` knows every stop there is, so this only watches `following` go. Stop and Esc go back to where you were, because
 * the view you were following was never your own, and so does that person leaving. Moving the board yourself leaves you
 * where you are, because you've started looking around from there: `takeCamera` drops `home` first, so there's nowhere to go.
 * Following whoever presents the board (`watching`) is held instead while they're away from it, as they open something else or
 * reload: the camera stays where they left it until their view comes back. Only this person stops it: the board going (its
 * session opened again, say) doesn't, and the board drawn in its place follows them on. Their view is fitted whole, as wide and
 * as tall as theirs, whatever the shape of this sheet (`viewHere`).
 *
 * It starts with the board's glide. After that a person's view arrives ten times a second, and a glide starting again each
 * time would stutter and trail, so the camera eases towards the latest one a frame at a time, and stops when it gets there.
 */
import { BOARD_VIEW_WIDTH, type BoardPresence } from '@alcove/board';
import { editable, overlayOpen } from '~/lib/keys';
import type { BoardPlace } from './camera';
import type { Board } from './useBoard';

/**
 * How quickly the camera catches up, in ms. It eases towards a point that eases towards their view, so its speed changes
 * smoothly from one update to the next. A steady pan trails by about 150 ms, near what a pointer does, so whoever you're
 * following stays still on your sheet, and a jump across the board lands in about half a second.
 */
const EASE_MS = 60;
/** Close enough to stop: half a pixel, and a zoom no one could see the difference in. */
const NEAR_PX = 0.5;
const NEAR_ZOOM = 0.0005;

const BACK = 'Back to your own view.';

/**
 * Someone's view, whatever the size of their sheet: the point in the middle, and how wide and how tall a stretch of the board it
 * shows (`high` is null from a browser that says only how wide). It has no zoom, so it can't reach the camera until `viewHere`
 * has fitted it to this sheet.
 */
export interface SharedView {
  x: number;
  y: number;
  wide: number;
  high: number | null;
}

type PublishedView = NonNullable<BoardPresence['view']>;

/** What following needs to know about the people on the board. */
export interface FollowedPeople {
  /** Where someone is looking, if they're on the board. Their most recent browser, if they have two. */
  viewOf(id: string): SharedView | null;
  nameOf(id: string): string | undefined;
}

/** This view as it's published, from a sheet `width` by `height` (see `BOARD_VIEW_WIDTH`): one with no height yet says only how wide. */
export const publishedView = ({ x, y, z }: BoardPlace, width: number, height: number): PublishedView => ({
  x, y, z: z * BOARD_VIEW_WIDTH / width, ...(height > 0 ? { h: BOARD_VIEW_WIDTH * height / width } : {})
});

/** A view as it arrives. */
export const sharedView = ({ x, y, z, h }: PublishedView): SharedView => ({ x, y, wide: BOARD_VIEW_WIDTH / z, high: h === undefined ? null : h / z });

/**
 * Someone's view on this sheet, `width` by `height`: the same middle, at the zoom that shows all of what they see, its width and
 * its height, so a sheet of another shape shows more round it, never less of it. A view that says only how wide shows that width.
 */
export const viewHere = ({ x, y, wide, high }: SharedView, width: number, height: number): BoardPlace => ({
  x, y, z: high === null || height <= 0 ? width / wide : Math.min(width / wide, height / high)
});

const sameView = (a: SharedView | null, b: SharedView | null): boolean => a?.x === b?.x && a?.y === b?.y && a?.wide === b?.wide && a?.high === b?.high;

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
  /** What to say on the way back, if it isn't the usual. */
  private parting: string | null = null;
  /** Their name from when this started, because they can go from `people` as they leave. */
  private name: string | undefined;
  /** Their last view, to tell a new one from someone else's update. */
  private seen: SharedView | null = null;
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
    // Following whoever presents is the call's to stop from outside the sheet (Unfollow), so an Esc that closes a popover elsewhere never does.
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !this.who || this.board.getSnapshot().watching || editable(e.target) || overlayOpen()) return;
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
      this.board.home = null;
      // The board going isn't this person stopping. Following whoever presents goes on with whatever board is drawn in its place
      // (its session opened again, as Try again does), so nobody's told; following anyone else ends with it, and that's said.
      this.board.stopFollow(!this.board.getSnapshot().watching);
    };
  }

  /** Goes once to where someone is, with the glide. It isn't following, so there's nothing to come back from afterwards. */
  goTo(id: string): void {
    const { board } = this;
    if (board.look.mini) return;
    const view = this.people.viewOf(id);
    if (!view) {
      this.say(this.notHere(id));
      return;
    }
    board.home = null;
    board.stopFollow();
    board.goTo(viewHere(view, board.camera.width, board.camera.height));
  }

  /** Someone on the board said something, or this sheet changed size. */
  heard = (): void => {
    const { who } = this;
    if (!who) return;
    const view = this.people.viewOf(who);
    if (!view) {
      if (this.board.getSnapshot().watching) return;
      this.parting = `${this.name ?? 'They'} left the board. ${BACK}`;
      this.board.stopFollow();
    } else if (!sameView(view, this.seen)) {
      this.seen = view;
      this.head(view);
    }
  };

  /** This sheet changed size, so what shows all of their view has too. */
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
    const { board } = this;
    if (!view && !board.getSnapshot().watching) {
      this.parting = this.notHere(next);
      board.stopFollow();
      return;
    }
    this.halt();
    this.name = this.people.nameOf(next);
    // Going from one person straight to another, where you were is still where you were.
    board.home ??= board.camera.place();
    // Whoever presents, not on the board yet: the camera waits where it is, and goes to them once they are (`heard`).
    if (!view) return;
    this.seen = view;
    board.goTo(viewHere(view, board.camera.width, board.camera.height));
  }

  private back(): void {
    this.halt();
    const { board, parting } = this, { home } = board;
    board.home = null;
    this.parting = null;
    if (home) board.goTo(home);
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

  private head(view: SharedView): void {
    const { camera } = this.board;
    const here = viewHere(view, camera.width, camera.height);
    // What this sheet can reach, which is as near as the camera will ever get.
    this.goal = { ...here, z: camera.centred(here).z };
    this.board.viewTaken();
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
