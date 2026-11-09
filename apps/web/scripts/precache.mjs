// node apps/web/scripts/precache.mjs <dist/client>
// Runs after `vite build`. The service worker caches the shell (index.html, requested as /) and build assets.
// Pages consumes its own config files, and camera backgrounds load on demand. Extra prerendered documents
// use the shell when opened offline.
// The version is a hash of every file, the worker included, so any change makes a new worker and a new cache.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const [, , dir] = process.argv;
if (!dir) throw new Error('usage: precache.mjs <dist/client>');
const PLACEHOLDER = "const BUILD = { version: '', files: [] };";
// Pages reads _headers and _redirects itself and never serves them.
const NOT_SERVED = new Set(['_headers', '_redirects']);
// Camera backgrounds' model and WebAssembly (tens of MB): fetched only by someone who picks a background, never cached ahead.
const ON_DEMAND = 'mediapipe/';

const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  .map((path) => path.split(sep).join('/'))
  .filter((path) => !NOT_SERVED.has(path) && !path.startsWith(ON_DEMAND) && !path.split('/').some((part) => part.startsWith('.')) && statSync(join(dir, path)).isFile())
  .sort();
if (!files.includes('index.html')) throw new Error(`${dir} has no index.html: run vite build first`);
if (!files.includes('sw.js')) throw new Error(`${dir} has no sw.js: it comes from apps/web/public`);

const worker = join(dir, 'sw.js');
const source = readFileSync(worker, 'utf8');
if (source.split(PLACEHOLDER).length !== 2) throw new Error(`sw.js needs the line ${PLACEHOLDER} exactly once (has precache.mjs already run on this build?)`);
const hash = createHash('sha256');
for (const path of files) hash.update(path).update('\0').update(readFileSync(join(dir, path))).update('\0');
const version = hash.digest('hex').slice(0, 16);
const paths = files
  .filter((path) => path !== 'sw.js' && (path === 'index.html' || !path.endsWith('.html')))
  .map((path) => (path === 'index.html' ? '/' : `/${path}`));
writeFileSync(worker, source.replace(PLACEHOLDER, () => `const BUILD = ${JSON.stringify({ version, files: paths })};`));
process.stdout.write(`sw.js caches ${paths.length} files as version ${version}\n`);
