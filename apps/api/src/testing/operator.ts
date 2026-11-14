/*
 * Operators in tests: keys made for the test, and clients that sign requests with the CLI's own signing code
 * (features/operator/cli/cli.ts › signRequest), as an operator's machine does. `raw` sends what a test needs to see
 * refused: a time off the server's, a nonce used before, another audience, or a request changed after it was signed.
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { signRequest } from '../features/operator/cli/cli';
import { keyIdOf, type OperatorKey, type OperatorScope } from '../keys/operator-keys';

/** A key a test lists (the server's operatorKeys) and signs with. */
export interface TestKey { key: OperatorKey; privateKey: KeyObject }

export interface SignedClient {
  keyId: string;
  get(path: string): Promise<Response>;
  post(path: string, body: unknown): Promise<Response>;
  /**
   * A request as the test makes it: signed at `time` (Unix ms) with `nonce` and for `audience` when given, and then
   * `tamper`ed: its body or path changed after signing, or its signature made by another key under this key's ID.
   */
  raw(o: { method: string; path: string; body?: unknown; time?: number; nonce?: string; audience?: string; tamper?: 'body' | 'path' | 'signature' }): Promise<Response>;
}

/** A new Ed25519 key with `scope`, as `operator keygen` makes one. */
export function makeOperatorKey(scope: OperatorScope): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  if (typeof x !== 'string') throw new Error('An Ed25519 key without its public half');
  const bytes = new Uint8Array(Buffer.from(x, 'base64url'));
  return { key: { id: keyIdOf(bytes), scope, publicKey: bytes }, privateKey };
}

let clients = 0;
/**
 * A client signing as `k` for `audience` (the API's origin: API_URL's), sending to `baseUrl` with `send` (through the edge's
 * TLS, say). Each client is its own address, as each operator's machine is, so the limit per address applies per client.
 */
export function signedClient(baseUrl: string, audience: string, k: TestKey, send: typeof fetch = fetch): SignedClient {
  const n = ++clients;
  const address = `10.9.${(n >> 8) & 255}.${n & 255}`;
  const raw: SignedClient['raw'] = async (o) => {
    const bytes = o.body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(o.body));
    const signer = { keyId: k.key.id, privateKey: o.tamper === 'signature' ? makeOperatorKey(k.key.scope).privateKey : k.privateKey };
    const headers = new Headers({
      authorization: signRequest(signer, { audience: o.audience ?? audience, method: o.method, path: o.path, body: bytes, time: o.time, nonce: o.nonce }),
      'x-forwarded-for': address
    });
    const path = o.tamper === 'path' ? `${o.path}${o.path.includes('?') ? '&' : '?'}tampered=1` : o.path;
    const body = o.tamper === 'body' ? new TextEncoder().encode(`${JSON.stringify(o.body ?? {})} `) : bytes;
    if (body.length) headers.set('content-type', 'application/json');
    return send(`${baseUrl}${path}`, { method: o.method, headers, ...(body.length ? { body } : {}) });
  };
  return {
    keyId: k.key.id,
    raw,
    get: (path) => raw({ method: 'GET', path }),
    post: (path, body) => raw({ method: 'POST', path, body })
  };
}
