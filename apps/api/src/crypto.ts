/*
 * Primitives from docs/engineering/privacy-keys-and-sessions.md:
 *   H(tag, body)      = SHA256(UTF8(tag) || 0x00 || body)
 *   Kowner            = 32 random bytes per account, wrapped under HKDF(Kmaster, ownerId, "alcove/owner-root/v1")
 *   Kwrap             = HKDF-SHA256(Kowner, salt=decode(ownerId), info="alcove/owner-wrap/v1")
 *   KeyEnvelope       = {v,ownerId,scopeId,keyVersion,nonce,ciphertext}, header as associated data
 *   Record            = {header,nonce,ciphertext} with XChaCha20-Poly1305 and AD = JCS(header)
 *   Binary record     = uint32(length of JCS(header)) || JCS(header) || nonce || ciphertext: the same seal, for what's too big for text
 *   Blind index       = HMAC(HKDF(Kmaster, "alcove/index/v1"), purpose || 0x00 || value): finds people without storing who they are
 */
import { hchacha, xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { IntegrityError, InternalError, KeyError, ValidationError } from './errors';

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);
export const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
/** Strict base64url decode: rejects padding, bad characters and non-canonical encodings. */
export function unb64u(s: string, length?: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new ValidationError('Malformed base64url value.');
  const b = new Uint8Array(Buffer.from(s, 'base64url'));
  if (b64u(b) !== s || (length !== undefined && b.length !== length)) throw new ValidationError('Malformed base64url value.');
  return b;
}
export function random(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(n));
  b.set(randomBytes(n));
  return b;
}
/** Id128: 16 random bytes as 22 characters of unpadded base64url. */
export const id128 = (): string => b64u(random(16));
/** Through OpenSSL: a piece of a file is hashed on the one core every call runs on, and this takes a tenth of the time. */
export const sha = (b: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(b).digest());
export const H = (tag: string, body: Uint8Array): Uint8Array => sha256(concat(utf8(tag), new Uint8Array([0]), body));
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** Constant-time comparison. */
export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && timingSafeEqual(a, b);
const isZero = (k: Uint8Array): boolean => k.every((x) => x === 0);
/** Never seal or open with a wiped or truncated key: that would quietly produce ciphertext anyone can open. */
function live(k: Uint8Array): Uint8Array {
  if (k.length !== 32 || isZero(k)) throw new InternalError('A key was used after it was wiped.', { context: { keyLength: k.length } });
  return k;
}

/* ---------- canonical JSON (JCS subset: our values are strings, finite numbers, booleans, null, arrays, objects) ---------- */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export function jcs(v: Json): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new ValidationError('Non-finite number.'); return JSON.stringify(v); }
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k] ?? null)}`).join(',')}}`;
}
const JsonSchema: z.ZodType<Json> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonSchema), z.record(z.string(), JsonSchema)]));
/** Converts any parsed value into the Json type, dropping undefined fields. */
export const toJson = (v: unknown): Json => JsonSchema.parse(JSON.parse(JSON.stringify(v)));

/* ---------- key derivation ---------- */
const derive = (ikm: Uint8Array, salt: Uint8Array, info: string): Uint8Array => hkdf(sha256, ikm, salt, utf8(info), 32);
/** Wraps one account's root key. Only the server's master key (sealed in the confidential VM in production) can open it. */
export const ownerRootWrapKey = (kmaster: Uint8Array, ownerId: string): Uint8Array => derive(live(kmaster), unb64u(ownerId, 32), 'alcove/owner-root/v1');
export const ownerWrapKey = (root: Uint8Array, ownerId: string): Uint8Array => derive(live(root), unb64u(ownerId, 32), 'alcove/owner-wrap/v1');
/** Key for a mutable encrypted state row (call state, jobs). Derived from Kowner under its own label, scoped to the row. */
export const stateKey = (root: Uint8Array, ownerId: string, scope: string): Uint8Array => derive(live(root), unb64u(ownerId, 32), `alcove/state/v1/${scope}`);
/** Names what someone can't open on a call. Nothing is stored under it: a name is worked out each time it's told. */
export const closedDocumentKey = (root: Uint8Array, ownerId: string): Uint8Array => derive(live(root), unb64u(ownerId, 32), 'alcove/closed-document/v1');
export const operationCommitKey = (root: Uint8Array, ownerId: string): Uint8Array => derive(live(root), unb64u(ownerId, 32), 'alcove/operation-commit/v1');
export const operationResultKey = (root: Uint8Array, ownerId: string): Uint8Array => derive(live(root), unb64u(ownerId, 32), 'alcove/operation-result/v1');
/** Proves an unwrapped root is the owner's without storing anything that reveals it. */
export const rootCheck = (root: Uint8Array, ownerId: string): Uint8Array => hmac(sha256, derive(live(root), unb64u(ownerId, 32), 'alcove/root-check/v1'), utf8(ownerId));
export const serviceKey = (kservice: Uint8Array, purpose: 'accounting'): Uint8Array => derive(live(kservice), new Uint8Array(0), `alcove/service/${purpose}/v1`);
/** Seals what a browser carries between leaving to sign in with a provider and coming back. */
export const signInAttemptKey = (kmaster: Uint8Array): Uint8Array => derive(live(kmaster), new Uint8Array(0), 'alcove/sign-in-attempt/v1');
/** Names a provider's photo by an opaque token, so browsers fetch it from Alcove and never from the provider. */
export const photoTokenKey = (kmaster: Uint8Array): Uint8Array => derive(live(kmaster), new Uint8Array(0), 'alcove/photo-token/v1');

