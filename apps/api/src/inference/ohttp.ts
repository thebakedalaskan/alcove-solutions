/*
 * Oblivious HTTP (RFC 9458), the one way Alcove sends NEAR AI anything with content. A request is a Binary
 * HTTP message (RFC 9292), the API key included, sealed with HPKE (RFC 9180, base mode) to the OHTTP key a
 * model's attestation vouches for and posted to the model's own endpoint, so only what holds that key, in
 * the model's attested VM, can open it. The reply is sealed under the same exchange, so only whoever opened
 * the request could have written it (docs: notes-and-inference › Verified private inference). The secrets
 * of each exchange are wiped once used.
 *
 * Only the sender's side is here, with one suite: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, random, utf8 } from '../keys/crypto';

const KEM = 0x0020;
const KDF = 0x0001;
const AEAD = 0x0001;
/** AES-128-GCM's key and nonce lengths, and HKDF-SHA256's output. */
const NK = 16;
const NN = 12;
const NH = 32;
const EMPTY = new Uint8Array(0);

const i2osp = (n: number, w: number): Uint8Array => {
  const b = new Uint8Array(w);
  for (let i = w - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v % 256;
  return b;
};
const u16 = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);

/* ---------- HPKE, base mode (RFC 9180 §4, §5.1) ---------- */

const KEM_SUITE = concat(utf8('KEM'), i2osp(KEM, 2));
const HPKE_SUITE = concat(utf8('HPKE'), i2osp(KEM, 2), i2osp(KDF, 2), i2osp(AEAD, 2));
const labeledExtract = (suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array) => extract(sha256, concat(utf8('HPKE-v1'), suite, utf8(label), ikm), salt);
const labeledExpand = (suite: Uint8Array, prk: Uint8Array, label: string, info: Uint8Array, length: number) =>
  expand(sha256, prk, concat(i2osp(length, 2), utf8('HPKE-v1'), suite, utf8(label), info), length);

/** Wipes intermediate secrets once they've been used. */
const wipe = (...secrets: Uint8Array[]) => { for (const b of secrets) b.fill(0); };

/**
 * SetupBaseS for one message: a fresh ephemeral key, the shared secret with the recipient and the key
 * schedule, then the message sealed and the one secret the reply needs exported. Everything else is wiped.
 */
function sealOnce(recipient: Uint8Array, info: Uint8Array, plaintext: Uint8Array, exportContext: Uint8Array, exportLength: number): { enc: Uint8Array; sealed: Uint8Array; exported: Uint8Array } {
  const ephemeral = random(32);
  const enc = x25519.getPublicKey(ephemeral);
  const dh = x25519.getSharedSecret(ephemeral, recipient);
  const eae = labeledExtract(KEM_SUITE, EMPTY, 'eae_prk', dh);
  const shared = labeledExpand(KEM_SUITE, eae, 'shared_secret', concat(enc, recipient), NH);
  const context = concat(new Uint8Array([0]), labeledExtract(HPKE_SUITE, EMPTY, 'psk_id_hash', EMPTY), labeledExtract(HPKE_SUITE, EMPTY, 'info_hash', info));
  const secret = labeledExtract(HPKE_SUITE, shared, 'secret', EMPTY);
  const key = labeledExpand(HPKE_SUITE, secret, 'key', context, NK);
  const nonce = labeledExpand(HPKE_SUITE, secret, 'base_nonce', context, NN);
  const exporter = labeledExpand(HPKE_SUITE, secret, 'exp', context, NH);
  try {
    return { enc, sealed: gcm(key, nonce, EMPTY).encrypt(plaintext), exported: labeledExpand(HPKE_SUITE, exporter, 'sec', exportContext, exportLength) };
  } finally {
    wipe(ephemeral, dh, eae, shared, secret, key, nonce, exporter);
  }
}

/* ---------- key configuration (RFC 9458 §3) ---------- */

export interface KeyConfig { keyId: number; publicKey: Uint8Array }

/**
 * One OHTTP key configuration: key ID, KEM, its public key and the cipher suites offered. Taken only if
 * it's exactly one well-formed configuration with an X25519 key that offers HKDF-SHA256 with AES-128-GCM.
 */
export function parseKeyConfig(b: Uint8Array): KeyConfig | null {
  if (b.length < 3 + 32 + 2 || u16(b, 1) !== KEM) return null;
  const suitesLength = u16(b, 35);
  if (suitesLength === 0 || suitesLength % 4 !== 0 || 37 + suitesLength !== b.length) return null;
  for (let at = 37; at < b.length; at += 4) {
    if (u16(b, at) === KDF && u16(b, at + 2) === AEAD) return { keyId: b[0] ?? 0, publicKey: b.slice(3, 35) };
  }
  return null;
}

/* ---------- Binary HTTP (RFC 9292) ---------- */

