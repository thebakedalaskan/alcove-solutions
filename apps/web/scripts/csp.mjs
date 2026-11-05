// node apps/web/scripts/csp.mjs <dist/client> <api origin> <livekit url>
// Adds the web app's Content-Security-Policy to the /* rule of dist/client/_headers. Nothing
// third-party but LiveKit, which carries calls: the app's own origin, plus the API's for requests, audio
// and photos, plus the LiveKit host (and LiveKit Cloud's media servers) for calls; inline
// scripts only by the hash of exactly what this build produced, so no other inline script can run.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , dir, api, livekitUrl] = process.argv;
if (!dir || !api || !/^https?:\/\/[^/]+$/.test(api)) throw new Error('usage: csp.mjs <dist/client> <https://api.origin> <wss://livekit.host>');
const livekitHost = /^wss?:\/\/([^/]+)/.exec(livekitUrl ?? '')?.[1];
if (!livekitHost) throw new Error('usage: csp.mjs <dist/client> <https://api.origin> <wss://livekit.host>');
const livekit = [`wss://${livekitHost}`, `https://${livekitHost}`, ...(livekitHost.endsWith('.livekit.cloud') ? ['wss://*.livekit.cloud', 'https://*.livekit.cloud'] : [])].join(' ');
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
  `img-src 'self' data: blob: ${api}`,
  `media-src 'self' blob: ${api}`,
  `connect-src 'self' ${api} ${livekit}`,
  "font-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');
const file = join(dir, '_headers');
const lines = readFileSync(file, 'utf8').split('\n');
const rule = lines.indexOf('/*');
if (rule < 0) throw new Error('_headers has no /* rule to add the policy to');
const line = `  Content-Security-Policy: ${csp}`;
// Cloudflare Pages ignores a _headers line longer than 2,000 characters, which would drop the policy.
if (line.length > 2000) throw new Error(`The policy line is ${line.length} characters; Cloudflare Pages takes at most 2,000.`);
lines.splice(rule + 1, 0, line);
writeFileSync(file, lines.join('\n'));
process.stdout.write(`Content-Security-Policy written with ${hashes.size} inline script hashes\n`);
