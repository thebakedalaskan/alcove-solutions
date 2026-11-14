/*
 * The edge's keys (docs: privacy-keys-and-sessions › Moving to confidential computing). Each is a P-256 key derived from the
 * master: HKDF(master, '', 'alcove/<purpose>/v1'), 48 bytes reduced mod n (to 1…n-1, as FIPS 186-5 makes a key from extra
 * random bits). The TLS key is the same on every instance and across deploys, so certificates outlive both and the
 * attestation can name it. The ACME account key is the account certificates are asked for with: only the master makes it,
 * so a CAA record that names its account lets nothing else get one for these hosts.
 */
import { mapHashToField } from '@noble/curves/abstract/modular.js';
import { p256 } from '@noble/curves/nist.js';
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { b64u, edgeKeySeed } from '../keys/crypto';

export interface EdgeKey {
  key: KeyObject;
  privateKeyPem: string;
  /** base64url SHA-256 of the DER SubjectPublicKeyInfo, as the attestation's `spki:` nonce carries it. */
  spkiSha256: string;
}

function derived(master: Uint8Array, purpose: 'tls' | 'acme-account'): EdgeKey {
  const seed = edgeKeySeed(master, purpose);
  const d = mapHashToField(seed, p256.Point.Fn.ORDER);
  seed.fill(0);
  const point = p256.getPublicKey(d, false);
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33)) }, format: 'jwk' });
  d.fill(0);
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
  return { key, privateKeyPem: key.export({ type: 'pkcs8', format: 'pem' }).toString(), spkiSha256: createHash('sha256').update(spki).digest('base64url') };
}

/** The key TLS ends with, on every host. */
export const tlsKey = (master: Uint8Array): EdgeKey => derived(master, 'tls');
/** The key of the ACME account certificates are asked for with. */
export const acmeAccountKey = (master: Uint8Array): EdgeKey => derived(master, 'acme-account');
