import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Integration tests only (see AGENTS.md): real server, real Postgres, real object store. No browser.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    env: loadEnv('test', '../../', ''),
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
});
