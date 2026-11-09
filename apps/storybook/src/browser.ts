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
  /** Native permission/OS checks are explicit stories; all camera/microphone tracks stay synthetic. */
  notificationTransport: 'scripted' | 'native' | 'unsupported' | 'failed';
  /** Native floating windows by default; failure stories never open a window. */
  floatingWindow: 'native' | 'unsupported' | 'blocked';
}
export const DEFAULT_BROWSER: BrowserSetup = { online: true, devices: 'granted', notifications: 'default', answer: 'granted', notificationTransport: 'scripted', floatingWindow: 'native' };

const state: BrowserSetup = { ...DEFAULT_BROWSER };
const NativeNotification = window.Notification;
const nativeNotifications = new Set<Notification>();
const nativeWorkers = 'serviceWorker' in navigator ? { register: navigator.serviceWorker.register.bind(navigator.serviceWorker), getRegistration: navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker) } : null;
let notificationWorker: ServiceWorkerRegistration | null = null;
const nativePictureInPicture = window.documentPictureInPicture;
/** Only a refusal is scripted. A successful window always belongs to the real browser. */
class BlockedPictureInPicture extends EventTarget implements DocumentPictureInPicture {
  readonly window = null;
  requestWindow(): Promise<Window> { return Promise.reject(new DOMException('Picture-in-picture is blocked for this story.', 'NotAllowedError')); }
}
const blockedPictureInPicture = new BlockedPictureInPicture();
/** The notifications shown since the story started, oldest first. */
export const shown: { title: string; body: string; tag: string; silent: boolean | null; data: unknown; closed: boolean; delivery: 'created' | 'shown' | 'accepted' | 'error'; transport: 'scripted' | 'native' | 'worker' }[] = [];
const scriptedNotifications = new Set<StubNotification>();
const notificationClicks = new Map<(typeof shown)[number], () => void>();
export function openShownNotification(index: number): void { const row = shown[index]; if (row) notificationClicks.get(row)?.(); }

/**
 * A story starts: the browser as `setup` says, as if the page had just opened. A page opened without a connection hears no
 * offline event, so nothing is dispatched; the query layer starts out thinking it's online, as it does in a real tab.
 */
export function openBrowser(setup: Partial<BrowserSetup>): void {
  closePage();
  Object.assign(state, DEFAULT_BROWSER, setup);
  shown.length = 0; notificationClicks.clear();
  for (const item of scriptedNotifications) item.close();
  scriptedNotifications.clear();
  for (const item of nativeNotifications) item.close();
  nativeNotifications.clear();
  void stopNotificationWorker();
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
  // A real camera source lives while any clone does. LocalMedia clones before stopping the raw published track when
  // an effect is chosen, so stopping that original must not freeze the synthetic camera feeding the processor.
  const tracks = new Set<MediaStreamTrack>();
  const keep = (t: MediaStreamTrack): MediaStreamTrack => {
    if (t.readyState !== 'live') return as(t, device);
    tracks.add(t);
    const retire = () => { tracks.delete(t); if (tracks.size === 0) clearInterval(timer); };
    const stop = t.stop.bind(t);
    const clone = t.clone.bind(t);
    t.stop = () => { stop(); retire(); };
    t.clone = () => keep(clone());
    t.addEventListener('ended', retire, { once: true });
    return as(t, device);
  };
  return keep(track);
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
  readonly data: unknown;
  private readonly record: (typeof shown)[number];
  constructor(readonly title: string, options: NotificationOptions = {}) {
    super();
    if (state.notificationTransport === 'failed') throw new DOMException('Notifications are blocked in this story.', 'NotAllowedError');
    this.body = options.body ?? '';
    this.tag = options.tag ?? '';
    const data: unknown = options.data; this.data = data;
    this.record = { title, body: this.body, tag: this.tag, silent: options.silent ?? null, data, closed: false, delivery: 'created', transport: 'scripted' };
    for (const item of scriptedNotifications) if (item.tag === this.tag) item.close();
    scriptedNotifications.add(this); shown.push(this.record); notificationClicks.set(this.record, () => this.onclick?.());
  }
  close(): void { if (this.record.closed) return; this.record.closed = true; scriptedNotifications.delete(this); this.onclose?.(); this.dispatchEvent(new Event('close')); }
}

