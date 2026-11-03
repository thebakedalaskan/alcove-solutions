/*
 * Sign-in photos, served by Alcove. A provider's photo URL (Google's lh3.googleusercontent.com) would
 * have every browser that shows someone's face ask Google for it, telling Google who looked at whom
 * and when. Instead the app gets an opaque, stable URL on the API (/v1/photos/<token>); only this
 * server can read the provider URL inside the token, fetches the image itself, and keeps a short-lived
 * copy in memory. Only signed-in people get photos, and only from the hosts in PHOTO_HOSTS.
 */
import type { Config } from '../config';
import type { Deps } from '../context';
import { fromUtf8, openStable, photoTokenKey, sealStable, utf8 } from '../crypto';
import { NotFoundError, UnavailableError } from '../errors';
import { log } from '../log';
import { masterKey } from '../owners';

const plog = log.child({ component: 'photos' });
const LABEL = 'alcove/photo/v1';
const MAX_BYTES = 512 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const KEEP_MS = 60 * 60_000;

/** A provider URL Alcove will fetch: https (http only for a local test server) on an allowed host. */
function allowed(cfg: Config, raw: string): URL | undefined {
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return undefined;
  const hosts = cfg.PHOTO_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u : undefined;
}

/**
 * The URL the app uses for a stored photo: the app's own image (a path like /people/…) as it is, a
 * provider photo through Alcove, and nothing for anything else.
 */
export function photoUrl(d: Deps, stored: string | undefined): string | undefined {
  if (!stored) return undefined;
  if (stored.startsWith('/') && !stored.startsWith('//')) return stored;
  if (!allowed(d.cfg, stored)) return undefined;
  return `${d.cfg.API_URL.replace(/\/$/, '')}/v1/photos/${sealStable(photoTokenKey(masterKey(d)), LABEL, utf8(stored))}`;
}

const kept = new Map<string, { bytes: Uint8Array; type: string; until: number }>();

/** The image a token names: from memory when it was fetched in the last hour, else from the provider. */
export async function photo(d: Deps, token: string): Promise<{ bytes: Uint8Array; type: string }> {
  const hit = kept.get(token);
  if (hit && hit.until > Date.now()) return hit;
  let stored: string;
  try { stored = fromUtf8(openStable(photoTokenKey(masterKey(d)), LABEL, token)); } catch { throw new NotFoundError('That photo isn’t available.', { context: { reason: 'token' } }); }
  const url = allowed(d.cfg, stored);
  if (!url) throw new NotFoundError('That photo isn’t available.', { context: { reason: 'host' } });
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'image/*' } });
  } catch (e) {
    throw new UnavailableError('That photo can’t be fetched right now.', { cause: e, context: { host: url.hostname } });
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ctx = { host: url.hostname, status: res.status, type, ms: Math.round(performance.now() - t0) };
  if (!res.ok || !TYPES.has(type)) { await res.body?.cancel().catch(() => undefined); throw new NotFoundError('That photo isn’t available.', { context: ctx }); }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new NotFoundError('That photo isn’t available.', { context: { ...ctx, bytes: bytes.length } });
  if (kept.size >= 500) kept.clear();
  kept.set(token, { bytes, type, until: Date.now() + KEEP_MS });
  plog.debug('photo fetched for the app', { ...ctx, bytes: bytes.length });
  return { bytes, type };
}
