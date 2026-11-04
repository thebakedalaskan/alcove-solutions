// node apps/web/scripts/precache.mjs <dist/client>
// Runs after `vite build` (the web app's build script). Writes the list of every file this build emitted
// into dist/client/sw.js, so the service worker caches exactly this build: the shell, index.html, which it
// asks for as / (Cloudflare Pages redirects /index.html there), and everything else but Pages' _headers.
// The version is a hash of every file, the worker included, so any change makes a new worker and a new cache.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const [, , dir] = process.argv;
if (!dir) throw new Error('usage: precache.mjs <dist/client>');
const PLACEHOLDER = "const BUILD = { version: '', files: [] };";
// Pages reads _headers and _redirects itself and never serves them.
const NOT_SERVED = new Set(['_headers', '_redirects']);

const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  .map((path) => path.split(sep).join('/'))
  .filter((path) => !NOT_SERVED.has(path) && !path.split('/').some((part) => part.startsWith('.')) && statSync(join(dir, path)).isFile())
  .sort();
if (!files.includes('index.html')) throw new Error(`${dir} has no index.html: run vite build first`);
if (!files.includes('sw.js')) throw new Error(`${dir} has no sw.js: it comes from apps/web/public`);

const worker = join(dir, 'sw.js');
const source = readFileSync(worker, 'utf8');
if (source.split(PLACEHOLDER).length !== 2) throw new Error(`sw.js needs the line ${PLACEHOLDER} exactly once (has precache.mjs already run on this build?)`);
const hash = createHash('sha256');
for (const path of files) hash.update(path).update('\0').update(readFileSync(join(dir, path))).update('\0');
const version = hash.digest('hex').slice(0, 16);
const paths = files.filter((path) => path !== 'sw.js').map((path) => (path === 'index.html' ? '/' : `/${path}`));
writeFileSync(worker, source.replace(PLACEHOLDER, () => `const BUILD = ${JSON.stringify({ version, files: paths })};`));
process.stdout.write(`sw.js caches ${paths.length} files as version ${version}\n`);
