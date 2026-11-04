/*
 * Frames of your own shared screen, for the notes (docs: Calls and recordings › Shared screens). Call media is end-to-end
 * encrypted, so only browsers ever see a share: while screen notes are on and not paused, this browser looks at its
 * own share once a second and keeps a frame when what's on it has changed and settled, at most one every few seconds.
 * A share's first frame waits until it has been up for ten seconds, so a window picked by mistake is gone before
 * anything of it is kept. Frames go to the call one at a time, sealed by the server as soon as they arrive; pausing,
 * screen notes going off or a breakout room stops it at once and drops whatever wasn't sent. Nothing about what's on
 * the screen is logged: only counts, sizes and timings.
 */
import { errorCode, type ScreenFrame } from '@alcove/api';
import { log } from '~/lib/log';

const flog = log.child({ component: 'screen-frames' });

/** How often the share is looked at. */
const LOOK_MS = 1000;
/** How long a share is up before its first frame is kept. */
const FIRST_AFTER_MS = 10_000;
/** At most one frame this often. */
const MIN_GAP_MS = 4000;
/** A screen that never settles (a video playing) still gets a frame this often while it keeps changing. */
const BUSY_MS = 15_000;
/** The share is compared on a small grey grid: cheap, and blind to a moving cursor. */
const GRID_W = 48;
const GRID_H = 27;
/** How far a cell's brightness must move to count, and how much of the grid must move for the screen to have changed. */
const CELL = 24;
const CHANGED = 0.02;
/** Frames go up at most this many pixels across, as JPEG. */
const MAX_EDGE = 1600;
const QUALITY = 0.72;
/** Frames waiting to be sent: a slow network keeps the newest few. */
const QUEUE = 3;
const TRIES = 3;

/** Grabs frames of a video track: ImageCapture where the browser has it (it reads the track itself, not a video on the page), else a video element. */
interface Grabber { grab(): Promise<CanvasImageSource | null>; size(): { width: number; height: number }; close(): void }
interface FrameGrabber { grabFrame(): Promise<ImageBitmap> }
type GrabberMaker = new (track: MediaStreamTrack) => FrameGrabber;
const isMaker = (v: unknown): v is GrabberMaker => typeof v === 'function';

function grabberFor(track: MediaStreamTrack): Grabber {
  const Capture: unknown = Reflect.get(globalThis, 'ImageCapture');
  if (isMaker(Capture)) {
    const capture = new Capture(track);
    let last: ImageBitmap | null = null;
    return {
      async grab() { last?.close(); last = await capture.grabFrame().catch(() => null); return last; },
      size: () => ({ width: last?.width ?? 0, height: last?.height ?? 0 }),
      close() { last?.close(); last = null; }
    };
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  void video.play().catch(() => undefined);
  return {
    grab: async () => (video.readyState >= 2 && video.videoWidth ? video : null),
    size: () => ({ width: video.videoWidth, height: video.videoHeight }),
    close() { video.pause(); video.srcObject = null; }
  };
}

/** The share on a small grey grid. */
function gridOf(src: CanvasImageSource, canvas: HTMLCanvasElement): Uint8Array | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, GRID_W, GRID_H);
  const px = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
  const out = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * (px[i * 4] ?? 0) + 0.587 * (px[i * 4 + 1] ?? 0) + 0.114 * (px[i * 4 + 2] ?? 0));
  return out;
}
/** How much of the grid moved between two looks, from 0 to 1. */
function moved(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > CELL) n++;
  return n / a.length;
}
/** A frame as JPEG, at most MAX_EDGE across. */
function jpegOf(src: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.round(width * scale));
  canvas.height = Math.max(64, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY));
}

export class ScreenFrames {
  private share: string | null = null;
  private grabber: Grabber | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private looking = false;
  private grid = document.createElement('canvas');
  /** When this share started being looked at, the last frame kept (on the grid) and when, and the look before this one. */
  private since = 0;
  private kept: Uint8Array | null = null;
  private keptAt = 0;
  private last: Uint8Array | null = null;
  private steady = 0;
  private changingSince = 0;
  private queue: ScreenFrame[] = [];
  private sending = false;
  /** Shares that had a frame kept here, to tell the call when they end. */
  private sent = new Set<string>();

