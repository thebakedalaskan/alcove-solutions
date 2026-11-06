/*
 * Alcove's matte: finds the person in each camera frame and puts something else behind them. LiveKit's
 * ProcessorWrapper (backdrop.ts) feeds it frames and makes the track; this replaces LiveKit's own transformer, whose
 * yes/no mask with nothing carried between frames made the edge shimmer while someone sat still.
 *
 * Each frame:
 * 1. MediaPipe's multiclass selfie segmenter (256×256, on this device) gives how sure it is that each pixel is
 *    background, and the person is everything else, hair included, which the plain selfie models lost against a
 *    background of a similar colour.
 * 2. That's smoothed over time: where it changes a little (the model being unsure) it moves slowly, so the edge
 *    settles; where it changes a lot (someone moving) it follows at once, so nothing trails.
 * 3. matteGl.ts sizes it up to the frame along the camera's own colour edges, and lays the person over the blurred
 *    room or a picture.
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { VideoTransformer, type VideoTransformerInitOptions } from '@livekit/track-processors';
import { log } from '~/lib/log';
import { matteDebug, type MatteFlicker } from './matteDebug';
import { MatteGl, type Edges } from './matteGl';

const mlog = log.child({ component: 'matte' });

/** What shows behind someone: blur, or a picture's URL. */
export type Look = { blur: true } | { picture: string };
export type MatteOptions = { look: Look };

const ASSETS = { wasm: '/mediapipe/wasm', model: '/mediapipe/selfie_multiclass_256x256.tflite' };
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
const BLUR_SIGMA = 14;
/** How many frames between debug lines with the time each took. */
const REPORT_EVERY = 300;

