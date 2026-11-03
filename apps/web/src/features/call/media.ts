/*
 * Local media: camera, microphone and screen, plus the notes recorder. One instance lives from the
 * pre-join screen through the call, so permission is asked once and the preview carries over. The
 * microphone and camera chosen last time are used again when they're plugged in.
 */
import type { AudioPiece } from '@alcove/api';
import { log } from '~/lib/log';
import { readPrefs, rememberDevice } from './devices';

const mlog = log.child({ component: 'media' });

export interface MediaSnapshot {
  camera: MediaStream | null;
  screen: MediaStream | null;
  mic: boolean;
  cam: boolean;
  /** The microphone and camera in use, and the speaker chosen for playback. */
  micId: string | null;
  camId: string | null;
  speakerId: string | null;
  /** Set when the browser refused or lacks a device; the call still works without it. */
  error: string | null;
  /** Set when a chosen device isn't plugged in and another is used instead. */
  notice: string | null;
}

const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 } } as const;
const AUDIO = { echoCancellation: true, noiseSuppression: true } as const;
const deviceOf = (t: MediaStreamTrack | null) => t?.getSettings().deviceId ?? null;

function explain(e: unknown, what: string): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return `Alcove isn’t allowed to use your ${what}. Allow it in the browser’s address bar.`;
    if (e.name === 'NotFoundError') return `No ${what} found.`;
    if (e.name === 'NotReadableError') return `Your ${what} is in use by another app.`;
  }
  return `Couldn’t start your ${what}.`;
}

export class LocalMedia {
  private snap: MediaSnapshot = { camera: null, screen: null, mic: true, cam: true, micId: null, camId: null, speakerId: readPrefs().speaker ?? null, error: null, notice: null };
  private listeners = new Set<() => void>();
  private audio: MediaStreamTrack | null = null;
  private video: MediaStreamTrack | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(4096));

  getSnapshot = (): MediaSnapshot => this.snap;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<MediaSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach((l) => l()); }
  private rebuild() {
    const tracks = [this.audio, this.video].filter((t): t is MediaStreamTrack => !!t);
    this.set({ camera: tracks.length ? new MediaStream(tracks) : null });
  }

  /** Asks for microphone (and camera when on), the ones chosen last time if they're plugged in. Safe to call again after an error. */
  async start(opts: { mic: boolean; cam: boolean }): Promise<void> {
    this.set({ mic: opts.mic, cam: opts.cam, error: null, notice: null });
    const prefs = readPrefs();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { ...AUDIO, ...(prefs.mic ? { deviceId: { ideal: prefs.mic } } : {}) },
        video: opts.cam ? { ...VIDEO, ...(prefs.cam ? { deviceId: { ideal: prefs.cam } } : { facingMode: 'user' }) } : false
      });
      this.audio = s.getAudioTracks()[0] ?? null;
      this.video = s.getVideoTracks()[0] ?? null;
      if (this.audio) this.audio.enabled = opts.mic;
      this.meter();
      this.rebuild();
      const micId = deviceOf(this.audio);
      const camId = deviceOf(this.video);
      // A remembered device that isn't plugged in: the browser picked another, and the screen says which.
      const missing = [prefs.mic && micId && prefs.mic !== micId ? `microphone (now ${this.audio?.label || 'the default'})` : '', prefs.cam && camId && prefs.cam !== camId ? `camera (now ${this.video?.label || 'the default'})` : ''].filter(Boolean);
      this.set({ micId, camId, notice: missing.length ? `The ${missing.join(' and ')} you chose before isn’t connected, so Alcove is using another.` : null });
      mlog.info('devices started', { mic: Boolean(this.audio), cam: Boolean(this.video), remembered: Boolean(prefs.mic || prefs.cam), substituted: missing.length });
    } catch (e) {
      mlog.warn('could not start devices', { err: e, wantedCam: opts.cam });
      this.set({ error: explain(e, opts.cam ? 'camera and microphone' : 'microphone'), cam: false });
    }
  }
  setMic(on: boolean) { if (this.audio) this.audio.enabled = on; this.set({ mic: on }); }
  async setCam(on: boolean) {
    if (!on) { this.video?.stop(); this.video = null; this.set({ cam: false }); this.rebuild(); return; }
    const pref = readPrefs().cam;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, ...(pref ? { deviceId: { ideal: pref } } : { facingMode: 'user' }) } });
      this.video = s.getVideoTracks()[0] ?? null;
      this.set({ cam: !!this.video, camId: deviceOf(this.video), error: null });
      this.rebuild();
    } catch (e) { mlog.warn('could not turn the camera on', { err: e }); this.set({ cam: false, error: explain(e, 'camera') }); }
  }
  /**
   * Switches to another microphone, keeping it muted or not as it was. The notes recorder and the live
   * transcript carry on with the new one (they follow micTrack()).
   */
  async chooseMic(deviceId: string): Promise<void> {
    if (deviceId === this.snap.micId) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, deviceId: { exact: deviceId } } });
      const next = s.getAudioTracks()[0];
      if (!next) return;
      next.enabled = this.snap.mic;
      const before = this.audio;
      this.audio = next;
      this.meter();
      this.rebuild();
      before?.stop();
      rememberDevice('mic', deviceId);
      this.set({ micId: deviceOf(next), error: null, notice: null });
      mlog.info('microphone changed', { muted: !this.snap.mic });
    } catch (e) {
      mlog.warn('could not switch microphones', { err: e });
      this.set({ error: explain(e, 'microphone') });
    }
  }
  /** Switches to another camera. With the camera off it's remembered for when it's turned on. */
  async chooseCam(deviceId: string): Promise<void> {
    rememberDevice('cam', deviceId);
    if (!this.snap.cam || deviceId === this.snap.camId) { this.set({ camId: deviceId }); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, deviceId: { exact: deviceId } } });
      const next = s.getVideoTracks()[0];
      if (!next) return;
      this.video?.stop();
      this.video = next;
      this.rebuild();
      this.set({ camId: deviceOf(next), error: null, notice: null });
      mlog.info('camera changed');
    } catch (e) {
      mlog.warn('could not switch cameras', { err: e });
      this.set({ error: explain(e, 'camera') });
    }
  }
  /** Where the microphone test (and, in calls with others, their voices) plays. */
  chooseSpeaker(deviceId: string) { rememberDevice('speaker', deviceId); this.set({ speakerId: deviceId }); }
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
  /** The level meter listens to whichever microphone is in use. */
  private meter() {
    if (!this.audio) return;
    if (!this.ctx || !this.analyser) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    }
    this.source?.disconnect();
    this.source = this.ctx.createMediaStreamSource(new MediaStream([this.audio]));
    this.source.connect(this.analyser);
  }
  stop() {
    [this.audio, this.video].forEach((t) => t?.stop());
    this.stopScreen();
    void this.ctx?.close();
    this.audio = null; this.video = null; this.analyser = null; this.ctx = null; this.source = null;
    this.set({ camera: null });
  }
}

