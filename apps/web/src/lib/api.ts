/**
 * The one place the app decides which backend it talks to. Everything else imports `api` and only
 * sees the AlcoveApi contract from @alcove/api. In development Vite proxies /api to the local server.
 */
import type { AlcoveApi } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';

function deviceName(): string {
  if (typeof navigator === 'undefined') return 'This device';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'device';
  return `${browser} on ${os}`;
}

export const api: AlcoveApi = createHttpApi({ baseUrl: import.meta.env.VITE_ALCOVE_API_URL ?? '/api', deviceName });
