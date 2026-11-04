/*
 * Local media: camera, microphone and screen, plus the notes recorder. One instance lives from the
 * pre-join screen through the call, so permission is asked once and the preview carries over. The
 * microphone, camera and speaker chosen last time are used again when they're plugged in.
 *
 * It keeps watching what's plugged in and what the browser allows. A device that's unplugged gives way to another
 * (muted or not, on or off, as it was), a chosen one that comes back is used again, and a microphone left on the
 * system's choice follows the system. Before the call, a device that becomes usable starts the way the person
 * wanted it; in the call, nothing turns a microphone or camera on by itself: after a gap with none, it waits for
 * its button.
 */
import { errorCode, type AudioPiece } from '@alcove/api';
import { log } from '~/lib/log';
import { canChooseSpeaker, enumerate, permissions, plainName, readPrefs, rememberDevice, watchPermissions, type Capture, type Permission } from './devices';

const mlog = log.child({ component: 'media' });

/**
 * Why a microphone or camera isn't working: the browser is blocking it, the computer is keeping the browser from it,
 * the browser's question went unanswered, none is plugged in, another app holds it, or it didn't start.
 */
export type DeviceProblem = 'blocked' | 'system' | 'dismissed' | 'missing' | 'busy' | 'failed';
export interface DeviceAccess { permission: Permission; problem: DeviceProblem | null }
/** Something that changed without anyone pressing a button (a device unplugged, or back), to say once. */
export interface DeviceChange { n: number; kind: 'mic' | 'cam' | 'speaker'; text: string }

export interface MediaSnapshot {
  camera: MediaStream | null;
  screen: MediaStream | null;
  /** The microphone is on: there is one working, and it isn't muted. */
  mic: boolean;
  /** The camera is on. */
  cam: boolean;
  /** The microphone and camera in use. */
  micId: string | null;
  camId: string | null;
  /**
   * Where calls play: the chosen speaker while it's plugged in, else the system's ("default", or "" where the browser
   * has no such entry). Null where a page can't choose (Safari).
   */
  speakerId: string | null;
  /** Whether the browser lets Alcove use each, and what's wrong with one that isn't working. */
  access: Record<Capture, DeviceAccess>;
  /** The latest changes nobody pressed a button for (a few at most): the last under the preview before the call, each as a toast in it. */
  changes: readonly DeviceChange[];
  /** The browser cleans up the microphone (noise suppression). */
  noiseReduction: boolean;
  /** The camera can blur what's behind you (the browser or system does it), and whether it is. */
  canBlur: boolean;
  blur: boolean;
  /** What's being shared: the browser's name for it, and whether it's a tab, a window or a screen. */
  screenLabel: string | null;
  screenSurface: ShareSurface | null;
}

/** What someone chooses to share. The browser's own picker then asks which one. */
export type ShareSurface = 'browser' | 'window' | 'monitor';
export interface ShareChoice { surface: ShareSurface; audio: boolean }

const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 } } as const;
const audioFor = (noiseSuppression: boolean): MediaTrackConstraints => ({ echoCancellation: true, noiseSuppression });
const deviceOf = (t: MediaStreamTrack | null) => t?.getSettings().deviceId ?? null;
/** Blur that the browser can switch both ways: a camera that only reports the system's setting can't be changed from here. */
function blurOf(t: MediaStreamTrack | null): { canBlur: boolean; blur: boolean } {
  if (!t || typeof t.getCapabilities !== 'function') return { canBlur: false, blur: false };
  const can = t.getCapabilities().backgroundBlur ?? [];
  return { canBlur: can.includes(true) && can.includes(false), blur: t.getSettings().backgroundBlur === true };
}
/** Browsers name shared tabs and screens by internal IDs; those read as what was chosen instead. */
function shareLabel(t: MediaStreamTrack, surface: ShareSurface | null): string {
  const internal = /^(web-contents-media-stream|screen|window):/i.test(t.label) || !t.label.trim();
  if (!internal) return t.label;
  return surface === 'browser' ? 'a tab' : surface === 'window' ? 'a window' : 'your screen';
}
const surfaceOf = (v: unknown): ShareSurface | null => (v === 'browser' || v === 'window' || v === 'monitor' ? v : null);

const refused = (e: unknown) => e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
/**
 * What a failed request for a device means, from the error and what the browser says about the permission. A refusal
 * that comes back at once was never asked: the browser is blocking it, whatever its permission says.
 */
