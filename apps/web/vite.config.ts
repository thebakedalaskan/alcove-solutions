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
 * MediaPipe's WebAssembly for camera backgrounds (features/call/media/backgrounds/matte.ts), served from this origin at
 * /mediapipe/wasm: the exact version the app imports, never fetched from a CDN. The model it runs is in
 * public/mediapipe.
 */
const MEDIAPIPE_WASM = join(dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision')), 'wasm');
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
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, rewrite: (p) => p.replace(/^\/api/, '') },
      // OAuth discovery inserts .well-known before the issuer's /api path.
      '/.well-known': { target: `http://127.0.0.1:${apiPort}` }
    }
  },
  /*
   * The build prerenders its pages by fetching them from a preview server in the same process. On `localhost` the
   * server listens on one address (::1 on Linux and macOS), while a fetch tries each address `localhost` has, giving
   * each 250 ms. Rendering a page keeps that process busy for longer on a slow runner (the first loads the server
   * bundle), so a fetch that was connecting gives up on ::1, finds nothing on 127.0.0.1, and the build fails: connect
   * ETIMEDOUT ::1, connect ECONNREFUSED 127.0.0.1. On an IP address there's nothing to look up and one address to try,
   * with no timer.
   */
  preview: { host: '127.0.0.1' },
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    mediapipe(),
    tailwindcss(),
    // Cloudflare Pages serves the SPA shell for app routes. The public policy is also readable without JavaScript.
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: '/index' } },
      prerender: { autoStaticPathsDiscovery: false, crawlLinks: false, failOnError: true },
      pages: [{ path: '/privacy', prerender: { enabled: true, outputPath: '/privacy', autoSubfolderIndex: false } }]
    }),
    viteReact()
  ]
});
