/*
 * The web app's built files, served from WEB_DIR as Cloudflare Pages served them (docs: system-architecture › The edge):
 * the file asked for, else {path}/index.html, else {path}.html, else /index.html with 200, since the app routes in the
 * browser. Headers come from WEB_DIR/_headers in Pages' format: a rule is a path pattern (with * and :placeholders) and
 * the headers under it; every rule that matches the path asked for applies, in order, a header set twice is joined with a
 * comma, and `! Name` takes one away. Pages reads _headers and _redirects itself and never serves them, and neither does
 * this. Only files found when the edge starts are served, so nothing outside WEB_DIR can be. Text is compressed once, as
 * it's first asked for, and each file has an ETag that a browser revalidates with. A file goes out a piece at a time, each
 * once the last has gone, so a big one (MediaPipe's model) never sits whole in a connection's memory.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Http2ServerResponse, type Http2ServerRequest } from 'node:http2';
import { readFile, readdir, stat } from 'node:fs/promises';
import type { Writable } from 'node:stream';
import { extname, join, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { log } from '../log';

const slog = log.child({ component: 'edge' });
const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

export type EdgeRequest = IncomingMessage | Http2ServerRequest;
export type EdgeResponse = ServerResponse | Http2ServerResponse;

/** Writes a whole answer, over whichever HTTP it was asked. */
export function reply(res: EdgeResponse, status: number, headers: Record<string, string>, body?: string | Buffer): void {
  if (res instanceof Http2ServerResponse) {
    res.writeHead(status, headers);
    if (body === undefined) res.end(); else res.end(body);
  } else {
    res.writeHead(status, headers);
    if (body === undefined) res.end(); else res.end(body);
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4', '.pdf': 'application/pdf'
};
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|manifest\+json|xml|wasm)|image\/svg\+xml)/;
/**
 * How much of a file is written at a time. Over HTTP/2, Node counts what waits to be sent against the connection's memory, and
 * while that's over its limit refuses the connection's new requests, which a browser shares with the API's (edge/listen.ts).
 */
const PIECE = 64 * 1024;
/** Pages' own files, which it reads and never serves. */
const NOT_SERVED = new Set(['_headers', '_redirects']);

interface Rule { pattern: RegExp; lines: ({ set: string; value: string } | { detach: string })[] }

/** The rules in a _headers file, in order. A pattern matches the whole path, whatever it holds: `*` takes line breaks too. */
function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      // A path, or a whole URL, which Pages matches by its path here: the web app is served on its own host.
      const path = line.trim().replace(/^https?:\/\/[^/]+/, '') || '/';
      const pattern = path.split(/(\*|:[A-Za-z]\w*)/).map((part) => (part === '*' ? '.*' : part.startsWith(':') ? '[^/]+' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('');
      rules.push({ pattern: new RegExp(`^${pattern}$`, 's'), lines: [] });
      continue;
    }
    const rule = rules.at(-1);
    const body = line.trim();
    if (!rule) continue;
    if (body.startsWith('!')) { rule.lines.push({ detach: body.slice(1).trim().toLowerCase() }); continue; }
    const at = body.indexOf(':');
    if (at > 0) rule.lines.push({ set: body.slice(0, at).trim().toLowerCase(), value: body.slice(at + 1).trim() });
  }
  return rules;
}

/** The headers `rules` give `path`. */
function headersFor(rules: Rule[], path: string): Record<string, string> {
  const out = new Map<string, string[]>();
  for (const rule of rules.filter((r) => r.pattern.test(path))) {
    for (const l of rule.lines) {
      if ('detach' in l) out.delete(l.detach);
      else out.set(l.set, [...(out.get(l.set) ?? []), l.value]);
    }
  }
  return Object.fromEntries([...out].map(([name, values]) => [name, values.join(', ')]));
}

interface Loaded { body: Buffer; etag: string; type: string; br?: Promise<Buffer> | undefined; gzip?: Promise<Buffer> | undefined }

/**
 * Writes `body` a piece at a time, each once the last has gone, and ends the answer; stops once the request has gone. An
 * HTTP/2 answer has no `destroyed` to say so (its stream does), so its close is watched for as it writes.
 */
