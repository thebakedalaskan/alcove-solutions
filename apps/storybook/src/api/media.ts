/*
 * What a note's player and its shared screens load: the stand-in has no recordings or frames, so it makes them. A
 * segment's audio is quiet, as long as the segment says it is, so the player can go anywhere along it; a frame is a
 * slide drawn with what the notes read on it.
 */
import type { ScreenMoment } from '@alcove/api';

/** A picture in a workspace, drawn when it's first read: a wash of `hue` with its name across the bottom, as a PNG. */
export async function drawnPicture(name: string, hue: number, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d');
  if (!g) return new Blob([], { type: 'image/png' });
  const wash = g.createLinearGradient(0, 0, width, height);
  wash.addColorStop(0, `hsl(${hue} 55% 82%)`);
  wash.addColorStop(1, `hsl(${(hue + 40) % 360} 50% 48%)`);
  g.fillStyle = wash;
  g.fillRect(0, 0, width, height);
  g.fillStyle = 'rgb(255 255 255 / 0.9)';
  g.font = `600 ${Math.round(height / 14)}px system-ui, sans-serif`;
  g.fillText(name, Math.round(width / 18), Math.round(height - height / 12));
  return canvas.convertToBlob({ type: 'image/png' });
}

/** The most audio one segment is made with, so a long recording doesn't take a long time to make. */
const MOST_SECONDS = 2 * 60 * 60;
const RATE = 4000;

/** A quiet WAV of `seconds`: 8-bit mono, nearly silent, with a little noise so it isn't dead air. */
export function quietAudio(seconds: number): Blob {
  const samples = Math.round(Math.min(MOST_SECONDS, Math.max(1, seconds)) * RATE);
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + samples, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  text(36, 'data'); v.setUint32(40, samples, true);
  let n = 7;
  for (let i = 0; i < samples; i++) { n = (n * 16807) % 2147483647; v.setUint8(44 + i, 128 + (n % 3) - 1); }
  return new Blob([buf], { type: 'audio/wav' });
}

const made = new Map<string, string>();
/** An object URL for a segment's audio, made once per story. */
export function audioUrlFor(key: string, seconds: number): string {
  const known = made.get(key);
  if (known) return known;
  const url = URL.createObjectURL(quietAudio(seconds));
  made.set(key, url);
  return url;
}
/** Lets go of every segment made for the last story. */
export function forgetAudio(): void {
  for (const url of made.values()) URL.revokeObjectURL(url);
  made.clear();
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A shared screen as a slide: its heading and the lines read on it. */
export function screenImage(frame: ScreenMoment | undefined): string {
  const w = frame?.width ?? 1920;
  const h = frame?.height ?? 1080;
  const [head = frame?.title ?? 'Shared screen', ...rest] = (frame?.text ?? '').split('\n');
  const lines = rest.slice(0, 6).map((l, i) => `<text x="${w * 0.06}" y="${h * 0.36 + i * h * 0.075}" font-size="${h * 0.04}" fill="#394967">·  ${escape(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui, sans-serif">`
    + `<rect width="${w}" height="${h}" fill="#FCFDFE"/><rect width="${w}" height="${h * 0.012}" fill="#215DB3"/>`
    + `<text x="${w * 0.06}" y="${h * 0.22}" font-size="${h * 0.07}" font-weight="600" fill="#12223F">${escape(head)}</text>${lines}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