/** Frames each flicker reading is averaged over. */
const FLICKER_EVERY = 15;

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Matte extends VideoTransformer<MatteOptions> {
  private options: MatteOptions;
  private segmenter: ImageSegmenter | null = null;
  private draw: MatteGl | null = null;
  /** The frame made small for the model. */
  private small: OffscreenCanvas | null = null;
  private smallCtx: OffscreenCanvasRenderingContext2D | null = null;
  /** The mask as it's settled so far, MASK_W×MASK_H. */
  private steady: Float32Array | null = null;
  private picture: { path: string; bitmap: ImageBitmap } | null = null;
  private failed = false;
  private timing = { frames: 0, ms: 0 };
  /** For the debug view: the last reading and settled mask, the last drawn edge, and sums toward the next flicker. */
  private last: { reading: Float32Array; settled: Float32Array; edge: Float32Array } | null = null;
  private sums = { frames: 0, reading: 0, settled: 0, edge: 0, ms: 0 };

  constructor(options: MatteOptions) {
    super();
    this.options = options;
  }

  static get isSupported(): boolean {
    return typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(1, 1).getContext('webgl2') !== null;
  }

  override async init(opts: VideoTransformerInitOptions): Promise<void> {
    await super.init(opts);
    await this.start();
  }

  override async restart(opts: VideoTransformerInitOptions): Promise<void> {
    this.canvas = opts.outputCanvas;
    this.inputVideo = opts.inputElement;
    this.isDisabled = false;
    this.drop();
    await this.start();
  }

  async update(options: MatteOptions): Promise<void> {
    this.options = options;
    await this.showLook();
  }

  override async destroy(): Promise<void> {
    await super.destroy();
    this.drop();
    this.segmenter?.close();
    this.segmenter = null;
    this.picture?.bitmap.close();
    this.picture = null;
  }

  transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>): void {
    const canvas = this.canvas;
    if (this.isDisabled || this.failed || !canvas || !this.draw || !this.segmenter || !this.smallCtx || !this.small || frame.codedWidth === 0) {
      controller.enqueue(frame);
      return;
    }
    const started = performance.now();
    try {
      const width = frame.displayWidth;
      const height = frame.displayHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      this.smallCtx.drawImage(frame, 0, 0, MASK_W, MASK_H);
      const reading = this.personIn(this.small, started);
      const steady = this.settle(reading);
      const debug = matteDebug.on();
      this.draw.draw(frame, steady, MASK_W, MASK_H, width, height, BLUR_SIGMA, EDGES, debug ? reading : null);
      controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp }));
      frame.close();
      const ms = performance.now() - started;
      if (debug) this.measure(reading, steady, ms);
      this.timed(ms);
    } catch (e) {
      // Showing the camera as it is beats showing nothing; one line, not one per frame.
      this.failed = true;
      mlog.error('the matte failed, so frames pass through as they are', { err: e });
      controller.enqueue(frame);
    }
  }

  /* ---------- each frame ---------- */

  /** How sure the model is that each pixel is the person, MASK_W×MASK_H, top row first. */
  private personIn(image: OffscreenCanvas, at: number): Float32Array {
    const got: { mask: Float32Array | null } = { mask: null };
    this.segmenter?.segmentForVideo(image, at, (result) => {
      // Background, hair, body skin, face skin, clothes, other: the person is everything but the background. The masks
      // only live inside this callback, so it's copied out (by the `map`).
      got.mask = result.confidenceMasks?.[0]?.getAsFloat32Array().map((v) => 1 - v) ?? null;
    });
    if (!got.mask) throw new Error('The segmenter gave no mask.');
    return got.mask;
  }

  /** `reading` folded into the settled mask, which it returns. */
  private settle(reading: Float32Array): Float32Array {
    const steady = this.steady;
    if (!steady || steady.length !== reading.length) { const first = reading.slice(); this.steady = first; return first; }
    for (let i = 0; i < reading.length; i++) {
      const now = reading[i] ?? 0;
      const was = steady[i] ?? 0;
      const k = SLOW + (FAST - SLOW) * smoothstep(LO, HI, Math.abs(now - was));
      steady[i] = was + k * (now - was);
    }
    return steady;
  }

  /** Adds this frame's movement at the edge to the debug view's flicker numbers. The edge is the settled mask put
   * through the same fade as the drawing (without the colour-guided upsample, which only runs on the GPU). */
  private measure(reading: Float32Array, settled: Float32Array, ms: number): void {
    const edge = new Float32Array(settled.length);
    for (let i = 0; i < settled.length; i++) edge[i] = smoothstep(EDGES.lo, EDGES.hi, settled[i] ?? 0);
    const last = this.last;
    this.last = { reading: reading.slice(), settled: settled.slice(), edge };
    if (!last || last.reading.length !== reading.length) return;
    let n = 0;
    let r = 0;
    let s = 0;
    let e = 0;
    for (let i = 0; i < reading.length; i++) {
      const was = last.settled[i] ?? 0;
      if (was < 0.1 || was > 0.9) continue;
      n += 1;
      r += Math.abs((reading[i] ?? 0) - (last.reading[i] ?? 0));
      s += Math.abs((settled[i] ?? 0) - was);
      e += Math.abs((edge[i] ?? 0) - (last.edge[i] ?? 0));
    }
    if (n === 0) return;
    const t = this.sums;
    this.sums = { frames: t.frames + 1, reading: t.reading + r / n, settled: t.settled + s / n, edge: t.edge + e / n, ms: t.ms + ms };
    if (this.sums.frames < FLICKER_EVERY) return;
    const f = this.sums.frames;
    const flicker: MatteFlicker = { reading: this.sums.reading / f, settled: this.sums.settled / f, edge: this.sums.edge / f, msPerFrame: this.sums.ms / f };
    this.sums = { frames: 0, reading: 0, settled: 0, edge: 0, ms: 0 };
    matteDebug.report(flicker);
  }

  private timed(ms: number): void {
    this.timing.frames += 1;
    this.timing.ms += ms;
    if (this.timing.frames < REPORT_EVERY) return;
    mlog.debug('matte frame time', { frames: this.timing.frames, msPerFrame: Math.round((this.timing.ms / this.timing.frames) * 10) / 10 });
    this.timing = { frames: 0, ms: 0 };
  }

  /* ---------- setting up ---------- */

  private async start(): Promise<void> {
    const canvas = this.canvas;
    if (!canvas) throw new Error('The matte has no canvas to draw on.');
    // The base class set up LiveKit's drawing on this canvas; this draws its own instead.
    this.gl?.cleanup();
    const gl = canvas instanceof OffscreenCanvas ? canvas.getContext('webgl2') : canvas.getContext('webgl2');
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('This browser has no WebGL2 for the matte.');
    this.draw = new MatteGl(gl);
    this.small = new OffscreenCanvas(MASK_W, MASK_H);
    this.smallCtx = this.small.getContext('2d', { willReadFrequently: false });
    this.steady = null;
    this.failed = false;
    if (!this.segmenter) {
      const files = await FilesetResolver.forVisionTasks(ASSETS.wasm);
      // Its own canvas, so MediaPipe's WebGL state never meets the drawing's.
      this.segmenter = await ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: ASSETS.model, delegate: 'GPU' },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false
      });
    }
    await this.showLook();
  }

  private async showLook(): Promise<void> {
    const look = this.options.look;
    if (!('picture' in look)) { this.draw?.setPicture(null); return; }
    let picture = this.picture;
    if (picture?.path !== look.picture) {
      const bitmap = await loadPicture(look.picture);
      this.picture?.bitmap.close();
      picture = { path: look.picture, bitmap };
      this.picture = picture;
    }
    this.draw?.setPicture(picture.bitmap);
  }

  private drop(): void {
    this.draw?.destroy();
    this.draw = null;
    this.small = null;
    this.smallCtx = null;
    this.steady = null;
    this.last = null;
  }
}

async function loadPicture(src: string): Promise<ImageBitmap> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return createImageBitmap(img);
}
