/*
 * Stand-ins for where the edge's certificates come from, for integration tests (docs: system-architecture › The edge), on one
 * HTTP server: an ACME CA (RFC 8555, as much as Let's Encrypt's dns-01 flow uses: accounts, orders, authorizations,
 * dns-01 challenges, finalizing with a CSR and the chain), checking every JWS against the account's key and every challenge
 * against the zone's TXT records; Cloudflare's DNS API for that zone, for one API token; and a DNS-over-HTTPS resolver
 * (JSON) that sees the zone's records. The CA certifies the key in the CSR under a test root, for the hosts ordered.
 */
import { calculateJwkThumbprint, flattenedVerify, importJWK, type JWK } from 'jose';
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { DnsServices } from '../edge/dns';
import { certify, issue } from './pki';

export interface FakeAcme {
  /** As ACME_DIRECTORY. */
  directory: string;
  /** Cloudflare's API and the resolver, as the edge takes them. */
  dns: DnsServices;
  /** As CLOUDFLARE_ZONE and CLOUDFLARE_API_TOKEN. */
  zone: string;
  token: string;
  /** The root TLS clients trust here, PEM. */
  rootPem: string;
  /** How long the certificates it issues last. */
  days: number;
  /** The chains it issued, oldest first, and each account's key, by account URL. */
  issued: string[];
  /** While set, finalizing an order waits for it, as a CA that's slow to issue. */
  gate: Promise<void> | undefined;
  /** How many of the next challenges the CA finds invalid, whatever the records say. */
  invalidNext: number;
  /** How long a record takes to show to the resolver once it's up, as DNS takes a while to. */
  resolverDelayMs: number;
  accounts: Map<string, JWK>;
  /** The zone's TXT records now. */
  records(): { name: string; content: string }[];
  close(): Promise<void>;
}

const Jws = z.object({ protected: z.string(), payload: z.string(), signature: z.string() });
const Protected = z.object({ alg: z.string(), nonce: z.string(), url: z.string(), jwk: z.unknown().optional(), kid: z.string().optional() });
const NewOrder = z.object({ identifiers: z.array(z.object({ type: z.literal('dns'), value: z.string() })).min(1) });
const Finalize = z.object({ csr: z.string() });
const TxtRecord = z.object({ type: z.literal('TXT'), name: z.string(), content: z.string(), ttl: z.number().optional() });
const Key = z.object({ kty: z.string(), crv: z.string().optional(), x: z.string().optional(), y: z.string().optional(), n: z.string().optional(), e: z.string().optional() });
/** A JWS header's public key, as jose takes it. */
const jwkOf = (k: z.infer<typeof Key>): JWK => ({ kty: k.kty, ...(k.crv ? { crv: k.crv } : {}), ...(k.x ? { x: k.x } : {}), ...(k.y ? { y: k.y } : {}), ...(k.n ? { n: k.n } : {}), ...(k.e ? { e: k.e } : {}) });

/** One TLV of DER: where its content starts and where it ends. */
function tlv(der: Buffer, at: number): { start: number; end: number } {
  const first = der[at + 1] ?? 0;
  if (first < 0x80) return { start: at + 2, end: at + 2 + first };
  let length = 0;
  for (let i = 0; i < (first & 0x7f); i++) length = length * 256 + (der[at + 2 + i] ?? 0);
  const start = at + 2 + (first & 0x7f);
  return { start, end: start + length };
}
/** The SubjectPublicKeyInfo of a PKCS #10 request: certificationRequestInfo's third member. */
function csrKey(csr: Buffer) {
  const info = tlv(csr, tlv(csr, 0).start);
  const version = tlv(csr, info.start);
  const subject = tlv(csr, version.end);
  const spki = tlv(csr, subject.end);
  return createPublicKey({ key: csr.subarray(subject.end, spki.end), format: 'der', type: 'spki' });
}

