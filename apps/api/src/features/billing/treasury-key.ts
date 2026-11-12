/*
 * The treasury's NEAR key (TREASURY_INTENTS_KEY): a full access key of the treasury's account, which signs Alcove in to
 * 1Click as the treasury (oneclick-session.ts). It's parsed once, at startup, from NEAR's secret key format, and held
 * only in a private field here: nothing reads it back, it serializes as a placeholder, and nothing it signs or says
 * names it. It signs NEP-413 messages and nothing else.
 */
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Bytes in base58, Bitcoin's alphabet, as NEAR writes keys and signatures: each leading zero byte is a '1'. */
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (; n > 0n; n /= 58n) out = `${BASE58[Number(n % 58n)] ?? ''}${out}`;
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}
/** base58 as bytes, or null when it isn't base58. */
function fromBase58(text: string): Uint8Array | null {
  let n = 0n;
  for (const c of text) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) return null;
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 255n));
  for (const c of text) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

/** PKCS #8 for an Ed25519 private key, up to its 32-byte seed. */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
/** NEP-413's tag, 2^31 + 413, first in what's hashed and signed, so a signed message can't pass for a transaction. */
const NEP413_TAG = 2 ** 31 + 413;
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
/** A borsh string: its length in bytes (u32, little-endian), then its UTF-8. */
const borshString = (s: string) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(b.length), b]);
};

export class TreasuryKey {
  readonly #key: KeyObject;
  readonly #publicKey: string;
  private constructor(key: KeyObject, publicKey: string) {
    this.#key = key;
    this.#publicKey = publicKey;
  }

  /**
   * A key in NEAR's secret key format: `ed25519:` and 64 bytes in base58, the 32-byte seed and then the public key it
   * makes. Anything else (a seed alone, another curve, a public key that isn't the seed's) is null, and nothing about the
   * text is kept or said.
   */
  static parse(text: string): TreasuryKey | null {
    if (!text.startsWith('ed25519:')) return null;
    const bytes = fromBase58(text.slice('ed25519:'.length));
    if (!bytes || bytes.length !== 64) return null;
    try {
      const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, bytes.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
      const x = createPublicKey(key).export({ format: 'jwk' }).x;
      if (x === undefined) return null;
      const publicKey = Buffer.from(x, 'base64url');
      if (!publicKey.equals(bytes.subarray(32))) return null;
      return new TreasuryKey(key, `ed25519:${base58(publicKey)}`);
    } catch {
      return null;
    }
  }

  /** Its public key, as NEAR writes one: `ed25519:` and 32 bytes in base58. */
  get publicKey(): string {
    return this.#publicKey;
  }

  /**
   * A NEP-413 signature, as NEAR writes one (`ed25519:` and 64 bytes in base58): ed25519 over the SHA-256 of the tag
   * and the borsh payload { message, nonce (32 bytes), recipient, callback_url: None }.
   */
  signNep413(p: { message: string; nonce: Uint8Array; recipient: string }): string {
    const payload = Buffer.concat([u32(NEP413_TAG), borshString(p.message), p.nonce, borshString(p.recipient), Buffer.from([0])]);
    return `ed25519:${base58(sign(null, createHash('sha256').update(payload).digest(), this.#key))}`;
  }

  /** Whatever writes out the settings it's part of writes this, and nothing of the key. */
  toJSON(): string {
    return '[treasury key]';
  }
}
