/*
 * Owner sessions (docs: privacy-keys-and-sessions › Active delegation). The owner root lives only
 * here, in memory: 15 minutes idle, 60 minutes absolute, gone on restart.
 */
import { id128, ownerWrapKey } from './crypto';

export const IDLE_MS = 15 * 60_000;
export const ABSOLUTE_MS = 60 * 60_000;
export const COOKIE = 'alcove_session';
/** Over HTTPS the cookie gets the __Host- prefix: Secure, host-only, path /. */
export const cookieName = (secure: boolean) => (secure ? `__Host-${COOKIE}` : COOKIE);

export interface OwnerSession {
  id: string;
  ownerId: string;
  root: Uint8Array;
  wrapKey: Uint8Array;
  rootSource: 'prf' | 'device';
  createdAt: number;
  lastActive: number;
  /** Until when a fresh passkey proof allows changing passkeys. */
  stepUpUntil?: number;
}

export class SessionStore {
  private byId = new Map<string, OwnerSession>();
  constructor(private readonly now: () => number = Date.now) {}

  open(ownerId: string, root: Uint8Array, rootSource: 'prf' | 'device'): OwnerSession {
    // One current session per owner: a new unlock closes the old one.
    for (const s of this.byId.values()) if (s.ownerId === ownerId) this.close(s.id);
    const t = this.now();
    const s: OwnerSession = { id: id128() + id128(), ownerId, root, wrapKey: ownerWrapKey(root, ownerId), rootSource, createdAt: t, lastActive: t };
    this.byId.set(s.id, s);
    return s;
  }
  /** Returns the live session and extends its idle deadline, or undefined if expired. */
  touch(id: string | undefined): OwnerSession | undefined {
    if (!id) return undefined;
    const s = this.byId.get(id);
    if (!s) return undefined;
    const t = this.now();
    if (t - s.lastActive > IDLE_MS || t - s.createdAt > ABSOLUTE_MS) { this.close(id); return undefined; }
    s.lastActive = t;
    return s;
  }
  expiresAt(s: OwnerSession): Date { return new Date(s.createdAt + ABSOLUTE_MS); }
  /** Closes every expired session, so idle roots leave memory even if the browser never returns. */
  sweep(): number {
    const t = this.now(); let n = 0;
    for (const s of [...this.byId.values()]) if (t - s.lastActive > IDLE_MS || t - s.createdAt > ABSOLUTE_MS) { this.close(s.id); n++; }
    return n;
  }
  get size() { return this.byId.size; }
  close(id: string) {
    const s = this.byId.get(id);
    if (s) { s.root.fill(0); s.wrapKey.fill(0); }
    this.byId.delete(id);
  }
}
