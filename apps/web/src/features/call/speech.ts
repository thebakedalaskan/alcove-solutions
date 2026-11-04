/*
 * The live transcript's ears. While notes are on, a voice (a room recording's microphone, or in a call each voice
 * the organizer's browser plays: see CallEars) also runs through a small audio worklet (public/pcm-capture.js) that
 * hands over 16 kHz mono samples. They're cut into clips at natural pauses, clips without a voice in them are
 * dropped, and the rest go to the server one at a time as WAV files to be transcribed. This runs beside
 * NotesRecorder and never touches the encrypted recording: a clip that can't be transcribed costs a line of
 * transcript, nothing more. Each clip says when its speech began (`heardAt`), so the server can place a call's speech
 * where its speaker was then; moving between parts of the call ends every clip in progress, so none spans two.
 */
import { MAX_TRANSCRIPT_CLIP_MS, errorCode, errorMessage, type TranscriptClip } from '@alcove/api';
import { log } from '~/lib/log';
import { wakeAudio } from './media';

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
interface Graph { ctx: AudioContext; parts: Promise<{ node: AudioWorkletNode; mute: GainNode }>; source: MediaStreamAudioSourceNode | null }
/**
 * Listening beside other voices, as CallEars does: one audio context for every voice, and the segment's start
 * (`origin`, from performance.now()) instead of one's own, so a voice heard from part-way through still places its
 * clips right. `own` marks the organizer's own microphone, for the logs.
 */
export interface Shared { context: AudioContext; origin: number; own: boolean }

/** Whether this browser can listen for the live transcript at all: it needs audio worklets. */
export const canListen = (): boolean => typeof AudioWorkletNode !== 'undefined';

/** The capture worklet, loaded once in each audio context however many voices it hears. */
const loaded = new WeakMap<AudioContext, Promise<void>>();
function loadCapture(ctx: AudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) { p = ctx.audioWorklet.addModule('/pcm-capture.js'); loaded.set(ctx, p); }
  return p;
}

/**
 * Cuts one voice into clips of speech and sends them, in order, while notes are on. The screen hears
 * about trouble through `onProblem` (a sentence to show, or null once clips get through again); the
 * call and the recording carry on regardless.
 */
export class SpeechClips {
  private graph: Graph | null = null;
  private track: MediaStreamTrack | null = null;
  /** Bumped by stop(): a start still loading the worklet gives up, and clips not sent yet are dropped. */
  private gen = 0;
  /** Set by hold(): nothing more is heard or sent until release() carries on or stop() drops it. */
  private gate: { wait: Promise<void>; open: () => void } | null = null;
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
  /** Which sample was heard when (by performance.now()), to say when each clip's speech began. Set from the first chunk after starting or resuming. */
  private wall: { at: number; ms: number } | null = null;

  constructor(private readonly upload: (clip: TranscriptClip) => Promise<void>, private readonly onProblem: (message: string | null) => void,
    private readonly shared: Shared | null = null) {}

  /** Starts (or carries on) listening into `segment`. A new segment counts from 0 again. */
  start(track: MediaStreamTrack, segment: number): void {
    if (segment !== this.segment) {
      this.clear();
      this.segment = segment;
      // The recorder starts now; the first samples arrive a little later and are placed by the clock.
      this.startedAt = performance.now();
    }
    // Held while a pause is on its way: it listens again only when release() says so.
    this.paused = this.gate !== null;
    if (track !== this.track || !this.graph) this.hear(track);
  }

  /**
   * Notes are being paused: the clip in progress ends, and it and every clip not sent yet wait, unsent, until the
   * server answers. release() sends them and listens again (the pause failed); stop() drops them.
   */
  hold(): void {
    if (this.gate) return;
    let open: () => void = () => undefined;
    const wait = new Promise<void>((r) => { open = r; });
    this.gate = { wait, open };
    this.pause();
  }

  /** Carries on after hold(): what it held is sent, and it listens again. */
  release(): void {
    this.unhold();
    this.resume();
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

  resume(): void { this.paused = false; this.wall = null; }

  /** Ends the clip in progress here (it's still sent), and carries on listening: what's said from now on is a new clip. */
  mark(): void {
    if (this.segment < 0) return;
    this.cut();
  }

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
    this.unhold();
    this.clear();
    this.segment = -1;
    this.paused = false;
    this.track = null;
    const g = this.graph;
    this.graph = null;
    if (!g) return;
    g.source?.disconnect();
    // The worklet ends, rather than running on in a shared context until it closes.
    void g.parts.then(({ node, mute }) => { node.port.postMessage('stop'); node.port.onmessage = null; node.disconnect(); mute.disconnect(); }, () => undefined);
    // A shared context belongs to whoever shares it.
    if (!this.shared) void g.ctx.close().catch((e: unknown) => slog.debug('audio context did not close', { err: e }));
  }

