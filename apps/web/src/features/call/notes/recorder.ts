import { errorCode, errorMessage, type AudioPiece } from '@alcove/api';
import { log } from '~/lib/log';
import { wakeAudio } from './audio';

const mlog = log.child({ component: 'media' });

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export const recordingMime = (): string => MIME.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'audio/webm';
export const PIECE_MS = 5000;
/** How long a piece of the recording keeps trying to get through while the connection is down. */
const RETRY_MS = 2 * 60_000;
/** How long stopping waits for the last pieces before it lets whoever stopped carry on. */
const FLUSH_MS = 10_000;

/** One voice in the recording's mix: its track's source, and the gain it fades in and out on. */
interface Voice { track: MediaStreamTrack; source: MediaStreamAudioSourceNode; gain: GainNode }
function fadeIn(ctx: AudioContext, into: AudioNode, track: MediaStreamTrack): Voice {
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_S);
  source.connect(gain).connect(into);
  return { track, source, gain };
}
function fadeOut(ctx: AudioContext, v: Voice) {
  v.gain.gain.cancelScheduledValues(ctx.currentTime);
  v.gain.gain.setValueAtTime(v.gain.gain.value, ctx.currentTime);
  v.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_S);
  setTimeout(() => { v.source.disconnect(); v.gain.disconnect(); }, FADE_S * 1000 + 50);
}

/** A recorder for `stream`, started, or null when this browser can't record it. */
function recorderFor(stream: MediaStream, mimeType: string, segment: number): MediaRecorder | null {
  try {
    const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
    rec.start(PIECE_MS);
    return rec;
  } catch (e) {
    mlog.error('notes recorder could not start', { err: e, mimeType, segment });
    return null;
  }
}

/** A voice the recording mixes in: whose it is (in a call, a participant ID), and its track as it arrived. */
export interface RecordedVoice { identity: string; track: MediaStreamTrack }

/** How long a voice takes to fade in or out of the mix, so one joining or leaving mid-sentence doesn't click. */
const FADE_S = 0.03;

/**
 * Records in 5-second pieces and uploads them in order. Each piece says where it starts in its segment, pauses not
 * counted, so its time is its own however late it arrives. A piece that can't get through is tried again for up to
 * two minutes, so a short drop in the connection loses nothing; the server treats a repeated (segment, seq) as a
 * no-op, so retries never duplicate audio. The server refuses audio once notes are off, so stopping waits for the last
 * piece before anyone switches notes off.
 *
 * What it records is a mix of voices (a room recording: the microphone; a call: everyone the host's browser
 * hears), through one small audio graph: each voice's own track, as it arrived, faded in when it's heard and out when
 * it isn't, into a limiter so voices over each other don't clip. A voice on a new track (another microphone) carries
 * on in the same recording, and voices come and go mid-segment without the recording stopping: MediaRecorder can't
 * change its input, the graph can. Nobody's volume on this screen, or the speaker chosen, reaches it.
 *
 * Given somewhere to keep pieces (`keep`: the stage recorder's, on this device), a piece that can't be sent (no
 * connection, a failed try, or refused because Alcove's copy of the recording is out of step) is kept there at once
 * instead of lost, to upload later exactly as it is; nothing waits in memory through more tries. After one is kept
 * because sending failed, the next go straight there for a while.
 */
export class NotesRecorder {
  private rec: MediaRecorder | null = null;
  private segment = -1;
  private queue: Promise<void> = Promise.resolve();
  /** Bumped by discard(): pieces recorded before it, and any still waiting to go, are never sent. */
  private gen = 0;
  /** Set by hold(): nothing more is recorded or sent until release() carries on or discard() drops it. */
  private gate: { wait: Promise<void>; open: () => void } | null = null;
  private graph: { ctx: AudioContext; mix: DynamicsCompressorNode; gain: GainNode; dest: MediaStreamAudioDestinationNode; voices: Map<string, Voice> } | null = null;
  /** While whoever hosts is in a breakout room, the recording hears nothing: it has the main room's talk, and a room's reaches the notes only through its own transcript. */
  private hushed = false;
  /** Until then, pieces go straight to `keep`: sending just failed. */
  private keepUntil = 0;
  /** `onBroken` hears whether this browser can record at all: false once a recorder runs, true if one can't start or fails. */
  constructor(private readonly upload: (p: AudioPiece) => Promise<void>, private readonly onError: (message: string) => void,
    private readonly onBroken: (broken: boolean) => void = () => undefined, private readonly keep: ((p: AudioPiece) => Promise<void>) | null = null) {}

