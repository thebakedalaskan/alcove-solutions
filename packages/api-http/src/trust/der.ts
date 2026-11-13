/*
 * Just enough DER to check a certificate chain and an ECDSA signature with WebCrypto, which verifies signatures but can't
 * read certificates. Strict DER only: definite, shortest lengths, low tag numbers, nothing left over, so a structure reads
 * one way or not at all. What's read here is trusted only once the signature over it checks out.
 */
import { fromUtf8, sameBytes, type Bytes } from './encoding';
import { Unreadable } from './refusal';

interface Element { tag: number; start: number; body: number; end: number; bytes: Bytes }

const SEQUENCE = 0x30;
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const OCTET_STRING = 0x04;
const OID = 0x06;
const BOOLEAN = 0x01;
const UTC_TIME = 0x17;
const GENERALIZED_TIME = 0x18;

function byteAt(b: Uint8Array, i: number): number {
  const v = b[i];
  if (v === undefined) throw new Unreadable('DER');
  return v;
}

function element(bytes: Bytes, start: number, limit: number): Element {
  const tag = byteAt(bytes, start);
  if ((tag & 0x1f) === 0x1f) throw new Unreadable('DER tag');
  let length = byteAt(bytes, start + 1);
  let body = start + 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n === 0 || n > 4 || byteAt(bytes, body) === 0) throw new Unreadable('DER length');
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + byteAt(bytes, body + i);
    body += n;
    if (length < 0x80) throw new Unreadable('DER length');
  }
  const end = body + length;
  if (end > limit) throw new Unreadable('DER length');
  return { tag, start, body, end, bytes };
}

/** The one element `bytes` holds, with nothing after it. */
function only(bytes: Bytes, tag: number): Element {
  const e = element(bytes, 0, bytes.length);
  if (e.tag !== tag || e.end !== bytes.length) throw new Unreadable('DER');
  return e;
}
function children(e: Element): Element[] {
  if (!(e.tag & 0x20)) throw new Unreadable('DER');
  const out: Element[] = [];
  for (let at = e.body; at < e.end;) {
    const c = element(e.bytes, at, e.end);
    out.push(c);
    at = c.end;
  }
  return out;
}
const value = (e: Element): Bytes => e.bytes.subarray(e.body, e.end);
const whole = (e: Element): Bytes => e.bytes.subarray(e.start, e.end);
function expect(e: Element | undefined, tag: number): Element {
  if (!e || e.tag !== tag) throw new Unreadable('DER');
  return e;
}
/** A BIT STRING's bits, which here always fill whole bytes. */
function bits(e: Element): Bytes {
  const v = value(expect(e, BIT_STRING));
  if (byteAt(v, 0) !== 0) throw new Unreadable('DER bit string');
  return v.subarray(1);
}

/** Object identifiers, as their DER content bytes. */
const oid = (...b: number[]): Bytes => new Uint8Array(b);
export const OIDS = {
  rsaEncryption: oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01),
  sha256WithRSA: oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b),
  sha384WithRSA: oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0c),
  sha512WithRSA: oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0d),
  basicConstraints: oid(0x55, 0x1d, 0x13),
  keyUsage: oid(0x55, 0x1d, 0x0f)
} as const;

/** UTCTime or GeneralizedTime, in whole seconds and UTC, as DER writes them; in milliseconds. */
function time(e: Element): number {
  const s = fromUtf8(value(e));
  const m = e.tag === UTC_TIME ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
    : e.tag === GENERALIZED_TIME ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : null;
  if (!m) throw new Unreadable('certificate time');
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (y === undefined || mo === undefined || d === undefined || h === undefined || mi === undefined || se === undefined) throw new Unreadable('certificate time');
  // UTCTime's two digits mean 1950–2049 (RFC 5280 4.1.2.5.1).
  const year = e.tag === UTC_TIME ? (y < 50 ? 2000 + y : 1900 + y) : y;
  const at = Date.UTC(year, mo - 1, d, h, mi, se);
  if (mo < 1 || mo > 12 || new Date(at).getUTCDate() !== d || h > 23 || mi > 59 || se > 59) throw new Unreadable('certificate time');
  return at;
}

