/*
 * Where this person is looking. The camera never goes through React: every move is one transform written through
 * `moveBoardCamera`, so nothing on the board draws again, and the few things that have to keep up (the ring round a
 * selection, the zoom in the bar, which objects are mounted) subscribe here. `x` and `y` are in screen pixels and `z` is the
 * zoom, as the canvas has them.
 */
import type { LiveStore } from '@alcove/api';
import { fit, type Box, type Camera, type Pad } from '@alcove/board';
import { moveBoardCamera } from '@alcove/ui';

/** How far a person zooms by hand. `fit` can go further out, to show a very big board. */
const LEAST_ZOOM = 0.2;
const MOST_ZOOM = 3;
/** Where someone else's view can put this camera, however odd it is. */
const LEAST_PLACE_ZOOM = 0.001;

/** A point on the sheet: `sx sy` in screen pixels from its corner, `x y` in board units. */
export interface SheetPoint {
  sx: number;
  sy: number;
  x: number;
  y: number;
}

/** Someone's view of a board, whatever the size of their sheet: the point in its middle, and their zoom. */
export interface BoardPlace {
  x: number;
  y: number;
  z: number;
}

/** A `--duration-*` token in milliseconds, read from where it's defined, so there's only ever one number to change. */
export const tokenMs = (el: Element, token: string): number => Number.parseFloat(getComputedStyle(el).getPropertyValue(token)) || 0;

export class BoardCameraStore implements LiveStore<Camera> {
  private cam: Camera = { x: 0, y: 0, z: 1 };
  private sheet: HTMLElement | null = null;
  private world: HTMLElement | null = null;
  private readonly listeners = new Set<() => void>();
  /** The sheet's size in pixels, before anything scales it. */
  width = 0;
  height = 0;

  getSnapshot = (): Camera => this.cam;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  attach(sheet: HTMLElement, world: HTMLElement): () => void {
    this.sheet = sheet;
    this.world = world;
    moveBoardCamera(sheet, world, this.cam);
    return () => {
      this.sheet = null;
      this.world = null;
    };
  }

  /** Puts the camera somewhere. Nothing draws again but what has subscribed. */
  set(cam: Camera): void {
    this.cam = cam;
    if (this.sheet && this.world) moveBoardCamera(this.sheet, this.world, cam);
    for (const listener of this.listeners) listener();
  }

  panBy(dx: number, dy: number): void {
    this.set({ x: this.cam.x + dx, y: this.cam.y + dy, z: this.cam.z });
  }

  /** A zoom a person can reach from here. Out past the least, as `fit` can be, it stays put rather than jumping in. */
  private reachable(z: number): number {
    return Math.max(Math.min(LEAST_ZOOM, this.cam.z), Math.min(MOST_ZOOM, z));
  }

  /** The camera `factor` closer, keeping what's at `sx sy` where it is. */
  zoomed(factor: number, sx: number, sy: number): Camera {
    const { x, y, z: was } = this.cam;
    const z = this.reachable(was * factor);
    const k = z / was;
    return { x: sx - (sx - x) * k, y: sy - (sy - y) * k, z };
  }

  /** The camera at zoom `z` with a point on the board at `sx sy` on the sheet, which keeps it under the fingers pinching it. */
  holding(point: { x: number; y: number }, sx: number, sy: number, z: number): Camera {
    const zoom = this.reachable(z);
    return { x: sx - point.x * zoom, y: sy - point.y * zoom, z: zoom };
  }

  /** The camera showing `box`, clear of whatever `pad` keeps it clear of. */
  fitting(box: Box, pad?: Pad): Camera {
    return fit(box, this.width, this.height, pad);
  }

  /** The camera with `place` in the middle of this sheet. */
  centred({ x, y, z }: BoardPlace): Camera {
    const zoom = Math.max(LEAST_PLACE_ZOOM, Math.min(MOST_ZOOM, z));
    return { x: this.width / 2 - x * zoom, y: this.height / 2 - y * zoom, z: zoom };
  }

  /** The point in the middle of the sheet and the zoom: this view, in a form another sheet can use. */
  place(): BoardPlace {
    const { x, y, z } = this.cam;
    return { x: (this.width / 2 - x) / z, y: (this.height / 2 - y) / z, z };
  }

  /** What the sheet shows, in board units. */
  visible(): Box {
    const { x, y, z } = this.cam;
    return { x: -x / z, y: -y / z, w: this.width / z, h: this.height / z };
  }

  /** Where a pointer is. Something around the board can scale it, as a tile does, so screen pixels are measured back to the sheet's own. */
  point(e: { clientX: number; clientY: number }): SheetPoint {
    const r = this.sheet?.getBoundingClientRect();
    const k = (r && this.sheet ? r.width / this.sheet.offsetWidth : 1) || 1;
    const sx = (e.clientX - (r?.left ?? 0)) / k, sy = (e.clientY - (r?.top ?? 0)) / k;
    const { x, y, z } = this.cam;
    return { sx, sy, x: (sx - x) / z, y: (sy - y) / z };
  }

  /** The sheet changed size. What's in the middle stays in the middle across: it's the board making room, not moving. */
  resize(width: number, height: number): void {
    const was = this.width;
    this.width = width;
    this.height = height;
    if (was && width && width !== was) this.panBy((width - was) / 2, 0);
  }
}
