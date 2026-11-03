// node apps/web/scripts/csp.mjs <dist/client> <api origin>
// Adds the web app's Content-Security-Policy to dist/client/_headers. Nothing third-party at all: the
// app's own origin, plus the API's for requests, audio and photos; inline scripts only by the hash of
// exactly what this build produced, so no other inline script can run.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , dir, api] = process.argv;
if (!dir || !api || !/^https?:\/\/[^/]+$/.test(api)) throw new Error('usage: csp.mjs <dist/client> <https://api.origin>');
const hashes = new Set();
for (const file of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(dir, file), 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1]) hashes.add(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
}
const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${api}`,
  `media-src 'self' blob: ${api}`,
  `connect-src 'self' ${api}`,
  "font-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');
appendFileSync(join(dir, '_headers'), `  Content-Security-Policy: ${csp}\n`);
process.stdout.write(`Content-Security-Policy written with ${hashes.size} inline script hashes\n`);
