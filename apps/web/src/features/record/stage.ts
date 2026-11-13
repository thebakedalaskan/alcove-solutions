/*
 * A recording on the stage (LiveRecordPage.tsx): what the microphone hears in the room. It goes to Alcove as it's
 * recorded and, whenever it can't, is kept on this device (offline.ts) to upload later (uploads.ts). From the start
 * it holds its lock, and its name and start are kept here, so a tab that closes leaves it to be finished as it was.
 *
 * Started with a connection, it starts on Alcove at once, at Alcove's own time (so a device clock that runs fast
 * can't stop it), and that start is what's kept. Started without one, its start is this device's, and it starts on
 * Alcove from then as soon as it can, so the live transcript runs whenever it can. Before it starts there, Alcove is
 * asked who's signed in: only the account recording it. What was kept here meanwhile uploads when it's finished, and
 * Alcove's copy is kept paused or recording, and named, as it is here.
 *
 * With "Record without a connection" off (or a browser that can't keep anything), nothing is kept: it can't start
 * without a connection, and losing the connection pauses it.
 */
import { AlcoveApiError, errorCode, type LiveStore, type RoomRecording, type TranscriptLine, type Unsubscribe } from '@alcove/api';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { RoomCapture, type RoomKeep, type RoomSink } from './capture';
import { DeviceFull, canKeep, dropKept, forgetKept, keepClip, keepPiece, keepRecording, takeLock, updateKept, within, type Release } from './offline';
import { CALL_MS, uploads, type Waiting } from './uploads';

const slog = log.child({ component: 'room' });

export interface StageState {
  title: string;
  status: 'recording' | 'paused' | 'stopped';
  /** Seconds recorded, pauses not counted. */
  elapsed: number;
  /** What Alcove has transcribed so far: the latest lines. */
  transcript: TranscriptLine[];
  /** This browser has a connection. */
  online: boolean;
  /** What's recorded reaches Alcove now: it started there, there's a connection, and sending works. */
  connected: boolean;
  /** Kept on this device whenever it can't reach Alcove. */
  keeping: boolean;
  /**
   * Who Alcove says is signed in here, last it was asked: this recording's account, nobody (it uploads once they sign in
   * again), or someone else (it stays here until its own account signs in again).
   */
  account: 'here' | 'signed-out' | 'other';
  /**
   * Why it paused by itself: the connection went with keeping off, this device is full, or this device was signed out
   * (which deletes what it kept for this account, so nothing more can be kept). Resuming clears the first two.
   */
  held: 'offline' | 'full' | 'forgotten' | null;
  /** Finishing has begun: it never records again, even if finishing has to be tried again. */
  ending: boolean;
  /** Why the live transcript is behind, if it is. */
  heard: string | null;
}
/**
 * How a finished recording ended: on Alcove, with its note being written; kept here to upload, waiting for the connection
 * or its own account; or nothing kept, because this device was signed out.
 */
export type Finished = { kind: 'note'; noteId: string } | { kind: 'kept'; waiting: Waiting } | { kind: 'lost' };

/** How long a piece or a clip may take to reach Alcove before it's kept here instead (sent twice, it's stored once). */
const PIECE_MS = 15_000;
const CLIP_MS = 20_000;
/** How long finishing waits for what was kept here to upload, before it's left to finish by itself. */
const HANDOVER_MS = 10_000;
/** While it isn't on Alcove yet, how often it tries again (a connection coming back tries at once). */
const ATTACH_EVERY_S = 30;

