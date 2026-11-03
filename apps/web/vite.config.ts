import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '../..',
  server: {
    port: 3000,
    // Same origin for the app and the API, so the session cookie just works.
    proxy: { '/api': { target: 'http://127.0.0.1:8787', rewrite: (p) => p.replace(/^\/api/, '') } }
  },
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    tailwindcss(),
    // SPA mode: every screen is behind sign-in and talks to the API from the browser.
    tanstackStart({ spa: { enabled: true } }),
    viteReact()
  ]
});
