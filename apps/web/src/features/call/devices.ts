/*
 * Microphones, cameras and speakers: which are plugged in, which ones someone chose (remembered in
 * this browser only, never sent anywhere), and a short microphone test that records a few seconds,
 * plays them back and keeps nothing.
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

/* ---------- what's plugged in ---------- */

export interface Device { id: string; label: string }
export type Devices = Record<DeviceKind, Device[]>;
const NONE: Devices = { mic: [], cam: [], speaker: [] };

/** Choosing where sound plays is possible in Chrome, Edge and Firefox; Safari plays through the system's choice. */
export const canChooseSpeaker = (): boolean => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

async function list(): Promise<Devices> {
  if (!navigator.mediaDevices?.enumerateDevices) return NONE;
  const all = await navigator.mediaDevices.enumerateDevices();
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

/**
 * Records a few seconds from the microphone and plays them straight back, through the chosen
 * speaker where the browser allows it. Nothing is uploaded or kept: the recording lives in memory
 * until it has played.
 */
export async function testMicrophone(track: MediaStreamTrack, speaker: string | undefined, onPhase: (p: TestPhase) => void): Promise<void> {
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(new MediaStream([track]));
  rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  const stopped = new Promise<void>((resolve) => rec.addEventListener('stop', () => resolve(), { once: true }));
  onPhase('listening');
  rec.start();
  await new Promise((r) => setTimeout(r, TEST_SECONDS * 1000));
  rec.stop();
  await stopped;
  const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
  try {
    const audio = new Audio(url);
    if (speaker && canChooseSpeaker()) await audio.setSinkId(speaker).catch((e: unknown) => dlog.warn('could not play through the chosen speaker', { err: e }));
    onPhase('playing');
    await new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
      audio.play().catch((e: unknown) => { dlog.warn('the microphone test could not play', { err: e }); resolve(); });
    });
  } finally {
    URL.revokeObjectURL(url);
    onPhase('idle');
  }
}