const offline = () => new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export class StageRecording implements LiveStore<StageState> {
  private state: StageState;
  private readonly listeners = new Set<() => void>();
  private readonly lost = new Set<(message: string) => void>();
  private readonly capture: RoomCapture;
  private readonly timer: ReturnType<typeof setInterval>;
  /** Started with a connection: it starts on Alcove at Alcove's time, not this device's. */
  private live: boolean;
  private server: RoomRecording | null = null;
  private unfollow: Unsubscribe | null = null;
  private attaching = false;
  /** Alcove was asked to start it: it may be there even if the answer never came. */
  private tried = false;
  /** The last thing sent didn't get through, and was kept here. */
  private failing = false;
  /** Alcove may not have heard the latest pause, resume or name. */
  private behind = false;
  /** The name Alcove has for it. */
  private titleThere = '';
  /** What was last asked of Alcove's copy (a pause, a resume, a name), until it has it. */
  private telling: Promise<void> = Promise.resolve();
  private kept = 0;
  private ticks = 0;
  private failure: unknown = null;
  /** The last thing said about a piece that couldn't be saved: said once, not for every piece. */
  private saidLost = '';

  private constructor(readonly id: string, private readonly owner: string, private startedAt: string, title: string, private release: Release | null) {
    this.live = navigator.onLine;
    this.state = {
      title, status: 'recording', elapsed: 0, transcript: [], online: navigator.onLine, connected: false, keeping: release !== null, account: 'here',
      held: null, ending: false, heard: null
    };
    const sink: RoomSink = {
      appendAudio: (p) => this.toAlcove(PIECE_MS, (r) => r.appendAudio(p)),
      transcribe: (c) => this.toAlcove(CLIP_MS, (r) => r.transcribe(c))
    };
    const keep: RoomKeep | null = release ? { piece: (p) => this.keepHere(() => keepPiece(id, p)), clip: (c) => this.keepHere(() => keepClip(id, c)) } : null;
    const lost = (m: string) => {
      if (m === this.saidLost) return;
      this.saidLost = m;
      for (const f of this.lost) f(m);
    };
    this.capture = new RoomCapture(sink, { lost, heard: (h) => this.set({ heard: h }) }, keep);
    this.timer = setInterval(() => this.tick(), 1000);
    addEventListener('online', this.onOnline);
    addEventListener('offline', this.onOffline);
  }

  /**
   * Starts recording `title` for `owner`. Kept on this device as it goes when `keep` (the account's "Record without a
   * connection") and this browser allow; then it starts with or without a connection. Otherwise it needs one.
   */
  static async begin(o: { title: string; owner: string; keep: boolean }): Promise<StageRecording> {
    const id = newId();
    const startedAt = new Date().toISOString();
    let release: Release | null = null;
    if (o.keep && canKeep()) {
      try {
        release = await takeLock(id, 2000);
        if (release) await keepRecording({ id, owner: o.owner, startedAt, title: o.title, tried: navigator.onLine });
      } catch (e) {
        slog.warn('this device can’t keep the recording, so it needs a connection', { id, err: e });
        release?.();
        release = null;
      }
    }
    const s = new StageRecording(id, o.owner, startedAt, o.title, release);
    await s.attach();
    if (!s.server && !s.release) {
      s.end();
      throw s.failure ?? offline();
    }
    slog.info('room recording started', { id, keeping: s.release !== null, onAlcove: s.server !== null });
    return s;
  }

  getSnapshot = (): StageState => this.state;
  subscribe = (l: () => void): Unsubscribe => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<StageState>) { this.state = { ...this.state, ...p }; for (const l of this.listeners) l(); }

  /** Hears, in a sentence, that a piece of the recording couldn't be saved anywhere. */
  onLost(f: (message: string) => void): () => void { this.lost.add(f); return () => { this.lost.delete(f); }; }

  /** Records from `mic` while recording (another microphone carries on in the same recording), and holds while paused. */
  follow(mic: MediaStreamTrack): void {
    if (this.state.status !== 'stopped' && !this.state.ending) this.capture.follow(mic, this.state.status);
  }

  rename(title: string): void {
    const t = title.trim().slice(0, 160);
    if (!t || t === this.state.title) return;
    this.set({ title: t });
    this.tellAlcove({ name: true, status: false });
    if (this.release) void updateKept(this.id, { title: t }).catch((e: unknown) => slog.warn('the new name wasn’t kept on this device', { id: this.id, err: e }));
  }

  /** Pauses once everything heard so far has gone, or been kept. Alcove's copy follows when it can. */
  async pause(): Promise<void> {
    if (this.state.status !== 'recording') return;
    await this.capture.pause();
    if (this.state.status !== 'recording') return;
    this.set({ status: 'paused' });
    this.tellAlcove({ name: false, status: true });
  }

  resume(): void {
    if (this.state.status !== 'paused' || this.state.ending || this.state.held === 'forgotten') return;
    this.set({ status: 'recording', held: null });
    this.tellAlcove({ name: false, status: true });
  }

  /**
   * Finishes it. With everything on Alcove, it stops there and its note is written. Otherwise (anything kept here, or
   * no connection) it's handed to the uploads, which send what was kept and then stop it; this waits a little for
   * that, so a short gap still ends on the note. It never records again from here, even if this has to be tried again.
   */
  async finish(): Promise<Finished> {
    if (this.state.status === 'stopped') throw new Error('This recording has already ended.');
    this.set({ ending: true });
    clearInterval(this.timer);
    await this.capture.finish();
    if (this.state.held === 'forgotten') {
      this.end();
      slog.info('room recording ended; this device was signed out, so nothing was kept', { id: this.id });
      return { kind: 'lost' };
    }
    // A pause, resume or name still on its way reaches Alcove first: nothing that follows races it.
    await within(CALL_MS, this.telling).catch(() => undefined);
    const r = this.server;
    if (r && this.kept === 0 && navigator.onLine && this.state.account === 'here') {
      try {
        const done = await within(CALL_MS, r.stop());
        this.end();
        if (this.release) await forgetKept(this.id).catch((e: unknown) => slog.warn('couldn’t clear the recording off this device; it clears when it’s next uploaded', { id: this.id, err: e }));
        this.letGo();
        slog.info('room recording finished on Alcove', { id: this.id, noteId: done.pendingNoteId });
        return { kind: 'note', noteId: done.pendingNoteId };
      } catch (e) {
        if (!this.release) throw e;
        slog.warn('stopping on Alcove failed; the recording finishes from this device', { id: this.id, err: e });
      }
    }
    if (!this.release) throw offline();
    this.end();
    await updateKept(this.id, { state: 'finished', seconds: this.state.elapsed })
      .catch((e: unknown) => slog.warn('couldn’t mark the recording finished on this device; it’s finished when it uploads', { id: this.id, err: e }));
    this.letGo();
    slog.info('room recording finished on this device; it uploads from here', { id: this.id, kept: this.kept, onAlcove: r !== null });
    const up = await Promise.race([uploads.run(this.id, this.owner), sleep(HANDOVER_MS).then(() => null)]);
    if (up && 'noteId' in up) return { kind: 'note', noteId: up.noteId };
    return { kind: 'kept', waiting: up?.waiting ?? (this.state.account === 'here' ? 'connection' : this.state.account) };
  }

  /** Throws it away: here at once, and on Alcove now or, without a connection, as soon as there is one. */
  async discard(): Promise<void> {
    if (this.state.status === 'stopped') return;
    this.capture.discard();
    this.end();
    const r = this.server;
    let gone = !this.tried;
    if (r) {
      try { await within(CALL_MS, r.discard()); gone = true; } catch (e) { slog.warn('discarding the recording on Alcove failed; it’s deleted there when there’s a connection', { id: this.id, err: e }); }
    }
    if (this.release) {
      try { await (gone ? forgetKept(this.id) : dropKept(this.id)); } catch (e) { slog.error('couldn’t delete the recording kept on this device', { id: this.id, err: e }); }
      this.letGo();
      if (!gone) uploads.kick();
    }
    slog.info('room recording discarded', { id: this.id, deletedOnAlcove: gone });
  }

  /** The screen has gone: the transcript hears nothing more. */
  close(): void {
    this.capture.close();
  }

  /**
   * Starts it on Alcove, if it isn't there yet and there's a connection, and only for its own account. Started with a
   * connection, at Alcove's time; otherwise from this device's start.
   */
  private async attach(): Promise<void> {
    if (this.server || this.attaching || this.ended() || this.state.held === 'forgotten' || !navigator.onLine) return;
    this.attaching = true;
    const live = this.live;
    this.live = false;
    try {
      // Only the account recording it may start it: the page may have been signed out, or into someone else, meanwhile.
      const session = await within(CALL_MS, api.auth.getSession());
      const account = !session ? 'signed-out' : session.ownerId === this.owner ? 'here' : 'other';
      if (account !== this.state.account) this.set({ account });
      if (account !== 'here') {
        this.failure = account === 'other'
          ? new AlcoveApiError('forbidden', 'Someone else is signed in on this device now.')
          : new AlcoveApiError('unauthenticated', 'You’re signed out. Sign in to record.');
        slog.info('the recording isn’t started on Alcove: the session here isn’t its account', { id: this.id, account });
        return;
      }
      if (!this.tried && this.release) await updateKept(this.id, { tried: true });
      this.tried = true;
      const r = await within(CALL_MS, api.recordings.start({ title: this.state.title, owner: this.owner, ...(live ? {} : { startedAt: this.startedAt }) }));
      const there = r.getSnapshot();
      if (this.ended()) {
        // It ended here while it was starting there: the uploads finish it, or delete it.
        slog.info('the recording reached Alcove after it ended here', { id: this.id, recordingId: there.id });
        return;
      }
      this.server = r;
      this.startedAt = there.startedAt;
      this.unfollow = r.subscribe(() => { const t = r.getSnapshot().transcript; if (t !== this.state.transcript) this.set({ transcript: t }); });
      // What's kept here carries on with this recording from now on, from Alcove's own start.
      if (this.release) void updateKept(this.id, { server: there.id, startedAt: there.startedAt }).catch((e: unknown) => slog.warn('couldn’t note where the recording is on Alcove', { id: this.id, err: e }));
      // Renamed or paused here before it got there: Alcove's copy follows.
      this.titleThere = there.title;
      this.tellAlcove({ name: true, status: this.state.status === 'paused' });
      this.failing = false;
      this.settle();
      slog.info('room recording is on Alcove', { id: this.id, recordingId: there.id, elapsed: this.state.elapsed, kept: this.kept, atAlcovesTime: live });
    } catch (e) {
      this.failure = e;
      const code = errorCode(e);
      if (code === 'forbidden') this.set({ account: 'other' });
      if (code === 'unauthenticated') this.set({ account: 'signed-out' });
      slog.at(code === 'network' ? 'info' : 'warn', 'the recording couldn’t start on Alcove yet', { id: this.id, err: e });
    } finally {
      this.attaching = false;
    }
  }

  /** Sends to Alcove, if it's there and there's a connection; a refusal there means its copy is out of step. */
  private async toAlcove(ms: number, f: (r: RoomRecording) => Promise<void>): Promise<void> {
    const r = this.server;
    if (!r || !navigator.onLine) throw offline();
    try {
      await within(ms, f(r));
    } catch (e) {
      if (errorCode(e) === 'conflict') this.tellAlcove({ name: false, status: true });
      throw e;
    }
    if (this.failing) { this.failing = false; this.settle(); }
  }

  private async keepHere(f: () => Promise<boolean>): Promise<void> {
    try {
      if (!(await f())) {
        // Not kept: what this device kept is gone, which only signing out here does (this holds the recording's lock).
        this.forgotten();
        throw new Error('You signed out on this device, so this recording can’t be kept.');
      }
      this.kept++;
      if (navigator.onLine && !this.failing) { this.failing = true; this.settle(); }
    } catch (e) {
      if (e instanceof DeviceFull) this.hold('full');
      throw e;
    }
  }

  /** Signed out on this device: everything it kept for this account is gone, so nothing more of this recording can be kept. */
  private forgotten() {
    if (this.state.held === 'forgotten') return;
    slog.warn('this device was signed out mid-recording; nothing more of it can be kept', { id: this.id });
    this.letGo();
    this.set({ held: 'forgotten', keeping: false });
    if (this.state.status === 'recording') void this.pause();
  }

  /** Brings Alcove's copy into step with this one: its name, and whether it's paused or recording. */
  private tellAlcove(what: { name: boolean; status: boolean }) {
    const r = this.server;
    if (!r || this.state.status === 'stopped') return;
    const { title, status } = this.state;
    const name = what.name && title !== this.titleThere ? within(CALL_MS, r.rename(title)).then(() => { this.titleThere = title; }) : undefined;
    const now = what.status ? within(CALL_MS, status === 'paused' ? r.pause() : r.resume()) : undefined;
    if (!name && !now) return;
    const told = Promise.all([name, now]).then(() => undefined, (e: unknown) => {
      this.behind = true;
      slog.info('Alcove’s copy of the recording is out of step; it catches up when the connection is back', { id: this.id, status, err: e });
    });
    this.telling = Promise.all([this.telling, told]).then(() => undefined);
  }

  private settle() {
    const online = navigator.onLine;
    const connected = online && this.server !== null && !this.failing && this.state.account === 'here';
    if (online !== this.state.online || connected !== this.state.connected) this.set({ online, connected });
  }

  /** Whether it has finished or been thrown away (it may have, while waiting on Alcove). */
  private ended(): boolean { return this.state.status === 'stopped'; }

  /** Pauses by itself, saying why. */
  private hold(why: 'offline' | 'full') {
    if (this.state.status !== 'recording') return;
    this.set({ held: why });
    void this.pause();
  }

  private tick() {
    if (this.state.status === 'recording') this.set({ elapsed: this.state.elapsed + 1 });
    if (!this.server && ++this.ticks % ATTACH_EVERY_S === 0) void this.attach();
  }

  private readonly onOnline = () => {
    this.settle();
    void this.attach();
    if (this.behind) { this.behind = false; this.tellAlcove({ name: true, status: true }); }
  };

  private readonly onOffline = () => {
    this.settle();
    if (!this.release && !this.state.ending) this.hold('offline');
  };

  private end() {
    if (this.state.status !== 'stopped') this.set({ status: 'stopped' });
    clearInterval(this.timer);
    removeEventListener('online', this.onOnline);
    removeEventListener('offline', this.onOffline);
    this.unfollow?.();
    this.unfollow = null;
  }

  private letGo() {
    this.release?.();
    this.release = null;
  }
}
