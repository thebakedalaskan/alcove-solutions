/*
 * The live transcript's ears. While notes are on, the microphone also runs through a small audio
 * worklet (public/pcm-capture.js) that hands over 16 kHz mono samples. They're cut into clips at
 * natural pauses, clips without a voice in them are dropped, and the rest go to the server one at a
 * time as WAV files to be transcribed. This runs beside NotesRecorder and never touches the
 * encrypted recording: a clip that can't be transcribed costs a line of transcript, nothing more.
 */
import { MAX_TRANSCRIPT_CLIP_MS, errorCode, errorMessage, type TranscriptClip } from '@alcove/api';
import { log } from '~/lib/log';

const slog = log.child({ component: 'speech' });

const RATE = 16_000;
/** Speech is judged 20 ms at a time. */
const FRAME = RATE / 50;
const frames = (ms: number) => Math.round(ms / 20);

/* Where clips end: at the first pause after 2.5 s, and never later than 10 s. */
const MIN_CLIP = frames(2500);
const PAUSE = frames(350);
const MAX_CLIP = frames(Math.min(10_000, MAX_TRANSCRIPT_CLIP_MS));
/** A clip that reaches the limit ends at the quietest moment of its last second and a half. */
const LOOKBACK = frames(1500);
/** Kept from before the first word, so its start isn't cut off. */
const LEAD_IN = frames(300);

/*
 * What counts as a voice: frames well above the quietest of the last few seconds (the room's own
 * noise) and loud in absolute terms. A clip is sent only with 300 ms of voice in all, 160 ms of it
 * unbroken (clicks and typing aren't), and one clearly loud moment, so near-silence and a muted
 * microphone are never sent.
 */
const NOISE_WINDOW = frames(3000);
const ABOVE_NOISE = 3.5;
const VOICE_RMS = 0.005;
const PEAK_RMS = 0.012;
const MIN_VOICE = frames(300);
const MIN_RUN = frames(160);

/* Sending: three tries a clip; after two lost clips in a row, nothing is sent for 20 seconds. */
const TRIES = 3;
const REST_MS = 20_000;
/** Turning notes off, pausing or leaving never waits longer than this for the last clips. */
const FLUSH_LIMIT_MS = 8000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Frame { pcm: Float32Array; rms: number; voice: boolean }
interface Graph { ctx: AudioContext; node: Promise<AudioWorkletNode>; source: MediaStreamAudioSourceNode | null }

/**
 * Cuts the microphone into clips of speech and sends them, in order, while notes are on. The screen
 * hears about trouble through `onProblem` (a sentence to show, or null once clips get through
 * again); the call and the recording carry on regardless.
 */
export class SpeechClips {
  private graph: Graph | null = null;
  private track: MediaStreamTrack | null = null;
  /** Bumped by stop(): a start still loading the worklet gives up, and clips not sent yet are dropped. */
  private gen = 0;
  private segment = -1;
  private paused = false;
  private startedAt = 0;
  /** Where in the segment the frame being filled starts, in samples; -1 until the first sample arrives. */
  private at = -1;
  private partial = new Float32Array(FRAME);
  private filled = 0;
  private clip: Frame[] = [];
  private clipStart = 0;
  private voiced = 0;
  private levels = new Float32Array(NOISE_WINDOW).fill(Number.POSITIVE_INFINITY);
  private level = 0;
  private queue: Promise<void> = Promise.resolve();
  private lostInARow = 0;
  private restUntil = 0;
  private shown: string | null = null;

  constructor(private readonly upload: (clip: TranscriptClip) => Promise<void>, private readonly onProblem: (message: string | null) => void) {}

  /** Starts (or carries on) listening into `segment`. A new segment counts from 0 again. */
  start(track: MediaStreamTrack, segment: number): void {
    if (segment !== this.segment) {
      this.clear();
      this.segment = segment;
      // The recorder starts now; the first samples arrive a little later and are placed by the clock.
      this.startedAt = performance.now();
    }
    this.paused = false;
    if (track !== this.track || !this.graph) this.hear(track);
  }

  /** Ends the clip in progress (it's still sent) and stops listening until resume() or start(). */
  pause(): void {
    if (this.paused || this.segment < 0) return;
    this.cut();
    // The part of a frame heard before pausing was recorded too, so the next clip starts after it.
    if (this.at >= 0) this.at += this.filled;
    this.filled = 0;
    this.paused = true;
  }

