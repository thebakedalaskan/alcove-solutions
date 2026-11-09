/*
 * The browser as a story finds it. The preview installs this once, before any story, and each story says what it needs
 * (`browser` in a scenario or a story's parameters, and the toolbar's Connection):
 *
 *   - a connection that's there or not: navigator.onLine, with the online and offline events when it changes
 *   - a camera, a microphone and a screen to share that are never real: getUserMedia and getDisplayMedia hand back drawn
 *     and synthesised tracks, enumerateDevices lists made-up devices, and the browser says they're allowed (or not)
 *   - notifications that go nowhere: Notification asks and shows, and what it showed is kept in `shown`
 *   - floating calls use native Document PiP unless a story explicitly shows an unsupported or refused opening
 *   - no service worker: the app's registration never happens, so nothing is cached between stories
 *   - a page that goes when the story does: recorders and audio it started stop when the next story opens
 */
import { onlineManager } from '@tanstack/react-query';

export interface BrowserSetup {
  /** Whether there's a connection. */
  online: boolean;
  /** Whether the browser lets Alcove use the camera and microphone: allowed, not asked yet, or blocked. */
  devices: PermissionState;
  /** What the browser allows for notifications now, and what it answers when Alcove asks. */
  notifications: NotificationPermission;
  answer: NotificationPermission;
  /** Native floating windows by default; failure stories never open a window. */
  floatingWindow: 'native' | 'unsupported' | 'blocked';
}
export const DEFAULT_BROWSER: BrowserSetup = { online: true, devices: 'granted', notifications: 'default', answer: 'granted', floatingWindow: 'native' };

const state: BrowserSetup = { ...DEFAULT_BROWSER };
const nativePictureInPicture = window.documentPictureInPicture;
/** Only a refusal is scripted. A successful window always belongs to the real browser. */
class BlockedPictureInPicture extends EventTarget implements DocumentPictureInPicture {
  readonly window = null;
  requestWindow(): Promise<Window> { return Promise.reject(new DOMException('Picture-in-picture is blocked for this story.', 'NotAllowedError')); }
}
const blockedPictureInPicture = new BlockedPictureInPicture();
/** The notifications shown since the story started, oldest first. */
export const shown: { title: string; body: string }[] = [];

/**
 * A story starts: the browser as `setup` says, as if the page had just opened. A page opened without a connection hears no
 * offline event, so nothing is dispatched; the query layer starts out thinking it's online, as it does in a real tab.
 */
export function openBrowser(setup: Partial<BrowserSetup>): void {
  closePage();
  Object.assign(state, DEFAULT_BROWSER, setup);
  shown.length = 0;
  onlineManager.setOnline(true);
  talking(true);
}

/** The connection comes or goes while the story is open, with the event the browser sends. */
export function setOnline(online: boolean): void {
  if (state.online === online) return;
  state.online = online;
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}
export const isOnline = (): boolean => state.online;

/* ---------- made-up devices ---------- */

interface Made { kind: MediaDeviceKind; id: string; label: string }
const DEVICES: readonly Made[] = [
  { kind: 'audioinput', id: 'default', label: 'Default - Built-in microphone' },
  { kind: 'audioinput', id: 'mic-built-in', label: 'Built-in microphone' },
  { kind: 'audioinput', id: 'mic-desk', label: 'Desk microphone' },
  { kind: 'audioinput', id: 'mic-headset', label: 'Headset microphone' },
  { kind: 'videoinput', id: 'cam-built-in', label: 'Built-in camera' },
  { kind: 'videoinput', id: 'cam-desk', label: 'Desk camera' },
  { kind: 'audiooutput', id: 'default', label: 'Default - Built-in speakers' },
  { kind: 'audiooutput', id: 'speaker-built-in', label: 'Built-in speakers' },
  { kind: 'audiooutput', id: 'speaker-headset', label: 'Headset' }
];

/** Which device a constraint asks for, by its ID, or the first of its kind. */
function chosen(kind: MediaDeviceKind, c: boolean | MediaTrackConstraints | undefined): Made {
  const want = typeof c === 'object' ? c.deviceId : undefined;
  const ids = typeof want === 'string' ? [want] : Array.isArray(want) ? want : typeof want === 'object' ? [want.exact, want.ideal].flat().filter((x) => typeof x === 'string') : [];
  const all = DEVICES.filter((d) => d.kind === kind && d.id !== 'default');
  return all.find((d) => ids.includes(d.id)) ?? all[0] ?? { kind, id: kind, label: kind };
}