  private unhold() {
    const g = this.gate;
    this.gate = null;
    g?.open();
  }

  private clear() {
    this.clip = [];
    this.voiced = 0;
    this.filled = 0;
    this.at = -1;
    this.wall = null;
  }

  private hear(track: MediaStreamTrack) {
    this.track = track;
    const g = this.graph ?? this.build();
    if (!g) return;
    const gen = this.gen;
    void g.parts.then(({ node }) => {
      if (gen !== this.gen || this.graph !== g || this.track !== track) return;
      g.source?.disconnect();
      g.source = g.ctx.createMediaStreamSource(new MediaStream([track]));
      g.source.connect(node);
      slog.info('listening for the live transcript', { segment: this.segment, sampleRate: g.ctx.sampleRate, own: this.shared?.own ?? true });
    }, (e: unknown) => {
      if (gen !== this.gen) return;
      slog.warn('could not listen for the live transcript', { err: e });
      this.say('The live transcript can’t start in this browser. The recording is still saved.');
    });
  }

  private build(): Graph | null {
    if (!canListen()) {
      slog.warn('this browser has no audio worklets; no live transcript');
      this.say('The live transcript can’t start in this browser. The recording is still saved.');
      return null;
    }
    const ctx = this.shared?.context ?? new AudioContext();
    if (!this.shared) wakeAudio(ctx);
    const parts = loadCapture(ctx).then(() => {
      const node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (e: MessageEvent<unknown>) => { if (this.graph?.ctx === ctx && e.data instanceof Float32Array) this.take(e.data); };
      // Some browsers only run nodes that lead to the speakers. Nothing is heard: the gain is zero.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      return { node, mute };
    });
    this.graph = { ctx, parts, source: null };
    return this.graph;
  }

  private take(chunk: Float32Array) {
    if (this.paused || this.segment < 0) return;
    if (this.at < 0) this.at = Math.max(0, Math.round(((performance.now() - (this.shared?.origin ?? this.startedAt)) * RATE) / 1000) - chunk.length);
    this.wall ??= { at: this.at + this.filled, ms: performance.now() - (chunk.length * 1000) / RATE };
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
    const heardAt = this.wall ? this.wall.ms + ((start - this.wall.at) * 1000) / RATE : undefined;
    this.enqueue({ data: wav(pcm), segment: this.segment, at: start / RATE, durationMs: (pcm.length * 1000) / RATE, ...(heardAt === undefined ? {} : { heardAt }) });
  }

  private enqueue(clip: TranscriptClip) {
    const gen = this.gen;
    this.queue = this.queue.then(async () => {
      while (this.gate) await this.gate.wait;
      if (gen === this.gen) await this.send(clip);
    });
  }

