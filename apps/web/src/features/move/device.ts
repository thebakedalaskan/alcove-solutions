/*
 * Moving a call to another device, in the app (docs: Calls and recordings › Moving to another device): what this
 * device is, in the words the other device shows, and the link the code travels in.
 */
import type { MoveDevice } from '@alcove/api';

/** What this device is, roughly, from what the browser says: enough for the person to tell their own phone apart. */
export function thisDevice(): MoveDevice {
  const ua = navigator.userAgent;
  // iPads ask for the desktop site, so they look like a Mac with a touch screen.
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const os: MoveDevice['os'] = /iPhone|iPad|iPod/.test(ua) || touchMac ? 'ios' : /Android/.test(ua) ? 'android' : /CrOS/.test(ua) ? 'chromeos'
    : /Macintosh|Mac OS X/.test(ua) ? 'macos' : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'other';
  const kind: MoveDevice['kind'] = /iPad/.test(ua) || touchMac || (os === 'android' && !/Mobile/.test(ua)) ? 'tablet'
    : os === 'ios' || os === 'android' || /Mobi/.test(ua) ? 'phone' : 'computer';
  const browser: MoveDevice['browser'] = /Edg(?:e|A|iOS)?\//.test(ua) ? 'edge' : /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox|FxiOS/.test(ua) ? 'firefox'
    : /Chrome|CriOS|Chromium/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : 'other';
  return { kind, os, browser };
}

const NAMES: Record<MoveDevice['os'], Record<MoveDevice['kind'], string>> = {
  ios: { phone: 'iPhone', tablet: 'iPad', computer: 'iPad' },
  android: { phone: 'Android phone', tablet: 'Android tablet', computer: 'Android device' },
  macos: { phone: 'Mac', tablet: 'Mac', computer: 'Mac' },
  windows: { phone: 'Windows PC', tablet: 'Windows tablet', computer: 'Windows PC' },
  linux: { phone: 'Linux computer', tablet: 'Linux computer', computer: 'Linux computer' },
  chromeos: { phone: 'Chromebook', tablet: 'Chromebook', computer: 'Chromebook' },
  other: { phone: 'phone', tablet: 'tablet', computer: 'computer' }
};
const BROWSERS: Record<MoveDevice['browser'], string | null> = { safari: 'Safari', chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge', samsung: 'Samsung Internet', other: null };

/** "iPhone", "Windows PC": what to call the device in a sentence. */
export const deviceName = (d: MoveDevice): string => NAMES[d.os][d.kind];
/** "iPhone · Safari", to tell one device from another. */
export const deviceLabel = (d: MoveDevice): string => [deviceName(d), BROWSERS[d.browser]].filter(Boolean).join(' · ');
/** "your iPhone", or "the other device" when it says nothing useful. */
export const yourDevice = (d: MoveDevice | null): string => (d && d.os !== 'other' ? `your ${deviceName(d)}` : 'the other device');

/** The new device's link. The code goes after `#`, which browsers never send to any server. */
export const moveLink = (code: string): string => `${location.origin}/move#${code}`;
/** The same link as people read it, without the scheme. */
export const shortLink = (code: string): string => `${location.host}/move#${code}`;
