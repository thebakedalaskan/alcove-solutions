/*
 * Your own shared screen, recorded for the notes (docs: Calls and recordings › Shared screens). Call media is end-to-end
 * encrypted, so only browsers ever see a share: when the presenter said a share goes in the notes, their own browser
 * records it, a few frames a second, and sends it in pieces every five seconds, sealed by the server as they arrive.
 * A share is recorded from the moment it starts, so the notes show it from then, but nothing leaves the browser until
 * it has been up ten seconds: what's recorded before that is held here, and a share that ends sooner is dropped, so a
 * window picked by mistake is never sent.
 *
 * Each recording is one share in one segment of the call's recording: one continuous WebM stream, numbered from piece
 * 0, placed on the same timeline as the call's audio (seconds from the segment's start, as the call's server began it).
 * Pausing notes stops it and drops what wasn't sent; resuming starts a new segment, so a new recording. A share ending
 * sends what was recorded before the call is told it ended. Nothing about what's on the screen is logged: only counts,
 * sizes and timings.
 */
import { errorCode, type ScreenPiece } from '@alcove/api';
import { log } from '~/lib/log';

const slog = log.child({ component: 'screen-record' });

/** How long a share is up before anything of it is sent. It is recorded from its start and held in the browser until then; a shorter share is dropped. */
const FIRST_AFTER_MS = 10_000;
/** A piece every this often. */
const PIECE_MS = 5000;
/** Enough for text on a screen to stay readable at a few frames a second. */
const BITS_PER_SECOND = 400_000;
const FRAME_RATE = 5;
/** While the connection is down (or the server busy), a piece keeps trying this long, as the audio's do. */
const RETRY_MS = 2 * 60_000;
/** How long a share's end waits for its last pieces to go up before the call is told it ended. */
const FLUSH_MS = 10_000;

/** VP9 where the browser records it (smaller for the same text), else VP8, else whatever it records. */
function videoMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/** What to record now: your share (its stream and the server's ID for it), when it started, and the segment it goes in. */
export interface ScreenTake {
  stream: MediaStream;
  share: string;
  /** When this share started, from performance.now(): nothing of it is sent until it has been up FIRST_AFTER_MS. */
  since: number;
  segment: number;
  /** When the call's server began the segment, on this browser's clock (performance.now()): pieces are placed from there, as the audio is. */
  origin: number;
}

/** Where a run's pieces are until its share has been up FIRST_AFTER_MS: held in the browser, then sent, or dropped. */
interface Grace { held: ScreenPiece[]; released: boolean; dropped: boolean; timer: ReturnType<typeof setTimeout> | null }

interface Running { share: string; track: MediaStreamTrack; segment: number; rec: MediaRecorder; clone: MediaStreamTrack; gen: number; grace: Grace }

export class ScreenRecorder {
  private run: Running | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** Recorders being stopped, until each has handed over its last piece. */
  private stopping: Promise<void> = Promise.resolve();
  /** Bumped by discard(): pieces recorded before it, and any still waiting to go, are never sent. */
  private gen = 0;
  /** Shares the call refused (not kept, or over): nothing more of them is recorded. */
  private refused = new Set<string>();
  /** Runs (`share:segment`) whose first piece, the one with the WebM header, was lost for good: the server can't join the rest, so they aren't sent. */
  private headless = new Set<string>();

  constructor(private readonly upload: (p: ScreenPiece) => Promise<void>, private readonly onProblem: (message: string | null) => void) {}

  /**
   * Records `t` from now on (or carries on recording it). Another share, another picture or another segment ends the
   * recording before and starts a new one, sending the old one's last piece first.
   */
  record(t: ScreenTake): void {
    const track = t.stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended' || this.refused.has(t.share)) { void this.finish(); return; }
    const r = this.run;
    if (r && r.share === t.share && r.track === track && r.segment === t.segment && r.rec.state !== 'inactive') return;
    if (r) void this.finish();
    this.begin(t, track);
  }

  /** Stops recording and sends what was recorded: a share ended, a breakout room, a new segment. Resolves once it's up, or FLUSH_MS later. */
  finish(): Promise<void> {
    const r = this.run;
    this.run = null;
    // A share that ends within its first seconds is dropped: what was held, and the last piece the stop hands over.
    if (r) this.drop(r.grace, r.segment);
    // The last piece is handed over before the recorder says it stopped: waiting for every stop so far, then the uploads, covers it.
    if (r) this.stopping = Promise.all([this.stopping, this.stopRec(r)]).then(() => undefined);
    const sent = this.stopping.then(() => this.queue);
    return new Promise<void>((resolve) => {
      const late = setTimeout(() => { slog.warn('shared screen still uploading as it stopped'); resolve(); }, FLUSH_MS);
      void sent.then(() => { clearTimeout(late); resolve(); });
    });
  }

  /** Notes paused or off, or this tab is leaving: stops at once, and nothing recorded but not yet sent goes. The server refuses it anyway. */
  discard(): void {
    this.gen++;
    void this.finish();
  }

  /** Before the grace is over: stops the timer and lets go of what was held, and of anything the recorder still hands over. */
  private drop(g: Grace, segment: number): void {
    if (g.released || g.dropped) return;
    g.dropped = true;
    if (g.timer) clearTimeout(g.timer);
    g.timer = null;
    slog.debug('shared screen ended within its first seconds; held pieces dropped', { segment, pieces: g.held.length });
    g.held = [];
  }