  resume(): void { this.paused = false; }

  /** Sends what's been heard so far and waits for it to be transcribed. */
  async flush(): Promise<void> {
    this.cut();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), FLUSH_LIMIT_MS); });
    const done = await Promise.race([this.queue.then(() => 'done' as const), late]);
    clearTimeout(timer);
    if (done === 'late') slog.warn('the last transcript clips are slow; going on without them', { waitedMs: FLUSH_LIMIT_MS });
  }

  /** Stops listening. What hasn't been sent yet is dropped: flush() first to keep it. */
  stop(): void {
    this.gen++;
    this.clear();
    this.segment = -1;
    this.paused = false;
    this.track = null;
    const g = this.graph;
    this.graph = null;
    if (!g) return;
    g.source?.disconnect();
    void g.node.then((n) => { n.port.onmessage = null; n.disconnect(); }, () => undefined);
    void g.ctx.close().catch((e: unknown) => slog.debug('audio context did not close', { err: e }));
  }

  private clear() {
    this.clip = [];
    this.voiced = 0;
    this.filled = 0;
    this.at = -1;
  }

  private hear(track: MediaStreamTrack) {
    this.track = track;
    const g = this.graph ?? this.build();
    if (!g) return;
    const gen = this.gen;
    void g.node.then((node) => {
      if (gen !== this.gen || this.graph !== g || this.track !== track) return;
      g.source?.disconnect();
      g.source = g.ctx.createMediaStreamSource(new MediaStream([track]));
      g.source.connect(node);
      slog.info('listening for the live transcript', { segment: this.segment, sampleRate: g.ctx.sampleRate });
    }, (e: unknown) => {
      if (gen !== this.gen) return;
      slog.warn('could not listen for the live transcript', { err: e });
      this.say('The live transcript can’t start in this browser. The recording is still saved.');
    });
  }

  private build(): Graph | null {
    if (typeof AudioWorkletNode === 'undefined') {
      slog.warn('this browser has no audio worklets; no live transcript');
      this.say('The live transcript can’t start in this browser. The recording is still saved.');
      return null;
    }
    const ctx = new AudioContext();
    wake(ctx);
    const node = ctx.audioWorklet.addModule('/pcm-capture.js').then(() => {
      const n = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      n.port.onmessage = (e: MessageEvent<unknown>) => { if (this.graph?.ctx === ctx && e.data instanceof Float32Array) this.take(e.data); };
      // Some browsers only run nodes that lead to the speakers. Nothing is heard: the gain is zero.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      n.connect(mute).connect(ctx.destination);
      return n;
    });
    this.graph = { ctx, node, source: null };
    return this.graph;
  }

  private take(chunk: Float32Array) {
    if (this.paused || this.segment < 0) return;
    if (this.at < 0) this.at = Math.max(0, Math.round(((performance.now() - this.startedAt) * RATE) / 1000) - chunk.length);
    for (const v of chunk) {
      this.partial[this.filled++] = v;
      if (this.filled < FRAME) continue;
      this.frame(this.partial, this.at);
      this.at += FRAME;
      this.partial = new Float32Array(FRAME);
      this.filled = 0;
    }
  }

  private frame(pcm: Float32Array, at: number) {
    let sum = 0;
    for (const v of pcm) sum += v * v;
    const rms = Math.sqrt(sum / pcm.length);
    this.levels[this.level] = rms;
    this.level = (this.level + 1) % NOISE_WINDOW;
    // The room's noise: the quietest frame of the last few seconds that isn't digital silence.
    let noise = rms;
    for (const l of this.levels) if (l > 1e-5 && l < noise) noise = l;
    const voice = rms >= VOICE_RMS && rms > noise * ABOVE_NOISE;

    if (!this.clip.length) this.clipStart = at;
    this.clip.push({ pcm, rms, voice });
    if (voice) this.voiced++;
    if (!this.voiced) {
      // Nobody's speaking: keep only a moment, as the lead-in to whatever's said next.
      if (this.clip.length > LEAD_IN) { this.clip.shift(); this.clipStart += FRAME; }
      return;
    }
    if (this.clip.length >= MAX_CLIP) this.cut(this.quietest());
    else if (this.clip.length >= MIN_CLIP && this.clip.length - 1 - this.clip.findLastIndex((f) => f.voice) >= PAUSE) this.cut();
  }

  /** How many frames a clip that reached the limit sends: up to its quietest moment near the end. */
  private quietest(): number {
    let best = this.clip.length - 1;
    for (let i = Math.max(MIN_CLIP, this.clip.length - LOOKBACK); i < this.clip.length; i++) {
      const f = this.clip[i];
      const b = this.clip[best];
      if (f && b && f.rms < b.rms) best = i;
    }
    return best + 1;
  }

  /** Ends the clip after its first `n` frames, keeping the rest as the start of the next, and sends it if someone spoke. */
  private cut(n = this.clip.length) {
    const sent = this.clip.slice(0, n);
    const start = this.clipStart;
    this.clip = this.clip.slice(n);
    this.clipStart += n * FRAME;
    this.voiced = this.clip.filter((f) => f.voice).length;
    if (!sent.length) return;
    if (!worthSending(sent)) { slog.debug('clip without speech skipped', { frames: sent.length }); return; }
    const pcm = new Float32Array(sent.length * FRAME);
    sent.forEach((f, i) => pcm.set(f.pcm, i * FRAME));
    this.enqueue({ data: wav(pcm), segment: this.segment, startMs: (start * 1000) / RATE, durationMs: (pcm.length * 1000) / RATE });
  }

  private enqueue(clip: TranscriptClip) {
    const gen = this.gen;
    this.queue = this.queue.then(() => (gen === this.gen ? this.send(clip) : undefined));
  }

  private async send(clip: TranscriptClip) {
    const where = { segment: clip.segment, startMs: Math.round(clip.startMs), durationMs: Math.round(clip.durationMs), bytes: clip.data.size };
    if (Date.now() < this.restUntil) { slog.debug('transcript clip skipped while transcription rests', where); return; }
    for (let attempt = 1; ; attempt++) {
      try {
        await this.upload(clip);
        slog.debug('transcript clip transcribed', { ...where, attempt });
        this.lostInARow = 0;
        this.say(null);
        return;
      } catch (e) {
        // Expected around changes: notes went off, the recording paused, or a new segment began.
        if (errorCode(e) === 'conflict') { slog.debug('transcript clip refused: notes are off, paused or moved on', { ...where, err: e }); return; }
        if (attempt < TRIES) {
          slog.debug('transcript clip failed; trying again', { ...where, attempt, err: e });
          await sleep(600 * attempt);
          continue;
        }
        this.lostInARow++;
        const rest = this.lostInARow >= 2;
        if (rest) this.restUntil = Date.now() + REST_MS;
        slog.warn('transcript clip lost', { ...where, attempts: attempt, lostInARow: this.lostInARow, restMs: rest ? REST_MS : 0, err: e });
        this.say(errorMessage(e));
        return;
      }
    }
  }

  private say(message: string | null) {
    if (message === this.shown) return;
    this.shown = message;
    this.onProblem(message);
  }
}