/**
 * Sealed and stable: the same plaintext always gives the same token (the nonce is a keyed hash of
 * it), so a browser can cache what the token names. It reveals only whether two tokens are equal.
 */
export function sealStable(key: Uint8Array, label: string, plaintext: Uint8Array): string {
  const nonce = hmac(sha256, live(key), plaintext).slice(0, 24);
  return b64u(concat(nonce, xchacha20poly1305(key, nonce, utf8(label)).encrypt(plaintext)));
}
export function openStable(key: Uint8Array, label: string, token: string): Uint8Array {
  const all = unb64u(token);
  if (all.length < 24 + 16) throw new IntegrityError('That token is malformed.', { context: { label } });
  try {
    return xchacha20poly1305(live(key), all.slice(0, 24), utf8(label)).decrypt(all.slice(24));
  } catch (err) {
    throw new IntegrityError('That token wasn’t made here.', { cause: err, context: { label } });
  }
}
/** Signs call passes: what lets someone in a call (guests included) make that call's requests. */
export const callPassKey = (kmaster: Uint8Array): Uint8Array => derive(live(kmaster), new Uint8Array(0), 'alcove/call-pass/v1');
/** Signs the tokens in files' URLs: what says who's asking when a picture or a player can't send a header. */
export const mediaTokenKey = (kmaster: Uint8Array): Uint8Array => derive(live(kmaster), new Uint8Array(0), 'alcove/media-token/v1');
export const mac = (key: Uint8Array, data: Uint8Array): Uint8Array => hmac(sha256, key, data);
/**
 * A keyed hash that lets the server find a person (by sign-in account or email) without storing
 * who they are. Emails are compared trimmed and lower-cased.
 */
export function blindIndex(kmaster: Uint8Array, purpose: 'subject' | 'email' | 'invite' | 'ring' | 'call-code' | 'call-seat' | 'addition-author' | 'upload-guest', value: string): Uint8Array {
  const v = purpose === 'email' || purpose === 'invite' || purpose === 'ring' ? value.trim().toLowerCase() : value;
  return hmac(sha256, derive(live(kmaster), new Uint8Array(0), 'alcove/index/v1'), concat(utf8(purpose), new Uint8Array([0]), utf8(v)));
}

/* ---------- key envelopes ---------- */
const EnvelopeSchema = z.object({ v: z.literal(1), ownerId: z.string(), scopeId: z.string(), keyVersion: z.literal('1'), nonce: z.string(), ciphertext: z.string() });

export function sealKey(wrapKey: Uint8Array, ownerId: string, scopeId: string, key: Uint8Array): Uint8Array {
  const header = { v: 1, ownerId, scopeId, keyVersion: '1' };
  const nonce = random(24);
  const ct = xchacha20poly1305(live(wrapKey), nonce, utf8(jcs(header))).encrypt(key);
  return utf8(jcs({ ...header, nonce: b64u(nonce), ciphertext: b64u(ct) }));
}
export function openKey(wrapKey: Uint8Array, ownerId: string, scopeId: string, envelope: Uint8Array): Uint8Array {
  const e = EnvelopeSchema.parse(JSON.parse(fromUtf8(envelope)));
  if (e.ownerId !== ownerId || e.scopeId !== scopeId) throw new IntegrityError('Key envelope belongs to another scope.', { context: { scopeId } });
  const header = { v: 1, ownerId, scopeId, keyVersion: '1' };
  try {
    return xchacha20poly1305(live(wrapKey), unb64u(e.nonce, 24), utf8(jcs(header))).decrypt(unb64u(e.ciphertext));
  } catch (err) {
    throw new KeyError('This key can’t open that data.', { cause: err, context: { scopeId } });
  }
}

/* ---------- records ---------- */
export type RecordHeader = { [k: string]: Json } & { v: 1; kind: string; ownerId: string };
const RecordSchema = z.object({ header: z.record(z.string(), z.unknown()), nonce: z.string(), ciphertext: z.string() });

