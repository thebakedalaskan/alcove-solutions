/*
 * Passkey ceremonies. In the browser this is WebAuthn with the PRF extension; tests inject a
 * software authenticator. PRF output (or a device-held secret when PRF is unavailable) is the
 * per-passkey secret the server uses to unwrap the owner root.
 */
import { AlcoveApiError, AssertionCredentialSchema, PRF_SALT_LABEL, RegistrationCredentialSchema, type AssertionCredential, type RegistrationCredential } from '@alcove/api';

export interface PasskeyDevice {
  create(options: Record<string, unknown>, prfSalt: Uint8Array<ArrayBuffer>): Promise<{ credential: RegistrationCredential; prf: Uint8Array | null; prfEnabled: boolean }>;
  get(options: Record<string, unknown>, prfSalt: Uint8Array<ArrayBuffer>, allow?: string[]): Promise<{ credential: AssertionCredential; prf: Uint8Array | null }>;
}
/** Where device-held secrets live for passkeys without PRF. */
export interface SecretStore {
  get(credentialId: string): Uint8Array | null;
  put(credentialId: string, secret: Uint8Array): void;
  /** Alcove passkeys created in this browser, so unlock offers only those (not other apps' passkeys). */
  known(): string[];
  remember(credentialId: string): void;
}

export const b64u = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(b);
  return b;
}
export async function prfSalt(): Promise<Uint8Array<ArrayBuffer>> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PRF_SALT_LABEL));
  return new Uint8Array(d);
}

/*
 * PRF output arrives as an ArrayBuffer or a typed array, but password-manager extensions build it in
 * their own JavaScript realm, where `instanceof ArrayBuffer` is false. Check the tag instead, and only
 * accept a full 32-byte key; anything else counts as "no PRF" so the device-held key is used.
 */
const isArrayBuffer = (v: unknown): v is ArrayBuffer => Object.prototype.toString.call(v) === '[object ArrayBuffer]';
export function prfKey(v: unknown): Uint8Array | null {
  const bytes = isArrayBuffer(v) ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null;
  return bytes && bytes.length >= 32 && bytes.some((b) => b !== 0) ? bytes.slice(0, 32) : null;
}
const hasJsonApi = (): boolean => typeof PublicKeyCredential !== 'undefined' && 'parseCreationOptionsFromJSON' in PublicKeyCredential;

/*
 * Reading credentials. Password managers (1Password, Bitwarden, Dashlane...) replace
 * navigator.credentials and return their own objects: not `instanceof PublicKeyCredential`, often
 * without toJSON(), with buffers from another realm. So read the standard WebAuthn fields directly.
 */
