/*
 * Reaching the edge as production traffic does, for integration tests: every connection to its HTTPS port starts with the
 * load balancer's PROXY protocol v1 line, then TLS with the host's name and the stand-in CA's root trusted; HTTP/2 as
 * browsers speak it, as a fetch, or HTTP/1.1. And its plain HTTP port, as the load balancer's health checks reach it.
 */
import { request as httpRequest, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import { connect as connectHttp2, constants, type ClientHttp2Stream } from 'node:http2';
import { request as httpsRequest } from 'node:https';
import { connect, isIPv6 } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';

export interface EdgeTarget {
  /** The edge's HTTPS port. */
  port: number;
  /** The root its certificate chains to. */
  ca: string;
  /** Whose the connection is, as the load balancer's PROXY line says: an address, or nothing for `PROXY UNKNOWN`. */
  from?: string | undefined;
}

/** A TLS connection to the edge as the load balancer hands one on: its PROXY line first. */
export function edgeSocket(t: EdgeTarget, host: string, alpn: string[]): TLSSocket {
  const raw = connect(t.port, '127.0.0.1');
  const v6 = t.from !== undefined && isIPv6(t.from);
  raw.write(t.from === undefined ? 'PROXY UNKNOWN\r\n' : `PROXY ${v6 ? 'TCP6' : 'TCP4'} ${t.from} ${v6 ? '2001:db8::443' : '10.128.0.2'} 51000 443\r\n`);
  return connectTls({ socket: raw, servername: host, ca: t.ca, ALPNProtocols: alpn });
}

/** A fetch over HTTP/2 to the edge, each request on a connection of its own, as a browser's would be on the far side of the load balancer. */
export function edgeFetch(t: EdgeTarget): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    const session = connectHttp2(url.origin, { createConnection: () => edgeSocket(t, url.hostname, ['h2']) });
    session.on('error', () => undefined);
    const headers: OutgoingHttpHeaders = { ':method': request.method, ':path': `${url.pathname}${url.search}` };
    request.headers.forEach((value, name) => { headers[name] = value; });
    const stream = session.request(headers, { endStream: body === undefined });
    if (body !== undefined) stream.end(body);
    let fail: ((e: Error) => void) | undefined;
    const abort = () => { fail?.(new DOMException('The request was aborted.', 'AbortError')); stream.close(constants.NGHTTP2_CANCEL); session.destroy(); };
    request.signal.addEventListener('abort', abort, { once: true });
    const answered = await new Promise<IncomingHttpHeaders & { ':status'?: number }>((resolve, reject) => {
      stream.once('response', resolve);
      stream.once('error', reject);
      session.once('error', reject);
      fail = reject;
    });
    const status = Number(answered[':status'] ?? 0);
    const out = new Headers();
    for (const [name, value] of Object.entries(answered)) {
      if (name.startsWith(':') || value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) out.append(name, String(v));
    }
    if (request.method === 'HEAD' || status === 204 || status === 304) {
      stream.resume();
      stream.once('close', () => session.close());
      return new Response(null, { status, headers: out });
    }
    // Once the reader has it all, or let go of it, nothing more goes to it.
    let open = true;
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        fail = (e) => { if (open) { open = false; controller.error(e); } };
        stream.on('data', (chunk: Buffer) => { if (open) controller.enqueue(new Uint8Array(chunk)); });
        stream.once('end', () => { request.signal.removeEventListener('abort', abort); if (open) { open = false; controller.close(); } session.close(); });
        stream.once('error', (e) => fail?.(e));
      },
      cancel() { open = false; stream.close(constants.NGHTTP2_CANCEL); session.destroy(); }
    });
    return new Response(readable, { status, headers: out });
  };
}

/**
 * One HTTP/2 connection to the edge, as a browser keeps one for all of a page's requests: `start` asks for a path and gives
 * back its stream, unread, and `status` asks for one and waits for its status (or 0 when the edge refused the request).
 */
export function edgeSession(t: EdgeTarget, host: string): { start(path: string): ClientHttp2Stream; status(path: string): Promise<number>; close(): void } {
  const session = connectHttp2(`https://${host}`, { createConnection: () => edgeSocket(t, host, ['h2']) });
  session.on('error', () => undefined);
  const start = (path: string) => session.request({ ':method': 'GET', ':path': path, ':authority': host });
  return {
    start,
    status: (path) => new Promise((resolve) => {
      const stream = start(path);
      stream.once('response', (h) => { resolve(Number(h[':status'] ?? 0)); stream.resume(); });
      stream.once('error', () => resolve(0));
      stream.once('close', () => resolve(0));
    }),
    close: () => session.destroy()
  };
}

/** What happens to a connection to the HTTPS port that starts with `bytes`: closed by the edge, or still open after a while. */
export function rawConnection(t: EdgeTarget, bytes: string, waitMs = 2_000): Promise<'closed' | 'open'> {
  return new Promise((resolve) => {
    const s = connect(t.port, '127.0.0.1', () => s.write(bytes));
    const timer = setTimeout(() => { s.destroy(); resolve('open'); }, waitMs);
    s.on('error', () => undefined);
    s.once('close', () => { clearTimeout(timer); resolve('closed'); });
  });
}

export interface Answered { status: number; headers: IncomingHttpHeaders; body: string; protocol: string | undefined }

/** One request over HTTP/1.1 to the edge's HTTPS port, as a client without HTTP/2 makes it. */
export function edgeHttp1(t: EdgeTarget, host: string, path: string, headers: Record<string, string> = {}): Promise<Answered> {
  return new Promise((resolve, reject) => {
    let protocol: string | undefined;
    const req = httpsRequest({
      host, path, headers: { connection: 'close', ...headers },
      createConnection: () => { const s = edgeSocket(t, host, ['http/1.1']); s.once('secureConnect', () => { protocol = s.alpnProtocol || undefined; }); return s; }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.once('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), protocol }));
      res.once('error', reject);
    });
    req.once('error', reject);
    req.end();
  });
}

/** One request to the edge's plain HTTP port, as the load balancer's health check or a browser's http:// makes it. */
export function plainRequest(port: number, host: string, path: string): Promise<Answered> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { host, connection: 'close' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.once('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), protocol: 'http/1.1' }));
      res.once('error', reject);
    });
    req.once('error', reject);
    req.end();
  });
}

/** The certificate the edge presents for `host`: its serial and its key's SPKI, DER. */
export function presented(t: EdgeTarget, host: string): Promise<{ serial: string; spki: Buffer; validTo: Date }> {
  return new Promise((resolve, reject) => {
    const s = edgeSocket(t, host, ['h2']);
    s.once('secureConnect', () => {
      const cert = s.getPeerX509Certificate();
      s.destroy();
      if (!cert) return reject(new Error('The edge presented no certificate.'));
      resolve({ serial: cert.serialNumber, spki: cert.publicKey.export({ type: 'spki', format: 'der' }), validTo: new Date(cert.validTo) });
    });
    s.once('error', reject);
  });
}

/** What happens to a connection to the HTTPS port that starts with TLS instead of a PROXY line: an error, or nothing at all. */
export function withoutProxyLine(t: EdgeTarget, host: string): Promise<'refused' | 'served'> {
  return new Promise((resolve) => {
    const s = connectTls({ host: '127.0.0.1', port: t.port, servername: host, ca: t.ca, ALPNProtocols: ['h2'] });
    s.once('secureConnect', () => { s.destroy(); resolve('served'); });
    s.once('error', () => resolve('refused'));
    s.once('close', () => resolve('refused'));
  });
}