/** Audio starts suspended on a page nobody has clicked yet; the first click or key press wakes it. */
export function wakeAudio(ctx: AudioContext) {
  const go = () => { if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined); };
  go();
  addEventListener('pointerdown', go, { once: true, capture: true });
  addEventListener('keydown', go, { once: true, capture: true });
}

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export const recordingMime = (): string => MIME.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'audio/webm';
export const PIECE_MS = 5000;

/**
 * Records the microphone in 5-second pieces and uploads them in order. Each piece is retried a few
 * times; the server treats a repeated (segment, seq) as a no-op, so retries never duplicate audio.
 * The server refuses audio once notes are off, so stopping waits for the last piece before anyone
 * switches notes off. The microphone reaches the recorder through a small audio graph, so switching
 * microphones mid-recording carries on in the same recording instead of going silent.
 */
export class NotesRecorder {
  private rec: MediaRecorder | null = null;
  private segment = -1;
  private queue: Promise<void> = Promise.resolve();
  private graph: { ctx: AudioContext; dest: MediaStreamAudioDestinationNode; source: MediaStreamAudioSourceNode | null; track: MediaStreamTrack | null } | null = null;
  constructor(private readonly upload: (p: AudioPiece) => Promise<void>, private readonly onError: (message: string) => void) {}

  get running() { return this.rec?.state === 'recording'; }
  /** Starts (or continues) recording into `segment`, from `track`, which may be a different microphone than before. */
  start(track: MediaStreamTrack, segment: number) {
    if (this.rec && this.segment === segment) {
      this.listen(track);
      if (this.rec.state === 'paused') this.rec.resume();
      return;
    }
    this.stop();
    const mimeType = recordingMime();
    const rec = new MediaRecorder(this.listen(track).stream, { mimeType, audioBitsPerSecond: 32_000 });
    // Each recorder numbers its own pieces, so a late last piece keeps the segment it was recorded in.
    let seq = 0;
    let last = performance.now();
    rec.addEventListener('dataavailable', (e) => {
      if (!e.data.size) return;
      const now = performance.now();
      const p: AudioPiece = { data: e.data, segment, seq: seq++, durationMs: Math.max(0, now - last), mimeType };
      last = now;
      this.queue = this.queue.then(() => this.send(p));
    });
    rec.addEventListener('resume', () => { last = performance.now(); });
    rec.addEventListener('error', (e) => mlog.error('notes recorder failed', { err: e.error }));
    rec.start(PIECE_MS);
    this.rec = rec;
    this.segment = segment;
    mlog.info('notes recorder started', { mimeType, segment });
  }
  /** Pauses, and resolves once everything recorded so far is uploaded: the server refuses audio once paused. */
  async pause(): Promise<void> {
    const rec = this.rec;
    if (rec?.state === 'recording') {
      // The last piece (from requestData) is handed over before the pause event; never wait on a broken recorder.
      await new Promise<void>((resolve) => {
        rec.addEventListener('pause', () => resolve(), { once: true });
        setTimeout(resolve, 2000);
        rec.requestData();
        rec.pause();
      });
    }
    await this.queue;
  }
  stop() { void this.finish(); }
  /** Stops and waits until every recorded piece has been uploaded. */
  async flush(): Promise<void> { await this.finish(); await this.queue; }
  /** Points the recording at `track`; the recorder keeps the same input throughout. */
  private listen(track: MediaStreamTrack): MediaStreamAudioDestinationNode {
    if (!this.graph) {
      const ctx = new AudioContext();
      wakeAudio(ctx);
      this.graph = { ctx, dest: ctx.createMediaStreamDestination(), source: null, track: null };
    }
    const g = this.graph;
    if (g.track !== track) {
      g.source?.disconnect();
      g.source = g.ctx.createMediaStreamSource(new MediaStream([track]));
      g.source.connect(g.dest);
      if (g.track) mlog.info('notes recorder switched microphones', { segment: this.segment });
      g.track = track;
    }
    return g.dest;
  }
  /** Resolves once the recorder has handed over its last piece; its audio graph closes after it. */
  private finish(): Promise<void> {
    const rec = this.rec;
    const g = this.graph;
    this.rec = null;
    this.graph = null;
    const close = () => { g?.source?.disconnect(); void g?.ctx.close().catch(() => undefined); };
    if (!rec || rec.state === 'inactive') { close(); return Promise.resolve(); }
    return new Promise((resolve) => { rec.addEventListener('stop', () => { close(); resolve(); }, { once: true }); rec.stop(); });
  }
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
