/*
 * Download as an image, or as a PDF: the board drawn onto a canvas from what its reader's own board shows them (`boardScene`),
 * each linked item by their name for it, and its pictures read the way the board reads them, through their own access. The
 * colours and type are the board's own, read from its sheet, so a night board downloads as night. A PDF is that picture on one
 * page, as a JPEG in a PDF of the plainest kind. Nothing leaves the browser: it's drawn here and saved here.
 */
import { errorCode } from '@alcove/api';
import { CANT_OPEN, boardScene, branchPath, branches, cellKey, shapePath, type BoardObject, type BoardScene, type BoardView, type Box, type InkColour } from '@alcove/board';
import { log as rootLog } from '~/lib/log';
import { lineRoute } from '../tools/line';
import { strokePath } from '../tools/pen';
import type { BoardPictures } from '../BoardSurface';
import type { BoardItem } from './objects';

const log = rootLog.child({ component: 'board-download' });

/** The most a download draws, in pixels: twice the board's size, but never a canvas a browser would refuse. */
const MOST_SIDE = 8192, MOST_PIXELS = 24_000_000, SHARP = 2;
/** A PDF's page is A4's long side wide, in points, with the board's shape. */
const PAGE_WIDE = 842;

export interface Download {
  how: 'image' | 'pdf';
  /** The board's name, which the file takes. */
  name: string;
  view: BoardView;
  /** The board's sheet, whose colours and type the download takes. */
  sheet: HTMLElement;
  pictures?: BoardPictures | undefined;
  itemFor: (item: string) => BoardItem | null;
}

