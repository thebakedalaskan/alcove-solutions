/*
 * Alcove's matte: finds the person in each camera frame and puts something else behind them. LiveKit's
 * ProcessorWrapper (backdrop.ts) feeds it frames and makes the track; this replaces LiveKit's own transformer, whose
 * yes/no mask with nothing carried between frames made the edge shimmer while someone sat still.
 *
 * Each frame:
 * 1. MediaPipe's multiclass selfie segmenter (256×256, on this device) gives how sure it is that each pixel is
 *    background, and the person is everything else, hair included, which the plain selfie models lost against a
 *    background of a similar colour. It runs in a worker of its own (segmenter.ts), so compiling its shaders and waiting
 *    on the GPU never hold up the page: where LiveKit reads frames off a playing element (WebKit: every browser on an
 *    iPhone) all of this runs on the page's own thread, and the model there froze the screen for seconds as a background
 *    was chosen. One frame at a time goes to it, and that frame is drawn when its own mask comes back; the frames that
 *    arrive meanwhile are let go, so a slow model lowers the frame rate and never lays an old mask over a new picture.
 * 2. That's smoothed over time: where it changes a little (the model being unsure) it moves slowly, so the edge
 *    settles; where it changes a lot (someone moving) it follows at once, so nothing trails.
 * 3. matteGl.ts sizes it up to the frame along the camera's own colour edges, and lays the person over the blurred
 *    room or a picture.
 */
import { ProcessorWrapper, VideoTransformer, type VideoTransformerInitOptions } from '@livekit/track-processors';
import { log } from '~/lib/log';
import { MatteGl, type Edges } from './matteGl';
import { FrameBudget, type BackgroundQuality } from './frameBudget';
import { Segmenter } from './segmenter';
import type { BlurStrength } from '@alcove/api';

const mlog = log.child({ component: 'matte' });

/** What shows behind someone: blur, a local picture URL, or a stable solid color. */
export type Look = { blur: BlurStrength } | { picture: string } | { color: readonly [number, number, number] };
export type MatteOptions = { look: Look };

/** The model's own input size: what each frame is made before it's segmented, and the mask's size. */
const MASK_W = 256;
const MASK_H = 256;

/* How the mask settles over time: per frame, it moves SLOW of the way to the new reading where they differ by LO or
 * less, FAST where they differ by HI or more, and in between along a smooth curve. */
const SLOW = 0.12;
const FAST = 0.8;
const LO = 0.08;
const HI = 0.35;
/** How the edge is drawn: colour difference that still counts as the same surface, and where the edge fades from
 * room to person. Leaning low keeps a little room rather than cutting into someone's head. */