const get = (o: unknown, k: string): unknown => (typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined);
const call = (o: unknown, k: string): unknown => { const f = get(o, k); return typeof f === 'function' ? Reflect.apply(f, o, []) : undefined; };
const b64Field = (o: unknown, k: string): string | undefined => { const v = bytesOf(get(o, k)) ?? bytesOf(call(o, `get${k[0]?.toUpperCase() ?? ''}${k.slice(1)}`)); return v ? b64u(v) : undefined; };
function bytesOf(v: unknown): Uint8Array | null {
  if (isArrayBuffer(v)) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v)) return unb64u(v);
  return null;
}
function commonFields(cred: unknown): { id: string; rawId: string; type: 'public-key'; clientExtensionResults: Record<string, never>; authenticatorAttachment?: 'platform' | 'cross-platform' } {
  const raw = bytesOf(get(cred, 'rawId'));
  const id = raw ? b64u(raw) : String(get(cred, 'id') ?? '');
  const att = get(cred, 'authenticatorAttachment');
  return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, ...(att === 'platform' || att === 'cross-platform' ? { authenticatorAttachment: att } : {}) };
}
function prfOf(cred: unknown): { key: Uint8Array | null; enabled: boolean } {
  const prf = get(call(cred, 'getClientExtensionResults'), 'prf');
  const results = get(prf, 'results');
  return { key: prfKey(get(results, 'first')), enabled: get(prf, 'enabled') === true || results !== undefined };
}
function registrationOf(cred: unknown): RegistrationCredential {
  const r = get(cred, 'response');
  const transports = call(r, 'getTransports') ?? get(r, 'transports');
  const alg = call(r, 'getPublicKeyAlgorithm') ?? get(r, 'publicKeyAlgorithm');
  return RegistrationCredentialSchema.parse({
    ...commonFields(cred),
    response: {
      clientDataJSON: b64Field(r, 'clientDataJSON'), attestationObject: b64Field(r, 'attestationObject'),
      ...(b64Field(r, 'authenticatorData') ? { authenticatorData: b64Field(r, 'authenticatorData') } : {}),
      ...(b64Field(r, 'publicKey') ? { publicKey: b64Field(r, 'publicKey') } : {}),
      ...(typeof alg === 'number' ? { publicKeyAlgorithm: alg } : {}),
      ...(Array.isArray(transports) ? { transports: transports.filter((t): t is string => typeof t === 'string' && ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'].includes(t)) } : {})
    }
  });
}
function assertionOf(cred: unknown): AssertionCredential {
  const r = get(cred, 'response');
  const userHandle = b64Field(r, 'userHandle');
  return AssertionCredentialSchema.parse({
    ...commonFields(cred),
    response: { clientDataJSON: b64Field(r, 'clientDataJSON'), authenticatorData: b64Field(r, 'authenticatorData'), signature: b64Field(r, 'signature'), ...(userHandle ? { userHandle } : {}) }
  });
}
const isCredential = (c: unknown): boolean => typeof get(c, 'response') === 'object' && get(c, 'rawId') !== undefined;

/** WebAuthn in a real browser, including passkey managers that replace navigator.credentials. */
export function browserPasskeys(): PasskeyDevice {
  return {
    async create(options, salt) {
      if (!hasJsonApi()) throw new AlcoveApiError('unavailable', 'This browser doesn’t support passkeys well enough. Use a current Chrome, Edge or Safari.');
      const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(creationJson(options));
      publicKey.extensions = { ...publicKey.extensions, prf: { eval: { first: salt } } };
      const cred: unknown = await navigator.credentials.create({ publicKey }).catch(cancelled);
      if (!isCredential(cred)) throw new AlcoveApiError('invalid', 'Your passkey manager didn’t return a passkey.');
      const prf = prfOf(cred);
      return { credential: registrationOf(cred), prf: prf.key, prfEnabled: prf.enabled };
    },
    async get(options, salt, allow) {
      if (!hasJsonApi()) throw new AlcoveApiError('unavailable', 'This browser doesn’t support passkeys well enough. Use a current Chrome, Edge or Safari.');
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(requestJson(options));
      if (allow) publicKey.allowCredentials = allow.map((id) => ({ id: unb64u(id), type: 'public-key' }));
      publicKey.extensions = { ...publicKey.extensions, prf: { eval: { first: salt } } };
      const cred: unknown = await navigator.credentials.get({ publicKey }).catch(cancelled);
      if (!isCredential(cred)) throw new AlcoveApiError('invalid', 'Your passkey manager didn’t return a passkey.');
      return { credential: assertionOf(cred), prf: prfOf(cred).key };
    }
  };
}
/* Errors may come from a passkey manager's own realm, so match on the name, not the class. */
function cancelled(e: unknown): never {
  const name = get(e, 'name');
  if (name === 'NotAllowedError' || name === 'AbortError') throw new AlcoveApiError('invalid', 'The passkey prompt was cancelled or timed out.');
  if (name === 'InvalidStateError') throw new AlcoveApiError('conflict', 'That passkey is already registered.');
  const message = get(e, 'message');
  throw new AlcoveApiError('unknown', `Your passkey manager reported an error${typeof message === 'string' && message ? `: ${message}` : '.'}`);
}
/* The server's options are WebAuthn's standard JSON forms; the browser validates them in parse*FromJSON. */
function creationJson(o: Record<string, unknown>): PublicKeyCredentialCreationOptionsJSON {
  if (!isCreation(o)) throw new AlcoveApiError('unknown', 'The server sent invalid passkey options.');
  return o;
}
function requestJson(o: Record<string, unknown>): PublicKeyCredentialRequestOptionsJSON {
  if (!isRequest(o)) throw new AlcoveApiError('unknown', 'The server sent invalid passkey options.');
  return o;
}
const isCreation = (o: Record<string, unknown>): o is Record<string, unknown> & PublicKeyCredentialCreationOptionsJSON => typeof o['challenge'] === 'string' && typeof o['rp'] === 'object' && typeof o['user'] === 'object' && Array.isArray(o['pubKeyCredParams']);
const isRequest = (o: Record<string, unknown>): o is Record<string, unknown> & PublicKeyCredentialRequestOptionsJSON => typeof o['challenge'] === 'string';

/** Device secrets in localStorage, for passkeys whose authenticator has no PRF. */
export function localSecrets(): SecretStore {
  const k = (id: string) => `alcove-device-secret:${id}`;
  const KNOWN = 'alcove-passkeys';
  const known = (): string[] => {
    try { const v: unknown = JSON.parse(localStorage.getItem(KNOWN) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
  };
  return {
    get(id) { try { const v = localStorage.getItem(k(id)); return v ? unb64u(v) : null; } catch { return null; } },
    put(id, s) { try { localStorage.setItem(k(id), b64u(s)); } catch { /* storage unavailable */ } },
    known,
    remember(id) { try { const ids = known(); if (!ids.includes(id)) localStorage.setItem(KNOWN, JSON.stringify([...ids, id])); } catch { /* storage unavailable */ } }
  };
}
