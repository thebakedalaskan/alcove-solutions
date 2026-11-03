/*
 * Primitives from docs/engineering/privacy-keys-and-sessions.md:
 *   H(tag, body)      = SHA256(UTF8(tag) || 0x00 || body)
 *   Kowner            = 32 random bytes per account, wrapped under HKDF(Kmaster, ownerId, "alcove/owner-root/v1")
 *   Kwrap             = HKDF-SHA256(Kowner, salt=decode(ownerId), info="alcove/owner-wrap/v1")
 *   KeyEnvelope       = {v,ownerId,scopeId,keyVersion,nonce,ciphertext}, header as associated data
 *   Record            = {header,nonce,ciphertext} with XChaCha20-Poly1305 and AD = JCS(header)
 *   Blind index       = HMAC(HKDF(Kmaster, "alcove/index/v1"), purpose || 0x00 || value): finds people without storing who they are
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { timingSafeEqual } from 'node:crypto';
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
export const sha = (b: Uint8Array): Uint8Array => sha256(b);
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
export const operationCommitKey = (root: Uint8Array, ownerId: string): Uint8Array => derive(live(root), unb64u(ownerId, 32), 'alcove/operation-commit/v1');
export const operationResultKey = (root: Uint8Array, ownerId: string): Uint8Array => derive(live(root), unb64u(ownerId, 32), 'alcove/operation-result/v1');
/** Proves an unwrapped root is the owner's without storing anything that reveals it. */
export const rootCheck = (root: Uint8Array, ownerId: string): Uint8Array => hmac(sha256, derive(live(root), unb64u(ownerId, 32), 'alcove/root-check/v1'), utf8(ownerId));
export const serviceKey = (kservice: Uint8Array, purpose: 'accounting'): Uint8Array => derive(live(kservice), new Uint8Array(0), `alcove/service/${purpose}/v1`);
/** Seals what a browser carries between leaving to sign in with a provider and coming back. */
export const signInAttemptKey = (kmaster: Uint8Array): Uint8Array => derive(live(kmaster), new Uint8Array(0), 'alcove/sign-in-attempt/v1');
/** Signs call passes: what lets someone in a call (guests included) make that call's requests. */
export const callPassKey = (kmaster: Uint8Array): Uint8Array => derive(live(kmaster), new Uint8Array(0), 'alcove/call-pass/v1');
export const mac = (key: Uint8Array, data: Uint8Array): Uint8Array => hmac(sha256, key, data);
/**
 * A keyed hash that lets the server find a person (by sign-in account or email) without storing
 * who they are. Emails are compared trimmed and lower-cased.
 */
export function blindIndex(kmaster: Uint8Array, purpose: 'subject' | 'email' | 'call-code', value: string): Uint8Array {
  const v = purpose === 'email' ? value.trim().toLowerCase() : value;
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
export const sealJson = (key: Uint8Array, header: RecordHeader, value: Json): Uint8Array => sealRecord(key, header, utf8(jcs(value)));
export function openJson<S extends z.ZodType>(key: Uint8Array, header: RecordHeader, record: Uint8Array, schema: S): z.infer<S> {
  return schema.parse(JSON.parse(fromUtf8(openRecord(key, header, record))));
}