async function send(res: EdgeResponse, body: Buffer): Promise<void> {
  const out: Writable = res;
  let gone = res instanceof Http2ServerResponse ? res.stream.closed : res.destroyed;
  const going = () => { gone = true; };
  out.once('close', going);
  try {
    for (let at = 0; at < body.length && !gone; at += PIECE) {
      if (out.write(body.subarray(at, at + PIECE)) || gone) continue;
      await new Promise<void>((go) => {
        const done = () => { out.off('drain', done); out.off('close', done); go(); };
        out.once('drain', done);
        out.once('close', done);
      });
    }
    if (!gone) out.end();
  } finally {
    out.off('close', going);
  }
}

export interface WebApp { serve(req: EdgeRequest, res: EdgeResponse): Promise<void> }

/** The web app in `dir`: its files as they are now, and its _headers. */
export async function loadWebApp(dir: string): Promise<WebApp> {
  const names = (await readdir(dir, { recursive: true, encoding: 'utf8' })).map((name) => name.split(sep).join('/'));
  const files = new Set<string>();
  for (const name of names) {
    if (NOT_SERVED.has(name) || name.split('/').some((part) => part.startsWith('.'))) continue;
    if ((await stat(join(dir, name))).isFile()) files.add(`/${name}`);
  }
  if (!files.has('/index.html')) throw new Error(`WEB_DIR (${dir}) has no index.html: it should be the web app's built files.`);
  const rules = parseHeaders(await readFile(join(dir, '_headers'), 'utf8').catch(() => ''));
  if (!rules.length) slog.warn('the web app has no _headers; serving it without them', { files: files.size });
  if (names.includes('_redirects')) slog.warn('the web app has a _redirects, which isn’t followed here');
  slog.info('web app loaded', { files: files.size, headerRules: rules.length });

  const loaded = new Map<string, Promise<Loaded>>();
  const load = (file: string) => {
    let l = loaded.get(file);
    if (!l) {
      l = readFile(join(dir, file)).then((body) => ({ body, etag: createHash('sha256').update(body).digest('base64url').slice(0, 27), type: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' }));
      loaded.set(file, l);
      // A read that failed is tried again next time, not remembered.
      void l.catch(() => loaded.delete(file));
    }
    return l;
  };
  const encoded = (l: Loaded, encoding: 'br' | 'gzip') => {
    if (encoding === 'br') return (l.br ??= brotli(l.body, { params: { [constants.BROTLI_PARAM_QUALITY]: l.body.length > 1 << 20 ? 5 : 9, [constants.BROTLI_PARAM_SIZE_HINT]: l.body.length } }));
    return (l.gzip ??= gzipped(l.body));
  };

  return {
    async serve(req, res) {
      const url = new URL(req.url ?? '/', 'https://web.invalid');
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { path = ''; }
      // No control characters: nothing the app has is named with one.
      if (!path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path) || path.split('/').includes('..')) {
        reply(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'That isn’t a path here.');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        reply(res, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, 'Only GET and HEAD are served here.');
        return;
      }
      const trimmed = path.replace(/\/+$/, '');
      const file = [path.endsWith('/') ? undefined : path, `${trimmed}/index.html`, trimmed ? `${trimmed}.html` : undefined].find((f) => f !== undefined && files.has(f)) ?? '/index.html';
      const l = await load(file);
      const accepts = String(req.headers['accept-encoding'] ?? '');
      const compressible = COMPRESSIBLE.test(l.type) && l.body.length > 1024;
      const encoding = !compressible ? undefined : /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : undefined;
      const etag = `"${l.etag}${encoding === 'br' ? '-br' : encoding === 'gzip' ? '-gz' : ''}"`;
      const headers: Record<string, string> = {
        ...headersFor(rules, path), 'content-type': l.type, etag,
        ...(compressible ? { vary: 'accept-encoding' } : {}), ...(encoding ? { 'content-encoding': encoding } : {})
      };
      const known = String(req.headers['if-none-match'] ?? '').split(',').map((t) => t.trim().replace(/^W\//, ''));
      if (known.includes(etag) || known.includes('*')) {
        reply(res, 304, headers);
        return;
      }
      const body = encoding ? await encoded(l, encoding) : l.body;
      if (req.method === 'HEAD') {
        reply(res, 200, { ...headers, 'content-length': String(body.length) });
        return;
      }
      if (res instanceof Http2ServerResponse) res.writeHead(200, { ...headers, 'content-length': String(body.length) });
      else res.writeHead(200, { ...headers, 'content-length': String(body.length) });
      await send(res, body);
    }
  };
}