  /** Silence instead of everyone heard while `on`, without stopping: the recording keeps its place in time, so the transcript still lines up with it. */
  hush(on: boolean) {
    if (on === this.hushed) return;
    this.hushed = on;
    if (this.graph) this.graph.gain.gain.value = on ? 0 : 1;
    mlog.info(on ? 'notes recorder hushed' : 'notes recorder hearing again', { segment: this.segment });
  }

  get running() { return this.rec?.state === 'recording'; }
  /**
   * Starts (or continues) recording into `segment`, mixing exactly `voices`: new ones fade in, ones no longer there
   * fade out, and one on a new track carries on with it. None records silence, and the segment goes on.
   */
  start(voices: readonly RecordedVoice[], segment: number) {
    if (this.rec && this.segment === segment) {
      this.listen(voices);
      // Held while a pause is on its way: it carries on only when release() says so.
      if (this.rec.state === 'paused' && !this.gate) this.rec.resume();
      return;
    }
    this.stop();
    const mimeType = recordingMime();
    const rec = recorderFor(this.listen(voices).stream, mimeType, segment);
    if (!rec) { this.onBroken(true); return; }
    // Each recorder numbers its own pieces, so a late last piece keeps the segment it was recorded in.
    let seq = 0;
    /** Milliseconds recorded into the segment so far: where the next piece starts. */
    let recorded = 0;
    let last = performance.now();
    const gen = this.gen;
    rec.addEventListener('dataavailable', (e) => {
      if (!e.data.size || gen !== this.gen) return;
      const now = performance.now();
      const durationMs = Math.max(0, now - last);
      const p: AudioPiece = { data: e.data, segment, seq: seq++, at: recorded / 1000, durationMs, mimeType };
      recorded += durationMs;
      last = now;
      this.queue = this.queue.then(async () => {
        while (this.gate) await this.gate.wait;
        if (gen === this.gen) await this.send(p, gen);
      });
    });
    rec.addEventListener('resume', () => { last = performance.now(); });
    rec.addEventListener('error', (e) => { mlog.error('notes recorder failed', { err: e.error, segment }); this.onBroken(true); });
    if (this.gate) rec.pause();
    this.rec = rec;
    this.segment = segment;
    this.onBroken(false);
    mlog.info('notes recorder started', { mimeType, segment, held: Boolean(this.gate) });
  }
  /**
   * Notes are being paused: records nothing more and sends nothing, keeping what it has, until the server answers.
   * release() carries on with the same recorder, so its pieces stay in order (the pause failed); discard() drops it all.
   */
  hold() {
    if (this.gate) return;
    let open: () => void = () => undefined;
    const wait = new Promise<void>((r) => { open = r; });
    this.gate = { wait, open };
    const rec = this.rec;
    // The last moments before the pause are handed over now, and wait with the rest.
    if (rec?.state === 'recording') { rec.requestData(); rec.pause(); }
  }
  /** Carries on where it was after hold() or pause(): what it held is sent, and recording goes on in the same segment. */
  release() {
    this.unhold();
    if (this.rec?.state === 'paused') this.rec.resume();
  }
  /**
   * Pauses, and resolves once everything recorded so far is uploaded: before notes are turned off or the call ends, since
   * the server refuses audio after. release() carries on in the same recording if that fails; discard() ends it.
   */
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
  /**
   * Stops and waits until every recorded piece has been uploaded, or FLUSH_MS have gone by while the connection is
   * down: whoever's waiting (ending the call, moving) isn't held up for long, and the pieces keep trying meanwhile.
   * Given `keep` it always waits for the last one: each is soon sent or kept, and the recording stops only after that.
   */
  async flush(): Promise<void> {
    await this.finish();
    if (this.keep) { await this.queue; return; }
    const late = await Promise.race([this.queue.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), FLUSH_MS))]);
    if (late) mlog.warn('notes audio still uploading', { segment: this.segment });
  }
  /**
   * Notes were paused, or the call went on without this tab (the organizer's other tab or device took over): stops at
   * once, and nothing recorded but not yet sent goes, held or not. The server refuses it anyway.
   */
  discard() {
    this.gen++;
    this.unhold();
    void this.finish();
  }
  private unhold() {
    const g = this.gate;
    this.gate = null;
    g?.open();
  }
  /** Mixes exactly `voices` into the recording; the recorder keeps the same input throughout. */
  private listen(voices: readonly RecordedVoice[]): MediaStreamAudioDestinationNode {
    if (!this.graph) {
      const ctx = new AudioContext();
      wakeAudio(ctx);
      // A limiter, not a compressor: it does nothing to one voice at a normal level, and keeps several at once from clipping.
      const mix = ctx.createDynamicsCompressor();
      mix.threshold.value = -3;
      mix.knee.value = 3;
      mix.ratio.value = 20;
      mix.attack.value = 0.003;
      mix.release.value = 0.15;
      // After the mix, one gain silences the whole recording while hushed.
      const gain = ctx.createGain();
      gain.gain.value = this.hushed ? 0 : 1;
      const dest = ctx.createMediaStreamDestination();
      mix.connect(gain).connect(dest);
      this.graph = { ctx, mix, gain, dest, voices: new Map() };
    }
    const g = this.graph;
    const want = new Map(voices.map((v) => [v.identity, v.track]));
    let added = 0;
    let gone = 0;
    for (const [identity, v] of g.voices) {
      if (want.get(identity) === v.track) continue;
      g.voices.delete(identity);
      fadeOut(g.ctx, v);
      gone++;
    }
    for (const [identity, track] of want) {
      if (g.voices.has(identity)) continue;
      g.voices.set(identity, fadeIn(g.ctx, g.mix, track));
      added++;
    }
    if (added || gone) mlog.debug('voices recorded for the notes', { segment: this.segment, voices: g.voices.size, added, gone });
    return g.dest;
  }
  /** Resolves once the recorder has handed over its last piece; its audio graph closes after it. */
  private finish(): Promise<void> {
    const rec = this.rec;
    const g = this.graph;
    this.rec = null;
    this.graph = null;
    const close = () => { for (const v of g?.voices.values() ?? []) { v.source.disconnect(); v.gain.disconnect(); } void g?.ctx.close().catch(() => undefined); };
    if (!rec || rec.state === 'inactive') { close(); return Promise.resolve(); }
    return new Promise((resolve) => { rec.addEventListener('stop', () => { close(); resolve(); }, { once: true }); rec.stop(); });
  }
  /**
   * Uploads one piece, in order. While the connection is down (or the server is busy) it keeps trying for up to
   * RETRY_MS, so a short drop loses nothing: the recording goes on here meanwhile, and the pieces go up once it's back.
   * A refusal that trying again won't change gives up at once; discard() stops it trying. Given `keep`, it's tried once
   * and then kept instead.
   */
  private async send(p: AudioPiece, gen: number) {
    const where = { segment: p.segment, seq: p.seq, bytes: p.data.size };
    if (this.keep && (!navigator.onLine || Date.now() < this.keepUntil)) { await this.kept(p, this.keep, navigator.onLine ? 'resting' : 'offline'); return; }
    const since = performance.now();
    for (let attempt = 0; gen === this.gen; attempt++) {
      try { await this.upload(p); mlog.debug('audio piece uploaded', { ...where, attempt }); return; } catch (e) {
        const code = errorCode(e);
        if (this.keep) {
          if (code !== 'conflict' && navigator.onLine) {
            this.keepUntil = Date.now() + KEEP_REST_MS;
            mlog.warn('audio piece upload failed; keeping it on this device', { ...where, err: e });
          }
          await this.kept(p, this.keep, code);
          return;
        }
        // Expected around changes: notes were paused or turned off, or a new segment began. It isn't kept, by design.
        if (code === 'conflict') { mlog.debug('audio piece refused: notes are paused, off or moved on', { ...where, err: e }); return; }
        const waiting = (code === 'network' || code === 'unavailable' || code === 'unknown') && performance.now() - since < RETRY_MS;
        mlog.at(waiting ? 'warn' : 'error', waiting ? 'audio piece upload failed; retrying' : 'audio piece lost', { err: e, code, ...where, attempt });
        if (!waiting) { this.onError(e instanceof Error ? e.message : 'A piece of the recording couldn’t be saved.'); return; }
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * 2 ** attempt)));
      }
    }
  }
  /** Keeps a piece that can't be sent now. If even that fails (this device is full), the piece is lost, and said. */
  private async kept(p: AudioPiece, keep: (p: AudioPiece) => Promise<void>, why: string) {
    try {
      await keep(p);
      mlog.debug('audio piece kept to upload later', { segment: p.segment, seq: p.seq, bytes: p.data.size, why });
    } catch (e) {
      mlog.error('audio piece lost: it couldn’t be sent or kept', { segment: p.segment, seq: p.seq, bytes: p.data.size, why, err: e });
      this.onError(errorMessage(e));
    }
  }
}

/** After a piece is kept because sending failed, how long later pieces go straight to being kept. */
const KEEP_REST_MS = 15_000;
