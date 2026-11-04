import { log } from './log';

const swLog = log.child({ component: 'service-worker' });

/**
 * Registers the service worker (public/sw.js), which keeps this build in the browser so Alcove opens without a
 * connection. Production builds only: `vite dev` serves modules the worker's list doesn't name. It waits for the
 * page to load, so caching the build doesn't compete with the first screen.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').then(
      (reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          // An install that fails (a file of the build didn't arrive) leaves the worker redundant, never installed.
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'redundant') swLog.warn('service worker install failed');
          });
        });
      },
      (err: unknown) => swLog.warn('service worker registration failed', { err })
    );
  };
  if (document.readyState === 'complete') register();
  else addEventListener('load', register, { once: true });
}