function problemOf(e: unknown, permission: Permission, quick: boolean): DeviceProblem {
  const name = e instanceof DOMException ? e.name : '';
  if (refused(e)) {
    if (permission === 'denied') return 'blocked';
    // Allowed here and refused anyway: the computer is keeping the browser from it (Chrome says "by system").
    if (permission === 'granted' || (e instanceof DOMException && /system/i.test(e.message))) return 'system';
    return quick ? 'blocked' : 'dismissed';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'failed';
}
/** A request answered faster than anyone could answer a question about it. */
const QUICK_MS = 300;
/** A device that's working was allowed, whatever the browser said before (unless it won't say). */
const granted = (p: Permission): Permission => (p === 'unknown' ? 'unknown' : 'granted');

interface Opened { audio?: MediaStreamTrack | undefined; video?: MediaStreamTrack | undefined; audioError?: unknown; videoError?: unknown; quick: boolean }

/** A problem fixed since: allowed now (when it was refused or unanswered), or, when none was plugged in, one is. */
const fixedBy = (problem: DeviceProblem, permission: Permission, plugged: boolean): boolean =>
  problem === 'missing' ? plugged : (problem === 'blocked' || problem === 'dismissed') && permission === 'granted';

export class LocalMedia {
  private snap: MediaSnapshot = {
    camera: null, screen: null, mic: true, cam: true, micId: null, camId: null, speakerId: null,
    access: { mic: { permission: 'unknown', problem: null }, cam: { permission: 'unknown', problem: null } }, changes: [],
    noiseReduction: readPrefs().noiseReduction ?? true, canBlur: false, blur: false, screenLabel: null, screenSurface: null
  };
  private listeners = new Set<() => void>();
  private audio: MediaStreamTrack | null = null;
  private video: MediaStreamTrack | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(4096));
  /**
   * What the person asked for last, and what a device that opens starts as. Before the call, a device that becomes
   * usable starts this way. In the call it's only on because they pressed it: joining sets it from what's on, and
   * losing every device or failing to start one turns it off.
   */
  private want = { mic: true, cam: true };
  private inCall = false;
  private stopWatching: (() => void) | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;
  /** Opening and switching devices, one at a time, so a device check never crosses a press. */
  private queue: Promise<unknown> = Promise.resolve();
  private said = 0;
  private begun = false;
  /** Moves on at every stop(). Device work carries the value it had when it was asked for, and does nothing after a stop. */
  private gen = 0;
  /** The devices listed last time: to name one that's just been unplugged, and to tell one that's come back. */
  private listed: MediaDeviceInfo[] = [];
  /** A camera chosen while the camera is off: used when it's turned on, and remembered once it has opened. */
  private camChoice: string | null = null;
  /** Tracks whose device went away by itself (their ended event fired), as opposed to ones Alcove stopped. */
  private gone = new WeakSet<MediaStreamTrack>();

  getSnapshot = (): MediaSnapshot => this.snap;
  /** start() has run (and stop() hasn't since): a screen that finds media already started leaves it as it is. */
  get started(): boolean { return this.begun; }
  /** The device behind this track went away by itself (unplugged, or the browser took it back). */
  unplugged(t: MediaStreamTrack): boolean { return this.gone.has(t); }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<MediaSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach((l) => l()); }
  private rebuild() {
    const tracks = [this.audio, this.video].filter((t): t is MediaStreamTrack => !!t);
    this.set({ camera: tracks.length ? new MediaStream(tracks) : null });
  }
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.queue.then(f, f);
    this.queue = next.catch(() => undefined);
    return next;
  }
  /** Media stopped since this work was asked for: what it opened is let go of, and nothing else happens. */
  private lateFor(gen: number, ...opened: (MediaStreamTrack | undefined)[]): boolean {
    if (gen === this.gen) return false;
    for (const t of opened) t?.stop();
    return true;
  }
  private changed(kind: DeviceChange['kind'], text: string): readonly DeviceChange[] { return [...this.snap.changes, { n: ++this.said, kind, text }].slice(-4); }
  private access(kind: Capture, a: Partial<DeviceAccess>): Record<Capture, DeviceAccess> {
    return { ...this.snap.access, [kind]: { ...this.snap.access[kind], ...a } };
  }

  /**
   * Asks for the microphone (and the camera when wanted), the ones chosen last time if they're plugged in. One that's
   * blocked, missing or busy never costs the other, and nothing the browser already refuses is asked for. Safe to call
   * again.
   */
  start(opts: { mic: boolean; cam: boolean }): Promise<void> {
    this.begun = true;
    const gen = this.gen;
    return this.serial(async () => {
      if (gen !== this.gen) return;
      this.want = { ...opts };
      this.watch();
      const perms = await permissions();
      const got = await this.open({ audio: perms.mic !== 'denied', video: opts.cam && perms.cam !== 'denied' }, perms);
      if (this.lateFor(gen, got.audio, got.video)) return;
      const prefs = readPrefs();
      // Pressed while the browser was asking: the latest press decides.
      if (got.video && !this.want.cam) got.video.stop();
      this.useAudio(got.audio ?? null, this.want.mic);
      this.useVideo(got.video && this.want.cam ? got.video : null);
      this.confirmCam();
      this.rebuild();
      if (prefs.blur) await this.applyBlur(true);
      this.listed = await enumerate().catch(() => []);
      const micId = deviceOf(this.audio);
      const camId = deviceOf(this.video);
      // A remembered device that isn't available: the browser picked another, and the screen says which.
      const micSub = Boolean(prefs.mic && micId && prefs.mic !== micId);
      const camSub = Boolean(prefs.cam && camId && prefs.cam !== camId);
      const missing = [micSub ? `microphone (now ${plainName(this.audio?.label ?? '') || 'the default'})` : '', camSub ? `camera (now ${plainName(this.video?.label ?? '') || 'the default'})` : ''].filter(Boolean);
      const problem = (kind: Capture, has: boolean, asked: boolean, err: unknown): DeviceProblem | null =>
        has ? null : perms[kind] === 'denied' ? 'blocked' : asked ? problemOf(err, perms[kind], got.quick) : null;
      this.set({
        mic: Boolean(this.audio) && this.want.mic, cam: Boolean(this.video), micId, camId, speakerId: this.speakerFor(this.listed),
        access: {
          mic: { permission: this.audio ? granted(perms.mic) : perms.mic, problem: problem('mic', Boolean(this.audio), 'audioError' in got, got.audioError) },
          cam: { permission: this.video ? granted(perms.cam) : perms.cam, problem: problem('cam', Boolean(this.video), 'videoError' in got, got.videoError) }
        },
        ...blurOf(this.video),
        ...(missing.length ? { changes: this.changed(micSub ? 'mic' : 'cam', `The ${missing.join(' and ')} you chose before isn’t available, so Alcove is using another.`) } : {})
      });
      mlog.info('devices started', {
        mic: Boolean(this.audio), cam: Boolean(this.video), micProblem: this.snap.access.mic.problem, camProblem: this.snap.access.cam.problem,
        micPermission: perms.mic, camPermission: perms.cam, remembered: Boolean(prefs.mic || prefs.cam), substituted: missing.length
      });
    });
  }

  /**
   * Opens the microphone, the camera or both, the remembered ones first. A remembered one that's listed but won't start
   * (busy in another app, or not really there) gives way to the system's; when the pair fails, each is tried alone, so
   * one problem costs one device.
   */
  private async open(ask: { audio: boolean; video: boolean }, perms: Record<Capture, Permission>): Promise<Opened> {
    const prefs = readPrefs();
    const micPick = prefs.mic;
    const camPick = this.camChoice ?? prefs.cam;
    const anyMic = audioFor(this.snap.noiseReduction);
    const anyCam: MediaTrackConstraints = { ...VIDEO, facingMode: 'user' };
    const audio: MediaTrackConstraints | false = ask.audio ? (micPick ? { ...anyMic, deviceId: { ideal: micPick } } : anyMic) : false;
    const video: MediaTrackConstraints | false = ask.video ? (camPick ? { ...VIDEO, deviceId: { ideal: camPick } } : anyCam) : false;
    if (!audio && !video) return { quick: false };
    const gum = async (a: MediaTrackConstraints | false, v: MediaTrackConstraints | false): Promise<MediaStream> => {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: a, video: v });
      } catch (e) {
        const plainA = a && micPick ? anyMic : a;
        const plainV = v && camPick ? anyCam : v;
        // A refusal isn't about the device, and with nothing remembered there's nothing else to try.
        if (refused(e) || (plainA === a && plainV === v)) throw e;
        mlog.info('a remembered device didn’t start; trying the system’s', { err: e });
        return navigator.mediaDevices.getUserMedia({ audio: plainA, video: plainV });
      }
    };
    const asked = performance.now();
    try {
      const s = await gum(audio, video);
      return { audio: s.getAudioTracks()[0], video: s.getVideoTracks()[0], quick: false };
    } catch (e) {
      const quick = performance.now() - asked < QUICK_MS;
      mlog.warn('could not start devices', { err: e, audio: Boolean(audio), video: Boolean(video), quick });
      if (!audio || !video) return audio ? { audioError: e, quick } : { videoError: e, quick };
      // Only something already allowed is asked for again after a refusal: anything else would just ask again.
      const now = refused(e) ? await permissions() : perms;
      const out: Opened = { quick };
      if (!refused(e) || now.mic === 'granted') {
        try { out.audio = (await gum(audio, false)).getAudioTracks()[0]; } catch (ea) { out.audioError = ea; }
      } else out.audioError = e;
      if (!refused(e) || now.cam === 'granted') {
        try { out.video = (await gum(false, video)).getVideoTracks()[0]; } catch (ev) { out.videoError = ev; }
      } else out.videoError = e;
      return out;
    }
  }

  /** Puts `t` in as the microphone (or none), muted or not, and listens for it to be unplugged. */
  private useAudio(t: MediaStreamTrack | null, on: boolean) {
    const before = this.audio;
    if (before && before !== t) { before.removeEventListener('ended', this.onEnded); before.stop(); }
    this.audio = t;
    if (t && t !== before) t.addEventListener('ended', this.onEnded);
    if (t) t.enabled = on;
    this.meter();
  }
  private useVideo(t: MediaStreamTrack | null) {
    const before = this.video;
    if (before && before !== t) { before.removeEventListener('ended', this.onEnded); before.stop(); }
    this.video = t;
    if (t && t !== before) t.addEventListener('ended', this.onEnded);
  }
  /** A device stopped on its own (unplugged, or the browser took it back): note it, and look at once. */
  private onEnded = (e: Event) => {
    if (e.target instanceof MediaStreamTrack) this.gone.add(e.target);
    this.recheckSoon(0);
  };
  /** A camera chosen while off, now open: remembered if it's the one that opened. */
  private confirmCam() {
    if (!this.camChoice || !this.video) return;
    if (deviceOf(this.video) === this.camChoice) rememberDevice('cam', this.camChoice);
    this.camChoice = null;
  }

  /**
   * Turns the microphone on or off. With none working, turning it on asks for one, which is when the browser can ask
   * the person. Resolves false if it couldn't be turned on; the snapshot then says why.
   */
  async setMic(on: boolean): Promise<boolean> {
    this.want.mic = on;
    if (!on || this.audio) {
      if (this.audio) this.audio.enabled = on;
      this.set({ mic: on && Boolean(this.audio) });
      return !on || Boolean(this.audio);
    }
    const gen = this.gen;
    return this.serial(() => this.reopenMic(gen, null));
  }
  /** Turns the camera on or off. Off lets go of the camera; on asks for it again. Resolves false if it couldn't start. */
  async setCam(on: boolean): Promise<boolean> {
    this.want.cam = on;
    if (!on) {
      this.useVideo(null);
      this.set({ cam: false, access: this.snap.access.cam.problem === 'blocked' ? this.snap.access : this.access('cam', { problem: null }) });
      this.rebuild();
      return true;
    }
    if (this.video) return true;
    const gen = this.gen;
    return this.serial(() => this.reopenCam(gen, null));
  }
  /** Tries again whatever isn't working (Try again): each starts the way the person wanted it; in a call, muted and off. */
  retry(): Promise<void> {
    const gen = this.gen;
    return this.serial(async () => {
      if (gen === this.gen && !this.audio && this.snap.access.mic.problem) await this.reopenMic(gen, null);
      if (gen === this.gen && !this.video && this.snap.access.cam.problem && this.want.cam && !this.inCall) await this.reopenCam(gen, null);
    });
  }
  /** From joining on, nothing turns the microphone or camera on by itself: only their buttons do. */
  setInCall(on: boolean) {
    this.inCall = on;
    if (on) this.want = { mic: this.snap.mic, cam: this.snap.cam };
  }

  /** Opens a microphone where none is working. It starts as the latest press says, whatever it was when this was asked. */
  private async reopenMic(gen: number, say: string | null): Promise<boolean> {
    if (gen !== this.gen) return false;
    if (this.audio?.readyState === 'live') { this.audio.enabled = this.want.mic; this.set({ mic: this.want.mic }); return true; }
    const perms = await permissions();
    const got = await this.open({ audio: true, video: false }, perms);
    if (this.lateFor(gen, got.audio)) return false;
    if (!got.audio) {
      // A press that didn't work leaves nothing waiting to turn on by itself.
      if (this.inCall) this.want.mic = false;
      this.set({ mic: false, access: this.access('mic', { permission: perms.mic, problem: problemOf(got.audioError, perms.mic, got.quick) }) });
      return false;
    }
    const on = this.want.mic;
    this.useAudio(got.audio, on);
    this.rebuild();
    this.set({ mic: on, micId: deviceOf(got.audio), access: this.access('mic', { permission: granted(perms.mic), problem: null }), ...(say ? { changes: this.changed('mic', say) } : {}) });
    mlog.info('microphone started', { muted: !on, automatic: Boolean(say) });
    return true;
  }
  /** Opens the camera where none is working, unless it's been turned off meanwhile. */
  private async reopenCam(gen: number, say: string | null): Promise<boolean> {
    if (gen !== this.gen) return false;
    // Already on, or turned off again before this got its turn: nothing to open.
    if (this.video?.readyState === 'live' || !this.want.cam) return true;
    const perms = await permissions();
    const got = await this.open({ audio: false, video: true }, perms);
    if (this.lateFor(gen, got.video)) return false;
    if (!got.video) {
      if (this.inCall) this.want.cam = false;
      this.set({ cam: false, access: this.access('cam', { permission: perms.cam, problem: problemOf(got.videoError, perms.cam, got.quick) }) });
      return false;
    }
    // Turned off while the browser was opening it: off it stays, and nothing went wrong.
    if (!this.want.cam) { got.video.stop(); return true; }
    this.useVideo(got.video);
    this.confirmCam();
    if (readPrefs().blur) await this.applyBlur(true);
    this.set({ cam: true, camId: deviceOf(got.video), access: this.access('cam', { permission: granted(perms.cam), problem: null }), ...blurOf(got.video), ...(say ? { changes: this.changed('cam', say) } : {}) });
    this.rebuild();
    mlog.info('camera started', { automatic: Boolean(say) });
    return true;
  }

  /**
   * Switches to another microphone, keeping it muted or not as it was. The notes recorder and the live
   * transcript carry on with the new one (they follow micTrack()). It's remembered only once it has opened, so one
   * that won't start isn't tried again at every look.
   */
  chooseMic(deviceId: string): Promise<boolean> {
    // The one in use, picked again: it works, so it's the one to remember, and there's nothing to open.
    if (deviceId === this.snap.micId && this.audio?.readyState === 'live') { rememberDevice('mic', deviceId); return Promise.resolve(true); }
    const gen = this.gen;
    return this.serial(async () => {
      const ok = await this.switchMic(gen, { exact: deviceId }, null);
      if (ok) rememberDevice('mic', deviceId);
      return ok;
    });
  }
  /** Switches to another camera. With the camera off it's used when it's turned on, and remembered once it opens. */
  chooseCam(deviceId: string): Promise<boolean> {
    if (deviceId === this.snap.camId && this.video?.readyState === 'live') { rememberDevice('cam', deviceId); return Promise.resolve(true); }
    if (!this.video) { this.camChoice = deviceId; this.set({ camId: deviceId }); return Promise.resolve(true); }
    const gen = this.gen;
    return this.serial(async () => {
      const ok = await this.switchCam(gen, { exact: deviceId }, null);
      if (ok) rememberDevice('cam', deviceId);
      return ok;
    });
  }
  /**
   * Moves to another microphone (`undefined`: the system's), muted or not as the latest press says (in a call, a mic
   * found after none was working starts muted). `say` names the new one in a change nobody pressed for.
   */
  private async switchMic(gen: number, deviceId: ConstrainDOMString | undefined, say: ((now: string) => string) | null): Promise<boolean> {
    if (gen !== this.gen) return false;
    let next: MediaStreamTrack | undefined;
    try {
      next = (await navigator.mediaDevices.getUserMedia({ audio: { ...audioFor(this.snap.noiseReduction), ...(deviceId ? { deviceId } : {}) } })).getAudioTracks()[0];
    } catch (e) {
      mlog.warn('could not switch microphones', { err: e, automatic: Boolean(say) });
      if (gen !== this.gen) return false;
      const perms = await permissions();
      if (this.audio?.readyState === 'live') this.set({ changes: this.changed('mic', `That microphone didn’t start. Still using ${plainName(this.audio.label) || 'the one before'}.`) });
      else {
        this.useAudio(null, false);
        this.rebuild();
        if (this.inCall) this.want.mic = false;
        this.set({ mic: false, micId: null, access: this.access('mic', { permission: perms.mic, problem: problemOf(e, perms.mic, false) }) });
      }
      return false;
    }
    if (!next || this.lateFor(gen, next)) return false;
    const on = this.want.mic;
    this.useAudio(next, on);
    this.rebuild();
    this.set({ mic: on, micId: deviceOf(next), access: this.access('mic', { permission: granted(this.snap.access.mic.permission), problem: null }), ...(say ? { changes: this.changed('mic', say(plainName(next.label) || 'another microphone') + (on ? '' : ' You’re still muted.')) } : {}) });
    mlog.info('microphone changed', { muted: !on, automatic: Boolean(say) });
    return true;
  }
  /** Moves to another camera (`undefined`: the front one), kept on unless it's been turned off meanwhile. */
  private async switchCam(gen: number, deviceId: ConstrainDOMString | undefined, say: ((now: string) => string) | null): Promise<boolean> {
    if (gen !== this.gen) return false;
    let next: MediaStreamTrack | undefined;
    try {
      next = (await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, ...(deviceId ? { deviceId } : { facingMode: 'user' }) } })).getVideoTracks()[0];
    } catch (e) {
      mlog.warn('could not switch cameras', { err: e, automatic: Boolean(say) });
      if (gen !== this.gen) return false;
      const perms = await permissions();
      if (this.video?.readyState === 'live') this.set({ changes: this.changed('cam', `That camera didn’t start. Still using ${plainName(this.video.label) || 'the one before'}.`) });
      else {
        this.useVideo(null);
        this.rebuild();
        if (this.inCall) this.want.cam = false;
        this.set({ cam: false, access: this.access('cam', { permission: perms.cam, problem: problemOf(e, perms.cam, false) }) });
      }
      return false;
    }
    if (!next || this.lateFor(gen, next)) return false;
    if (!this.want.cam) { next.stop(); return false; }
    this.useVideo(next);
    if (this.snap.blur || readPrefs().blur) await this.applyBlur(true);
    this.rebuild();
    this.set({ cam: true, camId: deviceOf(next), access: this.access('cam', { permission: granted(this.snap.access.cam.permission), problem: null }), ...blurOf(next), ...(say ? { changes: this.changed('cam', say(plainName(next.label) || 'another camera')) } : {}) });
    mlog.info('camera changed', { automatic: Boolean(say) });
    return true;
  }
  /** Where the test sound (and, in calls with others, their voices) plays. */
  chooseSpeaker(deviceId: string) { rememberDevice('speaker', deviceId); this.set({ speakerId: deviceId }); }
  /** The chosen speaker while it's plugged in, else the system's; null where a page can't choose one. */
  private speakerFor(all: MediaDeviceInfo[]): string | null {
    if (!canChooseSpeaker()) return null;
    const outs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId);
    const chosen = readPrefs().speaker;
    if (chosen && outs.some((d) => d.deviceId === chosen)) return chosen;
    return outs.some((d) => d.deviceId === 'default') ? 'default' : '';
  }

  /* ---------- watching what's plugged in and what the browser allows ---------- */

  /** From the first start until stop(): devices coming and going, permissions changing, devices that stop. */
  private watch() {
    if (this.stopWatching) return;
    const soon = () => this.recheckSoon();
    const devices = navigator.mediaDevices;
    devices?.addEventListener('devicechange', soon);
    const unwatch = watchPermissions(soon);
    // Safari never says when a permission changes: look again whenever the page comes back.
    const back = () => { if (document.visibilityState === 'visible') soon(); };
    document.addEventListener('visibilitychange', back);
    addEventListener('focus', soon);
    this.stopWatching = () => {
      devices?.removeEventListener('devicechange', soon);
      unwatch();
      document.removeEventListener('visibilitychange', back);
      removeEventListener('focus', soon);
    };
  }
  private recheckSoon(ms = 250) {
    if (this.soon) clearTimeout(this.soon);
    this.soon = setTimeout(() => {
      this.soon = null;
      const gen = this.gen;
      void this.serial(() => this.recheck(gen)).catch((e: unknown) => mlog.warn('checking devices failed', { err: e }));
    }, ms);
  }
  private async recheck(gen: number): Promise<void> {
    if (!this.stopWatching || gen !== this.gen) return;
    const [all, perms] = await Promise.all([enumerate().catch((): MediaDeviceInfo[] => []), permissions()]);
    if (gen !== this.gen) return;
    const before = this.listed;
    this.listed = all;
    const prefs = readPrefs();
    await this.recheckMic(gen, all, before, perms.mic, prefs.mic);
    if (gen !== this.gen) return;
    await this.recheckCam(gen, all, before, perms.cam, prefs.cam);
    if (gen !== this.gen) return;
    this.recheckSpeaker(all, before);
    // What the browser says now; a device that's working was allowed, whatever an older answer said.
    this.set({ access: { mic: { ...this.snap.access.mic, permission: this.audio ? granted(perms.mic) : perms.mic }, cam: { ...this.snap.access.cam, permission: this.video ? granted(perms.cam) : perms.cam } } });
  }
  /**
   * The microphone: one that's gone gives way to the chosen one or the system's, muted or not as it was (or to none,
   * said plainly); the chosen one coming back after it was gone is used again; one left on the system's follows it
   * when the system moves. With none working, a fix (allowed again, or one plugged in) starts it before the call, and
   * in the call waits for Unmute.
   */
  private async recheckMic(gen: number, all: MediaDeviceInfo[], before: MediaDeviceInfo[], permission: Permission, chosen: string | undefined) {
    const inputs = all.filter((d) => d.kind === 'audioinput');
    // Browsers give devices real IDs only once something is allowed: until then the list can't say what's gone.
    const known = all.some((d) => d.deviceId);
    const here = (id: string | undefined) => Boolean(id) && inputs.some((d) => d.deviceId === id);
    const wasHere = (id: string | undefined) => Boolean(id) && before.some((d) => d.kind === 'audioinput' && d.deviceId === id);
    const t = this.audio;
    if (t) {
      const id = t.getSettings().deviceId;
      if (t.readyState === 'ended' || (known && id && !here(id))) {
        const name = plainName(t.label) || 'Your microphone';
        mlog.info('microphone gone', { permission, others: inputs.length, muted: !this.snap.mic });
        if (permission === 'denied' || !inputs.some((d) => d.deviceId)) {
          this.useAudio(null, false);
          this.rebuild();
          // In a call, a microphone found later starts muted: it never comes back on by itself.
          if (this.inCall) this.want.mic = false;
          this.set({
            mic: false, micId: null, access: this.access('mic', { permission, problem: permission === 'denied' ? 'blocked' : 'missing' }),
            changes: this.changed('mic', permission === 'denied' ? 'Your browser stopped letting Alcove use the microphone.' : `${name} isn’t connected any more, and there’s no other microphone. Yours is off.`)
          });
        } else await this.switchMic(gen, here(chosen) ? { exact: chosen ?? '' } : undefined, (now) => `${name} isn’t connected any more. Now using ${now}.`);
        return;
      }
      // The chosen one back after it was gone. Only then: one that's listed but won't start isn't tried at every look.
      if (chosen && chosen !== 'default' && here(chosen) && !wasHere(chosen) && id !== chosen) { await this.switchMic(gen, { exact: chosen }, (now) => `Back on ${now}.`); return; }
      // Left on the system's microphone: when the system moves to another (a headset plugged in), so does the call.
      const def = inputs.find((d) => d.deviceId === 'default');
      const defBefore = before.find((d) => d.kind === 'audioinput' && d.deviceId === 'default');
      const group = t.getSettings().groupId;
      if (id === 'default' && def?.groupId && group && def.groupId !== group && defBefore && defBefore.groupId !== def.groupId) {
        await this.switchMic(gen, { exact: 'default' }, (now) => `Now using ${now}, the microphone your system uses.`);
      }
      return;
    }
    const problem = this.snap.access.mic.problem;
    if (!problem) return;
    if (permission === 'denied') { if (problem !== 'blocked') this.set({ access: this.access('mic', { problem: 'blocked' }) }); return; }
    if (!fixedBy(problem, permission, inputs.length > 0)) return;
    if (!this.inCall) { await this.reopenMic(gen, problem === 'missing' ? 'Microphone connected.' : 'Alcove can use your microphone now.'); return; }
    this.set({ access: this.access('mic', { problem: null }), changes: this.changed('mic', problem === 'missing' ? 'A microphone is connected. Unmute when you’re ready.' : 'Alcove can use your microphone now. Unmute when you’re ready.') });
  }
  /** The camera, the same way: on stays on with another camera, or turns off with none; off stays off in a call. */
  private async recheckCam(gen: number, all: MediaDeviceInfo[], before: MediaDeviceInfo[], permission: Permission, chosen: string | undefined) {
    const cams = all.filter((d) => d.kind === 'videoinput');
    const known = all.some((d) => d.deviceId);
    const here = (id: string | undefined) => Boolean(id) && cams.some((d) => d.deviceId === id);
    const wasHere = (id: string | undefined) => Boolean(id) && before.some((d) => d.kind === 'videoinput' && d.deviceId === id);
    const t = this.video;
    if (t) {
      const id = t.getSettings().deviceId;
      if (t.readyState === 'ended' || (known && id && !here(id))) {
        const name = plainName(t.label) || 'Your camera';
        mlog.info('camera gone', { permission, others: cams.length });
        if (permission === 'denied' || !cams.some((d) => d.deviceId)) {
          this.useVideo(null);
          this.rebuild();
          if (this.inCall) this.want.cam = false;
          this.set({ cam: false, access: this.access('cam', { problem: permission === 'denied' ? 'blocked' : 'missing' }), changes: this.changed('cam', permission === 'denied' ? 'Your browser stopped letting Alcove use the camera.' : `${name} isn’t connected any more. Your camera is off.`) });
        } else await this.switchCam(gen, here(chosen) ? { exact: chosen ?? '' } : undefined, (now) => `${name} isn’t connected any more. Now showing ${now}.`);
        return;
      }
      if (chosen && here(chosen) && !wasHere(chosen) && id !== chosen) await this.switchCam(gen, { exact: chosen }, (now) => `Back on ${now}.`);
      return;
    }
    const problem = this.snap.access.cam.problem;
    if (permission === 'denied') { if (problem !== 'blocked') this.set({ access: this.access('cam', { problem: 'blocked' }) }); return; }
    if (!problem || !fixedBy(problem, permission, cams.length > 0)) return;
    if (!this.inCall && this.want.cam) { await this.reopenCam(gen, problem === 'missing' ? 'Camera connected.' : 'Alcove can use your camera now.'); return; }
    this.set({ access: this.access('cam', { problem: null }), ...(this.inCall ? { changes: this.changed('cam', problem === 'missing' ? 'A camera is connected. Turn it on when you’re ready.' : 'Alcove can use your camera now. Turn it on when you’re ready.') } : {}) });
  }
  /** The speaker: the chosen one unplugged plays through the system's until it's back. */
  private recheckSpeaker(all: MediaDeviceInfo[], before: MediaDeviceInfo[]) {
    const next = this.speakerFor(all);
    const was = this.snap.speakerId;
    if (next === was) return;
    const chosen = readPrefs().speaker;
    const nameIn = (list: MediaDeviceInfo[], id: string | null) => plainName(list.find((d) => d.kind === 'audiooutput' && d.deviceId === id)?.label ?? '');
    const system = nameIn(all, 'default') || 'your system’s speaker';
    const text = was && was === chosen && next !== chosen ? `${nameIn(before, was) || 'Your speaker'} isn’t connected any more. Sound plays through ${system} now.`
      : next && next === chosen && chosen !== 'default' ? `Sound plays through ${nameIn(all, next) || 'your speaker'} again.` : null;
    this.set({ speakerId: next, ...(text ? { changes: this.changed('speaker', text) } : {}) });
    mlog.at(text ? 'info' : 'debug', 'speaker changed', { automatic: true, chosen: next === chosen });
  }

  /** Noise suppression on the microphone in use, changed in place: the recording and the transcript carry on. */
  async setNoiseReduction(on: boolean): Promise<void> {
    rememberDevice('noiseReduction', on);
    this.set({ noiseReduction: on });
    try { await this.audio?.applyConstraints({ ...audioFor(on), ...(this.snap.micId ? { deviceId: { exact: this.snap.micId } } : {}) }); } catch (e) { mlog.warn('could not change noise reduction', { err: e, on }); }
  }
  /** Background blur, where the browser can switch it (Chrome with the system's camera effects). */
  async setBlur(on: boolean): Promise<void> {
    rememberDevice('blur', on);
    await this.applyBlur(on);
    this.set(blurOf(this.video));
  }
  private async applyBlur(on: boolean) {
    const t = this.video;
    if (!t || !blurOf(t).canBlur) return;
    const blur: MediaTrackConstraintSet = { backgroundBlur: on };
    try { await t.applyConstraints({ advanced: [blur] }); } catch (e) { mlog.warn('could not change background blur', { err: e, on }); }
  }
  /**
   * Shares a tab, a window or a screen: the browser's own picker opens on that kind and asks which
   * one. Sharing again while sharing swaps what's shared. Resolves false if the picker was cancelled.
   */
  async shareScreen(choice: ShareChoice, onEnded: () => void): Promise<string | false> {
    // Hints the picker understands; the ones it doesn't are ignored, and the picker decides in the end.
    const options = {
      video: { displaySurface: choice.surface },
      audio: choice.audio && choice.surface !== 'window',
      preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
      systemAudio: choice.audio && choice.surface === 'monitor' ? 'include' : 'exclude'
    };
    try {
      const s = await navigator.mediaDevices.getDisplayMedia(options);
      const track = s.getVideoTracks()[0];
      if (!track) return false;
      const before = this.snap.screen;
      const surface = surfaceOf(track.getSettings().displaySurface) ?? choice.surface;
      const label = shareLabel(track, surface);
      track.addEventListener('ended', () => { if (this.snap.screen === s) { this.set({ screen: null, screenLabel: null, screenSurface: null }); onEnded(); } });
      this.set({ screen: s, screenLabel: label, screenSurface: surface });
      before?.getTracks().forEach((t) => t.stop());
      mlog.info('screen sharing started', { surface, asked: choice.surface, audio: s.getAudioTracks().length > 0, swapped: Boolean(before) });
      return label;
    } catch (e) {
      // Cancelling the picker is a NotAllowedError; anything else is worth knowing about.
      mlog.at(e instanceof DOMException && e.name === 'NotAllowedError' ? 'debug' : 'warn', 'screen sharing not started', { err: e, asked: choice.surface });
      return false;
    }
  }
  stopScreen() { this.snap.screen?.getTracks().forEach((t) => t.stop()); this.set({ screen: null, screenLabel: null, screenSurface: null }); }
  /** A short chime through the chosen speaker (where the browser lets a page choose), so you know you'll hear people. */
  async playTestSound(): Promise<void> {
    const ctx = new AudioContext();
    try {
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      osc.connect(gain).connect(dest);
      const audio = new Audio();
      audio.srcObject = dest.stream;
      if (this.snap.speakerId && canChooseSpeaker()) await audio.setSinkId(this.snap.speakerId).catch((e: unknown) => mlog.warn('could not play through the chosen speaker', { err: e }));
      await audio.play();
      osc.start();
      osc.stop(ctx.currentTime + 1);
      await new Promise((r) => setTimeout(r, 1100));
      audio.pause();
    } catch (e) {
      mlog.warn('the test sound could not play', { err: e });
    } finally {
      void ctx.close().catch(() => undefined);
    }
  }
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
    this.source?.disconnect();
    this.source = null;
    if (!this.audio) return;
    if (!this.ctx || !this.analyser) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    }
    this.source = this.ctx.createMediaStreamSource(new MediaStream([this.audio]));
    this.source.connect(this.analyser);
  }
  stop() {
    this.begun = false;
    this.gen++;
    this.stopWatching?.();
    this.stopWatching = null;
    if (this.soon) clearTimeout(this.soon);
    this.soon = null;
    for (const t of [this.audio, this.video]) { t?.removeEventListener('ended', this.onEnded); t?.stop(); }
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
  /** Bumped by discard(): pieces recorded before it, and any still waiting to go, are never sent. */
  private gen = 0;
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
    const gen = this.gen;
    rec.addEventListener('dataavailable', (e) => {
      if (!e.data.size || gen !== this.gen) return;
      const now = performance.now();
      const p: AudioPiece = { data: e.data, segment, seq: seq++, durationMs: Math.max(0, now - last), mimeType };
      last = now;
      this.queue = this.queue.then(() => (gen === this.gen ? this.send(p, gen) : undefined));
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
  /** Notes were paused: stops at once, and nothing recorded but not yet sent goes. The server refuses it anyway. */
  discard() {
    this.gen++;
    void this.finish();
  }
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
  private async send(p: AudioPiece, gen: number) {
    for (let attempt = 0; attempt < 3 && gen === this.gen; attempt++) {
      try { await this.upload(p); mlog.debug('audio piece uploaded', { segment: p.segment, seq: p.seq, bytes: p.data.size, attempt }); return; } catch (e) {
        // Expected around changes: notes were paused or turned off, or a new segment began. It isn't kept, by design.
        if (errorCode(e) === 'conflict') { mlog.debug('audio piece refused: notes are paused, off or moved on', { segment: p.segment, seq: p.seq, err: e }); return; }
        mlog.at(attempt === 2 ? 'error' : 'warn', attempt === 2 ? 'audio piece lost after 3 attempts' : 'audio piece upload failed; retrying', { err: e, segment: p.segment, seq: p.seq, bytes: p.data.size, attempt });
        if (attempt === 2) this.onError(e instanceof Error ? e.message : 'A piece of the recording couldn’t be saved.');
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
}