  constructor(
    private readonly send: (f: ScreenFrame) => Promise<unknown>,
    private readonly ended: (share: string) => Promise<void>,
    private readonly onProblem: (message: string | null) => void
  ) {
    this.grid.width = GRID_W;
    this.grid.height = GRID_H;
  }

  /** Looks at this share of yours (its stream and its share ID) from now on. Another share starts over. */
  start(stream: MediaStream, share: string): void {
    if (this.share === share && this.timer) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    this.stop();
    this.share = share;
    this.grabber = grabberFor(track);
    this.since = Date.now();
    this.timer = setInterval(() => void this.look(), LOOK_MS);
    flog.info('looking at your shared screen for the notes', { firstAfterS: FIRST_AFTER_MS / 1000 });
  }

  /** Stops looking and drops what wasn't sent: screen notes paused or off, a breakout room, or the share going. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.grabber?.close();
    this.grabber = null;
    if (this.queue.length) flog.info('frames not sent were dropped', { frames: this.queue.length });
    this.queue = [];
    this.share = null;
    this.kept = null;
    this.last = null;
    this.steady = 0;
    this.changingSince = 0;
  }

  /** One of your shares ended: what it showed last stops here in the notes. Said once, and only for a share that sent something. */
  end(share: string): void {
    if (this.share === share) this.stop();
    if (!this.sent.delete(share)) return;
    this.ended(share).catch((e: unknown) => flog.info('the end of a share wasn’t recorded', { code: errorCode(e) }));
  }

  private async look(): Promise<void> {
    const share = this.share;
    const grabber = this.grabber;
    if (!share || !grabber || this.looking) return;
    this.looking = true;
    try {
      const takenAt = Date.now();
      const src = await grabber.grab();
      if (!src || this.share !== share) return;
      const grid = gridOf(src, this.grid);
      if (!grid) return;
      const moving = this.last ? moved(grid, this.last) >= CHANGED : true;
      this.steady = moving ? 0 : this.steady + 1;
      this.last = grid;
      if (takenAt - this.since < FIRST_AFTER_MS) return;
      if (this.kept && moved(grid, this.kept) < CHANGED) { this.changingSince = 0; return; }
      this.changingSince ||= takenAt;
      const settled = this.steady >= 1;
      if ((!settled && takenAt - this.changingSince < BUSY_MS) || takenAt - this.keptAt < MIN_GAP_MS) return;
      const { width, height } = grabber.size();
      const data = width && height ? await jpegOf(src, width, height) : null;
      if (!data || this.share !== share) return;
      this.kept = grid;
      this.keptAt = takenAt;
      this.changingSince = 0;
      this.queue = [...this.queue, { data, share, takenAt }].slice(-QUEUE);
      void this.flush();
    } catch (e) {
      flog.warn('your shared screen couldn’t be looked at', { err: e });
    } finally {
      this.looking = false;
    }
  }

  /** Sends what's waiting, in order, a few tries each. A refusal (paused, off, not yours) drops it: there's nothing to retry. */
  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue[0]) {
        const f = this.queue[0];
        let done = false;
        for (let tries = 1; tries <= TRIES && !done && this.queue[0] === f; tries++) {
          try {
            await this.send(f);
            this.sent.add(f.share);
            this.onProblem(null);
            flog.debug('frame sent', { bytes: f.data.size, tries });
            done = true;
          } catch (e) {
            const code = errorCode(e);
            if (code === 'conflict' || code === 'forbidden' || code === 'invalid' || code === 'not-found' || code === 'unauthenticated') {
              flog.info('frame not taken', { code, bytes: f.data.size });
              done = true;
            } else if (tries === TRIES) {
              flog.warn('frame lost', { code, bytes: f.data.size });
              this.onProblem('Your shared screen couldn’t reach the notes. Check your connection.');
            } else await new Promise((r) => setTimeout(r, 800 * tries));
          }
        }
        if (this.queue[0] === f) this.queue = this.queue.slice(1);
      }
    } finally {
      this.sending = false;
    }
  }
}
