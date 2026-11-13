/**
 * Writes the route tree, src/routeTree.gen.ts, as `vite build` and `vite dev` do before anything else, without building:
 * resolving the app's Vite config runs TanStack Start's router generator, with the same settings. CI's typecheck needs
 * only the tree.
 */
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';

await resolveConfig({ root: fileURLToPath(new URL('..', import.meta.url)) }, 'build');
