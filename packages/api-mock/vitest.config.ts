import { defineConfig } from 'vitest/config';

// Integration tests only (see AGENTS.md). They run in Node; no browser, no DOM emulation.
export default defineConfig({
  test: { include: ['src/**/*.integration.test.ts'], environment: 'node', testTimeout: 20_000 }
});
