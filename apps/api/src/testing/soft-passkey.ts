/*
 * A software WebAuthn authenticator for integration tests: real P-256 keys, real CBOR
 * attestation and real signatures, so the server verifies exactly what a browser would send.
 * PRF is HMAC-SHA256(credential secret, salt), like hmac-secret on hardware.
 */
import type { PasskeyDevice, SecretStore } from '@alcove/api-http';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';

/* Minimal canonical CBOR (RFC 8949): exactly the types an authenticator emits. */
type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;
function head(major: number, n: number): Uint8Array {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
  if (n < 65536) return new Uint8Array([(major << 5) | 25, n >> 8, n & 255]);
  return new Uint8Array([(major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function encode(v: Cbor): Uint8Array {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = new TextEncoder().encode(v); return cat(head(3, b.length), b); }
  if (v instanceof Uint8Array) return cat(head(2, v.length), v);
  return cat(head(5, v.size), ...[...v].flatMap(([k, x]) => [encode(k), encode(x)]));
}
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const u16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b; };
const cat = (...p: Uint8Array[]) => new Uint8Array(Buffer.concat(p));
const Jwk = z.object({ x: z.string(), y: z.string() });
const CreateOpts = z.object({ challenge: z.string(), user: z.object({ id: z.string() }) });
const GetOpts = z.object({ challenge: z.string() });

interface Cred { id: Uint8Array; key: KeyObject; userId: string; counter: number; secret: Uint8Array }

export function softPasskeys(o: { origin: string; rpId: string; prf?: boolean }): PasskeyDevice & { credentials: Cred[] } {
  const credentials: Cred[] = [];
  const rpIdHash = sha256(new TextEncoder().encode(o.rpId));
  const prf = (c: Cred, salt: Uint8Array) => (o.prf === false ? null : new Uint8Array(createHmac('sha256', c.secret).update(salt).digest()));
  const clientData = (type: string, challenge: string) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin: o.origin, crossOrigin: false }));
  return {
    credentials,
    async create(options, salt) {
      const opts = CreateOpts.parse(options);
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = Jwk.parse(publicKey.export({ format: 'jwk' }));
      const cred: Cred = { id: new Uint8Array(randomBytes(16)), key: privateKey, userId: opts.user.id, counter: 0, secret: new Uint8Array(randomBytes(32)) };
      credentials.push(cred);
      const cose = encode(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
      const authData = cat(rpIdHash, new Uint8Array([0x45]), u32(0), new Uint8Array(16), u16(cred.id.length), cred.id, cose);
      const attestationObject = encode(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return {
        credential: { id: b64u(cred.id), rawId: b64u(cred.id), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientData('webauthn.create', opts.challenge)), attestationObject: b64u(attestationObject), transports: ['internal'] } },
        prf: prf(cred, salt), prfEnabled: o.prf !== false
      };
    },
    async get(options, salt, allow) {
      const opts = GetOpts.parse(options);
      const cred = allow ? credentials.find((c) => allow.includes(b64u(c.id))) : credentials[0];
      if (!cred) throw new Error('No soft passkey available');
      cred.counter += 1;
      const authData = cat(rpIdHash, new Uint8Array([0x05]), u32(cred.counter));
      const cd = clientData('webauthn.get', opts.challenge);
      const signature = new Uint8Array(sign('sha256', cat(authData, sha256(cd)), cred.key));
      return {
        credential: { id: b64u(cred.id), rawId: b64u(cred.id), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: cred.userId } },
        prf: prf(cred, salt)
      };
    }
  };
}

export function memorySecrets(): SecretStore {
  const m = new Map<string, Uint8Array>();
  return { get: (id) => m.get(id) ?? null, put: (id, s) => { m.set(id, s); } };
}

/** fetch with a one-cookie jar, like a browser tab. */
export function cookieFetch(): typeof fetch {
  let cookie = '';
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('cookie', cookie);
    const res = await fetch(input, { ...init, headers });
    for (const s of res.headers.getSetCookie()) {
      const kv = s.split(';')[0] ?? '';
      cookie = /max-age=0|expires=thu, 01 jan 1970/i.test(s) || kv.endsWith('=') ? '' : kv;
    }
    return res;
  };
}