export async function startFakeAcme(): Promise<FakeAcme> {
  const org = 'Alcove Tests (ACME stand-in)';
  const root = issue({ commonName: 'Alcove Test ACME Root', organization: org, curve: 'P-256', ca: true });
  const intermediate = issue({ commonName: 'Alcove Test ACME Intermediate', organization: org, curve: 'P-256', issuer: root, ca: true });
  const zoneId = randomBytes(16).toString('hex');
  const token = `cf-${randomBytes(18).toString('base64url')}`;
  const nonces = new Set<string>();
  const records = new Map<string, { name: string; content: string; at: number }>();
  interface Authz { id: string; identifier: string; token: string; status: 'pending' | 'valid' | 'invalid'; account: string }
  interface Order { id: string; account: string; identifiers: string[]; authz: string[]; status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid'; chain?: string }
  const authzs = new Map<string, Authz>();
  const orders = new Map<string, Order>();
  let base = '';

  const nonce = () => { const n = randomBytes(16).toString('base64url'); nonces.add(n); return n; };
  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'application/pem-certificate-chain' : status >= 400 ? 'application/problem+json' : 'application/json', 'replay-nonce': nonce(), 'cache-control': 'no-store', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const problem = (res: ServerResponse, status: number, type: string, detail: string) => send(res, status, { type: `urn:ietf:params:acme:error:${type}`, detail, status });
  const read = async (req: IncomingMessage) => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c)); return Buffer.concat(chunks).toString('utf8'); };
  const authzOut = (a: Authz) => ({ identifier: { type: 'dns', value: a.identifier }, status: a.status, challenges: [{ type: 'dns-01', url: `${base}/acme/chall/${a.id}`, token: a.token, status: a.status }] });
  const orderOut = (o: Order) => ({
    status: o.status, identifiers: o.identifiers.map((value) => ({ type: 'dns', value })), authorizations: o.authz.map((id) => `${base}/acme/authz/${id}`),
    finalize: `${base}/acme/order/${o.id}/finalize`, ...(o.chain ? { certificate: `${base}/acme/cert/${o.id}` } : {})
  });

  /** A JWS request, checked: its nonce one this gave out, its URL this one, signed by the account's key (or the new one's). */
  const verified = async (req: IncomingMessage, url: string): Promise<{ account: string; jwk: JWK; payload: unknown } | string> => {
    const jws = Jws.safeParse(JSON.parse(await read(req)));
    if (!jws.success) return 'malformed';
    const header = Protected.safeParse(JSON.parse(Buffer.from(jws.data.protected, 'base64url').toString('utf8')));
    if (!header.success || !nonces.delete(header.data.nonce)) return 'badNonce';
    if (header.data.url !== url) return 'unauthorized';
    const given = Key.safeParse(header.data.jwk);
    const jwk: JWK | undefined = given.success ? jwkOf(given.data) : header.data.kid ? self.accounts.get(header.data.kid) : undefined;
    if (!jwk) return 'accountDoesNotExist';
    try { await flattenedVerify(jws.data, await importJWK(jwk, header.data.alg)); } catch { return 'unauthorized'; }
    const account = header.data.kid ?? [...self.accounts].find(([, k]) => k.x === jwk.x && k.y === jwk.y && k.n === jwk.n)?.[0] ?? '';
    const text = Buffer.from(jws.data.payload, 'base64url').toString('utf8');
    return { account, jwk, payload: text ? JSON.parse(text) : '' };
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', base);
      const path = url.pathname;
      /* The resolver: what the zone's TXT records say, as DNS-over-HTTPS JSON. */
      if (path === '/dns-query') {
        const name = url.searchParams.get('name') ?? '';
        const found = [...records.values()].filter((r) => r.name === name && Date.now() - r.at >= self.resolverDelayMs);
        res.writeHead(200, { 'content-type': 'application/dns-json' });
        res.end(JSON.stringify({ Status: found.length ? 0 : 3, Answer: found.map((r) => ({ name, type: 16, TTL: 60, data: `"${r.content}"` })) }));
        return;
      }
      /* Cloudflare's API, for one zone and one token. */
      if (path.startsWith('/cloudflare/')) {
        const cf = (status: number, result: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: status < 400, errors: status < 400 ? [] : [{ code: status === 403 ? 10000 : 7003, message: 'refused' }], messages: [], result })); };
        if (req.headers.authorization !== `Bearer ${token}`) return cf(403, null);
        const text = await read(req);
        if (req.method === 'GET' && path === '/cloudflare/zones') return cf(200, url.searchParams.get('name') === 'alcove.test' ? [{ id: zoneId, name: 'alcove.test' }] : []);
        const recordsPath = `/cloudflare/zones/${zoneId}/dns_records`;
        if (req.method === 'GET' && path === recordsPath) return cf(200, [...records].filter(([, r]) => r.name === url.searchParams.get('name')).map(([id, r]) => ({ id, type: 'TXT', ...r })));
        if (req.method === 'POST' && path === recordsPath) {
          const r = TxtRecord.safeParse(JSON.parse(text));
          if (!r.success) return cf(400, null);
          const id = randomBytes(16).toString('hex');
          records.set(id, { name: r.data.name, content: r.data.content, at: Date.now() });
          return cf(200, { id, type: 'TXT', name: r.data.name, content: r.data.content });
        }
        const removed = path.startsWith(`${recordsPath}/`) ? path.slice(recordsPath.length + 1) : undefined;
        if (req.method === 'DELETE' && removed !== undefined && records.delete(removed)) return cf(200, { id: removed });
        return cf(404, null);
      }
      /* The ACME CA. */
      if (path === '/acme/directory') {
        return send(res, 200, { newNonce: `${base}/acme/new-nonce`, newAccount: `${base}/acme/new-account`, newOrder: `${base}/acme/new-order`, revokeCert: `${base}/acme/revoke-cert`, keyChange: `${base}/acme/key-change`, meta: { termsOfService: `${base}/acme/terms` } });
      }
      if (path === '/acme/new-nonce') { res.writeHead(req.method === 'HEAD' ? 200 : 204, { 'replay-nonce': nonce(), 'cache-control': 'no-store' }); res.end(); return; }
      if (req.method !== 'POST') return problem(res, 405, 'malformed', 'POST only');
      const r = await verified(req, `${base}${path}`);
      if (typeof r === 'string') return problem(res, r === 'accountDoesNotExist' ? 400 : r === 'unauthorized' ? 403 : 400, r, 'refused');
      if (path === '/acme/new-account') {
        const known = [...self.accounts].find(([, k]) => k.x === r.jwk.x && k.y === r.jwk.y);
        const uri = known?.[0] ?? `${base}/acme/acct/${self.accounts.size + 1}`;
        if (!known) self.accounts.set(uri, r.jwk);
        return send(res, known ? 200 : 201, { status: 'valid', orders: `${uri}/orders` }, { location: uri });
      }
      if (path.startsWith('/acme/acct/')) return send(res, 200, { status: 'valid', orders: `${base}${path}/orders` });
      if (path === '/acme/new-order') {
        const o = NewOrder.safeParse(r.payload);
        if (!o.success) return problem(res, 400, 'malformed', 'identifiers');
        const id = randomBytes(8).toString('hex');
        const order: Order = { id, account: r.account, identifiers: o.data.identifiers.map((i) => i.value), authz: [], status: 'pending' };
        for (const identifier of order.identifiers) {
          const a: Authz = { id: randomBytes(8).toString('hex'), identifier, token: randomBytes(32).toString('base64url'), status: 'pending', account: r.account };
          authzs.set(a.id, a);
          order.authz.push(a.id);
        }
        orders.set(id, order);
        return send(res, 201, orderOut(order), { location: `${base}/acme/order/${id}` });
      }
      const authz = /^\/acme\/authz\/(\w+)$/.exec(path)?.[1];
      if (authz) { const a = authzs.get(authz); return a ? send(res, 200, authzOut(a)) : problem(res, 404, 'malformed', 'no such authorization'); }
      const chall = /^\/acme\/chall\/(\w+)$/.exec(path)?.[1];
      if (chall) {
        const a = authzs.get(chall);
        if (!a) return problem(res, 404, 'malformed', 'no such challenge');
        if (a.status === 'pending' && self.invalidNext > 0) {
          self.invalidNext--;
          a.status = 'invalid';
        } else if (a.status === 'pending') {
          // As the CA does: the TXT record must say the digest of the token and the account key's thumbprint.
          const expected = createHash('sha256').update(`${a.token}.${await calculateJwkThumbprint(r.jwk)}`).digest('base64url');
          a.status = [...records.values()].some((rec) => rec.name === `_acme-challenge.${a.identifier}` && rec.content === expected) ? 'valid' : 'invalid';
        }
        return send(res, 200, authzOut(a).challenges[0]);
      }
      const order = /^\/acme\/order\/(\w+)(\/finalize)?$/.exec(path);
      const o = order?.[1] ? orders.get(order[1]) : undefined;
      if (o && !order?.[2]) {
        if (o.status === 'pending' && o.authz.every((id) => authzs.get(id)?.status === 'valid')) o.status = 'ready';
        return send(res, 200, orderOut(o));
      }
      if (o && order?.[2]) {
        await self.gate;
        const f = Finalize.safeParse(r.payload);
        if (!f.success || !o.authz.every((id) => authzs.get(id)?.status === 'valid')) return problem(res, 403, 'orderNotReady', 'not ready');
        const leaf = certify(csrKey(Buffer.from(f.data.csr, 'base64url')), { hosts: o.identifiers, issuer: intermediate, notAfter: new Date(Date.now() + self.days * 86_400_000) });
        o.chain = leaf.pem + intermediate.pem;
        o.status = 'valid';
        self.issued.push(o.chain);
        return send(res, 200, orderOut(o));
      }
      const cert = /^\/acme\/cert\/(\w+)$/.exec(path)?.[1];
      const chain = cert ? orders.get(cert)?.chain : undefined;
      if (chain) return send(res, 200, chain);
      return problem(res, 404, 'malformed', 'not found');
    })().catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const at = server.address();
  base = `http://127.0.0.1:${typeof at === 'object' && at ? at.port : 0}`;

  const self: FakeAcme = {
    directory: `${base}/acme/directory`, dns: { cloudflare: `${base}/cloudflare`, resolver: `${base}/dns-query` }, zone: zoneId, token, rootPem: root.pem,
    days: 90, issued: [], gate: undefined, invalidNext: 0, resolverDelayMs: 0, accounts: new Map(),
    records: () => [...records.values()].map(({ name, content }) => ({ name, content })),
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); })
  };
  return self;
}
