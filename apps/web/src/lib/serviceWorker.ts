import { WorkerMessageSchema } from '@alcove/api';
import { log } from './log';

const swLog = log.child({ component: 'service-worker' });

/**
 * Registers the service worker (public/sw.js), which keeps this build in the browser so Alcove opens without a
 * connection. Production builds only: `vite dev` serves modules the worker's list doesn't name. It waits for the
 * page to load, so caching the build doesn't compete with the first screen.
 *
 * An install that fails is said by the worker itself (`alcove.install-failed`): the build, and the first of its files
 * that didn't arrive, with its status. A worker set aside because a newer one came along while it installed (two deploys
 * close together) failed at nothing, and says so at info.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!(event.source instanceof ServiceWorker) || new URL(event.source.scriptURL).origin !== location.origin) return;
    const message = WorkerMessageSchema.safeParse(event.data);
    if (!message.success || message.data.type !== 'alcove.install-failed') return;
    const { version, path, status } = message.data;
    swLog.warn('service worker install failed', { version, path, status, online: navigator.onLine });
  });
  const register = () => {
    navigator.serviceWorker.register('/sw.js').then(
      (reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state !== 'redundant') return;
            const newer = [reg.installing, reg.waiting].some((w) => w !== null && w !== worker);
            if (newer) swLog.info('service worker replaced by a newer build before it installed');
          });
        });
      },
      (err: unknown) => swLog.warn('service worker registration failed', { err })
    );
  };
  if (document.readyState === 'complete') register();
  else addEventListener('load', register, { once: true });
}
