/*
 * Operator keys: who can operate the service from outside the enclave, and how a request proves it's theirs. Each operator
 * has an Ed25519 key pair of their own, made on their own machine (`operator keygen`), and signs every request with it.
 * Shared by the server, which checks each request (http/operator.ts), and the CLI, which makes keys and signs requests
 * (features/operator/cli/cli.ts): the key list's format (OPERATOR_KEYS), key IDs, the canonical request, its signature, the
 * Authorization header, and the file the CLI keeps a private key in, sealed with a passphrase. Nothing here is secret but
 * the private key, which never leaves the operator's machine: the list is public, in the image and its attestation.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scryptSync, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import { z } from 'zod';

/** What a key may do: `read`, every diagnostic; `write`, those and every action, each with a reason. */
export type OperatorScope = 'read' | 'write';
/** A listed key: its ID, what it may do, and its 32-byte Ed25519 public key. */
export interface OperatorKey { id: string; scope: OperatorScope; publicKey: Uint8Array }

/** Bytes as base64url, exactly `length` of them, or undefined for anything else. */
function bytesOf(s: string, length: number): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return undefined;
  const b = Buffer.from(s, 'base64url');
  return b.length === length && b.toString('base64url') === s ? new Uint8Array(b) : undefined;
}
const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

/** A key's ID: the first 16 characters of the base64url SHA-256 of its public key. A fingerprint, never a name. */
export const keyIdOf = (publicKey: Uint8Array): string => createHash('sha256').update(publicKey).digest('base64url').slice(0, 16);

const publicKeys = new WeakMap<OperatorKey, KeyObject>();
const publicKeyObject = (publicKey: Uint8Array): KeyObject => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(publicKey) }, format: 'jwk' });
function keyObjectOf(key: OperatorKey): KeyObject {
  const known = publicKeys.get(key);
  if (known) return known;
  const made = publicKeyObject(key.publicKey);
  publicKeys.set(key, made);
  return made;
}

/**
 * The Ed25519 public keys of small order, as 32 bytes with the x coordinate's sign bit (the last byte's top bit) left out:
 * the identity, the points of order 2, 4 and 8, and the two encodings of 0 and 1 past the field's prime. For any of these,
 * a signature anyone can make (R the identity, S zero) verifies for some or all messages, and Node checks for none of them.
 * A key keygen makes is never one; a placeholder typed into a list could be.
 */
const SMALL_ORDER = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'
].map((hex) => Buffer.from(hex, 'hex'));
const smallOrder = (key: Uint8Array): boolean =>
  SMALL_ORDER.some((p) => p.subarray(0, 31).equals(key.subarray(0, 31)) && p[31] === ((key[31] ?? 0) & 0x7f));

const ENTRY = /^(read|write):([A-Za-z0-9_-]{43})$/;
/**
 * OPERATOR_KEYS: `read:<public key>` or `write:<public key>`, base64url, comma-separated. Nothing (or only blanks) lists no
 * key. An entry that isn't one, a key anyone can sign for (of small order), or a key listed twice, throws an Error naming the
 * entry by its position, never its value.
 */
export function parseOperatorKeys(value: string): OperatorKey[] {
  if (value.trim() === '') return [];
  const keys: OperatorKey[] = [];
  for (const [i, entry] of value.split(',').entries()) {
    const m = ENTRY.exec(entry.trim());
    const scope = m?.[1];
    const publicKey = m?.[2] === undefined ? undefined : bytesOf(m[2], 32);
    if ((scope !== 'read' && scope !== 'write') || !publicKey) {
      throw new Error(`OPERATOR_KEYS: entry ${i + 1} isn’t read:<public key> or write:<public key>, with an Ed25519 public key in base64url.`);
    }
    if (smallOrder(publicKey)) throw new Error(`OPERATOR_KEYS: entry ${i + 1} is a key anyone can sign for, without its private half. List a key operator keygen made.`);
    const id = keyIdOf(publicKey);
    const twin = keys.findIndex((k) => k.id === id);
    if (twin >= 0) throw new Error(`OPERATOR_KEYS: entry ${i + 1} is the key entry ${twin + 1} lists. List each key once.`);
    keys.push({ id, scope, publicKey });
  }
  return keys;
}

/**
 * What a signature covers. `audience`: the API's origin (https://api.alcove.solutions), so a request signed for one
 * environment is refused by every other. `path`: the path and query exactly as the API receives them. `time`: Unix ms.
 * `nonce`: 16 random bytes, base64url, used once. `bodySha256`: the body's SHA-256, base64url (of no bytes for a GET).
 */
export interface SignedParts { audience: string; method: string; path: string; time: number; nonce: string; bodySha256: string }
export const canonical = (p: SignedParts): string => `alcove-operator/v1\n${[p.audience, p.method, p.path, String(p.time), p.nonce, p.bodySha256].join('\n')}`;
export const bodyHash = (body: Uint8Array): string => createHash('sha256').update(body).digest('base64url');
/** The Ed25519 signature over the canonical request, base64url. */
export const sign = (privateKey: KeyObject, p: SignedParts): string => edSign(null, Buffer.from(canonical(p), 'utf8'), privateKey).toString('base64url');
/** Whether `signature` is `key`'s over exactly these parts. */
export function verify(key: OperatorKey, p: SignedParts, signature: string): boolean {
  const sig = bytesOf(signature, 64);
  return sig !== undefined && edVerify(null, Buffer.from(canonical(p), 'utf8'), keyObjectOf(key), sig);
}

/** The one header a signed request carries. */
export const authorization = (keyId: string, time: number, nonce: string, signature: string): string =>
  `Alcove-Operator key=${keyId}, time=${time}, nonce=${nonce}, signature=${signature}`;
