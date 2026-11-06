/*
 * The coordinate model of a shared surface: where a shared picture sits in your view, and how you've framed it.
 *
 * A point on a share is normalised (`SharePoint`: 0 to 1 across the picture's width and down its height), whatever
 * its resolution and however anyone has zoomed, so it names the same spot on every screen: what a pointer or a mark on
 * a share uses. Your framing (`Framing`) is how far you've zoomed in, 1 being the whole picture fitted to your view as
 * big as it goes, and which point of the picture is at the middle of your view. `place` turns a framing into the
 * rectangle the picture is drawn in, for a view of a given size; `toShare` and `toView` convert points between the two.
 *
 * Everything here is pure, and it's about your screen only: nothing is sent anywhere.
 */

export interface Size { w: number; h: number }
export interface Point { x: number; y: number }
/** A spot on a shared picture: 0 to 1 across its width (x) and down its height (y). Outside 0–1 is off the picture. */
export type SharePoint = Point;
export interface Box { x: number; y: number; w: number; h: number }
/** How you frame a share: zoom (1 shows the whole picture, as big as it fits) and the spot of it at the middle of your view. */
export interface Framing { zoom: number; at: SharePoint }

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
/** The steps + and − go through. Pinching and the wheel go anywhere between. */
export const ZOOM_STEPS = [1, 1.25, 1.5, 2, 3, 4, 6, 8] as const;
/** The whole picture, as big as it fits. */
export const WHOLE: Framing = { zoom: 1, at: { x: 0.5, y: 0.5 } };

const clampZoom = (z: number) => (Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) : ZOOM_MIN);
const known = (s: Size) => s.w > 0 && s.h > 0;

/** The picture at zoom 1: as big as fits the view, in the middle of it. Before its size is known, the whole view. */
export function fit(view: Size, pic: Size): Box {
  if (!known(view) || !known(pic)) return { x: 0, y: 0, w: Math.max(0, view.w), h: Math.max(0, view.h) };
  const s = Math.min(view.w / pic.w, view.h / pic.h);
  const w = pic.w * s;
  const h = pic.h * s;
  return { x: (view.w - w) / 2, y: (view.h - h) / 2, w, h };
}

/**
 * The framing as this view can show it: the zoom within bounds, and the middle spot kept where the picture still
 * covers the view, so there's never empty space beside a picture bigger than the view. Along a side where the picture
 * is smaller than the view, it sits in the middle.
 */
export function settle(f: Framing, view: Size, pic: Size): Framing {
  const zoom = clampZoom(f.zoom);
  const base = fit(view, pic);
  const w = base.w * zoom;
  const h = base.h * zoom;
  // How far the middle spot stays from each edge: half the view, in parts of the picture.
  const hx = w > view.w ? view.w / 2 / w : 0.5;
  const hy = h > view.h ? view.h / 2 / h : 0.5;
  const keep = (v: number, half: number) => (half >= 0.5 || !Number.isFinite(v) ? 0.5 : Math.min(1 - half, Math.max(half, v)));
  return { zoom, at: { x: keep(f.at.x, hx), y: keep(f.at.y, hy) } };
}

/** Where the picture is drawn in the view at this framing, in view pixels from its top left. */
export function place(f: Framing, view: Size, pic: Size): Box {
  const s = settle(f, view, pic);
  const base = fit(view, pic);
  const w = base.w * s.zoom;
  const h = base.h * s.zoom;
  return { x: view.w / 2 - s.at.x * w, y: view.h / 2 - s.at.y * h, w, h };
}

/** The spot on the picture under a point of the view (view pixels from its top left). */
export function toShare(p: Point, f: Framing, view: Size, pic: Size): SharePoint {
  const r = place(f, view, pic);
  return { x: (p.x - r.x) / Math.max(1e-6, r.w), y: (p.y - r.y) / Math.max(1e-6, r.h) };
}

/** Where a spot on the picture is in the view, in view pixels from its top left. */
export function toView(s: SharePoint, f: Framing, view: Size, pic: Size): Point {
  const r = place(f, view, pic);
  return { x: r.x + s.x * r.w, y: r.y + s.y * r.h };
}

/** Zooms to `zoom`, keeping the spot of the picture under `p` (the middle of the view unless said) where it is. */
export function zoomTo(f: Framing, zoom: number, view: Size, pic: Size, p: Point = { x: view.w / 2, y: view.h / 2 }): Framing {
  const now = settle(f, view, pic);
  const under = toShare(p, now, view, pic);
  const z = clampZoom(zoom);
  const base = fit(view, pic);
  const w = Math.max(1e-6, base.w * z);
  const h = Math.max(1e-6, base.h * z);
  return settle({ zoom: z, at: { x: under.x + (view.w / 2 - p.x) / w, y: under.y + (view.h / 2 - p.y) / h } }, view, pic);
}

/** The next step in (1) or out (−1) from `zoom`. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > zoom + 0.01) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.01) ?? ZOOM_MIN;
}

/** Moves the picture by (dx, dy) view pixels, as a drag does: the spot under the pointer follows it. */
export function panBy(f: Framing, dx: number, dy: number, view: Size, pic: Size): Framing {
  const now = settle(f, view, pic);
  const base = fit(view, pic);
  const w = Math.max(1e-6, base.w * now.zoom);
  const h = Math.max(1e-6, base.h * now.zoom);
  return settle({ zoom: now.zoom, at: { x: now.at.x - dx / w, y: now.at.y - dy / h } }, view, pic);
}

/** Puts a spot of the picture at the middle of the view, as far as the picture allows (the minimap). */
export function centreOn(f: Framing, at: SharePoint, view: Size, pic: Size): Framing {
  return settle({ zoom: f.zoom, at }, view, pic);
}

/** The part of the picture in view, in parts of the picture (0 to 1): what the minimap outlines. */
export function inView(f: Framing, view: Size, pic: Size): Box {
  const r = place(f, view, pic);
  if (r.w <= 0 || r.h <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const x0 = Math.max(0, -r.x / r.w);
  const y0 = Math.max(0, -r.y / r.h);
  const x1 = Math.min(1, (view.w - r.x) / r.w);
  const y1 = Math.min(1, (view.h - r.y) / r.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export const isZoomed = (f: Framing) => f.zoom > ZOOM_MIN + 0.001;
/** How far in, as people read it: "200%". */
export const zoomLabel = (zoom: number) => `${Math.round(clampZoom(zoom) * 100)}%`;
