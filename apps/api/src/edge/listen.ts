/*
 * The edge (docs: system-architecture › The edge): TLS ends here, inside the TEE, with the key the master makes, so nothing
 * between a browser and the API can read what they say. The load balancer passes TCP through. HTTPS_PORT gets every
 * connection to 443, each starting with a PROXY protocol v1 line that says whose it is; a connection without one is closed.
 * HTTP_PORT gets port 80 and the load balancer's health checks, plain. HTTPS is HTTP/2, with HTTP/1.1 for clients without
 * it, and goes by host: `api.` hosts are the API, `www.` ones are sent on to the host without it, and the rest are the web
 * app. Plain HTTP answers /health (200 once TLS is being served: it reports TLS alone, never the database) and sends
 * everything else to https. Nothing in front of the edge times anything out (the load balancer passes TCP through, idle
 * for up to an hour), so the edge does: a connection has 10 seconds for its PROXY line, a request 60 for its headers and 5
 * minutes in all over HTTP/1.1, and a connection with nothing on it for 2 minutes is closed.
 */
import { getRequestListener } from '@hono/node-server';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Http2ServerRequest, createSecureServer, type Http2Session } from 'node:http2';
import { isIPv4, isIPv6, createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import type pg from 'pg';
import type { Config, EdgeSettings } from '../config';
import { unb64u } from '../crypto';
import { log } from '../log';
import { orderCertificate } from './acme';
import { certificates } from './certificates';
import { cloudflareZone, type DnsServices } from './dns';
import { loadWebApp, reply, type EdgeRequest, type EdgeResponse } from './static';
import { acmeAccountKey, tlsKey } from './tlsKeys';

const elog = log.child({ component: 'edge' });

/** The longest a PROXY v1 line can be, CRLF included, and how long a connection has to send it. */
const PROXY_MAX = 107;
const PROXY_WAIT_MS = 10_000;
/** How long open connections have to finish once the edge closes, before they're cut. */
const CLOSING_MS = 5_000;
/** HTTP/2 flow control: how much a browser can send before the edge has read it, per request and per connection. */
const STREAM_WINDOW = 1 << 20;
const SESSION_WINDOW = 4 << 20;
/**
 * How much an HTTP/2 connection may have waiting to go, in MB, before Node refuses its new requests: well over what a
 * browser's windows let the edge send at once, so a big file on its way (MediaPipe's model, 16 MB) never crowds out the
 * call's own requests on the same connection.
 */
const SESSION_MEMORY_MB = 64;
/** How many requests one HTTP/2 connection may have open at once: a page and its calls use a few dozen. */
const STREAMS_PER_CONNECTION = 256;
/**
 * A connection with nothing sent either way for this long is closed. Live streams say something every 25 seconds. Over
 * HTTP/1.1 a request also has Node's 60 seconds for its headers and 5 minutes in all (the secure server's headersTimeout and
 * requestTimeout), checked every 30 seconds.
 */
const IDLE_MS = 120_000;

export interface Edge {
  /** The ports it took: HTTPS_PORT and HTTP_PORT, or the ones the system chose for a 0. */
  https: number;
  http: number;
  close(): Promise<void>;
}

/** Whose a connection is, from its PROXY v1 line: the client's address, or undefined for UNKNOWN (the proxy's own). Null if it isn't one. */
function proxyClient(line: string): string | undefined | null {
  if (/^PROXY UNKNOWN(?: .*)?$/.test(line)) return undefined;
  const m = /^PROXY (TCP4|TCP6) (\S+) (\S+) (\d{1,5}) (\d{1,5})$/.exec(line);
  if (!m) return null;
  const [, family, source = '', destination = '', sourcePort = '', destinationPort = ''] = m;
  const ip = family === 'TCP4' ? isIPv4 : isIPv6;
  if (!ip(source) || !ip(destination) || Number(sourcePort) > 65_535 || Number(destinationPort) > 65_535) return null;
  return source;
}

/** The host a request is for, without its port: HTTP/2's :authority, or Host, which some HTTP/2 clients send instead. */
const hostOf = (req: EdgeRequest): string => {
  const authority = (req instanceof Http2ServerRequest ? req.authority : undefined) || req.headers.host;
  return (authority ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
};

/** Replaces whatever the client said in x-forwarded-for with the address the load balancer gave, which is all clientAddress() reads. */
function forwardedFor(req: EdgeRequest, address: string | undefined): void {
  const raw = req.rawHeaders;
  for (let i = raw.length - 2; i >= 0; i -= 2) if (raw[i]?.toLowerCase() === 'x-forwarded-for') raw.splice(i, 2);
  if (address === undefined) { delete req.headers['x-forwarded-for']; return; }
  raw.push('x-forwarded-for', address);
  req.headers['x-forwarded-for'] = address;
}

function answer(res: EdgeResponse, status: number, headers: Record<string, string>, text?: string): void {
  reply(res, status, { ...headers, ...(text === undefined ? {} : { 'content-type': 'text/plain; charset=utf-8' }) }, text);
}
/** Where an http URL, or a www. one, is sent: https, on the host without www. Only for the TLS hosts, so it's never anyone else's. */
const httpsOf = (host: string, url: string) => `https://${host.startsWith('www.') ? host.slice(4) : host}${url}`;

function listening(server: NetServer | HttpServer, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const at = server.address();
      resolve(typeof at === 'object' && at ? at.port : port);
    });
  });
}

