import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// The API's port from the repository's .env, so worktrees can run side by side.
const apiPort = loadEnv('development', '../..', 'API_')['API_PORT'] ?? '8787';

/*
 * MediaPipe's WebAssembly for camera backgrounds (features/call/backdrop.ts), served from this origin at
 * /mediapipe/wasm: the exact version LiveKit's background processor was built with, never fetched from a CDN. The
 * model it runs is in public/mediapipe.
 */
const fromProcessor = createRequire(createRequire(import.meta.url).resolve('@livekit/track-processors'));
const MEDIAPIPE_WASM = join(dirname(fromProcessor.resolve('@mediapipe/tasks-vision')), 'wasm');
function mediapipe(): Plugin {
  const files = readdirSync(MEDIAPIPE_WASM);
  return {
    name: 'alcove-mediapipe',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const name = new URL(req.url ?? '/', 'http://local').pathname.slice(1);
        if (!files.includes(name)) { next(); return; }
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(join(MEDIAPIPE_WASM, name)));
      });
    },
    generateBundle() {
      if (this.environment.name !== 'client') return;
      for (const name of files) this.emitFile({ type: 'asset', fileName: `mediapipe/wasm/${name}`, source: readFileSync(join(MEDIAPIPE_WASM, name)) });
    }
  };
}

export default defineConfig({
  envDir: '../..',
  server: {
    port: 3000,
    // Same origin for the app and the API, so the session cookie just works.
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, rewrite: (p) => p.replace(/^\/api/, '') } }
  },
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    mediapipe(),
    tailwindcss(),
    // SPA mode: every screen is behind sign-in and talks to the API from the browser.
    // The shell is prerendered as index.html, so Cloudflare Pages serves it for every route.
    tanstackStart({ spa: { enabled: true, prerender: { outputPath: '/index' } } }),
    viteReact()
  ]
});