function varint(n: number): Uint8Array {
  if (n < 0x40) return new Uint8Array([n]);
  if (n < 0x4000) return new Uint8Array([0x40 | (n >> 8), n & 0xff]);
  if (n < 0x40000000) return new Uint8Array([0x80 | (n >>> 24), (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  throw new Error('Binary HTTP length too large.');
}
const sized = (bytes: Uint8Array) => concat(varint(bytes.length), bytes);

export interface HttpRequest { method: string; scheme: string; authority: string; path: string; headers: [string, string][]; body: Uint8Array }
export interface HttpResponse { status: number; headers: [string, string][]; body: Uint8Array }

/** A request as a known-length Binary HTTP message. */
export function encodeRequest(r: HttpRequest): Uint8Array {
  const fields = concat(...r.headers.map(([name, value]) => concat(sized(utf8(name.toLowerCase())), sized(utf8(value)))));
  return concat(varint(0), sized(utf8(r.method)), sized(utf8(r.scheme)), sized(utf8(r.authority)), sized(utf8(r.path)), sized(fields), sized(r.body), varint(0));
}

class Reader {
  at = 0;
  constructor(readonly b: Uint8Array) {}
  varint(): number {
    const first = this.b[this.at];
    if (first === undefined) throw new Error('Truncated Binary HTTP message.');
    const length = 1 << (first >> 6);
    if (this.at + length > this.b.length) throw new Error('Truncated Binary HTTP message.');
    let v = first & 0x3f;
    for (let i = 1; i < length; i++) v = v * 256 + (this.b[this.at + i] ?? 0);
    if (!Number.isSafeInteger(v)) throw new Error('Binary HTTP length too large.');
    this.at += length;
    return v;
  }
  bytes(n: number): Uint8Array {
    if (this.at + n > this.b.length) throw new Error('Truncated Binary HTTP message.');
    const out = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  done(): boolean { return this.at >= this.b.length; }
}
const text = new TextDecoder('utf-8', { fatal: true });

/** A Binary HTTP response, known-length or indeterminate-length, after any informational responses. */
export function decodeResponse(b: Uint8Array): HttpResponse {
  const r = new Reader(b);
  const framing = r.varint();
  if (framing !== 1 && framing !== 3) throw new Error('Not a Binary HTTP response.');
  const known = framing === 1;
  const line = (): [string, string] => [text.decode(r.bytes(r.varint())), text.decode(r.bytes(r.varint()))];
  const fields = (): [string, string][] => {
    const out: [string, string][] = [];
    if (known) {
      const end = r.varint() + r.at;
      while (r.at < end) out.push(line());
      if (r.at !== end) throw new Error('Malformed Binary HTTP field section.');
    } else {
      for (let n = r.varint(); n !== 0; n = r.varint()) out.push([text.decode(r.bytes(n)), text.decode(r.bytes(r.varint()))]);
    }
    return out;
  };
  let status = r.varint();
  let headers = fields();
  while (status >= 100 && status < 200) { status = r.varint(); headers = fields(); }
  if (status < 200 || status > 599) throw new Error('Malformed Binary HTTP status.');
  let body: Uint8Array;
  if (known) body = r.done() ? EMPTY : r.bytes(r.varint());
  else {
    const chunks: Uint8Array[] = [];
    for (let n = r.done() ? 0 : r.varint(); n !== 0; n = r.done() ? 0 : r.varint()) chunks.push(r.bytes(n));
    body = concat(...chunks);
  }
  return { status, headers, body: body.slice() };
}

/* ---------- Oblivious HTTP messages (RFC 9458 §4) ---------- */

export interface Encapsulated {
  /** The sealed request, as message/ohttp-req. */
  wire: Uint8Array;
  /** Opens the sealed reply (message/ohttp-res); throws if anyone but the request's recipient sealed it. */
  open(response: Uint8Array): Uint8Array;
  /** Wipes what opening the reply needs, once it has been opened or given up on. */
  wipe(): void;
}

/** Seals one Binary HTTP request to an OHTTP key, keeping only what's needed to open its reply. */
export function encapsulate(cfg: KeyConfig, request: Uint8Array): Encapsulated {
  const header = concat(new Uint8Array([cfg.keyId]), i2osp(KEM, 2), i2osp(KDF, 2), i2osp(AEAD, 2));
  const secretLength = Math.max(NN, NK);
  const { enc, sealed, exported } = sealOnce(cfg.publicKey, concat(utf8('message/bhttp request'), new Uint8Array([0]), header), request, utf8('message/bhttp response'), secretLength);
  return {
    wire: concat(header, enc, sealed),
    open(response) {
      if (response.length < secretLength + 16) throw new Error('The sealed reply is too short.');
      const prk = extract(sha256, exported, concat(enc, response.subarray(0, secretLength)));
      const key = expand(sha256, prk, utf8('key'), NK);
      const nonce = expand(sha256, prk, utf8('nonce'), NN);
      try { return gcm(key, nonce).decrypt(response.subarray(secretLength)); } finally { wipe(prk, key, nonce); }
    },
    wipe: () => wipe(exported)
  };
}