const HEADER = /^Alcove-Operator key=([A-Za-z0-9_-]{16}), time=(\d{1,15}), nonce=([A-Za-z0-9_-]{22}), signature=([A-Za-z0-9_-]{86})$/;
/** The header's parts, or undefined for a header that isn't exactly one. */
export function parseAuthorization(header: string | undefined): { keyId: string; time: number; nonce: string; signature: string } | undefined {
  const m = HEADER.exec(header ?? '');
  const [, keyId, time, nonce, signature] = m ?? [];
  if (keyId === undefined || time === undefined || nonce === undefined || signature === undefined) return undefined;
  return { keyId, time: Number(time), nonce, signature };
}
/** Which instance answered, on every answer to a signed request (its host name, as `whoami` says). */
export const INSTANCE_HEADER = 'x-alcove-instance';

/**
 * An action's reason: a ticket's or an incident's reference, a short prefix, a dash and its number (SUP-1182, INC-77). Never
 * prose, nor a word with dots or slashes, so it can't carry an address, a wallet or a name with its surname.
 */
export const REASON = /^[A-Za-z][A-Za-z0-9]{1,9}-[0-9]{1,10}$/;
/** What a reason is, in words, as the server and the CLI both say it. */
export const REASON_SHAPE = 'a ticket’s or an incident’s reference, a short prefix, a dash and its number, such as SUP-1182 or INC-77';

/**
 * The file the CLI keeps an operator's key in (~/.config/alcove/operator-key.json): its ID and public key, and its private
 * key's 32-byte seed, sealed with a passphrase (`sealed`: scrypt, then AES-256-GCM) or, by choice, not (`seed`).
 */
export interface KeyFile { v: 1; keyId: string; publicKey: string; sealed: { salt: string; iv: string; tag: string; ciphertext: string } | null; seed: string | null }
const B64U = z.string().regex(/^[A-Za-z0-9_-]+$/);
const KeyFileSchema = z.object({
  v: z.literal(1),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  sealed: z.object({ salt: B64U, iv: B64U, tag: B64U, ciphertext: B64U }).nullable(),
  seed: z.string().regex(/^[A-Za-z0-9_-]{43}$/).nullable()
}) satisfies z.ZodType<KeyFile>;

/** scrypt's cost: N = 2^17, r = 8, p = 1, which needs 128 MiB and about a second, per guess. */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
/** What the sealed seed is bound to, beside its key: a sealed seed opens only as this. */
const SEAL_LABEL = 'alcove-operator-key/v1';
const passphraseKey = (passphrase: string, salt: Uint8Array): Buffer => scryptSync(passphrase.normalize('NFC'), salt, 32, SCRYPT);
/** An Ed25519 private key from its 32-byte seed: PKCS#8's fixed prefix, then the seed. */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const privateKeyOf = (seed: Uint8Array): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
function publicKeyOf(key: KeyObject): Uint8Array {
  const { x } = createPublicKey(key).export({ format: 'jwk' });
  const bytes = typeof x === 'string' ? bytesOf(x, 32) : undefined;
  if (!bytes) throw new Error('That isn’t an Ed25519 key.');
  return bytes;
}

/** A new key pair, as the file that keeps it: sealed with `passphrase`, or with none (null). */
export function makeKeyFile(passphrase: string | null): { file: KeyFile; publicKey: Uint8Array } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const { d } = privateKey.export({ format: 'jwk' });
  const seed = typeof d === 'string' ? bytesOf(d, 32) : undefined;
  if (!seed) throw new Error('That isn’t an Ed25519 key.');
  const publicKey = publicKeyOf(privateKey);
  const keyId = keyIdOf(publicKey);
  let sealed: KeyFile['sealed'] = null;
  if (passphrase !== null) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', passphraseKey(passphrase, salt), iv);
    cipher.setAAD(Buffer.from(`${SEAL_LABEL}\n${keyId}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
    sealed = { salt: b64u(salt), iv: b64u(iv), tag: b64u(cipher.getAuthTag()), ciphertext: b64u(ciphertext) };
  }
  return { file: { v: 1, keyId, publicKey: b64u(publicKey), sealed, seed: sealed ? null : b64u(seed) }, publicKey };
}

/**
 * The private key in a key file, and its ID, checked against the public key the file names. `passphrase` is asked for only
 * when the file is sealed.
 */
export async function openKeyFile(file: unknown, passphrase: () => Promise<string>): Promise<{ keyId: string; privateKey: KeyObject }> {
  const parsed = KeyFileSchema.safeParse(file);
  if (!parsed.success) throw new Error('That isn’t an operator key file.');
  const f = parsed.data;
  let seed: Uint8Array | undefined;
  if (f.sealed && f.seed === null) {
    const { salt, iv, tag, ciphertext } = f.sealed;
    const decipher = createDecipheriv('aes-256-gcm', passphraseKey(await passphrase(), Buffer.from(salt, 'base64url')), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${SEAL_LABEL}\n${f.keyId}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    try {
      seed = new Uint8Array(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]));
    } catch (e) {
      throw new Error('That passphrase doesn’t open the key.', { cause: e });
    }
  } else if (!f.sealed && f.seed !== null) {
    seed = bytesOf(f.seed, 32);
  }
  if (!seed || seed.length !== 32) throw new Error('That isn’t an operator key file.');
  const privateKey = privateKeyOf(seed);
  const publicKey = publicKeyOf(privateKey);
  if (b64u(publicKey) !== f.publicKey || keyIdOf(publicKey) !== f.keyId) throw new Error('That key file doesn’t hold the key it names.');
  return { keyId: f.keyId, privateKey };
}