/** What a chain check needs from an X.509 certificate (RFC 5280 4.1). */
export interface Certificate {
  /** The bytes its issuer signed. */
  tbs: Bytes;
  /** The algorithm its issuer signed with, as an OID's content bytes. */
  signatureAlgorithm: Bytes;
  signature: Bytes;
  issuer: Bytes;
  subject: Bytes;
  notBefore: number;
  notAfter: number;
  /** Its key, as a DER SubjectPublicKeyInfo, and that key's algorithm as an OID's content bytes. */
  spki: Bytes;
  keyAlgorithm: Bytes;
  /** Whether basicConstraints says it's a certificate authority. */
  ca: boolean;
  /** keyUsage's first eight bits (digitalSignature is 0x80, keyCertSign 0x04), or null without the extension. */
  keyUsage: number | null;
}

export function certificate(der: Bytes): Certificate {
  const [tbs, outerAlg, sig, ...rest] = children(only(der, SEQUENCE));
  if (rest.length) throw new Unreadable('certificate');
  const fields = children(expect(tbs, SEQUENCE));
  let i = fields[0]?.tag === 0xa0 ? 1 : 0;
  const next = (tag: number): Element => expect(fields[i++], tag);
  next(INTEGER);
  const innerAlg = next(SEQUENCE);
  const issuer = next(SEQUENCE);
  const [notBefore, notAfter, ...moreTimes] = children(next(SEQUENCE));
  if (!notBefore || !notAfter || moreTimes.length) throw new Unreadable('certificate validity');
  const subject = next(SEQUENCE);
  const spki = next(SEQUENCE);
  const algorithm = expect(children(expect(children(spki)[0], SEQUENCE))[0], OID);
  // issuerUniqueID [1] and subjectUniqueID [2] may come before the extensions ([3]), which come last.
  while (fields[i]?.tag === 0x81 || fields[i]?.tag === 0x82) i++;
  let ca = false;
  let keyUsage: number | null = null;
  const extensions = fields[i];
  if (extensions) {
    if (extensions.tag !== 0xa3 || i !== fields.length - 1) throw new Unreadable('certificate extensions');
    const seen: Bytes[] = [];
    for (const ext of children(expect(children(extensions)[0], SEQUENCE))) {
      // An extension is its OID, whether it's critical when it says so, and its value.
      const parts = children(expect(ext, SEQUENCE));
      if (parts.length === 3) expect(parts[1], BOOLEAN);
      else if (parts.length !== 2) throw new Unreadable('certificate extension');
      const id = value(expect(parts[0], OID));
      const content = value(expect(parts[parts.length - 1], OCTET_STRING));
      if (seen.some((s) => sameBytes(s, id))) throw new Unreadable('certificate extensions');
      seen.push(id);
      if (sameBytes(id, OIDS.basicConstraints)) {
        const first = children(only(content, SEQUENCE))[0];
        ca = first?.tag === BOOLEAN && byteAt(value(first), 0) === 0xff;
      } else if (sameBytes(id, OIDS.keyUsage)) {
        const v = only(content, BIT_STRING);
        keyUsage = byteAt(value(v), 1);
      }
    }
  }
  const signatureAlgorithm = value(expect(children(expect(outerAlg, SEQUENCE))[0], OID));
  // The algorithm inside what's signed must be the one outside it (RFC 5280 4.1.1.2).
  if (!sameBytes(whole(innerAlg), whole(expect(outerAlg, SEQUENCE)))) throw new Unreadable('certificate algorithm');
  return {
    tbs: whole(expect(tbs, SEQUENCE)), signatureAlgorithm, signature: bits(expect(sig, BIT_STRING)),
    issuer: whole(issuer), subject: whole(subject), notBefore: time(notBefore), notAfter: time(notAfter),
    spki: whole(spki), keyAlgorithm: value(algorithm), ca, keyUsage
  };
}

/** An ECDSA-Sig-Value (SEQUENCE of r and s) as the r ‖ s WebCrypto verifies, each `size` bytes. */
export function ecdsaRaw(der: Bytes, size = 32): Bytes {
  const [r, s, ...rest] = children(only(der, SEQUENCE));
  if (rest.length) throw new Unreadable('ECDSA signature');
  const out = new Uint8Array(size * 2);
  [r, s].forEach((n, k) => {
    let v = value(expect(n, INTEGER));
    while (v.length > 1 && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new Unreadable('ECDSA signature');
    out.set(v, size * (k + 1) - v.length);
  });
  return out;
}
