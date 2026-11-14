/*
 * A stand-in for Cloud KMS, for integration tests: a KeyWrapper (server-keys.ts) that wraps under a key of its own, sealed
 * with XChaCha20-Poly1305 as crypto.ts seals records, so what it wraps is real ciphertext and another stand-in, with another
 * key, can't unwrap it, as Cloud KMS won't for another key or for a build it doesn't trust.
 */
import { createHash } from 'node:crypto';
import { openBinary, sealBinary } from '../../keys/crypto';
import type { KeyWrapper } from '../../keys/server-keys';

const HEADER = { v: 1 as const, kind: 'fake-kms', ownerId: '' };

/** `name`: which key it wraps under. The same name is the same key, in any test; another name is another key. */
export function fakeKms(name = 'alcove-test-key'): KeyWrapper {
  const key = new Uint8Array(createHash('sha256').update(`fake-kms:${name}`).digest());
  // Each takes a copy of what it's given: a Buffer can be a view into memory Node shares, which a binary record can't open.
  return {
    key: `fake-kms/${name}`,
    wrap: async (plaintext) => sealBinary(key, HEADER, new Uint8Array(plaintext)),
    unwrap: async (ciphertext) => openBinary(key, HEADER, new Uint8Array(ciphertext))
  };
}