/** The board as a file, saved to this device. */
export async function downloadBoard(d: Download): Promise<void> {
  const scene = boardScene(d.view, (item) => d.itemFor(item)?.name ?? null);
  const canvas = await drawScene(scene, d);
  const file = d.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Board';
  if (d.how === 'image') {
    save(await blobOf(canvas, 'image/png'), `${file}.png`);
    return;
  }
  const jpeg = new Uint8Array(await (await blobOf(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  save(new Blob([pdfOf(jpeg, canvas.width, canvas.height)], { type: 'application/pdf' }), `${file}.pdf`);
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((done, failed) => canvas.toBlob((b) => (b ? done(b) : failed(new Error('The board couldn’t be drawn.'))), type, quality));
}

function save(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** A gradient's colours and where each stops, from a `linear-gradient(...)` as the page has it; empty for anything else. */
function stopsOf(value: string): { colour: string; at: number }[] {
  const inner = /^linear-gradient\((.*)\)$/s.exec(value.trim())?.[1];
  if (!inner) return [];
  const parts: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) { parts.push(inner.slice(from, i).trim()); from = i + 1; }
  }
  parts.push(inner.slice(from).trim());
  const stops = parts.filter((part) => !/^(to\s|[-\d.]+(deg|turn|rad)$)/.test(part));
  return stops.map((part, i) => {
    const m = /^(.*\S)\s+([\d.]+)%$/s.exec(part);
    return { colour: m?.[1] ?? part, at: m?.[2] ? Number(m[2]) / 100 : i / Math.max(1, stops.length - 1) };
  });
}

/** The board's colours and type, as its sheet has them now: each token resolved the way the page resolves it. */
function paletteOf(sheet: HTMLElement) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  sheet.append(probe);
  const resolve = (value: string): string => {
    probe.style.color = '';
    probe.style.color = value;
    return getComputedStyle(probe).color;
  };
  const colour = (token: string): string => resolve(`var(${token})`);
  // The sheet's wash runs down it: the same colours, top to bottom, whatever size the download is.
  const washed = getComputedStyle(sheet).getPropertyValue('--bd-wash');
  const stops = stopsOf(washed).map((stop) => ({ colour: resolve(stop.colour), at: stop.at }));
  const wash = stops.length ? stops : [{ colour: colour('--ground'), at: 0 }];
  const font = getComputedStyle(sheet).getPropertyValue('--font-sans').trim() || 'sans-serif';
  const display = getComputedStyle(sheet).getPropertyValue('--font-display').trim() || 'serif';
  const notes = { butter: colour('--note-butter'), peach: colour('--note-peach'), rose: colour('--note-rose'), lilac: colour('--note-lilac'), sky: colour('--note-sky'), mist: colour('--note-mist') };
  const p = {
    wash, ink: colour('--ink'), ink2: colour('--ink-2'), ink3: colour('--ink-3'), line: colour('--line'), lineInk: colour('--line-ink'), surface: colour('--surface'), sunk: colour('--sunk'),
    frame: colour('--bf-fill'), frameRing: colour('--bf-ring'), noteInk: colour('--note-ink'), notes, font, display,
    pens: { horizon: colour('--horizon'), sun: colour('--sun-glow'), rose: colour('--line-rose') } satisfies Record<InkColour, string>
  };
  probe.remove();
  return p;
}
type Palette = ReturnType<typeof paletteOf>;

async function drawScene(scene: BoardScene, d: Download): Promise<HTMLCanvasElement> {
  const { box } = scene;
  const s = Math.min(SHARP, MOST_SIDE / Math.max(box.w, box.h), Math.sqrt(MOST_PIXELS / (box.w * box.h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * s));
  canvas.height = Math.max(1, Math.round(box.h * s));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The board couldn’t be drawn.');
  const p = paletteOf(d.sheet);
  const [pictures, glyphs] = await Promise.all([picturesOf(scene.view, d.pictures), glyphsOf(scene.view, d.sheet, p.ink2)]);
  try {
    const wash = ctx.createLinearGradient(0, 0, 0, canvas.height);
    for (const stop of p.wash) wash.addColorStop(Math.min(1, Math.max(0, stop.at)), stop.colour);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, -box.x * s, -box.y * s);
    const { view } = scene;
    for (const o of view.objects) if (o.k === 'frame') drawFrame(ctx, o, p, view);
    for (const o of view.objects) if (o.k === 'line') drawLine(ctx, view, o, p);
    for (const { from, to } of branches(view)) stroke(ctx, new Path2D(branchPath(from, to)), p.lineInk, 2);
    for (const o of view.objects) if (o.k === 'ink') stroke(ctx, new Path2D(strokePath(o)), p.pens[o.c], o.tool === 'marker' ? 12 : 3.5, o.tool === 'marker' ? 0.28 : 1);
    for (const o of view.objects) drawObject(ctx, o, p, scene, pictures, glyphs);
  } finally {
    for (const img of pictures.values()) URL.revokeObjectURL(img.src);
  }
  return canvas;
}

/**
 * Each link's icon, as the board draws it: the same Lucide glyph, taken from the link on the sheet in the ink it's drawn in, so
 * a download has the board's one family of icons. A link that isn't on the sheet now (far off on a very full board) has none.
 */
async function glyphsOf(view: BoardView, sheet: HTMLElement, ink: string): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(view.objects.map(async (o) => {
    if (o.k !== 'link') return;
    const svg = sheet.querySelector(`[data-id="${CSS.escape(o.id)}"] .bo-li svg`);
    if (!(svg instanceof SVGSVGElement)) return;
    const copy = svg.cloneNode(true);
    if (!(copy instanceof SVGSVGElement)) return;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('stroke', ink);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy).replaceAll('currentColor', ink))}`;
    try {
      await img.decode();
      out.set(o.id, img);
    } catch (e: unknown) {
      log.info('a link’s icon couldn’t be drawn for a download', { code: errorCode(e) });
    }
  }));
  return out;
}

/** Every picture on the board, read once through the reader's own access. One that can't be read is left as an empty ground, as on the board. */
async function picturesOf(view: BoardView, read: BoardPictures | undefined): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  if (!read) return out;
  const media = [...new Set(view.objects.flatMap((o) => (o.k === 'image' || o.k === 'shot' ? [o.media] : [])))];
  const stop = new AbortController();
  await Promise.all(media.map(async (id) => {
    try {
      const url = await read(id, stop.signal);
      const img = new Image();
      img.src = url;
      await img.decode();
      out.set(id, img);
    } catch (e: unknown) {
      // Not readable now, or gone: drawn as its empty ground, as on the board. The URL is never logged.
      log.info('a picture on the board couldn’t be read for a download', { code: errorCode(e) });
    }
  }));
  return out;
}

function stroke(ctx: CanvasRenderingContext2D, path: Path2D, colour: string, width: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

function rounded(ctx: CanvasRenderingContext2D, b: Box, r: number | number[]): void {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
}

/**
 * Words wrapped to `w`, from the top left of `b`, cut where they run out of room as the board cuts them. `centre` puts them in
 * the middle of `b` both ways, and `middle` only from top to bottom.
 */
function words(ctx: CanvasRenderingContext2D, text: string, b: Box, o: { font: string; size: number; weight: number; colour: string; line: number; centre?: boolean; middle?: boolean }): void {
  ctx.save();
  ctx.font = `${o.weight} ${o.size}px ${o.font}`;
  ctx.fillStyle = o.colour;
  ctx.textBaseline = 'top';
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let now = '';
    for (const word of para.split(/(\s+)/)) {
      const next = now + word;
      if (now && ctx.measureText(next).width > b.w) { lines.push(now.trimEnd()); now = word.trimStart(); } else now = next;
    }
    lines.push(now);
  }
  const height = o.size * o.line, fits = Math.max(1, Math.floor(b.h / height));
  const shown = lines.slice(0, fits);
  const top = o.centre || o.middle ? b.y + (b.h - shown.length * height) / 2 : b.y;
  shown.forEach((l, i) => ctx.fillText(l, o.centre ? b.x + (b.w - ctx.measureText(l).width) / 2 : b.x, top + i * height + (height - o.size) / 2));
  ctx.restore();
}

function drawFrame(ctx: CanvasRenderingContext2D, o: Extract<BoardObject, { k: 'frame' }>, p: Palette, view: BoardView): void {
  rounded(ctx, o, [32, 32, 18, 18]);
  ctx.fillStyle = p.frame;
  ctx.fill();
  ctx.strokeStyle = p.frameRing;
  ctx.lineWidth = 1;
  ctx.stroke();
  words(ctx, o.title, { x: o.x + 8, y: o.y - 38, w: o.w, h: 30 }, { font: p.display, size: 25, weight: 450, colour: p.ink, line: 1.1 });
  const empty = !view.objects.some((x) => x.k !== 'frame' && x.k !== 'line' && x.f === o.id);
  if (empty && o.hint) words(ctx, o.hint, { x: o.x + 24, y: o.y, w: o.w - 48, h: o.h }, { font: p.font, size: 13, weight: 400, colour: p.ink3, line: 1.4, centre: true });
}

function drawLine(ctx: CanvasRenderingContext2D, view: BoardView, o: Extract<BoardObject, { k: 'line' }>, p: Palette): void {
  const r = lineRoute(view, o);
  if (!r) return;
  stroke(ctx, new Path2D(r.d), p.lineInk, 2);
  if (!r.head) return;
  ctx.fillStyle = p.lineInk;
  ctx.fill(new Path2D(r.head));
}

function drawObject(ctx: CanvasRenderingContext2D, o: BoardObject, p: Palette, scene: BoardScene, pictures: ReadonlyMap<string, HTMLImageElement>, glyphs: ReadonlyMap<string, HTMLImageElement>): void {
  switch (o.k) {
    case 'note': {
      rounded(ctx, o, 12);
      ctx.fillStyle = p.notes[o.c];
      ctx.fill();
      const size = o.size === 's' ? 13.5 : o.size === 'l' ? 18 : 15.5;
      words(ctx, o.t, { x: o.x + 14, y: o.y + 14, w: o.w - 28, h: o.h - 40 }, { font: p.font, size, weight: 500, colour: p.noteInk, line: 1.32 });
      return;
    }
    case 'text': {
      const size = o.size === 'title' ? 21 : o.size === 'heading' ? 16 : 15;
      words(ctx, o.t, o, { font: p.font, size, weight: o.size === 'body' ? 400 : 600, colour: o.size === 'title' ? p.ink : p.ink2, line: 1.3, centre: false });
      return;
    }
    case 'shape': {
      ctx.save();
      ctx.translate(o.x, o.y);
      const path = new Path2D(shapePath(o.s, o.w, o.h));
      ctx.fillStyle = o.c ? p.notes[o.c] : p.surface;
      ctx.fill(path);
      ctx.restore();
      ctx.save();
      ctx.translate(o.x, o.y);
      stroke(ctx, new Path2D(shapePath(o.s, o.w, o.h)), p.lineInk, 2);
      ctx.restore();
      words(ctx, o.t, { x: o.x + 14, y: o.y + 10, w: o.w - 28, h: o.h - 20 }, { font: p.font, size: 15.5, weight: 500, colour: o.c ? p.noteInk : p.ink, line: 1.28, centre: true });
      return;
    }
    case 'image': case 'shot': {
      const shot = o.k === 'shot';
      const inner = shot ? { x: o.x + 7, y: o.y + 7, w: o.w - 14, h: (o.w - 14) * 10 / 16 } : o;
      if (shot) { rounded(ctx, o, 10); ctx.fillStyle = p.surface; ctx.fill(); ctx.strokeStyle = p.line; ctx.stroke(); }
      rounded(ctx, inner, shot ? 6 : 8);
      ctx.fillStyle = p.sunk;
      ctx.fill();
      const img = pictures.get(o.media);
      if (img) {
        ctx.save();
        ctx.clip();
        const k = Math.max(inner.w / img.naturalWidth, inner.h / img.naturalHeight);
        ctx.drawImage(img, inner.x + (inner.w - img.naturalWidth * k) / 2, inner.y + (inner.h - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
        ctx.restore();
      }
      if (o.k === 'shot') words(ctx, o.caption, { x: o.x + 7, y: inner.y + inner.h + 6, w: o.w - 14, h: 18 }, { font: p.font, size: 13, weight: 500, colour: p.ink2, line: 1.2 });
      return;
    }
    case 'table': {
      rounded(ctx, o, 10);
      ctx.fillStyle = p.surface;
      ctx.fill();
      const across = o.cols.reduce((n, c) => n + c.size, 0) || 1, down = o.rows.reduce((n, r) => n + r.size, 0) || 1;
      let y = o.y;
      o.rows.forEach((row, r) => {
        const h = (row.size / down) * o.h;
        let x = o.x;
        for (const col of o.cols) {
          const w = (col.size / across) * o.w;
          if (r === 0) { ctx.fillStyle = p.sunk; ctx.fillRect(x, y, w, h); }
          ctx.strokeStyle = p.line;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
          words(ctx, o.cells[cellKey(row.id, col.id)] ?? '', { x: x + 11, y: y + 9, w: w - 22, h: h - 18 }, { font: p.font, size: 14.5, weight: r === 0 ? 600 : 400, colour: p.ink, line: 1.35 });
          x += w;
        }
        y += h;
      });
      return;
    }
    case 'node': {
      rounded(ctx, o, o.h / 2);
      ctx.fillStyle = o.parent ? p.surface : p.notes.butter;
      ctx.fill();
      ctx.strokeStyle = p.lineInk;
      ctx.lineWidth = o.parent ? 1.5 : 2;
      ctx.stroke();
      words(ctx, o.t, { x: o.x + 18, y: o.y + 8, w: o.w - 36, h: o.h - 16 }, { font: p.font, size: o.parent ? 15 : 17, weight: o.parent ? 500 : 600, colour: o.parent ? p.ink : p.noteInk, line: 1.25, centre: true });
      return;
    }
    case 'link': {
      rounded(ctx, o, 14);
      ctx.fillStyle = p.surface;
      ctx.fill();
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      const well = { x: o.x + 14, y: o.y + (o.h - 38) / 2, w: 38, h: 38 };
      rounded(ctx, well, 10);
      ctx.fillStyle = p.sunk;
      ctx.fill();
      const glyph = glyphs.get(o.id);
      if (glyph) ctx.drawImage(glyph, well.x + 9, well.y + 9, 20, 20);
      const name = scene.names.get(o.item) ?? null;
      words(ctx, name === null ? CANT_OPEN : name || 'Untitled', { x: o.x + 64, y: o.y + 10, w: o.w - 78, h: o.h - 20 }, { font: p.font, size: 15, weight: name === null ? 500 : 600, colour: name === null ? p.ink2 : p.ink, line: 1.3, middle: true });
      return;
    }
    default:
  }
}

/* ---------- a PDF of one picture ---------- */

/** One page with the JPEG on it, the page the picture's shape and A4's long side wide. */
function pdfOf(jpeg: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
  const W = PAGE_WIDE, H = Math.round((PAGE_WIDE * height) / width * 100) / 100;
  const text = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;
  const put = (part: Uint8Array | string): void => {
    const bytes = typeof part === 'string' ? text.encode(part) : part;
    parts.push(bytes);
    at += bytes.length;
  };
  const object = (n: number, body: string | Uint8Array[], open = ''): void => {
    offsets[n] = at;
    if (typeof body === 'string') { put(`${n} 0 obj\n${body}\nendobj\n`); return; }
    put(`${n} 0 obj\n${open}`);
    for (const b of body) put(b);
    put('\nendobj\n');
  };
  const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  put('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, [text.encode('stream\n'), jpeg, text.encode('\nendstream')], `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n`);
  object(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  const xref = at;
  put(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`).join('')}`);
  put(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(at);
  let k = 0;
  for (const part of parts) { out.set(part, k); k += part.length; }
  return out;
}
