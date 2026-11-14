/*
 * The page's side of the matte's model (segmenterWorker.ts): starts the worker, hands it one frame at a time and takes each
 * mask back. The matte draws that frame when its mask comes back and lets the frames in between go, so a slow model lowers
 * the frame rate and never holds up the page.
 */
import type { SegmenterAnswer, SegmenterAsk } from './segmenterWorker';

/** The model and its WebAssembly, from Alcove's own origin (vite.config.ts, public/mediapipe). */
const ASSETS = { wasm: '/mediapipe/wasm', model: '/mediapipe/selfie_multiclass_256x256.tflite' };
/**
 * A frame the worker hasn't answered for this long, and while this many more were drawn, means it has stopped: the matte stops
 * too, rather than keep a mask that no longer fits. Counting frames as well means a phone that put the page to sleep (another
 * app, the screen locked) doesn't count the sleep.
 */
const STALLED_MS = 10_000;
const STALLED_FRAMES = 30;

function isAnswer(v: unknown): v is SegmenterAnswer {
  if (typeof v !== 'object' || v === null || !('kind' in v)) return false;
  if (v.kind === 'ready') return true;
  if (v.kind === 'mask') return 'mask' in v && (v.mask === null || v.mask instanceof Float32Array) && 'seq' in v && typeof v.seq === 'number';
  return v.kind === 'failed' && 'message' in v && typeof v.message === 'string';
}

export class Segmenter {
  /** Settles once the worker has compiled the model's shaders on a blank frame, or fails to. */
  readonly ready: Promise<void>;
  private readonly worker: Worker;
  private started: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private seq = 0;
  /** The frame with the worker, when it went, and how many frames have been drawn since. */
  private pending: { seq: number; since: number; waited: number } | null = null;
  private stopped = false;

  /**
   * `onMask` gets each frame's mask, MASK_W×MASK_H, top row first, or null when the reading came back empty; `onFailure` once,
   * if it stops after it was ready.
   */
  constructor(private readonly onMask: (mask: Float32Array | null) => void, private readonly onFailure: (error: Error) => void) {
    this.ready = new Promise<void>((resolve, reject) => { this.started = { resolve, reject }; });
    // Whoever awaits it hears a failure; it's never left unhandled when nobody does (stopped while it started).
    this.ready.catch(() => undefined);
    this.worker = new Worker(new URL('./segmenterWorker.ts', import.meta.url), { type: 'module', name: 'alcove-matte' });
    this.worker.onmessage = (e: MessageEvent<unknown>) => this.heard(e.data);
    this.worker.onerror = (e) => { e.preventDefault(); this.stop(new Error(e.message || 'The background model stopped.')); };
    this.worker.onmessageerror = () => this.stop(new Error('The background model sent something unreadable.'));
    this.ask({ kind: 'start', ...ASSETS, touch: 'ontouchend' in document });
  }

  /** Whether a frame is still with the worker, asked once for each frame drawn. One that's been there too long stops it. */
  busy(now: number): boolean {
    const p = this.pending;
    if (this.stopped) return true;
    if (!p) return false;
    p.waited += 1;
    if (p.waited > STALLED_FRAMES && now - p.since > STALLED_MS) this.stop(new Error('The background model stopped answering.'));
    return true;
  }

  /** Hands `image` (the frame at MASK_W×MASK_H, upright) to the worker, which closes it. `at` is the frame's time. */
  send(image: ImageBitmap, at: number): void {
    if (this.stopped || this.pending) { image.close(); return; }
    const seq = ++this.seq;
    this.pending = { seq, since: at, waited: 0 };
    this.ask({ kind: 'frame', image, at, seq }, [image]);
  }

  /** Lets the worker go, and the GPU memory and model with it. */
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pending = null;
    this.started?.reject(new Error('The background was stopped.'));
    this.started = null;
    this.worker.terminate();
  }

  private ask(a: SegmenterAsk, transfer: Transferable[] = []): void { this.worker.postMessage(a, transfer); }

  private heard(data: unknown): void {
    if (this.stopped || !isAnswer(data)) return;
    if (data.kind === 'ready') { this.started?.resolve(); this.started = null; return; }
    if (data.kind === 'failed') { this.stop(new Error(data.message)); return; }
    if (this.pending?.seq === data.seq) this.pending = null;
    this.onMask(data.mask);
  }

  private stop(error: Error): void {
    if (this.stopped) return;
    const starting = this.started;
    this.started = null;
    this.close();
    // Before it was ready, whoever is starting it hears why; after, the matte does.
    if (starting) starting.reject(error);
    else this.onFailure(error);
  }
}