const EDGES: Edges = { colorSigma: 0.1, lo: 0.3, hi: 0.6 };
/** The blur's spread, in pixels of the camera frame. */
const BLUR_SIGMA = { mild: 7, strong: 14 } as const;
/** How many frames between debug lines with the time each took. */
const REPORT_EVERY = 300;
/** Readings in a row that come back empty (nothing read back from the GPU) before the matte counts as failed. */
const BLANKS = 30;

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Matte extends VideoTransformer<MatteOptions> {
  private options: MatteOptions;
  /** The model, in its worker: kept from the first start until it's destroyed, restarts included. */
  private segmenter: Segmenter | null = null;
  private draw: MatteGl | null = null;
  /** The frame made small for the model. */
  private small: OffscreenCanvas | null = null;
  private smallCtx: OffscreenCanvasRenderingContext2D | null = null;
  /** Full-frame source pixels are bounded before GL upload, separately from the model's small input. */
  private source: OffscreenCanvas | null = null;
  private sourceCtx: OffscreenCanvasRenderingContext2D | null = null;
  private readonly budget: FrameBudget;
  /** The mask as it's settled so far, MASK_W×MASK_H. */
  private steady: Float32Array | null = null;
  /**
   * The frame with the model, waiting in `source` to be drawn over when its mask comes back: where it goes, its time and size,
   * and how long the page has spent on it so far.
   */
  private waiting: { controller: TransformStreamDefaultController<VideoFrame>; timestamp: number; width: number; height: number; cameraHeight: number; spent: number } | null = null;
  /** Empty readings in a row. */
  private blanks = 0;
  private picture: { path: string; bitmap: ImageBitmap } | null = null;
  private failed = false;
  private closed = false;
  private timing = { frames: 0, ms: 0 };

  constructor(options: MatteOptions, private readonly onFailure: (error: unknown) => void, onQuality: (quality: BackgroundQuality) => void) {
    super();
    this.options = options;
    this.budget = new FrameBudget(onQuality);
  }

  static get isSupported(): boolean {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferToImageBitmap' in OffscreenCanvas.prototype
      && new OffscreenCanvas(1, 1).getContext('webgl2') !== null;
  }

  override async init(opts: VideoTransformerInitOptions): Promise<void> {
    try {
      if (this.closed) throw new Error('The background was stopped.');
      this.bound(opts);
      await super.init(opts);
      await this.start();
    } catch (e) {
      // ProcessorWrapper cannot destroy an initializing processor. Let it finish setting up its output, which
      // receives no frames, so Backdrop can destroy all of it after noticing this failure.
      this.fail(e);
    }
  }

  override async restart(opts: VideoTransformerInitOptions): Promise<void> {
    if (this.closed) throw new Error('The background was stopped.');
    this.drop();
    this.bound(opts);
    this.canvas = opts.outputCanvas;
    this.inputVideo = opts.inputElement;
    this.isDisabled = false;
    await this.start();
  }

  async update(options: MatteOptions): Promise<void> {
    if (this.closed) throw new Error('The background was stopped.');
    this.options = options;
    await this.showLook();
  }

  override async destroy(): Promise<void> {
    this.closed = true;
    this.drop();
    await super.destroy();
    this.segmenter?.close();
    this.segmenter = null;
    this.picture?.bitmap.close();
    this.picture = null;
  }

  transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>): void {
    const canvas = this.canvas;
    if (this.closed || this.isDisabled || this.failed || frame.codedWidth === 0) {
      frame.close();
      return;
    }
    if (!canvas || !this.draw || !this.segmenter || !this.smallCtx || !this.small || !this.source || !this.sourceCtx) {
      frame.close();
      this.fail(new Error('The matte is not ready to draw.'));
      return;
    }
    const started = performance.now();
    // While the model has a frame, the ones that arrive are let go: `source` holds that frame until its mask is back.
    if (this.segmenter.busy(started) || !this.budget.take(started)) { frame.close(); return; }
    try {
      const camera = this.upright(frame);
      const { width, height } = this.budget.size(camera.width, camera.height);
      if (this.source.width !== width || this.source.height !== height) { this.source.width = width; this.source.height = height; }
      this.sourceCtx.drawImage(camera.image, 0, 0, width, height);
      // The model reads the same upright picture that's drawn, so the mask lines up with it.
      this.smallCtx.drawImage(this.source, 0, 0, MASK_W, MASK_H);
      this.waiting = { controller, timestamp: frame.timestamp, width, height, cameraHeight: camera.height, spent: performance.now() - started };
      this.segmenter.send(this.small.transferToImageBitmap(), started);
    } catch (e) {
      this.waiting = null;
      this.fail(e);
    } finally {
      frame.close();
    }
  }

  /**
   * The model's reading of the frame in `source` (null: it came back empty): folded into the settled mask, which that frame
   * is drawn with and sent. Until the first mask nothing is drawn, so the camera never goes out without its background.
   */
  private masked(reading: Float32Array | null): void {
    const w = this.waiting;
    this.waiting = null;
    if (this.closed || this.failed) return;
    if (!reading) {
      // Nothing read back from the GPU says everything is the person: that frame isn't drawn, and if it keeps happening the
      // matte has failed.
      this.blanks += 1;
      if (this.blanks >= BLANKS) this.fail(new Error('The background model’s readings came back empty.'));
      return;
    }
    this.blanks = 0;
    const steady = this.settle(reading);
    const canvas = this.canvas;
    if (!w || !canvas || !this.draw || !this.source) return;
    const started = performance.now();
    let output: VideoFrame | null = null;
    try {
      if (canvas.width !== w.width || canvas.height !== w.height) { canvas.width = w.width; canvas.height = w.height; }
      const look = this.options.look;
      // Keep the chosen blur's visible spread at every processing resolution.
      const sigma = ('blur' in look ? BLUR_SIGMA[look.blur] : 14) * w.height / Math.max(w.cameraHeight, 1);
      this.draw.draw(this.source, steady, MASK_W, MASK_H, w.width, w.height, sigma, EDGES);
      output = new VideoFrame(canvas, { timestamp: w.timestamp });
    } catch (e) {
      output?.close();
      this.fail(e);
      return;
    }
    try {
      w.controller.enqueue(output);
    } catch (e) {
      // The track it went to has ended: nobody is reading it any more, which isn't the matte failing.
      output.close();
      mlog.debug('a drawn frame had nowhere to go', { err: e });
      return;
    }
    const finished = performance.now();
    const ms = w.spent + (finished - started);
    this.budget.measured(ms, finished);
    this.timed(ms);
  }

  /** A selected background never falls back to an unprocessed camera frame. Report once, then discard frames. */
  private fail(error: unknown): void {
    // Stopped on purpose (Off, another camera): whatever stopped with it isn't a failure.
    if (this.failed || this.closed) return;
    this.failed = true;
    mlog.error('the matte failed; camera frames are discarded', { err: error });
    this.onFailure(error);
  }

  /* ---------- each frame ---------- */

  /**
   * The camera's picture the right way up, and its size. Where LiveKit reads frames off the playing element (no
   * MediaStreamTrackProcessor: WebKit, so every browser on an iPhone or iPad), each frame keeps the sensor's own
   * orientation and drawing it doesn't turn it: held upright, a 480×640 camera gives 640×480 frames lying on their side,
   * which went out sideways and squashed into the upright track. The element is drawn the way it's shown, at the
   * track's own size, so there it's the element that's drawn. Frames straight off the track (Chrome) are upright.
   */
  private upright(frame: VideoFrame): { image: CanvasImageSource; width: number; height: number } {
    const video = this.inputVideo;
    if (!ProcessorWrapper.hasModernApiSupport && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      return { image: video, width: video.videoWidth, height: video.videoHeight };
    }
    return { image: frame, width: frame.displayWidth, height: frame.displayHeight };
  }

  /** `reading` folded into the settled mask, which it returns. */
  private settle(reading: Float32Array): Float32Array {
    const steady = this.steady;
    if (!steady || steady.length !== reading.length) { this.steady = reading; return reading; }
    for (let i = 0; i < reading.length; i++) {
      const now = reading[i] ?? 0;
      const was = steady[i] ?? 0;
      const k = SLOW + (FAST - SLOW) * smoothstep(LO, HI, Math.abs(now - was));
      steady[i] = was + k * (now - was);
    }
    return steady;
  }

  private timed(ms: number): void {
    this.timing.frames += 1;
    this.timing.ms += ms;
    if (this.timing.frames < REPORT_EVERY) return;
    mlog.debug('matte frame time', { frames: this.timing.frames, msPerFrame: Math.round((this.timing.ms / this.timing.frames) * 10) / 10 });
    this.timing = { frames: 0, ms: 0 };
  }

  /* ---------- setting up ---------- */

  private bound(opts: VideoTransformerInitOptions): void {
    const size = this.budget.size(opts.outputCanvas.width, opts.outputCanvas.height);
    opts.outputCanvas.width = size.width;
    opts.outputCanvas.height = size.height;
  }

  private contextLost = () => { this.fail(new Error('The background graphics context was lost.')); };

  private async start(): Promise<void> {
    if (this.closed) throw new Error('The background was stopped.');
    const canvas = this.canvas;
    if (!canvas) throw new Error('The matte has no canvas to draw on.');
    // The base class set up LiveKit's drawing on this canvas; this draws its own instead.
    this.gl?.cleanup();
    this.gl = undefined;
    const gl = canvas instanceof OffscreenCanvas ? canvas.getContext('webgl2') : canvas.getContext('webgl2');
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('This browser has no WebGL2 for the matte.');
    this.draw = new MatteGl(gl);
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.small = new OffscreenCanvas(MASK_W, MASK_H);
    this.smallCtx = this.small.getContext('2d', { willReadFrequently: false });
    this.source = new OffscreenCanvas(canvas.width, canvas.height);
    this.sourceCtx = this.source.getContext('2d');
    this.steady = null;
    this.waiting = null;
    this.blanks = 0;
    this.failed = false;
    if (!this.segmenter) {
      // Ready once its shaders are compiled, so the first frame is answered at once.
      const segmenter = new Segmenter((reading) => { if (this.segmenter === segmenter) this.masked(reading); }, (error) => this.fail(error));
      this.segmenter = segmenter;
      try { await segmenter.ready; } catch (e) { if (this.segmenter === segmenter) this.segmenter = null; throw e; }
      if (this.closed) throw new Error('The background was stopped.');
    }
    await this.showLook();
  }

  private async showLook(): Promise<void> {
    if (this.closed) throw new Error('The background was stopped.');
    const look = this.options.look;
    this.draw?.setColor('color' in look ? look.color : null);
    if (!('picture' in look)) {
      this.draw?.setPicture(null);
      this.picture?.bitmap.close();
      this.picture = null;
      return;
    }
    let picture = this.picture;
    if (picture?.path !== look.picture) {
      const bitmap = await loadPicture(look.picture);
      if (this.closed) { bitmap.close(); throw new Error('The background was stopped.'); }
      this.picture?.bitmap.close();
      picture = { path: look.picture, bitmap };
      this.picture = picture;
    }
    this.draw?.setPicture(picture.bitmap);
  }

  private drop(): void {
    this.canvas?.removeEventListener('webglcontextlost', this.contextLost);
    this.draw?.destroy();
    this.draw = null;
    this.small = null;
    this.smallCtx = null;
    this.source = null;
    this.sourceCtx = null;
    this.steady = null;
    this.waiting = null;
  }
}

async function loadPicture(src: string): Promise<ImageBitmap> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return createImageBitmap(img);
}
