/*
 * Microphones, cameras and speakers: which are plugged in, whether the browser lets Alcove use them, which ones
 * someone chose (remembered in this browser only, never sent anywhere), and a short microphone test that records a
 * few seconds, plays them back and keeps nothing.
 */
import { DevicePrefsSchema, type DevicePrefs } from '@alcove/api';
import { useEffect, useState } from 'react';
import { log } from '~/lib/log';

const dlog = log.child({ component: 'devices' });

export type DeviceKind = 'mic' | 'cam' | 'speaker';
const BROWSER_KIND: Record<DeviceKind, MediaDeviceKind> = { mic: 'audioinput', cam: 'videoinput', speaker: 'audiooutput' };

/* ---------- remembered choices ---------- */

const KEY = 'alcove.devices';

/** The devices chosen in this browser before; anything unreadable counts as no choice. */
export function readPrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const r = DevicePrefsSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : {};
  } catch {
    return {};
  }
}
export function rememberDevice<K extends keyof DevicePrefs>(kind: K, value: DevicePrefs[K]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), [kind]: value }));
  } catch (e) {
    dlog.debug('device choice not remembered', { err: e, kind });
  }
}

/* ---------- whether the browser lets Alcove use them ---------- */

/** A microphone or a camera: the two things the browser asks about. */
export type Capture = 'mic' | 'cam';
/** The browser's answer: allowed, refused, or not asked yet. `unknown` where it won't say. */
export type Permission = PermissionState | 'unknown';
const PERMISSION: Record<Capture, PermissionName> = { mic: 'microphone', cam: 'camera' };

async function permissionStatus(kind: Capture): Promise<PermissionStatus | null> {
  try {
    return (await navigator.permissions?.query({ name: PERMISSION[kind] })) ?? null;
  } catch {
    // Browsers that can't be asked about a camera or microphone throw; the device itself still says.
    return null;
  }
}
/** What the browser says now about the microphone and the camera, where it says. */
export async function permissions(): Promise<Record<Capture, Permission>> {
  const [mic, cam] = await Promise.all([permissionStatus('mic'), permissionStatus('cam')]);
  return { mic: mic?.state ?? 'unknown', cam: cam?.state ?? 'unknown' };
}
/** Calls `onChange` when someone allows or blocks the microphone or camera in the browser's settings. */
export function watchPermissions(onChange: () => void): () => void {
  let alive = true;
  const held: PermissionStatus[] = [];
  void Promise.all([permissionStatus('mic'), permissionStatus('cam')]).then((all) => {
    for (const s of all) {
      if (!s || !alive) continue;
      s.addEventListener('change', onChange);
      held.push(s);
    }
  });
  return () => { alive = false; for (const s of held) s.removeEventListener('change', onChange); };
}

type Family = 'chromium' | 'safari' | 'ios' | 'firefox';
/** Only to say where this browser keeps its settings: nothing else changes by browser. */
function family(): Family {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'safari';
  return 'chromium';
}
const named = (kinds: Capture[]) => (kinds.includes('mic') && kinds.includes('cam') ? 'camera and microphone' : kinds.includes('cam') ? 'camera' : 'microphone');

/** Where this browser lets someone allow the microphone or camera again, in a sentence. */
export function howToAllow(kinds: Capture[]): string {
  const what = named(kinds);
  switch (family()) {
    case 'firefox': return `Click the crossed-out ${kinds.includes('cam') ? 'camera' : 'microphone'} at the left of the address bar, clear the block, then try again.`;
    case 'safari': return `In the Safari menu, choose Settings for This Website and set the ${what} to Allow, then try again.`;
    case 'ios': return `Tap the page menu in the address bar, choose Website Settings and allow the ${what}, then try again.`;
    default: return `Click the icon at the left of the address bar, turn on the ${what}, then try again.`;
  }
}
/** Where to allow a device when the computer, not the browser, is keeping the browser from it. */
export function howToAllowSystem(kinds: Capture[]): string {
  const what = named(kinds);
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Macintosh/.test(ua)) return `Turn on the ${what} for your browser in System Settings › Privacy & Security, then reopen the browser.`;
  if (/Windows/.test(ua)) return `Allow the ${what} for your browser in Settings › Privacy & security, then try again.`;
  return `Allow the ${what} for your browser in your computer’s privacy settings, then try again.`;
}

/* ---------- what's plugged in ---------- */

export interface Device { id: string; label: string }
export type Devices = Record<DeviceKind, Device[]>;
const NONE: Devices = { mic: [], cam: [], speaker: [] };

