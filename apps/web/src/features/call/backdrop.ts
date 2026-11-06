/*
 * Puts something else behind someone on camera: blur, or a picture. LiveKit's background processor finds the person
 * in each frame (MediaPipe's selfie segmenter, on this device) and draws the rest over, before anything is encrypted
 * or sent. Its code is loaded only once someone picks a background, and the model and its WebAssembly come from
 * Alcove's own origin (vite.config.ts, public/mediapipe): nothing is fetched from anywhere else.
 */
import type { BackgroundProcessor, SwitchBackgroundProcessorOptions } from '@livekit/track-processors';

type Processor = ReturnType<typeof BackgroundProcessor>;
/** What the processor shows behind someone, ready for it: blur, or a picture's URL. */
export type Look = { blur: true } | { picture: string };

const ASSETS = { tasksVisionFileSet: '/mediapipe/wasm', modelAssetPath: '/mediapipe/selfie_segmenter.tflite' };
const BLUR_RADIUS = 14;

const modeOf = (look: Look): SwitchBackgroundProcessorOptions =>
  'picture' in look ? { mode: 'virtual-background', imagePath: look.picture } : { mode: 'background-blur', blurRadius: BLUR_RADIUS };

let support: Promise<boolean> | null = null;
/** Whether this browser can do it: WebGL2, and a way to make a video track from frames. Asked once per page. */
export function canBackdrop(): Promise<boolean> {
  support ??= import('@livekit/track-processors').then((m) => m.supportsBackgroundProcessors(), () => false);
  return support;
}

/**
 * One camera's background, from the first picked until it's let go: a new camera track (another camera, or the same
 * one opened again) restarts it, and another look switches it in place, so the picture sent never stops.
 */
export class Backdrop {
  private processor: Processor | null = null;
  /** The camera track it draws from, and the element that plays it (the processor reads frames through one). */
  private source: MediaStreamTrack | null = null;
  private element: HTMLVideoElement | null = null;

  /** The track it makes from `camera` with `look` behind: from the same processor while the camera's the same. */
  async show(camera: MediaStreamTrack, look: Look): Promise<MediaStreamTrack> {
    const [{ BackgroundProcessor }, { Track }] = await Promise.all([import('@livekit/track-processors'), import('livekit-client')]);
    if (this.processor && this.source === camera) {
      await this.processor.switchTo(modeOf(look));
    } else {
      const element = this.play(camera);
      const opts = { kind: Track.Kind.Video, track: camera, element };
      if (this.processor) {
        await this.processor.restart(opts);
        await this.processor.switchTo(modeOf(look));
      } else {
        const p = BackgroundProcessor({ ...modeOf(look), assetPaths: ASSETS });
        this.processor = p;
        await p.init(opts);
      }
      this.source = camera;
    }
    const out = this.processor?.processedTrack;
    if (!out) throw new Error('The background processor made no track.');
    return out;
  }

  /** The camera's size changed: the next `show` starts over from it, since what it draws is sized when it starts. */
  resized(): void { this.source = null; }

  /** Stops drawing: the track it made ends, and the camera's own is left as it is. */
  async stop(): Promise<void> {
    const p = this.processor;
    this.processor = null;
    this.source = null;
    if (this.element) { this.element.srcObject = null; this.element = null; }
    await p?.destroy();
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
