/*
 * Keeps this build of Alcove in the browser, so the app opens without a connection, and handles clicks on its
 * browser notifications. The app registers it in production builds (apps/web/src/lib/serviceWorker.ts).
 *
 * - Install: caches every file the build emitted: the shell (index.html, asked for as /, since Cloudflare
 *   Pages redirects /index.html there) and the assets. scripts/precache.mjs writes the list in after
 *   `vite build`. If any file doesn't arrive, nothing is cached, the install fails and the worker before this
 *   one stays. HTML under any name but the shell's hasn't arrived: Pages answers a name it doesn't have with
 *   the shell, as a 200, so a deploy going live mid-install must not leave that cached as the asset.
 * - Page loads: the network first, then the cached shell, which opens whichever screen was asked for.
 *   Nothing fetched is written back, so the shell always matches the assets cached with it.
 * - Hashed assets (/assets/): the cache first. A new name means new content.
 * - The build's other files (the favicon, the audio worklet, portraits): the network first, then the cache.
 * - /api, every other origin (the API's included) and anything but GET go straight to the network: nothing
 *   from the API is ever cached or answered from the cache.
 * - A new version takes over as soon as it has everything, and deletes the caches of the versions before it.
 * - A click on a notification (shown by apps/web/src/features/notifications/delivery.ts) brings a window forward and
 *   tells it where the notification leads. The page goes there itself, so leaving a call or a recording still asks first.
 *   A ring leads nowhere: its card is on whatever page is open, so the account's last-used window comes forward as it is.
 */

// Written by scripts/precache.mjs after the build: a hash of the build's files, and their paths.
const BUILD = { version: '', files: [] };
const PREFIX = 'alcove-app-';
const CACHE = `${PREFIX}${BUILD.version}`;
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const files = await Promise.all(BUILD.files.map(arrived));
    const cache = await caches.open(CACHE);
    await Promise.all(files.map(({ path, response }) => cache.put(path, response)));
    await self.skipWaiting();
  })());
});

/** One file of this build, as itself. Hashed assets may come from the HTTP cache; the rest are checked with the server. */
async function arrived(path) {
  const response = await fetch(new Request(path, { cache: path.startsWith('/assets/') ? 'default' : 'no-cache' }));
  const html = (response.headers.get('content-type') ?? '').includes('text/html');
  if (!response.ok || html !== (path === SHELL)) throw new Error(`${path} didn't arrive as itself: ${response.status}`);
  return { path, response };
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
    // Page loads start while the worker wakes up, instead of after.
    await self.registration.navigationPreload?.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') event.respondWith(page(event));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(open(event.notification.data));
});

/** The page a notification leads to: `open` is the app's NotificationOpenSchema. */
function pathOf(open) {
  if (open?.to === 'call') return `/join/${encodeURIComponent(open.code)}`;
  if (open?.to === 'note') return `/calls/${encodeURIComponent(open.noteId)}`;
  if (open?.to === 'document') return `/drive/${encodeURIComponent(open.workspaceId)}/${encodeURIComponent(open.documentId)}${open.block ? `#${encodeURIComponent(open.block)}` : ''}`;
  if (open?.to === 'plan') return '/settings';
  return open?.to === 'notes' ? '/calls' : '/home';
}

/** A window reports opaque account/connection IDs, never content or access credentials. */
function whereIs(win) {
  const fallback = { path: new URL(win.url).pathname, ownerId: undefined, calls: [] };
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    let done = false;
    const finish = (value) => { if (done) return; done = true; clearTimeout(timeout); port1.close(); resolve(value); };
    const timeout = setTimeout(() => finish(fallback), 500);
    port1.onmessage = (event) => {
      const value = event.data;
      finish(value && typeof value.path === 'string' && (value.ownerId === null || typeof value.ownerId === 'string') && Array.isArray(value.calls) ? value : fallback);
    };
    try { win.postMessage({ type: 'alcove.where' }, [port2]); } catch { finish(fallback); }
  });
}

// The click event stays alive until a newly opened app has installed its validated navigation listener. No intent is
// written into a URL or storage. An unavailable original call connection is explained by the app after session checks.
const pending = new Map();
const ready = new Map();
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'alcove.ready' || !event.source?.id || new URL(event.source.url).origin !== self.location.origin) return;
  const id = event.source.id;
  ready.set(id, Date.now());
  for (const [key, at] of ready) if (Date.now() - at > 30_000) ready.delete(key);
  pending.get(id)?.(true);
});
function handoff(win, data) {
  const message = { type: 'alcove.notification', open: data.open, ownerId: data.ownerId };
  if (ready.has(win.id)) { win.postMessage(message); return Promise.resolve(); }
  return new Promise((resolve) => {
    let done = false;
    const finish = (send) => {
      if (done) return;
      done = true; clearTimeout(timeout); if (pending.get(win.id) === finish) pending.delete(win.id);
      if (send) win.postMessage(message);
      resolve();
    };
    const timeout = setTimeout(() => finish(false), 10_000);
    pending.get(win.id)?.(false);
    pending.set(win.id, finish);
  });
}

/** Prefer the original live connection, then the same account at the destination, then its last-used window. */
async function open(data) {
  if (data?.v !== 1 || !data.open || (data.ownerId !== null && typeof data.ownerId !== 'string')) return;
  const where = data.open;
  const path = pathOf(where);
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const at = await Promise.all(windows.map(whereIs));
  const account = (value) => value.ownerId === data.ownerId;
  const original = where.to === 'call' ? where.event : null;
  const exact = original ? at.findIndex((value) => account(value) && value.calls.some((call) => call?.callId === original.callId && call?.identity === original.connection)) : -1;
  const paths = where.to === 'call' ? [`/call/${encodeURIComponent(where.code)}`, path] : where.to === 'ring' ? [] : [path];
  const destination = at.findIndex((value) => account(value) && paths.includes(value.path));
  const sameAccount = at.findIndex(account);
  const win = windows[exact >= 0 ? exact : destination >= 0 ? destination : sameAccount];
  if (!win) {
    // Start on an unprotected destination; the page rechecks the current account before following the pending intent.
    const opened = await self.clients.openWindow('/home');
    if (opened) await handoff(opened, data);
    return;
  }
  await win.focus().catch(() => undefined);
  win.postMessage({ type: 'alcove.notification', open: where, ownerId: data.ownerId });
}

async function page(event) {
  try {
    return (await event.preloadResponse) ?? (await fetch(event.request));
  } catch {
    return (await caches.match(SHELL, { cacheName: CACHE })) ?? Response.error();
  }
}

async function cacheFirst(request) {
  return (await caches.match(request, { cacheName: CACHE })) ?? fetch(request);
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request, { cacheName: CACHE })) ?? Response.error();
  }
}