/** An explicit manual-only worker check uses the app's exact worker on this development origin, with no cached files. */
export async function startNotificationWorker(): Promise<void> {
  if (!nativeWorkers || notificationWorker) return;
  const existing = await nativeWorkers.getRegistration();
  if (existing) throw new DOMException('Another worker already uses this development origin.', 'InvalidStateError');
  const registration = await nativeWorkers.register('/sw.js');
  notificationWorker = registration;
  const show = registration.showNotification.bind(registration);
  const list = registration.getNotifications.bind(registration);
  registration.showNotification = async (title, options = {}) => {
    const data: unknown = options.data;
    const record: (typeof shown)[number] = { title, body: options.body ?? '', tag: options.tag ?? '', silent: options.silent ?? null, data, closed: false, delivery: 'created', transport: 'worker' };
    shown.push(record);
    try {
      await show(title, options);
      for (const previous of shown) if (previous !== record && previous.transport === 'worker' && previous.tag === record.tag) previous.closed = true;
      record.delivery = 'accepted';
    }
    catch (error) { record.delivery = 'error'; throw error; }
  };
  registration.getNotifications = async (options) => {
    const items = await list(options);
    for (const item of items) {
      const data: unknown = item.data;
      const record = shown.findLast((record) => record.transport === 'worker' && record.tag === item.tag && JSON.stringify(record.data) === JSON.stringify(data));
      const close = item.close.bind(item);
      item.close = () => { if (record) record.closed = true; close(); };
    }
    return items;
  };
  await navigator.serviceWorker.ready;
}
export async function stopNotificationWorker(): Promise<void> {
  const held = notificationWorker;
  notificationWorker = null;
  if (!held) return;
  for (const item of await held.getNotifications()) item.close();
  await held.unregister();
  for (const item of shown) if (item.transport === 'worker') item.closed = true;
  // The dev worker's BUILD.files is empty, so this cache never contains app or API data.
  await caches.delete('alcove-app-');
}
export const hasNotificationWorker = () => notificationWorker !== null;

/** Calls the real browser constructor and records its public delivery/close events for the manual native story. */
class ObservedNativeNotification extends EventTarget {
  static get permission(): NotificationPermission { return NativeNotification.permission; }
  static requestPermission(): Promise<NotificationPermission> { return NativeNotification.requestPermission(); }
  constructor(title: string, options: NotificationOptions = {}) {
    super();
    const notification = new NativeNotification(title, options);
    nativeNotifications.add(notification);
    const data: unknown = options.data;
    const record: (typeof shown)[number] = { title, body: options.body ?? '', tag: options.tag ?? '', silent: options.silent ?? null, data, closed: false, delivery: 'created', transport: 'native' };
    shown.push(record);
    notificationClicks.set(record, () => notification.dispatchEvent(new Event('click')));
    notification.addEventListener('show', () => { record.delivery = 'shown'; });
    notification.addEventListener('error', () => { record.delivery = 'error'; });
    const stop = notification.close.bind(notification);
    notification.close = () => { record.closed = true; nativeNotifications.delete(notification); stop(); };
    notification.addEventListener('close', () => { record.closed = true; nativeNotifications.delete(notification); });
    return notification;
  }
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
    if (d.name === 'notifications' && state.notificationTransport !== 'native') return Promise.resolve(new StubPermission(d.name, state.notifications === 'default' ? 'prompt' : state.notifications));
    return query(d);
  };

  Object.defineProperty(window, 'Notification', { configurable: true, get: () => state.notificationTransport === 'unsupported' ? undefined : state.notificationTransport === 'native' ? ObservedNativeNotification : StubNotification });
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: PageRecorder });
  Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: PageAudio });

  const workers = navigator.serviceWorker;
  workers.register = () => new Promise<ServiceWorkerRegistration>(() => undefined);
  workers.getRegistration = () => Promise.resolve(notificationWorker ?? undefined);
}
