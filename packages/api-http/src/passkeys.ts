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

function bytesOf(v: BufferSource | undefined): Uint8Array | null {
  if (!v) return null;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}
const hasJsonApi = (): boolean => typeof PublicKeyCredential !== 'undefined' && 'parseCreationOptionsFromJSON' in PublicKeyCredential;

/** WebAuthn in a real browser. */
export function browserPasskeys(): PasskeyDevice {
  return {
    async create(options, salt) {
      if (!hasJsonApi()) throw new AlcoveApiError('unavailable', 'This browser doesn’t support passkeys well enough. Use a current Chrome, Edge or Safari.');
      const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(creationJson(options));
      publicKey.extensions = { ...publicKey.extensions, prf: { eval: { first: salt } } };
      const cred = await navigator.credentials.create({ publicKey }).catch(cancelled);
      if (!(cred instanceof PublicKeyCredential)) throw new AlcoveApiError('invalid', 'No passkey was created.');
      const prf = cred.getClientExtensionResults().prf;
      return { credential: RegistrationCredentialSchema.parse(cred.toJSON()), prf: bytesOf(prf?.results?.first), prfEnabled: prf?.enabled === true || !!prf?.results };
    },
    async get(options, salt, allow) {
      if (!hasJsonApi()) throw new AlcoveApiError('unavailable', 'This browser doesn’t support passkeys well enough. Use a current Chrome, Edge or Safari.');
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(requestJson(options));
      if (allow) publicKey.allowCredentials = allow.map((id) => ({ id: unb64u(id), type: 'public-key' }));
      publicKey.extensions = { ...publicKey.extensions, prf: { eval: { first: salt } } };
      const cred = await navigator.credentials.get({ publicKey }).catch(cancelled);
      if (!(cred instanceof PublicKeyCredential)) throw new AlcoveApiError('invalid', 'No passkey was used.');
      return { credential: AssertionCredentialSchema.parse(cred.toJSON()), prf: bytesOf(cred.getClientExtensionResults().prf?.results?.first) };
    }
  };
}
function cancelled(e: unknown): never {
  if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) throw new AlcoveApiError('invalid', 'The passkey prompt was cancelled.');
  if (e instanceof DOMException && e.name === 'InvalidStateError') throw new AlcoveApiError('conflict', 'That passkey is already registered.');
  throw e;
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
  return {
    get(id) { try { const v = localStorage.getItem(k(id)); return v ? unb64u(v) : null; } catch { return null; } },
    put(id, s) { try { localStorage.setItem(k(id), b64u(s)); } catch { /* storage unavailable */ } }
  };
}