/**
 * Starts the edge for `edge.hosts`: plain HTTP at once, saying it isn't ready, then, once there's a certificate to serve
 * (stored, or ordered now through `edge.zone`), HTTPS. `api`: the API app's fetch. `dns`: Cloudflare and the resolver, which
 * only a test changes.
 */
export async function startEdge(o: { cfg: Config; edge: EdgeSettings; pool: pg.Pool; api: Parameters<typeof getRequestListener>[0]; dns: DnsServices }): Promise<Edge> {
  const { cfg } = o;
  const { hosts } = o.edge;
  const master = unb64u(cfg.KMASTER, 32);
  const tls = tlsKey(master);
  const account = acmeAccountKey(master);
  master.fill(0);
  elog.info('tls key', { spkiSha256: tls.spkiSha256 });
  const web = hosts.some((h) => !h.startsWith('api.') && !h.startsWith('www.')) ? await loadWebApp(cfg.WEB_DIR) : undefined;
  const api = getRequestListener(o.api);
  let ready = false;

  /* Plain HTTP: the load balancer's health checks, and port 80, sent on to https. */
  const plain: HttpServer = createHttpServer();
  plain.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (url === '/health' || url.startsWith('/health?')) {
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(ready ? { ok: true, tee: cfg.TEE, commit: cfg.ALCOVE_COMMIT } : { ok: false, tls: 'starting' }));
      return;
    }
    const host = hostOf(req);
    if (!hosts.includes(host)) answer(res, 404, {}, 'Nothing is served here for that host.');
    else answer(res, 301, { location: httpsOf(host, url) });
  });
  const httpPort = await listening(plain, cfg.HTTP_PORT, cfg.API_HOST);
  const stopPlain = () => { plain.close(); plain.closeAllConnections(); };
  elog.info('listening for http', { port: httpPort });

  /* The certificate: stored, or ordered now by whichever instance gets there first. */
  let secure: ReturnType<typeof createSecureServer> | undefined;
  const certs = await certificates({
    pool: o.pool, databaseUrl: cfg.DATABASE_URL, hosts, key: tls.key,
    order: async () => orderCertificate({
      hosts, directory: cfg.ACME_DIRECTORY, accountKeyPem: account.privateKeyPem, tlsKeyPem: tls.privateKeyPem,
      zone: await cloudflareZone(o.edge.zone, o.edge.token, o.dns), dns: o.dns
    }),
    replaced: (c) => secure?.setSecureContext({ key: tls.privateKeyPem, cert: c.chainPem })
  }).catch((e: unknown) => { stopPlain(); throw e; });

  /* HTTPS: HTTP/2, and HTTP/1.1 for clients without it, by host. */
  const clients = new Map<string, string | undefined>();
  const route = (req: EdgeRequest, res: EdgeResponse) => {
    const host = hostOf(req);
    if (!hosts.includes(host)) return answer(res, 421, {}, 'Nothing is served here for that host.');
    forwardedFor(req, clients.get(`${req.socket.remoteAddress}:${req.socket.remotePort}`));
    if (host.startsWith('api.')) return void api(req, res);
    if (host.startsWith('www.')) return answer(res, 301, { location: httpsOf(host, req.url ?? '/') });
    if (!web) return answer(res, 404, {}, 'Nothing is served here for that host.');
    web.serve(req, res).catch((e: unknown) => {
      elog.error('a file of the web app couldn’t be served', { err: e });
      if (!res.headersSent) answer(res, 500, {}, 'Something went wrong on our side.');
      else res.destroy();
    });
  };
  const server = createSecureServer({
    key: tls.privateKeyPem, cert: certs.current().chainPem, allowHTTP1: true, minVersion: 'TLSv1.2',
    maxSessionMemory: SESSION_MEMORY_MB, settings: { initialWindowSize: STREAM_WINDOW, maxConcurrentStreams: STREAMS_PER_CONNECTION }
  });
  server.setTimeout(IDLE_MS);
  secure = server;
  server.on('request', route);
  const sessions = new Set<Http2Session>();
  server.on('session', (session) => {
    sessions.add(session);
    session.once('close', () => sessions.delete(session));
    session.setLocalWindowSize(SESSION_WINDOW);
  });
  server.on('tlsClientError', (e) => elog.debug('a tls handshake failed', { err: e }));

  /* What comes to HTTPS_PORT: a PROXY line, then TLS, handed to the server above. */
  const sockets = new Set<Socket>();
  const front: NetServer = createNetServer({ pauseOnConnect: true }, (socket) => {
    sockets.add(socket);
    const key = `${socket.remoteAddress}:${socket.remotePort}`;
    socket.once('close', () => { sockets.delete(socket); clients.delete(key); });
    socket.on('error', (e) => elog.debug('a connection failed', { err: e }));
    let head = Buffer.alloc(0);
    const refuse = (why: string) => {
      clearTimeout(timer);
      // Never the address: logs are built to leave the VM.
      elog.warn('connection without a PROXY line refused', { why, bytes: head.length });
      socket.destroy();
    };
    const timer = setTimeout(() => refuse('slow'), PROXY_WAIT_MS);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n');
      if (end < 0) { if (head.length >= PROXY_MAX) refuse('no line'); return; }
      socket.off('data', onData);
      socket.pause();
      clearTimeout(timer);
      const client = end + 2 <= PROXY_MAX ? proxyClient(head.subarray(0, end).toString('latin1')) : null;
      if (client === null) { refuse('not a PROXY line'); return; }
      clients.set(key, client);
      const rest = head.subarray(end + 2);
      if (rest.length) socket.unshift(rest);
      // The TLS server reads what's waiting on the socket, and the rest of it, itself.
      server.emit('connection', socket);
    };
    socket.on('data', onData);
    socket.resume();
  });
  const httpsPort = await listening(front, cfg.HTTPS_PORT, cfg.API_HOST).catch(async (e: unknown) => { await certs.stop(); stopPlain(); throw e; });
  // The secure server never listens itself: `front` hands it each connection. Node starts checking HTTP/1.1 requests' header
  // and request timeouts when a server says it's listening, so it's told, or a request that never finishes would hold its
  // connection for good.
  server.emit('listening');
  ready = true;
  elog.info('listening for https', { port: httpsPort, hosts: hosts.length, notAfter: certs.current().notAfter.toISOString() });

  return {
    https: httpsPort, http: httpPort,
    async close() {
      ready = false;
      const stopped = certs.stop();
      const closed = Promise.all([new Promise<void>((r) => front.close(() => r())), new Promise<void>((r) => plain.close(() => r()))]);
      plain.closeIdleConnections();
      for (const s of sessions) s.close();
      // Stops its checks of HTTP/1.1 requests' timeouts.
      server.close();
      const cut = setTimeout(() => { for (const s of sockets) s.destroy(); plain.closeAllConnections(); }, CLOSING_MS);
      cut.unref();
      await Promise.all([closed, stopped]);
      clearTimeout(cut);
    }
  };
}
