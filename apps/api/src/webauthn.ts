import type { AssertionCredential, RegistrationCredential } from '@alcove/api';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { id128 } from './crypto';
import { ApiError } from './errors';

const TTL_MS = 60_000;
type Pending =
  | { kind: 'register'; challenge: string; userId: Uint8Array; name: string }
  | { kind: 'unlock'; challenge: string }
  | { kind: 'add'; challenge: string; ownerId: string };

/** Single-use ceremony challenges that expire after 60 seconds. */
export class Challenges {
  private map = new Map<string, Pending & { expires: number }>();
  issue(p: Pending): string {
    const id = id128();
    this.map.set(id, { ...p, expires: Date.now() + TTL_MS });
    for (const [k, v] of this.map) if (v.expires < Date.now()) this.map.delete(k);
    return id;
  }
  take<K extends Pending['kind']>(id: string, kind: K): Extract<Pending, { kind: K }> {
    const p = this.map.get(id);
    this.map.delete(id);
    if (!p || p.expires < Date.now()) throw new ApiError('invalid', 'That passkey prompt expired. Try again.');
    if (!isKind(p, kind)) throw new ApiError('invalid', 'That passkey prompt was for something else.');
    return p;
  }
}
function isKind<K extends Pending['kind']>(p: Pending, kind: K): p is Extract<Pending, { kind: K }> { return p.kind === kind; }

const TRANSPORTS: readonly string[] = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'];
export const asTransports = (xs: readonly string[]): string[] => TRANSPORTS.filter((t) => xs.includes(t));

/** Rebuilds the library's JSON type without undefined members (exactOptionalPropertyTypes). */
export function registrationJSON(c: RegistrationCredential): RegistrationResponseJSON {
  const r = c.response;
  return {
    id: c.id, rawId: c.rawId, type: 'public-key', clientExtensionResults: {},
    ...(c.authenticatorAttachment ? { authenticatorAttachment: c.authenticatorAttachment } : {}),
    response: {
      clientDataJSON: r.clientDataJSON, attestationObject: r.attestationObject,
      ...(r.authenticatorData ? { authenticatorData: r.authenticatorData } : {}),
      ...(r.transports ? { transports: r.transports } : {}),
      ...(r.publicKeyAlgorithm !== undefined ? { publicKeyAlgorithm: r.publicKeyAlgorithm } : {}),
      ...(r.publicKey ? { publicKey: r.publicKey } : {})
    }
  };
}
export function assertionJSON(c: AssertionCredential): AuthenticationResponseJSON {
  const r = c.response;
  return {
    id: c.id, rawId: c.rawId, type: 'public-key', clientExtensionResults: {},
    ...(c.authenticatorAttachment ? { authenticatorAttachment: c.authenticatorAttachment } : {}),
    response: { clientDataJSON: r.clientDataJSON, authenticatorData: r.authenticatorData, signature: r.signature, ...(r.userHandle ? { userHandle: r.userHandle } : {}) }
  };
}