  private async send(clip: TranscriptClip) {
    const where = { segment: clip.segment, atMs: Math.round(clip.at * 1000), durationMs: Math.round(clip.durationMs), bytes: clip.data.size };
    if (Date.now() < this.restUntil) { slog.debug('transcript clip skipped while transcription rests', where); return; }
    for (let attempt = 1; ; attempt++) {
      try {
        await this.upload(clip);
        slog.debug('transcript clip transcribed', { ...where, attempt });
        this.lostInARow = 0;
        this.say(null);
        return;
      } catch (e) {
        // Expected around changes: notes went off, the recording paused, a new segment began, or the room it was heard in closed.
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

/**
 * The live transcript of a call, heard in the organizer's browser: its own microphone and everyone else's it plays
 * (the people in its part of the call), each on its own, so every line is said by whoever's voice it was. Every
 * voice counts from the segment's start, so lines fall where they were said. A voice no longer heard stops being
 * listened to at once and sends what it had already heard. While a pause is on its way, every voice holds still.
 */
export class CallEars {
  private ctx: AudioContext | null = null;
  private voices = new Map<string, SpeechClips>();
  /** Voices no longer heard, still sending what they'd heard: flush() waits for them, stop() ends them. */
  private leaving = new Set<SpeechClips>();
  private segment = -1;
  private origin = 0;
  private problems = new Map<string, string>();
  /** Set by hold(), until release() or stop(): voices heard meanwhile start held too. */
  private holding = false;

  /** `onDeaf` hears whether anyone can be heard at all: true when the capture worklet can't load in this browser. */
  constructor(private readonly upload: (clip: TranscriptClip, speaker: string) => Promise<void>, private readonly onProblem: (message: string | null) => void,
    private readonly onDeaf: (deaf: boolean) => void = () => undefined) {}

  /**
   * Listens to exactly `voices` (by participant ID) in `segment`. New voices start, a voice on a new track carries
   * on with it, and a voice that's gone is no longer listened to and sends what it had heard. A new segment starts
   * again from nobody.
   */
  follow(segment: number, voices: readonly { identity: string; track: MediaStreamTrack; own: boolean }[]): void {
    if (segment !== this.segment) {
      this.drop();
      this.segment = segment;
      this.origin = performance.now();
    }
    const want = new Map(voices.map((v) => [v.identity, v]));
    let added = 0;
    let gone = 0;
    for (const [identity, clips] of this.voices) {
      if (want.has(identity)) continue;
      this.voices.delete(identity);
      this.problem(identity, null);
      clips.pause();
      this.leaving.add(clips);
      void clips.flush().finally(() => { clips.stop(); this.leaving.delete(clips); });
      gone++;
    }
    for (const [identity, v] of want) {
      let clips = this.voices.get(identity);
      if (!clips) {
        const mine: SpeechClips = new SpeechClips((c) => this.upload(c, identity),
          // A voice that's gone can't raise a problem nobody would clear.
          (m) => { if (this.voices.get(identity) === mine) this.problem(identity, m); },
          { context: this.context(), origin: this.origin, own: v.own });
        clips = mine;
        if (this.holding) clips.hold();
        this.voices.set(identity, clips);
        added++;
      }
      clips.start(v.track, segment);
    }
    if (added || gone) slog.debug('voices heard for the live transcript', { voices: this.voices.size, added, gone });
  }

  /**
   * The organizer's browser moved to another part of the call: every clip in progress ends here, so what's said from
   * now on starts a clip of its own and is placed where it was said.
   */
  mark(): void {
    for (const clips of this.voices.values()) clips.mark();
  }

  /** Sends what every voice has heard so far, those just gone too, and waits for it to be transcribed. */
  async flush(): Promise<void> {
    await Promise.all([...this.voices.values(), ...this.leaving].map((c) => c.flush()));
  }

  /**
   * Notes are being paused: every voice stops listening and keeps what it heard, unsent, until the server answers.
   * release() sends it and listens on (the pause failed); stop() drops it.
   */
  hold(): void {
    this.holding = true;
    for (const clips of this.voices.values()) clips.hold();
  }

  /** Carries on after hold(): every voice sends what it held and listens again, and those just gone send theirs. */
  release(): void {
    this.holding = false;
    for (const clips of [...this.voices.values(), ...this.leaving]) clips.release();
  }

  /**
   * Stops hearing everyone for now, and drops what wasn't sent, but stays in the segment: listening again carries on
   * its timeline, so new clips never reuse an earlier clip's place. For a breakout room the organizer paused, which
   * doesn't end the segment.
   */
  quiet(): void {
    this.holding = false;
    this.drop();
  }

  /** Stops hearing everyone. What hasn't been sent is dropped: flush() first to keep it. */
  stop(): void {
    this.holding = false;
    this.drop();
    this.segment = -1;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close().catch((e: unknown) => slog.debug('audio context did not close', { err: e }));
  }

  private drop() {
    for (const clips of [...this.voices.values(), ...this.leaving]) clips.stop();
    this.voices.clear();
    this.leaving.clear();
    this.problems.clear();
    this.onProblem(null);
  }

  private context(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      wakeAudio(ctx);
      this.ctx = ctx;
      // Every voice listens through the same worklet: if it can't load, nobody can be heard, and everyone is told.
      if (canListen()) {
        // A context closed by stop() while loading isn't this browser failing to listen.
        void loadCapture(ctx).then(() => { if (this.ctx === ctx) this.onDeaf(false); }, (e: unknown) => {
          if (this.ctx !== ctx) return;
          slog.warn('the live transcript can’t listen in this browser', { err: e });
          this.onDeaf(true);
        });
      }
    }
    return this.ctx;
  }

  /** One trouble shown at a time: the first voice's that's still unsolved, or none. */
  private problem(identity: string, message: string | null) {
    if (message) this.problems.set(identity, message);
    else this.problems.delete(identity);
    this.onProblem(this.problems.values().next().value ?? null);
  }
}
