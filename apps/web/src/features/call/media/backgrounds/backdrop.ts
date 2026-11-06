/*
 * Puts something else behind someone on camera: blur, or a picture. Alcove's matte (matte.ts) finds the person in
 * each frame (MediaPipe's selfie segmenter, on this device) and draws the rest over, and LiveKit's ProcessorWrapper
 * makes a track of it, before anything is encrypted or sent. Its code is loaded only once someone picks a
 * background, and the model and its WebAssembly come from Alcove's own origin (vite.config.ts, public/mediapipe):
 * nothing is fetched from anywhere else.
 */
import type { ProcessorWrapper } from '@livekit/track-processors';
import type { Look, Matte, MatteOptions } from './matte';

export type { Look } from './matte';
type Processor = ProcessorWrapper<MatteOptions, Matte>;

let support: Promise<boolean> | null = null;
/** Whether this browser can do it: WebGL2, and a way to make a video track from frames. Asked once per page. */
export function canBackdrop(): Promise<boolean> {
  support ??= Promise.all([import('@livekit/track-processors'), import('./matte')])
    .then(([lk, m]) => lk.ProcessorWrapper.isSupported && m.Matte.isSupported, () => false);
  return support;
}

/**
 * One camera's background, from the first picked until it's let go: a new camera track (another camera, or the same
 * one opened again) restarts it, and another look switches it in place, so the picture sent never stops.
 */
export class Backdrop {
  private active: { processor: Processor; failed: boolean; error: unknown; ready: boolean } | null = null;
  /** The camera track it draws from, and the element that plays it (the processor reads frames through one). */
  private source: MediaStreamTrack | null = null;
  private element: HTMLVideoElement | null = null;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private stopping: Promise<void> | null = null;

  constructor(private readonly onFailure: (camera: MediaStreamTrack, error: unknown) => void) {}

  /** The track it makes from `camera` with `look` behind: from the same processor while the camera's the same. */
  show(camera: MediaStreamTrack, look: Look): Promise<MediaStreamTrack> {
    const work = this.pending.then(() => this.draw(camera, look));
    this.pending = work.then(() => undefined, () => undefined);
    return work;
  }

  private async draw(camera: MediaStreamTrack, look: Look): Promise<MediaStreamTrack> {
    const [{ ProcessorWrapper }, { Matte }, { Track }] = await Promise.all([import('@livekit/track-processors'), import('./matte'), import('livekit-client')]);
    if (this.stopped) throw new Error('The background was stopped.');
    try {
      if (this.active && this.source === camera) {
        await this.active.processor.updateTransformerOptions({ look });
      } else {
        await this.release();
        if (this.stopped) throw new Error('The background was stopped.');
        const element = this.play(camera);
        const matte = new Matte({ look }, (error) => {
          const active = this.active;
          if (this.stopped || active?.processor.transformer !== matte) return;
          active.failed = true;
          active.error = error;
          // Initialization failures are returned by show(). A running failure must turn the camera off at once.
          if (active.ready) this.onFailure(camera, error);
        });
        const processor = new ProcessorWrapper<MatteOptions, Matte>(matte, 'alcove-backdrop');
        this.active = { processor, failed: false, error: null, ready: false };
        this.source = camera;
        await processor.init({ kind: Track.Kind.Video, track: camera, element });
      }
      const active = this.active;
      if (this.stopped) throw new Error('The background was stopped.');
      if (active?.failed) throw active.error;
      const out = active?.processor.processedTrack;
      if (!out) throw new Error('The background processor made no track.');
      active.ready = true;
      return out;
    } catch (e) {
      this.stopped = true;
      this.detach();
      await this.release();
      throw e;
    }
  }

  /** The camera's size changed: the next `show` starts over from it, since what it draws is sized when it starts. */
  resized(): void { this.source = null; }

  /** Stops drawing: the track it made ends, and the camera's own is left as it is. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.active?.processor.processedTrack?.stop();
    this.detach();
    // Wrapper.destroy() ignores its initializing state. Keep ownership until init/update settles, then destroy.
    this.stopping = this.pending.then(() => this.release());
    return this.stopping;
  }

  private detach(): void {
    if (!this.element) return;
    this.element.pause();
    this.element.srcObject = null;
    this.element = null;
  }

  private async release(): Promise<void> {
    const active = this.active;
    this.active = null;
    this.source = null;
    if (!active) return;
    const p = active.processor;
    try {
      await p.destroy();
    } finally {
      // setup() can reject before the wrapper reaches running, when its destroy() is a no-op.
      p.processedTrack?.stop();
      p.trackGenerator?.stop();
      p.displayCanvas?.remove();
      await p.transformer.destroy();
    }
  }

  /** A muted element playing `camera`, never on the page, for the processor to read from. */
  private play(camera: MediaStreamTrack): HTMLVideoElement {
    const v = this.element ?? document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream([camera]);
    void v.play().catch(() => undefined);
    this.element = v;
    return v;
  }
}