/** A track that says it's from `device`, as a real one would. */
function as(track: MediaStreamTrack, device: Made): MediaStreamTrack {
  const settings = track.getSettings.bind(track);
  track.getSettings = () => ({ ...settings(), deviceId: device.id, groupId: device.id });
  Object.defineProperty(track, 'label', { configurable: true, value: device.label });
  return track;
}

/** The browser's own AudioContext, for the made-up devices: what a story's page makes is stopped when the next story opens (below). */
const RealAudioContext = AudioContext;
let audio: AudioContext | null = null;
/** Sound the browser holds back until the page is used: a click anywhere in a story lets it play. */
function audioContext(): AudioContext {
  if (audio) return audio;
  const ctx = new RealAudioContext();
  audio = ctx;
  addEventListener('pointerdown', () => { void ctx.resume(); }, { capture: true });
  return ctx;
}

/** The made-up microphones open now, and whether they murmur as a voice does or stay quiet, as while you listen. */
const voices = new Set<{ level: GainNode; depth: GainNode }>();
let loud = true;
const tune = (v: { level: GainNode; depth: GainNode }) => { v.level.gain.value = loud ? 0.05 : 0.012; v.depth.gain.value = loud ? 0.045 : 0.008; };
/**
 * Whether you're talking: the microphone murmurs (its meters move, and a call hears you speaking), or it's quiet, as
 * while you listen. A scripted call keeps it quiet except while you say your lines; every story starts talking.
 */
export function talking(on: boolean): void {
  loud = on;
  for (const v of voices) tune(v);
}

/** A microphone that hears a low murmur, rising and falling, so meters move the way a voice moves them. Nothing plays it aloud. */
function microphone(device: Made): MediaStreamTrack {
  const ctx = audioContext();
  const out = ctx.createMediaStreamDestination();
  const voice = ctx.createOscillator();
  voice.frequency.value = 170;
  const level = ctx.createGain();
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.6;
  const depth = ctx.createGain();
  const tuned = { level, depth };
  voices.add(tuned);
  tune(tuned);
  breath.connect(depth).connect(level.gain);
  voice.connect(level).connect(out);
  voice.start();
  breath.start();
  const track = out.stream.getAudioTracks()[0];
  if (!track) throw new DOMException('The microphone didn’t start.', 'NotReadableError');
  const quiet = () => { voices.delete(tuned); voice.stop(); breath.stop(); };
  track.addEventListener('ended', quiet);
  const stop = track.stop.bind(track);
  track.stop = () => { quiet(); stop(); };
  return as(track, device);
}

/** A picture drawn a few times a second, as a camera or a shared screen would send it. */
function drawn(width: number, height: number, draw: (g: CanvasRenderingContext2D, t: number) => void, device: Made): MediaStreamTrack {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) throw new DOMException('The camera didn’t start.', 'NotReadableError');
  const started = performance.now();
  draw(g, 0);
  const track = canvas.captureStream(8).getVideoTracks()[0];
  if (!track) throw new DOMException('The camera didn’t start.', 'NotReadableError');
  const timer = setInterval(() => draw(g, (performance.now() - started) / 1000), 250);
  track.addEventListener('ended', () => clearInterval(timer));
  const stop = track.stop.bind(track);
  track.stop = () => { clearInterval(timer); stop(); };
  return as(track, device);
}