export function sealRecord(key: Uint8Array, header: RecordHeader, plaintext: Uint8Array): Uint8Array {
  const nonce = random(24);
  const ct = xchacha20poly1305(live(key), nonce, utf8(jcs(header))).encrypt(plaintext);
  return utf8(jcs({ header, nonce: b64u(nonce), ciphertext: b64u(ct) }));
}
/** Opens a record and checks that its header is exactly the one expected. */
export function openRecord(key: Uint8Array, expected: RecordHeader, record: Uint8Array): Uint8Array {
  const r = RecordSchema.parse(JSON.parse(fromUtf8(record)));
  if (jcs(toJson(r.header)) !== jcs(expected)) throw new IntegrityError('Record header doesn’t match its location.', { context: { kind: expected.kind } });
  try {
    return xchacha20poly1305(live(key), unb64u(r.nonce, 24), utf8(jcs(expected))).decrypt(unb64u(r.ciphertext));
  } catch (err) {
    throw new IntegrityError('A record failed its integrity check.', { cause: err, context: { kind: expected.kind } });
  }
}
/**
 * How many bytes a record opens to, from how long it is: everything around its ciphertext follows from the header, the
 * nonce is always the same length and base64url isn't padded. So a recording's length is known without reading it.
 */
export function recordPlainBytes(header: RecordHeader, recordBytes: number): number {
  const encoded = recordBytes - utf8(jcs({ header, nonce: b64u(new Uint8Array(24)), ciphertext: '' })).length;
  return Math.floor(encoded / 4) * 3 + Math.max(0, (encoded % 4) - 1) - 16;
}
export const sealJson = (key: Uint8Array, header: RecordHeader, value: Json): Uint8Array => sealRecord(key, header, utf8(jcs(value)));
export function openJson<S extends z.ZodType>(key: Uint8Array, header: RecordHeader, record: Uint8Array, schema: S): z.infer<S> {
  return schema.parse(JSON.parse(fromUtf8(openRecord(key, header, record))));
}

/* ---------- binary records ---------- */
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
/** "expand 32-byte k", as ChaCha20 reads it. */
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
/**
 * XChaCha20-Poly1305 is ChaCha20-Poly1305 under a key HChaCha20 makes from the first 16 bytes of the nonce, with the last 8
 * as its nonce. That leaves OpenSSL to do the bytes, the same bytes, in a sixth of the time: all of it on the core calls use.
 */
function subkeyFor(key: Uint8Array, nonce: Uint8Array): { subkey: Uint8Array; iv: Uint8Array } {
  const words = new Uint32Array(8);
  hchacha(SIGMA, new Uint32Array(live(key).slice().buffer), new Uint32Array(nonce.slice(0, 16).buffer), words);
  const iv = new Uint8Array(12);
  iv.set(nonce.subarray(16), 4);
  return { subkey: new Uint8Array(words.buffer), iv };
}
/** A record of bytes, kept as bytes: a third smaller than base64 in JSON, with nothing to parse. Everything else about it is a record. */
export function sealBinary(key: Uint8Array, header: RecordHeader, plaintext: Uint8Array): Uint8Array {
  const head = utf8(jcs(header));
  const at = 4 + head.length;
  const nonce = random(NONCE_BYTES);
  const { subkey, iv } = subkeyFor(key, nonce);
  const out = new Uint8Array(at + NONCE_BYTES + plaintext.length + TAG_BYTES);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(nonce, at);
  const c = createCipheriv('chacha20-poly1305', subkey, iv, { authTagLength: TAG_BYTES }).setAAD(head);
  out.set(c.update(plaintext), at + NONCE_BYTES);
  c.final();
  out.set(c.getAuthTag(), out.length - TAG_BYTES);
  subkey.fill(0);
  return out;
}
/** Opens a binary record and checks that its header is exactly the one expected. */
export function openBinary(key: Uint8Array, expected: RecordHeader, record: Uint8Array): Uint8Array {
  const head = utf8(jcs(expected));
  const at = 4 + head.length;
  const said = record.length < at + NONCE_BYTES + TAG_BYTES ? undefined : record.subarray(0, at);
  if (!said || new DataView(said.buffer, said.byteOffset, 4).getUint32(0) !== head.length || !equalBytes(said.subarray(4), head)) {
    throw new IntegrityError('Record header doesn’t match its location.', { context: { kind: expected.kind } });
  }
  const { subkey, iv } = subkeyFor(key, record.subarray(at, at + NONCE_BYTES));
  try {
    const c = createDecipheriv('chacha20-poly1305', subkey, iv, { authTagLength: TAG_BYTES }).setAAD(head);
    c.setAuthTag(record.subarray(record.length - TAG_BYTES));
    const plain = c.update(record.subarray(at + NONCE_BYTES, record.length - TAG_BYTES));
    c.final();
    return plain;
  } catch (err) {
    throw new IntegrityError('A record failed its integrity check.', { cause: err, context: { kind: expected.kind } });
  } finally {
    subkey.fill(0);
  }
}
