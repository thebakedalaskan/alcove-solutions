/*
 * What other people share in a scripted call, drawn: a deck of slides or a document, a page at a time, with their
 * pointer drifting over it so the share looks live. The scripted room (livekit.ts) hands one to whoever shows a share,
 * as LiveKit would hand them the track. Never anyone's real screen, and nothing in it is anyone's real work.
 */

/** Something shared: what its window is called, and its pages, shown one after another. */
export interface Screen {
  title: string;
  pages: readonly { heading: string; lines: readonly string[] }[];
  /** Slides fill the picture; a document is a page on a grey desk. */
  kind?: 'slides' | 'doc' | undefined;
  /** The colour along its top, so two shares side by side are easy to tell apart. */
  accent?: string | undefined;
}

const W = 1600;
const H = 900;
/** How long each page stays up. */
const PAGE_MS = 9000;
const FONT = '"Hanken Grotesk", system-ui, sans-serif';

/** Long lines wrap inside `width`, at most `max` lines. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= width || !line) { line = next; continue; }
    out.push(line);
    line = word;
    if (out.length === max) return out;
  }
  if (line && out.length < max) out.push(line);
  return out;
}

function draw(g: CanvasRenderingContext2D, s: Screen, t: number): void {
  const page = s.pages[Math.floor(t / PAGE_MS) % Math.max(1, s.pages.length)] ?? { heading: s.title, lines: [] };
  const accent = s.accent ?? '#215DB3';
  const doc = s.kind === 'doc';
  g.fillStyle = doc ? '#E9ECF1' : '#FBFAF7';
  g.fillRect(0, 0, W, H);
  // The page: the whole picture for slides, a sheet on the desk for a document.
  const x = doc ? 360 : 0;
  const w = doc ? W - 720 : W;
  if (doc) {
    g.fillStyle = '#FFFFFF';
    g.fillRect(x, 60, w, H - 60);
    g.fillStyle = '#D5DAE3';
    g.fillRect(0, 0, W, 60);
    g.fillStyle = '#55667F';
    g.font = `500 24px ${FONT}`;
    g.fillText(s.title, 32, 39);
  } else {
    g.fillStyle = accent;
    g.fillRect(0, 0, W, 14);
  }
  const left = x + (doc ? 80 : 120);
  const room = w - (doc ? 160 : 240);
  g.fillStyle = '#12223F';
  g.font = `600 ${doc ? 52 : 68}px ${FONT}`;
  const head = wrap(g, page.heading, room, 2);
  head.forEach((l, i) => g.fillText(l, left, (doc ? 190 : 210) + i * (doc ? 64 : 82)));
  let y = (doc ? 190 : 210) + head.length * (doc ? 64 : 82) + (doc ? 30 : 50);
  g.font = `400 ${doc ? 30 : 38}px ${FONT}`;
  for (const text of page.lines) {
    const rows = wrap(g, text, room - 50, 2);
    g.fillStyle = accent;
    g.beginPath();
    g.arc(left + 10, y - (doc ? 10 : 13), doc ? 5 : 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#394967';
    rows.forEach((r, i) => g.fillText(r, left + 40, y + i * (doc ? 42 : 52)));
    y += rows.length * (doc ? 42 : 52) + (doc ? 22 : 30);
    if (y > H - 80) break;
  }
  // Their pointer, drifting over what they're talking about.
  const px = x + w * (0.55 + Math.sin(t / 2300) * 0.22);
  const py = H * (0.5 + Math.sin(t / 1700 + 1) * 0.2);
  g.fillStyle = '#12223F';
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px, py + 34);
  g.lineTo(px + 9, py + 26);
  g.lineTo(px + 24, py + 26);
  g.closePath();
  g.stroke();
  g.fill();
}

/** A share as a live picture, drawn a few times a second until it's stopped. */
export function drawnScreen(s: Screen): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const stream = canvas.captureStream(6);
  if (!g) return { stream, stop: () => undefined };
  const started = performance.now();
  draw(g, s, 0);
  const timer = setInterval(() => draw(g, s, performance.now() - started), 160);
  return { stream, stop: () => { clearInterval(timer); for (const t of stream.getTracks()) t.stop(); } };
}
