/*
 * Alcove's matte: finds the person in each camera frame and puts something else behind them. LiveKit's
 * ProcessorWrapper (backdrop.ts) feeds it frames and makes the track; this replaces LiveKit's own transformer, whose
 * yes/no mask with nothing carried between frames made the edge shimmer while someone sat still.
 *
 * Each frame:
 * 1. A MediaPipe segmenter (on this device) gives how sure it is that each pixel is the person, from 0 to 1. It's
 *    the landscape selfie model (144×256); in development the debug view can switch to the multiclass one (256×256,
 *    which counts hair as the person) to compare them.
 * 2. That's smoothed over time: where it changes a little (the model being unsure) it moves slowly, so the edge
 *    settles; where it changes a lot (someone moving) it follows at once, so nothing trails.
 * 3. matteGl.ts sizes it up to the frame along the camera's own colour edges, and lays the person over the blurred
 *    room or a picture.
 */
import { FilesetResolver, ImageSegmenter, type MPMask } from '@mediapipe/tasks-vision';
import { VideoTransformer, type VideoTransformerInitOptions } from '@livekit/track-processors';
import { log } from '~/lib/log';
import { matteDebug, type MatteFlicker, type MatteModel } from './matteDebug';
import { MatteGl, type Edges } from './matteGl';

const mlog = log.child({ component: 'matte' });

/** What shows behind someone: blur, or a picture's URL. */
export type Look = { blur: true } | { picture: string };
export type MatteOptions = { look: Look };

const WASM = '/mediapipe/wasm';

/** Each model: its file, its own input size (what each frame is made before it's segmented, and the mask's size), and
 * how to read the person from its masks. */
interface ModelSpec { path: string; w: number; h: number; person: (masks: MPMask[]) => Float32Array | null }
const MODELS: Record<MatteModel, ModelSpec> = {
  // One mask: the person.
  landscape: { path: '/mediapipe/selfie_segmenter_landscape.tflite', w: 256, h: 144, person: (m) => m[0]?.getAsFloat32Array().slice() ?? null },
  // Background, hair, body skin, face skin, clothes, other: the person is everything but the background.
  multiclass: {
    path: '/mediapipe/selfie_multiclass_256x256.tflite', w: 256, h: 256,
    person: (m) => m[0]?.getAsFloat32Array().map((v) => 1 - v) ?? null
  }
};

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
  private model: { id: MatteModel; spec: ModelSpec } | null = null;
  /** Another model on its way in (development only); frames keep using the current one meanwhile. */
  private loading: MatteModel | null = null;
  private draw: MatteGl | null = null;
  /** The frame made small for the model. */
  private small: OffscreenCanvas | null = null;
  private smallCtx: OffscreenCanvasRenderingContext2D | null = null;
  /** The mask as it's settled so far, at the model's size. */
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
    this.model = null;
    this.picture?.bitmap.close();
    this.picture = null;
  }

  transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>): void {
    const canvas = this.canvas;
    const want = matteDebug.model();
    if (this.model && this.model.id !== want && this.loading === null) void this.switchModel(want);
    const model = this.model;
    if (this.isDisabled || this.failed || !canvas || !this.draw || !this.segmenter || !model || !this.smallCtx || !this.small || frame.codedWidth === 0) {
      controller.enqueue(frame);
      return;
    }
    const started = performance.now();
    try {
      const width = frame.displayWidth;
      const height = frame.displayHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const { w, h } = model.spec;
      if (this.small.width !== w || this.small.height !== h) { this.small.width = w; this.small.height = h; }
      this.smallCtx.drawImage(frame, 0, 0, w, h);
      const reading = this.personIn(this.small, started, model.spec);
      const steady = this.settle(reading);
      const debug = matteDebug.on();
      this.draw.draw(frame, steady, w, h, width, height, BLUR_SIGMA, EDGES, debug ? reading : null);
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

  /** How sure the model is that each pixel is the person, at the model's size, top row first. */
  private personIn(image: OffscreenCanvas, at: number, spec: ModelSpec): Float32Array {
    const got: { mask: Float32Array | null } = { mask: null };
    // The masks only live inside the callback, so each model's `person` copies its answer out.
    this.segmenter?.segmentForVideo(image, at, (result) => {
      got.mask = spec.person(result.confidenceMasks ?? []);
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
    const flicker: MatteFlicker = { model: this.model?.id ?? 'landscape', reading: this.sums.reading / f, settled: this.sums.settled / f, edge: this.sums.edge / f, msPerFrame: this.sums.ms / f };
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
    this.small = new OffscreenCanvas(1, 1);
    this.smallCtx = this.small.getContext('2d', { willReadFrequently: false });
    this.steady = null;
    this.failed = false;
    if (!this.segmenter) {
      const id = matteDebug.model();
      this.segmenter = await segmenterFor(MODELS[id]);
      this.model = { id, spec: MODELS[id] };
    }
    await this.showLook();
  }

  /** Development only: brings in another model, then swaps it for the one in use, and starts the mask over. */
  private async switchModel(id: MatteModel): Promise<void> {
    this.loading = id;
    try {
      const next = await segmenterFor(MODELS[id]);
      if (this.isDisabled || !this.segmenter) { next.close(); return; }
      this.segmenter.close();
      this.segmenter = next;
      this.model = { id, spec: MODELS[id] };
      this.steady = null;
      this.last = null;
      this.sums = { frames: 0, reading: 0, settled: 0, edge: 0, ms: 0 };
      mlog.info('matte model switched', { model: id });
    } catch (e) {
      // Most likely its file isn't in public/mediapipe: go back to the one in use.
      mlog.warn('matte model didn’t load', { model: id, err: e });
      if (this.model) matteDebug.setModel(this.model.id);
    } finally {
      this.loading = null;
    }
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

async function segmenterFor(spec: ModelSpec): Promise<ImageSegmenter> {
  const files = await FilesetResolver.forVisionTasks(WASM);
  // Its own canvas, so MediaPipe's WebGL state never meets the drawing's.
  return ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: spec.path, delegate: 'GPU' },
    canvas: new OffscreenCanvas(1, 1),
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false
  });
}

async function loadPicture(src: string): Promise<ImageBitmap> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return createImageBitmap(img);
}