  private begin(t: ScreenTake, track: MediaStreamTrack): void {
    if (track.readyState === 'ended') return;
    const mimeType = videoMime();
    // A copy of the share's picture, slowed to a few frames a second for the recording only: what everyone sees is untouched.
    const clone = track.clone();
    clone.applyConstraints({ frameRate: FRAME_RATE }).catch(() => undefined);
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(new MediaStream([clone]), { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: BITS_PER_SECOND });
    } catch (e) {
      clone.stop();
      slog.error('shared screen recorder couldn’t start', { err: e, mimeType });
      this.onProblem('Your browser couldn’t record your shared screen for the notes.');
      return;
    }
    const gen = this.gen;
    const share = t.share;
    const segment = t.segment;
    // Placed on the call's timeline where its picture begins, now: from when this browser saw the segment begin, pauses
    // not counted (a pause ends the segment). Recording starts as the share does, so that's its start too.
    const startMs = Math.max(0, performance.now() - t.origin);
    const grace: Grace = { held: [], released: false, dropped: false, timer: null };
    const enqueue = (p: ScreenPiece) => {
      this.queue = this.queue.then(() => (gen === this.gen && !this.refused.has(share) && !this.headless.has(`${share}:${segment}`) ? this.send(p, gen) : undefined));
    };
    let seq = 0;
    let recorded = 0;
    let last = performance.now();
    const type = rec.mimeType || mimeType || 'video/webm';
    rec.addEventListener('dataavailable', (e) => {
      if (!e.data.size || gen !== this.gen || grace.dropped) return;
      const now = performance.now();
      const durationMs = Math.max(0, now - last);
      const p: ScreenPiece = { data: e.data, share, segment, seq: seq++, at: (startMs + recorded) / 1000, durationMs, mimeType: type };
      recorded += durationMs;
      last = now;
      if (grace.released) enqueue(p);
      else grace.held.push(p);
    });
    rec.addEventListener('error', (e) => { slog.error('shared screen recorder failed', { err: e.error, segment }); });
    try {
      rec.start(PIECE_MS);
    } catch (e) {
      clone.stop();
      slog.error('shared screen recorder couldn’t start', { err: e, mimeType });
      return;
    }
    this.run = { share, track, segment, rec, clone, gen, grace };
    const left = t.since + FIRST_AFTER_MS - performance.now();
    const release = () => {
      grace.timer = null;
      if (grace.dropped) return;
      grace.released = true;
      const held = grace.held;
      grace.held = [];
      if (held.length) slog.debug('shared screen up long enough; held pieces released', { segment, pieces: held.length });
      for (const p of held) enqueue(p);
    };
    if (left > 0) grace.timer = setTimeout(release, left);
    else grace.released = true;
    slog.info('recording your shared screen for the notes', { mimeType: type, segment, atMs: Math.round(startMs) });
  }

  /** Resolves once the recorder has handed over its last piece; the copy of the picture stops with it. */
  private stopRec(r: Running): Promise<void> {
    if (r.rec.state === 'inactive') { r.clone.stop(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const done = () => { r.clone.stop(); resolve(); };
      r.rec.addEventListener('stop', done, { once: true });
      // Never wait on a broken recorder.
      setTimeout(done, 2000);
      r.rec.stop();
    });
  }

  /** The first piece of a run is lost for good: nothing later in it can be joined, so the rest of it isn't sent. */
  private loseRun(p: ScreenPiece): void {
    this.headless.add(`${p.share}:${p.segment}`);
    slog.warn('first piece of a shared screen lost; the rest of its recording is dropped', { segment: p.segment });
    if (this.run?.share === p.share && this.run.segment === p.segment) void this.finish();
  }

  /**
   * Uploads one piece, in order. While the connection is down (or the server busy) it keeps trying for up to RETRY_MS,
   * so a short drop loses nothing. A refusal that trying again won't change gives up at once: notes paused or off, or
   * a new segment, drop the piece; a share the call doesn't keep (or that's over) stops being recorded.
   */
  private async send(p: ScreenPiece, gen: number): Promise<void> {
    const where = { segment: p.segment, seq: p.seq, bytes: p.data.size };
    const since = performance.now();
    for (let attempt = 0; gen === this.gen; attempt++) {
      try {
        await this.upload(p);
        this.onProblem(null);
        slog.debug('shared screen piece uploaded', { ...where, attempt });
        return;
      } catch (e) {
        const code = errorCode(e);
        if (code === 'conflict') { slog.debug('shared screen piece refused: notes are paused, off or moved on', { ...where, code }); return; }
        if (code === 'forbidden' || code === 'not-found') {
          this.refused.add(p.share);
          if (this.run?.share === p.share) void this.finish();
          slog.info('shared screen not kept by the call; recording stopped', { ...where, code });
          return;
        }
        const waiting = (code === 'network' || code === 'unavailable' || code === 'unknown') && performance.now() - since < RETRY_MS;
        slog.at(waiting ? 'warn' : 'error', waiting ? 'shared screen piece upload failed; retrying' : 'shared screen piece lost', { err: e, code, ...where, attempt });
        if (!waiting) {
          this.onProblem('Your shared screen couldn’t reach the notes. Check your connection.');
          if (p.seq === 0) this.loseRun(p);
          return;
        }
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * 2 ** attempt)));
      }
    }
  }
}