/* A camera looking at a dim room, the light shifting a little: never anyone's face. */
const room = (g: CanvasRenderingContext2D, t: number) => {
  const { width: w, height: h } = g.canvas;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1F2B42');
  sky.addColorStop(1, '#060D1A');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const lamp = g.createRadialGradient(w * (0.7 + Math.sin(t / 3) * 0.02), h * 0.3, 10, w * 0.7, h * 0.3, w * 0.6);
  lamp.addColorStop(0, 'rgba(243, 201, 146, 0.35)');
  lamp.addColorStop(1, 'rgba(243, 201, 146, 0)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, w, h);
};
/* A shared screen: a slide with a heading and a few lines. */
const slide = (g: CanvasRenderingContext2D) => {
  const { width: w, height: h } = g.canvas;
  g.fillStyle = '#FCFDFE';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#12223F';
  g.font = '600 56px system-ui, sans-serif';
  g.fillText('Launch checklist', 96, 150);
  g.fillStyle = '#55667F';
  g.font = '400 30px system-ui, sans-serif';
  ['Help article for support', 'Flag in the rollout plan', 'Empty state on the team page'].forEach((line, i) => g.fillText(`·  ${line}`, 96, 250 + i * 64));
};

async function getUserMedia(c?: MediaStreamConstraints): Promise<MediaStream> {
  if (state.devices === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
  state.devices = 'granted';
  const stream = new MediaStream();
  if (c?.audio) stream.addTrack(microphone(chosen('audioinput', c.audio)));
  if (c?.video) stream.addTrack(drawn(1280, 720, room, chosen('videoinput', c.video)));
  return stream;
}
/** What the browser's picker shares: the drawn slide, as the kind of thing asked for, with its sound (silence) when that's asked for too. */
async function getDisplayMedia(o?: DisplayMediaStreamOptions): Promise<MediaStream> {
  const video = drawn(1920, 1080, slide, { kind: 'videoinput', id: 'screen', label: 'screen:0:0' });
  const asked = typeof o?.video === 'object' ? o.video.displaySurface : undefined;
  if (typeof asked === 'string') {
    const settings = video.getSettings.bind(video);
    video.getSettings = () => ({ ...settings(), displaySurface: asked });
  }
  const sound = o?.audio ? audioContext().createMediaStreamDestination().stream.getAudioTracks()[0] : undefined;
  return new MediaStream(sound ? [video, sound] : [video]);
}
/**
 * What's plugged in. Like a real browser, it says which devices there are only once the camera or microphone has been
 * allowed: until then, one of each kind, with no ID and no name.
 */
async function enumerateDevices(): Promise<MediaDeviceInfo[]> {
  const allowed = state.devices === 'granted';
  const listed = allowed ? DEVICES : DEVICES.filter((d, i) => DEVICES.findIndex((o) => o.kind === d.kind) === i);
  return listed.map((d) => {
    const info = { deviceId: allowed ? d.id : '', groupId: allowed ? d.id : '', kind: d.kind, label: allowed ? d.label : '' };
    return { ...info, toJSON: () => info };
  });
}

class StubPermission extends EventTarget implements PermissionStatus {
  onchange: PermissionStatus['onchange'] = null;
  constructor(readonly name: string, readonly state: PermissionState) { super(); }
}

/* ---------- notifications ---------- */

class StubNotification extends EventTarget {
  static get permission(): NotificationPermission { return state.notifications; }
  static requestPermission(): Promise<NotificationPermission> {
    state.notifications = state.answer;
    return Promise.resolve(state.answer);
  }
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onshow: (() => void) | null = null;
  readonly body: string;
  readonly tag: string;
  constructor(readonly title: string, options: NotificationOptions = {}) {
    super();
    this.body = options.body ?? '';
    this.tag = options.tag ?? '';
    shown.push({ title, body: this.body });
  }
  close(): void { this.dispatchEvent(new Event('close')); }
}

/* ---------- what a page leaves running ---------- */

/**
 * Recorders and audio the story's page started (a call's notes recorder, a recording's): a page that goes away stops
 * them, so the next story starts quiet, as a page opened afresh would.
 */
const leftRunning = new Set<() => void>();
class PageRecorder extends MediaRecorder {
  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    super(stream, options);
    leftRunning.add(() => { if (this.state !== 'inactive') this.stop(); });
  }
}
class PageAudio extends RealAudioContext {
  constructor(options?: AudioContextOptions) {
    super(options);
    leftRunning.add(() => { if (this.state !== 'closed') void this.close().catch(() => undefined); });
  }
}
/** The last story's page has gone: what it left recording or playing stops. */
function closePage(): void {
  for (const stop of leftRunning) stop();
  leftRunning.clear();
}

let installed = false;
/** Puts the stand-ins in place. Once, before any story renders. */
export function installBrowser(): void {
  if (installed) return;
  installed = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => state.online });
  Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, get: () => state.floatingWindow === 'unsupported' ? undefined : state.floatingWindow === 'blocked' ? blockedPictureInPicture : nativePictureInPicture });

  const media = navigator.mediaDevices;
  media.getUserMedia = getUserMedia;
  media.getDisplayMedia = getDisplayMedia;
  media.enumerateDevices = enumerateDevices;

  const permissions = navigator.permissions;
  const query = permissions.query.bind(permissions);
  permissions.query = (d) => {
    if (d.name === 'camera' || d.name === 'microphone') return Promise.resolve(new StubPermission(d.name, state.devices));
    if (d.name === 'notifications') return Promise.resolve(new StubPermission(d.name, state.notifications === 'default' ? 'prompt' : state.notifications));
    return query(d);
  };

  Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: StubNotification });
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: PageRecorder });
  Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: PageAudio });

  const workers = navigator.serviceWorker;
  workers.register = () => new Promise<ServiceWorkerRegistration>(() => undefined);
  workers.getRegistration = () => Promise.resolve(undefined);
}
