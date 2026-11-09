/*
 * Video for tests of shared screens, recorded the way a browser records a share: ffmpeg's moving test pattern, or
 * plain screens of one colour that change at given seconds (a still slide, then the next); and a picture's JPEG
 * header, for previews.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { z } from 'zod';

/** A still screen of one colour (an ffmpeg colour name) from `from` seconds until the next scene, or the end. */
export interface Scene { color: string; from: number }

/**
 * One WebM stream, the way MediaRecorder writes one: live (no index, no duration), five frames a second, a keyframe
 * every five seconds, named `title` if given. It shows ffmpeg's test pattern, which moves all the time, or `scenes`:
 * still screens with a little grain, as a camera-less capture has, so no two frames are the same image though the
 * screen doesn't change.
 */
export async function recordedWebm(seconds: number, o: { size?: string | undefined; title?: string | undefined; scenes?: Scene[] | undefined } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const bin = z.string().parse(createRequire(import.meta.url)('ffmpeg-static'));
  const size = o.size ?? '640x360';
  const scenes = [...(o.scenes ?? [])].sort((a, b) => a.from - b.from);
  const source = scenes.length
    ? [...scenes.flatMap((s, i) => ['-f', 'lavfi', '-i', `color=c=${s.color}:s=${size}:r=5:d=${(scenes[i + 1]?.from ?? seconds) - s.from}`]),
      '-filter_complex', `${scenes.map((_, i) => `[${i}:v]`).join('')}concat=n=${scenes.length}:v=1:a=0,noise=alls=12:allf=t[v]`, '-map', '[v]']
    : ['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=5`];
  const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', ...source, '-t', String(seconds), '-c:v', 'libvpx', '-b:v', '300k', '-g', '25',
    ...(o.title ? ['-metadata', `title=${o.title}`] : []), '-f', 'webm', '-live', '1', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const out: Buffer[] = [];
  p.stdout.on('data', (c: Buffer) => out.push(c));
  const code = await new Promise<number | null>((resolve) => p.on('close', resolve));
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
  const all = Buffer.concat(out);
  const bytes = new Uint8Array(new ArrayBuffer(all.length));
  bytes.set(all);
  return bytes;
}

/** A video cut into `n` pieces by size, as MediaRecorder cuts one stream. */
export const cut = (video: Uint8Array<ArrayBuffer>, n: number): Uint8Array<ArrayBuffer>[] => {
  const size = Math.ceil(video.length / n);
  return Array.from({ length: n }, (_, i) => video.slice(i * size, (i + 1) * size));
};

/**
 * A picture's JPEG header as a test needs one (start, a comment carrying `words`, the frame header with its size, end):
 * all the server reads of a preview. The words make two pictures of the same size different, and let a test look for them.
 */
export function pictureJpeg(width: number, height: number, words = ''): Uint8Array<ArrayBuffer> {
  const seg = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  const comment = seg(0xfe, Buffer.from(`NOISE|${words}`, 'utf8'));
  const sof = seg(0xc0, Buffer.from([8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  const all = Buffer.concat([Buffer.from([0xff, 0xd8]), comment, sof, Buffer.from([0xff, 0xd9])]);
  const out = new Uint8Array(new ArrayBuffer(all.length));
  out.set(all);
  return out;
}
