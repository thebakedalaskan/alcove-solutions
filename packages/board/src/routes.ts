/*
 * What a line and a shape draw, as SVG paths. The elbow is the design canvas's: a line leaves one edge and
 * arrives at another with rounded corners, and its numbers are unchanged. Sides are worked out from where the
 * two boxes are, so a line finds a clean route again whenever either end moves.
 */
import type { Box, LineSide, LineStyle, ShapeKind } from './shape';

type Point = readonly [number, number];
type Direction = 'r' | 'l' | 'd' | 'u';

export interface Route {
  d: string;
  /** The arrowhead. Empty for a curved line, which the canvas draws without one. */
  head: string;
}

/** The outline of a shape in a box of w by h. */
export function shapePath(s: ShapeKind, w: number, h: number): string {
  if (s === 'ellipse') return `M0 ${h / 2}a${w / 2} ${h / 2} 0 1 0 ${w} 0a${w / 2} ${h / 2} 0 1 0 ${-w} 0z`;
  if (s === 'diamond') return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`;
  const r = s === 'pill' ? h / 2 : 12;
  return `M${r} 0H${w - r}a${r} ${r} 0 0 1 ${r} ${r}V${h - r}a${r} ${r} 0 0 1 ${-r} ${r}H${r}a${r} ${r} 0 0 1 ${-r} ${-r}V${r}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
}

function anchor(o: Box, side: LineSide): Point {
  if (side === 'r') return [o.x + o.w, o.y + o.h / 2];
  if (side === 'l') return [o.x, o.y + o.h / 2];
  if (side === 't') return [o.x + o.w / 2, o.y];
  return [o.x + o.w / 2, o.y + o.h];
}

/** The edges a line between two boxes leaves and arrives at. */
export function sides(a: Box, b: Box): [LineSide, LineSide] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx > 0 ? ['r', 'l'] : ['l', 'r'];
  return dy > 0 ? ['b', 't'] : ['t', 'b'];
}

function elbow(p: Point, q: Point, s: LineSide): { d: string; end: Direction } {
  const r = 14, [x0, y0] = p, [x1, y1] = q;
  const horiz = s === 'r' || s === 'l';
  if ((horiz && Math.abs(y1 - y0) < 1) || (!horiz && Math.abs(x1 - x0) < 1)) {
    return { d: `M${x0} ${y0}L${x1} ${y1}`, end: horiz ? (x1 > x0 ? 'r' : 'l') : y1 > y0 ? 'd' : 'u' };
  }
  const sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1, rr = Math.min(r, Math.abs(y1 - y0) / 2, Math.abs(x1 - x0) / 2);
  if (horiz) {
    const mx = (x0 + x1) / 2;
    return { d: `M${x0} ${y0}H${mx - sx * rr}Q${mx} ${y0} ${mx} ${y0 + sy * rr}V${y1 - sy * rr}Q${mx} ${y1} ${mx + sx * rr} ${y1}H${x1}`, end: sx > 0 ? 'r' : 'l' };
  }
  const my = (y0 + y1) / 2;
  return { d: `M${x0} ${y0}V${my - sy * rr}Q${x0} ${my} ${x0 + sx * rr} ${my}H${x1 - sx * rr}Q${x1} ${my} ${x1} ${my + sy * rr}V${y1}`, end: sy > 0 ? 'd' : 'u' };
}

function head(q: Point, dir: Direction): string {
  const [x, y] = q, a = 11, b = 6;
  if (dir === 'r') return `M${x} ${y}l${-a} ${-b}l0 ${2 * b}z`;
  if (dir === 'l') return `M${x} ${y}l${a} ${-b}l0 ${2 * b}z`;
  if (dir === 'd') return `M${x} ${y}l${-b} ${-a}l${2 * b} 0z`;
  return `M${x} ${y}l${-b} ${a}l${2 * b} 0z`;
}

/** The same arrowhead as `head`, turned to lie along a straight line. */
function headAlong(p: Point, q: Point): string {
  const dx = q[0] - p[0], dy = q[1] - p[1], long = Math.hypot(dx, dy) || 1;
  const ux = dx / long, uy = dy / long, a = 11, b = 6;
  return `M${q[0]} ${q[1]}l${-a * ux + b * uy} ${-a * uy - b * ux}l${-2 * b * uy} ${2 * b * ux}z`;
}

/** A curve that leaves and arrives square to the edge it's on. */
function curve(p: Point, q: Point, s: LineSide): string {
  const [x0, y0] = p, [x1, y1] = q;
  if (s === 'r' || s === 'l') {
    const k = (x1 - x0) / 2;
    return `M${x0} ${y0}C${x0 + k} ${y0} ${x1 - k} ${y1} ${x1} ${y1}`;
  }
  const k = (y1 - y0) / 2;
  return `M${x0} ${y0}C${x0} ${y0 + k} ${x1} ${y1 - k} ${x1} ${y1}`;
}

function draw(p: Point, q: Point, s: LineSide, style: LineStyle): Route {
  if (style === 'straight') return { d: `M${p[0]} ${p[1]}L${q[0]} ${q[1]}`, head: headAlong(p, q) };
  if (style === 'curve') return { d: curve(p, q, s), head: '' };
  const e = elbow(p, q, s);
  return { d: e.d, head: head(q, e.end) };
}

/** A line between two boxes. An end that's free is a box with no size at that point. */
export function route(a: Box, b: Box, style: LineStyle): Route {
  const [from, to] = sides(a, b);
  return draw(anchor(a, from), anchor(b, to), from, style);
}

/** A line from a box to a point, while it's being dragged or if it stays free at that end. */
export function freeRoute(a: Box, to: [number, number], style: LineStyle): Route {
  const dx = to[0] - (a.x + a.w / 2), dy = to[1] - (a.y + a.h / 2);
  const s = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'b' : 't';
  return draw(anchor(a, s), to, s, style);
}