/**
 * Where a page can choose the speaker: media elements' setSinkId (Chrome, Edge, Firefox). LiveKit, which plays the
 * call, won't on Safari (its WebRTC audio ignores the choice there), so Safari plays calls through the system's output.
 */
export const canChooseSpeaker = (): boolean => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype && family() !== 'safari' && family() !== 'ios';

/** Everything the browser lists now (names only once a microphone or camera has been allowed). */
export async function enumerate(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return navigator.mediaDevices.enumerateDevices();
}
/** A device's name as people know it: without the "Default - " Chrome puts in front or the USB IDs it adds. */
export const plainName = (label: string): string => label.replace(/^(Default|Communications) - /, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '').trim();

async function list(): Promise<Devices> {
  const all = await enumerate();
  const of = (kind: DeviceKind): Device[] => {
    const seen = new Set<string>();
    return all.filter((d) => d.kind === BROWSER_KIND[kind] && d.deviceId && !seen.has(d.deviceId) && seen.add(d.deviceId))
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === 'mic' ? 'Microphone' : kind === 'cam' ? 'Camera' : 'Speaker'} ${i + 1}` }));
  };
  return { mic: of('mic'), cam: of('cam'), speaker: canChooseSpeaker() ? of('speaker') : [] };
}

/**
 * Devices plugged in now, kept up to date as they come and go. Browsers only name them once the
 * microphone or camera has been allowed, so the list is read again when `since` changes.
 */
export function useDevices(since: unknown): Devices {
  const [devices, setDevices] = useState<Devices>(NONE);
  useEffect(() => {
    let alive = true;
    const read = () => { list().then((d) => { if (alive) setDevices(d); }, (e: unknown) => dlog.warn('could not list devices', { err: e })); };
    read();
    navigator.mediaDevices?.addEventListener('devicechange', read);
    return () => { alive = false; navigator.mediaDevices?.removeEventListener('devicechange', read); };
  }, [since]);
  return devices;
}

/* ---------- the microphone test ---------- */

export type TestPhase = 'idle' | 'listening' | 'playing';
export const TEST_SECONDS = 3;
/** Where a microphone test has got to: not running, listening (with whole seconds left), or playing it back. */
export interface MicTestState { phase: TestPhase; left: number }

/**
 * Records a few seconds from the microphone and plays them straight back, through the chosen speaker where the browser
 * allows it. Nothing is uploaded or kept: the recording lives in memory until it has played. One test at a time for each
 * microphone (micTestOf), so a menu that closes and opens again still shows where its test has got to.
 */
export class MicTest {
  private snap: MicTestState = { phase: 'idle', left: TEST_SECONDS };
  private listeners = new Set<() => void>();
  getSnapshot = (): MicTestState => this.snap;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<MicTestState>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach((l) => l()); }

  async run(track: MediaStreamTrack, speaker: string | undefined): Promise<void> {
    if (this.snap.phase !== 'idle') return;
    this.set({ phase: 'listening', left: TEST_SECONDS });
    const tick = setInterval(() => this.set({ left: Math.max(1, this.snap.left - 1) }), 1000);
    const chunks: Blob[] = [];
    let url: string | null = null;
    try {
      const rec = new MediaRecorder(new MediaStream([track]));
      rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
      const stopped = new Promise<void>((resolve) => rec.addEventListener('stop', () => resolve(), { once: true }));
      rec.start();
      await new Promise((r) => setTimeout(r, TEST_SECONDS * 1000));
      // The microphone may have gone meanwhile (unplugged, or another chosen), which stops the recorder by itself.
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      clearInterval(tick);
      url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
      const audio = new Audio(url);
      if (speaker && canChooseSpeaker()) await audio.setSinkId(speaker).catch((e: unknown) => dlog.warn('could not play through the chosen speaker', { err: e }));
      this.set({ phase: 'playing' });
      await new Promise<void>((resolve) => {
        audio.addEventListener('ended', () => resolve(), { once: true });
        audio.addEventListener('error', () => resolve(), { once: true });
        audio.play().catch((e: unknown) => { dlog.warn('the microphone test could not play', { err: e }); resolve(); });
      });
    } catch (e) {
      dlog.warn('the microphone test failed', { err: e });
    } finally {
      clearInterval(tick);
      if (url) URL.revokeObjectURL(url);
      chunks.length = 0;
      this.set({ phase: 'idle', left: TEST_SECONDS });
    }
  }
}

const tests = new WeakMap<object, MicTest>();
/** The test for the microphone `owner` holds (its LocalMedia): the same one wherever a menu asks for it. */
export function micTestOf(owner: object): MicTest {
  const known = tests.get(owner);
  if (known) return known;
  const made = new MicTest();
  tests.set(owner, made);
  return made;
}
