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
 * - A click on a notification (shown by apps/web/src/features/shell/notify.ts) brings a window forward and tells it
 *   where the notification leads. The page goes there itself, so leaving a call or a recording still asks first.
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
  event.waitUntil(open(event.notification.data?.open));
});

/** The page a notification leads to: `open` is the app's NotificationOpenSchema. */
function pathOf(open) {
  if (open?.to === 'call') return `/join/${encodeURIComponent(open.code)}`;
  if (open?.to === 'note') return `/notes/${encodeURIComponent(open.noteId)}`;
  return open?.to === 'notes' ? '/notes' : '/home';
}

/**
 * Where a window is now, in its own words: its `url` stays the page it loaded while the app moves around inside it. One
 * that doesn't answer in time (still loading, or frozen) counts as being where it loaded.
 */
function whereIs(win) {
  const loaded = new URL(win.url).pathname;
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (event) => resolve(typeof event.data === 'string' ? event.data : loaded);
    win.postMessage({ type: 'alcove.where' }, [port2]);
    setTimeout(() => resolve(loaded), 250);
  });
}

/** The window already there (for a call, the one in it first), or else the one used last; a new one if there's none. */
async function open(where) {
  const path = pathOf(where);
  // Most recently used first.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const at = await Promise.all(windows.map(whereIs));
  const wanted = where?.to === 'call' ? [`/call/${encodeURIComponent(where.code)}`, path] : [path];
  const win = windows[wanted.map((p) => at.indexOf(p)).find((i) => i >= 0) ?? 0];
  if (!win) {
    await self.clients.openWindow(path);
    return;
  }
  // Even if it can't come forward, it still goes where the notification leads.
  await win.focus().catch(() => undefined);
  win.postMessage({ type: 'alcove.notification', open: where });
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
