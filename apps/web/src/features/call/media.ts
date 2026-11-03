/*
 * Local media: camera, microphone and screen, plus the notes recorder. One instance lives from the
 * pre-join screen through the call, so permission is asked once and the preview carries over.
 */
import type { AudioPiece } from '@alcove/api';
import { log } from '~/lib/log';

const mlog = log.child({ component: 'media' });

export interface MediaSnapshot {
  camera: MediaStream | null;
  screen: MediaStream | null;
  mic: boolean;
  cam: boolean;
  /** Set when the browser refused or lacks a device; the call still works without it. */
  error: string | null;
}

function explain(e: unknown, what: string): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return `Alcove isn’t allowed to use your ${what}. Allow it in the browser’s address bar.`;
    if (e.name === 'NotFoundError') return `No ${what} found.`;
    if (e.name === 'NotReadableError') return `Your ${what} is in use by another app.`;
  }
  return `Couldn’t start your ${what}.`;
}

export class LocalMedia {
  private snap: MediaSnapshot = { camera: null, screen: null, mic: true, cam: true, error: null };
  private listeners = new Set<() => void>();
  private audio: MediaStreamTrack | null = null;
  private video: MediaStreamTrack | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(4096));

  getSnapshot = (): MediaSnapshot => this.snap;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<MediaSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach((l) => l()); }
  private rebuild() {
    const tracks = [this.audio, this.video].filter((t): t is MediaStreamTrack => !!t);
    this.set({ camera: tracks.length ? new MediaStream(tracks) : null });
  }

  /** Asks for microphone (and camera when on). Safe to call again after an error. */
  async start(opts: { mic: boolean; cam: boolean }): Promise<void> {
    this.set({ mic: opts.mic, cam: opts.cam, error: null });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: opts.cam ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false });
      this.audio = s.getAudioTracks()[0] ?? null;
      this.video = s.getVideoTracks()[0] ?? null;
      if (this.audio) this.audio.enabled = opts.mic;
      this.meter();
      this.rebuild();
      mlog.info('devices started', { mic: Boolean(this.audio), cam: Boolean(this.video) });
    } catch (e) {
      mlog.warn('could not start devices', { err: e, wantedCam: opts.cam });
      this.set({ error: explain(e, opts.cam ? 'camera and microphone' : 'microphone'), cam: false });
    }
  }
  setMic(on: boolean) { if (this.audio) this.audio.enabled = on; this.set({ mic: on }); }
  async setCam(on: boolean) {
    if (!on) { this.video?.stop(); this.video = null; this.set({ cam: false }); this.rebuild(); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
      this.video = s.getVideoTracks()[0] ?? null;
      this.set({ cam: !!this.video, error: null });
      this.rebuild();
    } catch (e) { mlog.warn('could not turn the camera on', { err: e }); this.set({ cam: false, error: explain(e, 'camera') }); }
  }
  /** Starts screen sharing. Resolves false if the user cancelled the picker. */
  async shareScreen(onEnded: () => void): Promise<string | false> {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = s.getVideoTracks()[0];
      if (!track) return false;
      track.addEventListener('ended', () => { this.set({ screen: null }); onEnded(); });
      this.set({ screen: s });
      mlog.info('screen sharing started', { surface: track.getSettings().displaySurface ?? null });
      return track.label || 'Your screen';
    } catch (e) {
      // Cancelling the picker is a NotAllowedError; anything else is worth knowing about.
      mlog.at(e instanceof DOMException && e.name === 'NotAllowedError' ? 'debug' : 'warn', 'screen sharing not started', { err: e });
      return false;
    }
  }
  stopScreen() { this.snap.screen?.getTracks().forEach((t) => t.stop()); this.set({ screen: null }); }
  /** Microphone level, 0..1. */
  level(): number {
    if (!this.analyser || !this.snap.mic) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }
  micTrack(): MediaStreamTrack | null { return this.audio; }
  private meter() {
    if (!this.audio || this.analyser) return;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.ctx.createMediaStreamSource(new MediaStream([this.audio])).connect(this.analyser);
  }
  stop() {
    [this.audio, this.video].forEach((t) => t?.stop());
    this.stopScreen();
    void this.ctx?.close();
    this.audio = null; this.video = null; this.analyser = null; this.ctx = null;
    this.set({ camera: null });
  }
}

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export const recordingMime = (): string => MIME.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'audio/webm';
export const PIECE_MS = 5000;

/**
 * Records the microphone in 5-second pieces and uploads them in order. Each piece is retried a few
 * times; the server treats a repeated (segment, seq) as a no-op, so retries never duplicate audio.
 */
export class NotesRecorder {
  private rec: MediaRecorder | null = null;
  private seq = 0;
  private segment = -1;
  private last = 0;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly upload: (p: AudioPiece) => Promise<void>, private readonly onError: (message: string) => void) {}

  get running() { return this.rec?.state === 'recording'; }
  /** Starts (or continues) recording into `segment`. */
  start(track: MediaStreamTrack, segment: number) {
    if (this.rec && this.segment === segment) { if (this.rec.state === 'paused') { this.rec.resume(); this.last = performance.now(); } return; }
    this.stop();
    const mimeType = recordingMime();
    this.rec = new MediaRecorder(new MediaStream([track]), { mimeType, audioBitsPerSecond: 32_000 });
    this.segment = segment; this.seq = 0; this.last = performance.now();
    this.rec.addEventListener('dataavailable', (e) => {
      if (!e.data.size) return;
      const now = performance.now();
      const p: AudioPiece = { data: e.data, segment: this.segment, seq: this.seq++, durationMs: Math.max(0, now - this.last), mimeType };
      this.last = now;
      this.queue = this.queue.then(() => this.send(p));
    });
    this.rec.addEventListener('error', (e) => mlog.error('notes recorder failed', { err: e.error }));
    this.rec.start(PIECE_MS);
    mlog.info('notes recorder started', { mimeType, segment: this.segment });
  }
  pause() { if (this.rec?.state === 'recording') { this.rec.requestData(); this.rec.pause(); } }
  stop() { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); this.rec = null; }
  /** Waits until every recorded piece has been uploaded. */
  async flush(): Promise<void> { this.stop(); await new Promise((r) => setTimeout(r, 50)); await this.queue; }
  private async send(p: AudioPiece) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await this.upload(p); mlog.debug('audio piece uploaded', { segment: p.segment, seq: p.seq, bytes: p.data.size, attempt }); return; } catch (e) {
        mlog.at(attempt === 2 ? 'error' : 'warn', attempt === 2 ? 'audio piece lost after 3 attempts' : 'audio piece upload failed; retrying', { err: e, segment: p.segment, seq: p.seq, bytes: p.data.size, attempt });
        if (attempt === 2) this.onError(e instanceof Error ? e.message : 'A piece of the recording couldn’t be saved.');
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
}
