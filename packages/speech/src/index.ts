/*
 * Cutting a voice into clips for the live transcript, wherever it's heard: in a browser (apps/web, a room recording's
 * microphone) or in the listener (apps/listener, each voice in a call). Samples go in, 16 kHz mono, as they're heard;
 * clips come out at natural pauses, and clips without a voice in them are left out. Nothing here knows where the
 * samples came from or where the clips go.
 */
import { MAX_TRANSCRIPT_CLIP_MS } from '@alcove/api';

/** The rate every clip is cut and sent at. */
export const SPEECH_RATE = 16_000;
/** Speech is judged 20 ms at a time. */
const FRAME = SPEECH_RATE / 50;
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

interface Frame { pcm: Float32Array; rms: number; voice: boolean }

/** A clip of someone's speech: its samples, and where it starts (in samples, counted as `push` was told). */
export interface Cut { pcm: Float32Array; start: number }

/** One voice, cut into clips. */
export class ClipCutter {
  /** Where the frame being filled starts, in samples; -1 until the first sample arrives. */
  private at = -1;
  private partial = new Float32Array(FRAME);
  private filled = 0;
  private clip: Frame[] = [];
  private clipStart = 0;
  private voiced = 0;
  private levels = new Float32Array(NOISE_WINDOW).fill(Number.POSITIVE_INFINITY);
  private level = 0;

  /** `onClip` gets each clip worth transcribing; `onSkipped`, how many frames went without one. */
  constructor(private readonly onClip: (clip: Cut) => void, private readonly onSkipped: (frames: number) => void = () => undefined) {}

  /** Where the next sample falls, in samples, or -1 before the first one (and after `reset`). */
  get position(): number {
    return this.at < 0 ? -1 : this.at + this.filled;
  }

  /** Takes samples as they're heard. `at` says where the first falls, when nothing's been heard since a reset. */
  push(chunk: Float32Array, at: number): void {
    if (this.at < 0) this.at = Math.max(0, at);
    for (const v of chunk) {
      this.partial[this.filled++] = v;
      if (this.filled < FRAME) continue;
      this.frame(this.partial, this.at);
      this.at += FRAME;
      this.partial = new Float32Array(FRAME);
      this.filled = 0;
    }
  }

  /** Ends the clip in progress, giving it to `onClip` if someone spoke in it. */
  cut(): void {
    this.cutAt(this.clip.length);
  }

  /**
   * Ends the clip in progress for a pause: what's heard next carries on from where this stopped, after the part of a
   * frame heard before it (that was recorded too).
   */
  pause(): void {
    this.cutAt(this.clip.length);
    if (this.at >= 0) this.at += this.filled;
    this.filled = 0;
    this.partial = new Float32Array(FRAME);
  }

  /** Drops what's being heard and forgets where it was: the next `push` says where it starts. */
  reset(): void {
    this.clip = [];
    this.voiced = 0;
    this.filled = 0;
    this.at = -1;
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
    if (this.clip.length >= MAX_CLIP) this.cutAt(this.quietest());
    else if (this.clip.length >= MIN_CLIP && this.clip.length - 1 - this.clip.findLastIndex((f) => f.voice) >= PAUSE) this.cutAt(this.clip.length);
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

  /** Ends the clip after its first `n` frames, keeping the rest as the start of the next, and gives it on if someone spoke. */
  private cutAt(n: number) {
    const sent = this.clip.slice(0, n);
    const start = this.clipStart;
    this.clip = this.clip.slice(n);
    this.clipStart += n * FRAME;
    this.voiced = this.clip.filter((f) => f.voice).length;
    if (!sent.length) return;
    if (!worthSending(sent)) { this.onSkipped(sent.length); return; }
    const pcm = new Float32Array(sent.length * FRAME);
    sent.forEach((f, i) => pcm.set(f.pcm, i * FRAME));
    this.onClip({ pcm, start });
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
export function wav(pcm: Float32Array): Uint8Array<ArrayBuffer> {
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
  v.setUint32(24, SPEECH_RATE, true);
  v.setUint32(28, SPEECH_RATE * 2, true); // bytes a second
  v.setUint16(32, 2, true); // bytes a sample
  v.setUint16(34, 16, true); // bits a sample
  ascii(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => { const c = Math.max(-1, Math.min(1, s)); v.setInt16(44 + i * 2, Math.round(c < 0 ? c * 0x8000 : c * 0x7fff), true); });
  return new Uint8Array(bytes);
}