/** Worth transcribing: 300 ms of voice in all, 160 ms of it unbroken, and one clearly loud moment. */
function worthSending(fs: readonly Frame[]): boolean {
  let total = 0;
  let run = 0;
  let longest = 0;
  let peak = 0;
  for (const f of fs) {
    run = f.voice ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (!f.voice) continue;
    total++;
    peak = Math.max(peak, f.rms);
  }
  return total >= MIN_VOICE && longest >= MIN_RUN && peak >= PEAK_RMS;
}

/** 16-bit PCM WAV, mono, 16 kHz: the 44-byte header, then the samples. */
function wav(pcm: Float32Array): Blob {
  const bytes = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(bytes);
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true); // bytes a second
  v.setUint16(32, 2, true); // bytes a sample
  v.setUint16(34, 16, true); // bits a sample
  ascii(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => { const c = Math.max(-1, Math.min(1, s)); v.setInt16(44 + i * 2, Math.round(c < 0 ? c * 0x8000 : c * 0x7fff), true); });
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Audio starts suspended on a page nobody has clicked yet; the first click or key press wakes it. */
function wake(ctx: AudioContext) {
  const go = () => { if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined); };
  go();
  addEventListener('pointerdown', go, { once: true, capture: true });
  addEventListener('keydown', go, { once: true, capture: true });
}
