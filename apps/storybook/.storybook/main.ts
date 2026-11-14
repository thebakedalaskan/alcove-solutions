/*
 * Storybook for Alcove: the real components and the real pages, on made-up data. The app is compiled from its own source
 * (`~` is apps/web/src, as in the app), with Tailwind as the app uses it, and two of its modules stood in for:
 *
 *   apps/web/src/lib/api.ts              → src/api/api.ts, the stand-in AlcoveApi serving the story's scenario
 *   apps/web/src/features/call/media/livekit.ts → src/media/livekit.ts, a scripted room in place of LiveKit
 *
 * They're found by the file an import lands on, not by how it's spelled, so `~/lib/api`, `./api` and `../lib/api` all
 * get the stand-in. Nothing in apps/web or packages/* knows Storybook exists.
 */
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { mergeConfig, type Plugin } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// The actual local camera effect runs on the synthetic devices too, using the exact app model/WASM from this origin.
const cameraWasm = join(dirname(createRequire(here('../../web/package.json')).resolve('@mediapipe/tasks-vision')), 'wasm');

/** The app's modules Storybook replaces, by the file they are, and what replaces each. */
const STAND_INS = new Map([
  [here('../../web/src/lib/api.ts'), here('../src/api/api.ts')],
  [here('../../web/src/features/call/media/livekit.ts'), here('../src/media/livekit.ts')]
]);
/** Only imports that could land on one of them are looked at twice. */
const MAYBE = /(^|\/)(api|livekit)(\.ts)?$/;

function standIns(): Plugin {
  return {
    name: 'alcove:stand-ins',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !MAYBE.test(source)) return null;
      const found = await this.resolve(source, importer, { ...options, skipSelf: true });
      return found ? STAND_INS.get(found.id.split('?')[0] ?? found.id) ?? null : null;
    }
  };
}

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../stories/**/*.stories.tsx'],
  // The app's public files at the paths it asks for them: the speech worklet, its icon. Its service worker is there too, and
  // the preview stops the app registering it.
  staticDirs: ['../../web/public', { from: cameraWasm, to: '/mediapipe/wasm' }],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  typescript: { reactDocgen: false },
  viteFinal: (vite) => mergeConfig(vite, {
    plugins: [standIns(), tailwindcss(), react()],
    resolve: {
      alias: { '~': here('../../web/src') },
      // One React, one router and one query client, whichever package's folder a module is imported from.
      dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router']
    }
  })
};

export default config;
