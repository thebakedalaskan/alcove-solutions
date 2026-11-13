/*
 * The encodings the server's evidence comes in: base64 (certificates, signatures, Rekor's bodies), base64url (the
 * token), hex (hashes) and PEM (keys). Every decoder is strict and throws on anything else, so nothing half-read is
 * checked.
 */
import { Unreadable } from './refusal';

/** Bytes WebCrypto takes: backed by a plain ArrayBuffer. */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
export const utf8 = (s: string): Bytes => encoder.encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);

/** Standard base64, with or without its padding. */
export function fromBase64(s: string): Bytes {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.replace(/=+$/, '').length % 4 === 1) throw new Unreadable('base64');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function fromBase64Url(s: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Unreadable('base64url');
  return fromBase64(s.replace(/-/g, '+').replace(/_/g, '/'));
}
export function toBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
export const toBase64Url = (b: Uint8Array): string => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function fromHex(s: string): Bytes {
  if (!/^(?:[0-9a-f]{2})*$/.test(s)) throw new Unreadable('hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The DER inside one PEM block with this label, and nothing else around it. */
export function fromPem(pem: string, label: 'CERTIFICATE' | 'PUBLIC KEY'): Bytes {
  const m = new RegExp(`^-----BEGIN ${label}-----\\r?\\n([A-Za-z0-9+/=\\r\\n]+)-----END ${label}-----\\s*$`).exec(pem.trim());
  if (!m?.[1]) throw new Unreadable(`PEM ${label}`);
  return fromBase64(m[1].replace(/[\r\n]/g, ''));
}
/** PEM as Go's encoding/pem writes it: 64 characters a line, a newline at the end. */
export function toPem(der: Uint8Array, label: 'CERTIFICATE' | 'PUBLIC KEY'): string {
  const b64 = toBase64(der);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
export const concatBytes = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
export const sha256 = async (b: Bytes): Promise<Bytes> => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
